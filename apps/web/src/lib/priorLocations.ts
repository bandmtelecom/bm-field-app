import { supabase } from './supabase';
import type { PriorLocation } from './locationNo';

/**
 * The holes already recorded on a job, offered to a tech as "we've been here
 * before" so a return trip reuses that hole's number instead of starting
 * another Location 1.
 *
 * Only the ORIGINALS are listed. A row that is itself a return trip shares its
 * parent's number, so offering it would be the same hole twice under two names
 * — and the database collapses that chain anyway.
 *
 * The cables come along because they are the only thing that has ever reliably
 * told two holes apart. GPS does not: on 26-359 loc#3 and loc#4 are 32 feet
 * apart and are two different closures. So the list shows the man what was in
 * each hole and lets him decide.
 */
export async function loadPriorLocations(
  jobId: string,
  excludeId?: string | null,
): Promise<PriorLocation[]> {
  const { data, error } = await supabase
    .from('locations')
    .select(`
      id, job_location_no, pm_location_no, closure_id, structure_type, structure_owner,
      gps_lat, gps_lng, revisit_of,
      closures(closure_code),
      cables(direction, count, manufacturer, ordinal),
      visits!inner(visit_date, job_id)
    `)
    .eq('visits.job_id', jobId)
    .is('revisit_of', null);

  // Never swallowed. A failure here means the list comes up empty and a crew
  // quietly files a return trip as a brand new hole — the caller decides what
  // to say about it, but it does not disappear the way the closure errors did.
  if (error) throw error;

  const rows = ((data as any[]) ?? []).filter((r) => r.id !== excludeId);

  return rows
    .map((r: any): PriorLocation => ({
      id: r.id,
      job_location_no: r.job_location_no ?? null,
      pm_location_no: r.pm_location_no ?? null,
      closure_id: r.closure_id ?? null,
      closure_code: r.closures?.closure_code ?? null,
      structure_type: r.structure_type ?? null,
      structure_owner: r.structure_owner ?? null,
      gps_lat: r.gps_lat != null ? Number(r.gps_lat) : null,
      gps_lng: r.gps_lng != null ? Number(r.gps_lng) : null,
      visit_date: r.visits?.visit_date ?? null,
      cables: [...((r.cables as any[]) ?? [])]
        .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
        .map((c) => [c.direction, c.count, c.manufacturer].filter(Boolean).join(' ').trim())
        .filter(Boolean)
        .slice(0, 4),
    }))
    .sort((a, b) => (a.job_location_no ?? 9e9) - (b.job_location_no ?? 9e9));
}
