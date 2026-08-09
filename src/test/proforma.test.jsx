import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import Invoice from '../pages/Invoice.jsx';

const jss = [{ spec: 'A1', customer: 'Acme', jobName: 'Pouch A', subBrand: 'Fresh', jobType: 'StayFresh', dispatchForm: 'pouch', status: 'Active' }];
const prices = { A1: { price: 75, costPrice: 60, transport: 'At Actuals' } };
const customers = [{ customer: 'Acme', dispatchLoc: 'Hyderabad', billingAddr: 'Plot 1, Telangana', gstin: '36ABCDE1234F1Z5', contactPerson: 'Ravi', contactPhone: '9000000000', state: 'Telangana' }];

describe('Proforma Invoice', () => {
  it('opens from the Invoice screen, autofills rate, and computes the GST total', async () => {
    const user = userEvent.setup();
    renderApp(<Invoice />, { modules: { jss, prices, customers, oab: oabModule({}) } });
    await screen.findByText('Invoice');

    await user.click(screen.getByRole('link', { name: /Create Proforma Invoice/ }));
    await screen.findByText('Proforma Details');   // modal-only text → confirms it opened

    // Modal-unique selects, found via their placeholder options.
    await user.selectOptions(screen.getByRole('option', { name: '— Select Customer —' }).closest('select'), 'Acme');
    await user.selectOptions(screen.getByRole('option', { name: '— Select SKU —' }).closest('select'), 'A1');

    const skuTable = screen.getByText('SKU (Spec)').closest('table');
    const rowInputs = within(skuTable).getAllByRole('spinbutton');   // [qty, rate]
    expect(rowInputs[1]).toHaveValue(75);                            // rate autofilled from Price Master
    await user.type(rowInputs[0], '100');                            // qty

    // 100 × 75 = 7,500 sub total; +18% IGST = 1,350; total 8,850 (modal-only text).
    expect(screen.getAllByText(/8,850/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Save as Excel/ }));
    expect(await screen.findByText(/Excel downloaded/)).toBeInTheDocument();
  });
});
