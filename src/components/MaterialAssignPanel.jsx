import { useCallback, useEffect, useMemo, useState } from 'react';
import { storesApi } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { bomMaterialForSOByDept, hasBOM, plannedBomMap } from '../lib/bom.js';
import { useData } from '../data.jsx';

// Assigning material to a sale order, from the PLAN login.
//
// Issues in BOM calculations (24 Sep 2026): "the material that is available, based
// on the BOM that has been added by the QC login, should populate the department and
// the BOM item name should be populating. If at all the material is available in the
// stores, then allocation roll-wise should happen here."
//
// So this is no longer a bare list of free rolls. It is the ORDER'S OWN BILL OF
// MATERIALS — every line the QC's BOM names, under the department that consumes it,
// with the quantity that order needs. That quantity is the recipe scaled to the
// order: a BOM written for 10,000 pouches asked for by an order of 1,00,000 needs
// ten times the material, and the factor is printed so it can be checked at a glance.
//
// Against each line sit the rolls the stores actually hold of that item, oldest
// first — the order they appear in IS the FIFO instruction. A roll promised here
// stops being offered to any other order, and Stores can no longer issue it
// elsewhere.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const qty = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const rt = { textAlign: 'right' };

/**
 * One BOM line: what the order needs of it, what is already promised, and the rolls
 * it can be promised from.
 *
 * Declared at module scope on purpose. Nested inside the panel it would be a fresh
 * component type on every render, React would remount it on each keystroke, and the
 * quantity box would keep only the first character typed into it.
 */
function Line({ it, so, held, rolls, pick, setPickFor, busy, onAssign, onRelease }) {
  const code = String(it.itemCode || '').trim().toUpperCase();
  const assigned = held.reduce((t, h) => t + num(h.qty), 0);
  const onHand = rolls.reduce((t, u) => t + num(u.free), 0);
  const short = Math.max(0, num(it.required) - assigned);
  const p = pick || { unitId: '', qty: '' };
  const chosen = rolls.find((u) => String(u.unitId) === String(p.unitId));
  return (
    <>
      <tr>
        <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{it.itemCode || '—'}</td>
        <td style={{ fontSize: 11 }}>{it.itemDescription || '—'}</td>
        <td style={{ fontSize: 11 }}>{[it.materialType, it.subGroup].filter(Boolean).join(' · ') || '—'}</td>
        <td style={{ ...rt, fontWeight: 700 }}>{qty(it.required)} {it.uom || ''}</td>
        <td style={{ ...rt, color: assigned > 0 ? 'var(--g)' : undefined }}>{assigned ? qty(assigned) : '—'}</td>
        <td style={{ ...rt, color: short > 0 ? '#B7770D' : 'var(--g)' }}>{short > 0 ? qty(short) : '✓'}</td>
        <td style={rt}>{onHand > 0
          ? <>{qty(onHand)} <span style={{ color: 'var(--i3)', fontSize: 10 }}>({rolls.length} roll{rolls.length === 1 ? '' : 's'})</span></>
          : <span style={{ color: 'var(--red)' }}>none in stores</span>}</td>
        <td>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={p.unitId} aria-label={`Rolls of ${it.itemCode} for ${so}`}
              onChange={(e) => setPickFor(code, { unitId: e.target.value })}
              style={{ height: 26, fontSize: 11, minWidth: 200 }} disabled={!rolls.length}>
              <option value="">{rolls.length ? '— free rolls, oldest first —' : '— nothing free —'}</option>
              {rolls.map((u, i) => (
                <option key={u.unitId} value={u.unitId}>
                  {i === 0 ? '① ' : ''}{u.internalCode} · {qty(u.free)} {u.uom || ''}{u.widthMm ? ` · ${qty(u.widthMm)}mm` : ''}{u.location ? ` · ${u.location}` : ''}
                </option>
              ))}
            </select>
            <input type="number" step="any" min="0" className="nospin" value={p.qty}
              aria-label={`Quantity of ${it.itemCode} for ${so}`}
              placeholder={chosen ? `max ${qty(chosen.free)}` : 'qty'}
              onChange={(e) => setPickFor(code, { qty: e.target.value })} style={{ width: 90, height: 26, fontSize: 11 }} />
            <button className="btn btn-g" style={{ height: 26, fontSize: 11 }} disabled={busy || !rolls.length}
              aria-label={`Assign ${it.itemCode} to ${so}`} onClick={() => onAssign(code)}>Assign</button>
          </div>
        </td>
      </tr>
      {held.map((h) => (
        <tr key={h.id} style={{ background: 'var(--gl)' }}>
          <td />
          <td colSpan={5} style={{ fontSize: 11 }}>
            <span className="tag tg" style={{ fontSize: 9 }}>assigned</span>{' '}
            <strong style={{ fontFamily: 'monospace' }}>{h.internalCode}</strong>
            {h.location ? ` · ${h.location}` : ''}{h.widthMm ? ` · ${qty(h.widthMm)}mm` : ''}
          </td>
          <td style={{ ...rt, fontWeight: 700 }}>{qty(h.qty)} {h.uom || ''}</td>
          <td>
            <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px', color: 'var(--red)' }}
              disabled={busy} aria-label={`Release ${h.internalCode} from ${so}`} onClick={() => onRelease(h.id)}>✕ Release</button>
          </td>
        </tr>
      ))}
    </>
  );
}

export default function MaterialAssignPanel({ so, spec, material, soQty, onChange }) {
  const { mods } = useData();
  const planned = useApi('/api/bom');
  const bom = useMemo(
    () => ({ ...(mods.bom || {}), ...plannedBomMap(planned.data) }),
    [mods.bom, planned.data],
  );

  const [held, setHeld] = useState([]);
  const [free, setFree] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState({});          // itemCode -> { unitId, qty }
  const [showAll, setShowAll] = useState(false); // rolls beyond the BOM's own items

  const load = useCallback(async () => {
    setErr('');
    try {
      const [a, u] = await Promise.all([storesApi.allocations(so), storesApi.available()]);
      setHeld(Array.isArray(a) ? a : []);
      setFree(Array.isArray(u) ? u : []);
    } catch (e) { setErr(e.message || 'Could not read the stores position'); }
  }, [so]);
  useEffect(() => { load(); }, [load]);

  // The BOM, scaled to THIS order. `soQty` is the order's balance — what is still to
  // be made — so the material asked for is the material still to be consumed.
  const rec = bom && bom[spec];
  const baseQty = num(rec && rec.baseQty);
  const factor = baseQty > 0 ? num(soQty) / baseQty : 0;
  const departments = useMemo(
    () => (hasBOM(bom, spec) ? bomMaterialForSOByDept(bom, spec, num(soQty)) : []),
    [bom, spec, soQty],
  );

  const heldByItem = useMemo(() => {
    const m = new Map();
    held.forEach((h) => {
      const k = String(h.itemCode || '').trim().toUpperCase();
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(h);
    });
    return m;
  }, [held]);

  const freeByItem = useMemo(() => {
    const m = new Map();
    free.forEach((u) => {
      const k = String(u.itemCode || '').trim().toUpperCase();
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(u);
    });
    return m;
  }, [free]);

  const bomCodes = useMemo(
    () => new Set(departments.flatMap((d) => d.items.map((i) => String(i.itemCode || '').trim().toUpperCase()))),
    [departments],
  );
  // Anything assigned that the BOM does not name — an older allocation, or a
  // deliberate substitution. It is shown rather than hidden.
  const extraHeld = useMemo(
    () => held.filter((h) => !bomCodes.has(String(h.itemCode || '').trim().toUpperCase())),
    [held, bomCodes],
  );

  const setPickFor = (code, patch) => setPick((p) => ({ ...p, [code]: { ...(p[code] || { unitId: '', qty: '' }), ...patch } }));

  async function assign(code) {
    const p = pick[code] || {};
    if (!p.unitId || num(p.qty) <= 0) { setErr(`Pick a roll and the quantity for ${code}.`); return; }
    setBusy(true); setErr('');
    try {
      await storesApi.allocate({ so, unitId: Number(p.unitId), qty: Number(p.qty) });
      setPickFor(code, { unitId: '', qty: '' });
      await load();
      if (onChange) onChange();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function release(id) {
    setBusy(true); setErr('');
    try { await storesApi.releaseAllocation(id); await load(); if (onChange) onChange(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8, padding: '10px 12px' }}>
      {err && <div className="al al-r" style={{ margin: '4px 0' }}>{err}</div>}

      {!hasBOM(bom, spec) ? (
        <div className="al al-y" style={{ fontSize: 12 }}>
          <strong>No BOM saved for {spec || 'this spec'}.</strong> The material this order needs comes from the
          bill of materials the QC login attaches to the spec — until it is there, nothing can be worked out or
          allocated. Ask QC to add it under <em>Route and BOM</em>.
        </div>
      ) : (
        <>
          <div className="pg-sub" style={{ marginTop: 0 }} aria-label="BOM scale">
            The BOM for <strong>{spec}</strong> is written for <strong>{qty(baseQty)} {rec.baseUOM || ''}</strong>;
            this order has <strong>{qty(soQty)}</strong> still to make — so every line below is the recipe
            <strong> × {factor ? factor.toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '—'}</strong>.
          </div>

          {departments.map((d) => (
            <div key={d.department} style={{ marginBottom: 10 }}>
              <div className="ctitle" style={{ fontSize: 11, margin: '8px 0 2px' }}>
                {d.department}
                <span className="tag tb" style={{ marginLeft: 8, fontSize: 9 }}>
                  {Object.entries(d.totals).map(([u, v]) => `${qty(v)} ${u}`).join(' · ')}
                </span>
              </div>
              <div className="tw"><table aria-label={`Material for ${so} — ${d.department}`}>
                <thead><tr>
                  <th>Item</th><th>Description</th><th>Material</th>
                  <th style={rt}>Needs</th><th style={rt}>Assigned</th><th style={rt}>Still to assign</th>
                  <th style={rt}>In stores</th><th style={{ minWidth: 330 }}>Assign a roll</th>
                </tr></thead>
                <tbody>{d.items.map((it) => {
                  const code = String(it.itemCode || '').trim().toUpperCase();
                  return (
                    <Line key={it.itemCode || it.itemDescription} it={it} so={so}
                      held={heldByItem.get(code) || []} rolls={freeByItem.get(code) || []}
                      pick={pick[code]} setPickFor={setPickFor} busy={busy}
                      onAssign={assign} onRelease={release} />
                  );
                })}</tbody>
              </table></div>
            </div>
          ))}
        </>
      )}

      {extraHeld.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div className="ctitle" style={{ fontSize: 11, margin: '4px 0 2px' }}>Also assigned to this order (not on the BOM)</div>
          <div className="tw"><table>
            <thead><tr><th>Roll</th><th>Item</th><th>Location</th><th style={rt}>Assigned</th><th style={{ width: 90 }}></th></tr></thead>
            <tbody>
              {extraHeld.map((h) => (
                <tr key={h.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{h.internalCode}</td>
                  <td style={{ fontSize: 11 }}>{h.itemCode}</td>
                  <td style={{ fontSize: 11 }}>{h.location || '—'}</td>
                  <td style={{ ...rt, fontWeight: 700 }}>{qty(h.qty)} {h.uom || ''}</td>
                  <td><button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px', color: 'var(--red)' }}
                    disabled={busy} aria-label={`Release ${h.internalCode} from ${so}`} onClick={() => release(h.id)}>✕ Release</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {/* Anything else in the racks — for a substitution the BOM does not name. */}
      <div style={{ marginTop: 6 }}>
        <label className="cb" style={{ fontSize: 11 }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)}
            aria-label={`Assign something not on the BOM for ${so}`} />
          <span>assign something the BOM does not name{material ? ` (this spec runs on ${material})` : ''}</span>
        </label>
        {showAll && <OffBomAssign so={so} free={free} busy={busy} onAssigned={async () => { await load(); if (onChange) onChange(); }} setErr={setErr} />}
      </div>

      <div className="pg-sub" style={{ margin: '4px 0 0' }}>
        Rolls are listed oldest first — take the one marked ①. A roll assigned here stops being offered to any
        other order, and Stores can no longer issue it to one.
      </div>
    </div>
  );
}

/** The escape hatch: any roll in the racks, when the BOM does not name what is being used. */
function OffBomAssign({ so, free, busy, onAssigned, setErr }) {
  const [unitId, setUnitId] = useState('');
  const [q, setQ] = useState('');
  const chosen = free.find((u) => String(u.unitId) === String(unitId));
  async function go() {
    if (!unitId || num(q) <= 0) { setErr('Pick a roll and the quantity to assign.'); return; }
    try {
      await storesApi.allocate({ so, unitId: Number(unitId), qty: Number(q) });
      setUnitId(''); setQ('');
      await onAssigned();
    } catch (e) { setErr(e.message); }
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
      <select value={unitId} onChange={(e) => setUnitId(e.target.value)} aria-label={`Any free roll for ${so}`}
        style={{ height: 28, minWidth: 320, fontSize: 11 }}>
        <option value="">— every free roll, oldest first —</option>
        {free.map((u, i) => (
          <option key={u.unitId} value={u.unitId}>
            {i === 0 ? '① ' : ''}{u.internalCode} · {u.itemCode} · {qty(u.free)} {u.uom || ''}{u.widthMm ? ` · ${qty(u.widthMm)}mm` : ''}
          </option>
        ))}
      </select>
      <input type="number" step="any" min="0" className="nospin" value={q} onChange={(e) => setQ(e.target.value)}
        aria-label={`Quantity of any roll for ${so}`} placeholder={chosen ? `max ${qty(chosen.free)}` : 'qty'}
        style={{ width: 100, height: 28 }} />
      <button className="btn btn-s" style={{ height: 28 }} disabled={busy} onClick={go}>Assign anyway</button>
    </div>
  );
}
