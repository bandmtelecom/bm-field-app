import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import type { Job } from '../lib/types';

export default function Jobs() {
  const { profile, signOut } = useSession();
  const nav = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('jobs')
      .select('id, bm_number, identifier, identifier_type, title, billing_mode, status, customer:customers(name, code)')
      .neq('status', 'invoiced')
      .order('bm_number', { ascending: false })
      .then(({ data }) => { setJobs((data as any) ?? []); setLoading(false); });
  }, []);

  const filtered = jobs.filter((j) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [j.bm_number, j.identifier, j.title, j.customer?.name]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
  });

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <h1>Jobs</h1>
          <div className="sub">{profile?.full_name ?? ''} · {profile?.role}</div>
        </div>
        <div className="spacer" />
        {profile?.role === 'admin' && (
          <button className="iconbtn" onClick={() => nav('/admin')}>Admin</button>
        )}
        <button className="iconbtn" onClick={() => nav('/closures')}>Closures</button>
        <button className="iconbtn" onClick={() => nav('/password')}>Password</button>
        <button className="iconbtn" onClick={() => signOut()}>Sign out</button>
      </div>
      <div className="content">
        <input placeholder="Look up a job (e.g. 26-408)" value={q}
          onChange={(e) => setQ(e.target.value)} inputMode="text" />
        <div style={{ height: 12 }} />
        {loading ? <div className="spinner">Loading jobs…</div> : (
          <ul className="joblist">
            {filtered.map((j) => (
              <li key={j.id} className="jobitem" onClick={() => nav(`/jobs/${j.id}`)}>
                <div>
                  <div className="jobnum">{j.bm_number}</div>
                  <div className="small muted">{j.customer?.name} · {j.identifier ?? j.title ?? ''}</div>
                </div>
                <div className="spacer" style={{ flex: 1 }} />
                {j.billing_mode === 'emergency' && <span className="badge emergency">LOR/EMG</span>}
                <span className={`badge ${j.status === 'open' ? 'open' : ''}`}>{j.status}</span>
              </li>
            ))}
            {!filtered.length && <li className="muted small center">No matching jobs.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
