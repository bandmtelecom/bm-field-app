-- ============================================================================
-- B&M Field App — 0012 locations are numbered ACROSS THE JOB, not per visit
-- Run this in the Supabase SQL editor BEFORE pushing the code. Safe to run twice.
--
-- WHY (26-349, the Lumen report for 5303 N Interstate):
-- Four visits on the night of 8/17, four different holes, and the customer's
-- report labelled them 1, 2, 1, 2. Two blocks headed "Location 1" that are
-- 1.6 miles apart.
--
-- The heading came from `pm_location_no` — a free-text box each tech types —
-- and fell back to the location's position WITHIN THAT VISIT when the box was
-- empty. Both restart at 1 every time a crew files a report, so a number never
-- meant anything job-wide. When four crews work one ticket in a night, four of
-- them type "1".
--
-- Austin, 8/31: "we need to make sure we dont have multiple location 1s unless
-- we revisit that location."
--
-- After this migration the number belongs to the JOB and the database hands it
-- out, so it cannot collide:
--
--   job_location_no  1, 2, 3, 4 … in the order the holes first appear
--   revisit_of       set when a crew goes back to a hole already on this job;
--                    that entry REUSES the earlier hole's number
--
-- The tech's typed number is not thrown away. It stays in `pm_location_no` and
-- moves to the small grey line on the report as the customer's own location
-- number, where it can no longer collide with B&M's count.
--
-- ⚠️ NOTHING HERE TOUCHES BILLING. The invoice is built per location ROW; the
-- number is a label. A revisit is still its own row on its own visit, so it
-- still earns its own setup/teardown — the crew did drive out and set up again.
-- Run the billing suite after this and the dollars do not move.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) the two columns
-- ---------------------------------------------------------------------------
alter table locations
  add column if not exists job_location_no int;

alter table locations
  add column if not exists revisit_of uuid references locations(id) on delete set null;

comment on column locations.job_location_no is
  'B&M''s location number for this JOB — 1, 2, 3 … handed out by trg_job_location_no in the order holes first appear. Two entries share a number only when the later one is a revisit. Display only; nothing bills off it.';

comment on column locations.revisit_of is
  'The earlier location on this same job that this entry is a return trip to. NULL = first time in this hole. Set it and the row takes that hole''s job_location_no.';

comment on column locations.pm_location_no is
  'The CUSTOMER''s own location number, as the tech typed it. Free text, may repeat, may be blank. B&M''s number is job_location_no.';

create index if not exists locations_revisit_of_idx on locations (revisit_of);

-- ---------------------------------------------------------------------------
-- 2) handing out the number
--
-- This is deliberately the database's job and not the app's. Two crews filing
-- reports on the same ticket at 2am is a normal night here, and two browsers
-- both reading "the highest number so far" would both write the same one. The
-- advisory lock is per job, held to the end of the transaction, so the second
-- insert waits and gets the next number instead of a duplicate.
--
-- ⚠️ Every column reference inside is table-qualified. An unqualified `seq` and
-- `code` inside `next_closure_code` raised 42702 on every call and left the
-- closure registry empty for eight days with nothing on screen looking wrong.
-- ---------------------------------------------------------------------------
create or replace function bm_next_job_location_no(p_visit uuid)
returns int
language plpgsql
stable
as $$
declare
  v_job uuid;
  v_max int;
begin
  select v.job_id into v_job from visits v where v.id = p_visit;
  if v_job is null then
    return 1;                       -- no visit yet; the insert will fail anyway
  end if;

  select coalesce(max(l.job_location_no), 0) into v_max
  from locations l
    join visits v2 on v2.id = l.visit_id
  where v2.job_id = v_job;

  return v_max + 1;
end;
$$;

comment on function bm_next_job_location_no(uuid) is
  'The next unused B&M location number on the job this visit belongs to. Read-only — the trigger is what assigns.';

create or replace function bm_assign_job_location_no()
returns trigger
language plpgsql
as $$
declare
  v_job    uuid;
  v_root   uuid;
  v_no     int;
begin
  -- A row can never be a revisit of itself.
  if new.revisit_of is not null and new.revisit_of = new.id then
    new.revisit_of := null;
  end if;

  -- On UPDATE, only a change to revisit_of re-opens the question. Otherwise the
  -- number the row already has is left exactly as it is — a number the crew has
  -- quoted must not move under them.
  if tg_op = 'UPDATE'
     and new.revisit_of is not distinct from old.revisit_of
     and new.job_location_no is not null then
    return new;
  end if;

  -- Chains collapse: a revisit of a revisit is a revisit of the original hole,
  -- so there is only ever one row per number that owns it.
  if new.revisit_of is not null then
    select coalesce(l.revisit_of, l.id), l.job_location_no
      into v_root, v_no
      from locations l
     where l.id = new.revisit_of;

    if v_root is null then
      raise exception 'revisit_of points at a location that does not exist (%)', new.revisit_of
        using hint = 'Pick the earlier location from the list, or leave it blank for a new one.';
    end if;

    if v_no is null then
      -- the target predates this migration and was never numbered; number it now
      select coalesce(l2.job_location_no, bm_next_job_location_no(l2.visit_id))
        into v_no from locations l2 where l2.id = v_root;
      update locations l3 set job_location_no = v_no where l3.id = v_root;
    end if;

    new.revisit_of := v_root;
    new.job_location_no := v_no;
    return new;
  end if;

  -- Not a revisit. If the office just cleared revisit_of — "this was NOT a
  -- return trip, it is its own hole" — the row must give up the number it was
  -- sharing and take a fresh one at the end of the job.
  if tg_op = 'UPDATE' and old.revisit_of is not null then
    new.job_location_no := null;
  end if;

  -- Keep an explicit number if one was handed in (the backfill below does
  -- that); otherwise take the next one on the job.
  if new.job_location_no is null then
    select v.job_id into v_job from visits v where v.id = new.visit_id;
    if v_job is not null then
      perform pg_advisory_xact_lock(hashtext('bm_job_location_no'), hashtext(v_job::text));
    end if;
    new.job_location_no := bm_next_job_location_no(new.visit_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_job_location_no on locations;
create trigger trg_job_location_no
  before insert or update on locations
  for each row execute function bm_assign_job_location_no();

-- If a row that OTHER visits were recorded as returning to becomes a revisit
-- itself, those return trips have to follow it. Otherwise they keep a number
-- whose owner has moved and two different holes end up sharing it — the exact
-- thing this migration exists to stop. Chains are only ever one deep (they
-- collapse above), so this does not cascade further.
create or replace function bm_repoint_revisit_children()
returns trigger
language plpgsql
as $$
begin
  if new.revisit_of is distinct from old.revisit_of and new.revisit_of is not null then
    update locations l
       set revisit_of = new.revisit_of
     where l.revisit_of = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_repoint_revisit_children on locations;
create trigger trg_repoint_revisit_children
  after update on locations
  for each row execute function bm_repoint_revisit_children();

-- ---------------------------------------------------------------------------
-- 3) backfill every location already filed
--
-- Numbered in the order the holes were actually worked: visit date, then the
-- order the report was filed, then the order the locations sit in that report.
--
-- Two entries on one job collapse to one number ONLY when they carry the same
-- closure_id. That is the one signal that has ever been proven to identify a
-- hole. GPS is NOT used here and never should be: on 26-359 loc#3 and loc#4 are
-- 32 feet apart and are two different closures in two different holes — Austin
-- checked with the techs. A revisit that predates the closure registry stays as
-- its own number until somebody who was there says otherwise, which is exactly
-- the right way round: a wrong split is visible on the report and fixable in one
-- click; a wrong merge quietly hides a hole.
--
-- Only touches rows that have no number yet, so re-running never renumbers
-- anything and never overwrites a correction made by hand.
-- ---------------------------------------------------------------------------
do $$
declare
  r        record;
  v_job    uuid := null;
  v_next   int  := 0;
  v_hit_id uuid;
  v_hit_no int;
begin
  for r in
    select l.id, l.closure_id, v.job_id
    from locations l
      join visits v on v.id = l.visit_id
    where l.job_location_no is null
    order by v.job_id, v.visit_date, v.created_at, l.ordinal, l.created_at
  loop
    if v_job is distinct from r.job_id then
      v_job := r.job_id;
      select coalesce(max(l2.job_location_no), 0) into v_next
      from locations l2
        join visits v2 on v2.id = l2.visit_id
      where v2.job_id = r.job_id;
    end if;

    v_hit_id := null;
    v_hit_no := null;

    if r.closure_id is not null then
      select l3.id, l3.job_location_no into v_hit_id, v_hit_no
      from locations l3
        join visits v3 on v3.id = l3.visit_id
      where v3.job_id = r.job_id
        and l3.closure_id = r.closure_id
        and l3.job_location_no is not null
        and l3.revisit_of is null
        and l3.id <> r.id
      order by l3.job_location_no
      limit 1;
    end if;

    if v_hit_id is not null then
      update locations l4
         set job_location_no = v_hit_no, revisit_of = v_hit_id
       where l4.id = r.id;
    else
      v_next := v_next + 1;
      update locations l5 set job_location_no = v_next where l5.id = r.id;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) What this did — read it before you close the editor.
--
-- Every row of one job should read 1, 2, 3, 4 … with a number repeating only
-- where `revisit` says yes. If two rows share a number and neither says revisit,
-- something is wrong — say so before pushing the code.
-- ---------------------------------------------------------------------------
select
  j.bm_number,
  v.visit_date,
  l.job_location_no                                   as bm_no,
  case when l.revisit_of is not null then 'revisit' else '' end as revisit,
  coalesce(c.closure_code, '—')                       as closure,
  coalesce(l.pm_location_no, '—')                     as customer_no,
  coalesce(l.structure_type, '—')                     as structure,
  coalesce(l.gps_lat::text || ', ' || l.gps_lng::text, 'no gps') as gps
from locations l
  join visits v on v.id = l.visit_id
  join jobs   j on j.id = v.job_id
  left join closures c on c.id = l.closure_id
order by j.bm_number, v.visit_date, v.created_at, l.ordinal;
