import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// Issues 30.09 — Stores → Issues & Returns → Recent issues & returns.
//
//   S4 (red)  checkboxes against each issue line + "Close to Return" at the top; the
//             closed lines leave the returns dropdown.
//   S5        filters on top: date, item code, material type, sub group, speciality,
//             item description, department, sale order.
//   S6        material type / sub group / speciality / item description columns; no
//             date column, no "By" column; every slip shown by default.

const res = (body, status = 200) => ({ status, ok: status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ITEMS = [
  { id: 37, code: 'BLM037', name: '1200 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'ANTIFOG', uom: 'Kg', widthMm: 1200 },
  { id: 34, code: 'BLM034', name: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'ANTIFOG', uom: 'Kg', widthMm: 700 },
  { id: 50, code: 'BLM050', name: '600 MM', materialType: 'FILM', subGroup: 'LDPE', specialty: 'NATURAL', uom: 'Kg', widthMm: 600 },
  { id: 90, code: 'INK01', name: 'CYAN INK', materialType: 'INK', subGroup: 'PROCESS', specialtyName: '', uom: 'Kg' },
];
const ON_HAND = ITEMS.map((it) => ({ ...it, closingStock: 200, unitCount: 1, departmentName: 'Printing', stockValue: 1000, msl: 0, byStatus: {}, active: true }));

// Mid-day UTC stamps, so the local calendar day is the same date in any desk's zone.
const TXNS = [
  // the 30.09 backend: identity on the row
  { id: 101, kind: 'ISSUE', qty: 194.92, uom: 'Kg', so: '26/656', department: 'Printing', slipNo: 'ISS/2026/77', lineNo: 'ISS/2026/77.0', internalCode: 'BLMU-592',
    itemCode: 'BLM037', itemName: '1200 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'ANTIFOG', closedAt: null, qtyReturned: 0, actor: 'stores', ts: '2026-09-30T06:00:00Z' },
  // an older backend: code and name only — the rest comes off the Item Master
  { id: 102, kind: 'ISSUE', qty: 50, uom: 'Kg', so: '26/700', department: 'Slitting', slipNo: 'ISS/2026/78', lineNo: 'ISS/2026/78.1', internalCode: 'BLMU-600',
    itemCode: 'BLM050', actor: 'stores', ts: '2026-09-29T06:00:00Z' },
  { id: 103, kind: 'ISSUE', qty: 5, uom: 'Kg', so: '26/700', department: 'Printing', slipNo: 'ISS/2026/78', lineNo: 'ISS/2026/78.2', internalCode: 'BLMU-9',
    itemCode: 'INK01', itemName: 'CYAN INK', materialType: 'INK', subGroup: 'PROCESS', closedAt: '2026-09-30T05:00:00Z', closedBy: 'store', qtyReturned: 0, actor: 'stores', ts: '2026-09-29T06:00:00Z' },
  // everything came back (worked out from the return row below — no qtyReturned on it)
  { id: 104, kind: 'ISSUE', qty: 100, uom: 'Kg', so: '26/656', department: 'Slitting', slipNo: 'ISS/2026/60', lineNo: 'ISS/2026/60.0', internalCode: 'BLMU-7',
    itemCode: 'BLM034', actor: 'stores', ts: '2026-09-24T06:00:00Z' },
  { id: 105, kind: 'RETURN', qty: 100, uom: 'Kg', so: '26/656', department: 'Slitting', returnNo: 'RET/2026/60.0/1', issueTxnId: 104, internalCode: 'BLMU-700',
    itemCode: 'BLM034', actor: 'stores', ts: '2026-09-25T06:00:00Z' },
];
const LINES = [
  { txnId: 101, slipNo: 'ISS/2026/77', lineNo: 'ISS/2026/77.0', unitId: 592, internalCode: 'BLMU-592', itemId: 37, itemCode: 'BLM037', itemName: '1200 MM', materialType: 'FILM', uom: 'Kg', widthMm: 1200, qtyIssued: 194.92, qtyReturned: 0, rollsReturned: 0, so: '26/656', department: 'Printing', ts: '2026-09-30T06:00:00Z' },
  { txnId: 102, slipNo: 'ISS/2026/78', lineNo: 'ISS/2026/78.1', unitId: 600, internalCode: 'BLMU-600', itemId: 50, itemCode: 'BLM050', itemName: '600 MM', materialType: 'FILM', uom: 'Kg', widthMm: 600, qtyIssued: 50, qtyReturned: 0, rollsReturned: 0, so: '26/700', department: 'Slitting', ts: '2026-09-29T06:00:00Z' },
];
const lineNoOf = (id) => (TXNS.find((t) => t.id === id) || {}).lineNo;

let posted, closed, bulkStatus, skipIds, bulkFailIf, bom656, units37;
beforeEach(() => {
  posted = []; closed = new Set(); bulkStatus = 200; skipIds = new Set(); bulkFailIf = null; bom656 = []; units37 = [];
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: { asl: [], pos: [] }, oab: { OAB: { SF: [{ so: '26/656', spec: 'A1319', customer: 'AMAZON', closed: false }, { so: '26/700', spec: 'A700', customer: 'ZEPTO', closed: false }], OT: [] } } }, save: vi.fn(), reloadModule: vi.fn() }) }));
  vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ role: 'stores', user: 'store' }) }));
  vi.doMock('../lib/issueSlipPdf.js', () => ({ saveIssueSlipPdf: vi.fn(() => 'x.pdf'), buildIssueSlipPdf: vi.fn(), buildReturnSlipPdf: vi.fn() }));
  vi.spyOn(window, 'confirm').mockImplementation(() => true);
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET') !== 'GET') {
      const body = JSON.parse(opts.body || '{}');
      posted.push({ u, method: opts.method, body });
      if (u.endsWith('/api/stores/issue-lines/close')) {
        if (bulkStatus !== 200) return res({ message: 'No static resource api/stores/issue-lines/close.' }, bulkStatus);
        const ids = body.txnIds || [];
        // the server's own cap (StoresService.MAX_CLOSE_BATCH)
        if (ids.length > 500) return res({ message: 'At most 500 lines can be closed at once.' }, 400);
        if (bulkFailIf && bulkFailIf(ids)) return res({ message: 'The ledger is busy — try again.' }, 400);
        const skipped = ids.filter((id) => skipIds.has(id)).map((id) => ({ txnId: id, lineNo: lineNoOf(id), reason: 'everything on it has come back' }));
        const ok = ids.filter((id) => !skipIds.has(id));
        ok.forEach((id) => closed.add(id));
        return res({ closed: ok.length, lines: ok.map(lineNoOf), skipped });
      }
      const one = u.match(/\/api\/stores\/issue-lines\/(\d+)\/close/);
      if (one) { closed.add(Number(one[1])); return res({ txnId: Number(one[1]), lineNo: lineNoOf(Number(one[1])), closed: true }); }
      return res({});
    }
    if (u.includes('/api/stores/issue-lines')) return res(LINES.filter((l) => !closed.has(l.txnId)));
    if (u.includes('/api/stores/txns')) return res(TXNS.map((t) => (closed.has(t.id) ? { ...t, closedAt: '2026-10-01T05:00:00Z', closedBy: 'store' } : t)));
    if (u.includes('/api/stores/items/37/units')) return res(units37);
    if (u.match(/\/api\/stores\/items\/\d+\/units/)) return res([]);
    if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
    if (u.includes('/api/stores/next-codes')) return res({ codes: ['BLMU-900'] });
    if (u.includes('/api/stores/so-context')) {
      const so = decodeURIComponent((u.match(/so=([^&]*)/) || [])[1] || '');
      return res({ so, found: true, route: { departments: [{ departmentName: 'Printing' }] }, bom: { items: so === '26/656' ? bom656 : [] } });
    }
    if (u.includes('/api/master/items')) return res(ITEMS);
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing', active: true }]);
    if (u.includes('/api/planning/week')) return res({ jobs: [] });
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

async function mountIssues() {
  const { default: Stores } = await import('../pages/Stores.jsx');
  render(<Stores />);
  fireEvent.click(await screen.findByText('🔄 Issues & Returns'));
  await screen.findByText('ISS/2026/77.0');
  // the Item Master has landed (it fills the identity of the older rows)
  await waitFor(() => expect(within(rowOf('ISS/2026/78.1')).getByText('LDPE')).toBeInTheDocument());
}
const table = () => screen.getByText('Slip / line no.').closest('table');
const rowOf = (no) => within(table()).getByText(no).closest('tr');
/** The slip / line numbers the history is showing, top to bottom. */
const shown = () => within(table()).getAllByRole('row').slice(1).filter((tr) => tr.cells.length > 2).map((tr) => tr.cells[2].textContent);
const filter = (what) => screen.getByLabelText('Filter history by ' + what);
const optionsOf = (sel) => [...sel.options].map((o) => o.value).filter(Boolean);
const tick = (no) => fireEvent.click(screen.getByLabelText(`Select ${no} for Close to Return`));
const closeBtn = () => screen.getByLabelText('Close to Return');
const bulkPosts = () => posted.filter((p) => p.u.endsWith('/api/stores/issue-lines/close'));
const fetchedSince = (n, part) => globalThis.fetch.mock.calls.slice(n).some((c) => String(c[0]).includes(part) && !(c[1] && c[1].method && c[1].method !== 'GET'));

describe('Recent issues & returns — the columns (S6)', () => {
  it('shows the identity columns, no date and no "By", and reads every slip, not the newest 60', async () => {
    await mountIssues();
    const heads = within(table()).getAllByRole('columnheader').map((th) => th.textContent);
    expect(heads).toEqual(['', 'Kind', 'Slip / line no.', 'Download', 'Item code', 'Material type', 'Sub group', 'Speciality',
      'Item description', 'Roll', 'Qty', 'Sale order', 'Department']);
    expect(heads).not.toContain('When');
    expect(heads).not.toContain('By');
    // the ledger is read whole
    expect(globalThis.fetch.mock.calls.some((c) => String(c[0]).includes('/api/stores/txns?limit=5000'))).toBe(true);
    expect(shown()).toEqual(['ISS/2026/77.0', 'ISS/2026/78.1', 'ISS/2026/78.2', 'ISS/2026/60.0', 'RET/2026/60.0/1']);

    // from the row itself
    const r1 = rowOf('ISS/2026/77.0');
    ['BLM037', 'FILM', 'AF BOPP', 'ANTIFOG', '1200 MM', 'BLMU-592', '26/656', 'Printing'].forEach((v) => expect(within(r1).getByText(v)).toBeInTheDocument());
    expect(r1).toHaveTextContent('194.92 Kg');
    // an older backend's row: filled from the Item Master (its `specialty` too)
    const r2 = rowOf('ISS/2026/78.1');
    ['BLM050', 'FILM', 'LDPE', 'NATURAL', '600 MM'].forEach((v) => expect(within(r2).getByText(v)).toBeInTheDocument());
    // no date, no actor anywhere in the rows
    expect(within(table()).queryByText(/2026-09-30/)).toBeNull();
    expect(within(table()).queryByText('stores')).toBeNull();
    // the reprint still works from the history
    expect(screen.getByLabelText('Download slip RET/2026/60.0/1')).toBeInTheDocument();
    expect(screen.getAllByText('⬇ Download as PDF').length).toBe(5);
  });
});

describe('Recent issues & returns — Close to Return (S4)', () => {
  it('ticks only the open issue lines; closed and fully returned ones say so', async () => {
    await mountIssues();
    expect(screen.getByLabelText('Select ISS/2026/77.0 for Close to Return')).toBeInTheDocument();
    expect(screen.getByLabelText('Select ISS/2026/78.1 for Close to Return')).toBeInTheDocument();
    expect(screen.queryByLabelText('Select ISS/2026/78.2 for Close to Return')).toBeNull();     // closed already
    expect(screen.queryByLabelText('Select ISS/2026/60.0 for Close to Return')).toBeNull();     // all of it came back
    expect(screen.queryByLabelText('Select RET/2026/60.0/1 for Close to Return')).toBeNull();   // a return is not an issue line
    expect(within(rowOf('ISS/2026/78.2')).getByText('Closed')).toBeInTheDocument();
    expect(within(rowOf('ISS/2026/60.0')).getByText('Returned')).toBeInTheDocument();
    expect(within(rowOf('RET/2026/60.0/1')).queryByRole('checkbox')).toBeNull();
    expect(closeBtn()).toBeDisabled();
    // the header box ticks every open line shown
    fireEvent.click(screen.getByLabelText('Select every open issue line shown'));
    expect(screen.getByLabelText('Select ISS/2026/77.0 for Close to Return')).toBeChecked();
    expect(screen.getByLabelText('Select ISS/2026/78.1 for Close to Return')).toBeChecked();
    expect(closeBtn()).toHaveTextContent('✔ Close to Return (2)');
    fireEvent.click(screen.getByLabelText('Select every open issue line shown'));
    expect(screen.getByLabelText('Select ISS/2026/77.0 for Close to Return')).not.toBeChecked();
    expect(closeBtn()).toBeDisabled();
  });

  it('closes the ticked lines in one call, and they leave the returns dropdown at once', async () => {
    await mountIssues();
    // the desk is on a return, with one of those lines picked
    fireEvent.click(screen.getByText('↙ Receive a return'));
    const lineSel = await screen.findByLabelText('Issue line');
    await waitFor(() => expect(optionsOf(lineSel)).toEqual(['101', '102']));
    fireEvent.change(lineSel, { target: { value: '101' } });
    expect(await screen.findByLabelText('Picked issue line')).toHaveTextContent('ISS/2026/77.0');

    tick('ISS/2026/77.0');
    tick('ISS/2026/78.1');
    const before = globalThis.fetch.mock.calls.length;
    fireEvent.click(closeBtn());
    await waitFor(() => expect(bulkPosts()).toHaveLength(1));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('ISS/2026/77.0, ISS/2026/78.1'));
    expect(window.confirm.mock.calls[0][0]).toMatch(/no longer be offered in the returns dropdown/);
    expect(bulkPosts()[0].body).toEqual({ txnIds: [101, 102], closed: true });
    expect(await screen.findByText(/Closed 2 line\(s\) — they are off the returns dropdown/)).toBeInTheDocument();
    // both lists are read again
    expect(fetchedSince(before, '/api/stores/txns')).toBe(true);
    expect(fetchedSince(before, '/api/stores/issue-lines')).toBe(true);
    // gone from the returns dropdown, and the picked one is let go
    await waitFor(() => expect(optionsOf(screen.getByLabelText('Issue line'))).toEqual([]));
    expect(optionsOf(screen.getByLabelText('Issue slip'))).toEqual([]);
    expect(screen.queryByLabelText('Picked issue line')).toBeNull();
    // and tagged closed in the history, with nothing left to tick
    await waitFor(() => expect(within(rowOf('ISS/2026/77.0')).getByText('Closed')).toBeInTheDocument());
    expect(within(rowOf('ISS/2026/78.1')).getByText('Closed')).toBeInTheDocument();
    expect(screen.queryByLabelText('Select ISS/2026/77.0 for Close to Return')).toBeNull();
    expect(closeBtn()).toBeDisabled();
  });

  it('acts only on the ticked lines still on screen', async () => {
    await mountIssues();
    tick('ISS/2026/77.0');
    tick('ISS/2026/78.1');
    fireEvent.change(filter('sale order'), { target: { value: '26/656' } });
    expect(shown()).not.toContain('ISS/2026/78.1');
    expect(closeBtn()).toHaveTextContent('✔ Close to Return (1)');
    fireEvent.click(closeBtn());
    await waitFor(() => expect(bulkPosts()).toHaveLength(1));
    expect(bulkPosts()[0].body.txnIds).toEqual([101]);
  });

  it('does nothing when the confirmation is declined', async () => {
    await mountIssues();
    window.confirm.mockImplementation(() => false);
    tick('ISS/2026/77.0');
    fireEvent.click(closeBtn());
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(bulkPosts()).toHaveLength(0);
    expect(screen.getByLabelText('Select ISS/2026/77.0 for Close to Return')).toBeChecked();
  });

  it('says which lines the server would not close, and why', async () => {
    skipIds = new Set([102]);
    await mountIssues();
    tick('ISS/2026/77.0');
    tick('ISS/2026/78.1');
    fireEvent.click(closeBtn());
    expect(await screen.findByText(/Closed 1 line\(s\) — they are off the returns dropdown\. Not closed: ISS\/2026\/78\.1 \(everything on it has come back\)/)).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('ISS/2026/77.0')).getByText('Closed')).toBeInTheDocument());
    // the skipped one stays open and ticked
    expect(screen.getByLabelText('Select ISS/2026/78.1 for Close to Return')).toBeChecked();
  });

  it('falls back to one call per line against a backend without the bulk close', async () => {
    bulkStatus = 404;
    await mountIssues();
    tick('ISS/2026/77.0');
    tick('ISS/2026/78.1');
    fireEvent.click(closeBtn());
    await waitFor(() => expect(posted.filter((p) => /\/issue-lines\/\d+\/close\?closed=true$/.test(p.u)).map((p) => p.u.match(/issue-lines\/(\d+)/)[1])).toEqual(['101', '102']));
    expect(await screen.findByText(/Closed 2 line\(s\)/)).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('ISS/2026/78.1')).getByText('Closed')).toBeInTheDocument());
  });
});

/** Ledger ids enough for more than one close call (the server takes at most 500). */
const idsOf = (n) => Array.from({ length: n }, (_, i) => 1000 + i);

describe('Recent issues & returns — a big Close to Return (review H1)', () => {
  // "Select every open issue line shown" ticks every open line of up to 5000 history
  // rows; the server refuses a close call naming more than 500 (the mock above does
  // too). The desk's own call is closeLinesInSlices over the real stores API.
  async function closeAll(ids) {
    const { closeLinesInSlices, CLOSE_BATCH } = await import('../pages/Stores.jsx');
    const { storesApi } = await import('../api.js');
    expect(CLOSE_BATCH).toBe(500);
    return closeLinesInSlices(ids, {
      bulk: (slice) => storesApi.closeIssueLines(slice, true),
      one: (id) => storesApi.closeIssueLine(id, true),
    });
  }

  it('sends more than 500 ticked lines in slices the server accepts, and adds the answers up', async () => {
    skipIds = new Set([1003, 1700]);
    const r = await closeAll(idsOf(1022));
    const calls = bulkPosts().map((p) => p.body);
    expect(calls.map((b) => b.txnIds.length)).toEqual([500, 500, 22]);
    expect(calls.every((b) => b.closed === true)).toBe(true);
    expect(new Set(calls.flatMap((b) => b.txnIds)).size).toBe(1022);
    expect(r.closed).toBe(1020);
    expect(r.skipped.map((x) => x.txnId)).toEqual([1003, 1700]);
    expect(r.lines).toHaveLength(1020);
    expect(closed.size).toBe(1020);
  });

  it('says which slice the server refused — what went through stays closed', async () => {
    bulkFailIf = (ids) => ids.length < 500;          // the last slice
    const r = await closeAll(idsOf(520));
    expect(bulkPosts()).toHaveLength(2);
    expect(r.closed).toBe(500);
    expect(r.skipped).toHaveLength(20);
    expect(r.skipped[0]).toEqual({ txnId: 1500, reason: 'The ledger is busy — try again.' });
  });

  it('raises the server’s error when nothing at all was closed', async () => {
    bulkFailIf = () => true;
    await expect(closeAll(idsOf(600))).rejects.toThrow('The ledger is busy — try again.');
    expect(bulkPosts()).toHaveLength(2);
  });

  it('falls back to the one-line call for every slice against a backend without the bulk close', async () => {
    bulkStatus = 404;
    const r = await closeAll(idsOf(510));
    // tried once; once the bulk close is known to be missing it is not asked again
    expect(bulkPosts()).toHaveLength(1);
    expect(posted.filter((p) => /\/issue-lines\/\d+\/close\?closed=true$/.test(p.u))).toHaveLength(510);
    expect(r.closed).toBe(510);
  });

  it('a few ticked lines are still one call, through the screen', async () => {
    await mountIssues();
    fireEvent.click(screen.getByLabelText('Select every open issue line shown'));
    fireEvent.click(closeBtn());
    await waitFor(() => expect(bulkPosts()).toHaveLength(1));
    expect(bulkPosts()[0].body.txnIds).toEqual([101, 102]);
  });
});

describe('Recent issues & returns — closing the line being returned against (review H3)', () => {
  async function pickLine101() {
    fireEvent.click(screen.getByText('↙ Receive a return'));
    const lineSel = await screen.findByLabelText('Issue line');
    await waitFor(() => expect(optionsOf(lineSel)).toEqual(['101', '102']));
    fireEvent.change(lineSel, { target: { value: '101' } });
    expect(await screen.findByLabelText('Picked issue line')).toHaveTextContent('ISS/2026/77.0');
    // the line filled the item, the order and the department
    await waitFor(() => expect(screen.getByLabelText('Item')).toHaveValue('37'));
    expect(screen.getByLabelText('Sale order')).toHaveValue('26/656');
  }
  async function returnIsRefused() {
    // what the line filled in went with it
    expect(screen.getByLabelText('Item')).toHaveValue('');
    expect(screen.getByLabelText('Sale order')).toHaveValue('');
    expect(screen.queryByLabelText('Picked issue line')).toBeNull();
    // so Return cannot book an UNLINKED return against the roll of the closed line
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } });
    fireEvent.click(screen.getByText(/Receive return &/));
    expect(await screen.findByText('Pick the issue line (slip and roll) the material went out on.')).toBeInTheDocument();
    expect(posted.some((p) => p.u.includes('/api/stores/returns'))).toBe(false);
  }

  it('Close to Return in the history', async () => {
    await mountIssues();
    await pickLine101();
    tick('ISS/2026/77.0');
    fireEvent.click(closeBtn());
    expect(await screen.findByText(/Closed 1 line\(s\)/)).toBeInTheDocument();
    await returnIsRefused();
  });

  it('the picked line’s own close button', async () => {
    await mountIssues();
    await pickLine101();
    fireEvent.click(screen.getByLabelText('Close issue line ISS/2026/77.0'));
    expect(await screen.findByText('ISS/2026/77.0 closed — it is off the return list.')).toBeInTheDocument();
    await returnIsRefused();
  });

  // Review F2: the history (and its Close to Return) is on screen in Issue mode too. A line
  // picked on Return before the desk switched to Issue is closed there: the issue form is
  // the slip's by then, and taking the order off it let the slip go out with no sale order.
  it('closing it while issuing leaves the issue form and its slip alone', async () => {
    bom656 = [{ itemId: 37, itemCode: 'BLM037', itemName: '1200 MM', departmentName: 'Printing', qtyPerBase: 1, uom: 'Kg' }];
    units37 = [
      { id: 592, itemId: 37, internalCode: 'BLMU-592', qtyRemaining: 0, qtyReceived: 194.92, widthMm: 1200, uom: 'Kg', location: 'AG', holds: [], allocated: 0 },
      { id: 595, itemId: 37, internalCode: 'BLMU-595', qtyRemaining: 150, qtyReceived: 150, widthMm: 1200, uom: 'Kg', location: 'AG', holds: [], allocated: 0 },
    ];
    await mountIssues();
    await pickLine101();
    expect(screen.getByLabelText('Department')).toHaveValue('Printing');

    fireEvent.click(screen.getByText('↗ Issue material'));
    await waitFor(() => expect([...screen.getByLabelText('Roll').options].map((o) => o.value)).toContain('595'));
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '595' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '20' } });
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(screen.getByLabelText('Remove BLMU-595 from the slip')).toBeInTheDocument();

    tick('ISS/2026/77.0');
    fireEvent.click(closeBtn());
    expect(await screen.findByText(/Closed 1 line\(s\)/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    // the order, department and item the line once filled are the slip's now: they stay
    expect(screen.getByLabelText('Sale order')).toHaveValue('26/656');
    expect(screen.getByLabelText('Department')).toHaveValue('Printing');
    expect(screen.getByLabelText('Item')).toHaveValue('37');
    expect(screen.getByLabelText('Remove BLMU-595 from the slip')).toBeInTheDocument();
    // and the slip goes out to that order
    fireEvent.click(screen.getByText(/Issue & print slip/));
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/stores/issues/batch'))).toBe(true));
    expect(posted.find((p) => p.u.includes('/api/stores/issues/batch')).body)
      .toEqual({ so: '26/656', department: 'Printing', lines: [{ unitId: 595, qty: 20 }] });
    // back on Return, the closed line is not offered — nor still picked
    fireEvent.click(screen.getByText('↙ Receive a return'));
    await waitFor(() => expect(optionsOf(screen.getByLabelText('Issue line'))).toEqual(['102']));
    expect(screen.queryByLabelText('Picked issue line')).toBeNull();
  });
});

describe('Recent issues & returns — typing in the form above does not redraw it (review H2)', () => {
  it('is memoised, and the desk hands it callbacks that never change', async () => {
    const realMod = await vi.importActual('../components/StoresIssueHistory.jsx');
    expect(realMod.default.$$typeof).toBe(Symbol.for('react.memo'));
    const renders = [];
    vi.doMock('../components/StoresIssueHistory.jsx', async () => {
      const real = await vi.importActual('../components/StoresIssueHistory.jsx');
      const { memo, createElement } = await import('react');
      const Spy = memo((p) => { renders.push(p); return createElement(real.default, p); });
      return { ...real, default: Spy };
    });
    await mountIssues();
    const before = renders.length;
    expect(before).toBeGreaterThan(0);
    ['a', 'ab', 'abc'].forEach((v) => fireEvent.change(screen.getByLabelText('Note'), { target: { value: v } }));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '12' } });
    expect(screen.getByLabelText('Note')).toHaveValue('abc');
    expect(renders.length).toBe(before);
    // the callbacks it got are the same functions every time, and still work
    expect(new Set(renders.map((p) => p.onReprint)).size).toBe(1);
    expect(new Set(renders.map((p) => p.onCloseLines)).size).toBe(1);
    tick('ISS/2026/77.0');
    fireEvent.click(closeBtn());
    await waitFor(() => expect(bulkPosts()).toHaveLength(1));
  });
});

describe('Recent issues & returns — the filters (S5)', () => {
  it('sits on top in the doc\'s order, with Close to Return beside it', async () => {
    await mountIssues();
    const labels = ['date', 'item code', 'material type', 'sub group', 'speciality', 'item description', 'department', 'sale order'];
    const els = labels.map(filter);
    for (let i = 1; i < els.length; i++) {
      // eslint-disable-next-line no-bitwise
      expect(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(els[0].type).toBe('date');
    const bar = els[0].closest('.fbar');
    expect(bar).toContainElement(closeBtn());
    expect(bar).toContainElement(screen.getByLabelText('Clear history filters'));
    // above the table
    // eslint-disable-next-line no-bitwise
    expect(bar.compareDocumentPosition(table()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('narrows the rows by each filter, and Clear shows every slip again', async () => {
    await mountIssues();
    const all = shown();
    const tag = () => screen.getByText('Recent issues & returns', { exact: false }).querySelector('.tag');
    expect(tag()).toHaveTextContent('5');

    fireEvent.change(filter('date'), { target: { value: '2026-09-29' } });
    expect(shown()).toEqual(['ISS/2026/78.1', 'ISS/2026/78.2']);
    expect(tag()).toHaveTextContent('2 of 5');
    fireEvent.click(screen.getByLabelText('Clear history filters'));
    expect(shown()).toEqual(all);

    const one = (what, value, expected) => {
      fireEvent.change(filter(what), { target: { value } });
      expect(shown()).toEqual(expected);
      fireEvent.click(screen.getByLabelText('Clear history filters'));
    };
    one('item code', 'BLM034', ['ISS/2026/60.0', 'RET/2026/60.0/1']);
    one('material type', 'INK', ['ISS/2026/78.2']);
    one('sub group', 'LDPE', ['ISS/2026/78.1']);
    one('speciality', 'ANTIFOG', ['ISS/2026/77.0', 'ISS/2026/60.0', 'RET/2026/60.0/1']);
    one('item description', '700 MM', ['ISS/2026/60.0', 'RET/2026/60.0/1']);
    one('department', 'Slitting', ['ISS/2026/78.1', 'ISS/2026/60.0', 'RET/2026/60.0/1']);
    one('sale order', '26/700', ['ISS/2026/78.1', 'ISS/2026/78.2']);
    expect(shown()).toEqual(all);
    expect(screen.getByLabelText('Clear history filters')).toBeDisabled();
  });

  it('cascades: each dropdown offers only what the others leave', async () => {
    await mountIssues();
    expect(optionsOf(filter('material type'))).toEqual(['FILM', 'INK']);
    expect(optionsOf(filter('sub group'))).toEqual(['AF BOPP', 'LDPE', 'PROCESS']);
    fireEvent.change(filter('material type'), { target: { value: 'FILM' } });
    expect(optionsOf(filter('sub group'))).toEqual(['AF BOPP', 'LDPE']);
    expect(optionsOf(filter('item code'))).toEqual(['BLM034', 'BLM037', 'BLM050']);
    fireEvent.change(filter('sub group'), { target: { value: 'LDPE' } });
    expect(optionsOf(filter('speciality'))).toEqual(['NATURAL']);
    expect(optionsOf(filter('sale order'))).toEqual(['26/700']);
    expect(optionsOf(filter('department'))).toEqual(['Slitting']);
    // the material type still offers its siblings for the rows the sub group leaves
    expect(optionsOf(filter('material type'))).toEqual(['FILM']);
    // a day narrows the rest too
    fireEvent.click(screen.getByLabelText('Clear history filters'));
    fireEvent.change(filter('date'), { target: { value: '2026-09-30' } });
    expect(optionsOf(filter('item code'))).toEqual(['BLM037']);
  });

  it('files a row under the desk\'s own calendar day, not the UTC date', async () => {
    const { localDay } = await import('../components/StoresIssueHistory.jsx');
    const d = new Date(2026, 8, 30, 0, 30);          // 00:30 local time on 30 Sep
    expect(localDay(d.toISOString())).toBe('2026-09-30');
    expect(localDay('')).toBe('');
  });
});
