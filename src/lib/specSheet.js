// Issues 26.10 — the SPECIFICATIONS sheet shared by the QC's CSA report and the JSS
// spec entry ("The CSA report format and the JSS spec sheet format should be similar
// because almost all the things are similar on both of these pages").
//
// Everything here is pure arithmetic over what the QC picked, so the CSA form, the JSS
// form, the report view and the CSA → JSS conversion all read one set of rules:
//
//   GSM          density × micron per substrate (densities from the Super Admin),
//                + ink GSM on the primary, + adhesive GSM on the secondary / third
//   printing     print repeat = ups × single print repeat; film width = tracks ×
//                single print width + tracker line, capped at the machine's max width
//   lamination   film width + 10 mm per lamination; the roller has to be more than
//                5 mm wider than the print (single width × tracks, no tracker line)
//                and narrower than the stage-1 film width
//   pouch        height = pouch height + bottom seal × 2 + bottom gusset + flap,
//                width  = pouch width + side seal + side gusset,
//                weight = height × width × GSM × 1.02 / 1,000,000 g
//   sleeve       height × open width × GSM × 1.02 / 1,000,000 g
//   label        (height + bleed) × (width + bleed) × GSM × 1.02 / 1,000,000 g
import { despatchKind } from './repFlow.js';

const s = (v) => String(v == null ? '' : v).trim();
const arr = (v) => (Array.isArray(v) ? v : []);
/** A typed number, or 0 for blank / junk. */
export const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const nk = (v) => s(v).toLowerCase().replace(/\s+/g, ' ');

/* ── densities ────────────────────────────────────────────────────────── */

/**
 * "For now I would like you to key in the densities of the material": LDPE natural
 * 0.92, LDPE white or opaque 0.935, all kinds of PET 1.4, all kinds of BOPP 0.91.
 * Used until the Super Admin saves a density against a material.
 */
export const DENSITY_DEFAULTS = [
  { material: 'LDPE - NATURAL', density: 0.92 },
  { material: 'LDPE - WHITE / OPAQUE', density: 0.935 },
  { material: 'PET (all kinds)', density: 1.4 },
  { material: 'BOPP (all kinds)', density: 0.91 },
];

/** The density rule a material name falls under when the Super Admin has not given one. */
export function defaultDensity(material, specialty = '') {
  const m = nk(material);
  const both = m + ' ' + nk(specialty);
  if (!m) return null;
  if (/bopp/.test(m)) return 0.91;
  if (/pet\b|polyester/.test(m)) return 1.4;
  if (/ldpe|lldpe|\bpe\b|poly/.test(m)) return /white|opaque|milk/.test(both) ? 0.935 : 0.92;
  return null;
}

/** The Super Admin's density list (sales.material_densities), as { material, density } rows. */
export function densityList(sales) {
  return arr(sales && sales.material_densities)
    .filter((d) => d && s(d.material) && n(d.density) > 0)
    .map((d) => ({ material: s(d.material), density: n(d.density) }));
}

/**
 * The density of one substrate: the Super Admin's row for that material (a row naming
 * "material · speciality" wins over the bare material), else the built-in rule, else null.
 */
export function densityFor(sales, material, specialty = '') {
  const list = densityList(sales);
  const withSpec = nk(material) + ' · ' + nk(specialty);
  const hit = (specialty && list.find((d) => nk(d.material) === withSpec)) || list.find((d) => nk(d.material) === nk(material));
  if (hit) return hit.density;
  return defaultDensity(material, specialty);
}

/* ── GSM ──────────────────────────────────────────────────────────────── */

export const LAYER_NAMES = ['Primary', 'Secondary', 'Third'];

/**
 * Each substrate's GSM, and the total. `layers` = [{ material, specialty, microns }];
 * `sheet.layer_gsm[i]` is used only where no density is known (paper is already GSM).
 * Ink sits on the primary, adhesive on the secondary and third.
 */
export function gsmBreakdown(sales, layers, sheet = {}) {
  const sh = sheet || {};
  const typed = arr(sh.layer_gsm);
  const rows = [0, 1, 2].map((i) => {
    const l = arr(layers)[i] || {};
    const material = s(l.material);
    if (!material) return { material: '', density: null, gsm: 0, auto: false, used: false };
    const density = densityFor(sales, material, l.specialty);
    const mic = n(l.microns);
    const auto = density != null && mic > 0;
    const gsm = auto ? r2(density * mic) : n(typed[i]);
    return { material, density, micron: mic, gsm, auto, used: true };
  });
  const ink = rows[0].used ? n(sh.ink_gsm) : 0;
  const adhesive2 = rows[1].used ? n(sh.adhesive_gsm2) : 0;
  const adhesive3 = rows[2].used ? n(sh.adhesive_gsm3) : 0;
  const total = r2(rows.reduce((t, r) => t + r.gsm, 0) + ink + adhesive2 + adhesive3);
  return { rows, ink, adhesive2, adhesive3, adhesive: r2(adhesive2 + adhesive3), total };
}

/** How many substrates the structure has (1-3) — what decides the laminations. */
export function layerCount(layers) {
  return [0, 1, 2].filter((i) => s((arr(layers)[i] || {}).material)).length;
}

/* ── machines and their tooling ───────────────────────────────────────── */

/** Machines of the printing department (the Super Admin's Machines master). */
export function printingMachines(machines) {
  return arr(machines).filter((m) => m && m.active !== false && /print/i.test(s(m.departmentName)));
}
/** Machines of the lamination department. */
export function laminationMachines(machines) {
  return arr(machines).filter((m) => m && m.active !== false && /lamin/i.test(s(m.departmentName)));
}
export const machineKey = (m) => String(m && m.id != null ? m.id : s(m && (m.code || m.name)));
export const machineLabel = (m) => s(m && m.name) || s(m && m.code) || '—';

/** A typed list of widths — "330, 350 / 400" or [330, 350] — as sorted, unique numbers. */
export function parseWidths(v) {
  const list = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[\s,;/]+/);
  return [...new Set(list.map(Number).filter((x) => Number.isFinite(x) && x > 0))].sort((a, b) => a - b);
}

/**
 * The Super Admin's tooling for one machine (sales.machine_tooling[key]):
 * { maxWidth, sleeves: [repeat mm], rollers: [width mm] }.
 */
export function toolingFor(sales, key) {
  const t = ((sales && sales.machine_tooling) || {})[String(key)] || {};
  return { maxWidth: n(t.max_width), sleeves: parseWidths(t.sleeves), rollers: parseWidths(t.rollers) };
}

/* ── printing ─────────────────────────────────────────────────────────── */

/**
 * One printing machine's figures: print repeat = ups × single repeat; print width =
 * tracks × single print width; film width = print width + tracker line; `tooWide`
 * when the film exceeds the machine's maximum.
 */
export function printFigures(sheet, run, tooling = {}) {
  const sh = sheet || {};
  const rn = run || {};
  const repeat = r2(n(rn.ups) * n(sh.single_repeat));
  const tracks = n(rn.tracks);
  const printWidth = r2(tracks * n(sh.single_width));
  const filmWidth = tracks > 0 ? r2(printWidth + n(rn.tracker)) : 0;
  const max = n(tooling.maxWidth);
  const maxTracks = max > 0 && n(sh.single_width) > 0
    ? Math.max(0, Math.floor((max - n(rn.tracker)) / n(sh.single_width))) : null;
  return { repeat, printWidth, filmWidth, max, maxTracks, tooWide: max > 0 && filmWidth > max };
}

/**
 * The sleeves to offer: the machine's sleeves that fit the print repeat (no shorter
 * than it), nearest first; when none fits, every sleeve of the machine (`fallback`).
 */
export function sleeveChoices(sleeves, repeat) {
  const all = parseWidths(sleeves);
  if (!(repeat > 0)) return { options: all, fallback: false };
  const fit = all.filter((x) => x >= repeat);
  return fit.length ? { options: fit, fallback: false } : { options: all, fallback: true };
}

/* ── lamination ───────────────────────────────────────────────────────── */

/** The film width after `stage` laminations: + 10 mm for each. */
export const laminatedWidth = (filmWidth, stage) => (n(filmWidth) > 0 ? r2(n(filmWidth) + 10 * stage) : 0);

/**
 * The rollers to offer: "the roller width should be more than 5 mm than the print
 * width which is single print width in two tracks excluding the tracker line, and less
 * than the entire film width from stage 1" — 300 × 2 with a 20 mm tracker line is
 * 605 < roller < 620. With no roller in that window, every roller wider than print + 5
 * (`fallback`), so the QC can pick the nearest and say why in the comment.
 */
export function rollerChoices(rollers, printWidth, filmWidth) {
  const all = parseWidths(rollers);
  const lo = n(printWidth) + 5;
  const hi = n(filmWidth);
  if (!(n(printWidth) > 0)) return { options: all, ideal: [], lo, hi, fallback: false };
  const ideal = all.filter((x) => x > lo && (!(hi > 0) || x < hi));
  if (ideal.length) return { options: ideal, ideal, lo, hi, fallback: false };
  return { options: all.filter((x) => x > lo), ideal: [], lo, hi, fallback: true };
}

/* ── the dispatch-form specifications ─────────────────────────────────── */

export const SEAL_TYPES = ['Side seal', 'Centre seal', 'Three side seal'];
export const GUSSET_TYPES = ['Side gusset', 'Bottom gusset'];

/** Which block of the sheet a dispatch form gets. */
export function sheetKind(dispatchForm) {
  const k = despatchKind(dispatchForm);
  if (k === 'bulk' || k === 'pouch') return 'pouch';
  if (k === 'shrink') return 'sleeve';
  if (k === 'labels') return 'label';
  if (k === 'roll') return 'roll';
  return k ? 'other' : '';
}

/**
 * "if it is a bottom gusset, divide the gusset information into two and if it is a
 * side gusset, divide the gusset information into four" — the total gusset entered,
 * and what each fold is.
 */
export function gussetSplit(type, total) {
  const t = n(total);
  if (/bottom/i.test(s(type))) return { total: t, folds: 2, each: r2(t / 2), side: 0, bottom: t };
  if (/side/i.test(s(type))) return { total: t, folds: 4, each: r2(t / 4), side: t, bottom: 0 };
  return { total: t, folds: 0, each: 0, side: 0, bottom: 0 };
}

/** The GSM a weight is worked out on: the typed override, else the structure's total. */
export const weightGsm = (sheet, totalGsm) => (n(sheet && sheet.gsm_override) > 0 ? n(sheet.gsm_override) : n(totalGsm));

/**
 * The pouch / bulk bag: seal widths, finished height and width, weight and pouches per kg.
 *   height = pouch height + bottom seal × 2 (three side seal only) + bottom gusset + flap
 *   width  = pouch width + side / centre seal (both fields) + side gusset
 *   weight = height × width × GSM × 1.02 / 1,000,000 g
 */
export function pouchFigures(sheet, totalGsm) {
  const sh = sheet || {};
  const seal = r2(n(sh.seal_a) + n(sh.seal_b));
  const three = /three/i.test(s(sh.seal_type));
  const bottomSeal = three ? n(sh.bottom_seal) : 0;
  const g = gussetSplit(sh.gusset_type, sh.gusset_total);
  const height = r2(n(sh.pouch_height) + bottomSeal * 2 + g.bottom + n(sh.flap));
  const width = r2(n(sh.pouch_width) + seal + g.side);
  const gsm = weightGsm(sh, totalGsm);
  const weight = n(sh.pouch_height) > 0 && n(sh.pouch_width) > 0 && gsm > 0 ? r4((height * width * gsm * 1.02) / 1e6) : 0;
  return { seal, bottomSeal, three, gusset: g, height, width, gsm, weight, perKg: weight > 0 ? Math.round(1000 / weight) : 0 };
}

/** Sleeve weight = sleeve height × open width × GSM × 1.02 / 1,000,000 g. */
export function sleeveFigures(sheet, totalGsm) {
  const sh = sheet || {};
  const gsm = weightGsm(sh, totalGsm);
  const weight = n(sh.sleeve_height) > 0 && n(sh.open_width) > 0 && gsm > 0
    ? r4((n(sh.sleeve_height) * n(sh.open_width) * gsm * 1.02) / 1e6) : 0;
  return { gsm, weight, perKg: weight > 0 ? Math.round(1000 / weight) : 0 };
}

/**
 * Label: effective height = height + bleed, effective width = width + bleed; weight =
 * effective height × effective width × GSM × 1.02 / 1,000,000 g. (The document's
 * "/ 100000" would make a 100 × 100 mm label of 50 GSM weigh 5 g instead of 0.51 g;
 * every other weight on the sheet divides by a million, so this one does too.)
 */
export function labelFigures(sheet, totalGsm) {
  const sh = sheet || {};
  const effH = r2(n(sh.label_height) + n(sh.bleed_h));
  const effW = r2(n(sh.label_width) + n(sh.bleed_w));
  const gsm = weightGsm(sh, totalGsm);
  const weight = n(sh.label_height) > 0 && n(sh.label_width) > 0 && gsm > 0 ? r4((effH * effW * gsm * 1.02) / 1e6) : 0;
  return { effH, effW, gsm, weight, perKg: weight > 0 ? Math.round(1000 / weight) : 0 };
}

/* ── the whole sheet ──────────────────────────────────────────────────── */

export const blankSheet = () => ({
  layer_gsm: ['', '', ''], ink_gsm: '', adhesive_gsm2: '', adhesive_gsm3: '',
  coating: '', single_repeat: '', single_width: '',
  print: {}, lam1: {}, lam2: {},
  gusset_type: '', gusset_total: '', seal_type: '', seal_a: '', seal_b: '', bottom_seal: '',
  with_glue: 'No', zipper: 'No', pouch_height: '', pouch_width: '', flap: '', gsm_override: '',
  sleeve_height: '', sleeve_width: '', overlap: '', open_width: '', reverse_glue: 'No',
  label_height: '', label_width: '', bleed_h: '', bleed_w: '',
  core_in: '', per_reel_kg: '', packing: '',
});

/** A saved sheet with every key present, whatever version wrote it. */
export function sheetOf(saved) {
  const b = blankSheet();
  const sv = saved && typeof saved === 'object' ? saved : {};
  return {
    ...b, ...sv,
    layer_gsm: [0, 1, 2].map((i) => (arr(sv.layer_gsm)[i] ?? '')),
    print: { ...(sv.print || {}) }, lam1: { ...(sv.lam1 || {}) }, lam2: { ...(sv.lam2 || {}) },
  };
}

/**
 * Every problem that has to be put right before the sheet is saved — today, a film
 * wider than the printing machine takes.
 */
export function sheetErrors(sales, sheet, machines) {
  const out = [];
  const sh = sheet || {};
  Object.entries(sh.print || {}).forEach(([key, run]) => {
    const m = arr(machines).find((x) => machineKey(x) === key);
    const f = printFigures(sh, run, toolingFor(sales, key));
    if (f.tooWide) {
      out.push(`${machineLabel(m) || 'Printing machine'}: film width ${f.filmWidth} mm is more than the machine's ${f.max} mm`
        + (f.maxTracks != null ? ` — at most ${f.maxTracks} track(s)` : '') + '.');
    }
  });
  return out;
}

/**
 * The prefill a requisition gives the sheet: the rep's pouch / sleeve / roll / label
 * measurements and packing instructions ("these details should be given by the
 * marketing team in the Add SKU page itself").
 */
export function sheetFromRequest(details) {
  const d = details || {};
  const out = {};
  const put = (k, v) => { if (v !== '' && v != null && !(typeof v === 'number' && v === 0)) out[k] = String(v); };
  put('pouch_width', d.pouch_width_mm);
  put('pouch_height', d.pouch_height_mm);
  if (s(d.gusset_type)) out.gusset_type = s(d.gusset_type);
  put('gusset_total', d.totalGusset || (d.gusset_mm && (/side/i.test(s(d.gusset_type)) ? n(d.gusset_mm) * 4 : /bottom/i.test(s(d.gusset_type)) ? n(d.gusset_mm) * 2 : d.gusset_mm)));
  put('sleeve_height', d.sleeve_height_mm);
  put('sleeve_width', d.sleeve_width_mm);
  put('open_width', d.open_width_mm);
  put('core_in', d.core_width_in ?? d.core_in);
  put('per_reel_kg', d.per_reel_kg);
  const packing = [d.packing_instructions, d.other_specs].map(s).filter(Boolean).join(' · ');
  if (packing) out.packing = packing;
  return out;
}

/**
 * The flat figures a report or JSS row has always carried (GSM, film width, pouch
 * height …) — what the quote desk, the JSS list and the OAB read — worked out from
 * the sheet.
 */
export function flatFromSheet(sales, layers, sheet, dispatchForm) {
  const sh = sheetOf(sheet);
  const gsm = gsmBreakdown(sales, layers, sh);
  const kind = sheetKind(dispatchForm);
  const runs = Object.entries(sh.print || {});
  const first = runs.length ? printFigures(sh, runs[0][1], toolingFor(sales, runs[0][0])) : null;
  const firstRun = runs.length ? runs[0][1] || {} : {};
  const out = {
    gsm: gsm.total, ink_gsm: gsm.ink, adhesive_gsm: gsm.adhesive, coating: s(sh.coating),
    print_repeat: n(sh.single_repeat), film_width: first ? first.filmWidth : 0,
    ups: n(firstRun.ups), sleeve_repeat: n(firstRun.sleeve),
    core_in: n(sh.core_in), per_reel_kg: n(sh.per_reel_kg),
  };
  if (kind === 'pouch') {
    const p = pouchFigures(sh, gsm.total);
    Object.assign(out, {
      pouch_height: n(sh.pouch_height), pouch_width: n(sh.pouch_width), gusset: p.gusset.total,
      seal_width: p.seal, pouch_weight: p.weight, pouches_per_kg: p.perKg,
      glue_tape: sh.with_glue === 'Yes' ? 'Yes' : 'No',
    });
  } else if (kind === 'sleeve') {
    const sf = sleeveFigures(sh, gsm.total);
    Object.assign(out, {
      pouch_height: n(sh.sleeve_height), pouch_width: n(sh.sleeve_width), lay_flat: n(sh.open_width),
      seal_width: n(sh.overlap), pouch_weight: sf.weight, pouches_per_kg: sf.perKg,
      glue_tape: sh.reverse_glue === 'Yes' ? 'Yes' : 'No',
    });
  } else if (kind === 'label') {
    const lf = labelFigures(sh, gsm.total);
    Object.assign(out, { pouch_height: lf.effH, pouch_width: lf.effW, pouch_weight: lf.weight, pouches_per_kg: lf.perKg });
  }
  return out;
}

/* ── the tentative quantity's unit (lives with the rep's dispatch fields) ── */
export { tentativeUom } from './repFlow.js';

/** True when nothing has been entered on the sheet — such a sheet is not stored. */
export function sheetIsBlank(sheet) {
  const sh = sheetOf(sheet);
  const b = blankSheet();
  return Object.keys(b).every((k) => {
    if (k === 'layer_gsm') return sh.layer_gsm.every((v) => s(v) === '');
    if (k === 'print' || k === 'lam1' || k === 'lam2') return Object.keys(sh[k] || {}).length === 0;
    return s(sh[k]) === s(b[k]);
  });
}

/** Printing machines with no roller picked at a lamination stage — said on the form, not blocking. */
export function missingRollers(sheet, stage) {
  const sh = sheetOf(sheet);
  return Object.keys(sh.print).filter((p) => !Object.values((sh[stage] || {})[p] || {}).some((x) => x && s(x.roller)));
}

/**
 * Issues 26.10: a JSS row with its Specifications sheet. The sheet is stored with the
 * spec (`specSheet`), and the spec's own figures — GSM, film width, ups, SKU width /
 * height, gusset, pouch weight — are filled from it wherever the QC left them blank,
 * so the JSS list, the OAB and the PLAN board read the same numbers the sheet shows.
 */
export function jssWithSheet(sales, row, layers, sheet) {
  const out = { ...(row || {}) };
  if (!sheet || sheetIsBlank(sheet)) { delete out.specSheet; return out; }
  out.specSheet = sheetOf(sheet);
  const flat = flatFromSheet(sales, layers, out.specSheet, out.dispatchForm);
  const blank = (v) => v === '' || v == null || Number(v) === 0;
  const fill = (k, v) => { if (blank(out[k]) && v > 0) out[k] = v; };
  fill('gsm', flat.gsm);
  fill('filmWidth', flat.film_width);
  fill('ups', flat.ups);
  fill('width', flat.pouch_width);
  fill('height', flat.pouch_height);
  fill('pouchWeight', flat.pouch_weight);
  if (blank(out.gusset) && flat.gusset > 0) out.gusset = String(flat.gusset);
  return out;
}
