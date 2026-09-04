import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// Issues 3.1 — the three that were left.
//
//   Raw material price master  every item with its speciality and who supplies it,
//                              a "price as on today" that VALUES stock without
//                              rewriting what the receipts cost, and both totals.
//   FG under Stores            moving / non-moving against each spec, a filter, and
//                              how much money is sitting in each.
//   Material on Hand           a disposition filter, with the value following it.

const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const RM = [
  { itemId: 1, code: 'BLM031', name: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'Surface',
    uom: 'Kg', onHand: 100, units: 1, priceLow: 50, priceHigh: 50, grnValue: 5000, stockValue: 5000,
    adminPrice: 60, adminValue: 6000 },
  { itemId: 2, code: 'INK099', name: 'Cyan', materialType: 'INK', subGroup: 'Flexo', specialtyName: '',
    uom: 'Kg', onHand: 10, units: 1, priceLow: 200, priceHigh: 200, grnValue: 2000, stockValue: 2000,
    adminPrice: null, adminValue: 2000 },
];
const PURCHASE = {
  pos: [],
  asl: [
    { company: 'Cosmo Films', itemCode: 'BLM031' },
    { company: 'Jindal Poly', itemCode: 'BLM031' },
    { company: 'Ink House', itemCode: 'INK099' },
  ],
};
const FG = [
  { spec: 'A1', jobName: 'Pouch A', customer: 'Amazon', orders: 2, poQty: 1000, fgQty: 400, dispatched: 100, price: 25, value: 10000, moving: true },
  { spec: 'A2', jobName: 'Pouch B', customer: 'Nandi', orders: 1, poQty: 500, fgQty: 200, dispatched: 0, price: 30, value: 6000, moving: false },
  { spec: 'A3', jobName: 'Pouch C', customer: 'Acme', orders: 1, poQty: 200, fgQty: 50, dispatched: 0, price: null, value: null, moving: true },
];
const ON_HAND = [
  { id: 1, code: 'BLM031', name: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '51',
    departmentName: 'Printing', closingStock: 100, uom: 'Kg', stockValue: 5000,
    byStatus: { MOVING: { qty: 60, value: 3000 }, REJECTED: { qty: 40, value: 2000 } } },
  { id: 2, code: 'INK099', name: 'Cyan', materialType: 'INK', subGroup: 'Flexo', specialtyName: '', microns: '',
    departmentName: 'Printing', closingStock: 10, uom: 'Kg', stockValue: 2000,
    byStatus: { MOVING: { qty: 10, value: 2000 } } },
];

let posted;
beforeEach(() => {
  posted = [];
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: PURCHASE }, save: vi.fn() }) }));
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET') !== 'GET') { posted.push({ u, method: opts.method, body: JSON.parse(opts.body || '{}') }); return res({}); }
    if (u.includes('/api/stores/rm-prices')) return res(RM);
    if (u.includes('/api/stores/fg')) return res(FG);
    if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
    if (u.includes('/api/stores/grns')) return res([]);
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

const statCard = (label) => [...document.querySelectorAll('.stats .stat')]
  .find((c) => c.querySelector('.sl').textContent.trim().startsWith(label));

describe('Super Admin — raw material price master', () => {
  async function mount() {
    const { RmPriceAdmin } = await import('../components/GrnAdmin.jsx');
    render(<RmPriceAdmin />);
    return screen.findByText('BLM031');
  }

  it('shows the speciality and who supplies each material', async () => {
    await mount();
    const row = screen.getByText('BLM031').closest('tr');
    expect(within(row).getByText('Surface')).toBeInTheDocument();
    expect(within(row).getByText('Cosmo Films, Jindal Poly')).toBeInTheDocument();
  });

  it('gives both totals — what the GRNs said, and what it is worth today', async () => {
    await mount();
    // BLM031: 100 @ 50 = 5,000 GRN, valued at 60 = 6,000. INK099: 2,000 either way.
    expect(within(statCard('GRN entry total')).getByText(/7,000/)).toBeInTheDocument();
    expect(within(statCard('Super Admin entry total')).getByText(/8,000/)).toBeInTheDocument();
    expect(within(statCard('Difference')).getByText(/1,000/)).toBeInTheDocument();
    expect(within(statCard('Super Admin entry total')).getByText(/1 material\(s\) priced/)).toBeInTheDocument();
  });

  it('values a material with no price of its own at what its GRN said', async () => {
    await mount();
    const row = screen.getByText('INK099').closest('tr');
    // GRN value and valued-at agree when nothing has been priced
    expect(within(row).getAllByText(/2,000/).length).toBe(2);
  });

  it('saves a price as on today without touching the receipts', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('New price for INK099'), { target: { value: '210' } });
    fireEvent.click(screen.getByLabelText('Save price for INK099'));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].u).toContain('/api/stores/items/2/price');
    expect(String(posted[0].body.price)).toBe('210');
    // the GRN price column is untouched — it is not something this screen writes
    expect(within(screen.getByText('INK099').closest('tr')).getByText('₹200')).toBeInTheDocument();
  });

  it('lets a blank clear the valuation back to the GRN price', async () => {
    await mount();
    // BLM031 already has one; emptying the box and saving drops it
    fireEvent.change(screen.getByLabelText('New price for BLM031'), { target: { value: '' } });
    expect(screen.getByLabelText('Save price for BLM031')).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText('Save price for BLM031'));
    await waitFor(() => expect(posted.length).toBe(1));
  });
});

describe('Stores — FG moving / non-moving', () => {
  async function mount() {
    const { default: Stores } = await import('../pages/Stores.jsx');
    render(<Stores />);
    fireEvent.click(await screen.findByText('✅ FG (finished)'));
    return screen.findByText('A1');
  }

  it('splits the money between moving and non-moving', async () => {
    await mount();
    expect(within(statCard('Money in moving FG')).getByText(/10,000/)).toBeInTheDocument();
    expect(within(statCard('Money in non-moving FG')).getByText(/6,000/)).toBeInTheDocument();
    // A3 has no sale price, so it is counted in neither and said so
    expect(screen.getByText(/1 spec\(s\) have no sale price/)).toBeInTheDocument();
  });

  it('filters the list to one or the other', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Filter by movement'), { target: { value: 'non' } });
    await waitFor(() => expect(screen.queryByText('A1')).toBeNull());
    expect(screen.getByText('A2')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by movement'), { target: { value: 'moving' } });
    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
    expect(screen.queryByText('A2')).toBeNull();
  });

  it('marks a spec non-moving from the line', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Movement for A1'), { target: { value: 'non' } });
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].u).toContain('/api/stores/fg/A1/movement');
    expect(posted[0].method).toBe('PUT');
    expect(posted[0].body).toEqual({ moving: false });
  });

  it('shows a spec with no sale price as having no value, not zero', async () => {
    await mount();
    const row = screen.getByText('A3').closest('tr');
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('Stores — Material on Hand, filtered by disposition', () => {
  async function mount() {
    const { default: Stores } = await import('../pages/Stores.jsx');
    render(<Stores />);
    return screen.findByText('BLM031');
  }

  it('offers the dispositions and keeps only the stock that has any', async () => {
    await mount();
    const f = screen.getByLabelText('Filter by status');
    expect(within(f).getByRole('option', { name: 'Rejected' })).toBeTruthy();

    fireEvent.change(f, { target: { value: 'REJECTED' } });
    // only BLM031 holds rejected stock
    await waitFor(() => expect(screen.queryByText('INK099')).toBeNull());
    expect(screen.getByText('BLM031')).toBeInTheDocument();
  });

  it('values only the stock of the chosen disposition', async () => {
    await mount();
    expect(within(statCard('Stock value')).getByText(/7,000/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'REJECTED' } });
    // 40 of BLM031 at 50 — not the item's whole 5,000
    await waitFor(() => expect(within(statCard('Value —')).getByText(/2,000/)).toBeInTheDocument());
  });
});

// A booked receipt drives the stock valuation, so correcting one stays with the
// Super Admin. The desk opens a receipt and reads all of it — offering it a button
// the server will refuse is worse than not offering one.
describe('Correcting a booked receipt is the Super Admin’s', () => {
  const GRNS = [{ id: 7, grnNo: 'GRN/2026/7', grnDate: '2026-09-04', poNum: '', supplier: 'Cosmo Films', invoiceNo: 'INV-1', invoiceDate: '2026-09-03', units: 1, actor: 'store1' }];
  const DETAIL = { ...GRNS[0], units: [{ id: 11, itemId: 1, internalCode: 'BLMU-1', qtyReceived: 100, qtyRemaining: 100, uom: 'Kg', location: 'A2', price: 50 }] };

  function install(role) {
    vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ role, user: role }) }));
    vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: PURCHASE }, save: vi.fn() }) }));
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      if ((opts.method || 'GET') !== 'GET') { posted.push({ u, method: opts.method, body: JSON.parse(opts.body || '{}') }); return res({}); }
      if (u.includes('/api/stores/grns/7')) return res(DETAIL);
      if (u.includes('/api/stores/grns')) return res(GRNS);
      if (u.includes('/api/master/items')) return res([{ id: 1, code: 'BLM031', name: '460 MM', uom: 'Kg' }]);
      return res([]);
    });
  }

  async function openReceipt() {
    const { default: Stores } = await import('../pages/Stores.jsx');
    render(<Stores />);
    fireEvent.click(await screen.findByText('📥 GRN'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open GRN GRN/2026/7' }));
  }

  it('offers the stores desk no Edit button, and says where corrections are made', async () => {
    install('stores');
    await openReceipt();
    expect(await screen.findByText(/ask the Super Admin/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit GRN/2026/7')).toBeNull();
  });

  it('offers it to the Super Admin', async () => {
    install('superadmin');
    await openReceipt();
    expect(await screen.findByLabelText('Edit GRN/2026/7')).toBeInTheDocument();
    expect(screen.queryByText(/ask the Super Admin/)).toBeNull();
  });
});
