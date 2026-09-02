// Department-wise BOM download for a sale order — Excel and PDF.
//
// The shop floor does not issue material as one flat list: Printing draws its
// own films and inks, Lamination its adhesives, Slitting its cores. So a sale
// order's requirement is printed department by department, each with its own
// subtotal, and the quantities are SCALED TO THAT ORDER — not the recipe's base:
//
//     required = (SO balance / BOM base qty) x qty per base
//
// Both formats carry the same numbers and the same section order, so the Excel a
// planner works in and the PDF the floor is handed cannot disagree.

import { exportAOA } from './xlsx.js';
import { elementToPDF } from './pdf.js';
import { bomMaterialForSOByDept } from './bom.js';
import { today } from './format.js';

const safeName = (s) => String(s == null ? '' : s).replace(/[\/:*?"<>|]+/g, '-');
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

const COLS = ['Item Code', 'Description', 'Material Type', 'Sub-Group', 'Microns', 'UOM', 'Qty per Base', 'Required'];

/** Filename stem shared by both formats, e.g. BOM_SO1234_A1337_2026-09-02. */
export function soBomFileName(row) {
  return ['BOM', safeName(row.so || 'SO'), safeName(row.spec || ''), today()].filter(Boolean).join('_');
}

function subtotalLine(totals) {
  const parts = Object.entries(totals).map(([uom, q]) => `${r2(q)}${uom ? ' ' + uom : ''}`);
  return parts.length ? parts.join(' + ') : '';
}

/**
 * The whole document as rows, so Excel and PDF are built from ONE description of
 * the content. `groups` is what bomMaterialForSOByDept returned.
 */
export function soBomSheet(bom, row) {
  const rec = (bom && bom[row.spec]) || {};
  const groups = bomMaterialForSOByDept(bom, row.spec, row.bal);
  const meta = [
    ['Sale Order', row.so || ''],
    ['Customer', row.customer || ''],
    ['Group', row.group || ''],
    ['Job Name', row.jobName || ''],
    ['Spec', row.spec || ''],
    ['Order Balance', `${r2(row.bal)} ${rec.baseUOM || ''}`.trim()],
    ['BOM Base Qty', `${rec.baseQty ?? ''} ${rec.baseUOM || ''}`.trim()],
    ['Printed', today()],
  ];
  return { groups, meta, rec };
}

/** Department-wise requirement for one sale order as an .xlsx sheet. */
export function exportSoBomExcel(bom, row) {
  const { groups, meta } = soBomSheet(bom, row);
  if (!groups.length) return false;
  const aoa = [['Department-wise Bill of Materials'], [], ...meta, []];
  groups.forEach((g) => {
    aoa.push([g.department]);
    aoa.push(COLS);
    g.items.forEach((m) => aoa.push([
      m.itemCode, m.itemDescription || '', m.materialType || '', m.subGroup || '',
      m.microns || '', m.uom || '', r2(m.qtyPerBase), r2(m.required),
    ]));
    aoa.push(['', '', '', '', '', '', 'Total', subtotalLine(g.totals)]);
    aoa.push([]);
  });
  exportAOA(aoa, soBomFileName(row), 'BOM by Department');
  return true;
}

/**
 * The same document as a PDF, rasterised from an off-screen node through the
 * shared pipeline. Each department is its own block with a heading and subtotal,
 * kept together on a page where it fits.
 */
export async function exportSoBomPDF(bom, row) {
  const { groups, meta } = soBomSheet(bom, row);
  if (!groups.length) return false;

  const metaHtml = meta.map(([k, v]) =>
    `<span style="display:inline-block;margin-right:18px"><span style="color:#666">${esc(k)}:</span> <b>${esc(v) || '-'}</b></span>`).join('');
  const blocks = groups.map((g) => {
    const body = g.items.map((m) => '<tr style="border-bottom:1px solid #eee">'
      + [m.itemCode, m.itemDescription, m.materialType, m.subGroup, m.microns, m.uom, r2(m.qtyPerBase), r2(m.required)]
        .map((c, k) => `<td style="padding:4px 6px;text-align:${k >= 6 ? 'right' : 'left'}">${esc(c)}</td>`).join('')
      + '</tr>').join('');
    return '<div style="margin-bottom:14px;page-break-inside:avoid">'
      + `<div style="font-size:12px;font-weight:700;color:#0e6fb8;margin-bottom:4px">${esc(g.department)}`
      + `<span style="font-weight:400;color:#666"> — ${g.items.length} item(s)</span></div>`
      + '<table style="width:100%;border-collapse:collapse;font-size:10.5px"><thead><tr style="background:#0e6fb8;color:#fff">'
      + COLS.map((h, k) => `<th style="padding:5px 6px;text-align:${k >= 6 ? 'right' : 'left'}">${esc(h)}</th>`).join('')
      + `</tr></thead><tbody>${body}</tbody><tfoot><tr>`
      + `<td colspan="7" style="padding:4px 6px;text-align:right;font-weight:700">Total</td>`
      + `<td style="padding:4px 6px;text-align:right;font-weight:700">${esc(subtotalLine(g.totals))}</td>`
      + '</tr></tfoot></table></div>';
  }).join('');

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;padding:16px;font-family:Arial,sans-serif;width:900px;color:#111';
  wrap.innerHTML = `<div style="font-size:16px;font-weight:800;color:#0e6fb8;margin-bottom:6px">Bill of Materials by Department — ${esc(row.so)}</div>`
    + `<div style="font-size:11px;margin-bottom:12px;line-height:1.7">${metaHtml}</div>${blocks}`;
  document.body.appendChild(wrap);
  try { await elementToPDF(wrap, soBomFileName(row), { orientation: 'landscape' }); }
  finally { document.body.removeChild(wrap); }
  return true;
}
