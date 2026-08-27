import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { fmtDate, inr } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { today as todayIso } from '../lib/format.js';
import { ddList } from '../lib/dropdowns.js';
import DropdownAdmin from '../components/DropdownAdmin.jsx';
import SalesDailyTab from '../components/SalesDailyTab.jsx';
import SalesCsaTab from '../components/SalesCsaTab.jsx';
import SalesPosTab from '../components/SalesPosTab.jsx';
import SalesContactsTab from '../components/SalesContactsTab.jsx';
import SalesManageTab from '../components/SalesManageTab.jsx';
import SalesTargetsTab from '../components/SalesTargetsTab.jsx';
import SalesUsersPanel from '../components/SalesUsersPanel.jsx';
import {
  STAGE_STYLE, PAY_STYLE, FOLLOW_UP_STYLE, UNASSIGNED,
  salesOverview, repWorkload, nudgeList, nextFollowUp, followUpState,
  leadLineItems, allCategories, assignLine, bulkAssignLines, filterLineItems,
  activeReps, repName, leadCategories, repCategoriesOf,
  salesToday,
} from '../lib/sales.js';

// Sales Admin (S Dashboard) — the sadmin's view over module 12: pipeline health,
// who owns which line item, rep accounts and monthly targets.
//
// Allocation is per (customer × category), so the allocation table works in LINE
// ITEMS rather than customers — a shared customer appears once per category.

// Tab order and labels are production's SDASH_TABS. "Dropdown Lists" is not one of
// them — production edits those on the super-admin Dashboard — but it is kept here
// too so a sales admin who does not have the Dashboard can still reach them.
const TABS = [
  { k: 'overview', label: '📊 Overview' },
  { k: 'daily', label: '📋 Daily Updates' },
  { k: 'costs', label: '🧪 CSA & Quote' },
  { k: 'pos', label: '📦 All POs' },
  { k: 'targets', label: '🎯 Targets' },
  { k: 'leads', label: '📈 All Active Customers' },
  { k: 'contacts', label: '👥 Contacts' },
  { k: 'alloc', label: '🗂 Category Allocation' },
  { k: 'reps', label: '🔐 Users & Access' },
  { k: 'export', label: '⬇ Export Data' },
  { k: 'manage', label: '🧹 Manage' },
  { k: 'lists', label: '⚙ Dropdown Lists' },
];

const pill = (style) => ({ ...style, padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700, display: 'inline-block' });

// Multi-sheet .xlsx download, so the full-book export lands as one workbook with a
// sheet each — matching sdashExportExcel (index.html 10192). exportAOA (lib/xlsx.js)
// only writes a single sheet, so this drives SheetJS directly, sanitising each cell
// against formula injection exactly as that library does.
function exportWorkbook(sheets, filename) {
  const X = window.XLSX;
  if (!X) throw new Error('SheetJS (xlsx) is not loaded');
  const sani = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
  const wb = X.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    const ws = X.utils.aoa_to_sheet((rows || []).map((r) => (Array.isArray(r) ? r.map(sani) : r)));
    X.utils.book_append_sheet(wb, ws, name);
  });
  X.writeFile(wb, filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
}

export default function SalesAdmin() {
  const [tab, setTab] = useState('overview');
  const { mods, save } = useData();
  const sales = mods.sales || {};
  const patch = (p) => save('sales', (prev) => ({ ...(prev || {}), ...p }));

  return (
    <div id="app">
      <div className="pg-ttl">📊 S Dashboard</div>
      <div className="pg-sub">Sales pipeline snapshot pulled live from SalesOS — leads, this month's sales, and rep target fulfillment</div>
      <div className="step-bar" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
        ))}
      </div>
      {tab === 'overview' && <Overview sales={sales} />}
      {tab === 'daily' && <SalesDailyTab sales={sales} />}
      {tab === 'costs' && <SalesCsaTab sales={sales} save={save} />}
      {tab === 'pos' && <SalesPosTab sales={sales} />}
      {tab === 'targets' && <SalesTargetsTab sales={sales} patch={patch} />}
      {tab === 'leads' && <AllCustomers sales={sales} patch={patch} />}
      {tab === 'contacts' && <SalesContactsTab sales={sales} save={save} />}
      {tab === 'alloc' && <Allocation sales={sales} patch={patch} />}
      {/* §36: sales-user management is the SHARED panel also mounted in the Super
          Admin's Users & Access — one merged admin surface, one sales_users table. */}
      {tab === 'reps' && <SalesUsersPanel sales={sales} patch={patch} />}
      {tab === 'export' && <ExportData sales={sales} />}
      {tab === 'manage' && <SalesManageTab sales={sales} save={save} />}
      {tab === 'lists' && <DropdownAdmin />}
    </div>
  );
}

function Kpi({ label, value, color }) {
  return <div className="kpi"><div className="kpi-l">{label}</div><div className="kpi-v" style={color ? { color } : undefined}>{value}</div></div>;
}

/* ─────────────────────────── Overview ─────────────────────────── */
function Overview({ sales }) {
  const k = useMemo(() => salesOverview(sales), [sales]);
  const workload = useMemo(() => repWorkload(sales.leads, sales.sales_users, sales.interactions), [sales]);
  const nudges = useMemo(() => nudgeList(sales.leads, sales.interactions), [sales]);

  return (
    <>
      <div className="stats">
        <Kpi label="Customers" value={inr(k.total)} />
        <Kpi label="Hot 🔥" value={inr(k.hot)} color="var(--red)" />
        <Kpi label="Warm" value={inr(k.warm)} color="#c9a100" />
        <Kpi label="Cold ❄️" value={inr(k.cold)} color="#1d4e89" />
        <Kpi label="Converted ✅" value={inr(k.converted)} color="var(--g)" />
        <Kpi label="POs received" value={inr(k.posReceived)} color="var(--g)" />
        <Kpi label="Today's activity" value={inr(k.todaysActivities)} />
        <Kpi label="Unallocated lines" value={inr(k.unallocated)} color={k.unallocated ? 'var(--red)' : undefined} />
      </div>
      <div className="pg-sub" style={{ marginTop: -6 }}>
        “Converted” counts customers we have received at least one PO from — evidence, not a stage label.
      </div>

      <div className="g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="ctitle">Rep summary</div>
          <div className="tw sy" style={{ maxHeight: 320 }}>
            <table>
              <thead><tr><th>Rep</th><th style={{ textAlign: 'right' }}>Customers</th><th style={{ textAlign: 'right' }}>Lines</th><th style={{ textAlign: 'right' }}>Converted</th><th style={{ textAlign: 'right' }}>Overdue</th></tr></thead>
              <tbody>
                {workload.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No active reps</td></tr>
                  : workload.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td style={{ textAlign: 'right' }}>{inr(r.leads)}</td>
                      <td style={{ textAlign: 'right' }}>{inr(r.lines)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--g)' }}>{inr(r.converted)}</td>
                      <td style={{ textAlign: 'right', color: r.overdue ? 'var(--red)' : undefined, fontWeight: r.overdue ? 700 : 400 }}>{inr(r.overdue)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="ctitle">Needs a nudge <span className="tag tgr">{nudges.length}</span></div>
          <div className="pg-sub" style={{ marginTop: 0 }}>Customers whose follow-up is due today or already overdue.</div>
          <div className="tw sy" style={{ maxHeight: 320 }}>
            <table>
              <thead><tr><th>Customer</th><th>Owner</th><th>Stage</th><th style={{ width: 130 }}>Due</th></tr></thead>
              <tbody>
                {nudges.length === 0 ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>Nothing overdue — good.</td></tr>
                  : nudges.map(({ lead, due }) => {
                    const st = followUpState(due);
                    return (
                      <tr key={lead.id}>
                        <td style={{ fontWeight: 600 }}>{lead.client_name}</td>
                        <td style={{ fontSize: 11 }}>{repName(sales.sales_users, lead.assigned_to)}</td>
                        <td><span style={pill(STAGE_STYLE[lead.stage] || {})}>{lead.stage || '—'}</span></td>
                        <td><span style={pill(FOLLOW_UP_STYLE[st.kind])}>{st.kind === 'later' ? fmtDate(st.label) : st.label}</span></td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── All customers ─────────────────────────── */
// Category / rep filters, an inline status dropdown the admin can edit (the same
// field the rep edits on their own dashboard — sdashSetLeadStatus 9492) and an
// Excel extract of whatever the filters currently show.
function AllCustomers({ sales, patch }) {
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [cat, setCat] = useState('');
  const [rep, setRep] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const leads = sales.leads || [];
  const cats = useMemo(() => allCategories(leads), [leads]);
  const reps = activeReps(sales.sales_users);

  const ownerOf = (l, c) => (l.category_assignments || {})[c] || l.assigned_to || '';

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (stage && l.stage !== stage) return false;
      const lc = leadCategories(l);
      if (cat && !lc.includes(cat)) return false;
      if (rep === UNASSIGNED) { if (!lc.some((c) => !ownerOf(l, c))) return false; }
      else if (rep) { if (!lc.some((c) => String(ownerOf(l, c)) === String(rep))) return false; }
      if (!t) return true;
      return [l.client_name, l.group, l.city].some((v) => String(v || '').toLowerCase().includes(t));
    });
  }, [leads, q, stage, cat, rep]);

  async function setStatus(lead, status) {
    if (!status || status === lead.stage) return;
    setBusy(true);
    try {
      await patch({ leads: (sales.leads || []).map((l) => (l.id === lead.id ? { ...l, stage: status, stage_updated_at: new Date().toISOString(), stage_updated_by: 'super_admin' } : l)) });
      setMsg({ t: 'g', text: `✅ ${lead.client_name} → ${status}.` });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  }

  function exportRows() {
    const header = ['Customer', 'Group', 'Categories', 'Status', 'Payment', 'Owners', 'Head Office', 'Delivery', 'GSTIN', 'Next follow-up'];
    const body = rows.map((l) => {
      const lc = leadCategories(l);
      const owners = [...new Set(lc.map((c) => repName(sales.sales_users, ownerOf(l, c))))].filter((n) => n && n !== '—');
      return [l.client_name, l.group || '', lc.join(', '), l.stage || '', l.payment_type || '',
        owners.join(', ') || 'Unassigned', l.head_office || l.city || '', l.delivery_location || '',
        l.gstin || '', nextFollowUp(l, sales.interactions) || ''];
    });
    exportAOA([header, ...body], 'Active_Customers_' + todayIso());
  }

  return (
    <div className="card">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>All Active Customers <span className="tag tgr">{rows.length}</span></div>
        <input placeholder="Search customer / group / city…" value={q} aria-label="Search all customers" onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter all by category">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Filter all by rep">
          <option value="">All reps</option>
          <option value={UNASSIGNED}>— Unassigned —</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filter all by stage">
          <option value="">All stages</option>
          {ddList(sales, 'statuses').map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={exportRows} disabled={!rows.length}>⬇ Export</button>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 340px)' }}>
        <table>
          <thead><tr>
            <th style={{ minWidth: 170 }}>Customer</th><th>Group</th><th>Categories</th><th>Owners</th>
            <th style={{ width: 60, textAlign: 'center' }}>Pay</th><th style={{ width: 140 }}>Status</th><th style={{ width: 120 }}>Next ping</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No customers match</td></tr>
              : rows.map((l) => {
                const lc = leadCategories(l);
                const owners = [...new Set(lc.map((c) => repName(sales.sales_users, ownerOf(l, c))))]
                  .filter((n) => n && n !== '—');
                const st = followUpState(nextFollowUp(l, sales.interactions));
                return (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.client_name}</td>
                    <td style={{ fontSize: 11 }}>{l.group || '—'}</td>
                    <td style={{ fontSize: 11 }}>{lc.join(', ') || '—'}</td>
                    <td style={{ fontSize: 11 }}>{owners.length ? owners.join(', ') : <span style={{ color: '#c9a100' }}>Unassigned</span>}</td>
                    <td style={{ textAlign: 'center' }}>
                      {l.payment_type ? <span style={{ ...pill(PAY_STYLE[l.payment_type] || {}), borderRadius: '50%', padding: '2px 7px', fontSize: 10 }}>{l.payment_type}</span> : '—'}
                    </td>
                    <td>
                      <select value={l.stage || ''} disabled={busy} aria-label={`Status for ${l.client_name}`}
                        style={{ ...pill(STAGE_STYLE[l.stage] || {}), border: '1px solid rgba(0,0,0,.12)', height: 28, maxWidth: 130 }}
                        onChange={(e) => setStatus(l, e.target.value)}>
                        {!l.stage && <option value="">— Set —</option>}
                        {ddList(sales, 'statuses').map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td><span style={pill(FOLLOW_UP_STYLE[st.kind])}>{st.kind === 'later' ? fmtDate(st.label) : st.label}</span></td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Category allocation ─────────────────────────── */
function Allocation({ sales, patch }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [rep, setRep] = useState('');
  const [ticked, setTicked] = useState(() => new Set());
  const [bulkRep, setBulkRep] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => leadLineItems(sales.leads, { contacts: sales.contacts }), [sales.leads, sales.contacts]);
  const rows = useMemo(() => filterLineItems(items, { q, category: cat, repId: rep }), [items, q, cat, rep]);
  const cats = useMemo(() => allCategories(sales.leads), [sales.leads]);
  const reps = activeReps(sales.sales_users);

  const allTicked = rows.length > 0 && rows.every((r) => ticked.has(r.key));

  async function assignOne(item, repId) {
    setBusy(true);
    try {
      await patch({ leads: assignLine(sales.leads, item.leadId, item.category, repId) });
      setMsg({ t: 'g', text: `✅ ${item.client_name} · ${item.category} → ${repId ? repName(sales.sales_users, repId) : 'unassigned'}.` });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  }

  async function assignBulk() {
    if (!ticked.size) { setMsg({ t: 'r', text: 'Tick at least one line item.' }); return; }
    setBusy(true);
    try {
      await patch({ leads: bulkAssignLines(sales.leads, [...ticked], bulkRep) });
      setMsg({ t: 'g', text: `✅ ${ticked.size} line item(s) → ${bulkRep ? repName(sales.sales_users, bulkRep) : 'unassigned'}.` });
      setTicked(new Set());
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  }

  const toggle = (key) => setTicked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>Category Allocation <span className="tag tgr">{rows.length}</span></div>
        <input placeholder="Search customer…" value={q} aria-label="Search allocation" onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Filter by rep">
          <option value="">All (assigned + unassigned)</option>
          <option value={UNASSIGNED}>— Unassigned —</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
        </select>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Each row is one customer × category. Assigning writes the per-category owner, so the
        other categories of a shared customer are left alone.
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <div className="fbar" style={{ background: 'var(--bg)', padding: '8px 10px', borderRadius: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Bulk allocate {ticked.size} ticked →</span>
        <select value={bulkRep} onChange={(e) => setBulkRep(e.target.value)} aria-label="Bulk assign to">
          <option value="">— Unassign —</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
        </select>
        <button className="btn btn-g" onClick={assignBulk} disabled={busy}>Assign selected</button>
      </div>

      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 400px)' }}>
        <table>
          <thead><tr>
            <th style={{ width: 34, textAlign: 'center' }}>
              <input
                type="checkbox" checked={allTicked} aria-label="Tick all line items"
                onChange={(e) => setTicked(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())}
              />
            </th>
            <th style={{ minWidth: 170 }}>Customer</th><th>Category</th><th style={{ width: 120 }}>City</th>
            <th style={{ width: 110 }}>Stage</th><th style={{ width: 150 }}>Source</th>
            <th style={{ width: 180 }}>Assigned to</th><th style={{ textAlign: 'center' }}>Contacts</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No line items match</td></tr>
              : rows.map((it) => {
                // Source = the rep who entered it, else a database/uploaded record. (sdashLeadDBFilter 9549)
                const source = (it.lead.created_by && it.lead.created_by !== 'sa-1') ? repName(sales.sales_users, it.lead.created_by) : 'Database / Uploaded';
                return (
                <tr key={it.key}>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={ticked.has(it.key)} aria-label={`Tick ${it.client_name} ${it.category}`} onChange={() => toggle(it.key)} />
                  </td>
                  <td style={{ fontWeight: 600 }}>{it.client_name}</td>
                  <td><span className="tag tb" style={{ fontSize: 10 }}>{it.category}</span></td>
                  <td style={{ fontSize: 11 }}>{it.lead.city || '—'}</td>
                  <td><span style={pill(STAGE_STYLE[it.stage] || {})}>{it.stage || '—'}</span></td>
                  <td style={{ fontSize: 11 }}>{source}</td>
                  <td>
                    <select
                      value={it.repId || ''} disabled={busy}
                      aria-label={`Assign ${it.client_name} ${it.category}`}
                      style={{ color: it.repId ? 'var(--ink)' : '#c9a100' }}
                      onChange={(e) => assignOne(it, e.target.value)}
                    >
                      <option value="">— Unassigned —</option>
                      {reps.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
                      {/* Keep a now-inactive owner visible so the row still reads correctly. */}
                      {it.repId && !reps.some((r) => r.id === it.repId) && (
                        <option value={it.repId}>{repName(sales.sales_users, it.repId)} (inactive)</option>
                      )}
                    </select>
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 11 }}>{it.contacts}</td>
                </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Export ─────────────────────────── */
function ExportData({ sales }) {
  // Full-book export: one workbook, a sheet each for Leads, Contacts, POs, Targets and
  // the Activity Log — a complete snapshot of the dashboard. (sdashExportExcel 10192)
  function exportAll() {
    const leads = sales.leads || [];
    const byLeadName = Object.fromEntries(leads.map((l) => [l.id, l.client_name]));
    const skuName = (id) => ((sales.skus || []).find((s) => s.id === id) || {}).sku_name || '';

    const leadsSheet = [['Company', 'Category', 'City', 'Stage', 'Pay Type', 'Terms', 'Rep', 'Assigned To'],
      ...leads.map((l) => [l.client_name, leadCategories(l).join(', '), l.city || '', l.stage || '',
        l.payment_type || '', l.payment_terms || '', repName(sales.sales_users, l.created_by),
        l.assigned_to ? repName(sales.sales_users, l.assigned_to) : ''])];

    const contactsSheet = [['Company', 'Category', 'Name', 'Designation', 'Phone', 'Email', 'Primary', 'Remarks'],
      ...(sales.contacts || []).map((c) => {
        const lead = leads.find((l) => l.id === c.lead_id);
        return [(lead && lead.client_name) || c.customer || '', c.category || (lead ? leadCategories(lead).join(', ') : ''),
          c.name || '', c.designation || '', c.phone || '', c.email || '', c.is_primary ? 'Yes' : 'No', c.remarks || ''];
      })];

    const posSheet = [['Date', 'PO Number', 'Customer', 'SKU', 'Qty', 'Price', 'Total', 'Rep'],
      ...(sales.pos || []).map((p) => [p.date || '', p.po_number || '', byLeadName[p.lead_id] || '',
        skuName(p.sku_id), Number(p.qty) || 0, Number(p.price) || 0, (Number(p.qty) || 0) * (Number(p.price) || 0),
        repName(sales.sales_users, p.created_by)])];

    const targetsSheet = [['Rep', 'Month', 'Category', 'Dispatch Type', 'Amount'],
      ...(sales.targets || []).map((t) => [repName(sales.sales_users, t.rep_id), t.month || '', t.category || '',
        t.dispatch_type || '', Number(t.amount) || 0])];

    const activitySheet = [['Date', 'Rep', 'Company', 'Type', 'Outcome', 'Expense', 'Follow-up'],
      ...(sales.interactions || []).map((i) => [i.date || '', repName(sales.sales_users, i.created_by),
        byLeadName[i.lead_id] || '', i.type || '', i.outcome || i.reason || '', i.expense || '', i.follow_up_date || ''])];

    exportWorkbook([
      { name: 'Leads', rows: leadsSheet },
      { name: 'Contacts', rows: contactsSheet },
      { name: 'POs', rows: posSheet },
      { name: 'Targets', rows: targetsSheet },
      { name: 'Activity Log', rows: activitySheet },
    ], 'Bloomflex_Sales_Export_' + todayIso());
  }

  function exportLeads() {
    const rows = leadLineItems(sales.leads, { contacts: sales.contacts }).map((it) => [
      it.client_name, it.lead.group || '', it.category,
      it.repId ? repName(sales.sales_users, it.repId) : 'Unassigned',
      it.stage, it.lead.payment_type || '', it.lead.gstin || '',
      nextFollowUp(it.lead, sales.interactions) || '',
    ]);
    exportAOA([['Customer', 'Group', 'Category', 'Assigned to', 'Stage', 'Pay grade', 'GSTIN', 'Next follow-up'], ...rows],
      'Sales_Allocation_' + todayIso());
  }
  function exportContacts() {
    const byLead = Object.fromEntries((sales.leads || []).map((l) => [l.id, l.client_name]));
    const rows = (sales.contacts || []).map((c) => [byLead[c.lead_id] || c.lead_id, c.name, c.designation || '', c.phone || '', c.email || '']);
    exportAOA([['Customer', 'Name', 'Designation', 'Phone', 'Email'], ...rows], 'Sales_Contacts_' + todayIso());
  }
  function exportInteractions() {
    const byLead = Object.fromEntries((sales.leads || []).map((l) => [l.id, l.client_name]));
    const rows = (sales.interactions || []).map((i) => [
      i.date || '', byLead[i.lead_id] || i.lead_id, i.type || '', i.outcome || '',
      i.follow_up_date || '', repName(sales.sales_users, i.created_by),
    ]);
    exportAOA([['Date', 'Customer', 'Type', 'Outcome', 'Next follow-up', 'Rep'], ...rows], 'Sales_Interactions_' + todayIso());
  }

  const counts = {
    lines: leadLineItems(sales.leads).length,
    contacts: (sales.contacts || []).length,
    interactions: (sales.interactions || []).length,
  };

  return (
    <div className="card">
      <div className="ctitle">⬇ Export Data</div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        One Excel workbook with a sheet each for Leads, Contacts, POs, Targets and the Activity Log —
        a full snapshot of everything on this dashboard.
      </div>
      <button className="btn btn-g" onClick={exportAll}>📥 Download Excel Export</button>
      <div className="ctitle" style={{ marginTop: 16 }}>Single-sheet extracts</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-s" onClick={exportLeads} disabled={!counts.lines}>⬇ Allocation ({counts.lines} lines)</button>
        <button className="btn btn-s" onClick={exportContacts} disabled={!counts.contacts}>⬇ Contacts ({counts.contacts})</button>
        <button className="btn btn-s" onClick={exportInteractions} disabled={!counts.interactions}>⬇ Interactions ({counts.interactions})</button>
      </div>
      <div className="pg-sub" style={{ marginTop: 12, fontSize: 11 }}>
        Import isn&rsquo;t available here — bulk-editing sales data belongs in SalesOS, where the validation
        that protects the live pipeline runs. These exports are read-only, for reporting.
      </div>
    </div>
  );
}
