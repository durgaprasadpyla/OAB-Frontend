import { useState, useEffect, useCallback, useMemo } from 'react';
import { planningApi, masterApi } from '../api.js';
import { today } from '../lib/format.js';
import Modal from '../components/Modal.jsx';

// Daily machine board (Stage 7 + Enhancements 2.0 §77-80): machines grouped by
// department, each machine split into Shift A (day) and Shift B (night) drop zones.
// Drag a Ready-to-Plan SO onto a shift to plan it (with a full/partial quantity
// prompt), drag a planned job card onto another machine or shift to move it, and
// reorder within a machine. Every job card shows its derived start–end time (§80),
// and a job edited after first save is highlighted as a plan change (§56).

const mins = (v) => (v == null ? 0 : Math.round(Number(v)));
const SHIFTS = [{ k: 'A', label: 'Shift A · day' }, { k: 'B', label: 'Shift B · night' }];

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

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  const load = useCallback(async () => {
    setErr('');
    try {
      const [p, m, d, b] = await Promise.all([planningApi.pool(), masterApi.listMachines(), masterApi.listDepartments(), planningApi.week(date, date)]);
      setPool(p || []); setMachines(m || []); setDepartments(d || []); setBoard(b || { jobs: [], capacity: [] });
    } catch (e) { setErr(e.message || 'Failed to load board'); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const machinesByDept = useMemo(() => {
    const g = {};
    (machines || []).forEach((mc) => { const k = mc.departmentId == null ? 'none' : mc.departmentId; (g[k] = g[k] || []).push(mc); });
    return g;
  }, [machines]);
  const jobsFor = (machineId, shift) => (board.jobs || []).filter((j) => String(j.machineId) === String(machineId) && j.planDate === date
    && (shift ? (j.shift || 'A') === shift : true)).sort((a, b) => (a.seqOrder || 0) - (b.seqOrder || 0));
  const capFor = (machineId) => (board.capacity || []).find((c) => String(c.machineId) === String(machineId) && c.date === date);

  // ── drag/drop ──
  const dragData = (e) => { try { return JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return null; } };
  const startDragSo = (e, so) => e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'so', so }));
  const startDragJob = (e, jobId) => e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'job', jobId }));
  const allow = (e) => e.preventDefault();

  async function onDropMachine(e, machine, shift) {
    e.preventDefault();
    e.stopPropagation();
    const d = dragData(e);
    if (!d) return;
    if (d.kind === 'job') {
      // Move between machines AND between shifts is plain drag-and-drop (§78).
      try { const r = await planningApi.move({ jobId: d.jobId, machineId: machine.id, planDate: date, shift });
        if (r.capacity?.overbooked) setWarn({ machineId: machine.id, name: machine.name });
        flash(`Job moved to ${machine.code} · Shift ${shift}`); await load();
      } catch (e2) { setErr(e2.message); }
      return;
    }
    if (d.kind === 'so') {
      // Need the department (this machine's) + the SO's remaining there.
      try {
        const sp = await planningApi.soPlan(d.so);
        const dept = (sp.departments || []).find((x) => String(x.departmentId) === String(machine.departmentId));
        if (!dept) { setErr(`SO ${d.so}'s route has no ${machine.name}'s department`); return; }
        const eligible = (dept.machines || []).some((x) => String(x.machineId) === String(machine.id));
        if (!eligible) { setErr(`${machine.code} is not eligible for SO ${d.so} at ${dept.departmentName}`); return; }
        setDrop({ so: d.so, machine, department: dept, remaining: Number(dept.remaining), shift });
      } catch (e2) { setErr(e2.message); }
    }
  }

  async function doAssign(qty) {
    const { so, machine, department, shift } = drop;
    try {
      const r = await planningApi.assign({ so, departmentId: department.departmentId, machineId: machine.id, planDate: date, plannedQty: qty, shift });
      setDrop(null);
      if (r.capacity?.overbooked) setWarn({ machineId: machine.id, name: machine.name });
      flash(r.capacity?.overbooked ? 'Assigned — machine is over-booked' : 'Assigned');
      await load();
    } catch (e) { throw e; }
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
    <div id={embedded ? undefined : 'app'}>
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

      <div className="card">
        <div className="fbar">
          <div className="fg"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <button className="btn btn-s" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {/* Issues 2.4 §6: machines FIRST, the pool underneath. Side by side, the
          pouching machines sat below the fold of their own scroller, so dragging an
          order onto one meant scrolling the right-hand column while holding the
          card. Stacked, the drop targets are all on one page and the drag is short. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        <div className="card" style={{ order: 2 }}>
          {(() => {
            const open = pool.filter((p) => !p.fullyPlanned);
            const done = pool.length - open.length;
            return (
              <>
                <div className="ctitle">Ready to Plan <span className="tag ty">{open.length}</span></div>
                {open.length === 0 ? <div className="al al-b">No SOs waiting to be planned.</div> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {open.map((p) => (
                      <div key={p.so} draggable onDragStart={(e) => startDragSo(e, p.so)}
                        style={{ border: '1px solid var(--bd)', borderRadius: 8, padding: '8px 10px', cursor: 'grab', background: 'var(--gl)' }}>
                        <span className="so-pill">{p.so}</span> <b>{p.spec}</b> · {p.jobName || ''} · qty {p.poQty}{' '}
                        <span className={'tag ' + (p.readyMode === 'PARTIAL' ? 'tb' : 'tg')}>{p.readyMode === 'PARTIAL' ? 'Partial' : 'Complete'}</span>{' '}
                        <span className="tag ty">ready {p.readyQty}</span>
                        {p.remainingQty != null && <span className="tag tr" style={{ marginLeft: 4 }}>balance {p.remainingQty}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {done > 0 && <div className="pg-sub" style={{ marginTop: 6 }}>✅ {done} sale order(s) fully planned — removed from the pool.</div>}
              </>
            );
          })()}
          <div className="pg-sub" style={{ marginTop: 8 }}>Tip: drag a card onto a machine above ↑</div>
        </div>

        {/* Machine columns by department */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, order: 1 }}>
          {Object.entries(machinesByDept).map(([deptId, list]) => (
            <div className="card" key={deptId}>
              <div className="ctitle">{deptName(deptId)}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {list.map((mc) => {
                  const cap = capFor(mc.id);
                  const used = mins(cap?.usedMinutes), capM = mins(cap?.capMinutes) || mins((mc.functionalHoursPerDay || 12) * 60);
                  const over = cap?.overbooked;
                  const pct = capM > 0 ? Math.min(100, Math.round((used / capM) * 100)) : 0;
                  return (
                    <div key={mc.id}
                      style={{ flex: '1 1 240px', minWidth: 220, border: '1px solid ' + (over ? 'var(--red)' : 'var(--bd)'), borderRadius: 10, padding: 8, background: 'var(--wh)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <b>{mc.code}</b><span className="pg-sub">{mc.name}</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: '#eef1f6', margin: '6px 0', overflow: 'hidden' }}>
                        <div style={{ width: pct + '%', height: '100%', background: over ? 'var(--red)' : 'var(--g)' }} />
                      </div>
                      <div className="pg-sub" style={{ marginBottom: 6 }}>{used}/{capM} min{over ? ' · OVER-BOOKED' : ''}</div>
                      {/* C4: SOs whose material is waiting at this machine's department and
                          may run on THIS machine — gone from siblings once dropped on one. */}
                      {(() => {
                        const w = waitingFor(mc);
                        return w.length > 0 && (
                          <div style={{ marginBottom: 6 }}>
                            <div className="pg-sub" style={{ margin: '0 0 3px', fontWeight: 600 }}>⏳ Waiting here</div>
                            {w.map((p) => (
                              <span key={p.so} draggable onDragStart={(e) => startDragSo(e, p.so)}
                                title={`${p.spec} · ${p.jobName || ''} — drag onto a shift to plan`}
                                className="tag ty" style={{ display: 'inline-block', margin: '0 4px 4px 0', cursor: 'grab', padding: '3px 7px' }}>
                                {p.so}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                      {/* §77-78: one drop zone per shift; drag between them to re-shift a job. */}
                      {SHIFTS.map((sh) => {
                        const jobs = jobsFor(mc.id, sh.k);
                        return (
                          <div key={sh.k} onDragOver={allow} onDrop={(e) => onDropMachine(e, mc, sh.k)}
                            style={{ border: '1px dashed var(--bd)', borderRadius: 8, padding: 6, marginBottom: 6, background: sh.k === 'B' ? '#f4f4fb' : 'transparent' }}>
                            <div className="pg-sub" style={{ marginBottom: 4, fontWeight: 600 }}>{sh.k === 'A' ? '🌞' : '🌙'} {sh.label}</div>
                            {jobs.length === 0 ? <div className="pg-sub" style={{ margin: 0, fontStyle: 'italic' }}>Drop an SO here</div> : jobs.map((j) => (
                              <div key={j.id} draggable onDragStart={(e) => startDragJob(e, j.id)}
                                title={j.changed ? 'Changed after the plan was saved' : undefined}
                                style={{ border: j.changed ? '2px solid #c9a100' : '1px solid var(--bd)', borderRadius: 8, padding: '6px 8px', marginBottom: 6, cursor: 'grab', background: j.changed ? '#fff8e1' : 'var(--gl)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                                  <span><span className="so-pill">{j.so}</span> {j.plannedQty} <span className="pg-sub">({mins(j.estMinutes)}m)</span>{j.changed ? ' ⚠' : ''}</span>
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
            </div>
          ))}
          {machines.length === 0 && <div className="card"><div className="al al-b">No machines configured. Add them in Master Data.</div></div>}
        </div>
      </div>

      {/* Full / partial quantity prompt on drop */}
      <Modal open={!!drop} title="Plan quantity" onClose={() => setDrop(null)}>
        {drop && <DropForm drop={drop} onCancel={() => setDrop(null)} onSubmit={doAssign} />}
      </Modal>
    </div>
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
        <span className="so-pill">{drop.so}</span> → <b>{drop.machine.code}</b> ({drop.department.departmentName}) · ready to plan <b>{drop.remaining}</b>
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
