// Transport 06.11: only active POs on the invoice, who bears the freight from the
// Customer Master to the invoice, the Transport Reports tab, and the machine's make and
// location.
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import Invoice from '../pages/Invoice.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import CustomersAdmin from '../components/CustomersAdmin.jsx';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { billedFreight } from '../lib/calc.js';
import { borneByOf, customerTransport, transportByCustomer, transportRows, transportTotals } from '../lib/transport.js';

const row = (patch) => ({ so: '26/1', spec: 'A1', poNum: 'PO-OPEN', customer: 'Acme', jobName: 'Pouch', jobType: 'StayFresh', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, dispLoc: 'Hyderabad', ...patch });
const customers = [
  { customer: 'Acme', dispatchLoc: 'Hyderabad', gstin: '36ABCDE1234F1Z5', transportBorneBy: 'Bloomflex' },
  { customer: 'Priya Milk', dispatchLoc: 'Chennai', gstin: '33ABCDE1234F1Z5' },
];
const jss = [{ spec: 'A1', customer: 'Acme', jobName: 'Pouch', status: 'Active' }];

describe('the invoice PO list', () => {
  const oab = oabModule({
    SF: [row({}), row({ so: '26/2', poNum: 'PO-PRIYA', customer: 'Priya Milk', closed: true })],
    OT: [row({ so: '26/3', poNum: 'PO-OPEN', closed: true }), row({ so: '26/4', poNum: 'PO-OTHERS' })],
  });

  async function mount() {
    renderApp(<Invoice />, { modules: { oab, customers, jss, prices: {} } });
    return screen.findByRole('option', { name: 'PO-OPEN' });
  }

  it('offers only POs with an open SO in either OAB', async () => {
    await mount();
    expect(screen.getByRole('option', { name: 'PO-OTHERS' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'PO-PRIYA' })).toBeNull();
  });

  it('a PO with one SO open and one closed lists only the open one, and takes the customer’s transport', async () => {
    const user = userEvent.setup();
    const opt = await mount();
    await user.selectOptions(opt.closest('select'), 'PO-OPEN');
    await screen.findByText(/1 SKU\(s\)/);
    expect(screen.getByLabelText('Transport borne by')).toHaveValue('Bloomflex');
  });

  it('warns that Bloomflex freight is not charged', async () => {
    const user = userEvent.setup();
    const opt = await mount();
    await user.selectOptions(opt.closest('select'), 'PO-OPEN');
    await user.clear(screen.getByLabelText('Freight'));
    await user.type(screen.getByLabelText('Freight'), '500');
    expect(screen.getByText(/Not charged on this invoice/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Transport borne by'), 'Customer');
    expect(screen.queryByText(/Not charged on this invoice/)).toBeNull();
  });
});

describe('what the invoice charges', () => {
  it('bills customer freight, and not Bloomflex freight', () => {
    expect(billedFreight({ freight: 500 })).toBe(500);
    expect(billedFreight({ freight: 500, freightBorneBy: 'Customer' })).toBe(500);
    expect(billedFreight({ freight: 500, freightBorneBy: 'Bloomflex' })).toBe(0);
  });

  it('the printed invoice leaves Bloomflex freight out of the total', () => {
    const lines = [{ spec: 'A1', qty: 100, rate: 10, lineTotal: 1000 }];
    const { container, unmount } = render(<InvoiceDoc header={{ freight: 500, freightBorneBy: 'Bloomflex', gstType: 'IGST' }} lines={lines} />);
    expect(container.textContent).toContain('1,180');
    unmount();
    const c = render(<InvoiceDoc header={{ freight: 500, freightBorneBy: 'Customer', gstType: 'IGST' }} lines={lines} />);
    expect(c.container.textContent).toContain('1,770');
  });
});

describe('the transport figures', () => {
  const inv = (no, date, customer, amount, freight, borne) => ({ no, date, customer, amount, header: { freight, ...(borne ? { freightBorneBy: borne } : {}) } });
  const oab = oabModule({ INV_REG: [
    inv('I1', '2026-10-01', 'Acme', 10000, 500, 'Bloomflex'),
    inv('I2', '2026-10-05', 'Acme', 20000, 300, 'Customer'),
    inv('I3', '2026-10-09', 'Beta', 5000, 200),                   // before who-bears-it existed
    inv('I4', '2026-10-10', 'Beta', 5000, 0, 'Customer'),
    inv('I5', '2025-01-01', 'Acme', 9000, 900, 'Bloomflex'),
  ] });

  it('an old invoice’s freight went on the customer’s bill, so it is theirs', () => {
    expect(borneByOf({ header: { freight: 200 } })).toBe('Customer');
  });

  it('splits the freight, within the period', () => {
    const rows = transportRows(oab, { from: '2026-04-01', to: '2026-10-31' });
    expect(transportTotals(rows)).toEqual({ invoices: 4, invoiceValue: 40000, freight: 1000, bloomflex: 500, customer: 500 });
  });

  it('lines up per customer, largest freight first', () => {
    const by = transportByCustomer(transportRows(oab, { from: '2026-04-01' }));
    expect(by.map((c) => [c.customer, c.bloomflex, c.borneByCustomer, c.freight])).toEqual([['Acme', 500, 300, 800], ['Beta', 0, 200, 200]]);
  });

  it('reads who bears a client’s transport off any of its rows', () => {
    const rows = [{ customer: 'Acme', dispatchLoc: 'A' }, { customer: ' acme ', dispatchLoc: 'B', transportBorneBy: 'Bloomflex' }];
    expect(customerTransport(rows, 'Acme')).toBe('Bloomflex');
    expect(customerTransport(rows, 'Beta')).toBe('');
  });

  it('shows on the Dashboard under Transport Reports', async () => {
    const user = userEvent.setup();
    renderApp(<Dashboard />, { modules: { oab, jss, prices: {}, customers }, role: 'superadmin' });
    await user.click(await screen.findByText(/Transport Reports/, { selector: '.step-tab' }));
    await user.clear(screen.getByLabelText('Transport report from'));
    await user.type(screen.getByLabelText('Transport report from'), '2026-04-01');
    await waitFor(() => expect(screen.getByLabelText('Borne by Bloomflex')).toHaveTextContent('500'));
    expect(screen.getByLabelText('Borne by customers')).toHaveTextContent('500');
    expect(within(screen.getByLabelText('Transport by customer')).getByText('Beta')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Invoice-wise freight')).queryByText('I4')).toBeNull();   // no freight
  });
});

describe('Customers tab', () => {
  it('a choice on one row reaches every row of that client', async () => {
    const user = userEvent.setup();
    const rows = [
      { customer: 'Acme', dispatchLoc: 'Hyderabad' }, { customer: 'Acme', dispatchLoc: 'Pune' }, { customer: 'Beta', dispatchLoc: 'Delhi' },
    ];
    const { saved } = renderApp(<CustomersAdmin />, { modules: { customers: rows }, role: 'superadmin' });
    await user.click((await screen.findAllByLabelText('Edit customer Acme'))[0]);
    await user.selectOptions(screen.getByLabelText('Customer form Transport Borne By'), 'Bloomflex');
    await user.click(screen.getByRole('button', { name: /Update Customer/ }));
    await waitFor(() => expect(saved.some((s) => s.id === 4)).toBe(true));
    const data = saved.find((s) => s.id === 4).data;
    expect(data.filter((c) => c.customer === 'Acme').map((c) => c.transportBorneBy)).toEqual(['Bloomflex', 'Bloomflex']);
    expect(data.find((c) => c.customer === 'Beta').transportBorneBy).toBeFalsy();
  });
});
