import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { exportAOA } from '../lib/xlsx.js';
import { custGroups } from '../lib/master.js';
import { today } from '../lib/format.js';
import { leadOwnerIds, repName } from '../lib/sales.js';
import {
  isCustomerLead, isConvertedStage, conversionPending, conversionQueue, convertLeads, revertLead,
  customerRowsToAdd, inCustomerMaster, sameCustomerName, saveErrorText,
} from '../lib/repFlow.js';
import ConversionQueue from './ConversionQueue.jsx';

// Leads, in the Super Admin dashboard next to Customers.
//
// A sales rep's entry is a LEAD until somebody promotes it. The S Dashboard can
// promote and demote, but there was nowhere to SEE the leads and correct them —
// which is what this tab is for: the list, editable, with the same top-form
// pattern the Customers tab uses, plus promote / demote in place.
//
// Leads live in the sales blob (module 12) alongside contacts and targets, so
// only the lead rows are ever rewritten here.

const clone = (o) => JSON.parse(JSON.stringify(o));
const norm = (v) => String(v || '').trim();

// The fields worth correcting from here. `client_name` is the lead's name — the
// same field the rep fills in — and `group` is what ties it to a buying group.
const COLS = [
  ['client_name', 'Lead / Company *', 180], ['group', 'Group', 130], ['city', 'City', 110],
  ['head_office', 'Head Office', 150], ['delivery_location', 'Delivery Location', 150],
  ['gstin', 'GSTIN', 130], ['payment_type', 'Payment', 90], ['stage', 'Status', 110],
  ['remarks', 'Remarks', 170],
];
const blank = () => COLS.reduce((o, [k]) => { o[k] = ''; return o; }, {});

export default function LeadsAdmin() {
  const { mods, save, saving } = useData();
  const sales = mods.sales || {};
  const leads = useMemo(() => (Array.isArray(sales.leads) ? sales.leads : []), [sales.leads]);
  const customers = mods.customers || [];

  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState('');
  const [showConverted, setShowConverted] = useState(true);

  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };
  const groups = useMemo(() => custGroups(customers), [customers]);

  const inMaster = (name) => inCustomerMaster(name, customers);
  /**
   * 29.09: "I have marked these customers from whom we have received POs as customers
   * … but whereas in the sales rep login they are still under leads converted."
   *
   * This screen used to call a lead a customer when its NAME merely appeared in the
   * Customer Master — which every lead we have taken a PO from does. So it showed
   * "✓ Customer", the Super Admin saw nothing left to do, and the conversion was never
   * actually recorded on the lead. Every other screen reads the recorded flag, so the
   * rep's login went on listing them as leads and the two disagreed.
   *
   * One rule now, shared with the rep portal: the Super Admin's conversion is what
   * makes a customer. A lead already in the Customer Master but never converted is
   * called out below rather than quietly counted as done.
   */
  const isCustomer = (l) => isCustomerLead(l, customers);
  /** Marked converted, or already bought from — but the conversion was never recorded. */
  const needsConversion = (l) => conversionPending(l) || (!isCustomer(l) && inMaster(l.client_name));
  /**
   * 30.09 §SL5: the queue the S Dashboard shows too — the leads marked Converted (by a
   * rep's request or a Status set to Converted) that nobody has converted yet. One
   * helper feeds both screens, so they can never list different leads.
   */
  const pendingConversion = useMemo(() => conversionQueue(leads), [leads]);
  const ownerNames = (l) => leadOwnerIds(l).map((id) => repName(sales.sales_users, id)).filter((x) => x && x !== '—');
  const markedBy = (l) => {
    if (l.conversion_requested && l.conversion_requested_by) return repName(sales.sales_users, l.conversion_requested_by);
    if (l.stage_updated_by === 'super_admin') return 'Super Admin (Status)';
    if (l.stage_updated_by) return repName(sales.sales_users, l.stage_updated_by);
    return ownerNames(l).join(', ') || '—';
  };

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (!showConverted && isCustomer(l)) return false;
      if (!t) return true;
      return [l.client_name, l.group, l.city, l.stage].some((v) => String(v || '').toLowerCase().includes(t));
    });
  }, [leads, q, showConverted, customers]);

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function startEdit(l) {
    const f = blank();
    COLS.forEach(([k]) => { f[k] = l[k] == null ? '' : String(l[k]); });
    setForm(f);
    setEditId(l.id);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* jsdom */ }
  }
  function cancelEdit() { setForm(blank()); setEditId(''); }

  /**
   * Rewrite only the lead rows; everything else in the sales blob is untouched. The
   * rows are rebuilt over the server's copy, so a save that crosses a rep's never
   * puts back a lead list from before it.
   */
  const patchLeads = (fn) => save('sales', (prev) => ({ ...(prev || {}), leads: fn((prev && prev.leads) || []) }), { retry: true });

  /** Conversion — the same helpers the S Dashboard uses: master rows for new names, then the flag. */
  async function convertMany(ids) {
    if (customerRowsToAdd(leads, ids, customers).length) {
      await save('customers', (prev) => [...(prev || []), ...customerRowsToAdd(leads, ids, prev || [])], { retry: true });
    }
    await patchLeads((list) => convertLeads(list, ids, { by: 'super_admin' }));
  }

  async function submit() {
    if (!norm(form.client_name)) return flash('r', 'The lead needs a name.');
    const was = editId ? leads.find((l) => l.id === editId) || null : null;
    // 30.09 §SL6: the Super Admin's own Status "Converted" IS the conversion
    const converting = !!was && isConvertedStage(form.stage) && !isConvertedStage(was.stage) && !isCustomer(was)
      && window.confirm(`Convert "${norm(form.client_name)}" into a customer?\n\nStatus Converted converts the lead: it joins the Customer Master if it is not there yet, and moves to the customer side in the sales rep’s login.`);
    setBusy(true);
    try {
      if (editId) {
        await patchLeads((list) => list.map((l) => (l.id === editId ? { ...l, ...form } : l)));
        if (converting) await convertMany([editId]);
      } else {
        const id = 'lead_' + Date.now().toString(36);
        const row = { ...form, id, created_at: new Date().toISOString(), source: 'super_admin' };
        await patchLeads((list) => [...list, row]);
      }
      flash('g', editId ? `Lead "${form.client_name}" updated${converting ? ' and converted to a customer' : ''}.` : `Lead "${form.client_name}" added.`);
      cancelEdit();
    } catch (e) { flash('r', saveErrorText(e)); } finally { setBusy(false); }
  }

  async function remove(l) {
    if (!window.confirm(`Delete the lead "${l.client_name}"?\n\nThis removes it from the sales tracker. Any Customer Master entry of the same name is NOT touched.`)) return;
    setBusy(true);
    try { await patchLeads((list) => list.filter((x) => x.id !== l.id)); flash('g', 'Lead deleted.'); if (editId === l.id) cancelEdit(); }
    catch (e) { flash('r', saveErrorText(e, 'Delete')); } finally { setBusy(false); }
  }

  /** Convert every lead in the queue — marked Converted by a rep or on the Status, never converted. */
  async function convertPending() {
    const list = pendingConversion;
    if (!list.length) return;
    if (!window.confirm(`Convert ${list.length} lead(s) marked Converted into customers?\n\n`
      + 'Each one joins the Customer Master if it is not there yet, and moves to the customer side in every sales rep’s login.')) return;
    setBusy(true);
    try {
      const added = customerRowsToAdd(leads, list.map((l) => l.id), customers).length;
      await convertMany(list.map((l) => l.id));
      flash('g', `${list.length} lead(s) converted${added ? `, ${added} added to the Customer Master` : ''}.`);
    } catch (e) { flash('r', saveErrorText(e, 'Convert')); } finally { setBusy(false); }
  }

  /** Promote: the name joins the Customer Master, so sale orders can use it. */
  async function toCustomer(l) {
    const name = norm(l.client_name);
    if (!name) return;
    if (!window.confirm(`Convert the lead "${name}" into a customer?\n\nIt joins the Customer Master and becomes available for sale orders.`)) return;
    setBusy(true);
    try {
      await convertMany([l.id]);
      flash('g', `"${name}" is now a customer.`);
    } catch (e) { flash('r', saveErrorText(e, 'Convert')); } finally { setBusy(false); }
  }

  /** Demote: it leaves the Customer Master and goes back to being just a lead. */
  async function toLead(l) {
    const name = norm(l.client_name);
    const rows = customers.filter((c) => sameCustomerName(c.customer, name)).length;
    if (!window.confirm(`Move "${name}" back to a lead?\n\n${rows ? `Its ${rows} Customer Master row(s) are removed, so it leaves sale-order creation.` : 'It is not in the Customer Master; only the converted mark is cleared.'}`)) return;
    setBusy(true);
    try {
      if (rows) await save('customers', (prev) => (prev || []).filter((c) => !sameCustomerName(c.customer, name)), { retry: true });
      // 30.09: the stage leaves "Converted" too, so the lead does not drop straight back into the queue
      await patchLeads((list) => revertLead(list, l.id, { by: 'super_admin' }));
      flash('g', `"${name}" is a lead again.`);
    } catch (e) { flash('r', saveErrorText(e, 'Revert')); } finally { setBusy(false); }
  }

  function exportExcel() {
    const header = COLS.map(([, label]) => label.replace(' *', '')).concat('Is Customer');
    const body = visible.map((l) => COLS.map(([k]) => l[k] ?? '').concat(isCustomer(l) ? 'Yes' : 'No'));
    exportAOA([header, ...body], 'Leads_' + today().replace(/-/g, '_'), 'Leads');
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">{editId ? '✏ Edit Lead — ' + norm(form.client_name) : '＋ Add Lead'}</div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <ConversionQueue queue={pendingConversion} busy={busy} markedBy={markedBy} owners={ownerNames}
          onConvert={toCustomer} onConvertAll={convertPending} />
        <datalist id="lead-groups-dl">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        <div className="g4">
          {COLS.map(([k, label]) => (
            <div className="fg" key={k}>
              <label>{label}</label>
              <input value={form[k] ?? ''} list={k === 'group' ? 'lead-groups-dl' : undefined}
                aria-label={'Lead form ' + label.replace(' *', '')} onChange={setField(k)} />
            </div>
          ))}
        </div>
        <div className="act">
          <button className="btn btn-g" onClick={submit} disabled={busy || saving}>
            {busy ? 'Saving…' : (editId ? '💾 Update Lead' : '＋ Add Lead')}
          </button>
          {editId && <button className="btn btn-s" onClick={cancelEdit} disabled={busy}>Cancel</button>}
        </div>
      </div>

      <div className="card">
        <div className="fbar" style={{ flexWrap: 'wrap' }}>
          <div className="ctitle" style={{ margin: 0 }}>Leads <span className="tag tgr">{visible.length}</span></div>
          <input placeholder="Search lead / group / city…" value={q} onChange={(e) => setQ(e.target.value)}
            aria-label="Search leads" style={{ width: 240 }} />
          <label className="cb" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={showConverted} onChange={(e) => setShowConverted(e.target.checked)}
              aria-label="Show leads already converted" />
            <span>include converted</span>
          </label>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={exportExcel} disabled={!visible.length}>⬇ Export</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--i3)', marginTop: 0 }}>
          Everything a sales rep enters is a lead. Only a lead promoted here (or on the S Dashboard) reaches the Customer
          Master, and only the Customer Master feeds sale-order creation. Pick a row with its radio to edit it above.
        </p>
        <div className="tw sy" style={{ maxHeight: 'calc(100vh - 420px)' }}>
          <table>
            <thead><tr>
              <th style={{ width: 42 }}>Edit</th>
              {COLS.map(([k, label, w]) => <th key={k} style={{ minWidth: w }}>{label.replace(' *', '')}</th>)}
              <th style={{ width: 150 }}>Customer?</th><th style={{ width: 40 }}></th>
            </tr></thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={COLS.length + 3} style={{ textAlign: 'center', padding: 22, color: 'var(--i3)' }}>
                  {leads.length ? 'No leads match' : 'No leads yet — sales reps create them from their portal'}
                </td></tr>
              ) : visible.map((l) => (
                <tr key={l.id} style={editId === l.id ? { background: 'var(--gl)' } : undefined}>
                  <td className="rowsel" style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    <input type="radio" name="lead-edit-sel" checked={editId === l.id} onChange={() => startEdit(l)}
                      style={{ margin: 0, verticalAlign: 'middle' }} aria-label={'Edit lead ' + norm(l.client_name)} />
                  </td>
                  {COLS.map(([k]) => <td key={k} style={{ fontSize: 11 }}>{l[k] || '-'}</td>)}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {isCustomer(l) ? (
                      <>
                        <span className="tag tg" style={{ fontSize: 9 }}>✓ Customer</span>{' '}
                        <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }} disabled={busy}
                          aria-label={`Revert ${norm(l.client_name)} to lead`} onClick={() => toLead(l)}>↩ Lead</button>
                      </>
                    ) : needsConversion(l) ? (
                      <>
                        {conversionPending(l)
                          ? <span className="tag ty" style={{ fontSize: 9 }} title="Marked Converted — waiting for you to convert it">⏳ Requested by {markedBy(l)}</span>
                          : <span className="tag ty" style={{ fontSize: 9 }} title="Already in the Customer Master, but not converted here yet">⚠ Not converted</span>}{' '}
                        <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 7px' }} disabled={busy}
                          aria-label={`Convert ${norm(l.client_name)} to customer`} onClick={() => toCustomer(l)}>→ Customer</button>
                      </>
                    ) : (
                      <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 7px' }} disabled={busy}
                        aria-label={`Convert ${norm(l.client_name)} to customer`} onClick={() => toCustomer(l)}>→ Customer</button>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px', color: 'var(--red)', borderColor: '#F5A8A0' }}
                      aria-label={'Delete lead ' + norm(l.client_name)} onClick={() => remove(l)} title="Delete lead">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
