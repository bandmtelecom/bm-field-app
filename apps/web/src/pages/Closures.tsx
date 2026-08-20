import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { kmlUrl } from '../lib/api';
import {
  closuresNear, searchClosures, cableLabel, type ClosureCandidate,
} from '../lib/closures';
import { STRUCTURE_LABELS } from '../lib/types';

/**
 * The closure registry, for the crew.
 *
 * A tech standing in the street doesn't know the closure number — he knows
 * where he is. So "Closures near me" is the primary way in; search by code is
 * for the office. Tapping one shows everything B&M has ever done there.
 */
export default function Closures() {
  const nav = useNavigate();
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [rows, setRows] = useState<ClosureCandidate[] | null>(null);
  const [mode, setMode] = useState<'near' | 'search'>('near');
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('customers').select('id, name').order('name')
      .then(({ data }) => {
        const list = (data as any[]) ?? [];
        setCustomers(list);
        if (list.length === 1) setCustomerId(list[0].id);
      });
  }, []);

  function findNearMe() {
    if (!customerId) { setMsg('Pick the customer first.'); return; }
    if (!navigator.geolocation) { setMsg('This phone will not give up its location.'); return; }
    setBusy(true); setMsg(null); setMode('near');
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const r = await closuresNear(
          customerId, p.coords.latitude, p.coords.longitude, 1000,
        );
        setRows(r);
        if (!r.length) setMsg('No closures on record within 1,000 ft of here.');
        setBusy(false);
      },
      () => { setMsg('Could not get your location — check the app has permission.'); setBusy(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function runSearch(q: string) {
    setTerm(q); setMode('search'); setMsg(null);
    if (q.trim().length < 2) { setRows(null); return; }
    setBusy(true);
    setRows(await searchClosures(q, customerId || undefined));
    setBusy(false);
  }

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav('/')}>‹ Jobs</button>
        <div className="spacer" />
        <a className="iconbtn" style={{ textDecoration: 'none' }} href={kmlUrl()} target="_blank" rel="noreferrer">
          Google Earth
        </a>
      </div>
      <div className="content">
        <div className="card">
          <h2>Closures</h2>
          <p className="muted small">
            Every closure we've worked, with its permanent number. Tap one to see what we did there.
          </p>

          <label>Customer</label>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">—</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <div style={{ height: 10 }} />
          <button className="btn accent" onClick={findNearMe} disabled={busy}>
            {busy && mode === 'near' ? 'Looking…' : '📍 Closures near me'}
          </button>

          <label style={{ marginTop: 12 }}>Or find one by number</label>
          <input value={term} placeholder="Lumen-0042" onChange={(e) => runSearch(e.target.value)} />

          {msg && <div className="muted small" style={{ marginTop: 8 }}>{msg}</div>}
        </div>

        {rows?.map((c) => (
          <div key={c.id} className="card" style={{ cursor: 'pointer' }}
            onClick={() => nav(`/closures/${c.id}`)}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{c.closure_code}</strong>
              <span className="small muted">
                {c.distanceFt != null ? `${c.distanceFt} ft` : ''}
              </span>
            </div>
            <div className="muted small">
              {STRUCTURE_LABELS[c.structure_type as keyof typeof STRUCTURE_LABELS] ?? c.structure_type}
              {c.structure_owner ? ` · ${c.structure_owner}` : ''}
              {c.building_address ? ` · ${c.building_address}` : ''}
            </div>
            {c.cables.slice(0, 3).map((cb, i) => (
              <div key={i} className="small" style={{ marginTop: 2 }}>• {cableLabel(cb)}</div>
            ))}
            <div className="muted small" style={{ marginTop: 6 }}>
              {c.visitCount > 0
                ? `${c.visitCount} visit(s)${c.lastWorked ? `, last ${c.lastWorked}` : ''}`
                : 'No work logged yet'}
            </div>
          </div>
        ))}

        {rows && rows.length === 0 && !busy && !msg && (
          <div className="card muted small">Nothing found.</div>
        )}
      </div>
    </div>
  );
}
