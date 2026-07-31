// Formatting helpers, matching the legacy app's Indian-locale conventions.

export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Indian-grouped number, e.g. 1234567 -> "12,34,567". */
export function inr(v, dp = 0) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Rupee amount, e.g. "₹12,34,567.00". */
export function rupees(v, dp = 2) {
  return '₹' + inr(v, dp);
}

/** Integer display that shows a dash for zero/blank — the legacy `fN` helper. */
export function dash(v) {
  const n = Math.round(num(v));
  return (!n || Number.isNaN(n)) ? '-' : n.toLocaleString('en-IN');
}

/** Today's date as YYYY-MM-DD (local), the format the legacy app stores. */
export function today() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ISO YYYY-MM-DD -> DD/MM/YYYY for display. Passes through unknown formats. */
export function fmtDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return String(iso);
}

/** Indian financial year for a date, e.g. 2026-07 -> "2026-2027". */
export function financialYear(iso) {
  const d = iso ? new Date(iso) : new Date();
  const y = d.getFullYear();
  // FY starts in April.
  return d.getMonth() >= 3 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}

function threeDigits(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return (h ? ONES[h] + ' Hundred' + (rest ? ' ' : '') : '') + (rest ? twoDigits(rest) : '');
}

// Words for the crore group, safe for very large invoices (up to ~99999 crore)
// instead of returning "undefined" once crore >= 1000.
function croreWords(n) {
  if (n < 1000) return threeDigits(n);
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  return (th ? twoDigits(th) + ' Thousand' + (rest ? ' ' : '') : '') + (rest ? threeDigits(rest) : '');
}

/** Amount in words, Indian system (Rupees … Paise … Only). For invoices. */
export function amountInWords(amount) {
  const a = Math.round(num(amount) * 100) / 100;
  const rupeesPart = Math.floor(a);
  const paise = Math.round((a - rupeesPart) * 100);
  if (rupeesPart === 0 && paise === 0) return 'Zero Rupees Only';

  const crore = Math.floor(rupeesPart / 10000000);
  const lakh = Math.floor((rupeesPart % 10000000) / 100000);
  const thousand = Math.floor((rupeesPart % 100000) / 1000);
  const hundred = rupeesPart % 1000;

  let words = '';
  if (crore) words += croreWords(crore) + ' Crore ';
  if (lakh) words += twoDigits(lakh) + ' Lakh ';
  if (thousand) words += twoDigits(thousand) + ' Thousand ';
  if (hundred) words += threeDigits(hundred) + ' ';
  words = words.trim();

  let out = (words ? words + ' Rupees' : 'Rupees');
  if (paise) out += ' and ' + twoDigits(paise) + ' Paise';
  return out + ' Only';
}
