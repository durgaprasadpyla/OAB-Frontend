import { describe, it, expect } from 'vitest';
import { fgDaysSince, fgRemainingBatches, fgAgeingInfo, fgAgeingDisplay } from '../lib/fg.js';

// Build a YYYY-MM-DD that is exactly `d` days before today, so the assertions
// stay true whenever the suite runs.
function daysAgo(d) {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}
const led = (prod, alloc = []) => ({ SPEC: { prod, alloc } });

describe('fgDaysSince', () => {
  it('counts whole days back to the entry date', () => {
    expect(fgDaysSince(daysAgo(0))).toBe(0);
    expect(fgDaysSince(daysAgo(1))).toBe(1);
    expect(fgDaysSince(daysAgo(90))).toBe(90);
  });
  it('is 0 for blank or unparseable dates, never negative for future dates', () => {
    expect(fgDaysSince('')).toBe(0);
    expect(fgDaysSince(undefined)).toBe(0);
    expect(fgDaysSince('not-a-date')).toBe(0);
    expect(fgDaysSince(daysAgo(-5))).toBe(0);
  });
});

describe('fgRemainingBatches — FIFO consumption', () => {
  it('returns batches oldest-first when nothing is allocated', () => {
    const l = led([{ date: daysAgo(10), qty: 100, ts: 2 }, { date: daysAgo(20), qty: 50, ts: 1 }]);
    expect(fgRemainingBatches(l, 'SPEC')).toEqual([
      { date: daysAgo(20), qty: 50 },   // ts 1 sorts first, despite listing order
      { date: daysAgo(10), qty: 100 },
    ]);
  });

  it('drains the oldest batch first and part-consumes the next', () => {
    const l = led(
      [{ date: daysAgo(30), qty: 100, ts: 1 }, { date: daysAgo(10), qty: 100, ts: 2 }],
      [{ qty: 120 }],
    );
    // 100 fully consumes batch 1; the remaining 20 comes off batch 2.
    expect(fgRemainingBatches(l, 'SPEC')).toEqual([{ date: daysAgo(10), qty: 80 }]);
  });

  it('treats negative production entries as consumption, not as batches', () => {
    const l = led([
      { date: daysAgo(30), qty: 100, ts: 1 },
      { date: daysAgo(20), qty: -40, ts: 2 },   // manual FG-value correction
      { date: daysAgo(10), qty: 50, ts: 3 },
    ]);
    // -40 draws off the oldest batch, exactly like an allocation would.
    expect(fgRemainingBatches(l, 'SPEC')).toEqual([
      { date: daysAgo(30), qty: 60 },
      { date: daysAgo(10), qty: 50 },
    ]);
  });

  it('returns nothing once stock is fully drawn', () => {
    expect(fgRemainingBatches(led([{ date: daysAgo(5), qty: 100, ts: 1 }], [{ qty: 100 }]), 'SPEC')).toEqual([]);
    expect(fgRemainingBatches({}, 'MISSING')).toEqual([]);
  });
});

describe('fgAgeingInfo — oldest unconsumed batch', () => {
  it('ages from the oldest surviving batch and formats en-IN', () => {
    const l = led([{ date: daysAgo(90), qty: 10000, ts: 1 }]);
    expect(fgAgeingInfo(l, 'SPEC')).toEqual({ days: 90, qty: 10000, display: '90 days (10,000)' });
  });

  it('moves to the next batch once the oldest is fully allocated', () => {
    const l = led(
      [{ date: daysAgo(90), qty: 100, ts: 1 }, { date: daysAgo(3), qty: 40, ts: 2 }],
      [{ qty: 100 }],
    );
    expect(fgAgeingInfo(l, 'SPEC')).toMatchObject({ days: 3, qty: 40 });
  });

  it('singularises one day', () => {
    expect(fgAgeingDisplay(led([{ date: daysAgo(1), qty: 5, ts: 1 }]), 'SPEC')).toBe('1 day (5)');
  });

  it('shows a dash with nothing on hand', () => {
    expect(fgAgeingInfo({}, 'NONE')).toEqual({ days: -1, qty: 0, display: '-' });
    expect(fgAgeingDisplay(led([{ date: daysAgo(5), qty: 10, ts: 1 }], [{ qty: 10 }]), 'SPEC')).toBe('-');
  });
});
