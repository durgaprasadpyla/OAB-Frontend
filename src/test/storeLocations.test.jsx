import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import DropdownAdmin from '../components/DropdownAdmin.jsx';

// Issues 2.4 §13: Super Admin → Dashboard → Drop-down selections → Store Locations.
//
// The racks the stores desk puts received material away in — A2, CG, B3, AG, U2.
// Backed by the normalized store_location master rather than the sales blob,
// because the stores role cannot read that blob: a list kept there would never
// reach the GRN screen, which is exactly how the despatch forms went missing.

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

let locs, calls;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'superadmin');
  locs = [{ id: 1, name: 'A2', active: true }, { id: 2, name: 'CG', active: true }];
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.includes('/api/auth/me')) return res(200, { username: 'admin', role: 'superadmin' });
    if (u.includes('/api/stores/locations')) {
      calls.push({ method, u, body });
      if (method === 'POST') { const d = { id: locs.length + 1, name: body.name, active: true }; locs.push(d); return res(201, d); }
      if (method === 'PATCH') {
        const id = Number(u.split('/').pop());
        locs = locs.map((d) => (d.id === id ? { ...d, ...body } : d));
        return res(200, locs.find((d) => d.id === id));
      }
      if (method === 'DELETE') {
        const id = Number(u.split('/').pop());
        // B3 has stock on it — the server retires rather than deletes.
        if (id === 9) return res(200, { retired: true, units: 4, message: 'B3 is stamped on 4 unit(s), so it was retired rather than deleted.' });
        locs = locs.filter((d) => d.id !== id);
        return res(200, { deleted: true });
      }
      return res(200, locs);
    }
    if (u.includes('/api/master/')) return res(200, []);
    if (u.includes('/rest/v1/oab_data')) {
      if (method === 'GET') return res(200, [{ id: 12, data: '{}', version: 1 }]);
      return res(201, { id: body.id, version: 2 });
    }
    return res(200, {});
  };
});
afterEach(() => vi.restoreAllMocks());

function mount() {
  return render(<MemoryRouter><AuthProvider><DataProvider><DropdownAdmin /></DataProvider></AuthProvider></MemoryRouter>);
}

async function openStoreLocations() {
  mount();
  fireEvent.click(await screen.findByText('Store Locations'));
  return screen.findByPlaceholderText('New location (e.g. A2)');
}

describe('Drop-down selections → Store Locations', () => {
  it('lists the racks the Super Admin has configured', async () => {
    await openStoreLocations();
    expect(await screen.findByDisplayValue('A2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('CG')).toBeInTheDocument();
  });

  it('adds a rack', async () => {
    const input = await openStoreLocations();
    fireEvent.change(input, { target: { value: 'B3' } });
    fireEvent.click(screen.getByRole('button', { name: '＋ Add' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.body.name === 'B3')).toBe(true));
    expect(await screen.findByDisplayValue('B3')).toBeInTheDocument();
  });

  it('renames a rack when the box loses focus', async () => {
    await openStoreLocations();
    const box = await screen.findByLabelText('Store location A2');
    fireEvent.blur(box, { target: { value: 'A2 (upper)' } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.body.name === 'A2 (upper)')).toBe(true));
  });

  it('retires rather than deletes a rack that has stock on it, and says so', async () => {
    locs = [{ id: 9, name: 'B3', active: true }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openStoreLocations();
    fireEvent.click(await screen.findByLabelText('Delete store location B3'));
    expect(await screen.findByText(/retired rather than deleted/)).toBeInTheDocument();
  });

  it('leaves the rack alone when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openStoreLocations();
    fireEvent.click(await screen.findByLabelText('Delete store location A2'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});
