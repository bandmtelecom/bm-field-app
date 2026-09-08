import { supabase } from './supabase';
import { uploadAttachment } from './attachments';
import { inferTrayMaterial, type LocationForm } from '../components/LocationBlock';
import { numOrNull, numOr0, splitNames } from './num';

/**
 * Save ONE location onto a visit — the closure registry row when it earns one,
 * the location itself, its detail rows, then the photos.
 *
 * This used to live inside the one-shot "Add my visit" form, which saved the
 * visit and every location in a single go. Since 0014 the visit is started
 * first and each man adds his own locations onto it, one at a time, so the
 * per-location save is its own thing and there is exactly one copy of it.
 *
 * The ORDER is the point:
 *   1. closure  — may fail; the location still saves, the failure is reported
 *   2. location — must succeed or nothing else happens
 *   3. children — shots, cables, ports, downtime, extras
 *   4. photos   — last and sequential, because uploading from a manhole on two
 *                 bars is the least reliable thing this app does, and a failed
 *                 photo must never cost the report
 *
 * Returns the new row's id and a list of what did NOT finish, in plain words.
 * The caller shows the list; it never throws for a closure or a photo.
 */
export interface SaveLocationArgs {
  jobId: string;
  visitId: string;
  customerId: string | null;
  userId: string | null;
  form: LocationForm;
  /** How this location is named in a warning ("Location 3"). */
  label: string;
  /** Position within the visit. The database numbers the location itself. */
  ordinal: number;
}

export interface SaveLocationResult {
  locationId: string;
  warnings: string[];
}

export async function saveLocation(a: SaveLocationArgs): Promise<SaveLocationResult> {
  const { jobId, visitId, customerId, userId, form: L, label, ordinal } = a;
  const warnings: string[] = [];

  // AUSTIN'S RULE (8/25): cables recorded = a closure. No cables means the crew
  // opened the hole to look at what is in it, which is a billable manhole or
  // handhole entry and nothing more. GPS alone never mints a closure.
  const hasCables = L.cables.some(
    (c) => (c.count || '').trim() || (c.direction || '').trim() || (c.manufacturer || '').trim(),
  );

  let closureId: string | null = L.closure_id;
  if (!closureId && hasCables && customerId) {
    // NEVER swallow these errors. For eight days `next_closure_code` threw on
    // every call, both errors were destructured away, and every location saved
    // with closure_id null — 33 locations, 0 closures, nothing on screen wrong.
    try {
      const { data: cc, error: rpcErr } = await supabase
        .rpc('next_closure_code', { p_customer: customerId });
      if (rpcErr) throw rpcErr;
      const code = Array.isArray(cc) ? cc[0]?.code : (cc as any)?.code;
      const seq = Array.isArray(cc) ? cc[0]?.seq : (cc as any)?.seq;
      if (!code || seq == null) throw new Error('the database returned no closure code');

      const { data: closure, error: cErr } = await supabase.from('closures').insert({
        customer_id: customerId, seq, closure_code: code,
        gps_lat: numOrNull(L.gps_lat), gps_lng: numOrNull(L.gps_lng),
        structure_type: L.structure_type, structure_owner: L.structure_owner || null,
        building_address: L.building_address || null, enclosure_model: L.enclosure_model || null,
        created_by: userId,
      }).select('id').single();
      if (cErr || !closure) throw cErr ?? new Error('the closure row would not save');
      closureId = closure.id;
    } catch (ce: any) {
      // The location itself still saves — a tech in a hole at 2am must not
      // lose a filled-in report because the registry hiccuped.
      warnings.push(`${label}: ${ce?.message ?? 'unknown error'}`);
      console.error('closure registration failed', ce);
    }
  }

  const trayCode = numOr0(L.trays_added) > 0
    ? inferTrayMaterial(L.enclosure_model, L.splice_type || null) : null;

  const { data: loc, error: lErr } = await supabase.from('locations').insert({
    visit_id: visitId, closure_id: closureId, pm_location_no: L.pm_location_no || null,
    // The tech said this is a hole we have already been in on this job. The
    // database reads it and gives the row that hole's number back.
    revisit_of: L.revisit_of,
    tech_id: userId, techs: splitNames(L.techs),
    hole_ref: L.hole_ref || null, structure_type: L.structure_type,
    structure_owner: L.structure_owner || null, building_address: L.building_address || null,
    gps_lat: numOrNull(L.gps_lat), gps_lng: numOrNull(L.gps_lng),
    enclosure_new: L.enclosure_new, enclosure_model: L.enclosure_model || null,
    case_action: L.case_action || null, new_case_material_code: L.new_case_material_code || null,
    splice_type: L.splice_type || null, splice_count: numOr0(L.splice_count),
    trays_added: numOr0(L.trays_added), tray_material_code: trayCode,
    test_fiber_count: numOr0(L.test_fiber_count), test_type: L.test_type,
    as_found: L.as_found || null, as_built: L.as_built || null, narrative: L.narrative || null,
    ordinal,
  }).select('id').single();
  if (lErr || !loc) throw lErr ?? new Error('Could not save the location');

  // children
  if (L.shots.length) await supabase.from('shots').insert(
    L.shots.map((s, i) => ({ location_id: loc.id, fiber_group: s.fiber_group || null, direction: s.direction || null, distance_km: numOrNull(s.distance_km), event: s.event || null, ordinal: i })));
  if (L.cables.length) await supabase.from('cables').insert(
    L.cables.map((c, i) => ({ location_id: loc.id, direction: c.direction || null, count: c.count || null, manufacturer: c.manufacturer || null, date_code: c.date_code || null, footage: c.footage || null, role: c.role || null, ordinal: i })));
  if (L.panel_ports.length) await supabase.from('panel_ports').insert(
    L.panel_ports.map((p, i) => ({ location_id: loc.id, panel: p.panel || null, port: p.port || null, position: p.position || null, pass_fail: p.pass_fail || null, ordinal: i })));
  if (L.downtimes.length) await supabase.from('downtime').insert(
    L.downtimes.map((d, i) => ({ location_id: loc.id, hours: numOr0(d.hours), reason: d.reason || null, ordinal: i })));
  if (L.extras.length) await supabase.from('location_units').insert(
    L.extras.map((code, i) => ({
      location_id: loc.id, unit_code: code,
      // per-each extras (CD/PMD) carry the count the tech typed; the rest bill 1
      qty: numOr0(L.extra_qty?.[code]) > 0 ? numOr0(L.extra_qty[code]) : 1,
      ordinal: i,
    })));

  // photos — last, sequential, and never fatal
  for (const p of L.photos ?? []) {
    try {
      await uploadAttachment({
        file: p.file, jobId, visitId, locationId: loc.id, uploadedBy: userId,
      });
    } catch (pe: any) {
      warnings.push(`${label} — photo ${p.file.name}: ${pe?.message ?? 'upload failed'}`);
      console.error('attachment upload failed', pe);
    }
  }

  return { locationId: loc.id, warnings };
}
