// Loads a job's full running record from Supabase and shapes it into the
// engine's JobInput. Uses the service-role client (RLS bypassed) so it can read
// every unit regardless of who triggered the invoice.

import { admin } from './supabase.js';
import type { JobInput, VisitInput, LocationInput, StructureType, CaseAction, SpliceType } from '@bm/billing';

export async function loadJobInput(jobId: string): Promise<JobInput> {
  const { data: job, error: jErr } = await admin
    .from('jobs')
    .select('id, bm_number, billing_mode')
    .eq('id', jobId)
    .single();
  if (jErr || !job) throw new Error(`Job not found: ${jobId}`);

  const { data: visits } = await admin
    .from('visits')
    .select('id, visit_date, lead_hours')
    .eq('job_id', jobId)
    .order('visit_date', { ascending: true });

  const visitInputs: VisitInput[] = [];

  for (const v of visits ?? []) {
    const { data: locations } = await admin
      .from('locations')
      .select(`
        id, closure_id, structure_type, hole_ref, gps_lat, gps_lng,
        case_action, new_case_material_code, splice_type, splice_count,
        trays_added, tray_material_code, test_fiber_count, test_type,
        closures ( closure_code )
      `)
      .eq('visit_id', v.id)
      .order('ordinal', { ascending: true });

    const locInputs: LocationInput[] = [];
    for (const l of locations ?? []) {
      // downtime hours at this location
      const { data: dt } = await admin
        .from('downtime').select('hours').eq('location_id', l.id);
      const downtimeHours = (dt ?? []).reduce((s, r: any) => s + Number(r.hours ?? 0), 0);

      // tap-to-add extra units (civil / case work / misc materials)
      const { data: units } = await admin
        .from('location_units').select('unit_code, qty, note').eq('location_id', l.id);
      const extraUnits = (units ?? [])
        .filter((u: any) => !!u.unit_code)
        .map((u: any) => ({ code: u.unit_code as string, qty: Number(u.qty ?? 1), note: u.note ?? undefined }));

      const closureCode = (l as any).closures?.closure_code as string | undefined;

      locInputs.push({
        id: l.id,
        closureCode,
        structureType: l.structure_type as StructureType,
        holeKey: l.hole_ref ?? undefined,
        gpsLat: l.gps_lat != null ? Number(l.gps_lat) : undefined,
        gpsLng: l.gps_lng != null ? Number(l.gps_lng) : undefined,
        caseAction: (l.case_action ?? null) as CaseAction | null,
        newCaseMaterialCode: l.new_case_material_code ?? undefined,
        spliceType: (l.splice_type ?? null) as SpliceType | null,
        spliceCount: Number(l.splice_count ?? 0),
        traysAdded: Number(l.trays_added ?? 0),
        trayMaterialCode: l.tray_material_code ?? undefined,
        testFiberCount: Number(l.test_fiber_count ?? 0),
        testType: (l.test_type ?? 'otdr') as 'otdr' | 'bare',
        downtimeHours,
        extraUnits,
      });
    }

    visitInputs.push({
      id: v.id,
      date: v.visit_date,
      leadHours: v.lead_hours != null ? Number(v.lead_hours) : undefined,
      locations: locInputs,
    });
  }

  return {
    bmNumber: job.bm_number,
    billingMode: (job.billing_mode ?? 'capital') as 'capital' | 'emergency',
    visits: visitInputs,
  };
}
