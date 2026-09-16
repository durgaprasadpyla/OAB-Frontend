import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../data.jsx';
import { fmtDate, inr } from '../lib/format.js';
import { getPM } from '../lib/pricing.js';
import { pendingRepPos } from '../lib/repFlow.js';
import { repName } from '../lib/sales.js';

// Sales Login §71-§75 — "SUPERSTAR OAB Entry Pending PAGE": the POs the sales reps
// have entered, waiting to be put on the OAB as sale orders. Pick one, press Add to
// OAB, and the Add SO wizard opens with the customer, PO number, PO date, despatch
// location and the SKUs (their JSS, quantity and price) filled in; the PO is marked
// as pushed when the sale orders are created.

export default function PoToSo() {
  const { mods } = useData();
  const nav = useNavigate();
  const sales = mods.sales || {};
  const prices = mods.prices || {};
  const [pick, setPick] = useState('');
  const [q, setQ] = useState('');
  const pending = useMemo(() => pendingRepPos(sales), [sales]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? pending.filter((p) => [p.po_number, p.customer, p.despatch_location].some((v) => String(v || '').toLowerCase().includes(t))) : pending;
  }, [pending, q]);
  const picked = pending.find((p) => p.key === pick) || null;

  function addToOab() {
    if (!picked) return;
    nav('/po', {
      state: {
        repPo: {
          key: picked.key, poNum: picked.po_number, poDate: picked.date, customer: picked.customer, loc: picked.despatch_location,
          lineIds: picked.lines.map((l) => l.id),
          lines: picked.lines.map((l) => ({ spec: l.jss_spec, sku: l.sku_name, qty: l.qty, price: l.price })),
        },
      },
    });
  }

  return (
    <div id="app">
      <div className="pg-ttl">🧾 PO → SO — OAB entry pending</div>
      <div className="pg-sub">
        Purchase orders the sales reps have entered against accepted quotations, waiting to be entered on the OAB. Select one and press
        <b> Add to OAB</b>: the Add SO page opens pre-filled — customer, PO number and date, despatch location, SKUs with their JSS,
        quantity and the PO price beside the Price Master price.
      </div>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Pending POs <span className="tag tgr">{rows.length}</span></div>
          <input placeholder="Search PO / customer / location…" value={q} aria-label="Search pending POs" onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
          <span style={{ flex: 1 }} />
          <button className="btn btn-g" onClick={addToOab} disabled={!picked} aria-label="Add to OAB">➕ Add to OAB</button>
        </div>
        <div className="tw sy" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <table>
            <thead><tr>
              <th style={{ width: 30 }}></th><th>PO #</th><th>PO date</th><th>Customer</th><th>Despatch location</th><th>Sales rep</th><th>SKUs (JSS)</th>
              <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>PO value</th><th>Entered</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>Nothing pending — every PO from the sales reps is on the OAB.</td></tr>
                : rows.map((p) => {
                  const qty = p.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
                  const value = p.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
                  return (
                    <tr key={p.key} className={pick === p.key ? 'hi' : undefined}>
                      <td style={{ textAlign: 'center' }}><input type="radio" name="po-to-so" checked={pick === p.key} aria-label={`Select PO ${p.po_number}`} onChange={() => setPick(p.key)} /></td>
                      <td style={{ fontWeight: 700 }}>{p.po_number || '—'}</td>
                      <td style={{ fontSize: 11 }}>{p.date ? fmtDate(p.date) : '—'}</td>
                      <td style={{ fontWeight: 600 }}>{p.customer || '—'}</td>
                      <td style={{ fontSize: 11 }}>{p.despatch_location || '—'}</td>
                      <td style={{ fontSize: 11 }}>{repName(sales.sales_users, p.created_by)}</td>
                      <td style={{ fontSize: 11 }}>
                        {p.lines.map((l) => {
                          const pm = Number(getPM(l.jss_spec, prices).price) || 0;
                          return (
                            <div key={l.id}>
                              {l.sku_name} <span style={{ fontFamily: 'monospace', color: 'var(--blu)' }}>{l.jss_spec || 'no JSS'}</span> · {inr(l.qty)} @ ₹{inr(l.price, 2)}
                              {pm ? <span style={{ color: 'var(--i3)' }}> (Price Master ₹{inr(pm, 2)})</span> : null}
                            </div>
                          );
                        })}
                      </td>
                      <td style={{ textAlign: 'right' }}>{inr(qty)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>₹{inr(value)}</td>
                      <td style={{ fontSize: 11 }}>{p.created_at ? fmtDate(String(p.created_at).slice(0, 10)) : '—'}</td>
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
