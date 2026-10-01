import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import Purchase from '../pages/Purchase.jsx';
import QC from '../pages/QC.jsx';
import Scrap from '../pages/Scrap.jsx';
import Plant from '../pages/Plant.jsx';

const fieldByLabel = (label) => {
  const lbl = screen.getByText(label);
  return (lbl.closest('.fg') || lbl.parentElement).querySelector('input, textarea, select');
};
const jss = [{ spec: 'A1', customer: 'Acme', jobName: 'Pouch A', dispatchForm: 'pouch', width: 100, status: 'Active' }];
// JSS+QC 24.09: QC picks the customer, the material, its speciality, micron and the
// film width from masters — it types only the Job Name. So the customer has to be in
// the Customer Master and the film in the Item Master for a spec to be creatable.
const customers = [{ customer: 'NewCust', group: '', dispatchLoc: 'Hyderabad' }];
const masterItems = [
  { code: 'BLM1', name: '600 MM', materialType: 'FILM', subGroup: 'BOPP', specialtyName: 'PLAIN', microns: '50', widthMm: 600, uom: 'Kg' },
  { code: 'BLM2', name: '700 MM', materialType: 'FILM', subGroup: 'BOPP', specialtyName: 'PLAIN', microns: '50', widthMm: 700, uom: 'Kg' },
];

describe('Purchase — Generate PO flow', () => {
  it('raises a PO into module 6 with a price-history entry and bumped counter', async () => {
    const user = userEvent.setup();
    const purchase = { asl: [{ company: 'Sup1', itemCode: 'BLM001', specificMaterial: 'BOPP Film', materialType: 'FILM', subGroup: 'AF BOPP', uom: 'Kg', basicPrice: 100, paymentTerms: '30 days', status: 'Active' }], pos: [], priceHistory: [], counter: 0, itemsExtra: [] };
    const { saved } = renderApp(<Purchase />, { modules: { purchase }, role: 'purchase', user: 'purchase' });
    await screen.findByText(/Generate Purchase Order/);

    await user.selectOptions(fieldByLabel('Supplier'), 'Sup1');
    // 29.09: the item is PICKED by code; description, material, UOM and the
     // supplier's price are read back from the master rather than typed.
    await user.selectOptions(screen.getByLabelText('Item code line 1'), 'BLM001');
    const nums = screen.getAllByRole('spinbutton'); // [GST%, qty, rate]
    await user.type(nums[1], '50');
    await user.click(screen.getByRole('button', { name: /Create PO/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 6)).toBe(true));
    expect(saved.find((s) => s.id === 6).endpoint).toBe('/api/purchase-orders'); // granular endpoint
    const mod = saved.find((s) => s.id === 6).data;
    expect(mod.pos).toHaveLength(1);
    expect(mod.pos[0].supplier).toBe('Sup1');
    expect(mod.pos[0].items[0]).toMatchObject({ item: 'BOPP Film', qty: 50, rate: 100, amount: 5000, receivedQty: 0 });
    expect(mod.pos[0].status).toBe('Open');
    expect(mod.pos[0].poNum).toMatch(/^BLM\/PUR\/\d{4}-\d{4}\/1$/);
    expect(mod.counter).toBe(1);
    expect(mod.priceHistory.length).toBeGreaterThan(0);
    // 30.09 §PU1: the line keeps its item code, and the new PO opens in the preview
    expect(mod.pos[0].items[0].itemCode).toBe('BLM001');
    expect(await screen.findByRole('dialog', { name: /Purchase Order BLM\/PUR\/2026-2027\/1/ })).toBeInTheDocument();
  });
});

describe('QC — add spec flow', () => {
  it('appends a new auto-numbered spec to module 2', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<QC />, { modules: { jss, customers, masterItems }, role: 'qc' });
    await screen.findByText(/Add New Spec/);

    await user.selectOptions(await screen.findByLabelText('Customer'), 'NewCust');
    await user.type(screen.getByLabelText('Job Name'), 'New Job');
    await user.selectOptions(screen.getByLabelText('Dispatch Form'), 'Pouch');
    await user.selectOptions(screen.getByLabelText('Job Type'), 'SF Pouch');
    // the material, its speciality and micron all come from the Item Master
    await user.selectOptions(await screen.findByLabelText('Primary Material'), 'BOPP');
    await user.selectOptions(screen.getByLabelText('Primary Speciality'), 'PLAIN');
    await user.selectOptions(screen.getByLabelText('Primary Micron'), '50');
    await user.selectOptions(screen.getByLabelText('Film Width (mm)'), '700');
    await user.click(screen.getByRole('button', { name: /Add Spec/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 2)).toBe(true));
    const arr = saved.find((s) => s.id === 2).data;
    expect(arr).toHaveLength(2);
    expect(arr.at(-1)).toMatchObject({
      spec: 'A2', customer: 'NewCust', jobName: 'New Job', jobType: 'SF Pouch',
      material: 'BOPP', material1: 'BOPP', specialty1: 'PLAIN', microns1: '50', mic: '50', filmWidth: 700,
    });
  });
});

describe('Scrap — add buyer flow', () => {
  it('adds a buyer with a padded id to module 8', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<Scrap />, { modules: { scrap: { buyers: [], items: [], prices: [], txns: [] } }, role: 'scrap' });
    await screen.findByText(/Add Scrap Buyer/);

    await user.type(fieldByLabel('Buyer Name *'), 'BuyerX');
    await user.click(screen.getByRole('button', { name: /Add Buyer/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 8)).toBe(true));
    const mod = saved.find((s) => s.id === 8).data;
    expect(mod.buyers).toHaveLength(1);
    expect(mod.buyers[0]).toMatchObject({ id: 'SB001', name: 'BuyerX' });
  });
});

describe('Plant — production status flow', () => {
  it('saves a not-ready status into module 5', async () => {
    const user = userEvent.setup();
    const oab = oabModule({ SF: [{ so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0 }] });
    const { saved } = renderApp(<Plant />, { modules: { jss, oab, prodStatus: {} }, role: 'plant' });
    await screen.findByText('26/1');

    // [sheet picker, prod status, stage] — production shows one sheet at a time.
    await user.selectOptions(screen.getByLabelText('Prod status for 26/1'), 'NR-Plates');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(saved.some((s) => s.id === 5)).toBe(true));
    expect(saved.find((s) => s.id === 5).data['26/1']).toBe('NR-Plates');
  });
});
