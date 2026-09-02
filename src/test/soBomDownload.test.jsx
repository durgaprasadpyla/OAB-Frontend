import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// "I need department wise BOM download option — in both excel and PDF for SO."
//
// A sale order's material is issued department by department, so the download is
// sectioned that way and the quantities are scaled to the ORDER's balance, not
// the recipe's base. The department only exists on the planning store (the BOMs
// QC saves under Route and BOM), which this screen previously did not read at
// all — so a QC-entered BOM showed here as "No BOM". Both are covered below.

vi.mock('../lib/xlsx.js', () => ({ exportAOA: vi.fn(), exportObjects: vi.fn() }));
vi.mock('../lib/pdf.js', () => ({ elementToPDF: vi.fn(async () => {}), printElement: vi.fn() }));

vi.mock('../data.jsx', () => ({
  useData: () => ({
    mods: {
      bom: {},                       // nothing in module 13 — everything comes from QC
      customers: [{ name: 'Acme', group: 'ACME GRP' }],
      oab: { OAB: { SF: [{ so: 'SO-1', spec: 'A1337', customer: 'Acme', jobName: 'Pouch A', poQty: 2000 }], OT: [] } },
    },
    save: vi.fn(),
  }),
}));

import { exportAOA } from '../lib/xlsx.js';
import { elementToPDF } from '../lib/pdf.js';
import { bomMaterialForSOByDept, plannedBomMap, NO_DEPARTMENT } from '../lib/bom.js';
import { exportSoBomExcel, soBomFileName } from '../lib/bomExport.js';
import RawMaterialPanel from '../components/RawMaterialPanel.jsx';

const API_BOM = [{
  specCode: 'A1337', baseQty: 1000, baseUom: 'Pouches', savedBy: 'qc1', savedAt: '2026-09-01T00:00:00Z',
  items: [
    { itemCode: 'FILM-1', itemName: 'BOPP 20mic', materialType: 'BOPP', subGroup: 'Films', microns: '20', uom: 'Kg', qtyPerBase: 50, departmentName: 'Printing' },
    { itemCode: 'INK-1', itemName: 'Cyan Ink', materialType: 'Ink', subGroup: 'Chem', microns: '', uom: 'Kg', qtyPerBase: 2, departmentName: 'Printing' },
    { itemCode: 'ADH-1', itemName: 'Adhesive', materialType: 'Chem', subGroup: 'Glue', microns: '', uom: 'Kg', qtyPerBase: 4, departmentName: 'Lamination' },
    { itemCode: 'OLD-1', itemName: 'Legacy line', materialType: '', subGroup: '', microns: '', uom: 'Kg', qtyPerBase: 1, departmentName: '' },
  ],
}];

function res(body) {
  return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).includes('/api/bom')) return res(API_BOM);
    if (String(url).includes('/api/stock/alerts')) return res([]);
    return res({});
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('bomMaterialForSOByDept', () => {
  const bom = plannedBomMap(API_BOM);

  it('splits the scaled requirement into the departments that consume it', () => {
    const groups = bomMaterialForSOByDept(bom, 'A1337', 2000);   // 2x the 1000 base
    expect(groups.map((g) => g.department)).toEqual(['Printing', 'Lamination', NO_DEPARTMENT]);
    expect(groups[0].items.map((i) => [i.itemCode, i.required])).toEqual([['FILM-1', 100], ['INK-1', 4]]);
    expect(groups[1].items.map((i) => i.required)).toEqual([8]);
  });

  it('subtotals each department per unit of measure', () => {
    const [printing] = bomMaterialForSOByDept(bom, 'A1337', 2000);
    expect(printing.totals).toEqual({ Kg: 104 });
  });

  it('keeps the per-base recipe alongside the order quantity', () => {
    const [printing] = bomMaterialForSOByDept(bom, 'A1337', 2000);
    expect(printing.items[0].qtyPerBase).toBe(50);
  });

  it('is empty for a spec with no BOM rather than throwing', () => {
    expect(bomMaterialForSOByDept(bom, 'NOPE', 100)).toEqual([]);
    expect(bomMaterialForSOByDept({}, 'A1337', 100)).toEqual([]);
  });
});

describe('exportSoBomExcel', () => {
  const bom = plannedBomMap(API_BOM);
  const row = { so: 'SO-1', spec: 'A1337', customer: 'Acme', group: 'ACME GRP', jobName: 'Pouch A', bal: 2000 };

  it('writes one section per department, with the order-scaled quantity', () => {
    expect(exportSoBomExcel(bom, row)).toBe(true);
    const [aoa, filename, sheet] = exportAOA.mock.calls[0];
    const flat = aoa.map((r) => (r || []).join('|'));
    expect(flat[0]).toContain('Department-wise Bill of Materials');
    expect(flat.some((l) => l.startsWith('Printing'))).toBe(true);
    expect(flat.some((l) => l.startsWith('Lamination'))).toBe(true);
    expect(flat.some((l) => l.startsWith('FILM-1|BOPP 20mic') && l.endsWith('|100'))).toBe(true);
    expect(filename).toContain('SO-1');
    expect(sheet).toBe('BOM by Department');
  });

  it('carries the sale order and its balance in the header, not just the spec', () => {
    exportSoBomExcel(bom, row);
    const flat = exportAOA.mock.calls[0][0].map((r) => (r || []).join('|'));
    expect(flat).toContain('Sale Order|SO-1');
    expect(flat).toContain('Order Balance|2000 Pouches');
    expect(flat).toContain('BOM Base Qty|1000 Pouches');
  });

  it('refuses rather than downloading an empty sheet when the spec has no BOM', () => {
    expect(exportSoBomExcel(bom, { ...row, spec: 'NOPE' })).toBe(false);
    expect(exportAOA).not.toHaveBeenCalled();
  });

  it('names the file after the sale order and spec', () => {
    expect(soBomFileName(row)).toMatch(/^BOM_SO-1_A1337_/);
  });
});

describe('Raw Material — per-sale-order download', () => {
  it('offers Excel and PDF for a BOM that only exists in the planning store', async () => {
    render(<RawMaterialPanel />);
    // the row is downloadable at all only because the planning store is read
    const xls = await screen.findByRole('button', { name: 'Download department-wise BOM for SO-1 as Excel' });
    expect(screen.getByRole('button', { name: 'Download department-wise BOM for SO-1 as PDF' })).toBeTruthy();
    expect(screen.queryByText('No BOM')).toBeNull();

    fireEvent.click(xls);
    await waitFor(() => expect(exportAOA).toHaveBeenCalledTimes(1));
  });

  it('downloads the PDF through the shared pipeline', async () => {
    render(<RawMaterialPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download department-wise BOM for SO-1 as PDF' }));
    await waitFor(() => expect(elementToPDF).toHaveBeenCalledTimes(1));
    const [node, filename] = elementToPDF.mock.calls[0];
    expect(node.innerHTML).toContain('Printing');
    expect(node.innerHTML).toContain('Lamination');
    expect(filename).toContain('SO-1');
    expect(document.body.contains(node)).toBe(false);   // the offscreen node is cleaned up
  });

  it('breaks the on-screen view down by department too', async () => {
    render(<RawMaterialPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'View material for SO-1' }));
    expect(await screen.findByText(/^Printing/)).toBeTruthy();
    expect(screen.getByText(/^Lamination/)).toBeTruthy();
    expect(screen.getAllByText('FILM-1').length).toBeGreaterThan(0);   // also aggregated in the totals below
  });
});
