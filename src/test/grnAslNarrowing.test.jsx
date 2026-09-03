import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// Client, 2026-09-03: "While creating a GRN when I select film and then CC PET,
// firstly the supplier options should be limited to those who supply film and CC PET
// whereas it is showing me the entire list. From the entire list if I select
// MR Polymers then in the item drop down it should show me the CC PET 106 item
// whereas it is not showing."
//
// Both failures were the same cause. The supplier↔item link lives on the ASL row, and
// that row carries the SUPPLIER's own description of the material — BLM106 reads
// FILM / CC PET there. Narrowing consulted only the Item Master, where BLM106 is
// tagged differently, so nothing matched: the supplier list could not be narrowed
// (it fell back to all of them) and the item was filtered out of the line dropdown.

vi.mock('../lib/xlsx.js', () => ({ exportAOA: vi.fn(), exportObjects: vi.fn() }));
vi.mock('../lib/pdf.js', () => ({ elementToPDF: vi.fn(async () => {}), printElement: vi.fn() }));

const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// The Item Master's copy of BLM106 does NOT say CC PET — this is the live mismatch.
const ITEMS = [
  { id: 106, code: 'BLM106', name: 'CC PET 12 MIC', materialType: 'FILM', subGroup: 'PET', specialtyName: '', microns: '12', uom: 'KG' },
  { id: 31, code: 'BLM031', name: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '51', uom: 'KG' },
  { id: 99, code: 'INK099', name: 'Cyan', materialType: 'INK', subGroup: 'Flexo', specialtyName: '', microns: '', uom: 'KG' },
];
// …but the approved-supplier list, which is what ties it to MR Polymers, does.
const PURCHASE = {
  pos: [],
  asl: [
    { company: 'MR Polymers', itemCode: 'BLM106', materialType: 'FILM', subGroup: 'CC PET', microns: '12' },
    { company: 'Cosmo Films', itemCode: 'BLM031', materialType: 'FILM', subGroup: 'AF BOPP', microns: '51' },
    { company: 'Ink House', itemCode: 'INK099', materialType: 'INK', subGroup: 'Flexo' },
    { company: 'MR Polymers', itemCode: 'BLM777', materialType: 'FILM', subGroup: 'CC PET' },   // not in the Item Master
  ],
};

beforeEach(() => {
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: PURCHASE }, save: vi.fn() }) }));
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/api/master/items')) return res(ITEMS);
    if (u.includes('/api/stores/locations')) return res([{ id: 1, name: 'A2', active: true }]);
    if (u.includes('/api/stores/grns')) return res([]);
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

async function openGrn() {
  const { default: Stores } = await import('../pages/Stores.jsx');
  render(<Stores />);
  fireEvent.click(await screen.findByText('📥 GRN'));
  return screen.findByLabelText('Supplier');
}
const values = (sel) => [...sel.options].map((o) => o.value).filter(Boolean);

async function chooseFilmCcPet() {
  fireEvent.change(screen.getByLabelText('Material type filter'), { target: { value: 'FILM' } });
  await waitFor(() => expect(values(screen.getByLabelText('Sub group filter'))).toContain('CC PET'));
  fireEvent.change(screen.getByLabelText('Sub group filter'), { target: { value: 'CC PET' } });
}

describe('GRN — narrowing by what the supplier actually supplies', () => {
  it('offers a sub-group only the approved-supplier list records', async () => {
    await openGrn();
    // CC PET appears on no Item Master row, so it used not to be offered at all.
    await waitFor(() => expect(values(screen.getByLabelText('Sub group filter'))).toContain('CC PET'));
  });

  it('limits the suppliers to those who supply film + CC PET', async () => {
    const sup = await openGrn();
    await waitFor(() => expect(values(sup).length).toBeGreaterThan(1));
    await chooseFilmCcPet();

    await waitFor(() => expect(values(sup)).toEqual(['MR Polymers']));
    expect(within(sup).queryByRole('option', { name: 'Cosmo Films' })).toBeNull();
    expect(within(sup).queryByRole('option', { name: 'Ink House' })).toBeNull();
    expect(screen.getByText(/1 of 3 suppliers supplies this material/)).toBeInTheDocument();
  });

  it('shows the CC PET item once that supplier is chosen', async () => {
    const sup = await openGrn();
    await chooseFilmCcPet();
    await waitFor(() => expect(values(sup)).toContain('MR Polymers'));
    fireEvent.change(sup, { target: { value: 'MR Polymers' } });

    const item = await screen.findByLabelText('Item for line 1');
    await waitFor(() => expect(item).not.toBeDisabled());
    expect(within(item).getByRole('option', { name: /BLM106/ })).toBeTruthy();
    expect(within(item).queryByRole('option', { name: /BLM031/ })).toBeNull();
  });

  it('names an approved code that is missing from the Item Master instead of hiding it', async () => {
    const sup = await openGrn();
    await chooseFilmCcPet();
    await waitFor(() => expect(values(sup)).toContain('MR Polymers'));
    fireEvent.change(sup, { target: { value: 'MR Polymers' } });

    // BLM777 is approved for MR Polymers but has no item to receive against.
    expect(await screen.findByText(/not in the Item.*Master/s)).toBeInTheDocument();
    expect(screen.getByText('BLM777')).toBeInTheDocument();
  });

  it('still matches on the Item Master when the two records agree', async () => {
    const sup = await openGrn();
    fireEvent.change(screen.getByLabelText('Material type filter'), { target: { value: 'FILM' } });
    await waitFor(() => expect(values(screen.getByLabelText('Sub group filter'))).toContain('AF BOPP'));
    fireEvent.change(screen.getByLabelText('Sub group filter'), { target: { value: 'AF BOPP' } });

    await waitFor(() => expect(values(sup)).toEqual(['Cosmo Films']));
    fireEvent.change(sup, { target: { value: 'Cosmo Films' } });
    const item = await screen.findByLabelText('Item for line 1');
    await waitFor(() => expect(within(item).queryByRole('option', { name: /BLM031/ })).toBeTruthy());
    expect(within(item).queryByRole('option', { name: /BLM106/ })).toBeNull();
  });

  it('leaves the supplier list whole when no material is chosen', async () => {
    const sup = await openGrn();
    await waitFor(() => expect(values(sup).sort()).toEqual(['Cosmo Films', 'Ink House', 'MR Polymers']));
  });
});
