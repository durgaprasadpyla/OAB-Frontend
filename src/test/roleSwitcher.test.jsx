import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import App from '../App.jsx';

// The Super Admin's header badge is a "view as role" dropdown. It reads the role list
// from the server, renders the app as the picked role, and never touches the session:
// the token / blm_user / blm_role stay the Super Admin's, so the backend still sees them.

afterEach(() => { cleanup(); vi.restoreAllMocks(); try { sessionStorage.clear(); } catch { /* */ } });

const modules = { oab: oabModule(), jss: [], customers: [] };
const badge = () => screen.getByRole('button', { name: /superadmin/ });

describe('Super Admin role switcher', () => {
  it('opens below the badge with the server role list and the current role highlighted', async () => {
    renderApp(<App />, { modules, role: 'superadmin', user: 'superadmin', route: '/po' });
    await screen.findByText('New PO');
    expect(badge()).toHaveTextContent('superadmin (Super Admin)');
    expect(badge()).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(badge());
    expect(badge()).toHaveAttribute('aria-expanded', 'true');
    const list = await screen.findByRole('listbox');
    const opts = await within(list).findAllByRole('option');
    expect(opts.length).toBe(18);                                    // every role the server listed
    const sel = opts.filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(sel).toHaveLength(1);
    expect(sel[0]).toHaveTextContent('Super Admin');
  });

  it('switching renders that role’s landing + menus, keeps the session, and switches back', async () => {
    renderApp(<App />, { modules, role: 'superadmin', user: 'superadmin', route: '/po' });
    await screen.findByText('📊 Dashboard');                         // superadmin-only ops tab

    await userEvent.click(badge());
    await userEvent.click(await within(await screen.findByRole('listbox')).findByRole('option', { name: /Stores/ }));

    // Stores' own bar, no ops tabs, Super Admin still identified on the badge.
    await waitFor(() => expect(screen.queryByText('New PO')).toBeNull());
    expect(screen.getAllByText('Stores').length).toBeGreaterThan(0);
    expect(badge()).toHaveTextContent('superadmin (Viewing as Stores)');
    expect(screen.queryByRole('listbox')).toBeNull();                 // closed after selecting
    // The session is untouched: same token, same identity, same stored role.
    expect(localStorage.getItem('blm_token')).toBe('t');
    expect(localStorage.getItem('blm_user')).toBe('superadmin');
    expect(localStorage.getItem('blm_role')).toBe('superadmin');

    await userEvent.click(badge());
    await userEvent.click(await screen.findByRole('button', { name: /Back to Super Admin/ }));
    expect(await screen.findByText('📊 Dashboard')).toBeInTheDocument();
    expect(badge()).toHaveTextContent('superadmin (Super Admin)');
  });

  it('closes on an outside click', async () => {
    renderApp(<App />, { modules, role: 'superadmin', user: 'superadmin', route: '/po' });
    await screen.findByText('New PO');
    await userEvent.click(badge());
    await screen.findByRole('listbox');
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('is a plain badge for every other role, and a stale view-as is ignored', async () => {
    sessionStorage.setItem('blm_view_as', 'stores');                 // tampered / left over
    renderApp(<App />, { modules, role: 'padmin', user: 'pa', route: '/po' });
    await screen.findByText('New PO');
    expect(screen.queryByRole('button', { name: /pa \(Purchase Admin\)/ })).toBeNull();
    expect(screen.getByText(/pa \(Purchase Admin\)/)).toBeInTheDocument();
    expect(screen.getByText('📦 P Dashboard')).toBeInTheDocument();  // still padmin's own view
  });
});
