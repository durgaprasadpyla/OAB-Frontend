// Printed-document → PDF, using the SAME pipeline production uses: html2canvas
// rasterises the already-rendered document node and jsPDF wraps it into A4.
//
// This deliberately does NOT re-draw the invoice with jsPDF text primitives. The
// invoice, proforma and packing list are laid out in HTML/CSS (InvoiceDoc.jsx,
// ProformaDoc.jsx, PackingListDoc.jsx); capturing that markup is what guarantees
// the PDF is the same sheet the user sees on screen and prints — which is the whole
// point. A second, hand-drawn layout would drift from it on the first edit.
//
// Clarity: OAB-App's integration-late.js raised the invoice capture from scale 2
// (~192 dpi, visibly blurry) to scale 3 (~290 dpi) and inset it by 8 mm so nothing
// is clipped at the page edge. INVOICE_PDF below is that exact recipe.

/** The invoice recipe: 300-dpi-class capture, 8 mm margins, compressed. */
export const INVOICE_PDF = { scale: 3, margin: 8, compress: true };
/** The proforma / packing-list recipe production uses: scale 2, full bleed. */
export const PLAIN_PDF = { scale: 2, margin: 0, compress: false };

/**
 * Capture one document node into an A4 portrait PDF and download it.
 *
 * Pagination slices the captured canvas one printable-page-height at a time, so a
 * long document flows across pages instead of being squashed onto one (and never
 * repeats the whole image per page).
 */
export async function saveDocPdf(el, filename, opts = {}) {
  if (!el) throw new Error('no document to export');
  if (!window.html2canvas) throw new Error('html2canvas is not loaded');
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) throw new Error('jsPDF is not loaded');
  const { scale = 3, margin = 8, compress = true } = opts;

  const canvas = await window.html2canvas(el, {
    scale,
    useCORS: true,
    backgroundColor: '#ffffff',
    width: el.scrollWidth,
    height: el.scrollHeight,
    windowWidth: 794,          // 210 mm at 96 dpi — the width the .inv sheet is authored at
  });

  const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW - 2 * margin;
  const imgH = (canvas.height * imgW) / canvas.width;
  const contentH = pageH - 2 * margin;

  if (imgH <= contentH + 0.5) {
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, imgW, imgH);
  } else {
    const pxPerPage = Math.floor((contentH / imgH) * canvas.height);
    let srcY = 0;
    let page = 0;
    while (srcY < canvas.height - 1) {
      const srcH = Math.min(pxPerPage, canvas.height - srcY);
      const pc = document.createElement('canvas');
      pc.width = canvas.width;
      pc.height = srcH;
      const ctx = pc.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pc.width, pc.height);
      ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
      const drawH = (srcH / canvas.height) * imgH;
      if (page > 0) pdf.addPage();
      pdf.addImage(pc.toDataURL('image/png'), 'PNG', margin, margin, imgW, drawH);
      srcY += srcH;
      page++;
    }
  }
  pdf.save(String(filename || 'document').replace(/\.pdf$/i, '') + '.pdf');
}

/** `Bloomflex_<invoice no>_<customer>.pdf`, exactly as production names it. */
export function invoicePdfName(invNo, customer) {
  const no = String(invNo || '').trim().replace(/\//g, '-').replace(/[^a-zA-Z0-9-_]/g, '') || 'invoice';
  const cust = String(customer || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
  return 'Bloomflex_' + no + '_' + cust + '.pdf';
}

/** Capture the rendered `#inv-doc` node with the invoice recipe. */
export function saveInvoicePdf(el, invNo, customer) {
  return saveDocPdf(el, invoicePdfName(invNo, customer), INVOICE_PDF);
}
