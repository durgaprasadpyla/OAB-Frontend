import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// Material on Hand — the filters, the search, and the three figures above them.
//
// Each filter on its own is covered elsewhere (stores.test.jsx) and so is the way the
// lists narrow one another (issues24.test.jsx). What was never pinned down is the part
// the desk actually does: several filters at once, a search on top of them, and whether
// the Items listed / Below MSL / Stock value figures describe what is on screen rather
// than the whole catalogue.

vi.mock('../lib/xlsx.js', () => ({ exportAOA: vi.fn(), exportObjects: vi.fn(), readSheet: vi.fn(async () => []) }));
vi.mock('../lib/pdf.js', () => ({ elementToPDF: vi.fn(async () => {}), printElement: vi.fn() }));

const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// Two of the six share FILM + AF BOPP, and only one of those is 51 micron — so the
// filters can be told apart from one another rather than all selecting the same row.
const ON_HAND = [
  { id: 1, code: 'BLM031', name: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'Surface',
    microns: '51', departmentName: 'Printing', uom: 'Kg', closingStock: 100, unitCount: 1, msl: 150, belowMsl: true,
    stockValue: 5000, byStatus: { MOVING: { qty: 60, value: 3000 }, REJECTED: { qty: 40, value: 2000 } } },
  { id: 2, code: 'BLM032', name: '520 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'Reverse',
    microns: '35', departmentName: 'Printing', uom: 'Kg', closingStock: 200, unitCount: 2, msl: 0, belowMsl: false,
    stockValue: 8000, byStatus: { MOVING: { qty: 200, value: 8000 } } },
  { id: 3, code: 'BLM033', name: '700 MM', materialType: 'FILM', subGroup: 'PEARLISED BOPP', specialtyName: 'Surface',
    microns: '51', departmentName: 'Lamination', uom: 'Kg', closingStock: 50, unitCount: 1, msl: 80, belowMsl: true,
    stockValue: 2500, byStatus: { MOVING: { qty: 50, value: 2500 } } },
  { id: 4, code: 'INK099', name: 'Cyan', materialType: 'INK', subGroup: 'Flexo', specialtyName: '',
    microns: '', departmentName: 'Printing', uom: 'Kg', closingStock: 10, unitCount: 1, msl: 5, belowMsl: false,
    stockValue: 2000, byStatus: { MOVING: { qty: 10, value: 2000 } } },
  { id: 5, code: 'INK100', name: 'Magenta', materialType: 'INK', subGroup: 'Flexo', specialtyName: '',
    microns: '', departmentName: 'Printing', uom: 'Kg', closingStock: 0, unitCount: 0, msl: 5, belowMsl: true,
    stockValue: 0, byStatus: {} },
  { id: 6, code: 'GLU001', name: 'Adhesive', materialType: 'CHEM', subGroup: 'Adhesive', specialtyName: '',
    microns: '', departmentName: 'Lamination', uom: 'Ltr', closingStock: 40, unitCount: 1, msl: 0, belowMsl: false,
    stockValue: 1200, byStatus: { MOVING: { qty: 40, value: 1200 } } },
];

beforeEach(() => {
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: { asl: [], pos: [] } }, save: vi.fn() }) }));
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
    if (u.includes('/api/stores/msl-suggestions')) return res([]);
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

async function board() {
  const { default: Stores } = await import('../pages/Stores.jsx');
  render(<Stores />);
  return screen.findByText('BLM031');
}
const set = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const stat = (label) => [...document.querySelectorAll('.stat')]
  .find((c) => c.querySelector('.sl').textContent.trim().startsWith(label));
const codesOnScreen = () => ON_HAND.map((r) => r.code).filter((c) => screen.queryByText(c));

describe('Material on Hand — filters, search and the figures above them', () => {
  it('shows every item before anything is chosen, and totals the lot', async () => {
    await board();
    expect(codesOnScreen()).toHaveLength(6);
    expect(within(stat('Items listed')).getByText('6')).toBeInTheDocument();
    expect(within(stat('Below MSL')).getByText('3')).toBeInTheDocument();   // BLM031, BLM033, INK100
    expect(within(stat('Stock value')).getByText(/18,700/)).toBeInTheDocument();
  });

  it('narrows to the intersection when several filters are set together', async () => {
    await board();
    set('Filter by material', 'FILM');
    await waitFor(() => expect(codesOnScreen()).toEqual(['BLM031', 'BLM032', 'BLM033']));

    set('Filter by sub-group', 'AF BOPP');
    await waitFor(() => expect(codesOnScreen()).toEqual(['BLM031', 'BLM032']));

    // FILM + AF BOPP + 51 micron is one row, and it is not the same row any single
    // one of those three would have selected on its own.
    set('Filter by microns', '51');
    await waitFor(() => expect(codesOnScreen()).toEqual(['BLM031']));

    set('Filter by speciality', 'Surface');
    await waitFor(() => expect(codesOnScreen()).toEqual(['BLM031']));
  });

  it('combines a department with a material rather than replacing it', async () => {
    await board();
    set('Filter by material', 'FILM');
    set('Filter by department', 'Lamination');
    // GLU001 is Lamination but not FILM; BLM031/032 are FILM but not Lamination.
    await waitFor(() => expect(codesOnScreen()).toEqual(['BLM033']));
  });

  it('applies the search on top of the filters, not instead of them', async () => {
    await board();
    set('Filter by material', 'FILM');
    await waitFor(() => expect(codesOnScreen()).toHaveLength(3));

    // "BLM03" alone would match three FILM rows; with the sub-group set it is one.
    set('Filter by sub-group', 'PEARLISED BOPP');
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'BLM03' } });
    await waitFor(() => expect(codesOnScreen()).toEqual(['BLM033']));

    // a search that matches nothing INSIDE the filter empties the board, rather than
    // falling back to everything that matches the search
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'INK' } });
    await waitFor(() => expect(codesOnScreen()).toEqual([]));
  });

  it('searches the description as well as the code', async () => {
    await board();
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'Adhesive' } });
    await waitFor(() => expect(codesOnScreen()).toEqual(['GLU001']));
  });

  it('moves all three figures to describe only what is on screen', async () => {
    await board();
    set('Filter by material', 'INK');
    await waitFor(() => expect(codesOnScreen()).toEqual(['INK099', 'INK100']));
    expect(within(stat('Items listed')).getByText('2')).toBeInTheDocument();
    expect(within(stat('Below MSL')).getByText('1')).toBeInTheDocument();     // INK100 only
    expect(within(stat('Stock value')).getByText(/2,000/)).toBeInTheDocument();
  });

  it('clearing a filter puts everything back', async () => {
    await board();
    set('Filter by material', 'INK');
    await waitFor(() => expect(codesOnScreen()).toHaveLength(2));
    set('Filter by material', '');
    await waitFor(() => expect(codesOnScreen()).toHaveLength(6));
    expect(within(stat('Items listed')).getByText('6')).toBeInTheDocument();
    expect(within(stat('Stock value')).getByText(/18,700/)).toBeInTheDocument();
  });

  it('counts only the chosen disposition in the value, and drops items without it', async () => {
    await board();
    set('Filter by status', 'REJECTED');
    // only BLM031 holds rejected stock, and only its rejected 40 @ 50 is money
    await waitFor(() => expect(codesOnScreen()).toEqual(['BLM031']));
    expect(within(stat('Items listed')).getByText('1')).toBeInTheDocument();
    expect(within(stat('Value —')).getByText(/2,000/)).toBeInTheDocument();
  });

  it('holds the filter and the search together through a refresh of the data', async () => {
    await board();
    set('Filter by material', 'FILM');
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: '520' } });
    await waitFor(() => expect(codesOnScreen()).toEqual(['BLM032']));

    fireEvent.click(screen.getByText('↻ Refresh'));
    // the rows come back from the server; the desk's filter must survive them
    await waitFor(() => expect(codesOnScreen()).toEqual(['BLM032']));
    expect(screen.getByLabelText('Filter by material').value).toBe('FILM');
    expect(screen.getByLabelText('Search items').value).toBe('520');
  });
});
