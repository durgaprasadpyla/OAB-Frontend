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
    // The register now has Period / PO / Sort selects, so target Period by name.
    fireEvent.change(within(regCard).getByLabelText('Period'), { target: { value: 'all' } });
    await within(regCard).findByText('BL/26-27/99');
    expect(within(regCard).getByText('BL/26-27/99')).toBeTruthy();
  });

  // Restored on the business's request: every register row carries a 📦 button after
  // PDF that opens the invoice's packing list (seeding one section per line when
  // none is saved), and closing the modal persists the ranges onto the invoice.
  it('opens and persists a packing list from the register row', async () => {
    const { saved } = renderApp(<Invoice />, { modules: seed });
    const regCard = (await screen.findByText('Invoice Register')).closest('.card');
    fireEvent.change(within(regCard).getByLabelText('Period'), { target: { value: 'all' } });
    await within(regCard).findByText('BL/26-27/99');

    fireEvent.click(within(regCard).getByLabelText('Packing list for BL/26-27/99'));
    // the modal opens (title + printed doc both say PACKING LIST), seeded with Pouch A
    expect((await screen.findAllByText(/PACKING LIST/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pouch A/).length).toBeGreaterThan(0);

    // closing persists the ranges through the granular endpoint
    fireEvent.click(screen.getByRole('button', { name: /Save & Close/ }));
    await screen.findByText(/Packing list saved with invoice BL\/26-27\/99/);
    const call = saved.find((s) => s.endpoint === '/api/invoices/packing-list');
    expect(call).toBeTruthy();
    expect(call.body.no).toBe('BL/26-27/99');
    expect(call.body.packingList[0]).toMatchObject({ jobName: 'Pouch A', totalQty: 100 });
  });
});
