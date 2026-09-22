import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { rmRatesApi, adminApi, ordersApi, field } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { balance, num, calcMetres, pouchWeightJSS } from '../lib/calc.js';
import { getPM, getCostPrice } from '../lib/pricing.js';
import { custGroups, custGroupOf, custsInGroup, specGroup } from '../lib/master.js';
import { computeKPIs, dashRange } from '../lib/dashboard.js';
import { dash, rupees, fmtDate, inr } from '../lib/format.js';
import { exportAOA, readSheetAOA } from '../lib/xlsx.js';
import { STAGES } from '../lib/constants.js';
import { materialKey, materialLabel, knownMaterials } from '../lib/material.js';
import { specIndex, specFor, duplicateSpecs, specKey } from '../lib/specs.js';
import { reconcileMonth, projectedMonths, monthLabel } from '../lib/projections.js';
import UsersAccess from '../components/UsersAccess.jsx';
import CustomersAdmin from '../components/CustomersAdmin.jsx';
import LeadsAdmin from '../components/LeadsAdmin.jsx';
import { syncDespatchMaster, effectiveDespatchList } from '../lib/despatchSync.js';
import StoresStockPanel from '../components/StoresStockPanel.jsx';
import BomPanel from '../components/BomPanel.jsx';
import KamPanel from '../components/KamPanel.jsx';
import RawMaterialPanel from '../components/RawMaterialPanel.jsx';
import FgValuePanel from '../components/FgValuePanel.jsx';
import SalesHistoryPanel from '../components/SalesHistoryPanel.jsx';
import DropdownAdmin from '../components/DropdownAdmin.jsx';
import GrnAdmin, { RmPriceAdmin } from '../components/GrnAdmin.jsx';
import MasterData from './MasterData.jsx';

const clone = (o) => JSON.parse(JSON.stringify(o));

// Tab order and labels are production's (the dash-tab-* buttons in the monolith).
// SO Costing / Audit Log / System are additions this app has and production does
// not; they sit at the end so the shared tabs stay in the order people know.
const TABS = [
  { k: 'summary', label: '📊 Summary' },
  { k: 'trends', label: '📈 Trends & Forecast' },
  // Issues 6 §18: month-by-month sales, live from invoicing, with the Price Master margins.
  { k: 'saleshistory', label: '📜 Sales History' },
  { k: 'price', label: '💰 Price Master' },
  { k: 'fgval', label: '💹 FG Value' },
  { k: 'jss', label: '📋 JSS Editor' },
  { k: 'delete', label: '✏ Edit SOs' },
  { k: 'customers', label: '🏢 Customers' },
  // Leads sit beside Customers: a rep's entry lives here until it is promoted.
  { k: 'leads', label: '🌱 Leads' },
  { k: 'kam', label: '🎯 Customer KAM & Targets' },
  { k: 'users', label: '👤 Users & Access' },
  { k: 'dropdowns', label: '🧩 Drop-down selections' },
  { k: 'master', label: '🗂 Machines' },
  { k: 'routes', label: '🛣 Routes' },
  { k: 'alerts', label: '🔔 Stock Alerts' },
  // Issues 2.7: correcting a booked receipt, and repricing material in stock.
  // Super Admin only — /dashboard is already gated to that role, and both
  // endpoints check it again server-side.
  { k: 'grns', label: '📥 GRN Entries' },
  { k: 'rmprices', label: '💱 RM Prices' },
  { k: 'bom', label: '🧱 BOM' },
  { k: 'material', label: '🧮 Raw Material' },
  { k: 'costing', label: '🧮 SO Costing' },
  { k: 'audit', label: '🧾 Audit Log' },
  { k: 'system', label: '🛠 System' },
];

/** Superadmin Dashboard — native port of renderDashboard + its sub-panels. */
export default function Dashboard() {
  const [tab, setTab] = useState('summary');
  // Issues 2.2 §2: the despatch forms the super admin maintains under Drop-down
  // selections must exist in the dispatch-type master, which is what QC's Add-JSS
  // form reads. Backfilling here — on the super admin's landing page — means a list
  // saved before this existed reaches QC without anyone opening that tab. Creates
  // missing names only; runs once per mount and never blocks the page.
  const { mods, loading } = useData();
  const sales = mods.sales;
  const syncedRef = useRef(false);
  useEffect(() => {
    // Not before the modules have loaded: `mods.sales` is pre-seeded with an empty
    // shape, so until the blob arrives the effective list is the built-in default
    // and syncing it would push names the admin never had.
    if (syncedRef.current || loading) return;
    const list = effectiveDespatchList(sales);
    if (!list.length) return;
    syncedRef.current = true;
    syncDespatchMaster(list);
  }, [sales, loading]);
  return (
    <div id="app">
      <div className="pg-ttl">📊 Business Dashboard</div>
      <div className="pg-sub">Sales, open orders, dispatch and loss of business analysis</div>
      {/* Raw-material rates sit ABOVE the tabs in production — they feed every
          margin figure on the screen, whichever tab is open. */}
      <RmRatesBar />
      <div className="step-bar" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
        ))}
      </div>
      {tab === 'summary' && <Summary />}
      {tab === 'price' && <PriceMaster />}
      {tab === 'jss' && <JssEditor />}
      {tab === 'customers' && <CustomersAdmin />}
      {tab === 'leads' && <LeadsAdmin />}
      {tab === 'delete' && <DeleteSOs />}
      {tab === 'trends' && <Trends />}
      {tab === 'saleshistory' && <SalesHistoryPanel />}
      {tab === 'costing' && <SOCosting />}
      {tab === 'kam' && <KamPanel />}
      {tab === 'bom' && <BomPanel />}
      {/* Raw Material = what we HOLD (stores) above what we NEED (BOM requirement). */}
      {tab === 'material' && <><StoresStockPanel /><RawMaterialPanel /></>}
      {tab === 'fgval' && <FgValuePanel />}
      {tab === 'dropdowns' && <DropdownAdmin />}
      {/* Machines (né Master Data) keeps only Departments + Machines; Routes and
          Stock Alerts are their own top-level tabs now. */}
      {/* Issues 1.0 #5: no Departments sub-tab here — departments are managed under
          Drop-down selections; the machine form pulls them in as a dropdown. */}
      {tab === 'master' && <MasterData only={['machines']} title="🗂 Machines" subtitle="Machines and the department each one runs under (departments are managed in Drop-down selections)." />}
      {tab === 'routes' && <MasterData only={['routes']} title="🛣 Routes" subtitle="Production routes — ordered department stages per Dispatch Form." />}
      {tab === 'grns' && <GrnAdmin />}
      {tab === 'rmprices' && <RmPriceAdmin />}
      {tab === 'alerts' && <MasterData only={['alerts']} title="🔔 Stock Alerts" subtitle="Open low-stock shortages and notifications." />}
      {tab === 'users' && <UsersAccess />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'system' && <SystemPanel />}
    </div>
  );
}

/* ─────────────────────────── Audit Log (/api/audit) ─────────────────────────── */
const AUDIT_TYPES = ['SALES_ORDER', 'INVOICE', 'OAB_ROW', 'PURCHASE_ORDER'];
function AuditLog() {
  const [type, setType] = useState('');
  const path = '/api/audit?limit=200' + (type ? '&entityType=' + encodeURIComponent(type) : '');
  const { data, loading, error, refetch } = useApi(path);
  const rows = Array.isArray(data) ? data : [];
  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>Audit Log — who did what (newest first)</div>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {AUDIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={refetch}>↻ Refresh</button>
      </div>
      {error && <div className="al al-r">Failed to load audit log: {error}</div>}
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead><tr><th>When</th><th>Actor</th><th>Entity</th><th>ID</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>{loading ? 'Loading…' : 'No audit entries'}</td></tr>
            ) : rows.map((r) => (
              <tr key={field(r, 'id')}>
                <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{String(field(r, 'ts') || '').replace('T', ' ').slice(0, 19)}</td>
                <td style={{ fontSize: 11 }}>{field(r, 'actor')}</td>
                <td><span className="tag tb" style={{ fontSize: 9 }}>{field(r, 'entity_type')}</span></td>
                <td style={{ fontSize: 11 }}>{field(r, 'entity_id')}</td>
                <td style={{ fontSize: 11 }}>{field(r, 'action')}</td>
                <td style={{ fontSize: 10, color: 'var(--i3)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{field(r, 'details')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── System (/api/summary + /api/admin/resync) ─────────────────────────── */
function SystemPanel() {
  const { data, loading, error, refetch } = useApi('/api/summary');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const s = data || {};

  async function resync() {
    if (!window.confirm('Rebuild all normalized read tables from the module blobs?')) return;
    setBusy(true); setMsg('');
    try { const r = await adminApi.resync(); setMsg(`✓ Resynced ${r.resynced} module(s) — read model rebuilt.`); refetch(); }
    catch (e) { setMsg('Resync failed: ' + (e.message || e)); }
    finally { setBusy(false); }
  }

  const kv = (k) => (loading ? '…' : dash(s[k]));
  return (
    <>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>System — server rollups (from the normalized tables)</div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={refetch}>↻ Refresh</button>
        </div>
        {error && <div className="al al-r">Failed to load summary: {error}</div>}
        <div className="stats">
          <KPI label="Customers" value={kv('customers')} />
          <KPI label="Specs" value={kv('specs')} />
          <KPI label="Priced specs" value={kv('specsPriced')} />
          <KPI label="Open SOs" value={kv('oabRowsOpen')} cls="red" />
          <KPI label="Closed SOs" value={kv('oabRowsClosed')} />
          <KPI label="Invoices" value={kv('invoices')} cls="grn" sub={s.invoicedAmount != null ? rupees(s.invoicedAmount, 0) : ''} />
        </div>
      </div>
      <div className="card">
        <div className="ctitle">Read-model maintenance</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>Rebuild the normalized tables (customers, oab_row, invoice, …) from the authoritative module blobs. Use if the read model ever drifts from the write model.</div>
        <button className="btn btn-g" onClick={resync} disabled={busy}>{busy ? 'Resyncing…' : '♻ Rebuild read model (resync)'}</button>
        {msg && <div className="al al-g" style={{ marginTop: 8 }}>{msg}</div>}
      </div>
    </>
  );
}

/* ─────────────────────────── Summary ─────────────────────────── */
/**
 * ⚗ Raw Material Rates (₹/kg) — production renders this above the Dashboard tab
 * bar, not inside a tab, because the rates drive the cost and margin figures on
 * every tab. (dash-tab section 1 / pushMaterialRates)
 *
 * Note: the Customer Master is managed only from the Customers tab, so no upload
 * dropzone lives here anymore.
 */
function RmRatesBar() {
  const [rates, setRates] = useState({ bopp: 0, afbopp: 0, afldpe: 0 });
  const [msg, setMsg] = useState('');

  useEffect(() => { rmRatesApi.get().then((r) => setRates((cur) => ({ ...cur, ...r }))).catch(() => {}); }, []);

  async function pushRates() {
    try {
      const saved = await rmRatesApi.put(rates);
      setRates((cur) => ({ ...cur, ...saved }));
      setMsg('✓ Raw-material rates saved — margins recomputed.');
    } catch (e) {
      setMsg('Save failed: ' + e.message);
    }
    setTimeout(() => setMsg(''), 4000);
  }

  return (
    <div className="card" style={{ marginBottom: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--i2)', marginBottom: 10 }}>
        ⚗ Raw Material Rates (₹/kg)
        <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--i3)', marginLeft: 8 }}>Cost = Pouch Weight ÷ 1000 × Rate</span>
      </div>
      <div className="g4">
        <div className="fg"><label>BOPP</label><input type="number" min="0" step="0.01" placeholder="₹/kg" value={rates.bopp || ''} onChange={(e) => setRates({ ...rates, bopp: num(e.target.value) })} /></div>
        <div className="fg"><label>AF BOPP</label><input type="number" min="0" step="0.01" placeholder="₹/kg" value={rates.afbopp || ''} onChange={(e) => setRates({ ...rates, afbopp: num(e.target.value) })} /></div>
        <div className="fg"><label>AF LDPE</label><input type="number" min="0" step="0.01" placeholder="₹/kg" value={rates.afldpe || ''} onChange={(e) => setRates({ ...rates, afldpe: num(e.target.value) })} /></div>
        <div className="fg"><label>&nbsp;</label><button className="btn btn-g" onClick={pushRates}>✓ Push Rates</button></div>
      </div>
      {msg && <div className="al al-g" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

function Summary() {
  const { mods } = useData();
  const [filter, setFilter] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [client, setClient] = useState('');
  const [group, setGroup] = useState('');
  const [rates, setRates] = useState({ bopp: 0, afbopp: 0, afldpe: 0 });
  const [showDrill, setShowDrill] = useState(false);

  // RM ₹/kg rates are server-side now (shared across devices), not localStorage.
  useEffect(() => { rmRatesApi.get().then((r) => setRates((cur) => ({ ...cur, ...r }))).catch(() => {}); }, []);

  const ctx = { prices: mods.prices, jss: mods.jss, matRates: rates };
  const range = filter === 'custom' ? { from, to } : dashRange(filter);
  const clients = useMemo(() => [...new Set(['SF', 'OT'].flatMap((k) => (mods.oab?.OAB?.[k] || [])).map((r) => r.customer).filter(Boolean))].sort(), [mods.oab]);
  // Parent-group options from the Customer Master. (legacy dash-group / _custGroups 5832)
  const groups = useMemo(() => custGroups(mods.customers), [mods.customers]);

  // A Group filter narrows the whole dashboard to the customers in that buying
  // group. computeKPIs takes a single client, so we pre-filter the module-1 blob
  // by group here (rows + invoices) and hand it the subset — every KPI and table
  // then reflects the group consistently. (legacy custGroupOf 5824 / dash 5023)
  const oabForKpis = useMemo(() => {
    if (!group) return mods.oab;
    const inG = (cust) => custGroupOf(cust, mods.customers) === group;
    const src = mods.oab || {};
    const O = src.OAB || {};
    return {
      ...src,
      OAB: { ...O, SF: (O.SF || []).filter((r) => inG(r.customer)), OT: (O.OT || []).filter((r) => inG(r.customer)) },
      INV_REG: (src.INV_REG || []).filter((inv) => inG(inv.customer)),
    };
  }, [mods.oab, group, mods.customers]);

  const k = useMemo(() => computeKPIs(oabForKpis, { from: range.from, to: range.to, client }, ctx), [oabForKpis, range.from, range.to, client, rates, mods.prices, mods.jss]);

  const sales = [...k.periodInv, ...k.periodManual].sort((a, b) => (a.date < b.date ? 1 : -1));

  // Per-open-SO figures reused by the table and its Excel export. Age = days since
  // the PO date; SO margin = (sale − cost) × balance. (legacy dash 5109-5137)
  const openRow = (r) => {
    const b = balance(r);
    const pr = getPM(r.spec, mods.prices).price || 0;
    const cp = getCostPrice(r.spec, ctx) || 0;
    const soMargin = (pr > 0 && cp > 0) ? (pr - cp) * num(r.poQty) : null;   // × PO Qty, matching legacy (5120) + the SO-Margin KPI total
    const age = r.poDate ? Math.floor((Date.now() - new Date(r.poDate).getTime()) / 86400000) : null;
    return { b, pr, soMargin, age };
  };

  // Short-close rows (Loss of Business) with lost value = short-by × sale rate.
  // (legacy renderLOB 5247)
  let shortTotalLost = 0;
  const shortRows = k.shortClosed.map((r) => {
    const disp = num(r.invDisp) + num(r.manDisp);
    const shortBy = Math.max(0, num(r.poQty) - disp);
    const rate = getPM(r.spec, mods.prices).price || 0;
    const lostVal = shortBy * rate;
    shortTotalLost += lostVal;
    return { r, disp, shortBy, rate, lostVal };
  });

  function exportSales() {
    const rows = [['Invoice No', 'Date', 'Customer', 'PO #', 'Qty', 'Amount (₹)', 'Margin (₹)']];
    sales.forEach((s) => rows.push([(s.no || '') + (s.isManual ? ' (Manual)' : ''), fmtDate(s.date), s.customer || '', s.po || '', num(s.qty), Math.round(num(s.amount)), Math.round(num(s._dynMargin))]));
    exportAOA(rows, `Sales_${range.from}_to_${range.to}`, 'Sales');
  }
  function exportOpen() {
    const rows = [['SO#', 'Customer', 'Job Name', 'PO Date', 'PO Qty', 'Age (days)', 'Balance', 'Rate (₹)', 'Value (₹)', 'SO Margin (₹)']];
    k.openRows.forEach((r) => { const { b, pr, soMargin, age } = openRow(r); rows.push([r.so, r.customer || '', r.jobName || '', r.poDate || '', num(r.poQty), age == null ? '' : age, b, pr, Math.round(b * pr), soMargin == null ? '' : Math.round(soMargin)]); });
    exportAOA(rows, `Open_SOs_${range.from}_to_${range.to}`, 'Open SOs');
  }
  function exportShort() {
    const rows = [['SO#', 'Customer', 'Job Name', 'PO Date', 'Closed Date', 'PO Qty', 'Dispatched', 'Short By', 'Rate (₹)', 'Lost Value (₹)']];
    shortRows.forEach(({ r, disp, shortBy, rate, lostVal }) => rows.push([r.so, r.customer || '', r.jobName || '', r.poDate || '', r.closedDate || '', num(r.poQty), disp, shortBy, rate, Math.round(lostVal)]));
    exportAOA(rows, `Short_Closes_${range.from}_to_${range.to}`, 'Short Closes');
  }

  return (
    <>
      <div className="fbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="day">Today</option><option value="month">This Month</option><option value="last_month">Last Month</option><option value="custom">Custom</option>
        </select>
        {filter === 'custom' && <><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><span style={{ color: 'var(--i3)' }}>to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></>}
        <select value={group} onChange={(e) => setGroup(e.target.value)} title="Parent group — e.g. pick a group to see sales across all its locations"><option value="">All Groups</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</select>
        <select value={client} onChange={(e) => setClient(e.target.value)}><option value="">All Clients</option>{clients.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <span style={{ fontSize: 11, color: 'var(--i3)' }}>{range.from} → {range.to}</span>
      </div>

      <div className="stats">
        <KPI label="Sales (Invoiced)" value={rupees(k.salesTotal, 0)} cls="grn" sub={`${k.periodInv.length} invoice(s)${k.periodManual.length ? ' + ' + k.periodManual.length + ' manual' : ''} · ${dash(k.salesQty)} pcs`} />
        <KPI label="Open SO Value" value={rupees(k.openValue, 0)} cls="red" sub={`${k.openRows.length} SOs open`} />
        <KPI label="Carry Forward" value={rupees(k.cfValue, 0)} color="#B7791F" sub={`${k.cfRows.length} from prev periods`} />
        <KPI label="Short Close Loss" value={rupees(k.shortValue, 0)} cls="red" sub={`${k.shortClosed.length} short closed`} />
        <KPI label="Sale Margin" value={rupees(k.totalMargin, 0)} cls="grn" sub="(Sale − Cost) × Qty · view breakdown" onClick={() => setShowDrill((v) => !v)} />
        <KPI label="SO Margin (Open)" value={rupees(k.soMarginTotal, 0)} color={k.soMarginTotal >= 0 ? 'var(--g)' : 'var(--red)'} sub={`${k.soMarginSOCount} SOs · ${k.soMarginPct.toFixed(1)}%`} />
      </div>

      {showDrill && (
        <div className="card">
          <div className="ctitle">Sale Margin — per-line breakdown</div>
          <div className="tw sy" style={{ maxHeight: 280 }}>
            <table>
              <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Spec</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Margin</th></tr></thead>
              <tbody>
                {sales.flatMap((inv, ii) => (inv.items || [{ spec: inv.spec, rate: inv.rate, qty: inv.qty }]).map((it, j) => {
                  const cost = getCostPrice(it.spec, ctx);
                  return <tr key={ii + '-' + j}><td>{inv.no}{inv.isManual ? ' (M)' : ''}</td><td>{fmtDate(inv.date)}</td><td style={{ fontSize: 11 }}>{inv.customer}</td><td><span className="tag tb" style={{ fontSize: 9 }}>{it.spec}</span></td><td style={{ textAlign: 'right' }}>{dash(it.qty)}</td><td style={{ textAlign: 'right' }}>{inr(it.rate, 2)}</td><td style={{ textAlign: 'right' }}>{inr(cost, 2)}</td><td style={{ textAlign: 'right' }}>{rupees(((it.rate || 0) - cost) * it.qty, 0)}</td></tr>;
                }))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="fbar">
            <div className="ctitle" style={{ margin: 0 }}>Sales in Period</div>
            <span style={{ flex: 1 }} />
            <button className="btn btn-s" onClick={exportSales} disabled={sales.length === 0}>⬇ Export Excel</button>
          </div>
          <div className="tw sy" style={{ maxHeight: 340 }}>
            <table>
              <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Margin</th></tr></thead>
              <tbody>
                {sales.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No sales in this period</td></tr>
                  : sales.map((s, i) => <tr key={i}><td>{s.no}{s.isManual ? <span className="tag ty" style={{ fontSize: 8, marginLeft: 4 }}>M</span> : ''}</td><td>{fmtDate(s.date)}</td><td style={{ fontSize: 11 }}>{s.customer}</td><td style={{ textAlign: 'right' }}>{dash(s.qty)}</td><td style={{ textAlign: 'right' }}>{rupees(s.amount, 0)}</td><td style={{ textAlign: 'right' }}>{rupees(s._dynMargin, 0)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="fbar">
            <div className="ctitle" style={{ margin: 0 }}>Open Sales Orders</div>
            <span style={{ flex: 1 }} />
            <button className="btn btn-s" onClick={exportOpen} disabled={k.openRows.length === 0}>⬇ Export Excel</button>
          </div>
          <div className="tw sy" style={{ maxHeight: 340 }}>
            <table>
              <thead><tr><th>SO</th><th>Customer</th><th>Job</th><th style={{ textAlign: 'right' }}>PO Qty</th><th style={{ textAlign: 'right' }}>Age (d)</th><th style={{ textAlign: 'right' }}>Balance</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>SO Margin</th></tr></thead>
              <tbody>
                {k.openRows.length === 0 ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No open SOs</td></tr>
                  : k.openRows.map((r, i) => {
                    const { b, pr, soMargin, age } = openRow(r);
                    const ageColor = age == null ? 'var(--i3)' : age > 30 ? 'var(--red)' : age > 15 ? '#B7791F' : 'var(--g)';
                    return <tr key={i}><td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td><td style={{ fontSize: 11 }}>{r.customer}</td><td style={{ fontSize: 11 }}>{r.jobName}</td><td style={{ textAlign: 'right' }}>{dash(r.poQty)}</td><td style={{ textAlign: 'right', fontWeight: 600, color: ageColor }}>{age == null ? '-' : age}</td><td style={{ textAlign: 'right' }}>{dash(b)}</td><td style={{ textAlign: 'right' }}>{inr(pr, 2)}</td><td style={{ textAlign: 'right' }}>{rupees(b * pr, 0)}</td><td style={{ textAlign: 'right', fontWeight: 600, color: soMargin == null ? 'var(--i3)' : soMargin >= 0 ? 'var(--g)' : 'var(--red)' }}>{soMargin == null ? '-' : rupees(soMargin, 0)}</td></tr>;
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Short Closes / Loss of Business</div>
          <span style={{ flex: 1 }} />
          {shortRows.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)' }}>Lost: {rupees(shortTotalLost, 0)} ({shortRows.length} SOs)</span>}
          <button className="btn btn-s" onClick={exportShort} disabled={shortRows.length === 0}>⬇ Export Excel</button>
        </div>
        <div className="tw sy" style={{ maxHeight: 300 }}>
          <table>
            <thead><tr><th>SO#</th><th>Customer</th><th>Job</th><th>PO Date</th><th>Closed Date</th><th style={{ textAlign: 'right' }}>PO Qty</th><th style={{ textAlign: 'right' }}>Dispatched</th><th style={{ textAlign: 'right' }}>Short By</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right', color: 'var(--red)' }}>Lost Value</th></tr></thead>
            <tbody>
              {shortRows.length === 0 ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No short closes for this period</td></tr>
                : shortRows.map(({ r, disp, shortBy, rate, lostVal }, i) => (
                  <tr key={i}>
                    <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
                    <td style={{ fontSize: 11 }}>{r.customer || '-'}</td>
                    <td style={{ fontSize: 11 }}>{r.jobName || '-'}</td>
                    <td style={{ fontSize: 11 }}>{fmtDate(r.poDate)}</td>
                    <td style={{ fontSize: 11 }}>{fmtDate(r.closedDate)}</td>
                    <td style={{ textAlign: 'right' }}>{dash(r.poQty)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--g)' }}>{dash(disp)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--red)' }}>{shortBy > 0 ? dash(shortBy) : '-'}</td>
                    <td style={{ textAlign: 'right' }}>{rate > 0 ? inr(rate, 2) : '-'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--red)' }}>{lostVal > 0 ? rupees(lostVal, 0) : '-'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function KPI({ label, value, cls, color, sub, onClick }) {
  return (
    <div className="stat" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="sl">{label}</div>
      <div className={'sv' + (cls ? ' ' + cls : '')} style={color ? { color } : undefined}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--i3)' }}>{sub}</div>}
    </div>
  );
}

/* ─────────────────────────── Price Master ─────────────────────────── */
const TRANSPORT_OPTS = ['At Actuals', 'Customer', 'Bloomflex', 'Included'];
const PM_FILTERS = [{ k: 'all', label: 'All' }, { k: 'active', label: 'Active' }, { k: 'redundant', label: 'Redundant' }];

/**
 * Price Master — sale & cost per spec, with the live margin. (renderPMEdit 8134)
 *
 * Rows come from the JSS master, so a spec that appears under several
 * customers/job names is listed once per entry and is reachable by searching any
 * of them. Price data is keyed by TRIMMED spec, so those sibling rows always show
 * — and edit — the same figures. Specs that exist only in the Price Master (no
 * JSS row) are appended, so nothing priced is ever hidden.
 */
function PriceMaster() {
  const { mods, save } = useData();
  const [edits, setEdits] = useState(() => clone(mods.prices || {}));
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('all');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const rows = useMemo(() => {
    const jss = (mods.jss || []).filter((j) => String(j.spec || '').trim());
    const seen = new Set(jss.map((j) => String(j.spec).trim()));
    // Priced specs with no JSS entry still need a row, or they become uneditable.
    const orphans = Object.keys(edits).filter((sp) => sp && !seen.has(String(sp).trim()))
      .map((sp) => ({ spec: sp, _orphan: true }));
    return [...jss, ...orphans];
  }, [mods.jss, edits]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((j) => {
      if (statusF === 'active' && j.status !== 'Active') return false;
      if (statusF === 'redundant' && j.status !== 'Redundant') return false;
      if (!s) return true;
      return [j.spec, j.customer, j.jobName, j.subBrand].some((v) => String(v || '').toLowerCase().includes(s));
    });
  }, [rows, q, statusF]);

  const setCell = (spec, field, val) => setEdits((e) => ({
    ...e,
    [spec]: { price: 0, costPrice: 0, transport: 'At Actuals', ...e[spec], [field]: field === 'transport' ? val : num(val) },
  }));

  async function saveAll() {
    setBusy(true);
    try { await save('prices', edits); setMsg('✅ Price Master saved'); setTimeout(() => setMsg(''), 4000); }
    catch (e) { setMsg('Save failed: ' + e.message); } finally { setBusy(false); }
  }

  // Export the currently-visible rows with their live (edited) sale/cost/margin.
  // (legacy exportPMExcel 8259)
  function exportPM() {
    const header = ['Spec No.', 'Customer', 'Sub Brand', 'Job Name', 'Dispatch Form', 'Sale Price', 'Cost Price', 'Transport', 'Margin'];
    const body = filtered.map((j) => {
      const spec = String(j.spec).trim();
      const e = edits[spec] || {};
      const sp = num(e.price);
      const cp = num(e.costPrice);
      const margin = (sp && cp) ? +(sp - cp).toFixed(2) : '';
      return [spec, j.customer || '', j.subBrand || '', j.jobName || '', j.dispatchForm || '', sp || '', cp || '', e.transport || 'At Actuals', margin];
    });
    exportAOA([header, ...body], 'PriceMaster', 'Price Master');
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>Price Master — sale &amp; cost per spec</div>
        <input placeholder="Search spec / customer / job / sub-brand…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        {PM_FILTERS.map((f) => (
          <button key={f.k} className={'btn btn-s' + (statusF === f.k ? ' on' : '')} onClick={() => setStatusF(f.k)}
            style={statusF === f.k ? { background: 'var(--blu)', color: '#fff' } : undefined}>{f.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={exportPM} disabled={filtered.length === 0}>⬇ Export Excel</button>
        <button className="btn btn-g" onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : '💾 Save Price Master'}</button>
      </div>
      {msg && <div className="al al-g">{msg}</div>}
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead><tr>
            <th>Spec</th><th>Customer</th><th>Sub Brand</th><th style={{ minWidth: 220 }}>Job Name</th><th>Dispatch Form</th>
            <th style={{ width: 110, textAlign: 'right' }}>Sale ₹</th><th style={{ width: 110, textAlign: 'right' }}>Cost ₹</th>
            <th style={{ width: 120 }}>Transport</th><th style={{ width: 100, textAlign: 'right' }}>Margin</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No specs match</td></tr>
            ) : filtered.map((j, i) => {
              const spec = String(j.spec).trim();
              const e = edits[spec] || {};
              const sp = num(e.price);
              const cp = num(e.costPrice);
              // A margin needs BOTH figures — one alone would read as a full profit.
              const margin = (sp && cp) ? sp - cp : null;
              return (
                <tr key={spec + '|' + i}>
                  <td><span className="tag tb" style={{ fontSize: 10 }}>{spec}</span></td>
                  <td style={{ fontSize: 11 }}>{j.customer || '-'}</td>
                  <td style={{ fontSize: 11, color: 'var(--i3)' }}>{j.subBrand || '-'}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'normal', wordBreak: 'break-word' }}>{j.jobName || '-'}</td>
                  <td style={{ fontSize: 11 }}>{j.dispatchForm || '-'}</td>
                  <td><input type="number" step="0.01" aria-label={`Sale price for ${spec}`} value={e.price ?? ''} onChange={(ev) => setCell(spec, 'price', ev.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                  <td><input type="number" step="0.01" aria-label={`Cost price for ${spec}`} value={e.costPrice ?? ''} onChange={(ev) => setCell(spec, 'costPrice', ev.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                  <td>
                    <select value={e.transport ?? 'At Actuals'} aria-label={`Transport for ${spec}`} onChange={(ev) => setCell(spec, 'transport', ev.target.value)} style={{ width: '100%' }}>
                      {TRANSPORT_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: margin === null ? 'var(--i3)' : margin >= 0 ? 'var(--g)' : 'var(--red)' }}>
                    {margin === null ? '-' : '₹' + margin.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── JSS Editor ─────────────────────────── */
// Dispatch-form + status option lists, matching the legacy JSS editor.
// The built-in list the editor always offers; the Super Admin's "Dispatch Forms"
// drop-down list (Shrink Sleeve …) is merged in at render, so the JSS editor and
// QC's Add JSS Spec offer the same forms.
const JSS_DISP_FORMS = ['Pouch', 'Roll', 'Bulk Bags', 'Label', 'Sleeve', 'Punch', 'Lids', 'Roll Form'];
const JSS_STATUSES = ['Active', 'Sample', 'Inactive', 'Redundant'];
const JSS_STATUS_FILTERS = [['all', 'All Status'], ['active', 'Active Only'], ['sample', 'Sample Only'], ['inactive', 'Inactive Only'], ['redundant', 'Redundant Only']];
// Legacy JSS-editor look (renderJSSEdit): compact bordered cells + a green sticky header.
const jssInp = { width: '100%', height: 26, border: '1px solid #ddd', borderRadius: 4, padding: '0 5px', fontSize: 11, boxSizing: 'border-box' };
const jssTh = { padding: '7px 8px', textAlign: 'left', fontSize: 11, whiteSpace: 'nowrap', color: '#fff', background: 'var(--g)' };
const jssTd = { padding: '3px 5px' };
// [field, header label, min-width] — exact legacy column order (no Gusset; Spec editable).
const JSS_COLS = [
  ['spec', 'Spec No.*', 80], ['jobType', 'Job Type', 100], ['group', 'Group', 120], ['customer', 'Customer', 140],
  ['subBrand', 'Sub Brand', 100], ['jobName', 'Job Name*', 200], ['mic', 'MIC', 60],
  ['gsm', 'GSM', 60], ['material', 'Material*', 130], ['filmWidth', 'Film W', 70], ['width', 'W', 50],
  ['height', 'H', 50], ['pouchWeight', 'Pouch Wt (g)', 100], ['qtyPerBag', 'Qty/Bag', 70], ['dispatchForm', 'Disp Form*', 80],
  ['status', 'Status', 80],
];

function JssEditor() {
  const { mods, save } = useData();
  const customers = mods.customers || [];
  const [rows, setRows] = useState(() => clone(mods.jss || []));
  // The Material picker: every material already in use (one spelling per identity,
  // "CC PET + LDPE" and "cc pet +LDPE" being one) — so a spec picks a spelling
  // rather than inventing one.
  const materials = useMemo(() => knownMaterials([...(mods.jss || []), ...rows]), [mods.jss, rows]);
  const dispForms = useMemo(() => {
    const out = [...JSS_DISP_FORMS];
    effectiveDespatchList(mods.sales).forEach((f) => { if (!out.some((o) => o.toLowerCase() === String(f).toLowerCase())) out.push(f); });
    return out;
  }, [mods.sales]);
  const [q, setQ] = useState('');
  const [statusFil, setStatusFil] = useState('all');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Issues 22.09: the table is READ-ONLY and a RADIO picks the row to work on —
  // "I want a radio button selection against each of these rows. Just like a
  // customer item, I should be able to edit whatever data the QC has added in the
  // same format on the top". Typing straight into the grid is what let a spec be
  // half-edited (a dispatch form typed over, a spec code re-used), so the fields
  // are now the same guided ones QC creates a spec with.
  const [sel, setSel] = useState(-1);          // index into `rows`, -1 = nothing picked
  const [form, setForm] = useState(null);      // the picked row, being edited
  const [materialNew, setMaterialNew] = useState('');

  useEffect(() => { setRows(clone(mods.jss || [])); setSel(-1); setForm(null); }, [mods.jss]);

  // Group dropdown options come from the Customer Master (legacy jssGroupOptions).
  const groups = useMemo(() => custGroups(customers), [customers]);
  // A code on more than one row is a data fault: every screen now reads the same
  // row (specs.js), but the other copy is still there to be deleted.
  const dupes = useMemo(() => duplicateSpecs(rows), [rows]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  function pick(i) {
    setSel(i);
    setForm({ ...rows[i] });
    setMaterialNew('');
    setMsg('');
  }
  // Changing the Group repopulates the Company list; the company is kept only if it
  // still belongs to the new group (legacy jssGroupChange).
  function setFormGroup(v) {
    const stillValid = !form.customer || custsInGroup(customers, v).includes(form.customer);
    set({ group: v, customer: stillValid ? form.customer : '' });
  }
  function recalcPW() {
    const pw = pouchWeightJSS(form);
    if (pw) set({ pouchWeight: Number(pw.toFixed(6)) });
    else setMsg('Pouch weight needs Height, Width and GSM on this spec.');
  }

  const filtered = rows.map((r, i) => ({ r, i })).filter(({ r }) => {
    if (statusFil !== 'all' && String(r.status || '').toLowerCase() !== statusFil) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return [r.spec, r.customer, r.jobName, specGroup(r, customers), r.material, r.subBrand]
      .some((v) => String(v || '').toLowerCase().includes(s));
  });

  /** Write `next` to module 2 and carry the identity fields onto the OAB rows. */
  async function persist(next, note) {
    await save('jss', next);
    // Sync customer/subBrand/jobName — and the dispatch form and job type — onto OAB
    // rows sharing a spec (syncOABFromJSS). An SO copies the JSS at PO time; a spec
    // re-tagged afterwards (A1404: Label → Shrink Sleeve) must reach its open orders
    // too, or the OAB keeps showing the old form.
    const map = specIndex(next);
    const nextOab = clone(mods.oab); let dirty = false;
    ['SF', 'OT'].forEach((key) => (nextOab.OAB[key] || []).forEach((r) => {
      const j = map[specKey(r.spec)]; if (!j) return;
      ['customer', 'subBrand', 'jobName', 'dispatchForm', 'jobType'].forEach((f) => {
        if (j[f] && r[f] !== j[f]) { r[f] = j[f]; dirty = true; }
      });
    }));
    if (dirty) await save('oab', nextOab);
    setMsg(`✅ ${note}${dirty ? ' · OAB synced' : ''}`);
    setTimeout(() => setMsg(''), 4000);
  }

  /** Save the picked row back into the master. */
  async function saveRow() {
    const next = [...rows];
    const spec = String(form.spec || '').trim();
    if (!spec) { setMsg('A Spec No. is required.'); return; }
    if (!String(form.jobName || '').trim()) { setMsg('A Job Name is required.'); return; }
    const material = form.material === '__new__' ? materialLabel(materialNew) : String(form.material || '').trim();
    // Material is required the way QC requires it — but an OLD row that never had one
    // must not be held hostage over it: fixing this spec's status or dispatch form
    // should not mean inventing a material nobody recorded. Clearing one that IS
    // there is refused, because that is a loss.
    const hadMaterial = String((rows[sel] || {}).material || '').trim();
    if (!material && hadMaterial) { setMsg('Material cannot be cleared — pick the film this spec runs on.'); return; }
    if (!String(form.dispatchForm || '').trim()) { setMsg('A Dispatch Form is required.'); return; }
    // Re-using a code that another row already holds is how the master ended up with
    // two A1404s reading differently on different screens. Warn before allowing it.
    const clash = next.some((r, i) => i !== sel && specKey(r.spec) === specKey(spec));
    if (clash && !window.confirm(`Spec ${spec} is already on another row.\n\nTwo rows with one code disagree the moment either is edited — the tool will read the Active, most recent one and flag the pair. Keep this code anyway?`)) return;
    next[sel] = { ...form, spec, material };
    setBusy(true);
    try {
      setRows(next);
      await persist(next, `Spec ${spec} saved${!material ? ' (no material on this spec yet)' : ''}`);
      setForm({ ...next[sel] }); setMaterialNew('');
    }
    catch (e) { setMsg('Save failed: ' + e.message); } finally { setBusy(false); }
  }

  async function saveAll() {
    setBusy(true);
    try { await persist(rows, 'JSS saved'); }
    catch (e) { setMsg('Save failed: ' + e.message); } finally { setBusy(false); }
  }

  // Permanently delete a spec (legacy jssDeleteRow) — persists immediately.
  async function delRow(i) {
    const r = rows[i];
    if (!window.confirm(`Permanently delete spec "${r.spec || '(no spec no.)'}" — ${r.jobName || 'no job name'}?\n\nSale orders / FG history referencing it remain, but the spec is gone. This cannot be undone.`)) return;
    const next = rows.filter((_, j) => j !== i);
    setRows(next);
    if (sel === i) { setSel(-1); setForm(null); }
    else if (sel > i) { setSel(sel - 1); }
    setBusy(true);
    try { await save('jss', next); setMsg('🗑 Spec deleted'); setTimeout(() => setMsg(''), 4000); }
    catch (e) { setMsg('Delete failed: ' + e.message); } finally { setBusy(false); }
  }

  // Export the JSS master to Excel (legacy exportJSSExcel) and import it back
  // (legacy importJSSExcel) — rows are matched by Spec No., updated or appended.
  function exportJSS() {
    const header = JSS_COLS.map(([, label]) => label.replace('*', ''));
    exportAOA([header, ...rows.map((r) => JSS_COLS.map(([k]) => r[k] ?? ''))], 'JSS_Master', 'JSS');
  }
  async function importJSS(file) {
    if (!file) return;
    try {
      const aoa = await readSheetAOA(file);
      if (!aoa || aoa.length < 2) { setMsg('Import: no data rows found'); return; }
      const hdr = aoa[0].map((h) => String(h || '').trim().toLowerCase());
      const idxOf = {};
      JSS_COLS.forEach(([k, label]) => {
        let idx = hdr.indexOf(label.replace('*', '').trim().toLowerCase());
        if (idx < 0) idx = hdr.indexOf(k.toLowerCase());
        if (idx >= 0) idxOf[k] = idx;
      });
      if (idxOf.spec == null) { setMsg('Import: a "Spec No." column is required.'); return; }
      const next = [...rows]; let updated = 0, added = 0;
      for (let r = 1; r < aoa.length; r++) {
        const spec = String(aoa[r][idxOf.spec] ?? '').trim();
        if (!spec) continue;
        const patch = {}; Object.entries(idxOf).forEach(([k, idx]) => { patch[k] = String(aoa[r][idx] ?? '').trim(); });
        // match on the CODE's identity, so an import updates the row that is in force
        // instead of appending a second copy of it
        const at = next.findIndex((x) => specKey(x.spec) === specKey(spec));
        if (at >= 0) { next[at] = { ...next[at], ...patch }; updated++; } else { next.push(patch); added++; }
      }
      setRows(next); setSel(-1); setForm(null);
      setMsg(`Imported ${updated} updated, ${added} added — review, then Save All Changes.`);
    } catch (e) { setMsg('Import failed: ' + e.message); }
  }

  const custOpts = form ? custsInGroup(customers, form.group) : [];
  const inputStyle = { width: '100%' };

  return (
    <div className="card">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>📋 JSS Editor — edit JSS entries (changes reflect in QC JSS report)</div>
        <span style={{ flex: 1 }} />
        <input placeholder="Search spec / customer / job…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
        <select value={statusFil} onChange={(e) => setStatusFil(e.target.value)} aria-label="Status filter">
          {JSS_STATUS_FILTERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <button className="btn btn-g" onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : '💾 Save All Changes'}</button>
        <button className="btn btn-b" onClick={exportJSS}>⬇ Export Excel</button>
        <label className="btn btn-s" title="Import JSS specs (same columns as the export). Existing specs update by Spec No.; new ones are added.">
          ⬆ Import Excel
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { importJSS(e.target.files[0]); e.target.value = ''; }} />
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--i3)', margin: '2px 0 8px' }}>
        Pick a row with its radio button to edit it in the form above the table — the same fields QC creates a spec with. Fields marked * are required.
      </div>
      {msg && <div className={'al ' + (msg.startsWith('✅') || msg.startsWith('🗑') || msg.startsWith('Imported') ? 'al-g' : 'al-r')}>{msg}</div>}

      {/* A code held by two rows: every screen reads the same one now, but the other
          copy is still there and will keep disagreeing until it is deleted. */}
      {dupes.length > 0 && (
        <div className="al al-y" aria-label="Duplicate spec numbers">
          <strong>{dupes.length} spec number{dupes.length > 1 ? 's are' : ' is'} on more than one row.</strong>{' '}
          The tool reads the Active, most recent row of each; delete the stale one to stop them disagreeing.
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {dupes.slice(0, 8).map((d) => (
              <li key={d.code} style={{ fontSize: 11 }}>
                <strong>{d.code}</strong> — {d.count} rows
                {d.differing.length > 0 && <> · they disagree on {d.differing.map((f) => `${f.label} (${f.values.join(' / ')})`).join(', ')}</>}
                {' · in force: '}
                <span className="tag tg" style={{ fontSize: 9 }}>{d.winner.dispatchForm || '—'}{d.winner.status ? ` · ${d.winner.status}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── the picked row, edited the way QC creates one ─────────────────── */}
      {form ? (
        <div className="card" style={{ background: 'var(--bg)', marginBottom: 10 }} aria-label="Edit spec">
          <div className="ctitle">✏ Editing {form.spec || '(no spec no.)'} — {form.jobName || 'no job name'}</div>
          <div className="g4">
            <div className="fg">
              <label>Spec No. *</label>
              <input value={form.spec ?? ''} aria-label="Spec No." style={inputStyle} onChange={(e) => set({ spec: e.target.value })} />
            </div>
            <div className="fg">
              <label>Job Type</label>
              <input value={form.jobType ?? ''} aria-label="Job Type" style={inputStyle} onChange={(e) => set({ jobType: e.target.value })} />
            </div>
            <div className="fg">
              <label>Group</label>
              <select value={form.group ?? ''} aria-label="Group" onChange={(e) => setFormGroup(e.target.value)}>
                <option value="">— No group —</option>
                {form.group && !groups.includes(form.group) && <option value={form.group}>{form.group}</option>}
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Customer</label>
              <select value={form.customer ?? ''} aria-label="Customer" onChange={(e) => set({ customer: e.target.value })}>
                <option value="">— Select customer —</option>
                {form.customer && !custOpts.includes(form.customer) && <option value={form.customer}>{form.customer}</option>}
                {custOpts.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="g4">
            <div className="fg">
              <label>Sub Brand</label>
              <input value={form.subBrand ?? ''} aria-label="Sub Brand" style={inputStyle} onChange={(e) => set({ subBrand: e.target.value })} />
            </div>
            <div className="fg">
              <label>Job Name *</label>
              <input value={form.jobName ?? ''} aria-label="Job Name" style={inputStyle} onChange={(e) => set({ jobName: e.target.value })} />
            </div>
            <div className="fg">
              <label>Material *</label>
              <select value={form.material === '__new__' ? '__new__' : (form.material ?? '')} aria-label="Material" onChange={(e) => set({ material: e.target.value })}>
                <option value="">— select material —</option>
                {form.material && form.material !== '__new__' && !materials.includes(form.material) && <option value={form.material}>{form.material}</option>}
                {materials.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="__new__">＋ Add new material…</option>
              </select>
              {form.material === '__new__' && (
                <input placeholder="New material, e.g. CC PET + LDPE" value={materialNew} aria-label="New material"
                  style={{ marginTop: 6 }} onChange={(e) => setMaterialNew(e.target.value)} />
              )}
            </div>
            <div className="fg">
              <label>Dispatch Form *</label>
              <select value={form.dispatchForm ?? ''} aria-label="Dispatch Form" onChange={(e) => set({ dispatchForm: e.target.value })}>
                <option value="">—</option>
                {form.dispatchForm && !dispForms.includes(form.dispatchForm) && <option value={form.dispatchForm}>{form.dispatchForm}</option>}
                {dispForms.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div className="g4">
            <div className="fg"><label>MIC</label><input type="number" value={form.mic ?? ''} aria-label="MIC" style={inputStyle} onChange={(e) => set({ mic: e.target.value })} /></div>
            <div className="fg"><label>GSM</label><input type="number" value={form.gsm ?? ''} aria-label="GSM" style={inputStyle} onChange={(e) => set({ gsm: e.target.value })} /></div>
            <div className="fg"><label>Film Width</label><input type="number" value={form.filmWidth ?? ''} aria-label="Film Width" style={inputStyle} onChange={(e) => set({ filmWidth: e.target.value })} /></div>
            <div className="fg"><label>Ups</label><input type="number" value={form.ups ?? ''} aria-label="Ups" style={inputStyle} onChange={(e) => set({ ups: e.target.value })} /></div>
          </div>

          <div className="g4">
            <div className="fg"><label>Width</label><input type="number" value={form.width ?? ''} aria-label="Width" style={inputStyle} onChange={(e) => set({ width: e.target.value })} /></div>
            <div className="fg"><label>Height</label><input type="number" value={form.height ?? ''} aria-label="Height" style={inputStyle} onChange={(e) => set({ height: e.target.value })} /></div>
            <div className="fg"><label>Gusset</label><input value={form.gusset ?? ''} aria-label="Gusset" placeholder="e.g. 40 or 20+20" style={inputStyle} onChange={(e) => set({ gusset: e.target.value })} /></div>
            <div className="fg"><label>Qty per Bag (packing)</label><input type="number" value={form.qtyPerBag ?? ''} aria-label="Qty per Bag" style={inputStyle} onChange={(e) => set({ qtyPerBag: e.target.value })} /></div>
          </div>

          <div className="g4">
            <div className="fg">
              <label>Pouch Weight (g)</label>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <input value={form.pouchWeight ?? ''} aria-label="Pouch Weight" placeholder="auto or enter manually"
                  style={{ flex: 1 }} onChange={(e) => set({ pouchWeight: e.target.value })} />
                <button type="button" className="btn btn-g" onClick={recalcPW} aria-label="Auto-calculate pouch weight"
                  title="Calculate from Height, Width, Gusset & GSM" style={{ height: 32, width: 32, flexShrink: 0, padding: 0 }}>↺</button>
              </div>
            </div>
            <div className="fg">
              <label>Status</label>
              <select value={form.status ?? ''} aria-label="Status" onChange={(e) => set({ status: e.target.value })}>
                <option value="">—</option>
                {JSS_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="fg" />
            <div className="fg" />
          </div>

          <div className="act">
            <button className="btn btn-g" onClick={saveRow} disabled={busy}>{busy ? 'Saving…' : '💾 Save spec'}</button>
            <button className="btn btn-s" disabled={busy} onClick={() => { setSel(-1); setForm(null); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="al al-b">Pick a row below with its radio button to edit that spec here.</div>
      )}

      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr style={{ background: 'var(--g)' }}>
              <th style={{ ...jssTh, minWidth: 34, textAlign: 'center' }}>Edit</th>
              {JSS_COLS.map(([k, label, w]) => <th key={k} style={{ ...jssTh, minWidth: w }}>{label}</th>)}
              <th style={{ ...jssTh, minWidth: 60, textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={JSS_COLS.length + 2} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No specs match</td></tr>
            ) : filtered.map(({ r, i }, idx) => {
              const dup = dupes.some((d) => d.code === specKey(r.spec));
              return (
                <tr key={i} style={{ background: sel === i ? 'var(--gl)' : (idx % 2 ? '#f8f8f8' : '') }}>
                  <td style={{ ...jssTd, textAlign: 'center' }}>
                    <input type="radio" name="jss-row" checked={sel === i} onChange={() => pick(i)}
                      aria-label={`Edit ${r.spec || 'row ' + (i + 1)}`} style={{ cursor: 'pointer' }} />
                  </td>
                  {JSS_COLS.map(([k]) => (
                    <td key={k} style={{ ...jssTd, fontSize: 11, padding: '5px 5px' }}>
                      {k === 'spec' && dup
                        ? <span title="This spec number is on more than one row">{r[k]} <span className="tag ty" style={{ fontSize: 8 }}>dup</span></span>
                        : (r[k] === 0 ? '0' : (r[k] || ''))}
                    </td>
                  ))}
                  <td style={{ ...jssTd, textAlign: 'center' }}>
                    <button title="Permanently delete this spec" disabled={busy} onClick={() => delRow(i)}
                      style={{ height: 26, padding: '0 10px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Del</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Delete SOs ─────────────────────────── */
function DeleteSOs() {
  const { mods, save, reloadModule } = useData();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  // JSS is authoritative for customer / sub-brand / SKU (job) names: show the current
  // spec's values, not the copy stored on the row when the SO was created, so a repointed
  // spec shows the right SKU here too (mirrors OabBoard's openRows enrichment).
  const jssBySpec = useMemo(() => specIndex(mods.jss), [mods.jss]);
  // Issues 3.0 §7: only LIVE orders are listed. A closed SO is finished business —
  // editing or deleting one is not something this tab is for, and the closed rows
  // (the bulk of the OAB) buried the handful that can actually be worked on.
  const allRows = ['SF', 'OT'].flatMap((key) => (mods.oab?.OAB?.[key] || []).map((r) => {
    const j = jssBySpec[r.spec];
    return j ? { ...r, _key: key, customer: j.customer || r.customer, subBrand: j.subBrand || r.subBrand, jobName: j.jobName || r.jobName } : { ...r, _key: key };
  }));
  const closedCount = allRows.filter((r) => r.closed).length;
  const rows = allRows
    .filter((r) => !r.closed)
    .filter((r) => !q || [r.so, r.customer, r.jobName, r.spec].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase())));

  // Delete goes through the granular server endpoint, not a whole-blob save: the
  // module-1 3-way merge would otherwise re-add the row and silently undo the delete.
  async function del(so) {
    if (!window.confirm(`Delete SO ${so}? This removes the order row (invoices are not affected). This cannot be undone.`)) return;
    setBusy(true);
    try { await ordersApi.deleteRow(so); await reloadModule('oab'); }
    catch (e) { alert('Delete failed: ' + e.message); } finally { setBusy(false); }
  }

  // Edit an SO's PO#, PO Date and Dispatch Location, then persist through the
  // normal module-1 save. Unlike delete, an edit is a field change, so the 3-way
  // merge keeps exactly what we changed (base vs mine differ only on those
  // fields → mine wins) without clobbering anyone else's work. (legacy editSOPONum 3623)
  async function editPO(row) {
    const newPO = window.prompt(`Edit PO number for SO ${row.so} (${row.customer || ''}):`, row.poNum || '');
    if (newPO === null) return;
    const newDate = window.prompt(`Edit PO Date for SO ${row.so} (YYYY-MM-DD):`, row.poDate || '');
    if (newDate === null) return;
    const newLoc = window.prompt(`Edit Dispatch Location for SO ${row.so}:`, row.dispLoc || '');
    if (newLoc === null) return;
    // The customer revises the quantity on a PO often enough that re-keying the whole
    // order was the only way to record it. It is the one field here that MOVES money and
    // material: the balance still to make is poQty minus what has gone out, the BOM
    // requirement scales off it, and a short-close is judged against it. So unlike the
    // other three it is checked rather than taken as typed.
    const already = num(row.invDisp) + num(row.manDisp) + num(row.fg);
    const newQtyRaw = window.prompt(
      `Edit PO Qty for SO ${row.so} (${row.customer || ''}).\n\nCurrent: ${row.poQty}`
      + (already ? `\nAlready dispatched: ${already} — the new quantity cannot be less than this.` : ''),
      String(row.poQty ?? ''));
    if (newQtyRaw === null) return;
    const newQty = Number(String(newQtyRaw).trim());
    if (!Number.isFinite(newQty) || newQty <= 0) { alert('PO Qty must be a number greater than zero.'); return; }
    if (newQty < already) {
      alert(`PO Qty cannot be ${newQty}: ${already} has already been dispatched against this order.`
        + '\n\nTo reduce it below what has gone out, reverse the dispatch first.');
      return;
    }
    const next = clone(mods.oab);
    const arr = (next.OAB && next.OAB[row._key]) || [];
    const target = arr.find((x) => x.so === row.so);
    if (!target) { alert('SO not found — the list may be out of date.'); return; }
    target.poNum = newPO.trim();
    target.poDate = newDate.trim();
    target.dispLoc = newLoc.trim();
    target.poQty = newQty;
    setBusy(true);
    try { await save('oab', next); }
    catch (e) { alert('Update failed: ' + e.message); } finally { setBusy(false); }
  }

  // Re-point an SO to a different spec (superadmin). The new spec must exist in the JSS
  // master; the row's SKU (job name), customer and sub-brand are pulled from that spec —
  // same as a freshly created SO (NewPO) — so the stored row matches it. Display already
  // derives these live, but writing them keeps exports / PDF / backup correct too.
  // Persisted through the normal module-1 save; like Edit PO# it's a field change, so the
  // 3-way merge keeps it (mine wins) without clobbering anyone else's work.
  async function editSpec(row) {
    const entry = window.prompt(`Change Spec for SO ${row.so} (${row.customer || ''}).\nCurrent spec: ${row.spec || '(none)'}\n\nEnter the new Spec No. (must already exist in the JSS master):`, row.spec || '');
    if (entry === null) return;
    const spec = entry.trim();
    if (!spec) { alert('Spec cannot be blank.'); return; }
    if (spec === String(row.spec || '').trim()) return;   // unchanged
    const j = specFor(mods.jss, spec);
    if (!j) { alert(`Unknown spec "${spec}" — it is not in the JSS master. Add it in the JSS Editor first.`); return; }
    if (!window.confirm(`Re-point SO ${row.so} to spec ${spec}?\n\nSKU (Job Name) becomes: ${j.jobName || '(blank)'}\nCustomer: ${j.customer || row.customer || '(unchanged)'}`)) return;
    const next = clone(mods.oab);
    const arr = (next.OAB && next.OAB[row._key]) || [];
    const target = arr.find((x) => x.so === row.so);
    if (!target) { alert('SO not found — the list may be out of date.'); return; }
    target.spec = spec;
    if (j.jobName) target.jobName = j.jobName;
    if (j.customer) target.customer = j.customer;
    if (j.subBrand) target.subBrand = j.subBrand;
    setBusy(true);
    try { await save('oab', next); }
    catch (e) { alert('Update failed: ' + e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>Delete / Edit Sales Orders <span className="tag tgr" style={{ fontSize: 9 }}>{rows.length} live</span></div>
        <input placeholder="Search SO / customer / job…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="al al-y">Only <strong>live (open)</strong> sales orders are listed{closedCount ? <> — {closedCount} closed order{closedCount === 1 ? '' : 's'} {closedCount === 1 ? 'is' : 'are'} hidden because a closed order cannot be edited or deleted here</> : null}. Deleting an SO removes it from the OAB permanently. Invoices already raised are not affected. Use ✎ Edit Spec to move an order to a different spec (its SKU, customer and sub-brand follow the new spec) or ✎ Edit PO# to correct the PO number, PO date, dispatch location or PO quantity — without deleting the order. A revised PO quantity cannot be set below what has already been dispatched.</div>
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 320px)' }}>
        <table>
          <thead><tr><th>SO</th><th>Sheet</th><th>Spec</th><th>Customer</th><th>Job</th><th>PO#</th><th>PO Date</th><th style={{ textAlign: 'right' }}>PO Qty</th><th style={{ textAlign: 'right' }}>Dispatched</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>
                {q ? 'No live sales orders match your search' : 'No live sales orders — every order in the OAB is closed'}
              </td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i}><td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td><td>{r._key}</td><td><span className="tag tb" style={{ fontSize: 9 }}>{r.spec}</span></td><td style={{ fontSize: 11 }}>{r.customer}</td><td style={{ fontSize: 11 }}>{r.jobName}</td><td style={{ fontSize: 11 }}>{r.poNum || '-'}</td><td style={{ fontSize: 11 }}>{fmtDate(r.poDate)}</td><td style={{ textAlign: 'right' }}>{dash(r.poQty)}</td><td style={{ textAlign: 'right', color: 'var(--g)' }}>{dash(num(r.invDisp) + num(r.manDisp))}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 7px', marginRight: 6 }} disabled={busy} onClick={() => editSpec(r)}>✎ Edit Spec</button>
                  <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 7px', marginRight: 6 }} disabled={busy} onClick={() => editPO(r)}>✎ Edit PO#</button>
                  <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 7px', color: 'var(--red)', borderColor: '#F5A8A0' }} disabled={busy} onClick={() => del(r.so)}>Delete</button>
                </td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Trends & Forecast ─────────────────────────── */
const rt = { textAlign: 'right' };
const emptyTd = { textAlign: 'center', padding: 16, color: 'var(--i3)' };

function Trends() {
  const { mods } = useData();
  const jssBySpec = useMemo(() => specIndex(mods.jss), [mods.jss]);
  const openRows = useMemo(() => ['SF', 'OT'].flatMap((k) => (mods.oab?.OAB?.[k] || [])).filter((r) => !r.closed), [mods.oab]);
  // What the material table is worked out from: the open-SO balance (what is on the
  // OAB and not yet made), or ONLY the projections entered on the Projections page —
  // "the material that is needed for the projections that have been included" —
  // month by month, or every projected month at once.
  const [matBasis, setMatBasis] = useState('open');
  const [matMonth, setMatMonth] = useState('all');
  const projMonths = useMemo(() => projectedMonths(mods.projections).slice().sort(), [mods.projections]);
  // The projection rows that feed the table: reconciled against the OAB so what has
  // already arrived (and so sits on the open-SO side) is not counted twice.
  const projRows = useMemo(() => {
    if (matBasis !== 'proj') return [];
    const months = matMonth === 'all' ? projMonths : [matMonth];
    return months.flatMap((m) => reconcileMonth(mods.projections, mods.oab, m).rows.map((r) => ({ ...r, month: m })));
  }, [matBasis, matMonth, projMonths, mods.projections, mods.oab]);
  const projNoSpec = useMemo(() => projRows.filter((r) => !r.spec || !jssBySpec[r.spec]), [projRows, jssBySpec]);

  const byCustomer = useMemo(() => {
    const map = {};
    openRows.forEach((r) => {
      const c = r.customer || '—';
      const m = map[c] || (map[c] = { customer: c, orders: 0, poQty: 0, balQty: 0, value: 0, balValue: 0 });
      const rate = getPM(r.spec, mods.prices).price || 0;
      m.orders++; m.poQty += num(r.poQty); m.balQty += balance(r);
      // §37: PO value AND Balance value, listed separately side by side.
      m.value += num(r.poQty) * rate;
      m.balValue += balance(r) * rate;
    });
    return Object.values(map).sort((a, b) => b.poQty - a.poQty);
  }, [openRows, mods.prices]);

  const byMaterial = useMemo(() => {
    const map = {};
    // One line per material IDENTITY and film width. The material is the JSS's, and
    // "CC PET + LDPE" / "cc pet +LDPE" are the same film, not two — the key ignores
    // case, spacing and punctuation and the line reads under the tidy spelling.
    const add = (r, q, j, month) => {
      const rawMat = j.material || r.material || '';
      const mk = rawMat ? materialKey(rawMat) : '';
      const mat = mk ? materialLabel(rawMat) : '—';
      const fw = num(j.filmWidth || r.filmWidth);
      const gsm = num(j.gsm || r.gsm);
      const key = (month || '') + '|' + (mk || '—') + '|' + fw;
      const m = map[key] || (map[key] = { month: month || '', material: mat, filmWidth: fw, gsm, mic: j.mic || r.mic || '', metres: 0, jobs: 0 });
      m.metres += calcMetres(r, q, j).net;
      m.jobs++;
      if (!m.gsm && gsm) m.gsm = gsm;
    };
    if (matBasis === 'proj') {
      projRows.forEach((r) => {
        const j = jssBySpec[r.spec];
        if (!j) return;                         // a lead, or a spec the master no longer has — reported below
        if (!(num(r.remaining) > 0)) return;    // the orders already in cover it
        add({}, r.remaining, j, matMonth === 'all' ? r.month : '');
      });
    } else {
      openRows.forEach((r) => add(r, balance(r), jssBySpec[r.spec] || {}, ''));
    }
    return Object.values(map).map((m) => {
      const kpm = m.gsm > 0 && m.filmWidth > 0 ? (m.filmWidth / 1000) * (m.gsm / 1000) : 0;
      const reqKg = Math.round(m.metres * kpm * 10) / 10;
      return { ...m, reqKg, bufferKg: Math.round(reqKg * 1.1 * 10) / 10 };
    }).sort((a, b) => a.month.localeCompare(b.month) || a.material.localeCompare(b.material) || a.filmWidth - b.filmWidth);
  }, [openRows, jssBySpec, matBasis, matMonth, projRows]);
  const showMonth = matBasis === 'proj' && matMonth === 'all';

  function exportByCustomer() {
    const rows = [['Customer', 'Open SOs', 'PO Qty', 'PO Value (₹)', 'Balance Qty', 'Balance Value (₹)']];
    byCustomer.forEach((c) => rows.push([c.customer, c.orders, c.poQty, Math.round(c.value), c.balQty, Math.round(c.balValue)]));
    exportAOA(rows, 'Orders_by_Customer', 'Orders by Customer');
  }
  function exportMaterial() {
    const rows = [[...(showMonth ? ['Month'] : []), 'Material', 'Film Width (mm)', 'Mic', 'GSM', matBasis === 'proj' ? 'Projected Metres (still to come)' : 'Open Metres', 'Required Kg', '+10% Buffer Kg']];
    byMaterial.forEach((m) => rows.push([...(showMonth ? [monthLabel(m.month)] : []), m.material, m.filmWidth || '', m.mic || '', m.gsm || '', m.metres, m.reqKg, m.bufferKg]));
    exportAOA(rows, matBasis === 'proj' ? `Material_Projection_${matMonth === 'all' ? 'all_months' : matMonth}` : 'Material_Projection', 'Material Projection');
  }

  return (
    <>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Orders by Customer (open SOs)</div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={exportByCustomer} disabled={byCustomer.length === 0}>⬇ Excel</button>
        </div>
        <div className="tw sy" style={{ maxHeight: 300 }}>
          <table>
            <thead><tr><th>Customer</th><th style={rt}>Open SOs</th><th style={rt}>PO Qty</th><th style={rt}>PO Value (₹)</th><th style={rt}>Balance Qty</th><th style={rt}>Balance Value (₹)</th></tr></thead>
            <tbody>
              {byCustomer.length === 0 ? <tr><td colSpan={6} style={emptyTd}>No open orders</td></tr>
                : byCustomer.map((c, i) => <tr key={i}><td style={{ fontSize: 11 }}>{c.customer}</td><td style={rt}>{c.orders}</td><td style={rt}>{dash(c.poQty)}</td><td style={rt}>{rupees(c.value, 0)}</td><td style={rt}>{dash(c.balQty)}</td><td style={rt}>{rupees(c.balValue, 0)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="fbar" style={{ flexWrap: 'wrap' }}>
          <div className="ctitle" style={{ margin: 0 }}>Material Projection / Next-Order Forecast</div>
          <span style={{ flex: 1 }} />
          <select value={matBasis} onChange={(e) => setMatBasis(e.target.value)} aria-label="Material basis" style={{ height: 26, fontSize: 11 }}>
            <option value="open">From open-SO balance</option>
            <option value="proj">Only projections</option>
          </select>
          {matBasis === 'proj' && (
            <select value={matMonth} onChange={(e) => setMatMonth(e.target.value)} aria-label="Projection month" style={{ height: 26, fontSize: 11 }}>
              <option value="all">Every projected month</option>
              {projMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          )}
          <button className="btn btn-s" onClick={exportMaterial} disabled={byMaterial.length === 0}>⬇ Excel</button>
        </div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          {matBasis === 'proj'
            ? <>The film the <b>projections</b> on the Projections page still need, by the JSS material of each spec — what is still to come, net of the orders that have already arrived (those sit on the open-SO side). A projection from a lead has no JSS yet and cannot be costed.</>
            : <>The film the <b>open sale orders</b> still need, by the JSS material of each spec. Material is read from the JSS; spellings that differ only in case or spacing are one line.</>}
        </div>
        {matBasis === 'proj' && projNoSpec.length > 0 && (
          <div className="al al-y" style={{ fontSize: 11 }}>
            <b>{projNoSpec.length} projection(s) left out</b> — no JSS number (a lead) or a spec the master no longer has:{' '}
            {projNoSpec.slice(0, 8).map((r) => `${r.customer || r.group || '?'} — ${r.jobName || r.spec || '(no SKU)'}${matMonth === 'all' ? ` (${monthLabel(r.month)})` : ''}`).join('; ')}{projNoSpec.length > 8 ? ' …' : ''}
          </div>
        )}
        <div className="tw sy" style={{ maxHeight: 360 }}>
          <table aria-label="Material projection">
            <thead><tr>{showMonth && <th>Month</th>}<th>Material</th><th style={rt}>Film Width</th><th style={rt}>Mic</th><th style={rt}>GSM</th><th style={rt}>{matBasis === 'proj' ? 'Projected Metres' : 'Open Metres'}</th><th style={rt}>Required Kg</th><th style={rt}>+10% Buffer</th></tr></thead>
            <tbody>
              {byMaterial.length === 0 ? <tr><td colSpan={showMonth ? 8 : 7} style={emptyTd}>{matBasis === 'proj' ? 'Nothing projected with a JSS that still needs material' : 'No data'}</td></tr>
                : byMaterial.map((m, i) => <tr key={i}>{showMonth && <td style={{ fontSize: 11 }}>{monthLabel(m.month)}</td>}<td style={{ fontSize: 11, fontWeight: 600 }}>{m.material}</td><td style={rt}>{m.filmWidth ? m.filmWidth + 'mm' : '-'}</td><td style={rt}>{m.mic || '-'}</td><td style={rt}>{m.gsm || '-'}</td><td style={rt}>{dash(m.metres)} m</td><td style={{ ...rt, fontWeight: 700, color: 'var(--g)' }}>{m.reqKg} kg</td><td style={{ ...rt, fontWeight: 700, background: 'var(--gl)' }}>{m.bufferKg} kg</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── SO Costing ─────────────────────────── */
function SOCosting() {
  const { mods } = useData();
  const [so, setSo] = useState('');
  const [wastageKg, setWastageKg] = useState('');
  const [manpower, setManpower] = useState('');
  const [power, setPower] = useState('');
  const [matRates, setMatRates] = useState({ bopp: 0, afbopp: 0, afldpe: 0 });
  useEffect(() => { rmRatesApi.get().then((r) => setMatRates((cur) => ({ ...cur, ...r }))).catch(() => {}); }, []);
  const ctx = { prices: mods.prices, jss: mods.jss, matRates };
  const allRows = useMemo(() => ['SF', 'OT'].flatMap((k) => (mods.oab?.OAB?.[k] || [])), [mods.oab]);
  const allSOs = useMemo(() => [...allRows].sort((a, b) => (a.so > b.so ? 1 : -1)), [allRows]);
  const r = allRows.find((x) => x.so === so);

  const lines = useMemo(() => {
    if (!r) return [];
    const invs = (mods.oab?.INV_REG || []).filter((inv) => inv.items && inv.items.some((it) => it.spec === r.spec) && inv.po === r.poNum);
    const out = [];
    invs.forEach((inv) => (inv.items || []).filter((it) => it.spec === r.spec).forEach((it) => {
      const cost = getCostPrice(it.spec, ctx);
      const value = (it.rate || 0) * (it.qty || 0);
      out.push({ invNo: inv.no, date: inv.date, spec: it.spec, qty: it.qty, rate: it.rate, value, cost, margin: ((it.rate || 0) - cost) * (it.qty || 0), marginPct: it.rate > 0 ? ((it.rate - cost) / it.rate * 100) : 0 });
    }));
    return out;
  }, [r, mods.oab]);

  const totQty = lines.reduce((s, x) => s + num(x.qty), 0);
  const totVal = lines.reduce((s, x) => s + x.value, 0);
  const totMargin = lines.reduce((s, x) => s + x.margin, 0);
  const avgMPct = totVal > 0 ? (totMargin / totVal * 100) : 0;

  const mat = String((specFor(mods.jss, r && r.spec) || {}).material || '').toLowerCase().trim();
  const R = ctx.matRates;
  let rmRate = 0;
  if (mat.includes('af-bopp') || mat.includes('af_bopp')) rmRate = num(R.afbopp);
  else if (mat === 'bopp' || mat === 'plain bopp') rmRate = num(R.bopp);
  else if (mat.includes('ldpe')) rmRate = num(R.afldpe);
  const wastageCost = num(wastageKg) * rmRate;
  const addl = wastageCost + num(manpower) + num(power);
  const netMargin = totMargin - addl;
  const netMarginPct = totVal > 0 ? (netMargin / totVal * 100) : 0;

  // Export the per-invoice costing lines plus the additional-cost / net-margin
  // block for the selected SO. (legacy exportSOCosting 5679)
  function exportCosting() {
    if (!r) return;
    const header = ['Invoice No', 'Date', 'Spec', 'Job Name', 'Qty', 'Rate (₹)', 'Value (₹)', 'Cost/pc (₹)', 'Margin (₹)', 'Margin %'];
    const body = lines.map((x) => [x.invNo, x.date, x.spec, r.jobName || '', num(x.qty), x.rate || 0, Math.round(x.value), x.cost, Math.round(x.margin), +x.marginPct.toFixed(1)]);
    if (addl > 0) {
      body.push(['', '', '', '', '', '', '', '', '', '']);
      body.push(['ADDITIONAL COSTS', '', '', '', '', '', '', '', '', '']);
      if (num(wastageKg)) body.push(['Material Wastage', '', '', '', num(wastageKg) + ' kg', '', '', '', Math.round(wastageCost), '']);
      if (num(manpower)) body.push(['Manpower', '', '', '', '', '', '', '', num(manpower), '']);
      if (num(power)) body.push(['Power & Depreciation', '', '', '', '', '', '', '', num(power), '']);
      body.push(['NET MARGIN', '', '', '', '', '', '', '', Math.round(netMargin), +netMarginPct.toFixed(1)]);
    }
    exportAOA([header, ...body], `SO_Costing_${String(so).replace(/[^a-zA-Z0-9-_]/g, '')}`, 'SO Costing');
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>SO Costing</div>
        <select value={so} onChange={(e) => setSo(e.target.value)} style={{ minWidth: 320 }}>
          <option value="">Select SO…</option>
          {allSOs.map((x) => <option key={x.so} value={x.so}>{x.so} — {x.customer || ''}{x.jobName ? ' · ' + String(x.jobName).slice(0, 25) : ''}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={exportCosting} disabled={!r || lines.length === 0}>⬇ Export</button>
      </div>
      {!r ? <div className="pg-sub" style={{ margin: 0 }}>Pick a sales order to see its per-invoice margin and net costing.</div> : (
        <>
          <div className="stats">
            <KPI label="PO Qty" value={dash(r.poQty)} />
            <KPI label="Invoiced Qty" value={dash(totQty)} cls="grn" />
            <KPI label="Balance" value={dash(balance(r))} cls="red" />
            <KPI label="Total Revenue" value={rupees(totVal, 0)} />
            <KPI label="Total Margin" value={rupees(totMargin, 0)} cls="grn" />
            <KPI label="Margin %" value={avgMPct.toFixed(1) + '%'} color={avgMPct > 20 ? 'var(--g)' : avgMPct > 10 ? '#B7791F' : 'var(--red)'} />
          </div>
          <div className="tw sy" style={{ maxHeight: 260 }}>
            <table>
              <thead><tr><th>Invoice</th><th>Date</th><th>Spec</th><th style={{ minWidth: 130 }}>Job Name</th><th style={rt}>Qty</th><th style={rt}>Rate</th><th style={rt}>Value</th><th style={rt}>Cost</th><th style={rt}>Margin</th><th style={rt}>Margin %</th></tr></thead>
              <tbody>
                {lines.length === 0 ? <tr><td colSpan={10} style={emptyTd}>No invoices for this SO yet</td></tr>
                  : lines.map((x, i) => <tr key={i}><td style={{ fontSize: 11, fontWeight: 600, color: 'var(--g)' }}>{x.invNo}</td><td style={{ fontSize: 11 }}>{fmtDate(x.date)}</td><td><span className="tag tb" style={{ fontSize: 9 }}>{x.spec}</span></td><td style={{ fontSize: 11 }}>{r.jobName || '-'}</td><td style={rt}>{dash(x.qty)}</td><td style={rt}>{inr(x.rate, 2)}</td><td style={{ ...rt, fontWeight: 600 }}>{rupees(x.value, 0)}</td><td style={{ ...rt, color: 'var(--i3)' }}>{inr(x.cost, 2)}</td><td style={{ ...rt, fontWeight: 600, color: 'var(--g)' }}>{rupees(x.margin, 0)}</td><td style={{ ...rt, fontWeight: 600 }}>{x.marginPct.toFixed(1)}%</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="ctitle">Additional Costs → Net Margin</div>
            <div className="g4">
              <div className="fg"><label>Wastage (kg){rmRate ? ` · ₹${rmRate}/kg` : ''}</label><input type="number" value={wastageKg} onChange={(e) => setWastageKg(e.target.value)} /></div>
              <div className="fg"><label>Manpower (₹)</label><input type="number" value={manpower} onChange={(e) => setManpower(e.target.value)} /></div>
              <div className="fg"><label>Power &amp; Depreciation (₹)</label><input type="number" value={power} onChange={(e) => setPower(e.target.value)} /></div>
              <div className="fg"><label>&nbsp;</label><div style={{ fontSize: 13, fontWeight: 700, color: netMargin >= 0 ? 'var(--g)' : 'var(--red)' }}>Net Margin: {rupees(netMargin, 0)} ({netMarginPct.toFixed(1)}%)</div></div>
            </div>
            {addl > 0 && <div className="pg-sub" style={{ margin: 0 }}>Wastage ₹{Math.round(wastageCost).toLocaleString('en-IN')} + Manpower ₹{num(manpower).toLocaleString('en-IN')} + Power ₹{num(power).toLocaleString('en-IN')} = Total Addl ₹{Math.round(addl).toLocaleString('en-IN')}</div>}
          </div>
        </>
      )}
    </div>
  );
}
