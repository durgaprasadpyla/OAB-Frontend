import { useState, useEffect, useCallback } from 'react';
import { reportsApi } from '../api.js';

// P6: department-wise wastage analysis listed AGAINST EACH SALE ORDER — shown on
// both the PLAN (PlanReadiness) and PPC (PpcDashboard) dashboards. Read-only;
// backed by /api/reports/so-production.

const n1 = (v) => (v == null ? 0 : Math.round(Number(v)));

export default function SoWastagePanel({ from, to }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { const r = await reportsApi.soProduction(from, to); setRows(Array.isArray(r) ? r : []); }
    catch (e) { setErr(e.message || 'Failed to load wastage analysis'); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="ctitle">Wastage by Sale Order &amp; Department</div>
      {err && <div className="al al-r">{err}</div>}
      {rows.length === 0 ? <div className="al al-g">No production recorded in this period.</div> : (
        <div className="tw sy" style={{ maxHeight: 300 }}><table>
          <thead><tr><th>Sale Order</th><th>Department</th><th>Planned</th><th>Actual</th><th>Wastage</th><th>Wastage %</th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const a = Number(r.actualQty || 0), w = Number(r.wastageQty || 0);
            const pct = a + w > 0 ? ((w / (a + w)) * 100).toFixed(1) : null;
            return (
              <tr key={i} className={w > 0 ? 'nr' : undefined}>
                <td><span className="so-pill">{r.so}</span></td>
                <td>{r.department}</td>
                <td>{n1(r.plannedQty)}</td>
                <td>{n1(r.actualQty)}</td>
                <td style={{ fontWeight: 700, color: w > 0 ? 'var(--red)' : undefined }}>{n1(r.wastageQty)}</td>
                <td>{pct == null ? '—' : <span className={'tag ' + (Number(pct) > 5 ? 'tr' : 'ty')}>{pct}%</span>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}
