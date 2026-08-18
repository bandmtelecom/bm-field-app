-- ============================================================================
-- B&M Field App — 0004 maintenance-window flag on jobs
-- Run this in the Supabase SQL editor (safe to run twice).
--
-- Scheduled night work (a maintenance window) adds a per-splice adder:
--   unit 203 SPLICE FIBER - MAINT WINDOW ADDER   $6.50 each  (single fusion)
--   unit 215 SPLICE FIBER RIBBONS - MAINT ADDER  $24.00 each (ribbon)
--
-- This is a JOB-level flag, set when the job is created (Admin → Create job).
-- It only affects capital jobs: emergency/LOR bills hourly and never produces
-- splice lines, so a LOR worked at night cannot pick up the adder.
-- ============================================================================

alter table jobs
  add column if not exists maint_window boolean not null default false;

comment on column jobs.maint_window is
  'Scheduled maintenance window (night work). Adds FUSION_MAINT_ADDER / RIBBON_MAINT_ADDER per splice on capital jobs. Never applies to emergency/LOR.';
