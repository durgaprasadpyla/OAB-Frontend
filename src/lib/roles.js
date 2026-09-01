// Central role model — the authoritative access rules the app gates on.
// Mirrors the legacy authCheckSaved() routing and the DASH_ROLES gate.

export const OPS_ROLES = ['user', 'padmin', 'superadmin'];

// Header badge suffix per role (blank for the default operator role).
export const ROLE_LABEL = {
  plant: 'Plant', padmin: 'Purchase Admin', purchase: 'Purchase',
  pm: 'Production', scrap: 'Scrap', superadmin: 'Super Admin', qc: 'QC', user: '',
  hr: 'HR',
  sadmin: 'Sales Admin', quote: 'Quotation Desk', sales: 'Sales Rep',
  planner: 'Planner', stores: 'Stores',
  // Production-planning module logins (Enhancements 2.0). Each lands on its own
  // role-specific page: PPC = planning dashboard, MIS = status board, PLAN = readiness.
  ppc: 'PPC', mis: 'MIS', plan: 'Planning',
};

/** Where a role lands after sign-in. */
export function landingPath(role) {
  switch (role) {
    case 'plant': return '/plant';
    case 'qc': return '/qc';
    case 'pm': return '/pm';
    case 'scrap': return '/scrap';
    case 'purchase': return '/purchase';
    case 'hr': return '/hr';
    case 'sadmin': return '/sdashboard';
    case 'quote': return '/quotes';
    case 'sales': return '/rep';
    // Production-planning roles. Planner lands on the weekly planner; stores lands
    // on its own desk (stock on hand, GRNs, issues and returns).
    case 'planner': return '/planner';
    case 'stores': return '/stores';
    // Enhancements 2.0 planning module logins → each to its own role-specific landing:
    // PPC → planning dashboard (planned-vs-actual + wastage), MIS → status board,
    // PLAN → Ready-to-Plan readiness screen.
    case 'ppc': return '/ppc';
    case 'mis': return '/mis';
    case 'plan': return '/plan';
    default: return '/po'; // user / padmin / superadmin → main workspace
  }
}

/** Operational nav tabs, role-gated (Dashboard = superadmin, P Dashboard = padmin/superadmin). */
export function navTabs(role) {
  if (!OPS_ROLES.includes(role)) return [];
  const tabs = [
    { to: '/po', label: 'New PO' },
    { to: '/oab?sheet=SF', label: 'Stay Fresh OAB', match: '/oab', sheet: 'SF' },
    { to: '/oab?sheet=OT', label: 'Others OAB', match: '/oab', sheet: 'OT' },
    { to: '/daily', label: 'Daily Update' },
    { to: '/fg', label: '📦 FG Entry' },
    { to: '/invoice', label: 'Invoice' },
    { to: '/specdisp', label: '📊 Dispatch by SO' },
  ];
  if (role === 'superadmin') tabs.push({ to: '/dashboard', label: '📊 Dashboard' });
  // Superadmin keeps the full operations view AND gets an HR tab; role 'hr' has
  // an HR-only workspace and never reaches these ops tabs at all.
  if (role === 'superadmin') tabs.push({ to: '/hr', label: '👥 HR' });
  if (role === 'superadmin') tabs.push({ to: '/sdashboard', label: '💼 S Dashboard' });
  if (role === 'padmin' || role === 'superadmin') tabs.push({ to: '/pdashboard', label: '📦 P Dashboard' });
  // Enhancements 2.0 §6: Master Data is NOT a main-header tab — it is a tab INSIDE the
  // Super Admin Dashboard (next to Drop-down selections). The standalone /master route
  // still exists for the panel roles that land there (stores) / read it (planner).
  // Planning is consolidated behind ONE Super Admin entry — the PPC dashboard is a hub
  // that links out to Weekly, Daily Board, Production and Reports. We intentionally do
  // NOT add a separate nav tab per planning screen (Enhancements 2.0: role-specific
  // landing pages, not extra tabs); the PPC / MIS / PLAN logins reach those directly.
  if (role === 'superadmin') tabs.push({ to: '/ppc', label: '🗂 Planning' });
  return tabs;
}

/** Whether a role may view a route (base path, query ignored). */
export function canAccess(role, path) {
  const p = String(path || '').split('?')[0];
  if (['/po', '/oab', '/daily', '/fg', '/invoice', '/specdisp'].includes(p)) return OPS_ROLES.includes(role);
  if (p === '/dashboard') return role === 'superadmin';
  if (p === '/pdashboard') return role === 'padmin' || role === 'superadmin';
  if (p === '/plant') return role === 'plant';
  if (p === '/qc') return role === 'qc';
  if (p === '/pm') return role === 'pm';
  if (p === '/scrap') return role === 'scrap';
  if (p === '/purchase') return role === 'purchase';
  if (p === '/hr') return role === 'hr' || role === 'superadmin';
  // Master Data hub: superadmin + padmin (config/items), planner + stores (read /
  // stock). Per-section write permission is enforced again on the backend.
  if (p === '/master') return ['superadmin', 'padmin', 'planner', 'stores'].includes(role);
  // Stores desk: the stores role plus Super Admin (who also reads the stock value).
  if (p === '/stores') return role === 'stores' || role === 'superadmin';
  // Production execution: Plant + Plant Manager (record), Super Admin, Planner (view),
  // MIS (records actuals — Enhancements 2.0 §51).
  if (p === '/production') return ['plant', 'pm', 'mis', 'superadmin', 'planner'].includes(role);
  // Weekly planner + daily board: Planner + PPC + Super Admin (plan), Plant Manager (view).
  if (p === '/planner' || p === '/board') return ['planner', 'ppc', 'superadmin', 'pm'].includes(role);
  // Reports: planning + production management (shared by all planning logins, §53).
  if (p === '/reports') return ['planner', 'ppc', 'mis', 'plan', 'superadmin', 'pm', 'plant'].includes(role);
  // Enhancements 2.0 planning-module landings — each strictly for its own login
  // (Super Admin keeps a break-glass view to oversee planning from one place).
  if (p === '/ppc') return role === 'ppc' || role === 'superadmin';
  if (p === '/mis') return role === 'mis' || role === 'superadmin';
  if (p === '/plan') return role === 'plan' || role === 'superadmin';
  // Sales surfaces. Superadmin keeps a break-glass view of all three, matching
  // the backend's module-12 grant {sadmin, quote, sales, superadmin}.
  if (p === '/sdashboard') return role === 'sadmin' || role === 'superadmin';
  if (p === '/quotes') return role === 'quote' || role === 'sadmin' || role === 'superadmin';
  if (p === '/rep') return role === 'sales';
  return false;
}
