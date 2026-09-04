import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { productionApi } from '../api.js';
import { inr, today } from '../lib/format.js';
import { custGroupOf, findSpecForRow } from '../lib/master.js';
import { exportAOA } from '../lib/xlsx.js';

// MIS → Status (Issues 3.0/3.1), built to the sheet the business drew.
//
// Sale orders the PPC has planned, listed with their group, substrate, PO quantity
// and the metres planned. Open one and it becomes a GRID WHOSE COLUMNS ARE THE
// DEPARTMENTS of that order's route: what was planned at each, and under it the
// boxes MIS fills in — actual metres, wastage, the date, the start and end time —
// with the time taken worked out and a late start called out the moment it is
// entered. That is the whole job in one screen, per order, which a flat list of
// "pending stages" could never be.
//
// Nothing here is new server behaviour: /api/production/status-board assembles the
// grid and /api/production/record has stored start and end times since Enhancements
// 2.0. What was missing was somewhere to see and enter them together.

const n1 = (v) => (v == null || v === '' ? 0 : Math.round(Number(v) || 0));
const hhmmToMin = (v) => {
  const t = String(v || '').trim();
  const i = t.indexOf(':');
  if (i < 1) return null;
  const h = Number(t.slice(0, i));
  const m = Number(t.slice(i + 1));
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
/** Minutes between two HH:mm, wrapping past midnight — how a night shift is measured. */
export function minutesBetween(startTime, endTime) {
  const a = hhmmToMin(startTime);
  const b = hhmmToMin(endTime);
  if (a == null || b == null) return null;
  let d = b - a;
  if (d < 0) d += 24 * 60;
  return d;
}
const hhmm = (mins) => {
  if (mins == null) return '—';
  const m = Math.max(0, Math.round(mins));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
/** How late this department began against the plan, in minutes. */
export function lateBy(plannedStart, actualStart) {
  const p = hhmmToMin(plannedStart);
  const a = hhmmToMin(actualStart);
  if (p == null || a == null) return null;
  return a - p;
}
const daysBetween = (a, b) => {
  if (!a || !b) return null;
  const d = (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000;
  return Number.isFinite(d) ? Math.round(d) : null;
};

export default function MisStatusBoard() {
  const { mods } = useData();
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setRows(await productionApi.statusBoard() || []); }
    catch (e) { setErr(e.message || 'Could not load the status board'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Group and substrate are the sale order's, and live in the modules this login
  // already reads — the board itself stays about production.
  const customers = mods.customers || [];
  const jss = useMemo(() => (Array.isArray(mods.jss) ? mods.jss : []), [mods.jss]);
  const decorate = useCallback((r) => {
    const spec = findSpecForRow(jss, { spec: r.spec, customer: r.customer, jobName: r.jobName });
    return {
      ...r,
      group: custGroupOf(r.customer, customers) || r.customer || '—',
      substrate: (spec && spec.material) || '—',
    };
  }, [jss, customers]);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = rows.map(decorate);
    if (!t) return list;
    return list.filter((r) => [r.so, r.spec, r.customer, r.group, r.substrate]
      .some((v) => String(v || '').toLowerCase().includes(t)));
  }, [rows, q, decorate]);

  function exportBoard() {
    if (!visible.length) return;
    const aoa = [['MIS status — planned against actual'], ['Printed', today()], [],
      ['Sale Order', 'Group / Company', 'Spec', 'Substrate', 'PO Qty', 'Mtrs planned', 'Department',
        'Machines', 'Planned', 'Actual', 'Wastage', 'Planned date', 'Actual date',
        'Planned start', 'Actual start', 'End', 'Time taken', 'Late by (min)', 'Status']];
    visible.forEach((r) => (r.departments || []).forEach((d) => aoa.push([
      r.so, r.group, r.spec, r.substrate, n1(r.poQty), n1(r.plannedQty), d.departmentName,
      d.machines || '', n1(d.plannedQty), n1(d.actualQty), n1(d.wastageQty),
      d.plannedDate || '', d.actualDate || '', d.plannedStart || '', d.startTime || '',
      d.endTime || '', hhmm(d.durationMin), d.delayMin == null ? '' : d.delayMin, d.status || '',
    ])));
    exportAOA(aoa, `MIS_Status_${today()}`, 'Status');
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>Status <span className="tag ty">{visible.length}</span></div>
        <input placeholder="Search SO / spec / customer…" value={q} onChange={(e) => setQ(e.target.value)}
          aria-label="Search the status board" style={{ minWidth: 220 }} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={load} disabled={loading}>{loading ? 'Loading…' : '↻ Refresh'}</button>
        <button className="btn btn-s" onClick={exportBoard} disabled={!visible.length}
          aria-label="Export the status board to Excel">⬇ Excel</button>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Every sale order the PPC has planned. Open one to record what each department actually did.
      </div>
      {err && <div className="al al-r">{err}</div>}
      {msg && <div className="al al-g">{msg}</div>}

      {!loading && visible.length === 0 ? (
        <div className="al al-b">Nothing planned yet — the PPC plans sale orders onto machines on the Daily board.</div>
      ) : (
        <div className="tw sy" style={{ maxHeight: 620 }}>
          <table>
            <thead><tr>
              <th style={{ width: 34 }}></th><th>Sale Order</th><th>Group / Company</th><th>Spec</th>
              <th>Substrate</th><th style={{ textAlign: 'right' }}>PO Qty</th>
              <th style={{ textAlign: 'right' }}>Mtrs planned</th><th style={{ textAlign: 'right' }}>Wastage</th><th></th>
            </tr></thead>
            <tbody>
              {visible.map((r) => (
                <SoRow key={r.so} r={r} open={open === r.so}
                  onToggle={() => setOpen(open === r.so ? null : r.so)}
                  onSaved={async (m) => { flash(m); await load(); }} onError={setErr} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SoRow({ r, open, onToggle, onSaved, onError }) {
  const late = Number(r.lateStages || 0) > 0;
  return (
    <>
      <tr className={open ? 'hi' : undefined}>
        <td style={{ textAlign: 'center' }}>
          <button className="btn btn-s" style={{ height: 20, fontSize: 10, padding: '0 5px' }}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${r.so}`} onClick={onToggle}>{open ? '▾' : '▸'}</button>
        </td>
        <td>
          <button className="btn btn-s" style={{ height: 22, fontSize: 11, padding: '0 7px', fontWeight: 700 }}
            onClick={onToggle} aria-label={`Open ${r.so}`}>{r.so}</button>
        </td>
        <td style={{ fontSize: 11 }}>{r.group}</td>
        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.spec || '—'}</td>
        <td style={{ fontSize: 11 }}>{r.substrate}</td>
        <td style={{ textAlign: 'right' }}>{inr(n1(r.poQty))}</td>
        <td style={{ textAlign: 'right', fontWeight: 600 }}>{inr(n1(r.plannedQty))}</td>
        <td style={{ textAlign: 'right', color: n1(r.wastageQty) > 0 ? 'var(--red)' : undefined }}>{inr(n1(r.wastageQty))}</td>
        <td>{late && <span className="tag tr" style={{ fontSize: 9 }}>⏰ {r.lateStages} late</span>}</td>
      </tr>
      {open && (
        <tr><td colSpan={9} style={{ background: 'var(--bg)', padding: '8px 14px 14px' }}>
          <DeptGrid so={r.so} departments={r.departments || []} onSaved={onSaved} onError={onError} />
        </td></tr>
      )}
    </>
  );
}

/**
 * The grid itself: one COLUMN per department of the route, and one row per thing
 * MIS knows or records about it. Reading down a column is one department's day;
 * reading across a row compares the departments against each other.
 */
function DeptGrid({ so, departments, onSaved, onError }) {
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState('');

  const d0 = (d) => draft[d.stageSeq] || {};
  const set = (d, patch) => setDraft((x) => ({ ...x, [d.stageSeq]: { ...(x[d.stageSeq] || {}), ...patch } }));

  const plannedMinutes = (d) => minutesBetween(d.plannedStart, d.plannedEnd);
  const actualMinutes = (d) => {
    const typed = minutesBetween(d0(d).startTime ?? d.startTime, d0(d).endTime ?? d.endTime);
    return typed != null ? typed : (d.durationMin || null);
  };
  /** Late against the plan — recomputed live from what is being typed. */
  const late = (d) => {
    const typed = lateBy(d.plannedStart, d0(d).startTime ?? d.startTime);
    return typed != null ? typed : (d.delayMin ?? null);
  };

  async function save(d) {
    const v = d0(d);
    const produced = Number(v.actualQty ?? '');
    const wastage = Number(v.wastageQty ?? '');
    const hasQty = String(v.actualQty ?? '').trim() !== '' && produced > 0;
    const hasWaste = String(v.wastageQty ?? '').trim() !== '' && wastage > 0;
    const wantStatus = v.status || '';
    if (!hasQty && !hasWaste && !wantStatus) {
      onError(`${d.departmentName}: enter the actual metres, the wastage, or a status before saving.`);
      return;
    }
    setBusy(String(d.stageSeq));
    onError('');
    try {
      if (hasQty || hasWaste) {
        await productionApi.record({
          so,
          stageSeq: d.stageSeq,
          producedQty: hasQty ? produced : 0,
          wastageQty: hasWaste ? wastage : 0,
          prodDate: v.actualDate || d.actualDate || today(),
          startTime: (v.startTime ?? d.startTime) || undefined,
          endTime: (v.endTime ?? d.endTime) || undefined,
        });
      }
      if (wantStatus) await productionApi.setStatus(so, d.stageSeq, wantStatus);
      setDraft((x) => ({ ...x, [d.stageSeq]: {} }));
      await onSaved(`${so} · ${d.departmentName} updated.`);
    } catch (e) { onError(e.message || 'Save failed'); }
    finally { setBusy(''); }
  }

  if (!departments.length) {
    return <div className="al al-y" style={{ margin: 0 }}>This order has no route stages yet — set the route on the JSS, then plan it.</div>;
  }

  const label = (t, hint) => (
    <th style={{ textAlign: 'left', whiteSpace: 'nowrap', background: 'var(--wh)' }}>
      {t}{hint ? <div className="pg-sub" style={{ margin: 0, fontWeight: 400 }}>{hint}</div> : null}
    </th>
  );

  return (
    <div className="tw">
      <table style={{ minWidth: 260 + departments.length * 200 }}>
        <thead>
          <tr>
            <th style={{ width: 170, background: 'var(--wh)' }}></th>
            {departments.map((d) => (
              <th key={d.stageSeq} style={{ minWidth: 190 }}>
                {d.stageSeq}. {d.departmentName}
                <div className="pg-sub" style={{ margin: 0, fontWeight: 400 }}>{d.machines || 'no machine planned'}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {label('Planned mtrs')}
            {departments.map((d) => (
              <td key={d.stageSeq} style={{ fontWeight: 700 }}>{inr(n1(d.plannedQty))}</td>
            ))}
          </tr>
          <tr>
            {label('Actual mtrs', 'entered here')}
            {departments.map((d) => (
              <td key={d.stageSeq}>
                <input type="number" step="any" min="0" className="nospin" style={{ width: 110 }}
                  aria-label={`Actual metres for ${d.departmentName}`}
                  placeholder={n1(d.actualQty) ? String(n1(d.actualQty)) : '0'}
                  value={d0(d).actualQty ?? ''} onChange={(e) => set(d, { actualQty: e.target.value })} />
                {n1(d.actualQty) > 0 && (
                  <div className="pg-sub" style={{ margin: 0 }}>so far {inr(n1(d.actualQty))}</div>
                )}
              </td>
            ))}
          </tr>
          <tr>
            {label('Wastage')}
            {departments.map((d) => (
              <td key={d.stageSeq}>
                <input type="number" step="any" min="0" className="nospin" style={{ width: 110 }}
                  aria-label={`Wastage for ${d.departmentName}`}
                  placeholder={n1(d.wastageQty) ? String(n1(d.wastageQty)) : '0'}
                  value={d0(d).wastageQty ?? ''} onChange={(e) => set(d, { wastageQty: e.target.value })} />
              </td>
            ))}
          </tr>
          <tr>
            {label('Planned date')}
            {departments.map((d) => <td key={d.stageSeq} style={{ fontSize: 11 }}>{d.plannedDate || '—'}</td>)}
          </tr>
          <tr>
            {label('Actual date', 'defaults to today')}
            {departments.map((d) => {
              const days = daysBetween(d.plannedDate, d0(d).actualDate ?? d.actualDate);
              return (
                <td key={d.stageSeq}>
                  <input type="date" style={{ width: 140 }} aria-label={`Actual date for ${d.departmentName}`}
                    value={d0(d).actualDate ?? d.actualDate ?? today()}
                    onChange={(e) => set(d, { actualDate: e.target.value })} />
                  {days != null && days > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--red)', fontWeight: 600 }}>{days} day(s) late</div>
                  )}
                </td>
              );
            })}
          </tr>
          <tr>
            {label('Start time', 'planned → actual')}
            {departments.map((d) => {
              const l = late(d);
              return (
                <td key={d.stageSeq}>
                  <div className="pg-sub" style={{ margin: 0 }}>planned {d.plannedStart || '—'}</div>
                  <input type="time" style={{ width: 110 }} aria-label={`Start time for ${d.departmentName}`}
                    value={d0(d).startTime ?? d.startTime ?? ''}
                    onChange={(e) => set(d, { startTime: e.target.value })} />
                  {l != null && l > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--red)', fontWeight: 700 }}
                      title={`Planned to start at ${d.plannedStart}`}>⏰ started {hhmm(l)} late</div>
                  )}
                </td>
              );
            })}
          </tr>
          <tr>
            {label('End time')}
            {departments.map((d) => (
              <td key={d.stageSeq}>
                <input type="time" style={{ width: 110 }} aria-label={`End time for ${d.departmentName}`}
                  value={d0(d).endTime ?? d.endTime ?? ''}
                  onChange={(e) => set(d, { endTime: e.target.value })} />
              </td>
            ))}
          </tr>
          <tr>
            {label('Time taken', 'planned vs actual')}
            {departments.map((d) => {
              const p = plannedMinutes(d);
              const a = actualMinutes(d);
              const over = p != null && a != null && a > p;
              return (
                <td key={d.stageSeq} style={{ fontSize: 11 }}>
                  <span title="From the shift queue">{hhmm(p)}</span>
                  {' → '}
                  <b style={{ color: over ? 'var(--red)' : a != null ? 'var(--g)' : undefined }}>{hhmm(a)}</b>
                </td>
              );
            })}
          </tr>
          <tr>
            {label('Status')}
            {departments.map((d) => (
              <td key={d.stageSeq}>
                <select style={{ width: 150 }} aria-label={`Status for ${d.departmentName}`}
                  value={d0(d).status ?? ''} onChange={(e) => set(d, { status: e.target.value })}>
                  <option value="">{d.status || 'Not Started'} — keep</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                </select>
              </td>
            ))}
          </tr>
          <tr>
            {label('')}
            {departments.map((d) => (
              <td key={d.stageSeq}>
                <button className="btn btn-g" style={{ height: 26, fontSize: 11 }}
                  disabled={busy === String(d.stageSeq)}
                  aria-label={`Save ${d.departmentName}`} onClick={() => save(d)}>
                  {busy === String(d.stageSeq) ? 'Saving…' : '💾 Save'}
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
