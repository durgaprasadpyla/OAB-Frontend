import { useState } from 'react';
import { planningApi } from '../api.js';
import { exportAOA } from '../lib/xlsx.js';
import { today } from '../lib/format.js';

// §55/§63: the weekly and the daily plan the PPC has saved, downloadable as .xlsx —
// by the PLAN login (readiness page), the planner/PPC (Weekly Planner) AND the
// Plant login. One shared card so every login exports the identical sheet, incl.
// shift, derived start/end times and the §56 CHANGED marker.

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default function PlanDownloads({ compact = false }) {
  const [dailyDate, setDailyDate] = useState(today());
  const [weekFrom, setWeekFrom] = useState(today());
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

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
    <div className="card" style={compact ? { marginTop: 12 } : undefined}>
      <div className="ctitle">Download plans</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}
      {msg && <div className="al al-g" style={{ margin: '8px 0' }}>{msg}</div>}
      <div className="fbar">
        <div className="fg" style={{ margin: 0 }}><label>Daily plan — date</label><input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} /></div>
        <button className="btn btn-s" onClick={() => download('daily')}>⬇ Daily Plan (xlsx)</button>
        <div className="fg" style={{ margin: 0, marginLeft: 16 }}><label>Weekly plan — week from</label><input type="date" value={weekFrom} onChange={(e) => setWeekFrom(e.target.value)} /></div>
        <button className="btn btn-s" onClick={() => download('weekly')}>⬇ Weekly Plan (xlsx)</button>
      </div>
    </div>
  );
}
