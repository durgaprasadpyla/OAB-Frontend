import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useData } from '../data.jsx';
import { navTabs, ROLE_LABEL, OPS_ROLES } from '../lib/roles.js';
import { exportAOA } from '../lib/xlsx.js';
import { today } from '../lib/format.js';

/**
 * The native app frame: the legacy header/#hdr look, role-gated nav, and an
 * <Outlet/> for the routed screen. Panel roles (plant/qc/pm/scrap/purchase) get
 * a header with no ops-nav; their single screen fills the body.
 */
export default function Shell() {
  const { user, role, logout } = useAuth();
  const { mods, loading, error, saving, conflict, clearConflict } = useData();
  const nav = useNavigate();
  const loc = useLocation();

  const tabs = navTabs(role);
  const isPanelRole = !OPS_ROLES.includes(role);

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
    const rows = [cols];
    for (const sheet of ['SF', 'OT']) {
      (mods.oab && mods.oab.OAB && mods.oab.OAB[sheet] || []).forEach((r) =>
        rows.push(cols.map((c) => (c === 'sheet' ? sheet : (r[c] ?? '')))));
    }
    exportAOA(rows, `OAB_Backup_${today()}.xlsx`, 'OAB');
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
          {saving && <span className="hbadge">Saving…</span>}
          <span className="hbadge ok">👤 {user}{ROLE_LABEL[role] ? ' (' + ROLE_LABEL[role] + ')' : ''}</span>
          {!isPanelRole && (
            <button className="btn btn-s" style={{ height: 26, fontSize: 11 }} onClick={backup}>⬇ Backup</button>
          )}
          <button className="btn btn-s" style={{ height: 26, fontSize: 11 }} onClick={signOut}>Sign Out</button>
        </div>
      </div>
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
    </div>
  );
}
