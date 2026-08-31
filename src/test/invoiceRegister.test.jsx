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
      items: [{ spec: 'A1', jobName: 'Pouch A', rate: 75, qty: 110 }], header: { transporter: 'X' }, packingList: [] }],
  }),
  // The packing standard lives on the JSS spec — the packing list derives from it.
  jss: [{ spec: 'A1', jobName: 'Pouch A', customer: 'Acme', dispatchForm: 'Pouch', status: 'Active', qtyPerBag: 25 }],
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

  // The packing list is AUTO-GENERATED and read-only: nothing is typed. The 📦
  // button computes the bag ranges from the invoice qty and the spec's Qty per Bag
  // (JSS), and closing the modal persists that generated snapshot onto the invoice.
  it('auto-generates a read-only packing list from the register row and persists it', async () => {
    const { saved } = renderApp(<Invoice />, { modules: seed });
    const regCard = (await screen.findByText('Invoice Register')).closest('.card');
    fireEvent.change(within(regCard).getByLabelText('Period'), { target: { value: 'all' } });
    await within(regCard).findByText('BL/26-27/99');

    fireEvent.click(within(regCard).getByLabelText('Packing list for BL/26-27/99'));
    // the modal opens (title + printed doc both say PACKING LIST), with Pouch A
    expect((await screen.findAllByText(/PACKING LIST/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pouch A/).length).toBeGreaterThan(0);

    // 110 pcs @ 25/bag → bags 1–4 of 25 plus remainder bag 5 of 10, no typing:
    // the document is read-only (no inputs at all).
    expect(document.querySelectorAll('#pl-doc input').length).toBe(0);
    expect(screen.getByText('1 – 4')).toBeInTheDocument();
    expect(screen.getAllByText(/4 bags/).length).toBeGreaterThan(0);
    expect(screen.getByText('✓ Complete')).toBeInTheDocument();

    // closing persists the GENERATED ranges through the granular endpoint
    const sheet = document.getElementById('pl-doc').parentElement;
    fireEvent.click(within(sheet).getByRole('button', { name: /✕ Close/ }));
    await screen.findByText(/Packing list saved with invoice BL\/26-27\/99/);
    const call = saved.find((s) => s.endpoint === '/api/invoices/packing-list');
    expect(call).toBeTruthy();
    expect(call.body.no).toBe('BL/26-27/99');
    expect(call.body.packingList[0]).toMatchObject({ jobName: 'Pouch A', totalQty: 110 });
    expect(call.body.packingList[0].bags[0]).toMatchObject({ from: 1, to: 4, qty: 25 });
    expect(call.body.packingList[0].bags[1]).toMatchObject({ from: 5, to: 5, qty: 10 });
  });
});
