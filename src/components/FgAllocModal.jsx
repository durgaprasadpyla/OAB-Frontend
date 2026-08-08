import { useState } from 'react';

// FG drawdown prompt shown after new sale orders are raised for specs that
// already have finished goods in stock (native port of the legacy
// fg-alloc-overlay / fgAllocConfirm). The user enters how much FG to draw for
// each new SO; the draw is validated against the spec's available pool (drawing
// across multiple SOs of the same spec accumulates), then handed to onConfirm
// as [{ so, spec, qty }].

const nfmt = (v) => Math.round(Number(v) || 0).toLocaleString('en-IN');

export default function FgAllocModal({ rows, onConfirm, onCancel, busy }) {
  const [vals, setVals] = useState({});   // { [so]: qtyString }
  const [err, setErr] = useState('');
  const set = (so, v) => setVals((s) => ({ ...s, [so]: v }));

  function confirm() {
    const plan = [];
    const errs = [];
    const availBySpec = {};
    rows.forEach((r) => {
      const q = Number(vals[r.so]) || 0;
      if (q <= 0) return;
      if (!(r.spec in availBySpec)) availBySpec[r.spec] = r.avail;
      if (q > availBySpec[r.spec]) {
        errs.push(`SO ${r.so} (spec ${r.spec}): ${nfmt(q)} requested but only ${nfmt(availBySpec[r.spec])} left`);
        return;
      }
      availBySpec[r.spec] -= q;
      plan.push({ so: r.so, spec: r.spec, qty: q });
    });
    if (errs.length) { setErr(errs.join(' · ')); return; }
    if (!plan.length) { onCancel(); return; }
    onConfirm(plan);
  }

  return (
    <div style={overlay} onClick={busy ? undefined : onCancel}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📦 Use existing Finished Goods for this sale order?</div>
        <p style={{ fontSize: 12, color: 'var(--i3)', marginBottom: 14 }}>
          The spec(s) below already have finished goods in stock. Enter how much FG to use for each new SO (leave 0 to skip).
          FG you use here is deducted from that spec's available pool and reduces the SO's balance.
        </p>
        <div className="tw sy">
          <table>
            <thead><tr><th>SO #</th><th>Spec</th><th style={{ minWidth: 150 }}>SKU / Job Name</th><th style={{ textAlign: 'right' }}>Available FG</th><th style={{ width: 130 }}>Use for this SO</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.so}>
                  <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
                  <td><span className="tag tb">{r.spec || '-'}</span></td>
                  <td style={{ fontSize: 11 }}>{r.jobName || '-'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--g)' }}>{nfmt(r.avail)}</td>
                  <td>
                    <input type="number" min="0" max={r.avail} value={vals[r.so] ?? ''} placeholder="0"
                      onFocus={(e) => e.target.select()} onChange={(e) => set(r.so, e.target.value)} style={{ width: '100%' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {err && <div className="al al-r" style={{ margin: '8px 0' }}>⛔ {err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn btn-s" onClick={onCancel} disabled={busy}>Skip — don't use FG</button>
          <button className="btn btn-g" onClick={confirm} disabled={busy}>{busy ? 'Applying…' : '✓ Use FG'}</button>
        </div>
      </div>
    </div>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 9600, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '32px 12px' };
const sheet = { background: 'var(--wh)', borderRadius: 12, maxWidth: 660, width: '100%', padding: '20px 22px', boxShadow: '0 20px 60px rgba(0,0,0,.3)', margin: 'auto' };
