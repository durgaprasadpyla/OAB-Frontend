import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// JssPlanningPanel reads the spec list from useData(); mock it so the test doesn't
// need the whole DataProvider + blob fetch machinery.
vi.mock('../data.jsx', () => ({
  useData: () => ({ mods: { jss: [{ spec: 'A1', jobName: 'Stay Fresh 100g' }] } }),
}));

import JssPlanningPanel from '../components/JssPlanningPanel.jsx';

// Stateful fetch mock: PUT /config updates the stored config; GET /A1 reflects it,
// auto-resolving the route from the dispatch type (Pouch -> route 200 -> Printing, Pouching).
function installFetch() {
  let cfg = { dispatchTypeId: null, routeId: null };
  const routeDeps = (routeId) => (routeId === 200
    ? [{ seq: 1, departmentId: 1, departmentName: 'Printing' }, { seq: 2, departmentId: 5, departmentName: 'Pouching' }]
    : []);
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url); const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing' }, { id: 5, name: 'Pouching' }]);
    if (u.includes('/api/master/machines')) return res([
      { id: 10, code: 'CIFLEXO', name: 'CI Flexo', departmentId: 1, defaultSpeed: 300 },
      { id: 11, code: 'ROTOMAG', name: 'Rotomag', departmentId: 1, defaultSpeed: 280 },
      { id: 12, code: 'POUCH1', name: 'Pouching 1', departmentId: 5 },
    ]);
    if (u.includes('/api/master/dispatch-types')) return res([{ id: 100, name: 'Pouch', defaultRouteId: 200 }]);
    if (u.includes('/api/master/routes')) return res([{ id: 200, name: 'Print-Pouch' }]);
    if (u.includes('/api/master/items')) return res([{ id: 1000, code: 'FILM', name: 'Film XYZ' }]);

    if (u.match(/\/api\/jss\/A1\/config$/) && method === 'PUT') {
      cfg = {
        dispatchTypeId: body.dispatchTypeId ?? null,
        routeId: body.routeId !== undefined ? body.routeId : (body.dispatchTypeId === 100 ? 200 : null),
      };
      return res({ specCode: 'A1', ...cfg });
    }
    if (u.match(/\/api\/jss\/A1\/route-departments$/)) return res(routeDeps(cfg.routeId));
    if (u.match(/\/api\/jss\/A1$/)) return res({
      specCode: 'A1',
      config: { specCode: 'A1', dispatchTypeId: cfg.dispatchTypeId, dispatchTypeName: cfg.dispatchTypeId ? 'Pouch' : null, routeId: cfg.routeId, routeName: cfg.routeId ? 'Print-Pouch' : null },
      routeDepartments: routeDeps(cfg.routeId),
      machines: [],
    });
    if (u.match(/\/api\/bom\/A1$/)) return res({ specCode: 'A1', baseQty: 1, baseUom: null, items: [] });
    return res({});
  });
}

describe('JssPlanningPanel', () => {
  beforeEach(() => installFetch());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('auto-selects the route (and its departments) when a dispatch type is chosen', async () => {
    render(<JssPlanningPanel />);

    // pick the JSS spec (the only combobox before a spec is chosen)
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'A1' } });

    // the dispatch/route card appears
    await waitFor(() => expect(screen.getByText('Dispatch Type & Route')).toBeInTheDocument());

    // choose the dispatch type (the combobox that has a "Pouch" option)
    const dispatch = screen.getAllByRole('combobox').find((c) => within(c).queryByRole('option', { name: 'Pouch' }));
    expect(dispatch).toBeTruthy();
    fireEvent.change(dispatch, { target: { value: '100' } });

    // route auto-resolves -> its ordered departments show (in the config chips, the
    // machine section and the BOM section, so they appear more than once)
    await waitFor(() => expect(screen.getAllByText(/1\. Printing/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/2\. Pouching/).length).toBeGreaterThan(0);

    // machines for the Printing department are listed (multi-machine)
    expect(screen.getByText(/CI Flexo/)).toBeInTheDocument();
    expect(screen.getByText(/Rotomag/)).toBeInTheDocument();

    // the config PUT was actually sent
    const putCalls = globalThis.fetch.mock.calls.filter(([u, o]) => String(u).endsWith('/api/jss/A1/config') && (o?.method || '').toUpperCase() === 'PUT');
    expect(putCalls.length).toBeGreaterThanOrEqual(1);
  });
});
