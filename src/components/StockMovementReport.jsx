import { useCallback, useEffect, useMemo, useState } from 'react';
import { stockCountApi } from '../lib/stockCountApi.js';
import { exportSheets } from '../lib/xlsx.js';
import { fmtDate, today } from '../lib/format.js';
import { V2Panel, V2Badge } from './V2Ui.jsx';
import '../v2-stores.css';

// BloomFlex V2 — stock movement by reporting period: per item, opening + GRN receipts
// − issues + returns = closing, both dates inclusive. Read off the stores ledger, so
// a period ending today closes at the live on-hand stock.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const qty = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const r3 = (v) => Math.round(num(v) * 1000) / 1000;

export function daysAgo(n, from = today()) {
  const d = new Date(from + 'T00:00:00');
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function StockMovementReport() {
  const [from, setFrom] = useState(() => daysAgo(7));
  const [to, setTo] = useState(() => today());
  const [search, setSearch] = useState('');
  const [hideIdle, setHideIdle] = useState(true);
  const [data, setData] = useState({ items: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async (f, t) => {
    if (f && t && f > t) { setErr('"From" must be on or before "To".'); return; }
    setBusy(true); setErr('');
    try { setData((await stockCountApi.movement({ from: f, to: t })) || { items: [] }); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(from, to); }, [load]);

  const rows = useMemo(() => {
    const f = search.trim().toLowerCase();
    return (data.items || [])
      .filter((r) => !hideIdle || num(r.opening) || num(r.receipts) || num(r.issues) || num(r.returns) || num(r.closing))
      .filter((r) => !f || String(r.code || '').toLowerCase().includes(f) || String(r.name || '').toLowerCase().includes(f));
  }, [data, search, hideIdle]);

  function exportXlsx() {
    try {
      const header = ['Item Code', 'Description', 'UOM', 'Opening', 'Receipts (GRN)', 'Issues', 'Returns', 'Closing'];
      const body = rows.map((r) => [r.code, r.name, r.uom, r3(r.opening), r3(r.receipts), r3(r.issues), r3(r.returns), r3(r.closing)]);
      exportSheets([{ name: 'Stock movement', rows: [[`Stock movement ${fmtDate(data.from || from)} to ${fmtDate(data.to || to)} (inclusive)`], [], header, ...body],
        widths: [12, 36, 7, 12, 14, 12, 12, 12] }], `Stock_Movement_${data.from || from}_to_${data.to || to}.xlsx`);
    } catch (e) { setErr(e.message); }
  }

  // BloomFlex V2: the prototype's "Stock movement by reporting period" panel.
  return (
    <V2Panel title="Stock movement by reporting period"
      right={<V2Badge tone="blue">Opening + GRN − issue + return</V2Badge>}>
      <div className="v2-pad">
        <div className="fbar" style={{ marginBottom: 0, alignItems: 'flex-end' }}>
          <div className="fg" style={{ marginBottom: 0 }}><label>From (inclusive)</label>
            <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="fg" style={{ marginBottom: 0 }}><label>To (inclusive)</label>
            <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="btn btn-g" disabled={busy} onClick={() => load(from, to)}>Apply</button>
          <input placeholder="Search item code / name" aria-label="Search movement items" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="cb" style={{ fontSize: 12 }}><input type="checkbox" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} /> Hide items with no stock or movement</label>
          <div className="fbar-actions">
            <button className="btn btn-s" disabled={!rows.length} onClick={exportXlsx}>⬇ Excel</button>
          </div>
        </div>
        {err && <div className="al al-r" style={{ marginTop: 10, marginBottom: 0 }}>{err}</div>}
      </div>
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 380px)' }}>
        <table aria-label="Stock movement">
          <thead><tr>
            <th>Item</th><th className="v2-num">Opening</th><th className="v2-num">Receipts</th>
            <th className="v2-num">Issues</th><th className="v2-num">Returns</th>
            <th className="v2-num">Closing</th><th>UOM</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="v2-empty">{busy ? 'Loading…' : 'No movement in this period'}</td></tr>
            ) : rows.map((r) => (
              <tr key={r.itemId}>
                <td style={{ whiteSpace: 'normal' }}>
                  <b style={{ fontFamily: 'monospace' }}>{r.code}</b>
                  <div style={{ fontSize: 11, color: 'var(--v2-muted)' }}>{r.name || ''}</div>
                </td>
                <td className="v2-num">{qty(r.opening)}</td>
                <td className="v2-num">{qty(r.receipts)}</td>
                <td className="v2-num">{qty(r.issues)}</td>
                <td className="v2-num">{qty(r.returns)}</td>
                <td className="v2-num" style={{ fontWeight: 700 }}>{qty(r.closing)}</td>
                <td style={{ fontSize: 11 }}>{r.uom || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </V2Panel>
  );
}
