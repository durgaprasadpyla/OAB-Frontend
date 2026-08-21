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
 * Next invoice number, e.g. "BFX/2026-27/093". Returns { no, next }.
 *
 * Single, authoritative definition of the invoice-number format, matching the
 * backend SequenceService: BFX company code (client's series since Aug 2026),
 * Apr-start financial year as <yyyy>-<yy>, number zero-padded to 3 digits.
 * The legacy "BL/<yy>-<yy>/<n>" series is retired (historical entries keep it).
 * `dateIso` (optional) selects the financial year; defaults to today.
 */
export function nextInvNo(lastInvNo, dateIso) {
  const [y1, y2] = financialYear(dateIso).split('-');
  const n = num(lastInvNo) + 1;
  return { no: `BFX/${y1}-${y2.slice(-2)}/${String(n).padStart(3, '0')}`, next: n };
}

// nextPONum was removed: purchase PO numbers are now assigned server-side
// (POST /api/purchase-orders -> resp.poNum via SequenceService). The client no
// longer derives PO numbers locally, so no preview helper is needed here.
