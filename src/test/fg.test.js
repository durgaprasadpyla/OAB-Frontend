import { describe, it, expect } from 'vitest';
import {
  fgProduced, fgAllocated, fgAvail, fgEntry,
  fgAddProduction, fgAddAllocation, fgSpecsWithActivity,
} from '../lib/fg.js';

describe('FG ledger accounting (lib/fg.js)', () => {
  it('reports zero for an empty / unknown spec', () => {
    expect(fgProduced({}, 'A1')).toBe(0);
    expect(fgAllocated({}, 'A1')).toBe(0);
    expect(fgAvail({}, 'A1')).toBe(0);
    expect(fgEntry({}, 'A1')).toEqual({ prod: [], alloc: [] });
  });

  it('fgAddProduction appends without mutating the original (append-only, immutable)', () => {
    const l0 = {};
    const l1 = fgAddProduction(l0, 'A1', '2026-08-01', 20000);
    expect(fgProduced(l1, 'A1')).toBe(20000);
    expect(fgProduced(l0, 'A1')).toBe(0);          // original untouched
    expect(l1).not.toBe(l0);

    const l2 = fgAddProduction(l1, 'A1', '2026-08-02', 5000);
    expect(fgProduced(l2, 'A1')).toBe(25000);      // accumulates
    expect(fgEntry(l2, 'A1').prod).toHaveLength(2);
    expect(fgProduced(l1, 'A1')).toBe(20000);      // earlier ledger unchanged
  });

  it('ignores a non-positive production quantity', () => {
    const l = fgAddProduction({}, 'A1', '2026-08-01', 0);
    expect(fgProduced(l, 'A1')).toBe(0);
    const l2 = fgAddProduction({}, 'A1', '2026-08-01', -3);
    expect(fgProduced(l2, 'A1')).toBe(0);
  });

  it('allocation draws the pool down: available = produced - allocated', () => {
    let l = fgAddProduction({}, 'A1', '2026-08-01', 20000);
    l = fgAddAllocation(l, 'A1', 8000, '26/501', 'new-po');
    expect(fgProduced(l, 'A1')).toBe(20000);
    expect(fgAllocated(l, 'A1')).toBe(8000);
    expect(fgAvail(l, 'A1')).toBe(12000);
    expect(fgEntry(l, 'A1').alloc[0]).toMatchObject({ qty: 8000, so: '26/501', src: 'new-po' });
  });

  it('allocation preserves prior production entries', () => {
    let l = fgAddProduction({}, 'A1', '2026-08-01', 10000);
    l = fgAddProduction(l, 'A1', '2026-08-02', 10000);
    l = fgAddAllocation(l, 'A1', 5000, '26/777', 'daily-update');
    expect(fgEntry(l, 'A1').prod).toHaveLength(2);
    expect(fgProduced(l, 'A1')).toBe(20000);
    expect(fgAvail(l, 'A1')).toBe(15000);
  });

  it('tracks specs independently', () => {
    let l = fgAddProduction({}, 'A1', '2026-08-01', 1000);
    l = fgAddProduction(l, 'A2', '2026-08-01', 2000);
    l = fgAddAllocation(l, 'A2', 500, '26/9', 'new-po');
    expect(fgAvail(l, 'A1')).toBe(1000);
    expect(fgAvail(l, 'A2')).toBe(1500);
    expect(fgSpecsWithActivity(l).sort()).toEqual(['A1', 'A2']);
  });

  it('fgSpecsWithActivity excludes specs with no entries', () => {
    const l = { A1: { prod: [], alloc: [] }, A2: { prod: [{ qty: 5 }], alloc: [] } };
    expect(fgSpecsWithActivity(l)).toEqual(['A2']);
  });
});
