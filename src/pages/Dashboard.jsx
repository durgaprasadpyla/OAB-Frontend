import { useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { rmRatesApi, adminApi, field } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { balance, num, calcMetres } from '../lib/calc.js';
import { getPM, getCostPrice } from '../lib/pricing.js';
import { computeKPIs, dashRange } from '../lib/dashboard.js';
import { dash, rupees, fmtDate, inr } from '../lib/format.js';
import { exportAOA, readSheetAOA } from '../lib/xlsx.js';
import { STAGES } from '../lib/constants.js';
import UsersAccess from '../components/UsersAccess.jsx';
import CustomersAdmin from '../components/CustomersAdmin.jsx';

const clone = (o) => JSON.parse(JSON.stringify(o));

const TABS = [
  { k: 'summary', label: '📈 Summary' },
  { k: 'price', label: '💰 Price Master' },
  { k: 'jss', label: '📋 JSS Editor' },
  { k: 'customers', label: '🏢 Customers' },
  { k: 'delete', label: '🗑 Delete SOs' },
  { k: 'trends', label: '📊 Trends & Forecast' },
  { k: 'costing', label: '🧮 SO Costing' },
  { k: 'users', label: '👥 Users & Access' },
  { k: 'audit', label: '🧾 Audit Log' },
  { k: 'system', label: '🛠 System' },
];

/** Superadmin Dashboard — native port of renderDashboard + its sub-panels. */
export default function Dashboard() {
  const [tab, setTab] = useState('summary');
  return (
    <div id="app">
      <div className="pg-ttl">Dashboard</div>
      <div className="pg-sub">Gross margins, sales, projections and master-data editing — super-admin only.</div>
      <div className="step-bar" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
        ))}
      </div>
      {tab === 'summary' && <Summary />}
      {tab === 'price' && <PriceMaster />}
      {tab === 'jss' && <JssEditor />}
      {tab === 'customers' && <CustomersAdmin />}
      {tab === 'delete' && <DeleteSOs />}
      {tab === 'trends' && <Trends />}
      {tab === 'costing' && <SOCosting />}
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
function Summary() {
  const { mods, save } = useData();
  const [filter, setFilter] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [client, setClient] = useState('');
  const [rates, setRates] = useState({ bopp: 0, afbopp: 0, afldpe: 0 });
  const [showDrill, setShowDrill] = useState(false);
  const [msg, setMsg] = useState('');

  // RM ₹/kg rates are server-side now (shared across devices), not localStorage.
  useEffect(() => { rmRatesApi.get().then((r) => setRates((cur) => ({ ...cur, ...r }))).catch(() => {}); }, []);

  const ctx = { prices: mods.prices, jss: mods.jss, matRates: rates };
  const range = filter === 'custom' ? { from, to } : dashRange(filter);
  const clients = useMemo(() => [...new Set(['SF', 'OT'].flatMap((k) => (mods.oab?.OAB?.[k] || [])).map((r) => r.customer).filter(Boolean))].sort(), [mods.oab]);
  const k = useMemo(() => computeKPIs(mods.oab, { from: range.from, to: range.to, client }, ctx), [mods.oab, range.from, range.to, client, rates, mods.prices, mods.jss]);

  const sales = [...k.periodInv, ...k.periodManual].sort((a, b) => (a.date < b.date ? 1 : -1));

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

  async function uploadCM(file) {
    if (!file) return;
    try {
      const aoa = await readSheetAOA(file);
      const out = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i]; const customer = String(r[0] || '').trim();
        if (!customer) continue;
        out.push({ customer, billingAddr: String(r[1] || '').trim(), shippingAddr: String(r[2] || '').trim(), warehouseName: String(r[3] || '').trim(), dispatchLoc: String(r[4] || '').trim(), contactPerson: String(r[5] || '').trim(), contactPhone: String(r[6] || '').trim(), gstin: String(r[7] || '').trim(), state: String(r[8] || '').trim() });
      }
      await save('customers', out);
      setMsg(`✅ Customer Master loaded: ${out.length} locations`); setTimeout(() => setMsg(''), 5000);
    } catch (e) { alert('Customer Master error: ' + e.message); }
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">Raw-Material Rates (₹/kg) &amp; Master Data</div>
        <div className="g4">
          <div className="fg"><label>BOPP</label><input type="number" value={rates.bopp || ''} onChange={(e) => setRates({ ...rates, bopp: num(e.target.value) })} /></div>
          <div className="fg"><label>AF-BOPP</label><input type="number" value={rates.afbopp || ''} onChange={(e) => setRates({ ...rates, afbopp: num(e.target.value) })} /></div>
          <div className="fg"><label>AF-LDPE</label><input type="number" value={rates.afldpe || ''} onChange={(e) => setRates({ ...rates, afldpe: num(e.target.value) })} /></div>
          <div className="fg"><label>&nbsp;</label><button className="btn btn-g" onClick={pushRates}>Push Rates</button></div>
        </div>
        <div className="fg" style={{ marginTop: 6 }}><label>Upload Customer Master (.xlsx — columns: Customer, Billing, Shipping, Warehouse, DispatchLoc, Contact, Phone, GSTIN, State)</label>
          <input type="file" accept=".xlsx,.xls" onChange={(e) => uploadCM(e.target.files[0])} /></div>
        {msg && <div className="al al-g" style={{ marginTop: 8 }}>{msg}</div>}
      </div>

      <div className="fbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="day">Today</option><option value="month">This Month</option><option value="last_month">Last Month</option><option value="custom">Custom</option>
        </select>
        {filter === 'custom' && <><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><span style={{ color: 'var(--i3)' }}>to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></>}
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
          <div className="ctitle">Sales in Period</div>
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
          <div className="ctitle">Open Sales Orders</div>
          <div className="tw sy" style={{ maxHeight: 340 }}>
            <table>
              <thead><tr><th>SO</th><th>Customer</th><th>Job</th><th style={{ textAlign: 'right' }}>Balance</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
              <tbody>
                {k.openRows.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No open SOs</td></tr>
                  : k.openRows.map((r, i) => { const b = balance(r); const pr = getPM(r.spec, mods.prices).price || 0; return <tr key={i}><td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td><td style={{ fontSize: 11 }}>{r.customer}</td><td style={{ fontSize: 11 }}>{r.jobName}</td><td style={{ textAlign: 'right' }}>{dash(b)}</td><td style={{ textAlign: 'right' }}>{inr(pr, 2)}</td><td style={{ textAlign: 'right' }}>{rupees(b * pr, 0)}</td></tr>; })}
              </tbody>
            </table>
          </div>
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
function PriceMaster() {
  const { mods, save } = useData();
  const [edits, setEdits] = useState(() => clone(mods.prices || {}));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const specs = useMemo(() => {
    const set = new Set(Object.keys(edits));
    (mods.jss || []).forEach((j) => { if (j.spec) set.add(j.spec); });
    return [...set].sort();
  }, [mods.jss, edits]);
  const filtered = specs.filter((s) => !q || s.toLowerCase().includes(q.toLowerCase()));
  const setCell = (spec, field, val) => setEdits((e) => ({ ...e, [spec]: { price: 0, costPrice: 0, transport: 'At Actuals', ...e[spec], [field]: field === 'transport' ? val : num(val) } }));

  async function saveAll() { setBusy(true); try { await save('prices', edits); setMsg('✅ Price Master saved'); setTimeout(() => setMsg(''), 4000); } catch (e) { setMsg('Save failed: ' + e.message); } finally { setBusy(false); } }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>Price Master — sale &amp; cost per spec</div>
        <input placeholder="Search spec…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-g" onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : '💾 Save Price Master'}</button>
      </div>
      {msg && <div className="al al-g">{msg}</div>}
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead><tr><th>Spec</th><th style={{ width: 130 }}>Sale ₹</th><th style={{ width: 130 }}>Cost ₹</th><th>Transport</th></tr></thead>
          <tbody>
            {filtered.map((s) => { const e = edits[s] || {}; return (
              <tr key={s}><td><span className="tag tb" style={{ fontSize: 10 }}>{s}</span></td>
                <td><input type="number" step="0.01" value={e.price ?? ''} onChange={(ev) => setCell(s, 'price', ev.target.value)} style={{ width: '100%' }} /></td>
                <td><input type="number" step="0.01" value={e.costPrice ?? ''} onChange={(ev) => setCell(s, 'costPrice', ev.target.value)} style={{ width: '100%' }} /></td>
                <td><input value={e.transport ?? ''} placeholder="At Actuals" onChange={(ev) => setCell(s, 'transport', ev.target.value)} style={{ width: '100%' }} /></td>
              </tr>); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── JSS Editor ─────────────────────────── */
const JSS_COLS = ['spec', 'customer', 'subBrand', 'jobName', 'material', 'mic', 'gsm', 'filmWidth', 'width', 'height', 'gusset', 'dispatchForm', 'status'];
function JssEditor() {
  const { mods, save } = useData();
  const [rows, setRows] = useState(() => clone(mods.jss || []));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const setCell = (i, field, val) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: val } : r)));
  const filtered = rows.map((r, i) => ({ r, i })).filter(({ r }) => !q || [r.spec, r.customer, r.jobName].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase())));

  async function saveAll() {
    setBusy(true);
    try {
      await save('jss', rows);
      // Sync customer/subBrand onto OAB rows sharing a spec (syncOABFromJSS).
      const map = {}; rows.forEach((j) => { if (j.spec) map[j.spec] = j; });
      const nextOab = clone(mods.oab); let dirty = false;
      ['SF', 'OT'].forEach((key) => (nextOab.OAB[key] || []).forEach((r) => { const j = map[r.spec]; if (!j) return; if (j.customer && r.customer !== j.customer) { r.customer = j.customer; dirty = true; } if (j.subBrand && r.subBrand !== j.subBrand) { r.subBrand = j.subBrand; dirty = true; } }));
      if (dirty) await save('oab', nextOab);
      setMsg('✅ JSS saved' + (dirty ? ' · OAB names synced' : '')); setTimeout(() => setMsg(''), 4000);
    } catch (e) { setMsg('Save failed: ' + e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>JSS Editor — edit spec master ({rows.length})</div>
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-g" onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : '💾 Save JSS'}</button>
      </div>
      {msg && <div className="al al-g">{msg}</div>}
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead><tr>{JSS_COLS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {filtered.map(({ r, i }) => (
              <tr key={i}>{JSS_COLS.map((c) => (
                <td key={c}>{c === 'spec'
                  ? <span className="tag tb" style={{ fontSize: 10 }}>{r.spec}</span>
                  : <input value={r[c] ?? ''} onChange={(ev) => setCell(i, c, ev.target.value)} style={{ width: c === 'jobName' || c === 'customer' ? 130 : 70 }} />}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Delete SOs ─────────────────────────── */
function DeleteSOs() {
  const { mods, save } = useData();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = ['SF', 'OT'].flatMap((key) => (mods.oab?.OAB?.[key] || []).map((r) => ({ ...r, _key: key })))
    .filter((r) => !q || [r.so, r.customer, r.jobName, r.spec].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase())));

  async function del(so, key) {
    if (!window.confirm(`Delete SO ${so}? This removes the order row (invoices are not affected). This cannot be undone.`)) return;
    setBusy(true);
    try { const next = clone(mods.oab); next.OAB[key] = (next.OAB[key] || []).filter((r) => r.so !== so); await save('oab', next); }
    catch (e) { alert('Delete failed: ' + e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>Delete Sales Orders</div>
        <input placeholder="Search SO / customer / job…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="al al-y">Deleting an SO removes it from the OAB permanently. Invoices already raised are not affected.</div>
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 320px)' }}>
        <table>
          <thead><tr><th>SO</th><th>Sheet</th><th>Spec</th><th>Customer</th><th>Job</th><th style={{ textAlign: 'right' }}>PO Qty</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}><td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td><td>{r._key}</td><td><span className="tag tb" style={{ fontSize: 9 }}>{r.spec}</span></td><td style={{ fontSize: 11 }}>{r.customer}</td><td style={{ fontSize: 11 }}>{r.jobName}</td><td style={{ textAlign: 'right' }}>{dash(r.poQty)}</td><td>{r.closed ? <span className="tag tg" style={{ fontSize: 9 }}>Closed</span> : <span className="tag ty" style={{ fontSize: 9 }}>Open</span>}</td>
                <td><button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 7px', color: 'var(--red)', borderColor: '#F5A8A0' }} disabled={busy} onClick={() => del(r.so, r._key)}>Delete</button></td></tr>
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
  const jssBySpec = useMemo(() => { const m = {}; (mods.jss || []).forEach((j) => { if (j && j.spec) m[j.spec] = j; }); return m; }, [mods.jss]);
  const openRows = useMemo(() => ['SF', 'OT'].flatMap((k) => (mods.oab?.OAB?.[k] || [])).filter((r) => !r.closed), [mods.oab]);

  const byCustomer = useMemo(() => {
    const map = {};
    openRows.forEach((r) => {
      const c = r.customer || '—';
      const m = map[c] || (map[c] = { customer: c, orders: 0, poQty: 0, balQty: 0 });
      m.orders++; m.poQty += num(r.poQty); m.balQty += balance(r);
    });
    return Object.values(map).sort((a, b) => b.poQty - a.poQty);
  }, [openRows]);

  const byMaterial = useMemo(() => {
    const map = {};
    openRows.forEach((r) => {
      const j = jssBySpec[r.spec] || {};
      const mat = j.material || r.material || '—';
      const fw = num(j.filmWidth || r.filmWidth);
      const gsm = num(j.gsm || r.gsm);
      const key = mat + '|' + fw;
      const m = map[key] || (map[key] = { material: mat, filmWidth: fw, gsm, mic: j.mic || r.mic || '', metres: 0 });
      m.metres += calcMetres(r, balance(r), j).net;
    });
    return Object.values(map).map((m) => {
      const kpm = m.gsm > 0 && m.filmWidth > 0 ? (m.filmWidth / 1000) * (m.gsm / 1000) : 0;
      const reqKg = Math.round(m.metres * kpm * 10) / 10;
      return { ...m, reqKg, bufferKg: Math.round(reqKg * 1.1 * 10) / 10 };
    }).sort((a, b) => a.material.localeCompare(b.material) || a.filmWidth - b.filmWidth);
  }, [openRows, jssBySpec]);

  return (
    <>
      <div className="card">
        <div className="ctitle">Orders by Customer (open SOs)</div>
        <div className="tw sy" style={{ maxHeight: 300 }}>
          <table>
            <thead><tr><th>Customer</th><th style={rt}>Open SOs</th><th style={rt}>PO Qty</th><th style={rt}>Balance Qty</th></tr></thead>
            <tbody>
              {byCustomer.length === 0 ? <tr><td colSpan={4} style={emptyTd}>No open orders</td></tr>
                : byCustomer.map((c, i) => <tr key={i}><td style={{ fontSize: 11 }}>{c.customer}</td><td style={rt}>{c.orders}</td><td style={rt}>{dash(c.poQty)}</td><td style={rt}>{dash(c.balQty)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="ctitle">Material Projection / Next-Order Forecast (from open-SO balance)</div>
        <div className="tw sy" style={{ maxHeight: 360 }}>
          <table>
            <thead><tr><th>Material</th><th style={rt}>Film Width</th><th style={rt}>Mic</th><th style={rt}>GSM</th><th style={rt}>Open Metres</th><th style={rt}>Required Kg</th><th style={rt}>+10% Buffer</th></tr></thead>
            <tbody>
              {byMaterial.length === 0 ? <tr><td colSpan={7} style={emptyTd}>No data</td></tr>
                : byMaterial.map((m, i) => <tr key={i}><td style={{ fontSize: 11, fontWeight: 600 }}>{m.material}</td><td style={rt}>{m.filmWidth ? m.filmWidth + 'mm' : '-'}</td><td style={rt}>{m.mic || '-'}</td><td style={rt}>{m.gsm || '-'}</td><td style={rt}>{dash(m.metres)} m</td><td style={{ ...rt, fontWeight: 700, color: 'var(--g)' }}>{m.reqKg} kg</td><td style={{ ...rt, fontWeight: 700, background: 'var(--gl)' }}>{m.bufferKg} kg</td></tr>)}
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

  const mat = String((mods.jss.find((j) => j.spec === (r && r.spec)) || {}).material || '').toLowerCase().trim();
  const R = ctx.matRates;
  let rmRate = 0;
  if (mat.includes('af-bopp') || mat.includes('af_bopp')) rmRate = num(R.afbopp);
  else if (mat === 'bopp' || mat === 'plain bopp') rmRate = num(R.bopp);
  else if (mat.includes('ldpe')) rmRate = num(R.afldpe);
  const wastageCost = num(wastageKg) * rmRate;
  const addl = wastageCost + num(manpower) + num(power);
  const netMargin = totMargin - addl;
  const netMarginPct = totVal > 0 ? (netMargin / totVal * 100) : 0;

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>SO Costing</div>
        <select value={so} onChange={(e) => setSo(e.target.value)} style={{ minWidth: 320 }}>
          <option value="">Select SO…</option>
          {allSOs.map((x) => <option key={x.so} value={x.so}>{x.so} — {x.customer || ''}{x.jobName ? ' · ' + String(x.jobName).slice(0, 25) : ''}</option>)}
        </select>
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
              <thead><tr><th>Invoice</th><th>Date</th><th>Spec</th><th style={rt}>Qty</th><th style={rt}>Rate</th><th style={rt}>Value</th><th style={rt}>Cost</th><th style={rt}>Margin</th><th style={rt}>Margin %</th></tr></thead>
              <tbody>
                {lines.length === 0 ? <tr><td colSpan={9} style={emptyTd}>No invoices for this SO yet</td></tr>
                  : lines.map((x, i) => <tr key={i}><td style={{ fontSize: 11, fontWeight: 600, color: 'var(--g)' }}>{x.invNo}</td><td style={{ fontSize: 11 }}>{fmtDate(x.date)}</td><td><span className="tag tb" style={{ fontSize: 9 }}>{x.spec}</span></td><td style={rt}>{dash(x.qty)}</td><td style={rt}>{inr(x.rate, 2)}</td><td style={{ ...rt, fontWeight: 600 }}>{rupees(x.value, 0)}</td><td style={{ ...rt, color: 'var(--i3)' }}>{inr(x.cost, 2)}</td><td style={{ ...rt, fontWeight: 600, color: 'var(--g)' }}>{rupees(x.margin, 0)}</td><td style={{ ...rt, fontWeight: 600 }}>{x.marginPct.toFixed(1)}%</td></tr>)}
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
