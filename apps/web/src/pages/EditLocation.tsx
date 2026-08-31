import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import LocationBlock, { emptyLocation, inferTrayMaterial, type LocationForm, type PriorLocation } from '../components/LocationBlock';
import { numOrNull, numOr0, splitNames, joinNames } from '../lib/num';
import { loadPriorLocations } from '../lib/priorLocations';

const str = (v: unknown) => (v == null ? '' : String(v));

/**
 * Fix a location after the fact.
 *
 * The guys miss things — a cable, a footage, the GPS. Before this the only
 * record was whatever got typed the first time, and correcting it meant asking
 * the office to go into the database. Now they reopen the location, change what
 * they need, and save.
 *
 * Reuses the exact same LocationBlock the original entry used, so there is one
 * form to learn and one place bugs can hide. Saving replaces the location's
 * detail rows wholesale — simpler and more predictable than trying to diff
 * cables and shots row by row.
 */
export default function EditLocation() {
  const { id } = useParams();
  const nav = useNavigate();
  const { userId } = useSession();

  const [form, setForm] = useState<LocationForm | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [visitId, setVisitId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ visitDate?: string; bm?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** B&M's number for this hole on this job. Read-only here — it is the
   *  return-trip answer below that moves it, never a box somebody types in. */
  const [jobNo, setJobNo] = useState<number | null>(null);
  /** The other holes on this job, so a mis-filed return trip can be corrected
   *  without anybody re-entering the report. */
  const [prior, setPrior] = useState<PriorLocation[]>([]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: l } = await supabase
        .from('locations')
        .select(`
          *,
          closures(id, closure_code),
          cables(direction, count, manufacturer, date_code, footage, role, ordinal),
          shots(fiber_group, direction, distance_km, event, ordinal),
          panel_ports(panel, port, position, pass_fail, ordinal),
          downtime(hours, reason, ordinal),
          location_units(unit_code, qty, ordinal),
          visits(id, visit_date, job_id, techs, jobs(bm_number, customer_id))
        `)
        .eq('id', id).single();
      if (!l) { setErr('That location is gone.'); return; }

      const a: any = l;
      setJobId(a.visits?.job_id ?? null);
      setVisitId(a.visits?.id ?? null);
      setCustomerId(a.visits?.jobs?.customer_id ?? null);
      setMeta({ visitDate: a.visits?.visit_date, bm: a.visits?.jobs?.bm_number });
      setJobNo(a.job_location_no ?? null);

      // Every other hole on this job, minus this one. Loading it here rather
      // than in the block keeps the "which hole is this" question answerable
      // from the office with the same list the tech saw in the field.
      if (a.visits?.job_id) {
        loadPriorLocations(a.visits.job_id, a.id)
          .then(setPrior)
          .catch((e) => console.error('could not load the job\'s other locations', e));
      }

      const byOrd = (x: any[]) => [...(x ?? [])].sort((p, q) => (p.ordinal ?? 0) - (q.ordinal ?? 0));
      const extras = byOrd(a.location_units).filter((u: any) => u.unit_code);

      setForm({
        ...emptyLocation(),
        pm_location_no: str(a.pm_location_no),
        revisit_of: a.revisit_of ?? null,
        // Pre-0011 rows have no crew of their own; fall back to whoever the
        // visit said was out, so the office sees names rather than an empty box.
        techs: joinNames(
          (Array.isArray(a.techs) && a.techs.length ? a.techs : a.visits?.techs) ?? [],
        ),
        structure_type: a.structure_type ?? 'mh',
        structure_owner: str(a.structure_owner),
        building_address: str(a.building_address),
        gps_lat: str(a.gps_lat), gps_lng: str(a.gps_lng),
        hole_ref: str(a.hole_ref),
        enclosure_new: !!a.enclosure_new,
        enclosure_model: str(a.enclosure_model),
        case_action: a.case_action ?? '',
        new_case_material_code: str(a.new_case_material_code),
        splice_type: a.splice_type ?? '',
        splice_count: a.splice_count ? String(a.splice_count) : '',
        trays_added: a.trays_added ? String(a.trays_added) : '',
        test_fiber_count: a.test_fiber_count ? String(a.test_fiber_count) : '',
        test_type: a.test_type ?? 'otdr',
        narrative: str(a.narrative), as_found: str(a.as_found), as_built: str(a.as_built),
        cables: byOrd(a.cables).map((c: any) => ({
          direction: str(c.direction), count: str(c.count), manufacturer: str(c.manufacturer),
          date_code: str(c.date_code), footage: str(c.footage), role: str(c.role),
        })),
        shots: byOrd(a.shots).map((s: any) => ({
          fiber_group: str(s.fiber_group), direction: str(s.direction),
          distance_km: str(s.distance_km), event: str(s.event),
        })),
        panel_ports: byOrd(a.panel_ports).map((p: any) => ({
          panel: str(p.panel), port: str(p.port), position: str(p.position),
          pass_fail: p.pass_fail ?? '',
        })),
        downtimes: byOrd(a.downtime).map((d: any) => ({
          hours: str(d.hours), reason: str(d.reason),
        })),
        extras: extras.map((u: any) => u.unit_code),
        extra_qty: Object.fromEntries(extras.map((u: any) => [u.unit_code, String(u.qty ?? 1)])),
        closure_id: a.closures?.id ?? a.closure_id ?? null,
        closure_code: a.closures?.closure_code ?? null,
      });
    })().catch((e) => setErr(e.message));
  }, [id]);

  async function save() {
    if (!id || !form) return;
    setBusy(true); setErr(null);
    try {
      // attach to the picked closure, or mint one if GPS was added and none chosen
      let closureId: string | null = form.closure_id;
      // Same rule as AddVisit: cables make a closure, not GPS.
      const hasCables = form.cables.some(
        (c: any) => (c.count || '').trim() || (c.direction || '').trim() || (c.manufacturer || '').trim(),
      );
      if (!closureId && hasCables && customerId) {
        // Errors here used to be discarded, which is how the registry stayed
        // empty for eight days with nothing on screen looking wrong. This is the
        // office screen, so failing outright is right - unlike a tech mid-shift,
        // whoever is here can deal with it now.
        const { data: cc, error: rpcErr } = await supabase
          .rpc('next_closure_code', { p_customer: customerId });
        if (rpcErr) throw new Error(`Could not get a closure code: ${rpcErr.message}`);

        const code = Array.isArray(cc) ? cc[0]?.code : (cc as any)?.code;
        const seq = Array.isArray(cc) ? cc[0]?.seq : (cc as any)?.seq;
        if (!code || seq == null) throw new Error('The database returned no closure code.');

        const { data: closure, error: cErr } = await supabase.from('closures').insert({
          customer_id: customerId, seq, closure_code: code,
          gps_lat: numOrNull(form.gps_lat), gps_lng: numOrNull(form.gps_lng),
          structure_type: form.structure_type, structure_owner: form.structure_owner || null,
          building_address: form.building_address || null,
          enclosure_model: form.enclosure_model || null, created_by: userId,
        }).select('id').single();
        if (cErr || !closure) {
          throw new Error(`Could not register the closure: ${cErr?.message ?? 'no row returned'}`);
        }
        closureId = closure.id;
      }

      const trayCode = numOr0(form.trays_added) > 0
        ? inferTrayMaterial(form.enclosure_model, form.splice_type || null) : null;

      const { error: uErr } = await supabase.from('locations').update({
        closure_id: closureId, pm_location_no: form.pm_location_no || null,
        // Setting this makes the row take that hole's number; clearing it gives
        // the row a fresh number at the end of the job. Both are the database's
        // decision, not this screen's — see migration 0012.
        revisit_of: form.revisit_of,
        techs: splitNames(form.techs),
        hole_ref: form.hole_ref || null, structure_type: form.structure_type,
        structure_owner: form.structure_owner || null,
        building_address: form.building_address || null,
        gps_lat: numOrNull(form.gps_lat), gps_lng: numOrNull(form.gps_lng),
        enclosure_new: form.enclosure_new, enclosure_model: form.enclosure_model || null,
        case_action: form.case_action || null,
        new_case_material_code: form.new_case_material_code || null,
        splice_type: form.splice_type || null, splice_count: numOr0(form.splice_count),
        trays_added: numOr0(form.trays_added), tray_material_code: trayCode,
        test_fiber_count: numOr0(form.test_fiber_count), test_type: form.test_type,
        as_found: form.as_found || null, as_built: form.as_built || null,
        narrative: form.narrative || null,
      }).eq('id', id);
      if (uErr) throw uErr;

      // replace the detail rows wholesale
      for (const t of ['shots', 'cables', 'panel_ports', 'downtime', 'location_units']) {
        const { error } = await supabase.from(t).delete().eq('location_id', id);
        if (error) throw new Error(`Could not clear ${t}: ${error.message}`);
      }
      if (form.shots.length) await supabase.from('shots').insert(
        form.shots.map((s, i) => ({ location_id: id, fiber_group: s.fiber_group || null, direction: s.direction || null, distance_km: numOrNull(s.distance_km), event: s.event || null, ordinal: i })));
      if (form.cables.length) await supabase.from('cables').insert(
        form.cables.map((c, i) => ({ location_id: id, direction: c.direction || null, count: c.count || null, manufacturer: c.manufacturer || null, date_code: c.date_code || null, footage: c.footage || null, role: c.role || null, ordinal: i })));
      if (form.panel_ports.length) await supabase.from('panel_ports').insert(
        form.panel_ports.map((p, i) => ({ location_id: id, panel: p.panel || null, port: p.port || null, position: p.position || null, pass_fail: p.pass_fail || null, ordinal: i })));
      if (form.downtimes.length) await supabase.from('downtime').insert(
        form.downtimes.map((d, i) => ({ location_id: id, hours: numOr0(d.hours), reason: d.reason || null, ordinal: i })));
      if (form.extras.length) await supabase.from('location_units').insert(
        form.extras.map((code, i) => ({
          location_id: id, unit_code: code,
          qty: numOr0(form.extra_qty?.[code]) > 0 ? numOr0(form.extra_qty[code]) : 1,
          ordinal: i,
        })));

      // Keep the visit's crew list as the union of its locations, so the running
      // record and the field-report header still name everybody who was out
      // that night. Nothing bills off it — the engine reads the location crews —
      // so a failure here is cosmetic and must not lose the correction above.
      if (visitId) {
        const { data: sibs } = await supabase
          .from('locations').select('techs').eq('visit_id', visitId);
        const everyone = splitNames(
          (sibs ?? []).flatMap((r: any) => (Array.isArray(r.techs) ? r.techs : [])).join(', '),
        );
        const { error: vErr } = await supabase
          .from('visits').update({ techs: everyone }).eq('id', visitId);
        if (vErr) console.error('could not refresh the visit crew list', vErr);
      }

      nav(jobId ? `/jobs/${jobId}` : '/');
    } catch (e: any) {
      setErr(e.message ?? 'Could not save the change.');
      setBusy(false);
    }
  }

  if (err && !form) return (
    <div className="app"><div className="content"><div className="card error">{err}</div></div></div>
  );
  if (!form) return <div className="spinner">Loading…</div>;

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav(jobId ? `/jobs/${jobId}` : '/')}>‹ Cancel</button>
        <div className="spacer" />
        <div className="sub">{meta?.bm}</div>
      </div>
      <div className="content">
        <div className="card">
          <h2>Edit this location</h2>
          <p className="muted small">
            From the visit on {meta?.visitDate ?? '—'}. Change whatever needs fixing and save.
            That includes the crew — the names on this location are what standby
            time bills against. The visit date is not changed here.
          </p>
          {form.closure_code && (
            <p className="small" style={{ color: 'var(--ok)' }}>
              Currently attached to {form.closure_code}.
            </p>
          )}
          {jobNo != null && (
            <p className="small" style={{ marginTop: 2 }}>
              The customer sees this as <strong>Location {jobNo}</strong> on{' '}
              {meta?.bm ?? 'this job'}
              {form.revisit_of ? ' — filed as a return trip to that hole.' : '.'}
              {' '}Change that with the return-trip question below, not by typing
              a number.
            </p>
          )}
        </div>

        <LocationBlock
          value={form} index={0} customerId={customerId}
          priorLocations={prior} displayNo={jobNo}
          onChange={setForm}
          onRemove={() => nav(jobId ? `/jobs/${jobId}` : '/')}
        />

        {err && <div className="error">{err}</div>}
        <div style={{ height: 10 }} />
        <button className="btn ok" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
