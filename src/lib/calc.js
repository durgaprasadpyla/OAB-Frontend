// Core business computations, ported verbatim from the legacy app so numbers
// match to the rupee/metre. Line references are to the original index.html.

export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** OAB production balance — INCLUDES finished goods. (legacy line 1470) */
export function balance(r) {
  return Math.max(0, num(r.poQty) - num(r.invDisp) - num(r.manDisp) - num(r.fg));
}

/** Invoice-able balance — EXCLUDES finished goods. (legacy line 1991) */
export function invBalance(r) {
  return Math.max(0, num(r.poQty) - num(r.invDisp) - num(r.manDisp));
}

/** Dispatched total = invoiced + manual. (legacy 1868/3779) */
export function dispatched(r) {
  return num(r.invDisp) + num(r.manDisp);
}

/**
 * Running metres for a dispatch quantity, plus a +5% wastage figure. JSS values
 * (dispatch form, width, height, film width, gsm) are authoritative and win over
 * the OAB row when a spec match is passed in. (legacy calcMetres, lines 1760–1788)
 */
export function calcMetres(r, qty, jss) {
  const df = String((jss && jss.dispatchForm) || r.dispatchForm || '').toLowerCase().trim();
  const jt = String((jss && jss.jobType) || r.jobType || '').toLowerCase().trim();
  const w = num((jss && jss.width) || r.width);
  const h = num((jss && jss.height) || r.height);
  const fw = num((jss && jss.filmWidth) || r.filmWidth);
  const gsm = num((jss && jss.gsm) || r.gsm);
  const q = num(qty);
  let base = 0;
  // Shrink-sleeve jobs run/dispatch by sleeve height × piece count regardless of the
  // Dispatch Form (they're often still tagged "Roll"), so this takes precedence. (legacy 2488)
  if (jt === 'shrink sleeve') base = q * h / 1000;
  else if (df === 'pouch' || df === 'pouches') base = q * w / 1000;
  else if (df === 'bulk bag' || df === 'bulk bags') base = q * h / 1000;
  else if (df === 'sleeve' || df === 'sleeves') base = q * h / 1000;   // Qty × Sleeve Height ÷ 1000 (legacy 2496)
  else if (df === 'roll' || df === 'rolls' || df === 'kgs' || df === 'kg') base = (fw > 0 && gsm > 0) ? q / ((fw / 1000) * (gsm / 1000)) : 0;
  else if (df === 'labels' || df === 'label') base = 0;
  else base = q * w / 1000;
  return { net: Math.round(base), withWastage: Math.round(base * 1.05) };
}

/**
 * Weight in KILOGRAMS of the film for `qty` of a spec — `{ net, withWastage }` —
 * or null when it cannot be derived.
 *
 * This is the same physical thing `calcMetres` measures, weighed instead of run
 * out: film to consume. So it carries the SAME +5% wastage allowance — the JSS
 * `pouchWeight` is the film weight IN a finished pouch and excludes the trim you
 * lose, so `withWastage` is what you actually consume, parallel to the metres.
 *
 * Rolls are ordered BY WEIGHT — their PO qty is already kilograms — so the
 * quantity is the net weight directly. Everything else is a piece count, and the
 * per-piece weight comes from the JSS `pouchWeight` (grams, the
 * `((H×2)+gusset)×W×GSM ÷ 1,000,000` figure QC computes on the spec).
 *
 * Returns null rather than 0 when the spec carries no pouch weight, so callers
 * can tell "nothing to weigh" apart from "weight not recorded yet" and say so
 * instead of quietly under-reporting a total.
 */
export function calcKg(r, qty, jss) {
  const df = String((jss && jss.dispatchForm) || r.dispatchForm || '').toLowerCase().trim();
  const q = num(qty);
  const roll = df === 'roll' || df === 'rolls' || df === 'kgs' || df === 'kg';
  let net;
  if (roll) net = q;
  else {
    const pw = num((jss && jss.pouchWeight) || r.pouchWeight);
    if (!(pw > 0)) return null;
    net = q * pw / 1000;
  }
  return { net, withWastage: net * 1.05 };
}

function gussetSum(gusset) {
  return String(gusset ?? '').split('+').reduce((s, p) => s + (Number(p.trim()) || 0), 0);
}

/** Pouch weight in grams — JSS Editor variant, includes sealing. (jssCalcPW 2617) */
export function pouchWeightJSS({ height, gusset, sealing, width, gsm }) {
  return ((num(height) * 2) + gussetSum(gusset) + num(sealing)) * num(width) * num(gsm) / 1000000;
}

/** Pouch weight in grams — QC variant, no sealing. (qcCalcPW 2630) */
export function pouchWeightQC({ height, gusset, width, gsm }) {
  return ((num(height) * 2) + gussetSum(gusset)) * num(width) * num(gsm) / 1000000;
}

/**
 * Invoice tax breakup: 18% GST on (subtotal + freight), rounded, with round-off.
 * (renderInvoiceDoc, lines 2150–2180)
 */
export function gstBreakup(subTotal, freight = 0, gstPct = 18, mode = 'CGST_SGST') {
  const taxable = num(subTotal) + num(freight);
  const gstAmt = Math.round(taxable * (gstPct / 100) * 100) / 100;
  const total = taxable + gstAmt;
  const invAmount = Math.round(total);
  const roundOff = Math.round((invAmount - total) * 100) / 100;
  return {
    subTotal: num(subTotal), freight: num(freight), taxable, gstPct, gstAmt, roundOff, invAmount,
    cgst: mode === 'IGST' ? 0 : gstAmt / 2,
    sgst: mode === 'IGST' ? 0 : gstAmt / 2,
    igst: mode === 'IGST' ? gstAmt : 0,
  };
}

/** Purchase PO status from its line items. (purchComputeStatus 6252) */
export function purchComputeStatus(items) {
  if (!items || !items.length) return 'Open';
  const allRecv = items.every((i) => num(i.receivedQty) >= num(i.qty));
  const anyRecv = items.some((i) => num(i.receivedQty) > 0);
  return allRecv ? 'Closed' : anyRecv ? 'Partial' : 'Open';
}

/** Payment-term days from a free-text term. (parsePaymentDays ~7108) */
export function parsePaymentDays(terms) {
  const t = String(terms || '').toLowerCase();
  if (/advance|immediate|proforma/.test(t)) return 0;
  const m = t.match(/\d+/);
  return m ? parseInt(m[0], 10) : 30;
}
