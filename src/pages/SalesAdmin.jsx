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
import {
  REP_ACCOUNT_STATUSES, STAGE_STYLE, PAY_STYLE, FOLLOW_UP_STYLE, UNASSIGNED,
  salesOverview, repWorkload, nudgeList, nextFollowUp, followUpState,
  leadLineItems, allCategories, assignLine, bulkAssignLines, filterLineItems,
  activeReps, repName, addRep, updateRep, leadCategories, repCategoriesOf,
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
      {tab === 'leads' && <AllCustomers sales={sales} />}
      {tab === 'contacts' && <SalesContactsTab sales={sales} />}
      {tab === 'alloc' && <Allocation sales={sales} patch={patch} />}
      {tab === 'reps' && <Reps sales={sales} patch={patch} />}
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
function AllCustomers({ sales }) {
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const leads = sales.leads || [];

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (stage && l.stage !== stage) return false;
      if (!t) return true;
      return [l.client_name, l.group, l.city].some((v) => String(v || '').toLowerCase().includes(t));
    });
  }, [leads, q, stage]);

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>All Customers <span className="tag tgr">{rows.length}</span></div>
        <input placeholder="Search customer / group / city…" value={q} aria-label="Search all customers" onChange={(e) => setQ(e.target.value)} />
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filter all by stage">
          <option value="">All stages</option>
          {ddList(sales, 'statuses').map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
      </div>
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead><tr>
            <th style={{ minWidth: 170 }}>Customer</th><th>Group</th><th>Categories</th><th>Owners</th>
            <th style={{ width: 60, textAlign: 'center' }}>Pay</th><th style={{ width: 120 }}>Stage</th><th style={{ width: 120 }}>Next ping</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No customers match</td></tr>
              : rows.map((l) => {
                const cats = leadCategories(l);
                const owners = [...new Set(cats.map((c) => repName(sales.sales_users, (l.category_assignments || {})[c] || l.assigned_to)))]
                  .filter((n) => n && n !== '—');
                const st = followUpState(nextFollowUp(l, sales.interactions));
                return (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.client_name}</td>
                    <td style={{ fontSize: 11 }}>{l.group || '—'}</td>
                    <td style={{ fontSize: 11 }}>{cats.join(', ') || '—'}</td>
                    <td style={{ fontSize: 11 }}>{owners.length ? owners.join(', ') : <span style={{ color: '#c9a100' }}>Unassigned</span>}</td>
                    <td style={{ textAlign: 'center' }}>
                      {l.payment_type ? <span style={{ ...pill(PAY_STYLE[l.payment_type] || {}), borderRadius: '50%', padding: '2px 7px', fontSize: 10 }}>{l.payment_type}</span> : '—'}
                    </td>
                    <td><span style={pill(STAGE_STYLE[l.stage] || {})}>{l.stage || '—'}</span></td>
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
            <th style={{ minWidth: 170 }}>Customer</th><th>Category</th><th style={{ textAlign: 'center' }}>Contacts</th>
            <th style={{ width: 110 }}>Stage</th><th style={{ width: 180 }}>Assigned to</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No line items match</td></tr>
              : rows.map((it) => (
                <tr key={it.key}>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={ticked.has(it.key)} aria-label={`Tick ${it.client_name} ${it.category}`} onChange={() => toggle(it.key)} />
                  </td>
                  <td style={{ fontWeight: 600 }}>{it.client_name}</td>
                  <td><span className="tag tb" style={{ fontSize: 10 }}>{it.category}</span></td>
                  <td style={{ textAlign: 'center', fontSize: 11 }}>{it.contacts}</td>
                  <td><span style={pill(STAGE_STYLE[it.stage] || {})}>{it.stage || '—'}</span></td>
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
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Rep accounts ─────────────────────────── */
function Reps({ sales, patch }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', phone: '', status: 'Active' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const users = sales.sales_users || [];

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      await patch({ sales_users: addRep(users, form) });
      setForm({ name: '', username: '', password: '', phone: '', status: 'Active' });
      setMsg({ t: 'g', text: '✅ Sales rep added.' });
    } catch (e) { setMsg({ t: 'r', text: e.message || String(e) }); }
    finally { setBusy(false); }
  }

  async function setStatus(rep, status) {
    try { await patch({ sales_users: updateRep(users, rep.id, { status }) }); }
    catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">Sales Reps <span className="tag tgr">{users.length}</span></div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="tw sy" style={{ maxHeight: 320 }}>
          <table>
            <thead><tr><th>Name</th><th>Username</th><th>Phone</th><th style={{ width: 140 }}>Status</th><th style={{ textAlign: 'right' }}>Line items</th></tr></thead>
            <tbody>
              {users.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No reps yet</td></tr>
                : users.map((r) => {
                  const lines = (sales.leads || []).reduce((n, l) => n + repCategoriesOf(l, r.id).length, 0);
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.display_name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.username}</td>
                      <td style={{ fontSize: 11 }}>{r.phone || '—'}</td>
                      <td>
                        <select value={r.status || 'Active'} aria-label={`Status for ${r.display_name}`} onChange={(e) => setStatus(r, e.target.value)}>
                          {REP_ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: 'right' }}>{inr(lines)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <div className="pg-sub" style={{ margin: '8px 0 0' }}>
          Deactivating a rep leaves their allocations in place — reassign them on the Category
          Allocation tab, where an inactive owner stays visible until you do.
        </div>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <div className="ctitle">＋ Add a sales rep</div>
        <div className="fg"><label>Full name *</label><input value={form.name} aria-label="Rep full name" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="fg"><label>Username *</label><input value={form.username} aria-label="Rep username" onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
        <div className="fg"><label>Password *</label><input type="password" value={form.password} aria-label="Rep password" onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        <div className="fg"><label>Phone</label><input value={form.phone} aria-label="Rep phone" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div className="fg">
          <label>Status</label>
          <select value={form.status} aria-label="Rep status" onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {REP_ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="btn btn-g" onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add rep'}</button>
      </div>
    </>
  );
}

/* ─────────────────────────── Export ─────────────────────────── */
function ExportData({ sales }) {
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
      <div className="ctitle">Export</div>
      <div className="pg-sub" style={{ marginTop: 0 }}>Spreadsheet extracts of the sales book, as it stands right now.</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-s" onClick={exportLeads} disabled={!counts.lines}>⬇ Allocation ({counts.lines} lines)</button>
        <button className="btn btn-s" onClick={exportContacts} disabled={!counts.contacts}>⬇ Contacts ({counts.contacts})</button>
        <button className="btn btn-s" onClick={exportInteractions} disabled={!counts.interactions}>⬇ Interactions ({counts.interactions})</button>
      </div>
    </div>
  );
}
