import { useMemo, useState, useEffect, useCallback } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { masterApi } from '../api.js';
import { DROPDOWN_DEFS, DD_DEFAULTS, ddList, ddPatch, ddIsOverridden } from '../lib/dropdowns.js';

// Super-admin editor for the nine shared dropdown lists (module 12).
// Ported from the monolith's Dropdowns tab (ddRender / ddRenderEditor / ddSave).
//
// Three shapes: a plain list, value/label pairs (payment types), and
// name/unit rows (CSA substrates).

const blankFor = (type) => (type === 'pairs' ? ['', ''] : type === 'substrate' ? { name: '', unit: 'Micron' } : '');
const UNITS = ['Micron', 'GSM'];

export default function DropdownAdmin() {
  const { mods, save } = useData();
  const { role } = useAuth();
  const sales = mods.sales || {};

  // Master-backed categories (Departments, §5) are Super-Admin-only. The sales dropdown
  // editor (SalesAdmin, sadmin) shows only the sales-blob lists, unchanged.
  const DEFS = useMemo(() => DROPDOWN_DEFS.filter((d) => !d.master || role === 'superadmin'), [role]);
  const [sel, setSel] = useState(DEFS[0].key);
  const [work, setWork] = useState(null);      // null = showing the saved list
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  // Departments (Enhancements 2.0 §5) are backed by the normalized Department master, not
  // the sales blob — so the PAdmin Item Master reads the same source (/api/master/departments).
  const [depts, setDepts] = useState([]);
  const [deptErr, setDeptErr] = useState('');
  const [deptLoaded, setDeptLoaded] = useState(false);
  const loadDepts = useCallback(async () => {
    setDeptErr('');
    try {
      const r = await masterApi.listDepartments({ includeInactive: 1 });
      setDepts(Array.isArray(r) ? r : []);   // tolerate an unexpected non-array shape
      setDeptLoaded(true);
    } catch (e) {
      // Do NOT silently swallow — a masked failure looks like "no departments" and
      // confuses the user. Surface the real reason so the page never appears broken.
      setDeptErr(e && e.message ? e.message : 'Could not reach the Department master');
    }
  }, []);
  useEffect(() => { if (role === 'superadmin') loadDepts(); }, [loadDepts, role]);

  // Machines master (Issues 1.0 #6) — same backing as the Machines tab / JSS / PPC.
  const [machines, setMachines] = useState([]);
  const [machErr, setMachErr] = useState('');
  const loadMachines = useCallback(async () => {
    setMachErr('');
    try {
      const r = await masterApi.listMachines({ includeInactive: 1 });
      setMachines(Array.isArray(r) ? r : []);
    } catch (e) { setMachErr(e && e.message ? e.message : 'Could not reach the Machine master'); }
  }, []);
  useEffect(() => { if (role === 'superadmin') loadMachines(); }, [loadMachines, role]);

  const def = DEFS.find((d) => d.key === sel) || DEFS[0];
  const saved = useMemo(() => ddList(sales, sel), [sales, sel]);
  const rows = work ?? saved;
  const dirty = work !== null;

  function pick(key) { setSel(key); setWork(null); setMsg(null); }
  const edit = (next) => setWork(next);

  const setRow = (i, v) => edit(rows.map((r, j) => (j === i ? v : r)));
  const addRow = () => edit([...rows, blankFor(def.type)]);
  const dropRow = (i) => edit(rows.filter((_, j) => j !== i));

  async function persist(values) {
    setBusy(true);
    try {
      const patch = ddPatch(sales, sel, values);
      await save('sales', (prev) => ({ ...(prev || {}), ...patch }));
      setWork(null);
      setMsg({ t: 'g', text: `✅ ${def.label} saved.` });
    } catch (e) {
      setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) });
    } finally { setBusy(false); }
  }

  function saveList() {
    // Drop blanks so an empty row left behind does not become a blank option.
    const cleaned = rows.filter((r) => (
      def.type === 'pairs' ? String(r[0] || '').trim()
        : def.type === 'substrate' ? String(r.name || '').trim()
          : String(r || '').trim()
    ));
    persist(cleaned);
  }

  function resetToDefault() {
    if (!window.confirm(`Reset ${def.label} to the built-in list?`)) return;
    persist([]);            // an empty override means "fall back to defaults"
  }

  return (
    <div className="g2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="ctitle">Lists</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>Edited here, used everywhere. Blank lists fall back to the built-in defaults.</div>
        <div className="tw sy" style={{ maxHeight: 420 }}>
          <table>
            <tbody>
              {DEFS.map((d) => (
                <tr
                  key={d.key} style={{ cursor: 'pointer', background: d.key === sel ? 'var(--gl)' : undefined }}
                  onClick={() => pick(d.key)}
                >
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 12.5, color: d.key === sel ? 'var(--g)' : 'var(--ink)' }}>
                      {d.label} <span style={{ fontWeight: 500, color: 'var(--i3)' }}>({d.master === 'machine' ? machines.filter((x) => x.active !== false).length : d.master ? depts.filter((x) => x.active !== false).length : ddList(sales, d.key).length})</span>
                      {!d.master && ddIsOverridden(sales, d.key) && <span className="tag tb" style={{ fontSize: 9, marginLeft: 6 }}>custom</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 1 }}>{d.where}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {def.master === 'machine' ? (
        <MachinesPanel machines={machines} departments={depts} reload={loadMachines} error={machErr} />
      ) : def.master ? (
        <DepartmentsPanel depts={depts} reload={loadDepts} error={deptErr} loaded={deptLoaded} />
      ) : (
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>{def.label} <span className="tag tgr">{rows.length}</span></div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={resetToDefault} disabled={busy || !ddIsOverridden(sales, sel)}>Reset to default</button>
          <button className="btn btn-g" onClick={saveList} disabled={busy || !dirty}>{busy ? 'Saving…' : '💾 Save'}</button>
        </div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        {dirty && <div className="al al-y">Unsaved changes.</div>}

        <div className="tw sy" style={{ maxHeight: 380 }}>
          <table>
            <thead>
              <tr>
                {def.type === 'pairs' ? <><th style={{ width: 110 }}>Value</th><th>Label</th></>
                  : def.type === 'substrate' ? <><th>Substrate</th><th style={{ width: 130 }}>Unit</th></>
                    : <th>Value</th>}
                <th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>
                  Empty — the built-in list of {(DD_DEFAULTS[sel] || []).length} is in use.
                </td></tr>
              ) : rows.map((r, i) => (
                <tr key={i}>
                  {def.type === 'pairs' ? (
                    <>
                      <td><input value={r[0] ?? ''} aria-label={`Value ${i + 1}`} onChange={(e) => setRow(i, [e.target.value, r[1]])} /></td>
                      <td><input value={r[1] ?? ''} aria-label={`Label ${i + 1}`} onChange={(e) => setRow(i, [r[0], e.target.value])} /></td>
                    </>
                  ) : def.type === 'substrate' ? (
                    <>
                      <td><input value={r.name ?? ''} aria-label={`Substrate ${i + 1}`} onChange={(e) => setRow(i, { ...r, name: e.target.value })} /></td>
                      <td>
                        <select value={r.unit || 'Micron'} aria-label={`Unit ${i + 1}`} onChange={(e) => setRow(i, { ...r, unit: e.target.value })}>
                          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
                    </>
                  ) : (
                    <td><input value={r ?? ''} aria-label={`Value ${i + 1}`} onChange={(e) => setRow(i, e.target.value)} /></td>
                  )}
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-s" style={{ color: 'var(--red)' }} aria-label={`Remove ${i + 1}`} onClick={() => dropRow(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-s" style={{ marginTop: 8 }} onClick={addRow}>＋ Add</button>
      </div>
      )}
    </div>
  );
}

/**
 * Departments editor (Enhancements 2.0 §5). Lives under Dashboard → Drop-down selections,
 * but is backed by the shared normalized Department master (/api/master/departments) so
 * the PAdmin Item Master reads the same source. Add / rename / enable-disable; writes are
 * Super Admin only (enforced server-side).
 */
function DepartmentsPanel({ depts, reload, error, loaded }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const flash = (t, text) => { setMsg({ t, text }); setTimeout(() => setMsg(null), 3000); };
  const list = Array.isArray(depts) ? depts : [];
  const active = list.filter((d) => d.active !== false);

  async function add() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try { await masterApi.createDepartment({ name: n }); setName(''); flash('g', `Added “${n}”.`); await reload(); }
    catch (e) { flash('r', e.message || 'Add failed'); } finally { setBusy(false); }
  }
  async function rename(d, next) {
    const n = String(next || '').trim();
    if (!n || n === d.name) return;
    try { await masterApi.updateDepartment(d.id, { name: n }); await reload(); }
    catch (e) { flash('r', e.message || 'Rename failed'); }
  }
  async function toggle(d) {
    try { await masterApi.updateDepartment(d.id, { active: d.active === false }); await reload(); }
    catch (e) { flash('r', e.message || 'Update failed'); }
  }
  // Issues 1.0 #5: hard delete — the server refuses (with the list of blockers)
  // while machines, routes, items or production history still reference it.
  async function remove(d) {
    if (!window.confirm(`Delete department “${d.name}” permanently?\n\nThis only works when nothing references it (machines, routes, items, production history). Otherwise use Disable.`)) return;
    try { await masterApi.deleteDepartment(d.id); flash('g', `Deleted “${d.name}”.`); await reload(); }
    catch (e) { flash('r', e.message || 'Delete failed'); }
  }

  return (
    <div className="card">
      <div className="ctitle">Departments <span className="tag tgr">{active.length}</span></div>
      <div className="pg-sub" style={{ marginTop: 0 }}>Production departments — configured here by Super Admin and used by the PAdmin Item Master Department dropdown (and machine / route setup).</div>
      {error && (
        <div className="al al-r" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>Couldn’t load the Department master — {error}. You can still add one below once it’s reachable.</span>
          <button className="btn btn-s" style={{ height: 24, fontSize: 11 }} onClick={reload}>Retry</button>
        </div>
      )}
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="fbar">
        <input placeholder="New department name" value={name} aria-label="New department name"
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button className="btn btn-g" onClick={add} disabled={busy || !name.trim()}>＋ Add</button>
      </div>
      <div className="tw sy" style={{ maxHeight: 380, marginTop: 8 }}>
        <table>
          <thead><tr><th>Department</th><th style={{ width: 170 }}>Actions</th></tr></thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={2} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>
                {error ? 'Departments unavailable — see the message above.' : loaded ? 'No departments yet — add one above.' : 'Loading departments…'}
              </td></tr>
            ) : list.map((d) => (
              <tr key={d.id} style={{ opacity: d.active === false ? 0.55 : 1 }}>
                <td><input defaultValue={d.name} aria-label={`Department ${d.name}`} onBlur={(e) => rename(d, e.target.value)} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-s" onClick={() => toggle(d)}>{d.active === false ? 'Enable' : 'Disable'}</button>{' '}
                  <button className="btn btn-s" style={{ color: 'var(--red)' }} aria-label={`Delete department ${d.name}`} onClick={() => remove(d)}>🗑 Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Machines editor (Issues 1.0 #6). The Machines master is visible under Drop-down
 * selections too — the same rows the Machines tab, the JSS and the PPC boards use
 * (/api/master/machines). Adding one pulls its Department in from the Departments
 * list; the speed unit defaults by department (pouching / sleeving / die punching /
 * packing → pcs/min, everything else → m/min).
 */
function MachinesPanel({ machines, departments, reload, error }) {
  const deptUnit = (name) => (/pouch|sleeve|punch|pack/i.test(String(name || '')) ? 'pcs/min' : 'm/min');
  const activeDepts = (departments || []).filter((d) => d.active !== false);
  const [form, setForm] = useState({ code: '', name: '', departmentId: '', defaultSpeed: '', speedUom: '', functionalHoursPerDay: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const flash = (t, text) => { setMsg({ t, text }); setTimeout(() => setMsg(null), 3500); };
  const list = Array.isArray(machines) ? machines : [];
  const active = list.filter((m) => m.active !== false);
  const deptName = (id) => (activeDepts.find((d) => String(d.id) === String(id)) || {}).name;
  const formUnit = form.speedUom || deptUnit(deptName(form.departmentId));

  async function add() {
    if (!form.code.trim() || !form.name.trim()) { flash('r', 'Machine code and name are required.'); return; }
    setBusy(true);
    try {
      await masterApi.createMachine({
        code: form.code.trim(), name: form.name.trim(),
        departmentId: form.departmentId ? Number(form.departmentId) : undefined,
        defaultSpeed: form.defaultSpeed === '' ? undefined : Number(form.defaultSpeed),
        speedUom: formUnit,
        functionalHoursPerDay: form.functionalHoursPerDay === '' ? undefined : Number(form.functionalHoursPerDay),
      });
      setForm({ code: '', name: '', departmentId: '', defaultSpeed: '', speedUom: '', functionalHoursPerDay: '' });
      flash('g', `Added “${form.name.trim()}”.`);
      await reload();
    } catch (e) { flash('r', e.message || 'Add failed'); } finally { setBusy(false); }
  }
  async function rename(m, next) {
    const n = String(next || '').trim();
    if (!n || n === m.name) return;
    try { await masterApi.updateMachine(m.id, { name: n }); await reload(); }
    catch (e) { flash('r', e.message || 'Rename failed'); }
  }
  async function setDept(m, id) {
    try { await masterApi.updateMachine(m.id, { departmentId: id ? Number(id) : null }); await reload(); }
    catch (e) { flash('r', e.message || 'Update failed'); }
  }
  async function toggle(m) {
    try { await masterApi.updateMachine(m.id, { active: m.active === false }); await reload(); }
    catch (e) { flash('r', e.message || 'Update failed'); }
  }

  return (
    <div className="card">
      <div className="ctitle">Machines <span className="tag tgr">{active.length}</span></div>
      <div className="pg-sub" style={{ marginTop: 0 }}>The same machines the Machines tab, the JSS and the PPC boards use. The Department is pulled in from the Departments list.</div>
      {error && (
        <div className="al al-r" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>Couldn’t load the Machine master — {error}.</span>
          <button className="btn btn-s" style={{ height: 24, fontSize: 11 }} onClick={reload}>Retry</button>
        </div>
      )}
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, marginBottom: 8 }}>
        <input placeholder="Code *" value={form.code} aria-label="New machine code" onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
        <input placeholder="Machine name *" value={form.name} aria-label="New machine name" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <select value={form.departmentId} aria-label="New machine department" onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value, speedUom: '' }))}>
          <option value="">— Department —</option>
          {activeDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={formUnit} aria-label="New machine speed unit" onChange={(e) => setForm((f) => ({ ...f, speedUom: e.target.value }))}>
          <option value="m/min">m/min</option>
          <option value="pcs/min">pcs/min</option>
        </select>
        <input type="number" min="0" step="any" placeholder="Ideal speed" value={form.defaultSpeed} aria-label="New machine ideal speed" onChange={(e) => setForm((f) => ({ ...f, defaultSpeed: e.target.value }))} />
        <input type="number" min="0" step="any" placeholder="Hrs/day" value={form.functionalHoursPerDay} aria-label="New machine hours per day" onChange={(e) => setForm((f) => ({ ...f, functionalHoursPerDay: e.target.value }))} />
        <button className="btn btn-g" onClick={add} disabled={busy}>＋ Add</button>
      </div>
      <div className="tw sy" style={{ maxHeight: 360 }}>
        <table>
          <thead><tr><th style={{ width: 80 }}>Code</th><th>Machine</th><th style={{ width: 150 }}>Department</th><th style={{ width: 120 }}>Ideal speed</th><th style={{ width: 96 }}>Status</th></tr></thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>
                {error ? 'Machines unavailable — see the message above.' : 'No machines yet — add one above.'}
              </td></tr>
            ) : list.map((m) => (
              <tr key={m.id} style={{ opacity: m.active === false ? 0.55 : 1 }}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.code}</td>
                <td><input defaultValue={m.name} aria-label={`Machine ${m.name}`} onBlur={(e) => rename(m, e.target.value)} /></td>
                <td>
                  <select value={m.departmentId ?? ''} aria-label={`Department for ${m.name}`} onChange={(e) => setDept(m, e.target.value)}>
                    <option value="">—</option>
                    {activeDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td style={{ fontSize: 12 }}>{m.defaultSpeed != null ? `${m.defaultSpeed} ${m.speedUom || ''}` : '—'}</td>
                <td><button className="btn btn-s" onClick={() => toggle(m)}>{m.active === false ? 'Enable' : 'Disable'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
