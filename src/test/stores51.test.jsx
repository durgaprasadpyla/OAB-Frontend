import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// Stores_ISSUES_5.1 — the stores desk after a week on live data.
//
//   GRN                 the sticker number is visible before the receipt is booked;
//                       the item can be picked by DESCRIPTION after narrowing by
//                       material / sub-group / speciality; the row fits the screen.
//   Raw Material on Hand  figures first, filters right above the table, and an
//                       Excel of every roll with its location and status.
//   Issues & Returns    the sale order comes first and its route names the
//                       departments; material → sub-group → speciality → code; the
//                       internal code of the roll is on screen; a slit roll is
//                       booked under the code of its width.

const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ITEMS = [
  { id: 37, code: 'BLM037', name: '1200 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '35', uom: 'Kg', widthMm: 1200 },
  { id: 34, code: 'BLM034', name: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '35', uom: 'Kg', widthMm: 700 },
  { id: 33, code: 'BLM033', name: '600 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '35', uom: 'Kg', widthMm: 600 },
  { id: 50, code: 'BLM050', name: '600 MM LDPE', materialType: 'FILM', subGroup: 'LDPE', specialtyName: '', microns: '50', uom: 'Kg', widthMm: 600 },
  { id: 99, code: 'INK099', name: 'Cyan', materialType: 'INK', subGroup: 'Flexo', specialtyName: '', microns: '', uom: 'Kg' },
];
const ON_HAND = ITEMS.map((it) => ({ ...it, closingStock: 100, unitCount: 1, departmentName: 'Printing', stockValue: 5000, msl: 0,
  byStatus: it.code === 'INK099' ? { SAMPLE: { qty: 10, value: 2000 } } : { MOVING: { qty: 100, value: 5000 } } }));
const UNITS_37 = [{ id: 11, itemId: 37, internalCode: 'BLMU-7', qtyRemaining: 400, qtyReceived: 400, widthMm: 1200, uom: 'Kg', location: 'A2', status: 'MOVING',
  childWidth: 0, childWeight: 0, childCount: 0, receivedAt: '2026-09-01T00:00:00Z' }];
const ALL_UNITS = [
  { id: 11, itemId: 37, itemCode: 'BLM037', itemName: '1200 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '35', departmentName: 'Printing',
    internalCode: 'BLMU-7', grnNo: 'GRN/2026/3', supplier: 'Cosmo', supplierCode: 'CF-1', location: 'A2', widthMm: 1200, qtyReceived: 400, qtyRemaining: 400, uom: 'Kg', price: 120, status: 'MOVING', receivedAt: '2026-09-01T00:00:00Z' },
  { id: 12, itemId: 99, itemCode: 'INK099', itemName: 'Cyan', materialType: 'INK', subGroup: 'Flexo', specialtyName: '', microns: '', departmentName: 'Printing',
    internalCode: 'BLMU-8', grnNo: 'GRN/2026/4', supplier: 'Ink House', supplierCode: '', location: 'CG', widthMm: null, qtyReceived: 10, qtyRemaining: 10, uom: 'Kg', price: 200, status: 'SAMPLE', receivedAt: '2026-09-02T00:00:00Z' },
];
const PURCHASE = { pos: [], asl: [{ company: 'Cosmo', itemCode: 'BLM037' }, { company: 'Cosmo', itemCode: 'BLM034' }, { company: 'Ink House', itemCode: 'INK099' }] };
const OAB = { OAB: { SF: [{ so: '26/900', closed: false }, { so: '26/901', closed: false }, { so: '26/800', closed: true }], OT: [{ so: '26/950', closed: false }] } };

let posted, exported;
beforeEach(() => {
  posted = []; exported = [];
  window.XLSX = {
    utils: { aoa_to_sheet: (rows) => ({ rows }), book_new: () => ({}), book_append_sheet: (wb, ws) => { wb.ws = ws; }, sheet_to_json: () => [] },
    writeFile: (wb, name) => exported.push({ rows: wb.ws.rows, name }),
    read: () => ({ SheetNames: ['s'], Sheets: { s: {} } }),
  };
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: PURCHASE, oab: OAB }, save: vi.fn() }) }));
  vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ role: 'stores', user: 'store1' }) }));
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET') !== 'GET') { posted.push({ u, method: opts.method, body: JSON.parse(opts.body || '{}') }); return res({ units: [{ internalCode: 'BLMU-9' }], returned: [{ internalCode: 'BLMU-9' }] }); }
    if (u.includes('/api/stores/next-codes')) return res({ codes: ['BLMU-9', 'BLMU-10', 'BLMU-11', 'BLMU-12'] });
    if (u.includes('/api/stores/units')) return res(ALL_UNITS);
    if (u.includes('/api/stores/items/37/units')) return res(UNITS_37);
    if (u.match(/\/api\/stores\/items\/\d+\/units/)) return res([]);
    if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
    if (u.includes('/api/stores/locations')) return res([{ id: 1, name: 'A2', active: true }, { id: 2, name: 'CG', active: true }]);
    if (u.includes('/api/master/items')) return res(ITEMS);
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing' }, { id: 2, name: 'Lamination' }, { id: 3, name: 'Pouching' }, { id: 4, name: 'Slitting' }]);
    if (u.includes('/api/planning/week')) return res({ jobs: [{ so: '26/901' }] });
    if (u.includes('/api/planning/so?so=26%2F900')) return res({ so: '26/900', departments: [{ seq: 1, departmentName: 'Printing' }, { seq: 2, departmentName: 'Pouching' }] });
    if (u.includes('/api/planning/so?so=')) return res({ so: 'x', departments: [] });
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

async function mount(tab) {
  const { default: Stores } = await import('../pages/Stores.jsx');
  render(<Stores />);
  if (tab) fireEvent.click(await screen.findByText(tab));
}
const statCard = (label) => [...document.querySelectorAll('.stats .stat')]
  .find((c) => c.querySelector('.sl').textContent.trim().startsWith(label));

describe('GRN — the sticker number before the receipt is booked', () => {
  it('shows each line the internal code it will get, in sequence', async () => {
    await mount('📥 GRN');
    await screen.findByText('📥 New goods receipt');
    expect(await screen.findByLabelText('Sticker for line 1')).toHaveTextContent('BLMU-9');
    expect(screen.getByLabelText('Internal code line 1')).toHaveAttribute('placeholder', 'BLMU-9');
    fireEvent.click(screen.getByText('＋ Add line'));
    expect(screen.getByLabelText('Sticker for line 2')).toHaveTextContent('BLMU-10');
    // a hand-typed code on line 1 does not consume a number — line 2 moves up
    fireEvent.change(screen.getByLabelText('Internal code line 1'), { target: { value: 'MINE-1' } });
    expect(screen.queryByLabelText('Sticker for line 1')).toBeNull();
    expect(screen.getByLabelText('Sticker for line 2')).toHaveTextContent('BLMU-9');
  });

  it('lets the item be picked by DESCRIPTION after narrowing by material, and fills the code', async () => {
    await mount('📥 GRN');
    await screen.findByText('📥 New goods receipt');
    fireEvent.change(screen.getByLabelText('Material type filter'), { target: { value: 'FILM' } });
    fireEvent.change(screen.getByLabelText('Sub group filter'), { target: { value: 'AF BOPP' } });
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Cosmo' } });
    const desc = await screen.findByLabelText('Item description line 1');
    await waitFor(() => expect(desc).not.toBeDisabled());
    const offered = [...desc.options].map((o) => o.textContent).filter((t) => t.includes('·'));
    expect(offered).toEqual(['1200 MM · BLM037', '700 MM · BLM034']);   // the AF BOPP codes Cosmo supplies
    fireEvent.change(desc, { target: { value: '34' } });
    await waitFor(() => expect(screen.getByLabelText('Item for line 1')).toHaveValue('BLM034'));
    expect(screen.getByLabelText('Item identity line 1')).toHaveValue('FILM · AF BOPP');
  });

  it('keeps the line narrow enough for the location to be in view', async () => {
    await mount('📥 GRN');
    await screen.findByText('📥 New goods receipt');
    const table = screen.getByLabelText('Quantity line 1').closest('table');
    expect(parseInt(table.style.minWidth, 10)).toBeLessThanOrEqual(1240);
    const widthOf = (label) => parseInt(table.querySelectorAll('th')[[...screen.getByLabelText(label).closest('tr').children].indexOf(screen.getByLabelText(label).closest('td'))].style.width, 10);
    expect(widthOf('Item for line 1')).toBeLessThanOrEqual(120);   // "a maximum of 7 letters"
    expect(widthOf('Quantity line 1')).toBeLessThanOrEqual(100);
    expect(widthOf('Price line 1')).toBeLessThanOrEqual(100);
  });
});

describe('Raw Material on Hand — figures first, filters by the table, Excel of every roll', () => {
  it('puts the figures above the filters, and the filters directly above the table', async () => {
    await mount();
    await screen.findByText('BLM037');
    const stats = statCard('Items listed');
    const filter = screen.getByLabelText('Filter by material');
    const refresh = screen.getByRole('button', { name: /Refresh/ });
    const table = screen.getByText('BLM037').closest('table');
    const before = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(before(stats, filter)).toBe(true);
    expect(before(filter, table)).toBe(true);
    expect(before(stats, refresh)).toBe(true);
    // nothing but the filter bar sits between the filters and the rows
    expect(filter.closest('.fbar').nextElementSibling).toBe(table.closest('.tw'));
  });

  it('exports every roll with its location and status, for the items shown', async () => {
    await mount();
    await screen.findByText('BLM037');
    fireEvent.click(screen.getByLabelText('Export to Excel'));
    await waitFor(() => expect(exported.length).toBe(1));
    const [header, ...rows] = exported[0].rows;
    expect(header).toEqual(expect.arrayContaining(['Item Code', 'Internal Code', 'Location', 'Status', 'Remaining', 'Value']));
    expect(rows).toHaveLength(2);
    const film = rows.find((r) => r[0] === 'BLM037');
    expect(film[header.indexOf('Internal Code')]).toBe('BLMU-7');
    expect(film[header.indexOf('Location')]).toBe('A2');
    expect(film[header.indexOf('Status')]).toBe('Moving');
    expect(film[header.indexOf('Value')]).toBe(48000);
    const ink = rows.find((r) => r[0] === 'INK099');
    expect(ink[header.indexOf('Status')]).toBe('Sample');
    expect(exported[0].name).toMatch(/^Raw_Material_On_Hand_/);
  });

  it('follows the filters — only the disposition and material chosen', async () => {
    await mount();
    await screen.findByText('BLM037');
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'SAMPLE' } });
    fireEvent.click(screen.getByLabelText('Export to Excel'));
    await waitFor(() => expect(exported.length).toBe(1));
    const [, ...rows] = exported[0].rows;
    expect(rows.map((r) => r[0])).toEqual(['INK099']);
  });
});

describe('Issues & Returns — the sale order first, then the material', () => {
  async function open() {
    await mount('🔄 Issues & Returns');
    await screen.findByLabelText('Sale order');
    await waitFor(() => expect(screen.getByLabelText('Sale order').tagName).toBe('SELECT'));
  }

  it('offers every open sale order, the planned ones first and marked', async () => {
    await open();
    const so = screen.getByLabelText('Sale order');
    await waitFor(() => expect([...so.options].map((o) => o.value).filter(Boolean)).toEqual(['26/901', '26/900', '26/950']));
    expect([...so.options].find((o) => o.value === '26/901').textContent).toContain('planned today');
    expect([...so.options].some((o) => o.value === '26/800')).toBe(false);   // closed
    // and the order comes before the material on the screen
    const before = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(before(so, screen.getByLabelText('Material type'))).toBe(true);
    expect(before(screen.getByLabelText('Material type'), screen.getByLabelText('Item'))).toBe(true);
  });

  it('populates the departments from the sale order’s route', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Sale order'), { target: { value: '26/900' } });
    const dept = screen.getByLabelText('Department');
    await waitFor(() => expect([...dept.options].map((o) => o.value).filter(Boolean)).toEqual(['Printing', 'Pouching']));
    expect(screen.getByText(/from the route of 26\/900/)).toBeInTheDocument();
    // an order with no route yet falls back to every department, and says so
    fireEvent.change(screen.getByLabelText('Sale order'), { target: { value: '26/950' } });
    await waitFor(() => expect([...screen.getByLabelText('Department').options].map((o) => o.value).filter(Boolean)).toEqual(['Printing', 'Lamination', 'Pouching', 'Slitting']));
    expect(screen.getByText(/No route on file for 26\/950/)).toBeInTheDocument();
  });

  it('narrows the item codes by material, sub-group and speciality, and reads the roll’s internal code back', async () => {
    await open();
    await waitFor(() => expect(screen.getByLabelText('Item').options.length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Material type'), { target: { value: 'FILM' } });
    fireEvent.change(screen.getByLabelText('Sub group'), { target: { value: 'AF BOPP' } });
    expect([...screen.getByLabelText('Item').options].map((o) => o.textContent).filter((t) => t.startsWith('BLM'))).toEqual(['BLM037', 'BLM034', 'BLM033']);
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: '37' } });
    await waitFor(() => expect(screen.getByLabelText('Roll').options.length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '11' } });
    expect(screen.getByLabelText('Internal code of the roll')).toHaveValue('BLMU-7');
    // the other way round: picking a code fills the pickers
    fireEvent.change(screen.getByLabelText('Material type'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: '99' } });
    expect(screen.getByLabelText('Material type')).toHaveValue('INK');
    expect(screen.getByLabelText('Sub group')).toHaveValue('Flexo');
  });

  it('books a slit roll under the code of its width, from the same family, and shows the stickers', async () => {
    await open();
    await waitFor(() => expect(screen.getByLabelText('Item').options.length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: '37' } });
    await waitFor(() => expect(screen.getByLabelText('Roll').options.length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '11' } });
    fireEvent.click(screen.getByLabelText('Returned as narrower rolls'));
    const w = await screen.findByLabelText('Returned width 1');
    // AF BOPP widths no wider than 1200 — never the 600 mm LDPE
    expect([...w.options].map((o) => o.value).filter((v) => v && v !== '__other__')).toEqual(['600', '700', '1200']);
    expect([...w.options].find((o) => o.value === '600').textContent).toContain('BLM033');
    fireEvent.change(w, { target: { value: '600' } });
    expect(screen.getByLabelText('Returned item code 1')).toHaveValue('BLM033');
    fireEvent.change(screen.getByLabelText('Returned rolls 1'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Returned weight 1'), { target: { value: '100' } });
    // two rolls → two stickers, named before the return is booked
    expect(screen.getByLabelText('Stickers for returned row 1')).toHaveTextContent('BLMU-9 … BLMU-10');
    fireEvent.click(screen.getByText('↙ Receive return'));
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/stores/returns'))).toBe(true));
    const body = posted.find((p) => p.u.includes('/api/stores/returns')).body;
    expect(body.children).toHaveLength(2);
    expect(body.children.every((c) => c.itemId === 33 && c.widthMm === 600 && c.qty === 100)).toBe(true);
  });
});
