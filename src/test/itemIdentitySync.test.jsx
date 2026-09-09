import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import PDashboard from '../pages/PDashboard.jsx';
import { ITEM_IDENTITY, identityByCode, applyIdentity, identityDiffers } from '../lib/itemIdentity.js';

// "In the item master in Padmin login, if I make any change, the same changes should
//  be reflected in the approved suppliers to item mapping, as well as in the stores
//  login, in the GRN list, and in the store stock list."
//
// Module 6 stores an item TWICE: `itemsExtra` is the Item Master, and every `asl`
// row carries its own copy of the same descriptive columns. Nothing kept them in
// step, so an Item Master edit left the supplier mapping describing the old item —
// and an edit made on the Approved Suppliers tab was ignored downstream, because the
// backend's item sync reads itemsExtra first and that copy still said the old thing.
//
// Stores (GRN list, stock list) read the normalized item table, which the sync fills
// from itemsExtra — so those follow once the two stores agree. The server side of
// that is covered by Phase6PlanningJssTest.theItemMasterBeatsTheStaleCopyOnAnAslRow.

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

const EXTRA = [
  { itemCode: 'BLM500', specificMaterial: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'Metallized', microns: '51', uom: 'KG', department: 'Printing' },
];
// The same code, mapped to two suppliers — each with its OWN commercial terms.
const ASL = [
  { company: 'Aryan Petrochemicals', itemCode: 'BLM500', specificMaterial: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'Metallized', microns: '51', uom: 'KG', department: 'Printing', basicPrice: 120, moq: '1000', leadTime: '7', status: 'Active' },
  { company: 'Cosmo First', itemCode: 'BLM500', specificMaterial: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'Metallized', microns: '51', uom: 'KG', department: 'Printing', basicPrice: 118, moq: '500', leadTime: '10', status: 'Active' },
  { company: 'Aryan Petrochemicals', itemCode: 'BLM900', specificMaterial: 'Other thing', materialType: 'INK', subGroup: 'Solvent', uom: 'LTR', basicPrice: 55, status: 'Active' },
];

let itemsExtra;
let asl;
let saved;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'padmin');
  saved = [];
  itemsExtra = EXTRA.map((r) => ({ ...r }));
  asl = ASL.map((r) => ({ ...r }));
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.includes('/api/auth/me')) return res(200, { username: 'padmin', role: 'padmin' });
    if (u.includes('/api/master/departments')) return res(200, [{ id: 1, name: 'Printing', active: true }]);
    if (u.includes('/api/master/uoms')) return res(200, []);
    if (u.includes('/rest/v1/oab_data')) {
      if (method === 'GET') return res(200, [{ id: 6, data: JSON.stringify({ asl, pos: [], priceHistory: [], counter: 0, itemsExtra }), version: 1 }]);
      saved.push(body);
      return res(201, { id: body.id, version: 2 });
    }
    return res(200, {});
  };
});

const mount = () => render(<MemoryRouter><AuthProvider><DataProvider><PDashboard /></DataProvider></AuthProvider></MemoryRouter>);
const openItemMaster = async () => fireEvent.click(await screen.findByText('🗂 Item Master'));
const lastSaved = () => JSON.parse(saved[saved.length - 1].data);
const pick = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

/* ── the helper itself ──────────────────────────────────────────────────── */

describe('item identity — one code, one identity', () => {
  it('carries the descriptive fields and never a supplier’s commercial terms', () => {
    expect(ITEM_IDENTITY).toEqual(['specificMaterial', 'materialType', 'subGroup', 'specialty', 'microns', 'uom', 'department']);
    // two suppliers of one code legitimately charge different prices
    ['basicPrice', 'moq', 'leadTime', 'company', 'itemCode'].forEach((f) => expect(ITEM_IDENTITY).not.toContain(f));
  });

  it('takes the first row per code, the same rule the backend sync uses', () => {
    const by = identityByCode([
      { itemCode: 'A', specificMaterial: 'first', uom: 'KG' },
      { itemCode: 'A', specificMaterial: 'second', uom: 'Mtr' },
    ]);
    expect(by.A.specificMaterial).toBe('first');
  });

  it('stamps an identity onto every row sharing the code and leaves the rest alone', () => {
    const by = identityByCode([{ itemCode: 'BLM500', specificMaterial: '900 MM', uom: 'Mtr' }]);
    const out = applyIdentity(ASL, by);
    expect(out[0].specificMaterial).toBe('900 MM');
    expect(out[1].specificMaterial).toBe('900 MM');
    expect(out[0].basicPrice).toBe(120);          // each supplier keeps its own terms
    expect(out[1].basicPrice).toBe(118);
    expect(out[2]).toBe(ASL[2]);                   // a different code is the same object
  });

  it('onlyFilled keeps a blank from wiping what the other store knows', () => {
    const by = identityByCode([{ itemCode: 'A', specificMaterial: 'named', department: '' }], { onlyFilled: true });
    expect(by.A).toEqual({ specificMaterial: 'named' });
    const out = applyIdentity([{ itemCode: 'A', specificMaterial: 'old', department: 'Printing' }], by);
    expect(out[0]).toEqual({ itemCode: 'A', specificMaterial: 'named', department: 'Printing' });
  });

  it('reports whether anything would actually move', () => {
    const same = identityByCode([{ itemCode: 'BLM500', ...EXTRA[0] }]);
    expect(identityDiffers(ASL, same)).toBe(false);
    expect(identityDiffers(ASL, identityByCode([{ itemCode: 'BLM500', specificMaterial: 'X' }]))).toBe(true);
  });
});

/* ── the Item Master → supplier mapping ─────────────────────────────────── */

describe('Padmin Item Master — an edit reaches the supplier mapping', () => {
  it('writes the new identity onto both stores in one save', async () => {
    mount();
    await openItemMaster();
    // open BLM500 for editing (the radio in its row loads it into the top form)
    fireEvent.click(await screen.findByLabelText('Edit item BLM500'));
    await waitFor(() => expect(screen.getByLabelText('Item form Description')).toHaveValue('700 MM'));

    fireEvent.change(screen.getByLabelText('Item form Description'), { target: { value: '1200 MM' } });
    pick('Item form Sub Group', 'AF BOPP');
    fireEvent.click(screen.getByRole('button', { name: /Update Item/ }));

    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const blob = lastSaved();
    // the Item Master itself
    expect(blob.itemsExtra[0]).toMatchObject({ itemCode: 'BLM500', specificMaterial: '1200 MM' });
    // …and every approved-supplier row that carries the code
    expect(blob.asl[0]).toMatchObject({ company: 'Aryan Petrochemicals', itemCode: 'BLM500', specificMaterial: '1200 MM' });
    expect(blob.asl[1]).toMatchObject({ company: 'Cosmo First', itemCode: 'BLM500', specificMaterial: '1200 MM' });
    // each supplier's own commercial terms are untouched
    expect(blob.asl[0].basicPrice).toBe(120);
    expect(blob.asl[1].basicPrice).toBe(118);
    expect(blob.asl[0].moq).toBe('1000');
    // a different item code is left exactly as it was
    expect(blob.asl[2]).toEqual(ASL[2]);
  });

  it('says how many supplier rows followed the change', async () => {
    mount();
    await openItemMaster();
    fireEvent.click(await screen.findByLabelText('Edit item BLM500'));
    await waitFor(() => expect(screen.getByLabelText('Item form Description')).toHaveValue('700 MM'));
    fireEvent.change(screen.getByLabelText('Item form Description'), { target: { value: '1200 MM' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Item/ }));
    await screen.findByText(/Supplier mapping updated on 2 row\(s\)/);
  });
});
