import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import LocationBlock, { emptyLocation, inferTrayMaterial, type LocationForm } from '../components/LocationBlock';

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
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
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ visitDate?: string; bm?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
          visits(id, visit_date, job_id, jobs(bm_number, customer_id))
        `)
        .eq('id', id).single();
      if (!l) { setErr('That location is gone.'); return; }

      const a: any = l;
      setJobId(a.visits?.job_id ?? null);
      setCustomerId(a.visits?.jobs?.customer_id ?? null);
      setMeta({ visitDate: a.visits?.visit_date, bm: a.visits?.jobs?.bm_number });

      const byOrd = (x: any[]) => [...(x ?? [])].sort((p, q) => (p.ordinal ?? 0) - (q.ordinal ?? 0));
      const extras = byOrd(a.location_units).filter((u: any) => u.unit_code);

      setForm({
        ...emptyLocation(),
        pm_location_no: str(a.pm_location_no),
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
      if (!closureId && form.gps_lat && form.gps_lng && customerId) {
        const { data: cc } = await supabase.rpc('next_closure_code', { p_customer: customerId });
        const code = Array.isArray(cc) ? cc[0]?.code : (cc as any)?.code;
        const seq = Array.isArray(cc) ? cc[0]?.seq : (cc as any)?.seq;
        const { data: closure } = await supabase.from('closures').insert({
          customer_id: customerId, seq, closure_code: code,
          gps_lat: Number(form.gps_lat), gps_lng: Number(form.gps_lng),
          structure_type: form.structure_type, structure_owner: form.structure_owner || null,
          building_address: form.building_address || null,
          enclosure_model: form.enclosure_model || null, created_by: userId,
        }).select('id').single();
        closureId = closure?.id ?? null;
      }

      const trayCode = Number(form.trays_added) > 0
        ? inferTrayMaterial(form.enclosure_model, form.splice_type || null) : null;

      const { error: uErr } = await supabase.from('locations').update({
        closure_id: closureId, pm_location_no: form.pm_location_no || null,
        hole_ref: form.hole_ref || null, structure_type: form.structure_type,
        structure_owner: form.structure_owner || null,
        building_address: form.building_address || null,
        gps_lat: numOrNull(form.gps_lat), gps_lng: numOrNull(form.gps_lng),
        enclosure_new: form.enclosure_new, enclosure_model: form.enclosure_model || null,
        case_action: form.case_action || null,
        new_case_material_code: form.new_case_material_code || null,
        splice_type: form.splice_type || null, splice_count: Number(form.splice_count) || 0,
        trays_added: Number(form.trays_added) || 0, tray_material_code: trayCode,
        test_fiber_count: Number(form.test_fiber_count) || 0, test_type: form.test_type,
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
        form.cables.map((c, i) => ({ location_id: id, direction: c.direction || null, count: c.count || null, manufacturer: c.manufacturer || null, date_code: c.date_code || null, footage: numOrNull(c.footage), role: c.role || null, ordinal: i })));
      if (form.panel_ports.length) await supabase.from('panel_ports').insert(
        form.panel_ports.map((p, i) => ({ location_id: id, panel: p.panel || null, port: p.port || null, position: p.position || null, pass_fail: p.pass_fail || null, ordinal: i })));
      if (form.downtimes.length) await supabase.from('downtime').insert(
        form.downtimes.map((d, i) => ({ location_id: id, hours: Number(d.hours) || 0, reason: d.reason || null, ordinal: i })));
      if (form.extras.length) await supabase.from('location_units').insert(
        form.extras.map((code, i) => ({
          location_id: id, unit_code: code,
          qty: Number(form.extra_qty?.[code]) > 0 ? Number(form.extra_qty[code]) : 1,
          ordinal: i,
        })));

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
            The visit date, techs and job summary are not changed here.
          </p>
          {form.closure_code && (
            <p className="small" style={{ color: 'var(--ok)' }}>
              Currently attached to {form.closure_code}.
            </p>
          )}
        </div>

        <LocationBlock
          value={form} index={0} customerId={customerId}
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
