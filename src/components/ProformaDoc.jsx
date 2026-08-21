import { forwardRef } from 'react';
import { COMPANY, INVOICE_DOC } from '../lib/company.js';
import { gstBreakup } from '../lib/calc.js';
import { getUOM } from '../lib/pricing.js';
import { amountInWords, fmtDate } from '../lib/format.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money2 = (v) => n(v).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const rs = (v) => 'Rs.' + money2(v);

const PF_DECLARATIONS = [
  'This is a Proforma Invoice for quotation / advance-payment purposes only and does not constitute a Tax Invoice',
  'There might be a variation of 10% in quantity mentioned above',
  'Prices are subject to change without notice. Validity: 15 days from the date above',
  'Subject to the jurisdiction of courts in Hyderabad',
];

/**
 * A4 PROFORMA INVOICE — a port of pfSavePDF()'s document in the production
 * monolith. It reuses the tax invoice's `.inv-*` print styles, but with a text
 * wordmark instead of the logo (as production does), its own declarations, and a
 * "Proforma Amount" total with no TCS row.
 *
 * `f` is the proforma form state, `rows` the priced item rows.
 */
const ProformaDoc = forwardRef(function ProformaDoc({ f, rows }, ref) {
  const d = f || {};
  const items = rows || [];
  const subTotal = items.reduce((s, r) => s + (n(r.amount) || n(r.qty) * n(r.rate)), 0);
  const freight = n(d.freight);
  const gstType = d.gstType || 'IGST';
  const g = gstBreakup(subTotal, freight, 18, gstType);
  const taxable = g.taxable;
  const totalQty = items.reduce((s, r) => s + n(r.qty), 0);
  const wordsStr = taxable > 0 ? amountInWords(g.invAmount) : 'Enter rates above to calculate amounts';
  const pre = { fontSize: '8.5pt', color: '#333', marginTop: '3pt', whiteSpace: 'pre-line' };

  return (
    <div className="inv" id="pf-doc" ref={ref}>
      <div className="inv-orig">Proforma Copy<br />Not a Tax Invoice</div>

      <div className="inv-top">
        <div style={{ textAlign: 'center', marginBottom: '3pt' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0e6fb8', letterSpacing: '3px' }}>BLOOMFLEX</div>
          <div style={{ fontSize: 10, color: '#555' }}>PRIVATE LIMITED</div>
        </div>
        <div className="inv-addr-line">
          {INVOICE_DOC.addressLines.map((ln, i) => <span key={i}>{i ? <br /> : null}{ln}</span>)}
        </div>
      </div>

      <div className="inv-title-row">PROFORMA INVOICE</div>

      <table className="inv-meta-tbl">
        <tbody>
          <tr>
            <td style={{ width: '50%' }}><span className="inv-meta-lbl">GSTIN Number</span>{COMPANY.gstin}</td>
            <td><span className="inv-meta-lbl">Payment Terms</span>{d.pt}</td>
          </tr>
          <tr>
            <td><span className="inv-meta-lbl">Tax Payable on Reverse Charge</span>No</td>
            <td><span className="inv-meta-lbl">Sub Brand</span>{d.subBrand || 'All'}</td>
          </tr>
          <tr>
            <td><span className="inv-meta-lbl">Proforma Sl No</span>{d.no}</td>
            <td><span className="inv-meta-lbl">Date</span>{fmtDate(d.date)}</td>
          </tr>
          <tr>
            <td><span className="inv-meta-lbl">Proforma Date</span>{fmtDate(d.date)}</td>
            <td><span className="inv-meta-lbl">Dispatch Location</span>{d.loc || '—'}</td>
          </tr>
        </tbody>
      </table>

      <table className="inv-addr-tbl">
        <tbody>
          <tr>
            <td style={{ width: '50%' }}>
              <div className="inv-addr-hd">Name and GST Address of The Consignee:</div>
              <div style={{ fontWeight: 700, fontSize: '10pt' }}>{d.customer}</div>
              <div style={pre}>{d.billingAddr || ''}</div>
              {d.billingGstin ? <div style={{ fontSize: '8.5pt', marginTop: '3pt' }}><strong>GSTIN:</strong> {d.billingGstin}</div> : null}
              {d.contactPerson ? <div style={{ fontSize: '8.5pt', marginTop: '6pt' }}><strong>Contact:</strong> {d.contactPerson} | {d.contactNo || ''}</div> : null}
            </td>
            <td>
              <div className="inv-addr-hd">Ship To:</div>
              <div style={{ fontWeight: 700, fontSize: '10pt' }}>{d.customer}</div>
              <div style={pre}>{d.shippingAddr || d.loc || ''}</div>
              {d.shippingGstin ? <div style={{ fontSize: '8.5pt', marginTop: '3pt' }}><strong>GSTIN:</strong> {d.shippingGstin}</div> : null}
              {d.contactPerson ? <div style={{ fontSize: '8.5pt', marginTop: '6pt' }}><strong>Contact:</strong> {d.contactPerson} | {d.contactNo || ''}</div> : null}
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
          {items.map((r, i) => {
            const amt = n(r.amount) || n(r.qty) * n(r.rate);
            return (
              <tr key={i}>
                <td className="c">{i + 1}</td>
                <td className="c">{INVOICE_DOC.hsn}</td>
                <td>{r.jobName || r.spec}</td>
                <td className="r">{n(r.qty).toLocaleString('en-IN')}</td>
                <td className="c">{getUOM(r.dispatchForm)}</td>
                <td className="r">{n(r.rate) > 0 ? n(r.rate).toFixed(2) : '—'}</td>
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
            <td /><td className="r">—</td><td className="r" /><td /><td /><td className="r" />
          </tr>
        </tbody>
      </table>

      <div className="inv-bottom">
        <div className="inv-decl">
          <strong>Declarations:</strong><br />
          {PF_DECLARATIONS.map((t, i) => <span key={i}>{i + 1}) {t}<br /></span>)}
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
          <div className="inv-tot-row bold"><span>Proforma Amount Rs.</span><span>{g.invAmount > 0 ? 'Rs.' + g.invAmount.toLocaleString('en-IN') : '—'}</span></div>
        </div>
      </div>

      <div className="inv-words-row"><strong>Proforma Value Rs. (In Words):</strong> {wordsStr}</div>
      {d.notes ? (
        <div style={{ border: '1pt solid #000', borderTop: 'none', padding: '5pt 7pt', fontSize: '8.5pt', lineHeight: 1.6, background: '#FFFBEA' }}>
          <strong>Special Notes:</strong>{' '}
          {String(d.notes).split('\n').map((ln, i) => <span key={i}>{i ? <br /> : null}{ln}</span>)}
        </div>
      ) : null}
      <div style={{ border: '1pt solid #000', borderTop: 'none', padding: '5pt 7pt', fontSize: '8pt', lineHeight: 1.6 }}>
        <strong>Amount of Tax Subject to Reverse Charge:</strong> Nil &nbsp;&nbsp;
        This document is a quotation and is not to be treated as a demand for payment under GST law.
      </div>
      <div className="inv-bank-row"><strong>Bank Details:</strong> {COMPANY.bank}</div>
      <div className="inv-sign">
        <div className="inv-sign-l">
          <strong>Terms and Conditions of Sale</strong><br />
          <div style={{ marginTop: '5pt' }}><strong>Proforma No:</strong> {d.no}</div>
          <div><strong>Payment Terms:</strong> {d.pt}</div>
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

export default ProformaDoc;
