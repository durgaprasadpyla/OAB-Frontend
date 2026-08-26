import { useMemo, useState } from 'react';
import {
  REP_ACCOUNT_STATUSES, REP_MODULES, repModulesOf, addRep, updateRep, repCategoriesOf,
} from '../lib/sales.js';
import { inr } from '../lib/format.js';

// §36: ONE sales-user management panel, shared by the Super Admin's Users & Access
// (Dashboard) and the Sadmin S-Dashboard — the two admin portals are merged into the
// same component over the same sales_users table (module-12 blob, separate from
// app_user as the doc asks). It offers module-wise allocation per rep and, in the
// Super Admin view, displays each rep's password next to the username.
//
// Props: sales (module-12 blob), patch (partial-save into it),
//        showPasswords (true = §36 Super Admin view: password shown in clear).

export default function SalesUsersPanel({ sales, patch, showPasswords = false }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', phone: '', status: 'Active' });
  const [formModules, setFormModules] = useState(() => new Set(REP_MODULES.map((m) => m.k)));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(() => new Set());
  const [editModules, setEditModules] = useState('');   // rep id whose allocation editor is open
  const users = sales.sales_users || [];

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? users.filter((r) => [r.display_name, r.username].join(' ').toLowerCase().includes(t)) : users;
  }, [users, q]);

  const toggleShow = (id) => setShown((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleFormModule = (k) => setFormModules((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      const modules = formModules.size === REP_MODULES.length ? undefined : [...formModules];
      if (formModules.size === 0) throw new Error('Allocate at least one module.');
      await patch({ sales_users: addRep(users, { ...form, modules }) });
      setForm({ name: '', username: '', password: '', phone: '', status: 'Active' });
      setFormModules(new Set(REP_MODULES.map((m) => m.k)));
      setMsg({ t: 'g', text: '✅ Sales user added.' });
    } catch (e) { setMsg({ t: 'r', text: e.message || String(e) }); }
    finally { setBusy(false); }
  }

  async function setStatus(rep, status) {
    try { await patch({ sales_users: updateRep(users, rep.id, { status, disabled: status !== 'Active' }) }); }
    catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
  }

  async function resetPw(rep) {
    const np = window.prompt(`Set a new password for ${rep.display_name || rep.username}:`, rep.password || '');
    if (np == null) return;
    try { await patch({ sales_users: updateRep(users, rep.id, { password: np }) }); setMsg({ t: 'g', text: `✅ Password reset for ${rep.display_name || rep.username}.` }); }
    catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
  }

  async function deleteRep(rep) {
    if (!window.confirm(`Delete sales rep "${rep.display_name || rep.username}"? Their login will stop working. Leads they were assigned stay in the system (shown as unassigned).`)) return;
    try { await patch({ sales_users: users.filter((r) => r.id !== rep.id) }); setMsg({ t: 'g', text: '✅ Rep deleted.' }); }
    catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
  }

  // §36: per-rep module allocation toggle; storing ALL modules stores nothing
  // (absent = everything), so a later new module is granted by default.
  async function toggleRepModule(rep, k) {
    const cur = new Set(repModulesOf(rep));
    if (cur.has(k)) cur.delete(k); else cur.add(k);
    if (cur.size === 0) { setMsg({ t: 'r', text: 'A rep needs at least one module.' }); return; }
    const modules = cur.size === REP_MODULES.length ? [] : [...cur];
    try { await patch({ sales_users: updateRep(users, rep.id, { modules }) }); }
    catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
  }

  const moduleSummary = (rep) => {
    const mods = repModulesOf(rep);
    return mods.length === REP_MODULES.length ? 'All modules' : `${mods.length} of ${REP_MODULES.length}`;
  };

  return (
    <>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Sales Users <span className="tag tgr">{filtered.length}</span></div>
          <input placeholder="Search name / username…" value={q} aria-label="Search reps" onChange={(e) => setQ(e.target.value)} />
        </div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="tw sy" style={{ maxHeight: 360 }}>
          <table>
            <thead><tr><th>Name</th><th>Username</th><th>Phone</th><th style={{ minWidth: 160 }}>Password</th><th style={{ minWidth: 140 }}>Modules</th><th style={{ width: 140 }}>Status</th><th style={{ textAlign: 'right' }}>Lines</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No sales users match</td></tr>
                : filtered.map((r) => {
                  const lines = (sales.leads || []).reduce((n, l) => n + repCategoriesOf(l, r.id).length, 0);
                  const visible = showPasswords || shown.has(r.id);   // §36: superadmin sees the password
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.display_name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.username}</td>
                      <td style={{ fontSize: 11 }}>{r.phone || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: visible ? 'var(--ink)' : 'var(--i3)' }}>{visible ? (r.password || '(none set)') : '••••••'}</span>
                        {!showPasswords && (
                          <button className="btn btn-s" style={{ marginLeft: 6, height: 22, fontSize: 10 }} aria-label={`${shown.has(r.id) ? 'Hide' : 'Show'} password for ${r.display_name}`} onClick={() => toggleShow(r.id)}>{shown.has(r.id) ? 'hide' : 'show'}</button>
                        )}
                        <button className="btn btn-s" style={{ marginLeft: 4, height: 22, fontSize: 10 }} aria-label={`Reset password for ${r.display_name}`} onClick={() => resetPw(r)}>reset</button>
                      </td>
                      <td>
                        <button className="btn btn-s" style={{ height: 24, fontSize: 10 }} aria-label={`Edit modules for ${r.display_name}`}
                          onClick={() => setEditModules(editModules === r.id ? '' : r.id)}>
                          {moduleSummary(r)} ▾
                        </button>
                        {editModules === r.id && (
                          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {REP_MODULES.map((m) => (
                              <label key={m.k} className="cb" style={{ fontSize: 11 }}>
                                <input type="checkbox" checked={repModulesOf(r).includes(m.k)} onChange={() => toggleRepModule(r, m.k)} /> {m.label}
                              </label>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <select value={r.status || 'Active'} aria-label={`Status for ${r.display_name}`} onChange={(e) => setStatus(r, e.target.value)}>
                          {REP_ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: 'right' }}>{inr(lines)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-s" style={{ color: 'var(--red)' }} aria-label={`Delete ${r.display_name}`} onClick={() => deleteRep(r)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <div className="pg-sub" style={{ margin: '8px 0 0' }}>
          Sales users live in their own table (module 12), separate from staff accounts.
          Module allocation controls which Sales Portal tabs the rep sees. Deactivating a
          rep leaves their allocations in place — reassign them on the Category Allocation tab.
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="ctitle">＋ Add a sales user</div>
        <div className="fg"><label>Full name *</label><input value={form.name} aria-label="Rep full name" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="fg"><label>Username *</label><input value={form.username} aria-label="Rep username" onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
        <div className="fg"><label>Password *</label><input type={showPasswords ? 'text' : 'password'} value={form.password} aria-label="Rep password" onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        <div className="fg"><label>Phone</label><input value={form.phone} aria-label="Rep phone" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div className="fg">
          <label>Status</label>
          <select value={form.status} aria-label="Rep status" onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {REP_ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="fg">
          <label>Module allocation (§ which Sales Portal tabs this user gets)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
            {REP_MODULES.map((m) => (
              <label key={m.k} className="cb" style={{ fontSize: 12 }}>
                <input type="checkbox" checked={formModules.has(m.k)} onChange={() => toggleFormModule(m.k)} /> {m.label}
              </label>
            ))}
          </div>
        </div>
        <button className="btn btn-g" onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add sales user'}</button>
      </div>
    </>
  );
}
