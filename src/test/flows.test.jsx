import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import NewPO from '../pages/NewPO.jsx';
import DailyUpdate from '../pages/DailyUpdate.jsx';
import Invoice from '../pages/Invoice.jsx';

const fieldByLabel = (re) => {
  const lbl = screen.getByText(re);
  return (lbl.closest('.fg') || lbl.parentElement).querySelector('input, textarea, select');
};
const inputAfterText = (re) => screen.getByText(re).parentElement.querySelector('input');

const jss = [{ spec: 'A1', customer: 'Acme', jobName: 'Pouch A', jobType: 'StayFresh', dispatchForm: 'pouch', width: 100, height: 200, gsm: 50, filmWidth: 300, mic: '40', material: 'BOPP', status: 'Active' }];
const prices = { A1: { price: 75, costPrice: 60, transport: 'At Actuals' } };
const customers = [{ customer: 'Acme', dispatchLoc: 'Hyderabad', warehouseName: '', billingAddr: 'Plot 1', gstin: '36ABCDE1234F1Z5', contactPerson: 'Ravi', contactPhone: '9000000000' }];

describe('New PO flow', () => {
  it('creates an SO into module 1 with the next SO number', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<NewPO />, { modules: { jss, prices, customers, oab: oabModule({ lastSO: { y: '26', n: 400 } }) } });
    await screen.findByText('New PO / Enter SO');

    await user.type(fieldByLabel('PO Number'), 'PO-100');
    await user.selectOptions(fieldByLabel('Customer'), 'Acme');   // auto-selects the single dispatch location
    await user.click(screen.getByRole('button', { name: /Next → Select SKUs/ }));

    const checks = screen.getAllByRole('checkbox');
    await user.click(checks[checks.length - 1]);                  // the SKU row (last checkbox)
    await user.type(screen.getByRole('spinbutton'), '500');       // PO qty
    await user.click(screen.getByRole('button', { name: /Next → Confirm/ }));

    expect(await screen.findByText('26/401')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Create 1 SO/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 1)).toBe(true));
    const mod = saved.find((s) => s.id === 1).data;
    const row = mod.OAB.SF.find((r) => r.so === '26/401');
    expect(row).toBeTruthy();
    expect(row.poQty).toBe(500);
    expect(row.customer).toBe('Acme');
    expect(row.poNum).toBe('PO-100');
    expect(mod.lastSO.n).toBe(401);
  });
});

describe('Daily Update flow', () => {
  it('adds a manual dispatch to the running total with a log entry', async () => {
    const user = userEvent.setup();
    const oab = oabModule({ SF: [{ so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', jobType: 'StayFresh', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0 }] });
    const { saved } = renderApp(<DailyUpdate />, { modules: { jss, prices, oab, prodStatus: { '26/1': 'Ready' } } });
    await screen.findByText('26/1');

    const numberInputs = screen.getAllByRole('spinbutton');   // [ +Man Qty, Set FG ]
    await user.type(numberInputs[0], '200');
    await user.type(screen.getByPlaceholderText('Inv / DC #'), 'INV5');
    await user.click(screen.getByRole('button', { name: /Save All Changes/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 1)).toBe(true));
    const row = saved.find((s) => s.id === 1).data.OAB.SF[0];
    expect(row.manDisp).toBe(200);
    expect(row.manDispLog.at(-1)).toMatchObject({ invNo: 'INV5', qty: 200 });
  });
});

describe('Daily Update — manual dispatch breakdown', () => {
  it('opens a popup listing each logged dispatch (date, Inv/DC #, qty)', async () => {
    const user = userEvent.setup();
    const oab = oabModule({ SF: [{ so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', jobType: 'StayFresh', poQty: 1000, invDisp: 0, manDisp: 8, fg: 0, manDispLog: [{ date: '2026-07-10', invNo: 'D1', qty: 3 }, { date: '2026-07-12', invNo: 'D2', qty: 5 }] }] });
    renderApp(<DailyUpdate />, { modules: { jss, prices, oab, prodStatus: { '26/1': 'Ready' } } });
    await screen.findByText('26/1');

    await user.click(screen.getByRole('button', { name: /\(2\)/ }));   // the "8 (2)" cell

    expect(await screen.findByText(/Manual dispatches/)).toBeInTheDocument();
    expect(screen.getByText('D1')).toBeInTheDocument();
    expect(screen.getByText('D2')).toBeInTheDocument();
    expect(screen.getByText(/Total dispatched/)).toBeInTheDocument();
  });
});

describe('Invoice flow', () => {
  it('generates a tax invoice and confirms it into OAB + register', async () => {
    const user = userEvent.setup();
    const oab = oabModule({ SF: [{ so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', jobType: 'StayFresh', dispLoc: 'Hyderabad', poNum: 'PO1', poDate: '2026-07-01', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, dispatchForm: 'pouch', width: 100 }], lastInvNo: 222 });
    const { saved } = renderApp(<Invoice />, { modules: { jss, prices, customers, oab } });
    await screen.findByText('Invoice');

    await user.selectOptions(fieldByLabel(/PO Number/), 'PO1');   // fills consignee + place of supply + SKU list
    await user.type(fieldByLabel(/Transporter Name/), 'TransCo');
    await user.click(screen.getByRole('checkbox'));               // the single SKU
    await user.type(inputAfterText(/Invoice Qty/), '200');        // rate pre-fills to 75
    await user.click(screen.getByRole('button', { name: /Generate Invoice/ }));

    // A4 doc: 200 × 75 = 15000 taxable, +18% GST = 17,700 total.
    expect(await screen.findByText('TAX INVOICE')).toBeInTheDocument();
    expect(screen.getAllByText(/17,700/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Confirm & Update OAB/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 1)).toBe(true));
    const mod = saved.find((s) => s.id === 1).data;
    expect(mod.INV_REG[0]).toMatchObject({ qty: 200, amount: 15000, po: 'PO1' });
    expect(mod.INV_REG[0].items[0]).toMatchObject({ spec: 'A1', rate: 75, qty: 200 });
    expect(mod.OAB.SF[0].invDisp).toBe(200);
  });
});
