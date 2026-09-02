import { useState } from 'react';
import { planningApi } from '../api.js';
import { exportAOA } from '../lib/xlsx.js';
import { elementToPDF } from '../lib/pdf.js';
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
  const [fmt, setFmt] = useState('xlsx');   // §8: department-wise, in either format

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  /**
   * Issues 2.4 §8 — the same plan, grouped by DEPARTMENT.
   *
   * The flat sheet above is the machine-by-machine schedule; each department head
   * wants only their own stretch of it. Same jobs, same numbers, one block per
   * department in route order, with that department's job count and total minutes.
   */
  function byDepartment(jobs) {
    const groups = [];
    const seen = new Map();
    [...jobs]
      .sort((a, b) => String(a.departmentName || '').localeCompare(String(b.departmentName || ''))
        || String(a.planDate).localeCompare(String(b.planDate))
        || String(a.machineName || '').localeCompare(String(b.machineName || '')))
      .forEach((j) => {
        const dept = String(j.departmentName || '').trim() || 'Unassigned';
        if (!seen.has(dept)) { const g = { department: dept, jobs: [], minutes: 0, qty: 0 }; seen.set(dept, g); groups.push(g); }
        const g = seen.get(dept);
        g.jobs.push(j); g.minutes += num(j.estMinutes); g.qty += num(j.plannedQty);
      });
    return groups;
  }

  const DEPT_COLS = ['Date', 'Shift', 'Sale Order', 'Spec', 'Machine', 'Planned Qty', 'Start', 'End', 'Est Min', 'Status', 'Changed'];
  const deptRow = (j) => [j.planDate, j.shift || 'A', j.so, j.specCode, j.machineName, num(j.plannedQty),
    j.startTime || '', j.endTime || '', Math.round(num(j.estMinutes)), j.status, j.changed ? 'CHANGED' : ''];

  async function downloadByDept(kind) {
    setErr('');
    const from = kind === 'daily' ? dailyDate : weekFrom;
    const to = kind === 'daily' ? dailyDate : addDays(weekFrom, 6);
    try {
      const w = await planningApi.week(from, to);
      const jobs = (w && w.jobs) || [];
      if (jobs.length === 0) { flash('No planned jobs in that range to download.'); return; }
      const groups = byDepartment(jobs);
      const stem = `Department_Plan_${from}` + (kind === 'daily' ? '' : `_to_${to}`);

      if (fmt === 'xlsx') {
        const aoa = [['Department-wise production plan'], ['Range', from === to ? from : `${from} to ${to}`], ['Printed', today()], []];
        groups.forEach((g) => {
          aoa.push([g.department]);
          aoa.push(DEPT_COLS);
          g.jobs.forEach((j) => aoa.push(deptRow(j)));
          aoa.push(['', '', '', '', 'Total', Math.round(g.qty), '', '', Math.round(g.minutes), '', '']);
          aoa.push([]);
        });
        exportAOA(aoa, stem, 'Plan by Department');
      } else {
        const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const blocks = groups.map((g) => {
          const body = g.jobs.map((j) => '<tr style="border-bottom:1px solid #eee">'
            + deptRow(j).map((c, k) => `<td style="padding:4px 6px;text-align:${k >= 5 && k !== 6 && k !== 7 ? 'right' : 'left'}">${esc(c)}</td>`).join('')
            + '</tr>').join('');
          return '<div style="margin-bottom:14px;page-break-inside:avoid">'
            + `<div style="font-size:12px;font-weight:700;color:#0e6fb8;margin-bottom:4px">${esc(g.department)}`
            + `<span style="font-weight:400;color:#666"> — ${g.jobs.length} job(s) · ${Math.round(g.minutes)} min</span></div>`
            + '<table style="width:100%;border-collapse:collapse;font-size:10.5px"><thead><tr style="background:#0e6fb8;color:#fff">'
            + DEPT_COLS.map((h) => `<th style="padding:5px 6px;text-align:left">${esc(h)}</th>`).join('')
            + `</tr></thead><tbody>${body}</tbody></table></div>`;
        }).join('');
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;padding:16px;font-family:Arial,sans-serif;width:900px;color:#111';
        wrap.innerHTML = '<div style="font-size:16px;font-weight:800;color:#0e6fb8;margin-bottom:6px">Production plan by department</div>'
          + `<div style="font-size:11px;color:#444;margin-bottom:10px">${esc(from === to ? from : `${from} to ${to}`)} · printed ${esc(today())}</div>${blocks}`;
        document.body.appendChild(wrap);
        try { await elementToPDF(wrap, stem, { orientation: 'landscape' }); }
        finally { document.body.removeChild(wrap); }
      }
      flash(`Downloaded ${jobs.length} planned job(s) across ${groups.length} department(s).`);
    } catch (e) { setErr(e.message || 'Download failed'); }
  }

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
      {/* §8: the PPC's plan, split the way the floor reads it — one block per department. */}
      <div className="fbar" style={{ marginTop: 4 }}>
        <span className="pg-sub" style={{ margin: 0 }}>Department-wise, from the PPC's plan:</span>
        <select value={fmt} onChange={(e) => setFmt(e.target.value)} aria-label="Department-wise plan format" style={{ height: 28 }}>
          <option value="xlsx">Excel</option>
          <option value="pdf">PDF</option>
        </select>
        <button className="btn btn-s" onClick={() => downloadByDept('daily')}>⬇ Day by Department</button>
        <button className="btn btn-s" onClick={() => downloadByDept('weekly')}>⬇ Week by Department</button>
      </div>
    </div>
  );
}
