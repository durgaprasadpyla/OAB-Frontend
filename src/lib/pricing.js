// Sale/cost pricing, ported from the legacy app. All functions take the data
// context ({ prices, jss, matRates }) instead of reading globals.
import { num } from './calc.js';
import { specFor } from './specs.js';

/** Price Master lookup for a spec. (getPM 4359) */
export function getPM(spec, prices) {
  return (prices && prices[String(spec || '').trim()]) || { price: 0, costPrice: 0, transport: 'At Actuals' };
}

// Issues 05.11 — quantity-based pricing. A Price Master entry keeps `price`, the sale
// price of any order below the first slab, and may add `tiers`: [{ qty, price }], each
// the price from that PO quantity upward. "Until 5 lakhs … the price that is being
// shown should be 0.72 only … If I enter 5 lakhs or more than 5 lakhs in the PO
// quantity, then the price … should change to 0.70." `priceDate` is when the sale
// price was last revised.

/** A spec's slabs, cleaned and in quantity order. */
export function priceSlabs(entry) {
  return (Array.isArray(entry && entry.tiers) ? entry.tiers : [])
    .map((t) => ({ qty: num(t && t.qty), price: num(t && t.price) }))
    .filter((t) => t.qty > 0 && t.price > 0)
    .sort((a, b) => a.qty - b.qty);
}

/** The sale price for an order quantity: the last slab it reaches, else the base price. */
export function priceForQty(entry, qty) {
  const q = num(qty);
  return priceSlabs(entry).reduce((p, t) => (q >= t.qty ? t.price : p), num(entry && entry.price));
}

/** The Price Master rate of a spec at a PO quantity. */
export const orderPrice = (spec, qty, prices) => priceForQty(getPM(spec, prices), qty);

const lakh = (v) => num(v).toLocaleString('en-IN');
const rs = (v) => '₹' + num(v).toFixed(2);

/** The slabs as a sentence: "₹0.72 below 5,00,000 · ₹0.70 from 5,00,000". */
export function priceBandsText(entry) {
  const slabs = priceSlabs(entry);
  if (!slabs.length) return '';
  return [`${rs(entry.price)} below ${lakh(slabs[0].qty)}`, ...slabs.map((t) => `${rs(t.price)} from ${lakh(t.qty)}`)].join(' · ');
}

/**
 * What the sale-order line should tell the user. A customer's PO price below the rate
 * for this quantity says which quantity that price belongs to; otherwise, the next
 * slab the order could reach. Empty when there is nothing to say.
 */
export function priceNudge(entry, qty, poPrice) {
  const q = num(qty);
  const po = num(poPrice);
  const rate = priceForQty(entry, q);
  const slabs = priceSlabs(entry);
  if (po > 0 && rate > 0 && po < rate - 1e-9) {
    const reachedAt = slabs.find((t) => t.qty > q && t.price <= po);
    return reachedAt
      ? `PO price ${rs(po)} applies only from ${lakh(reachedAt.qty)}; below that it is ${rs(rate)}`
      : `PO price ${rs(po)} is below the ${rs(rate)} for this quantity`;
  }
  const next = slabs.find((t) => t.qty > q);
  return next && q > 0 ? `${rs(next.price)} from ${lakh(next.qty)}` : '';
}

const slabKey = (entry) => JSON.stringify(priceSlabs(entry));

/**
 * The Price Master as it is about to be saved: slabs cleaned, and today's date on every
 * spec whose sale price or slabs changed. A cost or transport edit is no price revision,
 * and a spec nobody touched keeps the date it has.
 */
export function stampPriceDates(before, after, date) {
  const out = {};
  Object.entries(after || {}).forEach(([spec, e]) => {
    const was = (before && before[spec]) || {};
    const next = { ...e };
    const slabs = priceSlabs(e);
    if (slabs.length) next.tiers = slabs; else delete next.tiers;
    const revised = num(e.price) !== num(was.price) || slabKey(e) !== slabKey(was);
    if (revised && (num(e.price) > 0 || slabs.length)) next.priceDate = date;
    out[spec] = next;
  });
  return out;
}

/**
 * When a spec's price was last entered: the Price Master's date or the sales rep's
 * accepted quotation for that spec, whichever is later. Null for a price that has
 * never carried a date, which is every price saved before Issues 05.11.
 */
export function priceDateOf(spec, prices, sales) {
  const sp = String(spec || '').trim();
  const master = String(getPM(sp, prices).priceDate || '').slice(0, 10);
  const rep = ((sales && sales.skus) || [])
    .filter((k) => k && String(k.jss_spec || '').trim() === sp && k.quotation_accepted && k.quotation_accepted_at)
    .map((k) => String(k.quotation_accepted_at).slice(0, 10))
    .sort().pop() || '';
  return rep > master ? rep : (master || null);
}

/**
 * Unit of measure from dispatch form. (getUOM 5638) Issues 17.10 §2: rolls are
 * ordered and billed in metres — this said Kgs, on the PO, proforma and invoice alike.
 */
export function getUOM(dispatchForm) {
  const df = String(dispatchForm || '').toLowerCase().trim();
  if (df === 'roll' || df === 'rolls') return 'Mtrs';
  if (df === 'kgs' || df === 'kg') return 'Kgs';
  return 'Pcs';
}

// Raw-material ₹/kg rates now live on the server (rm_rate table) instead of
// per-device localStorage, so margins are identical on every device. Load them
// via api.js `rmRatesApi.get()` and pass them in as ctx.matRates.

/**
 * Live raw-material cost from JSS material + pouch weight × current ₹/kg rates.
 * Returns null when it can't be derived (multi-layer, no pouch weight, no rate),
 * in which case callers fall back to the Price Master cost. (getDynamicCost 4408)
 */
export function getDynamicCost(spec, { jss, matRates } = {}) {
  const jssRow = specFor(jss, spec);
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
