import { useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { fmtDate, inr } from '../lib/format.js';
import { elementToPDF, printElement } from '../lib/pdf.js';
import { COMPANY } from '../lib/company.js';
import NegoPanel from '../components/NegoPanel.jsx';
import { negoUnreadTotal } from '../lib/nego.js';
import {
  DEFAULT_GST_PCT, buildTier, buildQuotation, applyQuoteSideEffects,
  allQuotes, freezeQuote, nextQuoteVersion, platesTotal, quoteStatusCounts,
  daysSince,
} from '../lib/sales.js';

// Quotation Desk — raises priced quotations against a customer's SKUs.
// A quote is versioned PER CUSTOMER and, once frozen, is final; a revision is a
// new version rather than an edit, so what was sent stays recoverable.

const TABS = [
  { k: 'pending', label: '📥 Pending for Quotation' },
  { k: 'new', label: '🧾 New Quotation' },
  { k: 'sent', label: '📤 Quotations Sent' },
  { k: 'nego', label: '💬 Negotiations' },
];
const blankTier = () => ({ qty: '', price: '' });

// Fine-print defaults (mirror of QT_FINE_DEFAULTS, index.html 15765). {CLIENT} in the
// greeting is filled with the customer's name when a quote is started for them.
const QT_FINE_DEFAULTS = {
  greeting: 'Greetings! We are glad to submit our proposal to {CLIENT} for supply of Modified Atmospheric Packaging for extended shelf life packing.\n\nWe are an ISO certified and BRC compliant company with complete in-house manufacturing capabilities — from film making, printing, slitting & bag making. We use non-toluene, non-ketone-based inks. Our entire manufacturing is in a filtered-air facility with focus on quality and cleanliness.',
  value_add: 'Reduced wastage (Direct cost saving)\nLower cold chain costs, logistics (In-direct cost saving)\nReduced weight loss (Direct cost saving)\nFaster sealing & filling, less filling wastage (cost saving)',
  terms: 'The prices mentioned are basic; Transport extra at actuals\nPlate charges are quoted separately (see Plate Charges below)',
  basic_note: 'This is basic price. This shall be escalated / de-escalated based on RM price fluctuation — conversion costs kept the same. GST extra as applicable. Transport extra — at actuals.',
  service: 'In-house control on timelines and best serviceability\nMAP program modified to your supply chains; color-coded programs per variety/zone\nMaintain MSL for each location',
};

// The fine print to seed the builder with: prefer the last quote for this customer,
// else the defaults (with {CLIENT} filled in). (qtFineFor 15773)
function seedFinePrint(sales, leadId, clientName) {
  const prev = (sales.quotations || [])
    .filter((q) => String(q.lead_id) === String(leadId) && q.fine_print)
    .sort((a, b) => (b.version || 1) - (a.version || 1))[0];
  const fp = prev ? prev.fine_print : null;
  const g = (k, def) => (fp && fp[k] != null && String(fp[k]).trim() !== '' ? fp[k] : def);
  return {
    greeting: g('greeting', QT_FINE_DEFAULTS.greeting.replace(/\{CLIENT\}/g, clientName || '')),
    valueAdd: g('value_add', QT_FINE_DEFAULTS.value_add),
    terms: g('terms', QT_FINE_DEFAULTS.terms),
    basicNote: g('basic_note', QT_FINE_DEFAULTS.basic_note),
    service: g('service', QT_FINE_DEFAULTS.service),
  };
}

/** CSA reports the PM has pushed to the desk, still awaiting a quote. (qtPendingReports 15438) */
function pendingReports(sales) {
  return (sales.qc_reports || []).filter((r) => (r.plant_comments && r.status !== 'Quoted') || r.needs_quote_review);
}

export default function QuotationDesk() {
  // New Quotation is the initial view; the Pending queue is the first tab and its
  // badge draws the eye to anything waiting.
  const [tab, setTab] = useState('new');
  const [prefill, setPrefill] = useState(null);
  const { mods } = useData();
  const sales = mods.sales || {};
  const counts = quoteStatusCounts(sales.quotations);
  const unread = negoUnreadTotal(sales, 'quote');
  const pending = pendingReports(sales).length;

  // Make Quotation / Revise both land on the New tab: the first with just a customer
  // preselected, the second with the whole prior quote copied in for a new version.
  const startFor = (leadId) => { setPrefill({ lead_id: leadId }); setTab('new'); };

  return (
    <div id="app">
      <div className="pg-ttl">Quotation Desk</div>
      <div className="pg-sub">
        Price slabs per SKU with GST, plate cost and fine print. Quotes are versioned per
        customer — {counts.sent || 0} open, {counts.final || 0} frozen.
      </div>
      <div className="step-bar">
        {TABS.map((t) => (
          <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>
            {t.label}
            {t.k === 'pending' && pending > 0 && <span className="tag ty" style={{ marginLeft: 6 }}>{pending}</span>}
            {t.k === 'nego' && unread > 0 && <span className="tag tr" style={{ marginLeft: 6 }}>{unread}</span>}
          </div>
        ))}
      </div>
      {tab === 'pending' && <PendingForQuotation onMakeQuotation={startFor} />}
      {tab === 'new' && <NewQuotation prefill={prefill} onIssued={() => { setPrefill(null); setTab('sent'); }} />}
      {tab === 'sent' && <QuotationsSent onRevise={(q) => { setPrefill(q); setTab('new'); }} />}
      {tab === 'nego' && <NegoPanel side="quote" onRevise={(q) => { setPrefill(q); setTab('new'); }} />}
    </div>
  );
}

/* ─────────────────────── Pending for Quotation ─────────────────────── */
// The CSA queue the PM has pushed here, with a day-ageing counter, a "Make Quotation"
// shortcut and a "Push plates→rep" button that flags the PM's plate cost for the rep.
// (qtPending 15544)
function PendingForQuotation({ onMakeQuotation }) {
  const { mods, save } = useData();
  const sales = mods.sales || {};
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const skuById = (id) => (sales.skus || []).find((x) => x.id === id) || null;
  const leadById = (id) => (sales.leads || []).find((l) => l.id === id) || null;

  const rows = useMemo(() => pendingReports(sales)
    .map((r) => ({ r, days: daysSince(r.plant_commented_at || r.created_at) }))
    .sort((a, b) => (b.days || 0) - (a.days || 0)), [sales]);

  async function pushPlates(r) {
    setBusy(true);
    try {
      await save('sales', (prev) => ({
        ...(prev || {}),
        qc_reports: ((prev && prev.qc_reports) || []).map((x) => (x.id === r.id ? { ...x, plates_pushed: true, plates_pushed_at: new Date().toISOString() } : x)),
      }));
      setMsg({ t: 'g', text: '✅ Plate cost pushed to the sales rep.' });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  }

  async function markReviewed(r) {
    setBusy(true);
    try {
      await save('sales', (prev) => ({
        ...(prev || {}),
        qc_reports: ((prev && prev.qc_reports) || []).map((x) => (x.id === r.id ? { ...x, needs_quote_review: false } : x)),
      }));
      setMsg({ t: 'g', text: '✅ Marked reviewed.' });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  }

  const dayColor = (d) => (d <= 2 ? 'var(--g)' : d <= 5 ? '#E67E22' : 'var(--red)');

  return (
    <div className="card">
      <div className="ctitle">📥 Pending for Quotation <span className="tag ty">{rows.length}</span></div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        CSA reports the PM has pushed to you, with QC &amp; PM comments. Rows highlighted amber were
        edited after a quote — re-check them. The day counter shows how long a quotation has been pending.
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead><tr>
            <th style={{ minWidth: 160 }}>Customer</th><th style={{ minWidth: 160 }}>SKU</th>
            <th>QC / PM Comments</th><th style={{ width: 90, textAlign: 'center' }}>Days Pending</th><th style={{ width: 260 }}>Action</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>Nothing pending — you&rsquo;re all caught up.</td></tr>
            ) : rows.map(({ r, days }) => {
              const sku = skuById(r.sku_id);
              const lead = leadById(r.lead_id);
              const direct = r.source === 'direct';
              const company = direct ? (r.company_name || '—') : (lead ? lead.client_name : '—');
              const item = direct ? (r.product_desc || '—') : (sku ? sku.sku_name : '—');
              const p = r.plates;
              const plateTotal = p ? Math.round((Number(p.ci_per) || 0) * (Number(p.ci_n) || 0) + (Number(p.off_per) || 0) * (Number(p.off_n) || 0)) : 0;
              return (
                <tr key={r.id} style={r.needs_quote_review ? { background: '#fffaf0' } : undefined}>
                  <td style={{ fontWeight: 700 }}>
                    {company}{r.needs_quote_review && <span className="tag ty" style={{ marginLeft: 6, fontSize: 9 }}>edited</span>}
                  </td>
                  <td>
                    {item}
                    {p && (
                      <div style={{ fontSize: 10, color: '#8a6d00', marginTop: 3 }}>
                        🧾 Plates (PM): CI ₹{p.ci_per || 0}×{p.ci_n || 0}, Offset ₹{p.off_per || 0}×{p.off_n || 0} = ₹{plateTotal}
                        {r.plates_pushed && <b style={{ color: 'var(--g)' }}> · pushed to rep</b>}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--i2)' }}>
                    QC: {r.plant_comment_req || '—'}<br />PM: {r.plant_comments || '—'}
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 800, color: dayColor(days || 0) }}>{days == null ? '—' : days + 'd'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {lead
                      ? <button className="btn btn-s" style={{ color: '#5e35b1' }} aria-label={`Make quotation for ${company}`} onClick={() => onMakeQuotation(lead.id)}>Make Quotation</button>
                      : <span style={{ color: 'var(--i3)', fontSize: 11 }}>—</span>}
                    {p && !r.plates_pushed && (
                      <button className="btn btn-s" style={{ marginLeft: 4 }} disabled={busy} aria-label={`Push plates to rep for ${item}`} onClick={() => pushPlates(r)}>Push plates→rep</button>
                    )}
                    {r.needs_quote_review && (
                      <button className="btn btn-s" style={{ marginLeft: 4, color: 'var(--g)' }} disabled={busy} aria-label={`Mark ${item} reviewed`} onClick={() => markReviewed(r)}>✓ Reviewed</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── New quotation ─────────────────────────── */
function NewQuotation({ prefill, onIssued }) {
  const { mods, save } = useData();
  const sales = mods.sales || {};
  const leads = sales.leads || [];
  const skus = sales.skus || [];
  const isRevise = !!(prefill && prefill.id);

  const [leadId, setLeadId] = useState(prefill ? prefill.lead_id : '');
  const [picked, setPicked] = useState(() => {
    if (!prefill) return {};
    const out = {};
    (prefill.items || []).forEach((it) => {
      out[it.sku_id] = {
        item_code: it.item_code || '', anti_fog: it.anti_fog || '', moq: it.moq || '',
        width: it.width || '', height: it.height || '', gusset: it.gusset || '',
        thick: it.thick || '', micron: it.micron || '',
        gst: it.gst_pct ?? DEFAULT_GST_PCT,
        plate: { ...(it.plate || {}) },
        tiers: (it.tiers || []).map((t) => ({ qty: t.qty, price: t.price_wo_gst })),
      };
    });
    return out;
  });
  const [header, setHeader] = useState({
    rmSnapshot: prefill?.rm_snapshot || '', inkCost: prefill?.ink_cost || '',
    wastage: prefill?.wastage || '', notes: prefill?.notes || '',
  });
  const [finePrint, setFinePrint] = useState(() => {
    const initLeadId = prefill ? prefill.lead_id : '';
    const initClient = (leads.find((l) => l.id === initLeadId) || {}).client_name || (prefill && prefill.client_name) || '';
    if (isRevise && prefill.fine_print) {
      return {
        greeting: prefill.fine_print.greeting || '', valueAdd: prefill.fine_print.value_add || '',
        terms: prefill.fine_print.terms || '', basicNote: prefill.fine_print.basic_note || '',
        service: prefill.fine_print.service || '',
      };
    }
    return seedFinePrint(sales, initLeadId, initClient);
  });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const lead = leads.find((l) => l.id === leadId);
  // SKUs belonging to the chosen customer; fall back to all when none are linked.
  const leadSkus = useMemo(() => {
    const own = skus.filter((s) => String(s.lead_id) === String(leadId));
    return own.length ? own : skus;
  }, [skus, leadId]);

  const version = nextQuoteVersion(sales.quotations, leadId);

  function onPickLead(id) {
    setLeadId(id);
    setPicked({});
    const cn = (leads.find((l) => l.id === id) || {}).client_name || '';
    setFinePrint(seedFinePrint(sales, id, cn));
  }

  function toggleSku(id) {
    setPicked((p) => {
      if (p[id]) { const { [id]: _drop, ...rest } = p; return rest; }
      const sku = skus.find((s) => s.id === id) || {};
      return {
        ...p,
        [id]: {
          item_code: '', anti_fog: '', moq: '', gst: DEFAULT_GST_PCT, plate: {}, tiers: [blankTier()],
          width: sku.width || '', height: sku.height || '', gusset: sku.gusset || '',
          thick: sku.thick || '', micron: sku.micron || '',
        },
      };
    });
  }
  const setField = (id, f, v) => setPicked((p) => ({ ...p, [id]: { ...p[id], [f]: v } }));
  const setPlate = (id, f, v) => setPicked((p) => ({ ...p, [id]: { ...p[id], plate: { ...p[id].plate, [f]: v } } }));
  const setTier = (id, i, f, v) => setPicked((p) => ({
    ...p, [id]: { ...p[id], tiers: p[id].tiers.map((t, j) => (j === i ? { ...t, [f]: v } : t)) },
  }));
  const addTier = (id) => setPicked((p) => ({ ...p, [id]: { ...p[id], tiers: [...p[id].tiers, blankTier()] } }));
  const dropTier = (id, i) => setPicked((p) => ({
    ...p, [id]: { ...p[id], tiers: p[id].tiers.length > 1 ? p[id].tiers.filter((_, j) => j !== i) : p[id].tiers },
  }));

  async function issue() {
    setBusy(true);
    setMsg(null);
    try {
      const items = Object.entries(picked).map(([sku_id, cfg]) => {
        const sku = skus.find((s) => s.id === sku_id) || {};
        return {
          sku_id, sku_name: sku.sku_name || sku.name || '',
          item_code: cfg.item_code, anti_fog: cfg.anti_fog, moq: cfg.moq,
          width: cfg.width || sku.width || '', height: cfg.height || sku.height || '',
          gusset: cfg.gusset || sku.gusset || '', thick: cfg.thick || sku.thick || '',
          micron: cfg.micron || sku.micron || '', substrates: sku.substrates || '',
          gst_pct: Number(cfg.gst) >= 0 ? Number(cfg.gst) : DEFAULT_GST_PCT,
          tiers: cfg.tiers.map((t) => buildTier(t.qty, t.price, cfg.gst)).filter(Boolean),
          plate: cfg.plate || {},
        };
      });
      const quote = buildQuotation(
        { leadId, clientName: lead ? lead.client_name : '', items, header, finePrint },
        sales.quotations,
      );
      const side = applyQuoteSideEffects(quote, { qcReports: sales.qc_reports, skus: sales.skus });
      await save('sales', (prev) => ({
        ...(prev || {}),
        quotations: [...((prev && prev.quotations) || []), quote],
        qc_reports: side.qc_reports,
        skus: side.skus,
      }));
      setMsg({ t: 'g', text: `✅ Quotation v${quote.version} issued for ${quote.client_name}.` });
      setTimeout(onIssued, 700);
    } catch (e) {
      setMsg({ t: 'r', text: e.message || String(e) });
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>New Quotation {leadId ? <span className="tag tb">v{version}</span> : null}</div>
        <select value={leadId} onChange={(e) => onPickLead(e.target.value)} aria-label="Customer" style={{ minWidth: 240 }}>
          <option value="">— Select customer —</option>
          {leads.map((l) => <option key={l.id} value={l.id}>{l.client_name}</option>)}
        </select>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      {isRevise && <div className="al al-y">Revising {prefill.client_name} v{prefill.version} — this issues a new version, leaving the earlier one intact.</div>}

      {!leadId ? <div className="pg-sub">Choose a customer to list their SKUs.</div> : (
        <>
          <div className="tw sy" style={{ maxHeight: 'calc(100vh - 460px)' }}>
            <table>
              <thead><tr>
                <th style={{ width: 34 }}></th><th style={{ minWidth: 160 }}>SKU</th><th style={{ width: 120 }}>Item code</th>
                <th style={{ width: 90 }}>Anti-fog</th><th style={{ width: 90 }}>MOQ</th><th style={{ width: 80 }}>GST %</th><th>Specs / Price slabs / Plates</th>
              </tr></thead>
              <tbody>
                {leadSkus.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No SKUs recorded for this customer.</td></tr>
                ) : leadSkus.map((sku) => {
                  const cfg = picked[sku.id];
                  return (
                    <tr key={sku.id}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={!!cfg} aria-label={`Quote ${sku.sku_name || sku.name}`} onChange={() => toggleSku(sku.id)} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{sku.sku_name || sku.name || sku.id}</td>
                      {cfg ? (
                        <>
                          <td><input value={cfg.item_code} aria-label={`Item code ${sku.id}`} onChange={(e) => setField(sku.id, 'item_code', e.target.value)} /></td>
                          <td><input value={cfg.anti_fog} aria-label={`Anti-fog ${sku.id}`} onChange={(e) => setField(sku.id, 'anti_fog', e.target.value)} /></td>
                          <td><input value={cfg.moq} aria-label={`MOQ ${sku.id}`} onChange={(e) => setField(sku.id, 'moq', e.target.value)} /></td>
                          <td><input type="number" min="0" value={cfg.gst} aria-label={`GST percent ${sku.id}`} onChange={(e) => setField(sku.id, 'gst', e.target.value)} /></td>
                          <td>
                            <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 10, color: 'var(--i3)' }}>Specs:</span>
                              <input placeholder="Width" aria-label={`Width ${sku.id}`} value={cfg.width} onChange={(e) => setField(sku.id, 'width', e.target.value)} style={{ width: 66 }} />
                              <input placeholder="Height" aria-label={`Height ${sku.id}`} value={cfg.height} onChange={(e) => setField(sku.id, 'height', e.target.value)} style={{ width: 66 }} />
                              <input placeholder="Gusset" aria-label={`Gusset ${sku.id}`} value={cfg.gusset} onChange={(e) => setField(sku.id, 'gusset', e.target.value)} style={{ width: 66 }} />
                              <input placeholder="Thick" aria-label={`Thick ${sku.id}`} value={cfg.thick} onChange={(e) => setField(sku.id, 'thick', e.target.value)} style={{ width: 60 }} />
                              <input placeholder="Micron" aria-label={`Micron ${sku.id}`} value={cfg.micron} onChange={(e) => setField(sku.id, 'micron', e.target.value)} style={{ width: 66 }} />
                            </div>
                            {cfg.tiers.map((t, i) => {
                              const preview = buildTier(t.qty, t.price, cfg.gst);
                              return (
                                <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 3 }}>
                                  <input type="number" min="0" placeholder="Qty" value={t.qty} aria-label={`Slab ${i + 1} qty ${sku.id}`} onChange={(e) => setTier(sku.id, i, 'qty', e.target.value)} style={{ width: 90 }} />
                                  <input type="number" min="0" step="0.01" placeholder="₹ ex-GST" value={t.price} aria-label={`Slab ${i + 1} price ${sku.id}`} onChange={(e) => setTier(sku.id, i, 'price', e.target.value)} style={{ width: 100 }} />
                                  <span style={{ fontSize: 11, color: 'var(--i2)', minWidth: 110 }}>
                                    {preview ? `incl. GST ₹${preview.price_w_gst.toFixed(2)}` : ''}
                                  </span>
                                  <button className="btn btn-s" style={{ height: 22, fontSize: 10 }} aria-label={`Remove slab ${i + 1} ${sku.id}`} onClick={() => dropTier(sku.id, i)}>✕</button>
                                </div>
                              );
                            })}
                            <button className="btn btn-s" style={{ height: 22, fontSize: 10 }} onClick={() => addTier(sku.id)} aria-label={`Add slab ${sku.id}`}>＋ slab</button>
                            <div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 10, color: 'var(--i3)' }}>Plates:</span>
                              <input type="number" placeholder="CI ₹/plate" aria-label={`CI per plate ${sku.id}`} value={cfg.plate.ci_per ?? ''} onChange={(e) => setPlate(sku.id, 'ci_per', e.target.value)} style={{ width: 90 }} />
                              <input type="number" placeholder="CI no." aria-label={`CI plates ${sku.id}`} value={cfg.plate.ci_n ?? ''} onChange={(e) => setPlate(sku.id, 'ci_n', e.target.value)} style={{ width: 70 }} />
                              <input type="number" placeholder="Off ₹/plate" aria-label={`Offset per plate ${sku.id}`} value={cfg.plate.off_per ?? ''} onChange={(e) => setPlate(sku.id, 'off_per', e.target.value)} style={{ width: 90 }} />
                              <input type="number" placeholder="Off no." aria-label={`Offset plates ${sku.id}`} value={cfg.plate.off_n ?? ''} onChange={(e) => setPlate(sku.id, 'off_n', e.target.value)} style={{ width: 70 }} />
                              <span style={{ fontSize: 11, fontWeight: 700 }}>= ₹{inr(platesTotal(cfg.plate))}</span>
                            </div>
                          </td>
                        </>
                      ) : <td colSpan={5} style={{ fontSize: 11, color: 'var(--i3)' }}>Tick to quote this SKU</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="ctitle" style={{ marginTop: 14 }}>Costing notes</div>
          <div className="g4">
            <div className="fg"><label>RM snapshot</label><input value={header.rmSnapshot} aria-label="RM snapshot" onChange={(e) => setHeader({ ...header, rmSnapshot: e.target.value })} /></div>
            <div className="fg"><label>Ink cost</label><input value={header.inkCost} aria-label="Ink cost" onChange={(e) => setHeader({ ...header, inkCost: e.target.value })} /></div>
            <div className="fg"><label>Wastage</label><input value={header.wastage} aria-label="Wastage" onChange={(e) => setHeader({ ...header, wastage: e.target.value })} /></div>
            <div className="fg"><label>Notes</label><input value={header.notes} aria-label="Notes" onChange={(e) => setHeader({ ...header, notes: e.target.value })} /></div>
          </div>

          <div className="ctitle" style={{ marginTop: 8 }}>Fine print <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--i3)' }}>— one point per line; pre-filled with the standard proposal text, edit as needed</span></div>
          <div className="g2">
            <div className="fg"><label>Intro / greeting</label><textarea rows={5} value={finePrint.greeting} aria-label="Greeting" onChange={(e) => setFinePrint({ ...finePrint, greeting: e.target.value })} /></div>
            <div className="fg"><label>Value addition (one per line)</label><textarea rows={5} value={finePrint.valueAdd} aria-label="Value add" onChange={(e) => setFinePrint({ ...finePrint, valueAdd: e.target.value })} /></div>
            <div className="fg"><label>Costing terms (one per line)</label><textarea rows={3} value={finePrint.terms} aria-label="Terms" onChange={(e) => setFinePrint({ ...finePrint, terms: e.target.value })} /></div>
            <div className="fg"><label>Service capability (one per line)</label><textarea rows={3} value={finePrint.service} aria-label="Service" onChange={(e) => setFinePrint({ ...finePrint, service: e.target.value })} /></div>
            <div className="fg" style={{ gridColumn: '1 / -1' }}><label>Basic-price note</label><textarea rows={2} value={finePrint.basicNote} aria-label="Basic note" onChange={(e) => setFinePrint({ ...finePrint, basicNote: e.target.value })} /></div>
          </div>

          <div className="fbar">
            <span style={{ flex: 1 }} />
            <button className="btn btn-g" onClick={issue} disabled={busy}>{busy ? 'Issuing…' : `✓ Issue quotation v${version}`}</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── Quotations sent ─────────────────────────── */
function QuotationsSent({ onRevise }) {
  const { mods, save } = useData();
  const sales = mods.sales || {};
  const [doc, setDoc] = useState(null);
  const [msg, setMsg] = useState(null);
  const rows = allQuotes(sales.quotations);

  async function freeze(q) {
    try {
      await save('sales', (prev) => ({ ...(prev || {}), quotations: freezeQuote((prev && prev.quotations) || [], q.id) }));
      setMsg({ t: 'g', text: `✅ ${q.client_name} v${q.version} frozen.` });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">📤 Quotations Sent <span className="tag tgr">{rows.length}</span></div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="tw sy" style={{ maxHeight: 'calc(100vh - 280px)' }}>
          <table>
            <thead><tr><th style={{ minWidth: 160 }}>Customer</th><th>SKUs</th><th style={{ width: 60 }}>Ver</th><th style={{ width: 110 }}>Date</th><th style={{ width: 90 }}>Status</th><th style={{ width: 200 }}></th></tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No quotations issued yet.</td></tr>
              ) : rows.map((q) => (
                <tr key={q.id}>
                  <td style={{ fontWeight: 700 }}>{q.client_name}</td>
                  <td style={{ fontSize: 11 }}>{(q.items || []).map((i) => i.sku_name).filter(Boolean).join(', ') || '—'}</td>
                  <td>v{q.version || 1}</td>
                  <td style={{ fontSize: 11 }}>{fmtDate(q.date)}</td>
                  <td>{q.status === 'final'
                    ? <span className="tag tgr">Final</span>
                    : <span className="tag ty">{q.status || 'sent'}</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-s" aria-label={`Open quotation ${q.client_name} v${q.version}`} onClick={() => setDoc(q)}>📄 View</button>
                    <button className="btn btn-s" style={{ marginLeft: 4 }} aria-label={`Revise ${q.client_name} v${q.version}`} onClick={() => onRevise(q)}>New ver</button>
                    {q.status !== 'final' && (
                      <button className="btn btn-s" style={{ marginLeft: 4, color: 'var(--g)' }} aria-label={`Freeze ${q.client_name} v${q.version}`} onClick={() => freeze(q)}>Freeze</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {doc && <QuotationModal quote={doc} onClose={() => setDoc(null)} />}
    </>
  );
}

/* ─────────────────────────── Quotation document ─────────────────────────── */
// A vector PDF matching the production template (qtBuildDocHTML 15779): a material
// costing table with specification + slab columns, a separate plate-charges
// breakdown, and the fine-print sections with their standard defaults.
const bd = { border: '0.6px solid #8fa2bd', padding: '6px 6px', wordBreak: 'break-word' };
const hd = { border: '0.6px solid #8fa2bd', padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle', lineHeight: 1.15, fontWeight: 700, wordBreak: 'break-word' };
const COST_COLS = [4, 12, 10, 11, 5, 5, 5, 5, 5, 7, 9, 9, 9, 6];
const PLATE_COLS = [6, 30, 20, 13, 20, 13, 15];
const splitLines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
const splitParas = (t) => String(t || '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
const fineVal = (fp, k, def) => (fp && fp[k] != null && String(fp[k]).trim() !== '' ? fp[k] : def);

export function QuotationDoc({ quote, innerRef }) {
  const fp = quote.fine_print || {};
  const clientName = quote.client_name || '';
  const greeting = fineVal(fp, 'greeting', QT_FINE_DEFAULTS.greeting).replace(/\{CLIENT\}/g, clientName);
  const valueAdd = fineVal(fp, 'value_add', QT_FINE_DEFAULTS.value_add);
  const terms = fineVal(fp, 'terms', QT_FINE_DEFAULTS.terms);
  const basicNote = fineVal(fp, 'basic_note', QT_FINE_DEFAULTS.basic_note);
  const service = fineVal(fp, 'service', QT_FINE_DEFAULTS.service);
  const items = quote.items || [];
  const gstPct = (items[0] && items[0].gst_pct) || 18;

  // Plate charges (separate one-time cost), one row per SKU that carries plates.
  let plateGrand = 0;
  const plateRows = [];
  items.forEach((it) => {
    const p = it.plate || {};
    const has = (Number(p.ci_per) || Number(p.ci_n) || Number(p.off_per) || Number(p.off_n));
    if (!has) return;
    const ci = (Number(p.ci_per) || 0) * (Number(p.ci_n) || 0);
    const off = (Number(p.off_per) || 0) * (Number(p.off_n) || 0);
    const tot = ci + off;
    plateGrand += tot;
    plateRows.push({ sku_name: it.sku_name, ci_n: Number(p.ci_n) || 0, ci_per: Number(p.ci_per) || 0, ci, off_n: Number(p.off_n) || 0, off_per: Number(p.off_per) || 0, off, tot });
  });

  return (
    <div ref={innerRef} style={{ width: 794, background: '#fff', color: '#111', fontFamily: 'Arial, sans-serif', padding: '26px 30px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 1, color: '#000' }}>{COMPANY.name}</div>
        <div style={{ fontSize: 11, color: '#333' }}>{fmtDate(quote.date)}</div>
      </div>
      <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>{COMPANY.addressLines.join(' ')} | GSTIN: {COMPANY.gstin}</div>
      <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 2, marginTop: 6, color: '#5e35b1' }}>QUOTATION</div>
      <div style={{ textAlign: 'center', margin: '18px 0 4px', color: '#1a4fa0', fontSize: 16, fontWeight: 800 }}>TECHNICAL &amp; COMMERCIAL PROPOSAL FOR</div>
      <div style={{ textAlign: 'center', color: '#1a4fa0', fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{clientName}</div>
      <div style={{ textAlign: 'right', fontSize: 11, color: '#666', marginBottom: 6 }}>Version <strong>v{quote.version || 1}</strong></div>

      {splitParas(greeting).map((p, i) => (
        <div key={i} style={{ fontSize: 11, lineHeight: 1.5, color: '#222', marginTop: 8 }}>{p}</div>
      ))}

      <div style={{ color: '#1a4fa0', fontWeight: 800, fontSize: 12, margin: '14px 0 4px' }}>VALUE ADDITION</div>
      <ul style={{ fontSize: 11, color: '#222', margin: '0 0 6px 18px', lineHeight: 1.5 }}>
        {splitLines(valueAdd).map((x, i) => <li key={i}>{x}</li>)}
      </ul>

      <div style={{ color: '#1a4fa0', fontWeight: 800, fontSize: 13, margin: '14px 0 6px' }}>COSTING — MATERIAL (per bag)</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
        <colgroup>{COST_COLS.map((w, i) => <col key={i} style={{ width: w + '%' }} />)}</colgroup>
        <thead>
          <tr style={{ background: '#fdeee7' }}><td colSpan={14} style={{ ...bd, textAlign: 'center', fontWeight: 800, fontSize: 12.5 }}>{COMPANY.name.toUpperCase()}</td></tr>
          <tr style={{ background: '#eef2fb' }}>
            <td colSpan={10} style={{ ...bd, textAlign: 'center', fontWeight: 700 }}>QUOTATION for MAP Printed Bags</td>
            <td colSpan={4} style={{ ...bd, textAlign: 'center', fontWeight: 700 }}>{fmtDate(quote.date)}</td>
          </tr>
          <tr style={{ background: '#dbe6f6' }}>
            <td rowSpan={2} style={hd}>S.NO</td><td rowSpan={2} style={hd}>SKU</td><td rowSpan={2} style={hd}>Item Code</td>
            <td colSpan={6} style={hd}>SPECIFICATIONS</td>
            <td rowSpan={2} style={hd}>Qty (kg)</td>
            <td colSpan={3} style={hd}>PRICE PER BAG (₹)</td>
            <td rowSpan={2} style={hd}>MOQ</td>
          </tr>
          <tr style={{ background: '#dbe6f6' }}>
            <td style={{ ...hd, fontSize: 9 }}>Anti Fog / Ethylene</td><td style={{ ...hd, fontSize: 9 }}>Width</td><td style={{ ...hd, fontSize: 9 }}>Height</td>
            <td style={{ ...hd, fontSize: 9 }}>Gusset</td><td style={{ ...hd, fontSize: 9 }}>Thick</td><td style={{ ...hd, fontSize: 9 }}>Micron</td>
            <td style={hd}>W/O GST</td><td style={hd}>GST @{gstPct}%</td><td style={hd}>WITH GST</td>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={14} style={{ ...bd, textAlign: 'center', color: '#999' }}>No SKUs on this quotation.</td></tr>
          ) : items.flatMap((it, ii) => {
            const tiers = (it.tiers && it.tiers.length) ? it.tiers : [{ qty: '', price_wo_gst: it.price_wo_gst || 0, gst_pct: it.gst_pct || 18, gst_amt: 0, price_w_gst: it.price_w_gst || 0 }];
            const rs = tiers.length;
            return tiers.map((t, ti) => {
              const first = ti === 0;
              return (
                <tr key={ii + '-' + ti}>
                  {first && <td rowSpan={rs} style={{ ...bd, textAlign: 'center', verticalAlign: 'middle' }}>{ii + 1}</td>}
                  {first && <td rowSpan={rs} style={{ ...bd, verticalAlign: 'middle' }}>{it.sku_name || ''}</td>}
                  {first && <td rowSpan={rs} style={{ ...bd, verticalAlign: 'middle' }}>{it.item_code || ''}</td>}
                  {first && <td rowSpan={rs} style={{ ...bd, verticalAlign: 'middle' }}>{it.anti_fog || ''}</td>}
                  {first && <td rowSpan={rs} style={{ ...bd, textAlign: 'center', verticalAlign: 'middle' }}>{it.width || ''}</td>}
                  {first && <td rowSpan={rs} style={{ ...bd, textAlign: 'center', verticalAlign: 'middle' }}>{it.height || ''}</td>}
                  {first && <td rowSpan={rs} style={{ ...bd, textAlign: 'center', verticalAlign: 'middle' }}>{it.gusset || ''}</td>}
                  {first && <td rowSpan={rs} style={{ ...bd, textAlign: 'center', verticalAlign: 'middle' }}>{it.thick || ''}</td>}
                  {first && <td rowSpan={rs} style={{ ...bd, textAlign: 'center', verticalAlign: 'middle' }}>{it.micron || ''}</td>}
                  <td style={{ ...bd, textAlign: 'center' }}>{t.qty || ''}</td>
                  <td style={{ ...bd, textAlign: 'right' }}>₹{Number(t.price_wo_gst || 0).toFixed(2)}</td>
                  <td style={{ ...bd, textAlign: 'right' }}>₹{Number(t.gst_amt || 0).toFixed(2)}</td>
                  <td style={{ ...bd, textAlign: 'right', fontWeight: 700 }}>₹{Number(t.price_w_gst || 0).toFixed(2)}</td>
                  {first && <td rowSpan={rs} style={{ ...bd, textAlign: 'center', verticalAlign: 'middle' }}>{it.moq || ''}</td>}
                </tr>
              );
            });
          })}
        </tbody>
      </table>

      {plateRows.length > 0 && (
        <>
          <div style={{ color: '#1a4fa0', fontWeight: 800, fontSize: 13, margin: '16px 0 6px' }}>
            PLATE CHARGES <span style={{ fontSize: 10, fontWeight: 600, color: '#666' }}>(one-time, quoted separately)</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
            <colgroup>{PLATE_COLS.map((w, i) => <col key={i} style={{ width: w + '%' }} />)}</colgroup>
            <thead>
              <tr style={{ background: '#dbe6f6' }}>
                <td style={hd}>S.NO</td><td style={hd}>SKU</td><td style={hd}>CI Plates (qty × ₹)</td><td style={hd}>CI Amount</td>
                <td style={hd}>Offset Plates (qty × ₹)</td><td style={hd}>Offset Amount</td><td style={hd}>Plate Total</td>
              </tr>
            </thead>
            <tbody>
              {plateRows.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...bd, textAlign: 'center' }}>{i + 1}</td>
                  <td style={bd}>{r.sku_name}</td>
                  <td style={{ ...bd, textAlign: 'center' }}>{r.ci_n} × ₹{r.ci_per.toFixed(2)}</td>
                  <td style={{ ...bd, textAlign: 'right' }}>₹ {r.ci.toFixed(2)}</td>
                  <td style={{ ...bd, textAlign: 'center' }}>{r.off_n} × ₹{r.off_per.toFixed(2)}</td>
                  <td style={{ ...bd, textAlign: 'right' }}>₹ {r.off.toFixed(2)}</td>
                  <td style={{ ...bd, textAlign: 'right', fontWeight: 700 }}>₹ {r.tot.toFixed(2)}</td>
                </tr>
              ))}
              <tr style={{ background: '#f4f7fb', fontWeight: 800 }}>
                <td colSpan={6} style={{ ...bd, textAlign: 'right' }}>Total Plate Charges (excl. GST)</td>
                <td style={{ ...bd, textAlign: 'right' }}>₹ {plateGrand.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: 11, marginTop: 4, color: '#444' }}>One-time plate cost: <strong>₹{inr(plateGrand)}</strong></div>
          <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>Plate charges are a one-time cost, billed separately from the per-bag material price above. GST extra as applicable.</div>
        </>
      )}

      <ul style={{ fontSize: 11, color: '#222', margin: '10px 0 6px 18px', lineHeight: 1.5 }}>
        {splitLines(terms).map((x, i) => <li key={i}>{x}</li>)}
        {quote.notes ? <li>{quote.notes}</li> : null}
      </ul>
      <div style={{ fontSize: 11, color: '#222', marginTop: 6 }}>{basicNote}</div>

      <div style={{ color: '#1a4fa0', fontWeight: 800, fontSize: 12, margin: '14px 0 4px' }}>SERVICE CAPABILITY</div>
      <ul style={{ fontSize: 11, color: '#222', margin: '0 0 6px 18px', lineHeight: 1.5 }}>
        {splitLines(service).map((x, i) => <li key={i}>{x}</li>)}
      </ul>

      <div style={{ fontSize: 9, color: '#999', marginTop: 14, borderTop: '1px solid #eee', paddingTop: 6 }}>
        Quotation v{quote.version || 1} · {clientName} · {fmtDate(quote.date)} · For {COMPANY.name} — this quotation supersedes earlier versions for the same SKUs.
      </div>
    </div>
  );
}

function QuotationModal({ quote, onClose }) {
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
