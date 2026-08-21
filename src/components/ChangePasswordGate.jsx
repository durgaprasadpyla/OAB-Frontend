import { useState } from 'react';
import { changePassword } from '../api.js';

// Forced password change. The backend flags an account `mustChangePassword`
// after a first login or an admin reset; until it is cleared the app must not be
// usable, so this renders as a blocking overlay rather than a dismissible modal.
// Ported from the OAB-App HR layer's showChangePassword.

const MIN_LEN = 8;

export default function ChangePasswordGate({ onDone }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Validate here so an obviously bad pair never costs a round trip; the server
  // re-checks everything regardless.
  function localProblem() {
    if (!cur) return 'Enter your current password.';
    if (next.length < MIN_LEN) return `New password must be at least ${MIN_LEN} characters.`;
    if (next === cur) return 'New password must be different from the current one.';
    if (next !== confirm) return 'The two new passwords do not match.';
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    const p = localProblem();
    if (p) { setError(p); return; }
    setBusy(true);
    setError('');
    try {
      await changePassword(cur, next);
      onDone();
    } catch (ex) {
      setError(ex && ex.message ? ex.message : String(ex));
    } finally { setBusy(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
      <form onSubmit={submit} style={{ background: 'var(--wh)', borderRadius: 12, padding: 24, width: 400, maxWidth: '100%' }}>
        <div className="ctitle" style={{ marginTop: 0 }}>Choose a new password</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Your password needs changing before you can continue — either this is your
          first sign-in, or an administrator reset it.
        </div>
        {error && <div className="al al-r" role="alert">{error}</div>}
        <div className="fg">
          <label>Current password</label>
          <input type="password" autoFocus value={cur} aria-label="Current password" onChange={(e) => setCur(e.target.value)} />
        </div>
        <div className="fg">
          <label>New password</label>
          <input type="password" value={next} aria-label="New password" onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="fg">
          <label>Confirm new password</label>
          <input type="password" value={confirm} aria-label="Confirm new password" onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button className="btn btn-g" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
