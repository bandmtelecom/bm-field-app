-- ============================================================================
-- B&M Field App — 0011 the crew belongs to the LOCATION, not the visit
-- Run this in the Supabase SQL editor BEFORE pushing the code. Safe to run twice.
--
-- WHY (26-352, 8/28):
-- On the night of 8/21 four men worked two different holes. Armando and Spencer
-- were in Lumen-0016; Jesus and Josh L were in Lumen-0017. The app stored techs
-- on the VISIT, so the engine had one crew for the whole report and multiplied
-- Lumen-0016's 7.5 downtime hours by everybody who was out that night instead of
-- by the two men actually standing in that hole. Downtime bills per tech, so the
-- crew has to be recorded per hole or the hours cannot come out right.
--
-- Austin, 8/28: "lets put the tech on the location not the summary at the top."
--
-- The visit keeps its `techs` column. Nothing reads it for billing after this
-- migration — it stays as the history of what was filed before 8/28, and the
-- engine falls back to it for any location that has no crew of its own.
-- ============================================================================

alter table locations
  add column if not exists techs text[] not null default '{}';

comment on column locations.techs is
  'The men who worked THIS hole. Downtime bills per tech against this list; travel bills 2 hr for each distinct tech on the job. Falls back to visits.techs when empty (pre-0011 rows).';

-- ---------------------------------------------------------------------------
-- Backfill from the visit, splitting the way the techs actually type.
--
-- `techs.split(',')` in the old form meant "Armando & Josh L" landed as ONE
-- name and billed as one man. Same failure as the number boxes: the app took
-- what was typed literally instead of reading it. Split on & + / "and" as well
-- as commas so history reads right too.
--
-- Only fills locations that have no crew yet, so re-running this never
-- overwrites a name somebody has since corrected by hand.
-- ---------------------------------------------------------------------------
update locations l
set techs = coalesce((
  select array_agg(distinct btrim(n))
  from unnest(v.techs) as t(name),
       regexp_split_to_table(t.name, '\s*(?:,|&|\+|/|\mand\M)\s*') as n
  where btrim(n) <> ''
), '{}')
from visits v
where v.id = l.visit_id
  and coalesce(array_length(l.techs, 1), 0) = 0
  and coalesce(array_length(v.techs, 1), 0) > 0;

-- ---------------------------------------------------------------------------
-- What this did — read it before you close the editor.
-- ---------------------------------------------------------------------------
select
  v.visit_date,
  coalesce(c.closure_code, 'Location ' || coalesce(l.pm_location_no, l.ordinal::text)) as where_,
  array_to_string(v.techs, ' | ')  as visit_said,
  array_to_string(l.techs, ' | ')  as location_now,
  coalesce(array_length(l.techs, 1), 0) as crew
from locations l
  join visits v on v.id = l.visit_id
  join jobs j on j.id = v.job_id
  left join closures c on c.id = l.closure_id
order by v.visit_date, l.ordinal;
