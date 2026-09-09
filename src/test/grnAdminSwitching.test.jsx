import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import GrnAdmin from '../components/GrnAdmin.jsx';

// Switching between receipts on the Super Admin's GRN Entries screen.
//
// The screen holds ONE `detail` for whichever receipt is open. Opening a second
// receipt while the first is still in flight is an ordinary thing to do — the list
// is right there and the rows are one click apart — and the two responses can land
// in either order. If the slower first response is allowed to win, the panel ends
// up showing one receipt's lines under another receipt's heading, and the Save
// button writes to whichever id the panel thinks it is holding.
//
// So: the answer to a request the user has already moved on from is discarded.

const res = (status, body) => ({
  status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

const GRNS = [
  { id: 1, grnNo: 'GRN/2026/1', poNum: 'PO-9', supplier: 'Jindal', grnDate: '2026-09-01', invoiceNo: 'INV-1', invoiceDate: '2026-08-30', notes: '', actor: 'store1', units: 1 },
  { id: 2, grnNo: 'GRN/2026/2', poNum: 'PO-10', supplier: 'Siegwerk', grnDate: '2026-09-02', invoiceNo: 'INV-2', invoiceDate: null, notes: '', actor: 'store1', units: 1 },
];

const detailFor = (id) => ({
  id,
  grnNo: `GRN/2026/${id}`,
  poNum: id === 1 ? 'PO-9' : 'PO-10',
  supplier: id === 1 ? 'Jindal' : 'Siegwerk',
  grnDate: id === 1 ? '2026-09-01' : '2026-09-02',
  invoiceNo: `INV-${id}`, invoiceDate: null, notes: '', actor: 'store1',
  units: [{
    id: 100 + id, internalCode: `BLMU-${id}`, itemCode: `FILM-${id}`, itemName: `Film ${id}`,
    supplierCode: `SC-${id}`, uom: 'Kg', qtyReceived: 100, qtyRemaining: 100,
    price: 120, location: 'A2', expiryDate: null, qtyLocked: false,
  }],
});

// Gate that lets the test decide when GRN 1's response is delivered.
let releaseSlow;
let slowIds;

beforeEach(() => {
  slowIds = new Set();
  releaseSlow = null;
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'superadmin');
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/auth/me')) return res(200, { username: 'superadmin', role: 'superadmin' });
    const one = u.match(/\/api\/stores\/grns\/(\d+)$/);
    if (one && method === 'GET') {
      const id = Number(one[1]);
      if (slowIds.has(id)) await new Promise((r) => { releaseSlow = r; });
      return res(200, detailFor(id));
    }
    if (one && method === 'PUT') return res(200, { ...detailFor(Number(one[1])), ...JSON.parse(opts.body || '{}') });
    if (u.includes('/api/stores/grns')) return res(200, GRNS);
    if (u.includes('/rest/v1/oab_data')) return res(200, [{ id: 6, data: JSON.stringify({ asl: [], pos: [] }), version: 1 }]);
    return res(200, []);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

const mount = (ui) => render(<MemoryRouter><AuthProvider><DataProvider>{ui}</DataProvider></AuthProvider></MemoryRouter>);
const openGrn = async (grnNo) => fireEvent.click(await screen.findByLabelText(`Edit ${grnNo}`));

describe('GRN Entries — switching between receipts', () => {
  it('opens the receipt that was clicked, with its own lines', async () => {
    mount(<GrnAdmin />);
    await openGrn('GRN/2026/2');
    await waitFor(() => expect(screen.getByLabelText('GRN number').value).toBe('GRN/2026/2'));
    expect(screen.getByLabelText('Edit supplier').value).toBe('Siegwerk');
    expect(screen.getByText('BLMU-2')).toBeInTheDocument();
    expect(screen.queryByText('BLMU-1')).toBeNull();
  });

  it('shows the second receipt even when the first one answers last', async () => {
    slowIds.add(1);
    mount(<GrnAdmin />);

    await openGrn('GRN/2026/1');                       // hangs on the gate
    await waitFor(() => expect(releaseSlow).toBeTruthy());
    await openGrn('GRN/2026/2');                       // user moves on
    await waitFor(() => expect(screen.getByLabelText('GRN number').value).toBe('GRN/2026/2'));

    releaseSlow();                                     // GRN 1 finally answers
    await new Promise((r) => setTimeout(r, 20));

    // The stale answer must not repaint the panel over the receipt now open.
    expect(screen.getByLabelText('GRN number').value).toBe('GRN/2026/2');
    expect(screen.getByLabelText('Edit supplier').value).toBe('Siegwerk');
    expect(screen.getByText('BLMU-2')).toBeInTheDocument();
    expect(screen.queryByText('BLMU-1')).toBeNull();
  });

  it('closing and reopening another receipt does not carry the old lines over', async () => {
    mount(<GrnAdmin />);
    await openGrn('GRN/2026/1');
    await waitFor(() => expect(screen.getByText('BLMU-1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('✕ Close'));
    await openGrn('GRN/2026/2');
    await waitFor(() => expect(screen.getByLabelText('GRN number').value).toBe('GRN/2026/2'));
    expect(screen.queryByText('BLMU-1')).toBeNull();
  });
});
