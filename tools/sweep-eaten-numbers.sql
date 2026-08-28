-- =====================================================================
--  v0.4.9 SWEEP — find values the old number parser ate
--  READ ONLY. This SELECTs and nothing else. It changes no data.
--  Paste the whole thing into the Supabase SQL editor and press Run.
-- =====================================================================
--  Before v0.4.9, anything typed next to a number ("3 hrs", "48 splices",
--  "0.2 km") became NaN. NaN saved as NULL on distance/footage columns and
--  as 0 on the billing counters. Nothing errored, so the only trace left is
--  a blank or a zero where the tech clearly did work.
--
--  Nothing below is proof on its own — read the narrative column. That is
--  where the real value usually still is.
-- =====================================================================

with suspects as (

  -- 1. MONEY. A downtime row exists (someone typed a reason) but hours = 0.
  --    Downtime bills per tech per hour, so a zero here is money off an invoice.
  select 1 as severity,
         'DOWNTIME 0 hrs'                     as problem,
         coalesce(nullif(d.reason,''),'(no reason)') as detail,
         j.bm_number, j.status, v.visit_date, v.techs,
         c.closure_code, l.pm_location_no, l.ordinal + 1 as loc_no,
         left(coalesce(nullif(l.narrative,''), v.narrative, ''), 160) as narrative
    from downtime d
    join locations l on l.id = d.location_id
    join visits    v on v.id = l.visit_id
    join jobs      j on j.id = v.job_id
    left join closures c on c.id = l.closure_id
   where coalesce(d.hours,0) = 0

  union all

  -- 2. MONEY. Splice type chosen but the count came out 0.
  select 2, 'SPLICE COUNT 0',
         l.splice_type || ' splices, count 0',
         j.bm_number, j.status, v.visit_date, v.techs,
         c.closure_code, l.pm_location_no, l.ordinal + 1,
         left(coalesce(nullif(l.narrative,''), v.narrative, ''), 160)
    from locations l
    join visits v on v.id = l.visit_id
    join jobs   j on j.id = v.job_id
    left join closures c on c.id = l.closure_id
   where l.splice_type is not null
     and coalesce(l.splice_count,0) = 0

  union all

  -- 3. MONEY. A tray material was inferred but trays_added is 0.
  --    (trays bill unit 1 + unit 173 each, so a zero drops both lines)
  select 3, 'TRAYS 0 but tray material set',
         l.tray_material_code,
         j.bm_number, j.status, v.visit_date, v.techs,
         c.closure_code, l.pm_location_no, l.ordinal + 1,
         left(coalesce(nullif(l.narrative,''), v.narrative, ''), 160)
    from locations l
    join visits v on v.id = l.visit_id
    join jobs   j on j.id = v.job_id
    left join closures c on c.id = l.closure_id
   where l.tray_material_code is not null
     and coalesce(l.trays_added,0) = 0

  union all

  -- 4. RECORD. An OTDR shot row with everything filled in except the distance.
  --    This is the one caught on video on 26-342.
  select 4, 'OTDR SHOT, no distance',
         concat_ws(' / ', nullif(s.fiber_group,''), nullif(s.direction,''), nullif(s.event,'')),
         j.bm_number, j.status, v.visit_date, v.techs,
         c.closure_code, l.pm_location_no, l.ordinal + 1,
         left(coalesce(nullif(l.narrative,''), v.narrative, ''), 160)
    from shots s
    join locations l on l.id = s.location_id
    join visits    v on v.id = l.visit_id
    join jobs      j on j.id = v.job_id
    left join closures c on c.id = l.closure_id
   where s.distance_km is null
     and coalesce(nullif(s.fiber_group,''), nullif(s.direction,''), nullif(s.event,'')) is not null

  union all

  -- 5. RECORD. A cable row with no footage. Only rows before 8/25 matter —
  --    since then footage is part of the free-text cable line and is not written.
  select 5, 'CABLE, no footage (pre-8/25 only)',
         concat_ws(' ', nullif(cb.count,''), nullif(cb.manufacturer,''), nullif(cb.date_code,'')),
         j.bm_number, j.status, v.visit_date, v.techs,
         c.closure_code, l.pm_location_no, l.ordinal + 1,
         left(coalesce(nullif(l.narrative,''), v.narrative, ''), 160)
    from cables cb
    join locations l on l.id = cb.location_id
    join visits    v on v.id = l.visit_id
    join jobs      j on j.id = v.job_id
    left join closures c on c.id = l.closure_id
   where cb.footage is null
     and v.visit_date < date '2026-08-25'
     and coalesce(nullif(cb.count,''), nullif(cb.manufacturer,'')) is not null

  union all

  -- 6. RECORD ONLY, never bills. Hours-on-site blank on a visit that has work.
  select 6, 'HOURS ON SITE blank (record only)',
         v.report_type,
         j.bm_number, j.status, v.visit_date, v.techs,
         null, null, null,
         left(coalesce(v.narrative,''), 160)
    from visits v
    join jobs   j on j.id = v.job_id
   where v.lead_hours is null
     and exists (select 1 from locations l where l.visit_id = v.id)
)

select severity,
       problem,
       detail,
       bm_number  as job,
       status     as job_status,
       visit_date,
       array_to_string(techs, ', ') as techs,
       closure_code,
       loc_no,
       pm_location_no,
       narrative
  from suspects
 order by severity, visit_date desc, bm_number, loc_no;
