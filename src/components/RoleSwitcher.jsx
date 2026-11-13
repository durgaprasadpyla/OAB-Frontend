import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { usersApi } from '../api.js';
import { ROLE_LABEL, landingPath } from '../lib/roles.js';

// The role list rarely changes; read it once per page load, not once per badge mount
// (the badge remounts when a view-as switch swaps the ops header for a role bar).
let cachedRoles = null;

/** Display name for a role code the server sent; falls back to the code itself. */
export function roleLabel(r) {
  if (ROLE_LABEL[r]) return ROLE_LABEL[r];
  const s = String(r || '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * The header's user badge. For everyone it is the plain "👤 user (Role)" badge it has
 * always been. For a signed-in Super Admin the SAME badge becomes a dropdown trigger
 * listing every role the server reports (GET /api/admin/users/roles); picking one
 * renders the app as that role — its landing page, menus and screens — WITHOUT
 * re-authenticating: the JWT, user and stored role are untouched, so the backend still
 * authorises every request as the Super Admin. Picking Super Admin returns home.
 *
 * `variant`: 'hdr' (the white ops header, uses .hbadge) or 'bar' (a coloured
 * single-role bar; `dark` says whether that bar's text is white).
 */
export default function RoleSwitcher({ variant = 'hdr', dark = true }) {
  const { user, role, realRole, viewAs, setViewAs } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState(cachedRoles);   // null = not loaded yet
  const [err, setErr] = useState('');
  const wrap = useRef(null);
  // Phones: the menu goes full-width (fixed), anchored just under wherever the badge
  // actually sits — a coloured role bar wraps to two lines on a narrow screen.
  const [phoneTop, setPhoneTop] = useState(null);

  const isSuper = realRole === 'superadmin';
  const label = viewAs
    ? `Viewing as ${roleLabel(viewAs)}`
    : (ROLE_LABEL[role] ? ROLE_LABEL[role] : '');

  async function load() {
    setErr('');
    try {
      const list = await usersApi.roles();
      cachedRoles = (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? x : x && x.role)).filter(Boolean);
      setRoles(cachedRoles);
    } catch (e) {
      setErr(e.message || 'Could not load roles');
    }
  }

  // Lazy: the list is read the first time the dropdown opens, not on every page load.
  useEffect(() => { if (open && roles == null && !err) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on a click/tap outside, or Escape.
  useEffect(() => {
    if (!open) { setPhoneTop(null); return undefined; }
    const place = () => {
      const el = wrap.current;
      setPhoneTop(el && window.innerWidth <= 600 ? Math.round(el.getBoundingClientRect().bottom + 6) : null);
    };
    place();
    window.addEventListener('resize', place);
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const badgeText = `👤 ${user}${label ? ' (' + label + ')' : ''}`;

  const barStyle = variant === 'bar' ? {
    fontSize: 12, padding: '4px 10px', borderRadius: 20, fontWeight: 600,
    background: dark ? 'rgba(255,255,255,.15)' : '#eef3fb',
    color: dark ? '#fff' : '#123a6b',
    border: '1px solid ' + (dark ? 'rgba(255,255,255,.4)' : '#cfd8e3'),
  } : undefined;

  if (!isSuper) {
    // Unchanged for every other role.
    return variant === 'bar' ? null : <span className="hbadge ok">{badgeText}</span>;
  }

  function pick(r) {
    setOpen(false);
    setViewAs(r);
    nav(landingPath(r), { replace: false });
  }

  const current = viewAs || 'superadmin';

  return (
    <div ref={wrap} className="role-sw" style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={variant === 'hdr' ? 'hbadge ok role-sw-btn' : 'role-sw-btn'}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, font: 'inherit', fontSize: barStyle ? 12 : 11, ...barStyle,
          ...(viewAs && variant === 'hdr' ? { background: '#fff4e0', borderColor: '#f0c27a', color: '#8a5300' } : null) }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch the role you are viewing the app as"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{badgeText}</span>
        <span aria-hidden="true" className={'role-sw-arrow' + (open ? ' up' : '')}>▾</span>
      </button>

      {open && (
        <div className="role-sw-menu" role="listbox" aria-label="View as role"
          style={phoneTop != null ? { position: 'fixed', top: phoneTop, left: 16, right: 16, minWidth: 0, maxWidth: 'none', maxHeight: `calc(100vh - ${phoneTop + 16}px)` } : undefined}>
          <div className="role-sw-head">View the app as</div>
          {err ? (
            <div className="role-sw-msg">
              ⚠ {err} <button type="button" className="btn btn-s" style={{ height: 22, fontSize: 11, marginLeft: 6 }} onClick={load}>Retry</button>
            </div>
          ) : roles == null ? (
            <div className="role-sw-msg">Loading roles…</div>
          ) : roles.length === 0 ? (
            <div className="role-sw-msg">No roles available</div>
          ) : roles.map((r) => {
            const sel = r === current;
            return (
              <button
                key={r}
                type="button"
                role="option"
                aria-selected={sel}
                className={'role-sw-opt' + (sel ? ' on' : '')}
                onClick={() => pick(r)}
              >
                <span className="role-sw-check" aria-hidden="true">{sel ? '✓' : ''}</span>
                <span className="role-sw-name">{roleLabel(r)}</span>
                {r === 'superadmin'
                  ? <span className="role-sw-tag">your dashboard</span>
                  : <span className="role-sw-code">{r}</span>}
              </button>
            );
          })}
          {viewAs ? (
            <button type="button" className="role-sw-back" onClick={() => pick('superadmin')}>
              ↩ Back to Super Admin
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
