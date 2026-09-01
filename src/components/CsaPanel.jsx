import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { custGroupOf, groupOptions } from '../lib/master.js';
import { useAuth } from '../auth.jsx';
import { fmtDate, inr } from '../lib/format.js';
import { platesTotal } from '../lib/sales.js';
import { ddList } from '../lib/dropdowns.js';
import {
  CSA_BLANK, DISPATCH_TYPES, YES_NO,
  csaPendingForQc, csaPendingForPlant, csaDoneForPlant, csaSampleDate, csaDaysSince,
  ageColor, csaCompanyItem, csaStructure, substrateList, substrateUnit,
  buildCsaReport, markSkuCsaReceived, answerCsaReport,
} from '../lib/csa.js';

// CSA panels shared by QC and PM over the sales blob (module 12).
//   <CsaPanel role="qc" />    QC writes the report from a pending sample
//   <CsaPanel role="pm" />    the plant comments on it and prices the plates

export default function CsaPanel({ role = 'qc' }) {
  return role === 'pm' ? <PlantCsa /> : <QcCsa />;
}

const patcher = (save) => (p) => save('sales', (prev) => ({ ...(prev || {}), ...p }));

function Age({ days }) {
  return <span style={{ color: ageColor(days), fontWeight: 700 }}>{days}d</span>;
}

/* ─────────────────────────── QC side ─────────────────────────── */
function QcCsa() {
  const { mods, save } = useData();
  const { user } = useAuth();
  const sales = mods.sales || {};
  const patch = patcher(save);

  const [draft, setDraft] = useState(null);   // { skuId, form } — skuId '' = direct
  const [viewing, setViewing] = useState(null);   // a report shown read-only
  const [q, setQ] = useState('');               // history search
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const pending = useMemo(() => csaPendingForQc(sales), [sales]);
  // Issues 2.0: group / customer / status filters on every QC table.
  const [fGroup, setFGroup] = useState('');
  const [fCust, setFCust] = useState('');
  const [fStatus, setFStatus] = useState('');
  const groups = useMemo(() => groupOptions(mods.customers, mods.jss), [mods.customers, mods.jss]);
  const csaCustNames = useMemo(
    () => [...new Set((sales.qc_reports || []).map((r) => String(csaCompanyItem(sales, r).company || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [sales]);
  const csaStatuses = useMemo(
    () => [...new Set((sales.qc_reports || []).map((r) => String(r.status || '').trim()).filter(Boolean))].sort(),
    [sales]);
  const reports = useMemo(() => {
    let list = (sales.qc_reports || []).slice()
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    if (fGroup) list = list.filter((r) => custGroupOf(csaCompanyItem(sales, r).company, mods.customers) === fGroup);
    if (fCust) list = list.filter((r) => String(csaCompanyItem(sales, r).company || '').trim() === fCust);
    if (fStatus) list = list.filter((r) => String(r.status || '').trim() === fStatus);
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((r) => {
      const ci = csaCompanyItem(sales, r);
      return [ci.company, ci.item, csaStructure(r)].some((v) => String(v || '').toLowerCase().includes(s));
    });
  }, [sales, q, fGroup, fCust, fStatus, mods.customers]);
  const leadName = (id) => ((sales.leads || []).find((l) => l.id === id) || {}).client_name || '—';

  // Re-approve: QC edited the report after the plant answered — flag it for
  // re-review so it re-enters the plant's pending queue. (legacy qcResubmit)
  async function reapprove(r) {
    const why = window.prompt('What did you change in the CSA report? It will go to the plant for re-review.', '');
    if (why === null) return;
    setBusy(true);
    setMsg(null);
    try {
      await patch({
        qc_reports: (sales.qc_reports || []).map((x) => (x.id === r.id
          ? { ...x, needs_pm_review: true, status: 'Pending Plant', qc_reapprove_note: String(why || ''), qc_reapproved_at: new Date().toISOString() }
          : x)),
      });
      setMsg({ t: 'g', text: '✅ Sent to the plant for re-review.' });
    } catch (e) {
      setMsg({ t: 'r', text: e.message || String(e) });
    } finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const report = buildCsaReport(draft.form, { sales, skuId: draft.skuId, user });
      await patch({
        qc_reports: [...(sales.qc_reports || []), report],
        skus: markSkuCsaReceived(sales.skus, draft.skuId),
      });
      setDraft(null);
      setMsg({ t: 'g', text: '✅ CSA report saved and sent to the plant.' });
    } catch (e) {
      setMsg({ t: 'r', text: e.message || String(e) });
    } finally { setBusy(false); }
  }

  if (draft) {
    return (
      <CsaForm
        draft={draft} setDraft={setDraft} sales={sales} msg={msg} busy={busy}
        onCancel={() => { setDraft(null); setMsg(null); }} onSubmit={submit}
      />
    );
  }

  if (viewing) {
    return <CsaReportView report={viewing} sales={sales} onClose={() => setViewing(null)} />;
  }

  return (
    <>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>🧪 Samples pending analysis <span className="tag tgr">{pending.length}</span></div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={() => setDraft({ skuId: '', form: { ...CSA_BLANK } })}>＋ Direct CSA report</button>
        </div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="pg-sub" style={{ marginTop: 0 }}>
          A sample appears here once the rep has marked it both received and sent, and no report exists yet.
        </div>
        <div className="tw sy" style={{ maxHeight: 300 }}>
          <table>
            <thead><tr><th style={{ minWidth: 160 }}>Customer</th><th>SKU</th><th>Dispatch</th><th>Sample date</th><th style={{ textAlign: 'center' }}>Waiting</th><th style={{ width: 150 }}></th></tr></thead>
            <tbody>
              {pending.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No samples pending from Sales</td></tr>
                : pending.map((sk) => {
                  const d = csaSampleDate(sk);
                  return (
                    <tr key={sk.id}>
                      <td style={{ fontWeight: 700 }}>{leadName(sk.lead_id)}</td>
                      <td>{sk.sku_name || '—'}</td>
                      <td style={{ fontSize: 11 }}>{sk.dispatch_form || sk.dispatch_type || '—'}</td>
                      <td style={{ fontSize: 11 }}>{d ? fmtDate(String(d).slice(0, 10)) : '—'}</td>
                      <td style={{ textAlign: 'center' }}><Age days={csaDaysSince(d)} /></td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn btn-g" style={{ height: 26, fontSize: 11 }} aria-label={`Add CSA report for ${sk.sku_name}`}
                          onClick={() => setDraft({ skuId: sk.id, form: { ...CSA_BLANK } })}>Add CSA Report</button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>CSA history <span className="tag tgr">{reports.length}</span></div>
          <span style={{ flex: 1 }} />
          <select value={fGroup} onChange={(e) => setFGroup(e.target.value)} aria-label="Filter CSA by group">
            <option value="">All Groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={fCust} onChange={(e) => setFCust(e.target.value)} aria-label="Filter CSA by customer">
            <option value="">All Customers</option>
            {csaCustNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter CSA by status">
            <option value="">All Statuses</option>
            {csaStatuses.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <input placeholder="Search customer / item / structure…" value={q} aria-label="Search CSA history" onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        </div>
        <div className="tw sy" style={{ maxHeight: 340 }}>
          <table>
            <thead><tr><th style={{ minWidth: 150 }}>Customer</th><th>Item</th><th>Structure</th><th>Source</th><th>Raised</th><th>Status</th><th>Plant comments</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {reports.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>{q ? 'No matching reports' : 'No reports yet'}</td></tr>
                : reports.map((r) => {
                  const ci = csaCompanyItem(sales, r);
                  const direct = r.source === 'direct';
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{ci.company}</td>
                      <td style={{ fontSize: 11 }}>{ci.item}</td>
                      <td style={{ fontSize: 11 }}>{csaStructure(r)}</td>
                      <td><span className={'tag ' + (direct ? 'ty' : 'tb')} style={{ fontSize: 9 }}>{direct ? 'Direct / Walk-in' : 'Sales OS'}</span></td>
                      <td style={{ fontSize: 11 }}>{r.created_at ? fmtDate(String(r.created_at).slice(0, 10)) : '—'}</td>
                      <td><span className={'tag ' + (r.status === 'Pending Plant' ? 'ty' : r.status === 'Quoted' ? 'tg' : 'tb')}>{r.status}</span></td>
                      <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{r.plant_comments || <span style={{ color: 'var(--i3)' }}>awaiting plant</span>}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }} aria-label={`View CSA for ${ci.item}`} onClick={() => setViewing(r)}>View</button>{' '}
                        <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px', color: '#8a6d00', borderColor: '#f2dfa0' }} aria-label={`Re-approve CSA for ${ci.item}`} onClick={() => reapprove(r)} disabled={busy}>✎ Re-approve</button>
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

/* ─────────────────────────── Read-only report view ─────────────────────────── */
// Port of legacy qcCsaView: the CSA report shown read-only, with the plant's
// answer (or an "awaiting plant" note) below it.
function CsaReportView({ report: r, sales, onClose }) {
  const ci = csaCompanyItem(sales, r);
  const rows = [
    ['Substrate 1', r.substrate1], ['Substrate 2', r.substrate2], ['Substrate 3', r.substrate3],
    ['Ink GSM', r.ink_gsm], ['Adhesive GSM', r.adhesive_gsm], ['Coating', r.coating],
    ['Film Width', r.film_width ? r.film_width + 'mm' : ''], ['Pouch Height', r.pouch_height ? r.pouch_height + 'mm' : ''],
    ['Pouch Width', r.pouch_width ? r.pouch_width + 'mm' : ''], ['Seal Width', r.seal_width ? r.seal_width + 'mm' : ''],
    ['GSM', r.gsm], ['Pouch Weight', r.pouch_weight ? r.pouch_weight + 'g' : ''], ['Pouches/kg', r.pouches_per_kg],
    ['Glue / tape', r.glue_tape], ['Printed', r.printed],
    ['Print Repeat', r.print_repeat ? r.print_repeat + 'mm' : ''], ['Sleeve Repeat', r.sleeve_repeat ? r.sleeve_repeat + 'mm' : ''],
  ].filter((f) => f[1] && String(f[1]) !== '0' && String(f[1]) !== '0mm');
  if (r.source === 'direct' && r.responsible_person) rows.unshift(['Responsible Person', r.responsible_person]);

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>🧪 CSA Report — {ci.item}</div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={onClose}>✕ Close</button>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        {ci.company}{r.dispatch_type ? ' · ' + r.dispatch_type : ''}
        {' · '}<span className="tag tgr" style={{ fontSize: 9 }}>{r.source === 'direct' ? 'Direct / Walk-in' : 'Sales OS'}</span>
      </div>
      <div className="g2">
        {rows.map((f, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--bd)', padding: '4px 0' }}>
            <span style={{ color: 'var(--i3)', fontSize: 12 }}>{f[0]}</span>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{String(f[1])}</span>
          </div>
        ))}
      </div>
      {r.plant_comment_req && <div className="al al-y" style={{ marginTop: 12 }}>QC asked: {r.plant_comment_req}</div>}
      {r.plant_comments
        ? <div className="al al-b" style={{ marginTop: 8 }}>🏭 Plant: {r.plant_comments}</div>
        : <div className="pg-sub" style={{ marginTop: 8, color: '#E67E22' }}>⏳ Awaiting plant review</div>}
    </div>
  );
}

/* ─────────────────────────── The CSA form ─────────────────────────── */
function CsaForm({ draft, setDraft, sales, msg, busy, onCancel, onSubmit }) {
  const direct = !draft.skuId;
  const f = draft.form;
  const set = (k, v) => setDraft((d) => ({ ...d, form: { ...d.form, [k]: v } }));
  const subs = substrateList(sales);
  const sku = (sales.skus || []).find((x) => x.id === draft.skuId);
  const lead = sku && (sales.leads || []).find((l) => l.id === sku.lead_id);

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>
          🧪 {direct ? 'Direct CSA report' : `CSA report — ${lead ? lead.client_name : ''} · ${sku ? sku.sku_name : ''}`}
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={onCancel}>← Back</button>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      {direct && (
        <div className="g4">
          <T label="Company *" v={f.company_name} on={(v) => set('company_name', v)} />
          <T label="Product description *" v={f.product_desc} on={(v) => set('product_desc', v)} />
          <S label="Dispatch type" v={f.dispatch_type} on={(v) => set('dispatch_type', v)} opts={ddList(sales, 'despatch')} />
          <S label="Responsible person *" v={f.responsible_person} on={(v) => set('responsible_person', v)} opts={ddList(sales, 'responsible')} />
        </div>
      )}

      <div className="ctitle" style={{ marginTop: 12 }}>Structure</div>
      {[1, 2, 3].map((n) => (
        <div className="g3" key={n}>
          <div className="fg">
            <label>Substrate {n}</label>
            <select value={f[`substrate${n}`]} aria-label={`Substrate ${n}`} onChange={(e) => set(`substrate${n}`, e.target.value)}>
              <option value="">—</option>
              {subs.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
            </select>
          </div>
          <N label={`Value (${substrateUnit(sales, f[`substrate${n}`])})`} v={f[`substrate${n}_val`]} on={(v) => set(`substrate${n}_val`, v)} aria={`Substrate ${n} value`} />
          <div />
        </div>
      ))}

      <div className="ctitle" style={{ marginTop: 12 }}>Measurements</div>
      <div className="g4">
        <N label="Ink GSM" v={f.ink_gsm} on={(v) => set('ink_gsm', v)} />
        <N label="Adhesive GSM" v={f.adhesive_gsm} on={(v) => set('adhesive_gsm', v)} />
        <T label="Coating" v={f.coating} on={(v) => set('coating', v)} />
        <N label="Film width" v={f.film_width} on={(v) => set('film_width', v)} />
        <N label="Pouch height" v={f.pouch_height} on={(v) => set('pouch_height', v)} />
        <N label="Pouch width" v={f.pouch_width} on={(v) => set('pouch_width', v)} />
        <N label="Seal width" v={f.seal_width} on={(v) => set('seal_width', v)} />
        <N label="GSM" v={f.gsm} on={(v) => set('gsm', v)} />
        <N label="Pouch weight" v={f.pouch_weight} on={(v) => set('pouch_weight', v)} />
        <N label="Pouches per kg" v={f.pouches_per_kg} on={(v) => set('pouches_per_kg', v)} />
        <N label="Print repeat" v={f.print_repeat} on={(v) => set('print_repeat', v)} />
        <N label="Sleeve repeat" v={f.sleeve_repeat} on={(v) => set('sleeve_repeat', v)} />
        <S label="Glue / tape" v={f.glue_tape} on={(v) => set('glue_tape', v)} opts={YES_NO} />
        <S label="Printed" v={f.printed} on={(v) => set('printed', v)} opts={YES_NO} />
      </div>

      <div className="fg">
        <label>Comment requested from the plant</label>
        <textarea rows={2} value={f.plant_comment_req} aria-label="Comment requested from the plant" onChange={(e) => set('plant_comment_req', e.target.value)} />
      </div>

      <div className="fbar">
        <span style={{ flex: 1 }} />
        <button className="btn btn-g" onClick={onSubmit} disabled={busy}>{busy ? 'Saving…' : '✓ Save CSA report'}</button>
      </div>
    </div>
  );
}

function T({ label, v, on }) {
  return <div className="fg"><label>{label}</label><input value={v ?? ''} aria-label={label.replace(' *', '')} onChange={(e) => on(e.target.value)} /></div>;
}
function N({ label, v, on, aria }) {
  return <div className="fg"><label>{label}</label><input type="number" step="0.1" value={v ?? ''} aria-label={aria || label} onChange={(e) => on(e.target.value)} /></div>;
}
function S({ label, v, on, opts }) {
  return (
    <div className="fg">
      <label>{label}</label>
      <select value={v ?? ''} aria-label={label.replace(' *', '')} onChange={(e) => on(e.target.value)}>
        <option value="">—</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/* ─────────────────────────── Plant (PM) side ─────────────────────────── */
function PlantCsa() {
  const { mods, save } = useData();
  const { user } = useAuth();
  const sales = mods.sales || {};
  const patch = patcher(save);

  const [openId, setOpenId] = useState(null);
  const [comments, setComments] = useState('');
  const [plate, setPlate] = useState({ ci_per: '', ci_n: '', off_per: '', off_n: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const pending = useMemo(() => csaPendingForPlant(sales), [sales]);
  const done = useMemo(() => csaDoneForPlant(sales), [sales]);

  function open(r) {
    setOpenId(r.id);
    setComments(r.plant_comments || '');
    setPlate({ ...(r.plates || { ci_per: '', ci_n: '', off_per: '', off_n: '' }) });
    setMsg(null);
  }

  async function submit(r) {
    if (!comments.trim()) { setMsg({ t: 'r', text: 'Enter your comments before submitting.' }); return; }
    setBusy(true);
    try {
      await patch({ qc_reports: answerCsaReport(sales.qc_reports, r.id, { comments, plates: plate, user }) });
      setOpenId(null);
      setMsg({ t: 'g', text: '✅ Comments sent back to QC.' });
    } catch (e) { setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) }); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">🧪 CSA awaiting plant comment <span className="tag tgr">{pending.length}</span></div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="tw sy" style={{ maxHeight: 400 }}>
          <table>
            <thead><tr><th style={{ minWidth: 150 }}>Customer</th><th>Item</th><th>Structure</th><th>Raised</th><th style={{ width: 120, textAlign: 'center' }}></th></tr></thead>
            <tbody>
              {pending.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>Nothing pending</td></tr>
                : pending.map((r) => (
                  <PlantCsaRow
                    key={r.id} r={r} sales={sales} actionable open={openId === r.id}
                    onOpen={() => (openId === r.id ? setOpenId(null) : open(r))}
                    comments={comments} setComments={setComments}
                    plate={plate} setPlate={setPlate} busy={busy} onSubmit={() => submit(r)}
                  />
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="ctitle">Answered <span className="tag tgr">{done.length}</span></div>
        <div className="tw sy" style={{ maxHeight: 320 }}>
          <table>
            <thead><tr><th style={{ minWidth: 150 }}>Customer</th><th>Item</th><th>Structure</th><th>Raised</th><th style={{ width: 120, textAlign: 'center' }}>Plate cost</th></tr></thead>
            <tbody>
              {done.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>Nothing answered yet</td></tr>
                : done.map((r) => (
                  <PlantCsaRow key={r.id} r={r} sales={sales} actionable={false} open={false} />
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/**
 * One CSA row for the plant, plus its expanded answer form.
 *
 * Defined at module scope on purpose: a component declared inside PlantCsa's
 * body would be a NEW component type on every render, so React would unmount
 * and remount this subtree on each keystroke and the inputs would lose what was
 * being typed.
 */
function PlantCsaRow({
  r, sales, actionable, open, onOpen, comments, setComments, plate, setPlate, busy, onSubmit,
}) {
  const ci = csaCompanyItem(sales, r);
  const days = csaDaysSince(r.created_at);
  return (
    <>
      <tr style={r.needs_pm_review ? { background: '#fffaf0' } : undefined}>
        <td style={{ fontWeight: 700 }}>{ci.company}</td>
        <td style={{ fontSize: 11 }}>{ci.item}</td>
        <td style={{ fontSize: 11 }}>{csaStructure(r)}</td>
        <td style={{ fontSize: 11 }}>
          {r.created_at ? fmtDate(String(r.created_at).slice(0, 10)) : '—'} {actionable && <Age days={days} />}
        </td>
        <td style={{ textAlign: 'center' }}>
          {actionable
            ? <button className="btn btn-g" style={{ height: 26, fontSize: 11 }} aria-label={`Answer CSA for ${ci.item}`} onClick={onOpen}>{open ? 'Close' : 'Comment'}</button>
            : <span style={{ fontSize: 11 }}>₹{inr(platesTotal(r.plates))}</span>}
        </td>
      </tr>
      {open && (
        <tr><td colSpan={5} style={{ background: 'var(--bg)', padding: 14 }}>
          {r.plant_comment_req && <div className="al al-y" style={{ marginTop: 0 }}>QC asked: {r.plant_comment_req}</div>}
          <div className="fg">
            <label>Plant comments *</label>
            <textarea rows={3} value={comments} aria-label="Plant comments" onChange={(e) => setComments(e.target.value)} />
          </div>
          <div className="ctitle" style={{ marginTop: 4 }}>Plate cost</div>
          <div className="g4" style={{ alignItems: 'end' }}>
            <N label="CI ₹ per plate" v={plate.ci_per} on={(v) => setPlate({ ...plate, ci_per: v })} aria="CI per plate" />
            <N label="CI plates" v={plate.ci_n} on={(v) => setPlate({ ...plate, ci_n: v })} aria="CI plates" />
            <N label="Offset ₹ per plate" v={plate.off_per} on={(v) => setPlate({ ...plate, off_per: v })} aria="Offset per plate" />
            <N label="Offset plates" v={plate.off_n} on={(v) => setPlate({ ...plate, off_n: v })} aria="Offset plates" />
          </div>
          <div className="fbar">
            <span style={{ fontSize: 12, fontWeight: 700 }}>Total plate cost: ₹{inr(platesTotal(plate))}</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-g" onClick={onSubmit} disabled={busy}>{busy ? 'Saving…' : '✓ Submit to QC'}</button>
          </div>
        </td></tr>
      )}
    </>
  );
}
