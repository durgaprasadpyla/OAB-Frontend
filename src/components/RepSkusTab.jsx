import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { fmtDate } from '../lib/format.js';
import { ddList, ddPairs } from '../lib/dropdowns.js';
import { DESPATCH_FORMS } from '../lib/salesTargets.js';
import {
  REP_SKU_STAGES, skuCsaDone, skuReadyForPO, platesForSku, skusForRep, allowedDespatchForms, buildSku,
} from '../lib/repPortal.js';
import {
  repBook, despatchLocationRowsFor, masterRowsFor, DESPATCH_FIELDS, despatchKind, bulkBagTotals,
  buildCsaRequest, buildCsaDraft, csaDetailsOf, sendSkuForCsa, quoteStatusOf, saveErrorText,
} from '../lib/repFlow.js';
import LeadCustomerPicker from './LeadCustomerPicker.jsx';
import SubstrateLayers, { blankSubLayers, structureFromSubLayers, subLayersFromStructure } from './SubstrateLayers.jsx';

// 📦 SKUs — Sales Login §10-§29, as the 30.09 document puts it.
//
// The rep picks a LEAD or a CUSTOMER first, adds the SKU with its structure, and on
// the same form fills in the despatch details: the despatch location (the customer's,
// from the Super Admin), the tentative quantity, date and target price, and the
// measurements that belong to the despatch form. They are kept on the SKU on Add and
// on Save, and "Send for CSA to QC" — on this form too — hands the requisition to the
// QC login. A radio button beside each SKU brings it back into the form, despatch
// details and all. The workflow stages in the list are read-only: QC, the quote desk
// and the Quotations tabs set them.

const blankForm = () => ({ kind: 'lead', leadId: '', name: '', category: '', dispatchForm: '', structure: '', structureLayers: blankSubLayers(), sampleReceived: 'No' });
const blankCsa = () => ({ despatch_key: '', despatch_location: '', warehouse_name: '', tentative_qty: '', tentative_date: '', target_price: '' });

/** Only the fields every despatch form shares — what survives a change of despatch form. */
const commonOnly = (c) => Object.keys(blankCsa()).reduce((o, k) => { o[k] = c[k] ?? ''; return o; }, {});

/** A saved requisition / draft back into the form's shape. */
function csaFormFrom(r) {
  if (!r) return blankCsa();
  const loc = String(r.despatch_location || '').trim();
  const wh = String(r.warehouse_name || '').trim();
  return {
    ...blankCsa(), ...(r.details || {}),
    despatch_key: loc ? loc + '||' + wh : '', despatch_location: loc, warehouse_name: wh,
    tentative_qty: r.tentative_qty ?? '', tentative_date: r.tentative_date || '', target_price: r.target_price ?? '',
  };
}

/** A workflow stage, read-only — QC, the quote desk and the Quotations tabs set these. */
function StagePill({ on, label, mandatory }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '3px 10px 3px 0', fontSize: 11, fontWeight: 600, color: on ? '#1e7e34' : '#999' }}
      title={on ? 'Done' : 'Not yet'}>
      <span aria-hidden="true">{on ? '●' : '○'}</span>{label}{mandatory ? ' *' : ''}
    </span>
  );
}

/** One despatch-form specific field, as DESPATCH_FIELDS describes it. */
function DespatchField({ f, csa, onChange }) {
  // the shrink roll form's figure is metres OR kgs per core — the label says which
  const label = f.k === 'per_core_qty' && csa.per_core_basis ? csa.per_core_basis : f.label;
  return (
    <div className="fg">
      <label>{label}</label>
      {f.type === 'select' ? (
        <select value={csa[f.k] || ''} aria-label={f.label} onChange={(e) => onChange({ [f.k]: e.target.value })}>
          <option value="">-- Select --</option>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : f.type === 'radio' ? (
        <div style={{ display: 'flex', gap: 14, fontSize: 12, minHeight: 34, alignItems: 'center' }} role="radiogroup" aria-label={f.label}>
          {f.options.map((o) => (
            <label key={o} className="cb"><input type="radio" name={'csa-' + f.k} value={o} checked={csa[f.k] === o} aria-label={o} onChange={() => onChange({ [f.k]: o })} /><span>{o}</span></label>
          ))}
        </div>
      ) : f.type === 'number' ? (
        <input type="number" min="0" step="any" value={csa[f.k] ?? ''} aria-label={f.label} placeholder={f.unit || ''} onChange={(e) => onChange({ [f.k]: e.target.value })} />
      ) : (
        <input type="text" value={csa[f.k] ?? ''} aria-label={f.label} onChange={(e) => onChange({ [f.k]: e.target.value })} />
      )}
    </div>
  );
}

export default function RepSkusTab({ leads, sales, save, repId }) {   // eslint-disable-line no-unused-vars
  const { mods } = useData();
  const { user } = useAuth() || {};
  const customers = mods.customers || [];
  const book = useMemo(() => repBook(sales, customers, repId), [sales, customers, repId]);
  const [form, setForm] = useState(blankForm());
  const [csa, setCsa] = useState(blankCsa());
  const [editing, setEditing] = useState('');       // sku id under correction
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setC = (patch) => setCsa((c) => ({ ...c, ...patch }));
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 5000); };

  const categories = ddList(sales, 'categories');
  const despatchAll = useMemo(() => ddPairs(sales, 'despatch') || DESPATCH_FORMS, [sales]);
  const cityList = ddList(sales, 'locations');

  const skus = sales.skus || [];
  const bookIds = useMemo(() => new Set([...book.leads, ...book.customers].map((l) => l.id)), [book]);
  const mine = useMemo(() => {
    const own = skusForRep(sales, repId);
    const ids = new Set(own.map((x) => x.id));
    // SKUs of a customer the Super Admin handed the rep (KAM) show too
    (sales.skus || []).forEach((sk) => { if (!ids.has(sk.id) && bookIds.has(sk.lead_id)) own.push(sk); });
    return own;
  }, [sales, repId, bookIds]);
  const allLeads = sales.leads || [];
  const leadOf = (id) => allLeads.find((l) => l.id === id) || null;
  const leadName = (id) => (leadOf(id) || {}).client_name || '—';

  // Sales Admin can restrict which despatch forms apply to a customer + category.
  const selectedLead = leadOf(form.leadId);
  const despatchOptions = allowedDespatchForms(selectedLead, form.category, despatchAll);
  const restricted = despatchOptions.length !== despatchAll.length;
  // an edit must show the SKU's own form even if the category no longer allows it
  const formOffList = !!form.dispatchForm && !despatchOptions.some((d) => d[0] === form.dispatchForm);

  // §SK1 / §PE1: the despatch locations of THIS lead / customer — the Customer
  // Master's rows when it has the customer; only a lead not in it yet falls back to
  // its own city and the Super Admin's Locations list.
  const locRows = useMemo(() => despatchLocationRowsFor(selectedLead, customers, cityList), [selectedLead, customers, cityList]);
  const inMaster = !!selectedLead && masterRowsFor(selectedLead.client_name, customers).length > 0;
  const kind = despatchKind(form.dispatchForm);
  const fields = DESPATCH_FIELDS[kind] || [];
  const shown = fields.filter((f) => !f.when || String(csa[fields[0].k] || '') === f.when);
  const bulk = kind === 'bulk' ? bulkBagTotals(csa) : null;

  /** A new lead / category / despatch form: the measurements of the old form never leak into the new one. */
  function pickLead(id) {
    set({ leadId: id, dispatchForm: '' });
    setCsa((c) => ({ ...commonOnly(c), despatch_key: '', despatch_location: '', warehouse_name: '' }));
  }
  function pickCategory(v) {
    set({ category: v, dispatchForm: '' });
    setCsa(commonOnly);
  }
  function pickDespatchForm(v) {
    if (despatchKind(v) !== kind) setCsa(commonOnly);
    set({ dispatchForm: v });
  }
  function pickLocation(key) {
    const row = locRows.find((r) => r.key === key) || null;
    if (!key) setC({ despatch_key: '', despatch_location: '', warehouse_name: '' });
    else if (row) setC({ despatch_key: key, despatch_location: row.location, warehouse_name: row.warehouse });
  }

  /** §29 / 30.09 §SK3: the radio beside a SKU brings ALL of it back into the form — despatch details included. */
  function editSku(sku) {
    const lead = leadOf(sku.lead_id);
    const isCust = book.customers.some((l) => l.id === sku.lead_id);
    setEditing(sku.id);
    setForm({
      kind: isCust ? 'customer' : 'lead', leadId: lead ? lead.id : '', name: sku.sku_name || '', category: sku.category || '',
      dispatchForm: sku.dispatch_form || sku.dispatch_type || '', structure: sku.structure || '',
      structureLayers: Array.isArray(sku.structure_layers) && sku.structure_layers.length
        ? sku.structure_layers : subLayersFromStructure(sku.structure),
      sampleReceived: sku.sample_received === 'Yes' || sku.sample_received === true || (sku.csa_requested && sku.sample_received !== 'No') ? 'Yes' : 'No',
    });
    setCsa(csaFormFrom(csaDetailsOf(sku)));
    setMsg(null);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* jsdom */ }
  }
  function cancelEdit() { setEditing(''); setForm(blankForm()); setCsa(blankCsa()); }

  /** What the form says about the SKU itself — written on Add, Save and Send alike. */
  const identity = (now) => ({
    lead_id: form.leadId, sku_name: String(form.name || '').trim(), category: form.category, dispatch_form: form.dispatchForm,
    structure: String(form.structure || '').trim(), structure_layers: form.structureLayers,
    sample_received: form.sampleReceived === 'Yes' ? 'Yes' : 'No',
    ...(form.sampleReceived === 'Yes' ? { sample_received_at: now } : {}),
  });

  /** Add a new SKU, or save the corrections to the one under edit — despatch details with it. */
  async function saveSku() {
    setBusy(true);
    try {
      const now = new Date();
      const draft = buildCsaDraft(csa, form.dispatchForm, { now });
      // the quote desk reads the target price off the SKU; nobody else is shown it
      const extra = { csa_draft: draft, target_price: draft.target_price };
      if (editing) {
        buildSku(form, repId);   // same checks as a new SKU
        await save('sales', (prev) => ({
          ...(prev || {}),
          skus: ((prev && prev.skus) || []).map((sk) => (sk.id === editing
            ? { ...sk, ...identity(sk.sample_received_at || now.toISOString()), ...extra }
            : sk)),
        }), { retry: true });
        flash('g', '✓ SKU updated — despatch details saved with it.');
        cancelEdit();
      } else {
        const sku = { ...buildSku(form, repId, { now }), ...identity(now.toISOString()), ...extra };
        await save('sales', (prev) => ({ ...(prev || {}), skus: [...((prev && prev.skus) || []), sku] }), { retry: true });
        setForm(blankForm()); setCsa(blankCsa());
        flash('g', '✓ SKU added with its despatch details. Send it for CSA from this form whenever you are ready — pick it in the list below.');
      }
    } catch (e) { flash('r', e && e.code === 'conflict' ? saveErrorText(e) : e.message); } finally { setBusy(false); }
  }

  /**
   * §15 / 30.09 §SK4: "Send for CSA to QC" — the requisition goes to the QC login's
   * pending list. Works straight from Add SKU: a new SKU is added and sent in one go.
   */
  async function sendForCsa() {
    const existing = editing ? skus.find((x) => x.id === editing) || null : null;
    const now = new Date();
    let base;
    let request;
    try {
      if (editing && !existing) throw new Error('That SKU no longer exists — pick it again from the list.');
      const built = buildSku(form, repId, { now });   // the same checks as Add SKU
      base = { ...(existing || built), ...identity((existing && existing.sample_received_at) || now.toISOString()) };
      request = buildCsaRequest({ ...csa, sample_received: form.sampleReceived }, base, { now, user: user || repId });
    } catch (e) { flash('r', e.message); return; }
    const draft = { ...buildCsaDraft(csa, form.dispatchForm, { now }), saved_at: request.sent_at };
    const extra = { csa_draft: draft, target_price: draft.target_price };
    setBusy(true);
    try {
      await save('sales', (prev) => {
        const cur = prev || {};
        const list = cur.skus || [];
        const withSku = existing
          ? list.map((sk) => (sk.id === base.id ? { ...sk, ...identity(sk.sample_received_at || now.toISOString()), ...extra } : sk))
          : [...list, { ...base, ...extra }];
        return { ...cur, skus: sendSkuForCsa(withSku, base.id, request) };
      }, { retry: true });
      flash('g', `✓ ${base.sku_name} sent to QC for the CSA report — it is now on QC's "Samples pending analysis" list.`);
      cancelEdit();
    } catch (e) { flash('r', saveErrorText(e)); } finally { setBusy(false); }
  }

  const editingSku = editing ? skus.find((x) => x.id === editing) || null : null;
  const csaSent = !!(editingSku && editingSku.csa_requested);
  const csaDoneFor = editingSku ? skuCsaDone(sales, editingSku) : false;
  const statusTag = (sk) => {
    const st = quoteStatusOf(sales, sk);
    if (sk.csa_requested && !skuCsaDone(sales, sk)) return <span className="tag ty" style={{ fontSize: 9 }}>CSA with QC</span>;
    if (st === 'accepted') return <span className="tag tg" style={{ fontSize: 9 }}>Quote accepted</span>;
    if (st === 'sent') return <span className="tag tb" style={{ fontSize: 9 }}>Quote sent</span>;
    if (st === 'to_send') return <span className="tag ty" style={{ fontSize: 9 }}>Quote to send</span>;
    if (skuCsaDone(sales, sk)) return <span className="tag tb" style={{ fontSize: 9 }}>CSA done</span>;
    return <span className="tag" style={{ fontSize: 9 }}>New</span>;
  };
  const stageOn = (sk, key) => (key === 'csa_received' ? skuCsaDone(sales, sk) : !!sk[key]);
  const selectedLocLabel = csa.despatch_location ? csa.despatch_location + (csa.warehouse_name ? ` (${csa.warehouse_name})` : '') : '';

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
          Pick the lead or customer, then the SKU with its structure and its despatch details. They are kept with the SKU;
          <b> Send for CSA to QC</b> hands them to QC for the CSA report — straight from here, for a new SKU too.
        </div>
        {editingSku && (
          <div className={'al ' + (csaDoneFor ? 'al-g' : csaSent ? 'al-b' : 'al-y')} aria-label="CSA status">
            {csaDoneFor ? 'QC has completed the CSA report for this SKU.'
              : csaSent ? `Sent to QC on ${fmtDate(String((editingSku.csa_request || {}).sent_at || '').slice(0, 10))} — waiting for the CSA report. Sending again replaces the requisition.`
                : 'Not sent for CSA yet — fill in the despatch details below and send it to QC.'}
          </div>
        )}
        <div className="g3">
          <LeadCustomerPicker book={book} kind={form.kind} leadId={form.leadId}
            onKind={(k) => { set({ kind: k }); pickLead(''); }} onLead={pickLead} ariaPrefix="SKU" />
          <div className="fg"><label>SKU Name *</label>
            <input value={form.name} aria-label="SKU Name" placeholder="e.g. 200g Turmeric Pouch" onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="fg"><label>Structure</label>
            <input value={form.structure} aria-label="Structure" readOnly
              placeholder="Built from the substrates below"
              style={{ background: 'var(--bg)' }} />
          </div>
          <div className="fg"><label>Category *</label>
            <select value={form.category} aria-label="Category" onChange={(e) => pickCategory(e.target.value)}>
              <option value="">-- Select --</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="fg"><label>Despatch Form *</label>
            <select value={form.dispatchForm} aria-label="Despatch Form" onChange={(e) => pickDespatchForm(e.target.value)}>
              <option value="">-- Select --</option>
              {despatchOptions.map((d) => <option key={d[0]} value={d[0]}>{d[1]}</option>)}
              {formOffList && <option value={form.dispatchForm}>{form.dispatchForm} (not allowed for this category)</option>}
            </select>
            {restricted && <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 4 }}>Restricted to the despatch forms approved for “{form.category}” with this customer.</div>}
          </div>
          <div className="fg"><label>Sample received?</label>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, minHeight: 34, alignItems: 'center' }} role="radiogroup" aria-label="Sample received">
              {['Yes', 'No'].map((v) => (
                <label key={v} className="cb"><input type="radio" name="sample-received" value={v} checked={form.sampleReceived === v} aria-label={`Sample received ${v}`} onChange={() => set({ sampleReceived: v })} /><span>{v}</span></label>
              ))}
            </div>
          </div>
          <SubstrateLayers layers={form.structureLayers}
            onChange={(ls) => set({ structureLayers: ls, structure: structureFromSubLayers(ls) })} />
        </div>

        {/* 30.09 §SK1 / §SK2: the despatch details belong to Add SKU itself — not a
            panel that opened only after the SKU was added, picked again and marked
            "sample received", which is why the client never found them. */}
        <div style={{ marginTop: 6, padding: '10px 12px', border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg)' }} aria-label="Despatch details">
          <div className="ctitle" style={{ fontSize: 12 }}>🚚 Despatch details</div>
          <div className="g4">
            <div className="fg"><label>Despatch location *</label>
              <select value={csa.despatch_key} aria-label="Despatch location" disabled={!selectedLead} onChange={(e) => pickLocation(e.target.value)}>
                <option value="">-- Select --</option>
                {locRows.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                {csa.despatch_key && !locRows.some((r) => r.key === csa.despatch_key) && <option value={csa.despatch_key}>{selectedLocLabel} (no longer listed)</option>}
              </select>
              <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>
                {!selectedLead ? 'Pick the lead or customer first.'
                  : inMaster ? 'From the Super Admin’s Customer Master.'
                    : 'Not in the Customer Master yet — the lead’s own city and the Super Admin’s Locations list.'}
              </div>
            </div>
            <div className="fg"><label>Tentative order quantity *</label><input type="number" min="0" step="any" value={csa.tentative_qty} aria-label="Tentative order quantity" onChange={(e) => setC({ tentative_qty: e.target.value })} /></div>
            <div className="fg"><label>Tentative despatch date *</label><input type="date" value={csa.tentative_date} aria-label="Tentative despatch date" onChange={(e) => setC({ tentative_date: e.target.value })} /></div>
            <div className="fg"><label>Target price (₹) *</label>
              <input type="number" min="0" step="0.01" value={csa.target_price} aria-label="Target price" onChange={(e) => setC({ target_price: e.target.value })} />
              {/* 29.09 ¶26: "Target price (This shall only be visible in quote login)." */}
              <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>Seen by the quote desk only — QC is not shown it.</div>
            </div>
          </div>
          {!form.dispatchForm ? (
            <div style={{ fontSize: 11, color: 'var(--i3)' }}>Pick the Despatch Form above — its own measurements appear here.</div>
          ) : shown.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, margin: '6px 0 2px' }}>{form.dispatchForm} — details</div>
              <div className="g4" aria-label="Despatch form details">
                {shown.map((f) => <DespatchField key={f.k} f={f} csa={csa} onChange={setC} />)}
              </div>
              {bulk && (
                <div className="al al-b" aria-label="Bulk bag totals">
                  Total gusset <b>{bulk.totalGusset} mm</b> · total pouch height <b>{bulk.totalHeight} mm</b> · pouch width <b>{bulk.totalWidth} mm</b>
                  <span style={{ color: 'var(--i3)' }}> (gusset × 2 for a bottom gusset, × 4 for a side gusset; height + gusset × 2 for a bottom gusset; width + gusset × 4 for a side gusset)</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="act">
          <button className="btn btn-g" onClick={saveSku} disabled={busy}>{editing ? '✓ Save SKU' : '✓ Add SKU'}</button>
          <button className="btn btn-b" onClick={sendForCsa} disabled={busy}>{csaSent ? '🧪 Send again for CSA to QC' : '🧪 Send for CSA to QC'}</button>
        </div>
      </div>

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>My SKUs — workflow <span className="tag tgr">{mine.length}</span></div>
        </div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Pick the radio button to correct a SKU — its despatch details come back with it — or to send it for CSA. The stages are
          set by QC and the quote desk; prices are on the Quotations tab. Stages marked * must be done before a PO can be entered.
        </div>
        <div className="tw sy">
          <table>
            <thead><tr>
              <th style={{ width: 34, textAlign: 'center' }}></th><th>SKU</th><th>Lead / Customer</th><th style={{ minWidth: 130 }}>Category / Despatch</th><th>Structure</th><th>Status</th><th style={{ minWidth: 320 }}>Workflow stage</th>
            </tr></thead>
            <tbody>
              {mine.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No SKUs yet</td></tr>
              ) : mine.map((sku) => {
                const ready = skuReadyForPO(sales, sku);
                const plates = platesForSku(sales, sku);
                return (
                  <tr key={sku.id} className={editing === sku.id ? 'hi' : undefined}>
                    {/* 30.09 §SL1: the radio and the name share the row's middle line */}
                    <td className="rowsel" style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                      <input type="radio" name="sku-edit" checked={editing === sku.id} style={{ margin: 0, verticalAlign: 'middle' }} aria-label={`Edit ${sku.sku_name}`} onChange={() => editSku(sku)} />
                    </td>
                    <td style={{ fontWeight: 700 }}>{sku.sku_name}{sku.jss_spec ? <div style={{ fontSize: 10, color: 'var(--blu)' }}>JSS {sku.jss_spec}</div> : null}</td>
                    <td>{leadName(sku.lead_id)}</td>
                    <td>
                      <span className="tag tb">{sku.category || '—'}</span>
                      <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>{sku.dispatch_form || sku.dispatch_type || '—'}</div>
                    </td>
                    <td style={{ fontSize: 11 }}>{sku.structure || '—'}</td>
                    <td>{statusTag(sku)}</td>
                    <td aria-label={`Workflow stages of ${sku.sku_name}`}>
                      {REP_SKU_STAGES.filter(([k]) => k !== 'sample_received' && k !== 'sample_sent').map(([key, label, mandatory]) => (
                        <StagePill key={key} on={stageOn(sku, key)} label={label} mandatory={mandatory} />
                      ))}
                      {plates && (
                        <div style={{ marginTop: 4, fontSize: 10, color: '#8a6d00', background: '#fff8e6', border: '1px solid #f0e2b8', borderRadius: 5, padding: '3px 7px', display: 'inline-block' }}>
                          🧾 Plate cost (from PM): CI ₹{plates.p.ci_per || 0}×{plates.p.ci_n || 0}, Offset ₹{plates.p.off_per || 0}×{plates.p.off_n || 0} = <b>₹{Math.round(plates.total)}</b>
                        </div>
                      )}
                      <div style={{ marginTop: 4 }}>
                        {ready
                          ? <span style={{ fontSize: 10, color: '#1e7e34', fontWeight: 700 }}>✓ Ready for PO{sku.jss_spec ? '' : ' — waiting for QC to create the JSS'}</span>
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
    </>
  );
}
