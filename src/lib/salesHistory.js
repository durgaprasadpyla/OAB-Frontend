// Sales History analytics (Issues 6 §18-§37) — pure functions over the sale lines
// the server returns (GET /api/sales-history/lines) plus the modules the Super
// Admin already holds in memory (JSS, Customer Master, Price Master, sales leads).
//
// Everything here is deterministic and takes `today` as an argument, so the
// same-day month-on-month comparison ("12 September against 1–12 August") is
// testable and never depends on the wall clock inside the function.
import { getPM } from './pricing.js';
import { custGroupOf, custGroups } from './master.js';
import { kamLeadFor } from './kam.js';
import { repName } from './sales.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const norm = (v) => String(v || '').trim().toLowerCase();
const pad2 = (x) => String(x).padStart(2, '0');

export const GST_PCT = 18;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09" for a Date. */
export function periodOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
/** "Sep 2026" for "2026-09". */
export function periodLabel(p) {
  const [y, m] = String(p || '').split('-');
  const mi = Number(m) - 1;
  return MONTHS[mi] ? MONTHS[mi] + ' ' + y : String(p || '');
}
/** The period `back` months before `p` ("2026-09", 1 → "2026-08"). */
export function periodBack(p, back) {
  const [y, m] = String(p).split('-').map(Number);
  const d = new Date(y, m - 1 - back, 1);
  return periodOf(d);
}
/** Days in a month. */
export function daysIn(p) {
  const [y, m] = String(p).split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Stay Fresh or not, from the JSS job type as the OAB decides its sheet (jobType === 'StayFresh' → SF). */
export function segmentOf(jobType) {
  const t = norm(jobType).replace(/[^a-z]/g, '');
  if (!t) return 'unknown';
  return t === 'stayfresh' ? 'stayfresh' : 'domestic';
}

/**
 * One sale line, enriched with what the report needs: segment (Stayfresh /
 * domestic), buying group, the Price Master cost and the margin it gives.
 *
 * The cost is the Price Master's `costPrice` for the spec — "the gross cost that I
 * have added in the price master" — read from the module the Super Admin edits,
 * with the server's mirror of the same table standing in when the module is not
 * loaded. A spec with no cost gets NO margin (null), never a zero one.
 */
export function enrichLine(line, ctx = {}) {
  const { jss = [], customers = [], prices = {} } = ctx;
  const spec = String(line.spec || '').trim();
  const j = spec ? (jss.find((x) => norm(x.spec) === norm(spec)) || null) : null;
  const jobType = line.jobType || (j && j.jobType) || '';
  const customer = String(line.customer || (j && j.customer) || '').trim();
  const groups = custGroups(customers);
  // a sheet row may name the GROUP instead of a customer
  const isGroupName = !!customer && groups.some((g) => norm(g) === norm(customer));
  const group = isGroupName ? customer : custGroupOf(customer, customers);
  const pm = getPM(spec, prices);
  const cost = n(pm.costPrice) > 0 ? n(pm.costPrice) : (n(line.costPrice) > 0 ? n(line.costPrice) : 0);
  const qty = n(line.qty);
  const amount = n(line.amount);
  const rate = n(line.rate) || (qty > 0 ? amount / qty : 0);
  const hasCost = cost > 0;
  return {
    ...line,
    spec,
    customer,
    group,
    isGroupName,
    jobName: line.jobName || (j && j.jobName) || '',
    segment: segmentOf(jobType),
    qty,
    rate,
    amount,
    amountInclGst: n(line.amountInclGst) || amount * (1 + GST_PCT / 100),
    cost,
    hasCost,
    margin: hasCost ? (rate - cost) * qty : null,
  };
}

export function enrichAll(lines, ctx) { return (lines || []).map((l) => enrichLine(l, ctx)); }

/** The lines that pass the Specification / Group / Customer filters. */
export function applyFilters(lines, { spec = '', group = '', customer = '' } = {}) {
  return (lines || []).filter((l) => (
    (!spec || norm(l.spec) === norm(spec))
    && (!group || norm(l.group) === norm(group))
    && (!customer || norm(l.customer) === norm(customer))
  ));
}

/** Sale, GST-inclusive sale, quantity, margin and the specs without a cost, for a set of lines. */
export function totals(lines) {
  const t = { sale: 0, inclGst: 0, qty: 0, margin: 0, costedSale: 0, lines: 0, missingSpecs: new Set(), invoices: new Set() };
  (lines || []).forEach((l) => {
    t.sale += l.amount; t.inclGst += l.amountInclGst; t.qty += l.qty; t.lines++;
    if (l.invNo) t.invoices.add(l.invNo);
    if (l.hasCost) { t.margin += l.margin; t.costedSale += l.amount; } else if (l.spec) t.missingSpecs.add(l.spec);
  });
  return {
    sale: t.sale, inclGst: t.inclGst, qty: t.qty, margin: t.margin, lines: t.lines,
    invoices: t.invoices.size,
    // margin % on the sale that HAS a cost — the uncosted part is reported, not guessed
    marginPct: t.costedSale > 0 ? (t.margin / t.costedSale) * 100 : null,
    costedSale: t.costedSale,
    missingSpecs: [...t.missingSpecs].sort(),
  };
}

/** Stayfresh / domestic / all, each with totals(). */
export function bySegment(lines) {
  return {
    stayfresh: totals((lines || []).filter((l) => l.segment === 'stayfresh')),
    domestic: totals((lines || []).filter((l) => l.segment !== 'stayfresh')),
    unknown: (lines || []).filter((l) => l.segment === 'unknown').length,
    all: totals(lines),
  };
}

/** ▲/▼ change between two figures: absolute and percentage (null when there is no base). */
export function change(now, before) {
  const a = n(now), b = n(before);
  return { now: a, before: b, delta: a - b, pct: b !== 0 ? ((a - b) / Math.abs(b)) * 100 : (a !== 0 ? null : 0) };
}

/**
 * §22 — the same-day month-on-month comparison. For the current month, "1–12
 * September against 1–12 August"; for a past month, the whole month against the
 * whole month before it. A month that came from an uploaded sheet has no day
 * detail (every line is dated the 1st), so it is compared as a whole month and
 * the result says so.
 */
export function sameDayComparison(lines, period, today, periodSources = {}) {
  const cur = periodOf(today);
  const prev = periodBack(period, 1);
  const isCurrent = period === cur;
  const day = isCurrent ? today.getDate() : daysIn(period);
  const cutoff = (p, d) => p + '-' + pad2(Math.min(d, daysIn(p)));
  const srcNow = periodSources[period] || 'invoice';
  const srcPrev = periodSources[prev] || 'invoice';
  const wholeMonths = !isCurrent || srcNow === 'upload' || srcPrev === 'upload';
  const upTo = (p) => (lines || []).filter((l) => l.period === p && (wholeMonths || !l.date || l.date <= cutoff(p, day)));
  const nowLines = upTo(period);
  const prevLines = upTo(prev);
  const segNow = bySegment(nowLines);
  const segPrev = bySegment(prevLines);
  return {
    period, prev, day, wholeMonths, isCurrent,
    label: wholeMonths
      ? `${periodLabel(period)} against ${periodLabel(prev)}`
      : `1–${day} ${periodLabel(period)} against 1–${Math.min(day, daysIn(prev))} ${periodLabel(prev)}`,
    note: wholeMonths && isCurrent ? 'The previous month came from an uploaded sheet, which carries no day-by-day detail, so whole months are compared.' : '',
    total: change(segNow.all.sale, segPrev.all.sale),
    stayfresh: change(segNow.stayfresh.sale, segPrev.stayfresh.sale),
    domestic: change(segNow.domestic.sale, segPrev.domestic.sale),
    margin: change(segNow.all.margin, segPrev.all.margin),
    qty: change(segNow.all.qty, segPrev.all.qty),
  };
}

/** Month-by-month series for the last `months` periods ending at `period` (oldest first). */
export function monthSeries(lines, period, months = 24, periodSources = {}) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const p = periodBack(period, i);
    const seg = bySegment((lines || []).filter((l) => l.period === p));
    const ly = totals((lines || []).filter((l) => l.period === periodBack(p, 12))).sale;
    out.push({
      period: p, label: periodLabel(p), source: periodSources[p] || 'invoice',
      sale: seg.all.sale, inclGst: seg.all.inclGst, qty: seg.all.qty,
      margin: seg.all.margin, marginPct: seg.all.marginPct,
      stayfresh: seg.stayfresh.sale, domestic: seg.domestic.sale,
      // §24: the same month last year, beside every month
      lastYear: ly, yoyPct: ly !== 0 ? ((seg.all.sale - ly) / Math.abs(ly)) * 100 : (seg.all.sale !== 0 ? null : 0),
    });
  }
  return out;
}

/** The three whole months before `period` against the three before those (§26 "last quarter"). */
export function quarterComparison(lines, period) {
  const sum = (ps) => ps.reduce((s, p) => s + totals((lines || []).filter((l) => l.period === p)).sale, 0);
  const last = [3, 2, 1].map((b) => periodBack(period, b));
  const before = [6, 5, 4].map((b) => periodBack(period, b));
  return { last, before, label: `${periodLabel(last[0])}–${periodLabel(last[2])} against ${periodLabel(before[0])}–${periodLabel(before[2])}`, ...change(sum(last), sum(before)) };
}

/** This month against the same month last year (§24 "August last year vs August this year"). */
export function yearOnYear(lines, period) {
  const ly = periodBack(period, 12);
  const now = totals((lines || []).filter((l) => l.period === period)).sale;
  const before = totals((lines || []).filter((l) => l.period === ly)).sale;
  return { period, lastYear: ly, label: `${periodLabel(period)} against ${periodLabel(ly)}`, ...change(now, before) };
}

/**
 * Per-entity table for a month against the month before: customer, group or spec.
 * `key` picks the grouping field. Sorted by this month's sale, largest first,
 * with the entities that fell marked so a decline is impossible to miss (§30).
 */
export function breakdown(lines, period, key = 'customer', ctx = {}) {
  const prev = periodBack(period, 1);
  const map = new Map();
  (lines || []).forEach((l) => {
    if (l.period !== period && l.period !== prev) return;
    const k = String(l[key] || (key === 'spec' ? '(no spec)' : '(unnamed)')).trim() || '(unnamed)';
    if (!map.has(k)) map.set(k, { key: k, now: [], before: [], jobName: l.jobName, customer: l.customer, group: l.group, segment: l.segment });
    map.get(k)[l.period === period ? 'now' : 'before'].push(l);
  });
  return [...map.values()].map((e) => {
    const tn = totals(e.now), tb = totals(e.before);
    // §27: the margin month by month for this customer / group / SKU, not just two months
    const marginTrend = [5, 4, 3, 2, 1, 0].map((b) => {
      const p = periodBack(period, b);
      const t = totals((lines || []).filter((l) => l.period === p && String(l[key] || '').trim() === e.key));
      return { period: p, label: periodLabel(p), marginPct: t.marginPct, margin: t.margin, sale: t.sale };
    });
    const rep = key === 'spec' ? repFor(e.customer, ctx) : (key === 'group' ? repsForGroup(e.key, ctx) : repFor(e.key, ctx));
    return {
      key: e.key, jobName: e.jobName, customer: e.customer, group: e.group, segment: e.segment,
      sale: tn.sale, inclGst: tn.inclGst, qty: tn.qty, margin: tn.margin, marginPct: tn.marginPct, missing: tn.missingSpecs.length,
      before: tb.sale, ...change(tn.sale, tb.sale),
      marginBefore: tb.margin, marginPctBefore: tb.marginPct,
      declined: tb.sale > 0 && tn.sale < tb.sale,
      rep,
      marginTrend,
    };
  }).sort((a, b) => b.sale - a.sale || b.before - a.before);
}

/**
 * §24-§25 — every SKU / spec in the filtered lines, month by month for the last
 * `months` periods ending at `period`: the per-SKU history under a customer (or
 * everything, with no filter). Rows are the specs, columns the months, cells the
 * base sale; sorted by the total over the window, largest first.
 */
export function skuMonthPivot(lines, period, months = 12) {
  const cols = [];
  for (let i = months - 1; i >= 0; i--) cols.push(periodBack(period, i));
  const inWindow = new Set(cols);
  const map = new Map();
  (lines || []).forEach((l) => {
    if (!inWindow.has(l.period)) return;
    const k = l.spec || '(no spec)';
    if (!map.has(k)) map.set(k, { spec: k, jobName: l.jobName || '', customer: l.customer, segment: l.segment, cells: {}, qty: {}, total: 0, totalQty: 0 });
    const r = map.get(k);
    r.cells[l.period] = (r.cells[l.period] || 0) + l.amount;
    r.qty[l.period] = (r.qty[l.period] || 0) + l.qty;
    r.total += l.amount; r.totalQty += l.qty;
    if (!r.jobName && l.jobName) r.jobName = l.jobName;
  });
  const rows = [...map.values()].map((r) => {
    const now = r.cells[period] || 0, prev = r.cells[periodBack(period, 1)] || 0;
    return { ...r, ...change(now, prev), declined: prev > 0 && now < prev };
  }).sort((a, b) => b.total - a.total);
  const colTotals = cols.map((p) => rows.reduce((s, r) => s + (r.cells[p] || 0), 0));
  return { months: cols, labels: cols.map(periodLabel), rows, colTotals };
}

/** §29 — the sales representative / KAM on file for a customer, from the leads and sales users. */
export function repFor(customer, ctx = {}) {
  const sales = ctx.sales || {};
  const lead = kamLeadFor(sales.leads, customer);
  if (!lead) return { kam: '', rep: '', found: false };
  // Issues 7 §23: a rep is named only when the id on the lead is a KNOWN sales user —
  // an id nobody answers to ("rep_1786510490948_qdjdgo") reads as nobody, not as the
  // id. The KAM field holds a rep id too (Customer KAM & Targets), so it resolves the
  // same way; a KAM typed as a plain name from before still reads as that name.
  const known = (id) => { const n = repName(sales.sales_users, id); return n === '—' || n === String(id) ? '' : n; };
  const rep = lead.assigned_to ? known(lead.assigned_to) : '';
  const rawKam = String(lead.kam || '').trim();
  const kam = rawKam ? (known(rawKam) || (/^rep_/i.test(rawKam) ? '' : rawKam)) : '';
  return { kam, rep, found: true };
}

/** The reps / KAMs of every customer in a group, de-duplicated. */
export function repsForGroup(group, ctx = {}) {
  const customers = ctx.customers || [];
  const names = [...new Set(customers.filter((c) => norm(c.group) === norm(group)).map((c) => String(c.customer || '').trim()).filter(Boolean))];
  const reps = names.map((c) => ({ customer: c, ...repFor(c, ctx) })).filter((r) => r.found && (r.kam || r.rep));
  return {
    found: reps.length > 0,
    kam: [...new Set(reps.map((r) => r.kam).filter(Boolean))].join(', '),
    rep: [...new Set(reps.map((r) => r.rep).filter(Boolean))].join(', '),
    perCustomer: reps,
  };
}

/** Distinct filter options from the lines (plus the master lists, so a filter can be picked before any sale). */
export function filterOptions(lines, ctx = {}) {
  const specs = new Set(), groups = new Set(), customers = new Set();
  (lines || []).forEach((l) => { if (l.spec) specs.add(l.spec); if (l.customer) customers.add(l.customer); });
  // Issues 7 §22: the Group list is the CUSTOMER MASTER's groups — the ones currently in
  // use — not every group name an old invoice ever carried ("AMAZON INDIA PVT.LTD.",
  // "Amazon Retail India Private Limited - Maharashtra" …).
  custGroups(ctx.customers || []).forEach((g) => groups.add(g));
  (ctx.customers || []).forEach((c) => { const v = String((c && c.customer) || '').trim(); if (v) customers.add(v); });
  const sortNum = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  return { specs: [...specs].sort(sortNum), groups: [...groups].sort(sortNum), customers: [...customers].sort(sortNum) };
}

/* ─────────────────────── the uploaded sheet (§31-§34) ─────────────────────── */

const HEADS = {
  customer: ['customer', 'customername', 'customerorgroup', 'group', 'groupname', 'party', 'partyname', 'client', 'buyer', 'account'],
  spec: ['spec', 'specno', 'specnumber', 'specification', 'specificationno', 'specificationnumber', 'sku', 'jss', 'jssno', 'code', 'itemcode'],
  qty: ['qty', 'quantity', 'pcs', 'pieces', 'nos', 'pouches', 'qtypcs', 'quantitypcs'],
  amount: ['totalsale', 'sale', 'sales', 'amount', 'total', 'value', 'salevalue', 'basic', 'basicvalue', 'taxable', 'taxablevalue', 'netsale', 'totalamount'],
  incl: ['inclgst', 'includinggst', 'withgst', 'gross', 'grossvalue', 'totalinclgst', 'invoicevalue', 'totalwithgst', 'saleinclgst'],
};
const squash = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Turn a sheet (array of arrays, as readSheetAOA returns) into upload lines.
 * The header row is found by its names — Customer / Group, Spec, Quantity, Total
 * sale, optional GST-inclusive total — wherever it sits, and rows are read
 * positionally under it. Returns the lines and what could not be read, so the
 * screen shows both before anything is sent.
 */
export function parseSalesSheet(aoa) {
  const rows = Array.isArray(aoa) ? aoa : [];
  let headerAt = -1, cols = null;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = (rows[i] || []).map(squash);
    const find = (names) => cells.findIndex((c) => c && names.includes(c));
    const c = { customer: find(HEADS.customer), spec: find(HEADS.spec), qty: find(HEADS.qty), amount: find(HEADS.amount), incl: find(HEADS.incl) };
    // the GST-inclusive column must not be mistaken for the base sale
    if (c.incl >= 0 && c.amount === c.incl) c.amount = cells.findIndex((x, k) => k !== c.incl && HEADS.amount.includes(x));
    if ((c.customer >= 0 || c.spec >= 0) && c.amount >= 0) { headerAt = i; cols = c; break; }
  }
  if (headerAt < 0) {
    return { lines: [], errors: ['No header row found — the sheet needs columns named Customer / Group, Spec, Quantity and Total sale.'], header: null };
  }
  const lines = [], errors = [];
  const num = (v) => {
    if (v == null || v === '') return null;
    const x = Number(String(v).replace(/[₹,\s]/g, ''));
    return Number.isFinite(x) ? x : null;
  };
  for (let i = headerAt + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const customer = cols.customer >= 0 ? String(r[cols.customer] == null ? '' : r[cols.customer]).trim() : '';
    const spec = cols.spec >= 0 ? String(r[cols.spec] == null ? '' : r[cols.spec]).trim() : '';
    const qty = cols.qty >= 0 ? num(r[cols.qty]) : null;
    const amount = num(r[cols.amount]);
    const incl = cols.incl >= 0 ? num(r[cols.incl]) : null;
    if (!customer && !spec && amount == null) continue;                    // blank line
    if (/^(total|grand total|sub ?total)$/i.test(customer) || /^(total|grand total)$/i.test(spec)) continue;
    if (amount == null) { errors.push(`Row ${i + 1}: no total sale for ${spec || customer}.`); continue; }
    if (!customer && !spec) { errors.push(`Row ${i + 1}: neither a customer / group nor a spec.`); continue; }
    lines.push({ customer, spec, qty: qty == null ? 0 : qty, amount, amountInclGst: incl == null ? undefined : incl });
  }
  return { lines, errors, header: cols, headerRow: headerAt + 1 };
}

/* ───────────────────────────── exports (§35-§36) ───────────────────────────── */

/** The rows of the Excel / PDF for a month: one per sale line, with the summary on top. */
export function exportRows(lines, period, seg) {
  const head = ['Invoice', 'Date', 'Customer', 'Group', 'Spec', 'SKU / Job name', 'Segment', 'Qty', 'Rate', 'Sale (base)', 'GST 18%', 'Sale incl. GST', 'Cost (PM)', 'Margin', 'Source'];
  const body = (lines || []).filter((l) => l.period === period)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.customer).localeCompare(String(b.customer)))
    .map((l) => [
      l.invNo || '', l.date || '', l.customer, l.group, l.spec, l.jobName || '',
      l.segment === 'stayfresh' ? 'Stayfresh' : (l.segment === 'unknown' ? 'Unclassified' : 'Domestic'),
      l.qty, round2(l.rate), round2(l.amount), round2(l.amountInclGst - l.amount), round2(l.amountInclGst),
      l.hasCost ? round2(l.cost) : '', l.hasCost ? round2(l.margin) : '', l.source === 'upload' ? 'Uploaded sheet' : 'Invoice',
    ]);
  const summary = [
    ['Sales History', periodLabel(period)],
    ['Stayfresh sale', round2(seg.stayfresh.sale), 'Stayfresh margin', seg.stayfresh.marginPct == null ? '' : round2(seg.stayfresh.margin)],
    ['Domestic sale', round2(seg.domestic.sale), 'Domestic margin', seg.domestic.marginPct == null ? '' : round2(seg.domestic.margin)],
    ['Total sale', round2(seg.all.sale), 'Total incl. GST', round2(seg.all.inclGst)],
    ['Quantity', seg.all.qty, 'JSS without Price Master', seg.all.missingSpecs.length],
    [],
  ];
  return { head, body, summary };
}

export const round2 = (v) => Math.round(n(v) * 100) / 100;
