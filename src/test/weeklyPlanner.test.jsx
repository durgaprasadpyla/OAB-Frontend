import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import WeeklyPlanner from '../pages/WeeklyPlanner.jsx';

function installFetch() {
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/api/planning/pool')) return res([{ so: '26/500', spec: 'A1', jobName: 'Stay Fresh', routeName: 'Print-Slit', poQty: 20000, plannedQty: 0 }]);
    if (u.includes('/api/planning/machine-hours')) return res({ machines: [{ id: 10, code: 'CIFLEXO', name: 'CI Flexo', defaultHours: 12 }], overrides: [] });
    if (u.includes('/api/planning/week')) return res({ jobs: [], capacity: [] });
    if (u.includes('/api/planning/so')) return res({
      so: '26/500', routeName: 'Print-Slit', readyToPlan: true,
      departments: [{ seq: 1, departmentId: 1, departmentName: 'Printing', remaining: 20000, machines: [{ machineId: 10, code: 'CIFLEXO', name: 'CI Flexo', speed: 350, changeoverMin: 20 }] }],
      jobs: [],
    });
    return res({});
  });
}

describe('WeeklyPlanner page', () => {
  beforeEach(() => installFetch());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('loads the ready pool, opens an SO to plan, and shows machine hours', async () => {
    render(<WeeklyPlanner />);
    // ready pool
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    // machine hours grid lists the machine
    expect(screen.getByText(/CI Flexo/)).toBeInTheDocument();

    // open the SO for planning
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    await waitFor(() => expect(screen.getByText(/Plan SO/)).toBeInTheDocument());
    // its route department is offered in the assignment panel
    expect(screen.getByText(/1\. Printing \(rem 20000\)/)).toBeInTheDocument();
  });
});
