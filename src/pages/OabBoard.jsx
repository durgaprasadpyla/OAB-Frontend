import { useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../data.jsx';
import { ordersApi } from '../api.js';
import { balance, calcMetres } from '../lib/calc.js';
import { dash, fmtDate } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { elementToPDF } from '../lib/pdf.js';
import { DispFormBadge, ProdBadge, BalanceBadge } from '../components/badges.jsx';

/** Order & Production Balance board (native port of renderOAB, legacy 1839). */
export default function OabBoard() {
  const { mods, reloadModule } = useData();
  const [sp, setSp] = useSearchParams();
  const sheet = sp.get('sheet') === 'OT' ? 'OT' : 'SF';

  const [q, setQ] = useState('');
  const [cf, setCf] = useState('');
  const [stf, setStf] = useState('');
  const [spf, setSpf] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const tableRef = useRef(null);

  // JSS is authoritative for customer/sub-brand names (syncOABFromJSS, 1826).
  const jssBySpec = useMemo(() => {
    const m = {};
    (mods.jss || []).forEach((j) => { if (j && j.spec) m[j.spec] = j; });
    return m;
  }, [mods.jss]);

  const allRows = (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || [];
  const openRows = useMemo(() => allRows.filter((r) => !r.closed).map((r) => {
    const j = jssBySpec[r.spec];
    return j ? { ...r, customer: j.customer || r.customer, subBrand: j.subBrand || r.subBrand } : r;
  }), [allRows, jssBySpec]);
  const closedRows = useMemo(() => allRows.filter((r) => r.closed), [allRows]);

  const customers = useMemo(() => [...new Set(openRows.map((r) => r.customer))].filter(Boolean).sort(), [openRows]);
  const stages = useMemo(() => [...new Set(openRows.map((r) => r.stage))].filter(Boolean).sort(), [openRows]);
  const specs = useMemo(() => [...new Set(openRows.map((r) => r.spec))].filter(Boolean).sort(), [openRows]);

  const filtered = useMemo(() => openRows.filter((r) => {
    if (cf && r.customer !== cf) return false;
    if (stf && r.stage !== stf) return false;
    if (spf && r.spec !== spf) return false;
    if (q) {
      const s = q.toLowerCase();
      if (![r.so, r.customer, r.jobName, r.spec, r.poNum, r.dispLoc].some((v) => String(v || '').toLowerCase().includes(s))) return false;
    }
    return true;
  }), [openRows, q, cf, stf, spf]);

  const tPO = filtered.reduce((s, r) => s + (Number(r.poQty) || 0), 0);
  const tD = filtered.reduce((s, r) => s + (Number(r.invDisp) || 0) + (Number(r.manDisp) || 0), 0);
  const tFG = filtered.reduce((s, r) => s + (Number(r.fg) || 0), 0);
  const tB = filtered.reduce((s, r) => s + balance(r), 0);

  const prodStatus = (so) => (mods.prodStatus && mods.prodStatus[so]) || 'Ready';
  const setSheet = (k) => { setSp({ sheet: k }); setShowClosed(false); };

  async function reopen(so) {
    try { await ordersApi.reopen(so); await reloadModule('oab'); }
    catch (e) { alert('Reopen failed: ' + (e.message || e)); }
  }

  function exportExcel() {
    const header = ['SO', 'Spec', 'Dispatch', 'Customer', 'Job', 'Sub Brand', 'Disp Loc', 'PO#', 'PO Date',
      'PO Qty', 'Inv', 'Man', 'FG', 'Balance', 'Metres+5%', 'Prod Status', 'Stage'];
    const body = filtered.map((r) => {
      const b = balance(r);
      const m = calcMetres(r, b, jssBySpec[r.spec]).withWastage;
      return [r.so, r.spec, r.dispatchForm, r.customer, r.jobName, r.subBrand, r.dispLoc, r.poNum, fmtDate(r.poDate),
        Number(r.poQty) || 0, Number(r.invDisp) || 0, Number(r.manDisp) || 0, Number(r.fg) || 0, b, m, prodStatus(r.so), r.stage || ''];
    });
    exportAOA([header, ...body], `OAB_${sheet}_${new Date().toISOString().slice(0, 10)}.xlsx`, sheet);
  }

  async function exportPDF() {
    try { await elementToPDF(tableRef.current, `OAB_${sheet}_${new Date().toISOString().slice(0, 10)}.pdf`, { orientation: 'landscape' }); }
    catch (e) { alert('PDF export failed: ' + e.message); }
  }

  return (
    <div id="app">
      <div className="pg-ttl">Order &amp; Production Balance</div>
      <div className="pg-sub">Open sales orders — {sheet === 'SF' ? 'Stay Fresh' : 'Others'} sheet, live from the database.</div>

      <div className="fbar">
        <button className={'btn btn-s' + (sheet === 'SF' ? ' on' : '')} onClick={() => setSheet('SF')}>Stay Fresh</button>
        <button className={'btn btn-s' + (sheet === 'OT' ? ' on' : '')} onClick={() => setSheet('OT')}>Others</button>
        <span style={{ width: 8 }} />
        <input placeholder="Search SO / customer / job / spec / PO…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <select value={cf} onChange={(e) => setCf(e.target.value)}><option value="">All customers</option>{customers.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select value={stf} onChange={(e) => setStf(e.target.value)}><option value="">All stages</option>{stages.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={spf} onChange={(e) => setSpf(e.target.value)}><option value="">All specs</option>{specs.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? '← Open SOs' : `Closed SOs${closedRows.length ? ' (' + closedRows.length + ')' : ''}`}
        </button>
        <button className="btn btn-s" onClick={exportExcel}>⬇ Excel</button>
        <button className="btn btn-s" onClick={exportPDF}>⬇ PDF</button>
      </div>

      {showClosed ? (
        <ClosedTable rows={closedRows} onReopen={reopen} jssBySpec={jssBySpec} />
      ) : (
        <>
          <div className="stats">
            <Stat label="SOs" value={filtered.length} />
            <Stat label="PO Qty" value={dash(tPO)} />
            <Stat label="Dispatched" value={dash(tD)} cls="grn" />
            <Stat label="FG" value={dash(tFG)} />
            <Stat label="Bal to Produce" value={dash(tB)} cls="red" />
          </div>

          <div className="tw sy" ref={tableRef}>
            <table>
              <thead>
                <tr>
                  <th>SO#</th><th>Spec</th><th>Form</th><th>Customer</th><th>Job Name</th><th>Sub Brand</th>
                  <th>Disp Loc</th><th>PO#</th><th>PO Date</th><th style={{ textAlign: 'right' }}>PO Qty</th>
                  <th style={{ textAlign: 'right' }}>Inv</th><th style={{ textAlign: 'right' }}>Man</th>
                  <th style={{ textAlign: 'right' }}>FG</th><th style={{ textAlign: 'right' }}>Balance</th>
                  <th style={{ textAlign: 'right' }}>Metres+5%</th><th>Prod Status</th><th style={{ textAlign: 'center' }}>Stage</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={17} style={{ textAlign: 'center', padding: 28, color: 'var(--i3)' }}>No data</td></tr>
                ) : filtered.map((r, i) => {
                  const b = balance(r);
                  const mW = calcMetres(r, b, jssBySpec[r.spec]).withWastage;
                  const st = prodStatus(r.so);
                  const nr = st !== 'Ready';
                  return (
                    <tr key={r.so} className={'zebra' + (nr ? ' nr' : '')}>
                      <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
                      <td><span className="tag tb" style={{ fontSize: 10 }}>{r.spec || '-'}</span></td>
                      <td><DispFormBadge df={r.dispatchForm} /></td>
                      <td style={{ fontSize: 11 }}>{r.customer || '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.jobName || '-'}</td>
                      <td style={{ fontSize: 11, color: 'var(--amber)' }}>{r.subBrand || '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.dispLoc || '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.poNum || '-'}</td>
                      <td style={{ fontSize: 11 }}>{fmtDate(r.poDate)}</td>
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

function Stat({ label, value, cls }) {
  return (
    <div className="stat">
      <div className="sl">{label}</div>
      <div className={'sv' + (cls ? ' ' + cls : '')}>{value}</div>
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
