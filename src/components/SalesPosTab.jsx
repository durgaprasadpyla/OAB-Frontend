import { useMemo, useState } from 'react';
import { fmtDate, inr } from '../lib/format.js';
import { activeReps, repName } from '../lib/sales.js';
import { poRows } from '../lib/salesAdmin.js';

// 📦 All POs — every purchase order every rep has booked, with the running value.
// Ported from sdashPOs / sdashPOsFilter.

export default function SalesPosTab({ sales }) {
  const [rep, setRep] = useState('');
  const [q, setQ] = useState('');
  const reps = activeReps(sales.sales_users);
  const { rows, grand } = useMemo(() => poRows(sales, { repId: rep, q }), [sales, rep, q]);

  return (
    <div className="card">
      <div className="ctitle">📦 All POs</div>
      <div className="fbar">
        <input value={q} placeholder="Search customer / PO#..." aria-label="Search POs" onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
        <select value={rep} aria-label="Filter by rep" onChange={(e) => setRep(e.target.value)}>
          <option value="">All Reps</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 12, color: 'var(--i3)', marginBottom: 10 }}>
        Total PO value: <b style={{ color: 'var(--g)' }}>₹{inr(grand)}</b> across {rows.length} PO line item(s)
      </div>
      <div className="tw sy">
        <table>
          <thead><tr>
            <th>Date</th><th>PO #</th><th>Customer</th><th>SKU</th>
            <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Price/Unit</th>
            <th style={{ textAlign: 'right' }}>Total</th><th>Rep</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No POs match</td></tr>
            ) : rows.map(({ p, lead, sku, total }) => (
              <tr key={p.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.date)}</td>
                <td style={{ fontWeight: 600 }}>{p.po_number || '—'}</td>
                <td>{lead ? lead.client_name : '—'}</td>
                <td>{sku ? sku.sku_name : '—'}</td>
                <td style={{ textAlign: 'right' }}>{inr(p.qty)}</td>
                <td style={{ textAlign: 'right' }}>₹{inr(p.price)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>₹{inr(total)}</td>
                <td>{repName(sales.sales_users, p.created_by)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
