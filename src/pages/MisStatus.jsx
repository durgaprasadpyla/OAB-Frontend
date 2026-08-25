import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { productionApi, reportsApi } from '../api.js';
import { today } from '../lib/format.js';

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
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [pd, pr, u] = await Promise.all([
        productionApi.pending(),
        reportsApi.production(from, to, 'department'),
        reportsApi.utilization(from, to),
      ]);
      setPending(pd || []); setProd(pr || []); setUtil(u || []);
    } catch (e) { setErr(e.message || 'Failed to load status'); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const preset = (days) => { setTo(today()); setFrom(addDays(today(), -(days - 1))); };
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
      </div>

      {loading && <div className="card" style={{ marginTop: 12 }}><div className="spin" /> Loading…</div>}

      {!loading && tab === 'status' && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="ctitle">Pending stages <span className="tag ty">{pending.length}</span></div>
          {pending.length === 0 ? <div className="al al-g">Nothing pending — every planned stage is complete.</div> : (
            <div className="tw sy"><table>
              <thead><tr><th>Sale Order</th><th>Stage</th><th>Department</th><th>Remaining</th><th>Status</th><th></th></tr></thead>
              <tbody>{pending.map((p, i) => (
                <tr key={i} className="hi">
                  <td><span className="so-pill">{p.so}</span></td>
                  <td>{p.stageSeq}</td>
                  <td>{p.departmentName}</td>
                  <td><b>{p.remaining}</b></td>
                  <td><span className={'tag ' + statusTag(p.status)}>{p.status}</span></td>
                  <td><button className="btn btn-s" onClick={() => nav('/production')}>Record</button></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {!loading && tab === 'pva' && (
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
      )}

      {!loading && tab === 'util' && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="ctitle">Machine Utilization</div>
          {util.length === 0 ? <div className="al al-g">No machines.</div> : (
            <div className="tw sy"><table>
              <thead><tr><th>Machine</th><th>Avail min</th><th>Planned min</th><th>Changeover</th><th>Idle min</th><th>Util %</th><th>Actual qty</th><th>Wastage</th></tr></thead>
              <tbody>{util.map((m, i) => (
                <tr key={i}>
                  <td>{m.machine}</td><td>{n1(m.availableMinutes)}</td><td>{n1(m.plannedMinutes)}</td><td>{n1(m.changeoverMinutes)}</td><td>{n1(m.idleMinutes)}</td>
                  <td><span className={'tag ' + (Number(m.utilizationPct) > 100 ? 'tr' : Number(m.utilizationPct) > 0 ? 'tb' : 'tgr')}>{m.utilizationPct}%</span></td>
                  <td>{m.actualQty}</td><td>{m.wastageQty}</td></tr>))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}
