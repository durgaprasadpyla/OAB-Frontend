import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { inr } from '../lib/format.js';
import { calcMetres } from '../lib/calc.js';
import { custGroupOf } from '../lib/master.js';
import { exportAOA } from '../lib/xlsx.js';
import { today } from '../lib/format.js';
import {
  bomOpenSOList, bomFilterSOList, bomFilterOptions,
  bomMaterialForSO, bomMaterialForSOList,
} from '../lib/bom.js';

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
  const bom = mods.bom || {};
  const customers = mods.customers || [];

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

  return (
    <>
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
          title="Selected sale orders" rows={aggPicked} count={picked.size}
          empty="Tick sale orders above to see the material required for that selection."
          onExport={() => exportRequirement(aggPicked, 'Raw_Material_Selected')}
        />
        <RequirementTable
          title="Current filter" rows={aggFiltered} count={filtered.length}
          empty="No matching material — check the filters, or make sure the matching specs have a BOM."
          onExport={() => exportRequirement(aggFiltered, 'Raw_Material_Filtered')}
        />
      </div>

      <RequirementTable
        title="All open sale orders" rows={aggAll} count={allOpen.length}
        empty="No raw material requirement yet — define BOMs in the BOM tab and make sure open sale orders reference those specs."
        onExport={() => exportRequirement(aggAll, 'Raw_Material_All')}
      />
    </>
  );
}

function RawMaterialRow({ row, rowKey, bom, picked, onPick, open, onToggle }) {
  const items = open ? bomMaterialForSO(bom, row.spec, row.bal) : [];
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
          {row.hasBOM
            ? <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 8px' }} onClick={onToggle} aria-label={`${open ? 'Hide' : 'View'} material for ${row.so}`}>{open ? 'Hide' : 'View'}</button>
            : <span style={{ fontSize: 10, color: '#c99a2e', fontStyle: 'italic' }}>No BOM</span>}
        </td>
      </tr>
      {open && (
        <tr><td colSpan={8} style={{ padding: '8px 20px', background: 'var(--bg)' }}>
          {items.length ? (
            <table style={{ width: '100%' }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Item Code</th><th style={{ textAlign: 'left' }}>Description</th><th style={{ textAlign: 'right' }}>Required</th></tr></thead>
              <tbody>
                {items.map((m, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{m.itemCode}</td>
                    <td style={{ fontSize: 11 }}>{m.itemDescription}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{inr(m.required, 2)} {m.uom || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <span style={{ color: 'var(--i3)', fontSize: 11 }}>No material rows in this BOM.</span>}
        </td></tr>
      )}
    </>
  );
}

function RequirementTable({ title, rows, count, empty, onExport }) {
  const [openItem, setOpenItem] = useState(null);
  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>{title} <span className="tag tgr">{count}</span></div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={onExport} disabled={!rows.length}>⬇ Export</button>
      </div>
      <div className="tw sy" style={{ maxHeight: 320 }}>
        <table>
          <thead><tr><th>Item Code</th><th style={{ minWidth: 180 }}>Description</th><th>Type</th><th style={{ textAlign: 'right' }}>Total Required</th><th style={{ width: 60 }}></th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>{empty}</td></tr>
            ) : rows.map((m) => (
              <FragmentRow key={m.itemCode} m={m} open={openItem === m.itemCode} onToggle={() => setOpenItem((v) => (v === m.itemCode ? null : m.itemCode))} />
            ))}
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
