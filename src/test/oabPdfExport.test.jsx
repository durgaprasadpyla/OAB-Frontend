import { vi, describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderApp, oabModule } from './harness.jsx';
import OabBoard from '../pages/OabBoard.jsx';

// Mock the PDF lib so the export never touches html2canvas / <canvas> (unsupported in
// jsdom); instead record the scroll container's clip state at the instant elementToPDF
// is called. That state is the whole fix: it must be un-clipped during the capture.
const { elementToPDFMock } = vi.hoisted(() => ({ elementToPDFMock: vi.fn() }));
vi.mock('../lib/pdf.js', () => ({ elementToPDF: elementToPDFMock, printElement: vi.fn() }));

// 40 rows — far more than fit in the `.tw.sy` viewport, i.e. the reported scenario
// (Excel had all rows, PDF had only the ~5 visible ones).
const rows = Array.from({ length: 40 }, (_, i) => ({
  so: `26/${100 + i}`, spec: 'A1', customer: 'Acme', jobName: `Job ${i}`, subBrand: 'Fresh',
  dispLoc: 'HYD', poNum: `PO${i}`, poDate: '2026-07-01', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0,
  dispatchForm: 'pouch', stage: '', closed: false,
}));
const seed = { oab: oabModule({ SF: rows }) };

let clipDuringCapture;
beforeEach(() => {
  clipDuringCapture = null;
  elementToPDFMock.mockReset();
  elementToPDFMock.mockImplementation(async (el) => {
    clipDuringCapture = { maxHeight: el.style.maxHeight, overflow: el.style.overflow };
  });
});

describe('OAB board PDF export — captures every row, not just the visible ones', () => {
  it('un-clips the scroll container for the capture, then restores it', async () => {
    renderApp(<OabBoard />, { modules: seed, route: '/oab?sheet=SF' });
    await screen.findByText('Job 0');   // wait for the seeded rows to load

    fireEvent.click(screen.getByRole('button', { name: /PDF/i }));

    await waitFor(() => expect(elementToPDFMock).toHaveBeenCalledTimes(1));
    // At capture time the container was un-clipped, so the full table (all 40 rows) is
    // laid out for html2canvas instead of just the scroll viewport.
    expect(clipDuringCapture).toEqual({ maxHeight: 'none', overflow: 'visible' });

    // Afterwards the inline overrides are cleared, so the `.tw.sy` scroll behaviour
    // (max-height from the CSS class) is back — the on-screen table is unchanged.
    await waitFor(() => {
      const el = document.querySelector('.tw.sy');
      expect(el.style.maxHeight).toBe('');
      expect(el.style.overflow).toBe('');
    });
  });
});
