import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// MIS → Status, the sheet the business drew: a sale order opening into a COLUMN PER
// DEPARTMENT of its route, with the actual metres, wastage, date and start/end times
// entered right there, the time taken worked out, and a late start called out the
// moment it is typed.

vi.mock('../lib/xlsx.js', () => ({ exportAOA: vi.fn(), exportObjects: vi.fn() }));

const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const TODAY = new Date().toISOString().slice(0, 10);

const BOARD = [{
  so: '26/697', spec: 'A1339', customer: 'Amazon', jobName: 'Pouch A',
  poQty: 50600, plannedQty: 260000, actualQty: 0, wastageQty: 120, lateStages: 1,
  departments: [
    {
      stageSeq: 1, departmentId: 1, departmentName: 'Printing', machines: 'CI Flexo',
      plannedQty: 260000, plannedDate: '2026-09-01', plannedStart: '08:00', plannedEnd: '12:00',
      actualQty: 0, wastageQty: 0, status: 'Not Started',
    },
    {
      stageSeq: 2, departmentId: 2, departmentName: 'Pouching', machines: 'P1, P3',
      plannedQty: 80000, plannedDate: '2026-09-02', plannedStart: '09:38', plannedEnd: '13:00',
      actualQty: 5000, wastageQty: 120, actualDate: '2026-09-03', startTime: '10:38',
      endTime: '14:00', durationMin: 202, delayMin: 60, status: 'In Progress',
    },
  ],
}];

let posted;
beforeEach(() => {
  posted = [];
  vi.doMock('../data.jsx', () => ({
    useData: () => ({
      mods: {
        customers: [{ customer: 'Amazon', group: 'AMAZON GROUP' }],
        jss: [{ spec: 'A1339', customer: 'Amazon', jobName: 'Pouch A', material: 'AF-BOPP' }],
      },
      save: vi.fn(),
    }),
  }));
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET') !== 'GET') { posted.push({ u, body: JSON.parse(opts.body || '{}') }); return res({}); }
    if (u.includes('/api/production/status-board')) return res(BOARD);
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

async function board() {
  const { default: MisStatusBoard } = await import('../components/MisStatusBoard.jsx');
  render(<MisStatusBoard />);
  return screen.findByRole('button', { name: 'Open 26/697' });
}

describe('minutesBetween / lateBy', () => {
  it('measures a shift that runs past midnight', async () => {
    const { minutesBetween, lateBy } = await import('../components/MisStatusBoard.jsx');
    expect(minutesBetween('08:00', '12:00')).toBe(240);
    expect(minutesBetween('22:00', '02:30')).toBe(270);   // night shift
    expect(minutesBetween('08:00', '')).toBe(null);
    expect(lateBy('09:00', '09:30')).toBe(30);
    expect(lateBy('09:00', '08:45')).toBe(-15);           // early, not late
    expect(lateBy('', '09:30')).toBe(null);
  });
});

describe('MIS Status board', () => {
  it('lists the order with its group, substrate, PO qty and metres planned', async () => {
    await board();
    const row = screen.getByRole('button', { name: 'Open 26/697' }).closest('tr');
    expect(within(row).getByText('AMAZON GROUP')).toBeInTheDocument();
    expect(within(row).getByText('AF-BOPP')).toBeInTheDocument();
    expect(within(row).getByText('50,600')).toBeInTheDocument();
    expect(within(row).getByText('2,60,000')).toBeInTheDocument();
    expect(within(row).getByText(/1 late/)).toBeInTheDocument();
  });

  it('opens into a column per department of the route', async () => {
    fireEvent.click(await board());
    expect(await screen.findByText(/1\. Printing/)).toBeInTheDocument();
    expect(screen.getByText(/2\. Pouching/)).toBeInTheDocument();
    expect(screen.getByText('CI Flexo')).toBeInTheDocument();
    expect(screen.getByText('P1, P3')).toBeInTheDocument();
    // every row of the sheet is there
    const grid = screen.getByText(/1\. Printing/).closest('table');
    ['Planned mtrs', 'Actual mtrs', 'Wastage', 'Planned date', 'Actual date', 'Start time', 'End time', 'Time taken', 'Status']
      .forEach((l) => expect(within(grid).getByText(l)).toBeInTheDocument());
  });

  it('shows the planned time against the actual, per department', async () => {
    fireEvent.click(await board());
    await screen.findByText(/1\. Printing/);
    // Printing: 08:00–12:00 planned, nothing actual yet
    expect(screen.getByText('4h 00m')).toBeInTheDocument();
    // Pouching: 09:38–13:00 planned (3h22), actual 10:38–14:00 (3h22)
    expect(screen.getAllByText('3h 22m').length).toBeGreaterThanOrEqual(2);
  });

  it('calls out a department that started late', async () => {
    fireEvent.click(await board());
    await screen.findByText(/2\. Pouching/);
    // planned 09:38, actual 10:38
    expect(screen.getByText(/started 1h 00m late/)).toBeInTheDocument();
  });

  it('recomputes the late warning as the time is typed, before saving', async () => {
    fireEvent.click(await board());
    await screen.findByText(/1\. Printing/);
    expect(screen.queryByText(/started 30m late|started 0h 30m late/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Start time for Printing'), { target: { value: '08:30' } });
    expect(await screen.findByText(/started 0h 30m late/)).toBeInTheDocument();
  });

  it('flags an actual date later than the planned one', async () => {
    fireEvent.click(await board());
    await screen.findByText(/1\. Printing/);
    // it already defaults to today, so move it somewhere that is genuinely later
    fireEvent.change(screen.getByLabelText('Actual date for Printing'), { target: { value: '2026-09-08' } });
    expect(await screen.findByText(/7 day\(s\) late/)).toBeInTheDocument();
  });

  it('records the metres, wastage, date and times for one department', async () => {
    fireEvent.click(await board());
    await screen.findByText(/1\. Printing/);

    fireEvent.change(screen.getByLabelText('Actual metres for Printing'), { target: { value: '240000' } });
    fireEvent.change(screen.getByLabelText('Wastage for Printing'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Start time for Printing'), { target: { value: '08:30' } });
    fireEvent.change(screen.getByLabelText('End time for Printing'), { target: { value: '12:45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Printing' }));

    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/production/record'))).toBe(true));
    const rec = posted.find((p) => p.u.includes('/api/production/record')).body;
    expect(rec).toMatchObject({
      so: '26/697', stageSeq: 1, producedQty: 240000, wastageQty: 500,
      startTime: '08:30', endTime: '12:45',
    });
    expect(rec.prodDate).toBe(TODAY);   // the date defaults to today
  });

  it('sets the department status alongside the entry', async () => {
    fireEvent.click(await board());
    await screen.findByText(/2\. Pouching/);
    fireEvent.change(screen.getByLabelText('Status for Pouching'), { target: { value: 'Completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Pouching' }));

    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/production/status'))).toBe(true));
    expect(posted.find((p) => p.u.includes('/api/production/status')).body)
      .toMatchObject({ so: '26/697', stageSeq: 2, status: 'Completed' });
  });

  it('refuses an empty save rather than posting nothing', async () => {
    fireEvent.click(await board());
    await screen.findByText(/1\. Printing/);
    fireEvent.click(screen.getByRole('button', { name: 'Save Printing' }));
    expect(await screen.findByText(/enter the actual metres, the wastage, or a status/)).toBeInTheDocument();
    expect(posted.some((p) => p.u.includes('/api/production/record'))).toBe(false);
  });

  it('exports the whole sheet, one line per department', async () => {
    const { exportAOA } = await import('../lib/xlsx.js');
    await board();
    fireEvent.click(screen.getByRole('button', { name: 'Export the status board to Excel' }));
    await waitFor(() => expect(exportAOA).toHaveBeenCalledTimes(1));
    const flat = exportAOA.mock.calls[0][0].map((r) => (r || []).join('|'));
    expect(flat.some((l) => l.includes('26/697') && l.includes('Printing'))).toBe(true);
    expect(flat.some((l) => l.includes('26/697') && l.includes('Pouching'))).toBe(true);
  });
});
