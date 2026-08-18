import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSession } from '../lib/session';

export default function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await signIn(email.trim(), password);
    if (error) setErr(error);
    setBusy(false);
  }

  return (
    <div className="app">
      <div className="topbar"><h1>B&amp;M Field</h1></div>
      <div className="content">
        <div className="card">
          <h2>Sign in</h2>
          <p className="muted small">Use the account set up for you in the office.</p>
          <form onSubmit={submit}>
            <label>Email</label>
            <input type="email" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
            <label>Password</label>
            <input type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
            {err && <div className="error">{err}</div>}
            <div style={{ height: 14 }} />
            <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
