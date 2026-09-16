import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { fmtDate } from '../lib/format.js';
import { ddList, ddPairs } from '../lib/dropdowns.js';
import { DESPATCH_FORMS } from '../lib/salesTargets.js';
import {
  REP_SKU_STAGES, skuCsaDone, skuReadyForPO, toggleSkuStage,
  platesForSku, skusForRep, allowedDespatchForms, buildSku,
} from '../lib/repPortal.js';
import {
  repBook, despatchLocationsFor, DESPATCH_FIELDS, despatchKind, bulkBagTotals,
  buildCsaRequest, sendSkuForCsa, quoteStatusOf,
} from '../lib/repFlow.js';
import LeadCustomerPicker from './LeadCustomerPicker.jsx';

// 📦 SKUs — Sales Login §10-§29.
//
// The rep picks a LEAD or a CUSTOMER first, adds the SKU with its structure, and
// says whether the sample has been received. Yes opens the CSA requisition —
// despatch location (the customer's, from the Super Admin), tentative quantity,
// date and target price, and the despatch-form specific measurements — which
// "Send for CSA to QC" hands to the QC login. A radio button beside each SKU
// brings it back into the form to correct. Stage toggles below stay as they were:
// CSA received is QC's alone.

const blankTier = () => ({ qty: '', price: '' });
const blankForm = () => ({ kind: 'lead', leadId: '', name: '', category: '', dispatchForm: '', structure: '', sampleReceived: 'No' });
const blankCsa = () => ({ despatch_location: '', tentative_qty: '', tentative_date: '', target_price: '' });

/** An on/off pill. `csa_received` renders locked — only QC can set it. */
function StageToggle({ sku, stageKey, label, mandatory, csaDone, onToggle }) {
  const locked = stageKey === 'csa_received';
  const on = locked ? csaDone : !!sku[stageKey];
  const track = {
    width: 34, height: 18, borderRadius: 10, background: on ? 'var(--g)' : '#c9ccd2',
    position: 'relative', flexShrink: 0, transition: '.15s', display: 'inline-block',
    opacity: locked ? 0.85 : 1,
  };
  const knob = { position: 'absolute', top: 2, left: on ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: '.15s' };
  return (
    <div
      onClick={locked ? undefined : () => onToggle(stageKey)}
      title={locked ? 'Set automatically when QC generates the CSA report — not editable here' : 'Click to toggle'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '3px 10px 3px 0', cursor: locked ? 'default' : 'pointer', fontSize: 11, fontWeight: 600, color: on ? 'var(--g)' : locked ? '#999' : '#777' }}
    >
      <span style={track}><span style={knob} /></span>
      {label}{mandatory ? ' *' : ''}{locked ? ' 🔒' : ''}
    </div>
  );
}

export default function RepSkusTab({ leads, sales, save, repId }) {
  const { mods } = useData();
  const { user } = useAuth() || {};
  const customers = mods.customers || [];
  const book = useMemo(() => repBook(sales, customers, repId), [sales, customers, repId]);
  const [form, setForm] = useState(blankForm());
  const [csa, setCsa] = useState(blankCsa());
  const [editing, setEditing] = useState('');       // sku id under correction
  const [draft, setDraft] = useState(null);         // staged skus array, null = clean
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [accFor, setAccFor] = useState(null);       // sku id whose accepted price is being captured
  const [tiers, setTiers] = useState([blankTier()]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setC = (patch) => setCsa((c) => ({ ...c, ...patch }));
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 5000); };

  const categories = ddList(sales, 'categories');
  const despatchAll = useMemo(() => ddPairs(sales, 'despatch') || DESPATCH_FORMS, [sales]);
  const cityList = ddList(sales, 'locations');

  const skus = draft || sales.skus;
  const view = { ...sales, skus };
  const bookIds = useMemo(() => new Set([...book.leads, ...book.customers].map((l) => l.id)), [book]);
  const mine = useMemo(() => {
    const own = skusForRep(view, repId);
    const ids = new Set(own.map((x) => x.id));
    // SKUs of a customer the Super Admin handed the rep (KAM) show too
    (skus || []).forEach((sk) => { if (!ids.has(sk.id) && bookIds.has(sk.lead_id)) own.push(sk); });
    return own;
  }, [skus, repId, bookIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const allLeads = sales.leads || [];
  const leadOf = (id) => allLeads.find((l) => l.id === id) || null;
  const leadName = (id) => (leadOf(id) || {}).client_name || '—';

  // Sales Admin can restrict which dispatch forms apply to a customer + category.
  const selectedLead = leadOf(form.leadId);
  const despatchOptions = allowedDespatchForms(selectedLead, form.category, despatchAll);
  const restricted = despatchOptions.length !== despatchAll.length;

  // §17: the despatch locations of THIS lead / customer — the Super Admin's list
  const locations = useMemo(() => despatchLocationsFor(selectedLead, customers, []), [selectedLead, customers]);
  const kind = despatchKind(form.dispatchForm);
  const fields = DESPATCH_FIELDS[kind] || [];
  const bulk = kind === 'bulk' ? bulkBagTotals(csa) : null;

  /** §29: the radio beside a SKU brings it into the form to correct. */
  function editSku(sku) {
    const lead = leadOf(sku.lead_id);
    const isCust = book.customers.some((l) => l.id === sku.lead_id);
    setEditing(sku.id);
    setForm({
      kind: isCust ? 'customer' : 'lead', leadId: lead ? lead.id : '', name: sku.sku_name || '', category: sku.category || '',
      dispatchForm: sku.dispatch_form || sku.dispatch_type || '', structure: sku.structure || '',
      sampleReceived: sku.csa_requested || sku.sample_received === 'Yes' || sku.sample_received === true ? 'Yes' : 'No',
    });
    const r = sku.csa_request || {};
    setCsa({ ...blankCsa(), despatch_location: r.despatch_location || '', tentative_qty: r.tentative_qty || '', tentative_date: r.tentative_date || '', target_price: r.target_price || '', ...(r.details || {}) });
    setMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelEdit() { setEditing(''); setForm(blankForm()); setCsa(blankCsa()); }

  /** Add a new SKU, or save the corrections to the one under edit. */
  async function saveSku() {
    setBusy(true);
    try {
      if (editing) {
        if (!form.leadId) throw new Error('Select a lead or customer.');
        if (!String(form.name || '').trim()) throw new Error('Enter the SKU name.');
        await save('sales', (prev) => ({
          ...(prev || {}),
          skus: ((prev && prev.skus) || []).map((sk) => (sk.id === editing
            ? { ...sk, lead_id: form.leadId, sku_name: form.name.trim(), category: form.category, dispatch_form: form.dispatchForm, structure: String(form.structure || '').trim() }
            : sk)),
        }));
        flash('g', '✓ SKU updated.');
        cancelEdit();
      } else {
        const sku = { ...buildSku(form, repId), structure: String(form.structure || '').trim() };
        await save('sales', (prev) => ({ ...(prev || {}), skus: [...((prev && prev.skus) || []), sku] }));
        setForm(blankForm()); setCsa(blankCsa());
        setDraft(null);
        flash('g', '✓ SKU added. Tick "Sample received — Yes" on it (pick it below) once the customer\'s sample is in hand, to send it for CSA.');
      }
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }

  /** §15: "Send for CSA to QC" — the requisition goes to the QC login's pending list. */
  async function sendForCsa() {
    const sku = (skus || []).find((x) => x.id === editing);
    if (!sku) { flash('r', 'Pick the SKU (radio button in the list) first, then say the sample is received.'); return; }
    let request;
    try { request = buildCsaRequest(csa, { ...sku, dispatch_form: form.dispatchForm || sku.dispatch_form }, { user: user || repId }); }
    catch (e) { flash('r', e.message); return; }
    setBusy(true);
    try {
      await save('sales', (prev) => ({
        ...(prev || {}),
        skus: sendSkuForCsa(((prev && prev.skus) || []).map((sk) => (sk.id === sku.id
          ? { ...sk, lead_id: form.leadId || sk.lead_id, sku_name: form.name.trim() || sk.sku_name, category: form.category || sk.category, dispatch_form: form.dispatchForm || sk.dispatch_form, structure: String(form.structure || '').trim() }
          : sk)), sku.id, request),
      }));
      flash('g', `✓ ${sku.sku_name} sent to QC for the CSA report — it is now on QC's "Samples pending analysis" list.`);
      cancelEdit();
    } catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
  }

  function toggle(skuId, key) {
    const next = toggleSkuStage(skus, skuId, key);
    setDraft(next);
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
    const clean = tiers.filter((t) => Number(t.qty) > 0 && Number(t.price) > 0).map((t) => ({ qty: Number(t.qty), price: Number(t.price) }));
    const next = skus.map((x) => (x.id === accFor ? { ...x, price_tiers: clean } : x));
    setAccFor(null);
    await saveStages(next);
  }

  const editingSku = editing ? (skus || []).find((x) => x.id === editing) : null;
  const csaSent = !!(editingSku && editingSku.csa_requested);
  const csaDoneFor = editingSku ? skuCsaDone(view, editingSku) : false;
  const showCsa = form.sampleReceived === 'Yes';
  const statusTag = (sk) => {
    const st = quoteStatusOf(view, sk);
    if (sk.csa_requested && !skuCsaDone(view, sk)) return <span className="tag ty" style={{ fontSize: 9 }}>CSA with QC</span>;
    if (st === 'accepted') return <span className="tag tg" style={{ fontSize: 9 }}>Quote accepted</span>;
    if (st === 'sent') return <span className="tag tb" style={{ fontSize: 9 }}>Quote sent</span>;
    if (st === 'to_send') return <span className="tag ty" style={{ fontSize: 9 }}>Quote to send</span>;
    if (skuCsaDone(view, sk)) return <span className="tag tb" style={{ fontSize: 9 }}>CSA done</span>;
    return <span className="tag" style={{ fontSize: 9 }}>New</span>;
  };

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>{editing ? `✏ SKU — ${editingSku ? editingSku.sku_name : ''}` : '📦 Add SKU'}</div>
          <span style={{ flex: 1 }} />
          {editing && <button className="btn btn-s" onClick={cancelEdit}>Cancel</button>}
        </div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Pick the lead or customer, then the SKU with its structure. Once the customer&rsquo;s sample is in hand, mark
          <b> Sample received — Yes</b>, fill in the despatch details and send it to QC for the CSA report.
        </div>
        <div className="g3">
          <LeadCustomerPicker book={book} kind={form.kind} leadId={form.leadId}
            onKind={(k) => set({ kind: k, leadId: '', dispatchForm: '' })} onLead={(id) => set({ leadId: id, dispatchForm: '' })} ariaPrefix="SKU" />
          <div className="fg"><label>SKU Name *</label>
            <input value={form.name} aria-label="SKU Name" placeholder="e.g. 200g Turmeric Pouch" onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="fg"><label>Structure</label>
            <input value={form.structure} aria-label="Structure" placeholder="e.g. PET 12 / MET PET 12 / LDPE 50" onChange={(e) => set({ structure: e.target.value })} />
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
            {restricted && <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 4 }}>Restricted to the dispatch forms approved for “{form.category}” with this customer.</div>}
          </div>
          <div className="fg"><label>Sample received?</label>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, marginTop: 6 }} role="radiogroup" aria-label="Sample received">
              {['Yes', 'No'].map((v) => (
                <label key={v} className="cb"><input type="radio" name="sample-received" value={v} checked={form.sampleReceived === v} aria-label={`Sample received ${v}`} onChange={() => set({ sampleReceived: v })} /><span>{v}</span></label>
              ))}
            </div>
          </div>
        </div>
        <div className="act">
          <button className="btn btn-g" onClick={saveSku} disabled={busy}>{editing ? '✓ Save SKU' : '✓ Add SKU'}</button>
          {!editing && form.sampleReceived === 'Yes' && <span className="pg-sub" style={{ margin: 0 }}>Add the SKU first, then pick it in the list below to send its sample for CSA.</span>}
        </div>

        {showCsa && editing && (
          <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg)' }} aria-label="CSA requisition">
            <div className="ctitle" style={{ fontSize: 12 }}>🧪 CSA requisition — customer sample analysis by QC</div>
            {csaSent && (
              <div className={'al ' + (csaDoneFor ? 'al-g' : 'al-b')}>
                {csaDoneFor ? 'QC has completed the CSA report for this SKU.' : `Sent to QC on ${fmtDate(String((editingSku.csa_request || {}).sent_at || '').slice(0, 10))} — waiting for the CSA report.`}
                {' '}Sending again replaces the requisition.
              </div>
            )}
            <div className="g4">
              <div className="fg"><label>Despatch location *</label>
                <select value={csa.despatch_location} aria-label="Despatch location" onChange={(e) => setC({ despatch_location: e.target.value })}>
                  <option value="">-- Select --</option>
                  {locations.map((l) => <option key={l} value={l}>{l}</option>)}
                  {cityList.filter((c) => !locations.includes(c)).map((c) => <option key={'c-' + c} value={c}>{c}</option>)}
                </select>
                <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>{locations.length ? 'From the Super Admin\'s customer master' : 'No despatch location on this lead yet — the Super Admin\'s locations are offered'}</div>
              </div>
              <div className="fg"><label>Tentative order quantity *</label><input type="number" min="0" value={csa.tentative_qty} aria-label="Tentative order quantity" onChange={(e) => setC({ tentative_qty: e.target.value })} /></div>
              <div className="fg"><label>Tentative despatch date *</label><input type="date" value={csa.tentative_date} aria-label="Tentative despatch date" onChange={(e) => setC({ tentative_date: e.target.value })} /></div>
              <div className="fg"><label>Target price (₹) *</label><input type="number" min="0" step="0.01" value={csa.target_price} aria-label="Target price" onChange={(e) => setC({ target_price: e.target.value })} /></div>
            </div>
            {fields.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, margin: '6px 0 2px' }}>{form.dispatchForm} — details</div>
                <div className="g4">
                  {fields.filter((f) => !f.when || String(csa[fields[0].k] || '') === f.when).map((f) => (
                    <div className="fg" key={f.k}>
                      <label>{f.label}</label>
                      {f.type === 'select' ? (
                        <select value={csa[f.k] || ''} aria-label={f.label} onChange={(e) => setC({ [f.k]: e.target.value })}>
                          <option value="">-- Select --</option>
                          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : f.type === 'radio' ? (
                        <div style={{ display: 'flex', gap: 12, fontSize: 12, marginTop: 6 }} role="radiogroup" aria-label={f.label}>
                          {f.options.map((o) => (
                            <label key={o} className="cb"><input type="radio" name={'csa-' + f.k} value={o} checked={csa[f.k] === o} aria-label={o} onChange={() => setC({ [f.k]: o })} /><span>{o}</span></label>
                          ))}
                        </div>
                      ) : (
                        <input type={f.type === 'number' ? 'number' : 'text'} value={csa[f.k] ?? ''} aria-label={f.label} placeholder={f.unit || ''} onChange={(e) => setC({ [f.k]: e.target.value })} />
                      )}
                    </div>
                  ))}
                </div>
                {bulk && (
                  <div className="al al-b" aria-label="Bulk bag totals">
                    Total gusset <b>{bulk.totalGusset} mm</b> · finished pouch height <b>{bulk.totalHeight} mm</b> · finished pouch width <b>{bulk.totalWidth} mm</b>
                    <span style={{ color: 'var(--i3)' }}> (gusset × 2 for a bottom gusset, × 4 for a side gusset)</span>
                  </div>
                )}
              </>
            )}
            <div className="act">
              <button className="btn btn-g" onClick={sendForCsa} disabled={busy}>🧪 Send for CSA to QC</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>My SKUs — workflow <span className="tag tgr">{mine.length}</span></div>
          <span style={{ flex: 1 }} />
          {draft && <span style={{ fontSize: 11, color: '#c9a100', marginRight: 8 }}>● Unsaved changes</span>}
          <button className="btn btn-g" style={{ opacity: draft ? 1 : 0.6 }} disabled={busy || !draft} onClick={() => saveStages()}>💾 Save changes</button>
        </div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Pick the radio button to correct a SKU or send its sample for CSA. Toggle the stages, then click Save. Fields marked * must be green before a PO can be entered.
        </div>
        <div className="tw sy">
          <table>
            <thead><tr>
              <th style={{ width: 30 }}></th><th>SKU</th><th>Lead / Customer</th><th style={{ minWidth: 130 }}>Category / Dispatch</th><th>Structure</th><th>Status</th><th style={{ minWidth: 320 }}>Workflow stage</th>
            </tr></thead>
            <tbody>
              {mine.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No SKUs yet</td></tr>
              ) : mine.map((sku) => {
                const ready = skuReadyForPO(view, sku);
                const plates = platesForSku(view, sku);
                return (
                  <tr key={sku.id} className={editing === sku.id ? 'hi' : undefined}>
                    <td style={{ textAlign: 'center', verticalAlign: 'top' }}>
                      <input type="radio" name="sku-edit" checked={editing === sku.id} aria-label={`Edit ${sku.sku_name}`} onChange={() => editSku(sku)} />
                    </td>
                    <td style={{ fontWeight: 700, verticalAlign: 'top' }}>{sku.sku_name}{sku.jss_spec ? <div style={{ fontSize: 10, color: 'var(--blu)' }}>JSS {sku.jss_spec}</div> : null}</td>
                    <td style={{ verticalAlign: 'top' }}>{leadName(sku.lead_id)}</td>
                    <td style={{ verticalAlign: 'top' }}>
                      <span className="tag tb">{sku.category || '—'}</span>
                      <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>{sku.dispatch_form || sku.dispatch_type || '—'}</div>
                    </td>
                    <td style={{ fontSize: 11, verticalAlign: 'top' }}>{sku.structure || '—'}</td>
                    <td style={{ verticalAlign: 'top' }}>{statusTag(sku)}</td>
                    <td>
                      {REP_SKU_STAGES.filter(([k]) => k !== 'sample_received' && k !== 'sample_sent').map(([key, label, mandatory]) => (
                        <StageToggle key={key} sku={sku} stageKey={key} label={label} mandatory={mandatory} csaDone={skuCsaDone(view, sku)} onToggle={(k) => toggle(sku.id, k)} />
                      ))}
                      <button className="btn btn-s" style={{ height: 24, fontSize: 10, padding: '0 8px', margin: 2, background: '#eef2ff', color: '#3730a3' }}
                        onClick={() => { setTiers(sku.price_tiers && sku.price_tiers.length ? sku.price_tiers : [blankTier()]); setAccFor(sku.id); }}>
                        ₹ Price tiers{sku.price_tiers && sku.price_tiers.length ? ` (${sku.price_tiers.length})` : ''}
                      </button>
                      {plates && (
                        <div style={{ marginTop: 4, fontSize: 10, color: '#8a6d00', background: '#fff8e6', border: '1px solid #f0e2b8', borderRadius: 5, padding: '3px 7px', display: 'inline-block' }}>
                          🧾 Plate cost (from PM): CI ₹{plates.p.ci_per || 0}×{plates.p.ci_n || 0}, Offset ₹{plates.p.off_per || 0}×{plates.p.off_n || 0} = <b>₹{Math.round(plates.total)}</b>
                        </div>
                      )}
                      <div style={{ marginTop: 4 }}>
                        {ready
                          ? <span style={{ fontSize: 10, color: 'var(--g)', fontWeight: 700 }}>✓ Ready for PO{sku.jss_spec ? '' : ' — waiting for QC to create the JSS'}</span>
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
            <div className="pg-sub" style={{ marginTop: 0 }}>Enter the accepted quantity/price slabs (as agreed with the customer). PO prices are validated against these.</div>
            {tiers.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: '#555' }}>₹</span>
                <input type="number" value={t.price} placeholder="price / unit" aria-label={`Slab ${i + 1} price`}
                  onChange={(e) => setTiers((xs) => xs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} style={{ width: 110, height: 32 }} />
                <span style={{ fontSize: 12, color: '#555' }}>for</span>
                <input type="number" value={t.qty} placeholder="quantity" aria-label={`Slab ${i + 1} quantity`}
                  onChange={(e) => setTiers((xs) => xs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} style={{ width: 110, height: 32 }} />
                <span style={{ fontSize: 12, color: '#555' }}>units (MOQ)</span>
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
