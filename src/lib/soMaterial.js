// Issues as on 30.09: one sale order's material position, read the same way by the
// PLAN login, the stores desk and the Super Admin.
//
// GET /api/stores/so-material?so= answers, per BOM item of the order: what the BOM
// needs for the WHOLE order (poQty, never the balance — what has been issued is a
// lifetime figure, so the requirement it is measured against must be one too), what
// is allocated (held on a roll), what has been issued net of returns, and whether
// the line is covered. It also carries the allocation rows (with who made them) and
// the roll-wise issue lines, so a roll the stores issued straight to the order shows
// up in PLAN, and a roll PLAN allocated shows up at the stores desk.
//
// The BOM cap is the server's rule (CONTRACTS §5), applied here only so the screen
// can say it before the request is refused: while covered < required one more roll
// may be added, even if it overshoots (292 Kg covered of 300 → a 28 Kg roll is fine,
// so is a 200 Kg one); once covered >= required nothing more is allocated or issued
// against that line. Turning an existing hold into an issue never raises `covered`,
// so it is never capped.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (v) => Number(num(v)).toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** Item codes compared the way the stores and the BOM both mean them. */
export const codeKey = (v) => String(v || '').trim().toUpperCase();

/**
 * A /so-material response, or null when there is none to use: an older backend
 * (404), a test mock's empty list, a bare `{}`. Callers then fall back to the
 * allocation list alone — the screen as it was before.
 */
export function asSoMaterial(m) {
  return m && typeof m === 'object' && !Array.isArray(m) && Array.isArray(m.lines) ? {
    ...m,
    allocations: Array.isArray(m.allocations) ? m.allocations : [],
    issues: Array.isArray(m.issues) ? m.issues : [],
  } : null;
}

/** Who made an allocation, as the screens print it. Blank for a row that does not say. */
export function sourceLabel(src) {
  const s = String(src || '').trim().toUpperCase();
  if (!s) return '';
  if (s === 'STORES') return 'Stores';
  if (s === 'SUPERADMIN') return 'Super Admin';
  return s === 'PLAN' ? 'PLAN' : String(src);
}

/** What an issue line still has out on the floor: issued less what came back. */
export const netOut = (l) => Math.max(0, num(l && l.qtyIssued) - num(l && l.qtyReturned));

/** True when the line has a requirement the cap can be measured against. */
export const hasCap = (line) => !!line && line.required != null && num(line.required) > 0;

/**
 * The BOM cap, as a sentence when it refuses and null when it allows.
 *
 *   line      the so-material line of the item ({ required, covered, allocated, netIssued, uom, itemCode })
 *   increase  the NEW commitment this action adds (an allocation, or the part of an
 *             issue not drawn from this order's own hold on that roll)
 *   pending   what the slip being built already adds on top of `covered`
 */
export function bomCapBlock(line, { so, increase, pending = 0 }) {
  if (!hasCap(line) || !(num(increase) > 1e-9)) return null;
  const covered = num(line.covered) + num(pending);
  if (covered + 1e-9 < num(line.required)) return null;
  const uom = line.uom ? ' ' + line.uom : '';
  return `The BOM of ${so} needs ${fmt(line.required)}${uom} of ${line.itemCode}; ${fmt(covered)} is already allocated or issued `
    + `(allocated ${fmt(line.allocated)}, issued ${fmt(line.netIssued)}${num(pending) > 0 ? `, on this slip ${fmt(pending)}` : ''})`
    + ' — no more can be allocated or issued against it.';
}

/** A BOM line is complete once what is allocated + issued (+ the slip) reaches the requirement. */
export const isComplete = (line, pending = 0) => hasCap(line) && num(line.covered) + num(pending) + 1e-9 >= num(line.required);
