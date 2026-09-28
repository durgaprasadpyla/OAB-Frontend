import { useEffect, useMemo } from 'react';
import { useApi } from '../lib/useApi.js';
import { custsInGroup } from '../lib/master.js';
import {
  blankLayer, filmWidthOptions, isLaminateJobType, layerCountFor, materialOptions,
  micronOptions, specialtyOptions, structureFromLayers, gussetParts, gussetJoin,
  isStayFreshJobType,
} from '../lib/jssSpec.js';

// The JSS specification form — the ONE form, used by QC to create a spec and by the
// Super Admin to edit one (JSS+QC LOGIN §24: "I should be able to edit all the
// existing JSS from the super admin login based on the above criteria").
//
// Everything is a dropdown over something the business already maintains. QC types
// the Job Name and nothing else: no new customer, no new group, no invented film.
// The material layers and the film width come from the ITEM MASTER, and each choice
// narrows the next — pick CC PET and the speciality list is CC PET's specialities,
// the micron list is CC PET's microns, and the film widths offered are the widths
// EVERY layer of the laminate is actually stocked in.

const val = (e) => e.target.value;

/** One labelled control. */
function Fg({ label, required, hint, children, width }) {
  return (
    <div className="fg" style={width ? { maxWidth: width } : undefined}>
      <label>{label}{required ? ' *' : ''}</label>
      {children}
      {hint ? <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

/** A select that always offers what the record already holds, even if it left the master. */
function Pick({ label, value, onChange, options, required, placeholder = '— select —', hint, disabled, ariaLabel }) {
  const v = String(value == null ? '' : value);
  const inList = !v || options.some((o) => String(o) === v);
  return (
    <Fg label={label} required={required} hint={hint}>
      <select value={v} onChange={onChange} disabled={disabled} aria-label={ariaLabel || label}>
        <option value="">{placeholder}</option>
        {!inList && <option value={v}>{v} (not in the master)</option>}
        {options.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </select>
    </Fg>
  );
}

function Num({ label, value, onChange, required, hint, ariaLabel, placeholder }) {
  return (
    <Fg label={label} required={required} hint={hint}>
      <input type="number" step="any" className="nospin" value={value ?? ''} placeholder={placeholder}
        aria-label={ariaLabel || label} onChange={onChange} />
    </Fg>
  );
}

/**
 * @param form      the spec being edited — { group, customer, subBrand, jobName, dispatchForm,
 *                  jobType, layers: [{material,specialty,microns} ×3], filmWidth, ups, width,
 *                  height, gussetA, gussetB, gsm, pouchWeight, qtyPerBag, status }
 * @param onChange  (patch) => void
 * @param canAddNew super admin may still type a group / customer / sub-brand; QC may not
 */
export default function SpecFields({
  form, onChange, customers = [], jss = [], jobTypes = [], dispatchOptions = [], statuses = [],
  canAddNew = false, specCode = '', showStatus = true, items: itemsProp = null,
}) {
  // The item master, readable by every signed-in role (no pricing on it).
  const fetched = useApi(itemsProp ? '' : '/api/master/items');
  const items = useMemo(
    () => (itemsProp || (Array.isArray(fetched.data) ? fetched.data : [])),
    [itemsProp, fetched.data],
  );

  const set = (patch) => onChange(patch);
  const layers = form.layers && form.layers.length === 3 ? form.layers : [blankLayer(), blankLayer(), blankLayer()];
  const setLayer = (i, patch) => set({ layers: layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const groups = useMemo(() => {
    const out = new Set();
    (customers || []).forEach((c) => { const g = String((c && c.group) || '').trim(); if (g) out.add(g); });
    (jss || []).forEach((j) => { const g = String((j && j.group) || '').trim(); if (g) out.add(g); });
    return [...out].sort((a, b) => a.localeCompare(b));
  }, [customers, jss]);

  const custOptions = useMemo(() => {
    const fromMaster = custsInGroup(customers, form.group);
    if (fromMaster.length) return fromMaster;
    const names = new Set();
    (jss || []).forEach((j) => {
      const c = String((j && j.customer) || '').trim();
      if (c && (!form.group || String(j.group || '').trim() === form.group)) names.add(c);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [customers, jss, form.group]);

  // §13: "Sub-brand should be there but it should not be editable by the QC. If for a
  // particular customer and group selection there are any sub-brands, they will be
  // available for the QC to select in the dropdown." They live on the specs already
  // written for that customer / group.
  const subBrands = useMemo(() => {
    const out = new Set();
    (jss || []).forEach((j) => {
      const sb = String((j && j.subBrand) || '').trim();
      if (!sb) return;
      const sameCust = form.customer && String(j.customer || '').trim() === form.customer;
      const sameGroup = form.group && String(j.group || '').trim() === form.group;
      if (sameCust || sameGroup || (!form.customer && !form.group)) out.add(sb);
    });
    return [...out].sort((a, b) => a.localeCompare(b));
  }, [jss, form.customer, form.group]);

  const layerN = layerCountFor(form.jobType);
  const laminate = isLaminateJobType(form.jobType);
  // A job type that stops being a laminate must not leave layers 2 and 3 behind.
  useEffect(() => {
    if (laminate) return;
    if (layers[1].material || layers[2].material) set({ layers: [layers[0], blankLayer(), blankLayer()] });
  }, [laminate]); // eslint-disable-line react-hooks/exhaustive-deps

  const materials = useMemo(() => materialOptions(items), [items]);
  const width = useMemo(() => filmWidthOptions(items, layers.slice(0, layerN)), [items, layers, layerN]);
  const missingWidths = width.partial;
  const structure = structureFromLayers(layers.slice(0, layerN));
  const g = gussetParts(form.gusset);

  const layerLabel = ['Primary', 'Secondary', 'Third'];

  return (
    <>
      <div className="g4">
        {specCode ? <Fg label="Spec Code"><input value={specCode} readOnly aria-label="Spec Code" /></Fg> : null}
        <Pick label="Group" value={form.group} options={groups}
          placeholder={canAddNew ? '— No group —' : '— select group —'}
          onChange={(e) => set({ group: val(e), customer: '', subBrand: '' })} />
        <Pick label="Customer" value={form.customer} options={custOptions} required
          onChange={(e) => set({ customer: val(e), subBrand: '' })}
          hint={custOptions.length ? '' : 'No customers under this group — the Super Admin adds them in the Customer Master.'} />
        <Pick label="Sub Brand" value={form.subBrand} options={subBrands}
          placeholder={subBrands.length ? '— none —' : '— none on file for this customer —'}
          disabled={!canAddNew && subBrands.length === 0}
          hint={canAddNew ? '' : 'Set by the Super Admin; QC picks from the sub-brands this customer already has.'}
          onChange={(e) => set({ subBrand: val(e) })} />
      </div>

      <div className="g4">
        <Fg label="Job Name" required>
          <input value={form.jobName ?? ''} aria-label="Job Name" onChange={(e) => set({ jobName: val(e) })}
            placeholder="what this job is called" />
        </Fg>
        <Pick label="Dispatch Form" value={form.dispatchForm} options={dispatchOptions} required
          onChange={(e) => set({ dispatchForm: val(e) })} />
        <Pick label="Job Type" value={form.jobType} options={jobTypes} required
          onChange={(e) => set({ jobType: val(e) })}
          hint={form.jobType
            ? `${isStayFreshJobType(form.jobType) ? 'Stay Fresh OAB' : 'Others OAB'}${laminate ? ' · laminate — second and third layers enabled' : ''}`
            : 'Set by the Super Admin under Drop-down selections.'} />
        {showStatus
          ? <Pick label="Status" value={form.status} options={statuses} onChange={(e) => set({ status: val(e) })} placeholder="Active" />
          : <div className="fg" />}
      </div>

      {/* ── the material layers, all from the item master ──────────────────── */}
      <div className="ctitle" style={{ fontSize: 11, margin: '6px 0 2px' }}>
        STRUCTURE
        {structure ? <span className="tag tb" style={{ marginLeft: 8, fontSize: 9 }}>{structure}</span> : null}
      </div>
      {materials.length === 0 && (
        <div className="al al-y" style={{ fontSize: 11 }}>
          No FILM or PAPER items in the Item Master yet — the material dropdowns fill once the Super Admin adds them.
        </div>
      )}
      {[0, 1, 2].slice(0, layerN).map((i) => {
        const l = layers[i];
        const specialties = specialtyOptions(items, l.material);
        const microns = micronOptions(items, l.material, l.specialty);
        return (
          <div className="g4" key={i}>
            <Pick label={`${layerLabel[i]} Material`} value={l.material} options={materials} required={i === 0}
              ariaLabel={`${layerLabel[i]} Material`}
              onChange={(e) => setLayer(i, { material: val(e), specialty: '', microns: '' })} />
            <Pick label={`${layerLabel[i]} Speciality`} value={l.specialty} options={specialties}
              ariaLabel={`${layerLabel[i]} Speciality`} disabled={!l.material}
              placeholder={l.material && specialties.length === 0 ? '— none recorded —' : '— select —'}
              onChange={(e) => setLayer(i, { specialty: val(e), microns: '' })} />
            <Pick label={`${layerLabel[i]} Micron`} value={l.microns} options={microns}
              ariaLabel={`${layerLabel[i]} Micron`} disabled={!l.material}
              placeholder={l.material && microns.length === 0 ? '— none recorded —' : '— select —'}
              onChange={(e) => setLayer(i, { microns: val(e) })} />
            <div className="fg" />
          </div>
        );
      })}

      <div className="g4">
        <Pick label="Film Width (mm)" value={form.filmWidth} options={width.widths} required
          onChange={(e) => set({ filmWidth: val(e) })}
          placeholder={layers[0].material
            ? (width.widths.length ? '— select —' : '— no width stocked in every layer —')
            : '— pick the primary material first —'}
          hint={width.widths.length ? 'Widths stocked in every layer of this structure.' : ''} />
        <Num label="Ups" value={form.ups} onChange={(e) => set({ ups: val(e) })} />
        <Num label="GSM" value={form.gsm} onChange={(e) => set({ gsm: val(e) })} />
        <div className="fg" />
      </div>

      {missingWidths.length > 0 && (
        <div className="al al-y" style={{ fontSize: 11 }} aria-label="Film width not in every layer">
          <strong>These widths are stocked for some layers but not all</strong> — ask the Super Admin to add the
          missing item to the Item Master before specifying the job:{' '}
          {missingWidths.slice(0, 6).map((w) => `${w.width} mm (missing in ${w.missing.join(', ')})`).join('; ')}
          {missingWidths.length > 6 ? ' …' : ''}
        </div>
      )}

      <div className="g4">
        <Num label="SKU Width (mm)" value={form.width} onChange={(e) => set({ width: val(e) })} />
        <Num label="SKU Height (mm)" value={form.height} onChange={(e) => set({ height: val(e) })} />
        <Fg label="Gusset (A + B)" hint="A and B are the two gusset panels — leave B blank for a single gusset.">
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="number" step="any" className="nospin" value={g.a} aria-label="Gusset A"
              onChange={(e) => set({ gusset: gussetJoin(val(e), g.b) })} style={{ flex: 1, minWidth: 0 }} />
            <span style={{ fontWeight: 700, flexShrink: 0 }}>+</span>
            <input type="number" step="any" className="nospin" value={g.b} aria-label="Gusset B"
              onChange={(e) => set({ gusset: gussetJoin(g.a, val(e)) })} style={{ flex: 1, minWidth: 0 }} />
          </div>
        </Fg>
        <Num label="Qty per Bag (packing)" value={form.qtyPerBag} onChange={(e) => set({ qtyPerBag: val(e) })} />
      </div>
    </>
  );
}
