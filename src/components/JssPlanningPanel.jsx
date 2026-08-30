import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useData } from '../data.jsx';
import { masterApi, jssApi, bomApi } from '../api.js';
import { bomUOM } from '../lib/bom.js';

// QC JSS planning (Stage 3): pick a JSS spec — its Dispatch Form comes FROM the
// JSS itself (Issues 1.0 #1, no manual dropdown), which reveals the form's routes
// to pick by radio; assign eligible machines per department (multiple, with a
// per-machine speed UNIT + speed + setup + changeover, Issues 1.0 #3) and build
// the department-wise BOM whose base UOM is auto-picked from the dispatch form
// (Issues 1.0 #2). All server-backed via /api/jss/** and /api/bom/**.

const numOr = (v, d) => (v === '' || v == null || Number.isNaN(Number(v)) ? d : Number(v));

// Issues 1.0 #2: the base UOM choices; auto-picked via bomUOM(dispatchForm).
const BASE_UOMS = ['Pouches', 'Pieces', 'Kgs', 'Mtrs', 'Pcs'];
// Issues 1.0 #3: default speed unit by department — pouching, shrink sleeves,
// die punching and packing count pieces; every other operation runs in metres.
const deptSpeedUnit = (name) => (/pouch|sleeve|punch|pack/i.test(String(name || '')) ? 'pcs/min' : 'm/min');

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
      // Issues 1.0 #4: refresh the normalized items from the Padmin catalogue first,
      // so the departments tagged on the P Dashboard item master reach the BOM picker.
      // Best-effort — a role without the sync grant still gets the current list.
      try { await masterApi.syncItemsFromPurchase(); } catch { /* read-only fallback */ }
      try {
        const [departments, machines, dispatchTypes, routes, items] = await Promise.all([
          masterApi.listDepartments(), masterApi.listMachines(), masterApi.listDispatchTypes(),
          masterApi.listRoutes(), masterApi.listItems(),
        ]);
        setMaster({ departments, machines, dispatchTypes, routes, items });
      } catch (e) { setErr(e.message || 'Failed to load master data'); }
    })();
  }, []);

  // The spec list, readable inside stable callbacks without re-creating them
  // (a changing `specs` identity in the deps would re-fire the load effect forever).
  const specsRef = useRef(specs);
  specsRef.current = specs;

  const loadSpec = useCallback(async (s) => {
    if (!s) { setJss(null); return; }
    setLoading(true); setErr('');
    try {
      const [j, b] = await Promise.all([jssApi.get(s), bomApi.get(s)]);
      setJss(j);
      const sel = {};
      (j.machines || []).forEach((m) => { sel[m.machineId] = { eligible: m.eligible !== false, speed: m.speed ?? '', uom: m.speedUom ?? '', changeover: m.changeoverMin ?? '', setup: m.setupMin ?? '' }; });
      setMSel(sel);
      setBaseQty(String(b.baseQty ?? 1));
      // Issues 1.0 #2: no stored base UOM yet → auto-pick it from the JSS's dispatch form.
      const row = (specsRef.current || []).find((x) => String(x.spec || '').trim() === s);
      setBaseUom(b.baseUom || (row && row.dispatchForm ? bomUOM(row.dispatchForm) : ''));
      setLines((b.items || []).map((it) => ({ departmentId: it.departmentId, itemId: it.itemId, qtyPerBase: it.qtyPerBase, uom: it.uom || '' })));
      setSetupMin(j.config?.setupMin != null ? String(j.config.setupMin) : '');
    } catch (e) { setErr(e.message || 'Failed to load JSS'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSpec(spec); }, [spec, loadSpec]);

  // ── Issues 1.0 #1: the Dispatch Form comes FROM the JSS, not a manual pick ──
  const specRow = useMemo(() => (Array.isArray(specs) ? specs : []).find((x) => String(x.spec || '').trim() === spec) || null, [specs, spec]);
  const jssFormName = String(specRow?.dispatchForm || '').trim();
  const matchedForm = useMemo(
    () => (master.dispatchTypes || []).find((t) => String(t.name || '').trim().toLowerCase() === jssFormName.toLowerCase()) || null,
    [master.dispatchTypes, jssFormName],
  );
  // Auto-align the stored config to the JSS's form once per spec (never loops:
  // the guard remembers which spec it already aligned).
  const alignedRef = useRef('');
  useEffect(() => {
    if (!spec || !jss || loading || !matchedForm) return;
    if (String(jss.config?.dispatchTypeId ?? '') === String(matchedForm.id)) return;
    if (alignedRef.current === spec) return;
    alignedRef.current = spec;
    (async () => {
      try { await jssApi.setConfig(spec, { dispatchTypeId: Number(matchedForm.id) }); await loadSpec(spec); }
      catch (e) { setErr(e.message); }
    })();
  }, [spec, jss, loading, matchedForm, loadSpec]);

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

  // Req #16: ticking a machine pre-fills the job speed with the Super Admin's ideal
  // speed — QC then overrides it per job without ever touching the machine default.
  const toggleMachine = (mid) => setMSel((s) => {
    const cur = s[mid] || { speed: '', uom: '', changeover: '', setup: '' };
    const turningOn = !cur.eligible;
    const mc = master.machines.find((x) => String(x.id) === String(mid));
    const speed = turningOn && (cur.speed === '' || cur.speed == null) && mc?.defaultSpeed != null
      ? String(mc.defaultSpeed) : cur.speed;
    return { ...s, [mid]: { ...cur, eligible: turningOn, speed } };
  });
  const setMField = (mid, k, v) => setMSel((s) => ({ ...s, [mid]: { ...(s[mid] || { eligible: true, speed: '', uom: '', changeover: '', setup: '' }), [k]: v } }));
  async function saveMachines() {
    setErr('');
    const payload = Object.entries(mSel).filter(([, v]) => v.eligible).map(([mid, v]) => {
      const mc = master.machines.find((x) => String(x.id) === String(mid));
      const dep = master.departments.find((x) => String(x.id) === String(mc?.departmentId));
      return { departmentId: mc?.departmentId, machineId: Number(mid), eligible: true,
        speed: v.speed === '' ? undefined : Number(v.speed),
        // Issues 1.0 #3: the chosen unit; department default when QC left it alone.
        speedUom: v.uom || deptSpeedUnit(mc?.departmentName || dep?.name),
        setupMin: v.setup === '' || v.setup == null ? undefined : Number(v.setup),
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
  // Change 11: a plain dropdown (no type-and-search) — picking an item also pulls
  // its UOM in from the item master when the line has none yet.
  function pickItem(i, id) {
    const found = itemById(id);
    setLines((l) => l.map((x, j) => (j === i ? { ...x, itemId: found ? found.id : '', uom: x.uom || (found && found.uom) || '' } : x)));
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
                <label>Dispatch Form (from the JSS)</label>
                {jssFormName ? (
                  // Issues 1.0 #1: picked from the JSS itself — never a manual dropdown.
                  <div style={{ paddingTop: 6 }}>
                    <span className="tag tb" style={{ fontSize: 12 }}>{jssFormName}</span>
                    {matchedForm
                      ? <span className="pg-sub" style={{ display: 'block', marginTop: 4 }}>Read from this spec — its routes appear on the right.</span>
                      : <span className="al al-y" style={{ display: 'block', marginTop: 6, padding: '6px 8px' }}>
                          No routes exist for “{jssFormName}” yet — Super Admin adds them under Dashboard → Routes.
                        </span>}
                  </div>
                ) : (
                  // Legacy spec without a dispatch form — fall back to a manual pick.
                  <>
                    <select value={jss.config?.dispatchTypeId ?? ''} onChange={(e) => setDispatch(e.target.value)}>
                      <option value="">— none —</option>
                      {master.dispatchTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <span className="pg-sub" style={{ display: 'block', marginTop: 4 }}>This spec has no dispatch form — set it on the spec (QC → Add Spec) to auto-pick.</span>
                  </>
                )}
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
                <label>Default job setup time (minutes)</label>
                <input type="number" min="0" step="1" value={setupMin} placeholder="e.g. 30"
                  onChange={(e) => setSetupMin(e.target.value)} aria-label="Job setup time (minutes)" />
              </div>
              <button className="btn btn-s" onClick={saveSetup}>Save setup time</button>
              <span className="pg-sub" style={{ margin: 0 }}>Fallback when a machine below has no setup time of its own; counted against machine availability when planning.</span>
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
                        <thead><tr><th style={{ width: 44 }}>Use</th><th>Machine</th><th style={{ width: 110 }}>Speed unit</th><th style={{ width: 140 }}>Ideal speed</th><th style={{ width: 150 }}>Job speed / min</th><th style={{ width: 150 }}>Setup time (min)</th><th style={{ width: 150 }}>Changeover (min)</th></tr></thead>
                        <tbody>
                          {list.map((mc) => {
                            const sel = mSel[mc.id] || {};
                            const on = !!sel.eligible;
                            const unit = sel.uom || deptSpeedUnit(d.departmentName);
                            return (
                              <tr key={mc.id} className={on ? 'hi' : undefined}>
                                <td><input type="checkbox" checked={on} onChange={() => toggleMachine(mc.id)} /></td>
                                <td>{mc.code} — {mc.name}</td>
                                {/* Issues 1.0 #3: unit BEFORE the ideal speed — pcs/min for
                                    pouching / sleeving / die punching / packing by default. */}
                                <td>
                                  <select disabled={!on} value={unit} aria-label={`Speed unit for ${mc.name}`}
                                    onChange={(e) => setMField(mc.id, 'uom', e.target.value)}>
                                    <option value="m/min">m/min</option>
                                    <option value="pcs/min">pcs/min</option>
                                  </select>
                                </td>
                                {/* Req #16: the Super Admin's ideal speed — read-only for QC. */}
                                <td style={{ fontWeight: 600, color: 'var(--i2)' }}>{mc.defaultSpeed != null ? `${mc.defaultSpeed} ${unit}` : '—'}</td>
                                <td><input type="number" min="0" step="any" disabled={!on} placeholder={mc.defaultSpeed ?? ''} value={sel.speed ?? ''}
                                  aria-label={`Job speed for ${mc.name}`} onChange={(e) => setMField(mc.id, 'speed', e.target.value)} /></td>
                                {/* Req #17: QC's job setup time for THIS job on THIS machine. */}
                                <td><input type="number" min="0" step="1" disabled={!on} value={sel.setup ?? ''} placeholder={setupMin || ''}
                                  aria-label={`Setup time for ${mc.name}`} onChange={(e) => setMField(mc.id, 'setup', e.target.value)} /></td>
                                <td><input type="number" min="0" step="1" disabled={!on} value={sel.changeover ?? ''}
                                  aria-label={`Changeover for ${mc.name}`} onChange={(e) => setMField(mc.id, 'changeover', e.target.value)} /></td>
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
              <div className="fg">
                <label>Base UOM{jssFormName ? ` (auto from “${jssFormName}”)` : ''}</label>
                {/* Issues 1.0 #2: a fixed dropdown, auto-picked from the dispatch form —
                    free text would make the SO-quantity × per-base maths meaningless. */}
                <select value={baseUom} aria-label="Base UOM" onChange={(e) => setBaseUom(e.target.value)}>
                  <option value="">— select —</option>
                  {(baseUom && !BASE_UOMS.includes(baseUom) ? [baseUom, ...BASE_UOMS] : BASE_UOMS).map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="fg"><label>&nbsp;</label><div style={{ paddingTop: 8 }} className="pg-sub">Requirement = (SO qty / base) × qty per base.</div></div>
            </div>
            {!routeDepts.length ? (
              <div className="al al-y">Set the route first.</div>
            ) : routeDepts.map((d) => {
              const deptLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => String(l.departmentId) === String(d.departmentId));
              const deptItems = itemsForDept(d.departmentId);
              return (
                <div key={d.departmentId} style={{ marginBottom: 12 }}>
                  <div className="fbar" style={{ justifyContent: 'space-between' }}>
                    <div className="ctitle" style={{ margin: 0, fontSize: 12 }}>{d.seq}. {d.departmentName}
                      <span className="tag tgr" style={{ marginLeft: 6 }}>{deptItems.length} item(s) tagged</span></div>
                    <button className="btn btn-s" onClick={() => addLine(d.departmentId)}>＋ Add item</button>
                  </div>
                  {deptLines.length === 0 ? <div className="al al-y">No items for this department.</div> : (
                    <div className="tw">
                      <table>
                        <thead><tr><th>Item</th><th style={{ width: 120 }}>Item code</th><th style={{ width: 160 }}>Qty / base</th><th style={{ width: 120 }}>UOM</th><th style={{ width: 60 }}></th></tr></thead>
                        <tbody>
                          {deptLines.map(({ l, i }) => {
                            const sel = itemById(l.itemId);
                            return (
                              <tr key={i}>
                                <td>
                                  {/* Change 11: dropdown of this department's items — no search. */}
                                  <select style={{ width: '100%' }} aria-label={`BOM item for ${d.departmentName}`}
                                    value={l.itemId || ''} onChange={(e) => pickItem(i, e.target.value)}>
                                    <option value="">— select an item —</option>
                                    {sel && !deptItems.some((it) => String(it.id) === String(sel.id)) && (
                                      <option value={sel.id}>{itemLabel(sel)}</option>
                                    )}
                                    {deptItems.map((it) => <option key={it.id} value={it.id}>{itemLabel(it)}</option>)}
                                  </select>
                                </td>
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
