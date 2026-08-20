-- ============================================================================
-- B&M Field App — 0006 let the crew fix their own reports
-- Run this in the Supabase SQL editor (safe to run twice).
--
-- Editing a location means replacing its detail rows (cables, shots, panel
-- ports, downtime, tap-to-add units). Deleting those was office/admin only, so
-- a tech who forgot a cable could not go back and add it.
--
-- This loosens DELETE on those five CHILD tables to any active user. It does
-- NOT touch jobs, visits, locations, closures or customers — deleting those is
-- still office/admin only, so nobody can wipe a job or a visit from the field.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'cables','shots','panel_ports','downtime','location_units'
  ] loop
    execute format('drop policy if exists %I_delete on %I;', t, t);
    execute format(
      'create policy %I_delete on %I for delete using (is_active_user());', t, t);
  end loop;
end $$;

comment on table cables is
  'Cable inventory per location. Active users may delete their own rows so a report can be corrected in the field (migration 0006).';
