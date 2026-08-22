import { useRef } from 'react';
import { inr, amountInWords } from '../lib/format.js';
import { num } from '../lib/calc.js';
import { printElement } from '../lib/pdf.js';
import { PO_ISSUER } from '../lib/company.js';
import { PURCH_LOGO } from '../lib/purchLogo.js';
import { saveDocPdf } from '../lib/invoicePdf.js';

// Printable Purchase Order document — port of pvBuildPODocHTML / pvDownloadPOPDF.
// Rendered at the monolith's fixed 794px width and captured with the same settings
// production uses, so the PDF a supplier receives is the sheet the client already sends.

/** The PO sheet dates as DD.MM.YYYY, not the app-wide DD/MM/YYYY. (pvDateStr) */
function poDate(v) {
  if (!v) return '-';
  const d = new Date(String(v) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '-';
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
}

/** "Rupees: … ONLY", uppercase, as the total row prints it. (pvToWords) */
function poWords(n) {
  if (!n || n <= 0) return '';
  return 'Rupees: ' + amountInWords(n).replace(/ Only$/i, '').toUpperCase() + ' ONLY';
}

export function poTotals(po, asl) {
  const items = Array.isArray(po?.items) ? po.items : [];
  const gstPct = num(po?.gstPercent);
  const subTotal = items.reduce((s, i) => s + num(i.amount), 0);
  const gstAmt = subTotal * gstPct / 100;
  // Supplier-level fields (address/phone/email/gstn/contact) are carried on the
  // supplier's ASL rows. A brand-new supplier can have an item-less placeholder
  // row first, so prefer the first row that actually holds contact details and
  // fall back to the first matching row (legacy pvBuildPODocHTML uses .find).
  const matches = (asl || []).filter((r) => r.company === po?.supplier);
  const supplier = matches.find((r) => r.address || r.gstn || r.phone || r.email || r.contact || r.contact2 || r.phone2 || r.pincode) || matches[0] || {};
  return { items, gstPct, subTotal, gstAmt, grandTotal: subTotal + gstAmt, supplier };
}

const cell = { padding: '4px 5px', borderBottom: '0.5px solid #dde3f0' };
const tcLabel = { background: '#e8f0fe', fontWeight: 700, border: '0.5px solid #c0cce0', padding: '3px 6px', whiteSpace: 'nowrap' };
const tcVal = { border: '0.5px solid #c0cce0', padding: '3px 6px' };
const th = { padding: '5px 5px', fontSize: 9.5 };
const addrHead = { background: '#1a3a6b', color: '#fff', textAlign: 'center', fontSize: 9.5, fontWeight: 800, padding: 3, margin: '-6px -10px 5px', letterSpacing: '0.05em' };

/** The document itself — laid out at a fixed A4-ish width so the PDF is stable. */
export function PurchaseOrderDoc({ po, asl, innerRef }) {
  const { items, gstPct, subTotal, grandTotal, supplier } = poTotals(po, asl);
  return (
    <div ref={innerRef} style={{ width: 794, background: '#fff', color: '#111', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ border: '2px solid #1a3a6b', minHeight: 1100, display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: '#1a3a6b', color: '#fff', display: 'flex', alignItems: 'stretch', height: 90, flexShrink: 0 }}>
          <div style={{ background: '#fff', padding: '4px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 190, flexShrink: 0 }}>
            <img src={PURCH_LOGO} alt="Bloomflex" style={{ width: 170, height: 82, objectFit: 'contain' }} />
          </div>
          <div style={{ flex: 1, borderLeft: '1px solid rgba(255,255,255,0.25)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '8px 16px' }}>
            <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: 1 }}>{PO_ISSUER.name}</div>
            <div style={{ fontSize: 8.5, opacity: 0.75, marginTop: 3 }}>
              {PO_ISSUER.address} &nbsp;|&nbsp; GST: {PO_ISSUER.gstin} &nbsp;|&nbsp; PAN: {PO_ISSUER.pan}
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, textDecoration: 'underline', letterSpacing: 3, marginTop: 6 }}>PURCHASE ORDER</div>
          </div>
        </div>

        <div style={{ background: '#0e7c6e', color: '#fff', padding: '5px 14px', display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontWeight: 700 }}>
          <span>PO No: {po?.poNum}</span><span>Date: {poDate(po?.poDate)}</span>
        </div>

        <div style={{ padding: '8px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ border: '1px solid #c5d3f0', background: '#e8f0fe', borderRadius: 3, padding: '6px 12px', lineHeight: 1.7, fontSize: 10.5 }}>
            <div><strong>To,</strong></div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#1a3a6b' }}>M/s. {po?.supplier || '-'}</div>
            {supplier.address ? <div>{supplier.address}</div> : null}
            {supplier.phone ? <div>Mob. No.: {supplier.phone}</div> : null}
            {supplier.email ? <div>Email ID: {supplier.email}</div> : null}
            {supplier.gstn ? <div>GST No.: <strong>{supplier.gstn}</strong></div> : null}
            {supplier.contact ? <div style={{ marginTop: 4, fontWeight: 700, color: '#1a3a6b' }}>Kind Attention: {supplier.contact}</div> : null}
          </div>

          {po?.notes ? (
            <div style={{ fontSize: 9.5, color: '#333', lineHeight: 1.5, padding: '4px 8px', background: '#f8f9fb', borderLeft: '3px solid #0e7c6e' }}>{po.notes}</div>
          ) : null}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead><tr style={{ background: '#1a3a6b', color: '#fff' }}>
              <th style={{ ...th, textAlign: 'center', width: 24 }}>Sl.</th>
              <th style={{ ...th, textAlign: 'left' }}>Item Description</th>
              <th style={{ ...th, textAlign: 'center', width: 50 }}>UOM</th>
              <th style={{ ...th, textAlign: 'center', width: 55 }}>Qty.</th>
              <th style={{ ...th, textAlign: 'center', width: 76 }}>Unit Price</th>
              <th style={{ ...th, textAlign: 'right', width: 100 }}>Amount</th>
            </tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} style={{ background: i % 2 ? '#f0f4ff' : '#fff' }}>
                  <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
                  <td style={{ ...cell, textAlign: 'left' }}><strong>{it.item}</strong></td>
                  <td style={{ ...cell, textAlign: 'center' }}>{it.unit || '-'}</td>
                  <td style={{ ...cell, textAlign: 'center' }}>{inr(it.qty)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{num(it.rate).toFixed(2)}</td>
                  <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}><strong>{inr(it.amount, 2)}</strong></td>
                </tr>
              ))}
              <tr style={{ background: '#e8f0fe' }}>
                <td colSpan={4} style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>Sub Total</td>
                <td style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>GST {gstPct}%</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{inr(subTotal, 2)}</td>
              </tr>
              <tr style={{ background: '#1a3a6b', color: '#fff' }}>
                <td colSpan={4} style={{ padding: '4px 6px', fontStyle: 'italic', fontSize: 9, textAlign: 'left' }}>
                  {poWords(grandTotal)}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 800 }}>Total</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>Rs.&nbsp;{inr(grandTotal, 2)}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ background: '#1a3a6b', color: '#fff', textAlign: 'center', fontSize: 10, fontWeight: 800, padding: 4, letterSpacing: '0.06em', textDecoration: 'underline' }}>TERMS &amp; CONDITIONS</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9.5 }}>
            <tbody>
              <tr><td style={{ ...tcLabel, width: '20%' }}>EXPECTED DELIVERY</td><td style={tcVal} colSpan={3}>{poDate(po?.expectedDelivery)}</td></tr>
              <tr>
                <td style={tcLabel}>PACKING</td><td style={tcVal}>Price is inclusive of packing</td>
                <td style={tcLabel}>TEST REPORTS</td><td style={tcVal}>TDS, MSDS &amp; Food grade certificates to be furnished along with the material</td>
              </tr>
              <tr><td style={{ ...tcLabel, verticalAlign: 'top' }}>QUALITY ASSURANCE</td><td colSpan={3} style={tcVal}>Any physical or production defect to be replaced at your cost. These terms are valid only for execution of this order; prices quoted are firm till completion of supply and services.</td></tr>
            </tbody>
          </table>

          <div style={{ display: 'flex' }}>
            <div style={{ flex: 1, border: '1px solid #c0cce0', padding: '6px 10px', fontSize: 9.5, lineHeight: 1.6, borderRight: 'none' }}>
              <div style={addrHead}>BILLING ADDRESS</div>
              {PO_ISSUER.billing.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div style={{ flex: 1, border: '1px solid #c0cce0', padding: '6px 10px', fontSize: 9.5, lineHeight: 1.6 }}>
              <div style={addrHead}>DELIVERY ADDRESS</div>
              {PO_ISSUER.delivery.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        </div>

        <div style={{ background: '#f0f4ff', borderTop: '1px solid #c5d3f0', padding: '5px 14px', fontSize: 9.5, color: '#444', fontStyle: 'italic', textAlign: 'right' }}>
          Thanking you &nbsp;|&nbsp; For {PO_ISSUER.name.replace(/ PRIVATE LIMITED$/i, ' Private Limited')}
        </div>
      </div>
    </div>
  );
}

/**
 * Modal wrapper: preview a PO with Download-PDF and Print actions.
 * The document is rendered at full width inside a scrolling shell so what the
 * user sees is exactly what gets captured.
 */
export default function PurchaseOrderModal({ po, asl, onClose }) {
  const docRef = useRef(null);
  if (!po) return null;
  return (
    <div className="modal-back" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: 20 }}>
      <div style={{ background: 'var(--wh)', borderRadius: 10, padding: 16, maxWidth: 860 }}>
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Purchase Order — {po.poNum}</div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={() => printElement(docRef.current)}>🖨 Print</button>
          <button
            className="btn btn-g"
            onClick={() => saveDocPdf(docRef.current, 'Bloomflex_PO_' + String(po.poNum).replace(/\//g, '-') + '.pdf', { scale: 2, margin: 8, compress: false })}
          >⬇ Download PDF</button>
          <button className="btn btn-s" onClick={onClose}>Close</button>
        </div>
        <div style={{ overflow: 'auto', maxHeight: '80vh', border: '1px solid var(--bd)' }}>
          <PurchaseOrderDoc po={po} asl={asl} innerRef={docRef} />
        </div>
      </div>
    </div>
  );
}
