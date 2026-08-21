import { useCallback, useEffect, useMemo, useState } from 'react';
import { hrApi } from '../api.js';
import { fmtDate, today, inr } from '../lib/format.js';

// Human Resources workspace — native port of the OAB-App HR layer.
// Entirely API-driven (/api/hr/**); nothing here lives in a module blob. The
// backend gates the whole controller to HR + SUPERADMIN, so a wrong role gets a
// 403 and this page shows a clean "not permitted" state rather than empty tables.

const TABS = [
  { k: 'dashboard', label: '📊 Overview' },
  { k: 'employees', label: '👥 Employees' },
  { k: 'org', label: '🏢 Departments & Roles' },
  { k: 'leave', label: '🌴 Leave' },
  { k: 'audit', label: '🧾 Audit' },
];

const EMPTY_EMP = {
  empCode: '', firstName: '', lastName: '', gender: '', dob: '', mobile: '', email: '',
  departmentId: '', designationId: '', reportingManagerId: '', joiningDate: '',
  employmentType: '', workLocation: '', status: 'Active', emergencyContact: '',
  address: '', exitDate: '', remarks: '',
};

const err = (e) => (e && e.message ? e.message : String(e));

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
  const [tab, setTab] = useState('dashboard');
  return (
    <div id="app">
      <div className="pg-ttl">Human Resources</div>
      <div className="pg-sub">Employees, departments, designations and leave — served live from the HR tables.</div>
      <div className="step-bar" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <div key={t.k} className={'step-tab' + (tab === t.k ? ' on' : '')} style={{ cursor: 'pointer' }} onClick={() => setTab(t.k)}>{t.label}</div>
        ))}
      </div>
      {tab === 'dashboard' && <Overview />}
      {tab === 'employees' && <Employees />}
      {tab === 'org' && <Org />}
      {tab === 'leave' && <Leave />}
      {tab === 'audit' && <Audit />}
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

function Stat({ label, value, color }) {
  return (
    <div className="kpi">
      <div className="kpi-l">{label}</div>
      <div className="kpi-v" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

/* ─────────────────────────── Overview ─────────────────────────── */
function Overview() {
  const { data, loading, error } = useHr(() => hrApi.dashboard(), [], null);
  if (loading) return <div className="card">Loading…</div>;
  if (error) return <div className="card"><Problem error={error} /></div>;
  const d = data || {};
  const maxDept = Math.max(1, ...((d.byDepartment || []).map((x) => Number(x.count) || 0)));

  return (
    <>
      <div className="stats">
        <Stat label="Total Employees" value={inr(d.totalEmployees)} />
        <Stat label="Active" value={inr(d.activeEmployees)} color="var(--g)" />
        <Stat label="On Leave" value={inr(d.onLeave)} color="var(--blu)" />
        <Stat label="On Notice" value={inr(d.onNotice)} color="#a3510a" />
        <Stat label="Inactive" value={inr(d.inactiveEmployees)} color="var(--i3)" />
        <Stat label="New Joiners (30d)" value={inr(d.newJoiners)} color="var(--g)" />
        <Stat label="Pending Leave" value={inr(d.pendingLeave)} color={Number(d.pendingLeave) > 0 ? 'var(--red)' : undefined} />
        <Stat label="Departments" value={inr(d.departments)} />
      </div>

      <div className="g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="ctitle">Head-count by department</div>
          {(d.byDepartment || []).length === 0 ? <div className="pg-sub">No departments yet.</div> : (
            <div>
              {d.byDepartment.map((x) => (
                <div key={x.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <div style={{ width: 160, fontSize: 12 }}>{x.name}</div>
                  <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 4, height: 16, overflow: 'hidden' }}>
                    <div style={{ width: `${(Number(x.count) / maxDept) * 100}%`, background: 'var(--blu)', height: '100%' }} />
                  </div>
                  <div style={{ width: 40, textAlign: 'right', fontWeight: 700, fontSize: 12 }}>{inr(x.count)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="ctitle">Head-count by status</div>
          <div className="tw sy">
            <table>
              <thead><tr><th>Status</th><th style={{ textAlign: 'right' }}>Employees</th></tr></thead>
              <tbody>
                {(d.byStatus || []).length === 0 ? <tr><td colSpan={2} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No employees yet</td></tr>
                  : d.byStatus.map((x) => <tr key={x.status}><td>{x.status}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{inr(x.count)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── Employees ─────────────────────────── */
function Employees() {
  const [filters, setFilters] = useState({ q: '', status: '', departmentId: '' });
  const [applied, setApplied] = useState({ q: '', status: '', departmentId: '' });
  const [editing, setEditing] = useState(null);   // employee object or EMPTY_EMP for new
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const emps = useHr(() => hrApi.listEmployees(applied), [applied], []);
  const meta = useHr(() => hrApi.meta(), [], { statuses: [], employmentTypes: [], genders: [] });
  const depts = useHr(() => hrApi.listDepartments({ active: 1 }), [], []);
  const desigs = useHr(() => hrApi.listDesignations({ active: 1 }), [], []);

  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };
  const nameById = useMemo(() => Object.fromEntries((emps.data || []).map((e) => [e.id, e.fullName])), [emps.data]);

  async function saveEmployee() {
    setBusy(true);
    try {
      // Send only what the server accepts; blank strings become nulls there.
      const body = { ...editing };
      delete body.id; delete body.fullName; delete body.departmentName; delete body.designationName;
      if (editing.id) await hrApi.updateEmployee(editing.id, body);
      else await hrApi.createEmployee(body);
      setEditing(null);
      flash('g', editing.id ? '✅ Employee updated.' : '✅ Employee added.');
      emps.reload();
    } catch (e) { flash('r', err(e)); } finally { setBusy(false); }
  }

  async function changeStatus(emp, status) {
    if (!status || status === emp.status) return;
    setBusy(true);
    try {
      await hrApi.setEmployeeStatus(emp.id, status, '');
      flash('g', `✅ ${emp.fullName} → ${status}.`);
      emps.reload();
    } catch (e) { flash('r', err(e)); } finally { setBusy(false); }
  }

  return (
    <>
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
          <button className="btn btn-g" onClick={() => setEditing({ ...EMPTY_EMP })}>＋ Add Employee</button>
        </div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <Problem error={emps.error} />

        <div className="tw sy" style={{ maxHeight: 'calc(100vh - 340px)' }}>
          <table>
            <thead><tr>
              <th>Code</th><th style={{ minWidth: 160 }}>Name</th><th>Department</th><th>Designation</th>
              <th>Joined</th><th>Mobile</th><th style={{ width: 140 }}>Status</th><th style={{ width: 70 }}></th>
            </tr></thead>
            <tbody>
              {emps.loading ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 18 }}>Loading…</td></tr>
                : (emps.data || []).length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No employees match</td></tr>
                  : emps.data.map((e) => (
                    <tr key={e.id}>
                      <td><span className="tag tb" style={{ fontSize: 10 }}>{e.empCode}</span></td>
                      <td style={{ fontWeight: 600 }}>{e.fullName}</td>
                      <td style={{ fontSize: 11 }}>{e.departmentName || '-'}</td>
                      <td style={{ fontSize: 11 }}>{e.designationName || '-'}</td>
                      <td style={{ fontSize: 11 }}>{e.joiningDate ? fmtDate(e.joiningDate) : '-'}</td>
                      <td style={{ fontSize: 11 }}>{e.mobile || '-'}</td>
                      <td>
                        <select value={e.status || ''} disabled={busy} aria-label={`Status for ${e.fullName}`} onChange={(ev) => changeStatus(e, ev.target.value)}>
                          {(meta.data.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn btn-s" aria-label={`Edit ${e.fullName}`} onClick={() => setEditing({ ...EMPTY_EMP, ...e })}>Edit</button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="card">
          <div className="ctitle">{editing.id ? `Edit — ${editing.fullName || editing.empCode}` : 'New Employee'}</div>
          <div className="g4">
            <Field label="Employee ID *" v={editing.empCode} on={(v) => setEditing({ ...editing, empCode: v })} disabled={!!editing.id} />
            <Field label="First Name *" v={editing.firstName} on={(v) => setEditing({ ...editing, firstName: v })} />
            <Field label="Last Name" v={editing.lastName} on={(v) => setEditing({ ...editing, lastName: v })} />
            <Select label="Gender" v={editing.gender} on={(v) => setEditing({ ...editing, gender: v })} opts={meta.data.genders || []} />
            <Field label="Date of Birth" type="date" v={editing.dob || ''} on={(v) => setEditing({ ...editing, dob: v })} />
            <Field label="Mobile" v={editing.mobile} on={(v) => setEditing({ ...editing, mobile: v })} />
            <Field label="Email" type="email" v={editing.email} on={(v) => setEditing({ ...editing, email: v })} />
            <Select label="Department" v={editing.departmentId} on={(v) => setEditing({ ...editing, departmentId: v })}
              opts={(depts.data || []).map((d) => ({ v: d.id, l: d.name }))} />
            <Select label="Designation" v={editing.designationId} on={(v) => setEditing({ ...editing, designationId: v })}
              opts={(desigs.data || []).map((d) => ({ v: d.id, l: d.title || d.name }))} />
            <Select label="Reporting Manager" v={editing.reportingManagerId} on={(v) => setEditing({ ...editing, reportingManagerId: v })}
              opts={Object.entries(nameById).filter(([id]) => String(id) !== String(editing.id)).map(([id, n]) => ({ v: id, l: n }))} />
            <Field label="Joining Date" type="date" v={editing.joiningDate || ''} on={(v) => setEditing({ ...editing, joiningDate: v })} />
            <Select label="Employment Type" v={editing.employmentType} on={(v) => setEditing({ ...editing, employmentType: v })} opts={meta.data.employmentTypes || []} />
            <Field label="Work Location" v={editing.workLocation} on={(v) => setEditing({ ...editing, workLocation: v })} />
            <Select label="Status" v={editing.status} on={(v) => setEditing({ ...editing, status: v })} opts={meta.data.statuses || []} />
            <Field label="Emergency Contact" v={editing.emergencyContact} on={(v) => setEditing({ ...editing, emergencyContact: v })} />
            <Field label="Exit Date" type="date" v={editing.exitDate || ''} on={(v) => setEditing({ ...editing, exitDate: v })} />
          </div>
          <div className="fg"><label>Address</label><textarea rows={2} value={editing.address || ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></div>
          <div className="fg"><label>Remarks</label><textarea rows={2} value={editing.remarks || ''} onChange={(e) => setEditing({ ...editing, remarks: e.target.value })} /></div>
          <div className="fbar">
            <span style={{ flex: 1 }} />
            <button className="btn btn-s" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-g" onClick={saveEmployee} disabled={busy}>{busy ? 'Saving…' : '💾 Save Employee'}</button>
          </div>
          {editing.id ? <EmployeeDocuments employeeId={editing.id} onError={(m) => flash('r', m)} /> : null}
        </div>
      )}
    </>
  );
}

function Field({ label, v, on, type = 'text', disabled }) {
  return (
    <div className="fg">
      <label>{label}</label>
      <input type={type} value={v ?? ''} disabled={disabled} aria-label={label.replace(' *', '')} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

function Select({ label, v, on, opts }) {
  const norm = opts.map((o) => (typeof o === 'string' ? { v: o, l: o } : o));
  return (
    <div className="fg">
      <label>{label}</label>
      <select value={v ?? ''} aria-label={label} onChange={(e) => on(e.target.value)}>
        <option value="">—</option>
        {norm.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

/** Document registry for one employee (metadata only — no file bytes server-side). */
function EmployeeDocuments({ employeeId, onError }) {
  const docs = useHr(() => hrApi.listDocuments(employeeId), [employeeId], []);
  const [draft, setDraft] = useState({ title: '', docType: '', docNumber: '', issuedOn: '', expiresOn: '', notes: '' });
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!draft.title.trim()) { onError('Document title is required.'); return; }
    setBusy(true);
    try { await hrApi.addDocument(employeeId, draft); setDraft({ title: '', docType: '', docNumber: '', issuedOn: '', expiresOn: '', notes: '' }); docs.reload(); }
    catch (e) { onError(err(e)); } finally { setBusy(false); }
  }
  async function remove(d) {
    if (!window.confirm(`Remove "${d.title}"?`)) return;
    try { await hrApi.deleteDocument(d.id); docs.reload(); } catch (e) { onError(err(e)); }
  }

  return (
    <>
      <div className="ctitle" style={{ marginTop: 14 }}>Documents</div>
      <Problem error={docs.error} />
      <div className="tw sy" style={{ maxHeight: 220 }}>
        <table>
          <thead><tr><th>Title</th><th>Type</th><th>Number</th><th>Issued</th><th>Expires</th><th style={{ width: 50 }}></th></tr></thead>
          <tbody>
            {(docs.data || []).length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 14, color: 'var(--i3)' }}>No documents recorded</td></tr>
              : docs.data.map((d) => (
                <tr key={d.id}>
                  <td>{d.title}</td><td style={{ fontSize: 11 }}>{d.docType || '-'}</td><td style={{ fontSize: 11 }}>{d.docNumber || '-'}</td>
                  <td style={{ fontSize: 11 }}>{d.issuedOn ? fmtDate(d.issuedOn) : '-'}</td>
                  <td style={{ fontSize: 11 }}>{d.expiresOn ? fmtDate(d.expiresOn) : '-'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-s" style={{ color: 'var(--red)' }} aria-label={`Remove ${d.title}`} onClick={() => remove(d)}>✕</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="g4" style={{ marginTop: 8, alignItems: 'end' }}>
        <Field label="Title" v={draft.title} on={(v) => setDraft({ ...draft, title: v })} />
        <Field label="Type" v={draft.docType} on={(v) => setDraft({ ...draft, docType: v })} />
        <Field label="Number" v={draft.docNumber} on={(v) => setDraft({ ...draft, docNumber: v })} />
        <div className="fg"><label>&nbsp;</label><button className="btn btn-s" onClick={add} disabled={busy}>＋ Add document</button></div>
      </div>
    </>
  );
}

/* ─────────────────────────── Departments & Designations ─────────────────────────── */
function Org() {
  const [msg, setMsg] = useState(null);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 3500); };
  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="g2" style={{ alignItems: 'start' }}>
        <SimpleList
          title="Departments" field="name" placeholder="e.g. Production"
          load={() => hrApi.listDepartments({})} create={(b) => hrApi.createDepartment(b)}
          update={(id, b) => hrApi.updateDepartment(id, b)} onMsg={flash}
        />
        <SimpleList
          title="Designations" field="title" placeholder="e.g. Line Supervisor"
          load={() => hrApi.listDesignations({})} create={(b) => hrApi.createDesignation(b)}
          update={(id, b) => hrApi.updateDesignation(id, b)} onMsg={flash}
        />
      </div>
      <SimpleList
        title="Leave Types" field="name" placeholder="e.g. Casual Leave" extra="defaultDays" extraLabel="Default days"
        load={() => hrApi.listLeaveTypes({})} create={(b) => hrApi.createLeaveType(b)}
        update={(id, b) => hrApi.updateLeaveType(id, b)} onMsg={flash}
      />
    </>
  );
}

/** Name + active-toggle list, shared by departments / designations / leave types. */
function SimpleList({ title, field, placeholder, extra, extraLabel, load, create, update, onMsg }) {
  const list = useHr(load, [], []);
  const [draft, setDraft] = useState('');
  const [draftExtra, setDraftExtra] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await create({ [field]: draft.trim(), ...(extra ? { [extra]: Number(draftExtra) || 0 } : {}) });
      setDraft(''); setDraftExtra(''); list.reload(); onMsg('g', `✅ ${title.replace(/s$/, '')} added.`);
    } catch (e) { onMsg('r', err(e)); } finally { setBusy(false); }
  }
  async function toggle(row) {
    try { await update(row.id, { active: !row.active }); list.reload(); }
    catch (e) { onMsg('r', err(e)); }
  }
  async function rename(row, value) {
    if (!value.trim() || value === row[field]) return;
    try { await update(row.id, { [field]: value.trim() }); list.reload(); }
    catch (e) { onMsg('r', err(e)); }
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>{title} <span className="tag tgr">{(list.data || []).length}</span></div>
      </div>
      <Problem error={list.error} />
      <div className="tw sy" style={{ maxHeight: 300 }}>
        <table>
          <thead><tr><th>{extraLabel ? 'Name' : title.replace(/s$/, '')}</th>{extra ? <th style={{ width: 110, textAlign: 'right' }}>{extraLabel}</th> : null}<th style={{ width: 90, textAlign: 'center' }}>Active</th></tr></thead>
          <tbody>
            {(list.data || []).length === 0 ? <tr><td colSpan={extra ? 3 : 2} style={{ textAlign: 'center', padding: 14, color: 'var(--i3)' }}>None yet</td></tr>
              : list.data.map((row) => (
                <tr key={row.id}>
                  <td><input defaultValue={row[field] ?? ''} aria-label={`${title} ${row[field]}`} onBlur={(e) => rename(row, e.target.value)} style={{ width: '100%' }} /></td>
                  {extra ? <td style={{ textAlign: 'right' }}>{inr(row[extra])}</td> : null}
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={!!row.active} aria-label={`${row[field]} active`} onChange={() => toggle(row)} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="fbar" style={{ marginTop: 8 }}>
        <input placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`New ${title}`} />
        {extra ? <input type="number" min="0" placeholder={extraLabel} value={draftExtra} onChange={(e) => setDraftExtra(e.target.value)} aria-label={extraLabel} style={{ width: 110 }} /> : null}
        <button className="btn btn-s" onClick={add} disabled={busy || !draft.trim()}>＋ Add</button>
      </div>
    </div>
  );
}

/* ─────────────────────────── Leave ─────────────────────────── */
function Leave() {
  const [status, setStatus] = useState('Pending');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ employeeId: '', leaveTypeId: '', fromDate: today(), toDate: today(), reason: '' });

  const reqs = useHr(() => hrApi.listLeaveRequests(status ? { status } : {}), [status], []);
  const emps = useHr(() => hrApi.listEmployees({ status: 'Active' }), [], []);
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

  async function apply() {
    if (!draft.employeeId) { flash('r', 'Choose an employee.'); return; }
    if (!days) { flash('r', 'To date cannot be before From date.'); return; }
    setBusy(true);
    try {
      await hrApi.createLeaveRequest(draft);
      setDraft({ employeeId: '', leaveTypeId: '', fromDate: today(), toDate: today(), reason: '' });
      flash('g', '✅ Leave request submitted.');
      reqs.reload();
    } catch (e) { flash('r', err(e)); } finally { setBusy(false); }
  }
  async function decide(row, approve) {
    setBusy(true);
    try {
      await (approve ? hrApi.approveLeave(row.id, '') : hrApi.rejectLeave(row.id, ''));
      flash('g', `✅ Request ${approve ? 'approved' : 'rejected'}.`);
      reqs.reload();
    } catch (e) { flash('r', err(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">Apply for leave</div>
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
          <span style={{ fontSize: 12, color: 'var(--i2)' }}>{days ? `${days} day${days === 1 ? '' : 's'}` : 'Check the dates'}</span>
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
        </div>
        <Problem error={reqs.error} />
        <div className="tw sy" style={{ maxHeight: 380 }}>
          <table>
            <thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th style={{ textAlign: 'right' }}>Days</th><th>Reason</th><th>Status</th><th style={{ width: 150 }}></th></tr></thead>
            <tbody>
              {reqs.loading ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
                : (reqs.data || []).length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No requests</td></tr>
                  : reqs.data.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.employeeName || r.employeeId}</td>
                      <td style={{ fontSize: 11 }}>{r.leaveTypeName || '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.fromDate ? fmtDate(r.fromDate) : '-'}</td>
                      <td style={{ fontSize: 11 }}>{r.toDate ? fmtDate(r.toDate) : '-'}</td>
                      <td style={{ textAlign: 'right' }}>{inr(r.days)}</td>
                      <td style={{ fontSize: 11 }}>{r.reason || '-'}</td>
                      <td><span className={'tag ' + (r.status === 'Approved' ? 'tgr' : r.status === 'Rejected' ? 'tr' : 'ty')}>{r.status}</span></td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {r.status === 'Pending' ? (
                          <>
                            <button className="btn btn-g" style={{ height: 24, fontSize: 11, padding: '0 8px' }} disabled={busy} aria-label={`Approve leave ${r.id}`} onClick={() => decide(r, true)}>Approve</button>
                            <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 8px', marginLeft: 4, color: 'var(--red)' }} disabled={busy} aria-label={`Reject leave ${r.id}`} onClick={() => decide(r, false)}>Reject</button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── Audit ─────────────────────────── */
function Audit() {
  const { data, loading, error } = useHr(() => hrApi.audit({ limit: 200 }), [], []);
  return (
    <div className="card">
      <div className="ctitle">HR Audit — who changed what</div>
      <Problem error={error} />
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 300px)' }}>
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
