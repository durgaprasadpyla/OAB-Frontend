import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { balance, num } from '../lib/calc.js';
import { dash, today } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import CsaPanel from '../components/CsaPanel.jsx';
import RawMaterialPanel from '../components/RawMaterialPanel.jsx';

const clone = (o) => JSON.parse(JSON.stringify(o));

// Find the JSS spec record for an OAB row — by spec code (trimmed), else by
// customer + jobName. (native port of pmFindJSS, legacy index.html ~4759)
function pmFindJSS(jss, r) {
  if (!r) return null;
  if (r.spec) {
    const bySpec = jss.find((j) => String(j.spec || '').trim() === String(r.spec || '').trim());
    if (bySpec) return bySpec;
  }
  return jss.find((j) => j.customer === r.customer && j.jobName === r.jobName) || null;
}

// Editable date cell — no CSS rule covers td input[type=date], so size it inline
// to match the ~26px number/text inputs the stylesheet already styles.
const dateStyle = { width: '100%', height: 26, border: '1px solid var(--bd)', borderRadius: 5, padding: '0 5px', fontSize: 11 };
const rt = { textAlign: 'right' };

/**
 * Production — Printing Progress (native port of pmRows / renderPMTable /
 * pmSaveAll, legacy index.html ~4765). One row per OPEN OAB row across both
 * sheets, matched to its JSS spec; only Print Date / Printed Kg / Printed Mt
 * are editable, everything else is OAB/JSS-derived and read-only.
 */
export default function PM() {
  const { mods, save } = useData();
  const [q, setQ] = useState('');
  const [specFil, setSpecFil] = useState('');
  const [tab, setTab] = useState('print');
  const [edits, setEdits] = useState({});   // { [so]: {printDate?, printedKg?} }
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const jss = mods.jss || [];
  const pmData = mods.pmData || {};

  // Build the combined PM row set from both OAB sheets. (legacy pmRows, ~4765)
  const rows = useMemo(() => {
    const ps = mods.prodStatus || {};
    const out = [];
    ['SF', 'OT'].forEach((sheet) => {
      const arr = (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || [];
      arr.filter((r) => !r.closed).forEach((r) => {
        const j = pmFindJSS(jss, r);
        const pm = pmData[r.so] || {};
        const disp = num(r.invDisp) + num(r.manDisp);
        const bal = balance(r);
        // total order weight (Kg) = PO qty (pieces) × JSS pouch weight (g) ÷ 1000
        const pw = j ? num(j.pouchWeight) : 0;
        const totalKg = pw > 0 ? (num(r.poQty) * pw / 1000) : 0;
        // total job metres = PO qty × JSS pouch width (mm) ÷ 1000
        const widthMm = j ? num(j.width) : 0;
        const totalMt = widthMm > 0 ? (num(r.poQty) * widthMm / 1000) : 0;
        // Printed metres are DERIVED from printed Kg via the order ratio
        // (Total Mt ÷ Total Kg) and never stored. (legacy renderPMTable ~7466)
        const mtPerKg = totalKg > 0 ? (totalMt / totalKg) : 0;
        const printedKg = num(pm.printedKg);
        const printedMt = printedKg * mtPerKg;
        out.push({
          // SKU follows the current spec (j) — the row's stored jobName is only the copy
          // captured at SO creation, so a repointed spec self-corrects here too.
          sheet, so: r.so, spec: r.spec || '', customer: r.customer || '', sku: (j && j.jobName) || r.jobName || '',
          dispLoc: r.dispLoc || '', poQty: num(r.poQty), disp, bal,
          prodStatus: ps[r.so] || 'Ready', stage: r.stage || '',
          substrate: j ? (j.material || '') : '', filmWidth: j ? (j.filmWidth || '') : '',
          thickness: j ? (j.mic || '') : '', gsm: j ? (j.gsm || '') : '',
          pouchW: j ? (j.width || '') : '', pouchH: j ? (j.height || '') : '',
          printDate: pm.printDate || '', printedKg, printedMt, totalKg, totalMt, mtPerKg,
          // printing balance = total order − printed, for both Kg and metres
          balKg: Math.max(0, totalKg - printedKg), balMt: Math.max(0, totalMt - printedMt),
        });
      });
    });
    return out;
  }, [mods.oab, jss, pmData, mods.prodStatus]);

  // Distinct specs across all open rows, for the spec filter. (legacy pm-spec-fil)
  const specOptions = useMemo(() => [...new Set(rows.map((r) => r.spec).filter(Boolean))].sort(), [rows]);

  // Spec filter + text search over SO / customer / spec / SKU / location.
  const filtered = useMemo(() => {
    let list = specFil ? rows.filter((r) => String(r.spec || '') === specFil) : rows;
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((r) => [r.so, r.customer, r.spec, r.sku, r.dispLoc].some((v) => String(v || '').toLowerCase().includes(s)));
    return list;
  }, [rows, q, specFil]);

  const dirty = Object.keys(edits).length > 0;
  const setEdit = (so, patch) => setEdits((e) => ({ ...e, [so]: { ...e[so], ...patch } }));
  const flash = (text, t = 'g') => { setMsg({ text, t }); setTimeout(() => setMsg(null), 4000); };

  // Save All — clone pmData, merge each row's edits over its saved values, and
  // write {printDate, printedKg, printedMt} for any row that has a value set;
  // drop rows left entirely empty. (legacy pmSaveAll, ~4849)
  async function saveAll() {
    const next = clone(pmData);
    rows.forEach((r) => {
      const e = edits[r.so];
      const printDate = e && ('printDate' in e) ? e.printDate : (r.printDate || '');
      const printedKg = e && ('printedKg' in e) ? e.printedKg : r.printedKg;
      // printedMt is derived from printedKg at render time — never stored.
      const entry = { printDate: printDate || '', printedKg: num(printedKg) };
      if (entry.printDate || entry.printedKg) next[r.so] = entry;
      else delete next[r.so];
    });
    setBusy(true);
    try { await save('pmData', next); setEdits({}); flash('✅ Printing progress saved'); }
    catch (err) { flash('Save failed: ' + err.message, 'r'); }
    finally { setBusy(false); }
  }

  // Export Excel — header + all rows (unfiltered), from saved values.
  function exportExcel() {
    if (!rows.length) { flash('No data to export.', 'y'); return; }
    const header = ['SO', 'Sheet', 'Spec', 'Customer', 'SKU', 'Disp Loc', 'PO Qty', 'Dispatched', 'Balance',
      'Prod Status', 'Stage', 'Substrate', 'Film Width', 'Thickness', 'GSM', 'Pouch Width', 'Pouch Height',
      'Total Kg', 'Total Mt', 'Print Date', 'Printed Kg', 'Printed Mt', 'Bal Kg', 'Bal Mt'];
    const body = rows.map((r) => [r.so, r.sheet, r.spec, r.customer, r.sku, r.dispLoc, r.poQty, r.disp, r.bal,
      r.prodStatus, r.stage, r.substrate, r.filmWidth, r.thickness, r.gsm, r.pouchW, r.pouchH,
      Math.round(r.totalKg), Math.round(r.totalMt), r.printDate, r.printedKg, Math.round(r.printedMt),
      Math.round(r.balKg), Math.round(r.balMt)]);
    exportAOA([header, ...body], `Bloomflex_Printing_Progress_${today()}.xlsx`, 'Printing Progress');
  }

  if (tab === 'csa') {
    return (
      <div id="app">
        <div className="pg-ttl">Production</div>
        <PmTabs tab={tab} setTab={setTab} />
        <CsaPanel role="pm" />
      </div>
    );
  }

  if (tab === 'material') {
    return (
      <div id="app">
        <div className="pg-ttl">Production</div>
        <PmTabs tab={tab} setTab={setTab} />
        <RawMaterialPanel />
      </div>
    );
  }

  return (
    <div id="app">
      <div className="pg-ttl">Production — Printing Progress</div>
      <PmTabs tab={tab} setTab={setTab} />
      <div className="pg-sub">Printed quantity vs. total order weight/metres for every open sale order, across both sheets.</div>

      <div className="fbar">
        <select value={specFil} onChange={(e) => setSpecFil(e.target.value)} aria-label="Filter by spec">
          <option value="">All Specs</option>
          {specOptions.map((sp) => <option key={sp} value={sp}>{sp}</option>)}
        </select>
        <input placeholder="Search SO / customer / spec / SKU / location…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
        <span style={{ color: 'var(--i3)', fontSize: 12 }}>{filtered.length} open SO{filtered.length === 1 ? '' : 's'}</span>
        {dirty && <span style={{ color: 'var(--red)', fontSize: 12, fontWeight: 600 }}>⚠ Unsaved changes</span>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={exportExcel}>⬇ Export Excel</button>
        <button className="btn btn-g" onClick={saveAll} disabled={busy || !dirty}>{busy ? 'Saving…' : '💾 Save All'}</button>
      </div>

      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <div className="tw sy">
        <table>
          <thead>
            <tr>
              <th>SO</th><th>Sheet</th><th>Spec</th><th>Customer</th><th>SKU</th><th>Disp Loc</th>
              <th style={rt}>PO Qty</th><th style={rt}>Dispatched</th><th style={rt}>Balance</th><th style={{ textAlign: 'center' }}>Status / Stage</th>
              <th>Substrate</th><th style={rt}>Film W</th><th style={rt}>Thick (mic)</th><th style={rt}>GSM</th>
              <th style={rt}>Pouch W</th><th style={rt}>Pouch H</th>
              <th style={rt}>Total Kg</th><th style={rt}>Total Mt</th>
              <th style={{ width: 130 }}>Print Date</th><th style={{ width: 84 }}>Printed Kg</th><th style={rt}>Printed Mt</th>
              <th style={rt}>Bal Kg</th><th style={rt}>Bal Mt</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={23} style={{ textAlign: 'center', padding: 28, color: 'var(--i3)' }}>No open SOs</td></tr>
            ) : filtered.map((r) => {
              const e = edits[r.so] || {};
              // Not-Ready rows (any prod status other than "Ready") are flagged red.
              const nr = r.prodStatus !== 'Ready';
              // Live figures: Printed Mt / balances follow the (edited) Printed Kg.
              const effKg = num('printedKg' in e ? e.printedKg : r.printedKg);
              const printedMt = effKg * r.mtPerKg;
              const balKg = Math.max(0, r.totalKg - effKg);
              const balMt = Math.max(0, r.totalMt - printedMt);
              return (
                <tr key={r.sheet + '|' + r.so} style={nr ? { background: '#FEF0F0' } : undefined}>
                  <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
                  <td style={{ color: 'var(--i3)', fontSize: 11 }}>{r.sheet}</td>
                  <td style={{ color: 'var(--i3)' }}>{r.spec || '-'}</td>
                  <td style={{ fontWeight: 600 }}>{r.customer || '-'}</td>
                  <td style={{ fontSize: 11, maxWidth: 200 }}>{r.sku || '-'}</td>
                  <td style={{ fontSize: 11 }}>{r.dispLoc || '-'}</td>
                  <td style={{ ...rt, fontWeight: 600 }}>{dash(r.poQty)}</td>
                  <td style={{ ...rt, color: '#1B6B3A' }}>{dash(r.disp)}</td>
                  <td style={{ ...rt, fontWeight: 700, color: r.bal > 0 ? '#C0392B' : '#1B6B3A' }}>{dash(r.bal)}</td>
                  <td style={{ textAlign: 'center', fontSize: 11 }}>
                    {nr ? <span style={{ color: '#C0392B', fontWeight: 700 }}>{r.prodStatus}</span> : (r.stage || '-')}
                  </td>
                  <td style={{ color: 'var(--i2)', fontSize: 11 }}>{r.substrate || '-'}</td>
                  <td style={rt}>{r.filmWidth || '-'}</td>
                  <td style={rt}>{r.thickness || '-'}</td>
                  <td style={rt}>{r.gsm || '-'}</td>
                  <td style={rt}>{r.pouchW || '-'}</td>
                  <td style={rt}>{r.pouchH || '-'}</td>
                  <td style={{ ...rt, fontWeight: 600 }} title={r.totalKg ? '' : 'No pouch weight in JSS'}>{dash(r.totalKg)}</td>
                  <td style={{ ...rt, fontWeight: 600 }} title={r.totalMt ? '' : 'No pouch width in JSS'}>{dash(r.totalMt)}</td>
                  <td>
                    <input type="date" value={e.printDate ?? r.printDate} style={dateStyle}
                      onChange={(ev) => setEdit(r.so, { printDate: ev.target.value })} />
                  </td>
                  <td>
                    <input type="number" min="0" placeholder="Kg" value={e.printedKg ?? (r.printedKg || '')} style={rt}
                      onChange={(ev) => setEdit(r.so, { printedKg: ev.target.value })} />
                  </td>
                  <td style={{ ...rt, fontWeight: 600, color: 'var(--i2)' }} title="Auto = Printed Kg × (Total Mt ÷ Total Kg)">{dash(printedMt)}</td>
                  <td style={{ ...rt, fontWeight: 700, color: '#a3510a' }}>{dash(balKg)}</td>
                  <td style={{ ...rt, fontWeight: 700, color: '#a3510a' }}>{dash(balMt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PM_TABS = [
  { k: 'print', label: '🖨 Production Tracker' },
  { k: 'csa', label: '🔬 CSA — plant comments' },
  { k: 'material', label: '🧱 Raw Material' },
];

function PmTabs({ tab, setTab }) {
  return (
    <div className="step-bar" style={{ flexWrap: 'wrap' }}>
      {PM_TABS.map((t) => (
        <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
      ))}
    </div>
  );
}
