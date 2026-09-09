import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import PDashboard from '../pages/PDashboard.jsx';
import { identityByCode, fillGaps, identityConflicts } from '../lib/itemIdentity.js';

// Reported from the floor, 2026-09-09: "BLM309 shows the wrong description in Item
// Master." The Padmin Item Master listed BLM309 as "320 MM" with no specialty while
// the Approved Supplier List, on the same screen, called the same code
// "320 MM X 35 MIC / ANTIFOG" — and the Item Master's wording is the one the sync
// pushes on to Stores, the BOM and MIS.
//
// The blob keeps the identity twice and only a SAVE ever reconciled the two, so an
// old divergence simply sat there with nothing on screen to say which copy was right.

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

const EXTRA = [
  // What the Item Master showed: a shorter description, no specialty.
  { itemCode: 'BLM309', specificMaterial: '320 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: '', microns: '35', uom: 'Kg', department: 'Printing' },
  // An item only this list knows about — it must be left completely alone.
  { itemCode: 'BLM440', specificMaterial: 'PAPER BUNDLE A4', materialType: 'STATIONARY', subGroup: 'COMMON', specialty: '', microns: '', uom: 'BUNDLE', department: '' },
];
const ASL = [
  { company: 'A J', itemCode: 'BLM309', specificMaterial: '320 MM X 35 MIC', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'ANTIFOG', microns: '35', uom: 'Kg', department: 'Printing', basicPrice: 126.75, status: 'Active' },
];

let itemsExtra; let asl; let saved;
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
    if (u.includes('/api/master/items')) return res(200, []);
    if (u.includes('/rest/v1/oab_data')) {
      if (method === 'GET') return res(200, [{ id: 6, data: JSON.stringify({ asl, pos: [], priceHistory: [], counter: 0, itemsExtra }), version: 1 }]);
      saved.push(body);
      return res(201, { id: body.id, version: 2 });
    }
    return res(200, {});
  };
});

const mount = () => render(<MemoryRouter><AuthProvider><DataProvider><PDashboard /></DataProvider></AuthProvider></MemoryRouter>);
const openItemMaster = async () => fireEvent.click(await screen.findByText('\u{1F5C2} Item Master'));
const lastSaved = () => JSON.parse(saved[saved.length - 1].data);

describe('gaps and disagreements between the two copies of an item', () => {
  it('fills a blank field, and never replaces one that is already answered', () => {
    const by = identityByCode(ASL, { onlyFilled: true });
    const out = fillGaps(EXTRA, by);
    expect(out[0].specialty).toBe('ANTIFOG');            // was blank here, known there
    expect(out[0].specificMaterial).toBe('320 MM');      // answered here — left alone
    expect(out[1]).toBe(EXTRA[1]);                       // untouched code, same object
  });

  it('reports only the fields both sides fill in differently', () => {
    const c = identityConflicts(EXTRA, identityByCode(ASL, { onlyFilled: true }));
    expect(Object.keys(c)).toEqual(['BLM309']);
    expect(c.BLM309).toEqual({ specificMaterial: '320 MM X 35 MIC' });   // NOT the blank specialty
  });

  it('a blank on either side is not a conflict', () => {
    expect(identityConflicts([{ itemCode: 'A', uom: '' }], { A: { uom: 'Kg' } })).toEqual({});
    expect(identityConflicts([{ itemCode: 'A', uom: 'Kg' }], { A: { uom: '' } })).toEqual({});
  });
});

describe('the Item Master screen shows the disagreement instead of hiding it', () => {
  it('fills the missing specialty from the supplier list as soon as the tab opens', async () => {
    mount(); await openItemMaster();
    const row = (await screen.findAllByText('BLM309'))[0].closest('tr');
    await waitFor(() => expect(row.textContent).toContain('ANTIFOG'));
  });

  it('flags the description the two lists disagree on, and shows the other wording', async () => {
    mount(); await openItemMaster();
    expect(await screen.findByText(/1 item code is described/)).toBeTruthy();
    expect(await screen.findByText('ASL: 320 MM X 35 MIC')).toBeTruthy();
  });

  it('adopts the supplier list wording for every disagreeing item in one click', async () => {
    mount(); await openItemMaster();
    fireEvent.click(await screen.findByText(/Use the supplier list wording on all 1/));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const out = lastSaved().itemsExtra;
    expect(out.find((r) => r.itemCode === 'BLM309').specificMaterial).toBe('320 MM X 35 MIC');
    expect(out.find((r) => r.itemCode === 'BLM309').specialty).toBe('ANTIFOG');
    // an item the supplier list says nothing about is written back exactly as it was
    expect(out.find((r) => r.itemCode === 'BLM440').specificMaterial).toBe('PAPER BUNDLE A4');
  });

  it('one row can be corrected on its own', async () => {
    mount(); await openItemMaster();
    fireEvent.click(await screen.findByLabelText('Use supplier list wording for BLM309'));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(lastSaved().itemsExtra.find((r) => r.itemCode === 'BLM309').specificMaterial).toBe('320 MM X 35 MIC');
  });

  it('says nothing when the two lists already agree', async () => {
    asl = [{ ...ASL[0], specificMaterial: '320 MM' }];
    itemsExtra = [{ ...EXTRA[0], specialty: 'ANTIFOG' }];
    mount(); await openItemMaster();
    await screen.findAllByText('BLM309');
    expect(screen.queryByText(/described differently/)).toBeNull();
  });

  it('saving the whole list no longer blanks a supplier row the master says nothing about', async () => {
    // The Item Master carries no department for BLM440; the supplier row does.
    asl = [{ company: 'A J', itemCode: 'BLM440', specificMaterial: 'PAPER BUNDLE A4', department: 'Stores', status: 'Active' }];
    itemsExtra = [{ ...EXTRA[1] }];
    mount(); await openItemMaster();
    await screen.findAllByText('BLM440');
    fireEvent.click(screen.getByText('\u{1F4BE} Save'));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(lastSaved().asl[0].department).toBe('Stores');
  });
});
