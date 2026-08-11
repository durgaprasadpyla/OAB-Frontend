/* ===========================================================================
 * OAB integration — LATE layer (runs after the reference app code, at end of body)
 * ---------------------------------------------------------------------------
 * Replaces the reference's client-side auth and blob-based user store with the
 * real Spring backend, WITHOUT altering any screen/markup:
 *   - authLogin / authLogout / authCheckSaved  -> POST /api/auth/login, JWT session
 *   - dashLogin (Dashboard super-admin gate)   -> real superadmin login (elevation)
 *   - material rates                           -> GET/PUT /api/rm-rates
 *   - Users & Access                           -> /api/admin/users (real app_user table)
 *   - fills the 409-recovery reloader map for the transport shim.
 * Reference globals are declared in the shared classic-script scope, so we can
 * read/assign them (AUTH_USERS, currentUser, currentRole, MAT_RATES, dashAuthed)
 * and reassign window.<fn> for the function overrides.
 * =========================================================================== */
(function () {
  'use strict';

  var API_BASE = (window.__OAB_API_BASE__ || '').replace(/\/+$/, '');
  var TOKEN_KEY = 'blm_token';
  var realFetch = window.__oabRealFetch || window.fetch.bind(window);

  function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {} }
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    return realFetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
  }
  window.__oabApi = api;

  // ── 409-recovery reloaders: slot id -> the reference's own loader (re-GET + re-render) ──
  function R(name) { return (typeof window[name] === 'function') ? function () { return window[name](); } : null; }
  var reloaders = window.__oabReloaders || (window.__oabReloaders = {});
  reloaders[1] = R('cloudLoad');
  reloaders[2] = R('cloudLoadJSS');
  reloaders[3] = R('cloudLoadPM');
  reloaders[4] = R('cloudLoadCM');
  reloaders[5] = R('cloudLoadProdStatus');
  reloaders[6] = R('cloudLoadPurch');
  reloaders[7] = R('pmCloudLoad');
  reloaders[8] = R('scrapCloudLoad');
  reloaders[9] = R('fgCloudLoad');
  reloaders[11] = R('capaCloudLoad');
  // slot 12 (sales) re-reads on the next render via salesCloudFetch().

  // ═══════════════════ AUTH — real JWT ═══════════════════
  window.authLogin = function () {
    var uEl = document.getElementById('auth-user');
    var pEl = document.getElementById('auth-pass');
    var mEl = document.getElementById('auth-msg');
    var u = (uEl && uEl.value || '').trim();
    var p = (pEl && pEl.value || '').trim();
    if (mEl) { mEl.style.color = ''; mEl.textContent = ''; }
    if (!u || !p) { if (mEl) mEl.textContent = 'Enter username and password.'; return; }
    if (mEl) mEl.textContent = 'Signing in…';
    // 1) Staff/admin accounts → app_user (JWT).
    realFetch(API_BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) {
          setToken(data.token);
          try { localStorage.setItem('blm_user', data.username); } catch (e) {}
          try { localStorage.setItem('blm_role', data.role); } catch (e) {}
          try { localStorage.removeItem('blm_rep_id'); } catch (e) {}
          location.reload();
          return;
        }
        // 2) Not a staff account → try a Sales Rep (managed in the sales blob, module 12).
        return realFetch(API_BASE + '/api/auth/sales-rep-login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p })
        }).then(function (rres) {
          return rres.json().catch(function () { return {}; }).then(function (rdata) {
            if (rres.ok) {
              setToken(rdata.token);
              try { localStorage.setItem('blm_user', rdata.username); } catch (e) {}
              try { localStorage.setItem('blm_rep_id', rdata.repId); } catch (e) {}
              try { localStorage.removeItem('blm_role'); } catch (e) {}
              location.reload();
              return;
            }
            if (mEl) mEl.textContent = 'Incorrect username or password.';
            if (pEl) pEl.value = '';
          });
        });
      });
    }).catch(function () {
      if (mEl) mEl.textContent = 'Cannot reach the server. Check your connection and try again.';
    });
  };

  window.authLogout = function () {
    clearToken();
    try { localStorage.removeItem('blm_user'); localStorage.removeItem('blm_role'); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    try {
      var url = new URL(location.href);
      url.searchParams.set('_r', String(Date.now()));
      location.replace(url.toString());
    } catch (e) { location.reload(); }
  };

  // Session restore: drive currentRole from the stored session, then delegate to the
  // reference's own role-view switching (which we leave untouched).
  var originalAuthCheckSaved = window.authCheckSaved;
  window.authCheckSaved = function () {
    var token = getToken();
    var user = null, role = null, repId = null;
    try { user = localStorage.getItem('blm_user'); role = localStorage.getItem('blm_role'); repId = localStorage.getItem('blm_rep_id'); } catch (e) {}
    if (!token) {
      if (typeof window.showAuthModal === 'function') window.showAuthModal();
      return;
    }
    if (repId) {   // Sales Rep session → route to the rep portal (uses the sales JWT for module 12).
      try { currentUser = user; } catch (e) {}
      if (typeof window.showRepView === 'function') { window.showRepView(); return; }
      if (typeof originalAuthCheckSaved === 'function') return originalAuthCheckSaved();
      return;
    }
    if (!user || !role) {
      if (typeof window.showAuthModal === 'function') window.showAuthModal();
      return;
    }
    // Seed the reference's user map so its role logic recognises this session.
    try { if (typeof AUTH_USERS === 'object' && AUTH_USERS) AUTH_USERS[user] = { pass: '', role: role }; } catch (e) {}
    try { currentUser = user; } catch (e) {}
    try { currentRole = role; } catch (e) {}
    if (typeof originalAuthCheckSaved === 'function') return originalAuthCheckSaved();
  };

  // ═══════════════════ DASHBOARD super-admin gate — real elevation ═══════════════════
  // Preserve the exact username+password prompt, but validate against the backend and
  // elevate the session to the superadmin JWT so master-data writes (modules 2/3/4,
  // rm-rates, users) are authorised server-side.
  window.dashLogin = function () {
    var uEl = document.getElementById('dash-user');
    var pEl = document.getElementById('dash-pass');
    var mEl = document.getElementById('dash-auth-msg');
    var u = (uEl && uEl.value || '').trim();
    var p = (pEl && pEl.value || '').trim();
    if (mEl) mEl.textContent = '';
    if (!u || !p) { if (mEl) mEl.textContent = 'Enter username and password.'; return; }
    if (mEl) mEl.textContent = 'Verifying…';
    realFetch(API_BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data || data.role !== 'superadmin') {
          if (mEl) mEl.textContent = (res.ok ? 'That account is not a super-admin.' : ((data && data.error) || 'Incorrect credentials.'));
          if (pEl) pEl.value = '';
          return;
        }
        setToken(data.token);                       // elevate the session token to superadmin
        try { dashAuthed = true; } catch (e) {}
        var a = document.getElementById('dash-auth'); if (a) a.style.display = 'none';
        var c = document.getElementById('dash-content'); if (c) c.style.display = 'block';
        if (typeof window.renderDashboard === 'function') window.renderDashboard();
        if (typeof window.loadMaterialRates === 'function') window.loadMaterialRates();
      });
    }).catch(function () {
      if (mEl) mEl.textContent = 'Cannot reach the server. Check your connection and try again.';
    });
  };

  // ═══════════════════ MATERIAL RATES — /api/rm-rates ═══════════════════
  function setRateInputs(r) {
    var b = document.getElementById('mat-bopp');
    var ab = document.getElementById('mat-afbopp');
    var al = document.getElementById('mat-afldpe');
    if (b && r.bopp) b.value = r.bopp;
    if (ab && r.afbopp) ab.value = r.afbopp;
    if (al && r.afldpe) al.value = r.afldpe;
  }
  window.loadMaterialRates = function () {
    if (!getToken()) return;   // not signed in yet — avoid a pre-login 401 during boot
    api('/api/rm-rates').then(function (res) {
      if (!res.ok) return;
      return res.json().then(function (r) {
        r = r || {};
        try { MAT_RATES = { bopp: +r.bopp || 0, afbopp: +r.afbopp || 0, afldpe: +r.afldpe || 0 }; } catch (e) {}
        setRateInputs(r);
      });
    }).catch(function () {});
  };
  // Read the input fields into MAT_RATES (no local persistence — that happens via PUT).
  window.saveMaterialRates = function () {
    try {
      MAT_RATES.bopp = parseFloat((document.getElementById('mat-bopp') || {}).value) || 0;
      MAT_RATES.afbopp = parseFloat((document.getElementById('mat-afbopp') || {}).value) || 0;
      MAT_RATES.afldpe = parseFloat((document.getElementById('mat-afldpe') || {}).value) || 0;
    } catch (e) {}
  };
  window.pushMaterialRates = function () {
    window.saveMaterialRates();
    var status = document.getElementById('mat-push-status');
    var b = MAT_RATES.bopp, ab = MAT_RATES.afbopp, al = MAT_RATES.afldpe;
    if (!b && !ab && !al) { if (status) status.textContent = '⚠ Please enter at least one rate.'; return; }
    if (status) status.textContent = 'Saving…';
    api('/api/rm-rates', { method: 'PUT', body: { bopp: b, afbopp: ab, afldpe: al } }).then(function (res) {
      if (!res.ok) {
        if (status) status.textContent = res.status === 403 ? '⛔ Not allowed (super-admin only).' : '⚠ Save failed (HTTP ' + res.status + ').';
        return;
      }
      var parts = [];
      if (b) parts.push('BOPP: ₹' + b + '/kg');
      if (ab) parts.push('AF BOPP: ₹' + ab + '/kg');
      if (al) parts.push('AF LDPE: ₹' + al + '/kg');
      if (status) { status.textContent = '✓ Saved — ' + parts.join(' · '); setTimeout(function () { if (status) status.textContent = ''; }, 4000); }
      if (typeof window.renderDashboard === 'function') window.renderDashboard();
      try { if (document.getElementById('dash-so') && document.getElementById('dash-so').value && typeof window.renderSOCosting === 'function') window.renderSOCosting(); } catch (e) {}
    }).catch(function () { if (status) status.textContent = '⚠ Cannot reach the server.'; });
  };

  // ═══════════════════ USERS & ACCESS — /api/admin/users (real app_user table) ═══════════════════
  var _apiUsers = [];
  function usersMsgSafe(m, t) { if (typeof window.usersMsg === 'function') window.usersMsg(m, t); }
  function roleOptions(sel) {
    return (typeof window.usersRoleOptions === 'function')
      ? window.usersRoleOptions(sel)
      : '<option value="' + (sel || '') + '">' + (sel || '') + '</option>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  window.renderUsersTable = function () {
    var tb = document.getElementById('users-tbody');
    if (!tb) return;
    tb.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--i3)">Loading…</td></tr>';
    api('/api/admin/users').then(function (res) {
      if (!res.ok) {
        tb.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--r)">' +
          (res.status === 403 ? 'Super-admin access required.' : 'Could not load users (HTTP ' + res.status + ').') + '</td></tr>';
        return;
      }
      return res.json().then(function (list) {
        _apiUsers = Array.isArray(list) ? list : [];
        tb.innerHTML = _apiUsers.map(function (u, i) {
          var dis = !!u.disabled;
          return '<tr' + (dis ? ' style="opacity:.55"' : '') + '>' +
            '<td style="font-weight:600;font-size:12px">' + esc(u.username) + (dis ? ' <span style="font-size:9px;color:var(--r)">(disabled)</span>' : '') + '</td>' +
            '<td><input type="password" id="ue-pass-' + i + '" placeholder="leave blank to keep" style="width:100%" autocomplete="new-password"></td>' +
            '<td><select id="ue-role-' + i + '" style="width:100%">' + roleOptions(u.role) + '</select></td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn-g" style="height:26px;font-size:11px;padding:0 9px" onclick="usersSaveRow(' + i + ')">Save</button> ' +
              '<button class="btn ' + (dis ? 'btn-g' : 'btn-r') + '" style="height:26px;font-size:11px;padding:0 9px" onclick="usersDelete(' + i + ')">' + (dis ? 'Enable' : 'Disable') + '</button>' +
            '</td></tr>';
        }).join('') || '<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--i3)">No users</td></tr>';
      });
    }).catch(function () {
      tb.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--r)">Cannot reach the server.</td></tr>';
    });
  };

  window.usersSaveRow = function (i) {
    var u = _apiUsers[i]; if (!u) return;
    var pEl = document.getElementById('ue-pass-' + i);
    var rEl = document.getElementById('ue-role-' + i);
    var body = {};
    if (rEl && rEl.value) body.role = rEl.value;
    if (pEl && pEl.value) body.newPassword = pEl.value;
    if (body.role === undefined && body.newPassword === undefined) { usersMsgSafe('Nothing to change for ' + esc(u.username) + '.', 'r'); return; }
    api('/api/admin/users/' + u.id, { method: 'PUT', body: body }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) { usersMsgSafe('⚠ ' + ((j && j.detail) || (j && j.error) || ('Save failed (HTTP ' + res.status + ')')), 'r'); return; }
        usersMsgSafe('✅ Saved changes for ' + esc(u.username) + '.', 'g');
        window.renderUsersTable();
      });
    }).catch(function () { usersMsgSafe('⚠ Cannot reach the server.', 'r'); });
  };

  // The real user store never hard-deletes an auth account; "Delete" toggles disabled.
  window.usersDelete = function (i) {
    var u = _apiUsers[i]; if (!u) return;
    var next = !u.disabled;
    if (next && !confirm('Disable user "' + u.username + '"? They will no longer be able to sign in.')) return;
    api('/api/admin/users/' + u.id, { method: 'PUT', body: { disabled: next } }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) { usersMsgSafe('⚠ ' + ((j && j.detail) || (j && j.error) || ('Update failed (HTTP ' + res.status + ')')), 'r'); return; }
        usersMsgSafe((next ? '🚫 Disabled ' : '✅ Enabled ') + esc(u.username) + '.', 'g');
        window.renderUsersTable();
      });
    }).catch(function () { usersMsgSafe('⚠ Cannot reach the server.', 'r'); });
  };

  window.usersAdd = function () {
    var nmEl = document.getElementById('u-new-name');
    var npEl = document.getElementById('u-new-pass');
    var nrEl = document.getElementById('u-new-role');
    var u = (nmEl && nmEl.value || '').trim();
    var p = (npEl && npEl.value || '').trim();
    var role = (nrEl && nrEl.value) || 'plant';
    if (!u) { usersMsgSafe('⚠ Enter a username.', 'r'); return; }
    if (!p) { usersMsgSafe('⚠ Enter a password.', 'r'); return; }
    api('/api/admin/users', { method: 'POST', body: { username: u, password: p, role: role } }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) { usersMsgSafe('⚠ ' + ((j && j.detail) || (j && j.error) || ('Could not add user (HTTP ' + res.status + ')')), 'r'); return; }
        if (nmEl) nmEl.value = ''; if (npEl) npEl.value = '';
        usersMsgSafe('✅ Added user ' + esc(u) + '.', 'g');
        window.renderUsersTable();
      });
    }).catch(function () { usersMsgSafe('⚠ Cannot reach the server.', 'r'); });
  };

  // Slot 10 (blob users) is retired — never write it (would 403). No-op any stray sync call.
  window.usersCloudSave = function () { return Promise.resolve(); };
  window.usersCloudLoad = function () { return Promise.resolve(false); };

  // ═══════════════════ Invoice PDF — sharper + proper margins ═══════════════════
  // The reference captured the invoice at html2canvas scale:2 (~192 dpi → blurry) and
  // placed the image edge-to-edge at (0,0) full page width (no margins → content clipped
  // at the page edges). Re-capture at higher resolution and inset it with page margins;
  // multi-page slicing respects the margins so nothing is cut.
  window.saveInvoicePDF = async function () {
    var btn = document.getElementById('pdf-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating PDF…'; }
    try {
      var el = document.getElementById('inv-doc');
      if (!el || !el.innerHTML.trim()) { alert('Generate the invoice first.'); if (btn) { btn.disabled = false; btn.textContent = '⬇ Download Invoice PDF'; } return; }
      var prevDisplay = el.style.display;
      el.style.display = 'block';
      var canvas = await html2canvas(el, {
        scale: 3,                       // ~300+ dpi (was 2 → blurry)
        useCORS: true,
        backgroundColor: '#ffffff',
        width: el.scrollWidth,
        height: el.scrollHeight,
        windowWidth: 794,
        onclone: function (doc) {       // render the invoice in its pristine print layout
          var ov = doc.getElementById('oab-overrides'); if (ov) ov.remove();
        }
      });
      var jsPDF = window.jspdf.jsPDF;
      var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      var pageW = pdf.internal.pageSize.getWidth();   // 210
      var pageH = pdf.internal.pageSize.getHeight();  // 297
      var margin = 8;                                 // mm on every side
      var imgW = pageW - 2 * margin;
      var imgH = (canvas.height * imgW) / canvas.width;
      var contentH = pageH - 2 * margin;
      if (imgH <= contentH + 0.5) {
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, imgW, imgH);
      } else {
        var pxPerPage = Math.floor((contentH / imgH) * canvas.height);
        var srcY = 0, page = 0;
        while (srcY < canvas.height - 1) {
          var srcH = Math.min(pxPerPage, canvas.height - srcY);
          var pc = document.createElement('canvas');
          pc.width = canvas.width; pc.height = srcH;
          var ctx = pc.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pc.width, pc.height);
          ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
          var drawH = (srcH / canvas.height) * imgH;
          if (page > 0) pdf.addPage();
          pdf.addImage(pc.toDataURL('image/png'), 'PNG', margin, margin, imgW, drawH);
          srcY += srcH; page++;
        }
      }
      var rawIvNo = (document.getElementById('iv-no').value || '').trim();
      var custName = (document.getElementById('iv-cu').value || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      var ivNo = (rawIvNo.replace(/\//g, '-').replace(/[^a-zA-Z0-9-_]/g, '') || 'invoice') + '_' + custName;
      pdf.save('Bloomflex_' + ivNo + '.pdf');
      el.style.display = prevDisplay;
    } catch (err) {
      alert('PDF error: ' + err.message); console.error(err);
    }
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Download Invoice PDF'; }
  };

  // ═══════════════════ OAB board PDF — real vector table (not a screenshot) ═══════════════════
  // The reference downloadOABCurrentPDF() html2canvas-screenshots the tab into a PDF image →
  // blurry + columns clipped. Regenerate it as a proper text table drawn with jsPDF (crisp,
  // selectable, auto-paginated, nothing cut). It reuses the EXACT same filtered data + columns
  // as the Excel export so the PDF matches the on-screen board.
  window.downloadOABCurrentPDF = function () {
    try {
      var $ = function (id) { return document.getElementById(id); };
      var key = ($('oab-sh') || {}).value || 'SF';
      var fileLabel = key === 'SF' ? 'StayFresh_OAB' : 'Others_OAB';
      var title = key === 'SF' ? 'Stay Fresh OAB' : 'Others OAB';
      var rows = (typeof OAB !== 'undefined' && OAB[key]) ? OAB[key] : [];
      var q = (($('oab-q') || {}).value || '').toLowerCase();
      var cf = ($('oab-cf') || {}).value || '', sf = ($('oab-stf') || {}).value || '', spf = ($('oab-spf') || {}).value || '';
      var custByLoc = (typeof getCustByLoc === 'function') ? getCustByLoc : function () { return {}; };
      var fil = rows.filter(function (r) {
        if (r.closed) return false;
        if (cf && r.customer !== cf) return false;
        if (sf && r.stage !== sf) return false;
        if (spf && r.spec !== spf) return false;
        if (q && ![r.so, r.customer, r.jobName, r.spec, r.poNum, r.dispLoc, r.warehouseName, (custByLoc(r.customer, r.dispLoc) || {}).warehouseName]
          .some(function (v) { return String(v || '').toLowerCase().indexOf(q) > -1; })) return false;
        return true;
      });
      var ordered = (typeof soOrder === 'function') ? soOrder(fil) : fil;
      var cols = ['S.No', 'SO#', 'Spec', 'Disp', 'Customer', 'Job Name', 'Sub Brand', 'Location', 'PO#', 'PO Date', 'Age', 'PO Qty', 'Inv', 'Man', 'FG', 'Balance', 'Mtrs*', 'Prod', 'Stage'];
      var weights = [0.8, 1.5, 1.3, 1.3, 3.2, 5.0, 2.4, 2.8, 2.4, 1.7, 0.9, 1.6, 1.4, 1.4, 1.0, 1.6, 1.5, 1.7, 1.7];
      var rightCols = { 0: 1, 10: 1, 11: 1, 12: 1, 13: 1, 14: 1, 15: 1, 16: 1 };
      var tPoQty = 0, tInv = 0, tMan = 0, tFg = 0, tBal = 0;
      var body = ordered.map(function (r, i) {
        var b = Math.max(0, (r.poQty || 0) - (r.invDisp || 0) - (r.manDisp || 0) - (r.fg || 0));
        var jssRow = (typeof JSS !== 'undefined' && JSS.find) ? JSS.find(function (j) { return j.spec === r.spec; }) : null;
        var sb = r.subBrand || (jssRow ? jssRow.subBrand : '') || '';
        var df = r.dispatchForm || (jssRow ? jssRow.dispatchForm : '') || '';
        var mW = (typeof calcMetres === 'function') ? calcMetres(r, b).withWastage : '';
        var ps = (typeof getProdStatus === 'function') ? getProdStatus(r.so) : '';
        var age = (typeof soAgeDays === 'function') ? soAgeDays(r) : null;
        tPoQty += (r.poQty || 0); tInv += (r.invDisp || 0); tMan += (r.manDisp || 0); tFg += (r.fg || 0); tBal += b;
        return [i + 1, r.so || '', r.spec || '', df, r.customer || '', r.jobName || '', sb, r.dispLoc || '', r.poNum || '',
          r.poDate || '', age === null ? '' : age, r.poQty || 0, r.invDisp || 0, r.manDisp || 0, r.fg || 0, b, mW > 0 ? mW : '', ps || '', r.stage || ''];
      });

      var jsPDF = window.jspdf.jsPDF;
      var pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
      var PW = pdf.internal.pageSize.getWidth(), PH = pdf.internal.pageSize.getHeight(), M = 8;
      var usable = PW - 2 * M, x0 = M;
      var wtot = weights.reduce(function (a, b2) { return a + b2; }, 0);
      var widths = weights.map(function (w) { return w / wtot * usable; });
      var colX = []; (function () { var cx = x0; for (var i = 0; i < widths.length; i++) { colX.push(cx); cx += widths[i]; } })();
      var nf = function (v) { return (v === '' || v == null) ? '' : Number(v).toLocaleString('en-IN'); };
      var now = new Date();

      var y = M;
      pdf.setTextColor(16, 29, 49); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14);
      pdf.text('Bloomflex  —  ' + title, x0, y + 4.5);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(90, 100, 120);
      pdf.text('Order & Production Balance  ·  ' + ordered.length + ' open orders  ·  Generated '
        + now.toLocaleString('en-IN') + '  ·  Metres include 5% wastage', x0, y + 9.5);
      pdf.setFontSize(8.5); pdf.setTextColor(16, 29, 49);
      pdf.text('PO Qty: ' + nf(tPoQty) + '     Dispatched: ' + nf(tInv + tMan) + '     FG: ' + nf(tFg)
        + '     Balance to produce: ' + nf(tBal), x0, y + 14.5);
      y += 19;

      var headH = 7, lineH = 3.05;
      function header() {
        pdf.setFillColor(14, 111, 184); pdf.rect(x0, y, usable, headH, 'F');
        pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7);
        for (var c = 0; c < cols.length; c++) {
          if (rightCols[c]) pdf.text(String(cols[c]), colX[c] + widths[c] - 1.4, y + 4.6, { align: 'right' });
          else pdf.text(String(cols[c]), colX[c] + 1.4, y + 4.6);
        }
        pdf.setTextColor(20, 20, 20); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7);
        y += headH;
      }
      header();

      for (var ri = 0; ri < body.length; ri++) {
        var row = body[ri], cellLines = [], maxLines = 1;
        for (var c = 0; c < row.length; c++) {
          var txt = rightCols[c] ? nf(row[c]) : String(row[c] == null ? '' : row[c]);
          var lines = pdf.splitTextToSize(txt, widths[c] - 2.6);
          cellLines.push(lines); if (lines.length > maxLines) maxLines = lines.length;
        }
        var rowH = Math.max(4.8, maxLines * lineH + 1.7);
        if (y + rowH > PH - M) { pdf.addPage(); y = M; header(); }
        if (ri % 2 === 1) { pdf.setFillColor(240, 244, 250); pdf.rect(x0, y, usable, rowH, 'F'); }
        pdf.setTextColor(20, 20, 20);
        for (var c2 = 0; c2 < row.length; c2++) {
          if (rightCols[c2]) pdf.text(cellLines[c2], colX[c2] + widths[c2] - 1.4, y + 3.5, { align: 'right' });
          else pdf.text(cellLines[c2], colX[c2] + 1.4, y + 3.5);
        }
        pdf.setDrawColor(224, 230, 240); pdf.setLineWidth(0.1); pdf.line(x0, y + rowH, x0 + usable, y + rowH);
        y += rowH;
      }
      var ds = now.toLocaleDateString('en-IN').replace(/\//g, '-');
      pdf.save('Bloomflex_' + fileLabel + '_' + ds + '.pdf');
    } catch (e) {
      alert('PDF error: ' + (e && e.message ? e.message : e)); console.error(e);
    }
  };
})();
