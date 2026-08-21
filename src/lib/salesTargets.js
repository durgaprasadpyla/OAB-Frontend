// Sales targets — per rep, per period, per dimension.
//
// A target is NOT one monthly number. Production stores one row per
// (rep × period × dimension × key):
//
//   { id, rep_id, period_type:'month'|'quarter'|'half'|'annual',
//     period_key:'2026-08' | '2026-Q3' | '2026-H2' | '2026',
//     dim:'category'|'despatch', key:'Dairy' | 'Pouch', amount }
//
// …because a sale counts toward BOTH its category target and its dispatch-form
// target: the SKU carries a category and a dispatch form, and a PO booked on that
// SKU deducts from both. Achievement is therefore computed from the POs joined to
// their SKUs, never stored.
//
// Ported from sdashCurPeriod / sdashTPeriods / sdashPeriodMatch / sdashRepTargets /
// sdashTargetAchieved / sdashAddTarget / sdashDelTarget, and the rep-side mirrors
// repPeriodMatch / repTargetAchieved.
import { salesUid, REP_CATEGORIES } from './sales.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The four period types, with the labels the pickers show. */
export const PERIOD_TYPES = [
  ['month', 'Monthly'], ['quarter', 'Quarterly'], ['half', 'Half-yearly'], ['annual', 'Annual'],
];
export const PERIOD_LABEL = { month: 'Monthly', quarter: 'Quarterly', half: 'Half-yearly', annual: 'Annual' };

/** Dispatch forms a target can be set against. (REP_DESPATCH / sdashTDesp) */
export const DESPATCH_FORMS = [
  ['Roll', 'Roll'], ['Label', 'Label'], ['Shrink Sleeve', 'Shrink Sleeve'],
  ['Pouch', 'Pouch'], ['Bulk Bag', 'Bulk Bags'], ['Others', 'Others'],
];

export const targetCategories = () => REP_CATEGORIES;
export const targetDespatchForms = () => DESPATCH_FORMS.map((d) => d[0]);

/** The period key covering today for a period type. (sdashCurPeriod) */
export function currentPeriod(ptype, now = new Date()) {
  if (ptype === 'month') return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  if (ptype === 'quarter') return now.getFullYear() + '-Q' + Math.ceil((now.getMonth() + 1) / 3);
  if (ptype === 'half') return now.getFullYear() + '-H' + ((now.getMonth() + 1) <= 6 ? 1 : 2);
  return String(now.getFullYear());
}

/** The period keys offered in the picker for a type. (sdashTPeriods) */
export function periodOptions(ptype, now = new Date()) {
  const out = [];
  if (ptype === 'month') {
    for (let i = -3; i <= 8; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    }
  } else if (ptype === 'quarter') {
    [now.getFullYear(), now.getFullYear() + 1].forEach((y) => { for (let q = 1; q <= 4; q++) out.push(y + '-Q' + q); });
  } else if (ptype === 'half') {
    [now.getFullYear(), now.getFullYear() + 1].forEach((y) => { out.push(y + '-H1'); out.push(y + '-H2'); });
  } else {
    const y = now.getFullYear();
    return [String(y - 1), String(y), String(y + 1)];
  }
  return out;
}

/** Whether a YYYY-MM-DD date falls inside a period key. (sdashPeriodMatch) */
export function periodMatch(dateStr, ptype, pkey) {
  if (!dateStr || !pkey) return false;
  const d = String(dateStr).slice(0, 10);
  if (ptype === 'month') return d.slice(0, 7) === pkey;
  if (ptype === 'annual') return d.slice(0, 4) === pkey;
  if (ptype === 'quarter') return (d.slice(0, 4) + '-Q' + Math.ceil(parseInt(d.slice(5, 7), 10) / 3)) === pkey;
  if (ptype === 'half') return (d.slice(0, 4) + '-H' + (parseInt(d.slice(5, 7), 10) <= 6 ? 1 : 2)) === pkey;
  return false;
}

/** The dimensioned targets set for one rep in one period. (sdashRepTargets) */
export function repTargets(targets, repId, ptype, pkey) {
  return arr(targets).filter((t) => t.rep_id === repId && t.period_type === ptype && t.period_key === pkey && t.dim);
}

/** Every dimensioned target a rep has, whatever the period. (repTargets tab) */
export function allRepTargets(targets, repId) {
  return arr(targets).filter((t) => t.rep_id === repId && t.dim);
}

/**
 * Sales value a rep booked in a period against one category or dispatch form.
 * The dimension lives on the SKU, so the PO is joined to it. (sdashTargetAchieved)
 */
export function targetAchieved(pos, skus, repId, ptype, pkey, dim, key) {
  const byId = new Map(arr(skus).map((s) => [s.id, s]));
  return arr(pos).reduce((sum, p) => {
    if (p.created_by !== repId) return sum;
    if (!periodMatch(p.date, ptype, pkey)) return sum;
    const sku = byId.get(p.sku_id);
    if (!sku) return sum;
    const val = n(p.qty) * n(p.price);
    const dimKey = dim === 'category' ? (sku.category || '') : (sku.dispatch_form || sku.dispatch_type || '');
    return dimKey === key ? sum + val : sum;
  }, 0);
}

/**
 * Add a target, or overwrite the amount if one already exists for the same
 * rep/period/dimension/key. Returns a NEW targets array. (sdashAddTarget)
 */
export function upsertTarget(targets, { repId, ptype, pkey, dim, key, amount }, { uid = salesUid } = {}) {
  const value = n(amount);
  const same = (t) => t.rep_id === repId && t.period_type === ptype && t.period_key === pkey && t.dim === dim && t.key === key;
  const list = arr(targets);
  if (list.some(same)) return list.map((t) => (same(t) ? { ...t, amount: value } : t));
  return [...list, { id: uid('tgt'), rep_id: repId, period_type: ptype, period_key: pkey, dim, key, amount: value }];
}

/** Drop one target by id. (sdashDelTarget) */
export function deleteTarget(targets, id) {
  return arr(targets).filter((t) => t.id !== id);
}

/** Progress bar colour: met, close, or short. */
export function progressColor(pct) {
  return pct >= 100 ? '#0e6fb8' : pct >= 60 ? '#c9a100' : '#c0392b';
}
