import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import RepPortal from '../pages/RepPortal.jsx';
import {
  skuCsaDone, skuReadyForPO, toggleSkuStage, acceptedMinPrice, platesForSku,
  quotesToSend, allowedDespatchForms, buildSku, buildPo, buildVisit,
} from '../lib/repPortal.js';

const REP = 'R1';
const leads = [{ id: 'L1', client_name: 'Acme Dairy', categories: ['Dairy'], category_assignments: { Dairy: REP }, created_by: REP }];
const sku = (over = {}) => ({
  id: 'S1', lead_id: 'L1', sku_name: '200g Turmeric Pouch', category: 'Dairy',
  dispatch_form: 'Pouch', created_by: REP, created_at: '2026-08-01T00:00:00Z',
  quotation_received: false, quotation_accepted: false, quotation_sent: false, ...over,
});

describe('SKU workflow — what clears a SKU for a PO', () => {
  it('CSA is done only when QC has generated the report — a rep cannot set it', () => {
    const s = sku();
    expect(skuCsaDone({ qc_reports: [] }, s)).toBe(false);
    expect(skuCsaDone({ qc_reports: [{ sku_id: 'S1' }] }, s)).toBe(true);
    // Toggling it is a no-op: the array comes back untouched.
    const skus = [s];
    expect(toggleSkuStage(skus, 'S1', 'csa_received')[0]).toBe(s);
  });

  it('needs CSA + quotation received + accepted, all three', () => {
    const sales = { qc_reports: [{ sku_id: 'S1' }] };
    expect(skuReadyForPO(sales, sku())).toBe(false);
    expect(skuReadyForPO(sales, sku({ quotation_received: true }))).toBe(false);
    expect(skuReadyForPO(sales, sku({ quotation_received: true, quotation_accepted: true }))).toBe(true);
    // …and without the CSA report, the other two are not enough.
    expect(skuReadyForPO({ qc_reports: [] }, sku({ quotation_received: true, quotation_accepted: true }))).toBe(false);
  });

  it('stamps a timestamp when a stage goes on and clears it when it goes off', () => {
    const now = new Date('2026-08-20T10:00:00Z');
    let skus = toggleSkuStage([sku()], 'S1', 'quotation_sent', { now });
    expect(skus[0].quotation_sent).toBe(true);
    expect(skus[0].quotation_sent_at).toBe(now.toISOString());
    skus = toggleSkuStage(skus, 'S1', 'quotation_sent', { now });
    expect(skus[0].quotation_sent).toBe(false);
    expect(skus[0].quotation_sent_at).toBe('');
  });

  it('leaves every other SKU alone', () => {
    const other = sku({ id: 'S2' });
    const out = toggleSkuStage([sku(), other], 'S1', 'sample_sent');
    expect(out[1]).toBe(other);
  });
});

describe('acceptedMinPrice — the slab that applies to an order', () => {
  const s = sku({ price_tiers: [{ qty: 1000, price: 12 }, { qty: 5000, price: 10 }, { qty: 500, price: 14 }] });

  it('takes the highest slab the quantity reaches', () => {
    expect(acceptedMinPrice(s, 5000)).toBe(10);
    expect(acceptedMinPrice(s, 4999)).toBe(12);
    expect(acceptedMinPrice(s, 1000)).toBe(12);
  });

  it('falls back to the smallest slab below the lowest break', () => {
    expect(acceptedMinPrice(s, 10)).toBe(14);
  });

  it('is null when no slabs are recorded, so nothing is blocked', () => {
    expect(acceptedMinPrice(sku(), 100)).toBe(null);
    expect(acceptedMinPrice(sku({ price_tiers: [{ qty: 0, price: 5 }] }), 100)).toBe(null);
  });
});

describe('buildPo — the price guard', () => {
  const sales = { qc_reports: [{ sku_id: 'S1' }] };
  const ready = sku({ quotation_received: true, quotation_accepted: true, price_tiers: [{ qty: 1000, price: 12 }] });

  it('books a PO and carries the SKU dimensions onto it', () => {
    const po = buildPo({ sku: ready, qty: 1000, price: 12, poNumber: 'PO-9' }, sales, REP,
      { now: new Date('2026-08-20T00:00:00Z'), uid: (p) => p + '_1' });
    expect(po).toMatchObject({ lead_id: 'L1', sku_id: 'S1', qty: 1000, price: 12, category: 'Dairy', dispatch_form: 'Pouch', created_by: REP });
  });

  it('refuses a price below the accepted slab for that quantity', () => {
    expect(() => buildPo({ sku: ready, qty: 1000, price: 11 }, sales, REP)).toThrow(/below the accepted price ₹12/);
  });

  it('refuses a SKU that has not cleared CSA + quotation', () => {
    expect(() => buildPo({ sku: sku(), qty: 10, price: 99 }, sales, REP)).toThrow(/not cleared for a PO/);
  });

  it('requires a SKU, a quantity and a price', () => {
    expect(() => buildPo({ sku: ready, qty: 0, price: 12 }, sales, REP)).toThrow(/required/);
    expect(() => buildPo({ sku: null, qty: 1, price: 1 }, sales, REP)).toThrow(/required/);
  });
});

describe('buildVisit', () => {
  it('demands notes — an entry with none tells the next person nothing', () => {
    expect(() => buildVisit({ leadId: 'L1', type: 'Call', outcome: '  ' }, REP)).toThrow(/add notes/);
    expect(() => buildVisit({ leadId: '', outcome: 'x' }, REP)).toThrow(/Select a lead/);
  });

  it('defaults the next ping to two days out rather than leaving it blank', () => {
    const v = buildVisit({ leadId: 'L1', type: 'Call', outcome: 'Spoke to buyer' }, REP, { now: new Date('2026-08-20T00:00:00') });
    expect(v.follow_up_date).toBe('2026-08-22');
  });

  it('records an expense only for a Visit', () => {
    const opts = { now: new Date('2026-08-20T00:00:00') };
    expect(buildVisit({ leadId: 'L1', type: 'Visit', outcome: 'x', expense: 500 }, REP, opts).expense).toBe(500);
    expect(buildVisit({ leadId: 'L1', type: 'Call', outcome: 'x', expense: 500 }, REP, opts).expense).toBe(0);
  });
});

describe('buildSku', () => {
  it('names the missing field', () => {
    expect(() => buildSku({}, REP)).toThrow(/Select a customer/);
    expect(() => buildSku({ leadId: 'L1' }, REP)).toThrow(/SKU name/);
    expect(() => buildSku({ leadId: 'L1', name: 'X' }, REP)).toThrow(/category/);
    expect(() => buildSku({ leadId: 'L1', name: 'X', category: 'Dairy' }, REP)).toThrow(/dispatch form/);
  });

  it('starts every workflow stage off', () => {
    const s = buildSku({ leadId: 'L1', name: 'X', category: 'Dairy', dispatchForm: 'Pouch' }, REP, { uid: (p) => p + '_1' });
    expect(s).toMatchObject({ quotation_received: false, quotation_accepted: false, price_tiers: [] });
  });
});

describe('allowedDespatchForms', () => {
  const all = [['Roll', 'Roll'], ['Pouch', 'Pouch'], ['Label', 'Label']];

  it('narrows to what the sales admin approved for that customer + category', () => {
    const lead = { category_dispatch_forms: { Dairy: ['Pouch'] } };
    expect(allowedDespatchForms(lead, 'Dairy', all)).toEqual([['Pouch', 'Pouch']]);
  });

  it('allows everything when nothing is configured', () => {
    expect(allowedDespatchForms({ category_dispatch_forms: { Dairy: [] } }, 'Dairy', all)).toBe(all);
    expect(allowedDespatchForms(null, 'Dairy', all)).toBe(all);
  });
});

describe('quotesToSend / platesForSku', () => {
  it('flags quotations back from the desk but not yet sent on', () => {
    const sales = {
      skus: [sku(), sku({ id: 'S2', quotation_sent: true })],
      quotations: [{ items: [{ sku_id: 'S1' }] }, { items: [{ sku_id: 'S2' }] }],
    };
    expect(quotesToSend(sales, REP).map((s) => s.id)).toEqual(['S1']);
  });

  it('totals the plate cost PM pushed for the SKU', () => {
    const sales = { qc_reports: [{ sku_id: 'S1', plates_pushed: true, plates: { ci_per: 100, ci_n: 4, off_per: 50, off_n: 2 } }] };
    expect(platesForSku(sales, sku()).total).toBe(500);
    expect(platesForSku({ qc_reports: [{ sku_id: 'S1', plates: { ci_per: 1 } }] }, sku())).toBe(null);
  });
});

/* ── Screens ─────────────────────────────────────────────────────────────── */

const salesModule = (over = {}) => ({
  leads, contacts: [], interactions: [], skus: [], pos: [], quotations: [],
  qc_reports: [], sales_users: [{ id: REP, username: 'rep1', display_name: 'Rep One', status: 'Active' }],
  targets: [], substrate_options: [], nego_msgs: [], dropdowns: {}, ...over,
});

const openRep = (sales) => renderApp(<RepPortal />, { modules: { sales }, role: 'sales', repId: REP });

describe('Rep Portal — the tabs production ships', () => {
  it('shows Log Visit, Enter PO, My Targets and SKUs', async () => {
    openRep(salesModule());
    await screen.findByText('🗓 Follow-ups');
    ['📋 Log Visit', '🧾 Enter PO', '🎯 My Targets', '📦 SKUs'].forEach((t) => {
      expect(screen.getByText(t)).toBeInTheDocument();
    });
  });

  it('Enter PO warns when nothing has cleared the workflow yet', async () => {
    openRep(salesModule({ skus: [sku()] }));
    await screen.findByText('🗓 Follow-ups');
    await userEvent.click(screen.getByText('🧾 Enter PO'));
    expect(await screen.findByText(/No SKUs are ready for a PO yet/)).toBeInTheDocument();
  });

  it('logs a visit and moves the lead\'s next ping with it', async () => {
    const { saved } = openRep(salesModule());
    await screen.findByText('🗓 Follow-ups');
    await userEvent.click(screen.getByText('📋 Log Visit'));

    await userEvent.selectOptions(await screen.findByLabelText('Lead'), 'L1');
    await userEvent.type(screen.getByLabelText('Outcome / Notes'), 'Met the buyer, samples approved');
    await userEvent.click(screen.getByRole('button', { name: /Save Update/ }));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const data = saved.filter((s) => s.key === 'sales').pop().data;
    expect(data.interactions).toHaveLength(1);
    expect(data.interactions[0].outcome).toBe('Met the buyer, samples approved');
    // The lead now carries the same next-ping date, so Follow-ups picks it up.
    expect(data.leads[0].next_follow_up_date).toBe(data.interactions[0].follow_up_date);
  });

  it('shows a target set by the admin, with progress from the rep\'s own POs', async () => {
    openRep(salesModule({
      targets: [{ id: 'T1', rep_id: REP, period_type: 'month', period_key: '2026-08', dim: 'category', key: 'Dairy', amount: 10000 }],
      skus: [sku()],
      pos: [{ id: 'P1', created_by: REP, sku_id: 'S1', date: '2026-08-05', qty: 500, price: 12 }],
    }));
    await screen.findByText('🗓 Follow-ups');
    await userEvent.click(screen.getByText('🎯 My Targets'));
    expect(await screen.findByText(/Monthly — 2026-08/)).toBeInTheDocument();
    expect(screen.getByText('₹6,000')).toBeInTheDocument();   // 500 × 12 achieved
  });
});
