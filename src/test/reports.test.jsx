import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import Reports from '../pages/Reports.jsx';

function installFetch() {
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/api/reports/production')) return res([{ group: 'Printing', plannedQty: 10000, actualQty: 9000, wastageQty: 500 }]);
    if (u.includes('/api/reports/utilization')) return res([{ machine: 'CIFLEXO — CI Flexo', availableMinutes: 720, plannedMinutes: 48.57, changeoverMinutes: 20, idleMinutes: 671, utilizationPct: 6.7, plannedQty: 10000, actualQty: 9000, wastageQty: 500 }]);
    return res({});
  });
}

describe('Reports page', () => {
  beforeEach(() => installFetch());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('shows planned-vs-actual and switches to machine utilization', async () => {
    render(<Reports />);
    // production tab (default)
    await waitFor(() => expect(screen.getByText('Printing')).toBeInTheDocument());
    expect(screen.getByText('10000')).toBeInTheDocument();   // planned
    expect(screen.getByText('9000')).toBeInTheDocument();     // actual

    // utilization tab
    fireEvent.click(screen.getByRole('button', { name: /Machine Utilization/ }));
    await waitFor(() => expect(screen.getByText(/CI Flexo/)).toBeInTheDocument());
    expect(screen.getByText('6.7%')).toBeInTheDocument();     // utilization
  });
});
