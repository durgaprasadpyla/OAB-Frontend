import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { landingPath } from '../lib/roles.js';
import { LOGIN_LOGO } from '../lib/loginLogo.js';

// Enterprise sign-in — a native port of OAB-App's integration-login.js, which
// reparents the plain auth modal into a two-column card. Same layout, copy and
// behaviour; the auth call itself is unchanged.
//
// Remember-me stores the USERNAME only, never the password.
// There is no self-service reset — passwords are reset by an administrator —
// so "Forgot password?" says so rather than linking to a dead flow.

const REMEMBER_KEY = 'blm_remember_user';

const Ic = {
  user: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
};

const SELLING_POINTS = [
  'Real-time order & production tracking',
  'GST invoicing & packing lists',
  'Role-based access & full audit trail',
];

export default function Login() {
  const { login, isAuthed, role } = useAuth();
  const nav = useNavigate();

  const [u, setU] = useState(() => { try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; } });
  const [p, setP] = useState('');
  const [remember, setRemember] = useState(() => { try { return !!localStorage.getItem(REMEMBER_KEY); } catch { return false; } });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (isAuthed) nav(landingPath(role), { replace: true }); }, [isAuthed, role, nav]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setInfo(false);
    setBusy(true);
    try {
      const d = await login(u.trim(), p);
      // Username only — storing the password would defeat the point of the login.
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, u.trim());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch { /* private mode — remember-me is a convenience, not a requirement */ }
      nav(landingPath(d.role), { replace: true });
    } catch {
      setErr('Invalid username or password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="auth-modal">
      <div className="blm-login-card">
        <aside className="blm-brand">
          <div className="blm-brand-top">
            <img className="blm-brand-logo" src={LOGIN_LOGO} alt="Bloomflex" />
          </div>
          <div className="blm-brand-mid">
            <h2>Order &amp; Production Management</h2>
            <p>Sales, production, invoicing, purchase, QC and HR — one secure enterprise workspace.</p>
            <ul className="blm-brand-list">
              {SELLING_POINTS.map((t) => <li key={t}>{Ic.check}<span>{t}</span></li>)}
            </ul>
          </div>
          <div className="blm-brand-foot">{Ic.shield}<span>Secure enterprise sign-in</span></div>
        </aside>

        <form className="blm-form" onSubmit={submit}>
          <div className="blm-form-logo">
            <img src={LOGIN_LOGO} alt="Bloomflex" />
          </div>

          <div className="blm-form-head">
            <h1>Sign in to Bloomflex</h1>
            <p>Sign in to your account to continue</p>
          </div>

          <div className={'blm-msg' + (info ? ' blm-msg-info' : '')} role={info ? 'status' : 'alert'}>
            {err ? <>{Ic.alert}<span>{err}</span></> : null}
          </div>

          <div className="blm-fg">
            <label htmlFor="blm-user">Username</label>
            <div className="blm-inwrap">
              <span className="blm-inicon">{Ic.user}</span>
              <input
                id="blm-user" className="blm-in" value={u} autoFocus autoComplete="username"
                aria-label="Username" onChange={(e) => setU(e.target.value)}
              />
            </div>
          </div>

          <div className="blm-fg">
            <label htmlFor="blm-pass">Password</label>
            <div className="blm-inwrap">
              <span className="blm-inicon">{Ic.lock}</span>
              <input
                id="blm-pass" className="blm-in" type={showPw ? 'text' : 'password'} value={p}
                autoComplete="current-password" aria-label="Password" onChange={(e) => setP(e.target.value)}
              />
              <button
                type="button" className="blm-toggle" onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'} title={showPw ? 'Hide password' : 'Show password'}
              >{showPw ? Ic.eyeOff : Ic.eye}</button>
            </div>
          </div>

          <div className="blm-opt">
            <label className="blm-remember">
              <input type="checkbox" checked={remember} aria-label="Remember me" onChange={(e) => setRemember(e.target.checked)} />
              <span className="blm-check">{Ic.check}</span>
              <span>Remember me</span>
            </label>
            <button
              type="button" className="blm-forgot"
              onClick={() => { setInfo(true); setErr('Passwords are reset by an administrator — please contact them.'); }}
            >Forgot password?</button>
          </div>

          <button className={'blm-cta' + (busy ? ' blm-loading' : '')} type="submit" disabled={busy || !u || !p}>
            {busy && <span className="blm-spin" aria-hidden="true" />}
            <span className="blm-cta-label">{busy ? 'Signing in…' : 'Sign In'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
