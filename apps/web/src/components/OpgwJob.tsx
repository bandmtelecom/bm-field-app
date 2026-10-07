import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { pointSummary, type OpgwPoint } from '../lib/opgw';
import { shortDay } from '../lib/visitDate';

/**
 * The running record of an OPGW job: every splice and test point, in the order
 * they sit on the line. Austin, 10/6: "OPGW is much more simple." No visits, no
 * closures, no invoice — a list of structures and a report.
 *
 * The order is the order the report prints in, so it can be moved up and down.
 * Crews do not always work a line end to end.
 */
export default function OpgwJob({ jobId, closed, isOffice }: {
  jobId: string; closed: boolean; isOffice: boolean;
}) {
  const nav = useNavigate();
  const [points, setPoints] = useState<OpgwPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  async function load() {
    const { data, error } = await supabase.from('opgw_points')
      .select('*').eq('job_id', jobId)
      .order('ordinal', { ascending: true }).order('created_at', { ascending: true });
    if (error) { setErr(error.message); setPoints([]); return; }
    setPoints((data as any) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [jobId]);

  /** Swap two neighbours. Writes every ordinal so ties from same-second saves sort out. */
  async function move(index: number, dir: -1 | 1) {
    if (!points) return;
    const j = index + dir;
    if (j < 0 || j >= points.length) return;
    const next = [...points];
    [next[index], next[j]] = [next[j], next[index]];
    setPoints(next);
    setMoving(true); setErr(null);
    const results = await Promise.all(next.map((p, i) =>
      p.ordinal === i ? null
        : supabase.from('opgw_points').update({ ordinal: i }).eq('id', p.id).select('id').single()));
    setMoving(false);
    const failed = results.find((r) => r && r.error);
    if (failed?.error) setErr(failed.error.message);
    await load();
  }

  if (!points) return <div className="spinner">Loading…</div>;

  const splices = points.filter((p) => p.kind === 'splice');
  const tests = points.filter((p) => p.kind === 'test');
  const canEdit = !closed || isOffice;

  let s = 0, t = 0;
  return (
    <>
      <h3 className="muted small" style={{ margin: '4px 2px' }}>
        STRUCTURES · {splices.length} splice{splices.length === 1 ? '' : 's'} · {tests.length} test point{tests.length === 1 ? '' : 's'}
      </h3>

      {points.map((p, i) => {
        const label = p.kind === 'test' ? `T${++t}` : String(++s);
        const hasGps = p.gps_lat != null && p.gps_lng != null;
        return (
          <div key={p.id} className="card" style={{ padding: 12 }}>
            <div className="row" style={{ alignItems: 'center', gap: 10 }}>
              <span style={{
                flex: '0 0 auto', minWidth: 30, height: 30, borderRadius: 15, padding: '0 6px',
                background: p.kind === 'test' ? 'var(--muted)' : 'var(--navy)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13,
              }}>{label}</span>
              <button
                onClick={() => canEdit && nav(`/jobs/${jobId}/opgw/${p.id}`)}
                style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 0, padding: 0,
                  color: 'inherit', font: 'inherit', cursor: canEdit ? 'pointer' : 'default' }}>
                <strong>{p.kind === 'test' && p.tested_from === 'hub' ? p.name : `Structure ${p.name}`}</strong>
                <span className="small muted" style={{ display: 'block' }}>
                  {pointSummary(p)}
                </span>
                <span className="small muted" style={{ display: 'block' }}>
                  {shortDay(p.work_date)}
                  {(p.techs ?? []).length ? ` · 👷 ${p.techs.join(', ')}` : ''}
                  {hasGps ? '' : ' · ⚠ no GPS'}
                  {p.row_lat != null ? ' · ROW entrance ✓' : ''}
                </span>
                {p.notes && <span className="small" style={{ display: 'block', marginTop: 4 }}>{p.notes}</span>}
              </button>
              {canEdit && points.length > 1 && (
                <span style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button className="iconbtn" aria-label="Move up" disabled={moving || i === 0}
                    style={{ background: 'var(--navy)', minWidth: 44 }} onClick={() => move(i, -1)}>▲</button>
                  <button className="iconbtn" aria-label="Move down" disabled={moving || i === points.length - 1}
                    style={{ background: 'var(--navy)', minWidth: 44 }} onClick={() => move(i, 1)}>▼</button>
                </span>
              )}
            </div>
          </div>
        );
      })}
      {!points.length && (
        <div className="card muted small">Nothing logged yet. Add the first structure below.</div>
      )}
      {points.length > 1 && canEdit && (
        <p className="muted small" style={{ margin: '0 2px 8px' }}>
          The report prints them in this order. Use ▲ ▼ to put them in order down the line.
        </p>
      )}
      {err && <div className="error">{err}</div>}

      {!closed && (
        <>
          <button className="btn accent" onClick={() => nav(`/jobs/${jobId}/opgw/new?kind=splice`)}>
            ＋ Add a splice
          </button>
          <div style={{ height: 8 }} />
          <button className="btn ghost" onClick={() => nav(`/jobs/${jobId}/opgw/new?kind=test`)}>
            ＋ Add a test point
          </button>
          <div style={{ height: 10 }} />
        </>
      )}
    </>
  );
}
