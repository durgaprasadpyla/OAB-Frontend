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
    // on the Master Data hub (stock alerts + item stock) until it gets its own desk.
    case 'planner': return '/planner';
    case 'stores': return '/master';
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
  // Production-planning master data hub (routes, machines, departments, specialties,
  // dispatch types, item master). Config is superadmin; padmin can manage items.
  if (role === 'padmin' || role === 'superadmin') tabs.push({ to: '/master', label: '⚙️ Master Data' });
  if (role === 'superadmin') tabs.push({ to: '/production', label: '🏭 Production' });
  if (role === 'superadmin') tabs.push({ to: '/planner', label: '🗓 Planner' });
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
  // Production execution: Plant + Plant Manager (record), Super Admin, Planner (view).
  if (p === '/production') return ['plant', 'pm', 'superadmin', 'planner'].includes(role);
  // Weekly planner: Planner + Super Admin (plan), Plant Manager (view).
  if (p === '/planner') return ['planner', 'superadmin', 'pm'].includes(role);
  // Sales surfaces. Superadmin keeps a break-glass view of all three, matching
  // the backend's module-12 grant {sadmin, quote, sales, superadmin}.
  if (p === '/sdashboard') return role === 'sadmin' || role === 'superadmin';
  if (p === '/quotes') return role === 'quote' || role === 'sadmin' || role === 'superadmin';
  if (p === '/rep') return role === 'sales';
  return false;
}
