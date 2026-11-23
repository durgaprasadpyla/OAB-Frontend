import { useState, useEffect, useCallback, useMemo } from 'react';
import { masterApi, planningApi } from '../api.js';
import { today } from '../lib/format.js';
import { autoPlannerApi, hhmm, saveText } from '../lib/autoPlannerApi.js';
import { V2Metrics, V2Panel, V2Badge, V2Note } from './V2Ui.jsx';
import '../v2-planner.css';

// BloomFlex V2 — 3-Day Planner (PPC tab). The server lays every Ready-to-Plan SO's route
// stages into the machines' calendar windows as a DRAFT (stage N+1 never before stage N,
// never over an existing job); the PPC reviews it here — 3 day columns × machines × shift
// lanes — then publishes it (all or nothing: the server re-validates and lists every
// problem) or clears it. Drafts are also visible, badged, on the Daily Planning board;
// MIS / production only ever see published jobs.
// Layout follows the V2 prototype planner: actions → metric tiles → controls → (left)
// Ready-to-plan queue + (centre) Today / Tomorrow / Day after tomorrow → bottom panels.

const DAYS = 3;
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmtQty = (v) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const dayLabel = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
const dayLong = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const hrs = (minutes) => (Math.round(num(minutes) / 6) / 10).toFixed(1);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const RELATIVE = ['Today', 'Tomorrow', 'Day after tomorrow'];
/** Minutes a job occupies: its placed span, else the estimate. */
const jobMinutes = (j) => (j.startAbs != null && j.endAbs != null ? Math.max(0, num(j.endAbs) - num(j.startAbs)) : num(j.estMinutes));
const winMinutes = (w) => {
  if (w.startMin != null && w.endMin != null) return Math.max(0, num(w.endMin) - num(w.startMin));
  const t = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  const a = t(w.from), b = t(w.to);
  return Number.isFinite(a) && Number.isFinite(b) ? (b > a ? b - a : b + 1440 - a) : 0;
};

/** "22:00–02:30 (+1)" — an end past midnight belongs to the next morning. */
export function timeRange(j) {
  const s = j.startAbs != null ? hhmm(j.startAbs) : (j.startTime || '—');
  const e = j.endAbs != null ? hhmm(j.endAbs) : (j.endTime || '—');
  return `${s}–${e}${num(j.endAbs) > 1440 ? ' (+1)' : ''}`;
}

export default function ThreeDayPlanner() {
  const [from, setFrom] = useState(today());
  const [department, setDepartment] = useState('');
  const [priority, setPriority] = useState('FIFO');
  const [departments, setDepartments] = useState([]);
  const [data, setData] = useState({ dates: [], machines: [], jobs: [], metrics: {} });
  const [pool, setPool] = useState([]);                 // Ready-to-plan queue (routeProgress per SO)
  const [unplaced, setUnplaced] = useState(null);       // last generate's list (null = not run yet)
  const [publishErrors, setPublishErrors] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    masterApi.listDepartments().then((d) => setDepartments(Array.isArray(d) ? d : [])).catch(() => setDepartments([]));
  }, []);

  const load = useCallback(async () => {
    setErr('');
    // The queue is a side view: a pool hiccup never blanks the plan.
    planningApi.pool().then((p) => setPool(Array.isArray(p) ? p : [])).catch(() => setPool([]));
    try {
      const b = await autoPlannerApi.board(from, DAYS, department || undefined);
      setData(b && typeof b === 'object' ? b : { dates: [], machines: [], jobs: [], metrics: {} });
    } catch (e) { setErr(e.message || 'Failed to load the plan'); }
  }, [from, department]);
  useEffect(() => { load(); }, [load]);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };
  const dates = useMemo(() => (data.dates && data.dates.length ? data.dates.slice(0, DAYS)
    : Array.from({ length: DAYS }, (_, i) => addDays(from, i))), [data.dates, from]);
  const m = data.metrics || {};
  const drafts = num(m.drafts);

  // jobs keyed machine|date|shift, in time order
  const lanes = useMemo(() => {
    const g = new Map();
    (data.jobs || []).forEach((j) => {
      const k = `${j.machineId}|${j.planDate}|${j.shift || 'A'}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(j);
    });
    g.forEach((list) => list.sort((a, b) => num(a.startAbs) - num(b.startAbs)));
    return g;
  }, [data.jobs]);

  // Ready-to-plan queue: each SO with its next route stage still to plan (FIFO = pool order).
  // A department filter narrows it to SOs with an unplanned stage in that department.
  const queue = useMemo(() => (pool || []).filter((p) => !p.fullyPlanned).map((p) => {
    const stages = p.routeProgress || [];
    const idx = department
      ? stages.findIndex((st) => !st.planned && String(st.departmentId) === String(department))
      : stages.findIndex((st) => !st.planned);
    return { p, stages, idx };
  }).filter((q) => (department ? q.idx >= 0 : true)), [pool, department]);
  const openStages = useMemo(() => queue.reduce((s, q) => s + q.stages.filter((st) => !st.planned
    && (!department || String(st.departmentId) === String(department))).length, 0), [queue, department]);

  async function run(kind) {
    setBusy(kind); setErr(''); setPublishErrors([]);
    try {
      if (kind === 'generate') {
        const r = await autoPlannerApi.generate({ from, days: DAYS, priority, departmentId: department ? Number(department) : undefined });
        setUnplaced(r.unplaced || []);
        flash(`${r.created || 0} draft segment(s) scheduled${(r.unplaced || []).length ? ` · ${(r.unplaced || []).length} stage(s) could not be placed` : ''}.`);
      } else if (kind === 'publish') {
        const r = await autoPlannerApi.publish(from, DAYS);
        flash(`${r.published || 0} job(s) published — they are now the plan the floor follows.`);
      } else if (kind === 'clear') {
        const r = await autoPlannerApi.clear(from, DAYS);
        setUnplaced(null);
        flash(`${r.deleted || 0} draft job(s) cleared.`);
      } else if (kind === 'sheet') {
        const csv = await autoPlannerApi.sheet(from, DAYS, department || undefined);
        saveText(typeof csv === 'string' ? csv : '', `plan-${from}-${DAYS}d.csv`);
        flash('Plan sheet downloaded.');
      }
      if (kind !== 'sheet') await load();
    } catch (e) {
      setErr(e.message || 'Failed');
      if (kind === 'publish' && Array.isArray(e.errors)) setPublishErrors(e.errors);
    } finally { setBusy(''); }
  }

  const machines = data.machines || [];
  const dayOf = (mc, d) => (mc.days || []).find((x) => x.date === d) || { windows: [] };
  const capOf = (mc, d) => { const day = dayOf(mc, d); return day.capacityMinutes != null ? num(day.capacityMinutes) : (day.windows || []).reduce((s, w) => s + winMinutes(w), 0); };
  const usedOf = (mcId, d) => (data.jobs || []).filter((j) => j.machineId === mcId && j.planDate === d).reduce((s, j) => s + jobMinutes(j), 0);
  const startRel = daysBetween(today(), dates[0] || from);

  return (
    <div className="v2" style={{ marginTop: 4 }}>
      <div className="pl-actions">
        <button className="btn btn-g" disabled={!!busy || data.available === false} onClick={() => run('generate')}>
          {busy === 'generate' ? 'Generating…' : '⚙ Auto-generate draft'}</button>
        <button className="btn btn-ok" disabled={!!busy || drafts === 0} onClick={() => run('publish')}
          title={drafts === 0 ? 'No draft jobs in these 3 days' : 'Validate and publish every draft in these 3 days'}>
          {busy === 'publish' ? 'Publishing…' : '✓ Publish draft'}</button>
      </div>

      <V2Metrics items={[
        { label: 'Ready SOs', value: num(m.readySos), detail: 'Marked Ready to Plan' },
        { label: 'Unplanned stage tasks', value: openStages, detail: 'Still to plan on a machine' },
        { label: 'Draft jobs', value: <span data-testid="tdp-drafts">{drafts}</span>, detail: 'Awaiting publish', tone: drafts ? 'warn' : '' },
        { label: 'Published jobs', value: num(m.published), detail: 'The plan the floor follows', tone: 'good' },
        { label: 'Unplaced stages', value: unplaced ? unplaced.length : '—', detail: 'From the last auto-generate', tone: unplaced && unplaced.length ? 'danger' : '' },
        { label: '3-day capacity used', value: `${num(m.usagePct)}%`, tone: num(m.usagePct) > 100 ? 'danger' : '',
          detail: `${hrs(m.usedMinutes)} / ${hrs(m.capacityMinutes)} h · ${Math.round(num(m.usedMinutes))} of ${Math.round(num(m.capacityMinutes))} min` },
      ]} />

      <section className="v2-panel">
        <div className="pl-controls">
          <div className="fg"><label htmlFor="tdp-from">Start date</label>
            <input id="tdp-from" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
          <div className="fg"><label htmlFor="tdp-dept">Department</label>
            <select id="tdp-dept" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></div>
          <div className="fg"><label htmlFor="tdp-prio">Priority</label>
            <select id="tdp-prio" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="FIFO">FIFO (PO date)</option>
              <option value="DUE">Earliest due</option>
            </select></div>
          <button className="btn btn-s" disabled={!!busy || drafts === 0} onClick={() => run('clear')}>✕ Clear drafts</button>
          <button className="btn btn-s" disabled={!!busy} onClick={() => run('sheet')}>⬇ Download plan sheet (CSV)</button>
          <span className="pl-hint">
            Drafts are placed inside each machine's calendar windows from {dayLabel(dates[0])} to {dayLabel(dates[dates.length - 1])},
            stage by stage, never over an existing job. Nothing reaches MIS or production until it is published.
            {department && ' Generating with a department filter only places that department\'s stages.'}
          </span>
        </div>
      </section>

      {err && <div className="al al-r" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="al al-g" role="status" style={{ marginBottom: 12 }}>{msg}</div>}
      {data.available === false && <div className="al al-y" role="alert" style={{ marginBottom: 12 }}>The auto planner is not available until the database update has run.</div>}

      {publishErrors.length > 0 && (
        <V2Panel title={`Why the draft cannot be published (${publishErrors.length})`} style={{ borderColor: '#ffcfcf' }}>
          <ul className="v2-list">
            {publishErrors.map((e, i) => <li key={i}>{e.message}</li>)}
          </ul>
        </V2Panel>
      )}

      <div className="pl-shell">
        {/* LEFT: Ready-to-plan queue (sticky) */}
        <aside className="pl-side" aria-label="Ready-to-plan queue">
          <V2Panel title="Ready-to-plan queue" sub={`${openStages} unfinished stage task(s)`} right={<V2Badge tone="blue" title="Oldest PO first">FIFO</V2Badge>}>
            <div className="pl-queue">
              {queue.length === 0 ? <div className="v2-empty">No sale orders waiting{department ? ' in this department' : ''} — every ready stage has a draft or published job.</div>
                : queue.map(({ p, stages, idx }) => (
                  <div key={p.so} className="pl-qcard">
                    <div className="pl-row">
                      <span className="pl-so">{p.so}</span>
                      <span className={'tag ' + (p.readyMode === 'PARTIAL' ? 'ty' : 'tg')}>{p.readyMode === 'PARTIAL' ? 'Partial' : 'Complete'}</span>
                    </div>
                    <div className="pl-desc"><b>{p.spec}</b>{p.jobName ? ` · ${p.jobName}` : ''}</div>
                    {idx >= 0 && <span className="pl-stage">{stages[idx].departmentName} · Stage {idx + 1}/{stages.length}</span>}
                    <div className="pl-small">Ready {fmtQty(p.readyQty)}{p.poQty != null ? ` · PO qty ${fmtQty(p.poQty)}` : ''}</div>
                    {idx >= 0 && <div className="pl-small">{num(stages[idx].remaining) > 0 ? `${fmtQty(stages[idx].remaining)} m still to plan` : 'Waiting on the previous stage'}
                      {' · '}<span className="pl-good">{stages.filter((st) => st.planned).length}/{stages.length} stages planned</span></div>}
                  </div>
                ))}
            </div>
          </V2Panel>
        </aside>

        {/* CENTRE: Today / Tomorrow / Day after tomorrow */}
        <section className="pl-board" aria-label={`Machines × ${DAYS} days`}>
          {machines.length === 0 ? <V2Panel pad><div className="v2-empty">No active machines{department ? ' in this department' : ''}.</div></V2Panel> : (
            <div className="pl-days">
              {dates.map((d, di) => {
                const cap = machines.reduce((s, mc) => s + capOf(mc, d), 0);
                const used = machines.reduce((s, mc) => s + usedOf(mc.id, d), 0);
                const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
                const rel = startRel + di;
                return (
                  <div key={d} className="pl-day">
                    <div className="pl-day-head">
                      <div>
                        <div className="v2-overline">{rel >= 0 && rel < RELATIVE.length ? RELATIVE[rel] : `Day ${di + 1}`}</div>
                        <strong>{dayLong(d)}</strong>
                      </div>
                      <V2Badge tone={pct > 100 ? 'red' : pct >= 95 ? 'amber' : 'blue'}>{pct}% planned</V2Badge>
                    </div>
                    {machines.map((mc) => {
                      const day = dayOf(mc, d);
                      const mcCap = capOf(mc, d), mcUsed = usedOf(mc.id, d);
                      const off = !(day.windows || []).length;
                      const shifts = [...new Set(['A', 'B', ...(day.windows || []).map((w) => w.shift),
                        ...(data.jobs || []).filter((j) => j.machineId === mc.id && j.planDate === d).map((j) => j.shift || 'A')])].sort();
                      return (
                        <div key={mc.id} className="pl-mach" aria-label={`${mc.code} ${d}`}>
                          <div className="pl-mach-top">
                            <div style={{ minWidth: 0 }}>
                              <b>{mc.code} · {mc.name}</b>
                              <div className="pl-small">{hrs(mcUsed)} / {hrs(mcCap)} h used{mc.departmentName ? ` · ${mc.departmentName}` : ''}</div>
                            </div>
                            {off ? <span className="tag tgr">OFF</span>
                              : <div className={'pl-bar' + (mcUsed > mcCap ? ' over' : '')}><span style={{ width: Math.min(100, mcCap ? (mcUsed / mcCap) * 100 : 0) + '%' }} /></div>}
                          </div>
                          {shifts.map((sh) => {
                            const ws = (day.windows || []).filter((w) => w.shift === sh);
                            const jobs = lanes.get(`${mc.id}|${d}|${sh}`) || [];
                            const avail = ws.reduce((s, w) => s + winMinutes(w), 0);
                            const usedSh = jobs.reduce((s, j) => s + jobMinutes(j), 0);
                            const none = ws.length === 0;
                            return (
                              <div key={sh} className={'pl-shift' + (none ? ' pl-off' : '')}>
                                <div className="pl-shift-head">
                                  <span>Shift {sh}{ws.length ? ' · ' + ws.map((w) => `${w.from}–${w.to}${w.overnight ? ' (+1)' : ''}`).join(', ') : ' · Not available'}</span>
                                  <span>{hrs(usedSh)} / {hrs(avail)} h</span>
                                </div>
                                {jobs.length === 0
                                  ? <div className="pl-empty">{none ? 'No availability' : `Free · available ${hrs(avail)} h`}</div>
                                  : jobs.map((j) => {
                                    const draft = j.planStatus === 'DRAFT';
                                    return (
                                      <div key={j.id} data-testid="tdp-job" className={'pl-job' + (draft ? '' : ' pub')}>
                                        <div className="pl-row">
                                          <span className="pl-so">{j.so}</span>
                                          <span className={'tag ' + (draft ? 'ty' : 'tg')}>{draft ? 'Draft' : 'Published'}</span>
                                        </div>
                                        <div className="pl-info">{j.stageSeq != null ? `S${j.stageSeq} · ` : ''}{j.departmentName}</div>
                                        <div className="pl-info"><b>{timeRange(j)}</b> · {fmtQty(j.plannedQty)} m</div>
                                        {j.customer && <div className="pl-info">{j.customer}</div>}
                                      </div>
                                    );
                                  })}
                                {none && jobs.length === 0 && <div className="pl-danger">Unavailable: scheduling prohibited</div>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          <div className="pl-audit">Drafts sit inside each machine&rsquo;s calendar windows; stage dependencies are enforced by Auto-generate and re-checked on Publish.</div>
        </section>
      </div>

      {/* Bottom panels: recommendations · stages not placed · planner controls */}
      <div className="pl-grid3">
        <V2Panel title="Planning recommendations">
          <ul className="v2-list">
            <li><b>{priority === 'DUE' ? 'Earliest-due scheduling' : 'FIFO scheduling'}</b>
              {priority === 'DUE' ? 'Orders with the nearest due date are placed first.' : 'Orders are placed oldest PO first; switch to Earliest due if approved.'}</li>
            <li><b>Stage dependencies</b>A route stage never starts before the previous stage of the same sale order finishes.</li>
            <li><b>Calendar-aware</b>Jobs are placed only inside each machine&rsquo;s Machine Calendar windows and never over an existing job.</li>
            <li><b>Review before publish</b>Drafts stay reviewable here and on the Daily Planning board until they are published.</li>
          </ul>
        </V2Panel>
        <V2Panel title={`Not placed in these ${DAYS} days${unplaced ? ` (${unplaced.length})` : ''}`}>
          {!unplaced ? <div className="v2-empty">Run Auto-generate to see any stage that could not be placed.</div>
            : unplaced.length === 0 ? <div className="v2-empty">Every ready stage fitted in the {DAYS}-day window.</div> : (
              <div className="tw" style={{ maxHeight: 320, overflow: 'auto' }}>
                <table>
                  <thead><tr><th>SO</th><th>Stage</th><th>Department</th><th>Qty left</th><th>Reason</th></tr></thead>
                  <tbody>
                    {unplaced.map((u, i) => (
                      <tr key={i}><td><span className="pl-so">{u.so}</span></td><td>{u.stage ?? '—'}</td><td>{u.department || '—'}</td>
                        <td>{u.remainingQty != null ? fmtQty(u.remainingQty) : '—'}</td><td style={{ whiteSpace: 'normal' }}>{u.reason}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </V2Panel>
        <V2Panel title="Planner controls" pad>
          <V2Note tone="blue"><b>Draft → review → publish.</b> Publishing re-validates every draft and lists each problem; published jobs are
            kept when you generate again, and drafts can be cleared without touching them.</V2Note>
          <div className="pl-legend">
            <span><i style={{ background: '#eef6ff', borderLeft: '3px solid #2581e6' }} /> Draft</span>
            <span><i style={{ background: '#eefbf3', borderLeft: '3px solid #0c995c' }} /> Published</span>
            <span><i className="pl-off" /> No window</span>
          </div>
        </V2Panel>
      </div>
    </div>
  );
}
