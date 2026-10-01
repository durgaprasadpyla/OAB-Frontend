import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useData } from '../data.jsx';
import { GrnEditor } from '../components/GrnAdmin.jsx';
import { PurchaseOrders } from '../components/PurchaseOrdersTab.jsx';
import { isOpenPo, poStatus } from '../lib/poLines.js';
import FgEntryPanel from '../components/FgEntryPanel.jsx';
import { storesApi, masterApi, planningApi } from '../api.js';
import { inr, today } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { parseWidthMm, itemWidthMm, unitWidthMm } from '../lib/itemWidth.js';
import { saveIssueSlipPdf } from '../lib/issueSlipPdf.js';
import StoresIssueHistory, { HISTORY_LIMIT } from '../components/StoresIssueHistory.jsx';
import { asSoMaterial, bomCapBlock, codeKey, coveredOf, hasCap, isComplete, netOut, openOf, sourceLabel } from '../lib/soMaterial.js';

// Stores Login. Four desks, in the order the day runs:
//   Material on Hand — the landing board: every item with its characteristics,
//     live closing stock and MSL; a row expands into the individual rolls / cans,
//     each with its location and its disposition.
//   Purchase Orders  — what purchase has ordered, and the date stores promises it
//     will land. That date is what the PLAN login waits on for a not-ready order.
//   GRN              — receive against a PO: item from the master only, supplier
//     from the item's approved suppliers, supplier label code, our internal code
//     (the sticker), location, invoice price and expiry.
//   Issues & Returns — out to the shop floor and back, oldest roll first (FIFO),
//     including a roll returned as two narrower rolls.

const TABS = [
  { k: 'onhand', label: '📦 Raw Material on Hand' },
  { k: 'sfg', label: '🏭 SFG (semi-finished)' },
  { k: 'fg', label: '✅ FG (finished)' },
  { k: 'pos', label: '📄 Purchase Orders' },
  { k: 'grn', label: '📥 GRN' },
  { k: 'issues', label: '🔄 Issues & Returns' },
];

// The five dispositions the business named. RETURNED is what a split roll comes
// back as; the rest are the stock-health buckets the Super Admin's report groups on.
export const UNIT_STATUSES = [
  { v: 'MOVING', label: 'Moving' },
  { v: 'NON_MOVING', label: 'Non-moving' },
  { v: 'REJECTED', label: 'Rejected' },
  { v: 'RETURNED', label: 'Returned' },
  { v: 'SAMPLE', label: 'Sample' },
];
const statusLabel = (v) => (UNIT_STATUSES.find((s) => s.v === v) || {}).label || v || '—';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const qty = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

export default function Stores() {
  const [tab, setTab] = useState('onhand');
  const [msg, setMsg] = useState(null);
  /**
   * 29.09: "roll number was supposed to be displayed while making the GRN but now it
   * is again showing as auto."
   *
   * This was a NEW FUNCTION on every render, handed to Grn / IssuesReturns / the
   * purchase tab as a prop. Each of them builds its loader with `useCallback([flash])`
   * and runs it from `useEffect([load])` — so every render produced a new `flash`, a
   * new `load`, and another round of fetches, which set state and rendered again. The
   * sticker preview reads the codes that loop keeps refetching; when one of those
   * calls lost the race the list went empty and the box fell back to "auto".
   *
   * OnHand already guarded itself against this (it wraps the prop in a ref); the fix
   * belongs here, where the instability starts.
   */
  const flash = useCallback((t, text) => {
    setMsg({ t, text });
    if (t === 'g') setTimeout(() => setMsg(null), 4000);
  }, []);

  return (
    <div id="app">
      <div className="pg-ttl">🏬 Stores</div>
      <div className="pg-sub">Stock on hand, goods receipts, and material issued to (and returned from) the shop floor.</div>
      <div className="step-bar" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
        ))}
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      {tab === 'onhand' && <OnHand flash={flash} />}
      {tab === 'sfg' && <Sfg flash={flash} />}
      {/* Stores 5.1: the FG tab IS the FG Entry sheet of the Super Admin login — one
          screen, one ledger, one moving / non-moving report, entered from either. */}
      {/* Issues 6 §15: no costing on the stores desk — quantities only. */}
      {tab === 'fg' && <FgEntryPanel heading={false} costing="none" />}
      {tab === 'pos' && <PurchaseOrders flash={flash} />}
      {tab === 'grn' && <Grn flash={flash} />}
      {tab === 'issues' && <IssuesReturns flash={flash} />}
    </div>
  );
}

/* ───────────────────────── Material on Hand (landing) ───────────────────── */

// `flash` is optional: this board is embedded in logins that have no message bar of
// their own (the plant's Raw Material on Hand, the Padmin's Item Master), and an
// error must never take the screen down for want of somewhere to say it.
//
// It is also held in a REF and wrapped in a stable callback, because `load` depends
// on it and every caller passes an inline lambda — a fresh `flash` on each render
// would rebuild `load`, re-fire its effect, set state, and fetch the whole board
// again, for ever.
export function OnHand({ flash: flashProp, readOnly = false }) {
  const flashRef = useRef(flashProp);
  flashRef.current = flashProp;
  const flash = useCallback((t, text) => {
    if (flashRef.current) flashRef.current(t, text);
    else if (t === 'r') window.alert(text);
  }, []);
  const { role } = useAuth() || {};
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  // Issues 6 §2: items deleted from the Item Master that still hold stock. Off the
  // board, off every picker — listed here so the stock is not lost, and so the Super
  // Admin can move it onto the code that replaced them (360 was a duplicate of 082).
  const [withdrawn, setWithdrawn] = useState([]);
  const [moveTo, setMoveTo] = useState({});   // withdrawn itemId → target itemId
  const [q, setQ] = useState('');
  const [fMat, setFMat] = useState('');
  const [fSub, setFSub] = useState('');
  const [fSpec, setFSpec] = useState('');
  const [fMic, setFMic] = useState('');
  const [fDept, setFDept] = useState('');
  // Issues 3.1: "In the main page filters I need to have a filter for status to get
  // the amount that is in the moving stocks, non-moving stocks, rejected stocks, or
  // QC hold stocks." Status lives on each ROLL, so an item matches when it holds any
  // stock of that disposition — and the figures below then count only that stock.
  const [fStatus, setFStatus] = useState('');
  const [open, setOpen] = useState(null);        // itemId whose units are expanded
  const [units, setUnits] = useState([]);
  const [unitsBusy, setUnitsBusy] = useState(false);
  // The MSL the last three months' consumption implies, shown beside the one in
  // force. Manual entry stays; this is the "going forward" automatic figure.
  const [sugg, setSugg] = useState({});
  const [suggAny, setSuggAny] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Issues 7 §19: "I should be able to search using the internal code as well" — the
  // sticker numbers of every roll, keyed by item, so BLMU-332 finds BLM306.
  const [codesByItem, setCodesByItem] = useState({});
  // Issues 7 §20: the "split" tag opens where the roll came from.
  const [traceOf, setTraceOf] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    // A board is a LIST or it is nothing: anything else here (an error body, a proxy
    // page, an empty 200) used to reach `rows.filter` and take the whole screen down
    // with it — and this board is embedded in the plant and Padmin logins now, so a
    // crash here blanked their tabs too.
    try { const r = await storesApi.onHand(); setRows(Array.isArray(r) ? r : []); }
    catch (e) { setRows([]); flash('r', e.message); }
    finally { setBusy(false); }
    try { const w = await storesApi.withdrawn(); setWithdrawn(Array.isArray(w) ? w : []); } catch { setWithdrawn([]); }
    try {
      const raw = await storesApi.allUnits(false);
      const all = Array.isArray(raw) ? raw : [];
      const m = {};
      all.forEach((u) => { const k = String(u.itemId); (m[k] = m[k] || []).push(String(u.internalCode || '').toLowerCase()); });
      setCodesByItem(m);
    } catch { /* the code search is an extra, never a blocker */ }
  }, [flash]);
  useEffect(() => { load(); }, [load]);

  async function moveStock(w) {
    const to = moveTo[w.id];
    if (!to) { flash('r', `Pick the item code that replaced ${w.code} first.`); return; }
    const target = rows.find((r) => String(r.id) === String(to));
    if (!window.confirm(`Move every roll of ${w.code} (${qty(w.closingStock)} ${w.uom || ''}) onto ${target ? target.code : to}?

The rolls keep their stickers, GRN and history — only the item they belong to changes.`)) return;
    try {
      const r = await storesApi.moveUnits(w.id, Number(to));
      flash('g', `Moved ${r.units} roll(s) of ${r.from} onto ${r.to}.`);
      await load();
    } catch (e) { flash('r', e.message); }
  }

  const loadSuggestions = useCallback(async () => {
    try {
      const list = await storesApi.mslSuggestions(3) || [];
      const m = {};
      list.forEach((r) => { m[r.itemId] = r; });
      setSugg(m);
      setSuggAny(list.some((r) => r.hasHistory));
    } catch { /* the suggestion column is an extra, never a blocker */ }
  }, []);
  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  async function adoptSuggestions() {
    if (!window.confirm('Set every item\'s MSL to its average consumption over the last three months?\n\nItems with no consumption history are left exactly as they are.')) return;
    try {
      const r = await storesApi.applyMslSuggestions(3);
      flash('g', `MSL updated from consumption for ${r.applied} item(s).`);
      await load(); await loadSuggestions();
    } catch (e) { flash('r', e.message); }
  }

  // The five filters the doc asks for, each offering only what the data holds.
  /**
   * Issues 2.4 §14 — the filters narrow each other.
   *
   * Every dropdown used to list every value in the catalogue, so picking FILM +
   * AF BOPP still offered all twenty microns when that combination only comes in
   * 35 and 51. Each list is now built from the rows that pass the OTHER filters,
   * so what is offered is what actually exists. The value already chosen stays in
   * its own list (otherwise the box would appear to clear itself), and microns
   * sort as numbers — 100 does not belong before 12.
   */
  const opts = (key) => {
    const others = { fMat, fSub, fSpec, fMic, fDept };
    others[{ materialType: 'fMat', subGroup: 'fSub', specialtyName: 'fSpec', microns: 'fMic', departmentName: 'fDept' }[key]] = '';
    const pool = rows.filter((r) => (
      (!others.fMat || String(r.materialType || '') === others.fMat)
      && (!others.fSub || String(r.subGroup || '') === others.fSub)
      && (!others.fSpec || String(r.specialtyName || '') === others.fSpec)
      && (!others.fMic || String(r.microns || '') === others.fMic)
      && (!others.fDept || String(r.departmentName || '') === others.fDept)
    ));
    const chosen = { materialType: fMat, subGroup: fSub, specialtyName: fSpec, microns: fMic, departmentName: fDept }[key];
    const set = new Set(pool.map((r) => String(r[key] || '').trim()).filter(Boolean));
    if (chosen) set.add(chosen);
    const list = [...set];
    const numeric = list.every((v) => v !== '' && Number.isFinite(Number(v)));
    return numeric ? list.sort((a, b) => Number(a) - Number(b)) : list.sort((a, b) => a.localeCompare(b));
  };
  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (fMat && String(r.materialType || '') !== fMat) return false;
      if (fSub && String(r.subGroup || '') !== fSub) return false;
      if (fSpec && String(r.specialtyName || '') !== fSpec) return false;
      if (fMic && String(r.microns || '') !== fMic) return false;
      if (fDept && String(r.departmentName || '') !== fDept) return false;
      if (fStatus && !num(((r.byStatus || {})[fStatus] || {}).qty)) return false;
      if (!t) return true;
      if ([r.code, r.name, r.materialType, r.subGroup, r.specialtyName].some((v) => String(v || '').toLowerCase().includes(t))) return true;
      // the internal (sticker) code of any roll of this item — "BLMU-332", "332", "u-33"
      const codes = codesByItem[String(r.id)] || [];
      const tt = t.replace(/[\s-]/g, '');
      return codes.some((c) => c.includes(t) || c.replace(/[\s-]/g, '').includes(tt));
    });
  }, [rows, q, fMat, fSub, fSpec, fMic, fDept, fStatus, codesByItem]);

  // With a disposition chosen the figures answer the question that was asked —
  // "the amount that is in the moving stocks, non-moving stocks, rejected stocks or
  // QC hold" — rather than the whole item's value regardless of disposition.
  const totals = useMemo(() => ({
    items: visible.length,
    below: visible.filter((r) => r.belowMsl).length,
    value: visible.reduce((t, r) => t + (fStatus
      ? num(((r.byStatus || {})[fStatus] || {}).value)
      : num(r.stockValue)), 0),
  }), [visible, fStatus]);

  async function expand(item) {
    if (open === item.id) { setOpen(null); setUnits([]); return; }
    setOpen(item.id); setUnitsBusy(true);
    try { setUnits(await storesApi.units(item.id) || []); }
    catch (e) { flash('r', e.message); setUnits([]); }
    finally { setUnitsBusy(false); }
  }

  async function saveMsl(item, value) {
    const v = String(value).trim();
    if (v === '' || Number(v) < 0) return;
    if (Number(v) === num(item.msl)) return;
    try {
      await storesApi.setMsl(item.id, Number(v));
      setRows((rs) => rs.map((r) => (r.id === item.id ? { ...r, msl: Number(v), belowMsl: Number(v) > 0 && num(r.closingStock) < Number(v) } : r)));
      flash('g', `MSL for ${item.code} set to ${v}.`);
    } catch (e) { flash('r', e.message); }
  }

  async function setUnitStatus(unit, status) {
    try {
      await storesApi.setUnitStatus(unit.id, status);
      setUnits((us) => us.map((u) => (u.id === unit.id ? { ...u, status } : u)));
      flash('g', `${unit.internalCode} → ${statusLabel(status)}.`);
    } catch (e) { flash('r', e.message); }
  }

  /**
   * Stores 5.1: "the Raw Material On Hand page should have an Export to Excel. When
   * I click on that I would want the detailed row-wise entries to be listed in the
   * Excel, with the location and also the status of the material, whether it is
   * moving, non-moving, sample, or rejected." One row per roll / can, for the items
   * the filters currently show, and — with a disposition chosen — only rolls of it.
   */
  async function exportExcel() {
    setExporting(true);
    try {
      const all = (await storesApi.allUnits(false)) || [];
      const ids = new Set(visible.map((r) => String(r.id)));
      const picked = all.filter((u) => ids.has(String(u.itemId)) && (!fStatus || (u.status || 'MOVING') === fStatus));
      if (!picked.length) { flash('y', 'Nothing to export — no rolls or cans match these filters.'); return; }
      const header = ['Item Code', 'Description', 'Material', 'Sub-Group', 'Speciality', 'Microns', 'Department',
        'Internal Code', 'GRN', 'Supplier', 'Supplier Label', 'Location', 'Width (mm)', 'Received', 'Remaining', 'UOM',
        'Price', 'Value', 'Status', 'Expiry', 'Received on'];
      const body = picked.map((u) => [
        u.itemCode || '', u.itemName || '', u.materialType || '', u.subGroup || '', u.specialtyName || '', u.microns || '',
        u.departmentName || '', u.internalCode || '', u.grnNo || '', u.supplier || '', u.supplierCode || '', u.location || '',
        num(u.widthMm) || '', num(u.qtyReceived), num(u.qtyRemaining), u.uom || '', num(u.price) || '',
        Math.round(num(u.qtyRemaining) * num(u.price) * 100) / 100, statusLabel(u.status || 'MOVING'),
        u.expiryDate || '', u.receivedAt ? String(u.receivedAt).slice(0, 10) : '',
      ]);
      exportAOA([header, ...body], `Raw_Material_On_Hand_${today()}.xlsx`, 'Material on hand');
      flash('g', `Exported ${picked.length} roll(s) / can(s) to Excel.`);
    } catch (e) { flash('r', e.message); } finally { setExporting(false); }
  }

  return (
    <div className="card">
      {/* Stores 5.1: "the data items listed below MSL stock value, all of them, to move
          to the top and the filters to be closer to the table" — so the figures come
          first, and the filters with Refresh sit directly above the rows they act on. */}
      <div className="fbar" style={{ flexWrap: 'wrap', marginBottom: 6 }}>
        <div className="ctitle" style={{ margin: 0 }}>Material on hand <span className="tag tgr">{totals.items}</span></div>
      </div>
      <div className="stats" style={{ marginBottom: 6 }}>
        <div className="stat"><div className="sl">Items listed</div><div className="sv">{totals.items}</div></div>
        <div className="stat"><div className="sl">Below MSL</div><div className="sv" style={{ color: totals.below ? 'var(--red)' : undefined }}>{totals.below}</div></div>
        <div className="stat">
          <div className="sl">{fStatus ? `Value — ${statusLabel(fStatus)}` : 'Stock value'}</div>
          <div className="sv">{inr(Math.round(totals.value))}</div>
        </div>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Closing stock is the sum of the rolls / cans actually in the racks — click a row to see them, their location and their status.
        {readOnly ? ' This is the Stores login\u2019s board, read here as it stands; MSL and dispositions are set by Stores.' : ' MSL can be typed per item, or set for every item at once from the average of the last three months\u2019 consumption.'}
      </div>
      {/* BOM calculations 24.09 §18: "In the Raw Material on Hand tab in the PM login
          and in the Stores login, I do not want this warning to be there. Because the
          material was already allocated to the other item code." Neither desk can act
          on it — only the Super Admin can move that stock — so it is now shown where
          it can actually be dealt with, and nowhere else. */}
      {withdrawn.length > 0 && role === 'superadmin' && (
        <div className="al al-y" style={{ marginBottom: 6 }} aria-label="Withdrawn items holding stock">
          <b>{withdrawn.length} item{withdrawn.length === 1 ? '' : 's'} deleted from the Item Master still hold stock.</b>{' '}
          They are no longer offered anywhere in Stores and cannot be issued.
          {' Move each one’s stock onto the item code that replaced it:'}
          <div className="tw" style={{ marginTop: 6 }}><table>
            <thead><tr><th>Item code</th><th>Description</th><th>Material</th><th style={{ textAlign: 'right' }}>Stock</th><th style={{ textAlign: 'right' }}>Rolls</th>
              {role === 'superadmin' && <th style={{ minWidth: 260 }}>Move stock onto</th>}</tr></thead>
            <tbody>
              {withdrawn.map((w) => {
                const same = rows.filter((r) => String(r.materialType || '').trim().toLowerCase() === String(w.materialType || '').trim().toLowerCase()
                  && String(r.subGroup || '').trim().toLowerCase() === String(w.subGroup || '').trim().toLowerCase());
                return (
                  <tr key={w.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--red)' }}>{w.code}</td>
                    <td style={{ fontSize: 11 }}>{w.name}</td>
                    <td style={{ fontSize: 11 }}>{[w.materialType, w.subGroup, w.specialtyName].filter(Boolean).join(' / ') || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{qty(w.closingStock)} {w.uom || ''}</td>
                    <td style={{ textAlign: 'right' }}>{w.unitCount}</td>
                    {role === 'superadmin' && (
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <select value={moveTo[w.id] || ''} onChange={(e) => setMoveTo((m) => ({ ...m, [w.id]: e.target.value }))}
                            aria-label={`Move ${w.code} stock onto`} style={{ flex: 1 }}>
                            <option value="">— same material / sub-group —</option>
                            {same.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
                          </select>
                          <button className="btn btn-s" onClick={() => moveStock(w)} aria-label={`Move ${w.code} stock`}>Move</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

      <div className="fbar" style={{ flexWrap: 'wrap', marginBottom: 6 }}>
        <input placeholder="Search item / code / internal code (BLMU-…)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" style={{ minWidth: 240 }} />
        <select value={fMat} onChange={(e) => setFMat(e.target.value)} aria-label="Filter by material">
          <option value="">All materials</option>{opts('materialType').map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fSub} onChange={(e) => setFSub(e.target.value)} aria-label="Filter by sub-group">
          <option value="">All sub-groups</option>{opts('subGroup').map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fSpec} onChange={(e) => setFSpec(e.target.value)} aria-label="Filter by speciality">
          <option value="">All specialities</option>{opts('specialtyName').map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fMic} onChange={(e) => setFMic(e.target.value)} aria-label="Filter by microns">
          <option value="">All microns</option>{opts('microns').map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fDept} onChange={(e) => setFDept(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>{opts('departmentName').map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All stock</option>
          {UNIT_STATUSES.map((st) => <option key={st.v} value={st.v}>{st.label}</option>)}
        </select>
        {/* Seven filters and three buttons do not fit one line: kept as a group, the
            buttons wrap together instead of one of them being stranded on its own. */}
        <div className="fbar-actions">
          {!readOnly && (
            <button className="btn btn-s" onClick={adoptSuggestions} disabled={!suggAny}
              title={suggAny ? 'Set each MSL to its 3-month average consumption' : 'No consumption history yet — issue material first'}>
              ⚙ Set MSL from 3-month average
            </button>
          )}
          <button className="btn btn-s" onClick={exportExcel} disabled={exporting || busy} aria-label="Export to Excel"
            title="Every roll / can of the items shown, with its location and status">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
          <button className="btn btn-s" onClick={load} disabled={busy}>{busy ? 'Loading…' : '↻ Refresh'}</button>
        </div>
      </div>

      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 380px)' }}>
        <table>
          <thead><tr>
            <th style={{ width: 30 }}></th><th>Item Code</th><th style={{ minWidth: 200 }}>Description</th>
            <th>Material</th><th>Sub-Group</th><th>Speciality</th><th>Microns</th><th>Department</th>
            <th style={{ textAlign: 'right' }}>Closing Stock</th><th style={{ width: 60 }}>UOM</th>
            <th style={{ textAlign: 'right', width: 110 }}>MSL</th>
            <th style={{ textAlign: 'right', width: 110 }}>3-mo avg</th>
            <th style={{ textAlign: 'right' }}>Stock Value</th>
          </tr></thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={13} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>
                {rows.length ? 'No items match these filters' : 'No items yet — the Item Master (P Dashboard) feeds this list'}
              </td></tr>
            ) : visible.map((r) => (
              <Fragment key={r.id}>
                <tr className={r.belowMsl ? 'hi' : undefined} style={{ cursor: 'pointer' }} onClick={() => expand(r)}>
                  <td style={{ textAlign: 'center', color: 'var(--i3)' }}>{open === r.id ? '▼' : '▶'}</td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)' }}>{r.code}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{r.name}</td>
                  <td style={{ fontSize: 11 }}>{r.materialType || '—'}</td>
                  <td style={{ fontSize: 11 }}>{r.subGroup || '—'}</td>
                  <td style={{ fontSize: 11 }}>{r.specialtyName || '—'}</td>
                  <td style={{ fontSize: 11 }}>{r.microns || '—'}</td>
                  <td style={{ fontSize: 11 }}>{r.departmentName || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: r.belowMsl ? 'var(--red)' : 'var(--g)' }}>{qty(r.closingStock)}</td>
                  <td style={{ fontSize: 11 }}>{r.uom || '—'}</td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    {readOnly ? qty(r.msl) : (
                      <input type="number" min="0" step="any" defaultValue={r.msl ?? ''} aria-label={`MSL for ${r.code}`}
                        onBlur={(e) => saveMsl(r, e.target.value)} style={{ width: 90, height: 24, textAlign: 'right' }} />
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 11 }} title="Average monthly consumption over the last three months">
                    {sugg[r.id] && sugg[r.id].hasHistory ? qty(sugg[r.id].suggestedMsl) : <span style={{ color: 'var(--i3)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 11 }}>{r.stockValue ? inr(Math.round(num(r.stockValue))) : '—'}</td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td colSpan={13} style={{ background: 'var(--bg)', padding: '10px 16px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                        Rolls / cans of {r.code} <span className="tag tgr">{units.length}</span>
                        <span className="pg-sub" style={{ display: 'inline', marginLeft: 8 }}>oldest first — issue in this order (FIFO)</span>
                      </div>
                      {unitsBusy ? <div className="pg-sub">Loading…</div> : units.length === 0 ? (
                        <div className="al al-y" style={{ margin: 0 }}>Nothing in stock for this item — it arrives through a GRN.</div>
                      ) : (
                        <div className="tw"><table>
                          <thead><tr>
                            <th>Internal Code</th><th>Supplier</th><th>Supplier Label</th><th>Location</th>
                            <th style={{ textAlign: 'right' }}>Width (mm)</th><th style={{ textAlign: 'right' }}>Remaining</th>
                            <th style={{ textAlign: 'right' }}>Price</th><th>Expiry</th><th>Received</th><th style={{ width: 150 }}>Status</th>
                          </tr></thead>
                          <tbody>
                            {units.map((u) => (
                              <tr key={u.id}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{u.internalCode}
                                  {u.parentUnitId ? (
                                    <button type="button" className="tag tb" style={{ fontSize: 9, marginLeft: 4, cursor: 'pointer', border: 0 }}
                                      title="Cut from another roll — click for the parent roll, the issue line and the return slip"
                                      aria-label={`Where ${u.internalCode} came from`} onClick={() => setTraceOf(u)}>split ↗</button>
                                  ) : null}
                                </td>
                                <td style={{ fontSize: 11 }}>{u.supplier || '—'}</td>
                                <td style={{ fontSize: 11 }}>{u.supplierCode || '—'}</td>
                                <td style={{ fontSize: 11, fontWeight: 600 }}>{u.location || '—'}</td>
                                <td style={{ textAlign: 'right' }}>{u.widthMm ? qty(u.widthMm) : '—'}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }}>{qty(u.qtyRemaining)} {u.uom || ''}</td>
                                <td style={{ textAlign: 'right' }}>{u.price ? inr(Math.round(num(u.price))) : '—'}</td>
                                <td style={{ fontSize: 11 }}>{u.expiryDate || '—'}</td>
                                <td style={{ fontSize: 11 }}>{u.receivedAt ? String(u.receivedAt).slice(0, 10) : '—'}</td>
                                <td>
                                  {readOnly ? <span style={{ fontSize: 11 }}>{statusLabel(u.status || 'MOVING')}</span> : (
                                    <select value={u.status || 'MOVING'} aria-label={`Status of ${u.internalCode}`}
                                      onChange={(e) => setUnitStatus(u, e.target.value)} style={{ height: 26, fontSize: 11 }}>
                                      {UNIT_STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                                    </select>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table></div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {traceOf && <UnitTraceModal unit={traceOf} onClose={() => setTraceOf(null)} flash={flash} />}
    </div>
  );
}

/**
 * Issues 7 §20: what the "split" tag opens — the parent roll the sticker was cut
 * from, the issue line that roll went out on, the return slip that booked this one,
 * and the other rolls cut from the same parent. Both slips download from here.
 */
function UnitTraceModal({ unit, onClose, flash }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    storesApi.unitTrace(unit.id)
      .then((r) => { if (live) setT(r); })
      .catch((e) => { if (live) setErr(e && e.message ? e.message : String(e)); });
    return () => { live = false; };
  }, [unit.id]);
  async function download(no) {
    try { saveIssueSlipPdf(await storesApi.slip(no)); } catch (e) { flash('r', e.message); }
  }
  const when = (iso) => (iso ? String(iso).slice(0, 10) : '—');
  const issue = t && t.issue;
  const parent = t && t.parent;
  const ret = t && (t.returns || []).find((r) => r.returnNo) || (t && (t.returns || [])[0]) || null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 9600, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '32px 12px' }} onClick={onClose}>
      <div style={{ background: 'var(--wh)', borderRadius: 12, maxWidth: 760, width: '100%', padding: '18px 20px', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }} onClick={(e) => e.stopPropagation()} aria-label={`Trace of ${unit.internalCode}`}>
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>🔗 {unit.internalCode} — where this roll came from</div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={onClose}>Close</button>
        </div>
        {err && <div className="al al-r">{err}</div>}
        {!t && !err && <div className="pg-sub">Reading…</div>}
        {t && (
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
            <div className="al al-b" style={{ marginBottom: 8 }}>
              <b>Parent roll:</b> {parent ? <>{parent.internalCode} · {parent.itemCode} {parent.itemName ? `— ${parent.itemName}` : ''}{parent.widthMm ? ` · ${qty(parent.widthMm)} mm` : ''} · received {qty(parent.qtyReceived)} {parent.uom || ''}{parent.supplier ? ` · ${parent.supplier}` : ''}{parent.location ? ` · rack ${parent.location}` : ''}</> : '— (this roll was not cut from another)'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700 }}>Issue line</div>
                {issue ? (
                  <>
                    <div><span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{issue.lineNo || issue.slipNo}</span> · slip {issue.slipNo}</div>
                    <div>{qty(issue.qtyIssued)} {issue.uom || ''} of {issue.internalCode} to <b>{issue.department || '—'}</b>{issue.so ? ` for ${issue.so}` : ''} on {when(issue.ts)}</div>
                    <div>Back so far: {qty(issue.qtyReturned)} {issue.uom || ''} in {issue.rollsReturned} roll(s)</div>
                    <button className="btn btn-s" style={{ marginTop: 4 }} onClick={() => download(issue.slipNo)} aria-label={`Download issue slip ${issue.slipNo}`}>⬇ Issue slip PDF</button>
                  </>
                ) : <div style={{ color: 'var(--i3)' }}>No issue line on record for the parent roll.</div>}
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>Return slip</div>
                {ret ? (
                  <>
                    <div><span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{ret.returnNo || '(no number — returned before slips existed)'}</span></div>
                    <div>{qty(ret.qty)} {unit.uom || ''} received on {when(ret.ts)}{ret.department ? ` from ${ret.department}` : ''}{ret.so ? ` · ${ret.so}` : ''} by {ret.actor || '—'}</div>
                    {ret.returnNo && <button className="btn btn-s" style={{ marginTop: 4 }} onClick={() => download(ret.returnNo)} aria-label={`Download return slip ${ret.returnNo}`}>⬇ Return slip PDF</button>}
                  </>
                ) : <div style={{ color: 'var(--i3)' }}>No return on record.</div>}
              </div>
            </div>
            {(t.siblings || []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 700 }}>Cut from the same roll</div>
                <div className="tw"><table>
                  <thead><tr><th>Roll</th><th>Item</th><th style={{ textAlign: 'right' }}>Width</th><th style={{ textAlign: 'right' }}>Remaining</th><th>Rack</th><th>Status</th></tr></thead>
                  <tbody>
                    {t.siblings.map((sb) => (
                      <tr key={sb.id}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{sb.internalCode}</td>
                        <td style={{ fontSize: 11 }}>{sb.itemCode || sb.itemId}</td>
                        <td style={{ textAlign: 'right' }}>{sb.widthMm ? qty(sb.widthMm) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{qty(sb.qtyRemaining)} {sb.uom || ''}</td>
                        <td style={{ fontSize: 11 }}>{sb.location || '—'}</td>
                        <td style={{ fontSize: 11 }}>{statusLabel(sb.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Purchase Orders + ETA ──────────────────────── */

// Issues 30.09: the tab lives in components/PurchaseOrdersTab.jsx (the PM login reads
// the same list); re-exported here so `import { PurchaseOrders } from './Stores.jsx'`
// keeps working.
export { PurchaseOrders };

/* ─────────────────────────────────── GRN ────────────────────────────────── */

/**
 * One receipt in the Recent-receipts list, opening out into what actually came in on
 * it (Issues 3.0). The list itself only ever carried a unit COUNT; the business asked
 * to see the item code, material type, sub-group, speciality and description behind
 * that number, which means fetching the receipt's own units. The item identity is
 * joined from the Item Master already loaded on this screen, so the row reads the
 * same words the rest of the app uses for that item.
 *
 * Corrections are the Super Admin's (Dashboard -> GRN Entries): repricing a booked
 * receipt moves the stock valuation, so it is not a stores-desk action.
 */
function GrnRow({ g, items, open, onToggle, flash, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  // Issues 3.1: "there should be an edit button which when clicked upon I should be
  // able to edit the GRN entry." The desk that booked the receipt is the one holding
  // the supplier's invoice, so it corrects its own — through the same editor and the
  // same endpoints the Super Admin's GRN Entries screen uses.
  const [editing, setEditing] = useState(false);
  // Correcting a booked receipt moves the stock valuation, so it stays with the Super
  // Admin. The desk opens a receipt and reads all of it; the Edit button only appears
  // for the role the server will actually accept it from.
  const { role } = useAuth() || {};
  const mayEdit = role === 'superadmin';
  useEffect(() => { if (!open) setEditing(false); }, [open]);

  useEffect(() => {
    if (!open || detail) return undefined;
    let live = true;
    setBusy(true);
    // Clear `busy` in the SAME callback that sets the detail, not in a `finally`
    // guarded by `live`: setting the detail changes this effect's own dependency,
    // so React tears the effect down — and a `finally` that checks `live` would
    // then never run, leaving the panel reading "Opening…" for good.
    storesApi.grn(g.id)
      .then((d) => { if (live) { setDetail(d); setBusy(false); } })
      .catch((e) => {
        if (!live) return;
        setBusy(false);
        flash('r', e.message || 'Could not open that receipt');
      });
    return () => { live = false; };
  }, [open, detail, g.id, flash]);

  const byId = new Map((items || []).map((it) => [String(it.id), it]));
  const units = (detail && detail.units) || [];

  return (
    <>
      <tr className={open ? 'hi' : undefined}>
        <td style={{ textAlign: 'center' }}>
          <button className="btn btn-s" style={{ height: 20, fontSize: 10, padding: '0 5px' }}
            aria-label={`${open ? 'Close' : 'Open'} ${g.grnNo}`} onClick={onToggle}>{open ? '▾' : '▸'}</button>
        </td>
        <td>
          <button className="btn btn-s" style={{ height: 22, fontSize: 11, padding: '0 7px', fontFamily: 'monospace', fontWeight: 700 }}
            onClick={onToggle} aria-label={`Open GRN ${g.grnNo}`}>{g.grnNo}</button>
        </td>
        <td style={{ fontSize: 11 }}>{g.grnDate}</td>
        <td style={{ fontSize: 11 }}>{g.poNum || '—'}</td>
        <td style={{ fontSize: 11 }}>{g.supplier || '—'}</td>
        <td style={{ fontSize: 11 }}>{g.invoiceNo || '—'}</td>
        <td style={{ fontSize: 11 }}>{g.invoiceDate || '—'}</td>
        <td style={{ textAlign: 'right' }}>{g.units}</td>
        <td style={{ fontSize: 11, color: 'var(--i3)' }}>{g.actor || '—'}</td>
      </tr>
      {open && (
        <tr><td colSpan={9} style={{ background: 'var(--bg)', padding: '6px 14px 12px' }}>
          {busy ? <div className="pg-sub" style={{ margin: 0 }}>Opening…</div> : editing && detail ? (
            <GrnEditor
              grn={detail} busy={busy} setBusy={setBusy} flash={flash}
              onClose={() => setEditing(false)}
              onSaved={async (fresh) => {
                setDetail(fresh);
                // "the same changes should be reflected in the store's front end as
                // well" — the receipt list and the stock behind it are refetched, so
                // a corrected price is the one the valuation shows.
                if (onChanged) await onChanged();
              }} />
          ) : units.length === 0 ? (
            <div className="al al-y" style={{ margin: 0 }}>
              This receipt has no units on it.
              {mayEdit && (
                <button className="btn btn-s" style={{ marginLeft: 10 }}
                  aria-label={`Edit ${g.grnNo}`} onClick={() => setEditing(true)}>✎ Edit this GRN</button>
              )}
            </div>
          ) : (
            <div className="tw">
              <table>
                <thead><tr>
                  <th>Item Code</th><th style={{ minWidth: 170 }}>Item Description</th><th>Material Type</th>
                  <th>Sub-Group</th><th>Speciality</th><th>Internal Code</th>
                  <th style={{ textAlign: 'right' }}>Qty</th><th>UOM</th><th>Location</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                </tr></thead>
                <tbody>
                  {units.map((u) => {
                    const it = byId.get(String(u.itemId)) || {};
                    return (
                      <tr key={u.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{it.code || '—'}</td>
                        <td style={{ fontSize: 11 }}>{it.name || '—'}</td>
                        <td style={{ fontSize: 11 }}>{it.materialType || '—'}</td>
                        <td style={{ fontSize: 11 }}>{it.subGroup || '—'}</td>
                        <td style={{ fontSize: 11 }}>{it.specialtyName || '—'}</td>
                        <td style={{ fontSize: 11 }}>{u.internalCode}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{qty(u.qtyReceived)}</td>
                        <td style={{ fontSize: 11 }}>{u.uom || it.uom || '—'}</td>
                        <td style={{ fontSize: 11 }}>{u.location || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{u.price != null ? inr(u.price) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="fbar" style={{ marginTop: 6, alignItems: 'baseline' }}>
                <div className="pg-sub" style={{ margin: 0 }}>
                  Supplier <b>{detail.supplier || '—'}</b> · invoice <b>{detail.invoiceNo || '—'}</b>
                  {detail.invoiceDate ? ` dated ${detail.invoiceDate}` : ''} · entered by <b>{detail.actor || '—'}</b>.
                  A booked receipt drives the stock valuation, so correcting one is the Super Admin&rsquo;s:
                  the GRN number and who booked it never change, and a quantity already issued against
                  cannot be rewritten by anyone.
                </div>
                <span style={{ flex: 1 }} />
                {mayEdit ? (
                  <button className="btn btn-s" aria-label={`Edit ${g.grnNo}`}
                    onClick={() => setEditing(true)}>✎ Edit this GRN</button>
                ) : (
                  <span className="pg-sub" style={{ margin: 0, whiteSpace: 'nowrap' }}>
                    To correct this receipt, ask the Super Admin — Dashboard → GRN Entries.
                  </span>
                )}
              </div>
            </div>
          )}
        </td></tr>
      )}
    </>
  );
}

const blankLine = () => ({ itemId: '', qty: '', uom: '', price: '', location: '', supplierCode: '', internalCode: '', widthMm: '', expiryDate: '', status: 'MOVING' });

// §12: the supplier is a property of the GRN, not of each line — one GRN is one
// SKU from one supplier on one despatch.

function Grn({ flash }) {
  const { mods, reloadModule } = useData();
  const [items, setItems] = useState([]);
  const [grns, setGrns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [head, setHead] = useState({ grnNo: '', poNum: '', supplier: '', grnDate: today(), invoiceNo: '', invoiceDate: '', notes: '' });
  const [lines, setLines] = useState([blankLine()]);
  // cascading pickers, exactly like the BOM screen: narrow, then choose
  const [fMat, setFMat] = useState('');
  const [fSub, setFSub] = useState('');
  const [fSpec, setFSpec] = useState('');

  const pos = useMemo(() => (mods.purchase && Array.isArray(mods.purchase.pos) ? mods.purchase.pos : []), [mods.purchase]);
  const asl = useMemo(() => (mods.purchase && Array.isArray(mods.purchase.asl) ? mods.purchase.asl : []), [mods.purchase]);
  const [locations, setLocations] = useState([]);
  const [openGrn, setOpenGrn] = useState(null);   // which receipt is opened out
  // Stores 5.1: "I should be able to view the internal label number that is
  // generated automatically so that I'll be able to write it at the time when I'm
  // making a GRN." The next numbers in the sequence, read from the server; each
  // line without a hand-typed code shows the one it will get.
  const [nextCodes, setNextCodes] = useState([]);

  /**
   * Issues 2.4 §9 — every supplier the business buys from, for the header picker.
   * Typed suppliers produced three spellings of the same company and no report
   * could group them, so this is now a closed list: the approved-supplier list
   * the Purchase Admin keeps, plus anyone already named on a purchase order.
   */
  const allSuppliers = useMemo(() => {
    const names = new Set();
    asl.forEach((r) => { const v = String(r.company || '').trim(); if (v) names.add(v); });
    pos.forEach((p) => { const v = String(p.supplier || '').trim(); if (v) names.add(v); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [asl, pos]);

  /** The item codes this supplier is approved for (§12) — empty = no mapping on file. */
  const itemCodesForSupplier = useMemo(() => {
    const sup = String(head.supplier || '').trim().toLowerCase();
    if (!sup) return null;
    const codes = new Set();
    asl.forEach((r) => {
      if (String(r.company || '').trim().toLowerCase() !== sup) return;
      const c = String(r.itemCode || '').trim().toLowerCase();
      if (c) codes.add(c);
    });
    return codes;
  }, [asl, head.supplier]);

  const load = useCallback(async () => {
    try {
      const [its, gs] = await Promise.all([masterApi.listItems(), storesApi.grns()]);
      setItems(its || []); setGrns(gs || []);
      // §13: put-away racks come from the Super Admin's list, not free text.
      try { setLocations(await storesApi.locations() || []); } catch { /* not provisioned yet — the box stays a text field */ }
      try { setNextCodes(((await storesApi.nextCodes(40)) || {}).codes || []); } catch { setNextCodes([]); }
    } catch (e) { flash('r', e.message); }
  }, [flash]);
  useEffect(() => { load(); }, [load]);

  /** The sticker number line `i` will get: the next unused number after the lines above it. */
  const projectedCode = (i) => {
    let k = 0;
    for (let j = 0; j < i; j++) if (!String(lines[j].internalCode || '').trim()) k++;
    return nextCodes[k] || '';
  };

  const distinct = (arr, f) => [...new Set(arr.map((x) => String(x[f] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const norm = (v) => String(v || '').trim().toLowerCase();

  /**
   * The approved-supplier rows for each item code.
   *
   * The ASL is where the supplier↔item link lives, and each of its rows carries the
   * SUPPLIER's own description of that material — its material type, sub-group and
   * microns. The Item Master carries the same three, and the two do not always
   * agree: BLM106 reads FILM / CC PET on the ASL row that ties it to MR Polymers,
   * but narrowing looked only at the Item Master, so choosing FILM + CC PET matched
   * nothing there. The consequence was two failures at once — the supplier list
   * could not be narrowed (it fell back to all 175) and, once MR Polymers was
   * chosen anyway, the item itself was filtered out of the line's dropdown.
   *
   * So a material matches if EITHER record says so. The Item Master still wins for
   * what is written onto the receipt (Issues 2.6); this is only about what is
   * OFFERED, and offering too little is what stopped the desk working.
   */
  const aslByCode = useMemo(() => {
    const m = new Map();
    asl.forEach((r) => {
      const c = norm(r.itemCode);
      if (!c) return;
      if (!m.has(c)) m.set(c, []);
      m.get(c).push(r);
    });
    return m;
  }, [asl]);

  /** Does this code match the pickers — by the Item Master, or by any ASL row for it? */
  const matchesFilters = useCallback((code, masterRow) => {
    const ok = (row, f, want) => !want || norm(row && row[f]) === norm(want);
    // An ASL row carries the speciality under the ITEM-level key `specialty`; the
    // supplier's own trade speciality is the different, supplier-level `speciality`.
    // Reading only the latter made a speciality filter drop every row that had the
    // item one set — which is how the supplier list stayed at all 175.
    const okSpecialty = (row) => !fSpec || norm(row && row.specialty) === norm(fSpec)
      || norm(row && row.speciality) === norm(fSpec);
    if (masterRow && ok(masterRow, 'materialType', fMat) && ok(masterRow, 'subGroup', fSub)
      && ok(masterRow, 'specialtyName', fSpec)) return true;
    return (aslByCode.get(norm(code)) || []).some((r) => (
      ok(r, 'materialType', fMat) && ok(r, 'subGroup', fSub) && okSpecialty(r)
    ));
  }, [aslByCode, fMat, fSub, fSpec]);

  /** The items matching the material / sub-group / speciality pickers alone. */
  const byFilters = useMemo(
    () => items.filter((it) => matchesFilters(it.code, it)),
    [items, matchesFilters],
  );

  const narrowed = useMemo(() => byFilters.filter((it) => (
    // §12: one GRN covers one supplier, so once that supplier is chosen only the
    // items they are approved for can be received against it.
    !itemCodesForSupplier || !itemCodesForSupplier.size
      || itemCodesForSupplier.has(norm(it.code))
  )), [byFilters, itemCodesForSupplier]);

  /**
   * Codes this supplier is approved for that the Item Master does not have. Receiving
   * needs a real item, so they cannot simply be offered — but they must not vanish
   * silently either, which is exactly how an item "goes missing" from the dropdown.
   */
  const unknownForSupplier = useMemo(() => {
    if (!itemCodesForSupplier || !itemCodesForSupplier.size) return [];
    const known = new Set(items.map((it) => norm(it.code)));
    return [...itemCodesForSupplier].filter((c) => !known.has(c)).sort();
  }, [itemCodesForSupplier, items]);

  /**
   * Issues 2.6 — the supplier list narrows to the material, instead of the other way
   * round. "Under the supplier drop-down I have some 175 suppliers. In order to have a
   * limited supplier list, I will select the item, specialty and sub group first."
   * So: pick material → sub-group → speciality, and the picker offers only the
   * companies the approved-supplier list says supply those items.
   *
   * With nothing picked it stays the full list, and if the ASL has no company against
   * the chosen material it falls back to the full list rather than stranding the desk
   * with an empty box — the receipt still has to be booked.
   */
  const suppliersNarrowed = useMemo(() => {
    if (!fMat && !fSub && !fSpec) return null;
    // Walk the ASL rows, not the Item Master: the row IS the supplier's claim to
    // supply that material, and it carries their own description of it.
    const byId = new Map(items.map((it) => [norm(it.code), it]));
    const names = new Set();
    asl.forEach((r) => {
      const code = norm(r.itemCode);
      if (!code || !matchesFilters(code, byId.get(code))) return;
      const v = String(r.company || '').trim();
      if (v) names.add(v);
    });
    return names.size ? [...names].sort((a, b) => a.localeCompare(b)) : null;
  }, [asl, items, matchesFilters, fMat, fSub, fSpec]);

  const supplierOptions = suppliersNarrowed || allSuppliers;

  const itemById = (id) => items.find((i) => String(i.id) === String(id)) || null;
  /** The suppliers this item is approved from — the ASL mapping the P Dashboard keeps. */
  const suppliersForItem = (id) => {
    const it = itemById(id);
    if (!it) return [];
    const code = String(it.code || '').trim().toLowerCase();
    return [...new Set(asl.filter((r) => String(r.itemCode || '').trim().toLowerCase() === code)
      .map((r) => String(r.company || '').trim()).filter(Boolean))];
  };

  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const rmLine = (i) => setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((_, j) => j !== i)));

  /** "BLM106 — CC PET 12 MIC" — what the picker shows and matches on. */
  const itemLabel = (it) => (it ? `${it.code} — ${it.name}` : '');

  /**
   * Resolve what was typed: the exact label, a bare item CODE, or a name. Anything
   * else is kept as free text so the operator can carry on typing, and the line
   * says so rather than silently holding no item.
   */
  function pickItemByText(i, text) {
    const t = norm(text);
    const hit = narrowed.find((it) => norm(it.code) === t)
      || narrowed.find((it) => norm(itemLabel(it)) === t)
      || narrowed.find((it) => norm(it.name) === t)
      || items.find((it) => norm(it.code) === t);
    if (hit) { pickItem(i, hit.id); return; }
    setLine(i, { itemId: '', uom: '', _search: text });
  }

  /**
   * The price this supplier last charged for this item, from the approved-supplier
   * list the Purchase Admin keeps (Issues 3.1). It is a STARTING POINT, not a rule:
   * the invoice in the storesman's hand wins, so the box stays editable.
   */
  function aslPrice(code) {
    const sup = norm(head.supplier);
    const row = (aslByCode.get(norm(code)) || [])
      .find((r) => !sup || norm(r.company) === sup);
    const v = row && (row.basicPrice ?? row.price);
    return v === undefined || v === null || String(v).trim() === '' ? '' : String(v);
  }

  /**
   * Issues 4.1 — "when I select an item code while making a GRN, I want the material
   * type, subgroup, and specialty to be prefilled automatically."
   *
   * The three boxes above were only ever a way IN — narrow, then choose — so once the
   * storesman went the other way and typed the code off the carton they sat on "Any
   * material" while the line below plainly showed FILM · PEARLISED BOPP. They are the
   * receipt's own description of what arrived, so they follow the item.
   *
   * The Item Master is the authority (Issues 2.6); where it is silent the supplier's
   * own words for that code stand in, preferring the row for THIS supplier. A field
   * neither record fills is cleared rather than left showing the last item's value —
   * a stale speciality reads as a fact about this delivery.
   */
  function fillFiltersFromItem(it) {
    if (!it) return;
    const rows = aslByCode.get(norm(it.code)) || [];
    const row = rows.find((r) => norm(r.company) === norm(head.supplier)) || rows[0] || {};
    const of = (mine, theirs) => String(mine || theirs || '').trim();
    setFMat(of(it.materialType, row.materialType));
    setFSub(of(it.subGroup, row.subGroup));
    setFSpec(of(it.specialtyName, row.speciality));
  }

  function pickItem(i, id) {
    const it = itemById(id);
    // §11: the UOM is the item master's, and is shown read-only — a hand-typed unit
    // on a receipt silently changes what the stock figure means. Issues 3.0: the
    // width comes across the same way, and is no longer a field on the line at all.
    // Issues 3.1: the item's own material identity reads back beside it, and the
    // price starts at what this supplier last charged.
    setLine(i, {
      itemId: id,
      uom: (it && it.uom) || '',
      _search: '',
      price: aslPrice(it && it.code) || '',
    });
    fillFiltersFromItem(it);
  }

  // The PO the stores person must physically check before receiving.
  const chosenPo = useMemo(() => pos.find((p) => String(p.poNum || '').trim().toLowerCase() === String(head.poNum || '').trim().toLowerCase()) || null, [pos, head.poNum]);

  /**
   * Issues 30.09 §PU2/§S7b — the PO this receipt is booked against is PICKED, never
   * typed. A typed number was optional free text, so it was usually blank or spelt
   * differently from the PO — and then the purchase login could not find the GRN to
   * link, nor could the PO close itself when its quantity had all come in. Only POs
   * still expected are offered (a closed or cancelled one takes no more receipts); once
   * the supplier is chosen, only that supplier's.
   */
  const poOptions = useMemo(() => {
    const sup = String(head.supplier || '').trim().toLowerCase();
    return pos.filter((p) => isOpenPo(p) && (!sup || String(p.supplier || '').trim().toLowerCase() === sup))
      .sort((a, b) => String(b.poDate || '').localeCompare(String(a.poDate || '')));
  }, [pos, head.supplier]);

  /** Picking a PO names its supplier too — and a different supplier means different lines. */
  function pickPo(poNum) {
    const po = pos.find((p) => p.poNum === poNum) || null;
    const sup = po && String(po.supplier || '').trim();
    if (sup && sup !== head.supplier) {
      setHead({ ...head, poNum, supplier: sup });
      setLines([blankLine()]);
    } else {
      setHead({ ...head, poNum });
    }
  }

  async function submit() {
    if (!String(head.supplier || '').trim()) { flash('r', 'Choose the supplier this material came from.'); return; }
    const usable = lines.filter((l) => l.itemId && num(l.qty) > 0);
    if (!usable.length) { flash('r', 'Add at least one line with an item and a quantity.'); return; }
    setBusy(true);
    try {
      const r = await storesApi.createGrn({
        ...head,
        lines: usable.map((l) => ({
          itemId: Number(l.itemId), qty: Number(l.qty), uom: l.uom || undefined,
          price: l.price === '' ? undefined : Number(l.price),
          location: l.location || undefined, supplierCode: l.supplierCode || undefined,
          // §12: one supplier for the whole receipt.
          supplier: head.supplier || undefined,
          internalCode: l.internalCode || undefined,
          // Issues 3.0: the width is the item's, not something typed per receipt.
          // Issues 4.1: and it is stamped onto the roll as it is received, so the job
          // allocation and the parent/child split rule have a number to work from.
          widthMm: itemWidthMm(itemById(l.itemId)) ?? undefined,
          expiryDate: l.expiryDate || undefined, status: l.status || 'MOVING',
        })),
      });
      const codes = (r.units || []).map((u) => u.internalCode).join(', ');
      // §S7b: the server moves the PO's received quantity with every GRN booked against
      // it, and closes the PO once everything ordered has come in — so the purchase
      // copy on this screen is re-read, and the desk is told when this receipt closed it.
      const poNum = r.poNum || head.poNum;
      const closedNote = r.poStatus === 'Closed' && poNum ? ` ${poNum} is now fully received and closed.` : '';
      flash('g', `✓ ${r.grnNo} received — print stickers for ${codes}.${closedNote}`);
      setHead({ grnNo: '', poNum: '', supplier: '', grnDate: today(), invoiceNo: '', invoiceDate: '', notes: '' });
      setLines([blankLine()]);
      if (reloadModule) {
        try { await reloadModule('purchase'); } catch { /* the receipt is booked; the PO list catches up on the next visit */ }
      }
      await load();
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">📥 New goods receipt</div>
        <div className="al al-y">
          Check the purchase order physically first — price, item description and quantity — then receive.
          Only items already in the Item Master can be received; if something new arrived on the floor, ask the
          <strong> Purchase Admin</strong> to add it to the Item Master first. If the item came from a supplier it is not
          mapped to, <strong>call the Super Admin to get the association done</strong>.
        </div>
        {/* Issues 2.6 — the material comes FIRST. Narrowing by material type, sub-group
            and speciality cuts the 175-name supplier list down to the companies that
            actually supply it, and cuts the item list down at the same time. */}
        <div className="ctitle" style={{ fontSize: 11, margin: '10px 0 2px' }}>① The paperwork</div>
        <div className="g4">
          <div className="fg"><label>GRN No.</label><input value={head.grnNo} placeholder="auto" onChange={(e) => setHead({ ...head, grnNo: e.target.value })} aria-label="GRN number" /></div>
          {/* Issues 30.09 §PU2: picked from the POs Purchase raised, never typed — the
              purchase login links its GRN by this, and the PO closes itself by it. A
              receipt with no PO behind it (a direct purchase) is still allowed. */}
          <div className="fg"><label>PO Number <span style={{ fontWeight: 400, color: 'var(--i3)' }}>(optional)</span></label>
            <select value={head.poNum} onChange={(e) => pickPo(e.target.value)} aria-label="Purchase order">
              <option value="">— no PO (direct purchase) —</option>
              {poOptions.map((p) => (
                <option key={p.poNum} value={p.poNum}>
                  {p.poNum}{head.supplier ? '' : ` · ${p.supplier || '—'}`}{poStatus(p) === 'Partial' ? ' (part received)' : ''}
                </option>
              ))}
              {head.poNum && !poOptions.some((p) => p.poNum === head.poNum) && <option value={head.poNum}>{head.poNum}</option>}
            </select>
            <div className="pg-sub" style={{ margin: '3px 0 0' }}>
              {poOptions.length
                ? `${poOptions.length} open PO${poOptions.length === 1 ? '' : 's'}${head.supplier ? ` for ${head.supplier}` : ''}.`
                : head.supplier ? `No open PO for ${head.supplier} — book it as a direct purchase.` : 'No open purchase orders.'}
            </div>
          </div>
          <div className="fg"><label>GRN Date</label><input type="date" value={head.grnDate} onChange={(e) => setHead({ ...head, grnDate: e.target.value })} aria-label="GRN date" /></div>
          <div className="fg"><label>Invoice Date</label><input type="date" value={head.invoiceDate} onChange={(e) => setHead({ ...head, invoiceDate: e.target.value })} aria-label="Invoice date" /></div>
          <div className="fg"><label>Invoice No.</label><input value={head.invoiceNo} onChange={(e) => setHead({ ...head, invoiceNo: e.target.value })} aria-label="Invoice number" /></div>
        </div>

        <div className="ctitle" style={{ fontSize: 11, margin: '4px 0 2px' }}>② What arrived</div>
        <div className="g4">
          <div className="fg"><label>Material Type</label>
            <select value={fMat} onChange={(e) => { setFMat(e.target.value); setFSub(''); setFSpec(''); }} aria-label="Material type filter">
              {/* Offered from BOTH records: a sub-group that only the ASL records —
                  CC PET against MR Polymers — would otherwise not even be listed. */}
              <option value="">Any material</option>{distinct([...items, ...asl], 'materialType').map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="fg"><label>Sub Group</label>
            <select value={fSub} onChange={(e) => setFSub(e.target.value)} aria-label="Sub group filter">
              <option value="">Any sub-group</option>{distinct([...items, ...asl].filter((i) => !fMat || norm(i.materialType) === norm(fMat)), 'subGroup').map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          {/* §14: the same intelligent narrowing as the stock filters — speciality
              lists only what the chosen material and sub-group actually come in. */}
          <div className="fg"><label>Speciality</label>
            <select value={fSpec} onChange={(e) => setFSpec(e.target.value)} aria-label="Speciality filter">
              <option value="">Any speciality</option>
              {[...new Set([
                ...distinct(items.filter((i) => (!fMat || norm(i.materialType) === norm(fMat)) && (!fSub || norm(i.subGroup) === norm(fSub))), 'specialtyName'),
                ...distinct(asl.filter((i) => (!fMat || norm(i.materialType) === norm(fMat)) && (!fSub || norm(i.subGroup) === norm(fSub))), 'speciality'),
              ])].sort((a, b) => a.localeCompare(b)).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          {/* §9: chosen, never typed — and it decides which items this GRN can receive. */}
          <div className="fg"><label>Supplier *</label>
            <select value={head.supplier} aria-label="Supplier"
              onChange={(e) => {
                // A PO belongs to one supplier — naming another one drops it (§PU2).
                const keepPo = !chosenPo || String(chosenPo.supplier || '').trim().toLowerCase() === e.target.value.trim().toLowerCase();
                setHead({ ...head, supplier: e.target.value, poNum: keepPo ? head.poNum : '' });
                setLines([blankLine()]);
              }}>
              <option value="">{supplierOptions.length ? '— select a supplier —' : '— no suppliers on file —'}</option>
              {supplierOptions.map((sup) => <option key={sup} value={sup}>{sup}</option>)}
              {/* a supplier already on this GRN but no longer on the approved list still reads correctly */}
              {head.supplier && !supplierOptions.includes(head.supplier) && <option value={head.supplier}>{head.supplier}</option>}
            </select>
            <div className="pg-sub" style={{ margin: '3px 0 0' }}>
              {!allSuppliers.length
                ? 'The approved-supplier list is empty — the Purchase Admin adds suppliers on the P Dashboard.'
                : suppliersNarrowed
                  ? `${suppliersNarrowed.length} of ${allSuppliers.length} suppliers ${suppliersNarrowed.length === 1 ? 'supplies' : 'supply'} this material.`
                  : (fMat || fSub || fSpec)
                    ? `No approved supplier on file for this material — showing all ${allSuppliers.length}.`
                    : `All ${allSuppliers.length} suppliers — narrow the material above to shorten this list.`}
            </div>
            {/* An approved item that is not in the Item Master cannot be received, but
                it must not just be absent from the list either — that is exactly what
                "the item is not showing" looks like from the desk. Name it. */}
            {unknownForSupplier.length > 0 && (
              <div className="pg-sub" style={{ margin: '3px 0 0', color: '#B7770D' }}>
                {head.supplier} is approved for {unknownForSupplier.length} item code(s) that are not in the Item
                Master, so they cannot be received: <b>{unknownForSupplier.join(', ').toUpperCase()}</b>. Ask the
                Purchase Admin to add them.
              </div>
            )}
          </div>
        </div>

        {chosenPo && (
          <div className="al al-b" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span><strong>Verify against {chosenPo.poNum}:</strong></span>
            {/* §S7b: what is still to come on each line, not only what was ordered. */}
            {(chosenPo.items || []).map((it, i) => {
              const bal = Math.max(0, num(it.qty) - num(it.receivedQty));
              return (
                <span key={i}>
                  {it.itemCode ? `${it.itemCode} · ` : ''}{it.item} — {qty(it.qty)} {it.unit || ''} @ ₹{num(it.rate).toFixed(2)}
                  {num(it.receivedQty) > 0 && <> · received {qty(it.receivedQty)}, <b>{bal > 0 ? `${qty(bal)} to come` : 'all in'}</b></>}
                </span>
              );
            })}
          </div>
        )}

        {/* Issues 2.7: `table{width:100%}` made the browser squeeze ten columns into the
            card, so the Qty and Price boxes came out ~27px wide however wide their
            column was declared. A natural minimum width lets them keep their size; the
            wrapper already scrolls horizontally (.tw), so the page does not grow. */}
        {/* Issues 2.7: `table{width:100%}` with AUTO layout made the browser squeeze ten
            columns into the card and treat every declared width as a hint, so the Qty
            and Price boxes came out ~27px wide however wide their column was declared —
            the long item names in column one won the argument. `table-layout:fixed`
            makes the declared widths authoritative, and the natural minimum keeps them
            from being scaled down; the wrapper already scrolls (.tw), so the page itself
            does not grow. */}
        {/* Stores 5.1: "Let us reduce the width of the [quantity and price] fields a
            little bit so that, for selecting the location, I need not have a
            horizontal scroll. The item code width also can go down as the item code
            is a maximum of 7 letters." The row now fits a normal desk screen. */}
        <div className="tw"><table style={{ minWidth: 1195, tableLayout: 'fixed' }}>
          <thead><tr>
            {/* Issues 3.1: "let us not club the item code and item description into
                one" — the code is picked, the description and the item's material
                identity read back from the Item Master beside it. */}
            <th style={{ width: 112 }}>Item Code *</th><th style={{ width: 170 }}>Description</th>
            <th style={{ width: 140 }}>Material / Sub-Group</th><th style={{ width: 115 }}>Supplier Label Code</th>
            <th style={{ width: 125 }}>Internal Code</th>
            {/* Issues 2.7: the stepper arrows are gone (.nospin), so a 90 px box still
                shows a five-figure quantity or a four-figure price comfortably. */}
            {/* Issues 3.0: Width is gone — it is fixed on the item in the Item Master,
                so typing it per receipt could only ever disagree with it. */}
            <th style={{ width: 100 }}>Qty *</th><th style={{ width: 55 }}>UOM</th>
            <th style={{ width: 100 }}>Price</th><th style={{ width: 125 }}>Location</th>
            <th style={{ width: 120 }}>Expiry</th><th style={{ width: 36 }}></th>
          </tr></thead>
          <tbody>
            {lines.map((l, i) => {
              // §12: warn when the chosen item is not on the approved list for THIS
              // supplier — the receipt is still allowed, the association just needs doing.
              const sups = suppliersForItem(l.itemId).map((x) => x.toLowerCase());
              const unmapped = !!l.itemId && !!head.supplier && !sups.includes(String(head.supplier).toLowerCase());
              return (
                <tr key={i}>
                  <td>
                    {/* Issues 3.0: "I should be able to type and select the item number
                        also." A dropdown of hundreds is unusable when the desk already
                        knows the code off the carton, so this matches on the CODE as
                        readily as on the name — type either, or pick from the list. */}
                    <input list={`grn-items-${i}`} disabled={!head.supplier} style={{ width: '100%' }}
                      aria-label={`Item for line ${i + 1}`}
                      placeholder={head.supplier ? 'type the item code…' : 'choose a supplier first'}
                      value={l.itemId ? (itemById(l.itemId) || {}).code || '' : (l._search || '')}
                      onChange={(e) => pickItemByText(i, e.target.value)} />
                    <datalist id={`grn-items-${i}`}>
                      {narrowed.map((it) => <option key={it.id} value={it.code}>{it.name}</option>)}
                    </datalist>
                    {!l.itemId && l._search ? (
                      <div style={{ fontSize: 9.5, color: 'var(--red)', marginTop: 2 }}>
                        no item with that code or name — pick one from the list
                      </div>
                    ) : null}
                    {unmapped && (
                      <div style={{ fontSize: 9.5, color: '#B7770D', marginTop: 2 }}>
                        Not mapped to {head.supplier} — call the Super Admin to get the association done.
                      </div>
                    )}
                  </td>
                  <td>
                    {/* Stores 5.1: "the stores person need not know the item code so I
                        want a dropdown of material, subgroup, and specialty also while
                        making a GRN … there are around 500 item codes". The three
                        pickers above narrow the list; this picks the item by its
                        DESCRIPTION from what is left, and the code fills itself in.
                        Typing the code in the box beside it still works the other way. */}
                    <select value={l.itemId || ''} disabled={!head.supplier} style={{ width: '100%' }}
                      aria-label={`Item description line ${i + 1}`}
                      onChange={(e) => { if (e.target.value) pickItem(i, e.target.value); else setLine(i, { itemId: '', uom: '', _search: '' }); }}>
                      <option value="">{!head.supplier ? 'choose a supplier first'
                        : narrowed.length ? '— pick by description —' : '— nothing matches the pickers above —'}</option>
                      {/* Issues 6 §1: the description alone — the code is already picked beside it,
                          and repeating it here only made the list harder to read. */}
                      {narrowed.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                      {l.itemId && !narrowed.some((it) => String(it.id) === String(l.itemId)) && (
                        <option value={l.itemId}>{(itemById(l.itemId) || {}).name}</option>
                      )}
                    </select>
                  </td>
                  <td><input
                    value={[(itemById(l.itemId) || {}).materialType, (itemById(l.itemId) || {}).subGroup,
                      (itemById(l.itemId) || {}).specialtyName].filter(Boolean).join(' · ')}
                    readOnly tabIndex={-1} aria-label={`Item identity line ${i + 1}`} placeholder="—"
                    title="Material type · sub-group · speciality, from the Item Master"
                    style={{ background: 'var(--bg)', color: 'var(--i3)', cursor: 'not-allowed' }} /></td>
                  <td><input value={l.supplierCode} onChange={(e) => setLine(i, { supplierCode: e.target.value })} aria-label={`Supplier code line ${i + 1}`} /></td>
                  <td>
                    {/* Stores 5.1: the sticker number this roll will get, shown before the
                        receipt is booked so it can be written on the roll now. Typing a
                        code of your own overrides it. It is fixed when Receive is pressed —
                        the confirmation repeats the numbers actually booked. */}
                    <input value={l.internalCode} placeholder={projectedCode(i) || 'auto'}
                      onChange={(e) => setLine(i, { internalCode: e.target.value })} aria-label={`Internal code line ${i + 1}`}
                      title={projectedCode(i) ? `Will be ${projectedCode(i)} unless you type another code` : 'Assigned on receive'} />
                    {!String(l.internalCode || '').trim() && projectedCode(i) && (
                      <div style={{ fontSize: 10, marginTop: 2, fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)' }}
                        aria-label={`Sticker for line ${i + 1}`} title="Write this on the roll — fixed when you press Receive">
                        🏷 {projectedCode(i)}
                      </div>
                    )}
                  </td>
                  <td><input type="number" step="any" min="0" className="nospin" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label={`Quantity line ${i + 1}`} /></td>
                  <td><input value={l.uom} readOnly tabIndex={-1} aria-label={`UOM line ${i + 1}`}
                    title="Taken from the Item Master — change it there, not on the receipt"
                    style={{ background: 'var(--bg)', color: 'var(--i3)', cursor: 'not-allowed' }} /></td>
                  <td><input type="number" step="any" min="0" className="nospin" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} aria-label={`Price line ${i + 1}`} /></td>
                  <td>
                    {locations.length ? (
                      <select value={l.location} onChange={(e) => setLine(i, { location: e.target.value })}
                        aria-label={`Location line ${i + 1}`} style={{ width: '100%' }}>
                        <option value="">— rack —</option>
                        {locations.map((loc) => <option key={loc.id} value={loc.name}>{loc.name}</option>)}
                        {l.location && !locations.some((loc) => loc.name === l.location) && <option value={l.location}>{l.location}</option>}
                      </select>
                    ) : (
                      // No list on file yet: keep the box usable rather than blocking a receipt.
                      <input value={l.location} onChange={(e) => setLine(i, { location: e.target.value })}
                        aria-label={`Location line ${i + 1}`} placeholder="rack / bay" />
                    )}
                  </td>
                  <td><input type="date" value={l.expiryDate} onChange={(e) => setLine(i, { expiryDate: e.target.value })} aria-label={`Expiry line ${i + 1}`} /></td>
                  <td><button className="btn btn-r" style={{ height: 24, fontSize: 11, padding: '0 6px' }} onClick={() => rmLine(i)} title="Remove line">✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <div className="act">
          <button className="btn btn-s" onClick={addLine}>＋ Add line</button>
          <button className="btn btn-g" onClick={submit} disabled={busy}>{busy ? 'Receiving…' : '📥 Receive material'}</button>
        </div>
        <div className="pg-sub">
          Each line becomes one physical unit with its own internal code — that code is what goes on the sticker. The number shown
          under Internal Code is the one the roll will get; it is fixed the moment you press Receive.
        </div>
      </div>

      <div className="card">
        <div className="ctitle">Recent receipts <span className="tag tgr">{grns.length}</span></div>
        <div className="pg-sub" style={{ marginTop: 0 }}>Click a GRN number to see what came in on it.</div>
        <div className="tw sy" style={{ maxHeight: 320 }}>
          <table>
            <thead><tr>
              <th style={{ width: 34 }}></th><th>GRN</th><th>Date</th><th>PO</th><th>Supplier</th>
              <th>Invoice</th><th>Invoice Date</th><th style={{ textAlign: 'right' }}>Units</th><th>Entered by</th>
            </tr></thead>
            <tbody>
              {grns.length === 0 ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No receipts yet</td></tr>
                : grns.map((g) => (
                  <GrnRow key={g.id} g={g} items={items} open={openGrn === g.id}
                    onToggle={() => setOpenGrn(openGrn === g.id ? null : g.id)} flash={flash}
                    onChanged={load} />
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ───────────────────────────── Issues & Returns ─────────────────────────── */

// One line of a roll that came back slit: N rolls, each `widthMm` wide and `weightKg`
// heavy. Rolls is a COUNT (two 445 mm rolls is one line, not two), which is what makes
// "these add up to more than the roll they came off" a question with an answer.
// Stores 5.1: `itemId` is the item code for that width — a 600 mm roll cut from a
// 1200 mm one is booked under the 600 mm code, picked from the same family.
const blankChild = () => ({ rolls: '1', widthMm: '', weightKg: '', internalCode: '', location: '', itemId: '' });

/**
 * Which sale orders the Issues & Returns desk may book against (Stores 5.1).
 *
 *   'open'    — every open sale order on the OAB, with today's planned ones marked
 *               and listed first. "Until the sale orders are given by the planning
 *               department, let us give a selection of all the open sale orders."
 *   'planned' — only what PPC has planned. "Once that functionality comes into
 *               place … we will restrict the dropdown options to the sale orders
 *               that are planned." Flip this one constant when the business says so.
 */
export const SO_SOURCE = 'open';

/**
 * Issues as on 30.09 (S3): "for a particular SO, based on the BOM quantities only, the
 * allocation should happen. The stores guy should know that according to the BOM for
 * that SO (say the requirement is 300 kg) he is allowed to assign only 300 kg."
 *
 * Each item of the order's BOM: what the order needs (on its PO quantity), what is
 * allocated to it, what has been issued to it net of returns, and what is still open.
 * While allocated + issued is short of the need one more roll may go — even past it;
 * once it reaches the need the line is complete and takes nothing more. The figures
 * are the server's (GET /api/stores/so-material); the slip being built is added here.
 */
function SoBomPosition({ so, lines, issues, department, slipAddsOf }) {
  const rt = { textAlign: 'right' };
  const grey = { fontSize: 10, color: 'var(--i3)' };
  const dept = String(department || '').trim().toLowerCase();
  const inDept = (l) => (l.departments || []).some((d) => String(d || '').trim().toLowerCase() === dept);
  // with a department chosen, its own lines (and anything off the BOM) — the rest are another slip's
  const shown = dept && lines.some(inDept) ? lines.filter((l) => inDept(l) || l.onBom === false) : lines;
  const issuedOf = (l) => (issues || []).filter((x) => netOut(x) > 0 && (x.itemId != null && l.itemId != null
    ? String(x.itemId) === String(l.itemId) : codeKey(x.itemCode) === codeKey(l.itemCode)));
  return (
    <div style={{ margin: '4px 0 8px' }}>
      <div className="ctitle" style={{ fontSize: 11, margin: '6px 0 2px' }}>
        BOM of {so} — what this order needs
        <span style={{ fontWeight: 400, color: 'var(--i3)', textTransform: 'none', letterSpacing: 0 }}>
          {shown.length < lines.length ? ` · the lines for ${department}` : ''} · on the order quantity; a line is complete once
          what is allocated and issued reaches what it needs
        </span>
      </div>
      <div className="tw"><table aria-label={`BOM position for ${so}`}>
        <thead><tr>
          <th>Item code</th><th>Description</th><th>Dept</th><th style={rt}>Needs</th><th style={rt}>Allocated</th>
          <th style={rt}>Issued</th><th style={rt}>Still open</th><th>Status</th>
        </tr></thead>
        <tbody>
          {shown.map((l) => {
            const pending = slipAddsOf(l.itemId);
            const open = openOf(l, pending);
            const out = issuedOf(l);
            const kind = [l.materialType, l.subGroup, l.specialtyName].filter(Boolean).join(' / ');
            return (
              <tr key={l.itemId ?? l.itemCode}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{l.itemCode}</td>
                <td style={{ fontSize: 11, whiteSpace: 'normal' }}>
                  {l.itemName || '—'}
                  {kind ? <div style={grey}>{kind}</div> : null}
                  {out.length > 0 && (
                    <div style={{ fontSize: 10, color: '#1e7e34' }}>
                      issued: {out.map((x) => `${x.internalCode}${x.lineNo ? ` (${x.lineNo})` : ''}`).join(', ')}
                    </div>
                  )}
                </td>
                <td style={{ fontSize: 11 }}>
                  {l.onBom === false ? <span className="tag ty" style={{ fontSize: 9 }}>not on the BOM</span> : (l.departments || []).join(' / ') || '—'}
                </td>
                <td style={{ ...rt, fontWeight: 700 }}>{l.required != null ? `${qty(l.required)} ${l.uom || ''}` : '—'}</td>
                <td style={rt}>{num(l.allocated) ? qty(l.allocated) : '—'}</td>
                <td style={rt}>
                  {num(l.netIssued) ? qty(l.netIssued) : '—'}
                  {num(l.returned) > 0 ? <div style={grey}>{qty(l.returned)} came back</div> : null}
                </td>
                <td style={{ ...rt, fontWeight: 700, color: open > 0 ? '#B7770D' : undefined }}>{open == null ? '—' : qty(open)}</td>
                <td style={{ fontSize: 11 }}>
                  {isComplete(l, pending)
                    ? <span className="tag" style={{ fontSize: 9, background: '#e6f4ea', color: '#1e7e34' }}>✓ complete</span>
                    : hasCap(l)
                      ? <span className="tag ty" style={{ fontSize: 9 }}>open</span>
                      : <span className="tag tgr" style={{ fontSize: 9 }} title="The BOM gives no quantity to measure it against">not capped</span>}
                  {pending > 0 ? <span style={grey}> · {qty(pending)} on this slip</span> : null}
                  {hasCap(l) && coveredOf(l) > num(l.required) + 1e-9 ? <span style={grey}> · {qty(coveredOf(l) - num(l.required))} over</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}

function IssuesReturns({ flash }) {
  const { mods } = useData();
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('');
  const [units, setUnits] = useState([]);
  const [txns, setTxns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ unitId: '', qty: '', so: '', department: '', note: '' });
  const [mode, setMode] = useState('issue');   // 'issue' | 'return'
  const [split, setSplit] = useState(false);
  // Issues 4.1 — a returned roll row is "N rolls, each W mm wide and K kg", which is
  // how the desk says it out loud, and is what makes the two caps below checkable.
  const [children, setChildren] = useState([blankChild()]);
  // Issues 3.1: department, sale order, split width and location are all pickers
  // here. Typed free-hand they drifted — "Printing", "printing", "PRINTING" —
  // and nothing that groups issues by department could add them up.
  const [departments, setDepartments] = useState([]);
  const [locations, setLocations] = useState([]);
  const [plannedSos, setPlannedSos] = useState(null);   // null = the plan is unreadable here
  const [masterItems, setMasterItems] = useState([]);
  // Stores 5.1: material → sub-group → speciality ahead of the item code, because
  // "it is not practically possible for the stores person … to remember all the
  // item codes" — the same road in as the GRN's.
  const [fMat, setFMat] = useState('');
  const [fSub, setFSub] = useState('');
  const [fSpec, setFSpec] = useState('');
  // Issues 6 §3/§7/§8: the sale order's route AND its BOM, read through its JSS
  // (GET /api/stores/so-context). The old screen asked the planning row alone, which
  // is empty until the Plant marks the order ready — so 26/747 read "no route on
  // file" with a route sitting on its JSS the whole time.
  const [ctx, setCtx] = useState(null);       // { so, found, spec, route:{departments}, bom:{items}, message }
  const [ctxBusy, setCtxBusy] = useState(false);
  // Issues 6 §13: several rolls go out to one department for one sale order on ONE
  // numbered slip, and the slip prints itself when Issue is pressed.
  const [basket, setBasket] = useState([]);   // [{ unitId, internalCode, itemId, itemCode, itemName, uom, widthMm, location, qty, max }]
  const [lastSlip, setLastSlip] = useState(null);
  // Stores 5.1: "I would want the internal code to be shown so that I'll be able to
  // write it on the roll" — the numbers the returned rolls will get.
  const [nextCodes, setNextCodes] = useState([]);
  // Issues 7 §7-§18: a return is booked against the ROLL-WISE issue line the roll went
  // out on (ISS/2026/3.1), picked by slip and then by line; every returned roll gets
  // its own return slip (RET/2026/3.1/1), and more rolls can come back against the
  // same line later.
  const [issueLines, setIssueLines] = useState([]);
  const [issueSlipPick, setIssueSlipPick] = useState('');
  const [issueLinePick, setIssueLinePick] = useState('');
  const [lastReturn, setLastReturn] = useState(null);

  const loadIssueLines = useCallback(async () => {
    try { setIssueLines((await storesApi.issueLines({ open: 1, limit: 300 })) || []); } catch { setIssueLines([]); }
  }, []);

  /**
   * Some More Issues 24.09 ¶4: "There should be a way in which, from the Stores
   * Login, they should be able to close the issue line items. Because in the create a
   * return the dropdown options for issue slips are very huge because there is no way
   * that I can close an issue slip." Material that went into the job is never coming
   * back, so its line is closed off and leaves this picker. Nothing about the stock
   * moves — the issue already happened.
   */
  async function closeIssueLine(line) {
    if (!line) return;
    const out = num(line.qtyIssued) - num(line.qtyReturned);
    if (!window.confirm(`Close ${line.lineNo || line.slipNo}?\n\n`
      + `${qty(out)} ${line.uom || ''} of ${line.itemCode} is still shown as out on it. Closing says that material was `
      + `consumed and none of it is coming back, and takes the line off this list. Stock is not changed.`)) return;
    try {
      await storesApi.closeIssueLine(line.txnId, true);
      if (String(issueLinePick) === String(line.txnId)) { setIssueLinePick(''); }
      await loadIssueLines(); await loadTxns();
      flash('g', `${line.lineNo || line.slipNo} closed — it is off the return list.`);
    } catch (e) { flash('r', e.message); }
  }

  /**
   * Issues 30.09 S4 (reported before, "not fixed yet"): "a 'Close to Return' button at
   * the top and CHECKBOXES against each issue line item. Multiple can be selected and
   * marked 'Close to Return'. These issue slips will not be visible in the returns
   * dropdown." The lines ticked in Recent issues & returns are closed in one call, and
   * the open-line list is re-read straight away — whatever mode the desk is in — so the
   * returns dropdown never offers a line that was just closed.
   *
   * Resolves to the ledger ids that were closed (null when nothing was), which the
   * history uses to tag those rows.
   */
  async function closeToReturn(rows) {
    const lines = (rows || []).filter((r) => r && r.kind === 'ISSUE');
    if (!lines.length) return null;
    const names = lines.map((r) => r.lineNo || r.slipNo || '#' + r.id);
    if (!window.confirm(`Close ${lines.length} issue line(s) to return?\n\n`
      + names.slice(0, 15).join(', ') + (names.length > 15 ? ` and ${names.length - 15} more` : '') + '\n\n'
      + 'Closing says the material on them was consumed and none of it is coming back: they will no longer be offered '
      + 'in the returns dropdown. Stock is not changed.')) return null;
    const ids = lines.map((r) => Number(r.id));
    try {
      const r = await closeLinesOnServer(ids);
      const skipped = Array.isArray(r && r.skipped) ? r.skipped : [];
      const skippedIds = new Set(skipped.map((x) => String(x.txnId)));
      const done = ids.filter((id) => !skippedIds.has(String(id)));
      if (done.some((id) => String(id) === String(issueLinePick))) setIssueLinePick('');
      await loadTxns(); await loadIssueLines();
      const why = skipped.map((x) => `${x.lineNo || names[ids.indexOf(Number(x.txnId))] || '#' + x.txnId} (${x.reason || 'not closed'})`).join('; ');
      const n = r && r.closed != null ? num(r.closed) : done.length;
      if (n > 0) flash(skipped.length ? 'y' : 'g', `Closed ${n} line(s) — they are off the returns dropdown.${why ? ' Not closed: ' + why + '.' : ''}`);
      else flash('r', `Nothing was closed.${why ? ' ' + why + '.' : ''}`);
      return done.length ? done : null;
    } catch (e) { flash('r', e.message); return null; }
  }
  /** The bulk call; against a backend that predates it, the 24.09 one-line call per line. */
  async function closeLinesOnServer(ids) {
    try {
      return await storesApi.closeIssueLines(ids, true);
    } catch (e) {
      if (e.status !== 404 && e.status !== 405) throw e;
      const out = { closed: 0, lines: [], skipped: [] };
      for (const id of ids) {
        try {
          const l = await storesApi.closeIssueLine(id, true);
          out.closed += 1;
          out.lines.push((l && l.lineNo) || '#' + id);
        } catch (err) { out.skipped.push({ txnId: id, reason: err.message }); }
      }
      return out;
    }
  }
  useEffect(() => { if (mode === 'return') loadIssueLines(); }, [mode, loadIssueLines]);
  const issueSlips = useMemo(() => [...new Set(issueLines.map((l) => l.slipNo).filter(Boolean))], [issueLines]);
  // a slip whose last open line was just closed is no longer in the list to pick from
  useEffect(() => {
    if (issueSlipPick && !issueSlips.includes(issueSlipPick)) setIssueSlipPick('');
  }, [issueSlips, issueSlipPick]);
  const linesOfSlip = useMemo(() => issueLines.filter((l) => !issueSlipPick || l.slipNo === issueSlipPick), [issueLines, issueSlipPick]);
  const pickedLine = useMemo(() => issueLines.find((l) => String(l.txnId) === String(issueLinePick)) || null, [issueLines, issueLinePick]);

  const loadNextCodes = useCallback(async () => {
    try { setNextCodes(((await storesApi.nextCodes(40)) || {}).codes || []); } catch { setNextCodes([]); }
  }, []);

  useEffect(() => {
    let live = true;
    masterApi.listDepartments()
      .then((r) => { if (live && Array.isArray(r)) setDepartments(r); })
      .catch(() => { /* master unreachable - the box stays empty */ });
    // Widths come from the whole Item Master, not only what is in stock: a code
    // exists for a width whether or not there is a roll of it on the floor today.
    masterApi.listItems()
      .then((r) => { if (live && Array.isArray(r)) setMasterItems(r); })
      .catch(() => { /* fall back to the widths already on rolls */ });
    storesApi.locations()
      .then((r) => { if (live && Array.isArray(r)) setLocations(r); })
      .catch(() => { /* not provisioned yet */ });
    // "Sale orders should be a drop down with the sale orders that are planned for
    // that particular day under PPC." Today's plan is read so those orders can be
    // marked and listed first; the open list stands behind it (SO_SOURCE).
    planningApi.week(today(), today())
      .then((w) => {
        if (!live) return;
        const list = [...new Set(((w && w.jobs) || []).map((j) => j.so).filter(Boolean))];
        setPlannedSos(list);
      })
      .catch(() => { if (live) setPlannedSos(null); });
    loadNextCodes();
    return () => { live = false; };
  }, [loadNextCodes]);

  /* ── the sale order comes first; its route names the departments, its BOM the materials ── */

  const openSos = useMemo(() => {
    const oab = (mods.oab && mods.oab.OAB) || {};
    return ['SF', 'OT'].flatMap((k) => (oab[k] || []).filter((r) => !r.closed).map((r) => r.so)).filter(Boolean);
  }, [mods.oab]);
  // Issues 7 §1: the JSS and customer beside each sale order, so the desk can see which
  // JSS (and therefore which route) an order works to before picking it.
  const soInfo = useMemo(() => {
    const oab = (mods.oab && mods.oab.OAB) || {};
    const m = {};
    ['SF', 'OT'].forEach((k) => (oab[k] || []).forEach((r) => { if (r && r.so && !m[r.so]) m[r.so] = r; }));
    return m;
  }, [mods.oab]);
  const soLabel = (so) => {
    const r = soInfo[so];
    return r ? `${so} · JSS ${r.spec || '—'}${r.customer ? ' · ' + r.customer : ''}` : so;
  };
  const plannedSet = useMemo(() => new Set(plannedSos || []), [plannedSos]);
  const soOptions = useMemo(() => {
    const planned = plannedSos || [];
    if (SO_SOURCE === 'planned' && planned.length) return planned;
    // planned first, then every other open order, each once
    return [...new Set([...planned, ...openSos])];
  }, [plannedSos, openSos]);
  const soFromPlan = SO_SOURCE === 'planned' && !!(plannedSos && plannedSos.length);

  useEffect(() => {
    const so = String(form.so || '').trim();
    if (!so) { setCtx(null); return undefined; }
    let live = true;
    setCtxBusy(true);
    storesApi.soContext(so)
      .then((c) => { if (live) setCtx(c && typeof c === 'object' ? { ...c, so } : { so, found: false, route: { departments: [] }, bom: { items: [] } }); })
      .catch((e) => { if (live) setCtx({ so, found: false, route: { departments: [] }, bom: { items: [] }, message: e && e.message ? e.message : 'Could not read the sale order' }); })
      .finally(() => { if (live) setCtxBusy(false); });
    return () => { live = false; };
  }, [form.so]);

  // BOM calculations 24.09 §15: "Sale order-wise allocation in the stores: issues
  // under return stamp. He will be able to allocate that particular roll or ink tin
  // or anything to that particular sale order." The PLAN login has already promised
  // rolls to this order — the desk issuing against it needs to SEE them, so it hands
  // over the material that was set aside rather than whatever is nearest.
  //
  // Issues as on 30.09 (P1, P3, S2, S3): "the issue happens from the stores login only;
  // only allocation happens from planning … somewhere it should nudge the stores guy
  // to issue that allocated roll first and only later anything else." What the order
  // has — the rolls allocated to it (by PLAN or by this desk) and what has gone out to
  // it — is read against what its BOM needs for the WHOLE order
  // (GET /api/stores/so-material). An older server has no such thing: the allocation
  // list alone is shown then, as before, and nothing is capped.
  const [soMat, setSoMat] = useState(null);   // { so, lines, allocations, issues } — lines empty on an older server
  const [allocTick, setAllocTick] = useState(0);
  useEffect(() => {
    const so = String(form.so || '').trim();
    if (!so) { setSoMat(null); return undefined; }
    let live = true;
    (async () => {
      let m = null;
      try { m = asSoMaterial(await storesApi.soMaterial(so)); } catch { m = null; }
      if (m) { if (live) setSoMat({ ...m, so }); return; }
      let a = [];
      try { const r = await storesApi.allocations(so); a = Array.isArray(r) ? r : []; } catch { a = []; }
      if (live) setSoMat({ so, lines: [], allocations: a, issues: [] });
    })();
    return () => { live = false; };
  }, [form.so, lastSlip, lastReturn, allocTick]);
  const matReady = !!(soMat && soMat.so === String(form.so || '').trim());
  const soAlloc = matReady ? soMat.allocations : [];
  const matLines = matReady ? soMat.lines : [];

  const soChosen = !!String(form.so || '').trim();
  const ctxReady = !!(ctx && ctx.so === String(form.so || '').trim());
  // §7: with a sale order chosen the department list IS the route — nothing else.
  // Without one, the Super Admin's department master (the only source there is).
  const routeDepts = ctxReady ? (((ctx.route || {}).departments) || []).map((d) => d.departmentName).filter(Boolean) : [];
  const deptOptions = soChosen ? [...new Set(routeDepts)] : departments.filter((d) => d.active !== false).map((d) => d.name);
  const routeMissing = soChosen && ctxReady && routeDepts.length === 0;
  // §8: with a sale order chosen the material list IS the BOM — nothing else.
  const bomItemsAll = ctxReady ? (((ctx.bom || {}).items) || []) : [];
  const bomMissing = soChosen && ctxReady && bomItemsAll.length === 0;
  // Issues 16.09 ¶1: "based on the department selection, the material type filters
  // should also be populating" — with a department chosen, only that department's
  // BOM lines are offered (Packing sees Packing's materials, not Printing's inks).
  const bomItems = useMemo(() => {
    const dept = String(form.department || '').trim().toLowerCase();
    if (!dept) return bomItemsAll;
    const mine = bomItemsAll.filter((b) => String(b.departmentName || '').trim().toLowerCase() === dept);
    // a BOM whose lines carry no department at all still offers everything
    return mine.length || bomItemsAll.some((b) => String(b.departmentName || '').trim()) ? mine : bomItemsAll;
  }, [bomItemsAll, form.department]);
  const bomIds = useMemo(() => new Set(bomItems.map((b) => String(b.itemId))), [bomItems]);
  const bomDeptOf = (id) => [...new Set(bomItems.filter((b) => String(b.itemId) === String(id)).map((b) => b.departmentName).filter(Boolean))];

  // A department chosen for one order does not silently carry over to another whose
  // route does not go through it.
  useEffect(() => {
    if (soChosen && ctxReady && form.department && !routeDepts.includes(form.department)) {
      setForm((f) => ({ ...f, department: '' }));
    }
  }, [soChosen, ctxReady, routeDepts, form.department]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 29.09 §Stores: "first I selected printing in the department and then ink and
   * solvent … were populated here. Now I go back and change the department to
   * slitting. The previous selections are still present in material type and
   * subgroup whereas they should be auto-refreshed upon changing the department."
   *
   * The department decides which BOM lines are on offer, so the three material
   * pickers below it describe the OLD department until they are cleared. Printing's
   * ink left standing over Slitting matched nothing and the item list came back
   * empty, which read as "there is no material" rather than "this filter is stale".
   */
  const lastDept = useRef(form.department);
  useEffect(() => {
    if (lastDept.current === form.department) return;
    lastDept.current = form.department;
    // Only the three FILTERS. The chosen roll is not cleared here: picking an issue
    // line to return against fills the department from that line, and clearing the
    // roll at the same moment emptied the form the line had just populated. An item
    // that no longer belongs under the new department still drops out below, where
    // narrowing already takes care of it.
    setFMat(''); setFSub(''); setFSpec('');
  }, [form.department]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── the material: type → sub-group → speciality → item code ── */

  useEffect(() => { storesApi.onHand().then((r) => setItems((r || []).filter((x) => x.active !== false && (num(x.closingStock) > 0 || x.unitCount > 0)))).catch(() => {}); }, []);
  // Issues 7 §3: a roll only comes back slit when it is FILM — ink and chemicals do not.
  const chosenIsFilm = useMemo(() => {
    const it = items.find((x) => String(x.id) === String(itemId)) || (pickedLine ? { materialType: pickedLine.materialType } : null);
    const mat = String((it && it.materialType) || '').trim();
    // an item with no material type on file cannot be said NOT to be film
    return !it || !mat || /film/i.test(mat + ' ' + String(it.subGroup || ''));
  }, [items, itemId, pickedLine]);
  useEffect(() => { if (!chosenIsFilm && split) setSplit(false); }, [chosenIsFilm, split]);

  const norm = (v) => String(v || '').trim().toLowerCase();
  // Issuing against an order: only the BOM's materials that are in stock. Returning,
  // or issuing with no order named: everything in stock.
  const pool = useMemo(() => (
    (mode === 'issue' && soChosen) ? items.filter((it) => bomIds.has(String(it.id))) : items
  ), [items, mode, soChosen, bomIds]);
  const bomNoStock = useMemo(() => {
    if (!(mode === 'issue' && soChosen)) return [];
    const inStock = new Set(items.map((it) => String(it.id)));
    const seen = new Set();
    return bomItems.filter((b) => !inStock.has(String(b.itemId)) && !seen.has(String(b.itemId)) && seen.add(String(b.itemId)));
  }, [bomItems, items, mode, soChosen]);
  /** Each picker offers only what the other two leave — the same narrowing as the board. */
  const opts = (key) => {
    const chosen = { materialType: fMat, subGroup: fSub, specialtyName: fSpec };
    const p = pool.filter((r) => Object.keys(chosen).every((k) => k === key || !chosen[k] || norm(r[k]) === norm(chosen[k])));
    const set = new Set(p.map((r) => String(r[key] || '').trim()).filter(Boolean));
    if (chosen[key]) set.add(chosen[key]);
    return [...set].sort((a, b) => a.localeCompare(b));
  };
  const visibleItems = useMemo(() => pool.filter((r) => (
    (!fMat || norm(r.materialType) === norm(fMat))
    && (!fSub || norm(r.subGroup) === norm(fSub))
    && (!fSpec || norm(r.specialtyName) === norm(fSpec))
  )), [pool, fMat, fSub, fSpec]);
  // Narrowing away the chosen item drops it — the code must always agree with the pickers.
  useEffect(() => {
    if (itemId && !visibleItems.some((it) => String(it.id) === String(itemId))) {
      setItemId(''); setForm((f) => ({ ...f, unitId: '' }));
    }
  }, [visibleItems, itemId]);

  /** Choosing a code the other way round fills the three pickers from the item. */
  function chooseItem(id) {
    setItemId(id);
    setForm((f) => ({ ...f, unitId: '' }));
    const it = items.find((x) => String(x.id) === String(id));
    if (it) {
      setFMat(String(it.materialType || '').trim());
      setFSub(String(it.subGroup || '').trim());
      setFSpec(String(it.specialtyName || '').trim());
    }
  }

  const loadUnits = useCallback(async (id) => {
    if (!id) { setUnits([]); return; }
    try { setUnits(await storesApi.units(id, true) || []); } catch (e) { flash('r', e.message); }
  }, [flash]);
  useEffect(() => { loadUnits(itemId); }, [itemId, loadUnits]);

  /** A picked issue line names the roll: the item and the unit follow it. */
  function pickIssueLine(txnId) {
    setIssueLinePick(txnId);
    const l = issueLines.find((x) => String(x.txnId) === String(txnId));
    if (!l) return;
    if (String(l.itemId) !== String(itemId)) {
      setItemId(String(l.itemId));
      const it = items.find((x) => String(x.id) === String(l.itemId));
      if (it) { setFMat(String(it.materialType || '').trim()); setFSub(String(it.subGroup || '').trim()); setFSpec(String(it.specialtyName || '').trim()); }
    }
    setForm((f) => ({ ...f, unitId: String(l.unitId), so: f.so || l.so || '', department: f.department || l.department || '' }));
    setChildren([blankChild()]);
  }

  // Issues 30.09 S6: "by default all slips are shown" — the history read the newest 60.
  const loadTxns = useCallback(async () => {
    try { setTxns((await storesApi.txns({ limit: HISTORY_LIMIT })) || []); } catch { /* history is best-effort */ }
  }, []);
  useEffect(() => { loadTxns(); }, [loadTxns]);

  const selectedUnit = units.find((u) => String(u.id) === String(form.unitId)) || null;
  const withStock = units.filter((u) => num(u.qtyRemaining) > 0);
  // what the basket already holds of a roll, so the same roll cannot be over-promised
  const inBasket = (unitId) => basket.filter((b) => String(b.unitId) === String(unitId)).reduce((s, b) => s + num(b.qty), 0);

  /* ── Issues 4.1: a slit roll cannot come back bigger than it went out ────────
     "The total width should not be more than the initial film width", and the same
     for weight. Both caps come off the PARENT roll: the width stamped on it when it
     was received, or failing that its item's Width (mm); and the weight it was
     received at. */
  const chosenItem = useMemo(() => items.find((it) => String(it.id) === String(itemId)) || null, [items, itemId]);
  const chosenMaster = useMemo(() => {
    const code = norm((chosenItem || {}).code);
    return code ? masterItems.find((it) => norm(it.code) === code) || null : null;
  }, [masterItems, chosenItem]);
  const parentWidth = selectedUnit ? unitWidthMm(selectedUnit, chosenMaster || chosenItem) : null;
  const parentWeight = selectedUnit ? num(selectedUnit.qtyReceived) : 0;

  /**
   * Issues 6 §9-§10 — the widths a returned roll may be cut to: ONLY the item codes
   * of the SAME material type and sub-group (and speciality, where both sides name
   * one) as the roll being returned, no wider than the parent, from the Item Master.
   * "If I have a 1,200 mm anti-fog BOPP roll, it'll come out as 700 and 500 mm
   * anti-fog BOPP rolls only and it'll never become an LDPE roll."
   *
   * One option PER ITEM CODE (Issues 6 §12): two codes of the same width used to
   * collapse into "340 mm · BLM312 (+1)", which told the desk nothing about the
   * second code. Each code is now its own line, naming its width and description.
   * There is no "other width" and no free text: a width with no code is the Super
   * Admin's to add in the Item Master, and the screen says exactly that.
   */
  const familyCodes = useMemo(() => {
    const base = chosenMaster || chosenItem;
    if (!base || !selectedUnit) return [];
    const same = (a, b) => norm(a) === norm(b);
    const specOf = (it) => norm(it.specialtyName ?? it.specialty);
    const poolAll = masterItems.length ? masterItems : items;
    return poolAll
      .filter((it) => it.active !== false)
      .filter((it) => same(it.materialType, base.materialType) && same(it.subGroup, base.subGroup)
        && (!specOf(it) || !specOf(base) || specOf(it) === specOf(base)))
      .map((it) => ({ item: it, width: itemWidthMm(it) }))
      .filter((x) => x.width != null && x.width > 0)
      .filter((x) => parentWidth == null || x.width <= parentWidth + 1e-6)
      .sort((a, b) => a.width - b.width || String(a.item.code).localeCompare(String(b.item.code)));
  }, [masterItems, items, chosenMaster, chosenItem, selectedUnit, parentWidth]);
  const codeById = (id) => familyCodes.find((x) => String(x.item.id) === String(id)) || null;

  /** What the rows below come to — and which of them are half-filled. */
  const splitTotals = useMemo(() => {
    let rolls = 0, width = 0, weight = 0, incomplete = false;
    children.forEach((c) => {
      const n = Math.floor(num(c.rolls));
      const w = parseWidthMm(c.widthMm);
      const kg = num(c.weightKg);
      if (!n && w === null && !kg && !c.itemId) return;          // an untouched spare row
      if (n <= 0 || w === null || kg <= 0 || !c.itemId) { incomplete = true; return; }
      rolls += n; width += n * w; weight += n * kg;
    });
    return { rolls, width, weight, incomplete };
  }, [children]);
  /**
   * What this roll has ALREADY produced. The rule is cumulative — "the cumulative
   * weight of the child rolls from one parent roll" — so a roll slit 700 mm today
   * and 600 mm tomorrow has produced 1300 mm off a 1200 mm parent, even though
   * neither return broke the cap on its own. The server counts the same way.
   */
  const prior = useMemo(() => {
    if (!selectedUnit) return { width: 0, weight: 0, rolls: 0 };
    if (selectedUnit.childCount != null) {
      return { width: num(selectedUnit.childWidth), weight: num(selectedUnit.childWeight), rolls: num(selectedUnit.childCount) };
    }
    return units.reduce((acc, u) => (String(u.parentUnitId) === String(selectedUnit.id)
      ? { width: acc.width + num(u.widthMm), weight: acc.weight + num(u.qtyReceived), rolls: acc.rolls + 1 }
      : acc), { width: 0, weight: 0, rolls: 0 });
  }, [units, selectedUnit]);

  const totalWidth = splitTotals.width + prior.width;
  const totalWeight = splitTotals.weight + prior.weight;
  const overWidth = parentWidth != null && totalWidth > parentWidth + 1e-6;
  const overWeight = parentWeight > 0 && totalWeight > parentWeight + 1e-6;
  // §11: "show remaining available weight"
  const remainingWeight = parentWeight > 0 ? Math.max(0, parentWeight - totalWeight) : null;

  /** The sticker numbers row `i` will get: the next unused ones after the rows above it. */
  const projectedCodes = (i) => {
    let k = 0;
    for (let j = 0; j < i; j++) {
      const n = Math.max(0, Math.floor(num(children[j].rolls)));
      if (n === 1 && String(children[j].internalCode || '').trim()) continue;
      k += n;
    }
    const n = Math.max(0, Math.floor(num(children[i].rolls)));
    return nextCodes.slice(k, k + n);
  };

  const setChild = (i, patch) => setChildren((cs) => cs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  /* ── Issues 30.09: who holds a roll, and where the order stands against its BOM ──
     P2: "Upon allocating a material in the plan login, that particular roll or item
     should not be available for the stores login to issue to any other sale order."
     The server always refused it, but only when the whole slip was sent; the picker
     offered the roll as free — often as the FIFO ① — so the desk found out last. */

  /** What THIS order holds on a roll (an older server's rows carry no unitId: matched by sticker). */
  const heldMine = (unitId, internalCode) => soAlloc.filter((a) => (a.unitId != null
    ? String(a.unitId) === String(unitId) : !!internalCode && a.internalCode === internalCode))
    .reduce((s, a) => s + num(a.qty), 0);
  /** The holds OTHER orders have on a roll: [{ so, qty, source }]. With no order chosen, every hold. */
  const holdsOther = (u) => {
    const so = String(form.so || '').trim();
    if (Array.isArray(u.holds)) return u.holds.filter((h) => !so || String(h.so || '').trim() !== so);
    // an older server says only how much is held and for whom
    const q = Math.max(0, num(u.allocated) - heldMine(u.id, u.internalCode));
    if (q <= 1e-9) return [];
    const names = (Array.isArray(u.allocatedTo) ? u.allocatedTo : []).filter((o) => !so || o !== so);
    return [{ so: names.join(', ') || 'another sale order', qty: q, source: '' }];
  };
  const heldOther = (u) => holdsOther(u).reduce((s, h) => s + num(h.qty), 0);
  const holdersText = (hs) => hs.map((h) => `${h.so}${sourceLabel(h.source) ? ` (${sourceLabel(h.source)})` : ''}`).join(', ');
  /** What of a roll may still go on this slip: its remaining, less other orders' holds and the slip. */
  const freeFor = (u) => num(u.qtyRemaining) - heldOther(u) - inBasket(u.id);
  const sameItem = (a, id, code) => (a.itemId != null ? String(a.itemId) === String(id) : codeKey(a.itemCode) === codeKey(code));

  /** The /so-material line of an item, by id (or code). */
  const lineOf = (id, code) => matLines.find((l) => String(l.itemId) === String(id))
    || (code ? matLines.find((l) => codeKey(l.itemCode) === codeKey(code)) : null) || null;
  /** The departments an item is consumed in, per the order's BOM. */
  const deptsOfItem = (id, code) => {
    const l = lineOf(id, code);
    if (l && Array.isArray(l.departments) && l.departments.some(Boolean)) return l.departments.filter(Boolean);
    return [...new Set(bomItemsAll.filter((b) => String(b.itemId) === String(id)).map((b) => b.departmentName).filter(Boolean))];
  };
  /**
   * S3: what the slip already adds to an item's commitment — per roll, the part not
   * drawn from this order's own hold on it (the server counts the same way: issuing a
   * roll the order holds is a conversion, not a new commitment).
   */
  const slipIncrease = (id) => {
    const perRoll = new Map();
    basket.filter((b) => String(b.itemId) === String(id)).forEach((b) => {
      const k = String(b.unitId);
      const cur = perRoll.get(k) || { q: 0, code: b.internalCode };
      perRoll.set(k, { ...cur, q: cur.q + num(b.qty) });
    });
    let t = 0;
    perRoll.forEach((v, k) => { t += Math.max(0, v.q - heldMine(k, v.code)); });
    return t;
  };
  /** The new commitment `q` more of roll `u` on the slip would make. */
  const increaseIf = (u, q) => {
    const mine = heldMine(u.id, u.internalCode);
    const before = inBasket(u.id);
    return Math.max(0, before + q - mine) - Math.max(0, before - mine);
  };
  const chosenLine = (mode === 'issue' && soChosen && itemId) ? lineOf(itemId, (chosenItem || {}).code) : null;
  const slipAdds = chosenLine ? slipIncrease(itemId) : 0;
  const lineDone = isComplete(chosenLine, slipAdds);
  // what this order's own hold on the picked roll still has to give — converting a
  // hold into an issue is never capped
  const ownLeft = selectedUnit ? Math.max(0, heldMine(selectedUnit.id, selectedUnit.internalCode) - inBasket(selectedUnit.id)) : 0;
  const capReason = lineDone ? `The BOM line for ${chosenLine.itemCode} on ${form.so} is complete — no more can be allocated or issued` : '';
  // S2: an allocated roll of the chosen item that is not on the slip yet
  const waitingAlloc = (mode === 'issue' && soChosen && itemId)
    ? soAlloc.find((a) => sameItem(a, itemId, (chosenItem || {}).code) && inBasket(a.unitId) + 1e-9 < num(a.qty)) || null
    : null;

  /**
   * S2: "Here the roll should be preselected." Choosing an item this order has a roll
   * allocated of puts THAT roll in the picker, with what is held for the order. Runs
   * when the item, its rolls, the holds or the slip change — a roll the desk then
   * picks (or clears) by hand is left alone.
   */
  const preselectKey = useRef('');
  useEffect(() => {
    if (mode !== 'issue' || !soChosen || !itemId) return;
    const key = [form.so, itemId, units.map((u) => u.id).join(','), soAlloc.map((a) => `${a.id}:${a.qty}`).join(','), basket.length].join('|');
    if (preselectKey.current === key) return;
    preselectKey.current = key;
    if (form.unitId) return;
    const left = (u) => Math.min(heldMine(u.id, u.internalCode), num(u.qtyRemaining)) - inBasket(u.id);
    const u = units.find((x) => (x.itemId == null || String(x.itemId) === String(itemId)) && left(x) > 1e-9);
    if (!u) return;
    setForm((f) => (f.unitId ? f : { ...f, unitId: String(u.id), qty: String(+left(u).toFixed(3)) }));
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // The roll picker, issuing: this order's own rolls first (★), then FIFO. ① marks the
  // oldest roll that is actually free — never one another order holds.
  const isMine = (u) => heldMine(u.id, u.internalCode) > 0;
  const rollChoices = mode === 'issue' ? [...withStock.filter(isMine), ...withStock.filter((u) => !isMine(u))] : units;
  const fifoPick = mode === 'issue'
    ? rollChoices.find((u) => !isMine(u) && freeFor(u) > 1e-9) || null
    : (units[0] && num(units[0].qtyRemaining) > 0 ? units[0] : null);
  const heldAway = (u) => mode === 'issue' && !isMine(u) && heldOther(u) > 1e-9 && freeFor(u) <= 1e-9;
  const rollLabel = (u) => {
    const uom = u.uom ? ' ' + u.uom : '';
    const tail = `${u.widthMm ? ` · ${qty(u.widthMm)}mm` : ''}${u.location ? ` · ${u.location}` : ''}`;
    const mark = fifoPick === u ? '① ' : '';
    if (mode !== 'issue') return `${mark}${u.internalCode} · ${qty(u.qtyRemaining)}${uom}${tail}`;
    const left = num(u.qtyRemaining) - inBasket(u.id);
    if (isMine(u)) {
      const mine = Math.max(0, heldMine(u.id, u.internalCode) - inBasket(u.id));
      return `★ ${u.internalCode} · allocated to ${form.so} · ${qty(mine)}${uom}${left > mine + 1e-9 ? ` (roll has ${qty(left)})` : ''}${tail}`;
    }
    const others = holdsOther(u);
    const held = heldOther(u);
    if (held > 1e-9 && freeFor(u) <= 1e-9) return `${u.internalCode} · held for ${holdersText(others)}${tail}`;
    if (held > 1e-9) return `${mark}${u.internalCode} · free ${qty(freeFor(u))} of ${qty(left)}${uom} · ${qty(held)} held for ${holdersText(others)}${tail}`;
    return `${mark}${u.internalCode} · ${qty(left)}${uom}${tail}`;
  };
  /** 'Rolls of this item': every hold on a roll, this order's starred. */
  const heldForText = (u) => {
    const so = String(form.so || '').trim();
    const hs = Array.isArray(u.holds) ? u.holds
      : num(u.allocated) > 0 ? [{ so: (Array.isArray(u.allocatedTo) ? u.allocatedTo : []).join(', ') || '—', qty: u.allocated }] : [];
    return hs.length ? hs.map((h) => `${so && h.so === so ? '★ ' : ''}${h.so} · ${qty(h.qty)}${sourceLabel(h.source) ? ` (${sourceLabel(h.source)})` : ''}`).join(', ') : '—';
  };

  /* ── issuing: build the slip, then book it and print it ── */

  function addToBasket() {
    if (!selectedUnit) { flash('r', 'Pick a roll to put on the slip.'); return; }
    const q = num(form.qty);
    if (q <= 0) { flash('r', 'Enter the quantity to issue from ' + selectedUnit.internalCode + '.'); return; }
    const free = freeFor(selectedUnit);
    if (q > free + 1e-9) {
      const others = holdsOther(selectedUnit);
      if (others.length) {
        // P2: say who holds it, and how much is left to give this order
        flash('r', `${qty(heldOther(selectedUnit))} ${selectedUnit.uom || ''} of ${selectedUnit.internalCode} is allocated to ${holdersText(others)} — `
          + `only ${qty(Math.max(0, free))} can be issued${form.so ? ' to ' + form.so : ''}. Release it first — in the PLAN login, or here with that sale order picked.`);
      } else {
        flash('r', `Only ${qty(free)} ${selectedUnit.uom || ''} of ${selectedUnit.internalCode} is left${inBasket(selectedUnit.id) ? ' after what is already on this slip' : ''}.`);
      }
      return;
    }
    // S3: the BOM cap — the server's own rule, said before the slip is sent
    const block = chosenLine ? bomCapBlock(chosenLine, { so: form.so, increase: increaseIf(selectedUnit, q), pending: slipAdds }) : null;
    if (block) { flash('r', block); return; }
    // S2: "nudge the stores guy to issue that allocated roll first and only later anything else"
    if (waitingAlloc && !isMine(selectedUnit)
      && !window.confirm(`${waitingAlloc.internalCode} is allocated to ${form.so} for ${waitingAlloc.itemCode || (chosenItem || {}).code || 'this item'} — issue it first.\n\nAdd ${selectedUnit.internalCode} instead?`)) return;
    setBasket((b) => [...b, {
      unitId: selectedUnit.id, internalCode: selectedUnit.internalCode, itemId: chosenItem ? chosenItem.id : itemId,
      itemCode: chosenItem ? chosenItem.code : '', itemName: chosenItem ? chosenItem.name : '', uom: selectedUnit.uom || (chosenItem || {}).uom || '',
      widthMm: selectedUnit.widthMm, location: selectedUnit.location, qty: q,
    }]);
    setForm((f) => ({ ...f, qty: '', unitId: '' }));
  }

  /**
   * S2: one click puts an allocated roll on the slip — what is held for the order, for
   * the department it was allocated for (or the one the BOM consumes it in). Never
   * capped: issuing a hold is a promise kept, not a new commitment.
   */
  function takeAllocated(a) {
    if (a.unitId == null) { flash('r', `${a.internalCode} cannot be put on the slip from here — pick it in the Roll list below.`); return; }
    const remaining = a.unitRemaining != null ? num(a.unitRemaining) : num(a.qty);
    const q = Math.min(num(a.qty), remaining - inBasket(a.unitId));
    if (q <= 1e-9) { flash('r', `${a.internalCode} is already on the slip.`); return; }
    const cur = String(form.department || '').trim();
    const wanted = a.department ? [a.department] : deptsOfItem(a.itemId, a.itemCode);
    const onRoute = (d) => (routeDepts.length ? routeDepts.find((r) => norm(r) === norm(d)) : d);
    const dept = (cur && (!wanted.length || wanted.some((d) => norm(d) === norm(cur)))) ? cur
      : (wanted.map(onRoute).find(Boolean) || cur);
    if (!dept) { flash('r', `Pick the department ${a.internalCode} goes to first.`); return; }
    if (basket.length && cur && norm(dept) !== norm(cur)) {
      flash('r', `${a.internalCode} goes to ${dept}; finish this ${cur} slip first — one slip goes to one department.`);
      return;
    }
    setBasket((b) => [...b, {
      unitId: a.unitId, internalCode: a.internalCode, itemId: a.itemId, itemCode: a.itemCode || '', itemName: a.itemName || '',
      uom: a.uom || '', widthMm: a.widthMm, location: a.location, qty: +q.toFixed(3), allocationId: a.id,
    }]);
    if (norm(dept) !== norm(cur)) setForm((f) => ({ ...f, department: dept }));
    if (String(form.unitId) === String(a.unitId)) setForm((f) => ({ ...f, unitId: '', qty: '' }));
  }

  /** P3: release a hold from here — the roll goes back to the free stock. */
  async function releaseAlloc(a) {
    if (!window.confirm(`Release ${a.internalCode} from ${form.so}?\n\n${qty(a.qty)} ${a.uom || ''} held for this order`
      + `${sourceLabel(a.source) ? ` (allocated by ${sourceLabel(a.source)})` : ''} goes back to the free stock, and any order can then be given it.`)) return;
    setBusy(true);
    try {
      await storesApi.releaseAllocation(a.id);
      flash('g', `${a.internalCode} released from ${form.so} — it is free stock again.`);
      setAllocTick((t) => t + 1);
      await loadUnits(itemId);
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  /**
   * P3: "Sale order-wise allocation in the stores … He will be able to allocate that
   * particular roll or ink tin or anything to that particular sale order." The roll is
   * held for the order — no one else can be given it — until it is issued or released.
   */
  async function allocateSelected() {
    if (!soChosen) { flash('r', 'Pick the sale order to allocate to first.'); return; }
    if (!selectedUnit) { flash('r', 'Pick the roll to allocate.'); return; }
    const q = num(form.qty);
    if (q <= 0) { flash('r', `Enter the quantity of ${selectedUnit.internalCode} to allocate to ${form.so}.`); return; }
    const mine = heldMine(selectedUnit.id, selectedUnit.internalCode);
    const free = num(selectedUnit.qtyRemaining) - heldOther(selectedUnit) - mine - inBasket(selectedUnit.id);
    if (q > free + 1e-9) {
      const others = holdsOther(selectedUnit);
      flash('r', `Only ${qty(Math.max(0, free))} ${selectedUnit.uom || ''} of ${selectedUnit.internalCode} is free to allocate`
        + (mine > 0 ? ` — ${qty(mine)} is already allocated to ${form.so}` : '')
        + (others.length ? `${mine > 0 ? ';' : ' —'} ${qty(heldOther(selectedUnit))} is held for ${holdersText(others)}` : '')
        + (inBasket(selectedUnit.id) ? ' (some of it is on this slip)' : '') + '.');
      return;
    }
    const block = chosenLine ? bomCapBlock(chosenLine, { so: form.so, increase: q, pending: slipAdds }) : null;
    if (block) { flash('r', block); return; }
    const depts = deptsOfItem(itemId, (chosenItem || {}).code);
    setBusy(true);
    try {
      await storesApi.allocate({
        so: form.so, unitId: Number(selectedUnit.id), qty: q,
        department: form.department || (depts.length === 1 ? depts[0] : undefined), note: form.note || undefined,
      });
      flash('g', `📌 ${selectedUnit.internalCode} · ${qty(q)} ${selectedUnit.uom || ''} allocated to ${form.so} — held for this order until it is issued or released.`);
      setForm((f) => ({ ...f, unitId: '', qty: '' }));
      setAllocTick((t) => t + 1);
      await loadUnits(itemId);
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  async function doIssue() {
    if (!basket.length) { flash('r', 'Add at least one roll to the slip first (pick a roll, enter the quantity, ＋ Add to slip).'); return; }
    if (!String(form.department || '').trim()) { flash('r', 'Pick the department this material goes to.'); return; }
    if (soChosen && routeMissing) { flash('r', (ctx && ctx.message) || `No route allocated to ${form.so}.`); return; }
    setBusy(true);
    try {
      const slip = await storesApi.issueBatch({
        so: form.so || undefined, department: form.department, note: form.note || undefined,
        lines: basket.map((b) => ({ unitId: Number(b.unitId), qty: Number(b.qty) })),
      });
      setLastSlip(slip);
      let pdfNote = '';
      try { pdfNote = ' Slip ' + saveIssueSlipPdf(slip) + ' downloaded — print it and hand it over with the material.'; }
      catch (e) { pdfNote = ' (The slip PDF could not be generated here: ' + (e && e.message ? e.message : e) + ' — use ⬇ PDF in the history below.)'; }
      flash('g', `✓ ${slip.slipNo}: ${(slip.lines || []).length} roll(s), ${qty(slip.totalQty)} issued to ${slip.department}${slip.so ? ' for ' + slip.so : ''}.${pdfNote}`);
      setBasket([]);
      setForm((f) => ({ ...f, qty: '', note: '', unitId: '' }));
      await loadUnits(itemId); await loadTxns();
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  async function reprint(slipNo) {
    try {
      const slip = await storesApi.slip(slipNo);
      saveIssueSlipPdf(slip);
    } catch (e) { flash('r', e.message); }
  }

  async function doReturn() {
    if (!form.unitId && !pickedLine) { flash('r', 'Pick the issue line (slip and roll) the material went out on.'); return; }
    const body = { unitId: form.unitId ? Number(form.unitId) : undefined, issueTxnId: pickedLine ? Number(pickedLine.txnId) : undefined,
      so: form.so || undefined, department: form.department || undefined, note: form.note || undefined };
    if (split) {
      // A half-filled row first: it is the commonest slip, and "enter at least one
      // returned roll" is the wrong thing to say to someone who has entered three
      // quarters of one.
      if (splitTotals.incomplete) {
        flash('r', 'Every returned roll needs a count, a width (item code) and a weight — one of the rows below is half filled in.');
        return;
      }
      if (!splitTotals.rolls) { flash('r', 'Enter at least one returned roll.'); return; }
      // Issues 4.1 — the two caps. Said with the numbers, because "invalid" tells the
      // desk nothing about which figure to change.
      if (overWidth) {
        flash('r', `These come to ${qty(totalWidth)} mm`
          + (prior.width > 0 ? ` (including ${qty(prior.width)} mm already back off this roll)` : '')
          + `, but ${selectedUnit.internalCode} is only ${qty(parentWidth)} mm wide. `
          + `A ${qty(parentWidth)} mm roll can be slit into widths that add up to ${qty(parentWidth)} — no more.`);
        return;
      }
      if (overWeight) {
        flash('r', `These come to ${qty(totalWeight)} ${selectedUnit.uom || 'kg'}`
          + (prior.weight > 0 ? ` (including ${qty(prior.weight)} already back off this roll)` : '')
          + `, but ${selectedUnit.internalCode} only weighed ${qty(parentWeight)}. `
          + `Slitting a roll does not add material to it.`);
        return;
      }
      // One physical roll, one unit, one sticker — so a line saying "2 rolls" books two.
      // A typed internal code can only belong to one of them, so it is honoured for a
      // single roll and auto-assigned otherwise (the desk is told, beside the box).
      const kids = [];
      children.forEach((c) => {
        const n = Math.floor(num(c.rolls));
        const w = parseWidthMm(c.widthMm);
        const kg = num(c.weightKg);
        if (n <= 0 || w === null || kg <= 0 || !c.itemId) return;
        for (let k = 0; k < n; k++) {
          kids.push({
            qty: kg, widthMm: w,
            internalCode: n === 1 && c.internalCode ? c.internalCode : undefined,
            location: c.location || undefined, status: 'RETURNED',
            // Issues 6 §9-10: the item code of that width, always — the server refuses a roll without one.
            itemId: Number(c.itemId),
          });
        }
      });
      body.children = kids;
    } else {
      if (num(form.qty) <= 0) { flash('r', 'Enter the quantity returned.'); return; }
      body.qty = Number(form.qty);
    }
    setBusy(true);
    try {
      const r = await storesApi.receiveReturn(body);
      setLastReturn(r);
      const nos = r.returnNos || [];
      // §12: every returned roll gets its own return slip — downloaded as it is booked
      let pdfNote = '';
      try {
        for (const no of nos) saveIssueSlipPdf(await storesApi.slip(no));
        if (nos.length) pdfNote = ` Return slip${nos.length === 1 ? '' : 's'} ${nos.join(', ')} downloaded — attach to issue ${r.issueLineNo || ''}.`;
      } catch (e) { pdfNote = ' (The return slip PDF could not be generated here: ' + (e && e.message ? e.message : e) + ' — use ⬇ in the history below.)'; }
      flash('g', (split
        ? `Returned as ${(r.returned || []).length} roll(s): ${(r.returned || []).map((x) => x.internalCode).join(', ')} — write these on the rolls. The original roll is now zero.`
        : `Returned ${form.qty} to ${selectedUnit ? selectedUnit.internalCode : 'the roll'}${r.issueLineNo ? ' against ' + r.issueLineNo : ''}.`) + pdfNote);
      setForm((f) => ({ ...f, qty: '', note: '' }));
      setChildren([blankChild()]);
      setSplit(false);
      await loadUnits(itemId); await loadTxns(); await loadNextCodes(); await loadIssueLines();
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  const itemDesc = (chosenItem || {}).name || '';
  const basketTotal = basket.reduce((s, b) => s + num(b.qty), 0);

  return (
    <>
      <div className="card">
        <div className="ctitle">🔄 Issue to the shop floor / receive a return</div>
        <div className="al al-b">
          Rolls are listed oldest first — <strong>issue from the top</strong> (FIFO). Issues and returns move the closing
          stock on the Material on Hand board immediately. With a sale order chosen, the department comes from
          its <strong>route</strong> and the material from its <strong>BOM</strong> — nothing else is offered.
        </div>

        <div className="step-bar" style={{ marginBottom: 6 }}>
          <div className={'step-tab' + (mode === 'issue' ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setMode('issue')} role="tab" aria-selected={mode === 'issue'}>↗ Issue material</div>
          <div className={'step-tab' + (mode === 'return' ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => { setMode('return'); setBasket([]); }} role="tab" aria-selected={mode === 'return'}>↙ Receive a return</div>
        </div>

        {/* Stores 5.1: "the first selection should be for Sale Order and then … the
            departments dropdown will be populated [from the sale order route] and per
            department I should be able to allocate the material." */}
        <div className="ctitle" style={{ fontSize: 11, margin: '6px 0 2px' }}>① The order and the department</div>
        <div className="g4">
          <div className="fg">
            <label>Sale order {soFromPlan ? <span style={{ fontWeight: 400, color: 'var(--i3)' }}>(planned)</span> : null}</label>
            {soOptions.length ? (
              <select value={form.so} onChange={(e) => { setForm({ ...form, so: e.target.value, department: '' }); setBasket([]); setItemId(''); }} aria-label="Sale order">
                <option value="">— none —</option>
                {soOptions.map((v) => <option key={v} value={v}>{soLabel(v)}{plannedSet.has(v) ? ' · planned today' : ''}</option>)}
                {form.so && !soOptions.includes(form.so) && <option value={form.so}>{form.so}</option>}
              </select>
            ) : (
              <input value={form.so} onChange={(e) => { setForm({ ...form, so: e.target.value }); setBasket([]); }}
                aria-label="Sale order" placeholder={plannedSos === null ? 'type the SO' : 'nothing planned today — type the SO'} />
            )}
            <div className="pg-sub" style={{ margin: '3px 0 0' }}>
              {ctxBusy ? 'Reading the route and BOM…'
                : ctxReady && ctx.found
                  ? <>JSS <b>{ctx.spec || '—'}</b>{ctx.customer ? ` · ${ctx.customer}` : ''}{ctx.jobName ? ` · ${ctx.jobName}` : ''}
                    {ctx.route && ctx.route.routeName ? ` · route ${ctx.route.routeName}` : ''}</>
                  : SO_SOURCE === 'planned'
                    ? 'Only sale orders PPC has planned are offered.'
                    : `All open sale orders${plannedSet.size ? `; ${plannedSet.size} planned today are listed first` : ''}.`}
            </div>
          </div>
          <div className="fg">
            <label>Department {soChosen && ctxReady && routeDepts.length ? <span style={{ fontWeight: 400, color: 'var(--i3)' }}>(from the route of {form.so})</span> : null}</label>
            <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} aria-label="Department"
              disabled={soChosen && (!ctxReady || routeMissing)}>
              <option value="">{soChosen && routeMissing ? '— no route allocated —' : '— select —'}</option>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {routeMissing && (
              <div className="pg-sub" style={{ margin: '3px 0 0', color: 'var(--red)' }} role="alert">
                No route is allocated to {form.so}{ctx && ctx.spec ? ` (JSS ${ctx.spec})` : ''} — ask QC / the Super Admin to allocate it under Route and BOM. Material cannot be issued against this order until then.
              </div>
            )}
            {!soChosen && (
              <div className="pg-sub" style={{ margin: '3px 0 0' }}>Departments are the Super Admin&rsquo;s list. Pick a sale order to narrow this to its route.</div>
            )}
          </div>
          <div className="fg"><label>Note</label><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label="Note" /></div>
        </div>

        {/* Stores 5.1: "the next items should be: Material, Subgroup, Specialty,
            including the item code. All of these should be the dropdown selections."
            Issues 6 §8: with a sale order chosen, only the BOM's materials. */}
        {mode === 'return' && (
          <>
            <div className="ctitle" style={{ fontSize: 11, margin: '4px 0 2px' }}>② The issue line the roll went out on</div>
            <div className="pg-sub" style={{ marginTop: 0 }}>
              Every roll issued has its own number — <b>ISS/2026/3.1</b>, <b>ISS/2026/3.2</b> (a lone roll is <b>.0</b>). Pick the slip, then the roll;
              what comes back is booked against that line, in as many instalments as it takes, and each returned roll gets its own
              return slip (<b>RET/2026/3.1/1</b>, <b>/2</b> …). Only lines with material still out are listed.
            </div>
            <div className="g3">
              <div className="fg"><label>Issue slip</label>
                <select value={issueSlipPick} onChange={(e) => { setIssueSlipPick(e.target.value); setIssueLinePick(''); }} aria-label="Issue slip">
                  <option value="">— all open slips ({issueSlips.length}) —</option>
                  {issueSlips.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="fg" style={{ gridColumn: 'span 2' }}><label>Roll-wise issue number *</label>
                <select value={issueLinePick} onChange={(e) => pickIssueLine(e.target.value)} aria-label="Issue line">
                  <option value="">— select the roll that came back —</option>
                  {linesOfSlip.map((l) => (
                    <option key={l.txnId} value={l.txnId}>
                      {l.lineNo || l.slipNo} · {l.internalCode} · {l.itemCode}{l.widthMm ? ` ${qty(l.widthMm)}mm` : ''} · {qty(l.qtyIssued)} {l.uom || ''} out
                      {num(l.qtyReturned) ? ` · ${qty(l.qtyReturned)} back (${l.rollsReturned})` : ''}{l.department ? ` · ${l.department}` : ''}{l.so ? ` · ${l.so}` : ''}
                    </option>
                  ))}
                </select>
                {issueLines.length === 0 && <div className="pg-sub" style={{ margin: '3px 0 0' }}>Nothing is out on a numbered slip yet — a roll issued before slips existed can still be returned by picking it under ③.</div>}
                {issueLines.length > 0 && (
                  <div className="pg-sub" style={{ margin: '3px 0 0' }}>
                    {issueLines.length} line(s) still open. A line whose material was consumed can be closed —
                    it then leaves this list.
                  </div>
                )}
              </div>
            </div>
            {pickedLine && (
              <div className="al al-b" style={{ margin: '4px 0 6px' }} aria-label="Picked issue line">
                <b>{pickedLine.lineNo}</b> — {pickedLine.internalCode} ({pickedLine.itemCode} — {pickedLine.itemName}) · {qty(pickedLine.qtyIssued)} {pickedLine.uom || ''} issued to {pickedLine.department || '—'}
                {pickedLine.so ? ` for ${pickedLine.so}` : ''} on {String(pickedLine.ts || '').slice(0, 10)} ·
                back so far <b>{qty(pickedLine.qtyReturned)}</b> in {pickedLine.rollsReturned} roll(s) · still out <b>{qty(num(pickedLine.qtyIssued) - num(pickedLine.qtyReturned))} {pickedLine.uom || ''}</b>
                {' '}· next return slip <b>RET/{String(pickedLine.lineNo || '').replace(/^ISS\//, '')}/{num(pickedLine.rollsReturned) + 1}</b>
                <div style={{ marginTop: 4 }}>
                  <button className="btn btn-s" style={{ height: 24, fontSize: 11 }}
                    aria-label={`Close issue line ${pickedLine.lineNo || pickedLine.slipNo}`}
                    onClick={() => closeIssueLine(pickedLine)}>
                    ✔ Nothing is coming back — close this line
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {/* §15 / 30.09 (P1, P3, S2): what is set aside for this order — by PLAN or by this
            desk — and a click to hand it over. The desk issues THESE rolls first; that is
            what the allocation was for. */}
        {mode === 'issue' && soChosen && matReady && (
          <div className="al al-b" style={{ margin: '4px 0 6px' }} aria-label={`Material allocated to ${form.so}`}>
            {/* one child: .al lays its children out as a flex row */}
            {soAlloc.length > 0 ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{soAlloc.length} roll(s) are allocated to {form.so} — issue these first.</b>{' '}
                <span style={{ fontSize: 11 }}><b>Put on slip</b> takes the roll onto the slip below, for the department it is allocated for.</span>
                <div className="tw" style={{ marginTop: 4 }}><table>
                  <thead><tr>
                    <th>Roll</th><th>Item</th><th>For dept</th><th>Location</th><th style={{ textAlign: 'right' }}>Allocated</th><th>By</th><th style={{ width: 190 }}></th>
                  </tr></thead>
                  <tbody>
                    {soAlloc.map((a) => {
                      const onSlip = basket.some((b) => b.allocationId === a.id);
                      return (
                        <tr key={a.id}>
                          <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{a.internalCode}</td>
                          <td style={{ fontSize: 11 }}>{a.itemCode}{a.itemName ? ` — ${a.itemName}` : ''}</td>
                          <td style={{ fontSize: 11 }}>{a.department || '—'}</td>
                          <td style={{ fontSize: 11 }}>{a.location || '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{qty(a.qty)} {a.uom || ''}</td>
                          {/* rows from before the source was recorded were all PLAN's */}
                          <td style={{ fontSize: 11 }}>
                            <span className="tag tb" style={{ fontSize: 9 }}>{sourceLabel(a.source) || 'PLAN'}</span>
                            {a.actor ? <span style={{ color: 'var(--i3)' }}> {a.actor}</span> : null}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-g" style={{ height: 24, fontSize: 11, padding: '0 8px' }}
                                disabled={busy || onSlip || a.unitId == null} aria-label={`Put ${a.internalCode} on the slip`}
                                title={a.unitId == null ? 'Pick this roll in the Roll list below' : undefined}
                                onClick={() => takeAllocated(a)}>{onSlip ? '✓ on slip' : '↧ Put on slip'}</button>
                              <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 8px', color: 'var(--red)' }}
                                disabled={busy} aria-label={`Release ${a.internalCode} from ${form.so}`}
                                onClick={() => releaseAlloc(a)}>✕ Release</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              </div>
            ) : (
              <span style={{ fontSize: 12 }}>
                Nothing is allocated to {form.so} yet. To hold a roll for this order without issuing it, pick it below and
                press <b>📌 Allocate</b> — the PLAN login can allocate too.
              </span>
            )}
          </div>
        )}
        {/* S3: "The stores guy should know that according to the BOM for that SO … he is
            allowed to assign only 300 kg." */}
        {mode === 'issue' && soChosen && matReady && matLines.length > 0 && (
          <SoBomPosition so={form.so} lines={matLines} issues={soMat.issues} department={form.department}
            slipAddsOf={slipIncrease} />
        )}
        <div className="ctitle" style={{ fontSize: 11, margin: '4px 0 2px' }}>{mode === 'return' ? '③ The roll' : '② The material'}{mode === 'issue' && soChosen && ctxReady && bomItems.length ? <span style={{ fontWeight: 400, color: 'var(--i3)' }}> — from the BOM of {form.so}{form.department ? ` for ${form.department}` : ''}</span> : null}</div>
        {mode === 'issue' && soChosen && ctxReady && !bomMissing && form.department && bomItems.length === 0 && (
          <div className="al al-y" role="alert">The BOM of {form.so} has no material for {form.department} — pick another department, or ask QC to add that department&rsquo;s lines under Route and BOM.</div>
        )}
        {mode === 'issue' && bomMissing && (
          <div className="al al-r" role="alert">
            No BOM is allocated to {form.so}{ctx && ctx.spec ? ` (JSS ${ctx.spec})` : ''} — ask QC / the Super Admin to allocate it under Route and BOM. Material cannot be issued against this order until then.
          </div>
        )}
        {mode === 'issue' && bomNoStock.length > 0 && (
          <div className="pg-sub" style={{ marginTop: 0, color: '#B7770D' }}>
            On the BOM but not in stock: {bomNoStock.map((b) => b.itemCode).join(', ')}.
          </div>
        )}
        <div className="g4">
          <div className="fg"><label>Material type</label>
            <select value={fMat} onChange={(e) => { setFMat(e.target.value); setFSub(''); setFSpec(''); }} aria-label="Material type">
              <option value="">Any material</option>{opts('materialType').map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="fg"><label>Sub group</label>
            <select value={fSub} onChange={(e) => { setFSub(e.target.value); setFSpec(''); }} aria-label="Sub group">
              <option value="">Any sub-group</option>{opts('subGroup').map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="fg"><label>Speciality</label>
            <select value={fSpec} onChange={(e) => setFSpec(e.target.value)} aria-label="Speciality">
              <option value="">Any speciality</option>{opts('specialtyName').map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          {/* Issues 3.1: "the item code should be different and the description should
              be different" — the code is what is stencilled on the roll, so it is what
              is picked; the description reads back beside it. */}
          <div className="fg"><label>Item code <span style={{ fontWeight: 400, color: 'var(--i3)' }}>({visibleItems.length} {mode === 'issue' && soChosen ? 'on the BOM, in stock' : 'in stock'})</span></label>
            <select value={itemId} onChange={(e) => chooseItem(e.target.value)} aria-label="Item" disabled={mode === 'issue' && soChosen && (!ctxReady || bomMissing)}>
              <option value="">— select an item code —</option>
              {visibleItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.code}{mode === 'issue' && soChosen && bomDeptOf(it.id).length ? ` · for ${bomDeptOf(it.id).join(' / ')}` : ''}
                  {mode === 'issue' && soChosen && soAlloc.some((a) => sameItem(a, it.id, it.code)) ? ' · ★ allocated' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="g4">
          <div className="fg"><label>Item description</label>
            <input value={itemDesc} readOnly tabIndex={-1}
              aria-label="Item description" placeholder="pick a code first"
              style={{ background: 'var(--bg)', color: 'var(--i3)', cursor: 'not-allowed' }} />
          </div>
          <div className="fg"><label>Roll / can (oldest first)</label>
            {/* 30.09 (P2/S2): this order's allocated rolls lead (★); a roll other orders
                hold all of is shown but cannot be picked; one they hold part of says so */}
            <select value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} aria-label="Roll">
              <option value="">— select a roll —</option>
              {rollChoices.map((u) => (
                <option key={u.id} value={u.id} disabled={heldAway(u)}>{rollLabel(u)}</option>
              ))}
            </select>
          </div>
          <div className="fg"><label>Quantity</label>
            <input type="number" step="any" min="0" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}
              aria-label="Quantity" disabled={mode === 'return' && split}
              placeholder={selectedUnit ? `max ${qty(mode === 'issue' ? Math.max(0, freeFor(selectedUnit)) : num(selectedUnit.qtyRemaining))}` : ''} />
          </div>
          <div className="fg"><label>Internal code</label>
            <input value={selectedUnit ? selectedUnit.internalCode : ''} readOnly tabIndex={-1} aria-label="Internal code of the roll"
              placeholder="pick a roll" style={{ background: 'var(--bg)', color: 'var(--blu)', fontFamily: 'monospace', fontWeight: 700, cursor: 'not-allowed' }} />
          </div>
        </div>

        {mode === 'issue' && (
          <>
            {/* S3: where the chosen item stands against this order's BOM, under the picker */}
            {chosenLine && (
              <div className={'al ' + (lineDone ? 'al-r' : 'al-b')} style={{ margin: '2px 0 4px', fontSize: 12 }}
                aria-label={`BOM line for ${chosenLine.itemCode}`} role={lineDone ? 'alert' : undefined}>
                {/* one child: .al lays its children out as a flex row */}
                {lineDone ? (
                  <div>
                    <b>The BOM line for {chosenLine.itemCode} on {form.so} is complete — no more can be allocated or issued.</b>{' '}
                    Needs {qty(chosenLine.required)} {chosenLine.uom || ''}; allocated {qty(chosenLine.allocated)}, issued {qty(chosenLine.netIssued)}
                    {slipAdds > 0 ? `, on this slip ${qty(slipAdds)}` : ''}.
                    {ownLeft > 0 ? ' The roll allocated to this order can still go out.' : ''}
                  </div>
                ) : hasCap(chosenLine) ? (
                  <div>
                    BOM needs <b>{qty(chosenLine.required)} {chosenLine.uom || ''}</b> of {chosenLine.itemCode}
                    {' · '}allocated {qty(chosenLine.allocated)} · issued {qty(chosenLine.netIssued)} · on this slip {qty(slipAdds)}
                    {' · '}still open <b>{qty(openOf(chosenLine, slipAdds))}</b> — one more roll may take it past the need; after that the line is closed.
                  </div>
                ) : (
                  <div>
                    {chosenLine.itemCode}: allocated {qty(chosenLine.allocated)} · issued {qty(chosenLine.netIssued)} —{' '}
                    {chosenLine.onBom === false ? 'not on the BOM of ' + form.so : 'the BOM gives no quantity for it in this unit'}, so nothing caps it.
                  </div>
                )}
              </div>
            )}
            {waitingAlloc && selectedUnit && !isMine(selectedUnit) && (
              <div className="al al-y" style={{ margin: '2px 0 4px', fontSize: 12 }} role="note">
                <span>★ <b>{waitingAlloc.internalCode}</b> is allocated to {form.so} for this item — issue it first (it heads the Roll list).</span>
              </div>
            )}
            <div className="act" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              <button className="btn btn-s" onClick={addToBasket} disabled={busy || !selectedUnit || (lineDone && ownLeft <= 1e-9)}
                title={lineDone && ownLeft <= 1e-9 ? capReason : undefined}>＋ Add to slip</button>
              {/* P3: hold the roll for the order without issuing it */}
              {soChosen && (
                <button className="btn btn-s" onClick={allocateSelected} disabled={busy || !selectedUnit || lineDone}
                  title={lineDone ? capReason : `Hold the roll for ${form.so} until it is issued or released`}
                  aria-label={selectedUnit ? `Allocate ${selectedUnit.internalCode} to ${form.so}` : `Allocate a roll to ${form.so}`}>
                  📌 Allocate to {form.so}
                </button>
              )}
              <span className="pg-sub" style={{ margin: 0 }}>Add every roll going to {form.department || 'the department'}{form.so ? ` for ${form.so}` : ''}, then press Issue — one slip, one PDF.</span>
            </div>
            <div className="ctitle" style={{ fontSize: 11, margin: '8px 0 2px' }}>③ The slip <span className="tag tgr">{basket.length}</span> <span style={{ fontWeight: 400, color: 'var(--i3)' }}>— each roll gets its own line number (ISS/…/N.1, N.2)</span></div>
            <div className="tw"><table>
              <thead><tr>
                <th style={{ width: 30 }}>#</th><th>Roll / sticker</th><th>Item code</th><th>Description</th>
                <th style={{ textAlign: 'right' }}>Width</th><th>Rack</th><th style={{ textAlign: 'right' }}>Quantity</th><th style={{ width: 40 }}></th>
              </tr></thead>
              <tbody>
                {basket.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 12, color: 'var(--i3)' }}>Nothing on the slip yet</td></tr>
                ) : basket.map((b, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{b.internalCode}</td>
                    <td style={{ fontFamily: 'monospace' }}>{b.itemCode}</td>
                    <td style={{ fontSize: 11 }}>{b.itemName}</td>
                    <td style={{ textAlign: 'right' }}>{b.widthMm ? qty(b.widthMm) : '—'}</td>
                    <td style={{ fontSize: 11 }}>{b.location || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{qty(b.qty)} {b.uom}</td>
                    <td><button className="btn btn-r" style={{ height: 24, fontSize: 11, padding: '0 6px' }} aria-label={`Remove ${b.internalCode} from the slip`}
                      onClick={() => setBasket((bs) => bs.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                ))}
                {basket.length > 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{qty(basketTotal)}</td><td></td></tr>
                )}
              </tbody>
            </table></div>
            <div className="act">
              <button className="btn btn-g" onClick={doIssue} disabled={busy || !basket.length}>{busy ? 'Issuing…' : '↗ Issue & print slip (PDF)'}</button>
              {lastSlip && (
                <button className="btn btn-s" onClick={() => saveIssueSlipPdf(lastSlip)} aria-label={`Download slip ${lastSlip.slipNo} again`}>⬇ Slip {lastSlip.slipNo} again</button>
              )}
            </div>
          </>
        )}

        {mode === 'return' && (
          <>
            <label className="cb" style={{ fontSize: 12, marginTop: 4, opacity: chosenIsFilm ? 1 : 0.55 }}
              title={chosenIsFilm ? undefined : 'Only a FILM roll comes back cut into narrower rolls'}>
              <input type="checkbox" checked={split} disabled={!chosenIsFilm} onChange={(e) => setSplit(e.target.checked)} aria-label="Returned as narrower rolls" />
              <span>The roll came back cut into narrower rolls{chosenIsFilm ? '' : ' (film only)'}</span>
            </label>
            {split && (
              <div style={{ marginTop: 6 }}>
                <div className="pg-sub" style={{ marginTop: 0 }}>
                  A 1200&nbsp;mm roll issued and returned as 700 + 500&nbsp;mm: enter each returned roll below. Each becomes its own
                  roll with its own sticker, and the original roll is left at zero. <strong>The widths and the weights cannot add
                  up to more than the roll they were cut from.</strong> The width list is the item codes of the same material
                  type, sub-group and speciality in the Item Master — a roll is booked under the code of its width, and a width
                  that is not listed has to be added there by the Super Admin first.
                </div>
                {!selectedUnit ? (
                  <div className="al al-y" style={{ margin: '6px 0' }}>Pick the roll that came back (② above) first — the widths offered depend on its material.</div>
                ) : (
                  <div className="al al-b" style={{ margin: '6px 0' }}>
                    Cut from <b>{selectedUnit.internalCode}</b>
                    {chosenItem ? ` (${chosenItem.code} · ${[chosenItem.materialType, chosenItem.subGroup, chosenItem.specialtyName].filter(Boolean).join(' / ')})` : ''}
                    {parentWidth != null ? ` · ${qty(parentWidth)} mm` : ''}
                    {parentWeight > 0 ? ` · ${qty(parentWeight)} ${selectedUnit.uom || ''}` : ''}
                    {selectedUnit.location ? ` · ${selectedUnit.location}` : ''} — each roll below is linked back to it.
                    {parentWidth == null && (
                      <div style={{ fontSize: 11, color: '#B7770D', marginTop: 3 }}>
                        No width on file for this roll or its item, so the total width cannot be checked. Set the item&rsquo;s
                        Width (mm) on the Padmin Item Master.
                      </div>
                    )}
                    {familyCodes.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 3 }} role="alert">
                        No narrower width is available for this material type and subgroup. Please ask the Super Admin to add the appropriate item in the Item Master.
                      </div>
                    )}
                  </div>
                )}
                <div className="tw"><table>
                  <thead><tr>
                    <th style={{ width: 80 }}>Rolls *</th><th style={{ width: 260 }}>Width · item code *</th>
                    <th style={{ width: 130 }}>Weight each *</th>
                    <th>Internal code</th><th style={{ width: 150 }}>Location</th><th style={{ width: 40 }}></th>
                  </tr></thead>
                  <tbody>
                    {children.map((c, i) => {
                      const codes = projectedCodes(i);
                      const n = Math.floor(num(c.rolls));
                      const picked = codeById(c.itemId);
                      return (
                        <tr key={i}>
                          <td><input type="number" step="1" min="1" className="nospin" value={c.rolls}
                            aria-label={`Returned rolls ${i + 1}`} placeholder="1"
                            onChange={(e) => setChild(i, { rolls: e.target.value })} /></td>
                          <td>
                            {/* Issues 6 §9-§12: one option per item code of the family — the
                                width, the code and the description, nothing collapsed into
                                "(+1)". No "other width": a missing width is added in the Item
                                Master by the Super Admin, never typed here. */}
                            <select value={c.itemId || ''} aria-label={`Returned width ${i + 1}`} style={{ width: '100%' }}
                              disabled={!selectedUnit || familyCodes.length === 0}
                              onChange={(e) => {
                                const hit = codeById(e.target.value);
                                setChild(i, { itemId: e.target.value, widthMm: hit ? String(hit.width) : '' });
                              }}>
                              <option value="">{!selectedUnit ? '— pick the roll first —' : familyCodes.length ? '— width · item code —' : '— no width on file for this material —'}</option>
                              {familyCodes.map((x) => (
                                <option key={x.item.id} value={x.item.id}>
                                  {x.width} mm · {x.item.code}{x.item.name ? ` — ${x.item.name}` : ''}
                                </option>
                              ))}
                            </select>
                            {picked && (
                              <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 2 }}>
                                {picked.item.code} · {[picked.item.materialType, picked.item.subGroup, picked.item.specialtyName].filter(Boolean).join(' / ')}
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input type="number" step="any" min="0" className="nospin" style={{ flex: 1 }} value={c.weightKg}
                                aria-label={`Returned weight ${i + 1}`} placeholder="per roll"
                                onChange={(e) => setChild(i, { weightKg: e.target.value })} />
                              <span style={{ fontSize: 10, color: 'var(--i3)' }}>{(selectedUnit && selectedUnit.uom) || 'kg'}</span>
                            </div>
                          </td>
                          <td>
                            <input value={c.internalCode} placeholder={n === 1 && codes[0] ? codes[0] : 'auto'} aria-label={`Returned internal code ${i + 1}`}
                              disabled={n > 1}
                              title={n === 1 && codes[0] ? `Will be ${codes[0]} unless you type another code` : ''}
                              onChange={(e) => setChild(i, { internalCode: e.target.value })} />
                            {n > 1 ? (
                              <div style={{ fontSize: 10, color: 'var(--blu)', fontFamily: 'monospace', fontWeight: 700, marginTop: 2 }}
                                aria-label={`Stickers for returned row ${i + 1}`}>
                                🏷 {codes.length ? `${codes[0]} … ${codes[codes.length - 1]}` : `${n} stickers, assigned on receive`}
                              </div>
                            ) : (!String(c.internalCode || '').trim() && codes[0] ? (
                              <div style={{ fontSize: 10, color: 'var(--blu)', fontFamily: 'monospace', fontWeight: 700, marginTop: 2 }}
                                aria-label={`Stickers for returned row ${i + 1}`}>🏷 {codes[0]}</div>
                            ) : null)}
                          </td>
                          <td>
                            {locations.length ? (
                              <select value={c.location} aria-label={`Returned location ${i + 1}`} style={{ width: '100%' }}
                                onChange={(e) => setChild(i, { location: e.target.value })}>
                                <option value="">— rack —</option>
                                {locations.map((loc) => <option key={loc.id} value={loc.name}>{loc.name}</option>)}
                                {c.location && !locations.some((loc) => loc.name === c.location) && <option value={c.location}>{c.location}</option>}
                              </select>
                            ) : (
                              <input value={c.location} aria-label={`Returned location ${i + 1}`}
                                onChange={(e) => setChild(i, { location: e.target.value })} />
                            )}
                          </td>
                          <td><button className="btn btn-r" style={{ height: 24, fontSize: 11, padding: '0 6px' }} onClick={() => setChildren((cs) => (cs.length === 1 ? cs : cs.filter((_, j) => j !== i)))}>✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
                <button className="btn btn-s" onClick={() => setChildren((cs) => [...cs, blankChild()])} disabled={!selectedUnit || familyCodes.length === 0}>＋ Another roll back</button>
                {/* Issues 4.1 / 6 §11 — the running totals against the two caps, and what
                    is still available, before the button is pressed. */}
                {selectedUnit && (splitTotals.rolls > 0 || prior.rolls > 0) && (
                  <div className={'al ' + (overWidth || overWeight ? 'al-r' : 'al-g')} style={{ marginTop: 6 }} aria-label="Split totals">
                    <b>{splitTotals.rolls}</b> roll{splitTotals.rolls === 1 ? '' : 's'} back
                    {' · '}total width <b>{qty(totalWidth)} mm</b>
                    {parentWidth != null ? ` of ${qty(parentWidth)} mm` : ' (roll width unknown)'}
                    {' · '}total weight <b>{qty(totalWeight)}</b>
                    {parentWeight > 0 ? ` of ${qty(parentWeight)}` : ''} {(selectedUnit && selectedUnit.uom) || ''}
                    {remainingWeight != null && (
                      <> {' · '}remaining <b>{qty(remainingWeight)} {(selectedUnit && selectedUnit.uom) || ''}</b></>
                    )}
                    {prior.rolls > 0 && (
                      <div style={{ fontSize: 11, marginTop: 2 }}>
                        Includes {prior.rolls} roll{prior.rolls === 1 ? '' : 's'} already back off this one
                        ({qty(prior.width)} mm, {qty(prior.weight)} {(selectedUnit && selectedUnit.uom) || ''}).
                      </div>
                    )}
                    {overWidth && <div>⚠ That is wider than the roll they were cut from — a {qty(parentWidth)} mm roll
                      cuts into widths that add up to {qty(parentWidth)}, no more.</div>}
                    {overWeight && <div>⚠ That is heavier than the roll they were cut from ({qty(parentWeight)}) — the child rolls cannot weigh more than the parent.</div>}
                  </div>
                )}
              </div>
            )}
            <div className="act">
              <button className="btn btn-s" onClick={doReturn} disabled={busy}>↙ Receive return &amp; print return slip (PDF)</button>
              {lastReturn && (lastReturn.returnNos || []).map((no) => (
                <button key={no} className="btn btn-s" onClick={() => reprint(no)} aria-label={`Download return slip ${no} again`}>⬇ {no}</button>
              ))}
            </div>
          </>
        )}
      </div>

      {itemId && (
        <div className="card">
          <div className="ctitle">Rolls of this item <span className="tag tgr">{withStock.length} in stock</span></div>
          <div className="tw sy" style={{ maxHeight: 240 }}><table>
            <thead><tr><th>#</th><th>Internal Code</th><th>Location</th><th style={{ textAlign: 'right' }}>Width</th><th style={{ textAlign: 'right' }}>Remaining</th><th>Held for</th><th>Received</th><th>Status</th></tr></thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={u.id} className={num(u.qtyRemaining) <= 0 ? undefined : (i === 0 ? 'hi' : undefined)} style={num(u.qtyRemaining) <= 0 ? { opacity: 0.5 } : undefined}>
                  <td>{i + 1}</td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{u.internalCode}</td>
                  <td style={{ fontSize: 11 }}>{u.location || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{u.widthMm ? qty(u.widthMm) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{qty(u.qtyRemaining)}</td>
                  {/* P2: which orders a roll is promised to — it is theirs, not free stock */}
                  <td style={{ fontSize: 11 }}>{heldForText(u)}</td>
                  <td style={{ fontSize: 11 }}>{u.receivedAt ? String(u.receivedAt).slice(0, 10) : '—'}</td>
                  <td style={{ fontSize: 11 }}>{statusLabel(u.status)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {/* Issues 30.09 S4-S6: every slip, filterable, with the identity columns, and
          issue lines ticked here are closed to return in one go. */}
      <StoresIssueHistory txns={txns} masterItems={masterItems} onReprint={reprint} onCloseLines={closeToReturn} />
    </>
  );
}

/* ─────────────────────── SFG — semi-finished, per spec ──────────────────── */

// Everything issued from the racks against a spec's sale orders that has not
// come back: material on the shop floor, in its own unit, with how far
// production has carried it. Finished goods sit alongside in pieces — the two
// are never subtracted from one another, because they are different things.
function Sfg({ flash }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await storesApi.sfg() || []); }
    catch (e) { flash('r', e.message); }
    finally { setBusy(false); }
  }, [flash]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => [r.spec, r.customer, r.jobName].some((v) => String(v || '').toLowerCase().includes(t)));
  }, [rows, q]);

  return (
    <div className="card">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>Semi-finished goods, per spec <span className="tag tgr">{visible.length}</span></div>
        <input placeholder="Search spec / customer / job…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search SFG" style={{ minWidth: 220 }} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={load} disabled={busy}>{busy ? 'Loading…' : '↻ Refresh'}</button>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Material issued from stores against each spec&rsquo;s orders and not returned — it is on the floor until it becomes
        finished goods. Click a spec to see which orders it is sitting in.
      </div>
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 340px)' }}>
        <table>
          <thead><tr>
            <th style={{ width: 30 }}></th><th>Spec</th><th style={{ minWidth: 180 }}>Job Name</th><th>Customer</th>
            <th style={{ minWidth: 240 }}>Material on the floor</th>
            <th style={{ textAlign: 'right' }}>PO Qty</th><th style={{ textAlign: 'right' }}>FG so far</th>
          </tr></thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>
                Nothing in process — SFG appears once stores issues material against a sale order.
              </td></tr>
            ) : visible.map((r) => (
              <Fragment key={r.spec}>
                <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === r.spec ? null : r.spec)}>
                  <td style={{ textAlign: 'center', color: 'var(--i3)' }}>{open === r.spec ? '▼' : '▶'}</td>
                  <td><span className="tag tb" style={{ fontSize: 10 }}>{r.spec}</span></td>
                  <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{r.jobName || '—'}</td>
                  <td style={{ fontSize: 11 }}>{r.customer || '—'}</td>
                  <td style={{ fontSize: 11 }}>
                    {(r.materials || []).map((m, i) => (
                      <span key={i} style={{ marginRight: 10 }}>
                        <strong>{qty(m.qty)}</strong> {m.uom || ''} {m.itemCode}
                      </span>
                    ))}
                  </td>
                  <td style={{ textAlign: 'right' }}>{qty(r.poQty)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--g)', fontWeight: 700 }}>{qty(r.fgQty)}</td>
                </tr>
                {open === r.spec && (
                  <tr><td colSpan={7} style={{ background: 'var(--bg)', padding: '10px 16px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>In process</div>
                    {(r.inProcess || []).length === 0 ? (
                      <div className="pg-sub" style={{ margin: 0 }}>
                        No open production stage recorded — the material is issued but production has not booked a stage yet.
                      </div>
                    ) : (
                      <div className="tw"><table>
                        <thead><tr><th>Sale Order</th><th>Stage</th><th>Department</th>
                          <th style={{ textAlign: 'right' }}>In</th><th style={{ textAlign: 'right' }}>Completed</th>
                          <th style={{ textAlign: 'right' }}>Wastage</th><th>Status</th></tr></thead>
                        <tbody>
                          {r.inProcess.map((s2, i) => (
                            <tr key={i}>
                              <td><span className="so-pill" style={{ fontSize: 10 }}>{s2.so}</span></td>
                              <td>{s2.stage_seq}</td>
                              <td style={{ fontSize: 11 }}>{s2.department || '—'}</td>
                              <td style={{ textAlign: 'right' }}>{qty(s2.qty_in)}</td>
                              <td style={{ textAlign: 'right' }}>{qty(s2.qty_completed)}</td>
                              <td style={{ textAlign: 'right', color: 'var(--red)' }}>{qty(s2.qty_wastage)}</td>
                              <td style={{ fontSize: 11 }}>{s2.status || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
