import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API_BASE } from './config.js';

// Auth state persisted under the SAME localStorage keys the legacy app uses
// (blm_token/blm_user/blm_role), so a single sign-in works for both the native
// screens and the embedded legacy screens.
const AuthContext = createContext(null);

// Super Admin "view as role". A UI preference ONLY: the token, blm_user and blm_role
// are never touched, so every request still carries the Super Admin's own JWT and the
// backend authorises it exactly as before. Kept per browser tab (sessionStorage) and
// honoured only while the server-confirmed role is superadmin.
const VIEW_AS_KEY = 'blm_view_as';
function readViewAs() {
  try { return sessionStorage.getItem(VIEW_AS_KEY) || ''; } catch { return ''; }
}
function writeViewAs(r) {
  try { if (r) sessionStorage.setItem(VIEW_AS_KEY, r); else sessionStorage.removeItem(VIEW_AS_KEY); } catch { /* storage blocked */ }
}

function read() {
  return {
    token: localStorage.getItem('blm_token') || '',
    user: localStorage.getItem('blm_user') || '',
    role: localStorage.getItem('blm_role') || '',
    // Deliberately NOT persisted: the server re-asserts it on every /api/auth/me,
    // so it can never be cleared by editing localStorage.
    mustChangePassword: false,
    repId: localStorage.getItem('blm_rep_id') || '',
    repName: localStorage.getItem('blm_rep_name') || '',
    viewAs: readViewAs(),
  };
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(read);

  const login = useCallback(async (username, password) => {
    const res = await fetch(API_BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error('Invalid username or password');
    const d = await res.json();
    localStorage.setItem('blm_token', d.token);
    localStorage.setItem('blm_user', d.username);
    localStorage.setItem('blm_role', d.role);
    writeViewAs('');
    setAuth({ token: d.token, user: d.username, role: d.role, mustChangePassword: !!d.mustChangePassword, viewAs: '' });
    return d;
  }, []);

  /**
   * Sales Rep sign-in. A separate endpoint from staff login: reps live in the
   * module-12 blob (`sales_users`), not the `app_user` table, and the server
   * issues them a 'sales' JWT. `repId` is what every per-category allocation in
   * the sales blob is keyed by, so it is kept alongside the token.
   */
  const repLogin = useCallback(async (username, password) => {
    const res = await fetch(API_BASE + '/api/auth/sales-rep-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error('Invalid username or password');
    const d = await res.json();
    localStorage.setItem('blm_token', d.token);
    localStorage.setItem('blm_user', d.username);
    localStorage.setItem('blm_role', 'sales');
    localStorage.setItem('blm_rep_id', d.repId || '');
    localStorage.setItem('blm_rep_name', d.display_name || d.username);
    writeViewAs('');
    setAuth({ token: d.token, user: d.username, role: 'sales', repId: d.repId || '', repName: d.display_name || d.username, mustChangePassword: false, viewAs: '' });
    return d;
  }, []);

  const logout = useCallback(() => {
    ['blm_token', 'blm_user', 'blm_role', 'blm_rep_id', 'blm_rep_name'].forEach(k => localStorage.removeItem(k));
    writeViewAs('');
    setAuth({ token: '', user: '', role: '', repId: '', repName: '', mustChangePassword: false, viewAs: '' });
  }, []);

  useEffect(() => {
    const onExpired = () => logout();
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [logout]);

  // Validate the stored token on load and take the role/user the SERVER reports as
  // authoritative — localStorage can be stale (role changed) or tampered (blm_role
  // edited to see other tabs). An invalid/expired token (401/403) logs out; a network
  // blip leaves the stored session intact rather than bouncing the user on a hiccup.
  useEffect(() => {
    const token = localStorage.getItem('blm_token');
    if (!token) return;
    let cancelled = false;
    (async () => {
      let res;
      try {
        res = await fetch(API_BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
      } catch {
        return;   // backend unreachable — keep the session; data calls will surface errors
      }
      if (cancelled) return;
      if (res.ok) {
        const d = await res.json().catch(() => null);
        if (d && (d.role || d.username)) {
          localStorage.setItem('blm_user', d.username);
          localStorage.setItem('blm_role', d.role);
          // A view-as choice survives only while the server still says superadmin.
          if (d.role !== 'superadmin') writeViewAs('');
          setAuth((a) => ({ ...a, user: d.username, role: d.role, mustChangePassword: !!d.mustChangePassword,
            viewAs: d.role === 'superadmin' ? a.viewAs : '' }));
        }
      } else if (res.status === 401 || res.status === 403) {
        logout();
      }
    })();
    return () => { cancelled = true; };
  }, [logout]);

  /** Cleared once the user completes a forced change, without another round trip. */
  const passwordChanged = useCallback(() => setAuth((a) => ({ ...a, mustChangePassword: false })), []);

  /**
   * Super Admin only: render the app as another role ('' or 'superadmin' = back to
   * their own view). Ignored for every other role. Does not re-authenticate.
   */
  const setViewAs = useCallback((r) => {
    setAuth((a) => {
      if (a.role !== 'superadmin') return a;
      const next = r && r !== 'superadmin' ? String(r) : '';
      writeViewAs(next);
      return { ...a, viewAs: next };
    });
  }, []);

  // `role` is the EFFECTIVE role every screen gates on (the viewed role while a Super
  // Admin is viewing as one); `realRole` is always the signed-in identity's role.
  const realRole = auth.role;
  const viewAs = realRole === 'superadmin' ? auth.viewAs || '' : '';
  const role = viewAs || realRole;

  return (
    <AuthContext.Provider value={{ ...auth, role, realRole, viewAs, setViewAs, isAuthed: !!auth.token, login, repLogin, logout, passwordChanged }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
