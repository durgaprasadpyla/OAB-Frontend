import { useMemo, useState } from 'react';
import { readWorkbookAOA } from '../lib/xlsx.js';
import { ddList } from '../lib/dropdowns.js';
import { activeReps } from '../lib/sales.js';
import { saveErrorText } from '../lib/repFlow.js';
import { pickLeadSheet, parseLeadRows, planImport, applyImport, matchRep } from '../lib/leadImport.js';

// ⬆ Import leads — the sales team's Lead List (TOOL FORMAT sheet) into module 12.
//
// Nothing is written until Import is pressed: the file is read, the companies and
// contacts it holds are shown against the leads already there, and each "Lead Name"
// in the sheet is matched to a rep account the admin can change. Leads go into the
// rep's login (and this dashboard) exactly as if the rep had added them.

const BLANK = '';

export default function LeadImport({ sales, save, onClose }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [repMap, setRepMap] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const reps = activeReps(sales.sales_users);

  async function read(f) {
    setFile(f); setParsed(null); setMsg(null);
    if (!f) return;
    try {
      const sheet = pickLeadSheet(await readWorkbookAOA(f));
      if (!sheet) throw new Error('No sheet with a "Company Name" column — use the Lead List (TOOL FORMAT) sheet.');
      const p = parseLeadRows(sheet.rows, {
        categories: ddList(sales, 'categories'), statuses: ddList(sales, 'statuses'), designations: ddList(sales, 'designations'),
      });
      const m = {};
      Object.keys(p.repNames).forEach((n) => { m[n] = n ? matchRep(n, sales.sales_users) : BLANK; });
      setRepMap(m); setParsed(p);
    } catch (e) { setMsg({ t: 'r', text: e.message || String(e) }); }
  }

  const plan = useMemo(() => (parsed ? planImport(parsed, sales) : null), [parsed, sales]);
  const contactCount = (list) => list.reduce((t, c) => t + c.contacts.length, 0);

  async function run() {
    if (!parsed) return;
    const unmatched = Object.keys(repMap).filter((n) => n && !repMap[n]);
    if (unmatched.length && !window.confirm(`No rep chosen for: ${unmatched.join(', ')}.\n\nTheir leads will be imported Unassigned (visible here, in no rep's login). Continue?`)) return;
    setBusy(true); setMsg(null);
    try {
      let counts = null;
      // built over the server's copy, so a lead a rep added a moment ago is joined, not duplicated
      await save('sales', (prev) => {
        const r = applyImport(prev, parsed, (n) => repMap[n] || '');
        counts = r.counts;
        return r.next;
      }, { retry: true });
      setMsg({ t: 'g', text: `✅ Imported ${counts.leads} new lead(s) and ${counts.contacts} contact(s)`
        + (counts.joined ? `; ${counts.joined} existing lead(s) gained contacts` : '')
        + (counts.unchanged ? `; ${counts.unchanged} already on the list unchanged` : '') + '.' });
      setParsed(null); setFile(null);
    } catch (e) { setMsg({ t: 'r', text: saveErrorText(e, 'Import') }); }
    finally { setBusy(false); }
  }

  const repLabel = (n) => (n ? `“${n}”` : '(blank Lead Name)');
  const newCats = plan ? [...new Set(plan.create.flatMap((c) => c.categories))]
    .filter((c) => !ddList(sales, 'categories').includes(c)) : [];

  return (
    <div className="card" style={{ border: '1px solid var(--blu)', marginBottom: 8 }} aria-label="Import leads">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>⬆ Import leads from Excel</div>
        <input type="file" accept=".xlsx,.xls" aria-label="Lead list file" onChange={(e) => read(e.target.files && e.target.files[0])} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={onClose} disabled={busy}>Close</button>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        The Lead List’s TOOL FORMAT sheet: one row per contact. Rows of the same company become one lead with all its contacts.
        Companies already on the list are not duplicated — they only gain contacts they do not have.
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      {parsed && plan && (
        <>
          <div className="stats" style={{ margin: '6px 0' }}>
            <div className="stat"><div className="sl">New leads</div><div className="sv">{plan.create.length}</div></div>
            <div className="stat"><div className="sl">New contacts</div><div className="sv">{contactCount(plan.create) + contactCount(plan.update)}</div></div>
            <div className="stat"><div className="sl">Already listed</div><div className="sv">{plan.update.length + plan.unchanged.length}</div></div>
            <div className="stat"><div className="sl">Rows skipped</div><div className="sv">{parsed.skipped.length}</div></div>
          </div>
          {parsed.skipped.length > 0 && (
            <div className="al al-y">Skipped (no company name): row {parsed.skipped.map((x) => x.row).join(', ')}</div>
          )}
          <table style={{ maxWidth: 560, marginBottom: 6 }}>
            <thead><tr><th>Lead Name in sheet</th><th style={{ textAlign: 'right' }}>Companies</th><th>Goes to rep</th></tr></thead>
            <tbody>
              {Object.keys(parsed.repNames).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b)).map((n) => (
                <tr key={n || '__blank'}>
                  <td>{repLabel(n)}</td>
                  <td style={{ textAlign: 'right' }}>{parsed.repNames[n]}</td>
                  <td>
                    <select value={repMap[n] || ''} aria-label={`Rep for ${repLabel(n)}`}
                      onChange={(e) => setRepMap((m) => ({ ...m, [n]: e.target.value }))}>
                      <option value="">— Unassigned —</option>
                      {reps.map((r) => <option key={r.id} value={r.id}>{r.display_name || r.username}</option>)}
                    </select>
                    {n && !repMap[n] && <span style={{ color: 'var(--red)', fontSize: 11, marginLeft: 6 }}>no rep account matched</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {newCats.length > 0 && (
            <div className="al al-y">Categories not on the Dropdown Lists yet (kept as typed): {newCats.join(', ')}. Add them under ⚙ Dropdown Lists so reps can pick them.</div>
          )}
          <div className="tw sy" style={{ maxHeight: 260 }}>
            <table>
              <thead><tr><th>Company</th><th>Lead Name</th><th>Categories</th><th>Status</th><th>Pay</th><th>HO / Dispatch</th><th style={{ textAlign: 'right' }}>Contacts</th><th></th></tr></thead>
              <tbody>
                {[...plan.create.map((c) => ({ c, tag: 'new' })), ...plan.update.map((c) => ({ c, tag: '+contacts' })), ...plan.unchanged.map((c) => ({ c, tag: 'on list' }))]
                  .map(({ c, tag }) => (
                    <tr key={c.key}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td style={{ fontSize: 11 }}>{c.rep || '—'}</td>
                      <td style={{ fontSize: 11 }}>{c.categories.join(', ') || '—'}</td>
                      <td style={{ fontSize: 11 }}>{c.status || 'To Approach'}</td>
                      <td style={{ fontSize: 11 }}>{c.paymentType || '—'}</td>
                      <td style={{ fontSize: 11 }}>{[c.hoCity || c.hoAddress, c.dispatchCity].filter(Boolean).join(' / ') || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{c.contacts.length}</td>
                      <td><span className={'tag ' + (tag === 'new' ? 'tg' : tag === 'on list' ? 'tgr' : 'ty')} style={{ fontSize: 9 }}>{tag}</span></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button className="btn btn-g" onClick={run} disabled={busy || (!plan.create.length && !plan.update.length)} aria-label="Import now">
              {busy ? 'Importing…' : `Import ${plan.create.length} lead(s)`}
            </button>
            <span style={{ fontSize: 11, color: 'var(--i3)', alignSelf: 'center' }}>{file ? file.name : ''}</span>
          </div>
        </>
      )}
    </div>
  );
}
