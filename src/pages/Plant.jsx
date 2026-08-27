import { useMemo, useState, useRef } from 'react';
import { useData } from '../data.jsx';
import { ordersApi } from '../api.js';
import { balance } from '../lib/calc.js';
import { dash, today } from '../lib/format.js';
import { STAGES, PROD_STATUSES } from '../lib/constants.js';
import { exportAOA } from '../lib/xlsx.js';
import { useSoOrder, soOrder } from '../lib/soOrder.js';
import PlanDownloads from '../components/PlanDownloads.jsx';

/**
 * Production Floor — native port of the legacy plant view (showPlantView /
 * renderPlantOAB / savePlantStatuses, index.html ~5151-5253).
 *
 * Shows every OPEN OAB row across both sheets (SF then OT). Each row gets an
 * editable Prod Status (Ready / NR-*) and Stage. The Stage select is enabled
 * only while the row is "Ready" (legacy togglePlantStage); an NR status clears
 * any stage on save (legacy savePlantStatuses). Prod status is stored in the
 * `prodStatus` module keyed by SO; stage lives on the OAB row itself.
 */
export default function Plant() {
  const { mods, save, reloadModule } = useData();

  // Production shows ONE sheet at a time, picked in the header bar. (plant-oab-sh)
  const [sheet, setSheet] = useState('SF');
  const order = useSoOrder();
  // Local edits, keyed by `${sheet}|${so}` -> { ps, st }. Cleared on save.
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const tableRef = useRef(null);

  // Open rows of the chosen sheet, in the shared newest/oldest order.
  const visible = useMemo(() => {
    const arr = (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || [];
    return soOrder(arr.filter((r) => !r.closed), order.newestFirst).map((r) => ({ r, sheet }));
  }, [mods.oab, sheet, order.newestFirst]);

  // Effective (edited-or-stored) prod status + stage for one row.
  function eff(sheet, r) {
    const e = edits[sheet + '|' + r.so];
    const curPs = (mods.prodStatus && mods.prodStatus[r.so]) || 'Ready';
    const ps = e && e.ps != null ? e.ps : curPs;
    const isReady = ps === 'Ready';
    const st = isReady ? (e && e.st != null ? e.st : (r.stage || '')) : '';
    return { ps, isReady, st };
  }

  function onPs(sheet, r, value) {
    setEdits((prev) => {
      const rk = sheet + '|' + r.so;
      const cur = prev[rk] || {};
      // Ready keeps/restores the stage; NR clears it (matches legacy).
      const st = value === 'Ready' ? (cur.st != null ? cur.st : (r.stage || '')) : '';
      return { ...prev, [rk]: { ...cur, ps: value, st } };
    });
  }

  function onSt(sheet, r, value) {
    setEdits((prev) => {
      const rk = sheet + '|' + r.so;
      return { ...prev, [rk]: { ...(prev[rk] || {}), st: value } };
    });
  }

  // Are there any edits that actually differ from what's stored?
  const dirty = useMemo(() => Object.keys(edits).some((rk) => {
    const i = rk.indexOf('|');
    const sheet = rk.slice(0, i);
    const so = rk.slice(i + 1);
    const e = edits[rk];
    const curPs = (mods.prodStatus && mods.prodStatus[so]) || 'Ready';
    const ps = e.ps != null ? e.ps : curPs;
    const arr = (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || [];
    const row = arr.find((x) => x.so === so);
    const curStage = row ? (row.stage || '') : '';
    const finalStage = ps === 'Ready' ? (e.st != null ? e.st : curStage) : '';
    return ps !== curPs || finalStage !== curStage;
  }), [edits, mods.oab, mods.prodStatus]);

  // Collect the prod-status module update + the per-row stage changes from edits.
  function computeNext() {
    const nextPs = { ...(mods.prodStatus || {}) };
    const stageChanges = [];
    let psDirty = false;
    ['SF', 'OT'].forEach((sheet) => {
      const arr = (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || [];
      arr.forEach((r) => {
        if (r.closed) return;
        const e = edits[sheet + '|' + r.so];
        if (!e) return;
        const curPs = (mods.prodStatus && mods.prodStatus[r.so]) || 'Ready';
        const ps = e.ps != null ? e.ps : curPs;
        const finalStage = ps === 'Ready' ? (e.st != null ? e.st : (r.stage || '')) : '';
        if (ps !== curPs) { nextPs[r.so] = ps; psDirty = true; }
        if (finalStage !== (r.stage || '')) { stageChanges.push({ so: r.so, stage: finalStage }); }
      });
    });
    return { nextPs, psDirty, stageChanges };
  }

  async function onSave() {
    const { nextPs, psDirty, stageChanges } = computeNext();
    if (!psDirty && !stageChanges.length) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      if (psDirty) await save('prodStatus', nextPs);              // (1) prod-status module, keyed by SO
      for (const ch of stageChanges) await ordersApi.setStage(ch.so, ch.stage); // (2) stage via the plant endpoint
      if (stageChanges.length) await reloadModule('oab');
      setEdits({});
      setMsg('Saved at ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
      setTimeout(() => setMsg(''), 4000);
    } catch (e) {
      setErr('Save failed: ' + (e.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  function onExcel() {
    const header = ['SO#', 'Sheet', 'Spec', 'Customer', 'Job', 'Disp Loc', 'PO Qty', 'Balance', 'Prod Status', 'Stage'];
    const body = visible.map(({ r, sheet: sh }) => {
      const { ps, st } = eff(sh, r);
      return [r.so, sh, r.spec || '', r.customer || '', r.jobName || '', r.dispLoc || '',
        Number(r.poQty) || 0, balance(r), ps, st];
    });
    exportAOA([header, ...body], `Plant_${today()}.xlsx`, 'Production Floor');
  }

  /**
   * Print the board for the floor: a popup window with the table only, A3 landscape,
   * selects hidden so the printed sheet reads as a report. (printPlantOAB)
   */
  function onPrint() {
    const el = tableRef.current;
    if (!el) return;
    const label = sheet === 'SF' ? 'Stay Fresh OAB' : 'Others OAB';
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) { alert('Allow pop-ups to print the board.'); return; }
    const css = '@page{size:A3 landscape;margin:10mm}body{font-family:Arial,sans-serif;font-size:10px}'
      + 'table{width:100%;border-collapse:collapse}'
      + 'th{background:#0e6fb8!important;color:#fff!important;padding:5px 7px;font-size:9px}'
      + 'td{padding:4px 7px;border-bottom:1px solid #eee}select{display:none}'
      + '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + label + '</title><style>'
      + css + '</style></head><body>' + el.innerHTML + '</body></html>');
    win.document.close();
    setTimeout(() => win.print(), 600);
  }

  return (
    <div id="app">
      {/* §63: the Plant login downloads the PPC's weekly / daily plans too. */}
      <PlanDownloads />
      <div className="fbar" style={{ marginTop: 12 }}>
        <select value={sheet} aria-label="Sheet" onChange={(e) => setSheet(e.target.value)}>
          <option value="SF">Stay Fresh OAB</option><option value="OT">Others OAB</option>
        </select>
        <button className="btn btn-s" style={{ height: 30, fontSize: 12 }} title={order.title} onClick={order.toggle}>{order.label}</button>
        <span style={{ flex: 1 }} />
        {/* Production only shows the save button once something is actually changed. */}
        {dirty && (
          <button
            className="btn" style={{ height: 30, fontSize: 12, background: '#E67E22', color: '#fff', fontWeight: 700 }}
            disabled={busy} onClick={onSave}
          >{busy ? '⏳ Saving…' : 'Save Changes'}</button>
        )}
        <span style={{ fontSize: 11, color: dirty ? 'var(--warn)' : 'var(--i3)' }}>
          {dirty ? '⚠ Unsaved changes' : msg}
        </span>
        <button className="btn btn-s" style={{ height: 30, fontSize: 12 }} onClick={onPrint}>🖨 PDF</button>
        <button className="btn btn-s" style={{ height: 30, fontSize: 12 }} onClick={onExcel}>⬇ Excel</button>
      </div>

      {err ? <div className="al al-r">{err}</div> : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--g)' }}>
          {sheet === 'SF' ? 'Stay Fresh OAB' : 'Others OAB'} — Production Status
        </div>
        <div style={{ fontSize: 11, color: 'var(--i3)' }}>{new Date().toLocaleString('en-IN')} &nbsp;|&nbsp; {visible.length} SOs</div>
      </div>

      <div className="tw sy" ref={tableRef}>
        <table>
          <thead>
            <tr>
              <th>#</th><th>SO#</th><th>Spec</th><th>Customer</th><th style={{ minWidth: 160 }}>Job Name</th><th>Location</th>
              <th style={{ textAlign: 'right' }}>PO Qty</th>
              <th style={{ textAlign: 'right' }}>Dispatched</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
              <th style={{ textAlign: 'right' }} title="Days since PO date">Age</th>
              <th style={{ minWidth: 120 }}>Prod Status</th>
              <th style={{ minWidth: 150 }}>Stage</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={12} style={{ textAlign: 'center', padding: 28, color: 'var(--i3)' }}>No open SOs</td></tr>
            ) : visible.map(({ r, sheet: sh }, i) => {
              const { ps, isReady, st } = eff(sh, r);
              const nr = !isReady;
              const age = ageDays(r.poDate);
              return (
                <tr key={sh + '|' + r.so} className={'zebra' + (nr ? ' nr' : '')}>
                  <td style={{ fontSize: 11, color: 'var(--i3)' }}>{i + 1}</td>
                  <td>
                    <span className="so-pill" style={nr ? { fontSize: 10, background: 'var(--red)' } : { fontSize: 10 }}>
                      {r.so}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--i3)' }}>{r.spec || '-'}</td>
                  <td style={{ fontSize: 11, fontWeight: 600 }}>{r.customer || '-'}</td>
                  <td style={{ fontSize: 11 }}>{r.jobName || '-'}</td>
                  <td style={{ fontSize: 11 }}>{r.dispLoc || '-'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{dash(r.poQty)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--g)' }}>{dash((Number(r.invDisp) || 0) + (Number(r.manDisp) || 0))}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: balance(r) > 0 ? 'var(--red)' : 'var(--g)' }}>
                    {dash(balance(r))}
                  </td>
                  <td
                    style={{ textAlign: 'right', fontSize: 11, fontWeight: 600, color: age == null ? '#888' : age > 90 ? '#C0392B' : age > 45 ? '#B8860B' : '#333' }}
                    title="Days since PO date"
                  >{age == null ? '-' : age + ' d'}</td>
                  <td>
                    <select
                      value={ps} aria-label={`Prod status for ${r.so}`}
                      onChange={(e) => onPs(sh, r, e.target.value)}
                      style={{ ...cellSel, width: 110, background: nr ? '#FDECEA' : '#e9f2fb' }}
                    >
                      {PROD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      value={st}
                      disabled={!isReady} aria-label={`Stage for ${r.so}`}
                      title={isReady ? 'Select stage' : 'Set Prod Status to "Ready" to select stage'}
                      onChange={(e) => onSt(sh, r, e.target.value)}
                      style={{
                        ...cellSel,
                        width: 140,
                        background: isReady ? '#fff' : '#F3F4F6',
                        color: isReady ? '#111' : '#9CA3AF',
                        cursor: isReady ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <option value="">— select —</option>
                      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
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

const cellSel = { height: 26, fontSize: 11, border: '1px solid var(--bd)', borderRadius: 4, padding: '0 4px' };

/** Whole days since an SO's PO date, or null. (soAgeDays) */
function ageDays(poDate) {
  if (!poDate) return null;
  const d = new Date(poDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
