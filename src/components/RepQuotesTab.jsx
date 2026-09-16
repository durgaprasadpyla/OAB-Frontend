import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { fmtDate } from '../lib/format.js';
import { custGroupOf } from '../lib/master.js';
import { QuotationDoc } from '../pages/QuotationDesk.jsx';
import { elementToPDF, printElement } from '../lib/pdf.js';
import NegoPanel from './NegoPanel.jsx';
import {
  repBook, deskTiersForSku, deskQuoteForSku, repTiersForSku, floorFor, saveRepQuote,
  quoteStatusOf, quotableSkus, markQuotesSent, setQuoteAccepted, despatchLocationsFor,
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
const STATUS_LABEL = { to_send: 'To be sent', sent: 'Sent', accepted: 'Accepted', none: '—' };
const STATUS_STYLE = {
  to_send: { background: '#fde8e8', color: '#c0392b' },
  sent: { background: '#e3f7e9', color: '#0e6fb8' },
  accepted: { background: '#e3f7e9', color: 'var(--g)' },
};
const pill = (st) => ({ ...(STATUS_STYLE[st] || {}), padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700, display: 'inline-block' });

/** The rows all three tabs share: SKU + lead + group + status + prices. */
function useQuoteRows(sales, repId) {
  const { mods } = useData();
  const customers = mods.customers || [];
  const book = useMemo(() => repBook(sales, customers, repId), [sales, customers, repId]);
  const bookIds = useMemo(() => new Set([...book.leads, ...book.customers].map((l) => l.id)), [book]);
  const rows = useMemo(() => quotableSkus(sales, repId, bookIds).map((sku) => {
    const lead = (sales.leads || []).find((l) => l.id === sku.lead_id) || null;
    const isCust = book.customers.some((l) => l.id === sku.lead_id);
    const desk = deskTiersForSku(sales, sku.id);
    const tiers = repTiersForSku(sku, desk);
    const group = lead ? (custGroupOf(lead.client_name, customers) || lead.group || '') : '';
    return {
      sku, lead, isCust, name: lead ? lead.client_name : '—', group, desk, tiers,
      status: quoteStatusOf(sales, sku), location: despatchLocationsFor(lead, customers)[0] || (sku.csa_request || {}).despatch_location || '',
      deskQuote: deskQuoteForSku(sales, sku.id),
    };
  }), [sales, repId, bookIds, book, customers]);
  return { rows, book, customers };
}

function Filters({ rows, f, setF, withStatus = true, withLocation = false }) {
  const uniq = (list) => [...new Set(list.filter(Boolean))].sort();
  return (
    <div className="fbar" style={{ flexWrap: 'wrap' }}>
      <select value={f.group} aria-label="Filter by group" onChange={(e) => setF({ ...f, group: e.target.value, customer: '' })}>
        <option value="">All groups</option>
        {uniq(rows.map((r) => r.group)).map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      <select value={f.customer} aria-label="Filter by customer" onChange={(e) => setF({ ...f, customer: e.target.value })}>
        <option value="">All customers</option>
        {uniq(rows.filter((r) => r.isCust && (!f.group || r.group === f.group)).map((r) => r.name)).map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={f.lead} aria-label="Filter by lead" onChange={(e) => setF({ ...f, lead: e.target.value })}>
        <option value="">All leads</option>
        {uniq(rows.filter((r) => !r.isCust).map((r) => r.name)).map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {withLocation && (
        <select value={f.location} aria-label="Filter by despatch location" onChange={(e) => setF({ ...f, location: e.target.value })}>
          <option value="">All despatch locations</option>
          {uniq(rows.map((r) => r.location)).map((c) => <option key={c} value={c}>{c}</option>)}
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
const applyFilters = (rows, f) => rows.filter((r) => (
  (!f.group || r.group === f.group) && (!f.customer || (r.isCust && r.name === f.customer)) && (!f.lead || (!r.isCust && r.name === f.lead))
  && (!f.location || r.location === f.location) && (!f.status || r.status === f.status)
));
const blankF = () => ({ group: '', customer: '', lead: '', location: '', status: '' });

/* ─────────────────────────── Quotations ─────────────────────────── */
export function RepQuotationsTab({ sales, save, repId }) {
  const { user } = useAuth() || {};
  const { rows } = useQuoteRows(sales, repId);
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

  async function doSave(accept) {
    if (!row) return;
    setBusy(true);
    try {
      await save('sales', (prev) => {
        const cur = prev || {};
        let skus = saveRepQuote(cur.skus, row.sku.id, tiers, deskTiersForSku(cur, row.sku.id), { user: user || repId });
        if (accept) skus = setQuoteAccepted({ ...cur, skus }, row.sku.id, true);
        return { ...cur, skus };
      });
      flash('g', accept ? `✓ ${row.sku.sku_name} — quote accepted at the saved slabs. It is on the Quote Accepted tab now.` : `✓ ${row.sku.sku_name} — quotation saved. Send it from the Send Quote tab.`);
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="card">
        <div className="ctitle">💬 Quotation — {row ? `${row.sku.sku_name} · ${row.name}` : 'pick a SKU below'}</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          The quote desk&rsquo;s price per MOQ is filled in. You may <b>raise</b> a slab with the arrows or by typing — never below the
          desk&rsquo;s figure — then Save, or mark the quote accepted once the customer agrees.
        </div>
        {!row ? <div className="al al-b">Select the radio button beside a SKU in the list below.</div> : (
          <>
            <div className="tw"><table>
              <thead><tr><th>MOQ (quantity)</th><th>Quote desk price</th><th style={{ width: 260 }}>Your price (₹ per unit, without GST)</th></tr></thead>
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
                            onChange={(e) => setTiers((xs) => xs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} style={{ width: 120, borderColor: under ? 'var(--red)' : undefined }} />
                          <button className="btn btn-s" style={{ height: 26, padding: '0 8px' }} aria-label={`Raise slab ${i + 1}`} onClick={() => step(i, 0.05)}>▲</button>
                          {under && <span style={{ fontSize: 10, color: 'var(--red)' }}>below the desk&rsquo;s {money(floor)}</span>}
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
              <button className="btn btn-s" style={{ color: 'var(--g)', fontWeight: 700 }} onClick={() => doSave(true)} disabled={busy}>✓ Quote Accepted</button>
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
                  <tr key={r.sku.id} className={pick === r.sku.id ? 'hi' : undefined}>
                    <td style={{ textAlign: 'center' }}><input type="radio" name="quote-pick" checked={pick === r.sku.id} aria-label={`Quote ${r.sku.sku_name}`} onChange={() => setPick(r.sku.id)} /></td>
                    <td style={{ fontWeight: 700, color: r.status === 'sent' || r.status === 'accepted' ? 'var(--g)' : 'var(--red)' }}>{r.sku.sku_name}</td>
                    <td>{r.name} <span style={{ fontSize: 10, color: 'var(--i3)' }}>({r.isCust ? 'customer' : 'lead'})</span></td>
                    <td style={{ fontSize: 11 }}>{r.group || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.location || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.tiers.map((t) => `${money(t.price)} @ ${t.qty}`).join(' · ') || '—'}</td>
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
  useEffect(() => { setChecked({}); }, [f.customer, f.lead]);

  function prepare() {
    if (!picked.length) { flash('r', 'Tick at least one SKU.'); return; }
    const lead = picked[0].lead;
    const lastDesk = picked.map((r) => r.deskQuote).filter(Boolean).sort((a, b) => (b.version || 1) - (a.version || 1))[0];
    const sent = (sales.skus || []).filter((s) => s.lead_id === (lead && lead.id)).reduce((m, s) => Math.max(m, (s.quote_history || []).length), 0);
    setPrep({
      id: 'rep_' + Date.now(), lead_id: lead ? lead.id : '', client_name: lead ? lead.client_name : picked[0].name, date: new Date().toISOString().slice(0, 10),
      version: sent + 1, status: 'draft', created_by: repId,
      items: picked.map((r) => ({ sku_id: r.sku.id, sku_name: r.sku.sku_name, category: r.sku.category, dispatch_form: r.sku.dispatch_form,
        tiers: r.tiers.map((t) => ({ qty: t.qty, price_wo_gst: t.price, gst_pct: 18, gst_amt: Math.round(t.price * 18) / 100, price_w_gst: Math.round((t.price * 1.18) * 100) / 100 })) })),
      fine_print: lastDesk ? lastDesk.fine_print : undefined, notes: lastDesk ? lastDesk.notes : '',
    });
  }
  async function sendQuote() {
    setBusy(true);
    try {
      const ids = prep.items.map((i) => i.sku_id);
      await save('sales', (prev) => ({ ...(prev || {}), skus: markQuotesSent(prev || {}, ids, { user: user || repId }) }));
      flash('g', `✓ Quote sent for ${ids.length} SKU(s) to ${prep.client_name}. The Quotations table now reads "Sent".`);
      setPrep(null); setChecked({});
    } catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
  }
  async function accept(r, yes) {
    setBusy(true);
    try {
      await save('sales', (prev) => ({ ...(prev || {}), skus: setQuoteAccepted(prev || {}, r.sku.id, yes) }));
      flash('g', yes ? `✓ ${r.sku.sku_name} moved to Quote Accepted.` : `${r.sku.sku_name} is back to ${r.sku.quotation_sent ? 'sent' : 'to be sent'}.`);
    } catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
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
          Pick the customer (a group or despatch location narrows the list), tick the SKUs, then Prepare Quote — the quotation opens with
          Download as PDF, and <b>Sent Quote</b> flips the status. To change an amount go back to Quotations, save, and send again.
        </div>
        <Filters rows={rows} f={f} setF={setF} withStatus={false} withLocation />
        {!targeted && <div className="al al-y">Select a customer or a lead to enable the checkboxes.</div>}
        <div className="tw sy" style={{ maxHeight: 420 }}>
          <table>
            <thead><tr><th style={{ width: 30 }}></th><th>SKU</th><th>Lead / Customer</th><th>Group</th><th>Despatch location</th><th>Price per MOQ</th><th>Status</th><th>History</th><th>Quote accepted?</th></tr></thead>
            <tbody>
              {shown.length === 0 ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>Nothing to send.</td></tr>
                : shown.map((r) => (
                  <tr key={r.sku.id}>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" disabled={!targeted} checked={!!checked[r.sku.id]} aria-label={`Send ${r.sku.sku_name}`} onChange={(e) => setChecked((c) => ({ ...c, [r.sku.id]: e.target.checked }))} /></td>
                    <td style={{ fontWeight: 700, color: r.status === 'sent' ? 'var(--g)' : 'var(--red)' }}>{r.sku.sku_name}</td>
                    <td>{r.name}</td>
                    <td style={{ fontSize: 11 }}>{r.group || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.location || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.tiers.map((t) => `${money(t.price)} @ ${t.qty}`).join(' · ') || '—'}</td>
                    <td><span style={pill(r.status)}>{STATUS_LABEL[r.status]}</span></td>
                    <td>{(r.sku.quote_history || []).length ? <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }} aria-label={`Quote history ${r.sku.sku_name}`} onClick={() => setHistory(r)}>🕘 {(r.sku.quote_history || []).length}</button> : <span style={{ color: 'var(--i3)' }}>—</span>}</td>
                    <td>
                      <select value="no" aria-label={`Quote accepted ${r.sku.sku_name}`} disabled={busy} style={{ height: 26, fontSize: 11 }}
                        onChange={(e) => { if (e.target.value === 'yes') accept(r, true); }}>
                        <option value="no">No</option>
                        <option value="yes">Yes — accepted</option>
                      </select>
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
            <div className="tw"><table>
              <thead><tr><th>Sent on</th><th>Version</th><th>Amount per MOQ</th><th>By</th></tr></thead>
              <tbody>
                {(history.sku.quote_history || []).map((h, i) => (
                  <tr key={i}>
                    <td>{fmtDate(String(h.sent_at || '').slice(0, 10))}</td>
                    <td>v{h.version || (history.sku.quote_history.length - i)}</td>
                    <td style={{ fontSize: 11 }}>{(h.tiers || []).map((t) => `${money(t.price)} @ ${t.qty}`).join(' · ')}</td>
                    <td style={{ fontSize: 11 }}>{h.sent_by || '—'}</td>
                  </tr>
                ))}
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
  const [f, setF] = useState({ customer: '', sku: '', location: '' });
  const [manual, setManual] = useState({ kind: 'customer', leadId: '', skuId: '', tiers: [{ qty: '', price: '' }] });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 5000); };

  const accepted = rows.filter((r) => r.status === 'accepted');
  const uniq = (list) => [...new Set(list.filter(Boolean))].sort();
  const shown = accepted.filter((r) => (!f.customer || r.name === f.customer) && (!f.sku || r.sku.sku_name === f.sku) && (!f.location || r.location === f.location));

  // §60: a quotation entered by hand for a customer already past the CSA / already
  // quoted, when the desk's figure is not on file here.
  const manualLeads = manual.kind === 'customer' ? book.customers : book.leads;
  const manualSkus = (sales.skus || []).filter((sk) => sk.lead_id === manual.leadId && !sk.quotation_accepted);
  async function addManual() {
    setBusy(true);
    try {
      if (!manual.skuId) throw new Error('Pick the SKU.');
      await save('sales', (prev) => {
        const cur = prev || {};
        const skus = saveRepQuote(cur.skus, manual.skuId, manual.tiers, [], { user: user || repId });
        return { ...cur, skus: setQuoteAccepted({ ...cur, skus }, manual.skuId, true) };
      });
      flash('g', '✓ Quotation recorded and marked accepted.');
      setManual({ kind: manual.kind, leadId: '', skuId: '', tiers: [{ qty: '', price: '' }] });
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="card">
        <div className="ctitle">✅ Quote Accepted <span className="tag tgr">{shown.length}</span></div>
        <div className="pg-sub" style={{ marginTop: 0 }}>Read-only. QC creates the JSS from these; the PO is entered against them.</div>
        <div className="fbar" style={{ flexWrap: 'wrap' }}>
          <select value={f.customer} aria-label="Filter accepted by customer" onChange={(e) => setF({ ...f, customer: e.target.value })}>
            <option value="">All customers / groups</option>
            {uniq(accepted.map((r) => r.name)).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={f.sku} aria-label="Filter accepted by SKU" onChange={(e) => setF({ ...f, sku: e.target.value })}>
            <option value="">All SKUs</option>
            {uniq(accepted.map((r) => r.sku.sku_name)).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={f.location} aria-label="Filter accepted by despatch location" onChange={(e) => setF({ ...f, location: e.target.value })}>
            <option value="">All despatch locations</option>
            {uniq(accepted.map((r) => r.location)).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="tw sy" style={{ maxHeight: 380 }}>
          <table>
            <thead><tr><th>Customer / Group</th><th>SKU</th><th>Despatch location</th><th>Price</th><th>MOQ</th><th>JSS</th><th>Accepted on</th></tr></thead>
            <tbody>
              {shown.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No accepted quotations yet.</td></tr>
                : shown.map((r) => (
                  <tr key={r.sku.id}>
                    <td style={{ fontWeight: 700 }}>{r.name}{r.group && r.group !== r.name ? <span style={{ fontSize: 10, color: 'var(--i3)' }}> · {r.group}</span> : null}</td>
                    <td>{r.sku.sku_name}</td>
                    <td style={{ fontSize: 11 }}>{r.location || '—'}</td>
                    <td style={{ fontSize: 11 }}>{(r.sku.price_tiers || r.tiers).map((t) => money(t.price)).join(' · ')}</td>
                    <td style={{ fontSize: 11 }}>{(r.sku.price_tiers || r.tiers).map((t) => t.qty).join(' · ')}</td>
                    <td style={{ fontSize: 11 }}>{r.sku.jss_spec ? <span className="tag tg">{r.sku.jss_spec}</span> : <span style={{ color: '#c9a100' }}>awaiting QC</span>}</td>
                    <td style={{ fontSize: 11 }}>{r.sku.quotation_accepted_at ? fmtDate(String(r.sku.quotation_accepted_at).slice(0, 10)) : '—'}</td>
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
          <div className="fg"><label>Lead / Customer</label>
            <div style={{ display: 'flex', gap: 12, fontSize: 12, marginBottom: 4 }}>
              {[['customer', 'Customer'], ['lead', 'Lead']].map(([v, l]) => (
                <label key={v} className="cb"><input type="radio" name="manual-kind" checked={manual.kind === v} aria-label={`Manual ${l}`} onChange={() => setManual({ ...manual, kind: v, leadId: '', skuId: '' })} /><span>{l}</span></label>
              ))}
            </div>
            <select value={manual.leadId} aria-label="Manual quotation customer" onChange={(e) => setManual({ ...manual, leadId: e.target.value, skuId: '' })}>
              <option value="">— Select —</option>
              {manualLeads.map((l) => <option key={l.id} value={l.id}>{l.client_name}</option>)}
            </select>
          </div>
          <div className="fg"><label>SKU</label>
            <select value={manual.skuId} aria-label="Manual quotation SKU" onChange={(e) => setManual({ ...manual, skuId: e.target.value })}>
              <option value="">— Select —</option>
              {manualSkus.map((sk) => <option key={sk.id} value={sk.id}>{sk.sku_name}</option>)}
            </select>
          </div>
          <div className="fg" style={{ gridColumn: 'span 2' }}><label>Slabs (₹ per unit @ MOQ)</label>
            {manual.tiers.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <input type="number" placeholder="price" value={t.price} aria-label={`Manual slab ${i + 1} price`} onChange={(e) => setManual({ ...manual, tiers: manual.tiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })} style={{ width: 120 }} />
                <input type="number" placeholder="MOQ" value={t.qty} aria-label={`Manual slab ${i + 1} MOQ`} onChange={(e) => setManual({ ...manual, tiers: manual.tiers.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} style={{ width: 120 }} />
              </div>
            ))}
            <button className="btn btn-s" style={{ height: 24, fontSize: 10 }} onClick={() => setManual({ ...manual, tiers: [...manual.tiers, { qty: '', price: '' }] })}>+ slab</button>
          </div>
        </div>
        <div className="act"><button className="btn btn-g" onClick={addManual} disabled={busy}>✓ Record as accepted</button></div>
      </div>
      <span hidden aria-hidden="true">{customers.length}</span>
    </>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 9600, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '32px 12px' };
const sheet = { background: 'var(--wh)', borderRadius: 12, maxWidth: 640, width: '100%', padding: '20px 22px', boxShadow: '0 20px 60px rgba(0,0,0,.3)', margin: 'auto' };
