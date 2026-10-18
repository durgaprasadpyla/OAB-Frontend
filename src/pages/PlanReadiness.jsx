import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../data.jsx';
import { planningApi } from '../api.js';
import { dash, today } from '../lib/format.js';
import { balance, calcMetres, calcKg } from '../lib/calc.js';
import { findSpecForRow } from '../lib/master.js';
import PlanDownloads from '../components/PlanDownloads.jsx';
import SoBomDownloads from '../components/SoBomDownloads.jsx';
import SoWastagePanel from '../components/SoWastagePanel.jsx';
import MaterialAssignPanel from '../components/MaterialAssignPanel.jsx';

// PLAN landing page — Enhancements 2.0 §46-56. Against each open sale order the
// readiness gatekeeper picks: Ready to plan (entire / partial SO with metres), or
// Not ready — plates / material / others. A not-ready pick requires the tentative
// date it will be ready; "others" also requires a free-text reason. The screen also
// downloads the weekly / daily plans the PPC has saved and highlights any plan
// changes made after saving (§56).

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rt = { textAlign: 'right' };

// Issues 17.10 §6: "the 'Ready to Plan' and whether we are planning for the entire
// sale order, partial sale order … should be in the table header only. I could not
// spot 'Ready to Plan', 'Plan Partial', or 'Plan Full'. Upon selecting a radio
// button, the buttons on top should be enabled." So the per-row dropdowns at the far
// right are gone: the radio picks the order and ONE action bar sitting directly above
// the board (attached to the table's own scroll box, so it stays beside the header)
// carries Full / Partial / Clear Ready and the not-ready reasons.
const NOT_READY_OPTIONS = [
  { v: 'PLATES', label: 'Plates' },
  { v: 'MATERIAL', label: 'Material' },
  { v: 'OTHERS', label: 'Others' },
];
const REASON_LABEL = { PLATES: 'Plates', MATERIAL: 'Material', OTHERS: 'Others' };

export default function PlanReadiness() {
  const { mods } = useData();
  const [board, setBoard] = useState([]);        // /readiness rows keyed by SO
  // Issues 17.10 §6: the action bar's inline form — '' | 'PARTIAL' | 'NOTREADY'.
  const [act, setAct] = useState('');
  const [form, setForm] = useState({ meters: '', reason: '', date: '', note: '' });
  const [busy, setBusy] = useState('');          // so currently saving
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [weekFrom] = useState(today());          // §56 change panel's week window
  const [changes, setChanges] = useState([]);    // §56: jobs edited after first save
  const [q, setQ] = useState('');                // Issues 2.2 §7: search the board
  const [specFil, setSpecFil] = useState('');
  // BOM calculations 24.09 §5: "let us have radio button selections against each
  // sale order, just like item master … I select a radio button against a sale
  // order, then let the list be populated at the top based on the BOM that is
  // attached to this particular spec number." So the material list no longer opens
  // inside the row — the radio picks the order and the panel sits ABOVE the board,
  // where it reads without scrolling right and then back down.
  const [matFor, setMatFor] = useState('');

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  const loadBoard = useCallback(async () => {
    setErr('');
    // Anything but a list here (a proxy's error body, an empty 200) used to take the
    // whole board down with "forEach is not a function" — the readiness state is a
    // list or it is nothing.
    try { const b = await planningApi.readiness(); setBoard(Array.isArray(b) ? b : []); }
    catch (e) { setErr(e.message || 'Failed to load the planning board'); }
  }, []);
  useEffect(() => { loadBoard(); }, [loadBoard]);

  // §56: plan changes for the visible week (jobs whose plan was edited after saving).
  const loadChanges = useCallback(async () => {
    try {
      const w = await planningApi.week(weekFrom, addDays(weekFrom, 6));
      setChanges(((w && w.jobs) || []).filter((j) => j.changed));
    } catch { /* the change panel is best-effort */ }
  }, [weekFrom]);
  useEffect(() => { loadChanges(); }, [loadChanges]);

  const stateBySo = useMemo(() => {
    const m = {};
    (board || []).forEach((p) => { m[p.so] = p; });
    return m;
  }, [board]);

  // Every OPEN sale order (module 1), the list the gatekeeper works down — carrying
  // the same JSS-derived figures the PM board shows (Issues 2.2 §7). The planner
  // decides off the SKU and the FILM WIDTH, so those travel with every row. What the
  // PM board additionally does — entering printed Kg / metres — is not here: that is
  // the MIS login's job now.
  const openRows = useMemo(() => {
    const oab = (mods && mods.oab && mods.oab.OAB) || {};
    const jss = (mods && mods.jss) || [];
    const rows = [];
    ['SF', 'OT'].forEach((sh) => (oab[sh] || []).forEach((r) => {
      if (r.closed) return;
      const j = findSpecForRow(jss, r);
      // Issues 17.10: the job's metres and kg by its dispatch form, exactly as the OAB
      // board and the server's Ready check work them out — this used qty × pouch width
      // for every form, so a 10,000 m roll read as 4,35,000 m.
      const mt = calcMetres(r, num(r.poQty), j);
      const kg = calcKg(r, num(r.poQty), j);
      rows.push({
        ...r,
        sheet: sh,
        // SKU follows the CURRENT spec — the row's stored jobName is only the copy
        // taken at SO creation, so a repointed spec self-corrects here too.
        sku: (j && j.jobName) || r.jobName || '',
        customer: (j && j.customer) || r.customer || '',
        dispLoc: r.dispLoc || '',
        disp: num(r.invDisp) + num(r.manDisp),
        bal: balance(r),
        substrate: (j && j.material) || '',
        filmWidth: (j && j.filmWidth) || '',
        thickness: (j && j.mic) || '',
        gsm: (j && j.gsm) || '',
        pouchW: (j && j.width) || '',
        pouchH: (j && j.height) || '',
        totalKg: kg ? kg.net : 0,
        totalMt: mt.net,
      });
    }));
    return rows.sort((a, b) => String(b.so).localeCompare(String(a.so), undefined, { numeric: true }));
  }, [mods]);

  // Spec filter + free-text search, the same pair the PM board offers.
  const specOptions = useMemo(() => [...new Set(openRows.map((r) => r.spec).filter(Boolean))].sort(), [openRows]);
  const visibleRows = useMemo(() => {
    let list = specFil ? openRows.filter((r) => String(r.spec || '') === specFil) : openRows;
    const t = q.trim().toLowerCase();
    if (t) list = list.filter((r) => [r.so, r.customer, r.spec, r.sku, r.dispLoc, r.substrate].some((v) => String(v || '').toLowerCase().includes(t)));
    return list;
  }, [openRows, q, specFil]);

  // The order picked with the radio — its material panel opens above, and the action
  // bar over the board acts on it (Issues 17.10 §6).
  const pickedRow = useMemo(() => openRows.find((r) => r.so === matFor) || null, [openRows, matFor]);
  const pickedState = pickedRow ? stateBySo[pickedRow.so] : null;

  // Issues 17.10 §6: picking a row resets the bar's inline form to that order's state.
  function pick(so) {
    setMatFor(so);
    setAct('');
    setErr('');
    const cur = stateBySo[so];
    setForm({
      meters: cur?.readyToPlan && cur.readyMode === 'PARTIAL' && cur.readyQty != null ? String(cur.readyQty) : '',
      reason: cur && !cur.readyToPlan ? (cur.notReadyReason || '') : '',
      date: cur && !cur.readyToPlan ? (cur.expectedReadyDate || '') : '',
      note: cur && !cur.readyToPlan ? (cur.notReadyNote || '') : '',
    });
  }

  const readyCount = useMemo(() => openRows.filter((r) => stateBySo[r.so]?.readyToPlan).length, [openRows, stateBySo]);
  const notReadyCount = useMemo(() => openRows.filter((r) => stateBySo[r.so] && !stateBySo[r.so].readyToPlan && stateBySo[r.so].notReadyReason).length, [openRows, stateBySo]);

  // Issues 17.10 §6: the same POST /api/planning/ready calls the per-row controls made.
  async function send(so, call, okMsg) {
    setBusy(so);
    try {
      await call();
      flash(okMsg);
      setAct('');
      await loadBoard();
    } catch (e) { setErr(e.message || `Could not update ${so}`); }
    finally { setBusy(''); }
  }

  function markFull() {
    if (!pickedRow) return;
    const so = pickedRow.so;
    setErr('');
    send(so, () => planningApi.setReady(so, true, 'COMPLETE', undefined), `${so}: Ready to Plan — Entire SO`);
  }

  function savePartial() {
    if (!pickedRow) return;
    const so = pickedRow.so;
    setErr('');
    // Issues 2.4 §4: Partial is captured in METRES, so it is bounded by the order's
    // metres — not by its piece count. Showing "of 50600" against a 12,650 m job read
    // as though 50,600 metres could be entered, when 50,600 is the number of pouches.
    const jobMetres = num(pickedRow.totalMt);
    const qty = num(form.meters);
    if (!(qty > 0)) { setErr(`Enter the metres ready for ${so} (must be greater than 0)`); return; }
    if (jobMetres > 0 && qty > jobMetres + 1e-9) {
      setErr(`${so}: metres ready cannot exceed the ${Math.round(jobMetres).toLocaleString('en-IN')} m this order runs to`);
      return;
    }
    send(so, () => planningApi.setReady(so, true, 'PARTIAL', qty), `${so}: Ready to Plan — Partial (${qty} m)`);
  }

  function saveNotReady() {
    if (!pickedRow) return;
    const so = pickedRow.so;
    setErr('');
    if (!form.reason) { setErr(`${so}: choose why it is not ready (plates / material / others)`); return; }
    if (!form.date) { setErr(`${so}: enter the tentative date it will be ready`); return; }
    if (form.reason === 'OTHERS' && !String(form.note || '').trim()) { setErr(`${so}: describe what is stopping the planning`); return; }
    send(so, () => planningApi.setReady(so, false, undefined, undefined, {
      notReadyReason: form.reason, expectedReadyDate: form.date, notReadyNote: form.note || undefined,
    }), `${so}: Not ready (${REASON_LABEL[form.reason]}) — tentative ${form.date}`);
  }

  // Clear Ready — the same un-mark the Production screen makes: ready=false, no reason.
  function clearReady() {
    if (!pickedRow) return;
    const so = pickedRow.so;
    setErr('');
    setForm((f) => ({ ...f, meters: '' }));
    send(so, () => planningApi.setReady(so, false), `${so}: Ready to Plan cleared`);
  }

  const statusTag = (cur) => (cur?.readyToPlan
    ? <span className={'tag ' + (cur.readyMode === 'PARTIAL' ? 'tb' : 'tg')}>{cur.readyMode === 'PARTIAL' ? `Partial · ${cur.readyQty} m` : 'Entire SO'}</span>
    : cur?.notReadyReason
      ? <span className="tag tr" title={cur.notReadyNote || ''}>Not ready — {REASON_LABEL[cur.notReadyReason] || cur.notReadyReason} · by {cur.expectedReadyDate}</span>
      : <span className="tag tgr">Not set</span>);

  const noPick = !pickedRow;
  const saving = !!pickedRow && busy === pickedRow.so;
  const barBtn = { height: 28, fontSize: 12 };
  // With an order picked, its messages show in the action bar the user is looking at
  // (the board can sit a long scroll below the page title).
  const msgInBar = !!pickedRow;

  return (
    <div id="app">
      <div className="pg-ttl">✅ Planning — Ready to Plan</div>
      <div className="pg-sub">Pick the radio button against a sale order, then use the buttons above the table to mark it Ready to Plan (full / partial SO), or record why it is not ready (plates / material / others) with the tentative ready date. Download the weekly / daily plans the PPC has saved.</div>
      {!msgInBar && err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}
      {!msgInBar && msg && <div className="al al-g" style={{ margin: '8px 0' }}>{msg}</div>}

      <div className="stats">
        <div className="stat"><div className="sl">Open sale orders</div><div className="sv">{openRows.length}</div></div>
        <div className="stat"><div className="sl">Ready to Plan</div><div className="sv" style={{ color: '#1e7e34' }}>{readyCount}</div></div>
        <div className="stat"><div className="sl">Not ready (with reason)</div><div className="sv" style={{ color: '#c0392b' }}>{notReadyCount}</div></div>
        <div className="stat"><div className="sl">Unmarked</div><div className="sv">{openRows.length - readyCount - notReadyCount}</div></div>
      </div>

      {/* Plan downloads (§55) — shared with the planner and the Plant login (§63) */}
      <PlanDownloads compact />
      <SoBomDownloads compact />

      {/* P6: department-wise wastage against each sale order, on the PLAN dashboard too */}
      <SoWastagePanel from={addDays(today(), -6)} to={today()} />

      {/* §56: changes to an already-saved plan, clearly visible */}
      {changes.length > 0 && (
        <div className="card" style={{ marginTop: 12, borderLeft: '4px solid #c9a100' }}>
          <div className="ctitle">⚠ Plan changes this week <span className="tag ty">{changes.length}</span></div>
          <div className="tw sy" style={{ maxHeight: 220 }}><table>
            <thead><tr><th>Date</th><th>Shift</th><th>Sale Order</th><th>Department</th><th>Machine</th><th>Qty</th><th>Start–End</th></tr></thead>
            <tbody>{changes.map((j) => (
              <tr key={j.id} className="hi">
                <td>{j.planDate}</td><td>{j.shift || 'A'}</td>
                <td><span className="so-pill">{j.so}</span></td>
                <td>{j.departmentName}</td><td>{j.machineName}</td>
                <td>{j.plannedQty}</td><td>{j.startTime || '—'}–{j.endTime || '—'}</td>
              </tr>))}</tbody>
          </table></div>
        </div>
      )}

      {/* The picked order's material — above the board, per §5. */}
      {pickedRow && (
        <div className="card" id="plan-material-panel" style={{ marginTop: 12 }} aria-label="Material for the picked sale order">
          <div className="fbar" style={{ flexWrap: 'wrap' }}>
            <div className="ctitle" style={{ margin: 0 }}>
              Material for <span className="so-pill">{pickedRow.so}</span>
              <span className="tag tb" style={{ marginLeft: 8, fontSize: 9 }}>{pickedRow.spec}</span>
              <span style={{ fontWeight: 400, color: 'var(--i3)', marginLeft: 8, fontSize: 11 }}>
                {pickedRow.customer} · {pickedRow.sku}
              </span>
            </div>
            <span style={{ flex: 1 }} />
            <button className="btn btn-s" style={{ height: 26, fontSize: 11 }}
              aria-label="Close the material panel" onClick={() => setMatFor('')}>✕ Close</button>
          </div>
          {/* 30.09: the BOM is scaled on the ORDER quantity, not the balance — what has
              been issued to an order is a lifetime figure, and the stores desk and the
              server's BOM cap measure it against the whole order too. */}
          {/* Keyed by the order: switching orders starts a fresh panel, so the last
              order's holds, issues and coverage never show (or disable Assign) under
              the new one while its position loads. */}
          <MaterialAssignPanel
            key={pickedRow.so}
            so={pickedRow.so}
            spec={pickedRow.spec}
            material={pickedRow.substrate}
            soQty={num(pickedRow.poQty)}
            onChange={loadBoard}
          />
        </div>
      )}

      {/* Readiness list (§46-54) */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="fbar" style={{ flexWrap: 'wrap' }}>
          <div className="ctitle" style={{ margin: 0 }}>Sale orders <span className="tag ty">{visibleRows.length}</span></div>
          <input placeholder="Search SO / customer / spec / SKU…" value={q} aria-label="Search sale orders"
            onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
          <select value={specFil} onChange={(e) => setSpecFil(e.target.value)} aria-label="Filter by spec">
            <option value="">All specs</option>
            {specOptions.map((sp) => <option key={sp} value={sp}>{sp}</option>)}
          </select>
        </div>
        {/* Issues 17.10 §6: the action bar — directly on top of the board's scroll box,
            so it always sits with the table header while the rows scroll beneath. */}
        {openRows.length > 0 && (
          <div role="toolbar" aria-label="Ready to Plan actions"
            style={{ background: noPick ? 'var(--bg)' : '#fff8e1', border: '1px solid var(--bd)', borderBottom: 'none',
              borderRadius: '8px 8px 0 0', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {noPick ? (
                <span style={{ fontSize: 12, color: 'var(--i3)' }}>Pick the radio button against a sale order to mark it Ready to Plan.</span>
              ) : (
                <span style={{ fontSize: 12 }} aria-label="Selected sale order">
                  Selected: <span className="so-pill">{pickedRow.so}</span>
                  <span className="tag tb" style={{ marginLeft: 6, fontSize: 9 }}>{pickedRow.spec}</span>
                  <span style={{ color: 'var(--i3)', marginLeft: 6 }}>{pickedRow.customer}</span>
                  <span style={{ marginLeft: 6 }}>{statusTag(pickedState)}</span>
                </span>
              )}
              <span style={{ flex: 1 }} />
              <button className="btn btn-g" style={barBtn} disabled={noPick || saving} onClick={markFull}>✓ Ready to Plan — Full</button>
              <button className="btn btn-s" style={{ ...barBtn, ...(act === 'PARTIAL' ? { borderColor: 'var(--g)', color: 'var(--g)' } : null) }}
                disabled={noPick || saving} aria-pressed={act === 'PARTIAL'}
                onClick={() => setAct(act === 'PARTIAL' ? '' : 'PARTIAL')}>◐ Ready to Plan — Partial</button>
              {pickedState?.readyToPlan && (
                <button className="btn btn-s" style={barBtn} disabled={saving} onClick={clearReady}>Clear Ready</button>
              )}
              <button className="btn btn-s" style={{ ...barBtn, ...(act === 'NOTREADY' ? { borderColor: 'var(--red)', color: 'var(--red)' } : null) }}
                disabled={noPick || saving} aria-pressed={act === 'NOTREADY'}
                onClick={() => setAct(act === 'NOTREADY' ? '' : 'NOTREADY')}>✕ Not Ready…</button>
              {!noPick && (
                <button className="btn btn-s" style={barBtn} title="Show the material panel above"
                  onClick={() => { try { document.getElementById('plan-material-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* jsdom */ } }}>📦 Material ↑</button>
              )}
            </div>
            {!noPick && act === 'PARTIAL' && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12 }}>Metres ready for <b>{pickedRow.so}</b>:</span>
                <input type="number" step="any" min="0" className="nospin"
                  max={pickedRow.totalMt ? Math.round(pickedRow.totalMt) : undefined}
                  aria-label={`Metres ready for ${pickedRow.so}`}
                  title={pickedRow.totalMt ? `This order runs to ${Math.round(pickedRow.totalMt).toLocaleString('en-IN')} metres` : undefined}
                  placeholder={pickedRow.totalMt ? `metres (of ${Math.round(pickedRow.totalMt).toLocaleString('en-IN')} m)` : 'metres ready'}
                  value={form.meters} autoFocus
                  onChange={(e) => setForm((f) => ({ ...f, meters: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') savePartial(); }}
                  style={{ width: 170, height: 28 }} />
                <button className="btn btn-g" style={barBtn} disabled={saving} onClick={savePartial}>Save</button>
                <button className="btn btn-s" style={barBtn} onClick={() => setAct('')}>Cancel</button>
              </div>
            )}
            {!noPick && act === 'NOTREADY' && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12 }}>Not ready — <b>{pickedRow.so}</b>:</span>
                <select aria-label={`Not ready reason type for ${pickedRow.so}`} value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} style={{ height: 28 }}>
                  <option value="">— why? —</option>
                  {NOT_READY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
                <input type="date" aria-label={`Tentative ready date for ${pickedRow.so}`} title="Tentative ready date"
                  value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={{ height: 28 }} />
                {form.reason === 'OTHERS' && (
                  <input placeholder="what is stopping planning?" aria-label={`Not ready reason for ${pickedRow.so}`} value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} style={{ width: 220, height: 28 }} />
                )}
                <button className="btn btn-g" style={barBtn} disabled={saving} onClick={saveNotReady}>Save</button>
                <button className="btn btn-s" style={barBtn} onClick={() => setAct('')}>Cancel</button>
              </div>
            )}
            {msgInBar && err && <div className="al al-r" style={{ margin: 0 }}>{err}</div>}
            {msgInBar && msg && <div className="al al-g" style={{ margin: 0 }}>{msg}</div>}
          </div>
        )}
        {openRows.length === 0 ? <div className="al al-b">No open sale orders.</div> : (
          <div className="tw sy"><table>
            {/* Issues 2.2 §7: the PM board's display fields — SKU and FILM WIDTH above
                all, since the planner judges plannability off the film width. */}
            <thead><tr>
              <th style={{ width: 34, textAlign: 'center' }}>Select</th>
              <th>Sale Order</th><th>Spec</th><th style={{ minWidth: 170 }}>SKU</th><th>Customer</th><th>Disp Loc</th>
              <th style={rt}>PO Qty</th><th style={rt}>Dispatched</th><th style={rt}>Balance</th>
              <th>Substrate</th><th style={rt}>Film W</th><th style={rt}>Thick (mic)</th><th style={rt}>GSM</th>
              <th style={rt}>Pouch W</th><th style={rt}>Pouch H</th><th style={rt}>Total Kg</th><th style={rt}>Total Mt</th>
              <th>Readiness</th>
            </tr></thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr><td colSpan={18} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No sale orders match</td></tr>
              )}
              {visibleRows.map((r) => {
                const cur = stateBySo[r.so];
                return (
                  <Fragment key={r.so}>
                  {/* Issues 17.10 §6: the picked row stands out from the not-ready 'hi'
                      tint (both were --gl before), and a click anywhere on it picks it. */}
                  <tr className={cur?.readyToPlan ? undefined : 'hi'} aria-selected={matFor === r.so}
                      onClick={(e) => { if (e.target.tagName !== 'INPUT' && matFor !== r.so) pick(r.so); }}
                      style={{ cursor: 'pointer', ...(matFor === r.so ? { background: '#fff3cd', boxShadow: 'inset 3px 0 0 var(--g)' } : null) }}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="radio" name="plan-select-so" checked={matFor === r.so}
                        aria-label={`Select ${r.so}`} style={{ cursor: 'pointer' }}
                        onChange={() => pick(r.so)} />
                    </td>
                    <td><span className="so-pill">{r.so}</span></td>
                    <td><span className="tag tb" style={{ fontSize: 9 }}>{r.spec}</span></td>
                    <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{r.sku || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.customer}</td>
                    <td style={{ fontSize: 11 }}>{r.dispLoc || '—'}</td>
                    <td style={rt}>{dash(r.poQty)}</td>
                    <td style={{ ...rt, color: 'var(--g)' }}>{dash(r.disp)}</td>
                    <td style={{ ...rt, fontWeight: 700 }}>{dash(r.bal)}</td>
                    <td style={{ fontSize: 11 }}>{r.substrate || '—'}</td>
                    {/* the field the planner actually decides on */}
                    <td style={{ ...rt, fontWeight: 700, color: 'var(--blu)' }}>{r.filmWidth || '—'}</td>
                    <td style={rt}>{r.thickness || '—'}</td>
                    <td style={rt}>{r.gsm || '—'}</td>
                    <td style={rt}>{r.pouchW || '—'}</td>
                    <td style={rt}>{r.pouchH || '—'}</td>
                    <td style={rt}>{r.totalKg ? r.totalKg.toFixed(1) : '—'}</td>
                    <td style={rt}>{r.totalMt ? Math.round(r.totalMt).toLocaleString('en-IN') : '—'}</td>
                    <td>{statusTag(cur)}</td>
                  </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
