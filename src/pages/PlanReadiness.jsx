import { useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../data.jsx';
import { planningApi } from '../api.js';
import { exportAOA } from '../lib/xlsx.js';
import { today } from '../lib/format.js';

// PLAN landing page — Enhancements 2.0 §38-49. The readiness gatekeeper marks each open
// sale order Ready to Plan (whole job / partial with metres) so it flows into the PPC's
// planning pool, and downloads the weekly / daily plans the PPC has saved. Reuses the
// planning endpoints; the marking write is PLAN-gated server-side.
//
// Note: the extended "Not ready – plates / material / others" reasons with a tentative
// date + free-text (§41-43, §47) need new backend columns and are NOT persisted yet —
// so this screen exposes only what actually saves: Ready to Plan (Complete / Partial)
// and "Not ready" (removes the SO from the pool). See the report for that follow-up.

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default function PlanReadiness() {
  const { mods } = useData();
  const [pool, setPool] = useState([]);
  const [draft, setDraft] = useState({});          // so -> { mode, meters } (in-progress edits)
  const [busy, setBusy] = useState('');            // so currently saving
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [dailyDate, setDailyDate] = useState(today());
  const [weekFrom, setWeekFrom] = useState(today());

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  const loadPool = useCallback(async () => {
    setErr('');
    try { setPool(await planningApi.pool() || []); }
    catch (e) { setErr(e.message || 'Failed to load the planning pool'); }
  }, []);
  useEffect(() => { loadPool(); }, [loadPool]);

  // Readiness by SO, from the pool (the bulk source of what is currently Ready to Plan).
  const readyBySo = useMemo(() => {
    const m = {};
    (pool || []).forEach((p) => { m[p.so] = { mode: p.readyMode || 'COMPLETE', qty: p.readyQty }; });
    return m;
  }, [pool]);

  // Every OPEN sale order (module 1), the list the gatekeeper works down (§39).
  const openRows = useMemo(() => {
    const oab = (mods && mods.oab && mods.oab.OAB) || {};
    const rows = [];
    ['SF', 'OT'].forEach((sh) => (oab[sh] || []).forEach((r) => { if (!r.closed) rows.push({ ...r, sheet: sh }); }));
    return rows.sort((a, b) => String(b.so).localeCompare(String(a.so), undefined, { numeric: true }));
  }, [mods]);

  const readyCount = useMemo(() => openRows.filter((r) => readyBySo[r.so]).length, [openRows, readyBySo]);
  const partialCount = useMemo(() => openRows.filter((r) => readyBySo[r.so]?.mode === 'PARTIAL').length, [openRows, readyBySo]);

  const draftFor = (so) => draft[so] || { mode: readyBySo[so]?.mode || '', meters: readyBySo[so]?.mode === 'PARTIAL' && readyBySo[so]?.qty != null ? String(readyBySo[so].qty) : '' };
  const setDraftFor = (so, patch) => setDraft((d) => ({ ...d, [so]: { ...draftFor(so), ...patch } }));

  async function markReady(row) {
    const so = row.so;
    const d = draftFor(so);
    setErr('');
    const jobQty = num(row.poQty);
    if (d.mode === 'PARTIAL') {
      const q = num(d.meters);
      if (!(q > 0)) { setErr(`Enter the metres ready for ${so} (must be greater than 0)`); return; }
      if (jobQty > 0 && q > jobQty + 1e-9) { setErr(`${so}: metres ready cannot exceed the job quantity (${jobQty})`); return; }
    } else if (d.mode !== 'COMPLETE') { setErr(`Choose Complete or Partial for ${so}`); return; }
    setBusy(so);
    try {
      const qty = d.mode === 'PARTIAL' ? num(d.meters) : undefined;
      await planningApi.setReady(so, true, d.mode, qty);
      flash(d.mode === 'PARTIAL' ? `${so}: Ready to Plan — Partial (${qty} m)` : `${so}: Ready to Plan — Complete`);
      setDraft((dd) => { const n = { ...dd }; delete n[so]; return n; });
      await loadPool();
    } catch (e) { setErr(e.message || `Could not mark ${so} ready`); }
    finally { setBusy(''); }
  }

  async function markNotReady(so) {
    setErr(''); setBusy(so);
    try {
      await planningApi.setReady(so, false);
      flash(`${so}: removed from the planning pool`);
      setDraft((dd) => { const n = { ...dd }; delete n[so]; return n; });
      await loadPool();
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
      const header = ['Date', 'Sale Order', 'Spec', 'Department', 'Machine', 'Planned Qty', 'Est Min', 'Status'];
      const rows = [header, ...jobs.map((j) => [j.planDate, j.so, j.specCode, j.departmentName, j.machineName, num(j.plannedQty), Math.round(num(j.estMinutes)), j.status])];
      const name = kind === 'daily' ? `Daily_Plan_${from}.xlsx` : `Weekly_Plan_${from}_to_${to}.xlsx`;
      exportAOA(rows, name, kind === 'daily' ? 'Daily Plan' : 'Weekly Plan');
      flash(`Downloaded ${jobs.length} planned job(s).`);
    } catch (e) { setErr(e.message || 'Download failed'); }
  }

  return (
    <div id="app">
      <div className="pg-ttl">✅ Planning — Ready to Plan</div>
      <div className="pg-sub">Mark each open sale order Ready to Plan (whole job or a partial quantity) so it flows to the PPC planner, and download the weekly / daily plans.</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}
      {msg && <div className="al al-g" style={{ margin: '8px 0' }}>{msg}</div>}

      <div className="stats">
        <div className="stat"><div className="sl">Open sale orders</div><div className="sv">{openRows.length}</div></div>
        <div className="stat"><div className="sl">Ready to Plan</div><div className="sv" style={{ color: '#1e7e34' }}>{readyCount}</div></div>
        <div className="stat"><div className="sl">of which Partial</div><div className="sv">{partialCount}</div></div>
        <div className="stat"><div className="sl">Not yet ready</div><div className="sv">{openRows.length - readyCount}</div></div>
      </div>

      {/* Plan downloads (§48) */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ctitle">Download plans</div>
        <div className="fbar">
          <div className="fg" style={{ margin: 0 }}><label>Daily plan — date</label><input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} /></div>
          <button className="btn btn-s" onClick={() => download('daily')}>⬇ Daily Plan (xlsx)</button>
          <div className="fg" style={{ margin: 0, marginLeft: 16 }}><label>Weekly plan — week from</label><input type="date" value={weekFrom} onChange={(e) => setWeekFrom(e.target.value)} /></div>
          <button className="btn btn-s" onClick={() => download('weekly')}>⬇ Weekly Plan (xlsx)</button>
        </div>
      </div>

      {/* Readiness list (§39) */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ctitle">Sale orders <span className="tag ty">{openRows.length}</span></div>
        {openRows.length === 0 ? <div className="al al-b">No open sale orders.</div> : (
          <div className="tw sy"><table>
            <thead><tr><th>Sale Order</th><th>Spec</th><th>Customer</th><th>Job Qty</th><th>Readiness</th><th style={{ minWidth: 320 }}>Set readiness</th></tr></thead>
            <tbody>
              {openRows.map((r) => {
                const cur = readyBySo[r.so];
                const d = draftFor(r.so);
                return (
                  <tr key={r.so} className={cur ? undefined : 'hi'}>
                    <td><span className="so-pill">{r.so}</span></td>
                    <td>{r.spec}</td>
                    <td>{r.customer}</td>
                    <td>{r.poQty}</td>
                    <td>{cur
                      ? <span className={'tag ' + (cur.mode === 'PARTIAL' ? 'tb' : 'tg')}>{cur.mode === 'PARTIAL' ? `Partial · ${cur.qty} m` : 'Complete'}</span>
                      : <span className="tag tgr">Not ready</span>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select value={d.mode} onChange={(e) => setDraftFor(r.so, { mode: e.target.value })} style={{ height: 28 }}>
                          <option value="">— select —</option>
                          <option value="COMPLETE">Ready — Complete</option>
                          <option value="PARTIAL">Ready — Partial</option>
                        </select>
                        {d.mode === 'PARTIAL' && (
                          <input type="number" step="any" min="0" placeholder={`metres (of ${r.poQty})`} value={d.meters}
                            onChange={(e) => setDraftFor(r.so, { meters: e.target.value })} style={{ width: 130, height: 28 }} />
                        )}
                        <button className="btn btn-g" style={{ height: 28 }} disabled={busy === r.so || !d.mode} onClick={() => markReady(r)}>
                          {cur ? 'Update' : 'Mark Ready'}
                        </button>
                        {cur && <button className="btn btn-r" style={{ height: 28 }} disabled={busy === r.so} onClick={() => markNotReady(r.so)}>Not ready</button>}
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
