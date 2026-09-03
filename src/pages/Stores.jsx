import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { storesApi, masterApi } from '../api.js';
import { inr, today } from '../lib/format.js';

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
      {tab === 'fg' && <Fg flash={flash} />}
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
  const [open, setOpen] = useState(null);        // itemId whose units are expanded
  const [units, setUnits] = useState([]);
  const [unitsBusy, setUnitsBusy] = useState(false);
  // The MSL the last three months' consumption implies, shown beside the one in
  // force. Manual entry stays; this is the "going forward" automatic figure.
  const [sugg, setSugg] = useState({});
  const [suggAny, setSuggAny] = useState(false);

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
      if (!t) return true;
      return [r.code, r.name, r.materialType, r.subGroup, r.specialtyName].some((v) => String(v || '').toLowerCase().includes(t));
    });
  }, [rows, q, fMat, fSub, fSpec, fMic, fDept]);

  const totals = useMemo(() => ({
    items: visible.length,
    below: visible.filter((r) => r.belowMsl).length,
    value: visible.reduce((t, r) => t + num(r.stockValue), 0),
  }), [visible]);

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

  return (
    <div className="card">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>Material on hand <span className="tag tgr">{totals.items}</span></div>
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
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={adoptSuggestions} disabled={!suggAny}
          title={suggAny ? 'Set each MSL to its 3-month average consumption' : 'No consumption history yet — issue material first'}>
          ⚙ Set MSL from 3-month average
        </button>
        <button className="btn btn-s" onClick={load} disabled={busy}>{busy ? 'Loading…' : '↻ Refresh'}</button>
      </div>

      <div className="stats" style={{ marginBottom: 8 }}>
        <div className="stat"><div className="sl">Items listed</div><div className="sv">{totals.items}</div></div>
        <div className="stat"><div className="sl">Below MSL</div><div className="sv" style={{ color: totals.below ? 'var(--red)' : undefined }}>{totals.below}</div></div>
        <div className="stat"><div className="sl">Stock value</div><div className="sv">{inr(Math.round(totals.value))}</div></div>
      </div>

      <div className="pg-sub" style={{ marginTop: 0 }}>
        Closing stock is the sum of the rolls / cans actually in the racks — click a row to see them, their location and their status.
        MSL can be typed per item, or set for every item at once from the average of the last three months&rsquo; consumption.
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
    } catch (e) { flash('r', e.message); }
  }, [flash]);
  useEffect(() => { load(); }, [load]);

  const distinct = (arr, f) => [...new Set(arr.map((x) => String(x[f] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  /** The items matching the material / sub-group / speciality pickers alone. */
  const byFilters = useMemo(() => items.filter((it) => (
    (!fMat || String(it.materialType || '') === fMat)
    && (!fSub || String(it.subGroup || '') === fSub)
    && (!fSpec || String(it.specialtyName || '') === fSpec)
  )), [items, fMat, fSub, fSpec]);

  const narrowed = useMemo(() => byFilters.filter((it) => (
    // §12: one GRN covers one supplier, so once that supplier is chosen only the
    // items they are approved for can be received against it.
    !itemCodesForSupplier || !itemCodesForSupplier.size
      || itemCodesForSupplier.has(String(it.code || '').trim().toLowerCase())
  )), [byFilters, itemCodesForSupplier]);

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
    const codes = new Set(byFilters.map((it) => String(it.code || '').trim().toLowerCase()).filter(Boolean));
    if (!codes.size) return null;
    const names = new Set();
    asl.forEach((r) => {
      if (!codes.has(String(r.itemCode || '').trim().toLowerCase())) return;
      const v = String(r.company || '').trim();
      if (v) names.add(v);
    });
    return names.size ? [...names].sort((a, b) => a.localeCompare(b)) : null;
  }, [asl, byFilters, fMat, fSub, fSpec]);

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

  function pickItem(i, id) {
    const it = itemById(id);
    // §11: the UOM is the item master's, and is shown read-only — a hand-typed unit
    // on a receipt silently changes what the stock figure means.
    setLine(i, { itemId: id, uom: (it && it.uom) || '' });
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
          widthMm: l.widthMm === '' ? undefined : Number(l.widthMm),
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
        <div className="ctitle" style={{ fontSize: 11, margin: '4px 0 2px' }}>① What arrived</div>
        <div className="g4">
          <div className="fg"><label>Material Type</label>
            <select value={fMat} onChange={(e) => { setFMat(e.target.value); setFSub(''); setFSpec(''); }} aria-label="Material type filter">
              <option value="">Any material</option>{distinct(items, 'materialType').map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="fg"><label>Sub Group</label>
            <select value={fSub} onChange={(e) => setFSub(e.target.value)} aria-label="Sub group filter">
              <option value="">Any sub-group</option>{distinct(items.filter((i) => !fMat || i.materialType === fMat), 'subGroup').map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          {/* §14: the same intelligent narrowing as the stock filters — speciality
              lists only what the chosen material and sub-group actually come in. */}
          <div className="fg"><label>Speciality</label>
            <select value={fSpec} onChange={(e) => setFSpec(e.target.value)} aria-label="Speciality filter">
              <option value="">Any speciality</option>
              {distinct(items.filter((i) => (!fMat || i.materialType === fMat) && (!fSub || i.subGroup === fSub)), 'specialtyName')
                .map((v) => <option key={v} value={v}>{v}</option>)}
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
          </div>
        </div>

        <div className="ctitle" style={{ fontSize: 11, margin: '10px 0 2px' }}>② The paperwork</div>
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
        <div className="tw"><table style={{ minWidth: 1255, tableLayout: 'fixed' }}>
          <thead><tr>
            <th style={{ width: 240 }}>Item *</th><th style={{ width: 130 }}>Supplier Label Code</th>
            <th style={{ width: 120 }}>Internal Code</th>
            {/* Issues 2.7: Qty and Price are the two numbers the stores desk types on
                every line, so they get the same comfortable width and neither is
                cramped. The stepper arrows are gone (.nospin), which is where most of
                the room came from — the table itself is no wider than before. */}
            <th style={{ width: 128 }}>Qty *</th><th style={{ width: 70 }}>UOM</th>
            <th style={{ width: 110 }}>Width (mm)</th><th style={{ width: 128 }}>Price</th><th style={{ width: 140 }}>Location</th>
            <th style={{ width: 145 }}>Expiry</th><th style={{ width: 44 }}></th>
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
                    <select value={l.itemId} onChange={(e) => pickItem(i, e.target.value)} aria-label={`Item for line ${i + 1}`} style={{ width: '100%' }}
                      disabled={!head.supplier}>
                      <option value="">{head.supplier ? '— select an item —' : '— choose a supplier first —'}</option>
                      {narrowed.map((it) => <option key={it.id} value={it.id}>{it.code} — {it.name}</option>)}
                    </select>
                    {unmapped && (
                      <div style={{ fontSize: 9.5, color: '#B7770D', marginTop: 2 }}>
                        Not mapped to {head.supplier} — call the Super Admin to get the association done.
                      </div>
                    )}
                  </td>
                  <td><input value={l.supplierCode} onChange={(e) => setLine(i, { supplierCode: e.target.value })} aria-label={`Supplier code line ${i + 1}`} /></td>
                  <td><input value={l.internalCode} placeholder="auto" onChange={(e) => setLine(i, { internalCode: e.target.value })} aria-label={`Internal code line ${i + 1}`} /></td>
                  <td><input type="number" step="any" min="0" className="nospin" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label={`Quantity line ${i + 1}`} /></td>
                  <td><input value={l.uom} readOnly tabIndex={-1} aria-label={`UOM line ${i + 1}`}
                    title="Taken from the Item Master — change it there, not on the receipt"
                    style={{ background: 'var(--bg)', color: 'var(--i3)', cursor: 'not-allowed' }} /></td>
                  <td><input type="number" step="any" min="0" className="nospin" value={l.widthMm} onChange={(e) => setLine(i, { widthMm: e.target.value })} aria-label={`Width line ${i + 1}`} /></td>
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
        <div className="pg-sub">Each line becomes one physical unit with its own internal code — that code is what goes on the sticker.</div>
      </div>

      <div className="card">
        <div className="ctitle">Recent receipts <span className="tag tgr">{grns.length}</span></div>
        <div className="tw sy" style={{ maxHeight: 260 }}>
          <table>
            <thead><tr><th>GRN</th><th>Date</th><th>PO</th><th>Supplier</th><th>Invoice</th><th style={{ textAlign: 'right' }}>Units</th><th>By</th></tr></thead>
            <tbody>
              {grns.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No receipts yet</td></tr>
                : grns.map((g) => (
                  <tr key={g.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{g.grnNo}</td>
                    <td style={{ fontSize: 11 }}>{g.grnDate}</td>
                    <td style={{ fontSize: 11 }}>{g.poNum || '—'}</td>
                    <td style={{ fontSize: 11 }}>{g.supplier || '—'}</td>
                    <td style={{ fontSize: 11 }}>{g.invoiceNo || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{g.units}</td>
                    <td style={{ fontSize: 11, color: 'var(--i3)' }}>{g.actor || '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ───────────────────────────── Issues & Returns ─────────────────────────── */

function IssuesReturns({ flash }) {
  const { mods } = useData();
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('');
  const [units, setUnits] = useState([]);
  const [txns, setTxns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ unitId: '', qty: '', so: '', department: '', note: '' });
  const [split, setSplit] = useState(false);
  const [children, setChildren] = useState([{ qty: '', widthMm: '', internalCode: '', location: '' }]);

  const openSos = useMemo(() => {
    const oab = (mods.oab && mods.oab.OAB) || {};
    return ['SF', 'OT'].flatMap((k) => (oab[k] || []).filter((r) => !r.closed).map((r) => r.so)).filter(Boolean);
  }, [mods.oab]);

  useEffect(() => { storesApi.onHand().then((r) => setItems((r || []).filter((x) => num(x.closingStock) > 0 || x.unitCount > 0))).catch(() => {}); }, []);

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

  async function doIssue() {
    if (!form.unitId || num(form.qty) <= 0) { flash('r', 'Pick a roll and enter the quantity to issue.'); return; }
    setBusy(true);
    try {
      await storesApi.issue({ unitId: Number(form.unitId), qty: Number(form.qty), so: form.so || undefined, department: form.department || undefined, note: form.note || undefined });
      flash('g', `Issued ${form.qty} from ${selectedUnit ? selectedUnit.internalCode : 'the roll'}${form.so ? ' to ' + form.so : ''}.`);
      setForm((f) => ({ ...f, qty: '', note: '' }));
      await loadUnits(itemId); await loadTxns();
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  async function doReturn() {
    if (!form.unitId) { flash('r', 'Pick the roll the material went out on.'); return; }
    const body = { unitId: Number(form.unitId), so: form.so || undefined, department: form.department || undefined, note: form.note || undefined };
    if (split) {
      const kids = children.filter((c) => num(c.qty) > 0);
      if (!kids.length) { flash('r', 'Enter at least one returned roll.'); return; }
      body.children = kids.map((c) => ({ qty: Number(c.qty), widthMm: c.widthMm === '' ? undefined : Number(c.widthMm), internalCode: c.internalCode || undefined, location: c.location || undefined, status: 'RETURNED' }));
    } else {
      if (num(form.qty) <= 0) { flash('r', 'Enter the quantity returned.'); return; }
      body.qty = Number(form.qty);
    }
    setBusy(true);
    try {
      const r = await storesApi.receiveReturn(body);
      flash('g', split
        ? `Returned as ${(r.returned || []).length} roll(s): ${(r.returned || []).map((x) => x.internalCode).join(', ')}. The original roll is now zero.`
        : `Returned ${form.qty} to ${selectedUnit ? selectedUnit.internalCode : 'the roll'}.`);
      setForm((f) => ({ ...f, qty: '', note: '' }));
      setChildren([{ qty: '', widthMm: '', internalCode: '', location: '' }]);
      setSplit(false);
      await loadUnits(itemId); await loadTxns();
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">🔄 Issue to the shop floor / receive a return</div>
        <div className="al al-b">
          Rolls are listed oldest first — <strong>issue from the top</strong> (FIFO). Issues and returns move the closing
          stock on the Material on Hand board immediately.
        </div>
        <div className="g4">
          <div className="fg"><label>Item</label>
            <select value={itemId} onChange={(e) => { setItemId(e.target.value); setForm((f) => ({ ...f, unitId: '' })); }} aria-label="Item">
              <option value="">— select an item —</option>
              {items.map((it) => <option key={it.id} value={it.id}>{it.code} — {it.name}</option>)}
            </select>
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
          <div className="fg"><label>Sale order</label>
            <input list="stores-so-list" value={form.so} onChange={(e) => setForm({ ...form, so: e.target.value })} aria-label="Sale order" placeholder="optional" />
            <datalist id="stores-so-list">{openSos.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div className="fg"><label>Department</label><input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} aria-label="Department" placeholder="e.g. Printing" /></div>
          <div className="fg"><label>Quantity</label>
            <input type="number" step="any" min="0" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}
              aria-label="Quantity" disabled={split} placeholder={selectedUnit ? `max ${qty(selectedUnit.qtyRemaining)}` : ''} />
          </div>
          <div className="fg"><label>Note</label><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label="Note" /></div>
        </div>

        <label className="cb" style={{ fontSize: 12, marginTop: 4 }}>
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} aria-label="Returned as narrower rolls" />
          <span>The roll came back cut into narrower rolls</span>
        </label>
        {split && (
          <div style={{ marginTop: 6 }}>
            <div className="pg-sub" style={{ marginTop: 0 }}>
              A 1200&nbsp;mm roll issued and returned as 700 + 500&nbsp;mm: enter each returned roll below. Each becomes its own
              roll with its own sticker, and the original roll is left at zero.
            </div>
            <div className="tw"><table>
              <thead><tr><th style={{ width: 120 }}>Qty *</th><th style={{ width: 120 }}>Width (mm)</th><th>Internal code</th><th>Location</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {children.map((c, i) => (
                  <tr key={i}>
                    <td><input type="number" step="any" min="0" value={c.qty} aria-label={`Returned quantity ${i + 1}`} onChange={(e) => setChildren((cs) => cs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                    <td><input type="number" step="any" min="0" value={c.widthMm} aria-label={`Returned width ${i + 1}`} onChange={(e) => setChildren((cs) => cs.map((x, j) => (j === i ? { ...x, widthMm: e.target.value } : x)))} /></td>
                    <td><input value={c.internalCode} placeholder="auto" aria-label={`Returned internal code ${i + 1}`} onChange={(e) => setChildren((cs) => cs.map((x, j) => (j === i ? { ...x, internalCode: e.target.value } : x)))} /></td>
                    <td><input value={c.location} aria-label={`Returned location ${i + 1}`} onChange={(e) => setChildren((cs) => cs.map((x, j) => (j === i ? { ...x, location: e.target.value } : x)))} /></td>
                    <td><button className="btn btn-r" style={{ height: 24, fontSize: 11, padding: '0 6px' }} onClick={() => setChildren((cs) => (cs.length === 1 ? cs : cs.filter((_, j) => j !== i)))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <button className="btn btn-s" onClick={() => setChildren((cs) => [...cs, { qty: '', widthMm: '', internalCode: '', location: '' }])}>＋ Another roll back</button>
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

/* ────────────────────────── FG — finished, per spec ─────────────────────── */

function Fg({ flash }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await storesApi.fg() || []); }
    catch (e) { flash('r', e.message); }
    finally { setBusy(false); }
  }, [flash]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => [r.spec, r.customer, r.jobName].some((v) => String(v || '').toLowerCase().includes(t)));
  }, [rows, q]);
  const totalFg = visible.reduce((t, r) => t + num(r.fgQty), 0);

  return (
    <div className="card">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>Finished goods, per spec <span className="tag tgr">{visible.length}</span></div>
        <input placeholder="Search spec / customer / job…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search FG" style={{ minWidth: 220 }} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={load} disabled={busy}>{busy ? 'Loading…' : '↻ Refresh'}</button>
      </div>
      <div className="stats" style={{ marginBottom: 8 }}>
        <div className="stat"><div className="sl">Specs holding FG</div><div className="sv">{visible.length}</div></div>
        <div className="stat"><div className="sl">Finished pieces</div><div className="sv" style={{ color: 'var(--g)' }}>{totalFg.toLocaleString('en-IN')}</div></div>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>Booked on the FG Entry sheet, gathered per spec number.</div>
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 380px)' }}>
        <table>
          <thead><tr>
            <th>Spec</th><th style={{ minWidth: 200 }}>Job Name</th><th>Customer</th>
            <th style={{ textAlign: 'right' }}>Orders</th><th style={{ textAlign: 'right' }}>PO Qty</th>
            <th style={{ textAlign: 'right' }}>FG</th><th style={{ textAlign: 'right' }}>Dispatched</th>
            <th style={{ textAlign: 'right' }}>FG in hand</th>
          </tr></thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>
                No finished goods booked yet — they arrive from the FG Entry sheet.
              </td></tr>
            ) : visible.map((r) => {
              const inHand = num(r.fgQty) - num(r.dispatched);
              return (
                <tr key={r.spec}>
                  <td><span className="tag tb" style={{ fontSize: 10 }}>{r.spec}</span></td>
                  <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{r.jobName || '—'}</td>
                  <td style={{ fontSize: 11 }}>{r.customer || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.orders}</td>
                  <td style={{ textAlign: 'right' }}>{qty(r.poQty)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--g)' }}>{qty(r.fgQty)}</td>
                  <td style={{ textAlign: 'right' }}>{qty(r.dispatched)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{inHand > 0 ? inHand.toLocaleString('en-IN') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
