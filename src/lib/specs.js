// Which JSS row IS a spec code — one rule, used by every screen.
//
// The JSS master is a list, not a keyed table, so the same spec code can appear on
// more than one row (QC creates A1404; someone later re-types another row's Spec
// No. as A1404; an Excel import appends instead of updating). Until now each screen
// picked its own copy and they disagreed:
//
//   · QC's Route and BOM, the BOM panel and the Price Master took the FIRST row
//     (`.find` / "if (!seen.has(code))") — A1404 read as a Label;
//   · the JSS editor, the OAB board and Trends took the LAST (`m[code] = row`) —
//     the same A1404 read as a Shrink Sleeve.
//
// Both were defensible and that was the problem: the tool contradicted itself and
// the order desk could not tell which answer was the spec. So the choice is made
// HERE, once:
//
//   1. an ACTIVE row beats a Sample / Inactive / Redundant one — a retired record
//      must never speak for a code the factory is still running;
//   2. among equals, the LAST row wins — rows are appended, so the last one is the
//      most recently created or edited, which is what the person who changed it
//      expects to see.
//
// Duplicates stay visible rather than being quietly resolved: `duplicateSpecs`
// feeds the warning on the JSS editor so the stale row gets deleted, because two
// rows for one code is a data fault, not a feature.

const s = (v) => String(v == null ? '' : v).trim();

/** The identity of a spec code — trimmed, case-blind ("a1404" is A1404). */
export const specKey = (v) => s(v).toUpperCase();

/** A JSS row with no status at all is Active — the JSS editor reads it that way too. */
export function specIsActive(row) {
  const st = s(row && row.status) || 'Active';
  return st.toLowerCase() === 'active';
}

/**
 * The row that speaks for a code, given every row carrying it: the last Active
 * one, else the last one. Rows are taken in the order the master holds them.
 */
export function chooseSpecRow(rows) {
  const list = (rows || []).filter(Boolean);
  if (list.length <= 1) return list[0] || null;
  const active = list.filter(specIsActive);
  const pool = active.length ? active : list;
  return pool[pool.length - 1];
}

/**
 * code → the row that speaks for it. The key is the code exactly as the row
 * spells it AND its upper-case form, so a lookup by either works.
 */
export function specIndex(jss) {
  const byKey = new Map();
  (jss || []).forEach((j) => {
    const k = specKey(j && j.spec);
    if (!k) return;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(j);
  });
  const out = {};
  byKey.forEach((rows, k) => {
    const win = chooseSpecRow(rows);
    out[k] = win;
    const asWritten = s(win.spec);
    if (asWritten && asWritten !== k) out[asWritten] = win;
  });
  return out;
}

/** The row that speaks for one code, or null. */
export function specFor(jss, code) {
  const k = specKey(code);
  if (!k) return null;
  return chooseSpecRow((jss || []).filter((j) => specKey(j && j.spec) === k));
}

/**
 * One row per code — the winner of each — in the order the codes first appear.
 * What a "list of specs" means anywhere a code must appear once.
 */
export function uniqueSpecs(jss) {
  const order = [];
  const seen = new Set();
  (jss || []).forEach((j) => {
    const k = specKey(j && j.spec);
    if (!k || seen.has(k)) return;
    seen.add(k);
    order.push(k);
  });
  const idx = specIndex(jss);
  return order.map((k) => idx[k]).filter(Boolean);
}

/** The fields a duplicate is worth arguing about — what makes two rows disagree. */
const TELLING = [
  ['dispatchForm', 'Dispatch Form'], ['status', 'Status'], ['customer', 'Customer'], ['group', 'Group'],
  ['jobName', 'Job Name'], ['jobType', 'Job Type'], ['material', 'Material'], ['subBrand', 'Sub Brand'],
  ['filmWidth', 'Film Width'], ['gsm', 'GSM'], ['mic', 'MIC'], ['width', 'Width'], ['height', 'Height'],
];

/**
 * Every code held by more than one row, with what they disagree about and which
 * row is in force — so the screen can say "A1404 is on 2 rows; they disagree on
 * Dispatch Form (Label / Shrink Sleeve); Shrink Sleeve is in force".
 */
export function duplicateSpecs(jss) {
  const byKey = new Map();
  (jss || []).forEach((j, i) => {
    const k = specKey(j && j.spec);
    if (!k) return;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ row: j, index: i });
  });
  const out = [];
  byKey.forEach((entries, code) => {
    if (entries.length < 2) return;
    const rows = entries.map((e) => e.row);
    const winner = chooseSpecRow(rows);
    const differing = TELLING
      .map(([field, label]) => {
        const values = [...new Set(rows.map((r) => s(r[field])))].filter((v) => v !== '');
        return values.length > 1 ? { field, label, values } : null;
      })
      .filter(Boolean);
    out.push({
      code,
      count: entries.length,
      indexes: entries.map((e) => e.index),
      rows,
      winner,
      winnerIndex: (entries.find((e) => e.row === winner) || entries[entries.length - 1]).index,
      differing,
    });
  });
  return out.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}
