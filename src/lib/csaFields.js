// Issues 17.10 §8 — the CSA report's MEASUREMENTS follow the requisition's dispatch
// form, and its film width comes from the Item Master.
//
// "the despatch form is roll whereas the measurements are given for pouch." A roll
// has no pouch height or pouches per kg; a pouch has no core or per-reel weight. The
// grouping is the rep's own (repFlow.despatchKind), so the CSA and the requisition
// that asked for it agree on what kind of job this is.
//
// "the film should be populated from the backend from the item list that is added in
// the backend only - as of now it is a number entry field." The widths are the ones
// the JSS page and the rep's Add SKU structure offer (jssSpec.filmWidthOptions over
// /api/master/items), narrowed by the substrates already chosen on the report.
import { despatchKind } from './repFlow.js';
import { filmWidthOptions, specItems } from './jssSpec.js';

/** Every measurement the CSA form can show, in the order it shows them. */
export const CSA_MEASURE_FIELDS = [
  { k: 'ink_gsm', label: 'Ink GSM', type: 'number' },
  { k: 'adhesive_gsm', label: 'Adhesive GSM', type: 'number' },
  { k: 'coating', label: 'Coating', type: 'text' },
  { k: 'film_width', label: 'Film width', type: 'film' },
  { k: 'gsm', label: 'GSM', type: 'number' },
  { k: 'print_repeat', label: 'Print repeat', type: 'number' },
  { k: 'core_in', label: 'Core (inches)', type: 'number' },
  { k: 'per_reel_kg', label: 'Per reel (Kgs)', type: 'number' },
  { k: 'pouch_height', label: 'Pouch height', type: 'number' },
  { k: 'pouch_width', label: 'Pouch width', type: 'number' },
  { k: 'gusset', label: 'Gusset', type: 'number' },
  { k: 'seal_width', label: 'Seal width', type: 'number' },
  { k: 'pouch_weight', label: 'Pouch weight', type: 'number' },
  { k: 'pouches_per_kg', label: 'Pouches per kg', type: 'number' },
  { k: 'sleeve_repeat', label: 'Sleeve repeat', type: 'number' },
  { k: 'lay_flat', label: 'Lay-flat width', type: 'number' },
  { k: 'glue_tape', label: 'Glue / tape', type: 'yesno' },
  { k: 'printed', label: 'Printed', type: 'yesno' },
];

/** What every form carries: the build-up of the film itself. */
const COMMON = ['ink_gsm', 'adhesive_gsm', 'coating', 'film_width', 'gsm', 'glue_tape', 'printed'];
const POUCH = [...COMMON, 'pouch_height', 'pouch_width', 'gusset', 'seal_width', 'pouch_weight', 'pouches_per_kg'];

/** Issues 17.10 §8: the measurements per dispatch kind (repFlow.despatchKind). */
export const CSA_FIELDS_BY_KIND = {
  roll: [...COMMON, 'print_repeat', 'core_in', 'per_reel_kg'],
  pouch: POUCH,
  bulk: POUCH,
  shrink: [...COMMON, 'sleeve_repeat', 'lay_flat', 'seal_width', 'print_repeat', 'core_in'],
  labels: [...COMMON, 'print_repeat'],
};

/** The dispatch form a CSA is about: the SKU's, else what the rep's requisition named, else the direct report's own. */
export function csaDispatchForm(sku, form) {
  const req = (sku && sku.csa_request) || {};
  return String((sku && (sku.dispatch_form || sku.dispatch_type)) || req.despatch_form
    || (form && form.dispatch_type) || '').trim();
}

/**
 * The measurement fields to SHOW for a dispatch form — every field while the form is
 * unknown. Hidden fields keep whatever the report already holds; they are only not drawn.
 */
export function csaVisibleFields(dispatchForm) {
  const kind = despatchKind(dispatchForm);
  const keys = CSA_FIELDS_BY_KIND[kind];
  if (!keys) return { kind, fields: CSA_MEASURE_FIELDS };
  const on = new Set(keys);
  return { kind, fields: CSA_MEASURE_FIELDS.filter((f) => on.has(f.k)) };
}

/** A width as the select holds it: "435" — never "435.0", never "0". */
export function widthKey(v) {
  if (v == null || v === '') return '';
  const x = Number(v);
  if (Number.isFinite(x)) return x > 0 ? String(x) : '';
  return String(v).trim();
}

/**
 * The film widths offered on the CSA. With substrates chosen, the widths EVERY chosen
 * layer is stocked in (the JSS rule, with `partial` naming the short ones); with none
 * chosen yet, every width on a film / paper item. `basis` says which.
 */
export function csaFilmWidthChoices(items, form) {
  const f = form || {};
  const layers = [1, 2, 3].map((n) => ({
    material: f[`substrate${n}`] || '',
    specialty: f[`substrate${n}_specialty`] || '',
    microns: f[`substrate${n}_val`] == null || f[`substrate${n}_val`] === 0 ? '' : String(f[`substrate${n}_val`]),
  })).filter((l) => String(l.material).trim());
  if (layers.length) {
    const { widths, partial } = filmWidthOptions(items, layers);
    return { options: widths.map(String), partial, basis: 'layers' };
  }
  const every = [...new Set(specItems(items).map((it) => it.widthMm).filter((w) => w > 0))].sort((a, b) => a - b);
  return { options: every.map(String), partial: [], basis: 'all' };
}

/** The first film width the rep's requisition structure names ("CC PET · 12 mic · 435 mm + …"), or ''. */
export function requestedFilmWidth(layers) {
  const hit = (Array.isArray(layers) ? layers : []).find((l) => l && widthKey(l.widthMm));
  return hit ? widthKey(hit.widthMm) : '';
}
