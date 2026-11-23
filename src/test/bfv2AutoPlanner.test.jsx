import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import ThreeDayPlanner, { timeRange } from '../components/ThreeDayPlanner.jsx';
import DailyBoard from '../pages/DailyBoard.jsx';
import PpcDashboard from '../pages/PpcDashboard.jsx';
import { today } from '../lib/format.js';

// BloomFlex V2 — 3-Day Planner tab: board render (draft/published cards, overnight end,
// metrics), Auto-generate / Publish / Clear calls, publish errors listed, and the Daily
// Planning board's Draft badge.

const D0 = '2026-11-23';
const dates = [D0, '2026-11-24', '2026-11-25'];
const day = (date, windows) => ({ date, source: 'OVERRIDE', windows, capacityMinutes: 480, text: '' });
const BOARD = (drafts = 1) => ({
  from: D0, days: 3, dates, available: true,
  machines: [
    { id: 10, code: 'FLEXO', name: 'CI Flexo', departmentId: 1, departmentName: 'Printing',
      days: dates.map((d) => day(d, [{ shift: 'A', from: '08:00', to: '16:00', startMin: 480, endMin: 960, overnight: false }])) },
    { id: 11, code: 'LAM1', name: 'Laminator', departmentId: 2, departmentName: 'Lamination',
      days: dates.map((d) => day(d, [{ shift: 'C', from: '22:00', to: '06:00', startMin: 1320, endMin: 1800, overnight: true }])) },
  ],
  jobs: [
    { id: 1, so: '26/900', machineId: 10, planDate: D0, shift: 'A', startAbs: 480, endAbs: 680, plannedQty: 20000, estMinutes: 200,
      departmentName: 'Printing', stageSeq: 1, planStatus: drafts ? 'DRAFT' : 'PUBLISHED', customer: 'Acme' },
    { id: 2, so: '26/900', machineId: 11, planDate: D0, shift: 'C', startAbs: 1380, endAbs: 1580, plannedQty: 20000, estMinutes: 200,
      departmentName: 'Lamination', stageSeq: 2, planStatus: 'PUBLISHED' },
  ],
  metrics: { readySos: 4, drafts, published: drafts ? 1 : 2, capacityMinutes: 2880, usedMinutes: 400, usagePct: 13.9 },
});

const res = (body, status = 200) => ({
  status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

function installFetch({ drafts = 1, publishStatus = 200, publishBody = { published: 1 } } = {}) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ method, url: u.replace(/^.*\/api/, '/api'), body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/api/planning/auto/board')) return res(BOARD(drafts));
    if (u.includes('/api/planning/auto/generate')) return res({ created: 2, unplaced: [{ so: '26/950', stage: 1, department: 'Printing', remainingQty: 5000, reason: 'Only 1000 of 6000 m fit in the 3-day horizon' }] });
    if (u.includes('/api/planning/auto/publish')) return res(publishBody, publishStatus);
    if (u.includes('/api/planning/auto/clear')) return res({ deleted: 1 });
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing' }, { id: 2, name: 'Lamination' }]);
    if (u.includes('/api/master/machines')) return res([{ id: 10, code: 'FLEXO', name: 'CI Flexo', departmentId: 1, functionalHoursPerDay: 12 }]);
    if (u.includes('/api/planning/pool')) return res([]);
    if (u.includes('/api/planning/week')) {
      return res({ jobs: [{ id: 7, so: '26/777', machineId: 10, planDate: today(), shift: 'A', seqOrder: 1, plannedQty: 100, estMinutes: 60,
        startTime: '08:00', endTime: '09:00', planStatus: 'DRAFT', departmentId: 1, departmentName: 'Printing' }], capacity: [] });
    }
    if (u.includes('/api/auth/me')) return res({ username: 'ppc', role: 'ppc' });
    if (u.includes('/api/reports')) return res([]);
    return res({});
  });
  return calls;
}

beforeEach(() => { localStorage.clear(); localStorage.setItem('blm_token', 't'); });

describe('3-Day Planner (BloomFlex V2)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders 3 day columns × machines × shift lanes with draft/published cards and metrics', async () => {
    installFetch();
    render(<ThreeDayPlanner />);
    const cards = await screen.findAllByTestId('tdp-job');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Draft');
    expect(cards[0].textContent).toContain('08:00–11:20');
    // overnight lamination: 23:00 → 02:20 next morning
    expect(cards[1].textContent).toContain('Published');
    expect(cards[1].textContent).toContain('23:00–02:20 (+1)');
    expect(screen.getByLabelText(`LAM1 ${D0}`).textContent).toContain('Shift C · 22:00–06:00 (+1)');
    expect(screen.getByTestId('tdp-drafts').textContent).toBe('1');
    expect(screen.getByText('13.9%')).toBeTruthy();
    expect(screen.getByText('✓ Publish draft').closest('button').disabled).toBe(false);
  });

  it('disables Publish when there are no drafts', async () => {
    installFetch({ drafts: 0 });
    render(<ThreeDayPlanner />);
    await screen.findAllByTestId('tdp-job');
    expect(screen.getByText('✓ Publish draft').closest('button').disabled).toBe(true);
    expect(screen.getByText('✕ Clear drafts').closest('button').disabled).toBe(true);
  });

  it('auto-generates with the chosen priority and department, then lists unplaced stages', async () => {
    const calls = installFetch();
    render(<ThreeDayPlanner />);
    await screen.findAllByTestId('tdp-job');
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'DUE' } });
    await waitFor(() => expect(screen.getByLabelText('Department').querySelectorAll('option').length).toBe(3));
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('⚙ Auto-generate draft'));
    await screen.findByText(/Only 1000 of 6000 m fit/);
    const gen = calls.find((c) => c.url.startsWith('/api/planning/auto/generate'));
    expect(gen.method).toBe('POST');
    expect(gen.body).toMatchObject({ days: 3, priority: 'DUE', departmentId: 1 });
    expect(screen.getByText(/2 draft segment\(s\) scheduled/)).toBeTruthy();
  });

  it('publishes the draft', async () => {
    const calls = installFetch();
    render(<ThreeDayPlanner />);
    await screen.findAllByTestId('tdp-job');
    fireEvent.click(screen.getByText('✓ Publish draft'));
    await screen.findByText(/1 job\(s\) published/);
    const pub = calls.find((c) => c.url.startsWith('/api/planning/auto/publish'));
    expect(pub.method).toBe('POST');
    expect(pub.body).toMatchObject({ days: 3 });
  });

  it('lists every publish error on a refused publish', async () => {
    installFetch({ publishStatus: 409, publishBody: { status: 409, message: 'Cannot publish: 2 problem(s)',
      errors: [{ message: 'Overlap on FLEXO: 26/900 and X/2' }, { message: '26/900: stage 2 starts before stage 1 finishes' }] } });
    render(<ThreeDayPlanner />);
    await screen.findAllByTestId('tdp-job');
    fireEvent.click(screen.getByText('✓ Publish draft'));
    await screen.findByText('Overlap on FLEXO: 26/900 and X/2');
    expect(screen.getByText('26/900: stage 2 starts before stage 1 finishes')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Cannot publish');
  });

  it('clears drafts', async () => {
    const calls = installFetch();
    render(<ThreeDayPlanner />);
    await screen.findAllByTestId('tdp-job');
    fireEvent.click(screen.getByText('✕ Clear drafts'));
    await screen.findByText(/1 draft job\(s\) cleared/);
    expect(calls.some((c) => c.url.startsWith('/api/planning/auto/clear') && c.method === 'POST')).toBe(true);
  });

  it('formats an overnight range', () => {
    expect(timeRange({ startAbs: 1380, endAbs: 1580 })).toBe('23:00–02:20 (+1)');
    expect(timeRange({ startAbs: 480, endAbs: 680 })).toBe('08:00–11:20');
  });

  it('is a PPC tab', async () => {
    installFetch();
    render(<MemoryRouter><AuthProvider><DataProvider><PpcDashboard /></DataProvider></AuthProvider></MemoryRouter>);
    fireEvent.click(await screen.findByText('⚙ 3-Day Planner'));
    expect(await screen.findByText('⚙ Auto-generate draft')).toBeTruthy();
  });

  it('marks draft jobs on the Daily Planning board', async () => {
    installFetch();
    render(<DailyBoard />);
    const badge = await screen.findByText('Draft');
    expect(badge.className).toContain('tag');
    expect(badge.closest('div[draggable]').textContent).toContain('26/777');
  });
});
