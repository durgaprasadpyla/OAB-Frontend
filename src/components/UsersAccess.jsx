import { useEffect, useState } from 'react';
import { usersApi } from '../api.js';
import { useData } from '../data.jsx';
import SalesUsersPanel from './SalesUsersPanel.jsx';

// Users & Access (superadmin) — manage the real app_user accounts via the
// backend admin endpoints. Add users, change roles, set a contact/WhatsApp
// phone, enable/disable, reset passwords. The Password column is masked and
// click-to-reveal: the server stores an AES-GCM copy of each password as it is
// set and decrypts it only for this superadmin endpoint (every reveal audited).
//
// §36: sales-user creation is MERGED into this page — the same SalesUsersPanel
// the S-Dashboard uses, over the separate sales_users table (module 12), with
// module-wise allocation and (here, in the Super Admin login) the password
// displayed next to each username.

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
  // §36: the sales_users table (module-12 blob) managed right here alongside staff.
  const { mods, save } = useData();
  const sales = mods.sales || {};
  const patchSales = (p) => save('sales', (prev) => ({ ...(prev || {}), ...p }));
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nu, setNu] = useState({ username: '', password: '', role: 'user', phone: '' });
  const [shown, setShown] = useState({});   // { [userId]: revealed password } — Password column click-to-reveal

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

  // Password column: masked by default; one click reveals (fetched on demand and
  // audited server-side), the next click hides it again.
  async function togglePassword(u) {
    if (shown[u.id] != null) { setShown((s) => { const n = { ...s }; delete n[u.id]; return n; }); return; }
    try {
      const r = await usersApi.revealPassword(u.id);
      setShown((s) => ({ ...s, [u.id]: r.password }));
    } catch (e) { flash('r', e.message || 'Could not fetch the password'); }
  }

  // Issues 3.0 §1: the superadmin must be able to remove accounts they created —
  // Disable only parks an account, it stays in the list forever. Deletion is
  // permanent (server-side guards keep the last active superadmin and the caller's
  // own account safe), so it asks twice: confirm, then type the username.
  async function delUser(u) {
    if (!window.confirm(`Delete the user "${u.username}" (${roleLabel(u.role)})?\n\nThis permanently removes the login. It cannot be undone — use Disable instead if you only want to park the account.`)) return;
    const typed = window.prompt(`Type the username "${u.username}" to confirm deletion:`);
    if (typed == null) return;
    if (typed.trim().toLowerCase() !== u.username.toLowerCase()) { flash('r', 'Username did not match — nothing was deleted'); return; }
    setBusy(true);
    try {
      await usersApi.remove(u.id);
      setShown((s) => { const n = { ...s }; delete n[u.id]; return n; });
      flash('g', `User "${u.username}" deleted`);
      await load();
    } catch (e) { flash('r', e.message); await load(); } finally { setBusy(false); }
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
              <thead><tr><th>Username</th><th style={{ width: 140 }}>Phone</th><th style={{ width: 160 }}>Role</th><th style={{ width: 100 }}>Status</th><th style={{ width: 150 }}>Password</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No users</td></tr>
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
                    <td>
                      {/* Masked until clicked; click again to hide. "—" = the password was
                          set before the Password column existed (reset it to make it visible). */}
                      {u.hasPassword ? (
                        <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 8px', fontFamily: shown[u.id] != null ? 'monospace' : undefined }}
                          title={shown[u.id] != null ? 'Click to hide' : 'Click to reveal'}
                          aria-label={`${shown[u.id] != null ? 'Hide' : 'Show'} password for ${u.username}`}
                          onClick={() => togglePassword(u)}>
                          {shown[u.id] != null ? shown[u.id] : (u.password != null ? u.password : '••••••••')}
                        </button>
                      ) : (
                        // Issues 2.4: a hash cannot be read back, so an account provisioned
                        // before this column existed has nothing to show — but it fills itself
                        // in the next time that user signs in, without changing their password.
                        <span title={`No stored copy yet for ${u.username} — it is captured automatically the next time they sign in. Reset PW to make it visible now.`}
                          style={{ color: 'var(--i3)', fontSize: 11 }}>— <span style={{ fontSize: 9 }}>after next sign-in</span></span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-s" style={{ height: 24, fontSize: 10, padding: '0 7px' }} onClick={() => resetPw(u)} disabled={busy}>Reset PW</button>{' '}
                      <button className="btn btn-s" style={{ height: 24, fontSize: 10, padding: '0 7px', color: u.disabled ? 'var(--g)' : 'var(--red)', borderColor: u.disabled ? undefined : '#F5A8A0' }} onClick={() => toggleDisabled(u)} disabled={busy}>
                        {u.disabled ? 'Enable' : 'Disable'}
                      </button>{' '}
                      <button className="btn btn-s" style={{ height: 24, fontSize: 10, padding: '0 7px', color: 'var(--red)', borderColor: '#F5A8A0' }}
                        aria-label={`Delete ${u.username}`} onClick={() => delUser(u)} disabled={busy}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--i3)', marginTop: 8 }}>Phone is editable inline (saves when you click away). Disabled users cannot sign in. Delete removes the login permanently (the last active superadmin, and the account you are signed in with, cannot be deleted). The last active superadmin cannot be disabled or demoted. Passwords are read from the database and shown here (each listing is audit-logged). A password set before this feature existed cannot be recovered — it was only ever hashed. Those accounts show “— after next sign-in”: the copy is captured automatically the next time that person signs in, and nothing about their password changes. Reset PW makes one visible immediately.</p>
      </div>

      {/* §36: the merged sales-user management — separate table, module-wise
          allocation, password shown next to the username in this Super Admin view. */}
      <div className="ctitle" style={{ marginTop: 16 }}>💼 Sales Users (SalesOS — separate table)</div>
      <SalesUsersPanel sales={sales} patch={patchSales} showPasswords />
    </>
  );
}
