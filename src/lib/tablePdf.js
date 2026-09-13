// A printed report as a real vector table (jsPDF text primitives), not a screenshot.
//
// The OAB board PDF (oabPdf.js) drew its table by hand; the issue slip (Issues 6
// §13) and the Sales History report (§35) need the same thing — a titled A4 sheet
// with header lines, a table that paginates cleanly, and a totals row — so the
// drawing lives here once. Text is crisp at any zoom, selectable and searchable.

const nf = (v) => ((v === '' || v == null || Number.isNaN(Number(v))) ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

/**
 * Build a table PDF and return the jsPDF document (call `.save(name)` on it, or
 * `.output(...)` in tests).
 *
 * @param {object} spec
 *   title        — big line at the top
 *   subtitle     — small grey line under it
 *   meta         — [[label, value], …] pairs printed in two columns under the title
 *   columns      — [{ label, width (weight), align:'left'|'right', key }]
 *   rows         — array of arrays (already formatted strings/numbers), or objects when
 *                  columns carry `key`
 *   totals       — optional array of cells for a bold last row
 *   footer       — optional lines printed after the table (signature boxes etc.)
 *   orientation  — 'portrait' (default) | 'landscape'
 *   note         — optional small line printed at the very bottom of each page
 */
export function buildTablePdf(spec) {
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) throw new Error('jsPDF is not loaded');
  const { title, subtitle = '', meta = [], columns = [], rows = [], totals = null, footer = [], orientation = 'portrait', note = '' } = spec;

  const pdf = new JsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });
  const PW = pdf.internal.pageSize.getWidth();
  const PH = pdf.internal.pageSize.getHeight();
  const M = 12;
  const usable = PW - 2 * M;
  const x0 = M;
  const wtot = columns.reduce((a, c) => a + (c.width || 1), 0);
  const widths = columns.map((c) => ((c.width || 1) / wtot) * usable);
  const colX = [];
  let cx = x0;
  widths.forEach((w) => { colX.push(cx); cx += w; });
  const right = new Set(columns.map((c, i) => (c.align === 'right' ? i : -1)).filter((i) => i >= 0));
  const cellText = (row, i) => {
    const c = columns[i];
    const v = Array.isArray(row) ? row[i] : row[c.key];
    if (v == null) return '';
    return right.has(i) && typeof v === 'number' ? nf(v) : String(v);
  };

  let y = M;
  // title block
  pdf.setTextColor(16, 29, 49); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
  pdf.text(String(title || ''), x0, y + 5);
  y += 8;
  if (subtitle) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(90, 100, 120);
    pdf.text(String(subtitle), x0, y + 3);
    y += 5;
  }
  if (meta.length) {
    pdf.setFontSize(9.5);
    const half = usable / 2;
    const lineH = 5;
    const perCol = Math.ceil(meta.length / 2);
    meta.forEach(([label, value], i) => {
      const col = i < perCol ? 0 : 1;
      const rowI = i < perCol ? i : i - perCol;
      const yy = y + 4 + rowI * lineH;
      pdf.setTextColor(90, 100, 120); pdf.setFont('helvetica', 'normal');
      pdf.text(String(label) + ':', x0 + col * half, yy);
      pdf.setTextColor(16, 29, 49); pdf.setFont('helvetica', 'bold');
      const txt = pdf.splitTextToSize(String(value == null ? '' : value), half - 40);
      pdf.text(txt, x0 + col * half + 38, yy);
    });
    y += 4 + perCol * lineH + 2;
  }
  y += 2;

  const headH = 7.5;
  const lineH = 3.6;
  function header() {
    pdf.setFillColor(14, 111, 184); pdf.rect(x0, y, usable, headH, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5);
    columns.forEach((c, i) => {
      if (right.has(i)) pdf.text(String(c.label), colX[i] + widths[i] - 1.6, y + 5, { align: 'right' });
      else pdf.text(String(c.label), colX[i] + 1.6, y + 5);
    });
    pdf.setTextColor(20, 20, 20); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
    y += headH;
  }
  function pageNote() {
    if (!note) return;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(120, 130, 150);
    pdf.text(String(note), x0, PH - 6);
    pdf.setTextColor(20, 20, 20); pdf.setFontSize(8.5);
  }
  header();

  const drawRow = (row, ri, bold) => {
    const cellLines = [];
    let maxLines = 1;
    columns.forEach((c, i) => {
      const lines = pdf.splitTextToSize(cellText(row, i), widths[i] - 3.2);
      cellLines.push(lines);
      if (lines.length > maxLines) maxLines = lines.length;
    });
    const rowH = Math.max(6, maxLines * lineH + 2.4);
    if (y + rowH > PH - M - 8) { pageNote(); pdf.addPage(); y = M; header(); }
    if (bold) { pdf.setFillColor(232, 239, 250); pdf.rect(x0, y, usable, rowH, 'F'); pdf.setFont('helvetica', 'bold'); }
    else if (ri % 2 === 1) { pdf.setFillColor(244, 247, 251); pdf.rect(x0, y, usable, rowH, 'F'); }
    pdf.setTextColor(20, 20, 20);
    cellLines.forEach((lines, i) => {
      if (right.has(i)) pdf.text(lines, colX[i] + widths[i] - 1.6, y + 4.2, { align: 'right' });
      else pdf.text(lines, colX[i] + 1.6, y + 4.2);
    });
    if (bold) pdf.setFont('helvetica', 'normal');
    pdf.setDrawColor(222, 228, 238); pdf.setLineWidth(0.15); pdf.line(x0, y + rowH, x0 + usable, y + rowH);
    y += rowH;
  };
  if (!rows.length) {
    drawRow(columns.map((c, i) => (i === 0 ? '— nothing to list —' : '')), 0, false);
  }
  rows.forEach((row, ri) => drawRow(row, ri, false));
  if (totals) drawRow(totals, rows.length, true);

  if (footer.length) {
    y += 6;
    footer.forEach((line) => {
      if (y > PH - M - 10) { pageNote(); pdf.addPage(); y = M; }
      if (Array.isArray(line)) {
        // signature boxes: one per entry, spread across the width
        const n = line.length;
        const w = usable / n;
        line.forEach((label, i) => {
          pdf.setDrawColor(150, 160, 175); pdf.setLineWidth(0.2);
          pdf.line(x0 + i * w + 4, y + 14, x0 + (i + 1) * w - 4, y + 14);
          pdf.setFontSize(8); pdf.setTextColor(90, 100, 120);
          pdf.text(String(label), x0 + i * w + 4, y + 18);
        });
        y += 22;
      } else {
        pdf.setFontSize(9); pdf.setTextColor(40, 50, 70);
        const txt = pdf.splitTextToSize(String(line), usable);
        pdf.text(txt, x0, y + 4);
        y += txt.length * 4.2 + 2;
      }
    });
  }
  pageNote();
  return pdf;
}

/** File-name-safe version of a document number / name ("ISS/2026/12" → "ISS-2026-12"). */
export function safeName(s) {
  return String(s || '').trim().replace(/[\\/]/g, '-').replace(/[^a-zA-Z0-9._-]+/g, '_');
}
