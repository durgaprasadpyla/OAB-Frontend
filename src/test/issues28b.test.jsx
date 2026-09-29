import { describe, it, expect } from 'vitest';
import {
  despatchLocationRowsFor, despatchLocationsFor, buildPoLines, costLines, costIncurred,
} from '../lib/repFlow.js';
import { structureFromSubLayers, subLayersFromStructure, blankSubLayers } from '../components/SubstrateLayers.jsx';

// "Issues as on 28.09.2026" — the sales chain, Superstar hand-off and the cost tiles.

/* ── §Superstar ¶1: the warehouse behind the town ───────────────────────── */

const CUSTOMERS = [
  { group: 'SWIGGY', customer: 'Swiggy', dispatchLoc: 'Dharapuram', warehouseName: 'Unit I' },
  { group: 'SWIGGY', customer: 'Swiggy', dispatchLoc: 'Dharapuram', warehouseName: 'Unit II' },
  { group: 'SWIGGY', customer: 'Swiggy', dispatchLoc: 'Pune', warehouseName: '' },
];
const SWIGGY = { id: 'L9', client_name: 'Swiggy', converted_to_customer: true, delivery_location: '' };

describe('a despatch location carries its warehouse', () => {
  it('keeps two warehouses in one town apart, and labels each', () => {
    // "the despatch locations should be as per the despatch locations that are
    //  populating in the Enter OAB. But here the warehouse name is not visible."
    const rows = despatchLocationRowsFor(SWIGGY, CUSTOMERS);
    expect(rows.map((r) => r.label)).toEqual([
      'Dharapuram (Unit I)', 'Dharapuram (Unit II)', 'Pune',
    ]);
    expect(rows[0].key).not.toBe(rows[1].key);
    expect(rows[0].location).toBe('Dharapuram');
    expect(rows[0].warehouse).toBe('Unit I');
  });

  it('leaves a town with no warehouse reading as itself', () => {
    expect(despatchLocationRowsFor(SWIGGY, CUSTOMERS)[2]).toMatchObject({ location: 'Pune', warehouse: '', label: 'Pune' });
  });

  it('still answers with plain names where only names are wanted', () => {
    // the older helper keeps its contract — it is built on the rows now
    expect(despatchLocationsFor(SWIGGY, CUSTOMERS)).toEqual(['Dharapuram', 'Dharapuram', 'Pune']);
  });

  it('falls back to the delivery location a rep wrote on a lead', () => {
    const lead = { id: 'L1', client_name: 'Zepto', delivery_location: 'Hyderabad' };
    expect(despatchLocationRowsFor(lead, CUSTOMERS).map((r) => r.label)).toEqual(['Hyderabad']);
  });
});

describe('the PO hands the warehouse on to the Superstar', () => {
  const sales = {
    skus: [{
      id: 'S1', lead_id: 'L9', sku_name: '200g Pouch', quotation_accepted: true, jss_spec: 'A1400',
      quotation_tiers: [{ qty: 1000, price: 2.5 }],
    }],
  };

  it('writes the warehouse onto every line of the PO', () => {
    const rows = buildPoLines({
      leadId: 'L9', customer: 'Swiggy', despatchLocation: 'Dharapuram', warehouseName: 'Unit II',
      poNumber: 'PO-77', poDate: '2026-09-28',
      lines: [{ skuId: 'S1', qty: 1000, price: 2.5 }],
    }, sales, 'R1');
    expect(rows).toHaveLength(1);
    expect(rows[0].despatch_location).toBe('Dharapuram');
    expect(rows[0].warehouse_name).toBe('Unit II');
  });

  it('leaves it blank when the town has no warehouse', () => {
    const rows = buildPoLines({
      leadId: 'L9', customer: 'Swiggy', despatchLocation: 'Pune',
      poNumber: 'PO-78', poDate: '2026-09-28',
      lines: [{ skuId: 'S1', qty: 1000, price: 2.5 }],
    }, sales, 'R1');
    expect(rows[0].warehouse_name).toBe('');
  });
});

/* ── §Sales ¶24: the SKU structure comes off the Item Master ────────────── */

describe('a SKU structure is built from substrates', () => {
  it('composes the line from substrate, micron and film width', () => {
    const layers = [
      { material: 'CC PET', microns: '12', widthMm: '600' },
      { material: 'LDPE - NATURAL', microns: '50', widthMm: '600' },
      { material: '', microns: '', widthMm: '' },
    ];
    expect(structureFromSubLayers(layers)).toBe('CC PET · 12 mic · 600 mm  +  LDPE - NATURAL · 50 mic · 600 mm');
  });

  it('reads a monolayer as itself', () => {
    expect(structureFromSubLayers([{ material: 'AF BOPP', microns: '35', widthMm: '320' }])).toBe('AF BOPP · 35 mic · 320 mm');
  });

  it('ignores a layer with no substrate', () => {
    expect(structureFromSubLayers(blankSubLayers())).toBe('');
    expect(structureFromSubLayers([{ material: '', microns: '12', widthMm: '600' }])).toBe('');
  });

  it('reads a saved structure back into the pickers, so an edit does not start blank', () => {
    const back = subLayersFromStructure('CC PET · 12 mic · 600 mm  +  LDPE - NATURAL · 50 mic · 600 mm');
    expect(back[0]).toEqual({ material: 'CC PET', microns: '12', widthMm: '600' });
    expect(back[1]).toEqual({ material: 'LDPE - NATURAL', microns: '50', widthMm: '600' });
    expect(back[2].material).toBe('');
  });

  it('survives a round trip', () => {
    const line = 'AF BOPP · 35 mic · 320 mm  +  MET PET · 12 mic · 320 mm';
    expect(structureFromSubLayers(subLayersFromStructure(line))).toBe(line);
  });
});

/* ── §Sales ¶27: where the cost tiles come from ─────────────────────────── */

describe('sales costs are listed, not just totalled', () => {
  const customers = [{ group: '', customer: 'Beta Foods', dispatchLoc: 'Pune' }];
  const sales = {
    leads: [
      { id: 'L1', client_name: 'Zepto' },                                   // still a lead
      { id: 'L2', client_name: 'Beta Foods', converted_to_customer: true }, // converted
    ],
    interactions: [
      { id: 'i1', lead_id: 'L1', date: '2026-09-10', mode: 'Visit', expense: 1200, created_by: 'R1', remarks: 'Plant tour' },
      { id: 'i2', lead_id: 'L2', date: '2026-09-20', mode: 'Meeting', expense: 800, created_by: 'R1' },
      { id: 'i3', lead_id: 'L1', date: '2026-09-25', mode: 'Call', expense: 0, created_by: 'R2' },
      { id: 'i4', lead_id: 'L2', date: '2026-09-05', mode: 'Visit', expense: 400, created_by: 'R2' },
    ],
  };

  it('lists one row per cost, newest first', () => {
    const lines = costLines(sales, customers);
    expect(lines.map((l) => l.id)).toEqual(['i2', 'i1', 'i4']);   // i3 cost nothing
  });

  it('splits winning a customer from keeping one', () => {
    const lines = costLines(sales, customers);
    expect(lines.find((l) => l.id === 'i1').kind).toBe('convert');   // Zepto is a lead
    expect(lines.find((l) => l.id === 'i2').kind).toBe('retain');    // Beta Foods is converted
  });

  it('carries who spent it, on whom and what for', () => {
    const l = costLines(sales, customers).find((x) => x.id === 'i1');
    expect(l).toMatchObject({ party: 'Zepto', mode: 'Visit', rep: 'R1', cost: 1200, note: 'Plant tour' });
  });

  it('adds up to exactly the two figures on the dashboard', () => {
    const totals = costIncurred(sales, customers);
    expect(totals.convert).toBe(1200);
    expect(totals.retain).toBe(1200);
    expect(totals.total).toBe(2400);
  });

  it('says nothing when no expense was ever logged', () => {
    expect(costLines({ leads: [], interactions: [] }, customers)).toEqual([]);
  });
});
