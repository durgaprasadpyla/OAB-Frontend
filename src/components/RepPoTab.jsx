import { useMemo, useState } from 'react';
import { fmtDate, inr } from '../lib/format.js';
import { salesToday } from '../lib/sales.js';
import { skuReadyForPO, skusForRep, buildPo, acceptedMinPrice, poValue } from '../lib/repPortal.js';

// 🧾 Enter PO — a rep books a customer order against one of their own SKUs.
// Ported from repPO / repPOOnSku / repSavePO.
//
// Only SKUs cleared through CSA + quotation appear in the picker, and the price is
// checked against the accepted slab for the ordered quantity, so a rep cannot quietly
// discount below what was agreed.

export default function RepPoTab({ leads, sales, save, repId }) {
  const [form, setForm] = useState({ skuId: '', poNumber: '', date: salesToday(), qty: '', price: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 5000); };

  const leadName = (id) => (leads.find((l) => l.id === id) || {}).client_name || '—';
  const mySkus = useMemo(() => skusForRep(sales, repId), [sales, repId]);
  const readySkus = useMemo(() => mySkus.filter((s) => skuReadyForPO(sales, s)), [mySkus, sales]);
  const chosen = mySkus.find((s) => s.id === form.skuId) || null;

  const myPos = useMemo(() => (sales.pos || [])
    .filter((p) => p.created_by === repId)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 50), [sales.pos, repId]);

  async function savePo() {
    let po;
    try { po = buildPo({ sku: chosen, ...form }, sales, repId); }
    catch (e) { flash('r', e.message); return; }
    setBusy(true);
    try {
      await save('sales', (prev) => ({ ...(prev || {}), pos: [...((prev && prev.pos) || []), po] }));
      setForm({ skuId: '', poNumber: '', date: salesToday(), qty: '', price: '' });
      flash('g', '✓ PO saved. It now counts toward your category and dispatch targets.');
    } catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
  }

  const minPrice = chosen ? acceptedMinPrice(chosen, Number(form.qty) || 0) : null;

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <div className="card">
        <div className="ctitle" style={{ marginBottom: 4 }}>🧾 Enter Purchase Order</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Only SKUs cleared through CSA + quotation show here. The PO price is validated against the accepted
          quotation price for the ordered quantity.
        </div>

        {!readySkus.length && (
          <div className="al al-y">
            ⚠ No SKUs are ready for a PO yet. A SKU needs <b>CSA received</b>, <b>Quotation received</b> and
            <b> Quotation accepted</b> toggled green (in the SKUs tab) before you can book a PO against it.
          </div>
        )}

        <div className="g2">
          <div className="fg" style={{ gridColumn: '1/-1' }}><label>SKU *</label>
            <select value={form.skuId} aria-label="SKU" onChange={(e) => set({ skuId: e.target.value })}>
              <option value="">-- Select a PO-ready SKU --</option>
              {readySkus.map((s) => (
                <option key={s.id} value={s.id}>
                  {leadName(s.lead_id)} — {s.sku_name} ({s.category || ''} / {s.dispatch_form || s.dispatch_type || ''})
                </option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--blu)', marginTop: 4 }}>
              {chosen && chosen.price_tiers && chosen.price_tiers.length
                ? 'Accepted price: ' + chosen.price_tiers.map((t) => `₹${t.price} for ${t.qty} kg`).join(', ')
                : chosen
                  ? <span style={{ color: '#c9a100' }}>No accepted price tiers set for this SKU — set them in the SKUs tab.</span>
                  : ''}
            </div>
          </div>
          <div className="fg"><label>PO Number</label>
            <input value={form.poNumber} aria-label="PO Number" onChange={(e) => set({ poNumber: e.target.value })} />
          </div>
          <div className="fg"><label>PO Date</label>
            <input type="date" value={form.date} aria-label="PO Date" onChange={(e) => set({ date: e.target.value })} />
          </div>
          <div className="fg"><label>Quantity *</label>
            <input type="number" min="0" value={form.qty} aria-label="Quantity" onChange={(e) => set({ qty: e.target.value })} />
          </div>
          <div className="fg"><label>Price / unit ₹ *</label>
            <input type="number" min="0" step="0.01" value={form.price} aria-label="Price per unit" onChange={(e) => set({ price: e.target.value })} />
            {minPrice != null && Number(form.price) > 0 && Number(form.price) < minPrice && (
              <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 4 }}>Below the accepted ₹{minPrice} for this quantity.</div>
            )}
          </div>
        </div>
        <div className="act"><button className="btn btn-g" onClick={savePo} disabled={busy}>✓ Save PO</button></div>
      </div>

      <div className="card">
        <div className="ctitle">My POs</div>
        <div className="tw sy">
          <table>
            <thead><tr>
              <th>Date</th><th>PO #</th><th>Customer</th><th>SKU</th>
              <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Price</th><th style={{ textAlign: 'right' }}>Total</th>
            </tr></thead>
            <tbody>
              {myPos.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No POs entered yet</td></tr>
              ) : myPos.map((p) => {
                const sku = (sales.skus || []).find((s) => s.id === p.sku_id);
                return (
                  <tr key={p.id}>
                    <td>{fmtDate(p.date)}</td>
                    <td style={{ fontWeight: 600 }}>{p.po_number || '—'}</td>
                    <td>{leadName(p.lead_id)}</td>
                    <td>{sku ? sku.sku_name : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{inr(p.qty)}</td>
                    <td style={{ textAlign: 'right' }}>₹{inr(p.price)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>₹{inr(poValue(p))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
