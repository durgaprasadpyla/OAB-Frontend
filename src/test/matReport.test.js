import { describe, it, expect } from 'vitest';
import { matReportData, matReportFileName, LINE_COLS, ROLL_COLS } from '../lib/matReport.js';

// Requirement 2 output: Mat Report (A) — the material allocated to one sale order.
const mat = {
  so: '26/904', spec: 'A1339', poQty: 30000,
  lines: [
    { itemCode: 'BLM306', itemName: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', departments: ['Printing'], uom: 'Kg',
      onBom: true, required: 237.57, allocated: 194.92, netIssued: 0, covered: 194.92, complete: false },
    { itemCode: 'BLM162', itemName: 'OPAQUE WHITE', materialType: 'INK', subGroup: 'C I FLEXO', departments: ['Printing'], uom: 'Kg',
      onBom: true, required: 3.3, allocated: 100, netIssued: 0, covered: 100, complete: true },
    { itemCode: 'BLM146', itemName: 'MAGENTA', materialType: 'INK', subGroup: 'C I FLEXO', departments: ['Printing'], uom: 'Kg',
      onBom: true, required: 0.6, allocated: 0, netIssued: 0, covered: 0, complete: false },
    { itemCode: 'BLM307', itemName: 'GRANULE SACK', materialType: 'PACKING MATERIAL', departments: ['Packing'], uom: "No's",
      onBom: true, required: 9.9, allocated: 0, netIssued: 5, covered: 5, complete: false },
  ],
  allocations: [
    { internalCode: 'BLMU-1227', itemCode: 'BLM306', itemName: '700 MM', qty: 194.92, uom: 'Kg', location: 'AG', source: 'STORES', actor: 'store1', ts: '2026-11-28T10:00:00Z' },
    { internalCode: 'BLMU-434', itemCode: 'BLM162', itemName: 'OPAQUE WHITE', qty: 100, uom: 'Kg', location: 'CG', source: 'PLAN', actor: 'plan1', ts: '2026-11-28T10:05:00Z' },
  ],
  issues: [
    { internalCode: 'BLMU-846', itemCode: 'BLM307', itemName: 'GRANULE SACK', qtyIssued: 8, qtyReturned: 3, uom: "No's", department: 'Packing', lineNo: 'ISS/26/1.1', ts: '2026-11-28T11:00:00Z' },
    { internalCode: 'BLMU-900', itemCode: 'BLM307', qtyIssued: 2, qtyReturned: 2, uom: "No's" },
  ],
};
const freeOf = (l) => (l.itemCode === 'BLM146' ? 0 : 50);

describe('Mat Report (A)', () => {
  it('reports each BOM line: needed, allocated, issued, still open, cover and status', () => {
    const d = matReportData({ so: '26/904', spec: 'A1339', poQty: 30000, mat, freeOf });
    const by = Object.fromEntries(d.lines.map((l) => [l.itemCode, l]));
    expect(by.BLM306).toMatchObject({ required: 237.57, allocated: 194.92, issued: 0, open: 42.65, pct: 82, status: 'Partial' });
    expect(by.BLM162).toMatchObject({ open: 0, pct: 100, status: 'Complete' });
    expect(by.BLM146).toMatchObject({ status: 'Mixed on the spot', pct: null });
    expect(by.BLM307).toMatchObject({ issued: 5, open: 4.9, status: 'Partial' });
    expect(by.BLM306.material).toBe('FILM · AF BOPP');
  });

  it('lists every roll held for or issued to the order, skipping rolls fully returned', () => {
    const d = matReportData({ so: '26/904', mat, freeOf });
    expect(d.rolls.map((r) => [r.roll, r.how, r.qty])).toEqual([
      ['BLMU-1227', 'Allocated (held)', 194.92],
      ['BLMU-434', 'Allocated (held)', 100],
      ['BLMU-846', 'Issued', 5],
    ]);
    expect(d.rolls[0].by).toBe('STORES · store1');
    expect(d.rolls[2].by).toBe('ISS/26/1.1');
  });

  it("uses the server's status when it sent one", () => {
    const readiness = { materialStatus: 'PARTIAL', materialCoverPct: 50.5, eligibleQty: 15150, bomApproved: true, bomApprovedBy: 'plan1', bomApprovedAt: '2026-11-28T09:00:00' };
    const d = matReportData({ so: '26/904', poQty: 30000, mat, readiness, freeOf });
    expect(d.summary).toEqual({ status: 'PARTIAL', statusText: 'Ready to Produce — Partial', pct: 50.5, eligible: 15150 });
    expect(Object.fromEntries(d.meta).BOM).toBe('Approved by plan1 on 2026-11-28');
  });

  it('works the status out from the lines otherwise, leaving out mixed-on-the-spot inks', () => {
    const d = matReportData({ so: '26/904', poQty: 30000, mat, freeOf });
    // weakest measured line: BLM307 5 / 9.9 → 50.5 %
    expect(d.summary.status).toBe('PARTIAL');
    expect(d.summary.pct).toBe(50.5);
    expect(d.summary.eligible).toBe(15150);
    expect(Object.fromEntries(d.meta)['Order Qty']).toBe('30,000');
  });

  it('is empty for an order with no BOM lines, and names files by order and spec', () => {
    expect(matReportData({ so: 'X', mat: { lines: [] } }).lines).toEqual([]);
    expect(matReportFileName('26/904', 'A1339')).toMatch(/^MatReport_26-904_A1339_\d{4}-\d{2}-\d{2}$/);
    expect(LINE_COLS).toContain('Allocated');
    expect(ROLL_COLS[0]).toBe('Roll');
  });
});
