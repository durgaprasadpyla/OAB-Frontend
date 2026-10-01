import { useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { num, today } from '../lib/format.js';
import { pouchWeightQC } from '../lib/calc.js';
import { groupOptions, specGroup } from '../lib/master.js';
import { materialKey } from '../lib/material.js';
import SpecFields from '../components/SpecFields.jsx';
import { ddList } from '../lib/dropdowns.js';
import {
  blankLayer, layerFields, layerCountFor, materialOptions, specialtyOptions, micronOptions, isLaminateJobType,
} from '../lib/jssSpec.js';
import { useApi } from '../lib/useApi.js';
import { useFreshModule } from '../lib/useFreshModule.js';
import { exportAOA } from '../lib/xlsx.js';
import { masterApi } from '../api.js';
import JssPlanningPanel from '../components/JssPlanningPanel.jsx';
import SoBomDownloads from '../components/SoBomDownloads.jsx';
import CapaPanel from '../components/CapaPanel.jsx';
import CertificatePanel from '../components/CertificatePanel.jsx';
import CsaPanel from '../components/CsaPanel.jsx';
import CsaToJssPanel from '../components/CsaToJssPanel.jsx';

// QC / JSS spec entry, ported from the legacy showQCView + initQCForm +
// saveQCSpec + qcCalcPW + renderQCTable + exportJSSExcel. Persists to the
// shared `jss` module via useData().save('jss', nextArray).

const DISPATCH_FORMS = ['Pouch', 'Bulk Bag', 'Roll', 'Label'];
const STATUSES = ['Active', 'Sample', 'Inactive', 'Redundant'];

// A fresh, empty entry form. Every value is picked from a master — JSS+QC 24.09:
// "Let us not allow any text inputs from the QC login … Only the job name can be
// added by the QC". The film is three LAYERS chosen from the Item Master, composed
// into the single `material` string the rest of the tool reads.
const BLANK = {
  group: '', customer: '', subBrand: '', jobName: '', jobType: '',
  layers: [blankLayer(), blankLayer(), blankLayer()],
  gsm: '', filmWidth: '', ups: '', width: '', height: '',
  gusset: '', pouchWeight: '', qtyPerBag: '', dispatchForm: '', status: 'Active',
};

// Status -> legacy .tag colour class.
function tagClass(status) {
  return { Active: 'tg', Sample: 'tb', Inactive: 'tgr', Redundant: 'tr' }[status] || 'ty';
}

/** Auto spec code = 'A' + (max numeric suffix among existing /^A(\d+)$/ specs) + 1. */
function nextSpecOf(jss) {
  const suffixes = (jss || [])
    .map((j) => { const m = /^A(\d+)$/.exec(String((j && j.spec) || '')); return m ? parseInt(m[1], 10) : null; })
    .filter((n) => n != null);
  return 'A' + ((suffixes.length ? Math.max(...suffixes) : 0) + 1);
}

/**
 * 30.09 QT6: the CSA's layers as JSS layers — each material, speciality and micron
 * matched to what the Item Master offers. A material the master does not carry is
 * left for QC to choose (and named), never written in as free text.
 * Returns { layers, filled, unknown }.
 */
export function csaLayersForJss(csaLayers, items) {
  const materials = materialOptions(items);
  const unknown = [];
  let filled = 0;
  const layers = [0, 1, 2].map((i) => {
    const l = (csaLayers || [])[i] || {};
    if (!String(l.material || '').trim()) return blankLayer();
    filled += 1;
    const known = materials.find((m) => materialKey(m) === materialKey(l.material));
    if (!known) { unknown.push(l.material); return blankLayer(); }
    const specialty = specialtyOptions(items, known).find((x) => materialKey(x) === materialKey(l.specialty)) || '';
    const microns = micronOptions(items, known, specialty).find((x) => String(l.microns || '').trim() !== '' && Number(x) === Number(l.microns)) || '';
    return { material: known, specialty, microns };
  });
  return { layers, filled, unknown };
}

// Legacy qcCalcPW: pouch weight in grams (QC variant, no sealing), reused from lib/calc.
function calcPouchGrams(form) {
  return pouchWeightQC({ height: form.height, gusset: form.gusset, width: form.width, gsm: form.gsm });
}

// A single label+input cell (legacy .fg). Defined at module scope so its
// identity is stable across renders (no focus loss on controlled inputs).
function Field({ label, value, onChange, readOnly = false, required = false, type = 'text', placeholder }) {
  return (
    <div className="fg">
      <label>{label}{required ? ' *' : ''}</label>
      <input
        type={type}
        value={value}
        aria-label={label}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={placeholder}
      />
    </div>
  );
}

export default function QC() {
  const { mods, save } = useData();
  const jss = Array.isArray(mods.jss) ? mods.jss : [];
  const customers = Array.isArray(mods.customers) ? mods.customers : [];
  // The Item Master — the only place a JSS material may come from now. Fetched once
  // here and handed to the form, so the page and its dropdowns read one list.
  const itemsApi = useApi('/api/master/items');
  const items = useMemo(() => (Array.isArray(itemsApi.data) ? itemsApi.data : []), [itemsApi.data]);
  const materials = useMemo(() => materialOptions(items), [items]);

  const [form, setForm] = useState(BLANK);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('spec');
  const [msg, setMsg] = useState(null); // { type: 'g' | 'r', text }
  const [busy, setBusy] = useState(false);
  // Issues 2.0: All-Specs filters — group / customer / status / JSS number.
  const [fGroup, setFGroup] = useState('');
  const [fCust, setFCust] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fSpec, setFSpec] = useState('');
  // Sales Login §63-65: the accepted CSA this JSS is being created from — Add Spec
  // writes the new spec code back onto that SKU.
  const [fromSku, setFromSku] = useState('');
  // 30.09 QT6: a JSS saved whose link onto the sales SKU did not — kept so QC can
  // retry the link rather than make the spec again
  const [pendingLink, setPendingLink] = useState(null);   // { skuId, spec, skuName }
  // 30.09: the CSA the rep accepted in another login is listed on opening this page
  useFreshModule('sales', tab);
  function pickCsa(skuId, fields) {
    setFromSku(skuId);
    const { material, layers: csaLayers, ...rest } = fields || {};
    const mapped = csaLayersForJss(csaLayers, items);
    // a CSA with no layered report yet: its structure text, as one material
    if (!mapped.filled && material) {
      const known = materials.find((m) => materialKey(m) === materialKey(material));
      mapped.layers = [{ ...blankLayer(), material: known || '' }, blankLayer(), blankLayer()];
    }
    const dispatch = rest.dispatchForm
      ? (dispatchOptions.find((o) => String(o).trim().toLowerCase() === String(rest.dispatchForm).trim().toLowerCase()) || '')
      : '';
    setForm((f) => ({ ...f, ...rest, dispatchForm: dispatch || f.dispatchForm, layers: mapped.layers }));
    const notes = ['Filled from the CSA — check the fields and press Add Spec.'];
    if (mapped.filled >= 2 && !isLaminateJobType(form.jobType)) {
      notes.push(`This CSA has ${mapped.filled} layers — pick a laminate Job Type to see layers 2 and 3.`);
    }
    if (mapped.unknown.length) notes.push(`The Item Master carries no ${mapped.unknown.join(', ')} — pick that layer's material.`);
    const made = jss.find((j) => String(j.fromSku || '') === String(skuId));
    if (made) notes.push(`JSS ${made.spec} was already made from this CSA — Add Spec links it to the SKU without a new number.`);
    setMsg({ type: 'g', text: notes.join(' ') });
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* jsdom */ }
  }

  /** §65: the JSS number goes onto the sales SKU, so the rep's PO can carry it. */
  async function linkSku(skuId, spec) {
    await save('sales', (prev) => ({
      ...(prev || {}),
      skus: ((prev && prev.skus) || []).map((sk) => (sk.id === skuId && !String(sk.jss_spec || '').trim()
        ? { ...sk, jss_spec: spec, jss_created_at: new Date().toISOString() } : sk)),
    }), { retry: true });
  }
  async function retryLink() {
    if (!pendingLink) return;
    setBusy(true);
    try {
      await linkSku(pendingLink.skuId, pendingLink.spec);
      setMsg({ type: 'g', text: `JSS ${pendingLink.spec} is on the sales SKU now.` });
      setPendingLink(null);
    } catch (e) {
      setMsg({ type: 'r', text: 'Linking failed again: ' + (e && e.message ? e.message : e) });
    } finally { setBusy(false); }
  }

  // Issues 2.0: the Dispatch Form options come from the Super Admin dashboard's
  // Drop-down Selections → despatch types (falling back to the legacy list only
  // when the master is empty/unreachable).
  const [dispatchTypes, setDispatchTypes] = useState([]);
  useEffect(() => {
    let live = true;
    masterApi.listDispatchTypes().then((d) => { if (live && Array.isArray(d)) setDispatchTypes(d.filter((t) => t.active !== false)); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const dispatchOptions = dispatchTypes.length ? dispatchTypes.map((t) => t.name) : DISPATCH_FORMS;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // The groups the All-Specs filter offers. The entry form's own Group / Customer
  // pickers live in SpecFields now, over the Customer Master.
  const groups = useMemo(() => groupOptions(customers, jss), [customers, jss]);
  // QC can no longer invent a group or a customer, so what is on the form IS what
  // is saved.
  const effGroup = String(form.group || '').trim();
  const effCustomer = String(form.customer || '').trim();
  // The job types the Super Admin maintains (Dashboard → Drop-down selections).
  const jobTypes = useMemo(() => ddList(mods.sales, 'jobTypes'), [mods.sales]);

  // Auto spec code = 'A' + (max numeric suffix among existing /^A(\d+)$/ specs) + 1.
  const nextSpec = useMemo(() => nextSpecOf(jss), [jss]);

  // Pouch weight is entered manually, but the ↺ button derives it from the
  // dimensions on demand (legacy qcCalcPW). The auto figure is also the fallback
  // used at save time when the field is left blank.
  const autoGrams = calcPouchGrams(form);
  function autoPW() {
    if (!(autoGrams > 0)) {
      setMsg({ type: 'r', text: 'Need Height, Width and GSM to calculate pouch weight.' });
      return;
    }
    setForm((f) => ({ ...f, pouchWeight: autoGrams.toFixed(4) }));
  }

  // Search over spec / customer / job name / material; newest first.
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = jss.slice().reverse();
    if (fGroup) list = list.filter((j) => (specGroup(j, customers) || '') === fGroup);
    if (fCust) list = list.filter((j) => String(j.customer || '').trim() === fCust);
    if (fStatus) list = list.filter((j) => String(j.status || 'Active') === fStatus);
    if (fSpec.trim()) list = list.filter((j) => String(j.spec || '').toLowerCase().includes(fSpec.trim().toLowerCase()));
    if (!s) return list;
    return list.filter((j) =>
      [j.spec, j.customer, j.jobName, j.material].some((v) => String(v || '').toLowerCase().includes(s)));
  }, [jss, q, fGroup, fCust, fStatus, fSpec, customers]);

  // Customer filter options — narrowed to the picked group's customers.
  const jssCustomerNames = useMemo(() => {
    const pool = fGroup ? jss.filter((j) => (specGroup(j, customers) || '') === fGroup) : jss;
    return [...new Set(pool.map((j) => String(j.customer || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [jss, customers, fGroup]);
  useEffect(() => { if (fCust && !jssCustomerNames.includes(fCust)) setFCust(''); }, [jssCustomerNames, fCust]);

  // Issues 2.0: QC may change ONLY the status of a JSS, straight from the list.
  async function setSpecStatus(spec, status) {
    const next = JSON.parse(JSON.stringify(jss));
    const row = next.find((j) => j.spec === spec);
    if (!row) return;
    row.status = status;
    setBusy(true);
    try { await save('jss', next); setMsg({ type: 'g', text: 'Status of ' + spec + ' → ' + status + '.' }); }
    catch (e) { setMsg({ type: 'r', text: 'Status change failed: ' + e.message }); }
    finally { setBusy(false); }
  }

  async function addSpec() {
    // 30.09 QT6: the orphan guard. A JSS already made from this CSA (its link onto
    // the SKU failed) is linked, not numbered again; a SKU that already carries a JSS
    // gets no second one.
    if (fromSku) {
      const skuNow = ((mods.sales && mods.sales.skus) || []).find((sk) => sk.id === fromSku);
      if (skuNow && String(skuNow.jss_spec || '').trim()) {
        setMsg({ type: 'r', text: `${skuNow.sku_name} already carries JSS ${skuNow.jss_spec} — no new spec made.` });
        setFromSku('');
        return;
      }
      const made = jss.find((j) => String(j.fromSku || '') === String(fromSku));
      if (made) {
        setBusy(true);
        try {
          await linkSku(fromSku, made.spec);
          setMsg({ type: 'g', text: `JSS ${made.spec} was already made from this CSA — it is linked to the sales SKU now (no new number).` });
          setFromSku('');
          setPendingLink(null);
        } catch (e) {
          setPendingLink({ skuId: fromSku, spec: made.spec, skuName: skuNow ? skuNow.sku_name : '' });
          setMsg({ type: 'r', text: 'Linking failed: ' + (e && e.message ? e.message : e) });
        } finally { setBusy(false); }
        return;
      }
    }
    const group = effGroup;
    const customer = effCustomer;
    const jobName = String(form.jobName || '').trim();
    const dispatchForm = form.dispatchForm;
    const layers = form.layers || [];
    const composed = layerFields(layers.slice(0, layerCountFor(form.jobType)));
    const material = composed.material;
    // Every field is a choice from a master now, so the check names the box that is
    // still empty rather than one catch-all sentence.
    const missing = [];
    if (!customer) missing.push('Customer');
    if (!jobName) missing.push('Job Name');
    if (!dispatchForm) missing.push('Dispatch Form');
    if (!String(form.jobType || '').trim()) missing.push('Job Type');
    if (!material) missing.push('Primary Material');
    if (missing.length) {
      setMsg({ type: 'r', text: 'Still to choose: ' + missing.join(', ') + '.' });
      return;
    }
    const row = {
      jobType: String(form.jobType || '').trim(),
      group,
      customer,
      subBrand: String(form.subBrand || '').trim(),
      jobName,
      gsm: parseFloat(form.gsm) || '',
      filmWidth: parseFloat(form.filmWidth) || '',
      ups: parseInt(form.ups, 10) || '',
      width: parseFloat(form.width) || '',
      height: parseFloat(form.height) || '',
      gusset: String(form.gusset).trim(),
      dispatchForm,
      status: form.status,
      // material / mic / structure and the per-layer fields, from the layers above
      ...composed,
    };
    // Manual pouch weight wins; otherwise fall back to the derived figure.
    // Packing standard: pcs per bag — drives the AUTO-GENERATED packing list.
    const qpb = parseInt(form.qtyPerBag, 10);
    if (qpb > 0) row.qtyPerBag = qpb;
    const pwManual = parseFloat(form.pouchWeight);
    const pw = (Number.isFinite(pwManual) && pwManual > 0) ? pwManual
      : (Number.isFinite(autoGrams) && autoGrams > 0 ? Number(autoGrams.toFixed(6)) : 0);
    if (pw > 0) row.pouchWeight = pw;
    // 30.09 QT6: which accepted CSA this spec was made from — what lets a re-pick
    // link it instead of numbering a duplicate when the SKU link did not save
    if (fromSku) row.fromSku = fromSku;

    setBusy(true);
    let spec = nextSpec;
    try {
      // numbered on the server's copy (re-applied once if another QC saved first), so
      // two specs can never take one number
      await save('jss', (prev) => {
        const list = Array.isArray(prev) ? prev : [];
        spec = nextSpecOf(list);
        const maxSno = list.reduce((m, j) => Math.max(m, num(j.sno)), 0);
        return [...JSON.parse(JSON.stringify(list)), { sno: maxSno + 1, spec, ...row }];
      }, { retry: true });
      // §65: the JSS number goes back onto the SKU, so the rep's PO can carry it
      if (fromSku) {
        try {
          await linkSku(fromSku, spec);
        } catch (e) {
          const skuNow = ((mods.sales && mods.sales.skus) || []).find((sk) => sk.id === fromSku);
          setPendingLink({ skuId: fromSku, spec, skuName: skuNow ? skuNow.sku_name : '' });
          setMsg({ type: 'r', text: 'Spec ' + spec + ' saved, but it could not be written onto the sales SKU: ' + (e && e.message ? e.message : e) });
          setBusy(false); setFromSku('');
          return;
        }
        setFromSku('');
      }
      setMsg({ type: 'g', text: 'Spec ' + spec + ' saved successfully.' + (fromSku ? ' The JSS number is on the sales SKU now.' : ' Next spec ready.') });
      // Reset entry fields but keep the group + customer for fast repeat entry.
      setForm((f) => ({ ...BLANK, layers: [blankLayer(), blankLayer(), blankLayer()], group: f.group, customer: f.customer }));
    } catch (e) {
      setMsg({ type: 'r', text: 'Save failed: ' + (e && e.message ? e.message : String(e)) });
    } finally {
      setBusy(false);
    }
  }

  function exportExcel() {
    if (!jss.length) { setMsg({ type: 'r', text: 'No JSS data to export.' }); return; }
    // Issues 2.0: Machine Run On + Print Loc deleted from the JSS completely.
    const header = ['Spec', 'Job Type', 'Group', 'Customer', 'Sub Brand', 'Job Name', 'MIC', 'GSM',
      'Material', 'Film Width', 'Ups', 'Width', 'Height', 'Gusset', 'Dispatch Form', 'Status'];
    const rows = jss.map((j) => {
      // Group: the spec's stored group if set, else derived from the customer list.
      const grp = specGroup(j, customers) || j.group || '';
      return [j.spec, j.jobType, grp, j.customer, j.subBrand, j.jobName, j.mic,
        j.gsm, j.material, j.filmWidth, j.ups, j.width, j.height, j.gusset, j.dispatchForm, j.status]
        .map((v) => (v == null ? '' : v));
    });
    exportAOA([header, ...rows], 'Bloomflex_JSS_Master_' + today().replace(/-/g, '_'), 'JSS Master');
  }

  if (tab === 'planning') {
    return (
      <div id="app">
        <div className="pg-ttl">QC — Route and BOM</div>
        <QcTabs tab={tab} setTab={setTab} />
        <JssPlanningPanel />
        {/* Issues 3.0: QC writes the recipe, so QC can take the sale-order sheet too. */}
        <SoBomDownloads compact />
      </div>
    );
  }
  if (tab === 'cert') {
    return (
      <div id="app">
        <div className="pg-ttl">QC</div>
        <QcTabs tab={tab} setTab={setTab} />
        <CertificatePanel />
      </div>
    );
  }
  if (tab === 'csa') {
    return (
      <div id="app">
        <div className="pg-ttl">QC</div>
        <QcTabs tab={tab} setTab={setTab} />
        <CsaPanel role="qc" />
      </div>
    );
  }
  if (tab === 'capa') {
    return (
      <div id="app">
        <div className="pg-ttl">QC</div>
        <QcTabs tab={tab} setTab={setTab} />
        <CapaPanel />
      </div>
    );
  }

  return (
    <div id="app">
      <div className="pg-ttl">QC — JSS Spec Entry</div>
      <QcTabs tab={tab} setTab={setTab} />
      <div className="pg-sub">Add a new JSS master spec and review the full spec list.</div>

      <CsaToJssPanel picked={fromSku} onPick={pickCsa} />

      <div className="card">
        <div className="ctitle">Add New Spec{fromSku ? <span className="tag tb" style={{ marginLeft: 8, fontSize: 10 }}>from CSA</span> : null}</div>
        {msg && <div className={'al al-' + msg.type}>{msg.text}</div>}
        {pendingLink && (
          <div className="al al-y" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>JSS {pendingLink.spec} is saved but not yet on the sales SKU{pendingLink.skuName ? ` ${pendingLink.skuName}` : ''}.</span>
            <button className="btn btn-s" onClick={retryLink} disabled={busy}>↻ Retry linking {pendingLink.spec} to the SKU</button>
          </div>
        )}

        <div className="pg-sub" style={{ marginTop: 0 }}>
          Everything here is chosen from a master the business maintains — the Job Name is the only thing typed.
          The material layers, their speciality, micron and the film width come from the Item Master.
        </div>

        <SpecFields
          form={form}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          customers={customers}
          jss={jss}
          jobTypes={jobTypes}
          dispatchOptions={dispatchOptions}
          statuses={STATUSES}
          items={items}
          canAddNew={false}
          specCode={nextSpec}
          showStatus
        />

        <div className="g4">
          <div className="fg">
            <label>Pouch Weight (g)</label>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <input
                value={form.pouchWeight}
                onChange={set('pouchWeight')}
                placeholder="auto or enter manually"
                aria-label="Pouch Weight (g)"
                style={{ flex: 1 }}
              />
              <button
                type="button" className="btn btn-g" onClick={autoPW}
                title="Calculate from Height, Width, Gusset & GSM"
                aria-label="Auto-calculate pouch weight"
                style={{ height: 32, width: 32, flexShrink: 0, padding: 0 }}
              >↺</button>
            </div>
          </div>
          <div className="fg" />
          <div className="fg" />
          <div className="fg" />
        </div>

        <div className="act">
          <button className="btn btn-g" onClick={addSpec} disabled={busy}>
            {busy ? 'Saving...' : 'Add Spec'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="ctitle">All Specs ({filtered.length})</div>
        <div className="fbar" style={{ flexWrap: 'wrap' }}>
          <input
            placeholder="Search spec / customer / job / material"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: '220px' }}
          />
          <select value={fGroup} onChange={(e) => setFGroup(e.target.value)} aria-label="Filter by group">
            <option value="">All Groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={fCust} onChange={(e) => setFCust(e.target.value)} aria-label="Filter by customer">
            <option value="">All Customers</option>
            {jssCustomerNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All Statuses</option>
            {STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <input placeholder="JSS number…" value={fSpec} onChange={(e) => setFSpec(e.target.value)}
            aria-label="Filter by JSS number" style={{ width: 110 }} />
          <div style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={exportExcel} disabled={!jss.length}>Export JSS Excel</button>
        </div>

        <div className="tw sy">
          <table>
            <thead>
              <tr>
                <th>Spec</th>
                <th>Group</th>
                <th>Customer</th>
                <th>Sub Brand</th>
                <th>Job Name</th>
                <th>Material</th>
                <th style={{ textAlign: 'right' }}>Film W</th>
                <th style={{ textAlign: 'right' }}>Width</th>
                <th style={{ textAlign: 'right' }}>Height</th>
                <th style={{ textAlign: 'right' }}>Weight (g)</th>
                <th>Form</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: 24, color: 'var(--i3)' }}>
                    No specs found
                  </td>
                </tr>
              ) : (
                filtered.map((j, i) => (
                  <tr key={(j.spec || '') + '-' + (j.sno != null ? j.sno : i)}>
                    <td style={{ fontWeight: 600, color: 'var(--g)' }}>{j.spec || '-'}</td>
                    <td>{specGroup(j, customers) || '-'}</td>
                    <td>{j.customer || '-'}</td>
                    <td>{j.subBrand || '-'}</td>
                    <td>{j.jobName || '-'}</td>
                    <td>{j.material || '-'}</td>
                    <td style={{ textAlign: 'right' }}>{j.filmWidth || '-'}</td>
                    <td style={{ textAlign: 'right' }}>{j.width || '-'}</td>
                    <td style={{ textAlign: 'right' }}>{j.height || '-'}</td>
                    <td style={{ textAlign: 'right' }}>{j.pouchWeight != null && j.pouchWeight !== '' ? parseFloat(j.pouchWeight).toFixed(2) : '-'}</td>
                    <td>{j.dispatchForm || '-'}</td>
                    <td>
                      {/* Issues 2.0: QC changes ONLY the status, right here. */}
                      <select className={'tag ' + tagClass(j.status)} value={j.status || 'Active'} disabled={busy}
                        aria-label={'Status of ' + j.spec}
                        onChange={(e) => setSpecStatus(j.spec, e.target.value)}
                        style={{ border: '1px solid var(--bd)', borderRadius: 6, fontSize: 11, padding: '2px 4px' }}>
                        {STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Labels and order match production's QC tab bar (qcSwitch).
const QC_TABS = [
  { k: 'spec', label: '➕ Add JSS Spec' },
  { k: 'planning', label: '🗺 Route and BOM' },
  { k: 'cert', label: '📄 Certificates (COA / Food Grade)' },
  { k: 'capa', label: '🛠 CAPA' },
  { k: 'csa', label: '🧪 CSA Reports' },
];

function QcTabs({ tab, setTab }) {
  return (
    <div className="step-bar" style={{ flexWrap: 'wrap' }}>
      {QC_TABS.map((t) => (
        <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
      ))}
    </div>
  );
}
