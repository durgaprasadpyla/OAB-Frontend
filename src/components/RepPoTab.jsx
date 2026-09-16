import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { fmtDate, inr } from '../lib/format.js';
import { salesToday } from '../lib/sales.js';
import { poValue } from '../lib/repPortal.js';
import { repBook, despatchLocationsFor, acceptedSkusForPo, acceptedSkusWithoutJss, acceptedPriceForQty, buildPoLines } from '../lib/repFlow.js';

// 🧾 Enter PO — Sales Login §61-§70.
//
// "The first drop-down selection should be the customers because only after a lead
// is converted into a customer will we get the POs." Then the despatch location
// (the customer's, from the Super Admin), the PO number and date, and the SKUs:
// only those whose quotation is accepted AND for which QC has already created the
// JSS, each with its JSS filled in, the quantity typed and the price taken from the
// accepted quotation for that quantity. Several SKUs go on one PO; a SKU already on
// it leaves the drop-down.

const blankLine = () => ({ skuId: '', qty: '', price: '' });

export default function RepPoTab({ leads, sales, save, repId }) {
  const { mods } = useData();
  const customers = mods.customers || [];
  const book = useMemo(() => repBook(sales, customers, repId), [sales, customers, repId]);
  const [form, setForm] = useState({ leadId: '', location: '', poNumber: '', date: salesToday() });
  const [lines, setLines] = useState([blankLine()]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 6000); };

  const lead = book.customers.find((l) => l.id === form.leadId) || null;
  const locations = useMemo(() => despatchLocationsFor(lead, customers), [lead, customers]);
  const ready = useMemo(() => (lead ? acceptedSkusForPo(sales, lead.id) : []), [sales, lead]);
  const waiting = useMemo(() => (lead ? acceptedSkusWithoutJss(sales, lead.id) : []), [sales, lead]);
  const allLeads = sales.leads || [];
  const leadName = (id) => ((allLeads.find((l) => l.id === id) || leads.find((l) => l.id === id) || {}).client_name) || '—';

  const myPos = useMemo(() => (sales.pos || [])
    .filter((p) => p.created_by === repId)
    .sort((a, b) => String(b.created_at || b.date || '').localeCompare(String(a.created_at || a.date || '')))
    .slice(0, 60), [sales.pos, repId]);

  const skuOf = (id) => ready.find((s) => s.id === id) || null;
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => {
    if (j !== i) return l;
    const next = { ...l, ...patch };
    // §69: the price follows the accepted quotation for the quantity, unless typed over
    if ('qty' in patch || 'skuId' in patch) {
      const sku = skuOf(next.skuId);
      const p = sku ? acceptedPriceForQty(sku, Number(next.qty) || 0) : null;
      if (p != null && !next.priceTouched) next.price = String(p);
    }
    return next;
  }));

  async function savePo() {
    let rows;
    try {
      rows = buildPoLines({ leadId: form.leadId, customer: lead ? lead.client_name : '', despatchLocation: form.location, poNumber: form.poNumber, poDate: form.date, lines }, sales, repId);
      if (!form.location) throw new Error('Pick the despatch location.');
    } catch (e) { flash('r', e.message); return; }
    setBusy(true);
    try {
      await save('sales', (prev) => ({ ...(prev || {}), pos: [...((prev && prev.pos) || []), ...rows] }));
      setForm({ leadId: '', location: '', poNumber: '', date: salesToday() });
      setLines([blankLine()]);
      flash('g', `✓ PO ${rows[0].po_number} saved with ${rows.length} SKU(s). It is on the Superstar's PO → SO list to be entered on the OAB.`);
    } catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
  }

  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <div className="card">
        <div className="ctitle" style={{ marginBottom: 4 }}>🧾 Enter Purchase Order</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Customers only — a lead becomes a customer when the Super Admin converts it. The SKUs offered are those with an accepted
          quotation for which QC has created the JSS; the price comes from the accepted quotation for the quantity.
        </div>
        <div className="g4">
          <div className="fg"><label>Customer *</label>
            <select value={form.leadId} aria-label="PO customer" onChange={(e) => { set({ leadId: e.target.value, location: '' }); setLines([blankLine()]); }}>
              <option value="">-- Select the customer --</option>
              {book.customers.map((l) => <option key={l.id} value={l.id}>{l.client_name}</option>)}
            </select>
            {book.customers.length === 0 && <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>None of your leads has been converted into a customer yet.</div>}
          </div>
          <div className="fg"><label>Despatch location *</label>
            <select value={form.location} aria-label="PO despatch location" onChange={(e) => set({ location: e.target.value })} disabled={!lead}>
              <option value="">-- Select --</option>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="fg"><label>PO Number *</label>
            <input value={form.poNumber} aria-label="PO Number" onChange={(e) => set({ poNumber: e.target.value })} />
          </div>
          <div className="fg"><label>PO Date *</label>
            <input type="date" value={form.date} aria-label="PO Date" onChange={(e) => set({ date: e.target.value })} />
          </div>
        </div>

        {lead && !ready.length && (
          <div className="al al-y">
            {waiting.length
              ? <>⚠ {waiting.map((s) => s.sku_name).join(', ')}: quotation accepted, but QC has not created the JSS yet — the SKU appears here once it has.</>
              : <>⚠ No SKU of {lead.client_name} has an accepted quotation yet (Quote Accepted tab).</>}
          </div>
        )}

        <div className="ctitle" style={{ fontSize: 11, margin: '8px 0 2px' }}>SKUs on this PO</div>
        <div className="tw"><table>
          <thead><tr><th style={{ minWidth: 260 }}>SKU</th><th>JSS</th><th style={{ width: 140 }}>Quantity *</th><th style={{ width: 160 }}>Price / unit ₹</th><th style={{ width: 130, textAlign: 'right' }}>Total</th><th style={{ width: 40 }}></th></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const sku = skuOf(l.skuId);
              const taken = new Set(lines.filter((x, j) => j !== i).map((x) => x.skuId));
              const min = sku ? acceptedPriceForQty(sku, Number(l.qty) || 0) : null;
              return (
                <tr key={i}>
                  <td>
                    <select value={l.skuId} aria-label={`PO SKU ${i + 1}`} disabled={!lead} onChange={(e) => setLine(i, { skuId: e.target.value, priceTouched: false })} style={{ width: '100%' }}>
                      <option value="">-- Select an accepted SKU --</option>
                      {ready.filter((s) => !taken.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.sku_name} ({s.category || ''} / {s.dispatch_form || s.dispatch_type || ''})</option>)}
                    </select>
                    {sku && sku.price_tiers && sku.price_tiers.length > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--blu)', marginTop: 2 }}>Accepted: {sku.price_tiers.map((t) => `₹${t.price} @ ${t.qty}`).join(', ')}</div>
                    )}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700 }} aria-label={`PO JSS ${i + 1}`}>{sku ? sku.jss_spec : '—'}</td>
                  <td><input type="number" min="0" value={l.qty} aria-label={`PO quantity ${i + 1}`} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                  <td>
                    <input type="number" min="0" step="0.01" value={l.price} aria-label={`PO price ${i + 1}`} onChange={(e) => setLine(i, { price: e.target.value, priceTouched: true })} />
                    {min != null && Number(l.price) > 0 && Number(l.price) < min && <div style={{ fontSize: 10, color: 'var(--red)' }}>Below the accepted ₹{min} for this quantity.</div>}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>₹{inr((Number(l.qty) || 0) * (Number(l.price) || 0))}</td>
                  <td><button className="btn btn-r" style={{ height: 24, fontSize: 11, padding: '0 6px' }} aria-label={`Remove PO line ${i + 1}`} onClick={() => setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((_, j) => j !== i)))}>✕</button></td>
                </tr>
              );
            })}
            <tr><td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>PO total</td><td style={{ textAlign: 'right', fontWeight: 700 }}>₹{inr(total)}</td><td></td></tr>
          </tbody>
        </table></div>
        <div className="act" style={{ justifyContent: 'flex-start' }}>
          <button className="btn btn-s" onClick={() => setLines((ls) => [...ls, blankLine()])} disabled={!lead || lines.length >= ready.length}>＋ Another SKU</button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-g" onClick={savePo} disabled={busy}>✓ Save PO</button>
        </div>
      </div>

      <div className="card">
        <div className="ctitle">My POs</div>
        <div className="tw sy">
          <table>
            <thead><tr>
              <th>Date</th><th>PO #</th><th>Customer</th><th>Despatch location</th><th>SKU</th><th>JSS</th>
              <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Price</th><th style={{ textAlign: 'right' }}>Total</th><th>On OAB</th>
            </tr></thead>
            <tbody>
              {myPos.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No POs entered yet</td></tr>
              ) : myPos.map((p) => {
                const sku = (sales.skus || []).find((s) => s.id === p.sku_id);
                return (
                  <tr key={p.id}>
                    <td>{fmtDate(p.date)}</td>
                    <td style={{ fontWeight: 600 }}>{p.po_number || '—'}</td>
                    <td>{p.customer || leadName(p.lead_id)}</td>
                    <td style={{ fontSize: 11 }}>{p.despatch_location || '—'}</td>
                    <td>{p.sku_name || (sku ? sku.sku_name : '—')}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{p.jss_spec || (sku && sku.jss_spec) || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{inr(p.qty)}</td>
                    <td style={{ textAlign: 'right' }}>₹{inr(p.price, 2)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>₹{inr(poValue(p))}</td>
                    <td style={{ fontSize: 11 }}>{p.pushed_to_oab ? <span className="tag tg">SO {p.pushed_to_oab.so || '✓'}</span> : <span className="tag ty">pending</span>}</td>
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
