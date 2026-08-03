import { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PackingListModal from '../components/PackingListModal.jsx';

// Stateful wrapper so controlled bag inputs actually update when typed into.
function Harness({ initial }) {
  const [its, setIts] = useState(initial);
  return <PackingListModal items={its} setItems={setIts} invNo="BL/26-27/223" onClose={() => {}} />;
}

// Four records — the exact scenario from the bug report (Excel exported all 4, Print
// showed only 1). Print must now put every record into the print output.
const items = [
  { jobName: 'Pouch A', spec: 'A1', totalQty: 100, bags: [{ from: 1, to: 50, qty: 50 }, { from: 51, to: 100, qty: 50 }] },
  { jobName: 'Pouch B', spec: 'B2', totalQty: 60, bags: [{ from: 1, to: 60, qty: 60 }] },
  { jobName: 'Pouch C', spec: 'C3', totalQty: 40, bags: [{ from: 1, to: 40, qty: 40 }] },
  { jobName: 'Pouch D', spec: 'D4', totalQty: 25, bags: [{ from: 1, to: 25, qty: 25 }] },
];

afterEach(() => {
  cleanup();
  document.body.classList.remove('pl-printing');
  document.querySelectorAll('.pl-print-clone').forEach((n) => n.remove());
});

describe('PackingListModal — Print includes every displayed record', () => {
  it('clones all records to <body> for printing, then cleans up (parity with the PDF export)', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.useFakeTimers();
    render(<PackingListModal items={items} setItems={() => {}} invNo="BL/26-27/223" onClose={() => {}} />);

    // All four records are on screen to begin with.
    items.forEach((it) => expect(screen.getByText(it.jobName)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Print/i }));

    // The print clone is appended to <body> and contains EVERY record (not just one).
    const clone = document.body.querySelector('.pl-print-clone');
    expect(clone).toBeTruthy();
    items.forEach((it) => expect(clone.textContent).toContain(it.jobName));
    expect(document.body.classList.contains('pl-printing')).toBe(true);

    // The browser print dialog is invoked once, after the paint delay.
    vi.runAllTimers();
    expect(printSpy).toHaveBeenCalledTimes(1);

    // afterprint tears the clone down and clears the print flag.
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.querySelector('.pl-print-clone')).toBeNull();
    expect(document.body.classList.contains('pl-printing')).toBe(false);

    vi.useRealTimers();
    printSpy.mockRestore();
  });

  it('copies live (typed) bag values into the printed clone', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<Harness initial={items} />);

    // Type a new "Bag To" value on the first row; controlled-input values live on the
    // DOM property, which cloneNode does not carry unless we copy it (the fix does).
    const firstTo = document.querySelector('tbody tr td:nth-child(3) input');
    fireEvent.change(firstTo, { target: { value: '999' } });

    fireEvent.click(screen.getByRole('button', { name: /Print/i }));

    const clone = document.body.querySelector('.pl-print-clone');
    const cloneInputs = [...clone.querySelectorAll('input')].map((i) => i.value);
    expect(cloneInputs).toContain('999');
  });
});
