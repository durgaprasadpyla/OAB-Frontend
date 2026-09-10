import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// The Projections page end to end: entering one, reading a month back, and the
// material it implies. The arithmetic itself is covered in projections.test.js —
// this is about the screen doing what the client described.

vi.mock('../lib/xlsx.js', () => ({ exportAOA: vi.fn(), exportObjects: vi.fn(), readSheet: vi.fn(async () => []) }));
vi.mock('../lib/pdf.js', () => ({ elementToPDF: vi.fn(async () => {}), printElement: vi.fn() }));

const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const JSS = [
  { spec: 'A1', customer: 'Amazon', jobName: 'Pouch A' },
  { spec: 'A2', customer: 'Nandi', jobName: 'Pouch B' },
];
const CUSTOMERS = [
  { customer: 'Amazon', dispatchLoc: 'Chennai' },
  { customer: 'Amazon', dispatchLoc: 'Hosur' },
];
const SALES = {
  leads: [{ id: 'L1', client_name: 'New Co' }],
  sales_users: [{ id: 'u1', display_name: 'Ravi', username: 'ravi' },
                { id: 'u2', display_name: 'Asha', username: 'asha' },
                { id: 'u3', display_name: 'Gone', username: 'gone', disabled: true }],
};
const OAB = {
  OAB: {
    SF: [
      { so: '26/701', spec: 'A1', customer: 'Amazon', jobName: 'Pouch A', dispLoc: 'Chennai', poQty: 400, poNum: 'PO-1', poDate: '2026-10-03' },
      { so: '26/704', spec: 'A9', customer: 'Walkaway', jobName: 'Pouch Z', dispLoc: '', poQty: 90, poNum: 'PO-4', poDate: '2026-10-28' },
    ],
    OT: [],
  },
};
// BLM064 at 0.02 per unit of A1
const BOM_API = [{
  specCode: 'A1', baseQty: 100, baseUom: 'Nos',
  items: [{ itemCode: 'BLM064', itemName: '635 MM', materialType: 'FILM', uom: 'Kg', qtyPerBase: 2 }],
}];

const EXISTING = {
  entries: [
    { id: 'p1', source: 'customer', month: '2026-10', spec: 'A1', customer: 'Amazon',
      jobName: 'Pouch A', dispLoc: '', qty: 1000, marketer: 'Ravi', note: '' },
    { id: 'p2', source: 'lead', month: '2026-10', spec: '', customer: 'New Co',
      jobName: 'Trial pouch', leadId: 'L1', dispLoc: '', qty: 300, marketer: 'Asha', note: '' },
  ],
};

let saved;
function mountWith(projections, role = 'superadmin') {
  saved = [];
  vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ user: 'boss', role }) }));
  vi.doMock('../data.jsx', () => ({
    useData: () => ({
      mods: { projections, jss: JSS, customers: CUSTOMERS, sales: SALES, oab: OAB, bom: {} },
      save: async (key, next) => { saved.push({ key, next }); },
    }),
  }));
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => (String(url).includes('/api/bom') ? res(BOM_API) : res([])));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

async function page() {
  const { default: Projections } = await import('../pages/Projections.jsx');
  render(<Projections />);
  return screen.findByText('📈 Future Projections');
}
const set = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('Projections — entering one', () => {
  it('fills the customer and SKU from the JSS number', async () => {
    mountWith({ entries: [] });
    await page();
    set('JSS number', 'A1');
    await waitFor(() => expect(screen.getByLabelText('Customer').value).toBe('Amazon'));
    expect(screen.getByLabelText('SKU').value).toBe('Pouch A');
    // and they are read-only — the spec owns them
    expect(screen.getByLabelText('Customer')).toHaveAttribute('readonly');
  });

  it('offers that customer’s dispatch locations, defaulting to all of them', async () => {
    mountWith({ entries: [] });
    await page();
    set('JSS number', 'A1');
    const loc = await screen.findByLabelText('Dispatch location');
    await waitFor(() => expect([...loc.options].map((o) => o.value)).toEqual(['', 'Chennai', 'Hosur']));
    expect(loc.value).toBe('');
    expect(screen.getByText(/covers every dispatch location/)).toBeInTheDocument();
  });

  it('offers the marketing people, and not a disabled one', async () => {
    mountWith({ entries: [] });
    await page();
    const m = screen.getByLabelText('Marketing person');
    expect([...m.options].map((o) => o.value)).toEqual(['', 'Asha', 'Ravi']);
  });

  it('saves a customer projection against the month', async () => {
    mountWith({ entries: [] });
    await page();
    set('JSS number', 'A1');
    set('Month', '2026-11');
    set('Quantity', '1500');
    set('Marketing person', 'Ravi');
    fireEvent.click(screen.getByText('＋ Add projection'));

    await waitFor(() => expect(saved).toHaveLength(1));
    const e = saved[0].next.entries[0];
    expect(saved[0].key).toBe('projections');
    expect(e).toMatchObject({ source: 'customer', spec: 'A1', customer: 'Amazon', jobName: 'Pouch A', month: '2026-11', qty: 1500, marketer: 'Ravi' });
    expect(e.createdBy).toBe('boss');
  });

  it('switches to a lead and takes a typed customer and SKU instead', async () => {
    mountWith({ entries: [] });
    await page();
    set('Projection source', 'lead');
    await waitFor(() => expect(screen.getByLabelText('Lead')).toBeInTheDocument());
    set('Lead', 'L1');
    await waitFor(() => expect(screen.getByLabelText('Customer').value).toBe('New Co'));
    set('SKU', 'Trial pouch');
    set('Quantity', '250');
    set('Marketing person', 'Asha');
    expect(screen.getByText('Tentative quantity *')).toBeInTheDocument();

    fireEvent.click(screen.getByText('＋ Add projection'));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].next.entries[0]).toMatchObject({ source: 'lead', spec: '', customer: 'New Co', jobName: 'Trial pouch', qty: 250 });
  });

  it('says what is missing rather than saving half a projection', async () => {
    mountWith({ entries: [] });
    await page();
    fireEvent.click(screen.getByText('＋ Add projection'));
    await waitFor(() => expect(screen.getByText(/Choose the JSS number/)).toBeInTheDocument());
    expect(saved).toHaveLength(0);
  });
});

describe('Projections — reading a month back', () => {
  it('lists the month with what has come in against it', async () => {
    mountWith(EXISTING);
    await page();
    const row = (await screen.findByLabelText('Open October 2026')).closest('tr');
    expect(within(row).getByText('1,300')).toBeInTheDocument();   // 1000 + 300 projected
    expect(within(row).getByText('400')).toBeInTheDocument();     // PO-1 against A1
    expect(within(row).getByText('900')).toBeInTheDocument();     // still to come
    expect(within(row).getByText('90')).toBeInTheDocument();      // the unprojected order
  });

  it('opens the month grouped by client, showing the orders that matched', async () => {
    mountWith(EXISTING);
    await page();
    fireEvent.click(await screen.findByLabelText('Open October 2026'));

    await waitFor(() => expect(screen.getByText('Projections for October 2026')).toBeInTheDocument());
    const amazon = screen.getByText('Pouch A').closest('tr');
    expect(within(amazon).getByText('26/701')).toBeInTheDocument();
    expect(within(amazon).getByText('all locations')).toBeInTheDocument();
    expect(within(amazon).getByText('Ravi')).toBeInTheDocument();
    // the lead-sourced one is marked as such
    expect(within(screen.getByText('Trial pouch').closest('tr')).getByText('lead')).toBeInTheDocument();
  });

  it('names the orders nobody projected instead of dropping them', async () => {
    mountWith(EXISTING);
    await page();
    fireEvent.click(await screen.findByLabelText('Open October 2026'));
    await waitFor(() => expect(screen.getByText(/1 order\(s\) arrived that nobody projected/)).toBeInTheDocument());
    expect(screen.getByText(/Walkaway/)).toBeInTheDocument();
  });

  it('totals the film from the BOM, on what is still to come', async () => {
    mountWith(EXISTING);
    await page();
    fireEvent.click(await screen.findByLabelText('Open October 2026'));
    // A1 remaining is 600; BOM is 2 per 100 → 12 Kg
    await waitFor(() => expect(screen.getByText('BLM064')).toBeInTheDocument());
    const line = screen.getByText('BLM064').closest('tr');
    expect(within(line).getByText('12')).toBeInTheDocument();

    // and the whole month as projected: 1000 → 20 Kg
    set('Requirement basis', 'projected');
    await waitFor(() => expect(within(screen.getByText('BLM064').closest('tr')).getByText('20')).toBeInTheDocument());
  });

  it('says which projections it could not cost, and why', async () => {
    mountWith(EXISTING);
    await page();
    fireEvent.click(await screen.findByLabelText('Open October 2026'));
    await waitFor(() => expect(screen.getByText(/could not be costed/)).toBeInTheDocument());
    expect(screen.getByText(/from a lead — no JSS number yet/)).toBeInTheDocument();
  });

  it('draws projected against actual once there is more than one month', async () => {
    mountWith(EXISTING);
    await page();
    await waitFor(() => expect(screen.getByLabelText('Projected against actual quantity by month')).toBeInTheDocument());
  });
});

describe('Projections — who may write', () => {
  it('lets a planner read the months but not enter one', async () => {
    mountWith(EXISTING, 'ppc');
    await page();
    await screen.findByText('October 2026');
    expect(screen.queryByText('＋ Add projection')).toBeNull();
    expect(screen.queryByLabelText('JSS number')).toBeNull();
  });

  it('lets the sales admin enter one', async () => {
    mountWith(EXISTING, 'sadmin');
    await page();
    expect(await screen.findByText('＋ Add projection')).toBeInTheDocument();
  });
});
