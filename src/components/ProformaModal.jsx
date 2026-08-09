import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { getPM } from '../lib/pricing.js';
import { gstBreakup } from '../lib/calc.js';
import { getCustLocations, getCustByLoc, jssCustomers } from '../lib/master.js';
import { today, fmtDate, rupees, inr } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { saveInvoicePdf } from '../lib/invoicePdf.js';

// Proforma Invoice generator (native port of the legacy showProformaModal / pf*).
// A standalone quote / advance-payment document — NOT linked to OAB orders. Same
// GST math as the tax invoice; exports Excel + a vector PDF (proforma variant).

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isTelangana = (cm) => {
  const s = String((cm && (cm.state || cm.billingAddr)) || '').toLowerCase();
  return s.includes('telangana') || s.includes('hyderabad') || (cm && cm.gstin && String(cm.gstin).startsWith('36'));
};
const newProformaNo = () => 'PF/' + new Date().getFullYear() + '/' + (Math.floor(Math.random() * 900) + 100);
const blankRow = () => ({ spec: '', qty: '', rate: '' });

export default function ProformaModal({ onClose }) {
  const { mods } = useData();
  const jss = Array.isArray(mods.jss) ? mods.jss : [];

  const [f, setF] = useState(() => ({
    no: newProformaNo(), date: today(), pt: '30 days', gstType: 'IGST',
    customer: '', subBrand: '', loc: '',
    billingAddr: '', shippingAddr: '', billingGstin: '', shippingGstin: '',
    contactPerson: '', contactNo: '', freight: '0', notes: '',
  }));
  const [rows, setRows] = useState([blankRow()]);
  const [msg, setMsg] = useState(null);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 5000); };

  // Customer list = union of JSS customers and the Customer Master.
  const customers = useMemo(() => {
    const fromCust = (mods.customers || []).map((c) => c.customer);
    return [...new Set([...jssCustomers(jss), ...fromCust])].filter(Boolean).sort();
  }, [jss, mods.customers]);

  const locations = useMemo(() => getCustLocations(mods.customers, f.customer), [mods.customers, f.customer]);
  const subBrands = useMemo(() => [...new Set(jss.filter((j) => (!f.customer || j.customer === f.customer) && j.status === 'Active' && j.subBrand).map((j) => j.subBrand))].sort(), [jss, f.customer]);
  const skuOptions = useMemo(() => jss.filter((j) => (!f.customer || j.customer === f.customer) && (!f.subBrand || j.subBrand === f.subBrand) && j.status === 'Active'), [jss, f.customer, f.subBrand]);

  function onCustomer(cu) {
    set({ customer: cu, loc: '', subBrand: '', billingAddr: '', shippingAddr: '', billingGstin: '', shippingGstin: '', contactPerson: '', contactNo: '' });
  }
  function onLoc(loc) {
    const cm = f.customer && loc ? getCustByLoc(mods.customers, f.customer, loc) : null;
    if (cm) set({
      loc, billingAddr: cm.billingAddr || '', shippingAddr: cm.shippingAddr || cm.billingAddr || '',
      billingGstin: cm.gstin || '', shippingGstin: cm.gstin || '', contactPerson: cm.contactPerson || '',
      contactNo: cm.contactPhone || '', gstType: isTelangana(cm) ? 'CGST_SGST' : 'IGST',
    });
    else set({ loc });
  }
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  function onSku(i, spec) {
    const rate = spec ? (getPM(spec, mods.prices).price || 0) : 0;
    setRow(i, { spec, rate: spec ? String(rate) : '' });
  }
  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const removeRow = (i) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const jssFor = (spec) => jss.find((j) => j.spec === spec) || {};

  // Money — same 18% GST math as the tax invoice (reuses gstBreakup).
  const calc = useMemo(() => {
    const items = rows.map((r) => ({ ...r, amount: num(r.qty) * num(r.rate) }));
    const subTotal = items.reduce((s, r) => s + r.amount, 0);
    const totQty = items.reduce((s, r) => s + num(r.qty), 0);
    const g = gstBreakup(subTotal, num(f.freight), 18, f.gstType);
    return { items, subTotal, totQty, g };
  }, [rows, f.freight, f.gstType]);

  function validate() {
    if (!f.customer) { flash('r', 'Please select a customer.'); return null; }
    const filled = rows.filter((r) => r.spec || num(r.qty) || num(r.rate));
    if (!filled.length) { flash('r', 'Add at least one SKU with quantity and rate.'); return null; }
    if (filled.some((r) => !r.spec || !num(r.qty))) { flash('r', 'Every item row needs a SKU and a quantity.'); return null; }
    return filled.map((r) => { const j = jssFor(r.spec); return { spec: r.spec, jobName: j.jobName || '', subBrand: j.subBrand || '', dispatchForm: j.dispatchForm || '', qty: num(r.qty), rate: num(r.rate), amount: num(r.qty) * num(r.rate) }; });
  }

  function saveExcel() {
    const items = validate(); if (!items) return;
    const g = calc.g;
    const gstLines = f.gstType === 'IGST' ? [['', '', '', '', 'IGST 18%', g.igst]] : [['', '', '', '', 'CGST 9%', g.cgst], ['', '', '', '', 'SGST 9%', g.sgst]];
    const aoa = [
      ['Bloomflex Private Limited — PROFORMA INVOICE'], [],
      ['Proforma No', f.no, '', 'Date', fmtDate(f.date)],
      ['Customer', f.customer, '', 'Dispatch Location (Ship To)', f.loc || '-'],
      ['Sub Brand', f.subBrand || 'All', '', 'Payment Terms', f.pt],
      ['Billing Address', f.billingAddr || '-', '', 'Billing GSTIN', f.billingGstin || '-'],
      ['Shipping Address', f.shippingAddr || '-', '', 'Shipping GSTIN', f.shippingGstin || '-'],
      ['Contact', f.contactPerson || '-', '', 'Contact No', f.contactNo || '-'],
      ['Special Notes', f.notes || '-'], [],
      ['SKU (Spec)', 'Sub Brand', 'Job Name', 'Qty', 'Rate (₹)', 'Amount (₹)'],
      ...items.map((r) => [r.spec, r.subBrand || '', r.jobName || '', r.qty, r.rate, r.amount]),
      [],
      ['', '', '', 'Total Qty / Sub Total', calc.totQty, g.subTotal],
      ['', '', '', 'Freight', '', g.freight],
      ...gstLines,
      ['', '', '', 'Total Amount', '', g.invAmount],
    ];
    exportAOA(aoa, 'Proforma_' + f.no.replace(/\//g, '-') + '_' + f.customer.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20), 'Proforma');
    flash('g', '✓ Excel downloaded');
  }

  function savePdf() {
    const items = validate(); if (!items) return;
    const header = {
      ivNo: f.no, ivDt: f.date, customer: f.customer, paymentTerms: f.pt, gstType: f.gstType,
      billingAddr: f.billingAddr, shippingAddr: f.shippingAddr, billingGstin: f.billingGstin, shippingGstin: f.shippingGstin, freight: num(f.freight),
    };
    const lines = items.map((r) => ({ spec: r.spec, jobName: r.jobName, qty: r.qty, rate: r.rate, dispatchForm: r.dispatchForm }));
    try { saveInvoicePdf(header, lines, 'Proforma_' + f.no.replace(/\//g, '-'), { proforma: true, notes: f.notes }); flash('g', '✓ PDF downloaded'); }
    catch (e) { flash('r', 'PDF failed: ' + e.message); }
  }

  const g = calc.g;
  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'linear-gradient(180deg,#1B6B3A,#155029)', color: '#fff' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>🧾 Create Proforma Invoice</div>
            <div style={{ fontSize: 11, opacity: 0.85 }}>Not linked to OAB — for quotes / advance-payment requests only</div>
          </div>
          <button className="btn btn-s" onClick={onClose}>✕ Close</button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
          <div className="ctitle" style={{ fontSize: 12, color: '#1B6B3A' }}>Proforma Details</div>
          <div className="g4">
            <div className="fg"><label>Proforma No</label><input value={f.no} onChange={(e) => set({ no: e.target.value })} /></div>
            <div className="fg"><label>Date</label><input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></div>
            <div className="fg"><label>Payment Terms</label><input value={f.pt} onChange={(e) => set({ pt: e.target.value })} /></div>
            <div className="fg"><label>GST Type</label>
              <select value={f.gstType} onChange={(e) => set({ gstType: e.target.value })}>
                <option value="IGST">IGST 18%</option><option value="CGST_SGST">CGST 9% + SGST 9%</option>
              </select>
            </div>
          </div>
          <div className="g3">
            <div className="fg"><label>Customer</label>
              <select value={f.customer} onChange={(e) => onCustomer(e.target.value)}>
                <option value="">— Select Customer —</option>{customers.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="fg"><label>Sub Brand</label>
              <select value={f.subBrand} onChange={(e) => set({ subBrand: e.target.value })}>
                <option value="">All Sub Brands</option>{subBrands.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="fg"><label>Dispatch Location (Ship To)</label>
              <select value={f.loc} onChange={(e) => onLoc(e.target.value)}>
                <option value="">{f.customer ? '— Select Location —' : '— Select Customer First —'}</option>
                {locations.map((l) => <option key={l.dispatchLoc} value={l.dispatchLoc}>{l.dispatchLoc}{l.warehouseName ? ` (${l.warehouseName})` : ''}</option>)}
              </select>
            </div>
          </div>

          <div className="ctitle" style={{ fontSize: 12, color: '#1B6B3A' }}>Customer / Consignee Details</div>
          <div className="g2">
            <div className="fg"><label>Billing Address</label><textarea rows={2} value={f.billingAddr} onChange={(e) => set({ billingAddr: e.target.value })} /></div>
            <div className="fg"><label>Shipping Address (if different)</label><textarea rows={2} value={f.shippingAddr} onChange={(e) => set({ shippingAddr: e.target.value })} /></div>
          </div>
          <div className="g4">
            <div className="fg"><label>Billing GSTIN</label><input value={f.billingGstin} onChange={(e) => set({ billingGstin: e.target.value })} /></div>
            <div className="fg"><label>Shipping GSTIN</label><input value={f.shippingGstin} onChange={(e) => set({ shippingGstin: e.target.value })} /></div>
            <div className="fg"><label>Contact Person</label><input value={f.contactPerson} onChange={(e) => set({ contactPerson: e.target.value })} /></div>
            <div className="fg"><label>Contact Number</label><input value={f.contactNo} onChange={(e) => set({ contactNo: e.target.value })} /></div>
          </div>
          <div className="g2">
            <div className="fg"><label>Freight (₹)</label><input type="number" min="0" value={f.freight} onChange={(e) => set({ freight: e.target.value })} /></div>
            <div className="fg"><label>Special Notes</label><textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Printed on the PDF above the signature block" /></div>
          </div>

          <div className="ctitle" style={{ fontSize: 12, color: '#1B6B3A' }}>SKUs &amp; Pricing</div>
          <div className="tw">
            <table>
              <thead><tr><th style={{ minWidth: 220 }}>SKU (Spec)</th><th style={{ textAlign: 'right', width: 90 }}>Qty</th><th style={{ textAlign: 'right', width: 110 }}>Rate (₹)</th><th style={{ textAlign: 'right', width: 120 }}>Amount (₹)</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <select value={r.spec} onChange={(e) => onSku(i, e.target.value)} style={{ width: '100%' }}>
                        <option value="">— Select SKU —</option>
                        {skuOptions.map((j) => <option key={j.spec} value={j.spec}>{j.spec}{j.jobName ? ' — ' + j.jobName : ''}{j.subBrand ? ' [' + j.subBrand + ']' : ''}</option>)}
                      </select>
                    </td>
                    <td><input type="number" min="0" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} style={{ width: '100%', textAlign: 'right' }} /></td>
                    <td><input type="number" step="0.01" min="0" value={r.rate} onChange={(e) => setRow(i, { rate: e.target.value })} style={{ width: '100%', textAlign: 'right' }} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupees(num(r.qty) * num(r.rate))}</td>
                    <td style={{ textAlign: 'center' }}><button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 6px', color: 'var(--red)' }} onClick={() => removeRow(i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-s" onClick={addRow} style={{ marginTop: 8 }}>+ Add Item</button>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <div style={{ minWidth: 280 }}>
              <Row k="Total Qty" v={inr(calc.totQty)} />
              <Row k="Sub Total" v={rupees(g.subTotal)} />
              <Row k="Freight" v={num(f.freight) > 0 ? rupees(g.freight) : '-'} />
              {f.gstType === 'IGST' ? <Row k="IGST 18%" v={rupees(g.igst)} /> : <><Row k="CGST 9%" v={rupees(g.cgst)} /><Row k="SGST 9%" v={rupees(g.sgst)} /></>}
              {g.roundOff !== 0 && <Row k="Round Off" v={rupees(g.roundOff)} />}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--bd)', fontWeight: 800, color: '#1B6B3A', fontSize: 14 }}><span>Total Amount</span><span>{rupees(g.invAmount)}</span></div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn btn-s" style={{ background: '#217346', color: '#fff' }} onClick={saveExcel}>⬇ Save as Excel</button>
            <button className="btn btn-g" onClick={savePdf}>⬇ Save as PDF</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12, color: '#555' }}><span>{k}</span><span>{v}</span></div>;
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 9500, overflow: 'auto', padding: '24px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' };
const sheet = { maxWidth: 1080, width: '100%', background: '#fff', borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,0.35)', overflow: 'hidden', margin: 'auto' };
