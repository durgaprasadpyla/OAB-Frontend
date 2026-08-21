import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import {
  bomUOM, hasBOM, bomMaterialForSO, bomOpenSOList, bomMaterialForSOList,
  bomFilterSOList, bomFilterOptions, bomDiffNote, bomSaveSpec,
} from '../lib/bom.js';
import { custGroupOf, custGroups } from '../lib/master.js';

const BOM = {
  'SP-A': {
    spec: 'SP-A', baseQty: 1000,
    items: [
      { itemCode: 'FILM-1', itemDescription: 'BOPP 20mic', uom: 'Kg', qtyPerBase: 50 },
      { itemCode: 'INK-1', itemDescription: 'Cyan', uom: 'Kg', qtyPerBase: 2 },
    ],
  },
  'SP-B': { spec: 'SP-B', baseQty: 500, items: [{ itemCode: 'FILM-1', itemDescription: 'BOPP 20mic', uom: 'Kg', qtyPerBase: 10 }] },
  'SP-EMPTY': { spec: 'SP-EMPTY', baseQty: 100, items: [] },
  'SP-NOBASE': { spec: 'SP-NOBASE', baseQty: 0, items: [{ itemCode: 'X', qtyPerBase: 1 }] },
};

describe('bomUOM', () => {
  it('maps the dispatch form to a base unit', () => {
    expect(bomUOM('Roll')).toBe('Kgs');
    expect(bomUOM('rolls')).toBe('Kgs');
    expect(bomUOM('Pouch')).toBe('Pouches');
    expect(bomUOM('Labels')).toBe('Pieces');
    expect(bomUOM('')).toBe('Pcs');
  });
});

describe('hasBOM', () => {
  it('needs at least one item, not just a record', () => {
    expect(hasBOM(BOM, 'SP-A')).toBe(true);
    expect(hasBOM(BOM, 'SP-EMPTY')).toBe(false);
    expect(hasBOM(BOM, 'MISSING')).toBe(false);
    expect(hasBOM({}, 'SP-A')).toBe(false);
  });
});

describe('bomMaterialForSO — proportional scaling', () => {
  it('scales the recipe by soQty / baseQty', () => {
    // 2500 of a spec whose BOM is per 1000 -> factor 2.5
    expect(bomMaterialForSO(BOM, 'SP-A', 2500)).toEqual([
      { itemCode: 'FILM-1', itemDescription: 'BOPP 20mic', materialType: undefined, subGroup: undefined, uom: 'Kg', required: 125 },
      { itemCode: 'INK-1', itemDescription: 'Cyan', materialType: undefined, subGroup: undefined, uom: 'Kg', required: 5 },
    ]);
  });

  it('handles a fractional factor without rounding early', () => {
    expect(bomMaterialForSO(BOM, 'SP-A', 1500)[0].required).toBe(75);
    expect(bomMaterialForSO(BOM, 'SP-A', 333)[1].required).toBeCloseTo(0.666, 5);
  });

  it('returns nothing when the spec has no BOM or no base quantity', () => {
    expect(bomMaterialForSO(BOM, 'MISSING', 100)).toEqual([]);
    // A zero base would make the scale factor infinite — must not divide by it.
    expect(bomMaterialForSO(BOM, 'SP-NOBASE', 100)).toEqual([]);
  });
});

describe('bomOpenSOList', () => {
  const oab = {
    SF: [
      { so: '26/500', spec: 'SP-A', customer: 'Acme', jobName: 'J1', poQty: 1000 },
      { so: '26/501', spec: 'SP-A', customer: 'Acme', poQty: 1000, invDisp: 400, manDisp: 100, fg: 100 },
      { so: '26/502', spec: 'SP-A', customer: 'Acme', poQty: 1000, closed: true },
      { so: '26/503', spec: 'SP-A', customer: 'Acme', poQty: 1000, invDisp: 1000 },
    ],
    OT: [{ so: '26/504', spec: 'NO-BOM', customer: 'Beta', poQty: 200 }],
  };

  it('keeps only open orders that still have balance', () => {
    const list = bomOpenSOList(BOM, oab);
    expect(list.map((r) => r.so)).toEqual(['26/504', '26/501', '26/500']);   // newest SO first
  });

  it('computes balance as poQty minus invoiced, manual and FG', () => {
    const r = bomOpenSOList(BOM, oab).find((x) => x.so === '26/501');
    expect(r.bal).toBe(400);   // 1000 - (400 + 100 + 100)
  });

  it('flags whether the spec has a BOM', () => {
    const list = bomOpenSOList(BOM, oab);
    expect(list.find((r) => r.so === '26/500').hasBOM).toBe(true);
    expect(list.find((r) => r.so === '26/504').hasBOM).toBe(false);
  });

  it('falls back to the customer name when no group is supplied', () => {
    expect(bomOpenSOList(BOM, oab)[0].group).toBe('Beta');
  });

  it('tolerates a missing OAB entirely', () => {
    expect(bomOpenSOList(BOM, undefined)).toEqual([]);
    expect(bomOpenSOList(BOM, {})).toEqual([]);
  });
});

describe('bomMaterialForSOList — aggregation', () => {
  const list = [
    { so: '26/500', spec: 'SP-A', customer: 'Acme', bal: 1000 },
    { so: '26/501', spec: 'SP-B', customer: 'Beta', bal: 500 },
    { so: '26/502', spec: 'NO-BOM', customer: 'Gamma', bal: 900 },
  ];

  it('sums a shared item across orders and keeps the per-SO split', () => {
    const agg = bomMaterialForSOList(BOM, list);
    const film = agg.find((m) => m.itemCode === 'FILM-1');
    expect(film.total).toBe(60);                       // 50 from SP-A + 10 from SP-B
    expect(film.bySO.map((s) => [s.so, s.qty])).toEqual([['26/500', 50], ['26/501', 10]]);
  });

  it('sorts biggest requirement first and skips specs with no BOM', () => {
    const agg = bomMaterialForSOList(BOM, list);
    expect(agg.map((m) => m.itemCode)).toEqual(['FILM-1', 'INK-1']);
    expect(agg.some((m) => m.bySO.some((s) => s.spec === 'NO-BOM'))).toBe(false);
  });

  it('is empty for an empty selection', () => {
    expect(bomMaterialForSOList(BOM, [])).toEqual([]);
  });
});

describe('BOM filters', () => {
  const list = [
    { so: '1', group: 'G1', customer: 'Acme', spec: 'SP-A' },
    { so: '2', group: 'G1', customer: 'Ajax', spec: 'SP-B' },
    { so: '3', group: 'G2', customer: 'Beta', spec: 'SP-A' },
  ];
  const S = (...v) => new Set(v);

  it('an empty set means no constraint', () => {
    expect(bomFilterSOList(list, {}).map((r) => r.so)).toEqual(['1', '2', '3']);
    expect(bomFilterSOList(list, { group: S() }).map((r) => r.so)).toEqual(['1', '2', '3']);
  });

  it('intersects across kinds', () => {
    expect(bomFilterSOList(list, { group: S('G1'), spec: S('SP-A') }).map((r) => r.so)).toEqual(['1']);
  });

  it('narrows one kind by what is selected in the others', () => {
    // Choosing group G1 should leave only G1's customers selectable.
    expect(bomFilterOptions(list, 'customer', { group: S('G1') })).toEqual(['Acme', 'Ajax']);
    // ...but the group list itself stays complete, since it ignores its own selection.
    expect(bomFilterOptions(list, 'group', { group: S('G1') })).toEqual(['G1', 'G2']);
    expect(bomFilterOptions(list, 'spec', { customer: S('Beta') })).toEqual(['SP-A']);
  });
});

describe('bomDiffNote', () => {
  const prev = { baseQty: 1000, items: [{ itemCode: 'A', qtyPerBase: 5 }, { itemCode: 'B', qtyPerBase: 2 }] };
  it('describes creation, additions, removals and changes', () => {
    expect(bomDiffNote(null, prev)).toBe('BOM created');
    expect(bomDiffNote(prev, { baseQty: 2000, items: prev.items })).toBe('base qty 1000 → 2000');
    expect(bomDiffNote(prev, { baseQty: 1000, items: [...prev.items, { itemCode: 'C', qtyPerBase: 1 }] })).toBe('+C');
    expect(bomDiffNote(prev, { baseQty: 1000, items: [{ itemCode: 'A', qtyPerBase: 9 }, { itemCode: 'B', qtyPerBase: 2 }] })).toBe('A 5 → 9');
    expect(bomDiffNote(prev, { baseQty: 1000, items: [{ itemCode: 'A', qtyPerBase: 5 }] })).toBe('−B');
    expect(bomDiffNote(prev, prev)).toBe('no material change');
  });
});

describe('bomSaveSpec', () => {
  const draft = { baseQty: 1000, items: [{ itemCode: 'A', qtyPerBase: 5, uom: 'Kg' }] };

  it('refuses a BOM with no base quantity or no usable items', () => {
    expect(() => bomSaveSpec({}, 'S', { baseQty: 0, items: draft.items })).toThrow(/base quantity/i);
    expect(() => bomSaveSpec({}, 'S', { baseQty: 10, items: [] })).toThrow(/at least one/i);
    // An item with no code, or a zero quantity, contributes nothing.
    expect(() => bomSaveSpec({}, 'S', { baseQty: 10, items: [{ itemCode: '', qtyPerBase: 5 }] })).toThrow(/at least one/i);
    expect(() => bomSaveSpec({}, 'S', { baseQty: 10, items: [{ itemCode: 'A', qtyPerBase: 0 }] })).toThrow(/at least one/i);
  });

  it('drops unusable rows but keeps the good ones', () => {
    const next = bomSaveSpec({}, 'S', { baseQty: 10, items: [{ itemCode: 'A', qtyPerBase: 5 }, { itemCode: '', qtyPerBase: 9 }] });
    expect(next.S.items).toHaveLength(1);
  });

  it('stamps a history entry and preserves earlier ones', () => {
    const first = bomSaveSpec({}, 'S', draft, { user: 'admin' });
    expect(first.S.history).toHaveLength(1);
    expect(first.S.history[0]).toMatchObject({ user: 'admin', note: 'BOM created' });

    const second = bomSaveSpec(first, 'S', { ...draft, baseQty: 2000 }, { user: 'admin' });
    expect(second.S.history).toHaveLength(2);
    expect(second.S.history[1].note).toBe('base qty 1000 → 2000');
  });

  it('does not mutate the BOM map it was given', () => {
    const before = {};
    bomSaveSpec(before, 'S', draft);
    expect(before).toEqual({});
  });

  it('derives the base UOM from the spec dispatch form', () => {
    expect(bomSaveSpec({}, 'S', draft, { jssRow: { dispatchForm: 'Roll' } }).S.baseUOM).toBe('Kgs');
  });
});

describe('custGroupOf', () => {
  const customers = [{ customer: 'Acme Foods', group: 'Acme Group' }, { customer: 'Beta', group: '' }];
  it('resolves the group, ignoring case and punctuation', () => {
    expect(custGroupOf('acme  foods', customers)).toBe('Acme Group');
    expect(custGroupOf('ACME-FOODS', customers)).toBe('Acme Group');
  });
  it('falls back to the customer name when ungrouped or unknown', () => {
    expect(custGroupOf('Beta', customers)).toBe('Beta');
    expect(custGroupOf('Nobody', customers)).toBe('Nobody');
    expect(custGroupOf('', customers)).toBe('');
  });
  it('lists distinct groups', () => {
    expect(custGroups(customers)).toEqual(['Acme Group']);
  });
});

describe('Dashboard — BOM and Raw Material tabs', () => {
  const modules = {
    jss: [{ spec: 'SP-A', customer: 'Acme', jobName: 'Job One', dispatchForm: 'Roll', status: 'Active' }],
    oab: { OAB: { SF: [{ so: '26/500', spec: 'SP-A', customer: 'Acme', jobName: 'Job One', poQty: 2000 }], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 500 }, lastInvNo: 1 },
    bom: BOM,
    customers: [],
    prices: {},
  };

  async function openTab(label) {
    renderApp(<Dashboard />, { modules, role: 'superadmin' });
    await waitFor(() => expect(screen.getByText(new RegExp(label))).toBeInTheDocument());
    await userEvent.click(screen.getByText(new RegExp(label)));
  }

  it('lists specs and marks which have a BOM defined', async () => {
    await openTab('BOM');
    expect(screen.getByText('SP-A')).toBeInTheDocument();
    expect(screen.getByText('defined')).toBeInTheDocument();
  });

  it('opens the editor prefilled from the saved BOM', async () => {
    await openTab('BOM');
    await userEvent.click(screen.getByLabelText('Edit BOM for SP-A'));
    expect(screen.getByLabelText('Base quantity')).toHaveValue(1000);
    expect(screen.getByLabelText('Item Code row 1')).toHaveValue('FILM-1');
    expect(screen.getByLabelText('Qty per base row 1')).toHaveValue(50);
  });

  it('saves an edited BOM to module 13', async () => {
    await openTab('BOM');
    await userEvent.click(screen.getByLabelText('Edit BOM for SP-A'));
    const qty = screen.getByLabelText('Qty per base row 1');
    await userEvent.clear(qty);
    await userEvent.type(qty, '60');
    await userEvent.click(screen.getByText(/Save BOM/));

    await waitFor(() => expect(screen.getByText(/BOM saved for SP-A/)).toBeInTheDocument());
  });

  it('refuses to save a BOM with no usable material rows', async () => {
    await openTab('BOM');
    await userEvent.click(screen.getByLabelText('Edit BOM for SP-A'));
    // Strip both rows of what makes them usable: a code on one, a quantity on the other.
    await userEvent.clear(screen.getByLabelText('Item Code row 1'));
    await userEvent.clear(screen.getByLabelText('Qty per base row 2'));
    await userEvent.click(screen.getByText(/Save BOM/));
    await waitFor(() => expect(screen.getByText(/at least one raw material/i)).toBeInTheDocument());
  });

  it('refuses to save a BOM with no base quantity', async () => {
    await openTab('BOM');
    await userEvent.click(screen.getByLabelText('Edit BOM for SP-A'));
    await userEvent.clear(screen.getByLabelText('Base quantity'));
    await userEvent.click(screen.getByText(/Save BOM/));
    await waitFor(() => expect(screen.getByText(/Enter a base quantity before saving/i)).toBeInTheDocument());
  });

  it('scales the requirement by the open order balance', async () => {
    await openTab('🧮 Raw Material');
    // SO 26/500 has 2000 balance against a per-1000 BOM -> factor 2.
    const all = screen.getByText('All open sale orders').closest('.card');
    expect(within(all).getByText('FILM-1')).toBeInTheDocument();
    expect(within(all).getByText('100.00 Kg')).toBeInTheDocument();   // 50 × 2
    expect(within(all).getByText('4.00 Kg')).toBeInTheDocument();     // 2 × 2
  });

  it('shows a per-order breakdown on demand', async () => {
    await openTab('🧮 Raw Material');
    const orders = screen.getByText('Open Sale Orders').closest('.card');
    expect(within(orders).queryByText('BOPP 20mic')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('View material for 26/500'));
    // 2000 balance against a per-1000 BOM -> 100 Kg of film for this order alone.
    expect(within(orders).getByText('BOPP 20mic')).toBeInTheDocument();
    expect(within(orders).getByText('100.00 Kg')).toBeInTheDocument();
  });

  it('totals only the orders that are ticked', async () => {
    await openTab('🧮 Raw Material');
    const selected = screen.getByText('Selected sale orders').closest('.card');
    expect(within(selected).getByText(/Tick sale orders above/)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Select 26/500'));
    expect(within(selected).getByText('FILM-1')).toBeInTheDocument();
    expect(within(selected).getByText('100.00 Kg')).toBeInTheDocument();
  });
});
