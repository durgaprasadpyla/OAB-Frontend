import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Issues 7 (2026-09-15) — Issues_Stores_15.09 (1.0 + 2.0) and Sales_Login_Issues.
//
//   Stores   a return is booked against the ROLL-WISE issue line, every returned roll
//            gets a return slip, the split box is film-only, the split tag traces the
//            roll back, the board finds a roll by its sticker number.
//   Masters  HR-only departments live beside the designations; designations are one
//            flat list; the audit reads in words; the left employees have a list.
//   Sales    the rep's book splits into leads and customers; the CSA requisition; the
//            desk's price is a floor; sent / accepted; the multi-SKU PO; the Superstar's
//            PO → SO list; the cost tiles.

import {
  repBook, isCustomerLead, despatchLocationsFor, buildCsaRequest, bulkBagTotals, sendSkuForCsa,
  deskTiersForSku, repTiersForSku, floorFor, saveRepQuote, quoteStatusOf, markQuotesSent, setQuoteAccepted,
  buildPoLines, pendingRepPos, markPosPushed, costIncurred, setLeadCategories, despatchKind,
} from '../lib/repFlow.js';
import { csaPendingForQc } from '../lib/csa.js';
import { csaCandidatesForJss, jssFieldsFromCsa } from '../components/CsaToJssPanel.jsx';
import { repFor, filterOptions } from '../lib/salesHistory.js';
import { auditDetailsText } from '../pages/HR.jsx';
import { repModulesOf } from '../lib/sales.js';
import { buildVisit as buildRepVisit } from '../lib/repPortal.js';

const REP = 'R1';
const leads = [
  { id: 'L1', client_name: 'Acme Dairy', categories: ['Dairy'], category_assignments: { Dairy: REP }, created_by: REP, delivery_location: 'Hyderabad' },
  { id: 'L2', client_name: 'Beta Foods', categories: ['Oil'], category_assignments: { Oil: REP }, created_by: REP, converted_to_customer: true },
  { id: 'L3', client_name: 'Gamma Ice', categories: ['Ice Creams'], category_assignments: { 'Ice Creams': 'R2' }, created_by: 'R2', kam: REP, converted_to_customer: true },
  { id: 'L4', client_name: 'Delta Snacks', categories: ['Namkeen'], category_assignments: { Namkeen: 'R2' }, created_by: 'R2' },
];
const customers = [
  { group: 'BETA GROUP', customer: 'Beta Foods', dispatchLoc: 'Pune' }, { group: 'BETA GROUP', customer: 'Beta Foods', dispatchLoc: 'Nashik' },
  { group: '', customer: 'Gamma Ice', dispatchLoc: 'Chennai' },
];
const sku = (over = {}) => ({ id: 'S1', lead_id: 'L2', sku_name: '200g Pouch', category: 'Oil', dispatch_form: 'Pouch', created_by: REP, created_at: '2026-09-01T00:00:00Z', ...over });

/* ═══════════════ the rep's book ═══════════════ */
describe('Sales Login — leads and customers', () => {
  it('splits the book: allocated / own leads vs converted ones and KAM customers', () => {
    const book = repBook({ leads }, customers, REP);
    expect(book.leads.map((l) => l.id)).toEqual(['L1']);
    expect(book.customers.map((l) => l.id).sort()).toEqual(['L2', 'L3']);   // L3: KAM
    expect(isCustomerLead({ client_name: 'beta foods' }, customers)).toBe(true);
    expect(isCustomerLead({ client_name: 'Nobody' }, customers)).toBe(false);
  });

  it('offers a customer the Super Admin\'s despatch locations, and a lead its own delivery location', () => {
    expect(despatchLocationsFor(leads[1], customers)).toEqual(['Pune', 'Nashik']);
    expect(despatchLocationsFor(leads[0], customers, ['Hyderabad', 'Bengaluru'])).toEqual(['Hyderabad', 'Bengaluru']);
  });

  it('lets the rep add categories to a lead they hold without touching another rep\'s assignment', () => {
    const shared = { id: 'L9', client_name: 'Shared', categories: ['Dairy'], category_assignments: { Dairy: 'R2' } };
    const out = setLeadCategories([shared], 'L9', ['Dairy', 'Oil'], REP)[0];
    expect(out.categories).toEqual(['Dairy', 'Oil']);
    expect(out.category_assignments).toEqual({ Dairy: 'R2', Oil: REP });
    const dropped = setLeadCategories([out], 'L9', ['Dairy'], REP)[0];
    expect(dropped.category_assignments).toEqual({ Dairy: 'R2' });
  });

  it('renames the old Negotiations module to the three quotation tabs', () => {
    expect(repModulesOf({ modules: ['visit', 'nego'] }).sort()).toEqual(['accepted', 'quotes', 'send', 'visit']);
    expect(repModulesOf({})).toContain('accepted');
  });
});

/* ═══════════════ the CSA requisition ═══════════════ */
describe('Sales Login — the CSA requisition', () => {
  it('works the bulk-bag gusset arithmetic as written', () => {
    expect(bulkBagTotals({ gusset_type: 'Bottom gusset', pouch_width_mm: 300, gusset_mm: 50, pouch_height_mm: 400 })).toEqual({ totalGusset: 100, totalHeight: 500, totalWidth: 300 });
    expect(bulkBagTotals({ gusset_type: 'Side gusset', pouch_width_mm: 300, gusset_mm: 50, pouch_height_mm: 400 })).toEqual({ totalGusset: 200, totalHeight: 400, totalWidth: 500 });
  });

  it('maps the Super Admin\'s despatch-form names to their field sets', () => {
    expect(despatchKind('Shrink Sleeve')).toBe('shrink');
    expect(despatchKind('Bulk Bags')).toBe('bulk');
    expect(despatchKind('Label')).toBe('labels');
    expect(despatchKind('Roll')).toBe('roll');
    expect(despatchKind('Pouch')).toBe('pouch');
  });

  it('needs the location, quantity, date and target price, keeps the form-specific details, and lands on QC\'s list', () => {
    const s = sku({ dispatch_form: 'Bulk Bags' });
    expect(() => buildCsaRequest({}, s)).toThrow(/despatch location/);
    const req = buildCsaRequest({ despatch_location: 'Pune', tentative_qty: '10000', tentative_date: '2026-10-01', target_price: '2.5',
      gusset_type: 'Side gusset', pouch_width_mm: '300', gusset_mm: '50', pouch_height_mm: '400', packing_instructions: 'x' }, s, { now: new Date('2026-09-15T10:00:00Z'), user: 'rep1' });
    expect(req.kind).toBe('bulk');
    expect(req.details.totalWidth).toBe(500);
    expect(req.details.packing_instructions).toBeUndefined();   // not a bulk-bag field
    const skus = sendSkuForCsa([s], 'S1', req);
    expect(skus[0].csa_requested).toBe(true);
    expect(csaPendingForQc({ skus, qc_reports: [] }).map((x) => x.id)).toEqual(['S1']);
    expect(csaPendingForQc({ skus, qc_reports: [{ sku_id: 'S1' }] })).toEqual([]);
    // the old boolean toggles still count
    expect(csaPendingForQc({ skus: [sku({ sample_received: true, sample_sent: true })], qc_reports: [] })).toHaveLength(1);
  });
});

/* ═══════════════ quotations ═══════════════ */
describe('Sales Login — quotations: the desk\'s price is a floor', () => {
  const sales = {
    skus: [sku()],
    quotations: [{ id: 'q1', lead_id: 'L2', version: 1, items: [{ sku_id: 'S1', tiers: [{ qty: 100000, price_wo_gst: 2.5 }, { qty: 200000, price_wo_gst: 2.25 }] }] },
      { id: 'q0', lead_id: 'L2', version: 0, items: [{ sku_id: 'S1', tiers: [{ qty: 100000, price_wo_gst: 9 }] }] }],
  };

  it('reads the latest desk quotation per MOQ, and the floor for a quantity', () => {
    const desk = deskTiersForSku(sales, 'S1');
    expect(desk).toEqual([{ qty: 100000, price: 2.5 }, { qty: 200000, price: 2.25 }]);
    expect(floorFor(desk, 150000)).toBe(2.5);
    expect(floorFor(desk, 250000)).toBe(2.25);
    expect(quoteStatusOf(sales, sales.skus[0])).toBe('to_send');
  });

  it('lets the rep raise a slab but never go below the desk', () => {
    const desk = deskTiersForSku(sales, 'S1');
    expect(() => saveRepQuote(sales.skus, 'S1', [{ qty: 100000, price: 2.4 }], desk)).toThrow(/below the quote desk/);
    const skus = saveRepQuote(sales.skus, 'S1', [{ qty: 100000, price: 2.6 }, { qty: 200000, price: 2.25 }], desk, { user: 'rep1' });
    expect(repTiersForSku(skus[0], desk)).toEqual([{ qty: 100000, price: 2.6 }, { qty: 200000, price: 2.25 }]);
    expect(skus[0].quote_status).toBe('to_send');
  });

  it('sending keeps a history and flips the status; accepting fixes the slabs the PO is checked against', () => {
    const now = new Date('2026-09-15T10:00:00Z');
    let skus = saveRepQuote(sales.skus, 'S1', [{ qty: 100000, price: 2.6 }], deskTiersForSku(sales, 'S1'));
    skus = markQuotesSent({ ...sales, skus }, ['S1'], { now, user: 'rep1' });
    expect(skus[0].quotation_sent).toBe(true);
    expect(skus[0].quote_history).toHaveLength(1);
    expect(skus[0].quote_history[0].tiers).toEqual([{ qty: 100000, price: 2.6 }]);
    expect(quoteStatusOf({ ...sales, skus }, skus[0])).toBe('sent');
    skus = setQuoteAccepted({ ...sales, skus }, 'S1', true, { now });
    expect(skus[0].quotation_accepted).toBe(true);
    expect(skus[0].price_tiers).toEqual([{ qty: 100000, price: 2.6 }]);
    expect(quoteStatusOf({ ...sales, skus }, skus[0])).toBe('accepted');
    skus = setQuoteAccepted({ ...sales, skus }, 'S1', false);
    expect(quoteStatusOf({ ...sales, skus }, skus[0])).toBe('sent');
  });
});

/* ═══════════════ the PO and the Superstar ═══════════════ */
describe('Sales Login — the multi-SKU PO and the PO → SO list', () => {
  const accepted = sku({ quotation_accepted: true, jss_spec: 'A900', price_tiers: [{ qty: 1000, price: 12 }, { qty: 5000, price: 10 }] });
  const noJss = sku({ id: 'S2', sku_name: 'Bag', quotation_accepted: true, price_tiers: [{ qty: 1, price: 5 }] });
  const sales = { skus: [accepted, noJss], leads, pos: [] };

  it('prices each line from the accepted slab for its quantity, refuses under-pricing and a SKU without a JSS', () => {
    const rows = buildPoLines({ leadId: 'L2', customer: 'Beta Foods', despatchLocation: 'Pune', poNumber: 'PO-9', poDate: '2026-09-15', lines: [{ skuId: 'S1', qty: 6000, price: '' }] }, sales, REP);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ jss_spec: 'A900', qty: 6000, price: 10, po_number: 'PO-9', despatch_location: 'Pune', customer: 'Beta Foods' });
    expect(() => buildPoLines({ leadId: 'L2', poNumber: 'PO-9', poDate: '2026-09-15', lines: [{ skuId: 'S1', qty: 6000, price: 9 }] }, sales, REP)).toThrow(/below the accepted/);
    expect(() => buildPoLines({ leadId: 'L2', poNumber: 'PO-9', poDate: '2026-09-15', lines: [{ skuId: 'S2', qty: 10 }] }, sales, REP)).toThrow(/QC has not created the JSS/);
    expect(() => buildPoLines({ leadId: 'L2', poNumber: 'PO-9', poDate: '2026-09-15', lines: [{ skuId: 'S1', qty: 10 }, { skuId: 'S1', qty: 20 }] }, sales, REP)).toThrow(/twice/);
  });

  it('groups the lines of one PO for the Superstar, and drops them once pushed', () => {
    const rows = buildPoLines({ leadId: 'L2', customer: 'Beta Foods', despatchLocation: 'Pune', poNumber: 'PO-9', poDate: '2026-09-15', lines: [{ skuId: 'S1', qty: 6000 }] }, sales, REP);
    const pending = pendingRepPos({ pos: rows });
    expect(pending).toHaveLength(1);
    expect(pending[0].lines).toHaveLength(1);
    expect(pending[0].po_number).toBe('PO-9');
    const pushed = markPosPushed(rows, rows.map((r) => r.id), { so: '26/901', by: 'superstar' });
    expect(pendingRepPos({ pos: pushed })).toEqual([]);
    expect(pushed[0].pushed_to_oab.so).toBe('26/901');
  });

  it('a meeting carries its cost, and the costs split into convert vs retain', () => {
    const meet = buildRepVisit({ leadId: 'L1', type: 'Meeting', outcome: 'lunch', expense: '1500' }, REP);
    const call = buildRepVisit({ leadId: 'L2', type: 'Call', outcome: 'x', expense: '999' }, REP);
    const visit = buildRepVisit({ leadId: 'L2', type: 'Visit', outcome: 'x', expense: '400' }, REP);
    expect(meet.expense).toBe(1500);
    expect(call.expense).toBe(0);
    expect(costIncurred({ leads, interactions: [meet, call, visit] }, customers)).toEqual({ convert: 1500, retain: 400, total: 1900 });
  });
});

/* ═══════════════ QC creates the JSS from the accepted CSA ═══════════════ */
describe('QC — JSS from the accepted CSA', () => {
  it('lists only converted customers with an accepted quote and no JSS yet, and fills the JSS form from the CSA', () => {
    const skus = [
      sku({ id: 'S1', quotation_accepted: true, structure: 'PET 12 / LDPE 50', csa_request: { despatch_location: 'Pune', details: { pouch_width_mm: 150, pouch_height_mm: 220 } } }),
      sku({ id: 'S2', lead_id: 'L1', quotation_accepted: true }),          // a lead, not a customer
      sku({ id: 'S3', quotation_accepted: true, jss_spec: 'A1' }),         // already has its JSS
      sku({ id: 'S4' }),                                                   // not accepted
    ];
    const reports = [{ id: 'c1', sku_id: 'S1', substrate1: 'PET', substrate1_val: 12, substrate2: 'LDPE', gsm: 80, pouch_weight: 4.2 }];
    const cands = csaCandidatesForJss({ skus, leads, qc_reports: reports }, customers);
    expect(cands.map((c) => c.sku.id)).toEqual(['S1']);
    const f = jssFieldsFromCsa({ ...cands[0], customers });
    expect(f).toMatchObject({ group: 'BETA GROUP', customer: 'Beta Foods', jobName: '200g Pouch', material: 'PET 12 / LDPE 50', mic: '12', gsm: '80', width: '150', height: '220', pouchWeight: '4.2', dispatchForm: 'Pouch', status: 'Active' });
  });
});

/* ═══════════════ Sales History — groups and the rep ═══════════════ */
describe('Sales History — the group list and the rep name', () => {
  it('lists the customer master\'s groups only, and never shows a raw rep id', () => {
    const ctx = { customers: [{ group: 'AMAZON', customer: 'Amazon Retail' }], sales: { leads: [{ client_name: 'More', assigned_to: 'rep_1786510490948_qdjdgo', kam: 'rep_zzz' }, { client_name: 'Amazon Retail', kam: 'r1', assigned_to: 'r1' }], sales_users: [{ id: 'r1', display_name: 'Ravi' }] } };
    const lines = [{ spec: 'A1', group: 'AMAZON INDIA PVT.LTD.', customer: 'Amazon Retail' }];
    expect(filterOptions(lines, ctx).groups).toEqual(['AMAZON']);
    expect(repFor('More', ctx)).toEqual({ kam: '', rep: '', found: true });
    expect(repFor('Amazon Retail', ctx)).toEqual({ kam: 'Ravi', rep: 'Ravi', found: true });
  });
});

/* ═══════════════ HR audit in words ═══════════════ */
describe('HR — the audit details read in words', () => {
  it('turns the logged JSON into labels and values', () => {
    expect(auditDetailsText('{"id":2,"title":"Executive Assistant","departmentId":11,"departmentName":"HO","active":false}')).toBe('Title: Executive Assistant · Department: HO · Active: no');
    expect(auditDetailsText({ from: 'Active', to: 'Left' })).toBe('From: Active · To: Left');
    expect(auditDetailsText('plain text')).toBe('plain text');
  });
});

/* ═══════════════ screens ═══════════════ */
const res = (body, status = 200) => ({ status, ok: status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const ITEMS = [
  { id: 37, code: 'BLM037', name: '1200 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', uom: 'Kg', widthMm: 1200 },
  { id: 34, code: 'BLM034', name: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', uom: 'Kg', widthMm: 700 },
  { id: 90, code: 'INK01', name: 'CYAN INK', materialType: 'INK', subGroup: 'PROCESS', specialtyName: '', uom: 'Kg' },
];
const ON_HAND = ITEMS.map((it) => ({ ...it, closingStock: 200, unitCount: 1, departmentName: 'Printing', stockValue: 1000, msl: 0, byStatus: {}, active: true }));
const UNITS_37 = [{ id: 11, itemId: 37, internalCode: 'BLMU-7', qtyRemaining: 0, qtyReceived: 1000, widthMm: 1200, uom: 'Kg', location: 'A2', status: 'MOVING', childWidth: 0, childWeight: 0, childCount: 0, receivedAt: '2026-09-01T00:00:00Z' }];
const UNITS_90 = [{ id: 21, itemId: 90, internalCode: 'BLMU-9', qtyRemaining: 5, qtyReceived: 10, uom: 'Kg', location: 'C1', status: 'MOVING', receivedAt: '2026-09-01T00:00:00Z' }];
const ALL_UNITS = [{ id: 11, itemId: 37, internalCode: 'BLMU-7' }, { id: 12, itemId: 34, internalCode: 'BLMU-332', parentUnitId: 11 }, { id: 21, itemId: 90, internalCode: 'BLMU-9' }];
const LINES = [
  { txnId: 501, slipNo: 'ISS/2026/3', lineNo: 'ISS/2026/3.1', unitId: 11, internalCode: 'BLMU-7', itemId: 37, itemCode: 'BLM037', itemName: '1200 MM', materialType: 'FILM', uom: 'Kg', widthMm: 1200, qtyIssued: 1000, qtyReturned: 500, rollsReturned: 2, so: '26/737', department: 'Printing', ts: '2026-09-14T10:00:00Z' },
  { txnId: 502, slipNo: 'ISS/2026/3', lineNo: 'ISS/2026/3.2', unitId: 21, internalCode: 'BLMU-9', itemId: 90, itemCode: 'INK01', itemName: 'CYAN INK', materialType: 'INK', uom: 'Kg', qtyIssued: 5, qtyReturned: 0, rollsReturned: 0, so: '26/737', department: 'Printing', ts: '2026-09-14T10:00:00Z' },
];
const TRACE = { unit: { id: 12, internalCode: 'BLMU-332', itemCode: 'BLM034', parentUnitId: 11, uom: 'Kg' },
  parent: { id: 11, internalCode: 'BLMU-7', itemCode: 'BLM037', itemName: '1200 MM', widthMm: 1200, qtyReceived: 1000, uom: 'Kg', supplier: 'Cosmos', location: 'A2' },
  issue: LINES[0], returns: [{ txnId: 601, returnNo: 'RET/2026/3.1/2', issueTxnId: 501, qty: 250, department: 'Printing', so: '26/737', ts: '2026-09-15T09:00:00Z', actor: 'store' }],
  siblings: [{ id: 13, internalCode: 'BLMU-333', itemCode: 'BLM034', widthMm: 700, qtyRemaining: 250, uom: 'Kg', location: 'A2', status: 'MOVING' }], children: [] };

let posted, slipSaved;
beforeEach(() => {
  posted = []; slipSaved = [];
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: { asl: [], pos: [] }, oab: { OAB: { SF: [{ so: '26/737', spec: 'A737', customer: 'AMAZON', closed: false }], OT: [] } } }, save: vi.fn(), reloadModule: vi.fn() }) }));
  vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ role: 'stores', user: 'store' }) }));
  vi.doMock('../lib/issueSlipPdf.js', () => ({ saveIssueSlipPdf: vi.fn((slip) => { slipSaved.push(slip); return 'x.pdf'; }), buildIssueSlipPdf: vi.fn(), buildReturnSlipPdf: vi.fn() }));
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET') !== 'GET') {
      const body = JSON.parse(opts.body || '{}');
      posted.push({ u, method: opts.method, body });
      if (u.includes('/api/stores/returns')) return res({ unitId: body.unitId || 11, issueTxnId: 501, issueLineNo: 'ISS/2026/3.1', issueSlipNo: 'ISS/2026/3', returned: [{ unitId: 11, internalCode: 'BLMU-7', qty: body.qty, returnNo: 'RET/2026/3.1/3' }], returnNos: ['RET/2026/3.1/3'] });
      return res({});
    }
    if (u.includes('/api/stores/issue-lines')) return res(LINES);
    if (u.includes('/api/stores/units/12/trace')) return res(TRACE);
    if (u.includes('/api/stores/items/37/units')) return res(UNITS_37);
    if (u.includes('/api/stores/items/90/units')) return res(UNITS_90);
    if (u.match(/\/api\/stores\/items\/\d+\/units/)) return res([]);
    if (u.includes('/api/stores/units?') || u.endsWith('/api/stores/units')) return res(ALL_UNITS);
    if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
    if (u.includes('/api/stores/slips')) return res({ kind: 'RETURN', returnNo: 'RET/2026/3.1/3', slipNo: 'RET/2026/3.1/3', lines: [] });
    if (u.includes('/api/stores/txns')) return res([
      { id: 1, kind: 'ISSUE', qty: 1000, so: '26/737', department: 'Printing', slipNo: 'ISS/2026/3', lineNo: 'ISS/2026/3.1', internalCode: 'BLMU-7', itemCode: 'BLM037', ts: '2026-09-14T10:00:00Z' },
      { id: 2, kind: 'RETURN', qty: 250, so: '26/737', department: 'Printing', returnNo: 'RET/2026/3.1/1', issueTxnId: 501, internalCode: 'BLMU-332', itemCode: 'BLM034', ts: '2026-09-15T10:00:00Z' },
    ]);
    if (u.includes('/api/stores/next-codes')) return res({ codes: ['BLMU-20', 'BLMU-21'] });
    if (u.includes('/api/stores/so-context')) return res({ so: '26/737', found: true, spec: 'A737', route: { departments: [{ departmentName: 'Printing' }] }, bom: { items: [] } });
    if (u.includes('/api/master/items')) return res(ITEMS);
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing', active: true, scope: 'PRODUCTION' }]);
    if (u.includes('/api/planning/week')) return res({ jobs: [] });
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

async function mountStores(tab) {
  const { default: Stores } = await import('../pages/Stores.jsx');
  render(<Stores />);
  if (tab) fireEvent.click(await screen.findByText(tab));
}

describe('Stores — returns against the roll-wise issue line', () => {
  it('lists the open lines, books the return against the picked one, and prints its return slip', async () => {
    await mountStores('🔄 Issues & Returns');
    fireEvent.click(screen.getByText('↙ Receive a return'));
    const lineSel = await screen.findByLabelText('Issue line');
    await waitFor(() => expect(within(lineSel).getAllByRole('option').length).toBe(3));
    const opt = within(lineSel).getAllByRole('option').find((o) => o.value === '501');
    expect(opt.textContent.replace(/\s+/g, ' ')).toMatch(/ISS\/2026\/3\.1 · BLMU-7 · BLM037 1,?200mm · 1,000 Kg out · 500 back \(2\)/);
    fireEvent.change(lineSel, { target: { value: '501' } });
    const picked = await screen.findByLabelText('Picked issue line');
    expect(picked).toHaveTextContent('still out 500 Kg');
    expect(picked).toHaveTextContent('next return slip RET/2026/3.1/3');
    // the roll follows the line
    await waitFor(() => expect(screen.getByLabelText('Internal code of the roll')).toHaveValue('BLMU-7'));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '250' } });
    fireEvent.click(screen.getByText(/↙ Receive return/));
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/stores/returns'))).toBe(true));
    const body = posted.find((p) => p.u.includes('/api/stores/returns')).body;
    expect(body.issueTxnId).toBe(501);
    expect(body.qty).toBe(250);
    await waitFor(() => expect(slipSaved.length).toBe(1));
    expect(slipSaved[0].returnNo).toBe('RET/2026/3.1/3');
    expect(await screen.findByText(/Return slip RET\/2026\/3\.1\/3 downloaded/)).toBeInTheDocument();
  });

  it('enables "cut into narrower rolls" for film only', async () => {
    await mountStores('🔄 Issues & Returns');
    fireEvent.click(screen.getByText('↙ Receive a return'));
    const lineSel = await screen.findByLabelText('Issue line');
    await waitFor(() => expect(within(lineSel).getAllByRole('option').length).toBe(3));
    fireEvent.change(lineSel, { target: { value: '502' } });     // the ink
    await waitFor(() => expect(screen.getByLabelText('Returned as narrower rolls')).toBeDisabled());
    expect(screen.getByText(/film only/)).toBeInTheDocument();
    fireEvent.change(lineSel, { target: { value: '501' } });     // the film
    await waitFor(() => expect(screen.getByLabelText('Returned as narrower rolls')).not.toBeDisabled());
  });

  it('the history shows the roll-wise numbers and downloads either slip as PDF', async () => {
    await mountStores('🔄 Issues & Returns');
    expect(await screen.findByText('ISS/2026/3.1')).toBeInTheDocument();
    expect(screen.getByText('RET/2026/3.1/1')).toBeInTheDocument();
    expect(screen.getAllByText('⬇ Download as PDF').length).toBe(2);
    fireEvent.click(screen.getByLabelText('Download slip RET/2026/3.1/1'));
    await waitFor(() => expect(globalThis.fetch.mock.calls.some((c) => String(c[0]).includes('/api/stores/slips?no=RET%2F2026%2F3.1%2F1'))).toBe(true));
  });
});

describe('Stores — the on-hand board', () => {
  it('finds an item by a roll\'s internal code, and the split tag opens the trace', async () => {
    await mountStores();
    await screen.findByText('BLM037');
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: '332' } });
    await waitFor(() => expect(screen.queryByText('BLM037')).toBeNull());
    expect(screen.getByText('BLM034')).toBeInTheDocument();     // BLMU-332 is a roll of BLM034
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'blmu-7' } });
    await waitFor(() => expect(screen.getByText('BLM037')).toBeInTheDocument());
  });

  it('shows the parent roll, the issue line and the return slip behind a split roll', async () => {
    // the units of BLM034 include the split child
    globalThis.fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/api/stores/items/34/units')) return res([{ id: 12, itemId: 34, internalCode: 'BLMU-332', qtyRemaining: 176, qtyReceived: 250, widthMm: 700, uom: 'Kg', location: 'AG', status: 'MOVING', parentUnitId: 11, receivedAt: '2026-09-15T00:00:00Z' }]);
      if (u.includes('/api/stores/units/12/trace')) return res(TRACE);
      if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
      if (u.includes('/api/stores/units')) return res(ALL_UNITS);
      return res([]);
    });
    await mountStores();
    fireEvent.click(await screen.findByText('BLM034'));
    fireEvent.click(await screen.findByLabelText('Where BLMU-332 came from'));
    const modal = await screen.findByLabelText('Trace of BLMU-332');
    await waitFor(() => expect(within(modal).getByText(/BLMU-7 · BLM037/)).toBeInTheDocument());
    expect(within(modal).getByText('ISS/2026/3.1')).toBeInTheDocument();
    expect(within(modal).getByText('RET/2026/3.1/2')).toBeInTheDocument();
    expect(within(modal).getByText('BLMU-333')).toBeInTheDocument();
    expect(within(modal).getByLabelText('Download return slip RET/2026/3.1/2')).toBeInTheDocument();
  });
});

describe('Drop-down selections — designations and HR-only departments', () => {
  it('adds a designation with no department, and an HR-only department beside it', async () => {
    vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { sales: {} }, save: vi.fn(), loading: false }) }));
    vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ role: 'superadmin', user: 'boss' }) }));
    globalThis.fetch.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      if ((opts.method || 'GET') !== 'GET') { posted.push({ u, body: JSON.parse(opts.body || '{}') }); return res({ id: 9 }, 201); }
      if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing', active: true, scope: 'PRODUCTION', hrOnly: false }, { id: 2, name: 'Accounts', active: true, scope: 'HR', hrOnly: true, employees: 3 }]);
      if (u.includes('/api/hr/designations')) return res([{ id: 20, title: 'OPERATOR', departmentId: null, active: true }]);
      return res([]);
    });
    const { default: DropdownAdmin } = await import('../components/DropdownAdmin.jsx');
    render(<DropdownAdmin />);
    fireEvent.click((await screen.findAllByText(/Designations & HR-only departments/))[0]);
    await screen.findByLabelText('Designation OPERATOR');
    expect(screen.queryByLabelText('Department for the new designation')).toBeNull();
    await userEvent.type(screen.getByLabelText('New designation'), 'INCHARGE');
    fireEvent.click(screen.getByText('＋ Add'));
    await waitFor(() => expect(posted.some((p) => p.u.includes('/api/hr/designations'))).toBe(true));
    expect(posted.find((p) => p.u.includes('/api/hr/designations')).body).toEqual({ title: 'INCHARGE' });
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('New HR-only department'), 'Billing');
    fireEvent.click(screen.getByText('＋ Add HR-only department'));
    await waitFor(() => expect(posted.some((p) => p.u.endsWith('/api/master/departments'))).toBe(true));
    expect(posted.find((p) => p.u.endsWith('/api/master/departments')).body).toEqual({ name: 'Billing', scope: 'HR' });
  });
});
