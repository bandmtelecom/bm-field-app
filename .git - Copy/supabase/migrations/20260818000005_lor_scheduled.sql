-- ============================================================================
-- B&M Field App — 0005 scheduled-ahead flag on LOR/emergency jobs
-- Run this in the Supabase SQL editor (safe to run twice).
--
-- Drive time (unit 223 SPLICER - FIBER, 1 hr out + 1 hr back per tech per trip)
-- is only earned when B&M rolls out on the call. If the customer's tech asks us
-- to schedule it a day or two out, no travel hours are billed.
--
-- Downtime on site still bills under unit 223 either way — this flag only kills
-- the travel hours. It has no effect on capital jobs.
-- ============================================================================

alter table jobs
  add column if not exists scheduled_ahead boolean not null default false;

comment on column jobs.scheduled_ahead is
  'LOR/emergency that was scheduled ahead instead of rolled out on. Suppresses the unit 223 travel hours; downtime still bills under 223. Ignored on capital jobs.';
