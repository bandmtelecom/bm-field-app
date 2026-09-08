-- ============================================================================
-- B&M Field App — 0014 one visit, many techs
-- Run this in the Supabase SQL editor BEFORE pushing the code. Safe to run twice.
--
-- WHY (Austin, 9/8):
-- "im wanting to have the lead tech start the visit on a job. and we need to
--  make it available to have multiple techs work on the same visit. so if
--  armando starts a visit and josh l is working that same job on a different
--  location we need to make it where josh l can add a location to armandos
--  visit."
--
-- Until now a visit only existed once ONE man hit Submit with every location he
-- knew about. A second crew on the same night had to file a second visit, so
-- one night's work showed up as two reports.
--
-- After this:
--   * the lead tech STARTS the visit (status = 'open', reporter_id = him)
--   * any tech on the job adds locations onto that open visit
--   * the lead (or the office) FINISHES it — summary, status, hours — and it
--     closes. It stays open across midnight until somebody finishes it; night
--     work crosses dates all the time.
--
-- Nothing here moves a dollar. The engine bills per LOCATION (crew, downtime,
-- units) and travel once per man per job — where a location hangs makes no
-- difference to the invoice. This is about the report reading as one night.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) open / closed
-- Every visit filed before today was filed in one shot, so it is closed.
-- ---------------------------------------------------------------------------
alter table visits
  add column if not exists status text not null default 'closed';

do $$ begin
  alter table visits add constraint visits_status_check
    check (status in ('open','closed'));
exception when duplicate_object then null; end $$;

alter table visits
  add column if not exists closed_by uuid references profiles(id);

comment on column visits.status is
  'open = the lead started it and techs can still add locations; closed = the lead or office finished it (migration 0014).';
comment on column visits.reporter_id is
  'The LEAD — the man who started the visit. Only he (or the office) can finish or fix it.';
comment on column visits.lead_start is 'When the lead tapped Start (0014). Job timing, not payroll.';
comment on column visits.lead_finish is 'When the visit was finished (0014).';

create index if not exists idx_visits_open on visits(job_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- 2) the visit's crew list is now kept by the database
--
-- The visit's `techs` is the union of its locations' crews — the running record
-- and the field-report header read it. Until now the form computed it and
-- wrote it back. With three phones adding locations to one visit that is a
-- race, and with the tighter update rule below a second man could not write it
-- at all. So a trigger keeps it right. Nothing bills off it.
-- ---------------------------------------------------------------------------
create or replace function bm_sync_visit_techs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit uuid;
begin
  v_visit := coalesce(new.visit_id, old.visit_id);
  update visits v
     set techs = coalesce((
       select array_agg(t.name order by t.name)
         from (
           select distinct on (lower(btrim(u.name))) btrim(u.name) as name
             from locations l2
             cross join lateral unnest(l2.techs) as u(name)
            where l2.visit_id = v_visit
              and btrim(u.name) <> ''
            order by lower(btrim(u.name)), l2.ordinal, l2.created_at
         ) t
     ), '{}')
   where v.id = v_visit;
  -- a location moved between visits (office fix): refresh the one it left too
  if tg_op = 'UPDATE' and old.visit_id is distinct from new.visit_id then
    update visits v
       set techs = coalesce((
         select array_agg(t.name order by t.name)
           from (
             select distinct on (lower(btrim(u.name))) btrim(u.name) as name
               from locations l2
               cross join lateral unnest(l2.techs) as u(name)
              where l2.visit_id = old.visit_id
                and btrim(u.name) <> ''
              order by lower(btrim(u.name)), l2.ordinal, l2.created_at
           ) t
       ), '{}')
     where v.id = old.visit_id;
  end if;
  return null;
end;
$$;

comment on function bm_sync_visit_techs() is
  'Keeps visits.techs = the distinct crew across that visit''s locations (case-insensitive). Display only; the engine bills off locations.techs.';

drop trigger if exists trg_sync_visit_techs on locations;
create trigger trg_sync_visit_techs
  after insert or update of techs, visit_id or delete on locations
  for each row execute function bm_sync_visit_techs();

-- ---------------------------------------------------------------------------
-- 3) who may change the visit row
--
-- Any active user could update any visit. Now: the lead who started it, or the
-- office. Other techs put their work on LOCATIONS, which they can still add and
-- edit exactly as before. The trigger above is security definer, so a second
-- man's location still refreshes the crew list.
-- ---------------------------------------------------------------------------
drop policy if exists visits_update on visits;
create policy visits_update on visits for update
  using (is_active_user() and (is_office() or reporter_id = auth.uid()))
  with check (is_active_user() and (is_office() or reporter_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 4) techs can read each other's names
--
-- "Add my location" says whose visit it is going on — "the visit Armando
-- started". Until now a tech could read only his own profile row, so a second
-- man saw a blank where the lead's name should be. Names only matter here;
-- nothing else on a profile is secret in a ten-man shop.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_crew on profiles;
create policy profiles_select_crew on profiles for select
  using (is_active_user());

-- ---------------------------------------------------------------------------
-- 5) the second man's location still saves after the lead has finished.
--
-- Deliberately NO block on inserting into a closed visit. A man who spent
-- twenty minutes typing a report in a manhole must not lose it because the
-- lead tapped Finish a minute earlier. The app tells him it happened; the
-- office sees the location on the running record either way.
-- ---------------------------------------------------------------------------

-- Verification — expect every existing visit closed, 0 open:
--   select status, count(*) from visits group by status;
-- and a quick look at the trigger keeping the crew right:
--   select v.id, v.techs, (select array_agg(distinct t) from locations l, unnest(l.techs) t where l.visit_id = v.id) as from_locations
--   from visits v order by v.created_at desc limit 5;
