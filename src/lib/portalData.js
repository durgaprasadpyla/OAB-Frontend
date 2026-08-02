// Fields a customer payment portal needs, extracted from an invoice's header +
// lines. Computed with the SAME helpers the invoice document uses (gstBreakup,
// getUOM, fmtDate) so every number is identical to the PDF / on-screen invoice.
// Powers the "Portal Entry" copy panel so the fields can be copied straight into
// the portal instead of being re-typed from the PDF.
import { gstBreakup } from './calc.js';
import { getUOM } from './pricing.js';
import { fmtDate } from './format.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Portal-entry fields for one invoice.
 * @param {object} header invoice header (ivNo, ivDt, freight, gstType, …)
 * @param {Array}  lines  pendInv-style rows ({ spec, jobName, qty, rate, lineTotal, dispatchForm })
 * @returns fields with both display-ready and raw values.
 */
export function invoicePortalFields(header, lines) {
  const h = header || {};
  const rows = (lines || []).map((l) => {
    const qty = num(l.qty);
    const rate = num(l.rate);
    const amount = num(l.lineTotal) || qty * rate;
    return {
      description: l.jobName || l.spec || '',
      spec: l.spec || '',
      qty,
      rate,
      uom: getUOM(l.dispatchForm),
      amount,
    };
  });

  const subTotal = rows.reduce((s, r) => s + r.amount, 0);
  const freight = num(h.freight);
  const gstType = h.gstType || 'IGST';
  const g = gstBreakup(subTotal, freight, 18, gstType);
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);

  // A single "price per bag/piece" only exists when every line shares one rate;
  // otherwise callers fall back to the per-line rates in `lines`.
  const rates = [...new Set(rows.map((r) => r.rate))];
  const ratePerUnit = rates.length === 1 ? rates[0] : null;

  return {
    invoiceNumber: h.ivNo || '',
    invoiceDate: fmtDate(h.ivDt),      // DD/MM/YYYY — matches the invoice face
    invoiceDateIso: h.ivDt || '',      // YYYY-MM-DD — if the portal wants ISO
    totalQty,
    uom: rows.length ? rows[0].uom : 'Pcs',
    ratePerUnit,                       // null when the lines have different rates
    subTotal: g.subTotal,              // pre-tax
    taxableValue: g.taxable,           // subtotal + freight
    gstType,
    gstAmount: g.gstAmt,
    totalAmount: g.invAmount,          // grand total incl GST, rounded (amount payable)
    lines: rows,
  };
}

/** Unit noun for a UOM code — "Piece" for Pcs, "Kg" for Kgs. */
export function unitNoun(uom) {
  return uom === 'Kgs' ? 'Kg' : 'Piece';
}
