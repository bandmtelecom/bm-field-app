import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { splitNames, joinNames, todayLocal } from '../lib/num';
import { visitDateProblem, isBackdated, shortDay } from '../lib/visitDate';
import {
  SPLICE_TYPES, CABLE_COUNTS, emptyOpgwForm, formFromPoint, formProblems, rowFromForm,
  parseCoordPair, looksEastern, customerLabel, type OpgwForm, type OpgwPoint,
} from '../lib/opgw';

/**
 * Add or fix one OPGW structure — a splice or a test point.
 *
 * The shape is Austin's (10/6–10/7):
 *   - Splice: structure #, GPS, optional ROW entrance GPS, 2-way / 3-way /
 *     transition / termination / other (2-way already picked — "95% of the
 *     time"), cable count 48 / 96 / 144 / other, one notes box.
 *   - Test point: tested from a structure or a hub, its name, GPS, notes.
 *   - No pass-through. "we dont need that at all."
 */
export default function OpgwPointPage() {
  const { id: jobId, pointId } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { userId, profile } = useSession();
  const isNew = !pointId || pointId === 'new';
  const isOffice = profile?.role === 'office' || profile?.role === 'admin';

  const [job, setJob] = useState<any>(null);
  const [existing, setExisting] = useState<OpgwPoint | null>(null);
  const [form, setForm] = useState<OpgwForm>(
    emptyOpgwForm(todayLocal(), '', sp.get('kind') === 'test' ? 'test' : 'splice'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string[] | null>(null);
  const [gpsErr, setGpsErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    (async () => {
      const { data: j } = await supabase.from('jobs')
        .select('id, bm_number, title, identifier, status, customer_other, customer:customers(name)')
        .eq('id', jobId).single();
      setJob(j);
      if (!isNew) {
        const { data: p } = await supabase.from('opgw_points').select('*').eq('id', pointId).single();
        if (p) { setExisting(p as any); setForm(formFromPoint(p as any)); }
        return;
      }
      // Carry the crew forward from this man's last structure on this job —
      // the same pair walks the whole line most days.
      const { data: last } = await supabase.from('opgw_points')
        .select('techs').eq('job_id', jobId).eq('created_by', userId ?? '')
        .order('created_at', { ascending: false }).limit(1);
      const lastCrew = (last as any)?.[0]?.techs ?? [];
      const crew = lastCrew.length ? joinNames(lastCrew) : (profile?.full_name ?? '');
      setForm((f) => ({ ...f, techs: f.techs || crew }));
    })();
  }, [jobId, pointId, isNew, userId, profile?.full_name]);

  const set = (patch: Partial<OpgwForm>) => setForm((f) => ({ ...f, ...patch }));

  /** A whole "lat, lng" pasted into either box lands in both. */
  function setCoord(which: 'gps' | 'row', axis: 'lat' | 'lng', value: string) {
    const pair = parseCoordPair(value);
    if (pair) set(which === 'gps'
      ? { gps_lat: String(pair.lat), gps_lng: String(pair.lng) }
      : { row_lat: String(pair.lat), row_lng: String(pair.lng) });
    else set({ [`${which}_${axis}`]: value } as Partial<OpgwForm>);
  }

  function grab(which: 'gps' | 'row') {
    setGpsErr(null);
    if (!navigator.geolocation) { setGpsErr('This phone will not give a GPS fix. Type it in.'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = p.coords.latitude.toFixed(6), lng = p.coords.longitude.toFixed(6);
        set(which === 'gps' ? { gps_lat: lat, gps_lng: lng } : { row_lat: lat, row_lng: lng });
      },
      () => setGpsErr('Could not get GPS. Step out from under the steel and try again, or type it in.'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  async function save() {
    const problems = formProblems(form);
    const dateProblem = visitDateProblem(form.work_date, todayLocal());
    if (dateProblem) problems.push(dateProblem);
    if (problems.length) { setErr(problems); return; }
    setBusy(true); setErr(null);
    const row = rowFromForm(form, splitNames);
    let error;
    if (isNew) {
      const { data: last } = await supabase.from('opgw_points')
        .select('ordinal').eq('job_id', jobId).order('ordinal', { ascending: false }).limit(1);
      const ordinal = ((last as any)?.[0]?.ordinal ?? -1) + 1;
      ({ error } = await supabase.from('opgw_points')
        .insert({ ...row, job_id: jobId, ordinal, created_by: userId }).select('id').single());
    } else {
      ({ error } = await supabase.from('opgw_points')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('id', pointId).select('id').single());
    }
    setBusy(false);
    // Never swallow a Supabase error — a structure that silently did not save
    // is a hole in the customer's report.
    if (error) { setErr([error.message]); return; }
    nav(`/jobs/${jobId}`);
  }

  async function remove() {
    setBusy(true); setErr(null);
    const { error } = await supabase.from('opgw_points').delete().eq('id', pointId).select('id').single();
    setBusy(false);
    if (error) { setErr([error.message]); return; }
    nav(`/jobs/${jobId}`);
  }

  if (!job || (!isNew && !existing)) return <div className="spinner">Loading…</div>;

  const isSplice = form.kind === 'splice';
  const nameLabel = isSplice ? 'Structure #'
    : form.tested_from === 'hub' ? 'Hub name' : 'Structure #';
  const canDelete = !isNew && (isOffice || existing?.created_by === userId);

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav(`/jobs/${jobId}`)}>‹ {job.bm_number}</button>
        <div className="spacer" />
        <div className="sub">OPGW · {customerLabel(job.customer?.name, job.customer_other)}</div>
      </div>
      <div className="content">
        <div className="card">
          <h2>{isNew ? (isSplice ? 'Add a splice' : 'Add a test point') : 'Fix this structure'}</h2>
          <div className="small muted">{[job.identifier, job.title].filter(Boolean).join(' · ')}</div>
        </div>

        <div className="card">
          <div className="seg" role="group" aria-label="What are you logging">
            <button type="button" className={isSplice ? 'on' : ''} onClick={() => set({ kind: 'splice' })}>Splice</button>
            <button type="button" className={!isSplice ? 'on' : ''} onClick={() => set({ kind: 'test' })}>Test point</button>
          </div>

          {!isSplice && (
            <>
              <label style={{ marginTop: 12 }}>Tested from</label>
              <div className="seg">
                <button type="button" className={form.tested_from === 'structure' ? 'on' : ''}
                  onClick={() => set({ tested_from: 'structure' })}>Structure</button>
                <button type="button" className={form.tested_from === 'hub' ? 'on' : ''}
                  onClick={() => set({ tested_from: 'hub' })}>Hub</button>
              </div>
            </>
          )}

          <label htmlFor="opgw-name" style={{ marginTop: 12 }}>{nameLabel}</label>
          <input id="opgw-name" value={form.name} onChange={(e) => set({ name: e.target.value })}
            placeholder={!isSplice && form.tested_from === 'hub' ? 'Shankle sub' : '34/9'} />
        </div>

        <div className="card">
          <label>{isSplice ? 'Structure GPS' : 'GPS'}</label>
          <div className="row">
            <input aria-label="Latitude" placeholder="lat" inputMode="decimal" value={form.gps_lat}
              onChange={(e) => setCoord('gps', 'lat', e.target.value)} />
            <input aria-label="Longitude" placeholder="lng" inputMode="decimal" value={form.gps_lng}
              onChange={(e) => setCoord('gps', 'lng', e.target.value)} />
            <button type="button" className="iconbtn" style={{ background: 'var(--navy)', flex: '0 0 auto' }}
              onClick={() => grab('gps')}>Grab</button>
          </div>
          <p className="muted small" style={{ marginTop: 4 }}>
            Tap Grab at the structure. You can also paste or type it — 32°15'42"N 96°21'30"W works too.
          </p>
          {looksEastern(form.gps_lng) && (
            <div className="card" style={{ borderColor: 'var(--accent)', marginTop: 8 }}>
              <strong className="small">That longitude is in the eastern hemisphere.</strong>
              <p className="small muted">Texas longitudes are negative. Looks like the minus sign got dropped.</p>
              <button type="button" className="btn ghost" onClick={() => set({ gps_lng: `-${form.gps_lng.trim()}` })}>
                Change to −{form.gps_lng.trim()}
              </button>
            </div>
          )}
        </div>

        {isSplice && (
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label style={{ margin: 0 }}>ROW entrance GPS</label>
              <span className="small muted" style={{ flex: '0 0 auto' }}>Optional</span>
            </div>
            <p className="muted small" style={{ marginTop: 2 }}>
              Where you get onto the right-of-way, when it's a long way from the structure.
            </p>
            <div className="row">
              <input aria-label="Entrance latitude" placeholder="lat" inputMode="decimal" value={form.row_lat}
                onChange={(e) => setCoord('row', 'lat', e.target.value)} />
              <input aria-label="Entrance longitude" placeholder="lng" inputMode="decimal" value={form.row_lng}
                onChange={(e) => setCoord('row', 'lng', e.target.value)} />
              <button type="button" className="iconbtn" style={{ background: 'var(--navy)', flex: '0 0 auto' }}
                onClick={() => grab('row')}>Grab</button>
            </div>
            {looksEastern(form.row_lng) && (
              <button type="button" className="btn ghost" style={{ marginTop: 8 }}
                onClick={() => set({ row_lng: `-${form.row_lng.trim()}` })}>
                Change entrance longitude to −{form.row_lng.trim()}
              </button>
            )}
            {(form.row_lat || form.row_lng) && (
              <button type="button" className="addline" style={{ marginTop: 8 }}
                onClick={() => set({ row_lat: '', row_lng: '' })}>Clear the entrance GPS</button>
            )}
          </div>
        )}
        {gpsErr && <div className="error">{gpsErr}</div>}

        {isSplice && (
          <div className="card">
            <label>What's at this structure?</label>
            <div className="seg">
              {SPLICE_TYPES.map(([k, l]) => (
                <button key={k} type="button" className={form.splice_type === k ? 'on' : ''}
                  onClick={() => set({ splice_type: k })}>{l}</button>
              ))}
            </div>
            {form.splice_type === 'other' ? (
              <input style={{ marginTop: 8 }} aria-label="What the splice is" placeholder="Type what it is"
                value={form.splice_type_other} onChange={(e) => set({ splice_type_other: e.target.value })} />
            ) : (
              <p className="muted small" style={{ marginTop: 4 }}>
                2-way is picked for you. Tap another if it's different.
              </p>
            )}

            <label style={{ marginTop: 12 }}>Cable count</label>
            <div className="seg">
              {CABLE_COUNTS.map(([k, l]) => (
                <button key={k} type="button" className={form.cable_count === k ? 'on' : ''}
                  onClick={() => set({ cable_count: k })}>{l}</button>
              ))}
            </div>
            {form.cable_count === 'other' && (
              <input style={{ marginTop: 8 }} aria-label="Cable count" placeholder="Type the count" inputMode="numeric"
                value={form.cable_count_other} onChange={(e) => set({ cable_count_other: e.target.value })} />
            )}
          </div>
        )}

        <div className="card">
          <label htmlFor="opgw-crew">Crew</label>
          <input id="opgw-crew" value={form.techs} onChange={(e) => set({ techs: e.target.value })}
            placeholder="A.J., Hunter" />

          <label htmlFor="opgw-date" style={{ marginTop: 12 }}>Date the work was done</label>
          <input id="opgw-date" type="date" value={form.work_date} max={todayLocal()}
            onChange={(e) => set({ work_date: e.target.value })} />
          {isBackdated(form.work_date, todayLocal()) && (
            <p className="small" style={{ marginTop: 4, color: 'var(--accent)', fontWeight: 600 }}>
              Backdated to {shortDay(form.work_date)}.
            </p>
          )}

          <label htmlFor="opgw-notes" style={{ marginTop: 12 }}>Notes</label>
          <textarea id="opgw-notes" value={form.notes} onChange={(e) => set({ notes: e.target.value })}
            placeholder={isSplice ? 'Distance from the sub, fixes, anything the next crew should know' : 'What you tested and when'} />
        </div>

        {err && <div className="card" style={{ borderColor: 'var(--danger)' }}>
          {err.map((e) => <div key={e} className="error" style={{ marginTop: 2 }}>{e}</div>)}
        </div>}

        <button className="btn ok" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : isNew ? (isSplice ? 'Save this splice' : 'Save this test point') : 'Save changes'}
        </button>
        <div style={{ height: 8 }} />
        <button className="btn ghost" disabled={busy} onClick={() => nav(`/jobs/${jobId}`)}>Cancel</button>

        {canDelete && (
          <>
            <div style={{ height: 16 }} />
            {!confirmDelete ? (
              <button className="addline" style={{ color: 'var(--danger)' }} disabled={busy}
                onClick={() => setConfirmDelete(true)}>Delete this structure</button>
            ) : (
              <div className="card" style={{ borderColor: 'var(--danger)' }}>
                <strong>Delete {existing?.name}?</strong>
                <p className="small muted">It comes off the job and off the report. This can't be undone.</p>
                <button className="btn" style={{ background: 'var(--danger)' }} disabled={busy} onClick={remove}>
                  {busy ? 'Deleting…' : 'Yes, delete it'}
                </button>
                <div style={{ height: 8 }} />
                <button className="btn ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep it</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
