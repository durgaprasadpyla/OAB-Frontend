import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { landingPath } from '../lib/roles.js';

export default function Login() {
  const { login, isAuthed, role } = useAuth();
  const nav = useNavigate();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (isAuthed) nav(landingPath(role), { replace: true }); }, [isAuthed, role, nav]);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const d = await login(u.trim(), p);
      nav(landingPath(d.role), { replace: true });
    } catch {
      setErr('Invalid username or password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">🌿 Bloomflex <span>OAB</span></div>
        <div className="login-sub">Sign in to continue</div>
        <label>Username</label>
        <input value={u} onChange={e => setU(e.target.value)} autoFocus autoComplete="username" />
        <label>Password</label>
        <input type="password" value={p} onChange={e => setP(e.target.value)} autoComplete="current-password" />
        <div className="login-err">{err}</div>
        <button disabled={busy || !u || !p}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
