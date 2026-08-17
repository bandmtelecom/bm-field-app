import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { listUsers, createUser, updateUser, AdminUser } from '../lib/api';

type Tab = 'users' | 'jobs';

export default function Admin() {
  const { profile } = useSession();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('users');

  if (profile?.role !== 'admin') {
    return (
      <div className="app">
        <div className="topbar"><button className="back" onClick={() => nav('/')}>‹ Jobs</button></div>
        <div className="content"><div className="card">Admins only.</div></div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav('/')}>‹ Jobs</button>
        <div className="spacer" /><div className="sub">Admin</div>
      </div>
      <div className="content">
        <div className="seg" style={{ marginBottom: 12 }}>
          <button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>Users</button>
          <button className={tab === 'jobs' ? 'on' : ''} onClick={() => setTab('jobs')}>Create job</button>
        </div>
        {tab === 'users' ? <UsersPanel selfId={profile.id} /> : <JobsPanel />}
      </div>
    </div>
  );
}

// ---- Users -----------------------------------------------------------------
function UsersPanel({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // add-user form
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('tech');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    try { setUsers(await listUsers()); }
    catch (e: any) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setMsg(null);
    try {
      await createUser({ email: email.trim(), password, full_name: fullName.trim(), role });
      setMsg(`Added ${email} as ${role}.`);
      setEmail(''); setFullName(''); setPassword(''); setRole('tech');
      await load();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function setUserRole(u: AdminUser, newRole: string) {
    try { await updateUser(u.id, { role: newRole }); await load(); }
    catch (e: any) { setErr(e.message); }
  }
  async function toggleActive(u: AdminUser) {
    try { await updateUser(u.id, { is_active: !u.is_active }); await load(); }
    catch (e: any) { setErr(e.message); }
  }

  function genPassword() {
    // simple readable temp password
    const w = Math.random().toString(36).slice(2, 8);
    setPassword(`BM-${w}!${Math.floor(Math.random() * 90 + 10)}`);
  }

  return (
    <>
      <div className="card">
        <h2>Add user</h2>
        <p className="muted small">Creates a login. Send them the email + temp password; they can change it after signing in.</p>
        <form onSubmit={add}>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Full name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Matt King" />
          <div className="row">
            <div>
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="tech">Tech (no prices)</option>
                <option value="office">Office (sees prices)</option>
                <option value="admin">Admin (sees prices + manages users)</option>
              </select>
            </div>
            <div>
              <label>Temp password</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" className="iconbtn" style={{ background: 'var(--navy)' }} onClick={genPassword}>Gen</button>
              </div>
            </div>
          </div>
          {err && <div className="error">{err}</div>}
          {msg && <div className="small" style={{ color: 'var(--ok)', marginTop: 8 }}>{msg}</div>}
          <div style={{ height: 12 }} />
          <button className="btn" disabled={busy}>{busy ? 'Adding…' : 'Add user'}</button>
        </form>
      </div>

      <div className="card">
        <h2>Users</h2>
        {loading ? <div className="muted small">Loading…</div> : (
          <table>
            <thead><tr><th>User</th><th>Role</th><th className="num">Status</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.full_name || <span className="muted">—</span>}
                    <div className="muted" style={{ fontSize: 11 }}>{u.email}</div>
                  </td>
                  <td>
                    <select value={u.role} onChange={(e) => setUserRole(u, e.target.value)}
                      disabled={u.id === selfId} style={{ padding: '4px 6px', fontSize: 13 }}>
                      <option value="tech">tech</option>
                      <option value="office">office</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="num">
                    {u.id === selfId ? <span className="pill">you</span> : (
                      <button className={u.is_active ? 'rm' : 'addline'}
                        style={{ padding: '4px 8px', width: 'auto', fontSize: 12 }}
                        onClick={() => toggleActive(u)}>
                        {u.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small" style={{ marginTop: 8 }}>
          Deactivate = instant lockout (can't log in, cache wipes). Reactivate restores access.
        </p>
      </div>
    </>
  );
}

// ---- Create job ------------------------------------------------------------
function JobsPanel() {
  const [customers, setCustomers] = useState<{ id: string; name: string; code: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [bm, setBm] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [idType, setIdType] = useState('n_number');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState('capital');

  // add-customer
  const [newCustName, setNewCustName] = useState('');
  const [newCustCode, setNewCustCode] = useState('');

  async function loadCustomers() {
    const { data } = await supabase.from('customers').select('id, name, code').order('name');
    setCustomers((data as any) ?? []);
  }
  useEffect(() => { loadCustomers(); }, []);

  // auto-suggest billing mode from identifier type
  useEffect(() => {
    setMode(idType === 'lor' || idType === 'tt' ? 'emergency' : 'capital');
  }, [idType]);

  async function addCustomer() {
    if (!newCustName.trim() || !newCustCode.trim()) return;
    const { error } = await supabase.from('customers')
      .insert({ name: newCustName.trim(), code: newCustCode.trim() });
    if (error) { setErr(error.message); return; }
    setNewCustName(''); setNewCustCode(''); await loadCustomers();
  }

  async function createJob(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setMsg(null);
    const { error } = await supabase.from('jobs').insert({
      bm_number: bm.trim(), customer_id: customerId, identifier: identifier.trim() || null,
      identifier_type: idType, title: title.trim() || null, billing_mode: mode, status: 'open',
    });
    if (error) { setErr(error.message); setBusy(false); return; }
    setMsg(`Job ${bm} created — it's now on the crew's roster.`);
    setBm(''); setIdentifier(''); setTitle('');
    setBusy(false);
  }

  return (
    <>
      <div className="card">
        <h2>Create job</h2>
        <p className="muted small">Appears on the crew's app immediately. LOR/TT default to emergency (hourly) billing.</p>
        <form onSubmit={createJob}>
          <div className="row">
            <div><label>B&amp;M #</label><input value={bm} onChange={(e) => setBm(e.target.value)} placeholder="26-409" required /></div>
            <div>
              <label>Customer</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                <option value="">—</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <div>
              <label>Identifier type</label>
              <select value={idType} onChange={(e) => setIdType(e.target.value)}>
                <option value="n_number">N-number</option>
                <option value="tt">Trouble Ticket</option>
                <option value="lor">LOR</option>
                <option value="address">Address</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div><label>Identifier</label><input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="N1090034" /></div>
          </div>
          <label>Title / location</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="101 W Abram St — Metron Ring 1" />
          <label>Billing mode</label>
          <div className="seg">
            <button type="button" className={mode === 'capital' ? 'on' : ''} onClick={() => setMode('capital')}>Capital (per-unit)</button>
            <button type="button" className={mode === 'emergency' ? 'on' : ''} onClick={() => setMode('emergency')}>Emergency/LOR (hourly)</button>
          </div>
          {err && <div className="error">{err}</div>}
          {msg && <div className="small" style={{ color: 'var(--ok)', marginTop: 8 }}>{msg}</div>}
          <div style={{ height: 12 }} />
          <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create job'}</button>
        </form>
      </div>

      <div className="card">
        <h3>Add a customer</h3>
        <div className="row">
          <input placeholder="Name (Lumen Technologies)" value={newCustName} onChange={(e) => setNewCustName(e.target.value)} />
          <input placeholder="Code (Lumen)" value={newCustCode} onChange={(e) => setNewCustCode(e.target.value)} />
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>Code seeds closure IDs (e.g. Lumen-0001). Short, no spaces.</p>
        <button className="btn ghost" onClick={addCustomer}>Add customer</button>
      </div>
    </>
  );
}
