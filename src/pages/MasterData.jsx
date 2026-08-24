import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth.jsx';
import { masterApi, stockApi, notificationsApi } from '../api.js';
import Modal from '../components/Modal.jsx';

// Production-planning master data hub (Stage 2). Config sections (departments,
// specialties, machines, routes, dispatch types) are superadmin-editable; the item
// master is padmin/superadmin; stock adjustments add the stores role. Everyone who
// can reach the page may read; write controls hide for roles that can't. The backend
// re-checks every write, so this is convenience, not the only protection.

const TABS = [
  { key: 'departments', label: 'Departments' },
  { key: 'specialties', label: 'Specialties' },
  { key: 'machines', label: 'Machines' },
  { key: 'routes', label: 'Routes' },
  { key: 'dispatch', label: 'Dispatch Types' },
  { key: 'items', label: 'Item Master' },
];

const num = (v) => (v === '' || v == null ? '' : v);
const opt = (list) => (list || []).filter((x) => x.active !== false);

/** Generic field-driven form used by the simple masters. */
function EntityForm({ fields, initial, onSubmit, onCancel, submitting }) {
  const seed = {};
  for (const f of fields) {
    const v = initial ? initial[f.key] : undefined;
    seed[f.key] = f.type === 'checkbox' ? (v === undefined ? true : !!v) : (v == null ? '' : v);
  }
  const [vals, setVals] = useState(seed);
  const [err, setErr] = useState('');
  const set = (k, v) => setVals((s) => ({ ...s, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setErr('');
    // Build a clean payload: omit blank optional strings; coerce numbers/ids.
    const body = {};
    for (const f of fields) {
      let v = vals[f.key];
      if (f.type === 'checkbox') { body[f.key] = !!v; continue; }
      if (v === '' || v == null) { if (f.required) { setErr(`${f.label} is required`); return; } continue; }
      if (f.type === 'number' || f.type === 'select') v = f.type === 'number' ? Number(v) : v;
      body[f.key] = v;
    }
    try { await onSubmit(body); } catch (e2) { setErr(e2.message || 'Save failed'); }
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="al al-r" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="g2">
        {fields.map((f) => (
          <div className="fg" key={f.key} style={f.wide ? { gridColumn: '1 / -1' } : undefined}>
            {f.type !== 'checkbox' && <label>{f.label}{f.required ? ' *' : ''}</label>}
            {f.type === 'select' ? (
              <select value={num(vals[f.key])} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">— none —</option>
                {opt(f.options).map((o) => (
                  <option key={o.id} value={o.id}>{o.name || o.code}</option>
                ))}
              </select>
            ) : f.type === 'checkbox' ? (
              <label className="cb" style={{ marginTop: 22 }}>
                <input type="checkbox" checked={!!vals[f.key]} onChange={(e) => set(f.key, e.target.checked)} /> {f.label}
              </label>
            ) : (
              <input
                type={f.type === 'number' ? 'number' : 'text'}
                step={f.type === 'number' ? 'any' : undefined}
                value={vals[f.key]}
                placeholder={f.placeholder || ''}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
      <div className="act">
        <button type="button" className="btn btn-s" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-g" disabled={submitting}>Save</button>
      </div>
    </form>
  );
}

/** Route form with an ordered-stage (department) editor. */
function RouteForm({ initial, departments, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [code, setCode] = useState(initial?.code || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [active, setActive] = useState(initial ? initial.active !== false : true);
  const [stages, setStages] = useState((initial?.stages || []).map((s) => String(s.departmentId)));
  const [pick, setPick] = useState('');
  const [err, setErr] = useState('');

  const deptName = (id) => (departments.find((d) => String(d.id) === String(id)) || {}).name || ('#' + id);
  const addStage = () => { if (pick) { setStages((s) => [...s, pick]); setPick(''); } };
  const move = (i, d) => setStages((s) => {
    const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s;
    [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const remove = (i) => setStages((s) => s.filter((_, k) => k !== i));

  async function submit(e) {
    e.preventDefault(); setErr('');
    if (!name.trim()) { setErr('Route name is required'); return; }
    const body = {
      name: name.trim(), code: code.trim() || undefined,
      description: description.trim() || undefined, active,
      stages: stages.map((id) => ({ departmentId: Number(id) })),
    };
    try { await onSubmit(body); } catch (e2) { setErr(e2.message || 'Save failed'); }
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="al al-r" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="g3">
        <div className="fg"><label>Route name *</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="fg"><label>Code</label><input value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div className="fg"><label className="cb" style={{ marginTop: 22 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label></div>
      </div>
      <div className="fg"><label>Description</label><input value={description} onChange={(e) => setDescription(e.target.value)} /></div>

      <div className="ctitle" style={{ marginTop: 12 }}>Ordered stages</div>
      <div className="fbar">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">— select a department —</option>
          {opt(departments).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button type="button" className="btn btn-s" onClick={addStage}>＋ Add stage</button>
      </div>
      {stages.length === 0 ? (
        <div className="al al-y" style={{ marginTop: 8 }}>No stages yet — a route needs at least one department in sequence.</div>
      ) : (
        <div className="tw" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th style={{ width: 60 }}>Seq</th><th>Department</th><th style={{ width: 160 }}>Order</th></tr></thead>
            <tbody>
              {stages.map((id, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{deptName(id)}</td>
                  <td>
                    <button type="button" className="btn btn-s" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>{' '}
                    <button type="button" className="btn btn-s" onClick={() => move(i, 1)} disabled={i === stages.length - 1}>↓</button>{' '}
                    <button type="button" className="btn btn-r" onClick={() => remove(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="act">
        <button type="button" className="btn btn-s" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-g">Save</button>
      </div>
    </form>
  );
}

/** Stock adjustment modal for an item. */
function StockForm({ item, onSubmit, onCancel }) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('ADJUSTMENT');
  const [ref, setRef] = useState('');
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault(); setErr('');
    const d = Number(delta);
    if (!d) { setErr('Enter a non-zero quantity (use a negative value to consume)'); return; }
    try { await onSubmit({ delta: d, reason, ref: ref.trim() || undefined }); }
    catch (e2) { setErr(e2.message || 'Save failed'); }
  }
  return (
    <form onSubmit={submit}>
      {err && <div className="al al-r" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="al al-b" style={{ marginBottom: 10 }}>
        {item.code} — {item.name} · current stock <b>{item.currentStock ?? 0}</b> {item.uom || ''}
      </div>
      <div className="g3">
        <div className="fg"><label>Quantity change *</label>
          <input type="number" step="any" value={delta} placeholder="+3000 or -2500" onChange={(e) => setDelta(e.target.value)} /></div>
        <div className="fg"><label>Reason</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option>GRN</option><option>PRODUCTION</option><option>ADJUSTMENT</option><option>OPENING</option>
          </select></div>
        <div className="fg"><label>Reference</label><input value={ref} placeholder="PO# / SO#" onChange={(e) => setRef(e.target.value)} /></div>
      </div>
      <div className="act">
        <button type="button" className="btn btn-s" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-g">Apply</button>
      </div>
    </form>
  );
}

export default function MasterData() {
  const { role } = useAuth();
  const isSuper = role === 'superadmin';
  const canConfig = isSuper;                              // depts/specs/machines/routes/dispatch
  const canItems = role === 'padmin' || isSuper;         // item master
  const canStock = role === 'stores' || role === 'padmin' || isSuper;
  const canAlerts = ['superadmin', 'stores', 'pm', 'padmin'].includes(role);   // view stock alerts
  const canResolve = role === 'superadmin' || role === 'stores';               // resolve alerts

  const [tab, setTab] = useState('departments');
  const [alerts, setAlerts] = useState([]);
  const [notes, setNotes] = useState([]);
  const [d, setD] = useState({ departments: [], specialties: [], machines: [], routes: [], dispatch: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [modal, setModal] = useState(null);   // { type, row }
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [departments, specialties, machines, routes, dispatch, items] = await Promise.all([
        masterApi.listDepartments({ includeInactive: 1 }),
        masterApi.listSpecialties({ includeInactive: 1 }),
        masterApi.listMachines({ includeInactive: 1 }),
        masterApi.listRoutes({ includeInactive: 1 }),
        masterApi.listDispatchTypes({ includeInactive: 1 }),
        masterApi.listItems({ includeInactive: 1 }),
      ]);
      setD({ departments, specialties, machines, routes, dispatch, items });
    } catch (e) { setErr(e.message || 'Failed to load master data'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const loadAlerts = useCallback(async () => {
    if (!canAlerts) return;
    try {
      const [a, n] = await Promise.all([stockApi.alerts('OPEN'), notificationsApi.list()]);
      setAlerts(a || []); setNotes(n || []);
    } catch { /* alerts may be forbidden for some roles — ignore */ }
  }, [canAlerts]);
  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };
  const close = () => setModal(null);

  async function resolveAlert(id) {
    try { await stockApi.resolveAlert(id); flash('Alert resolved'); await loadAlerts(); }
    catch (e) { setErr(e.message || 'Could not resolve'); }
  }
  async function markRead(id) {
    try { await notificationsApi.markRead(id); await loadAlerts(); } catch { /* ignore */ }
  }

  // Map modal type → create/update calls.
  async function save(type, row, body) {
    setBusy(true);
    try {
      const id = row && row.id;
      const api = masterApi;
      const call = {
        departments: id ? () => api.updateDepartment(id, body) : () => api.createDepartment(body),
        specialties: id ? () => api.updateSpecialty(id, body) : () => api.createSpecialty(body),
        machines: id ? () => api.updateMachine(id, body) : () => api.createMachine(body),
        routes: id ? () => api.updateRoute(id, body) : () => api.createRoute(body),
        dispatch: id ? () => api.updateDispatchType(id, body) : () => api.createDispatchType(body),
        items: id ? () => api.updateItem(id, body) : () => api.createItem(body),
        stock: () => api.adjustStock(row.id, body),
      }[type];
      await call();
      flash('Saved');
      close();
      await reload();
    } finally { setBusy(false); }
  }

  if (loading) return <div className="card"><div className="spin" /> Loading master data…</div>;

  return (
    <div>
      <div className="pg-ttl">⚙️ Master Data</div>
      <div className="pg-sub">Production configuration — routes, machines, departments, specialties, dispatch types and the item master.</div>

      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}
      {msg && <div className="al al-g" style={{ margin: '8px 0' }}>{msg}</div>}
      {!isSuper && (
        <div className="al al-b" style={{ margin: '8px 0' }}>
          {canItems ? 'You can manage the item master; configuration sections are read-only.'
            : canStock ? 'You can adjust item stock; the rest is read-only.'
            : 'Read-only view — configuration is managed by Super Admin.'}
        </div>
      )}

      <div className="step-bar" style={{ marginTop: 10 }}>
        {[...TABS, ...(canAlerts ? [{ key: 'alerts', label: '🔔 Stock Alerts' + (alerts.length ? ` (${alerts.length})` : '') }] : [])].map((t) => (
          <button key={t.key} className={'step-tab' + (tab === t.key ? ' on' : '')} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        {tab === 'departments' && (
          <Section title="Departments" canAdd={canConfig} onAdd={() => setModal({ type: 'departments', row: {} })}
            cols={['Name', 'Code', 'Order', 'Active']} rows={d.departments}
            render={(r) => [r.name, r.code, r.seqHint, r.active ? 'Yes' : 'No']}
            onEdit={canConfig ? (r) => setModal({ type: 'departments', row: r }) : null} />
        )}
        {tab === 'specialties' && (
          <Section title="Specialties" canAdd={canConfig} onAdd={() => setModal({ type: 'specialties', row: {} })}
            cols={['Name', 'Code', 'Active']} rows={d.specialties}
            render={(r) => [r.name, r.code, r.active ? 'Yes' : 'No']}
            onEdit={canConfig ? (r) => setModal({ type: 'specialties', row: r }) : null} />
        )}
        {tab === 'machines' && (
          <Section title="Machines" canAdd={canConfig} onAdd={() => setModal({ type: 'machines', row: {} })}
            cols={['Code', 'Name', 'Department', 'Type', 'Speed', 'Hrs/day', 'Active']} rows={d.machines}
            render={(r) => [r.code, r.name, r.departmentName, r.machineType,
              r.defaultSpeed != null ? `${r.defaultSpeed} ${r.speedUom || ''}` : '', r.functionalHoursPerDay, r.active ? 'Yes' : 'No']}
            onEdit={canConfig ? (r) => setModal({ type: 'machines', row: r }) : null} />
        )}
        {tab === 'routes' && (
          <Section title="Routes" canAdd={canConfig} onAdd={() => setModal({ type: 'routes', row: {} })}
            cols={['Name', 'Code', 'Stages (in order)', 'Active']} rows={d.routes}
            render={(r) => [r.name, r.code, (r.stages || []).map((s) => s.departmentName).join(' → ') || '—', r.active ? 'Yes' : 'No']}
            onEdit={canConfig ? (r) => setModal({ type: 'routes', row: r }) : null} />
        )}
        {tab === 'dispatch' && (
          <Section title="Dispatch Types" canAdd={canConfig} onAdd={() => setModal({ type: 'dispatch', row: {} })}
            cols={['Name', 'Code', 'Default Route', 'Active']} rows={d.dispatch}
            render={(r) => [r.name, r.code, r.defaultRouteName || '—', r.active ? 'Yes' : 'No']}
            onEdit={canConfig ? (r) => setModal({ type: 'dispatch', row: r }) : null} />
        )}
        {tab === 'items' && (
          <Section title="Item Master" canAdd={canItems} onAdd={() => setModal({ type: 'items', row: {} })}
            cols={['Code', 'Name', 'UOM', 'Specialty', 'Department', 'Stock', 'Active']} rows={d.items}
            render={(r) => [r.code, r.name, r.uom, r.specialtyName, r.departmentName, r.currentStock, r.active ? 'Yes' : 'No']}
            onEdit={canItems ? (r) => setModal({ type: 'items', row: r }) : null}
            extra={canStock ? (r) => <button className="btn btn-b" onClick={() => setModal({ type: 'stock', row: r })}>Stock</button> : null} />
        )}
        {tab === 'alerts' && (
          <div>
            <div className="ctitle">Open Low-Stock Alerts <span className={'tag ' + (alerts.length ? 'tr' : 'tg')}>{alerts.length}</span></div>
            {alerts.length === 0 ? <div className="al al-g">No open shortages.</div> : (
              <div className="tw sy">
                <table>
                  <thead><tr><th>Sale Order</th><th>Item</th><th>Required</th><th>Available</th><th>Shortage</th>{canResolve && <th></th>}</tr></thead>
                  <tbody>
                    {alerts.map((a) => (
                      <tr key={a.id} className="nr">
                        <td><span className="so-pill">{a.so}</span></td>
                        <td>{a.itemCode}{a.itemName ? ' — ' + a.itemName : ''}</td>
                        <td>{a.requiredQty}</td>
                        <td>{a.availableQty}</td>
                        <td><b>{a.shortageQty}</b></td>
                        {canResolve && <td><button className="btn btn-s" onClick={() => resolveAlert(a.id)}>Resolve</button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="ctitle" style={{ marginTop: 16 }}>My Notifications</div>
            {notes.length === 0 ? <div className="al al-b">No notifications.</div> : (
              <div className="tw">
                <table>
                  <thead><tr><th style={{ width: 150 }}>When</th><th>Message</th><th style={{ width: 100 }}>Status</th><th style={{ width: 110 }}></th></tr></thead>
                  <tbody>
                    {notes.map((n) => (
                      <tr key={n.id}>
                        <td>{n.createdAt ? n.createdAt.replace('T', ' ').slice(0, 16) : ''}</td>
                        <td>{n.message}</td>
                        <td><span className={'tag ' + (n.status === 'UNREAD' ? 'ty' : 'tgr')}>{n.status}</span></td>
                        <td>{n.status === 'UNREAD' && <button className="btn btn-s" onClick={() => markRead(n.id)}>Mark read</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── modals ── */}
      <Modal open={modal?.type === 'departments'} title={modal?.row?.id ? 'Edit Department' : 'Add Department'} onClose={close}>
        <EntityForm submitting={busy} onCancel={close} initial={modal?.row}
          onSubmit={(b) => save('departments', modal.row, b)}
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'code', label: 'Code' },
            { key: 'seqHint', label: 'Order', type: 'number' },
            { key: 'active', label: 'Active', type: 'checkbox' },
          ]} />
      </Modal>

      <Modal open={modal?.type === 'specialties'} title={modal?.row?.id ? 'Edit Specialty' : 'Add Specialty'} onClose={close}>
        <EntityForm submitting={busy} onCancel={close} initial={modal?.row}
          onSubmit={(b) => save('specialties', modal.row, b)}
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'code', label: 'Code' },
            { key: 'active', label: 'Active', type: 'checkbox' },
          ]} />
      </Modal>

      <Modal open={modal?.type === 'machines'} title={modal?.row?.id ? 'Edit Machine' : 'Add Machine'} onClose={close}>
        <EntityForm submitting={busy} onCancel={close} initial={modal?.row}
          onSubmit={(b) => save('machines', modal.row, b)}
          fields={[
            { key: 'code', label: 'Machine code', required: true },
            { key: 'name', label: 'Machine name', required: true },
            { key: 'departmentId', label: 'Department', type: 'select', options: d.departments },
            { key: 'machineType', label: 'Machine type' },
            { key: 'defaultSpeed', label: 'Default speed (per min)', type: 'number' },
            { key: 'speedUom', label: 'Speed UOM', placeholder: 'm/min, pouches/min' },
            { key: 'functionalHoursPerDay', label: 'Functional hrs/day', type: 'number' },
            { key: 'active', label: 'Active', type: 'checkbox' },
          ]} />
      </Modal>

      <Modal open={modal?.type === 'routes'} wide title={modal?.row?.id ? 'Edit Route' : 'Add Route'} onClose={close}>
        <RouteForm initial={modal?.row} departments={d.departments} onCancel={close}
          onSubmit={(b) => save('routes', modal.row, b)} />
      </Modal>

      <Modal open={modal?.type === 'dispatch'} title={modal?.row?.id ? 'Edit Dispatch Type' : 'Add Dispatch Type'} onClose={close}>
        <EntityForm submitting={busy} onCancel={close} initial={modal?.row}
          onSubmit={(b) => save('dispatch', modal.row, b)}
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'code', label: 'Code' },
            { key: 'defaultRouteId', label: 'Default route (auto-selected on a JSS)', type: 'select', options: d.routes, wide: true },
            { key: 'active', label: 'Active', type: 'checkbox' },
          ]} />
      </Modal>

      <Modal open={modal?.type === 'items'} wide title={modal?.row?.id ? 'Edit Item' : 'Add Item'} onClose={close}>
        <EntityForm submitting={busy} onCancel={close} initial={modal?.row}
          onSubmit={(b) => save('items', modal.row, b)}
          fields={[
            { key: 'code', label: 'Item code', required: true },
            { key: 'name', label: 'Item name', required: true },
            { key: 'uom', label: 'UOM' },
            { key: 'specialtyId', label: 'Specialty', type: 'select', options: d.specialties },
            { key: 'departmentId', label: 'Department', type: 'select', options: d.departments },
            { key: 'itemType', label: 'Item type' },
            { key: 'materialType', label: 'Material type' },
            { key: 'subGroup', label: 'Sub group' },
            { key: 'microns', label: 'Microns' },
            ...(modal?.row?.id ? [] : [{ key: 'currentStock', label: 'Opening stock', type: 'number' }]),
            { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
            { key: 'active', label: 'Active', type: 'checkbox' },
          ]} />
      </Modal>

      <Modal open={modal?.type === 'stock'} title="Adjust Stock" onClose={close}>
        {modal?.row && <StockForm item={modal.row} onCancel={close} onSubmit={(b) => save('stock', modal.row, b)} />}
      </Modal>
    </div>
  );
}

/** A titled table with an optional Add button and per-row Edit / extra actions. */
function Section({ title, cols, rows, render, onEdit, onAdd, canAdd, extra }) {
  return (
    <div>
      <div className="fbar" style={{ justifyContent: 'space-between' }}>
        <div className="ctitle" style={{ margin: 0 }}>{title} <span className="tag tg">{rows.length}</span></div>
        {canAdd && onAdd && <button className="btn btn-g" onClick={onAdd}>＋ Add</button>}
      </div>
      {rows.length === 0 ? (
        <div className="al al-y">Nothing configured yet.</div>
      ) : (
        <div className="tw sy">
          <table>
            <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}{(onEdit || extra) && <th style={{ width: 160 }}>Actions</th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.active === false ? 'nr' : undefined}>
                  {render(r).map((cell, i) => <td key={i}>{cell == null || cell === '' ? '—' : String(cell)}</td>)}
                  {(onEdit || extra) && (
                    <td>
                      {onEdit && <button className="btn btn-s" onClick={() => onEdit(r)}>Edit</button>}{' '}
                      {extra && extra(r)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
