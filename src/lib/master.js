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
