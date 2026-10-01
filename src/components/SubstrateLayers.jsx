import { useEffect, useMemo, useState } from 'react';
import { masterApi } from '../api.js';
import { specItems, materialOptions, micronChoices, micronChoiceHint, widthsForLayer, micronValue } from '../lib/jssSpec.js';

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

/** Two microns as one: "35 MIC", "35mic" and "35" are the same film (micronValue). */
const sameMicron = (a, b) => (micronValue(a) || String(a ?? '').trim()) === (micronValue(b) || String(b ?? '').trim());

function Pick({ label, value, options, onChange, disabled, ariaLabel, placeholder, hint, same }) {
  // `same` compares a saved value with the options (the micron: "35 MIC" is "35"), so
  // a legacy value opens on its option instead of beside it as a stray one
  const eq = same || ((a, b) => String(a) === String(b));
  const match = value ? options.find((o) => eq(o, value)) : undefined;
  const shown = match != null ? String(match) : (value ?? '');
  return (
    <div className="fg">
      <label>{label}</label>
      <select value={shown} aria-label={ariaLabel || label} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder || '— select —'}</option>
        {/* a value saved before the master changed stays selectable */}
        {value && match == null && <option value={value}>{value}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {hint ? <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 2 }}>{hint}</div> : null}
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

  // a micron saved from the raw Item Master text ("35 MIC") is carried as the
  // normalised option ("35"), so the next change writes the clean value
  const rows = (Array.isArray(layers) && layers.length ? layers : blankSubLayers()).map((l) => {
    const mic = l && micronValue(l.microns);
    return mic && mic !== String(l.microns) ? { ...l, microns: mic } : l;
  });
  const setLayer = (i, patch) => onChange(rows.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="fg" style={{ gridColumn: '1 / -1' }}>
      <label>Structure <span style={{ fontWeight: 400, color: 'var(--i3)' }}>— from the Item Master, as on the JSS page</span></label>
      {err && <div className="al al-y" style={{ marginBottom: 6 }}>{err}</div>}
      {rows.slice(0, max).map((l, i) => {
        // 30.09 §QC: never an empty micron list while the Item Master records one —
        // the substrate's own microns, else every film / paper micron (said so below).
        const mc = micronChoices(items, l.material, '');
        const microns = mc.options;
        const widths = widthsForLayer(items, { material: l.material, specialty: '', microns: l.microns });
        return (
          <div className="g3" key={i} style={{ marginBottom: 6 }}>
            <Pick label={`${LAYER_LABELS[i]} Substrate`} value={l.material} options={materials} disabled={disabled}
              ariaLabel={`${LAYER_LABELS[i]} Substrate`}
              placeholder={pool.length ? '— select —' : '— nothing under film or paper yet —'}
              onChange={(v) => setLayer(i, { material: v, microns: '', widthMm: '' })} />
            <Pick label="Micron" value={l.microns} options={microns} disabled={disabled || !l.material} same={sameMicron}
              ariaLabel={`${LAYER_LABELS[i]} Micron`}
              placeholder={l.material && !microns.length ? '— no micron in the Item Master —' : '— select —'}
              hint={l.material && mc.basis !== 'item' ? micronChoiceHint(mc.basis, l.material, '') : ''}
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
