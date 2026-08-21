import { useMemo, useState } from 'react';
import { ddList, ddPairs } from '../lib/dropdowns.js';
import { DESPATCH_FORMS } from '../lib/salesTargets.js';
import {
  REP_SKU_STAGES, skuCsaDone, skuReadyForPO, toggleSkuStage,
  platesForSku, skusForRep, allowedDespatchForms, buildSku,
} from '../lib/repPortal.js';

// 📦 SKUs — a rep adds the items they are selling and walks each one through the
// workflow that clears it for a PO. Ported from repSkus / repToggleSkuFlag /
// repSaveSkus / repAcceptedPopup.
//
// Stage toggles are STAGED locally and written in one save, as in production:
// flipping six switches across ten SKUs should be one write, not sixty.

const blankTier = () => ({ qty: '', price: '' });

/** An on/off pill. `csa_received` renders locked — only QC can set it. */
function StageToggle({ sku, stageKey, label, mandatory, csaDone, onToggle }) {
  const locked = stageKey === 'csa_received';
  const on = locked ? csaDone : !!sku[stageKey];
  const track = {
    width: 34, height: 18, borderRadius: 10, background: on ? 'var(--g)' : '#c9ccd2',
    position: 'relative', flexShrink: 0, transition: '.15s', display: 'inline-block',
    opacity: locked ? 0.85 : 1,
  };
  const knob = {
    position: 'absolute', top: 2, left: on ? 18 : 2, width: 14, height: 14,
    borderRadius: '50%', background: '#fff', transition: '.15s',
  };
  return (
    <div
      onClick={locked ? undefined : () => onToggle(stageKey)}
      title={locked ? 'Set automatically when QC generates the CSA report — not editable here' : 'Click to toggle'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, margin: '3px 10px 3px 0',
        cursor: locked ? 'default' : 'pointer', fontSize: 11, fontWeight: 600,
        color: on ? 'var(--g)' : locked ? '#999' : '#777',
      }}
    >
      <span style={track}><span style={knob} /></span>
      {label}{mandatory ? ' *' : ''}{locked ? ' 🔒' : ''}
    </div>
  );
}

export default function RepSkusTab({ leads, sales, save, repId }) {
  const [form, setForm] = useState({ leadId: '', name: '', category: '', dispatchForm: '' });
  const [draft, setDraft] = useState(null);       // staged skus array, null = clean
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [accFor, setAccFor] = useState(null);     // sku id whose accepted price is being captured
  const [tiers, setTiers] = useState([blankTier()]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  const categories = ddList(sales, 'categories');
  // Dispatch forms come from the shared dropdown list so a super-admin edit reaches
  // here too; DESPATCH_FORMS is only the fallback shape.
  const despatchAll = useMemo(() => ddPairs(sales, 'despatch') || DESPATCH_FORMS, [sales]);

  const skus = draft || sales.skus;
  const view = { ...sales, skus };
  const mine = useMemo(() => skusForRep(view, repId), [skus, repId]); // eslint-disable-line react-hooks/exhaustive-deps
  const leadName = (id) => (leads.find((l) => l.id === id) || {}).client_name || '—';

  // Sales Admin can restrict which dispatch forms apply to a customer + category.
  const selectedLead = leads.find((l) => l.id === form.leadId) || null;
  const despatchOptions = allowedDespatchForms(selectedLead, form.category, despatchAll);
  const restricted = despatchOptions.length !== despatchAll.length;

  async function addSku() {
    let sku;
    try { sku = buildSku(form, repId); } catch (e) { flash('r', e.message); return; }
    setBusy(true);
    try {
      await save('sales', (prev) => ({ ...(prev || {}), skus: [...((prev && prev.skus) || []), sku] }));
      setForm({ leadId: '', name: '', category: '', dispatchForm: '' });
      setDraft(null);
      flash('g', '✓ SKU added.');
    } catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
  }

  function toggle(skuId, key) {
    const next = toggleSkuStage(skus, skuId, key);
    setDraft(next);
    // Turning "Quotation accepted" on is where the agreed price slabs get captured.
    const justOn = next.find((x) => x.id === skuId);
    if (key === 'quotation_accepted' && justOn && justOn.quotation_accepted) {
      setTiers(justOn.price_tiers && justOn.price_tiers.length ? justOn.price_tiers : [blankTier()]);
      setAccFor(skuId);
    }
  }

  async function saveStages(nextSkus) {
    setBusy(true);
    try {
      const list = nextSkus || skus;
      await save('sales', (prev) => {
        // Merge onto the server copy by id so another rep's new SKU is not dropped.
        const byId = new Map(list.map((x) => [x.id, x]));
        const merged = ((prev && prev.skus) || []).map((x) => byId.get(x.id) || x);
        list.forEach((x) => { if (!merged.some((m) => m.id === x.id)) merged.push(x); });
        return { ...(prev || {}), skus: merged };
      });
      setDraft(null);
      flash('g', '✓ Saved.');
    } catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
  }

  async function saveAccepted() {
    const clean = tiers.filter((t) => Number(t.qty) > 0 && Number(t.price) > 0)
      .map((t) => ({ qty: Number(t.qty), price: Number(t.price) }));
    const next = skus.map((x) => (x.id === accFor ? { ...x, price_tiers: clean } : x));
    setAccFor(null);
    await saveStages(next);
  }

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <div className="card">
        <div className="ctitle" style={{ marginBottom: 4 }}>📦 Add SKU</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Each SKU carries a Category and a Dispatch Form. Sales booked against the SKU count toward both the
          category target and the dispatch-form target. Fields marked * are mandatory (green) before a PO can be entered.
        </div>
        <div className="g2">
          <div className="fg"><label>Customer *</label>
            <select value={form.leadId} aria-label="Customer" onChange={(e) => set({ leadId: e.target.value, dispatchForm: '' })}>
              <option value="">-- Select your customer --</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.client_name}</option>)}
            </select>
          </div>
          <div className="fg"><label>SKU Name *</label>
            <input value={form.name} aria-label="SKU Name" placeholder="e.g. 200g Turmeric Pouch" onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="fg"><label>Category *</label>
            <select value={form.category} aria-label="Category" onChange={(e) => set({ category: e.target.value, dispatchForm: '' })}>
              <option value="">-- Select --</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="fg"><label>Dispatch Form *</label>
            <select value={form.dispatchForm} aria-label="Dispatch Form" onChange={(e) => set({ dispatchForm: e.target.value })}>
              <option value="">-- Select --</option>
              {despatchOptions.map((d) => <option key={d[0]} value={d[0]}>{d[1]}</option>)}
            </select>
            {restricted && (
              <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 4 }}>
                Restricted to the dispatch forms approved for “{form.category}” with this customer.
              </div>
            )}
          </div>
        </div>
        <div className="act"><button className="btn btn-g" onClick={addSku} disabled={busy}>✓ Add SKU</button></div>
      </div>

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>My SKUs — workflow</div>
          <span style={{ flex: 1 }} />
          {draft && <span style={{ fontSize: 11, color: '#c9a100', marginRight: 8 }}>● Unsaved changes</span>}
          <button className="btn btn-g" style={{ opacity: draft ? 1 : 0.6 }} disabled={busy || !draft} onClick={() => saveStages()}>💾 Save changes</button>
        </div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Toggle the stages, then click Save. Fields marked * must be green before a PO can be entered.
        </div>
        <div className="tw sy">
          <table>
            <thead><tr>
              <th>SKU</th><th>Customer</th><th style={{ minWidth: 130 }}>Category / Dispatch</th><th style={{ minWidth: 320 }}>Workflow stage</th>
            </tr></thead>
            <tbody>
              {mine.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No SKUs yet</td></tr>
              ) : mine.map((sku) => {
                const ready = skuReadyForPO(view, sku);
                const plates = platesForSku(view, sku);
                return (
                  <tr key={sku.id}>
                    <td style={{ fontWeight: 700, verticalAlign: 'top' }}>{sku.sku_name}</td>
                    <td style={{ verticalAlign: 'top' }}>{leadName(sku.lead_id)}</td>
                    <td style={{ verticalAlign: 'top' }}>
                      <span className="tag tb">{sku.category || '—'}</span>
                      <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>{sku.dispatch_form || sku.dispatch_type || '—'}</div>
                    </td>
                    <td>
                      {REP_SKU_STAGES.map(([key, label, mandatory]) => (
                        <StageToggle
                          key={key} sku={sku} stageKey={key} label={label} mandatory={mandatory}
                          csaDone={skuCsaDone(view, sku)} onToggle={(k) => toggle(sku.id, k)}
                        />
                      ))}
                      <button
                        className="btn btn-s" style={{ height: 24, fontSize: 10, padding: '0 8px', margin: 2, background: '#eef2ff', color: '#3730a3' }}
                        onClick={() => { setTiers(sku.price_tiers && sku.price_tiers.length ? sku.price_tiers : [blankTier()]); setAccFor(sku.id); }}
                      >₹ Price tiers{sku.price_tiers && sku.price_tiers.length ? ` (${sku.price_tiers.length})` : ''}</button>
                      {plates && (
                        <div style={{ marginTop: 4, fontSize: 10, color: '#8a6d00', background: '#fff8e6', border: '1px solid #f0e2b8', borderRadius: 5, padding: '3px 7px', display: 'inline-block' }}>
                          🧾 Plate cost (from PM): CI ₹{plates.p.ci_per || 0}×{plates.p.ci_n || 0}, Offset ₹{plates.p.off_per || 0}×{plates.p.off_n || 0} = <b>₹{Math.round(plates.total)}</b>
                        </div>
                      )}
                      <div style={{ marginTop: 4 }}>
                        {ready
                          ? <span style={{ fontSize: 10, color: 'var(--g)', fontWeight: 700 }}>✓ Ready for PO</span>
                          : <span style={{ fontSize: 10, color: '#c9a100' }}>Needs CSA + Quotation received + accepted</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {accFor && (
        <div style={overlay} onClick={() => setAccFor(null)}>
          <div style={sheet} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1a4fa0', marginBottom: 4 }}>
              ✅ Quotation Accepted — {(mine.find((x) => x.id === accFor) || {}).sku_name}
            </div>
            <div className="pg-sub" style={{ marginTop: 0 }}>
              Enter the accepted quantity/price slabs (as agreed with the customer). PO prices are validated against these.
            </div>
            {tiers.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: '#555' }}>₹</span>
                <input
                  type="number" value={t.price} placeholder="price / kg" aria-label={`Slab ${i + 1} price`}
                  onChange={(e) => setTiers((xs) => xs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                  style={{ width: 110, height: 32 }}
                />
                <span style={{ fontSize: 12, color: '#555' }}>for</span>
                <input
                  type="number" value={t.qty} placeholder="quantity" aria-label={`Slab ${i + 1} quantity`}
                  onChange={(e) => setTiers((xs) => xs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                  style={{ width: 110, height: 32 }}
                />
                <span style={{ fontSize: 12, color: '#555' }}>kg</span>
              </div>
            ))}
            <button className="btn btn-s" style={{ height: 28, fontSize: 11, background: '#eef2ff', color: '#3730a3' }} onClick={() => setTiers((xs) => [...xs, blankTier()])}>+ Add slab</button>
            <div className="act">
              <button className="btn btn-s" onClick={() => setAccFor(null)}>Cancel</button>
              <button className="btn btn-g" onClick={saveAccepted} disabled={busy}>✓ Save accepted price</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 9600, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '32px 12px' };
const sheet = { background: 'var(--wh)', borderRadius: 12, maxWidth: 560, width: '100%', padding: '20px 22px', boxShadow: '0 20px 60px rgba(0,0,0,.3)', margin: 'auto' };
