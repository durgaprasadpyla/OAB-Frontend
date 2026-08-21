import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import SalesAdmin from '../pages/SalesAdmin.jsx';
import {
  csaResolve, csaAll, setCsaGivenDate, ageColor,
  dailyRows, poRows, contactRows,
  manageCustomers, manageGroups, customerCategories, customerCategoryForms,
  applyCustomerCategories, cleanupApply, deleteCustomer,
} from '../lib/salesAdmin.js';

const REP = { id: 'R1', username: 'rep1', display_name: 'Rep One', status: 'Active' };
const leads = [
  { id: 'L1', client_name: 'Acme Dairy', group: 'Acme Group', categories: ['Dairy'], category_assignments: { Dairy: 'R1' }, assigned_to: 'R1' },
  { id: 'L2', client_name: 'Beta Snacks', categories: ['Namkeen'], category_assignments: {} },
];
const skus = [{ id: 'S1', lead_id: 'L1', sku_name: 'Pouch A', category: 'Dairy', dispatch_form: 'Pouch', created_at: '2026-08-01T00:00:00Z' }];

const sales = (over = {}) => ({
  leads, skus, contacts: [], interactions: [], pos: [], quotations: [], qc_reports: [],
  sales_users: [REP], targets: [], substrate_options: [], nego_msgs: [], dropdowns: {}, ...over,
});

/* ── CSA & Quote ─────────────────────────────────────────────────────────── */

describe('csaResolve — where a sample actually came from', () => {
  it('takes the submission date from the SKU, because that is when the sample arrived', () => {
    const r = { id: 'Q1', sku_id: 'S1', lead_id: 'L1', created_at: '2026-08-06T00:00:00Z', status: 'Pending Plant' };
    const x = csaResolve(r, sales());
    expect(x.customer).toBe('Acme Dairy');
    expect(x.sku).toBe('Pouch A');
    expect(x.submission).toBe('2026-08-01T00:00:00Z');   // the SKU, not the report
    expect(x.generated).toBe('2026-08-06T00:00:00Z');
  });

  it('reads a walk-in report off itself — it has no SKU or lead behind it', () => {
    const r = { id: 'Q2', source: 'direct', company_name: 'Walk-in Co', product_desc: 'Sample film', created_at: '2026-08-10T00:00:00Z' };
    const x = csaResolve(r, sales());
    expect(x.customer).toBe('Walk-in Co');
    expect(x.sku).toBe('Sample film');
    expect(x.submission).toBe('2026-08-10T00:00:00Z');
  });

  it('lists every report', () => {
    expect(csaAll(sales({ qc_reports: [{ id: 'Q1' }, { id: 'Q2' }] }))).toHaveLength(2);
  });

  it('records the date a report was given to the customer', () => {
    const out = setCsaGivenDate([{ id: 'Q1' }, { id: 'Q2' }], 'Q1', '2026-08-12');
    expect(out[0].given_to_client_date).toBe('2026-08-12');
    expect(out[1].given_to_client_date).toBeUndefined();
  });

  it('colours an age by how late it is', () => {
    expect(ageColor(null)).toBe('#888');
    expect(ageColor(1)).toBe('#0e6fb8');
    expect(ageColor(4)).toBe('#E67E22');
    expect(ageColor(9)).toBe('#c0392b');
  });
});

/* ── Daily / POs / Contacts ──────────────────────────────────────────────── */

describe('dailyRows', () => {
  const inters = [
    { id: 'I1', lead_id: 'L1', created_by: 'R1', date: '2026-08-10', type: 'Call', outcome: 'Discussed pricing' },
    { id: 'I2', lead_id: 'L2', created_by: 'R2', date: '2026-08-12', type: 'Visit', outcome: 'Plant tour' },
  ];

  it('lists newest first with the lead resolved', () => {
    const rows = dailyRows(sales({ interactions: inters }));
    expect(rows.map((r) => r.i.id)).toEqual(['I2', 'I1']);
    expect(rows[1].lead.client_name).toBe('Acme Dairy');
  });

  it('filters by rep and by free text across customer, type and notes', () => {
    expect(dailyRows(sales({ interactions: inters }), { repId: 'R1' }).map((r) => r.i.id)).toEqual(['I1']);
    expect(dailyRows(sales({ interactions: inters }), { q: 'plant' }).map((r) => r.i.id)).toEqual(['I2']);
    expect(dailyRows(sales({ interactions: inters }), { q: 'acme' }).map((r) => r.i.id)).toEqual(['I1']);
  });
});

describe('poRows', () => {
  const pos = [
    { id: 'P1', lead_id: 'L1', sku_id: 'S1', created_by: 'R1', date: '2026-08-05', qty: 100, price: 12, po_number: 'PO-1' },
    { id: 'P2', lead_id: 'L2', sku_id: 'S9', created_by: 'R2', date: '2026-08-09', qty: 10, price: 5, po_number: 'PO-2' },
  ];

  it('totals each line and the grand total', () => {
    const { rows, grand } = poRows(sales({ pos }));
    expect(rows.map((r) => r.p.id)).toEqual(['P2', 'P1']);   // newest first
    expect(grand).toBe(1250);
    expect(rows[1].sku.sku_name).toBe('Pouch A');
    expect(rows[0].sku).toBe(null);                          // unknown SKU is tolerated
  });

  it('narrows the grand total to the filtered set', () => {
    expect(poRows(sales({ pos }), { repId: 'R1' }).grand).toBe(1200);
    expect(poRows(sales({ pos }), { q: 'po-2' }).grand).toBe(50);
  });
});

describe('contactRows', () => {
  const contacts = [
    { id: 'c1', lead_id: 'L1', name: 'Mr Acme', phone: '900', email: 'a@x.com', categories: ['Dairy'] },
    { id: 'c2', lead_id: 'L2', name: 'Ms Beta', phone: '901', customer: 'Beta Snacks' },
  ];

  it('searches name, customer, phone and email', () => {
    const all = contactRows(sales({ contacts }));
    expect(all).toHaveLength(2);
    expect(contactRows(sales({ contacts }), '901').map((r) => r.c.id)).toEqual(['c2']);
    expect(contactRows(sales({ contacts }), 'a@x').map((r) => r.c.id)).toEqual(['c1']);
    expect(contactRows(sales({ contacts }), 'acme').map((r) => r.c.id)).toEqual(['c1']);
  });
});

/* ── Manage ──────────────────────────────────────────────────────────────── */

describe('Manage — the customer / group lists', () => {
  it('gathers customer names off leads AND contacts', () => {
    const s = sales({ contacts: [{ id: 'c1', customer: 'Gamma Foods' }] });
    expect(manageCustomers(s)).toEqual(['Acme Dairy', 'Beta Snacks', 'Gamma Foods']);
  });

  it('gathers groups off contacts and the Customer Master', () => {
    const s = sales({ contacts: [{ id: 'c1', group: 'Contact Group' }] });
    expect(manageGroups(s, [{ customer: 'X', group: 'Master Group' }])).toEqual(['Contact Group', 'Master Group']);
  });

  it('reads a customer\'s current categories and dispatch-form restrictions', () => {
    const s = sales({ leads: [{ ...leads[0], category_dispatch_forms: { Dairy: ['Pouch'] } }] });
    expect(customerCategories(s, 'Acme Dairy')).toEqual(['Dairy']);
    expect(customerCategoryForms(s, 'Acme Dairy')).toEqual({ Dairy: ['Pouch'] });
  });
});

describe('applyCustomerCategories', () => {
  it('keeps the rep on a surviving category and drops assignments for removed ones', () => {
    const r = applyCustomerCategories(sales(), 'Acme Dairy', ['Dairy', 'Spices'], { Dairy: ['Pouch'] });
    const lead = r.leads.find((l) => l.id === 'L1');
    expect(lead.categories).toEqual(['Dairy', 'Spices']);
    expect(lead.category_assignments).toEqual({ Dairy: 'R1', Spices: 'R1' });  // new one inherits the lead's rep
    expect(lead.category_dispatch_forms).toEqual({ Dairy: ['Pouch'] });
    expect(r.created).toBe(false);
  });

  it('clears an assignment when its category is removed', () => {
    const r = applyCustomerCategories(sales(), 'Acme Dairy', ['Spices'], {});
    expect(r.leads.find((l) => l.id === 'L1').category_assignments).toEqual({ Spices: 'R1' });
  });

  it('creates a lead for a customer that exists only as a contact', () => {
    const s = sales({ contacts: [{ id: 'c1', customer: 'Gamma Foods', group: 'G', created_by: 'R1' }] });
    const r = applyCustomerCategories(s, 'Gamma Foods', ['Oil'], {}, { uid: (p) => p + '_new' });
    expect(r.created).toBe(true);
    const made = r.leads.find((l) => l.client_name === 'Gamma Foods');
    expect(made).toMatchObject({ categories: ['Oil'], group: 'G', created_by: 'R1', stage: 'To Approach' });
  });

  it('does nothing for an unknown customer with no categories', () => {
    const r = applyCustomerCategories(sales(), 'Nobody', [], {});
    expect(r.count).toBe(0);
    expect(r.created).toBe(false);
  });
});

describe('cleanupApply — a rename reaches every module the name lives in', () => {
  const modules = {
    sales: sales({ contacts: [{ id: 'c1', customer: 'Acme Dairy', group: 'Acme Group' }] }),
    customers: [{ customer: 'Acme Dairy', group: 'Acme Group', dispatchLoc: 'HYD' }],
    jss: [{ spec: 'A1', customer: 'Acme Dairy', group: 'Acme Group' }],
    oab: { OAB: { SF: [{ so: '26/1', customer: 'Acme Dairy' }], OT: [] }, INV_REG: [] },
  };

  it('renames a customer on leads, contacts, the master, the specs and the orders', () => {
    const r = cleanupApply('renameCustomer', 'Acme Dairy', 'Acme Dairy Pvt Ltd', modules);
    expect(r.counts).toEqual({ cm: 1, jss: 1, oab: 1, leads: 1, contacts: 1 });
    expect(r.leads[0].client_name).toBe('Acme Dairy Pvt Ltd');
    expect(r.contacts[0].customer).toBe('Acme Dairy Pvt Ltd');
    expect(r.customers[0].customer).toBe('Acme Dairy Pvt Ltd');
    expect(r.jss[0].customer).toBe('Acme Dairy Pvt Ltd');
    expect(r.oab.OAB.SF[0].customer).toBe('Acme Dairy Pvt Ltd');
  });

  it('leaves the OAB untouched for a group operation — rows carry no group', () => {
    const r = cleanupApply('renameGroup', 'Acme Group', 'Acme Holdings', modules);
    expect(r.counts.oab).toBe(0);
    expect(r.oab).toBe(modules.oab);
    expect(r.contacts[0].group).toBe('Acme Holdings');
    expect(r.jss[0].group).toBe('Acme Holdings');
    expect(r.customers[0].group).toBe('Acme Holdings');
  });

  it('un-groups rather than renames on a delete', () => {
    const r = cleanupApply('deleteGroup', 'Acme Group', '', modules);
    expect(r.contacts[0].group).toBe('');
    expect(r.customers[0].group).toBe('');
    // The customers themselves survive.
    expect(r.customers[0].customer).toBe('Acme Dairy');
  });

  it('counts nothing when the name is not present', () => {
    const r = cleanupApply('renameCustomer', 'Nobody', 'Someone', modules);
    expect(r.counts).toEqual({ cm: 0, jss: 0, oab: 0, leads: 0, contacts: 0 });
  });
});

describe('deleteCustomer', () => {
  it('drops the lead, the contacts and the master rows — but never order history', () => {
    const s = sales({ contacts: [{ id: 'c1', customer: 'Acme Dairy' }, { id: 'c2', customer: 'Beta Snacks' }] });
    const r = deleteCustomer('Acme Dairy', { sales: s, customers: [{ customer: 'Acme Dairy' }, { customer: 'Other' }] });
    expect(r.counts).toEqual({ leads: 1, contacts: 1, cm: 1 });
    expect(r.leads.map((l) => l.client_name)).toEqual(['Beta Snacks']);
    expect(r.contacts.map((c) => c.id)).toEqual(['c2']);
    expect(r.customers.map((c) => c.customer)).toEqual(['Other']);
  });
});

/* ── Screens ─────────────────────────────────────────────────────────────── */

const open = (over) => renderApp(<SalesAdmin />, { modules: { sales: sales(over), customers: [] }, role: 'sadmin' });
const goTab = async (label) => {
  const hit = [...document.querySelectorAll('.step-tab')].find((el) => el.textContent.includes(label));
  await userEvent.click(hit);
};

describe('S Dashboard — the tabs production ships', () => {
  it('offers Daily Updates, CSA & Quote, All POs, Contacts and Manage', async () => {
    open();
    await screen.findByText('📊 S Dashboard');
    ['📋 Daily Updates', '🧪 CSA & Quote', '📦 All POs', '👥 Contacts', '🧹 Manage']
      .forEach((t) => expect(screen.getByText(t)).toBeInTheDocument());
  });

  it('All POs totals the value across reps', async () => {
    open({ pos: [{ id: 'P1', lead_id: 'L1', sku_id: 'S1', created_by: 'R1', date: '2026-08-05', qty: 100, price: 12, po_number: 'PO-1' }] });
    await screen.findByText('📊 S Dashboard');
    await goTab('All POs');
    expect(await screen.findByText(/Total PO value/)).toBeInTheDocument();
    expect(screen.getByText('PO-1')).toBeInTheDocument();
  });

  it('Manage renames a customer across the sales blob and the Customer Master', async () => {
    const { saved } = renderApp(<SalesAdmin />, {
      modules: { sales: sales({ contacts: [{ id: 'c1', customer: 'Acme Dairy' }] }), customers: [{ customer: 'Acme Dairy', dispatchLoc: 'HYD' }] },
      role: 'sadmin',
    });
    await screen.findByText('📊 S Dashboard');
    await goTab('🧹 Manage');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.selectOptions(await screen.findByLabelText('Customer to manage'), 'Acme Dairy');
    await userEvent.type(screen.getByLabelText('New customer name'), 'Acme Dairy Pvt Ltd');
    await userEvent.click(screen.getByRole('button', { name: 'Rename / Merge' }));

    await waitFor(() => expect(saved.some((s) => s.key === 'customers')).toBe(true));
    expect(saved.filter((s) => s.key === 'sales').pop().data.leads[0].client_name).toBe('Acme Dairy Pvt Ltd');
    expect(saved.filter((s) => s.key === 'customers').pop().data[0].customer).toBe('Acme Dairy Pvt Ltd');
    confirm.mockRestore();
  });
});
