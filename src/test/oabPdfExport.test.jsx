import { vi, describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderApp, oabModule } from './harness.jsx';
import OabBoard from '../pages/OabBoard.jsx';

// The board PDF is a real vector table (jsPDF text primitives), not an html2canvas
// screenshot — see lib/oabPdf.js. Mock the builder and assert it receives the full
// filtered row set, which is what the old screenshot path used to truncate.
const { downloadOabPdfMock } = vi.hoisted(() => ({ downloadOabPdfMock: vi.fn() }));
vi.mock('../lib/oabPdf.js', () => ({ downloadOabPdf: downloadOabPdfMock }));

// 40 rows — far more than fit in the `.tw.sy` viewport, i.e. the reported scenario
// (Excel had all rows, PDF had only the ~5 visible ones).
const rows = Array.from({ length: 40 }, (_, i) => ({
  so: `26/${100 + i}`, spec: 'A1', customer: 'Acme', jobName: `Job ${i}`, subBrand: 'Fresh',
  dispLoc: 'HYD', poNum: `PO${i}`, poDate: '2026-07-01', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0,
  dispatchForm: 'pouch', stage: '', closed: false,
}));
const seed = { oab: oabModule({ SF: rows }) };

beforeEach(() => { downloadOabPdfMock.mockReset(); });

describe('OAB board PDF export — a vector table covering every row', () => {
  it('hands the whole filtered row set to the PDF builder, not just the visible ones', async () => {
    renderApp(<OabBoard />, { modules: seed, route: '/oab?sheet=SF' });
    await screen.findByText('Job 0');   // wait for the seeded rows to load

    fireEvent.click(screen.getByRole('button', { name: /⬇ PDF/i }));

    await waitFor(() => expect(downloadOabPdfMock).toHaveBeenCalledTimes(1));
    const [passedRows, sheet] = downloadOabPdfMock.mock.calls[0];
    expect(passedRows).toHaveLength(40);
    expect(sheet).toBe('SF');
  });

  it('exports only the rows left after a filter, in the displayed order', async () => {
    renderApp(<OabBoard />, { modules: seed, route: '/oab?sheet=SF' });
    await screen.findByText('Job 0');

    fireEvent.change(screen.getByLabelText('Search orders'), { target: { value: 'PO3' } });
    fireEvent.click(screen.getByRole('button', { name: /⬇ PDF/i }));

    await waitFor(() => expect(downloadOabPdfMock).toHaveBeenCalledTimes(1));
    const passedRows = downloadOabPdfMock.mock.calls[0][0];
    // PO3, PO30..PO39 — eleven rows, newest SO first (the default order).
    expect(passedRows.map((r) => r.poNum)).toHaveLength(11);
    expect(passedRows[0].so).toBe('26/139');
  });
});
