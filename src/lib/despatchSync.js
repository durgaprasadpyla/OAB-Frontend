import { masterApi } from '../api.js';
import { ddList, ddIsOverridden } from './dropdowns.js';

/**
 * Issues 2.2 §2 — QC's "Dispatch Form" reads the normalized dispatch-type master,
 * but the super admin edits the despatch list in Drop-down selections (sales blob,
 * module 12 — QC cannot read it). Any name the admin adds there must therefore
 * exist in the master, or QC only sees the handful of forms that routes happened
 * to create.
 *
 * This creates the MISSING names and never deletes: a form dropped from the list
 * may still be referenced by a route or a live JSS.
 *
 * Only the admin's STORED list is ever pushed — never the built-in defaults, which
 * would quietly add names like "Others" nobody asked for. Best-effort by design:
 * the caller's own work must not fail because the master was unreachable.
 * Returns the names it created.
 */
export async function syncDespatchMaster(names) {
  const wanted = (names || []).map((n) => String(n || '').trim()).filter(Boolean);
  if (!wanted.length) return [];
  const created = [];
  try {
    const existing = await masterApi.listDispatchTypes({ includeInactive: 1 });
    const have = new Set((existing || []).map((t) => String(t.name || '').trim().toLowerCase()));
    for (const nm of wanted) {
      if (have.has(nm.toLowerCase())) continue;
      await masterApi.createDispatchType({ name: nm });
      have.add(nm.toLowerCase());
      created.push(nm);
    }
  } catch { /* best-effort */ }
  return created;
}

/**
 * The despatch forms to push into the master — the EFFECTIVE list, which is what
 * the Drop-down selections screen actually displays.
 *
 * This used to return the stored list only, on the reasoning that built-in
 * defaults were names "nobody asked for". That was wrong in practice: the screen
 * shows the defaults exactly as it shows a saved list, so an admin who never
 * pressed Save still sees five forms and reasonably believes they are configured
 * — while QC saw only the two the routes happened to create. Syncing what the
 * admin is looking at removes that gap. Names are only ever added.
 */
export function effectiveDespatchList(sales) {
  return ddList(sales, 'despatch');
}

/** Kept for callers that only want an explicitly saved list. */
export function storedDespatchList(sales) {
  return ddIsOverridden(sales, 'despatch') ? ddList(sales, 'despatch') : [];
}
