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

describe('Purchase — Generate PO flow', () => {
  it('raises a PO into module 6 with a price-history entry and bumped counter', async () => {
    const user = userEvent.setup();
    const purchase = { asl: [{ company: 'Sup1', specificMaterial: 'BOPP Film', uom: 'Kg', basicPrice: 100, paymentTerms: '30 days', status: 'Active' }], pos: [], priceHistory: [], counter: 0, itemsExtra: [] };
    const { saved } = renderApp(<Purchase />, { modules: { purchase }, role: 'purchase', user: 'purchase' });
    await screen.findByText(/Generate Purchase Order/);

    await user.selectOptions(fieldByLabel('Supplier'), 'Sup1');
    await user.type(screen.getByPlaceholderText('Item / material'), 'BOPP Film'); // auto-fills unit + rate 100
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
  });
});

describe('QC — add spec flow', () => {
  it('appends a new auto-numbered spec to module 2', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<QC />, { modules: { jss }, role: 'qc' });
    await screen.findByText(/Add New Spec/);

    await user.type(fieldByLabel('Customer *'), 'NewCust');
    await user.type(fieldByLabel('Job Name *'), 'New Job');
    await user.click(screen.getByRole('button', { name: /Add Spec/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 2)).toBe(true));
    const arr = saved.find((s) => s.id === 2).data;
    expect(arr).toHaveLength(2);
    expect(arr.at(-1)).toMatchObject({ spec: 'A2', customer: 'NewCust', jobName: 'New Job' });
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

    const combos = screen.getAllByRole('combobox'); // [prod status, stage]
    await user.selectOptions(combos[0], 'NR-Plates');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saved.some((s) => s.id === 5)).toBe(true));
    expect(saved.find((s) => s.id === 5).data['26/1']).toBe('NR-Plates');
  });
});
