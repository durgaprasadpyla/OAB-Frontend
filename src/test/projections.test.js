import { describe, it, expect } from 'vitest';
import {
  monthLabel, monthOf, monthsFrom, blankProjection, projectionList, validateProjection,
  saveProjection, removeProjection, actualsForMonth, actualMatches, reconcileMonth,
  byCustomer, materialForMonth, projectedVsActual, projectedMonths,
  jssActive, enrichProjection, partyLabel, blankProjFilter, filterProjections, projFilterOptions, projectionValue, valueByMonth,
} from '../lib/projections.js';

const JSS = [
  { spec: 'A1', customer: 'Amazon', jobName: 'Pouch A', subBrand: 'Fresh' },
  { spec: 'A2', customer: 'Nandi', jobName: 'Pouch B' },
];

const OAB = {
  OAB: {
    SF: [
      { so: '26/701', spec: 'A1', customer: 'Amazon', jobName: 'Pouch A', dispLoc: 'Chennai', poQty: 400, poNum: 'PO-1', poDate: '2026-10-03' },
      { so: '26/702', spec: 'A1', customer: 'Amazon', jobName: 'Pouch A', dispLoc: 'Hosur', poQty: 250, poNum: 'PO-2', poDate: '2026-10-20' },
      { so: '26/703', spec: 'A2', customer: 'Nandi', jobName: 'Pouch B', dispLoc: 'Hosur', poQty: 100, poNum: 'PO-3', poDate: '2026-11-02' },
      // arrived without anybody projecting it
      { so: '26/704', spec: 'A9', customer: 'Walkaway', jobName: 'Pouch Z', dispLoc: '', poQty: 90, poNum: 'PO-4', poDate: '2026-10-28' },
    ],
    OT: [
      { so: '26/705', spec: 'A1', customer: 'Amazon', jobName: 'Pouch A', dispLoc: 'Chennai', poQty: 60, poNum: 'PO-5', poDate: '2026-10-30', closed: true },
    ],
  },
};

const proj = (over) => ({ ...blankProjection('2026-10'), id: over.id || 'x', ...over });
const blob = (...entries) => ({ entries });

describe('months', () => {
  it('names a month the way a person would', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2026-01')).toBe('January 2026');
    expect(monthLabel('nonsense')).toBe('nonsense');
  });

  it('places a date in its month, and shrugs at a blank one', () => {
    expect(monthOf('2026-10-03')).toBe('2026-10');
    expect(monthOf('2026-10-03T00:00:00Z')).toBe('2026-10');
    expect(monthOf('')).toBe('');
    expect(monthOf(null)).toBe('');
  });

  it('rolls the year over when counting months forward', () => {
    expect(monthsFrom('2026-11', 4)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('entering a projection', () => {
  it('takes the customer and SKU from the JSS, never from what was typed', () => {
    const out = validateProjection(
      { source: 'customer', month: '2026-10', spec: 'A1', qty: '1000', marketer: 'Ravi',
        customer: 'TYPED WRONG', jobName: 'ALSO WRONG' },
      { jss: JSS });
    expect(out.customer).toBe('Amazon');
    expect(out.jobName).toBe('Pouch A');
    expect(out.qty).toBe(1000);
  });

  it('refuses a JSS number the spec master does not have', () => {
    expect(() => validateProjection(
      { source: 'customer', month: '2026-10', spec: 'NOPE', qty: '10', marketer: 'Ravi' }, { jss: JSS }))
      .toThrow(/not in the spec master/);
  });

  it('lets a lead name its own customer and SKU, with no spec', () => {
    const out = validateProjection(
      { source: 'lead', month: '2026-10', customer: 'New Co', jobName: 'Trial pouch', qty: '500', marketer: 'Asha', leadId: 'L1' },
      { jss: JSS });
    expect(out.spec).toBe('');
    expect(out.customer).toBe('New Co');
    expect(out.leadId).toBe('L1');
  });

  it('insists on a month, a real quantity and a marketing person', () => {
    const base = { source: 'customer', spec: 'A1', month: '2026-10', qty: '10', marketer: 'Ravi' };
    expect(() => validateProjection({ ...base, month: '' }, { jss: JSS })).toThrow(/month/i);
    expect(() => validateProjection({ ...base, qty: '0' }, { jss: JSS })).toThrow(/greater than zero/);
    expect(() => validateProjection({ ...base, qty: 'abc' }, { jss: JSS })).toThrow(/greater than zero/);
    expect(() => validateProjection({ ...base, marketer: '' }, { jss: JSS })).toThrow(/marketing person/);
  });

  it('keeps a blank dispatch location blank — it means every location', () => {
    const out = validateProjection(
      { source: 'customer', month: '2026-10', spec: 'A1', qty: '10', marketer: 'Ravi', dispLoc: '  ' }, { jss: JSS });
    expect(out.dispLoc).toBe('');
  });
});

describe('storing projections', () => {
  it('adds one with an id and leaves the others alone', () => {
    const before = blob(proj({ id: 'old', customer: 'Nandi' }));
    const after = saveProjection(before, { ...blankProjection('2026-11'), customer: 'Amazon', qty: 5 }, { user: 'sadmin' });
    expect(after.entries).toHaveLength(2);
    expect(after.entries[0].id).toBeTruthy();
    expect(after.entries[0].createdBy).toBe('sadmin');
    expect(after.entries.find((r) => r.id === 'old').customer).toBe('Nandi');
  });

  it('replaces in place when the id is already known, without duplicating', () => {
    const before = blob(proj({ id: 'p1', qty: 100 }));
    const after = saveProjection(before, { ...proj({ id: 'p1', qty: 250 }) }, { user: 'sadmin' });
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0].qty).toBe(250);
    expect(after.entries[0].updatedBy).toBe('sadmin');
  });

  it('removes one by id', () => {
    const after = removeProjection(blob(proj({ id: 'a' }), proj({ id: 'b' })), 'a');
    expect(after.entries.map((r) => r.id)).toEqual(['b']);
  });

  it('survives a blob that has never been written', () => {
    expect(projectionList(undefined)).toEqual([]);
    expect(projectionList({})).toEqual([]);
    expect(projectionList({ entries: null })).toEqual([]);
  });
});

describe('what actually arrived', () => {
  it('counts POs by the month of their PO date, closed ones included', () => {
    const oct = actualsForMonth(OAB, '2026-10');
    expect(oct.map((p) => p.so).sort()).toEqual(['26/701', '26/702', '26/704', '26/705']);
    expect(actualsForMonth(OAB, '2026-11').map((p) => p.so)).toEqual(['26/703']);
    expect(actualsForMonth(OAB, '2026-12')).toEqual([]);
  });

  it('matches a spec-backed projection on the spec', () => {
    const p = proj({ spec: 'A1', customer: 'Amazon', jobName: 'Pouch A' });
    expect(actualMatches(p, { spec: 'A1', customer: 'Anything', jobName: 'Anything', dispLoc: 'Chennai' })).toBe(true);
    expect(actualMatches(p, { spec: 'A2', customer: 'Amazon', jobName: 'Pouch A', dispLoc: 'Chennai' })).toBe(false);
  });

  it('matches a lead projection on customer and SKU, since it has no spec', () => {
    const p = proj({ spec: '', source: 'lead', customer: 'New Co', jobName: 'Trial pouch' });
    expect(actualMatches(p, { spec: 'A7', customer: 'New Co', jobName: 'Trial pouch', dispLoc: '' })).toBe(true);
    expect(actualMatches(p, { spec: 'A7', customer: 'New Co', jobName: 'Other', dispLoc: '' })).toBe(false);
  });

  it('honours a named dispatch location, and lets a blank one take them all', () => {
    const named = proj({ spec: 'A1', dispLoc: 'Chennai' });
    expect(actualMatches(named, { spec: 'A1', dispLoc: 'Chennai' })).toBe(true);
    expect(actualMatches(named, { spec: 'A1', dispLoc: 'Hosur' })).toBe(false);

    const all = proj({ spec: 'A1', dispLoc: '' });
    expect(actualMatches(all, { spec: 'A1', dispLoc: 'Chennai' })).toBe(true);
    expect(actualMatches(all, { spec: 'A1', dispLoc: 'Hosur' })).toBe(true);
  });
});

describe('reconciling a month', () => {
  it('deducts the POs that arrived from the projection', () => {
    const rec = reconcileMonth(blob(proj({ id: 'p1', spec: 'A1', customer: 'Amazon', jobName: 'Pouch A', qty: 1000 })), OAB, '2026-10');
    const row = rec.rows[0];
    // 400 + 250 + 60 (the closed OT one) all belong to spec A1 in October
    expect(row.actual).toBe(710);
    expect(row.remaining).toBe(290);
    expect(row.over).toBe(0);
    expect(row.orders.map((o) => o.so).sort()).toEqual(['26/701', '26/702', '26/705']);
  });

  it('reports an over-delivery instead of hiding it', () => {
    const rec = reconcileMonth(blob(proj({ id: 'p1', spec: 'A1', qty: 500 })), OAB, '2026-10');
    expect(rec.rows[0].actual).toBe(710);
    expect(rec.rows[0].remaining).toBe(0);
    expect(rec.rows[0].over).toBe(210);
  });

  it('gives a PO to one projection only, so two cannot both count it', () => {
    const rec = reconcileMonth(
      blob(proj({ id: 'p1', spec: 'A1', qty: 300 }), proj({ id: 'p2', spec: 'A1', qty: 300 })),
      OAB, '2026-10');
    const total = rec.rows.reduce((t, r) => t + r.actual, 0);
    expect(total).toBe(710);                       // not 1420
    expect(rec.rows[1].actual).toBe(0);
  });

  it('settles the narrower promise before the all-locations one absorbs it', () => {
    const rec = reconcileMonth(
      blob(proj({ id: 'all', spec: 'A1', dispLoc: '', qty: 1000 }),
           proj({ id: 'chn', spec: 'A1', dispLoc: 'Chennai', qty: 1000 })),
      OAB, '2026-10');
    const chn = rec.rows.find((r) => r.id === 'chn');
    const all = rec.rows.find((r) => r.id === 'all');
    expect(chn.actual).toBe(460);                  // 400 + the closed 60, both Chennai
    expect(all.actual).toBe(250);                  // only Hosur is left for it
  });

  it('lists orders nobody projected rather than dropping them', () => {
    const rec = reconcileMonth(blob(proj({ id: 'p1', spec: 'A1', qty: 1000 })), OAB, '2026-10');
    expect(rec.unplanned.map((p) => p.so)).toEqual(['26/704']);
    expect(rec.unplannedQty).toBe(90);
    expect(rec.projected).toBe(1000);
    expect(rec.actual).toBe(800);                  // 710 matched + 90 unplanned
  });

  it('is empty and honest when nothing was projected', () => {
    const rec = reconcileMonth(blob(), OAB, '2026-10');
    expect(rec.rows).toEqual([]);
    expect(rec.projected).toBe(0);
    expect(rec.unplanned).toHaveLength(4);
  });

  it('groups a month by customer, biggest promise first', () => {
    const rec = reconcileMonth(
      blob(proj({ id: 'a', spec: 'A1', customer: 'Amazon', qty: 1000 }),
           proj({ id: 'b', spec: 'A2', customer: 'Nandi', qty: 4000, month: '2026-10' })),
      OAB, '2026-10');
    const g = byCustomer(rec.rows);
    expect(g.map((x) => x.customer)).toEqual(['Nandi', 'Amazon']);
    expect(g[1].projected).toBe(1000);
    expect(g[1].actual).toBe(710);
  });
});

describe('the material a month implies', () => {
  // stands in for bomMaterialForSO bound to the BOM map
  const materialFor = (spec, qty) => (spec === 'A1'
    ? [{ itemCode: 'BLM064', itemDescription: '635 MM', materialType: 'FILM', uom: 'Kg', required: qty * 0.02 },
       { itemCode: 'INK099', itemDescription: 'Cyan', materialType: 'INK', uom: 'Kg', required: qty * 0.001 }]
    : []);

  it('adds up the same item across every projection that needs it', () => {
    const rows = [
      { spec: 'A1', qty: 1000, remaining: 1000, customer: 'Amazon' },
      { spec: 'A1', qty: 500, remaining: 500, customer: 'Nandi' },
    ];
    const { items } = materialForMonth(rows, materialFor);
    expect(items[0].itemCode).toBe('BLM064');
    expect(items[0].required).toBeCloseTo(30, 6);     // 1500 x 0.02
    expect(items[1].required).toBeCloseTo(1.5, 6);
  });

  it('costs what is still to come by default, and the whole month on request', () => {
    const rows = [{ spec: 'A1', qty: 1000, remaining: 400, customer: 'Amazon' }];
    expect(materialForMonth(rows, materialFor).items[0].required).toBeCloseTo(8, 6);
    expect(materialForMonth(rows, materialFor, { basis: 'projected' }).items[0].required).toBeCloseTo(20, 6);
  });

  it('says which projections it could not cost, and why', () => {
    const rows = [
      { spec: '', qty: 100, remaining: 100, customer: 'New Co', jobName: 'Trial' },
      { spec: 'A2', qty: 100, remaining: 100, customer: 'Nandi', jobName: 'Pouch B' },
    ];
    const { items, noBom } = materialForMonth(rows, materialFor);
    expect(items).toEqual([]);
    expect(noBom.map((r) => r.reason)).toEqual([
      'from a lead — no JSS number yet',
      'no BOM saved for this spec',
    ]);
  });

  it('ignores a projection the orders have already covered', () => {
    const rows = [{ spec: 'A1', qty: 1000, remaining: 0, customer: 'Amazon' }];
    expect(materialForMonth(rows, materialFor).items).toEqual([]);
  });
});

describe('projected against actual', () => {
  it('plots a point per month with both figures', () => {
    const p = blob(proj({ id: 'a', spec: 'A1', qty: 1000, month: '2026-10' }),
                   proj({ id: 'b', spec: 'A2', qty: 500, month: '2026-11' }));
    const chart = projectedVsActual(p, OAB, ['2026-10', '2026-11']);
    expect(chart.points.map((x) => x.label)).toEqual(['October 2026', 'November 2026']);
    expect(chart.points[0].projected).toBe(1000);
    expect(chart.points[0].actual).toBe(800);
    expect(chart.points[1].actual).toBe(100);
    expect(chart.max).toBe(1000);
  });

  it('has nothing to plot when no month is given', () => {
    expect(projectedVsActual(blob(), OAB, [])).toBeNull();
    expect(projectedVsActual(blob(), OAB, ['rubbish'])).toBeNull();
  });

  it('lists the months anything has been projected for, newest first', () => {
    const p = blob(proj({ id: 'a', month: '2026-10' }), proj({ id: 'b', month: '2026-12' }), proj({ id: 'c', month: '2026-10' }));
    expect(projectedMonths(p)).toEqual(['2026-12', '2026-10']);
  });
});

describe('the group, the sub-brand and the active flag', () => {
  const JSS2 = [
    ...JSS,
    { spec: 'A5', customer: 'Nandi', jobName: 'Pouch old', status: 'Inactive' },
    { spec: 'A6', customer: '', group: 'AMAZON', jobName: 'Polybag 500', subBrand: 'Amazon Fresh' },
  ];
  const CUST = [{ customer: 'Nandi', group: 'Nandi Group' }];
  const good = { source: 'customer', month: '2026-11', qty: '10', marketer: 'Ravi' };

  it('treats a JSS with no status as Active, and any other status as not', () => {
    expect(jssActive({ spec: 'A1' })).toBe(true);
    expect(jssActive({ spec: 'A1', status: 'active' })).toBe(true);
    expect(jssActive({ spec: 'A1', status: 'Inactive' })).toBe(false);
    expect(jssActive({ spec: 'A1', status: 'Redundant' })).toBe(false);
  });

  it('refuses a NEW projection against a retired JSS, but lets a saved one be edited', () => {
    expect(() => validateProjection({ ...good, spec: 'A5' }, { jss: JSS2 })).toThrow(/A5 is Inactive — only an Active JSS/);
    expect(validateProjection({ ...good, id: 'p9', spec: 'A5' }, { jss: JSS2 }).spec).toBe('A5');
  });

  it('copies the group and sub-brand from the JSS, and finds the group through the Customer Master', () => {
    const a6 = validateProjection({ ...good, spec: 'A6' }, { jss: JSS2, customers: CUST });
    expect(a6).toMatchObject({ customer: '', group: 'AMAZON', subBrand: 'Amazon Fresh' });
    const a2 = validateProjection({ ...good, spec: 'A2' }, { jss: JSS2, customers: CUST });
    expect(a2).toMatchObject({ customer: 'Nandi', group: 'Nandi Group', subBrand: '' });
    const lead = validateProjection({ ...good, source: 'lead', customer: 'Nandi', jobName: 'X' }, { jss: JSS2, customers: CUST });
    expect(lead.group).toBe('Nandi Group');
  });

  it('reads the group and sub-brand live off the JSS, so an old row catches up', () => {
    const r = enrichProjection({ spec: 'a6', customer: '', qty: 5 }, { jss: JSS2, customers: CUST });
    expect(r).toMatchObject({ group: 'AMAZON', subBrand: 'Amazon Fresh', jobName: 'Polybag 500', jssStatus: 'Active' });
    expect(enrichProjection({ spec: 'A5', customer: 'Nandi' }, { jss: JSS2, customers: CUST }).jssStatus).toBe('Inactive');
  });

  it('heads a block by the GROUP — never "(unnamed)" for a group-only spec', () => {
    expect(partyLabel('AMAZON', '')).toBe('AMAZON');
    expect(partyLabel('Nandi Group', 'Nandi')).toBe('Nandi Group · Nandi');
    expect(partyLabel('RIL', 'RIL')).toBe('RIL');
    expect(partyLabel('', '')).toBe('(unnamed)');
    const g = byCustomer([
      { group: 'AMAZON', customer: '', qty: 2000, actual: 0, remaining: 2000 },
      { group: 'Nandi Group', customer: 'Nandi', qty: 100, actual: 0, remaining: 100 },
      { group: 'Nandi Group', customer: 'Nandi', qty: 50, actual: 0, remaining: 50 },
    ]);
    expect(g.map((x) => [x.label, x.projected])).toEqual([['AMAZON', 2000], ['Nandi Group · Nandi', 150]]);
  });
});

describe('filtering and valuing projections', () => {
  const PRICES = { A1: { price: 3 }, A2: { price: 5 } };
  const rows = [
    { spec: 'A1', group: 'AMAZON', customer: 'Amazon', marketer: 'Ravi', qty: 1000, actual: 710, remaining: 290 },
    { spec: 'A2', group: 'Nandi Group', customer: 'Nandi', marketer: 'Asha', qty: 100, actual: 0, remaining: 100 },
    { spec: '', group: '', customer: 'New Co', marketer: 'Asha', qty: 300, actual: 0, remaining: 300 },
  ];
  it('filters by group, customer, JSS and marketing person, case-blind, blank meaning all', () => {
    expect(filterProjections(rows, blankProjFilter())).toHaveLength(3);
    expect(filterProjections(rows, { group: 'amazon' }).map((r) => r.spec)).toEqual(['A1']);
    expect(filterProjections(rows, { customer: 'Nandi' }).map((r) => r.spec)).toEqual(['A2']);
    expect(filterProjections(rows, { spec: 'a2' }).map((r) => r.spec)).toEqual(['A2']);
    expect(filterProjections(rows, { marketer: 'Asha' })).toHaveLength(2);
    expect(filterProjections(rows, { marketer: 'Asha', group: 'AMAZON' })).toHaveLength(0);
  });
  it('offers the distinct choices from the rows', () => {
    expect(projFilterOptions(rows)).toEqual({
      groups: ['AMAZON', 'Nandi Group'], customers: ['Amazon', 'Nandi', 'New Co'], specs: ['A1', 'A2'], marketers: ['Asha', 'Ravi'],
    });
  });
  it('values a projection at qty × Price Master price, and calls an unpriced one unpriced', () => {
    expect(projectionValue(rows[0], PRICES)).toEqual({ price: 3, priced: true, projectedValue: 3000, actualValue: 2130, remainingValue: 870 });
    expect(projectionValue(rows[2], PRICES).priced).toBe(false);
    expect(projectionValue(rows[0], {}).projectedValue).toBe(0);
  });
  it('values the months under a filter, reconciled against the OAB', () => {
    const v = valueByMonth(
      blob(proj({ id: 'a', spec: 'A1', customer: 'Amazon', marketer: 'Ravi', qty: 1000 }),
           proj({ id: 'b', spec: 'A2', customer: 'Nandi', marketer: 'Asha', qty: 100, month: '2026-11' }),
           proj({ id: 'c', source: 'lead', customer: 'New Co', jobName: 'T', marketer: 'Asha', qty: 300 })),
      OAB, ['2026-10', '2026-11'], { prices: PRICES, jss: JSS });
    expect(v[0]).toMatchObject({ month: '2026-10', count: 2, qty: 1300, value: 3000, actualValue: 2130, remainingValue: 870, unpriced: 1 });
    expect(v[1]).toMatchObject({ month: '2026-11', count: 1, value: 500, actualValue: 500, remainingValue: 0, unpriced: 0 });
    const only = valueByMonth(blob(proj({ id: 'a', spec: 'A1', customer: 'Amazon', marketer: 'Ravi', qty: 1000 })),
      OAB, ['2026-10'], { prices: PRICES, jss: JSS, filter: { marketer: 'Asha' } });
    expect(only[0]).toMatchObject({ count: 0, value: 0 });
  });
});
