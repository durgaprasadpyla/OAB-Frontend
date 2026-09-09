// One item code, one identity — kept in step across the two places the purchase
// blob stores it.
//
// Module 6 holds an item twice: `itemsExtra` is the Padmin Item Master, and every
// `asl` row (supplier ↔ item mapping) carries its own copy of the same descriptive
// columns. Nothing kept them together, so:
//
//   · editing an item in the Item Master left the Approved Suppliers tab showing the
//     OLD description / material / sub-group / UOM, and
//   · editing the identity on the Approved Suppliers tab was silently ignored
//     downstream, because `syncItemsFromPurchase` reads `itemsExtra` FIRST and that
//     copy still said the old thing.
//
// The Excel import already reconciled both stores on the way in; these helpers are
// that same reconciliation, pulled out so every writer uses it.
//
// IDENTITY only. `basicPrice`, `moq` and `leadTime` are on the ASL row too but are
// commercial terms that belong to one supplier's quote, not to the item — two
// suppliers of the same code legitimately charge different prices, and copying one
// onto the other would be wrong.

/** The fields that describe the ITEM, wherever the item is written. */
export const ITEM_IDENTITY = ['specificMaterial', 'materialType', 'subGroup', 'specialty', 'microns', 'uom', 'department'];

const arr = (v) => (Array.isArray(v) ? v : []);
/** A row's item code, from either store's spelling of the field. */
export const identityCode = (r) => String((r && (r.itemCode != null ? r.itemCode : r.code)) || '').trim();

/**
 * Identity per item code, taken from `rows`. The FIRST row carrying a code wins,
 * which is the same rule the backend's item sync applies.
 *
 * `onlyFilled` keeps blank fields out of the patch — used when pushing an ASL row's
 * identity back onto the Item Master, so a column that supplier row never carried
 * cannot wipe what the Item Master knows.
 */
export function identityByCode(rows, { onlyFilled = false } = {}) {
  const out = {};
  arr(rows).forEach((r) => {
    const code = identityCode(r);
    if (!code || out[code]) return;
    const patch = {};
    ITEM_IDENTITY.forEach((f) => {
      const v = r[f];
      if (onlyFilled && String(v == null ? '' : v).trim() === '') return;
      patch[f] = v == null ? '' : v;
    });
    if (Object.keys(patch).length) out[code] = patch;
  });
  return out;
}

/**
 * Stamp those identities onto every row that shares the code. Rows whose code is not
 * in the map are returned untouched (same object), so an unrelated row is never
 * rewritten and React sees no spurious change.
 */
export function applyIdentity(rows, byCode) {
  if (!byCode || !Object.keys(byCode).length) return arr(rows);
  return arr(rows).map((r) => {
    const patch = byCode[identityCode(r)];
    return patch ? { ...r, ...patch } : r;
  });
}

/** True when applying `byCode` would actually change something in `rows`. */
export function identityDiffers(rows, byCode) {
  if (!byCode || !Object.keys(byCode).length) return false;
  return arr(rows).some((r) => {
    const patch = byCode[identityCode(r)];
    return patch && Object.keys(patch).some((f) => String(r[f] == null ? '' : r[f]) !== String(patch[f] == null ? '' : patch[f]));
  });
}

// ── gap-healing and conflict reporting ──────────────────────────────────────
// Written by the parallel session against this file; recovered after a branch
// switch removed the base from under its editor and left only the fragment
// (which referenced `arr` and `identityCode` without them being in scope).

/**
 * Fill only the BLANK identity fields of `rows` from `byCode`. Unlike applyIdentity,
 * a value already written on the row is never replaced — this is for healing gaps
 * (an item whose Specialty is empty here but present on the supplier row), not for
 * deciding who is right when both stores have an opinion.
 */
export function fillGaps(rows, byCode) {
  if (!byCode || !Object.keys(byCode).length) return arr(rows);
  return arr(rows).map((r) => {
    const patch = byCode[identityCode(r)];
    if (!patch) return r;
    let out = r;
    Object.keys(patch).forEach((f) => {
      if (String(r[f] == null ? '' : r[f]).trim() !== '') return;
      if (String(patch[f] == null ? '' : patch[f]).trim() === '') return;
      if (out === r) out = { ...r };
      out[f] = patch[f];
    });
    return out;
  });
}

/**
 * Where the two stores genuinely DISAGREE: both carry the field, and they differ.
 * Gaps are not conflicts (fillGaps closes those silently) — this is the case no rule
 * can settle on its own, so it is shown to the Purchase Admin instead of guessed at.
 *
 * Returns { [code]: { [field]: theOtherValue } } for the rows that differ.
 */
export function identityConflicts(rows, byCode) {
  const out = {};
  if (!byCode || !Object.keys(byCode).length) return out;
  arr(rows).forEach((r) => {
    const code = identityCode(r);
    const patch = byCode[code];
    if (!patch || out[code]) return;
    const diff = {};
    Object.keys(patch).forEach((f) => {
      const mine = String(r[f] == null ? '' : r[f]).trim();
      const theirs = String(patch[f] == null ? '' : patch[f]).trim();
      if (mine && theirs && mine !== theirs) diff[f] = theirs;
    });
    if (Object.keys(diff).length) out[code] = diff;
  });
  return out;
}
