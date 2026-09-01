import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';

// Issues 2.2 — the two items that were not already covered by Issues 2.0 / 3.0.
//
//  §2 The despatch forms the super admin maintains reach QC's Add-JSS Dispatch Form
//     without anyone opening the Drop-down selections tab.
//  §7 The PLAN login lists the PM board's display fields — SKU and FILM WIDTH above
//     all — but none of the PM board's printed-metres ENTRY (that is MIS's job).

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/* ── §7 the PLAN board ──────────────────────────────────────────────────── */

const OAB = {
  OAB: {
    SF: [
      { so: '2026/1', spec: 'A1', customer: 'Acme', jobName: 'stale copy', poQty: 10000, invDisp: 2000, manDisp: 0, dispLoc: 'Hyderabad', closed: false },
      { so: '2026/2', spec: 'A2', customer: 'Bharat', jobName: 'Roll B', poQty: 500, invDisp: 0, manDisp: 0, dispLoc: 'Hosur', closed: false },
      { so: '2026/3', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', poQty: 100, invDisp: 100, manDisp: 0, closed: true },
    ],
    OT: [],
  },
};
const JSS = [
  { spec: 'A1', customer: 'Acme', jobName: 'Pouch A 250g', material: 'BOPP/PE', filmWidth: 750, mic: '40', gsm: 60, width: 140, height: 360, pouchWeight: 4.2, dispatchForm: 'Pouch' },
  { spec: 'A2', customer: 'Bharat', jobName: 'Roll B', material: 'PET', filmWidth: 940, mic: '12', gsm: 72, width: 0, height: 0, dispatchForm: 'Roll' },
];

function mountPlan() {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/api/auth/me')) return res(200, { username: 'plan1', role: 'plan' });
    if (u.includes('/api/planning/readiness')) return res(200, []);
    if (u.includes('/api/planning/week')) return res(200, { jobs: [] });
    if (u.includes('/rest/v1/oab_data')) {
      return res(200, [
        { id: 1, data: JSON.stringify(OAB), version: 1 },
        { id: 2, data: JSON.stringify(JSS), version: 1 },
      ]);
    }
    return res(200, []);
  });
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'plan');
  return import('../pages/PlanReadiness.jsx').then(({ default: PlanReadiness }) => render(
    <MemoryRouter><AuthProvider><DataProvider><PlanReadiness /></DataProvider></AuthProvider></MemoryRouter>,
  ));
}

describe('Issues 2.2 §7 — the PLAN login shows the PM board display fields', () => {
  it('lists SKU and Film Width against every open sale order', async () => {
    await mountPlan();
    const row = (await screen.findByText('2026/1')).closest('tr');

    // the SKU comes from the CURRENT spec, not the copy stored on the order
    expect(within(row).getByText('Pouch A 250g')).toBeInTheDocument();
    expect(within(row).queryByText('stale copy')).toBeNull();

    // the field the planner decides on
    expect(within(row).getByText('750')).toBeInTheDocument();
    // …plus the rest of the PM board's figures
    expect(within(row).getByText('BOPP/PE')).toBeInTheDocument();   // substrate
    expect(within(row).getByText('40')).toBeInTheDocument();        // microns
    expect(within(row).getByText('Hyderabad')).toBeInTheDocument(); // dispatch location
    expect(within(row).getByText('8,000')).toBeInTheDocument();     // balance (10000 − 2000)

    // the header carries both new columns
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(['SKU', 'Film W', 'Substrate', 'Total Kg', 'Total Mt']));
  });

  it('shows live orders only, and offers no printed-metres entry (that is MIS)', async () => {
    await mountPlan();
    await screen.findByText('2026/1');
    expect(screen.queryByText('2026/3')).toBeNull();          // closed order hidden

    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    ['Printed Kg', 'Printed Mt', 'Print Date', 'Bal Kg', 'Bal Mt'].forEach((h) => {
      expect(heads).not.toContain(h);
    });
  });

  it('filters the board by spec and by search text', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    await mountPlan();
    await screen.findByText('2026/1');
    await user.type(screen.getByLabelText('Search sale orders'), 'Bharat');
    await waitFor(() => expect(screen.queryByText('2026/1')).toBeNull());
    expect(screen.getByText('2026/2')).toBeInTheDocument();
  });
});

/* ── §2 the despatch master backfills from the Super Admin Dashboard ─────── */

describe('Issues 2.2 §2 — despatch forms reach QC without visiting Drop-down selections', () => {
  let created;
  beforeEach(() => {
    created = [];
    localStorage.clear();
    localStorage.setItem('blm_token', 't');
    localStorage.setItem('blm_role', 'superadmin');
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      const method = (opts.method || 'GET').toUpperCase();
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (u.includes('/api/auth/me')) return res(200, { username: 'boss', role: 'superadmin' });
      if (u.includes('/api/master/dispatch-types')) {
        if (method === 'POST') { created.push(body.name); return res(201, { id: 9, name: body.name }); }
        return res(200, [{ id: 100, name: 'Pouch' }, { id: 101, name: 'Roll' }]);
      }
      if (u.includes('/rest/v1/oab_data')) {
        // module 12 carries the super admin's FIVE despatch forms
        return res(200, [{ id: 12, data: JSON.stringify({ dropdowns: { despatch: ['Pouch', 'Roll', 'Label', 'Shrink Sleeve', 'Bulk Bags'] } }), version: 1 }]);
      }
      return res(200, []);
    });
  });

  it('the Super Admin Dashboard backfills the missing forms on mount', async () => {
    const { default: Dashboard } = await import('../pages/Dashboard.jsx');
    render(<MemoryRouter><AuthProvider><DataProvider><Dashboard /></DataProvider></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(created.slice().sort()).toEqual(['Bulk Bags', 'Label', 'Shrink Sleeve']));
    // the two already in the master are not duplicated
    expect(created).not.toContain('Pouch');
    expect(created).not.toContain('Roll');
  });
});
