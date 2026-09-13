// The material issue slip (Issues 6 §13): "when material is issued to a department
// and the user clicks the Issue button: automatically generate / download a PDF …
// suitable for printing and handing over to the department", saying that these
// rolls have been issued to that department for that sale order.
//
// Built from the slip the server returns (POST /api/stores/issues/batch) — the
// same lines it booked, with the numbers it fixed — so the paper and the ledger
// can never disagree.
import { buildTablePdf, safeName } from './tablePdf.js';

const nf = (v) => ((v === '' || v == null) ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

/** The jsPDF document for a slip (exported so tests can inspect it without saving). */
export function buildIssueSlipPdf(slip) {
  const lines = Array.isArray(slip && slip.lines) ? slip.lines : [];
  const uoms = [...new Set(lines.map((l) => String(l.uom || '').trim()).filter(Boolean))];
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const rows = lines.map((l, i) => [
    i + 1,
    l.internalCode || '',
    l.itemCode || '',
    l.itemName || '',
    l.widthMm ? nf(l.widthMm) : '',
    l.location || '',
    Number(l.qty) || 0,
    l.uom || '',
  ]);
  const so = slip.so || '';
  const dept = slip.department || '';
  return buildTablePdf({
    title: 'Bloomflex — Material Issue Slip ' + (slip.slipNo || ''),
    // Helvetica's WinAnsi has no arrow — say it in words
    subtitle: 'Stores to ' + (dept || 'the shop floor') + (so ? ' · Sale order ' + so : '') + ' · issued ' + when(slip.issuedAt),
    meta: [
      ['Slip No.', slip.slipNo || ''],
      ['Sale order', so || '—'],
      ['JSS / Spec', slip.spec || '—'],
      ['Customer', slip.customer || '—'],
      ['Job name', slip.jobName || '—'],
      ['Department', dept || '—'],
      ['Rolls / units issued', String(lines.length)],
      ['Total quantity', nf(total) + (uoms.length === 1 ? ' ' + uoms[0] : '')],
      ['Issued by', slip.issuedBy || ''],
      ['Note', slip.note || '—'],
    ],
    columns: [
      { label: '#', width: 0.5, align: 'right' },
      { label: 'Roll / Sticker', width: 1.5 },
      { label: 'Item code', width: 1.2 },
      { label: 'Description', width: 3.2 },
      { label: 'Width (mm)', width: 1.1, align: 'right' },
      { label: 'From rack', width: 1.1 },
      { label: 'Quantity', width: 1.2, align: 'right' },
      { label: 'UOM', width: 0.7 },
    ],
    rows,
    totals: ['', '', '', 'Total issued', '', '', total, uoms.length === 1 ? uoms[0] : ''],
    footer: [
      'The material / rolls listed above have been issued from Stores to the ' + (dept || 'department') + ' department'
        + (so ? ' for sale order ' + so : '') + '. Please check the sticker numbers against the rolls on receipt.',
      ['Issued by (Stores)', 'Received by (' + (dept || 'Department') + ')', 'Date / time'],
    ],
    note: 'Bloomflex OAB · Stores · ' + (slip.slipNo || '') + ' · generated ' + new Date().toLocaleString('en-IN'),
  });
}

/** Download the slip as `Issue_Slip_<no>_<department>.pdf`. */
export function saveIssueSlipPdf(slip) {
  const pdf = buildIssueSlipPdf(slip);
  const name = 'Issue_Slip_' + safeName(slip.slipNo || 'slip') + (slip.department ? '_' + safeName(slip.department) : '') + '.pdf';
  pdf.save(name);
  return name;
}
