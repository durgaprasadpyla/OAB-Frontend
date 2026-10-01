import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderApp } from './harness.jsx';
import { useData } from '../data.jsx';
import RepPortal from '../pages/RepPortal.jsx';
import QuotationDesk from '../pages/QuotationDesk.jsx';
import QC, { csaLayersForJss } from '../pages/QC.jsx';
import PM from '../pages/PM.jsx';
import PoToSo from '../pages/PoToSo.jsx';
import NewPO from '../pages/NewPO.jsx';
import {
  skuOwnerRep, linkDirectCsa, quotableSkus, deskTiersForSku, deskItemForSku, parseMoq, saveRepQuote,
  quoteStatusOf, markQuotesSent, setQuoteAccepted, repTiersForSku, deskQuoteForSku, pendingRepPos, markPosPushed,
  buildCsaRequest, sendSkuForCsa, repBook,
} from '../lib/repFlow.js';
import { quotesToSend, quoteFollowUps } from '../lib/repPortal.js';
import { applyQuoteSideEffects } from '../lib/sales.js';
import { buildCsaReport, csaStatusLabel } from '../lib/csa.js';

// Issues as on 30.09.2026 — QUOTATIONS (QT1-QT7) and the Superstar's PO → SO (PE3).
// "Not yet tested because prior issues pending — must WORK end to end": the last
// describe block drives one SKU through every login on ONE shared sales blob.

const R1 = 'R1';
const R2 = 'R2';
const USERS = [
  { id: R1, username: 'rep1', display_name: 'Rep One', status: 'Active' },
  { id: R2, username: 'rep2', display_name: 'Rep Two', status: 'Active' },
];
const CUSTOMERS = [
  { group: 'BETA GROUP', customer: 'Beta Foods', dispatchLoc: 'Pune', warehouseName: 'W1' },
  { group: 'BETA GROUP', customer: 'Beta Foods', dispatchLoc: 'Nashik', warehouseName: '' },
];
const MASTER_ITEMS = [
  { code: 'BLM100', name: '600 MM', materialType: 'FILM', subGroup: 'PET', specialtyName: '', microns: '12', widthMm: 600, uom: 'Kg', active: true },
  { code: 'BLM101', name: '600 MM', materialType: 'FILM', subGroup: 'LDPE', specialtyName: '', microns: '60', widthMm: 600, uom: 'Kg', active: true },
];
const salesModule = (over = {}) => ({
  leads: [], contacts: [], interactions: [], skus: [], pos: [], quotations: [], qc_reports: [],
  sales_users: USERS, targets: [], substrate_options: [], nego_msgs: [], dropdowns: { despatch: ['Roll', 'Pouch', 'Bulk Bags'] }, ...over,
});
const lastSales = (saved) => saved.filter((s) => s.key === 'sales').pop().data;
const tab = async (label) => userEvent.click(await screen.findByText(label));
const deskTab = async (re) => userEvent.click([...document.querySelectorAll('.step-tab')].find((el) => re.test(el.textContent)));
/** A field that is a drop-down on one build and a box on another (the CSA micron). */
async function setField(el, v) {
  if (el.tagName === 'SELECT') await userEvent.selectOptions(el, v);
  else { await userEvent.clear(el); await userEvent.type(el, v); }
}

/* ═══════════════ QT2: who a quotation lands on ═══════════════ */
describe('QT2 — the quotation goes to the rep the Super Admin allocated', () => {
  const leads = [
    { id: 'L1', client_name: 'Split Co', categories: ['Dairy', 'Oil'], category_assignments: { Dairy: R1, Oil: R2 }, created_by: R1 },
    { id: 'L2', client_name: 'Kam Co', kam: R2, assigned_to: R1, category_assignments: {} },
    { id: 'L3', client_name: 'Owner Co', assigned_to: R2 },
    { id: 'L4', client_name: 'One Rep Co', categories: ['Dairy', 'Oil'], category_assignments: { Dairy: R2, Oil: R2 } },
  ];
  const sales = { leads };

  it('category assignment > KAM > assigned_to > creator', () => {
    expect(skuOwnerRep(sales, { lead_id: 'L1', category: 'Dairy', created_by: R2 })).toBe(R1);
    expect(skuOwnerRep(sales, { lead_id: 'L1', category: 'Oil', created_by: R1 })).toBe(R2);
    expect(skuOwnerRep(sales, { lead_id: 'L2', category: 'Ice', created_by: R1 })).toBe(R2);   // KAM before the owner
    expect(skuOwnerRep(sales, { lead_id: 'L3', category: '', created_by: R1 })).toBe(R2);
    expect(skuOwnerRep(sales, { lead_id: 'L4', category: '' })).toBe(R2);                      // one rep holds every category
    expect(skuOwnerRep(sales, { lead_id: 'nope', created_by: R1 })).toBe(R1);                  // no lead: the creator
    expect(skuOwnerRep(sales, { lead_id: 'nope', created_by: 'quote' })).toBe('');             // the desk is not a rep
  });

  it('a lead split by category shows each rep only its own SKUs — list, banner and follow-ups alike', () => {
    const skus = [
      { id: 'S1', lead_id: 'L1', sku_name: 'Dairy pouch', category: 'Dairy', created_by: R1 },
      { id: 'S2', lead_id: 'L1', sku_name: 'Oil pouch', category: 'Oil', created_by: R1 },
      { id: 'S3', lead_id: 'L2', sku_name: 'KAM pouch', category: 'Ice', created_by: R1 },
      { id: 'S4', lead_id: 'L2', sku_name: 'KAM accepted', category: 'Ice', created_by: R1, quotation_accepted: true },
    ];
    const quotations = [{ id: 'q', lead_id: 'L1', version: 1, items: skus.map((s) => ({ sku_id: s.id, tiers: [{ qty: 100, price_wo_gst: 2 }] })) }];
    const all = { leads, skus, quotations, pos: [] };
    expect(quotableSkus(all, R1).map((s) => s.id)).toEqual(['S1']);
    expect(quotableSkus(all, R2).map((s) => s.id).sort()).toEqual(['S2', 'S3', 'S4']);
    // the banner follows the allocation, not who typed the SKU in
    expect(quotesToSend(all, R1).map((s) => s.id)).toEqual(['S1']);
    expect(quotesToSend(all, R2).map((s) => s.id).sort()).toEqual(['S2', 'S3']);
    expect(quoteFollowUps(all, R2).map((s) => s.id)).toEqual(['S4']);
    expect(quoteFollowUps(all, R1)).toEqual([]);
  });

  it('links a direct CSA to a lead and a SKU once — a customer from the master comes in converted', () => {
    const report = { id: 'd1', source: 'direct', company_name: 'Zeta Foods', product_desc: '1kg Zeta Bag', party_kind: 'customer', dispatch_type: 'Pouch', substrate1: 'PET', substrate2: 'LDPE', status: 'Pending Quote', plant_comments: 'ok' };
    let n = 0;
    const uid = (p) => `${p}_${++n}`;
    const first = linkDirectCsa({ leads: [], skus: [], qc_reports: [report] }, 'd1', { uid });
    const lead = first.sales.leads[0];
    expect(lead).toMatchObject({ client_name: 'Zeta Foods', converted_to_customer: true, stage: 'Converted', source: 'direct_csa' });
    const sku = first.sales.skus[0];
    expect(sku).toMatchObject({ id: first.skuId, lead_id: lead.id, sku_name: '1kg Zeta Bag', dispatch_form: 'Pouch', structure: 'PET + LDPE', csa_received: 'Yes', csa_report_id: 'd1' });
    expect(first.sales.qc_reports[0]).toMatchObject({ sku_id: sku.id, lead_id: lead.id, source: 'direct' });
    // a second call finds the same pair
    const again = linkDirectCsa(first.sales, 'd1', { uid });
    expect(again.skuId).toBe(first.skuId);
    expect(again.sales.skus).toHaveLength(1);
    expect(again.sales.leads).toHaveLength(1);
    // an existing lead of that name (any spelling) is reused — and the KAM gets the quote
    const viaKam = linkDirectCsa({ leads: [{ id: 'LZ', client_name: 'ZETA  FOODS', kam: R1 }], skus: [], qc_reports: [report] }, 'd1', { uid });
    expect(viaKam.leadId).toBe('LZ');
    expect(viaKam.sales.leads).toHaveLength(1);
    expect(skuOwnerRep(viaKam.sales, viaKam.sales.skus[0])).toBe(R1);
    // a lead stays a lead until the Super Admin converts it
    const asLead = linkDirectCsa({ leads: [], skus: [], qc_reports: [{ ...report, party_kind: 'lead' }] }, 'd1', { uid });
    expect(asLead.sales.leads[0].converted_to_customer).toBe(false);
  });
});

/* ═══════════════ QT3: status, MOQ, floor ═══════════════ */
describe('QT3 — status, MOQ and the floor', () => {
  const quote = (over = {}) => ({ id: 'q1', lead_id: 'L2', version: 1, created_at: '2026-09-18T00:00:00Z', items: [{ sku_id: 'S1', moq: '1,00,000', item_code: 'IC-77', tiers: [{ qty: 0, price_wo_gst: 2.5 }] }], ...over });

  it('reads the desk MOQ into a flat-price slab', () => {
    expect(parseMoq('1,00,000')).toBe(100000);
    expect(parseMoq('50000 nos')).toBe(50000);
    expect(parseMoq('1 lakh')).toBe(100000);
    expect(parseMoq('25k')).toBe(25000);
    expect(parseMoq('')).toBe(0);
    const sales = { quotations: [quote()] };
    expect(deskTiersForSku(sales, 'S1')).toEqual([{ qty: 100000, price: 2.5 }]);
    expect(deskItemForSku(sales, 'S1').item_code).toBe('IC-77');
  });

  it('flips a sent quote back to "to be sent" when an amount is edited, and back again on re-send', () => {
    const sales = { quotations: [quote()], skus: [{ id: 'S1', sku_name: 'Pouch' }] };
    const desk = deskTiersForSku(sales, 'S1');
    let skus = markQuotesSent(sales, ['S1'], { now: new Date('2026-09-20T00:00:00Z') });
    expect(quoteStatusOf({ ...sales, skus }, skus[0])).toBe('sent');
    skus = saveRepQuote(skus, 'S1', [{ qty: 100000, price: 2.6 }], desk, { now: new Date('2026-09-21T00:00:00Z') });
    expect(skus[0].rep_quote.changed_after_send).toBe(true);
    expect(quoteStatusOf({ ...sales, skus }, skus[0])).toBe('to_send');
    skus = markQuotesSent({ ...sales, skus }, ['S1'], { now: new Date('2026-09-22T00:00:00Z') });
    expect(quoteStatusOf({ ...sales, skus }, skus[0])).toBe('sent');
    expect(skus[0].quote_history).toHaveLength(2);
    // saving the same figures that went out is not a change
    skus = saveRepQuote(skus, 'S1', [{ qty: 100000, price: 2.6 }], desk, { now: new Date('2026-09-23T00:00:00Z') });
    expect(quoteStatusOf({ ...sales, skus }, skus[0])).toBe('sent');
  });

  it('a newer desk quotation supersedes the rep\'s older slabs and re-opens the send', () => {
    const own = { id: 'S1', sku_name: 'Pouch', quotation_sent: true, quotation_sent_at: '2026-09-20T00:00:00Z', rep_quote: { tiers: [{ qty: 100000, price: 2.6 }], saved_at: '2026-09-19T00:00:00Z' } };
    const v2 = quote({ id: 'q2', version: 2, created_at: '2026-09-25T00:00:00Z', items: [{ sku_id: 'S1', moq: '100000', tiers: [{ qty: 0, price_wo_gst: 3 }] }] });
    const sales = { quotations: [quote(), v2], skus: [own] };
    expect(repTiersForSku(own, deskTiersForSku(sales, 'S1'), deskQuoteForSku(sales, 'S1'))).toEqual([{ qty: 100000, price: 3 }]);
    expect(quoteStatusOf(sales, own)).toBe('to_send');
  });

  it('refuses to send or accept under the desk\'s current figure', () => {
    // a desk re-quote on file without a date: the rep's slabs stand, and are checked
    const own = { id: 'S1', sku_name: 'Pouch', rep_quote: { tiers: [{ qty: 100000, price: 2.6 }], saved_at: '2026-09-19T00:00:00Z' } };
    const v2 = { id: 'q2', lead_id: 'L2', version: 2, items: [{ sku_id: 'S1', tiers: [{ qty: 100000, price_wo_gst: 3 }] }] };
    const sales = { quotations: [quote(), v2], skus: [own] };
    expect(() => markQuotesSent(sales, ['S1'])).toThrow(/Pouch: ₹2.6 for 100000 is below the quote desk's ₹3/);
    expect(() => setQuoteAccepted(sales, 'S1', true)).toThrow(/below the quote desk/);
  });
});

/* ═══════════════ QT1 / PE3: the record fields readers read ═══════════════ */
describe('QT1 / PE3 — the names written are the names read', () => {
  it('a quotation stamps quoted_at and its id on the CSA report', () => {
    const out = applyQuoteSideEffects({ id: 'qt9', created_at: '2026-09-30T10:00:00Z', items: [{ sku_id: 'S1' }] }, { qcReports: [{ sku_id: 'S1', status: 'Pending Quote' }, { sku_id: null, status: 'Pending Quote' }], skus: [] });
    expect(out.qc_reports[0]).toMatchObject({ status: 'Quoted', quoted_at: '2026-09-30T10:00:00Z', quote_id: 'qt9' });
    expect(out.qc_reports[1].status).toBe('Pending Quote');      // a direct report with no SKU is not touched
  });

  it('the CSA carries the despatch form the rep wrote, and "Pending QC" reads "Pending Quote"', () => {
    const r = buildCsaReport({}, { sales: { skus: [{ id: 'S1', lead_id: 'L1', dispatch_form: 'Roll' }] }, skuId: 'S1', uid: () => 'c' });
    expect(r.dispatch_type).toBe('Roll');
    expect(csaStatusLabel('Pending QC')).toBe('Pending Quote');
    expect(csaStatusLabel('Quoted')).toBe('Quoted');
  });

  it('the PO → SO list carries the warehouse, and each line is stamped with its own sale order', () => {
    const pos = [
      { id: 'p1', po_ref: 'r', po_number: 'PO-1', warehouse_name: 'KOVAI OWN', despatch_location: 'DHARAPURAM', created_at: '1' },
      { id: 'p2', po_ref: 'r', po_number: 'PO-1', warehouse_name: 'KOVAI OWN', despatch_location: 'DHARAPURAM', created_at: '1' },
    ];
    expect(pendingRepPos({ pos })[0].warehouse_name).toBe('KOVAI OWN');
    const out = markPosPushed(pos, ['p1'], { so: '26/1, 26/2', soById: { p1: '26/1' }, by: 'superstar' });
    expect(out[0].pushed_to_oab.so).toBe('26/1');
    expect(out[1].pushed_to_oab).toBeUndefined();
  });
});

/* ═══════════════ QT6: the CSA's layers become the JSS's ═══════════════ */
describe('QT6 — CSA layers onto JSS layers', () => {
  it('matches each layer to the Item Master, leaving an unknown film for QC', () => {
    const out = csaLayersForJss([
      { material: 'pet', specialty: '', microns: '12' },
      { material: 'LDPE', specialty: '', microns: '60' },
      { material: 'NYLON', specialty: '', microns: '15' },
    ], MASTER_ITEMS);
    expect(out.layers[0]).toEqual({ material: 'PET', specialty: '', microns: '12' });
    expect(out.layers[1]).toEqual({ material: 'LDPE', specialty: '', microns: '60' });
    expect(out.layers[2].material).toBe('');
    expect(out.filled).toBe(3);
    expect(out.unknown).toEqual(['NYLON']);
  });
});

/* ═══════════════ data.jsx: the opt-in retry ═══════════════ */
function Saver({ retry, failOnFresh = false }) {
  const { mods, save } = useData();
  const [m, setM] = useState('');
  async function go() {
    try {
      await save('sales', (prev) => {
        if (failOnFresh && (prev.leads || []).length) throw new Error('No longer applies.');
        return { ...prev, skus: [...(prev.skus || []), { id: 'X' }] };
      }, retry ? { retry: true } : undefined);
      setM('saved');
    } catch (e) { setM(e.message); }
  }
  return (
    <div>
      <span>leads {((mods.sales && mods.sales.leads) || []).length}</span>
      <button onClick={go}>go</button>
      <span aria-label="result">{m}</span>
    </div>
  );
}

describe('data.jsx — save(key, updater, { retry: true })', () => {
  it('reloads and re-applies a functional updater once when another login saved first', async () => {
    const r = renderApp(<Saver retry />, { modules: { sales: { leads: [], skus: [] } }, conflictOnce: { 12: true } });
    await screen.findByText('leads 0');
    r.mods.sales = { leads: [{ id: 'other' }], skus: [] };          // another login's write
    await userEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByLabelText('result')).toHaveTextContent('saved'));
    const sent = lastSales(r.saved);
    expect(sent.leads).toEqual([{ id: 'other' }]);                   // theirs kept
    expect(sent.skus).toEqual([{ id: 'X' }]);                        // ours applied on top
    expect(await screen.findByText('leads 1')).toBeInTheDocument();
  });

  it('without the option a conflict still asks the user to save again', async () => {
    const r = renderApp(<Saver />, { modules: { sales: { leads: [], skus: [] } }, conflictOnce: { 12: true } });
    await screen.findByText('leads 0');
    await userEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByLabelText('result')).toHaveTextContent(/changed on the server/));
    expect(r.saved.some((s) => s.key === 'sales')).toBe(false);
  });

  it('an edit that no longer applies to the fresh copy says why', async () => {
    const r = renderApp(<Saver retry failOnFresh />, { modules: { sales: { leads: [], skus: [] } }, conflictOnce: { 12: true } });
    await screen.findByText('leads 0');
    r.mods.sales = { leads: [{ id: 'other' }], skus: [] };
    await userEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByLabelText('result')).toHaveTextContent('No longer applies.'));
    expect(r.saved.some((s) => s.key === 'sales')).toBe(false);
  });
});

/* ═══════════════ QT1 / QT2: the quotation desk ═══════════════ */
describe('QT1 / QT2 — the desk', () => {
  const deskSales = () => salesModule({
    leads: [
      { id: 'L1', client_name: 'Acme Dairy', categories: ['Dairy'], category_assignments: { Dairy: R1 } },
      { id: 'L2', client_name: 'Beta Snacks', categories: ['Oil'], category_assignments: { Oil: R2 } },
      { id: 'L3', client_name: 'Empty Co' },
      { id: 'LZ', client_name: 'ZETA FOODS', kam: R1, converted_to_customer: true },
    ],
    skus: [
      { id: 'S1', lead_id: 'L1', sku_name: 'Pouch A', category: 'Dairy', created_by: R1 },
      { id: 'S2', lead_id: 'L1', sku_name: 'Pouch B', category: 'Dairy', created_by: R1 },
      { id: 'S9', lead_id: 'L2', sku_name: 'Other pouch', category: 'Oil', created_by: R2 },
    ],
    qc_reports: [
      { id: 'c1', source: 'sales_os', sku_id: 'S1', lead_id: 'L1', plant_comments: 'Runs fine', status: 'Pending Quote', created_at: '2026-09-01T00:00:00Z', plant_commented_at: new Date().toISOString() },
      { id: 'd1', source: 'direct', company_name: 'Zeta Foods', product_desc: '1kg Zeta Bag', party_kind: 'customer', dispatch_type: 'Pouch', substrate1: 'PET', plant_comments: 'ok', status: 'Pending Quote', created_at: '2026-09-01T00:00:00Z' },
      { id: 'd2', source: 'direct', company_name: 'Nobody Ltd', product_desc: 'Walk-in bag', party_kind: 'customer', plant_comments: 'ok', status: 'Pending QC', created_at: '2026-09-01T00:00:00Z' },
    ],
  });
  const openDesk = async (sales = deskSales(), ready = 'Rep for Pouch A') => {
    const r = renderApp(<QuotationDesk />, { modules: { sales }, role: 'quote', user: 'quote' });
    await screen.findByText('Quotation Desk');
    await deskTab(/Pending for Quotation/);
    if (ready) await screen.findByLabelText(ready);
    else await screen.findByText(/Nothing pending/);
    return r;
  };

  it('names the rep each quotation lands on, ages from the plant\'s push, and flags an unallocated customer', async () => {
    await openDesk();
    expect(screen.getByLabelText('Rep for Pouch A')).toHaveTextContent('Rep One');
    expect(screen.getByLabelText('Rep for 1kg Zeta Bag')).toHaveTextContent('Rep One');   // the KAM of the lead of that name
    expect(screen.getByLabelText('Rep for Walk-in bag')).toHaveTextContent(/no rep allocated — Super Admin: allocate a KAM \/ category for Nobody Ltd/);
    // pushed today → 0 days, though the report was raised weeks ago
    const row = screen.getByLabelText('Rep for Pouch A').closest('tr');
    expect(within(row).getByText('0d')).toBeInTheDocument();
    // a legacy "Pending QC" reads as Pending Quote
    expect(within(screen.getByLabelText('Rep for Walk-in bag').closest('tr')).getByText('Pending Quote')).toBeInTheDocument();
  });

  it('Make Quotation ticks the CSA\'s SKU and never offers another customer\'s SKUs', async () => {
    await openDesk();
    await userEvent.click(screen.getByLabelText('Make quotation for Acme Dairy'));
    expect(await screen.findByLabelText('Quote Pouch A')).toBeChecked();
    expect(screen.getByLabelText('Quote Pouch B')).not.toBeChecked();
    expect(screen.queryByLabelText('Quote Other pouch')).toBeNull();
    expect(screen.getByLabelText('Item code S1')).toBeInTheDocument();   // the ticked line is open for pricing
    // a customer with no SKUs lists none — not every SKU in the blob
    await userEvent.selectOptions(screen.getByLabelText('Customer'), 'L3');
    expect(screen.getByText('No SKUs recorded for this customer.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Quote Other pouch')).toBeNull();
  });

  it('a direct CSA gets Make Quotation: the lead and SKU are linked, quoted, and land on the allocated rep', async () => {
    const { saved } = await openDesk();
    await userEvent.click(screen.getByLabelText('Make quotation for Zeta Foods'));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const linked = lastSales(saved);
    const sku = linked.skus.find((s) => s.csa_report_id === 'd1');
    expect(sku).toMatchObject({ lead_id: 'LZ', sku_name: '1kg Zeta Bag' });
    expect(linked.qc_reports.find((r) => r.id === 'd1').sku_id).toBe(sku.id);
    // the New Quotation opens on that customer with the SKU ticked
    expect(await screen.findByLabelText('Quote 1kg Zeta Bag')).toBeChecked();
    expect(screen.getByLabelText('Customer')).toHaveValue('LZ');
    await userEvent.type(screen.getByLabelText(`MOQ ${sku.id}`), '50000');
    await userEvent.type(screen.getByLabelText(`Slab 1 price ${sku.id}`), '4');
    await userEvent.click(screen.getByText(/Issue quotation/));
    await waitFor(() => expect(lastSales(saved).quotations).toHaveLength(1));
    const after = lastSales(saved);
    expect(after.qc_reports.find((r) => r.id === 'd1')).toMatchObject({ status: 'Quoted' });
    expect(after.qc_reports.find((r) => r.id === 'd1').quoted_at).toBeTruthy();
    // the KAM rep sees it, at the desk's MOQ
    expect(quotableSkus(after, R1).map((s) => s.id)).toContain(sku.id);
    expect(deskTiersForSku(after, sku.id)).toEqual([{ qty: 50000, price: 4 }]);
  });

  it('shows what the plant pushed in another login when the tab is opened again', async () => {
    const r = await openDesk(salesModule({ leads: [{ id: 'L1', client_name: 'Acme Dairy' }], skus: [{ id: 'S1', lead_id: 'L1', sku_name: 'Pouch A' }] }), null);
    expect(screen.queryByLabelText('Make quotation for Acme Dairy')).toBeNull();
    r.mods.sales = { ...r.mods.sales, qc_reports: [{ id: 'c1', sku_id: 'S1', lead_id: 'L1', source: 'sales_os', plant_comments: 'ok', status: 'Pending Quote' }] };
    await deskTab(/New Quotation/);
    await deskTab(/Pending for Quotation/);
    expect(await screen.findByLabelText('Make quotation for Acme Dairy')).toBeInTheDocument();
  });

  it('the quotation viewer sits above the sticky role bar', async () => {
    const sales = salesModule({ leads: [{ id: 'L1', client_name: 'Acme Dairy' }], quotations: [{ id: 'q1', lead_id: 'L1', client_name: 'Acme Dairy', version: 1, date: '2026-09-30', status: 'sent', items: [] }] });
    renderApp(<QuotationDesk />, { modules: { sales }, role: 'quote' });
    await screen.findByText('Quotation Desk');
    await deskTab(/Quotations Sent/);
    await userEvent.click(await screen.findByLabelText('Open quotation Acme Dairy v1'));
    const dialog = screen.getByRole('dialog', { name: 'Quotation Acme Dairy v1' });
    expect(Number(dialog.parentElement.style.zIndex)).toBeGreaterThanOrEqual(1000);
  });
});

/* ═══════════════ QT3 / QT4 / QT5: the rep's three quotation tabs ═══════════════ */
const repSales = () => salesModule({
  leads: [
    { id: 'L2', client_name: 'Beta Foods', categories: ['Oil'], category_assignments: { Oil: R1 }, converted_to_customer: true },
    { id: 'L1', client_name: 'Acme Dairy', categories: ['Dairy'], category_assignments: { Dairy: R1 }, delivery_location: 'Hyderabad' },
    { id: 'L5', client_name: 'Split Co', categories: ['Dairy', 'Oil'], category_assignments: { Dairy: R1, Oil: R2 } },
  ],
  skus: [
    {
      id: 'S1', lead_id: 'L2', sku_name: '200g Pouch', category: 'Oil', created_by: R1, csa_request: { despatch_location: 'Nashik' },
      quotation_sent: true, quotation_sent_at: '2026-09-20T00:00:00Z', quotation_received: true,
      quote_history: [{ sent_at: '2026-09-20T00:00:00Z', version: 1, tiers: [{ qty: 100000, price: 2.5 }] }],
      rep_quote: { tiers: [{ qty: 100000, price: 2.5 }], saved_at: '2026-09-19T00:00:00Z', source: 'desk' },
    },
    { id: 'S2', lead_id: 'L1', sku_name: 'Milk pouch', category: 'Dairy', created_by: R1, rep_quote: { tiers: [{ qty: 1000, price: 5.2 }], saved_at: '2026-09-21T00:00:00Z', source: 'desk' } },
    { id: 'S3', lead_id: 'L5', sku_name: 'Split oil', category: 'Oil', created_by: R1 },
    { id: 'S4', lead_id: 'L5', sku_name: 'Split dairy', category: 'Dairy', created_by: R2 },
  ],
  quotations: [
    { id: 'q1', lead_id: 'L2', client_name: 'Beta Foods', version: 1, date: '2026-09-18', created_at: '2026-09-18T00:00:00Z', fine_print: { terms: 'Payment 30 days' },
      items: [{ sku_id: 'S1', sku_name: '200g Pouch', item_code: 'IC-77', moq: '1,00,000', gst_pct: 18, plate: { ci_per: 1000, ci_n: 2 }, tiers: [{ qty: 0, price_wo_gst: 2.5 }] }] },
    { id: 'q2', lead_id: 'L1', client_name: 'Acme Dairy', version: 1, date: '2026-09-18', created_at: '2026-09-18T00:00:00Z', items: [{ sku_id: 'S2', tiers: [{ qty: 1000, price_wo_gst: 5 }] }] },
    // a desk re-quote on file without a date: the rep's 5.20 is now under it
    { id: 'q3', lead_id: 'L1', client_name: 'Acme Dairy', version: 2, date: '2026-09-25', items: [{ sku_id: 'S2', tiers: [{ qty: 1000, price_wo_gst: 6 }] }] },
    { id: 'q5', lead_id: 'L5', client_name: 'Split Co', version: 1, created_at: '2026-09-18T00:00:00Z', items: [{ sku_id: 'S3', tiers: [{ qty: 10, price_wo_gst: 1 }] }, { sku_id: 'S4', tiers: [{ qty: 10, price_wo_gst: 1 }] }] },
  ],
});
const openRep = (sales = repSales(), extra = {}) => renderApp(<RepPortal />, { modules: { sales, customers: CUSTOMERS, masterItems: MASTER_ITEMS, ...extra }, role: 'sales', repId: R1, user: 'rep1' });

describe('QT3 — the Quotations tab', () => {
  it('green for sent, red for to be sent, the SKU\'s own location, real groups only, each rep its own SKUs', async () => {
    openRep();
    await tab('💬 Quotations');
    const sent = await screen.findByLabelText('SKU 200g Pouch');
    expect(sent.style.color).toBe('rgb(30, 126, 52)');
    expect(sent.closest('tr').dataset.status).toBe('sent');
    expect(sent.closest('tr').style.background).toBe('rgb(243, 251, 245)');
    const toSend = screen.getByLabelText('SKU Milk pouch');
    expect(toSend.style.color).toBe('rgb(192, 57, 43)');
    expect(toSend.closest('tr').style.background).toBe('rgb(255, 245, 244)');
    // the SKU's CSA despatch location, not the customer's first (Pune)
    expect(within(sent.closest('tr')).getByText('Nashik')).toBeInTheDocument();
    // groups: the real one only, never a customer or lead name
    expect([...screen.getByLabelText('Filter by group').options].map((o) => o.textContent)).toEqual(['All groups', 'BETA GROUP']);
    // Split Co's Oil SKU belongs to Rep Two
    expect(screen.getByLabelText('SKU Split dairy')).toBeInTheDocument();
    expect(screen.queryByLabelText('SKU Split oil')).toBeNull();
  });

  it('shows the desk MOQ on a flat price, springs a typed-down price back to the floor, and an edit after sending re-opens the send', async () => {
    const { saved } = openRep();
    await tab('💬 Quotations');
    await userEvent.click(await screen.findByLabelText('Quote 200g Pouch'));
    expect(await screen.findByLabelText('Desk MOQ')).toHaveTextContent('1,00,000');
    expect(screen.getByLabelText('Desk MOQ')).toHaveTextContent('IC-77');
    expect(screen.getByLabelText('Slab 1 MOQ')).toHaveValue(100000);
    const price = screen.getByLabelText('Slab 1 price');
    fireEvent.change(price, { target: { value: '2.4' } });
    expect(screen.getByText(/below the desk’s ₹2\.50/)).toBeInTheDocument();
    fireEvent.blur(price);
    expect(price).toHaveValue(2.5);
    await userEvent.click(screen.getByLabelText('Raise slab 1'));
    expect(price).toHaveValue(2.55);
    await userEvent.click(screen.getByText('💾 Save'));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const s1 = lastSales(saved).skus.find((s) => s.id === 'S1');
    expect(s1.rep_quote).toMatchObject({ tiers: [{ qty: 100000, price: 2.55 }], changed_after_send: true });
    await waitFor(() => expect(screen.getByLabelText('SKU 200g Pouch').closest('tr').dataset.status).toBe('to_send'));
    expect(screen.getByLabelText('SKU 200g Pouch').style.color).toBe('rgb(192, 57, 43)');
  });
});

describe('QT4 — Send Quote', () => {
  it('cascades group → customer → despatch location and resets what is below a change', async () => {
    openRep();
    await tab('📤 Send Quote');
    const loc = await screen.findByLabelText('Filter by despatch location');
    expect([...loc.options].map((o) => o.textContent)).toEqual(expect.arrayContaining(['Hyderabad', 'Nashik']));
    await userEvent.selectOptions(screen.getByLabelText('Filter by customer'), 'Beta Foods');
    expect([...screen.getByLabelText('Filter by despatch location').options].map((o) => o.textContent)).toEqual(['All despatch locations', 'Nashik']);
    await userEvent.selectOptions(screen.getByLabelText('Filter by despatch location'), 'Nashik');
    await userEvent.selectOptions(screen.getByLabelText('Filter by group'), 'BETA GROUP');
    expect(screen.getByLabelText('Filter by customer')).toHaveValue('');
    expect(screen.getByLabelText('Filter by despatch location')).toHaveValue('');
    expect(screen.getByLabelText('Send 200g Pouch')).toBeDisabled();       // a group alone names nobody
  });

  it('prepares the quotation from the desk\'s line — item code, MOQ, plates — and keeps a read-only history on every row', async () => {
    openRep();
    await tab('📤 Send Quote');
    await userEvent.selectOptions(await screen.findByLabelText('Filter by customer'), 'Beta Foods');
    await userEvent.click(screen.getByLabelText('Send 200g Pouch'));
    await userEvent.click(screen.getByRole('button', { name: /Prepare Quote/ }));
    const doc = await screen.findByLabelText('Prepared quotation');
    expect(within(doc).getByText('IC-77')).toBeInTheDocument();
    expect(within(doc).getByText('1,00,000')).toBeInTheDocument();
    expect(within(doc).getByText(/One-time plate cost/)).toBeInTheDocument();
    expect(within(doc).getByText('₹2.95')).toBeInTheDocument();         // 2.50 + 18% GST
    await userEvent.click(within(doc).getByText('Close'));
    // a history link on a SKU never sent as well
    await userEvent.click(screen.getByLabelText('Filter by customer'));
    await userEvent.selectOptions(screen.getByLabelText('Filter by customer'), '');
    await userEvent.click(screen.getByLabelText('Quote history Milk pouch'));
    expect(within(screen.getByLabelText('Quote history')).getByText('No quotes sent yet.')).toBeInTheDocument();
    await userEvent.click(within(screen.getByLabelText('Quote history')).getByText('Close'));
    await userEvent.click(screen.getByLabelText('Quote history 200g Pouch'));
    const h = screen.getByLabelText('Quote history');
    expect(within(h).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Sent on', 'Version', 'MOQ', 'Amount (₹ per unit)']);
    expect(within(h).getByText('1,00,000')).toBeInTheDocument();
    expect(within(h).getByText('₹2.50')).toBeInTheDocument();
    expect(within(h).queryByRole('textbox')).toBeNull();
  });

  it('refuses "Sent Quote" under the desk\'s current figure', async () => {
    const { saved } = openRep();
    await tab('📤 Send Quote');
    await userEvent.selectOptions(await screen.findByLabelText('Filter by lead'), 'Acme Dairy');
    await userEvent.click(screen.getByLabelText('Send Milk pouch'));
    await userEvent.click(screen.getByRole('button', { name: /Prepare Quote/ }));
    await userEvent.click(within(await screen.findByLabelText('Prepared quotation')).getByText('📤 Sent Quote'));
    expect(await screen.findByText(/Milk pouch: ₹5.2 for 1000 is below the quote desk's ₹6/)).toBeInTheDocument();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
  });
});

describe('QT5 — Quote Accepted', () => {
  const accSales = () => {
    const s = repSales();
    s.skus = [
      ...s.skus,
      { id: 'A1', lead_id: 'L2', sku_name: 'Accepted pouch', category: 'Oil', created_by: R1, quotation_accepted: true, quotation_accepted_at: '2026-09-25T00:00:00Z', jss_spec: 'A900', price_tiers: [{ qty: 100000, price: 2.6 }], csa_request: { despatch_location: 'Pune' } },
      { id: 'A2', lead_id: 'L1', sku_name: 'Lead pouch', category: 'Dairy', created_by: R1, quotation_accepted: true, rep_quote: { tiers: [{ qty: 500, price: 9 }] }, price_tiers: [{ qty: 500, price: 9 }] },
      { id: 'S5', lead_id: 'L2', sku_name: 'CSA done pouch', category: 'Oil', created_by: R1 },
      { id: 'S6', lead_id: 'L2', sku_name: 'No CSA pouch', category: 'Oil', created_by: R1 },
      { id: 'S7', lead_id: 'L2', sku_name: 'Desk quoted pouch', category: 'Oil', created_by: R1 },
    ];
    s.qc_reports = [{ id: 'c5', sku_id: 'S5', status: 'Pending Plant' }];
    s.quotations = [...s.quotations, { id: 'q7', lead_id: 'L2', version: 2, created_at: '2026-09-18T00:00:00Z', items: [{ sku_id: 'S7', moq: '1000', tiers: [{ qty: 1000, price_wo_gst: 3 }] }] }];
    return s;
  };

  it('is read-only with a filter under every column header — a group name filters its customers', async () => {
    openRep(accSales());
    await tab('✅ Quote Accepted');
    const table = await screen.findByRole('table', { name: 'Accepted quotations' });
    const filters = within(table).getByLabelText('Column filters');
    expect(within(filters).getAllByRole('combobox')).toHaveLength(7);
    expect(within(table).queryByRole('textbox')).toBeNull();
    expect(within(table).queryByRole('spinbutton')).toBeNull();
    // the unconverted lead's SKU cannot reach QC yet — and says so
    const leadRow = within(table).getByText('Lead pouch', { selector: 'td' }).closest('tr');
    expect(within(leadRow).getByText('awaiting Super Admin conversion')).toBeInTheDocument();
    await userEvent.selectOptions(within(table).getByLabelText('Filter accepted by customer'), 'BETA GROUP');
    expect(within(table).getByText('Accepted pouch', { selector: 'td' })).toBeInTheDocument();
    expect(within(table).queryByText('Lead pouch', { selector: 'td' })).toBeNull();
    await userEvent.selectOptions(within(table).getByLabelText('Filter accepted by MOQ'), '1,00,000');
    expect(within(table).getByText('Accepted pouch', { selector: 'td' })).toBeInTheDocument();
  });

  it('adds by hand only for SKUs past the CSA or quoted, never under the desk, and wants the MOQ', async () => {
    const { saved } = openRep(accSales());
    await tab('✅ Quote Accepted');
    const card = await screen.findByLabelText('Add quotation by hand');
    // the Lead/Customer picker (kind 'customer' by default) names its select after the side
    await userEvent.selectOptions(within(card).getByLabelText('Manual Customer'), 'L2');
    const opts = [...within(card).getByLabelText('Manual quotation SKU').options].map((o) => o.textContent);
    expect(opts).toEqual(expect.arrayContaining(['CSA done pouch', 'Desk quoted pouch']));
    expect(opts).not.toContain('No CSA pouch');
    // the desk's figure comes in with the SKU and is the floor
    await userEvent.selectOptions(within(card).getByLabelText('Manual quotation SKU'), 'S7');
    await waitFor(() => expect(within(card).getByLabelText('Manual slab 1 price')).toHaveValue(3));
    expect(within(card).getByLabelText('Manual slab 1 MOQ')).toHaveValue(1000);
    fireEvent.change(within(card).getByLabelText('Manual slab 1 price'), { target: { value: '2.9' } });
    await userEvent.click(within(card).getByText('✓ Record as accepted'));
    expect(await screen.findByText(/below the quote desk/)).toBeInTheDocument();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
    // no desk figure: the MOQ is required
    await userEvent.selectOptions(within(card).getByLabelText('Manual quotation SKU'), 'S5');
    await waitFor(() => expect(within(card).getByLabelText('Manual slab 1 price')).toHaveValue(null));
    fireEvent.change(within(card).getByLabelText('Manual slab 1 price'), { target: { value: '4' } });
    await userEvent.click(within(card).getByText('✓ Record as accepted'));
    expect(await screen.findByText(/Enter the MOQ for every slab/)).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText('Manual slab 1 MOQ'), { target: { value: '2000' } });
    await userEvent.click(within(card).getByText('✓ Record as accepted'));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    expect(lastSales(saved).skus.find((s) => s.id === 'S5')).toMatchObject({ quotation_accepted: true, price_tiers: [{ qty: 2000, price: 4 }] });
  });
});

/* ═══════════════ QT7: Enter PO ═══════════════ */
describe('QT7 — Enter PO', () => {
  it('prices a flat-price quote, warns under the MOQ, and takes the despatch location from the SKU\'s CSA', async () => {
    const sales = repSales();
    sales.skus = [
      { id: 'F1', lead_id: 'L2', sku_name: 'Flat pouch', category: 'Oil', created_by: R1, quotation_accepted: true, jss_spec: 'A700', price_tiers: [{ qty: 0, price: 5 }], csa_request: { despatch_location: 'Nashik' } },
      { id: 'T1', lead_id: 'L2', sku_name: 'Tier pouch', category: 'Oil', created_by: R1, quotation_accepted: true, jss_spec: 'A701', price_tiers: [{ qty: 1000, price: 4 }] },
    ];
    const { saved } = openRep(sales);
    await tab('🧾 Enter PO');
    await userEvent.selectOptions(await screen.findByLabelText('PO customer'), 'L2');
    expect(screen.getByLabelText('PO despatch location')).toHaveValue('');
    await userEvent.selectOptions(screen.getByLabelText('PO SKU 1'), 'F1');
    expect(screen.getByLabelText('PO despatch location')).toHaveValue('Nashik||');
    await userEvent.type(screen.getByLabelText('PO quantity 1'), '50');
    await waitFor(() => expect(screen.getByLabelText('PO price 1')).toHaveValue(5));
    await userEvent.click(screen.getByText('＋ Another SKU'));
    await userEvent.selectOptions(screen.getByLabelText('PO SKU 2'), 'T1');
    await userEvent.type(screen.getByLabelText('PO quantity 2'), '500');
    expect(screen.getByLabelText('Below MOQ 2')).toHaveTextContent('Below the MOQ of 1,000');
    expect(screen.queryByLabelText('Below MOQ 1')).toBeNull();          // a flat price has no MOQ to be under
    await userEvent.type(screen.getByLabelText('PO Number'), 'PO-55');
    await userEvent.click(screen.getByText('✓ Save PO'));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const pos = lastSales(saved).pos;
    expect(pos.map((p) => [p.jss_spec, p.price, p.despatch_location])).toEqual([['A700', 5, 'Nashik'], ['A701', 4, 'Nashik']]);
  });
});

/* ═══════════════ QT6: QC Add JSS Spec ═══════════════ */
describe('QT6 — the JSS from the accepted CSA', () => {
  const qcSales = (over = {}) => salesModule({
    leads: [{ id: 'L2', client_name: 'beta foods', categories: ['Oil'], category_assignments: { Oil: R1 }, converted_to_customer: true }],
    skus: [{ id: 'S1', lead_id: 'L2', sku_name: '200g Pouch', category: 'Oil', dispatch_form: 'Pouch', quotation_accepted: true, created_by: R1 }],
    qc_reports: [{ id: 'c1', sku_id: 'S1', substrate1: 'PET', substrate1_val: 12, substrate2: 'LDPE', substrate2_val: 60, gsm: 80 }],
    ...over,
  });

  it('fills every layer from the CSA, spells the customer as the master does, and nudges a laminate job type', async () => {
    renderApp(<QC />, { modules: { sales: qcSales(), customers: CUSTOMERS, jss: [], masterItems: MASTER_ITEMS }, role: 'qc', user: 'qc1' });
    const panel = await screen.findByLabelText('CSAs awaiting a JSS');
    await userEvent.click(within(panel).getByLabelText('JSS from CSA 200g Pouch'));
    await waitFor(() => expect(screen.getByLabelText('Primary Material')).toHaveValue('PET'));
    expect(screen.getByLabelText('Primary Micron')).toHaveValue('12');
    expect(screen.getByLabelText('Customer')).toHaveValue('Beta Foods');
    expect(screen.getByLabelText('Dispatch Form')).toHaveValue('Pouch');
    expect(screen.getByText(/This CSA has 2 layers — pick a laminate Job Type/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Job Type'), 'SF Lami Pouch + Zipper');
    expect(await screen.findByLabelText('Secondary Material')).toHaveValue('LDPE');
    expect(screen.getByLabelText('Secondary Micron')).toHaveValue('60');
  });

  it('links a JSS already made from the CSA instead of numbering a duplicate', async () => {
    const jss = [{ sno: 1, spec: 'A5', customer: 'Beta Foods', jobName: '200g Pouch', status: 'Active', fromSku: 'S1' }];
    const { saved } = renderApp(<QC />, { modules: { sales: qcSales(), customers: CUSTOMERS, jss, masterItems: MASTER_ITEMS }, role: 'qc', user: 'qc1' });
    const panel = await screen.findByLabelText('CSAs awaiting a JSS');
    expect(within(panel).getByText(/JSS A5 made — not linked yet/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByLabelText('JSS from CSA 200g Pouch'));
    expect(await screen.findByText(/JSS A5 was already made from this CSA/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add Spec' }));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    expect(lastSales(saved).skus[0].jss_spec).toBe('A5');
    expect(saved.some((s) => s.key === 'jss')).toBe(false);              // no second spec
    expect(await screen.findByText(/linked to the sales SKU now \(no new number\)/)).toBeInTheDocument();
  });
});

/* ═══════════════ PE3: PO → SO with the warehouse and the FG ═══════════════ */
describe('PE3 — the Superstar pushes a rep\'s PO onto the OAB', () => {
  const KOVA = [
    { group: 'SWIGGY', customer: 'Kova Agro', dispatchLoc: 'DHARAPURAM', warehouseName: 'DHARAPURAM' },
    { group: '', customer: 'Kova Agro', dispatchLoc: 'DHARAPURAM', warehouseName: 'KOVAI OWN' },
  ];
  const line = (over) => ({ po_ref: 'ref9', lead_id: 'LK', customer: 'KOVA AGRO', despatch_location: 'DHARAPURAM', warehouse_name: 'KOVAI OWN', po_number: 'PO-90', date: '2026-09-29', created_by: R1, created_at: '2026-09-29T10:00:00Z', ...over });
  const sales = () => salesModule({
    leads: [{ id: 'LK', client_name: 'KOVA AGRO', converted_to_customer: true }],
    pos: [
      line({ id: 'p1', sku_id: 'K1', sku_name: 'Coconut 200', jss_spec: 'A50', qty: 1000, price: 3 }),
      line({ id: 'p2', sku_id: 'K2', sku_name: 'Coconut 500', jss_spec: 'A51', qty: 500, price: 4 }),
    ],
  });
  const jss = [
    { spec: 'A50', customer: 'Kova Agro', jobName: 'Coconut water 200 ml', jobType: 'Pouch', dispatchForm: 'Pouch', status: 'Active' },
    { spec: 'A51', customer: 'Kova Agro', jobName: 'Coconut water 500 ml', jobType: 'Pouch', dispatchForm: 'Pouch', status: 'Active' },
  ];
  const fgLedger = { A50: { prod: [{ date: '2026-09-01', qty: 300, ts: 1, id: 'p', note: '' }], alloc: [] } };

  it('lands on the exact Kova Agro row, sends the warehouse, uses the FG chosen, marks only the pushed line', async () => {
    const { saved } = renderApp(
      <Routes><Route path="/po-to-so" element={<PoToSo />} /><Route path="/po" element={<NewPO />} /></Routes>,
      { modules: { sales: sales(), customers: KOVA, jss, fgLedger, prices: { A50: { price: 3.5 } }, oab: { OAB: { SF: [], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 400 } } }, role: 'user', route: '/po-to-so' },
    );
    expect(await screen.findByLabelText('Despatch location of PO-90')).toHaveTextContent('KOVAI OWN');
    await userEvent.click(screen.getByLabelText('Select PO PO-90'));
    await userEvent.click(screen.getByLabelText('Add to OAB'));
    expect(await screen.findByText(/From the sales rep/)).toBeInTheDocument();
    // the ungrouped Kova Agro row with the KOVAI OWN warehouse — not SWIGGY's DHARAPURAM
    expect(screen.getByLabelText('Group')).toHaveValue('');
    expect(screen.getByLabelText('Customer')).toHaveValue('Kova Agro');
    expect(screen.getByLabelText('Dispatch Location')).toHaveValue('DHARAPURAM||KOVAI OWN');
    expect(screen.getByText(/Warehouse: KOVAI OWN/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));
    await waitFor(() => expect(screen.getByLabelText('Select A50')).toBeChecked());
    expect(screen.getByLabelText('FG available for A50')).toHaveTextContent('300');
    expect(screen.getByLabelText('Use FG for A51')).toBeDisabled();       // none in stock
    await userEvent.type(screen.getByLabelText('Use FG for A50'), '200');
    await userEvent.click(screen.getByLabelText('Select A51'));           // the Superstar leaves this line for later
    await userEvent.click(screen.getByRole('button', { name: /Review →/ }));

    expect(await screen.findByLabelText('Confirm PO price for A50')).toHaveTextContent('₹3.00');
    expect(screen.getByText('₹3.50')).toBeInTheDocument();                // the Price Master rate beside it
    expect(screen.getByLabelText('Confirm FG for A50')).toHaveTextContent('200');
    await userEvent.click(screen.getByRole('button', { name: /🚀 Push to OAB/ }));

    await waitFor(() => expect(saved.some((s) => s.endpoint === '/api/sales-orders')).toBe(true));
    const body = saved.find((s) => s.endpoint === '/api/sales-orders').body;
    expect(body).toMatchObject({ customer: 'Kova Agro', dispLoc: 'DHARAPURAM', warehouseName: 'KOVAI OWN', poNum: 'PO-90' });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ spec: 'A50', warehouseName: 'KOVAI OWN' });
    // only the pushed line leaves the PO → SO list, stamped with its own SO
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const pos = lastSales(saved).pos;
    expect(pos.find((p) => p.id === 'p1').pushed_to_oab.so).toBe('26/401');
    expect(pos.find((p) => p.id === 'p2').pushed_to_oab).toBeUndefined();
    // the FG chosen on the SKU step is drawn down against the new SO
    await waitFor(() => expect(saved.some((s) => s.id === 9)).toBe(true));
    expect(saved.find((s) => s.id === 9).data.A50.alloc.at(-1)).toMatchObject({ qty: 200, so: '26/401', src: 'new-po' });
    await waitFor(() => expect(saved.some((s) => s.endpoint === '/api/oab-rows/dispatch' && s.body.so === '26/401' && Number(s.body.fg) === 200)).toBe(true));
    // the hand-off is done: no rep-PO banner on the next order
    await waitFor(() => expect(screen.queryByText(/From the sales rep/)).toBeNull());
    expect(screen.queryByText(/Use existing Finished Goods/)).toBeNull();   // no second FG prompt
  });
});

/* ═══════════════ The whole chain on ONE shared sales blob ═══════════════ */
describe('Quotations end to end — rep → QC → plant → quote desk → rep → QC → rep PO → Superstar', () => {
  it('walks one SKU through every login', async () => {
    // ── the rep has the sample and sends it for CSA (the SKU tab's own screen is covered by issues7sales)
    const lead = { id: 'L2', client_name: 'Beta Foods', categories: ['Oil'], category_assignments: { Oil: R1 }, created_by: R1, converted_to_customer: true };
    const sku = { id: 'S1', lead_id: 'L2', sku_name: '200g Pouch', category: 'Oil', dispatch_form: 'Pouch', created_by: R1, created_at: '2026-09-29T00:00:00Z' };
    const req = buildCsaRequest({ despatch_location: 'Nashik', tentative_qty: '120000', tentative_date: '2026-10-20', target_price: '2.4', pouch_width_mm: '150' }, sku, { user: 'rep1' });
    let modules = {
      sales: salesModule({ leads: [lead], skus: sendSkuForCsa([sku], 'S1', req) }),
      customers: CUSTOMERS, masterItems: MASTER_ITEMS, jss: [], prices: {},
      oab: { OAB: { SF: [], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 400 } },
    };

    // ── QC writes the CSA report
    let r = renderApp(<QC />, { modules, role: 'qc', user: 'qc1' });
    await userEvent.click(await screen.findByText(/CSA Reports/));
    await userEvent.click(await screen.findByLabelText('Add CSA report for 200g Pouch'));
    await userEvent.selectOptions(await screen.findByLabelText('Primary Substrate'), 'PET');
    await setField(screen.getByLabelText('Primary Substrate Micron'), '12');
    await userEvent.selectOptions(screen.getByLabelText('Secondary Substrate'), 'LDPE');
    await setField(screen.getByLabelText('Secondary Substrate Micron'), '60');
    await userEvent.click(screen.getByText(/Save CSA report/));
    await waitFor(() => expect(r.mods.sales.qc_reports).toHaveLength(1));
    expect(r.mods.sales.qc_reports[0]).toMatchObject({ sku_id: 'S1', status: 'Pending Plant', dispatch_type: 'Pouch', substrate1: 'PET', substrate2: 'LDPE' });
    modules = r.mods; r.unmount();

    // ── the plant comments and pushes it to the quote desk
    r = renderApp(<PM />, { modules, role: 'pm', user: 'pm1' });
    await userEvent.click(await screen.findByText(/CSA/));
    await userEvent.click(await screen.findByLabelText('Answer CSA for 200g Pouch'));
    await userEvent.type(screen.getByLabelText('Plant comments'), 'Runs at 180 m/min');
    await userEvent.click(screen.getByRole('button', { name: /Push to Quote/ }));
    await waitFor(() => expect(r.mods.sales.qc_reports[0].status).toBe('Pending Quote'));
    expect(r.mods.sales.qc_reports[0].plant_commented_at).toBeTruthy();
    modules = r.mods; r.unmount();

    // ── the quote desk makes the quotation: one flat price above the MOQ
    r = renderApp(<QuotationDesk />, { modules, role: 'quote', user: 'quote' });
    await screen.findByText('Quotation Desk');
    await deskTab(/Pending for Quotation/);
    expect(await screen.findByLabelText('Rep for 200g Pouch')).toHaveTextContent('Rep One');
    await userEvent.click(screen.getByLabelText('Make quotation for Beta Foods'));
    expect(await screen.findByLabelText('Quote 200g Pouch')).toBeChecked();
    await userEvent.type(screen.getByLabelText('Item code S1'), 'IC-1');
    await userEvent.type(screen.getByLabelText('MOQ S1'), '100000');
    await userEvent.type(screen.getByLabelText('Slab 1 price S1'), '2.5');
    await userEvent.click(screen.getByText(/Issue quotation/));
    await waitFor(() => expect(r.mods.sales.quotations).toHaveLength(1));
    expect(r.mods.sales.qc_reports[0]).toMatchObject({ status: 'Quoted' });
    expect(r.mods.sales.qc_reports[0].quoted_at).toBeTruthy();
    modules = r.mods; r.unmount();

    // ── the rep raises it, sends it, and the customer accepts
    r = renderApp(<RepPortal />, { modules, role: 'sales', repId: R1, user: 'rep1' });
    expect(await screen.findByText(/1 quotation received from the Quote desk/)).toBeInTheDocument();
    await tab('💬 Quotations');
    await userEvent.click(await screen.findByLabelText('Quote 200g Pouch'));
    expect(await screen.findByLabelText('Desk MOQ')).toHaveTextContent('1,00,000');
    await userEvent.click(screen.getByLabelText('Raise slab 1'));
    await userEvent.click(screen.getByText('💾 Save'));
    await waitFor(() => expect(r.mods.sales.skus[0].rep_quote.tiers).toEqual([{ qty: 100000, price: 2.55 }]));
    await tab('📤 Send Quote');
    await userEvent.selectOptions(await screen.findByLabelText('Filter by customer'), 'Beta Foods');
    await userEvent.click(screen.getByLabelText('Send 200g Pouch'));
    await userEvent.click(screen.getByRole('button', { name: /Prepare Quote/ }));
    await userEvent.click(within(await screen.findByLabelText('Prepared quotation')).getByText('📤 Sent Quote'));
    await waitFor(() => expect(r.mods.sales.skus[0].quotation_sent).toBe(true));
    await userEvent.click(await screen.findByRole('switch', { name: 'Quote accepted 200g Pouch' }));
    await waitFor(() => expect(r.mods.sales.skus[0].quotation_accepted).toBe(true));
    expect(r.mods.sales.skus[0].price_tiers).toEqual([{ qty: 100000, price: 2.55 }]);
    modules = r.mods; r.unmount();

    // ── QC makes the JSS from the accepted CSA, the layers already filled
    r = renderApp(<QC />, { modules, role: 'qc', user: 'qc1' });
    const panel = await screen.findByLabelText('CSAs awaiting a JSS');
    await userEvent.click(within(panel).getByLabelText('JSS from CSA 200g Pouch'));
    await waitFor(() => expect(screen.getByLabelText('Primary Material')).toHaveValue('PET'));
    await userEvent.selectOptions(screen.getByLabelText('Job Type'), 'SF Lami Pouch + Zipper');
    expect(await screen.findByLabelText('Secondary Material')).toHaveValue('LDPE');
    await userEvent.click(screen.getByRole('button', { name: 'Add Spec' }));
    await waitFor(() => expect(r.mods.sales.skus[0].jss_spec).toBe('A1'));
    expect(r.mods.jss[0]).toMatchObject({ spec: 'A1', customer: 'Beta Foods', group: 'BETA GROUP', material: 'PET + LDPE', fromSku: 'S1' });
    modules = r.mods; r.unmount();

    // ── the rep enters the PO: location from the CSA, price from the accepted quote
    r = renderApp(<RepPortal />, { modules, role: 'sales', repId: R1, user: 'rep1' });
    await tab('🧾 Enter PO');
    await userEvent.selectOptions(await screen.findByLabelText('PO customer'), 'L2');
    await userEvent.selectOptions(screen.getByLabelText('PO SKU 1'), 'S1');
    expect(screen.getByLabelText('PO despatch location')).toHaveValue('Nashik||');
    expect(screen.getByLabelText('PO JSS 1')).toHaveTextContent('A1');
    await userEvent.type(screen.getByLabelText('PO quantity 1'), '120000');
    await waitFor(() => expect(screen.getByLabelText('PO price 1')).toHaveValue(2.55));
    await userEvent.type(screen.getByLabelText('PO Number'), 'PO-1');
    await userEvent.click(screen.getByText('✓ Save PO'));
    await waitFor(() => expect(r.mods.sales.pos).toHaveLength(1));
    modules = r.mods; r.unmount();

    // ── the Superstar pushes it onto the OAB
    r = renderApp(
      <Routes><Route path="/po-to-so" element={<PoToSo />} /><Route path="/po" element={<NewPO />} /></Routes>,
      { modules, role: 'user', route: '/po-to-so' },
    );
    await userEvent.click(await screen.findByLabelText('Select PO PO-1'));
    await userEvent.click(screen.getByLabelText('Add to OAB'));
    expect(await screen.findByDisplayValue('PO-1')).toBeInTheDocument();
    expect(screen.getByLabelText('Dispatch Location')).toHaveValue('Nashik||');
    await userEvent.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));
    await waitFor(() => expect(screen.getByLabelText('Select A1')).toBeChecked());
    expect(screen.getByLabelText('PO price for A1')).toHaveTextContent('₹2.55');
    await userEvent.click(screen.getByRole('button', { name: /Review →/ }));
    await userEvent.click(await screen.findByRole('button', { name: /🚀 Push to OAB/ }));
    await waitFor(() => expect(r.mods.sales.pos[0].pushed_to_oab).toBeTruthy());
    expect(r.mods.sales.pos[0].pushed_to_oab.so).toBe('26/401');
    const so = [...r.mods.oab.OAB.SF, ...r.mods.oab.OAB.OT].find((x) => x.so === '26/401');
    expect(so).toMatchObject({ spec: 'A1', customer: 'Beta Foods', poQty: 120000, poNum: 'PO-1', dispLoc: 'Nashik' });
  }, 30000);   // eight logins in one test: well past vitest's 5 s default
});

/* ═══════════════ integration review — the quotation chain ═══════════════ */
describe('Q2 — a direct CSA linked by the desk stays a direct report', () => {
  const linked = () => {
    const report = {
      ...buildCsaReport(
        { company_name: 'Zeta Foods', product_desc: '1kg Zeta Bag', responsible_person: 'Ravi', party_kind: 'customer', dispatch_type: 'Pouch', substrate1: 'PET', substrate1_val: 12 },
        { sales: {}, skuId: '', user: 'qc1', uid: () => 'd1', now: new Date('2026-09-01T00:00:00Z') },
      ),
      plant_comments: 'ok', status: 'Quoted', quoted_at: '2026-09-05T00:00:00Z',
    };
    const out = linkDirectCsa(salesModule({ qc_reports: [report] }), 'd1', { uid: (p) => p + '9' });
    expect(out.sales.qc_reports[0].sku_id).toBe('sku9');                // the desk linked it
    return out.sales;
  };
  const openQc = async (sales) => {
    const r = renderApp(<QC />, { modules: { sales, customers: [...CUSTOMERS, { group: '', customer: 'Zeta Foods' }], masterItems: MASTER_ITEMS, jss: [] }, role: 'qc', user: 'qc1' });
    await userEvent.click(await screen.findByText(/CSA Reports/));
    await userEvent.click(await screen.findByLabelText('Edit CSA for 1kg Zeta Bag'));
    return r;
  };

  it('opens in the direct form, and saving it untouched changes nothing', async () => {
    const { saved } = await openQc(linked());
    expect(await screen.findByText('🧪 Direct CSA report')).toBeInTheDocument();
    expect(screen.getByLabelText('Job name')).toHaveValue('1kg Zeta Bag');
    await userEvent.click(screen.getByText('✓ Save CSA report'));
    expect(await screen.findByText('Nothing changed — the report is as it was.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Re-approve the CSA report')).toBeNull();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
  });

  it('a real edit is re-approved as a direct report: source, identity and the SKU link kept', async () => {
    const { saved } = await openQc(linked());
    const job = await screen.findByLabelText('Job name');
    await userEvent.clear(job);
    await userEvent.type(job, '1kg Zeta Bag v2');
    await userEvent.click(screen.getByText('✓ Save CSA report'));
    await userEvent.type(await screen.findByLabelText('Re-approve comments'), 'renamed the job');
    await userEvent.click(screen.getByText('✓ Save and send to the plant'));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const rep = lastSales(saved).qc_reports.find((x) => x.id === 'd1');
    expect(rep).toMatchObject({
      source: 'direct', sku_id: 'sku9', lead_id: 'lead9', company_name: 'Zeta Foods', product_desc: '1kg Zeta Bag v2',
      responsible_person: 'Ravi', party_kind: 'customer', status: 'Pending Plant', needs_quote_review: true,
    });
  });
});

describe('Q3 — staleness by the desk quotation, not by two machines\' clocks', () => {
  const q1 = { id: 'q1', lead_id: 'L2', version: 1, created_at: '2026-09-25T10:00:00Z', items: [{ sku_id: 'S1', moq: '1,00,000', tiers: [{ qty: 0, price_wo_gst: 2.5 }] }] };

  it('a save and a send made just after the issue stand, though the desk clock reads later', () => {
    const sales = { quotations: [q1], skus: [{ id: 'S1', sku_name: 'Pouch' }] };
    const desk = deskTiersForSku(sales, 'S1');
    // the rep's clock is behind the desk's: 09:59 by the rep, after the 10:00 issue
    let skus = saveRepQuote(sales.skus, 'S1', [{ qty: 100000, price: 2.7 }], desk, { now: new Date('2026-09-25T09:59:00Z'), deskQuote: deskQuoteForSku(sales, 'S1') });
    expect(skus[0].rep_quote).toMatchObject({ desk_quote_id: 'q1', desk_version: 1 });
    expect(repTiersForSku(skus[0], desk, q1)).toEqual([{ qty: 100000, price: 2.7 }]);
    skus = markQuotesSent({ ...sales, skus }, ['S1'], { now: new Date('2026-09-25T09:59:30Z') });
    expect(skus[0].quote_history[0]).toMatchObject({ desk_quote_id: 'q1', tiers: [{ qty: 100000, price: 2.7 }] });
    expect(quoteStatusOf({ ...sales, skus }, skus[0])).toBe('sent');
    // the desk re-quotes — a different quotation, so both give way whatever the clocks say
    const q2 = { ...q1, id: 'q2', version: 2, created_at: '2026-09-01T00:00:00Z', items: [{ sku_id: 'S1', moq: '100000', tiers: [{ qty: 0, price_wo_gst: 3 }] }] };
    const later = { quotations: [q1, q2], skus };
    expect(repTiersForSku(skus[0], deskTiersForSku(later, 'S1'), deskQuoteForSku(later, 'S1'))).toEqual([{ qty: 100000, price: 3 }]);
    expect(quoteStatusOf(later, skus[0])).toBe('to_send');
  });

  it('the Quotations tab saves the desk quotation it worked from', async () => {
    const { saved } = openRep();
    await tab('💬 Quotations');
    await userEvent.click(await screen.findByLabelText('Quote 200g Pouch'));
    await userEvent.click(await screen.findByLabelText('Raise slab 1'));
    await userEvent.click(screen.getByText('💾 Save'));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    expect(lastSales(saved).skus.find((s) => s.id === 'S1').rep_quote).toMatchObject({ desk_quote_id: 'q1', desk_version: 1 });
  });
});

describe('Q4 — ✓ Reviewed takes a re-answered, already-quoted report off the desk\'s list', () => {
  it('restores "Quoted" and the row leaves Pending', async () => {
    const sales = salesModule({
      leads: [{ id: 'L1', client_name: 'Acme Dairy', categories: ['Dairy'], category_assignments: { Dairy: R1 } }],
      skus: [{ id: 'S1', lead_id: 'L1', sku_name: 'Pouch A', category: 'Dairy', created_by: R1 }],
      qc_reports: [{ id: 'c1', source: 'sales_os', sku_id: 'S1', lead_id: 'L1', plant_comments: 'Runs fine again', status: 'Pending Quote', quoted_at: '2026-09-20T00:00:00Z', needs_quote_review: true, created_at: '2026-09-01T00:00:00Z' }],
    });
    const { saved } = renderApp(<QuotationDesk />, { modules: { sales }, role: 'quote', user: 'quote' });
    await screen.findByText('Quotation Desk');
    await deskTab(/Pending for Quotation/);
    await userEvent.click(await screen.findByLabelText('Mark Pouch A reviewed'));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    expect(lastSales(saved).qc_reports[0]).toMatchObject({ status: 'Quoted', needs_quote_review: false });
    await waitFor(() => expect(screen.queryByLabelText('Rep for Pouch A')).toBeNull());
  });

  it('a report never quoted keeps its status — it still needs a quotation', async () => {
    const sales = salesModule({
      leads: [{ id: 'L1', client_name: 'Acme Dairy', categories: ['Dairy'], category_assignments: { Dairy: R1 } }],
      skus: [{ id: 'S1', lead_id: 'L1', sku_name: 'Pouch A', category: 'Dairy', created_by: R1 }],
      qc_reports: [{ id: 'c1', source: 'sales_os', sku_id: 'S1', lead_id: 'L1', plant_comments: 'ok', status: 'Pending Quote', needs_quote_review: true, created_at: '2026-09-01T00:00:00Z' }],
    });
    const { saved } = renderApp(<QuotationDesk />, { modules: { sales }, role: 'quote', user: 'quote' });
    await screen.findByText('Quotation Desk');
    await deskTab(/Pending for Quotation/);
    await userEvent.click(await screen.findByLabelText('Mark Pouch A reviewed'));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    expect(lastSales(saved).qc_reports[0]).toMatchObject({ status: 'Pending Quote', needs_quote_review: false });
    expect(screen.getByLabelText('Rep for Pouch A')).toBeInTheDocument();
  });
});

describe('Q5 — the Quotations form follows the desk, and lets go of an accepted quote', () => {
  it('re-seeds the slabs when the desk re-quotes the picked SKU', async () => {
    const r = openRep();
    await tab('💬 Quotations');
    await userEvent.click(await screen.findByLabelText('Quote 200g Pouch'));
    await waitFor(() => expect(screen.getByLabelText('Slab 1 price')).toHaveValue(2.5));
    // the desk issues v2 in another login; the rep's window comes back into focus
    r.mods.sales = {
      ...r.mods.sales,
      quotations: [...r.mods.sales.quotations, { id: 'q9', lead_id: 'L2', client_name: 'Beta Foods', version: 2, created_at: '2026-09-26T00:00:00Z', items: [{ sku_id: 'S1', moq: '1,00,000', tiers: [{ qty: 0, price_wo_gst: 3 }] }] }],
    };
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByLabelText('Slab 1 price')).toHaveValue(3));
    expect(screen.queryByText(/below the desk’s ₹/)).toBeNull();          // the red under-the-floor note
  });

  it('clears the pick once the quote is accepted', async () => {
    const { saved } = openRep();
    await tab('💬 Quotations');
    await userEvent.click(await screen.findByLabelText('Quote 200g Pouch'));
    await userEvent.click(await screen.findByText('✓ Quote Accepted'));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    expect(lastSales(saved).skus.find((s) => s.id === 'S1')).toMatchObject({ quotation_accepted: true });
    expect(await screen.findByText(/Quotation — pick a SKU below/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Slab 1 price')).toBeNull();
  });

  it('an accepted SKU picked again cannot be re-saved under its PO price', async () => {
    const sales = repSales();
    sales.skus[0] = { ...sales.skus[0], quotation_accepted: true, price_tiers: [{ qty: 100000, price: 2.5 }] };
    openRep(sales);
    await tab('💬 Quotations');
    await userEvent.selectOptions(await screen.findByLabelText('Filter by quote status'), 'accepted');
    await userEvent.click(await screen.findByLabelText('Quote 200g Pouch'));
    expect(await screen.findByText(/no longer edited here/)).toBeInTheDocument();
    expect(screen.getByText('💾 Save')).toBeDisabled();
    expect(screen.getByText('✓ Quote Accepted')).toBeDisabled();
  });
});

describe('Q6 — a quotation lands in a book that holds the lead', () => {
  it('a split lead\'s unmapped category goes to a rep who holds the lead, not to assigned_to', () => {
    const leads = [{ id: 'LS', client_name: 'Split', categories: ['Dairy'], category_assignments: { Dairy: R1 }, assigned_to: R2 }];
    expect(skuOwnerRep({ leads }, { lead_id: 'LS', category: 'Oil', created_by: R2 })).toBe(R1);
    expect(repBook({ leads }, [], R1).leads.map((l) => l.id)).toEqual(['LS']);
    expect(repBook({ leads }, [], R2).leads).toEqual([]);
    // two reps hold it: the SKU's creator when they are one of them, else the first
    const two = [{ id: 'LT', categories: ['Dairy', 'Oil'], category_assignments: { Dairy: R1, Oil: R2 } }];
    expect(skuOwnerRep({ leads: two }, { lead_id: 'LT', category: 'Ice', created_by: R2 })).toBe(R2);
    expect(skuOwnerRep({ leads: two }, { lead_id: 'LT', category: 'Ice', created_by: 'quote' })).toBe(R1);
    // the SKU's category is one of the lead's, unmapped: its lead-level owner holds it
    const half = [{ id: 'LH', categories: ['Dairy', 'Oil'], category_assignments: { Dairy: R1 }, assigned_to: R2 }];
    expect(skuOwnerRep({ leads: half }, { lead_id: 'LH', category: 'Oil', created_by: 'quote' })).toBe(R2);
    expect(repBook({ leads: half }, [], R2).leads.map((l) => l.id)).toEqual(['LH']);
    // no category map: the KAM, then the owner, as before
    expect(skuOwnerRep({ leads: [{ id: 'LK', kam: R2, assigned_to: R1, category_assignments: {} }] }, { lead_id: 'LK', category: 'Ice' })).toBe(R2);
  });

  it('Quote Accepted\'s add-by-hand offers only this rep\'s SKUs of the lead', async () => {
    openRep();
    await tab('✅ Quote Accepted');
    const card = await screen.findByLabelText('Add quotation by hand');
    await userEvent.click(within(card).getByLabelText('Manual pick Lead'));
    await userEvent.selectOptions(within(card).getByLabelText('Manual Lead'), 'L5');
    const opts = [...within(card).getByLabelText('Manual quotation SKU').options].map((o) => o.textContent);
    expect(opts).toContain('Split dairy');
    expect(opts).not.toContain('Split oil');                              // Rep Two's
  });
});

describe('Q7 / Q8 — PO → SO from a rep\'s PO', () => {
  const KOVA = [
    { group: 'SWIGGY', customer: 'Kova Agro', dispatchLoc: 'DHARAPURAM', warehouseName: 'DHARAPURAM' },
    { group: '', customer: 'Kova Agro', dispatchLoc: 'DHARAPURAM', warehouseName: 'KOVAI OWN' },
  ];
  const jss = [{ spec: 'A50', customer: 'Kova Agro', jobName: 'Coconut water 200 ml', jobType: 'Pouch', dispatchForm: 'Pouch', status: 'Active' }];
  const fgLedger = { A50: { prod: [{ date: '2026-09-01', qty: 300, ts: 1, id: 'p', note: '' }], alloc: [] } };
  const open = (warehouse) => renderApp(
    <Routes><Route path="/po-to-so" element={<PoToSo />} /><Route path="/po" element={<NewPO />} /></Routes>,
    {
      modules: {
        sales: salesModule({
          leads: [{ id: 'LK', client_name: 'KOVA AGRO', converted_to_customer: true }],
          pos: [{ id: 'p1', po_ref: 'ref9', lead_id: 'LK', customer: 'KOVA AGRO', despatch_location: 'DHARAPURAM', warehouse_name: warehouse, po_number: 'PO-90', date: '2026-09-29', created_by: R1, created_at: '2026-09-29T10:00:00Z', sku_id: 'K1', sku_name: 'Coconut 200', jss_spec: 'A50', qty: 1000, price: 3 }],
        }),
        customers: KOVA, jss, fgLedger, prices: { A50: { price: 3.5 } }, oab: { OAB: { SF: [], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 400 } },
      },
      role: 'user', route: '/po-to-so',
    },
  );
  const toNewPo = async () => {
    await userEvent.click(await screen.findByLabelText('Select PO PO-90'));
    await userEvent.click(screen.getByLabelText('Add to OAB'));
    expect(await screen.findByText(/From the sales rep/)).toBeInTheDocument();
  };

  it('Q7: a warehouse the Customer Master does not have lands on no row, and says so', async () => {
    open('OLD UNIT');
    await toNewPo();
    expect(screen.getByLabelText('Customer')).toHaveValue('Kova Agro');
    expect(screen.getByLabelText('Dispatch Location')).toHaveValue('');
    expect(screen.getByLabelText('Rep warehouse not in the Customer Master')).toHaveTextContent(/“OLD UNIT” is not in the Customer Master for Kova Agro at DHARAPURAM/);
    expect(screen.queryByText(/Warehouse: DHARAPURAM/)).toBeNull();     // never SWIGGY's row by default
    // review F7: nor SWIGGY's group — Kova Agro's rows sit under SWIGGY and under no
    // group, so which one the PO is for is the Superstar's to say
    expect(screen.getByLabelText('Group')).toHaveValue('');
    expect(screen.getByLabelText('Rep warehouse not in the Customer Master')).toHaveTextContent(/under more than one group/);
    // every row of the customer is offered, each naming its group
    const locOpts = [...screen.getByLabelText('Dispatch Location').options].filter((o) => o.value).map((o) => o.textContent);
    expect(locOpts).toEqual(['DHARAPURAM (DHARAPURAM) · SWIGGY', 'DHARAPURAM (KOVAI OWN) · no group']);
  });

  it('F7: the row the Superstar picks brings its group with it', async () => {
    open('OLD UNIT');
    await toNewPo();
    const sel = screen.getByLabelText('Dispatch Location');
    const swiggy = [...sel.options].find((o) => /SWIGGY/.test(o.textContent)).value;
    await userEvent.selectOptions(sel, swiggy);
    expect(screen.getByLabelText('Group')).toHaveValue('SWIGGY');
    expect(screen.getByLabelText('Customer')).toHaveValue('Kova Agro');
    expect(screen.getByText(/Warehouse: DHARAPURAM/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Rep warehouse not in the Customer Master')).toBeNull();
    // and the picker is the group's own again
    expect([...screen.getByLabelText('Dispatch Location').options].filter((o) => o.value).map((o) => o.textContent)).toEqual(['DHARAPURAM (DHARAPURAM)']);
  });

  it('F7: the customer’s own row leaves no group, as a customer with none', async () => {
    open('OLD UNIT');
    await toNewPo();
    const sel = screen.getByLabelText('Dispatch Location');
    await userEvent.selectOptions(sel, [...sel.options].find((o) => /no group/.test(o.textContent)).value);
    expect(screen.getByLabelText('Group')).toHaveValue('');
    expect(screen.getByLabelText('Customer')).toHaveValue('Kova Agro');
    expect(screen.getByText(/Warehouse: KOVAI OWN/)).toBeInTheDocument();
  });

  it('F7: a customer under ONE group keeps that group when the warehouse is not found', async () => {
    const r = renderApp(
      <Routes><Route path="/po-to-so" element={<PoToSo />} /><Route path="/po" element={<NewPO />} /></Routes>,
      {
        modules: {
          sales: salesModule({
            leads: [{ id: 'LK', client_name: 'KOVA AGRO', converted_to_customer: true }],
            pos: [{ id: 'p1', po_ref: 'ref9', lead_id: 'LK', customer: 'KOVA AGRO', despatch_location: 'DHARAPURAM', warehouse_name: 'OLD UNIT', po_number: 'PO-90', date: '2026-09-29', created_by: R1, created_at: '2026-09-29T10:00:00Z', sku_id: 'K1', sku_name: 'Coconut 200', jss_spec: 'A50', qty: 1000, price: 3 }],
          }),
          customers: [KOVA[0], { ...KOVA[0], warehouseName: 'TIRUPUR' }], jss, fgLedger, prices: { A50: { price: 3.5 } }, oab: { OAB: { SF: [], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 400 } },
        },
        role: 'user', route: '/po-to-so',
      },
    );
    expect(r).toBeTruthy();
    await toNewPo();
    expect(screen.getByLabelText('Group')).toHaveValue('SWIGGY');
    expect(screen.getByLabelText('Dispatch Location')).toHaveValue('');
    expect(screen.getByLabelText('Rep warehouse not in the Customer Master')).not.toHaveTextContent(/more than one group/);
  });

  it('Q8: the FG chosen is reported, not dropped, when the sale orders cannot be matched to the lines', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { saved } = open('KOVAI OWN');
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const r = await orig(url, opts);
      if (!(String(url).includes('/api/sales-orders') && String(opts.method || 'GET').toUpperCase() === 'POST')) return r;
      const body = await r.json();
      const odd = { created: [...body.created, '26/999'] };              // one more SO than lines
      return { ...r, json: async () => odd, text: async () => JSON.stringify(odd) };
    };
    await toNewPo();
    await userEvent.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));
    await waitFor(() => expect(screen.getByLabelText('Select A50')).toBeChecked());
    await userEvent.type(screen.getByLabelText('Use FG for A50'), '200');
    await userEvent.click(screen.getByRole('button', { name: /Review →/ }));
    await userEvent.click(await screen.findByRole('button', { name: /🚀 Push to OAB/ }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringMatching(/finished goods chosen were NOT applied \(A50 × 200\)/)));
    expect(saved.some((s) => s.id === 9)).toBe(false);                    // nothing drawn down against a guess
    alert.mockRestore();
  });
});
