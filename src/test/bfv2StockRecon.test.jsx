// BloomFlex V2 — stock reconciliation + period stock movement on the Stores page.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StockReconciliation, { varianceOf, needsReason } from '../components/StockReconciliation.jsx';
import StockMovementReport, { daysAgo } from '../components/StockMovementReport.jsx';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import Stores from '../pages/Stores.jsx';

const res = (body, status = 200) => ({ status, ok: status < 400, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const MOVEMENT = {
  from: '2026-11-01', to: '2026-11-19',
  items: [
    { itemId: 1, code: 'FILM-1', name: 'BOPP 20', uom: 'Kg', active: true, opening: 100, receipts: 400, issues: 120, returns: 20, closing: 400 },
    { itemId: 2, code: 'INK-1', name: 'Cyan ink', uom: 'Kg', active: true, opening: 0, receipts: 0, issues: 0, returns: 0, closing: 0 },
  ],
};

function mockFetch(counts = [], posted = [], decided = []) {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/stores/stock-movement')) return res(MOVEMENT);
    const m = /\/api\/stores\/stock-counts\/(\d+)\/(approve|reject)/.exec(u);
    if (m) { decided.push([Number(m[1]), m[2]]); return res({ id: Number(m[1]), status: m[2] === 'approve' ? 'APPROVED' : 'REJECTED' }); }
    if (u.includes('/api/stores/stock-counts') && opts.method === 'POST') { posted.push(JSON.parse(opts.body)); return res({ id: 9, status: 'PENDING' }, 201); }
    if (u.includes('/api/stores/stock-counts')) return res(counts);
    return res([]);
  });
}

describe('variance rules', () => {
  it('variance is counted − system, and only a non-zero one needs a reason', () => {
    expect(varianceOf('395', 400)).toBe(-5);
    expect(varianceOf('', 400)).toBe(null);
    expect(needsReason(-5)).toBe(true);
    expect(needsReason(varianceOf('400.0005', 400))).toBe(false);
    expect(daysAgo(7, '2026-11-19')).toBe('2026-11-12');
  });
});

describe('Stock Reconciliation tab', () => {
  it('shows the live variance and will not submit without a reason', async () => {
    const posted = [];
    mockFetch([], posted);
    const user = userEvent.setup();
    render(<StockReconciliation canApprove={false} />);
    const counted = await screen.findByLabelText('Counted FILM-1');
    await user.type(counted, '395');
    expect(screen.getByLabelText('Variance FILM-1')).toHaveTextContent('-5');
    expect(screen.getByText('Reason required for a variance')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Submit count FILM-1' });
    expect(submit).toBeDisabled();
    expect(counted).toHaveClass('nospin');

    await user.type(screen.getByLabelText('Reason FILM-1'), 'core weight');
    expect(submit).toBeEnabled();
    await user.click(submit);
    await screen.findByText(/Count for FILM-1 submitted/);
    expect(posted[0]).toMatchObject({ itemId: 1, countedQty: 395, reason: 'core weight' });
  });

  it('a matching count needs no reason', async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<StockReconciliation canApprove={false} />);
    await user.type(await screen.findByLabelText('Counted FILM-1'), '400');
    expect(screen.getByLabelText('Variance FILM-1')).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: 'Submit count FILM-1' })).toBeEnabled();
  });

  it('only the Super Admin sees Approve / Reject on pending counts', async () => {
    const counts = [
      { id: 5, itemCode: 'FILM-1', countDate: '2026-11-19', systemQty: 400, countedQty: 395, variance: -5, reason: 'core', status: 'PENDING', countedBy: 'store1' },
      { id: 4, itemCode: 'INK-1', countDate: '2026-11-18', systemQty: 10, countedQty: 10, variance: 0, status: 'APPROVED', countedBy: 'store1', approvedBy: 'boss' },
    ];
    mockFetch(counts);
    const { unmount } = render(<StockReconciliation canApprove={false} />);
    await screen.findByText('core');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    unmount();

    const decided = [];
    mockFetch(counts, [], decided);
    const user = userEvent.setup();
    render(<StockReconciliation canApprove />);
    await screen.findByText('core');
    const approve = screen.getAllByRole('button', { name: 'Approve' });
    expect(approve).toHaveLength(1);   // the approved count has no buttons
    await user.click(approve[0]);
    await screen.findByText(/approved — stock is unchanged/);
    expect(decided).toEqual([[5, 'approve']]);
  });

  it('the Stores page has the two new tabs', async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><DataProvider><Stores /></DataProvider></AuthProvider></MemoryRouter>);
    await user.click(await screen.findByText(/Stock Reconciliation/));
    expect(await screen.findByRole('table', { name: 'Stock reconciliation' })).toBeInTheDocument();
    await user.click(screen.getByText(/Stock Movement/));
    expect(await screen.findByRole('table', { name: 'Stock movement' })).toBeInTheDocument();
  });
});

describe('Stock Movement tab', () => {
  it('lists opening / receipts / issues / returns / closing for the period', async () => {
    let asked = '';
    globalThis.fetch = vi.fn(async (url) => { asked = String(url); return res(MOVEMENT); });
    render(<StockMovementReport />);
    const table = await screen.findByRole('table', { name: 'Stock movement' });
    await within(table).findByText('FILM-1');
    expect(asked).toMatch(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    const row = within(table).getByText('FILM-1').closest('tr');
    expect(row).toHaveTextContent('100');
    expect(row).toHaveTextContent('120');
    // INK-1 has no stock and no movement — hidden by default
    expect(within(table).queryByText('INK-1')).toBeNull();
  });
});
