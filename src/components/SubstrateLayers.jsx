import { useEffect, useMemo, useState } from 'react';
import { masterApi } from '../api.js';
import { specItems, materialOptions, micronOptions, widthsForLayer } from '../lib/jssSpec.js';

// 28.09 §Sales ¶24: "One more text field for structure — if we can have a drop-down
// selection similar to the JSS creation page with: primary substrate micron film
// width / secondary substrate micron film width / tertiary substrate micron film
// width, that would be ideal."
//
// The same Item Master the JSS is built from, so a structure the rep writes down
// names materials and widths the plant can actually buy. Free text let a rep ask for
// "PET 12 / MET PET" in a width nobody stocks, and the mismatch only surfaced at the
// CSA. Each row narrows the one to its right: pick the substrate and only its microns
// are offered; pick the micron and only the widths held in it.

export const LAYER_LABELS = ['Primary', 'Secondary', 'Third'];
export const blankSubLayer = () => ({ material: '', microns: '', widthMm: '' });
export const blankSubLayers = () => [blankSubLayer(), blankSubLayer(), blankSubLayer()];

/** The structure line the rest of the tool reads: "CC PET 12 mic · 600 mm + LDPE 50 mic". */
export function structureFromSubLayers(layers) {
  return (Array.isArray(layers) ? layers : [])
    .filter((l) => l && String(l.material || '').trim())
    .map((l) => [
      String(l.material || '').trim(),
      String(l.microns || '').trim() ? String(l.microns).trim() + ' mic' : '',
      String(l.widthMm || '').trim() ? String(l.widthMm).trim() + ' mm' : '',
    ].filter(Boolean).join(' · '))
    .join('  +  ');
}

/** Read a saved structure string back into layers, so an edit does not start blank. */
export function subLayersFromStructure(text) {
  const out = blankSubLayers();
  String(text || '').split('+').map((p) => p.trim()).filter(Boolean).slice(0, 3)
    .forEach((part, i) => {
      const bits = part.split('·').map((b) => b.trim()).filter(Boolean);
      const layer = blankSubLayer();
      bits.forEach((b) => {
        if (/\bmic\b/i.test(b)) layer.microns = b.replace(/\s*mic\b/i, '').trim();
        else if (/\bmm\b/i.test(b)) layer.widthMm = b.replace(/\s*mm\b/i, '').trim();
        else if (!layer.material) layer.material = b;
      });
      out[i] = layer;
    });
  return out;
}

function Pick({ label, value, options, onChange, disabled, ariaLabel, placeholder }) {
  return (
    <div className="fg">
      <label>{label}</label>
      <select value={value ?? ''} aria-label={ariaLabel || label} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder || '— select —'}</option>
        {/* a value saved before the master changed stays selectable */}
        {value && !options.some((o) => String(o) === String(value)) && <option value={value}>{value}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/**
 * Three substrate rows. `layers` is [{ material, microns, widthMm } × 3];
 * `onChange` gets the whole array back.
 *
 * `max` limits how many rows are offered — a monolayer SKU needs only the first.
 */
export default function SubstrateLayers({ layers, onChange, max = 3, disabled = false }) {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    masterApi.listItems()
      .then((r) => { if (live) setItems(Array.isArray(r) ? r : []); })
      .catch(() => { if (live) setErr('The Item Master could not be read — the substrate list is empty.'); });
    return () => { live = false; };
  }, []);

  const pool = useMemo(() => specItems(items), [items]);
  const materials = useMemo(() => materialOptions(items), [items]);

  const rows = Array.isArray(layers) && layers.length ? layers : blankSubLayers();
  const setLayer = (i, patch) => onChange(rows.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="fg" style={{ gridColumn: '1 / -1' }}>
      <label>Structure <span style={{ fontWeight: 400, color: 'var(--i3)' }}>— from the Item Master, as on the JSS page</span></label>
      {err && <div className="al al-y" style={{ marginBottom: 6 }}>{err}</div>}
      {rows.slice(0, max).map((l, i) => {
        const microns = micronOptions(items, l.material, '');
        const widths = widthsForLayer(items, { material: l.material, specialty: '', microns: l.microns });
        return (
          <div className="g3" key={i} style={{ marginBottom: 6 }}>
            <Pick label={`${LAYER_LABELS[i]} Substrate`} value={l.material} options={materials} disabled={disabled}
              ariaLabel={`${LAYER_LABELS[i]} Substrate`}
              placeholder={pool.length ? '— select —' : '— nothing under film or paper yet —'}
              onChange={(v) => setLayer(i, { material: v, microns: '', widthMm: '' })} />
            <Pick label="Micron" value={l.microns} options={microns} disabled={disabled || !l.material}
              ariaLabel={`${LAYER_LABELS[i]} Micron`}
              onChange={(v) => setLayer(i, { microns: v, widthMm: '' })} />
            <Pick label="Film width (mm)" value={l.widthMm} options={widths.map(String)} disabled={disabled || !l.material}
              ariaLabel={`${LAYER_LABELS[i]} Film width`}
              placeholder={l.material && !widths.length ? '— no width stocked —' : '— select —'}
              onChange={(v) => setLayer(i, { widthMm: v })} />
          </div>
        );
      })}
      <div style={{ fontSize: 10, color: 'var(--i3)' }}>
        Leave the secondary and third blank for a monolayer. A width you need but cannot see
        is one the Super Admin has not added to the Item Master yet.
      </div>
    </div>
  );
}
