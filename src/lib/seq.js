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

/** Next invoice number, e.g. "BF/26/329". Returns { no, next }. */
export function nextInvNo(lastInvNo, yy) {
  const n = num(lastInvNo) + 1;
  const y = yy || String(new Date().getFullYear()).slice(-2);
  return { no: `BF/${y}/${n}`, next: n };
}

/** Next purchase-PO number, e.g. "BLM/PUR/2026-2027/101". */
export function nextPONum(counter, dateIso) {
  return `BLM/PUR/${financialYear(dateIso)}/${num(counter) + 1}`;
}
