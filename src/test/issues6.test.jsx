import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// Issues 6 (2026-09-13) — the three client documents, on the screens:
//   Stores   withdrawn items off the board (and moved by the Super Admin); the
//            issue slip (several rolls, one PDF); remaining weight on a split.
//   FG       the sheet re-reads the ledger; the FG Value tab splits moving /
//            non-moving in value AND pieces.
//   Masters  HR-added departments are cleared from the Super Admin's list; a
//            retired department is flagged on the employee form.
//   Sales    the Sales History tab: this month by default, live figures, the
//            missing-Price-Master note, the rep, the upload, the exports.

const res = (body, status = 200) => ({ status, ok: status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ITEMS = [
  { id: 37, code: 'BLM037', name: '1200 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', uom: 'Kg', widthMm: 1200 },
  { id: 34, code: 'BLM034', name: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', uom: 'Kg', widthMm: 700 },
  { id: 32, code: 'BLM032', name: '500 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', uom: 'Kg', widthMm: 500 },
];
const ON_HAND = ITEMS.map((it) => ({ ...it, closingStock: 200, unitCount: 1, departmentName: 'Printing', stockValue: 1000, msl: 0, byStatus: {}, active: true }));
const WITHDRAWN = [{ id: 360, code: 'BLM360', name: '1200 MM (dup)', materialType: 'FILM', subGroup: 'AF BOPP', uom: 'Kg', closingStock: 146.5, unitCount: 1, stockValue: 14650, active: false }];
const UNITS_37 = [{ id: 11, itemId: 37, internalCode: 'BLMU-7', qtyRemaining: 200, qtyReceived: 200, widthMm: 1200, uom: 'Kg', location: 'A2', status: 'MOVING', childWidth: 0, childWeight: 0, childCount: 0, receivedAt: '2026-09-01T00:00:00Z' },
  { id: 12, itemId: 37, internalCode: 'BLMU-8', qtyRemaining: 150, qtyReceived: 150, widthMm: 1200, uom: 'Kg', location: 'A2', status: 'MOVING', childWidth: 0, childWeight: 0, childCount: 0, receivedAt: '2026-09-02T00:00:00Z' }];
const CTX = { so: '26/737', found: true, spec: 'A737', customer: 'AMAZON', jobName: 'Poly bag',
  route: { routeName: 'Print-Pouch', source: 'jss', departments: [{ seq: 1, departmentName: 'Printing' }, { seq: 2, departmentName: 'Pouching' }] },
  bom: { found: true, items: [{ itemId: 37, itemCode: 'BLM037', itemName: '1200 MM', departmentName: 'Printing' }] } };
const OAB = { OAB: { SF: [{ so: '26/737', closed: false }], OT: [] } };

let posted, slipSaved, role;
beforeEach(() => {
  posted = []; slipSaved = []; role = 'stores';
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: { asl: [], pos: [] }, oab: OAB }, save: vi.fn(), reloadModule: vi.fn() }) }));
  vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ role, user: 'x' }) }));
  vi.doMock('../lib/issueSlipPdf.js', () => ({ saveIssueSlipPdf: vi.fn((slip) => { slipSaved.push(slip); return 'Issue_Slip.pdf'; }), buildIssueSlipPdf: vi.fn() }));
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET') !== 'GET') {
      const body = JSON.parse(opts.body || '{}');
      posted.push({ u, method: opts.method, body });
      if (u.includes('/issues/batch')) return res({ slipNo: 'ISS/2026/5', so: body.so, department: body.department, spec: 'A737', customer: 'AMAZON', totalQty: 230,
        lines: body.lines.map((l, i) => ({ unitId: l.unitId, internalCode: 'BLMU-' + (7 + i), itemCode: 'BLM037', qty: l.qty, remaining: 0 })) }, 201);
      if (u.includes('/move-units')) return res({ from: 'BLM360', to: 'BLM037', units: 1, txns: 0 });
      return res({});
    }
    if (u.includes('/api/stores/withdrawn')) return res(WITHDRAWN);
    if (u.includes('/api/stores/so-context')) return res(CTX);
    if (u.includes('/api/stores/items/37/units')) return res(UNITS_37);
    if (u.match(/\/api\/stores\/items\/\d+\/units/)) return res([]);
    if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
    if (u.includes('/api/stores/slips')) return res({ slipNo: 'ISS/2026/3', department: 'Printing', lines: [] });
    if (u.includes('/api/stores/txns')) return res([{ id: 1, kind: 'ISSUE', qty: 10, so: '26/737', department: 'Printing', slipNo: 'ISS/2026/3', internalCode: 'BLMU-7', itemCode: 'BLM037', ts: '2026-09-12T10:00:00Z' }]);
    if (u.includes('/api/stores/next-codes')) return res({ codes: ['BLMU-20', 'BLMU-21'] });
    if (u.includes('/api/master/items')) return res(ITEMS);
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing', active: true }, { id: 2, name: 'Pouching', active: true }, { id: 3, name: 'Slitting', active: true }]);
    if (u.includes('/api/planning/week')) return res({ jobs: [] });
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

async function mountStores(tab) {
  const { default: Stores } = await import('../pages/Stores.jsx');
  render(<Stores />);
  if (tab) fireEvent.click(await screen.findByText(tab));
}

/* ───────── §2 withdrawn items ───────── */

describe('Stores — an item deleted from the Item Master', () => {
  it('is off the board, listed as withdrawn, and the stores desk is told to ask the Super Admin', async () => {
    await mountStores();
    const strip = await screen.findByLabelText('Withdrawn items holding stock');
    expect(within(strip).getByText('BLM360')).toBeInTheDocument();
    expect(within(strip).getByText(/146\.5/)).toBeInTheDocument();
    expect(within(strip).getByText(/Ask the Super Admin to move that stock/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Move BLM360 stock onto')).toBeNull();
    // not on the board itself
    const board = screen.getByText('Material on hand').closest('.card');
    expect(within(board).queryByText('BLM360 (dup)')).toBeNull();
  });
  it('lets the Super Admin move its stock onto a code of the same family', async () => {
    role = 'superadmin';
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mountStores();
    const sel = await screen.findByLabelText('Move BLM360 stock onto');
    expect([...sel.options].map((o) => o.value).filter(Boolean)).toEqual(['37', '34', '32']);   // FILM / AF BOPP only
    fireEvent.change(sel, { target: { value: '37' } });
    fireEvent.click(screen.getByLabelText('Move BLM360 stock'));
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/stores/items/360/move-units') && p.body.toItemId === 37)).toBe(true));
    expect(await screen.findByText(/Moved 1 roll\(s\) of BLM360 onto BLM037/)).toBeInTheDocument();
  });
});

/* ───────── §7 / §8 / §13 the slip ───────── */

describe('Stores — issuing on a slip', () => {
  it('narrows the department to the route and the material to the BOM, books several rolls on one slip, and prints it', async () => {
    await mountStores('🔄 Issues & Returns');
    fireEvent.change(await screen.findByLabelText('Sale order'), { target: { value: '26/737' } });
    await waitFor(() => expect([...screen.getByLabelText('Department').options].map((o) => o.value).filter(Boolean)).toEqual(['Printing', 'Pouching']));
    expect(screen.getByText(/JSS/)).toHaveTextContent('A737');
    // only the BOM's material — 700 and 500 mm codes are in stock but not offered
    await waitFor(() => expect([...screen.getByLabelText('Item').options].map((o) => o.value).filter(Boolean)).toEqual(['37']));
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Printing' } });
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: '37' } });
    await waitFor(() => expect(screen.getByLabelText('Roll').options.length).toBe(3));
    // two rolls onto the slip
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '200' } });
    fireEvent.click(screen.getByText('＋ Add to slip'));
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '30' } });
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(screen.getAllByLabelText(/Remove BLMU-\d+ from the slip/)).toHaveLength(2);
    // a roll already fully on the slip cannot be added again
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(await screen.findByText(/Only 0 Kg of BLMU-7 is left after what is already on this slip/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Issue & print slip/));
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/stores/issues/batch'))).toBe(true));
    const body = posted.find((p) => p.u.includes('/api/stores/issues/batch')).body;
    expect(body).toEqual({ so: '26/737', department: 'Printing', lines: [{ unitId: 11, qty: 200 }, { unitId: 12, qty: 30 }] });
    // the PDF is generated from the slip the server returned, and can be fetched again
    await waitFor(() => expect(slipSaved).toHaveLength(1));
    expect(slipSaved[0].slipNo).toBe('ISS/2026/5');
    expect(await screen.findByText(/ISS\/2026\/5: 2 roll\(s\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Download slip ISS/2026/5 again')).toBeInTheDocument();
    // and older slips reprint from the history
    fireEvent.click(screen.getByLabelText('Download slip ISS/2026/3'));
    await waitFor(() => expect(slipSaved).toHaveLength(2));
    expect(slipSaved[1].slipNo).toBe('ISS/2026/3');
  });

  it('will not issue without a department, and a split shows the weight still available', async () => {
    await mountStores('🔄 Issues & Returns');
    await waitFor(() => expect(screen.getByLabelText('Item').options.length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: '37' } });
    await waitFor(() => expect(screen.getByLabelText('Roll').options.length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('＋ Add to slip'));
    fireEvent.click(screen.getByText(/Issue & print slip/));
    expect(await screen.findByText(/Pick the department this material goes to/)).toBeInTheDocument();
    expect(posted.filter((p) => p.u.includes('/issues')).length).toBe(0);

    // §11: remaining weight, live, as the child rolls are typed
    fireEvent.click(screen.getByText('↙ Receive a return'));
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '11' } });
    fireEvent.click(screen.getByLabelText('Returned as narrower rolls'));
    fireEvent.change(await screen.findByLabelText('Returned width 1'), { target: { value: '34' } });
    fireEvent.change(screen.getByLabelText('Returned weight 1'), { target: { value: '120' } });
    const totals = await screen.findByLabelText('Split totals');
    expect(totals).toHaveTextContent('total weight 120 of 200');
    expect(totals).toHaveTextContent('remaining 80');
    fireEvent.click(screen.getByText('＋ Another roll back'));
    fireEvent.change(screen.getByLabelText('Returned width 2'), { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText('Returned weight 2'), { target: { value: '90' } });
    await waitFor(() => expect(screen.getByLabelText('Split totals')).toHaveTextContent('remaining 0'));
    expect(screen.getByLabelText('Split totals')).toHaveTextContent('heavier than the roll they were cut from');
    fireEvent.click(screen.getByText('↙ Receive return'));
    expect(await screen.findByText(/only weighed 200/)).toBeInTheDocument();
    expect(posted.filter((p) => p.u.includes('/returns')).length).toBe(0);
  });
});

/* ───────── §14 the FG sheet re-reads the ledger ───────── */

describe('FG Entry — one figure in both logins', () => {
  it('re-reads the FG ledger and the flags when it opens, on demand and on focus', async () => {
    const reloadModule = vi.fn(async () => {});
    vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { jss: [], fgLedger: {}, prices: {}, customers: [] }, save: vi.fn(), reloadModule }) }));
    const { default: FgEntryPanel } = await import('../components/FgEntryPanel.jsx');
    render(<FgEntryPanel heading={false} costing="none" />);
    await waitFor(() => expect(reloadModule).toHaveBeenCalledWith('fgLedger'));
    expect(await screen.findByLabelText('FG as of')).toHaveTextContent(/re-read from the server/);
    const flagsBefore = globalThis.fetch.mock.calls.filter((c) => String(c[0]).includes('/api/stores/fg-flags')).length;
    fireEvent.click(screen.getByLabelText('Refresh FG'));
    await waitFor(() => expect(reloadModule).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(globalThis.fetch.mock.calls.filter((c) => String(c[0]).includes('/api/stores/fg-flags')).length).toBe(flagsBefore + 1));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(reloadModule).toHaveBeenCalledTimes(3));
  });
});

/* ───────── §17 FG Value — moving / non-moving ───────── */

describe('FG Value — the moving / non-moving split', () => {
  it('shows value and pieces per class at the top, a class per row, and filters by it', async () => {
    role = 'superadmin';
    vi.doMock('../data.jsx', () => ({ useData: () => ({
      mods: {
        fgLedger: { A1: { prod: [{ date: '2026-09-01', qty: 1000, ts: 1 }], alloc: [] }, A2: { prod: [{ date: '2026-09-01', qty: 500, ts: 2 }], alloc: [] } },
        jss: [{ spec: 'A1', jobName: 'One', customer: 'Acme', status: 'Active' }, { spec: 'A2', jobName: 'Two', customer: 'Beta', status: 'Active' }],
        prices: { A1: { price: 2 }, A2: { price: 10 } }, customers: [],
      }, save: vi.fn(), reloadModule: vi.fn() }) }));
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      if ((opts.method || 'GET') !== 'GET') { posted.push({ u: String(url), body: JSON.parse(opts.body || '{}') }); return res({}); }
      if (String(url).includes('/api/stores/fg-flags')) return res([{ spec: 'A2', moving: false, price: 10 }]);
      return res([]);
    });
    const { default: FgValuePanel } = await import('../components/FgValuePanel.jsx');
    render(<FgValuePanel />);
    await waitFor(() => expect(screen.getByLabelText('Movement for A2')).toHaveValue('non'));
    const tiles = screen.getByLabelText('Moving and non-moving FG');
    expect(within(tiles).getByText('Moving FG — value').nextSibling).toHaveTextContent('₹2,000');
    expect(within(tiles).getByText('Non-moving FG — value').nextSibling).toHaveTextContent('₹5,000');
    expect(within(tiles).getByText('Moving FG — pieces').nextSibling).toHaveTextContent('1,000');
    expect(within(tiles).getByText('Non-moving FG — pieces').nextSibling).toHaveTextContent('500');
    // line-wise values stay
    expect(screen.getByText('₹5,000.00')).toBeInTheDocument();
    // filter to non-moving only
    fireEvent.change(screen.getByLabelText('Filter FG value by movement'), { target: { value: 'non' } });
    await waitFor(() => expect(screen.queryByText('A1')).toBeNull());
    expect(screen.getByText('A2')).toBeInTheDocument();
    // reclassify from the row
    fireEvent.change(screen.getByLabelText('Movement for A2'), { target: { value: 'moving' } });
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/stores/fg/A2/movement') && p.body.moving === true)).toBe(true));
  });
});

/* ───────── §4-§6 departments ───────── */

describe('Drop-down selections — departments are the Super Admin’s', () => {
  it('marks the HR-added departments, clears them in one click, and merges a retired one', async () => {
    role = 'superadmin';
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const DEPTS = [
      { id: 1, name: 'Printing', active: true, createdBy: 'boss', hrAdded: false, employees: 3, designations: 2 },
      { id: 9, name: 'Accounts', active: true, createdBy: 'hr-migration', hrAdded: true, employees: 1, designations: 1 },
    ];
    vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { sales: {}, jss: [], customers: [] }, save: vi.fn(), reloadModule: vi.fn() }) }));
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      if ((opts.method || 'GET') !== 'GET') {
        posted.push({ u, method: opts.method });
        if (u.includes('retire-hr-added')) return res({ hrAdded: 1, merged: [], retired: ['Accounts'], employeesMoved: 0 });
        if (u.includes('merge-into')) return res({ from: 'Accounts', into: 'Printing', employees: 1, designations: 1, productionRefs: 0 });
        return res({});
      }
      if (u.includes('/api/master/departments')) return res(DEPTS);
      return res([]);
    });
    const { default: DropdownAdmin } = await import('../components/DropdownAdmin.jsx');
    render(<DropdownAdmin />);
    const strip = await screen.findByLabelText('HR-added departments');
    expect(strip).toHaveTextContent('Accounts');
    expect(screen.getByText('HR-added')).toBeInTheDocument();
    fireEvent.click(screen.getByText('🧹 Clear HR-added departments'));
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/master/departments/retire-hr-added'))).toBe(true));
    expect(await screen.findByText(/retired Accounts/)).toBeInTheDocument();
    // merge the retired department into an approved one
    fireEvent.change(screen.getByLabelText('Merge Accounts into'), { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText('Merge Accounts'));
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/master/departments/9/merge-into/1'))).toBe(true));
    expect(await screen.findByText(/merged into "Printing" — 1 employee/)).toBeInTheDocument();
  });
});
