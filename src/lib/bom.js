// Bill of Materials (module 13) — raw-material requirement per sale order.
//
// A BOM is defined once per spec against a BASE quantity: "to make `baseQty`
// units of this spec you need these raw-material items". Requirement for a real
// sale order is then a straight proportional scale of that recipe:
//
//     required = (soQty / baseQty) × qtyPerBase
//
// Record shape (BOM[spec]):
//   { spec, baseQty, baseUOM, meters, width, height,
//     items: [{ itemCode, itemDescription, materialType, subGroup, microns, uom, qtyPerBase }],
//     history: [{ ts, user, note }] }
//
// Editable only by superadmin (backend AuthzService grants module 13 to
// superadmin alone for both read and write).
//
// Every function here is pure — callers pass the BOM map and OAB rows in.

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Base unit of measure implied by a spec's dispatch form. (bomUOM 6380) */
export function bomUOM(dispatchForm) {
  const df = String(dispatchForm || '').toLowerCase().trim();
  if (df === 'roll' || df === 'rolls') return 'Kgs';
  if (df === 'pouch' || df === 'pouches') return 'Pouches';
  if (df === 'label' || df === 'labels') return 'Pieces';
  return 'Pcs';
}

/** True when a spec has a usable BOM (at least one item). */
export function hasBOM(bom, spec) {
  const rec = bom && bom[spec];
  return !!(rec && Array.isArray(rec.items) && rec.items.length);
}

/**
 * Raw material needed to make `soQty` of `spec`, scaled from the BOM's base.
 * Returns [] when the spec has no BOM or the BOM has no base quantity (which
 * would make the scale factor infinite). (bomMaterialForSO 6799)
 */
export function bomMaterialForSO(bom, spec, soQty) {
  const rec = bom && bom[spec];
  if (!rec || !n(rec.baseQty) || !Array.isArray(rec.items)) return [];
  const factor = n(soQty) / n(rec.baseQty);
  return rec.items.map((r) => ({
    itemCode: r.itemCode,
    itemDescription: r.itemDescription,
    materialType: r.materialType,
    subGroup: r.subGroup,
    uom: r.uom,
    required: factor * n(r.qtyPerBase),
  }));
}

/**
 * Every open (undispatched) sale order across both sheets, with its balance
 * quantity and whether its spec has a BOM. Newest SO first. (bomOpenSOList 6806)
 *
 * "Open" means not closed AND still having balance to make: poQty minus
 * everything already accounted for (invoiced, manually dispatched, and FG
 * allocated). A zero balance needs no material, so it drops out.
 */
export function bomOpenSOList(bom, oab, { metresOf = () => 0, groupOf = null } = {}) {
  const out = [];
  ['SF', 'OT'].forEach((sheet) => {
    ((oab && oab[sheet]) || []).forEach((r) => {
      if (!r || r.closed) return;
      const disp = n(r.invDisp) + n(r.manDisp) + n(r.fg);
      const bal = Math.max(0, n(r.poQty) - disp);
      if (!bal) return;
      out.push({
        sheet, so: r.so, spec: r.spec, customer: r.customer,
        group: (groupOf ? groupOf(r.customer) : '') || r.customer || '',
        jobName: r.jobName, bal, mtrs: n(metresOf(r, bal)),
        hasBOM: hasBOM(bom, r.spec),
      });
    });
  });
  out.sort((a, b) => String(b.so || '').localeCompare(String(a.so || ''), undefined, { numeric: true }));
  return out;
}

/**
 * Aggregate the material requirement across a set of sale orders, keyed by item
 * code and carrying the per-SO split so a planner can see what drives a total.
 * Biggest requirement first. (bomMaterialForSOList 6820)
 */
export function bomMaterialForSOList(bom, list) {
  const agg = {};
  (list || []).forEach((r) => {
    if (!r.bal || !hasBOM(bom, r.spec)) return;
    bomMaterialForSO(bom, r.spec, r.bal).forEach((m) => {
      if (!m.itemCode || !m.required) return;
      if (!agg[m.itemCode]) {
        agg[m.itemCode] = {
          itemCode: m.itemCode, itemDescription: m.itemDescription,
          materialType: m.materialType, uom: m.uom, total: 0, bySO: [],
        };
      }
      agg[m.itemCode].total += m.required;
      agg[m.itemCode].bySO.push({ so: r.so, spec: r.spec, customer: r.customer, qty: m.required });
    });
  });
  return Object.values(agg).sort((a, b) => b.total - a.total);
}

/**
 * Filter an open-SO list by any combination of group / customer / spec.
 * An empty set for a kind means "no constraint on that kind".
 * (bomFilteredOpenSOList 6760)
 */
export function bomFilterSOList(list, { group, customer, spec } = {}) {
  const has = (set, v) => !set || !set.size || set.has(v);
  return (list || []).filter((r) => has(group, r.group) && has(customer, r.customer) && has(spec, r.spec));
}

/**
 * Options for one filter kind, narrowed by what is already selected in the OTHER
 * two — so picking a group shrinks the customer and spec lists to what that
 * group's open orders actually use. (bomMultiOptions 6712)
 */
export function bomFilterOptions(list, kind, sel = {}) {
  const others = { group: sel.group, customer: sel.customer, spec: sel.spec };
  delete others[kind];
  const rows = bomFilterSOList(list, others);
  return [...new Set(rows.map((r) => r[kind]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

/**
 * Human note describing what changed between two BOM revisions, appended to the
 * spec's history on every save. (bomDiffNote 6520)
 */
export function bomDiffNote(prev, next) {
  if (!prev) return 'BOM created';
  const notes = [];
  if (n(prev.baseQty) !== n(next.baseQty)) notes.push(`base qty ${n(prev.baseQty)} → ${n(next.baseQty)}`);
  const pi = new Map((prev.items || []).map((r) => [r.itemCode, n(r.qtyPerBase)]));
  const ni = new Map((next.items || []).map((r) => [r.itemCode, n(r.qtyPerBase)]));
  ni.forEach((q, code) => {
    if (!pi.has(code)) notes.push(`+${code}`);
    else if (pi.get(code) !== q) notes.push(`${code} ${pi.get(code)} → ${q}`);
  });
  pi.forEach((_, code) => { if (!ni.has(code)) notes.push(`−${code}`); });
  return notes.length ? notes.join(', ') : 'no material change';
}

/**
 * Build the saved record for a spec, stamping a history entry. Returns a NEW BOM
 * map. Items without a code or a positive per-base quantity are dropped — they
 * would contribute nothing and would divide the requirement view with blanks.
 * Throws on the two conditions the editor must refuse. (bomSaveSpec 6489)
 */
export function bomSaveSpec(bom, spec, draft, { jssRow = {}, user = '' } = {}) {
  const baseQty = n(draft.baseQty);
  if (!baseQty) throw new Error('Enter a base quantity before saving.');
  const items = (draft.items || [])
    .filter((r) => r.itemCode && n(r.qtyPerBase) > 0)
    .map((r) => ({
      itemCode: r.itemCode, materialType: r.materialType || '', subGroup: r.subGroup || '',
      itemDescription: r.itemDescription || '', microns: r.microns || '',
      uom: r.uom || '', qtyPerBase: n(r.qtyPerBase),
    }));
  if (!items.length) throw new Error('Add at least one raw material item with a quantity.');

  const base = bom || {};
  const prev = base[spec];
  const next = {
    spec,
    baseQty,
    baseUOM: bomUOM(jssRow.dispatchForm),
    meters: draft.meters ?? '',
    width: draft.width ?? '',
    height: draft.height ?? '',
    items,
    history: (prev && Array.isArray(prev.history)) ? prev.history.slice() : [],
  };
  next.history.push({ ts: new Date().toISOString(), user: user || '', note: bomDiffNote(prev, next) });
  return { ...base, [spec]: next };
}
