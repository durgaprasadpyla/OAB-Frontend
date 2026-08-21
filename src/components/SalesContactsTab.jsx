import { useMemo, useState } from 'react';
import { exportAOA } from '../lib/xlsx.js';
import { repName } from '../lib/sales.js';
import { contactRows } from '../lib/salesAdmin.js';

// 👥 Contacts — every contact across every lead and category, in one searchable
// list, with an Excel extract. Ported from sdashContacts / sdashContactsFilter /
// sdashExportContacts.

const RANK = { 1: 'Primary', 2: 'Secondary', 3: 'Tertiary' };
const catsOf = (c) => (Array.isArray(c.categories) && c.categories.length ? c.categories : (c.category ? [c.category] : []));

export default function SalesContactsTab({ sales }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => contactRows(sales, q), [sales, q]);

  function exportExcel() {
    const header = ['Contact', 'Designation', 'Customer', 'Group', 'Categories', 'Rank', 'Phone', 'Email', 'Rep'];
    const body = rows.map(({ c, lead }) => [
      c.name || '', c.designation || '', c.customer || (lead ? lead.client_name : ''), c.group || '',
      catsOf(c).join(', '), RANK[c.priority] || '', c.phone || '', c.email || '',
      repName(sales.sales_users, c.created_by),
    ]);
    exportAOA([header, ...body], 'Bloomflex_Contacts_' + new Date().toISOString().slice(0, 10) + '.xlsx', 'Contacts');
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>👥 All Contacts — Every Lead, Every Category</div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-g" onClick={exportExcel}>⬇ Export Excel</button>
      </div>
      <input
        value={q} placeholder="Search contact name, customer, phone, email..." aria-label="Search contacts"
        onChange={(e) => setQ(e.target.value)} style={{ height: 32, width: 320, marginBottom: 12 }}
      />
      <div className="tw sy">
        <table>
          <thead><tr>
            <th>Contact</th><th>Designation</th><th>Customer</th><th>Group</th>
            <th>Categories</th><th>Rank</th><th>Phone</th><th>Email</th><th>Rep</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No contacts match</td></tr>
            ) : rows.map(({ c, lead }) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 700 }}>{c.name || '—'}</td>
                <td style={{ fontSize: 11 }}>{c.designation || '—'}</td>
                <td>{c.customer || (lead ? lead.client_name : '—')}</td>
                <td style={{ fontSize: 11 }}>{c.group || '—'}</td>
                <td>{catsOf(c).map((cat) => <span key={cat} className="tag tb" style={{ marginRight: 3 }}>{cat}</span>)}</td>
                <td style={{ fontSize: 11 }}>{RANK[c.priority] || '—'}</td>
                <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{c.phone || '—'}</td>
                <td style={{ fontSize: 11 }}>{c.email || '—'}</td>
                <td style={{ fontSize: 11 }}>{repName(sales.sales_users, c.created_by)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
