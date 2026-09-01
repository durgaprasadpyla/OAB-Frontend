import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import Stores from '../pages/Stores.jsx';
import MaterialAssignPanel from '../components/MaterialAssignPanel.jsx';

// The rest of the Stores brief: stock in SFG and FG form (both per spec), the MSL
// that comes from three months' consumption, and the planner assigning material
// to a sale order in FIFO order.

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

const SFG = [{
  spec: 'A1', customer: 'Acme', jobName: 'Pouch A 250g', poQty: 10000, fgQty: 2500,
  materials: [{ itemCode: 'FILM-BOPP20', itemName: 'BOPP Film 20mic', uom: 'Kg', qty: 250 }],
  inProcess: [{ so: '26/900', department: 'Printing', stage_seq: 1, qty_in: 10000, qty_completed: 4000, qty_wastage: 120, status: 'In Progress' }],
}];
const FG = [{ spec: 'A2', customer: 'Bharat', jobName: 'Roll B', poQty: 8000, fgQty: 2000, dispatched: 400, orders: 2 }];
const SUGG = [
  { itemId: 1, code: 'FILM-BOPP20', name: 'BOPP Film 20mic', uom: 'Kg', currentMsl: 500, consumed: 600, months: 3, suggestedMsl: 200, hasHistory: true },
  { itemId: 2, code: 'INK-CYAN', name: 'Cyan Ink', uom: 'Kg', currentMsl: 10, consumed: 0, months: 3, suggestedMsl: 0, hasHistory: false },
];
const BOARD = [
  { id: 1, code: 'FILM-BOPP20', name: 'BOPP Film 20mic', uom: 'Kg', materialType: 'BOPP', subGroup: 'Films',
    specialtyName: '', microns: '20', departmentName: 'Printing', msl: 500, closingStock: 400, unitCount: 2, stockValue: 48000, belowMsl: true },
];
const FREE = [
  { unitId: 11, itemId: 1, itemCode: 'FILM-BOPP20', itemName: 'BOPP Film 20mic', materialType: 'BOPP',
    internalCode: 'BLMU-OLD', supplier: 'Cosmos', location: 'Rack A1', uom: 'Kg', widthMm: 1200,
    qtyRemaining: 300, allocated: 0, free: 300, receivedAt: '2026-08-01T10:00:00Z', status: 'MOVING' },
  { unitId: 12, itemId: 1, itemCode: 'FILM-BOPP20', itemName: 'BOPP Film 20mic', materialType: 'BOPP',
    internalCode: 'BLMU-NEW', supplier: 'Cosmos', location: 'Rack B2', uom: 'Kg', widthMm: 700,
    qtyRemaining: 500, allocated: 0, free: 500, receivedAt: '2026-08-20T10:00:00Z', status: 'MOVING' },
];

let calls, allocations;
beforeEach(() => {
  calls = []; allocations = [];
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'stores');
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ u, method, body });
    if (u.includes('/api/auth/me')) return res(200, { username: 'store1', role: 'stores' });
    if (u.includes('/api/stores/sfg')) return res(200, SFG);
    if (u.includes('/api/stores/fg')) return res(200, FG);
    if (u.includes('/api/stores/msl-suggestions/apply')) return res(200, { applied: 1, months: 3 });
    if (u.includes('/api/stores/msl-suggestions')) return res(200, SUGG);
    if (u.includes('/api/stores/on-hand')) return res(200, BOARD);
    if (u.includes('/api/stores/available')) return res(200, FREE);
    if (u.includes('/api/stores/allocations')) {
      if (method === 'POST') { allocations.push(body); return res(201, { so: body.so, unitId: body.unitId, qty: body.qty, freeAfter: 0 }); }
      if (method === 'DELETE') { allocations = []; return res(200, { released: true }); }
      return res(200, allocations.map((a, i) => ({
        id: i + 1, so: a.so, qty: a.qty, internalCode: 'BLMU-OLD', itemCode: 'FILM-BOPP20',
        location: 'Rack A1', widthMm: 1200, uom: 'Kg',
      })));
    }
    if (u.match(/\/api\/stores\/items\/\d+\/units/)) return res(200, []);
    if (u.includes('/api/stores/txns') || u.includes('/api/stores/grns') || u.includes('/api/stores/po-eta')) return res(200, []);
    if (u.includes('/api/master/items')) return res(200, []);
    if (u.includes('/rest/v1/oab_data')) return res(200, []);
    return res(200, []);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mountStores = () => render(<MemoryRouter><AuthProvider><DataProvider><Stores /></DataProvider></AuthProvider></MemoryRouter>);

describe('Stores — stock in SFG and FG form', () => {
  it('lists semi-finished goods per spec: material on the floor, and how far production got', async () => {
    const user = userEvent.setup();
    mountStores();
    await user.click(screen.getByText(/SFG/));

    const row = (await screen.findByText('A1')).closest('tr');
    expect(within(row).getByText('Pouch A 250g')).toBeInTheDocument();
    // the material cell reads "250 Kg FILM-BOPP20" across a few elements
    expect(row.textContent).toContain('250');
    expect(row.textContent).toContain('Kg');
    expect(row.textContent).toContain('FILM-BOPP20');
    expect(within(row).getByText('2,500')).toBeInTheDocument();        // FG so far, in pieces

    // expanding shows which orders it is sitting in, and the stage progress
    await user.click(screen.getByText('A1'));
    expect(await screen.findByText('26/900')).toBeInTheDocument();
    expect(screen.getByText('Printing')).toBeInTheDocument();
    expect(screen.getByText('4,000')).toBeInTheDocument();             // completed at that stage
  });

  it('lists finished goods per spec with what is still in hand', async () => {
    const user = userEvent.setup();
    mountStores();
    await user.click(screen.getByText(/FG \(finished\)/));
    const row = (await screen.findByText('A2')).closest('tr');
    expect(within(row).getByText('2,000')).toBeInTheDocument();        // FG booked
    expect(within(row).getByText('400')).toBeInTheDocument();          // dispatched
    expect(within(row).getByText('1,600')).toBeInTheDocument();        // still in hand
  });
});

describe('Stores — MSL from three months of consumption', () => {
  it('shows the computed average beside the MSL in force, and can adopt it', async () => {
    const user = userEvent.setup();
    mountStores();
    const row = (await screen.findByText('FILM-BOPP20')).closest('tr');
    // the average sits alongside the typed MSL rather than replacing it silently
    expect(within(row).getByLabelText('MSL for FILM-BOPP20')).toHaveValue(500);
    expect(within(row).getByText('200')).toBeInTheDocument();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: /Set MSL from 3-month average/ }));
    await waitFor(() => expect(calls.some((c) => c.u.includes('/msl-suggestions/apply') && c.method === 'POST')).toBe(true));
    expect(await screen.findByText(/MSL updated from consumption for 1 item/)).toBeInTheDocument();
  });
});

describe('PLAN login — the planner assigns material, FIFO', () => {
  it('offers free rolls oldest-first, assigns one, and can release it', async () => {
    const user = userEvent.setup();
    render(<MaterialAssignPanel so="26/910" spec="A1" material="BOPP" />);

    const sel = await screen.findByLabelText('Free rolls for 26/910');
    const opts = [...sel.querySelectorAll('option')].map((o) => o.textContent);
    expect(opts[1]).toContain('BLMU-OLD');     // the older receipt first…
    expect(opts[1]).toContain('①');            // …flagged as the FIFO pick
    expect(opts[2]).toContain('BLMU-NEW');

    // the list is narrowed to the spec's own material by default ("especially the film")
    expect(calls.some((c) => c.u.includes('/api/stores/available') && c.u.includes('material=BOPP'))).toBe(true);

    fireEvent.change(sel, { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('Quantity to assign to 26/910'), { target: { value: '300' } });
    await user.click(screen.getByRole('button', { name: 'Assign material' }));

    await waitFor(() => expect(calls.some((c) => c.u.includes('/api/stores/allocations') && c.method === 'POST'
      && c.body.so === '26/910' && c.body.unitId === 11 && c.body.qty === 300)).toBe(true));

    // what the order holds is shown back, and can be released again
    expect(await screen.findByText('BLMU-OLD')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Release BLMU-OLD from 26/910'));
    await waitFor(() => expect(calls.some((c) => c.u.includes('/api/stores/allocations/') && c.method === 'DELETE')).toBe(true));
  });
});
