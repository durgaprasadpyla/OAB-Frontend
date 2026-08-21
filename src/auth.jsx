import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API_BASE } from './config.js';

// Auth state persisted under the SAME localStorage keys the legacy app uses
// (blm_token/blm_user/blm_role), so a single sign-in works for both the native
// screens and the embedded legacy screens.
const AuthContext = createContext(null);

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
    setAuth({ token: d.token, user: d.username, role: d.role, mustChangePassword: !!d.mustChangePassword });
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
    setAuth({ token: d.token, user: d.username, role: 'sales', repId: d.repId || '', repName: d.display_name || d.username, mustChangePassword: false });
    return d;
  }, []);

  const logout = useCallback(() => {
    ['blm_token', 'blm_user', 'blm_role', 'blm_rep_id', 'blm_rep_name'].forEach(k => localStorage.removeItem(k));
    setAuth({ token: '', user: '', role: '', repId: '', repName: '', mustChangePassword: false });
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
          setAuth((a) => ({ ...a, user: d.username, role: d.role, mustChangePassword: !!d.mustChangePassword }));
        }
      } else if (res.status === 401 || res.status === 403) {
        logout();
      }
    })();
    return () => { cancelled = true; };
  }, [logout]);

  /** Cleared once the user completes a forced change, without another round trip. */
  const passwordChanged = useCallback(() => setAuth((a) => ({ ...a, mustChangePassword: false })), []);

  return (
    <AuthContext.Provider value={{ ...auth, isAuthed: !!auth.token, login, repLogin, logout, passwordChanged }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
