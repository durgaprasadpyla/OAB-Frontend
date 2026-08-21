import { useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../data.jsx';
import { ordersApi } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { balance, calcMetres, calcKg } from '../lib/calc.js';
import { dash, fmtDate } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { downloadOabPdf } from '../lib/oabPdf.js';
import { useSoOrder, soOrder } from '../lib/soOrder.js';
import { getCustByLoc } from '../lib/master.js';
import { DispFormBadge, ProdBadge, BalanceBadge } from '../components/badges.jsx';

/**
 * What each stat card counts, shown behind its ⓘ. Every one of these is a figure
 * someone plans production or buys film against, so the formula belongs on the
 * screen rather than in somebody's head.
 */
const STAT_INFO = {
  sos: 'Open sale orders matching the filters above. Closed SOs are not counted — they live behind the Closed SOs button.',
  poQty: 'Total quantity ordered across the sale orders in view. Pieces for pouches, labels and bulk bags; kilograms for rolls.',
  dispatched: 'Everything already sent out: the Inv column (invoiced) plus the Man column (manually dispatched).',
  fg: 'Finished goods already allocated to these sale orders from the FG pool. Allocated FG counts as done, so it reduces the balance.',
  balProduce: 'PO Qty − Inv − Man − FG, per order, never below zero. What is still to be made.',
  balMtrs: 'Running metres for the balance, including the 5% wastage allowance. Pouches: qty × pouch width. Bulk bags: qty × height. Rolls: derived from film width and GSM. Labels contribute no metres.',
  balKg: "Weight of the film for the balance, including the same 5% wastage as Bal Mtrs: qty × the spec's pouch weight from the JSS × 1.05. Rolls are ordered in kilograms, so their balance is the weight directly. A spec with no weight on the JSS is left out and flagged below.",
};

/** Whole days since an SO's PO date (null if no/invalid date), for the Age column. */
function soAgeDays(poDate) {
  if (!poDate) return null;
  const d = new Date(poDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

/** Order & Production Balance board (native port of renderOAB, legacy 1839). */
export default function OabBoard() {
  const { mods } = useData();
  const [sp, setSp] = useSearchParams();
  const sheet = sp.get('sheet') === 'OT' ? 'OT' : 'SF';

  // Orders come from the normalized endpoint (scoped to this sheet), not the whole
  // `oab` blob. The row `payload` column carries the exact original row JSON, so
  // everything downstream (filters, totals, Excel/PDF) is unchanged. jss + prodStatus
  // stay on the blob context (small master data we're deliberately not migrating).
  const { data: rawRows, loading: rowsLoading, error: rowsError, refetch: refetchRows } =
    useApi('/api/oab-rows?sheet=' + sheet);

  const [q, setQ] = useState('');
  const [cf, setCf] = useState('');
  const [stf, setStf] = useState('');
  const [spf, setSpf] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const order = useSoOrder();
  const tableRef = useRef(null);

  // JSS is authoritative for customer/sub-brand names (syncOABFromJSS, 1826).
  const jssBySpec = useMemo(() => {
    const m = {};
    (mods.jss || []).forEach((j) => { if (j && j.spec) m[j.spec] = j; });
    return m;
  }, [mods.jss]);

  const allRows = useMemo(() => (Array.isArray(rawRows) ? rawRows : []).map((r) => {
    const p = r.payload ?? r.PAYLOAD;          // MySQL lowercases columns, H2 uppercases
    if (p) { try { return JSON.parse(p); } catch { /* fall back to the flat columns */ } }
    return r;
  }), [rawRows]);
  const openRows = useMemo(() => allRows.filter((r) => !r.closed).map((r) => {
    const j = jssBySpec[r.spec];
    return j ? { ...r, customer: j.customer || r.customer, subBrand: j.subBrand || r.subBrand } : r;
  }), [allRows, jssBySpec]);
  const closedRows = useMemo(() => allRows.filter((r) => r.closed), [allRows]);

  const customers = useMemo(() => [...new Set(openRows.map((r) => r.customer))].filter(Boolean).sort(), [openRows]);
  const stages = useMemo(() => [...new Set(openRows.map((r) => r.stage))].filter(Boolean).sort(), [openRows]);
  const specs = useMemo(() => [...new Set(openRows.map((r) => r.spec))].filter(Boolean).sort(), [openRows]);

  // "Loc Code" is the warehouse the row dispatches to — from the row if it carries
  // one, else looked up in the Customer Master. It is searchable too. (renderOAB)
  const locCode = (r) => r.warehouseName || (getCustByLoc(mods.customers, r.customer, r.dispLoc) || {}).warehouseName || '';

  const filtered = useMemo(() => {
    const list = openRows.filter((r) => {
      if (cf && r.customer !== cf) return false;
      if (stf && r.stage !== stf) return false;
      if (spf && r.spec !== spf) return false;
      if (q) {
        const s = q.toLowerCase();
        const hay = [r.so, r.customer, r.jobName, r.spec, r.poNum, r.dispLoc, r.warehouseName,
          (getCustByLoc(mods.customers, r.customer, r.dispLoc) || {}).warehouseName];
        if (!hay.some((v) => String(v || '').toLowerCase().includes(s))) return false;
      }
      return true;
    });
    return soOrder(list, order.newestFirst);
  }, [openRows, q, cf, stf, spf, mods.customers, order.newestFirst]);

  const tPO = filtered.reduce((s, r) => s + (Number(r.poQty) || 0), 0);
  const tD = filtered.reduce((s, r) => s + (Number(r.invDisp) || 0) + (Number(r.manDisp) || 0), 0);
  const tFG = filtered.reduce((s, r) => s + (Number(r.fg) || 0), 0);
  const tB = filtered.reduce((s, r) => s + balance(r), 0);
  // Bal Mtrs carries the same 5% wastage allowance the per-row Mtrs column and the
  // banner underneath already state — a client change (2026-08-21) from the net
  // figure the monolith shows, so that all three agree.
  const tM = filtered.reduce((s, r) => s + calcMetres(r, balance(r), jssBySpec[r.spec]).withWastage, 0);

  // Bal Kg's — the balance converted to weight. A spec with no pouch weight on the
  // JSS is counted separately rather than as zero, so an under-reported total is
  // visible instead of silent.
  const kg = useMemo(() => filtered.reduce((acc, r) => {
    const b = balance(r);
    const k = calcKg(r, b, jssBySpec[r.spec]);
    if (k == null) { if (b > 0) acc.noWeight++; return acc; }
    acc.total += k.withWastage;   // same 5% wastage allowance as Bal Mtrs
    return acc;
  }, { total: 0, noWeight: 0 }), [filtered, jssBySpec]);

  const prodStatus = (so) => (mods.prodStatus && mods.prodStatus[so]) || 'Ready';
  const setSheet = (k) => { setSp({ sheet: k }); setShowClosed(false); };

  async function reopen(so) {
    try { await ordersApi.reopen(so); await refetchRows(); }
    catch (e) { alert('Reopen failed: ' + (e.message || e)); }
  }

  function exportExcel() {
    const header = ['SO', 'Spec', 'Dispatch', 'Customer', 'Job', 'Sub Brand', 'Disp Loc', 'Loc Code', 'PO#', 'PO Date',
      'PO Qty', 'Inv', 'Man', 'FG', 'Balance', 'Metres+5%', 'Prod Status', 'Stage'];
    const body = filtered.map((r) => {
      const b = balance(r);
      const m = calcMetres(r, b, jssBySpec[r.spec]).withWastage;
      return [r.so, r.spec, r.dispatchForm, r.customer, r.jobName, r.subBrand, r.dispLoc, locCode(r), r.poNum, fmtDate(r.poDate),
        Number(r.poQty) || 0, Number(r.invDisp) || 0, Number(r.manDisp) || 0, Number(r.fg) || 0, b, m, prodStatus(r.so), r.stage || ''];
    });
    exportAOA([header, ...body], `OAB_${sheet}_${new Date().toISOString().slice(0, 10)}.xlsx`, sheet);
  }

  // A real vector table, not a screenshot — crisp, selectable, auto-paginated onto
  // A3 landscape with every filtered row. (downloadOABCurrentPDF)
  function exportPDF() {
    try { downloadOabPdf(filtered, sheet, jssBySpec, prodStatus); }
    catch (e) { alert('PDF error: ' + (e && e.message ? e.message : e)); }
  }

  /**
   * Open the board in a print window: branded header, the stat tiles and the table
   * exactly as rendered, on landscape A4. (printOABTable)
   */
  function printTable() {
    const el = tableRef.current;
    const tableHTML = el ? el.querySelector('table').outerHTML : '';
    const statsHTML = document.querySelector('#app .stats') ? document.querySelector('#app .stats').outerHTML : '';
    const label = sheet === 'SF' ? 'Stay Fresh OAB' : 'Others OAB';
    const ts = new Date().toLocaleString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
    const win = window.open('', '_blank', 'width=1200,height=800');
    if (!win) { alert('Allow pop-ups to print the board.'); return; }
    win.document.write(`<!DOCTYPE html><html><head>
      <title>Bloomflex - ${label}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:9px;margin:10mm;color:#000}
        .header-block{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0e6fb8;padding-bottom:8px;margin-bottom:10px}
        .brand{font-size:18px;font-weight:900;letter-spacing:2px;color:#0e6fb8}
        .brand-sub{font-size:9px;font-weight:700;color:#333}
        .ts-block{text-align:right}
        .ts-label{font-size:8px;color:#888;text-transform:uppercase;letter-spacing:.05em}
        .ts-value{font-size:13px;font-weight:700;color:#0e6fb8;margin-top:2px}
        .report-title{font-size:13px;font-weight:700;margin-top:4px;color:#333}
        .stats{display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap}
        .stat{border:1px solid #ccc;border-radius:4px;padding:4px 10px;font-size:8px}
        .stat .sl{color:#888;font-size:7px;text-transform:uppercase;letter-spacing:.04em}
        .stat .sv{font-size:13px;font-weight:700}
        .stat-info{display:none}/* the ⓘ explains the card on screen; a printed report has no hover */
        table{width:100%;border-collapse:collapse;font-size:8px}
        th{background:#0e6fb8;color:#fff;border:1px solid #0e6fb8;padding:4px 5px;text-align:left;font-size:7.5px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}
        td{border:1px solid #ddd;padding:3px 5px;vertical-align:middle}
        tr:nth-child(even){background:#f5f5f2}
        .so-pill{background:#0e6fb8;color:#fff;border-radius:10px;padding:1px 6px;font-size:7px;font-weight:700;display:inline-block}
        .tag{display:inline-block;padding:1px 5px;border-radius:3px;font-size:7px;font-weight:700}
        .tg{background:#d7e8fb;color:#0e6fb8}.tr{background:#FDECEA;color:#C0392B}
        .ty{background:#FEF3E2;color:#7A4F00}.tb{background:#E8EFFC;color:#1A4FA0}.tgr{background:#eee;color:#555}
        .noprint{text-align:center;margin-bottom:14px;display:flex;gap:8px;justify-content:center}
        .btn{padding:8px 20px;border-radius:6px;font-size:13px;cursor:pointer;border:none;font-family:Arial,sans-serif}
        @media print{
          .noprint{display:none!important}
          @page{size:landscape;margin:8mm}
          th{background:#0e6fb8!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
          tr:nth-child(even){background:#f5f5f2!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        }
      </style>
    </head><body>
      <div class="noprint">
        <button class="btn" onclick="window.print()" style="background:#0e6fb8;color:#fff">&#128424; Print</button>
        <button class="btn" onclick="window.opener &amp;&amp; window.opener.__oabBoardPdf &amp;&amp; window.opener.__oabBoardPdf()" style="background:#1A4FA0;color:#fff">&#11015; Download PDF</button>
        <button class="btn" onclick="window.close()" style="background:#fff;border:1px solid #ccc">Close</button>
      </div>
      <div class="header-block">
        <div>
          <div class="brand">BLOOMFLEX</div>
          <div class="brand-sub">PRIVATE LIMITED</div>
          <div class="report-title">${label} — Production Balance Sheet</div>
        </div>
        <div class="ts-block">
          <div class="ts-label">Report Generated</div>
          <div class="ts-value">${ts}</div>
        </div>
      </div>
      ${statsHTML}
      ${tableHTML}
    </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 600);
  }

  // The print window's "Download PDF" button calls back into this tab, so it emits the
  // same vector board PDF rather than needing its own copy of the PDF libraries.
  useEffect(() => {
    window.__oabBoardPdf = exportPDF;
    return () => { delete window.__oabBoardPdf; };
  });

  return (
    <div id="app">
      <div className="pg-ttl">OAB — Order &amp; Production Balance</div>
      <div className="pg-sub">Live view of all open orders. Printable for production floor.</div>
      {rowsError && <div className="al al-r" style={{ margin: '8px 0' }}>Failed to load orders: {rowsError}</div>}

      <div className="fbar">
        <select value={sheet} aria-label="Sheet" onChange={(e) => setSheet(e.target.value)}>
          <option value="SF">Stay Fresh OAB</option><option value="OT">Others OAB</option>
        </select>
        <input placeholder="Search..." aria-label="Search orders" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
        <select value={cf} aria-label="Filter by customer" onChange={(e) => setCf(e.target.value)}><option value="">All customers</option>{customers.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select value={spf} aria-label="Filter by spec" onChange={(e) => setSpf(e.target.value)}><option value="">All specs</option>{specs.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={stf} aria-label="Filter by stage" onChange={(e) => setStf(e.target.value)}><option value="">All stages</option>{stages.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <button className="btn btn-s" style={{ height: 30, fontSize: 12 }} aria-label="Refresh" onClick={refetchRows}>↻</button>
        <button className="btn btn-s" style={{ height: 30, fontSize: 12 }} title={order.title} onClick={order.toggle}>{order.label}</button>
        <button className="btn btn-s" style={{ height: 30, fontSize: 12 }} onClick={printTable}>🖨 Print</button>
        <button className="btn btn-s" style={{ height: 30, fontSize: 12 }} onClick={exportPDF}>⬇ PDF</button>
        <button className="btn btn-s" style={{ height: 30, fontSize: 12 }} onClick={exportExcel}>⬇ Excel</button>
        <button
          className="btn btn-s" style={{ height: 30, fontSize: 12, background: '#F3F4F6', color: '#374151' }}
          title="View closed SOs and the invoices used to close them"
          onClick={() => setShowClosed((v) => !v)}
        >
          {showClosed ? '← Open SOs' : <>🗄 Closed SOs<span style={{ color: '#6B7280', fontWeight: 600 }}>{closedRows.length ? ' (' + closedRows.length + ')' : ''}</span></>}
        </button>
        <span style={{ fontSize: 11, color: 'var(--i3)', marginLeft: 'auto' }}>{filtered.length} rows</span>
      </div>

      {showClosed ? (
        <ClosedTable rows={closedRows} onReopen={reopen} jssBySpec={jssBySpec} />
      ) : (
        <>
          <div className="stats">
            <Stat label="SOs" value={filtered.length} info={STAT_INFO.sos} />
            <Stat label="PO Qty" value={dash(tPO)} info={STAT_INFO.poQty} />
            <Stat label="Dispatched" value={dash(tD)} cls="grn" info={STAT_INFO.dispatched} />
            <Stat label="FG" value={dash(tFG)} info={STAT_INFO.fg} />
            <Stat label="Bal to Produce" value={dash(tB)} cls="red" info={STAT_INFO.balProduce} />
            <Stat label="Bal Mtrs" value={<>{dash(tM)}&nbsp;m</>} cls="red" info={STAT_INFO.balMtrs} />
            <Stat
              label="Bal Kg's" value={<>{dash(Math.round(kg.total))}&nbsp;kg</>} cls="red" info={STAT_INFO.balKg}
              note={kg.noWeight ? `${kg.noWeight} spec${kg.noWeight === 1 ? ' has' : 's have'} no weight` : ''}
            />
          </div>

          <div className="al al-g" style={{ fontSize: 11, padding: '6px 13px', marginBottom: 6 }}>
            📏 Metres shown include <strong>&nbsp;5% wastage allowance</strong>
          </div>

          <div className="tw sy" ref={tableRef}>
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 72 }}>SO#</th><th style={{ minWidth: 58 }}>Spec</th><th style={{ minWidth: 58 }}>Disp</th>
                  <th style={{ minWidth: 110 }}>Customer</th><th style={{ minWidth: 160 }}>Job Name</th>
                  <th style={{ minWidth: 100 }}>Sub Brand</th>
                  <th style={{ minWidth: 100 }}>Location</th><th style={{ minWidth: 80 }}>Loc Code</th>
                  <th style={{ minWidth: 70 }}>PO#</th><th style={{ minWidth: 78 }}>PO Date</th>
                  <th style={{ minWidth: 50, textAlign: 'right' }} title="Days since PO date">Age</th>
                  <th style={{ minWidth: 55, textAlign: 'right' }}>Qty</th><th style={{ minWidth: 50, textAlign: 'right' }}>Inv</th>
                  <th style={{ minWidth: 50, textAlign: 'right' }}>Man</th><th style={{ minWidth: 40, textAlign: 'right' }}>FG</th>
                  <th style={{ minWidth: 50, textAlign: 'right' }}>Bal</th><th style={{ minWidth: 75, textAlign: 'right' }}>Mtrs</th>
                  <th style={{ minWidth: 90, textAlign: 'center' }}>Status</th>
                  <th style={{ minWidth: 110, textAlign: 'center' }}>Stage</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={19} style={{ textAlign: 'center', padding: 28, color: 'var(--i3)' }}>{rowsLoading ? 'Loading…' : 'No data'}</td></tr>
                ) : filtered.map((r, i) => {
                  const b = balance(r);
                  const mW = calcMetres(r, b, jssBySpec[r.spec]).withWastage;
                  const st = prodStatus(r.so);
                  const nr = st !== 'Ready';
                  const age = soAgeDays(r.poDate);
                  return (
                    <tr key={r.so} className={'zebra' + (nr ? ' nr' : '')}>
                      <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
                      <td><span className="tag tb" style={{ fontSize: 10 }}>{r.spec || '-'}</span></td>
                      <td><DispFormBadge df={r.dispatchForm} /></td>
                      <td style={{ fontSize: 11 }}>{r.customer || '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.jobName || '-'}</td>
                      <td style={{ fontSize: 11, color: 'var(--amber)' }}>{r.subBrand || '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.dispLoc || '-'}</td>
                      <td style={{ fontSize: 11 }}>{locCode(r) || '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.poNum || '-'}</td>
                      <td style={{ fontSize: 11 }}>{fmtDate(r.poDate)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {age == null
                          ? <span style={{ color: 'var(--i3)', fontSize: 10 }}>-</span>
                          : (
                            <span
                              style={{ fontWeight: 600, color: age > 90 ? 'var(--red)' : age > 45 ? '#B8860B' : 'var(--i2)' }}
                              title={'Days since PO date ' + fmtDate(r.poDate)}
                            >{age}&nbsp;d</span>
                          )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{dash(r.poQty)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--g)' }}>{dash(r.invDisp)}</td>
                      <td style={{ textAlign: 'right' }}>{dash(r.manDisp)}</td>
                      <td style={{ textAlign: 'right' }}>{dash(r.fg)}</td>
                      <td style={{ textAlign: 'right' }}><BalanceBadge value={b}>{dash(b)}</BalanceBadge></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', minWidth: 90 }}>{mW > 0 ? <><strong>{dash(mW)}</strong>&nbsp;m</> : '-'}</td>
                      <td><ProdBadge status={st} /></td>
                      <td style={{ textAlign: 'center' }}>{r.stage ? <span className="tag tb" style={{ fontSize: 9, whiteSpace: 'nowrap' }}>{r.stage}</span> : <span style={{ color: 'var(--i3)', fontSize: 10 }}>-</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, cls, note, info }) {
  return (
    <div className="stat">
      <div className="sl">
        {label}
        {info ? (
          // Focusable so the explanation is reachable by keyboard, not hover only.
          <i className="stat-info" tabIndex={0} role="note" aria-label={`${label}: ${info}`}>
            i<span aria-hidden="true">{info}</span>
          </i>
        ) : null}
      </div>
      <div className={'sv' + (cls ? ' ' + cls : '')}>{value}</div>
      {note ? <div style={{ fontSize: 10, color: 'var(--warn)', marginTop: 2 }} title="Add height, width and GSM on the JSS spec so these count toward the weight">⚠ {note}</div> : null}
    </div>
  );
}

function ClosedTable({ rows, onReopen, jssBySpec }) {
  if (!rows.length) return <div className="card"><div className="pg-sub" style={{ margin: 0 }}>No closed SOs on this sheet.</div></div>;
  return (
    <div className="tw sy">
      <table>
        <thead>
          <tr><th>SO#</th><th>Spec</th><th>Customer</th><th>Job Name</th><th style={{ textAlign: 'right' }}>PO Qty</th>
            <th style={{ textAlign: 'right' }}>Dispatched</th><th>Closed On</th><th>Type</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.so}>
              <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
              <td><span className="tag tb" style={{ fontSize: 10 }}>{r.spec || '-'}</span></td>
              <td style={{ fontSize: 11 }}>{r.customer || '-'}</td>
              <td style={{ fontSize: 11 }}>{r.jobName || '-'}</td>
              <td style={{ textAlign: 'right' }}>{dash(r.poQty)}</td>
              <td style={{ textAlign: 'right' }}>{dash((Number(r.invDisp) || 0) + (Number(r.manDisp) || 0))}</td>
              <td style={{ fontSize: 11 }}>{fmtDate(r.closedDate)}</td>
              <td>{r.shortClosed ? <span className="tag ty" style={{ fontSize: 9 }}>Short-close</span> : <span className="tag tg" style={{ fontSize: 9 }}>Complete</span>}</td>
              <td><button className="btn btn-s" style={{ height: 24, fontSize: 10, padding: '0 7px' }} onClick={() => onReopen(r.so)}>Reopen</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
