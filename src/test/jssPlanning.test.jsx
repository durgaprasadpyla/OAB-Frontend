import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// JssPlanningPanel reads the spec list from useData(); mock it so the test doesn't
// need the whole DataProvider + blob fetch machinery. A1 is a legacy spec with no
// dispatch form (manual fallback); A2 carries dispatchForm 'Pouch' (Issues 1.0 #1).
vi.mock('../data.jsx', () => ({
  useData: () => ({ mods: { jss: [
    { spec: 'A1', jobName: 'Stay Fresh 100g', width: 250, height: 300, pouchWeight: 5 },
    { spec: 'A2', jobName: 'MAP Pouch 500g', dispatchForm: 'Pouch', group: 'North Group' },
  ] } }),
}));

import JssPlanningPanel from '../components/JssPlanningPanel.jsx';

// Stateful fetch mock: PUT /config updates the stored config; GET /A1 reflects it,
// auto-resolving the route from the dispatch type (Pouch -> route 200 -> Printing, Pouching).
function installFetch() {
  let cfg = { dispatchTypeId: null, routeId: null };
  let machines = [];
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
    if (u.includes('/api/master/routes')) return res([
      { id: 200, name: 'Print-Pouch', dispatchTypeId: 100, stages: [{ seq: 1, departmentId: 1, departmentName: 'Printing' }] },
      { id: 201, name: 'Print-Roll', dispatchTypeId: 100, stages: [{ seq: 1, departmentId: 1, departmentName: 'Printing' }] },
    ]);
    if (u.includes('/api/master/items')) return res([
      { id: 1000, code: 'FILM', name: 'Film XYZ', departmentId: 1, uom: 'Kgs' },
      { id: 1001, code: 'GLUE', name: 'Turbo Glue', departmentId: 5 },
      { id: 1002, code: 'MISC', name: 'Untagged Thing' },
    ]);

    if (u.includes('/api/master/items/sync-from-purchase')) return res({ created: 0, updated: 0, skipped: 0 });

    if (u.match(/\/api\/jss\/A\d\/config$/) && method === 'PUT') {
      cfg = {
        dispatchTypeId: body.dispatchTypeId ?? null,
        routeId: body.routeId !== undefined ? body.routeId : (body.dispatchTypeId === 100 ? 200 : null),
      };
      return res({ specCode: 'A1', ...cfg });
    }
    if (u.match(/\/api\/jss\/A\d\/machines$/) && method === 'PUT') {
      machines = ((Array.isArray(body) ? body : body.machines) || []).map((m) => ({ ...m }));
      return res({ saved: machines.length });
    }
    if (u.match(/\/api\/jss\/A\d\/route-departments$/)) return res(routeDeps(cfg.routeId));
    if (u.match(/\/api\/jss\/A\d$/)) return res({
      specCode: 'A1',
      config: { specCode: 'A1', dispatchTypeId: cfg.dispatchTypeId, dispatchTypeName: cfg.dispatchTypeId ? 'Pouch' : null, routeId: cfg.routeId, routeName: cfg.routeId ? 'Print-Pouch' : null },
      routeDepartments: routeDeps(cfg.routeId),
      machines,
    });
    if (u.match(/\/api\/bom\/A\d$/)) return res({ specCode: 'A1', baseQty: 1, baseUom: null, items: [] });
    return res({});
  });
}

describe('JssPlanningPanel', () => {
  beforeEach(() => installFetch());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('auto-selects the route (and its departments) when a dispatch type is chosen', async () => {
    render(<JssPlanningPanel />);

    // pick the JSS spec (the only combobox before a spec is chosen)
    await waitFor(() => expect(screen.getByLabelText('JSS Spec')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('JSS Spec'), { target: { value: 'A1' } });

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

  it('shows the Dispatch Form routes as radios and lets the QC pick one (§15)', async () => {
    render(<JssPlanningPanel />);
    await waitFor(() => expect(screen.getByLabelText('JSS Spec')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('JSS Spec'), { target: { value: 'A1' } });
    await waitFor(() => expect(screen.getByText('Dispatch Type & Route')).toBeInTheDocument());

    // pick the Dispatch Form
    const dispatch = screen.getAllByRole('combobox').find((c) => within(c).queryByRole('option', { name: 'Pouch' }));
    fireEvent.change(dispatch, { target: { value: '100' } });

    // the form's routes appear as radio choices
    await waitFor(() => expect(screen.getByRole('radio', { name: /Print-Pouch/ })).toBeInTheDocument());
    expect(screen.getByRole('radio', { name: /Print-Roll/ })).toBeInTheDocument();

    // the QC picks the second route → a config PUT with that routeId is sent
    fireEvent.click(screen.getByRole('radio', { name: /Print-Roll/ }));
    await waitFor(() => {
      const puts = globalThis.fetch.mock.calls.filter(([u, o]) => String(u).endsWith('/api/jss/A1/config') && (o?.method || '').toUpperCase() === 'PUT');
      expect(puts.some(([, o]) => JSON.parse(o.body).routeId === 201)).toBe(true);
    });
  });

  // Req #16/#17: ideal speed shows read-only, ticking a machine pre-fills the job
  // speed with it, and a per-machine setup-time field is offered and saved.
  it('pre-fills job speed with the ideal speed and saves per-machine setup time', async () => {
    render(<JssPlanningPanel />);
    await waitFor(() => expect(screen.getByLabelText('JSS Spec')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('JSS Spec'), { target: { value: 'A1' } });
    await waitFor(() => expect(screen.getByText('Dispatch Type & Route')).toBeInTheDocument());
    const dispatch = screen.getAllByRole('combobox').find((c) => within(c).queryByRole('option', { name: 'Pouch' }));
    fireEvent.change(dispatch, { target: { value: '100' } });
    await waitFor(() => expect(screen.getByText(/CI Flexo/)).toBeInTheDocument());

    // the ideal (Super Admin) speed is displayed (one header per department table)
    expect(screen.getAllByText('Ideal speed').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^300\b/).length).toBeGreaterThan(0);

    // tick CI Flexo → its job-speed input pre-fills with the ideal 300
    const row = screen.getByText(/CI Flexo/).closest('tr');
    fireEvent.click(within(row).getByRole('checkbox'));
    const speedInput = within(row).getByLabelText('Job speed for CI Flexo');
    expect(speedInput.value).toBe('300');

    // QC overrides the job speed and enters a setup time for this machine
    fireEvent.change(speedInput, { target: { value: '285' } });
    fireEvent.change(within(row).getByLabelText('Setup time for CI Flexo'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save machines' }));

    await waitFor(() => {
      const puts = globalThis.fetch.mock.calls.filter(([u, o]) => String(u).endsWith('/api/jss/A1/machines') && (o?.method || '').toUpperCase() === 'PUT');
      expect(puts.length).toBeGreaterThan(0);
      const body = JSON.parse(puts.at(-1)[1].body);
      expect(body.machines).toEqual([expect.objectContaining({ machineId: 10, speed: 285, setupMin: 30 })]);
    });
  });

  // Issues 1.0 #1 + #2 + #3: a spec that carries a dispatch form gets it READ-ONLY
  // from the JSS (auto-aligned to the matching form, no manual dropdown), the BOM
  // base UOM auto-picks from that form as a dropdown, and every machine row offers
  // a speed-unit choice defaulting by department (pcs/min for pouching).
  it('reads the dispatch form from the JSS, auto-picks the base UOM and offers speed units', async () => {
    render(<JssPlanningPanel />);
    await waitFor(() => expect(screen.getByLabelText('JSS Spec')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('JSS Spec'), { target: { value: 'A2' } });
    await waitFor(() => expect(screen.getByText('Dispatch Type & Route')).toBeInTheDocument());

    // #1: shown read-only from the JSS — and the config auto-aligns via PUT.
    expect(await screen.findByText(/Read from this spec/)).toBeInTheDocument();
    await waitFor(() => {
      const puts = globalThis.fetch.mock.calls.filter(([u, o]) => String(u).endsWith('/api/jss/A2/config') && (o?.method || '').toUpperCase() === 'PUT');
      expect(puts.some(([, o]) => JSON.parse(o.body).dispatchTypeId === 100)).toBe(true);
    });
    // no manual dispatch dropdown in this mode
    expect(screen.queryAllByRole('combobox').some((c) => within(c).queryByRole('option', { name: 'Pouch' }))).toBe(false);

    // #2: the base UOM is a dropdown, auto-picked from the Pouch dispatch form.
    const uom = await screen.findByLabelText('Base UOM');
    expect(uom.tagName).toBe('SELECT');
    await waitFor(() => expect(uom).toHaveValue('Pouches'));

    // #3: each machine row has a unit select BEFORE the ideal speed; departments
    // default correctly — Printing → m/min, Pouching → pcs/min.
    await waitFor(() => expect(screen.getByText(/CI Flexo/)).toBeInTheDocument());
    expect(screen.getByLabelText('Speed unit for CI Flexo')).toHaveValue('m/min');
    expect(screen.getByLabelText('Speed unit for Pouching 1')).toHaveValue('pcs/min');

    // ticking + saving carries the unit to the server
    const row = screen.getByText(/Pouching 1/).closest('tr');
    fireEvent.click(within(row).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save machines' }));
    await waitFor(() => {
      const puts = globalThis.fetch.mock.calls.filter(([u, o]) => String(u).endsWith('/api/jss/A2/machines') && (o?.method || '').toUpperCase() === 'PUT');
      expect(puts.length).toBeGreaterThan(0);
      const body = JSON.parse(puts.at(-1)[1].body);
      expect(body.machines).toEqual([expect.objectContaining({ machineId: 12, speedUom: 'pcs/min' })]);
    });
  });

  // QC ask (30-08): the spec picker is type-and-search — typing a code or picking
  // the "CODE — job name" suggestion opens that spec; matching is loose.
  it('opens a spec by typing into the search picker', async () => {
    render(<JssPlanningPanel />);
    const box = await screen.findByLabelText('JSS Spec');
    expect(box.tagName).toBe('INPUT');
    // the suggestion format (case-insensitive) resolves to the spec
    fireEvent.change(box, { target: { value: 'a2 — map pouch 500g' } });
    await waitFor(() => expect(screen.getByText('Dispatch Type & Route')).toBeInTheDocument());
    expect(screen.getByText(/Read from this spec/)).toBeInTheDocument();   // A2 carries 'Pouch'
    // typing away from the open spec closes it
    fireEvent.change(box, { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.queryByText('Dispatch Type & Route')).not.toBeInTheDocument());
  });

  // Issues 1.0 #4: opening the panel refreshes the normalized items from the
  // Padmin catalogue so department-tagged items reach the BOM picker.
  it('syncs the item master from the purchase catalogue on open', async () => {
    render(<JssPlanningPanel />);
    await waitFor(() => {
      const syncs = globalThis.fetch.mock.calls.filter(([u, o]) => String(u).includes('/api/master/items/sync-from-purchase') && (o?.method || '').toUpperCase() === 'POST');
      expect(syncs.length).toBe(1);
    });
  });

  // Change 11: BOM items are picked from a plain dropdown (no type-and-search).
  it('offers the department BOM items as a dropdown', async () => {
    render(<JssPlanningPanel />);
    await waitFor(() => expect(screen.getByLabelText('JSS Spec')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('JSS Spec'), { target: { value: 'A1' } });
    await waitFor(() => expect(screen.getByText('Dispatch Type & Route')).toBeInTheDocument());
    const dispatch = screen.getAllByRole('combobox').find((c) => within(c).queryByRole('option', { name: 'Pouch' }));
    fireEvent.change(dispatch, { target: { value: '100' } });

    // Issues 2.0: the BOM opens only after machines are SAVED — gate shows first.
    await waitFor(() => expect(screen.getByText(/Save the eligible machines above first|SAVE the eligible machines/i)).toBeInTheDocument());
    const cb = await screen.findAllByRole('checkbox');
    fireEvent.click(cb[0]);                                    // tick CI Flexo
    fireEvent.click(screen.getByRole('button', { name: 'Save machines' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '＋ Add item' }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole('button', { name: '＋ Add item' })[0]);
    // Type-and-search input showing NAMES (no codes), scoped to the department.
    const itemInput = await screen.findByLabelText('BOM item for Printing');
    expect(itemInput.tagName).toBe('INPUT');
    const dl = document.getElementById(itemInput.getAttribute('list'));
    const opts = [...dl.querySelectorAll('option')].map((x) => x.value);
    expect(opts).toContain('Film XYZ');          // Printing's own item, by name
    expect(opts).not.toContain('Turbo Glue');    // another department's item
    expect(opts).not.toContain('Untagged Thing');// untagged catalogue item
    expect(opts.join(' ')).not.toContain('FILM');// codes are not shown here
    // typing the name picks the item and pulls its UOM from the master
    fireEvent.change(itemInput, { target: { value: 'Film XYZ' } });
    await waitFor(() => expect(screen.getByLabelText('Line UOM (from item master)')).toHaveValue('Kgs'));
  });

  it('stage filter narrows the machines card to the selected department only', async () => {
    render(<JssPlanningPanel />);
    await waitFor(() => expect(screen.getByLabelText('JSS Spec')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('JSS Spec'), { target: { value: 'A1' } });
    await waitFor(() => expect(screen.getByText('Dispatch Type & Route')).toBeInTheDocument());
    const dispatch = screen.getAllByRole('combobox').find((c) => within(c).queryByRole('option', { name: 'Pouch' }));
    fireEvent.change(dispatch, { target: { value: '100' } });

    // All stages by default: machines from BOTH departments are visible.
    await waitFor(() => expect(screen.getByText(/CI Flexo/)).toBeInTheDocument());
    expect(screen.getByText(/Pouching 1/)).toBeInTheDocument();

    // Select Printing → only Printing machines remain.
    fireEvent.click(screen.getByLabelText('Show Printing machines'));
    expect(screen.getByText(/CI Flexo/)).toBeInTheDocument();
    expect(screen.queryByText(/Pouching 1/)).toBeNull();

    // Select Pouching → only its machine remains.
    fireEvent.click(screen.getByLabelText('Show Pouching machines'));
    expect(screen.getByText(/Pouching 1/)).toBeInTheDocument();
    expect(screen.queryByText(/CI Flexo/)).toBeNull();

    // Back to all stages restores everything.
    fireEvent.click(screen.getByRole('button', { name: 'All stages' }));
    expect(screen.getByText(/CI Flexo/)).toBeInTheDocument();
    expect(screen.getByText(/Pouching 1/)).toBeInTheDocument();
  });
  it('JSS-list group filter offers spec-carried groups even with no Customer Master (QC)', async () => {
    render(<JssPlanningPanel />);
    // the list card is visible before any spec is opened
    const grpSel = await screen.findByLabelText('Filter list by group');
    expect(within(grpSel).getByRole('option', { name: 'North Group' })).toBeTruthy();
    // filtering by it narrows the list to A2
    fireEvent.change(grpSel, { target: { value: 'North Group' } });
    expect(screen.getByText('MAP Pouch 500g')).toBeInTheDocument();
    expect(screen.queryByText('Stay Fresh 100g')).toBeNull();
  });
  it('shows the JSS pouch figures and computes metres + weight from the base qty', async () => {
    render(<JssPlanningPanel />);
    await waitFor(() => expect(screen.getByLabelText('JSS Spec')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('JSS Spec'), { target: { value: 'A1' } });
    await waitFor(() => expect(screen.getByText('Dispatch Type & Route')).toBeInTheDocument());
    const dispatch = screen.getAllByRole('combobox').find((c) => within(c).queryByRole('option', { name: 'Pouch' }));
    fireEvent.change(dispatch, { target: { value: '100' } });

    // the strip shows the spec's own numbers
    const strip = await screen.findByLabelText('JSS figures');
    expect(strip.textContent).toContain('250 mm');
    expect(strip.textContent).toContain('300 mm');
    expect(strip.textContent).toContain('5 g');

    // base qty 1000 pouches -> 1000 × 250mm / 1000 = 250 m; 1000 × 5g / 1000 = 5 kg
    const baseQty = screen.getByText('Base quantity').parentElement.querySelector('input');
    fireEvent.change(baseQty, { target: { value: '1000' } });
    const strip2 = screen.getByLabelText('JSS figures');
    expect(strip2.textContent).toContain('250 m');
    expect(strip2.textContent).toContain('5 kg');
  });
});
