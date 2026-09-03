import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { planningApi, reportsApi } from '../api.js';
import { today } from '../lib/format.js';
import SoWastagePanel from '../components/SoWastagePanel.jsx';
import MachineHoursPanel from '../components/MachineHoursPanel.jsx';
import WeeklyPlanner from './WeeklyPlanner.jsx';
import DailyBoard from './DailyBoard.jsx';

// PPC (Production Planning & Control) landing page — Enhancements 2.0 §62: "Dashboard
// where planned vs actual will be displayed including the wastages — this will be the
// landing page." The PPC does the actual machine planning on the Weekly Planner and
// Daily Board (linked from here and from the role bar); this page is the at-a-glance
// overview PPC sees first after signing in. Read-only; reuses the reports + planning
// endpoints (no new backend).

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const n1 = (v) => (v == null ? 0 : Math.round(Number(v)));
const sum = (arr, k) => (arr || []).reduce((s, r) => s + Number(r[k] || 0), 0);

// §62: the PPC workspace is ONE page with the five tabs the document names —
// Dashboard (landing, planned-vs-actual + wastage), Machine Availability, Weekly
// plan, Daily planning and Machine-wise planning.
const PPC_TABS = [
  { k: 'dash', label: '📊 Dashboard' },
  { k: 'avail', label: '🕐 Machine Availability' },
  { k: 'weekly', label: '🗓 Weekly Plan' },
  { k: 'daily', label: '📋 Daily Planning' },
  { k: 'machinewise', label: '🏭 Machine-wise Planning' },
];

import SoBomDownloads from '../components/SoBomDownloads.jsx';

export default function PpcDashboard() {
  const nav = useNavigate();
  const [tab, setTab] = useState('dash');
  const [from, setFrom] = useState(addDays(today(), -6));
  const [to, setTo] = useState(today());
  const [pool, setPool] = useState([]);
  const [prod, setProd] = useState([]);
  const [week, setWeek] = useState({ jobs: [], capacity: [] });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const [delays, setDelays] = useState([]);   // §82: delayed job starts

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [p, pr, w, dl] = await Promise.all([
        planningApi.pool(),
        reportsApi.production(from, to, 'department'),
        planningApi.week(from, to),
        reportsApi.delays(from, to),
      ]);
      setPool(p || []); setProd(pr || []); setWeek(w || { jobs: [], capacity: [] }); setDelays(dl || []);
    } catch (e) { setErr(e.message || 'Failed to load dashboard'); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const preset = (days) => { setTo(today()); setFrom(addDays(today(), -(days - 1))); };
  const plannedQty = useMemo(() => sum(prod, 'plannedQty'), [prod]);
  const actualQty = useMemo(() => sum(prod, 'actualQty'), [prod]);
  const wastageQty = useMemo(() => sum(prod, 'wastageQty'), [prod]);
  const overbooked = useMemo(() => (week.capacity || []).filter((c) => c.overbooked).length, [week]);
  const changedJobs = useMemo(() => (week.jobs || []).filter((j) => j.changed), [week]);   // §56

  return (
    <div id="app">
      <div className="pg-ttl">📊 PPC — Production Planning Dashboard</div>
      <div className="pg-sub">Your at-a-glance view of planned vs actual and wastage. Plan and re-sequence machine jobs from the Weekly Plan and Daily Planning tabs.</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}

      {/* C1: the five PPC tabs from the requirements doc */}
      <div className="step-bar" style={{ marginBottom: 10 }}>
        {PPC_TABS.map((t) => (
          <button key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} onClick={() => setTab(t.k)}>{t.label}</button>
        ))}
      </div>

      {tab === 'avail' && <MachineHoursPanel withWeekPicker />}
      {tab === 'weekly' && <WeeklyPlanner embedded />}
      {tab === 'daily' && <DailyBoard embedded />}
      {tab === 'machinewise' && <MachineWisePanel />}

      {tab === 'dash' && (<>
      <SoBomDownloads compact />
      <div className="card">
        <div className="fbar">
          <div className="fg"><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="fg"><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="btn btn-s" onClick={() => preset(1)}>Today</button>
          <button className="btn btn-s" onClick={() => preset(7)}>7 days</button>
          <button className="btn btn-s" onClick={() => preset(30)}>30 days</button>
          <button className="btn btn-s" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      <div className="stats" style={{ marginTop: 12 }}>
        <div className="stat"><div className="sl">Ready to Plan</div><div className="sv">{pool.length}</div></div>
        <div className="stat"><div className="sl">Planned qty</div><div className="sv">{n1(plannedQty)}</div></div>
        <div className="stat"><div className="sl">Actual qty</div><div className="sv">{n1(actualQty)}</div></div>
        <div className="stat"><div className="sl">Wastage</div><div className="sv" style={{ color: wastageQty > 0 ? '#c0392b' : undefined }}>{n1(wastageQty)}</div></div>
        <div className="stat"><div className="sl">Over-booked days</div><div className="sv" style={{ color: overbooked > 0 ? '#c0392b' : undefined }}>{overbooked}</div></div>
        <div className="stat"><div className="sl">Delayed starts</div><div className="sv" style={{ color: delays.length > 0 ? '#c0392b' : undefined }}>{delays.length}</div></div>
        <div className="stat"><div className="sl">Plan changes</div><div className="sv" style={{ color: changedJobs.length > 0 ? '#c9a100' : undefined }}>{changedJobs.length}</div></div>
      </div>

      {/* Primary actions — the planning workspace (also on the role bar). */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ctitle">Planning workspace</div>
        <div className="fbar">
          <button className="btn btn-g" onClick={() => nav('/planner')}>🗓 Weekly Planner</button>
          <button className="btn btn-g" onClick={() => nav('/board')}>📋 Daily Machine Board</button>
          <button className="btn btn-s" onClick={() => nav('/reports')}>📈 Reports</button>
        </div>
        <div className="pg-sub" style={{ marginTop: 6 }}>
          {pool.length > 0
            ? `${pool.length} sale order(s) are marked Ready to Plan and waiting to be scheduled.`
            : 'No sale orders are Ready to Plan yet — the PLAN login marks readiness.'}
        </div>
      </div>

      {loading && <div className="card" style={{ marginTop: 12 }}><div className="spin" /> Loading…</div>}

      {/* Planned vs actual + wastage (§62) */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ctitle">Planned vs Actual + Wastage (by department)</div>
        {prod.length === 0 ? <div className="al al-g">No production recorded in this period.</div> : (
          <div className="tw sy"><table>
            <thead><tr><th>Department</th><th>Planned</th><th>Actual</th><th>Wastage</th><th>Variance</th></tr></thead>
            <tbody>{prod.map((r, i) => { const v = Number(r.actualQty || 0) - Number(r.plannedQty || 0); return (
              <tr key={i}><td>{r.group}</td><td>{r.plannedQty}</td><td>{r.actualQty}</td><td>{r.wastageQty}</td>
                <td><span className={'tag ' + (v < 0 ? 'ty' : 'tg')}>{v}</span></td></tr>); })}</tbody>
          </table></div>
        )}
      </div>

      {/* §82: delayed job starts, highlighted for the PPC too */}
      {delays.length > 0 && (
        <div className="card" style={{ marginTop: 12, borderLeft: '4px solid var(--red)' }}>
          <div className="ctitle">⏰ Delayed Starts <span className="tag tr">{delays.length}</span></div>
          <div className="tw sy" style={{ maxHeight: 220 }}><table>
            <thead><tr><th>Date</th><th>Sale Order</th><th>Department</th><th>Machine</th><th>Started</th><th>Late by</th></tr></thead>
            <tbody>{delays.map((d) => (
              <tr key={d.id} className="nr">
                <td>{d.prodDate}</td><td><span className="so-pill">{d.so}</span></td>
                <td>{d.departmentName}</td><td>{d.machineName || '—'}</td>
                <td>{d.startTime}</td><td><span className="tag tr">{d.delayMin} min</span></td>
              </tr>))}</tbody>
          </table></div>
        </div>
      )}

      {/* §56: plan edits after saving, clearly visible on the dashboard */}
      {changedJobs.length > 0 && (
        <div className="card" style={{ marginTop: 12, borderLeft: '4px solid #c9a100' }}>
          <div className="ctitle">⚠ Plan changes <span className="tag ty">{changedJobs.length}</span></div>
          <div className="tw sy" style={{ maxHeight: 220 }}><table>
            <thead><tr><th>Date</th><th>Shift</th><th>Sale Order</th><th>Department</th><th>Machine</th><th>Qty</th><th>Start–End</th></tr></thead>
            <tbody>{changedJobs.map((j) => (
              <tr key={j.id} className="hi">
                <td>{j.planDate}</td><td>{j.shift || 'A'}</td>
                <td><span className="so-pill">{j.so}</span></td>
                <td>{j.departmentName}</td><td>{j.machineName}</td>
                <td>{j.plannedQty}</td><td>{j.startTime ? `${j.startTime}–${j.endTime}` : '—'}</td>
              </tr>))}</tbody>
          </table></div>
        </div>
      )}

      {/* P6: department-wise wastage listed against each sale order */}
      <SoWastagePanel from={from} to={to} />

      {/* Machine load / availability for the period */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ctitle">Machine Load</div>
        {(week.capacity || []).length === 0 ? <div className="al al-g">Nothing planned in this period.</div> : (
          <div className="tw sy"><table>
            <thead><tr><th>Date</th><th>Machine</th><th>Jobs</th><th>Used min</th><th>Cap min</th><th>Status</th></tr></thead>
            <tbody>{week.capacity.map((c, i) => (
              <tr key={i} className={c.overbooked ? 'nr' : undefined}>
                <td>{c.date}</td><td>{c.machineName}</td><td>{c.jobs}</td><td>{n1(c.usedMinutes)}</td><td>{n1(c.capMinutes)}</td>
                <td><span className={'tag ' + (c.overbooked ? 'tr' : 'tg')}>{c.overbooked ? 'Over-booked' : 'OK'}</span></td></tr>))}</tbody>
          </table></div>
        )}
      </div>
      </>)}
    </div>
  );
}

/**
 * Machine-wise Planning (§65 tab): every machine's queue for the coming week —
 * which sale orders sit under which machine, in order, with start–end times.
 * Read-only overview; the actual drag-and-drop happens on the Daily Planning tab.
 */
function MachineWisePanel() {
  const [from, setFrom] = useState(today());
  const to = useMemo(() => addDays(from, 6), [from]);
  const [week, setWeek] = useState({ jobs: [], capacity: [] });
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { setWeek((await planningApi.week(from, to)) || { jobs: [], capacity: [] }); }
    catch (e) { setErr(e.message || 'Failed to load the machine-wise plan'); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const byMachine = useMemo(() => {
    const g = {};
    (week.jobs || []).forEach((j) => {
      const k = j.machineName || ('#' + j.machineId);
      (g[k] = g[k] || []).push(j);
    });
    Object.values(g).forEach((list) => list.sort((a, b) =>
      String(a.planDate).localeCompare(String(b.planDate))
      || String(a.shift || 'A').localeCompare(String(b.shift || 'A'))
      || (a.seqOrder || 0) - (b.seqOrder || 0)));
    return g;
  }, [week.jobs]);

  return (
    <div>
      <div className="card">
        <div className="fbar">
          <div className="fg"><label>Week from</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <button className="btn btn-s" onClick={() => setFrom(addDays(from, -7))}>← Prev week</button>
          <button className="btn btn-s" onClick={() => setFrom(addDays(from, 7))}>Next week →</button>
          <button className="btn btn-s" onClick={load}>↻ Refresh</button>
        </div>
      </div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}
      {Object.keys(byMachine).length === 0 ? (
        <div className="card" style={{ marginTop: 12 }}><div className="al al-b">Nothing planned for this week yet — plan on the Weekly Plan or Daily Planning tab.</div></div>
      ) : Object.entries(byMachine).map(([machine, jobs]) => (
        <div className="card" key={machine} style={{ marginTop: 12 }}>
          <div className="ctitle">🏭 {machine} <span className="tag tgr">{jobs.length} job(s)</span></div>
          <div className="tw sy"><table>
            <thead><tr><th>Date</th><th>Shift</th><th>Sale Order</th><th>Department</th><th>Qty</th><th>Start–End</th><th>Est min</th><th>Changed</th></tr></thead>
            <tbody>{jobs.map((j) => (
              <tr key={j.id} className={j.changed ? 'hi' : undefined}>
                <td>{j.planDate}</td><td>{j.shift || 'A'}</td>
                <td><span className="so-pill">{j.so}</span></td>
                <td>{j.departmentName}</td><td>{j.plannedQty}</td>
                <td>{j.startTime ? `${j.startTime}–${j.endTime}` : '—'}</td>
                <td>{n1(j.estMinutes)}</td>
                <td>{j.changed ? <span className="tag ty">⚠ changed</span> : '—'}</td>
              </tr>))}</tbody>
          </table></div>
        </div>
      ))}
    </div>
  );
}
