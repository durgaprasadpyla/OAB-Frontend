// Shared dropdown lists (module 12, `dropdowns` key).
//
// Nine lists that several roles read but only the super admin edits: SKU
// categories, dispatch forms, payment types, customer statuses, contact
// designations, visit types, ping types, CSA responsible persons, and the CSA
// substrate master.
//
// Every consumer reads through `ddList(sales, key)` rather than importing the
// constants directly, so an override takes effect everywhere at once. A stored
// list only wins when it is non-empty — an accidental empty save must not blank
// out the app's dropdowns. (applyDropdownOverrides / DD_DEFAULTS)

import { REP_CATEGORIES, REP_PAYTYPES, REP_STATUSES } from './sales.js';
import { SUBSTRATE_DEFAULTS, QC_RESPONSIBLE } from './csa.js';

const arr = (v) => (Array.isArray(v) ? v : []);

/** The editable lists, with where each one surfaces. (DROPDOWN_DEFS) */
export const DROPDOWN_DEFS = [
  // Enhancements 2.0 §5: production Departments are configured here. Unlike the other
  // lists (stored in the sales blob), Departments are backed by the shared normalized
  // Department master (/api/master/departments) so the PAdmin Item Master — which cannot
  // read the sales blob — reads the same source. `master: true` flags that backing.
  { key: 'departments', label: 'Departments', where: 'PAdmin — Item Master', type: 'list', master: 'dept' },
  // Issues 1.0 #6: the Machines master is visible/manageable here too — the same
  // machines the Machines tab, the JSS and the PPC boards use. Adding one pulls
  // its department in from the Departments list above.
  { key: 'machinesMaster', label: 'Machines', where: 'Machines tab · JSS · PPC boards', type: 'list', master: 'machine' },
  // Issues 2.4 §13: the racks the stores desk puts received material away in. Backed
  // by the normalized store_location master rather than the sales blob, because the
  // stores role cannot read that blob — the trap the despatch forms fell into.
  { key: 'storeLocations', label: 'Store Locations', where: 'Stores — GRN put-away', type: 'list', master: 'storeloc' },
  { key: 'categories', label: 'SKU Categories', where: 'Sales Rep · Sales Admin', type: 'list' },
  // Routes (Dashboard → Routes tab) now offer THIS list in the Dispatch Form picker —
  // the backing dispatch_type row is found-or-created by name when the route is saved.
  { key: 'despatch', label: 'Dispatch Forms — Sales SKUs', where: 'Sales Rep — SKUs · Routes', type: 'list' },
  { key: 'paytypes', label: 'Customer Payment Types', where: 'Sales Rep — Add Customer', type: 'pairs' },
  { key: 'statuses', label: 'Customer Statuses', where: 'Sales Rep · Sales Admin', type: 'list' },
  { key: 'designations', label: 'Contact Designations', where: 'Sales Rep — Contacts', type: 'list' },
  { key: 'visit_types', label: 'Log Visit — Activity Types', where: 'Sales Rep — Log Visit', type: 'list' },
  { key: 'ping_types', label: 'Next Ping Types', where: 'Sales Rep — Log Visit', type: 'list' },
  { key: 'responsible', label: 'CSA Responsible Persons', where: 'QC — CSA report', type: 'list' },
  { key: 'substrates', label: 'CSA Substrates', where: 'QC · PM · Quote', type: 'substrate', store: 'substrate_options' },
];

export const DD_DEFAULTS = {
  categories: REP_CATEGORIES,
  despatch: ['Roll', 'Label', 'Shrink Sleeve', 'Pouch', 'Bulk Bags', 'Others'],
  paytypes: REP_PAYTYPES,
  statuses: REP_STATUSES,
  designations: ['CEO', 'Managing Director', 'Senior Purchase Director', 'Purchase Manager', 'Purchase Executive', 'Others'],
  visit_types: ['Call', 'Visit', 'Email', 'Meeting', 'Sample Given', 'Quotation', 'Other'],
  ping_types: ['Visit', 'Call', 'Mail', 'WhatsApp', 'Meeting', 'Other'],
  responsible: QC_RESPONSIBLE,
  substrates: SUBSTRATE_DEFAULTS,
};

/** Where a list lives in the blob. Substrates have their own top-level key. */
export function ddStoreKey(key) {
  const def = DROPDOWN_DEFS.find((d) => d.key === key);
  return def && def.store ? def.store : null;
}

/**
 * The effective list for a key: the stored override when it has entries,
 * otherwise the built-in default. (ddStored / ddCurrent)
 */
export function ddList(sales, key) {
  const store = ddStoreKey(key);
  const stored = store ? arr(sales && sales[store]) : arr(sales && sales.dropdowns && sales.dropdowns[key]);
  if (stored.length) return stored;
  return DD_DEFAULTS[key] || [];
}

/** Payment types normalised to [value, label] pairs, however they were stored. */
export function ddPairs(sales, key = 'paytypes') {
  return ddList(sales, key).map((p) => (Array.isArray(p) ? p : [p, p]));
}

/**
 * Save one list back. Returns the patch to merge into the sales blob.
 * An empty list is stored as empty — that is a deliberate "clear the override
 * and fall back to defaults", which `ddList` handles.
 */
export function ddPatch(sales, key, values) {
  const store = ddStoreKey(key);
  if (store) return { [store]: arr(values) };
  return { dropdowns: { ...((sales && sales.dropdowns) || {}), [key]: arr(values) } };
}

/** True when a key currently has a stored override (rather than the default). */
export function ddIsOverridden(sales, key) {
  const store = ddStoreKey(key);
  const stored = store ? arr(sales && sales[store]) : arr(sales && sales.dropdowns && sales.dropdowns[key]);
  return stored.length > 0;
}
