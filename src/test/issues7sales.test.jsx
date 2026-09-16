import { describe, it, expect } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderApp } from './harness.jsx';
import RepPortal from '../pages/RepPortal.jsx';
import PoToSo from '../pages/PoToSo.jsx';
import NewPO from '../pages/NewPO.jsx';
import QC from '../pages/QC.jsx';

// Sales Login (2026-09-15) — the screens, end to end over the harness:
// the rep sends a sample for CSA, prices and sends a quotation, enters a PO with
// several SKUs; QC creates the JSS from the accepted CSA; the Superstar picks the
// PO up on the PO → SO tab and lands on the Add SO page pre-filled.

const REP = 'R1';
const leads = [
  { id: 'L1', client_name: 'Acme Dairy', categories: ['Dairy'], category_assignments: { Dairy: REP }, created_by: REP, delivery_location: 'Hyderabad' },
  { id: 'L2', client_name: 'Beta Foods', categories: ['Oil'], category_assignments: { Oil: REP }, created_by: REP, converted_to_customer: true },
];
const customers = [{ group: 'BETA GROUP', customer: 'Beta Foods', dispatchLoc: 'Pune', warehouseName: 'W1' }, { group: 'BETA GROUP', customer: 'Beta Foods', dispatchLoc: 'Nashik' }];
const sku = (over = {}) => ({ id: 'S1', lead_id: 'L2', sku_name: '200g Pouch', category: 'Oil', dispatch_form: 'Pouch', created_by: REP, created_at: '2026-09-01T00:00:00Z', ...over });
const salesModule = (over = {}) => ({
  leads, contacts: [], interactions: [], skus: [], pos: [], quotations: [], qc_reports: [],
  sales_users: [{ id: REP, username: 'rep1', display_name: 'Rep One', status: 'Active' }],
  targets: [], substrate_options: [], nego_msgs: [], dropdowns: { despatch: ['Roll', 'Pouch', 'Bulk Bags'] }, ...over,
});
const openRep = (sales, extra = {}) => renderApp(<RepPortal />, { modules: { sales, customers, ...extra }, role: 'sales', repId: REP });
const tab = async (label) => userEvent.click(await screen.findByText(label));
const lastSales = (saved) => saved.filter((s) => s.key === 'sales').pop().data;

describe('Rep — SKUs and the CSA requisition', () => {
  it('adds a SKU under a customer with its structure, then sends the sample for CSA with the despatch details', async () => {
    const { saved } = openRep(salesModule());
    await tab('📦 SKUs');
    await userEvent.click(screen.getByLabelText('SKU pick Customer'));
    await userEvent.selectOptions(screen.getByLabelText('SKU Customer'), 'L2');
    await userEvent.type(screen.getByLabelText('SKU Name'), '1kg Oil Pouch');
    await userEvent.type(screen.getByLabelText('Structure'), 'PET 12 / LDPE 60');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Oil');
    await userEvent.selectOptions(screen.getByLabelText('Dispatch Form'), 'Pouch');
    await userEvent.click(screen.getByText('✓ Add SKU'));
    await waitFor(() => expect(lastSales(saved).skus).toHaveLength(1));
    expect(lastSales(saved).skus[0]).toMatchObject({ sku_name: '1kg Oil Pouch', structure: 'PET 12 / LDPE 60', lead_id: 'L2' });

    // pick it (radio), say the sample is received, fill the requisition, send to QC
    await userEvent.click(await screen.findByLabelText('Edit 1kg Oil Pouch'));
    await userEvent.click(screen.getByLabelText('Sample received Yes'));
    const req = await screen.findByLabelText('CSA requisition');
    await userEvent.selectOptions(within(req).getByLabelText('Despatch location'), 'Pune');
    await userEvent.type(within(req).getByLabelText('Tentative order quantity'), '50000');
    fireEvent.change(within(req).getByLabelText('Tentative despatch date'), { target: { value: '2026-10-15' } });
    await userEvent.type(within(req).getByLabelText('Target price'), '3.25');
    await userEvent.type(within(req).getByLabelText('Pouch width end to end (mm)'), '150');
    await userEvent.click(within(req).getByText('🧪 Send for CSA to QC'));
    await waitFor(() => expect(lastSales(saved).skus[0].csa_requested).toBe(true));
    const r = lastSales(saved).skus[0].csa_request;
    expect(r).toMatchObject({ despatch_location: 'Pune', tentative_qty: 50000, tentative_date: '2026-10-15', target_price: 3.25, kind: 'pouch' });
    expect(r.details.pouch_width_mm).toBe(150);
    expect(await screen.findByText(/sent to QC for the CSA report/)).toBeInTheDocument();
  });
});

describe('Rep — quotations, sending and accepting', () => {
  const quoted = salesModule({
    skus: [sku()],
    quotations: [{ id: 'q1', lead_id: 'L2', client_name: 'Beta Foods', version: 1, date: '2026-09-10', status: 'sent', items: [{ sku_id: 'S1', sku_name: '200g Pouch', tiers: [{ qty: 100000, price_wo_gst: 2.5, gst_pct: 18, gst_amt: 0.45, price_w_gst: 2.95 }] }] }],
  });

  it('shows the desk price per MOQ, refuses a lower price, saves a higher one', async () => {
    const { saved } = openRep(quoted);
    await tab('💬 Quotations');
    await userEvent.click(await screen.findByLabelText('Quote 200g Pouch'));
    expect(await screen.findByText('₹2.50')).toBeInTheDocument();
    const price = screen.getByLabelText('Slab 1 price');
    fireEvent.change(price, { target: { value: '2.4' } });
    await userEvent.click(screen.getByText('💾 Save'));
    expect(await screen.findByText(/below the quote desk/)).toBeInTheDocument();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
    fireEvent.change(price, { target: { value: '2.75' } });
    await userEvent.click(screen.getByText('💾 Save'));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    expect(lastSales(saved).skus[0].rep_quote.tiers).toEqual([{ qty: 100000, price: 2.75 }]);
    // the arrow cannot go under the floor
    expect(screen.getByLabelText('Lower slab 1')).not.toBeDisabled();
  });

  it('sends the quote from the Send Quote tab once a customer is picked, and keeps a history', async () => {
    const { saved } = openRep(quoted);
    await tab('📤 Send Quote');
    const box = await screen.findByLabelText('Send 200g Pouch');
    expect(box).toBeDisabled();                                   // §49: no customer picked yet
    await userEvent.selectOptions(screen.getByLabelText('Filter by customer'), 'Beta Foods');
    await waitFor(() => expect(screen.getByLabelText('Send 200g Pouch')).not.toBeDisabled());
    await userEvent.click(screen.getByLabelText('Send 200g Pouch'));
    await userEvent.click(screen.getByRole('button', { name: /Prepare Quote/ }));
    const doc = await screen.findByLabelText('Prepared quotation');
    expect(within(doc).getByText('⬇ Download as PDF')).toBeInTheDocument();
    await userEvent.click(within(doc).getByText('📤 Sent Quote'));
    await waitFor(() => expect(lastSales(saved).skus[0].quotation_sent).toBe(true));
    expect(lastSales(saved).skus[0].quote_history).toHaveLength(1);
    // the toggle at the end of the row accepts it
    await userEvent.selectOptions(await screen.findByLabelText('Quote accepted 200g Pouch'), 'yes');
    await waitFor(() => expect(lastSales(saved).skus[0].quotation_accepted).toBe(true));
    expect(lastSales(saved).skus[0].price_tiers).toEqual([{ qty: 100000, price: 2.5 }]);
    await tab('✅ Quote Accepted');
    expect(await screen.findByText('awaiting QC')).toBeInTheDocument();
  });
});

describe('Rep — the PO with several SKUs', () => {
  it('lists the customer, its despatch locations, the accepted SKUs with a JSS, prices the lines and saves them', async () => {
    const skus = [
      sku({ quotation_accepted: true, jss_spec: 'A900', price_tiers: [{ qty: 1000, price: 12 }, { qty: 5000, price: 10 }] }),
      sku({ id: 'S2', sku_name: 'Bag', quotation_accepted: true, jss_spec: 'A901', price_tiers: [{ qty: 1, price: 5 }] }),
      sku({ id: 'S3', sku_name: 'NoJss', quotation_accepted: true, price_tiers: [{ qty: 1, price: 5 }] }),
    ];
    const { saved } = openRep(salesModule({ skus, qc_reports: [{ sku_id: 'S1' }, { sku_id: 'S2' }] }));
    await tab('🧾 Enter PO');
    await userEvent.selectOptions(await screen.findByLabelText('PO customer'), 'L2');
    await userEvent.selectOptions(screen.getByLabelText('PO despatch location'), 'Nashik');
    await userEvent.type(screen.getByLabelText('PO Number'), 'PO-77');
    const first = screen.getByLabelText('PO SKU 1');
    expect(within(first).queryByText(/NoJss/)).toBeNull();          // no JSS yet → not offered
    await userEvent.selectOptions(first, 'S1');
    expect(screen.getByLabelText('PO JSS 1')).toHaveTextContent('A900');
    await userEvent.type(screen.getByLabelText('PO quantity 1'), '6000');
    await waitFor(() => expect(screen.getByLabelText('PO price 1')).toHaveValue(10));
    await userEvent.click(screen.getByText('＋ Another SKU'));
    const second = screen.getByLabelText('PO SKU 2');
    expect(within(second).queryByText(/200g Pouch/)).toBeNull();     // already on the PO
    await userEvent.selectOptions(second, 'S2');
    await userEvent.type(screen.getByLabelText('PO quantity 2'), '100');
    await userEvent.click(screen.getByText('✓ Save PO'));
    await waitFor(() => expect(lastSales(saved).pos).toHaveLength(2));
    const pos = lastSales(saved).pos;
    expect(pos[0]).toMatchObject({ po_number: 'PO-77', jss_spec: 'A900', qty: 6000, price: 10, despatch_location: 'Nashik', customer: 'Beta Foods' });
    expect(pos[1]).toMatchObject({ jss_spec: 'A901', qty: 100, price: 5 });
    expect(pos[0].po_ref).toBe(pos[1].po_ref);
  });
});

describe('QC — the JSS from the accepted CSA', () => {
  it('lists the accepted CSA of a converted customer, fills the form, and writes the JSS back onto the SKU', async () => {
    const sales = salesModule({
      skus: [sku({ quotation_accepted: true, structure: 'PET 12 / LDPE 60', csa_request: { despatch_location: 'Pune', details: { pouch_width_mm: 150, pouch_height_mm: 220 } } })],
      qc_reports: [{ id: 'c1', sku_id: 'S1', substrate1: 'PET', substrate1_val: 12, gsm: 80 }],
    });
    const { saved } = renderApp(<QC />, { modules: { sales, customers, jss: [] }, role: 'qc', user: 'qc1' });
    const panel = await screen.findByLabelText('CSAs awaiting a JSS');
    await userEvent.click(within(panel).getByLabelText('JSS from CSA 200g Pouch'));
    await waitFor(() => expect(screen.getByLabelText('Job Name')).toHaveValue('200g Pouch'));
    expect(screen.getByLabelText('Material')).toHaveValue('PET 12 / LDPE 60');
    expect(screen.getByLabelText('Customer')).toHaveValue('Beta Foods');
    expect(screen.getByLabelText('Group')).toHaveValue('BETA GROUP');
    await userEvent.click(screen.getByRole('button', { name: 'Add Spec' }));
    await waitFor(() => expect(saved.some((s) => s.key === 'jss')).toBe(true));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    expect(lastSales(saved).skus[0].jss_spec).toBe('A1');
    expect(saved.find((s) => s.key === 'jss').data[0]).toMatchObject({ spec: 'A1', customer: 'Beta Foods', jobName: '200g Pouch' });
  });
});

describe('Superstar — PO → SO', () => {
  it('lists the reps\' pending POs and opens Add SO pre-filled, with the PO price beside the rate', async () => {
    const sales = salesModule({
      skus: [sku({ quotation_accepted: true, jss_spec: 'A900' })],
      pos: [{ id: 'p1', po_ref: 'ref1', lead_id: 'L2', customer: 'Beta Foods', despatch_location: 'Pune', sku_id: 'S1', sku_name: '200g Pouch', jss_spec: 'A900', qty: 6000, price: 10, po_number: 'PO-77', date: '2026-09-15', created_by: REP, created_at: '2026-09-15T10:00:00Z' },
        { id: 'p0', lead_id: 'L2', customer: 'Beta Foods', sku_id: 'S1', jss_spec: 'A900', qty: 1, price: 1, po_number: 'OLD', date: '2026-09-01', created_by: REP, pushed_to_oab: { so: '26/1' } }],
    });
    const jss = [{ spec: 'A900', jobName: '200g Pouch', customer: 'Beta Foods', group: 'BETA GROUP', status: 'Active', dispatchForm: 'Pouch', width: 150, height: 220 }];
    const { saved } = renderApp(
      <Routes><Route path="/po-to-so" element={<PoToSo />} /><Route path="/po" element={<NewPO />} /></Routes>,
      { modules: { sales, customers, jss, prices: { A900: { price: 11, costPrice: 8 } }, oab: { OAB: { SF: [], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 400 } } }, role: 'user', route: '/po-to-so' },
    );
    expect(await screen.findByText('PO-77')).toBeInTheDocument();
    expect(screen.queryByText('OLD')).toBeNull();                       // already on the OAB
    await userEvent.click(screen.getByLabelText('Select PO PO-77'));
    await userEvent.click(screen.getByLabelText('Add to OAB'));
    expect(await screen.findByText(/From the sales rep/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('PO-77')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Beta Foods')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));
    await waitFor(() => expect(screen.getByLabelText('Select A900')).toBeChecked());
    expect(screen.getByLabelText('PO qty for A900')).toHaveValue(6000);
    expect(screen.getByLabelText('PO price for A900')).toHaveTextContent('₹10.00');
    expect(screen.getByText('₹11.00')).toBeInTheDocument();             // the Price Master rate beside it
    expect(saved).toBeDefined();
  });
});
