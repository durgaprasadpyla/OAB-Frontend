// OAB board → PDF as a real vector table, not a screenshot.
//
// Port of window.downloadOABCurrentPDF in OAB-App/src/integration-late.js, which
// replaced the reference's html2canvas capture (blurry, columns clipped). Text is
// drawn with jsPDF primitives, so it is crisp at any zoom, selectable, searchable
// and auto-paginated onto A3 landscape with nothing cut off.
import { balance, calcMetres } from './calc.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const nf = (v) => ((v === '' || v == null) ? '' : Number(v).toLocaleString('en-IN'));

const COLS = ['S.No', 'SO#', 'Spec', 'Disp', 'Customer', 'Job Name', 'Sub Brand', 'Location', 'PO#', 'PO Date',
  'Age', 'PO Qty', 'Inv', 'Man', 'FG', 'Balance', 'Mtrs*', 'Prod', 'Stage'];
const WEIGHTS = [0.8, 1.5, 1.3, 1.3, 3.2, 5.0, 2.4, 2.8, 2.4, 1.7, 0.9, 1.6, 1.4, 1.4, 1.0, 1.6, 1.5, 1.7, 1.7];
const RIGHT = new Set([0, 10, 11, 12, 13, 14, 15, 16]);

/** Whole days since an SO's PO date, or null. */
function ageDays(poDate) {
  if (!poDate) return null;
  const d = new Date(poDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

/**
 * Build and download the board PDF.
 *
 * @param rows       the rows already filtered and ordered exactly as on screen
 * @param sheet      'SF' | 'OT'
 * @param jssBySpec  spec -> JSS row (for sub-brand / dispatch form / metres)
 * @param prodStatus (so) => 'Ready' | 'NR-…'
 */
export function downloadOabPdf(rows, sheet, jssBySpec = {}, prodStatus = () => '') {
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) throw new Error('jsPDF is not loaded');

  const fileLabel = sheet === 'SF' ? 'StayFresh_OAB' : 'Others_OAB';
  const title = sheet === 'SF' ? 'Stay Fresh OAB' : 'Others OAB';

  let tPoQty = 0; let tInv = 0; let tMan = 0; let tFg = 0; let tBal = 0;
  const body = (rows || []).map((r, i) => {
    const b = balance(r);
    const j = jssBySpec[r.spec];
    const sb = r.subBrand || (j ? j.subBrand : '') || '';
    const df = r.dispatchForm || (j ? j.dispatchForm : '') || '';
    const mW = calcMetres(r, b, j).withWastage;
    const age = ageDays(r.poDate);
    tPoQty += n(r.poQty); tInv += n(r.invDisp); tMan += n(r.manDisp); tFg += n(r.fg); tBal += b;
    return [i + 1, r.so || '', r.spec || '', df, r.customer || '', r.jobName || '', sb, r.dispLoc || '', r.poNum || '',
      r.poDate || '', age === null ? '' : age, n(r.poQty), n(r.invDisp), n(r.manDisp), n(r.fg), b,
      mW > 0 ? mW : '', prodStatus(r.so) || '', r.stage || ''];
  });

  const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
  const PW = pdf.internal.pageSize.getWidth();
  const PH = pdf.internal.pageSize.getHeight();
  const M = 8;
  const usable = PW - 2 * M;
  const x0 = M;
  const wtot = WEIGHTS.reduce((a, b2) => a + b2, 0);
  const widths = WEIGHTS.map((w) => (w / wtot) * usable);
  const colX = [];
  let cx = x0;
  widths.forEach((w) => { colX.push(cx); cx += w; });
  const now = new Date();

  let y = M;
  pdf.setTextColor(16, 29, 49); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14);
  pdf.text('Bloomflex  —  ' + title, x0, y + 4.5);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(90, 100, 120);
  pdf.text('Order & Production Balance  ·  ' + body.length + ' open orders  ·  Generated '
    + now.toLocaleString('en-IN') + '  ·  Metres include 5% wastage', x0, y + 9.5);
  pdf.setFontSize(8.5); pdf.setTextColor(16, 29, 49);
  pdf.text('PO Qty: ' + nf(tPoQty) + '     Dispatched: ' + nf(tInv + tMan) + '     FG: ' + nf(tFg)
    + '     Balance to produce: ' + nf(tBal), x0, y + 14.5);
  y += 19;

  const headH = 7;
  const lineH = 3.05;
  function header() {
    pdf.setFillColor(14, 111, 184); pdf.rect(x0, y, usable, headH, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7);
    COLS.forEach((c, i) => {
      if (RIGHT.has(i)) pdf.text(String(c), colX[i] + widths[i] - 1.4, y + 4.6, { align: 'right' });
      else pdf.text(String(c), colX[i] + 1.4, y + 4.6);
    });
    pdf.setTextColor(20, 20, 20); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7);
    y += headH;
  }
  header();

  body.forEach((row, ri) => {
    const cellLines = [];
    let maxLines = 1;
    row.forEach((cell, c) => {
      const txt = RIGHT.has(c) ? nf(cell) : String(cell == null ? '' : cell);
      const lines = pdf.splitTextToSize(txt, widths[c] - 2.6);
      cellLines.push(lines);
      if (lines.length > maxLines) maxLines = lines.length;
    });
    const rowH = Math.max(4.8, maxLines * lineH + 1.7);
    if (y + rowH > PH - M) { pdf.addPage(); y = M; header(); }
    if (ri % 2 === 1) { pdf.setFillColor(240, 244, 250); pdf.rect(x0, y, usable, rowH, 'F'); }
    pdf.setTextColor(20, 20, 20);
    cellLines.forEach((lines, c) => {
      if (RIGHT.has(c)) pdf.text(lines, colX[c] + widths[c] - 1.4, y + 3.5, { align: 'right' });
      else pdf.text(lines, colX[c] + 1.4, y + 3.5);
    });
    pdf.setDrawColor(224, 230, 240); pdf.setLineWidth(0.1); pdf.line(x0, y + rowH, x0 + usable, y + rowH);
    y += rowH;
  });

  const ds = now.toLocaleDateString('en-IN').replace(/\//g, '-');
  pdf.save('Bloomflex_' + fileLabel + '_' + ds + '.pdf');
}
