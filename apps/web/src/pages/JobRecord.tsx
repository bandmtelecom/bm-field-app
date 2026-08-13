import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { markJobComplete } from '../lib/api';
import { STRUCTURE_LABELS } from '../lib/types';
import type { Job, Visit } from '../lib/types';

export default function JobRecord() {
  const { id } = useParams();
  const nav = useNavigate();
  const { profile } = useSession();
  const [job, setJob] = useState<Job | null>(null);
  const [visits, setVisits] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const { data: j } = await supabase.from('jobs')
      .select('id, bm_number, identifier, identifier_type, title, billing_mode, status, customer:customers(name, code)')
      .eq('id', id).single();
    setJob(j as any);
    const { data: v } = await supabase.from('visits')
      .select('id, visit_date, report_type, techs, narrative, status_flag, lead_hours, locations(id, pm_location_no, structure_type, splice_type, splice_count, closures(closure_code))')
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
              ? <span className="badge emergency">LOR / Emergency — hourly</span>
              : <span className="pill">Capital — per unit</span>}
          </div>
        </div>

        <h3 className="muted small" style={{ margin: '4px 2px' }}>RUNNING RECORD · {visits.length} visit(s)</h3>
        {visits.map((v) => (
          <div key={v.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{v.visit_date}</strong>
              <span className="small muted">{(v.techs ?? []).join(', ')}</span>
            </div>
            {v.status_flag && <div className="pill" style={{ marginTop: 6 }}>{v.status_flag.replace(/_/g, ' ')}</div>}
            {v.narrative && <p className="small" style={{ marginTop: 8 }}>{v.narrative}</p>}
            {(v.locations ?? []).map((l: any) => (
              <div key={l.id} className="small" style={{ marginTop: 6 }}>
                📍 <strong>{l.closures?.closure_code ?? `Loc ${l.pm_location_no ?? ''}`}</strong>
                {' · '}{STRUCTURE_LABELS[l.structure_type as keyof typeof STRUCTURE_LABELS] ?? l.structure_type}
                {l.splice_type ? ` · ${l.splice_count} ${l.splice_type}` : ''}
              </div>
            ))}
          </div>
        ))}
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
            <Link className="btn ghost" to={`/jobs/${id}/invoice`}>View draft invoice</Link>
          </>
        )}
      </div>
    </div>
  );
}
