import { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PackingListModal from '../components/PackingListModal.jsx';

// Stateful wrapper so controlled bag inputs actually update when typed into.
function Harness({ initial }) {
  const [its, setIts] = useState(initial);
  return <PackingListModal items={its} setItems={setIts} invNo="BL/26-27/223" header={header} onClose={() => {}} />;
}

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
    render(<PackingListModal items={items} setItems={() => {}} invNo="BL/26-27/223" header={header} onClose={() => {}} />);

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

  it('prints the values currently typed into the bag rows', () => {
    const { win } = stubPrintWindow();
    render(<Harness initial={items} />);

    // Type a new "Bag To" value on the first row.
    const firstTo = document.querySelector('#pl-doc tbody tr td:nth-child(2) input');
    fireEvent.change(firstTo, { target: { value: '999' } });

    fireEvent.click(screen.getByRole('button', { name: /🖨 Print/i }));

    // 1–999 is 999 bags of 50 → the printed sheet shows the live figures.
    expect(win.written).toContain('1 – 999');
    expect(win.written).toContain('999 bag(s) = 49,950 pcs');
  });
});
