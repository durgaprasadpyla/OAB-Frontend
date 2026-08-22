import { useMemo, useState } from 'react';
import { exportAOA } from '../lib/xlsx.js';
import { repName } from '../lib/sales.js';
import { contactRows } from '../lib/salesAdmin.js';

// 👥 Contacts — every contact across every lead and category, in one searchable
// list, with a Remarks column, inline Edit/Delete and an Excel extract. Ported from
// sdashContacts / sdashContactsFilter / sdashExportContacts / sdashEditContact.

const RANK = { 1: 'Primary', 2: 'Secondary', 3: 'Tertiary' };
const RANK_OPTS = [['', '—'], ['1', 'Primary'], ['2', 'Secondary'], ['3', 'Tertiary']];
const catsOf = (c) => (Array.isArray(c.categories) && c.categories.length ? c.categories : (c.category ? [c.category] : []));

export default function SalesContactsTab({ sales, save }) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => contactRows(sales, q), [sales, q]);

  function startEdit(c) {
    setEditing(c.id);
    setDraft({
      name: c.name || '', designation: c.designation || '', phone: c.phone || '',
      email: c.email || '', remarks: c.remarks || '', priority: c.priority != null && c.priority !== '' ? String(c.priority) : '',
    });
    setMsg(null);
  }

  async function saveEdit() {
    setBusy(true);
    try {
      await save('sales', (prev) => ({
        ...(prev || {}),
        contacts: ((prev && prev.contacts) || []).map((x) => (x.id === editing
          ? { ...x, ...draft, priority: draft.priority ? Number(draft.priority) : '', is_primary: draft.priority === '1' }
          : x)),
      }));
      setEditing(null);
      setMsg({ t: 'g', text: '✅ Contact updated.' });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  }

  async function del(c) {
    if (!window.confirm(`Delete contact "${c.name}"? This removes it from the sales book.`)) return;
    setBusy(true);
    try {
      await save('sales', (prev) => ({ ...(prev || {}), contacts: ((prev && prev.contacts) || []).filter((x) => x.id !== c.id) }));
      if (editing === c.id) setEditing(null);
      setMsg({ t: 'g', text: '✅ Contact deleted.' });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  }

  function exportExcel() {
    const header = ['Contact', 'Designation', 'Customer', 'Group', 'Categories', 'Rank', 'Phone', 'Email', 'Remarks', 'Rep'];
    const body = rows.map(({ c, lead }) => [
      c.name || '', c.designation || '', c.customer || (lead ? lead.client_name : ''), c.group || '',
      catsOf(c).join(', '), RANK[c.priority] || '', c.phone || '', c.email || '', c.remarks || '',
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
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="tw sy">
        <table>
          <thead><tr>
            <th>Contact</th><th>Designation</th><th>Customer</th><th>Group</th>
            <th>Categories</th><th>Rank</th><th>Phone</th><th>Email</th><th>Remarks</th><th>Rep</th><th style={{ width: 110 }}>Actions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No contacts match</td></tr>
            ) : rows.map(({ c, lead }) => (
              editing === c.id ? (
                <tr key={c.id} style={{ background: '#fffaf0' }}>
                  <td><input value={draft.name} aria-label="Edit name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
                  <td><input value={draft.designation} aria-label="Edit designation" onChange={(e) => setDraft({ ...draft, designation: e.target.value })} /></td>
                  <td>{c.customer || (lead ? lead.client_name : '—')}</td>
                  <td style={{ fontSize: 11 }}>{c.group || '—'}</td>
                  <td>{catsOf(c).map((cat) => <span key={cat} className="tag tb" style={{ marginRight: 3 }}>{cat}</span>)}</td>
                  <td>
                    <select value={draft.priority} aria-label="Edit rank" onChange={(e) => setDraft({ ...draft, priority: e.target.value })} style={{ height: 26, fontSize: 11 }}>
                      {RANK_OPTS.map(([v, l]) => <option key={v || 'none'} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td><input value={draft.phone} aria-label="Edit phone" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></td>
                  <td><input value={draft.email} aria-label="Edit email" onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></td>
                  <td><input value={draft.remarks} aria-label="Edit remarks" onChange={(e) => setDraft({ ...draft, remarks: e.target.value })} /></td>
                  <td style={{ fontSize: 11 }}>{repName(sales.sales_users, c.created_by)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-s" style={{ color: 'var(--g)' }} disabled={busy} aria-label="Save contact" onClick={saveEdit}>Save</button>
                    <button className="btn btn-s" style={{ marginLeft: 4 }} aria-label="Cancel edit" onClick={() => setEditing(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700 }}>{c.name || '—'}</td>
                  <td style={{ fontSize: 11 }}>{c.designation || '—'}</td>
                  <td>{c.customer || (lead ? lead.client_name : '—')}</td>
                  <td style={{ fontSize: 11 }}>{c.group || '—'}</td>
                  <td>{catsOf(c).map((cat) => <span key={cat} className="tag tb" style={{ marginRight: 3 }}>{cat}</span>)}</td>
                  <td style={{ fontSize: 11 }}>{RANK[c.priority] || '—'}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{c.phone || '—'}</td>
                  <td style={{ fontSize: 11 }}>{c.email || '—'}</td>
                  <td style={{ fontSize: 11 }}>{c.remarks || '—'}</td>
                  <td style={{ fontSize: 11 }}>{repName(sales.sales_users, c.created_by)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-s" style={{ color: '#3730a3' }} aria-label={`Edit ${c.name}`} onClick={() => startEdit(c)}>Edit</button>
                    <button className="btn btn-s" style={{ marginLeft: 4, color: 'var(--red)' }} disabled={busy} aria-label={`Delete ${c.name}`} onClick={() => del(c)}>Delete</button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
