import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { locationTitle } from '../lib/types';
import LocationBlock, { emptyLocation, type LocationForm, type PriorLocation } from '../components/LocationBlock';
import { joinNames } from '../lib/num';
import { loadPriorLocations } from '../lib/priorLocations';
import { previewPmNumbers } from '../lib/locationNo';
import { saveLocation } from '../lib/saveLocation';

/**
 * Add ONE location onto a visit somebody has already started.
 *
 * Austin, 9/8: "if armando starts a visit and josh l is working that same job
 * on a different location we need to make it where josh l can add a location
 * to armandos visit."
 *
 * So this screen is the same LocationBlock the crew already knows, saved on
 * its own the moment the man taps the button. Whoever is on the job can use
 * it — the lead, the second crew in the other hole, anybody — and the location
 * lands on the visit the lead started. Nothing about the visit itself
 * (summary, status, hours) lives here; that is the lead's Finish screen.
 */
export default function AddLocation() {
  const { id: jobId, visitId } = useParams();
  const nav = useNavigate();
  const { userId, profile } = useSession();

  const [job, setJob] = useState<any>(null);
  const [visit, setVisit] = useState<any>(null);
  const [form, setForm] = useState<LocationForm>(emptyLocation());
  const [prior, setPrior] = useState<PriorLocation[]>([]);
  /** How many locations the visit already has — this one goes on the end. */
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Saved, but a closure or a photo did not make it. */
  const [warn, setWarn] = useState<string[] | null>(null);
  /** The lead finished the visit while this man was still typing. His work
   *  still saved — that is the rule — but he should know. */
  const [lateNote, setLateNote] = useState(false);

  useEffect(() => {
    if (!jobId || !visitId) return;
    (async () => {
      const { data: j } = await supabase.from('jobs')
        .select('id, bm_number, customer_id, billing_mode, title').eq('id', jobId).single();
      setJob(j);
      const { data: v } = await supabase.from('visits')
        .select('id, visit_date, status, reporter_id, reporter:profiles!visits_reporter_id_fkey(full_name), locations(id, ordinal, techs, tech_id, created_at)')
        .eq('id', visitId).single();
      setVisit(v);
      const locs = ((v as any)?.locations ?? []) as any[];
      setCount(locs.length);

      // Carry the crew forward. Most nights the same men move hole to hole, so
      // the box starts with the crew from the LAST location THIS man filed on
      // this visit — never somebody else's crew, which is the whole point of
      // two men filing two holes.
      const mine = locs
        .filter((l) => l.tech_id === userId)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const lastCrew = Array.isArray(mine[0]?.techs) ? mine[0].techs : [];
      const defaultCrew = lastCrew.length ? joinNames(lastCrew) : (profile?.full_name ?? '');
      setForm((f) => ({ ...f, techs: f.techs || defaultCrew }));
    })();
  }, [jobId, visitId, userId, profile?.full_name]);

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    loadPriorLocations(jobId)
      .then((rows) => { if (alive) setPrior(rows); })
      // Not fatal — the location still files. The man is just not offered the
      // return-trip list and his hole gets a fresh number, which the office
      // can fix in one click on Edit Location.
      .catch((e) => console.error('could not load the job\'s earlier locations', e));
    return () => { alive = false; };
  }, [jobId]);

  // The number this location ends up with — what he typed, or the next one in
  // line. Same arithmetic the database runs on insert.
  const autoNo = previewPmNumbers(prior, [form])[0] ?? null;
  const label = locationTitle({ pm_location_no: autoNo ?? String(count + 1) });

  async function submit() {
    if (!jobId || !visitId || !job) return;
    setBusy(true); setErr(null); setWarn(null);
    try {
      // Is it still open? Saved either way — but say so if it was closed.
      const { data: fresh } = await supabase.from('visits').select('status').eq('id', visitId).single();
      const closed = fresh?.status === 'closed';

      const r = await saveLocation({
        jobId, visitId, customerId: job.customer_id ?? null, userId,
        form, label, ordinal: count,
      });

      if (r.warnings.length || closed) {
        // Stay on the page and say it plainly. Navigating away would bury it.
        setLateNote(closed);
        setWarn(r.warnings);
        setBusy(false);
        return;
      }
      nav(`/jobs/${jobId}`);
    } catch (e: any) {
      setErr(e.message ?? 'Something went wrong saving the location.');
      setBusy(false);
    }
  }

  const leadName = visit?.reporter?.full_name ?? null;
  const isLead = !!visit && visit.reporter_id === userId;

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav(`/jobs/${jobId}`)}>‹ Cancel</button>
        <div className="spacer" />
        <div className="sub">{job?.bm_number}</div>
      </div>
      <div className="content">
        <div className="card">
          <h2>Add my location</h2>
          <p className="muted small" style={{ marginTop: 2 }}>
            {visit
              ? <>Goes on the visit {isLead ? 'you' : (leadName ?? 'the lead')} started
                  {visit.visit_date ? ` on ${visit.visit_date}` : ''}
                  {count ? ` · ${count} location${count === 1 ? '' : 's'} on it so far` : ''}.</>
              : 'Loading the visit…'}
          </p>
          <p className="muted small" style={{ marginTop: 4 }}>
            {job?.billing_mode === 'emergency'
              ? 'Put the men who were in THIS hole in the crew box. Every man earns drive time on an LOR, and standby bills for each of them.'
              : 'Put the men who were in THIS hole in the crew box — standby time bills for every man in the hole.'}
          </p>
        </div>

        <LocationBlock value={form} index={0} customerId={job?.customer_id ?? null}
          priorLocations={prior} autoNo={autoNo}
          onChange={setForm}
          onRemove={() => nav(`/jobs/${jobId}`)} />

        {err && <div className="error">{err}</div>}

        {warn && (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <strong>Your location saved{warn.length ? ' — but not everything went with it.' : '.'}</strong>
            {lateNote && (
              <p className="small" style={{ marginTop: 6 }}>
                {leadName ?? 'The lead'} finished this visit before you hit save. Your
                location went on it anyway and the office can see it — just let
                {leadName ? ` ${leadName}` : ' him'} know.
              </p>
            )}
            {warn.length > 0 && (
              <>
                <p className="small" style={{ marginTop: 6 }}>
                  Everything you typed is safe. What didn't finish is listed below —
                  usually a photo that wouldn't upload on a bad signal, or a closure
                  that didn't get added to the permanent list.
                </p>
                <ul className="small" style={{ marginTop: 6, paddingLeft: 18 }}>
                  {warn.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
                <p className="muted small" style={{ marginTop: 6 }}>
                  Photos can be added again later from the location. Anything else
                  here, send to the office — it needs fixing, not retrying.
                </p>
              </>
            )}
            <div style={{ height: 10 }} />
            <button className="btn" onClick={() => nav(`/jobs/${jobId}`)}>Got it, back to the job</button>
          </div>
        )}

        <div style={{ height: 12 }} />
        {!warn && (
          <button className="btn" disabled={busy || !visit} onClick={submit}>
            {busy ? 'Saving…' : 'Save this location'}
          </button>
        )}
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
