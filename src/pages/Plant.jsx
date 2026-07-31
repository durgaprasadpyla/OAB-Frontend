import { useMemo, useState, useRef } from 'react';
import { useData } from '../data.jsx';
import { ordersApi } from '../api.js';
import { balance } from '../lib/calc.js';
import { dash, today } from '../lib/format.js';
import { STAGES, PROD_STATUSES } from '../lib/constants.js';
import { exportAOA } from '../lib/xlsx.js';
import { printElement } from '../lib/pdf.js';

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

  // Sheet filter (All / SF / OT), default All.
  const [filter, setFilter] = useState('All');
  // Local edits, keyed by `${sheet}|${so}` -> { ps, st }. Cleared on save.
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const tableRef = useRef(null);

  // Flatten both sheets (SF first), open rows only.
  const rows = useMemo(() => {
    const out = [];
    ['SF', 'OT'].forEach((sheet) => {
      const arr = (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || [];
      arr.forEach((r) => { if (!r.closed) out.push({ r, sheet }); });
    });
    return out;
  }, [mods.oab]);

  const visible = useMemo(
    () => (filter === 'All' ? rows : rows.filter((x) => x.sheet === filter)),
    [rows, filter],
  );

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
    const body = visible.map(({ r, sheet }) => {
      const { ps, st } = eff(sheet, r);
      return [r.so, sheet, r.spec || '', r.customer || '', r.jobName || '', r.dispLoc || '',
        Number(r.poQty) || 0, balance(r), ps, st];
    });
    exportAOA([header, ...body], `Plant_${today()}.xlsx`, 'Production Floor');
  }

  return (
    <div id="app">
      <div className="pg-ttl">Production Floor</div>
      <div className="pg-sub">
        Open sales orders across both sheets — set production status and stage. {visible.length} SOs.
      </div>

      {msg ? <div className="al al-g">{msg}</div> : null}
      {err ? <div className="al al-r">{err}</div> : null}

      <div className="fbar">
        {['All', 'SF', 'OT'].map((k) => (
          <button
            key={k}
            className={'btn btn-s' + (filter === k ? ' on' : '')}
            onClick={() => setFilter(k)}
          >
            {k === 'All' ? 'All' : k === 'SF' ? 'Stay Fresh' : 'Others'}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn btn-g" disabled={!dirty || busy} onClick={onSave}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-s" onClick={onExcel}>Download Excel</button>
        <button className="btn btn-s" onClick={() => printElement(tableRef.current)}>Print</button>
      </div>

      <div className="tw sy" ref={tableRef}>
        <table>
          <thead>
            <tr>
              <th>SO#</th><th>Sheet</th><th>Spec</th><th>Customer</th><th>Job</th><th>Disp Loc</th>
              <th style={{ textAlign: 'right' }}>PO Qty</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
              <th style={{ minWidth: 120 }}>Prod Status</th>
              <th style={{ minWidth: 150 }}>Stage</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 28, color: 'var(--i3)' }}>No open SOs</td></tr>
            ) : visible.map(({ r, sheet }, i) => {
              const { ps, isReady, st } = eff(sheet, r);
              const nr = !isReady;
              return (
                <tr key={sheet + '|' + r.so} className={'zebra' + (nr ? ' nr' : '')}>
                  <td>
                    <span className="so-pill" style={nr ? { fontSize: 10, background: 'var(--red)' } : { fontSize: 10 }}>
                      {r.so}
                    </span>
                  </td>
                  <td><span className={'tag ' + (sheet === 'SF' ? 'tg' : 'tr')}>{sheet}</span></td>
                  <td style={{ fontSize: 11, color: 'var(--i3)' }}>{r.spec || '-'}</td>
                  <td style={{ fontSize: 11, fontWeight: 600 }}>{r.customer || '-'}</td>
                  <td style={{ fontSize: 11 }}>{r.jobName || '-'}</td>
                  <td style={{ fontSize: 11 }}>{r.dispLoc || '-'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{dash(r.poQty)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: balance(r) > 0 ? 'var(--red)' : 'var(--g)' }}>
                    {dash(balance(r))}
                  </td>
                  <td>
                    <select
                      value={ps}
                      onChange={(e) => onPs(sheet, r, e.target.value)}
                      style={{ ...cellSel, width: 118, background: nr ? '#FDECEA' : '#E8F5EE' }}
                    >
                      {PROD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      value={st}
                      disabled={!isReady}
                      title={isReady ? 'Select stage' : 'Set Prod Status to "Ready" to select stage'}
                      onChange={(e) => onSt(sheet, r, e.target.value)}
                      style={{
                        ...cellSel,
                        width: 150,
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
