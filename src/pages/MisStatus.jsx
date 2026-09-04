import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { productionApi, reportsApi } from '../api.js';
import { today } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import MisStatusBoard from '../components/MisStatusBoard.jsx';

// MIS landing page — Enhancements 2.0 §50-53. MIS sees the STATUS of every sale order
// the PPC has planned (its route departments/machines and how much is still pending),
// records the actual metres + wastage against each stage (on the Production screen),
// and watches planned-vs-actual and machine utilization. Reuses the production +
// reports endpoints (no new backend); actual-entry writes are MIS-gated server-side.

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const n1 = (v) => (v == null ? 0 : Math.round(Number(v)));
const sum = (arr, k) => (arr || []).reduce((s, r) => s + Number(r[k] || 0), 0);
const statusTag = (s) => ({ Completed: 'tg', 'Partially Completed': 'tb', 'In Progress': 'ty', 'Not Started': 'tgr' }[s] || 'ty');

export default function MisStatus() {
  const nav = useNavigate();
  const [from, setFrom] = useState(addDays(today(), -6));
  const [to, setTo] = useState(today());
  const [tab, setTab] = useState('status');
  const [pending, setPending] = useState([]);
  const [prod, setProd] = useState([]);
  const [util, setUtil] = useState([]);
  const [delays, setDelays] = useState([]);   // §59/§82: runs that started late
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [pd, pr, u, dl] = await Promise.all([
        productionApi.pending(),
        reportsApi.production(from, to, 'department'),
        reportsApi.utilization(from, to),
        reportsApi.delays(from, to),
      ]);
      setPending(pd || []); setProd(pr || []); setUtil(u || []); setDelays(dl || []);
    } catch (e) { setErr(e.message || 'Failed to load status'); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const preset = (days) => { setTo(today()); setFrom(addDays(today(), -(days - 1))); };

  /**
   * Issues 3.0: "In MIS login I should have export to Excel when I am looking at the
   * details of a particular sale order." Every board here exports what is on screen;
   * the Status board carries its own export, per order and for the whole sheet.
   */
  function exportPva() {
    if (!prod.length) return;
    exportAOA([['Planned vs Actual, with wastage'], ['Range', `${from} to ${to}`], [],
      ['Department', 'Planned', 'Actual', 'Wastage', 'Variance'],
      ...prod.map((r) => [r.group, n1(r.plannedQty), n1(r.actualQty), n1(r.wastageQty),
        n1(Number(r.actualQty || 0) - Number(r.plannedQty || 0))])],
    `MIS_Planned_vs_Actual_${from}_to_${to}`, 'Planned vs Actual');
  }
  function exportUtil() {
    if (!util.length) return;
    exportAOA([['Machine utilization'], ['Range', `${from} to ${to}`], [],
      ['Machine', 'Available min', 'Planned min', 'Actual min', 'Changeover', 'Idle min', 'Util %', 'Actual qty', 'Wastage'],
      ...util.map((m) => [m.machine, n1(m.availableMinutes), n1(m.plannedMinutes), n1(m.actualMinutes),
        n1(m.changeoverMinutes), n1(m.idleMinutes), m.utilizationPct, n1(m.actualQty), n1(m.wastageQty)])],
    `MIS_Machine_Utilization_${from}_to_${to}`, 'Utilization');
  }
  const distinctSos = useMemo(() => new Set((pending || []).map((p) => p.so)).size, [pending]);
  const plannedQty = useMemo(() => sum(prod, 'plannedQty'), [prod]);
  const actualQty = useMemo(() => sum(prod, 'actualQty'), [prod]);
  const wastageQty = useMemo(() => sum(prod, 'wastageQty'), [prod]);

  return (
    <div id="app">
      <div className="pg-ttl">📋 MIS — Production Status</div>
      <div className="pg-sub">Track each planned sale order through its route, record actual metres + wastage, and compare planned vs actual and machine utilization.</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}

      <div className="stats">
        <div className="stat"><div className="sl">Open sale orders</div><div className="sv">{distinctSos}</div></div>
        <div className="stat"><div className="sl">Pending stages</div><div className="sv">{pending.length}</div></div>
        <div className="stat"><div className="sl">Planned qty</div><div className="sv">{n1(plannedQty)}</div></div>
        <div className="stat"><div className="sl">Actual qty</div><div className="sv">{n1(actualQty)}</div></div>
        <div className="stat"><div className="sl">Wastage</div><div className="sv" style={{ color: wastageQty > 0 ? '#c0392b' : undefined }}>{n1(wastageQty)}</div></div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="fbar" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-g" onClick={() => nav('/production')}>🏭 Record Actuals</button>
          <div className="fbar" style={{ margin: 0 }}>
            <div className="fg" style={{ margin: 0 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="fg" style={{ margin: 0 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <button className="btn btn-s" onClick={() => preset(7)}>7 days</button>
            <button className="btn btn-s" onClick={() => preset(30)}>30 days</button>
            <button className="btn btn-s" onClick={load}>↻ Refresh</button>
          </div>
        </div>
      </div>

      <div className="step-bar" style={{ marginTop: 10 }}>
        <button className={'step-tab' + (tab === 'status' ? ' on' : '')} onClick={() => setTab('status')}>Status board</button>
        <button className={'step-tab' + (tab === 'pva' ? ' on' : '')} onClick={() => setTab('pva')}>Planned vs Actual</button>
        <button className={'step-tab' + (tab === 'util' ? ' on' : '')} onClick={() => setTab('util')}>Machine Utilization</button>
        <button className={'step-tab' + (tab === 'delays' ? ' on' : '')} onClick={() => setTab('delays')}>⏰ Delayed Starts{delays.length ? ` (${delays.length})` : ''}</button>
      </div>

      {loading && <div className="card" style={{ marginTop: 12 }}><div className="spin" /> Loading…</div>}

      {/* Issues 3.0/3.1: the Status tab is the sheet the business drew — a sale
          order opening into a column per department of its route, with the actual
          metres, dates, start and end times entered right there. The flat list of
          pending stages it replaced could not show one order across its route. */}
      {tab === 'status' && <MisStatusBoard />}

      {!loading && tab === 'pva' && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="fbar" style={{ justifyContent: 'space-between' }}>
            <div className="ctitle" style={{ margin: 0 }}>Planned vs Actual + Wastage (by department)</div>
            <button className="btn btn-s" disabled={!prod.length} onClick={exportPva} aria-label="Export planned vs actual to Excel">⬇ Excel</button>
          </div>
          {prod.length === 0 ? <div className="al al-g">No production recorded in this period.</div> : (
            <div className="tw sy"><table>
              <thead><tr><th>Department</th><th>Planned</th><th>Actual</th><th>Wastage</th><th>Variance</th></tr></thead>
              <tbody>{prod.map((r, i) => { const v = Number(r.actualQty || 0) - Number(r.plannedQty || 0); return (
                <tr key={i}><td>{r.group}</td><td>{r.plannedQty}</td><td>{r.actualQty}</td><td>{r.wastageQty}</td>
                  <td><span className={'tag ' + (v < 0 ? 'ty' : 'tg')}>{v}</span></td></tr>); })}</tbody>
            </table></div>
          )}
        </div>
      )}

      {!loading && tab === 'util' && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="fbar" style={{ justifyContent: 'space-between' }}>
            <div className="ctitle" style={{ margin: 0 }}>Machine Utilization</div>
            <button className="btn btn-s" disabled={!util.length} onClick={exportUtil} aria-label="Export machine utilization to Excel">⬇ Excel</button>
          </div>
          {util.length === 0 ? <div className="al al-g">No machines.</div> : (
            <div className="tw sy"><table>
              <thead><tr><th>Machine</th><th>Avail min</th><th>Planned min</th><th>Actual min</th><th>Changeover</th><th>Idle min</th><th>Util %</th><th>Actual qty</th><th>Wastage</th></tr></thead>
              <tbody>{util.map((m, i) => (
                <tr key={i}>
                  <td>{m.machine}</td><td>{n1(m.availableMinutes)}</td><td>{n1(m.plannedMinutes)}</td><td>{n1(m.actualMinutes)}</td><td>{n1(m.changeoverMinutes)}</td><td>{n1(m.idleMinutes)}</td>
                  <td><span className={'tag ' + (Number(m.utilizationPct) > 100 ? 'tr' : Number(m.utilizationPct) > 0 ? 'tb' : 'tgr')}>{m.utilizationPct}%</span></td>
                  <td>{m.actualQty}</td><td>{m.wastageQty}</td></tr>))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {/* §59/§82: jobs that started later than planned, highlighted for MIS */}
      {!loading && tab === 'delays' && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="ctitle">Delayed Starts <span className={'tag ' + (delays.length ? 'tr' : 'tg')}>{delays.length}</span></div>
          {delays.length === 0 ? <div className="al al-g">No delayed starts in this period.</div> : (
            <div className="tw sy"><table>
              <thead><tr><th>Date</th><th>Sale Order</th><th>Department</th><th>Machine</th><th>Started</th><th>Ended</th><th>Duration</th><th>Late by</th><th>By</th></tr></thead>
              <tbody>{delays.map((d) => (
                <tr key={d.id} className="nr">
                  <td>{d.prodDate}</td>
                  <td><span className="so-pill">{d.so}</span></td>
                  <td>{d.departmentName}</td>
                  <td>{d.machineName || '—'}</td>
                  <td>{d.startTime}</td><td>{d.endTime || '—'}</td>
                  <td>{d.durationMin != null ? `${d.durationMin} min` : '—'}</td>
                  <td><span className="tag tr">{d.delayMin} min</span></td>
                  <td>{d.actor}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}
