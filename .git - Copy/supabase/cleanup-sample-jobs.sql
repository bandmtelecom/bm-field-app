-- ============================================================================
-- B&M Field App — remove the sample jobs 26-408 and 26-298
--
-- Run this in the Supabase SQL editor. Run the STEP 1 preview first and read
-- what it says before running STEP 2. Deleting a job cascades to its visits,
-- locations, splices/cables/shots/downtime, attachments and invoice drafts.
--
-- Real jobs are NOT touched — everything here is keyed to those two B&M numbers.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — preview. Highlight this block and Run. Nothing is deleted.
-- ---------------------------------------------------------------------------
select
  j.bm_number,
  j.status,
  (select count(*) from visits v where v.job_id = j.id)                        as visits,
  (select count(*) from locations l
     join visits v on v.id = l.visit_id where v.job_id = j.id)                 as locations,
  (select count(*) from invoice_drafts d where d.job_id = j.id)                as invoice_drafts
from jobs j
where j.bm_number in ('26-408', '26-298');

-- ---------------------------------------------------------------------------
-- STEP 2 — delete. Highlight this block and Run.
-- ---------------------------------------------------------------------------
delete from jobs where bm_number in ('26-408', '26-298');

-- ---------------------------------------------------------------------------
-- STEP 3 — OPTIONAL: closures left behind by those samples.
--
-- Closures are the permanent company-wide registry (they feed the KML map), so
-- deleting a job does NOT delete them. Any closure the sample jobs invented is
-- now orphaned — no location anywhere points at it — and would still show as a
-- pin on the map.
--
-- 3a) Look at them first. If you recognise any as a REAL closure you want to
--     keep on the map, stop here and leave them alone.
-- ---------------------------------------------------------------------------
select c.closure_code, c.structure_type, c.gps_lat, c.gps_lng, c.created_at
from closures c
where not exists (select 1 from locations l where l.closure_id = c.id)
order by c.created_at;

-- 3b) Only if step 3a showed nothing you want to keep:
-- delete from closures c
-- where not exists (select 1 from locations l where l.closure_id = c.id);
