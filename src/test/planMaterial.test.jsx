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

function mount({ allocations = [] } = {}) {
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
    await user.type(screen.getByLabelText('Quantity of BLM033 for 26/771'), '400');
    await user.click(screen.getByLabelText('Assign BLM033 to 26/771'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ so: '26/771', unitId: 7, qty: 400 });
  });

  it('counts what is already assigned and says what is still to come', async () => {
    const user = userEvent.setup();
    mount({ allocations: [{ id: 1, so: '26/771', itemCode: 'BLM033', internalCode: 'BLMU-7', qty: 400, uom: 'Kg', location: 'Rack A1' }] });
    await screen.findByText(/Sale orders/);
    await user.click(await screen.findByLabelText('Material for 26/771'));

    const printing = await screen.findByLabelText('Material for 26/771 — Printing');
    const film = within(printing).getByText('BLM033').closest('tr');
    expect(within(film).getByText('400')).toBeInTheDocument();                // assigned
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
