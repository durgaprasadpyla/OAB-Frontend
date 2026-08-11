import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderApp, oabModule } from './harness.jsx';
import Invoice from '../pages/Invoice.jsx';

// Slice 2: the Invoice register reads the normalized /api/invoices endpoint (via each
// row's payload = the exact register entry), not mods.oab.INV_REG directly.
const seed = {
  oab: oabModule({
    SF: [],
    INV_REG: [{ no: 'BL/26-27/99', date: '2026-05-01', po: 'PO-9', customer: 'Acme', qty: 100, amount: 7500,
      items: [{ spec: 'A1', jobName: 'Pouch A', rate: 75, qty: 100 }], header: { transporter: 'X' }, packingList: [] }],
  }),
  customers: [],
  prices: {},
};

describe('Invoice register — served from /api/invoices (normalized)', () => {
  it('lists an invoice returned by the endpoint (period = All Time)', async () => {
    renderApp(<Invoice />, { modules: seed });
    const regCard = (await screen.findByText('Invoice Register')).closest('.card');
    // Switch the period filter off so the assertion is clock-independent.
    fireEvent.change(within(regCard).getByRole('combobox'), { target: { value: 'all' } });
    await within(regCard).findByText('BL/26-27/99');
    expect(within(regCard).getByText('BL/26-27/99')).toBeTruthy();
  });
});
