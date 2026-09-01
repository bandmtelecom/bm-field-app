-- ============================================================================
-- B&M Field App — 0013 ONE location number, and it is the tech's
-- Run this in the Supabase SQL editor BEFORE pushing the code. Safe to run twice.
--
-- WHY (Austin, 9/1, looking at the form and the 26-349 report):
--   "where it automatically puts location 1 in bold uptop because its the first
--    site we work on this one. we need to get rid of the automatic location
--    number. the only location number that goes on the report should be what the
--    tech puts in."
--   "I only want the location 5 or generate the next number in line. if the tech
--    does not put one the app just needs to assign the next number. we need to
--    make sure we can edit that number after the tech leaves. so if i catch
--    something looking off i can change it from the office."
--
-- 0012 gave every location a B&M number of its own, which fixed four crews all
-- calling their hole "1". But it left TWO numbers on the page — B&M's in bold
-- and the tech's underneath — and the customer does not care about ours. So
-- there is one number now and it lives where the tech types:
--
--   pm_location_no    THE location number. What the tech typed, or the next one
--                     in line when he left it blank. Editable by the office.
--   job_location_no   internal bookkeeping only. Nothing shows it any more; it
--                     still backs the return-trip machinery. Not dropped —
--                     dropping a column that four other things read is how you
--                     turn a display change into an outage.
--
-- "The next one in line" counts only the entries on THIS job whose number is a
-- plain integer. The techs also type "1950 Stemmons", "West", "1a", "Location 2"
-- and "2112 California Ave, OKC" into that box, and those are names, not places
-- in a sequence — they are left exactly as typed and never counted.
--
-- ⚠️ NOTHING HERE TOUCHES BILLING. The number is a label; the engine bills per
-- location row and never reads one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) the next number in line, for one job
--
-- Table-qualified throughout — an unqualified column reference inside a
-- `returns` function is what left the closure registry empty for eight days.
-- ---------------------------------------------------------------------------
create or replace function bm_next_pm_location_no(p_visit uuid)
returns text
language plpgsql
stable
as $$
declare
  v_job uuid;
  v_max int;
begin
  select v.job_id into v_job from visits v where v.id = p_visit;
  if v_job is null then
    return '1';
  end if;

  -- Only plain integers take part. "1950 Stemmons" is a building, not a
  -- position in a sequence, and must not push the count to 1951.
  select coalesce(max((btrim(l.pm_location_no))::int), 0) into v_max
  from locations l
    join visits v2 on v2.id = l.visit_id
  where v2.job_id = v_job
    and l.pm_location_no ~ '^\s*\d+\s*$';

  return (v_max + 1)::text;
end;
$$;

comment on function bm_next_pm_location_no(uuid) is
  'The next whole number in line on this visit''s job, counting only location numbers that are plain integers. Read-only — the trigger assigns.';

-- ---------------------------------------------------------------------------
-- 2) the assign trigger, rewritten
--
-- Same job_location_no rules as 0012 (they still drive return trips), plus the
-- new part: a blank location number gets filled in.
--
-- On a return trip the number comes from the hole being returned to, so a
-- second visit to Lumen-0016 reads as the same location on the report instead
-- of as a new one. That was the whole point of 0012 and it survives here.
-- ---------------------------------------------------------------------------
create or replace function bm_assign_job_location_no()
returns trigger
language plpgsql
as $$
declare
  v_job    uuid;
  v_root   uuid;
  v_no     int;
  v_pm     text;
  v_skip   boolean := false;
begin
  -- A row can never be a revisit of itself.
  if new.revisit_of is not null and new.revisit_of = new.id then
    new.revisit_of := null;
  end if;

  -- ---- B&M's internal number (unchanged from 0012) ------------------------
  if tg_op = 'UPDATE'
     and new.revisit_of is not distinct from old.revisit_of
     and new.job_location_no is not null then
    v_skip := true;                    -- an ordinary edit never moves it
  end if;

  if not v_skip then
    if new.revisit_of is not null then
      -- Chains collapse: a revisit of a revisit is a revisit of the original.
      select coalesce(l.revisit_of, l.id), l.job_location_no
        into v_root, v_no
        from locations l
       where l.id = new.revisit_of;

      if v_root is null then
        raise exception 'revisit_of points at a location that does not exist (%)', new.revisit_of
          using hint = 'Pick the earlier location from the list, or leave it blank for a new one.';
      end if;

      if v_no is null then
        select coalesce(l2.job_location_no, 1) into v_no
          from locations l2 where l2.id = v_root;
        update locations l3 set job_location_no = v_no where l3.id = v_root;
      end if;

      new.revisit_of := v_root;
      new.job_location_no := v_no;
    else
      -- The office just said "no, that was its own hole" — give up the shared
      -- number and take a fresh one.
      if tg_op = 'UPDATE' and old.revisit_of is not null then
        new.job_location_no := null;
      end if;

      if new.job_location_no is null then
        select v.job_id into v_job from visits v where v.id = new.visit_id;
        if v_job is not null then
          perform pg_advisory_xact_lock(hashtext('bm_job_location_no'), hashtext(v_job::text));
        end if;
        new.job_location_no := bm_next_job_location_no(new.visit_id);
      end if;
    end if;
  end if;

  -- ---- THE location number: the tech's box --------------------------------
  -- Whatever he typed stands, always. Blank is the only case the app fills, and
  -- what it fills is editable afterwards like any other typed value.
  if coalesce(btrim(new.pm_location_no), '') = '' then

    -- Back in a hole already on this job? Then it is that hole's number. Only
    -- when the earlier entry actually has one — a blank does not travel.
    if new.revisit_of is not null then
      select nullif(btrim(l4.pm_location_no), '') into v_pm
        from locations l4 where l4.id = new.revisit_of;
    end if;

    if v_pm is null then
      select v.job_id into v_job from visits v where v.id = new.visit_id;
      if v_job is not null then
        -- Same lock as above, so two crews filing at 2am cannot both take 6.
        perform pg_advisory_xact_lock(hashtext('bm_job_location_no'), hashtext(v_job::text));
      end if;
      v_pm := bm_next_pm_location_no(new.visit_id);
    end if;

    new.pm_location_no := v_pm;
  end if;

  return new;
end;
$$;

-- the triggers themselves are unchanged from 0012; re-created so this file
-- stands on its own if anyone runs it against a fresh database
drop trigger if exists trg_job_location_no on locations;
create trigger trg_job_location_no
  before insert or update on locations
  for each row execute function bm_assign_job_location_no();

-- ---------------------------------------------------------------------------
-- 3) backfill the blanks
--
-- Reports filed before today show B&M's number in bold. After the code change
-- the tech's box is the only thing on the page, so a location with an empty box
-- would lose the number it has been showing all along. Give those rows the
-- number they were already displaying.
--
-- Rows where the tech DID type something are not touched — not the "1"s on
-- 26-349, not "1950 Stemmons", not "West". What he typed is what he meant.
-- Only touches blanks, so it is safe to run twice.
-- ---------------------------------------------------------------------------
update locations l
   set pm_location_no = l.job_location_no::text
 where coalesce(btrim(l.pm_location_no), '') = ''
   and l.job_location_no is not null;

-- ---------------------------------------------------------------------------
-- 4) What this did — read it before you close the editor.
--
-- `number` is what the customer will now see in bold. Look for two rows on one
-- job carrying the same number where `revisit` is blank: that is two different
-- holes both called the same thing, and it is fixable from the office by
-- opening the location and typing a different number.
--
-- 26-349 is the known one. Its four crews each typed 1, 2, 1, 2 on the night of
-- 8/17 — genuinely what they wrote down, so the app leaves it alone.
-- ---------------------------------------------------------------------------
select
  j.bm_number,
  v.visit_date,
  coalesce(l.pm_location_no, '—')                     as number,
  case when l.revisit_of is not null then 'revisit' else '' end as revisit,
  coalesce(c.closure_code, '—')                       as closure,
  coalesce(l.structure_type, '—')                     as structure,
  coalesce(l.gps_lat::text || ', ' || l.gps_lng::text, 'no gps') as gps
from locations l
  join visits v on v.id = l.visit_id
  join jobs   j on j.id = v.job_id
  left join closures c on c.id = l.closure_id
order by j.bm_number, v.visit_date, v.created_at, l.ordinal;
