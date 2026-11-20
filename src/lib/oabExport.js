// Issues 11.11 — the extra columns of the Stay Fresh / Others OAB Excel export:
//
//   "Primary / Second / Third Substrate for balance quantity, Plant comments that will be
//    given by the PM login, Pouch open width — if applicable (if dispatch form is pouch)"
//
// Everything is read off the SO's JSS: its layers, its Specifications sheet (film width
// per substrate, GSM per substrate, the pouch's open width) and the metres the balance
// still runs to.

import { gsmBreakdown, layerFilmWidths, pouchFigures, sheetKind, sheetOf } from './specSheet.js';
import { layersOfSpec } from './jssSpec.js';
import { balance, calcMetres, kgFromMetres, num } from './calc.js';
import { getUOM } from './pricing.js';

const s = (v) => String(v == null ? '' : v).trim();
const kgText = (v) => Math.round(v).toLocaleString('en-IN');

/**
 * What each substrate of the job weighs for `metres` of it, as three cells: the
 * substrate's name, micron and the kilograms — or just the name when its GSM or film
 * width is not on the spec.
 *   kg = metres × film width (m) × GSM ÷ 1000, the film width growing 10 mm a lamination.
 */
export function substratesForBalance(jss, sales, metres) {
  const j = jss || {};
  const layers = layersOfSpec(j);
  const sheet = sheetOf(j.specSheet);
  const gsm = gsmBreakdown(sales, layers, sheet);
  const fromSheet = layerFilmWidths(sales, sheet);
  const fw = num(j.filmWidth);
  return [0, 1, 2].map((i) => {
    const l = layers[i] || {};
    if (!s(l.material)) return '';
    const name = [s(l.material), s(l.specialty), s(l.microns) ? `${s(l.microns)} mic` : ''].filter(Boolean).join(' ');
    const width = fromSheet[i] > 0 ? fromSheet[i] : (fw > 0 ? fw + 10 * i : 0);
    const g = num(gsm.rows[i] && gsm.rows[i].gsm);
    if (!(num(metres) > 0) || !(width > 0) || !(g > 0)) return name;
    return `${name} — ${kgText(num(metres) * (width / 1000) * (g / 1000))} kg`;
  });
}

/** The open width of a pouch, off its Specifications sheet; '' for any other dispatch form. */
export function pouchOpenWidth(jss, sales) {
  const j = jss || {};
  if (sheetKind(j.dispatchForm) !== 'pouch' || !j.specSheet) return '';
  const sheet = sheetOf(j.specSheet);
  const w = pouchFigures(sheet, gsmBreakdown(sales, layersOfSpec(j), sheet).total).width;
  return w > 0 ? w : '';
}

/**
 * The plant's comments on an SO: what the PM wrote against it on the Production Tracker,
 * else what the plant said on the CSA report the spec was made from.
 */
export function plantComments(so, spec, pmData, sales) {
  const own = s(((pmData || {})[so] || {}).comment);
  if (own) return own;
  const sp = s(spec);
  if (!sp) return '';
  const skuIds = new Set(((sales && sales.skus) || []).filter((k) => s(k.jss_spec) === sp).map((k) => k.id));
  const reports = ((sales && sales.qc_reports) || []).filter((r) => skuIds.has(r.sku_id) && s(r.plant_comments));
  const last = reports.sort((a, b) => s(b.plant_answered_at || b.created_at).localeCompare(s(a.plant_answered_at || a.created_at)))[0];
  return last ? `CSA: ${s(last.plant_comments)}` : '';
}

// ── 19.11: the sale-order columns every OAB download carries ─────────────────
//
// "Unit of measurement should be a mandatory field in the downloaded Excel … we would
//  need the individual item weight … include balance metres and balance kilograms …
//  there is no FG allocated in the list … also include the route for that particular
//  JSS." One builder, so the OAB board, Plant and PM downloads say the same thing.

/** The columns, in order. */
export const SO_EXPORT_COLUMNS = ['UOM', 'Unit Weight (g)', 'FG Allocated', 'Balance Qty',
  'Total Metres (+5%)', 'Total Kgs', 'Balance Metres (+5%)', 'Balance Kgs', 'Route'];

const isRoll = (df) => /^rolls?$/i.test(s(df));

/** `{spec: "Printing → Lamination → Pouching"}` off GET /api/jss/routes. */
export function routeIndex(list) {
  const out = {};
  (Array.isArray(list) ? list : []).forEach((r) => {
    if (!r || !s(r.spec)) return;
    const stages = Array.isArray(r.stages) ? r.stages.map(s).filter(Boolean) : [];
    out[s(r.spec)] = stages.length ? stages.join(' → ') : s(r.routeName);
  });
  return out;
}

/**
 * The cells for one sale order, matching SO_EXPORT_COLUMNS. `dispatchForm` is the
 * row's effective form (the JSS's first); `routes` from routeIndex. The FG allocated
 * to the SO is already off its balance (balance = PO − invoiced − manual − FG).
 */
export function soExportCells(r, j, { dispatchForm = '', routes = {} } = {}) {
  const df = s(dispatchForm || (j && j.dispatchForm) || r.dispatchForm);
  const po = num(r.poQty);
  const bal = balance(r);
  const totalM = calcMetres(r, po, j).withWastage;
  const totalK = po > 0 ? kgFromMetres(r, totalM, j, po) : null;
  const balM = calcMetres(r, bal, j).withWastage;
  const balK = bal > 0 ? kgFromMetres(r, balM, j, bal) : null;
  const pw = j ? num(j.pouchWeight) : 0;
  return [
    getUOM(df),
    isRoll(df) ? '' : (pw > 0 ? Math.round(pw * 100) / 100 : ''),
    num(r.fg),
    bal,
    Math.round(totalM),
    totalK ? Math.round(totalK.kg) : '',
    Math.round(balM),
    balK ? Math.round(balK.kg) : (bal > 0 ? '' : 0),
    routes[s(r.spec)] || '',
  ];
}
