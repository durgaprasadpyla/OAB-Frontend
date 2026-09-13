import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// Sales History tab (Issues 6 §18-§37), on the screen: current month by default,
// live figures with the Stayfresh / domestic split and the Price Master margins,
// the missing-Price-Master note, the rep when a customer is picked, the exports
// and the past-month upload.

const res = (body, status = 200) => ({ status, ok: status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const pad = (n) => String(n).padStart(2, '0');
const today = new Date();
const cur = today.getFullYear() + '-' + pad(today.getMonth() + 1);
const prevD = new Date(today.getFullYear(), today.getMonth() - 1, 1);
const prev = prevD.getFullYear() + '-' + pad(prevD.getMonth() + 1);
const d = (p, day) => p + '-' + pad(day);

const LINES = [
  { period: cur, date: d(cur, 1), invNo: 'INV/1', customer: 'AMAZON', spec: 'A1', jobType: 'StayFresh', qty: 1000, rate: 3, amount: 3000, amountInclGst: 3540, costPrice: 2, source: 'invoice' },
  { period: cur, date: d(cur, 1), invNo: 'INV/2', customer: 'TERRA', spec: 'B2', jobType: 'Others', qty: 200, rate: 5, amount: 1000, amountInclGst: 1180, costPrice: null, source: 'invoice' },
  { period: prev, date: d(prev, 1), invNo: 'INV/0', customer: 'AMAZON', spec: 'A1', jobType: 'StayFresh', qty: 2000, rate: 3, amount: 6000, amountInclGst: 7080, costPrice: 2, source: 'invoice' },
];
const PERIODS = [{ period: prev, source: 'invoice', invoices: 1, lineCount: 1 }, { period: cur, source: 'invoice', invoices: 2, lineCount: 2 }];

let posted, exported, pdfs;
beforeEach(() => {
  posted = []; exported = []; pdfs = [];
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: {
    jss: [{ spec: 'A1', jobType: 'StayFresh', customer: 'AMAZON', jobName: 'Poly bag' }, { spec: 'B2', jobType: 'Others', customer: 'TERRA', jobName: 'Coralife' }],
    customers: [{ customer: 'AMAZON', group: 'AMAZON GROUP' }, { customer: 'TERRA', group: '' }],
    prices: { A1: { price: 3, costPrice: 2 } },
    sales: { leads: [{ id: 'l1', client_name: 'AMAZON', kam: 'Ravi', assigned_to: 'u7' }], sales_users: [{ id: 'u7', display_name: 'Sita' }] },
  }, save: vi.fn(), reloadModule: vi.fn() }) }));
  vi.doMock('../lib/xlsx.js', () => ({
    exportAOA: vi.fn((rows, name) => exported.push({ rows, name })),
    readSheetAOA: vi.fn(async () => [['Customer', 'Spec', 'Qty', 'Total Sale'], ['AMAZON', 'A1', 500, 1500], ['Total', '', 500, 1500]]),
    readSheet: vi.fn(async () => []), exportObjects: vi.fn(),
  }));
  vi.doMock('../lib/tablePdf.js', () => ({ buildTablePdf: vi.fn((spec) => { pdfs.push(spec); return { save: vi.fn() }; }), safeName: (s) => s }));
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET') !== 'GET') {
      const body = opts.body ? JSON.parse(opts.body) : {};
      posted.push({ u, method: opts.method, body });
      if (u.includes('/api/sales-history/uploads')) return res({ period: body.period, lines: (body.lines || []).length, totalAmount: 1500, replaced: false }, 201);
      return res({});
    }
    if (u.includes('/api/sales-history/lines')) return res({ from: '2024-01', to: cur, currentPeriod: cur, undatedInvoices: 0, periods: PERIODS, lines: LINES });
    if (u.includes('/api/sales-history/uploads')) return res([{ period: '2026-01', fileName: 'jan.xlsx', lineCount: 12, totalAmount: 99000, uploadedBy: 'boss', uploadedAt: '2026-09-01T00:00:00Z' }]);
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

async function mount() {
  const { default: SalesHistoryPanel } = await import('../components/SalesHistoryPanel.jsx');
  render(<SalesHistoryPanel />);
  await waitFor(() => expect(screen.getByLabelText('Data source')).toHaveTextContent('live from the invoicing module'));
}
const tile = (label) => [...document.querySelectorAll('.stat')].find((c) => c.querySelector('.sl') && c.querySelector('.sl').textContent.trim().startsWith(label));

describe('Sales History — the landing page', () => {
  it('opens on the current month and year, live from invoicing, with the split and the margins', async () => {
    await mount();
    expect(screen.getByLabelText('Month')).toHaveValue(String(today.getMonth() + 1));
    expect(screen.getByLabelText('Year')).toHaveValue(String(today.getFullYear()));
    expect(screen.getByLabelText('Data source')).toHaveTextContent('live from the invoicing module');
    expect(screen.getByLabelText('Data source')).toHaveTextContent('2 invoice(s)');
    expect(tile('Stayfresh sale')).toHaveTextContent('₹3,000');
    expect(tile('Domestic sale')).toHaveTextContent('₹1,000');
    expect(tile('Total sale (base)')).toHaveTextContent('₹4,000');
    expect(tile('Total incl. GST 18%')).toHaveTextContent('₹4,720');
    expect(tile('Stayfresh margin')).toHaveTextContent('₹1,000');
    expect(tile('Stayfresh margin')).toHaveTextContent('+33.3%');
    expect(tile('Domestic margin')).toHaveTextContent('no Price Master cost');
    // §21: the missing Price Master, said rather than booked at zero
    expect(screen.getByLabelText('Missing price master')).toHaveTextContent('1 invoiced JSS do not have Price Master details');
    expect(screen.getByLabelText('Missing price master')).toHaveTextContent('B2');
  });

  it('compares with last month up to the same day, and shows the KAM when a customer is picked', async () => {
    await mount();
    const day = today.getDate();
    expect(screen.getByText(new RegExp(`1–${day} .* against 1–`))).toBeInTheDocument();
    // 4,000 this month against 6,000 by the same day last month
    expect(tile('Total: ₹4,000 vs ₹6,000')).toHaveTextContent('▼ ₹2,000');
    expect(tile('Total: ₹4,000 vs ₹6,000')).toHaveTextContent('-33.3%');
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'AMAZON' } });
    const rep = await screen.findByLabelText('Sales representative');
    expect(rep).toHaveTextContent('Ravi');
    expect(rep).toHaveTextContent('Sita');
    expect(rep).toHaveTextContent('down -50.0%');            // 3,000 against 6,000 — worth a call
    // the filter scoped everything: domestic is now nil
    expect(tile('Domestic sale')).toHaveTextContent('₹0');
    // the per-customer table names the rep, marks the fall, and carries the margin month by month
    const table = screen.getByText(/By customer —/).closest('.card');
    expect(within(table).getByText('Ravi · Sita')).toBeInTheDocument();
    expect(within(table).getByText('1 fell')).toBeInTheDocument();
    expect(within(table).getByLabelText('Margin trend for AMAZON')).toHaveTextContent(/33% → .*33%/);
    // §24-25: the SKU × month history under the chosen customer
    const pivot = screen.getByText(/By SKU, month by month — AMAZON/).closest('.card');
    expect(within(pivot).getByText('A1')).toBeInTheDocument();
    expect(within(pivot).getByText('Poly bag')).toBeInTheDocument();
    expect(within(pivot).getAllByText('₹3,000').length).toBeGreaterThan(0);   // this month's cell
    // the month table now shows the same month last year on every row
    expect(screen.getByText('Same month last year')).toBeInTheDocument();
  });

  it('exports the month as Excel and PDF from the same live lines, and re-reads on refresh', async () => {
    await mount();
    fireEvent.click(screen.getByLabelText('Download Excel'));
    expect(exported).toHaveLength(1);
    expect(exported[0].name).toBe(`Sales_History_${cur}.xlsx`);
    expect(exported[0].rows[1]).toEqual(['Stayfresh sale', 3000, 'Stayfresh margin', 1000]);
    expect(exported[0].rows.filter((r) => r[0] === 'INV/1' || r[0] === 'INV/2')).toHaveLength(2);
    fireEvent.click(screen.getByLabelText('Download PDF'));
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0].title).toContain('Sales History');
    expect(pdfs[0].rows).toHaveLength(2);
    expect(pdfs[0].meta.find((m) => m[0] === 'JSS without Price Master')[1]).toBe('1');
    const before = globalThis.fetch.mock.calls.filter((c) => String(c[0]).includes('/api/sales-history/lines')).length;
    fireEvent.click(screen.getByLabelText('Refresh sales history'));
    await waitFor(() => expect(globalThis.fetch.mock.calls.filter((c) => String(c[0]).includes('/api/sales-history/lines')).length).toBe(before + 1));
  });

  it('uploads a past month from a sheet, previewing the rows first, and lists what is on file', async () => {
    await mount();
    expect(screen.getByText('jan.xlsx')).toBeInTheDocument();
    const input = screen.getByLabelText('Sales sheet');
    fireEvent.change(input, { target: { files: [new File(['x'], 'aug.xlsx')] } });
    const preview = await screen.findByLabelText('Upload preview');
    expect(preview).toHaveTextContent('1 row(s) read from row 1 down');   // the Total row is skipped
    expect(preview).toHaveTextContent('₹1,500');
    fireEvent.click(screen.getByText(/⬆ Add/));
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/sales-history/uploads'))).toBe(true));
    const body = posted.find((p) => p.u.includes('/api/sales-history/uploads')).body;
    expect(body.period).toBe(prev);                       // defaults to last month
    expect(body.lines).toEqual([{ customer: 'AMAZON', spec: 'A1', qty: 500, amount: 1500, amountInclGst: undefined }]);
    expect(await screen.findByText(/1 row\(s\), ₹1,500 added to the history/)).toBeInTheDocument();
  });

  it('refuses to upload the current month — it comes from invoicing', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Sales sheet'), { target: { files: [new File(['x'], 'now.xlsx')] } });
    await screen.findByLabelText('Upload preview');
    fireEvent.change(screen.getByLabelText('Upload month'), { target: { value: String(today.getMonth() + 1) } });
    fireEvent.change(screen.getByLabelText('Upload year'), { target: { value: String(today.getFullYear()) } });
    fireEvent.click(screen.getByText(/⬆ Add/));
    expect(await screen.findByText(/is the current month — it comes from the invoicing module in real time/)).toBeInTheDocument();
    expect(posted.filter((p) => p.u.includes('/api/sales-history/uploads')).length).toBe(0);
  });
});

describe('the vector PDFs', () => {
  it('builds an issue slip and a table report with a fake jsPDF', async () => {
    vi.doUnmock('../lib/tablePdf.js');
    const calls = [];
    class FakePdf {
      constructor() { this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } }; }
      setTextColor() {} setFont() {} setFontSize() {} setFillColor() {} setDrawColor() {} setLineWidth() {}
      rect() {} line() {} addPage() { calls.push('page'); }
      text(t) { calls.push(String(Array.isArray(t) ? t.join(' ') : t)); }
      splitTextToSize(t) { return [String(t)]; }
      save(name) { calls.push('save:' + name); }
    }
    window.jspdf = { jsPDF: FakePdf };
    const { saveIssueSlipPdf } = await import('../lib/issueSlipPdf.js');
    const name = saveIssueSlipPdf({ slipNo: 'ISS/2026/7', so: '26/737', department: 'Printing', spec: 'A737', customer: 'AMAZON', jobName: 'Poly bag',
      issuedAt: '2026-09-13T10:00:00Z', issuedBy: 'store1', totalQty: 230,
      lines: [{ internalCode: 'BLMU-7', itemCode: 'BLM037', itemName: '1200 MM', widthMm: 1200, location: 'A2', qty: 200, uom: 'Kg' }, { internalCode: 'BLMU-8', itemCode: 'BLM037', itemName: '1200 MM', widthMm: 1200, location: 'A2', qty: 30, uom: 'Kg' }] });
    expect(name).toBe('Issue_Slip_ISS-2026-7_Printing.pdf');
    expect(calls).toContain('save:Issue_Slip_ISS-2026-7_Printing.pdf');
    expect(calls.some((c) => c.includes('Material Issue Slip ISS/2026/7'))).toBe(true);
    expect(calls).toContain('BLMU-8');
    expect(calls.some((c) => c.includes('issued from Stores to the Printing department for sale order 26/737'))).toBe(true);
    expect(calls).toContain('Received by (Printing)');
  });
});
