// Minimal API client. Paths are prefixed with API_BASE (empty = same-origin in the
// bundled build; set VITE_API_BASE to run the frontend on its own origin). Vite also
// proxies /api and /rest to the backend in dev. Attaches the JWT and signals a global
// 'auth:expired' event on 401 so the app can bounce to login.
//
// Error taxonomy (so screens react correctly, per the stabilization work order):
//   401 -> session expired: clear token, fire 'auth:expired' (logout). ONLY 401 does this.
//   409 -> optimistic-lock conflict: err.code='conflict' (recoverable — reload & retry).
//   403 -> not allowed for this role: err.code='forbidden' (NOT a session error).
// The thrown Error carries `.status` (HTTP code) and, for the two above, `.code`.
import { API_BASE } from './config.js';

export function getToken() {
  try { return localStorage.getItem('blm_token') || ''; } catch { return ''; }
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(API_BASE + path, opts);
  if (res.status === 401) {
    try { localStorage.removeItem('blm_token'); } catch {}
    window.dispatchEvent(new CustomEvent('auth:expired'));
    const err = new Error('Session expired — please sign in again.');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error('HTTP ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
    err.status = res.status;
    if (res.status === 409) err.code = 'conflict';       // stale save — recoverable
    else if (res.status === 403) err.code = 'forbidden'; // wrong role — not a logout
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

/**
 * Reserve the next server-authoritative document number (type ∈ 'SO'|'INV'|'PO').
 * The server increments an atomic counter so concurrent creators never collide.
 * Returns the formatted number string, e.g. "BL/26-27/329".
 */
export async function allocateNumber(type) {
  const r = await api('/api/seq/' + encodeURIComponent(type), { method: 'POST' });
  return r && r.number;
}

// ── Granular module-1 endpoints (Phase 1) ──────────────────────────────────
// These replace whole-blob saves for orders/invoices: the server assigns numbers,
// recomputes money, and touches only the affected rows. Callers reload module 'oab'
// afterwards (the server-updated blob is the read model). Errors surface via api()
// (403 wrong role, 400 validation, 409 conflict) — callers show err.message.
export const ordersApi = {
  createSalesOrders: (body) => api('/api/sales-orders', { method: 'POST', body }),
  createInvoice: (body) => api('/api/invoices', { method: 'POST', body }),
  dispatch: (body) => api('/api/oab-rows/dispatch', { method: 'POST', body }),
  close: (so) => api('/api/oab-rows/close', { method: 'POST', body: { so } }),
  reopen: (so) => api('/api/oab-rows/reopen', { method: 'POST', body: { so } }),
  setStage: (so, stage) => api('/api/oab-rows/stage', { method: 'POST', body: { so, stage } }),
};

// Granular purchase (module 6) endpoints — server assigns PO numbers, atomic GRN.
export const purchaseApi = {
  createPO: (body) => api('/api/purchase-orders', { method: 'POST', body }),
  receiveGRN: (body) => api('/api/purchase-orders/grn', { method: 'POST', body }),
  close: (poNum) => api('/api/purchase-orders/close', { method: 'POST', body: { poNum } }),
  reopen: (poNum) => api('/api/purchase-orders/reopen', { method: 'POST', body: { poNum } }),
  pay: (poNum) => api('/api/purchase-orders/pay', { method: 'POST', body: { poNum } }),
  unpay: (poNum) => api('/api/purchase-orders/unpay', { method: 'POST', body: { poNum } }),
};

// Raw-material ₹/kg rates (server-side; was per-device localStorage).
export const rmRatesApi = {
  get: () => api('/api/rm-rates'),
  put: (rates) => api('/api/rm-rates', { method: 'PUT', body: rates }),
};

// User administration (superadmin only). Backed by the app_user table + bcrypt;
// passwords are write-only (create / reset) and never returned.
export const usersApi = {
  list: () => api('/api/admin/users'),
  create: (body) => api('/api/admin/users', { method: 'POST', body }),
  update: (id, body) => api('/api/admin/users/' + encodeURIComponent(id), { method: 'PUT', body }),
};

// Superadmin observability & maintenance: server-computed rollups (/api/summary),
// the append-only audit trail (/api/audit), and a read-model rebuild (/api/admin/resync).
export const adminApi = {
  summary: () => api('/api/summary'),
  audit: (query = '') => api('/api/audit' + query),
  resync: () => api('/api/admin/resync', { method: 'POST' }),
};

// Column values come back lowercase from MySQL and uppercase from H2 — read either.
export function field(row, key) {
  if (row == null) return '';
  const v = row[key] ?? row[key.toUpperCase()];
  return v == null ? '' : v;
}
