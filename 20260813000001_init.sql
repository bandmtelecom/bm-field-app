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
