import { useState, useEffect, useCallback } from 'react';
import { productionApi, masterApi } from '../api.js';
import { today } from '../lib/format.js';
import Modal from '../components/Modal.jsx';

// Production execution (Stage 5): Plant / Plant Manager record actual production +
// wastage against an SO's route stages. Good output automatically becomes available
// to the next department; the remainder stays pending (partial completion). Every
// quantity is validated server-side (can't produce more than remains at a stage).

const statusTag = (s) => ({ Completed: 'tg', 'Partially Completed': 'tb', 'In Progress': 'ty', 'Not Started': 'tgr' }[s] || 'ty');

function RecordForm({ stage, machines, onSubmit, onCancel }) {
  const deptMachines = (machines || []).filter((m) => String(m.departmentId) === String(stage.departmentId));
  const [produced, setProduced] = useState('');
  const [wastage, setWastage] = useState('');
  const [machineId, setMachineId] = useState('');
  const [prodDate, setProdDate] = useState(today());
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setErr('');
    const p = Number(produced) || 0, w = Number(wastage) || 0;
    if (p + w <= 0) { setErr('Enter a produced and/or wastage quantity'); return; }
    if (p + w > Number(stage.remaining) + 1e-9) { setErr(`Only ${stage.remaining} remain at this stage`); return; }
    try {
      await onSubmit({ stageSeq: stage.stageSeq, producedQty: p, wastageQty: w, machineId: machineId ? Number(machineId) : undefined, prodDate });
    } catch (e2) { setErr(e2.message || 'Save failed'); }
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="al al-r" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="al al-b" style={{ marginBottom: 10 }}>
        {stage.stageSeq}. <b>{stage.departmentName}</b> · input {stage.qtyIn} · done {Number(stage.qtyCompleted) + Number(stage.qtyWastage)} · <b>remaining {stage.remaining}</b>
      </div>
      <div className="g3">
        <div className="fg"><label>Actual produced (good)</label><input type="number" step="any" value={produced} onChange={(e) => setProduced(e.target.value)} /></div>
        <div className="fg"><label>Wastage</label><input type="number" step="any" value={wastage} onChange={(e) => setWastage(e.target.value)} /></div>
        <div className="fg"><label>Date</label><input type="date" value={prodDate} onChange={(e) => setProdDate(e.target.value)} /></div>
      </div>
      <div className="fg">
        <label>Machine (optional)</label>
        <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
          <option value="">— none —</option>
          {deptMachines.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
        </select>
      </div>
      <div className="act">
        <button type="button" className="btn btn-s" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-g">Record</button>
      </div>
    </form>
  );
}

export default function Production() {
  const [pending, setPending] = useState([]);
  const [machines, setMachines] = useState([]);
  const [so, setSo] = useState('');
  const [soInput, setSoInput] = useState('');
  const [prod, setProd] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [rec, setRec] = useState(null);   // stage being recorded

  const loadPending = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([productionApi.pending(), masterApi.listMachines()]);
      setPending(p || []); setMachines(m || []);
    } catch (e) { setErr(e.message || 'Failed to load'); }
  }, []);
  useEffect(() => { loadPending(); }, [loadPending]);

  const openSo = useCallback(async (s) => {
    if (!s) return;
    setLoading(true); setErr(''); setSo(s);
    try { setProd(await productionApi.get(s)); }
    catch (e) { setErr(e.message || 'Failed to load SO'); }
    finally { setLoading(false); }
  }, []);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  async function init() {
    setErr('');
    try { setProd(await productionApi.init(so)); flash('Route initialised'); await loadPending(); }
    catch (e) { setErr(e.message || 'Could not initialise'); }
  }
  async function saveRecord(body) {
    const r = await productionApi.record({ so, ...body });
    setProd(r); setRec(null); flash('Production recorded'); await loadPending();
  }

  const distinctSos = [...new Set(pending.map((p) => p.so))];

  return (
    <div id="app">
      <div className="pg-ttl">🏭 Production</div>
      <div className="pg-sub">Record actual production and wastage against each route stage. Completed quantity moves to the next department automatically; the remainder stays pending.</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}
      {msg && <div className="al al-g" style={{ margin: '8px 0' }}>{msg}</div>}

      <div className="card">
        <div className="fbar">
          <div className="fg" style={{ minWidth: 220 }}>
            <label>Open a Sale Order</label>
            <select value={so} onChange={(e) => openSo(e.target.value)}>
              <option value="">— pending SOs —</option>
              {distinctSos.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="fg" style={{ minWidth: 220 }}>
            <label>…or by SO number</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={soInput} placeholder="e.g. 26/500" onChange={(e) => setSoInput(e.target.value)} />
              <button className="btn btn-s" onClick={() => openSo(soInput.trim())}>Open</button>
            </div>
          </div>
        </div>
      </div>

      {/* Pending work pool */}
      {!so && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="ctitle">Pending Stages <span className="tag ty">{pending.length}</span></div>
          {pending.length === 0 ? <div className="al al-g">Nothing pending — all caught up.</div> : (
            <div className="tw sy">
              <table>
                <thead><tr><th>Sale Order</th><th>Stage</th><th>Department</th><th>Remaining</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {pending.map((p, i) => (
                    <tr key={i}>
                      <td><span className="so-pill">{p.so}</span></td>
                      <td>{p.stageSeq}</td>
                      <td>{p.departmentName}</td>
                      <td><b>{p.remaining}</b></td>
                      <td><span className={'tag ' + statusTag(p.status)}>{p.status}</span></td>
                      <td><button className="btn btn-s" onClick={() => openSo(p.so)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {loading && <div className="card" style={{ marginTop: 12 }}><div className="spin" /> Loading…</div>}

      {so && prod && !loading && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="fbar" style={{ justifyContent: 'space-between' }}>
            <div className="ctitle" style={{ margin: 0 }}>SO <span className="so-pill">{so}</span>{prod.spec ? ' · ' + prod.spec : ''}{prod.poQty != null ? ' · qty ' + prod.poQty : ''}</div>
            <button className="btn btn-s" onClick={() => { setSo(''); setProd(null); }}>← Back to pending</button>
          </div>
          {!prod.hasRoute ? (
            <div>
              <div className="al al-y">No route stages yet for this SO.</div>
              <button className="btn btn-g" onClick={init}>Initialise from route</button>
            </div>
          ) : (
            <div className="tw sy">
              <table>
                <thead><tr><th>Seq</th><th>Department</th><th>Input</th><th>Completed</th><th>Wastage</th><th>Remaining</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {prod.stages.map((st) => (
                    <tr key={st.stageSeq} className={Number(st.remaining) > 0 ? 'hi' : undefined}>
                      <td>{st.stageSeq}</td>
                      <td>{st.departmentName}</td>
                      <td>{st.qtyIn}</td>
                      <td>{st.qtyCompleted}</td>
                      <td>{st.qtyWastage}</td>
                      <td><b>{st.remaining}</b></td>
                      <td><span className={'tag ' + statusTag(st.status)}>{st.status}</span></td>
                      <td>{Number(st.remaining) > 0 ? <button className="btn btn-g" onClick={() => setRec(st)}>Record</button> : <span className="tag tg">done</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {Array.isArray(prod.runs) && prod.runs.length > 0 && (
            <>
              <div className="ctitle" style={{ marginTop: 14 }}>Production log</div>
              <div className="tw">
                <table>
                  <thead><tr><th>Date</th><th>Department</th><th>Machine</th><th>Produced</th><th>Wastage</th><th>By</th></tr></thead>
                  <tbody>
                    {prod.runs.map((r) => (
                      <tr key={r.id}>
                        <td>{r.prodDate || ''}</td>
                        <td>{r.departmentName}</td>
                        <td>{r.machineName || '—'}</td>
                        <td>{r.producedQty}</td>
                        <td>{r.wastageQty}</td>
                        <td>{r.actor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <Modal open={!!rec} title="Record Production" onClose={() => setRec(null)}>
        {rec && <RecordForm stage={rec} machines={machines} onCancel={() => setRec(null)} onSubmit={saveRecord} />}
      </Modal>
    </div>
  );
}
