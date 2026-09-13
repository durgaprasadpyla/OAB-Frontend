import { describe, it, expect } from 'vitest';
import {
  enrichAll, applyFilters, bySegment, sameDayComparison, monthSeries, yearOnYear, quarterComparison,
  breakdown, repFor, repsForGroup, filterOptions, parseSalesSheet, exportRows, periodBack, periodLabel, segmentOf, skuMonthPivot,
} from '../lib/salesHistory.js';

// Sales History (Issues 6 §18-§37) — the arithmetic behind the tab, on a fixed
// "today" so the same-day comparison is checkable.

const TODAY = new Date(2026, 8, 12);      // 12 September 2026
const ctx = {
  jss: [
    { spec: 'A1', jobType: 'StayFresh', customer: 'AMAZON', jobName: 'Poly bag' },
    { spec: 'B2', jobType: 'Others', customer: 'TERRA', jobName: 'Coralife' },
    { spec: 'C3', jobType: 'Others', customer: 'KAY BEE', jobName: 'Okra' },
  ],
  customers: [
    { customer: 'AMAZON', group: 'AMAZON GROUP' },
    { customer: 'AMAZON SELLER', group: 'AMAZON GROUP' },
    { customer: 'TERRA', group: '' },
  ],
  prices: { A1: { price: 3, costPrice: 2 }, B2: { price: 5, costPrice: 4.5 } },   // C3 has no Price Master
  sales: {
    leads: [{ id: 'l1', client_name: 'AMAZON', kam: 'Ravi', assigned_to: 'u7' }],
    sales_users: [{ id: 'u7', display_name: 'Sita' }],
  },
};
const L = (period, date, customer, spec, qty, rate, extra = {}) => ({
  period, date, customer, spec, qty, rate, amount: qty * rate, amountInclGst: qty * rate * 1.18, source: 'invoice', invNo: 'INV/' + date, ...extra,
});
const raw = [
  // September (current): 1–12 Sep and one line after today (13th) that the same-day cut must exclude
  L('2026-09', '2026-09-03', 'AMAZON', 'A1', 1000, 3), L('2026-09', '2026-09-10', 'TERRA', 'B2', 200, 5),
  L('2026-09', '2026-09-11', 'KAY BEE', 'C3', 100, 2), L('2026-09', '2026-09-13', 'AMAZON', 'A1', 5000, 3),
  // August: early and late
  L('2026-08', '2026-08-05', 'AMAZON', 'A1', 2000, 3), L('2026-08', '2026-08-20', 'AMAZON', 'A1', 1000, 3), L('2026-08', '2026-08-08', 'TERRA', 'B2', 100, 5),
  // last year's September, and a quarter's worth of months
  L('2025-09', '2025-09-15', 'AMAZON', 'A1', 4000, 3),
  L('2026-07', '2026-07-15', 'AMAZON', 'A1', 1000, 3), L('2026-06', '2026-06-15', 'AMAZON', 'A1', 1000, 3),
  L('2026-05', '2026-05-15', 'AMAZON', 'A1', 500, 3), L('2026-04', '2026-04-15', 'AMAZON', 'A1', 500, 3), L('2026-03', '2026-03-15', 'AMAZON', 'A1', 500, 3),
];
const lines = enrichAll(raw, ctx);

describe('classifying a line', () => {
  it('reads Stayfresh from the JSS job type, the group from the Customer Master and the cost from the Price Master', () => {
    const a1 = lines[0];
    expect(a1.segment).toBe('stayfresh');
    expect(a1.group).toBe('AMAZON GROUP');
    expect(a1.cost).toBe(2);
    expect(a1.margin).toBe(1000);            // (3 − 2) × 1000
    expect(a1.hasCost).toBe(true);
    const c3 = lines[2];
    expect(c3.segment).toBe('domestic');
    expect(c3.hasCost).toBe(false);
    expect(c3.margin).toBeNull();             // never a zero-cost margin
    expect(lines[1].group).toBe('TERRA');     // no group → its own name
  });
  it('treats a sheet row that names the group as that group', () => {
    const [g] = enrichAll([{ period: '2026-08', customer: 'AMAZON GROUP', spec: 'A1', qty: 10, amount: 30, source: 'upload' }], ctx);
    expect(g.isGroupName).toBe(true);
    expect(g.group).toBe('AMAZON GROUP');
    expect(g.rate).toBe(3);
    expect(g.amountInclGst).toBeCloseTo(35.4);
  });
  it('knows the job types the OAB uses', () => {
    expect(segmentOf('StayFresh')).toBe('stayfresh');
    expect(segmentOf('Stay Fresh')).toBe('stayfresh');
    expect(segmentOf('Others')).toBe('domestic');
    expect(segmentOf('')).toBe('unknown');
  });
});

describe('the month figures', () => {
  it('splits Stayfresh from domestic, adds GST, and names the JSS without a Price Master', () => {
    const seg = bySegment(lines.filter((l) => l.period === '2026-09'));
    expect(seg.stayfresh.sale).toBe(18000);
    expect(seg.domestic.sale).toBe(1200);
    expect(seg.all.sale).toBe(19200);
    expect(seg.all.inclGst).toBeCloseTo(19200 * 1.18);
    expect(seg.all.missingSpecs).toEqual(['C3']);
    expect(seg.stayfresh.margin).toBe(6000);
    expect(seg.stayfresh.marginPct).toBeCloseTo(33.33, 1);
    expect(seg.domestic.margin).toBe(100);               // B2 only — C3 is left out, not zeroed
    expect(seg.domestic.marginPct).toBeCloseTo(10);
    expect(seg.all.invoices).toBe(4);
  });
  it('filters by spec, group and customer', () => {
    expect(applyFilters(lines, { group: 'AMAZON GROUP' }).every((l) => l.customer === 'AMAZON')).toBe(true);
    expect(applyFilters(lines, { spec: 'b2' }).length).toBe(2);
    expect(applyFilters(lines, { customer: 'TERRA', spec: 'A1' }).length).toBe(0);
    const o = filterOptions(lines, ctx);
    expect(o.groups).toContain('AMAZON GROUP');
    expect(o.customers).toContain('AMAZON SELLER');       // from the master, not only the sales
    expect(o.specs).toEqual(['A1', 'B2', 'C3']);
  });
});

describe('§22 the same-day comparison', () => {
  it('compares 1–12 September with 1–12 August, not with the whole of August', () => {
    const c = sameDayComparison(lines, '2026-09', TODAY);
    expect(c.wholeMonths).toBe(false);
    expect(c.label).toBe('1–12 Sep 2026 against 1–12 Aug 2026');
    expect(c.total.now).toBe(4200);          // the 13 Sep line is out
    expect(c.total.before).toBe(6500);       // 5 Aug + 8 Aug; 20 Aug is out
    expect(c.total.delta).toBe(-2300);
    expect(c.total.pct).toBeCloseTo(-35.38, 1);
    expect(c.stayfresh.before).toBe(6000);
    expect(c.domestic.now).toBe(1200);
  });
  it('compares whole months for a past month, and when the previous month is an uploaded sheet', () => {
    const past = sameDayComparison(lines, '2026-08', TODAY);
    expect(past.wholeMonths).toBe(true);
    expect(past.total.now).toBe(9500);
    expect(past.total.before).toBe(3000);
    const up = sameDayComparison(lines, '2026-09', TODAY, { '2026-08': 'upload' });
    expect(up.wholeMonths).toBe(true);
    expect(up.total.now).toBe(19200);
    expect(up.note).toMatch(/uploaded sheet/);
  });
});

describe('trends', () => {
  it('builds the month series oldest first with margins per month', () => {
    const s = monthSeries(lines, '2026-09', 3);
    expect(s.map((p) => p.period)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(s[2].sale).toBe(19200);
    expect(s[2].stayfresh).toBe(18000);
    expect(s[0].marginPct).toBeCloseTo(33.33, 1);
    expect(s[1].label).toBe('Aug 2026');
  });
  it('compares with the same month last year and the last quarter', () => {
    const y = yearOnYear(lines, '2026-09');
    expect(y.lastYear).toBe('2025-09');
    expect(y.now).toBe(19200);
    expect(y.before).toBe(12000);
    expect(y.pct).toBeCloseTo(60);
    const q = quarterComparison(lines, '2026-09');
    expect(q.last).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(q.now).toBe(3000 + 3000 + 9500);
    expect(q.before).toBe(1500 * 3);
  });
});

describe('§24 / §29 / §30 per customer, with the rep and the declines marked', () => {
  it('lists customers this month against last month and names the KAM / rep', () => {
    const rows = breakdown(lines, '2026-09', 'customer', ctx);
    const amazon = rows.find((r) => r.key === 'AMAZON');
    expect(amazon.sale).toBe(18000);
    expect(amazon.before).toBe(9000);
    expect(amazon.pct).toBe(100);
    expect(amazon.declined).toBe(false);
    expect(amazon.rep).toEqual({ kam: 'Ravi', rep: 'Sita', found: true });
    expect(amazon.marginPct).toBeCloseTo(33.33, 1);
    const kb = rows.find((r) => r.key === 'KAY BEE');
    expect(kb.marginPct).toBeNull();
    expect(kb.rep.found).toBe(false);
  });
  it('marks a customer that fell, and groups roll their customers up', () => {
    const rows = breakdown(lines, '2026-08', 'customer', ctx);
    const terra = rows.find((r) => r.key === 'TERRA');
    expect(terra.declined).toBe(false);       // July had no TERRA sale — nothing to fall from
    const sep = breakdown(lines.filter((l) => l.date <= '2026-09-12'), '2026-09', 'customer', ctx).find((r) => r.key === 'AMAZON');
    expect(sep.declined).toBe(true);           // 3,000 against 9,000
    const groups = breakdown(lines, '2026-09', 'group', ctx);
    expect(groups.find((g) => g.key === 'AMAZON GROUP').rep.kam).toBe('Ravi');
    expect(repsForGroup('AMAZON GROUP', ctx).perCustomer.map((r) => r.customer)).toEqual(['AMAZON']);
    expect(repFor('NOBODY', ctx).found).toBe(false);
    const skus = breakdown(lines, '2026-09', 'spec', ctx);
    expect(skus[0].key).toBe('A1');
    expect(skus[0].jobName).toBe('Poly bag');
  });
});

describe('§32 the uploaded sheet', () => {
  it('finds the header row by name, skips totals, and reads a GST-inclusive column when there is one', () => {
    const aoa = [
      ['Bloomflex sales August 2026'],
      [],
      ['Customer Name', 'Spec No', 'Quantity', 'Total Sale', 'Total incl GST'],
      ['AMAZON', 'A1', '5,000', '₹15,000', 17700],
      ['RELIANCE GROUP', 'Z9', 100, 500, ''],
      ['', '', '', '', ''],
      ['Total', '', 5100, 15500, ''],
    ];
    const p = parseSalesSheet(aoa);
    expect(p.errors).toEqual([]);
    expect(p.headerRow).toBe(3);
    expect(p.lines).toEqual([
      { customer: 'AMAZON', spec: 'A1', qty: 5000, amount: 15000, amountInclGst: 17700 },
      { customer: 'RELIANCE GROUP', spec: 'Z9', qty: 100, amount: 500, amountInclGst: undefined },
    ]);
  });
  it('says what it could not read, and refuses a sheet with no usable header', () => {
    const p = parseSalesSheet([['Group', 'SKU', 'Qty', 'Amount'], ['AMAZON', 'A1', 5, ''], ['', '', 3, 100]]);
    expect(p.lines).toEqual([]);
    expect(p.errors).toHaveLength(2);
    expect(p.errors[0]).toMatch(/no total sale for A1/);
    expect(parseSalesSheet([['a', 'b'], [1, 2]]).errors[0]).toMatch(/No header row found/);
  });
});

describe('§35-§36 the export rows', () => {
  it('carries the summary on top and one row per line with GST and margin', () => {
    const seg = bySegment(lines.filter((l) => l.period === '2026-09'));
    const { head, body, summary } = exportRows(lines, '2026-09', seg);
    expect(head[0]).toBe('Invoice');
    expect(body).toHaveLength(4);
    expect(body[0][2]).toBe('AMAZON');
    expect(body[0][6]).toBe('Stayfresh');
    expect(body[0][11]).toBeCloseTo(3540);   // 3,000 incl. GST
    expect(body.find((r) => r[4] === 'C3')[13]).toBe('');   // no margin without a cost
    expect(summary[1]).toEqual(['Stayfresh sale', 18000, 'Stayfresh margin', 6000]);
    expect(summary[4][3]).toBe(1);
  });
  it('names periods the way people say them', () => {
    expect(periodLabel('2026-01')).toBe('Jan 2026');
    expect(periodBack('2026-01', 1)).toBe('2025-12');
    expect(periodBack('2026-09', 12)).toBe('2025-09');
  });
});

describe('§24-§25 / §27 per-SKU and per-customer history', () => {
  it('pivots every SKU month by month under the current filter, same month last year on each point', () => {
    const p = skuMonthPivot(applyFilters(lines, { customer: 'AMAZON' }), '2026-09', 12);
    expect(p.months[11]).toBe('2026-09');
    expect(p.months[0]).toBe('2025-10');
    expect(p.rows).toHaveLength(1);                       // AMAZON only buys A1
    expect(p.rows[0].spec).toBe('A1');
    expect(p.rows[0].cells['2026-09']).toBe(18000);
    expect(p.rows[0].cells['2026-08']).toBe(9000);
    expect(p.rows[0].cells['2026-07']).toBe(3000);
    expect(p.rows[0].pct).toBe(100);                      // Sep against Aug
    expect(p.colTotals[11]).toBe(18000);
    const all = skuMonthPivot(lines, '2026-09', 3);
    expect(all.rows.map((r) => r.spec)).toEqual(['A1', 'B2', 'C3']);   // largest first
    const s = monthSeries(lines, '2026-09', 1);
    expect(s[0].lastYear).toBe(12000);
    expect(s[0].yoyPct).toBeCloseTo(60);
  });
  it('carries a six-month margin trend per customer (June → July → August → September)', () => {
    const amazon = breakdown(lines, '2026-09', 'customer', ctx).find((r) => r.key === 'AMAZON');
    expect(amazon.marginTrend.map((m) => m.period)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(amazon.marginTrend.map((m) => m.marginPct == null ? null : Math.round(m.marginPct))).toEqual([33, 33, 33, 33, 33, 33]);
    expect(amazon.marginTrend[5].margin).toBe(6000);
    const kb = breakdown(lines, '2026-09', 'customer', ctx).find((r) => r.key === 'KAY BEE');
    expect(kb.marginTrend.every((m) => m.marginPct == null)).toBe(true);   // no Price Master → no guessed margin
  });
});
