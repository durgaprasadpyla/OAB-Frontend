import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import DropdownAdmin from '../components/DropdownAdmin.jsx';
import { UOM_DEFAULTS, DROPDOWN_DEFS } from '../lib/dropdowns.js';

// Issues 2.6 — the batch the business sent on 2026-09-02:
//   · the Item Master UOM picker offered KG / Kgs / NO'S / NO'S / BOX / LTR / MTR /
//     ROLL together, because it was built from whatever the catalog rows carried.
//     UOM becomes a master the Super Admin keeps, alongside Store Locations.
//   · an item edited in the Item Master kept its OLD unit downstream (BOM showed
//     "cages" after it was changed to metres) — server-side, MasterDataService.
//   · after saving a BOM the QC could not get back to the JSS list.
//   · the invoice regains Back to Edit / Confirm and Update OAB (flows.test.jsx).

const res = (status, body) => ({
  status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

let uomRows;
let calls;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'superadmin');
  uomRows = [];
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    calls.push({ u: u.replace(/^.*\/api/, '/api'), method, body });
    if (u.includes('/api/auth/me')) return res(200, { username: 'superadmin', role: 'superadmin' });
    if (u.includes('/api/master/uoms')) {
      if (method === 'POST') {
        const row = { id: uomRows.length + 1, name: body.name, active: true };
        if (!uomRows.some((r) => r.name.toLowerCase() === body.name.toLowerCase())) uomRows.push(row);
        return res(201, row);
      }
      if (method === 'PUT') {
        const id = Number(u.split('/').pop());
        const row = uomRows.find((r) => r.id === id);
        if (row) { if (body.name != null) row.name = body.name; if (body.active != null) row.active = body.active; }
        return res(200, row || {});
      }
      if (method === 'DELETE') {
        const id = Number(u.split('/').pop());
        uomRows = uomRows.filter((r) => r.id !== id);
        return res(200, { deleted: true });
      }
      return res(200, uomRows.map((r) => ({ ...r })));
    }
    if (u.includes('/api/master/departments')) return res(200, []);
    if (u.includes('/api/master/machines')) return res(200, []);
    if (u.includes('/api/master/dispatch-types')) return res(200, []);
    if (u.includes('/api/stores/locations')) return res(200, []);
    if (u.includes('/rest/v1/oab_data')) {
      if (method === 'GET') return res(200, [{ id: 12, data: JSON.stringify({ dropdowns: {} }), version: 1 }]);
      return res(201, { id: body.id, version: 2 });
    }
    return res(200, []);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = () => render(<MemoryRouter><AuthProvider><DataProvider><DropdownAdmin /></DataProvider></AuthProvider></MemoryRouter>);
const openUom = async () => fireEvent.click(await screen.findByText('UOM'));

describe('Issues 2.6 §B — UOM is a master the Super Admin keeps', () => {
  it('lists UOM alongside the other drop-down selections, backed by the uom master', () => {
    const def = DROPDOWN_DEFS.find((d) => d.key === 'uoms');
    expect(def).toBeTruthy();
    expect(def.label).toBe('UOM');
    expect(def.master).toBe('uom');   // normalized, not the sales blob (PAdmin cannot read that)
  });

  it('keeps exactly the four units the business asked to retain as the built-in list', () => {
    expect(UOM_DEFAULTS).toEqual(['Kg', 'Lt', 'Mtr', "No's"]);
  });

  it('offers the four defaults until something is saved, and can seed them in one click', async () => {
    mount();
    await openUom();
    await screen.findByText(/Nothing saved yet/);
    expect(screen.getByText(/Kg, Lt, Mtr, No's/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Add these to the list/ }));
    await waitFor(() => expect(uomRows.map((r) => r.name)).toEqual(['Kg', 'Lt', 'Mtr', "No's"]));
    await waitFor(() => expect(screen.queryByText(/Nothing saved yet/)).toBeNull());
  });

  it('adds, renames, retires and deletes a unit through the master endpoints', async () => {
    uomRows = [{ id: 1, name: 'Kg', active: true }];
    mount();
    await openUom();
    await screen.findByLabelText('Unit Kg');

    // add
    fireEvent.change(screen.getByLabelText('New unit'), { target: { value: 'Mtr' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    await waitFor(() => expect(uomRows.map((r) => r.name)).toContain('Mtr'));

    // rename on blur
    fireEvent.blur(screen.getByLabelText('Unit Kg'), { target: { value: 'Kgs' } });
    await waitFor(() => expect(uomRows.find((r) => r.id === 1).name).toBe('Kgs'));

    // retire, then delete
    fireEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0]);
    await waitFor(() => expect(uomRows.find((r) => r.id === 1).active).toBe(false));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByLabelText('Delete unit Kgs'));
    await waitFor(() => expect(uomRows.some((r) => r.id === 1)).toBe(false));
  });

  it('never writes the unit list into the sales blob — the PAdmin Item Master cannot read it', async () => {
    mount();
    await openUom();
    await screen.findByLabelText('New unit');
    const before = calls.length;          // ignore anything the page does on mount
    fireEvent.change(screen.getByLabelText('New unit'), { target: { value: 'Lt' } });
    const addBtn = screen.getAllByRole('button', { name: /Add/ }).find((b) => b.textContent.trim().endsWith('Add'));
    fireEvent.click(addBtn);
    await waitFor(() => expect(uomRows.map((r) => r.name)).toContain('Lt'));
    const after = calls.slice(before);
    expect(after.some((c) => c.u.includes('/rest/v1/oab_data') && c.method === 'POST')).toBe(false);
    expect(after.some((c) => c.u === '/api/master/uoms' && c.method === 'POST')).toBe(true);
  });

  it('shows Store Locations in the same list, so racks are managed here too', async () => {
    mount();
    const row = (await screen.findByText('Store Locations')).closest('tr');
    expect(within(row).getByText(/Stores/)).toBeInTheDocument();
  });
});
