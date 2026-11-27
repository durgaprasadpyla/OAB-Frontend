import { describe, it, expect } from 'vitest';
import { landingPath, canAccess, navTabs, ROLE_LABEL } from '../lib/roles.js';

// Enhancements 2.0 — the three production-planning module logins (PPC, MIS, PLAN) each
// land on their own role-specific page, may reach only the screens their role owns, and
// do NOT add extra tabs to the Super Admin ops nav. This locks the routing/permission
// layer that RoleRoute enforces (a role bounced off a forbidden path lands on its own
// page — i.e. URL tampering can't cross into another role's functionality). Existing
// roles are asserted unchanged as a regression guard.

describe('role landings — PPC / MIS / PLAN', () => {
  it('each new login lands on its own role-specific page', () => {
    expect(landingPath('ppc')).toBe('/ppc');
    expect(landingPath('mis')).toBe('/mis');
    expect(landingPath('plan')).toBe('/plan');
  });

  it('labels the header badge for each new role', () => {
    expect(ROLE_LABEL.ppc).toBe('PPC');
    expect(ROLE_LABEL.mis).toBe('MIS');
    expect(ROLE_LABEL.plan).toBe('Planning');
  });

  it('PPC may plan (dashboard, weekly, board, reports) but not MIS/PLAN/ops screens', () => {
    ['/ppc', '/planner', '/board', '/reports'].forEach((p) => expect(canAccess('ppc', p)).toBe(true));
    ['/mis', '/plan', '/production', '/po', '/invoice', '/master', '/plant'].forEach((p) => expect(canAccess('ppc', p)).toBe(false));
  });

  it('MIS may see status, record actuals and reports but not plan or mark readiness', () => {
    ['/mis', '/production', '/reports'].forEach((p) => expect(canAccess('mis', p)).toBe(true));
    ['/ppc', '/plan', '/planner', '/board', '/po', '/master'].forEach((p) => expect(canAccess('mis', p)).toBe(false));
  });

  it('PLAN may mark readiness and see reports but not the planner/board/production', () => {
    ['/plan', '/reports'].forEach((p) => expect(canAccess('plan', p)).toBe(true));
    ['/ppc', '/mis', '/planner', '/board', '/production', '/po', '/master'].forEach((p) => expect(canAccess('plan', p)).toBe(false));
  });

  it('Super Admin keeps a break-glass view of all three landings', () => {
    ['/ppc', '/mis', '/plan', '/planner', '/board', '/reports', '/production'].forEach((p) => expect(canAccess('superadmin', p)).toBe(true));
  });

  it('Super Admin ops nav consolidates planning into ONE entry (no per-screen tabs)', () => {
    const tabs = navTabs('superadmin').map((t) => t.to);
    // Exactly one planning entry — the PPC dashboard hub.
    expect(tabs).toContain('/ppc');
    expect(tabs.filter((t) => t === '/ppc')).toHaveLength(1);
    // The previous per-screen planning tabs are gone from the ops nav.
    ['/planner', '/board', '/production', '/reports'].forEach((t) => expect(tabs).not.toContain(t));
    // Enhancements 2.0 §6: Master Data is no longer a main-header tab (it moved into the
    // Dashboard). The core ops tabs are untouched.
    expect(tabs).not.toContain('/master');
    expect(tabs).toContain('/po');
  });

  it('the new roles carry no ops tabs of their own (they are panel/landing roles)', () => {
    expect(navTabs('ppc')).toHaveLength(0);
    expect(navTabs('mis')).toHaveLength(0);
    expect(navTabs('plan')).toHaveLength(0);
  });
});

describe('role landings — existing roles unchanged (regression)', () => {
  it('keeps existing landings', () => {
    expect(landingPath('planner')).toBe('/planner');
    expect(landingPath('plant')).toBe('/plant');
    expect(landingPath('pm')).toBe('/pm');
    expect(landingPath('superadmin')).toBe('/po');
    expect(landingPath('sales')).toBe('/rep');
  });
  it('keeps existing access rules', () => {
    expect(canAccess('plant', '/plant')).toBe(true);
    expect(canAccess('planner', '/planner')).toBe(true);
    expect(canAccess('qc', '/qc')).toBe(true);
    expect(canAccess('plant', '/po')).toBe(false);
    // planner still reaches its board + reports
    expect(canAccess('planner', '/board')).toBe(true);
    expect(canAccess('planner', '/reports')).toBe(true);
  });
});

// 30.09 §QC: "New login: ONLY the JSS editor functionality that exists in super admin."
describe('role landings — the JSS login', () => {
  it('lands on its own page, labelled JSS', () => {
    expect(landingPath('jss')).toBe('/jss');
    expect(ROLE_LABEL.jss).toBe('JSS');
  });

  it('reaches the JSS editor and nothing else', () => {
    expect(canAccess('jss', '/jss')).toBe(true);
    ['/dashboard', '/qc', '/po', '/oab', '/stores', '/pdashboard', '/master', '/plant', '/ppc', '/reports', '/projections', '/sdashboard', '/rep', '/hr']
      .forEach((p) => expect(canAccess('jss', p)).toBe(false));
    expect(navTabs('jss')).toHaveLength(0);
  });

  it('the Super Admin may open it too; no other login may', () => {
    expect(canAccess('superadmin', '/jss')).toBe(true);
    ['qc', 'user', 'padmin', 'plant', 'pm', 'stores', 'sales', 'sadmin', 'ppc', 'plan', 'mis', 'hr']
      .forEach((r) => expect(canAccess(r, '/jss')).toBe(false));
  });
});

// 27.11 Enhancements: the Superstar login split into single-purpose logins —
//   U2 FG (StayFresh) · U1 FG (others) · Account (invoicing) · Dispatches.
describe('role landings — the 27.11 FG / Account / Dispatches logins', () => {
  it('each new login lands on its own page and is labelled', () => {
    expect(landingPath('u1')).toBe('/fg');
    expect(landingPath('u2')).toBe('/fg');
    expect(landingPath('account')).toBe('/invoice');
    expect(landingPath('dispatch')).toBe('/dispatches');
    expect(ROLE_LABEL.u1).toBe('FG — Others');
    expect(ROLE_LABEL.u2).toBe('FG — StayFresh');
    expect(ROLE_LABEL.account).toBe('Account');
    expect(ROLE_LABEL.dispatch).toBe('Dispatches');
  });

  it('FG Entry moved off the Superstar (user) onto the U1 / U2 logins', () => {
    // the Superstar no longer reaches FG Entry or Invoice …
    expect(canAccess('user', '/fg')).toBe(false);
    expect(canAccess('user', '/invoice')).toBe(false);
    // … but keeps the rest of the ops workspace
    ['/po', '/po-to-so', '/oab', '/daily', '/specdisp'].forEach((p) => expect(canAccess('user', p)).toBe(true));
    // the FG logins reach only the FG sheet
    ['u1', 'u2'].forEach((r) => {
      expect(canAccess(r, '/fg')).toBe(true);
      ['/invoice', '/dispatches', '/po', '/oab', '/daily', '/specdisp'].forEach((p) => expect(canAccess(r, p)).toBe(false));
      expect(navTabs(r)).toHaveLength(0);
    });
  });

  it('Account reaches only invoicing; Dispatches only its desk', () => {
    expect(canAccess('account', '/invoice')).toBe(true);
    ['/fg', '/dispatches', '/po', '/oab', '/daily'].forEach((p) => expect(canAccess('account', p)).toBe(false));
    expect(navTabs('account')).toHaveLength(0);

    expect(canAccess('dispatch', '/dispatches')).toBe(true);
    ['/invoice', '/fg', '/po', '/oab', '/specdisp'].forEach((p) => expect(canAccess('dispatch', p)).toBe(false));
    expect(navTabs('dispatch')).toHaveLength(0);
  });

  it('the Super Admin keeps FG, Invoice and the Dispatches desk (break-glass); Purchase Admin keeps FG + Invoice', () => {
    ['/fg', '/invoice', '/dispatches'].forEach((p) => expect(canAccess('superadmin', p)).toBe(true));
    expect(canAccess('padmin', '/fg')).toBe(true);
    expect(canAccess('padmin', '/invoice')).toBe(true);
    expect(canAccess('padmin', '/dispatches')).toBe(false);
  });

  it('the Superstar ops nav drops FG Entry + Invoice but keeps Dispatch by SO; Super Admin keeps all three', () => {
    const user = navTabs('user').map((t) => t.to);
    expect(user).not.toContain('/fg');
    expect(user).not.toContain('/invoice');
    expect(user).toContain('/specdisp');
    expect(user).toContain('/po');

    const sa = navTabs('superadmin').map((t) => t.to);
    expect(sa).toContain('/fg');
    expect(sa).toContain('/invoice');
    expect(sa).toContain('/dispatches');
  });
});
