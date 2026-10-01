import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import PlanReadiness from '../pages/PlanReadiness.jsx';
import { bomMaterialForSO, bomMaterialForSOByDept } from '../lib/bom.js';

// Issues in BOM calculations, 24 Sep 2026:
//   §5  "let us have radio button selections against each sale order … I select a
//        radio button against a sale order, then let the list be populated at the top
//        based on the BOM that is attached to this particular spec number."
//   §13 "the BOM is for 10,000 pouches and … I have a sale order for 1 lakh pouches.
//        I want the BOM to calculate it according to 1 lakh pieces and it should give
//        me 10 metric tonnes of material as needed."

describe('a BOM scales to the order it is asked for', () => {
  // one tonne of film per 10,000 pouches
  const bom = {
    A1405: {
      baseQty: 10000, baseUOM: 'pcs',
      items: [
        { itemCode: 'BLM033', itemDescription: '600 MM', materialType: 'FILM', subGroup: 'CAST PVC', uom: 'Kg', qtyPerBase: 1000, departmentName: 'Printing' },
        { itemCode: 'INK01', itemDescription: 'Blue', materialType: 'INK', subGroup: 'FLEXO', uom: 'Kg', qtyPerBase: 5, departmentName: 'Printing' },
        { itemCode: 'ADH01', itemDescription: 'Adhesive', materialType: 'ADHESIVE', subGroup: 'PU', uom: 'Kg', qtyPerBase: 20, departmentName: 'Lamination' },
      ],
    },
  };

  it('gives ten times the material for ten times the order', () => {
    const one = bomMaterialForSO(bom, 'A1405', 10000);
    expect(one.find((i) => i.itemCode === 'BLM033').required).toBe(1000);        // 1 tonne

    const ten = bomMaterialForSO(bom, 'A1405', 100000);                          // 1 lakh pouches
    expect(ten.find((i) => i.itemCode === 'BLM033').required).toBe(10000);       // 10 tonnes
    expect(ten.find((i) => i.itemCode === 'INK01').required).toBe(50);
    // and a part order scales down the same way
    expect(bomMaterialForSO(bom, 'A1405', 2500).find((i) => i.itemCode === 'BLM033').required).toBe(250);
  });

  it('splits that requirement across the departments that consume it', () => {
    const depts = bomMaterialForSOByDept(bom, 'A1405', 100000);
    expect(depts.map((d) => d.department)).toEqual(['Printing', 'Lamination']);
    expect(depts[0].items.map((i) => [i.itemCode, i.required])).toEqual([['BLM033', 10000], ['INK01', 50]]);
    expect(depts[1].items.map((i) => [i.itemCode, i.required])).toEqual([['ADH01', 200]]);
    expect(depts[0].totals.Kg).toBe(10050);
  });

  it('asks for nothing when the spec has no BOM, rather than guessing', () => {
    expect(bomMaterialForSO(bom, 'A9999', 100000)).toEqual([]);
    expect(bomMaterialForSO({ A1: { items: [{ itemCode: 'X', qtyPerBase: 5 }] } }, 'A1', 100)).toEqual([]);   // no baseQty
  });
});

/* ───────────────────────── the PLAN login's screen ───────────────────────── */

const JSS = [{ spec: 'A1405', customer: 'VSA Foods', jobName: 'Coconut water sleeve', material: 'CAST PVC', filmWidth: 375, width: 85, height: 128, status: 'Active' }];
const OAB = oabModule({ SF: [
  { so: '26/771', spec: 'A1405', customer: 'VSA Foods', jobName: 'Coconut water sleeve', dispLoc: 'Dindigul', poQty: 100000, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-20' },
  // 30.09: part of this one has gone out already — its balance is 60,000 of 1,00,000
  { so: '26/772', spec: 'A1405', customer: 'VSA Foods', jobName: 'Coconut water sleeve', dispLoc: 'Dindigul', poQty: 100000, invDisp: 40000, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-21' },
  { so: '26/770', spec: 'A1338', customer: 'More Retail', jobName: 'Poly bag 1Kg', dispLoc: 'Devanahalli', poQty: 21000, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-19' },
] });
const BOM_API = [{
  specCode: 'A1405', baseQty: 10000, baseUom: 'pcs',
  items: [
    { itemCode: 'BLM033', itemName: '600 MM', materialType: 'FILM', subGroup: 'CAST PVC', uom: 'Kg', qtyPerBase: 1000, departmentName: 'Printing' },
    { itemCode: 'ADH01', itemName: 'Adhesive', materialType: 'ADHESIVE', subGroup: 'PU', uom: 'Kg', qtyPerBase: 20, departmentName: 'Lamination' },
  ],
}];
const FREE_ROLLS = [
  { unitId: 7, itemCode: 'BLM033', itemName: '600 MM', internalCode: 'BLMU-7', free: 400, uom: 'Kg', widthMm: 600, location: 'Rack A1' },
  { unitId: 9, itemCode: 'BLM033', itemName: '600 MM', internalCode: 'BLMU-9', free: 350, uom: 'Kg', widthMm: 600, location: 'Rack A2' },
  { unitId: 11, itemCode: 'ZZZ', itemName: 'Something else', internalCode: 'BLMU-11', free: 90, uom: 'Kg' },
];

function mount({ allocations = [], soMaterial = null } = {}) {
  const posted = [];
  // renderApp installs the harness fetch, so this wraps it AFTERWARDS — the planning
  // and stores endpoints this screen reads are not part of the shared harness.
  const r = renderApp(<PlanReadiness />, { modules: { oab: OAB, jss: JSS, customers: [], prices: {} }, role: 'plan' });
  const base = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (b) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('/api/bom')) return json(BOM_API);
    if (u.includes('/api/stores/available')) return json(FREE_ROLLS);
    // 30.09: the order's material position; an older server (and these mocks by
    // default) has none, and the panel falls back to the allocation list alone
    if (u.includes('/api/stores/so-material')) return json(soMaterial || []);
    if (u.includes('/api/stores/allocations')) {
      if ((opts.method || 'GET').toUpperCase() === 'POST') { posted.push(JSON.parse(opts.body)); return json({ ok: true }); }
      return json(allocations);
    }
    if (u.includes('/api/planning/readiness')) return json([]);
    if (u.includes('/api/planning/week')) return json({ jobs: [], capacity: [] });
    return base(url, opts);
  };
  return { ...r, posted };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('PLAN — the material a picked order needs', () => {
  it('opens nothing until a radio picks an order, then shows it above the board', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText(/Sale orders/);
    expect(screen.queryByLabelText('Material for the picked sale order')).toBeNull();

    await user.click(await screen.findByLabelText('Material for 26/771'));
    const panel = await screen.findByLabelText('Material for the picked sale order');
    expect(within(panel).getAllByText(/A1405/).length).toBeGreaterThan(0);
    expect(within(panel).getByText(/VSA Foods/)).toBeInTheDocument();
  });

  it('prints the scale, the department and every BOM line with what the order needs', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText(/Sale orders/);
    await user.click(await screen.findByLabelText('Material for 26/771'));

    // §13 — the BOM is for 10,000; the order is 1,00,000; so ×10
    const scale = await screen.findByLabelText('BOM scale');
    expect(scale).toHaveTextContent('10,000 pcs');
    expect(scale).toHaveTextContent('1,00,000');
    expect(scale).toHaveTextContent('× 10');

    // the department and the BOM item name, as the client asked
    const printing = await screen.findByLabelText('Material for 26/771 — Printing');
    const film = within(printing).getByText('BLM033').closest('tr');
    expect(within(film).getByText('600 MM')).toBeInTheDocument();
    expect(within(film).getByText('10,000 Kg')).toBeInTheDocument();          // needs
    expect(within(film).getByText(/750/)).toBeInTheDocument();                // in stores (400 + 350)
    expect(screen.getByLabelText('Material for 26/771 — Lamination')).toBeInTheDocument();
  });

  it('offers only that item’s rolls, oldest first, and assigns one', async () => {
    const user = userEvent.setup();
    const { posted } = mount();
    await screen.findByText(/Sale orders/);
    await user.click(await screen.findByLabelText('Material for 26/771'));

    const rolls = await screen.findByLabelText('Rolls of BLM033 for 26/771');
    // the unrelated roll (ZZZ) is not on this line's list
    expect([...rolls.options].map((o) => o.textContent)).toEqual([
      '— free rolls, oldest first —',
      '① BLMU-7 · 400 Kg · 600mm · Rack A1',
      'BLMU-9 · 350 Kg · 600mm · Rack A2',
    ]);
    await user.selectOptions(rolls, '7');
    // 30.09: the box fills with what the chosen roll has free — a roll is promised whole
    expect(screen.getByLabelText('Quantity of BLM033 for 26/771')).toHaveValue(400);
    await user.click(screen.getByLabelText('Assign BLM033 to 26/771'));
    await waitFor(() => expect(posted).toHaveLength(1));
    // …and the department the BOM line sits under travels with the hold, so the stores
    // desk puts the roll on Printing's slip
    expect(posted[0]).toEqual({ so: '26/771', unitId: 7, qty: 400, department: 'Printing' });
  });

  it('counts what is already assigned and says what is still to come', async () => {
    const user = userEvent.setup();
    mount({ allocations: [{ id: 1, so: '26/771', itemCode: 'BLM033', internalCode: 'BLMU-7', qty: 400, uom: 'Kg', location: 'Rack A1' }] });
    await screen.findByText(/Sale orders/);
    await user.click(await screen.findByLabelText('Material for 26/771'));

    const printing = await screen.findByLabelText('Material for 26/771 — Printing');
    const film = within(printing).getByText('BLM033').closest('tr');
    expect(within(film).getByText('400')).toBeInTheDocument();                // allocated
    expect(within(film).getByText('9,600')).toBeInTheDocument();              // still to assign
    // the roll it is holding is named, and can be released
    expect(within(printing).getByText('BLMU-7')).toBeInTheDocument();
    expect(within(printing).getByLabelText('Release BLMU-7 from 26/771')).toBeInTheDocument();
  });

  it('says plainly when the spec has no BOM instead of showing an empty picker', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText(/Sale orders/);
    await user.click(await screen.findByLabelText('Material for 26/770'));     // A1338 — no BOM
    const panel = await screen.findByLabelText('Material for the picked sale order');
    expect(within(panel).getByText(/No BOM saved for A1338/)).toBeInTheDocument();
    expect(within(panel).getByText(/Ask QC to add it under/)).toBeInTheDocument();
  });
});

/* ───────────── Issues as on 30.09: what the stores did, seen in PLAN ───────────── */

// P1: "For the same sale order (26/656) I have issued a roll BLMU-592 from the stores,
// whereas it is not being shown as assigned in the plan login. It should be vice
// versa too — if for a particular SO the store's login has assigned some material,
// that also should be shown here."
// S3: a line whose BOM quantity is covered takes no more.
const matLine = (over = {}) => ({
  itemId: 33, itemCode: 'BLM033', itemName: '600 MM', materialType: 'FILM', subGroup: 'CAST PVC', specialtyName: '',
  departments: ['Printing'], uom: 'Kg', qtyPerBase: 1000, required: 10000,
  allocated: 0, issued: 0, returned: 0, netIssued: 0, covered: 0, open: 10000, complete: false, onBom: true, ...over,
});
const position = ({ lines = [matLine()], allocations = [], issues = [] } = {}) => ({
  so: '26/771', spec: 'A1405', found: true, poQty: 100000, baseQty: 10000, lines, allocations, issues,
});

describe('PLAN — what is allocated AND issued to the order (30.09)', () => {
  async function open(user, so = '26/771') {
    await screen.findByText(/Sale orders/);
    await user.click(await screen.findByLabelText(`Material for ${so}`));
    return screen.findByLabelText(`Material for ${so} — Printing`);
  }

  it('shows a roll the stores issued to the order as issued, counts it, and offers no release for it', async () => {
    const user = userEvent.setup();
    mount({ soMaterial: position({
      lines: [matLine({ issued: 194.92, netIssued: 194.92, covered: 194.92, open: 9805.08 })],
      issues: [{ txnId: 77, lineNo: 'ISS/2026/77.0', slipNo: 'ISS/2026/77', internalCode: 'BLMU-592', itemId: 33, itemCode: 'BLM033',
        qtyIssued: 194.92, qtyReturned: 0, uom: 'Kg', department: 'Printing', so: '26/771', ts: '2026-09-30T10:00:00Z' }],
    }) });
    const printing = await open(user);
    await waitFor(() => expect(within(printing).getByText('BLMU-592')).toBeInTheDocument());
    const film = within(printing).getByText('BLM033').closest('tr');
    // its own column — Issued — and Still to assign comes down by it
    expect(within(film).getByText('194.92')).toBeInTheDocument();
    expect(within(film).getByText('9,805.08')).toBeInTheDocument();
    // the roll itself is named under the line, tagged issued, with its slip line
    const roll = within(printing).getByText('BLMU-592').closest('tr');
    expect(within(roll).getByText('issued')).toBeInTheDocument();
    expect(roll).toHaveTextContent('ISS/2026/77.0');
    expect(roll).toHaveTextContent('to Printing');
    // delivered material is not PLAN's to release
    expect(screen.queryByLabelText('Release BLMU-592 from 26/771')).toBeNull();
  });

  it('tags each allocation with the login that made it — PLAN or the stores desk', async () => {
    const user = userEvent.setup();
    mount({ soMaterial: position({
      lines: [matLine({ allocated: 600, covered: 600, open: 9400 })],
      allocations: [
        { id: 1, so: '26/771', unitId: 593, itemId: 33, itemCode: 'BLM033', internalCode: 'BLMU-593', qty: 400, uom: 'Kg', source: 'PLAN', actor: 'plan1', department: 'Printing' },
        { id: 2, so: '26/771', unitId: 594, itemId: 33, itemCode: 'BLM033', internalCode: 'BLMU-594', qty: 200, uom: 'Kg', source: 'STORES', actor: 'store1', department: 'Printing' },
      ],
    }) });
    const printing = await open(user);
    await waitFor(() => expect(within(printing).getByText('BLMU-594')).toBeInTheDocument());
    const plan = within(printing).getByText('BLMU-593').closest('tr');
    expect(within(plan).getByText('allocated · PLAN')).toBeInTheDocument();
    expect(plan).toHaveTextContent('by plan1');
    const stores = within(printing).getByText('BLMU-594').closest('tr');
    expect(within(stores).getByText('allocated · Stores')).toBeInTheDocument();
    expect(stores).toHaveTextContent('by store1');
    // both are holds, so both can be released here
    expect(screen.getByLabelText('Release BLMU-594 from 26/771')).toBeInTheDocument();
    const film = within(printing).getByText('BLM033').closest('tr');
    expect(within(film).getByText('600')).toBeInTheDocument();                // allocated, both logins
    expect(within(film).getByText('9,400')).toBeInTheDocument();              // still to assign
  });

  it('closes a line once what is allocated and issued covers the BOM — ✓ BOM covered', async () => {
    const user = userEvent.setup();
    const { posted } = mount({ soMaterial: position({
      lines: [matLine({ allocated: 6000, issued: 4200, netIssued: 4200, covered: 10200, open: 0, complete: true })],
    }) });
    const printing = await open(user);
    const btn = within(printing).getByLabelText('Assign BLM033 to 26/771');
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveTextContent('✓ BOM covered');
    await user.selectOptions(within(printing).getByLabelText('Rolls of BLM033 for 26/771'), '9');
    await user.click(btn);
    expect(posted).toHaveLength(0);
  });

  it('works the cover out itself against an older server, on the order quantity', async () => {
    const user = userEvent.setup();
    // no /so-material: the holds alone — 10,000 Kg held covers 1,00,000 × 1,000 / 10,000
    mount({ allocations: [{ id: 5, so: '26/771', itemCode: 'BLM033', internalCode: 'BLMU-7', qty: 10000, uom: 'Kg' }] });
    const printing = await open(user);
    await waitFor(() => expect(within(printing).getByLabelText('Assign BLM033 to 26/771')).toBeDisabled());
    const film = within(printing).getByText('BLM033').closest('tr');
    expect(within(film).getByText('✓')).toBeInTheDocument();                  // nothing still to assign
    // a line not yet covered stays open (ADH01 has nothing in the racks, so it waits on stock instead)
    const lam = screen.getByLabelText('Material for 26/771 — Lamination');
    expect(within(lam).getByLabelText('Assign ADH01 to 26/771')).toHaveTextContent(/^Assign$/);
  });

  it('asks for the material of the WHOLE order, not of the balance still to make', async () => {
    const user = userEvent.setup();
    mount();
    const printing = await open(user, '26/772');                              // 40,000 of 1,00,000 already out
    const film = within(printing).getByText('BLM033').closest('tr');
    expect(within(film).getByText('10,000 Kg')).toBeInTheDocument();         // not 6,000
    expect(screen.getByLabelText('BOM scale')).toHaveTextContent('this order is for 1,00,000');
  });

  it('prefers the server’s requirement when it sends one', async () => {
    const user = userEvent.setup();
    mount({ soMaterial: position({ lines: [matLine({ required: 9500, open: 9500 })] }) });
    const printing = await open(user);
    await waitFor(() => expect(within(within(printing).getByText('BLM033').closest('tr')).getByText('9,500 Kg')).toBeInTheDocument());
  });

  it('lines every department up under ONE set of columns', async () => {
    const user = userEvent.setup();
    mount();
    const printing = await open(user);
    const lam = screen.getByLabelText('Material for 26/771 — Lamination');
    // both departments are row groups of the same table, so "Needs" sits at one place
    const table = printing.closest('table');
    expect(lam.closest('table')).toBe(table);
    expect(table).toHaveAttribute('aria-label', 'BOM material for 26/771');
    expect(table.style.tableLayout).toBe('fixed');
    expect(table.querySelectorAll('colgroup col')).toHaveLength(9);
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Item', 'Description', 'Material', 'Needs', 'Allocated', 'Issued', 'Still to assign', 'In stores', 'Assign a roll',
    ]);
    // the department heading and every BOM row span exactly those nine columns
    [printing, lam].forEach((g) => {
      within(g).getAllByRole('row').forEach((row) => {
        expect([...row.cells].reduce((t, c) => t + (c.colSpan || 1), 0)).toBe(9);
      });
    });
  });

  it('re-reads the stores position on ↻ Refresh', async () => {
    const user = userEvent.setup();
    mount();
    await open(user);
    const spy = vi.spyOn(globalThis, 'fetch');
    await user.click(screen.getByLabelText('Refresh the material of 26/771'));
    await waitFor(() => expect(spy.mock.calls.some((c) => String(c[0]).includes('/api/stores/so-material?so=26%2F771'))).toBe(true));
  });
});
