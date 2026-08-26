import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import PDashboard from '../pages/PDashboard.jsx';

// Enhancements 2.0 §1 + §11: Specialty is a per-item field on the Padmin Item Master
// (right after Sub Group), and Department is a dropdown at the END (after UOM) sourced
// from the production Department master. NOT a separate Super Admin "Specialties" tab.

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

// itemsExtra is set per-test so we can exercise seeded, empty, and mixed rows.
let itemsExtra;
let saved;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'padmin');
  saved = [];
  itemsExtra = [{ itemCode: 'RM-001', specificMaterial: 'BOPP Film', materialType: 'BOPP', subGroup: 'Films', specialty: 'High Barrier', microns: '20', uom: 'KG', department: 'Printing' }];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.includes('/api/auth/me')) return res(200, { username: 'padmin', role: 'padmin' });
    if (u.includes('/api/master/departments')) return res(200, [{ id: 1, name: 'Printing', active: true }, { id: 2, name: 'Slitting', active: true }]);
    if (u.includes('/rest/v1/oab_data')) {
      if (method === 'GET') return res(200, [{ id: 6, data: JSON.stringify({ asl: [], pos: [], priceHistory: [], counter: 0, itemsExtra }), version: 1 }]);
      saved.push(body);
      return res(201, { id: body.id, version: 2 });
    }
    return res(200, {});
  };
});

function mount() {
  return render(<MemoryRouter><AuthProvider><DataProvider><PDashboard /></DataProvider></AuthProvider></MemoryRouter>);
}
const openItemMaster = async () => fireEvent.click(await screen.findByText('🗂 Item Master'));
const lastSavedItems = () => JSON.parse(saved[saved.length - 1].data).itemsExtra;

describe('Padmin Item Master — Specialty + Department (Enhancements 2.0 §1/§11)', () => {
  it('LIST: places Specialty after Sub Group and Department last (after UOM)', async () => {
    mount();
    await openItemMaster();
    const firstTable = (await screen.findAllByRole('table'))[0];
    const heads = within(firstTable).getAllByRole('columnheader').map((h) => h.textContent.trim());
    expect(heads).toEqual(['Code', 'Description', 'Material Type', 'Sub Group', 'Specialty', 'Microns', 'UOM', 'Department', '']);
  });

  it('EDIT: loads the stored Specialty + Department, and the Department is a master-driven dropdown', async () => {
    mount();
    await openItemMaster();
    expect(await screen.findByDisplayValue('High Barrier')).toBeInTheDocument();   // specialty loads
    await waitFor(() => { expect(screen.getByDisplayValue('Printing').tagName).toBe('SELECT'); });   // department dropdown
    expect(within(screen.getByDisplayValue('Printing')).getByRole('option', { name: 'Slitting' })).toBeInTheDocument();
  });

  it('EDIT: changing Specialty persists on save', async () => {
    mount();
    await openItemMaster();
    fireEvent.change(await screen.findByDisplayValue('High Barrier'), { target: { value: 'Metallized' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(lastSavedItems()[0]).toMatchObject({ specialty: 'Metallized', department: 'Printing' });
  });

  it('CREATE: a new item can capture Specialty + Department and they persist', async () => {
    itemsExtra = [];   // start empty so the new row is unambiguous
    mount();
    await openItemMaster();
    fireEvent.click(screen.getByRole('button', { name: /New Item Code/ }));
    const table = (await screen.findAllByRole('table'))[0];
    const inputs = within(table).getAllByRole('textbox');   // Description, Material Type, Sub Group, Specialty, Microns, UOM
    fireEvent.change(inputs[2], { target: { value: 'Adhesives' } });   // Sub Group
    fireEvent.change(inputs[3], { target: { value: 'Solvent-free' } }); // Specialty (after Sub Group)
    await userEvent.selectOptions(within(table).getByRole('combobox'), 'Slitting');   // Department dropdown
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const created = lastSavedItems()[0];
    expect(created).toMatchObject({ subGroup: 'Adhesives', specialty: 'Solvent-free', department: 'Slitting' });
  });

  it('EXISTING DATA: an item with no Specialty/Department still loads normally', async () => {
    itemsExtra = [{ itemCode: 'RM-OLD', specificMaterial: 'Legacy Film', materialType: 'PET', subGroup: 'Films', microns: '12', uom: 'KG' }];   // no specialty/department keys
    mount();
    await openItemMaster();
    expect(await screen.findByDisplayValue('Legacy Film')).toBeInTheDocument();   // renders without error
    // the Specialty cell is present but empty (does not crash on undefined)
    const table = (await screen.findAllByRole('table'))[0];
    expect(within(table).getAllByRole('textbox')[3]).toHaveValue('');   // Specialty input empty
  });

  it('SEARCH: filtering by a Specialty term finds the item', async () => {
    itemsExtra = [
      { itemCode: 'RM-001', specificMaterial: 'BOPP Film', subGroup: 'Films', specialty: 'High Barrier', uom: 'KG', department: 'Printing' },
      { itemCode: 'RM-002', specificMaterial: 'Ink Base', subGroup: 'Inks', specialty: 'UV Cure', uom: 'KG', department: 'Printing' },
    ];
    mount();
    await openItemMaster();
    await screen.findByDisplayValue('BOPP Film');
    fireEvent.change(screen.getByPlaceholderText(/Search item/i), { target: { value: 'UV Cure' } });
    await waitFor(() => expect(screen.queryByDisplayValue('BOPP Film')).toBeNull());   // filtered out
    expect(screen.getByDisplayValue('Ink Base')).toBeInTheDocument();                  // specialty match kept
  });
});
