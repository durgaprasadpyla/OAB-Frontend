import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { num, today } from '../lib/format.js';
import { pouchWeightQC } from '../lib/calc.js';
import { custGroups, custsInGroup, specGroup } from '../lib/master.js';
import { exportAOA } from '../lib/xlsx.js';
import BomPanel from '../components/BomPanel.jsx';
import JssPlanningPanel from '../components/JssPlanningPanel.jsx';
import CapaPanel from '../components/CapaPanel.jsx';
import CertificatePanel from '../components/CertificatePanel.jsx';
import CsaPanel from '../components/CsaPanel.jsx';

// QC / JSS spec entry, ported from the legacy showQCView + initQCForm +
// saveQCSpec + qcCalcPW + renderQCTable + exportJSSExcel. Persists to the
// shared `jss` module via useData().save('jss', nextArray).

const DISPATCH_FORMS = ['Pouch', 'Bulk Bag', 'Roll', 'Label'];
const STATUSES = ['Active', 'Sample', 'Inactive', 'Redundant'];

// A fresh, empty entry form. Selects default the way the legacy form did.
const BLANK = {
  group: '', customer: '', subBrand: '', jobName: '', jobType: '', material: '',
  mic: '', gsm: '', filmWidth: '', ups: '', width: '', height: '',
  gusset: '', pouchWeight: '', qtyPerBag: '', dispatchForm: 'Pouch', machineRunOn: '', status: 'Active', printLoc: '',
};

// Status -> legacy .tag colour class.
function tagClass(status) {
  return { Active: 'tg', Sample: 'tb', Inactive: 'tgr', Redundant: 'tr' }[status] || 'ty';
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

  const [form, setForm] = useState(BLANK);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('spec');
  const [msg, setMsg] = useState(null); // { type: 'g' | 'r', text }
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Customer Master lookups: groups for the Group dropdown, and the companies
  // in the chosen group (blank group -> the ungrouped companies) for the
  // cascading Customer picker. (legacy qcPopulateGroups / qcPopulateCustomers)
  const groups = useMemo(() => custGroups(customers), [customers]);
  const custOptions = useMemo(() => custsInGroup(customers, form.group), [customers, form.group]);

  // Auto spec code = 'A' + (max numeric suffix among existing /^A(\d+)$/ specs) + 1.
  const nextSpec = useMemo(() => {
    const suffixes = jss
      .map((j) => { const m = /^A(\d+)$/.exec(String(j.spec || '')); return m ? parseInt(m[1], 10) : null; })
      .filter((n) => n != null);
    const max = suffixes.length ? Math.max(...suffixes) : 0;
    return 'A' + (max + 1);
  }, [jss]);

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
    const list = jss.slice().reverse();
    if (!s) return list;
    return list.filter((j) =>
      [j.spec, j.customer, j.jobName, j.material].some((v) => String(v || '').toLowerCase().includes(s)));
  }, [jss, q]);

  async function addSpec() {
    const group = form.group.trim();
    const customer = form.customer.trim();
    const jobName = form.jobName.trim();
    const material = form.material.trim();
    const dispatchForm = form.dispatchForm;
    // Legacy required-field rule (saveQCSpec, ~11227): a Group or a Company, plus
    // Job Name, Material and Dispatch Form.
    if ((!group && !customer) || !jobName || !material || !dispatchForm) {
      setMsg({ type: 'r', text: 'Please fill required fields: a Group or Company, plus Job Name, Material and Dispatch Form.' });
      return;
    }
    const spec = nextSpec;
    if (jss.some((j) => j.spec === spec)) {
      setMsg({ type: 'r', text: 'Spec ' + spec + ' already exists.' });
      return;
    }

    const maxSno = jss.reduce((m, j) => Math.max(m, num(j.sno)), 0);
    const row = {
      sno: maxSno + 1,
      spec,
      jobType: form.jobType.trim(),
      group,
      customer,
      subBrand: form.subBrand.trim(),
      jobName,
      printLoc: form.printLoc.trim(),
      mic: form.mic || '',
      gsm: parseFloat(form.gsm) || '',
      material,
      filmWidth: parseFloat(form.filmWidth) || '',
      ups: parseInt(form.ups, 10) || '',
      width: parseFloat(form.width) || '',
      height: parseFloat(form.height) || '',
      gusset: String(form.gusset).trim(),
      dispatchForm,
      machineRunOn: form.machineRunOn.trim(),
      status: form.status,
    };
    // Manual pouch weight wins; otherwise fall back to the derived figure.
    // Packing standard: pcs per bag — drives the AUTO-GENERATED packing list.
    const qpb = parseInt(form.qtyPerBag, 10);
    if (qpb > 0) row.qtyPerBag = qpb;
    const pwManual = parseFloat(form.pouchWeight);
    const pw = (Number.isFinite(pwManual) && pwManual > 0) ? pwManual
      : (Number.isFinite(autoGrams) && autoGrams > 0 ? Number(autoGrams.toFixed(6)) : 0);
    if (pw > 0) row.pouchWeight = pw;

    const next = JSON.parse(JSON.stringify(jss));
    next.push(row);

    setBusy(true);
    try {
      await save('jss', next);
      setMsg({ type: 'g', text: 'Spec ' + spec + ' saved successfully. Next spec ready.' });
      // Reset entry fields but keep the group + customer for fast repeat entry.
      setForm((f) => ({ ...BLANK, group: f.group, customer: f.customer }));
    } catch (e) {
      setMsg({ type: 'r', text: 'Save failed: ' + (e && e.message ? e.message : String(e)) });
    } finally {
      setBusy(false);
    }
  }

  function exportExcel() {
    if (!jss.length) { setMsg({ type: 'r', text: 'No JSS data to export.' }); return; }
    const header = ['Spec', 'Job Type', 'Group', 'Customer', 'Sub Brand', 'Job Name', 'Print Loc', 'MIC', 'GSM',
      'Material', 'Film Width', 'Ups', 'Width', 'Height', 'Gusset', 'Dispatch Form', 'Machine Run On', 'Status'];
    const rows = jss.map((j) => {
      // Group: the spec's stored group if set, else derived from the customer list.
      const grp = specGroup(j, customers) || j.group || '';
      return [j.spec, j.jobType, grp, j.customer, j.subBrand, j.jobName, j.printLoc, j.mic,
        j.gsm, j.material, j.filmWidth, j.ups, j.width, j.height, j.gusset, j.dispatchForm, j.machineRunOn, j.status]
        .map((v) => (v == null ? '' : v));
    });
    exportAOA([header, ...rows], 'Bloomflex_JSS_Master_' + today().replace(/-/g, '_'), 'JSS Master');
  }

  if (tab === 'planning') {
    return (
      <div id="app">
        <div className="pg-ttl">QC — JSS Planning</div>
        <QcTabs tab={tab} setTab={setTab} />
        <JssPlanningPanel />
      </div>
    );
  }
  if (tab === 'bom') {
    return (
      <div id="app">
        <div className="pg-ttl">QC</div>
        <QcTabs tab={tab} setTab={setTab} />
        <BomPanel />
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

      <div className="card">
        <div className="ctitle">Add New Spec</div>
        {msg && <div className={'al al-' + msg.type}>{msg.text}</div>}

        <div className="g4">
          <Field label="Spec Code" value={nextSpec} readOnly />
          <div className="fg">
            <label>Group</label>
            <select value={form.group} onChange={set('group')} aria-label="Group">
              <option value="">— No group —</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="fg">
            <label>Customer *</label>
            <input
              list="qc-cust-options"
              value={form.customer}
              onChange={set('customer')}
              placeholder={form.group ? 'Pick or type a company' : 'Pick or type (or leave to whole group)'}
            />
            <datalist id="qc-cust-options">
              {custOptions.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <Field label="Sub Brand" value={form.subBrand} onChange={set('subBrand')} />
        </div>

        <div className="g4">
          <Field label="Job Name" required value={form.jobName} onChange={set('jobName')} />
          <Field label="Job Type" value={form.jobType} onChange={set('jobType')} />
          <Field label="Material" required value={form.material} onChange={set('material')} />
          <div className="fg">
            <label>Dispatch Form *</label>
            <select value={form.dispatchForm} onChange={set('dispatchForm')}>
              {DISPATCH_FORMS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div className="g4">
          <Field label="MIC" type="number" value={form.mic} onChange={set('mic')} />
          <Field label="GSM" type="number" value={form.gsm} onChange={set('gsm')} />
          <Field label="Film Width" type="number" value={form.filmWidth} onChange={set('filmWidth')} />
          <Field label="Ups" type="number" value={form.ups} onChange={set('ups')} />
        </div>

        <div className="g4">
          <Field label="Width" type="number" value={form.width} onChange={set('width')} />
          <Field label="Height" type="number" value={form.height} onChange={set('height')} />
          <Field label="Gusset" value={form.gusset} onChange={set('gusset')} placeholder="e.g. 40 or 20+20" />
          <Field label="Qty per Bag (packing)" type="number" value={form.qtyPerBag} onChange={set('qtyPerBag')} placeholder="pcs per bag" />
          <div className="fg">
            <label>Pouch Weight (g)</label>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <input
                value={form.pouchWeight}
                onChange={set('pouchWeight')}
                placeholder="auto or enter manually"
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
        </div>

        <div className="g4">
          <Field label="Machine Run On" value={form.machineRunOn} onChange={set('machineRunOn')} />
          <Field label="Print Loc" value={form.printLoc} onChange={set('printLoc')} />
          <div className="fg">
            <label>Status</label>
            <select value={form.status} onChange={set('status')}>
              {STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div className="act">
          <button className="btn btn-g" onClick={addSpec} disabled={busy}>
            {busy ? 'Saving...' : 'Add Spec'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="ctitle">All Specs ({filtered.length})</div>
        <div className="fbar">
          <input
            placeholder="Search spec / customer / job / material"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: '260px' }}
          />
          <div style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={exportExcel} disabled={!jss.length}>Export JSS Excel</button>
        </div>

        <div className="tw sy">
          <table>
            <thead>
              <tr>
                <th>Spec</th>
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
                  <td colSpan={11} style={{ textAlign: 'center', padding: 24, color: 'var(--i3)' }}>
                    No specs found
                  </td>
                </tr>
              ) : (
                filtered.map((j, i) => (
                  <tr key={(j.spec || '') + '-' + (j.sno != null ? j.sno : i)}>
                    <td style={{ fontWeight: 600, color: 'var(--g)' }}>{j.spec || '-'}</td>
                    <td>{j.customer || '-'}</td>
                    <td>{j.subBrand || '-'}</td>
                    <td>{j.jobName || '-'}</td>
                    <td>{j.material || '-'}</td>
                    <td style={{ textAlign: 'right' }}>{j.filmWidth || '-'}</td>
                    <td style={{ textAlign: 'right' }}>{j.width || '-'}</td>
                    <td style={{ textAlign: 'right' }}>{j.height || '-'}</td>
                    <td style={{ textAlign: 'right' }}>{j.pouchWeight != null && j.pouchWeight !== '' ? parseFloat(j.pouchWeight).toFixed(2) : '-'}</td>
                    <td>{j.dispatchForm || '-'}</td>
                    <td><span className={'tag ' + tagClass(j.status)}>{j.status || 'Active'}</span></td>
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
  { k: 'planning', label: '🗺 JSS Planning' },
  { k: 'bom', label: '🧱 BOM (legacy)' },
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
