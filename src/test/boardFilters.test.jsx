import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import DailyBoard from '../pages/DailyBoard.jsx';
import { today } from '../lib/format.js';

// Daily Machine Board filters — view only: they narrow the Ready to Plan list and the
// machines shown, and never call the server to change anything.
const stage = (departmentId, departmentName, planned) => ({ seq: departmentId, departmentId, departmentName, plannedQty: 0, remaining: planned ? 0 : 5000, planned, eligibleMachineIds: [] });
const POOL = [
  { so: '26/500', spec: 'A1', jobName: 'Chilli Roll', routeName: 'Laminated roll', poQty: 5000, readyMode: 'PARTIAL', readyQty: 3000, fullyPlanned: false, waiting: [],
    routeProgress: [stage(1, 'Printing', false), stage(2, 'Pouching', false)] },
  { so: '26/501', spec: 'B7', jobName: 'Tea Pouch', routeName: 'Pouch route', poQty: 8000, readyMode: 'COMPLETE', readyQty: 8000, fullyPlanned: false, waiting: [],
    routeProgress: [stage(1, 'Printing', true), stage(2, 'Pouching', false)] },
];
const MACHINES = [
  { id: 10, code: 'CIFLEXO', name: 'CI Flexo', departmentId: 1, functionalHoursPerDay: 12 },
  { id: 11, code: 'PCH1', name: 'Pouching 1', departmentId: 2, functionalHoursPerDay: 12 },
  { id: 12, code: 'SLIT1', name: 'Slitter 1', departmentId: 3, functionalHoursPerDay: 12 },
];

function installFetch() {
  const writes = [];
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET').toUpperCase() !== 'GET') writes.push(u);
    if (u.includes('/api/planning/pool')) return res(POOL);
    if (u.includes('/api/master/machines')) return res(MACHINES);
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing' }, { id: 2, name: 'Pouching' }, { id: 3, name: 'Slitting' }]);
    if (u.includes('/api/planning/week')) {
      return res({ jobs: [{ id: 7, so: '26/700', machineId: 10, departmentId: 1, planDate: today(), shift: 'A', plannedQty: 4000, estMinutes: 60, seqOrder: 1 }], capacity: [] });
    }
    return res({});
  });
  return writes;
}

const queue = () => screen.getByRole('complementary', { name: 'Ready to Plan' });
const machineCodes = () => [...document.querySelectorAll('.board-mach')].map((el) => el.getAttribute('aria-label').replace('Machine ', ''));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Daily Machine Board filters', () => {
  it('narrows the Ready to Plan list by search, department still to plan and Complete / Partial', async () => {
    installFetch();
    render(<DailyBoard embedded />);
    await within(queue()).findByText('26/500');
    expect(within(queue()).getByText('26/501')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search the Ready to Plan list'), { target: { value: 'tea' } });
    expect(within(queue()).queryByText('26/500')).toBeNull();
    expect(within(queue()).getByText('26/501')).toBeTruthy();
    expect(within(queue()).getByText('Showing 1 of 2')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search the Ready to Plan list'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Waiting at department'), { target: { value: '1' } });   // Printing still to plan
    expect(within(queue()).getByText('26/500')).toBeTruthy();
    expect(within(queue()).queryByText('26/501')).toBeNull();

    fireEvent.change(screen.getByLabelText('Waiting at department'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Complete or partial'), { target: { value: 'COMPLETE' } });
    expect(within(queue()).queryByText('26/500')).toBeNull();
    expect(within(queue()).getByText('26/501')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search the Ready to Plan list'), { target: { value: 'nothing-like-this' } });
    expect(within(queue()).getByText('No sale orders match the filters.')).toBeTruthy();
    // the heading still counts every SO waiting, as before
    expect(within(queue()).getByText(/^Ready to Plan/)).toBeTruthy();
  });

  it('narrows the machines by department, machine, shift, SO and "with jobs", and Clear resets', async () => {
    const writes = installFetch();
    render(<DailyBoard embedded />);
    await screen.findByLabelText('Machine CIFLEXO');
    expect(machineCodes()).toEqual(['CIFLEXO', 'PCH1', 'SLIT1']);
    expect(screen.getByText('Showing 3 of 3 machines')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Department filter'), { target: { value: '2' } });
    expect(machineCodes()).toEqual(['PCH1']);
    expect(screen.getByText('Showing 1 of 3 machines')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Department filter'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Machine filter'), { target: { value: '12' } });
    expect(machineCodes()).toEqual(['SLIT1']);

    fireEvent.change(screen.getByLabelText('Machine filter'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Shift filter'), { target: { value: 'B' } });
    expect(screen.queryByLabelText('CIFLEXO Shift A')).toBeNull();
    expect(screen.getByLabelText('CIFLEXO Shift B')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Shift filter'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Find SO on the board'), { target: { value: '26/700' } });
    expect(machineCodes()).toEqual(['CIFLEXO']);
    expect(document.querySelector('.board-job.so-hit')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Find SO on the board'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Show machines'), { target: { value: 'jobs' } });
    expect(machineCodes()).toEqual(['CIFLEXO']);

    fireEvent.change(screen.getByLabelText('Find SO on the board'), { target: { value: '99/999' } });
    expect(screen.getByText('No machines match the filters.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    expect(machineCodes()).toEqual(['CIFLEXO', 'PCH1', 'SLIT1']);
    expect(writes).toEqual([]);   // filtering never writes anything
  });
});
