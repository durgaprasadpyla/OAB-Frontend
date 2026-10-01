import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { asSoMaterial, bomCapBlock, isComplete, openOf, sameUom, sourceLabel } from '../lib/soMaterial.js';

// Issues as on 30.09 — allocation, on the stores desk (Issues & Returns):
//   P1  what PLAN allocated to an order is on the stores screen, with who allocated it
//   P2  "Upon allocating a material in the plan login, that particular roll or item
//       should not be available for the stores login to issue to any other sale order."
//   P3  "He (stores) will be able to allocate that particular roll or ink tin or
//       anything to that particular sale order."
//   S2  "Here the roll should be preselected, or next to this allocation message there
//       should be a way to issue this roll — somewhere it should nudge the stores guy to
//       issue that allocated roll first and only later anything else."
//   S3  "based on the BOM quantities only, the allocation should happen … If 292 kg are
//       completed by allocating two rolls, only in such a case should he be allowed to
//       add one more roll. Upon completing the allocation … no more allocation should
//       happen from the stores login."

const res = (body, status = 200) => ({ status, ok: status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ON_HAND = [
  { id: 306, code: 'BLM306', name: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', uom: 'Kg', closingStock: 894.92, unitCount: 4, active: true },
  { id: 401, code: 'INK01', name: 'Blue', materialType: 'INK', subGroup: 'FLEXO', specialtyName: '', uom: 'Kg', closingStock: 40, unitCount: 1, active: true },
];
const CTX = { so: '26/656', found: true, spec: 'A1319', customer: 'AMAZON SELLER SERVICES', jobName: 'Poly bag', poQty: 25000,
  route: { routeName: 'SF', departments: [{ seq: 1, departmentName: 'Printing' }, { seq: 2, departmentName: 'Lamination' }] },
  bom: { found: true, baseQty: 1000, items: [
    { itemId: 306, itemCode: 'BLM306', itemName: '700 MM', departmentName: 'Printing', qtyPerBase: 12, uom: 'Kg' },
    { itemId: 401, itemCode: 'INK01', itemName: 'Blue', departmentName: 'Printing', qtyPerBase: 1, uom: 'Kg' },
  ] } };
// oldest first, as the server sends them: BLMU-600 is the oldest — and wholly promised to 26/700
const UNITS_306 = [
  { id: 600, itemId: 306, internalCode: 'BLMU-600', qtyRemaining: 200, qtyReceived: 200, widthMm: 700, uom: 'Kg', location: 'AG', status: 'MOVING',
    receivedAt: '2026-09-01T00:00:00Z', allocated: 200, allocatedTo: ['26/700'], holds: [{ so: '26/700', qty: 200, source: 'PLAN' }] },
  { id: 592, itemId: 306, internalCode: 'BLMU-592', qtyRemaining: 200, qtyReceived: 200, widthMm: 700, uom: 'Kg', location: 'AG', status: 'MOVING',
    receivedAt: '2026-09-02T00:00:00Z', allocated: 0, allocatedTo: [], holds: [] },
  { id: 593, itemId: 306, internalCode: 'BLMU-593', qtyRemaining: 194.92, qtyReceived: 194.92, widthMm: 700, uom: 'Kg', location: 'AG', status: 'MOVING',
    receivedAt: '2026-09-03T00:00:00Z', allocated: 194.92, allocatedTo: ['26/656'], holds: [{ so: '26/656', qty: 194.92, source: 'PLAN' }] },
  { id: 601, itemId: 306, internalCode: 'BLMU-601', qtyRemaining: 300, qtyReceived: 300, widthMm: 700, uom: 'Kg', location: 'AG', status: 'MOVING',
    receivedAt: '2026-09-04T00:00:00Z', allocated: 100, allocatedTo: ['26/701'], holds: [{ so: '26/701', qty: 100, source: 'STORES' }] },
];
const ALLOC_593 = { id: 1, so: '26/656', unitId: 593, itemId: 306, itemCode: 'BLM306', itemName: '700 MM', internalCode: 'BLMU-593',
  qty: 194.92, uom: 'Kg', location: 'AG', widthMm: 700, source: 'PLAN', actor: 'plan1', department: null, unitRemaining: 194.92 };
const line306 = (over = {}) => ({
  itemId: 306, itemCode: 'BLM306', itemName: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '',
  departments: ['Printing'], uom: 'Kg', qtyPerBase: 12, required: 300,
  allocated: 194.92, issued: 0, returned: 0, netIssued: 0, covered: 194.92, open: 105.08, complete: false, onBom: true, ...over,
});

let posted, mat, legacyAllocs, slipSaved, units306;
beforeEach(() => {
  posted = []; slipSaved = [];
  legacyAllocs = null;
  units306 = UNITS_306.map((u) => ({ ...u }));
  mat = { so: '26/656', spec: 'A1319', found: true, poQty: 25000, baseQty: 1000, lines: [line306()], allocations: [{ ...ALLOC_593 }], issues: [] };
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      const body = opts.body ? JSON.parse(opts.body) : {};
      posted.push({ u, method, body });
      if (u.includes('/api/stores/issues/batch')) {
        return res({ slipNo: 'ISS/2026/80', so: body.so, department: body.department, totalQty: body.lines.reduce((t, l) => t + l.qty, 0),
          lines: body.lines.map((l) => ({ unitId: l.unitId, internalCode: 'BLMU-' + l.unitId, qty: l.qty, remaining: 0 })) }, 201);
      }
      if (u.endsWith('/api/stores/allocations') && method === 'POST') {
        // the server records who allocated it — the stores desk, here
        mat.allocations = [...mat.allocations, { id: 2, so: body.so, unitId: body.unitId, itemId: 306, itemCode: 'BLM306', itemName: '700 MM',
          internalCode: 'BLMU-' + body.unitId, qty: body.qty, uom: 'Kg', location: 'AG', widthMm: 700, source: 'STORES', actor: 'store1',
          department: body.department || null, unitRemaining: 200 }];
        mat.lines = [line306({ allocated: 194.92 + body.qty, covered: 194.92 + body.qty })];
        return res({ so: body.so, unitId: body.unitId, qty: body.qty, freeAfter: 100 }, 201);
      }
      const del = /\/api\/stores\/allocations\/(\d+)$/.exec(u);
      if (del && method === 'DELETE') {
        mat.allocations = mat.allocations.filter((a) => String(a.id) !== del[1]);
        return res({ released: true });
      }
      return res({});
    }
    if (u.includes('/api/stores/so-material')) return res(legacyAllocs ? [] : mat);
    if (u.includes('/api/stores/allocations')) return res(legacyAllocs || []);
    if (u.includes('/api/stores/so-context')) return res(CTX);
    if (u.includes('/api/stores/items/306/units')) return res(units306);
    if (u.match(/\/api\/stores\/items\/\d+\/units/)) return res([]);
    if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
    if (u.includes('/api/stores/next-codes')) return res({ codes: [] });
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing', active: true }, { id: 2, name: 'Lamination', active: true }]);
    if (u.includes('/api/master/items')) return res(ON_HAND);
    if (u.includes('/api/planning/week')) return res({ jobs: [] });
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });
// Module mocks are registered right before the dynamic import that takes them: a
// doMock left queued by a test that imports nothing is picked up by the NEXT test
// file in the same worker (bom.test.jsx then rendered against this file's data mock).
function mockStoresModules() {
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: { asl: [], pos: [] }, oab: { OAB: { SF: [{ so: '26/656', spec: 'A1319', customer: 'AMAZON', closed: false }], OT: [] } } }, save: vi.fn(), reloadModule: vi.fn() }) }));
  vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ role: 'stores', user: 'store1' }) }));
  vi.doMock('../lib/issueSlipPdf.js', () => ({ saveIssueSlipPdf: vi.fn((slip) => { slipSaved.push(slip); return 'Issue_Slip.pdf'; }), buildIssueSlipPdf: vi.fn() }));
}

async function openIssues() {
  mockStoresModules();
  const { default: Stores } = await import('../pages/Stores.jsx');
  render(<Stores />);
  fireEvent.click(await screen.findByText('🔄 Issues & Returns'));
  fireEvent.change(await screen.findByLabelText('Sale order'), { target: { value: '26/656' } });
  await waitFor(() => expect([...screen.getByLabelText('Department').options].map((o) => o.value).filter(Boolean)).toEqual(['Printing', 'Lamination']));
}
async function pickItem() {
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Printing' } });
  await waitFor(() => expect([...screen.getByLabelText('Item').options].map((o) => o.value)).toContain('306'));
  fireEvent.change(screen.getByLabelText('Item'), { target: { value: '306' } });
  await waitFor(() => expect(screen.getByLabelText('Roll').options.length).toBe(5));
}
const optionText = (value) => [...screen.getByLabelText('Roll').options].find((o) => o.value === String(value)).textContent;
const slipRows = () => screen.queryAllByLabelText(/Remove BLMU-\d+ from the slip/);

/* ───────── P1 / S2: the allocation banner ───────── */

describe('Stores — the rolls allocated to an order (P1, S2)', () => {
  it('names each allocated roll with the login that allocated it, and puts it on the slip in one click', async () => {
    await openIssues();
    const banner = await screen.findByLabelText('Material allocated to 26/656');
    expect(banner).toHaveTextContent('1 roll(s) are allocated to 26/656 — issue these first');
    const row = within(banner).getByText('BLMU-593').closest('tr');
    expect(within(row).getByText('PLAN')).toBeInTheDocument();
    expect(row).toHaveTextContent('plan1');

    // S2: the way to issue it sits right beside the message
    fireEvent.click(within(banner).getByLabelText('Put BLMU-593 on the slip'));
    expect(slipRows()).toHaveLength(1);
    expect(screen.getByLabelText('Remove BLMU-593 from the slip').closest('tr')).toHaveTextContent('194.92');
    // the department comes from the order's BOM line for that item
    expect(screen.getByLabelText('Department')).toHaveValue('Printing');
    expect(within(banner).getByLabelText('Put BLMU-593 on the slip')).toHaveTextContent('✓ on slip');

    fireEvent.click(screen.getByText(/Issue & print slip/));
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/stores/issues/batch'))).toBe(true));
    expect(posted.find((p) => p.u.includes('/api/stores/issues/batch')).body)
      .toEqual({ so: '26/656', department: 'Printing', lines: [{ unitId: 593, qty: 194.92 }] });
  });

  it('shows the order’s BOM position — needs, allocated, issued, still open — with what went out', async () => {
    mat.lines = [line306({ allocated: 194.92, issued: 50, netIssued: 50, covered: 244.92, open: 55.08 })];
    mat.issues = [{ txnId: 70, lineNo: 'ISS/2026/70.0', slipNo: 'ISS/2026/70', internalCode: 'BLMU-550', itemId: 306, itemCode: 'BLM306',
      qtyIssued: 50, qtyReturned: 0, uom: 'Kg', department: 'Printing', so: '26/656' }];
    await openIssues();
    const pos = await screen.findByLabelText('BOM position for 26/656');
    const row = within(pos).getByText('BLM306').closest('tr');
    expect(row).toHaveTextContent('300 Kg');          // needs, on the order quantity
    expect(row).toHaveTextContent('194.92');          // allocated
    expect(row).toHaveTextContent('55.08');           // still open
    expect(row).toHaveTextContent('BLMU-550 (ISS/2026/70.0)');   // what was issued to the order
    expect(within(row).getByText('open')).toBeInTheDocument();
  });

  it('says so when nothing is allocated yet, and falls back to the allocation list on an older server', async () => {
    legacyAllocs = [{ id: 9, so: '26/656', qty: 194.92, internalCode: 'BLMU-593', itemCode: 'BLM306', itemName: '700 MM', uom: 'Kg', location: 'AG' }];
    await openIssues();
    const banner = await screen.findByLabelText('Material allocated to 26/656');
    // an older server records no source — those holds were all made in PLAN
    expect(within(within(banner).getByText('BLMU-593').closest('tr')).getByText('PLAN')).toBeInTheDocument();
    expect(screen.queryByLabelText('BOM position for 26/656')).toBeNull();      // no position to show

    cleanup(); legacyAllocs = [];
    await openIssues();
    expect(await screen.findByLabelText('Material allocated to 26/656')).toHaveTextContent('Nothing is allocated to 26/656 yet');
  });
});

/* ───────── S2 / P2: the roll picker ───────── */

describe('Stores — the roll picker knows what is held (P2, S2)', () => {
  it('leads with the order’s own roll, preselected (★), and will not offer a roll held for another order', async () => {
    await openIssues();
    await pickItem();
    const roll = screen.getByLabelText('Roll');
    // S2: preselected, with what is held for the order in the quantity box
    await waitFor(() => expect(roll).toHaveValue('593'));
    expect(screen.getByLabelText('Quantity')).toHaveValue(194.92);
    expect([...roll.options].map((o) => o.value)).toEqual(['', '593', '600', '592', '601']);
    expect(optionText(593)).toMatch(/^★ BLMU-593 · allocated to 26\/656 · 194\.92 Kg/);
    // P2: the oldest roll is promised to 26/700 — listed, not pickable, and not the ①
    const held = [...roll.options].find((o) => o.value === '600');
    expect(held.disabled).toBe(true);
    expect(held.textContent).toContain('held for 26/700 (PLAN)');
    expect(held.textContent).not.toContain('①');
    // ① is the oldest roll that is actually free
    expect(optionText(592)).toMatch(/^① BLMU-592 · 200 Kg/);
    // a roll partly promised says how much of it is free
    expect(optionText(601)).toContain('free 200 of 300 Kg · 100 held for 26/701 (Stores)');
    // the item picker marks the item that has a roll waiting
    expect([...screen.getByLabelText('Item').options].find((o) => o.value === '306').textContent).toContain('★ allocated');
    // and the rolls table says who each roll is held for
    const rolls = screen.getByText(/Rolls of this item/).closest('.card');
    expect(within(rolls).getByText('Held for')).toBeInTheDocument();
    expect(within(rolls).getByText('BLMU-600').closest('tr')).toHaveTextContent('26/700 · 200 (PLAN)');
    expect(within(rolls).getByText('BLMU-593').closest('tr')).toHaveTextContent('★ 26/656 · 194.92 (PLAN)');
    expect(within(rolls).getByText('BLMU-592').closest('tr')).toHaveTextContent('—');
  });

  it('refuses more of a roll than other orders leave free, and says who holds it', async () => {
    await openIssues();
    await pickItem();
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '601' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '250' } });
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(await screen.findByText(/100 Kg of BLMU-601 is allocated to 26\/701 \(Stores\) — only 200 can be issued to 26\/656/)).toBeInTheDocument();
    expect(slipRows()).toHaveLength(0);
  });

  it('asks before a different roll goes out while the allocated one is waiting', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openIssues();
    await pickItem();
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '592' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '50' } });
    // the nudge is on the screen before anything is pressed
    expect(screen.getByText(/is allocated to 26\/656 for this item — issue it first/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain('BLMU-593 is allocated to 26/656 for BLM306 — issue it first');
    expect(slipRows()).toHaveLength(0);
    // said yes to, it goes on
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(screen.getByLabelText('Remove BLMU-592 from the slip')).toBeInTheDocument();
  });
});

/* ───────── P3: the stores desk allocates ───────── */

describe('Stores — allocating a roll to an order from the desk (P3)', () => {
  it('holds a roll for the order, lists it as the stores desk’s, and releases it again', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openIssues();
    await pickItem();
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '592' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '100' } });
    const allocate = screen.getByLabelText('Allocate BLMU-592 to 26/656');
    expect(allocate).toHaveTextContent('📌 Allocate to 26/656');
    fireEvent.click(allocate);
    await waitFor(() => expect(posted.some((p) => p.u.endsWith('/api/stores/allocations') && p.method === 'POST')).toBe(true));
    expect(posted.find((p) => p.method === 'POST').body).toEqual({ so: '26/656', unitId: 592, qty: 100, department: 'Printing' });
    expect(await screen.findByText(/BLMU-592 · 100 Kg allocated to 26\/656 — held for this order until it is issued or released/)).toBeInTheDocument();

    // the banner re-reads, and names the desk as the one that allocated it
    const banner = screen.getByLabelText('Material allocated to 26/656');
    await waitFor(() => expect(banner).toHaveTextContent('2 roll(s) are allocated to 26/656'));
    const row = within(banner).getByText('BLMU-592').closest('tr');
    expect(within(row).getByText('Stores')).toBeInTheDocument();
    expect(row).toHaveTextContent('Printing');

    fireEvent.click(within(row).getByLabelText('Release BLMU-592 from 26/656'));
    await waitFor(() => expect(posted.some((p) => p.method === 'DELETE' && p.u.endsWith('/api/stores/allocations/2'))).toBe(true));
    await waitFor(() => expect(screen.getByLabelText('Material allocated to 26/656')).toHaveTextContent('1 roll(s) are allocated'));
  });

  it('is never named so it could be mistaken for Add to slip', async () => {
    await openIssues();
    await pickItem();
    expect(screen.getAllByRole('button', { name: /Add to slip/ })).toHaveLength(1);
  });
});

/* ───────── S3: the BOM cap ───────── */

describe('Stores — allocation and issue stop at what the BOM needs (S3)', () => {
  it('lets one more roll go while the line is short, even past the need — then closes it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mat.lines = [line306({ allocated: 292, covered: 292, open: 8 })];
    await openIssues();
    await pickItem();
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '592' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '200' } });
    const strip = screen.getByLabelText('BOM line for BLM306');
    expect(strip).toHaveTextContent('BOM needs 300 Kg of BLM306');
    expect(strip).toHaveTextContent('still open 8');
    expect(screen.getByText('＋ Add to slip')).not.toBeDisabled();
    expect(screen.getByLabelText('Allocate BLMU-592 to 26/656')).not.toBeDisabled();

    // 292 + 200 overshoots 300 — allowed, once
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(screen.getByLabelText('Remove BLMU-592 from the slip')).toBeInTheDocument();

    // now the line is complete: nothing new goes on, nothing new is allocated
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '601' } });
    await waitFor(() => expect(screen.getByLabelText('BOM line for BLM306')).toHaveTextContent('is complete — no more can be allocated or issued'));
    expect(screen.getByLabelText('BOM line for BLM306')).toHaveTextContent('on this slip 200');
    expect(screen.getByText('＋ Add to slip')).toBeDisabled();
    expect(screen.getByLabelText('Allocate BLMU-601 to 26/656')).toBeDisabled();
    expect(within(screen.getByLabelText('BOM position for 26/656')).getByText('✓ complete')).toBeInTheDocument();
  });

  it('once allocated + issued covers the BOM, blocks Add and Allocate — but the allocated roll still goes out', async () => {
    mat.lines = [line306({ allocated: 320, covered: 320, open: 0, complete: true })];
    await openIssues();
    await pickItem();
    // the preselected roll is this order's own hold: issuing it is a promise kept, not a new commitment
    await waitFor(() => expect(screen.getByLabelText('Roll')).toHaveValue('593'));
    expect(screen.getByLabelText('BOM line for BLM306')).toHaveTextContent('The BOM line for BLM306 on 26/656 is complete');
    expect(screen.getByText('＋ Add to slip')).not.toBeDisabled();
    expect(screen.getByLabelText('Allocate BLMU-593 to 26/656')).toBeDisabled();

    // any other roll: blocked, with the reason on the button
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '592' } });
    const add = screen.getByText('＋ Add to slip');
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', 'The BOM line for BLM306 on 26/656 is complete — no more can be allocated or issued');
    expect(screen.getByLabelText('Allocate BLMU-592 to 26/656')).toBeDisabled();

    // "Put on slip" on the allocated roll is never capped
    const put = screen.getByLabelText('Put BLMU-593 on the slip');
    expect(put).not.toBeDisabled();
    fireEvent.click(put);
    expect(screen.getByLabelText('Remove BLMU-593 from the slip')).toBeInTheDocument();
  });

  it('caps nothing when the server sends no requirement — the existing screens’ BOMs carry no quantity', async () => {
    mat.lines = [line306({ required: null, open: null, allocated: 900, covered: 900 })];
    await openIssues();
    await pickItem();
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '592' } });
    expect(screen.getByLabelText('BOM line for BLM306')).toHaveTextContent('nothing caps it');
    expect(screen.getByText('＋ Add to slip')).not.toBeDisabled();
    expect(screen.getByLabelText('Allocate BLMU-592 to 26/656')).not.toBeDisabled();
  });
});

/* ───────── review fixes on the desk (A1, A2, A4–A7) ───────── */

// a PART hold: 100 Kg of the 300 Kg BLMU-601 is held for 26/656 (26/701 holds another 100)
const ALLOC_601 = { id: 7, so: '26/656', unitId: 601, itemId: 306, itemCode: 'BLM306', itemName: '700 MM', internalCode: 'BLMU-601',
  qty: 100, uom: 'Kg', location: 'AG', widthMm: 700, source: 'PLAN', actor: 'plan1', department: null, unitRemaining: 300 };
function partialHold() {
  mat.allocations = [{ ...ALLOC_601 }];
  units306 = units306.map((u) => {
    if (u.id === 593) return { ...u, allocated: 0, allocatedTo: [], holds: [] };
    if (u.id === 601) {
      return { ...u, allocated: 200, allocatedTo: ['26/701', '26/656'],
        holds: [{ so: '26/701', qty: 100, source: 'STORES' }, { so: '26/656', qty: 100, source: 'PLAN' }] };
    }
    return u;
  });
}
const putBtn = (code) => within(screen.getByLabelText('Material allocated to 26/656')).getByLabelText(`Put ${code} on the slip`);
const slipRow = (code) => screen.getByLabelText(`Remove ${code} from the slip`).closest('tr');
async function issueAndRead() {
  fireEvent.click(screen.getByText(/Issue & print slip/));
  await waitFor(() => expect(posted.some((p) => p.u.includes('/api/stores/issues/batch'))).toBe(true));
  return posted.find((p) => p.u.includes('/api/stores/issues/batch')).body;
}

describe('Stores — the slip never names a roll twice (review A1)', () => {
  it('a held roll put on the slip from the Roll list IS on the slip — Put on slip cannot add it again', async () => {
    partialHold();
    await openIssues();
    await pickItem();
    // the part hold is preselected, with what is held for the order
    await waitFor(() => expect(screen.getByLabelText('Roll')).toHaveValue('601'));
    expect(screen.getByLabelText('Quantity')).toHaveValue(100);
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(slipRows()).toHaveLength(1);
    // the banner reads the slip itself, not only the lines its own button made
    expect(putBtn('BLMU-601')).toHaveTextContent('✓ on slip');
    expect(putBtn('BLMU-601')).toBeDisabled();
    expect((await issueAndRead()).lines).toEqual([{ unitId: 601, qty: 100 }]);
  });

  it('puts only the REST of a part-taken hold on, onto the roll’s own line — and the picker merges too', async () => {
    partialHold();
    await openIssues();
    await pickItem();
    await waitFor(() => expect(screen.getByLabelText('Roll')).toHaveValue('601'));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(slipRow('BLMU-601')).toHaveTextContent('40');
    expect(putBtn('BLMU-601')).toHaveTextContent('↧ Put the rest on slip');
    expect(putBtn('BLMU-601')).not.toBeDisabled();

    fireEvent.click(putBtn('BLMU-601'));
    expect(slipRows()).toHaveLength(1);                 // one line of the roll, never two
    expect(slipRow('BLMU-601')).toHaveTextContent('100');
    expect(putBtn('BLMU-601')).toHaveTextContent('✓ on slip');

    // more of the same roll from the Roll list joins that line as well
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '601' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(slipRows()).toHaveLength(1);
    expect(slipRow('BLMU-601')).toHaveTextContent('150');
    expect((await issueAndRead()).lines).toEqual([{ unitId: 601, qty: 150 }]);
  });

  it('two picks of a free roll make one line with both quantities', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openIssues();
    await pickItem();
    for (const q of ['50', '30']) {
      fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '592' } });
      fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: q } });
      fireEvent.click(screen.getByText('＋ Add to slip'));
    }
    expect(slipRows()).toHaveLength(1);
    expect(slipRow('BLMU-592')).toHaveTextContent('80');
  });
});

describe('Stores — after the desk acts (review A2, A6, A7)', () => {
  it('leaves the picker empty after 📌 Allocate — the roll just allocated is not put straight back', async () => {
    await openIssues();
    await pickItem();
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '592' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '100' } });
    const unitReads = () => globalThis.fetch.mock.calls.filter((c) => String(c[0]).includes('/api/stores/items/306/units')).length;
    const readsBefore = unitReads();
    fireEvent.click(screen.getByLabelText('Allocate BLMU-592 to 26/656'));
    await waitFor(() => expect(screen.getByLabelText('Material allocated to 26/656')).toHaveTextContent('2 roll(s) are allocated'));
    await waitFor(() => expect(unitReads()).toBeGreaterThan(readsBefore));
    await new Promise((r) => setTimeout(r, 60));
    // before the fix the preselect put BLMU-592 back with its 100 — a second 📌 allocated it again
    expect(screen.getByLabelText('Roll')).toHaveValue('');
    expect(screen.getByLabelText('Quantity')).toHaveValue(null);
    expect(screen.getByLabelText('Allocate a roll to 26/656')).toBeDisabled();
    // choosing the item afresh preselects as before
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: '401' } });
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: '306' } });
    await waitFor(() => expect(screen.getByLabelText('Roll')).toHaveValue('592'));
  });

  it('highlights in "Rolls of this item" the roll the picker marks ① — not the oldest, held for another order', async () => {
    await openIssues();
    await pickItem();
    const rolls = screen.getByText(/Rolls of this item/).closest('.card');
    expect(optionText(592)).toMatch(/^① BLMU-592/);
    expect(within(rolls).getByText('BLMU-592').closest('tr')).toHaveClass('hi');
    expect(within(rolls).getByText('BLMU-600').closest('tr')).not.toHaveClass('hi');
  });

  it('takes a released roll off the slip being built, and says so', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openIssues();
    const banner = await screen.findByLabelText('Material allocated to 26/656');
    fireEvent.click(within(banner).getByLabelText('Put BLMU-593 on the slip'));
    expect(slipRows()).toHaveLength(1);
    fireEvent.click(within(banner).getByLabelText('Release BLMU-593 from 26/656'));
    expect(window.confirm.mock.calls.at(-1)[0]).toContain('it comes off the slip too');
    await waitFor(() => expect(posted.some((p) => p.method === 'DELETE' && p.u.endsWith('/api/stores/allocations/1'))).toBe(true));
    await waitFor(() => expect(slipRows()).toHaveLength(0));
    expect(await screen.findByText(/BLMU-593 released from 26\/656 — it is free stock again\. It was taken off the slip/)).toBeInTheDocument();
  });

  it('a held roll added from the Roll list goes with its hold when that is released', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openIssues();
    await pickItem();
    await waitFor(() => expect(screen.getByLabelText('Roll')).toHaveValue('593'));
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(slipRows()).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Release BLMU-593 from 26/656'));
    await waitFor(() => expect(slipRows()).toHaveLength(0));
  });
});

describe('Stores — the department and the unit of a hold (review A4, A5)', () => {
  it('does not nudge toward a roll held for another department — it could not go on this slip anyway', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mat.allocations = [{ ...ALLOC_593, department: 'Lamination' }];
    await openIssues();
    await pickItem();                                  // a Printing slip
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '592' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '50' } });
    expect(screen.queryByText(/is allocated to 26\/656 for this item — issue it first/)).toBeNull();
    fireEvent.click(screen.getByText('＋ Add to slip'));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Remove BLMU-592 from the slip')).toBeInTheDocument();
  });

  it('does not cap a roll counted in another unit than the BOM line — the server does not either', async () => {
    mat.lines = [line306({ allocated: 320, covered: 320, open: 0, complete: true })];
    units306 = units306.map((u) => (u.id === 592 ? { ...u, uom: 'Mtrs' } : u.id === 601 ? { ...u, uom: 'KGS' } : u));
    await openIssues();
    await pickItem();
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '592' } });
    expect(screen.getByText('＋ Add to slip')).not.toBeDisabled();
    expect(screen.getByLabelText('Allocate BLMU-592 to 26/656')).not.toBeDisabled();
    expect(screen.getByLabelText('BOM line for BLM306')).toHaveTextContent('counted in Mtrs, not Kg — the BOM line does not cap it');
    // the line's own unit, however it is spelt, is still capped
    fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '601' } });
    expect(screen.getByText('＋ Add to slip')).toBeDisabled();
    expect(screen.getByLabelText('Allocate BLMU-601 to 26/656')).toBeDisabled();
  });
});

/* ───────── the Super Admin's "material assigned" list ───────── */

describe('Super Admin — an order’s material counts what was issued, not only what is held (P1)', () => {
  it('sums allocated + issued net of returns per item off the ledger it already reads', async () => {
    vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { jss: [], oab: { OAB: { SF: [
      { so: '26/656', spec: 'A1319', customer: 'AMAZON', poQty: 25000, closed: false },
      { so: '26/657', spec: 'A1319', customer: 'AMAZON', poQty: 25000, closed: false },
    ], OT: [] } } } }) }));
    globalThis.fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/api/stores/txns')) return res([
        { id: 10, kind: 'ISSUE', qty: 200, so: '26/656', itemCode: 'BLM306' },
        // a slit return comes back under the narrower width's code — it is still BLM306 coming back
        { id: 11, kind: 'RETURN', qty: 20, so: '26/656', itemCode: 'BLM305', issueTxnId: 10 },
        { id: 12, kind: 'ISSUE', qty: 150, so: '26/657', itemCode: 'BLM306' },
      ]);
      if (u.includes('/api/stores/allocations')) return res([{ id: 1, so: '26/656', itemCode: 'BLM306', qty: 120, source: 'STORES' }]);
      if (u.includes('/api/bom')) return res([{ specCode: 'A1319', baseQty: 1000, baseUom: 'pcs',
        items: [{ itemCode: 'BLM306', itemName: '700 MM', uom: 'Kg', qtyPerBase: 12, departmentName: 'Printing' }] }]);
      if (u.includes('/api/stores/summary')) return res({ byStatus: {}, totalValue: 0 });
      return res([]);
    });
    const { default: StoresStockPanel } = await import('../components/StoresStockPanel.jsx');
    render(<StoresStockPanel />);
    const card = (await screen.findByText('material assigned')).closest('.card');
    await waitFor(() => expect(within(card).getByText('26/656')).toBeInTheDocument());
    // 120 allocated + 200 issued − 20 back = 300 = 25,000 × 12 / 1,000 — the hold the issue
    // consumed no longer makes it read "not fully allocated"
    expect(within(within(card).getByText('26/656').closest('tr')).getByText('Fully allocated')).toBeInTheDocument();
    // 150 issued of 300 — not yet
    expect(within(card).getByText('26/657').closest('tr')).not.toHaveTextContent('Fully allocated');
    // one read of the ledger, never a request per order
    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((x) => x.includes('/api/stores/txns?limit=20000'))).toBe(true);
    expect(urls.some((x) => x.includes('/so-material'))).toBe(false);
  });
});

/* ───────── the rule itself, shared with the server ───────── */

describe('the BOM cap rule (lib/soMaterial)', () => {
  const line = { itemCode: 'BLM306', uom: 'Kg', required: 300, allocated: 192, netIssued: 100, covered: 292 };
  it('allows a new commitment while covered is short of the need — even one that overshoots', () => {
    expect(bomCapBlock(line, { so: '26/656', increase: 28 })).toBeNull();
    expect(bomCapBlock(line, { so: '26/656', increase: 200 })).toBeNull();
    expect(openOf(line)).toBe(8);
    expect(isComplete(line)).toBe(false);
  });
  it('refuses once covered (with what the slip adds) reaches the need, in the server’s words', () => {
    expect(bomCapBlock(line, { so: '26/656', increase: 1, pending: 8 }))
      .toBe('The BOM of 26/656 needs 300 Kg of BLM306; 300 is already allocated or issued (allocated 192, issued 100, on this slip 8) — no more can be allocated or issued against it.');
    const over = { ...line, allocated: 220, covered: 320 };
    expect(isComplete(over)).toBe(true);
    expect(bomCapBlock(over, { so: '26/656', increase: 5 })).toMatch(/^The BOM of 26\/656 needs 300 Kg of BLM306; 320 is already allocated or issued/);
  });
  it('never refuses a conversion of the order’s own hold, nor a line with no requirement', () => {
    expect(bomCapBlock({ ...line, covered: 400 }, { so: '26/656', increase: 0 })).toBeNull();
    expect(bomCapBlock({ ...line, required: null }, { so: '26/656', increase: 50 })).toBeNull();
    expect(bomCapBlock({ ...line, required: 0 }, { so: '26/656', increase: 50 })).toBeNull();
  });
  it('exempts a roll in another unit than the line, comparing units the way the server does (review A5)', () => {
    const full = { ...line, covered: 320 };
    expect(sameUom('Kgs', 'KG')).toBe(true);
    expect(sameUom("No's", 'Nos')).toBe(true);
    expect(sameUom('Kg', 'Mtr')).toBe(false);
    expect(bomCapBlock(full, { so: '26/656', increase: 5, rollUom: 'Mtrs' })).toBeNull();
    expect(bomCapBlock(full, { so: '26/656', increase: 5, rollUom: 'KGS' })).toMatch(/^The BOM of 26\/656 needs 300 Kg/);
    expect(bomCapBlock(full, { so: '26/656', increase: 5 })).toMatch(/^The BOM of 26\/656/);
    // a unit missing on either side is no exemption
    expect(bomCapBlock({ ...full, uom: '' }, { so: '26/656', increase: 5, rollUom: 'Mtr' })).toMatch(/^The BOM of 26\/656 needs 300 of/);
    expect(isComplete(full)).toBe(true);
    expect(isComplete(full, 0, 'kg')).toBe(true);
    expect(isComplete(full, 0, 'Mtr')).toBe(false);
  });
  it('reads a /so-material response only when it is one', () => {
    expect(asSoMaterial([])).toBeNull();
    expect(asSoMaterial({})).toBeNull();
    expect(asSoMaterial(null)).toBeNull();
    expect(asSoMaterial({ so: '26/1', lines: [] })).toEqual({ so: '26/1', lines: [], allocations: [], issues: [] });
    expect(['PLAN', 'STORES', 'SUPERADMIN', ''].map(sourceLabel)).toEqual(['PLAN', 'Stores', 'Super Admin', '']);
  });
});
