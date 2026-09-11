import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useData } from '../data.jsx';
import { GrnEditor } from '../components/GrnAdmin.jsx';
import FgEntryPanel from '../components/FgEntryPanel.jsx';
import { storesApi, masterApi, planningApi } from '../api.js';
import { inr, today } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { parseWidthMm, itemWidthMm, unitWidthMm } from '../lib/itemWidth.js';

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
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

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
      {tab === 'fg' && <FgEntryPanel heading={false} />}
      {tab === 'pos' && <PurchaseOrders flash={flash} />}
      {tab === 'grn' && <Grn flash={flash} />}
      {tab === 'issues' && <IssuesReturns flash={flash} />}
    </div>
  );
}

/* ───────────────────────── Material on Hand (landing) ───────────────────── */

function OnHand({ flash }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
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

  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await storesApi.onHand() || []); }
    catch (e) { flash('r', e.message); }
    finally { setBusy(false); }
  }, [flash]);
  useEffect(() => { load(); }, [load]);

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
      return [r.code, r.name, r.materialType, r.subGroup, r.specialtyName].some((v) => String(v || '').toLowerCase().includes(t));
    });
  }, [rows, q, fMat, fSub, fSpec, fMic, fDept, fStatus]);

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
        MSL can be typed per item, or set for every item at once from the average of the last three months&rsquo; consumption.
      </div>

      <div className="fbar" style={{ flexWrap: 'wrap', marginBottom: 6 }}>
        <input placeholder="Search item / code…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" style={{ minWidth: 200 }} />
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
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={adoptSuggestions} disabled={!suggAny}
          title={suggAny ? 'Set each MSL to its 3-month average consumption' : 'No consumption history yet — issue material first'}>
          ⚙ Set MSL from 3-month average
        </button>
        <button className="btn btn-s" onClick={exportExcel} disabled={exporting || busy} aria-label="Export to Excel"
          title="Every roll / can of the items shown, with its location and status">
          {exporting ? 'Exporting…' : '⬇ Export to Excel'}
        </button>
        <button className="btn btn-s" onClick={load} disabled={busy}>{busy ? 'Loading…' : '↻ Refresh'}</button>
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
                    <input type="number" min="0" step="any" defaultValue={r.msl ?? ''} aria-label={`MSL for ${r.code}`}
                      onBlur={(e) => saveMsl(r, e.target.value)} style={{ width: 90, height: 24, textAlign: 'right' }} />
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
                                  {u.parentUnitId ? <span className="tag tb" style={{ fontSize: 9, marginLeft: 4 }} title="cut from another roll">split</span> : null}
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
                                  <select value={u.status || 'MOVING'} aria-label={`Status of ${u.internalCode}`}
                                    onChange={(e) => setUnitStatus(u, e.target.value)} style={{ height: 26, fontSize: 11 }}>
                                    {UNIT_STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                                  </select>
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
    </div>
  );
}

/* ─────────────────────────── Purchase Orders + ETA ──────────────────────── */

function PurchaseOrders({ flash }) {
  const { mods } = useData();
  const pos = useMemo(() => (mods.purchase && Array.isArray(mods.purchase.pos) ? mods.purchase.pos : []), [mods.purchase]);
  const [etas, setEtas] = useState([]);
  const [q, setQ] = useState('');
  const [openOnly, setOpenOnly] = useState(true);

  const load = useCallback(async () => {
    try { setEtas(await storesApi.etas() || []); } catch (e) { flash('r', e.message); }
  }, [flash]);
  useEffect(() => { load(); }, [load]);

  const etaOf = (poNum, item) => etas.find((e) => e.poNum === poNum && e.itemName === item) || null;

  async function saveEta(poNum, itemName, expectedDate) {
    try {
      await storesApi.setEta({ poNum, itemName, expectedDate });
      await load();
      flash('g', `${itemName} on ${poNum} expected ${expectedDate || '—'}. The planner sees this against not-ready orders.`);
    } catch (e) { flash('r', e.message); }
  }

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const out = [];
    pos.forEach((po) => {
      if (openOnly && String(po.status || '').toLowerCase() === 'closed') return;
      (po.items || []).forEach((it, i) => {
        if (t && ![po.poNum, po.supplier, it.item].some((v) => String(v || '').toLowerCase().includes(t))) return;
        out.push({ po, it, key: po.poNum + '|' + i });
      });
    });
    return out;
  }, [pos, q, openOnly]);

  return (
    <div className="card">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>Purchase orders raised by Purchase <span className="tag tgr">{rows.length}</span></div>
        <input placeholder="Search PO / supplier / item…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search purchase orders" style={{ minWidth: 220 }} />
        <label className="cb" style={{ fontSize: 12 }}>
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          <span>Open POs only</span>
        </label>
      </div>
      <div className="al al-b">
        Put the date each material will actually reach the plant. The <strong>PLAN</strong> login shows that date against the
        sale orders it has marked <em>not ready — plates / material / others</em>, so the planner knows when the order can be planned.
      </div>
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 340px)' }}>
        <table>
          <thead><tr>
            <th>PO #</th><th>PO Date</th><th>Supplier</th><th style={{ minWidth: 200 }}>Item</th>
            <th style={{ textAlign: 'right' }}>Ordered</th><th style={{ textAlign: 'right' }}>Received</th>
            <th>Status</th><th style={{ width: 160 }}>Expected on</th><th>Told by</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No purchase orders to show</td></tr>
            ) : rows.map(({ po, it, key }) => {
              const eta = etaOf(po.poNum, it.item);
              return (
                <tr key={key}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{po.poNum}</td>
                  <td style={{ fontSize: 11 }}>{po.poDate || '—'}</td>
                  <td style={{ fontSize: 11 }}>{po.supplier || '—'}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{it.item}</td>
                  <td style={{ textAlign: 'right' }}>{qty(it.qty)} {it.unit || ''}</td>
                  <td style={{ textAlign: 'right', color: 'var(--g)' }}>{qty(it.receivedQty || 0)}</td>
                  <td><span className={'tag ' + (String(po.status).toLowerCase() === 'closed' ? 'tg' : 'ty')} style={{ fontSize: 9 }}>{po.status || 'Open'}</span></td>
                  <td>
                    <input type="date" defaultValue={eta ? eta.expectedDate || '' : ''}
                      aria-label={`Expected date for ${it.item} on ${po.poNum}`}
                      onBlur={(e) => { const v = e.target.value; if (v !== (eta ? eta.expectedDate || '' : '')) saveEta(po.poNum, it.item, v); }}
                      style={{ height: 26, fontSize: 11 }} />
                  </td>
                  <td style={{ fontSize: 10, color: 'var(--i3)' }}>{eta ? eta.actor || '—' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
  const { mods } = useData();
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
    if (masterRow && ok(masterRow, 'materialType', fMat) && ok(masterRow, 'subGroup', fSub)
      && ok(masterRow, 'specialtyName', fSpec)) return true;
    return (aslByCode.get(norm(code)) || []).some((r) => (
      ok(r, 'materialType', fMat) && ok(r, 'subGroup', fSub) && ok(r, 'speciality', fSpec)
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
  // A typed PO number still pulls up its lines to check against, when it matches one.
  const chosenPo = useMemo(() => pos.find((p) => String(p.poNum || '').trim().toLowerCase() === String(head.poNum || '').trim().toLowerCase()) || null, [pos, head.poNum]);

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
      flash('g', `✓ ${r.grnNo} received — print stickers for ${codes}.`);
      setHead({ grnNo: '', poNum: '', supplier: '', grnDate: today(), invoiceNo: '', invoiceDate: '', notes: '' });
      setLines([blankLine()]);
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
          {/* §10: PO generation is not automated yet, so this is a plain note — type
              the number if there is one, leave it blank if there is not. The supplier's
              own PO numbers are offered, so it is picked rather than remembered. */}
          <div className="fg"><label>PO Number <span style={{ fontWeight: 400, color: 'var(--i3)' }}>(optional)</span></label>
            <input value={head.poNum} onChange={(e) => setHead({ ...head, poNum: e.target.value })}
              list="grn-po-numbers" placeholder="PO number, if any" aria-label="Purchase order" />
            <datalist id="grn-po-numbers">
              {pos.filter((p) => !head.supplier || String(p.supplier || '').trim().toLowerCase() === String(head.supplier).trim().toLowerCase())
                .map((p) => <option key={p.poNum} value={p.poNum} />)}
            </datalist>
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
              onChange={(e) => { setHead({ ...head, supplier: e.target.value }); setLines([blankLine()]); }}>
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
            {(chosenPo.items || []).map((it, i) => (
              <span key={i}>{it.item} — {qty(it.qty)} {it.unit || ''} @ ₹{num(it.rate).toFixed(2)}</span>
            ))}
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
                      {narrowed.map((it) => <option key={it.id} value={it.id}>{it.name} · {it.code}</option>)}
                      {l.itemId && !narrowed.some((it) => String(it.id) === String(l.itemId)) && (
                        <option value={l.itemId}>{(itemById(l.itemId) || {}).name} · {(itemById(l.itemId) || {}).code}</option>
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

function IssuesReturns({ flash }) {
  const { mods } = useData();
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('');
  const [units, setUnits] = useState([]);
  const [txns, setTxns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ unitId: '', qty: '', so: '', department: '', note: '' });
  const [split, setSplit] = useState(false);
  // Issues 4.1 — a returned roll row is now "N rolls, each W mm wide and K kg", which
  // is how the desk says it out loud, and is what makes the two caps below checkable.
  const [children, setChildren] = useState([blankChild()]);
  // Issues 3.1: department, sale order, split width and location are all pickers
  // here now. Typed free-hand they drifted — "Printing", "printing", "PRINTING" —
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
  // Stores 5.1: "once a sale order is selected, then based on the sale order root,
  // the departments dropdown will be populated" — the route's stages for that SO.
  const [soRoute, setSoRoute] = useState(null);   // { so, departments: [names] } | null
  // Stores 5.1: "I would want the internal code to be shown so that I'll be able to
  // write it on the roll" — the numbers the returned rolls will get.
  const [nextCodes, setNextCodes] = useState([]);

  const loadNextCodes = useCallback(async () => {
    try { setNextCodes(((await storesApi.nextCodes(40)) || {}).codes || []); } catch { setNextCodes([]); }
  }, []);

  useEffect(() => {
    let live = true;
    masterApi.listDepartments()
      .then((r) => { if (live && Array.isArray(r)) setDepartments(r); })
      .catch(() => { /* master unreachable - the box falls back to free text */ });
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

  /* ── the sale order comes first, and its route names the departments ── */

  const openSos = useMemo(() => {
    const oab = (mods.oab && mods.oab.OAB) || {};
    return ['SF', 'OT'].flatMap((k) => (oab[k] || []).filter((r) => !r.closed).map((r) => r.so)).filter(Boolean);
  }, [mods.oab]);
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
    if (!so) { setSoRoute(null); return undefined; }
    let live = true;
    planningApi.soPlan(so)
      .then((p) => {
        if (!live) return;
        const names = ((p && p.departments) || []).map((d) => d.departmentName).filter(Boolean);
        setSoRoute({ so, departments: [...new Set(names)] });
      })
      .catch(() => { if (live) setSoRoute({ so, departments: [] }); });
    return () => { live = false; };
  }, [form.so]);

  // The departments offered: the SO's route when it has one, else the whole master.
  const routeDepts = soRoute && soRoute.so === String(form.so || '').trim() ? soRoute.departments : [];
  const deptOptions = routeDepts.length ? routeDepts : departments.map((d) => d.name);
  const deptFromRoute = routeDepts.length > 0;
  // A department chosen for one order does not silently carry over to another whose
  // route does not go through it.
  useEffect(() => {
    if (deptFromRoute && form.department && !routeDepts.includes(form.department)) {
      setForm((f) => ({ ...f, department: '' }));
    }
  }, [deptFromRoute, routeDepts, form.department]);

  /* ── the material: type → sub-group → speciality → item code ── */

  useEffect(() => { storesApi.onHand().then((r) => setItems((r || []).filter((x) => num(x.closingStock) > 0 || x.unitCount > 0))).catch(() => {}); }, []);

  const norm = (v) => String(v || '').trim().toLowerCase();
  /** Each picker offers only what the other two leave — the same narrowing as the board. */
  const opts = (key) => {
    const chosen = { materialType: fMat, subGroup: fSub, specialtyName: fSpec };
    const pool = items.filter((r) => Object.keys(chosen).every((k) => k === key || !chosen[k] || norm(r[k]) === norm(chosen[k])));
    const set = new Set(pool.map((r) => String(r[key] || '').trim()).filter(Boolean));
    if (chosen[key]) set.add(chosen[key]);
    return [...set].sort((a, b) => a.localeCompare(b));
  };
  const visibleItems = useMemo(() => items.filter((r) => (
    (!fMat || norm(r.materialType) === norm(fMat))
    && (!fSub || norm(r.subGroup) === norm(fSub))
    && (!fSpec || norm(r.specialtyName) === norm(fSpec))
  )), [items, fMat, fSub, fSpec]);
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

  const loadTxns = useCallback(async () => {
    try { setTxns((await storesApi.txns({ limit: 50 })) || []); } catch { /* history is best-effort */ }
  }, []);
  useEffect(() => { loadTxns(); }, [loadTxns]);

  const selectedUnit = units.find((u) => String(u.id) === String(form.unitId)) || null;
  const withStock = units.filter((u) => num(u.qtyRemaining) > 0);

  /* ── Issues 4.1: a slit roll cannot come back bigger than it went out ────────
     "The total width should not be more than the initial film width", and the same
     for weight. Both caps come off the PARENT roll: the width stamped on it when it
     was received, or failing that its item's Width (mm); and the weight it was
     received at. An unknown cap is not enforced — a roll booked before either field
     existed must still be returnable — and the panel says so rather than pretending. */
  const chosenItem = useMemo(() => items.find((it) => String(it.id) === String(itemId)) || null, [items, itemId]);
  const chosenMaster = useMemo(() => {
    const code = norm((chosenItem || {}).code);
    return code ? masterItems.find((it) => norm(it.code) === code) || null : null;
  }, [masterItems, chosenItem]);
  const parentWidth = selectedUnit ? unitWidthMm(selectedUnit, chosenMaster || chosenItem) : null;
  const parentWeight = selectedUnit ? num(selectedUnit.qtyReceived) : 0;

  /**
   * Stores 5.1 — the widths a returned roll may be cut to, and the item code each
   * one is. "If I give a 1,200 mm anti-fog BOPP roll, I will get two rolls of
   * 700 mm x 500 mm or 600 mm x 600 mm anti-fog BOPP rolls only … It is not possible
   * for me to get 600 mm x 600 mm rolls of LDPE." So the list is the widths of the
   * item codes in the SAME material / sub-group / speciality as the roll being
   * returned — the Item Master's own mapping of available widths — no wider than
   * the parent. Each width carries its code, so picking the width books the roll
   * under it. A family with no widths on file falls back to every width the
   * business has a code for, so the desk is never stranded.
   */
  const familyWidths = useMemo(() => {
    const base = chosenMaster || chosenItem;
    const pool = masterItems.length ? masterItems : items;
    const same = (a, b) => norm(a) === norm(b);
    const specOf = (it) => norm(it.specialtyName ?? it.specialty);
    // The family is the sub-group ("anti-fog BOPP") within the material type. A
    // speciality narrows it only when both sides name one and they differ — a code
    // with no speciality on file is still the same film.
    const family = base ? pool.filter((it) => same(it.materialType, base.materialType)
      && same(it.subGroup, base.subGroup)
      && (!specOf(it) || !specOf(base) || specOf(it) === specOf(base))) : [];
    const list = (family.length ? family : pool)
      .map((it) => ({ width: itemWidthMm(it), item: it }))
      .filter((x) => x.width != null && x.width > 0)
      .filter((x) => parentWidth == null || x.width <= parentWidth + 1e-6);
    // one entry per width — the first code wins, the rest are named in the title
    const byWidth = new Map();
    list.forEach((x) => {
      const k = String(x.width);
      if (!byWidth.has(k)) byWidth.set(k, { width: x.width, items: [] });
      byWidth.get(k).items.push(x.item);
    });
    // Widths already on this item's rolls stay offered (a roll booked before the
    // master carried widths); with no code of their own they book under the parent's.
    units.forEach((u) => {
      const w = num(u.widthMm);
      if (w > 0 && (parentWidth == null || w <= parentWidth + 1e-6) && !byWidth.has(String(w))) byWidth.set(String(w), { width: w, items: [] });
    });
    return { fromFamily: family.length > 0, widths: [...byWidth.values()].sort((a, b) => a.width - b.width) };
  }, [masterItems, items, units, chosenMaster, chosenItem, parentWidth]);
  const knownWidths = familyWidths.widths.map((w) => String(w.width));
  const itemForWidth = (w) => { const hit = familyWidths.widths.find((x) => String(x.width) === String(w)); return hit ? hit.items[0] : null; };

  /** What the rows below come to — and which of them are half-filled. */
  const splitTotals = useMemo(() => {
    let rolls = 0, width = 0, weight = 0, incomplete = false;
    children.forEach((c) => {
      const n = Math.floor(num(c.rolls));
      const w = parseWidthMm(c.widthMm);
      const kg = num(c.weightKg);
      if (!n && w === null && !kg) return;          // an untouched spare row
      if (n <= 0 || w === null || kg <= 0) { incomplete = true; return; }
      rolls += n; width += n * w; weight += n * kg;
    });
    return { rolls, width, weight, incomplete };
  }, [children]);
  /**
   * What this roll has ALREADY produced. The rule is cumulative — "the cumulative
   * weight of the child rolls from one parent roll" — so a roll slit 700 mm today
   * and 600 mm tomorrow has produced 1300 mm off a 1200 mm parent, even though
   * neither return broke the cap on its own. The server counts the same way; this
   * is here so the screen agrees with it instead of promising a save that fails.
   * Stores 5.1: the roll carries its own totals now (its children may be booked
   * under other item codes); older rows without them are added up from the list.
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

  async function doIssue() {
    if (!form.unitId || num(form.qty) <= 0) { flash('r', 'Pick a roll and enter the quantity to issue.'); return; }
    setBusy(true);
    try {
      await storesApi.issue({ unitId: Number(form.unitId), qty: Number(form.qty), so: form.so || undefined, department: form.department || undefined, note: form.note || undefined });
      flash('g', `Issued ${form.qty} from ${selectedUnit ? selectedUnit.internalCode : 'the roll'}${form.so ? ' to ' + form.so : ''}${form.department ? ' (' + form.department + ')' : ''}.`);
      setForm((f) => ({ ...f, qty: '', note: '' }));
      await loadUnits(itemId); await loadTxns();
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  async function doReturn() {
    if (!form.unitId) { flash('r', 'Pick the roll the material went out on.'); return; }
    const body = { unitId: Number(form.unitId), so: form.so || undefined, department: form.department || undefined, note: form.note || undefined };
    if (split) {
      // A half-filled row first: it is the commonest slip, and "enter at least one
      // returned roll" is the wrong thing to say to someone who has entered three
      // quarters of one.
      if (splitTotals.incomplete) {
        flash('r', 'Every returned roll needs a count, a width and a weight — one of the rows below is half filled in.');
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
        if (n <= 0 || w === null || kg <= 0) return;
        const item = c.itemId ? c.itemId : (itemForWidth(w) || {}).id;
        for (let k = 0; k < n; k++) {
          kids.push({
            qty: kg, widthMm: w,
            internalCode: n === 1 && c.internalCode ? c.internalCode : undefined,
            location: c.location || undefined, status: 'RETURNED',
            // Stores 5.1: the item code of that width, when the master has one.
            itemId: item ? Number(item) : undefined,
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
      flash('g', split
        ? `Returned as ${(r.returned || []).length} roll(s): ${(r.returned || []).map((x) => x.internalCode).join(', ')} — write these on the rolls. The original roll is now zero.`
        : `Returned ${form.qty} to ${selectedUnit ? selectedUnit.internalCode : 'the roll'}.`);
      setForm((f) => ({ ...f, qty: '', note: '' }));
      setChildren([blankChild()]);
      setSplit(false);
      await loadUnits(itemId); await loadTxns(); await loadNextCodes();
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  const itemDesc = (chosenItem || {}).name || '';

  return (
    <>
      <div className="card">
        <div className="ctitle">🔄 Issue to the shop floor / receive a return</div>
        <div className="al al-b">
          Rolls are listed oldest first — <strong>issue from the top</strong> (FIFO). Issues and returns move the closing
          stock on the Material on Hand board immediately.
        </div>

        {/* Stores 5.1: "the first selection should be for Sale Order and then … the
            departments dropdown will be populated [from the sale order route] and per
            department I should be able to allocate the material." */}
        <div className="ctitle" style={{ fontSize: 11, margin: '6px 0 2px' }}>① The order and the department</div>
        <div className="g4">
          <div className="fg">
            <label>Sale order {soFromPlan ? <span style={{ fontWeight: 400, color: 'var(--i3)' }}>(planned)</span> : null}</label>
            {/* Every open order, today's planned ones first and marked; with no list
                readable it falls back to a plain box rather than leaving the desk
                unable to say which order the material went to. */}
            {soOptions.length ? (
              <select value={form.so} onChange={(e) => setForm({ ...form, so: e.target.value, department: '' })} aria-label="Sale order">
                <option value="">— none —</option>
                {soOptions.map((v) => <option key={v} value={v}>{v}{plannedSet.has(v) ? ' · planned today' : ''}</option>)}
                {form.so && !soOptions.includes(form.so) && <option value={form.so}>{form.so}</option>}
              </select>
            ) : (
              <input value={form.so} onChange={(e) => setForm({ ...form, so: e.target.value })}
                aria-label="Sale order" placeholder={plannedSos === null ? 'type the SO' : 'nothing planned today — type the SO'} />
            )}
            <div className="pg-sub" style={{ margin: '3px 0 0' }}>
              {SO_SOURCE === 'planned'
                ? 'Only sale orders PPC has planned are offered.'
                : `All open sale orders${plannedSet.size ? `; ${plannedSet.size} planned today are listed first` : ''}.`}
            </div>
          </div>
          <div className="fg">
            <label>Department {deptFromRoute ? <span style={{ fontWeight: 400, color: 'var(--i3)' }}>(from the route of {form.so})</span> : null}</label>
            {deptOptions.length ? (
              <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} aria-label="Department">
                <option value="">— none —</option>
                {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                {form.department && !deptOptions.includes(form.department) && <option value={form.department}>{form.department}</option>}
              </select>
            ) : (
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} aria-label="Department" placeholder="e.g. Printing" />
            )}
            {form.so && soRoute && soRoute.so === String(form.so).trim() && !deptFromRoute && (
              <div className="pg-sub" style={{ margin: '3px 0 0', color: '#B7770D' }}>
                No route on file for {form.so} yet — every department is offered.
              </div>
            )}
          </div>
          <div className="fg"><label>Note</label><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label="Note" /></div>
        </div>

        {/* Stores 5.1: "the next items should be: Material, Subgroup, Specialty,
            including the item code. All of these should be the dropdown selections." */}
        <div className="ctitle" style={{ fontSize: 11, margin: '4px 0 2px' }}>② The material</div>
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
          <div className="fg"><label>Item code <span style={{ fontWeight: 400, color: 'var(--i3)' }}>({visibleItems.length} in stock)</span></label>
            <select value={itemId} onChange={(e) => chooseItem(e.target.value)} aria-label="Item">
              <option value="">— select an item code —</option>
              {visibleItems.map((it) => <option key={it.id} value={it.id}>{it.code}</option>)}
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
            <select value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} aria-label="Roll">
              <option value="">— select a roll —</option>
              {units.map((u, i) => (
                <option key={u.id} value={u.id}>
                  {i === 0 && num(u.qtyRemaining) > 0 ? '① ' : ''}{u.internalCode} · {qty(u.qtyRemaining)} {u.uom || ''}{u.widthMm ? ` · ${qty(u.widthMm)}mm` : ''}{u.location ? ` · ${u.location}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="fg"><label>Quantity</label>
            <input type="number" step="any" min="0" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}
              aria-label="Quantity" disabled={split} placeholder={selectedUnit ? `max ${qty(selectedUnit.qtyRemaining)}` : ''} />
          </div>
          <div className="fg"><label>Internal code</label>
            <input value={selectedUnit ? selectedUnit.internalCode : ''} readOnly tabIndex={-1} aria-label="Internal code of the roll"
              placeholder="pick a roll" style={{ background: 'var(--bg)', color: 'var(--blu)', fontFamily: 'monospace', fontWeight: 700, cursor: 'not-allowed' }} />
          </div>
        </div>

        <label className="cb" style={{ fontSize: 12, marginTop: 4 }}>
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} aria-label="Returned as narrower rolls" />
          <span>The roll came back cut into narrower rolls</span>
        </label>
        {split && (
          <div style={{ marginTop: 6 }}>
            <div className="pg-sub" style={{ marginTop: 0 }}>
              A 1200&nbsp;mm roll issued and returned as 700 + 500&nbsp;mm: enter each returned roll below. Each becomes its own
              roll with its own sticker, and the original roll is left at zero. Say how many rolls of each width came
              back and what one of them weighs — <strong>the widths and the weights cannot add up to more than the roll
              they were cut from</strong>. The width list is the item codes of the same material, sub-group and speciality,
              and the roll is booked under the code of its width.
            </div>
            {/* Issues 3.1: the parent-child link, said out loud — every roll entered
                below is recorded as having come off this one. */}
            {selectedUnit && (
              <div className="al al-b" style={{ margin: '6px 0' }}>
                Cut from <b>{selectedUnit.internalCode}</b>
                {chosenItem ? ` (${chosenItem.code})` : ''}
                {parentWidth != null ? ` · ${qty(parentWidth)} mm` : ''}
                {parentWeight > 0 ? ` · ${qty(parentWeight)} ${selectedUnit.uom || ''}` : ''}
                {selectedUnit.location ? ` · ${selectedUnit.location}` : ''} — each roll below is linked back to it.
                {parentWidth == null && (
                  /* Issues 4.1: no width on the roll and none on its item, so the width
                     rule has nothing to check against. Say so — silently not enforcing
                     it is how a 700 + 600 gets booked against a 1200. */
                  <div style={{ fontSize: 11, color: '#B7770D', marginTop: 3 }}>
                    No width on file for this roll or its item, so the total width cannot be checked. Set the item&rsquo;s
                    Width (mm) on the Padmin Item Master.
                  </div>
                )}
                {!familyWidths.fromFamily && knownWidths.length > 0 && (
                  <div style={{ fontSize: 11, color: '#B7770D', marginTop: 3 }}>
                    No other item code shares this roll&rsquo;s material, sub-group and speciality — every width on file is offered.
                  </div>
                )}
              </div>
            )}
            <div className="tw"><table>
              <thead><tr>
                <th style={{ width: 80 }}>Rolls *</th><th style={{ width: 150 }}>Width (mm) *</th>
                <th style={{ width: 120 }}>Item code</th>
                {/* Issues 4.1 — "there should be one more field for the child rolls'
                    weight". One roll's weight, so N rolls of it is N × this, and the
                    cumulative figure can be held against the parent roll's weight. */}
                <th style={{ width: 130 }}>Weight each *</th>
                <th>Internal code</th><th style={{ width: 150 }}>Location</th><th style={{ width: 40 }}></th>
              </tr></thead>
              <tbody>
                {children.map((c, i) => {
                  const codes = projectedCodes(i);
                  const n = Math.floor(num(c.rolls));
                  const codeItem = c.itemId ? (masterItems.find((it) => String(it.id) === String(c.itemId))
                    || items.find((it) => String(it.id) === String(c.itemId))) : null;
                  return (
                    <tr key={i}>
                      <td><input type="number" step="1" min="1" className="nospin" value={c.rolls}
                        aria-label={`Returned rolls ${i + 1}`} placeholder="1"
                        onChange={(e) => setChild(i, { rolls: e.target.value })} /></td>
                      <td>
                        {/* Issues 3.1: item codes are allocated by width, so a returned
                            roll may only be cut to a width already on file. A width that
                            is missing is the Super Admin's to add, not the desk's.
                            Stores 5.1: the list is the roll's own material family, and
                            picking a width picks its item code. */}
                        {knownWidths.length ? (
                          <>
                            <select value={c._other ? '__other__' : c.widthMm} aria-label={`Returned width ${i + 1}`} style={{ width: '100%' }}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '__other__') setChild(i, { _other: true, widthMm: '', itemId: '' });
                                else setChild(i, { _other: false, widthMm: v, itemId: (itemForWidth(v) || {}).id || '' });
                              }}>
                              <option value="">— width —</option>
                              {familyWidths.widths.map((w) => (
                                <option key={w.width} value={String(w.width)} title={w.items.map((it) => it.code).join(', ')}>
                                  {w.width} mm{w.items.length ? ` · ${w.items[0].code}` : ''}{w.items.length > 1 ? ` (+${w.items.length - 1})` : ''}
                                </option>
                              ))}
                              {c.widthMm && !c._other && !knownWidths.includes(String(c.widthMm)) && <option value={c.widthMm}>{c.widthMm} mm</option>}
                              <option value="__other__">＋ Other width…</option>
                            </select>
                            {c._other && (
                              <>
                                <input type="number" step="any" min="0" value={c.widthMm} className="nospin"
                                  aria-label={`Returned width ${i + 1} other`} placeholder="mm" style={{ marginTop: 3 }}
                                  onChange={(e) => setChild(i, { widthMm: e.target.value, itemId: '' })} />
                                <div style={{ fontSize: 9, color: '#B7770D', marginTop: 2 }}>
                                  No item code for this width yet — booked under {chosenItem ? chosenItem.code : 'the parent roll’s code'}; ask the Super Admin to add one.
                                </div>
                              </>
                            )}
                          </>
                        ) : (
                          <input type="number" step="any" min="0" value={c.widthMm} aria-label={`Returned width ${i + 1}`}
                            onChange={(e) => setChild(i, { widthMm: e.target.value })} />
                        )}
                      </td>
                      <td>
                        {/* Stores 5.1: "Based on that selection I want the item code also
                            to be populated." Read-only: it follows the width. */}
                        <input value={codeItem ? codeItem.code : (c.widthMm && chosenItem ? chosenItem.code : '')} readOnly tabIndex={-1}
                          aria-label={`Returned item code ${i + 1}`} placeholder="from the width"
                          title={codeItem ? codeItem.name : (c.widthMm && chosenItem ? 'No code for this width — stays under the parent roll’s item' : '')}
                          style={{ background: 'var(--bg)', color: codeItem ? 'var(--blu)' : 'var(--i3)', fontFamily: 'monospace', fontWeight: 700, cursor: 'not-allowed' }} />
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
                        {/* Stores 5.1: the sticker number(s) this row will get, so they
                            can be written on the rolls now; fixed when Receive return
                            is pressed, and repeated in the confirmation. */}
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
                        {/* Issues 3.1: the rack is picked from the Super Admin's list, the
                            same list the GRN puts material away into. */}
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
            <button className="btn btn-s" onClick={() => setChildren((cs) => [...cs, blankChild()])}>＋ Another roll back</button>
            {/* Issues 4.1 — the two running totals, against the two caps, before the
                button is pressed. The desk should not have to submit to find out that
                700 + 600 does not come off a 1200. */}
            {splitTotals.rolls > 0 && (
              <div className={'al ' + (overWidth || overWeight ? 'al-r' : 'al-g')} style={{ marginTop: 6 }}>
                <b>{splitTotals.rolls}</b> roll{splitTotals.rolls === 1 ? '' : 's'} back
                {' · '}total width <b>{qty(totalWidth)} mm</b>
                {parentWidth != null ? ` of ${qty(parentWidth)} mm` : ' (roll width unknown)'}
                {' · '}total weight <b>{qty(totalWeight)}</b>
                {parentWeight > 0 ? ` of ${qty(parentWeight)}` : ''} {(selectedUnit && selectedUnit.uom) || ''}
                {prior.rolls > 0 && (
                  <div style={{ fontSize: 11, marginTop: 2 }}>
                    Includes {prior.rolls} roll{prior.rolls === 1 ? '' : 's'} already back off this one
                    ({qty(prior.width)} mm, {qty(prior.weight)} {(selectedUnit && selectedUnit.uom) || ''}).
                  </div>
                )}
                {overWidth && <div>⚠ That is wider than the roll they were cut from — a {qty(parentWidth)} mm roll
                  cuts into widths that add up to {qty(parentWidth)}, no more.</div>}
                {overWeight && <div>⚠ That is heavier than the roll they were cut from ({qty(parentWeight)}).</div>}
              </div>
            )}
          </div>
        )}

        <div className="act">
          <button className="btn btn-g" onClick={doIssue} disabled={busy || split}>↗ Issue</button>
          <button className="btn btn-s" onClick={doReturn} disabled={busy}>↙ Receive return</button>
        </div>
      </div>

      {itemId && (
        <div className="card">
          <div className="ctitle">Rolls of this item <span className="tag tgr">{withStock.length} in stock</span></div>
          <div className="tw sy" style={{ maxHeight: 240 }}><table>
            <thead><tr><th>#</th><th>Internal Code</th><th>Location</th><th style={{ textAlign: 'right' }}>Width</th><th style={{ textAlign: 'right' }}>Remaining</th><th>Received</th><th>Status</th></tr></thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={u.id} className={num(u.qtyRemaining) <= 0 ? undefined : (i === 0 ? 'hi' : undefined)} style={num(u.qtyRemaining) <= 0 ? { opacity: 0.5 } : undefined}>
                  <td>{i + 1}</td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{u.internalCode}</td>
                  <td style={{ fontSize: 11 }}>{u.location || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{u.widthMm ? qty(u.widthMm) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{qty(u.qtyRemaining)}</td>
                  <td style={{ fontSize: 11 }}>{u.receivedAt ? String(u.receivedAt).slice(0, 10) : '—'}</td>
                  <td style={{ fontSize: 11 }}>{statusLabel(u.status)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <div className="card">
        <div className="ctitle">Recent issues &amp; returns <span className="tag tgr">{txns.length}</span></div>
        <div className="tw sy" style={{ maxHeight: 280 }}><table>
          <thead><tr><th>When</th><th>Kind</th><th>Item</th><th>Roll</th><th style={{ textAlign: 'right' }}>Qty</th><th>Sale order</th><th>Department</th><th>By</th></tr></thead>
          <tbody>
            {txns.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>Nothing issued yet</td></tr>
              : txns.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontSize: 11 }}>{t.ts ? String(t.ts).slice(0, 10) : '—'}</td>
                  <td><span className={'tag ' + (t.kind === 'ISSUE' ? 'ty' : 'tg')} style={{ fontSize: 9 }}>{t.kind === 'ISSUE' ? 'Issue' : 'Return'}</span></td>
                  <td style={{ fontSize: 11 }}>{t.itemCode}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{t.internalCode}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{qty(t.qty)}</td>
                  <td style={{ fontSize: 11 }}>{t.so || '—'}</td>
                  <td style={{ fontSize: 11 }}>{t.department || '—'}</td>
                  <td style={{ fontSize: 10, color: 'var(--i3)' }}>{t.actor || '—'}</td>
                </tr>
              ))}
          </tbody>
        </table></div>
      </div>
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
