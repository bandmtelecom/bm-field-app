import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { markJobComplete, downloadFieldReport } from '../lib/api';
import { STRUCTURE_LABELS } from '../lib/types';
import LocationDetail from '../components/LocationDetail';

// Every column the read-only detail panel needs, pulled in one query with the
// visit so tapping a location is instant (child tables load on demand).
const LOCATION_COLS = `
  id, pm_location_no, hole_ref, structure_type, structure_owner, building_address,
  gps_lat, gps_lng, enclosure_new, enclosure_model, case_action, new_case_material_code,
  splice_type, splice_count, trays_added, tray_material_code,
  test_fiber_count, test_type, as_found, as_built, narrative, ordinal,
  closures(closure_code)
`;

export default function JobRecord() {
  const { id } = useParams();
  const nav = useNavigate();
  const { profile } = useSession();
  const [job, setJob] = useState<any | null>(null);
  const [visits, setVisits] = useState<any[]>([]);
  const [openLoc, setOpenLoc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dl, setDl] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);

  async function load() {
    const { data: j } = await supabase.from('jobs')
      .select('id, bm_number, identifier, identifier_type, title, billing_mode, maint_window, scheduled_ahead, status, customer:customers(name, code)')
      .eq('id', id).single();
    setJob(j as any);
    const { data: v } = await supabase.from('visits')
      .select(`id, visit_date, report_type, techs, narrative, status_flag, lead_hours, locations(${LOCATION_COLS})`)
      .eq('job_id', id).order('visit_date', { ascending: true });
    setVisits((v as any) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const isOffice = profile?.role === 'office' || profile?.role === 'admin';

  async function complete() {
    if (!id) return;
    setBusy(true); setMsg(null);
    try {
      const r = await markJobComplete(id);
      setMsg(isOffice && r.total != null
        ? `Job closed. Draft invoice ready (${r.lineCount} lines).`
        : 'Job closed and sent to the office for invoicing.');
      await load();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }

  async function getReport() {
    setDl(true); setDlErr(null);
    try { await downloadFieldReport(id!, job?.bm_number ?? ''); }
    catch (e: any) { setDlErr(e.message); }
    setDl(false);
  }

  if (!job) return <div className="spinner">Loading…</div>;

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav('/')}>‹ Jobs</button>
        <div className="spacer" />
        <div className="sub">{job.status}</div>
      </div>
      <div className="content">
        <div className="card">
          <h2>{job.bm_number} — {job.customer?.name}</h2>
          <div className="small muted">{job.identifier} · {job.title}</div>
          <div style={{ marginTop: 8 }}>
            {job.billing_mode === 'emergency'
              ? <span className="badge emergency">LOR / Emergency</span>
              : <span className="pill">Capital — per unit</span>}
            {job.maint_window && <span className="pill" style={{ marginLeft: 6 }}>🌙 Maintenance window</span>}
            {job.billing_mode === 'emergency' && (
              <span className="pill" style={{ marginLeft: 6 }}>
                {job.scheduled_ahead ? 'Scheduled ahead — no drive time' : 'Rolled out — drive time billable'}
              </span>
            )}
          </div>
        </div>

        <h3 className="muted small" style={{ margin: '4px 2px' }}>
          RUNNING RECORD · {visits.length} visit(s) · tap a location to see the detail
        </h3>
        {visits.map((v) => {
          const locs = [...(v.locations ?? [])].sort((a: any, b: any) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
          return (
            <div key={v.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{v.visit_date}</strong>
                <span className="small muted">{(v.techs ?? []).join(', ')}</span>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                {v.status_flag && <span className="pill">{v.status_flag.replace(/_/g, ' ')}</span>}
                {v.report_type && v.report_type !== 'splice' && <span className="pill">{v.report_type.replace(/_/g, ' ')}</span>}
                {v.lead_hours ? <span className="pill">{v.lead_hours} hr</span> : null}
              </div>
              {v.narrative && <p className="small" style={{ marginTop: 8 }}>{v.narrative}</p>}

              {locs.map((l: any) => {
                const open = openLoc === l.id;
                return (
                  <div key={l.id} style={{ marginTop: 6 }}>
                    <button
                      onClick={() => setOpenLoc(open ? null : l.id)}
                      aria-expanded={open}
                      style={{
                        width: '100%', textAlign: 'left', background: 'transparent',
                        border: 0, padding: '6px 0', color: 'inherit', font: 'inherit', cursor: 'pointer',
                      }}
                    >
                      <span className="small">
                        <span style={{ display: 'inline-block', width: 14 }}>{open ? '▾' : '▸'}</span>
                        📍 <strong>{l.closures?.closure_code ?? `Location ${l.pm_location_no ?? ''}`}</strong>
                        {' · '}{STRUCTURE_LABELS[l.structure_type as keyof typeof STRUCTURE_LABELS] ?? l.structure_type}
                        {l.splice_type ? ` · ${l.splice_count} ${l.splice_type}` : ''}
                      </span>
                    </button>
                    {open && <LocationDetail loc={l} />}
                  </div>
                );
              })}
              {!locs.length && <div className="muted small" style={{ marginTop: 6 }}>No locations logged on this visit.</div>}
            </div>
          );
        })}
        {!visits.length && <div className="card muted small">No visits yet. Add the first one.</div>}

        {msg && <div className="card small" style={{ borderColor: 'var(--ok)' }}>{msg}</div>}

        {job.status !== 'complete' && (
          <>
            <button className="btn accent" onClick={() => nav(`/jobs/${id}/add`)}>＋ Add my visit</button>
            <div style={{ height: 10 }} />
            <button className="btn ok" disabled={busy} onClick={complete}>
              {busy ? 'Closing…' : '🏁 Mark job complete'}
            </button>
          </>
        )}
        {isOffice && (
          <>
            <div style={{ height: 10 }} />
            {/* the customer's record of work — no prices, safe to send out */}
            <button className="btn ghost" disabled={dl} onClick={getReport}>
              {dl ? 'Building…' : '📄 Download field report (PDF)'}
            </button>
            <p className="muted small" style={{ marginTop: 4 }}>
              Everything the crew did on this job — closures, splices, cables and
              footages, as-found and as-built. No prices; this is the copy for the
              customer.
            </p>
            {dlErr && <div className="error">{dlErr}</div>}
            <div style={{ height: 10 }} />
            <Link className="btn ghost" to={`/jobs/${id}/invoice`}>View draft invoice</Link>
          </>
        )}
      </div>
    </div>
  );
}
