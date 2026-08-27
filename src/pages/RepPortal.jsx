import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { fmtDate } from '../lib/format.js';
import { custGroups, custsInGroup, custGroupOf } from '../lib/master.js';
import { ddList, ddPairs } from '../lib/dropdowns.js';
import NegoPanel from '../components/NegoPanel.jsx';
import RepVisitTab from '../components/RepVisitTab.jsx';
import RepPoTab from '../components/RepPoTab.jsx';
import RepTargetsTab from '../components/RepTargetsTab.jsx';
import RepSkusTab from '../components/RepSkusTab.jsx';
import { quotesToSend } from '../lib/repPortal.js';
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
/** Existing customers for the Add-Customer picker: Master customers in the group ∪ rep leads in it. (repAddCustsForGroup 14616) */
function custsForGroup(customers, leads, grp) {
  const set = new Set(custsInGroup(customers, grp));
  (leads || []).forEach((l) => {
    const lg = String((l && l.group) || '').trim(); const lc = String((l && l.client_name) || '').trim();
    if (!lc) return;
    if (grp) { if (lg === grp) set.add(lc); } else if (!lg) set.add(lc);
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

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
        Signed in as <strong>{repName || 'rep'}</strong> — {myLeads.length} customer{myLeads.length === 1 ? '' : 's'} allocated to you.
        You see only the product categories assigned to you.
      </div>
      <div className="step-bar" style={{ flexWrap: 'wrap' }}>
        {visibleTabs.map((t) => (
          <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
        ))}
      </div>
      <QuotesToSendBanner sales={sales} repId={repId} onGoToSkus={() => setTab('sku')} />
      <KamAlertBanner sales={sales} repId={repId} oab={mods.oab && mods.oab.OAB} />
      {tab === 'followups' && <FollowUps leads={myLeads} sales={sales} save={save} repId={repId} onGoToPo={() => setTab('po')} />}
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
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--i2)', marginBottom: 4 }}>📮 Dispatch forms for each category (optional — leave blank to allow all)</div>
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

  const pend = (sales.skus || []).filter((s) =>
    s.created_by === repId && s.quotation_accepted && !((sales.pos || []).some((p) => p.sku_id === s.id)));
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: 20 }}>
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
// Full contact book: Payment / Category / Location / Rank columns, group / customer /
// category / location filters + search, inline Edit and an inline Rank control, and an
// add/edit form limited to the customer's own categories with the per-category
// dispatch-form checklist. (repContacts 15221)
const emptyContactForm = {
  leadId: '', name: '', designation: '', desigOther: '', rank: '',
  phone: '', email: '', customerType: '', location: '', gstin: '', categories: [], dispatchForms: {},
};

function MyContacts({ leads, sales, save, repId }) {
  const { mods } = useData();
  const customers = mods.customers;
  const allLeads = sales.leads || [];
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyContactForm);
  const [filters, setFilters] = useState({ group: '', cust: '', cat: '', loc: '', q: '' });
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
      let contacts = (sales.contacts || []).slice();
      if (editing) contacts = contacts.map((c) => (c.id === editing ? { ...c, ...fields } : c));
      else contacts = contacts.concat([{ id: salesUid('contact'), created_by: repId, created_at: new Date().toISOString(), ...fields }]);
      // Enforce a single holder per rank within the same customer.
      if (form.rank) {
        const keepId = editing || contacts[contacts.length - 1].id;
        contacts = contacts.map((c) => {
          const sameCust = (leadId && c.lead_id === leadId) || (customer && c.customer === customer);
          return (sameCust && c.id !== keepId && String(c.priority) === form.rank) ? { ...c, priority: '', is_primary: false } : c;
        });
      }
      const patch = { contacts };
      const desp = form.dispatchForms;
      if (lead && Object.keys(desp).some((k) => (desp[k] || []).length)) {
        patch.leads = allLeads.map((l) => (l.id === lead.id ? { ...l, category_dispatch_forms: { ...(l.category_dispatch_forms || {}), ...desp } } : l));
      }
      await patchSales(save, patch);
      setEditing(null); setForm(emptyContactForm);
      setMsg({ t: 'g', text: '✅ Saved.' });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  }

  async function removeContact(c) {
    if (!window.confirm(`Remove ${c.name} from your list?\n\nSales Admin keeps a record of it (flagged as removed by you).`)) return;
    try {
      // Soft-delete: hidden from the rep but kept for Sales Admin, flagged with who/when.
      await patchSales(save, { contacts: (sales.contacts || []).map((x) => (x.id === c.id ? { ...x, rep_deleted: true, rep_deleted_at: new Date().toISOString(), rep_deleted_by: repId } : x)) });
      if (editing === c.id) { setEditing(null); setForm(emptyContactForm); }
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
  }

  async function setRank(c, rank) {
    try {
      const contacts = (sales.contacts || []).map((x) => {
        if (x.id === c.id) return { ...x, priority: rank ? Number(rank) : '', is_primary: rank === '1' };
        const sameCust = (c.customer && x.customer === c.customer) || (c.lead_id && x.lead_id === c.lead_id);
        return (rank && sameCust && String(x.priority) === rank) ? { ...x, priority: '', is_primary: false } : x;
      });
      await patchSales(save, { contacts });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
  }

  return (
    <div className="card">
      <div className="ctitle">{editing ? '✏ Edit Contact' : '📇 Add Contact'}</div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Pick the customer, then fill in the contact. One customer can have several contacts — each with its own designation and rank.
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="g3">
        <div className="fg">
          <label>Customer *</label>
          <select value={form.leadId} aria-label="Contact customer" onChange={(e) => setForm({ ...form, leadId: e.target.value, categories: [] })}>
            <option value="">— Select —</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.client_name}</option>)}
          </select>
        </div>
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
        <div className="fg"><label>Location (city)</label><input value={form.location} aria-label="Contact location" placeholder="City where the customer sits" onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
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
        <select value={filters.group} aria-label="Filter by group" onChange={(e) => setFilters({ ...filters, group: e.target.value })}>
          <option value="">All groups</option>
          {uniq(mine.map((c) => groupOfContact(c, allLeads, customers))).map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={filters.cust} aria-label="Filter by customer" onChange={(e) => setFilters({ ...filters, cust: e.target.value })}>
          <option value="">All customers</option>
          {uniq(mine.map((c) => custOfContact(c, allLeads))).map((c) => <option key={c} value={c}>{c}</option>)}
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
            <th>Customer</th><th>Payment</th><th>Category</th><th>Contact</th><th>Designation</th>
            <th>Location</th><th style={{ width: 110 }}>Rank</th><th>Phone</th><th>Email</th><th style={{ width: 110 }}>Actions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No contacts yet.</td></tr>
              : rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700 }}>{custOfContact(c, allLeads) || '—'}</td>
                  <td>{(() => { const pk = payOfContact(c, allLeads); return pk ? <span style={{ ...pill(PAY_STYLE[pk] || {}), fontSize: 10 }}>{payLabel(pk)}</span> : '—'; })()}</td>
                  <td>{contactCats(c).map((cat) => <span key={cat} className="tag tb" style={{ marginRight: 3, fontSize: 10 }}>{cat}</span>) || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{c.name}{c.priority == 1 ? <span style={{ color: '#c9a100' }} title="Primary"> ⭐</span> : null}</td>
                  <td style={{ fontSize: 11 }}>{c.designation || '—'}</td>
                  <td style={{ fontSize: 11 }}>{c.location || '—'}</td>
                  <td>
                    <select value={c.priority != null && c.priority !== '' ? String(c.priority) : ''} aria-label={`Rank for ${c.name}`} onChange={(e) => setRank(c, e.target.value)} style={{ height: 26, fontSize: 11 }}>
                      {REP_RANKS.map(([v, l]) => <option key={v || 'none'} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{c.phone || '—'}</td>
                  <td style={{ fontSize: 11 }}>{c.email || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-s" style={{ color: '#3730a3' }} aria-label={`Edit ${c.name}`} onClick={() => editContact(c)}>Edit</button>
                    <button className="btn btn-s" style={{ marginLeft: 4, color: 'var(--red)' }} aria-label={`Delete ${c.name}`} onClick={() => removeContact(c)}>Delete</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Add Customer ─────────────────────────── */
// Group → Customer cascade over the Customer Master (repAddLead 14641): pick or add a
// group, then pick or add the customer, plus the per-category dispatch-form checklist.
function AddCustomer({ sales, save, repId, onDone }) {
  const { mods } = useData();
  const customers = mods.customers;
  const allLeads = sales.leads || [];
  const [form, setForm] = useState({
    groupSel: '', groupNew: '', custSel: '__new__', custNew: '',
    paymentType: '', headOffice: '', deliveryLocation: '', gstin: '',
    categories: [], dispatchForms: {}, stage: 'To Approach', followUp: '', remarks: '',
  });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  // Groups already known, from the Customer Master and from existing leads.
  const groups = useMemo(() => {
    const set = new Set(custGroups(customers));
    allLeads.forEach((l) => { const g = String(l.group || '').trim(); if (g) set.add(g); });
    return [...set].sort();
  }, [customers, allLeads]);

  const groupVal = form.groupSel === '__new__' ? form.groupNew : (form.groupSel === '' ? '' : form.groupSel);
  const custOptions = useMemo(() => custsForGroup(customers, allLeads, groupVal), [customers, allLeads, groupVal]);

  const toggleCat = (c) => setForm((f) => ({
    ...f,
    categories: f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c],
  }));

  function onGroupChange(v) {
    // Switching group refills the customer list, so drop back to "add new".
    setForm((f) => ({ ...f, groupSel: v, custSel: '__new__', custNew: '' }));
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const group = form.groupSel === '__new__' ? form.groupNew.trim() : (form.groupSel === '' ? '' : form.groupSel);
      const customer = (form.custSel === '__new__' || form.custSel === '') ? form.custNew.trim() : form.custSel;
      const leadForm = {
        group, customer, paymentType: form.paymentType, headOffice: form.headOffice,
        deliveryLocation: form.deliveryLocation, gstin: form.gstin, categories: form.categories,
        dispatchForms: form.dispatchForms, stage: form.stage, followUp: form.followUp,
      };
      const lead = buildLead(leadForm, repId);
      const patch = { leads: [...allLeads, lead] };
      if (form.followUp) {
        patch.interactions = [...(sales.interactions || []),
          buildInteraction(lead.id, repId, { type: 'Follow-up scheduled', outcome: form.remarks, followUp: form.followUp })];
      }
      await patchSales(save, patch);
      setMsg({ t: 'g', text: '✅ Customer saved. Add contacts from My Contacts.' });
      setForm({ groupSel: '', groupNew: '', custSel: '__new__', custNew: '', paymentType: '', headOffice: '', deliveryLocation: '', gstin: '', categories: [], dispatchForms: {}, stage: 'To Approach', followUp: '', remarks: '' });
      setTimeout(onDone, 700);
    } catch (e) {
      setMsg({ t: 'r', text: e.message || String(e) });
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="ctitle">➕ Add Customer</div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Pick or add a group, then pick or add the customer. New customers are allocated to you for the
        categories you tick. Add contacts afterwards from My Contacts.
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="g3">
        <div className="fg">
          <label>Group</label>
          <select value={form.groupSel} aria-label="Group" onChange={(e) => onGroupChange(e.target.value)}>
            <option value="">— No group —</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            <option value="__new__">➕ Add new group…</option>
          </select>
          {form.groupSel === '__new__' && <input placeholder="New group name" value={form.groupNew} aria-label="New group name" style={{ marginTop: 6 }} onChange={(e) => setForm({ ...form, groupNew: e.target.value })} />}
        </div>
        <div className="fg">
          <label>Customer *</label>
          <select value={form.custSel} aria-label="Select customer" onChange={(e) => setForm({ ...form, custSel: e.target.value })}>
            {custOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__new__">➕ Add new customer…</option>
          </select>
          {(form.custSel === '__new__' || form.custSel === '') && <input placeholder="New customer name" value={form.custNew} aria-label="Customer" style={{ marginTop: 6 }} onChange={(e) => setForm({ ...form, custNew: e.target.value })} />}
        </div>
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
        <CategoryDispatchChecklist sales={sales} categories={form.categories} value={form.dispatchForms} onChange={(v) => setForm({ ...form, dispatchForms: v })} />
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
