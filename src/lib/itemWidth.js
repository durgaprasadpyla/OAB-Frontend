// An item's slitting width, as a NUMBER of millimetres (Issues 4.1).
//
// Width has always been written inside the item's DESCRIPTION — "435 MM",
// "680 MM (AJ)", "700" — because that is how item codes are allocated. Text cannot
// be compared, so nothing could enforce the rule the floor actually works to:
//
//     a 1200 mm roll may be slit into 700 + 500, never 700 + 600.
//
// So the Padmin Item Master now carries a numeric Width (mm) field, and this module
// is the one place that answers "how wide is this item / this roll", so the Item
// Master, the Stores return screen and the job allocation cannot disagree.

/** A width typed or stored anywhere: a positive number of mm, or null. */
export function parseWidthMm(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The width an item's description states, for the items that predate the field.
 * The leading run of digits IS the width.
 *
 * The 50 mm floor stops a description that merely BEGINS with a number ("3 PLY
 * LAMINATE") reading as a 3 mm roll — below that it is a count, not a width.
 */
export function widthFromName(name) {
  const t = String(name == null ? '' : name).trim();
  const m = /^(\d+(?:\.\d+)?)/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 50 ? n : null;
}

/**
 * How wide this item is. The typed number wins; an item that has never been given
 * one falls back to what its description says, so the rule works on the whole
 * catalogue from the day it ships rather than only on re-typed rows.
 *
 * Accepts a row from either store — the Padmin Item Master (`specificMaterial`),
 * an approved-supplier row, or the normalized item master (`name`).
 */
export function itemWidthMm(item) {
  if (!item) return null;
  return parseWidthMm(item.widthMm)
    ?? widthFromName(item.specificMaterial || item.name || item.itemName || '');
}

/**
 * How wide a stored ROLL is: what was stamped on it when it was received, else the
 * width of the item it is a roll of. A roll booked before the field existed carries
 * no width of its own, and the parent-width rule must still be able to check it.
 */
export function unitWidthMm(unit, item) {
  return parseWidthMm(unit && unit.widthMm) ?? itemWidthMm(item);
}

/** "1200 mm" / "—" — one spelling of a width everywhere it is shown. */
export function fmtWidth(v) {
  const n = parseWidthMm(v);
  return n === null ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)} mm`;
}
