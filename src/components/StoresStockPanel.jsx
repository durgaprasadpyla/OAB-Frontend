import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { storesApi } from '../api.js';
import { inr } from '../lib/format.js';
import { findSpecForRow } from '../lib/master.js';
import { bomMaterialForSO, plannedBomMap } from '../lib/bom.js';
import { codeKey } from '../lib/soMaterial.js';
import { bomApi } from '../api.js';

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

/**
 * How far one order's BOM is covered: how many lines are covered, out of how many the
 * BOM asks for, and whether every one of them is satisfied. `allocated` is what the
 * order HAS of each item (code, upper-cased) — allocated plus issued net of returns.
 *
 * An order with no BOM cannot be "complete" — there is nothing to measure it against
 * — so it reports no lines and stays out of the completed list.
 */
function allocationOf(bom, row, allocated) {
  const need = bomMaterialForSO(bom, row.spec, num(row.poQty));
  // an item the BOM uses in two departments is one requirement, summed
  const req = new Map();
  need.filter((m) => m.itemCode && m.required > 0)
    .forEach((m) => req.set(codeKey(m.itemCode), (req.get(codeKey(m.itemCode)) || 0) + m.required));
  const lines = [...req.entries()].map(([itemCode, required]) => ({ itemCode, required }));
  if (!lines.length) {
    const any = Object.keys(allocated).length;
    return { allocLines: any, allocNeed: 0, allocDone: false };
  }
  const covered = lines.filter((m) => num(allocated[m.itemCode]) >= m.required - 1e-6).length;
  return {
    allocLines: Object.keys(allocated).length ? covered || Object.keys(allocated).length : 0,
    allocNeed: lines.length,
    allocDone: covered === lines.length,
  };
}

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
  // 28.09 §Super Admin: "for all those sale orders for which the allocation of
  // material is completed according to the BOM in the Plan Login, they should be
  // listed here." Material is ALLOCATED in PLAN long before the stores desk issues
  // it — reading only the issue ledger left this list empty through the whole
  // planning stage, which is exactly when the Super Admin needs to see it.
  const [allocs, setAllocs] = useState([]);
  const [bom, setBom] = useState({});
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, t, a, b] = await Promise.all([
        storesApi.summary(),
        // 30.09: the whole ledger (the server honours up to 20,000) — what each order
        // has been issued is summed from it below, rather than asked for order by order
        storesApi.txns({ limit: 20000 }),
        storesApi.allocations().catch(() => []),
        bomApi.list().catch(() => []),
      ]);
      setAllocs(Array.isArray(a) ? a : []);
      setBom(plannedBomMap(Array.isArray(b) ? b : []));
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

  /**
   * What each sale order HAS of each item: what is allocated to it (by PLAN or the
   * stores desk) plus what has been issued to it, net of what came back.
   *
   * Issues as on 30.09: counting the holds alone, a fully ISSUED order dropped back to
   * "not fully allocated" — the stores desk deletes a hold as it issues the roll. The
   * issues and returns come off the ledger already loaded here (no request per order).
   * A return is taken off the ISSUE line's item: a slit roll comes back under the code
   * of its narrower width, but it is the issued item that came back.
   */
  const allocBySo = useMemo(() => {
    const m = {};
    const add = (so0, code0, q) => {
      const so = String(so0 || '').trim();
      const code = codeKey(code0);
      if (!so || !code) return;
      if (!m[so]) m[so] = {};
      m[so][code] = (m[so][code] || 0) + q;
    };
    (Array.isArray(allocs) ? allocs : []).forEach((a) => add(a.so, a.itemCode, num(a.qty)));
    const list = Array.isArray(txns) ? txns : [];
    const issueById = new Map(list.filter((t) => t.kind === 'ISSUE').map((t) => [String(t.id), t]));
    list.forEach((t) => {
      if (t.kind === 'ISSUE') { add(t.so, t.itemCode, num(t.qty)); return; }
      if (t.kind !== 'RETURN') return;
      const parent = t.issueTxnId != null ? issueById.get(String(t.issueTxnId)) : null;
      if (parent) add(parent.so, parent.itemCode, -num(t.qty));
      else add(t.so, t.itemCode, -num(t.qty));
    });
    return m;
  }, [allocs, txns]);

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
        ...allocationOf(bom, r, allocBySo[String(r.so || '').trim()] || {}),
      });
    }));
    return rows.sort((a, b) => String(b.so).localeCompare(String(a.so), undefined, { numeric: true }));
  }, [mods.oab, mods.jss, issuedBySo, allocBySo, bom]);

  // An order has material behind it once PLAN has reserved any of it, or the stores
  // desk has issued any of it. Complete allocations are listed first — those are the
  // orders that can actually run.
  const assigned = openRows.filter((r) => r.issued > 0 || r.allocLines > 0)
    .sort((a, b) => (b.allocDone ? 1 : 0) - (a.allocDone ? 1 : 0));
  const waiting = openRows.filter((r) => r.issued <= 0 && r.allocLines === 0);

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
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Allocated against the order’s BOM (in the PLAN login or by the stores desk), or already issued from stores.
          A BOM line counts once what is allocated plus what is issued (net of returns) reaches what the BOM needs
          for the whole order. Orders whose BOM is <b>fully</b> allocated are listed first — those are the ones that can run.
        </div>
        <SoTable rows={assigned} empty="No material has been allocated or issued to any open order yet." showIssued />
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
          {showIssued ? <><th style={{ textAlign: 'right' }}>Issued</th><th>Allocation</th></> : null}
        </tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={showIssued ? 9 : 7} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>{empty}</td></tr>
          ) : rows.map((r) => (
            <tr key={r.so}>
              <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
              <td><span className="tag tb" style={{ fontSize: 9 }}>{r.spec}</span></td>
              <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{r.sku || '—'}</td>
              <td style={{ fontSize: 11 }}>{r.customer || '—'}</td>
              <td style={{ fontSize: 11 }}>{r.material || '—'}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--blu)' }}>{r.filmWidth || '—'}</td>
              <td style={{ textAlign: 'right' }}>{r.poQty.toLocaleString('en-IN')}</td>
              {showIssued ? (
                <>
                  <td style={{ textAlign: 'right', color: 'var(--g)', fontWeight: 700 }}>{r.issued.toLocaleString('en-IN')}</td>
                  <td style={{ fontSize: 11 }}>
                    {r.allocDone
                      ? <span className="tag tg" style={{ fontSize: 9 }}>Fully allocated</span>
                      : r.allocNeed
                        ? <span className="tag ty" style={{ fontSize: 9 }}>{r.allocLines} of {r.allocNeed} BOM line(s)</span>
                        : r.allocLines
                          ? <span className="tag ty" style={{ fontSize: 9 }}>{r.allocLines} item(s) — no BOM to check</span>
                          : <span style={{ color: 'var(--i3)' }}>—</span>}
                  </td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
