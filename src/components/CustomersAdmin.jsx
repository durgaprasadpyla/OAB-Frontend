import { useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { exportAOA } from '../lib/xlsx.js';
import { custGroups, custsInGroup } from '../lib/master.js';
import { today } from '../lib/format.js';

// Customers admin (superadmin) — Issues 2.0: works like the old version. A TOP
// FORM adds a new customer; the table is READ-ONLY and each row has an Edit
// button that loads it into the form for update. Plus the "Manage Groups &
// Customers" panel that renames/deletes a group or a customer and cascades the
// change across the JSS master (module 2) and the OAB order rows (module 1).

const clone = (o) => JSON.parse(JSON.stringify(o));
const COLS = [
  ['group', 'Group', 130], ['customer', 'Customer *', 150], ['dispatchLoc', 'Dispatch Loc', 120],
  ['warehouseName', 'Warehouse', 120], ['billingAddr', 'Billing Address', 190], ['shippingAddr', 'Shipping Address', 190],
  ['gstin', 'GSTIN', 130], ['state', 'State', 100], ['contactPerson', 'Contact Person', 120],
  ['contactPhone', 'Contact Phone', 120], ['contactEmail', 'Contact Email', 150],
  ['remarks', 'Remarks', 170],
];
const blankRow = () => ({ group: '', customer: '', dispatchLoc: '', warehouseName: '', billingAddr: '', shippingAddr: '', gstin: '', state: '', contactPerson: '', contactPhone: '', contactEmail: '', remarks: '' });
const norm = (v) => String(v || '').trim();

export default function CustomersAdmin() {
  const { mods, save, saving } = useData();
  const [rows, setRows] = useState(() => clone(mods.customers || []));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // Issues 2.0: like the old version — a TOP FORM adds/edits customers, the
  // table itself is read-only. "Edit" loads the row into the form; Save writes.
  const [form, setForm] = useState(() => blankRow());
  const [editIdx, setEditIdx] = useState(-1);
  // "+ Add new group…" / "+ Add new customer…" live INSIDE the dropdowns and
  // reveal a text field; picking a group populates its customers below.
  const [groupNew, setGroupNew] = useState('');
  const [customerNew, setCustomerNew] = useState('');

  // Re-sync the read-only copy whenever the server module changes.
  useEffect(() => { setRows(clone(mods.customers || [])); }, [mods.customers]);

  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  const groups = useMemo(() => custGroups(mods.customers), [mods.customers]);
  const custNames = useMemo(
    () => [...new Set((mods.customers || []).map((c) => norm(c.customer)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [mods.customers],
  );

  // Customers that belong to the currently picked group (for the cascade).
  const groupCustomers = useMemo(() => {
    if (form.group === '__new__') return [];
    return custsInGroup(mods.customers, form.group);
  }, [mods.customers, form.group]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    // Keep original indices so edits map back to the full array.
    return rows.map((r, i) => ({ r, i })).filter(({ r }) => !s || [r.customer, r.group, r.dispatchLoc, r.gstin, r.contactPerson].some((v) => String(v || '').toLowerCase().includes(s)));
  }, [rows, q]);

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  function startEdit(i) {
    setForm(clone(rows[i]));
    setGroupNew(''); setCustomerNew('');
    setEditIdx(i);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* jsdom */ }
  }
  function cancelEdit() { setForm(blankRow()); setGroupNew(''); setCustomerNew(''); setEditIdx(-1); }

  async function submitForm() {
    // Build the row from the form, resolving the "+ add new" pickers.
    const row = {};
    COLS.forEach(([k]) => { row[k] = String(form[k] ?? '').trim(); });
    if (form.group === '__new__') row.group = groupNew.trim();
    if (form.customer === '__new__') row.customer = customerNew.trim();
    if (!norm(row.customer)) return flash('r', 'Customer name is required.');
    const next = clone(rows);
    if (editIdx >= 0) next[editIdx] = row; else next.push(row);
    setBusy(true);
    try {
      await save('customers', next.filter((r) => norm(r.customer)));
      flash('g', editIdx >= 0 ? 'Customer updated.' : 'Customer added.');
      cancelEdit();
    } catch (e) { flash('r', 'Save failed: ' + (e.message || e)); }
    finally { setBusy(false); }
  }

  async function deleteRow(i) {
    const name = norm(rows[i]?.customer) || '(unnamed)';
    if (!window.confirm('Delete customer "' + name + '" from the master? This cannot be undone.')) return;
    const next = rows.filter((_, j) => j !== i);
    setBusy(true);
    try { await save('customers', next); flash('g', 'Customer deleted.'); if (editIdx === i) cancelEdit(); }
    catch (e) { flash('r', 'Delete failed: ' + (e.message || e)); }
    finally { setBusy(false); }
  }

  function exportExcel() {
    const header = COLS.map(([, label]) => label.replace(' *', ''));
    exportAOA([header, ...rows.map((r) => COLS.map(([k]) => r[k] ?? ''))], 'Customer_Master_' + today().replace(/-/g, '_'), 'Customers');
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">{editIdx >= 0 ? '✏ Edit Customer — ' + (norm(rows[editIdx]?.customer) || '') : '＋ Add New Customer'}</div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <datalist id="cust-groups-dl">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        <div className="g4">
          {COLS.map(([k, label]) => (
            <div className="fg" key={k}>
              <label>{label}</label>
              {k === 'group' ? (
                <>
                  <select value={form.group} aria-label="Customer form Group"
                    onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}>
                    <option value="">— No group —</option>
                    {form.group && form.group !== '__new__' && !groups.includes(form.group) && <option value={form.group}>{form.group}</option>}
                    {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                    <option value="__new__">＋ Add new group…</option>
                  </select>
                  {form.group === '__new__' && (
                    <input placeholder="New group name" value={groupNew} aria-label="New group name"
                      style={{ marginTop: 6 }} onChange={(e) => setGroupNew(e.target.value)} />
                  )}
                </>
              ) : k === 'customer' ? (
                <>
                  <select value={form.customer} aria-label="Customer form Customer" onChange={setField('customer')}>
                    <option value="">— select customer —</option>
                    {form.customer && form.customer !== '__new__' && !groupCustomers.includes(form.customer) && <option value={form.customer}>{form.customer}</option>}
                    {groupCustomers.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value="__new__">＋ Add new customer…</option>
                  </select>
                  {form.customer === '__new__' && (
                    <input placeholder="New customer name" value={customerNew} aria-label="New customer name"
                      style={{ marginTop: 6 }} onChange={(e) => setCustomerNew(e.target.value)} />
                  )}
                </>
              ) : (
                <input value={form[k] ?? ''}
                  aria-label={'Customer form ' + label.replace(' *', '')} onChange={setField(k)} />
              )}
            </div>
          ))}
        </div>
        <div className="act">
          <button className="btn btn-g" onClick={submitForm} disabled={busy || saving}>
            {busy ? 'Saving…' : (editIdx >= 0 ? '💾 Update Customer' : '＋ Add Customer')}
          </button>
          {editIdx >= 0 && <button className="btn btn-s" onClick={cancelEdit} disabled={busy}>Cancel</button>}
        </div>
      </div>

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Customer Master ({rows.length})</div>
          <input placeholder="Search customer / group / GSTIN…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={exportExcel} disabled={!rows.length}>⬇ Export</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--i3)', marginTop: 0 }}>Read-only — pick a row with its radio button to load it into the form above; ✕ deletes the row. One row per customer + dispatch location; <strong>Group</strong> lets the New-PO / JSS / FG screens resolve a buying group.</p>

        <div className="tw sy">
          <table>
            <thead>
              <tr><th style={{ width: 42 }}>Edit</th>{COLS.map(([k, label, w]) => <th key={k} style={{ minWidth: w }}>{label.replace(' *', '')}</th>)}<th style={{ width: 40 }}></th></tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={COLS.length + 2} style={{ textAlign: 'center', padding: 22, color: 'var(--i3)' }}>{rows.length ? 'No matches' : 'No customers yet — add one in the form above'}</td></tr>
              ) : visible.map(({ r, i }) => (
                <tr key={i} style={editIdx === i ? { background: 'var(--gl)' } : undefined}>
                  <td style={{ textAlign: 'center' }}>
                    <input type="radio" name="cust-edit-sel" checked={editIdx === i} onChange={() => startEdit(i)}
                      aria-label={'Edit customer ' + (norm(r.customer) || i)} />
                  </td>
                  {COLS.map(([k]) => <td key={k} style={{ fontSize: 11 }}>{r[k] || '-'}</td>)}
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 6px', color: 'var(--red)', borderColor: '#F5A8A0' }}
                      aria-label={'Delete customer ' + (norm(r.customer) || i)} onClick={() => deleteRow(i)} title="Delete customer">✕</button>
                  </td>
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
    await renameGroupOnLeads(from, to);
    setGSel(''); setGNew('');
  }
  async function deleteGroup() {
    const from = norm(gSel);
    if (!from) return flash('r', 'Pick a group first.');
    const n = (mods.customers || []).filter((r) => norm(r.group) === from).length;
    const onLeads = ((mods.sales && mods.sales.leads) || []).filter((l) => norm(l.group) === from).length;
    if (!window.confirm(`Remove the group "${from}" from ${n} customer(s)${onLeads ? ` and ${onLeads} lead(s)` : ''}? They stay; they just become ungrouped. JSS specs on this group are also cleared. This cannot be undone.`)) return;
    const c4 = (mods.customers || []).map((r) => (norm(r.group) === from ? { ...r, group: '' } : r));
    await save('customers', c4);
    const j = (mods.jss || []).map((r) => (norm(r.group) === from ? { ...r, group: '' } : r));
    if (j.some((r, k) => r !== (mods.jss || [])[k])) await save('jss', j);
    await renameGroupOnLeads(from, '');
    setGSel('');
  }

  /**
   * A group deleted or renamed here must also leave the sales LEADS (module 12).
   * Without this a rep-created group lingered on the S Dashboard long after it was
   * removed from the Customer Master, which is what the business reported.
   */
  async function renameGroupOnLeads(from, to) {
    const leads = (mods.sales && mods.sales.leads) || [];
    if (!leads.some((l) => norm(l.group) === from)) return;
    await save('sales', (prev) => ({
      ...(prev || {}),
      leads: ((prev && prev.leads) || []).map((l) => (norm(l.group) === from ? { ...l, group: to } : l)),
    }));
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
