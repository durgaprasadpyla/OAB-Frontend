import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
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

  it('lands planner and stores on the Master Data hub', () => {
    expect(landingPath('planner')).toBe('/master');
    expect(landingPath('stores')).toBe('/master');
    // existing landings untouched
    expect(landingPath('qc')).toBe('/qc');
    expect(landingPath('superadmin')).toBe('/po');
  });

  it('opens /master to superadmin, padmin, planner and stores only', () => {
    ['superadmin', 'padmin', 'planner', 'stores'].forEach((r) => expect(canAccess(r, '/master')).toBe(true));
    ['user', 'qc', 'pm', 'plant', 'purchase', 'scrap', 'hr', 'sales'].forEach((r) => expect(canAccess(r, '/master')).toBe(false));
  });

  it('adds a Master Data tab for superadmin and padmin, not other ops or panel roles', () => {
    expect(navTabs('superadmin').some((t) => t.to === '/master')).toBe(true);
    expect(navTabs('padmin').some((t) => t.to === '/master')).toBe(true);
    expect(navTabs('user').some((t) => t.to === '/master')).toBe(false);
    expect(navTabs('planner')).toEqual([]);   // panel role — no ops tabs
    // the existing ops tabs are still present
    expect(navTabs('superadmin').some((t) => t.to === '/po')).toBe(true);
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
