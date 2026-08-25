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
    // Master Data stays (Enhancements 2.0 §6) and the core ops tabs are untouched.
    expect(tabs).toContain('/master');
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
