import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// The Projections page end to end: entering one, reading a month back, and the
// material it implies. The arithmetic itself is covered in projections.test.js —
// this is about the screen doing what the client described.

vi.mock('../lib/xlsx.js', () => ({ exportAOA: vi.fn(), exportObjects: vi.fn(), readSheet: vi.fn(async () => []) }));
vi.mock('../lib/pdf.js', () => ({ elementToPDF: vi.fn(async () => {}), printElement: vi.fn() }));

const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const JSS = [
  { spec: 'A1', customer: 'Amazon', jobName: 'Pouch A', subBrand: 'Fresh' },
  { spec: 'A2', customer: 'Nandi', jobName: 'Pouch B' },
  { spec: 'A3', customer: 'Nandi', jobName: 'Pouch C', group: 'Nandi Group' },
  { spec: 'A4', customer: 'Nandi Foods', jobName: 'Pouch D', group: 'Nandi Group' },
  // retired — must not be offered for a new projection
  { spec: 'A5', customer: 'Nandi Foods', jobName: 'Pouch E (old)', group: 'Nandi Group', status: 'Inactive' },
  // a group with no customer name at all, the way the Amazon specs are kept
  { spec: 'A6', customer: '', group: 'AMAZON', jobName: 'Polybag 500', subBrand: 'Amazon Fresh' },
];
const PRICES = { A1: { price: 3, costPrice: 2 }, A6: { price: 2, costPrice: 1 } };
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
    { id: 'p3', source: 'customer', month: '2026-10', spec: 'A6', customer: '',
      jobName: 'Polybag 500', dispLoc: '', qty: 2000, marketer: 'Asha', note: '' },
  ],
};

let saved;
function mountWith(projections, role = 'superadmin') {
  saved = [];
  vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ user: 'boss', role }) }));
  vi.doMock('../data.jsx', () => ({
    useData: () => ({
      mods: { projections, jss: JSS, customers: CUSTOMERS, sales: SALES, oab: OAB, bom: {}, prices: PRICES },
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
// the Group / Customer / JSS / Marketing filter bar sits on the order-value card AND
// on the opened month, bound to ONE state — so setting the first is setting both
const setFilter = (label, value) => fireEvent.change(screen.getAllByLabelText(label)[0], { target: { value } });

describe('Projections — entering one', () => {
  it('fills the customer and SKU from the JSS number', async () => {
    mountWith({ entries: [] });
    await page();
    set('JSS number', 'A1');
    await waitFor(() => expect(screen.getByLabelText('Customer').value).toBe('Amazon'));
    expect(screen.getByLabelText('SKU').value).toBe('Pouch A');
    // and the SKU is read-only — the spec owns it
    expect(screen.getByLabelText('SKU')).toHaveAttribute('readonly');
  });

  // "I would not know what the JSS number is for all 400 JSS that are there. Rather
  // if I select the group and customer, then the JSS will be limited from there."
  it('narrows the JSS list by group, then by customer, before the number is picked', async () => {
    mountWith({ entries: [] });
    await page();
    const options = () => [...document.getElementById('proj-specs').options].map((o) => o.value);
    // the Inactive A5 is not offered at all
    expect(options()).toEqual(['A1', 'A2', 'A3', 'A4', 'A6']);
    expect(screen.getByText('(5 to pick from)')).toBeInTheDocument();
    // each spec reads by its SUB-BRAND and job, not the customer already chosen above
    const labels = [...document.getElementById('proj-specs').options].map((o) => o.textContent);
    expect(labels[0]).toBe('Fresh — Pouch A');
    expect(labels[1]).toBe('(no sub-brand) — Pouch B');

    set('Group', 'Nandi Group');
    await waitFor(() => expect(options()).toEqual(['A3', 'A4']));
    // the customer list follows the group
    expect([...screen.getByLabelText('Customer').options].map((o) => o.value)).toEqual(['', 'Nandi', 'Nandi Foods']);

    set('Customer', 'Nandi Foods');
    await waitFor(() => expect(options()).toEqual(['A4']));   // A5 is Inactive
    expect(screen.getByText('(1 to pick from)')).toBeInTheDocument();

    set('JSS number', 'A4');
    set('Quantity', '100');
    set('Marketing person', 'Ravi');
    fireEvent.click(screen.getByText('＋ Add projection'));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].next.entries[0]).toMatchObject({ spec: 'A4', customer: 'Nandi Foods', jobName: 'Pouch D' });
  });

  it('fills the group and customer back in when the JSS number is typed first', async () => {
    mountWith({ entries: [] });
    await page();
    set('JSS number', 'A3');
    await waitFor(() => expect(screen.getByLabelText('Customer').value).toBe('Nandi'));
    expect(screen.getByLabelText('Group').value).toBe('Nandi Group');
    // changing the customer afterwards drops the spec, since it no longer belongs
    set('Customer', 'Nandi Foods');
    await waitFor(() => expect(screen.getByLabelText('JSS number').value).toBe(''));
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
    expect(within(row).getByText('3,300')).toBeInTheDocument();   // p1 1000 + p2 300 + p3 2000 projected
    expect(within(row).getByText('400')).toBeInTheDocument();     // PO-1 against A1
    expect(within(row).getByText('2,900')).toBeInTheDocument();     // still to come
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
    // the sub-brand and the order value (1000 × ₹3) sit on the row
    expect(within(amazon).getByText('Fresh')).toBeInTheDocument();
    expect(within(amazon).getByText('₹3,000')).toBeInTheDocument();
    // the lead-sourced one is marked as such, and has no price to value it by
    const lead = screen.getByText('Trial pouch').closest('tr');
    expect(within(lead).getByText('lead')).toBeInTheDocument();
    expect(within(lead).getByText('unpriced')).toBeInTheDocument();
    // a group-only spec heads its block by the GROUP, not "(unnamed)"
    expect(screen.getByLabelText('Party AMAZON')).toBeInTheDocument();
    expect(screen.queryByText(/unnamed/)).toBeNull();
  });

  it('narrows the opened month by group, customer, JSS or marketing person', async () => {
    mountWith(EXISTING);
    await page();
    fireEvent.click(await screen.findByLabelText('Open October 2026'));
    await screen.findByText('Projections for October 2026');
    expect(screen.getByText('Pouch A')).toBeInTheDocument();
    expect(screen.getByText('Polybag 500')).toBeInTheDocument();

    setFilter('Filter group', 'AMAZON');
    await waitFor(() => expect(screen.queryByText('Pouch A')).toBeNull());
    expect(screen.getByText('Polybag 500')).toBeInTheDocument();
    // both bars show the same choice
    expect(screen.getAllByLabelText('Filter group').map((e) => e.value)).toEqual(['AMAZON', 'AMAZON']);

    fireEvent.click(screen.getAllByText('✕ Clear')[0]);
    setFilter('Filter marketing person', 'Ravi');
    await waitFor(() => expect(screen.queryByText('Polybag 500')).toBeNull());
    expect(screen.getByText('Pouch A')).toBeInTheDocument();

    setFilter('Filter JSS', 'A6');
    await waitFor(() => expect(screen.getByText(/match the filter/)).toBeInTheDocument());
  });

  it('values the projections month by month, under the same filter', async () => {
    mountWith(EXISTING);
    await page();
    const table = await screen.findByLabelText('Projected order value');
    // October: A1 1000 × ₹3 + A6 2000 × ₹2 = ₹7,000; the lead is unpriced; A1 received 400 × ₹3
    const oct = within(table).getByText('October 2026').closest('tr');
    expect(within(oct).getByText('3')).toBeInTheDocument();          // projections
    expect(within(oct).getByText('₹7,000')).toBeInTheDocument();
    expect(within(oct).getByText('₹1,200')).toBeInTheDocument();     // received value
    expect(within(oct).getByText('1')).toBeInTheDocument();          // unpriced

    setFilter('Filter group', 'AMAZON');
    // A6 alone: 2000 × ₹2 projected, nothing received, all still to come
    await waitFor(() => expect([...within(table).getByText('October 2026').closest('tr').cells].map((c) => c.textContent))
      .toEqual(['October 2026', '1', '2,000', '₹4,000', '₹0', '₹4,000', '—']));
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
    // the JSS number is on the line, so the spec with no BOM can be found
    const noBom = screen.getByText(/no BOM saved for this spec/).closest('li');
    expect(within(noBom).getByText('A6')).toBeInTheDocument();
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
    await screen.findAllByText('October 2026');
    expect(screen.queryByText('＋ Add projection')).toBeNull();
    expect(screen.queryByLabelText('JSS number')).toBeNull();
  });

  it('lets the sales admin enter one', async () => {
    mountWith(EXISTING, 'sadmin');
    await page();
    expect(await screen.findByText('＋ Add projection')).toBeInTheDocument();
  });
});
