// Customer KAM & Targets — key account manager, order frequency and monthly
// target, per customer.
//
// These three fields live on the customer's LEAD record in the sales blob
// (`kam`, `order_frequency`, `monthly_target`), the same place the sales team's
// per-category assignments live. A customer with no lead yet gets one created on
// first save, so a Customer-Master-only customer can still be managed here.
//
// "Achieved" is read live from the OAB board rather than stored, so a sale order
// entered by ops closes the gap without anyone re-keying it.
//
// Ported from kam* (index.html ~5850).

import { salesUid } from './sales.js';

const s = (v) => String(v == null ? '' : v).trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** YYYY-MM for `back` months before the current month. (kamMonthKeyBack) */
export function monthKeyBack(back = 0, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/** The lead record backing a customer, if any. (kamLeadFor) */
export function kamLeadFor(leads, customer) {
  const target = s(customer);
  return arr(leads).find((l) => s(l.client_name) === target) || null;
}

/**
 * This month's achieved order quantity, plus reference figures from the previous
 * three months: a suggested monthly target (their recent average) and a
 * suggested order frequency in days. Both are hints, not stored values.
 * (kamCustomerStats)
 */
export function kamCustomerStats(oab, customer, now = new Date()) {
  const rows = ['SF', 'OT']
    .flatMap((k) => arr(oab && oab[k]))
    .filter((r) => r && s(r.customer) === s(customer) && r.poDate);

  const curKey = monthKeyBack(0, now);
  const prevKeys = [1, 2, 3].map((i) => monthKeyBack(i, now));

  const prevRows = rows.filter((r) => prevKeys.includes(String(r.poDate).slice(0, 7)));
  const curRows = rows.filter((r) => String(r.poDate).slice(0, 7) === curKey);

  const prevQty = prevRows.reduce((sum, r) => sum + n(r.poQty), 0);
  return {
    achieved: curRows.reduce((sum, r) => sum + n(r.poQty), 0),
    suggestedTarget: prevQty / 3,
    // 90 days spread over however many orders they actually placed.
    suggestedFreqDays: prevRows.length > 0 ? Math.round(90 / prevRows.length) : 0,
  };
}

/**
 * The customer's primary sales contact. Prefers the flagged-primary one, then
 * any contact on file. Contacts may carry `customer` directly or hang off a
 * lead, so both are matched. (kamPrimaryContact)
 */
export function kamPrimaryContact(sales, customer) {
  const target = s(customer);
  const contacts = arr(sales && sales.contacts).filter((c) => {
    if (s(c.customer) === target) return true;
    const l = arr(sales && sales.leads).find((x) => x.id === c.lead_id);
    return !!(l && s(l.client_name) === target);
  });
  if (!contacts.length) return null;
  return contacts.find((c) => c.is_primary || String(c.priority) === '1') || contacts[0];
}

/** Stored KAM / frequency / target for a customer, or null when unset. */
export function kamStored(leads, customer) {
  const l = kamLeadFor(leads, customer);
  if (!l) return { kam: '', freq: null, target: null };
  return {
    kam: l.kam || '',
    freq: (l.order_frequency != null && l.order_frequency !== '') ? Number(l.order_frequency) : null,
    target: (l.monthly_target != null && l.monthly_target !== '') ? Number(l.monthly_target) : null,
  };
}

/**
 * Apply staged KAM edits. Returns a NEW leads array.
 * `edits` is { [customer]: { kam?, order_frequency?, monthly_target? } }.
 * A customer with no lead gets a minimal one created, so the fields have
 * somewhere to live — matching how Sadmin → Manage saves categories.
 */
export function kamApplyEdits(leads, edits, { uid = salesUid } = {}) {
  let out = arr(leads).slice();
  Object.entries(edits || {}).forEach(([customer, fields]) => {
    const i = out.findIndex((l) => s(l.client_name) === s(customer));
    if (i >= 0) {
      out[i] = { ...out[i], ...fields };
    } else {
      out = [...out, {
        id: uid('lead'),
        client_name: customer,
        categories: [],
        category_assignments: {},
        stage: 'To Approach',
        created_by: 'sadmin',
        created_at: new Date().toISOString(),
        ...fields,
      }];
    }
  });
  return out;
}

/**
 * The KAM table: every active customer from the Customer Master, joined with
 * their lead fields, primary contact and live achievement.
 */
export function kamRows({ customers, sales, oab }, now = new Date()) {
  const leads = arr(sales && sales.leads);

  // The Customer Master holds one row per customer × DISPATCH LOCATION, so a
  // large account appears many times over (RELIANCE has 27 rows in production).
  // A KAM, an order frequency and a target belong to the CUSTOMER, not to a
  // delivery point — so collapse to one row per name. Keeping the duplicates
  // would also give two rows the same React key, and an edit could land on the
  // wrong one. The row carrying a group wins, since it is the fuller record.
  const byName = new Map();
  arr(customers)
    .filter((c) => c && s(c.customer) && c.active !== false)
    .forEach((c) => {
      const key = s(c.customer);
      const seen = byName.get(key);
      if (!seen || (!s(seen.group) && s(c.group))) byName.set(key, c);
    });

  return [...byName.values()]
    .map((c) => {
      const name = s(c.customer);
      const stored = kamStored(leads, name);
      const stats = kamCustomerStats(oab, name, now);
      const contact = kamPrimaryContact(sales, name);
      return {
        customer: name,
        group: c.group || '',
        // Contact details fall back per-field to the Customer Master, since one
        // side may hold the name and the other the phone.
        contactName: (contact && contact.name) || c.contactPerson || '',
        contactPhone: (contact && contact.phone) || c.contactPhone || '',
        kam: stored.kam,
        freq: stored.freq,
        target: stored.target,
        achieved: stats.achieved,
        suggestedTarget: stats.suggestedTarget,
        suggestedFreqDays: stats.suggestedFreqDays,
        gap: stored.target != null ? stored.target - stats.achieved : null,
      };
    })
    .sort((a, b) => a.customer.localeCompare(b.customer));
}
