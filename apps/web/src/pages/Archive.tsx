import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/**
 * Archive — jobs that have been invoiced and sent to the customer.
 *
 * Everyone can see this list, techs included: a splicer standing in a hole
 * needs to be able to pull up what was done here last month, and that history
 * is worth more than the tidiness of hiding it. The dollars are not hidden by
 * hiding this page — they are hidden by RLS on invoice_drafts and by the
 * office-only rate card route. A tech opening an archived job sees the work and
 * can download the field report; he cannot see a price anywhere.
 *
 * Grouped by month because that is how Austin thinks about clearing it out:
 * at month or year end he pulls a period off to the office network by hand.
 */

interface ArchivedJob {
  id: string;
  bm_number: string;
  identifier: string | null;
  title: string | null;
  billing_mode: string;
  invoiced_at: string | null;
  customer: { name: string | null } | null;
}

/** "September 2026" — the heading a month's worth of work sits under. */
function monthLabel(iso: string | null): string {
  if (!iso) return 'No date recorded';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function Archive() {
  const nav = useNavigate();
  const [jobs, setJobs] = useState<ArchivedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    supabase
      .from('jobs')
      .select('id, bm_number, identifier, title, billing_mode, invoiced_at, customer:customers(name)')
      .eq('status', 'invoiced')
      .order('invoiced_at', { ascending: false })
      .then(({ data }) => {
        setJobs((data ?? []) as any);
        setLoading(false);
      });
  }, []);

  const term = q.trim().toLowerCase();
  const shown = term
    ? jobs.filter((j) =>
        [j.bm_number, j.identifier, j.title, j.customer?.name]
          .some((v) => (v ?? '').toLowerCase().includes(term)))
    : jobs;

  // Group into months, preserving the newest-first order the query returned.
  const months: { label: string; jobs: ArchivedJob[] }[] = [];
  for (const j of shown) {
    const label = monthLabel(j.invoiced_at);
    const last = months[months.length - 1];
    if (last && last.label === label) last.jobs.push(j);
    else months.push({ label, jobs: [j] });
  }

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav('/')}>‹ Jobs</button>
        <div className="spacer" />
        <div className="sub">Archive</div>
      </div>

      <div className="content">
        <div className="card">
          <h2>Archive</h2>
          <p className="muted small">
            Jobs that have been invoiced and sent. They're off the working list
            but nothing is deleted — open any one to see the visits, closures and
            field report exactly as they were.
          </p>
          <div style={{ height: 10 }} />
          <input
            placeholder="Search by job number, customer, title…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {loading && <div className="spinner">Loading…</div>}

        {!loading && !jobs.length && (
          <div className="card">
            <strong>Nothing archived yet.</strong>
            <p className="muted small" style={{ marginTop: 6 }}>
              When the office marks a completed job as invoiced, it moves here.
            </p>
          </div>
        )}

        {!loading && jobs.length > 0 && !shown.length && (
          <div className="card">
            <p className="muted small">Nothing matches “{q}”.</p>
          </div>
        )}

        {months.map((m) => (
          <div key={m.label}>
            <div className="muted small" style={{ margin: '14px 2px 6px' }}>
              {m.label} · {m.jobs.length} job{m.jobs.length === 1 ? '' : 's'}
            </div>
            {m.jobs.map((j) => (
              <Link key={j.id} to={`/jobs/${j.id}`} className="card" style={{ display: 'block' }}>
                <div className="row" style={{ alignItems: 'baseline' }}>
                  <strong>{j.bm_number}</strong>
                  <div className="spacer" />
                  <span className="muted small">
                    {j.invoiced_at ? new Date(j.invoiced_at).toLocaleDateString() : ''}
                  </span>
                </div>
                <div className="small">{j.customer?.name ?? '—'}</div>
                {(j.title || j.identifier) && (
                  <div className="muted small">{j.title || j.identifier}</div>
                )}
                {j.billing_mode === 'emergency' && (
                  <span className="pill" style={{ marginTop: 4 }}>LOR</span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
