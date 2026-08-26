import { useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../data.jsx';
import { planningApi } from '../api.js';
import { exportAOA } from '../lib/xlsx.js';
import { today } from '../lib/format.js';

// PLAN landing page — Enhancements 2.0 §46-56. Against each open sale order the
// readiness gatekeeper picks: Ready to plan (entire / partial SO with metres), or
// Not ready — plates / material / others. A not-ready pick requires the tentative
// date it will be ready; "others" also requires a free-text reason. The screen also
// downloads the weekly / daily plans the PPC has saved and highlights any plan
// changes made after saving (§56).

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// §46-50: the one dropdown the doc asks for.
const READINESS_OPTIONS = [
  { v: 'READY', label: 'Ready to plan' },
  { v: 'PLATES', label: 'Not ready — plates' },
  { v: 'MATERIAL', label: 'Not ready — material' },
  { v: 'OTHERS', label: 'Not ready — others' },
];
const REASON_LABEL = { PLATES: 'Plates', MATERIAL: 'Material', OTHERS: 'Others' };

export default function PlanReadiness() {
  const { mods } = useData();
  const [board, setBoard] = useState([]);        // /readiness rows keyed by SO
  const [draft, setDraft] = useState({});        // so -> { pick, mode, meters, date, note }
  const [busy, setBusy] = useState('');          // so currently saving
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [dailyDate, setDailyDate] = useState(today());
  const [weekFrom, setWeekFrom] = useState(today());
  const [changes, setChanges] = useState([]);    // §56: jobs edited after first save

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  const loadBoard = useCallback(async () => {
    setErr('');
    try { setBoard(await planningApi.readiness() || []); }
    catch (e) { setErr(e.message || 'Failed to load the planning board'); }
  }, []);
  useEffect(() => { loadBoard(); }, [loadBoard]);

  // §56: plan changes for the visible week (jobs whose plan was edited after saving).
  const loadChanges = useCallback(async () => {
    try {
      const w = await planningApi.week(weekFrom, addDays(weekFrom, 6));
      setChanges(((w && w.jobs) || []).filter((j) => j.changed));
    } catch { /* the change panel is best-effort */ }
  }, [weekFrom]);
  useEffect(() => { loadChanges(); }, [loadChanges]);

  const stateBySo = useMemo(() => {
    const m = {};
    (board || []).forEach((p) => { m[p.so] = p; });
    return m;
  }, [board]);

  // Every OPEN sale order (module 1), the list the gatekeeper works down.
  const openRows = useMemo(() => {
    const oab = (mods && mods.oab && mods.oab.OAB) || {};
    const rows = [];
    ['SF', 'OT'].forEach((sh) => (oab[sh] || []).forEach((r) => { if (!r.closed) rows.push({ ...r, sheet: sh }); }));
    return rows.sort((a, b) => String(b.so).localeCompare(String(a.so), undefined, { numeric: true }));
  }, [mods]);

  const readyCount = useMemo(() => openRows.filter((r) => stateBySo[r.so]?.readyToPlan).length, [openRows, stateBySo]);
  const notReadyCount = useMemo(() => openRows.filter((r) => stateBySo[r.so] && !stateBySo[r.so].readyToPlan && stateBySo[r.so].notReadyReason).length, [openRows, stateBySo]);

  const draftFor = (so) => {
    if (draft[so]) return draft[so];
    const cur = stateBySo[so];
    if (!cur) return { pick: '', mode: '', meters: '', date: '', note: '' };
    if (cur.readyToPlan) return { pick: 'READY', mode: cur.readyMode || 'COMPLETE', meters: cur.readyMode === 'PARTIAL' && cur.readyQty != null ? String(cur.readyQty) : '', date: '', note: '' };
    if (cur.notReadyReason) return { pick: cur.notReadyReason, mode: '', meters: '', date: cur.expectedReadyDate || '', note: cur.notReadyNote || '' };
    return { pick: '', mode: '', meters: '', date: '', note: '' };
  };
  const setDraftFor = (so, patch) => setDraft((d) => ({ ...d, [so]: { ...draftFor(so), ...patch } }));

  async function apply(row) {
    const so = row.so;
    const d = draftFor(so);
    setErr('');
    if (!d.pick) { setErr(`Choose a readiness option for ${so}`); return; }
    const jobQty = num(row.poQty);
    if (d.pick === 'READY') {
      if (d.mode === 'PARTIAL') {
        const q = num(d.meters);
        if (!(q > 0)) { setErr(`Enter the metres ready for ${so} (must be greater than 0)`); return; }
        if (jobQty > 0 && q > jobQty + 1e-9) { setErr(`${so}: metres ready cannot exceed the job quantity (${jobQty})`); return; }
      } else if (d.mode !== 'COMPLETE') { setErr(`Choose Entire SO or Partial SO for ${so}`); return; }
    } else {
      if (!d.date) { setErr(`${so}: enter the tentative date it will be ready`); return; }
      if (d.pick === 'OTHERS' && !String(d.note || '').trim()) { setErr(`${so}: describe what is stopping the planning`); return; }
    }
    setBusy(so);
    try {
      if (d.pick === 'READY') {
        const qty = d.mode === 'PARTIAL' ? num(d.meters) : undefined;
        await planningApi.setReady(so, true, d.mode, qty);
        flash(d.mode === 'PARTIAL' ? `${so}: Ready to Plan — Partial (${qty} m)` : `${so}: Ready to Plan — Entire SO`);
      } else {
        await planningApi.setReady(so, false, undefined, undefined, {
          notReadyReason: d.pick, expectedReadyDate: d.date, notReadyNote: d.note || undefined,
        });
        flash(`${so}: Not ready (${REASON_LABEL[d.pick]}) — tentative ${d.date}`);
      }
      setDraft((dd) => { const n = { ...dd }; delete n[so]; return n; });
      await loadBoard();
    } catch (e) { setErr(e.message || `Could not update ${so}`); }
    finally { setBusy(''); }
  }

  async function download(kind) {
    setErr('');
    const from = kind === 'daily' ? dailyDate : weekFrom;
    const to = kind === 'daily' ? dailyDate : addDays(weekFrom, 6);
    try {
      const w = await planningApi.week(from, to);
      const jobs = (w && w.jobs) || [];
      if (jobs.length === 0) { flash('No planned jobs in that range to download.'); return; }
      const header = ['Date', 'Shift', 'Sale Order', 'Spec', 'Department', 'Machine', 'Planned Qty', 'Start', 'End', 'Est Min', 'Status', 'Changed'];
      const rows = [header, ...jobs.map((j) => [j.planDate, j.shift || 'A', j.so, j.specCode, j.departmentName, j.machineName,
        num(j.plannedQty), j.startTime || '', j.endTime || '', Math.round(num(j.estMinutes)), j.status, j.changed ? 'CHANGED' : ''])];
      const name = kind === 'daily' ? `Daily_Plan_${from}.xlsx` : `Weekly_Plan_${from}_to_${to}.xlsx`;
      exportAOA(rows, name, kind === 'daily' ? 'Daily Plan' : 'Weekly Plan');
      flash(`Downloaded ${jobs.length} planned job(s).`);
    } catch (e) { setErr(e.message || 'Download failed'); }
  }

  return (
    <div id="app">
      <div className="pg-ttl">✅ Planning — Ready to Plan</div>
      <div className="pg-sub">Mark each open sale order Ready to Plan (entire / partial SO), or record why it is not ready (plates / material / others) with the tentative ready date. Download the weekly / daily plans the PPC has saved.</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}
      {msg && <div className="al al-g" style={{ margin: '8px 0' }}>{msg}</div>}

      <div className="stats">
        <div className="stat"><div className="sl">Open sale orders</div><div className="sv">{openRows.length}</div></div>
        <div className="stat"><div className="sl">Ready to Plan</div><div className="sv" style={{ color: '#1e7e34' }}>{readyCount}</div></div>
        <div className="stat"><div className="sl">Not ready (with reason)</div><div className="sv" style={{ color: '#c0392b' }}>{notReadyCount}</div></div>
        <div className="stat"><div className="sl">Unmarked</div><div className="sv">{openRows.length - readyCount - notReadyCount}</div></div>
      </div>

      {/* Plan downloads (§55) */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ctitle">Download plans</div>
        <div className="fbar">
          <div className="fg" style={{ margin: 0 }}><label>Daily plan — date</label><input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} /></div>
          <button className="btn btn-s" onClick={() => download('daily')}>⬇ Daily Plan (xlsx)</button>
          <div className="fg" style={{ margin: 0, marginLeft: 16 }}><label>Weekly plan — week from</label><input type="date" value={weekFrom} onChange={(e) => setWeekFrom(e.target.value)} /></div>
          <button className="btn btn-s" onClick={() => download('weekly')}>⬇ Weekly Plan (xlsx)</button>
        </div>
      </div>

      {/* §56: changes to an already-saved plan, clearly visible */}
      {changes.length > 0 && (
        <div className="card" style={{ marginTop: 12, borderLeft: '4px solid #c9a100' }}>
          <div className="ctitle">⚠ Plan changes this week <span className="tag ty">{changes.length}</span></div>
          <div className="tw sy" style={{ maxHeight: 220 }}><table>
            <thead><tr><th>Date</th><th>Shift</th><th>Sale Order</th><th>Department</th><th>Machine</th><th>Qty</th><th>Start–End</th></tr></thead>
            <tbody>{changes.map((j) => (
              <tr key={j.id} className="hi">
                <td>{j.planDate}</td><td>{j.shift || 'A'}</td>
                <td><span className="so-pill">{j.so}</span></td>
                <td>{j.departmentName}</td><td>{j.machineName}</td>
                <td>{j.plannedQty}</td><td>{j.startTime || '—'}–{j.endTime || '—'}</td>
              </tr>))}</tbody>
          </table></div>
        </div>
      )}

      {/* Readiness list (§46-54) */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ctitle">Sale orders <span className="tag ty">{openRows.length}</span></div>
        {openRows.length === 0 ? <div className="al al-b">No open sale orders.</div> : (
          <div className="tw sy"><table>
            <thead><tr><th>Sale Order</th><th>Spec</th><th>Customer</th><th>Job Qty</th><th>Readiness</th><th style={{ minWidth: 420 }}>Set readiness</th></tr></thead>
            <tbody>
              {openRows.map((r) => {
                const cur = stateBySo[r.so];
                const d = draftFor(r.so);
                return (
                  <tr key={r.so} className={cur?.readyToPlan ? undefined : 'hi'}>
                    <td><span className="so-pill">{r.so}</span></td>
                    <td>{r.spec}</td>
                    <td>{r.customer}</td>
                    <td>{r.poQty}</td>
                    <td>{cur?.readyToPlan
                      ? <span className={'tag ' + (cur.readyMode === 'PARTIAL' ? 'tb' : 'tg')}>{cur.readyMode === 'PARTIAL' ? `Partial · ${cur.readyQty} m` : 'Entire SO'}</span>
                      : cur?.notReadyReason
                        ? <span className="tag tr" title={cur.notReadyNote || ''}>Not ready — {REASON_LABEL[cur.notReadyReason] || cur.notReadyReason} · by {cur.expectedReadyDate}</span>
                        : <span className="tag tgr">Not set</span>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select aria-label={`Readiness for ${r.so}`} value={d.pick} onChange={(e) => setDraftFor(r.so, { pick: e.target.value })} style={{ height: 28 }}>
                          <option value="">— select —</option>
                          {READINESS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                        </select>
                        {d.pick === 'READY' && (
                          <select aria-label={`Ready mode for ${r.so}`} value={d.mode} onChange={(e) => setDraftFor(r.so, { mode: e.target.value })} style={{ height: 28 }}>
                            <option value="">— entire / partial —</option>
                            <option value="COMPLETE">Entire SO</option>
                            <option value="PARTIAL">Partial SO</option>
                          </select>
                        )}
                        {d.pick === 'READY' && d.mode === 'PARTIAL' && (
                          <input type="number" step="any" min="0" placeholder={`metres (of ${r.poQty})`} value={d.meters}
                            onChange={(e) => setDraftFor(r.so, { meters: e.target.value })} style={{ width: 130, height: 28 }} />
                        )}
                        {d.pick && d.pick !== 'READY' && (
                          <input type="date" aria-label={`Tentative ready date for ${r.so}`} title="Tentative ready date"
                            value={d.date} onChange={(e) => setDraftFor(r.so, { date: e.target.value })} style={{ height: 28 }} />
                        )}
                        {d.pick === 'OTHERS' && (
                          <input placeholder="what is stopping planning?" aria-label={`Not ready reason for ${r.so}`} value={d.note}
                            onChange={(e) => setDraftFor(r.so, { note: e.target.value })} style={{ width: 200, height: 28 }} />
                        )}
                        <button className="btn btn-g" style={{ height: 28 }} disabled={busy === r.so || !d.pick} onClick={() => apply(r)}>
                          {cur ? 'Update' : 'Save'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
