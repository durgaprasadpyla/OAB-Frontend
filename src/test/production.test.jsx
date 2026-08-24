import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import Production from '../pages/Production.jsx';

// Stateful fetch mock: recording 20,000 at Printing (stage 1) makes it Partially
// Completed with 30,000 remaining and moves 20,000 to Slitting (stage 2).
function installFetch() {
  let recorded = false;
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  const stages = () => ([
    { stageSeq: 1, departmentId: 1, departmentName: 'Printing', qtyIn: 50000, qtyCompleted: recorded ? 20000 : 0, qtyWastage: 0, remaining: recorded ? 30000 : 50000, status: recorded ? 'Partially Completed' : 'Not Started' },
    { stageSeq: 2, departmentId: 2, departmentName: 'Slitting', qtyIn: recorded ? 20000 : 0, qtyCompleted: 0, qtyWastage: 0, remaining: recorded ? 20000 : 0, status: 'Not Started' },
  ]);
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url); const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/master/machines')) return res([{ id: 10, code: 'CIFLEXO', name: 'CI Flexo', departmentId: 1 }]);
    if (u.includes('/api/production/pending')) return res(recorded
      ? [{ so: '26/500', stageSeq: 1, departmentName: 'Printing', remaining: 30000, status: 'Partially Completed' }, { so: '26/500', stageSeq: 2, departmentName: 'Slitting', remaining: 20000, status: 'Not Started' }]
      : [{ so: '26/500', stageSeq: 1, departmentName: 'Printing', remaining: 50000, status: 'Not Started' }]);
    if (u.includes('/api/production/record') && method === 'POST') { recorded = true; return res({ so: '26/500', spec: 'A1', poQty: 50000, hasRoute: true, stages: stages(), runs: [{ id: 1, prodDate: '2026-08-24', departmentName: 'Printing', machineName: 'CI Flexo', producedQty: 20000, wastageQty: 0, actor: 'plant1' }] }); }
    if (u.includes('/api/production') && u.includes('so=')) return res({ so: '26/500', spec: 'A1', poQty: 50000, hasRoute: true, stages: stages(), runs: [] });
    return res({});
  });
}

describe('Production page', () => {
  beforeEach(() => installFetch());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('records partial production and shows the remainder + next-stage movement', async () => {
    render(<Production />);

    // pending pool lists the SO (appears in the dropdown option and the pending row)
    await waitFor(() => expect(screen.getAllByText('26/500').length).toBeGreaterThan(0));

    // open it via the "pending SOs" dropdown
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '26/500' } });
    await waitFor(() => expect(screen.getByText('Printing')).toBeInTheDocument());

    // open the Record modal for the Printing stage
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    const dialog = await screen.findByRole('dialog');

    // enter 20,000 produced and submit
    const produced = within(dialog).getAllByRole('spinbutton')[0];
    fireEvent.change(produced, { target: { value: '20000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record' }));

    // Printing is now Partially Completed with 30,000 remaining; Slitting has 20,000
    await waitFor(() => expect(screen.getByText('Partially Completed')).toBeInTheDocument());
    expect(screen.getByText('30000')).toBeInTheDocument();          // Printing remaining
    expect(screen.getAllByText('20000').length).toBeGreaterThan(0); // moved to Slitting (+ completed + log)
  });
});
