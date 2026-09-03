import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// Issues 2.4 — the client-side items in that document.
//
//   §2  saving a BOM must not leave every row reading "Any / Any / Any"
//   §4  PLAN's Partial box is metres, so it is bounded by the order's METRES
//   §6  the PPC board puts the machines above the pool of sale orders
//   §5  …and lets the PPC type a job's real start time
//   §9-13 the GRN receives one supplier's material, with a picked rack and a
//         read-only UOM, and the PO number is just a note
//   §14 the stock filters narrow each other instead of listing everything

vi.mock('../lib/xlsx.js', () => ({ exportAOA: vi.fn(), exportObjects: vi.fn() }));
vi.mock('../lib/pdf.js', () => ({ elementToPDF: vi.fn(async () => {}), printElement: vi.fn() }));

const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

// ── §2 the BOM row keeps its identity ──────────────────────────────────────

describe('QC BOM row — Material Type / Sub-Group / Specialty (§2)', () => {
  const ITEMS = [
    { id: 7, code: 'BLM306', name: '700', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'Surface', microns: '51', uom: 'KG', departmentId: 1 },
    { id: 8, code: 'BLM146', name: 'NC 806 MAGENTA', materialType: 'INK', subGroup: 'Flexo', specialtyName: '', microns: '', uom: 'KG', departmentId: 1 },
  ];
  const JSS = {
    spec: 'A1339',
    config: { routeId: 1, dispatchTypeId: 1 },
    machines: [{ machineId: 5, departmentId: 1, eligible: true }],
    routeDepartments: [{ departmentId: 1, departmentName: 'Printing', seq: 1 }],
  };

  function install(bomItems) {
    vi.doMock('../data.jsx', () => ({
      useData: () => ({ mods: { jss: [{ spec: 'A1339', jobName: 'Pouch', customer: 'Acme', dispatchForm: 'Pouch', width: 250, height: 350 }], customers: [] }, save: vi.fn() }),
    }));
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/api/master/items')) return res(ITEMS);
      if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing' }]);
      if (u.includes('/api/master/machines')) return res([{ id: 5, code: 'CI', name: 'CI Flexo', departmentId: 1 }]);
      if (u.includes('/api/master/dispatch-types')) return res([{ id: 1, name: 'Pouch' }]);
      if (u.includes('/api/master/routes')) return res([{ id: 1, name: 'R', dispatchTypeId: 1, stages: [{ departmentId: 1, departmentName: 'Printing', seq: 1 }] }]);
      if (u.includes('/api/bom/')) return res({ baseQty: 10000, baseUom: 'Pouches', items: bomItems });
      if (u.includes('/api/jss/')) return res(JSS);
      if ((opts.method || 'GET') !== 'GET') return res({});
      return res([]);
    });
  }

  it('shows the saved line as the item really is, not as "Any"', async () => {
    // Exactly what comes back from the server after a save: ids and quantities,
    // with no trace of the filters the operator used to find the item.
    install([{ departmentId: 1, itemId: 7, qtyPerBase: 79.19, uom: 'KG' }]);
    const { default: JssPlanningPanel } = await import('../components/JssPlanningPanel.jsx');
    render(<JssPlanningPanel />);
    fireEvent.change(await screen.findByLabelText('JSS Spec'), { target: { value: 'A1339' } });

    const mat = await screen.findByLabelText('Material type for Printing row');
    await waitFor(() => expect(mat).toHaveValue('FILM'));
    expect(screen.getByLabelText('Sub group for Printing row')).toHaveValue('AF BOPP');
    expect(screen.getByLabelText('Specialty for Printing row')).toHaveValue('Surface');
  });

  it('falls back to the filter only while no item is chosen', async () => {
    install([]);
    const { default: JssPlanningPanel } = await import('../components/JssPlanningPanel.jsx');
    render(<JssPlanningPanel />);
    fireEvent.change(await screen.findByLabelText('JSS Spec'), { target: { value: 'A1339' } });
    fireEvent.click(await screen.findByRole('button', { name: /Add item/ }));
    const mat = await screen.findByLabelText('Material type for Printing row');
    expect(mat).toHaveValue('');
    fireEvent.change(mat, { target: { value: 'FILM' } });
    expect(mat).toHaveValue('FILM');
  });
});

// ── §4 PLAN's Partial box is metres ────────────────────────────────────────

describe('PLAN readiness — Partial is in metres (§4)', () => {
  // 50,600 pouches at 250 mm each = 12,650 metres — the numbers from the report.
  const MODS = {
    oab: { OAB: { SF: [{ so: 'SO-1', spec: 'A1339', customer: 'Acme', jobName: 'Pouch A', poQty: 50600, closed: false }], OT: [] } },
    jss: [{ spec: 'A1339', jobName: 'Pouch A', customer: 'Acme', dispatchForm: 'Pouch', width: 250, height: 350, material: 'AF-BOPP', filmWidth: 700, mic: 51, gsm: 46.41, pouchWeight: 7.9188 }],
    customers: [],
  };

  beforeEach(() => {
    vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: MODS, save: vi.fn() }) }));
    globalThis.fetch = vi.fn(async () => res([]));
  });

  it('offers the order’s metres, not its pouch count', async () => {
    const { default: PlanReadiness } = await import('../pages/PlanReadiness.jsx');
    render(<PlanReadiness />);
    const pick = await screen.findByLabelText('Readiness for SO-1');
    fireEvent.change(pick, { target: { value: 'READY' } });
    fireEvent.change(await screen.findByLabelText('Ready mode for SO-1'), { target: { value: 'PARTIAL' } });

    const box = await screen.findByLabelText('Metres ready for SO-1');
    // 50,600 is the number of pouches; the order runs to 12,650 metres.
    expect(box.getAttribute('placeholder')).toContain('12,650');
    expect(box.getAttribute('placeholder')).not.toContain('50600');
    expect(box).toHaveAttribute('max', '12650');
  });

  it('refuses more metres than the order runs to', async () => {
    const { default: PlanReadiness } = await import('../pages/PlanReadiness.jsx');
    render(<PlanReadiness />);
    fireEvent.change(await screen.findByLabelText('Readiness for SO-1'), { target: { value: 'READY' } });
    fireEvent.change(await screen.findByLabelText('Ready mode for SO-1'), { target: { value: 'PARTIAL' } });
    fireEvent.change(await screen.findByLabelText('Metres ready for SO-1'), { target: { value: '20000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/cannot exceed the 12,650 m/)).toBeTruthy();
  });
});

// ── §9-§13 the GRN ─────────────────────────────────────────────────────────

describe('Stores GRN (§9-§13)', () => {
  const ITEMS = [
    { id: 1, code: 'BLM031', name: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '51', uom: 'KG' },
    { id: 2, code: 'BLM999', name: 'Other film', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '35', uom: 'KG' },
  ];
  const PURCHASE = {
    pos: [{ poNum: 'PO-1', supplier: 'Cosmo Films', items: [] }],
    asl: [
      { itemCode: 'BLM031', company: 'Cosmo Films' },
      { itemCode: 'BLM999', company: 'Jindal Poly' },
    ],
  };

  beforeEach(() => {
    vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: PURCHASE }, save: vi.fn() }) }));
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/api/master/items')) return res(ITEMS);
      if (u.includes('/api/stores/locations')) return res([{ id: 1, name: 'A2', active: true }, { id: 2, name: 'CG', active: true }]);
      if (u.includes('/api/stores/grns')) return res([]);
      return res([]);
    });
  });

  async function renderGrn() {
    const { default: Stores } = await import('../pages/Stores.jsx');
    render(<Stores />);
    fireEvent.click(await screen.findByText('📥 GRN'));   // the tabs are divs, not buttons
    return screen.findByLabelText('Supplier');
  }

  it('picks the supplier from a list instead of typing it (§9)', async () => {
    const sup = await renderGrn();
    expect(sup.tagName).toBe('SELECT');
    expect(within(sup).getByRole('option', { name: 'Cosmo Films' })).toBeTruthy();
    expect(within(sup).getByRole('option', { name: 'Jindal Poly' })).toBeTruthy();
  });

  it('takes the PO as an optional note, not a dropdown (§10)', async () => {
    await renderGrn();
    const po = screen.getByLabelText('Purchase order');
    expect(po.tagName).toBe('INPUT');
    expect(po).not.toBeRequired();
    expect(screen.getByText(/\(optional\)/)).toBeTruthy();
  });

  it('offers only the chosen supplier’s items (§12)', async () => {
    const sup = await renderGrn();
    // Issues 3.0: the item is typed (by code or name) against a datalist, not picked
    // out of a select — so the offered set is the datalist's options.
    const item = () => screen.getByLabelText('Item for line 1');
    const offered = () => [...document.querySelectorAll('#grn-items-0 option')].map((o) => o.value);
    expect(item()).toBeDisabled();                       // nothing to receive until a supplier is named

    fireEvent.change(sup, { target: { value: 'Cosmo Films' } });
    await waitFor(() => expect(item()).not.toBeDisabled());
    expect(offered().join('|')).toContain('BLM031');
    expect(offered().join('|')).not.toContain('BLM999');

    fireEvent.change(sup, { target: { value: 'Jindal Poly' } });
    await waitFor(() => expect(offered().join('|')).toContain('BLM999'));
    expect(offered().join('|')).not.toContain('BLM031');
  });

  it('has no supplier column on the line — one GRN, one supplier (§12)', async () => {
    await renderGrn();
    expect(screen.queryByLabelText('Supplier for line 1')).toBeNull();
  });

  it('fills the UOM from the item master and will not let it be edited (§11)', async () => {
    const sup = await renderGrn();
    fireEvent.change(sup, { target: { value: 'Cosmo Films' } });
    // typed by CODE — the thing the desk reads off the carton
    fireEvent.change(screen.getByLabelText('Item for line 1'), { target: { value: 'BLM031' } });
    const uom = screen.getByLabelText('UOM line 1');
    await waitFor(() => expect(uom).toHaveValue('KG'));
    expect(uom).toHaveAttribute('readonly');
  });

  it('puts material away in a rack from the Super Admin’s list (§13)', async () => {
    await renderGrn();
    const loc = await screen.findByLabelText('Location line 1');
    await waitFor(() => expect(loc.tagName).toBe('SELECT'));
    expect(within(loc).getByRole('option', { name: 'A2' })).toBeTruthy();
    expect(within(loc).getByRole('option', { name: 'CG' })).toBeTruthy();
  });
});

// ── §14 the stock filters narrow each other ────────────────────────────────

describe('Stores — Raw Material on Hand filters (§14)', () => {
  const ON_HAND = [
    { id: 1, code: 'BLM031', name: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '51', departmentName: 'Printing', closingStock: 0, uom: 'KG' },
    { id: 2, code: 'BLM034', name: '680 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '35', departmentName: 'Printing', closingStock: 0, uom: 'KG' },
    { id: 3, code: 'INK001', name: 'Cyan', materialType: 'INK', subGroup: 'Flexo', specialtyName: '', microns: '100', departmentName: 'Printing', closingStock: 0, uom: 'KG' },
    { id: 4, code: 'ADH001', name: 'Glue', materialType: 'CHEM', subGroup: 'Adhesive', specialtyName: '', microns: '12', departmentName: 'Lamination', closingStock: 0, uom: 'KG' },
  ];

  beforeEach(() => {
    vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: {} }, save: vi.fn() }) }));
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
      if (u.includes('/api/stores/msl-suggestions')) return res([]);
      return res([]);
    });
  });

  it('lists only the microns the chosen material and sub-group actually come in', async () => {
    const { default: Stores } = await import('../pages/Stores.jsx');
    render(<Stores />);
    const mic = await screen.findByLabelText('Filter by microns');
    // Unfiltered, every micron is on offer — sorted as numbers, not as text.
    await waitFor(() => expect(within(mic).getAllByRole('option').length).toBe(5));
    expect([...mic.options].slice(1).map((o) => o.value)).toEqual(['12', '35', '51', '100']);

    fireEvent.change(screen.getByLabelText('Filter by material'), { target: { value: 'FILM' } });
    fireEvent.change(screen.getByLabelText('Filter by sub-group'), { target: { value: 'AF BOPP' } });

    await waitFor(() => expect([...mic.options].slice(1).map((o) => o.value)).toEqual(['35', '51']));
    expect(within(mic).queryByRole('option', { name: '100' })).toBeNull();
  });

  it('keeps the value already chosen in its own list', async () => {
    const { default: Stores } = await import('../pages/Stores.jsx');
    render(<Stores />);
    const mic = await screen.findByLabelText('Filter by microns');
    await waitFor(() => expect(within(mic).queryByRole('option', { name: '100' })).toBeTruthy());
    fireEvent.change(mic, { target: { value: '100' } });
    // Narrowing to FILM would drop 100 from the list; the box must not silently clear.
    fireEvent.change(screen.getByLabelText('Filter by material'), { target: { value: 'FILM' } });
    await waitFor(() => expect(mic).toHaveValue('100'));
  });
});

// ── §5/§6 the PPC daily board ──────────────────────────────────────────────

describe('PPC daily board (§5, §6)', () => {
  const TODAY = new Date().toISOString().slice(0, 10);
  const JOBS = [
    { id: 11, so: '26/697', specCode: 'A1339', machineId: 1, machineName: 'CI Flexo', departmentId: 1, departmentName: 'Printing',
      planDate: TODAY, shift: 'A', seqOrder: 1, plannedQty: 2000, estMinutes: 98, startTime: '08:00', endTime: '09:38', startMin: null, status: 'Planned' },
    { id: 12, so: '26/697', specCode: 'A1339', machineId: 2, machineName: 'StayFresh 1', departmentId: 2, departmentName: 'StayFresh',
      planDate: TODAY, shift: 'A', seqOrder: 1, plannedQty: 2000, estMinutes: 77, startTime: '09:38', endTime: '10:55', startMin: 578, status: 'Planned' },
  ];
  let posted;

  beforeEach(() => {
    posted = [];
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      if ((opts.method || 'GET') === 'POST') { posted.push({ url: u, body: JSON.parse(opts.body || '{}') }); return res({}); }
      if (u.includes('/api/planning/pool')) return res([{ so: '26/697', spec: 'A1339', jobName: 'Pouch A', poQty: 20000, readyMode: 'COMPLETE', readyQty: 20000, fullyPlanned: false }]);
      if (u.includes('/api/master/machines')) return res([
        { id: 1, code: 'CI', name: 'CI Flexo', departmentId: 1, functionalHoursPerDay: 8 },
        { id: 2, code: 'SF1', name: 'StayFresh 1', departmentId: 2, functionalHoursPerDay: 22 }]);
      if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing' }, { id: 2, name: 'StayFresh' }]);
      if (u.includes('/api/planning/week')) return res({ jobs: JOBS, capacity: [] });
      return res([]);
    });
  });

  it('puts the machines above the pool of sale orders (§6)', async () => {
    const { default: DailyBoard } = await import('../pages/DailyBoard.jsx');
    const { container } = render(<DailyBoard embedded />);
    await screen.findByText('Printing');
    // The pool and the machine column live in one stacked container; CSS `order`
    // decides which is read first, and the machines must be first.
    const pool = screen.getByText('Ready to Plan').closest('.card');
    const machines = screen.getByText('Printing').closest('div[style]');
    expect(pool.style.order).toBe('2');
    expect(container.querySelector('div[style*="order: 1"]')).toBeTruthy();
    expect(machines).toBeTruthy();
    // …and the tip points the operator upwards, not sideways.
    expect(screen.getByText(/drag a card straight up onto a machine/)).toBeTruthy();
  });

  it('lets the PPC type a job’s real start time (§5)', async () => {
    const { default: DailyBoard } = await import('../pages/DailyBoard.jsx');
    render(<DailyBoard embedded />);
    const box = await screen.findByLabelText('Start time for 26/697 on CI');
    expect(box).toHaveValue('08:00');

    fireEvent.blur(box, { target: { value: '10:15' } });
    await waitFor(() => expect(posted.some((p) => p.url.includes('/api/planning/job-start'))).toBe(true));
    const call = posted.find((p) => p.url.includes('/api/planning/job-start'));
    expect(call.body).toEqual({ jobId: 11, startTime: '10:15' });
  });

  it('marks a job whose start the PPC set, and clears it back to the queue (§5)', async () => {
    const { default: DailyBoard } = await import('../pages/DailyBoard.jsx');
    render(<DailyBoard embedded />);
    const sf = await screen.findByLabelText('Start time for 26/697 on SF1');
    expect(sf).toHaveValue('09:38');
    expect(within(sf.closest('div')).getByText('set')).toBeTruthy();   // it was set by hand

    fireEvent.blur(sf, { target: { value: '' } });
    await waitFor(() => expect(posted.some((p) => p.url.includes('/api/planning/job-start'))).toBe(true));
    expect(posted.find((p) => p.url.includes('/api/planning/job-start')).body.startTime).toBe('');
  });
});

// ── §8 the plan, department by department ──────────────────────────────────

describe('PLAN login — department-wise plan download (§8)', () => {
  const JOBS = [
    { id: 1, so: '26/697', specCode: 'A1339', machineName: 'CI Flexo', departmentName: 'Printing', planDate: '2026-09-02', shift: 'A', plannedQty: 2000, estMinutes: 98, startTime: '08:00', endTime: '09:38', status: 'Planned', changed: false },
    { id: 2, so: '26/697', specCode: 'A1339', machineName: 'StayFresh 1', departmentName: 'StayFresh', planDate: '2026-09-02', shift: 'A', plannedQty: 2000, estMinutes: 77, startTime: '09:38', endTime: '10:55', status: 'Planned', changed: true },
  ];

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/planning/week')) return res({ jobs: JOBS, capacity: [] });
      return res([]);
    });
  });

  it('writes one section per department, from the PPC’s plan', async () => {
    const { exportAOA } = await import('../lib/xlsx.js');
    const { default: PlanDownloads } = await import('../components/PlanDownloads.jsx');
    render(<PlanDownloads />);
    fireEvent.click(screen.getByRole('button', { name: '⬇ Day by Department' }));

    await waitFor(() => expect(exportAOA).toHaveBeenCalledTimes(1));
    const [aoa, name, sheet] = exportAOA.mock.calls[0];
    const flat = aoa.map((r) => (r || []).join('|'));
    expect(flat[0]).toContain('Department-wise production plan');
    expect(flat.some((l) => l === 'Printing')).toBe(true);
    expect(flat.some((l) => l === 'StayFresh')).toBe(true);
    expect(flat.some((l) => l.includes('CI Flexo') && l.includes('08:00'))).toBe(true);
    expect(flat.some((l) => l.includes('CHANGED'))).toBe(true);
    expect(sheet).toBe('Plan by Department');
    expect(name).toContain('Department_Plan');
  });

  it('can hand the same document to the floor as a PDF', async () => {
    const { elementToPDF } = await import('../lib/pdf.js');
    const { default: PlanDownloads } = await import('../components/PlanDownloads.jsx');
    render(<PlanDownloads />);
    fireEvent.change(screen.getByLabelText('Department-wise plan format'), { target: { value: 'pdf' } });
    fireEvent.click(screen.getByRole('button', { name: '⬇ Week by Department' }));

    await waitFor(() => expect(elementToPDF).toHaveBeenCalledTimes(1));
    const [node] = elementToPDF.mock.calls[0];
    expect(node.innerHTML).toContain('Printing');
    expect(node.innerHTML).toContain('StayFresh');
    expect(document.body.contains(node)).toBe(false);
  });
});
