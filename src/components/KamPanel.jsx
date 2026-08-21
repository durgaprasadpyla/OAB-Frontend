import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { inr } from '../lib/format.js';
import { activeReps } from '../lib/sales.js';
import { kamRows, kamApplyEdits } from '../lib/kam.js';

// Customer KAM & Targets — assign a key account manager, an expected order
// frequency and a monthly target per customer, with this month's achievement
// read live from the OAB board.
//
// Edits are staged locally and written in one save, matching the monolith:
// typing in twenty rows should be one write, not twenty.

export default function KamPanel() {
  const { mods, save } = useData();
  const sales = mods.sales || {};

  const [q, setQ] = useState('');
  const [edits, setEdits] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => kamRows({ customers: mods.customers, sales, oab: mods.oab?.OAB }),
    [mods.customers, sales, mods.oab],
  );
  const reps = activeReps(sales.sales_users);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => [r.customer, r.group, r.kam].some((v) => String(v || '').toLowerCase().includes(t))) : rows;
  }, [rows, q]);

  const dirtyCount = Object.keys(edits).length;
  const valueOf = (r, field, fallback) => {
    const e = edits[r.customer];
    return e && field in e ? e[field] : fallback;
  };
  const stage = (customer, field, value) =>
    setEdits((s) => ({ ...s, [customer]: { ...(s[customer] || {}), [field]: value } }));

  async function saveAll() {
    setBusy(true);
    try {
      await save('sales', (prev) => ({ ...(prev || {}), leads: kamApplyEdits((prev && prev.leads) || [], edits) }));
      setEdits({});
      setMsg({ t: 'g', text: `✅ Saved ${dirtyCount} customer${dirtyCount === 1 ? '' : 's'}.` });
    } catch (e) {
      setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) });
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>🎯 Customer KAM &amp; Targets <span className="tag tgr">{filtered.length}</span></div>
        <input placeholder="Search customer / group / KAM…" value={q} aria-label="Search KAM" onChange={(e) => setQ(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-g" onClick={saveAll} disabled={busy || !dirtyCount}>
          {busy ? 'Saving…' : dirtyCount ? `💾 Save ${dirtyCount}` : '💾 Save'}
        </button>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Achieved is read live from the OAB board, so a sale order entered by ops closes the
        gap on its own. Suggested figures are this customer's own last-three-month average.
      </div>

      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 320px)' }}>
        <table>
          <thead><tr>
            <th style={{ minWidth: 170 }}>Customer</th><th>Group</th><th style={{ minWidth: 140 }}>Primary contact</th>
            <th style={{ width: 160 }}>KAM</th>
            <th style={{ width: 120, textAlign: 'right' }}>Order freq (days)</th>
            <th style={{ width: 130, textAlign: 'right' }}>Monthly target</th>
            <th style={{ width: 120, textAlign: 'right' }}>Achieved</th>
            <th style={{ width: 110, textAlign: 'right' }}>Gap</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No customers match</td></tr>
            ) : filtered.map((r) => {
              const kam = valueOf(r, 'kam', r.kam);
              const freq = valueOf(r, 'order_frequency', r.freq ?? '');
              const target = valueOf(r, 'monthly_target', r.target ?? '');
              const gap = target === '' || target == null ? null : Number(target) - r.achieved;
              return (
                <tr key={r.customer} style={edits[r.customer] ? { background: '#fffaf0' } : undefined}>
                  <td style={{ fontWeight: 600 }}>{r.customer}</td>
                  <td style={{ fontSize: 11 }}>{r.group || '—'}</td>
                  <td style={{ fontSize: 11 }}>
                    {r.contactName || '—'}{r.contactPhone ? <div style={{ color: 'var(--i3)' }}>{r.contactPhone}</div> : null}
                  </td>
                  <td>
                    <select value={kam} aria-label={`KAM for ${r.customer}`} onChange={(e) => stage(r.customer, 'kam', e.target.value)}>
                      <option value="">— Unassigned —</option>
                      {reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.display_name}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number" min="0" step="1" className="kam-numinput" value={freq} style={{ width: '100%', textAlign: 'center' }}
                      placeholder={r.suggestedFreqDays ? String(r.suggestedFreqDays) : ''}
                      aria-label={`Order frequency for ${r.customer}`}
                      onChange={(e) => stage(r.customer, 'order_frequency', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number" min="0" step="1" className="kam-numinput" value={target} style={{ width: '100%', textAlign: 'right' }}
                      placeholder={r.suggestedTarget ? String(Math.round(r.suggestedTarget)) : ''}
                      aria-label={`Monthly target for ${r.customer}`}
                      onChange={(e) => stage(r.customer, 'monthly_target', e.target.value)}
                    />
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{inr(r.achieved)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: gap == null ? 'var(--i3)' : gap > 0 ? 'var(--red)' : 'var(--g)' }}>
                    {gap == null ? '—' : gap > 0 ? inr(gap) : '✓ met'}
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
