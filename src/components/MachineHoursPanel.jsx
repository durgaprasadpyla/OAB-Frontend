import { useState, useEffect, useCallback, useMemo } from 'react';
import { planningApi } from '../api.js';
import { today } from '../lib/format.js';

// Machine Availability (§74-76): how many hours each machine runs on each day of the
// week. The Super Admin's default (machine.functional_hours_per_day) is always
// visible; the PPC's per-day override is entered here (blank = default). Shared by
// the Weekly Planner and the PPC Dashboard's Machine Availability tab.

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const dow = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });

export default function MachineHoursPanel({ withWeekPicker = false }) {
  const [from, setFrom] = useState(today());
  const days = useMemo(() => Array.from({ length: 6 }, (_, i) => addDays(from, i)), [from]);
  const to = days[days.length - 1];
  const [hours, setHours] = useState({ machines: [], overrides: [] });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { setHours((await planningApi.machineHours(from, to)) || { machines: [], overrides: [] }); }
    catch (e) { setErr(e.message || 'Failed to load machine hours'); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const overrideFor = (machineId, date) => (hours.overrides || []).find((o) => String(o.machineId) === String(machineId) && o.date === date);
  async function saveHours(machineId, date, value) {
    setErr('');
    try {
      await planningApi.setMachineHours(machineId, date, value === '' ? null : Number(value));
      setMsg('Saved'); setTimeout(() => setMsg(''), 1500);
      await load();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="fbar" style={{ justifyContent: 'space-between' }}>
        <div className="ctitle" style={{ margin: 0 }}>Machine Availability — hours per day (blank = Super Admin default)</div>
        {withWeekPicker && (
          <div className="fbar" style={{ margin: 0 }}>
            <button className="btn btn-s" onClick={() => setFrom(addDays(from, -7))}>← Prev week</button>
            <input type="date" value={from} aria-label="Availability week from" onChange={(e) => setFrom(e.target.value)} />
            <button className="btn btn-s" onClick={() => setFrom(addDays(from, 7))}>Next week →</button>
          </div>
        )}
      </div>
      {err && <div className="al al-r">{err}</div>}
      {msg && <div className="al al-g">{msg}</div>}
      {hours.machines.length === 0 ? <div className="al al-b">No machines configured.</div> : (
        <div className="tw sy">
          <table>
            <thead><tr><th>Machine</th><th>Default (Super Admin)</th>{days.map((d) => <th key={d}>{dow(d)} {d.slice(5)}</th>)}</tr></thead>
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
                          aria-label={`Hours for ${m.code} on ${d}`}
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
  );
}
