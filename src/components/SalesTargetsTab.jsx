import { useMemo, useState } from 'react';
import { inr } from '../lib/format.js';
import { activeReps, salesUid } from '../lib/sales.js';
import {
  PERIOD_TYPES, currentPeriod, periodOptions, repTargets, targetAchieved,
  upsertTarget, deleteTarget, progressColor, targetCategories, targetDespatchForms,
} from '../lib/salesTargets.js';

// 🎯 Targets — set by the sales admin, per rep, per period, per dimension.
//
// A target is NOT one monthly number: it is set separately by CATEGORY and by
// DISPATCH FORM, and a sale booked on a SKU deducts from both, because the SKU
// carries both. Achievement is derived from the rep's POs, never stored.
//
// Ported from sdashTargetsTab / sdashOpenTargets / sdashRenderTargets /
// sdashAddTarget / sdashDelTarget.

function Bar({ pct, width = 90 }) {
  return (
    <>
      <div style={{ background: '#eee', borderRadius: 6, height: 10, width, display: 'inline-block', overflow: 'hidden', verticalAlign: 'middle' }}>
        <div style={{ background: progressColor(pct), height: '100%', width: Math.min(100, pct) + '%' }} />
      </div>{' '}
      <span style={{ fontSize: 10, color: 'var(--i3)' }}>{pct}%</span>
    </>
  );
}

/** One dimension's target table plus its add row. (mkTargetTable) */
function DimTable({ dim, label, options, sales, repId, ptype, pkey, onAdd, onDelete, busy }) {
  const [key, setKey] = useState('');
  const [amount, setAmount] = useState('');
  const list = repTargets(sales.targets, repId, ptype, pkey).filter((t) => t.dim === dim);

  function add() {
    if (!key || !Number(amount)) return;
    onAdd(dim, key, Number(amount));
    setKey(''); setAmount('');
  }

  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--blu)', margin: '14px 0 6px' }}>{label}</div>
      <div className="fbar">
        <select value={key} aria-label={`New ${label}`} onChange={(e) => setKey(e.target.value)}>
          <option value="">-- Select {dim === 'category' ? 'category' : 'dispatch form'} --</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input
          type="number" min="0" value={amount} placeholder="Target ₹" aria-label={`${label} amount`}
          onChange={(e) => setAmount(e.target.value)} style={{ width: 140 }}
        />
        <button className="btn btn-g" style={{ height: 30, fontSize: 12 }} onClick={add} disabled={busy}>+ Add</button>
      </div>
      <div className="tw">
        <table>
          <thead><tr>
            <th>Category / Form</th><th style={{ textAlign: 'right' }}>Target</th>
            <th style={{ textAlign: 'right' }}>Achieved</th><th style={{ textAlign: 'right' }}>Remaining</th>
            <th>Progress</th><th style={{ textAlign: 'center' }} />
          </tr></thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No {label.toLowerCase()} set</td></tr>
            ) : list.map((t) => {
              const ach = targetAchieved(sales.pos, sales.skus, repId, ptype, pkey, dim, t.key);
              const pct = Number(t.amount) > 0 ? Math.round((ach / Number(t.amount)) * 100) : 0;
              return (
                <tr key={t.id}>
                  <td style={{ fontWeight: 700 }}>{t.key}</td>
                  <td style={{ textAlign: 'right' }}>₹{inr(t.amount)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--g)' }}>₹{inr(ach)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--red)' }}>₹{inr(Math.max(0, Number(t.amount) - ach))}</td>
                  <td><Bar pct={pct} /></td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 8px', color: 'var(--red)' }}
                      aria-label={`Remove target ${t.key}`} onClick={() => onDelete(t.id)} disabled={busy}
                    >✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function SalesTargetsTab({ sales, patch }) {
  const [repId, setRepId] = useState(null);
  const [ptype, setPtype] = useState('month');
  const [pkey, setPkey] = useState(() => currentPeriod('month'));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const reps = activeReps(sales.sales_users);
  const ym = currentPeriod('month');
  const rep = reps.find((r) => r.id === repId) || null;
  const periods = useMemo(() => periodOptions(ptype), [ptype]);

  function pickType(v) { setPtype(v); setPkey(currentPeriod(v)); }
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  async function addTarget(dim, key, amount) {
    setBusy(true);
    try {
      await patch({ targets: upsertTarget(sales.targets, { repId, ptype, pkey, dim, key, amount }, { uid: salesUid }) });
      flash('g', '✅ Target saved.');
    } catch (e) { flash('r', 'Save failed: ' + (e.message || e)); } finally { setBusy(false); }
  }

  async function removeTarget(id) {
    setBusy(true);
    try { await patch({ targets: deleteTarget(sales.targets, id) }); }
    catch (e) { flash('r', 'Delete failed: ' + (e.message || e)); } finally { setBusy(false); }
  }

  // This-month roll-up across reps: their dimensioned targets summed.
  const monthRows = reps.map((r) => {
    const ts = repTargets(sales.targets, r.id, 'month', ym);
    if (!ts.length) return null;
    const target = ts.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const achieved = ts.reduce((s, t) => s + targetAchieved(sales.pos, sales.skus, r.id, 'month', ym, t.dim, t.key), 0);
    return { r, target, achieved, pct: target > 0 ? Math.round((achieved / target) * 100) : 0 };
  }).filter(Boolean);

  return (
    <>
      <div className="card">
        <div className="ctitle" style={{ marginBottom: 4 }}>🎯 Targets</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Pick a rep to set monthly / quarterly / half-yearly / annual targets by category and by dispatch form.
          A sale deducts from both its category and dispatch-form targets.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {reps.length === 0 ? <span className="pg-sub" style={{ margin: 0 }}>No active reps</span> : reps.map((r) => (
            <button
              key={r.id} className={'btn btn-s' + (repId === r.id ? ' on' : '')} style={{ height: 30, fontSize: 12 }}
              onClick={() => setRepId(r.id)}
            >🎯 {r.display_name}</button>
          ))}
        </div>
      </div>

      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <div className="card">
        <div className="ctitle">This month ({ym}) — total progress by rep</div>
        <div className="tw">
          <table>
            <thead><tr><th>Rep</th><th style={{ textAlign: 'right' }}>Target</th><th style={{ textAlign: 'right' }}>Achieved</th><th>Progress</th></tr></thead>
            <tbody>
              {monthRows.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No monthly targets set yet</td></tr>
              ) : monthRows.map(({ r, target, achieved, pct }) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 700 }}>{r.display_name}</td>
                  <td style={{ textAlign: 'right' }}>₹{inr(target)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--g)' }}>₹{inr(achieved)}</td>
                  <td><Bar pct={pct} width={100} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {rep && (
        <div className="card">
          <div className="fbar">
            <div className="ctitle" style={{ margin: 0, color: 'var(--g)' }}>🎯 Targets — {rep.display_name || rep.username}</div>
            <span style={{ flex: 1 }} />
            <button className="btn btn-s" style={{ height: 26, fontSize: 12 }} onClick={() => setRepId(null)}>✕ Close</button>
          </div>
          <div className="fbar">
            <select value={ptype} aria-label="Period type" onChange={(e) => pickType(e.target.value)}>
              {PERIOD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={pkey} aria-label="Period" onChange={(e) => setPkey(e.target.value)}>
              {periods.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="pg-sub" style={{ marginTop: 0 }}>
            Set targets by category and by dispatch form independently. A sale booked on an SKU counts toward both
            its category target and its dispatch-form target.
          </div>
          <DimTable
            dim="category" label="Category Targets" options={targetCategories()}
            sales={sales} repId={repId} ptype={ptype} pkey={pkey}
            onAdd={addTarget} onDelete={removeTarget} busy={busy}
          />
          <DimTable
            dim="despatch" label="Dispatch-Form Targets" options={targetDespatchForms()}
            sales={sales} repId={repId} ptype={ptype} pkey={pkey}
            onAdd={addTarget} onDelete={removeTarget} busy={busy}
          />
        </div>
      )}
    </>
  );
}
