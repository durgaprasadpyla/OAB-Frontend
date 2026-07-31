import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { balance } from '../lib/calc.js';
import { dash, today, fmtDate } from '../lib/format.js';
import { STAGES } from '../lib/constants.js';
import { BalanceBadge } from '../components/badges.jsx';

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Daily Update — manual dispatch + FG + stage + short-close (native port of renderUpd/saveAllUpd, legacy 1906). */
export default function DailyUpdate() {
  const { mods, save } = useData();
  const [sheet, setSheet] = useState('SF');
  const [q, setQ] = useState('');
  const [edits, setEdits] = useState({});   // { [so]: {man, inv, fg, stage} }
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logFor, setLogFor] = useState(null);   // SO whose manual-dispatch log is open

  const prodStatus = (so) => (mods.prodStatus && mods.prodStatus[so]) || 'Ready';
  const rows = useMemo(() => {
    const all = (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || [];
    const s = q.toLowerCase();
    return all.filter((r) => !r.closed && (!s || [r.so, r.customer, r.jobName, r.spec].some((v) => String(v || '').toLowerCase().includes(s))));
  }, [mods.oab, sheet, q]);

  const setEdit = (so, patch) => setEdits((e) => ({ ...e, [so]: { ...e[so], ...patch } }));
  const flash = (text, t = 'g') => { setMsg({ text, t }); setTimeout(() => setMsg(null), 4000); };

  async function saveAll() {
    const next = clone(mods.oab);
    const arr = next.OAB[sheet] || [];
    let changed = 0;
    arr.forEach((r) => {
      if (r.closed) return;
      const e = edits[r.so];
      if (!e) return;
      if (e.man !== undefined && e.man !== '' && num(e.man) > 0) {
        if (!Array.isArray(r.manDispLog)) r.manDispLog = [];
        r.manDispLog.push({ date: today(), invNo: (e.inv || '').trim(), qty: num(e.man) });
        r.manDisp = num(r.manDisp) + num(e.man);
        changed++;
      }
      if (e.fg !== undefined && e.fg !== '') { r.fg = num(e.fg); changed++; }
      if (prodStatus(r.so) === 'Ready' && e.stage !== undefined && e.stage !== '' && e.stage !== r.stage) { r.stage = e.stage; changed++; }
    });
    if (!changed) { flash('No changes to save', 'y'); return; }
    setBusy(true);
    try { await save('oab', next); setEdits({}); flash('✅ All changes saved'); }
    catch (err) { flash('Save failed: ' + err.message, 'r'); }
    finally { setBusy(false); }
  }

  async function closeSO(so) {
    const next = clone(mods.oab);
    const arr = next.OAB[sheet] || [];
    const i = arr.findIndex((r) => r.so === so);
    if (i < 0) return;
    const r = arr[i];
    const disp = num(r.invDisp) + num(r.manDisp);
    const short = disp < num(r.poQty);
    const message = short
      ? `Short close SO ${r.so}?\nPO Qty: ${num(r.poQty).toLocaleString('en-IN')}\nDispatched: ${disp.toLocaleString('en-IN')}\nShort by: ${(num(r.poQty) - disp).toLocaleString('en-IN')} pcs\n\nThis will mark the SO as closed.`
      : `Close SO ${r.so}? It is fully dispatched.`;
    if (!window.confirm(message)) return;
    arr[i] = { ...r, closed: true, closedDate: today(), shortClosed: short };
    setBusy(true);
    try { await save('oab', next); flash('SO ' + r.so + ' closed' + (short ? ' (short close)' : '')); }
    catch (err) { flash('Close failed: ' + err.message, 'r'); }
    finally { setBusy(false); }
  }

  return (
    <div id="app">
      <div className="pg-ttl">Daily Update</div>
      <div className="pg-sub">Log manual dispatches, set finished-goods and production stage, or short-close an SO.</div>

      <div className="fbar">
        <button className="btn btn-s" style={sheet === 'SF' ? onStyle : undefined} onClick={() => setSheet('SF')}>Stay Fresh</button>
        <button className="btn btn-s" style={sheet === 'OT' ? onStyle : undefined} onClick={() => setSheet('OT')}>Others</button>
        <input placeholder="Search SO / customer / job / spec…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-g" onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : '💾 Save All Changes'}</button>
      </div>

      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <div className="tw sy">
        <table>
          <thead>
            <tr>
              <th>SO#</th><th>Job Name</th><th>Customer</th><th style={{ textAlign: 'right' }}>PO Qty</th>
              <th style={{ textAlign: 'right' }}>Inv</th><th style={{ textAlign: 'right' }}>Man</th>
              <th style={{ textAlign: 'right' }}>FG</th><th style={{ textAlign: 'right' }}>Balance</th>
              <th style={{ width: 90 }}>+ Man Qty</th><th style={{ width: 110 }}>Inv / DC #</th>
              <th style={{ width: 80 }}>Set FG</th><th style={{ width: 150 }}>Stage</th><th>Close</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={13} style={{ textAlign: 'center', padding: 28, color: 'var(--i3)' }}>No data</td></tr>
            ) : rows.map((r) => {
              const b = balance(r);
              const e = edits[r.so] || {};
              const logCount = (r.manDispLog || []).length;
              const isReady = prodStatus(r.so) === 'Ready';
              return (
                <tr key={r.so}>
                  <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
                  <td style={{ fontSize: 11 }}>{r.jobName || '-'}</td>
                  <td style={{ fontSize: 11 }}>{r.customer || '-'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{dash(r.poQty)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--g)', fontSize: 11 }}>{dash(r.invDisp)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {logCount ? (
                      <button type="button" onClick={() => setLogFor(r.so)}
                        title="View each manual dispatch — date, Inv/DC # and qty"
                        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--ink)' }}>
                        {dash(r.manDisp)} <span style={{ color: 'var(--g)', fontSize: 9, textDecoration: 'underline' }}>({logCount})</span>
                      </button>
                    ) : dash(r.manDisp)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{dash(r.fg)}</td>
                  <td style={{ textAlign: 'right' }}><BalanceBadge value={b}>{dash(b)}</BalanceBadge></td>
                  <td><input type="number" min="0" placeholder="0" value={e.man ?? ''} onChange={(ev) => setEdit(r.so, { man: ev.target.value })}
                    title="Additional qty being manually dispatched now — added to the existing Man Disp total, not a replacement" /></td>
                  <td><input type="text" placeholder="Inv / DC #" value={e.inv ?? ''} onChange={(ev) => setEdit(r.so, { inv: ev.target.value })} style={{ width: '100%' }} /></td>
                  <td><input type="number" min="0" placeholder={String(num(r.fg))} value={e.fg ?? ''} onChange={(ev) => setEdit(r.so, { fg: ev.target.value })} /></td>
                  <td>
                    <select value={e.stage ?? (r.stage || '')} disabled={!isReady} onChange={(ev) => setEdit(r.so, { stage: ev.target.value })}
                      title={isReady ? 'Select stage' : 'Enable "Ready" status in Plant Login to select stage'}
                      style={{ width: '100%', height: 28, fontSize: 11, background: isReady ? '#fff' : '#F3F4F6', color: isReady ? '#111' : '#9CA3AF' }}>
                      <option value="">— select —</option>
                      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <button className="btn btn-s" style={{ height: 24, fontSize: 10, padding: '0 7px', color: 'var(--red)', borderColor: '#F5A8A0' }}
                      onClick={() => closeSO(r.so)} disabled={busy} title="Short close this SO">Close SO</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {logFor && (
        <ManDispModal
          so={logFor}
          log={((mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || []).find((x) => x.so === logFor)?.manDispLog || []}
          onClose={() => setLogFor(null)}
        />
      )}
    </div>
  );
}

/** Read-only breakdown of every manual dispatch logged against one SO. */
function ManDispModal({ so, log, onClose }) {
  const entries = log || [];
  const total = entries.reduce((s, e) => s + (Number(e.qty) || 0), 0);
  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="ctitle" style={{ margin: 0 }}>Manual dispatches — SO {so}</div>
          <button className="btn btn-s" onClick={onClose}>Close</button>
        </div>
        {entries.length === 0 ? (
          <div className="pg-sub" style={{ margin: 0 }}>No manual dispatches logged for this SO.</div>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr><th style={{ width: 40 }}>#</th><th>Date</th><th>Inv / DC #</th><th style={{ textAlign: 'right' }}>Qty</th></tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{fmtDate(e.date) || '-'}</td>
                    <td>{e.invNo ? e.invNo : <span style={{ color: 'var(--i3)' }}>—</span>}</td>
                    <td style={{ textAlign: 'right' }}>{dash(e.qty)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Total dispatched</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{dash(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const onStyle = { background: 'var(--gl)', color: 'var(--g)', borderColor: '#A8D5B8', fontWeight: 700 };
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: 20 };
const sheet = { background: 'var(--wh)', borderRadius: 12, padding: 18, width: 'min(560px, 96vw)', margin: 'auto' };
