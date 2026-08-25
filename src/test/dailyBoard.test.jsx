import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import DailyBoard from '../pages/DailyBoard.jsx';

function installFetch() {
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/api/planning/pool')) return res([{ so: '26/500', spec: 'A1', jobName: 'Job', poQty: 20000, plannedQty: 0 }]);
    if (u.includes('/api/master/machines')) return res([{ id: 10, code: 'CIFLEXO', name: 'CI Flexo', departmentId: 1, functionalHoursPerDay: 12 }]);
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing' }]);
    if (u.includes('/api/planning/week')) return res({ jobs: [], capacity: [] });
    if (u.includes('/api/planning/so')) return res({ so: '26/500', departments: [{ seq: 1, departmentId: 1, departmentName: 'Printing', remaining: 20000, machines: [{ machineId: 10, code: 'CIFLEXO', name: 'CI Flexo' }] }], jobs: [] });
    return res({});
  });
}

// jsdom has no real DataTransfer — provide a minimal one carrying the dragged SO.
const soTransfer = { getData: () => JSON.stringify({ kind: 'so', so: '26/500' }), setData: () => {} };

describe('DailyBoard page', () => {
  beforeEach(() => installFetch());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('dropping a Ready SO on a machine opens the full/partial quantity prompt', async () => {
    render(<DailyBoard />);
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    // the machine card is present
    const machine = await screen.findByText('CIFLEXO');
    // drop the SO onto the machine (event bubbles to the card's onDrop)
    fireEvent.drop(machine, { dataTransfer: soTransfer });
    // the partial/full prompt appears with the department remaining
    await waitFor(() => expect(screen.getByText(/Complete entire quantity/)).toBeInTheDocument());
    expect(screen.getByText(/Part of the quantity/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan it' })).toBeInTheDocument();
  });
});
