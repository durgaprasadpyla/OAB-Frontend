import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { storesApi } from '../api.js';
import { inr } from '../lib/format.js';
import { findSpecForRow } from '../lib/master.js';

// Super Admin → Raw Material header. Two questions, answered above the existing
// requirement view:
//
//   1. Where is my money sitting? The value of the stock on hand split by the
//      disposition the stores desk gives each roll — moving, non-moving, rejected
//      and sample (returned alongside), so blocked capital is visible at a glance.
//   2. Which orders can actually run? An open sale order whose film has been
//      issued from stores is "material assigned"; one with nothing issued against
//      it is waiting. Both lists are shown, waiting first.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const CARDS = [
  { k: 'MOVING', label: 'Moving', color: 'var(--g)' },
  { k: 'NON_MOVING', label: 'Non-moving', color: '#c9a100' },
  { k: 'REJECTED', label: 'Rejected', color: 'var(--red)' },
  { k: 'SAMPLE', label: 'Sample', color: '#1d4e89' },
  { k: 'RETURNED', label: 'Returned', color: 'var(--i2)' },
];

export default function StoresStockPanel() {
  const { mods } = useData();
  const [summary, setSummary] = useState(null);
  const [txns, setTxns] = useState([]);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([storesApi.summary(), storesApi.txns({ limit: 1000 })]);
      // Be forgiving about the shape: this panel sits on the Super Admin dashboard
      // and must never blank the tab because a response came back unexpected.
      setSummary(s && typeof s === 'object' ? s : null);
      setTxns(Array.isArray(t) ? t : []);
    } catch (e) { setErr(e.message || 'Could not read the stores position'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // A sale order counts as "material assigned" once anything has been issued to it.
  const issuedBySo = useMemo(() => {
    const m = {};
    (Array.isArray(txns) ? txns : []).forEach((t) => {
      const so = String(t.so || '').trim();
      if (!so) return;
      const delta = t.kind === 'ISSUE' ? num(t.qty) : -num(t.qty);
      m[so] = (m[so] || 0) + delta;
    });
    return m;
  }, [txns]);

  const openRows = useMemo(() => {
    const oab = (mods.oab && mods.oab.OAB) || {};
    const jss = mods.jss || [];
    const rows = [];
    ['SF', 'OT'].forEach((sh) => (oab[sh] || []).forEach((r) => {
      if (r.closed) return;
      const j = findSpecForRow(jss, r);
      rows.push({
        so: r.so, spec: r.spec, customer: (j && j.customer) || r.customer || '',
        sku: (j && j.jobName) || r.jobName || '', poQty: num(r.poQty),
        material: (j && j.material) || '', filmWidth: (j && j.filmWidth) || '',
        issued: issuedBySo[String(r.so || '').trim()] || 0,
      });
    }));
    return rows.sort((a, b) => String(b.so).localeCompare(String(a.so), undefined, { numeric: true }));
  }, [mods.oab, mods.jss, issuedBySo]);

  const assigned = openRows.filter((r) => r.issued > 0);
  const waiting = openRows.filter((r) => r.issued <= 0);

  const byStatus = (summary && summary.byStatus) || {};
  const valueOf = (k) => num(byStatus[k] && byStatus[k].value);

  return (
    <>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Stock value by disposition</div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={load}>↻ Refresh</button>
        </div>
        {err && <div className="al al-r">{err}</div>}
        <div className="stats">
          {CARDS.map((c) => (
            <div className="stat" key={c.k}>
              <div className="sl">{c.label}</div>
              <div className="sv" style={{ color: c.color }}>{inr(Math.round(valueOf(c.k)))}</div>
              <div style={{ fontSize: 10, color: 'var(--i3)' }}>
                {num(byStatus[c.k] && byStatus[c.k].units)} unit(s) · {num(byStatus[c.k] && byStatus[c.k].qty).toLocaleString('en-IN')} qty
              </div>
            </div>
          ))}
          <div className="stat">
            <div className="sl">Total on hand</div>
            <div className="sv">{inr(Math.round(num(summary && summary.totalValue)))}</div>
            <div style={{ fontSize: 10, color: 'var(--i3)' }}>priced at the receiving invoice</div>
          </div>
        </div>
        <div className="pg-sub" style={{ marginBottom: 0 }}>
          Every roll the stores desk receives carries its own status; this is the money standing behind each of them.
        </div>
      </div>

      <div className="card">
        <div className="ctitle">Open sale orders <strong>waiting for material</strong> <span className="tag tr">{waiting.length}</span></div>
        <div className="pg-sub" style={{ marginTop: 0 }}>Nothing has been issued from stores against these orders yet.</div>
        <SoTable rows={waiting} empty="Every open order has material issued against it." />
      </div>

      <div className="card">
        <div className="ctitle">Open sale orders with <strong>material assigned</strong> <span className="tag tg">{assigned.length}</span></div>
        <SoTable rows={assigned} empty="No material has been issued to any open order yet." showIssued />
      </div>
    </>
  );
}

function SoTable({ rows, empty, showIssued }) {
  return (
    <div className="tw sy" style={{ maxHeight: 260 }}>
      <table>
        <thead><tr>
          <th>Sale Order</th><th>Spec</th><th style={{ minWidth: 170 }}>SKU</th><th>Customer</th>
          <th>Material</th><th style={{ textAlign: 'right' }}>Film W</th><th style={{ textAlign: 'right' }}>PO Qty</th>
          {showIssued ? <th style={{ textAlign: 'right' }}>Issued</th> : null}
        </tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={showIssued ? 8 : 7} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>{empty}</td></tr>
          ) : rows.map((r) => (
            <tr key={r.so}>
              <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
              <td><span className="tag tb" style={{ fontSize: 9 }}>{r.spec}</span></td>
              <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{r.sku || '—'}</td>
              <td style={{ fontSize: 11 }}>{r.customer || '—'}</td>
              <td style={{ fontSize: 11 }}>{r.material || '—'}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--blu)' }}>{r.filmWidth || '—'}</td>
              <td style={{ textAlign: 'right' }}>{r.poQty.toLocaleString('en-IN')}</td>
              {showIssued ? <td style={{ textAlign: 'right', color: 'var(--g)', fontWeight: 700 }}>{r.issued.toLocaleString('en-IN')}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
