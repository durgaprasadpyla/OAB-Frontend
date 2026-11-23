import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import MachineCalendar, { windowsError } from '../components/MachineCalendar.jsx';
import DailyBoard from '../pages/DailyBoard.jsx';

// BloomFlex V2 — Machine Calendar: the 7-day grid, the edit modal's three save paths,
// and the Daily Board's real shift windows / "Unavailable" marker.

const D0 = '2026-11-23';   // a Monday
const dates = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];
const win = (shift, from, to) => ({ shift, from, to });
const day = (date, source, windows, hours) => ({
  date, source, windows, hours: String(hours),
  text: windows.length ? windows.map((w) => `${w.shift} ${w.from}–${w.to}`).join(' · ') : 'OFF',
});
const CAL = {
  from: D0, days: 7, dates,
  machines: [
    { id: 10, code: 'CIFLEXO', name: 'CI Flexo', departmentId: 1, departmentName: 'Printing', weekly: [],
      days: dates.map((d, i) => (i === 0 ? day(d, 'OVERRIDE', [win('A', '06:00', '14:00'), win('B', '14:00', '18:00')], 12)
        : i === 1 ? day(d, 'WEEKLY', [], 0)
          : day(d, 'LEGACY', [win('A', '08:00', '20:00')], 12))) },
    { id: 11, code: 'PCH1', name: 'Pouching 1', departmentId: 2, departmentName: 'Pouching', weekly: [],
      days: dates.map((d) => day(d, 'WEEKLY', [win('C', '22:00', '06:00')], 8)) },
  ],
};

function installFetch({ putStatus = 200, putBody = null } = {}) {
  const calls = [];
  const res = (body, status = 200) => ({
    status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' },
    json: async () => body, text: async () => JSON.stringify(body),
  });
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ method, url: u.replace(/^.*\/api/, '/api'), body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/api/planning/machine-calendar')) {
      if (method === 'GET') return res(CAL);
      if (putStatus !== 200) return res(putBody || { message: 'failed' }, putStatus);
      return res({ machineId: 10, warnings: [] });
    }
    if (u.includes('/api/planning/pool')) return res([]);
    if (u.includes('/api/master/machines')) {
      return res([
        { id: 10, code: 'CIFLEXO', name: 'CI Flexo', departmentId: 1, functionalHoursPerDay: 12 },
        { id: 11, code: 'PCH1', name: 'Pouching 1', departmentId: 2, functionalHoursPerDay: 12 },
      ]);
    }
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing' }, { id: 2, name: 'Pouching' }]);
    if (u.includes('/api/planning/week')) return res({ jobs: [], capacity: [] });
    return res({});
  });
  return calls;
}

describe('Machine Calendar (BloomFlex V2)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders machines grouped by department with hours, windows, OFF and the override marker', async () => {
    installFetch();
    render(<MachineCalendar />);
    const cell = await screen.findByLabelText(`CIFLEXO ${dates[0]}`);
    expect(cell.textContent).toContain('12 h');
    expect(cell.textContent).toContain('✎');
    expect(cell.textContent).toContain('A 06:00–14:00 · B 14:00–18:00');
    expect(screen.getByLabelText(`CIFLEXO ${dates[1]}`).textContent).toContain('OFF');
    expect(screen.getByLabelText(`CIFLEXO ${dates[2]}`).textContent).toContain('default');
    expect(screen.getByLabelText(`PCH1 ${dates[0]}`).textContent).toContain('C 22:00–06:00');
    expect(screen.getByText('Printing')).toBeTruthy();
    expect(screen.getByText('Pouching')).toBeTruthy();
  });

  it('edits a day and saves it for that date', async () => {
    const calls = installFetch();
    render(<MachineCalendar />);
    fireEvent.click(await screen.findByLabelText(`CIFLEXO ${dates[0]}`));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Window 2 to'), { target: { value: '22:00' } });
    fireEvent.click(within(dialog).getByText('＋ Add window'));
    fireEvent.change(within(dialog).getByLabelText('Window 3 shift'), { target: { value: 'C' } });
    fireEvent.change(within(dialog).getByLabelText('Window 3 from'), { target: { value: '22:00' } });
    fireEvent.change(within(dialog).getByLabelText('Window 3 to'), { target: { value: '06:00' } });
    fireEvent.click(within(dialog).getByText('Save for this date'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/machine-calendar/day'))).toBe(true));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.body).toEqual({ machineId: 10, date: dates[0], windows: [win('A', '06:00', '14:00'), win('B', '14:00', '22:00'), win('C', '22:00', '06:00')] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('saves the weekly pattern for that weekday and resets an override', async () => {
    const calls = installFetch();
    render(<MachineCalendar />);
    fireEvent.click(await screen.findByLabelText(`CIFLEXO ${dates[0]}`));
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByText('Save as weekly Monday pattern'));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/machine-calendar/weekly'))).toBe(true));
    expect(calls.find((c) => c.url.includes('/weekly')).body).toEqual({ machineId: 10, dow: 1, windows: [win('A', '06:00', '14:00'), win('B', '14:00', '18:00')] });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByLabelText(`CIFLEXO ${dates[0]}`));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByText('Use weekly pattern'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE').url).toContain(`machineId=10&date=${dates[0]}`);
  });

  it('blocks overlapping windows locally and shows a server refusal in the modal', async () => {
    expect(windowsError([win('A', '06:00', '14:00'), win('B', '13:00', '18:00')])).toMatch(/overlap/);
    expect(windowsError([win('A', '06:00', '06:10')])).toMatch(/15 minutes/);
    expect(windowsError([win('C', '22:00', '06:00')])).toBe('');

    const calls = installFetch({ putStatus: 409, putBody: { message: 'Cannot save: 1 started job(s) would fall outside the operating windows — 26/900' } });
    render(<MachineCalendar />);
    fireEvent.click(await screen.findByLabelText(`CIFLEXO ${dates[0]}`));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Window 2 from'), { target: { value: '13:00' } });
    fireEvent.click(within(dialog).getByText('Save for this date'));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/overlap/);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);

    fireEvent.change(within(dialog).getByLabelText('Window 2 from'), { target: { value: '14:00' } });
    fireEvent.click(within(dialog).getByText('Save for this date'));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/26\/900/);
  });

  it('Daily Board shows the real windows and marks a shift without one as Unavailable', async () => {
    installFetch();
    // The board opens on today; serve the calendar's first day for whatever date it asks.
    render(<DailyBoard />);
    const a = await screen.findByLabelText('CIFLEXO Shift A');
    await waitFor(() => expect(a.textContent).toContain('06:00–14:00'));
    expect(screen.getByLabelText('CIFLEXO Shift B').textContent).toContain('14:00–18:00');
    // Pouching runs only an overnight C window: A and B are Unavailable, a C zone appears.
    expect(screen.getByLabelText('PCH1 Shift A').textContent).toContain('Unavailable');
    expect(screen.getByLabelText('PCH1 Shift B').textContent).toContain('Unavailable');
    expect(screen.getByLabelText('PCH1 Shift C').textContent).toContain('22:00–06:00');
  });
});
