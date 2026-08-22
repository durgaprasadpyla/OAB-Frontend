import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { ordersApi } from '../api.js';
import { balance, invBalance } from '../lib/calc.js';
import { dash, fmtDate, inr } from '../lib/format.js';
import { useSoOrder, soOrder } from '../lib/soOrder.js';
import { BalanceBadge } from '../components/badges.jsx';
import { fgProduced, fgAddAllocation, fgAvail } from '../lib/fg.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Daily Update — manual dispatch + FG + stage + short-close (native port of renderUpd/saveAllUpd, legacy 1906). */
export default function DailyUpdate() {
  const { mods, reloadModule, save } = useData();
  const [sheet, setSheet] = useState('SF');
  const [q, setQ] = useState('');
  const [poFilter, setPoFilter] = useState('');
  const [edits, setEdits] = useState({});   // { [so]: {man, inv, fg, stage} }
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logFor, setLogFor] = useState(null);   // SO whose manual-dispatch log is open
  const order = useSoOrder();

  const prodStatus = (so) => (mods.prodStatus && mods.prodStatus[so]) || 'Ready';
  const rows = useMemo(() => {
    const all = (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || [];
    const s = q.toLowerCase();
    const open = all.filter((r) => !r.closed
      && (!poFilter || r.poNum === poFilter)
      && (!s || [r.so, r.customer, r.jobName, r.spec, r.poNum].some((v) => String(v || '').toLowerCase().includes(s))));
    return soOrder(open, order.newestFirst);
  }, [mods.oab, sheet, q, poFilter, order.newestFirst]);

  // Distinct POs on the open orders of this sheet, for the PO filter. (renderUpd)
  const pos = useMemo(() => {
    const all = (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || [];
    return [...new Set(all.filter((r) => !r.closed).map((r) => r.poNum).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)));
  }, [mods.oab, sheet]);

  const setEdit = (so, patch) => setEdits((e) => ({ ...e, [so]: { ...e[so], ...patch } }));
  const flash = (text, t = 'g') => { setMsg({ text, t }); setTimeout(() => setMsg(null), 4000); };

  async function saveAll() {
    const arr = (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || [];
    const ops = [];
    const over = [];
    const fgDraws = [];   // FG increases to record against the ledger pool
    const fgBlocked = [];  // SOs whose FG draw would overdraw a tracked spec's pool
    arr.forEach((r) => {
      if (r.closed) return;
      const e = edits[r.so];
      if (!e) return;
      const op = { so: r.so };
      let has = false;
      if (e.man !== undefined && e.man !== '' && num(e.man) > 0) {
        const avail = invBalance(r);   // remaining un-dispatched qty (excludes FG)
        if (num(e.man) > avail) { over.push(`SO ${r.so}: ${num(e.man)} > balance ${avail}`); return; }
        op.addQty = num(e.man); op.invNo = (e.inv || '').trim(); has = true;
      }
      // Allocate FG is ADDITIVE: the entered qty is drawn from the spec's pool and
      // ADDED to the SO's existing FG (legacy 2722), never a replacement. A tracked
      // spec (production recorded) is hard-blocked when the draw would overdraw the
      // pool (legacy fgBlocked 2720); an untracked spec keeps the port's free Set-FG
      // path so specs with no ledger history can still be set by hand.
      if (e.fg !== undefined && e.fg !== '') {
        const entered = num(e.fg);
        if (entered < 0) {
          fgBlocked.push(`SO ${r.so}: FG allocation cannot be negative`);
        } else if (entered > 0) {
          const tracked = fgProduced(mods.fgLedger, r.spec) > 0;
          const avail = fgAvail(mods.fgLedger, r.spec);
          if (tracked && entered > avail) {
            fgBlocked.push(`SO ${r.so} (spec ${r.spec || '?'}): tried ${entered.toLocaleString('en-IN')}, only ${Math.max(0, avail).toLocaleString('en-IN')} available`);
          } else {
            op.fg = num(r.fg) + entered; has = true;   // additive: existing + entered
            if (tracked && r.spec) fgDraws.push({ so: r.so, spec: r.spec, delta: entered });
          }
        }
      }
      if (has) ops.push(op);
    });
    if (over.length) { flash('Manual dispatch exceeds balance — ' + over.join('; '), 'r'); return; }
    if (fgBlocked.length) { flash('⛔ FG not allocated for ' + fgBlocked.length + ' SO' + (fgBlocked.length > 1 ? 's' : '') + ' — add production on the FG Entry page first: ' + fgBlocked.join('; '), 'r'); return; }
    if (!ops.length) { flash('No changes to save', 'y'); return; }
    setBusy(true);
    try {
      for (const op of ops) await ordersApi.dispatch(op);   // server: atomic manDisp += qty, FG/stage
      await reloadModule('oab');
      // Record FG increases as pool allocations, but ONLY for specs already tracked
      // in the FG ledger (have production recorded). Untracked specs keep the
      // pre-existing free "Set FG" behaviour untouched. Best-effort: a ledger
      // failure never fails the dispatch that already committed.
      const tracked = fgDraws.filter((d) => fgProduced(mods.fgLedger, d.spec) > 0);
      if (tracked.length) {
        try {
          await save('fgLedger', (prev) => tracked.reduce((led, d) => fgAddAllocation(led, d.spec, d.delta, d.so, 'daily-update'), prev));
        } catch { /* additive tracking only — ignore */ }
      }
      setEdits({}); flash('✅ All changes saved');
    } catch (err) {
      await reloadModule('oab');   // some ops may have committed; show server truth
      flash('Save failed: ' + err.message, 'r');
    } finally { setBusy(false); }
  }

  async function closeSO(so) {
    const arr = (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet]) || [];
    const r = arr.find((x) => x.so === so);
    if (!r) return;
    const disp = num(r.invDisp) + num(r.manDisp);
    const short = disp < num(r.poQty);
    const message = short
      ? `Short close SO ${r.so}?\nPO Qty: ${num(r.poQty).toLocaleString('en-IN')}\nDispatched: ${disp.toLocaleString('en-IN')}\nShort by: ${(num(r.poQty) - disp).toLocaleString('en-IN')} pcs\n\nThis will mark the SO as closed.`
      : `Close SO ${r.so}? It is fully dispatched.`;
    if (!window.confirm(message)) return;
    setBusy(true);
    try { await ordersApi.close(so); await reloadModule('oab'); flash('SO ' + r.so + ' closed' + (short ? ' (short close)' : '')); }
    catch (err) { flash('Close failed: ' + err.message, 'r'); }
    finally { setBusy(false); }
  }

  return (
    <div id="app">
      <div className="pg-ttl">Daily Update</div>
      <div className="pg-sub">Set total manual dispatched, FG, stage and machines. Invoice dispatches are tracked separately and shown read-only.</div>

      <div className="fbar">
        <select value={sheet} aria-label="Sheet" onChange={(e) => { setSheet(e.target.value); setPoFilter(''); }}>
          <option value="SF">Stay Fresh</option>
          <option value="OT">Others</option>
        </select>
        <select value={poFilter} aria-label="Filter by PO" onChange={(e) => setPoFilter(e.target.value)}>
          <option value="">All POs</option>
          {pos.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input placeholder="Search SO / PO # / customer / job / spec..." aria-label="Search orders" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <button className="btn btn-s" style={{ height: 30, fontSize: 12 }} title={order.title} onClick={order.toggle}>{order.label}</button>
        <button className="btn btn-s" style={{ height: 30, fontSize: 12 }} aria-label="Refresh" onClick={() => reloadModule('oab')}>↻</button>
        <button className="btn btn-g" style={{ height: 30, fontSize: 12, marginLeft: 'auto' }} onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : '✓ Save All Changes'}</button>
      </div>

      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <div className="tw sy">
        <table>
          <thead>
            <tr>
              <th>SO#</th><th style={{ minWidth: 160 }}>Job Name</th><th>Customer</th>
              <th style={{ minWidth: 90 }}>PO #</th><th style={{ minWidth: 70 }}>Disp Loc</th>
              <th style={{ textAlign: 'right' }}>PO Qty</th>
              <th style={{ textAlign: 'right' }}>Inv Disp</th><th style={{ textAlign: 'right' }}>Man Disp</th>
              <th style={{ textAlign: 'right' }}>FG</th><th style={{ textAlign: 'right' }}>Balance</th>
              <th style={{ width: 90 }}>Add Man Disp Qty</th><th style={{ width: 110 }}>Man Disp Inv #</th>
              <th style={{ width: 100 }}>Allocate FG</th><th style={{ width: 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody id="upd-body">
            {rows.length === 0 ? (
              <tr><td colSpan={14} style={{ textAlign: 'center', padding: 28, color: 'var(--i3)' }}>No data</td></tr>
            ) : rows.map((r) => {
              const b = balance(r);
              const e = edits[r.so] || {};
              const logCount = (r.manDispLog || []).length;
              const manDispTitle = logCount
                ? `${logCount} logged manual dispatch${logCount === 1 ? '' : 'es'} — click for the date and Inv/DC # of each`
                : 'No manual dispatches logged yet for this SO';
              const avail = fgAvail(mods.fgLedger, r.spec);
              const typed = e.fg ?? '';
              return (
                <tr key={r.so}>
                  <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
                  <td style={{ fontSize: 11 }}><div className="clamp3" title={r.jobName || ''}>{r.jobName || '-'}</div></td>
                  <td style={{ fontSize: 11 }}><div className="clamp3" title={r.customer || ''}>{r.customer || '-'}</div></td>
                  <td style={{ fontSize: 11 }}>{r.poNum || '-'}</td>
                  <td style={{ fontSize: 11 }}>{r.dispLoc || '-'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{dash(r.poQty)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--g)', fontSize: 11 }}>{dash(r.invDisp)}</td>
                  <td style={{ textAlign: 'right' }} title={manDispTitle}>
                    {logCount ? (
                      <button type="button" onClick={() => setLogFor(r.so)}
                        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--ink)' }}>
                        {dash(r.manDisp)} <span style={{ color: 'var(--i3)', fontSize: 9 }}>({logCount})</span>
                      </button>
                    ) : dash(r.manDisp)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{dash(r.fg)}</td>
                  <td style={{ textAlign: 'right' }}><BalanceBadge value={b}>{dash(b)}</BalanceBadge></td>
                  <td><input type="number" min="0" placeholder="0" value={e.man ?? ''} onChange={(ev) => setEdit(r.so, { man: ev.target.value })}
                    title="Additional qty being manually dispatched now — added to the existing Man Disp total, not a replacement" /></td>
                  <td><input type="text" placeholder="Inv / DC #" value={e.inv ?? ''} onChange={(ev) => setEdit(r.so, { inv: ev.target.value })} style={{ width: '100%' }} /></td>
                  {/* Allocating FG draws from the spec's finished-goods pool, so the
                      remaining pool is shown live under the field and turns red when the
                      typed quantity would overdraw it. (renderUpd / fgUpdHint) */}
                  <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                    <div style={{ position: 'relative', width: 78 }}>
                      <input
                        type="number" min="0" step="1" placeholder="0" value={typed}
                        aria-label={`Allocate FG for ${r.so}`}
                        title={`Allocate finished goods from the FG pool (spec ${r.spec || '-'}) to this SO. Cannot exceed available.`}
                        onChange={(ev) => setEdit(r.so, { fg: ev.target.value })}
                        style={{ width: '100%' }}
                      />
                      <FgHint avail={avail} typed={typed} />
                    </div>
                  </td>
                  <td>
                    <button className="btn btn-r" style={{ height: 24, fontSize: 10, padding: '0 7px' }}
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

/**
 * The live "avail N" hint under an Allocate-FG field: plain while untouched, green
 * with the remainder once a quantity is typed, red when it would overdraw the pool.
 * (fgUpdHint)
 */
function FgHint({ avail, typed }) {
  const base = { position: 'absolute', top: '100%', left: 0, fontSize: 9, marginTop: 1, whiteSpace: 'nowrap' };
  if (typed === '' || typed == null) return <div style={{ ...base, color: 'var(--i3)' }}>avail {inr(avail)}</div>;
  const v = Number(typed) || 0;
  if (v > avail) return <div style={{ ...base, color: 'var(--red)' }}>exceeds avail {inr(avail)}!</div>;
  return <div style={{ ...base, color: 'var(--g)' }}>avail {inr(avail)} → {inr(avail - v)} left</div>;
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

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: 20 };
const sheet = { background: 'var(--wh)', borderRadius: 12, padding: 18, width: 'min(560px, 96vw)', margin: 'auto' };
