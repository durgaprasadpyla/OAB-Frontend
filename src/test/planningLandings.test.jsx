import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import PpcDashboard from '../pages/PpcDashboard.jsx';
import MisStatus from '../pages/MisStatus.jsx';
import PlanReadiness from '../pages/PlanReadiness.jsx';

// The three Enhancements 2.0 planning-module landing pages render their role-specific
// content from the existing planning / reports / production endpoints (no new backend).
// Each test drives the page with a tailored fetch mock.

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

/** Route fetch by URL substring; records every call so tests can assert writes. */
function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    calls.push({ u, method, body });
    for (const [pat, fn] of routes) { if (u.includes(pat)) return fn(u, method, body); }
    return res(200, {});
  };
  return calls;
}

beforeEach(() => { localStorage.clear(); localStorage.setItem('blm_token', 't'); });

describe('PPC dashboard (/ppc)', () => {
  it('shows the planning identity, planned-vs-actual and links into the workspace', async () => {
    mockFetch([
      ['/api/auth/me', () => res(200, { username: 'ppc', role: 'ppc' })],
      ['/api/planning/pool', () => res(200, [{ so: '26/500' }, { so: '26/501' }])],
      ['/api/reports/production', () => res(200, [{ group: 'Printing', plannedQty: 1000, actualQty: 800, wastageQty: 50 }])],
      ['/api/planning/week', () => res(200, { jobs: [], capacity: [{ date: '2026-08-25', machineName: 'CI Flexo', jobs: 1, usedMinutes: 100, capMinutes: 720, overbooked: false }] })],
    ]);
    render(<MemoryRouter><PpcDashboard /></MemoryRouter>);
    expect(await screen.findByText(/PPC — Production Planning Dashboard/)).toBeInTheDocument();
    // planned-vs-actual by department renders
    expect(await screen.findByText('Printing')).toBeInTheDocument();
    // the Ready-to-Plan KPI reflects the pool size
    expect(screen.getByText('Ready to Plan').closest('.stat')).toHaveTextContent('2');
    // primary navigation into the planning workspace
    expect(screen.getByText('🗓 Weekly Planner')).toBeInTheDocument();
    expect(screen.getByText('📋 Daily Machine Board')).toBeInTheDocument();
  });
});

describe('MIS status (/mis)', () => {
  it('shows the status board and a Record Actuals action', async () => {
    mockFetch([
      ['/api/auth/me', () => res(200, { username: 'mis', role: 'mis' })],
      ['/api/production/pending', () => res(200, [{ so: '26/500', stageSeq: 1, departmentName: 'Printing', remaining: 500, status: 'In Progress' }])],
      ['/api/reports/production', () => res(200, [{ group: 'Printing', plannedQty: 1000, actualQty: 800, wastageQty: 50 }])],
      ['/api/reports/utilization', () => res(200, [{ machine: 'CI Flexo', availableMinutes: 720, plannedMinutes: 100, changeoverMinutes: 20, idleMinutes: 600, utilizationPct: 16, actualQty: 800, wastageQty: 50 }])],
    ]);
    render(<MemoryRouter><MisStatus /></MemoryRouter>);
    expect(await screen.findByText(/MIS — Production Status/)).toBeInTheDocument();
    // the pending stage from the production pool appears on the status board
    expect(await screen.findByText('26/500')).toBeInTheDocument();
    expect(screen.getByText('🏭 Record Actuals')).toBeInTheDocument();
  });
});

describe('PLAN readiness (/plan)', () => {
  const oabBlob = { OAB: { SF: [{ so: '26/500', spec: 'A1', customer: 'ACME', poQty: 20000, closed: false }], OT: [] }, INV_REG: [] };

  function mountPlan() {
    const calls = mockFetch([
      ['/api/auth/me', () => res(200, { username: 'plan', role: 'plan' })],
      ['/rest/v1/oab_data', () => res(200, [{ id: 1, data: JSON.stringify(oabBlob), version: 1 }])],
      ['/api/planning/pool', () => res(200, [])],
      ['/api/planning/ready', (u, m, b) => res(200, { readyMode: b.mode || 'COMPLETE', readyQty: b.readyQty })],
    ]);
    render(
      <MemoryRouter>
        <AuthProvider><DataProvider><PlanReadiness /></DataProvider></AuthProvider>
      </MemoryRouter>,
    );
    return calls;
  }

  it('lists open sale orders and marks one Ready to Plan', async () => {
    const calls = mountPlan();
    expect(await screen.findByText(/Planning — Ready to Plan/)).toBeInTheDocument();
    // the open SO from module 1 is listed
    const soCell = await screen.findByText('26/500');
    const row = soCell.closest('tr');
    // choose Complete and mark ready
    await userEvent.selectOptions(within(row).getByRole('combobox'), 'COMPLETE');
    await userEvent.click(within(row).getByRole('button', { name: /Mark Ready/i }));
    // it hit the readiness endpoint for this SO
    const readyCall = calls.find((c) => c.u.includes('/api/planning/ready') && c.method === 'POST');
    expect(readyCall).toBeTruthy();
    expect(readyCall.body).toMatchObject({ so: '26/500', ready: true, mode: 'COMPLETE' });
  });

  it('offers weekly and daily plan downloads', async () => {
    mountPlan();
    expect(await screen.findByText('⬇ Daily Plan (xlsx)')).toBeInTheDocument();
    expect(screen.getByText('⬇ Weekly Plan (xlsx)')).toBeInTheDocument();
  });
});
