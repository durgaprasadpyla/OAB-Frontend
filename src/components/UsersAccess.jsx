import { useEffect, useState } from 'react';
import { usersApi } from '../api.js';

// Users & Access (superadmin) — manage the real app_user accounts via the
// backend admin endpoints. Add users, change roles, set a contact/WhatsApp
// phone, enable/disable, reset passwords. Passwords are write-only; the server
// never returns hashes (so they cannot be displayed — reset only).
//
// NOTE: per-user MODULE access (an ACL beyond the single role) is still a
// backend redesign and is not offered here; access is governed by the role.

// Descriptive role labels, mirroring the monolith's ROLE_OPTIONS (index.html 6194),
// extended with the roles the React port added: superadmin, sadmin, quote, hr, and the
// production-planning module logins (planner/stores + Enhancements 2.0 ppc/mis/plan).
// Sales reps are provisioned separately (module-12 sales blob), so 'sales' is not here.
const ROLE_OPTIONS = [
  { v: 'user', l: 'Operations — OAB / Daily Update / Invoice' },
  { v: 'padmin', l: 'Purchase Admin' },
  { v: 'superadmin', l: 'Super Admin' },
  { v: 'plant', l: 'Plant / Production floor' },
  { v: 'pm', l: 'Production Manager' },
  { v: 'qc', l: 'QC — Add Spec' },
  { v: 'purchase', l: 'Purchase' },
  { v: 'scrap', l: 'Scrap' },
  { v: 'sadmin', l: 'Sales Admin' },
  { v: 'quote', l: 'Quotation Desk' },
  { v: 'hr', l: 'HR' },
  { v: 'planner', l: 'Production Planner' },
  { v: 'stores', l: 'Stores' },
  { v: 'ppc', l: 'PPC — Production Planning & Control' },
  { v: 'mis', l: 'MIS — Status & Analytics' },
  { v: 'plan', l: 'Planning — Ready to Plan' },
];
const ROLES = ROLE_OPTIONS.map((r) => r.v);
const roleLabel = (v) => (ROLE_OPTIONS.find((r) => r.v === v) || {}).l || (v || '-');

export default function UsersAccess() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nu, setNu] = useState({ username: '', password: '', role: 'user', phone: '' });

  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  async function load() {
    setLoading(true); setErr('');
    try { setUsers(await usersApi.list()); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function addUser() {
    if (!nu.username.trim()) { flash('r', 'Enter a username'); return; }
    if ((nu.password || '').length < 4) { flash('r', 'Password must be at least 4 characters'); return; }
    setBusy(true);
    try {
      await usersApi.create({ username: nu.username.trim(), password: nu.password, role: nu.role, phone: nu.phone.trim() });
      setNu({ username: '', password: '', role: 'user', phone: '' });
      flash('g', 'User created');
      await load();
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  async function changeRole(u, role) {
    setBusy(true);
    try { await usersApi.update(u.id, { role }); flash('g', `${u.username} → ${role}`); await load(); }
    catch (e) { flash('r', e.message); await load(); } finally { setBusy(false); }
  }

  async function changePhone(u, phone) {
    setBusy(true);
    try { await usersApi.update(u.id, { phone }); flash('g', `${u.username} phone updated`); await load(); }
    catch (e) { flash('r', e.message); await load(); } finally { setBusy(false); }
  }

  async function toggleDisabled(u) {
    setBusy(true);
    try { await usersApi.update(u.id, { disabled: !u.disabled }); flash('g', `${u.username} ${u.disabled ? 'enabled' : 'disabled'}`); await load(); }
    catch (e) { flash('r', e.message); await load(); } finally { setBusy(false); }
  }

  async function resetPw(u) {
    const pw = window.prompt(`New password for ${u.username} (min 4 characters):`);
    if (pw == null) return;
    if (pw.length < 4) { flash('r', 'Password must be at least 4 characters'); return; }
    setBusy(true);
    try { await usersApi.update(u.id, { newPassword: pw }); flash('g', `Password reset for ${u.username}`); }
    catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">Add User</div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="g4">
          <div className="fg"><label>Username</label><input value={nu.username} onChange={(e) => setNu((x) => ({ ...x, username: e.target.value }))} autoComplete="off" /></div>
          <div className="fg"><label>Password</label><input type="password" value={nu.password} onChange={(e) => setNu((x) => ({ ...x, password: e.target.value }))} autoComplete="new-password" /></div>
          <div className="fg"><label>Phone</label><input value={nu.phone} onChange={(e) => setNu((x) => ({ ...x, phone: e.target.value }))} placeholder="contact / WhatsApp" autoComplete="off" /></div>
          <div className="fg"><label>Role</label><select value={nu.role} onChange={(e) => setNu((x) => ({ ...x, role: e.target.value }))}>{ROLE_OPTIONS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select></div>
        </div>
        <div className="act"><button className="btn btn-g" onClick={addUser} disabled={busy}>+ Add User</button></div>
      </div>

      <div className="card">
        <div className="ctitle">Users ({users.length})</div>
        {err && <div className="al al-r">{err}</div>}
        {loading ? <div className="pg-sub" style={{ margin: 0 }}>Loading users…</div> : (
          <div className="tw sy">
            <table>
              <thead><tr><th>Username</th><th style={{ width: 140 }}>Phone</th><th style={{ width: 160 }}>Role</th><th style={{ width: 100 }}>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No users</td></tr>
                ) : users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.username}</td>
                    <td>
                      {/* Inline-editable: saves on blur when the value changed. key re-inits after reload. */}
                      <input key={u.id + '|' + (u.phone || '')} defaultValue={u.phone || ''} placeholder="—" disabled={busy}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (u.phone || '')) changePhone(u, v); }}
                        style={{ height: 26, fontSize: 12, width: '100%' }} />
                    </td>
                    <td>
                      <select value={u.role} disabled={busy} onChange={(e) => changeRole(u, e.target.value)} style={{ height: 28, fontSize: 12, width: '100%' }}>
                        {ROLE_OPTIONS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
                        {/* Keep an unrecognised legacy role visible so the row still reads correctly. */}
                        {u.role && !ROLES.includes(u.role) && <option value={u.role}>{roleLabel(u.role)}</option>}
                      </select>
                    </td>
                    <td>{u.disabled ? <span className="tag tr" style={{ fontSize: 9 }}>Disabled</span> : <span className="tag tg" style={{ fontSize: 9 }}>Active</span>}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-s" style={{ height: 24, fontSize: 10, padding: '0 7px' }} onClick={() => resetPw(u)} disabled={busy}>Reset PW</button>{' '}
                      <button className="btn btn-s" style={{ height: 24, fontSize: 10, padding: '0 7px', color: u.disabled ? 'var(--g)' : 'var(--red)', borderColor: u.disabled ? undefined : '#F5A8A0' }} onClick={() => toggleDisabled(u)} disabled={busy}>
                        {u.disabled ? 'Enable' : 'Disable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--i3)', marginTop: 8 }}>Phone is editable inline (saves when you click away). Disabled users cannot sign in. The last active superadmin cannot be disabled or demoted. Passwords are reset-only (never shown).</p>
      </div>
    </>
  );
}
