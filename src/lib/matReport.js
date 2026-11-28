// Mat Report (A) — "material allocated to this job", one sale order, Excel and PDF.
//
// Requirement 2 (SO material check & allocate, Partial / Full) asks for two outputs:
// the order's status — Ready to Produce, Full or Partial — and a report of the
// material allocated to the job. The Department-wise BOM download only says what an
// order NEEDS; this one says what it HAS: per BOM line what is needed, allocated
// (held on a roll), issued net of returns and still open, and below that every roll
// that is held for or was issued to the order.
//
// It is built from the same /api/stores/so-material position the PLAN panel and the
// stores desk read, plus the order's readiness (the server's status when it sent one),
// so the report cannot disagree with the screen.

import { exportAOA } from './xlsx.js';
import { elementToPDF } from './pdf.js';
import { today } from './format.js';
import { isInk, netOut } from './soMaterial.js';
import { coverFromLines } from './bomApprovalApi.js';

const safeName = (s) => String(s == null ? '' : s).replace(/[\/:*?"<>|]+/g, '-');
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r3 = (v) => Math.round(num(v) * 1000) / 1000;
const day = (ts) => (ts ? String(ts).slice(0, 10) : '');

export const LINE_COLS = ['Item Code', 'Description', 'Material', 'Department', 'UOM', 'Needed', 'Allocated', 'Issued', 'Still open', 'Cover %', 'Line status'];
export const ROLL_COLS = ['Roll', 'Item Code', 'Description', 'How', 'Department', 'Qty', 'UOM', 'Location', 'By / slip', 'Date'];

const STATUS_TEXT = { READY: 'Ready to Produce — Full', PARTIAL: 'Ready to Produce — Partial', BLOCKED: 'Blocked — not ready', NO_BOM: 'No BOM', UNKNOWN: 'Cannot be measured' };

/** Filename stem, e.g. MatReport_26-904_A1339_2026-11-28. */
export function matReportFileName(so, spec) {
  return ['MatReport', safeName(so || 'SO'), safeName(spec || ''), today()].filter(Boolean).join('_');
}

/**
 * The whole report as data. `mat` is the /so-material response; `readiness` the
 * order's row from /api/planning/readiness (or /bom-approval) when there is one;
 * `freeOf(line)` the free stock of a line's item, so an ink the stores hold none of
 * reads "Mixed on the spot" exactly as the PLAN panel shows it.
 */
export function matReportData({ so, spec, customer, jobName, poQty, mat, readiness, freeOf }) {
  const all = (mat && Array.isArray(mat.lines)) ? mat.lines : [];
  const lines = all.map((l) => {
    const required = num(l.required);
    const covered = l.covered != null ? num(l.covered) : num(l.allocated) + num(l.netIssued);
    const onTheSpot = !!freeOf && isInk({ ...l, itemDescription: l.itemName }) && !(num(freeOf(l)) > 0) && covered <= 0;
    const pct = required > 0 ? Math.min(100, Math.floor((covered / required) * 1000) / 10) : null;
    let status;
    if (l.onBom === false) status = 'Not on the BOM';
    else if (l.uomMismatch) status = 'Unit differs — not measured';
    else if (onTheSpot) status = 'Mixed on the spot';
    else if (l.complete || (required > 0 && covered + 1e-9 >= required)) status = 'Complete';
    else if (covered > 0) status = 'Partial';
    else status = 'Open';
    return {
      itemCode: l.itemCode || '', itemName: l.itemName || '',
      material: [l.materialType, l.subGroup].filter(Boolean).join(' · '),
      department: (l.departments || []).join(', '), uom: l.uom || '',
      required: l.onBom === false ? null : r3(required), allocated: r3(l.allocated),
      issued: r3(l.netIssued != null ? l.netIssued : l.issued),
      open: l.onBom === false ? null : r3(Math.max(0, required - covered)),
      pct: onTheSpot || l.onBom === false ? null : pct, status,
    };
  });

  const rolls = [];
  ((mat && mat.allocations) || []).forEach((a) => rolls.push({
    roll: a.internalCode || '', itemCode: a.itemCode || '', itemName: a.itemName || '',
    how: 'Allocated (held)', department: a.department || '', qty: r3(a.qty), uom: a.uom || '',
    location: a.location || '', by: [a.source, a.actor].filter(Boolean).join(' · '), date: day(a.ts),
  }));
  ((mat && mat.issues) || []).forEach((l) => {
    const out = netOut(l);
    if (!(out > 0)) return;
    rolls.push({
      roll: l.internalCode || '', itemCode: l.itemCode || '', itemName: l.itemName || '',
      how: 'Issued', department: l.department || '', qty: r3(out), uom: l.uom || '',
      location: l.location || '', by: l.lineNo || l.slipNo || '', date: day(l.ts),
    });
  });

  // The server's figure when it sent one (the rule it enforces); otherwise the same
  // rule worked out here from the lines.
  let status = readiness && readiness.materialStatus;
  let pct = readiness && readiness.materialCoverPct;
  let eligible = readiness && readiness.eligibleQty;
  if (!status) {
    const c = coverFromLines(all, freeOf);
    status = c ? c.status : 'NO_BOM';
    pct = c ? c.pct : null;
    eligible = c && num(poQty) > 0 ? Math.floor(num(poQty) * c.pct / 100) : null;
  }
  const approved = readiness && readiness.bomApproved;
  const meta = [
    ['Sale Order', so || ''],
    ['Customer', customer || ''],
    ['Job', jobName || ''],
    ['Spec', spec || ''],
    ['Order Qty', poQty != null && poQty !== '' ? num(poQty).toLocaleString('en-IN') : ''],
    ['BOM', approved == null ? '' : approved
      ? `Approved${readiness.bomApprovedBy ? ' by ' + readiness.bomApprovedBy : ''}${readiness.bomApprovedAt ? ' on ' + day(readiness.bomApprovedAt) : ''}`
      : 'Approval pending'],
    ['Printed', today()],
  ];
  const summary = {
    status, statusText: STATUS_TEXT[status] || status || '',
    pct: pct == null ? null : num(pct),
    eligible: eligible == null ? null : num(eligible),
  };
  return { meta, summary, lines, rolls };
}

const lineRow = (l) => [l.itemCode, l.itemName, l.material, l.department, l.uom,
  l.required ?? '', l.allocated, l.issued, l.open ?? '', l.pct == null ? '' : l.pct, l.status];
const rollRow = (r) => [r.roll, r.itemCode, r.itemName, r.how, r.department, r.qty, r.uom, r.location, r.by, r.date];
const summaryRows = (s) => [
  ['Status', s.statusText],
  ['Material covered', s.pct == null ? '—' : `${s.pct}%`],
  ['Can be made now', s.eligible == null ? '—' : s.eligible.toLocaleString('en-IN')],
];

/** Mat Report (A) as an .xlsx sheet. False when the order has no BOM lines. */
export function exportMatReportExcel(input) {
  const d = matReportData(input);
  if (!d.lines.length) return false;
  const aoa = [['Mat Report (A) — Material allocated to this job'], [], ...d.meta, [], ...summaryRows(d.summary), [],
    ['Material by BOM line'], LINE_COLS, ...d.lines.map(lineRow), [],
    ['Rolls held for / issued to this order'], ROLL_COLS];
  if (d.rolls.length) d.rolls.forEach((r) => aoa.push(rollRow(r)));
  else aoa.push(['No roll is allocated to or issued for this order yet.']);
  exportAOA(aoa, matReportFileName(input.so, input.spec), 'Mat Report A');
  return true;
}

const TONE = { READY: '#1e7e34', PARTIAL: '#b7770d', BLOCKED: '#c0392b' };

function tableHtml(cols, rows, numericFrom, numericTo) {
  const isNum = (k) => k >= numericFrom && k <= numericTo;
  return '<table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-bottom:14px"><thead><tr style="background:#0e6fb8;color:#fff">'
    + cols.map((h, k) => `<th style="padding:5px 6px;text-align:${isNum(k) ? 'right' : 'left'}">${esc(h)}</th>`).join('')
    + '</tr></thead><tbody>'
    + rows.map((r) => '<tr style="border-bottom:1px solid #eee">'
      + r.map((c, k) => `<td style="padding:4px 6px;word-break:break-word;text-align:${isNum(k) ? 'right' : 'left'}">${esc(c)}</td>`).join('')
      + '</tr>').join('')
    + '</tbody></table>';
}

/** The same report as a landscape PDF. False when the order has no BOM lines. */
export async function exportMatReportPDF(input) {
  const d = matReportData(input);
  if (!d.lines.length) return false;
  const metaHtml = d.meta.map(([k, v]) =>
    `<span style="display:inline-block;margin-right:18px"><span style="color:#666">${esc(k)}:</span> <b>${esc(v) || '-'}</b></span>`).join('');
  const s = d.summary;
  const tone = TONE[s.status] || '#444';
  const summaryHtml = `<div style="display:flex;gap:28px;align-items:center;border:2px solid ${tone};border-radius:6px;padding:8px 12px;margin-bottom:14px;font-size:12px">`
    + `<div style="font-size:15px;font-weight:800;color:${tone}">${esc(s.statusText)}</div>`
    + `<div>Material covered: <b>${s.pct == null ? '—' : esc(s.pct + '%')}</b></div>`
    + `<div>Can be made now: <b>${s.eligible == null ? '—' : esc(s.eligible.toLocaleString('en-IN'))}</b></div></div>`;
  const rollsHtml = d.rolls.length
    ? tableHtml(ROLL_COLS, d.rolls.map(rollRow), 5, 5)
    : '<div style="font-size:11px;color:#666">No roll is allocated to or issued for this order yet.</div>';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;padding:16px;font-family:Arial,sans-serif;width:1000px;color:#111';
  wrap.innerHTML = `<div style="font-size:16px;font-weight:800;color:#0e6fb8;margin-bottom:6px">Mat Report (A) — Material allocated to ${esc(input.so)}</div>`
    + `<div style="font-size:11px;margin-bottom:10px;line-height:1.7">${metaHtml}</div>${summaryHtml}`
    + '<div style="font-size:12px;font-weight:700;color:#0e6fb8;margin-bottom:4px">Material by BOM line</div>'
    + tableHtml(LINE_COLS, d.lines.map(lineRow), 5, 9)
    + '<div style="font-size:12px;font-weight:700;color:#0e6fb8;margin-bottom:4px">Rolls held for / issued to this order</div>'
    + rollsHtml;
  document.body.appendChild(wrap);
  try { await elementToPDF(wrap, matReportFileName(input.so, input.spec), { orientation: 'landscape' }); }
  finally { document.body.removeChild(wrap); }
  return true;
}
