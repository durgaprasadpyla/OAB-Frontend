import { describe, it, expect } from 'vitest';
import {
  defaultDensity, densityFor, gsmBreakdown, printFigures, rollerChoices, sleeveChoices, laminatedWidth,
  gussetSplit, pouchFigures, sleeveFigures, labelFigures, sheetErrors, sheetFromRequest, jssWithSheet,
  sheetIsBlank, blankSheet, printingMachines, laminationMachines, flatFromSheet,
} from '../lib/specSheet.js';
import { tentativeUom, buildCsaRequest, DESPATCH_FIELDS, despatchKind } from '../lib/repFlow.js';
import { buildCsaReport, csaRequestsByRequester } from '../lib/csa.js';
import { kgFromMetres } from '../lib/calc.js';

// Issues as on 26.10.2026 — the CSA / JSS Specifications sheet, the rep's Add SKU, and
// the OAB's metres → kg.

describe('densities and GSM', () => {
  it('keys in the client’s four densities', () => {
    expect(defaultDensity('LDPE - NATURAL')).toBe(0.92);
    expect(defaultDensity('LDPE - WHITE')).toBe(0.935);
    expect(defaultDensity('LDPE', 'OPAQUE')).toBe(0.935);
    expect(defaultDensity('CC PET')).toBe(1.4);
    expect(defaultDensity('MET PET')).toBe(1.4);
    expect(defaultDensity('AF BOPP')).toBe(0.91);
    expect(defaultDensity('PAPER')).toBeNull();
  });
  it('a Super Admin density wins, a speciality row over the bare material', () => {
    const sales = { material_densities: [{ material: 'CC PET', density: 1.39 }, { material: 'CC PET · MATT', density: 1.42 }] };
    expect(densityFor(sales, 'CC PET')).toBe(1.39);
    expect(densityFor(sales, 'cc pet', 'MATT')).toBe(1.42);
    expect(densityFor(sales, 'AF BOPP')).toBe(0.91);
  });
  it('total = each substrate density × micron + ink on the primary + adhesive on the others', () => {
    const layers = [{ material: 'CC PET', microns: '12' }, { material: 'LDPE - NATURAL', microns: '50' }, { material: 'PAPER', microns: '' }];
    const g = gsmBreakdown({}, layers, { ink_gsm: '2', adhesive_gsm2: '3', adhesive_gsm3: '2.5', layer_gsm: ['', '', '40'] });
    expect(g.rows.map((r) => r.gsm)).toEqual([16.8, 46, 40]);   // paper: no density → the typed GSM
    expect(g.total).toBe(16.8 + 46 + 40 + 2 + 3 + 2.5);
  });
});

describe('printing', () => {
  const machines = [
    { id: 1, name: 'CI Flexo', departmentName: 'Printing' },
    { id: 2, name: 'Thallo', departmentName: 'PRINTING' },
    { id: 3, name: 'Lam 1', departmentName: 'Lamination' },
    { id: 4, name: 'Slitter', departmentName: 'Slitting' },
  ];
  it('splits the machines master into printing and lamination', () => {
    expect(printingMachines(machines).map((m) => m.name)).toEqual(['CI Flexo', 'Thallo']);
    expect(laminationMachines(machines).map((m) => m.name)).toEqual(['Lam 1']);
  });
  it('print repeat = ups × single repeat (4 × 99 = 396); film width = tracks × single width + tracker line', () => {
    const f = printFigures({ single_repeat: 99, single_width: 300 }, { ups: 4, tracks: 2, tracker: 20 }, { maxWidth: 1000 });
    expect(f.repeat).toBe(396);
    expect(f.printWidth).toBe(600);
    expect(f.filmWidth).toBe(620);
    expect(f.tooWide).toBe(false);
  });
  it('refuses a film wider than the machine takes, and says how many tracks fit', () => {
    const sales = { machine_tooling: { 1: { max_width: 900, sleeves: [400] } } };
    const sheet = { single_width: 300, print: { 1: { tracks: 3, tracker: 20 } } };
    const errs = sheetErrors(sales, sheet, machines);
    expect(errs[0]).toMatch(/CI Flexo: film width 920 mm is more than the machine's 900 mm — at most 2 track/);
    expect(sheetErrors(sales, { ...sheet, print: { 1: { tracks: 2, tracker: 20 } } }, machines)).toEqual([]);
  });
  it('offers the sleeves that fit the repeat, else all of them', () => {
    expect(sleeveChoices([380, 400, 420, 450], 396)).toEqual({ options: [400, 420, 450], fallback: false });
    expect(sleeveChoices('300, 350', 396)).toEqual({ options: [300, 350], fallback: true });
  });
});

describe('lamination', () => {
  it('300 × 2 tracks + 20 mm tracker line → rollers over 605 and under 620', () => {
    const rc = rollerChoices([600, 610, 615, 650, 700], 600, 620);
    expect(rc.options).toEqual([610, 615]);
    expect(rc.lo).toBe(605);
  });
  it('3 tracks → over 905 and under 920; none in the window → every roller over 905', () => {
    expect(rollerChoices([900, 910, 1000], 900, 920).options).toEqual([910]);
    const fb = rollerChoices([900, 950, 1000], 900, 920);
    expect(fb.fallback).toBe(true);
    expect(fb.options).toEqual([950, 1000]);
  });
  it('the film grows 10 mm per lamination', () => {
    expect(laminatedWidth(620, 1)).toBe(630);
    expect(laminatedWidth(620, 2)).toBe(640);
  });
});

describe('dispatch-form specifications', () => {
  it('a bottom gusset is split in two, a side gusset in four', () => {
    expect(gussetSplit('Bottom gusset', 80)).toMatchObject({ each: 40, bottom: 80, side: 0 });
    expect(gussetSplit('Side gusset', 80)).toMatchObject({ each: 20, side: 80, bottom: 0 });
  });
  it('pouch weight = (height + bottom seal × 2 + bottom gusset + flap) × (width + seal + side gusset) × GSM × 1.02 / 1e6', () => {
    const p = pouchFigures({
      seal_type: 'Three side seal', seal_a: 5, seal_b: 5, bottom_seal: 8, gusset_type: 'Bottom gusset', gusset_total: 60,
      pouch_height: 200, pouch_width: 150, flap: 10,
    }, 100);
    expect(p.seal).toBe(10);
    expect(p.height).toBe(200 + 16 + 60 + 10);
    expect(p.width).toBe(160);
    expect(p.weight).toBeCloseTo((286 * 160 * 100 * 1.02) / 1e6, 4);
    expect(p.perKg).toBe(Math.round(1000 / p.weight));
  });
  it('a side seal pouch has no bottom seal; a typed GSM overrides the structure total', () => {
    const p = pouchFigures({ seal_type: 'Side seal', seal_a: 5, seal_b: 5, bottom_seal: 8, pouch_height: 200, pouch_width: 150, gsm_override: 50 }, 100);
    expect(p.height).toBe(200);
    expect(p.gsm).toBe(50);
  });
  it('sleeve and label weights', () => {
    expect(sleeveFigures({ sleeve_height: 100, open_width: 200 }, 50).weight).toBeCloseTo(1.02, 4);
    const l = labelFigures({ label_height: 100, bleed_h: 3, label_width: 80, bleed_w: 3 }, 60);
    expect(l.effH).toBe(103);
    expect(l.effW).toBe(83);
    expect(l.weight).toBeCloseTo((103 * 83 * 60 * 1.02) / 1e6, 4);
  });
  it('prefills the sheet from the rep’s requisition', () => {
    expect(sheetFromRequest({ pouch_width_mm: 150, pouch_height_mm: 200, gusset_type: 'Side gusset', gusset_mm: 20, packing_instructions: '500 per box' }))
      .toEqual({ pouch_width: '150', pouch_height: '200', gusset_type: 'Side gusset', gusset_total: '80', packing: '500 per box' });
  });
});

describe('the sheet on a CSA report and a JSS', () => {
  const sales = { skus: [{ id: 'k1', lead_id: 'L1', dispatch_form: 'Pouch' }] };
  const sheet = { ...blankSheet(), single_repeat: 99, single_width: 300, print: { 1: { ups: 4, tracks: 2, tracker: 20 } },
    seal_type: 'Side seal', seal_a: 5, seal_b: 5, pouch_height: 200, pouch_width: 150 };
  it('a report keeps the sheet and the flat figures the desk reads; QC may change the dispatch form', () => {
    const r = buildCsaReport({ substrate1: 'CC PET', substrate1_val: 12, dispatch_type: 'Bulk Bags', spec: sheet }, { sales, skuId: 'k1' });
    expect(r.dispatch_type).toBe('Bulk Bags');
    expect(r.spec.single_repeat).toBe(99);
    expect(r.gsm).toBe(16.8);
    expect(r.film_width).toBe(620);
    expect(r.print_repeat).toBe(99);
    expect(r.pouch_weight).toBeGreaterThan(0);
  });
  it('an untouched sheet is not stored', () => {
    expect(sheetIsBlank(blankSheet())).toBe(true);
    expect(buildCsaReport({ spec: blankSheet() }, { sales, skuId: 'k1' }).spec).toBeUndefined();
  });
  it('a JSS row takes the sheet and fills only its blank figures', () => {
    const row = jssWithSheet({}, { dispatchForm: 'Pouch', gsm: 70, filmWidth: '' }, [{ material: 'CC PET', microns: 12 }], sheet);
    expect(row.specSheet).toBeTruthy();
    expect(row.gsm).toBe(70);           // typed, kept
    expect(row.filmWidth).toBe(620);    // blank, from the sheet
    expect(row.ups).toBe(4);
    expect(row.width).toBe(150);
    expect(flatFromSheet({}, [], sheet, 'Pouch').seal_width).toBe(10);
  });
});

describe('rep Add SKU', () => {
  it('a pouch has the bulk bag’s gusset options and totals', () => {
    expect(DESPATCH_FIELDS.pouch.map((f) => f.k)).toEqual(expect.arrayContaining(['gusset_type', 'gusset_mm']));
    const req = buildCsaRequest(
      { despatch_location: 'X', tentative_qty: 10, tentative_date: '2026-11-01', target_price: 2, gusset_type: 'Bottom gusset', gusset_mm: 30, pouch_height_mm: 200, pouch_width_mm: 150 },
      { dispatch_form: 'Pouch' });
    expect(req.details.totalGusset).toBe(60);
    expect(req.tentative_uom).toBe('Nos');
  });
  it('the quantity is in Kgs for a roll form and Nos for a sleeve form', () => {
    expect(despatchKind('Shrink Sleeve')).toBe('shrink');
    expect(tentativeUom('Shrink Sleeve', { sleeve_form: 'Roll form' })).toBe('Kgs');
    expect(tentativeUom('Shrink Sleeve', { sleeve_form: 'Sleeve form' })).toBe('Nos');
    expect(tentativeUom('Shrink Sleeve', {})).toBe('');
    expect(tentativeUom('Roll')).toBe('Kgs');
    expect(tentativeUom('Label')).toBe('Nos');
  });
});

describe('QC landing — samples by who asked', () => {
  it('counts pending samples per rep, most first', () => {
    const sales = {
      sales_users: [{ id: 'r1', display_name: 'Manasa' }, { id: 'r2', display_name: 'Senthil' }],
      skus: [
        { id: 'a', created_by: 'r1', csa_requested: true },
        { id: 'b', created_by: 'r1', csa_requested: true },
        { id: 'c', created_by: 'r2', sample_received: 'Yes', sample_sent: 'Yes' },
        { id: 'd', created_by: 'r2', csa_requested: true },
      ],
      qc_reports: [{ sku_id: 'd' }],
    };
    expect(csaRequestsByRequester(sales).map((r) => [r.name, r.count])).toEqual([['Manasa', 2], ['Senthil', 1]]);
  });
});

describe('OAB balance kg from metres', () => {
  it('kg = metres × film width ÷ 1000 × GSM ÷ 1000', () => {
    expect(kgFromMetres({}, 10000, { filmWidth: 600, gsm: 50 }, 10000)).toEqual({ kg: 300, basis: 'metres' });
  });
  it('falls back to the pouch weight without film width / GSM, else null', () => {
    expect(kgFromMetres({ dispatchForm: 'Pouch' }, 500, { pouchWeight: 10 }, 1000)).toEqual({ kg: 10.5, basis: 'weight' });
    expect(kgFromMetres({ dispatchForm: 'Pouch' }, 500, {}, 1000)).toBeNull();
  });
});
