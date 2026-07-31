import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { balance, num } from '../lib/calc.js';
import { dash, today } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';

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
  const [edits, setEdits] = useState({});   // { [so]: {printDate?, printedKg?, printedMt?} }
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const jss = mods.jss || [];
  const pmData = mods.pmData || {};

  // Build the combined PM row set from both OAB sheets. (legacy pmRows, ~4765)
  const rows = useMemo(() => {
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
        const printedKg = num(pm.printedKg);
        const printedMt = num(pm.printedMt);
        out.push({
          sheet, so: r.so, spec: r.spec || '', customer: r.customer || '', sku: r.jobName || '',
          dispLoc: r.dispLoc || '', poQty: num(r.poQty), disp, bal,
          substrate: j ? (j.material || '') : '', filmWidth: j ? (j.filmWidth || '') : '',
          thickness: j ? (j.mic || '') : '', gsm: j ? (j.gsm || '') : '',
          printDate: pm.printDate || '', printedKg, printedMt, totalKg, totalMt,
          // printing balance = total order − printed, for both Kg and metres
          balKg: Math.max(0, totalKg - printedKg), balMt: Math.max(0, totalMt - printedMt),
        });
      });
    });
    return out;
  }, [mods.oab, jss, pmData]);

  // Optional text search over SO / customer / spec.
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.so, r.customer, r.spec].some((v) => String(v || '').toLowerCase().includes(s)));
  }, [rows, q]);

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
      const printedMt = e && ('printedMt' in e) ? e.printedMt : r.printedMt;
      const entry = { printDate: printDate || '', printedKg: num(printedKg), printedMt: num(printedMt) };
      if (entry.printDate || entry.printedKg || entry.printedMt) next[r.so] = entry;
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
    const header = ['SO', 'Sheet', 'Spec', 'Customer', 'SKU', 'Disp Loc', 'PO Qty', 'Substrate',
      'Film Width', 'Thickness', 'GSM', 'Total Kg', 'Total Mt', 'Print Date', 'Printed Kg', 'Printed Mt', 'Bal Kg', 'Bal Mt'];
    const body = rows.map((r) => [r.so, r.sheet, r.spec, r.customer, r.sku, r.dispLoc, r.poQty, r.substrate,
      r.filmWidth, r.thickness, r.gsm, Math.round(r.totalKg), Math.round(r.totalMt), r.printDate,
      r.printedKg, r.printedMt, Math.round(r.balKg), Math.round(r.balMt)]);
    exportAOA([header, ...body], `Bloomflex_Printing_Progress_${today()}.xlsx`, 'Printing Progress');
  }

  return (
    <div id="app">
      <div className="pg-ttl">Production — Printing Progress</div>
      <div className="pg-sub">Printed quantity vs. total order weight/metres for every open sale order, across both sheets.</div>

      <div className="fbar">
        <input placeholder="Search SO / customer / spec…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
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
              <th style={rt}>PO Qty</th><th>Substrate</th><th style={rt}>Film Width</th><th style={rt}>Thickness</th>
              <th style={rt}>GSM</th><th style={rt}>Total Kg</th><th style={rt}>Total Mt</th>
              <th style={{ width: 130 }}>Print Date</th><th style={{ width: 84 }}>Printed Kg</th><th style={{ width: 84 }}>Printed Mt</th>
              <th style={rt}>Bal Kg</th><th style={rt}>Bal Mt</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={18} style={{ textAlign: 'center', padding: 28, color: 'var(--i3)' }}>No open SOs</td></tr>
            ) : filtered.map((r) => {
              const e = edits[r.so] || {};
              return (
                <tr key={r.sheet + '|' + r.so}>
                  <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
                  <td style={{ color: 'var(--i3)', fontSize: 11 }}>{r.sheet}</td>
                  <td style={{ color: 'var(--i3)' }}>{r.spec || '-'}</td>
                  <td style={{ fontWeight: 600 }}>{r.customer || '-'}</td>
                  <td style={{ fontSize: 11, maxWidth: 200 }}>{r.sku || '-'}</td>
                  <td style={{ fontSize: 11 }}>{r.dispLoc || '-'}</td>
                  <td style={{ ...rt, fontWeight: 600 }}>{dash(r.poQty)}</td>
                  <td style={{ color: 'var(--i2)', fontSize: 11 }}>{r.substrate || '-'}</td>
                  <td style={rt}>{r.filmWidth || '-'}</td>
                  <td style={rt}>{r.thickness || '-'}</td>
                  <td style={rt}>{r.gsm || '-'}</td>
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
                  <td>
                    <input type="number" min="0" placeholder="Mt" value={e.printedMt ?? (r.printedMt || '')} style={rt}
                      onChange={(ev) => setEdit(r.so, { printedMt: ev.target.value })} />
                  </td>
                  <td style={{ ...rt, fontWeight: 700, color: '#a3510a' }}>{dash(r.balKg)}</td>
                  <td style={{ ...rt, fontWeight: 700, color: '#a3510a' }}>{dash(r.balMt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
