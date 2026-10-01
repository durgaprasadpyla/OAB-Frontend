import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { useFreshModule } from '../lib/useFreshModule.js';
import { fmtDate } from '../lib/format.js';
import { custGroupOf } from '../lib/master.js';
import { ddList, ddPairs } from '../lib/dropdowns.js';
import { RepQuotationsTab, RepSendQuoteTab, RepAcceptedTab } from '../components/RepQuotesTab.jsx';
import LeadCustomerPicker from '../components/LeadCustomerPicker.jsx';
import {
  repBook, setLeadCategories, isConvertedStage, conversionPending, requestConversion, masterRowsFor, saveErrorText,
} from '../lib/repFlow.js';
import RepVisitTab from '../components/RepVisitTab.jsx';
import RepPoTab from '../components/RepPoTab.jsx';
import RepTargetsTab from '../components/RepTargetsTab.jsx';
import RepSkusTab from '../components/RepSkusTab.jsx';
import { quotesToSend, quoteFollowUps } from '../lib/repPortal.js';
import { kamCustomerStats, kamPrimaryContact } from '../lib/kam.js';
import { QuotationDoc } from './QuotationDesk.jsx';
import { elementToPDF, printElement } from '../lib/pdf.js';
import {
  STAGE_STYLE, PAY_STYLE, FOLLOW_UP_STYLE,
  leadsForRep, repCategoriesOf, leadCategories, contactsForLead, interactionsForLead,
  nextFollowUp, followUpState, buildLead, buildInteraction, salesUid, salesToday,
  quotesForLead, acceptedMinPrice, REP_PAYTYPES, repModulesOf,
} from '../lib/sales.js';

// Contact rank options (repRanks). '' is "no rank".
const REP_RANKS = [['1', 'Primary'], ['2', 'Secondary'], ['3', 'Tertiary'], ['', '—']];
const REP_CUSTOMER_TYPES = ['Manufacturer', 'Trader', 'Distributor', 'Exporter', 'Others'];

/* ── contact helpers (repContactCats / repCustOfContact / repGroupOfContact / repPayOfContact) ── */
const contactCats = (c) => (c && c.categories && c.categories.length ? c.categories : (c && c.category ? [c.category] : []));
function custOfContact(c, leads) {
  if (!c) return '';
  if (c.customer) return c.customer;
  const l = (leads || []).find((x) => x.id === c.lead_id);
  return l ? l.client_name : '';
}
function groupOfContact(c, leads, customers) {
  if (!c) return '';
  const cust = custOfContact(c, leads);
  if (c.group && c.group !== cust) return c.group;
  if (cust) { const g = custGroupOf(cust, customers); return (g && g !== cust) ? g : ''; }
  return '';
}
function payOfContact(c, leads) {
  const cust = custOfContact(c, leads);
  if (!cust) return '';
  const l = (leads || []).find((x) => String(x.client_name || '').trim().toLowerCase() === cust.toLowerCase());
  return l ? l.payment_type : '';
}
const payLabel = (k) => {
  if (!k) return '—';
  const f = (REP_PAYTYPES || []).find((p) => p[0] === k);
  return f ? f[0] : k;
};
// Sales Rep Portal — the field rep's own workspace over module 12.
// A rep sees only the CATEGORIES allocated to them, which is why every list here
// runs through leadsForRep/repCategoriesOf rather than a plain customer filter.

// Tab order is production's REP_TABS. Negotiations is an addition this app has and
// production does not — it sits at the end so the shared tabs stay where reps expect.
// Sales Login (2026-09-15): Negotiations became Quotations, with Send Quote and Quote
// Accepted beside it — the rep's quotation flow in three steps.
const TABS = [
  { k: 'followups', label: '🗓 Follow-ups' },
  { k: 'visit', label: '📋 Log Visit' },
  { k: 'po', label: '🧾 Enter PO' },
  { k: 'targets', label: '🎯 My Targets' },
  // 28.09 §Sales ¶15-¶16: "Add Lead and My Leads can be merged into one tab … where
  // the list will be below the Add New Lead. Editing a lead also can happen by
  // selecting the radio button prior to the lead name." And: "In the place of My Leads
  // we can have My Customers, where all of that particular sales rep's leads that are
  // converted as customers can be listed."
  { k: 'customers', label: '📈 My Leads' },
  { k: 'mycust', label: '🏆 My Customers' },
  { k: 'contacts', label: '📇 My Contacts' },
  { k: 'sku', label: '📦 SKUs' },
  { k: 'quotes', label: '💬 Quotations' },
  { k: 'send', label: '📤 Send Quote' },
  { k: 'accepted', label: '✅ Quote Accepted' },
];

const pill = (style) => ({ ...style, padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700, display: 'inline-block' });

export default function RepPortal() {
  const { mods } = useData();
  const { repId, repName } = useAuth();
  const [tab, setTab] = useState('followups');
  const sales = mods.sales || {};

  // 30.09 §SL6: "I have marked these customers as customers from lead, whereas in the
  // sales rep login they are still under leads." The sales blob was read once at
  // sign-in, so a conversion the Super Admin made while the rep was logged in never
  // reached them until they signed in again. It is re-read on every tab change and
  // whenever the window comes back into focus — and every save on this portal goes
  // through the same hook, so a read can never put back the blob from before one.
  // The Customer Master is re-read alongside: a conversion adds its rows, and the
  // Super Admin's despatch locations live there (Enter PO, SKU despatch details).
  const { refresh, save } = useFreshModule('sales', tab);
  const { refresh: refreshCustomers } = useFreshModule('customers', tab);
  useEffect(() => {
    const onFocus = () => { refresh(); refreshCustomers(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh, refreshCustomers]);

  // The rep's book: the leads allocated to them or added by them, plus any customer
  // the Super Admin made them KAM of (repBook splits it into leads and customers).
  const book = useMemo(() => repBook(sales, mods.customers || [], repId), [sales, mods.customers, repId]);
  const myLeads = useMemo(() => [...book.leads, ...book.customers], [book]);

  // §36 module-wise allocation: only the modules granted to this rep are shown.
  // No stored allocation = every module (repModulesOf).
  const myRep = useMemo(() => (sales.sales_users || []).find((r) => r.id === repId), [sales.sales_users, repId]);
  const myModules = useMemo(() => new Set(repModulesOf(myRep)), [myRep]);
  const visibleTabs = useMemo(() => TABS.filter((t) => myModules.has(t.k)), [myModules]);
  useEffect(() => {
    if (!myModules.has(tab) && visibleTabs.length) setTab(visibleTabs[0].k);
  }, [myModules, tab, visibleTabs]);

  return (
    <div id="app">
      <div className="pg-ttl">Sales Rep Portal</div>
      <div className="pg-sub">
        Signed in as <strong>{repName || 'rep'}</strong> — {book.leads.length} lead{book.leads.length === 1 ? '' : 's'} and {book.customers.length} customer{book.customers.length === 1 ? '' : 's'} allocated to you.
        A lead becomes a customer when the Super Admin converts it.
      </div>
      <div className="step-bar" style={{ flexWrap: 'wrap' }}>
        {visibleTabs.map((t) => (
          <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
        ))}
      </div>
      <QuotesToSendBanner sales={sales} repId={repId} onGoToSkus={() => setTab('send')} />
      <KamAlertBanner sales={sales} repId={repId} oab={mods.oab && mods.oab.OAB} />
      {tab === 'followups' && <FollowUps leads={myLeads} sales={sales} save={save} repId={repId} onGoToPo={() => setTab('po')} />}
      {tab === 'visit' && <RepVisitTab leads={myLeads} sales={sales} save={save} repId={repId} />}
      {tab === 'po' && <RepPoTab leads={myLeads} sales={sales} save={save} repId={repId} />}
      {tab === 'targets' && <RepTargetsTab sales={sales} repId={repId} />}
      {tab === 'customers' && <LeadsWorkspace book={book} sales={sales} save={save} repId={repId} />}
      {tab === 'mycust' && <MyCustomersTab book={book} sales={sales} save={save} repId={repId} />}
      {tab === 'contacts' && <MyContacts leads={myLeads} book={book} sales={sales} save={save} repId={repId} />}
      {tab === 'sku' && <RepSkusTab leads={myLeads} sales={sales} save={save} repId={repId} />}
      {tab === 'quotes' && <RepQuotationsTab sales={sales} save={save} repId={repId} />}
      {tab === 'send' && <RepSendQuoteTab sales={sales} save={save} repId={repId} />}
      {tab === 'accepted' && <RepAcceptedTab sales={sales} save={save} repId={repId} />}
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
        <button className="btn btn-s" style={{ height: 28, fontSize: 11 }} onClick={onGoToSkus}>Go to Send Quote →</button>
      </div>
      {list.map((sku) => (
        <div key={sku.id} style={{ padding: '4px 0' }}>
          📄 <b>{sku.sku_name}</b> <span style={{ color: 'var(--i2)' }}>({leadName(sku.lead_id)})</span> — ready to send to customer.
        </div>
      ))}
      <div style={{ fontSize: 10, color: '#6b86b8', marginTop: 4 }}>
        Review the price under Quotations, then send it from Send Quote — this count drops by one each time.
      </div>
    </div>
  );
}

/**
 * KAM follow-up alert: customers this rep is Key Account Manager for that are below
 * this month's target, worst gap first. Achieved is read live from the OAB board.
 * Renders nothing when the rep is nobody's KAM or everyone is on track. (repKamAlertBanner 14751)
 */
function KamAlertBanner({ sales, repId, oab }) {
  const rows = useMemo(() => {
    if (!repId) return [];
    return (sales.leads || [])
      .filter((l) => l && l.kam === repId && l.client_name)
      .map((l) => {
        const target = (l.monthly_target != null && l.monthly_target !== '') ? parseFloat(l.monthly_target) : 0;
        const achieved = kamCustomerStats(oab, l.client_name).achieved;
        const contact = kamPrimaryContact(sales, l.client_name);
        return { name: l.client_name, contactName: (contact && contact.name) || '', contactPhone: (contact && contact.phone) || '', target, achieved, gap: target - achieved };
      })
      .filter((x) => x.target > 0 && x.gap > 0)
      .sort((a, b) => b.gap - a.gap);
  }, [sales, repId, oab]);

  if (!rows.length) return null;
  return (
    <div style={{ background: '#fff6f6', border: '1px solid #f3c2c2', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#c0392b', marginBottom: 4 }}>
        🔔 KAM Follow-up — {rows.length} customer{rows.length === 1 ? '' : 's'} below target this month
      </div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
        You&rsquo;re the Key Account Manager for these customers. They haven&rsquo;t reached this month&rsquo;s target yet — follow up and get the order in.
      </div>
      <div className="tw">
        <table style={{ width: '100%', fontSize: 12 }}>
          <thead><tr style={{ color: '#888', fontSize: 10 }}>
            <th style={{ textAlign: 'left' }}>Customer</th><th style={{ textAlign: 'left' }}>Contact</th>
            <th style={{ textAlign: 'right' }}>Target</th><th style={{ textAlign: 'right' }}>Achieved</th><th style={{ textAlign: 'right' }}>Gap</th>
          </tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.name} style={{ borderTop: '1px solid #f3dede' }}>
                <td style={{ padding: '6px 8px', fontWeight: 700 }}>{x.name}</td>
                <td style={{ padding: '6px 8px' }}>
                  {x.contactName || x.contactPhone
                    ? `${x.contactName || '—'}${x.contactPhone ? ' · ' + x.contactPhone : ''}`
                    : <span style={{ color: '#aaa' }}>No contact on file</span>}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{Math.round(x.target).toLocaleString('en-IN')}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{Math.round(x.achieved).toLocaleString('en-IN')}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: '#c0392b' }}>{Math.round(x.gap).toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Per-category dispatch-form picker. Once one or more categories are ticked, shows a
 * mini checklist of dispatch forms allowed for each — same feature as Sadmin → Manage,
 * usable when a rep creates a customer or a contact. Value: { [category]: [formKeys] }.
 * (repRenderCatDesp 14588)
 */
function CategoryDispatchChecklist({ sales, categories, value, onChange }) {
  const forms = ddPairs(sales, 'despatch');
  if (!categories.length) return null;
  const toggle = (cat, key) => {
    const cur = value[cat] || [];
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    onChange({ ...value, [cat]: next });
  };
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--i2)', marginBottom: 4 }}>📮 Despatch forms for each category (optional — leave blank to allow all)</div>
      {categories.map((cat) => (
        <div key={cat} style={{ marginBottom: 6, padding: '6px 8px', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#1a4fa0', marginBottom: 4 }}>{cat}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {forms.map(([key, label]) => (
              <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 400 }}>
                <input type="checkbox" checked={(value[cat] || []).includes(key)} aria-label={`${cat} ${label}`} onChange={() => toggle(cat, key)} />{label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Quote Follow-up: SKUs whose quotation the customer accepted but no PO has landed —
 * chase them until the order comes in. (repQuoteFollowTable 14814)
 */
function QuoteFollowTable({ sales, repId, onGoToPo }) {
  const [viewQuote, setViewQuote] = useState(null);
  const leadName = (id) => ((sales.leads || []).find((x) => x.id === id) || {}).client_name || '—';
  const findQuote = (skuId) => (sales.quotations || [])
    .filter((q) => (q.items || []).some((i) => i.sku_id === skuId))
    .sort((a, b) => (b.version || 1) - (a.version || 1))[0] || null;

  // 30.09 QT2: the SKUs the Super Admin allocated to this rep, not only the ones they typed in
  const pend = quoteFollowUps(sales, repId);
  if (!pend.length) return null;

  return (
    <div className="card">
      <div className="ctitle">🧾 Quote Follow-up <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--i3)' }}>— accepted quotations awaiting PO</span></div>
      <div className="tw sy" style={{ maxHeight: 300 }}>
        <table>
          <thead><tr><th>Customer</th><th>SKU</th><th>Accepted On</th><th>Accepted Price</th><th style={{ textAlign: 'center' }}>Days Waiting</th><th>Action</th></tr></thead>
          <tbody>
            {pend.map((s) => {
              const since = s.quotation_accepted_at || s.quotation_sent_at;
              const days = since ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86400000)) : 0;
              const tiers = (s.price_tiers || []).map((t) => `₹${t.price} for ${t.qty} kg`).join(', ') || '—';
              const dc = days <= 3 ? 'var(--g)' : days <= 7 ? '#E67E22' : 'var(--red)';
              const q = findQuote(s.id);
              return (
                <tr key={s.id}>
                  <td style={{ fontWeight: 700 }}>{leadName(s.lead_id)}</td>
                  <td>{s.sku_name}</td>
                  <td style={{ fontSize: 11, color: 'var(--i2)' }}>{s.quotation_accepted_at ? fmtDate(s.quotation_accepted_at) : '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--i2)' }}>{tiers}</td>
                  <td style={{ textAlign: 'center', fontWeight: 800, color: dc }}>{days}d</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-s" style={{ color: '#1a4fa0' }} aria-label={`Enter PO for ${s.sku_name}`} onClick={onGoToPo}>Enter PO</button>
                    {q && <button className="btn btn-s" style={{ marginLeft: 4 }} aria-label={`View quote for ${s.sku_name}`} onClick={() => setViewQuote(q)}>⬇ Quote v{q.version || 1}</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {viewQuote && <QuoteDocModal quote={viewQuote} onClose={() => setViewQuote(null)} />}
    </div>
  );
}

/** Read-only quotation viewer with print / PDF, reusing the desk's QuotationDoc. */
function QuoteDocModal({ quote, onClose }) {
  const ref = useRef(null);
  return (
    // above the sticky role bar (z-index 200), so the Print / PDF / Close bar is never hidden under it
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflow: 'auto', padding: 20 }}>
      <div style={{ background: 'var(--wh)', borderRadius: 10, padding: 16, maxWidth: 860 }}>
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>{quote.client_name} — v{quote.version || 1}</div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={() => printElement(ref.current)}>🖨 Print</button>
          <button className="btn btn-g" onClick={() => elementToPDF(ref.current, `Quotation_${String(quote.client_name).replace(/[^\w-]+/g, '_')}_v${quote.version || 1}`)}>⬇ PDF</button>
          <button className="btn btn-s" onClick={onClose}>Close</button>
        </div>
        <div style={{ overflow: 'auto', maxHeight: '80vh', border: '1px solid var(--bd)' }}>
          <QuotationDoc quote={quote} innerRef={ref} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Follow-ups ─────────────────────────── */
function FollowUps({ leads, sales, save, repId, onGoToPo }) {
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
      <QuoteFollowTable sales={sales} repId={repId} onGoToPo={onGoToPo} />
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
                      <LogTouch lead={lead} save={save} repId={repId} onMsg={setMsg} />
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
function LogTouch({ lead, save, repId, onMsg }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const inter = buildInteraction(lead.id, repId, { type: 'Call', outcome, followUp: next });
      await save('sales', (prev) => ({
        ...(prev || {}),
        interactions: [...((prev && prev.interactions) || []), inter],
        // Keep the lead's own field in step so a rep who never logs interactions
        // still sees a sensible due date.
        leads: ((prev && prev.leads) || []).map((l) => (l.id === lead.id ? { ...l, next_follow_up_date: next } : l)),
      }), { retry: true });
      setOpen(false); setOutcome(''); setNext('');
      onMsg({ t: 'g', text: `✅ Logged against ${lead.client_name}.` });
    } catch (e) {
      onMsg({ t: 'r', text: saveErrorText(e) });
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
/**
 * 28.09 §Sales ¶15: the Add-Lead form with its list underneath, the way the Item
 * Master and the Customer Master work. The radio beside a name opens that lead in the
 * form above.
 */
function LeadsWorkspace({ book, sales, save, repId }) {
  const [pick, setPick] = useState(null);
  return (
    <>
      <AddCustomer sales={sales} save={save} repId={repId} book={book}
        pickId={pick} onPicked={setPick} onDone={() => setPick(null)} />
      <MyCustomers leads={book.leads} sales={sales} save={save} repId={repId}
        title="My Leads" selId={pick} onSelect={setPick}
        empty="No leads yet — add one in the form above." />
    </>
  );
}

/**
 * ¶16: "In the place of My Leads we can have My Customers, where all of that
 * particular sales rep's leads that are converted as customers can be listed."
 *
 * 30.09 §SL2: "all leads of that rep converted to customers BY THE SUPER ADMIN listed
 * in a table; radio selection to edit contact info etc." The tab was never reachable
 * (the module allocation did not know it), and its form was the Add-Lead form, which
 * cannot edit a contact. It is a customer editor now: the primary contact, payment,
 * head office, GSTIN and categories, with the despatch locations the Super Admin keeps
 * in the Customer Master shown read-only.
 */
function MyCustomersTab({ book, sales, save, repId }) {
  const [pick, setPick] = useState('');
  const waiting = useMemo(() => book.leads.filter(conversionPending).length, [book]);
  return (
    <>
      <CustomerEditor book={book} sales={sales} save={save} repId={repId} pickId={pick} onPick={setPick} />
      <CustomersList customers={book.customers} sales={sales} repId={repId}
        selId={pick} onSelect={setPick} waiting={waiting} />
    </>
  );
}

const blankCustomerForm = () => ({
  leadId: '', contactName: '', designation: '', desigOther: '', phone: '', email: '',
  paymentType: '', headOffice: '', gstin: '', categories: [], dispatchForms: {},
});

/** The contact the customer editor works on: the primary (rank 1), else the first on file. */
function primaryContactOf(contacts, leadId) {
  const list = contactsForLead(contacts, leadId).filter((c) => !c.rep_deleted);
  return list.find((c) => String(c.priority) === '1' || c.is_primary === true) || list[0] || null;
}

function CustomerEditor({ book, sales, save, repId, pickId, onPick }) {
  const { mods } = useData();
  const [form, setForm] = useState(blankCustomerForm);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const desigList = ddList(sales, 'designations');
  const customers = useMemo(() => book.customers.slice().sort((a, b) => String(a.client_name).localeCompare(String(b.client_name))), [book]);
  const lead = customers.find((l) => l.id === form.leadId) || null;
  const despatch = lead ? masterRowsFor(lead.client_name, mods.customers || []) : [];

  // The radio in the list below and the dropdown here are one selection.
  useEffect(() => {
    const l = book.customers.find((x) => x.id === pickId) || null;
    if (!l) { setForm(blankCustomerForm()); return; }
    const c = primaryContactOf(sales.contacts, l.id);
    const desig = (c && c.designation) || '';
    const other = !!desig && !desigList.includes(desig);
    setForm({
      leadId: l.id, contactName: (c && c.name) || '', designation: other ? 'Others' : desig, desigOther: other ? desig : '',
      phone: (c && c.phone) || '', email: (c && c.email) || '',
      paymentType: l.payment_type || '', headOffice: l.head_office || '', gstin: l.gstin || '',
      categories: leadCategories(l), dispatchForms: l.category_dispatch_forms || {},
    });
    setMsg(null);
  }, [pickId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCat = (c) => setForm((f) => ({ ...f, categories: f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c] }));

  async function submit() {
    if (!lead) { setMsg({ t: 'r', text: 'Pick a customer first — from the dropdown, or the radio in the list below.' }); return; }
    if (!form.categories.length && repCategoriesOf(lead, repId).length) { setMsg({ t: 'r', text: 'Keep at least one category ticked.' }); return; }
    const name = form.contactName.trim();
    const desig = form.designation === 'Others' ? form.desigOther.trim() : form.designation;
    const phone = form.phone.trim();
    const email = form.email.trim();
    const at = new Date().toISOString();
    const newId = salesUid('contact');
    setBusy(true);
    try {
      await save('sales', (prev) => {
        const cur = prev || {};
        let leads = cur.leads || [];
        if (form.categories.length) leads = setLeadCategories(leads, lead.id, form.categories, repId);
        leads = leads.map((l) => (l.id === lead.id
          ? { ...l, payment_type: form.paymentType, head_office: form.headOffice.trim(), gstin: form.gstin.trim(), category_dispatch_forms: { ...(l.category_dispatch_forms || {}), ...form.dispatchForms } }
          : l));
        let contacts = (cur.contacts || []).slice();
        const primary = primaryContactOf(contacts, lead.id);
        const fields = { designation: desig, phone, email, priority: 1, is_primary: true, updated_at: at, updated_by: repId };
        if (primary) {
          contacts = contacts.map((c) => {
            if (c.id === primary.id) return { ...c, ...fields, name: name || c.name };
            // one primary per customer
            return String(c.lead_id) === String(lead.id) && String(c.priority) === '1' ? { ...c, priority: '', is_primary: false } : c;
          });
        } else if (name || phone || email) {
          contacts.push({
            id: newId, lead_id: lead.id, customer: lead.client_name, group: lead.group || '',
            categories: form.categories, category: form.categories[0] || '',
            created_by: repId, created_at: at, name, ...fields,
          });
        }
        return { ...cur, leads, contacts };
      }, { retry: true });
      setMsg({ t: 'g', text: `✅ ${lead.client_name} saved.` });
    } catch (e) { setMsg({ t: 'r', text: saveErrorText(e) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="ctitle">{lead ? `✏ Customer details — ${lead.client_name}` : '🏆 Customer details'}</div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Pick one of your customers — here, or with the radio button in the list below — to update its contact information.
        A lead you mark Converted joins this list once the Super Admin converts it.
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="g3">
        <div className="fg"><label>Customer *</label>
          <select value={form.leadId} aria-label="My customer" onChange={(e) => onPick(e.target.value)}>
            <option value="">— pick a customer from the list below —</option>
            {customers.map((l) => <option key={l.id} value={l.id}>{l.client_name}</option>)}
          </select>
        </div>
        <div className="fg"><label>Primary contact name</label>
          <input value={form.contactName} aria-label="Primary contact name" disabled={!lead} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        </div>
        <div className="fg"><label>Designation</label>
          <select value={form.designation} aria-label="Primary contact designation" disabled={!lead} onChange={(e) => setForm({ ...form, designation: e.target.value })}>
            <option value="">-- Select --</option>
            {desigList.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {form.designation === 'Others' && <input placeholder="Enter designation" value={form.desigOther} aria-label="Primary contact other designation" style={{ marginTop: 6 }} onChange={(e) => setForm({ ...form, desigOther: e.target.value })} />}
        </div>
        <div className="fg"><label>Phone</label>
          <input value={form.phone} aria-label="Primary contact phone" disabled={!lead} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div className="fg"><label>Email</label>
          <input value={form.email} aria-label="Primary contact email" disabled={!lead} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="fg"><label>Payment Type</label>
          <select value={form.paymentType} aria-label="Customer payment type" disabled={!lead} onChange={(e) => setForm({ ...form, paymentType: e.target.value })}>
            <option value="">— Select —</option>
            {ddPairs(sales).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="fg"><label>Head Office Address</label>
          <input value={form.headOffice} aria-label="Customer head office" disabled={!lead} onChange={(e) => setForm({ ...form, headOffice: e.target.value })} />
        </div>
        <div className="fg"><label>GST Number</label>
          <input value={form.gstin} aria-label="Customer GSTIN" disabled={!lead} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
        </div>
        <div className="fg"><label>Despatch locations</label>
          <div aria-label="Customer despatch locations" style={{ fontSize: 12, padding: '7px 0' }}>
            {!lead ? <span style={{ color: 'var(--i3)' }}>—</span>
              : despatch.length ? despatch.map((r, i) => (
                <span key={i} className="tag tb" style={{ marginRight: 4 }}>{r.dispatchLoc || '—'}{r.warehouseName ? ` (${r.warehouseName})` : ''}</span>
              ))
                : <span style={{ color: '#c0392b' }}>None in the Customer Master yet</span>}
          </div>
          <div style={{ fontSize: 10, color: 'var(--i3)' }}>Read-only — the Super Admin keeps these in the Customer Master.</div>
        </div>
      </div>
      {lead && (
        <div className="fg">
          <label>Categories</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {/* the customer's own categories stay on show even if the list has since dropped one */}
            {[...new Set([...ddList(sales, 'categories'), ...leadCategories(lead)])].map((c) => (
              <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 400 }}>
                <input type="checkbox" checked={form.categories.includes(c)} aria-label={c} onChange={() => toggleCat(c)} />{c}
              </label>
            ))}
          </div>
          <CategoryDispatchChecklist sales={sales} categories={form.categories} value={form.dispatchForms} onChange={(v) => setForm({ ...form, dispatchForms: v })} />
        </div>
      )}
      <div className="fbar">
        <span style={{ flex: 1 }} />
        {lead && <button className="btn btn-s" onClick={() => onPick('')}>Cancel</button>}
        <button className="btn btn-g" onClick={submit} disabled={busy || !lead}>{busy ? 'Saving…' : '✓ Save customer details'}</button>
      </div>
    </div>
  );
}

/** The rep's customers, one row each, with the radio that opens one in the editor above. */
function CustomersList({ customers, sales, repId, selId, onSelect, waiting }) {
  const { mods } = useData();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const master = mods.customers || [];

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return customers
      .filter((l) => !t || [l.client_name, l.group].some((v) => String(v || '').toLowerCase().includes(t)))
      .sort((a, b) => String(a.client_name).localeCompare(String(b.client_name)));
  }, [customers, q]);

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>My Customers <span className="tag tgr">{rows.length}</span></div>
        <input placeholder="Search customer / group…" value={q} aria-label="Search my customers" onChange={(e) => setQ(e.target.value)} />
      </div>
      {waiting > 0 && (
        <div className="al al-b">⏳ {waiting} lead{waiting === 1 ? '' : 's'} you marked Converted {waiting === 1 ? 'is' : 'are'} waiting for the Super Admin to convert — {waiting === 1 ? 'it moves' : 'they move'} here once converted.</div>
      )}
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead><tr>
            <th style={{ width: 34, textAlign: 'center' }}>Edit</th>
            <th style={{ minWidth: 180 }}>Customer</th><th>Group</th><th>My categories</th>
            <th style={{ width: 60, textAlign: 'center' }}>Pay</th><th>Primary contact</th><th>Phone</th>
            <th>Despatch locations</th><th style={{ width: 100 }}>Converted on</th><th style={{ width: 70 }}></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>
                None of your leads has been converted into a customer yet — the Super Admin converts them.
              </td></tr>
            ) : rows.map((l) => {
              const c = primaryContactOf(sales.contacts, l.id);
              const group = l.group || custGroupOf(l.client_name, master);
              const locs = masterRowsFor(l.client_name, master);
              const open = openId === l.id;
              return (
                <FragmentRow key={l.id}>
                  <tr className={selId === l.id ? 'hi' : undefined}>
                    <td className="rowsel" style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                      <input type="radio" name="customer-edit-sel" checked={selId === l.id} style={{ margin: 0, verticalAlign: 'middle' }}
                        aria-label={`Edit customer ${l.client_name}`} onChange={() => onSelect(l.id)} />
                    </td>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{l.client_name}</td>
                    <td style={{ fontSize: 11 }}>{group && group !== l.client_name ? group : '—'}</td>
                    <td style={{ fontSize: 11 }}>{repCategoriesOf(l, repId).join(', ') || '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      {l.payment_type ? <span style={{ ...pill(PAY_STYLE[l.payment_type] || {}), borderRadius: '50%', padding: '2px 7px', fontSize: 10 }}>{l.payment_type}</span> : '—'}
                    </td>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{c ? `${c.name || '—'}${c.designation ? ' · ' + c.designation : ''}` : <span style={{ color: 'var(--i3)' }}>No contact on file</span>}</td>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{(c && c.phone) || '—'}</td>
                    <td style={{ fontSize: 11 }}>{locs.length ? locs.map((r) => (r.dispatchLoc || '—') + (r.warehouseName ? ` (${r.warehouseName})` : '')).join(', ') : '—'}</td>
                    <td style={{ fontSize: 11 }}>{l.converted_at ? fmtDate(String(l.converted_at).slice(0, 10)) : (String(l.kam || '') === String(repId) ? 'KAM' : '—')}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-s" aria-label={`${open ? 'Hide' : 'View'} ${l.client_name}`} onClick={() => setOpenId(open ? null : l.id)}>{open ? 'Hide' : 'View'}</button>
                    </td>
                  </tr>
                  {open && (
                    <tr><td colSpan={10} style={{ background: 'var(--bg)', padding: 14 }}>
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

function MyCustomers({ leads, sales, save, repId, title = 'My Leads', selId = null, onSelect = null, empty = '' }) {
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

  /**
   * 30.09 §SL5: "leads marked Converted should be sent to the Super Admin for
   * conversion; once the Super Admin converts, they move to the customers list."
   * Choosing Converted here is that request — the lead waits in the Super Admin's
   * queue and moves to My Customers when it is converted there. Any other stage
   * withdraws a request still waiting.
   */
  async function setStageOf(lead, next) {
    if (!next || next === lead.stage) return;
    setBusy(true);
    try {
      if (isConvertedStage(next)) {
        await save('sales', (prev) => ({ ...(prev || {}), leads: requestConversion((prev && prev.leads) || [], lead.id, repId) }), { retry: true });
        setMsg({ t: 'g', text: `✅ ${lead.client_name} marked Converted — sent to the Super Admin to convert. It moves to My Customers once converted.` });
      } else {
        const at = new Date().toISOString();
        await save('sales', (prev) => ({
          ...(prev || {}),
          leads: ((prev && prev.leads) || []).map((l) => (l.id === lead.id
            ? { ...l, stage: next, stage_updated_at: at, stage_updated_by: repId, conversion_requested: false }
            : l)),
        }), { retry: true });
        setMsg({ t: 'g', text: `✅ ${lead.client_name} → ${next}.` });
      }
    } catch (e) { setMsg({ t: 'r', text: saveErrorText(e) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>{title} <span className="tag tgr">{rows.length}</span></div>
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
            {onSelect && <th style={{ width: 34, textAlign: 'center' }}>Edit</th>}
            <th style={{ minWidth: 180 }}>Lead / Customer</th><th>Group</th><th>My categories</th>
            <th style={{ width: 60, textAlign: 'center' }}>Pay</th><th style={{ width: 150 }}>Stage</th><th style={{ width: 120 }}>Next ping</th><th style={{ width: 70 }}></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={onSelect ? 8 : 7} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>{empty || 'No leads allocated to you yet.'}</td></tr>
            ) : rows.map((l) => {
              const due = nextFollowUp(l, sales.interactions);
              const st = followUpState(due);
              const open = openId === l.id;
              return (
                <FragmentRow key={l.id} open={open}>
                  <tr>
                    {onSelect && (
                      /* 30.09 §SL1: on the row's middle line, level with the name — the
                         28.09 top alignment left it 10px above the name beside it. */
                      <td className="rowsel" style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                        <input type="radio" name="lead-edit-sel" checked={selId === l.id} style={{ margin: 0, verticalAlign: 'middle' }}
                          aria-label={`Edit ${l.client_name}`} onChange={() => onSelect(l.id)} />
                      </td>
                    )}
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {l.client_name}
                      {l.converted_to_customer ? <span className="tag tg" style={{ fontSize: 9, marginLeft: 4 }}>customer</span> : null}
                      {conversionPending(l) ? <span className="tag ty" style={{ fontSize: 9, marginLeft: 4 }} title="Marked Converted — waiting for the Super Admin to convert it">⏳ With Super Admin</span> : null}
                    </td>
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
                    <tr><td colSpan={onSelect ? 8 : 7} style={{ background: 'var(--bg)', padding: 14 }}>
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
// Full contact book: Payment / Category / Location / Rank columns, group / customer /
// category / location filters + search, inline Edit and an inline Rank control, and an
// add/edit form limited to the customer's own categories with the per-category
// dispatch-form checklist. (repContacts 15221)
const emptyContactForm = {
  kind: 'lead', leadId: '', name: '', designation: '', desigOther: '', rank: '',
  phone: '', email: '', customerType: '', location: '', gstin: '', categories: [], dispatchForms: {},
};

function MyContacts({ leads, book, sales, save, repId }) {
  const { mods } = useData();
  const customers = mods.customers;
  const allLeads = sales.leads || [];
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyContactForm);
  // Sales Login §8: the table has a filter over ALL the rep's leads / customers; the
  // group filter is there only when the Super Admin has put one of them in a group.
  const [filters, setFilters] = useState({ group: '', cust: '', lead: '', cat: '', loc: '', q: '' });
  const cityList = ddList(sales, 'locations');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const myLeadIds = useMemo(() => new Set(leads.map((l) => l.id)), [leads]);
  const mine = useMemo(
    () => (sales.contacts || []).filter((c) => !c.rep_deleted && (myLeadIds.has(c.lead_id) || c.created_by === repId)),
    [sales.contacts, myLeadIds, repId],
  );

  const uniq = (a) => [...new Set(a.filter(Boolean))].sort();
  const rows = useMemo(() => {
    const { group, cust, cat, loc, q } = filters;
    const t = q.trim().toLowerCase();
    return mine.filter((c) => {
      if (group && groupOfContact(c, allLeads, customers) !== group) return false;
      if (cust && custOfContact(c, allLeads) !== cust) return false;
      if (filters.lead && String(c.lead_id) !== String(filters.lead)) return false;
      if (cat && contactCats(c).indexOf(cat) < 0) return false;
      if (loc && (c.location || '') !== loc) return false;
      if (t) {
        const hay = [custOfContact(c, allLeads), c.name, c.phone, c.email, c.designation, c.location, contactCats(c).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(t) < 0) return false;
      }
      return true;
    }).sort((a, b) => custOfContact(a, allLeads).localeCompare(custOfContact(b, allLeads)) || ((a.priority || 9) - (b.priority || 9)));
  }, [mine, filters, allLeads, customers]);

  // Form option lists. The customer picker is the rep's own leads; categories are
  // limited to whatever the chosen customer deals in.
  const desigList = ddList(sales, 'designations');
  const formLead = leads.find((l) => l.id === form.leadId) || null;
  const leadCats = formLead ? leadCategories(formLead) : [];
  const formCats = leadCats.length ? leadCats : ddList(sales, 'categories');
  const noCatsOnFile = !!form.leadId && !leadCats.length;

  const toggleCat = (c) => setForm((f) => ({ ...f, categories: f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c] }));

  function editContact(c) {
    const isOther = c.designation && desigList.indexOf(c.designation) < 0;
    const lead = allLeads.find((l) => l.id === c.lead_id)
      || allLeads.find((l) => String(l.client_name || '').trim().toLowerCase() === String(custOfContact(c, allLeads) || '').toLowerCase());
    setForm({
      kind: lead && book.customers.some((x) => x.id === lead.id) ? 'customer' : 'lead',
      leadId: lead ? lead.id : '',
      name: c.name || '', designation: isOther ? 'Others' : (c.designation || ''), desigOther: isOther ? c.designation : '',
      rank: c.priority != null && c.priority !== '' ? String(c.priority) : '', phone: c.phone || '', email: c.email || '',
      customerType: c.customer_type || '', location: c.location || '', gstin: c.gstin || '',
      categories: contactCats(c), dispatchForms: {},
    });
    setEditing(c.id);
    setMsg(null);
    window.scrollTo(0, 0);
  }

  async function saveContact() {
    const lead = leads.find((l) => l.id === form.leadId) || null;
    const name = form.name.trim();
    if (!form.leadId || !name) { setMsg({ t: 'r', text: 'Customer and Name are required.' }); return; }
    setBusy(true);
    try {
      const cats = form.categories;
      const desig = form.designation === 'Others' ? form.desigOther.trim() : form.designation;
      const leadId = form.leadId;
      const customer = lead ? lead.client_name : '';
      const group = lead ? (lead.group || '') : '';
      const fields = {
        lead_id: leadId, customer, group, customer_type: form.customerType,
        location: form.location, gstin: form.gstin, categories: cats, category: cats[0] || '',
        name, designation: desig, phone: form.phone, email: form.email,
        priority: form.rank ? Number(form.rank) : '', is_primary: form.rank === '1',
      };
      const newId = salesUid('contact');
      const at = new Date().toISOString();
      const desp = form.dispatchForms;
      // Built over the blob as the server has it now, so a save that crosses another
      // writer's never puts back a contact list from before theirs.
      await save('sales', (prev) => {
        const cur = prev || {};
        let contacts = (cur.contacts || []).slice();
        if (editing) contacts = contacts.map((c) => (c.id === editing ? { ...c, ...fields } : c));
        else contacts = contacts.concat([{ id: newId, created_by: repId, created_at: at, ...fields }]);
        // Enforce a single holder per rank within the same customer.
        if (form.rank) {
          const keepId = editing || newId;
          contacts = contacts.map((c) => {
            const sameCust = (leadId && c.lead_id === leadId) || (customer && c.customer === customer);
            return (sameCust && c.id !== keepId && String(c.priority) === form.rank) ? { ...c, priority: '', is_primary: false } : c;
          });
        }
        const out = { ...cur, contacts };
        if (lead && Object.keys(desp).some((k) => (desp[k] || []).length)) {
          out.leads = (cur.leads || []).map((l) => (l.id === lead.id ? { ...l, category_dispatch_forms: { ...(l.category_dispatch_forms || {}), ...desp } } : l));
        }
        return out;
      }, { retry: true });
      setEditing(null); setForm(emptyContactForm);
      setMsg({ t: 'g', text: '✅ Saved.' });
    } catch (e) { setMsg({ t: 'r', text: saveErrorText(e) }); }
    finally { setBusy(false); }
  }

  async function removeContact(c) {
    if (!window.confirm(`Remove ${c.name} from your list?\n\nSales Admin keeps a record of it (flagged as removed by you).`)) return;
    try {
      // Soft-delete: hidden from the rep but kept for Sales Admin, flagged with who/when.
      const at = new Date().toISOString();
      await save('sales', (prev) => ({
        ...(prev || {}),
        contacts: ((prev && prev.contacts) || []).map((x) => (x.id === c.id ? { ...x, rep_deleted: true, rep_deleted_at: at, rep_deleted_by: repId } : x)),
      }), { retry: true });
      if (editing === c.id) { setEditing(null); setForm(emptyContactForm); }
    } catch (e) { setMsg({ t: 'r', text: saveErrorText(e) }); }
  }

  async function setRank(c, rank) {
    try {
      await save('sales', (prev) => ({
        ...(prev || {}),
        contacts: ((prev && prev.contacts) || []).map((x) => {
          if (x.id === c.id) return { ...x, priority: rank ? Number(rank) : '', is_primary: rank === '1' };
          const sameCust = (c.customer && x.customer === c.customer) || (c.lead_id && x.lead_id === c.lead_id);
          return (rank && sameCust && String(x.priority) === rank) ? { ...x, priority: '', is_primary: false } : x;
        }),
      }), { retry: true });
    } catch (e) { setMsg({ t: 'r', text: saveErrorText(e) }); }
  }

  return (
    <div className="card">
      <div className="ctitle">{editing ? '✏ Edit Contact' : '📇 Add Contact'}</div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Lead or customer first, then the contact. One lead / customer can have several contacts — primary, secondary and tertiary by rank.
        {editing ? ' Editing — save to keep the changes, or Cancel.' : ''}
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="g3">
        <LeadCustomerPicker book={book} kind={form.kind} leadId={form.leadId}
          onKind={(k) => setForm((f) => ({ ...f, kind: k, leadId: '', categories: [] }))}
          onLead={(id) => setForm((f) => ({ ...f, leadId: id, categories: [] }))} ariaPrefix="Contact" />
        <div className="fg"><label>Name *</label><input value={form.name} aria-label="Contact name" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="fg">
          <label>Designation</label>
          <select value={form.designation} aria-label="Contact designation" onChange={(e) => setForm({ ...form, designation: e.target.value })}>
            <option value="">-- Select --</option>
            {desigList.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {form.designation === 'Others' && <input placeholder="Enter designation" value={form.desigOther} aria-label="Other designation" style={{ marginTop: 6 }} onChange={(e) => setForm({ ...form, desigOther: e.target.value })} />}
        </div>
        <div className="fg">
          <label>Rank</label>
          <select value={form.rank} aria-label="Contact rank" onChange={(e) => setForm({ ...form, rank: e.target.value })}>
            {REP_RANKS.map(([v, l]) => <option key={v || 'none'} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="fg"><label>Phone</label><input value={form.phone} aria-label="Contact phone" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div className="fg"><label>Email</label><input value={form.email} aria-label="Contact email" onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="fg">
          <label>Customer Type</label>
          <select value={form.customerType} aria-label="Customer type" onChange={(e) => setForm({ ...form, customerType: e.target.value })}>
            <option value="">-- Select --</option>
            {REP_CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="fg"><label>Location (city)</label>
          {/* §9: one list from the Super Admin — no more Bangalore / Bengaluru / Bangalor */}
          <select value={form.location} aria-label="Contact location" onChange={(e) => setForm({ ...form, location: e.target.value })}>
            <option value="">— Select —</option>
            {cityList.map((c) => <option key={c} value={c}>{c}</option>)}
            {form.location && !cityList.includes(form.location) && <option value={form.location}>{form.location} (not in the list)</option>}
          </select>
          <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>Missing a city? The Super Admin adds it under Drop-down selections → Locations.</div>
        </div>
        <div className="fg"><label>GST Number</label><input value={form.gstin} aria-label="Contact GST" placeholder="e.g. 36AAECB5291P1Z4" onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
      </div>

      <div className="fg">
        <label>Categories (limited to this customer&rsquo;s categories)</label>
        {!form.leadId ? <div style={{ fontSize: 11, color: 'var(--i3)' }}>Pick a customer above to see its categories.</div> : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {formCats.map((c) => (
                <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 400 }}>
                  <input type="checkbox" checked={form.categories.includes(c)} aria-label={c} onChange={() => toggleCat(c)} />{c}
                </label>
              ))}
            </div>
            {noCatsOnFile && <div style={{ fontSize: 10, color: '#c0392b', marginTop: 5 }}>This customer has no categories set yet — showing all. Set them when adding the customer or in Sales Admin.</div>}
            <CategoryDispatchChecklist sales={sales} categories={form.categories} value={form.dispatchForms} onChange={(v) => setForm({ ...form, dispatchForms: v })} />
          </>
        )}
      </div>

      <div className="fbar">
        <span style={{ flex: 1 }} />
        {editing && <button className="btn btn-s" onClick={() => { setEditing(null); setForm(emptyContactForm); }}>Cancel</button>}
        <button className="btn btn-g" onClick={saveContact} disabled={busy}>{editing ? '✓ Update contact' : '＋ Add contact'}</button>
      </div>

      <div className="ctitle" style={{ marginTop: 18 }}>My Contacts <span className="tag tgr">{rows.length}</span></div>
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        {uniq(mine.map((c) => groupOfContact(c, allLeads, customers))).length > 0 && (
          <select value={filters.group} aria-label="Filter by group" onChange={(e) => setFilters({ ...filters, group: e.target.value })}>
            <option value="">All groups</option>
            {uniq(mine.map((c) => groupOfContact(c, allLeads, customers))).map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        <select value={filters.lead} aria-label="Filter by lead" onChange={(e) => setFilters({ ...filters, lead: e.target.value })}>
          <option value="">All leads</option>
          {book.leads.map((l) => <option key={l.id} value={l.id}>{l.client_name}</option>)}
        </select>
        <select value={filters.cust} aria-label="Filter by customer" onChange={(e) => setFilters({ ...filters, cust: e.target.value })}>
          <option value="">All customers</option>
          {uniq(book.customers.map((l) => l.client_name)).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.cat} aria-label="Filter by category" onChange={(e) => setFilters({ ...filters, cat: e.target.value })}>
          <option value="">All categories</option>
          {ddList(sales, 'categories').map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.loc} aria-label="Filter by location" onChange={(e) => setFilters({ ...filters, loc: e.target.value })}>
          <option value="">All locations</option>
          {uniq(mine.map((c) => c.location || '')).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input placeholder="Search name / phone / email…" value={filters.q} aria-label="Search contacts" onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
      </div>
      <div className="tw sy" style={{ maxHeight: 360 }}>
        <table>
          <thead><tr>
            <th style={{ width: 30 }}></th><th>Lead / Customer</th><th>Payment</th><th>Category</th><th>Contact</th><th>Designation</th>
            <th>Location</th><th style={{ width: 110 }}>Rank</th><th>Phone</th><th>Email</th><th style={{ width: 70 }}></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={11} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No contacts yet.</td></tr>
              : rows.map((c) => (
                <tr key={c.id} className={editing === c.id ? 'hi' : undefined}>
                  {/* §7: the radio button brings the line into the form above to edit */}
                  {/* 28.09 §Sales ¶21: long names were wrapping and pushing the lead, the
                      contact and the designation apart; they no longer wrap. 30.09 §SL1: the
                      radio sits on the row's middle line with them, not at the top. */}
                  <td className="rowsel" style={{ textAlign: 'center', verticalAlign: 'middle' }}><input type="radio" name="contact-edit" checked={editing === c.id} style={{ margin: 0, verticalAlign: 'middle' }} aria-label={`Edit ${c.name}`} onChange={() => editContact(c)} /></td>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{custOfContact(c, allLeads) || '—'}</td>
                  <td>{(() => { const pk = payOfContact(c, allLeads); return pk ? <span style={{ ...pill(PAY_STYLE[pk] || {}), fontSize: 10 }}>{payLabel(pk)}</span> : '—'; })()}</td>
                  <td>{contactCats(c).map((cat) => <span key={cat} className="tag tb" style={{ marginRight: 3, fontSize: 10 }}>{cat}</span>) || '—'}</td>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c.name}{c.priority == 1 ? <span style={{ color: '#c9a100' }} title="Primary"> ⭐</span> : null}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{c.designation || '—'}</td>
                  <td style={{ fontSize: 11 }}>{c.location || '—'}</td>
                  <td>
                    <select value={c.priority != null && c.priority !== '' ? String(c.priority) : ''} aria-label={`Rank for ${c.name}`} onChange={(e) => setRank(c, e.target.value)} style={{ height: 26, fontSize: 11 }}>
                      {REP_RANKS.map(([v, l]) => <option key={v || 'none'} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{c.phone || '—'}</td>
                  <td style={{ fontSize: 11 }}>{c.email || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-s" style={{ color: 'var(--red)' }} aria-label={`Delete ${c.name}`} onClick={() => removeContact(c)}>Delete</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Add Lead ─────────────────────────── */
// Sales Login §1-§4: no groups here at all ("it is very hard to educate the sales
// reps not to create the groups unnecessarily"). The Lead drop-down offers the
// leads the Super Admin allocated to the rep and the ones the rep added — pick one
// to add or edit its categories, or Add New Lead. Check the list before adding, so
// the same lead is not entered twice.
function AddCustomer({ sales, save, repId, book, onDone, pickId = null, onPicked = null }) {
  const allLeads = sales.leads || [];
  const [form, setForm] = useState({
    leadSel: '__new__', custNew: '',
    paymentType: '', headOffice: '', deliveryLocation: '', gstin: '',
    categories: [], dispatchForms: {}, stage: 'To Approach', followUp: '', remarks: '',
  });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const cityList = ddList(sales, 'locations');

  // 30.09 §SL2: customers have their own tab and editor now — this form is for leads
  const mine = useMemo(() => book.leads.slice().sort((a, b) => String(a.client_name).localeCompare(String(b.client_name))), [book]);
  const existing = form.leadSel !== '__new__' ? mine.find((l) => l.id === form.leadSel) || null : null;
  const dupe = useMemo(() => {
    const name = form.custNew.trim().toLowerCase();
    return name ? allLeads.find((l) => String(l.client_name || '').trim().toLowerCase() === name) || null : null;
  }, [form.custNew, allLeads]);

  const toggleCat = (c) => setForm((f) => ({
    ...f,
    categories: f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c],
  }));

  // The list below the form drives the same selection the dropdown does, so the
  // radio beside a lead name opens it here for editing.
  useEffect(() => { if (pickId != null) pickLead(pickId); }, [pickId]);   // eslint-disable-line react-hooks/exhaustive-deps

  function pickLead(v) {
    const l = mine.find((x) => x.id === v) || null;
    setForm((f) => ({
      ...f, leadSel: v, custNew: '',
      categories: l ? leadCategories(l) : [], paymentType: l ? l.payment_type || '' : '', headOffice: l ? l.head_office || '' : '',
      deliveryLocation: l ? l.delivery_location || '' : '', gstin: l ? l.gstin || '' : '', stage: l ? l.stage || 'To Approach' : 'To Approach',
      dispatchForms: l ? l.category_dispatch_forms || {} : {},
    }));
    setMsg(null);
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      if (existing) {
        if (!form.categories.length) throw new Error('Select at least one category.');
        await save('sales', (prev) => ({
          ...(prev || {}),
          leads: setLeadCategories((prev && prev.leads) || [], existing.id, form.categories, repId).map((l) => (l.id === existing.id
            ? { ...l, payment_type: form.paymentType, head_office: form.headOffice, delivery_location: form.deliveryLocation, gstin: form.gstin, category_dispatch_forms: { ...(l.category_dispatch_forms || {}), ...form.dispatchForms } }
            : l)),
        }), { retry: true });
        setMsg({ t: 'g', text: `✅ ${existing.client_name} updated — categories: ${form.categories.join(', ')}.` });
      } else {
        if (dupe) throw new Error(`"${dupe.client_name}" is already on the list${leadsForRep([dupe], repId).length ? ' — pick it above to edit it' : ' (allocated to another rep — ask the Super Admin)'}.`);
        const leadForm = {
          group: '', customer: form.custNew.trim(), paymentType: form.paymentType, headOffice: form.headOffice,
          deliveryLocation: form.deliveryLocation, gstin: form.gstin, categories: form.categories,
          dispatchForms: form.dispatchForms, stage: form.stage, followUp: form.followUp,
        };
        const built = buildLead(leadForm, repId);
        // §SL5: a new lead entered as Converted goes to the Super Admin to convert, like any other
        const requested = isConvertedStage(built.stage);
        const lead = requested ? requestConversion([built], built.id, repId)[0] : built;
        const inter = form.followUp
          ? buildInteraction(lead.id, repId, { type: 'Follow-up scheduled', outcome: form.remarks, followUp: form.followUp })
          : null;
        await save('sales', (prev) => {
          const cur = prev || {};
          const out = { ...cur, leads: [...(cur.leads || []), lead] };
          if (inter) out.interactions = [...(cur.interactions || []), inter];
          return out;
        }, { retry: true });
        setMsg({ t: 'g', text: requested
          ? '✅ Lead saved and marked Converted — the Super Admin has been asked to convert it. Add contacts from My Contacts.'
          : '✅ Lead saved — it is on My Leads now. Add contacts from My Contacts.' });
        setForm({ leadSel: '__new__', custNew: '', paymentType: '', headOffice: '', deliveryLocation: '', gstin: '', categories: [], dispatchForms: {}, stage: 'To Approach', followUp: '', remarks: '' });
        setTimeout(onDone, 700);
      }
    } catch (e) {
      setMsg({ t: 'r', text: e && e.code === 'conflict' ? saveErrorText(e) : (e.message || String(e)) });
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="ctitle">➕ Add Lead</div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        First check whether the lead is already on your list — pick it to add or change its categories. Otherwise choose
        <b> Add New Lead</b>. New leads are allocated to you for the categories you tick. Add contacts afterwards from My Contacts.
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="g3">
        <div className="fg">
          <label>Lead *</label>
          <select value={form.leadSel} aria-label="Lead" onChange={(e) => { pickLead(e.target.value); if (onPicked) onPicked(e.target.value); }}>
            <option value="__new__">➕ Add New Lead…</option>
            {mine.map((l) => <option key={l.id} value={l.id}>{l.client_name}</option>)}
          </select>
          {form.leadSel === '__new__' && (
            <>
              <input placeholder="New lead name" value={form.custNew} aria-label="Lead name" style={{ marginTop: 6 }} onChange={(e) => setForm({ ...form, custNew: e.target.value })} />
              {dupe && <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 3 }}>“{dupe.client_name}” already exists — do not add it twice.</div>}
            </>
          )}
        </div>
        <div className="fg">
          <label>Payment Type</label>
          <select value={form.paymentType} aria-label="Payment Type" onChange={(e) => setForm({ ...form, paymentType: e.target.value })}>
            <option value="">— Select —</option>
            {ddPairs(sales).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {/* 28.09 §Sales ¶1-¶3: the label says what the field is — the office's ADDRESS,
            and the delivery CITY — and the city can only be PICKED. A datalist looks like
            a dropdown but still accepts anything typed into it, which is how leads ended
            up with cities that match nothing downstream. */}
        <div className="fg"><label>Head Office Address</label><input value={form.headOffice} aria-label="Head Office Address" onChange={(e) => setForm({ ...form, headOffice: e.target.value })} /></div>
        <div className="fg"><label>Location (City)</label>
          <select value={form.deliveryLocation} aria-label="Location (City)" onChange={(e) => setForm({ ...form, deliveryLocation: e.target.value })}>
            <option value="">— Select —</option>
            {/* a city already on the lead stays selectable even if it has since left the master */}
            {form.deliveryLocation && !cityList.includes(form.deliveryLocation) && <option value={form.deliveryLocation}>{form.deliveryLocation}</option>}
            {cityList.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="fg"><label>GST Number</label><input value={form.gstin} aria-label="GST Number" onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
      </div>

      <div className="fg">
        <label>Categories (one or more) *{existing ? <span style={{ fontWeight: 400, color: 'var(--i3)' }}> — already assigned: {leadCategories(existing).join(', ') || 'none'}</span> : null}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ddList(sales, 'categories').map((c) => (
            <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 400 }}>
              <input type="checkbox" checked={form.categories.includes(c)} aria-label={c} onChange={() => toggleCat(c)} />{c}
            </label>
          ))}
        </div>
        <CategoryDispatchChecklist sales={sales} categories={form.categories} value={form.dispatchForms} onChange={(v) => setForm({ ...form, dispatchForms: v })} />
      </div>

      {!existing && (
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
      )}

      <div className="fbar">
        <span style={{ flex: 1 }} />
        <button className="btn btn-g" onClick={submit} disabled={busy}>{busy ? 'Saving…' : existing ? '✓ Save Lead' : '✓ Save New Lead'}</button>
      </div>
    </div>
  );
}
