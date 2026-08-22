import { useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { exportAOA } from '../lib/xlsx.js';
import { custGroups } from '../lib/master.js';
import { today } from '../lib/format.js';

// Customers admin (superadmin) — full add/edit/delete of the customer master
// (data module 4), plus a "Manage Groups & Customers" panel that renames/deletes
// a group or a customer and cascades the change across the JSS master (module 2)
// and the OAB order rows (module 1) — the legacy "Clean up groups & customer
// names" tool. A customer's `group` is what the New-PO / JSS / FG screens use to
// resolve a buying group, so it is editable here (inline column + datalist).

const clone = (o) => JSON.parse(JSON.stringify(o));
const COLS = [
  ['group', 'Group', 130], ['customer', 'Customer *', 150], ['dispatchLoc', 'Dispatch Loc', 120],
  ['warehouseName', 'Warehouse', 120], ['billingAddr', 'Billing Address', 190], ['shippingAddr', 'Shipping Address', 190],
  ['gstin', 'GSTIN', 130], ['state', 'State', 100], ['contactPerson', 'Contact Person', 120],
  ['contactPhone', 'Contact Phone', 120], ['contactEmail', 'Contact Email', 150],
];
const blankRow = () => ({ group: '', customer: '', dispatchLoc: '', warehouseName: '', billingAddr: '', shippingAddr: '', gstin: '', state: '', contactPerson: '', contactPhone: '', contactEmail: '' });
const norm = (v) => String(v || '').trim();

export default function CustomersAdmin() {
  const { mods, save, saving } = useData();
  const [rows, setRows] = useState(() => clone(mods.customers || []));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // Re-sync the editable copy whenever the server module changes (e.g. after a
  // save, or a reload elsewhere). Editing happens on this local copy.
  useEffect(() => { setRows(clone(mods.customers || [])); }, [mods.customers]);

  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  const groups = useMemo(() => custGroups(mods.customers), [mods.customers]);
  const custNames = useMemo(
    () => [...new Set((mods.customers || []).map((c) => norm(c.customer)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [mods.customers],
  );

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    // Keep original indices so edits map back to the full array.
    return rows.map((r, i) => ({ r, i })).filter(({ r }) => !s || [r.customer, r.group, r.dispatchLoc, r.gstin, r.contactPerson].some((v) => String(v || '').toLowerCase().includes(s)));
  }, [rows, q]);

  const setCell = (i, key, val) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const removeRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  async function saveAll() {
    const cleaned = rows.filter((r) => norm(r.customer));   // drop rows with no customer name
    setBusy(true);
    try { await save('customers', cleaned); flash('g', `Saved ${cleaned.length} customer record(s)`); }
    catch (e) { flash('r', 'Save failed: ' + (e.message || e)); }
    finally { setBusy(false); }
  }

  function exportExcel() {
    const header = COLS.map(([, label]) => label.replace(' *', ''));
    exportAOA([header, ...rows.map((r) => COLS.map(([k]) => r[k] ?? ''))], 'Customer_Master_' + today().replace(/-/g, '_'), 'Customers');
  }

  return (
    <>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Customer Master ({rows.length})</div>
          <input placeholder="Search customer / group / GSTIN…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={addRow}>＋ Add Row</button>
          <button className="btn btn-s" onClick={exportExcel} disabled={!rows.length}>⬇ Export</button>
          <button className="btn btn-g" onClick={saveAll} disabled={busy || saving}>{busy ? 'Saving…' : '💾 Save Customers'}</button>
        </div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <p style={{ fontSize: 11, color: 'var(--i3)', marginTop: 0 }}>One row per customer + dispatch location. <strong>Group</strong> lets the New-PO / JSS / FG screens resolve a buying group. The Invoice and New-PO screens read addresses, GSTIN and warehouse from here.</p>

        <datalist id="cust-groups-dl">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        <div className="tw sy">
          <table>
            <thead>
              <tr>{COLS.map(([k, label, w]) => <th key={k} style={{ minWidth: w }}>{label}</th>)}<th style={{ width: 40 }} /></tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={COLS.length + 1} style={{ textAlign: 'center', padding: 22, color: 'var(--i3)' }}>{rows.length ? 'No matches' : 'No customers yet — click ＋ Add Row'}</td></tr>
              ) : visible.map(({ r, i }) => (
                <tr key={i}>
                  {COLS.map(([k]) => (
                    <td key={k}><input value={r[k] ?? ''} list={k === 'group' ? 'cust-groups-dl' : undefined} onChange={(e) => setCell(i, k, e.target.value)} style={{ width: '100%' }} /></td>
                  ))}
                  <td style={{ textAlign: 'center' }}><button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 6px', color: 'var(--red)', borderColor: '#F5A8A0' }} onClick={() => removeRow(i)} title="Remove row">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ManagePanel mods={mods} save={save} groups={groups} custNames={custNames} flash={flash} disabled={busy || saving} />
    </>
  );
}

/**
 * Rename / delete a group or a customer and cascade it across the customer master
 * (module 4), the JSS spec master (module 2) and the OAB order rows (module 1),
 * so a spelling fix or merge doesn't leave orphaned names behind.
 */
function ManagePanel({ mods, save, groups, custNames, flash, disabled }) {
  const [gSel, setGSel] = useState('');
  const [gNew, setGNew] = useState('');
  const [cSel, setCSel] = useState('');
  const [cNew, setCNew] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); flash('g', ok); }
    catch (e) { flash('r', 'Failed: ' + (e.message || e)); }
    finally { setBusy(false); }
  };

  // ── group ops (groups live on customers + jss; OAB rows carry no group) ──
  async function renameGroup() {
    const from = norm(gSel), to = norm(gNew);
    if (!from || !to) return flash('r', 'Pick a group and enter a new name.');
    const c4 = (mods.customers || []).map((r) => (norm(r.group) === from ? { ...r, group: to } : r));
    await save('customers', c4);
    const j = (mods.jss || []).map((r) => (norm(r.group) === from ? { ...r, group: to } : r));
    if (j.some((r, k) => r !== (mods.jss || [])[k])) await save('jss', j);
    setGSel(''); setGNew('');
  }
  async function deleteGroup() {
    const from = norm(gSel);
    if (!from) return flash('r', 'Pick a group first.');
    const n = (mods.customers || []).filter((r) => norm(r.group) === from).length;
    if (!window.confirm(`Remove the group "${from}" from ${n} customer(s)? The customers stay; they just become ungrouped. JSS specs on this group are also cleared. This cannot be undone.`)) return;
    const c4 = (mods.customers || []).map((r) => (norm(r.group) === from ? { ...r, group: '' } : r));
    await save('customers', c4);
    const j = (mods.jss || []).map((r) => (norm(r.group) === from ? { ...r, group: '' } : r));
    if (j.some((r, k) => r !== (mods.jss || [])[k])) await save('jss', j);
    setGSel('');
  }

  // ── customer ops (cascade master + jss + oab) ──
  async function renameCustomer() {
    const from = norm(cSel), to = norm(cNew);
    if (!from || !to) return flash('r', 'Pick a customer and enter a new name.');
    const c4 = (mods.customers || []).map((r) => (norm(r.customer) === from ? { ...r, customer: to } : r));
    await save('customers', c4);
    const j = (mods.jss || []).map((r) => (norm(r.customer) === from ? { ...r, customer: to } : r));
    if (j.some((r, k) => r !== (mods.jss || [])[k])) await save('jss', j);
    const oab = clone(mods.oab); let dirty = false;
    ['SF', 'OT'].forEach((sh) => (oab.OAB?.[sh] || []).forEach((r) => { if (norm(r.customer) === from) { r.customer = to; dirty = true; } }));
    if (dirty) await save('oab', oab);
    setCSel(''); setCNew('');
  }
  async function deleteCustomer() {
    const from = norm(cSel);
    if (!from) return flash('r', 'Pick a customer first.');
    const inJss = (mods.jss || []).filter((r) => norm(r.customer) === from).length;
    const inOab = ['SF', 'OT'].reduce((s, sh) => s + (mods.oab?.OAB?.[sh] || []).filter((r) => norm(r.customer) === from).length, 0);
    let warn = `Delete customer "${from}" from the customer master?`;
    if (inJss || inOab) warn += `\n\n⚠ ${inJss} JSS spec(s) and ${inOab} sale order(s) still reference this name — they are NOT changed, so rename+merge instead if this is a duplicate.`;
    warn += '\n\nThis cannot be undone.';
    if (!window.confirm(warn)) return;
    const c4 = (mods.customers || []).filter((r) => norm(r.customer) !== from);
    await save('customers', c4);
    setCSel('');
  }

  const box = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 };
  const b = disabled || busy;
  return (
    <div className="card">
      <div className="ctitle">🧹 Manage Groups &amp; Customers <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--i3)' }}>— rename / delete &amp; merge (cascades to JSS &amp; orders)</span></div>

      <div style={box}>
        <strong style={{ fontSize: 12, width: 78 }}>Group</strong>
        <select value={gSel} onChange={(e) => setGSel(e.target.value)} disabled={b} style={{ minWidth: 180 }}>
          <option value="">— select group —</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <span style={{ color: 'var(--i3)' }}>→</span>
        <input placeholder="Rename to…" value={gNew} onChange={(e) => setGNew(e.target.value)} disabled={b} style={{ width: 200 }} />
        <button className="btn btn-s" disabled={b} onClick={() => run(renameGroup, 'Group renamed')}>Rename</button>
        <button className="btn btn-s" disabled={b} style={{ color: 'var(--red)', borderColor: '#F5A8A0' }} onClick={() => run(deleteGroup, 'Group removed')}>Delete</button>
      </div>

      <div style={box}>
        <strong style={{ fontSize: 12, width: 78 }}>Customer</strong>
        <select value={cSel} onChange={(e) => setCSel(e.target.value)} disabled={b} style={{ minWidth: 180 }}>
          <option value="">— select customer —</option>
          {custNames.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={{ color: 'var(--i3)' }}>→</span>
        <input placeholder="Rename to… (existing name = merge)" value={cNew} onChange={(e) => setCNew(e.target.value)} disabled={b} style={{ width: 240 }} />
        <button className="btn btn-s" disabled={b} onClick={() => run(renameCustomer, 'Customer renamed / merged')}>Rename</button>
        <button className="btn btn-s" disabled={b} style={{ color: 'var(--red)', borderColor: '#F5A8A0' }} onClick={() => run(deleteCustomer, 'Customer deleted')}>Delete</button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--i3)' }}>Rename cascades the new name across the customer master, JSS specs and open/closed sale orders. Renaming to an existing name merges the two.</div>
    </div>
  );
}
