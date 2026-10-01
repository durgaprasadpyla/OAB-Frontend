import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { fmtDate } from '../lib/format.js';
import { custGroupOf } from '../lib/master.js';
import { QuotationDoc } from '../pages/QuotationDesk.jsx';
import { elementToPDF, printElement } from '../lib/pdf.js';
import { buildTier, DEFAULT_GST_PCT } from '../lib/sales.js';
import { skuCsaDone } from '../lib/repPortal.js';
import { useFreshModule } from '../lib/useFreshModule.js';
import NegoPanel from './NegoPanel.jsx';
import LeadCustomerPicker from './LeadCustomerPicker.jsx';
import {
  repBook, deskTiersForSku, deskQuoteForSku, deskItemForSku, repTiersForSku, floorFor, saveRepQuote,
  quoteStatusOf, quotableSkus, markQuotesSent, setQuoteAccepted, despatchLocationsFor, isCustomerLead, parseMoq,
} from '../lib/repFlow.js';

// Sales Login §36-§60 — the three quotation tabs of the rep login.
//
//   Quotations     — every SKU the quote desk has priced (and any the rep priced by
//                    hand), filtered by customer / group / lead / status; a radio
//                    beside each SKU brings the desk's price per MOQ into the form,
//                    where the rep may RAISE it (never below the desk's figure), save,
//                    or mark the quote accepted.
//   Send Quote     — the same list with a checkbox per row, live once a customer is
//                    chosen; Prepare Quote opens the quotation (PDF) and Sent Quote
//                    flips the status; a history link per SKU; a Quote-accepted toggle.
//   Quote Accepted — the accepted SKUs, read-only, with column filters, plus a way to
//                    add a quotation by hand for a customer already past the CSA.

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v) => '₹' + n(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyText = (v) => n(v).toLocaleString('en-IN');
const STATUS_LABEL = { to_send: 'To be sent', sent: 'Sent', accepted: 'Accepted', none: '—' };
// 30.09 QT3: "green = sent, red = to be sent". The theme's --g is the brand BLUE
// (#0e6fb8), so sent rows read blue and the client saw no green at all — the colours
// are spelt out here instead.
const GREEN = '#1e7e34';
const GREEN_BG = '#e6f4ea';
const RED = '#c0392b';
const RED_BG = '#fde8e8';
const STATUS_STYLE = {
  to_send: { background: RED_BG, color: RED },
  sent: { background: GREEN_BG, color: GREEN },
  accepted: { background: GREEN_BG, color: GREEN },
};
const ROW_TINT = { to_send: '#fff5f4', sent: '#f3fbf5', accepted: '#f3fbf5' };
const pill = (st) => ({ ...(STATUS_STYLE[st] || {}), padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700, display: 'inline-block' });
const skuColor = (st) => (st === 'sent' || st === 'accepted' ? GREEN : RED);
const tiersText = (tiers) => (tiers || []).map((t) => `${money(t.price)} @ ${qtyText(t.qty)}`).join(' · ');
const nk = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The buying group a lead belongs to — a REAL group only. custGroupOf answers with
 * the customer's own name when it has no group, which filled the Group filter with
 * customer and lead names (30.09 QT3).
 */
function realGroup(lead, customers) {
  if (!lead) return '';
  const g = custGroupOf(lead.client_name, customers);
  if (g && nk(g) !== nk(lead.client_name)) return g;
  const own = String(lead.group || '').trim();
  return own && nk(own) !== nk(lead.client_name) ? own : '';
}

/** 30.09 QT3: the SKU's own despatch location — the one on its CSA requisition — not the customer's first. */
function skuLocation(sku, lead, customers) {
  const req = (sku && sku.csa_request) || {};
  return String(req.despatch_location || (sku && sku.despatch_location) || '').trim() || despatchLocationsFor(lead, customers)[0] || '';
}

/** The rows all three tabs share: SKU + lead + group + status + prices. */
function useQuoteRows(sales, repId) {
  const { mods } = useData();
  const customers = mods.customers || [];
  const book = useMemo(() => repBook(sales, customers, repId), [sales, customers, repId]);
  // 30.09 QT2: the SKUs the Super Admin allocated to this rep (skuOwnerRep)
  const rows = useMemo(() => quotableSkus(sales, repId).map((sku) => {
    const lead = (sales.leads || []).find((l) => l.id === sku.lead_id) || null;
    const desk = deskTiersForSku(sales, sku.id);
    const deskQuote = deskQuoteForSku(sales, sku.id);
    const deskItem = deskItemForSku(sales, sku.id);
    return {
      sku, lead, isCust: isCustomerLead(lead), name: lead ? lead.client_name : '—', group: realGroup(lead, customers), desk,
      tiers: repTiersForSku(sku, desk, deskQuote),
      status: quoteStatusOf(sales, sku), location: skuLocation(sku, lead, customers),
      deskQuote, deskItem, deskMoq: deskItem ? parseMoq(deskItem.moq) : 0,
    };
  }), [sales, repId, customers]);
  return { rows, book, customers };
}

/**
 * 30.09 QT4: the filters cascade — group → customer / lead → despatch location. Each
 * list offers only what the choices above it leave, and changing a choice clears the
 * ones below it.
 */
function Filters({ rows, f, setF, withStatus = true, withLocation = false }) {
  const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const inGroup = rows.filter((r) => !f.group || r.group === f.group);
  const inParty = inGroup.filter((r) => (!f.customer || (r.isCust && r.name === f.customer)) && (!f.lead || (!r.isCust && r.name === f.lead)));
  return (
    <div className="fbar" style={{ flexWrap: 'wrap' }}>
      <select value={f.group} aria-label="Filter by group" onChange={(e) => setF({ ...f, group: e.target.value, customer: '', lead: '', location: '' })}>
        <option value="">All groups</option>
        {uniq(rows.map((r) => r.group)).map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      <select value={f.customer} aria-label="Filter by customer" onChange={(e) => setF({ ...f, customer: e.target.value, lead: '', location: '' })}>
        <option value="">All customers</option>
        {uniq(inGroup.filter((r) => r.isCust).map((r) => r.name)).map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={f.lead} aria-label="Filter by lead" onChange={(e) => setF({ ...f, lead: e.target.value, customer: '', location: '' })}>
        <option value="">All leads</option>
        {uniq(inGroup.filter((r) => !r.isCust).map((r) => r.name)).map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {withLocation && (
        <select value={f.location} aria-label="Filter by despatch location" onChange={(e) => setF({ ...f, location: e.target.value })}>
          <option value="">All despatch locations</option>
          {uniq(inParty.map((r) => r.location)).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      {withStatus && (
        <select value={f.status} aria-label="Filter by quote status" onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Sent or to be sent</option>
          <option value="to_send">To be sent</option>
          <option value="sent">Sent</option>
          <option value="accepted">Accepted</option>
        </select>
      )}
    </div>
  );
}

/**
 * 30.09 QT4: "Toggle per SKU 'Quote accepted Yes/No'" — a real switch, not a
 * drop-down pinned to "No". Module scope so it is not remounted on every render.
 */
function AcceptToggle({ on, label, disabled, onChange }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer', fontSize: 11, fontWeight: 700, position: 'relative' }}>
      <input type="checkbox" role="switch" aria-checked={on} checked={on} disabled={disabled} aria-label={label}
        onChange={(e) => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }} />
      <span aria-hidden="true" style={{ width: 30, height: 16, borderRadius: 8, background: on ? GREEN : '#cfd6df', position: 'relative', display: 'inline-block', opacity: disabled ? 0.5 : 1 }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff' }} />
      </span>
      <span style={{ color: on ? GREEN : 'var(--i3)' }}>{on ? 'Yes' : 'No'}</span>
    </label>
  );
}
const applyFilters = (rows, f) => rows.filter((r) => (
  (!f.group || r.group === f.group) && (!f.customer || (r.isCust && r.name === f.customer)) && (!f.lead || (!r.isCust && r.name === f.lead))
  && (!f.location || r.location === f.location) && (!f.status || r.status === f.status)
));
const blankF = () => ({ group: '', customer: '', lead: '', location: '', status: '' });

/* ─────────────────────────── Quotations ─────────────────────────── */
export function RepQuotationsTab({ sales, save, repId }) {
  const { user } = useAuth() || {};
  const { rows } = useQuoteRows(sales, repId);
  // 30.09 QT1: the desk's quotation, issued in another login, shows on opening
  useFreshModule('sales');
  const [f, setF] = useState(blankF());
  const [pick, setPick] = useState('');
  const [tiers, setTiers] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 5000); };

  // §40: the table lists what is sent or to be sent; accepted ones sit on their own tab
  const shown = applyFilters(rows, f).filter((r) => (f.status ? true : r.status !== 'accepted'));
  const row = rows.find((r) => r.sku.id === pick) || null;
  useEffect(() => { if (row) setTiers(row.tiers.map((t) => ({ qty: String(t.qty), price: String(t.price) }))); }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (i, delta) => setTiers((xs) => xs.map((x, j) => {
    if (j !== i) return x;
    const floor = row ? floorFor(row.desk, n(x.qty)) : null;
    const next = Math.round((n(x.price) + delta) * 100) / 100;
    return { ...x, price: String(floor != null ? Math.max(floor, next) : Math.max(0, next)) };
  }));
  // 30.09 QT3: "the rep can only increase … never below the quote-login amount". A
  // figure typed under the desk's springs back to it when the box is left.
  const clampToFloor = (i) => setTiers((xs) => xs.map((x, j) => {
    if (j !== i || !row) return x;
    const floor = floorFor(row.desk, n(x.qty));
    return floor != null && n(x.price) < floor - 1e-9 ? { ...x, price: String(floor) } : x;
  }));

  async function doSave(accept) {
    if (!row) return;
    setBusy(true);
    try {
      await save('sales', (prev) => {
        const cur = prev || {};
        let skus = saveRepQuote(cur.skus, row.sku.id, tiers, deskTiersForSku(cur, row.sku.id), { user: user || repId });
        if (accept) skus = setQuoteAccepted({ ...cur, skus }, row.sku.id, true);
        return { ...cur, skus };
      }, { retry: true });
      flash('g', accept ? `✓ ${row.sku.sku_name} — quote accepted at the saved slabs. It is on the Quote Accepted tab now.` : `✓ ${row.sku.sku_name} — quotation saved. Send it from the Send Quote tab.`);
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="card">
        <div className="ctitle">💬 Quotation — {row ? `${row.sku.sku_name} · ${row.name}` : 'pick a SKU below'}</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          The quote desk&rsquo;s price per MOQ is filled in. <b>Raise</b> a slab with the ▲ arrow (▼ comes back down, never below the
          desk&rsquo;s figure — a lower figure typed in springs back to it), then Save, or mark the quote accepted once the customer agrees.
        </div>
        {!row ? <div className="al al-b">Select the radio button beside a SKU in the list below.</div> : (
          <>
            {row.deskMoq > 0 && (
              <div style={{ fontSize: 12, marginBottom: 4 }} aria-label="Desk MOQ">
                Quote desk MOQ: <b>{qtyText(row.deskMoq)}</b>
                {row.deskItem && row.deskItem.item_code ? <span style={{ color: 'var(--i3)' }}> · item code {row.deskItem.item_code}</span> : null}
              </div>
            )}
            <div className="tw"><table>
              <thead><tr><th>MOQ (quantity)</th><th>Quote desk price</th><th style={{ width: 300 }}>Your price (₹ per unit, without GST)</th></tr></thead>
              <tbody>
                {tiers.map((t, i) => {
                  const floor = floorFor(row.desk, n(t.qty));
                  const under = floor != null && n(t.price) < floor - 1e-9;
                  return (
                    <tr key={i}>
                      <td><input type="number" min="0" value={t.qty} aria-label={`Slab ${i + 1} MOQ`} onChange={(e) => setTiers((xs) => xs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} style={{ width: 130 }} disabled={row.desk.length > 0} /></td>
                      <td style={{ fontWeight: 600 }}>{floor != null ? money(floor) : <span style={{ color: 'var(--i3)' }}>— (manual quotation)</span>}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button className="btn btn-s" style={{ height: 26, padding: '0 8px' }} aria-label={`Lower slab ${i + 1}`} onClick={() => step(i, -0.05)} disabled={floor != null && n(t.price) <= floor + 1e-9} title={floor != null ? 'Not below the quote desk\'s price' : ''}>▼</button>
                          <input type="number" min={floor != null ? floor : 0} step="0.05" value={t.price} aria-label={`Slab ${i + 1} price`}
                            onChange={(e) => setTiers((xs) => xs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                            onBlur={() => clampToFloor(i)}
                            style={{ width: 120, borderColor: under ? RED : undefined }} />
                          <button className="btn btn-s" style={{ height: 26, padding: '0 8px' }} aria-label={`Raise slab ${i + 1}`} onClick={() => step(i, 0.05)}>▲</button>
                          {under && <span style={{ fontSize: 10, color: RED }}>below the desk&rsquo;s {money(floor)}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            {row.desk.length === 0 && (
              <button className="btn btn-s" style={{ marginTop: 6 }} onClick={() => setTiers((xs) => [...xs, { qty: '', price: '' }])}>+ Add slab</button>
            )}
            <div className="act">
              <button className="btn btn-g" onClick={() => doSave(false)} disabled={busy}>💾 Save</button>
              <button className="btn btn-s" style={{ color: GREEN, fontWeight: 700 }} onClick={() => doSave(true)} disabled={busy}>✓ Quote Accepted</button>
              <span className="pg-sub" style={{ margin: 0 }}>Status: <span style={pill(row.status)}>{STATUS_LABEL[row.status]}</span>{row.deskQuote ? ` · desk quotation v${row.deskQuote.version || 1} of ${fmtDate(row.deskQuote.date)}` : ''}</span>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="ctitle">Quotations received <span className="tag tgr">{shown.length}</span></div>
        <Filters rows={rows} f={f} setF={setF} />
        <div className="tw sy" style={{ maxHeight: 360 }}>
          <table>
            <thead><tr><th style={{ width: 30 }}></th><th>SKU</th><th>Lead / Customer</th><th>Group</th><th>Despatch location</th><th>Price per MOQ</th><th>Status</th></tr></thead>
            <tbody>
              {shown.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No quotations yet — the quote desk sends them here once the CSA is done.</td></tr>
                : shown.map((r) => (
                  <tr key={r.sku.id} className={pick === r.sku.id ? 'hi' : undefined} style={{ background: pick === r.sku.id ? undefined : ROW_TINT[r.status] }} data-status={r.status}>
                    <td style={{ textAlign: 'center' }}><input type="radio" name="quote-pick" checked={pick === r.sku.id} aria-label={`Quote ${r.sku.sku_name}`} onChange={() => setPick(r.sku.id)} /></td>
                    <td style={{ fontWeight: 700, color: skuColor(r.status) }} aria-label={`SKU ${r.sku.sku_name}`}>{r.sku.sku_name}</td>
                    <td>{r.name} <span style={{ fontSize: 10, color: 'var(--i3)' }}>({r.isCust ? 'customer' : 'lead'})</span></td>
                    <td style={{ fontSize: 11 }}>{r.group || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.location || '—'}</td>
                    <td style={{ fontSize: 11 }}>{tiersText(r.tiers) || '—'}</td>
                    <td><span style={pill(r.status)}>{STATUS_LABEL[r.status]}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="ctitle">💬 Discuss with the quote desk</div>
        <NegoPanel side="rep" skuIds={rows.map((r) => r.sku.id)} />
      </div>
    </>
  );
}

/* ─────────────────────────── Send Quote ─────────────────────────── */
export function RepSendQuoteTab({ sales, save, repId }) {
  const { user } = useAuth() || {};
  const { rows, book } = useQuoteRows(sales, repId);
  useFreshModule('sales');
  const [f, setF] = useState(blankF());
  const [checked, setChecked] = useState({});
  const [prep, setPrep] = useState(null);      // the quotation being prepared
  const [history, setHistory] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 5000); };
  const ref = useRef(null);

  // §49-50: the checkboxes wake up once a customer (or lead) is chosen — a group or
  // despatch location alone is not enough to say who the quote goes to.
  const shown = applyFilters(rows, f).filter((r) => r.status !== 'accepted');
  const targeted = !!(f.customer || f.lead);
  const picked = shown.filter((r) => checked[r.sku.id]);
  useEffect(() => { setChecked({}); }, [f.group, f.customer, f.lead, f.location]);

  /**
   * 30.09 QT4: the quotation is the desk's line for each SKU — item code, anti-fog,
   * specifications, MOQ, plate charges, GST — at the rep's slabs. Built from the rep's
   * slabs alone it printed blank specification and MOQ columns and lost the plates.
   */
  function prepare() {
    if (!picked.length) { flash('r', 'Tick at least one SKU.'); return; }
    const lead = picked[0].lead;
    const lastDesk = picked.map((r) => r.deskQuote).filter(Boolean).sort((a, b) => (b.version || 1) - (a.version || 1))[0];
    const sent = (sales.skus || []).filter((s) => s.lead_id === (lead && lead.id)).reduce((m, s) => Math.max(m, (s.quote_history || []).length), 0);
    setPrep({
      id: 'rep_' + Date.now(), lead_id: lead ? lead.id : '', client_name: lead ? lead.client_name : picked[0].name, date: new Date().toISOString().slice(0, 10),
      version: sent + 1, status: 'draft', created_by: repId,
      items: picked.map((r) => {
        const di = r.deskItem || {};
        const gst = di.gst_pct !== '' && di.gst_pct != null && Number(di.gst_pct) >= 0 ? Number(di.gst_pct) : DEFAULT_GST_PCT;
        return {
          ...di,
          sku_id: r.sku.id, sku_name: r.sku.sku_name, category: r.sku.category, dispatch_form: r.sku.dispatch_form,
          gst_pct: gst, moq: di.moq || (r.tiers[0] && r.tiers[0].qty ? qtyText(r.tiers[0].qty) : ''), plate: di.plate || {},
          tiers: r.tiers.map((t) => buildTier(t.qty, t.price, gst)).filter(Boolean),
        };
      }),
      fine_print: lastDesk ? lastDesk.fine_print : undefined, notes: lastDesk ? lastDesk.notes : '',
    });
  }
  async function sendQuote() {
    setBusy(true);
    try {
      const ids = prep.items.map((i) => i.sku_id);
      await save('sales', (prev) => ({ ...(prev || {}), skus: markQuotesSent(prev || {}, ids, { user: user || repId }) }), { retry: true });
      flash('g', `✓ Quote sent for ${ids.length} SKU(s) to ${prep.client_name}. The Quotations table now reads "Sent".`);
      setPrep(null); setChecked({});
    } catch (e) { flash('r', e.code === 'conflict' ? 'Save failed: ' + e.message : e.message); setPrep(null); } finally { setBusy(false); }
  }
  async function accept(r, yes) {
    setBusy(true);
    try {
      await save('sales', (prev) => ({ ...(prev || {}), skus: setQuoteAccepted(prev || {}, r.sku.id, yes) }), { retry: true });
      flash('g', yes ? `✓ ${r.sku.sku_name} moved to Quote Accepted.` : `${r.sku.sku_name} is back to ${r.sku.quotation_sent ? 'sent' : 'to be sent'}.`);
    } catch (e) { flash('r', e.code === 'conflict' ? 'Save failed: ' + e.message : e.message); } finally { setBusy(false); }
  }

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>📤 Send Quote <span className="tag tgr">{shown.length}</span></div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-g" onClick={prepare} disabled={!picked.length || busy}>🧾 Prepare Quote ({picked.length})</button>
        </div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Narrow the list group → customer (or lead) → despatch location — the customer alone is enough — tick the SKUs, then Prepare Quote:
          the quotation opens with Download as PDF, and <b>Sent Quote</b> flips the status. To change an amount go back to Quotations, save, and send again.
        </div>
        <Filters rows={rows} f={f} setF={setF} withStatus={false} withLocation />
        {!targeted && <div className="al al-y">Select a customer or a lead to enable the checkboxes.</div>}
        <div className="tw sy" style={{ maxHeight: 420 }}>
          <table>
            <thead><tr><th style={{ width: 30 }}></th><th>SKU</th><th>Lead / Customer</th><th>Group</th><th>Despatch location</th><th>Price per MOQ</th><th>Status</th><th>Quote accepted?</th><th>History</th></tr></thead>
            <tbody>
              {shown.length === 0 ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>Nothing to send.</td></tr>
                : shown.map((r) => (
                  <tr key={r.sku.id} style={{ background: ROW_TINT[r.status] }} data-status={r.status}>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" disabled={!targeted} checked={!!checked[r.sku.id]} aria-label={`Send ${r.sku.sku_name}`} onChange={(e) => setChecked((c) => ({ ...c, [r.sku.id]: e.target.checked }))} /></td>
                    <td style={{ fontWeight: 700, color: skuColor(r.status) }}>{r.sku.sku_name}</td>
                    <td>{r.name}</td>
                    <td style={{ fontSize: 11 }}>{r.group || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.location || '—'}</td>
                    <td style={{ fontSize: 11 }}>{tiersText(r.tiers) || '—'}</td>
                    <td><span style={pill(r.status)}>{STATUS_LABEL[r.status]}</span></td>
                    <td>
                      <AcceptToggle on={r.status === 'accepted'} label={`Quote accepted ${r.sku.sku_name}`} disabled={busy}
                        onChange={(yes) => { if (yes) accept(r, true); }} />
                    </td>
                    {/* 30.09 QT4: a history link on every row, read-only */}
                    <td>
                      <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px', whiteSpace: 'nowrap' }} aria-label={`Quote history ${r.sku.sku_name}`} onClick={() => setHistory(r)}>
                        🕘 History{(r.sku.quote_history || []).length ? ` (${(r.sku.quote_history || []).length})` : ''}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {prep && (
        <div style={overlay} onClick={() => setPrep(null)}>
          <div style={{ ...sheet, maxWidth: 900 }} onClick={(e) => e.stopPropagation()} aria-label="Prepared quotation">
            <div className="fbar">
              <div className="ctitle" style={{ margin: 0 }}>Quotation — {prep.client_name} · {prep.items.length} SKU(s)</div>
              <span style={{ flex: 1 }} />
              <button className="btn btn-s" onClick={() => printElement(ref.current)}>🖨 Print</button>
              <button className="btn btn-s" onClick={() => elementToPDF(ref.current, `Quotation_${String(prep.client_name).replace(/[^\w-]+/g, '_')}_v${prep.version}`)}>⬇ Download as PDF</button>
              <button className="btn btn-g" onClick={sendQuote} disabled={busy}>📤 Sent Quote</button>
              <button className="btn btn-s" onClick={() => setPrep(null)}>Close</button>
            </div>
            <div style={{ overflow: 'auto', maxHeight: '75vh', border: '1px solid var(--bd)' }}>
              <QuotationDoc quote={prep} innerRef={ref} />
            </div>
          </div>
        </div>
      )}

      {history && (
        <div style={overlay} onClick={() => setHistory(null)}>
          <div style={sheet} onClick={(e) => e.stopPropagation()} aria-label="Quote history">
            <div className="fbar">
              <div className="ctitle" style={{ margin: 0 }}>🕘 Quotes sent — {history.sku.sku_name} · {history.name}</div>
              <span style={{ flex: 1 }} />
              <button className="btn btn-s" onClick={() => setHistory(null)}>Close</button>
            </div>
            {/* 30.09 QT4: "amount, MOQ, sent date" — one line per slab of each send */}
            <div className="tw"><table>
              <thead><tr><th>Sent on</th><th>Version</th><th style={{ textAlign: 'right' }}>MOQ</th><th style={{ textAlign: 'right' }}>Amount (₹ per unit)</th></tr></thead>
              <tbody>
                {(history.sku.quote_history || []).length === 0
                  ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 14, color: 'var(--i3)' }}>No quotes sent yet.</td></tr>
                  : (history.sku.quote_history || []).flatMap((h, i) => {
                    const slabs = (h.tiers || []).length ? h.tiers : [{ qty: '', price: '' }];
                    return slabs.map((t, j) => (
                      <tr key={i + '-' + j}>
                        <td>{j === 0 ? fmtDate(String(h.sent_at || '').slice(0, 10)) : ''}</td>
                        <td>{j === 0 ? `v${h.version || (history.sku.quote_history.length - i)}` : ''}</td>
                        <td style={{ textAlign: 'right' }}>{t.qty !== '' ? qtyText(t.qty) : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{t.price !== '' ? money(t.price) : '—'}</td>
                      </tr>
                    ));
                  })}
              </tbody>
            </table></div>
            <div className="pg-sub">Read-only. To change an amount, edit it on the Quotations tab and send again.</div>
          </div>
        </div>
      )}
      <span hidden aria-hidden="true">{book.leads.length}</span>
    </>
  );
}

/* ─────────────────────────── Quote Accepted ─────────────────────────── */
export function RepAcceptedTab({ sales, save, repId }) {
  const { user } = useAuth() || {};
  const { rows, book, customers } = useQuoteRows(sales, repId);
  useFreshModule('sales');
  const [f, setF] = useState(blankAcceptedF());
  const [manual, setManual] = useState({ kind: 'customer', leadId: '', skuId: '', tiers: [{ qty: '', price: '' }] });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 5000); };

  // 30.09 QT5: read-only, a filter on every column header
  const accepted = useMemo(() => rows.filter((r) => r.status === 'accepted').map((r) => acceptedRow(r)), [rows]);
  const shown = accepted.filter((a) => ACCEPTED_COLS.every((c) => !f[c.k] || c.match(a, f[c.k])));

  // §60: a quotation entered by hand for a customer already past the CSA / already
  // quoted, when the desk's figure is not on file here.
  const manualSkus = (sales.skus || []).filter((sk) => sk.lead_id === manual.leadId && !sk.quotation_accepted);
  // 30.09 QT5: "for already-CSA'd / accepted customers" — a SKU whose CSA is done or
  // that has been quoted, never one still waiting on QC
  const manualOffer = manualSkus.filter((sk) => skuCsaDone(sales, sk) || (sk.quote_history || []).length > 0 || deskTiersForSku(sales, sk.id).length > 0);
  const manualDesk = manual.skuId ? deskTiersForSku(sales, manual.skuId) : [];
  // the desk's slabs (or its MOQ) come in with the SKU — the floor the hand-written
  // figure may not go under
  useEffect(() => {
    if (!manual.skuId) return;
    const desk = deskTiersForSku(sales, manual.skuId);
    const di = deskItemForSku(sales, manual.skuId);
    const moq = di ? parseMoq(di.moq) : 0;
    setManual((m) => ({
      ...m,
      tiers: desk.length ? desk.map((t) => ({ qty: String(t.qty), price: String(t.price) })) : [{ qty: moq ? String(moq) : '', price: '' }],
    }));
  }, [manual.skuId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function addManual() {
    setBusy(true);
    try {
      if (!manual.skuId) throw new Error('Pick the SKU.');
      if (manual.tiers.some((t) => String(t.price).trim() !== '' && !(n(t.qty) > 0))) throw new Error('Enter the MOQ for every slab — the PO is priced by it.');
      await save('sales', (prev) => {
        const cur = prev || {};
        const skus = saveRepQuote(cur.skus, manual.skuId, manual.tiers, deskTiersForSku(cur, manual.skuId), { user: user || repId });
        return { ...cur, skus: setQuoteAccepted({ ...cur, skus }, manual.skuId, true) };
      }, { retry: true });
      flash('g', '✓ Quotation recorded and marked accepted.');
      setManual({ kind: manual.kind, leadId: '', skuId: '', tiers: [{ qty: '', price: '' }] });
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>✅ Quote Accepted <span className="tag tgr">{shown.length}</span></div>
          <span style={{ flex: 1 }} />
          {ACCEPTED_COLS.some((c) => f[c.k]) && <button className="btn btn-s" style={{ height: 26, fontSize: 11 }} onClick={() => setF(blankAcceptedF())}>✕ Clear filters</button>}
        </div>
        <div className="pg-sub" style={{ marginTop: 0 }}>Read-only. QC creates the JSS from these; the PO is entered against them. Filter under any column header.</div>
        <div className="tw sy" style={{ maxHeight: 380 }}>
          <table aria-label="Accepted quotations">
            <thead>
              <tr>{ACCEPTED_COLS.map((c) => <th key={c.k}>{c.label}</th>)}</tr>
              <tr aria-label="Column filters">
                {ACCEPTED_COLS.map((c) => (
                  <th key={c.k} style={{ padding: '2px 4px', fontWeight: 400 }}>
                    <select value={f[c.k]} aria-label={c.aria} onChange={(e) => setF({ ...f, [c.k]: e.target.value })} style={{ width: '100%', minWidth: 80, height: 24, fontSize: 11 }}>
                      <option value="">All</option>
                      {c.options(accepted).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? <tr><td colSpan={ACCEPTED_COLS.length} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>{accepted.length ? 'Nothing matches the filters.' : 'No accepted quotations yet.'}</td></tr>
                : shown.map((a) => (
                  <tr key={a.r.sku.id}>
                    <td style={{ fontWeight: 700 }}>{a.r.name}{a.r.group ? <span style={{ fontSize: 10, color: 'var(--i3)' }}> · {a.r.group}</span> : null}</td>
                    <td>{a.r.sku.sku_name}</td>
                    <td style={{ fontSize: 11 }}>{a.r.location || '—'}</td>
                    <td style={{ fontSize: 11 }}>{a.price || '—'}</td>
                    <td style={{ fontSize: 11 }}>{a.moq || '—'}</td>
                    <td style={{ fontSize: 11 }}>
                      {a.r.sku.jss_spec ? <span className="tag tg">{a.r.sku.jss_spec}</span>
                        : <span style={{ color: '#a07800' }}>{a.jss}</span>}
                    </td>
                    <td style={{ fontSize: 11 }}>{a.on || '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" aria-label="Add quotation by hand">
        <div className="ctitle">＋ Add a quotation for a customer already past the CSA</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>For a customer whose CSA report is done, or who was quoted outside the desk: record the agreed slabs and it lands above as accepted.</div>
        <div className="g4">
          {/* 30.09 §SL3: the same Lead / Customer control as every other rep form — the
              radios on their own row above, the dropdown in line with the fields. */}
          <LeadCustomerPicker book={book} kind={manual.kind} leadId={manual.leadId}
            onKind={(k) => setManual((m) => ({ ...m, kind: k, leadId: '', skuId: '' }))}
            onLead={(id) => setManual((m) => ({ ...m, leadId: id, skuId: '' }))} ariaPrefix="Manual" />
          <div className="fg"><label>SKU</label>
            <select value={manual.skuId} aria-label="Manual quotation SKU" onChange={(e) => setManual({ ...manual, skuId: e.target.value })}>
              <option value="">— Select —</option>
              {manualOffer.map((sk) => <option key={sk.id} value={sk.id}>{sk.sku_name}</option>)}
            </select>
            {manual.leadId && manualOffer.length === 0 && (
              <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>No SKU of this party is past its CSA or quoted yet.</div>
            )}
          </div>
          <div className="fg" style={{ gridColumn: 'span 2' }}><label>Slabs (₹ per unit @ MOQ *)</label>
            {manual.tiers.map((t, i) => {
              const floor = floorFor(manualDesk, n(t.qty));
              return (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                  <input type="number" placeholder="price" value={t.price} aria-label={`Manual slab ${i + 1} price`} onChange={(e) => setManual({ ...manual, tiers: manual.tiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })} style={{ width: 120 }} />
                  <input type="number" placeholder="MOQ *" min="1" value={t.qty} aria-label={`Manual slab ${i + 1} MOQ`} onChange={(e) => setManual({ ...manual, tiers: manual.tiers.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} style={{ width: 120 }} />
                  {floor != null && <span style={{ fontSize: 10, color: n(t.price) < floor - 1e-9 ? RED : 'var(--i3)' }}>desk floor {money(floor)}</span>}
                </div>
              );
            })}
            <button className="btn btn-s" style={{ height: 24, fontSize: 10 }} onClick={() => setManual({ ...manual, tiers: [...manual.tiers, { qty: '', price: '' }] })}>+ slab</button>
          </div>
        </div>
        <div className="act"><button className="btn btn-g" onClick={addManual} disabled={busy}>✓ Record as accepted</button></div>
      </div>
      <span hidden aria-hidden="true">{customers.length}</span>
    </>
  );
}

/**
 * One Quote Accepted line, with each column's text worked out once — the cell and
 * its header filter read the same words. The JSS column says why there is no JSS
 * yet: QC only sees a CSA once the Super Admin has converted the lead (30.09 QT5).
 */
function acceptedRow(r) {
  const tiers = (r.sku.price_tiers && r.sku.price_tiers.length ? r.sku.price_tiers : r.tiers) || [];
  return {
    r,
    party: [r.name, r.group].filter(Boolean),
    price: tiers.map((t) => money(t.price)).join(' · '),
    moq: tiers.map((t) => (n(t.qty) ? qtyText(t.qty) : 'any')).join(' · '),
    jss: String(r.sku.jss_spec || '').trim() || (isCustomerLead(r.lead) ? 'awaiting QC' : 'awaiting Super Admin conversion'),
    on: r.sku.quotation_accepted_at ? fmtDate(String(r.sku.quotation_accepted_at).slice(0, 10)) : '',
  };
}
const uniqSorted = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
// Customer / Group offers the customer names AND the group names; a group picks
// every customer under it.
const ACCEPTED_COLS = [
  { k: 'party', label: 'Customer / Group', aria: 'Filter accepted by customer', options: (rows) => uniqSorted(rows.flatMap((a) => a.party)), match: (a, v) => a.party.includes(v) },
  { k: 'sku', label: 'SKU', aria: 'Filter accepted by SKU', options: (rows) => uniqSorted(rows.map((a) => a.r.sku.sku_name)), match: (a, v) => a.r.sku.sku_name === v },
  { k: 'location', label: 'Despatch location', aria: 'Filter accepted by despatch location', options: (rows) => uniqSorted(rows.map((a) => a.r.location)), match: (a, v) => a.r.location === v },
  { k: 'price', label: 'Price', aria: 'Filter accepted by price', options: (rows) => uniqSorted(rows.map((a) => a.price)), match: (a, v) => a.price === v },
  { k: 'moq', label: 'MOQ', aria: 'Filter accepted by MOQ', options: (rows) => uniqSorted(rows.map((a) => a.moq)), match: (a, v) => a.moq === v },
  { k: 'jss', label: 'JSS', aria: 'Filter accepted by JSS', options: (rows) => uniqSorted(rows.map((a) => a.jss)), match: (a, v) => a.jss === v },
  { k: 'on', label: 'Accepted on', aria: 'Filter accepted by date', options: (rows) => uniqSorted(rows.map((a) => a.on)), match: (a, v) => a.on === v },
];
const blankAcceptedF = () => Object.fromEntries(ACCEPTED_COLS.map((c) => [c.k, '']));

const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 9600, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '32px 12px' };
const sheet = { background: 'var(--wh)', borderRadius: 12, maxWidth: 640, width: '100%', padding: '20px 22px', boxShadow: '0 20px 60px rgba(0,0,0,.3)', margin: 'auto' };
