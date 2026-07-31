// Vector A4 tax invoice built with jsPDF text/line primitives (NOT html2canvas),
// so the text is true vector — crisp like the browser's Print/Save-as-PDF, tiny
// file, selectable — as a one-click download. Layout mirrors InvoiceDoc.jsx.
//
// Note: jsPDF's built-in Helvetica has no ₹ glyph, so money is shown as "Rs.".
import { COMPANY } from './company.js';
import { gstBreakup } from './calc.js';
import { getUOM } from './pricing.js';
import { inr, amountInWords, fmtDate } from './format.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v) => 'Rs. ' + inr(v, 2);

/** Build and return the jsPDF document (no download). */
export function buildInvoiceDoc(header, lines) {
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) throw new Error('jsPDF is not loaded');
  const h = header || {};
  const rows = (lines || []).map((l) => ({
    spec: l.spec, jobName: l.jobName || l.spec, qty: n(l.qty), rate: n(l.rate),
    amt: n(l.lineTotal) || n(l.qty) * n(l.rate), df: l.dispatchForm,
  }));

  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const M = 8, L = M, R = 210 - M, W = R - L, mid = (L + R) / 2;
  let y = M;

  const setF = (size, style = 'normal', c = [0, 0, 0]) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(c[0], c[1], c[2]); };
  const T = (s, x, yy, o = {}) => { setF(o.size || 9, o.style || 'normal', o.color || [0, 0, 0]); doc.text(String(s == null ? '' : s), x, yy, { align: o.align || 'left' }); };
  const lbl = (s, x, yy) => T(s, x, yy, { size: 6.5, style: 'bold', color: [110, 110, 110] });
  const hline = (yy) => { doc.setLineWidth(0.2); doc.setDrawColor(0); doc.line(L, yy, R, yy); };
  const vline = (x, y1, y2) => { doc.setLineWidth(0.2); doc.setDrawColor(0); doc.line(x, y1, x, y2); };
  const box = (x, yy, w, hh, lw = 0.2) => { doc.setLineWidth(lw); doc.setDrawColor(0); doc.rect(x, yy, w, hh); };

  // ── Header ──
  const top = y;
  T(COMPANY.name.replace(' PRIVATE LIMITED', ''), 105, y + 9, { size: 22, style: 'bold', color: [27, 107, 58], align: 'center' });
  T('PRIVATE LIMITED', 105, y + 13.5, { size: 9, style: 'bold', color: [51, 51, 51], align: 'center' });
  T(COMPANY.addressLines.join(' '), 105, y + 18, { size: 8, color: [51, 51, 51], align: 'center' });
  T(`GSTIN: ${COMPANY.gstin}    ${COMPANY.email}    ${COMPANY.web}`, 105, y + 22, { size: 8, color: [51, 51, 51], align: 'center' });
  T('ORIGINAL FOR RECIPIENT', R - 1.5, y + 3.5, { size: 7, color: [51, 51, 51], align: 'right' });
  y += 26; box(L, top, W, y - top, 0.4);

  // ── TAX INVOICE ──
  box(L, y, W, 7, 0.4);
  T('TAX INVOICE', 105, y + 4.8, { size: 12, style: 'bold', align: 'center' });
  setF(12, 'bold'); const tiw = doc.getTextWidth('TAX INVOICE');
  doc.setLineWidth(0.3); doc.line(105 - tiw / 2, y + 5.6, 105 + tiw / 2, y + 5.6);
  y += 7;

  // ── Meta table ──
  const metaTop = y, rowH = 9;
  const meta = [
    ['Invoice No.', h.ivNo, 'Invoice Date', fmtDate(h.ivDt)],
    ['PO Number', h.po, 'Place of Supply', h.placeOfSupply],
    ['Transporter', h.transporter, 'DC / LR #', h.dcNo],
    ['Vehicle No.', h.vehicle, 'Driver', h.driver],
    ['Payment Terms', h.paymentTerms, 'Seller GSTIN', COMPANY.gstin],
  ];
  meta.forEach((r, i) => {
    const ry = metaTop + i * rowH;
    lbl(r[0], L + 2, ry + 3.5); T(r[1], L + 2, ry + 7.3, { size: 9 });
    lbl(r[2], mid + 2, ry + 3.5); T(r[3], mid + 2, ry + 7.3, { size: 9 });
    if (i > 0) hline(ry);
  });
  y = metaTop + meta.length * rowH; box(L, metaTop, W, y - metaTop); vline(mid, metaTop, y);

  // ── Bill To / Ship To ──
  const baTop = y;
  const al = (a) => String(a || '').split('\n').filter(Boolean);
  lbl('Bill To', L + 2, baTop + 4); T(h.customer, L + 2, baTop + 8.5, { size: 9, style: 'bold' });
  let by = baTop + 12.3; al(h.billingAddr).forEach((ln) => { T(ln, L + 2, by, { size: 8 }); by += 3.8; });
  if (h.billingGstin) { T('GSTIN: ' + h.billingGstin, L + 2, by, { size: 8 }); by += 3.8; }
  lbl('Ship To', mid + 2, baTop + 4); T(h.customer, mid + 2, baTop + 8.5, { size: 9, style: 'bold' });
  let sy = baTop + 12.3; al(h.shippingAddr || h.billingAddr).forEach((ln) => { T(ln, mid + 2, sy, { size: 8 }); sy += 3.8; });
  if (h.shippingGstin) { T('GSTIN: ' + h.shippingGstin, mid + 2, sy, { size: 8 }); sy += 3.8; }
  y = baTop + Math.max(24, Math.max(by, sy) + 1 - baTop); box(L, baTop, W, y - baTop); vline(mid, baTop, y);

  // ── Items table ──
  const cSR = L + 8, cDESC = cSR + 92, cHSN = cDESC + 18, cQTY = cHSN + 18, cUOM = cQTY + 12, cRATE = cUOM + 20;
  const cen = { sr: (L + cSR) / 2, hsn: (cDESC + cHSN) / 2, qty: (cHSN + cQTY) / 2, uom: (cQTY + cUOM) / 2, rate: (cUOM + cRATE) / 2, amt: (cRATE + R) / 2 };
  const hdrTop = y, hdrH = 6;
  doc.setFillColor(240, 240, 240); doc.rect(L, hdrTop, W, hdrH, 'F');
  T('SR', cen.sr, hdrTop + 4, { size: 7.5, style: 'bold', align: 'center' });
  T('DESCRIPTION OF GOODS', cSR + 2, hdrTop + 4, { size: 7.5, style: 'bold' });
  T('HSN', cen.hsn, hdrTop + 4, { size: 7.5, style: 'bold', align: 'center' });
  T('QTY', cen.qty, hdrTop + 4, { size: 7.5, style: 'bold', align: 'center' });
  T('UOM', cen.uom, hdrTop + 4, { size: 7.5, style: 'bold', align: 'center' });
  T('RATE', cen.rate, hdrTop + 4, { size: 7.5, style: 'bold', align: 'center' });
  T('AMOUNT', cen.amt, hdrTop + 4, { size: 7.5, style: 'bold', align: 'center' });
  let ty = hdrTop + hdrH;
  rows.forEach((r, i) => {
    const desc = (r.jobName || '') + (r.spec ? '   ' + r.spec : '');
    setF(9); const wrapped = doc.splitTextToSize(desc, cDESC - cSR - 4);
    const rH = Math.max(7, wrapped.length * 3.8 + 3);
    T(i + 1, cen.sr, ty + 4.5, { size: 9, align: 'center' });
    setF(9, 'normal', [0, 0, 0]); doc.text(wrapped, cSR + 2, ty + 4.5);
    T(COMPANY.hsn, cen.hsn, ty + 4.5, { size: 9, align: 'center' });
    T(inr(r.qty), cQTY - 2, ty + 4.5, { size: 9, align: 'right' });
    T(getUOM(r.df), cen.uom, ty + 4.5, { size: 9, align: 'center' });
    T(inr(r.rate, 2), cRATE - 2, ty + 4.5, { size: 9, align: 'right' });
    T(inr(r.amt, 2), R - 2, ty + 4.5, { size: 9, align: 'right' });
    ty += rH; hline(ty);
  });
  box(L, hdrTop, W, ty - hdrTop);
  [cSR, cDESC, cHSN, cQTY, cUOM, cRATE].forEach((x) => vline(x, hdrTop, ty));
  y = ty;

  // ── Declarations | Totals ──
  const g = gstBreakup(rows.reduce((s, r) => s + r.amt, 0), n(h.freight), 18, h.gstType || 'IGST');
  const tr = [['Sub Total', g.subTotal], ['Freight', g.freight], ['Taxable Value', g.taxable]];
  if ((h.gstType || 'IGST') === 'CGST_SGST') tr.push(['CGST 9%', g.cgst], ['SGST 9%', g.sgst]); else tr.push(['IGST 18%', g.igst]);
  if (g.roundOff !== 0) tr.push(['Round Off', g.roundOff]);
  const botTop = y;
  lbl('Declarations:', L + 2, botTop + 4);
  setF(7.5, 'normal', [51, 51, 51]); const decl = doc.splitTextToSize(COMPANY.declaration, mid - L - 4);
  doc.text(decl, L + 2, botTop + 8);
  let tyy = botTop + 4;
  tr.forEach(([k, v]) => { T(k, mid + 3, tyy, { size: 9 }); T(money(v), R - 2, tyy, { size: 9, align: 'right' }); tyy += 5.6; });
  doc.setLineWidth(0.3); doc.setDrawColor(0); doc.line(mid, tyy - 1.5, R, tyy - 1.5);
  T('Total', mid + 3, tyy + 3, { size: 10.5, style: 'bold' }); T(money(g.invAmount), R - 2, tyy + 3, { size: 10.5, style: 'bold', align: 'right' });
  tyy += 6; T('Total Qty', mid + 3, tyy, { size: 8, color: [110, 110, 110] }); T(inr(rows.reduce((s, r) => s + r.qty, 0)), R - 2, tyy, { size: 8, color: [110, 110, 110], align: 'right' });
  y = botTop + Math.max(tyy + 3 - botTop, decl.length * 3.4 + 12); box(L, botTop, W, y - botTop); vline(mid, botTop, y);

  // ── Amount in words ──
  box(L, y, W, 7); T('Amount in Words: ', L + 2, y + 4.7, { size: 8.5, style: 'bold' });
  setF(8.5, 'bold'); const awW = doc.getTextWidth('Amount in Words: ');
  T(amountInWords(g.invAmount), L + 2 + awW, y + 4.7, { size: 8.5 }); y += 7;

  // ── Bank ──
  box(L, y, W, 6); T('Bank Details: ', L + 2, y + 4, { size: 8, style: 'bold' });
  setF(8, 'bold'); const bW = doc.getTextWidth('Bank Details: ');
  T(COMPANY.bank, L + 2 + bW, y + 4, { size: 8 }); y += 6;

  // ── Signatures ──
  const sigH = 22; box(L, y, W, sigH); vline(mid, y, y + sigH);
  T("Receiver's Signature", L + 2, y + 5, { size: 9 });
  T('For ' + COMPANY.name, R - 2, y + 5, { size: 9, align: 'right' });
  T('Authorised Signatory', R - 2, y + sigH - 3, { size: 9, align: 'right' });

  return doc;
}

/** Build the vector invoice and download it (one click, no dialog). */
export function saveInvoicePdf(header, lines, filename) {
  const doc = buildInvoiceDoc(header, lines);
  doc.save(String(filename || 'invoice').replace(/[\\/]/g, '-').replace(/\.pdf$/i, '') + '.pdf');
}
