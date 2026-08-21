import { useMemo, useState } from 'react';
import { fmtDate, inr } from '../lib/format.js';
import { activeReps, repName } from '../lib/sales.js';
import { dailyRows } from '../lib/salesAdmin.js';

// 📋 Daily Updates — every rep's activity, in one log. Ported from sdashDaily /
// sdashDailyFilter. Capped at 200 rows, as production caps it.

export default function SalesDailyTab({ sales }) {
  const [rep, setRep] = useState('');
  const [q, setQ] = useState('');
  const reps = activeReps(sales.sales_users);
  const rows = useMemo(() => dailyRows(sales, { repId: rep, q }), [sales, rep, q]);

  return (
    <div className="card">
      <div className="ctitle">📋 Daily Updates — Activity Log</div>
      <div className="fbar">
        <select value={rep} aria-label="Filter by rep" onChange={(e) => setRep(e.target.value)}>
          <option value="">All Reps</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
        </select>
        <input
          value={q} placeholder="Search company / type / notes..." aria-label="Search activity"
          onChange={(e) => setQ(e.target.value)} style={{ width: 220 }}
        />
        <span style={{ fontSize: 11, color: 'var(--i3)' }}>{rows.length} entr{rows.length === 1 ? 'y' : 'ies'}</span>
      </div>
      <div className="tw sy">
        <table>
          <thead><tr>
            <th>Date</th><th>Rep</th><th>Customer</th><th>Type</th><th>Outcome / Notes</th>
            <th style={{ textAlign: 'right' }}>Expense</th><th>Follow-up</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No activity found</td></tr>
            ) : rows.map(({ i, lead }) => (
              <tr key={i.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.date)}</td>
                <td style={{ fontWeight: 600 }}>{repName(sales.sales_users, i.created_by)}</td>
                <td>{lead ? lead.client_name : '—'}</td>
                <td>{i.type || '—'}</td>
                <td style={{ color: 'var(--i2)' }}>{i.outcome || i.reason || '—'}</td>
                <td style={{ textAlign: 'right', color: '#d2691e', whiteSpace: 'nowrap' }}>{i.expense ? '₹' + inr(i.expense) : '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{i.follow_up_date ? fmtDate(i.follow_up_date) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
