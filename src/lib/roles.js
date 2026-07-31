// Central role model — the authoritative access rules the app gates on.
// Mirrors the legacy authCheckSaved() routing and the DASH_ROLES gate.

export const OPS_ROLES = ['user', 'padmin', 'superadmin'];

// Header badge suffix per role (blank for the default operator role).
export const ROLE_LABEL = {
  plant: 'Plant', padmin: 'Purchase Admin', purchase: 'Purchase',
  pm: 'Production', scrap: 'Scrap', superadmin: 'Super Admin', qc: 'QC', user: '',
};

/** Where a role lands after sign-in. */
export function landingPath(role) {
  switch (role) {
    case 'plant': return '/plant';
    case 'qc': return '/qc';
    case 'pm': return '/pm';
    case 'scrap': return '/scrap';
    case 'purchase': return '/purchase';
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
    { to: '/invoice', label: 'Invoice' },
  ];
  if (role === 'superadmin') tabs.push({ to: '/dashboard', label: '📊 Dashboard' });
  if (role === 'padmin' || role === 'superadmin') tabs.push({ to: '/pdashboard', label: '📦 P Dashboard' });
  return tabs;
}

/** Whether a role may view a route (base path, query ignored). */
export function canAccess(role, path) {
  const p = String(path || '').split('?')[0];
  if (['/po', '/oab', '/daily', '/invoice'].includes(p)) return OPS_ROLES.includes(role);
  if (p === '/dashboard') return role === 'superadmin';
  if (p === '/pdashboard') return role === 'padmin' || role === 'superadmin';
  if (p === '/plant') return role === 'plant';
  if (p === '/qc') return role === 'qc';
  if (p === '/pm') return role === 'pm';
  if (p === '/scrap') return role === 'scrap';
  if (p === '/purchase') return role === 'purchase';
  return false;
}
