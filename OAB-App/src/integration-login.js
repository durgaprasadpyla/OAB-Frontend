/* ===========================================================================
 * OAB integration — LOGIN layer (runs after late+hr, at end of body)
 * ---------------------------------------------------------------------------
 * Upgrades the reference's plain login modal into a premium, enterprise
 * two-column sign-in — WITHOUT changing any auth logic. It *reparents* the
 * existing functional elements (#auth-user, #auth-pass, #auth-msg and the
 * Sign In button that calls authLogin()) into a new styled layout, so the
 * exact same API call / token handling / redirect runs unchanged. It only adds
 * presentation + UX: company logo, show/hide password, remember-me (username
 * only), a proper loading state, and accessibility.
 * =========================================================================== */
(function () {
  'use strict';

  var LOGO = window.__OAB_LOGIN_LOGO__ || window.__OAB_LOGO__ || '';

  // ── inline icons (no external deps; inherit currentColor) ──
  var IC = {
    user: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    alert: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
  };

  function el(id) { return document.getElementById(id); }

  // ── Loading state on the Sign In button (prevents double-submit) ──
  function setLoading(btn, on) {
    if (!btn) return;
    var label = btn.querySelector('.blm-cta-label');
    if (on) {
      if (btn.getAttribute('data-loading') === '1') return;
      btn.setAttribute('data-loading', '1');
      btn.disabled = true; btn.classList.add('blm-loading');
      if (label) label.textContent = 'Signing in…';
    } else {
      btn.removeAttribute('data-loading');
      btn.disabled = false; btn.classList.remove('blm-loading');
      if (label) label.textContent = 'Sign In';
    }
  }
  // Re-enable the button when authLogin reports a terminal message (error/validation).
  // On success the reference reloads the page, so no re-enable is needed there.
  function watchCompletion(btn, msg) {
    if (!msg || typeof MutationObserver === 'undefined') return;
    var done = false;
    var mo = new MutationObserver(function () {
      var t = (msg.textContent || '').trim();
      if (!t || /signing/i.test(t)) return;   // empty or "Signing in…" → still in progress
      if (done) return; done = true;
      setLoading(btn, false); mo.disconnect(); clearTimeout(to);
    });
    mo.observe(msg, { childList: true, characterData: true, subtree: true });
    var to = setTimeout(function () { if (!done) { setLoading(btn, false); mo.disconnect(); } }, 20000);
  }

  // ── Wrap authLogin: add loading + remember-me, then run the REAL auth flow ──
  function wrapAuthLogin() {
    if (window.__blmAuthWrapped) return;
    var real = window.authLogin;
    if (typeof real !== 'function') return;
    window.__blmAuthWrapped = true;
    window.authLogin = function () {
      var btn = document.querySelector('#auth-modal .blm-cta');
      if (btn && btn.getAttribute('data-loading') === '1') return;   // already submitting
      var u = (el('auth-user') || {}).value || '';
      var p = (el('auth-pass') || {}).value || '';
      // Remember-me stores the USERNAME only (never the password).
      try {
        var rm = el('blm-remember');
        if (rm) { if (rm.checked) localStorage.setItem('blm_remember_user', u.trim()); else localStorage.removeItem('blm_remember_user'); }
      } catch (e) {}
      if (btn && u.trim() && p.trim()) { setLoading(btn, true); watchCompletion(btn, el('auth-msg')); }
      return real.apply(this, arguments);
    };
  }

  // ── Build the premium layout by reparenting the existing functional nodes ──
  function enhance() {
    var modal = el('auth-modal');
    if (!modal || modal.getAttribute('data-blm') === '1') return;
    var card = modal.querySelector(':scope > div');
    var user = el('auth-user'), pass = el('auth-pass'), msg = el('auth-msg');
    var signBtn = card ? card.querySelector('button') : null;
    if (!card || !user || !pass || !signBtn) return;   // markup not as expected → leave original intact
    modal.setAttribute('data-blm', '1');

    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Sign in to Bloomflex');

    // Prepare the reparented controls (drop inline styles; our CSS classes take over).
    user.removeAttribute('style'); user.className = 'blm-in';
    user.setAttribute('autocomplete', 'username'); user.setAttribute('aria-label', 'Username'); user.id = 'auth-user';
    pass.removeAttribute('style'); pass.className = 'blm-in';
    pass.setAttribute('autocomplete', 'current-password'); pass.setAttribute('aria-label', 'Password');
    msg.removeAttribute('style'); msg.className = 'blm-msg'; msg.setAttribute('role', 'alert'); msg.setAttribute('aria-live', 'polite');
    signBtn.removeAttribute('style'); signBtn.className = 'blm-cta';
    signBtn.setAttribute('aria-label', 'Sign in'); signBtn.innerHTML = '<span class="blm-spin" aria-hidden="true"></span><span class="blm-cta-label">Sign In</span>';

    // LEFT brand panel
    var brand = document.createElement('div');
    brand.className = 'blm-brand';
    brand.innerHTML =
      '<div class="blm-brand-top">' +
        (LOGO ? '<img class="blm-brand-logo" src="' + LOGO + '" alt="Bloomflex Private Limited">'
              : '<div class="blm-wordmark">BLOOMFLEX</div>') +
      '</div>' +
      '<div class="blm-brand-mid">' +
        '<h2>Order &amp; Production Management</h2>' +
        '<p>Sales, production, invoicing, purchase, QC and HR — one secure enterprise workspace.</p>' +
        '<ul class="blm-brand-list">' +
          '<li>' + IC.check + '<span>Real-time order &amp; production tracking</span></li>' +
          '<li>' + IC.check + '<span>GST invoicing &amp; packing lists</span></li>' +
          '<li>' + IC.check + '<span>Role-based access &amp; full audit trail</span></li>' +
        '</ul>' +
      '</div>' +
      '<div class="blm-brand-foot">' + IC.shield + '<span>Secure enterprise sign-in</span></div>';

    // RIGHT form panel
    var form = document.createElement('div');
    form.className = 'blm-form';

    var mlogo = document.createElement('div');
    mlogo.className = 'blm-form-logo';
    mlogo.innerHTML = LOGO ? '<img src="' + LOGO + '" alt="Bloomflex Private Limited">' : '<div class="blm-wordmark blm-dark">BLOOMFLEX</div>';

    var head = document.createElement('div');
    head.className = 'blm-form-head';
    head.innerHTML = '<h1>Welcome back</h1><p>Sign in to your account to continue</p>';

    // Username field
    var gu = document.createElement('div'); gu.className = 'blm-fg';
    var lu = document.createElement('label'); lu.setAttribute('for', 'auth-user'); lu.textContent = 'Username';
    var wu = document.createElement('div'); wu.className = 'blm-inwrap';
    wu.innerHTML = '<span class="blm-inicon" aria-hidden="true">' + IC.user + '</span>';
    wu.appendChild(user);
    gu.appendChild(lu); gu.appendChild(wu);

    // Password field + show/hide
    var gp = document.createElement('div'); gp.className = 'blm-fg';
    var lp = document.createElement('label'); lp.setAttribute('for', 'auth-pass'); lp.textContent = 'Password';
    if (!pass.id) pass.id = 'auth-pass';
    var wp = document.createElement('div'); wp.className = 'blm-inwrap';
    wp.innerHTML = '<span class="blm-inicon" aria-hidden="true">' + IC.lock + '</span>';
    wp.appendChild(pass);
    var toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'blm-toggle';
    toggle.setAttribute('aria-label', 'Show password'); toggle.setAttribute('tabindex', '0');
    toggle.innerHTML = IC.eye;
    toggle.addEventListener('click', function () {
      var show = pass.type === 'password';
      pass.type = show ? 'text' : 'password';
      toggle.innerHTML = show ? IC.eyeOff : IC.eye;
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      try { pass.focus(); } catch (e) {}
    });
    wp.appendChild(toggle);
    gp.appendChild(lp); gp.appendChild(wp);

    // Options row: remember-me + forgot
    var opt = document.createElement('div'); opt.className = 'blm-opt';
    opt.innerHTML =
      '<label class="blm-remember"><input type="checkbox" id="blm-remember"><span class="blm-check" aria-hidden="true">' + IC.check + '</span><span>Remember me</span></label>' +
      '<button type="button" class="blm-forgot" id="blm-forgot">Forgot password?</button>';

    var foot = document.createElement('div'); foot.className = 'blm-form-foot';
    foot.textContent = 'Access is role-based · Contact your Super Admin for an account.';

    form.appendChild(mlogo);
    form.appendChild(head);
    form.appendChild(msg);
    form.appendChild(gu);
    form.appendChild(gp);
    form.appendChild(opt);
    form.appendChild(signBtn);
    form.appendChild(foot);

    // Assemble card
    card.className = 'blm-login-card';
    card.removeAttribute('style');
    card.innerHTML = '';
    card.appendChild(brand);
    card.appendChild(form);

    // Restore remembered username
    try {
      var saved = localStorage.getItem('blm_remember_user');
      if (saved) { user.value = saved; var rc = el('blm-remember'); if (rc) rc.checked = true; }
    } catch (e) {}

    // Forgot-password: this app has no self-service reset (passwords are reset by a
    // Super Admin in Users & Access), so surface that truthfully instead of a dead link.
    var fp = el('blm-forgot');
    if (fp) fp.addEventListener('click', function () {
      if (msg) { msg.className = 'blm-msg blm-msg-info'; msg.textContent = 'Please contact your Super Admin to reset your password.'; }
    });

    // Keep the reference's Enter-key behaviour intact (user → focus password; the
    // password field's inline onkeydown already calls authLogin). Just make sure the
    // username field advances to password on Enter even after reparenting.
    user.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); pass.focus(); } });

    wrapAuthLogin();
  }

  // The modal markup is static (parsed before this end-of-body script), so enhance now.
  // Guard with a couple of retries in case another late script re-touches the node.
  function boot() { try { wrapAuthLogin(); enhance(); } catch (e) { /* never block login */ } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  // Belt-and-suspenders: if something shows the modal before enhancement, enhance on show.
  var _origShow = window.showAuthModal;
  if (typeof _origShow === 'function') {
    window.showAuthModal = function () { try { enhance(); } catch (e) {} return _origShow.apply(this, arguments); };
  }
})();
