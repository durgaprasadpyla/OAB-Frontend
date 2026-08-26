import { useState, useEffect, useCallback } from 'react';
import { reportsApi } from '../api.js';
import { today } from '../lib/format.js';

// Production planning reports (Stage 8): planned vs actual + wastage (machine- or
// department-wise) and per-machine utilization, over any date range (daily / weekly
// / monthly). Read-only; server aggregates the planning + production tables.

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const n1 = (v) => (v == null ? 0 : Math.round(Number(v)));

export default function Reports() {
  const [tab, setTab] = useState('production');
  const [from, setFrom] = useState(addDays(today(), -6));
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState('department');
  const [prod, setProd] = useState([]);
  const [util, setUtil] = useState([]);
  const [delays, setDelays] = useState([]);   // §82: delayed job starts
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [p, u, dl] = await Promise.all([reportsApi.production(from, to, groupBy), reportsApi.utilization(from, to), reportsApi.delays(from, to)]);
      setProd(p || []); setUtil(u || []); setDelays(dl || []);
    } catch (e) { setErr(e.message || 'Failed to load reports'); }
    finally { setLoading(false); }
  }, [from, to, groupBy]);
  useEffect(() => { load(); }, [load]);

  const preset = (days, endToday = true) => { setTo(today()); setFrom(addDays(today(), -(days - 1))); };

  return (
    <div id="app">
      <div className="pg-ttl">📈 Reports</div>
      <div className="pg-sub">Planned vs actual, wastage and machine utilization over any period.</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}

      <div className="card">
        <div className="fbar">
          <div className="fg"><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="fg"><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="btn btn-s" onClick={() => preset(1)}>Today</button>
          <button className="btn btn-s" onClick={() => preset(7)}>7 days</button>
          <button className="btn btn-s" onClick={() => preset(30)}>30 days</button>
        </div>
      </div>

      <div className="step-bar" style={{ marginTop: 10 }}>
        <button className={'step-tab' + (tab === 'production' ? ' on' : '')} onClick={() => setTab('production')}>Planned vs Actual</button>
        <button className={'step-tab' + (tab === 'utilization' ? ' on' : '')} onClick={() => setTab('utilization')}>Machine Utilization</button>
        <button className={'step-tab' + (tab === 'delays' ? ' on' : '')} onClick={() => setTab('delays')}>⏰ Delayed Starts{delays.length ? ` (${delays.length})` : ''}</button>
      </div>

      {loading && <div className="card" style={{ marginTop: 12 }}><div className="spin" /> Loading…</div>}

      {!loading && tab === 'production' && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="fbar" style={{ justifyContent: 'space-between' }}>
            <div className="ctitle" style={{ margin: 0 }}>Planned vs Actual + Wastage</div>
            <div className="fg" style={{ margin: 0 }}>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="department">By department</option>
                <option value="machine">By machine</option>
              </select>
            </div>
          </div>
          {prod.length === 0 ? <div className="al al-g">No data for this period.</div> : (
            <div className="tw sy">
              <table>
                <thead><tr><th>{groupBy === 'machine' ? 'Machine' : 'Department'}</th><th>Planned</th><th>Actual</th><th>Wastage</th><th>Variance</th></tr></thead>
                <tbody>
                  {prod.map((r, i) => {
                    const variance = Number(r.actualQty || 0) - Number(r.plannedQty || 0);
                    return (
                      <tr key={i}>
                        <td>{r.group}</td>
                        <td>{r.plannedQty}</td>
                        <td>{r.actualQty}</td>
                        <td>{r.wastageQty}</td>
                        <td><span className={'tag ' + (variance < 0 ? 'ty' : 'tg')}>{variance}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'utilization' && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="ctitle">Machine Utilization</div>
          {util.length === 0 ? <div className="al al-g">No machines.</div> : (
            <div className="tw sy">
              <table>
                <thead><tr><th>Machine</th><th>Avail min</th><th>Planned min</th><th>Actual min</th><th>Changeover</th><th>Idle min</th><th>Util %</th><th>Planned qty</th><th>Actual qty</th><th>Wastage</th></tr></thead>
                <tbody>
                  {util.map((m, i) => (
                    <tr key={i}>
                      <td>{m.machine}</td>
                      <td>{n1(m.availableMinutes)}</td>
                      <td>{n1(m.plannedMinutes)}</td>
                      <td>{n1(m.actualMinutes)}</td>
                      <td>{n1(m.changeoverMinutes)}</td>
                      <td>{n1(m.idleMinutes)}</td>
                      <td><span className={'tag ' + (Number(m.utilizationPct) > 100 ? 'tr' : Number(m.utilizationPct) > 0 ? 'tb' : 'tgr')}>{m.utilizationPct}%</span></td>
                      <td>{m.plannedQty}</td>
                      <td>{m.actualQty}</td>
                      <td>{m.wastageQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* §82: jobs that started later than planned */}
      {!loading && tab === 'delays' && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="ctitle">Delayed Starts <span className={'tag ' + (delays.length ? 'tr' : 'tg')}>{delays.length}</span></div>
          {delays.length === 0 ? <div className="al al-g">No delayed starts in this period.</div> : (
            <div className="tw sy">
              <table>
                <thead><tr><th>Date</th><th>Sale Order</th><th>Department</th><th>Machine</th><th>Started</th><th>Ended</th><th>Duration</th><th>Late by</th><th>By</th></tr></thead>
                <tbody>
                  {delays.map((d) => (
                    <tr key={d.id} className="nr">
                      <td>{d.prodDate}</td>
                      <td><span className="so-pill">{d.so}</span></td>
                      <td>{d.departmentName}</td>
                      <td>{d.machineName || '—'}</td>
                      <td>{d.startTime}</td>
                      <td>{d.endTime || '—'}</td>
                      <td>{d.durationMin != null ? `${d.durationMin} min` : '—'}</td>
                      <td><span className="tag tr">{d.delayMin} min</span></td>
                      <td>{d.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
