import { useMemo } from 'react';
import { inr } from '../lib/format.js';
import { allRepTargets, targetAchieved, progressColor, PERIOD_LABEL } from '../lib/salesTargets.js';

// 🎯 My Targets — read-only for the rep; the sales admin sets them.
// Progress is computed live from the rep's own POs, so it moves as they book work.
// Ported from repTargets / repTargetAchieved.

/** A slim progress bar with its percentage beside it. */
function Bar({ pct }) {
  return (
    <>
      <div style={{ background: '#eee', borderRadius: 6, height: 10, width: 90, display: 'inline-block', overflow: 'hidden', verticalAlign: 'middle' }}>
        <div style={{ background: progressColor(pct), height: '100%', width: Math.min(100, pct) + '%' }} />
      </div>{' '}
      <span style={{ fontSize: 10, color: 'var(--i3)' }}>{pct}%</span>
    </>
  );
}

export default function RepTargetsTab({ sales, repId }) {
  // Group by period so a rep sees "August", "Q3", "2026" as separate blocks.
  const groups = useMemo(() => {
    const by = new Map();
    allRepTargets(sales.targets, repId).forEach((t) => {
      const k = t.period_type + '|' + t.period_key;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(t);
    });
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sales.targets, repId]);

  if (!groups.length) {
    return (
      <div className="card">
        <div className="ctitle">🎯 My Targets</div>
        <div className="pg-sub" style={{ margin: 0 }}>No targets have been set for you yet. Your sales admin sets these.</div>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="ctitle" style={{ marginBottom: 4 }}>🎯 My Targets</div>
        <div className="pg-sub" style={{ margin: 0 }}>Set by your sales admin. Progress updates as you enter POs.</div>
      </div>

      {groups.map(([key, list]) => {
        const [ptype, pkey] = key.split('|');
        return (
          <div className="card" key={key}>
            <div className="ctitle" style={{ color: 'var(--blu)' }}>{PERIOD_LABEL[ptype] || ptype} — {pkey}</div>
            <div className="tw">
              <table>
                <thead><tr>
                  <th>Target Scope</th><th style={{ textAlign: 'right' }}>Target</th>
                  <th style={{ textAlign: 'right' }}>Achieved</th><th>Progress</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {list.map((t) => {
                    const ach = targetAchieved(sales.pos, sales.skus, repId, ptype, pkey, t.dim, t.key);
                    const pct = Number(t.amount) > 0 ? Math.round((ach / Number(t.amount)) * 100) : 0;
                    return (
                      <tr key={t.id}>
                        <td>{t.dim === 'category' ? '📦' : '🚚'} {t.key}</td>
                        <td style={{ textAlign: 'right' }}>₹{inr(t.amount)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--g)' }}>₹{inr(ach)}</td>
                        <td><Bar pct={pct} /></td>
                        <td>
                          {pct >= 100
                            ? <span className="tag tg" style={{ fontSize: 10 }}>🙌 High five! +{pct - 100}%</span>
                            : <span className="tag tr" style={{ fontSize: 10 }}>⚠ Short by {100 - pct}%</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

export { Bar as TargetBar };
