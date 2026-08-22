import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { purchComputeStatus, num, parsePaymentDays } from '../lib/calc.js';
import { dash, today, fmtDate, rupees, inr } from '../lib/format.js';
import { exportAOA, readSheet } from '../lib/xlsx.js';
import { buildScrapChart, scrapChartTitle, bestByItem, CHART_BOX } from '../lib/scrapChart.js';
import { readAttachments, viewAttachment } from '../lib/attach.js';
import PurchaseOrderModal from '../components/PurchaseOrderDoc.jsx';

// Native port of the legacy Purchase Admin ("P Dashboard") — a tabbed admin page
// over module 6 (purchase) and module 8 (scrap). Ported from index.html:
// switchPADashTab / purchRenderPOHistory / renderASLEdit+saveASLEdits /
// renderItemMaster+saveItemMasterEdits / purchRenderPriceHistory /
// purchRenderPayments / renderScrapAdmin+scrapAdminSaveBuyers.
//
// No shared lib/component is modified; every purchase-specific helper the legacy
// kept globally is re-implemented locally below. Reads are defensive: the real
// backend blob uses { asl, pos, priceHistory, counter, itemsExtra } but
// emptyModules() seeds { asl, po, grn, pay } — so posOf() accepts either key and
// saves spread the existing module so unknown keys survive.

const clone = (o) => JSON.parse(JSON.stringify(o || {}));
const arr = (v) => (Array.isArray(v) ? v : []);
const posOf = (p) => (Array.isArray(p.pos) ? p.pos : arr(p.po));
const supName = (s) => s || '(no supplier)';

const rt = { textAlign: 'right' };
const emptyTd = { textAlign: 'center', padding: 18, color: 'var(--i3)' };

/* ── local ports of legacy purchase helpers ── */
function delayDays(po) {
  // Closed: closedDate − expectedDelivery; else today − expectedDelivery. (purchDelayDays 6235)
  if (!po || !po.expectedDelivery) return 0;
  const end = po.status === 'Closed' ? (po.closedDate || today()) : today();
  const exp = new Date(po.expectedDelivery + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return Math.round((e - exp) / 86400000);
}
function isClosed(po) { return po.status === 'Closed' || !!po.closedDate; } // (purchIsClosed 6249)
function recvTotals(po) { // (purchReceivedTotals 6242)
  let ordered = 0, received = 0;
  (po.items || []).forEach((i) => { ordered += num(i.qty); received += num(i.receivedQty); });
  return { ordered, received };
}
function statusOf(po) { return po.status || purchComputeStatus(po.items || []); }
function tagClass(status, overdue) {
  if (status === 'Closed') return 'tg';
  if (overdue) return 'tr';
  if (status === 'Partial') return 'tb';
  return 'ty';
}
function paymentTermsText(po, asl) { // (purchPaymentTermsText 7116)
  const row = (asl || []).find((r) => r.company === po.supplier && r.paymentTerms);
  return row ? row.paymentTerms : '';
}
function addDaysISO(baseISO, days) {
  const d = new Date((baseISO || today()) + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dueDate(po, asl) { // (purchDueDate 7121) — counts from actual receipt, else PO date
  const days = parsePaymentDays(paymentTermsText(po, asl));
  return addDaysISO(po.actualReceiptDate || po.poDate || today(), days);
}
function dueInDays(po, asl) { // (purchDueInDays 7129) — negative = overdue
  const d = new Date(dueDate(po, asl) + 'T00:00:00');
  const t = new Date(today() + 'T00:00:00');
  return Math.round((d - t) / 86400000);
}
function nextItemCode(asl, extra) { // (imNextCode 6358) — max trailing number + 1, keeping prefix/width
  let maxN = 0, prefix = 'ITM-', width = 3, saw = false;
  [...arr(asl), ...arr(extra)].forEach((r) => {
    const m = String(r.itemCode || '').match(/^(.*?)(\d+)\s*$/);
    if (!m) return;
    const n = parseInt(m[2], 10);
    if (!saw || n >= maxN) { prefix = m[1] || prefix; width = Math.max(width, m[2].length); }
    if (n > maxN) maxN = n;
    saw = true;
  });
  return prefix + String(maxN + 1).padStart(width, '0');
}

function Stat({ label, value, color }) {
  return (
    <div className="stat">
      <div className="sl">{label}</div>
      <div className="sv" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

// Tiny inline SVG sparkline of rates in chronological order (rising price = red).
function Spark({ recs }) {
  const pts = recs.slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .map((r) => num(r.rate));
  if (pts.length < 2) return <span style={{ color: 'var(--i3)', fontSize: 10 }}>—</span>;
  const W = 96, H = 24, pad = 2;
  const min = Math.min(...pts), max = Math.max(...pts), span = (max - min) || 1;
  const step = (W - 2 * pad) / (pts.length - 1);
  const d = pts.map((v, i) =>
    `${i === 0 ? 'M' : 'L'}${(pad + i * step).toFixed(1)} ${(H - pad - ((v - min) / span) * (H - 2 * pad)).toFixed(1)}`
  ).join(' ');
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={up ? '#c0392b' : '#1a7a3a'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const TABS = [
  { k: 'po', label: '📦 PO Tracking' },
  { k: 'asl', label: '🏭 Approved Suppliers' },
  { k: 'im', label: '🗂 Item Master' },
  { k: 'price', label: '📈 Price Trends' },
  { k: 'pay', label: '💳 Payments' },
  { k: 'scrap', label: '♻️ Scrap Details' },
];

/** Purchase Admin — P Dashboard. Native port of the legacy purchadmin tab. */
export default function PDashboard() {
  const [tab, setTab] = useState('po');
  return (
    <div id="app">
      <div className="pg-ttl">📦 P Dashboard</div>
      <div className="pg-sub">Every purchase order raised by the Purchase login, and the stage each one is at</div>
      <div className="step-bar" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
        ))}
      </div>
      {tab === 'po' && <POTracking />}
      {tab === 'asl' && <ASLEditor />}
      {tab === 'im' && <ItemMaster />}
      {tab === 'price' && <PriceTrends />}
      {tab === 'pay' && <Payments />}
      {tab === 'scrap' && <ScrapAdmin />}
    </div>
  );
}

/* ─────────────────────────── 1 · PO Tracking (read-only) ─────────────────────────── */
// Human stage label for a PO — status is Open / Partial / Closed, with an overdue flag. (purchStage 12323)
function stageLabel(po) {
  const st = statusOf(po);
  const overdue = st !== 'Closed' && !!po.expectedDelivery && delayDays(po) > 0;
  if (st === 'Closed') return '✓ Closed';
  if (st === 'Partial') return overdue ? '◐ Partial (Overdue)' : '◐ Partially Received';
  return overdue ? '⚠ Overdue' : '⏳ Open';
}

function POTracking() {
  const { mods } = useData();
  const purchase = mods.purchase || {};
  const asl = arr(purchase.asl);
  const pos = posOf(purchase);
  const [sup, setSup] = useState('');
  const [stat, setStat] = useState('');
  const [q, setQ] = useState('');
  const [docPo, setDocPo] = useState(null);   // PO previewed as a printable document

  const suppliers = useMemo(() => [...new Set(pos.map((p) => p.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [pos]);

  const summary = useMemo(() => {
    const s = { total: pos.length, open: 0, partial: 0, closed: 0, overdue: 0 };
    pos.forEach((p) => {
      const st = statusOf(p);
      if (st === 'Open') s.open++; else if (st === 'Partial') s.partial++; else if (st === 'Closed') s.closed++;
      if (!isClosed(p) && p.expectedDelivery && delayDays(p) > 0) s.overdue++;
    });
    return s;
  }, [pos]);

  const rows = useMemo(() => {
    let r = pos.slice().sort((a, b) => String(b.poDate || '').localeCompare(String(a.poDate || '')));
    if (sup) r = r.filter((p) => p.supplier === sup);
    if (stat) r = r.filter((p) => statusOf(p) === stat);
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((p) => String(p.poNum || '').toLowerCase().includes(s) || (p.items || []).some((i) => String(i.item || '').toLowerCase().includes(s)));
    }
    return r;
  }, [pos, sup, stat, q]);

  function exportXlsx() {
    const header = ['PO Number', 'Supplier', 'PO Date', 'Status', 'Total Amount', 'Ordered Qty', 'Received Qty', 'Expected Delivery', 'Actual Receipt', 'Delay Days'];
    const body = rows.map((po) => {
      const { ordered, received } = recvTotals(po);
      const st = statusOf(po);
      const overdue = !isClosed(po) && po.expectedDelivery && delayDays(po) > 0;
      return [po.poNum || '', supName(po.supplier), po.poDate || '', overdue ? st + ' (Overdue)' : st, num(po.totalAmount), ordered, received, po.expectedDelivery || '', po.actualReceiptDate || '', po.expectedDelivery ? delayDays(po) : ''];
    });
    exportAOA([header, ...body], 'PO_Tracking_' + today());
  }

  return (
    <>
      <div className="stats">
        <Stat label="Total POs" value={summary.total} />
        <Stat label="⏳ Open" value={summary.open} color="#856404" />
        <Stat label="◐ Partial" value={summary.partial} color="var(--blu)" />
        <Stat label="✓ Closed" value={summary.closed} color="var(--g)" />
        <Stat label="⚠ Overdue" value={summary.overdue} color="var(--red)" />
      </div>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>📦 All Purchase Orders — Stage &amp; Status <span className="tag tgr">{rows.length}</span></div>
          <select value={sup} onChange={(e) => setSup(e.target.value)}>
            <option value="">All Suppliers</option>
            {suppliers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={stat} onChange={(e) => setStat(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="Open">Open</option>
            <option value="Partial">Partial</option>
            <option value="Closed">Closed</option>
          </select>
          <input placeholder="Search PO / item…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={exportXlsx} disabled={!rows.length}>⬇ Export Excel</button>
        </div>
        <div className="pg-sub" style={{ marginTop: 0 }}>One row per item line — each item shows its own ordered vs received quantity.</div>
        <div className="tw sy">
          <table>
            <thead><tr>
              <th>PO #</th><th>Date</th><th>Supplier</th><th>Item</th>
              <th style={rt}>Rate</th><th style={rt}>Amount</th><th style={rt}>PO Qty</th><th style={rt}>Qty Recd</th>
              <th>Expected</th><th>Actual Receipt</th><th>GRN Ref</th><th>Stage</th><th style={rt}>Delay</th><th style={{ textAlign: 'center' }}>PDF</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={14} style={emptyTd}>No purchase orders found</td></tr> : rows.map((po, pi) => {
                const st = statusOf(po);
                const overdue = !isClosed(po) && !!po.expectedDelivery && delayDays(po) > 0;
                const dd = po.expectedDelivery ? delayDays(po) : null;
                const list = (po.items && po.items.length) ? po.items : [{ item: '(no items)', qty: 0, rate: 0, amount: 0, receivedQty: 0 }];
                return list.map((it, ii) => {
                  const first = ii === 0;
                  const oq = num(it.qty), rq = num(it.receivedQty);
                  const rColor = oq > 0 && rq >= oq ? 'var(--g)' : (rq > 0 ? 'var(--blu)' : 'var(--i3)');
                  const muted = { color: 'var(--i3)' };
                  return (
                    <tr key={(po.poNum || pi) + '-' + ii} style={first ? { borderTop: '2px solid var(--bd)' } : undefined}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)' }}>{first ? (po.poNum || '-') : <span style={muted}>↳</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{first ? (po.poDate ? fmtDate(po.poDate) : '-') : ''}</td>
                      <td style={{ fontSize: 11 }}>{first ? supName(po.supplier) : ''}</td>
                      <td>{it.item}{it.unit ? <span style={{ ...muted, fontSize: 10 }}> ({it.unit})</span> : null}</td>
                      <td style={{ ...rt, whiteSpace: 'nowrap' }}>{num(it.rate).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td style={{ ...rt, fontWeight: 700, whiteSpace: 'nowrap' }}>{num(it.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td style={rt}>{dash(oq)}</td>
                      <td style={{ ...rt, fontWeight: 700, color: rColor }}>{dash(rq)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{first ? (po.expectedDelivery ? fmtDate(po.expectedDelivery) : '-') : ''}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{first ? (po.actualReceiptDate ? fmtDate(po.actualReceiptDate) : '-') : ''}</td>
                      <td style={{ fontSize: 11 }}>{first ? (po.grnRef || '-') : ''}</td>
                      <td>{first ? <span className={'tag ' + tagClass(st, overdue)}>{stageLabel(po)}</span> : ''}</td>
                      <td style={{ ...rt, fontWeight: 700, color: dd == null ? 'var(--i3)' : (dd > 0 ? 'var(--red)' : 'var(--g)') }}>{first ? (dd == null ? '-' : (dd > 0 ? '+' + dd : dd)) : ''}</td>
                      <td style={{ textAlign: 'center' }}>{first ? <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 8px' }} onClick={() => setDocPo(po)} title={`PO document for ${po.poNum}`}>🖨</button> : ''}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </div>
      {docPo && <PurchaseOrderModal po={docPo} asl={asl} onClose={() => setDocPo(null)} />}
    </>
  );
}

/* ─────────────────────────── 2 · Approved Suppliers (ASL, editable) ─────────────────────────── */
// Supplier-level (company) fields — shown once per supplier group and written to
// EVERY row of that group so the PO document can read them off any row. (ASL_SUP_FIELDS 11695)
const ASL_SUP_FIELDS = ['contact', 'phone', 'contact2', 'phone2', 'email', 'address', 'pincode', 'gstn', 'speciality', 'transportCharges', 'paymentTerms'];
// Details editor (per group) — company plus the supplier-level fields above.
const ASL_DETAIL_FIELDS = [
  { k: 'company', label: 'Company Name' }, { k: 'contact', label: 'Primary Contact' }, { k: 'phone', label: 'Primary Phone' },
  { k: 'contact2', label: 'Secondary Contact' }, { k: 'phone2', label: 'Secondary Phone' }, { k: 'email', label: 'Email' },
  { k: 'address', label: 'Address', span: 2 }, { k: 'pincode', label: 'Pincode' }, { k: 'gstn', label: 'GSTN' },
  { k: 'transportCharges', label: 'Transport (Vendor / Bloomflex)' }, { k: 'paymentTerms', label: 'Payment Terms' }, { k: 'speciality', label: 'Speciality' },
];
// Add-new-supplier form fields. (renderASLEdit new form 11838)
const ASL_NEW_FIELDS = [
  { k: 'company', label: 'Company Name *', span: 2 }, { k: 'contact', label: 'Primary Contact' }, { k: 'phone', label: 'Primary Phone' },
  { k: 'email', label: 'Primary Email' }, { k: 'contact2', label: 'Secondary Contact' }, { k: 'phone2', label: 'Secondary Phone' },
  { k: 'gstn', label: 'GSTN' }, { k: 'address', label: 'Address', span: 2 }, { k: 'pincode', label: 'Pincode' },
  { k: 'speciality', label: 'Speciality' }, { k: 'paymentTerms', label: 'Payment Terms' }, { k: 'transportCharges', label: 'Transport (Vendor / Bloomflex)' },
];
// Item-level fields — one row per material within a supplier group.
const ASL_ITEM_COLS = [
  { k: 'itemCode', label: 'Item Code', w: 90 }, { k: 'materialType', label: 'Material Type', w: 110 }, { k: 'subGroup', label: 'Sub-Group', w: 100 },
  { k: 'microns', label: 'Microns', w: 70 }, { k: 'specificMaterial', label: 'Item Description', w: 180 }, { k: 'uom', label: 'UOM', w: 60 },
  { k: 'basicPrice', label: 'Basic Price', w: 90, numeric: true }, { k: 'moq', label: 'MOQ', w: 80 }, { k: 'leadTime', label: 'Lead Time', w: 90 },
];
const GKEY = (r) => r.company || '(unnamed supplier)';
const blankSupplier = () => ({ company: '', contact: '', phone: '', contact2: '', phone2: '', email: '', address: '', pincode: '', gstn: '', speciality: '', transportCharges: '', paymentTerms: '', materialType: '', subGroup: '', microns: '', specificMaterial: '', itemCode: '', uom: '', basicPrice: '', moq: '', leadTime: '', status: 'Active' });
const supLabel = { fontSize: 9.5, color: 'var(--i3)', fontWeight: 700, display: 'block' };

function ASLEditor() {
  const { mods, save } = useData();
  const purchase = mods.purchase || {};
  const [rows, setRows] = useState(() => clone(arr(purchase.asl)));
  const [q, setQ] = useState('');
  const [statFil, setStatFil] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [collapsed, setCollapsed] = useState({});     // { company: true } when hidden
  const [detailsOpen, setDetailsOpen] = useState({}); // { company: true } when the details editor is shown
  const [newOpen, setNewOpen] = useState(false);
  const [newSup, setNewSup] = useState(blankSupplier);
  const [newCerts, setNewCerts] = useState([]);

  const flash = (t, text) => { setMsg({ t, text }); setTimeout(() => setMsg(null), 4000); };
  const migrate = (obj, from, to) => { if (from === to || !(from in obj)) return obj; const n = { ...obj }; n[to] = n[from]; delete n[from]; return n; };

  // Item-level edit (one row).
  const setItemCell = (idx, f, v) => setRows((rs) => rs.map((r, j) => (j === idx ? { ...r, [f]: v } : r)));
  // Supplier-level edit — applied to every row currently in the group.
  function setSupField(company, f, v) {
    setRows((rs) => rs.map((r) => (GKEY(r) === company ? { ...r, [f]: v } : r)));
    if (f === 'company') {
      const nk = v || '(unnamed supplier)';
      setCollapsed((c) => migrate(c, company, nk));
      setDetailsOpen((c) => migrate(c, company, nk));
    }
  }
  const toggleCollapse = (company) => setCollapsed((c) => ({ ...c, [company]: !c[company] }));
  const toggleDetails = (company) => { setDetailsOpen((c) => ({ ...c, [company]: !c[company] })); setCollapsed((c) => ({ ...c, [company]: false })); };

  const groups = useMemo(() => {
    const seen = []; const map = {};
    rows.forEach((r, i) => { const c = GKEY(r); if (!map[c]) { map[c] = []; seen.push(c); } map[c].push(i); });
    return seen.map((c) => ({ company: c, idxs: map[c] }));
  }, [rows]);

  const rowMatches = (r) => {
    if (statFil && (r.status || 'Active') !== statFil) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return ['company', 'specificMaterial', 'itemCode', 'materialType', 'subGroup', 'contact', 'phone'].some((f) => String(r[f] || '').toLowerCase().includes(s));
  };
  const visGroups = groups.map((g) => ({ ...g, visIdxs: g.idxs.filter((i) => rowMatches(rows[i])) })).filter((g) => g.visIdxs.length > 0);

  function addItemToGroup(company) {
    setRows((rs) => {
      const first = rs.find((r) => GKEY(r) === company) || {};
      const row = blankSupplier();
      row.company = first.company || '';
      ASL_SUP_FIELDS.forEach((f) => { row[f] = first[f] || ''; });
      return [...rs, row];
    });
  }
  function removeRow(idx) {
    if (!window.confirm('Delete this item from the Approved Supplier List?')) return;
    setRows((rs) => rs.filter((_, j) => j !== idx));
  }

  async function saveAll() {
    setBusy(true);
    try {
      const cleaned = rows.map((r) => ({ ...r, basicPrice: r.basicPrice === '' || r.basicPrice == null ? '' : num(r.basicPrice) }));
      await save('purchase', { ...purchase, asl: cleaned });
      flash('g', '✓ Approved Supplier List saved.');
    } catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
  }

  // Legacy exportASLExcel (12303): S.No + full field set + certifications count.
  function exportXlsx() {
    if (!rows.length) { flash('r', 'No supplier data to export.'); return; }
    const header = ['S.No', 'Item Code', 'Status', 'Company Name', 'Primary Contact', 'Primary Phone', 'Secondary Contact', 'Secondary Phone', 'Material Type', 'Sub-Group', 'Microns', 'Item Description', 'UOM', 'Basic Price', 'MOQ', 'Lead Time', 'Transport Charges', 'Payment Terms', 'Email ID', 'Address', 'Pincode', 'GSTN', 'Speciality', 'Certifications Received'];
    const body = rows.map((r, i) => {
      const n = certsFor(GKEY(r)).length;
      return [i + 1, r.itemCode || '', r.status || 'Active', r.company || '', r.contact || '', r.phone || '', r.contact2 || '', r.phone2 || '',
        r.materialType || '', r.subGroup || '', r.microns || '', r.specificMaterial || '', r.uom || '', r.basicPrice ?? '', r.moq || '', r.leadTime || '',
        r.transportCharges || '', r.paymentTerms || '', r.email || '', r.address || '', r.pincode || '', r.gstn || '', r.speciality || '', n ? 'Yes (' + n + ')' : 'No'];
    });
    exportAOA([header, ...body], 'Bloomflex_Approved_Supplier_List_' + today());
  }

  // ── Add New Supplier ──
  function saveNewSupplier() {
    const name = String(newSup.company || '').trim();
    if (!name) { flash('r', 'Company name is required.'); return; }
    if (groups.some((g) => g.company.toLowerCase() === name.toLowerCase())) { flash('r', `"${name}" already exists — add items to it instead.`); return; }
    const row = blankSupplier();
    row.company = name;
    ASL_SUP_FIELDS.forEach((f) => { row[f] = String(newSup[f] || '').trim(); });
    if (newCerts.length) row.certs = newCerts.slice();
    setRows((rs) => [row, ...rs]); // new supplier group appears at the top
    setNewOpen(false); setNewSup(blankSupplier()); setNewCerts([]);
    setCollapsed((c) => ({ ...c, [name]: false }));
    flash('g', `✓ ${name} added — add its items below, then Save ASL.`);
  }
  async function pickNewCerts(fileList) {
    const { docs, errors } = await readAttachments(fileList);
    if (errors.length) flash('r', errors.join(' '));
    if (docs.length) setNewCerts((cs) => [...cs, ...docs]);
  }

  // ── Certifications (stored on the group's first row) ──
  const certsFor = (company) => { const r = rows.find((x) => GKEY(x) === company); return r && Array.isArray(r.certs) ? r.certs : []; };
  async function addCerts(company, fileList) {
    const { docs, errors } = await readAttachments(fileList);
    if (errors.length) flash('r', errors.join(' '));
    if (!docs.length) return;
    const idx = rows.findIndex((r) => GKEY(r) === company);
    if (idx < 0) return;
    const next = rows.map((r, j) => (j === idx ? { ...r, certs: [...arr(r.certs), ...docs] } : r));
    setRows(next);
    try { await save('purchase', { ...purchase, asl: next }); flash('g', `✓ ${docs.length} document(s) attached.`); }
    catch (e) { flash('r', 'Save failed: ' + e.message); }
  }
  async function deleteCert(company, ci) {
    const idx = rows.findIndex((r) => GKEY(r) === company);
    if (idx < 0) return;
    const cur = arr(rows[idx].certs);
    if (!window.confirm(`Remove "${cur[ci] ? cur[ci].name : 'this document'}"?`)) return;
    const next = rows.map((r, j) => (j === idx ? { ...r, certs: arr(r.certs).filter((_, k) => k !== ci) } : r));
    setRows(next);
    try { await save('purchase', { ...purchase, asl: next }); flash('g', '✓ Document removed.'); }
    catch (e) { flash('r', 'Save failed: ' + e.message); }
  }

  const itemInp = (idx, c, r) => (
    <input type={c.numeric ? 'number' : 'text'} step={c.numeric ? '0.01' : undefined} value={r[c.k] ?? ''}
      onChange={(e) => setItemCell(idx, c.k, e.target.value)} style={{ minWidth: c.w, ...(c.numeric ? rt : null) }} />
  );

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>🏭 Approved Supplier List <span className="tag tgr">{groups.length}</span></div>
        <input placeholder="Search company / material / contact…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={statFil} onChange={(e) => setStatFil(e.target.value)} aria-label="Status filter">
          <option value="">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={() => setNewOpen((o) => !o)}>{newOpen ? '✕ Cancel' : '＋ Add Supplier'}</button>
        <button className="btn btn-s" onClick={exportXlsx} disabled={!rows.length}>⬇ Export Excel</button>
        <button className="btn btn-g" onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : '💾 Save ASL'}</button>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      {newOpen && (
        <div style={{ background: 'var(--bg)', border: '1.5px solid var(--bd)', borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--g)', marginBottom: 10 }}>＋ Add New Supplier</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
            {ASL_NEW_FIELDS.map((f) => (
              <div key={f.k} style={f.span ? { gridColumn: 'span ' + f.span } : undefined}>
                <label style={supLabel}>{f.label}</label>
                <input value={newSup[f.k] ?? ''} onChange={(e) => setNewSup((s) => ({ ...s, [f.k]: e.target.value }))} style={{ width: '100%' }} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={supLabel}>📎 Certifications / Documents (images or PDFs)</label>
            <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => { pickNewCerts(e.target.files); e.target.value = ''; }} style={{ fontSize: 11, marginTop: 3 }} />
            {newCerts.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {newCerts.map((c, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--wh)', border: '1px solid var(--bd)', borderRadius: 12, padding: '2px 8px', margin: '2px 4px 2px 0', fontSize: 10.5 }}>
                    {c.type === 'pdf' ? 'PDF' : 'IMG'} {c.name}
                    <button onClick={() => setNewCerts((cs) => cs.filter((_, j) => j !== i))} style={{ background: 'transparent', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button className="btn btn-g" onClick={saveNewSupplier}>💾 Save Supplier</button>
          </div>
        </div>
      )}

      {visGroups.length === 0 ? (
        <div style={emptyTd}>{rows.length ? 'No suppliers match.' : 'No suppliers yet — use “＋ Add Supplier”.'}</div>
      ) : visGroups.map((g) => {
        const first = rows[g.idxs[0]];
        const open = q ? true : !collapsed[g.company];
        const showDetails = !!detailsOpen[g.company] && open;
        const certs = certsFor(g.company);
        const activeN = g.idxs.filter((i) => (rows[i].status || 'Active') === 'Active').length;
        const summary = [first.contact, first.phone, first.paymentTerms, first.transportCharges ? 'Transport: ' + first.transportCharges : ''].filter(Boolean).join(' · ');
        return (
          <div key={g.company} style={{ background: 'var(--wh)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--blu)', borderRadius: 6, marginBottom: 6, overflow: 'hidden' }}>
            <div onClick={() => toggleCollapse(g.company)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'var(--bg)' }}>
              <span style={{ fontSize: 10, color: 'var(--i3)' }}>{open ? '▼' : '▶'}</span>
              <span style={{ fontWeight: 700, fontSize: 12.5 }}>{g.company}</span>
              <span style={{ fontSize: 10.5, color: 'var(--i3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
              <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 8px' }} title="Edit supplier details" onClick={(e) => { e.stopPropagation(); toggleDetails(g.company); }}>✎ Details</button>
              {certs.length > 0 && <span className="tag tg" title="Certifications on file">📎 {certs.length}</span>}
              <span className="tag tgr">{g.idxs.length} item{g.idxs.length !== 1 ? 's' : ''}{activeN < g.idxs.length ? ' · ' + activeN + ' active' : ''}</span>
            </div>

            {showDetails && (
              <div style={{ padding: '9px 12px', background: 'var(--wh)', borderTop: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                  {ASL_DETAIL_FIELDS.map((f) => (
                    <div key={f.k} style={f.span ? { gridColumn: 'span ' + f.span } : undefined}>
                      <label style={supLabel}>{f.label}</label>
                      <input value={first[f.k] ?? ''} onChange={(e) => setSupField(g.company, f.k, e.target.value)} style={{ width: '100%' }} />
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--bd)' }}>
                  <label style={supLabel}>📎 Certifications / Documents</label>
                  <div style={{ margin: '4px 0 6px' }}>
                    {certs.length === 0 ? <span style={{ fontSize: 10.5, color: 'var(--i3)' }}>No certifications uploaded yet</span>
                      : certs.map((c, ci) => (
                        <span key={ci} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 12, padding: '2px 8px', margin: '2px 4px 2px 0', fontSize: 10.5 }}>
                          {c.type === 'pdf' ? 'PDF' : 'IMG'}
                          <button onClick={() => viewAttachment(c)} title={`View ${c.name}`} style={{ background: 'none', border: 'none', color: 'var(--blu)', cursor: 'pointer', padding: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</button>
                          <button onClick={() => deleteCert(g.company, ci)} title={`Remove ${c.name}`} style={{ background: 'transparent', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 11, padding: 0 }}>&#10005;</button>
                        </span>
                      ))}
                  </div>
                  <label className="btn btn-s" style={{ cursor: 'pointer' }}>
                    + Add document
                    <input type="file" multiple accept="image/*,application/pdf" style={{ display: 'none' }} aria-label={`Add certification for ${g.company}`}
                      onChange={(e) => { addCerts(g.company, e.target.files); e.target.value = ''; }} />
                  </label>
                </div>
              </div>
            )}

            {open && (
              <div className="tw" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 900 }}>
                  <thead><tr>
                    {ASL_ITEM_COLS.map((c) => <th key={c.k} style={{ minWidth: c.w, ...(c.numeric ? rt : null) }}>{c.label}</th>)}
                    <th style={{ minWidth: 80 }}>Status</th>
                    <th></th>
                  </tr></thead>
                  <tbody>
                    {g.visIdxs.map((idx) => {
                      const r = rows[idx];
                      return (
                        <tr key={idx} style={(r.status || 'Active') === 'Inactive' ? { opacity: 0.55 } : undefined}>
                          {ASL_ITEM_COLS.map((c) => <td key={c.k}>{itemInp(idx, c, r)}</td>)}
                          <td>
                            <select value={r.status || 'Active'} onChange={(e) => setItemCell(idx, 'status', e.target.value)}
                              style={{ color: (r.status || 'Active') === 'Active' ? 'var(--g)' : 'var(--red)', fontWeight: 700 }}>
                              <option value="Active">Active</option>
                              <option value="Inactive">Inactive</option>
                            </select>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 8px', color: 'var(--red)' }} onClick={() => removeRow(idx)} title="Delete item">✕</button>
                          </td>
                        </tr>
                      );
                    })}
                    <tr><td colSpan={ASL_ITEM_COLS.length + 2} style={{ padding: 6 }}>
                      <button className="btn btn-s" onClick={() => addItemToGroup(g.company)}>＋ Add Item</button>
                      <span className="pg-sub" style={{ margin: '0 0 0 10px', display: 'inline' }}>Item identity is also editable in the Item Master tab.</span>
                    </td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      <div className="pg-sub" style={{ margin: '8px 0 0' }}>Supplier details (contact, phone, email, address, GSTN, transport, payment terms) print on the PO document. “Save ASL” persists the whole list.</div>
    </div>
  );
}

/* ─────────────────────────── 3 · Item Master ─────────────────────────── */
const IM_FIELDS = [
  { k: 'specificMaterial', label: 'Description' },
  { k: 'materialType', label: 'Material Type' },
  { k: 'subGroup', label: 'Sub Group' },
  { k: 'microns', label: 'Microns' },
  { k: 'uom', label: 'UOM' },
];

// Header-key matcher for Excel import: case/space/punctuation-insensitive. (imImportExcel pick 12261)
function pickCol(o, names) {
  for (const k in o) {
    const kk = k.toLowerCase().replace(/[^a-z]/g, '');
    if (names.includes(kk)) return String(o[k]).trim();
  }
  return '';
}
const IM_IDENT = ['specificMaterial', 'materialType', 'subGroup', 'microns', 'uom'];

function ItemMaster() {
  const { mods, save } = useData();
  const purchase = mods.purchase || {};
  const asl = arr(purchase.asl);
  const [extra, setExtra] = useState(() => clone(arr(purchase.itemsExtra)));
  const [q, setQ] = useState('');
  const [matF, setMatF] = useState('');
  const [subF, setSubF] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const flash = (t, text) => { setMsg({ t, text }); setTimeout(() => setMsg(null), 4000); };

  // Distinct items owned by the ASL (identity managed there → read-only reference here). (imMasterList 6795)
  const aslItems = useMemo(() => {
    const seen = new Set(); const out = [];
    asl.forEach((r) => { const code = r.itemCode; if (!code || seen.has(code)) return; seen.add(code); out.push({ code, ref: r }); });
    return out;
  }, [asl]);
  const suppliersFor = (code) => [...new Set(asl.filter((r) => r.itemCode === code).map((r) => r.company).filter(Boolean))]; // (imSuppliersFor 6816)

  // Filter dropdown options: every material type / sub-group across the whole catalog. (imPopulateFilters)
  const matTypes = useMemo(
    () => [...new Set([...aslItems.map((m) => m.ref.materialType), ...extra.map((r) => r.materialType)].map((v) => String(v || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [aslItems, extra],
  );
  const subGroups = useMemo(
    () => [...new Set([...aslItems.map((m) => m.ref.subGroup), ...extra.map((r) => r.subGroup)].map((v) => String(v || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [aslItems, extra],
  );

  const setCell = (i, f, v) => setExtra((rs) => rs.map((r, j) => (j === i ? { ...r, [f]: v } : r)));
  function addItem() { setExtra((rs) => [...rs, { itemCode: nextItemCode(asl, rs), specificMaterial: '', materialType: '', subGroup: '', microns: '', uom: '' }]); }
  function delItem(i) { setExtra((rs) => rs.filter((_, j) => j !== i)); }

  async function saveAll() {
    setBusy(true);
    try { await save('purchase', { ...purchase, itemsExtra: extra }); flash('g', '✓ Item Master saved.'); }
    catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
  }

  // Export the Item Master exactly as it stands today (one row per item code). (imExportExcel 12236)
  function exportXlsx() {
    const list = [...aslItems.map((m) => ({ code: m.code, ...m.ref })), ...extra];
    if (!list.length) { flash('r', 'Item Master is empty — nothing to export.'); return; }
    const header = ['Item Code', 'Material Type', 'Sub-Group', 'Item Description', 'Microns', 'UOM', 'Supplied By'];
    const seen = new Set();
    const body = [];
    list.forEach((r) => {
      const code = r.itemCode || r.code;
      if (!code || seen.has(code)) return; seen.add(code);
      body.push([code, r.materialType || '', r.subGroup || '', r.specificMaterial || '', r.microns || '', r.uom || '', suppliersFor(code).join(', ')]);
    });
    exportAOA([header, ...body], 'Bloomflex_Item_Master_' + today());
  }

  // Import an Item Master workbook. Matches on Item Code; asks before overwriting. (imImportExcel 12250)
  async function importXlsx(file) {
    if (!file) return;
    setBusy(true);
    try {
      const rowsIn = await readSheet(file);
      const parsed = rowsIn.map((o) => ({
        code: pickCol(o, ['itemcode', 'code']),
        specificMaterial: pickCol(o, ['itemdescription', 'description', 'specificmaterial']),
        materialType: pickCol(o, ['materialtype', 'material']),
        subGroup: pickCol(o, ['subgroup', 'group']),
        microns: pickCol(o, ['microns', 'micron']),
        uom: pickCol(o, ['uom', 'unit']),
      })).filter((r) => r.code);
      if (!parsed.length) { flash('r', 'No rows with an Item Code were found in the file.'); return; }

      const existing = new Set([...aslItems.map((m) => m.code), ...extra.map((r) => r.itemCode)]);
      const nUpd = parsed.filter((r) => existing.has(r.code)).length;
      const nNew = parsed.length - nUpd;
      const ok = window.confirm('Import ' + parsed.length + ' row(s) from Excel?\n\n• ' + nUpd + ' existing item code(s) will be OVERWRITTEN (description, material type, sub-group, microns, UOM).\n• ' + nNew + ' new item code(s) will be added.\n\nProceed and overwrite?');
      if (!ok) return;

      const byCode = {}; parsed.forEach((r) => { byCode[r.code] = r; });
      // ASL rows carrying an imported code get their identity overwritten too.
      const newAsl = asl.map((a) => (byCode[a.itemCode] ? { ...a, ...IM_IDENT.reduce((o, f) => { o[f] = byCode[a.itemCode][f]; return o; }, {}) } : a));
      // Catalog-only rows: overwrite matches; append brand-new codes.
      const newExtra = extra.map((r) => (byCode[r.itemCode] ? { ...r, ...IM_IDENT.reduce((o, f) => { o[f] = byCode[r.itemCode][f]; return o; }, {}) } : r));
      parsed.forEach((r) => { if (!existing.has(r.code)) newExtra.push({ itemCode: r.code, specificMaterial: r.specificMaterial, materialType: r.materialType, subGroup: r.subGroup, microns: r.microns, uom: r.uom }); });

      await save('purchase', { ...purchase, asl: newAsl, itemsExtra: newExtra });
      setExtra(newExtra);
      flash('g', `✓ Imported — ${nUpd} updated, ${nNew} added.`);
    } catch (e) { flash('r', 'Could not read the Excel file: ' + e.message); } finally { setBusy(false); }
  }

  const match = (vals) => !q || vals.some((v) => String(v || '').toLowerCase().includes(q.toLowerCase()));
  const typeMatch = (r) => (!matF || String(r.materialType || '').trim() === matF) && (!subF || String(r.subGroup || '').trim() === subF);
  const extraRows = extra.map((r, i) => ({ r, i })).filter(({ r }) => typeMatch(r) && match([r.itemCode, r.specificMaterial, r.materialType, r.subGroup, r.microns]));
  const aslRows = aslItems.filter((m) => typeMatch(m.ref) && match([m.code, m.ref.specificMaterial, m.ref.materialType, m.ref.subGroup, m.ref.microns]));

  return (
    <>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>🗂 Item Master <span className="tag tgr">{extra.length}</span></div>
          <input placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={matF} onChange={(e) => setMatF(e.target.value)} aria-label="Filter by material type">
            <option value="">All Material Types</option>
            {matTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={subF} onChange={(e) => setSubF(e.target.value)} aria-label="Filter by sub-group">
            <option value="">All Sub-Groups</option>
            {subGroups.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={exportXlsx} disabled={busy}>⬇ Export</button>
          <label className="btn btn-s" style={{ cursor: busy ? 'default' : 'pointer' }}>
            ⬆ Import
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} disabled={busy}
              onChange={(e) => { importXlsx(e.target.files && e.target.files[0]); e.target.value = ''; }} />
          </label>
          <button className="btn btn-s" onClick={addItem}>＋ New Item Code</button>
          <button className="btn btn-g" onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : '💾 Save'}</button>
        </div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="tw sy" style={{ maxHeight: 360 }}>
          <table>
            <thead><tr><th>Code</th>{IM_FIELDS.map((f) => <th key={f.k}>{f.label}</th>)}<th></th></tr></thead>
            <tbody>
              {extraRows.length === 0 ? <tr><td colSpan={IM_FIELDS.length + 2} style={emptyTd}>No catalog-only items — use “＋ New Item Code”.</td></tr> : extraRows.map(({ r, i }) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)' }}>{r.itemCode}</td>
                  {IM_FIELDS.map((f) => (
                    <td key={f.k}><input value={r[f.k] ?? ''} onChange={(e) => setCell(i, f.k, e.target.value)} /></td>
                  ))}
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 8px', color: 'var(--red)' }} onClick={() => delItem(i)} title="Delete item code">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="ctitle">Items from Approved Suppliers <span className="tag tgr">{aslItems.length}</span></div>
        <div className="pg-sub" style={{ marginTop: 0 }}>Read-only — these item codes come from the ASL; edit their identity on the Approved Suppliers tab.</div>
        <div className="tw sy" style={{ maxHeight: 340 }}>
          <table>
            <thead><tr><th>Code</th>{IM_FIELDS.map((f) => <th key={f.k}>{f.label}</th>)}<th>Suppliers</th></tr></thead>
            <tbody>
              {aslRows.length === 0 ? <tr><td colSpan={IM_FIELDS.length + 2} style={emptyTd}>No supplier items{q ? ' match' : ' yet'}.</td></tr> : aslRows.map((m) => {
                const sups = suppliersFor(m.code);
                return (
                  <tr key={m.code}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)' }}>{m.code}</td>
                    {IM_FIELDS.map((f) => <td key={f.k} style={{ fontSize: 11 }}>{m.ref[f.k] || '-'}</td>)}
                    <td style={{ fontSize: 11, color: 'var(--i2)' }}>{sups.length ? sups.join(', ') : <span style={{ color: '#c99a2e', fontStyle: 'italic' }}>Not linked</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── 4 · Price Trends ─────────────────────────── */
const PRICE_RANGES = [['30', 'Last 30 days'], ['90', 'Last 3 months'], ['180', 'Last 6 months'], ['365', 'Last 1 year'], ['', 'All time']];

function PriceTrends() {
  const { mods } = useData();
  const purchase = mods.purchase || {};
  const priceHistory = arr(purchase.priceHistory);
  const pos = posOf(purchase);
  const asl = arr(purchase.asl);
  const [q, setQ] = useState('');
  const [supFil, setSupFil] = useState('');
  const [rangeDays, setRangeDays] = useState('');   // '' = all time
  const [chartItem, setChartItem] = useState('');   // item filter (chart + billing + detail)

  const cutoff = rangeDays ? addDaysISO(today(), -Number(rangeDays)) : '';

  // Supplier dropdown: every supplier ever traded with (ASL ∪ price history ∪ POs). (purchAslCompanies)
  const suppliers = useMemo(
    () => [...new Set([...asl.map((r) => r.company), ...priceHistory.map((r) => r.supplier), ...pos.map((p) => p.supplier)].filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [asl, priceHistory, pos],
  );

  // Working set: price points scoped by supplier + timeframe. Everything below reads this.
  const base = useMemo(() => {
    let r = priceHistory.slice();
    if (supFil) r = r.filter((x) => x.supplier === supFil);
    if (cutoff) r = r.filter((x) => String(x.date || '') >= cutoff);
    return r;
  }, [priceHistory, supFil, cutoff]);

  // Item dropdown options: items priced in the working set, plus the supplier's approved items. (purchPopulatePHItemFilter 12375)
  const itemOptions = useMemo(() => {
    const names = new Set(base.map((r) => String(r.item || '').trim()).filter(Boolean));
    asl.forEach((r) => { if (!supFil || r.company === supFil) { const n = String(r.specificMaterial || '').trim(); if (n && n !== '-') names.add(n); } });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [base, asl, supFil]);

  const groups = useMemo(() => {
    const map = {};
    base.forEach((r) => { const item = String(r.item || '').trim() || '(unspecified)'; (map[item] = map[item] || []).push(r); });
    return Object.keys(map).sort((a, b) => a.localeCompare(b)).map((item) => {
      const recs = map[item].slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const rates = recs.map((r) => num(r.rate));
      return { item, recs, latest: recs[0], latestRate: num(recs[0].rate), min: Math.min(...rates), max: Math.max(...rates), count: recs.length };
    });
  }, [base]);

  const chartItemLc = chartItem.trim().toLowerCase();
  const matches = (g) => (!chartItem || g.item.trim().toLowerCase() === chartItemLc)
    && (!q || g.item.toLowerCase().includes(q.toLowerCase()) || g.recs.some((r) => String(r.supplier || '').toLowerCase().includes(q.toLowerCase())));
  const summaryGroups = groups.filter(matches);

  // Trend chart over the working set: one line per supplier for a chosen item,
  // or one line per supplier across all items. (purchRenderPriceChart 7040)
  const chart = useMemo(
    () => buildScrapChart(base, { itemFil: chartItem, seriesKey: 'supplier' }),
    [base, chartItem],
  );

  // Per-supplier billing summary: what we billed with this supplier in the period,
  // honouring the item filter. (purchRenderPHBilling 12805)
  const billing = useMemo(() => {
    if (!supFil) return null;
    let sp = pos.filter((p) => p.supplier === supFil);
    if (cutoff) sp = sp.filter((p) => String(p.poDate || '') >= cutoff);
    const rows = [];
    sp.forEach((po) => {
      const its = (po.items || []).filter((it) => !chartItemLc || String(it.item || '').trim().toLowerCase() === chartItemLc);
      if (!its.length) return;
      rows.push({ po, items: its, amt: its.reduce((s, i) => s + num(i.amount), 0) });
    });
    const total = rows.reduce((s, r) => s + r.amt, 0);
    const paid = rows.filter((r) => (r.po.paymentStatus || 'Unpaid') === 'Paid').reduce((s, r) => s + r.amt, 0);
    rows.sort((a, b) => String(b.po.poDate || '').localeCompare(String(a.po.poDate || '')));
    return { rows, total, paid, unpaid: total - paid };
  }, [pos, supFil, cutoff, chartItemLc]);

  // Flat detail, newest first, with Δ vs the previous rate for the same supplier+item. (purchRenderPriceHistory 12387)
  const detail = useMemo(() => {
    let rows = base.slice();
    if (chartItem) rows = rows.filter((r) => String(r.item || '').trim().toLowerCase() === chartItemLc);
    if (q) {
      const s = q.toLowerCase();
      rows = rows.filter((r) => String(r.item || '').toLowerCase().includes(s) || String(r.supplier || '').toLowerCase().includes(s) || String(r.poNum || '').toLowerCase().includes(s));
    }
    const chrono = rows.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const last = {};
    const withDelta = chrono.map((r) => {
      const k = r.supplier + '|' + r.item;
      const prev = last[k];
      const delta = prev === undefined ? null : (num(r.rate) - prev);
      last[k] = num(r.rate);
      return { ...r, delta };
    });
    return withDelta.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [base, q, chartItem, chartItemLc]);

  return (
    <>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Price Trends by Item <span className="tag tgr">{summaryGroups.length}</span></div>
          <select value={supFil} onChange={(e) => setSupFil(e.target.value)} aria-label="Filter by supplier">
            <option value="">All Suppliers</option>
            {suppliers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={chartItem} onChange={(e) => setChartItem(e.target.value)} aria-label="Filter by item">
            <option value="">All Items</option>
            {itemOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={rangeDays} onChange={(e) => setRangeDays(e.target.value)} aria-label="Timeframe">
            {PRICE_RANGES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
        <div className="fbar" style={{ marginTop: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--i2)' }}>
            {chartItem ? 'One line per supplier for this item.' : 'One line per supplier across all items.'}
          </span>
        </div>
        {!chart ? (
          <div style={emptyTd}>No price points yet — they build up as POs are raised.</div>
        ) : (
          <>
            <div style={{ marginBottom: 6 }}>
              {chart.series.map((sr) => (
                <span key={sr.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 14, marginBottom: 4, fontSize: 11, color: 'var(--i2)' }}>
                  <span style={{ width: 14, height: 3, borderRadius: 2, background: sr.color, display: 'inline-block' }} />{sr.label}
                </span>
              ))}
            </div>
            <div style={{ background: 'var(--wh)', border: '1px solid var(--bd)', borderRadius: 10, padding: '10px 6px 4px', maxWidth: 640 }}>
              <svg viewBox={`0 0 ${CHART_BOX.W} ${CHART_BOX.H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Supplier price trend">
                {chart.yTicks.map((t, i) => (
                  <g key={'y' + i}>
                    <line x1={CHART_BOX.mL} y1={t.y.toFixed(1)} x2={CHART_BOX.W - CHART_BOX.mR} y2={t.y.toFixed(1)} stroke="#eef1f6" strokeWidth="1" strokeDasharray="3 4" />
                    <text x={CHART_BOX.mL - 6} y={(t.y + 3).toFixed(1)} textAnchor="end" fontSize="8.5" fill="#b6bfcc">{t.label}</text>
                  </g>
                ))}
                {chart.xTicks.map((t) => (
                  <text key={t.d} x={t.x.toFixed(1)} y={CHART_BOX.H - CHART_BOX.mB + 16} textAnchor="middle" fontSize="8.5" fill="#b6bfcc">{fmtDate(t.d).slice(0, 6)}</text>
                ))}
                {chart.series.map((sr) => <path key={'p' + sr.key} d={sr.path} fill="none" stroke={sr.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
                {chart.series.map((sr) => sr.points.map((pt, i) => (
                  <circle key={sr.key + i} cx={pt.x.toFixed(1)} cy={pt.y.toFixed(1)} r="3" fill={sr.color}><title>{pt.tip}</title></circle>
                )))}
              </svg>
            </div>
            {chart.truncated && <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 4 }}>Showing first 6 series — narrow with the item filter.</div>}
          </>
        )}
        <div className="fbar" style={{ marginTop: 12 }}>
          <input placeholder="Search item / supplier / PO…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {priceHistory.length === 0 && <div className="al al-b">No price records yet — these are captured automatically when a PO is generated.</div>}
        {summaryGroups.length > 0 && (
          <div className="tw sy" style={{ maxHeight: 320 }}>
            <table>
              <thead><tr><th>Item</th><th style={rt}>Latest Rate</th><th>Latest Date</th><th style={rt}>Min Rate</th><th style={rt}>Max Rate</th><th style={rt}>Records</th><th>Trend</th></tr></thead>
              <tbody>
                {summaryGroups.map((g) => (
                  <tr key={g.item}>
                    <td style={{ fontWeight: 600 }}>{g.item}</td>
                    <td style={{ ...rt, fontWeight: 700 }}>{inr(g.latestRate, 2)}</td>
                    <td>{g.latest.date ? fmtDate(g.latest.date) : '-'}</td>
                    <td style={{ ...rt, color: 'var(--g)', fontWeight: 600 }}>{inr(g.min, 2)}</td>
                    <td style={{ ...rt, color: 'var(--red)' }}>{inr(g.max, 2)}</td>
                    <td style={rt}>{g.count}</td>
                    <td><Spark recs={g.recs} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {billing && (
        <div className="card">
          <div className="ctitle" style={{ margin: 0 }}>
            Billing — {supFil}{chartItem ? ' · ' + chartItem : ''} <span className="tag tgr">{billing.rows.length}</span>
          </div>
          <div className="stats" style={{ marginTop: 10 }}>
            <Stat label={'Total Billed (' + billing.rows.length + ' PO' + (billing.rows.length === 1 ? '' : 's') + ')'} value={rupees(billing.total, 0)} color="var(--blu)" />
            <Stat label="Paid" value={rupees(billing.paid, 0)} color="var(--g)" />
            <Stat label="Unpaid" value={rupees(billing.unpaid, 0)} color="#856404" />
          </div>
          {billing.rows.length === 0 ? (
            <div style={emptyTd}>No POs for this supplier{chartItem ? ' / item filter' : ''} in this period.</div>
          ) : (
            <div className="tw sy" style={{ maxHeight: 260, marginTop: 10 }}>
              <table>
                <thead><tr><th>PO #</th><th>Date</th><th>Item(s)</th><th style={rt}>Billed ₹</th><th style={{ textAlign: 'center' }}>Stage</th><th style={{ textAlign: 'center' }}>Payment</th></tr></thead>
                <tbody>
                  {billing.rows.map((r) => {
                    const paid = (r.po.paymentStatus || 'Unpaid') === 'Paid';
                    const st = statusOf(r.po);
                    const overdue = !isClosed(r.po) && !!r.po.expectedDelivery && delayDays(r.po) > 0;
                    return (
                      <tr key={r.po.poNum}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)' }}>{r.po.poNum}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.po.poDate ? fmtDate(r.po.poDate) : '-'}</td>
                        <td style={{ fontSize: 11 }}>{r.items.map((i) => i.item + ' (' + num(i.qty).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + (i.unit ? ' ' + i.unit : '') + ')').join(', ')}</td>
                        <td style={{ ...rt, fontWeight: 700 }}>{inr(r.amt, 2)}</td>
                        <td style={{ textAlign: 'center' }}><span className={'tag ' + tagClass(st, overdue)}>{stageLabel(r.po)}</span></td>
                        <td style={{ textAlign: 'center' }}><span className={'tag ' + (paid ? 'tg' : 'ty')}>{paid ? '✓ Paid' : '⏳ Unpaid'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="ctitle">📈 Price Fluctuation Records <span className="tag tgr">{detail.length}</span></div>
        <div className="tw sy" style={{ maxHeight: 360 }}>
          <table>
            <thead><tr><th>Date</th><th>Supplier</th><th>Item</th><th style={rt}>Rate</th><th style={rt}>Δ</th><th>PO #</th></tr></thead>
            <tbody>
              {detail.length === 0 ? <tr><td colSpan={6} style={emptyTd}>No price records.</td></tr> : detail.map((r, i) => {
                let delta = <span style={{ color: 'var(--i3)' }}>-</span>;
                if (r.delta !== null && r.delta !== undefined) {
                  const up = r.delta > 0, down = r.delta < 0;
                  delta = <span style={{ color: up ? 'var(--red)' : (down ? 'var(--g)' : 'var(--i3)'), fontWeight: 700 }}>{up ? '▲ +' : (down ? '▼ ' : '')}{Math.abs(r.delta).toFixed(2)}</span>;
                }
                return (
                  <tr key={i}>
                    <td>{r.date ? fmtDate(r.date) : '-'}</td>
                    <td style={{ fontSize: 11 }}>{supName(r.supplier)}</td>
                    <td>{r.item}</td>
                    <td style={{ ...rt, fontWeight: 700 }}>{inr(r.rate, 2)}</td>
                    <td style={rt}>{delta}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.poNum || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── 5 · Payments (read-only overview) ─────────────────────────── */
function Payments() {
  const { mods } = useData();
  const purchase = mods.purchase || {};
  const pos = posOf(purchase);
  const asl = arr(purchase.asl);
  const [sup, setSup] = useState('');
  const [stat, setStat] = useState('');
  const [term, setTerm] = useState('');

  const suppliers = useMemo(() => [...new Set(pos.map((p) => p.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [pos]);
  const terms = useMemo(() => [...new Set(asl.map((r) => r.paymentTerms).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [asl]);

  // Cash-flow stats — always off the FULL unfiltered set, not the filtered view. (purchRenderPayments 12602)
  const totals = useMemo(() => {
    const unpaid = pos.filter((p) => (p.paymentStatus || 'Unpaid') === 'Unpaid');
    const overdue = unpaid.filter((p) => dueInDays(p, asl) < 0).length;
    const totalPayable = unpaid.reduce((s, p) => s + num(p.totalAmount), 0);
    const outstandingToday = unpaid.filter((p) => dueInDays(p, asl) <= 0).reduce((s, p) => s + num(p.totalAmount), 0);
    const outstanding15 = unpaid.filter((p) => dueInDays(p, asl) <= 15).reduce((s, p) => s + num(p.totalAmount), 0);
    const thisMonth = today().slice(0, 7);
    const paidThisMonth = pos.filter((p) => (p.paymentStatus || '') === 'Paid' && String(p.paymentDate || '').slice(0, 7) === thisMonth).reduce((s, p) => s + num(p.totalAmount), 0);
    return { unpaidCount: unpaid.length, overdue, totalPayable, outstandingToday, outstanding15, paidThisMonth };
  }, [pos, asl]);

  const rows = useMemo(() => {
    let r = pos.slice();
    if (sup) r = r.filter((p) => p.supplier === sup);
    if (term) r = r.filter((p) => paymentTermsText(p, asl) === term);
    if (stat) r = r.filter((p) => (p.paymentStatus || 'Unpaid') === stat);
    return r.sort((a, b) => dueInDays(a, asl) - dueInDays(b, asl));
  }, [pos, asl, sup, term, stat]);

  function exportXlsx() {
    const header = ['PO Number', 'Supplier', 'PO / Invoice Date', 'GRN Ref', 'Actual Receipt Date', 'Payment Terms', 'Payment Due Date', 'Days to Due (neg = overdue)', 'Amount (Rs)', 'Payment Status', 'Actual Payment Date'];
    const body = rows.map((po) => {
      const paid = (po.paymentStatus || 'Unpaid') === 'Paid';
      return [po.poNum || '', supName(po.supplier), po.poDate || '', po.grnRef || '', po.actualReceiptDate || '', paymentTermsText(po, asl), dueDate(po, asl), paid ? '' : dueInDays(po, asl), num(po.totalAmount), po.paymentStatus || 'Unpaid', po.paymentDate || ''];
    });
    exportAOA([header, ...body], 'Bloomflex_Supplier_Payments_' + today());
  }

  return (
    <>
      <div className="stats">
        <Stat label="⚠ Bills Overdue" value={totals.overdue} color="var(--red)" />
        <Stat label={'💰 Total Payable (' + totals.unpaidCount + ' bills)'} value={rupees(totals.totalPayable, 0)} color="var(--blu)" />
        <Stat label="📅 Outstanding Today" value={rupees(totals.outstandingToday, 0)} color="#a3510a" />
        <Stat label="📆 Outstanding in 15 Days" value={rupees(totals.outstanding15, 0)} color="#856404" />
        <Stat label="✓ Total Paid (This Month)" value={rupees(totals.paidThisMonth, 0)} color="var(--g)" />
      </div>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>💳 Supplier Payments <span className="tag tgr">{rows.length}</span></div>
          <select value={sup} onChange={(e) => setSup(e.target.value)}>
            <option value="">All Suppliers</option>
            {suppliers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Filter by payment terms">
            <option value="">All Payment Terms</option>
            {terms.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={stat} onChange={(e) => setStat(e.target.value)}>
            <option value="">All</option>
            <option value="Paid">Paid</option>
            <option value="Unpaid">Unpaid</option>
          </select>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={exportXlsx} disabled={!rows.length}>⬇ Export Excel</button>
        </div>
        <div className="al al-b">Read-only overview — payments are marked by the Purchase role.</div>
        <div className="tw sy">
          <table>
            <thead><tr><th>PO #</th><th>Supplier</th><th style={rt}>Amount</th><th>Terms</th><th>Due Date</th><th style={rt}>Due In</th><th style={{ textAlign: 'center' }}>Status</th><th>Paid On</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={8} style={emptyTd}>No purchase orders match these filters</td></tr> : rows.map((po, i) => {
                const paid = (po.paymentStatus || 'Unpaid') === 'Paid';
                const di = dueInDays(po, asl);
                return (
                  <tr key={po.poNum || i}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)' }}>{po.poNum || '-'}</td>
                    <td style={{ fontSize: 11 }}>{supName(po.supplier)}</td>
                    <td style={{ ...rt, fontWeight: 700 }}>{rupees(po.totalAmount, 0)}</td>
                    <td style={{ fontSize: 11 }}>{paymentTermsText(po, asl) || '-'}</td>
                    <td>{fmtDate(dueDate(po, asl))}</td>
                    <td style={{ ...rt, fontWeight: 700, color: paid ? 'var(--i3)' : (di < 0 ? 'var(--red)' : (di <= 15 ? '#a3510a' : 'var(--g)')) }}>
                      {paid ? '-' : (di < 0 ? Math.abs(di) + 'd overdue' : (di === 0 ? 'Due today' : di + 'd left'))}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={'tag ' + (paid ? 'tg' : (di < 0 ? 'tr' : 'ty'))}>{paid ? '✓ Paid' : (di < 0 ? '⚠ Overdue' : '⏳ Unpaid')}</span>
                    </td>
                    <td style={{ fontSize: 11 }}>{paid && po.paymentDate ? fmtDate(po.paymentDate) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── 6 · Scrap Admin ─────────────────────────── */
const SCRAP_BUYER_FIELDS = [
  { k: 'name', label: 'Name' },
  { k: 'contact', label: 'Contact' },
  { k: 'phone', label: 'Phone' },
  { k: 'address', label: 'Address' },
  { k: 'gstn', label: 'GSTN' },
];

function ScrapAdmin() {
  const { mods, save } = useData();
  const scrap = mods.scrap || {};
  const prices = arr(scrap.prices);
  const txns = arr(scrap.txns);
  const [buyers, setBuyers] = useState(() => clone(arr(scrap.buyers)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [buyerFil, setBuyerFil] = useState('');
  const [itemFil, setItemFil] = useState('');

  const flash = (t, text) => { setMsg({ t, text }); setTimeout(() => setMsg(null), 3500); };
  const buyerName = (id) => { const b = buyers.find((x) => x.id === id); return b ? b.name : id; }; // (scrapBuyerName 4896)

  const stats = useMemo(() => {
    const total = txns.reduce((s, t) => s + num(t.amount), 0);
    const cash = txns.filter((t) => t.mode === 'Cash').reduce((s, t) => s + num(t.amount), 0);
    const acct = txns.filter((t) => t.mode === 'Account').reduce((s, t) => s + num(t.amount), 0);
    return { total, cash, acct };
  }, [txns]);

  const recentPrices = useMemo(() => prices.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [prices]);
  const recentSales = useMemo(() => txns.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [txns]);

  // Today's posted buying prices, with the best rate per item starred — the
  // "who do I sell to today?" board. (scrapAdminToday 5090)
  const todaysPrices = useMemo(() => {
    const t = today();
    const rows = prices.filter((p) => p.date === t)
      .slice().sort((a, b) => String(buyerName(a.buyer)).localeCompare(String(buyerName(b.buyer))));
    const best = bestByItem(rows);
    return rows.map((p) => ({ ...p, best: best[p.item] && best[p.item].buyer === p.buyer }));
  }, [prices, buyers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Item filter options: every item ever priced, plus the master item list.
  const itemOptions = useMemo(
    () => [...new Set(prices.map((p) => p.item).concat(arr(scrap.items)))].filter(Boolean).sort(),
    [prices, scrap.items],
  );
  const chart = useMemo(
    () => buildScrapChart(prices, { buyerFil, itemFil, labelOf: buyerName }),
    [prices, buyerFil, itemFil, buyers], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const setCell = (i, f, v) => setBuyers((bs) => bs.map((b, j) => (j === i ? { ...b, [f]: v } : b)));
  function removeBuyer(i) { setBuyers((bs) => bs.filter((_, j) => j !== i)); }

  async function saveBuyers() { // (scrapAdminSaveBuyers 5077)
    const cleaned = buyers.map((b) => ({ ...b, name: String(b.name || '').trim(), contact: String(b.contact || '').trim(), phone: String(b.phone || '').trim(), address: String(b.address || '').trim(), gstn: String(b.gstn || '').trim() }));
    setBuyers(cleaned);
    setBusy(true);
    try { await save('scrap', { ...scrap, buyers: cleaned }); flash('g', '✓ Buyer details saved.'); }
    catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
  }
  function exportSales() {
    if (!txns.length) return;
    const header = ['Date', 'Buyer', 'Item', 'Qty', 'Rate', 'Amount', 'Mode'];
    const body = txns.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).map((t) => [t.date || '', buyerName(t.buyer), t.item || '', num(t.qty), num(t.rate), num(t.amount), t.mode || '']);
    exportAOA([header, ...body], 'Scrap_Sales_' + today());
  }

  return (
    <>
      <div className="stats">
        <Stat label="Total Scrap Revenue" value={rupees(stats.total, 0)} color="var(--g)" />
        <Stat label="Received in Cash" value={rupees(stats.cash, 0)} color="#a3510a" />
        <Stat label="Received into Account" value={rupees(stats.acct, 0)} color="var(--blu)" />
        <Stat label="Scrap Buyers" value={buyers.length} />
      </div>

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>✎ Scrap Buyers <span className="tag tgr">{buyers.length}</span></div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-g" onClick={saveBuyers} disabled={busy}>{busy ? 'Saving…' : '💾 Save Buyers'}</button>
        </div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="tw sy" style={{ maxHeight: 320 }}>
          <table>
            <thead><tr><th>ID</th>{SCRAP_BUYER_FIELDS.map((f) => <th key={f.k}>{f.label}</th>)}<th></th></tr></thead>
            <tbody>
              {buyers.length === 0 ? <tr><td colSpan={SCRAP_BUYER_FIELDS.length + 2} style={emptyTd}>No buyers yet</td></tr> : buyers.map((b, i) => (
                <tr key={b.id || i}>
                  <td><span className="tag tgr">{b.id || '-'}</span></td>
                  {SCRAP_BUYER_FIELDS.map((f) => (
                    <td key={f.k}><input value={b[f.k] ?? ''} onChange={(e) => setCell(i, f.k, e.target.value)} /></td>
                  ))}
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 8px', color: 'var(--red)' }} onClick={() => removeBuyer(i)} title="Remove buyer">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pg-sub" style={{ margin: '8px 0 0' }}>Removing a buyer takes effect when you click “Save Buyers”. Past sales and price history are kept.</div>
      </div>

      <div className="g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="ctitle">🏷️ Today's Buying Prices — all buyers <span className="tag tgr">{todaysPrices.length}</span></div>
          <div className="tw sy" style={{ maxHeight: 260 }}>
            <table>
              <thead><tr><th>Buyer</th><th>Item</th><th style={rt}>Rate ₹</th><th style={{ textAlign: 'center' }}>Best?</th></tr></thead>
              <tbody>
                {todaysPrices.length === 0 ? <tr><td colSpan={4} style={emptyTd}>No buying prices posted today.</td></tr> : todaysPrices.map((p, i) => (
                  <tr key={i} style={p.best ? { background: '#EAF7EF' } : undefined}>
                    <td style={{ fontSize: 11 }}>{buyerName(p.buyer)}</td>
                    <td>{p.item}</td>
                    <td style={{ ...rt, fontWeight: 700 }}>{inr(p.rate, 2)}</td>
                    <td style={{ textAlign: 'center' }}>{p.best ? <span style={{ color: 'var(--g)', fontWeight: 700 }}>★ best</span> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="fbar">
            <div className="ctitle" style={{ margin: 0 }}>📈 Scrap Price Trends</div>
            <span style={{ fontSize: 11, color: 'var(--i3)' }}>{scrapChartTitle({ buyerFil, itemFil, labelOf: buyerName })}</span>
            <span style={{ flex: 1 }} />
            <select value={buyerFil} onChange={(e) => setBuyerFil(e.target.value)} aria-label="Filter by buyer">
              <option value="">All Buyers</option>
              {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={itemFil} onChange={(e) => setItemFil(e.target.value)} aria-label="Filter by item">
              <option value="">All Items</option>
              {itemOptions.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          {!chart ? (
            <div style={emptyTd}>No price points yet. As buyers post prices and sales are recorded, trends appear here.</div>
          ) : (
            <>
              <div style={{ marginBottom: 6 }}>
                {chart.series.map((sr) => (
                  <span key={sr.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 14, marginBottom: 4, fontSize: 11, color: 'var(--i2)' }}>
                    <span style={{ width: 14, height: 3, borderRadius: 2, background: sr.color, display: 'inline-block' }} />{sr.label}
                  </span>
                ))}
              </div>
              <div style={{ background: 'var(--wh)', border: '1px solid var(--bd)', borderRadius: 10, padding: '10px 6px 4px', maxWidth: 640 }}>
                <svg viewBox={`0 0 ${CHART_BOX.W} ${CHART_BOX.H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Scrap buying price trend">
                  {chart.yTicks.map((t, i) => (
                    <g key={'y' + i}>
                      <line x1={CHART_BOX.mL} y1={t.y.toFixed(1)} x2={CHART_BOX.W - CHART_BOX.mR} y2={t.y.toFixed(1)} stroke="#eef1f6" strokeWidth="1" strokeDasharray="3 4" />
                      <text x={CHART_BOX.mL - 6} y={(t.y + 3).toFixed(1)} textAnchor="end" fontSize="8.5" fill="#b6bfcc">{t.label}</text>
                    </g>
                  ))}
                  {chart.xTicks.map((t) => (
                    <text key={t.d} x={t.x.toFixed(1)} y={CHART_BOX.H - CHART_BOX.mB + 16} textAnchor="middle" fontSize="8.5" fill="#b6bfcc">{fmtDate(t.d).slice(0, 6)}</text>
                  ))}
                  {chart.series.map((sr) => (
                    <path key={'p' + sr.key} d={sr.path} fill="none" stroke={sr.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  ))}
                  {chart.series.map((sr) => sr.points.map((pt, i) => (
                    <circle key={sr.key + i} cx={pt.x.toFixed(1)} cy={pt.y.toFixed(1)} r="3" fill={sr.color}><title>{pt.tip}</title></circle>
                  )))}
                </svg>
              </div>
              {chart.truncated && <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 4 }}>Showing first 6 series — use the filters to narrow.</div>}
            </>
          )}
        </div>
      </div>

      <div className="g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="ctitle">Recent Buying Prices <span className="tag tgr">{prices.length}</span></div>
          <div className="tw sy" style={{ maxHeight: 320 }}>
            <table>
              <thead><tr><th>Date</th><th>Buyer</th><th>Item</th><th style={rt}>Rate</th></tr></thead>
              <tbody>
                {recentPrices.length === 0 ? <tr><td colSpan={4} style={emptyTd}>No buying prices posted.</td></tr> : recentPrices.map((p, i) => (
                  <tr key={i}>
                    <td>{p.date ? fmtDate(p.date) : '-'}</td>
                    <td style={{ fontSize: 11 }}>{buyerName(p.buyer)}</td>
                    <td>{p.item}</td>
                    <td style={{ ...rt, fontWeight: 700 }}>{inr(p.rate, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="fbar">
            <div className="ctitle" style={{ margin: 0 }}>💰 Scrap Sales <span className="tag tgr">{txns.length}</span></div>
            <span style={{ flex: 1 }} />
            <button className="btn btn-s" onClick={exportSales} disabled={!txns.length}>⬇ Export</button>
          </div>
          <div className="tw sy" style={{ maxHeight: 320 }}>
            <table>
              <thead><tr><th>Date</th><th>Buyer</th><th>Item</th><th style={rt}>Qty</th><th style={rt}>Rate</th><th style={rt}>Amount</th><th style={{ textAlign: 'center' }}>Mode</th></tr></thead>
              <tbody>
                {recentSales.length === 0 ? <tr><td colSpan={7} style={emptyTd}>No scrap sales recorded yet</td></tr> : recentSales.map((t, i) => (
                  <tr key={i}>
                    <td>{t.date ? fmtDate(t.date) : '-'}</td>
                    <td style={{ fontSize: 11 }}>{buyerName(t.buyer)}</td>
                    <td>{t.item}</td>
                    <td style={rt}>{dash(t.qty)}</td>
                    <td style={rt}>{inr(t.rate, 2)}</td>
                    <td style={{ ...rt, fontWeight: 700 }}>{rupees(t.amount, 0)}</td>
                    <td style={{ textAlign: 'center' }}><span className={'tag ' + (t.mode === 'Account' ? 'tb' : 'ty')}>{t.mode || '-'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
