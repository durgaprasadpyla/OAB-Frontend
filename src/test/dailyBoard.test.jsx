import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import DailyBoard from '../pages/DailyBoard.jsx';

// The board's planning pool. §81/Issues 2.5: an SO leaves the pool only when EVERY
// route department is planned, so each row carries routeProgress — the per-stage
// planned/remaining the card reports and the drag highlighting keys off.
const ROUTE = [
  { seq: 1, departmentId: 1, departmentName: 'Printing', plannedQty: 0, remaining: 6000, planned: false, eligibleMachineIds: [10] },
  { seq: 2, departmentId: 2, departmentName: 'Pouching', plannedQty: 0, remaining: 6000, planned: false, eligibleMachineIds: [11] },
];
const poolRow = (routeProgress = ROUTE) => ({
  so: '26/500', spec: 'A1', jobName: 'Job', poQty: 20000, readyMode: 'PARTIAL', readyQty: 6000,
  plannedQty: 0, stages: 2, remainingQty: 12000, fullyPlanned: false, routeProgress,
  // `waiting` (the "Waiting here" chips on a machine) is deliberately absent: it would
  // render a second 26/500 on the board and these tests are about the pool card.
  waiting: [],
});

function installFetch({ pool = [poolRow()], assignStatus = 200, jobs = [], soRemaining = null } = {}) {
  const calls = [];
  const res = (body, status = 200) => ({
    status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' },
    json: async () => body, text: async () => JSON.stringify(body),
  });
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    calls.push(((opts.method || 'GET').toUpperCase()) + ' ' + u.split('?')[0].replace(/^.*\/api/, '/api'));
    if (u.includes('/api/planning/pool')) return res(pool);
    if (u.includes('/api/master/machines')) {
      return res([
        { id: 10, code: 'CIFLEXO', name: 'CI Flexo', departmentId: 1, functionalHoursPerDay: 12 },
        { id: 11, code: 'PCH1', name: 'Pouching 1', departmentId: 2, functionalHoursPerDay: 12 },
        { id: 12, code: 'SLIT1', name: 'Slitter 1', departmentId: 3, functionalHoursPerDay: 12 },
      ]);
    }
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing' }, { id: 2, name: 'Pouching' }, { id: 3, name: 'Slitting' }]);
    if (u.includes('/api/planning/week')) return res({ jobs, capacity: [] });
    if (u.includes('/api/planning/assign')) {
      if (assignStatus !== 200) return res({ detail: 'Simulated server outage' }, assignStatus);
      return res({ job: { id: 99 }, capacity: { overbooked: false } });
    }
    if (u.includes('/api/planning/so')) {
      return res({
        so: '26/500', readyMode: 'PARTIAL', readyQty: 6000,
        departments: [
          { seq: 1, departmentId: 1, departmentName: 'Printing', remaining: soRemaining == null ? 6000 : soRemaining, machines: [{ machineId: 10, code: 'CIFLEXO', name: 'CI Flexo' }] },
          { seq: 2, departmentId: 2, departmentName: 'Pouching', remaining: 6000, machines: [{ machineId: 11, code: 'PCH1', name: 'Pouching 1' }] },
        ],
        jobs: [],
      });
    }
    return res({});
  });
  return calls;
}

// jsdom has no real DataTransfer — a plain object carrying the payload is enough for
// the handlers (setData/getData plus the dropEffect/effectAllowed they write).
function transfer() {
  const store = {};
  return { setData: (k, v) => { store[k] = v; }, getData: (k) => store[k] || '', effectAllowed: '', dropEffect: '' };
}
// The SO number also appears in the open modal and on job cards, so pin the pool
// card by the one draggable ancestor that carries the readiness tags.
const poolCard = () => screen.getAllByText('26/500')
  .map((n) => n.closest('[draggable]'))
  .find((n) => n && /Planned \d of \d stages/.test(n.textContent));
const zone = (label) => screen.getByLabelText(label);

// Drag the pool card onto a target: dragStart on the card, then dragOver + drop on it.
function dragPoolCardTo(target, dt = transfer()) {
  fireEvent.dragStart(poolCard(), { dataTransfer: dt });
  fireEvent.dragOver(target, { dataTransfer: dt });
  fireEvent.drop(target, { dataTransfer: dt });
  return dt;
}

describe('DailyBoard page', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('shows the Plant readiness on the pool and opens the plan-quantity prompt on a shift drop', async () => {
    installFetch();
    render(<DailyBoard />);
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    // the planner sees the Plant's readiness read-only on the pool card
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText(/ready 6000/)).toBeInTheDocument();
    // the machine card is present, split into shift A/B drop zones (§77)
    await screen.findByText('CIFLEXO');
    expect(screen.getAllByText(/Shift A · day/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Shift B · night/).length).toBeGreaterThan(0);
    // drop the SO onto the machine's Shift A zone
    dragPoolCardTo(zone('CIFLEXO Shift A'));
    // the plan-quantity prompt appears, capped at the ready qty for the department
    await waitFor(() => expect(screen.getByText(/All ready qty on this machine/)).toBeInTheDocument());
    expect(screen.getByText(/Split across machines/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan it' })).toBeInTheDocument();
  });

  // ── Issues 2.5: why a dropped SO still looked unplanned ───────────────────

  it('names the route stages still to plan, so a successful drop is visible on the card', async () => {
    installFetch({ pool: [poolRow([
      { ...ROUTE[0], plannedQty: 6000, remaining: 0, planned: true },
      ROUTE[1],
    ])] });
    render(<DailyBoard />);
    const card = await waitFor(() => poolCard());
    // The old card showed only "balance 6000" — readyQty x stages minus planned, a
    // number matching no physical quantity — so a planned SO looked like a failed drop.
    expect(within(card).getByText(/Planned 1 of 2 stages/)).toBeInTheDocument();
    expect(within(card).getByText(/✓ Printing/)).toBeInTheDocument();
    expect(within(card).getByText(/⏳ Pouching 6000/)).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/balance/);
  });

  it('saves the assignment through the API and refreshes the board from the server', async () => {
    const calls = installFetch();
    render(<DailyBoard />);
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    dragPoolCardTo(zone('CIFLEXO Shift A'));
    fireEvent.click(await screen.findByRole('button', { name: 'Plan it' }));

    await waitFor(() => expect(calls.filter((c) => c === 'POST /api/planning/assign')).toHaveLength(1));
    const body = JSON.parse(globalThis.fetch.mock.calls.find(([u, o]) => String(u).includes('/assign') && o)[1].body);
    expect(body).toMatchObject({ so: '26/500', departmentId: 1, machineId: 10, shift: 'A', plannedQty: 6000 });
    // the pool is re-fetched, so the card reflects the server, not local state
    await waitFor(() => expect(calls.filter((c) => c === 'GET /api/planning/pool').length).toBeGreaterThan(1));
    await screen.findByText(/planned on CIFLEXO · Shift A/);
  });

  it('drops onto the machine card itself, not only the small shift strip', async () => {
    installFetch();
    render(<DailyBoard />);
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    // A drop that lands on the card body (header, capacity bar, the gap between the
    // shifts) used to do nothing at all — silently. It now plans on Shift A.
    dragPoolCardTo(screen.getByLabelText('Machine CIFLEXO'));
    await screen.findByRole('button', { name: 'Plan it' });
  });

  it('marks the drop target while dragging and dims the machines that cannot take it', async () => {
    installFetch();
    render(<DailyBoard />);
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    const dt = transfer();
    fireEvent.dragStart(poolCard(), { dataTransfer: dt });
    // SLIT1 is not on this SO's route at all
    await waitFor(() => expect(screen.getByLabelText('Machine SLIT1')).toHaveStyle({ opacity: '0.42' }));
    expect(within(screen.getByLabelText('Machine SLIT1')).getByText('not a stage for this order')).toBeInTheDocument();
    expect(screen.getByLabelText('Machine CIFLEXO')).toHaveStyle({ opacity: '1' });
    // hovering a valid zone marks it unmistakably
    fireEvent.dragOver(zone('CIFLEXO Shift A'), { dataTransfer: dt });
    await waitFor(() => expect(screen.getByText(/Release to plan here/)).toBeInTheDocument());
    // …and the dragged card itself shows it is in flight
    expect(poolCard()).toHaveStyle({ opacity: '0.45' });
    // dropping nowhere puts everything back
    fireEvent.dragEnd(poolCard(), { dataTransfer: dt });
    await waitFor(() => expect(screen.queryByText(/Release to plan here/)).toBeNull());
    expect(screen.getByLabelText('Machine SLIT1')).toHaveStyle({ opacity: '1' });
  });

  it('refuses a drop on a machine that is not part of the SO route, and says why', async () => {
    const calls = installFetch();
    render(<DailyBoard />);
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    // forced through (the browser would already show a no-drop cursor there)
    dragPoolCardTo(zone('SLIT1 Shift A'));
    await screen.findByText(/does not pass through Slitting/);
    expect(screen.queryByRole('button', { name: 'Plan it' })).toBeNull();
    expect(calls.filter((c) => c === 'POST /api/planning/assign')).toHaveLength(0);
  });

  it('refuses a second drop on a department that is already fully planned', async () => {
    installFetch({
      pool: [poolRow([{ ...ROUTE[0], plannedQty: 6000, remaining: 0, planned: true }, ROUTE[1]])],
      soRemaining: 0,
    });
    render(<DailyBoard />);
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    dragPoolCardTo(zone('CIFLEXO Shift A'));
    await screen.findByText(/already fully planned at Printing/);
    expect(screen.queryByRole('button', { name: 'Plan it' })).toBeNull();
  });

  it('raises exactly one assign for a rapid double submit', async () => {
    const calls = installFetch();
    render(<DailyBoard />);
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    dragPoolCardTo(zone('CIFLEXO Shift A'));
    const go = await screen.findByRole('button', { name: 'Plan it' });
    fireEvent.click(go); fireEvent.click(go); fireEvent.click(go);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan it' })).toBeNull());
    expect(calls.filter((c) => c === 'POST /api/planning/assign')).toHaveLength(1);
  });

  it('keeps the SO in the pool and shows the server error when the save fails', async () => {
    installFetch({ assignStatus: 500 });
    render(<DailyBoard />);
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    dragPoolCardTo(zone('CIFLEXO Shift A'));
    fireEvent.click(await screen.findByRole('button', { name: 'Plan it' }));

    // the prompt stays open carrying the reason — nothing is faked as assigned
    await screen.findByText(/Simulated server outage/);
    expect(screen.getByRole('button', { name: 'Plan it' })).toBeInTheDocument();
    expect(poolCard()).toBeInTheDocument();
    expect(within(poolCard()).getByText(/Planned 0 of 2 stages/)).toBeInTheDocument();
    expect(within(zone('CIFLEXO Shift A')).getByText('Drop an SO here')).toBeInTheDocument();
  });

  it('moves a planned job to another shift by drag and drop', async () => {
    const today = new Date();
    const iso = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
    const calls = installFetch({
      jobs: [{ id: 7, so: '26/500', machineId: 10, departmentId: 1, planDate: iso, shift: 'A', seqOrder: 1, plannedQty: 6000, estMinutes: 75 }],
    });
    render(<DailyBoard />);
    await waitFor(() => expect(screen.getByText('CIFLEXO')).toBeInTheDocument());
    const job = (await screen.findAllByText('26/500')).map((n) => n.closest('[draggable]')).find((n) => n && n.textContent.includes('(75m)'));
    expect(job).toBeTruthy();
    const dt = transfer();
    fireEvent.dragStart(job, { dataTransfer: dt });
    fireEvent.drop(zone('CIFLEXO Shift B'), { dataTransfer: dt });
    await waitFor(() => expect(calls.filter((c) => c === 'POST /api/planning/move')).toHaveLength(1));
    const body = JSON.parse(globalThis.fetch.mock.calls.find(([u, o]) => String(u).includes('/move') && o)[1].body);
    expect(body).toMatchObject({ jobId: 7, machineId: 10, shift: 'B' });
  });
});
