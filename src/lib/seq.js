// Sequence helpers for the auto-generated document numbers.
import { financialYear } from './format.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Next SO number from the stored {y, n}. Returns { so, next:{y,n} }. */
export function nextSO(lastSO) {
  const y = lastSO && lastSO.y ? String(lastSO.y) : String(new Date().getFullYear()).slice(-2);
  const n = num(lastSO && lastSO.n) + 1;
  return { so: `${y}/${n}`, next: { y, n } };
}

export function isSOFormat(s) {
  return /^\d{2}\/\d+$/.test(String(s || ''));
}

/**
 * Next invoice number, e.g. "BL/26-27/329". Returns { no, next }.
 *
 * Single, authoritative definition of the invoice-number format. It matches the
 * invoice screen (financial-year prefix, Apr-start) and the backend
 * SequenceService; the old divergent "BF/<yy>/<n>" form has been retired.
 * `dateIso` (optional) selects the financial year; defaults to today.
 */
export function nextInvNo(lastInvNo, dateIso) {
  const [y1, y2] = financialYear(dateIso).split('-');
  const n = num(lastInvNo) + 1;
  return { no: `BL/${y1.slice(-2)}-${y2.slice(-2)}/${n}`, next: n };
}

// nextPONum was removed: purchase PO numbers are now assigned server-side
// (POST /api/purchase-orders -> resp.poNum via SequenceService). The client no
// longer derives PO numbers locally, so no preview helper is needed here.
