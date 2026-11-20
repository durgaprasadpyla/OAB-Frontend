// 18.11: "when I am creating items, I will be able to create some specialities which
// are specific to the material type and subgroup: based on the selection only those
// specialty dropdowns should appear. For now everything is appearing. Give me a place
// where I'll be able to link the existing ones. Going forward please do this linking
// automatically."
//
// A speciality belongs to a Material Type + Sub Group pair when either
//   • an item already carries it under that pair (linked automatically — saving an
//     item with a speciality IS the link, nothing to keep in step), or
//   • the Super Admin ticked it for that pair (`purchase.specialtyLinks`, the place
//     to link the existing ones).
// The Item Master's Speciality picker offers only those. A pair nothing is linked to
// yet offers every speciality, so a brand-new sub group is never a dead end.

const s = (v) => String(v == null ? '' : v).trim();
const k = (v) => s(v).toLowerCase();

/** The key a pair is stored under: "film|cc pet". */
export const linkKey = (materialType, subGroup) => `${k(materialType)}|${k(subGroup)}`;

/** `{ speciality: itemCount }` — the specialities items already carry under this pair. */
export function usedUnder(rows, materialType, subGroup) {
  const out = {};
  (rows || []).forEach((r) => {
    if (!r || k(r.materialType) !== k(materialType) || k(r.subGroup) !== k(subGroup)) return;
    const sp = s(r.specialty);
    if (sp) out[sp] = (out[sp] || 0) + 1;
  });
  return out;
}

/** The specialities ticked for this pair by hand. */
export function linkedByHand(links, materialType, subGroup) {
  const list = links && links[linkKey(materialType, subGroup)];
  return Array.isArray(list) ? list.map(s).filter(Boolean) : [];
}

/**
 * The Speciality picker's options for a pair: `{ options, narrowed }`. `narrowed` is
 * false when nothing is linked to the pair yet (every speciality is offered).
 */
export function specialtiesFor({ rows, links, all, materialType, subGroup }) {
  const mt = s(materialType), sg = s(subGroup);
  if (!mt || !sg) return { options: all || [], narrowed: false };
  const linked = new Map();
  [...Object.keys(usedUnder(rows, mt, sg)), ...linkedByHand(links, mt, sg)]
    .forEach((v) => { if (!linked.has(k(v))) linked.set(k(v), v); });
  if (!linked.size) return { options: all || [], narrowed: false };
  return { options: [...linked.values()].sort((a, b) => a.localeCompare(b)), narrowed: true };
}

/** Links with `speciality` ticked (on) or unticked (off) for a pair. Returns NEW links. */
export function setLink(links, materialType, subGroup, speciality, on) {
  const key = linkKey(materialType, subGroup);
  const cur = linkedByHand(links, materialType, subGroup);
  const has = cur.some((v) => k(v) === k(speciality));
  const next = on ? (has ? cur : [...cur, s(speciality)]) : cur.filter((v) => k(v) !== k(speciality));
  const out = { ...(links || {}) };
  if (next.length) out[key] = next; else delete out[key];
  return out;
}
