import { useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../data.jsx';
import { planningApi } from '../api.js';
import { dash, today } from '../lib/format.js';
import { balance } from '../lib/calc.js';
import { findSpecForRow } from '../lib/master.js';
import PlanDownloads from '../components/PlanDownloads.jsx';
import SoWastagePanel from '../components/SoWastagePanel.jsx';

// PLAN landing page — Enhancements 2.0 §46-56. Against each open sale order the
// readiness gatekeeper picks: Ready to plan (entire / partial SO with metres), or
// Not ready — plates / material / others. A not-ready pick requires the tentative
// date it will be ready; "others" also requires a free-text reason. The screen also
// downloads the weekly / daily plans the PPC has saved and highlights any plan
// changes made after saving (§56).

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rt = { textAlign: 'right' };

// §46-50: the one dropdown the doc asks for.
const READINESS_OPTIONS = [
  { v: 'READY', label: 'Ready to plan' },
  { v: 'PLATES', label: 'Not ready — plates' },
  { v: 'MATERIAL', label: 'Not ready — material' },
  { v: 'OTHERS', label: 'Not ready — others' },
];
const REASON_LABEL = { PLATES: 'Plates', MATERIAL: 'Material', OTHERS: 'Others' };

export default function PlanReadiness() {
  const { mods } = useData();
  const [board, setBoard] = useState([]);        // /readiness rows keyed by SO
  const [draft, setDraft] = useState({});        // so -> { pick, mode, meters, date, note }
  const [busy, setBusy] = useState('');          // so currently saving
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [weekFrom] = useState(today());          // §56 change panel's week window
  const [changes, setChanges] = useState([]);    // §56: jobs edited after first save
  const [q, setQ] = useState('');                // Issues 2.2 §7: search the board
  const [specFil, setSpecFil] = useState('');

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  const loadBoard = useCallback(async () => {
    setErr('');
    try { setBoard(await planningApi.readiness() || []); }
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
      const pw = j ? num(j.pouchWeight) : 0;
      const widthMm = j ? num(j.width) : 0;
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
        totalKg: pw > 0 ? num(r.poQty) * pw / 1000 : 0,
        totalMt: widthMm > 0 ? num(r.poQty) * widthMm / 1000 : 0,
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

  const readyCount = useMemo(() => openRows.filter((r) => stateBySo[r.so]?.readyToPlan).length, [openRows, stateBySo]);
  const notReadyCount = useMemo(() => openRows.filter((r) => stateBySo[r.so] && !stateBySo[r.so].readyToPlan && stateBySo[r.so].notReadyReason).length, [openRows, stateBySo]);

  const draftFor = (so) => {
    if (draft[so]) return draft[so];
    const cur = stateBySo[so];
    if (!cur) return { pick: '', mode: '', meters: '', date: '', note: '' };
    if (cur.readyToPlan) return { pick: 'READY', mode: cur.readyMode || 'COMPLETE', meters: cur.readyMode === 'PARTIAL' && cur.readyQty != null ? String(cur.readyQty) : '', date: '', note: '' };
    if (cur.notReadyReason) return { pick: cur.notReadyReason, mode: '', meters: '', date: cur.expectedReadyDate || '', note: cur.notReadyNote || '' };
    return { pick: '', mode: '', meters: '', date: '', note: '' };
  };
  const setDraftFor = (so, patch) => setDraft((d) => ({ ...d, [so]: { ...draftFor(so), ...patch } }));

  async function apply(row) {
    const so = row.so;
    const d = draftFor(so);
    setErr('');
    if (!d.pick) { setErr(`Choose a readiness option for ${so}`); return; }
    const jobQty = num(row.poQty);
    if (d.pick === 'READY') {
      if (d.mode === 'PARTIAL') {
        const q = num(d.meters);
        if (!(q > 0)) { setErr(`Enter the metres ready for ${so} (must be greater than 0)`); return; }
        if (jobQty > 0 && q > jobQty + 1e-9) { setErr(`${so}: metres ready cannot exceed the job quantity (${jobQty})`); return; }
      } else if (d.mode !== 'COMPLETE') { setErr(`Choose Entire SO or Partial SO for ${so}`); return; }
    } else {
      if (!d.date) { setErr(`${so}: enter the tentative date it will be ready`); return; }
      if (d.pick === 'OTHERS' && !String(d.note || '').trim()) { setErr(`${so}: describe what is stopping the planning`); return; }
    }
    setBusy(so);
    try {
      if (d.pick === 'READY') {
        const qty = d.mode === 'PARTIAL' ? num(d.meters) : undefined;
        await planningApi.setReady(so, true, d.mode, qty);
        flash(d.mode === 'PARTIAL' ? `${so}: Ready to Plan — Partial (${qty} m)` : `${so}: Ready to Plan — Entire SO`);
      } else {
        await planningApi.setReady(so, false, undefined, undefined, {
          notReadyReason: d.pick, expectedReadyDate: d.date, notReadyNote: d.note || undefined,
        });
        flash(`${so}: Not ready (${REASON_LABEL[d.pick]}) — tentative ${d.date}`);
      }
      setDraft((dd) => { const n = { ...dd }; delete n[so]; return n; });
      await loadBoard();
    } catch (e) { setErr(e.message || `Could not update ${so}`); }
    finally { setBusy(''); }
  }

  return (
    <div id="app">
      <div className="pg-ttl">✅ Planning — Ready to Plan</div>
      <div className="pg-sub">Mark each open sale order Ready to Plan (entire / partial SO), or record why it is not ready (plates / material / others) with the tentative ready date. Download the weekly / daily plans the PPC has saved.</div>
      {err && <div className="al al-r" style={{ margin: '8px 0' }}>{err}</div>}
      {msg && <div className="al al-g" style={{ margin: '8px 0' }}>{msg}</div>}

      <div className="stats">
        <div className="stat"><div className="sl">Open sale orders</div><div className="sv">{openRows.length}</div></div>
        <div className="stat"><div className="sl">Ready to Plan</div><div className="sv" style={{ color: '#1e7e34' }}>{readyCount}</div></div>
        <div className="stat"><div className="sl">Not ready (with reason)</div><div className="sv" style={{ color: '#c0392b' }}>{notReadyCount}</div></div>
        <div className="stat"><div className="sl">Unmarked</div><div className="sv">{openRows.length - readyCount - notReadyCount}</div></div>
      </div>

      {/* Plan downloads (§55) — shared with the planner and the Plant login (§63) */}
      <PlanDownloads compact />

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
        {openRows.length === 0 ? <div className="al al-b">No open sale orders.</div> : (
          <div className="tw sy"><table>
            {/* Issues 2.2 §7: the PM board's display fields — SKU and FILM WIDTH above
                all, since the planner judges plannability off the film width. */}
            <thead><tr>
              <th>Sale Order</th><th>Spec</th><th style={{ minWidth: 170 }}>SKU</th><th>Customer</th><th>Disp Loc</th>
              <th style={rt}>PO Qty</th><th style={rt}>Dispatched</th><th style={rt}>Balance</th>
              <th>Substrate</th><th style={rt}>Film W</th><th style={rt}>Thick (mic)</th><th style={rt}>GSM</th>
              <th style={rt}>Pouch W</th><th style={rt}>Pouch H</th><th style={rt}>Total Kg</th><th style={rt}>Total Mt</th>
              <th>Readiness</th><th style={{ minWidth: 420 }}>Set readiness</th>
            </tr></thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr><td colSpan={18} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No sale orders match</td></tr>
              )}
              {visibleRows.map((r) => {
                const cur = stateBySo[r.so];
                const d = draftFor(r.so);
                return (
                  <tr key={r.so} className={cur?.readyToPlan ? undefined : 'hi'}>
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
                    <td>{cur?.readyToPlan
                      ? <span className={'tag ' + (cur.readyMode === 'PARTIAL' ? 'tb' : 'tg')}>{cur.readyMode === 'PARTIAL' ? `Partial · ${cur.readyQty} m` : 'Entire SO'}</span>
                      : cur?.notReadyReason
                        ? <span className="tag tr" title={cur.notReadyNote || ''}>Not ready — {REASON_LABEL[cur.notReadyReason] || cur.notReadyReason} · by {cur.expectedReadyDate}</span>
                        : <span className="tag tgr">Not set</span>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select aria-label={`Readiness for ${r.so}`} value={d.pick} onChange={(e) => setDraftFor(r.so, { pick: e.target.value })} style={{ height: 28 }}>
                          <option value="">— select —</option>
                          {READINESS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                        </select>
                        {d.pick === 'READY' && (
                          <select aria-label={`Ready mode for ${r.so}`} value={d.mode} onChange={(e) => setDraftFor(r.so, { mode: e.target.value })} style={{ height: 28 }}>
                            <option value="">— entire / partial —</option>
                            <option value="COMPLETE">Entire SO</option>
                            <option value="PARTIAL">Partial SO</option>
                          </select>
                        )}
                        {d.pick === 'READY' && d.mode === 'PARTIAL' && (
                          <input type="number" step="any" min="0" placeholder={`metres (of ${r.poQty})`} value={d.meters}
                            onChange={(e) => setDraftFor(r.so, { meters: e.target.value })} style={{ width: 130, height: 28 }} />
                        )}
                        {d.pick && d.pick !== 'READY' && (
                          <input type="date" aria-label={`Tentative ready date for ${r.so}`} title="Tentative ready date"
                            value={d.date} onChange={(e) => setDraftFor(r.so, { date: e.target.value })} style={{ height: 28 }} />
                        )}
                        {d.pick === 'OTHERS' && (
                          <input placeholder="what is stopping planning?" aria-label={`Not ready reason for ${r.so}`} value={d.note}
                            onChange={(e) => setDraftFor(r.so, { note: e.target.value })} style={{ width: 200, height: 28 }} />
                        )}
                        <button className="btn btn-g" style={{ height: 28 }} disabled={busy === r.so || !d.pick} onClick={() => apply(r)}>
                          {cur ? 'Update' : 'Save'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
