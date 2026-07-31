// Minimal API client. Paths are prefixed with API_BASE (empty = same-origin in the
// bundled build; set VITE_API_BASE to run the frontend on its own origin). Vite also
// proxies /api and /rest to the backend in dev. Attaches the JWT and signals a global
// 'auth:expired' event on 401 so the app can bounce to login.
import { API_BASE } from './config.js';

export function getToken() {
  try { return localStorage.getItem('blm_token') || ''; } catch { return ''; }
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(API_BASE + path, opts);
  if (res.status === 401) {
    try { localStorage.removeItem('blm_token'); } catch {}
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new Error('Session expired — please sign in again.');
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

// Column values come back lowercase from MySQL and uppercase from H2 — read either.
export function field(row, key) {
  if (row == null) return '';
  const v = row[key] ?? row[key.toUpperCase()];
  return v == null ? '' : v;
}
