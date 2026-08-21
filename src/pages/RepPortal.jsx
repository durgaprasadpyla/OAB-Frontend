import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { fmtDate } from '../lib/format.js';
import { custGroups } from '../lib/master.js';
import { ddList, ddPairs } from '../lib/dropdowns.js';
import NegoPanel from '../components/NegoPanel.jsx';
import RepVisitTab from '../components/RepVisitTab.jsx';
import RepPoTab from '../components/RepPoTab.jsx';
import RepTargetsTab from '../components/RepTargetsTab.jsx';
import RepSkusTab from '../components/RepSkusTab.jsx';
import { quotesToSend } from '../lib/repPortal.js';
import {
  STAGE_STYLE, PAY_STYLE, FOLLOW_UP_STYLE,
  leadsForRep, repCategoriesOf, leadCategories, contactsForLead, interactionsForLead,
  nextFollowUp, followUpState, buildLead, buildInteraction, salesUid, salesToday,
  quotesForLead, acceptedMinPrice,
} from '../lib/sales.js';

// Sales Rep Portal — the field rep's own workspace over module 12.
// A rep sees only the CATEGORIES allocated to them, which is why every list here
// runs through leadsForRep/repCategoriesOf rather than a plain customer filter.

// Tab order is production's REP_TABS. Negotiations is an addition this app has and
// production does not — it sits at the end so the shared tabs stay where reps expect.
const TABS = [
  { k: 'followups', label: '🗓 Follow-ups' },
  { k: 'visit', label: '📋 Log Visit' },
  { k: 'po', label: '🧾 Enter PO' },
  { k: 'targets', label: '🎯 My Targets' },
  { k: 'customers', label: '📈 My Customers' },
  { k: 'contacts', label: '📇 My Contacts' },
  { k: 'add', label: '➕ Add Customer' },
  { k: 'sku', label: '📦 SKUs' },
  { k: 'nego', label: '💬 Negotiations' },
];

const pill = (style) => ({ ...style, padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700, display: 'inline-block' });

export default function RepPortal() {
  const { mods, save } = useData();
  const { repId, repName } = useAuth();
  const [tab, setTab] = useState('followups');
  const sales = mods.sales || {};

  const myLeads = useMemo(() => leadsForRep(sales.leads, repId), [sales.leads, repId]);
  // Negotiation threads are scoped to SKUs of the rep's own customers.
  const mySkuIds = useMemo(() => {
    const ids = new Set(myLeads.map((l) => l.id));
    return (sales.skus || []).filter((s) => ids.has(s.lead_id)).map((s) => s.id);
  }, [myLeads, sales.skus]);

  return (
    <div id="app">
      <div className="pg-ttl">Sales Rep Portal</div>
      <div className="pg-sub">
        Signed in as <strong>{repName || 'rep'}</strong> — {myLeads.length} customer{myLeads.length === 1 ? '' : 's'} allocated to you.
        You see only the product categories assigned to you.
      </div>
      <div className="step-bar" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
        ))}
      </div>
      <QuotesToSendBanner sales={sales} repId={repId} onGoToSkus={() => setTab('sku')} />
      {tab === 'followups' && <FollowUps leads={myLeads} sales={sales} save={save} repId={repId} />}
      {tab === 'visit' && <RepVisitTab leads={myLeads} sales={sales} save={save} repId={repId} />}
      {tab === 'po' && <RepPoTab leads={myLeads} sales={sales} save={save} repId={repId} />}
      {tab === 'targets' && <RepTargetsTab sales={sales} repId={repId} />}
      {tab === 'customers' && <MyCustomers leads={myLeads} sales={sales} save={save} repId={repId} />}
      {tab === 'contacts' && <MyContacts leads={myLeads} sales={sales} save={save} repId={repId} />}
      {tab === 'add' && <AddCustomer sales={sales} save={save} repId={repId} onDone={() => setTab('customers')} />}
      {tab === 'sku' && <RepSkusTab leads={myLeads} sales={sales} save={save} repId={repId} />}
      {tab === 'nego' && <NegoPanel side="rep" skuIds={mySkuIds} />}
    </div>
  );
}

/**
 * Quotations the desk has sent back but the rep has not yet forwarded to the
 * customer. Shown above every tab so it cannot be missed. (repQuoteReceivedBanner)
 */
function QuotesToSendBanner({ sales, repId, onGoToSkus }) {
  const list = quotesToSend(sales, repId);
  if (!list.length) return null;
  const leadName = (id) => ((sales.leads || []).find((l) => l.id === id) || {}).client_name || '—';
  return (
    <div className="al al-b" style={{ display: 'block' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ fontWeight: 800 }}>
          🔔 {list.length} quotation{list.length === 1 ? '' : 's'} received from the Quote desk — to send to customer
        </div>
        <button className="btn btn-s" style={{ height: 28, fontSize: 11 }} onClick={onGoToSkus}>Go to SKUs →</button>
      </div>
      {list.map((sku) => (
        <div key={sku.id} style={{ padding: '4px 0' }}>
          📄 <b>{sku.sku_name}</b> <span style={{ color: 'var(--i2)' }}>({leadName(sku.lead_id)})</span> — ready to send to customer.
        </div>
      ))}
      <div style={{ fontSize: 10, color: '#6b86b8', marginTop: 4 }}>
        Mark a SKU as “Quotation sent” in the SKUs tab once you’ve sent it — this count drops by one each time.
      </div>
    </div>
  );
}

/** Patch the sales blob, preserving every key this screen didn't touch. */
async function patchSales(save, patch) {
  return save('sales', (prev) => ({ ...(prev || {}), ...patch }));
}

/* ─────────────────────────── Follow-ups ─────────────────────────── */
function FollowUps({ leads, sales, save, repId }) {
  const [msg, setMsg] = useState(null);
  const today = salesToday();

  const rows = useMemo(() => leads
    .map((l) => ({ lead: l, due: nextFollowUp(l, sales.interactions) }))
    .filter((r) => r.due)
    .sort((a, b) => String(a.due).localeCompare(String(b.due))), [leads, sales.interactions]);

  const overdue = rows.filter((r) => r.due < today);
  const dueToday = rows.filter((r) => r.due === today);

  return (
    <>
      <div className="stats">
        <div className="kpi"><div className="kpi-l">Overdue</div><div className="kpi-v" style={{ color: overdue.length ? 'var(--red)' : undefined }}>{overdue.length}</div></div>
        <div className="kpi"><div className="kpi-l">Due today</div><div className="kpi-v" style={{ color: dueToday.length ? '#8a6d00' : undefined }}>{dueToday.length}</div></div>
        <div className="kpi"><div className="kpi-l">Scheduled</div><div className="kpi-v">{rows.length}</div></div>
      </div>

      <div className="card">
        <div className="ctitle">Follow-ups</div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="tw sy" style={{ maxHeight: 'calc(100vh - 340px)' }}>
          <table>
            <thead><tr><th style={{ minWidth: 180 }}>Customer</th><th>My categories</th><th>Stage</th><th style={{ width: 150 }}>Due</th><th style={{ width: 200 }}>Log a touch-point</th></tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>Nothing scheduled. Add a follow-up from My Customers.</td></tr>
              ) : rows.map(({ lead, due }) => {
                const st = followUpState(due, today);
                return (
                  <tr key={lead.id}>
                    <td style={{ fontWeight: 600 }}>{lead.client_name}</td>
                    <td style={{ fontSize: 11 }}>{repCategoriesOf(lead, repId).join(', ') || '—'}</td>
                    <td><span style={pill(STAGE_STYLE[lead.stage] || {})}>{lead.stage || '—'}</span></td>
                    <td><span style={pill(FOLLOW_UP_STYLE[st.kind])}>{st.kind === 'later' ? fmtDate(st.label) : st.label}</span></td>
                    <td>
                      <LogTouch lead={lead} sales={sales} save={save} repId={repId} onMsg={setMsg} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** Inline "I called them" form: records an interaction and re-schedules. */
function LogTouch({ lead, sales, save, repId, onMsg }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const inter = buildInteraction(lead.id, repId, { type: 'Call', outcome, followUp: next });
      await patchSales(save, {
        interactions: [...(sales.interactions || []), inter],
        // Keep the lead's own field in step so a rep who never logs interactions
        // still sees a sensible due date.
        leads: (sales.leads || []).map((l) => (l.id === lead.id ? { ...l, next_follow_up_date: next } : l)),
      });
      setOpen(false); setOutcome(''); setNext('');
      onMsg({ t: 'g', text: `✅ Logged against ${lead.client_name}.` });
    } catch (e) {
      onMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) });
    } finally { setBusy(false); }
  }

  if (!open) return <button className="btn btn-s" onClick={() => setOpen(true)} aria-label={`Log touch-point for ${lead.client_name}`}>Log</button>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input placeholder="Outcome" value={outcome} aria-label={`Outcome for ${lead.client_name}`} onChange={(e) => setOutcome(e.target.value)} />
      <input type="date" value={next} aria-label={`Next follow-up for ${lead.client_name}`} onChange={(e) => setNext(e.target.value)} />
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="btn btn-g" style={{ height: 24, fontSize: 11 }} disabled={busy} onClick={submit}>Save</button>
        <button className="btn btn-s" style={{ height: 24, fontSize: 11 }} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/* ─────────────────────────── My Customers ─────────────────────────── */
function MyCustomers({ leads, sales, save, repId }) {
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (stage && l.stage !== stage) return false;
      if (!t) return true;
      return [l.client_name, l.group, l.city].some((v) => String(v || '').toLowerCase().includes(t));
    });
  }, [leads, q, stage]);

  async function setStageOf(lead, next) {
    if (!next || next === lead.stage) return;
    setBusy(true);
    try {
      await patchSales(save, { leads: (sales.leads || []).map((l) => (l.id === lead.id ? { ...l, stage: next } : l)) });
      setMsg({ t: 'g', text: `✅ ${lead.client_name} → ${next}.` });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>My Customers <span className="tag tgr">{rows.length}</span></div>
        <input placeholder="Search customer / group / city…" value={q} aria-label="Search customers" onChange={(e) => setQ(e.target.value)} />
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filter by stage">
          <option value="">All stages</option>
          {ddList(sales, 'statuses').map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead><tr>
            <th style={{ minWidth: 180 }}>Customer</th><th>Group</th><th>My categories</th>
            <th style={{ width: 60, textAlign: 'center' }}>Pay</th><th style={{ width: 150 }}>Stage</th><th style={{ width: 120 }}>Next ping</th><th style={{ width: 70 }}></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No customers allocated to you yet.</td></tr>
            ) : rows.map((l) => {
              const due = nextFollowUp(l, sales.interactions);
              const st = followUpState(due);
              const open = openId === l.id;
              return (
                <FragmentRow key={l.id} open={open}>
                  <tr>
                    <td style={{ fontWeight: 600 }}>{l.client_name}</td>
                    <td style={{ fontSize: 11 }}>{l.group || '—'}</td>
                    <td style={{ fontSize: 11 }}>{repCategoriesOf(l, repId).join(', ') || '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      {l.payment_type ? <span style={{ ...pill(PAY_STYLE[l.payment_type] || {}), borderRadius: '50%', padding: '2px 7px', fontSize: 10 }}>{l.payment_type}</span> : '—'}
                    </td>
                    <td>
                      <select value={l.stage || ''} disabled={busy} aria-label={`Stage for ${l.client_name}`} onChange={(e) => setStageOf(l, e.target.value)}>
                        {ddList(sales, 'statuses').map((st) => <option key={st} value={st}>{st}</option>)}
                      </select>
                    </td>
                    <td><span style={pill(FOLLOW_UP_STYLE[st.kind])}>{st.kind === 'later' ? fmtDate(st.label) : st.label}</span></td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-s" aria-label={`${open ? 'Hide' : 'View'} ${l.client_name}`} onClick={() => setOpenId(open ? null : l.id)}>{open ? 'Hide' : 'View'}</button>
                    </td>
                  </tr>
                  {open && (
                    <tr><td colSpan={7} style={{ background: 'var(--bg)', padding: 14 }}>
                      <LeadDetail lead={l} sales={sales} repId={repId} />
                    </td></tr>
                  )}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({ children }) { return <>{children}</>; }

/** Read-only drill-down: contacts, history and quotes for one customer. */
function LeadDetail({ lead, sales, repId }) {
  const contacts = contactsForLead(sales.contacts, lead.id);
  const history = interactionsForLead(sales.interactions, lead.id);
  const quotes = quotesForLead(sales.quotations, lead.id);
  return (
    <div className="g2" style={{ alignItems: 'start' }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Details</div>
        <div style={{ fontSize: 11, lineHeight: 1.8 }}>
          <div>Head office: {lead.head_office || '—'}</div>
          <div>Delivery: {lead.delivery_location || '—'}</div>
          <div>GSTIN: {lead.gstin || '—'}</div>
          <div>All categories: {leadCategories(lead).join(', ') || '—'}</div>
          <div>Mine: <strong>{repCategoriesOf(lead, repId).join(', ') || '—'}</strong></div>
        </div>

        <div style={{ fontWeight: 700, fontSize: 12, margin: '12px 0 6px' }}>Contacts ({contacts.length})</div>
        {contacts.length === 0 ? <div style={{ fontSize: 11, color: 'var(--i3)' }}>None yet.</div> : (
          <table style={{ width: '100%' }}>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}><td style={{ fontSize: 11 }}>{c.name}</td><td style={{ fontSize: 11 }}>{c.designation || ''}</td><td style={{ fontSize: 11 }}>{c.phone || ''}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>History ({history.length})</div>
        {history.length === 0 ? <div style={{ fontSize: 11, color: 'var(--i3)' }}>No interactions logged.</div> : (
          <table style={{ width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left', fontSize: 10 }}>Date</th><th style={{ textAlign: 'left', fontSize: 10 }}>Type</th><th style={{ textAlign: 'left', fontSize: 10 }}>Outcome</th></tr></thead>
            <tbody>
              {history.slice(0, 12).map((h) => (
                <tr key={h.id}><td style={{ fontSize: 11 }}>{fmtDate(h.date)}</td><td style={{ fontSize: 11 }}>{h.type}</td><td style={{ fontSize: 11 }}>{h.outcome || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ fontWeight: 700, fontSize: 12, margin: '12px 0 6px' }}>Quotes ({quotes.length})</div>
        {quotes.length === 0 ? <div style={{ fontSize: 11, color: 'var(--i3)' }}>None raised.</div> : (
          <table style={{ width: '100%' }}>
            <tbody>
              {quotes.slice(0, 8).map((q) => (
                <tr key={q.id}>
                  <td style={{ fontSize: 11 }}>{q.sku || '—'}</td>
                  <td style={{ fontSize: 11, textAlign: 'right' }}>₹{Number(q.rate || 0).toFixed(2)}</td>
                  <td style={{ fontSize: 11 }}>{q.status || 'Draft'}</td>
                  <td style={{ fontSize: 10, color: 'var(--i3)' }}>
                    {acceptedMinPrice(sales.quotations, lead.id, q.sku) != null
                      ? `floor ₹${acceptedMinPrice(sales.quotations, lead.id, q.sku).toFixed(2)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── My Contacts ─────────────────────────── */
function MyContacts({ leads, sales, save, repId }) {
  const [draft, setDraft] = useState({ lead_id: '', name: '', designation: '', phone: '', email: '', categories: [] });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const myLeadIds = useMemo(() => new Set(leads.map((l) => l.id)), [leads]);
  const rows = useMemo(
    () => (sales.contacts || []).filter((c) => myLeadIds.has(c.lead_id)),
    [sales.contacts, myLeadIds],
  );
  const leadName = (id) => (leads.find((l) => l.id === id) || {}).client_name || id;

  async function add() {
    if (!draft.lead_id || !draft.name.trim()) { setMsg({ t: 'r', text: 'Pick a customer and enter a name.' }); return; }
    setBusy(true);
    try {
      const contact = { id: salesUid('contact'), ...draft, name: draft.name.trim(), created_by: repId };
      await patchSales(save, { contacts: [...(sales.contacts || []), contact] });
      setDraft({ lead_id: '', name: '', designation: '', phone: '', email: '', categories: [] });
      setMsg({ t: 'g', text: '✅ Contact added.' });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  }

  async function remove(c) {
    if (!window.confirm(`Remove ${c.name}?`)) return;
    try { await patchSales(save, { contacts: (sales.contacts || []).filter((x) => x.id !== c.id) }); }
    catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
  }

  return (
    <div className="card">
      <div className="ctitle">My Contacts <span className="tag tgr">{rows.length}</span></div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="tw sy" style={{ maxHeight: 340 }}>
        <table>
          <thead><tr><th>Customer</th><th>Name</th><th>Designation</th><th>Phone</th><th>Email</th><th style={{ width: 50 }}></th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No contacts yet.</td></tr>
              : rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{leadName(c.lead_id)}</td>
                  <td>{c.name}</td><td style={{ fontSize: 11 }}>{c.designation || '—'}</td>
                  <td style={{ fontSize: 11 }}>{c.phone || '—'}</td><td style={{ fontSize: 11 }}>{c.email || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-s" style={{ color: 'var(--red)' }} aria-label={`Remove ${c.name}`} onClick={() => remove(c)}>✕</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="ctitle" style={{ marginTop: 14 }}>Add a contact</div>
      <div className="g4" style={{ alignItems: 'end' }}>
        <div className="fg">
          <label>Customer *</label>
          <select value={draft.lead_id} aria-label="Contact customer" onChange={(e) => setDraft({ ...draft, lead_id: e.target.value })}>
            <option value="">— Select —</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.client_name}</option>)}
          </select>
        </div>
        <div className="fg"><label>Name *</label><input value={draft.name} aria-label="Contact name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
        <div className="fg"><label>Designation</label><input value={draft.designation} aria-label="Contact designation" onChange={(e) => setDraft({ ...draft, designation: e.target.value })} /></div>
        <div className="fg"><label>Phone</label><input value={draft.phone} aria-label="Contact phone" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></div>
      </div>
      <div className="fbar">
        <span style={{ flex: 1 }} />
        <button className="btn btn-g" onClick={add} disabled={busy}>＋ Add contact</button>
      </div>
    </div>
  );
}

/* ─────────────────────────── Add Customer ─────────────────────────── */
function AddCustomer({ sales, save, repId, onDone }) {
  const [form, setForm] = useState({
    group: '', customer: '', paymentType: '', headOffice: '', deliveryLocation: '',
    gstin: '', categories: [], stage: 'To Approach', followUp: '', remarks: '',
  });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const { mods } = useData();

  // Groups already known, from the Customer Master and from existing leads.
  const groups = useMemo(() => {
    const set = new Set(custGroups(mods.customers));
    (sales.leads || []).forEach((l) => { const g = String(l.group || '').trim(); if (g) set.add(g); });
    return [...set].sort();
  }, [mods.customers, sales.leads]);

  const toggleCat = (c) => setForm((f) => ({
    ...f,
    categories: f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c],
  }));

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const lead = buildLead(form, repId);
      const patch = { leads: [...(sales.leads || []), lead] };
      if (form.followUp) {
        patch.interactions = [...(sales.interactions || []),
          buildInteraction(lead.id, repId, { type: 'Follow-up scheduled', outcome: form.remarks, followUp: form.followUp })];
      }
      await patchSales(save, patch);
      setMsg({ t: 'g', text: '✅ Customer saved. Add contacts from My Contacts.' });
      setForm({ group: '', customer: '', paymentType: '', headOffice: '', deliveryLocation: '', gstin: '', categories: [], stage: 'To Approach', followUp: '', remarks: '' });
      setTimeout(onDone, 700);
    } catch (e) {
      setMsg({ t: 'r', text: e.message || String(e) });
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="ctitle">➕ Add Customer</div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        New customers are allocated to you for the categories you tick. Add contacts afterwards from My Contacts.
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="g3">
        <div className="fg">
          <label>Group</label>
          <input list="rep-groups" value={form.group} aria-label="Group" onChange={(e) => setForm({ ...form, group: e.target.value })} placeholder="Existing or new group" />
          <datalist id="rep-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </div>
        <div className="fg"><label>Customer *</label><input value={form.customer} aria-label="Customer" onChange={(e) => setForm({ ...form, customer: e.target.value })} /></div>
        <div className="fg">
          <label>Payment Type</label>
          <select value={form.paymentType} aria-label="Payment Type" onChange={(e) => setForm({ ...form, paymentType: e.target.value })}>
            <option value="">— Select —</option>
            {ddPairs(sales).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="fg"><label>Head Office</label><input value={form.headOffice} aria-label="Head Office" onChange={(e) => setForm({ ...form, headOffice: e.target.value })} /></div>
        <div className="fg"><label>Delivery Location</label><input value={form.deliveryLocation} aria-label="Delivery Location" onChange={(e) => setForm({ ...form, deliveryLocation: e.target.value })} /></div>
        <div className="fg"><label>GST Number</label><input value={form.gstin} aria-label="GST Number" onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
      </div>

      <div className="fg">
        <label>Categories (one or more) *</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ddList(sales, 'categories').map((c) => (
            <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 400 }}>
              <input type="checkbox" checked={form.categories.includes(c)} aria-label={c} onChange={() => toggleCat(c)} />{c}
            </label>
          ))}
        </div>
      </div>

      <div className="g3">
        <div className="fg">
          <label>Initial Status</label>
          <select value={form.stage} aria-label="Initial Status" onChange={(e) => setForm({ ...form, stage: e.target.value })}>
            {ddList(sales, 'statuses').map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
        </div>
        <div className="fg"><label>Next Ping Date</label><input type="date" value={form.followUp} aria-label="Next Ping Date" onChange={(e) => setForm({ ...form, followUp: e.target.value })} /></div>
        <div className="fg"><label>Remarks</label><input value={form.remarks} aria-label="Remarks" onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
      </div>

      <div className="fbar">
        <span style={{ flex: 1 }} />
        <button className="btn btn-g" onClick={submit} disabled={busy}>{busy ? 'Saving…' : '✓ Save Customer'}</button>
      </div>
    </div>
  );
}
