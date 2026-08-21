// Sales Rep Portal — the SKU → quotation → PO workflow.
//
// A rep cannot book a PO against any SKU they like. The SKU walks a six-stage
// workflow first, and three of those stages are *mandatory* before a PO is allowed:
//
//   CSA received  ·  Quotation received  ·  Quotation accepted
//
// "CSA received" is deliberately NOT rep-editable — it turns green only when QC has
// generated the CSA report for that SKU, so a rep cannot self-certify their way to a
// PO. Once the quotation is accepted the rep records the agreed price slabs, and a PO
// is then validated against the slab that applies to its quantity.
//
// Ported from repSkus / repToggleSkuFlag / repSkuReadyForPO / repAcceptedMinPrice /
// repPO / repSavePO / repVisit / repSaveVisit / repQuotesToSend / repPlatesForSku.
import { salesUid, salesToday, datePlus } from './sales.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const s = (v) => String(v == null ? '' : v).trim();

/** `[key, label, mandatoryForPO]` — the SKU workflow toggles. (REP_SKU_STAGES) */
export const REP_SKU_STAGES = [
  ['sample_received', 'Sample received', false],
  ['sample_sent', 'Sample sent', false],
  ['csa_received', 'CSA received', true],
  ['quotation_received', 'Quotation received', true],
  ['quotation_sent', 'Quotation sent', false],
  ['quotation_accepted', 'Quotation accepted', true],
];

/** Toggling one of these stamps a timestamp alongside it. (repToggleSkuFlag) */
const STAMP = { quotation_sent: 'quotation_sent_at', sample_sent: 'sample_sent_at', sample_received: 'sample_received_at' };

/** True once QC has generated a CSA report for this SKU. (repSkuCsaDone) */
export function skuCsaDone(sales, sku) {
  return !!(sku && arr(sales && sales.qc_reports).some((r) => r.sku_id === sku.id));
}

/** A SKU may carry a PO only with CSA + quotation received + accepted. (repSkuReadyForPO) */
export function skuReadyForPO(sales, sku) {
  return !!(sku && skuCsaDone(sales, sku) && sku.quotation_received && sku.quotation_accepted);
}

/**
 * Flip one workflow stage. `csa_received` is read-only — QC owns it — so the SKU
 * comes back untouched. Returns a NEW skus array. (repToggleSkuFlag)
 */
export function toggleSkuStage(skus, skuId, key, { now = new Date() } = {}) {
  if (key === 'csa_received') return arr(skus);
  return arr(skus).map((sku) => {
    if (sku.id !== skuId) return sku;
    const next = { ...sku, [key]: !sku[key] };
    const stamp = STAMP[key];
    if (stamp) {
      if (next[key] && !next[stamp]) next[stamp] = now.toISOString();
      if (!next[key]) next[stamp] = '';
    }
    return next;
  });
}

/**
 * The accepted price that applies to an order quantity: the highest slab whose
 * quantity the order reaches, falling back to the smallest slab below it. Returns
 * null when the SKU has no accepted slabs. (repAcceptedMinPrice)
 */
export function acceptedMinPrice(sku, qty) {
  const tiers = arr(sku && sku.price_tiers).filter((t) => t && t.qty);
  if (!tiers.length) return null;
  const sorted = tiers.slice().sort((a, b) => n(a.qty) - n(b.qty));
  let applicable = sorted[0];
  sorted.forEach((t) => { if (n(t.qty) <= n(qty)) applicable = t; });
  return n(applicable.price);
}

/** Plate cost PM pushed for this SKU's CSA report, or null. (repPlatesForSku) */
export function platesForSku(sales, sku) {
  if (!sku) return null;
  const r = arr(sales && sales.qc_reports).find((x) => x.sku_id === sku.id && x.plates && x.plates_pushed);
  if (!r) return null;
  const p = r.plates;
  return { p, total: (n(p.ci_per) * n(p.ci_n)) + (n(p.off_per) * n(p.off_n)) };
}

/**
 * SKUs whose quotation has come back from the desk but has not been sent on to the
 * customer yet — the banner at the top of the rep's screens. (repQuotesToSend)
 */
export function quotesToSend(sales, repId) {
  return arr(sales && sales.skus).filter((sku) => {
    if (sku.created_by !== repId || sku.quotation_sent) return false;
    const hasQuote = arr(sales && sales.quotations).some((q) => arr(q.items).some((i) => i.sku_id === sku.id));
    return hasQuote || sku.quotation_received;
  });
}

/** A rep's own SKUs, newest first. */
export function skusForRep(sales, repId) {
  return arr(sales && sales.skus)
    .filter((sku) => sku.created_by === repId)
    .sort((a, b) => s(b.created_at).localeCompare(s(a.created_at)));
}

/**
 * Dispatch forms allowed for a customer + category. Sales Admin can restrict them
 * per category on the Manage tab; with nothing configured, every form is allowed.
 * (repFilterDespatch)
 */
export function allowedDespatchForms(lead, category, all) {
  const map = lead && lead.category_dispatch_forms;
  const allowed = (map && category && arr(map[category]).length) ? map[category] : null;
  return allowed ? all.filter((d) => allowed.indexOf(d[0]) > -1) : all;
}

/** A new SKU row. Throws with the production message when a field is missing. (repSaveSku) */
export function buildSku({ leadId, name, category, dispatchForm }, repId, { now = new Date(), uid = salesUid } = {}) {
  if (!leadId) throw new Error('Select a customer.');
  if (!s(name)) throw new Error('Enter the SKU name.');
  if (!s(category)) throw new Error('Select a category.');
  if (!s(dispatchForm)) throw new Error('Select a dispatch form.');
  return {
    id: uid('sku'), lead_id: leadId, sku_name: s(name), category: s(category),
    dispatch_form: s(dispatchForm), created_by: repId, created_at: now.toISOString(),
    sample_received: false, sample_sent: false, quotation_received: false,
    quotation_sent: false, quotation_accepted: false, price_tiers: [],
  };
}

/**
 * A new PO row, validated the way production validates it: the SKU must be cleared
 * through CSA + quotation, and the price may not fall below the accepted slab for
 * the ordered quantity. (repSavePO)
 */
export function buildPo({ sku, qty, price, poNumber, date }, sales, repId, { now = new Date(), uid = salesUid } = {}) {
  const q = n(qty);
  const p = n(price);
  if (!sku || !q || !p) throw new Error('SKU, quantity and price are required.');
  if (!skuReadyForPO(sales, sku)) throw new Error('This SKU is not cleared for a PO (needs CSA + quotation received + accepted).');
  const min = acceptedMinPrice(sku, q);
  if (min != null && p < min) {
    throw new Error(`✕ Price ₹${p} is below the accepted price ₹${min} for ${q} units. Enter the agreed price or higher.`);
  }
  return {
    id: uid('po'), lead_id: sku.lead_id, sku_id: sku.id, qty: q, price: p,
    po_number: s(poNumber), date: date || salesToday(now),
    category: sku.category, dispatch_form: sku.dispatch_form || sku.dispatch_type,
    created_by: repId, created_at: now.toISOString(),
  };
}

/**
 * A logged visit / update. Notes are mandatory — an untyped entry is worthless in a
 * follow-up history — and the next ping defaults to two days out rather than being
 * left blank, so nothing silently drops off the follow-up list. (repSaveVisit)
 */
export function buildVisit({ leadId, type, outcome, expense, followUp, followUpType }, repId, { now = new Date(), uid = salesUid } = {}) {
  if (!leadId) throw new Error('Select a lead.');
  if (!s(outcome)) throw new Error('Please add notes on what happened in this visit/update before saving.');
  const isVisit = type === 'Visit';
  return {
    id: uid('inter'), lead_id: leadId, date: salesToday(now), created_at: now.toISOString(),
    type: s(type), outcome: s(outcome),
    expense: isVisit ? n(expense) : 0,
    follow_up_date: followUp || datePlus(2, now),
    follow_up_type: s(followUpType), created_by: repId,
  };
}

/** Total value of a PO row. */
export const poValue = (po) => n(po && po.qty) * n(po && po.price);
