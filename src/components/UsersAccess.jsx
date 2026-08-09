import { useEffect, useState } from 'react';
import { usersApi } from '../api.js';

// Users & Access (superadmin) — manage the real app_user accounts via the
// backend admin endpoints. Add users, change roles, enable/disable, reset
// passwords. Passwords are write-only; the server never returns hashes.

const ROLES = ['user', 'padmin', 'superadmin', 'plant', 'qc', 'pm', 'scrap', 'purchase'];

export default function UsersAccess() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nu, setNu] = useState({ username: '', password: '', role: 'user' });

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
      await usersApi.create({ username: nu.username.trim(), password: nu.password, role: nu.role });
      setNu({ username: '', password: '', role: 'user' });
      flash('g', 'User created');
      await load();
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  async function changeRole(u, role) {
    setBusy(true);
    try { await usersApi.update(u.id, { role }); flash('g', `${u.username} → ${role}`); await load(); }
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
          <div className="fg"><label>Role</label><select value={nu.role} onChange={(e) => setNu((x) => ({ ...x, role: e.target.value }))}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
          <div className="fg"><label>&nbsp;</label><button className="btn btn-g" onClick={addUser} disabled={busy}>+ Add User</button></div>
        </div>
      </div>

      <div className="card">
        <div className="ctitle">Users ({users.length})</div>
        {err && <div className="al al-r">{err}</div>}
        {loading ? <div className="pg-sub" style={{ margin: 0 }}>Loading users…</div> : (
          <div className="tw sy">
            <table>
              <thead><tr><th>Username</th><th style={{ width: 160 }}>Role</th><th style={{ width: 100 }}>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No users</td></tr>
                ) : users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.username}</td>
                    <td>
                      <select value={u.role} disabled={busy} onChange={(e) => changeRole(u, e.target.value)} style={{ height: 28, fontSize: 12, width: '100%' }}>
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
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
        <p style={{ fontSize: 11, color: 'var(--i3)', marginTop: 8 }}>Disabled users cannot sign in. The last active superadmin cannot be disabled or demoted.</p>
      </div>
    </>
  );
}
