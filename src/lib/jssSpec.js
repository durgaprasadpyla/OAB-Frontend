// What a JSS spec is MADE OF, and what the QC login may choose.
//
// Until now the JSS carried a free-text Material and a free-text Job Type, and QC
// could invent a customer, a group or a film on the spot. That is how the master
// filled with spellings nothing downstream could match, and why a BOM could name a
// film the stores had never heard of. The client's rule (JSS+QC LOGIN, 24 Sep 2026)
// is simple: QC types a Job Name and nothing else — every other field is chosen
// from something the business already maintains.
//
//   · JOB TYPE comes from the Super Admin's drop-down selections. The four "SF …"
//     types are Stay Fresh work and their orders belong on the Stay Fresh OAB; the
//     rest go to Others. Laminate types additionally unlock a second and third layer.
//   · MATERIAL, SPECIALITY, MICRON and FILM WIDTH come from the ITEM MASTER — only
//     items whose material type is FILM or PAPER — and each choice narrows the next,
//     so a spec can only ever describe film the factory actually buys.
//
// The layers are stored structurally (primary / secondary / third) AND composed into
// the single `material` string every existing screen reads (costing, Trends, the OAB
// export, the BOM), so nothing downstream has to change to keep working.

const s = (v) => String(v == null ? '' : v).trim();
const key = (v) => s(v).toUpperCase();
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* ─────────────────────────────── job types ─────────────────────────────── */

/** The Stay Fresh job types — their sale orders go to the Stay Fresh OAB. */
export const SF_JOB_TYPES = ['SF Pouch', 'SF Pouch + Tape', 'SF Lidding Film', 'SF Lami Pouch + Zipper'];

/** Everything else the business runs — these go to the Others OAB. */
export const OTHER_JOB_TYPES = [
  'Courier Bags', 'Milk Roll', 'Diaper Pouch', 'Lami Roll', 'Lami Pouch', 'Lami Pouch + Zipper',
  'Monolayer Pouch', 'Ice Cream Cone', 'Paper Labels', 'BOPP Labels', 'IML Labels',
  'Shrink Sleeves', 'Shrink Sleeves Roll',
];

/** The list the Super Admin's drop-down selections page starts from. */
export const JOB_TYPE_DEFAULTS = [...SF_JOB_TYPES, ...OTHER_JOB_TYPES];

/**
 * Does this job type belong on the STAY FRESH OAB?
 *
 * A type whose name begins with "SF" is Stay Fresh — which is exactly the four the
 * client listed, and stays true for any SF type they add later without anybody
 * having to change code. "StayFresh" itself is the value every spec carried before
 * this list existed, so it still counts.
 */
export function isStayFreshJobType(jobType) {
  const t = key(jobType);
  if (!t) return false;
  if (t.replace(/[^A-Z]/g, '') === 'STAYFRESH') return true;
  return /^SF\b/.test(t);
}

/** "SF" or "OT" — the OAB sheet a job type's sale orders belong on. */
export const sheetForJobType = (jobType) => (isStayFreshJobType(jobType) ? 'SF' : 'OT');

/**
 * Job types made of more than one layer — these unlock the secondary and third
 * material. A laminate says so in its name ("Lami"), and the ice cream cone is one
 * by construction.
 */
export function isLaminateJobType(jobType) {
  const t = key(jobType);
  if (!t) return false;
  return t.includes('LAMI') || t.includes('ICE CREAM CONE');
}

/** How many material layers a job type has: 1, or 3 when it laminates. */
export const layerCountFor = (jobType) => (isLaminateJobType(jobType) ? 3 : 1);

/* ───────────────────────── the item master, as options ───────────────────── */

/** The material types a JSS may be made of — film and paper, nothing else. */
const SPEC_MATERIAL_TYPES = ['FILM', 'PAPER'];

/** Is this item master row a film or a paper? */
export function isSpecMaterial(item) {
  return SPEC_MATERIAL_TYPES.includes(key(item && item.materialType));
}

/**
 * The item master rows a JSS may be built from, in one shape:
 *   { code, name, material, specialty, microns, widthMm, uom }
 * where `material` is the item's SUB-GROUP — "CC PET", "LDPE - NATURAL" — which is
 * what the business calls a material when it specifies a job.
 */
export function specItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && isSpecMaterial(it) && s(it.subGroup))
    .map((it) => ({
      code: s(it.code),
      name: s(it.name),
      materialType: s(it.materialType),
      material: s(it.subGroup),
      specialty: s(it.specialtyName || it.specialty),
      microns: s(it.microns),
      widthMm: n(it.widthMm),
      uom: s(it.uom),
    }));
}

const uniqSorted = (values, numeric = false) => [...new Set(values.map(s).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, undefined, numeric ? { numeric: true } : undefined));

/** Every material (sub-group) under film or paper. */
export function materialOptions(items) {
  return uniqSorted(specItems(items).map((it) => it.material));
}

/** The specialities recorded for one material — "only those which are available for CC PET". */
export function specialtyOptions(items, material) {
  const m = key(material);
  if (!m) return [];
  return uniqSorted(specItems(items).filter((it) => key(it.material) === m).map((it) => it.specialty));
}

/** The microns recorded for one material (narrowed by speciality when one is chosen). */
export function micronOptions(items, material, specialty) {
  const m = key(material);
  if (!m) return [];
  const sp = key(specialty);
  return uniqSorted(specItems(items)
    .filter((it) => key(it.material) === m && (!sp || key(it.specialty) === sp))
    .map((it) => it.microns), true);
}

/** One layer of a spec, as the form holds it. */
export const blankLayer = () => ({ material: '', specialty: '', microns: '' });

/** The layers that are actually filled in, in order. */
export function filledLayers(layers) {
  return (layers || []).filter((l) => l && s(l.material));
}

/** The item master rows that match one layer (material + speciality + micron, as far as each is given). */
export function itemsForLayer(items, layer) {
  const m = key(layer && layer.material);
  if (!m) return [];
  const sp = key(layer && layer.specialty);
  const mic = key(layer && layer.microns);
  return specItems(items).filter((it) => key(it.material) === m
    && (!sp || key(it.specialty) === sp)
    && (!mic || key(it.microns) === mic));
}

/** The film widths stocked for one layer. */
export function widthsForLayer(items, layer) {
  return [...new Set(itemsForLayer(items, layer).map((it) => it.widthMm).filter((w) => w > 0))]
    .sort((a, b) => a - b);
}

/**
 * The film widths a SPEC can be run at: a width every layer is available in.
 *
 * "If I have selected CC PET as the primary material and LDPE natural as the
 * secondary, the film width I intend to use is 600 mm and I have a 600 mm item in
 * CC PET whereas I do not have a 600 mm item for LDPE natural, then the QC will get
 * in touch with the super admin" — so a width only counts when EVERY layer has it,
 * and a width that some layer is missing is reported rather than silently offered.
 *
 * Returns { widths, partial } — `partial` lists the widths one layer has and
 * another does not, with the materials that are missing it.
 */
export function filmWidthOptions(items, layers) {
  const used = filledLayers(layers);
  if (!used.length) return { widths: [], partial: [] };
  const perLayer = used.map((l) => ({ material: l.material, widths: new Set(widthsForLayer(items, l)) }));
  const every = [...new Set(perLayer.flatMap((p) => [...p.widths]))].sort((a, b) => a - b);
  const widths = every.filter((w) => perLayer.every((p) => p.widths.has(w)));
  const partial = every
    .filter((w) => !perLayer.every((p) => p.widths.has(w)))
    .map((w) => ({ width: w, missing: perLayer.filter((p) => !p.widths.has(w)).map((p) => p.material) }));
  return { widths, partial };
}

/* ──────────────────────────── the composed spec ──────────────────────────── */

/**
 * The single Material string the rest of the tool reads, composed from the layers:
 * "CC PET + LDPE - NATURAL". One layer reads as itself, so a monolayer spec looks
 * exactly as it always did.
 */
export function materialFromLayers(layers) {
  return filledLayers(layers).map((l) => s(l.material)).join(' + ');
}

/** The structure with its microns, for the screens that show the build-up. */
export function structureFromLayers(layers) {
  return filledLayers(layers)
    .map((l) => [s(l.material), s(l.specialty), s(l.microns) ? s(l.microns) + ' mic' : ''].filter(Boolean).join(' · '))
    .join('  +  ');
}

/** The layers back out of a saved spec, for editing one that already exists. */
export function layersOfSpec(spec) {
  const at = (i) => ({
    material: s(spec && spec[`material${i}`]),
    specialty: s(spec && spec[`specialty${i}`]),
    microns: s(spec && spec[`microns${i}`]),
  });
  const out = [at(1), at(2), at(3)];
  // A spec saved before the layers existed carries only the composed string; its
  // first layer is that text, so the form opens on what the spec actually says.
  if (!out[0].material) {
    out[0] = { material: s(spec && spec.material).split('+')[0].trim(), specialty: '', microns: s(spec && spec.mic) };
  }
  return out;
}

/** The layer fields written onto a spec, alongside the composed `material` and `mic`. */
export function layerFields(layers) {
  const out = {};
  [0, 1, 2].forEach((i) => {
    const l = (layers || [])[i] || blankLayer();
    out[`material${i + 1}`] = s(l.material);
    out[`specialty${i + 1}`] = s(l.specialty);
    out[`microns${i + 1}`] = s(l.microns);
  });
  out.material = materialFromLayers(layers);
  out.structure = structureFromLayers(layers);
  // MIC has always been the spec's thickness; the primary layer's micron is it.
  const primary = (layers || [])[0] || blankLayer();
  if (s(primary.microns)) out.mic = s(primary.microns);
  return out;
}

/* ───────────────────────────────── gusset ───────────────────────────────── */

/** "20+20" → { a: '20', b: '20' }; a plain "40" → { a: '40', b: '' }. */
export function gussetParts(gusset) {
  const [a, b] = s(gusset).split('+');
  return { a: s(a), b: s(b) };
}

/** { a, b } → "20+20", or "40" when there is no second panel. */
export function gussetJoin(a, b) {
  const x = s(a), y = s(b);
  if (x && y) return `${x}+${y}`;
  return x || y || '';
}
