import { describe, it, expect } from 'vitest';
import {
  poStatus, isOpenPo, poStatusTag, poLineContext, lineIdentity, flattenPoLines, filterPoLines, poLineOptions,
  groupByPo, storeGrnsForPo, EMPTY_PO_FILTERS,
} from '../lib/poLines.js';

// Issues 30.09 §S7 — one reading of a purchase order for every PO screen.

describe('poStatus / isOpenPo — one answer to "is this PO still expected?"', () => {
  const cases = [
    [{ status: 'Open', items: [] }, 'Open', true],
    [{ status: 'Partial' }, 'Partial', true],
    [{ status: 'Closed' }, 'Closed', false],
    // the 29.09 cancel writes status 'Cancelled' (+ cancelled:true) — it is NOT open
    [{ status: 'Cancelled', cancelled: true }, 'Cancelled', false],
    [{ status: 'Open', cancelled: true }, 'Cancelled', false],
    // closed by hand, or carrying a close date, whatever the lines say
    [{ status: 'Partial', manualClosed: true }, 'Closed', false],
    [{ status: 'Open', closedDate: '2026-09-30' }, 'Closed', false],
    [{ closed: true, items: [] }, 'Closed', false],
    // no stored status: read off the received quantities
    [{ items: [{ qty: 10, receivedQty: 0 }] }, 'Open', true],
    [{ items: [{ qty: 10, receivedQty: 4 }] }, 'Partial', true],
    [{ items: [{ qty: 10, receivedQty: 10 }] }, 'Closed', false],
  ];
  it.each(cases)('%j → %s', (po, status, open) => {
    expect(poStatus(po)).toBe(status);
    expect(isOpenPo(po)).toBe(open);
  });

  it('colours each status its own way', () => {
    expect(poStatusTag('Cancelled')).toBe('tr');
    expect(poStatusTag('Closed')).toBe('tg');
    expect(poStatusTag('Partial')).toBe('tb');
    expect(poStatusTag('Open')).toBe('ty');
  });
});

const MASTER = [
  { code: 'BLM309', name: '320 MM X 35 MIC', materialType: 'FILM', subGroup: 'BOPP', specialtyName: 'ANTIFOG', uom: 'Kg' },
  { code: 'BLM106', name: 'CC PET 12 MIC', materialType: 'FILM', subGroup: 'PET', specialtyName: 'PLAIN', uom: 'Kg' },
  { code: 'INK-1', name: 'Cyan Ink', materialType: 'INK', subGroup: 'SOLVENT', specialtyName: 'SURFACE', uom: 'Kg' },
  { code: 'DUP-A', name: '500 MM', materialType: 'FILM', subGroup: 'BOPP', specialtyName: '' },
  { code: 'DUP-B', name: '500 MM', materialType: 'FILM', subGroup: 'PET', specialtyName: '' },
];
const ASL = [
  { company: 'Kapoor Imaging', itemCode: 'BLM309', specificMaterial: '637 x 520', materialType: 'PLATE', subGroup: 'X', specialty: '' },
  { company: 'Jindal', itemCode: '', specificMaterial: 'Old film', materialType: 'FILM', subGroup: 'CPP', specialty: 'MATT' },
];

describe('lineIdentity — a PO line is never blank', () => {
  const ctx = poLineContext({ master: MASTER, asl: ASL });

  it('reads a 29.09+ line by its code from the Item Master', () => {
    const id = lineIdentity({ supplier: 'X' }, { itemCode: 'blm106', item: 'whatever' }, ctx);
    expect(id).toMatchObject({ code: 'blm106', description: 'CC PET 12 MIC', materialType: 'FILM', specialty: 'PLAIN' });
  });

  it('names a pre-29.09 line (description only) through the supplier’s ASL row, then the Item Master', () => {
    const id = lineIdentity({ supplier: 'KAPOOR IMAGING' }, { item: '637 x 520', unit: "No's" }, ctx);
    // the ASL row gives the code; the Item Master is the authority for the rest
    expect(id.code).toBe('BLM309');
    expect(id.materialType).toBe('FILM');
    expect(id.specialty).toBe('ANTIFOG');
    // the PO said "637 x 520" — that stays the description it was ordered by
    expect(id.description).toBe('637 x 520');
  });

  it('falls back to the ASL row when the Item Master does not know the item', () => {
    const id = lineIdentity({ supplier: 'Jindal' }, { item: 'Old film' }, ctx);
    expect(id).toMatchObject({ code: '', materialType: 'FILM', subGroup: 'CPP', specialty: 'MATT' });
  });

  it('keeps the line’s own copy when nothing else knows it', () => {
    const id = lineIdentity({ supplier: 'Nobody' }, { itemCode: 'NEW1', item: 'New thing', materialType: 'CORE', specialty: 'PAPER' }, ctx);
    expect(id).toMatchObject({ code: 'NEW1', description: 'New thing', materialType: 'CORE', specialty: 'PAPER' });
  });

  it('matches a bare description to the Item Master only when one item carries it', () => {
    expect(lineIdentity({ supplier: 'Nobody' }, { item: 'cyan ink' }, ctx)).toMatchObject({ code: 'INK-1', materialType: 'INK' });
    // "500 MM" is two items — guessing would be worse than saying nothing
    expect(lineIdentity({ supplier: 'Nobody' }, { item: '500 MM' }, ctx)).toMatchObject({ code: '', materialType: '' });
  });

  it('reads a description off the ACTIVE items first — a withdrawn duplicate does not make it ambiguous (review F5)', () => {
    const c = poLineContext({ master: [
      { code: 'BLM082', name: '360 MM X 20 MIC', materialType: 'FILM', subGroup: 'BOPP', specialtyName: 'PLAIN', uom: 'Kg', active: true },
      // withdrawn: "360 was a duplicate of 082" — same description
      { code: 'BLM360', name: '360 MM X 20 MIC', materialType: 'FILM', subGroup: 'BOPP', specialtyName: 'PLAIN', uom: 'Kg', active: false },
      // a description only a withdrawn item carries still resolves to it
      { code: 'OLD-7', name: 'Retired core', materialType: 'CORE', subGroup: 'PAPER', specialtyName: '', active: false },
      // two withdrawn items of one description: ambiguous, as ever
      { code: 'OLD-8', name: 'Gone twice', materialType: 'INK', active: false },
      { code: 'OLD-9', name: 'Gone twice', materialType: 'FILM', active: false },
      // two ACTIVE items of one description stay ambiguous — a withdrawn one never decides it
      { code: 'W-1', name: '700 MM', materialType: 'FILM', subGroup: 'BOPP', active: true },
      { code: 'W-2', name: '700 MM', materialType: 'FILM', subGroup: 'PET', active: true },
      { code: 'W-3', name: '700 MM', materialType: 'FILM', subGroup: 'CPP', active: false },
    ], asl: [] });
    expect(lineIdentity({ supplier: 'Nobody' }, { item: '360 mm x 20 mic' }, c)).toMatchObject({ code: 'BLM082', materialType: 'FILM', specialty: 'PLAIN' });
    expect(lineIdentity({ supplier: 'Nobody' }, { item: 'Retired core' }, c)).toMatchObject({ code: 'OLD-7', materialType: 'CORE' });
    expect(lineIdentity({ supplier: 'Nobody' }, { item: 'Gone twice' }, c)).toMatchObject({ code: '', materialType: '' });
    expect(lineIdentity({ supplier: 'Nobody' }, { item: '700 MM' }, c)).toMatchObject({ code: '', materialType: '' });
    // a line that names the withdrawn code still reads that item
    expect(lineIdentity({ supplier: 'Nobody' }, { itemCode: 'BLM360' }, c)).toMatchObject({ code: 'BLM360', description: '360 MM X 20 MIC' });
    // module 6's own copy can be withdrawn as well
    const c2 = poLineContext({ master: [{ code: 'A1', name: 'Twin', materialType: 'FILM' }],
      itemsExtra: [{ itemCode: 'A2', specificMaterial: 'Twin', materialType: 'INK', active: false }] });
    expect(lineIdentity({}, { item: 'twin' }, c2)).toMatchObject({ code: 'A1', materialType: 'FILM' });
  });

  it('uses module 6’s own item copy for codes the server master lacks', () => {
    const c2 = poLineContext({ master: [], asl: [], itemsExtra: [{ itemCode: 'X9', specificMaterial: 'Core 3in', materialType: 'CORE', subGroup: 'PAPER', specialty: 'HEAVY' }] });
    expect(lineIdentity({}, { itemCode: 'X9' }, c2)).toMatchObject({ description: 'Core 3in', materialType: 'CORE', specialty: 'HEAVY' });
  });
});

describe('flatten / filter / options', () => {
  const ctx = poLineContext({ master: MASTER, asl: ASL });
  const pos = [
    { poNum: 'P1', supplier: 'A', status: 'Open', items: [{ itemCode: 'BLM309', qty: 10 }, { itemCode: 'INK-1', qty: 5 }] },
    { poNum: 'P2', supplier: 'B', status: 'Closed', items: [{ itemCode: 'BLM106', qty: 10, receivedQty: 10 }] },
    { poNum: 'P3', supplier: 'C', status: 'Cancelled', cancelled: true, items: [{ itemCode: 'BLM309', qty: 1 }] },
    { poNum: 'P4', supplier: 'D', status: 'Open', items: [] },
  ];
  const rows = flattenPoLines(pos, ctx);

  it('gives one row per line, each carrying its PO’s status and identity', () => {
    expect(rows.map((r) => r.key)).toEqual(['P1|0', 'P1|1', 'P2|0', 'P3|0']);
    expect(rows[2]).toMatchObject({ status: 'Closed', id: { materialType: 'FILM', specialty: 'PLAIN' } });
    // a PO with no lines can be kept as a placeholder for the grouped tables
    expect(flattenPoLines(pos, ctx, { includeEmpty: true }).filter((r) => r.empty).map((r) => r.po.poNum)).toEqual(['P4']);
  });

  it('"open only" hides Closed AND Cancelled', () => {
    expect(filterPoLines(rows, { openOnly: true }).map((r) => r.po.poNum)).toEqual(['P1', 'P1']);
  });

  it('filters by status, material type, speciality, description and search', () => {
    expect(filterPoLines(rows, { status: 'Cancelled' }).map((r) => r.po.poNum)).toEqual(['P3']);
    expect(filterPoLines(rows, { materialType: 'film' }).map((r) => r.key)).toEqual(['P1|0', 'P2|0', 'P3|0']);
    expect(filterPoLines(rows, { materialType: 'FILM', specialty: 'PLAIN' }).map((r) => r.key)).toEqual(['P2|0']);
    expect(filterPoLines(rows, { description: 'Cyan Ink' }).map((r) => r.key)).toEqual(['P1|1']);
    expect(filterPoLines(rows, { ...EMPTY_PO_FILTERS, q: 'blm106' }).map((r) => r.key)).toEqual(['P2|0']);
  });

  it('narrows each option list by the choices before it (and by status)', () => {
    const all = poLineOptions(rows, {});
    expect(all.materialTypes).toEqual(['FILM', 'INK']);
    expect(all.specialties).toEqual(['ANTIFOG', 'PLAIN', 'SURFACE']);
    const film = poLineOptions(rows, { materialType: 'FILM' });
    expect(film.specialties).toEqual(['ANTIFOG', 'PLAIN']);
    expect(poLineOptions(rows, { materialType: 'FILM', specialty: 'ANTIFOG' }).descriptions).toEqual(['320 MM X 35 MIC']);
    // the open list never offers a closed PO's material
    expect(poLineOptions(rows, { openOnly: true }).specialties).toEqual(['ANTIFOG', 'SURFACE']);
  });

  it('regroups rows per PO, in order', () => {
    expect(groupByPo(rows).map((g) => [g.po.poNum, g.rows.length, g.status])).toEqual([['P1', 2, 'Open'], ['P2', 1, 'Closed'], ['P3', 1, 'Cancelled']]);
  });
});

describe('storeGrnsForPo', () => {
  it('matches the PO number trimmed and case-insensitively, and nothing for a blank one', () => {
    const grns = [{ grnNo: 'G1', poNum: ' blm/pur/1 ' }, { grnNo: 'G2', poNum: 'BLM/PUR/2' }, { grnNo: 'G3', poNum: '' }];
    expect(storeGrnsForPo(grns, 'BLM/PUR/1').map((g) => g.grnNo)).toEqual(['G1']);
    expect(storeGrnsForPo(grns, '')).toEqual([]);
    expect(storeGrnsForPo(null, 'X')).toEqual([]);
  });
});
