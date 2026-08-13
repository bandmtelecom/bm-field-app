-- =================================================================
-- B&M Field App — full Supabase setup (run once, top to bottom)
-- Combines: 0001 schema + 0002 RLS + 0003 rate-card seed (69 units)
-- Paste into Supabase → SQL Editor → New query → Run.
-- =================================================================

-- ############ 0001 — SCHEMA ############
-- ============================================================================
-- B&M Field App — 0001 init (schema)
-- The running-record data model: jobs → visits → locations(closures) → detail.
-- Run this first in the Supabase SQL editor.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user; holds role + active flag (the kill-switch)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  initials    text,
  role        text not null default 'tech' check (role in ('tech','office','admin')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table profiles is 'App users. role gates prices: tech=units only, office/admin=prices. is_active=false locks out.';

-- auto-create a profile when a Supabase auth user is created
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- customers — Lumen, Primoris, Oncor, ... ; `code` seeds closure IDs
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique,          -- e.g. 'Lumen' → Lumen-0001
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- jobs — created once (folder + B&M number); appears on the app roster
-- ---------------------------------------------------------------------------
create table if not exists jobs (
  id              uuid primary key default gen_random_uuid(),
  bm_number       text not null unique,       -- '26-408'
  customer_id     uuid not null references customers(id),
  identifier      text,                        -- N-number / TT / LOR / address
  identifier_type text not null default 'other'
                    check (identifier_type in ('n_number','tt','lor','address','other')),
  title           text,
  billing_mode    text not null default 'capital'
                    check (billing_mode in ('capital','emergency')),
  status          text not null default 'open'
                    check (status in ('open','complete','reopened','invoiced')),
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  completed_by    uuid references profiles(id),
  completed_at    timestamptz
);
comment on column jobs.billing_mode is 'emergency (LOR/TT) = hourly splicer billing; capital = per-unit. Derived on create; overridable.';

-- ---------------------------------------------------------------------------
-- closures — the company-wide registry (permanent IDs, feeds the KML)
-- one manhole can hold 2+ closures → pin is at the closure level
-- ---------------------------------------------------------------------------
create table if not exists closures (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references customers(id),
  seq             int not null,                -- per-customer running number
  closure_code    text not null unique,        -- 'Lumen-0042'
  gps_lat         numeric(9,6),
  gps_lng         numeric(9,6),
  structure_type  text check (structure_type in ('mh','hh','aerial','building')),
  structure_owner text,
  building_address text,
  enclosure_model text,
  notes           text,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  unique (customer_id, seq)
);

-- allocate the next per-customer sequential and format the code
create or replace function next_closure_code(p_customer uuid)
returns table (seq int, code text) language plpgsql as $$
declare v_seq int; v_code text; v_prefix text;
begin
  select code into v_prefix from customers where id = p_customer;
  select coalesce(max(seq),0)+1 into v_seq from closures where customer_id = p_customer;
  v_code := v_prefix || '-' || lpad(v_seq::text, 4, '0');
  return query select v_seq, v_code;
end; $$;

-- ---------------------------------------------------------------------------
-- visits — a tech's trip on a job; stacks under the job (running record)
-- ---------------------------------------------------------------------------
create table if not exists visits (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  reporter_id     uuid references profiles(id),
  visit_date      date not null default current_date,
  report_type     text not null default 'splice'
                    check (report_type in ('splice','outage','test','could_not_complete')),
  techs           text[] not null default '{}',   -- names/initials on the job that day
  narrative       text,
  status_flag     text check (status_flag in
                    ('complete','partial_return','ready_to_test','could_not_access','troubleshooting')),
  lead_start      timestamptz,                 -- lead-tech clocker (job timing, not payroll)
  lead_finish     timestamptz,
  lead_hours      numeric(6,2),                -- entered/derived; drives hourly billing on emergency jobs
  restored_at     timestamptz,                 -- outage jobs
  created_at      timestamptz not null default now()
);

-- timeline events (optional, outage/long jobs)
create table if not exists timeline_events (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references visits(id) on delete cascade,
  label       text not null,
  at          timestamptz,
  ordinal     int not null default 0
);

-- ---------------------------------------------------------------------------
-- locations — one block per closure worked in a visit (the heart of the report)
-- ---------------------------------------------------------------------------
create table if not exists locations (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null references visits(id) on delete cascade,
  closure_id      uuid references closures(id),    -- matched or newly created
  pm_location_no  text,                            -- the PM's random number, editable
  tech_id         uuid references profiles(id),
  hole_ref        text,                            -- group closures sharing one hole (setup billed once/hole)
  structure_type  text not null check (structure_type in ('mh','hh','aerial','building')),
  structure_owner text,
  building_address text,
  gps_lat         numeric(9,6),
  gps_lng         numeric(9,6),
  enclosure_new   boolean not null default false,  -- new vs existing
  enclosure_model text,
  case_action     text check (case_action in ('reenter','new_case','midsheath')),
  new_case_material_code text,                     -- rate_card.code for the physical case (when new_case)
  splice_type     text check (splice_type in ('single','ribbon')),
  splice_count    int not null default 0,          -- single=#splices; ribbon=#ribbons
  trays_added     int not null default 0,          -- bills ADD_TRAY labor + tray material
  tray_material_code text,                         -- inferred from enclosure model + single/ribbon
  test_fiber_count int not null default 0,         -- fibers shot/tested (only bills on test-only jobs)
  test_type       text check (test_type in ('otdr','bare')),
  as_found        text,
  as_built        text,
  narrative       text,                            -- "what happened here"
  ordinal         int not null default 0,
  created_at      timestamptz not null default now()
);
comment on column locations.hole_ref is 'Closures with the same hole_ref (or same structure+GPS) in a visit share ONE setup/teardown fee; each still bills its own re-enter.';

-- OTDR shots (D4)
create table if not exists shots (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  fiber_group text,
  direction   text,
  distance_km numeric(8,3),
  event       text,
  ordinal     int not null default 0
);

-- cable inventory (D7) — hidden for Building (uses panel_ports instead)
create table if not exists cables (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references locations(id) on delete cascade,
  direction    text,
  count        text,                             -- '144F', '36F MC'
  manufacturer text,
  date_code    text,
  footage      int,
  role         text,                             -- 'tail', 'Tie to L5.5'
  ordinal      int not null default 0
);

-- panel ports & positions (Building / FQA) — replaces cables when Building
create table if not exists panel_ports (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  panel       text,                              -- 'G12.014.13'
  port        text,                              -- '638'
  position    text,                              -- 'C'
  pass_fail   text check (pass_fail in ('pass','fail')),
  ordinal     int not null default 0
);

-- downtime (D3½) — structured so it can bill as standby
create table if not exists downtime (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  hours       numeric(6,2) not null default 0,
  reason      text,                              -- waiting_construction, access, engineer, ...
  ordinal     int not null default 0
);

-- tap-to-add billable units NOT derived from structured fields:
-- civil (dewatering, expose), case work (remove/replace, prep-in-housing,
-- transfer tube, term panel), ground bracket, jumper footage, etc.
-- NOTE: do NOT put setup / re-enter / splices / new-case labor / trays / case
-- material here — those come from the structured location fields (avoids double
-- billing). unit_code maps to rate_card.code so it flows straight into the invoice.
create table if not exists location_units (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  unit_code   text,                              -- references rate_card.code (soft ref)
  qty         numeric(10,2) not null default 1,
  note        text,
  ordinal     int not null default 0
);

-- ---------------------------------------------------------------------------
-- rate_card — the priced units (back-office only via RLS). Seeded in 0003.
-- ---------------------------------------------------------------------------
create table if not exists rate_card (
  code        text primary key,                  -- stable slug, e.g. 'SPLICE_FUSION_49_144'
  unit_no     int,                               -- rate-card row number
  section     text,                              -- SPL / MAT / UGB / HRS / ISP
  assembly    text not null,                     -- the rate-card name
  uom         text,
  rate        numeric(12,4) not null,            -- total per unit (incl tax)
  billable    boolean not null default true      -- highlighted units B&M actually bills
);

-- ---------------------------------------------------------------------------
-- attachments — photos, OTDR traces, test packages (Supabase Storage paths)
-- ---------------------------------------------------------------------------
create table if not exists attachments (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid references jobs(id) on delete cascade,
  visit_id     uuid references visits(id) on delete cascade,
  location_id  uuid references locations(id) on delete cascade,
  kind         text not null default 'photo'
                 check (kind in ('photo','otdr','test_pkg','other')),
  storage_path text not null,                    -- bucket path in 'attachments'
  filename     text,
  uploaded_by  uuid references profiles(id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- invoice_drafts / invoice_lines — generated by the API billing engine
-- ---------------------------------------------------------------------------
create table if not exists invoice_drafts (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references jobs(id) on delete cascade,
  status       text not null default 'draft'
                 check (status in ('draft','approved','sent','void')),
  billing_mode text,
  subtotal     numeric(12,2) not null default 0,
  total        numeric(12,2) not null default 0,
  notes        text,
  generated_at timestamptz not null default now(),
  generated_by uuid references profiles(id),
  approved_by  uuid references profiles(id),
  approved_at  timestamptz
);

create table if not exists invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references invoice_drafts(id) on delete cascade,
  unit_code   text,
  description text,
  quantity    numeric(12,2) not null default 0,
  rate        numeric(12,4) not null default 0,
  extended    numeric(12,2) not null default 0,
  source      text,                              -- why this line exists (audit)
  ordinal     int not null default 0
);

-- ---------------------------------------------------------------------------
-- helpful indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_visits_job         on visits(job_id);
create index if not exists idx_locations_visit    on locations(visit_id);
create index if not exists idx_locations_closure  on locations(closure_id);
create index if not exists idx_shots_location     on shots(location_id);
create index if not exists idx_cables_location    on cables(location_id);
create index if not exists idx_panelports_location on panel_ports(location_id);
create index if not exists idx_downtime_location  on downtime(location_id);
create index if not exists idx_locunits_location  on location_units(location_id);
create index if not exists idx_attachments_job    on attachments(job_id);
create index if not exists idx_invlines_draft     on invoice_lines(draft_id);
create index if not exists idx_jobs_customer       on jobs(customer_id);
create index if not exists idx_closures_customer   on closures(customer_id);

-- ############ 0002 — ROW-LEVEL SECURITY ############
-- ============================================================================
-- B&M Field App — 0002 row-level security (the price wall + access rules)
-- Run after 0001. The service_role key (used only by the API) BYPASSES RLS,
-- so the billing engine can still read prices server-side.
-- ============================================================================

-- ---- role helpers (SECURITY DEFINER to avoid RLS recursion on profiles) ----
create or replace function app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from profiles where id = auth.uid()), false);
$$;

create or replace function is_office()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('office','admin') from profiles where id = auth.uid()), false);
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

-- ---- enable RLS everywhere ----
alter table profiles        enable row level security;
alter table customers       enable row level security;
alter table jobs            enable row level security;
alter table closures        enable row level security;
alter table visits          enable row level security;
alter table timeline_events enable row level security;
alter table locations       enable row level security;
alter table shots           enable row level security;
alter table cables          enable row level security;
alter table panel_ports     enable row level security;
alter table downtime        enable row level security;
alter table location_units  enable row level security;
alter table attachments     enable row level security;
alter table rate_card       enable row level security;
alter table invoice_drafts  enable row level security;
alter table invoice_lines   enable row level security;

-- ---- profiles ----
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_office());
create policy profiles_update_self on profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = app_role()); -- can't self-promote
create policy profiles_admin_all on profiles for all
  using (is_admin()) with check (is_admin());

-- ---- operational tables: every ACTIVE user sees the whole running record ----
-- techs contribute reports; deletes reserved for office/admin.
do $$
declare t text;
begin
  foreach t in array array[
    'customers','jobs','closures','visits','timeline_events','locations',
    'shots','cables','panel_ports','downtime','location_units','attachments'
  ] loop
    execute format('create policy %I_select on %I for select using (is_active_user());', t, t);
    execute format('create policy %I_insert on %I for insert with check (is_active_user());', t, t);
    execute format('create policy %I_update on %I for update using (is_active_user()) with check (is_active_user());', t, t);
    execute format('create policy %I_delete on %I for delete using (is_office());', t, t);
  end loop;
end $$;

-- ---- rate_card: PRICES — back office only. Techs get zero rows. ----
create policy rate_card_office_select on rate_card for select using (is_office());
-- writes only via service role (RLS bypass); no policy needed for that.

-- ---- invoice drafts/lines: back office only; admins/office can approve ----
create policy invoice_drafts_office_select on invoice_drafts for select using (is_office());
create policy invoice_drafts_office_update on invoice_drafts for update
  using (is_office()) with check (is_office());
create policy invoice_lines_office_select on invoice_lines for select using (is_office());
-- inserts/generation happen via the API with the service role.

-- ============================================================================
-- Result: a `tech` JWT can read jobs/visits/locations (their running record)
-- but SELECT on rate_card / invoice_drafts / invoice_lines returns nothing.
-- The dollars simply do not exist for a tech, at the database level.
-- ============================================================================

-- ############ 0003 — RATE-CARD SEED ############
-- ============================================================================
-- B&M Field App — 0003 rate-card seed (69 billable units, Lumen BAFO R1 2026LE000053 TX)
-- Generated from the source rate card. Rates kept at 6-dp (tax already included).
-- Prices are back-office only (enforced by RLS in 0002).
-- ============================================================================

insert into rate_card (code, unit_no, section, assembly, uom, rate, billable) values
  ('ADD_TRAY', 1, 'SPL', 'ADD FIBER TRAY OR BASKET', 'EACH', 20.75, true),
  ('CASE_AER_B', 17, 'MAT', 'CASE AER FIB B 9.8x24 GEL NO TRAY', '', 352.126425, true),
  ('CASE_AER_D_1130', 19, 'MAT', 'CASE AER FIB D 11.5x30 GEL 36 TRAY', '', 505.235225, true),
  ('CASE_AER_D_1133', 22, 'MAT', 'CASE AER FIB D 11x33 GEL 36 TRAY', '', 650.38765, true),
  ('CASE_NEW', 49, 'SPL', 'CASE FIBER NEW', 'EACH', 242.0, true),
  ('CASE_UG_B', 63, 'MAT', 'CASE UG FIB B 9.8x24 GEL NO TRAY', '', 325.7026, true),
  ('CASE_UG_D_1130', 65, 'MAT', 'CASE UG FIB D 11.5x30 GEL 36 TRAY', '', 478.8114, true),
  ('CASE_UG_D_1133', 68, 'MAT', 'CASE UG FIB D 11x33 GEL 36 TRAY', '', 623.963825, true),
  ('DEWATERING', 73, 'UGB', 'DEWATERING BASIC', 'EACH', 338.4, true),
  ('DOWNTIME_CAPITAL', 76, 'HRS', 'DOWNTIME - CAPITAL PROJECT', 'ACTUAL', 1.0, true),
  ('EXPOSE_HHMH_12', 99, 'UGB', 'EXPOSE EXIST HH-MH <= 12in', 'EACH', 300.0, true),
  ('EXPOSE_HHMH_ADDL', 100, 'UGB', 'EXPOSE EXIST HH-MH 12in ADDL', 'EACH', 130.0, true),
  ('FIBER_ADD_EXIST', 174, 'SPL', 'FIBER ADD TO EXIST CASE', 'EACH', 179.0, true),
  ('FIBER_TRANSFER_TUBE', 183, 'SPL', 'FIBER TRANSFER TUBE', 'EACH', 38.9075, true),
  ('FUSION_13_24', 205, 'SPL', 'SPLICE FIBER FUSION 13-24', 'EACH', 55.19485, true),
  ('FUSION_145_288', 207, 'SPL', 'SPLICE FIBER FUSION 145-288', 'EACH', 30.19485, true),
  ('FUSION_1_4', 206, 'SPL', 'SPLICE FIBER FUSION 1-4', 'EACH', 62.19485, true),
  ('FUSION_25_48', 208, 'SPL', 'SPLICE FIBER FUSION 25-48', 'EACH', 45.19485, true),
  ('FUSION_289_432', 209, 'SPL', 'SPLICE FIBER FUSION 289-432', 'EACH', 27.19485, true),
  ('FUSION_433_864', 210, 'SPL', 'SPLICE FIBER FUSION 433-864', 'EACH', 25.19485, true),
  ('FUSION_49_144', 211, 'SPL', 'SPLICE FIBER FUSION 49-144', 'EACH', 35.19485, true),
  ('FUSION_5_12', 212, 'SPL', 'SPLICE FIBER FUSION 5-12', 'EACH', 65.19485, true),
  ('FUSION_GT_864', 204, 'SPL', 'SPLICE FIBER FUSION > 864', 'EACH', 23.19485, true),
  ('FUSION_MAINT_ADDER', 203, 'SPL', 'SPLICE FIBER - MAINT WINDOW ADDER', 'EACH', 6.5, true),
  ('FUSION_MECH', 213, 'SPL', 'SPLICE FIBER MECHANICAL', 'EACH', 67.155, true),
  ('GROUND_BRACKET_KIT', 185, 'MAT', 'GROUND BRACKET KIT', '', 5.271775, true),
  ('JUMPER_PRECONN', 187, 'ISP', 'JUMPER PRE-CONNECTORIZED FIBER', 'FOOT', 5.07, true),
  ('PREP_HOUSING', 189, 'SPL', 'PREP FIBER CABLE IN HOUSING', 'EACH', 136.4312, true),
  ('PREP_MIDSHEATH', 190, 'SPL', 'PREP FIBER CABLE MIDSHEATH CASE', 'EACH', 245.453175, true),
  ('REENTER', 192, 'SPL', 'RE-ENTER EXIST FIBER CASE', 'EACH', 60.62785, true),
  ('RIBBONIZE_LE12', 214, 'SPL', 'SPLICE FIBER RIBBONIZE <= 12 FIBERS', 'EACH', 67.483025, true),
  ('RIBBON_13_24', 217, 'SPL', 'SPLICE FIBER RIBBONS 13-24', 'EACH', 200.0, true),
  ('RIBBON_145_288', 218, 'SPL', 'SPLICE FIBER RIBBONS 145-288', 'EACH', 122.483025, true),
  ('RIBBON_25_36', 219, 'SPL', 'SPLICE FIBER RIBBONS 25-36', 'EACH', 179.483025, true),
  ('RIBBON_37_72', 221, 'SPL', 'SPLICE FIBER RIBBONS 37-72', 'EACH', 174.0, true),
  ('RIBBON_3_12', 220, 'SPL', 'SPLICE FIBER RIBBONS 3-12', 'EACH', 231.483025, true),
  ('RIBBON_73_144', 222, 'SPL', 'SPLICE FIBER RIBBONS 73-144', 'EACH', 151.483025, true),
  ('RIBBON_LE2', 216, 'SPL', 'SPLICE FIBER RIBBONS <=2', 'EACH', 257.483025, true),
  ('RIBBON_MAINT_ADDER', 215, 'SPL', 'SPLICE FIBER RIBBONS - MAINT ADDER', 'EACH', 24.0, true),
  ('RMV_REPLACE_CASE', 196, 'SPL', 'RMV-REPLACE FIBER CASE', 'EACH', 309.0, true),
  ('RMV_TERM_PANEL_OSP', 195, 'SPL', 'RMV TERMINATION PANEL OSP', 'EACH', 45.7, true),
  ('SETUP_AERIAL', 198, 'SPL', 'SPL SETUP-TEARDOWN AERIAL-FIB', 'EACH', 200.0, true),
  ('SETUP_BUILDING', 199, 'SPL', 'SPL SETUP-TEARDOWN BUILDING-FIB', 'EACH', 195.0, true),
  ('SETUP_HH', 200, 'SPL', 'SPL SETUP-TEARDOWN HH-FIB', 'EACH', 150.0, true),
  ('SETUP_MH', 202, 'SPL', 'SPL SETUP-TEARDOWN VAULT-MH-FIB', 'EACH', 253.0, true),
  ('SETUP_PED', 201, 'SPL', 'SPL SETUP-TEARDOWN PED/CABINET-FIB', 'EACH', 150.0, true),
  ('SPLICER_FIBER', 223, 'HRS', 'SPLICER - FIBER', 'HOUR', 125.0, true),
  ('TERM_PANEL_OSP', 232, 'SPL', 'TERMINATION PANEL - OSP', 'EACH', 112.418, true),
  ('TEST_BARE_13_24', 243, 'SPL', 'TEST FIBER BARE 13-24', 'EACH', 13.04, true),
  ('TEST_BARE_145_288', 245, 'SPL', 'TEST FIBER BARE 145-288', 'EACH', 8.84, true),
  ('TEST_BARE_1_4', 244, 'SPL', 'TEST FIBER BARE 1-4', 'EACH', 16.69, true),
  ('TEST_BARE_25_48', 246, 'SPL', 'TEST FIBER BARE 25-48', 'EACH', 11.04, true),
  ('TEST_BARE_289_432', 247, 'SPL', 'TEST FIBER BARE 289-432', 'EACH', 8.44, true),
  ('TEST_BARE_49_144', 248, 'SPL', 'TEST FIBER BARE 49-144', 'EACH', 10.32, true),
  ('TEST_BARE_5_12', 249, 'SPL', 'TEST FIBER BARE 5-12', 'EACH', 14.84, true),
  ('TEST_BARE_GT_432', 242, 'SPL', 'TEST FIBER BARE > 432', 'EACH', 7.42, true),
  ('TEST_CD_PMD', 250, 'SPL', 'TEST FIBER CD PMD ADDER', 'EACH', 300.0, true),
  ('TEST_OTDR_13_24', 234, 'SPL', 'TEST FIBER - PWR-MTR OTDR 13-24', 'EACH', 21.0, true),
  ('TEST_OTDR_145_288', 236, 'SPL', 'TEST FIBER - PWR-MTR OTDR 145-288', 'EACH', 17.0, true),
  ('TEST_OTDR_1_4', 235, 'SPL', 'TEST FIBER - PWR-MTR OTDR 1-4', 'EACH', 26.0, true),
  ('TEST_OTDR_25_48', 237, 'SPL', 'TEST FIBER - PWR-MTR OTDR 25-48', 'EACH', 20.0, true),
  ('TEST_OTDR_289_432', 238, 'SPL', 'TEST FIBER - PWR-MTR OTDR 289-432', 'EACH', 15.0, true),
  ('TEST_OTDR_49_144', 239, 'SPL', 'TEST FIBER - PWR-MTR OTDR 49-144', 'EACH', 19.0, true),
  ('TEST_OTDR_5_12', 240, 'SPL', 'TEST FIBER - PWR-MTR OTDR 5-12', 'EACH', 23.0, true),
  ('TEST_OTDR_ADDL_WL', 241, 'SPL', 'TEST FIBER ADDL WAVELENGTH ADDER', 'EACH', 4.0, true),
  ('TEST_OTDR_GT_432', 233, 'SPL', 'TEST FIBER - PWR-MTR OTDR > 432', 'EACH', 14.0, true),
  ('TRAY_450B_24', 165, 'MAT', 'FIB TRAY 24 FOSC 450 B', '', 8.66, true),
  ('TRAY_600D_24_RBN', 167, 'MAT', 'FIB TRAY 24 RBN FOSC 600 D', '', 37.616875, true),
  ('TRAY_600D_48', 171, 'MAT', 'FIB TRAY 48 FOSC 600 D', '', 21.3469, true)
on conflict (code) do update set
  unit_no=excluded.unit_no, section=excluded.section, assembly=excluded.assembly,
  uom=excluded.uom, rate=excluded.rate, billable=excluded.billable;

-- ############ VERIFY ############
-- Expect 69:
select count(*) as billable_units from rate_card;
