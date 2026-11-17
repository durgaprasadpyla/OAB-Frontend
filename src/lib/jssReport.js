// 17.11: "I wanted the same kind of details that are there in the CSA report to be
// present in the JSS report also, but the details in the JSS have not changed."
//
// The CSA history has a View that opens a full CSA Report — structure, measurements,
// the Specifications sheet, QC remarks and the plant's comments. A JSS had only a
// 12-column list row: everything QC entered on the Specifications sheet was saved
// with the spec but shown nowhere. These rows are the JSS's report, read off the
// saved spec, in the CSA report's order; the screen and the JSS Excel both use them.

import { layersOfSpec, filledLayers } from './jssSpec.js';
import { specSummaryRows } from '../components/SpecSheet.jsx';

const s = (v) => (v == null ? '' : String(v).trim());
const mm = (v) => (s(v) && Number(v) !== 0 ? `${s(v)} mm` : '');
const LAYER_LABELS = ['Primary', 'Secondary', 'Third'];

/** The CSA report a spec was made from, if one is known: by report id, else by its sales SKU. */
export function csaOfSpec(sales, spec) {
  const reports = (sales && Array.isArray(sales.qc_reports)) ? sales.qc_reports : [];
  if (!spec) return null;
  if (s(spec.fromCsa)) {
    const byId = reports.find((r) => r && String(r.id) === String(spec.fromCsa));
    if (byId) return byId;
  }
  if (s(spec.fromSku)) {
    const bySku = reports.filter((r) => r && String(r.sku_id || '') === String(spec.fromSku));
    if (bySku.length) return bySku[bySku.length - 1];
  }
  return null;
}

/** The spec's own fields as [label, value] rows — blanks left out. */
export function jssHeaderRows(spec) {
  const j = spec || {};
  const rows = [];
  const add = (k, v) => { if (s(v) && s(v) !== '0' && s(v) !== '0 mm') rows.push([k, s(v)]); };
  add('Job Type', j.jobType);
  filledLayers(layersOfSpec(j)).forEach((l, i) => {
    add(`${LAYER_LABELS[i] || `Layer ${i + 1}`} Substrate`,
      [s(l.material), s(l.specialty), s(l.microns) ? `${s(l.microns)} mic` : ''].filter(Boolean).join(' · '));
  });
  add('MIC', j.mic); add('GSM', j.gsm);
  add('Film Width', mm(j.filmWidth)); add('Ups', j.ups);
  add('Width', mm(j.width)); add('Height', mm(j.height)); add('Gusset', mm(j.gusset));
  add('Pouch Weight', Number(j.pouchWeight) > 0 ? `${Number(j.pouchWeight).toFixed(2)} g` : '');
  add('Qty per Bag', j.qtyPerBag);
  add('Dispatch Form', j.dispatchForm);
  return rows;
}

/**
 * Everything the JSS report shows: { header, specs, qcRemarks, plantComments, csa }.
 * QC remarks / plant comments are the spec's own, else the CSA report's it came from.
 */
export function jssReport({ sales, spec, machines = [] }) {
  const j = spec || {};
  const csa = csaOfSpec(sales, j);
  const layers = layersOfSpec(j);
  return {
    header: jssHeaderRows(j),
    specs: specSummaryRows({ sales, layers, sheet: j.specSheet, dispatchForm: j.dispatchForm, machines }),
    qcRemarks: s(j.qcRemarks) || s(csa && csa.remarks),
    plantComments: s(j.plantComments) || s(csa && csa.plant_comments),
    csa,
  };
}

/** One text cell for the JSS Excel: the specifications as "label: value; …". */
export function jssSpecText(report) {
  return (report.specs || []).map(([k, v]) => `${k}: ${v}`).join('; ');
}
