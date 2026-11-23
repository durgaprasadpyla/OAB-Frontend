import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useData } from '../data.jsx';
import { specIndex } from '../lib/specs.js';
import { navTabs, OPS_ROLES } from '../lib/roles.js';
import RoleSwitcher from './RoleSwitcher.jsx';
import { exportAOA } from '../lib/xlsx.js';
import { today } from '../lib/format.js';
import '../v2.css';
import '../v2-app.css';

/**
 * Every single-screen role gets its own coloured brand bar in production, not the
 * ops app-bar: each panel (#plant-panel, #qc-panel, …) opens with its own header.
 * Colours are post-remap (build.js turns the reference's #1B6B3A green into the
 * blue brand); #1a3a6b / #1a4fa0 / #5e35b1 / the scrap gradient were never green
 * and are unchanged.
 */
const ROLE_BAR = {
  plant: { bg: '#0e6fb8', brand: 'BLOOMFLEX', sub: 'Production Floor', signOut: 'Sign Out',
    links: [{ to: '/plant', label: 'Floor Status' }, { to: '/production', label: '🏭 Production' }, { to: '/reports', label: '📈 Reports' }] },
  qc: { bg: '#0e6fb8', brand: 'BLOOMFLEX', sub: 'QC / Spec Entry', signOut: 'Sign Out' },
  purchase: { bg: '#1a3a6b', brand: 'BLOOMFLEX', sub: 'Purchase — Generate, Track & Close POs', signOut: 'Sign Out' },
  pm: { bg: '#ffffff', fg: '#123a6b', border: '1px solid #e2e6ee', brand: 'Bloomflex — Production', sub: 'Printing progress tracker', signOut: 'Sign Out',
    // 28.09 §PM: the PM and PPC logins are one workspace. Weekly planning is the
    // Planner tab it already had; Dashboard and the daily board were the only two
    // screens missing, and the board is labelled the way the floor asks for it.
    links: [{ to: '/pm', label: 'Printing Progress' }, { to: '/ppc', label: '📊 Dashboard' }, { to: '/production', label: '🏭 Production' }, { to: '/planner', label: '🗓 Planner' }, { to: '/board', label: '📋 Today’s Plan' }, { to: '/reports', label: '📈 Reports' }] },
  scrap: { bg: 'linear-gradient(90deg,#5a3d1c,#8a6a2f)', brand: 'Bloomflex — Scrap', signOut: 'Logout' },
  sales: { bg: '#1a4fa0', brand: 'BLOOMFLEX', sub: 'Sales Rep', signOut: 'Sign Out' },
  quote: { bg: '#5e35b1', brand: 'BLOOMFLEX', sub: 'Quotation Desk', signOut: 'Sign Out' },
  planner: { bg: '#0a5aa0', brand: 'BLOOMFLEX', sub: 'Production Planner', signOut: 'Sign Out',
    links: [{ to: '/planner', label: '🗓 Weekly' }, { to: '/board', label: '📋 Today’s Plan' }, { to: '/reports', label: '📈 Reports' }] },
  stores: { bg: '#1a3a6b', brand: 'BLOOMFLEX', sub: 'Stores', signOut: 'Sign Out' },
  // Enhancements 2.0 planning-module logins — each is a single-screen (panel) role with
  // its own coloured brand bar and its own in-workspace navigation (NOT ops nav tabs).
  ppc: { bg: '#0a4d8c', brand: 'BLOOMFLEX', sub: 'Production Planning & Control', signOut: 'Sign Out',
    links: [{ to: '/ppc', label: '📊 Dashboard' }, { to: '/planner', label: '🗓 Weekly' }, { to: '/board', label: '📋 Today’s Plan' }, { to: '/reports', label: '📈 Reports' }] },
  mis: { bg: '#0f766e', brand: 'BLOOMFLEX', sub: 'MIS — Status & Analytics', signOut: 'Sign Out',
    links: [{ to: '/mis', label: '📋 Status' }, { to: '/production', label: '🏭 Record Actuals' }, { to: '/reports', label: '📈 Reports' }] },
  plan: { bg: '#b45309', brand: 'BLOOMFLEX', sub: 'Planning — Ready to Plan', signOut: 'Sign Out',
    links: [{ to: '/plan', label: '✅ Ready to Plan' }, { to: '/reports', label: '📈 Reports' }] },
  // 30.09 §QC: the JSS login — one screen, the JSS editor.
  jss: { bg: '#0e6fb8', brand: 'BLOOMFLEX', sub: 'JSS Editor', signOut: 'Sign Out' },
};


/**
 * BloomFlex V2 frame for a single-screen role: the prototype's orange top bar (brand,
 * the role's workspace name, view-as / user, Sign Out) and, when the role has more
 * than one screen, a white tab bar with its links. Same links, same actions as the
 * old coloured bar (`cfg.bg` is no longer drawn — every login shares the V2 frame).
 */
function RoleBar({ cfg, who, switcher, onSignOut, onNav, activePath }) {
  const links = cfg.links || [];
  return (
    <>
      <header className="v2-top">
        <div className="v2-brand"><b>{cfg.brand}</b>{cfg.sub ? <span className="sub">{cfg.sub}</span> : null}</div>
        <div className="v2-top-right">
          {/* A Super Admin viewing as this role keeps their badge here, so switching
              back is one click away; every real login of this role sees no change. */}
          {switcher ? <RoleSwitcher variant="bar" dark /> : who ? <span className="v2-who">{who}</span> : null}
          <button className="v2-tbtn" onClick={onSignOut}>{cfg.signOut}</button>
        </div>
      </header>
      {links.length > 0 && (
        <nav className="v2-tabbar">
          {links.map((l) => (
            <button key={l.to} className={'v2-nav' + (activePath === l.to ? ' on' : '')} onClick={() => onNav(l.to)}>{l.label}</button>
          ))}
        </nav>
      )}
    </>
  );
}

/**
 * The native app frame: the legacy header/#hdr look, role-gated nav, and an
 * <Outlet/> for the routed screen. Panel roles (plant/qc/pm/scrap/purchase/sales/
 * quote) get their own coloured brand bar instead of the ops app-bar; their single
 * screen fills the body.
 */
export default function Shell() {
  const { user, role, realRole, logout } = useAuth();
  const { mods, loading, error, saving, conflict, clearConflict } = useData();
  const nav = useNavigate();
  const loc = useLocation();

  const tabs = navTabs(role);
  const isPanelRole = !OPS_ROLES.includes(role);
  const roleBar = ROLE_BAR[role];

  function signOut() { logout(); nav('/login', { replace: true }); }

  function tabActive(t) {
    if (t.match === '/oab') {
      const sheet = new URLSearchParams(loc.search).get('sheet') || 'SF';
      return loc.pathname === '/oab' && sheet === t.sheet;
    }
    return loc.pathname === t.to;
  }

  function backup() {
    const cols = ['sheet', 'sno', 'so', 'spec', 'customer', 'jobName', 'poQty', 'invDisp', 'manDisp', 'fg', 'stage', 'closed'];
    // JSS is authoritative for the SKU (job name): export the current spec's name so a
    // repointed spec self-corrects in the backup too (falls back to the stored name).
    const jssBySpec = specIndex(mods.jss);
    const rows = [cols];
    for (const sheet of ['SF', 'OT']) {
      (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet] || []).forEach((r) =>
        rows.push(cols.map((c) => {
          if (c === 'sheet') return sheet;
          if (c === 'jobName') return (jssBySpec[r.spec] && jssBySpec[r.spec].jobName) || r.jobName || '';
          return r[c] ?? '';
        })));
    }
    exportAOA(rows, `OAB_Backup_${today()}.xlsx`, 'OAB');
  }

  const body = (
    <div className="oab-main v2 v2-app">
      {conflict && (
        <div className="al al-y" style={{ margin: '12px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>⚠️ This data was changed elsewhere and has been reloaded. Review the latest values and save your change again.</span>
          <button className="btn btn-s" style={{ height: 24, fontSize: 11 }} onClick={clearConflict}>Dismiss</button>
        </div>
      )}
      {error
        ? <div className="al al-r" style={{ margin: 16 }}>Failed to load data: {error}</div>
        : loading
          ? <div className="pg-sub" style={{ padding: 24 }}>Loading data…</div>
          : <Outlet />}
    </div>
  );

  if (roleBar) {
    return (
      <div className="oab-shell">
        <RoleBar
          cfg={roleBar}
          who={role === 'sales' ? user : ''}
          switcher={realRole === 'superadmin'}
          onSignOut={signOut}
          onNav={(to) => nav(to)}
          activePath={loc.pathname}
        />
        {body}
      </div>
    );
  }

  return (
    <div className="oab-shell">
      <header className="v2-top">
        <div className="v2-brand"><b>🌿 Bloomflex</b><span className="sub">Order &amp; Production Management</span></div>
        <div className="v2-top-right">
          {/* Sync state, matching the monolith's updateSyncBadge. There is no
              "Save OAB" button here on purpose: the monolith needs one because it
              holds the whole blob dirty in memory, whereas every action in this
              app persists on its own (or via a screen's own Save button). */}
          <span className={'v2-pill' + (error ? ' err' : '')}>
            {error ? '⚠ Sync error' : saving ? '⏳ Syncing…' : '☁ Synced'}
          </span>
          <RoleSwitcher variant="hdr" />
          {!isPanelRole && (
            <button className="v2-tbtn" onClick={backup}>⬇ Backup</button>
          )}
          <button className="v2-tbtn" onClick={signOut}>Sign Out</button>
        </div>
      </header>
      {!isPanelRole && (
        <nav className="v2-tabbar">
          {tabs.map((t) => (
            <button key={t.label} className={'v2-nav' + (tabActive(t) ? ' on' : '')} onClick={() => nav(t.to)}>
              {t.label}
            </button>
          ))}
        </nav>
      )}
      {body}
    </div>
  );
}
