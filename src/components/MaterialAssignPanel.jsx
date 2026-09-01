import { useCallback, useEffect, useMemo, useState } from 'react';
import { storesApi } from '../api.js';

// Assigning material to a sale order, from the PLAN login.
//
// The planner marks an order ready to plan (entire or partial) and says which
// rolls it will run on — the film above all. Stores' free rolls are listed
// OLDEST FIRST, so the order they appear in IS the FIFO instruction: take the
// one at the top. A roll promised here is no longer offered to the next order,
// so two orders can never be planned on the same metres.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const qty = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

export default function MaterialAssignPanel({ so, spec, material, onChange }) {
  const [held, setHeld] = useState([]);
  const [free, setFree] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState({ unitId: '', qty: '' });
  const [filterFilm, setFilterFilm] = useState(true);

  const load = useCallback(async () => {
    setErr('');
    try {
      const [a, u] = await Promise.all([
        storesApi.allocations(so),
        // "especially the film": default to the spec's own material, with a tick
        // to widen the list to everything in stock.
        storesApi.available(filterFilm && material ? { material } : undefined),
      ]);
      setHeld(Array.isArray(a) ? a : []);
      setFree(Array.isArray(u) ? u : []);
    } catch (e) { setErr(e.message || 'Could not read the stores position'); }
  }, [so, material, filterFilm]);
  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => free.find((u) => String(u.unitId) === String(pick.unitId)) || null, [free, pick.unitId]);
  const totalHeld = held.reduce((t, h) => t + num(h.qty), 0);

  async function assign() {
    if (!pick.unitId || num(pick.qty) <= 0) { setErr('Pick a roll and the quantity to assign.'); return; }
    setBusy(true); setErr('');
    try {
      await storesApi.allocate({ so, unitId: Number(pick.unitId), qty: Number(pick.qty) });
      setPick({ unitId: '', qty: '' });
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
    <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8, padding: '10px 12px', marginTop: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
        Material for {so}{spec ? ` · ${spec}` : ''}
        {totalHeld > 0 && <span className="tag tg" style={{ marginLeft: 6, fontSize: 9 }}>{qty(totalHeld)} assigned</span>}
      </div>
      {err && <div className="al al-r" style={{ margin: '4px 0' }}>{err}</div>}

      {held.length > 0 && (
        <div className="tw" style={{ marginBottom: 6 }}><table>
          <thead><tr><th>Roll</th><th>Item</th><th>Location</th><th style={{ textAlign: 'right' }}>Width</th>
            <th style={{ textAlign: 'right' }}>Assigned</th><th style={{ width: 40 }}></th></tr></thead>
          <tbody>
            {held.map((h) => (
              <tr key={h.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{h.internalCode}</td>
                <td style={{ fontSize: 11 }}>{h.itemCode}</td>
                <td style={{ fontSize: 11 }}>{h.location || '—'}</td>
                <td style={{ textAlign: 'right' }}>{h.widthMm ? qty(h.widthMm) : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{qty(h.qty)} {h.uom || ''}</td>
                <td><button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px', color: 'var(--red)' }}
                  disabled={busy} aria-label={`Release ${h.internalCode} from ${so}`} onClick={() => release(h.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={pick.unitId} onChange={(e) => setPick({ ...pick, unitId: e.target.value })}
          aria-label={`Free rolls for ${so}`} style={{ height: 28, minWidth: 320 }}>
          <option value="">— free rolls, oldest first —</option>
          {free.map((u, i) => (
            <option key={u.unitId} value={u.unitId}>
              {i === 0 ? '① ' : ''}{u.internalCode} · {u.itemCode} · {qty(u.free)} {u.uom || ''}{u.widthMm ? ` · ${qty(u.widthMm)}mm` : ''}{u.location ? ` · ${u.location}` : ''}
            </option>
          ))}
        </select>
        <input type="number" step="any" min="0" value={pick.qty} onChange={(e) => setPick({ ...pick, qty: e.target.value })}
          aria-label={`Quantity to assign to ${so}`} placeholder={selected ? `max ${qty(selected.free)}` : 'qty'}
          style={{ width: 110, height: 28 }} />
        <button className="btn btn-g" style={{ height: 28 }} disabled={busy} onClick={assign}>Assign material</button>
        <label className="cb" style={{ fontSize: 11 }}>
          <input type="checkbox" checked={filterFilm} onChange={(e) => setFilterFilm(e.target.checked)}
            aria-label={`Only this spec's material for ${so}`} />
          <span>only this spec&rsquo;s material{material ? ` (${material})` : ''}</span>
        </label>
      </div>
      <div className="pg-sub" style={{ margin: '4px 0 0' }}>
        Rolls are listed oldest first — take the one marked ①. A roll assigned here stops being offered to any other order.
      </div>
    </div>
  );
}
