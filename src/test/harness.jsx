import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider, KEY_TO_ID } from '../data.jsx';

const ID_TO_KEY = Object.fromEntries(Object.entries(KEY_TO_ID).map(([k, v]) => [v, k]));

function res(status, body, json = true) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? (json ? 'application/json' : 'text/plain') : null) },
    json: async () => body,
    text: async () => (json ? JSON.stringify(body) : String(body ?? '')),
  };
}

/**
 * Installs a fetch mock that serves the 8 module blobs from `modules` and records
 * every POST upsert into `saved` (also reflecting it back into `modules` so a
 * later read sees the new value). Returns the `saved` array.
 */
export function installFetch(modules) {
  const saved = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/auth/login')) return res(200, { token: 't', username: 'superstar', role: 'user' });
    if (u.includes('/rest/v1/oab_data')) {
      if (method === 'GET') {
        const m = /id=eq\.(\d+)/.exec(u);
        const id = m ? Number(m[1]) : 0;
        const val = modules[ID_TO_KEY[id]];
        return res(200, val == null ? [] : [{ data: JSON.stringify(val) }]);
      }
      const body = JSON.parse(opts.body);
      const key = ID_TO_KEY[body.id];
      const data = JSON.parse(body.data);
      if (key) modules[key] = data;
      saved.push({ id: body.id, key, data });
      return res(201, '', false);
    }
    return res(200, {});
  };
  return saved;
}

/** Render a screen inside Router + Auth + Data providers with seeded modules. */
export function renderApp(ui, { modules = {}, role = 'user', user = 'superstar', route = '/' } = {}) {
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_user', user);
  localStorage.setItem('blm_role', role);
  const mods = JSON.parse(JSON.stringify(modules));
  const saved = installFetch(mods);
  const utils = render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <DataProvider>{ui}</DataProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  return { ...utils, saved, mods };
}

/** Convenience: an OAB module seeded with the given SF/OT rows. */
export function oabModule({ SF = [], OT = [], INV_REG = [], lastSO = { y: '26', n: 400 }, lastInvNo = 222 } = {}) {
  return { OAB: { SF, OT }, INV_REG, lastSO, lastInvNo };
}
