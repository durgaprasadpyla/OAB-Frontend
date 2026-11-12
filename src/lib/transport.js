// Transport 06.11 — who bears the freight on an invoice, and the report built on it.
//
// "I need to have a separate report for how much of the transportation cost is borne by
// Bloomflex and how much is borne by a particular client."
//
// The customer master says who normally bears transport; the invoice page starts from
// that and records the choice on the invoice (`header.freightBorneBy`). The report reads
// the invoice register, so it needs nothing kept beside it. An invoice from before this
// has no such field — its freight was added to the customer's bill, so it is theirs.

import { num } from './calc.js';

export const TRANSPORT_PARTIES = ['Customer', 'Bloomflex'];

const key = (v) => String(v || '').trim().toLowerCase();

export const isBloomflex = (who) => key(who) === 'bloomflex';

/** Who bears the freight of an invoice. */
export const borneByOf = (inv) => (isBloomflex(inv && inv.header && inv.header.freightBorneBy) ? 'Bloomflex' : 'Customer');

/**
 * Who a customer's transport is borne by, per the Customer Master. A customer has one
 * row per dispatch location; the first row that says wins.
 */
export function customerTransport(customers, customer) {
  const row = (Array.isArray(customers) ? customers : [])
    .find((c) => c && key(c.customer) === key(customer) && String(c.transportBorneBy || '').trim());
  return row ? String(row.transportBorneBy).trim() : '';
}

/** The register as report rows, newest first. `from` / `to` are YYYY-MM-DD, inclusive. */
export function transportRows(oab, { from = '', to = '' } = {}) {
  return ((oab && oab.INV_REG) || [])
    .filter((inv) => inv && (!from || String(inv.date || '') >= from) && (!to || String(inv.date || '') <= to))
    .map((inv) => ({
      no: inv.no || '', date: inv.date || '', customer: inv.customer || '', po: inv.po || '',
      transporter: (inv.header && inv.header.transporter) || '',
      invoiceValue: num(inv.amount),
      freight: num(inv.header && inv.header.freight),
      borneBy: borneByOf(inv),
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** Totals over report rows: freight split by who bears it, and the invoice value it sits on. */
export function transportTotals(rows) {
  return (rows || []).reduce((t, r) => ({
    invoices: t.invoices + 1,
    invoiceValue: t.invoiceValue + r.invoiceValue,
    freight: t.freight + r.freight,
    bloomflex: t.bloomflex + (r.borneBy === 'Bloomflex' ? r.freight : 0),
    customer: t.customer + (r.borneBy === 'Customer' ? r.freight : 0),
  }), { invoices: 0, invoiceValue: 0, freight: 0, bloomflex: 0, customer: 0 });
}

/**
 * Issues 11.11: "for Amazon we spent so much over the months and for VSA the customer has
 * spent so much over the months." Freight month by month for each customer — or each
 * buying group, with `keyOf` — as `{ months: ['2026-10', …], rows: [{ name, byMonth,
 * total }] }`. `measure` is 'freight' (all of it), 'bloomflex' or 'customer'.
 */
export function transportByMonth(rows, { keyOf = (r) => r.customer || '—', measure = 'freight' } = {}) {
  const months = [...new Set((rows || []).map((r) => String(r.date || '').slice(0, 7)).filter(Boolean))].sort();
  const pick = (r) => (measure === 'bloomflex' ? (r.borneBy === 'Bloomflex' ? r.freight : 0)
    : measure === 'customer' ? (r.borneBy === 'Customer' ? r.freight : 0) : r.freight);
  const by = new Map();
  (rows || []).forEach((r) => {
    const v = pick(r);
    if (!(v > 0)) return;
    const name = keyOf(r) || '—';
    if (!by.has(name)) by.set(name, { name, byMonth: {}, total: 0 });
    const e = by.get(name);
    const m = String(r.date || '').slice(0, 7);
    e.byMonth[m] = (e.byMonth[m] || 0) + v;
    e.total += v;
  });
  return { months, rows: [...by.values()].sort((a, b) => b.total - a.total) };
}

/** One line per customer, largest freight first; customers with no freight are left out. */
export function transportByCustomer(rows) {
  const groups = new Map();
  (rows || []).forEach((r) => {
    const name = r.customer || '—';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(r);
  });
  return [...groups.entries()]
    .map(([name, list]) => {
      const { customer: borneByCustomer, ...totals } = transportTotals(list);
      return { customer: name, borneByCustomer, ...totals };
    })
    .filter((c) => c.freight > 0)
    .sort((a, b) => b.freight - a.freight);
}
