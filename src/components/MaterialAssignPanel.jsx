import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storesApi } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { bomMaterialForSOByDept, hasBOM, plannedBomMap, NO_DEPARTMENT } from '../lib/bom.js';
import { asSoMaterial, codeKey, isComplete, netOut, sourceLabel } from '../lib/soMaterial.js';
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
//
// Issues as on 30.09 (P1): "I have issued a roll BLMU-592 from the stores, whereas it
// is not being shown as assigned in the plan login. It should be vice versa too."
// An allocation is a PROMISE (a hold on a roll); an issue is the delivery, and the
// stores desk deletes the hold as it issues. Reading the holds alone, PLAN never saw a
// roll the stores issued straight to the order, and watched an issued roll drop back
// to "still to assign". Each line now shows what is Allocated (and who allocated it —
// PLAN or the stores desk) and what has been Issued, and a line whose BOM quantity
// is covered by the two together takes no more (S3).

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const qty = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const rt = { textAlign: 'right' };
const rtWrap = { textAlign: 'right', whiteSpace: 'normal' };   // a header may wrap inside its fixed column
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// 30.09: one table for every department, its columns fixed by ONE colgroup. Each
// department used to be its own table sized to its own content, so "Needs" under
// Printing and "Needs" under Lamination stood at different places down the page —
// the same fault the client reported on the Super Admin's Raw Material tables.
// The description takes whatever width is left.
const COL_WIDTHS = [86, null, 130, 100, 86, 86, 96, 112, 336];
const NCOLS = COL_WIDTHS.length;

/** Group rows by item code. */
function byItem(rows) {
  const m = new Map();
  rows.forEach((r) => {
    const k = codeKey(r.itemCode);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  });
  return m;
}

/**
 * The rows of one item that belong under one of its departments: those booked for
 * that department, and — under the item's first department — any that name no
 * department of the BOM (older rows carry none at all).
 */
function rowsForDept(rows, dept, itemDepts) {
  return rows.filter((r) => (r.department
    ? same(r.department, dept) || (same(dept, itemDepts[0]) && !itemDepts.some((d) => same(d, r.department)))
    : same(dept, itemDepts[0])));
}

/**
 * One BOM line: what the order needs of it, what is already allocated and issued,
 * and the rolls it can be promised from.
 *
 * Declared at module scope on purpose. Nested inside the panel it would be a fresh
 * component type on every render, React would remount it on each keystroke, and the
 * quantity box would keep only the first character typed into it.
 */
function Line({ it, so, needs, held, issued, rolls, pick, setPickFor, busy, covered, onAssign, onRelease }) {
  const code = codeKey(it.itemCode);
  const allocated = held.reduce((t, h) => t + num(h.qty), 0);
  const out = issued.reduce((t, l) => t + netOut(l), 0);
  const onHand = rolls.reduce((t, u) => t + num(u.free), 0);
  const short = Math.max(0, num(needs) - allocated - out);
  const p = pick || { unitId: '', qty: '' };
  const chosen = rolls.find((u) => String(u.unitId) === String(p.unitId));
  return (
    <>
      <tr>
        <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{it.itemCode || '—'}</td>
        <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{it.itemDescription || '—'}</td>
        <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{[it.materialType, it.subGroup].filter(Boolean).join(' · ') || '—'}</td>
        <td style={{ ...rt, fontWeight: 700 }}>{qty(needs)} {it.uom || ''}</td>
        <td style={{ ...rt, color: allocated > 0 ? 'var(--g)' : undefined }}>{allocated ? qty(allocated) : '—'}</td>
        <td style={{ ...rt, color: out > 0 ? '#1e7e34' : undefined, fontWeight: out > 0 ? 700 : undefined }}>{out ? qty(out) : '—'}</td>
        <td style={{ ...rt, color: short > 0 ? '#B7770D' : '#1e7e34' }}>{short > 0 ? qty(short) : '✓'}</td>
        <td style={rt}>{onHand > 0
          ? <>{qty(onHand)} <span style={{ color: 'var(--i3)', fontSize: 10 }}>({rolls.length} roll{rolls.length === 1 ? '' : 's'})</span></>
          : <span style={{ color: 'var(--red)' }}>none in stores</span>}</td>
        <td>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <select value={p.unitId} aria-label={`Rolls of ${it.itemCode} for ${so}`}
              // the box is prefilled with what the roll has free: a roll is promised whole
              // unless the planner says otherwise
              onChange={(e) => {
                const u = rolls.find((r) => String(r.unitId) === String(e.target.value));
                setPickFor(code, { unitId: e.target.value, qty: u ? String(num(u.free)) : '' });
              }}
              style={{ height: 26, fontSize: 11, flex: 1, minWidth: 0 }} disabled={!rolls.length}>
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
              onChange={(e) => setPickFor(code, { qty: e.target.value })} style={{ width: 80, height: 26, fontSize: 11, flex: 'none' }} />
            {/* S3: once allocated + issued covers what the BOM needs for the order, the
                line takes no more — the server refuses it too. */}
            <button className="btn btn-g" style={{ height: 26, fontSize: 11, padding: '0 9px' }} disabled={busy || !rolls.length || covered}
              title={covered ? `What is allocated and issued already covers what the BOM of ${so} needs of ${it.itemCode}` : undefined}
              aria-label={`Assign ${it.itemCode} to ${so}`} onClick={() => onAssign(code, it.department)}>
              {covered ? '✓ BOM covered' : 'Assign'}
            </button>
          </div>
        </td>
      </tr>
      {held.map((h) => (
        <tr key={'a' + h.id} style={{ background: 'var(--gl)' }}>
          <td />
          <td colSpan={3} style={{ fontSize: 11, whiteSpace: 'normal' }}>
            <span className="tag tg" style={{ fontSize: 9 }}>{sourceLabel(h.source) ? `allocated · ${sourceLabel(h.source)}` : 'allocated'}</span>{' '}
            <strong style={{ fontFamily: 'monospace' }}>{h.internalCode}</strong>
            {h.location ? ` · ${h.location}` : ''}{h.widthMm ? ` · ${qty(h.widthMm)}mm` : ''}
            {h.department ? ` · for ${h.department}` : ''}
            {h.actor ? <span style={{ color: 'var(--i3)' }}> · by {h.actor}</span> : null}
          </td>
          <td style={{ ...rt, fontWeight: 700 }}>{qty(h.qty)} {h.uom || ''}</td>
          <td colSpan={3} />
          <td>
            <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px', color: 'var(--red)' }}
              disabled={busy} aria-label={`Release ${h.internalCode} from ${so}`} onClick={() => onRelease(h.id)}>✕ Release</button>
          </td>
        </tr>
      ))}
      {/* what has actually gone out to the floor — delivered, so there is nothing to release */}
      {issued.map((l) => (
        <tr key={'i' + (l.txnId ?? l.lineNo)} style={{ background: '#f3faf5' }}>
          <td />
          <td colSpan={3} style={{ fontSize: 11, whiteSpace: 'normal' }}>
            <span className="tag" style={{ fontSize: 9, background: '#e6f4ea', color: '#1e7e34' }}>issued</span>{' '}
            <strong style={{ fontFamily: 'monospace' }}>{l.internalCode}</strong>
            {l.lineNo ? ` · ${l.lineNo}` : ''}{l.department ? ` · to ${l.department}` : ''}
            {num(l.qtyReturned) > 0 ? <span style={{ color: 'var(--i3)' }}> · {qty(l.qtyReturned)} came back</span> : null}
            {l.ts ? <span style={{ color: 'var(--i3)' }}> · {String(l.ts).slice(0, 10)}</span> : null}
          </td>
          <td />
          <td style={{ ...rt, fontWeight: 700, color: '#1e7e34' }}>{qty(netOut(l))} {l.uom || ''}</td>
          <td colSpan={3} />
        </tr>
      ))}
    </>
  );
}

/**
 * `soQty` is the ORDER quantity (the PO qty), not the balance still to make: what
 * has been issued against an order is a lifetime figure, so the requirement it is
 * measured against has to be one too — and the stores desk and the server cap
 * reckon on the same number.
 */
export default function MaterialAssignPanel({ so, spec, material, soQty, onChange }) {
  const { mods } = useData();
  const planned = useApi('/api/bom');
  const bom = useMemo(
    () => ({ ...(mods.bom || {}), ...plannedBomMap(planned.data) }),
    [mods.bom, planned.data],
  );

  const [mat, setMat] = useState(null);          // the server's /so-material position, when it has one
  const [held, setHeld] = useState([]);
  const [issued, setIssued] = useState([]);
  const [free, setFree] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState({});          // itemCode -> { unitId, qty }
  const [showAll, setShowAll] = useState(false); // rolls beyond the BOM's own items

  // Only the newest read lands: a slower answer for an order the panel has moved off
  // (or an earlier read of this one) must not overwrite the current position.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const current = () => seq === loadSeq.current;
    setErr('');
    try {
      const [m, u] = await Promise.all([
        storesApi.soMaterial(so).then(asSoMaterial).catch(() => null),
        storesApi.available(),
      ]);
      // An older server has no /so-material: the holds alone, as before.
      const a = m ? m.allocations : await storesApi.allocations(so);
      if (!current()) return;
      setMat(m);
      setHeld(Array.isArray(a) ? a : []);
      setIssued(m ? m.issues.filter((l) => netOut(l) > 0) : []);
      setFree(Array.isArray(u) ? u : []);
    } catch (e) { if (current()) setErr(e.message || 'Could not read the stores position'); }
  }, [so]);
  // A different order: nothing of the last one's position stays on screen meanwhile.
  useEffect(() => { setMat(null); setHeld([]); setIssued([]); setPick({}); }, [so]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { loadSeq.current += 1; }, []);

  // The BOM, scaled to THIS order — its PO quantity.
  const rec = bom && bom[spec];
  const baseQty = num(rec && rec.baseQty);
  const factor = baseQty > 0 ? num(soQty) / baseQty : 0;
  const departments = useMemo(
    () => (hasBOM(bom, spec) ? bomMaterialForSOByDept(bom, spec, num(soQty)) : []),
    [bom, spec, soQty],
  );

  const heldByItem = useMemo(() => byItem(held), [held]);
  const issuedByItem = useMemo(() => byItem(issued), [issued]);
  const freeByItem = useMemo(() => byItem(free), [free]);
  const matByItem = useMemo(() => new Map(((mat && mat.lines) || []).map((l) => [codeKey(l.itemCode), l])), [mat]);

  /** code -> the departments its BOM lines sit under, in route order. */
  const deptsOfItem = useMemo(() => {
    const m = new Map();
    departments.forEach((d) => d.items.forEach((i) => {
      const k = codeKey(i.itemCode);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(d.department);
    }));
    return m;
  }, [departments]);

  /**
   * Whether an item's BOM quantity is covered — the server's figure when it sent one
   * (the rule it enforces), otherwise the same sum done here: what the BOM needs for
   * the order against what is allocated and issued.
   */
  const coveredItem = (code) => {
    const line = matByItem.get(code);
    if (line) return line.complete != null ? !!line.complete : isComplete(line);
    const required = departments.flatMap((d) => d.items).filter((i) => codeKey(i.itemCode) === code)
      .reduce((t, i) => t + num(i.required), 0);
    const have = (heldByItem.get(code) || []).reduce((t, h) => t + num(h.qty), 0)
      + (issuedByItem.get(code) || []).reduce((t, l) => t + netOut(l), 0);
    return required > 0 && have + 1e-9 >= required;
  };

  const bomCodes = useMemo(() => new Set(deptsOfItem.keys()), [deptsOfItem]);
  // Anything allocated or issued that the BOM does not name — an older allocation, or
  // a deliberate substitution. It is shown rather than hidden.
  const extraHeld = useMemo(() => held.filter((h) => !bomCodes.has(codeKey(h.itemCode))), [held, bomCodes]);
  const extraIssued = useMemo(() => issued.filter((l) => !bomCodes.has(codeKey(l.itemCode))), [issued, bomCodes]);

  const setPickFor = (code, patch) => setPick((p) => ({ ...p, [code]: { ...(p[code] || { unitId: '', qty: '' }), ...patch } }));

  async function assign(code, department) {
    const p = pick[code] || {};
    if (!p.unitId || num(p.qty) <= 0) { setErr(`Pick a roll and the quantity for ${code}.`); return; }
    setBusy(true); setErr('');
    try {
      // the department the BOM line sits under travels with the hold, so the stores
      // desk puts the roll on the right department's slip
      await storesApi.allocate({
        so, unitId: Number(p.unitId), qty: Number(p.qty),
        department: department && department !== NO_DEPARTMENT ? department : undefined,
      });
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--i3)', flex: 1 }}>
          Allocated by PLAN or by the stores desk, and issued from the stores — read live.
        </span>
        <button className="btn btn-s" style={{ height: 24, fontSize: 11 }} disabled={busy}
          aria-label={`Refresh the material of ${so}`} onClick={load}>↻ Refresh</button>
      </div>

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
            this order is for <strong>{qty(soQty)}</strong> — so every line below is the recipe
            <strong> × {factor ? factor.toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '—'}</strong>.
          </div>

          <div className="tw"><table aria-label={`BOM material for ${so}`} style={{ tableLayout: 'fixed', minWidth: 1180 }}>
            <colgroup>
              {COL_WIDTHS.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}
            </colgroup>
            <thead><tr>
              <th>Item</th><th>Description</th><th>Material</th>
              <th style={rtWrap}>Needs</th><th style={rtWrap}>Allocated</th><th style={rtWrap}>Issued</th><th style={rtWrap}>Still to assign</th>
              <th style={rtWrap}>In stores</th><th>Assign a roll</th>
            </tr></thead>
            {departments.map((d) => (
              <tbody key={d.department} aria-label={`Material for ${so} — ${d.department}`}>
                <tr>
                  <td colSpan={NCOLS} style={{ background: 'var(--bg)', fontSize: 11, fontWeight: 700, color: 'var(--i2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    {d.department}
                    <span className="tag tb" style={{ marginLeft: 8, fontSize: 9, textTransform: 'none' }}>
                      {Object.entries(d.totals).map(([u, v]) => `${qty(v)} ${u}`).join(' · ')}
                    </span>
                  </td>
                </tr>
                {d.items.map((it) => {
                  const code = codeKey(it.itemCode);
                  const itemDepts = deptsOfItem.get(code) || [d.department];
                  const line = matByItem.get(code);
                  // the server's figure is per ITEM; an item the BOM uses in two
                  // departments keeps its per-department share here
                  const needs = line && line.required != null && itemDepts.length === 1 ? line.required : it.required;
                  return (
                    <Line key={it.itemCode || it.itemDescription} it={it} so={so} needs={needs}
                      held={rowsForDept(heldByItem.get(code) || [], d.department, itemDepts)}
                      issued={rowsForDept(issuedByItem.get(code) || [], d.department, itemDepts)}
                      rolls={freeByItem.get(code) || []} covered={coveredItem(code)}
                      pick={pick[code]} setPickFor={setPickFor} busy={busy}
                      onAssign={assign} onRelease={release} />
                  );
                })}
              </tbody>
            ))}
          </table></div>
        </>
      )}

      {(extraHeld.length > 0 || extraIssued.length > 0) && (
        <div style={{ marginTop: 6 }}>
          <div className="ctitle" style={{ fontSize: 11, margin: '4px 0 2px' }}>Also allocated or issued to this order (not on the BOM)</div>
          <div className="tw"><table>
            <thead><tr><th>Roll</th><th>Item</th><th>Location</th><th>How</th><th style={rt}>Qty</th><th style={{ width: 90 }}></th></tr></thead>
            <tbody>
              {extraHeld.map((h) => (
                <tr key={'a' + h.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{h.internalCode}</td>
                  <td style={{ fontSize: 11 }}>{h.itemCode}</td>
                  <td style={{ fontSize: 11 }}>{h.location || '—'}</td>
                  <td style={{ fontSize: 11 }}>
                    <span className="tag tg" style={{ fontSize: 9 }}>{sourceLabel(h.source) ? `allocated · ${sourceLabel(h.source)}` : 'allocated'}</span>
                    {h.actor ? <span style={{ color: 'var(--i3)' }}> by {h.actor}</span> : null}
                  </td>
                  <td style={{ ...rt, fontWeight: 700 }}>{qty(h.qty)} {h.uom || ''}</td>
                  <td><button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px', color: 'var(--red)' }}
                    disabled={busy} aria-label={`Release ${h.internalCode} from ${so}`} onClick={() => release(h.id)}>✕ Release</button></td>
                </tr>
              ))}
              {extraIssued.map((l) => (
                <tr key={'i' + (l.txnId ?? l.lineNo)}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{l.internalCode}</td>
                  <td style={{ fontSize: 11 }}>{l.itemCode}</td>
                  <td style={{ fontSize: 11 }}>{l.department || '—'}</td>
                  <td style={{ fontSize: 11 }}>
                    <span className="tag" style={{ fontSize: 9, background: '#e6f4ea', color: '#1e7e34' }}>issued</span>
                    {l.lineNo ? <span style={{ color: 'var(--i3)' }}> {l.lineNo}</span> : null}
                  </td>
                  <td style={{ ...rt, fontWeight: 700 }}>{qty(netOut(l))} {l.uom || ''}</td>
                  <td />
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
        other order, and Stores can no longer issue it to one. Once what is allocated and issued covers what the
        BOM needs for the order, the line takes no more (✓ BOM covered).
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
      // 30.09: the server takes an item the BOM does not name only when PLAN says so —
      // a substitution, which the stores desk may then issue to this order.
      await storesApi.allocate({ so, unitId: Number(unitId), qty: Number(q), offBom: true });
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
