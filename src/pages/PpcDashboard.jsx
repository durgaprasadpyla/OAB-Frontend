import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { planningApi, reportsApi } from '../api.js';
import { today } from '../lib/format.js';

// PPC (Production Planning & Control) landing page — Enhancements 2.0 §62: "Dashboard
// where planned vs actual will be displayed including the wastages — this will be the
// landing page." The PPC does the actual machine planning on the Weekly Planner and
// Daily Board (linked from here and from the role bar); this page is the at-a-glance
// overview PPC sees first after signing in. Read-only; reuses the reports + planning
// endpoints (no new backend).

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const n1 = (v) => (v == null ? 0 : Math.round(Number(v)));
const sum = (arr, k) => (arr || []).reduce((s, r) => s + Number(r[k] || 0), 0);

export default function PpcDashboard() {
  const nav = useNavigate();
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
      <div className="pg-sub">Your at-a-glance view of planned vs actual and wastage. Plan and re-sequence machine jobs from the Weekly Planner and Daily Board.</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}

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
    </div>
  );
}
