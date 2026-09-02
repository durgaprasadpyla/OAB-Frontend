import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import PDashboard from '../pages/PDashboard.jsx';

// Issues 3.1 — Padmin › Item Master › Add New Item.
// Material Type / Sub Group / Specialty / UOM were free-text boxes, which is how
// "PRINTING" and "Printing" (and FILM/AF BOPP drifting apart) got into the catalog.
// They are now pickers over the values already in use, with "＋ Add new …" inside the
// dropdown — the same shape as Customers' Add-new-group / Add-new-customer.

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

// A small catalog with two material types, each with its own sub-groups.
const ITEMS = [
  { itemCode: 'BLM306', specificMaterial: '700', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'Metallized', microns: '51', uom: 'KG', department: 'Printing' },
  { itemCode: 'BLM031', specificMaterial: '460 MM (AJ)', materialType: 'FILM', subGroup: 'PET', specialty: '', microns: '51', uom: 'KG', department: 'Printing' },
  { itemCode: 'BLM200', specificMaterial: 'Solvent Base', materialType: 'INK', subGroup: 'Solvent', specialty: 'UV Cure', microns: '', uom: 'LTR', department: 'Printing' },
];

let itemsExtra;
let asl;
let saved;
// Issues 2.6: UOM no longer comes from the catalog rows — it is the units master
// (Dashboard → Drop-down selections → UOM). Empty here, so the four defaults show.
let uomMaster;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'padmin');
  saved = [];
  asl = [];
  uomMaster = [];
  itemsExtra = ITEMS.map((r) => ({ ...r }));
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.includes('/api/auth/me')) return res(200, { username: 'padmin', role: 'padmin' });
    if (u.includes('/api/master/departments')) return res(200, [{ id: 1, name: 'Printing', active: true }]);
    if (u.includes('/api/master/uoms')) return res(200, uomMaster);
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
const lastSavedItems = () => JSON.parse(saved[saved.length - 1].data).itemsExtra;
const opts = (sel) => within(sel).getAllByRole('option').map((o) => o.textContent.trim());
const pick = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('Issues 3.1 — Item Master taxonomy pickers', () => {
  it('every taxonomy field is a dropdown of what the catalog already uses', async () => {
    mount();
    await openItemMaster();

    for (const label of ['Item form Material Type', 'Item form Sub Group', 'Item form Specialty', 'Item form UOM']) {
      expect(screen.getByLabelText(label).tagName, label + ' should be a dropdown').toBe('SELECT');
    }
    // Distinct, sorted, blank-free — and each carries its own "add new" entry.
    expect(opts(screen.getByLabelText('Item form Material Type')))
      .toEqual(['— select material type —', 'FILM', 'INK', '＋ Add new material type…']);
    expect(opts(screen.getByLabelText('Item form Specialty')))
      .toEqual(['— select specialty —', 'Metallized', 'UV Cure', '＋ Add new specialty…']);
    // Issues 2.6: the units master is the source — not KG/LTR scraped off the rows.
    // Nothing saved in the master yet, so the four standard units are offered.
    expect(opts(screen.getByLabelText('Item form UOM')))
      .toEqual(['— select uom —', 'Kg', 'Lt', 'Mtr', "No's", '＋ Add new uom…']);
    // Description and Microns are the item's own name and a number — still free text.
    expect(screen.getByLabelText('Item form Description').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Item form Microns').tagName).toBe('INPUT');
  });

  it('Sub Group narrows to the chosen Material Type, and lists all of them when none is chosen', async () => {
    mount();
    await openItemMaster();

    // Nothing chosen → every sub group in the catalog.
    expect(opts(screen.getByLabelText('Item form Sub Group')))
      .toEqual(['— select sub group —', 'AF BOPP', 'PET', 'Solvent', '＋ Add new sub group…']);

    pick('Item form Material Type', 'FILM');
    expect(opts(screen.getByLabelText('Item form Sub Group')))
      .toEqual(['— select sub group —', 'AF BOPP', 'PET', '＋ Add new sub group…']);
    expect(screen.getByText('Sub groups under FILM')).toBeInTheDocument();

    pick('Item form Material Type', 'INK');
    expect(opts(screen.getByLabelText('Item form Sub Group')))
      .toEqual(['— select sub group —', 'Solvent', '＋ Add new sub group…']);
  });

  it('changing the Material Type drops a Sub Group that does not belong under it', async () => {
    mount();
    await openItemMaster();

    pick('Item form Material Type', 'FILM');
    pick('Item form Sub Group', 'AF BOPP');
    expect(screen.getByLabelText('Item form Sub Group')).toHaveValue('AF BOPP');

    pick('Item form Material Type', 'INK');           // AF BOPP is not an INK sub group
    expect(screen.getByLabelText('Item form Sub Group')).toHaveValue('');

    // …but a sub group that IS valid under the new type survives the switch.
    pick('Item form Sub Group', 'Solvent');
    pick('Item form Material Type', 'INK');
    expect(screen.getByLabelText('Item form Sub Group')).toHaveValue('Solvent');
  });

  it('saves an item built entirely from existing values', async () => {
    mount();
    await openItemMaster();

    fireEvent.change(screen.getByLabelText('Item form Description'), { target: { value: '900 MM' } });
    pick('Item form Material Type', 'FILM');
    pick('Item form Sub Group', 'AF BOPP');
    pick('Item form Specialty', 'Metallized');
    pick('Item form UOM', 'Kg');
    fireEvent.click(screen.getByRole('button', { name: /Add Item/ }));

    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(lastSavedItems()[0]).toMatchObject({
      specificMaterial: '900 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'Metallized', uom: 'Kg',
    });
  });

  it('"＋ Add new …" reveals a text box, and the new value joins the list for the next item', async () => {
    mount();
    await openItemMaster();

    // No text box until the picker is put into add-new mode.
    expect(screen.queryByLabelText('New Material Type')).toBeNull();
    pick('Item form Material Type', '__new__');
    expect(screen.getByLabelText('New Material Type')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Item form Description'), { target: { value: 'Hotmelt' } });
    fireEvent.change(screen.getByLabelText('New Material Type'), { target: { value: 'ADHESIVE' } });
    pick('Item form Sub Group', '__new__');
    fireEvent.change(screen.getByLabelText('New Sub Group'), { target: { value: 'Hotmelt' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Item/ }));

    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(lastSavedItems()[0]).toMatchObject({ materialType: 'ADHESIVE', subGroup: 'Hotmelt' });

    // The picker is now offering it — no separate master list to maintain.
    await waitFor(() => expect(opts(screen.getByLabelText('Item form Material Type'))).toContain('ADHESIVE'));
    pick('Item form Material Type', 'ADHESIVE');
    expect(opts(screen.getByLabelText('Item form Sub Group')))
      .toEqual(['— select sub group —', 'Hotmelt', '＋ Add new sub group…']);
  });

  it('refuses to save an "Add new" picker left empty rather than writing a blank value', async () => {
    mount();
    await openItemMaster();

    fireEvent.change(screen.getByLabelText('Item form Description'), { target: { value: 'Mystery goo' } });
    pick('Item form Material Type', '__new__');       // switched to add-new, nothing typed
    fireEvent.click(screen.getByRole('button', { name: /Add Item/ }));

    expect(await screen.findByText(/Enter the new Material Type, or pick an existing one/)).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  it('an ASL-owned value is offered too, so the two catalogs cannot drift apart', async () => {
    asl = [{ company: 'Ami Pyroflex', itemCode: 'BLM900', materialType: 'PAPER', subGroup: 'Kraft', specialty: 'FSC', uom: 'REAM', status: 'Active' }];
    mount();
    await openItemMaster();

    expect(opts(screen.getByLabelText('Item form Material Type'))).toContain('PAPER');
    // UOM is a master now (Issues 2.6), so it is NOT scraped from the ASL row — only
    // the taxonomy fields are. The unit list stays the Super Admin's.
    expect(opts(screen.getByLabelText('Item form UOM'))).not.toContain('REAM');
    pick('Item form Material Type', 'PAPER');
    expect(opts(screen.getByLabelText('Item form Sub Group')))
      .toEqual(['— select sub group —', 'Kraft', '＋ Add new sub group…']);
  });

  it('editing a row loads its stored values into the pickers', async () => {
    mount();
    await openItemMaster();
    fireEvent.click(await screen.findByLabelText('Edit item BLM306'));

    expect(screen.getByLabelText('Item form Material Type')).toHaveValue('FILM');
    expect(screen.getByLabelText('Item form Sub Group')).toHaveValue('AF BOPP');
    expect(screen.getByLabelText('Item form Specialty')).toHaveValue('Metallized');
    // Issues 2.6: KG is not on the master, but the row already carries it — so it is
    // still offered and still selected. Opening an old row never changes its unit.
    expect(screen.getByLabelText('Item form UOM')).toHaveValue('KG');
    expect(opts(screen.getByLabelText('Item form UOM'))).toContain('KG');

    // Re-point it to an existing sibling sub group and save.
    pick('Item form Sub Group', 'PET');
    fireEvent.click(screen.getByRole('button', { name: /Update Item/ }));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(lastSavedItems().find((r) => r.itemCode === 'BLM306').subGroup).toBe('PET');
  });
});
