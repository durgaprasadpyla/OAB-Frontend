import { useCallback, useEffect, useMemo, useState } from 'react';
import { stockCountApi } from '../lib/stockCountApi.js';
import { fmtDate, today } from '../lib/format.js';
import { useAuth } from '../auth.jsx';
import { V2Panel, V2Badge, V2Note } from './V2Ui.jsx';
import '../v2-stores.css';

// BloomFlex V2 — physical inventory reconciliation.
//
// System closing = opening + GRN receipts − issues + returns, read off the stores
// ledger (the month to date, so the figures behind the closing are visible). The desk
// enters what it physically counted; any variance needs a reason. A Super Admin
// approves or rejects the count — an audit decision only: it does NOT change stock.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const qty = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export const TOLERANCE = 0.001;

/** counted − system, or null while nothing has been typed. */
export function varianceOf(counted, system) {
  if (counted == null || String(counted).trim() === '' || !Number.isFinite(Number(counted))) return null;
  return Math.round((Number(counted) - num(system)) * 1000) / 1000;
}
export const needsReason = (variance) => variance != null && Math.abs(variance) > TOLERANCE;

const STATUS_TAG = { PENDING: 'ty', APPROVED: 'tg', REJECTED: 'tr' };
const monthStart = () => today().slice(0, 8) + '01';

export default function StockReconciliation({ canApprove: canApproveProp }) {
  const auth = useAuth() || {};   // null outside the AuthProvider (tests)
  const canApprove = canApproveProp != null ? canApproveProp : auth.role === 'superadmin';
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState([]);
  const [entry, setEntry] = useState({});        // itemId → { counted, reason }
  const [search, setSearch] = useState('');
  const [hist, setHist] = useState('');          // '' | PENDING | APPROVED | REJECTED
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const loadItems = useCallback(async () => {
    try {
      const m = await stockCountApi.movement({ from: monthStart(), to: today() });
      setItems((m && m.items) || []);
    } catch (e) { setMsg({ t: 'r', text: e.message }); }
  }, []);
  const loadCounts = useCallback(async () => {
    try { setCounts((await stockCountApi.counts()) || []); }
    catch (e) { setMsg({ t: 'r', text: e.message }); }
  }, []);
  useEffect(() => { loadItems(); loadCounts(); }, [loadItems, loadCounts]);

  const visible = useMemo(() => {
    const f = search.trim().toLowerCase();
    return items.filter((r) => r.active !== false || num(r.closing) !== 0)
      .filter((r) => !f || String(r.code || '').toLowerCase().includes(f) || String(r.name || '').toLowerCase().includes(f));
  }, [items, search]);
  const shownCounts = useMemo(() => (hist ? counts.filter((c) => c.status === hist) : counts), [counts, hist]);

  const set = (id, k, v) => setEntry((e) => ({ ...e, [id]: { ...(e[id] || {}), [k]: v } }));

  async function submit(r) {
    const e = entry[r.itemId] || {};
    const v = varianceOf(e.counted, r.closing);
    if (v == null) { setMsg({ t: 'r', text: `Enter the counted quantity for ${r.code}.` }); return; }
    if (needsReason(v) && !String(e.reason || '').trim()) {
      setMsg({ t: 'r', text: `${r.code}: a reason is required for a variance of ${qty(v)}.` });
      return;
    }
    setBusy(true);
    try {
      await stockCountApi.submit({ itemId: r.itemId, countedQty: Number(e.counted), reason: String(e.reason || '').trim(), countDate: today() });
      setEntry((x) => { const n = { ...x }; delete n[r.itemId]; return n; });
      setMsg({ t: 'g', text: `Count for ${r.code} submitted for approval.` });
      await Promise.all([loadItems(), loadCounts()]);
    } catch (err) { setMsg({ t: 'r', text: err.message }); } finally { setBusy(false); }
  }

  async function decide(c, approve) {
    if (!approve && !window.confirm(`Reject the count of ${c.itemCode}?`)) return;
    setBusy(true);
    try {
      await (approve ? stockCountApi.approve(c.id) : stockCountApi.reject(c.id));
      setMsg({ t: 'g', text: `Count of ${c.itemCode} ${approve ? 'approved' : 'rejected'} — stock is unchanged.` });
      await loadCounts();
    } catch (err) { setMsg({ t: 'r', text: err.message }); } finally { setBusy(false); }
  }

  // BloomFlex V2: the prototype's reconciliation panel — explanation, one row per item
  // with the counted figure, its variance, a comment and the approval step.
  return (
    <div>
      <V2Panel title="Physical inventory reconciliation"
        right={(
          <>
            <input className="v2-search" placeholder="Search item code / name" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="btn btn-s" onClick={() => { loadItems(); loadCounts(); }}>Refresh</button>
            <V2Badge tone="amber">Super Admin approval</V2Badge>
          </>
        )}>
        <div className="v2-pad" style={{ paddingBottom: 8 }}>
          <V2Note tone="blue" style={{ marginBottom: 0 }}>
            System closing = opening + GRN receipts − issues + returns (month to date). Enter the physically counted stock;
            any variance needs a reason. Approval records an audit decision — it does <b>not</b> change stock.
          </V2Note>
          {msg && <div className={'al al-' + msg.t} style={{ marginTop: 10, marginBottom: 0 }}>{msg.text}</div>}
        </div>
        <div className="tw sy" style={{ maxHeight: 'calc(100vh - 420px)' }}>
          <table aria-label="Stock reconciliation">
            <thead><tr>
              <th>Item / UOM</th><th className="v2-num">Opening</th><th className="v2-num">GRN</th>
              <th className="v2-num">Issued</th><th className="v2-num">Returns</th>
              <th className="v2-num">System closing</th><th>Actual counted</th>
              <th className="v2-num">Variance</th><th>Comments</th><th>Approval</th>
            </tr></thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={10} className="v2-empty">No items</td></tr>
              ) : visible.map((r) => {
                const e = entry[r.itemId] || {};
                const v = varianceOf(e.counted, r.closing);
                const missing = needsReason(v) && !String(e.reason || '').trim();
                return (
                  <tr key={r.itemId}>
                    <td style={{ whiteSpace: 'normal' }}>
                      <b style={{ fontFamily: 'monospace' }}>{r.code}</b>
                      <div style={{ fontSize: 11, color: 'var(--v2-muted)' }}>{r.name || ''} ({r.uom || '—'})</div>
                    </td>
                    <td className="v2-num">{qty(r.opening)}</td>
                    <td className="v2-num">{qty(r.receipts)}</td>
                    <td className="v2-num">{qty(r.issues)}</td>
                    <td className="v2-num">{qty(r.returns)}</td>
                    <td className="v2-num" style={{ fontWeight: 700 }}>{qty(r.closing)}</td>
                    <td>
                      <input type="number" className="nospin" step="any" min="0" aria-label={`Counted ${r.code}`} placeholder="Actual"
                        value={e.counted ?? ''} onChange={(ev) => set(r.itemId, 'counted', ev.target.value)}
                        style={{ width: 100, height: 32, textAlign: 'right' }} />
                    </td>
                    <td aria-label={`Variance ${r.code}`} className="v2-num" style={{ fontWeight: 700,
                      color: v == null ? 'var(--i3)' : needsReason(v) ? 'var(--red)' : 'var(--g)' }}>
                      {v == null ? '—' : (v > 0 ? '+' : '') + qty(v)}
                    </td>
                    <td>
                      <input type="text" aria-label={`Reason ${r.code}`} placeholder={missing ? 'Reason required' : 'Reason / note'}
                        value={e.reason ?? ''} onChange={(ev) => set(r.itemId, 'reason', ev.target.value)}
                        style={{ width: 170, height: 32, borderColor: missing ? 'var(--red)' : undefined }} />
                      {missing && <div style={{ fontSize: 10, color: 'var(--red)' }}>Reason required for a variance</div>}
                    </td>
                    <td>
                      <button className="btn btn-s" style={{ height: 30, fontSize: 12 }} disabled={busy || v == null || missing}
                        aria-label={`Submit count ${r.code}`} onClick={() => submit(r)}>Submit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </V2Panel>

      <V2Panel title={<h2>Count history <span className="tag tgr">{shownCounts.length}</span></h2>}
        sub="Submitted counts and the Super Admin's decision on each"
        right={(
          <select aria-label="History status" value={hist} onChange={(e) => setHist(e.target.value)} style={{ height: 34 }}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        )}>
        <div className="tw sy" style={{ maxHeight: 360 }}>
          <table aria-label="Stock count history">
            <thead><tr>
              <th>Date</th><th>Item</th><th className="v2-num">System</th><th className="v2-num">Counted</th>
              <th className="v2-num">Variance</th><th>Reason</th><th>Counted by</th><th>Status</th><th>Decided by</th>
              {canApprove && <th />}
            </tr></thead>
            <tbody>
              {shownCounts.length === 0 ? (
                <tr><td colSpan={canApprove ? 10 : 9} className="v2-empty">No counts yet</td></tr>
              ) : shownCounts.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontSize: 11 }}>{fmtDate(c.countDate)}</td>
                  <td style={{ fontSize: 11 }}><b style={{ fontFamily: 'monospace' }}>{c.itemCode}</b> {c.itemName || ''}</td>
                  <td className="v2-num">{qty(c.systemQty)}</td>
                  <td className="v2-num">{qty(c.countedQty)}</td>
                  <td className="v2-num" style={{ fontWeight: 700, color: needsReason(num(c.variance)) ? 'var(--red)' : 'var(--g)' }}>{qty(c.variance)}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{c.reason || '—'}</td>
                  <td style={{ fontSize: 11 }}>{c.countedBy || '—'}</td>
                  <td><span className={'tag ' + (STATUS_TAG[c.status] || 'tgr')}>{c.status}</span></td>
                  <td style={{ fontSize: 11 }}>{c.approvedBy ? `${c.approvedBy}${c.approvedAt ? ' · ' + fmtDate(String(c.approvedAt).slice(0, 10)) : ''}` : '—'}</td>
                  {canApprove && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {c.status === 'PENDING' && (
                        <>
                          <button className="btn btn-g" style={{ height: 28, fontSize: 11 }} disabled={busy} onClick={() => decide(c, true)}>Approve</button>{' '}
                          <button className="btn btn-r" style={{ height: 28, fontSize: 11 }} disabled={busy} onClick={() => decide(c, false)}>Reject</button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </V2Panel>
      <V2Note>
        A count is only an audit record: approving or rejecting it never adjusts stock. The history keeps who counted,
        the variance and its reason, and who decided.
      </V2Note>
    </div>
  );
}
