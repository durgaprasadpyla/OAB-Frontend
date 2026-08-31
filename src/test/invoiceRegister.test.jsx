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

  // Restored on the business's request: every register row carries a 📦 button after
  // PDF that opens the invoice's EDITABLE packing list. When the spec carries a
  // Qty per Bag (JSS) the bags open pre-filled, but they remain plain inputs the
  // user can retype — and closing persists the ranges onto the invoice.
  it('opens an editable, pre-seeded packing list from the register row and persists it', async () => {
    const { saved } = renderApp(<Invoice />, { modules: seed });
    const regCard = (await screen.findByText('Invoice Register')).closest('.card');
    fireEvent.change(within(regCard).getByLabelText('Period'), { target: { value: 'all' } });
    await within(regCard).findByText('BL/26-27/99');

    fireEvent.click(within(regCard).getByLabelText('Packing list for BL/26-27/99'));
    // the modal opens (title + printed doc both say PACKING LIST), with Pouch A
    expect((await screen.findAllByText(/PACKING LIST/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pouch A/).length).toBeGreaterThan(0);

    // 110 pcs @ 25/bag (spec's Qty per Bag) → pre-filled bags 1–4 of 25 plus
    // remainder bag 5 of 10 — shown in EDITABLE inputs, exactly the old document.
    const tos = screen.getAllByLabelText('Bag to');
    const qtys = screen.getAllByLabelText('Qty per bag');
    expect(tos[0]).toHaveValue('4');
    expect(qtys[0]).toHaveValue('25');
    expect(tos[1]).toHaveValue('5');
    expect(qtys[1]).toHaveValue('10');
    expect(screen.getByText('✓ Complete')).toBeInTheDocument();

    // still fully editable: retype the first range end and it sticks
    fireEvent.change(tos[0], { target: { value: '3' } });
    expect(screen.getAllByLabelText('Bag to')[0]).toHaveValue('3');
    fireEvent.change(screen.getAllByLabelText('Bag to')[0], { target: { value: '4' } });

    // closing persists the ranges through the granular endpoint
    fireEvent.click(screen.getByRole('button', { name: /Save & Close/ }));
    await screen.findByText(/Packing list saved with invoice BL\/26-27\/99/);
    const call = saved.find((s) => s.endpoint === '/api/invoices/packing-list');
    expect(call).toBeTruthy();
    expect(call.body.no).toBe('BL/26-27/99');
    expect(call.body.packingList[0]).toMatchObject({ jobName: 'Pouch A', totalQty: 110 });
    expect(call.body.packingList[0].bags[0]).toMatchObject({ from: 1, to: 4, qty: 25 });
    expect(call.body.packingList[0].bags[1]).toMatchObject({ from: 5, to: 5, qty: 10 });
  });
});
