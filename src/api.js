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
    // Prefer the human reason the backend puts in the error body (Spring's
    // {"message": "..."} / {"detail": "..."} / our {"error": "..."} shapes) over a raw
    // JSON dump, so a banner reads "A department named 'printing' already exists", not
    // "HTTP 409". `detail` is the RFC-7807 field Spring uses when problemdetails are on
    // (application.properties) — without it a ResponseStatusException's reason, e.g.
    // "You cannot delete the account you are signed in with", surfaced as raw JSON.
    let reason = '';
    try {
      const j = JSON.parse(t);
      if (j && typeof j === 'object') reason = j.message || j.error || j.detail || '';
    } catch { /* not JSON — fall through to the raw text */ }
    const err = new Error(reason ? String(reason).slice(0, 300)
      : 'HTTP ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
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
 * Returns the formatted number string, e.g. "BL/26-27/424".
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
  // Permanent server-side row delete. A whole-blob save can't delete a module-1 row
  // (the 3-way merge re-adds it), so deletion goes through this granular endpoint.
  deleteRow: (so) => api('/api/oab-rows/delete', { method: 'POST', body: { so } }),
  // Persist the packing list onto an already-saved invoice (built after Generate).
  saveInvoicePackingList: (no, packingList) => api('/api/invoices/packing-list', { method: 'POST', body: { no, packingList } }),
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
  // Click-to-reveal for the superadmin Password column (audited server-side).
  revealPassword: (id) => api('/api/admin/users/' + encodeURIComponent(id) + '/password'),
  // Issues 3.0 §1 — permanently remove an account (superadmin only, audited).
  remove: (id) => api('/api/admin/users/' + encodeURIComponent(id), { method: 'DELETE' }),
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

// ── Human Resources (module: hr_* tables, /api/hr/**) ──────────────────────
// Server-enforced: the whole controller is @PreAuthorize HR or SUPERADMIN, so a
// wrong role gets a 403 (err.code='forbidden') and the HR area simply stays shut.
const qs = (params) => {
  const p = Object.entries(params || {}).filter(([, v]) => v !== '' && v != null);
  return p.length ? '?' + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
};

export const hrApi = {
  dashboard: () => api('/api/hr/dashboard'),
  meta: () => api('/api/hr/meta'),

  listEmployees: (filters) => api('/api/hr/employees' + qs(filters)),
  getEmployee: (id) => api('/api/hr/employees/' + encodeURIComponent(id)),
  createEmployee: (body) => api('/api/hr/employees', { method: 'POST', body }),
  updateEmployee: (id, body) => api('/api/hr/employees/' + encodeURIComponent(id), { method: 'PUT', body }),
  setEmployeeStatus: (id, status, remarks) =>
    api(`/api/hr/employees/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status, remarks } }),

  listDocuments: (id) => api(`/api/hr/employees/${encodeURIComponent(id)}/documents`),
  addDocument: (id, body) => api(`/api/hr/employees/${encodeURIComponent(id)}/documents`, { method: 'POST', body }),
  deleteDocument: (docId) => api('/api/hr/documents/' + encodeURIComponent(docId), { method: 'DELETE' }),

  listDepartments: (p) => api('/api/hr/departments' + qs(p)),
  createDepartment: (body) => api('/api/hr/departments', { method: 'POST', body }),
  updateDepartment: (id, body) => api('/api/hr/departments/' + encodeURIComponent(id), { method: 'PUT', body }),

  listDesignations: (p) => api('/api/hr/designations' + qs(p)),
  createDesignation: (body) => api('/api/hr/designations', { method: 'POST', body }),
  updateDesignation: (id, body) => api('/api/hr/designations/' + encodeURIComponent(id), { method: 'PUT', body }),

  listLeaveTypes: (p) => api('/api/hr/leave-types' + qs(p)),
  createLeaveType: (body) => api('/api/hr/leave-types', { method: 'POST', body }),
  updateLeaveType: (id, body) => api('/api/hr/leave-types/' + encodeURIComponent(id), { method: 'PUT', body }),

  listLeaveRequests: (filters) => api('/api/hr/leave-requests' + qs(filters)),
  createLeaveRequest: (body) => api('/api/hr/leave-requests', { method: 'POST', body }),
  approveLeave: (id, comment) => api(`/api/hr/leave-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { comment } }),
  rejectLeave: (id, comment) => api(`/api/hr/leave-requests/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { comment } }),

  audit: (p) => api('/api/hr/audit' + qs(p)),
};

/** Forced password change after a first login or an admin reset. */
export const changePassword = (currentPassword, newPassword) =>
  api('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });

// ── Production-planning master data (Stage 2: /api/master/**) ────────────────
// Normalized masters (departments, specialties, machines, routes+stages, dispatch
// types) and the item master (+ stock ledger). Reads need any token; config writes
// are superadmin-only, item writes purchase/padmin/superadmin, stock writes add
// stores — all enforced server-side (403 surfaces as err.code='forbidden').
export const masterApi = {
  listDepartments: (p) => api('/api/master/departments' + qs(p)),
  createDepartment: (body) => api('/api/master/departments', { method: 'POST', body }),
  updateDepartment: (id, body) => api('/api/master/departments/' + encodeURIComponent(id), { method: 'PUT', body }),
  // Hard delete (Issues 1.0 #5) — the server refuses with the blockers when still referenced.
  deleteDepartment: (id) => api('/api/master/departments/' + encodeURIComponent(id), { method: 'DELETE' }),

  listSpecialties: (p) => api('/api/master/specialties' + qs(p)),
  createSpecialty: (body) => api('/api/master/specialties', { method: 'POST', body }),
  updateSpecialty: (id, body) => api('/api/master/specialties/' + encodeURIComponent(id), { method: 'PUT', body }),

  listMachines: (p) => api('/api/master/machines' + qs(p)),
  createMachine: (body) => api('/api/master/machines', { method: 'POST', body }),
  updateMachine: (id, body) => api('/api/master/machines/' + encodeURIComponent(id), { method: 'PUT', body }),

  listRoutes: (p) => api('/api/master/routes' + qs(p)),
  getRoute: (id) => api('/api/master/routes/' + encodeURIComponent(id)),
  createRoute: (body) => api('/api/master/routes', { method: 'POST', body }),
  updateRoute: (id, body) => api('/api/master/routes/' + encodeURIComponent(id), { method: 'PUT', body }),

  listDispatchTypes: (p) => api('/api/master/dispatch-types' + qs(p)),
  createDispatchType: (body) => api('/api/master/dispatch-types', { method: 'POST', body }),
  updateDispatchType: (id, body) => api('/api/master/dispatch-types/' + encodeURIComponent(id), { method: 'PUT', body }),

  listItems: (p) => api('/api/master/items' + qs(p)),
  getItem: (id) => api('/api/master/items/' + encodeURIComponent(id)),
  createItem: (body) => api('/api/master/items', { method: 'POST', body }),
  updateItem: (id, body) => api('/api/master/items/' + encodeURIComponent(id), { method: 'PUT', body }),
  adjustStock: (id, body) => api('/api/master/items/' + encodeURIComponent(id) + '/stock', { method: 'POST', body }),
  // One-shot bridge: seed the normalized item master from the purchase catalogue.
  syncItemsFromPurchase: () => api('/api/master/items/sync-from-purchase', { method: 'POST' }),
  // Bulk import (§15): rows validated server-side; returns {imported,duplicates,failed,errors}.
  importItems: (rows) => api('/api/master/items/import', { method: 'POST', body: { rows } }),
};

// ── JSS planning attributes (Stage 3: /api/jss/**) ───────────────────────────
// Per-JSS (keyed by spec code) dispatch type + auto-resolved route, ordered route
// departments, and eligible machines per department (multi, with speed + changeover).
// Reads need any token; writes are QC / superadmin (403 -> err.code='forbidden').
export const jssApi = {
  get: (spec) => api('/api/jss/' + encodeURIComponent(spec)),
  routeDepartments: (spec) => api('/api/jss/' + encodeURIComponent(spec) + '/route-departments'),
  setConfig: (spec, body) => api('/api/jss/' + encodeURIComponent(spec) + '/config', { method: 'PUT', body }),
  setMachines: (spec, machines) => api('/api/jss/' + encodeURIComponent(spec) + '/machines', { method: 'PUT', body: { machines } }),
};

// ── Department-wise BOM (Stage 3: /api/bom/**) ───────────────────────────────
export const bomApi = {
  get: (spec) => api('/api/bom/' + encodeURIComponent(spec)),
  set: (spec, body) => api('/api/bom/' + encodeURIComponent(spec), { method: 'PUT', body }),
};

// ── Stock check + low-stock alerts (Stage 4: /api/stock/**) ──────────────────
// check: compute an SO's material requirement and raise/clear its alerts (ops/
// planner). recompute: all open SOs (superadmin). alerts: OPEN shortages
// (superadmin/stores/pm/padmin). Every rule is enforced server-side.
export const stockApi = {
  check: (so) => api('/api/stock/check', { method: 'POST', body: { so } }),
  recompute: () => api('/api/stock/recompute', { method: 'POST' }),
  alerts: (status = 'OPEN') => api('/api/stock/alerts?status=' + encodeURIComponent(status)),
  resolveAlert: (id) => api('/api/stock/alerts/' + encodeURIComponent(id) + '/resolve', { method: 'POST' }),
};

// ── Role-aware notifications (Stage 4: /api/notifications/**) ─────────────────
// The server returns only the caller-role's notifications, so there's no leakage.
export const notificationsApi = {
  list: (unread) => api('/api/notifications' + (unread ? '?unread=1' : '')),
  count: () => api('/api/notifications/count'),
  markRead: (id) => api('/api/notifications/' + encodeURIComponent(id) + '/read', { method: 'POST' }),
};

// ── Production workflow (Stage 5: /api/production/**) ────────────────────────
// The route state machine: init an SO's stage balances, record actual + wastage at
// a stage (good output auto-moves to the next department, remainder stays pending),
// and read progress / the pending work pool. Writes are Plant / Plant Manager /
// Super Admin; reads any token. SO numbers contain '/', so they go in the body/query.
export const productionApi = {
  get: (so) => api('/api/production?so=' + encodeURIComponent(so)),
  pending: () => api('/api/production/pending'),
  init: (so) => api('/api/production/init', { method: 'POST', body: { so } }),
  record: (body) => api('/api/production/record', { method: 'POST', body }),
  setStatus: (so, stageSeq, status) => api('/api/production/status', { method: 'POST', body: { so, stageSeq, status } }),
};

// ── Weekly planning (Stage 6: /api/planning/**) ──────────────────────────────
// Ready-to-Plan pool, planner date-specific machine hours, and machine-job
// assignment (eligibility-checked, capped at the department's remaining qty,
// transaction-safe, with a capacity/over-booked result). Reads for the planning &
// production roles; assignment is planner/superadmin; marking ready adds plant/pm.
export const planningApi = {
  // Plant is the source of truth for material readiness: mode = 'COMPLETE' (whole job)
  // or 'PARTIAL' (readyQty meters). readyQty is ignored for COMPLETE / unmarking.
  // Not ready (§47-54): extra = { notReadyReason: 'PLATES'|'MATERIAL'|'OTHERS',
  // expectedReadyDate: 'yyyy-MM-dd' (mandatory with a reason), notReadyNote (OTHERS) }.
  setReady: (so, ready, mode, readyQty, extra) => api('/api/planning/ready', { method: 'POST', body: { so, ready, mode, readyQty, ...(extra || {}) } }),
  // Every SO's readiness row incl. the not-ready reason/date/note — the PLAN board.
  readiness: () => api('/api/planning/readiness'),
  pool: () => api('/api/planning/pool'),
  soPlan: (so) => api('/api/planning/so?so=' + encodeURIComponent(so)),
  machineHours: (from, to) => api('/api/planning/machine-hours?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)),
  setMachineHours: (machineId, date, hours, note) => api('/api/planning/machine-hours', { method: 'PUT', body: { machineId, date, hours, note } }),
  week: (from, to) => api('/api/planning/week?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)),
  assign: (body) => api('/api/planning/assign', { method: 'POST', body }),
  unassign: (jobId) => api('/api/planning/unassign', { method: 'POST', body: { jobId } }),
  move: (body) => api('/api/planning/move', { method: 'POST', body }),
  reorder: (body) => api('/api/planning/reorder', { method: 'POST', body }),
};

// ── Reports (Stage 8: /api/reports/**) — planned-vs-actual, wastage, utilization,
// and delayed job starts (§59/§82).
export const reportsApi = {
  production: (from, to, groupBy = 'department') =>
    api('/api/reports/production?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&groupBy=' + encodeURIComponent(groupBy)),
  utilization: (from, to) =>
    api('/api/reports/utilization?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)),
  delays: (from, to) =>
    api('/api/reports/delays?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)),
  // P6: planned/actual/wastage per SALE ORDER per department (PLAN + PPC dashboards).
  soProduction: (from, to) =>
    api('/api/reports/so-production?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)),
};
