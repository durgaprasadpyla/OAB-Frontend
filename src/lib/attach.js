// File attachments stored inline in a module blob (supplier certificates, GRN
// photos). Ported from pvReadImageCompressed / aslReadCertFile / aslViewCert.
//
// These land as base64 inside the module JSON, which the API Gateway caps at
// 6 MB per blob — so images are downscaled and re-encoded before they are kept,
// and PDFs (which cannot be compressed here) are rejected above a hard limit.
// Attachment shape: { name, type: 'pdf'|'image', data: <data URI>, date }

export const MAX_PDF_BYTES = 1.5 * 1024 * 1024;
export const IMAGE_MAX_WIDTH = 1000;
export const IMAGE_QUALITY = 0.6;

/** Local YYYY-MM-DD, matching purchTodayISO. */
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Downscale an image to at most IMAGE_MAX_WIDTH and re-encode as JPEG.
 * Resolves to a data URI. (pvReadImageCompressed 6960)
 */
export function readImageCompressed(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image — please try another photo.'));
      img.onload = () => {
        const scale = Math.min(1, IMAGE_MAX_WIDTH / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Turn one picked file into an attachment record.
 * Rejects anything that is neither an image nor a PDF, and any PDF over the
 * size limit — a large PDF would eat the blob budget with no way to shrink it.
 * (aslReadCertFile 6600)
 */
export async function readAttachment(file) {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(`${file.name} is larger than 1.5MB — please compress the PDF and retry.`);
    }
    const data = await new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = (e) => resolve(e.target.result);
      rd.onerror = () => reject(new Error('Could not read that file.'));
      rd.readAsDataURL(file);
    });
    return { name: file.name, type: 'pdf', data, date: todayISO() };
  }
  if (String(file.type || '').startsWith('image/')) {
    const data = await readImageCompressed(file);
    return { name: file.name, type: 'image', data, date: todayISO() };
  }
  throw new Error(`${file.name}: only images and PDFs are supported.`);
}

/**
 * Read a whole picked FileList, keeping the ones that work and collecting the
 * failures so the caller can report them rather than failing the batch.
 */
export async function readAttachments(files) {
  const docs = [];
  const errors = [];
  for (const f of [...(files || [])]) {
    try { docs.push(await readAttachment(f)); }
    catch (e) { errors.push(e.message || String(e)); }
  }
  return { docs, errors };
}

/** Open an attachment in a new tab. (aslViewCert 6640) */
export function viewAttachment(doc) {
  if (!doc || !doc.data) return;
  const w = window.open('');
  if (!w) return;   // pop-up blocked — nothing more we can do from here
  w.document.write(doc.type === 'pdf'
    ? `<iframe src="${doc.data}" style="border:0;width:100%;height:100vh"></iframe>`
    : `<img src="${doc.data}" style="max-width:100%">`);
  w.document.title = doc.name || 'Document';
}
