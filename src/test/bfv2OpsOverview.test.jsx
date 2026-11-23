import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import OpsOverview, { overviewTiles } from '../pages/OpsOverview.jsx';
import Production from '../pages/Production.jsx';
import { canAccess, navTabs } from '../lib/roles.js';

// BloomFlex V2 — Operations Overview + reject vs scrap on the production entry form.

const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const OVERVIEW = {
  date: '2026-11-19', openSos: 12, readyToPlan: 5, notReady: 3, unmarked: 4, shortageSos: 2,
  plannedMinutes: 900, capacityMinutes: 1440, jobsToday: 6, delayedStartsToday: 1,
  productionToday: { good: 42000, wastage: 800, reject: 300 },
  dispatchedToday: 4,
  pendingStockCounts: null, bomPending: null, draftPlanJobs: 7,
  machines: [
    { machineId: 1, code: 'P1', name: 'CI Flexo', departmentName: 'Printing', plannedMinutes: 600, capMinutes: 720, jobs: 4, overbooked: false },
    { machineId: 2, code: 'L1', name: 'Laminator', departmentName: 'Lamination', plannedMinutes: 300, capMinutes: 720, jobs: 2, overbooked: false },
  ],
  attentionTotal: 1,
  attention: [{ so: '26/650', customer: 'Acme', jobName: 'Pouch', poDate: '2026-11-01', dueDate: '2026-11-25', readyToPlan: false, notReadyReason: 'PLATES', shortages: 2 }],
};

let posted;
function installFetch() {
  posted = [];
  let recorded = false;
  const stages = () => ([
    { stageSeq: 1, departmentId: 1, departmentName: 'Printing', qtyIn: 50000, qtyCompleted: recorded ? 20000 : 0, qtyWastage: 0, qtyReject: recorded ? 500 : 0, remaining: recorded ? 29500 : 50000, status: recorded ? 'Partially Completed' : 'Not Started' },
  ]);
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url); const method = (opts.method || 'GET').toUpperCase();
    if (method !== 'GET') posted.push({ u, body: JSON.parse(opts.body || '{}') });
    if (u.includes('/api/overview')) return res(OVERVIEW);
    if (u.includes('/api/master/machines')) return res([]);
    if (u.includes('/api/production/pending')) return res([{ so: '26/500', stageSeq: 1, departmentName: 'Printing', remaining: 50000, status: 'Not Started' }]);
    if (u.includes('/api/production/record') && method === 'POST') { recorded = true; return res({ so: '26/500', hasRoute: true, stages: stages(), runs: [{ id: 1, prodDate: '2026-11-19', departmentName: 'Printing', producedQty: 20000, wastageQty: 0, rejectQty: 500, note: 'ink smear', actor: 'mis1' }] }); }
    if (u.includes('/api/production') && u.includes('so=')) return res({ so: '26/500', hasRoute: true, stages: stages(), runs: [] });
    if (u.includes('/api/auth/me')) return res({});
    return res({});
  });
}

function asRole(role) {
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', role);
}

beforeEach(() => installFetch());
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('Operations Overview — access', () => {
  it('is open to superadmin, pm and ppc only', () => {
    ['superadmin', 'pm', 'ppc'].forEach((r) => expect(canAccess(r, '/overview')).toBe(true));
    ['plant', 'mis', 'plan', 'qc', 'user', 'stores'].forEach((r) => expect(canAccess(r, '/overview')).toBe(false));
    expect(navTabs('superadmin').some((t) => t.to === '/overview')).toBe(true);
  });
});

describe('Operations Overview — tiles', () => {
  it('drops tiles whose value is null', () => {
    const keys = overviewTiles(OVERVIEW).map((t) => t.k);
    expect(keys).toContain('draft');          // 7
    expect(keys).not.toContain('bom');        // null — feature not installed
    expect(keys).not.toContain('counts');     // null
  });

  it('renders the tiles, the journey, the attention list and the machine bars', async () => {
    asRole('ppc');
    render(<AuthProvider><MemoryRouter><OpsOverview /></MemoryRouter></AuthProvider>);
    const tiles = await screen.findByTestId('overview-tiles');
    expect(within(screen.getByTestId('tile-open')).getByText('12')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-short')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-draft')).getByText('7')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-good')).getByText(/rejected 300/)).toBeInTheDocument();
    expect(screen.queryByTestId('tile-bom')).toBeNull();
    expect(screen.queryByTestId('tile-counts')).toBeNull();
    expect(tiles).toBeInTheDocument();
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/api/overview?date='))).toBe(true);

    // Journey: PPC may open its planner and today's board, not the QC desk.
    expect(screen.getByRole('link', { name: /PPC planner/ })).toHaveAttribute('href', '/ppc');
    expect(screen.getByRole('link', { name: /Today’s board/ })).toHaveAttribute('href', '/board');
    expect(screen.queryByRole('link', { name: /QC Route & BOM/ })).toBeNull();
    expect(screen.getByText(/QC Route & BOM/)).toBeInTheDocument();

    expect(screen.getByText('26/650')).toBeInTheDocument();
    expect(screen.getByText(/Not ready · PLATES/)).toBeInTheDocument();
    expect(screen.getByText('2 shortages')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'CI Flexo load' })).toHaveAttribute('aria-valuenow', '83');
  });
});

describe('Production entry — reject vs scrap', () => {
  it('posts rejectQty and the note, and shows the Rejected column', async () => {
    asRole('mis');
    render(<AuthProvider><Production /></AuthProvider>);
    await waitFor(() => expect(screen.getAllByText('26/500').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '26/500' } });
    await waitFor(() => expect(screen.getByText('Printing')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getAllByRole('spinbutton')[0], { target: { value: '20000' } });
    fireEvent.change(within(dialog).getByLabelText('Rejected'), { target: { value: '500' } });
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'ink smear' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record' }));

    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/production/record'))).toBe(true));
    expect(posted.find((p) => p.u.includes('/api/production/record')).body)
      .toMatchObject({ so: '26/500', stageSeq: 1, producedQty: 20000, wastageQty: 0, rejectQty: 500, note: 'ink smear' });
    await waitFor(() => expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0));
    expect(screen.getByText('ink smear')).toBeInTheDocument();
  });

  it('always sends rejectQty (0 when blank) so the server applies the note rule', async () => {
    asRole('mis');
    render(<AuthProvider><Production /></AuthProvider>);
    await waitFor(() => expect(screen.getAllByText('26/500').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '26/500' } });
    await waitFor(() => expect(screen.getByText('Printing')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getAllByRole('spinbutton')[0], { target: { value: '1000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/production/record'))).toBe(true));
    expect(posted.find((p) => p.u.includes('/api/production/record')).body.rejectQty).toBe(0);
  });
});
