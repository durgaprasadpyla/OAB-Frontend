import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import FGLedger from '../pages/FGLedger.jsx';
import NewPO from '../pages/NewPO.jsx';
import DailyUpdate from '../pages/DailyUpdate.jsx';
import QC from '../pages/QC.jsx';

const fieldByLabel = (re) => {
  const lbl = screen.getByText(re);
  return (lbl.closest('.fg') || lbl.parentElement).querySelector('input, textarea, select');
};

const jss = [{ spec: 'A1', customer: 'Acme', jobName: 'Pouch A', jobType: 'StayFresh', dispatchForm: 'pouch', width: 100, height: 200, gsm: 50, filmWidth: 300, mic: '40', material: 'BOPP', status: 'Active' }];
const prices = { A1: { price: 75, costPrice: 60, transport: 'At Actuals' } };
const customers = [{ customer: 'Acme', dispatchLoc: 'Hyderabad', warehouseName: '', billingAddr: 'Plot 1', gstin: '36ABCDE1234F1Z5', contactPerson: 'Ravi', contactPhone: '9000000000' }];

// A ledger with 5000 produced for spec A1 (nothing allocated yet).
const ledgerA1 = () => ({ A1: { prod: [{ date: '2026-08-01', qty: 5000, ts: 1, id: 'p1', note: '' }], alloc: [] } });

describe('FG Entry — record production', () => {
  it('appends a dated production entry to module 9 (fgLedger)', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<FGLedger />, { modules: { jss, fgLedger: {} } });
    await screen.findByText(/FG Entry/);

    // The spec picker is a type-to-search combobox now (matching production),
    // so type the spec rather than selecting an option.
    await user.type(screen.getByLabelText('JSS / Spec #'), 'A1');
    await user.type(fieldByLabel(/FG Produced on this date/), '20000');
    await user.click(screen.getByRole('button', { name: /Add Production/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 9)).toBe(true));
    const led = saved.find((s) => s.id === 9).data;
    expect(led.A1.prod).toHaveLength(1);
    expect(led.A1.prod[0].qty).toBe(20000);
    // The screen shows the new Available total.
    expect(screen.getAllByText(/20,000/).length).toBeGreaterThan(0);
  });
});

describe('New PO — FG drawdown prompt', () => {
  it('offers existing FG for a new SO and records an allocation + sets row.fg', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<NewPO />, {
      modules: { jss, prices, customers, oab: oabModule({ lastSO: { y: '26', n: 400 } }), fgLedger: ledgerA1() },
    });
    await screen.findByText('New PO Entry');

    await user.type(fieldByLabel(/PO Number/), 'PO-100');
    await user.selectOptions(screen.getByLabelText('Customer'), 'Acme');
    await user.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));

    const checks = screen.getAllByRole('checkbox');
    await user.click(checks[checks.length - 1]);
    await user.type(screen.getByRole('spinbutton'), '500');
    await user.click(screen.getByRole('button', { name: /Review →/ }));

    expect(await screen.findByText('26/401')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add to OAB/ }));

    // The drawdown modal appears because A1 has 5000 available. Step 4 has no
    // inputs, so the modal's FG field is the only spinbutton on screen.
    await screen.findByText(/Use existing Finished Goods/);
    await user.type(screen.getByRole('spinbutton'), '300');
    await user.click(screen.getByRole('button', { name: /✓ Use FG/ }));

    // The ledger recorded a 'new-po' allocation for the created SO...
    await waitFor(() => expect(saved.some((s) => s.id === 9)).toBe(true));
    const led = saved.find((s) => s.id === 9).data;
    expect(led.A1.alloc.at(-1)).toMatchObject({ qty: 300, so: '26/401', src: 'new-po' });
    // ...and the SO row's fg was set via the dispatch endpoint.
    expect(saved.some((s) => s.endpoint === '/api/oab-rows/dispatch' && s.body && s.body.so === '26/401' && Number(s.body.fg) === 300)).toBe(true);
  });
});

describe('Daily Update — FG pool tracking', () => {
  it('records a daily-update allocation for a tracked spec when FG is increased', async () => {
    const user = userEvent.setup();
    const oab = oabModule({ SF: [{ so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', jobType: 'StayFresh', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0 }] });
    const { saved } = renderApp(<DailyUpdate />, { modules: { jss, prices, oab, prodStatus: { '26/1': 'Ready' }, fgLedger: ledgerA1() } });
    await screen.findByText('26/1');

    const numberInputs = screen.getAllByRole('spinbutton');   // [ +Man Qty, Set FG ]
    await user.type(numberInputs[1], '300');                  // Set FG
    await user.click(screen.getByRole('button', { name: /Save All Changes/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 9)).toBe(true));
    const led = saved.find((s) => s.id === 9).data;
    expect(led.A1.alloc.at(-1)).toMatchObject({ qty: 300, so: '26/1', src: 'daily-update' });
  });

  it('does NOT touch the ledger for an untracked spec (preserves free Set-FG behaviour)', async () => {
    const user = userEvent.setup();
    const oab = oabModule({ SF: [{ so: '26/2', spec: 'Z9', customer: 'Acme', jobName: 'Untracked', jobType: 'StayFresh', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0 }] });
    const { saved } = renderApp(<DailyUpdate />, { modules: { jss, prices, oab, prodStatus: { '26/2': 'Ready' }, fgLedger: {} } });
    await screen.findByText('26/2');

    const numberInputs = screen.getAllByRole('spinbutton');
    await user.type(numberInputs[1], '300');                  // Set FG on an untracked spec
    await user.click(screen.getByRole('button', { name: /Save All Changes/ }));

    await waitFor(() => expect(saved.some((s) => s.endpoint === '/api/oab-rows/dispatch')).toBe(true));
    expect(saved.some((s) => s.id === 9)).toBe(false);        // no ledger write
  });
});

describe('QC CAPA register', () => {
  it('adds a CAPA record to module 11', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<QC />, { modules: { jss, capa: [] }, role: 'qc' });
    // CAPA now lives on its own QC tab, alongside Spec Entry and Certificates.
    await user.click(await screen.findByText(/CAPA/));
    await screen.findByText(/QC CAPA/);

    // Scope to the CAPA card in case another card gains a "Customer" field.
    await user.click(screen.getByRole('button', { name: /\+ New CAPA/ }));
    const capaCard = screen.getByText(/QC CAPA/).closest('.card');
    await user.type(within(capaCard).getByText(/^Customer$/).closest('.fg').querySelector('input'), 'Acme');
    await user.type(within(capaCard).getByText(/^Complaint$/).closest('.fg').querySelector('textarea'), 'Seal leak on pouch');
    await user.click(within(capaCard).getByRole('button', { name: /Add CAPA/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 11)).toBe(true));
    const capa = saved.find((s) => s.id === 11).data;
    expect(capa).toHaveLength(1);
    expect(capa[0]).toMatchObject({ customer: 'Acme', complaint: 'Seal leak on pouch', status: 'Open' });
    expect(capa[0].no).toMatch(/^CAPA-\d{4}$/);
  });
});
