import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import Stores from '../pages/Stores.jsx';
import { landingPath, canAccess } from '../lib/roles.js';

// Stores Login. The board is the landing page: every item in the master with its
// characteristics, the closing stock DERIVED from the physical rolls, and its MSL;
// a row expands into those rolls with their location and disposition. The other
// desks receive material (GRN), tell the planner when a PO will land, and move
// stock to and from the shop floor.

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

const BOARD = [
  { id: 1, code: 'FILM-BOPP20', name: 'BOPP Film 20mic', uom: 'Kg', materialType: 'BOPP', subGroup: 'Films',
    specialtyName: 'High Barrier', microns: '20', departmentName: 'Printing',
    msl: 500, closingStock: 400, unitCount: 2, stockValue: 48000, belowMsl: true },
  { id: 2, code: 'INK-CYAN', name: 'Cyan Ink', uom: 'Kg', materialType: 'Ink', subGroup: 'Chemicals',
    specialtyName: '', microns: '', departmentName: 'Printing',
    msl: 10, closingStock: 25, unitCount: 1, stockValue: 7762, belowMsl: false },
];
const UNITS = [
  { id: 11, itemId: 1, internalCode: 'BLMU-1', supplierCode: 'CF-9931', supplier: 'Cosmos Films', location: 'Rack A1',
    uom: 'Kg', qtyReceived: 400, qtyRemaining: 250, widthMm: 1200, price: 120, expiryDate: null, status: 'MOVING',
    parentUnitId: null, receivedAt: '2026-08-01T10:00:00Z' },
  { id: 12, itemId: 1, internalCode: 'BLMU-2', supplierCode: 'CF-9940', supplier: 'Cosmos Films', location: 'Rack B2',
    uom: 'Kg', qtyReceived: 150, qtyRemaining: 150, widthMm: 700, price: 120, expiryDate: '2027-01-31', status: 'NON_MOVING',
    parentUnitId: 11, receivedAt: '2026-08-20T10:00:00Z' },
];

let calls;
beforeEach(() => {
  calls = [];
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'stores');
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ u, method, body });
    if (u.includes('/api/auth/me')) return res(200, { username: 'store1', role: 'stores' });
    if (u.includes('/api/stores/on-hand')) return res(200, BOARD);
    if (u.match(/\/api\/stores\/items\/\d+\/units/)) return res(200, UNITS);
    if (u.match(/\/api\/stores\/items\/\d+\/msl/)) return res(200, { itemId: 1, msl: body.msl });
    if (u.match(/\/api\/stores\/units\/\d+\/status/)) return res(200, { unitId: 12, status: body.status });
    if (u.includes('/api/stores/grns')) return method === 'POST'
      ? res(201, { grnNo: 'GRN/2026/1', units: [{ unitId: 99, internalCode: 'BLMU-9' }] })
      : res(200, []);
    if (u.includes('/api/stores/issues')) return res(200, { unitId: 11, issued: body.qty, remaining: 100 });
    if (u.includes('/api/stores/returns')) return res(200, { unitId: 11, returned: [{ unitId: 21, internalCode: 'BLMU-P1' }, { unitId: 22, internalCode: 'BLMU-P2' }] });
    if (u.includes('/api/stores/txns')) return res(200, []);
    if (u.includes('/api/stores/po-eta')) return res(200, []);
    if (u.includes('/api/master/items')) return res(200, [
      { id: 1, code: 'FILM-BOPP20', name: 'BOPP Film 20mic', uom: 'Kg', materialType: 'BOPP', subGroup: 'Films', specialtyName: 'High Barrier' },
      { id: 2, code: 'INK-CYAN', name: 'Cyan Ink', uom: 'Kg', materialType: 'Ink', subGroup: 'Chemicals', specialtyName: 'Surface' },
      { id: 3, code: 'INK-WHITE', name: 'White Ink', uom: 'Kg', materialType: 'Ink', subGroup: 'Chemicals', specialtyName: 'Reverse' },
    ]);
    if (u.includes('/rest/v1/oab_data')) {
      return res(200, [{ id: 6, data: JSON.stringify({
        asl: [
          { company: 'Cosmos Films', itemCode: 'FILM-BOPP20' },
          { company: 'Siegwerk India', itemCode: 'INK-CYAN' },
          { company: 'Flint Group', itemCode: 'INK-CYAN' },
          { company: 'Sun Chemical', itemCode: 'INK-WHITE' },
          { company: 'Unmapped Traders' },
        ],
        pos: [{ poNum: 'BLM/PUR/2026-2027/7', poDate: '2026-08-20', supplier: 'Cosmos Films', status: 'Open',
                items: [{ item: 'BOPP Film 20mic', qty: 500, unit: 'Kg', rate: 120, receivedQty: 0 }] }],
      }), version: 1 }]);
    }
    return res(200, []);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = () => render(<MemoryRouter><AuthProvider><DataProvider><Stores /></DataProvider></AuthProvider></MemoryRouter>);

describe('Stores — the material-on-hand board', () => {
  it('is where the stores login lands, and only stores / super admin may open it', () => {
    expect(landingPath('stores')).toBe('/stores');
    expect(canAccess('stores', '/stores')).toBe(true);
    expect(canAccess('superadmin', '/stores')).toBe(true);
    expect(canAccess('qc', '/stores')).toBe(false);
  });

  it('lists every item with its characteristics, closing stock and MSL', async () => {
    mount();
    const row = (await screen.findByText('FILM-BOPP20')).closest('tr');
    ['BOPP', 'Films', 'High Barrier', '20', 'Printing'].forEach((v) => {
      expect(within(row).getByText(v)).toBeInTheDocument();
    });
    expect(within(row).getByText('400')).toBeInTheDocument();            // closing stock
    expect(within(row).getByLabelText('MSL for FILM-BOPP20')).toHaveValue(500);
  });

  it('offers the five filters the stores desk works by', async () => {
    mount();
    await screen.findByText('FILM-BOPP20');
    ['Filter by material', 'Filter by sub-group', 'Filter by speciality', 'Filter by microns', 'Filter by department']
      .forEach((l) => expect(screen.getByLabelText(l)).toBeInTheDocument());

    // filtering by material leaves only the matching item
    fireEvent.change(screen.getByLabelText('Filter by material'), { target: { value: 'Ink' } });
    await waitFor(() => expect(screen.queryByText('FILM-BOPP20')).toBeNull());
    expect(screen.getByText('INK-CYAN')).toBeInTheDocument();
  });

  it('expands a row into its rolls, with location, lineage and a disposition each', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByText('FILM-BOPP20'));

    const roll = await screen.findByText('BLMU-1');
    const rollRow = roll.closest('tr');
    expect(within(rollRow).getByText('Rack A1')).toBeInTheDocument();      // where it is
    expect(within(rollRow).getByText('CF-9931')).toBeInTheDocument();      // supplier's own label
    expect(within(rollRow).getByText('Cosmos Films')).toBeInTheDocument(); // where it came from

    // the child roll is marked as a split of its parent
    const child = screen.getByText('BLMU-2').closest('tr');
    expect(within(child).getByText('split')).toBeInTheDocument();

    // …and its disposition can be changed to any of the five
    const sel = screen.getByLabelText('Status of BLMU-2');
    ['Moving', 'Non-moving', 'Rejected', 'Returned', 'Sample'].forEach((o) => {
      expect(within(sel).getByRole('option', { name: o })).toBeTruthy();
    });
    fireEvent.change(sel, { target: { value: 'REJECTED' } });
    await waitFor(() => expect(calls.some((c) => c.u.includes('/units/12/status') && c.body.status === 'REJECTED')).toBe(true));
  });

  it('saves an MSL typed against an item', async () => {
    mount();
    const msl = await screen.findByLabelText('MSL for FILM-BOPP20');
    fireEvent.change(msl, { target: { value: '750' } });
    fireEvent.blur(msl);
    await waitFor(() => expect(calls.some((c) => c.u.includes('/items/1/msl') && c.body.msl === 750)).toBe(true));
  });
});

describe('Stores — purchase orders, GRN, issues and returns', () => {
  it('lets stores promise the planner a date against a purchase-order line', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText(/Purchase Orders/));
    const eta = await screen.findByLabelText('Expected date for BOPP Film 20mic on BLM/PUR/2026-2027/7');
    fireEvent.change(eta, { target: { value: '2026-09-20' } });
    fireEvent.blur(eta);
    await waitFor(() => expect(calls.some((c) => c.u.includes('/po-eta') && c.method === 'PUT'
      && c.body.expectedDate === '2026-09-20')).toBe(true));
  });

  it('receives a GRN with the supplier label, internal code, location, price and expiry', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText(/GRN/));
    await screen.findByText('📥 New goods receipt');

    // Issues 2.4 §9/§12: the supplier is named once, on the receipt, and it decides
    // which items may be received against it — so it comes first.
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Cosmos Films' } });
    await waitFor(() => expect(screen.getByLabelText('Item for line 1')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Item for line 1'), { target: { value: 'FILM-BOPP20' } });
    fireEvent.change(screen.getByLabelText('Quantity line 1'), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText('Supplier code line 1'), { target: { value: 'CF-1234' } });
    fireEvent.change(screen.getByLabelText('Internal code line 1'), { target: { value: 'BLMU-9' } });
    fireEvent.change(screen.getByLabelText('Location line 1'), { target: { value: 'Rack C3' } });
    fireEvent.change(screen.getByLabelText('Price line 1'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Expiry line 1'), { target: { value: '2027-06-30' } });
    await user.click(screen.getByRole('button', { name: /Receive material/ }));

    await waitFor(() => expect(calls.some((c) => c.u.includes('/api/stores/grns') && c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.u.includes('/api/stores/grns') && c.method === 'POST');
    expect(post.body.lines[0]).toMatchObject({
      itemId: 1, qty: 400, supplierCode: 'CF-1234', internalCode: 'BLMU-9', location: 'Rack C3', price: 120, expiryDate: '2027-06-30',
    });
    // §12: one GRN, one supplier — carried from the header onto every line.
    expect(post.body.lines[0].supplier).toBe('Cosmos Films');
    expect(post.body.supplier).toBe('Cosmos Films');
  });

  // ── Issues 2.6: the client could not raise a GRN at all ──────────────────
  //
  //  "while adding a GRN supplier drop down is empty … without selecting a supplier
  //   I will not be able to add any item"  — the list is the approved-supplier list,
  //   which lives in module 6; the stores role could not read it (403) so the box
  //   came back empty and the whole screen was unusable. The read is now granted
  //   (AuthzService), and the picker narrows to the material instead of the reverse:
  //
  //  "Under the supplier drop-down I have some 175 suppliers. In order to have a
  //   limited supplier list, I will select the item, specialty and subgroup first."

  const openGrn = async (user) => {
    mount();
    await user.click(screen.getByText(/GRN/));
    await screen.findByText('📥 New goods receipt');
  };
  const supplierNames = () => [...screen.getByLabelText('Supplier').options].slice(1).map((o) => o.text);

  it('fills the supplier picker from the approved-supplier list', async () => {
    const user = userEvent.setup();
    await openGrn(user);
    expect(supplierNames()).toEqual(['Cosmos Films', 'Flint Group', 'Siegwerk India', 'Sun Chemical', 'Unmapped Traders']);
    expect(screen.getByText(/All 5 suppliers/)).toBeInTheDocument();
  });

  it('narrows the supplier list down to the companies that supply the chosen material', async () => {
    const user = userEvent.setup();
    await openGrn(user);
    // material first…
    fireEvent.change(screen.getByLabelText('Material type filter'), { target: { value: 'Ink' } });
    await waitFor(() => expect(supplierNames()).toEqual(['Flint Group', 'Siegwerk India', 'Sun Chemical']));
    expect(screen.getByText(/3 of 5 suppliers supply this material/)).toBeInTheDocument();
    // …then speciality cuts it to the one company on that item
    fireEvent.change(screen.getByLabelText('Speciality filter'), { target: { value: 'Reverse' } });
    await waitFor(() => expect(supplierNames()).toEqual(['Sun Chemical']));
    expect(screen.getByText(/1 of 5 suppliers supplies this material/)).toBeInTheDocument();
  });

  it('falls back to every supplier when the approved list has none for that material', async () => {
    const user = userEvent.setup();
    await openGrn(user);
    // BOPP's only approved supplier is on FILM-BOPP20; pick a speciality nothing maps to
    fireEvent.change(screen.getByLabelText('Material type filter'), { target: { value: 'BOPP' } });
    await waitFor(() => expect(supplierNames()).toEqual(['Cosmos Films']));
    fireEvent.change(screen.getByLabelText('Speciality filter'), { target: { value: 'High Barrier' } });
    await waitFor(() => expect(supplierNames()).toEqual(['Cosmos Films']));
    // an item with no ASL row at all → the desk still gets the full list, never an
    // empty box: the receipt has to be booked either way.
    fireEvent.change(screen.getByLabelText('Material type filter'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Speciality filter'), { target: { value: 'Surface' } });
    await waitFor(() => expect(supplierNames()).toEqual(['Flint Group', 'Siegwerk India']));
  });

  it('narrows the items to that supplier once one is chosen, and suggests their PO', async () => {
    const user = userEvent.setup();
    await openGrn(user);
    // the item box stays shut until a supplier is named (§12: one GRN, one supplier)
    expect(screen.getByLabelText('Item for line 1')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Material type filter'), { target: { value: 'Ink' } });
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Siegwerk India' } });
    await waitFor(() => expect(screen.getByLabelText('Item for line 1')).not.toBeDisabled());
    // Issues 3.0: the item is typed against a datalist (by code or name), so what is
    // OFFERED is the datalist's options rather than a select's.
    const offered = [...document.querySelectorAll('#grn-items-0 option')].map((o) => o.value);
    expect(offered).toEqual(['INK-CYAN — Cyan Ink']);
  });

  it('offers the header fields in the order the receipt is worked: material, then paperwork', async () => {
    const user = userEvent.setup();
    await openGrn(user);
    const order = ['Material type filter', 'Sub group filter', 'Speciality filter', 'Supplier',
      'GRN number', 'Purchase order', 'GRN date', 'Invoice date', 'Invoice number']
      .map((l) => screen.getByLabelText(l));
    for (let i = 1; i < order.length; i++) {
      // eslint-disable-next-line no-bitwise
      const after = order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(after, `${order[i].getAttribute('aria-label')} should come after ${order[i - 1].getAttribute('aria-label')}`).toBeTruthy();
    }
  });

  it('issues from the oldest roll and returns a split roll as two new rolls', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText(/Issues & Returns/));
    fireEvent.change(await screen.findByLabelText('Item'), { target: { value: '1' } });

    // the roll list is oldest-first, and the top one is flagged as the FIFO pick
    const rollSel = await screen.findByLabelText('Roll');
    const opts = [...rollSel.querySelectorAll('option')].map((o) => o.textContent);
    expect(opts[1]).toContain('BLMU-1');
    expect(opts[1]).toContain('①');

    fireEvent.change(rollSel, { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Sale order'), { target: { value: '26/500' } });
    await user.click(screen.getByRole('button', { name: /Issue/ }));
    await waitFor(() => expect(calls.some((c) => c.u.includes('/api/stores/issues')
      && c.body.unitId === 11 && c.body.qty === 150 && c.body.so === '26/500')).toBe(true));

    // now the 1200 comes back as a 700 and a 500
    await user.click(screen.getByLabelText('Returned as narrower rolls'));
    fireEvent.change(screen.getByLabelText('Returned quantity 1'), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Returned width 1'), { target: { value: '700' } });
    await user.click(screen.getByRole('button', { name: /Another roll back/ }));
    fireEvent.change(screen.getByLabelText('Returned quantity 2'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Returned width 2'), { target: { value: '500' } });
    await user.click(screen.getByRole('button', { name: /Receive return/ }));

    await waitFor(() => expect(calls.some((c) => c.u.includes('/api/stores/returns'))).toBe(true));
    const ret = calls.find((c) => c.u.includes('/api/stores/returns'));
    expect(ret.body.unitId).toBe(11);
    expect(ret.body.children).toEqual([
      expect.objectContaining({ qty: 250, widthMm: 700 }),
      expect.objectContaining({ qty: 150, widthMm: 500 }),
    ]);
  });
});
