import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import RepPortal from '../pages/RepPortal.jsx';
import SalesAdmin from '../pages/SalesAdmin.jsx';
import LeadsAdmin from '../components/LeadsAdmin.jsx';
import {
  repBook, isConvertedStage, conversionPending, conversionQueue, requestConversion, convertLeads, revertLead,
  customerRowsToAdd, despatchLocationRowsFor, despatchLocationsFor, buildCsaDraft, buildCsaRequest, csaDetailsOf,
  sendSkuForCsa, DESPATCH_FIELDS, saveErrorText, isCustomerLead,
} from '../lib/repFlow.js';
import { csaCandidatesForJss } from '../components/CsaToJssPanel.jsx';
import { leadOwnerIds, repModulesOf, REP_MODULES } from '../lib/sales.js';
import { kamApplyEdits } from '../lib/kam.js';
import { csaPendingForQc } from '../lib/csa.js';

// "Issues as on 30.09.2026" — the SALES LOGIN section (SL1-SL6, SK1-SK4, PE1, PE2).

afterEach(() => { vi.restoreAllMocks(); });

const REP = 'R1';
const USERS = [
  { id: 'R1', username: 'manasa', display_name: 'Manasa', status: 'Active' },
  { id: 'R2', username: 'pradeep', display_name: 'Pradeep', status: 'Active' },
];
const mk = (id, name, over = {}) => ({
  id, client_name: name, categories: ['Juices'], category_assignments: { Juices: REP },
  created_by: REP, assigned_to: REP, ...over,
});
const LEADS = [
  // converted by the Super Admin — a customer
  mk('L1', 'KOVAI AGRO FOODS', {
    converted_to_customer: true, converted_at: '2026-09-29T10:00:00Z', group: 'SWIGGY', delivery_location: 'Tirupur',
    payment_type: 'A', stage: 'Converted', stage_before_conversion: 'Hot',
  }),
  // marked Converted by the rep — waiting for the Super Admin
  mk('L2', 'SAM AGRITECH LIMITED', { stage: 'Converted', conversion_requested: true, conversion_requested_by: REP, conversion_requested_at: '2026-09-30T09:00:00Z' }),
  // a real lead
  mk('L3', 'ZEPTO', { stage: 'Hot', delivery_location: 'Hyderabad' }),
];
const CUSTOMERS = [
  { group: 'SWIGGY', customer: 'KOVAI AGRO FOODS', dispatchLoc: 'DHARAPURAM', warehouseName: 'DHARAPURAM' },
  { group: '', customer: 'KOVAI AGRO FOODS', dispatchLoc: 'DHARAPURAM', warehouseName: 'KOVAI OWN' },
];
const CONTACTS = [
  { id: 'c1', lead_id: 'L1', customer: 'KOVAI AGRO FOODS', name: 'Bala', designation: 'Purchase Manager', phone: '99650', email: 'b@kovai.in', priority: 1, is_primary: true },
  { id: 'c2', lead_id: 'L1', customer: 'KOVAI AGRO FOODS', name: 'Second', priority: 2 },
  { id: 'c3', lead_id: 'L3', customer: 'ZEPTO', name: 'Zed', priority: 1 },
];
const clone = (v) => JSON.parse(JSON.stringify(v));
const salesModule = (over = {}) => ({
  leads: clone(LEADS), contacts: clone(CONTACTS), interactions: [], skus: [], pos: [], quotations: [], qc_reports: [],
  sales_users: clone(USERS), targets: [], substrate_options: [], nego_msgs: [], dropdowns: {}, ...over,
});
const openRep = (sales = salesModule(), customers = CUSTOMERS) => renderApp(<RepPortal />, { modules: { sales, customers }, role: 'sales', repId: REP, user: 'Manasa' });
const tab = async (label) => userEvent.click(await screen.findByText(label));
const lastSaved = (saved, key) => (saved.filter((s) => s.key === key).pop() || {}).data;
const optionTexts = (select) => [...select.options].map((o) => o.textContent);

/** A fetch wrapper that answers every write of module `id` with a 409, as a racing writer would. */
function conflictOn(id) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('/rest/v1/oab_data') && String(opts.method || 'GET').toUpperCase() === 'POST' && JSON.parse(opts.body).id === id) {
      return { status: 409, ok: false, headers: { get: () => 'application/json' }, json: async () => ({ error: 'version conflict' }), text: async () => '{"error":"version conflict"}' };
    }
    return orig(url, opts);
  };
}

/* ═══════════════ SL1 — the edit radio sits on the row's middle line ═══════════════ */
describe('SL1 — the edit radio is level with the name', () => {
  const middle = (radio) => {
    const td = radio.closest('td');
    expect(td.style.verticalAlign).toBe('middle');
    expect(td.style.verticalAlign).not.toBe('top');
    expect(td.className).toContain('rowsel');
    expect(radio.style.margin).toBe('0px');
  };

  it('on My Leads', async () => {
    openRep();
    await tab('📈 My Leads');
    middle(await screen.findByLabelText('Edit ZEPTO'));
  });

  it('on My Contacts and My Customers', async () => {
    openRep();
    await tab('📇 My Contacts');
    middle(await screen.findByLabelText('Edit Bala'));
    await tab('🏆 My Customers');
    middle(await screen.findByLabelText('Edit customer KOVAI AGRO FOODS'));
  });

  it('on the SKU list, where every cell of the row is middle-aligned too', async () => {
    openRep(salesModule({ skus: [{ id: 'S1', lead_id: 'L3', sku_name: '200g Pouch', category: 'Juices', dispatch_form: 'Pouch', created_by: REP }] }));
    await tab('📦 SKUs');
    const radio = await screen.findByLabelText('Edit 200g Pouch');
    middle(radio);
    [...radio.closest('tr').children].forEach((td) => expect(td.style.verticalAlign).not.toBe('top'));
  });

  it('on the Super Admin\'s Leads list', async () => {
    renderApp(<LeadsAdmin />, { modules: { sales: salesModule(), customers: CUSTOMERS }, role: 'superadmin' });
    middle(await screen.findByLabelText('Edit lead ZEPTO'));
  });
});

/* ═══════════════ SL2 — My Customers ═══════════════ */
describe('SL2 — My Customers', () => {
  it('is granted by default and to an allocation stored before it existed, but respects a later choice', () => {
    expect(REP_MODULES.map((m) => m.k)).toContain('mycust');
    expect(REP_MODULES.map((m) => m.k)).not.toContain('add');
    expect(repModulesOf({})).toContain('mycust');
    expect(repModulesOf({ modules: ['customers', 'contacts'] })).toContain('mycust');
    expect(repModulesOf({ modules: ['customers', 'contacts'], modules_rev: 2 })).not.toContain('mycust');
    expect(repModulesOf({ modules: ['customers', 'add'] })).not.toContain('add');   // the dead key is dropped
  });

  it('shows the tab to a rep with no stored allocation, and to one with an older allocation', async () => {
    openRep();
    expect(await screen.findByText('🏆 My Customers')).toBeInTheDocument();
  });

  it('shows the tab to a rep whose allocation predates it', async () => {
    const sales = salesModule({ sales_users: [{ ...USERS[0], modules: ['customers', 'contacts'] }] });
    openRep(sales);
    expect(await screen.findByText('🏆 My Customers')).toBeInTheDocument();
    expect(screen.getByText('📈 My Leads')).toBeInTheDocument();
    expect(screen.queryByText('📦 SKUs')).toBeNull();
  });

  it('lists the converted customers with their contact and the Customer Master\'s despatch locations', async () => {
    openRep();
    await tab('🏆 My Customers');
    const row = (await screen.findByLabelText('Edit customer KOVAI AGRO FOODS')).closest('tr');
    expect(within(row).getByText('Bala · Purchase Manager')).toBeInTheDocument();
    expect(within(row).getByText('99650')).toBeInTheDocument();
    expect(within(row).getByText('DHARAPURAM (DHARAPURAM), DHARAPURAM (KOVAI OWN)')).toBeInTheDocument();
    // the leads stay off this list — the one waiting for the Super Admin is called out
    expect(screen.queryByLabelText('Edit customer ZEPTO')).toBeNull();
    expect(screen.queryByLabelText('Edit customer SAM AGRITECH LIMITED')).toBeNull();
    expect(screen.getByText(/1 lead you marked Converted is waiting for the Super Admin/)).toBeInTheDocument();
  });

  it('loads a customer into the editor by its radio and saves the contact information', async () => {
    const { saved } = openRep();
    await tab('🏆 My Customers');
    await userEvent.click(await screen.findByLabelText('Edit customer KOVAI AGRO FOODS'));
    expect(screen.getByLabelText('My customer')).toHaveValue('L1');
    expect(screen.getByLabelText('Primary contact name')).toHaveValue('Bala');
    expect(screen.getByLabelText('Primary contact designation')).toHaveValue('Purchase Manager');
    expect(screen.getByLabelText('Primary contact phone')).toHaveValue('99650');
    expect(screen.getByLabelText('Customer payment type')).toHaveValue('A');
    // the despatch locations are the Super Admin's, read-only
    const locs = screen.getByLabelText('Customer despatch locations');
    expect(within(locs).getByText('DHARAPURAM (KOVAI OWN)')).toBeInTheDocument();
    expect(locs.querySelector('input, select')).toBeNull();

    const phone = screen.getByLabelText('Primary contact phone');
    await userEvent.clear(phone);
    await userEvent.type(phone, '11111');
    await userEvent.type(screen.getByLabelText('Customer GSTIN'), '33AAKFK6604Q1ZW');
    await userEvent.click(screen.getByRole('button', { name: /Save customer details/ }));
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    const blob = lastSaved(saved, 'sales');
    expect(blob.contacts.find((c) => c.id === 'c1')).toMatchObject({ name: 'Bala', phone: '11111', priority: 1, is_primary: true });
    expect(blob.contacts.find((c) => c.id === 'c2').priority).toBe(2);       // the other contacts are left alone
    expect(blob.contacts.find((c) => c.id === 'c3')).toEqual(CONTACTS[2]);
    expect(blob.leads.find((l) => l.id === 'L1')).toMatchObject({ gstin: '33AAKFK6604Q1ZW', payment_type: 'A', converted_to_customer: true });
    expect(blob.leads.find((l) => l.id === 'L3')).toEqual(LEADS[2]);
  });

  it('creates the primary contact for a customer that has none', async () => {
    const { saved } = openRep(salesModule({ contacts: [] }));
    await tab('🏆 My Customers');
    await userEvent.click(await screen.findByLabelText('Edit customer KOVAI AGRO FOODS'));
    await userEvent.type(screen.getByLabelText('Primary contact name'), 'Ravi');
    await userEvent.selectOptions(screen.getByLabelText('Primary contact designation'), 'CEO');
    await userEvent.click(screen.getByRole('button', { name: /Save customer details/ }));
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    expect(lastSaved(saved, 'sales').contacts).toEqual([expect.objectContaining({
      lead_id: 'L1', customer: 'KOVAI AGRO FOODS', name: 'Ravi', designation: 'CEO', priority: 1, is_primary: true, created_by: REP,
    })]);
  });
});

/* ═══════════════ SL3 — the Lead / Customer radio one level up ═══════════════ */
describe('SL3 — the radios sit above the row, the picker / name / designation on one row', () => {
  it('on Add Contact', async () => {
    openRep();
    await tab('📇 My Contacts');
    const kind = await screen.findByRole('radiogroup', { name: 'Contact Lead or customer' });
    expect(kind.closest('.fg')).toBeNull();
    expect(kind.style.gridColumn).toBe('1 / -1');
    const grid = kind.parentElement;
    expect(grid.className).toBe('g3');
    const row = [...grid.children].slice(1, 4);
    expect(within(row[0]).getByLabelText('Contact Lead')).toBeTruthy();
    expect(within(row[1]).getByLabelText('Contact name')).toBeTruthy();
    expect(within(row[2]).getByLabelText('Contact designation')).toBeTruthy();
    // 14px radios: a label.cb of their own, never inside the 34px-tall .fg input styling
    within(kind).getAllByRole('radio').forEach((r) => {
      expect(r.parentElement.tagName).toBe('LABEL');
      expect(r.parentElement.className).toBe('cb');
    });
  });

  it('on the SKU form, Log Visit and the Quote Accepted manual form', async () => {
    openRep();
    await tab('📦 SKUs');
    let kind = await screen.findByRole('radiogroup', { name: 'SKU Lead or customer' });
    expect(kind.closest('.fg')).toBeNull();
    expect(kind.nextElementSibling.querySelector('[aria-label="SKU Lead"]')).toBeTruthy();
    expect(kind.nextElementSibling.nextElementSibling.querySelector('[aria-label="SKU Name"]')).toBeTruthy();
    await tab('📋 Log Visit');
    kind = await screen.findByRole('radiogroup', { name: 'Visit Lead or customer' });
    expect(kind.closest('.fg')).toBeNull();
    await tab('✅ Quote Accepted');
    kind = await screen.findByRole('radiogroup', { name: 'Manual Lead or customer' });
    expect(kind.closest('.fg')).toBeNull();
    expect(screen.getByLabelText('Manual pick Customer')).toBeChecked();
    expect(optionTexts(screen.getByLabelText('Manual Customer'))).toContain('KOVAI AGRO FOODS (SWIGGY)');
    fireEvent.click(screen.getByLabelText('Manual pick Lead').closest('label').querySelector('span'));
    expect(screen.getByLabelText('Manual Lead')).toBeTruthy();
  });
});

/* ═══════════════ SL4 — Add Contact splits leads from customers ═══════════════ */
describe('SL4 — only real leads under Lead, converted ones under Customer', () => {
  it('counts each side and lists each side\'s own names', async () => {
    openRep();
    await tab('📇 My Contacts');
    const leadSide = screen.getByLabelText('Contact pick Lead').closest('label');
    const custSide = screen.getByLabelText('Contact pick Customer').closest('label');
    expect(leadSide.textContent).toBe('Lead (2)');
    expect(custSide.textContent).toBe('Customer (1)');
    expect(optionTexts(screen.getByLabelText('Contact Lead'))).not.toContain('KOVAI AGRO FOODS (SWIGGY)');
    // a click on the caption picks the Customer side
    fireEvent.click(custSide.querySelector('span'));
    expect(optionTexts(screen.getByLabelText('Contact Customer'))).toEqual(['— Select your customer —', 'KOVAI AGRO FOODS (SWIGGY)']);
  });

  it('moves a lead across once the Super Admin converts it', () => {
    const leads = convertLeads(clone(LEADS), ['L2'], { by: 'super_admin' });
    const book = repBook({ leads }, CUSTOMERS, REP);
    expect(book.customers.map((l) => l.id)).toEqual(['L1', 'L2']);
    expect(book.leads.map((l) => l.id)).toEqual(['L3']);
  });
});

/* ═══════════════ SL5 — a rep's Converted is a request to the Super Admin ═══════════════ */
describe('SL5 — the conversion rule', () => {
  const now = new Date('2026-09-30T10:00:00Z');

  it('tells a pending conversion from a customer and a plain lead', () => {
    expect(isConvertedStage('converted')).toBe(true);
    expect(isConvertedStage('Hot')).toBe(false);
    expect(conversionPending({ stage: 'Converted' })).toBe(true);
    expect(conversionPending({ stage: 'Hot', conversion_requested: true })).toBe(true);
    expect(conversionPending({ stage: 'Converted', converted_to_customer: true })).toBe(false);
    expect(conversionPending({ stage: 'Hot' })).toBe(false);
    expect(conversionQueue(LEADS).map((l) => l.id)).toEqual(['L2']);
  });

  it('records the rep\'s request without converting', () => {
    const input = clone(LEADS);
    const out = requestConversion(input, 'L3', REP, { now });
    expect(out[2]).toMatchObject({
      stage: 'Converted', stage_before_conversion: 'Hot', conversion_requested: true,
      conversion_requested_by: REP, conversion_requested_at: now.toISOString(), stage_updated_by: REP,
    });
    expect(out[2].converted_to_customer).toBeUndefined();
    expect(out[0]).toBe(input[0]);   // untouched rows pass through as they were
    expect(out[1]).toBe(input[1]);
  });

  it('converts exactly the given leads, and reverts cleanly', () => {
    const conv = convertLeads(clone(LEADS), ['L2', 'L3'], { by: 'super_admin', now });
    expect(conv[1]).toMatchObject({ converted_to_customer: true, converted_by: 'super_admin', conversion_requested: false, stage: 'Converted' });
    expect(conv[2]).toMatchObject({ converted_to_customer: true, stage: 'Converted', stage_before_conversion: 'Hot' });
    const back = revertLead(conv, 'L3', { now });
    expect(back[2]).toMatchObject({ converted_to_customer: false, conversion_requested: false, stage: 'Hot' });
    expect(conversionPending(back[2])).toBe(false);   // it does not fall straight back into the queue
    // with nothing to go back to, the stage leaves Converted all the same
    expect(revertLead(conv, 'L2', { now })[1].stage).toBe('To Approach');
  });

  it('adds Customer Master rows only for names the master does not have (case and spacing ignored)', () => {
    const leads = [mk('A', 'Baramati Agro'), mk('B', 'NEW CO', { gstin: '29X', group: 'G1', delivery_location: 'Pune' }), mk('C', 'New  Co')];
    const rows = customerRowsToAdd(leads, ['A', 'B', 'C'], [{ customer: 'BARAMATI  AGRO' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customer: 'NEW CO', gstin: '29X', group: 'G1', dispatchLoc: 'Pune' });
  });

  it('a rep\'s Converted sends it to the Super Admin and shows it waiting', async () => {
    const { saved } = openRep();
    await tab('📈 My Leads');
    await userEvent.selectOptions(await screen.findByLabelText('Stage for ZEPTO'), 'Converted');
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    expect(lastSaved(saved, 'sales').leads.find((l) => l.id === 'L3')).toMatchObject({ stage: 'Converted', conversion_requested: true, conversion_requested_by: REP });
    expect(await screen.findByText(/sent to the Super Admin to convert/)).toBeInTheDocument();
    const row = screen.getByLabelText('Edit ZEPTO').closest('tr');
    expect(within(row).getByText('⏳ With Super Admin')).toBeInTheDocument();
  });

  it('another stage withdraws a request still waiting', async () => {
    const { saved } = openRep();
    await tab('📈 My Leads');
    await userEvent.selectOptions(await screen.findByLabelText('Stage for SAM AGRITECH LIMITED'), 'Warm');
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    expect(lastSaved(saved, 'sales').leads.find((l) => l.id === 'L2')).toMatchObject({ stage: 'Warm', conversion_requested: false });
  });

  it('a new lead entered as Converted is a request too', async () => {
    const { saved } = openRep();
    await tab('📈 My Leads');
    await userEvent.type(screen.getByLabelText('Lead name'), 'Farm To Table');
    await userEvent.click(screen.getByLabelText('Dairy'));
    await userEvent.selectOptions(screen.getByLabelText('Initial Status'), 'Converted');
    await userEvent.click(screen.getByText(/Save New Lead/));
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    const lead = lastSaved(saved, 'sales').leads.find((l) => l.client_name === 'Farm To Table');
    expect(lead).toMatchObject({ stage: 'Converted', conversion_requested: true, conversion_requested_by: REP });
    expect(lead.converted_to_customer).not.toBe(true);
  });
});

/* ═══════════════ SL5 / SL6 — the S Dashboard converts ═══════════════ */
describe('SL5 / SL6 — the S Dashboard Leads tab', () => {
  const SA_LEADS = [
    ...clone(LEADS),
    // marked Converted on the Status dropdown by the Super Admin, never converted (image14), no categories
    { id: 'L4', client_name: 'ARIANT VEG PVT LTD', stage: 'Converted', stage_updated_by: 'super_admin', assigned_to: REP, created_by: REP },
    // already in the Customer Master under a different spelling
    mk('L5', 'Baramati Agro', { stage: 'Converted', stage_updated_by: REP }),
  ];
  const SA_CUSTOMERS = [...CUSTOMERS, { group: '', customer: 'BARAMATI  AGRO', dispatchLoc: 'Baramati' }];
  const openSa = async () => {
    const r = renderApp(<SalesAdmin />, { modules: { sales: salesModule({ leads: clone(SA_LEADS) }), customers: SA_CUSTOMERS }, role: 'sadmin' });
    await waitFor(() => expect(screen.getByText(/S Dashboard/)).toBeInTheDocument());
    await userEvent.click([...document.querySelectorAll('.step-tab')].find((el) => /Leads/.test(el.textContent)));
    return r;
  };

  it('lists every lead marked Converted that is waiting, with who marked it', async () => {
    await openSa();
    const queue = await screen.findByRole('region', { name: 'Leads waiting for conversion' });
    expect(within(queue).getByText(/3 leads marked Converted are waiting for you to convert them/)).toBeInTheDocument();
    const sam = within(queue).getByText('SAM AGRITECH LIMITED').closest('tr');
    expect(within(sam).getAllByText('Manasa').length).toBeGreaterThan(0);
    const ariant = within(queue).getByText('ARIANT VEG PVT LTD').closest('tr');
    expect(within(ariant).getByText('you (Status)')).toBeInTheDocument();
    expect(within(queue).queryByText('KOVAI AGRO FOODS')).toBeNull();   // already a customer
    expect(within(queue).queryByText('ZEPTO')).toBeNull();              // a plain lead
  });

  it('owns a lead with no categories by its lead-level rep, not "Unassigned"', async () => {
    expect(leadOwnerIds({ assigned_to: 'R1' })).toEqual(['R1']);
    expect(leadOwnerIds({ categories: ['A', 'B'], category_assignments: { A: 'R1', B: 'R2' }, assigned_to: 'R9' })).toEqual(['R1', 'R2']);
    expect(leadOwnerIds({ categories: ['A'], assigned_to: 'R2' })).toEqual(['R2']);
    expect(leadOwnerIds({})).toEqual([]);
    await openSa();
    const table = (await screen.findByLabelText('Status for ARIANT VEG PVT LTD')).closest('tr');
    expect(within(table).getByText('Manasa')).toBeInTheDocument();
    expect(within(table).queryByText('Unassigned')).toBeNull();
    // and the rep filter finds it under her name
    await userEvent.selectOptions(screen.getByLabelText('Filter all by rep'), 'R1');
    expect(screen.getByLabelText('Status for ARIANT VEG PVT LTD')).toBeInTheDocument();
  });

  it('Convert all converts exactly the queue, adding master rows only for names the master lacks', async () => {
    const { saved } = await openSa();
    await userEvent.click(await screen.findByLabelText('Convert all leads marked Converted'));
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    const custs = lastSaved(saved, 'customers').map((c) => c.customer);
    expect(custs).toEqual(['KOVAI AGRO FOODS', 'KOVAI AGRO FOODS', 'BARAMATI  AGRO', 'SAM AGRITECH LIMITED', 'ARIANT VEG PVT LTD']);
    const leads = lastSaved(saved, 'sales').leads;
    ['L2', 'L4', 'L5'].forEach((id) => expect(leads.find((l) => l.id === id)).toMatchObject({ converted_to_customer: true, converted_by: 'super_admin', conversion_requested: false }));
    expect(leads.find((l) => l.id === 'L3').converted_to_customer).toBeUndefined();
    // the rep's book now has them on the customer side
    const book = repBook({ leads }, [], REP);
    expect(book.customers.map((l) => l.id).sort()).toEqual(['L1', 'L2', 'L4', 'L5']);
    expect(book.leads.map((l) => l.id)).toEqual(['L3']);
  });

  it('the Super Admin\'s own Status Converted IS the conversion', async () => {
    const { saved } = await openSa();
    await userEvent.selectOptions(await screen.findByLabelText('Status for ZEPTO'), 'Converted');
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    expect(lastSaved(saved, 'sales').leads.find((l) => l.id === 'L3')).toMatchObject({ converted_to_customer: true, stage: 'Converted', converted_by: 'super_admin' });
    expect(lastSaved(saved, 'customers').map((c) => c.customer)).toContain('ZEPTO');
  });

  it('a Converted status the Super Admin cancels changes nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { saved } = await openSa();
    await userEvent.selectOptions(await screen.findByLabelText('Status for ZEPTO'), 'Converted');
    await new Promise((r) => setTimeout(r, 30));
    expect(saved.some((s) => s.key === 'sales' || s.key === 'customers')).toBe(false);
  });

  it('↩ Lead removes the master rows, clears the conversion and takes the stage off Converted', async () => {
    const { saved } = await openSa();
    await userEvent.click(await screen.findByLabelText('Revert KOVAI AGRO FOODS to lead'));
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    expect(lastSaved(saved, 'customers').map((c) => c.customer)).toEqual(['BARAMATI  AGRO']);
    expect(lastSaved(saved, 'sales').leads.find((l) => l.id === 'L1')).toMatchObject({ converted_to_customer: false, stage: 'Hot' });
  });

  it('says so when the save lost the race, instead of doing nothing', async () => {
    await openSa();
    conflictOn(12);
    await userEvent.click(await screen.findByLabelText('Convert SAM AGRITECH LIMITED from the queue'));
    expect(await screen.findByText(/changed by someone else and has been reloaded/)).toBeInTheDocument();
    expect(saveErrorText({ code: 'conflict' })).toMatch(/click again/);
  });
});

/* ═══════════════ SL6 — the rep sees the conversion without signing in again ═══════════════ */
describe('SL6 — the rep login reads the conversion live', () => {
  it('re-reads the sales blob on a tab change', async () => {
    const { mods } = openRep();
    await tab('🏆 My Customers');
    await screen.findByLabelText('Edit customer KOVAI AGRO FOODS');
    expect(screen.queryByLabelText('Edit customer SAM AGRITECH LIMITED')).toBeNull();
    // the Super Admin converts SAM AGRITECH while the rep is signed in
    mods.sales.leads = convertLeads(mods.sales.leads, ['L2']);
    await tab('📈 My Leads');
    await tab('🏆 My Customers');
    expect(await screen.findByLabelText('Edit customer SAM AGRITECH LIMITED')).toBeInTheDocument();
  });

  it('re-reads it when the window comes back into focus', async () => {
    const { mods } = openRep();
    await tab('🏆 My Customers');
    await screen.findByLabelText('Edit customer KOVAI AGRO FOODS');
    mods.sales.leads = convertLeads(mods.sales.leads, ['L2']);
    fireEvent.focus(window);
    expect(await screen.findByLabelText('Edit customer SAM AGRITECH LIMITED')).toBeInTheDocument();
  });

  it('never lets a re-read put back the blob from before a save that crossed it', async () => {
    const { saved } = openRep();
    await tab('📈 My Leads');
    await screen.findByLabelText('Stage for ZEPTO');
    // writes take a while, reads are instant — the race a quick tab change could lose
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).includes('/rest/v1/oab_data') && String(opts.method || 'GET').toUpperCase() === 'POST') await new Promise((r) => setTimeout(r, 60));
      return orig(url, opts);
    };
    fireEvent.change(screen.getByLabelText('Stage for ZEPTO'), { target: { value: 'Warm' } });
    fireEvent.click(screen.getByText('🏆 My Customers'));      // a re-read while the save is on the wire
    fireEvent.click(screen.getByText('📈 My Leads'));
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 120));
    expect(await screen.findByLabelText('Stage for ZEPTO')).toHaveValue('Warm');
  });

  it('files a KAM account on the customer side', () => {
    const leads = [
      { id: 'K1', client_name: 'Gamma', kam: REP, categories: [], category_assignments: {} },
      { id: 'K2', client_name: 'Delta', kam: REP, converted_to_customer: false, categories: [], category_assignments: {} },
    ];
    const book = repBook({ leads }, [], REP);
    expect(book.customers.map((l) => l.id)).toEqual(['K1']);
    expect(book.leads.map((l) => l.id)).toEqual(['K2']);
    // a signed-out / unknown rep is nobody's KAM
    expect(repBook({ leads }, [], '').customers).toEqual([]);
    // the KAM screen's new lead record comes off the Customer Master, so it is a customer
    const created = kamApplyEdits([], { 'NEW CO': { kam: REP } }, { uid: () => 'L9' })[0];
    expect(created).toMatchObject({ id: 'L9', converted_to_customer: true, converted_by: 'kam' });
  });
});

/* ═══════════════ SK1-SK4 — the SKU form carries the despatch details ═══════════════ */
describe('SK1-SK4 — despatch details on Add / Edit SKU', () => {
  const pickParty = async (kind, id) => {
    await userEvent.click(screen.getByLabelText(`SKU pick ${kind}`));
    await userEvent.selectOptions(screen.getByLabelText(`SKU ${kind}`), id);
  };
  const fillSku = async (name, form) => {
    await userEvent.type(screen.getByLabelText('SKU Name'), name);
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Dairy');
    await userEvent.selectOptions(screen.getByLabelText('Despatch Form'), form);
  };
  const details = () => screen.getByLabelText('Despatch details');
  const labelsShown = () => [...within(screen.getByLabelText('Despatch form details')).getAllByText((_, el) => el.tagName === 'LABEL' && el.parentElement.className === 'fg')].map((l) => l.textContent);

  it('shows the four despatch fields on Add SKU straight away — no radio, no sample answer', async () => {
    openRep();
    await tab('📦 SKUs');
    const d = details();
    ['Despatch location', 'Tentative order quantity', 'Tentative despatch date', 'Target price'].forEach((l) => expect(within(d).getByLabelText(l)).toBeInTheDocument());
    expect(screen.getByLabelText('Sample received No')).toBeChecked();
    expect(within(d).getByText(/quote desk only/)).toBeInTheDocument();
  });

  it('offers each despatch form exactly the doc\'s fields', async () => {
    openRep();
    await tab('📦 SKUs');
    await pickParty('Lead', 'L3');
    await fillSku('X', 'Roll');
    expect(labelsShown()).toEqual(['Per reel (Kgs)', 'Core width (mm)', 'Reading direction', 'Packing instructions']);
    expect(optionTexts(within(details()).getByLabelText('Reading direction'))).toEqual(['-- Select --', 'Readable', 'Unreadable']);
    expect(within(details()).getByLabelText('Core width (mm)')).toHaveAttribute('type', 'number');

    await userEvent.selectOptions(screen.getByLabelText('Despatch Form'), 'Pouch');
    expect(labelsShown()).toEqual(['Pouch width end to end (mm)', 'Pouch height end to end (mm)', 'Packing instructions', 'Other specifications']);

    await userEvent.selectOptions(screen.getByLabelText('Despatch Form'), 'Label');
    expect(labelsShown()).toEqual(['Labels in a bunch', 'Labels per box', 'Packing instructions']);

    await userEvent.selectOptions(screen.getByLabelText('Despatch Form'), 'Shrink Sleeve');
    await userEvent.click(within(details()).getByLabelText('Sleeve form'));
    expect(labelsShown()).toEqual(['Form', 'Height of the sleeve (mm)', 'Width of the sleeve (mm)', 'Open width (mm)']);
    await userEvent.click(within(details()).getByLabelText('Roll form'));
    expect(labelsShown()).toEqual(['Form', 'Core dimension (mm)', 'Per core', 'Metres / Kgs per core']);
    // §SK2: metres per core OR kgs per core — a choice and a number
    await userEvent.click(within(details()).getByLabelText('Kgs per core'));
    expect(within(details()).getByLabelText('Metres / Kgs per core')).toHaveAttribute('type', 'number');
    expect(labelsShown()).toContain('Kgs per core');
  });

  it('works the bulk-bag totals live, side and bottom gusset', async () => {
    openRep();
    await tab('📦 SKUs');
    await pickParty('Lead', 'L3');
    await fillSku('Bag', 'Bulk Bags');
    const d = details();
    await userEvent.click(within(d).getByLabelText('Side gusset'));
    await userEvent.type(within(d).getByLabelText('Pouch width (mm)'), '300');
    await userEvent.type(within(d).getByLabelText('Gusset (mm)'), '50');
    await userEvent.type(within(d).getByLabelText('Height of the pouch without gusset (mm)'), '500');
    let totals = within(d).getByLabelText('Bulk bag totals');
    expect(totals.textContent).toMatch(/Total gusset 200 mm · total pouch height 500 mm · pouch width 500 mm/);
    await userEvent.click(within(d).getByLabelText('Bottom gusset'));
    totals = within(d).getByLabelText('Bulk bag totals');
    expect(totals.textContent).toMatch(/Total gusset 100 mm · total pouch height 600 mm · pouch width 300 mm/);
  });

  it('a change of despatch form drops the old form\'s measurements', async () => {
    openRep();
    await tab('📦 SKUs');
    await pickParty('Lead', 'L3');
    await fillSku('X', 'Pouch');
    await userEvent.type(within(details()).getByLabelText('Pouch width end to end (mm)'), '150');
    await userEvent.type(within(details()).getByLabelText('Tentative order quantity'), '900');
    await userEvent.selectOptions(screen.getByLabelText('Despatch Form'), 'Roll');
    await userEvent.selectOptions(screen.getByLabelText('Despatch Form'), 'Pouch');
    expect(within(details()).getByLabelText('Pouch width end to end (mm)')).toHaveValue(null);
    expect(within(details()).getByLabelText('Tentative order quantity')).toHaveValue(900);   // the common fields stay
  });

  it('persists the despatch details on Add, and the edit radio brings them back', async () => {
    const { saved } = openRep();
    await tab('📦 SKUs');
    await pickParty('Customer', 'L1');
    await fillSku('1kg Pouch', 'Pouch');
    const d = details();
    await userEvent.selectOptions(within(d).getByLabelText('Despatch location'), 'DHARAPURAM (KOVAI OWN)');
    await userEvent.type(within(d).getByLabelText('Tentative order quantity'), '50000');
    fireEvent.change(within(d).getByLabelText('Tentative despatch date'), { target: { value: '2026-10-15' } });
    await userEvent.type(within(d).getByLabelText('Target price'), '3.25');
    await userEvent.type(within(d).getByLabelText('Pouch width end to end (mm)'), '150');
    await userEvent.type(within(d).getByLabelText('Packing instructions'), '50 per carton');
    await userEvent.click(screen.getByText('✓ Add SKU'));
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    const sku = lastSaved(saved, 'sales').skus[0];
    expect(sku.csa_draft).toMatchObject({
      despatch_location: 'DHARAPURAM', warehouse_name: 'KOVAI OWN', tentative_qty: 50000, tentative_date: '2026-10-15',
      target_price: 3.25, despatch_form: 'Pouch', kind: 'pouch', details: { pouch_width_mm: 150, packing_instructions: '50 per carton' },
    });
    expect(sku.target_price).toBe(3.25);   // where the quote desk reads it
    expect(sku.csa_requested).toBeFalsy();

    // the form is clear again; the radio loads everything back
    expect(within(details()).getByLabelText('Tentative order quantity')).toHaveValue(null);
    await userEvent.click(await screen.findByLabelText('Edit 1kg Pouch'));
    const e = details();
    expect(within(e).getByLabelText('Despatch location')).toHaveValue('DHARAPURAM||KOVAI OWN');
    expect(within(e).getByLabelText('Tentative order quantity')).toHaveValue(50000);
    expect(within(e).getByLabelText('Target price')).toHaveValue(3.25);
    expect(within(e).getByLabelText('Pouch width end to end (mm)')).toHaveValue(150);
    expect(screen.getByLabelText('CSA status')).toHaveTextContent(/Not sent for CSA yet/);

    // an edit keeps them too
    const width = within(e).getByLabelText('Pouch width end to end (mm)');
    await userEvent.clear(width);
    await userEvent.type(width, '160');
    await userEvent.click(screen.getByText('✓ Save SKU'));
    await waitFor(() => expect(lastSaved(saved, 'sales').skus[0].csa_draft.details.pouch_width_mm).toBe(160));
    expect(lastSaved(saved, 'sales').skus[0]).toMatchObject({ sku_name: '1kg Pouch', lead_id: 'L1', dispatch_form: 'Pouch' });
    expect(lastSaved(saved, 'sales').skus).toHaveLength(1);
  });

  it('sends a NEW SKU for CSA in one click, onto QC\'s pending list', async () => {
    const { saved } = openRep();
    await tab('📦 SKUs');
    await pickParty('Customer', 'L1');
    await fillSku('Tray Lid', 'Label');
    const d = details();
    await userEvent.selectOptions(within(d).getByLabelText('Despatch location'), 'DHARAPURAM (DHARAPURAM)');
    await userEvent.type(within(d).getByLabelText('Tentative order quantity'), '20000');
    fireEvent.change(within(d).getByLabelText('Tentative despatch date'), { target: { value: '2026-11-01' } });
    await userEvent.type(within(d).getByLabelText('Target price'), '1.5');
    await userEvent.type(within(d).getByLabelText('Labels per box'), '500');
    await userEvent.click(screen.getByText('🧪 Send for CSA to QC'));
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    const blob = lastSaved(saved, 'sales');
    expect(blob.skus).toHaveLength(1);
    expect(blob.skus[0]).toMatchObject({ sku_name: 'Tray Lid', lead_id: 'L1', csa_requested: true, sample_received: 'No' });
    expect(blob.skus[0].csa_request).toMatchObject({
      despatch_location: 'DHARAPURAM', warehouse_name: 'DHARAPURAM', tentative_qty: 20000, target_price: 1.5,
      kind: 'labels', details: { labels_per_box: 500 }, sample_received: 'No',
    });
    expect(csaPendingForQc(blob).map((s) => s.sku_name)).toEqual(['Tray Lid']);
    expect(await screen.findByText(/sent to QC for the CSA report/)).toBeInTheDocument();
  });

  it('names what is missing and writes nothing', async () => {
    const { saved } = openRep();
    await tab('📦 SKUs');
    await pickParty('Lead', 'L3');
    await fillSku('X', 'Pouch');
    await userEvent.click(screen.getByText('🧪 Send for CSA to QC'));
    expect(await screen.findByText('Pick the despatch location.')).toBeInTheDocument();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
  });

  it('shows the workflow stages read-only — prices live on the Quotations tab', async () => {
    openRep(salesModule({ skus: [{ id: 'S1', lead_id: 'L1', sku_name: 'Old SKU', category: 'Dairy', dispatch_form: 'Pouch', created_by: REP, quotation_received: true, quotation_accepted: false }] }));
    await tab('📦 SKUs');
    const stages = await screen.findByLabelText('Workflow stages of Old SKU');
    expect(within(stages).getByText('Quotation received *')).toBeInTheDocument();
    expect(within(stages).queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Price tiers/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Save changes/ })).toBeNull();
  });

  it('keeps the requisition helpers backward compatible', () => {
    const now = new Date('2026-09-30T10:00:00Z');
    const draft = buildCsaDraft({ despatch_location: 'Pune', warehouse_name: 'W1', tentative_qty: '10', target_price: '', sleeve_form: 'Roll form', core_mm: '76', per_core_basis: 'Metres per core', per_core_qty: '500', sleeve_height_mm: '9' }, 'Shrink Sleeve', { now });
    expect(draft).toMatchObject({ despatch_location: 'Pune', warehouse_name: 'W1', tentative_qty: 10, target_price: '', kind: 'shrink', saved_at: now.toISOString() });
    expect(draft.details).toEqual({ sleeve_form: 'Roll form', core_mm: 76, per_core_basis: 'Metres per core', per_core_qty: 500 });
    expect(DESPATCH_FIELDS.shrink.some((f) => f.k === 'per_core')).toBe(false);
    // the newer of the draft and what went to QC is what the form reloads
    expect(csaDetailsOf({ csa_draft: { saved_at: '2026-09-30', tentative_qty: 2 }, csa_request: { sent_at: '2026-09-29', tentative_qty: 1 } }).tentative_qty).toBe(2);
    expect(csaDetailsOf({ csa_draft: { saved_at: '2026-09-28', tentative_qty: 2 }, csa_request: { sent_at: '2026-09-29', tentative_qty: 1 } }).tentative_qty).toBe(1);
    expect(csaDetailsOf({})).toBeNull();
    // a requisition carries the warehouse; with a sample in hand the old flags are still set
    const req = buildCsaRequest({ despatch_location: 'Pune', warehouse_name: 'W1', tentative_qty: 5, tentative_date: '2026-10-01', target_price: 2 }, { id: 'S1', dispatch_form: 'Pouch' }, { now });
    expect(req.warehouse_name).toBe('W1');
    expect(sendSkuForCsa([{ id: 'S1' }], 'S1', req)[0]).toMatchObject({ sample_received: 'Yes', sample_sent: 'Yes', csa_requested: true });
  });
});

/* ═══════════════ PE1 — a customer's despatch locations are the Customer Master's ═══════════════ */
describe('PE1 — Kova Agro offers only its Customer Master rows', () => {
  const kova = { id: 'L1', client_name: 'KOVAI AGRO FOODS', delivery_location: 'Tirupur' };

  it('drops the lead\'s own city and the city list when the master has the customer', () => {
    expect(despatchLocationRowsFor(kova, CUSTOMERS).map((r) => r.label)).toEqual(['DHARAPURAM (DHARAPURAM)', 'DHARAPURAM (KOVAI OWN)']);
    expect(despatchLocationRowsFor(kova, CUSTOMERS, ['Chennai', 'Tirupur']).map((r) => r.label)).toEqual(['DHARAPURAM (DHARAPURAM)', 'DHARAPURAM (KOVAI OWN)']);
    expect(despatchLocationsFor(kova, CUSTOMERS)).toEqual(['DHARAPURAM', 'DHARAPURAM']);
  });

  it('matches the master whatever the case and spacing of the name', () => {
    expect(despatchLocationRowsFor({ ...kova, client_name: ' kovai  agro foods ' }, CUSTOMERS)).toHaveLength(2);
  });

  it('still falls back to the lead\'s city and the Super Admin\'s list for a lead not in the master', () => {
    expect(despatchLocationRowsFor({ client_name: 'ZEPTO', delivery_location: 'Hyderabad' }, CUSTOMERS, ['Chennai']).map((r) => r.label)).toEqual(['Hyderabad', 'Chennai']);
  });

  it('on the SKU form', async () => {
    openRep();
    await tab('📦 SKUs');
    await pickCustomer();
    expect(optionTexts(within(screen.getByLabelText('Despatch details')).getByLabelText('Despatch location')))
      .toEqual(['-- Select --', 'DHARAPURAM (DHARAPURAM)', 'DHARAPURAM (KOVAI OWN)']);
    expect(screen.getByText(/From the Super Admin.s Customer Master/)).toBeInTheDocument();
  });

  async function pickCustomer() {
    await userEvent.click(screen.getByLabelText('SKU pick Customer'));
    await userEvent.selectOptions(screen.getByLabelText('SKU Customer'), 'L1');
  }
});

/* ═══════════════ PE2 — "Despatch" in the sales logins ═══════════════ */
describe('PE2 — the sales logins spell it Despatch', () => {
  it('on the rep portal\'s SKUs, My Leads, My Customers and My Contacts tabs', async () => {
    openRep(salesModule({ skus: [{ id: 'S1', lead_id: 'L1', sku_name: 'Old SKU', category: 'Dairy', dispatch_form: 'Pouch', created_by: REP }] }));
    await tab('📦 SKUs');
    await screen.findByLabelText('Despatch Form');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Dairy');
    expect(document.body.textContent).not.toMatch(/dispatch/i);
    expect(screen.getByText('Category / Despatch')).toBeInTheDocument();
    await tab('📈 My Leads');
    await userEvent.click(screen.getByLabelText('Dairy'));          // opens the per-category forms list
    expect(screen.getByText(/Despatch forms for each category/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/dispatch/i);
    await tab('🏆 My Customers');
    expect(document.body.textContent).not.toMatch(/dispatch/i);
    await tab('📇 My Contacts');
    expect(document.body.textContent).not.toMatch(/dispatch/i);
  });

  it('on the S Dashboard\'s Targets and Leads tabs', async () => {
    renderApp(<SalesAdmin />, { modules: { sales: salesModule(), customers: CUSTOMERS }, role: 'sadmin' });
    await waitFor(() => expect(screen.getByText(/S Dashboard/)).toBeInTheDocument());
    const go = (re) => userEvent.click([...document.querySelectorAll('.step-tab')].find((el) => re.test(el.textContent)));
    await go(/Targets/);
    await userEvent.click(await screen.findByRole('button', { name: /Manasa/ }));
    expect(screen.getByLabelText('New Despatch-Form Targets')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/dispatch/i);
    await go(/Leads/);
    expect(document.body.textContent).not.toMatch(/dispatch/i);
  });
});

/* ═══════════════ the rep's quotation viewer opens above the role bar ═══════════════ */
describe('the quote viewer on Follow-ups', () => {
  it('sits above the sticky role bar', async () => {
    openRep(salesModule({
      skus: [{ id: 'S1', lead_id: 'L1', sku_name: 'Accepted SKU', created_by: REP, quotation_accepted: true, quotation_accepted_at: '2026-09-20T00:00:00Z' }],
      quotations: [{ id: 'q1', lead_id: 'L1', client_name: 'KOVAI AGRO FOODS', version: 1, status: 'sent', items: [{ sku_id: 'S1', sku_name: 'Accepted SKU', tiers: [{ qty: 1000, price_wo_gst: 2 }] }] }],
    }));
    await userEvent.click(await screen.findByLabelText('View quote for Accepted SKU'));
    const close = await screen.findByRole('button', { name: 'Close' });
    let el = close;
    while (el && !(el.style && el.style.position === 'fixed')) el = el.parentElement;
    expect(Number(el.style.zIndex)).toBeGreaterThanOrEqual(1000);
  });
});

/* ═══════════════ integration review — one rule for every screen ═══════════════ */
describe('R1 — a KAM account is a customer on every screen, not only in the rep\'s book', () => {
  it('isCustomerLead: converted, or a KAM account the Super Admin has not moved back', () => {
    expect(isCustomerLead({ converted_to_customer: true })).toBe(true);
    expect(isCustomerLead({ kam: REP })).toBe(true);                                   // no flag: the KAM screen made it
    expect(isCustomerLead({ kam: REP, converted_to_customer: false })).toBe(false);    // ↩ Lead is a decision
    expect(isCustomerLead({ kam: '  ' })).toBe(false);
    expect(isCustomerLead({ stage: 'Converted' })).toBe(false);
    expect(isCustomerLead(null)).toBe(false);
  });

  it('a lead the rep both owns and is KAM of sits on the customer side', () => {
    const leads = [mk('K1', 'Gamma', { kam: REP }), mk('K2', 'Delta', { kam: 'R2' })];
    const book = repBook({ leads }, [], REP);
    expect(book.customers.map((l) => l.id)).toEqual(['K1', 'K2']);   // K2: another rep's KAM account is a customer too
    expect(book.leads).toEqual([]);
  });

  it('the KAM account is never queued for conversion, and QC can make its JSS', () => {
    const lead = mk('K1', 'Gamma', { kam: REP, stage: 'Converted' });
    expect(conversionPending(lead)).toBe(false);
    expect(conversionQueue([lead])).toEqual([]);
    const sales = { leads: [lead], skus: [{ id: 'S1', lead_id: 'K1', sku_name: 'Pouch', quotation_accepted: true }], qc_reports: [] };
    expect(csaCandidatesForJss(sales, []).map((c) => c.sku.id)).toEqual(['S1']);
  });

  it('the KAM screen flags a lead it matched by name, as well as one it creates', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const out = kamApplyEdits([mk('L9', 'Acme')], { Acme: { kam: 'R2', monthly_target: '5000' } }, { now });
    expect(out[0]).toMatchObject({ kam: 'R2', monthly_target: '5000', converted_to_customer: true, converted_by: 'kam', converted_at: now.toISOString() });
    expect(out[0].category_assignments).toEqual({ Juices: REP });
    // a lead the Super Admin converted keeps its own conversion record
    const kept = kamApplyEdits([mk('L1', 'Acme', { converted_to_customer: true, converted_by: 'super_admin', converted_at: 'x' })], { Acme: { kam: 'R2' } }, { now })[0];
    expect(kept).toMatchObject({ converted_by: 'super_admin', converted_at: 'x' });
  });

  it('the Super Admin\'s Leads tab shows the KAM account as a customer', async () => {
    renderApp(<LeadsAdmin />, { modules: { sales: salesModule({ leads: [mk('K1', 'GAMMA FOODS', { kam: REP })] }), customers: CUSTOMERS }, role: 'superadmin' });
    const row = (await screen.findByText('GAMMA FOODS')).closest('tr');
    expect(within(row).getByText('✓ Customer')).toBeInTheDocument();
  });
});

describe('R2 — a deliberate ↩ Lead is not a conversion request', () => {
  it('stage Converted with an explicit false stays out of the queue unless the rep asks again', () => {
    const reverted = { id: 'X', stage: 'Converted', converted_to_customer: false };
    expect(conversionPending(reverted)).toBe(false);
    expect(conversionQueue([reverted])).toEqual([]);
    expect(conversionPending({ ...reverted, conversion_requested: true })).toBe(true);
    expect(conversionPending({ id: 'Y', stage: 'Converted' })).toBe(true);           // never decided: still queued
  });
});

describe('R3 — LeadsAdmin keeps the bulk convert for leads already in the Customer Master', () => {
  const leads = () => [
    mk('M1', 'KOVAI AGRO FOODS', { stage: 'Hot' }),                                    // in the master, never converted
    mk('M2', 'Baramati Agro', { stage: 'Warm', converted_to_customer: false }),        // in the master, moved back on purpose
    mk('M3', 'SAM AGRITECH LIMITED', { stage: 'Converted', conversion_requested: true }), // in the queue
    mk('M4', 'ZEPTO', { stage: 'Hot' }),                                               // a plain lead
  ];
  const custs = [...CUSTOMERS, { group: '', customer: 'BARAMATI AGRO', dispatchLoc: 'Baramati' }];

  it('converts exactly the in-master unflagged leads, beside the queue', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { saved } = renderApp(<LeadsAdmin />, { modules: { sales: salesModule({ leads: leads() }), customers: custs }, role: 'superadmin' });
    const btn = await screen.findByLabelText('Convert the leads already in the Customer Master');
    expect(btn).toHaveTextContent('Convert the 1 already in the Customer Master');
    // the queue keeps its own button
    expect(screen.getByLabelText('Convert all leads marked Converted')).toBeInTheDocument();
    // the per-row labels the 29.09 tests use are still there
    expect(screen.getByLabelText('Convert ZEPTO to customer')).toBeInTheDocument();
    await userEvent.click(btn);
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    const out = lastSaved(saved, 'sales').leads;
    expect(out.find((l) => l.id === 'M1')).toMatchObject({ converted_to_customer: true, converted_by: 'super_admin' });
    expect(out.find((l) => l.id === 'M2').converted_to_customer).toBe(false);
    expect(out.find((l) => l.id === 'M3').converted_to_customer).toBeUndefined();
    expect(out.find((l) => l.id === 'M4').converted_to_customer).toBeUndefined();
    expect(saved.some((s) => s.key === 'customers')).toBe(false);                     // already in the master
  });

  it('is not offered when nothing in the master is outstanding', async () => {
    renderApp(<LeadsAdmin />, { modules: { sales: salesModule({ leads: [mk('M4', 'ZEPTO')] }), customers: CUSTOMERS }, role: 'superadmin' });
    await screen.findByLabelText('Convert ZEPTO to customer');
    expect(screen.queryByLabelText('Convert the leads already in the Customer Master')).toBeNull();
  });
});

describe('R4 — a SKU whose category left the list still edits', () => {
  it('shows the saved category as an option, selected', async () => {
    const { saved } = openRep(salesModule({ skus: [{ id: 'S1', lead_id: 'L3', sku_name: 'Old Pouch', category: 'Retired Cat', dispatch_form: 'Pouch', created_by: REP }] }));
    await tab('📦 SKUs');
    await userEvent.click(await screen.findByLabelText('Edit Old Pouch'));
    const cat = screen.getByLabelText('Category');
    expect(cat).toHaveValue('Retired Cat');
    expect(optionTexts(cat)).toContain('Retired Cat (no longer in the list)');
    await userEvent.click(screen.getByText('✓ Save SKU'));
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    expect(lastSaved(saved, 'sales').skus[0]).toMatchObject({ category: 'Retired Cat', sku_name: 'Old Pouch' });
  });
});

describe('R5 — a pre-30.09 shrink roll-form per-core text survives an edit', () => {
  const legacy = { sleeve_form: 'Roll form', core_mm: '76', per_core: '500 m per core', despatch_location: 'Pune', tentative_qty: '1000', tentative_date: '2026-11-01', target_price: '2' };
  const sku = { id: 'S1', lead_id: 'L1', sku_name: 'Sleeve', dispatch_form: 'Shrink Sleeve' };
  const details = () => screen.getByLabelText('Despatch details');

  it('rides along in the draft and the requisition while the number is empty', () => {
    expect(buildCsaDraft(legacy, 'Shrink Sleeve').details).toMatchObject({ sleeve_form: 'Roll form', core_mm: 76, per_core: '500 m per core' });
    expect(buildCsaRequest(legacy, sku).details).toMatchObject({ per_core: '500 m per core' });
    // re-entered as a basis and a number: the new fields win, the text goes
    const typed = buildCsaDraft({ ...legacy, per_core_basis: 'Metres per core', per_core_qty: '500' }, 'Shrink Sleeve').details;
    expect(typed).toMatchObject({ per_core_basis: 'Metres per core', per_core_qty: 500 });
    expect(typed.per_core).toBeUndefined();
    // a sleeve-form SKU has no per-core figure at all
    expect(buildCsaDraft({ ...legacy, sleeve_form: 'Sleeve form' }, 'Shrink Sleeve').details.per_core).toBeUndefined();
  });

  it('the SKU edit keeps it and says what it was', async () => {
    const request = { ...buildCsaRequest(legacy, sku, { now: new Date('2026-09-01T00:00:00Z') }), details: { sleeve_form: 'Roll form', core_mm: 76, per_core: '500 m per core' } };
    const { saved } = openRep(salesModule({ skus: [{ ...sku, category: 'Juices', created_by: REP, csa_requested: true, csa_request: request }] }));
    await tab('📦 SKUs');
    await userEvent.click(await screen.findByLabelText('Edit Sleeve'));
    expect(within(details()).getByText(/Earlier entry: “500 m per core”/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('✓ Save SKU'));
    await waitFor(() => expect(lastSaved(saved, 'sales')).toBeTruthy());
    expect(lastSaved(saved, 'sales').skus[0].csa_draft.details).toMatchObject({ per_core: '500 m per core', core_mm: 76 });
  });
});
