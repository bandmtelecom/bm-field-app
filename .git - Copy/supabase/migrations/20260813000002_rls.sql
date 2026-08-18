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
