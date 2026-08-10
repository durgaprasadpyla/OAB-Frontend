/* ===========================================================================
 * OAB integration — HR layer (runs after the LATE layer, at end of body)
 * ---------------------------------------------------------------------------
 * Adds the Human Resources module WITHOUT touching the reference app blob:
 *   1) Forced first-login (and post-reset) password change — the backend flags
 *      must_change_password; here we intercept session restore and require a
 *      change before the app is usable.
 *   2) RBAC routing — role 'hr' gets an HR-only workspace; role 'superadmin'
 *      keeps the full Operations view PLUS an "HR" nav tab. No other role can
 *      open HR (and the backend independently rejects them with 403).
 *   3) A native-styled HR workspace (dashboard, employees, departments,
 *      designations, leave, audit) driven entirely by /api/hr/**.
 *   4) Extends the Users & Access role picker with HR + Super Admin.
 *
 * All data is API/DB-driven (no hardcoded arrays, no localStorage business data).
 * =========================================================================== */
(function () {
  'use strict';

  var api = window.__oabApi;                       // JWT-attaching fetch (from the late layer)
  if (typeof api !== 'function') {                 // hard dependency; bail safe if missing
    console.error('OAB HR: __oabApi missing — HR layer disabled');
    return;
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function val(id) { var e = el(id); return e ? String(e.value || '').trim() : ''; }

  // API wrapper → resolves parsed JSON, rejects Error(message) with .status on failure.
  function hrApi(path, opts) {
    return api(path, opts).then(function (res) {
      return res.text().then(function (t) {
        var body = null; try { body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
        if (!res.ok) {
          var msg = (body && (body.detail || body.error || body.message)) || ('Request failed (HTTP ' + res.status + ')');
          var err = new Error(msg); err.status = res.status; throw err;
        }
        return body;
      });
    });
  }

  var H = { mode: 'hr', tab: 'dashboard', deps: [], desigs: [], leaveTypes: [], emps: [] };

  // ── styles (scoped to #hr-workspace / .hrx-*; matches the app's look) ────────
  function injectStyles() {
    if (el('hrx-styles')) return;
    var css =
      '#hr-workspace{position:fixed;inset:0;z-index:100000;background:#f5f7fb;color:#1f2d3d;overflow:auto;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;display:none}' +
      '#hr-workspace *{box-sizing:border-box}' +
      '.hrx-top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;flex-wrap:wrap;' +
      'background:linear-gradient(90deg,#123d7a,#1a4fa0);color:#fff;padding:10px 18px;box-shadow:0 2px 8px rgba(0,0,0,.15)}' +
      '.hrx-brand{font-size:16px;font-weight:800;letter-spacing:.2px}.hrx-brand span{opacity:.8;font-weight:600;font-size:12px}' +
      '.hrx-tabs{display:flex;gap:4px;flex-wrap:wrap;flex:1}' +
      '.hrx-tab{background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:7px;padding:7px 13px;font-size:13px;cursor:pointer;font-weight:600}' +
      '.hrx-tab.on{background:#fff;color:#1a4fa0}' +
      '.hrx-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}' +
      '.hrx-body{padding:18px;max-width:1200px;margin:0 auto}' +
      '.hrx-card{background:#fff;border:1px solid #e4e9f0;border-radius:12px;padding:16px 18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(20,40,80,.05)}' +
      '.hrx-card h3{margin:0 0 12px;font-size:15px;font-weight:800;color:#123d7a}' +
      '.hrx-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}' +
      '.hrx-kpi{background:#fff;border:1px solid #e4e9f0;border-left:4px solid #1a4fa0;border-radius:10px;padding:13px 15px}' +
      '.hrx-kpi .n{font-size:26px;font-weight:800;color:#123d7a;line-height:1}.hrx-kpi .l{font-size:11px;color:#5b6b80;margin-top:5px;text-transform:uppercase;letter-spacing:.4px}' +
      '.hrx-kpi.g{border-left-color:#1B6B3A}.hrx-kpi.g .n{color:#1B6B3A}.hrx-kpi.a{border-left-color:#b7791f}.hrx-kpi.a .n{color:#b7791f}' +
      '.hrx-kpi.r{border-left-color:#C0392B}.hrx-kpi.r .n{color:#C0392B}' +
      '.hrx-table{width:100%;border-collapse:collapse;font-size:12.5px}' +
      '.hrx-table th{text-align:left;padding:8px 10px;background:#eef3fb;color:#123d7a;font-weight:700;border-bottom:1px solid #dbe4f0;white-space:nowrap}' +
      '.hrx-table td{padding:8px 10px;border-bottom:1px solid #eef1f5;vertical-align:middle}' +
      '.hrx-table tr:hover td{background:#f9fbfe}' +
      '.hrx-btn{background:#1a4fa0;color:#fff;border:none;border-radius:7px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer}' +
      '.hrx-btn:hover{background:#153f82}.hrx-btn.sm{padding:5px 10px;font-size:11.5px}' +
      '.hrx-btn.g{background:#1B6B3A}.hrx-btn.g:hover{background:#155029}.hrx-btn.r{background:#C0392B}.hrx-btn.r:hover{background:#9d2f24}' +
      '.hrx-btn.ghost{background:#eef3fb;color:#1a4fa0}.hrx-btn.ghost:hover{background:#dde8f8}' +
      '.hrx-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.hrx-in,.hrx-sel,.hrx-ta{width:100%;height:36px;border:1px solid #cfd8e3;border-radius:8px;padding:0 11px;font-size:13px;background:#fff;color:#1f2d3d}' +
      '.hrx-ta{height:auto;min-height:64px;padding:8px 11px}' +
      '.hrx-in:focus,.hrx-sel:focus,.hrx-ta:focus{outline:none;border-color:#1a4fa0;box-shadow:0 0 0 3px rgba(26,79,160,.12)}' +
      '.hrx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px}' +
      '.hrx-fg label{display:block;font-size:11px;font-weight:700;color:#51607a;margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px}' +
      '.hrx-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}' +
      '.hrx-pill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700}' +
      '.hrx-badge-active{background:#e3f5ea;color:#1B6B3A}.hrx-badge-leave{background:#e6f0fb;color:#1d4e89}' +
      '.hrx-badge-notice{background:#fdf3d6;color:#8a6d00}.hrx-badge-inactive{background:#f1f3f5;color:#5b6b80}' +
      '.hrx-badge-resigned,.hrx-badge-terminated{background:#fde8e8;color:#C0392B}' +
      '.hrx-badge-pending{background:#fdf3d6;color:#8a6d00}.hrx-badge-approved{background:#e3f5ea;color:#1B6B3A}.hrx-badge-rejected{background:#fde8e8;color:#C0392B}' +
      '.hrx-msg{font-size:12.5px;margin:8px 0;min-height:18px}.hrx-msg.g{color:#1B6B3A}.hrx-msg.r{color:#C0392B}' +
      '.hrx-empty{text-align:center;color:#8595a8;padding:22px;font-size:13px}' +
      '.hrx-overlay{position:fixed;inset:0;z-index:100010;background:rgba(15,25,45,.5);display:flex;align-items:flex-start;justify-content:center;padding:32px 14px;overflow:auto}' +
      '.hrx-dialog{background:#fff;border-radius:14px;max-width:720px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden}' +
      '.hrx-dialog-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#f3f6fb;border-bottom:1px solid #e4e9f0}' +
      '.hrx-dialog-head h3{margin:0;font-size:15px;color:#123d7a;font-weight:800}' +
      '.hrx-x{background:none;border:none;font-size:20px;cursor:pointer;color:#8595a8;line-height:1}' +
      '.hrx-dialog-body{padding:18px}.hrx-dialog-foot{padding:12px 18px;border-top:1px solid #e4e9f0;display:flex;gap:8px;justify-content:flex-end;background:#fafbfd}' +
      '.hrx-sub{font-size:11px;color:#8595a8;margin:2px 0 12px}' +
      '.hrx-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:8px 18px;font-size:13px}' +
      '.hrx-kv div{padding:4px 0;border-bottom:1px dashed #eef1f5}.hrx-kv b{color:#51607a;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.3px;display:block}';
    var s = document.createElement('style'); s.id = 'hrx-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  // ── status badge helper ──────────────────────────────────────────────────
  function statusBadge(s) {
    var k = String(s || '').toLowerCase().replace(/\s+/g, '');
    var cls = { active: 'active', onleave: 'leave', onnotice: 'notice', inactive: 'inactive', resigned: 'resigned', terminated: 'terminated' }[k] || 'inactive';
    return '<span class="hrx-pill hrx-badge-' + cls + '">' + esc(s || '') + '</span>';
  }
  function leaveBadge(s) {
    var cls = { Approved: 'approved', Rejected: 'rejected', Pending: 'pending' }[s] || 'pending';
    return '<span class="hrx-pill hrx-badge-' + cls + '">' + esc(s || '') + '</span>';
  }

  // ════════════════════ MODAL / DIALOG ════════════════════
  function closeDialog() { var o = el('hrx-dialog-overlay'); if (o) o.remove(); }
  window.hrCloseDialog = closeDialog;
  function dialog(title, bodyHtml, footHtml) {
    closeDialog();
    var o = document.createElement('div'); o.className = 'hrx-overlay'; o.id = 'hrx-dialog-overlay';
    o.innerHTML =
      '<div class="hrx-dialog" role="dialog" aria-modal="true">' +
      '<div class="hrx-dialog-head"><h3>' + esc(title) + '</h3><button class="hrx-x" onclick="hrCloseDialog()" aria-label="Close">&times;</button></div>' +
      '<div class="hrx-dialog-body">' + bodyHtml + '</div>' +
      (footHtml ? '<div class="hrx-dialog-foot">' + footHtml + '</div>' : '') +
      '</div>';
    o.addEventListener('click', function (e) { if (e.target === o) closeDialog(); });
    document.body.appendChild(o);
    return o;
  }

  // ════════════════════ WORKSPACE SHELL ════════════════════
  function buildShell() {
    if (el('hr-workspace')) return;
    injectStyles();
    var w = document.createElement('div'); w.id = 'hr-workspace';
    w.innerHTML =
      '<div class="hrx-top">' +
        '<div class="hrx-brand">🌿 Bloomflex <span>· Human Resources</span></div>' +
        '<div class="hrx-tabs" id="hrx-tabs">' +
          tabBtn('dashboard', '📊 Dashboard') + tabBtn('employees', '👥 Employees') +
          tabBtn('org', '🏢 Departments') + tabBtn('leave', '🗓 Leave') + tabBtn('audit', '📜 Audit') +
        '</div>' +
        '<div class="hrx-actions" id="hrx-actions"></div>' +
      '</div>' +
      '<div class="hrx-body"><div id="hrx-view"></div></div>';
    document.body.appendChild(w);
  }
  function tabBtn(id, label) {
    return '<button class="hrx-tab' + (H.tab === id ? ' on' : '') + '" id="hrx-tab-' + id + '" onclick="hrTab(\'' + id + '\')">' + label + '</button>';
  }
  function setActions() {
    var a = el('hrx-actions'); if (!a) return;
    var who = esc(ls('blm_user') || '');
    var btns = '<span style="font-size:12px;opacity:.9;margin-right:4px">👤 ' + who + '</span>' +
      '<button class="hrx-btn ghost sm" onclick="hrChangePassword()">🔑 Password</button>';
    if (H.mode === 'admin') {
      btns += '<button class="hrx-btn sm" style="background:#0d2a55" onclick="hrClose()">✕ Close</button>';
    } else {
      btns += '<button class="hrx-btn r sm" onclick="hrSignOut()">Sign Out</button>';
    }
    a.innerHTML = btns;
  }

  function openWorkspace(mode) {
    buildShell();
    H.mode = mode || 'hr';
    var w = el('hr-workspace'); if (w) w.style.display = 'block';
    setActions();
    hrTab(H.tab || 'dashboard');
  }
  window.hrOpen = function () { openWorkspace('admin'); };          // superadmin nav entry
  window.hrClose = function () { var w = el('hr-workspace'); if (w) w.style.display = 'none'; };
  window.hrSignOut = function () { if (typeof window.authLogout === 'function') window.authLogout(); };

  window.hrTab = function (name) {
    H.tab = name;
    ['dashboard', 'employees', 'org', 'leave', 'audit'].forEach(function (t) {
      var b = el('hrx-tab-' + t); if (b) b.classList.toggle('on', t === name);
    });
    var v = el('hrx-view'); if (v) v.innerHTML = '<div class="hrx-empty">Loading…</div>';
    if (name === 'dashboard') renderDashboard();
    else if (name === 'employees') renderEmployees();
    else if (name === 'org') renderOrg();
    else if (name === 'leave') renderLeave();
    else if (name === 'audit') renderAudit();
  };
  function view(html) { var v = el('hrx-view'); if (v) v.innerHTML = html; }
  function fail(e) { view('<div class="hrx-card"><div class="hrx-msg r">⚠ ' + esc(e && e.message || 'Something went wrong') + '</div></div>'); }

  // ════════════════════ DASHBOARD ════════════════════
  function renderDashboard() {
    hrApi('/api/hr/dashboard').then(function (d) {
      d = d || {};
      var kpis =
        kpi(d.totalEmployees, 'Total Employees') + kpi(d.activeEmployees, 'Active', 'g') +
        kpi(d.onLeave, 'On Leave', 'a') + kpi(d.onNotice, 'On Notice', 'a') +
        kpi(d.inactiveEmployees, 'Inactive / Exited', 'r') + kpi(d.newJoiners, 'New Joiners (30d)', 'g') +
        kpi(d.pendingLeave, 'Pending Leave', 'a');
      var byDept = (d.byDepartment || []).map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td style="text-align:right">' + r.count + '</td></tr>';
      }).join('') || '<tr><td colspan="2" class="hrx-empty">No departments yet</td></tr>';
      var byStatus = (d.byStatus || []).map(function (r) {
        return '<tr><td>' + statusBadge(r.status) + '</td><td style="text-align:right">' + r.count + '</td></tr>';
      }).join('') || '<tr><td colspan="2" class="hrx-empty">No employees yet</td></tr>';
      view(
        '<div class="hrx-card"><h3>HR Overview</h3><div class="hrx-kpis">' + kpis + '</div></div>' +
        '<div class="hrx-grid">' +
          '<div class="hrx-card"><h3>Head-count by Department</h3><table class="hrx-table"><thead><tr><th>Department</th><th style="text-align:right">Active</th></tr></thead><tbody>' + byDept + '</tbody></table></div>' +
          '<div class="hrx-card"><h3>By Status</h3><table class="hrx-table"><thead><tr><th>Status</th><th style="text-align:right">Count</th></tr></thead><tbody>' + byStatus + '</tbody></table></div>' +
        '</div>');
    }).catch(fail);
  }
  function kpi(n, label, cls) {
    return '<div class="hrx-kpi ' + (cls || '') + '"><div class="n">' + (n == null ? 0 : n) + '</div><div class="l">' + esc(label) + '</div></div>';
  }

  // ════════════════════ EMPLOYEES ════════════════════
  function loadRefs() {
    // departments + designations + leave types + managers, cached for forms/filters
    return Promise.all([
      hrApi('/api/hr/departments'), hrApi('/api/hr/designations'), hrApi('/api/hr/leave-types')
    ]).then(function (r) { H.deps = r[0] || []; H.desigs = r[1] || []; H.leaveTypes = r[2] || []; });
  }
  function optList(items, valKey, labelKey, sel, placeholder) {
    var o = '<option value="">' + esc(placeholder || '— Select —') + '</option>';
    (items || []).forEach(function (it) {
      var v = it[valKey], l = it[labelKey];
      o += '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
    });
    return o;
  }

  function renderEmployees() {
    loadRefs().then(function () {
      var f = H.empFilters || {};
      var toolbar =
        '<div class="hrx-toolbar">' +
          '<input class="hrx-in" style="max-width:230px" id="hrx-emp-q" placeholder="🔍 Name, ID, email, mobile" value="' + esc(f.q || '') + '" onkeyup="if(event.key===\'Enter\')hrEmpSearch()">' +
          '<select class="hrx-sel" style="max-width:170px" id="hrx-emp-status">' + optList([{ v: '', l: 'All statuses' }].concat(['Active', 'On Notice', 'Inactive', 'Resigned', 'Terminated', 'On Leave'].map(function (s) { return { v: s, l: s }; })), 'v', 'l', f.status, 'All statuses') + '</select>' +
          '<select class="hrx-sel" style="max-width:190px" id="hrx-emp-dept">' + optList([{ id: '', name: 'All departments' }].concat(H.deps), 'id', 'name', f.departmentId, 'All departments') + '</select>' +
          '<button class="hrx-btn ghost" onclick="hrEmpSearch()">Filter</button>' +
          '<span style="flex:1"></span>' +
          '<button class="hrx-btn g" onclick="hrEmpForm()">＋ Add Employee</button>' +
        '</div>';
      var qs = [];
      if (f.q) qs.push('q=' + encodeURIComponent(f.q));
      if (f.status) qs.push('status=' + encodeURIComponent(f.status));
      if (f.departmentId) qs.push('departmentId=' + encodeURIComponent(f.departmentId));
      hrApi('/api/hr/employees' + (qs.length ? '?' + qs.join('&') : '')).then(function (list) {
        H.emps = list || [];
        var rows = H.emps.map(function (e) {
          return '<tr>' +
            '<td style="font-weight:700">' + esc(e.empCode) + '</td>' +
            '<td>' + esc(e.fullName || '') + '</td>' +
            '<td>' + esc(e.department || '—') + '</td>' +
            '<td>' + esc(e.designation || '—') + '</td>' +
            '<td>' + statusBadge(e.status) + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="hrx-btn ghost sm" onclick="hrEmpView(' + e.id + ')">View</button> ' +
              '<button class="hrx-btn sm" onclick="hrEmpForm(' + e.id + ')">Edit</button>' +
            '</td></tr>';
        }).join('') || '<tr><td colspan="6" class="hrx-empty">No employees found. Click “Add Employee” to create one.</td></tr>';
        view('<div class="hrx-card"><h3>Employees <span style="font-weight:600;color:#8595a8;font-size:12px">(' + H.emps.length + ')</span></h3>' + toolbar +
          '<div style="overflow-x:auto"><table class="hrx-table"><thead><tr><th>Emp ID</th><th>Name</th><th>Department</th><th>Designation</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>');
      }).catch(fail);
    }).catch(fail);
  }
  window.hrEmpSearch = function () {
    H.empFilters = { q: val('hrx-emp-q'), status: val('hrx-emp-status'), departmentId: val('hrx-emp-dept') };
    renderEmployees();
  };

  // Add / edit employee form (dialog)
  window.hrEmpForm = function (id) {
    var e = id ? (H.emps.find(function (x) { return x.id === id; }) || {}) : {};
    var managers = H.emps.filter(function (m) { return m.id !== id; });
    var g = function (label, inner) { return '<div class="hrx-fg"><label>' + label + '</label>' + inner + '</div>'; };
    var body =
      '<div class="hrx-grid">' +
        g('Employee ID *', '<input class="hrx-in" id="hrf-code" value="' + esc(e.empCode || '') + '"' + (id ? ' readonly' : '') + '>') +
        g('First Name *', '<input class="hrx-in" id="hrf-first" value="' + esc(e.firstName || '') + '">') +
        g('Last Name', '<input class="hrx-in" id="hrf-last" value="' + esc(e.lastName || '') + '">') +
        g('Gender', '<select class="hrx-sel" id="hrf-gender">' + optList(['', 'Male', 'Female', 'Other'].map(function (s) { return { v: s, l: s || '—' }; }), 'v', 'l', e.gender, '—') + '</select>') +
        g('Date of Birth', '<input type="date" class="hrx-in" id="hrf-dob" value="' + esc(e.dob || '') + '">') +
        g('Mobile', '<input class="hrx-in" id="hrf-mobile" value="' + esc(e.mobile || '') + '">') +
        g('Email', '<input class="hrx-in" id="hrf-email" value="' + esc(e.email || '') + '">') +
        g('Department', '<select class="hrx-sel" id="hrf-dept">' + optList(H.deps, 'id', 'name', e.departmentId, '— Department —') + '</select>') +
        g('Designation', '<select class="hrx-sel" id="hrf-desig">' + optList(H.desigs, 'id', 'title', e.designationId, '— Designation —') + '</select>') +
        g('Reporting Manager', '<select class="hrx-sel" id="hrf-mgr">' + optList(managers, 'id', 'fullName', e.reportingManagerId, '— Manager —') + '</select>') +
        g('Joining Date', '<input type="date" class="hrx-in" id="hrf-join" value="' + esc(e.joiningDate || '') + '">') +
        g('Employment Type', '<select class="hrx-sel" id="hrf-emp">' + optList(['', 'Full-time', 'Part-time', 'Contract', 'Intern', 'Consultant'].map(function (s) { return { v: s, l: s || '—' }; }), 'v', 'l', e.employmentType, '—') + '</select>') +
        g('Work Location', '<input class="hrx-in" id="hrf-loc" value="' + esc(e.workLocation || '') + '">') +
        g('Status', '<select class="hrx-sel" id="hrf-status">' + optList(['Active', 'On Notice', 'Inactive', 'Resigned', 'Terminated', 'On Leave'].map(function (s) { return { v: s, l: s }; }), 'v', 'l', e.status || 'Active', 'Active') + '</select>') +
        g('Emergency Contact', '<input class="hrx-in" id="hrf-emg" value="' + esc(e.emergencyContact || '') + '">') +
        g('Date of Exit', '<input type="date" class="hrx-in" id="hrf-exit" value="' + esc(e.exitDate || '') + '">') +
      '</div>' +
      '<div class="hrx-fg" style="margin-top:12px"><label>Address</label><textarea class="hrx-ta" id="hrf-addr">' + esc(e.address || '') + '</textarea></div>' +
      '<div class="hrx-fg" style="margin-top:12px"><label>Remarks</label><textarea class="hrx-ta" id="hrf-remarks">' + esc(e.remarks || '') + '</textarea></div>' +
      '<div class="hrx-msg" id="hrf-msg"></div>';
    var foot = '<button class="hrx-btn ghost" onclick="hrCloseDialog()">Cancel</button>' +
      '<button class="hrx-btn g" id="hrf-save" onclick="hrEmpSave(' + (id || 0) + ')">' + (id ? 'Save Changes' : 'Create Employee') + '</button>';
    dialog(id ? 'Edit Employee' : 'Add Employee', body, foot);
  };
  window.hrEmpSave = function (id) {
    var msg = el('hrf-msg');
    var body = {
      empCode: val('hrf-code'), firstName: val('hrf-first'), lastName: val('hrf-last'), gender: val('hrf-gender'),
      dob: val('hrf-dob'), mobile: val('hrf-mobile'), email: val('hrf-email'),
      departmentId: val('hrf-dept') || null, designationId: val('hrf-desig') || null, reportingManagerId: val('hrf-mgr') || null,
      joiningDate: val('hrf-join'), employmentType: val('hrf-emp'), workLocation: val('hrf-loc'),
      status: val('hrf-status'), emergencyContact: val('hrf-emg'), exitDate: val('hrf-exit'),
      address: val('hrf-addr'), remarks: val('hrf-remarks')
    };
    if (!body.empCode || !body.firstName) { if (msg) { msg.className = 'hrx-msg r'; msg.textContent = 'Employee ID and First Name are required.'; } return; }
    var btn = el('hrf-save'); if (btn) btn.disabled = true;
    var p = id ? hrApi('/api/hr/employees/' + id, { method: 'PUT', body: body })
               : hrApi('/api/hr/employees', { method: 'POST', body: body });
    p.then(function () { closeDialog(); renderEmployees(); })
     .catch(function (e) { if (btn) btn.disabled = false; if (msg) { msg.className = 'hrx-msg r'; msg.textContent = '⚠ ' + e.message; } });
  };

  // Employee profile (dialog) — details + documents + leave
  window.hrEmpView = function (id) {
    hrApi('/api/hr/employees/' + id).then(function (e) {
      var kv = function (l, v) { return '<div><b>' + l + '</b>' + esc(v == null || v === '' ? '—' : v) + '</div>'; };
      var details =
        '<div class="hrx-kv">' +
          kv('Employee ID', e.empCode) + kv('Name', e.fullName) + kv('Status', e.status) +
          kv('Gender', e.gender) + kv('Date of Birth', e.dob) + kv('Mobile', e.mobile) +
          kv('Email', e.email) + kv('Department', e.department) + kv('Designation', e.designation) +
          kv('Reporting Manager', e.reportingManager) + kv('Joining Date', e.joiningDate) + kv('Employment Type', e.employmentType) +
          kv('Work Location', e.workLocation) + kv('Emergency Contact', e.emergencyContact) + kv('Date of Exit', e.exitDate) +
        '</div>' +
        (e.address ? '<div style="margin-top:10px;font-size:13px"><b style="color:#51607a;font-size:11px;text-transform:uppercase">Address</b><br>' + esc(e.address) + '</div>' : '') +
        (e.remarks ? '<div style="margin-top:10px;font-size:13px"><b style="color:#51607a;font-size:11px;text-transform:uppercase">Remarks</b><br>' + esc(e.remarks) + '</div>' : '');

      var bal = (e.leaveBalance || []).map(function (b) {
        return '<tr><td>' + esc(b.leaveType) + '</td><td style="text-align:right">' + b.allotment + '</td><td style="text-align:right">' + b.taken + '</td><td style="text-align:right;font-weight:700">' + b.balance + '</td></tr>';
      }).join('') || '<tr><td colspan="4" class="hrx-empty">No leave types configured</td></tr>';

      var lrs = (e.leaveRequests || []).map(function (r) {
        return '<tr><td>' + esc(r.leaveType || '—') + '</td><td>' + esc(r.fromDate) + ' → ' + esc(r.toDate) + '</td><td style="text-align:right">' + (r.days == null ? '' : r.days) + '</td><td>' + leaveBadge(r.status) + '</td></tr>';
      }).join('') || '<tr><td colspan="4" class="hrx-empty">No leave requests</td></tr>';

      var docs = (e.documents || []).map(function (d) {
        return '<tr><td>' + esc(d.docType || '—') + '</td><td>' + (d.refUrl ? '<a href="' + esc(d.refUrl) + '" target="_blank" rel="noopener">' + esc(d.title) + '</a>' : esc(d.title)) + '</td><td>' + esc(d.note || '') + '</td>' +
          '<td><button class="hrx-btn r sm" onclick="hrDocDelete(' + d.id + ',' + id + ')">Delete</button></td></tr>';
      }).join('') || '<tr><td colspan="4" class="hrx-empty">No documents</td></tr>';

      var body =
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
          '<button class="hrx-btn sm" onclick="hrCloseDialog();hrEmpForm(' + id + ')">✎ Edit</button>' +
          '<button class="hrx-btn ghost sm" onclick="hrEmpStatus(' + id + ',\'' + esc(e.status) + '\')">Change Status</button>' +
        '</div>' + details +
        '<h3 style="margin:18px 0 8px;font-size:13px;color:#123d7a">Leave Balance</h3>' +
        '<table class="hrx-table"><thead><tr><th>Type</th><th style="text-align:right">Allotment</th><th style="text-align:right">Taken</th><th style="text-align:right">Balance</th></tr></thead><tbody>' + bal + '</tbody></table>' +
        '<h3 style="margin:18px 0 8px;font-size:13px;color:#123d7a">Leave History</h3>' +
        '<table class="hrx-table"><thead><tr><th>Type</th><th>Period</th><th style="text-align:right">Days</th><th>Status</th></tr></thead><tbody>' + lrs + '</tbody></table>' +
        '<h3 style="margin:18px 0 8px;font-size:13px;color:#123d7a">Documents</h3>' +
        '<table class="hrx-table"><thead><tr><th>Type</th><th>Title</th><th>Note</th><th></th></tr></thead><tbody>' + docs + '</tbody></table>' +
        '<div class="hrx-grid" style="margin-top:10px">' +
          '<input class="hrx-in" id="hrd-type" placeholder="Doc type (e.g. PAN)">' +
          '<input class="hrx-in" id="hrd-title" placeholder="Title *">' +
          '<input class="hrx-in" id="hrd-url" placeholder="Link / reference URL">' +
        '</div>' +
        '<div style="margin-top:8px"><button class="hrx-btn sm" onclick="hrDocAdd(' + id + ')">＋ Add Document</button> <span class="hrx-msg" id="hrd-msg" style="display:inline"></span></div>';
      dialog('Employee Profile — ' + (e.fullName || e.empCode), body, '<button class="hrx-btn ghost" onclick="hrCloseDialog()">Close</button>');
    }).catch(function (e) { alert(e.message); });
  };
  window.hrEmpStatus = function (id, cur) {
    var opts = ['Active', 'On Notice', 'Inactive', 'Resigned', 'Terminated', 'On Leave'];
    var body = '<div class="hrx-fg"><label>New Status</label><select class="hrx-sel" id="hrs-status">' +
      optList(opts.map(function (s) { return { v: s, l: s }; }), 'v', 'l', cur, cur) + '</select></div>' +
      '<div class="hrx-sub">Changing an employee to Resigned / Terminated / Inactive keeps their record and history intact.</div>' +
      '<div class="hrx-msg" id="hrs-msg"></div>';
    dialog('Change Employee Status', body,
      '<button class="hrx-btn ghost" onclick="hrCloseDialog()">Cancel</button><button class="hrx-btn g" onclick="hrStatusSave(' + id + ')">Apply</button>');
  };
  window.hrStatusSave = function (id) {
    var status = val('hrs-status');
    if (!confirm('Change this employee\'s status to “' + status + '”?')) return;
    hrApi('/api/hr/employees/' + id + '/status', { method: 'POST', body: { status: status } })
      .then(function () { closeDialog(); renderEmployees(); })
      .catch(function (e) { var m = el('hrs-msg'); if (m) { m.className = 'hrx-msg r'; m.textContent = '⚠ ' + e.message; } });
  };
  window.hrDocAdd = function (empId) {
    var title = val('hrd-title'); var m = el('hrd-msg');
    if (!title) { if (m) { m.className = 'hrx-msg r'; m.textContent = 'Title is required.'; } return; }
    hrApi('/api/hr/employees/' + empId + '/documents', { method: 'POST', body: { docType: val('hrd-type'), title: title, refUrl: val('hrd-url') } })
      .then(function () { hrEmpView(empId); }).catch(function (e) { if (m) { m.className = 'hrx-msg r'; m.textContent = '⚠ ' + e.message; } });
  };
  window.hrDocDelete = function (docId, empId) {
    if (!confirm('Delete this document reference?')) return;
    hrApi('/api/hr/documents/' + docId, { method: 'DELETE' }).then(function () { hrEmpView(empId); }).catch(function (e) { alert(e.message); });
  };

  // ════════════════════ DEPARTMENTS + DESIGNATIONS ════════════════════
  function renderOrg() {
    Promise.all([hrApi('/api/hr/departments?includeInactive=1'), hrApi('/api/hr/designations?includeInactive=1')])
      .then(function (r) {
        var deps = r[0] || [], desigs = r[1] || [];
        H.deps = deps.filter(function (d) { return d.active; }); H.desigs = desigs.filter(function (d) { return d.active; });
        var depRows = deps.map(function (d) {
          return '<tr' + (d.active ? '' : ' style="opacity:.55"') + '><td style="font-weight:700">' + esc(d.name) + '</td><td>' + esc(d.code || '—') + '</td><td>' + esc(d.description || '') + '</td>' +
            '<td>' + (d.active ? '<span class="hrx-pill hrx-badge-active">Active</span>' : '<span class="hrx-pill hrx-badge-inactive">Inactive</span>') + '</td>' +
            '<td><button class="hrx-btn ' + (d.active ? 'r' : 'g') + ' sm" onclick="hrDeptToggle(' + d.id + ',' + (!d.active) + ')">' + (d.active ? 'Deactivate' : 'Activate') + '</button></td></tr>';
        }).join('') || '<tr><td colspan="5" class="hrx-empty">No departments</td></tr>';
        var desigRows = desigs.map(function (d) {
          return '<tr' + (d.active ? '' : ' style="opacity:.55"') + '><td style="font-weight:700">' + esc(d.title) + '</td><td>' + esc(d.departmentName || '—') + '</td>' +
            '<td>' + (d.active ? '<span class="hrx-pill hrx-badge-active">Active</span>' : '<span class="hrx-pill hrx-badge-inactive">Inactive</span>') + '</td>' +
            '<td><button class="hrx-btn ' + (d.active ? 'r' : 'g') + ' sm" onclick="hrDesigToggle(' + d.id + ',' + (!d.active) + ')">' + (d.active ? 'Deactivate' : 'Activate') + '</button></td></tr>';
        }).join('') || '<tr><td colspan="4" class="hrx-empty">No designations</td></tr>';
        view(
          '<div class="hrx-grid">' +
          '<div class="hrx-card"><h3>Departments</h3>' +
            '<div class="hrx-grid" style="margin-bottom:10px"><input class="hrx-in" id="hro-dep-name" placeholder="Department name *"><input class="hrx-in" id="hro-dep-code" placeholder="Code"></div>' +
            '<input class="hrx-in" id="hro-dep-desc" placeholder="Description" style="margin-bottom:8px"><button class="hrx-btn g" onclick="hrDeptAdd()">＋ Add Department</button>' +
            '<div class="hrx-msg" id="hro-dep-msg"></div>' +
            '<div style="overflow-x:auto"><table class="hrx-table"><thead><tr><th>Name</th><th>Code</th><th>Description</th><th>Status</th><th></th></tr></thead><tbody>' + depRows + '</tbody></table></div></div>' +
          '<div class="hrx-card"><h3>Designations</h3>' +
            '<div class="hrx-grid" style="margin-bottom:10px"><input class="hrx-in" id="hro-des-title" placeholder="Designation title *"><select class="hrx-sel" id="hro-des-dept">' + optList(H.deps, 'id', 'name', '', '— Department (optional) —') + '</select></div>' +
            '<button class="hrx-btn g" onclick="hrDesigAdd()">＋ Add Designation</button><div class="hrx-msg" id="hro-des-msg"></div>' +
            '<div style="overflow-x:auto"><table class="hrx-table"><thead><tr><th>Title</th><th>Department</th><th>Status</th><th></th></tr></thead><tbody>' + desigRows + '</tbody></table></div></div>' +
          '</div>');
      }).catch(fail);
  }
  window.hrDeptAdd = function () {
    var name = val('hro-dep-name'); var m = el('hro-dep-msg');
    if (!name) { m.className = 'hrx-msg r'; m.textContent = 'Name is required.'; return; }
    hrApi('/api/hr/departments', { method: 'POST', body: { name: name, code: val('hro-dep-code'), description: val('hro-dep-desc') } })
      .then(renderOrg).catch(function (e) { m.className = 'hrx-msg r'; m.textContent = '⚠ ' + e.message; });
  };
  window.hrDeptToggle = function (id, active) { hrApi('/api/hr/departments/' + id, { method: 'PUT', body: { active: active } }).then(renderOrg).catch(function (e) { alert(e.message); }); };
  window.hrDesigAdd = function () {
    var title = val('hro-des-title'); var m = el('hro-des-msg');
    if (!title) { m.className = 'hrx-msg r'; m.textContent = 'Title is required.'; return; }
    hrApi('/api/hr/designations', { method: 'POST', body: { title: title, departmentId: val('hro-des-dept') || null } })
      .then(renderOrg).catch(function (e) { m.className = 'hrx-msg r'; m.textContent = '⚠ ' + e.message; });
  };
  window.hrDesigToggle = function (id, active) { hrApi('/api/hr/designations/' + id, { method: 'PUT', body: { active: active } }).then(renderOrg).catch(function (e) { alert(e.message); }); };

  // ════════════════════ LEAVE ════════════════════
  function renderLeave() {
    Promise.all([hrApi('/api/hr/leave-types?includeInactive=1'), hrApi('/api/hr/leave-requests'), hrApi('/api/hr/employees')])
      .then(function (r) {
        var types = r[0] || []; var reqs = r[1] || []; H.emps = r[2] || [];
        H.leaveTypes = types.filter(function (t) { return t.active; });
        var typeRows = types.map(function (t) {
          return '<tr' + (t.active ? '' : ' style="opacity:.55"') + '><td style="font-weight:700">' + esc(t.name) + '</td><td>' + esc(t.code || '—') + '</td><td style="text-align:right">' + t.defaultDays + '</td>' +
            '<td><button class="hrx-btn ' + (t.active ? 'r' : 'g') + ' sm" onclick="hrLtToggle(' + t.id + ',' + (!t.active) + ')">' + (t.active ? 'Deactivate' : 'Activate') + '</button></td></tr>';
        }).join('') || '<tr><td colspan="4" class="hrx-empty">No leave types</td></tr>';
        var reqRows = reqs.map(function (q) {
          var act = (q.status === 'Pending')
            ? '<button class="hrx-btn g sm" onclick="hrLeaveDecide(' + q.id + ',true)">Approve</button> <button class="hrx-btn r sm" onclick="hrLeaveDecide(' + q.id + ',false)">Reject</button>'
            : (esc(q.approver || '') + (q.approverComment ? ' · ' + esc(q.approverComment) : ''));
          return '<tr><td>' + esc(q.employeeName || '') + ' <span style="color:#8595a8">(' + esc(q.empCode || '') + ')</span></td><td>' + esc(q.leaveType || '—') + '</td>' +
            '<td>' + esc(q.fromDate) + ' → ' + esc(q.toDate) + '</td><td style="text-align:right">' + (q.days == null ? '' : q.days) + '</td><td>' + esc(q.reason || '') + '</td>' +
            '<td>' + leaveBadge(q.status) + '</td><td style="white-space:nowrap">' + act + '</td></tr>';
        }).join('') || '<tr><td colspan="7" class="hrx-empty">No leave requests</td></tr>';
        view(
          '<div class="hrx-card"><h3>Leave Requests</h3>' +
            '<div class="hrx-toolbar"><button class="hrx-btn g" onclick="hrLeaveForm()">＋ New Leave Request</button>' +
              '<select class="hrx-sel" style="max-width:170px" id="hrx-lr-status" onchange="hrLeaveFilter()">' + optList([{ v: '', l: 'All statuses' }, { v: 'Pending', l: 'Pending' }, { v: 'Approved', l: 'Approved' }, { v: 'Rejected', l: 'Rejected' }], 'v', 'l', (H.leaveFilter || ''), 'All') + '</select></div>' +
            '<div style="overflow-x:auto"><table class="hrx-table"><thead><tr><th>Employee</th><th>Type</th><th>Period</th><th style="text-align:right">Days</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead><tbody>' + reqRows + '</tbody></table></div></div>' +
          '<div class="hrx-card"><h3>Leave Types</h3>' +
            '<div class="hrx-grid" style="margin-bottom:10px"><input class="hrx-in" id="hrlt-name" placeholder="Name * (e.g. Casual Leave)"><input class="hrx-in" id="hrlt-code" placeholder="Code (CL)"><input type="number" class="hrx-in" id="hrlt-days" placeholder="Annual days"></div>' +
            '<button class="hrx-btn g" onclick="hrLtAdd()">＋ Add Leave Type</button><div class="hrx-msg" id="hrlt-msg"></div>' +
            '<table class="hrx-table" style="margin-top:8px"><thead><tr><th>Name</th><th>Code</th><th style="text-align:right">Annual Days</th><th></th></tr></thead><tbody>' + typeRows + '</tbody></table></div>');
      }).catch(fail);
  }
  window.hrLeaveFilter = function () { H.leaveFilter = val('hrx-lr-status'); renderLeaveFiltered(); };
  function renderLeaveFiltered() {
    var qs = H.leaveFilter ? '?status=' + encodeURIComponent(H.leaveFilter) : '';
    // Simple client refresh: re-render the whole tab (keeps the filter select value in H)
    renderLeave();
  }
  window.hrLtAdd = function () {
    var name = val('hrlt-name'); var m = el('hrlt-msg');
    if (!name) { m.className = 'hrx-msg r'; m.textContent = 'Name is required.'; return; }
    hrApi('/api/hr/leave-types', { method: 'POST', body: { name: name, code: val('hrlt-code'), defaultDays: parseInt(val('hrlt-days') || '0', 10) || 0 } })
      .then(renderLeave).catch(function (e) { m.className = 'hrx-msg r'; m.textContent = '⚠ ' + e.message; });
  };
  window.hrLtToggle = function (id, active) { hrApi('/api/hr/leave-types/' + id, { method: 'PUT', body: { active: active } }).then(renderLeave).catch(function (e) { alert(e.message); }); };
  window.hrLeaveForm = function () {
    var body =
      '<div class="hrx-grid">' +
        '<div class="hrx-fg"><label>Employee *</label><select class="hrx-sel" id="hrl-emp">' + optList(H.emps, 'id', 'fullName', '', '— Select employee —') + '</select></div>' +
        '<div class="hrx-fg"><label>Leave Type</label><select class="hrx-sel" id="hrl-type">' + optList(H.leaveTypes, 'id', 'name', '', '— Type —') + '</select></div>' +
        '<div class="hrx-fg"><label>From *</label><input type="date" class="hrx-in" id="hrl-from"></div>' +
        '<div class="hrx-fg"><label>To *</label><input type="date" class="hrx-in" id="hrl-to"></div>' +
      '</div>' +
      '<div class="hrx-fg" style="margin-top:12px"><label>Reason</label><textarea class="hrx-ta" id="hrl-reason"></textarea></div>' +
      '<div class="hrx-msg" id="hrl-msg"></div>';
    dialog('New Leave Request', body,
      '<button class="hrx-btn ghost" onclick="hrCloseDialog()">Cancel</button><button class="hrx-btn g" onclick="hrLeaveSave()">Submit</button>');
  };
  window.hrLeaveSave = function () {
    var m = el('hrl-msg');
    var emp = val('hrl-emp'), from = val('hrl-from'), to = val('hrl-to');
    if (!emp || !from || !to) { m.className = 'hrx-msg r'; m.textContent = 'Employee, From and To are required.'; return; }
    hrApi('/api/hr/leave-requests', { method: 'POST', body: { employeeId: emp, leaveTypeId: val('hrl-type') || null, fromDate: from, toDate: to, reason: val('hrl-reason') } })
      .then(function () { closeDialog(); renderLeave(); }).catch(function (e) { m.className = 'hrx-msg r'; m.textContent = '⚠ ' + e.message; });
  };
  window.hrLeaveDecide = function (id, approve) {
    var comment = prompt(approve ? 'Approve this leave request? Optional comment:' : 'Reject this leave request? Reason / comment:', '');
    if (comment === null) return;   // cancelled
    hrApi('/api/hr/leave-requests/' + id + '/' + (approve ? 'approve' : 'reject'), { method: 'POST', body: { comment: comment } })
      .then(renderLeave).catch(function (e) { alert(e.message); });
  };

  // ════════════════════ AUDIT ════════════════════
  function renderAudit() {
    var et = H.auditType || '';
    hrApi('/api/hr/audit?limit=200' + (et ? '&entityType=' + encodeURIComponent(et) : '')).then(function (list) {
      var rows = (list || []).map(function (a) {
        var when = a.ts ? new Date(a.ts).toLocaleString('en-IN') : '';
        return '<tr><td style="white-space:nowrap">' + esc(when) + '</td><td>' + esc(a.actor || '') + '</td><td>' + esc(a.entityType) + ' <span style="color:#8595a8">#' + esc(a.entityId || '') + '</span></td><td>' + esc(a.action) + '</td><td style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(a.details || '') + '">' + esc(a.details || '') + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="hrx-empty">No audit entries yet</td></tr>';
      var types = ['', 'EMPLOYEE', 'LEAVE_REQUEST', 'DEPARTMENT', 'DESIGNATION', 'LEAVE_TYPE', 'DOCUMENT'];
      view('<div class="hrx-card"><h3>HR Audit Trail</h3>' +
        '<div class="hrx-toolbar"><select class="hrx-sel" style="max-width:200px" id="hrx-audit-type" onchange="hrAuditFilter()">' +
          optList(types.map(function (t) { return { v: t, l: t || 'All entities' }; }), 'v', 'l', et, 'All entities') + '</select></div>' +
        '<div style="overflow-x:auto"><table class="hrx-table"><thead><tr><th>When</th><th>Actor</th><th>Entity</th><th>Action</th><th>Details</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>');
    }).catch(fail);
  }
  window.hrAuditFilter = function () { H.auditType = val('hrx-audit-type'); renderAudit(); };

  // ════════════════════ CHANGE PASSWORD (forced + manual) ════════════════════
  window.hrChangePassword = function () { showChangePassword(false, null); };
  function showChangePassword(forced, thenRole) {
    injectStyles();
    var body =
      (forced ? '<div class="hrx-sub" style="color:#b7791f;font-weight:600">🔒 For security, you must set a new password before continuing.</div>' : '') +
      '<div class="hrx-fg"><label>Current Password *</label><input type="password" class="hrx-in" id="hrpw-cur" autocomplete="current-password"></div>' +
      '<div class="hrx-fg" style="margin-top:10px"><label>New Password * (min 6 chars)</label><input type="password" class="hrx-in" id="hrpw-new" autocomplete="new-password"></div>' +
      '<div class="hrx-fg" style="margin-top:10px"><label>Confirm New Password *</label><input type="password" class="hrx-in" id="hrpw-conf" autocomplete="new-password"></div>' +
      '<div class="hrx-msg" id="hrpw-msg"></div>';
    var foot = (forced ? '' : '<button class="hrx-btn ghost" onclick="hrCloseDialog()">Cancel</button>') +
      '<button class="hrx-btn g" id="hrpw-save" onclick="hrPwSave(' + (forced ? 'true' : 'false') + ',\'' + (thenRole || '') + '\')">Change Password</button>';
    var o = dialog('Change Password', body, foot);
    if (forced) {   // block dismissal for the forced flow
      H.pwModalOpen = true;
      o.addEventListener('click', function (e) { e.stopPropagation(); }, true);
      var x = o.querySelector('.hrx-x'); if (x) x.style.display = 'none';
    }
  }
  window.hrPwSave = function (forced, thenRole) {
    var cur = val('hrpw-cur'), nw = val('hrpw-new'), cf = val('hrpw-conf'); var m = el('hrpw-msg');
    var say = function (t) { if (m) { m.className = 'hrx-msg r'; m.textContent = t; } };
    if (!cur || !nw) return say('Enter your current and new password.');
    if (nw.length < 6) return say('New password must be at least 6 characters.');
    if (nw !== cf) return say('New password and confirmation do not match.');
    if (nw === cur) return say('New password must differ from the current one.');
    var btn = el('hrpw-save'); if (btn) btn.disabled = true;
    hrApi('/api/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: nw } })
      .then(function () {
        H.pwModalOpen = false;
        closeDialog();
        if (forced) { routeByRole(thenRole || ls('blm_role')); }
        else { if (m) { m.className = 'hrx-msg g'; m.textContent = '✓ Password changed.'; } alert('Password changed successfully.'); }
      })
      .catch(function (e) { if (btn) btn.disabled = false; say('⚠ ' + e.message); });
  };

  // ════════════════════ ROLE OPTIONS (Users & Access) ════════════════════
  try {
    if (typeof ROLE_OPTIONS !== 'undefined' && Array.isArray(ROLE_OPTIONS)) {
      if (!ROLE_OPTIONS.some(function (r) { return r.v === 'hr'; })) ROLE_OPTIONS.push({ v: 'hr', l: 'HR — Human Resources' });
      if (!ROLE_OPTIONS.some(function (r) { return r.v === 'superadmin'; })) ROLE_OPTIONS.push({ v: 'superadmin', l: 'Super Admin — full access' });
    }
  } catch (e) { /* ROLE_OPTIONS not reachable — usersRoleOptions override below still covers the picker */ }
  // Defensive override so the Users & Access role picker always lists HR + Super Admin.
  var _origRoleOpts = window.usersRoleOptions;
  window.usersRoleOptions = function (sel) {
    try {
      var base = (typeof ROLE_OPTIONS !== 'undefined' && Array.isArray(ROLE_OPTIONS)) ? ROLE_OPTIONS.slice() : [];
      if (!base.length && typeof _origRoleOpts === 'function') return _origRoleOpts(sel);
      var seen = {}, out = '';
      base.forEach(function (r) { if (seen[r.v]) return; seen[r.v] = 1; out += '<option value="' + esc(r.v) + '"' + (sel === r.v ? ' selected' : '') + '>' + esc(r.l) + '</option>'; });
      return out;
    } catch (e) { return typeof _origRoleOpts === 'function' ? _origRoleOpts(sel) : '<option value="' + esc(sel || '') + '">' + esc(sel || '') + '</option>'; }
  };

  // ════════════════════ RBAC ROUTING ════════════════════
  var lateAuthCheckSaved = window.authCheckSaved;

  function addAdminHrNav() {
    if (el('ntab-hr')) return;
    var nav = document.getElementById('nav'); if (!nav) return;
    var b = document.createElement('button');
    b.className = 'ntab'; b.id = 'ntab-hr'; b.textContent = '🧑‍💼 HR';
    b.onclick = function () { window.hrOpen(); };
    nav.appendChild(b);
  }

  function routeByRole(role) {
    if (role === 'hr') { openWorkspace('hr'); return; }
    if (typeof lateAuthCheckSaved === 'function') lateAuthCheckSaved();
    if (role === 'superadmin') addAdminHrNav();
  }
  window.__oabRouteByRole = routeByRole;

  window.authCheckSaved = function () {
    var token = ls('blm_token');
    if (!token) { if (typeof lateAuthCheckSaved === 'function') return lateAuthCheckSaved(); return; }
    if (ls('blm_rep_id')) { if (typeof lateAuthCheckSaved === 'function') return lateAuthCheckSaved(); return; }  // sales rep → late layer
    // authCheckSaved fires several times on boot (cached then cloud-fresh data). Once we've
    // shown the forced-password modal or opened the HR-only workspace, don't disrupt them
    // with a re-fetch/re-render (HR data is independent of the reference's cloud blobs).
    if (H.pwModalOpen) return;
    var ws = el('hr-workspace');
    if (H.mode === 'hr' && ws && ws.style.display === 'block') return;
    // Authoritative check: role + forced-password-change flag from the backend.
    hrApi('/api/auth/me').then(function (me) {
      var role = (me && me.role) || ls('blm_role');
      try { if (me && me.role) localStorage.setItem('blm_role', me.role); } catch (e) {}
      if (me && me.mustChangePassword) { buildShell(); showChangePassword(true, role); return; }
      routeByRole(role);
    }).catch(function () { routeByRole(ls('blm_role')); });
  };
})();
