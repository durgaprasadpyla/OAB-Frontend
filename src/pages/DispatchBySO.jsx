import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { dash } from '../lib/format.js';
import { getPM } from '../lib/pricing.js';

// Dispatch by Sale Order — every OPEN sale order with ordered qty, dispatched
// (invoiced + manual), balance and ageing since the PO date.
//
// Native port of renderSpecDisp (index.html 4648). Two rules from the original
// worth keeping explicit:
//   • over-dispatched SOs (negative balance) sort to the top and are flagged red
//     — they are the ones needing a correction;
//   • within that, the oldest ageing comes first, so the longest-outstanding
//     orders surface without anyone sorting.
// Closed SOs are excluded entirely.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Whole days from a PO date to today, or null when there is no date. */
export function ageDays(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const t0 = new Date(now);
  t0.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((t0 - d) / 86400000));
}

/** Ageing colour band: red from 45 days, amber from 21. */
export function ageColor(age) {
  if (age == null) return 'var(--i3)';
  return age >= 45 ? '#C0392B' : age >= 21 ? '#B7770D' : 'var(--g)';
}

/** Flatten both sheets into dispatch rows, open orders only. */
export function dispatchRows(oab, now = new Date()) {
  return ['SF', 'OT']
    .flatMap((k) => (Array.isArray(oab && oab[k]) ? oab[k] : []))
    .filter((r) => r && !r.closed)
    .map((r) => {
      const inv = num(r.invDisp);
      const man = num(r.manDisp);
      const ordered = num(r.poQty);
      return {
        so: r.so || '', spec: r.spec || '', jobName: r.jobName || '', customer: r.customer || '',
        poNum: r.poNum || '', poDate: r.poDate || '', age: ageDays(r.poDate, now),
        ordered, inv, man, disp: inv + man, fg: num(r.fg), bal: ordered - (inv + man),
      };
    });
}

/**
 * Filter + sort. The `sort` mode selects the ordering:
 *   'over'   (default) — over-dispatched first, then oldest, then SO (renderSpecDisp);
 *   'newest' / 'oldest' — by PO date, missing dates last;
 *   'value'  — by outstanding value (balance × rate) descending.
 * Over-dispatched rows are always flagged red in the table regardless of the mode.
 */
export function sortDispatchRows(rows, { q = '', overOnly = false, sort = 'over' } = {}) {
  const t = q.trim().toLowerCase();
  const list = rows.filter((r) => {
    if (overOnly && !(r.bal < 0)) return false;
    if (!t) return true;
    return [r.so, r.spec, r.jobName, r.customer, r.poNum].join(' ').toLowerCase().includes(t);
  });
  const bySo = (a, b) => String(a.so).localeCompare(String(b.so), undefined, { numeric: true });
  if (sort === 'newest' || sort === 'oldest') {
    const dir = sort === 'newest' ? -1 : 1;   // newest first = descending PO date
    return list.sort((a, b) => {
      const ad = a.poDate || '';
      const bd = b.poDate || '';
      if (ad !== bd) {
        if (!ad) return 1;        // rows without a PO date sort last
        if (!bd) return -1;
        return ad < bd ? -dir : dir;
      }
      return bySo(a, b);
    });
  }
  if (sort === 'value') {
    return list.sort((a, b) => {
      const av = num(a.value);
      const bv = num(b.value);
      if (bv !== av) return bv - av;   // highest outstanding value first
      return bySo(a, b);
    });
  }
  return list.sort((a, b) => {
    const over = (b.bal < 0 ? 1 : 0) - (a.bal < 0 ? 1 : 0);
    if (over) return over;
    const aa = a.age == null ? -1 : a.age;
    const ba = b.age == null ? -1 : b.age;
    if (ba !== aa) return ba - aa;
    return bySo(a, b);
  });
}

export default function DispatchBySO() {
  const { mods } = useData();
  const [q, setQ] = useState('');
  const [overOnly, setOverOnly] = useState(false);
  const [sort, setSort] = useState('over');

  // Attach the Price Master rate and the outstanding value (balance × rate) so the
  // "By value" sort has something to order on; both default to 0 when a spec has no
  // price, which is harmless for the other sort modes.
  const all = useMemo(() => dispatchRows(mods.oab && mods.oab.OAB).map((r) => {
    const rate = num(getPM(r.spec, mods.prices).price);
    return { ...r, rate, value: r.bal * rate };
  }), [mods.oab, mods.prices]);
  const rows = useMemo(() => sortDispatchRows(all, { q, overOnly, sort }), [all, q, overOnly, sort]);
  const overCount = rows.filter((r) => r.bal < 0).length;

  return (
    <div id="app">
      <div className="pg-ttl">Dispatch by Sale Order</div>
      <div className="pg-sub">
        Every open sale order with ordered qty, dispatched (invoiced + manual), balance and ageing
        (days since the PO date). Over-dispatched SOs are flagged in red; closed SOs are excluded.
      </div>

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Sale Order Dispatch</div>
          <span style={{ flex: 1 }} />
          <input
            type="text" value={q} placeholder="Search SO / spec / job / customer / PO…"
            aria-label="Search sale orders" onChange={(e) => setQ(e.target.value)} style={{ width: 260 }}
          />
          <select value={sort} aria-label="Sort sale orders" onChange={(e) => setSort(e.target.value)} style={{ height: 30 }}>
            <option value="over">Over-dispatched first</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="value">By value (balance × rate)</option>
          </select>
          <label style={{ fontSize: 11, color: 'var(--i2)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="checkbox" checked={overOnly} aria-label="Over-dispatched only" onChange={(e) => setOverOnly(e.target.checked)} />
            Over-dispatched only
          </label>
          <span style={{ fontSize: 11, color: 'var(--i3)' }}>
            {rows.length} SO{rows.length === 1 ? '' : 's'}{overCount ? ` · ${overCount} over-dispatched` : ''}
          </span>
        </div>

        <div className="tw sy" style={{ maxHeight: '62vh' }}>
          <table>
            <thead><tr>
              <th>SO#</th><th>Spec</th><th style={{ minWidth: 150 }}>Job Name</th><th>Customer</th><th>PO#</th>
              <th style={{ textAlign: 'right' }}>Ordered</th><th style={{ textAlign: 'right' }}>Invoiced</th>
              <th style={{ textAlign: 'right' }}>Manual</th><th style={{ textAlign: 'right' }}>Dispatched</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
              <th style={{ textAlign: 'right' }} title="Days since PO date">Age (d)</th>
              <th style={{ textAlign: 'center' }}>Status</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, color: 'var(--i3)' }}>No sale orders match</td></tr>
              ) : rows.map((r) => {
                const over = r.bal < 0;
                return (
                  <tr key={r.so} style={over ? { background: 'var(--redl, #fdecea)' } : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}><span className="so-pill">{r.so}</span></td>
                    <td style={{ fontSize: 11 }}><span className="tag tb" style={{ fontSize: 10 }}>{r.spec}</span></td>
                    <td style={{ fontSize: 11 }}>{r.jobName}</td>
                    <td style={{ fontSize: 11 }}>{r.customer}</td>
                    <td style={{ fontSize: 11 }}>{r.poNum || '-'}</td>
                    <td style={{ textAlign: 'right' }}>{dash(r.ordered)}</td>
                    <td style={{ textAlign: 'right' }}>{dash(r.inv)}</td>
                    <td style={{ textAlign: 'right' }}>{dash(r.man)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{dash(r.disp)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: over ? '#C0392B' : undefined }}>
                      {over ? <>+{dash(-r.bal)} over</> : dash(r.bal)}
                    </td>
                    <td style={{ textAlign: 'right', color: ageColor(r.age), fontWeight: 700 }}>{r.age == null ? '-' : r.age}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {over
                        ? <span style={{ color: '#C0392B', fontWeight: 800 }}>⚠ Over</span>
                        : r.bal > 0
                          ? <span style={{ color: '#B7770D', fontWeight: 700 }}>Pending</span>
                          : <span style={{ color: 'var(--g)', fontWeight: 700 }}>Done</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
