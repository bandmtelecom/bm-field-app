import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { STATUS_FLAGS, locationTitle } from '../lib/types';
import { todayLocal, numOrNull } from '../lib/num';
import { visitDateProblem, isBackdated, shortDay } from '../lib/visitDate';

/**
 * The lead finishes the visit.
 *
 * Summary, status and (on an LOR) hours on site — the things that used to sit
 * at the top of the one-shot form. Only the man who started the visit or the
 * office can get here (the database enforces it too; the button is just the
 * polite version). The other men's locations are already on the visit by the
 * time this is tapped, so the summary is written with the whole night in view.
 *
 * Finishing closes the visit. Nothing about the JOB changes — "Mark job
 * complete" is still its own decision on the job screen.
 */

export default function FinishVisit() {
  const { id: jobId, visitId } = useParams();
  const nav = useNavigate();
  const { userId, profile } = useSession();

  const [job, setJob] = useState<any>(null);
  const [visit, setVisit] = useState<any>(null);
  const [narrative, setNarrative] = useState('');
  // Default to 'partial_return', never 'complete'. The guys skim past this
  // field, and the safe direction to skim in is "we're coming back".
  const [statusFlag, setStatusFlag] = useState<string>('partial_return');
  const [leadHours, setLeadHours] = useState('');
  /** The visit's date — changeable here so the lead can fix it as he closes out. */
  const [visitDate, setVisitDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || !visitId) return;
    (async () => {
      const { data: j } = await supabase.from('jobs')
        .select('id, bm_number, billing_mode, title').eq('id', jobId).single();
      setJob(j);
      const { data: v } = await supabase.from('visits')
        .select('id, visit_date, status, reporter_id, narrative, status_flag, lead_hours, lead_start, techs, locations(id, pm_location_no, job_location_no, building_address, revisit_of, structure_type, techs, ordinal)')
        .eq('id', visitId).single();
      setVisit(v);
      if (v) {
        setNarrative((v as any).narrative ?? '');
        setVisitDate((v as any).visit_date ?? todayLocal());
        if ((v as any).status_flag) setStatusFlag((v as any).status_flag);
        if ((v as any).lead_hours != null) setLeadHours(String((v as any).lead_hours));
      }
    })();
  }, [jobId, visitId]);

  const isOffice = profile?.role === 'office' || profile?.role === 'admin';
  const isLead = !!visit && visit.reporter_id === userId;
  const allowed = isLead || isOffice;

  /** Hours since Start, shown as a hint on an LOR — the lead still types the
   *  number, because the clock ran while he drove home too. */
  const sinceStart = (() => {
    if (!visit?.lead_start) return null;
    const h = (Date.now() - new Date(visit.lead_start).getTime()) / 36e5;
    return h > 0 && h < 48 ? h : null;
  })();

  async function finish() {
    if (!visitId) return;
    const problem = visitDateProblem(visitDate, todayLocal());
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from('visits').update({
      visit_date: visitDate.trim(),
      narrative: narrative.trim() || null,
      status_flag: statusFlag || null,
      lead_hours: numOrNull(leadHours),
      status: 'closed',
      lead_finish: new Date().toISOString(),
      closed_by: userId,
    }).eq('id', visitId).select('id').single();
    setBusy(false);
    // Never swallow this. The database refuses the update for anyone but the
    // lead or the office, and a silent no-op here would look like success.
    if (error) { setErr(error.message); return; }
    nav(`/jobs/${jobId}`);
  }

  const locs = [...(visit?.locations ?? [])].sort((a: any, b: any) => (a.ordinal ?? 0) - (b.ordinal ?? 0));

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav(`/jobs/${jobId}`)}>‹ Back</button>
        <div className="spacer" />
        <div className="sub">{job?.bm_number}</div>
      </div>
      <div className="content">
        <div className="card">
          <h2>Finish the visit</h2>
          {visit && (
            <p className="muted small" style={{ marginTop: 2 }}>
              {shortDay(visit.visit_date)}{(visit.techs ?? []).length ? ` · ${visit.techs.join(', ')}` : ''}
            </p>
          )}

          {/* What is on the visit right now — every man's holes, so the summary
              is written with the whole night in view. */}
          {locs.length > 0 ? (
            <ul className="small" style={{ marginTop: 8, paddingLeft: 18 }}>
              {locs.map((l: any) => (
                <li key={l.id}>
                  📍 {locationTitle(l)}
                  {(l.techs ?? []).length ? <span className="muted"> · {l.techs.join(', ')}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small" style={{ marginTop: 8, color: 'var(--danger)' }}>
              No locations on this visit yet. Add yours before finishing, or the
              report for tonight will be empty.
            </p>
          )}
        </div>

        {visit && !allowed && (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <strong>Only the lead can finish this visit.</strong>
            <p className="small" style={{ marginTop: 6 }}>
              Whoever tapped Start writes the summary and closes it. Your locations
              are on it — nothing more for you to do here.
            </p>
            <div style={{ height: 8 }} />
            <button className="btn ghost" onClick={() => nav(`/jobs/${jobId}`)}>Back to the job</button>
          </div>
        )}

        {visit && allowed && (
          <div className="card">
            {job?.billing_mode === 'emergency' && (
              <>
                <label>Hours on site</label>
                <input inputMode="decimal" value={leadHours} onChange={(e) => setLeadHours(e.target.value)} />
                <p className="muted small" style={{ marginTop: 2 }}>
                  Record only — the units and the standby on each location are
                  what bill.
                  {sinceStart != null ? ` (Started ${sinceStart.toFixed(1)} hr ago.)` : ''}
                </p>
              </>
            )}
            <label>Visit date</label>
            <input type="date" value={visitDate} max={todayLocal()}
              onChange={(e) => setVisitDate(e.target.value)} />
            <p className="muted small" style={{ marginTop: 2 }}>
              {isBackdated(visitDate, todayLocal())
                ? `Backdated to ${shortDay(visitDate)}. Every location on this visit goes on the report under that day.`
                : 'The day the work was done. Change it if this was an earlier day.'}
            </p>
            <label>Job summary / narrative</label>
            <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)}
              placeholder="What happened, delays, what's left…" />
            <label>Status</label>
            <select value={statusFlag} onChange={(e) => setStatusFlag(e.target.value)}>
              {STATUS_FLAGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <p className="muted small" style={{ marginTop: 6 }}>
              Finishing closes tonight's visit. It does not close the job — that is
              the 🏁 button on the job screen, for when the whole job is done.
            </p>
            {err && <div className="error">{err}</div>}
            <div style={{ height: 10 }} />
            <button className="btn ok" disabled={busy} onClick={finish}>
              {busy ? 'Saving…' : visit.status === 'closed' ? 'Save the report' : 'Finish visit'}
            </button>
          </div>
        )}
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
