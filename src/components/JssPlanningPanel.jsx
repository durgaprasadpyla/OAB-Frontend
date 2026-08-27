import { useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../data.jsx';
import { masterApi, jssApi, bomApi } from '../api.js';

// QC JSS planning (Stage 3): pick a JSS spec, choose a Dispatch Type (which
// auto-selects the Route and reveals its ordered departments), assign eligible
// machines per department (multiple, with per-JSS speed + changeover), and build
// the department-wise BOM. All server-backed via /api/jss/** and /api/bom/**.

const numOr = (v, d) => (v === '' || v == null || Number.isNaN(Number(v)) ? d : Number(v));

export default function JssPlanningPanel() {
  const { mods } = useData();
  const specs = Array.isArray(mods.jss) ? mods.jss : [];

  const [master, setMaster] = useState({ departments: [], machines: [], dispatchTypes: [], routes: [], items: [] });
  const [spec, setSpec] = useState('');
  const [jss, setJss] = useState(null);   // { config, routeDepartments, machines }
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [mSel, setMSel] = useState({});    // { [machineId]: { eligible, speed, changeover } }
  const [baseQty, setBaseQty] = useState('1');
  const [baseUom, setBaseUom] = useState('');
  const [lines, setLines] = useState([]);  // [{ departmentId, itemId, qtyPerBase, uom, search }]
  const [setupMin, setSetupMin] = useState('');   // §22: QC-communicated job setup time

  useEffect(() => {
    (async () => {
      try {
        const [departments, machines, dispatchTypes, routes, items] = await Promise.all([
          masterApi.listDepartments(), masterApi.listMachines(), masterApi.listDispatchTypes(),
          masterApi.listRoutes(), masterApi.listItems(),
        ]);
        setMaster({ departments, machines, dispatchTypes, routes, items });
      } catch (e) { setErr(e.message || 'Failed to load master data'); }
    })();
  }, []);

  const loadSpec = useCallback(async (s) => {
    if (!s) { setJss(null); return; }
    setLoading(true); setErr('');
    try {
      const [j, b] = await Promise.all([jssApi.get(s), bomApi.get(s)]);
      setJss(j);
      const sel = {};
      (j.machines || []).forEach((m) => { sel[m.machineId] = { eligible: m.eligible !== false, speed: m.speed ?? '', changeover: m.changeoverMin ?? '' }; });
      setMSel(sel);
      setBaseQty(String(b.baseQty ?? 1));
      setBaseUom(b.baseUom || '');
      setLines((b.items || []).map((it) => ({ departmentId: it.departmentId, itemId: it.itemId, qtyPerBase: it.qtyPerBase, uom: it.uom || '' })));
      setSetupMin(j.config?.setupMin != null ? String(j.config.setupMin) : '');
    } catch (e) { setErr(e.message || 'Failed to load JSS'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSpec(spec); }, [spec, loadSpec]);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };
  const routeDepts = jss?.routeDepartments || [];
  const machinesByDept = useMemo(() => {
    const m = {};
    (master.machines || []).forEach((mc) => { if (mc.departmentId != null) (m[mc.departmentId] = m[mc.departmentId] || []).push(mc); });
    return m;
  }, [master.machines]);
  // §15: the routes that belong to the JSS's selected Dispatch Form — the QC picks one by radio.
  const formRoutes = useMemo(
    () => (master.routes || []).filter((r) => jss?.config?.dispatchTypeId != null && String(r.dispatchTypeId) === String(jss.config.dispatchTypeId)),
    [master.routes, jss?.config?.dispatchTypeId],
  );

  async function setDispatch(dispatchTypeId) {
    setErr('');
    try { await jssApi.setConfig(spec, { dispatchTypeId: dispatchTypeId ? Number(dispatchTypeId) : null }); flash('Dispatch Form saved - now choose one of its routes below'); await loadSpec(spec); }
    catch (e) { setErr(e.message); }
  }
  async function setRoute(routeId) {
    setErr('');
    try { await jssApi.setConfig(spec, { dispatchTypeId: jss?.config?.dispatchTypeId ?? null, routeId: routeId ? Number(routeId) : null }); flash('Route updated'); await loadSpec(spec); }
    catch (e) { setErr(e.message); }
  }
  // §22-23: the job setup time — taken into account when the PPC plans this job on a machine.
  async function saveSetup() {
    setErr('');
    try { await jssApi.setConfig(spec, { setupMin: setupMin === '' ? null : Number(setupMin) }); flash('Setup time saved'); await loadSpec(spec); }
    catch (e) { setErr(e.message); }
  }

  const toggleMachine = (mid) => setMSel((s) => ({ ...s, [mid]: { ...(s[mid] || { speed: '', changeover: '' }), eligible: !(s[mid]?.eligible) } }));
  const setMField = (mid, k, v) => setMSel((s) => ({ ...s, [mid]: { ...(s[mid] || { eligible: true, speed: '', changeover: '' }), [k]: v } }));
  async function saveMachines() {
    setErr('');
    const payload = Object.entries(mSel).filter(([, v]) => v.eligible).map(([mid, v]) => {
      const mc = master.machines.find((x) => String(x.id) === String(mid));
      return { departmentId: mc?.departmentId, machineId: Number(mid), eligible: true,
        speed: v.speed === '' ? undefined : Number(v.speed),
        changeoverMin: v.changeover === '' ? undefined : Number(v.changeover) };
    });
    try { await jssApi.setMachines(spec, payload); flash('Machines saved'); await loadSpec(spec); }
    catch (e) { setErr(e.message); }
  }

  const addLine = (departmentId) => setLines((l) => [...l, { departmentId, itemId: '', qtyPerBase: '', uom: '' }]);
  const setLine = (i, k, v) => setLines((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const rmLine = (i) => setLines((l) => l.filter((_, j) => j !== i));
  async function saveBom() {
    setErr('');
    const items = lines.filter((x) => x.itemId && Number(x.qtyPerBase) > 0)
      .map((x) => ({ departmentId: Number(x.departmentId), itemId: Number(x.itemId), qtyPerBase: Number(x.qtyPerBase), uom: x.uom || undefined }));
    try { await bomApi.set(spec, { baseQty: numOr(baseQty, 1), baseUom: baseUom || undefined, items }); flash('BOM saved'); await loadSpec(spec); }
    catch (e) { setErr(e.message); }
  }

  const itemLabel = (it) => `${it.code}${it.name ? ' — ' + it.name : ''}`;
  // §24-30: under each route department, only the items TAGGED to that department in
  // the item master (plus untagged "others") are offered.
  const itemsForDept = (departmentId) => (master.items || []).filter(
    (it) => it.departmentId == null || String(it.departmentId) === String(departmentId));
  const itemById = (id) => (master.items || []).find((it) => String(it.id) === String(id));
  // §31: type-and-search — an exact code or "CODE — name" match pulls the item in.
  function pickItem(i, departmentId, text) {
    const t = String(text || '').trim();
    const pool = itemsForDept(departmentId);
    const found = pool.find((it) => itemLabel(it) === t) || pool.find((it) => String(it.code) === t);
    if (found) setLines((l) => l.map((x, j) => (j === i ? { ...x, itemId: found.id, uom: x.uom || found.uom || '', search: undefined } : x)));
    else setLines((l) => l.map((x, j) => (j === i ? { ...x, itemId: '', search: text } : x)));
  }

  return (
    <div>
      <div className="pg-sub">Configure the route, eligible machines (speed &amp; changeover) and the department-wise BOM for a JSS. Pick the Dispatch Form, then choose one of its routes.</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}
      {msg && <div className="al al-g" style={{ margin: '8px 0' }}>{msg}</div>}

      <div className="card">
        <div className="fg" style={{ maxWidth: 460 }}>
          <label>JSS Spec</label>
          <select value={spec} onChange={(e) => setSpec(e.target.value)}>
            <option value="">— select a JSS spec —</option>
            {specs.map((s) => <option key={s.spec} value={s.spec}>{s.spec}{s.jobName ? ' — ' + s.jobName : (s.customer ? ' — ' + s.customer : '')}</option>)}
          </select>
        </div>
      </div>

      {loading && <div className="card"><div className="spin" /> Loading…</div>}

      {spec && jss && !loading && (
        <>
          {/* ── Dispatch type → route ── */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="ctitle">Dispatch Type &amp; Route</div>
            <div className="g3">
              <div className="fg">
                <label>Dispatch Type</label>
                <select value={jss.config?.dispatchTypeId ?? ''} onChange={(e) => setDispatch(e.target.value)}>
                  <option value="">— none —</option>
                  {master.dispatchTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="fg">
                <label>Route — select one for this JSS</label>
                {!jss.config?.dispatchTypeId ? (
                  <div className="al al-b" style={{ marginTop: 4 }}>Pick a Dispatch Form first — its routes appear here to choose from.</div>
                ) : formRoutes.length === 0 ? (
                  <div className="al al-y" style={{ marginTop: 4 }}>No routes are configured for this Dispatch Form yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
                    {formRoutes.map((r) => (
                      <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="radio" name="jss-route" checked={String(jss.config?.routeId ?? '') === String(r.id)}
                          onChange={() => setRoute(r.id)} />
                        <span>{r.name}{(r.stages && r.stages.length) ? ' — ' + r.stages.map((s) => s.departmentName).join(' → ') : ''}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="fg">
                <label>Departments (in order)</label>
                <div style={{ paddingTop: 8 }}>
                  {routeDepts.length ? routeDepts.map((d) => <span key={d.departmentId} className="tag tb" style={{ marginRight: 4 }}>{d.seq}. {d.departmentName}</span>)
                    : <span className="tag ty">Pick a dispatch type or route</span>}
                </div>
              </div>
            </div>
            {/* §22-23: setup time communicated by the QC; counted against machine availability when planning. */}
            <div className="fbar" style={{ alignItems: 'flex-end', marginTop: 8 }}>
              <div className="fg" style={{ margin: 0, maxWidth: 220 }}>
                <label>Job setup time (minutes)</label>
                <input type="number" min="0" step="1" value={setupMin} placeholder="e.g. 30"
                  onChange={(e) => setSetupMin(e.target.value)} aria-label="Job setup time (minutes)" />
              </div>
              <button className="btn btn-s" onClick={saveSetup}>Save setup time</button>
              <span className="pg-sub" style={{ margin: 0 }}>Added to every planned run of this job when computing machine availability.</span>
            </div>
          </div>

          {/* ── Machines per department ── */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="fbar" style={{ justifyContent: 'space-between' }}>
              <div className="ctitle" style={{ margin: 0 }}>Eligible Machines · Speed · Changeover</div>
              <button className="btn btn-g" onClick={saveMachines} disabled={!routeDepts.length}>Save machines</button>
            </div>
            {!routeDepts.length ? (
              <div className="al al-y">Set the route first to list its departments.</div>
            ) : routeDepts.map((d) => {
              const list = machinesByDept[d.departmentId] || [];
              return (
                <div key={d.departmentId} style={{ marginBottom: 12 }}>
                  <div className="ctitle" style={{ fontSize: 12 }}>{d.seq}. {d.departmentName}</div>
                  {list.length === 0 ? (
                    <div className="al al-y">No machines in this department yet — add them in Master Data.</div>
                  ) : (
                    <div className="tw">
                      <table>
                        <thead><tr><th style={{ width: 44 }}>Use</th><th>Machine</th><th style={{ width: 160 }}>Speed / min</th><th style={{ width: 170 }}>Changeover (min)</th></tr></thead>
                        <tbody>
                          {list.map((mc) => {
                            const sel = mSel[mc.id] || {};
                            const on = !!sel.eligible;
                            return (
                              <tr key={mc.id} className={on ? 'hi' : undefined}>
                                <td><input type="checkbox" checked={on} onChange={() => toggleMachine(mc.id)} /></td>
                                <td>{mc.code} — {mc.name}{mc.defaultSpeed != null ? <span className="tag tgr" style={{ marginLeft: 6 }}>default {mc.defaultSpeed}</span> : null}</td>
                                <td><input type="number" step="any" disabled={!on} placeholder={mc.defaultSpeed ?? ''} value={sel.speed ?? ''} onChange={(e) => setMField(mc.id, 'speed', e.target.value)} /></td>
                                <td><input type="number" step="1" disabled={!on} value={sel.changeover ?? ''} onChange={(e) => setMField(mc.id, 'changeover', e.target.value)} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Department-wise BOM ── */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="fbar" style={{ justifyContent: 'space-between' }}>
              <div className="ctitle" style={{ margin: 0 }}>Department-wise BOM</div>
              <button className="btn btn-g" onClick={saveBom} disabled={!routeDepts.length}>Save BOM</button>
            </div>
            <div className="g3">
              <div className="fg"><label>Base quantity</label><input type="number" step="any" value={baseQty} onChange={(e) => setBaseQty(e.target.value)} /></div>
              <div className="fg"><label>Base UOM</label><input value={baseUom} placeholder="e.g. m, pouches" onChange={(e) => setBaseUom(e.target.value)} /></div>
              <div className="fg"><label>&nbsp;</label><div style={{ paddingTop: 8 }} className="pg-sub">Requirement = (SO qty / base) × qty per base.</div></div>
            </div>
            {!routeDepts.length ? (
              <div className="al al-y">Set the route first.</div>
            ) : routeDepts.map((d) => {
              const deptLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => String(l.departmentId) === String(d.departmentId));
              const deptItems = itemsForDept(d.departmentId);
              const listId = `jss-bom-items-${d.departmentId}`;
              return (
                <div key={d.departmentId} style={{ marginBottom: 12 }}>
                  <div className="fbar" style={{ justifyContent: 'space-between' }}>
                    <div className="ctitle" style={{ margin: 0, fontSize: 12 }}>{d.seq}. {d.departmentName}
                      <span className="tag tgr" style={{ marginLeft: 6 }}>{deptItems.length} item(s) tagged</span></div>
                    <button className="btn btn-s" onClick={() => addLine(d.departmentId)}>＋ Add item</button>
                  </div>
                  {/* §31: exhaustive list → type-and-search, limited to this department's items + others. */}
                  <datalist id={listId}>
                    {deptItems.map((it) => <option key={it.id} value={itemLabel(it)} />)}
                  </datalist>
                  {deptLines.length === 0 ? <div className="al al-y">No items for this department.</div> : (
                    <div className="tw">
                      <table>
                        <thead><tr><th>Item (type to search)</th><th style={{ width: 120 }}>Item code</th><th style={{ width: 160 }}>Qty / base</th><th style={{ width: 120 }}>UOM</th><th style={{ width: 60 }}></th></tr></thead>
                        <tbody>
                          {deptLines.map(({ l, i }) => {
                            const sel = itemById(l.itemId);
                            return (
                              <tr key={i}>
                                <td>
                                  <input list={listId} style={{ width: '100%' }} placeholder="type item name / code…"
                                    aria-label={`BOM item for ${d.departmentName}`}
                                    value={l.search != null ? l.search : (sel ? itemLabel(sel) : '')}
                                    onChange={(e) => pickItem(i, d.departmentId, e.target.value)} />
                                </td>
                                {/* §31: the code pulls in automatically from the item master. */}
                                <td>{sel ? sel.code : '—'}</td>
                                <td><input type="number" step="any" value={l.qtyPerBase} onChange={(e) => setLine(i, 'qtyPerBase', e.target.value)} /></td>
                                <td><input value={l.uom} onChange={(e) => setLine(i, 'uom', e.target.value)} /></td>
                                <td><button className="btn btn-r" onClick={() => rmLine(i)}>✕</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            {master.items.length === 0 && (
              <div className="al al-b">No items in the master yet. Add them in Master Data, or run “Sync items from purchase”.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
