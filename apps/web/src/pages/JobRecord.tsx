import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { markJobComplete, downloadFieldReport, reopenJob, markJobInvoiced, unarchiveJob } from '../lib/api';
import { STRUCTURE_LABELS, STATUS_FLAGS, locationTitle } from '../lib/types';
import LocationDetail from '../components/LocationDetail';

// Every column the read-only detail panel needs, pulled in one query with the
// visit so tapping a location is instant (child tables load on demand).
const LOCATION_COLS = `
  id, pm_location_no, job_location_no, revisit_of,
  techs, hole_ref, structure_type, structure_owner, building_address,
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
  /** Closing a job generates the invoice and hides the buttons — never on one tap. */
  const [confirming, setConfirming] = useState(false);
  /** Archiving takes it off the crew's list — also never on one tap. */
  const [archiving, setArchiving] = useState(false);
  const [dl, setDl] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);
  /** Office fixing a filed report: which visit is open, and the working copy.
   *  Before this the summary and status were frozen the moment a tech hit
   *  submit, and a typo meant a trip into the database. */
  const [editVisit, setEditVisit] = useState<string | null>(null);
  const [vDraft, setVDraft] = useState<{ narrative: string; status_flag: string }>(
    { narrative: '', status_flag: '' });
  const [vBusy, setVBusy] = useState(false);
  const [vErr, setVErr] = useState<string | null>(null);

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
    setBusy(true); setMsg(null); setConfirming(false);
    try {
      const r = await markJobComplete(id);
      setMsg(isOffice && r.total != null
        ? `Job closed. Draft invoice ready (${r.lineCount} lines).`
        : 'Job closed and sent to the office for invoicing.');
      await load();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }

  function startEditVisit(v: any) {
    setVErr(null);
    setVDraft({ narrative: v.narrative ?? '', status_flag: v.status_flag ?? '' });
    setEditVisit(v.id);
  }

  async function saveVisit(visitId: string) {
    setVBusy(true); setVErr(null);
    const { error } = await supabase.from('visits').update({
      narrative: vDraft.narrative.trim() || null,
      status_flag: vDraft.status_flag || null,
    }).eq('id', visitId);
    setVBusy(false);
    // Never swallow this. A silent failure here is how the office ends up
    // believing a correction landed when it never did.
    if (error) { setVErr(error.message); return; }
    setEditVisit(null);
    await load();
  }

  async function getReport() {
    setDl(true); setDlErr(null);
    try { await downloadFieldReport(id!, job?.bm_number ?? ''); }
    catch (e: any) { setDlErr(e.message); }
    setDl(false);
  }

  async function archive() {
    if (!id) return;
    setBusy(true); setMsg(null); setArchiving(false);
    try {
      await markJobInvoiced(id);
      setMsg('Filed in the Archive. It\u2019s off the working list.');
      await load();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }

  async function unarchive() {
    if (!id) return;
    setBusy(true); setMsg(null);
    try {
      await unarchiveJob(id);
      setMsg('Back on the completed list.');
      await load();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }

  async function reopen() {
    if (!id) return;
    setBusy(true); setMsg(null);
    try {
      const r = await reopenJob(id);
      setMsg(r.draftsVoided
        ? 'Back on the roster. The old draft invoice was set aside.'
        : 'Back on the roster.');
      await load();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
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
              {editVisit === v.id ? (
                <div className="card" style={{ borderColor: 'var(--accent)', marginTop: 8 }}>
                  <label>Status</label>
                  <select value={vDraft.status_flag}
                    onChange={(e) => setVDraft({ ...vDraft, status_flag: e.target.value })}>
                    <option value="">—</option>
                    {STATUS_FLAGS.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
                  </select>
                  <label>Job summary / narrative</label>
                  <textarea value={vDraft.narrative}
                    onChange={(e) => setVDraft({ ...vDraft, narrative: e.target.value })} />
                  <p className="muted small" style={{ marginTop: 4 }}>
                    This is what the customer reads on the field report. The crew
                    is set on each location below, not here.
                  </p>
                  {vErr && <div className="error">{vErr}</div>}
                  <div style={{ height: 8 }} />
                  <button className="btn ok" disabled={vBusy} onClick={() => saveVisit(v.id)}>
                    {vBusy ? 'Saving…' : 'Save the report'}
                  </button>
                  <div style={{ height: 8 }} />
                  <button className="btn ghost" disabled={vBusy} onClick={() => setEditVisit(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  {v.narrative && <p className="small" style={{ marginTop: 8 }}>{v.narrative}</p>}
                  {isOffice && (
                    <button className="addline" style={{ marginTop: 6 }}
                      onClick={() => startEditVisit(v)}>
                      ✎ Fix this report
                    </button>
                  )}
                </>
              )}

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
                        📍 <strong>{locationTitle(l)}</strong>
                        {l.closures?.closure_code ? ` · ${l.closures.closure_code}` : ''}
                        {' · '}{STRUCTURE_LABELS[l.structure_type as keyof typeof STRUCTURE_LABELS] ?? l.structure_type}
                        {l.splice_type ? ` · ${l.splice_count} ${l.splice_type}` : ''}
                      </span>
                      {/* The crew on the hole — this is what standby bills
                          against, so it belongs where the office can see it
                          without opening anything. */}
                      {(l.techs ?? []).length > 0 && (
                        <span className="small muted" style={{ display: 'block', marginLeft: 14 }}>
                          👷 {(l.techs as string[]).join(', ')}
                        </span>
                      )}
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

            {/* Two taps, on purpose. One tap used to close the job, build the
                invoice and hide these buttons, with no way back except SQL. */}
            {!confirming ? (
              <button className="btn ok" disabled={busy} onClick={() => setConfirming(true)}>
                🏁 Mark job complete
              </button>
            ) : (
              <div className="card" style={{ borderColor: 'var(--accent)' }}>
                <strong>Close out {job.bm_number}?</strong>
                <p className="small" style={{ marginTop: 6 }}>
                  This tells the office the work is finished and builds the invoice.
                  The crew can't add any more visits to it.
                </p>
                <p className="muted small">
                  Only do this when the whole job is done — not just tonight's work.
                  If you're coming back, leave it open.
                </p>
                <div style={{ height: 10 }} />
                <button className="btn ok" disabled={busy} onClick={complete}>
                  {busy ? 'Closing…' : 'Yes, the job is finished'}
                </button>
                <div style={{ height: 8 }} />
                <button className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>
                  No, keep it open
                </button>
              </div>
            )}
          </>
        )}

        {/* Reopening used to be a SQL errand for Austin. */}
        {job.status === 'complete' && isOffice && (
          <>
            <div style={{ height: 10 }} />
            <button className="btn ghost" disabled={busy} onClick={reopen}>
              {busy ? 'Reopening…' : '↩ Reopen this job'}
            </button>
            <p className="muted small" style={{ marginTop: 4 }}>
              Puts it back on the crew's roster so they can add or fix a visit. The
              current draft invoice is set aside; closing it again builds a fresh one.
            </p>
          </>
        )}
        {/* Mark invoiced / unarchive — office only. */}
        {job.status === 'complete' && isOffice && (
          <>
            <div style={{ height: 10 }} />
            {!archiving ? (
              <button className="btn ghost" disabled={busy} onClick={() => setArchiving(true)}>
                📁 Mark invoiced &amp; archive
              </button>
            ) : (
              <div className="card" style={{ borderColor: 'var(--accent)' }}>
                <strong>Archive {job.bm_number}?</strong>
                <p className="small" style={{ marginTop: 6 }}>
                  Do this once the invoice has actually gone to the customer. The job
                  comes off the working list and moves to the Archive, where anyone
                  can still open it and read the work.
                </p>
                <p className="muted small">
                  Nothing is deleted, and you can pull it back out if you archive the
                  wrong one.
                </p>
                <div style={{ height: 10 }} />
                <button className="btn ok" disabled={busy} onClick={archive}>
                  {busy ? 'Filing…' : 'Yes, it has been invoiced'}
                </button>
                <div style={{ height: 8 }} />
                <button className="btn ghost" disabled={busy} onClick={() => setArchiving(false)}>
                  Not yet
                </button>
              </div>
            )}
          </>
        )}

        {job.status === 'invoiced' && isOffice && (
          <>
            <div style={{ height: 10 }} />
            <button className="btn ghost" disabled={busy} onClick={unarchive}>
              {busy ? 'Working…' : '↩ Take back out of the Archive'}
            </button>
            <p className="muted small" style={{ marginTop: 4 }}>
              Puts it back with the completed jobs so it can be corrected and rebilled.
            </p>
          </>
        )}

        <>
          <div style={{ height: 10 }} />
          {/* The customer's record of work — no prices, so everyone including
              the crew can pull it. A splicer needs his own write-up. */}
          <button className="btn ghost" disabled={dl} onClick={getReport}>
              {dl ? 'Building…' : '📄 Download field report (PDF)'}
            </button>
            <p className="muted small" style={{ marginTop: 4 }}>
              Everything the crew did on this job — closures, splices, cables and
              footages, as-found and as-built. No prices; this is the copy for the
              customer.
            </p>
          {dlErr && <div className="error">{dlErr}</div>}
        </>

        {/* Dollars stay office/admin. */}
        {isOffice && (
          <>
            <div style={{ height: 10 }} />
            <Link className="btn ghost" to={`/jobs/${id}/invoice`}>View draft invoice</Link>
          </>
        )}
      </div>
    </div>
  );
}
