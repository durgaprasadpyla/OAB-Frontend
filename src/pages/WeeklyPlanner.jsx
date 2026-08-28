import { useState, useEffect, useCallback, useMemo } from 'react';
import { planningApi } from '../api.js';
import { today } from '../lib/format.js';
import PlanDownloads from '../components/PlanDownloads.jsx';

// Weekly planner (Stage 6): pick Ready-to-Plan SOs and assign quantities to eligible
// machines on specific dates. The server checks eligibility, caps each department at
// the SO quantity (no double-planning), and returns the machine-day capacity so the
// planner sees over-booking. The planner can also override a machine's hours per date.

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const dow = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
const mins = (v) => (v == null ? 0 : Math.round(Number(v)));

export default function WeeklyPlanner({ embedded = false }) {
  const [from, setFrom] = useState(today());
  const days = useMemo(() => Array.from({ length: 6 }, (_, i) => addDays(from, i)), [from]);
  const to = days[days.length - 1];

  const [pool, setPool] = useState([]);
  const [hours, setHours] = useState({ machines: [], overrides: [] });
  const [wk, setWk] = useState({ jobs: [], capacity: [] });
  const [so, setSo] = useState('');
  const [soPlan, setSoPlan] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [lastCap, setLastCap] = useState(null);

  // assignment form
  const [aDept, setADept] = useState('');
  const [aMachine, setAMachine] = useState('');
  const [aDate, setADate] = useState('');
  const [aQty, setAQty] = useState('');
  const [aShift, setAShift] = useState('A');   // §77: A = day, B = night

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  const loadBoard = useCallback(async () => {
    setErr('');
    try {
      const [p, h, w] = await Promise.all([planningApi.pool(), planningApi.machineHours(from, to), planningApi.week(from, to)]);
      setPool(p || []); setHours(h || { machines: [], overrides: [] }); setWk(w || { jobs: [], capacity: [] });
    } catch (e) { setErr(e.message || 'Failed to load planning board'); }
  }, [from, to]);
  useEffect(() => { loadBoard(); }, [loadBoard]);

  const openSo = useCallback(async (s) => {
    if (!s) { setSoPlan(null); return; }
    setSo(s); setErr('');
    try { const sp = await planningApi.soPlan(s); setSoPlan(sp); setADept(''); setAMachine(''); setAQty(''); setADate(days[0]); }
    catch (e) { setErr(e.message || 'Failed to load SO'); }
  }, [days]);

  const capFor = (machineId, date) => (wk.capacity || []).find((c) => String(c.machineId) === String(machineId) && c.date === date);
  const overrideFor = (machineId, date) => (hours.overrides || []).find((o) => String(o.machineId) === String(machineId) && o.date === date);

  const deptObj = (soPlan?.departments || []).find((d) => String(d.departmentId) === String(aDept));
  const deptMachines = deptObj?.machines || [];

  async function assign() {
    setErr('');
    if (!aDept || !aMachine || !aDate || !(Number(aQty) > 0)) { setErr('Pick a department, machine, date and a positive quantity'); return; }
    try {
      const r = await planningApi.assign({ so, departmentId: Number(aDept), machineId: Number(aMachine), planDate: aDate, plannedQty: Number(aQty), shift: aShift });
      setLastCap(r.capacity);
      flash(r.capacity?.overbooked ? 'Assigned — but the machine is over-booked for that day' : 'Assigned');
      setAQty('');
      await Promise.all([openSo(so), loadBoard()]);
    } catch (e) { setErr(e.message || 'Assign failed'); }
  }
  async function unassign(jobId) {
    try { await planningApi.unassign(jobId); flash('Removed'); await Promise.all([openSo(so), loadBoard()]); }
    catch (e) { setErr(e.message); }
  }
  async function saveHours(machineId, date, value) {
    try { await planningApi.setMachineHours(machineId, date, value === '' ? null : Number(value)); await Promise.all([loadBoard()]); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div id={embedded ? undefined : 'app'}>
      {!embedded && <div className="pg-ttl">🗓 Weekly Planner</div>}
      <div className="pg-sub">Assign Ready-to-Plan sale orders to eligible machines by date. Capacity = quantity ÷ speed + changeover; over-booked machine-days are flagged.</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}
      {msg && <div className={'al ' + (lastCap?.overbooked ? 'al-y' : 'al-g')} style={{ margin: '8px 0' }}>{msg}</div>}

      <div className="card">
        <div className="fbar">
          <div className="fg"><label>Week from</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <button className="btn btn-s" onClick={() => setFrom(addDays(from, -7))}>← Prev week</button>
          <button className="btn btn-s" onClick={() => setFrom(addDays(from, 7))}>Next week →</button>
          <button className="btn btn-s" onClick={() => setFrom(today())}>This week</button>
        </div>
      </div>

      {/* Ready-to-Plan pool. §81: fully planned SOs drop out; partials keep their balance visible. */}
      <div className="card" style={{ marginTop: 12 }}>
        {(() => {
          const open = pool.filter((p) => !p.fullyPlanned);
          const done = pool.length - open.length;
          return (
            <>
              <div className="ctitle">Ready to Plan <span className="tag ty">{open.length}</span></div>
              {open.length === 0 ? <div className="al al-b">No SOs waiting to be planned (Plant/PLAN marks readiness).</div> : (
                <div className="tw sy">
                  <table>
                    <thead><tr><th>Sale Order</th><th>Spec</th><th>Job</th><th>Route</th><th>Job Qty</th><th>Status</th><th>Ready</th><th>Planned</th><th>Balance</th><th></th></tr></thead>
                    <tbody>
                      {open.map((p) => (
                        <tr key={p.so} className={so === p.so ? 'hi' : undefined}>
                          <td><span className="so-pill">{p.so}</span></td>
                          <td>{p.spec}</td><td>{p.jobName}</td><td>{p.routeName}</td>
                          <td>{p.poQty}</td>
                          <td><span className={'tag ' + (p.readyMode === 'PARTIAL' ? 'tb' : 'tg')}>{p.readyMode === 'PARTIAL' ? 'Partial' : 'Complete'}</span></td>
                          <td><b>{p.readyQty}</b></td>
                          <td>{p.plannedQty}</td>
                          <td>{p.remainingQty != null ? <b>{p.remainingQty}</b> : '—'}</td>
                          <td><button className="btn btn-s" onClick={() => openSo(p.so)}>Plan</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {done > 0 && <div className="pg-sub" style={{ marginTop: 6 }}>✅ {done} sale order(s) fully planned — removed from the pool.</div>}
            </>
          );
        })()}
      </div>

      {/* Assignment panel */}
      {so && soPlan && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="fbar" style={{ justifyContent: 'space-between' }}>
            <div className="ctitle" style={{ margin: 0 }}>Plan SO <span className="so-pill">{so}</span> · {soPlan.routeName || 'no route'}
              {soPlan.readyQty != null && <span className={'tag ' + (soPlan.readyMode === 'PARTIAL' ? 'tb' : 'tg')} style={{ marginLeft: 8 }}>
                {soPlan.readyMode === 'PARTIAL' ? 'Partial' : 'Complete'} · {soPlan.readyQty} m ready</span>}
            </div>
            <button className="btn btn-s" onClick={() => { setSo(''); setSoPlan(null); }}>Close</button>
          </div>
          <div className="g4">
            <div className="fg">
              <label>Department</label>
              <select value={aDept} onChange={(e) => { setADept(e.target.value); setAMachine(''); }}>
                <option value="">— select —</option>
                {(soPlan.departments || []).map((d) => <option key={d.departmentId} value={d.departmentId}>{d.seq}. {d.departmentName} (rem {d.remaining})</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Machine (eligible)</label>
              <select value={aMachine} onChange={(e) => setAMachine(e.target.value)} disabled={!aDept}>
                <option value="">— select —</option>
                {deptMachines.map((m) => <option key={m.machineId} value={m.machineId}>{m.code} — {m.name} ({m.speed || '?'}/min{m.changeoverMin != null ? ', co ' + m.changeoverMin : ''})</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Date</label>
              <select value={aDate} onChange={(e) => setADate(e.target.value)}>
                {days.map((d) => <option key={d} value={d}>{dow(d)} {d}</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Shift</label>
              <select value={aShift} onChange={(e) => setAShift(e.target.value)} aria-label="Shift">
                <option value="A">Shift A — day</option>
                <option value="B">Shift B — night</option>
              </select>
            </div>
            <div className="fg">
              <label>Quantity{deptObj ? ` (rem ${deptObj.remaining})` : ''}</label>
              <input type="number" step="any" value={aQty} onChange={(e) => setAQty(e.target.value)} />
            </div>
          </div>
          <div className="act">
            {lastCap && <span className={'tag ' + (lastCap.overbooked ? 'tr' : 'tg')} style={{ marginRight: 'auto' }}>
              Last: {mins(lastCap.usedMinutes)}/{mins(lastCap.capMinutes)} min{lastCap.overbooked ? ' · OVER-BOOKED' : ''}</span>}
            <button className="btn btn-g" onClick={assign}>Assign</button>
          </div>

          {/* this SO's current jobs */}
          {Array.isArray(soPlan.jobs) && soPlan.jobs.length > 0 && (
            <div className="tw" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>Date</th><th>Shift</th><th>Department</th><th>Machine</th><th>Qty</th><th>Start–End</th><th>Est min</th><th></th></tr></thead>
                <tbody>
                  {soPlan.jobs.map((j) => (
                    <tr key={j.id} className={j.changed ? 'hi' : undefined} title={j.changed ? 'Changed after the plan was saved' : undefined}>
                      <td>{j.planDate}</td><td>{j.shift || 'A'}</td><td>{j.departmentName}</td><td>{j.machineName}</td>
                      <td>{j.plannedQty}</td><td>{j.startTime ? `${j.startTime}–${j.endTime}` : '—'}</td><td>{mins(j.estMinutes)}{j.changed ? ' ⚠' : ''}</td>
                      <td><button className="btn btn-r" onClick={() => unassign(j.id)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Machine hours grid */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ctitle">Machine Hours (planner override — blank = default)</div>
        {hours.machines.length === 0 ? <div className="al al-b">No machines configured.</div> : (
          <div className="tw sy">
            <table>
              <thead><tr><th>Machine</th><th>Default</th>{days.map((d) => <th key={d}>{dow(d)} {d.slice(5)}</th>)}</tr></thead>
              <tbody>
                {hours.machines.map((m) => (
                  <tr key={m.id}>
                    <td>{m.code} — {m.name}</td>
                    <td>{m.defaultHours}</td>
                    {days.map((d) => {
                      const ov = overrideFor(m.id, d);
                      return (
                        <td key={d}>
                          <input type="number" step="any" style={{ width: 60 }} placeholder={m.defaultHours}
                            defaultValue={ov ? ov.hours : ''} onBlur={(e) => saveHours(m.id, d, e.target.value)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* §63: the planner downloads the weekly / daily plan too. */}
      <PlanDownloads compact />

      {/* Week capacity view */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="ctitle">This Week's Load</div>
        {wk.capacity.length === 0 ? <div className="al al-g">Nothing planned this week.</div> : (
          <div className="tw sy">
            <table>
              <thead><tr><th>Date</th><th>Machine</th><th>Jobs</th><th>Used min</th><th>Cap min</th><th>Status</th></tr></thead>
              <tbody>
                {wk.capacity.map((c, i) => (
                  <tr key={i} className={c.overbooked ? 'nr' : undefined}>
                    <td>{dow(c.date)} {c.date}</td><td>{c.machineName}</td><td>{c.jobs}</td>
                    <td>{mins(c.usedMinutes)}</td><td>{mins(c.capMinutes)}</td>
                    <td><span className={'tag ' + (c.overbooked ? 'tr' : 'tg')}>{c.overbooked ? 'Over-booked' : 'OK'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
