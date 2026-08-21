import { forwardRef } from 'react';
import { COMPANY, INVOICE_DOC } from '../lib/company.js';
import { COMPANY_LOGO } from '../lib/companyLogo.js';
import { gstBreakup } from '../lib/calc.js';
import { getUOM } from '../lib/pricing.js';
import { amountInWords, fmtDate } from '../lib/format.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Production prints money as "Rs.12,345.00" — no rupee glyph, no space, Indian
// grouping, always two decimals. Zero prints as an em dash on the amount rows and
// a hyphen on the tax rows, exactly as renderInvoiceDoc() does.
const money2 = (v) => n(v).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const rs = (v) => 'Rs.' + money2(v);

/**
 * A4 TAX INVOICE — a straight port of the monolith's renderInvoiceDoc()
 * (OAB-App/reference/index.html), so the printed sheet, the browser print output
 * and the downloaded PDF are the document the client already issues.
 *
 * `header` = the invoice/customer fields; `lines` = pendInv-style rows.
 * Any change here changes a customer-facing, GST-filed document — check it
 * against OAB-App before touching it.
 */
const InvoiceDoc = forwardRef(function InvoiceDoc({ header, lines }, ref) {
  const h = header || {};
  const rows = lines || [];
  const subTotal = rows.reduce((s, l) => s + (n(l.lineTotal) || n(l.qty) * n(l.rate)), 0);
  const freight = n(h.freight);
  const gstType = h.gstType || 'IGST';
  const g = gstBreakup(subTotal, freight, 18, gstType);
  const taxable = g.taxable;
  const totalQty = rows.reduce((s, l) => s + n(l.qty), 0);
  const transportDisplay = [h.transporter, h.dcNo].filter(Boolean).join(' / ');
  const shipAddr = h.shippingAddr || h.billingAddr || '';
  const shipFallback = (rows[0] && rows[0].dispLoc) || h.placeOfSupply || '';
  const poDate = (rows[0] && rows[0].poDate) || h.poDate || '';
  const wordsStr = taxable > 0 ? amountInWords(g.invAmount) : 'Enter rates above to calculate amounts';

  // Pre-line text: production keeps hard newlines in the address fields.
  const pre = { fontSize: '8.5pt', color: '#333', marginTop: '3pt', whiteSpace: 'pre-line' };

  return (
    // id="inv-doc" is what the design system keys its "leave formal documents
    // alone" rules off — hover, transition and focus effects must not reach a
    // customer-facing invoice.
    <div className="inv" id="inv-doc" ref={ref}>
      <div className="inv-orig">
        {INVOICE_DOC.copies.map((c, i) => <span key={c}>{i ? <br /> : null}{c}</span>)}
      </div>

      <div className="inv-top">
        <div style={{ textAlign: 'center', marginBottom: '3pt' }}>
          <img
            src={COMPANY_LOGO} alt={COMPANY.name}
            style={{ height: '48pt', maxWidth: '200pt', objectFit: 'contain', display: 'block', margin: '0 auto 3pt' }}
          />
        </div>
        <div className="inv-addr-line">
          {INVOICE_DOC.addressLines.map((ln, i) => <span key={i}>{i ? <br /> : null}{ln}</span>)}
        </div>
      </div>

      <div className="inv-title-row">TAX INVOICE</div>

      <table className="inv-meta-tbl">
        <tbody>
          <tr>
            <td style={{ width: '50%' }}><span className="inv-meta-lbl">GSTIN Number</span>{COMPANY.gstin}</td>
            <td><span className="inv-meta-lbl">Transportation Mode</span>{transportDisplay || '—'}</td>
          </tr>
          <tr>
            <td><span className="inv-meta-lbl">Tax Payable on Reverse Charge</span>No</td>
            <td><span className="inv-meta-lbl">PO Number</span>{h.po}</td>
          </tr>
          <tr>
            <td><span className="inv-meta-lbl">Invoice Sl No</span>{h.ivNo}</td>
            <td><span className="inv-meta-lbl">Date of Supply</span>{fmtDate(h.ivDt)}</td>
          </tr>
          <tr>
            <td><span className="inv-meta-lbl">Invoice Date</span>{fmtDate(h.ivDt)}</td>
            <td><span className="inv-meta-lbl">Place of Supply</span>{h.placeOfSupply}</td>
          </tr>
          {(h.vehicle || h.driver) && (
            <tr>
              <td><span className="inv-meta-lbl">Vehicle Number</span>{h.vehicle || '—'}</td>
              <td><span className="inv-meta-lbl">Driver Name &amp; Mobile</span>{h.driver || '—'}</td>
            </tr>
          )}
        </tbody>
      </table>

      <table className="inv-addr-tbl">
        <tbody>
          <tr>
            <td style={{ width: '50%' }}>
              <div className="inv-addr-hd">Name and GST Address of The Consignee:</div>
              <div style={{ fontWeight: 700, fontSize: '10pt' }}>{h.customer}</div>
              <div style={pre}>{h.billingAddr || ''}</div>
              {h.billingGstin ? <div style={{ fontSize: '8.5pt', marginTop: '3pt' }}><strong>GSTIN:</strong> {h.billingGstin}</div> : null}
              {h.contactPerson ? <div style={{ fontSize: '8.5pt', marginTop: '6pt' }}><strong>Contact:</strong> {h.contactPerson} | {h.contactNo}</div> : null}
            </td>
            <td>
              <div className="inv-addr-hd">Ship To:</div>
              <div style={{ fontWeight: 700, fontSize: '10pt' }}>{h.customer}</div>
              <div style={pre}>{shipAddr || shipFallback}</div>
              {h.shippingGstin ? <div style={{ fontSize: '8.5pt', marginTop: '3pt' }}><strong>GSTIN:</strong> {h.shippingGstin}</div> : null}
              {h.contactPerson ? <div style={{ fontSize: '8.5pt', marginTop: '6pt' }}><strong>Contact:</strong> {h.contactPerson} | {h.contactNo}</div> : null}
            </td>
          </tr>
        </tbody>
      </table>

      <table className="inv-items-tbl">
        <thead>
          <tr>
            <th style={{ width: '22pt' }}>S.No</th>
            <th style={{ width: '58pt' }}>HSN Code (GST)</th>
            <th>Description of Goods</th>
            <th style={{ width: '48pt' }}>Qty</th>
            <th style={{ width: '28pt' }}>UOM</th>
            <th style={{ width: '40pt' }}>Rate</th>
            <th style={{ width: '55pt' }}>Total</th>
            <th style={{ width: '40pt' }}>Discount</th>
            <th style={{ width: '32pt' }}>GST%</th>
            <th style={{ width: '60pt' }}>Taxable Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => {
            const qty = n(l.qty);
            const rate = n(l.rate);
            const amt = n(l.lineTotal) || qty * rate;
            return (
              <tr key={i}>
                <td className="c">{i + 1}</td>
                <td className="c">{INVOICE_DOC.hsn}</td>
                <td>{l.jobName || l.spec}</td>
                <td className="r">{qty.toLocaleString('en-IN')}</td>
                <td className="c">{getUOM(l.dispatchForm)}</td>
                <td className="r">{rate > 0 ? rate.toFixed(2) : '—'}</td>
                <td className="r">{amt > 0 ? money2(amt) : '—'}</td>
                <td className="c">-</td>
                <td className="c">18</td>
                <td className="r">{amt > 0 ? money2(amt) : '—'}</td>
              </tr>
            );
          })}
          <tr style={{ background: '#f5f5f5', fontWeight: 700 }}>
            <td colSpan={2} className="c" style={{ fontSize: '8pt' }}>Total No. Of Pouches</td>
            <td />
            <td className="r">{totalQty.toLocaleString('en-IN')}</td>
            <td />
            <td className="r">—</td>
            <td className="r" />
            <td /><td />
            <td className="r" />
          </tr>
        </tbody>
      </table>

      <div className="inv-bottom">
        <div className="inv-decl">
          <strong>Declarations:</strong><br />
          {INVOICE_DOC.declarations.map((d, i) => <span key={i}>{i + 1}) {d}<br /></span>)}
        </div>
        <div className="inv-tots">
          <div className="inv-tot-row"><span>Sub Total</span><span>{subTotal > 0 ? rs(subTotal) : '—'}</span></div>
          <div className="inv-tot-row"><span>Freight</span><span>{freight ? rs(freight) : '-'}</span></div>
          {gstType === 'IGST' ? (
            <>
              <div className="inv-tot-row"><span>CGST 0.0%</span><span>-</span></div>
              <div className="inv-tot-row"><span>SGST 0.0%</span><span>-</span></div>
              <div className="inv-tot-row"><span>IGST 18.0%</span><span>{taxable > 0 ? rs(g.gstAmt) : '-'}</span></div>
            </>
          ) : (
            <>
              <div className="inv-tot-row"><span>CGST 9.0%</span><span>{taxable > 0 ? rs(g.gstAmt / 2) : '-'}</span></div>
              <div className="inv-tot-row"><span>SGST 9.0%</span><span>{taxable > 0 ? rs(g.gstAmt / 2) : '-'}</span></div>
              <div className="inv-tot-row"><span>IGST 0.0%</span><span>-</span></div>
            </>
          )}
          <div className="inv-tot-row bold"><span>Total</span><span>{taxable > 0 ? rs(taxable + g.gstAmt) : '—'}</span></div>
          <div className="inv-tot-row"><span>Round Off</span><span>{g.roundOff !== 0 ? (g.roundOff > 0 ? '+' : '') + g.roundOff.toFixed(2) : '-'}</span></div>
          <div className="inv-tot-row"><span>TCS 0.00%</span><span>-</span></div>
          <div className="inv-tot-row bold"><span>Invoice Amount Rs.</span><span>{g.invAmount > 0 ? 'Rs.' + g.invAmount.toLocaleString('en-IN') : '—'}</span></div>
        </div>
      </div>

      <div className="inv-words-row"><strong>Invoice Value Rs. (In Words):</strong> {wordsStr}</div>
      <div style={{ border: '1pt solid #000', borderTop: 'none', padding: '5pt 7pt', fontSize: '8pt', lineHeight: 1.6 }}>
        <strong>Amount of Tax Subject to Reverse Charge:</strong> Nil &nbsp;&nbsp;
        <strong>Certified</strong> that the particulars given above are true and correct
      </div>
      <div className="inv-bank-row"><strong>Bank Details:</strong> {COMPANY.bank}</div>
      <div className="inv-sign">
        <div className="inv-sign-l">
          <strong>Terms and Conditions of Sale</strong><br />
          <div style={{ marginTop: '5pt' }}><strong>PO NUMBER:</strong> {h.po}</div>
          <div><strong>PO Date:</strong> {fmtDate(poDate)}</div>
          <div><strong>Payment Terms:</strong> {h.paymentTerms}</div>
          <div style={{ fontSize: '7.5pt', color: '#666', marginTop: '6pt' }}>E&amp;OE</div>
        </div>
        <div className="inv-sign-r">
          <div>For <strong>{COMPANY.name}</strong></div>
          <div className="inv-sign-space" />
          <div style={{ fontWeight: 700 }}>Authorised Signatory</div>
        </div>
      </div>
    </div>
  );
});

export default InvoiceDoc;
