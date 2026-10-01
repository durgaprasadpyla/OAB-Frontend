import { useEffect, useRef, useState } from 'react';
import { masterApi } from '../api.js';
import { PO_STATUSES, PO_STATUS_LABELS } from '../lib/poLines.js';

/**
 * The filter bar every purchase-order page carries (Issues 30.09 §S7): "on all the
 * purchase orders pages I would want the status filter. Material type, specialty, and
 * item description."
 *
 * `value` is { status, materialType, specialty, description, q }; `onChange(patch)`
 * merges a patch into it; `options` comes from poLineOptions(), already narrowed — so
 * the speciality list holds only what the chosen material comes in. A value that
 * drops out of its narrowed list clears itself rather than silently matching nothing.
 * `children` sit at the end of the bar (the stores tab's "Open POs only").
 */
export default function PoLineFilters({ value, onChange, options, search = true, searchPlaceholder = 'Search PO / supplier / item…', children }) {
  // Held in a ref: callers pass an inline (prev) => … merger, and the clean-up effect
  // below must not re-fire on every render for want of a stable callback.
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const o = options || { materialTypes: [], specialties: [], descriptions: [] };
  const has = (list, v) => list.some((x) => x.toLowerCase() === String(v).toLowerCase());

  useEffect(() => {
    const patch = {};
    if (value.materialType && !has(o.materialTypes, value.materialType)) patch.materialType = '';
    if (value.specialty && !has(o.specialties, value.specialty)) patch.specialty = '';
    if (value.description && !has(o.descriptions, value.description)) patch.description = '';
    if (Object.keys(patch).length) changeRef.current(patch);
  }, [value.materialType, value.specialty, value.description, o.materialTypes, o.specialties, o.descriptions]);

  const sel = { height: 30, fontSize: 12, maxWidth: 220 };
  return (
    <div className="fbar" style={{ flexWrap: 'wrap', gap: 8, margin: '0 0 8px' }} role="group" aria-label="Purchase order filters">
      <select value={value.status} onChange={(e) => changeRef.current({ status: e.target.value })} aria-label="PO status filter" style={sel}>
        <option value="">All statuses</option>
        {PO_STATUSES.map((s) => <option key={s} value={s}>{PO_STATUS_LABELS[s]}</option>)}
      </select>
      <select value={value.materialType} onChange={(e) => changeRef.current({ materialType: e.target.value, specialty: '', description: '' })}
        aria-label="PO material type filter" style={sel}>
        <option value="">All material types</option>
        {o.materialTypes.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <select value={value.specialty} onChange={(e) => changeRef.current({ specialty: e.target.value, description: '' })}
        aria-label="PO speciality filter" style={sel}>
        <option value="">All specialities</option>
        {o.specialties.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <select value={value.description} onChange={(e) => changeRef.current({ description: e.target.value })}
        aria-label="PO item description filter" style={{ ...sel, maxWidth: 260 }}>
        <option value="">All item descriptions</option>
        {o.descriptions.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      {search && (
        <input placeholder={searchPlaceholder} value={value.q} onChange={(e) => changeRef.current({ q: e.target.value })}
          aria-label="Search purchase orders" style={{ minWidth: 200, maxWidth: 260 }} />
      )}
      {children}
    </div>
  );
}

/**
 * The whole Item Master (inactive items included — an old PO still names them), read
 * once per screen. It is the authority for a PO line's identity; a screen that cannot
 * reach it falls back to the line's own copy and the supplier's ASL row.
 */
export function useItemMaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let live = true;
    // includeInactive: the server lists active items only unless asked — and a PO line
    // raised before an item was withdrawn must still read its identity from the master.
    masterApi.listItems({ includeInactive: 1 })
      .then((r) => { if (live && Array.isArray(r)) setItems(r); })
      .catch(() => { /* identity falls back to the PO line and the ASL row */ });
    return () => { live = false; };
  }, []);
  return items;
}
