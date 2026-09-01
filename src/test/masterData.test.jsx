import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import MasterData from '../pages/MasterData.jsx';
import { landingPath, canAccess, navTabs, ROLE_LABEL } from '../lib/roles.js';

/* ───────────────────────── roles.js wiring (Stage 2) ───────────────────────── */

describe('planning roles wiring', () => {
  it('labels the new planner and stores roles', () => {
    expect(ROLE_LABEL.planner).toBe('Planner');
    expect(ROLE_LABEL.stores).toBe('Stores');
    // existing labels untouched
    expect(ROLE_LABEL.hr).toBe('HR');
    expect(ROLE_LABEL.superadmin).toBe('Super Admin');
  });

  it('lands planner on the weekly planner and stores on its own desk', () => {
    expect(landingPath('planner')).toBe('/planner');
    // Stores used to land on the Master Data hub; it now has a desk of its own.
    expect(landingPath('stores')).toBe('/stores');
    // existing landings untouched
    expect(landingPath('qc')).toBe('/qc');
    expect(landingPath('superadmin')).toBe('/po');
  });

  it('opens /master to superadmin, padmin, planner and stores only', () => {
    ['superadmin', 'padmin', 'planner', 'stores'].forEach((r) => expect(canAccess(r, '/master')).toBe(true));
    ['user', 'qc', 'pm', 'plant', 'purchase', 'scrap', 'hr', 'sales'].forEach((r) => expect(canAccess(r, '/master')).toBe(false));
  });

  it('does NOT put Master Data in the main header — §6 moves it into the Dashboard', () => {
    // Enhancements 2.0 §6: no separate main-header Master Data tab.
    expect(navTabs('superadmin').some((t) => t.to === '/master')).toBe(false);
    expect(navTabs('padmin').some((t) => t.to === '/master')).toBe(false);
    expect(navTabs('planner')).toEqual([]);   // panel role — no ops tabs
    // the existing ops tabs are still present
    expect(navTabs('superadmin').some((t) => t.to === '/po')).toBe(true);
    // but the /master route is still reachable for the roles that use it directly
    expect(canAccess('superadmin', '/master')).toBe(true);
    expect(canAccess('stores', '/master')).toBe(true);
  });
});

/* ───────────────────────── MasterData page render ───────────────────────── */

function mockMaster(role, data = {}) {
  const res = (status, body) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: () => 'application/json' },
    json: async () => body, text: async () => JSON.stringify(body),
  });
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/api/auth/me')) return res(200, { username: 'u', role });
    if (u.includes('/api/master/departments')) return res(200, data.departments || []);
    if (u.includes('/api/master/specialties')) return res(200, data.specialties || []);
    if (u.includes('/api/master/machines')) return res(200, data.machines || []);
    if (u.includes('/api/master/routes')) return res(200, data.routes || []);
    if (u.includes('/api/master/dispatch-types')) return res(200, data.dispatch || []);
    if (u.includes('/api/master/items')) return res(200, data.items || []);
    if (u.includes('/api/stock/alerts')) return res(200, data.alerts || []);
    if (u.includes('/api/notifications')) return res(200, data.notifications || []);
    return res(200, {});
  });
}

function renderMaster(role, data) {
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', role);
  localStorage.setItem('blm_user', 'u');
  mockMaster(role, data);
  return render(
    <MemoryRouter initialEntries={['/master']}>
      <AuthProvider><MasterData /></AuthProvider>
    </MemoryRouter>,
  );
}

describe('MasterData page', () => {
  afterEach(() => { cleanup(); localStorage.clear(); });

  const seed = {
    departments: [{ id: 1, name: 'Printing', code: 'PRINT', seqHint: 1, active: true }],
    routes: [{ id: 5, name: 'Print-Pouch', code: 'PP', active: true, stages: [{ seq: 1, departmentId: 1, departmentName: 'Printing' }] }],
  };

  it('lets superadmin configure — shows tabs, data and Add buttons', async () => {
    renderMaster('superadmin', seed);
    await waitFor(() => expect(screen.getByText('Printing')).toBeInTheDocument());
    // tab bar present
    expect(screen.getByRole('button', { name: 'Routes' })).toBeInTheDocument();
    // superadmin gets an Add button for the config section
    expect(screen.getByRole('button', { name: /Add/ })).toBeInTheDocument();
  });

  it('routes belong to a Dispatch Form — shows the column and the form dropdown (§4/§13)', async () => {
    renderMaster('superadmin', {
      departments: [{ id: 1, name: 'Printing', active: true }],
      dispatch: [{ id: 9, name: 'Pouch', active: true }, { id: 10, name: 'Roll', active: true }],
      routes: [{ id: 5, name: 'Pouch-A', code: 'PA', active: true, dispatchTypeId: 9, dispatchTypeName: 'Pouch',
        stages: [{ seq: 1, departmentId: 1, departmentName: 'Printing' }] }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Routes' }));
    // the route list carries a Dispatch Form column with the route's form
    expect(await screen.findByText('Dispatch Form')).toBeInTheDocument();
    expect(screen.getByText('Pouch')).toBeInTheDocument();
    // Add Route → the form's Dispatch Form dropdown offers the "Dispatch Forms —
    // Sales SKUs" list (change 8), not the raw dispatch_type master.
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/Dispatch Form/)).toBeInTheDocument();
    expect(within(dlg).getByRole('option', { name: 'Pouch' })).toBeInTheDocument();
    expect(within(dlg).getByRole('option', { name: 'Roll' })).toBeInTheDocument();
    expect(within(dlg).getByRole('option', { name: 'Bulk Bags' })).toBeInTheDocument();  // from the SKU list defaults
  });

  it('machines get an Enable/Disable toggle after Edit (change 7)', async () => {
    renderMaster('superadmin', {
      ...seed,
      machines: [{ id: 3, code: 'CI', name: 'SOMA', departmentId: 1, departmentName: 'Printing', defaultSpeed: 250, speedUom: 'm/min', functionalHoursPerDay: 8, active: true }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Machines' }));
    await waitFor(() => expect(screen.getByText('SOMA')).toBeInTheDocument());
    const row = screen.getByText('SOMA').closest('tr');
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    // enabled machine shows Disable; clicking it PUTs active:false
    fireEvent.click(within(row).getByRole('button', { name: 'Disable' }));
    await waitFor(() => {
      const puts = globalThis.fetch.mock.calls.filter(([u, o]) => String(u).includes('/api/master/machines/3') && (o?.method || '') === 'PUT');
      expect(puts.length).toBe(1);
      expect(JSON.parse(puts[0][1].body)).toMatchObject({ active: false });
    });
  });

  it('shows a read-only view for planner (no Add controls)', async () => {
    renderMaster('planner', seed);
    await waitFor(() => expect(screen.getByText('Printing')).toBeInTheDocument());
    expect(screen.getByText(/Read-only view/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^＋ Add$/ })).toBeNull();
  });

  it('surfaces open stock alerts (with resolve) and notifications for superadmin', async () => {
    renderMaster('superadmin', {
      ...seed,
      alerts: [{ id: 7, so: '26/500', itemCode: 'FILM', itemName: 'Film XYZ', requiredQty: 10000, availableQty: 7000, shortageQty: 3000, status: 'OPEN' }],
      notifications: [{ id: 3, kind: 'LOW_STOCK', message: 'SO 26/500: FILM short by 3000', status: 'UNREAD', createdAt: '2026-08-24T10:00:00' }],
    });
    await waitFor(() => expect(screen.getByText('Printing')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Stock Alerts/ }));
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    expect(screen.getAllByText(/FILM/).length).toBeGreaterThan(0);   // alert row + notification
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(screen.getByText(/short by 3000/)).toBeInTheDocument();   // the notification message
  });
});
