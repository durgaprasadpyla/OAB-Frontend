import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import Stores from '../pages/Stores.jsx';
import {
  CODE128_PATTERNS, QUIET, code128Bars, code128BValues, code128Checksum, code128Svg, code128Symbols, isCode128B,
} from '../lib/barcode.js';
import { RollSticker } from '../components/RollSticker.jsx';

// BloomFlex V2 roll stickers: a correct Code 128 (set B), the sticker itself, the GRN
// batch code + sticker modal, the scan box, and the whole-roll issue quantity.

describe('Code 128 set B', () => {
  it('has the standard 107-symbol width table: six widths summing to 11, the stop seven summing to 13', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.forEach((p, i) => {
      const sum = [...p].reduce((s, c) => s + Number(c), 0);
      expect(p).toHaveLength(i === 106 ? 7 : 6);
      expect(sum).toBe(i === 106 ? 13 : 11);
    });
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    // spot-check against the published table
    expect(CODE128_PATTERNS[0]).toBe('212222');     // space
    expect(CODE128_PATTERNS[33]).toBe('111323');    // 'A'
    expect(CODE128_PATTERNS[104]).toBe('211214');   // Start B
    expect(CODE128_PATTERNS[106]).toBe('2331112');  // Stop
  });

  it('computes the mod-103 checksum on known values', () => {
    // PJJ123C: 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879 → 879 mod 103 = 55
    expect(code128Checksum(code128BValues('PJJ123C'))).toBe(55);
    // BLMU-1: 104 + 34 + 44·2 + 45·3 + 53·4 + 13·5 + 17·6 = 740 → 19
    expect(code128Checksum(code128BValues('BLMU-1'))).toBe(19);
    expect(code128Symbols('BLMU-1')).toEqual([104, 34, 44, 45, 53, 13, 17, 19, 106]);
    // a single space: 104 + 0 = 104 → 1
    expect(code128Checksum(code128BValues(' '))).toBe(1);
  });

  it('lays the bars out to the right width (11 modules a symbol, 13 the stop, quiet zones each side)', () => {
    const { bars, width } = code128Bars('BLMU-12345');
    expect(width).toBe(11 * (1 + 10 + 1) + 13 + 2 * QUIET);
    // three bars a symbol, four in the stop
    expect(bars).toHaveLength(3 * 12 + 4);
    expect(bars[0]).toEqual({ x: QUIET, w: 2 });   // start B begins with a 2-module bar
    expect(code128Svg('BLMU-1')).toMatch(/^<svg /);
  });

  it('refuses anything outside printable ASCII', () => {
    expect(isCode128B('BLMU-1')).toBe(true);
    expect(isCode128B('')).toBe(false);
    expect(isCode128B('BLMU\n1')).toBe(false);
    expect(isCode128B('BLMU-१')).toBe(false);
    expect(isCode128B('ROLL·1')).toBe(false);
    expect(() => code128BValues('é')).toThrow(/printable ASCII/);
  });
});

const ROLL = {
  id: 11, itemId: 1, internalCode: 'BLMU-1', supplierCode: 'CF-9931', batchCode: 'LOT-77', supplier: 'Cosmos Films',
  location: 'Rack A1', uom: 'Kg', qtyReceived: 400, qtyRemaining: 250, widthMm: 1200, expiryDate: '2027-01-31',
  status: 'MOVING', itemCode: 'FILM-BOPP20', itemName: 'BOPP Film 20mic', materialType: 'BOPP', subGroup: 'Films',
  specialtyName: 'High Barrier',
};

describe('the roll sticker', () => {
  afterEach(() => cleanup());

  it('prints the identity, batch, rack, expiry, current quantity, the barcode and the sign line', () => {
    render(<RollSticker unit={ROLL} />);
    const s = screen.getByTestId('roll-sticker');
    expect(within(s).getByText('BLOOMFLEX')).toBeInTheDocument();
    ['FILM-BOPP20', 'BOPP Film 20mic', 'BOPP', 'Films', 'High Barrier', 'Cosmos Films', 'LOT-77 / CF-9931',
      'Rack A1', '2027-01-31', '250 Kg'].forEach((v) => expect(within(s).getByText(v)).toBeInTheDocument());
    expect(within(s).getAllByText('BLMU-1').length).toBe(2);          // badge + human-readable line
    const svg = within(s).getByRole('img', { name: 'Code 128 barcode BLMU-1' });
    expect(svg.querySelectorAll('g rect')).toHaveLength(code128Bars('BLMU-1').bars.length);
    expect(within(s).getByText(/Stores _+/)).toBeInTheDocument();
    expect(within(s).getByText(/QC _+/)).toBeInTheDocument();
  });

  it('says so instead of drawing a wrong barcode for a code it cannot encode', () => {
    render(<RollSticker unit={{ ...ROLL, internalCode: 'BLMU–1' }} />);
    expect(screen.getByText(/No barcode/)).toBeInTheDocument();
  });
});

/* ───────────────────────── the screens ───────────────────────── */

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

const BOARD = [{ id: 1, code: 'FILM-BOPP20', name: 'BOPP Film 20mic', uom: 'Kg', materialType: 'BOPP', subGroup: 'Films',
  specialtyName: 'High Barrier', departmentName: 'Printing', msl: 0, closingStock: 250, unitCount: 1 },
  { id: 2, code: 'INK-CYAN', name: 'Cyan Ink', uom: 'Kg', materialType: 'Ink', subGroup: 'Chemicals', departmentName: 'Printing', closingStock: 25, unitCount: 1 }];
const UNITS = [{ ...ROLL }];
const ISSUE_LINES = [{ txnId: 501, lineNo: 'ISS/2026/4.0', slipNo: 'ISS/2026/4', unitId: 11, internalCode: 'BLMU-1', itemId: 1,
  itemCode: 'FILM-BOPP20', itemName: 'BOPP Film 20mic', uom: 'Kg', qtyIssued: 250, qtyReturned: 0, rollsReturned: 0,
  department: 'Printing', so: '26/500', ts: '2026-11-01T10:00:00Z' }];

let calls;
beforeEach(() => {
  calls = [];
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'stores');
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ u, method, body });
    if (u.includes('/api/auth/me')) return res(200, { username: 'store1', role: 'stores' });
    if (u.includes('/api/stores/on-hand')) return res(200, BOARD);
    if (u.includes('/api/stores/units/by-code/')) {
      const code = decodeURIComponent(u.split('/by-code/')[1]).toUpperCase();
      if (code === 'BLMU-1') return res(200, ROLL);
      if (code === 'BLMU-9') return res(200, { ...ROLL, id: 99, internalCode: 'BLMU-9', qtyRemaining: 400, batchCode: 'B-NEW' });
      if (code === 'BLMU-50') return res(200, { ...ROLL, id: 50, internalCode: 'BLMU-50', itemId: 2, itemCode: 'INK-CYAN' });
      return res(404, { message: `No roll with the code ${code} — check the sticker.` });
    }
    if (u.match(/\/api\/stores\/items\/\d+\/units/)) return res(200, UNITS);
    if (u.includes('/api/stores/grns')) return method === 'POST'
      ? res(201, { grnNo: 'GRN/2026/1', units: [{ unitId: 99, internalCode: 'BLMU-9' }] })
      : res(200, []);
    if (u.includes('/api/stores/issue-lines')) return res(200, ISSUE_LINES);
    if (u.includes('/api/stores/issues/batch')) return res(201, { slipNo: 'ISS/2026/1', so: body.so, department: body.department, totalQty: 250, lines: [{ unitId: 11, internalCode: 'BLMU-1', qty: 250, remaining: 0 }] });
    if (u.includes('/api/stores/returns')) return res(200, { unitId: 11, issueTxnId: 501, issueLineNo: 'ISS/2026/4.0', returned: [], returnNos: [] });
    if (u.includes('/api/stores/next-codes') || u.includes('/api/stores/units/next')) return res(200, { codes: ['BLMU-9'] });
    if (u.includes('/api/master/items')) return res(200, [
      { id: 1, code: 'FILM-BOPP20', name: 'BOPP Film 20mic', uom: 'Kg', materialType: 'BOPP', subGroup: 'Films', specialtyName: 'High Barrier' },
      { id: 2, code: 'INK-CYAN', name: 'Cyan Ink', uom: 'Kg', materialType: 'Ink', subGroup: 'Chemicals' },
    ]);
    if (u.includes('/rest/v1/oab_data')) {
      return res(200, [{ id: 6, data: JSON.stringify({ asl: [{ company: 'Cosmos Films', itemCode: 'FILM-BOPP20' }], pos: [] }), version: 1 }]);
    }
    return res(200, []);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = () => render(<MemoryRouter><AuthProvider><DataProvider><Stores /></DataProvider></AuthProvider></MemoryRouter>);

describe('Stores — roll stickers on the screens', () => {
  it('a GRN line carries a batch code, and the posted GRN opens its stickers with a print-all button', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    window.print = print;
    mount();
    await user.click(screen.getByText(/📥 GRN/));
    const supplier = await screen.findByLabelText('Supplier');
    await waitFor(() => expect([...supplier.options].map((o) => o.value)).toContain('Cosmos Films'));
    fireEvent.change(supplier, { target: { value: 'Cosmos Films' } });
    fireEvent.change(await screen.findByLabelText('Item for line 1'), { target: { value: 'FILM-BOPP20' } });
    fireEvent.change(screen.getByLabelText('Quantity line 1'), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText('Batch code line 1'), { target: { value: 'LOT-77' } });
    await user.click(screen.getByRole('button', { name: /Receive material/ }));

    await waitFor(() => expect(calls.some((c) => c.u.includes('/api/stores/grns') && c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.u.includes('/api/stores/grns') && c.method === 'POST');
    expect(post.body.lines[0].batchCode).toBe('LOT-77');

    // the stickers for every roll the receipt created, read back by code
    const dialog = await screen.findByRole('dialog', { name: /GRN\/2026\/1 posted/ });
    await waitFor(() => expect(within(dialog).getAllByTestId('roll-sticker')).toHaveLength(1));
    expect(calls.some((c) => c.u.includes('/api/stores/units/by-code/BLMU-9'))).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: /Print sticker/ }));
    expect(print).toHaveBeenCalled();
    // the print-only copy is on <body>, outside the app
    expect(document.body.querySelector(':scope > .bf-sticker-print [data-testid="roll-sticker"]')).not.toBeNull();
  });

  it('issues a picked roll whole: the quantity is the roll’s full remaining and cannot be typed', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText(/Issues & Returns/));
    fireEvent.change(await screen.findByLabelText('Item'), { target: { value: '1' } });
    const rollSel = await screen.findByLabelText('Roll');
    await waitFor(() => expect([...rollSel.options].length).toBeGreaterThan(1));
    fireEvent.change(rollSel, { target: { value: '11' } });
    const q = screen.getByLabelText('Quantity');
    await waitFor(() => expect(q).toHaveValue(250));
    expect(q).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Whole roll hint')).toHaveTextContent(/Whole roll \(250 Kg\) — return the unused balance on the same roll/);
    // a typed part is put straight back to the whole roll
    fireEvent.change(q, { target: { value: '100' } });
    await waitFor(() => expect(q).toHaveValue(250));
  });

  it('a scanned sticker picks the roll on Issue, and a roll of another item is refused', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText(/Issues & Returns/));
    const scan = await screen.findByLabelText('Scan / type roll barcode');
    fireEvent.change(scan, { target: { value: 'blmu-1' } });
    fireEvent.keyDown(scan, { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('Item')).toHaveValue('1'));
    await waitFor(() => expect(screen.getByLabelText('Roll')).toHaveValue('11'));
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue(250));

    fireEvent.change(scan, { target: { value: 'BLMU-50' } });
    fireEvent.keyDown(scan, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/BLMU-50 \(INK-CYAN\) is not a roll of FILM-BOPP20/)).toBeInTheDocument());
    expect(screen.getByLabelText('Roll')).toHaveValue('11');

    fireEvent.change(scan, { target: { value: 'BLMU-404' } });
    fireEvent.keyDown(scan, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/No roll with the code BLMU-404/)).toBeInTheDocument());
  });

  it('on Return the scanned roll must be the issue line’s roll; after the return its label is offered again', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText(/Issues & Returns/));
    await user.click(await screen.findByText('↙ Receive a return'));
    const scan = await screen.findByLabelText('Scan / type roll barcode (return)');
    // no line picked: the roll's one open line is picked for it
    fireEvent.change(scan, { target: { value: 'BLMU-1' } });
    fireEvent.keyDown(scan, { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('Issue line')).toHaveValue('501'));
    // a different roll against that line is refused
    fireEvent.change(scan, { target: { value: 'BLMU-9' } });
    fireEvent.keyDown(scan, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/BLMU-9 is not the roll of ISS\/2026\/4.0/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '40' } });
    await user.click(screen.getByRole('button', { name: /Receive return/ }));
    await waitFor(() => expect(calls.some((c) => c.u.includes('/api/stores/returns'))).toBe(true));
    await user.click(await screen.findByRole('button', { name: 'Print updated label' }));
    const dialog = await screen.findByRole('dialog', { name: /Reprint with the updated quantity/ });
    await waitFor(() => expect(within(dialog).getByTestId('roll-sticker')).toBeInTheDocument());
    expect(within(dialog).getAllByText('BLMU-1').length).toBeGreaterThan(0);
  });
});
