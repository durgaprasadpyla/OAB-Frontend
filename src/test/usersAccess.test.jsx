import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersAccess from '../components/UsersAccess.jsx';

// UsersAccess talks to /api/admin/users via usersApi (not the data context), so
// it renders standalone with a small fetch mock modelling the admin endpoints.
function installUsersFetch(initial) {
  const users = initial.slice();
  const res = (status, data) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: () => 'application/json' },
    json: async () => data, text: async () => JSON.stringify(data),
  });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.includes('/api/admin/users')) {
      if (method === 'GET') return res(200, users);
      if (method === 'POST') {
        if (users.some((x) => x.username === body.username)) return res(409, 'exists');
        const nu = { id: users.length + 1, username: body.username, role: body.role, disabled: false };
        users.push(nu); return res(201, nu);
      }
      if (method === 'PUT') {
        const id = Number(u.split('/').pop());
        const usr = users.find((x) => x.id === id);
        if (usr) { if (body.role != null) usr.role = body.role; if (body.disabled != null) usr.disabled = body.disabled; }
        return res(200, usr || {});
      }
    }
    return res(200, {});
  };
  return users;
}

describe('Users & Access', () => {
  beforeEach(() => { try { localStorage.setItem('blm_token', 't'); } catch { /* ignore */ } });

  it('lists users and adds a new one via the admin API', async () => {
    const user = userEvent.setup();
    const store = installUsersFetch([
      { id: 1, username: 'superadmin', role: 'superadmin', disabled: false },
      { id: 2, username: 'qcguy', role: 'qc', disabled: false },
    ]);
    render(<UsersAccess />);
    await screen.findByText('superadmin');
    expect(screen.getByText('qcguy')).toBeInTheDocument();

    const addCard = screen.getByText('Add User').closest('.card');
    const inputs = addCard.querySelectorAll('input');   // [username, password]
    await user.type(inputs[0], 'newbie');
    await user.type(inputs[1], 'pw@123');
    await user.click(within(addCard).getByRole('button', { name: /Add User/ }));

    await waitFor(() => expect(store.some((u) => u.username === 'newbie')).toBe(true));
    expect(await screen.findByText('newbie')).toBeInTheDocument();
    expect(store.find((u) => u.username === 'newbie').role).toBe('user');
  });

  it('disables a user via the admin API', async () => {
    const user = userEvent.setup();
    const store = installUsersFetch([{ id: 1, username: 'superadmin', role: 'superadmin', disabled: false }, { id: 2, username: 'plantguy', role: 'plant', disabled: false }]);
    render(<UsersAccess />);
    await screen.findByText('plantguy');

    const row = screen.getByText('plantguy').closest('tr');
    await user.click(within(row).getByRole('button', { name: /Disable/ }));

    await waitFor(() => expect(store.find((u) => u.id === 2).disabled).toBe(true));
  });
});
