import { useMemo, useState, useRef, useEffect } from 'react';
import { useData } from '../data.jsx';
import { invBalance, gstBreakup } from '../lib/calc.js';
import { getPM } from '../lib/pricing.js';
import { ordersApi } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { getCustByLoc, getCustLocations } from '../lib/master.js';
import { today, fmtDate, rupees, dash } from '../lib/format.js';
import { nextInvNo } from '../lib/seq.js';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import PackingListModal from '../components/PackingListModal.jsx';
import PortalEntry from '../components/PortalEntry.jsx';
import ProformaModal from '../components/ProformaModal.jsx';
import { CertificateDoc } from '../components/CertificatePanel.jsx';
import { printElement, elementToPDF } from '../lib/pdf.js';
import { saveInvoicePdf } from '../lib/invoicePdf.js';
import { getCert } from '../lib/cert.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const emptyHeader = (lastInvNo) => ({
  ivNo: nextInvNo(lastInvNo).no, ivDt: today(), po: '', transporter: '', dcNo: '', vehicle: '', driver: '',
  placeOfSupply: '', warehouseName: '', paymentTerms: '30 days', freight: '0', gstType: 'IGST',
  customer: '', billingAddr: '', shippingAddr: '', billingGstin: '', shippingGstin: '', contactPerson: '', contactNo: '',
});

/** Invoice — builder + A4 tax invoice + confirm→OAB + register (native port, legacy 1983–2365). */
export default function Invoice() {
  const { mods, reloadModule } = useData();
  const [h, setH] = useState(() => emptyHeader(mods.oab && mods.oab.lastInvNo));
  const [lines, setLines] = useState({});   // { [so]: {checked, qty, rate} }
  const [posOptions, setPosOptions] = useState([]);   // Place-of-Supply choices for the picked PO
  const [pendInv, setPendInv] = useState(null);
  const [plItems, setPlItems] = useState([]);
  const [showPL, setShowPL] = useState(false);
  const [showProforma, setShowProforma] = useState(false);
  const [autoPdf, setAutoPdf] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const docRef = useRef(null);

  // The invoice register now comes from the normalized /api/invoices endpoint (each
  // row's `payload` is the exact register entry, so View/PDF/packing-list are
  // unchanged). The SO picker and jss/prices/customers still read the blob context.
  const { data: regData, refetch: refetchRegister } = useApi('/api/invoices?limit=500');
  const register = useMemo(() => (Array.isArray(regData) ? regData : []).map((r) => {
    const p = r.payload ?? r.PAYLOAD;
    if (p) { try { return JSON.parse(p); } catch { /* fall back to the flat columns */ } }
    return r;
  }), [regData]);

  const set = (patch) => setH((x) => ({ ...x, ...patch }));
  const flash = (text, t = 'g') => { setMsg({ text, t }); setTimeout(() => setMsg(null), 6000); };

  const pos = useMemo(() => [...new Set(['SF', 'OT'].flatMap((k) => (mods.oab?.OAB?.[k] || []).map((r) => r.poNum)).filter(Boolean))].sort(), [mods.oab]);
  const poRows = useMemo(() => (h.po ? ['SF', 'OT'].flatMap((k) => (mods.oab?.OAB?.[k] || [])).filter((r) => r.poNum === h.po) : []), [mods.oab, h.po]);

  function onSelectPO(po) {
    const rows = ['SF', 'OT'].flatMap((k) => (mods.oab?.OAB?.[k] || [])).filter((r) => r.poNum === po);
    const first = rows[0] || {};
    const cu = first.customer || '';
    const loc = first.dispLoc || '';
    const cm = getCustByLoc(mods.customers, cu, loc) || getCustLocations(mods.customers, cu)[0] || null;
    const locs = getCustLocations(mods.customers, cu);
    // Place of Supply is picked from the customer's dispatch locations, defaulting to
    // the warehouse the SO was created against. (onInvPO)
    const defWH = first.warehouseName || loc || '';
    const opts = locs.length
      ? locs.map((l) => ({ value: l.warehouseName || l.dispatchLoc, label: (l.warehouseName ? l.warehouseName + ' — ' : '') + l.dispatchLoc }))
      : (loc ? [{ value: loc, label: loc }] : []);
    const match = opts.find((o) => o.value === defWH || o.label.includes(defWH));
    const placeOfSupply = (match && match.value) || (opts[0] && opts[0].value) || '';
    const warehouseName = (cm && cm.warehouseName) || first.warehouseName || '';
    const billingGstin = (cm && cm.gstin) || '';
    setH((x) => ({
      ...x, po, customer: cu, placeOfSupply, warehouseName,
      billingAddr: (cm && cm.billingAddr) || x.billingAddr,
      shippingAddr: (cm && (cm.shippingAddr || cm.billingAddr)) || x.shippingAddr,
      billingGstin, shippingGstin: billingGstin,
      contactPerson: (cm && cm.contactPerson) || x.contactPerson,
      contactNo: (cm && cm.contactPhone) || x.contactNo,
      // Intra-state (buyer GSTIN starts with seller state code 36) => CGST+SGST, else IGST.
      gstType: billingGstin ? (billingGstin.startsWith('36') ? 'CGST_SGST' : 'IGST') : x.gstType,
    }));
    const l = {};
    rows.forEach((r) => { l[r.so] = { checked: false, qty: '', fg: '', rate: getPM(r.spec, mods.prices).price || '' }; });
    setLines(l);
    setPosOptions(opts);
    setPendInv(null);
  }

  const setLine = (so, patch) => setLines((l) => ({ ...l, [so]: { ...l[so], ...patch } }));

  function generate() {
    if (!h.ivNo.trim()) return alert('Enter Invoice Number');
    if (register.some((inv) => inv.no === h.ivNo.trim())) return alert('Invoice number ' + h.ivNo + ' already exists.');
    if (!h.ivDt) return alert('Enter Invoice Date');
    if (!h.transporter.trim()) return alert('Enter Transporter Name');
    if (!h.placeOfSupply.trim()) return alert('Enter Place of Supply');
    const chosen = poRows.filter((r) => lines[r.so] && lines[r.so].checked);
    if (!chosen.length) return alert('Select at least one SKU');
    const out = [];
    for (const r of chosen) {
      const e = lines[r.so];
      const qty = num(e.qty), rate = num(e.rate);
      const b = invBalance(r);
      // FG allocated to this SO is consumed automatically, up to the invoice qty —
      // it is never entered by hand. (buildInvoice)
      const fgToUse = Math.min(qty, num(r.fg));
      if (qty <= 0) return alert('Enter qty > 0 for: ' + (r.jobName || r.spec));
      if (qty > b) return alert(`Invoice qty (${qty.toLocaleString('en-IN')}) exceeds available balance (${b.toLocaleString('en-IN')}) for:\n${r.jobName || r.spec}`);
      out.push({
        key: r.jobType === 'StayFresh' ? 'SF' : 'OT', so: r.so, spec: r.spec, jobName: r.jobName,
        qty, rate, fgToUse, lineTotal: qty * rate, dispatchForm: r.dispatchForm || '',
        // The printed sheet shows the PO date and falls back to the dispatch location
        // for a missing Ship To, so both travel with the line. (renderInvoiceDoc)
        poDate: r.poDate || '', dispLoc: r.dispLoc || '',
      });
    }
    setPendInv(out);
    window.scrollTo({ top: docRef.current ? docRef.current.offsetTop : 0, behavior: 'smooth' });
  }

  async function confirm() {
    if (!pendInv) return;
    setBusy(true);
    try {
      // The server recomputes total/GST/margin, bumps invDisp and consumes FG in one
      // transaction (client amounts are ignored). The invoice NUMBER is now sent: the
      // server keeps its atomic counter but honours a manually-entered number when it's
      // ahead of the counter (to correct a series that fell behind manual invoicing) and
      // jumps the counter past it, so the next number continues forward, never back.
      const header = {
        invNo: h.ivNo.trim(),
        po: h.po, date: h.ivDt, customer: h.customer, placeOfSupply: h.placeOfSupply,
        billingAddr: h.billingAddr, shippingAddr: h.shippingAddr, billingGstin: h.billingGstin,
        shippingGstin: h.shippingGstin, contactPerson: h.contactPerson, contactNo: h.contactNo,
        transporter: h.transporter, dcNo: h.dcNo, vehicle: h.vehicle, driver: h.driver,
        paymentTerms: h.paymentTerms, freight: num(h.freight), gstType: h.gstType,
      };
      const lines = pendInv.map((p) => ({
        so: p.so, spec: p.spec, jobName: p.jobName, qty: p.qty, rate: p.rate,
        fgToUse: p.fgToUse, dispatchForm: p.dispatchForm,
      }));
      const resp = await ordersApi.createInvoice({ header, lines, packingList: plItems.length ? clone(plItems) : [] });
      await reloadModule('oab');       // refresh SO balances (invDisp/fg) on the picker
      await refetchRegister();          // pull the new invoice into the register
      const newNo = (resp && resp.no) || '';
      const m = /(\d+)$/.exec(newNo);
      const lastN = m ? parseInt(m[1], 10) : 0;
      flash('✅ Invoice ' + newNo + ' confirmed — dispatched qty updated. Next invoice: ' + nextInvNo(lastN).no);
      setPendInv(null); setPlItems([]); setLines({});
      setH(emptyHeader(lastN));
    } catch (e) {
      flash('Confirm failed: ' + e.message, 'r');
    } finally {
      setBusy(false);
    }
  }

  // Capture the rendered #inv-doc — the same document the screen and the printer
  // show — at the 300-dpi-class settings production uses. (saveInvoicePDF)
  async function savePDF() {
    setPdfBusy(true);
    try { await saveInvoicePdf(docRef.current, h.ivNo || 'invoice', h.customer); }
    catch (e) { alert('PDF error: ' + e.message); }
    finally { setPdfBusy(false); }
  }

  // Re-open a register invoice into the preview (and optionally auto-download).
  function loadRegister(entry, pdf = false) {
    const hdr = {
      ivNo: entry.no, ivDt: entry.date, po: entry.po, customer: entry.customer, placeOfSupply: entry.pos,
      billingAddr: entry.billingAddr, shippingAddr: entry.shipAddr, contactPerson: entry.contact, contactNo: entry.contactNo,
      ...(entry.header || {}),
    };
    const lns = (entry.items || []).map((it) => ({ spec: it.spec, jobName: it.jobName || it.spec, qty: it.qty, rate: it.rate, dispatchForm: it.dispatchForm, lineTotal: num(it.qty) * num(it.rate) }));
    setPendInv(lns.length ? lns : null);
    setH((x) => ({ ...x, ...hdr }));
    setPlItems(entry.packingList || []);
    setAutoPdf(pdf);
    // Bring the preview into view. Without this the invoice renders above the
    // register but below the current scroll position, so it looks like nothing
    // happened and users refreshed to "escape" (§16). Viewing only, not download.
    if (!pdf) { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { window.scrollTo(0, 0); } }
  }

  useEffect(() => {
    if (autoPdf && pendInv && docRef.current) {
      saveInvoicePdf(docRef.current, h.ivNo || 'invoice', h.customer).catch(() => { /* ignore */ });
      setAutoPdf(false);
    }
  }, [autoPdf, pendInv, h.ivNo, h.customer]);

  return (
    <div id="app">
      <div className="pg-ttl">Invoice</div>
      <div className="pg-sub">Select PO → fill details → pick SKUs &amp; enter prices → generate → print PDF → confirm updates OAB.
        &nbsp;·&nbsp;
        <a href="#" onClick={(e) => { e.preventDefault(); setShowProforma(true); }} style={{ color: 'var(--g)', fontWeight: 600 }}>🧾 Create Proforma Invoice</a>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      {!pendInv && (
        <div className="g3" style={{ alignItems: 'start' }}>
          {/* Col 1 — invoice + transport */}
          <div className="card">
            <div className="ctitle">Invoice Details</div>
            <div className="g2">
              <div className="fg"><label>Invoice Number *</label><input value={h.ivNo} onChange={(e) => set({ ivNo: e.target.value })} /></div>
              <div className="fg"><label>Invoice Date *</label><input type="date" value={h.ivDt} onChange={(e) => set({ ivDt: e.target.value })} /></div>
            </div>
            <div className="fg"><label>PO Number *</label>
              <select value={h.po} onChange={(e) => onSelectPO(e.target.value)}>
                <option value="">— Select PO —</option>{pos.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="g2">
              <div className="fg"><label>Transporter Name *</label><input value={h.transporter} onChange={(e) => set({ transporter: e.target.value })} /></div>
              <div className="fg"><label>DC # / LR #</label><input value={h.dcNo} onChange={(e) => set({ dcNo: e.target.value })} /></div>
            </div>
            <div className="g2">
              <div className="fg"><label>Vehicle Number</label><input value={h.vehicle} onChange={(e) => set({ vehicle: e.target.value })} /></div>
              <div className="fg"><label>Driver Name &amp; Mobile</label><input value={h.driver} onChange={(e) => set({ driver: e.target.value })} /></div>
            </div>
            <div className="g2">
              <div className="fg"><label>Place of Supply *</label>
                <select value={h.placeOfSupply} onChange={(e) => set({ placeOfSupply: e.target.value })}>
                  <option value="">— Select —</option>
                  {posOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="fg"><label>Payment Terms</label><input value={h.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value })} /></div>
            </div>
            <div className="g2">
              <div className="fg"><label>Freight (₹)</label><input type="number" min="0" value={h.freight} onChange={(e) => set({ freight: e.target.value })} /></div>
              <div className="fg"><label>GST Type</label>
                <select value={h.gstType} onChange={(e) => set({ gstType: e.target.value })}>
                  <option value="IGST">IGST 18%</option>
                  <option value="CGST_SGST">CGST 9% + SGST 9%</option>
                </select>
              </div>
            </div>
          </div>

          {/* Col 2 — customer / consignee */}
          <div className="card">
            <div className="ctitle">Customer / Consignee Details</div>
            <div className="fg"><label>Customer Name *</label><input value={h.customer} onChange={(e) => set({ customer: e.target.value })} /></div>
            <div className="fg"><label>Billing Address</label><textarea rows={3} value={h.billingAddr} onChange={(e) => set({ billingAddr: e.target.value })} style={{ height: 'auto', border: '1px solid var(--bd)', borderRadius: 7, padding: '8px 10px', fontSize: 12, resize: 'vertical' }} /></div>
            <div className="fg"><label>Shipping Address (if different)</label><textarea rows={2} value={h.shippingAddr} onChange={(e) => set({ shippingAddr: e.target.value })} style={{ height: 'auto', border: '1px solid var(--bd)', borderRadius: 7, padding: '8px 10px', fontSize: 12, resize: 'vertical' }} /></div>
            <div className="g2">
              <div className="fg"><label>Billing GSTIN</label><input value={h.billingGstin} onChange={(e) => set({ billingGstin: e.target.value })} /></div>
              <div className="fg"><label>Shipping GSTIN</label><input value={h.shippingGstin} onChange={(e) => set({ shippingGstin: e.target.value })} /></div>
            </div>
            <div className="g2">
              <div className="fg"><label>Contact Person</label><input value={h.contactPerson} onChange={(e) => set({ contactPerson: e.target.value })} /></div>
              <div className="fg"><label>Contact Number</label><input value={h.contactNo} onChange={(e) => set({ contactNo: e.target.value })} /></div>
            </div>
          </div>

          {/* Col 3 — SKUs */}
          <div className="card">
            <div className="ctitle">SKUs &amp; Pricing</div>
            {!h.po ? <div style={{ color: 'var(--i3)', padding: 24, textAlign: 'center', fontSize: 13 }}>Select a PO to see its SKUs</div> : (
              <>
                <div style={{ fontSize: 11, color: 'var(--i3)', marginBottom: 10 }}>{poRows.length} SKU(s) — tick, enter qty and rate per piece</div>
                {poRows.map((r) => {
                  const b = invBalance(r);
                  const e = lines[r.so] || {};
                  return (
                    <div key={r.so} style={{ marginBottom: 10, padding: 10, background: 'var(--bg)', borderRadius: 7, border: '1px solid var(--bd)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <input type="checkbox" className="cb" checked={!!e.checked} onChange={(ev) => setLine(r.so, { checked: ev.target.checked })} />
                        <span style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: 600 }}>{r.jobName || r.spec}</div>
                          <div style={{ fontSize: 10, color: 'var(--i3)' }}>SO: {r.so} &nbsp;·&nbsp; Available: <strong style={{ color: b > 0 ? 'var(--red)' : 'var(--g)' }}>{dash(b)}</strong> &nbsp;·&nbsp; FG in stock: <strong style={{ color: '#E67E22' }}>{dash(r.fg)}</strong></div>
                        </span>
                      </label>
                      <div className="g3">
                        <div><div style={{ fontSize: 9, color: 'var(--i3)', marginBottom: 2 }}>Invoice Qty (max {dash(b)})</div>
                          <input type="number" min="1" max={b} placeholder="0" disabled={b <= 0} title={b <= 0 ? 'No balance left' : undefined} value={e.qty ?? ''} onChange={(ev) => setLine(r.so, { qty: ev.target.value })} style={inpS} /></div>
                        {/* FG is consumed automatically up to the invoice qty — read-only,
                            exactly as the .iv-fguse cell is in production. */}
                        <div><div style={{ fontSize: 9, color: 'var(--i3)', marginBottom: 2 }}>FG to be used (auto)</div>
                          <div
                            title={num(r.fg) > 0
                              ? 'FG allocated to this SO is consumed automatically, up to the invoice quantity. Any FG beyond the invoice qty stays with the SO.'
                              : 'No FG allocated to this SO'}
                            style={{ ...inpS, display: 'flex', alignItems: 'center', background: 'var(--bg)', fontWeight: 600, color: num(r.fg) > 0 ? '#E67E22' : 'var(--i3)' }}
                          >{num(r.fg) > 0 ? dash(Math.min(num(e.qty), num(r.fg))) + ' of ' + dash(r.fg) : '—'}</div>
                        </div>
                        <div><div style={{ fontSize: 9, color: 'var(--i3)', marginBottom: 2 }}>Rate per Piece (₹)</div>
                          <input type="number" step="0.01" min="0" placeholder="0.00" value={e.rate ?? ''} onChange={(ev) => setLine(r.so, { rate: ev.target.value })} style={inpS} /></div>
                      </div>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <button className="btn btn-g" onClick={generate}>Generate Invoice →</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {pendInv && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-s" onClick={() => setPendInv(null)}>← Back to Edit</button>
            <button className="btn btn-g" onClick={savePDF} disabled={pdfBusy}>{pdfBusy ? 'Generating PDF…' : '⬇ Save as PDF'}</button>
            <button className="btn btn-s" onClick={() => printElement(docRef.current)}>🖨 Print</button>
            <button className="btn btn-b" onClick={confirm} disabled={busy}>{busy ? 'Saving…' : '✓ Confirm & Update OAB'}</button>
            <button className="btn btn-s" style={{ background: 'var(--gl)', color: 'var(--g)', border: '1px solid var(--g)' }}
              onClick={() => { if (!plItems.length) setPlItems(pendInv.map((p) => ({ spec: p.spec, jobName: p.jobName, totalQty: p.qty, dispatchForm: p.dispatchForm, bags: [{ from: 1, to: '', qty: '' }] }))); setShowPL(true); }}>📦 Create Packing List</button>
          </div>
          <PortalEntry header={h} lines={pendInv} />
          <InvoiceDoc ref={docRef} header={h} lines={pendInv} />
        </div>
      )}

      <Register
        po={h.po}
        register={register}
        onView={(e) => loadRegister(e, false)}
        onPdf={(e) => loadRegister(e, true)}
        // Load the invoice, then open its packing list — the register's PL button
        // must work on an invoice that is not currently in the builder.
        onPackingList={(e) => { loadRegister(e, false); setShowPL(true); }}
      />

      {showPL && (
        <PackingListModal
          items={plItems} setItems={setPlItems} invNo={h.ivNo}
          header={h} lines={pendInv || []}
          onClose={() => setShowPL(false)}
        />
      )}
      {showProforma && <ProformaModal onClose={() => setShowProforma(false)} />}
    </div>
  );
}

const inpS = { width: '100%', height: 30, border: '1px solid var(--bd)', borderRadius: 6, padding: '0 8px', fontSize: 12 };

function periodRange(period) {
  const now = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  const p = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (period === 'thismonth') return [p(new Date(now.getFullYear(), now.getMonth(), 1)), p(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  if (period === 'lastmonth') return [p(new Date(now.getFullYear(), now.getMonth() - 1, 1)), p(new Date(now.getFullYear(), now.getMonth(), 0))];
  return ['', ''];
}

/**
 * Certificate status for one register row — mirrors the monolith's invCertCell.
 * Hourglass while nothing is issued, a dot when some invoice lines are certified,
 * a tick when all are. Certificates themselves are raised in QC -> Certificates.
 */
function certState(inv, type) {
  const items = (inv.items && inv.items.length) ? inv.items : [{ spec: inv.spec || '' }];
  const done = items.filter((it) => {
    const c = inv.certs && inv.certs[`${type}|${it.spec || ''}`];
    return c && c.done;
  });
  if (!done.length) return { mark: '⏳', any: false, all: false };
  const all = done.length >= items.length;
  return { mark: all ? '✓' : '●', any: true, all };
}

function CertBadge({ inv, type, label, onDownload }) {
  const st = certState(inv, type);
  const base = {
    display: 'inline-block', height: 20, lineHeight: '18px', padding: '0 7px', margin: '0 2px',
    borderRadius: 10, fontSize: 9, fontWeight: 700,
  };
  // Pending: a static red badge, nothing to download yet.
  if (!st.any) {
    return (
      <span
        title={`${label} not issued yet`}
        style={{ ...base, background: 'transparent', color: 'var(--red)', border: '1px solid transparent' }}
      >{label} {st.mark}</span>
    );
  }
  // Issued: a clickable button that regenerates and downloads the stored certificate
  // PDF (legacy invCertCell / genCertStored). ● = some lines, ✓ = all lines.
  return (
    <button
      type="button"
      aria-label={`Download ${label} for invoice ${inv.no}`}
      title={`Download ${label}${st.all ? '' : ' (issued for some lines)'}`}
      onClick={() => onDownload(inv, type)}
      style={{ ...base, cursor: 'pointer', background: 'var(--gl)', color: 'var(--g)', border: '1px solid var(--gm)' }}
    >{label} {st.mark}</button>
  );
}

function Register({ po, register, onView, onPdf, onPackingList }) {
  const [period, setPeriod] = useState('thismonth');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [poFilter, setPoFilter] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('newest');
  const [certJob, setCertJob] = useState(null);   // { line, type, data } for the hidden cert capture
  const certRef = useRef(null);
  // A specific-PO lookup always shows that PO's full history regardless of the period
  // filter — a deliberate, narrow lookup rather than the general browse view, and the
  // filter bar is hidden while it is scoped. (renderInvRegisterForPO)
  const scoped = !!po;
  const reg = scoped ? (register || []).filter((e) => e.po === po) : (register || []);
  const [rFrom, rTo] = scoped ? ['', ''] : period === 'custom' ? [from, to] : period === 'all' ? ['', ''] : periodRange(period);

  // Every PO present in the register, for the PO filter. (_invRegPopulatePOs)
  const pos = useMemo(
    () => [...new Set(reg.map((e) => e.po).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b))),
    [reg],
  );

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const out = reg.filter((e) => {
      if (rFrom && e.date < rFrom) return false;
      if (rTo && e.date > rTo) return false;
      if (poFilter && e.po !== poFilter) return false;
      if (t && ![e.no, e.po, e.customer].some((v) => String(v || '').toLowerCase().includes(t))) return false;
      return true;
    });
    return out.sort((a, b) => (sort === 'newest'
      ? String(b.date || '').localeCompare(String(a.date || ''))
      : String(a.date || '').localeCompare(String(b.date || ''))));
  }, [reg, rFrom, rTo, poFilter, q, sort]);

  // Regenerate a stored certificate PDF for an invoice line (legacy genCertStored):
  // find the first invoice line that carries this cert type, then render the saved
  // certificate data into a hidden CertificateDoc and capture it.
  function downloadCert(inv, type) {
    const items = (inv.items && inv.items.length) ? inv.items : [{ spec: inv.spec || '' }];
    const item = items.find((it) => getCert(inv, type, it.spec || ''));
    if (!item) return;
    const spec = item.spec || '';
    const rec = getCert(inv, type, spec);
    if (!rec || !rec.data) {
      // Status says a cert exists but the data was never saved — legacy guards the same.
      alert('Certificate not saved yet — open QC → Certificates, fill it in and Submit.');
      return;
    }
    setCertJob({ line: { invoice: inv, item, spec, invNo: inv.no, customer: inv.customer || '' }, type, data: rec.data });
  }

  useEffect(() => {
    if (!certJob || !certRef.current) return;
    const { type, line } = certJob;
    elementToPDF(certRef.current, `${type.toUpperCase()}_${String(line.invNo).replace(/[^\w-]+/g, '_')}_${line.spec}`)
      .catch((e) => alert('PDF error: ' + (e && e.message ? e.message : e)))
      .finally(() => setCertJob(null));
  }, [certJob]);

  return (
    <div style={{ marginTop: 24 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
          <div className="ctitle" style={{ marginBottom: 0 }}>{scoped ? 'Previous Invoices for PO: ' + po : 'Invoice Register'}</div>
          <div style={{ display: scoped ? 'none' : 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={period} aria-label="Period" onChange={(e) => setPeriod(e.target.value)} style={{ height: 30 }}>
              <option value="thismonth">This Month</option><option value="lastmonth">Last Month</option>
              <option value="custom">Custom Range</option><option value="all">All Time</option>
            </select>
            {period === 'custom' && <><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ height: 30 }} /><span style={{ fontSize: 12, color: 'var(--i3)' }}>to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ height: 30 }} /></>}
            <select value={poFilter} aria-label="Filter by PO" onChange={(e) => setPoFilter(e.target.value)} style={{ height: 30 }}>
              <option value="">All POs</option>
              {pos.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={sort} aria-label="Sort invoices" onChange={(e) => setSort(e.target.value)} style={{ height: 30 }}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            <input
              type="text" value={q} placeholder="Search invoice # / PO / customer…"
              aria-label="Search invoices" onChange={(e) => setQ(e.target.value)} style={{ height: 30, width: 220 }}
            />
            <span style={{ fontSize: 11, color: 'var(--i3)' }}>
              {rows.length} invoice{rows.length === 1 ? '' : 's'}
              {poFilter ? ' · PO ' + poFilter : q.trim() ? ' · matching "' + q.trim() + '"' : ''}
            </span>
          </div>
        </div>
        <div className="tw sy" style={{ maxHeight: 300 }}>
          <table>
            <thead><tr>
              <th>Invoice No</th><th>Date</th><th>PO #</th><th>Customer</th>
              <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Amount</th>
              <th style={{ textAlign: 'center' }}>Certificates</th><th style={{ textAlign: 'center' }}>PDF</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>{
                scoped ? 'No invoices for PO ' + po
                  : poFilter ? 'No invoices for PO ' + poFilter
                    : q.trim() ? 'No invoices match your search'
                      : 'No invoices in this period — try "Last Month" or "All Time" above'
              }</td></tr>
                : rows.map((e, i) => (
                  <tr key={e.no + i}>
                    {/* The invoice number itself opens the invoice, as in production. */}
                    <td>
                      <button
                        aria-label={`Open invoice ${e.no}`} onClick={() => onView(e)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--blu)', fontWeight: 700, fontSize: 12 }}
                      >{e.no}</button>
                    </td>
                    <td>{fmtDate(e.date)}</td><td style={{ fontSize: 11 }}>{e.po}</td><td style={{ fontSize: 11 }}>{e.customer}</td>
                    <td style={{ textAlign: 'right' }}>{dash(e.qty)}</td><td style={{ textAlign: 'right' }}>{rupees(e.amount)}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <CertBadge inv={e} type="coa" label="COA" onDownload={downloadCert} />
                      <CertBadge inv={e} type="fg" label="FG" onDownload={downloadCert} />
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }} aria-label={`PDF for ${e.no}`} onClick={() => onPdf(e)}>⬇ PDF</button>{' '}
                      <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }} aria-label={`Packing list for ${e.no}`} onClick={() => onPackingList(e)}>📦 PL</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      {/* Off-screen certificate, rendered only while a download is in flight, so the
          same CertificateDoc the QC screen prints is captured to PDF here too. */}
      {certJob && (
        <div style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }} aria-hidden="true">
          <CertificateDoc line={certJob.line} type={certJob.type} data={certJob.data} innerRef={certRef} />
        </div>
      )}
    </div>
  );
}
