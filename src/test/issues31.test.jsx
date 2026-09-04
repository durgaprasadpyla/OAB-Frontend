import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// Issues 3.1 — the Stores desk stops typing what it should be picking.
//
//   GRN            the paperwork is filled first and the material chosen after;
//                  the item CODE is picked and its description + material identity
//                  read back beside it, not clubbed into one box; the price starts
//                  at what this supplier last charged, and stays editable.
//   Issues/returns department, sale order, split width and location are pickers.
//                  The sale-order list is what the PPC planned for TODAY.

vi.mock('../lib/xlsx.js', () => ({ exportAOA: vi.fn(), exportObjects: vi.fn() }));
vi.mock('../lib/pdf.js', () => ({ elementToPDF: vi.fn(async () => {}), printElement: vi.fn() }));

const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const TODAY = new Date().toISOString().slice(0, 10);

const ITEMS = [
  { id: 1, code: 'BLM031', name: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'Surface', microns: '51', uom: 'Kg' },
  { id: 2, code: 'BLM034', name: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '35', uom: 'Kg' },
];
const PURCHASE = {
  pos: [],
  asl: [
    { company: 'Cosmo Films', itemCode: 'BLM031', materialType: 'FILM', subGroup: 'AF BOPP', basicPrice: '142.50' },
    { company: 'Jindal Poly', itemCode: 'BLM031', materialType: 'FILM', subGroup: 'AF BOPP', basicPrice: '150' },
    { company: 'Cosmo Films', itemCode: 'BLM034', materialType: 'FILM', subGroup: 'AF BOPP', basicPrice: '99' },
  ],
};
const ON_HAND = [{ id: 1, code: 'BLM031', name: '460 MM', uom: 'Kg', closingStock: 500, unitCount: 1 }];
const UNITS = [{ id: 11, itemId: 1, internalCode: 'BLMU-1', qtyRemaining: 500, qtyReceived: 500, widthMm: 1200, uom: 'Kg', location: 'A2', status: 'MOVING' }];

let posted;
beforeEach(() => {
  posted = [];
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: PURCHASE }, save: vi.fn() }) }));
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET') !== 'GET') { posted.push({ u, body: JSON.parse(opts.body || '{}') }); return res({}); }
    if (u.includes('/api/master/items')) return res(ITEMS);
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing' }, { id: 2, name: 'Pouching' }]);
    if (u.includes('/api/stores/locations')) return res([{ id: 1, name: 'A2', active: true }, { id: 2, name: 'CG', active: true }]);
    if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
    if (u.includes('/units')) return res(UNITS);
    if (u.includes('/api/planning/week')) return res({ jobs: [{ so: '26/697', planDate: TODAY }, { so: '26/698', planDate: TODAY }] });
    if (u.includes('/api/stores/grns')) return res([]);
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

async function openTab(label) {
  const { default: Stores } = await import('../pages/Stores.jsx');
  render(<Stores />);
  fireEvent.click(await screen.findByText(label));
}


/** Wait for the on-hand list to arrive before choosing from it. */
async function chooseItem(value = '1') {
  await waitFor(() => expect(screen.getByLabelText('Item').options.length).toBeGreaterThan(1));
  fireEvent.change(screen.getByLabelText('Item'), { target: { value } });
}

describe('GRN — the receipt is worked paperwork first (Issues 3.1)', () => {
  it('puts the paperwork above the material selection', async () => {
    await openTab('📥 GRN');
    await screen.findByText('📥 New goods receipt');
    const order = ['GRN number', 'Purchase order', 'GRN date', 'Invoice date', 'Invoice number',
      'Material type filter', 'Sub group filter', 'Speciality filter', 'Supplier']
      .map((l) => screen.getByLabelText(l));
    for (let i = 1; i < order.length; i++) {
      // DOCUMENT_POSITION_FOLLOWING === 4
      expect(order[i - 1].compareDocumentPosition(order[i]) & 4).toBeTruthy();
    }
  });

  it('picks the item by CODE and reads its description and identity back separately', async () => {
    await openTab('📥 GRN');
    await screen.findByText('📥 New goods receipt');
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Cosmo Films' } });
    await waitFor(() => expect(screen.getByLabelText('Item for line 1')).not.toBeDisabled());

    // the picker offers bare codes — not "CODE — NAME" clubbed together
    const offered = [...document.querySelectorAll('#grn-items-0 option')].map((o) => o.value);
    expect(offered).toContain('BLM031');
    expect(offered.join('|')).not.toContain('—');

    fireEvent.change(screen.getByLabelText('Item for line 1'), { target: { value: 'BLM031' } });
    await waitFor(() => expect(screen.getByLabelText('Item description line 1')).toHaveValue('460 MM'));
    expect(screen.getByLabelText('Item identity line 1')).toHaveValue('FILM · AF BOPP · Surface');
    expect(screen.getByLabelText('Item description line 1')).toHaveAttribute('readonly');
  });

  it('starts the price at what THIS supplier last charged, and leaves it editable', async () => {
    await openTab('📥 GRN');
    await screen.findByText('📥 New goods receipt');
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Jindal Poly' } });
    await waitFor(() => expect(screen.getByLabelText('Item for line 1')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Item for line 1'), { target: { value: 'BLM031' } });

    const price = screen.getByLabelText('Price line 1');
    await waitFor(() => expect(price).toHaveValue(150));      // Jindal's price, not Cosmo's 142.50
    expect(price).not.toHaveAttribute('readonly');            // the invoice in hand wins
    fireEvent.change(price, { target: { value: '155.75' } });
    expect(price).toHaveValue(155.75);
  });

  it('has no Width box on the line — the width belongs to the item', async () => {
    await openTab('📥 GRN');
    await screen.findByText('📥 New goods receipt');
    expect(screen.queryByLabelText('Width line 1')).toBeNull();
  });
});

describe('Issues & returns — pickers, not free text (Issues 3.1)', () => {
  it('offers the departments from the master', async () => {
    await openTab('🔄 Issues & Returns');
    await screen.findByLabelText('Department');
    // re-query: the box is REPLACED by a select once the master arrives
    await waitFor(() => expect(screen.getByLabelText('Department').tagName).toBe('SELECT'));
    const dept = screen.getByLabelText('Department');
    expect(within(dept).getByRole('option', { name: 'Printing' })).toBeTruthy();
    expect(within(dept).getByRole('option', { name: 'Pouching' })).toBeTruthy();
  });

  it('offers the sale orders the PPC planned for today', async () => {
    await openTab('🔄 Issues & Returns');
    await screen.findByLabelText('Sale order');
    await waitFor(() => expect(screen.getByLabelText('Sale order').tagName).toBe('SELECT'));
    expect([...screen.getByLabelText('Sale order').options].map((o) => o.value).filter(Boolean)).toEqual(['26/697', '26/698']);
    expect(screen.getByText(/\(planned today\)/)).toBeInTheDocument();
  });

  it('keeps the item code and its description in separate fields', async () => {
    await openTab('🔄 Issues & Returns');
    await screen.findByLabelText('Item');
    await chooseItem();
    const code = screen.getByLabelText('Item');
    expect([...code.options].map((o) => o.value).filter(Boolean)).toEqual(['1']);
    expect([...code.options].map((o) => o.text)).toContain('BLM031');
    await waitFor(() => expect(screen.getByLabelText('Item description')).toHaveValue('460 MM'));
  });

  it('cuts a returned roll only to a width the business has a code for', async () => {
    await openTab('🔄 Issues & Returns');
    await screen.findByLabelText('Item');
    await chooseItem();
    await waitFor(() => expect(screen.getByLabelText('Roll').options.length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '11' } });
    fireEvent.click(screen.getByLabelText('Returned as narrower rolls'));

    await screen.findByLabelText('Returned width 1');
    // 460 and 700 come from the item NAMES (that is how codes are allocated by
    // width); 1200 is the parent roll already on file.
    await waitFor(() => {
      const w = screen.getByLabelText('Returned width 1');
      expect(w.tagName).toBe('SELECT');
      expect([...w.options].map((o) => o.value).filter((v) => v && v !== '__other__')).toEqual(['460', '700', '1200']);
    });
  });

  it('still allows a width with no code yet, and says to have one added', async () => {
    await openTab('🔄 Issues & Returns');
    await screen.findByLabelText('Item');
    await chooseItem();
    fireEvent.click(await screen.findByLabelText('Returned as narrower rolls'));
    fireEvent.change(await screen.findByLabelText('Returned width 1'), { target: { value: '__other__' } });
    fireEvent.change(screen.getByLabelText('Returned width 1 other'), { target: { value: '515' } });
    expect(screen.getByText(/ask the Super Admin to add one/)).toBeInTheDocument();
  });

  it('puts a returned roll away in a rack from the master, and names its parent', async () => {
    await openTab('🔄 Issues & Returns');
    await screen.findByLabelText('Item');
    await chooseItem();
    await waitFor(() => expect(screen.getByLabelText('Roll').options.length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '11' } });
    fireEvent.click(screen.getByLabelText('Returned as narrower rolls'));

    await screen.findByLabelText('Returned location 1');
    await waitFor(() => {
      const loc = screen.getByLabelText('Returned location 1');
      expect(loc.tagName).toBe('SELECT');
      expect(within(loc).getByRole('option', { name: 'A2' })).toBeTruthy();
    }, { timeout: 3000 });
    // the parent-child link, said out loud
    expect(screen.getByText(/Cut from/)).toHaveTextContent('BLMU-1');
  });
});
