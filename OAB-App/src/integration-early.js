/* ===========================================================================
 * OAB integration — EARLY layer (runs in <head>, before the reference app code)
 * ---------------------------------------------------------------------------
 * Turns the reference monolith into a production, API-driven app WITHOUT touching
 * its UI logic:
 *   1) localStorage compliance — business-data blobs are never the source of truth.
 *   2) Boot test-data purges are disabled (they would clear POs / zero FG).
 *   3) Transport shim — the reference's single data endpoint (/rest/v1/oab_data)
 *      is redirected to the Spring backend, authenticated with the real JWT, and
 *      given per-slot optimistic-lock version tracking. All 26 call sites in the
 *      reference stay byte-identical; only the transport underneath changes.
 * =========================================================================== */
(function () {
  'use strict';

  // Backend API base (the Spring backend origin). Injected via window.__OAB_API_BASE__.
  // '' = same-origin (use when the CDN proxies /api and /rest to the backend).
  var API_BASE = (window.__OAB_API_BASE__ || '').replace(/\/+$/, '');
  var OAB_PATH = '/rest/v1/oab_data';
  var TOKEN_KEY = 'blm_token';

  // ── Invoice-logo de-duplication (module 1 only) ──
  // Every invoice's stored HTML embeds the same ~75 KB base64 company logo. Persisting
  // 60+ identical copies pushes the module-1 blob toward the API-Gateway/Lambda 6 MB cap.
  // We store a short token in its place and re-inflate on load — the app always sees the
  // full logo (behaviour identical), the DB carries one small token instead of dozens of
  // copies. Lossless round-trip; a no-op if the constant is absent or doesn't match.
  var LOGO = window.__OAB_LOGO__ || '';
  var LOGO_TOKEN = '@@OAB_LOGO@@';
  function deflateLogo(s) { return (LOGO && s && s.indexOf(LOGO) !== -1) ? s.split(LOGO).join(LOGO_TOKEN) : s; }
  function inflateLogo(s) { return (LOGO && s && s.indexOf(LOGO_TOKEN) !== -1) ? s.split(LOGO_TOKEN).join(LOGO) : s; }

  // ── JWT accessor (session credential, not business data — allowed in storage) ──
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  window.__oabGetToken = getToken;

  // ── Client-side mirror of the backend per-module READ authorization ──
  // (AuthzService.MODULE_READ_ROLES, commit 2d6c096). The reference app loads EVERY module
  // blob on boot regardless of role; for a module a role may not read, the backend returns
  // 403. We skip that request entirely (returning an empty module) so a QC/Plant/PM/etc.
  // session doesn't fire a wall of guaranteed 403s (no console noise, no error banner). The
  // backend remains the sole enforcer — this is only a UI optimization. Keep in sync with it.
  var MODULE_READ_ROLES = {
    1: ['user', 'padmin', 'superadmin', 'plant', 'pm'],   // OAB board / orders
    2: ['user', 'padmin', 'superadmin', 'qc', 'pm'],      // JSS specs
    3: ['user', 'padmin', 'superadmin'],                  // prices/costs
    4: ['user', 'padmin', 'superadmin'],                  // customers
    5: ['user', 'padmin', 'superadmin', 'plant'],         // production status
    6: ['purchase', 'padmin', 'superadmin'],              // purchase
    7: ['pm', 'superadmin'],                              // pm print data
    8: ['scrap', 'padmin', 'superadmin'],                 // scrap
    9: ['user', 'padmin', 'superadmin'],                  // FG ledger
    11: ['qc', 'superadmin'],                             // QC CAPA
    12: ['sadmin', 'quote', 'sales', 'superadmin']        // sales system
  };
  function canReadModule(slot) {
    var allowed = MODULE_READ_ROLES[slot];
    if (!allowed) return true;                            // unknown slot → let the request through
    var role = '';
    try { role = (localStorage.getItem('blm_role') || '').toLowerCase(); } catch (e) {}
    if (!role) return true;                               // role unknown (e.g. sales-rep) → let backend decide
    return allowed.indexOf(role) !== -1;
  }

  // ── 1) localStorage compliance ────────────────────────────────────────────
  // Block reads AND writes of the reference's business-data keys, so every byte of
  // business data comes from (and returns to) the backend. UI/session keys
  // (blm_*, *_tab) and the reset-guard flags below still work normally.
  var BUSINESS_KEYS = /^bloomflex_(oab_v1|jss_v1|pm|pm_v1|cm|purch_v1|prod_status|scrap_v1|fg_v1|capa_v1|users_v1|mat)$/;
  var realGet = Storage.prototype.getItem;
  var realSet = Storage.prototype.setItem;
  Storage.prototype.getItem = function (k) {
    if (BUSINESS_KEYS.test(k)) return null;   // never hydrate business data from a local cache
    return realGet.call(this, k);
  };
  Storage.prototype.setItem = function (k, v) {
    if (BUSINESS_KEYS.test(k)) return;        // never persist business data locally
    return realSet.call(this, k, v);
  };

  // ── 2) Disable the reference's one-time boot test-data purges ───────────────
  // They are guarded by these flags; pre-set them to their "already done" values so
  // the destructive purge blocks (clear POs / price history / payments, zero FG) can
  // never run against real production data.
  try { realSet.call(localStorage, 'bloomflex_fg_reset', '2026-08-03'); } catch (e) {}
  try { realSet.call(localStorage, 'bloomflex_purch_reset', '2026-07-28'); } catch (e) {}

  // ── 3) Transport shim ──────────────────────────────────────────────────────
  var versions = Object.create(null);           // slot id -> last known optimistic-lock version
  window.__oabVersions = versions;
  window.__oabReloaders = Object.create(null);  // slot id -> reference loader fn (filled by late layer)

  var realFetch = window.fetch.bind(window);
  window.__oabRealFetch = realFetch;

  // ── Boot-write guard ──
  // The reference performs several automatic writes during boot (OAB normalization,
  // aslEnsureCodes, etc.). With RDS as the source of truth we must NEVER let boot auto-
  // write. Module writes stay disarmed until the first genuine user interaction; boot
  // saves are then no-op'd (synthetic success) so nothing hits the DB unbidden. Capture
  // phase so a click that itself triggers a save arms writes before the save fires.
  var writesArmed = false;
  function armWrites() { writesArmed = true; }
  try {
    document.addEventListener('pointerdown', armWrites, true);
    document.addEventListener('keydown', armWrites, true);
  } catch (e) {}
  window.__oabArmWrites = armWrites;

  function isOab(url) { return typeof url === 'string' && url.indexOf(OAB_PATH) !== -1; }
  function toBackend(url) {
    var i = url.indexOf(OAB_PATH);
    return API_BASE + (i >= 0 ? url.slice(i) : url);  // strip any leftover host, prefix backend base
  }
  function slotFromGet(url) { var m = /[?&]id=eq\.(\d+)/.exec(url); return m ? Number(m[1]) : null; }

  var _lastConflict = 0;
  function notifyConflict() {
    var now = Date.now();
    if (now - _lastConflict < 4000) return;
    _lastConflict = now;
    try {
      var b = document.getElementById('conn-banner');
      var t = document.getElementById('conn-banner-text');
      if (t) t.textContent = '⚠ Another user updated this data — it has been reloaded. Please review and re-apply your change.';
      if (b) { b.style.display = 'block'; setTimeout(function () { if (b) b.style.display = 'none'; }, 7000); }
    } catch (e) {}
  }

  var _authExpiredFired = false;
  function handleAuthExpired() {
    if (_authExpiredFired) return;
    _authExpiredFired = true;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    try { if (typeof window.showAuthModal === 'function') window.showAuthModal(); } catch (e) {}
  }
  window.__oabAuthExpired = handleAuthExpired;

  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }

  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    if (!isOab(url)) return realFetch(input, init);

    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var token = getToken();

    // ---- GET: load a slot ----
    if (method === 'GET') {
      if (!token) {
        // Not signed in yet — return an empty PostgREST result so the app renders a clean
        // empty state behind the login modal instead of firing 401s during boot.
        return Promise.resolve(jsonResponse([], 200));
      }
      var slot = slotFromGet(url);
      // Skip the network call for a module this role may not read (see canReadModule):
      // returns an empty module instead of firing a guaranteed-403 request.
      if (slot != null && !canReadModule(slot)) return Promise.resolve(jsonResponse([], 200));
      return realFetch(toBackend(url), { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function (res) {
          if (res.status === 401) { handleAuthExpired(); return res; }
          // Per-module READ authorization (backend, commit 2d6c096) returns 403 for a module
          // this role may not read. The reference app loads ALL modules on boot regardless of
          // role, so a 403 must be treated as an empty module (renders empty, no scary error
          // banner) — this is exactly the backend's documented "module stays empty" intent.
          if (res.status === 403) return jsonResponse([], 200);
          if (!res.ok || slot == null) return res;
          // Module 1 carries the invoice HTML: re-inflate the logo token before the app
          // parses it, and hand back a fresh response with the inflated body.
          if (slot === 1 && LOGO) {
            return res.clone().json().then(function (rows) {
              if (Array.isArray(rows) && rows.length && rows[0]) {
                if (rows[0].version != null) versions[1] = Number(rows[0].version);
                if (rows[0].data) rows[0].data = inflateLogo(rows[0].data);
              }
              return jsonResponse(rows, 200);
            }).catch(function () { return res; });
          }
          res.clone().json().then(function (rows) {
            if (Array.isArray(rows) && rows.length && rows[0] && rows[0].version != null) {
              versions[slot] = Number(rows[0].version);
            }
          }).catch(function () {});
          return res;
        });
    }

    // ---- POST: save a slot ----
    if (method === 'POST') {
      var raw = (init && init.body) || '{}';
      var body; try { body = JSON.parse(raw); } catch (e) { body = {}; }
      var id = Number(body.id);
      if (!token) return Promise.resolve(jsonResponse({ error: 'not authenticated' }, 401));
      if (!writesArmed) {
        // Pre-interaction (boot) write — do NOT touch the DB. Report a synthetic success at
        // the current known version so the app proceeds without altering RDS.
        return Promise.resolve(jsonResponse({ id: id, version: (versions[id] != null ? versions[id] : 1) }, 200));
      }
      if (id === 1 && LOGO && body.data) body.data = deflateLogo(body.data);   // shrink invoice logos to a token
      if (versions[id] != null) body.version = versions[id];   // optimistic lock (omitted => first insert)
      return realFetch(API_BASE + OAB_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      }).then(function (res) {
        if (res.status === 401) { handleAuthExpired(); return res; }
        if (res.ok) {
          res.clone().json().then(function (j) {
            if (j && j.version != null) versions[id] = Number(j.version);
          }).catch(function () {});
          return res;
        }
        if (res.status === 409) {
          // Concurrent write — reload the fresh slot (updates version + re-renders) and notify.
          // Never silently overwrite: that is exactly what optimistic locking prevents.
          var reload = window.__oabReloaders[id];
          if (typeof reload === 'function') { try { reload(); } catch (e) {} }
          notifyConflict();
        }
        return res;
      });
    }

    // Any other method on this endpoint (unused by the reference) — pass through with auth.
    var h = Object.assign({}, (init && init.headers) || {});
    if (token) h['Authorization'] = 'Bearer ' + token;
    delete h['apikey']; delete h['Prefer'];
    return realFetch(toBackend(url), Object.assign({}, init, { headers: h }));
  };
})();
