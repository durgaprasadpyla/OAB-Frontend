import { describe, it, expect } from 'vitest';
import { snapshotBase, mergeRow, maxLastSO, mergeOabModule, CUMULATIVE } from '../lib/merge.js';

// The regression these tests exist for (from integration-sync.js):
//   a stale tab saved and reverted 27 rows — FG allocations zeroed on 26/541-543,
//   manDisp/invDisp rolled back, short-closed SOs reopened, manDispLog/price/closed
//   deleted, 26 invoices dropped, lastSO rewound 604 -> 553.

const row = (o) => ({ so: '26/541', poQty: 100000, fg: 0, invDisp: 0, manDisp: 0, ...o });
const mod = ({ SF = [], OT = [], INV_REG = [], lastSO = { y: '26', n: 500 }, lastInvNo = 90 } = {}) =>
  ({ OAB: { SF, OT }, INV_REG, lastSO, lastInvNo });

describe('snapshotBase', () => {
  it('indexes both sheets by SO and deep-copies', () => {
    const m = mod({ SF: [row({ so: 'A' })], OT: [row({ so: 'B' })] });
    const b = snapshotBase(m);
    expect(Object.keys(b.SF)).toEqual(['A']);
    expect(Object.keys(b.OT)).toEqual(['B']);
    m.OAB.SF[0].poQty = 1;
    expect(b.SF.A.poQty).toBe(100000);      // snapshot is independent
  });

  it('tolerates an empty or malformed blob', () => {
    expect(snapshotBase(undefined)).toEqual({ SF: {}, OT: {} });
    expect(snapshotBase({})).toEqual({ SF: {}, OT: {} });
  });
});

describe('mergeRow — the field-level rule', () => {
  it('KEEPS THEIRS for a field this tab never touched', () => {
    // The whole point: my stale copy of `stage` must not overwrite their newer one.
    const base = row({ stage: 'Printing' });
    const mine = row({ stage: 'Printing' });                 // unchanged here
    const theirs = row({ stage: 'Dispatched' });             // someone advanced it
    expect(mergeRow(base, mine, theirs).stage).toBe('Dispatched');
  });

  it('keeps MINE for a field this tab did change', () => {
    const base = row({ stage: 'Printing' });
    const mine = row({ stage: 'Lamination' });               // I edited it
    const theirs = row({ stage: 'Printing' });
    expect(mergeRow(base, mine, theirs).stage).toBe('Lamination');
  });

  it('never deletes a key that exists on the server but not locally', () => {
    // manDispLog / price / closed were lost exactly this way.
    const base = row({});
    const mine = row({});
    const theirs = row({ price: 12.5, closed: true, note: 'x' });
    const out = mergeRow(base, mine, theirs);
    expect(out.price).toBe(12.5);
    expect(out.closed).toBe(true);
    expect(out.note).toBe('x');
  });

  it('applies only MY delta to cumulative fields, so both sides survive', () => {
    const base = row({ manDisp: 100 });
    const mine = row({ manDisp: 150 });      // I added 50
    const theirs = row({ manDisp: 300 });    // they added 200
    expect(mergeRow(base, mine, theirs).manDisp).toBe(350);   // 300 + (150-100)
  });

  it('does not resurrect a cumulative value the other side reduced', () => {
    const base = row({ fg: 100 });
    const mine = row({ fg: 100 });           // I did not touch it
    const theirs = row({ fg: 0 });           // they cleared it
    expect(mergeRow(base, mine, theirs).fg).toBe(0);
  });

  it('clamps a negative cumulative result to zero', () => {
    const base = row({ fg: 100 });
    const mine = row({ fg: 0 });             // I removed 100
    const theirs = row({ fg: 50 });          // they had already reduced it
    expect(mergeRow(base, mine, theirs).fg).toBe(0);   // 50 + (0-100) -> clamped
  });

  it('unions append-only history without truncating either side', () => {
    const base = row({ manDispLog: [{ d: 1 }] });
    const mine = row({ manDispLog: [{ d: 1 }, { d: 2 }] });
    const theirs = row({ manDispLog: [{ d: 1 }, { d: 3 }] });
    expect(mergeRow(base, mine, theirs).manDispLog).toEqual([{ d: 1 }, { d: 3 }, { d: 2 }]);
  });

  it('with NO baseline degrades to add-only, never below either side', () => {
    const mine = row({ fg: 40, stage: 'Mine' });
    const theirs = row({ fg: 90, stage: 'Theirs' });
    const out = mergeRow(undefined, mine, theirs);
    expect(out.fg).toBe(90);              // max(), never a decrease
    expect(out.stage).toBe('Mine');       // old add-only behaviour
  });

  it('covers every declared cumulative field', () => {
    const base = row({ fg: 1, invDisp: 1, manDisp: 1 });
    const mine = row({ fg: 2, invDisp: 3, manDisp: 4 });
    const theirs = row({ fg: 10, invDisp: 10, manDisp: 10 });
    const out = mergeRow(base, mine, theirs);
    CUMULATIVE.forEach((f) => expect(out[f], f).toBeGreaterThan(10));
  });
});

describe('maxLastSO — counters never run backwards', () => {
  it('takes the later year, then the higher number', () => {
    expect(maxLastSO({ y: '26', n: 553 }, { y: '26', n: 604 })).toEqual({ y: '26', n: 604 });
    expect(maxLastSO({ y: '26', n: 900 }, { y: '27', n: 1 })).toEqual({ y: '27', n: 1 });
    expect(maxLastSO(null, { y: '26', n: 5 })).toEqual({ y: '26', n: 5 });
    expect(maxLastSO({ y: '26', n: 5 }, null)).toEqual({ y: '26', n: 5 });
  });
});

describe('mergeOabModule — the 2026-08-16 incident, replayed', () => {
  // A tab loaded when the board was quiet, then saves one unrelated edit hours later.
  const base = snapshotBase(mod({
    SF: [
      row({ so: '26/541', fg: 82200, manDisp: 0, closed: false }),
      row({ so: '26/542', fg: 105000 }),
      row({ so: '26/543', fg: 29400, manDispLog: [{ d: 'a' }] }),
    ],
    lastSO: { y: '26', n: 553 },
    lastInvNo: 364,
  }));

  // Meanwhile the server moved on: FG allocated, SOs short-closed, invoices raised.
  const theirs = mod({
    SF: [
      row({ so: '26/541', fg: 82200, manDisp: 500, closed: true, price: 11.2, manDispLog: [{ d: 'b' }] }),
      row({ so: '26/542', fg: 105000, closed: true }),
      row({ so: '26/543', fg: 29400, manDispLog: [{ d: 'a' }, { d: 'c' }] }),
      row({ so: '26/604' }),                                   // a brand-new order
    ],
    INV_REG: Array.from({ length: 75 }, (_, i) => ({ no: 'INV' + i })),
    lastSO: { y: '26', n: 604 },
    lastInvNo: 371,
  });

  // The stale tab's copy: still the old values, plus one deliberate local edit.
  const mine = mod({
    SF: [
      row({ so: '26/541', fg: 82200, manDisp: 0, closed: false, stage: 'Lamination' }),  // <- my only edit
      row({ so: '26/542', fg: 105000 }),
      row({ so: '26/543', fg: 29400, manDispLog: [{ d: 'a' }] }),
    ],
    INV_REG: Array.from({ length: 49 }, (_, i) => ({ no: 'INV' + i })),
    lastSO: { y: '26', n: 553 },
    lastInvNo: 364,
  });

  const { merged, stats } = mergeOabModule(base, mine, theirs);
  const bySo = Object.fromEntries(merged.OAB.SF.map((r) => [r.so, r]));

  it('does not zero the FG allocations', () => {
    expect(bySo['26/541'].fg).toBe(82200);
    expect(bySo['26/542'].fg).toBe(105000);
    expect(bySo['26/543'].fg).toBe(29400);
  });

  it('does not roll back the other tab\'s manual dispatch', () => {
    expect(bySo['26/541'].manDisp).toBe(500);
  });

  it('does not reopen short-closed sale orders', () => {
    expect(bySo['26/541'].closed).toBe(true);
    expect(bySo['26/542'].closed).toBe(true);
  });

  it('does not delete keys the stale tab never had', () => {
    expect(bySo['26/541'].price).toBe(11.2);
  });

  it('does not truncate the dispatch log', () => {
    expect(bySo['26/541'].manDispLog).toEqual([{ d: 'b' }]);
    expect(bySo['26/543'].manDispLog).toEqual([{ d: 'a' }, { d: 'c' }]);
  });

  it('does not drop the 26 invoices raised meanwhile', () => {
    expect(merged.INV_REG).toHaveLength(75);
    expect(stats.addedInv).toBe(26);
  });

  it('does not rewind the counters', () => {
    expect(merged.lastSO).toEqual({ y: '26', n: 604 });
    expect(merged.lastInvNo).toBe(371);
  });

  it('restores the order this tab had never seen', () => {
    expect(bySo['26/604']).toBeTruthy();
    expect(stats.addedRows).toBe(1);
  });

  it('STILL APPLIES the edit the user actually made', () => {
    expect(bySo['26/541'].stage).toBe('Lamination');
  });

  it('leaves both inputs untouched', () => {
    expect(mine.OAB.SF[0].closed).toBe(false);
    expect(theirs.OAB.SF[0].stage).toBeUndefined();
  });
});

describe('mergeOabModule — ordinary cases', () => {
  it('keeps an order this tab just created and the server has not seen', () => {
    const mine = mod({ SF: [row({ so: 'NEW' })] });
    const theirs = mod({ SF: [] });
    const { merged } = mergeOabModule(snapshotBase(mod({})), mine, theirs);
    expect(merged.OAB.SF.map((r) => r.so)).toEqual(['NEW']);
  });

  it('prefers the invoice copy that carries a packing list', () => {
    const mine = mod({ INV_REG: [{ no: 'I1' }] });
    const theirs = mod({ INV_REG: [{ no: 'I1', packingList: [{ box: 1 }] }] });
    const { merged } = mergeOabModule(null, mine, theirs);
    expect(merged.INV_REG[0].packingList).toHaveLength(1);
  });

  it('is a no-op when both sides already agree', () => {
    const m = mod({ SF: [row({})], INV_REG: [{ no: 'I1' }] });
    const { merged, stats } = mergeOabModule(snapshotBase(m), m, m);
    expect(merged.OAB.SF).toEqual(m.OAB.SF);
    expect(stats.addedRows).toBe(0);
    expect(stats.addedInv).toBe(0);
  });

  it('survives an empty server copy without discarding local work', () => {
    const mine = mod({ SF: [row({ so: 'A' })] });
    const { merged } = mergeOabModule(null, mine, { OAB: { SF: [], OT: [] } });
    expect(merged.OAB.SF.map((r) => r.so)).toEqual(['A']);
  });
});
