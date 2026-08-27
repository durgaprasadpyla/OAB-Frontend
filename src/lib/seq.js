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
 * Next invoice number PREVIEW, e.g. "BL/26-27/424". Returns { no, next }.
 *
 * This is only a client-side default for the (editable) invoice-number field — the
 * server (SequenceService / createInvoice) is authoritative and assigns the real,
 * atomic number on submit. The format mirrors the backend so the preview matches:
 * "BL" prefix, short-short Apr-start financial year (<yy>-<yy>), plain number.
 * The FY 26-27 series restarts at 424 (client, 2026), so the preview is floored there.
 * `dateIso` (optional) selects the financial year; defaults to today.
 */
export const INV_SERIES_START = 424;
export function nextInvNo(lastInvNo, dateIso) {
  const [y1, y2] = financialYear(dateIso).split('-');
  const period = `${y1.slice(-2)}-${y2.slice(-2)}`;               // "26-27"
  const floor = period === '26-27' ? INV_SERIES_START : 1;
  const n = Math.max(num(lastInvNo) + 1, floor);
  return { no: `BL/${period}/${n}`, next: n };
}

// nextPONum was removed: purchase PO numbers are now assigned server-side
// (POST /api/purchase-orders -> resp.poNum via SequenceService). The client no
// longer derives PO numbers locally, so no preview helper is needed here.
