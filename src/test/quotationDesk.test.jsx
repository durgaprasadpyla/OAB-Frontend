import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import QuotationDesk, { QuotationDoc } from '../pages/QuotationDesk.jsx';
import {
  buildTier, platesTotal, nextQuoteVersion, buildQuotation,
  applyQuoteSideEffects, freezeQuote, allQuotes, DEFAULT_GST_PCT,
} from '../lib/sales.js';

describe('buildTier — slab pricing with GST', () => {
  it('adds GST and rounds to paise', () => {
    expect(buildTier(1000, 12.5, 18)).toEqual({
      qty: 1000, price_wo_gst: 12.5, gst_pct: 18, gst_amt: 2.25, price_w_gst: 14.75,
    });
  });

  it('defaults a blank GST to 18%, never zero', () => {
    // Treating a blank as 0% would quietly under-quote the tax.
    expect(buildTier(100, 10, '').gst_pct).toBe(DEFAULT_GST_PCT);
    expect(buildTier(100, 10, undefined).gst_pct).toBe(DEFAULT_GST_PCT);
    expect(buildTier(100, 10, -5).gst_pct).toBe(DEFAULT_GST_PCT);
  });

  it('honours an explicit 0% GST', () => {
    expect(buildTier(100, 10, 0)).toMatchObject({ gst_pct: 0, gst_amt: 0, price_w_gst: 10 });
  });

  it('rejects a slab with no price but keeps a zero-quantity one', () => {
    expect(buildTier(100, '', 18)).toBeNull();
    expect(buildTier(100, null, 18)).toBeNull();
    expect(buildTier('', 5, 18)).toMatchObject({ qty: 0, price_wo_gst: 5 });
  });

  it('rounds a repeating GST amount correctly', () => {
    const t = buildTier(1, 33.33, 18);
    expect(t.gst_amt).toBe(6);           // 5.9994 -> 6.00
    expect(t.price_w_gst).toBe(39.33);
  });
});

describe('platesTotal', () => {
  it('sums both printing types', () => {
    expect(platesTotal({ ci_per: 1200, ci_n: 4, off_per: 500, off_n: 2 })).toBe(5800);
  });
  it('is zero for missing or partial data', () => {
    expect(platesTotal(null)).toBe(0);
    expect(platesTotal({})).toBe(0);
    expect(platesTotal({ ci_per: 1000 })).toBe(0);   // no count -> no cost
  });
});

describe('nextQuoteVersion', () => {
  const qs = [
    { lead_id: 'L1', version: 1 }, { lead_id: 'L1', version: 2 }, { lead_id: 'L2', version: 7 },
  ];
  it('versions per customer, not globally', () => {
    expect(nextQuoteVersion(qs, 'L1')).toBe(3);
    expect(nextQuoteVersion(qs, 'L2')).toBe(8);
    expect(nextQuoteVersion(qs, 'L9')).toBe(1);
    expect(nextQuoteVersion([], 'L1')).toBe(1);
  });
  it('treats a versionless legacy quote as v1', () => {
    expect(nextQuoteVersion([{ lead_id: 'L1' }], 'L1')).toBe(2);
  });
});

describe('buildQuotation', () => {
  const items = [{ sku_id: 'S1', sku_name: 'Pouch A', tiers: [buildTier(100, 10, 18)] }];
  const opts = { now: new Date('2026-08-20T10:00:00Z'), uid: (p) => p + '_1' };

  it('stamps the next version and marks the quote sent', () => {
    const q = buildQuotation({ leadId: 'L1', clientName: 'Acme', items }, [{ lead_id: 'L1', version: 4 }], opts);
    expect(q).toMatchObject({ lead_id: 'L1', client_name: 'Acme', version: 5, status: 'sent', created_by: 'quote' });
  });

  it('drops SKUs with no usable slab', () => {
    const mixed = [...items, { sku_id: 'S2', sku_name: 'Pouch B', tiers: [] }];
    expect(buildQuotation({ leadId: 'L1', items: mixed }, [], opts).items.map((i) => i.sku_id)).toEqual(['S1']);
  });

  it('refuses a quote with no customer or nothing priced', () => {
    expect(() => buildQuotation({ leadId: '', items }, [], opts)).toThrow(/Select a customer/);
    expect(() => buildQuotation({ leadId: 'L1', items: [] }, [], opts)).toThrow(/at least one price slab/i);
    expect(() => buildQuotation({ leadId: 'L1', items: [{ sku_id: 'S2', tiers: [] }] }, [], opts)).toThrow(/at least one price slab/i);
  });

  it('carries the fine print and costing notes', () => {
    const q = buildQuotation({ leadId: 'L1', items, header: { notes: 'n', rmSnapshot: 'rm' }, finePrint: { terms: 't' } }, [], opts);
    expect(q.notes).toBe('n');
    expect(q.rm_snapshot).toBe('rm');
    expect(q.fine_print.terms).toBe('t');
  });
});

describe('applyQuoteSideEffects', () => {
  const quote = { items: [{ sku_id: 'S1' }] };
  it('moves the quoted SKU\'s CSA report to Quoted and clears the review flag', () => {
    const out = applyQuoteSideEffects(quote, {
      qcReports: [{ sku_id: 'S1', status: 'Pending', needs_quote_review: true }, { sku_id: 'S2', status: 'Pending' }],
      skus: [],
    });
    expect(out.qc_reports[0]).toMatchObject({ status: 'Quoted', needs_quote_review: false });
    expect(out.qc_reports[1].status).toBe('Pending');   // untouched SKU
  });

  it('flags the rep\'s SKU as quotation received', () => {
    const out = applyQuoteSideEffects(quote, { qcReports: [], skus: [{ id: 'S1' }, { id: 'S2' }] });
    expect(out.skus[0].quotation_received).toBe(true);
    expect(out.skus[1].quotation_received).toBeUndefined();
  });

  it('does not re-flag a SKU whose quote was already sent on', () => {
    const out = applyQuoteSideEffects(quote, { qcReports: [], skus: [{ id: 'S1', quotation_sent: true }] });
    expect(out.skus[0].quotation_received).toBeUndefined();
  });
});

describe('freezeQuote / allQuotes', () => {
  const qs = [{ id: 'a', status: 'sent', created_at: '2026-08-01' }, { id: 'b', status: 'sent', created_at: '2026-08-05' }];
  it('freezes only the named quote', () => {
    const out = freezeQuote(qs, 'a');
    expect(out[0].status).toBe('final');
    expect(out[1].status).toBe('sent');
  });
  it('lists newest first', () => {
    expect(allQuotes(qs).map((q) => q.id)).toEqual(['b', 'a']);
  });
});

/* ─────────────────────────── screen ─────────────────────────── */

const salesModule = () => ({
  leads: [{ id: 'L1', client_name: 'Acme Dairy' }, { id: 'L2', client_name: 'Beta Snacks' }],
  skus: [{ id: 'S1', lead_id: 'L1', sku_name: 'Pouch A', micron: 50 }, { id: 'S2', lead_id: 'L1', sku_name: 'Pouch B' }],
  quotations: [], qc_reports: [{ sku_id: 'S1', status: 'Pending', needs_quote_review: true }],
  sales_users: [], contacts: [], interactions: [], pos: [], targets: [],
  substrate_options: [], nego_msgs: [], dropdowns: {},
});

const openDesk = async () => {
  const r = renderApp(<QuotationDesk />, { modules: { sales: salesModule() }, role: 'quote' });
  await waitFor(() => expect(screen.getByText('Quotation Desk')).toBeInTheDocument());
  return r;
};

describe('Quotation Desk — issuing', () => {
  it('lists only the chosen customer\'s SKUs', async () => {
    await openDesk();
    await userEvent.selectOptions(screen.getByLabelText('Customer'), 'L1');
    expect(screen.getByText('Pouch A')).toBeInTheDocument();
    expect(screen.getByText('Pouch B')).toBeInTheDocument();
  });

  it('previews the GST-inclusive rate as a slab is typed', async () => {
    await openDesk();
    await userEvent.selectOptions(screen.getByLabelText('Customer'), 'L1');
    await userEvent.click(screen.getByLabelText('Quote Pouch A'));
    await userEvent.type(screen.getByLabelText('Slab 1 price S1'), '12.5');
    expect(screen.getByText(/incl. GST ₹14.75/)).toBeInTheDocument();
  });

  it('issues a quotation and applies the CSA side-effects', async () => {
    const { saved } = await openDesk();
    await userEvent.selectOptions(screen.getByLabelText('Customer'), 'L1');
    await userEvent.click(screen.getByLabelText('Quote Pouch A'));
    await userEvent.type(screen.getByLabelText('Slab 1 qty S1'), '1000');
    await userEvent.type(screen.getByLabelText('Slab 1 price S1'), '12.5');
    await userEvent.click(screen.getByText(/Issue quotation/));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const blob = saved.filter((s) => s.key === 'sales').pop().data;
    expect(blob.quotations).toHaveLength(1);
    const q = blob.quotations[0];
    expect(q).toMatchObject({ lead_id: 'L1', client_name: 'Acme Dairy', version: 1, status: 'sent' });
    expect(q.items[0].tiers[0]).toMatchObject({ qty: 1000, price_wo_gst: 12.5, price_w_gst: 14.75 });
    // Side-effects landed in the same save.
    expect(blob.qc_reports[0]).toMatchObject({ status: 'Quoted', needs_quote_review: false });
    expect(blob.skus.find((s) => s.id === 'S1').quotation_received).toBe(true);
  });

  it('refuses to issue with a SKU ticked but no price', async () => {
    const { saved } = await openDesk();
    await userEvent.selectOptions(screen.getByLabelText('Customer'), 'L1');
    await userEvent.click(screen.getByLabelText('Quote Pouch A'));
    await userEvent.click(screen.getByText(/Issue quotation/));
    expect(screen.getByText(/at least one price slab/i)).toBeInTheDocument();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
  });

  it('supports several slabs on one SKU', async () => {
    const { saved } = await openDesk();
    await userEvent.selectOptions(screen.getByLabelText('Customer'), 'L1');
    await userEvent.click(screen.getByLabelText('Quote Pouch A'));
    await userEvent.type(screen.getByLabelText('Slab 1 price S1'), '12');
    await userEvent.click(screen.getByLabelText('Add slab S1'));
    await userEvent.type(screen.getByLabelText('Slab 2 price S1'), '11');
    await userEvent.click(screen.getByText(/Issue quotation/));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const q = saved.filter((s) => s.key === 'sales').pop().data.quotations[0];
    expect(q.items[0].tiers.map((t) => t.price_wo_gst)).toEqual([12, 11]);
  });
});

describe('Quotation Desk — sent list', () => {
  const withQuote = () => ({
    ...salesModule(),
    quotations: [{
      id: 'q1', lead_id: 'L1', client_name: 'Acme Dairy', version: 2, date: '2026-08-10',
      status: 'sent', created_at: '2026-08-10T00:00:00Z',
      items: [{ sku_id: 'S1', sku_name: 'Pouch A', gst_pct: 18, tiers: [{ qty: 1000, price_wo_gst: 12.5, gst_amt: 2.25, price_w_gst: 14.75 }], plate: { ci_per: 100, ci_n: 2 } }],
      fine_print: { terms: 'Payment 30 days' },
    }],
  });
  const openSent = async () => {
    const r = renderApp(<QuotationDesk />, { modules: { sales: withQuote() }, role: 'quote' });
    await waitFor(() => expect(screen.getByText('Quotation Desk')).toBeInTheDocument());
    const t = [...document.querySelectorAll('.step-tab')].find((el) => /Sent/.test(el.textContent));
    await userEvent.click(t);
    return r;
  };

  it('lists issued quotations with their version', async () => {
    await openSent();
    await waitFor(() => expect(screen.getByText('Acme Dairy')).toBeInTheDocument());
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('Pouch A')).toBeInTheDocument();
  });

  it('freezes a quotation', async () => {
    const { saved } = await openSent();
    await userEvent.click(screen.getByLabelText('Freeze Acme Dairy v2'));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    expect(saved.filter((s) => s.key === 'sales').pop().data.quotations[0].status).toBe('final');
  });

  it('opens the document with its slabs and plate cost', async () => {
    await openSent();
    await userEvent.click(screen.getByLabelText('Open quotation Acme Dairy v2'));
    expect(screen.getByText('QUOTATION')).toBeInTheDocument();
    expect(screen.getByText('₹14.75')).toBeInTheDocument();
    expect(screen.getByText(/One-time plate cost/)).toBeInTheDocument();
  });
});

describe('QuotationDoc', () => {
  const quote = {
    client_name: 'Acme', version: 3, date: '2026-08-10',
    items: [{ sku_name: 'Pouch A', item_code: 'IC-1', micron: 50, gst_pct: 18, moq: '5000', tiers: [{ qty: 1000, price_wo_gst: 10, gst_amt: 1.8, price_w_gst: 11.8 }], plate: {} }],
    fine_print: { greeting: 'Dear Sir', terms: 'Payment 30 days' }, notes: 'Lead time 2 weeks',
  };

  it('renders the customer, version, slabs and fine print', () => {
    render(<QuotationDoc quote={quote} />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText('Dear Sir')).toBeInTheDocument();
    expect(screen.getByText('Payment 30 days')).toBeInTheDocument();
    expect(screen.getByText('₹11.80')).toBeInTheDocument();
    expect(screen.getByText(/Lead time 2 weeks/)).toBeInTheDocument();
  });

  it('omits the plate line when there is no plate cost', () => {
    render(<QuotationDoc quote={quote} />);
    expect(screen.queryByText(/One-time plate cost/)).not.toBeInTheDocument();
  });
});
