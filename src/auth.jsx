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
    setAuth({ token: d.token, user: d.username, role: d.role });
    return d;
  }, []);

  const logout = useCallback(() => {
    ['blm_token', 'blm_user', 'blm_role'].forEach(k => localStorage.removeItem(k));
    setAuth({ token: '', user: '', role: '' });
  }, []);

  useEffect(() => {
    const onExpired = () => logout();
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ ...auth, isAuthed: !!auth.token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
