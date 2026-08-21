// Customer Master lookups (module 4). `customers` is the mods.customers array.

export function getCustLocations(customers, customer) {
  return (customers || []).filter((r) => r.customer === customer);
}

export function getCustByLoc(customers, customer, dispatchLoc) {
  return (customers || []).find((r) => r.customer === customer && r.dispatchLoc === dispatchLoc) || null;
}

/** Distinct customer names present in the JSS spec master (New PO dropdown). */
export function jssCustomers(jss) {
  return [...new Set((jss || []).map((j) => j.customer))].filter(Boolean).sort();
}

/** Loose name match — case/space/punctuation insensitive. (_normName 5820) */
function normName(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The buying group a customer belongs to, from the Customer Master.
 * Falls back to the customer's own name when no group is recorded, so grouping
 * never silently drops an order. (custGroupOf 5824)
 */
export function custGroupOf(customer, customers) {
  if (!customer) return '';
  const target = normName(customer);
  let g = '';
  (customers || []).forEach((c) => {
    if (c && !g && normName(c.customer) === target && String(c.group || '').trim()) {
      g = String(c.group).trim();
    }
  });
  return g || String(customer).trim();
}

/** Distinct group names in the Customer Master, sorted. (_custGroups 5832) */
export function custGroups(customers) {
  const s = new Set();
  (customers || []).forEach((c) => { const g = String((c && c.group) || '').trim(); if (g) s.add(g); });
  return [...s].sort();
}

/** Customers in a buying group; with no group, the customers that have none. (_custsInGroup) */
export function custsInGroup(customers, group) {
  const g = String(group || '').trim();
  const out = new Set();
  (customers || []).forEach((c) => {
    if (!c || !c.customer) return;
    const cg = String(c.group || '').trim();
    if (g ? cg === g : !cg) out.add(String(c.customer).trim());
  });
  return [...out].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/**
 * The buying group a SPEC belongs to: its own `group`, else the group its customer
 * belongs to (only when that resolves to a real group rather than echoing the
 * customer's own name). (specGroup)
 */
export function specGroup(j, customers) {
  const g = String((j && j.group) || '').trim();
  if (g) return g;
  const raw = String((j && j.customer) || '');
  const d = custGroupOf(raw, customers);
  return (d && normName(d) !== normName(raw)) ? d : '';
}

/**
 * Whether a spec may be ordered for a customer. Matching ignores case, spacing and
 * punctuation. (specVisibleTo)
 *
 *  • Spec has a GROUP → the customer must be in that group, and then:
 *      – spec names a Company → visible ONLY to that company
 *      – spec names no Company → shared with every customer in the group
 *  • Spec has NO group:
 *      – names a Company → visible only to that company
 *      – names none → a generic SKU, available to any customer
 */
export function specVisibleTo(j, cu, customers) {
  if (!cu) return false;
  const specG = specGroup(j, customers);
  const cust = String((j && j.customer) || '').trim();
  if (specG) {
    if (normName(custGroupOf(cu, customers)) !== normName(specG)) return false;
    return !cust || normName(cust) === normName(cu);
  }
  if (cust) return normName(cust) === normName(cu);
  return true;
}
