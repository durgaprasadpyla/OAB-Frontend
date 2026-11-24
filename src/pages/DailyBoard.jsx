import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { planningApi, masterApi } from '../api.js';
import { today } from '../lib/format.js';
import Modal from '../components/Modal.jsx';
import { ArtworkButton } from '../components/Artwork.jsx';
import { machineCalendarApi } from '../lib/machineCalendarApi.js';
import { V2Page } from '../components/V2Ui.jsx';
import '../v2-planner.css';

// Daily machine board (Stage 7 + Enhancements 2.0 §77-80): machines grouped by
// department, each machine split into Shift A (day) and Shift B (night) drop zones.
// Drag a Ready-to-Plan SO onto a shift to plan it (with a full/partial quantity
// prompt), drag a planned job card onto another machine or shift to move it, and
// reorder within a machine. Every job card shows its derived start–end time (§80),
// and a job edited after first save is highlighted as a plan change (§56).

const mins = (v) => (v == null ? 0 : Math.round(Number(v)));
const SHIFTS = [{ k: 'A', label: 'Shift A · day' }, { k: 'B', label: 'Shift B · night' }];
// BloomFlex V2: a machine whose calendar has a Shift C window that day gets a C zone.
const SHIFT_C = { k: 'C', label: 'Shift C · overnight' };

export default function DailyBoard({ embedded = false }) {
  const [date, setDate] = useState(today());
  const [pool, setPool] = useState([]);
  const [machines, setMachines] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [board, setBoard] = useState({ jobs: [], capacity: [] });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [warn, setWarn] = useState(null);      // { machineId, date } over-booked notice
  const [drop, setDrop] = useState(null);       // pending SO->machine drop (assign modal)
  // Issues 2.5 — drag/drop feedback. `dragging` is what is currently in the user's
  // hand ({kind:'so'|'job', ...}); `hover` is the "machineId|shift" zone under the
  // pointer. Both are UI-only: a drag that is dropped nowhere leaves no trace.
  const [dragging, setDragging] = useState(null);
  const [hover, setHover] = useState('');
  // Board filters — VIEW ONLY: they hide queue cards, machines and shifts, never a plan.
  // Kept while the date changes or the board refreshes.
  const [qText, setQText] = useState('');      // queue: SO / spec / job / route
  const [qDept, setQDept] = useState('');      // queue: still to plan at this department
  const [qReady, setQReady] = useState('');    // queue: COMPLETE | PARTIAL
  const [fDept, setFDept] = useState('');      // machines: department
  const [fMachine, setFMachine] = useState(''); // machines: one machine
  const [fShift, setFShift] = useState('');    // machines: one shift
  const [fSo, setFSo] = useState('');          // machines: where an SO is planned
  const [fShow, setFShow] = useState('');      // machines: '' | 'jobs' | 'free'
  const clearFilters = () => { setQText(''); setQDept(''); setQReady(''); setFDept(''); setFMachine(''); setFShift(''); setFSo(''); setFShow(''); };
  // A drop fires dragend + drop, and the modal's Plan it can be double-clicked; this
  // guard makes an assign/move idempotent per gesture so the SO cannot be planned twice.
  const busy = useRef(false);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  const load = useCallback(async () => {
    setErr('');
    try {
      const [p, m, d, b] = await Promise.all([planningApi.pool(), masterApi.listMachines(), masterApi.listDepartments(), planningApi.week(date, date)]);
      setPool(p || []); setMachines(m || []); setDepartments(d || []); setBoard(b || { jobs: [], capacity: [] });
    } catch (e) { setErr(e.message || 'Failed to load board'); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  // BloomFlex V2 — the machines' real windows for this date (Machine Calendar). Kept
  // apart from load() so a calendar hiccup never blanks the board.
  const [cal, setCal] = useState({});
  useEffect(() => {
    let live = true;
    machineCalendarApi.get(date, 1)
      .then((r) => { if (!live) return; const m = {}; ((r && r.machines) || []).forEach((mc) => { m[String(mc.id)] = (mc.days || [])[0]; }); setCal(m); })
      .catch(() => { if (live) setCal({}); });
    return () => { live = false; };
  }, [date, board]);
  const calDay = (machineId) => cal[String(machineId)];
  const shiftsFor = (machineId) => {
    const d = calDay(machineId);
    return d && (d.windows || []).some((w) => w.shift === 'C') ? [...SHIFTS, SHIFT_C] : SHIFTS;
  };
  // The window text for a shift, or null when a configured machine has none that day.
  const shiftWindows = (machineId, shift) => {
    const d = calDay(machineId);
    if (!d) return '';
    const ws = (d.windows || []).filter((w) => w.shift === shift);
    if (ws.length) return ws.map((w) => `${w.from}–${w.to}`).join(', ');
    return d.source === 'LEGACY' ? '' : null;
  };

  const machinesByDept = useMemo(() => {
    const g = {};
    (machines || []).forEach((mc) => { const k = mc.departmentId == null ? 'none' : mc.departmentId; (g[k] = g[k] || []).push(mc); });
    return g;
  }, [machines]);
  const jobsFor = (machineId, shift) => (board.jobs || []).filter((j) => String(j.machineId) === String(machineId) && j.planDate === date
    && (shift ? (j.shift || 'A') === shift : true)).sort((a, b) => (a.seqOrder || 0) - (b.seqOrder || 0));
  const capFor = (machineId) => (board.capacity || []).find((c) => String(c.machineId) === String(machineId) && c.date === date);

  // ── filters ────────────────────────────────────────────────────────────────
  const qMatch = (p) => {
    const t = qText.trim().toLowerCase();
    if (t && ![p.so, p.spec, p.jobName, p.routeName].some((v) => String(v || '').toLowerCase().includes(t))) return false;
    if (qDept && !(p.routeProgress || []).some((st) => !st.planned && String(st.departmentId) === qDept)) return false;
    if (qReady && (p.readyMode === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE') !== qReady) return false;
    return true;
  };
  const soQ = fSo.trim().toLowerCase();
  const soHit = (j) => !!soQ && String(j.so || '').toLowerCase().includes(soQ);
  const machineVisible = (mc) => {
    if (fDept && String(mc.departmentId) !== fDept) return false;
    if (fMachine && String(mc.id) !== fMachine) return false;
    const js = jobsFor(mc.id);
    if (soQ && !js.some(soHit)) return false;
    if (fShow === 'jobs' && js.length === 0) return false;
    if (fShow === 'free') {
      const cap = capFor(mc.id);
      const used = mins(cap?.usedMinutes), capM = mins(cap?.capMinutes) || mins((mc.functionalHoursPerDay || 12) * 60);
      if (used >= capM) return false;
    }
    return true;
  };
  const shownMachines = (machines || []).filter(machineVisible).length;
  const boardFiltered = !!(fDept || fMachine || fShift || soQ || fShow);

  // ── drag/drop ──────────────────────────────────────────────────────────────
  // The payload travels on the dataTransfer (so a drop works even across a re-render)
  // AND in `dragging` state, which is what drives the highlighting: dataTransfer is
  // deliberately unreadable during dragover, so it cannot tell us what is in flight.
  const dragData = (e) => { try { return JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return null; } };
  function startDrag(e, payload) {
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    setDragging(payload);
  }
  const startDragSo = (e, so) => startDrag(e, { kind: 'so', so });
  const startDragJob = (e, jobId) => startDrag(e, { kind: 'job', jobId });
  const endDrag = () => { setDragging(null); setHover(''); };

  // Which machines may accept what is currently being dragged.
  //  · an SO  → any machine eligible on its JSS at a route stage still to be planned
  //             (routeProgress, served by /api/planning/pool)
  //  · a job  → any machine in the same department as the job
  // Nothing in hand → every zone is neutral, so the board looks exactly as before.
  const dropTargetIds = useMemo(() => {
    if (!dragging) return null;
    if (dragging.kind === 'so') {
      const p = (pool || []).find((x) => x.so === dragging.so);
      const stages = (p && p.routeProgress) || [];
      const ids = new Set();
      stages.filter((st) => Number(st.remaining) > 0)
        .forEach((st) => (st.eligibleMachineIds || []).forEach((id) => ids.add(String(id))));
      return ids;
    }
    const job = (board.jobs || []).find((j) => String(j.id) === String(dragging.jobId));
    if (!job) return null;
    return new Set((machines || [])
      .filter((mc) => String(mc.departmentId) === String(job.departmentId))
      .map((mc) => String(mc.id)));
  }, [dragging, pool, board.jobs, machines]);

  const canDropOn = (machineId) => dropTargetIds == null || dropTargetIds.has(String(machineId));

  // Why a machine is dimmed, in the planner's own terms. Only ever shown while a card
  // is in hand, so the board is unchanged at rest.
  const whyNot = (mc) => {
    if (!dragging || canDropOn(mc.id)) return '';
    if (dragging.kind === 'job') return 'different department';
    const p = (pool || []).find((x) => x.so === dragging.so);
    const stage = ((p && p.routeProgress) || []).find((st) => String(st.departmentId) === String(mc.departmentId));
    if (!stage) return 'not a stage for this order';
    if (Number(stage.remaining) <= 0) return 'already fully planned';
    return 'not eligible on this JSS';
  };

  // A zone only accepts the drop when the machine can take what is in hand — so the
  // browser shows the no-drop cursor over the rest instead of swallowing the gesture.
  function allowOn(e, machine, shift) {
    if (!canDropOn(machine.id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const key = machine.id + '|' + shift;
    setHover((h) => (h === key ? h : key));
  }
  const leaveZone = (machine, shift) => setHover((h) => (h === machine.id + '|' + shift ? '' : h));

  async function onDropMachine(e, machine, shift) {
    e.preventDefault();
    e.stopPropagation();
    const d = dragData(e) || dragging;
    endDrag();
    if (!d) return;
    // Repeated drop events from one gesture (and a drop landing while the previous
    // save is still in flight) must not raise a second request.
    if (busy.current) return;
    if (d.kind === 'job') {
      // Move between machines AND between shifts is plain drag-and-drop (§78).
      busy.current = true;
      try { const r = await planningApi.move({ jobId: d.jobId, machineId: machine.id, planDate: date, shift });
        if (r.capacity?.overbooked) setWarn({ machineId: machine.id, name: machine.name });
        flash(`Job moved to ${machine.code} · Shift ${shift}`); await load();
      } catch (e2) { setErr(e2.message); }
      finally { busy.current = false; }
      return;
    }
    if (d.kind === 'so') {
      // Need the department (this machine's) + the SO's remaining there.
      busy.current = true;
      try {
        const sp = await planningApi.soPlan(d.so);
        const dept = (sp.departments || []).find((x) => String(x.departmentId) === String(machine.departmentId));
        if (!dept) { setErr(`SO ${d.so} does not pass through ${deptName(machine.departmentId)} — its route is ${(sp.departments || []).map((x) => x.departmentName).join(' → ') || '(not set)'}`); return; }
        const eligible = (dept.machines || []).some((x) => String(x.machineId) === String(machine.id));
        if (!eligible) { setErr(`${machine.code} is not eligible for SO ${d.so} at ${dept.departmentName} — set it on the JSS (QC → Machines)`); return; }
        if (!(Number(dept.remaining) > 0)) {
          setErr(`SO ${d.so} is already fully planned at ${dept.departmentName} — nothing left to plan there.`);
          return;
        }
        setDrop({ so: d.so, machine, department: dept, remaining: Number(dept.remaining), shift });
      } catch (e2) { setErr(e2.message); }
      finally { busy.current = false; }
    }
  }

  // The modal's Plan it. Guarded so a double-click cannot raise two assigns; the
  // error is re-thrown so DropForm keeps the form open and shows it (the SO stays in
  // the pool, exactly where it was, when the server refuses).
  async function doAssign(qty) {
    const { so, machine, department, shift } = drop;
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await planningApi.assign({ so, departmentId: department.departmentId, stageSeq: department.seq ?? undefined, machineId: machine.id, planDate: date, plannedQty: qty, shift });
      setDrop(null);
      if (r.capacity?.overbooked) setWarn({ machineId: machine.id, name: machine.name });
      flash(r.capacity?.overbooked
        ? `${so} planned on ${machine.code} · Shift ${shift} — machine is over-booked`
        : `${so} planned on ${machine.code} · Shift ${shift}`);
      await load();
    } finally { busy.current = false; }
  }
  async function removeJob(jobId) { try { await planningApi.unassign(jobId); flash('Removed'); await load(); } catch (e) { setErr(e.message); } }

  /**
   * Issues 2.4 §5 — the PPC's own start time for one job. Blank hands the job back
   * to the shift queue. Reloads, because everything behind it on that machine moves.
   */
  async function setStart(job, value) {
    const next = String(value || '').trim();
    const now = job.startTime || '';
    if (next === now && job.startMin != null) return;      // unchanged
    if (!next && job.startMin == null) return;             // still following the queue
    try {
      await planningApi.setJobStart(job.id, next);
      flash(next ? `${job.so} starts at ${next}` : `${job.so} follows the shift queue again`);
      await load();
    } catch (e) { setErr(e.message); }
  }
  async function moveWithin(machineId, jobIds) { try { await planningApi.reorder({ machineId, date, jobIds }); await load(); } catch (e) { setErr(e.message); } }
  const bump = (machineId, jobId, dir) => {
    const ids = jobsFor(machineId).map((j) => j.id);
    const i = ids.indexOf(jobId); const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    moveWithin(machineId, ids);
  };

  const deptName = (id) => (departments.find((d) => String(d.id) === String(id)) || {}).name || 'Unassigned';

  // C4: the SOs waiting for THIS machine — its department is one the SO's material is
  // currently at (C5: a completed-partial/whole stage feeds the next one), the machine
  // is eligible on the JSS, and the SO hasn't already been dropped on a sibling
  // machine of the same department.
  const waitingFor = (mc) => (pool || []).filter((p) => {
    if (p.fullyPlanned) return false;
    const w = (p.waiting || []).find((x) => String(x.departmentId) === String(mc.departmentId));
    if (!w) return false;
    if (!(w.eligibleMachineIds || []).some((id) => String(id) === String(mc.id))) return false;
    const assigned = w.assignedMachineIds || [];
    return assigned.length === 0 || assigned.some((id) => String(id) === String(mc.id));
  });

  return (
    // BloomFlex V2 look: controls panel → sticky queue on the left + machine cards
    // with one shift row (drop zone) each, as in the V2 planner.
    <V2Page id={embedded ? undefined : 'app'}>
      {!embedded && <div className="pg-ttl">📋 Daily Machine Board</div>}
      <div className="pg-sub">Drag a Ready-to-Plan SO onto a machine to plan it; drag a job card to another machine to move it. Capacity = quantity ÷ speed + changeover.</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}
      {msg && <div className="al al-g" style={{ margin: '8px 0' }}>{msg}</div>}
      {warn && (
        <div className="al al-y" style={{ margin: '8px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠ <b>{warn.name}</b> is over-booked for {date}. Move a job to another machine or adjust its hours in the Weekly Planner.</span>
          <button className="btn btn-s" onClick={() => setWarn(null)}>Dismiss</button>
        </div>
      )}

      <section className="v2-panel">
        <div className="pl-controls">
          <div className="fg"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <button className="btn btn-s" onClick={load}>↻ Refresh</button>
        </div>
      </section>

      {/* Issues 2.4 §6: machines FIRST, the pool underneath. Side by side, the
          pouching machines sat below the fold of their own scroller, so dragging an
          order onto one meant scrolling the right-hand column while holding the
          card. Stacked, the drop targets are all on one page and the drag is short. */}
      {/* BloomFlex V2: the Ready-to-Plan queue is a LEFT column, as in the V2 design.
          It is sticky (stays on screen while the machines scroll past), so the card
          being dragged and the shift it goes onto are visible together — the reason
          Issues 3.0 made it a sticky footer still holds. Stacks on narrow screens. */}
      <div className="board-shell">
        {/* Issues 3.0: "once I select a sale order from the bottom and I scroll up in
            the middle, the selection is going away." A drag ends the moment the pointer
            leaves the card, so a pool that scrolls off the page cannot reach a machine
            further up. The pool is a STICKY footer now: it stays on screen while the
            machines scroll past it, so the card being dragged and the shift it is going
            onto are visible at the same time and the drag is short. */}
        <aside className="card board-queue" aria-label="Ready to Plan">
          {(() => {
            const open = pool.filter((p) => !p.fullyPlanned);
            const done = pool.length - open.length;
            const shown = open.filter(qMatch);
            const queueDepts = departments.filter((d) => open.some((p) => (p.routeProgress || []).some((st) => !st.planned && String(st.departmentId) === String(d.id))));
            return (
              <>
                <div className="ctitle">Ready to Plan <span className="tag ty">{open.length}</span></div>
                {open.length > 0 && (
                  <div className="board-qfilters" aria-label="Filter the Ready to Plan list">
                    <input value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Search SO / spec / job / route"
                      aria-label="Search the Ready to Plan list" />
                    <div className="board-qrow">
                      <select value={qDept} onChange={(e) => setQDept(e.target.value)} aria-label="Waiting at department">
                        <option value="">Waiting at: all</option>
                        {queueDepts.map((d) => <option key={d.id} value={String(d.id)}>{d.name} ({open.filter((p) => (p.routeProgress || []).some((st) => !st.planned && String(st.departmentId) === String(d.id))).length} SO)</option>)}
                      </select>
                      <select value={qReady} onChange={(e) => setQReady(e.target.value)} aria-label="Complete or partial">
                        <option value="">Ready: all</option>
                        <option value="COMPLETE">Complete only</option>
                        <option value="PARTIAL">Partial only</option>
                      </select>
                    </div>
                    {shown.length !== open.length && <div className="pg-sub" style={{ margin: 0 }}>Showing {shown.length} of {open.length}</div>}
                  </div>
                )}
                {open.length === 0 ? <div className="al al-b">No SOs waiting to be planned.</div> : shown.length === 0 ? (
                  <div className="al al-b">No sale orders match the filters.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {shown.map((p) => {
                      const stages = p.routeProgress || [];
                      const doneN = stages.filter((st) => st.planned).length;
                      const held = dragging && dragging.kind === 'so' && dragging.so === p.so;
                      return (
                        <div key={p.so} draggable onDragStart={(e) => startDragSo(e, p.so)} onDragEnd={endDrag}
                          className="queue-card"
                          style={{ border: '1px solid ' + (held ? 'var(--g)' : '#e2eaf5'), opacity: held ? 0.45 : 1 }}>
                          <div className="queue-desc">
                            <span className="so-pill">{p.so}</span> <b>{p.spec}</b> · {p.jobName || ''} · qty {p.poQty}{' '}
                            <ArtworkButton spec={p.spec} compact />{' '}
                            <span className={'tag ' + (p.readyMode === 'PARTIAL' ? 'tb' : 'tg')}>{p.readyMode === 'PARTIAL' ? 'Partial' : 'Complete'}</span>{' '}
                            <span className="tag ty">ready {p.readyQty}</span>
                          </div>
                          {/* Issues 2.5: an SO stays here until EVERY department on its route
                              is planned. The old card showed only a "balance" (ready x stages
                              minus planned) — a number matching no physical quantity — so after
                              a successful drop it looked like nothing had happened. Now the card
                              names the stages still to plan. */}
                          {stages.length > 0 && (
                            <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                              <span className="pg-sub" style={{ margin: 0 }}>Planned {doneN} of {stages.length} stages:</span>
                              {stages.map((st) => (
                                <span key={st.departmentId} className={'tag ' + (st.planned ? 'tg' : 'ty')}
                                  title={st.planned
                                    ? `${st.departmentName}: planned in full (${st.plannedQty})`
                                    : `${st.departmentName}: ${st.remaining} still to plan — drag this card onto one of its machines`}>
                                  {st.planned ? '✓ ' : '⏳ '}{st.departmentName}{st.planned ? '' : ` ${st.remaining}`}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {done > 0 && <div className="pg-sub" style={{ marginTop: 6 }}>✅ {done} sale order(s) fully planned — removed from the pool.</div>}
              </>
            );
          })()}
          <div className="pg-sub" style={{ marginTop: 8 }}>
            Tip: this strip stays put while you scroll — drag a card straight up onto a machine&rsquo;s shift ↑
          </div>
        </aside>

        {/* Machine columns by department */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {machines.length > 0 && (
            <section className="v2-panel board-mfilters" style={{ marginBottom: 0 }} aria-label="Filter the machines">
              <div className="pl-controls">
                <div className="fg"><label>Department</label>
                  <select value={fDept} onChange={(e) => { setFDept(e.target.value); setFMachine(''); }} aria-label="Department filter">
                    <option value="">All departments</option>
                    {Object.keys(machinesByDept).filter((k) => k !== 'none').map((k) => <option key={k} value={String(k)}>{deptName(k)} ({machinesByDept[k].length} machine{machinesByDept[k].length === 1 ? '' : 's'})</option>)}
                  </select></div>
                <div className="fg"><label>Machine</label>
                  <select value={fMachine} onChange={(e) => setFMachine(e.target.value)} aria-label="Machine filter">
                    <option value="">All machines</option>
                    {(machines || []).filter((mc) => !fDept || String(mc.departmentId) === fDept)
                      .map((mc) => <option key={mc.id} value={String(mc.id)}>{mc.code} · {mc.name}</option>)}
                  </select></div>
                <div className="fg"><label>Shift</label>
                  <select value={fShift} onChange={(e) => setFShift(e.target.value)} aria-label="Shift filter">
                    <option value="">All shifts</option><option value="A">Shift A</option><option value="B">Shift B</option><option value="C">Shift C</option>
                  </select></div>
                <div className="fg"><label>Find SO on the board</label>
                  <input value={fSo} onChange={(e) => setFSo(e.target.value)} placeholder="e.g. 26/903" aria-label="Find SO on the board" style={{ width: 120 }} /></div>
                <div className="fg"><label>Show</label>
                  <select value={fShow} onChange={(e) => setFShow(e.target.value)} aria-label="Show machines">
                    <option value="">All machines</option><option value="jobs">Machines with jobs</option><option value="free">Machines with free time</option>
                  </select></div>
                <button className="btn btn-s" onClick={clearFilters}>✕ Clear filters</button>
                <span className="pg-sub" style={{ margin: 0, alignSelf: 'center' }}>Showing {shownMachines} of {machines.length} machines</span>
              </div>
            </section>
          )}
          {boardFiltered && shownMachines === 0 && machines.length > 0 && (
            <div className="al al-b" style={{ margin: 0 }}>No machines match the filters.</div>
          )}
          {Object.entries(machinesByDept).map(([deptId, all]) => {
            const list = all.filter(machineVisible);
            if (list.length === 0) return null;
            return (
            <section className="v2-panel" key={deptId} style={{ marginBottom: 0 }}>
              <div className="v2-panel-title">
                <h2>{deptName(deptId)}</h2>
              </div>
              <div className="v2-pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: 10 }}>
                {list.map((mc) => {
                  const cap = capFor(mc.id);
                  const used = mins(cap?.usedMinutes), capM = mins(cap?.capMinutes) || mins((mc.functionalHoursPerDay || 12) * 60);
                  const over = cap?.overbooked;
                  const pct = capM > 0 ? Math.min(100, Math.round((used / capM) * 100)) : 0;
                  // Issues 2.5: while something is being dragged the card says plainly
                  // whether it can take it — a valid machine lifts, an invalid one dims.
                  const ok = canDropOn(mc.id);
                  const armed = !!dragging;
                  const cardHot = armed && ok && hover.startsWith(mc.id + '|');
                  return (
                    <div key={mc.id}
                      // Dropping on the card body (the header, the capacity bar, the gap
                      // between the shifts) used to do nothing at all — silently, which is
                      // what made a near-miss look like a broken drop. It now lands on
                      // Shift A, the same as the zone the pointer was heading for.
                      onDragOver={(e) => allowOn(e, mc, 'A')}
                      onDragLeave={() => leaveZone(mc, 'A')}
                      onDrop={(e) => onDropMachine(e, mc, 'A')}
                      aria-label={`Machine ${mc.code}`}
                      className="board-mach"
                      style={{
                        border: '1px solid ' + (cardHot ? 'var(--g)' : over ? 'var(--red)' : '#dce5f0'),
                        outline: cardHot ? '2px solid var(--g)' : 'none',
                        background: cardHot ? 'var(--gl)' : '#fff',
                        opacity: armed && !ok ? 0.42 : 1,
                        transition: 'opacity .12s, background .12s' }}>
                      {/* V2 machine header: code + name, a small load bar, used / capacity */}
                      <div className="pl-mach-top">
                        <b>{mc.code}</b><span className="pg-sub" style={{ margin: 0 }}>{mc.name}</span>
                      </div>
                      {armed && !ok && <div className="pl-why">{whyNot(mc)}</div>}
                      <div className={'pl-bar' + (over ? ' over' : '')} style={{ margin: '6px 10px', width: 'auto' }}><span style={{ width: pct + '%' }} /></div>
                      <div className="pg-sub" style={{ margin: '0 10px 6px' }}>{used}/{capM} min{over ? ' · OVER-BOOKED' : ''}</div>
                      {/* C4: SOs whose material is waiting at this machine's department and
                          may run on THIS machine — gone from siblings once dropped on one. */}
                      {(() => {
                        const w = waitingFor(mc);
                        return w.length > 0 && (
                          <div className="board-wait">
                            <div className="pg-sub" style={{ margin: '0 0 3px', fontWeight: 600 }}>⏳ Waiting here</div>
                            {w.map((p) => (
                              <span key={p.so} draggable onDragStart={(e) => startDragSo(e, p.so)} onDragEnd={endDrag}
                                title={`${p.spec} · ${p.jobName || ''} — drag onto a shift to plan`}
                                className="tag ty" style={{ display: 'inline-block', margin: '0 4px 4px 0', cursor: 'grab', padding: '3px 7px' }}>
                                {p.so}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                      {/* §77-78: one drop zone per shift; drag between them to re-shift a job. */}
                      {shiftsFor(mc.id).filter((sh) => !fShift || sh.k === fShift).map((sh) => {
                        const jobs = jobsFor(mc.id, sh.k);
                        const hot = hover === mc.id + '|' + sh.k && ok;
                        const winText = shiftWindows(mc.id, sh.k);   // null = Unavailable (BloomFlex V2)
                        return (
                          <div key={sh.k}
                            onDragOver={(e) => allowOn(e, mc, sh.k)}
                            onDragEnter={(e) => allowOn(e, mc, sh.k)}
                            onDragLeave={() => leaveZone(mc, sh.k)}
                            onDrop={(e) => onDropMachine(e, mc, sh.k)}
                            aria-label={`${mc.code} Shift ${sh.k}`}
                            className={'board-zone' + (winText === null ? ' pl-off' : '')}
                            style={{
                              // Issues 2.5: the zone under the pointer is unmistakable — a solid
                              // green frame on a tinted ground, instead of the dashed grey it
                              // wore whether or not the drop would land. A shift with no window
                              // is hatched (V2 "not available"); the rest are dashed drop lanes.
                              border: hot ? '2px solid var(--g)' : winText === null ? undefined : '1px dashed #d6e0ed',
                              background: hot ? 'var(--gl)' : winText === null ? undefined : sh.k === 'A' ? '#fff' : '#fafbff',
                              transition: 'background .12s, border-color .12s' }}>
                            <div className="pl-shift-head">
                              <span>{sh.k === 'A' ? '🌞' : '🌙'} {sh.label}
                                {winText === null ? <span className="tag tr" style={{ marginLeft: 4 }}>Unavailable</span>
                                  : winText ? <span style={{ fontWeight: 400 }}> · {winText}</span> : null}</span>
                            </div>
                            {jobs.length === 0 ? (
                              <div className="pl-empty" style={{ fontStyle: 'italic', color: hot ? 'var(--g)' : undefined, fontWeight: hot ? 700 : undefined }}>
                                {hot ? '⤵ Release to plan here' : 'Drop an SO here'}
                              </div>
                            ) : jobs.map((j) => (
                              <div key={j.id} draggable onDragStart={(e) => startDragJob(e, j.id)} onDragEnd={endDrag}
                                title={j.changed ? 'Changed after the plan was saved' : undefined}
                                className={'board-job' + (j.changed ? ' chg' : '') + (soHit(j) ? ' so-hit' : '')}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                                  <span><b className="pl-so">{j.so}</b> {j.plannedQty} <span className="pg-sub">({mins(j.estMinutes)}m)</span>{j.changed ? ' ⚠' : ''}
                                    {j.planStatus === 'DRAFT' && <span className="tag ty" style={{ marginLeft: 4, fontSize: 9 }} title="Auto-planner draft — publish it from the 3-Day Planner tab">Draft</span>}</span>
                                  <span style={{ whiteSpace: 'nowrap' }}>
                                    <button className="btn btn-s" title="up" onClick={() => bump(mc.id, j.id, -1)}>↑</button>
                                    <button className="btn btn-s" title="down" onClick={() => bump(mc.id, j.id, 1)}>↓</button>
                                    <button className="btn btn-r" onClick={() => removeJob(j.id)}>✕</button>
                                  </span>
                                </div>
                                {/* §80: the start/end from the shift queue — but every stage
                                    of a route was anchored to the same shift start, so a roll
                                    appeared to enter StayFresh at 08:00 while it was still on
                                    the press. Issues 2.4 §5: the PPC types the real start and
                                    the rest of this machine's queue follows on from it. */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                  <span className="pg-sub" style={{ margin: 0 }}>🕐</span>
                                  <input type="time" defaultValue={j.startTime || ''}
                                    key={j.id + '|' + (j.startMin == null ? 'auto' : j.startMin)}
                                    aria-label={`Start time for ${j.so} on ${mc.code}`}
                                    title={j.startMin == null ? 'Follows the shift queue — type a time to set it yourself' : 'Set by the PPC — clear it to follow the shift queue'}
                                    onBlur={(e) => setStart(j, e.target.value)}
                                    style={{ height: 22, fontSize: 10, width: 92, padding: '0 4px', borderColor: j.startMin != null ? 'var(--blu)' : undefined }} />
                                  <span className="pg-sub" style={{ margin: 0 }}>–{j.endTime || '—'}</span>
                                  {j.startMin != null && <span className="tag tb" style={{ fontSize: 8 }}>set</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {list.length === 0 && <div className="al al-b">No machines.</div>}
              </div>
            </section>
            );
          })}
          {machines.length === 0 && <div className="card"><div className="al al-b">No machines configured. Add them in Master Data.</div></div>}
        </div>
      </div>

      {/* Full / partial quantity prompt on drop */}
      {/* Issues 3.0: the title said only "Plan quantity", so with two machines or two
          shifts under one department there was nothing on the prompt to tell the PPC
          WHICH they had just dropped onto. It names both now. */}
      <Modal open={!!drop} title={drop ? `Plan ${drop.so} — ${drop.machine.code}, Shift ${drop.shift || 'A'} (${drop.shift === 'B' ? 'night' : 'day'})` : 'Plan quantity'} onClose={() => setDrop(null)}>
        {drop && <DropForm drop={drop} onCancel={() => setDrop(null)} onSubmit={doAssign} />}
      </Modal>
    </V2Page>
  );
}

function DropForm({ drop, onSubmit, onCancel }) {
  const [mode, setMode] = useState('full');
  const [qty, setQty] = useState(String(drop.remaining));
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault(); setErr('');
    const q = mode === 'full' ? drop.remaining : Number(qty);
    if (!(q > 0)) { setErr('Enter a positive quantity'); return; }
    if (q > drop.remaining + 1e-9) { setErr(`Only ${drop.remaining} ready to plan for this department`); return; }
    try { await onSubmit(q); } catch (e2) { setErr(e2.message || 'Assign failed'); }
  }
  return (
    <form onSubmit={submit}>
      {err && <div className="al al-r" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="al al-b" style={{ marginBottom: 10 }}>
        <span className="so-pill">{drop.so}</span> →{' '}
        <b>{drop.machine.code}</b>{drop.machine.name ? ` — ${drop.machine.name}` : ''} · {drop.department.departmentName}
        <div style={{ marginTop: 4 }}>
          Going onto <b>{drop.shift === 'B' ? '🌙 Shift B · night' : '🌞 Shift A · day'}</b> · ready to plan <b>{drop.remaining}</b>
        </div>
      </div>
      <div className="fbar">
        <label className="cb"><input type="radio" checked={mode === 'full'} onChange={() => setMode('full')} /> All ready qty on this machine ({drop.remaining})</label>
        <label className="cb"><input type="radio" checked={mode === 'partial'} onChange={() => setMode('partial')} /> Split across machines</label>
      </div>
      {mode === 'partial' && (
        <div className="fg" style={{ maxWidth: 240 }}><label>Quantity on this machine</label>
          <input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
      )}
      <div className="act">
        <button type="button" className="btn btn-s" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-g">Plan it</button>
      </div>
    </form>
  );
}
