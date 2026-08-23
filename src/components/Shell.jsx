import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useData } from '../data.jsx';
import { navTabs, ROLE_LABEL, OPS_ROLES } from '../lib/roles.js';
import { exportAOA } from '../lib/xlsx.js';
import { today } from '../lib/format.js';

/**
 * Every single-screen role gets its own coloured brand bar in production, not the
 * ops app-bar: each panel (#plant-panel, #qc-panel, …) opens with its own header.
 * Colours are post-remap (build.js turns the reference's #1B6B3A green into the
 * blue brand); #1a3a6b / #1a4fa0 / #5e35b1 / the scrap gradient were never green
 * and are unchanged.
 */
const ROLE_BAR = {
  plant: { bg: '#0e6fb8', brand: 'BLOOMFLEX', sub: 'Production Floor', signOut: 'Sign Out' },
  qc: { bg: '#0e6fb8', brand: 'BLOOMFLEX', sub: 'QC / Spec Entry', signOut: 'Sign Out' },
  purchase: { bg: '#1a3a6b', brand: 'BLOOMFLEX', sub: 'Purchase — Generate, Track & Close POs', signOut: 'Sign Out' },
  pm: { bg: '#ffffff', fg: '#123a6b', border: '1px solid #e2e6ee', brand: 'Bloomflex — Production', sub: 'Printing progress tracker', signOut: 'Sign Out' },
  scrap: { bg: 'linear-gradient(90deg,#5a3d1c,#8a6a2f)', brand: 'Bloomflex — Scrap', signOut: 'Logout' },
  sales: { bg: '#1a4fa0', brand: 'BLOOMFLEX', sub: 'Sales Rep', signOut: 'Sign Out' },
  quote: { bg: '#5e35b1', brand: 'BLOOMFLEX', sub: 'Quotation Desk', signOut: 'Sign Out' },
};

/** The coloured single-screen role bar. (#plant-panel / #qc-panel / … headers) */
function RoleBar({ cfg, who, onSignOut }) {
  const dark = cfg.fg !== '#123a6b';
  return (
    <div
      style={{
        background: cfg.bg, color: cfg.fg || '#fff', padding: '12px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        position: 'sticky', top: 0, zIndex: 200, flexWrap: 'wrap', gap: 8,
        borderBottom: cfg.border || 'none',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 1 }}>
        {cfg.brand}
        {cfg.sub ? <>&nbsp;<span style={{ fontWeight: 400, fontSize: 12, opacity: dark ? 0.8 : 1, color: cfg.fg ? '#8a93a3' : undefined }}>{cfg.sub}</span></> : null}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {who ? <span style={{ fontSize: 12, opacity: 0.9 }}>{who}</span> : null}
        <button
          onClick={onSignOut}
          style={{
            height: 30, padding: '0 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
            background: dark ? 'rgba(255,255,255,.15)' : '#eef3fb',
            color: cfg.fg || '#fff',
            border: '1px solid ' + (dark ? 'rgba(255,255,255,.4)' : '#cfd8e3'),
          }}
        >{cfg.signOut}</button>
      </div>
    </div>
  );
}

/**
 * The native app frame: the legacy header/#hdr look, role-gated nav, and an
 * <Outlet/> for the routed screen. Panel roles (plant/qc/pm/scrap/purchase/sales/
 * quote) get their own coloured brand bar instead of the ops app-bar; their single
 * screen fills the body.
 */
export default function Shell() {
  const { user, role, logout } = useAuth();
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
    const jssBySpec = {};
    (mods.jss || []).forEach((j) => { if (j && j.spec) jssBySpec[j.spec] = j; });
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
    <div className="oab-main">
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
          onSignOut={signOut}
        />
        {body}
      </div>
    );
  }

  return (
    <div className="oab-shell">
      <div id="hdr">
        <div className="logo">🌿 Bloomflex <span>Order &amp; Production Management</span></div>
        {!isPanelRole && (
          <div id="nav">
            {tabs.map((t) => (
              <button key={t.label} className={'ntab' + (tabActive(t) ? ' on' : '')} onClick={() => nav(t.to)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Sync state, matching the monolith's updateSyncBadge. There is no
              "Save OAB" button here on purpose: the monolith needs one because it
              holds the whole blob dirty in memory, whereas every action in this
              app persists on its own (or via a screen's own Save button). */}
          <span className={'hbadge' + (error ? ' err' : saving ? '' : ' ok')}>
            {error ? '⚠ Sync error' : saving ? '⏳ Syncing…' : '☁ Synced'}
          </span>
          <span className="hbadge ok">👤 {user}{ROLE_LABEL[role] ? ' (' + ROLE_LABEL[role] + ')' : ''}</span>
          {!isPanelRole && (
            <button className="btn btn-s" style={{ height: 26, fontSize: 11 }} onClick={backup}>⬇ Backup</button>
          )}
          <button className="btn btn-s" style={{ height: 26, fontSize: 11 }} onClick={signOut}>Sign Out</button>
        </div>
      </div>
      {body}
    </div>
  );
}
