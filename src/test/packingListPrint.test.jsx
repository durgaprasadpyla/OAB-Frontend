import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PackingListModal, { buildAutoPackingList } from '../components/PackingListModal.jsx';

const header = {
  ivNo: 'BL/26-27/223', ivDt: '2026-08-20', customer: 'Green Agrevolution Pvt Ltd',
  billingAddr: 'Gurugram, Haryana', shippingAddr: 'Hosur, Tamil Nadu',
  contactPerson: 'Abhinav', contactNo: '7282887846', placeOfSupply: 'Hosur',
};

// Four records — the exact scenario from the bug report (Excel exported all 4, Print
// showed only 1). Print must put every record into the print output.
const items = [
  { jobName: 'Pouch A', spec: 'A1', totalQty: 100, bags: [{ from: 1, to: 50, qty: 50 }, { from: 51, to: 100, qty: 50 }] },
  { jobName: 'Pouch B', spec: 'B2', totalQty: 60, bags: [{ from: 1, to: 60, qty: 60 }] },
  { jobName: 'Pouch C', spec: 'C3', totalQty: 40, bags: [{ from: 1, to: 40, qty: 40 }] },
  { jobName: 'Pouch D', spec: 'D4', totalQty: 25, bags: [{ from: 1, to: 25, qty: 25 }] },
];

/** Stand in for the popup window printPackingList() writes the clean sheet into. */
function stubPrintWindow() {
  const win = { written: '', document: { write(html) { win.written += html; }, close() {} }, print: vi.fn() };
  const spy = vi.spyOn(window, 'open').mockReturnValue(win);
  return { win, spy };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('PackingListModal — Print writes the clean sheet for every record', () => {
  it('opens a print window carrying EVERY record, then prints it (parity with production)', () => {
    vi.useFakeTimers();
    const { win } = stubPrintWindow();
    render(<PackingListModal items={items} invNo="BL/26-27/223" header={header} onClose={() => {}} />);

    // All four records are on screen to begin with.
    items.forEach((it) => expect(screen.getByText(it.jobName)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /🖨 Print/i }));

    // The popup document carries every record, plus the consignee block and totals.
    items.forEach((it) => expect(win.written).toContain(it.jobName));
    expect(win.written).toContain('PACKING LIST');
    expect(win.written).toContain('Name of the Consignee');
    expect(win.written).toContain('GRAND TOTAL');
    // …and no editor controls leak into the printed sheet.
    expect(win.written).not.toContain('<input');

    vi.runAllTimers();
    expect(win.print).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('is read-only: the on-screen document has no inputs or add buttons', () => {
    render(<PackingListModal items={items} invNo="BL/26-27/223" header={header} onClose={() => {}} />);
    expect(document.querySelectorAll('#pl-doc input').length).toBe(0);
    expect(document.querySelectorAll('#pl-doc button').length).toBe(0);
    // Computed ranges show as plain text, e.g. rows 51–100 of Pouch A.
    expect(screen.getByText('51 – 100')).toBeInTheDocument();
  });
});

describe('buildAutoPackingList — bags derive entirely from qty ÷ qtyPerBag', () => {
  const qpbOf = (spec) => ({ A1: 25, B2: 60 }[spec] || 0);

  it('computes full bags plus a remainder bag summing exactly to the invoice qty', () => {
    const [a] = buildAutoPackingList([{ spec: 'A1', jobName: 'Pouch A', qty: 110 }], qpbOf);
    expect(a.bags).toEqual([{ from: 1, to: 4, qty: 25 }, { from: 5, to: 5, qty: 10 }]);
    expect(a.bags.reduce((s, b) => s + (b.to - b.from + 1) * b.qty, 0)).toBe(110);
  });

  it('exact multiples get no remainder bag; missing qtyPerBag gets no bags', () => {
    const [b, c] = buildAutoPackingList([
      { spec: 'B2', jobName: 'Pouch B', qty: 120 },
      { spec: 'ZZ', jobName: 'Mystery', qty: 40 },
    ], qpbOf);
    expect(b.bags).toEqual([{ from: 1, to: 2, qty: 60 }]);
    expect(c.bags).toEqual([]);
  });

  it('a spec without a packing standard renders a fix-it instruction, not blank boxes', () => {
    const gen = buildAutoPackingList([{ spec: 'ZZ', jobName: 'Mystery', qty: 40 }], qpbOf);
    render(<PackingListModal items={gen} invNo="BL/26-27/224" header={header} onClose={() => {}} />);
    expect(screen.getByText(/Qty per Bag is not set on JSS spec/)).toBeInTheDocument();
  });
});
