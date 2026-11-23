import { useState, useEffect, useCallback, useMemo } from 'react';
import Modal from './Modal.jsx';
import { today } from '../lib/format.js';
import { machineCalendarApi, DOW_NAMES, dowOf } from '../lib/machineCalendarApi.js';
import { V2Metrics, V2Panel, V2Badge, V2Note } from './V2Ui.jsx';
import '../v2-planner.css';

// BloomFlex V2 — Machine Calendar (PPC tab). The real operating windows of every
// machine for 7 days: each cell shows the hours and the windows ("A 06:00–14:00 ·
// B 14:00–18:00" / "OFF"); ✎ marks a date override. Click a cell to edit that date's
// windows, save them as the weekday's weekly pattern, or drop the override. A machine
// nobody configured shows its legacy hours (Machine Availability tab) as "default".

// UTC arithmetic: a local-midnight Date turns into the previous day in toISOString() east of UTC.
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const SHIFTS = ['A', 'B', 'C'];
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const duration = (w) => { const a = toMin(w.from), b = toMin(w.to); return b > a ? b - a : b + 1440 - a; };

/** Client-side mirror of the server rules, so the obvious mistakes never round-trip. */
export function windowsError(list) {
  const spans = [];
  for (const w of list) {
    const d = duration(w);
    if (!SHIFTS.includes(w.shift) || !Number.isFinite(d) || d < 15 || d > 16 * 60) {
      return 'Each window needs a shift, valid start/end times, and 15 minutes to 16 hours of duration.';
    }
    spans.push([toMin(w.from), toMin(w.from) + d]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1]) return 'Operating windows must not overlap.';
  return '';
}

export default function MachineCalendar() {
  const [from, setFrom] = useState(today());
  const [data, setData] = useState({ dates: [], machines: [] });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [edit, setEdit] = useState(null);   // { machine, day, rows, error, saving }

  const load = useCallback(async () => {
    setErr('');
    try { setData((await machineCalendarApi.get(from, 7)) || { dates: [], machines: [] }); }
    catch (e) { setErr(e.message || 'Failed to load the machine calendar'); }
  }, [from]);
  useEffect(() => { load(); }, [load]);

  const dates = useMemo(() => (data.dates && data.dates.length ? data.dates
    : Array.from({ length: 7 }, (_, i) => addDays(from, i))), [data.dates, from]);
  const byDept = useMemo(() => {
    const g = new Map();
    (data.machines || []).forEach((m) => {
      const k = m.departmentName || 'No department';
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(m);
    });
    return [...g.entries()];
  }, [data.machines]);
  // V2 metric tiles: capacity of the first calendar day, in total and per shift, summed
  // from the windows the calendar already returned.
  const firstDay = useMemo(() => {
    const per = { A: 0, B: 0, C: 0 };
    (data.machines || []).forEach((m) => {
      const d = (m.days || []).find((x) => x.date === dates[0]);
      (d && d.windows ? d.windows : []).forEach((w) => {
        const len = duration(w);
        if (per[w.shift] != null && Number.isFinite(len)) per[w.shift] += len / 60;
      });
    });
    return { ...per, total: per.A + per.B + per.C };
  }, [data.machines, dates]);
  const h1 = (v) => `${(Math.round(v * 10) / 10).toFixed(1)}h`;

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  function openCell(machine, day) {
    setEdit({ machine, day, rows: (day.windows || []).map((w) => ({ shift: w.shift, from: w.from, to: w.to })), error: '', saving: false });
  }
  const setRow = (i, patch) => setEdit((e) => ({ ...e, error: '', rows: e.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
  const addRow = () => setEdit((e) => {
    const last = e.rows[e.rows.length - 1];
    const next = last ? { shift: last.shift === 'A' ? 'B' : 'C', from: last.to, to: addHours(last.to, 4) } : { shift: 'A', from: '06:00', to: '14:00' };
    return { ...e, error: '', rows: [...e.rows, next] };
  });
  const removeRow = (i) => setEdit((e) => ({ ...e, error: '', rows: e.rows.filter((_, k) => k !== i) }));

  async function run(kind) {
    const { machine, day, rows } = edit;
    if (kind !== 'reset') {
      const v = windowsError(rows);
      if (v) { setEdit((e) => ({ ...e, error: v })); return; }
    }
    setEdit((e) => ({ ...e, saving: true, error: '' }));
    try {
      let r;
      if (kind === 'day') r = await machineCalendarApi.saveDay(machine.id, day.date, rows);
      else if (kind === 'weekly') r = await machineCalendarApi.saveWeekly(machine.id, dowOf(day.date), rows);
      else r = await machineCalendarApi.resetDay(machine.id, day.date);
      setWarnings((r && r.warnings) || []);
      setEdit(null);
      flash(kind === 'weekly' ? `${machine.code}: weekly ${DOW_NAMES[dowOf(day.date)]} pattern saved`
        : kind === 'day' ? `${machine.code}: availability for ${day.date} saved` : `${machine.code}: ${day.date} follows the weekly pattern again`);
      await load();
    } catch (e) {
      setEdit((x) => (x ? { ...x, saving: false, error: e.message || 'Save failed' } : x));
    }
  }

  const hoursOf = (rows) => rows.reduce((s, w) => s + (Number.isFinite(duration(w)) ? duration(w) : 0), 0) / 60;

  return (
    <div className="v2" style={{ marginTop: 4 }}>
      {/* BloomFlex V2 layout: metric tiles → controls → 7-day window grid → guarantee note. */}
      <V2Metrics items={[
        { label: 'Machines configured', value: (data.machines || []).length, detail: 'Plant machine master' },
        { label: 'Calendar days', value: dates.length, detail: 'Weekly planning view' },
        { label: dates[0] === today() ? 'Today capacity' : `Capacity ${dates[0] ? dates[0].slice(5) : ''}`, value: h1(firstDay.total), detail: 'Sum of configured windows' },
        { label: 'Shift A', value: h1(firstDay.A), detail: 'Actual machine windows' },
        { label: 'Shift B', value: h1(firstDay.B), detail: 'Actual machine windows' },
        { label: 'Shift C', value: h1(firstDay.C), detail: 'Overnight if configured' },
      ]} />

      <section className="v2-panel">
        <div className="pl-controls">
          <div className="fg"><label htmlFor="mc-from">Seven-day calendar starts</label>
            <input id="mc-from" type="date" value={from} aria-label="Calendar start date" onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
          <button className="btn btn-s" onClick={() => setFrom(addDays(from, -7))}>← Prev</button>
          <button className="btn btn-s" onClick={() => setFrom(today())}>Today</button>
          <button className="btn btn-s" onClick={() => setFrom(addDays(from, 7))}>Next →</button>
          <V2Note tone="blue">
            Click a cell to set that day's windows, such as <b>06:00–10:00 and 17:00–21:00</b>; a Shift C window may cross midnight.
            ✎ = changed for that date only. A machine with no calendar uses its default hours from Machine Availability.
          </V2Note>
        </div>
      </section>

      {err && <div className="al al-r" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="al al-g" style={{ marginBottom: 12 }}>{msg}</div>}
      {warnings.length > 0 && (
        <div className="al al-y" role="status" style={{ marginBottom: 12 }}>
          Saved — but check these planned jobs:
          <ul style={{ margin: '4px 0 0 16px' }}>{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </div>
      )}

      <V2Panel title={`Machine operating windows · ${dates.length} days`} right={<V2Badge tone="blue">Click any day to edit</V2Badge>}>
        {(data.machines || []).length === 0 ? <div className="v2-empty">No machines configured.</div> : (
          <div className="cal-wrap">
            <table className="cal-grid">
              <thead>
                <tr>
                  <th>Machine / stage</th>
                  {dates.map((d) => (
                    <th key={d}>{DOW_NAMES[dowOf(d)].slice(0, 3)}, {new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}
                      <small>{d}</small></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byDept.flatMap(([dept, list]) => list.map((m) => (
                  <tr key={m.id}>
                    <td className="cal-mach"><b>{m.code} · {m.name}</b><span>{dept}</span></td>
                    {(m.days || []).map((day) => {
                      const off = !day.windows || day.windows.length === 0;
                      return (
                        <td key={day.date} role="button" tabIndex={0}
                          aria-label={`${m.code} ${day.date}`}
                          title={day.source === 'OVERRIDE' ? 'Changed for this date' : day.source === 'WEEKLY' ? 'Weekly pattern' : 'Default hours (no calendar yet)'}
                          onClick={() => openCell(m, day)}
                          onKeyDown={(e) => { if (e.key === 'Enter') openCell(m, day); }}>
                          <div className={'cal-cell' + (off ? ' pl-off' : '') + (day.source === 'OVERRIDE' ? ' ovr' : '')}>
                            <b>
                              {off ? 'OFF' : `${day.hours} h`}
                              {day.source === 'OVERRIDE' && <span title="Date override" style={{ marginLeft: 4 }}>✎</span>}
                              {day.source === 'LEGACY' && <span className="cal-tag">default</span>}
                            </b>
                            <small>{off ? 'No operating window' : String(day.text || '').split(' · ').map((w, i) => (
                              <span key={i} style={{ display: 'block', whiteSpace: 'nowrap' }}>{i > 0 && <span style={{ display: 'none' }}> · </span>}{w}</span>))}</small>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </V2Panel>

      <V2Note>
        <b>Scheduling guarantee:</b> a window change cannot silently strand planned work — a change that would put a started
        job outside the operating windows is refused, and planned jobs that no longer fit are listed for you to reschedule.
        Unpublished drafts should be regenerated after changing availability.
      </V2Note>

      <Modal open={!!edit} onClose={() => setEdit(null)} wide
        title={edit ? `${edit.machine.code} · ${edit.machine.name} · ${DOW_NAMES[dowOf(edit.day.date)]} ${edit.day.date}` : ''}
        footer={edit && (<>
          <button className="btn btn-s" disabled={edit.saving || edit.day.source !== 'OVERRIDE'} onClick={() => run('reset')}>Use weekly pattern</button>
          <button className="btn btn-s" disabled={edit.saving} onClick={() => run('weekly')}>Save as weekly {DOW_NAMES[dowOf(edit.day.date)]} pattern</button>
          <button className="btn btn-s" disabled={edit.saving} onClick={() => setEdit(null)}>Cancel</button>
          <button className="btn btn-g" disabled={edit.saving} onClick={() => run('day')}>Save for this date</button>
        </>)}>
        {edit && (
          <div>
            <div className="pg-sub" style={{ marginBottom: 10 }}>
              Current: <b>{edit.day.text}</b> ({edit.day.source === 'OVERRIDE' ? 'changed for this date' : edit.day.source === 'WEEKLY' ? 'weekly pattern' : 'default hours'}).
              For an overnight Shift C, an end time earlier than the start means the next morning.
              New total: <b>{hoursOf(edit.rows).toFixed(2)} h</b>.
            </div>
            {edit.rows.length === 0 && <div className="al al-y">No windows — the machine is OFF on this date. Add a window to make it available.</div>}
            {edit.rows.map((r, i) => (
              <div key={i} className="fbar" style={{ marginBottom: 6 }}>
                <select aria-label={`Window ${i + 1} shift`} value={r.shift} onChange={(e) => setRow(i, { shift: e.target.value })}>
                  {SHIFTS.map((s) => <option key={s} value={s}>Shift {s}</option>)}
                </select>
                <input type="time" aria-label={`Window ${i + 1} from`} value={r.from} onChange={(e) => setRow(i, { from: e.target.value })} />
                <span>–</span>
                <input type="time" aria-label={`Window ${i + 1} to`} value={r.to} onChange={(e) => setRow(i, { to: e.target.value })} />
                <button className="btn btn-r" aria-label={`Remove window ${i + 1}`} onClick={() => removeRow(i)}>✕</button>
              </div>
            ))}
            <button className="btn btn-s" onClick={addRow}>＋ Add window</button>
            {edit.error && <div className="al al-r" role="alert" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{edit.error}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function addHours(t, h) {
  const m = toMin(t);
  if (!Number.isFinite(m)) return '18:00';
  const x = (m + h * 60) % 1440;
  return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
}
