import { forwardRef } from 'react';
import { COMPANY } from '../lib/company.js';
import { gstBreakup } from '../lib/calc.js';
import { getUOM } from '../lib/pricing.js';
import { rupees, amountInWords, fmtDate, inr } from '../lib/format.js';

/**
 * A4 tax invoice, rendered with the legacy .inv-* print styles (index.css).
 * `header` = the invoice/customer fields; `lines` = pendInv-style rows.
 */
const InvoiceDoc = forwardRef(function InvoiceDoc({ header, lines }, ref) {
  const h = header || {};
  const rows = lines || [];
  const subTotal = rows.reduce((s, l) => s + (Number(l.lineTotal) || (Number(l.qty) || 0) * (Number(l.rate) || 0)), 0);
  const freight = Number(h.freight) || 0;
  const g = gstBreakup(subTotal, freight, 18, h.gstType || 'IGST');
  const qtyTotal = rows.reduce((s, l) => s + (Number(l.qty) || 0), 0);

  return (
    <div className="inv" ref={ref}>
      <div className="inv-orig">ORIGINAL FOR RECIPIENT</div>
      <div className="inv-top">
        <div className="inv-brand">{COMPANY.name.replace(' PRIVATE LIMITED', '')}</div>
        <div className="inv-brand-sub">PRIVATE LIMITED</div>
        <div className="inv-addr-line">
          {COMPANY.addressLines.join(' ')}<br />
          GSTIN: {COMPANY.gstin} &nbsp;·&nbsp; {COMPANY.email} &nbsp;·&nbsp; {COMPANY.web}
        </div>
      </div>
      <div className="inv-title-row">TAX INVOICE</div>

      <table className="inv-meta-tbl">
        <tbody>
          <tr>
            <td style={{ width: '50%' }}><span className="inv-meta-lbl">Invoice No.</span>{h.ivNo || '-'}</td>
            <td style={{ width: '50%' }}><span className="inv-meta-lbl">Invoice Date</span>{fmtDate(h.ivDt)}</td>
          </tr>
          <tr>
            <td><span className="inv-meta-lbl">PO Number</span>{h.po || '-'}</td>
            <td><span className="inv-meta-lbl">Place of Supply</span>{h.placeOfSupply || '-'}</td>
          </tr>
          <tr>
            <td><span className="inv-meta-lbl">Transporter</span>{h.transporter || '-'}</td>
            <td><span className="inv-meta-lbl">DC / LR #</span>{h.dcNo || '-'}</td>
          </tr>
          <tr>
            <td><span className="inv-meta-lbl">Vehicle No.</span>{h.vehicle || '-'}</td>
            <td><span className="inv-meta-lbl">Driver</span>{h.driver || '-'}</td>
          </tr>
          <tr>
            <td><span className="inv-meta-lbl">Payment Terms</span>{h.paymentTerms || '-'}</td>
            <td><span className="inv-meta-lbl">Seller GSTIN</span>{COMPANY.gstin}</td>
          </tr>
        </tbody>
      </table>

      <table className="inv-addr-tbl">
        <tbody>
          <tr>
            <td style={{ width: '50%' }}>
              <div className="inv-addr-hd">Bill To</div>
              <strong>{h.customer || '-'}</strong><br />
              {(h.billingAddr || '').split('\n').map((ln, i) => <span key={i}>{ln}<br /></span>)}
              {h.billingGstin ? <>GSTIN: {h.billingGstin}</> : null}
            </td>
            <td style={{ width: '50%' }}>
              <div className="inv-addr-hd">Ship To</div>
              <strong>{h.customer || '-'}</strong><br />
              {((h.shippingAddr || h.billingAddr) || '').split('\n').map((ln, i) => <span key={i}>{ln}<br /></span>)}
              {h.shippingGstin ? <>GSTIN: {h.shippingGstin}</> : null}
            </td>
          </tr>
        </tbody>
      </table>

      <table className="inv-items-tbl">
        <colgroup>
          <col style={{ width: '26pt' }} />
          <col />
          <col style={{ width: '52pt' }} />
          <col style={{ width: '52pt' }} />
          <col style={{ width: '30pt' }} />
          <col style={{ width: '56pt' }} />
          <col style={{ width: '74pt' }} />
        </colgroup>
        <thead>
          <tr>
            <th>Sr</th>
            <th style={{ textAlign: 'left' }}>Description of Goods</th>
            <th>HSN</th>
            <th>Qty</th>
            <th>UOM</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => {
            const qty = Number(l.qty) || 0;
            const rate = Number(l.rate) || 0;
            const amt = Number(l.lineTotal) || qty * rate;
            return (
              <tr key={i}>
                <td className="c">{i + 1}</td>
                <td>{l.jobName || l.spec}{l.spec ? <span style={{ color: '#666' }}> · {l.spec}</span> : null}</td>
                <td className="c">{COMPANY.hsn}</td>
                <td className="r">{inr(qty)}</td>
                <td className="c">{getUOM(l.dispatchForm)}</td>
                <td className="r">{inr(rate, 2)}</td>
                <td className="r">{inr(amt, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="inv-bottom">
        <div className="inv-decl">
          <strong>Declarations:</strong><br />{COMPANY.declaration}
        </div>
        <div className="inv-tots">
          <div className="inv-tot-row"><span>Sub Total</span><span>{rupees(subTotal)}</span></div>
          {freight > 0 && <div className="inv-tot-row"><span>Freight</span><span>{rupees(freight)}</span></div>}
          <div className="inv-tot-row"><span>Taxable Value</span><span>{rupees(g.taxable)}</span></div>
          {h.gstType === 'CGST_SGST' ? (
            <>
              <div className="inv-tot-row"><span>CGST 9%</span><span>{rupees(g.cgst)}</span></div>
              <div className="inv-tot-row"><span>SGST 9%</span><span>{rupees(g.sgst)}</span></div>
            </>
          ) : (
            <div className="inv-tot-row"><span>IGST 18%</span><span>{rupees(g.igst)}</span></div>
          )}
          {g.roundOff !== 0 && <div className="inv-tot-row"><span>Round Off</span><span>{rupees(g.roundOff)}</span></div>}
          <div className="inv-tot-row bold"><span>Total</span><span>{rupees(g.invAmount)}</span></div>
          <div className="inv-tot-row" style={{ color: '#666' }}><span>Total Qty</span><span>{qtyTotal.toLocaleString('en-IN')}</span></div>
        </div>
      </div>

      <div className="inv-words-row"><strong>Amount in Words:</strong> {amountInWords(g.invAmount)}</div>
      <div className="inv-bank-row"><strong>Bank Details:</strong> {COMPANY.bank}</div>
      <div className="inv-sign">
        <div className="inv-sign-l">Receiver's Signature<div className="inv-sign-space" /></div>
        <div className="inv-sign-r">For {COMPANY.name}<div className="inv-sign-space" />Authorised Signatory</div>
      </div>
    </div>
  );
});

export default InvoiceDoc;
