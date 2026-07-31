// PDF/print helpers using the same CDN pipeline the legacy app used
// (html2canvas rasterizes the node, jsPDF wraps it into an A4 document).

/**
 * Capture a DOM node to a paginated A4 PDF and download it.
 *
 * Pagination slices the captured canvas one A4 page-height at a time and adds
 * ONLY that slice to each page — never the whole tall image per page (the old
 * bug that produced multi-MB files). The capture is pinned to the element's own
 * box so it's deterministic regardless of the surrounding scroll container.
 */
export async function elementToPDF(el, filename, { orientation = 'portrait', margin = 6 } = {}) {
  if (!el) throw new Error('no element to export');
  if (!window.html2canvas) throw new Error('html2canvas is not loaded');
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) throw new Error('jsPDF is not loaded');

  const canvas = await window.html2canvas(el, {
    scale: 3,
    backgroundColor: '#ffffff',
    useCORS: true,
    width: el.offsetWidth,
    height: el.offsetHeight,
    windowWidth: el.offsetWidth,
    windowHeight: el.offsetHeight,
    scrollX: 0,
    scrollY: 0,
  });

  const pdf = new JsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;               // even margin on every side (A4 breathing room)
  const contentH = pageH - margin * 2;
  const pxPerMm = canvas.width / contentW;            // image scaled to fit the content width
  const pxPerPage = Math.max(1, Math.floor(contentH * pxPerMm)); // source px per printable page
  const rawPages = Math.max(1, Math.ceil(canvas.height / pxPerPage));
  // The element's own layout height is the source of truth for the page count.
  // Clamp the canvas-derived count to it so a mis-sized/over-tall capture (seen on
  // some browsers) can never emit dozens of blank pages.
  const domPages = el.offsetWidth
    ? Math.max(1, Math.ceil(((el.offsetHeight / el.offsetWidth) * contentW) / contentH))
    : rawPages;
  const pages = Math.min(rawPages, domPages);

  const slice = document.createElement('canvas');
  const ctx = slice.getContext('2d');
  for (let p = 0; p < pages; p++) {
    const sy = p * pxPerPage;
    const sh = Math.min(pxPerPage, canvas.height - sy);
    slice.width = canvas.width;
    slice.height = sh;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
    // JPEG (opaque, no alpha) → one image, no soft-mask, ~20x smaller than the
    // alpha PNG jsPDF was storing, and renders crisply in every viewer.
    const img = slice.toDataURL('image/jpeg', 0.92);
    const hmm = sh / pxPerMm;
    if (p > 0) pdf.addPage();
    pdf.addImage(img, 'JPEG', margin, margin, contentW, hmm);
  }
  pdf.save(filename.endsWith('.pdf') ? filename : filename + '.pdf');
}

/**
 * Print just one element. Marks it `.print-target` and the body `.printing`;
 * the print stylesheet (index.css @media print) hides everything else and shows
 * only that element. This is why plain window.print() showed nothing before —
 * a stale legacy rule hid the whole app.
 */
export function printElement(el) {
  if (!el) return;
  el.classList.add('print-target');
  document.body.classList.add('printing');
  const cleanup = () => {
    el.classList.remove('print-target');
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 60);
}
