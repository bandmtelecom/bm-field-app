import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { STATUS_FLAGS } from '../lib/types';
import LocationBlock, { emptyLocation, inferTrayMaterial, LocationForm } from '../components/LocationBlock';

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

export default function AddVisit() {
  const { id } = useParams();
  const nav = useNavigate();
  const { userId } = useSession();

  const [job, setJob] = useState<any>(null);
  /** Visit saved, but one or more closures could not be registered. */
  const [closureWarn, setClosureWarn] = useState<string[] | null>(null);
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [techs, setTechs] = useState('');
  const [narrative, setNarrative] = useState('');
  // Default to 'partial_return', never 'complete'. The guys skim past this
  // field, and the safe direction to skim in is "we're coming back".
  const [statusFlag, setStatusFlag] = useState<string>('partial_return');
  const [leadHours, setLeadHours] = useState('');
  const [locations, setLocations] = useState<LocationForm[]>([emptyLocation()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('jobs').select('id, bm_number, customer_id, billing_mode, title')
      .eq('id', id).single().then(({ data }) => setJob(data));
  }, [id]);

  function setLoc(i: number, v: LocationForm) {
    setLocations((prev) => prev.map((l, x) => (x === i ? v : l)));
  }

  async function submit() {
    if (!id || !job) return;
    setBusy(true); setErr(null); setClosureWarn(null);
    const closureWarnings: string[] = [];
    try {
      // 1) the visit
      const { data: visit, error: vErr } = await supabase.from('visits').insert({
        job_id: id, reporter_id: userId, visit_date: visitDate,
        techs: techs.split(',').map((s) => s.trim()).filter(Boolean),
        narrative: narrative || null, status_flag: statusFlag,
        lead_hours: numOrNull(leadHours),
      }).select('id').single();
      if (vErr || !visit) throw vErr ?? new Error('Could not save visit');

      // 2) each location (+ closure registry row when GPS present)
      let ord = 0;
      for (const L of locations) {
        // The tech either picked an existing closure (matched by cable) or asked
        // for a new one. Only mint a new code when nothing was picked — this is
        // what stops the registry filling up with duplicates of the same hole.
        // AUSTIN'S RULE (8/25): cables recorded = a closure. No cables means the
        // crew opened the hole to look at what is in it, which is a billable
        // manhole/handhole entry and nothing more. GPS alone never made a
        // closure - that produced registry entries for holes nobody spliced.
        // A closure with no GPS is fine: it still gets a code and can be found
        // by name, it just cannot be found by standing next to it.
        const hasCables = L.cables.some(
          (c) => (c.count || '').trim() || (c.direction || '').trim() || (c.manufacturer || '').trim(),
        );

        let closureId: string | null = L.closure_id;
        if (!closureId && hasCables) {
          // NEVER swallow these errors again. For eight days `next_closure_code`
          // threw on every call (an ambiguous column reference), both errors here
          // were destructured away, and every location saved with closure_id null.
          // 33 locations, 0 closures, and nothing on screen ever looked wrong.
          // A closure we failed to register must be visible to somebody.
          try {
            const { data: cc, error: rpcErr } = await supabase
              .rpc('next_closure_code', { p_customer: job.customer_id });
            if (rpcErr) throw rpcErr;

            const code = Array.isArray(cc) ? cc[0]?.code : (cc as any)?.code;
            const seq = Array.isArray(cc) ? cc[0]?.seq : (cc as any)?.seq;
            if (!code || seq == null) {
              throw new Error('the database returned no closure code');
            }

            const { data: closure, error: cErr } = await supabase.from('closures').insert({
              customer_id: job.customer_id, seq, closure_code: code,
              gps_lat: numOrNull(L.gps_lat), gps_lng: numOrNull(L.gps_lng),
              structure_type: L.structure_type, structure_owner: L.structure_owner || null,
              building_address: L.building_address || null, enclosure_model: L.enclosure_model || null,
              created_by: userId,
            }).select('id').single();
            if (cErr || !closure) throw cErr ?? new Error('the closure row would not save');

            closureId = closure.id;
          } catch (ce: any) {
            // The visit itself still saves - a tech standing in a hole at 2am must
            // not lose a filled-in report because the registry hiccuped. But the
            // failure is collected and shown plainly once the save finishes.
            closureWarnings.push(
              `Location ${ord + 1}${L.pm_location_no ? ` (${L.pm_location_no})` : ''}: ${ce?.message ?? 'unknown error'}`,
            );
            console.error('closure registration failed', ce);
          }
        }

        const trayCode = Number(L.trays_added) > 0
          ? inferTrayMaterial(L.enclosure_model, L.splice_type || null) : null;

        const { data: loc, error: lErr } = await supabase.from('locations').insert({
          visit_id: visit.id, closure_id: closureId, pm_location_no: L.pm_location_no || null,
          tech_id: userId, hole_ref: L.hole_ref || null, structure_type: L.structure_type,
          structure_owner: L.structure_owner || null, building_address: L.building_address || null,
          gps_lat: numOrNull(L.gps_lat), gps_lng: numOrNull(L.gps_lng),
          enclosure_new: L.enclosure_new, enclosure_model: L.enclosure_model || null,
          case_action: L.case_action || null, new_case_material_code: L.new_case_material_code || null,
          splice_type: L.splice_type || null, splice_count: Number(L.splice_count) || 0,
          trays_added: Number(L.trays_added) || 0, tray_material_code: trayCode,
          test_fiber_count: Number(L.test_fiber_count) || 0, test_type: L.test_type,
          as_found: L.as_found || null, as_built: L.as_built || null, narrative: L.narrative || null,
          ordinal: ord++,
        }).select('id').single();
        if (lErr || !loc) throw lErr ?? new Error('Could not save a location');

        // children
        if (L.shots.length) await supabase.from('shots').insert(
          L.shots.map((s, i) => ({ location_id: loc.id, fiber_group: s.fiber_group || null, direction: s.direction || null, distance_km: numOrNull(s.distance_km), event: s.event || null, ordinal: i })));
        if (L.cables.length) await supabase.from('cables').insert(
          L.cables.map((c, i) => ({ location_id: loc.id, direction: c.direction || null, count: c.count || null, manufacturer: c.manufacturer || null, date_code: c.date_code || null, footage: numOrNull(c.footage), role: c.role || null, ordinal: i })));
        if (L.panel_ports.length) await supabase.from('panel_ports').insert(
          L.panel_ports.map((p, i) => ({ location_id: loc.id, panel: p.panel || null, port: p.port || null, position: p.position || null, pass_fail: p.pass_fail || null, ordinal: i })));
        if (L.downtimes.length) await supabase.from('downtime').insert(
          L.downtimes.map((d, i) => ({ location_id: loc.id, hours: Number(d.hours) || 0, reason: d.reason || null, ordinal: i })));
        if (L.extras.length) await supabase.from('location_units').insert(
          L.extras.map((code, i) => ({
            location_id: loc.id, unit_code: code,
            // per-each extras (CD/PMD) carry the count the tech typed; the rest bill 1
            qty: Number(L.extra_qty?.[code]) > 0 ? Number(L.extra_qty[code]) : 1,
            ordinal: i,
          })));
      }

      if (closureWarnings.length) {
        // Saved, but the closure registry did not get everything. Say so and stay
        // on the page - navigating away would bury it exactly like before.
        setClosureWarn(closureWarnings);
        setBusy(false);
        return;
      }
      nav(`/jobs/${id}`);
    } catch (e: any) {
      setErr(e.message ?? 'Something went wrong saving the report.');
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav(`/jobs/${id}`)}>‹ Cancel</button>
        <div className="spacer" />
        <div className="sub">{job?.bm_number}</div>
      </div>
      <div className="content">
        <div className="card">
          <h2>Add my visit</h2>
          <div className="row">
            <div><label>Date</label><input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} /></div>
            {job?.billing_mode === 'emergency' &&
              <div><label>Hours on site</label><input inputMode="decimal" value={leadHours} onChange={(e) => setLeadHours(e.target.value)} /></div>}
          </div>
          <label>Techs on job (comma-separated)</label>
          <input placeholder="Armando, Sal" value={techs} onChange={(e) => setTechs(e.target.value)} />
          {job?.billing_mode === 'emergency' && (
            <p className="muted small" style={{ marginTop: 4 }}>
              List every tech who made the trip — on an LOR each one earns drive time.
            </p>
          )}
          <label>Job summary / narrative</label>
          <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} placeholder="What happened, delays, what's left…" />
          <label>Status</label>
          <select value={statusFlag} onChange={(e) => setStatusFlag(e.target.value)}>
            {STATUS_FLAGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {locations.map((L, i) => (
          <LocationBlock key={i} value={L} index={i} customerId={job?.customer_id ?? null}
            onChange={(v) => setLoc(i, v)}
            onRemove={() => setLocations((p) => p.filter((_, x) => x !== i))} />
        ))}
        <button className="addline" onClick={() => setLocations((p) => [...p, emptyLocation()])}>＋ Add another location</button>

        {err && <div className="error">{err}</div>}

        {closureWarn && (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <strong>Your report saved — but the closure list didn't update.</strong>
            <p className="small" style={{ marginTop: 6 }}>
              Everything you entered is safe and the office has it. What didn't
              happen is this closure getting added to the permanent list, so it
              won't come up next time somebody works this hole.
            </p>
            <ul className="small" style={{ marginTop: 6, paddingLeft: 18 }}>
              {closureWarn.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            <p className="muted small" style={{ marginTop: 6 }}>
              Send this to the office — it needs fixing, not retrying.
            </p>
            <div style={{ height: 10 }} />
            <button className="btn" onClick={() => nav(`/jobs/${id}`)}>Got it, back to the job</button>
          </div>
        )}

        <div style={{ height: 12 }} />
        {!closureWarn && (
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Submit report'}</button>
        )}
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
