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
  const [viewing, setViewing] = useState(null);    // employee id whose read-only profile is open
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
      delete body.department; delete body.designation; delete body.reportingManager;
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
              <th>Joined</th><th>Mobile</th><th style={{ width: 140 }}>Status</th><th style={{ width: 120 }}></th>
            </tr></thead>
            <tbody>
              {emps.loading ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 18 }}>Loading…</td></tr>
                : (emps.data || []).length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No employees match</td></tr>
                  : emps.data.map((e) => (
                    <tr key={e.id}>
                      <td><span className="tag tb" style={{ fontSize: 10 }}>{e.empCode}</span></td>
                      <td style={{ fontWeight: 600 }}>{e.fullName}</td>
                      <td style={{ fontSize: 11 }}>{e.department || e.departmentName || '-'}</td>
                      <td style={{ fontSize: 11 }}>{e.designation || e.designationName || '-'}</td>
                      <td style={{ fontSize: 11 }}>{e.joiningDate ? fmtDate(e.joiningDate) : '-'}</td>
                      <td style={{ fontSize: 11 }}>{e.mobile || '-'}</td>
                      <td>
                        <select value={e.status || ''} disabled={busy} aria-label={`Status for ${e.fullName}`} onChange={(ev) => changeStatus(e, ev.target.value)}>
                          {(meta.data.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-s" aria-label={`View ${e.fullName}`} onClick={() => setViewing(e.id)}>View</button>
                        <button className="btn btn-s" style={{ marginLeft: 4 }} aria-label={`Edit ${e.fullName}`} onClick={() => setEditing({ ...EMPTY_EMP, ...e })}>Edit</button>
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

      {viewing != null && <EmployeeProfile employeeId={viewing} onClose={() => setViewing(null)} />}
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
  const [draft, setDraft] = useState({ title: '', docType: '', docNumber: '', refUrl: '', issuedOn: '', expiresOn: '', notes: '' });
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!draft.title.trim()) { onError('Document title is required.'); return; }
    setBusy(true);
    try { await hrApi.addDocument(employeeId, draft); setDraft({ title: '', docType: '', docNumber: '', refUrl: '', issuedOn: '', expiresOn: '', notes: '' }); docs.reload(); }
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
                  <td>{d.refUrl ? <a href={d.refUrl} target="_blank" rel="noopener noreferrer">{d.title}</a> : d.title}</td>
                  <td style={{ fontSize: 11 }}>{d.docType || '-'}</td><td style={{ fontSize: 11 }}>{d.docNumber || '-'}</td>
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
        <Field label="Reference URL" v={draft.refUrl} on={(v) => setDraft({ ...draft, refUrl: v })} />
        <div className="fg"><label>&nbsp;</label><button className="btn btn-s" onClick={add} disabled={busy}>＋ Add document</button></div>
      </div>
    </>
  );
}

/* ─────────────────────────── Employee profile (read-only) ─────────────────────────── */
// Fields shown on the profile, resolved defensively: the detail endpoint may return
// either the list-style *Name keys or the legacy resolved names.
const PROFILE_FIELDS = [
  ['Employee ID', (e) => e.empCode],
  ['Name', (e) => e.fullName],
  ['Status', (e) => e.status],
  ['Gender', (e) => e.gender],
  ['Date of Birth', (e) => fmtDate(e.dob)],
  ['Mobile', (e) => e.mobile],
  ['Email', (e) => e.email],
  ['Department', (e) => e.departmentName || e.department],
  ['Designation', (e) => e.designationName || e.designation],
  ['Reporting Manager', (e) => e.reportingManagerName || e.reportingManager],
  ['Joining Date', (e) => fmtDate(e.joiningDate)],
  ['Employment Type', (e) => e.employmentType],
  ['Work Location', (e) => e.workLocation],
  ['Emergency Contact', (e) => e.emergencyContact],
  ['Exit Date', (e) => fmtDate(e.exitDate)],
];

const leaveTag = (s) => 'tag ' + (s === 'Approved' ? 'tgr' : s === 'Rejected' ? 'tr' : 'ty');

/** Read-only employee profile: core fields + leave balance + leave history.
 *  Balance comes from the employee detail; history from the leave-requests list
 *  narrowed to this employee (kept client-side too, in case the API ignores the
 *  filter). Rendered as a dismissable modal, matching the app's other overlays. */
function EmployeeProfile({ employeeId, onClose }) {
  const emp = useHr(() => hrApi.getEmployee(employeeId), [employeeId], null);
  const history = useHr(() => hrApi.listLeaveRequests({ employeeId }), [employeeId], []);
  const e = emp.data || {};
  const balance = e.leaveBalance || [];
  const requests = (history.data || []).filter((r) => r.employeeId == null || String(r.employeeId) === String(employeeId));

  return (
    <div style={ovlStyle} onClick={onClose}>
      <div style={sheetStyle} role="dialog" aria-modal="true" aria-label="Employee profile" onClick={(ev) => ev.stopPropagation()}>
        <div className="fbar" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Employee Profile — {e.fullName || e.empCode || ''}</div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={onClose}>Close</button>
        </div>

        {emp.loading ? <div style={{ padding: 12 }}>Loading…</div> : emp.error ? <Problem error={emp.error} /> : (
          <>
            <div className="g4">
              {PROFILE_FIELDS.map(([label, get]) => {
                const v = get(e);
                return (
                  <div className="fg" key={label}>
                    <label>{label}</label>
                    <div style={{ fontSize: 13, minHeight: 18 }}>{v == null || v === '' ? '-' : v}</div>
                  </div>
                );
              })}
            </div>
            {e.address ? <div className="fg"><label>Address</label><div style={{ fontSize: 13 }}>{e.address}</div></div> : null}
            {e.remarks ? <div className="fg"><label>Remarks</label><div style={{ fontSize: 13 }}>{e.remarks}</div></div> : null}

            <div className="ctitle" style={{ marginTop: 14 }}>Leave Balance</div>
            <div className="tw sy" style={{ maxHeight: 200 }}>
              <table>
                <thead><tr><th>Type</th><th style={{ textAlign: 'right' }}>Allotment</th><th style={{ textAlign: 'right' }}>Taken</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
                <tbody>
                  {balance.length === 0 ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 14, color: 'var(--i3)' }}>No leave types configured</td></tr>
                    : balance.map((b, i) => (
                      <tr key={b.leaveTypeId || b.leaveType || i}>
                        <td>{b.leaveType || b.leaveTypeName || '-'}</td>
                        <td style={{ textAlign: 'right' }}>{inr(b.allotment)}</td>
                        <td style={{ textAlign: 'right' }}>{inr(b.taken)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{inr(b.balance)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="ctitle" style={{ marginTop: 14 }}>Leave History</div>
            <Problem error={history.error} />
            <div className="tw sy" style={{ maxHeight: 240 }}>
              <table>
                <thead><tr><th>Type</th><th>Period</th><th style={{ textAlign: 'right' }}>Days</th><th>Status</th></tr></thead>
                <tbody>
                  {requests.length === 0 ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 14, color: 'var(--i3)' }}>No leave requests</td></tr>
                    : requests.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontSize: 11 }}>{r.leaveTypeName || r.leaveType || '-'}</td>
                        <td style={{ fontSize: 11 }}>{fmtDate(r.fromDate)} → {fmtDate(r.toDate)}</td>
                        <td style={{ textAlign: 'right' }}>{inr(r.days)}</td>
                        <td><span className={leaveTag(r.status)}>{r.status}</span></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Departments & Designations ─────────────────────────── */
function Org() {
  const [msg, setMsg] = useState(null);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 3500); };
  // Active departments feed the designation → department picker; reloaded when a
  // department is added so a fresh one is immediately selectable.
  const depts = useHr(() => hrApi.listDepartments({ active: 1 }), [], []);
  const deptOpts = (depts.data || []).map((d) => ({ v: d.id, l: d.name }));
  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="g2" style={{ alignItems: 'start' }}>
        <SimpleList
          title="Departments" field="name" placeholder="e.g. Production"
          extraFields={[
            { key: 'code', label: 'Code', type: 'text', placeholder: 'Code' },
            { key: 'description', label: 'Description', type: 'text', placeholder: 'Description' },
          ]}
          // includeInactive: the MANAGEMENT panel must show deactivated rows too —
          // they still hold their (case-insensitive) unique name, so hiding them made
          // "add printing" 409 against an invisible PRINTING with no way to re-enable it.
          load={() => hrApi.listDepartments({ includeInactive: 1 })} create={(b) => hrApi.createDepartment(b)}
          update={(id, b) => hrApi.updateDepartment(id, b)} onMsg={flash} onChanged={depts.reload}
        />
        <SimpleList
          title="Designations" field="title" placeholder="e.g. Line Supervisor"
          extraFields={[
            { key: 'departmentId', label: 'Department', type: 'select', options: deptOpts, displayKey: 'departmentName', placeholder: '— Department —' },
          ]}
          load={() => hrApi.listDesignations({ includeInactive: 1 })} create={(b) => hrApi.createDesignation(b)}
          update={(id, b) => hrApi.updateDesignation(id, b)} onMsg={flash}
        />
      </div>
      <SimpleList
        title="Leave Types" field="name" placeholder="e.g. Casual Leave"
        extraFields={[
          { key: 'defaultDays', label: 'Default days', type: 'number', placeholder: 'Default days' },
          { key: 'code', label: 'Code', type: 'text', placeholder: 'Code' },
        ]}
        load={() => hrApi.listLeaveTypes({ includeInactive: 1 })} create={(b) => hrApi.createLeaveType(b)}
        update={(id, b) => hrApi.updateLeaveType(id, b)} onMsg={flash}
      />
    </>
  );
}

/** Name + active-toggle list, shared by departments / designations / leave types.
 *  `extraFields` (optional) adds columns + create-form inputs — e.g. a department
 *  code/description, a designation's department picker, or a leave type's code.
 *  Blank text/select extras are dropped from the create body, so a name-only add
 *  still posts exactly `{ [field]: name }`. */
function SimpleList({ title, field, placeholder, extraFields = [], load, create, update, onMsg, onChanged }) {
  const list = useHr(load, [], []);
  const [draft, setDraft] = useState('');
  const [extras, setExtras] = useState({});
  const [busy, setBusy] = useState(false);
  const nameLabel = field === 'title' ? 'Title' : 'Name';
  const cols = 2 + extraFields.length;

  const buildExtras = () => {
    const out = {};
    extraFields.forEach((f) => {
      const v = extras[f.key];
      if (f.type === 'number') out[f.key] = Number(v) || 0;                 // always sent (matches legacy default-days)
      else if (v != null && String(v).trim() !== '') out[f.key] = String(v).trim();
    });
    return out;
  };
  const cellText = (row, f) => {
    if (f.type === 'select') return row[f.displayKey || f.key.replace(/Id$/, 'Name')] || '-';
    if (f.type === 'number') return inr(row[f.key]);
    return row[f.key] || '-';
  };

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await create({ [field]: draft.trim(), ...buildExtras() });
      setDraft(''); setExtras({}); list.reload(); if (onChanged) onChanged();
      onMsg('g', `✅ ${title.replace(/s$/, '')} added.`);
    } catch (e) { onMsg('r', err(e)); } finally { setBusy(false); }
  }
  async function toggle(row) {
    try { await update(row.id, { active: !row.active }); list.reload(); if (onChanged) onChanged(); }
    catch (e) { onMsg('r', err(e)); }
  }
  async function rename(row, value) {
    if (!value.trim() || value === row[field]) return;
    try { await update(row.id, { [field]: value.trim() }); list.reload(); if (onChanged) onChanged(); }
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
          <thead><tr>
            <th>{nameLabel}</th>
            {extraFields.map((f) => <th key={f.key} style={f.type === 'number' ? { width: 110, textAlign: 'right' } : undefined}>{f.label}</th>)}
            <th style={{ width: 90, textAlign: 'center' }}>Active</th>
          </tr></thead>
          <tbody>
            {(list.data || []).length === 0 ? <tr><td colSpan={cols} style={{ textAlign: 'center', padding: 14, color: 'var(--i3)' }}>None yet</td></tr>
              : list.data.map((row) => (
                <tr key={row.id}>
                  <td><input defaultValue={row[field] ?? ''} aria-label={`${title} ${row[field]}`} onBlur={(e) => rename(row, e.target.value)} style={{ width: '100%' }} /></td>
                  {extraFields.map((f) => <td key={f.key} style={{ fontSize: 11, ...(f.type === 'number' ? { textAlign: 'right' } : {}) }}>{cellText(row, f)}</td>)}
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
        {extraFields.map((f) => (
          f.type === 'select'
            ? (
              <select key={f.key} value={extras[f.key] ?? ''} aria-label={f.label} style={{ minWidth: 150 }}
                onChange={(e) => setExtras((x) => ({ ...x, [f.key]: e.target.value }))}>
                <option value="">{f.placeholder || '—'}</option>
                {(f.options || []).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            ) : (
              <input key={f.key} type={f.type === 'number' ? 'number' : 'text'} min={f.type === 'number' ? '0' : undefined}
                placeholder={f.placeholder || f.label} value={extras[f.key] ?? ''} aria-label={f.label}
                style={f.type === 'number' ? { width: 110 } : undefined}
                onChange={(e) => setExtras((x) => ({ ...x, [f.key]: e.target.value }))} />
            )
        ))}
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
  const [comments, setComments] = useState({});   // approver comment per pending request id
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
    const comment = (comments[row.id] || '').trim();
    setBusy(true);
    try {
      await (approve ? hrApi.approveLeave(row.id, comment) : hrApi.rejectLeave(row.id, comment));
      setComments((c) => { const n = { ...c }; delete n[row.id]; return n; });
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
            <thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th style={{ textAlign: 'right' }}>Days</th><th>Reason</th><th>Status</th><th style={{ width: 190 }}>Decision</th></tr></thead>
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
                            <div style={{ fontWeight: 600 }}>{r.approver || r.approvedBy || r.decidedBy || '-'}</div>
                            {(r.approverComment || r.comment || r.decisionComment)
                              ? <div style={{ color: 'var(--i3)' }}>{r.approverComment || r.comment || r.decisionComment}</div> : null}
                          </div>
                        )}
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
  const [type, setType] = useState('');
  const { data, loading, error } = useHr(() => hrApi.audit({ limit: 200, ...(type ? { entityType: type } : {}) }), [type], []);
  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>HR Audit — who changed what</div>
        <span style={{ flex: 1 }} />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter audit by entity">
          <option value="">All entities</option>
          {['EMPLOYEE', 'LEAVE_REQUEST', 'DEPARTMENT', 'DESIGNATION', 'LEAVE_TYPE', 'DOCUMENT'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
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

// Modal chrome for the employee profile — mirrors the app's other overlays.
const ovlStyle = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 9600, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '32px 12px' };
const sheetStyle = { background: 'var(--wh)', borderRadius: 12, maxWidth: 720, width: '100%', padding: '20px 22px', boxShadow: '0 20px 60px rgba(0,0,0,.3)', margin: 'auto' };
