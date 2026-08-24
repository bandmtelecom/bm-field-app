import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';

/**
 * A tech changing his own password.
 *
 * Everyone starts on a temp password the office typed for them, and until now
 * there was no way to change it — every forgotten or fumbled password was an
 * errand for Austin, who had to delete and recreate the account. With a crew
 * learning the app that does not scale past the first morning.
 */
export default function ChangePassword() {
  const nav = useNavigate();
  const { profile } = useSession();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) { setErr('Make it at least 8 characters.'); return; }
    if (pw !== pw2) { setErr("The two don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setErr(error.message); setBusy(false); return; }
    setDone(true); setBusy(false);
  }

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav('/')}>‹ Jobs</button>
        <div className="spacer" /><div className="sub">My password</div>
      </div>
      <div className="content">
        <div className="card">
          <h2>Change my password</h2>
          <p className="muted small">
            Signed in as {profile?.full_name || 'you'}. Pick something you'll
            remember — you'll type it on your phone in the dark.
          </p>
          {done ? (
            <>
              <p className="small" style={{ color: 'var(--ok)', marginTop: 10 }}>
                Changed. Use the new one next time you sign in.
              </p>
              <div style={{ height: 10 }} />
              <button className="btn" onClick={() => nav('/')}>Back to jobs</button>
            </>
          ) : (
            <form onSubmit={submit}>
              <label>New password</label>
              <input type="password" autoComplete="new-password"
                value={pw} onChange={(e) => setPw(e.target.value)} required />
              <label>Type it again</label>
              <input type="password" autoComplete="new-password"
                value={pw2} onChange={(e) => setPw2(e.target.value)} required />
              {err && <div className="error">{err}</div>}
              <div style={{ height: 12 }} />
              <button className="btn" disabled={busy}>
                {busy ? 'Saving…' : 'Change password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
