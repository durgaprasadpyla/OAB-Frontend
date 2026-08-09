import { useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { exportAOA } from '../lib/xlsx.js';
import { today } from '../lib/format.js';

// Customers admin (superadmin) — full add/edit/delete of the customer master
// (data module 4). One row per customer + dispatch location, matching how the
// Invoice / New-PO screens look customers up. Saves the whole array via
// useData().save('customers', rows). Extra legacy-only fields on a row are
// preserved on save (spread), even though only these are edited here.

const clone = (o) => JSON.parse(JSON.stringify(o));
const COLS = [
  ['customer', 'Customer *', 150], ['dispatchLoc', 'Dispatch Loc', 130], ['warehouseName', 'Warehouse', 130],
  ['billingAddr', 'Billing Address', 200], ['shippingAddr', 'Shipping Address', 200], ['gstin', 'GSTIN', 130],
  ['state', 'State', 110], ['contactPerson', 'Contact Person', 130], ['contactPhone', 'Contact Phone', 120],
];
const blankRow = () => ({ customer: '', dispatchLoc: '', warehouseName: '', billingAddr: '', shippingAddr: '', gstin: '', state: '', contactPerson: '', contactPhone: '' });

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

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    // Keep original indices so edits map back to the full array.
    return rows.map((r, i) => ({ r, i })).filter(({ r }) => !s || [r.customer, r.dispatchLoc, r.gstin, r.contactPerson].some((v) => String(v || '').toLowerCase().includes(s)));
  }, [rows, q]);

  const setCell = (i, key, val) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const removeRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  async function saveAll() {
    const cleaned = rows.filter((r) => String(r.customer || '').trim());   // drop rows with no customer name
    if (cleaned.some((r) => !String(r.customer || '').trim())) { flash('r', 'Every row needs a Customer name'); return; }
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
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>Customer Master ({rows.length})</div>
        <input placeholder="Search customer / location / GSTIN…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={addRow}>＋ Add Row</button>
        <button className="btn btn-s" onClick={exportExcel} disabled={!rows.length}>⬇ Export</button>
        <button className="btn btn-g" onClick={saveAll} disabled={busy || saving}>{busy ? 'Saving…' : '💾 Save Customers'}</button>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <p style={{ fontSize: 11, color: 'var(--i3)', marginTop: 0 }}>One row per customer + dispatch location. The Invoice and New-PO screens read addresses, GSTIN and warehouse from here.</p>

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
                  <td key={k}><input value={r[k] ?? ''} onChange={(e) => setCell(i, k, e.target.value)} style={{ width: '100%' }} /></td>
                ))}
                <td style={{ textAlign: 'center' }}><button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 6px', color: 'var(--red)', borderColor: '#F5A8A0' }} onClick={() => removeRow(i)} title="Remove row">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
