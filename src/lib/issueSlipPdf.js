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
  // Issues 7: the roll-wise number (ISS/2026/3.1) goes on the paper — it is what a
  // return is booked against, so the department writes it on the roll that comes back.
  const rows = lines.map((l, i) => [
    l.lineNo || String(i + 1),
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
      { label: 'Line no.', width: 1.3 },
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
        + (so ? ' for sale order ' + so : '') + '. Please check the sticker numbers against the rolls on receipt. '
        + 'Quote the line number (e.g. ' + ((lines[0] && lines[0].lineNo) || slip.slipNo || 'ISS/…') + ') when the roll comes back.',
      ['Issued by (Stores)', 'Received by (' + (dept || 'Department') + ')', 'Date / time'],
    ],
    note: 'Bloomflex OAB · Stores · ' + (slip.slipNo || '') + ' · generated ' + new Date().toLocaleString('en-IN'),
  });
}

/**
 * Issues 7 §12: "Even for returns let us have a return slip so that the issue on
 * return slips can be attached later." One slip per returned roll (RET/2026/3.1/1),
 * naming the issue line it came back against and the roll it was cut from.
 */
export function buildReturnSlipPdf(slip) {
  const lines = Array.isArray(slip && slip.lines) ? slip.lines : [];
  const issue = (slip && slip.issue) || {};
  const uoms = [...new Set(lines.map((l) => String(l.uom || '').trim()).filter(Boolean))];
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const rows = lines.map((l) => [
    l.returnNo || slip.returnNo || '',
    l.internalCode || '',
    l.itemCode || '',
    l.itemName || '',
    l.widthMm ? nf(l.widthMm) : '',
    l.location || '',
    Number(l.qty) || 0,
    l.uom || '',
  ]);
  const so = slip.so || issue.so || '';
  const dept = slip.department || issue.department || '';
  return buildTablePdf({
    title: 'Bloomflex — Material Return Slip ' + (slip.returnNo || slip.slipNo || ''),
    subtitle: (dept || 'The shop floor') + ' to Stores' + (so ? ' · Sale order ' + so : '') + ' · returned ' + when(slip.returnedAt),
    meta: [
      ['Return slip No.', slip.returnNo || slip.slipNo || ''],
      ['Against issue line', issue.lineNo || '—'],
      ['Issue slip', issue.slipNo || '—'],
      ['Parent roll', issue.internalCode ? issue.internalCode + (issue.widthMm ? ' · ' + nf(issue.widthMm) + ' mm' : '') : '—'],
      ['Issued', issue.qtyIssued != null ? nf(issue.qtyIssued) + ' ' + (issue.uom || '') + (issue.ts ? ' on ' + when(issue.ts) : '') : '—'],
      ['Sale order', so || '—'],
      ['JSS / Spec', slip.spec || '—'],
      ['Customer', slip.customer || '—'],
      ['Department', dept || '—'],
      ['Returned by', slip.returnedBy || ''],
      ['Total returned', nf(total) + (uoms.length === 1 ? ' ' + uoms[0] : '')],
      ['Note', slip.note || '—'],
    ],
    columns: [
      { label: 'Return no.', width: 1.5 },
      { label: 'Roll / Sticker', width: 1.5 },
      { label: 'Item code', width: 1.2 },
      { label: 'Description', width: 3 },
      { label: 'Width (mm)', width: 1.1, align: 'right' },
      { label: 'To rack', width: 1 },
      { label: 'Quantity', width: 1.2, align: 'right' },
      { label: 'UOM', width: 0.7 },
    ],
    rows,
    totals: ['', '', '', 'Total returned', '', '', total, uoms.length === 1 ? uoms[0] : ''],
    footer: [
      'The roll(s) listed above have come back to Stores from the ' + (dept || 'department') + ' department'
        + (issue.lineNo ? ' against issue line ' + issue.lineNo : '') + (issue.internalCode ? ' (cut from ' + issue.internalCode + ')' : '')
        + '. Attach this slip to the issue slip.',
      ['Returned by (' + (dept || 'Department') + ')', 'Received by (Stores)', 'Date / time'],
    ],
    note: 'Bloomflex OAB · Stores · ' + (slip.returnNo || slip.slipNo || '') + ' · generated ' + new Date().toLocaleString('en-IN'),
  });
}

/** Download the slip as `Issue_Slip_<no>_<department>.pdf` (or `Return_Slip_…` for a return). */
export function saveIssueSlipPdf(slip) {
  const isReturn = slip && (slip.kind === 'RETURN' || String(slip.returnNo || slip.slipNo || '').toUpperCase().startsWith('RET/'));
  const pdf = isReturn ? buildReturnSlipPdf(slip) : buildIssueSlipPdf(slip);
  const name = (isReturn ? 'Return_Slip_' : 'Issue_Slip_') + safeName(slip.returnNo || slip.slipNo || 'slip')
    + (slip.department ? '_' + safeName(slip.department) : '') + '.pdf';
  pdf.save(name);
  return name;
}
