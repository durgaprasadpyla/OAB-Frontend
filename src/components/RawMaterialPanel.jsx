import { Fragment, useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { stockApi, bomApi } from '../api.js';
import { inr } from '../lib/format.js';
import { calcMetres } from '../lib/calc.js';
import { custGroupOf } from '../lib/master.js';
import { exportAOA } from '../lib/xlsx.js';
import { today } from '../lib/format.js';
import {
  bomOpenSOList, bomFilterSOList, bomFilterOptions,
  bomMaterialForSOList, bomMaterialForSOByDept, plannedBomMap,
} from '../lib/bom.js';
import { exportSoBomExcel, exportSoBomPDF } from '../lib/bomExport.js';

// Raw Material Requirement — read-only view over the BOMs (module 13) and the
// open sale orders (module 1). Shows what to buy: aggregated across everything
// open, across a filtered subset, or for a hand-picked selection of orders.
// Ported from renderAdminMaterial / renderPMMaterial + the bomMat* filter stack.

const FILTER_KINDS = [
  { k: 'group', label: 'Group' },
  { k: 'customer', label: 'Customer' },
  { k: 'spec', label: 'Spec' },
];

export default function RawMaterialPanel() {
  const { mods } = useData();
  const customers = mods.customers || [];

  // The BOMs QC saves under Route and BOM live in the planning tables, not in
  // module 13 — and only those carry the department each line belongs to. This
  // screen read the module alone, so a QC-entered BOM showed here as "No BOM".
  // Both are used, the planning store winning where a spec is in both.
  const [planned, setPlanned] = useState({});
  useEffect(() => {
    let live = true;
    bomApi.list()
      .then((list) => { if (live) setPlanned(plannedBomMap(list)); })
      .catch(() => { /* planning store unreachable — the module still renders */ });
    return () => { live = false; };
  }, []);
  const bom = useMemo(() => ({ ...(mods.bom || {}), ...planned }), [mods.bom, planned]);

  const [sel, setSel] = useState({ group: new Set(), customer: new Set(), spec: new Set() });
  const [picked, setPicked] = useState(() => new Set());   // "sheet|so" keys
  const [openRow, setOpenRow] = useState(null);

  // Every open order with balance, annotated with BOM availability.
  const allOpen = useMemo(() => bomOpenSOList(bom, mods.oab?.OAB, {
    metresOf: (r, bal) => (calcMetres(r, bal) || {}).net || 0,
    groupOf: (c) => custGroupOf(c, customers),
  }), [bom, mods.oab, customers]);

  const filtered = useMemo(() => bomFilterSOList(allOpen, sel), [allOpen, sel]);

  const options = useMemo(() => Object.fromEntries(
    FILTER_KINDS.map(({ k }) => [k, bomFilterOptions(allOpen, k, sel)]),
  ), [allOpen, sel]);

  const pickedRows = useMemo(() => filtered.filter((r) => picked.has(r.sheet + '|' + r.so)), [filtered, picked]);

  const aggAll = useMemo(() => bomMaterialForSOList(bom, allOpen), [bom, allOpen]);
  const aggFiltered = useMemo(() => bomMaterialForSOList(bom, filtered), [bom, filtered]);
  const aggPicked = useMemo(() => bomMaterialForSOList(bom, pickedRows), [bom, pickedRows]);

  const withBom = filtered.filter((r) => r.hasBOM);
  const allPicked = withBom.length > 0 && withBom.every((r) => picked.has(r.sheet + '|' + r.so));

  function toggleKind(kind, value) {
    setSel((s) => {
      const next = new Set(s[kind]);
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...s, [kind]: next };
    });
  }
  function clearFilters() { setSel({ group: new Set(), customer: new Set(), spec: new Set() }); }
  function togglePick(key) {
    setPicked((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }
  function pickAll(on) {
    setPicked(on ? new Set(withBom.map((r) => r.sheet + '|' + r.so)) : new Set());
  }
  function exportRequirement(rows, name) {
    if (!rows.length) return;
    exportAOA(
      [['Item Code', 'Description', 'Material Type', 'UOM', 'Required'],
        ...rows.map((m) => [m.itemCode, m.itemDescription || '', m.materialType || '', m.uom || '', Math.round(m.total * 100) / 100])],
      name + '_' + today(),
    );
  }

  const noBomCount = filtered.length - withBom.length;

  // §34: the low-store-stock sale-order alerts live here, under Raw Material.
  const [alerts, setAlerts] = useState([]);
  useEffect(() => {
    (async () => {
      try { setAlerts(await stockApi.alerts('OPEN') || []); }
      catch { /* alerts may be forbidden for some roles — panel still renders */ }
    })();
  }, []);

  return (
    <>
      {alerts.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--red)' }}>
          <div className="ctitle">🔔 Low-Stock Sale-Order Alerts <span className="tag tr">{alerts.length}</span></div>
          <div className="tw sy" style={{ maxHeight: 220 }}>
            <table>
              <thead><tr><th>Sale Order</th><th>Item</th><th>Needed by</th><th>Required</th><th>Available</th><th>Shortage</th></tr></thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} className="nr">
                    <td><span className="so-pill">{a.so}</span></td>
                    <td>{a.itemCode}{a.itemName ? ' — ' + a.itemName : ''}</td>
                    <td>{a.departmentName || '—'}</td>
                    <td>{a.requiredQty}</td>
                    <td>{a.availableQty}</td>
                    <td><b>{a.shortageQty}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Open Sale Orders <span className="tag tgr">{filtered.length}</span></div>
          <span style={{ flex: 1 }} />
          {FILTER_KINDS.map(({ k, label }) => (
            <select
              key={k} value="" aria-label={`Add ${label} filter`}
              onChange={(e) => { if (e.target.value) toggleKind(k, e.target.value); }}
            >
              <option value="">{label}{sel[k].size ? ` (${sel[k].size})` : ''}…</option>
              {options[k].map((v) => <option key={v} value={v}>{sel[k].has(v) ? '✓ ' : ''}{v}</option>)}
            </select>
          ))}
          <button className="btn btn-s" onClick={clearFilters} disabled={!FILTER_KINDS.some(({ k }) => sel[k].size)}>Clear</button>
        </div>

        {FILTER_KINDS.some(({ k }) => sel[k].size) && (
          <div style={{ margin: '0 0 8px' }}>
            {FILTER_KINDS.flatMap(({ k, label }) => [...sel[k]].map((v) => (
              <button key={k + v} className="btn btn-s" onClick={() => toggleKind(k, v)} style={{ marginRight: 6, fontSize: 11 }}>
                {label}: {v} ✕
              </button>
            )))}
          </div>
        )}

        <div className="pg-sub" style={{ marginTop: 0 }}>
          Tick sale orders to see material for that selection, or use View for a single order's
          breakdown. Orders whose spec has no BOM are greyed out — define it in the BOM tab first.
          {noBomCount > 0 && <> <strong>{noBomCount}</strong> of these {noBomCount === 1 ? 'order has' : 'orders have'} no BOM and {noBomCount === 1 ? 'is' : 'are'} excluded from every total below.</>}
        </div>

        <div className="tw sy" style={{ maxHeight: 340 }}>
          <table>
            <thead><tr>
              <th style={{ textAlign: 'center', width: 34 }}>
                <input type="checkbox" checked={allPicked} onChange={(e) => pickAll(e.target.checked)} title="Select all (with BOM)" aria-label="Select all orders with a BOM" />
              </th>
              <th>SO</th><th>Customer</th><th style={{ minWidth: 160 }}>Job Name</th><th>Spec</th>
              <th style={{ textAlign: 'right' }}>Balance</th><th style={{ textAlign: 'right' }}>Metres</th><th style={{ textAlign: 'center', width: 80 }}></th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No open sale orders.</td></tr>
              ) : filtered.map((r) => {
                const key = r.sheet + '|' + r.so;
                return (
                  <RawMaterialRow
                    key={key} row={r} rowKey={key} bom={bom}
                    picked={picked.has(key)} onPick={() => togglePick(key)}
                    open={openRow === key} onToggle={() => setOpenRow((v) => (v === key ? null : key))}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="g2" style={{ alignItems: 'start' }}>
        <RequirementTable
          title="Selected sale orders" rows={aggPicked} count={picked.size} soRows={pickedRows}
          empty="Tick sale orders above to see the material required for that selection."
          onExport={() => exportRequirement(aggPicked, 'Raw_Material_Selected')}
        />
        <RequirementTable
          title="Current filter" rows={aggFiltered} count={filtered.length} soRows={filtered}
          empty="No matching material — check the filters, or make sure the matching specs have a BOM."
          onExport={() => exportRequirement(aggFiltered, 'Raw_Material_Filtered')}
        />
      </div>

      <RequirementTable
        title="All open sale orders" rows={aggAll} count={allOpen.length} soRows={allOpen}
        empty="No raw material requirement yet — define BOMs in the BOM tab and make sure open sale orders reference those specs."
        onExport={() => exportRequirement(aggAll, 'Raw_Material_All')}
      />
    </>
  );
}

const BTN = { height: 22, fontSize: 10, padding: '0 6px' };

function RawMaterialRow({ row, rowKey, bom, picked, onPick, open, onToggle }) {
  const groups = open ? bomMaterialForSOByDept(bom, row.spec, row.bal) : [];
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  async function download(kind) {
    setErr(''); setBusy(kind);
    try {
      const ok = kind === 'xls' ? exportSoBomExcel(bom, row) : await exportSoBomPDF(bom, row);
      if (!ok) setErr('This spec has no BOM lines to download.');
    } catch (e) { setErr((kind === 'xls' ? 'Excel' : 'PDF') + ' error: ' + (e && e.message ? e.message : String(e))); }
    finally { setBusy(''); }
  }
  return (
    <>
      <tr style={row.hasBOM ? undefined : { opacity: 0.55 }}>
        <td style={{ textAlign: 'center' }}>
          <input
            type="checkbox" checked={picked} disabled={!row.hasBOM} onChange={onPick}
            aria-label={`Select ${row.so}`}
          />
        </td>
        <td><span className="so-pill" style={{ fontSize: 10 }}>{row.so}</span></td>
        <td style={{ fontSize: 11 }}>{row.customer || '-'}</td>
        <td style={{ fontSize: 11 }}>{row.jobName || '-'}</td>
        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.spec}</td>
        <td style={{ textAlign: 'right', fontWeight: 600 }}>{inr(row.bal)}</td>
        <td style={{ textAlign: 'right' }}>{row.mtrs ? inr(row.mtrs) + ' m' : '-'}</td>
        <td style={{ textAlign: 'center' }}>
          {row.hasBOM ? (
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
              <button className="btn btn-s" style={BTN} onClick={onToggle} aria-label={`${open ? 'Hide' : 'View'} material for ${row.so}`}>{open ? 'Hide' : 'View'}</button>
              <button className="btn btn-s" style={BTN} disabled={!!busy} onClick={() => download('xls')}
                title="Department-wise BOM for this sale order, as Excel"
                aria-label={`Download department-wise BOM for ${row.so} as Excel`}>{busy === 'xls' ? '…' : '⬇ XLS'}</button>
              <button className="btn btn-s" style={BTN} disabled={!!busy} onClick={() => download('pdf')}
                title="Department-wise BOM for this sale order, as PDF"
                aria-label={`Download department-wise BOM for ${row.so} as PDF`}>{busy === 'pdf' ? '…' : '⬇ PDF'}</button>
            </div>
          ) : <span style={{ fontSize: 10, color: '#c99a2e', fontStyle: 'italic' }}>No BOM</span>}
        </td>
      </tr>
      {(err || busy) && (
        <tr><td colSpan={8} style={{ padding: '2px 20px 6px', fontSize: 11, color: err ? 'var(--red)' : 'var(--i3)' }}>
          {err || 'Preparing the download…'}
        </td></tr>
      )}
      {open && (
        <tr><td colSpan={8} style={{ padding: '8px 20px', background: 'var(--bg)' }}>
          {groups.length ? groups.map((g) => (
            <div key={g.department} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--b1)', marginBottom: 2 }}>
                {g.department} <span style={{ fontWeight: 400, color: 'var(--i3)' }}>— {g.items.length} item(s)</span>
              </div>
              <table style={{ width: '100%' }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Item Code</th><th style={{ textAlign: 'left' }}>Description</th><th style={{ textAlign: 'right' }}>Required</th></tr></thead>
                <tbody>
                  {g.items.map((m, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{m.itemCode}</td>
                      <td style={{ fontSize: 11 }}>{m.itemDescription}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{inr(m.required, 2)} {m.uom || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )) : <span style={{ color: 'var(--i3)', fontSize: 11 }}>No material rows in this BOM.</span>}
        </td></tr>
      )}
    </>
  );
}

// Summary stats for a list of open SOs: order count, total balance qty, total
// balance metres. (legacy bomStatsHTML 6762)
function soStats(rows) {
  return (rows || []).reduce(
    (acc, r) => ({ soCount: acc.soCount + 1, totalBal: acc.totalBal + (r.bal || 0), totalMtrs: acc.totalMtrs + (r.mtrs || 0) }),
    { soCount: 0, totalBal: 0, totalMtrs: 0 },
  );
}

// Group an aggregated material list by Material Type, summing each group's total
// per UOM and accumulating a grand total per UOM. (legacy bomRenderMaterialTable 6774)
function groupAggByType(rows) {
  const groups = {};
  (rows || []).forEach((m) => {
    const mt = m.materialType || '(Unspecified)';
    if (!groups[mt]) groups[mt] = { items: [], subtotals: {} };
    groups[mt].items.push(m);
    const uk = m.uom || '';
    groups[mt].subtotals[uk] = (groups[mt].subtotals[uk] || 0) + m.total;
  });
  const grand = {};
  const ordered = Object.keys(groups).sort((a, b) => a.localeCompare(b)).map((mt) => {
    const g = groups[mt];
    g.items.sort((a, b) => b.total - a.total);
    Object.keys(g.subtotals).forEach((uk) => { grand[uk] = (grand[uk] || 0) + g.subtotals[uk]; });
    return { mt, items: g.items, subtotals: g.subtotals };
  });
  return { ordered, grand };
}

// "12.00 Kg + 3.50 Roll" — a per-UOM total, joined so mixed units never collapse.
function uomTotalText(obj) {
  const parts = Object.keys(obj).sort().map((uk) => inr(obj[uk], 2) + (uk ? ' ' + uk : ''));
  return parts.length ? parts.join(' + ') : '0';
}

function RequirementTable({ title, rows, count, empty, onExport, soRows = [] }) {
  const [openItem, setOpenItem] = useState(null);
  const { ordered, grand } = useMemo(() => groupAggByType(rows), [rows]);
  const stats = useMemo(() => soStats(soRows), [soRows]);
  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>{title} <span className="tag tgr">{count}</span></div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={onExport} disabled={!rows.length}>⬇ Export</button>
      </div>
      {soRows.length > 0 && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
          <div className="stat"><div className="sl">Sale Orders</div><div className="sv">{stats.soCount}</div></div>
          <div className="stat"><div className="sl">Total Balance Qty</div><div className="sv">{inr(stats.totalBal)}</div></div>
          <div className="stat"><div className="sl">Total Balance Mtrs</div><div className="sv red">{inr(stats.totalMtrs)}&nbsp;m</div></div>
        </div>
      )}
      <div className="tw sy" style={{ maxHeight: 320 }}>
        <table>
          <thead><tr><th>Item Code</th><th style={{ minWidth: 180 }}>Description</th><th>Type</th><th style={{ textAlign: 'right' }}>Total Required</th><th style={{ width: 60 }}></th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>{empty}</td></tr>
            ) : (
              <>
                {ordered.map((g) => (
                  <Fragment key={g.mt}>
                    {g.items.map((m) => (
                      <FragmentRow key={m.itemCode} m={m} open={openItem === m.itemCode} onToggle={() => setOpenItem((v) => (v === m.itemCode ? null : m.itemCode))} />
                    ))}
                    <tr style={{ background: 'var(--bg)' }}>
                      <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700, color: 'var(--g)' }}>Subtotal — {g.mt}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--g)', whiteSpace: 'nowrap' }}>{uomTotalText(g.subtotals)}</td>
                      <td />
                    </tr>
                  </Fragment>
                ))}
                <tr style={{ background: 'var(--g)', color: '#fff' }}>
                  <td colSpan={3} style={{ textAlign: 'right', fontWeight: 800 }}>GRAND TOTAL</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>{uomTotalText(grand)}</td>
                  <td />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({ m, open, onToggle }) {
  return (
    <>
      <tr>
        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{m.itemCode}</td>
        <td style={{ fontSize: 11 }}>{m.itemDescription || '-'}</td>
        <td style={{ fontSize: 11 }}>{m.materialType || '-'}</td>
        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--g)' }}>{inr(m.total, 2)} {m.uom || ''}</td>
        <td style={{ textAlign: 'center' }}>
          <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 8px' }} onClick={onToggle} aria-label={`${open ? 'Hide' : 'Show'} orders driving ${m.itemCode}`}>{open ? '▾' : '▸'}</button>
        </td>
      </tr>
      {open && (
        <tr><td colSpan={5} style={{ padding: '6px 20px', background: 'var(--bg)' }}>
          <table style={{ width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>SO</th><th style={{ textAlign: 'left' }}>Customer</th><th style={{ textAlign: 'left' }}>Spec</th><th style={{ textAlign: 'right' }}>Qty</th></tr></thead>
            <tbody>
              {m.bySO.map((s, i) => (
                <tr key={i}>
                  <td><span className="so-pill" style={{ fontSize: 10 }}>{s.so}</span></td>
                  <td style={{ fontSize: 11 }}>{s.customer || '-'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.spec}</td>
                  <td style={{ textAlign: 'right' }}>{inr(s.qty, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </td></tr>
      )}
    </>
  );
}
