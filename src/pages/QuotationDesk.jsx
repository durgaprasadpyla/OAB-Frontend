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
} from '../lib/sales.js';

// Quotation Desk — raises priced quotations against a customer's SKUs.
// A quote is versioned PER CUSTOMER and, once frozen, is final; a revision is a
// new version rather than an edit, so what was sent stays recoverable.

const TABS = [
  { k: 'new', label: '🧾 New Quotation' },
  { k: 'sent', label: '📤 Quotations Sent' },
  { k: 'nego', label: '💬 Negotiations' },
];
const blankTier = () => ({ qty: '', price: '' });

export default function QuotationDesk() {
  const [tab, setTab] = useState('new');
  const [prefill, setPrefill] = useState(null);
  const { mods } = useData();
  const sales = mods.sales || {};
  const counts = quoteStatusCounts(sales.quotations);
  const unread = negoUnreadTotal(sales, 'quote');

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
            {t.k === 'nego' && unread > 0 && <span className="tag tr" style={{ marginLeft: 6 }}>{unread}</span>}
          </div>
        ))}
      </div>
      {tab === 'new' && <NewQuotation prefill={prefill} onIssued={() => { setPrefill(null); setTab('sent'); }} />}
      {tab === 'sent' && <QuotationsSent onRevise={(q) => { setPrefill(q); setTab('new'); }} />}
      {tab === 'nego' && <NegoPanel side="quote" />}
    </div>
  );
}

/* ─────────────────────────── New quotation ─────────────────────────── */
function NewQuotation({ prefill, onIssued }) {
  const { mods, save } = useData();
  const sales = mods.sales || {};
  const leads = sales.leads || [];
  const skus = sales.skus || [];

  const [leadId, setLeadId] = useState(prefill ? prefill.lead_id : '');
  const [picked, setPicked] = useState(() => {
    if (!prefill) return {};
    const out = {};
    (prefill.items || []).forEach((it) => {
      out[it.sku_id] = {
        item_code: it.item_code || '', anti_fog: it.anti_fog || '', moq: it.moq || '',
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
  const [finePrint, setFinePrint] = useState({
    greeting: prefill?.fine_print?.greeting || '', valueAdd: prefill?.fine_print?.value_add || '',
    terms: prefill?.fine_print?.terms || '', basicNote: prefill?.fine_print?.basic_note || '',
    service: prefill?.fine_print?.service || '',
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

  function toggleSku(id) {
    setPicked((p) => {
      if (p[id]) { const { [id]: _drop, ...rest } = p; return rest; }
      return { ...p, [id]: { item_code: '', anti_fog: '', moq: '', gst: DEFAULT_GST_PCT, plate: {}, tiers: [blankTier()] } };
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
          width: sku.width || '', height: sku.height || '', gusset: sku.gusset || '',
          thick: sku.thick || '', micron: sku.micron || '', substrates: sku.substrates || '',
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
        <select value={leadId} onChange={(e) => { setLeadId(e.target.value); setPicked({}); }} aria-label="Customer" style={{ minWidth: 240 }}>
          <option value="">— Select customer —</option>
          {leads.map((l) => <option key={l.id} value={l.id}>{l.client_name}</option>)}
        </select>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      {prefill && <div className="al al-y">Revising {prefill.client_name} v{prefill.version} — this issues a new version, leaving the earlier one intact.</div>}

      {!leadId ? <div className="pg-sub">Choose a customer to list their SKUs.</div> : (
        <>
          <div className="tw sy" style={{ maxHeight: 'calc(100vh - 420px)' }}>
            <table>
              <thead><tr>
                <th style={{ width: 34 }}></th><th style={{ minWidth: 160 }}>SKU</th><th style={{ width: 120 }}>Item code</th>
                <th style={{ width: 90 }}>Anti-fog</th><th style={{ width: 90 }}>MOQ</th><th style={{ width: 80 }}>GST %</th><th>Price slabs</th>
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
                            <div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center' }}>
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

          <div className="ctitle" style={{ marginTop: 8 }}>Fine print</div>
          <div className="g3">
            <div className="fg"><label>Greeting</label><input value={finePrint.greeting} aria-label="Greeting" onChange={(e) => setFinePrint({ ...finePrint, greeting: e.target.value })} /></div>
            <div className="fg"><label>Value add</label><input value={finePrint.valueAdd} aria-label="Value add" onChange={(e) => setFinePrint({ ...finePrint, valueAdd: e.target.value })} /></div>
            <div className="fg"><label>Terms</label><input value={finePrint.terms} aria-label="Terms" onChange={(e) => setFinePrint({ ...finePrint, terms: e.target.value })} /></div>
            <div className="fg"><label>Basic note</label><input value={finePrint.basicNote} aria-label="Basic note" onChange={(e) => setFinePrint({ ...finePrint, basicNote: e.target.value })} /></div>
            <div className="fg"><label>Service</label><input value={finePrint.service} aria-label="Service" onChange={(e) => setFinePrint({ ...finePrint, service: e.target.value })} /></div>
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
export function QuotationDoc({ quote, innerRef }) {
  return (
    <div ref={innerRef} style={{ width: 794, background: '#fff', color: '#111', fontFamily: 'Arial, sans-serif', padding: 24 }}>
      <div style={{ borderBottom: '3px solid #5e35b1', paddingBottom: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{COMPANY.name}</div>
        <div style={{ fontSize: 9, color: '#555' }}>{COMPANY.addressLines.join(' ')} | GSTIN: {COMPANY.gstin}</div>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 2, marginTop: 6, color: '#5e35b1' }}>QUOTATION</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 12 }}>
        <div><strong>To:</strong> {quote.client_name}</div>
        <div>Version <strong>v{quote.version || 1}</strong> · {fmtDate(quote.date)}</div>
      </div>

      {quote.fine_print?.greeting ? <div style={{ fontSize: 11, marginBottom: 10 }}>{quote.fine_print.greeting}</div> : null}

      {(quote.items || []).map((it, i) => (
        <div key={i} style={{ marginBottom: 14, border: '1px solid #e3ddf3', borderRadius: 4 }}>
          <div style={{ background: '#ede7f6', color: '#5e35b1', padding: '5px 10px', fontWeight: 800, fontSize: 12 }}>
            {it.sku_name || 'SKU'} {it.item_code ? <span style={{ fontWeight: 400 }}>· {it.item_code}</span> : null}
          </div>
          <div style={{ fontSize: 10, color: '#555', padding: '4px 10px' }}>
            {[it.width && `W ${it.width}`, it.height && `H ${it.height}`, it.gusset && `Gusset ${it.gusset}`,
              it.micron && `${it.micron} micron`, it.substrates, it.anti_fog && `Anti-fog: ${it.anti_fog}`,
              it.moq && `MOQ ${it.moq}`].filter(Boolean).join(' · ')}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ background: '#f6f4fc' }}>
              <th style={{ padding: '4px 10px', textAlign: 'left' }}>Quantity</th>
              <th style={{ padding: '4px 10px', textAlign: 'right' }}>Rate (ex-GST)</th>
              <th style={{ padding: '4px 10px', textAlign: 'right' }}>GST {it.gst_pct}%</th>
              <th style={{ padding: '4px 10px', textAlign: 'right' }}>Rate (incl. GST)</th>
            </tr></thead>
            <tbody>
              {(it.tiers || []).map((t, j) => (
                <tr key={j} style={{ borderTop: '1px solid #efeaf8' }}>
                  <td style={{ padding: '4px 10px' }}>{inr(t.qty)}</td>
                  <td style={{ padding: '4px 10px', textAlign: 'right' }}>₹{Number(t.price_wo_gst).toFixed(2)}</td>
                  <td style={{ padding: '4px 10px', textAlign: 'right' }}>₹{Number(t.gst_amt).toFixed(2)}</td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 700 }}>₹{Number(t.price_w_gst).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {platesTotal(it.plate) > 0 && (
            <div style={{ fontSize: 10, padding: '4px 10px', color: '#555' }}>One-time plate cost: <strong>₹{inr(platesTotal(it.plate))}</strong></div>
          )}
        </div>
      ))}

      {['value_add', 'terms', 'basic_note', 'service'].map((k) => (
        quote.fine_print?.[k] ? <div key={k} style={{ fontSize: 10, color: '#444', marginBottom: 4 }}>{quote.fine_print[k]}</div> : null
      ))}
      {quote.notes ? <div style={{ fontSize: 10, color: '#444', marginTop: 8 }}><strong>Notes:</strong> {quote.notes}</div> : null}
      <div style={{ fontSize: 9, color: '#888', marginTop: 16, borderTop: '1px solid #eee', paddingTop: 6 }}>
        For {COMPANY.name} · This quotation supersedes earlier versions for the same SKUs.
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
