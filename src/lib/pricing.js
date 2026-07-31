// Sale/cost pricing, ported from the legacy app. All functions take the data
// context ({ prices, jss, matRates }) instead of reading globals.
import { num } from './calc.js';

/** Price Master lookup for a spec. (getPM 4359) */
export function getPM(spec, prices) {
  return (prices && prices[String(spec || '').trim()]) || { price: 0, costPrice: 0, transport: 'At Actuals' };
}

/** Unit of measure from dispatch form. (getUOM 5638) */
export function getUOM(dispatchForm) {
  const df = String(dispatchForm || '').toLowerCase().trim();
  return (df === 'roll' || df === 'rolls') ? 'Kgs' : 'Pcs';
}

/** Raw-material ₹/kg rates — device-local (localStorage 'bloomflex_mat'), as in the legacy app. */
export function loadMatRates() {
  try { return JSON.parse(localStorage.getItem('bloomflex_mat') || '{}') || {}; } catch { return {}; }
}
export function saveMatRates(rates) {
  try { localStorage.setItem('bloomflex_mat', JSON.stringify(rates || {})); } catch { /* ignore */ }
}

/**
 * Live raw-material cost from JSS material + pouch weight × current ₹/kg rates.
 * Returns null when it can't be derived (multi-layer, no pouch weight, no rate),
 * in which case callers fall back to the Price Master cost. (getDynamicCost 4408)
 */
export function getDynamicCost(spec, { jss, matRates } = {}) {
  const jssRow = (jss || []).find((j) => String(j.spec || '').trim() === String(spec || '').trim());
  if (!jssRow || !jssRow.pouchWeight) return null;
  const mat = String(jssRow.material || '').toLowerCase().trim();
  if (mat.includes('+')) return null; // multi-layer laminate
  const wKg = num(jssRow.pouchWeight) / 1000;
  const R = matRates || {};
  if ((mat === 'bopp' || mat === 'plain bopp' || mat === 'peral bopp') && num(R.bopp) > 0) return wKg * num(R.bopp);
  if ((mat.includes('af-bopp') || mat.includes('af_bopp')) && num(R.afbopp) > 0) return wKg * num(R.afbopp);
  if ((mat.includes('ldpe') || mat.includes('af-ldpe') || mat.includes('af_ldpe') || mat.includes('af - ldpe'))
    && !mat.includes('pet') && !mat.includes('alu') && num(R.afldpe) > 0) return wKg * num(R.afldpe);
  return null;
}

/** Effective cost price: live RM cost if derivable, else Price Master cost. (getCostPrice 4437) */
export function getCostPrice(spec, ctx) {
  const dyn = getDynamicCost(spec, ctx);
  return dyn !== null ? dyn : num(getPM(spec, ctx && ctx.prices).costPrice);
}

/** Cost price plus where it came from (for the margin drill-down). (getCostPriceWithSource 4431) */
export function getCostPriceWithSource(spec, ctx) {
  const dyn = getDynamicCost(spec, ctx);
  if (dyn !== null) return { cost: dyn, source: 'Live RM rate' };
  const pm = num(getPM(spec, ctx && ctx.prices).costPrice);
  return { cost: pm, source: pm > 0 ? 'Price Master' : 'None (₹0)' };
}
