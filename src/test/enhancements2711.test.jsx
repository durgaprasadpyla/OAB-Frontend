import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import FGLedger from '../pages/FGLedger.jsx';
import Dispatches from '../pages/Dispatches.jsx';

// 27.11 Enhancements — the Superstar login split into single-purpose logins.

function daysAgo(d) {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}

// One StayFresh job and one other job, both with FG in stock.
const fgModules = {
  fgLedger: {
    SF1: { prod: [{ date: daysAgo(3), qty: 100, ts: 1 }], alloc: [] },
    OT1: { prod: [{ date: daysAgo(3), qty: 200, ts: 2 }], alloc: [] },
  },
  jss: [
    { spec: 'SF1', jobName: 'Fresh Pouch', customer: 'Acme', jobType: 'SF Pouch', status: 'Active' },
    { spec: 'OT1', jobName: 'Lami Pouch', customer: 'Beta', jobType: 'Lami Pouch', status: 'Active' },
  ],
};

const summaryCard = () => screen.getByText(/All Specs — FG Summary/).closest('.card');

describe('FG Entry — the StayFresh / Others split (U1 / U2 logins)', () => {
  it('U2 (StayFresh) sees only StayFresh jobs', async () => {
    renderApp(<FGLedger />, { modules: fgModules, role: 'u2' });
    await waitFor(() => expect(within(summaryCard()).getByText('SF1')).toBeInTheDocument());
    expect(within(summaryCard()).queryByText('OT1')).not.toBeInTheDocument();
    // the heading says which jobs this login owns, and there is no money (costing none)
    expect(screen.getByText('StayFresh jobs')).toBeInTheDocument();
    expect(screen.queryByText('Money in moving FG')).toBeNull();
  });

  it('U1 (Others) sees every job except StayFresh', async () => {
    renderApp(<FGLedger />, { modules: fgModules, role: 'u1' });
    await waitFor(() => expect(within(summaryCard()).getByText('OT1')).toBeInTheDocument());
    expect(within(summaryCard()).queryByText('SF1')).not.toBeInTheDocument();
    expect(screen.getByText('Other jobs')).toBeInTheDocument();
  });

  it('the Super Admin keeps the full, unscoped sheet with money', async () => {
    renderApp(<FGLedger />, { modules: { ...fgModules, prices: { SF1: { price: 5 }, OT1: { price: 5 } } }, role: 'superadmin' });
    await waitFor(() => expect(within(summaryCard()).getByText('SF1')).toBeInTheDocument());
    expect(within(summaryCard()).getByText('OT1')).toBeInTheDocument();
    expect(screen.getByText('Money in moving FG')).toBeInTheDocument();
  });
});

describe('Dispatches — invoices arrive Not Opened and are opened here', () => {
  const seed = () => ({
    oab: oabModule({
      INV_REG: [
        { no: 'BL/26-27/1', date: '2026-11-20', po: 'PO1', customer: 'Acme', qty: 100, amount: 1000,
          items: [{ spec: 'A1', jobName: 'Pouch A', qty: 100, rate: 10 }], opened: false },
        { no: 'BL/26-27/2', date: '2026-11-21', po: 'PO2', customer: 'Beta', qty: 50, amount: 500,
          items: [{ spec: 'B1', jobName: 'Pouch B', qty: 50, rate: 10 }], opened: true, openedBy: 'disp' },
      ],
    }),
  });

  // The invoice number also appears on the rendered tax invoice, so scope row lookups
  // to the Dispatches list card.
  const listCard = () => screen.getByText(/Invoices to Dispatch/).closest('.card');
  const rowFor = (no) => within(listCard()).getByText(no).closest('tr');

  it('lists every invoice with its open / not-opened status', async () => {
    renderApp(<Dispatches />, { modules: seed(), role: 'dispatch' });
    await within(listCard()).findByText('BL/26-27/1');
    expect(within(rowFor('BL/26-27/1')).getByText(/Not Opened/)).toBeInTheDocument();
    expect(within(rowFor('BL/26-27/2')).getByText(/Opened/)).toBeInTheDocument();
    expect(screen.getByText('1 not opened')).toBeInTheDocument();
  });

  it('opening a Not-Opened invoice marks it Opened and shows the tax invoice', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<Dispatches />, { modules: seed(), role: 'dispatch' });
    await within(listCard()).findByText('BL/26-27/1');
    await user.click(within(rowFor('BL/26-27/1')).getByRole('button', { name: /Open BL\/26-27\/1/ }));

    // the tax invoice is shown …
    expect(await screen.findByText('TAX INVOICE')).toBeInTheDocument();
    // … the open was posted …
    expect(saved.some((x) => x.endpoint === '/api/invoices/open' && x.body.no === 'BL/26-27/1')).toBe(true);
    // … and the row now reads Opened.
    await waitFor(() => expect(within(rowFor('BL/26-27/1')).getByText(/✓ Opened/)).toBeInTheDocument());
  });

  it('a filter narrows to Not Opened only', async () => {
    renderApp(<Dispatches />, { modules: seed(), role: 'dispatch' });
    await within(listCard()).findByText('BL/26-27/1');
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'notopen');
    expect(within(listCard()).getByText('BL/26-27/1')).toBeInTheDocument();
    expect(within(listCard()).queryByText('BL/26-27/2')).not.toBeInTheDocument();
  });
});
