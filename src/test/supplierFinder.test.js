import { describe, it, expect } from 'vitest';
import { finderOptions, findSuppliers, supplierDetails, lastPoRate, finderAoa, EMPTY_FINDER } from '../lib/supplierFinder.js';

// Issues 30.09 §PU5 — "who all the suppliers are for one particular item".

const MASTER = [
  { code: 'BLM031', name: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'ANTIFOG', uom: 'Kg' },
  { code: 'BLM032', name: '480 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'PLAIN', uom: 'Kg' },
  { code: 'BLM040', name: 'PET 12', materialType: 'FILM', subGroup: 'PET', specialtyName: 'PLAIN', uom: 'Kg' },
  { code: 'INK-C', name: 'Cyan Ink', materialType: 'INK', subGroup: 'SOLVENT', specialtyName: 'SURFACE', uom: 'Kg' },
];
const ASL = [
  // Cosmo: an item-less placeholder row first, then the row with the contact details
  { company: 'Cosmo Films', itemCode: '', specificMaterial: '' },
  { company: 'Cosmo Films', itemCode: 'BLM031', specificMaterial: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'ANTIFOG',
    contact: 'Ravi', phone: '98480 11111', contact2: 'Sita', phone2: '040-222', paymentTerms: '30 days', basicPrice: 142, status: 'Active' },
  { company: 'Jindal Poly', itemCode: 'BLM031', specificMaterial: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'ANTIFOG',
    contact: '', contact2: 'Arun', phone: '', phone2: '99999 00000', paymentTerms: 'No limit', basicPrice: '', status: 'Active' },
  { company: 'Uflex', itemCode: 'BLM032', specificMaterial: '480 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'PLAIN',
    contact: 'Kiran', phone: '90000 12345', paymentTerms: '45 days', basicPrice: 150, status: 'Active' },
  { company: 'Gone Films', itemCode: 'BLM031', specificMaterial: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'ANTIFOG',
    contact: 'X', phone: '1', basicPrice: 99, status: 'Inactive' },
  { company: 'Polyplex', itemCode: 'BLM040', specificMaterial: 'PET 12', materialType: 'FILM', subGroup: 'PET', specialty: 'PLAIN',
    contact: 'Meena', phone: '91111', paymentTerms: 'Advance', basicPrice: 200, status: 'Active' },
  { company: 'Siegwerk', itemCode: 'INK-C', specificMaterial: 'Cyan Ink', materialType: 'INK', subGroup: 'SOLVENT', specialty: 'SURFACE',
    contact: 'Neha', phone: '92222', paymentTerms: '60 days', status: 'Active' },
];
const POS = [
  { poNum: 'PO/1', supplier: 'Jindal Poly', poDate: '2026-08-01', status: 'Closed', items: [{ itemCode: 'BLM031', item: '460 MM', rate: 138, unit: 'Kg' }] },
  { poNum: 'PO/2', supplier: 'Jindal Poly', poDate: '2026-09-10', status: 'Open', items: [{ itemCode: 'BLM031', item: '460 MM', rate: 141, unit: 'Kg' }] },
  // cancelled — its rate never happened
  { poNum: 'PO/3', supplier: 'Jindal Poly', poDate: '2026-09-20', status: 'Cancelled', cancelled: true, items: [{ itemCode: 'BLM031', item: '460 MM', rate: 1 }] },
  // a pre-29.09 line names the item by the supplier's description only
  { poNum: 'PO/4', supplier: 'Siegwerk', poDate: '2026-07-01', status: 'Closed', items: [{ item: 'Cyan Ink', rate: 410 }] },
];
const data = { asl: ASL, master: MASTER, pos: POS };

describe('findSuppliers', () => {
  it('lists nothing until something is picked', () => {
    expect(findSuppliers(data, EMPTY_FINDER)).toEqual([]);
  });

  it('lists every active supplier of the item code — exact first — and similar materials after', () => {
    const rows = findSuppliers(data, { ...EMPTY_FINDER, code: 'BLM031' });
    expect(rows.map((r) => [r.company, r.itemCode, r.match])).toEqual([
      ['Cosmo Films', 'BLM031', 'Exact'],
      ['Jindal Poly', 'BLM031', 'Exact'],
      // same material type + sub group, a different item: "similar to this"
      ['Uflex', 'BLM032', 'Similar'],
    ]);
    // Inactive rows are not suppliers any more; PET is a different sub group
    expect(rows.some((r) => r.company === 'Gone Films' || r.company === 'Polyplex')).toBe(false);
  });

  it('carries who to call, their number and their payment terms', () => {
    const [cosmo, jindal] = findSuppliers(data, { ...EMPTY_FINDER, code: 'BLM031' });
    // the placeholder row has no contact — the first row that does is used
    expect(cosmo).toMatchObject({ contactPerson: 'Ravi', contactNumber: '98480 11111', altContact: 'Sita', altNumber: '040-222', paymentTerms: '30 days' });
    // only the second slot filled → it is the contact
    expect(jindal).toMatchObject({ contactPerson: 'Arun', contactNumber: '99999 00000', paymentTerms: 'No limit' });
  });

  it('quotes the ASL basic price, else the last PO rate (never a cancelled one) with its date', () => {
    const [cosmo, jindal] = findSuppliers(data, { ...EMPTY_FINDER, code: 'BLM031' });
    expect(cosmo.rate).toMatchObject({ value: 142, source: 'ASL' });
    expect(jindal.rate).toMatchObject({ value: 141, source: 'PO', poNum: 'PO/2', date: '2026-09-10' });
  });

  it('finds the last PO rate of a pre-29.09 line by the supplier’s description', () => {
    const [siegwerk] = findSuppliers(data, { ...EMPTY_FINDER, materialType: 'INK' });
    expect(siegwerk.rate).toMatchObject({ value: 410, source: 'PO', poNum: 'PO/4' });
  });

  it('a material type alone lists every supplier of it as an exact match', () => {
    const rows = findSuppliers(data, { ...EMPTY_FINDER, materialType: 'FILM' });
    expect(rows.every((r) => r.match === 'Exact')).toBe(true);
    expect([...new Set(rows.map((r) => r.company))]).toEqual(['Cosmo Films', 'Jindal Poly', 'Polyplex', 'Uflex']);
  });

  it('a speciality narrows the exact matches and offers the rest of that sub group as similar', () => {
    const rows = findSuppliers(data, { ...EMPTY_FINDER, materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'PLAIN' });
    expect(rows.map((r) => [r.company, r.match])).toEqual([['Uflex', 'Exact'], ['Cosmo Films', 'Similar'], ['Jindal Poly', 'Similar']]);
  });

  it('matches an item if EITHER the Item Master or the ASL row says so', () => {
    const asl = [{ company: 'Odd Co', itemCode: 'BLM040', specificMaterial: 'PET film 12', materialType: 'FILM', subGroup: 'PET', specialty: '', contact: 'Q', status: 'Active' }];
    // the master calls BLM040 "PET 12"; the supplier's row calls it "PET film 12"
    expect(findSuppliers({ asl, master: MASTER, pos: [] }, { ...EMPTY_FINDER, description: 'PET 12' }).map((r) => r.company)).toEqual(['Odd Co']);
    expect(findSuppliers({ asl, master: MASTER, pos: [] }, { ...EMPTY_FINDER, description: 'PET film 12' }).map((r) => r.company)).toEqual(['Odd Co']);
  });
});

describe('finderOptions — the five dropdowns narrow each other', () => {
  it('offers everything from the Item Master and the ASL when nothing is picked', () => {
    const o = finderOptions(data, EMPTY_FINDER);
    expect(o.codes).toEqual(['BLM031', 'BLM032', 'BLM040', 'INK-C']);
    expect(o.materialTypes).toEqual(['FILM', 'INK']);
    expect(o.codeLabels.BLM031).toBe('BLM031 — 460 MM');
  });

  it('narrows the other four by a pick', () => {
    const o = finderOptions(data, { ...EMPTY_FINDER, materialType: 'FILM', subGroup: 'AF BOPP' });
    expect(o.codes).toEqual(['BLM031', 'BLM032']);
    expect(o.specialties).toEqual(['ANTIFOG', 'PLAIN']);
    expect(o.descriptions).toEqual(['460 MM', '480 MM']);
    // the picked field's own list is narrowed by the OTHERS only, so it can be changed
    expect(o.subGroups).toEqual(['AF BOPP', 'PET']);
  });

  it('narrows the material by a picked code', () => {
    expect(finderOptions(data, { ...EMPTY_FINDER, code: 'INK-C' }).materialTypes).toEqual(['INK']);
  });
});

describe('helpers', () => {
  it('supplierDetails takes the first row with contacts and the first payment terms', () => {
    expect(supplierDetails(ASL, 'cosmo films')).toMatchObject({ company: 'Cosmo Films', contactPerson: 'Ravi', paymentTerms: '30 days' });
    expect(supplierDetails([], 'Nobody')).toMatchObject({ company: 'Nobody', contactPerson: '', paymentTerms: '' });
  });

  it('lastPoRate ignores other suppliers and cancelled POs', () => {
    expect(lastPoRate(POS, 'Jindal Poly', { code: 'BLM031' })).toMatchObject({ rate: 141, poNum: 'PO/2' });
    expect(lastPoRate(POS, 'Cosmo Films', { code: 'BLM031' })).toBeNull();
  });

  it('exports a header and one row per result', () => {
    const aoa = finderAoa(findSuppliers(data, { ...EMPTY_FINDER, code: 'BLM031' }));
    expect(aoa[0].slice(0, 6)).toEqual(['Match', 'Supplier', 'Contact Person', 'Contact Number', 'Email', 'Payment Terms']);
    expect(aoa).toHaveLength(4);
    expect(aoa[1]).toContain('Ravi / Sita');
  });
});
