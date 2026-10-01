import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

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

  // 30.09 §Super Admin: "the per-department sub-tables have column headers NOT aligned
  // with the top table — must be seamless, same columns on the same line." Each
  // department was its own auto-layout table, so its columns sized to its own content.
  // jsdom has no layout: what is asserted is the structure that makes drift impossible —
  // ONE table, ONE header, ONE fixed column plan, the departments as rows inside it.
  it('shows every department in ONE table with one header and one column plan', async () => {
    render(<RawMaterialPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'View material for SO-1' }));
    const t = await screen.findByRole('table', { name: 'Material for SO-1 by department' });
    expect(t.style.tableLayout).toBe('fixed');
    expect(t.classList.contains('nested-tbl')).toBe(true);
    expect(t.querySelectorAll('colgroup col')).toHaveLength(6);
    // one header row for every department — not one per department
    expect(t.querySelectorAll('thead')).toHaveLength(1);
    expect(within(t).getAllByRole('columnheader', { name: /Item Code/i })).toHaveLength(1);
    expect(within(t).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['Item Code', 'Description', 'Material Type', 'Sub-Group', 'Speciality', 'Required']);
    // no second table hiding inside it
    expect(t.querySelectorAll('table')).toHaveLength(0);

    // the departments are row groups OF THIS table, each with its own subtotal
    const heads = within(t).getAllByRole('rowheader').map((h) => h.textContent);
    expect(heads[0]).toMatch(/^Printing — 2 item\(s\)/);
    expect(heads[1]).toMatch(/^Lamination — 1 item\(s\)/);
    expect(within(t).getByText('Subtotal — Printing').closest('tr').textContent).toContain('104.00 Kg');
    expect(within(t).getByText('Subtotal — Lamination')).toBeTruthy();

    // FILM-1 sits in this table, in the Printing group, under the same six columns
    const film = within(t).getByText('FILM-1').closest('tr');
    expect(film.querySelectorAll('td')).toHaveLength(6);
    const rows = [...t.querySelectorAll('tbody tr')];
    const printingAt = rows.findIndex((r) => /^Printing/.test(r.textContent));
    const laminationAt = rows.findIndex((r) => /^Lamination/.test(r.textContent));
    expect(rows.indexOf(film)).toBeGreaterThan(printingAt);
    expect(rows.indexOf(film)).toBeLessThan(laminationAt);
  });

  it('gives every department table of the PDF the same fixed column plan', async () => {
    render(<RawMaterialPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download department-wise BOM for SO-1 as PDF' }));
    await waitFor(() => expect(elementToPDF).toHaveBeenCalledTimes(1));
    const [node] = elementToPDF.mock.calls[0];
    const tables = [...node.querySelectorAll('table')];
    expect(tables.length).toBe(3);                                   // Printing, Lamination, Unassigned
    const plan = (tb) => [...tb.querySelectorAll('colgroup col')].map((c) => c.style.width);
    tables.forEach((tb) => {
      expect(tb.style.tableLayout).toBe('fixed');
      expect(plan(tb)).toEqual(plan(tables[0]));
    });
    expect(plan(tables[0])).toHaveLength(8);
  });
});

// The nested-table rule: a table inside a table cell must never stick its header over
// the outer header in a scrolling .tw box (that is what painted "the top table").
describe('nested tables never stick their header', () => {
  it('index.css un-sticks headers of tables nested in a cell', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    // vitest serves this file over http, so import.meta.url is not a file URL here.
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src', 'index.css'), 'utf8');
    expect(css).toMatch(/\.tw td table thead tr th,\s*table\.nested-tbl thead tr th\s*\{\s*position:\s*static;\s*z-index:\s*auto;\s*\}/);
  });
});
