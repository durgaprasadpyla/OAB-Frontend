import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import DropdownAdmin from '../components/DropdownAdmin.jsx';

// Enhancements 2.0 §5: Super Admin → Dashboard → Drop-down selections → Departments.
// Departments are managed here but backed by the shared normalized Department master
// (/api/master/departments) — the SAME source the PAdmin Item Master reads — so there is
// no duplicate master and the padmin role (which cannot read the sales blob) still works.

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

let depts, created, deptFail;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'superadmin');
  depts = [{ id: 1, name: 'Printing', active: true }, { id: 2, name: 'Slitting', active: true }];
  created = [];
  deptFail = false;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.includes('/api/auth/me')) return res(200, { username: 'admin', role: 'superadmin' });
    if (u.includes('/api/master/departments')) {
      if (method === 'GET' && deptFail) return res(500, 'boom');   // Department master unreachable
      if (method === 'POST') { const d = { id: depts.length + 1, name: body.name, active: true }; depts.push(d); created.push(body); return res(201, d); }
      return res(200, depts);
    }
    if (u.includes('/rest/v1/oab_data')) { return method === 'GET' ? res(200, []) : res(201, { id: body.id, version: 2 }); }
    return res(200, {});
  };
});

function mount() {
  return render(<MemoryRouter><AuthProvider><DataProvider><DropdownAdmin /></DataProvider></AuthProvider></MemoryRouter>);
}

describe('Drop-down selections → Departments', () => {
  it('shows Departments (backed by the master) and lists existing departments', async () => {
    mount();
    // "Departments" is the first category and opens its master-backed manager by default.
    expect(await screen.findByPlaceholderText('New department name')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Printing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Slitting')).toBeInTheDocument();
  });

  it('adds a department via the Department master (/api/master/departments)', async () => {
    mount();
    await userEvent.type(await screen.findByPlaceholderText('New department name'), 'Lamination');
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    await waitFor(() => expect(created.some((c) => c.name === 'Lamination')).toBe(true));
    // reload reflects it — proving the Item Master (same endpoint) would see it too
    expect(await screen.findByDisplayValue('Lamination')).toBeInTheDocument();
  });

  it('surfaces a user-facing error when the Department master cannot be loaded (not a silent empty)', async () => {
    deptFail = true;
    mount();
    // the failure is shown to the user, not masked as "no departments"
    expect(await screen.findByText(/Couldn’t load the Department master/)).toBeInTheDocument();
    expect(screen.queryByText(/No departments yet/)).toBeNull();
    // the add field is still usable (graceful, page not broken)
    expect(screen.getByPlaceholderText('New department name')).toBeInTheDocument();
  });

  it('handles no configured departments gracefully', async () => {
    depts = [];
    mount();
    expect(await screen.findByText(/No departments yet/)).toBeInTheDocument();
  });
});
