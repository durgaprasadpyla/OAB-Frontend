import { useCallback, useEffect, useMemo, useState } from 'react';
import { hrApi } from '../api.js';
import { fmtDate, today, inr } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { readAttachment, viewAttachment } from '../lib/attach.js';

// Human Resources workspace — the six tabs of the "HR MODULE" brief (2026-09).
//
//   Overview             the active roster: who reports to whom, where they sit,
//                        how long they have been here, when the next appraisal is due.
//   Employee details     the master list (with a tick where the Aadhaar is on file)
//                        and, above it, the editing form — pick a radio button and
//                        the employee comes to the top, exactly like the Item Master.
//   Salary & advances    the month's payroll (days present, deductions, the bank
//                        Excel) and the salary advances with their instalments.
//   Increments & Bonus   revised salaries with an effective-from date and the
//                        salary history; the annual bonus and what is still owed.
//   Leave details        leaves available, requests, the sheet the manager signs,
//                        and loss-of-pay once the entitlement is used up.
//   Admin details        current or left — with the last working day, the years of
//                        experience and why they left — plus the audit trail.
//
// Entirely API-driven (/api/hr/**); nothing here lives in a module blob. The
// backend gates the whole controller to HR + SUPERADMIN, so a wrong role gets a
// 403 and this page shows a clean "not permitted" state rather than empty tables.
// Departments come from the Super Admin's department master; designations are
// kept per department under Dashboard → Drop-down selections → Designations.

const TABS = [
  { k: 'overview', label: '📊 Overview' },
  { k: 'employees', label: '👥 Employee details' },
  { k: 'salaries', label: '💰 Salary & advances' },
  { k: 'increments', label: '📈 Increments & Bonus' },
  { k: 'leave', label: '🌴 Leave details' },
  { k: 'admin', label: '🛠 Admin details' },
];

const EMPTY_SALARY = { ctc: '', monthlyCash: '', apb: '', apbPayoutCount: '1', apbMonth1: '', apbMonth2: '', esi: '', pf: '', pt: '', insurance: '', takeHome: '' };
const EMPTY_EMP = {
  empCode: '', firstName: '', lastName: '', gender: '', dob: '', mobile: '', email: '', address: '',
  joiningDate: '', leavesEntitled: '', officialPhone: '',
  bankAccountName: '', bankAccountNo: '', bankIfsc: '', bankBranch: '',
  departmentId: '', designationId: '', reportingManagerId: '', employmentType: '', workLocation: '',
  aadhaarNo: '', panNo: '', previousEmployment: '', remarks: '', status: 'Active',
  salary: { ...EMPTY_SALARY },
};
const DOC_FIELDS = [
  { type: 'Aadhaar', label: 'Aadhaar card', flag: 'aadhaar' },
  { type: 'PAN', label: 'PAN card', flag: 'pan' },
  { type: 'Previous employment', label: 'Previous employment letters', flag: 'previousEmployment' },
  { type: 'Bank statement', label: 'Previous bank statements', flag: 'bankStatement' },
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NOT_CURRENT = ['Left', 'Resigned', 'Terminated', 'Inactive'];

const err = (e) => (e && e.message ? e.message : String(e));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v) => (v == null || v === '' ? '-' : '₹' + inr(Math.round(num(v) * 100) / 100, 2));
const thisMonth = () => today().slice(0, 7);
/** Take-home = CTC − APB − monthly cash − ESI − PF − PT − insurance. */
export function takeHomeOf(s) {
  return Math.max(0, num(s.ctc) - num(s.apb) - num(s.monthlyCash) - num(s.esi) - num(s.pf) - num(s.pt) - num(s.insurance));
}
/** Whole days from an ISO date to today (negative when the date is ahead). */
export function daysSince(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((t - d) / 86400000);
}
/** "3 years 4 months" between two ISO dates. */
export function experienceText(fromIso, toIso) {
  if (!fromIso) return '-';
  const a = new Date(String(fromIso).slice(0, 10) + 'T00:00:00');
  const b = toIso ? new Date(String(toIso).slice(0, 10) + 'T00:00:00') : new Date();
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return '-';
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  const y = Math.floor(months / 12), m = months % 12;
  return `${y} year${y === 1 ? '' : 's'} ${m} month${m === 1 ? '' : 's'}`;
}

/** Shared async-load helper: returns {data, loading, error, reload}. */
function useHr(fn, deps, initial) {
  const [state, setState] = useState({ data: initial, loading: true, error: '' });
  const run = useCallback(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    fn().then(
      (d) => { if (live) setState({ data: d, loading: false, error: '' }); },
      (e) => { if (live) setState({ data: initial, loading: false, error: err(e) }); },
    );
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(run, [run]);
  return { ...state, reload: run };
}

export default function HR() {
  const [tab, setTab] = useState('overview');
  return (
    <div id="app">
      <div className="pg-ttl">Human Resources</div>
      <div className="pg-sub">Employees, salaries, increments, bonus, leave and exits — served live from the HR tables.</div>
      <div className="step-bar" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'employees' && <Employees />}
      {tab === 'salaries' && <SalariesAndAdvances />}
      {tab === 'increments' && <IncrementsAndBonus />}
      {tab === 'leave' && <Leave />}
      {tab === 'admin' && <Admin />}
    </div>
  );
}

/** A 403 from the HR API means "your role may not see this", not an outage. */
function Problem({ error }) {
  if (!error) return null;
  const forbidden = /403|forbidden/i.test(error);
  return (
    <div className={'al al-' + (forbidden ? 'y' : 'r')}>
      {forbidden ? 'You do not have permission to view HR data.' : 'Could not load: ' + error}
    </div>
  );
}

function Field({ label, v, on, type = 'text', disabled, placeholder, ariaLabel }) {
  return (
    <div className="fg">
      <label>{label}</label>
      <input type={type} value={v ?? ''} disabled={disabled} placeholder={placeholder}
        aria-label={ariaLabel || label.replace(' *', '')} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

function Select({ label, v, on, opts, disabled, hint }) {
  const norm = opts.map((o) => (typeof o === 'string' ? { v: o, l: o } : o));
  return (
    <div className="fg">
      <label>{label}</label>
      <select value={v ?? ''} aria-label={label.replace(' *', '')} disabled={disabled} onChange={(e) => on(e.target.value)}>
        <option value="">—</option>
        {norm.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      {hint ? <div className="pg-sub" style={{ margin: '2px 0 0' }}>{hint}</div> : null}
    </div>
  );
}

const nn = (v) => (v == null || v === '' ? '-' : v);
const daysCell = (n, { future = false } = {}) => {
  if (n == null) return <span style={{ color: 'var(--i3)' }}>-</span>;
  if (future) {
    const left = -n;
    return left < 0
      ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>{Math.abs(left)} days overdue</span>
      : <span style={{ color: left <= 30 ? '#B7770D' : undefined, fontWeight: left <= 30 ? 700 : undefined }}>in {left} days</span>;
  }
  return `${n} days`;
};

/* ─────────────────────────── Overview ─────────────────────────── */
// "The landing page shall be overview … This list shall have only the active
// employees and not the employees who left."
function Overview() {
  const { data, loading, error, reload } = useHr(() => hrApi.overview(), [], []);
  const [q, setQ] = useState('');
  const rows = (data || []).filter((e) => !q.trim()
    || [e.fullName, e.empCode, e.department, e.designation, e.reportingManager, e.workLocation].some((v) => String(v || '').toLowerCase().includes(q.trim().toLowerCase())));
  const due = rows.filter((e) => e.daysToNextAppraisal != null && e.daysToNextAppraisal <= 30).length;

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>Active employees <span className="tag tgr">{rows.length}</span></div>
        <input placeholder="Search name / department / manager…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search overview" style={{ minWidth: 240 }} />
        <span style={{ flex: 1 }} />
        {due > 0 && <span className="tag ty">{due} appraisal{due === 1 ? '' : 's'} due within 30 days</span>}
        <button className="btn btn-s" onClick={reload}>↻ Refresh</button>
      </div>
      <Problem error={error} />
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table>
          <thead><tr>
            <th>Employee</th><th>Department</th><th>Designation</th><th>Reporting manager</th>
            <th>Official phone</th><th>Office location</th>
            <th>Date of joining</th><th style={{ textAlign: 'right' }}>With us for</th>
            <th>Last appraisal</th><th>Next appraisal due</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 18 }}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No active employees</td></tr>
                : rows.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 600 }}>{e.fullName} <span className="tag tb" style={{ fontSize: 9, marginLeft: 4 }}>{e.empCode}</span></td>
                    <td style={{ fontSize: 11 }}>{nn(e.department)}</td>
                    <td style={{ fontSize: 11 }}>{nn(e.designation)}</td>
                    <td style={{ fontSize: 11 }}>{nn(e.reportingManager)}</td>
                    <td style={{ fontSize: 11 }}>{nn(e.officialPhone)}</td>
                    <td style={{ fontSize: 11 }}>{nn(e.workLocation)}</td>
                    <td style={{ fontSize: 11 }}>{e.joiningDate ? fmtDate(e.joiningDate) : '-'}</td>
                    <td style={{ textAlign: 'right', fontSize: 11 }}>{daysCell(e.daysSinceJoining ?? daysSince(e.joiningDate))}</td>
                    <td style={{ fontSize: 11 }}>{e.lastAppraisalDate ? fmtDate(e.lastAppraisalDate) : '-'}</td>
                    <td style={{ fontSize: 11 }}>
                      {e.nextAppraisalDate ? <>{fmtDate(e.nextAppraisalDate)} · {daysCell(e.daysToNextAppraisal != null ? -e.daysToNextAppraisal : daysSince(e.nextAppraisalDate), { future: true })}</> : '-'}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Employee details ─────────────────────────── */
function Employees() {
  const [filters, setFilters] = useState({ q: '', status: '', departmentId: '' });
  const [applied, setApplied] = useState({ q: '', status: '', departmentId: '' });
  const [editing, setEditing] = useState(null);   // employee draft, or EMPTY_EMP for new
  const [selected, setSelected] = useState('');   // the radio button
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState({});   // docType → attachment picked before the employee exists

  const emps = useHr(() => hrApi.listEmployees(applied), [applied], []);
  const meta = useHr(() => hrApi.meta(), [], { statuses: [], employmentTypes: [], genders: [], workLocations: [], docTypes: [] });
  const depts = useHr(() => hrApi.listDepartments({ active: 1 }), [], []);
  const desigs = useHr(() => hrApi.listDesignations({ active: 1 }), [], []);
  const docs = useHr(() => (editing && editing.id ? hrApi.listDocuments(editing.id) : Promise.resolve([])), [editing && editing.id], []);

  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  /** Bring an employee to the top of the page for editing (the Item Master pattern). */
  function open(e) {
    setSelected(String(e.id));
    setEditing({ ...EMPTY_EMP, ...e, salary: { ...EMPTY_SALARY, ...(e.salary || {}) } });
    setPendingFiles({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openNew() { setSelected(''); setEditing({ ...EMPTY_EMP, salary: { ...EMPTY_SALARY } }); setPendingFiles({}); }

  const setF = (patch) => setEditing((d) => ({ ...d, ...patch }));
  const setSal = (patch) => setEditing((d) => {
    const salary = { ...d.salary, ...patch };
    // Take-home follows the formula unless the HR has typed their own figure for it.
    if (!('takeHome' in patch)) salary.takeHome = String(takeHomeOf(salary));
    return { ...d, salary };
  });

  // Designations belong to a department: pick the department first, then its titles.
  const desigOpts = (desigs.data || [])
    .filter((d) => !editing || !editing.departmentId || String(d.departmentId) === String(editing.departmentId))
    .map((d) => ({ v: d.id, l: d.title || d.name }));
  // "All the people above his designation … for that particular department along
  // with employees with management candidate designations."
  const managerOpts = useMemo(() => {
    if (!editing) return [];
    const isMgmt = (e) => /manager|head|director|lead|chief|officer|supervisor|president/i.test(String(e.designation || ''));
    return (emps.data || [])
      .filter((e) => String(e.id) !== String(editing.id))
      .filter((e) => !NOT_CURRENT.includes(e.status))
      .filter((e) => !editing.departmentId || String(e.departmentId) === String(editing.departmentId) || isMgmt(e))
      .map((e) => ({ v: e.id, l: `${e.fullName}${e.designation ? ' — ' + e.designation : ''}` }));
  }, [emps.data, editing]);

  async function saveEmployee() {
    setBusy(true);
    try {
      const body = { ...editing };
      ['id', 'fullName', 'department', 'departmentName', 'designation', 'designationName', 'reportingManager',
        'reportingManagerName', 'docs', 'daysSinceJoining', 'daysToNextAppraisal', 'leavesTaken', 'leavesRemaining',
        'pendingSalary', 'documents', 'leaveRequests', 'leaveBalance', 'salaryHistory'].forEach((k) => delete body[k]);
      if (!String(body.empCode || '').trim()) delete body.empCode;   // auto-generated by the server
      // A value from before the closed lists ("Full-time", "Hyderabad") still reads,
      // but the server refuses it on a save — leave the field alone unless it was
      // changed to one of today's options.
      const listed = (list, v) => !v || (list || []).includes(v);
      if (!listed(meta.data.employmentTypes, body.employmentType)) delete body.employmentType;
      if (!listed(meta.data.workLocations, body.workLocation)) delete body.workLocation;
      const s = body.salary || {};
      body.salary = Object.values(s).some((v) => v !== '' && v != null)
        ? { ...s, apbPayoutCount: Number(s.apbPayoutCount) || 1 }
        : undefined;
      if (!body.salary) delete body.salary;
      const saved = editing.id ? await hrApi.updateEmployee(editing.id, body) : await hrApi.createEmployee(body);
      // Files picked before the employee existed go up now that there is an id.
      const id = (saved && saved.id) || editing.id;
      const queued = Object.entries(pendingFiles);
      for (const [docType, att] of queued) {
        await hrApi.addDocument(id, { docType, title: att.name, data: att.data });
      }
      setPendingFiles({});
      flash('g', editing.id ? '✅ Employee updated.' : `✅ Employee added${saved && saved.empCode ? ' as ' + saved.empCode : ''}.`);
      emps.reload();
      if (!editing.id && saved && saved.id) { setSelected(String(saved.id)); setEditing({ ...EMPTY_EMP, ...saved, salary: { ...EMPTY_SALARY, ...(saved.salary || {}) } }); }
      else docs.reload();
    } catch (e) { flash('r', err(e)); } finally { setBusy(false); }
  }

  async function pickFile(docType, file) {
    if (!file) return;
    try {
      const att = await readAttachment(file);
      if (editing.id) {
        await hrApi.addDocument(editing.id, { docType, title: att.name, data: att.data });
        flash('g', `✅ ${docType} uploaded.`);
        docs.reload(); emps.reload();
      } else {
        setPendingFiles((p) => ({ ...p, [docType]: att }));
        flash('g', `${docType} will be uploaded when the employee is saved.`);
      }
    } catch (e) { flash('r', err(e)); }
  }
  async function viewDoc(d) {
    try { const f = await hrApi.getDocumentFile(d.id); viewAttachment({ name: f.title, type: /^data:application\/pdf/.test(f.data || '') ? 'pdf' : 'image', data: f.data }); }
    catch (e) { flash('r', err(e)); }
  }
  async function removeDoc(d) {
    if (!window.confirm(`Remove "${d.title}"?`)) return;
    try { await hrApi.deleteDocument(d.id); docs.reload(); emps.reload(); } catch (e) { flash('r', err(e)); }
  }
  const docOfType = (type) => (docs.data || []).find((d) => d.docType === type && (d.hasFile || d.refUrl));

  const tick = (on) => (on ? <span style={{ color: 'var(--g)', fontWeight: 700 }} title="On file">✓</span> : <span style={{ color: 'var(--i3)' }}>—</span>);

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      {editing && (
        <div className="card">
          <div className="ctitle">{editing.id ? `Edit — ${editing.fullName || editing.empCode}` : 'New employee'}</div>
          <div className="g4">
            <Field label="Employee ID" v={editing.empCode} on={(v) => setF({ empCode: v })} disabled={!!editing.id} placeholder="auto-generated" />
            <Field label="First Name *" v={editing.firstName} on={(v) => setF({ firstName: v })} />
            <Field label="Last Name" v={editing.lastName} on={(v) => setF({ lastName: v })} />
            <Select label="Gender" v={editing.gender} on={(v) => setF({ gender: v })} opts={meta.data.genders || []} />
            <Field label="Date of Birth" type="date" v={editing.dob || ''} on={(v) => setF({ dob: v })} />
            <Field label="Personal mobile number" v={editing.mobile} on={(v) => setF({ mobile: v })} />
            <Field label="Personal email ID" type="email" v={editing.email} on={(v) => setF({ email: v })} />
            <Field label="Official phone number" v={editing.officialPhone} on={(v) => setF({ officialPhone: v })} />
            <Field label="Date of Joining" type="date" v={editing.joiningDate || ''} on={(v) => setF({ joiningDate: v })} />
            <Field label="Number of leaves" type="number" v={editing.leavesEntitled} on={(v) => setF({ leavesEntitled: v })} placeholder="per year" />
            <Field label="Aadhaar number" v={editing.aadhaarNo} on={(v) => setF({ aadhaarNo: v })} />
            <Field label="PAN number" v={editing.panNo} on={(v) => setF({ panNo: v })} />
          </div>
          <div className="fg"><label>Address</label><textarea rows={2} value={editing.address || ''} aria-label="Address" onChange={(e) => setF({ address: e.target.value })} /></div>

          <div className="ctitle" style={{ fontSize: 11, margin: '8px 0 2px' }}>Bank details</div>
          <div className="g4">
            <Field label="Account name" v={editing.bankAccountName} on={(v) => setF({ bankAccountName: v })} />
            <Field label="Account number" v={editing.bankAccountNo} on={(v) => setF({ bankAccountNo: v })} />
            <Field label="IFSC code" v={editing.bankIfsc} on={(v) => setF({ bankIfsc: v })} />
            <Field label="Bank branch" v={editing.bankBranch} on={(v) => setF({ bankBranch: v })} />
          </div>

          <div className="ctitle" style={{ fontSize: 11, margin: '8px 0 2px' }}>Position</div>
          <div className="g4">
            <Select label="Department" v={editing.departmentId} on={(v) => setF({ departmentId: v, designationId: '' })}
              opts={(depts.data || []).map((d) => ({ v: d.id, l: d.name }))} hint="From the Super Admin's department list" />
            <Select label="Designation" v={editing.designationId} on={(v) => setF({ designationId: v })} opts={desigOpts}
              disabled={!editing.departmentId}
              hint={editing.departmentId ? (desigOpts.length ? undefined : 'No designations for this department yet — Super Admin → Drop-down selections → Designations') : 'Pick the department first'} />
            <Select label="Reporting Manager" v={editing.reportingManagerId} on={(v) => setF({ reportingManagerId: v })} opts={managerOpts} />
            <Select label="Employment Type" v={editing.employmentType} on={(v) => setF({ employmentType: v })}
              opts={[...new Set([...(meta.data.employmentTypes || []), ...(editing.employmentType ? [editing.employmentType] : [])])]} />
            <Select label="Work Location" v={editing.workLocation} on={(v) => setF({ workLocation: v })}
              opts={[...new Set([...(meta.data.workLocations || []), ...(editing.workLocation ? [editing.workLocation] : [])])]} />
            <Field label="Previous employment" v={editing.previousEmployment} on={(v) => setF({ previousEmployment: v })} placeholder="last employer, if any" />
          </div>
          <div className="fg"><label>Remarks</label><textarea rows={2} value={editing.remarks || ''} aria-label="Remarks" onChange={(e) => setF({ remarks: e.target.value })} /></div>

          {/* "The next table shall be Salary Details" */}
          <div className="ctitle" style={{ fontSize: 11, margin: '8px 0 2px' }}>Salary details</div>
          <div className="g4">
            <Field label="CTC" type="number" v={editing.salary.ctc} on={(v) => setSal({ ctc: v })} />
            <Field label="Monthly cash" type="number" v={editing.salary.monthlyCash} on={(v) => setSal({ monthlyCash: v })} />
            <Field label="APB" type="number" v={editing.salary.apb} on={(v) => setSal({ apb: v })} />
            <Select label="APB payout in" v={editing.salary.apbPayoutCount} on={(v) => setSal({ apbPayoutCount: v, apbMonth2: v === '2' ? editing.salary.apbMonth2 : '' })}
              opts={[{ v: '1', l: '1 month' }, { v: '2', l: '2 months' }]} />
            <Select label="APB month 1" v={editing.salary.apbMonth1} on={(v) => setSal({ apbMonth1: v })} opts={MONTHS.map((m, i) => ({ v: String(i + 1), l: m }))} />
            {String(editing.salary.apbPayoutCount) === '2' && (
              <Select label="APB month 2" v={editing.salary.apbMonth2} on={(v) => setSal({ apbMonth2: v })} opts={MONTHS.map((m, i) => ({ v: String(i + 1), l: m }))} />
            )}
            <Field label="ESI" type="number" v={editing.salary.esi} on={(v) => setSal({ esi: v })} />
            <Field label="PF" type="number" v={editing.salary.pf} on={(v) => setSal({ pf: v })} />
            <Field label="PT" type="number" v={editing.salary.pt} on={(v) => setSal({ pt: v })} />
            <Field label="Insurance" type="number" v={editing.salary.insurance} on={(v) => setSal({ insurance: v })} />
            <Field label="Take-home" type="number" v={editing.salary.takeHome} on={(v) => setSal({ takeHome: v })} />
          </div>
          <div className="pg-sub" style={{ marginTop: 0 }}>
            Take-home = CTC − APB − monthly cash − ESI − PF − PT − insurance. It fills itself in and can be overwritten.
            {editing.salary.effectiveFrom ? ` In force since ${fmtDate(editing.salary.effectiveFrom)}; a revision with a future date is made under Increments.` : ''}
          </div>

          {/* "Four browse fields shall be present here." */}
          <div className="ctitle" style={{ fontSize: 11, margin: '8px 0 2px' }}>Documents</div>
          <div className="g4">
            {DOC_FIELDS.map((f) => {
              const have = editing.id ? docOfType(f.type) : null;
              const queued = pendingFiles[f.type];
              return (
                <div className="fg" key={f.type}>
                  <label>{f.label} {have || queued ? <span style={{ color: 'var(--g)' }}>✓</span> : null}</label>
                  <input type="file" accept="image/*,application/pdf" aria-label={`Browse ${f.label}`}
                    onChange={(e) => { pickFile(f.type, e.target.files && e.target.files[0]); e.target.value = ''; }} />
                  <div style={{ fontSize: 11, marginTop: 2 }}>
                    {have ? (
                      <>
                        <span style={{ color: 'var(--i2)' }}>{have.title}</span>
                        <button className="btn btn-s" style={{ height: 20, fontSize: 10, marginLeft: 6, padding: '0 6px' }} onClick={() => viewDoc(have)} aria-label={`View ${f.label}`}>View</button>
                        <button className="btn btn-s" style={{ height: 20, fontSize: 10, marginLeft: 4, padding: '0 6px', color: 'var(--red)' }} onClick={() => removeDoc(have)} aria-label={`Remove ${f.label}`}>✕</button>
                      </>
                    ) : queued ? <span style={{ color: 'var(--i2)' }}>{queued.name} — uploads on save</span>
                      : <span style={{ color: 'var(--i3)' }}>not on file</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="fbar">
            <span style={{ flex: 1 }} />
            <button className="btn btn-s" onClick={() => { setEditing(null); setSelected(''); }}>Cancel</button>
            <button className="btn btn-g" onClick={saveEmployee} disabled={busy}>{busy ? 'Saving…' : '💾 Save Employee'}</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Employees <span className="tag tgr">{(emps.data || []).length}</span></div>
          <input placeholder="Search name / code…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} aria-label="Search employees" />
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Filter by status">
            <option value="">All statuses</option>
            {(meta.data.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filters.departmentId} onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })} aria-label="Filter by department">
            <option value="">All departments</option>
            {(depts.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className="btn btn-s" onClick={() => setApplied({ ...filters })}>Search</button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-g" onClick={openNew}>＋ Add new employee</button>
        </div>
        <Problem error={emps.error} />
        <div className="pg-sub" style={{ marginTop: 0 }}>Select the radio button next to a name to bring that employee to the top for editing.</div>
        <div className="tw sy" style={{ maxHeight: 'calc(100vh - 340px)' }}>
          <table>
            <thead><tr>
              <th style={{ width: 30 }}></th><th style={{ minWidth: 160 }}>Employee name</th><th>Department</th><th>Work location</th>
              <th style={{ textAlign: 'right' }}>Leaves remaining</th><th style={{ textAlign: 'right' }}>CTC</th>
              <th style={{ textAlign: 'right' }}>Take-home</th><th style={{ textAlign: 'right' }}>Monthly cash</th>
              <th style={{ textAlign: 'right' }}>APB</th>
              <th style={{ textAlign: 'center' }}>Aadhaar</th><th style={{ textAlign: 'center' }}>PAN</th><th>Previous employment</th>
              <th>Status</th>
            </tr></thead>
            <tbody>
              {emps.loading ? <tr><td colSpan={13} style={{ textAlign: 'center', padding: 18 }}>Loading…</td></tr>
                : (emps.data || []).length === 0 ? <tr><td colSpan={13} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No employees match</td></tr>
                  : emps.data.map((e) => {
                    const s = e.salary || {};
                    const d = e.docs || {};
                    return (
                      <tr key={e.id} className={selected === String(e.id) ? 'hi' : undefined}>
                        <td style={{ textAlign: 'center' }}>
                          <input type="radio" name="hr-emp" checked={selected === String(e.id)} aria-label={`Select ${e.fullName}`} onChange={() => open(e)} />
                        </td>
                        <td style={{ fontWeight: 600 }}>{e.fullName} <span className="tag tb" style={{ fontSize: 9, marginLeft: 4 }}>{e.empCode}</span></td>
                        <td style={{ fontSize: 11 }}>{nn(e.department || e.departmentName)}</td>
                        <td style={{ fontSize: 11 }}>{nn(e.workLocation)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>{e.leavesRemaining != null ? inr(e.leavesRemaining) : nn(e.leavesEntitled)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>{money(s.ctc)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11, fontWeight: 600 }}>{money(s.takeHome)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>{money(s.monthlyCash)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>{money(s.apb)}</td>
                        <td style={{ textAlign: 'center' }} aria-label={`Aadhaar for ${e.fullName}`}>{tick(d.aadhaar)}</td>
                        <td style={{ textAlign: 'center' }} aria-label={`PAN for ${e.fullName}`}>{tick(d.pan)}</td>
                        <td style={{ fontSize: 11 }}>{e.previousEmployment || (d.previousEmployment ? '✓ letter on file' : '-')}</td>
                        <td><span className={'tag ' + (NOT_CURRENT.includes(e.status) ? 'tr' : 'tgr')} style={{ fontSize: 9 }}>{e.status || '-'}</span></td>
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

/* ─────────────────────────── Salary & advances ─────────────────────────── */
function SalariesAndAdvances() {
  const [sub, setSub] = useState('payroll');
  return (
    <>
      <div className="fbar" style={{ marginBottom: 8 }}>
        <button className={'btn ' + (sub === 'payroll' ? 'btn-g' : 'btn-s')} onClick={() => setSub('payroll')}>Monthly salaries</button>
        <button className={'btn ' + (sub === 'advances' ? 'btn-g' : 'btn-s')} onClick={() => setSub('advances')}>Advances</button>
      </div>
      {sub === 'payroll' ? <Payroll /> : <Advances />}
    </>
  );
}

const LINE_EDITS = [
  ['daysPresent', 'Days present'], ['cashPart', 'Cash part'], ['advanceDeduction', 'Advance deduction'],
  ['canteenDeduction', 'Canteen deduction'], ['pf', 'PF'], ['pt', 'PT'], ['esi', 'ESI / insurance'],
  ['otherDeductions', 'Deductions, if any'], ['lopDeduction', 'Loss of pay'], ['bonusIncluded', 'Bonus included'],
];
/** What the bank is paid, from the line's own figures. */
export function netPayableOf(l) {
  return Math.max(0, num(l.takeHome) - num(l.advanceDeduction) - num(l.canteenDeduction) - num(l.otherDeductions) - num(l.lopDeduction) + num(l.bonusIncluded));
}

function Payroll() {
  const [month, setMonth] = useState(thisMonth());
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = useHr(() => hrApi.payroll(month), [month], null);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };
  const d = run.data || {};
  const lines = d.lines || [];
  const locked = d.status === 'Finalised';
  const preview = !d.runId;

  async function createRun() {
    setBusy(true);
    try { await hrApi.createPayroll(month); flash('g', `✅ Salary run for ${month} ${preview ? 'created' : 'refreshed'}.`); run.reload(); }
    catch (e) { flash('r', err(e)); } finally { setBusy(false); }
  }
  async function saveLine(l, patch) {
    if (preview) { flash('y', 'Create the salary run first — a preview cannot be edited.'); return; }
    try {
      await hrApi.updatePayrollLine(d.runId, l.id, patch);
      run.reload();
    } catch (e) { flash('r', err(e)); }
  }
  async function finalise() {
    if (!window.confirm(`Finalise the ${month} salary run?\n\nAdvance deductions are booked against the advances and bonus payouts are recorded. The run can no longer be edited.`)) return;
    setBusy(true);
    try { await hrApi.finalisePayroll(d.runId); flash('g', `✅ ${month} finalised.`); run.reload(); }
    catch (e) { flash('r', err(e)); } finally { setBusy(false); }
  }
  function exportBank() {
    if (!lines.length) { flash('y', 'Nothing to export for this month.'); return; }
    const header = ['Employee ID', 'Employee name', 'Account name', 'Account number', 'IFSC code', 'Branch', 'Take-home salary'];
    const body = lines.map((l) => [l.empCode || '', l.fullName || '', l.bankAccountName || '', l.bankAccountNo || '', l.bankIfsc || '', l.bankBranch || '', Math.round(num(l.netPayable ?? netPayableOf(l)) * 100) / 100]);
    exportAOA([header, ...body], `Bank_Payments_${month}.xlsx`, 'Payments');
    flash('g', `Exported ${lines.length} payment(s) for the bank.`);
  }
  const totals = lines.reduce((t, l) => ({ net: t.net + num(l.netPayable ?? netPayableOf(l)), cash: t.cash + num(l.cashPart), bonus: t.bonus + num(l.bonusPending) }), { net: 0, cash: 0, bonus: 0 });

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>Salaries for <span className="tag tb">{month}</span> <span className={'tag ' + (locked ? 'tgr' : preview ? 'ty' : 'tb')} style={{ marginLeft: 6 }}>{d.status || '…'}</span></div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Salary month" />
        <span style={{ flex: 1 }} />
        {!locked && <button className="btn btn-s" onClick={createRun} disabled={busy}>{preview ? '＋ Create salary run' : '↻ Refresh auto figures'}</button>}
        <button className="btn btn-s" onClick={exportBank} aria-label="Export bank Excel">⬇ Export for the bank</button>
        {!locked && !preview && <button className="btn btn-g" onClick={finalise} disabled={busy}>✓ Finalise {month}</button>}
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <Problem error={run.error} />
      <div className="stats" style={{ marginBottom: 8 }}>
        <div className="stat"><div className="sl">Employees</div><div className="sv">{lines.length}</div></div>
        <div className="stat"><div className="sl">To the bank</div><div className="sv" style={{ color: 'var(--g)' }}>{money(totals.net)}</div></div>
        <div className="stat"><div className="sl">Cash part</div><div className="sv">{money(totals.cash)}</div></div>
        <div className="stat"><div className="sl">Bonus pending this month</div><div className="sv" style={{ color: totals.bonus > 0 ? '#B7770D' : undefined }}>{money(totals.bonus)}</div></div>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        {preview ? 'This is a preview from the current salaries and advances — create the run to record days present and deductions.'
          : locked ? 'Finalised — deductions and bonus payouts have been booked.'
            : 'Type into a box and leave it to save. Advance, PF, PT and ESI are filled in automatically and can be corrected. A highlighted bonus is pending for this month — enter the amount to include it.'}
      </div>
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 420px)' }}>
        <table style={{ minWidth: 1500 }}>
          <thead><tr>
            <th>Employee ID</th><th style={{ minWidth: 150 }}>Employee name</th><th>Department</th><th>Designation</th>
            {LINE_EDITS.map(([k, l]) => <th key={k} style={{ textAlign: 'right', width: 105 }}>{l}</th>)}
            <th style={{ textAlign: 'right' }}>Take-home</th><th style={{ textAlign: 'right' }}>Net payable</th>
          </tr></thead>
          <tbody>
            {run.loading ? <tr><td colSpan={16} style={{ textAlign: 'center', padding: 18 }}>Loading…</td></tr>
              : lines.length === 0 ? <tr><td colSpan={16} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No current employees</td></tr>
                : lines.map((l) => (
                  <tr key={l.id || l.employeeId} className={num(l.bonusPending) > 0 && !num(l.bonusIncluded) ? 'hi' : undefined}>
                    <td><span className="tag tb" style={{ fontSize: 9 }}>{l.empCode}</span></td>
                    <td style={{ fontWeight: 600 }}>{l.fullName}</td>
                    <td style={{ fontSize: 11 }}>{nn(l.department)}</td>
                    <td style={{ fontSize: 11 }}>{nn(l.designation)}</td>
                    {LINE_EDITS.map(([k, label]) => (
                      <td key={k} style={{ textAlign: 'right' }}>
                        <input type="number" step="any" className="nospin" defaultValue={l[k] ?? ''} disabled={locked || preview}
                          aria-label={`${label} for ${l.fullName}`} key={`${k}-${l[k]}`}
                          style={{ width: 95, height: 24, textAlign: 'right', background: k === 'bonusIncluded' && num(l.bonusPending) > 0 ? '#fff6d6' : undefined }}
                          title={k === 'advanceDeduction' && l.advanceSuggested != null ? `Suggested ${money(l.advanceSuggested)} from the open advances` : k === 'bonusIncluded' && num(l.bonusPending) > 0 ? `${money(l.bonusPending)} bonus pending` : k === 'lopDeduction' && num(l.lopDays) > 0 ? `${l.lopDays} loss-of-pay day(s)` : undefined}
                          onBlur={(e) => { const v = e.target.value; if (String(v) !== String(l[k] ?? '')) saveLine(l, { [k]: v === '' ? 0 : Number(v) }); }} />
                        {k === 'lopDeduction' && num(l.lopDays) > 0 ? <div style={{ fontSize: 9, color: 'var(--red)' }}>{l.lopDays} LOP day{l.lopDays === 1 ? '' : 's'}</div> : null}
                      </td>
                    ))}
                    <td style={{ textAlign: 'right', fontSize: 11 }}>{money(l.takeHome)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--g)' }}>{money(l.netPayable ?? netPayableOf(l))}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Advances() {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [draft, setDraft] = useState({ employeeId: '', amount: '', installments: '', takenOn: today(), note: '' });
  const list = useHr(() => hrApi.listAdvances(showClosed ? { includeClosed: 1 } : {}), [showClosed], []);
  const emps = useHr(() => hrApi.listEmployees({ current: 1 }), [], []);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  async function add() {
    if (!draft.employeeId) { flash('r', 'Choose an employee.'); return; }
    if (num(draft.amount) <= 0 || num(draft.installments) < 1) { flash('r', 'Enter the amount and the number of instalments.'); return; }
    setBusy(true);
    try {
      await hrApi.createAdvance({ ...draft, amount: Number(draft.amount), installments: Number(draft.installments) });
      setDraft({ employeeId: '', amount: '', installments: '', takenOn: today(), note: '' });
      flash('g', '✅ Advance recorded — it is deducted through the monthly salary run.');
      list.reload();
    } catch (e) { flash('r', err(e)); } finally { setBusy(false); }
  }
  async function setInstalments(a, v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n === a.installments) return;
    try { await hrApi.updateAdvance(a.id, { installments: n }); list.reload(); } catch (e) { flash('r', err(e)); }
  }
  const emp = (emps.data || []).find((e) => String(e.id) === String(draft.employeeId));

  return (
    <>
      <div className="card">
        <div className="ctitle">Record a salary advance</div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="g4" style={{ alignItems: 'end' }}>
          <Select label="Employee" v={draft.employeeId} on={(v) => setDraft({ ...draft, employeeId: v })}
            opts={(emps.data || []).map((e) => ({ v: e.id, l: `${e.empCode} — ${e.fullName}` }))} />
          <Field label="Advance taken" type="number" v={draft.amount} on={(v) => setDraft({ ...draft, amount: v })} />
          <Field label="To be repaid in (instalments)" type="number" v={draft.installments} on={(v) => setDraft({ ...draft, installments: v })} />
          <Field label="Taken on" type="date" v={draft.takenOn} on={(v) => setDraft({ ...draft, takenOn: v })} />
        </div>
        <div className="fbar">
          <span style={{ fontSize: 12, color: 'var(--i2)' }}>
            {emp && emp.salary ? `Current take-home ${money(emp.salary.takeHome)}. ` : ''}
            {num(draft.amount) > 0 && num(draft.installments) >= 1 ? `${money(num(draft.amount) / num(draft.installments))} per month.` : ''}
          </span>
          <span style={{ flex: 1 }} />
          <input value={draft.note} placeholder="Note (optional)" aria-label="Advance note" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          <button className="btn btn-g" onClick={add} disabled={busy}>＋ Record advance</button>
        </div>
      </div>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Advances <span className="tag tgr">{(list.data || []).length}</span></div>
          <label className="cb" style={{ fontSize: 12 }}><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /><span>Show repaid</span></label>
        </div>
        <Problem error={list.error} />
        <div className="pg-sub" style={{ marginTop: 0 }}>Balance instalments = what is still owed ÷ the instalment. Repayments are booked automatically when a salary run is finalised.</div>
        <div className="tw sy" style={{ maxHeight: 420 }}>
          <table>
            <thead><tr>
              <th style={{ minWidth: 160 }}>Employee name</th><th style={{ textAlign: 'right' }}>Current take-home</th>
              <th style={{ textAlign: 'right' }}>Advance taken</th><th style={{ textAlign: 'right', width: 130 }}>To be repaid in</th>
              <th style={{ textAlign: 'right' }}>Per month</th><th style={{ textAlign: 'right' }}>Repaid</th>
              <th style={{ textAlign: 'right' }}>Balance</th><th style={{ textAlign: 'right' }}>Balance instalments</th><th>Taken on</th><th>Status</th>
            </tr></thead>
            <tbody>
              {list.loading ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
                : (list.data || []).length === 0 ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No advances outstanding</td></tr>
                  : list.data.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{a.fullName} <span className="tag tb" style={{ fontSize: 9, marginLeft: 4 }}>{a.empCode}</span></td>
                      <td style={{ textAlign: 'right', fontSize: 11 }}>{money(a.currentTakeHome)}</td>
                      <td style={{ textAlign: 'right', fontSize: 11 }}>{money(a.amount)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <input type="number" min="1" className="nospin" defaultValue={a.installments} disabled={a.status === 'Closed'}
                          aria-label={`Instalments for ${a.fullName}`} style={{ width: 70, height: 24, textAlign: 'right' }}
                          onBlur={(e) => setInstalments(a, e.target.value)} />
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 11 }}>{money(a.instalmentAmount)}</td>
                      <td style={{ textAlign: 'right', fontSize: 11 }}>{money(a.repaid)}</td>
                      <td style={{ textAlign: 'right', fontSize: 11, fontWeight: 600 }}>{money(a.balance)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }} aria-label={`Balance instalments for ${a.fullName}`}>{a.balanceInstalments}</td>
                      <td style={{ fontSize: 11 }}>{a.takenOn ? fmtDate(a.takenOn) : '-'}</td>
                      <td><span className={'tag ' + (a.status === 'Closed' ? 'tgr' : 'ty')} style={{ fontSize: 9 }}>{a.status}</span></td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── Increments & Bonus ─────────────────────────── */
function IncrementsAndBonus() {
  const [sub, setSub] = useState('increments');
  return (
    <>
      <div className="fbar" style={{ marginBottom: 8 }}>
        <button className={'btn ' + (sub === 'increments' ? 'btn-g' : 'btn-s')} onClick={() => setSub('increments')}>Increments</button>
        <button className={'btn ' + (sub === 'bonus' ? 'btn-g' : 'btn-s')} onClick={() => setSub('bonus')}>Bonus</button>
      </div>
      {sub === 'increments' ? <Increments /> : <Bonus />}
    </>
  );
}

function Increments() {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const list = useHr(() => hrApi.listIncrements(), [], []);
  const desigs = useHr(() => hrApi.listDesignations({ active: 1 }), [], []);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };
  const row = (list.data || []).find((r) => String(r.employeeId) === String(selected)) || null;

  function edit(r) {
    setSelected(String(r.employeeId));
    setForm({
      designationId: r.designationId || '', joiningDate: r.joiningDate || '', joiningSalary: r.joiningSalary ?? '',
      lastIncrementAmount: r.lastIncrementAmount ?? '', lastIncrementDate: r.lastIncrementDate || '',
      revisedTakeHome: r.currentTakeHome ?? '', revisedApb: r.currentApb ?? '', revisedCash: r.currentCash ?? '', revisedCtc: r.currentCtc ?? '',
      effectiveFrom: today(), nextAppraisalDate: '',
    });
  }
  async function save() {
    if (!row) return;
    if (num(form.revisedCtc) <= 0) { flash('r', 'Enter the revised CTC.'); return; }
    if (!form.effectiveFrom) { flash('r', 'Say when the revised salary takes effect.'); return; }
    setBusy(true);
    try {
      await hrApi.addIncrement(row.employeeId, {
        designationId: form.designationId || undefined,
        revisedCtc: Number(form.revisedCtc), revisedTakeHome: Number(form.revisedTakeHome) || undefined,
        revisedApb: Number(form.revisedApb) || 0, revisedCash: Number(form.revisedCash) || 0,
        effectiveFrom: form.effectiveFrom, nextAppraisalDate: form.nextAppraisalDate || undefined,
      });
      flash('g', `✅ Revised salary saved for ${row.fullName}, effective ${fmtDate(form.effectiveFrom)}.`);
      setForm(null); setSelected('');
      list.reload();
    } catch (e) { flash('r', err(e)); } finally { setBusy(false); }
  }
  const desigOpts = (desigs.data || []).map((d) => ({ v: d.id, l: `${d.title}${d.departmentName ? ' — ' + d.departmentName : ''}` }));

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      {form && row && (
        <div className="card">
          <div className="ctitle">Increment — {row.fullName}</div>
          <div className="g4">
            <Select label="Designation" v={form.designationId} on={(v) => setForm({ ...form, designationId: v })} opts={desigOpts} />
            <Field label="Employee joining date" type="date" v={form.joiningDate} on={() => {}} disabled />
            <Field label="Employee joining salary" v={form.joiningSalary === '' ? '' : money(form.joiningSalary)} on={() => {}} disabled />
            <Field label="Last increment amount" v={form.lastIncrementAmount === '' || form.lastIncrementAmount == null ? '-' : money(form.lastIncrementAmount)} on={() => {}} disabled />
            <Field label="Last increment date" v={form.lastIncrementDate ? fmtDate(form.lastIncrementDate) : '-'} on={() => {}} disabled />
          </div>
          <div className="tw" style={{ marginBottom: 8 }}>
            <table>
              <thead><tr><th></th><th style={{ textAlign: 'right' }}>Current</th><th style={{ textAlign: 'right', width: 200 }}>Revised</th></tr></thead>
              <tbody>
                {[['Take-home', 'currentTakeHome', 'revisedTakeHome'], ['APB', 'currentApb', 'revisedApb'], ['Cash part', 'currentCash', 'revisedCash'], ['CTC', 'currentCtc', 'revisedCtc']].map(([label, cur, rev]) => (
                  <tr key={rev}>
                    <td style={{ fontWeight: 600 }}>{label}</td>
                    <td style={{ textAlign: 'right' }}>{money(row[cur])}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input type="number" step="any" className="nospin" value={form[rev]} aria-label={`Revised ${label}`}
                        style={{ width: 160, height: 26, textAlign: 'right' }} onChange={(e) => setForm({ ...form, [rev]: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="g4" style={{ alignItems: 'end' }}>
            <Field label="Revised salary effective from *" type="date" v={form.effectiveFrom} on={(v) => setForm({ ...form, effectiveFrom: v })} />
            <Field label="Next increment due on" type="date" v={form.nextAppraisalDate} on={(v) => setForm({ ...form, nextAppraisalDate: v })} placeholder="a year later, if blank" />
            <div className="fg"><label>&nbsp;</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-s" onClick={() => { setForm(null); setSelected(''); }}>Cancel</button>
                <button className="btn btn-g" onClick={save} disabled={busy}>{busy ? 'Saving…' : '💾 Save'}</button>
              </div>
            </div>
          </div>
          <div className="pg-sub" style={{ marginTop: 0 }}>
            As soon as the effective-from date is reached, the revised salary is the one shown on the Overview and every other page.
          </div>
        </div>
      )}

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Increments <span className="tag tgr">{(list.data || []).length}</span></div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={list.reload}>↻ Refresh</button>
        </div>
        <Problem error={list.error} />
        <div className="tw sy" style={{ maxHeight: 'calc(100vh - 340px)' }}>
          <table>
            <thead><tr>
              <th style={{ width: 30 }}></th><th style={{ minWidth: 150 }}>Employee name</th><th>Designation</th><th>Date of joining</th>
              <th style={{ textAlign: 'right' }}>Current CTC</th><th>Last increment date</th><th style={{ textAlign: 'right' }}>Last increment amount</th>
              <th>Next increment due on</th><th style={{ width: 170 }}></th>
            </tr></thead>
            <tbody>
              {list.loading ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
                : (list.data || []).length === 0 ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No employees</td></tr>
                  : list.data.map((r) => (
                    <tr key={r.employeeId} className={selected === String(r.employeeId) ? 'hi' : undefined}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="radio" name="hr-inc" checked={selected === String(r.employeeId)} aria-label={`Select ${r.fullName} for increment`} onChange={() => setSelected(String(r.employeeId))} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{r.fullName} <span className="tag tb" style={{ fontSize: 9, marginLeft: 4 }}>{r.empCode}</span>
                        {r.pendingIncrement ? <div style={{ fontSize: 10, color: '#B7770D' }}>revised to {money(r.pendingIncrement.ctc)} from {fmtDate(r.pendingIncrement.effectiveFrom)}</div> : null}
                      </td>
                      <td style={{ fontSize: 11 }}>{nn(r.designation)}</td>
                      <td style={{ fontSize: 11 }}>{r.joiningDate ? fmtDate(r.joiningDate) : '-'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(r.currentCtc)}</td>
                      <td style={{ fontSize: 11 }}>{r.lastIncrementDate ? fmtDate(r.lastIncrementDate) : '-'}</td>
                      <td style={{ textAlign: 'right', fontSize: 11 }}>{r.lastIncrementAmount != null ? money(r.lastIncrementAmount) : '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.nextIncrementDue ? <>{fmtDate(r.nextIncrementDue)} · {daysCell(daysSince(r.nextIncrementDue), { future: true })}</> : '-'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-s" aria-label={`Edit increment for ${r.fullName}`} onClick={() => edit(r)}>✎ Edit</button>
                        <button className="btn btn-s" style={{ marginLeft: 4 }} aria-label={`Salary history for ${r.fullName}`} onClick={() => setHistoryFor(r)}>History</button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
      {historyFor && <SalaryHistory emp={historyFor} onClose={() => setHistoryFor(null)} />}
    </>
  );
}

/** "Salary history for each of the employees … if this opens a pop-up … that is fine." */
function SalaryHistory({ emp, onClose }) {
  const hist = useHr(() => hrApi.salaryHistory(emp.employeeId || emp.id), [emp.employeeId || emp.id], []);
  const rows = hist.data || [];
  return (
    <div style={ovlStyle} onClick={onClose}>
      <div style={sheetStyle} role="dialog" aria-modal="true" aria-label="Salary history" onClick={(ev) => ev.stopPropagation()}>
        <div className="fbar" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Salary history — {emp.fullName}</div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={onClose}>Close</button>
        </div>
        <Problem error={hist.error} />
        <div className="tw sy" style={{ maxHeight: 420 }}>
          <table>
            <thead><tr><th>#</th><th>What</th><th>Effective from</th><th style={{ textAlign: 'right' }}>CTC</th><th style={{ textAlign: 'right' }}>Take-home</th><th style={{ textAlign: 'right' }}>APB</th><th style={{ textAlign: 'right' }}>Cash</th><th style={{ textAlign: 'right' }}>Increment</th></tr></thead>
            <tbody>
              {hist.loading ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 14 }}>Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 14, color: 'var(--i3)' }}>No salary recorded yet</td></tr>
                  : rows.map((s, i) => (
                    <tr key={s.id || i}>
                      <td>{i + 1}</td>
                      <td style={{ fontSize: 11 }}>{s.kind === 'JOINING' || i === 0 ? 'At joining' : `Increment ${i}`}</td>
                      <td style={{ fontSize: 11 }}>{s.effectiveFrom ? fmtDate(s.effectiveFrom) : '-'}</td>
                      <td style={{ textAlign: 'right' }}>{money(s.ctc)}</td>
                      <td style={{ textAlign: 'right' }}>{money(s.takeHome)}</td>
                      <td style={{ textAlign: 'right' }}>{money(s.apb)}</td>
                      <td style={{ textAlign: 'right' }}>{money(s.monthlyCash)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--g)' }}>{s.incrementAmount != null && s.kind !== 'JOINING' ? '+' + money(s.incrementAmount) : '-'}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Bonus() {
  const [msg, setMsg] = useState(null);
  // What this screen has saved since the list was fetched. The endpoint writes BOTH
  // fields at once, so typing an amount and then choosing the month must send the
  // amount that was just typed — not the zero the list was loaded with, which is
  // how a bonus silently reverted to 0 the moment the month was picked.
  const [edits, setEdits] = useState({});
  const list = useHr(() => hrApi.listBonus(), [], []);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };
  const rows = (list.data || []).map((r) => ({ ...r, ...(edits[r.employeeId] || {}) }));
  async function save(r, patch) {
    const cur = { ...r, ...(edits[r.employeeId] || {}) };
    const body = {
      annualBonus: num(patch.annualBonus ?? cur.annualBonus),
      payoutMonth: patch.payoutMonth !== undefined ? (patch.payoutMonth === '' ? null : Number(patch.payoutMonth)) : cur.payoutMonth,
    };
    setEdits((e) => ({ ...e, [r.employeeId]: { ...(e[r.employeeId] || {}), ...body } }));
    try {
      const saved = await hrApi.setBonus(r.employeeId, body);
      // The server works out paid / pending; take its answer back so the row agrees.
      if (saved && typeof saved === 'object') setEdits((e) => ({ ...e, [r.employeeId]: { ...(e[r.employeeId] || {}), ...saved } }));
      list.reload();
    } catch (e) { flash('r', err(e)); }
  }
  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>Annual bonus <span className="tag tgr">{rows.length}</span></div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={list.reload}>↻ Refresh</button>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <Problem error={list.error} />
      <div className="pg-sub" style={{ marginTop: 0 }}>Paid and pending are worked out from the bonus included in finalised salary runs this year. The payout month decides when the salary sheet suggests it.</div>
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 340px)' }}>
        <table>
          <thead><tr>
            <th style={{ minWidth: 150 }}>Employee name</th><th>Department</th>
            <th style={{ textAlign: 'right', width: 140 }}>Annual bonus</th><th style={{ width: 150 }}>To be paid on</th>
            <th style={{ textAlign: 'right' }}>Annual bonus paid</th><th style={{ textAlign: 'right' }}>Annual bonus pending</th>
          </tr></thead>
          <tbody>
            {list.loading ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No employees</td></tr>
                : rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td style={{ fontWeight: 600 }}>{r.fullName} <span className="tag tb" style={{ fontSize: 9, marginLeft: 4 }}>{r.empCode}</span></td>
                    <td style={{ fontSize: 11 }}>{nn(r.department)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input type="number" step="any" className="nospin" defaultValue={r.annualBonus ?? ''} key={`b-${r.annualBonus}`}
                        aria-label={`Annual bonus for ${r.fullName}`} style={{ width: 120, height: 24, textAlign: 'right' }}
                        onBlur={(e) => { if (String(e.target.value) !== String(r.annualBonus ?? '')) save(r, { annualBonus: e.target.value }); }} />
                    </td>
                    <td>
                      <select value={r.payoutMonth || ''} aria-label={`Bonus month for ${r.fullName}`} style={{ height: 24, fontSize: 11 }}
                        onChange={(e) => save(r, { payoutMonth: e.target.value })}>
                        <option value="">—</option>
                        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--g)' }}>{money(r.paid)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: num(r.pending) > 0 ? '#B7770D' : undefined }}>{money(r.pending)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Leave details ─────────────────────────── */
function Leave() {
  const [status, setStatus] = useState('Pending');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState({});
  const [draft, setDraft] = useState({ employeeId: '', leaveTypeId: '', fromDate: today(), toDate: today(), reason: '' });

  const reqs = useHr(() => hrApi.listLeaveRequests(status ? { status } : {}), [status], []);
  const emps = useHr(() => hrApi.listEmployees({ current: 1 }), [], []);
  const types = useHr(() => hrApi.listLeaveTypes({ active: 1 }), [], []);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 3500); };

  // Inclusive day count, matching the server's default when `days` is omitted.
  const days = useMemo(() => {
    if (!draft.fromDate || !draft.toDate) return 0;
    const a = new Date(draft.fromDate + 'T00:00:00');
    const b = new Date(draft.toDate + 'T00:00:00');
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }, [draft.fromDate, draft.toDate]);
  const emp = (emps.data || []).find((e) => String(e.id) === String(draft.employeeId));
  const remaining = emp ? num(emp.leavesRemaining ?? emp.leavesEntitled) : null;
  const lop = emp && days > 0 && remaining != null && days > remaining;

  async function apply() {
    if (!draft.employeeId) { flash('r', 'Choose an employee.'); return; }
    if (!days) { flash('r', 'To date cannot be before From date.'); return; }
    setBusy(true);
    try {
      await hrApi.createLeaveRequest(draft);
      setDraft({ employeeId: '', leaveTypeId: '', fromDate: today(), toDate: today(), reason: '' });
      flash('g', lop ? '✅ Leave request submitted — beyond the entitlement, so it is loss of pay.' : '✅ Leave request submitted.');
      reqs.reload(); emps.reload();
    } catch (e) { flash('r', err(e)); } finally { setBusy(false); }
  }
  async function decide(row, approve) {
    const comment = (comments[row.id] || '').trim();
    setBusy(true);
    try {
      await (approve ? hrApi.approveLeave(row.id, comment) : hrApi.rejectLeave(row.id, comment));
      setComments((c) => { const n = { ...c }; delete n[row.id]; return n; });
      flash('g', `✅ Request ${approve ? 'approved' : 'rejected'}.`);
      reqs.reload(); emps.reload();
    } catch (e) { flash('r', err(e)); } finally { setBusy(false); }
  }
  function exportSheet() {
    const rows = reqs.data || [];
    if (!rows.length) { flash('y', 'No requests to put on the sheet.'); return; }
    const header = ['Employee ID', 'Employee name', 'Leaves available', 'Leave from', 'Leave to', 'Days requested', 'Reason', 'Loss of pay', 'Status', 'Reporting manager signature'];
    const body = rows.map((r) => [r.empCode || '', r.employeeName || '', r.leavesRemaining ?? '', r.fromDate || '', r.toDate || '', num(r.days), r.reason || '', r.lop ? 'Yes' : 'No', r.status || '', '']);
    exportAOA([header, ...body], `Leave_Sheet_${today()}.xlsx`, 'Leaves');
    flash('g', `Exported ${rows.length} request(s) for the reporting manager to sign.`);
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">Leave request</div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="g4" style={{ alignItems: 'end' }}>
          <Select label="Employee" v={draft.employeeId} on={(v) => setDraft({ ...draft, employeeId: v })}
            opts={(emps.data || []).map((e) => ({ v: e.id, l: `${e.empCode} — ${e.fullName}` }))} />
          <Select label="Leave Type" v={draft.leaveTypeId} on={(v) => setDraft({ ...draft, leaveTypeId: v })}
            opts={(types.data || []).map((t) => ({ v: t.id, l: t.name }))} />
          <Field label="From" type="date" v={draft.fromDate} on={(v) => setDraft({ ...draft, fromDate: v })} />
          <Field label="To" type="date" v={draft.toDate} on={(v) => setDraft({ ...draft, toDate: v })} />
        </div>
        <div className="fg"><label>Reason</label><input value={draft.reason} aria-label="Reason" onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></div>
        <div className="fbar">
          <span style={{ fontSize: 12, color: 'var(--i2)' }}>
            {days ? `${days} day${days === 1 ? '' : 's'}` : 'Check the dates'}
            {emp ? ` · ${inr(remaining)} leave${remaining === 1 ? '' : 's'} available` : ''}
            {lop ? <strong style={{ color: 'var(--red)' }}> · beyond the entitlement — loss of pay</strong> : null}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-g" onClick={apply} disabled={busy}>Submit request</button>
        </div>
      </div>

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Leave requests <span className="tag tgr">{(reqs.data || []).length}</span></div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter leave by status">
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="">All</option>
          </select>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={exportSheet} aria-label="Download leave sheet">⬇ Download for signature</button>
        </div>
        <Problem error={reqs.error} />
        <div className="pg-sub" style={{ marginTop: 0 }}>Once an employee&rsquo;s leaves are used up, further leave is loss of pay and is deducted on that month&rsquo;s salary sheet.</div>
        <div className="tw sy" style={{ maxHeight: 380 }}>
          <table>
            <thead><tr><th>Employee</th><th style={{ textAlign: 'right' }}>Leaves available</th><th>Type</th><th>From</th><th>To</th><th style={{ textAlign: 'right' }}>Days</th><th>Reason</th><th>Status</th><th style={{ width: 190 }}>Decision</th></tr></thead>
            <tbody>
              {reqs.loading ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
                : (reqs.data || []).length === 0 ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No requests</td></tr>
                  : reqs.data.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.employeeName || r.employeeId}</td>
                      <td style={{ textAlign: 'right', fontSize: 11 }}>{r.leavesRemaining != null ? inr(r.leavesRemaining) : '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.leaveTypeName || r.leaveType || '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.fromDate ? fmtDate(r.fromDate) : '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.toDate ? fmtDate(r.toDate) : '-'}</td>
                      <td style={{ textAlign: 'right' }}>{inr(r.days)}{r.lop ? <span className="tag tr" style={{ fontSize: 9, marginLeft: 4 }} title="Beyond the entitlement">LOP</span> : null}</td>
                      <td style={{ fontSize: 11 }}>{r.reason || '-'}</td>
                      <td><span className={'tag ' + (r.status === 'Approved' ? 'tgr' : r.status === 'Rejected' ? 'tr' : 'ty')}>{r.status}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {r.status === 'Pending' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
                            <input value={comments[r.id] || ''} placeholder="Comment (optional)" aria-label={`Comment for leave ${r.id}`}
                              style={{ height: 24, fontSize: 11 }} onChange={(ev) => setComments((c) => ({ ...c, [r.id]: ev.target.value }))} />
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-g" style={{ height: 24, fontSize: 11, padding: '0 8px' }} disabled={busy} aria-label={`Approve leave ${r.id}`} onClick={() => decide(r, true)}>Approve</button>
                              <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 8px', color: 'var(--red)' }} disabled={busy} aria-label={`Reject leave ${r.id}`} onClick={() => decide(r, false)}>Reject</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11 }}>
                            <div style={{ fontWeight: 600 }}>{r.approver || '-'}</div>
                            {r.approverComment ? <div style={{ color: 'var(--i3)' }}>{r.approverComment}</div> : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
      <LeaveTypes />
    </>
  );
}

/** Leave types stay editable here — a small master, kept next to the requests it classifies. */
function LeaveTypes() {
  const list = useHr(() => hrApi.listLeaveTypes({ includeInactive: 1 }), [], []);
  const [name, setName] = useState('');
  const [daysDefault, setDaysDefault] = useState('');
  const [msg, setMsg] = useState(null);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 3500); };
  async function add() {
    if (!name.trim()) return;
    try { await hrApi.createLeaveType({ name: name.trim(), defaultDays: Number(daysDefault) || 0 }); setName(''); setDaysDefault(''); list.reload(); flash('g', '✅ Leave type added.'); }
    catch (e) { flash('r', err(e)); }
  }
  async function toggle(t) { try { await hrApi.updateLeaveType(t.id, { active: !t.active }); list.reload(); } catch (e) { flash('r', err(e)); } }
  return (
    <div className="card">
      <div className="ctitle">Leave Types <span className="tag tgr">{(list.data || []).length}</span></div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="tw sy" style={{ maxHeight: 220 }}>
        <table>
          <thead><tr><th>Name</th><th style={{ width: 110, textAlign: 'right' }}>Default days</th><th style={{ width: 90, textAlign: 'center' }}>Active</th></tr></thead>
          <tbody>
            {(list.data || []).length === 0 ? <tr><td colSpan={3} style={{ textAlign: 'center', padding: 12, color: 'var(--i3)' }}>None yet</td></tr>
              : list.data.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td style={{ textAlign: 'right' }}>{inr(t.defaultDays)}</td>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!t.active} aria-label={`${t.name} active`} onChange={() => toggle(t)} /></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="fbar" style={{ marginTop: 8 }}>
        <input placeholder="e.g. Casual Leave" value={name} onChange={(e) => setName(e.target.value)} aria-label="New Leave Types" />
        <input type="number" min="0" placeholder="Default days" value={daysDefault} aria-label="Default days" style={{ width: 110 }} onChange={(e) => setDaysDefault(e.target.value)} />
        <button className="btn btn-s" onClick={add} disabled={!name.trim()}>＋ Add</button>
      </div>
    </div>
  );
}

/* ─────────────────────────── Admin details ─────────────────────────── */
function Admin() {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(null);   // { emp, lastWorkingDay, leftReason }
  const emps = useHr(() => hrApi.listEmployees({}), [], []);
  const meta = useHr(() => hrApi.meta(), [], { leftReasons: [] });
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };
  const reasons = meta.data.leftReasons && meta.data.leftReasons.length ? meta.data.leftReasons : ['Served notice period', 'Absconding', 'Asked to leave'];
  const isLeft = (e) => NOT_CURRENT.includes(e.status);

  async function markCurrent(e) {
    setBusy(true);
    try { await hrApi.setExit(e.id, { left: false }); flash('g', `✅ ${e.fullName} is current again.`); emps.reload(); }
    catch (x) { flash('r', err(x)); } finally { setBusy(false); }
  }
  async function confirmLeft() {
    if (!leaving.leftReason) { flash('r', 'Say why the employee left.'); return; }
    setBusy(true);
    try {
      const r = await hrApi.setExit(leaving.emp.id, { left: true, lastWorkingDay: leaving.lastWorkingDay, leftReason: leaving.leftReason });
      flash('g', `✅ ${leaving.emp.fullName} marked as left on ${fmtDate(leaving.lastWorkingDay)} — ${r && r.experienceText ? r.experienceText : experienceText(leaving.emp.joiningDate, leaving.lastWorkingDay)} with the company.`);
      setLeaving(null); emps.reload();
    } catch (x) { flash('r', err(x)); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Current or left <span className="tag tgr">{(emps.data || []).length}</span></div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={emps.reload}>↻ Refresh</button>
        </div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <Problem error={emps.error} />
        {leaving && (
          <div className="al al-y">
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Marking {leaving.emp.fullName} as left</div>
            <div className="g4" style={{ alignItems: 'end' }}>
              <Field label="Last working day" type="date" v={leaving.lastWorkingDay} on={(v) => setLeaving({ ...leaving, lastWorkingDay: v })} />
              <div className="fg"><label>Total experience</label>
                <div style={{ fontSize: 13, fontWeight: 600 }} aria-label="Experience">{experienceText(leaving.emp.joiningDate, leaving.lastWorkingDay)}</div>
              </div>
              <div className="fg" style={{ gridColumn: 'span 2' }}><label>Reason</label>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
                  {reasons.map((r) => (
                    <label key={r} className="cb"><input type="radio" name="left-reason" value={r} checked={leaving.leftReason === r} aria-label={r} onChange={() => setLeaving({ ...leaving, leftReason: r })} /><span>{r}</span></label>
                  ))}
                </div>
              </div>
            </div>
            <div className="fbar" style={{ marginBottom: 0 }}>
              <span style={{ flex: 1 }} />
              <button className="btn btn-s" onClick={() => setLeaving(null)}>Cancel</button>
              <button className="btn btn-r" onClick={confirmLeft} disabled={busy}>Confirm — mark as left</button>
            </div>
          </div>
        )}
        <div className="tw sy" style={{ maxHeight: 'calc(100vh - 360px)' }}>
          <table>
            <thead><tr>
              <th style={{ minWidth: 160 }}>Employee</th><th>Department</th><th>Date of joining</th>
              <th style={{ width: 180 }}>Status</th><th>Last working day</th><th>Experience</th><th>Reason</th>
            </tr></thead>
            <tbody>
              {emps.loading ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
                : (emps.data || []).length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No employees</td></tr>
                  : emps.data.map((e) => (
                    <tr key={e.id}>
                      <td style={{ fontWeight: 600 }}>{e.fullName} <span className="tag tb" style={{ fontSize: 9, marginLeft: 4 }}>{e.empCode}</span></td>
                      <td style={{ fontSize: 11 }}>{nn(e.department || e.departmentName)}</td>
                      <td style={{ fontSize: 11 }}>{e.joiningDate ? fmtDate(e.joiningDate) : '-'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                          <label className="cb"><input type="radio" name={`cur-${e.id}`} checked={!isLeft(e)} disabled={busy} aria-label={`${e.fullName} current`} onChange={() => markCurrent(e)} /><span>Current</span></label>
                          <label className="cb"><input type="radio" name={`cur-${e.id}`} checked={isLeft(e)} disabled={busy} aria-label={`${e.fullName} left`} onChange={() => setLeaving({ emp: e, lastWorkingDay: today(), leftReason: '' })} /><span>Left</span></label>
                        </div>
                      </td>
                      <td style={{ fontSize: 11 }}>{isLeft(e) && e.exitDate ? fmtDate(e.exitDate) : '-'}</td>
                      <td style={{ fontSize: 11 }}>{isLeft(e) ? experienceText(e.joiningDate, e.exitDate) : experienceText(e.joiningDate, null)}</td>
                      <td style={{ fontSize: 11 }}>{isLeft(e) ? (e.leftReason || e.status) : '-'}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
      <Audit />
    </>
  );
}

/* ─────────────────────────── Audit ─────────────────────────── */
function Audit() {
  const [type, setType] = useState('');
  const { data, loading, error } = useHr(() => hrApi.audit({ limit: 200, ...(type ? { entityType: type } : {}) }), [type], []);
  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>HR Audit — who changed what</div>
        <span style={{ flex: 1 }} />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter audit by entity">
          <option value="">All entities</option>
          {['EMPLOYEE', 'SALARY', 'ADVANCE', 'BONUS', 'PAYROLL', 'LEAVE_REQUEST', 'DESIGNATION', 'LEAVE_TYPE', 'DOCUMENT'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <Problem error={error} />
      <div className="tw sy" style={{ maxHeight: 360 }}>
        <table>
          <thead><tr><th style={{ width: 150 }}>When</th><th>Actor</th><th>Entity</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
              : (data || []).length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>Nothing recorded yet</td></tr>
                : data.map((a, i) => (
                  <tr key={a.id || i}>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{String(a.createdAt || a.ts || '').replace('T', ' ').slice(0, 19)}</td>
                    <td style={{ fontSize: 11 }}>{a.actor || '-'}</td>
                    <td style={{ fontSize: 11 }}>{a.entityType}{a.entityId ? ' #' + a.entityId : ''}</td>
                    <td><span className="tag tb" style={{ fontSize: 10 }}>{a.action}</span></td>
                    <td style={{ fontSize: 10, whiteSpace: 'normal', wordBreak: 'break-word', maxWidth: 420 }}>
                      {typeof a.details === 'string' ? a.details : JSON.stringify(a.details || {})}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Modal chrome for the salary-history pop-up — mirrors the app's other overlays.
const ovlStyle = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 9600, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '32px 12px' };
const sheetStyle = { background: 'var(--wh)', borderRadius: 12, maxWidth: 820, width: '100%', padding: '20px 22px', boxShadow: '0 20px 60px rgba(0,0,0,.3)', margin: 'auto' };
