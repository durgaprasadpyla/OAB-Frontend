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

describe('Padmin Item Master — Specialty + Department (Enhancements 2.0 §1/§11 + Issues 2.0)', () => {
  it('LIST: read-only table with a radio Edit column; Specialty after Sub Group, Department last', async () => {
    mount();
    await openItemMaster();
    const firstTable = (await screen.findAllByRole('table'))[0];
    const heads = within(firstTable).getAllByRole('columnheader').map((h) => h.textContent.trim());
    expect(heads).toEqual(['Edit', 'Code', 'Description', 'Material Type', 'Sub Group', 'Specialty', 'Microns', 'UOM', 'Department', '']);
    // Issues 2.0: nothing is edited in the table directly — no inputs except the radio.
    const inputs = [...firstTable.querySelectorAll('tbody input')];
    expect(inputs.every((i) => i.type === 'radio')).toBe(true);
  });

  it('EDIT: the radio loads the row into the TOP FORM (Department = master dropdown), update persists', async () => {
    mount();
    await openItemMaster();
    fireEvent.click(await screen.findByLabelText('Edit item RM-001'));
    // form shows the stored identity
    expect(screen.getByLabelText('Item form Specialty')).toHaveValue('High Barrier');
    const dept = screen.getByLabelText('Item form department');
    expect(dept.tagName).toBe('SELECT');
    expect(dept).toHaveValue('Printing');
    expect(within(dept).getByRole('option', { name: 'Slitting' })).toBeInTheDocument();
    // change specialty in the form → Update Item saves it
    fireEvent.change(screen.getByLabelText('Item form Specialty'), { target: { value: 'Metallized' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Item/ }));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(lastSavedItems()[0]).toMatchObject({ specialty: 'Metallized', department: 'Printing' });
  });

  it('CREATE: the top form adds the item on TOP with Specialty + Department', async () => {
    itemsExtra = [];   // start empty so the new row is unambiguous
    mount();
    await openItemMaster();
    fireEvent.change(screen.getByLabelText('Item form Description'), { target: { value: 'Hotmelt' } });
    fireEvent.change(screen.getByLabelText('Item form Sub Group'), { target: { value: 'Adhesives' } });
    fireEvent.change(screen.getByLabelText('Item form Specialty'), { target: { value: 'Solvent-free' } });
    await userEvent.selectOptions(await screen.findByLabelText('Item form department'), 'Slitting');
    fireEvent.click(screen.getByRole('button', { name: /Add Item/ }));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const created = lastSavedItems()[0];
    expect(created).toMatchObject({ subGroup: 'Adhesives', specialty: 'Solvent-free', department: 'Slitting' });
    expect(created.itemCode).toBeTruthy();   // auto-assigned code
  });

  it('EXISTING DATA: an item with no Specialty/Department still loads normally', async () => {
    itemsExtra = [{ itemCode: 'RM-OLD', specificMaterial: 'Legacy Film', materialType: 'PET', subGroup: 'Films', microns: '12', uom: 'KG' }];   // no specialty/department keys
    mount();
    await openItemMaster();
    expect(await screen.findByText('Legacy Film')).toBeInTheDocument();   // renders without error
    fireEvent.click(screen.getByLabelText('Edit item RM-OLD'));
    expect(screen.getByLabelText('Item form Specialty')).toHaveValue('');   // no crash on undefined
  });

  it('SEARCH: filtering by a Specialty term finds the item', async () => {
    itemsExtra = [
      { itemCode: 'RM-001', specificMaterial: 'BOPP Film', subGroup: 'Films', specialty: 'High Barrier', uom: 'KG', department: 'Printing' },
      { itemCode: 'RM-002', specificMaterial: 'Ink Base', subGroup: 'Inks', specialty: 'UV Cure', uom: 'KG', department: 'Printing' },
    ];
    mount();
    await openItemMaster();
    await screen.findByText('BOPP Film');
    fireEvent.change(screen.getByPlaceholderText(/Search item/i), { target: { value: 'UV Cure' } });
    await waitFor(() => expect(screen.queryByText('BOPP Film')).toBeNull());   // filtered out
    expect(screen.getByText('Ink Base')).toBeInTheDocument();                  // specialty match kept
  });

  it('AUTO: blank departments fill themselves from the normalized item master', async () => {
    itemsExtra = [
      { itemCode: 'RM-001', specificMaterial: 'BOPP Film', materialType: 'BOPP', subGroup: 'Films', specialty: '', microns: '20', uom: 'KG', department: 'Printing' },
      { itemCode: 'RM-002', specificMaterial: 'Slit Film', materialType: 'BOPP', subGroup: 'Films', specialty: '', microns: '', uom: 'KG', department: '' },
    ];
    const base = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).includes('/api/master/items')) {
        return res(200, [{ id: 9, code: 'RM-002', name: 'Slit Film', departmentId: 2, departmentName: 'Slitting' }]);
      }
      return base(url, opts);
    };
    mount();
    await openItemMaster();
    // RM-002 had no department -> picked up "Slitting" from the item master (shown in its row)
    const row2 = (await screen.findByText('Slit Film')).closest('tr');
    await waitFor(() => expect(row2.textContent).toContain('Slitting'));
    const row1 = screen.getByText('BOPP Film').closest('tr');
    expect(row1.textContent).toContain('Printing');   // manual choice untouched

    // Save persists the auto-filled department into the blob
    fireEvent.click(screen.getByRole('button', { name: '💾 Save' }));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const items = lastSavedItems();
    expect(items.find((r) => r.itemCode === 'RM-002').department).toBe('Slitting');
    expect(items.find((r) => r.itemCode === 'RM-001').department).toBe('Printing');
  });
});
