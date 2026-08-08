import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { num, today } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import CapaPanel from '../components/CapaPanel.jsx';

// QC / JSS spec entry, ported from the legacy showQCView + initQCForm +
// saveQCSpec + qcCalcPW + renderQCTable + exportJSSExcel. Persists to the
// shared `jss` module via useData().save('jss', nextArray).

const DISPATCH_FORMS = ['Pouch', 'Bulk Bag', 'Roll', 'Label'];
const STATUSES = ['Active', 'Sample', 'Inactive', 'Redundant'];

// A fresh, empty entry form. Selects default the way the legacy form did.
const BLANK = {
  customer: '', subBrand: '', jobName: '', jobType: '', material: '',
  mic: '', gsm: '', filmWidth: '', ups: '', width: '', height: '',
  gusset: '', dispatchForm: 'Pouch', machineRunOn: '', status: 'Active', printLoc: '',
};

// Status -> legacy .tag colour class.
function tagClass(status) {
  return { Active: 'tg', Sample: 'tb', Inactive: 'tgr', Redundant: 'tr' }[status] || 'ty';
}

// Legacy qcCalcPW: pouch weight in grams.
// grams = ((height*2) + gussetSum) * width * gsm / 1000000
// gussetSum = sum of String(gusset).split('+').map(Number)
function calcPouchGrams(form) {
  const gussetSum = String(form.gusset || '').split('+').map(Number).reduce((a, b) => a + b, 0);
  return ((num(form.height) * 2) + gussetSum) * num(form.width) * num(form.gsm) / 1000000;
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

  const [form, setForm] = useState(BLANK);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState(null); // { type: 'g' | 'r', text }
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Auto spec code = 'A' + (max numeric suffix among existing /^A(\d+)$/ specs) + 1.
  const nextSpec = useMemo(() => {
    const suffixes = jss
      .map((j) => { const m = /^A(\d+)$/.exec(String(j.spec || '')); return m ? parseInt(m[1], 10) : null; })
      .filter((n) => n != null);
    const max = suffixes.length ? Math.max(...suffixes) : 0;
    return 'A' + (max + 1);
  }, [jss]);

  // Live pouch weight (blank until height, width and gsm all yield a value).
  const grams = calcPouchGrams(form);
  const pwDisplay = grams ? grams.toFixed(4) : '';

  // Search over spec / customer / job name / material; newest first.
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = jss.slice().reverse();
    if (!s) return list;
    return list.filter((j) =>
      [j.spec, j.customer, j.jobName, j.material].some((v) => String(v || '').toLowerCase().includes(s)));
  }, [jss, q]);

  async function addSpec() {
    const customer = form.customer.trim();
    const jobName = form.jobName.trim();
    if (!customer || !jobName) {
      setMsg({ type: 'r', text: 'Please fill required fields: Customer and Job Name.' });
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
      customer,
      subBrand: form.subBrand.trim(),
      jobName,
      printLoc: form.printLoc.trim(),
      mic: form.mic || '',
      gsm: parseFloat(form.gsm) || '',
      material: form.material.trim(),
      filmWidth: parseFloat(form.filmWidth) || '',
      ups: parseInt(form.ups, 10) || '',
      width: parseFloat(form.width) || '',
      height: parseFloat(form.height) || '',
      gusset: String(form.gusset).trim(),
      dispatchForm: form.dispatchForm,
      machineRunOn: form.machineRunOn.trim(),
      status: form.status,
    };
    if (Number.isFinite(grams) && grams > 0) row.pouchWeight = Number(grams.toFixed(6));

    const next = JSON.parse(JSON.stringify(jss));
    next.push(row);

    setBusy(true);
    try {
      await save('jss', next);
      setMsg({ type: 'g', text: 'Spec ' + spec + ' saved successfully. Next spec ready.' });
      // Reset entry fields but keep the customer for fast repeat entry.
      setForm((f) => ({ ...BLANK, customer: f.customer }));
    } catch (e) {
      setMsg({ type: 'r', text: 'Save failed: ' + (e && e.message ? e.message : String(e)) });
    } finally {
      setBusy(false);
    }
  }

  function exportExcel() {
    if (!jss.length) { setMsg({ type: 'r', text: 'No JSS data to export.' }); return; }
    const header = ['Spec', 'Job Type', 'Customer', 'Sub Brand', 'Job Name', 'Print Loc', 'MIC', 'GSM',
      'Material', 'Film Width', 'Ups', 'Width', 'Height', 'Gusset', 'Dispatch Form', 'Machine Run On', 'Status'];
    const rows = jss.map((j) => [j.spec, j.jobType, j.customer, j.subBrand, j.jobName, j.printLoc, j.mic,
      j.gsm, j.material, j.filmWidth, j.ups, j.width, j.height, j.gusset, j.dispatchForm, j.machineRunOn, j.status]
      .map((v) => (v == null ? '' : v)));
    exportAOA([header, ...rows], 'Bloomflex_JSS_Master_' + today().replace(/-/g, '_'), 'JSS Master');
  }

  return (
    <div id="app">
      <div className="pg-ttl">QC — JSS Spec Entry</div>
      <div className="pg-sub">Add a new JSS master spec and review the full spec list.</div>

      <div className="card">
        <div className="ctitle">Add New Spec</div>
        {msg && <div className={'al al-' + msg.type}>{msg.text}</div>}

        <div className="g4">
          <Field label="Spec Code" value={nextSpec} readOnly />
          <Field label="Customer" required value={form.customer} onChange={set('customer')} />
          <Field label="Sub Brand" value={form.subBrand} onChange={set('subBrand')} />
          <Field label="Job Name" required value={form.jobName} onChange={set('jobName')} />
        </div>

        <div className="g4">
          <Field label="Job Type" value={form.jobType} onChange={set('jobType')} />
          <Field label="Material" value={form.material} onChange={set('material')} />
          <Field label="MIC" type="number" value={form.mic} onChange={set('mic')} />
          <Field label="GSM" type="number" value={form.gsm} onChange={set('gsm')} />
        </div>

        <div className="g4">
          <Field label="Film Width" type="number" value={form.filmWidth} onChange={set('filmWidth')} />
          <Field label="Ups" type="number" value={form.ups} onChange={set('ups')} />
          <Field label="Width" type="number" value={form.width} onChange={set('width')} />
          <Field label="Height" type="number" value={form.height} onChange={set('height')} />
        </div>

        <div className="g4">
          <Field label="Gusset" value={form.gusset} onChange={set('gusset')} placeholder="e.g. 40 or 20+20" />
          <Field label="Pouch Weight (g)" value={pwDisplay} readOnly placeholder="auto" />
          <Field label="Machine Run On" value={form.machineRunOn} onChange={set('machineRunOn')} />
          <Field label="Print Loc" value={form.printLoc} onChange={set('printLoc')} />
        </div>

        <div className="g4">
          <div className="fg">
            <label>Dispatch Form</label>
            <select value={form.dispatchForm} onChange={set('dispatchForm')}>
              {DISPATCH_FORMS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
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
                <th>Form</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--i3)' }}>
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
                    <td>{j.dispatchForm || '-'}</td>
                    <td><span className={'tag ' + tagClass(j.status)}>{j.status || 'Active'}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CapaPanel />
    </div>
  );
}
