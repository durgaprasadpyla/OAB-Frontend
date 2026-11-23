import { api } from '../api.js';

// BloomFlex V2 — BOM approval before Ready to Plan, and the material readiness of a
// sale order (how much of its BOM is allocated / issued). The server is the authority:
// it refuses Ready to Plan for an order whose BOM is not approved (the Super Admin may
// override), and works out coverage for every order in one pass on /readiness.

export const bomApprovalApi = {
  /** One order's approval + material position. */
  status: (so) => api('/api/planning/bom-approval?so=' + encodeURIComponent(so)),
  /** Approve the BOM the order works to (PLAN / PPC / PM / QC / Super Admin). */
  approve: (so, note) => api('/api/planning/bom-approval', { method: 'POST', body: { so, note: note || undefined } }),
  /** Withdraw an approval (Super Admin; force once the order has planned jobs). */
  revoke: (so, force) => api('/api/planning/bom-approval?so=' + encodeURIComponent(so) + (force ? '&force=true' : ''), { method: 'DELETE' }),
};

/** The roles that may approve an order's BOM — the server's list. */
export const BOM_APPROVERS = ['plan', 'ppc', 'pm', 'qc', 'superadmin'];
export const canApproveBom = (role) => BOM_APPROVERS.includes(String(role || '').toLowerCase());

/**
 * True only when the server SAID the BOM is pending (bomApproved === false) and the
 * order is not already ready (an order marked ready before the gate existed stays
 * editable). A row without the field — an older server — is left to the server.
 */
export const bomPending = (state) => !!state && state.bomApproved === false && !state.readyToPlan;

export const MATERIAL_LABEL = { READY: 'Ready', PARTIAL: 'Partial', BLOCKED: 'Blocked', NO_BOM: 'No BOM', UNKNOWN: 'Unknown' };
export const MATERIAL_TAG = { READY: 'tg', PARTIAL: 'ty', BLOCKED: 'tr', NO_BOM: 'tgr', UNKNOWN: 'tgr' };

/** A refusal from POST /api/planning/ready, said plainly. */
export function readyRefusal(e) {
  const m = (e && e.message) || 'Could not update Ready to Plan';
  return /BOM not approved/i.test(m) && !/approve the BOM/i.test(m)
    ? `${m} — ask PLAN / PPC / PM / QC to approve the BOM first.`
    : m;
}

/**
 * Coverage of an order from its /so-material lines — the server's rule: the weakest
 * BOM line, each capped at 100 %, leaving out lines that cannot be measured (no
 * requirement, or a unit mismatch). Returns { pct (0-100, floored to 0.1), status } or
 * null when nothing can be measured.
 */
export function coverFromLines(lines) {
  let min = null;
  (lines || []).forEach((l) => {
    if (!l || l.onBom === false || l.uomMismatch) return;
    const req = Number(l.required);
    if (!(req > 0)) return;
    const have = Math.max(0, Number(l.covered) || 0);
    const f = Math.min(1, have / req);
    if (min == null || f < min) min = f;
  });
  if (min == null) return null;
  return {
    pct: Math.floor(min * 1000) / 10,
    status: min >= 1 ? 'READY' : min <= 0 ? 'BLOCKED' : 'PARTIAL',
  };
}
