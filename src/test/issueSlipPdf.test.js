import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildIssueSlipPdf, buildReturnSlipPdf } from '../lib/issueSlipPdf.js';
import { buildTablePdf } from '../lib/tablePdf.js';

// Issues 30.09 (Stores S1) — the issue slip the client attached (ISS/2026/77):
//   "Job name and Customer name OVERLAP" — a wrapped customer printed over the Job
//   name row, and the end of the job name went UNDER the table's blue header bar;
//   "ISS/2026/77.0" wrapped with ".0" on a second line.
//
// A stand-in jsPDF that wraps text the way jsPDF does (greedy on spaces, a token too
// long for the width split by character) and remembers where every line landed, so
// the layout can be checked by its coordinates.

const MM_PER_PT = 25.4 / 72;

class FakePdf {
  constructor() {
    this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    this.size = 16;
    this.lines = [];   // { s, x, y, size } — one per drawn line
    this.rects = [];
  }
  setTextColor() {} setFont() {} setFillColor() {} setDrawColor() {} setLineWidth() {} line() {} addPage() {} save() {}
  setFontSize(s) { this.size = s; }
  // about half an em a character
  getTextWidth(t) { return String(t).length * this.size * 0.5 * MM_PER_PT; }
  splitTextToSize(t, w) {
    const out = [];
    let cur = '';
    String(t).split(' ').forEach((word) => {
      const next = cur ? cur + ' ' + word : word;
      if (this.getTextWidth(next) <= w) { cur = next; return; }
      if (cur) out.push(cur);
      cur = word;
      while (this.getTextWidth(cur) > w && cur.length > 1) {
        let n = cur.length;
        while (n > 1 && this.getTextWidth(cur.slice(0, n)) > w) n--;
        out.push(cur.slice(0, n));
        cur = cur.slice(n);
      }
    });
    out.push(cur);
    return out;
  }
  text(t, x, y) {
    const arr = Array.isArray(t) ? t : [t];
    const lh = this.size * 1.15 * MM_PER_PT;
    arr.forEach((s, k) => this.lines.push({ s: String(s), x, y: y + k * lh, size: this.size }));
  }
  rect(x, y, w, h, style) { this.rects.push({ x, y, w, h, style }); }
}

let saved;
beforeEach(() => { saved = window.jspdf; window.jspdf = { jsPDF: FakePdf }; });
afterEach(() => { window.jspdf = saved; });

const labelY = (pdf, label) => pdf.lines.find((l) => l.s === label + ':').y;
/** The lines drawn right of a label (the value column of its row), top to bottom. */
const valueLines = (pdf, label) => {
  const lab = pdf.lines.find((l) => l.s === label + ':');
  const startX = lab.x + 38;
  const i = pdf.lines.findIndex((l) => l.x === startX && l.y === lab.y);
  const out = [pdf.lines[i]];
  for (let k = i + 1; k < pdf.lines.length && pdf.lines[k].x === startX && pdf.lines[k].y > out[out.length - 1].y; k++) out.push(pdf.lines[k]);
  return out;
};
const headerBar = (pdf) => pdf.rects.find((r) => r.h === 7.5 && r.style === 'F');

const CUSTOMER = 'AMAZON SELLER SERVICES PRIVATE LIMITED';
const JOB = 'GSFQM-1110804311-Poly Bag 1500 gms (MAP)-Bag Dimensions-250 x 350mm with self-adhesive sealing-with branding artwork';
const slip77 = (over = {}) => ({
  slipNo: 'ISS/2026/77', so: '26/656', department: 'Printing', spec: 'A1319', customer: CUSTOMER, jobName: JOB,
  issuedAt: '2026-09-30T12:48:00Z', issuedBy: 'stores', totalQty: 194.92,
  lines: [{ lineNo: 'ISS/2026/77.0', internalCode: 'BLMU-592', itemCode: 'BLM306', itemName: '700 MM', widthMm: 700, location: 'AG', qty: 194.92, uom: 'Kg' }],
  ...over,
});

describe('the issue slip — the client\'s ISS/2026/77', () => {
  it('prints the line number on ONE line', () => {
    const pdf = buildIssueSlipPdf(slip77());
    expect(pdf.lines.some((l) => l.s === 'ISS/2026/77.0')).toBe(true);
    expect(pdf.lines.some((l) => l.s === 'ISS/2026/77.')).toBe(false);
    // the sticker and the item code are identifiers too
    expect(pdf.lines.some((l) => l.s === 'BLMU-592')).toBe(true);
    expect(pdf.lines.some((l) => l.s === 'BLM306')).toBe(true);
  });

  it('gives the customer and the job name rows of their own, one under the other', () => {
    const pdf = buildIssueSlipPdf(slip77());
    const cust = valueLines(pdf, 'Customer');
    expect(cust.map((l) => l.s).join(' ')).toBe(CUSTOMER);
    expect(labelY(pdf, 'Job name')).toBeGreaterThanOrEqual(cust[cust.length - 1].y + 3.5);
    // full width: label at the left margin, nothing printed beside them
    expect(pdf.lines.find((l) => l.s === 'Customer:').x).toBe(12);
    expect(pdf.lines.find((l) => l.s === 'Job name:').x).toBe(12);
    expect(pdf.lines.filter((l) => l.y === labelY(pdf, 'Job name')).map((l) => l.s)).toEqual(['Job name:', valueLines(pdf, 'Job name')[0].s]);
  });

  it('prints every word of the job name, all of it above the table header', () => {
    const pdf = buildIssueSlipPdf(slip77());
    const job = valueLines(pdf, 'Job name');
    const text = job.map((l) => l.s).join(' ');
    JOB.split(' ').forEach((w) => expect(text).toContain(w));
    const last = job[job.length - 1].y;
    expect(headerBar(pdf).y).toBeGreaterThan(last + 3);
    // and the note row after it does not land on it either
    expect(labelY(pdf, 'Note')).toBeGreaterThanOrEqual(last + 3.5);
    expect(headerBar(pdf).y).toBeGreaterThan(labelY(pdf, 'Note') + 3);
  });

  it('pushes the rows down for a customer long enough to wrap', () => {
    const longCustomer = (CUSTOMER + ' ').repeat(4).trim();
    const pdf = buildIssueSlipPdf(slip77({ customer: longCustomer }));
    const cust = valueLines(pdf, 'Customer');
    expect(cust.length).toBeGreaterThan(1);
    expect(labelY(pdf, 'Job name')).toBeGreaterThanOrEqual(cust[cust.length - 1].y + 3.5);
    expect(cust.map((l) => l.s).join(' ')).toBe(longCustomer);
  });

  it('keeps a sticker too long for its column on one line, drawn smaller', () => {
    const code = 'BLMU-1234567890-XYZW';
    const pdf = buildIssueSlipPdf(slip77({ lines: [{ ...slip77().lines[0], internalCode: code }] }));
    const cell = pdf.lines.find((l) => l.s === code);
    expect(cell).toBeTruthy();
    expect(cell.size).toBeLessThan(8.5);
    expect(cell.size).toBeGreaterThanOrEqual(6);
    // the next cell is back at the table's size
    expect(pdf.lines.find((l) => l.s === 'BLM306').size).toBe(8.5);
  });

  it('keeps the short facts in two columns', () => {
    const pdf = buildIssueSlipPdf(slip77());
    const at = (label) => pdf.lines.find((l) => l.s === label + ':');
    expect(at('Slip No.').x).toBe(12);
    expect(at('Rolls / units issued').x).toBe(12 + 93);
    expect(at('Rolls / units issued').y).toBe(at('Slip No.').y);
    expect(at('Sale order').y - at('Slip No.').y).toBeCloseTo(5, 5);
  });
});

describe('the return slip', () => {
  const ret = {
    kind: 'RETURN', returnNo: 'RET/2026/77.0/1', so: '26/656', department: 'Printing', spec: 'A1319', customer: CUSTOMER,
    returnedAt: '2026-09-30T13:00:00Z', returnedBy: 'stores',
    issue: { lineNo: 'ISS/2026/77.0', slipNo: 'ISS/2026/77', internalCode: 'BLMU-592', widthMm: 700, qtyIssued: 194.92, uom: 'Kg', ts: '2026-09-30T12:48:00Z' },
    lines: [{ returnNo: 'RET/2026/77.0/1', internalCode: 'BLMU-601', itemCode: 'BLM306', itemName: '700 MM', widthMm: 700, location: 'AG', qty: 41.4, uom: 'Kg' }],
  };

  it('prints the return number on one line', () => {
    const pdf = buildReturnSlipPdf(ret);
    expect(pdf.lines.some((l) => l.s === 'RET/2026/77.0/1')).toBe(true);
    expect(pdf.lines.some((l) => /^RET\/2026\/77\.0\/?$/.test(l.s))).toBe(false);
  });

  it('gives Issued, Customer and Note rows that never overlap, above the table', () => {
    const pdf = buildReturnSlipPdf({ ...ret, customer: (CUSTOMER + ' ').repeat(4).trim(), note: 'Came back damp from the printing deck; dry before re-issue.' });
    const issued = valueLines(pdf, 'Issued');
    expect(labelY(pdf, 'Customer')).toBeGreaterThanOrEqual(issued[issued.length - 1].y + 3.5);
    const cust = valueLines(pdf, 'Customer');
    expect(cust.length).toBeGreaterThan(1);
    expect(labelY(pdf, 'Note')).toBeGreaterThanOrEqual(cust[cust.length - 1].y + 3.5);
    const note = valueLines(pdf, 'Note');
    expect(headerBar(pdf).y).toBeGreaterThan(note[note.length - 1].y + 3);
  });
});

describe('buildTablePdf — the shared header block', () => {
  const pdfOf = (meta) => buildTablePdf({ title: 'T', meta, columns: [{ label: 'A' }], rows: [['x']] });

  it('lays plain pairs out as before: two columns at a 5 mm pitch', () => {
    const pdf = pdfOf([['A', '1'], ['B', '2'], ['C', '3'], ['D', '4']]);
    const at = (label) => pdf.lines.find((l) => l.s === label + ':');
    expect(at('A').x).toBe(12);
    expect(at('C').x).toBe(12 + 93);
    expect(at('C').y).toBe(at('A').y);
    expect(at('B').y - at('A').y).toBeCloseTo(5, 5);
    // the table follows straight after the block: 4 + 2 rows + 2 + 2
    expect(headerBar(pdf).y - at('A').y).toBeCloseTo(5 + 2 + 2 + 5, 5);
  });

  it('moves the next row down by the lines a wrapped value took', () => {
    const long = 'word '.repeat(40).trim();
    const pdf = pdfOf([['A', long], ['B', '2'], ['C', '3'], ['D', '4']]);
    const a = valueLines(pdf, 'A');
    expect(a.length).toBeGreaterThan(2);
    expect(labelY(pdf, 'B')).toBeGreaterThanOrEqual(a[a.length - 1].y + 3.5);
    // the right-hand column of that row stays beside it
    expect(labelY(pdf, 'C')).toBe(labelY(pdf, 'A'));
    expect(headerBar(pdf).y).toBeGreaterThan(labelY(pdf, 'B') + 3);
  });
});
