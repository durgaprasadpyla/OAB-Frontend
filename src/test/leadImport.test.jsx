import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// "Can we push this lead list into the sales rep logins and the S Dashboard?" — the
// Lead List's TOOL FORMAT sheet imported into module 12 as leads + contacts.

vi.mock('../lib/xlsx.js', async (orig) => ({ ...(await orig()), readWorkbookAOA: vi.fn() }));
import { readWorkbookAOA } from '../lib/xlsx.js';
import { renderApp } from './harness.jsx';
import SalesAdmin from '../pages/SalesAdmin.jsx';
import { leadsForRep } from '../lib/sales.js';
import { conversionPending } from '../lib/repFlow.js';
import {
  parseLeadRows, planImport, applyImport, matchRep, pickLeadSheet, normStatus, normCategory, normCustomerType, normRank,
} from '../lib/leadImport.js';

afterEach(() => { vi.restoreAllMocks(); });

// The sheet's own header row, misspellings and repeated columns included.
const HEAD = ['Lead Name', 'Company Name', 'Customer Type (Manufacturer/Trader/…)', 'Payment Type (A+/A/B/C/D)', 'Categories (Dairy/…)',
  'Initial Status (Hot/Warm/…)', 'HO Address', 'HO City', 'Dispatch City', 'GST Number', 'Rank (Primary/Secondary/Tertiary)',
  'Designation (CEO/…)', 'Contact City', 'Contact Person Name', 'Secondary contact person', 'Primnary Phone number',
  'Secondary Phone Number', 'Email Id', 'Secondary Email Id', 'Designation (CEO/…)', 'Contact City', '', 'Rank (Primary/Secondary/Tertiary)'];
const row = (o) => HEAD.map((_, i) => o[i] ?? '');
const ROWS = [
  HEAD,
  row({ 0: 'Senthil ', 1: 'PARAS DAIRY', 2: 'MANUFACTURER', 3: 'A', 4: 'DAIRY', 5: 'WARM', 7: 'NOIDA', 8: 'NOIDA', 10: 'PRIMARY', 13: 'Piyush', 15: '9891293833', 17: 'Piyush@paras.com' }),
  row({ 0: 'Senthil', 1: 'Paras  Dairy', 10: 'SECONDARY', 11: 'Purchase manager', 13: 'Devo Nayak', 15: '8377003870', 17: 'd@paras.com',
    14: 'Vimo', 16: '95920', 18: 'v@paras.com' }),
  // same person again (same email) — one contact, not two
  row({ 0: 'Senthil', 1: 'PARAS DAIRY', 13: 'PIYUSH - PUR MGR', 17: 'piyush@paras.com', 12: 'NOIDA' }),
  row({ 0: 'Pradeep ', 1: 'Crown beers india pvt ltd .', 2: 'Filler Swiggy', 4: 'Others', 5: 'CONVERTED', 13: 'NAVEEN', 15: '91 98492 33271' }),
  row({ 1: 'HATSUN', 4: 'CHIKKI/NAMKEEN', 5: 'APPROACH', 3: 'a+' }),
  row({ 0: 'Pradeep', 13: 'Orphan', 15: '1' }),   // no company → skipped
  row({}),
];
const USERS = [
  { id: 'R_S', username: 'senthil', display_name: 'Senthil Kumar', status: 'Active' },
  { id: 'R_P', username: 'pradeep', display_name: 'Pradeep', status: 'Active' },
];
const repFor = (n) => matchRep(n, USERS);
const ids = () => { let i = 0; return (p) => `${p}_${++i}`; };

describe('Lead List import — parsing the TOOL FORMAT sheet', () => {
  it('groups the rows of one company into one lead with its people as contacts', () => {
    const p = parseLeadRows(ROWS);
    expect(p.companies.map((c) => c.name)).toEqual(['PARAS DAIRY', 'Crown beers india pvt ltd .', 'HATSUN']);
    expect(p.skipped).toEqual([{ row: 7, reason: 'no company name' }]);
    const paras = p.companies[0];
    expect(paras).toMatchObject({ rep: 'Senthil', customerType: 'Manufacturer', paymentType: 'A', categories: ['Dairy'], status: 'Warm', hoCity: 'NOIDA' });
    expect(paras.contacts.map((c) => [c.name, c.rank, c.email])).toEqual([
      ['Piyush', 1, 'piyush@paras.com'], ['Devo Nayak', 2, 'd@paras.com'], ['Vimo', '', 'v@paras.com'],
    ]);
    expect(paras.contacts[0].location).toBe('NOIDA');               // filled in from the repeat row
    expect(paras.contacts[1].designation).toBe('Purchase Manager');  // the app's own spelling
    expect(p.repNames).toEqual({ Senthil: 1, Pradeep: 1, '': 1 });
  });

  it('maps the typed values onto the app’s lists', () => {
    expect(normStatus('WARM')).toBe('Warm');
    expect(normStatus('APPROACH')).toBe('To Approach');
    expect(normStatus('')).toBe('To Approach');
    expect(normCategory('PET FOODS')).toBe('Pet Food');
    expect(normCategory('Confectionary')).toBe('Confectionery');
    expect(normCategory('Other')).toBe('Others');
    expect(normCategory('LIQUOR')).toBe('Liquor');                   // not on the list: kept, title-cased
    expect(normCustomerType('Filler Swiggy')).toBe('Filler');
    expect(normCustomerType('MANUFACTURER')).toBe('Manufacturer');
    expect(normCustomerType('Agent')).toBe('Others');
    expect(normRank('PRIMARY')).toBe(1);
    expect(normRank('A')).toBe('');
    const hat = parseLeadRows(ROWS).companies[2];
    expect(hat.categories).toEqual(['Namkeen']);                     // CHIKKI/NAMKEEN is one category
    expect(hat.paymentType).toBe('A+');
  });

  it('matches a Lead Name to a rep account by name, and only when it is unambiguous', () => {
    expect(matchRep('Senthil ', USERS)).toBe('R_S');
    expect(matchRep('pradeep', USERS)).toBe('R_P');
    expect(matchRep('Manasa', USERS)).toBe('');
    // two Senthils and neither is exactly "Senthil": left for the admin to choose
    expect(matchRep('Senthil', [{ id: 'A', display_name: 'Senthil Kumar', username: 'sk' }, { id: 'B', display_name: 'Senthil Raj', username: 'sr' }])).toBe('');
  });

  it('finds the TOOL FORMAT sheet among the notes sheets', () => {
    const sheets = [{ name: 'overall', rows: [['CONVERTED', 'ACTIVE']] }, { name: 'TOOL FORMAT', rows: ROWS }];
    expect(pickLeadSheet(sheets).name).toBe('TOOL FORMAT');
    expect(pickLeadSheet([{ name: 'x', rows: [['a']] }])).toBeNull();
  });
});

describe('Lead List import — writing module 12', () => {
  it('creates leads owned by the matched rep, so they land in that rep’s login', () => {
    const p = parseLeadRows(ROWS);
    const { next, counts } = applyImport({ leads: [], contacts: [], sales_users: USERS }, p, repFor, { uid: ids() });
    expect(counts).toEqual({ leads: 3, contacts: 4, joined: 0, unchanged: 0 });
    const paras = next.leads.find((l) => l.client_name === 'PARAS DAIRY');
    expect(paras).toMatchObject({ assigned_to: 'R_S', category_assignments: { Dairy: 'R_S' }, stage: 'Warm', payment_type: 'A', head_office: 'NOIDA', delivery_location: 'NOIDA', source: 'lead_import' });
    expect(leadsForRep(next.leads, 'R_S').map((l) => l.client_name)).toEqual(['PARAS DAIRY']);
    expect(leadsForRep(next.leads, 'R_P').map((l) => l.client_name)).toEqual(['Crown beers india pvt ltd .']);
    // the blank Lead Name goes to nobody: listed on the S Dashboard as Unassigned
    const hat = next.leads.find((l) => l.client_name === 'HATSUN');
    expect(hat.assigned_to).toBe('');
    expect(hat.category_assignments).toEqual({});
    // contacts hang off the lead, one per rank
    const pc = next.contacts.filter((c) => c.lead_id === paras.id);
    expect(pc.map((c) => [c.name, c.priority, c.is_primary])).toEqual([['Piyush', 1, true], ['Devo Nayak', 2, false], ['Vimo', '', false]]);
    expect(pc[0]).toMatchObject({ customer: 'PARAS DAIRY', customer_type: 'Manufacturer', categories: ['Dairy'] });
  });

  it('sends a lead the sheet marks Converted to the conversion queue, not straight to customer', () => {
    const { next } = applyImport({ leads: [], contacts: [] }, parseLeadRows(ROWS), repFor, { uid: ids() });
    const crown = next.leads.find((l) => l.client_name.startsWith('Crown'));
    expect(conversionPending(crown)).toBe(true);
    expect(crown.converted_to_customer).toBeUndefined();
  });

  it('never duplicates a company already on the list — it only gains the contacts it lacks', () => {
    const prev = {
      leads: [{ id: 'L9', client_name: 'Paras Dairy', assigned_to: 'R_P', category_assignments: {}, stage: 'Hot' }],
      contacts: [{ id: 'c1', lead_id: 'L9', name: 'Piyush', email: 'piyush@paras.com', priority: 1 }],
    };
    const p = parseLeadRows(ROWS);
    expect(planImport(p, prev).create.map((c) => c.name)).toEqual(['Crown beers india pvt ltd .', 'HATSUN']);
    const { next, counts } = applyImport(prev, p, repFor, { uid: ids() });
    expect(counts).toMatchObject({ leads: 2, joined: 1 });
    expect(next.leads.filter((l) => /paras/i.test(l.client_name))).toHaveLength(1);
    expect(next.leads.find((l) => l.id === 'L9').stage).toBe('Hot');           // the existing lead is untouched
    expect(next.contacts.filter((c) => c.lead_id === 'L9').map((c) => [c.name, c.priority]))
      .toEqual([['Piyush', 1], ['Devo Nayak', 2], ['Vimo', '']]);              // rank 1 stays with the one who held it
    // importing the same file twice adds nothing
    const again = applyImport(next, p, repFor, { uid: ids() });
    expect(again.counts).toEqual({ leads: 0, contacts: 0, joined: 0, unchanged: 3 });
  });
});

describe('Lead List import — the S Dashboard Leads tab', () => {
  const sales = () => ({ leads: [], contacts: [], interactions: [], sales_users: JSON.parse(JSON.stringify(USERS)), dropdowns: {} });

  it('previews the file, lets the admin pick the rep for each Lead Name, and imports on confirm', async () => {
    readWorkbookAOA.mockResolvedValue([{ name: 'overall', rows: [['x']] }, { name: 'TOOL FORMAT', rows: ROWS }]);
    const { saved } = renderApp(<SalesAdmin />, { modules: { sales: sales(), customers: [] }, role: 'sadmin' });
    await userEvent.click(await screen.findByText('📈 Leads'));
    await userEvent.click(screen.getByLabelText('Import leads from Excel'));
    fireEvent.change(screen.getByLabelText('Lead list file'), { target: { files: [new File(['x'], 'Lead List.xlsx')] } });

    expect(await screen.findByText('Import 3 lead(s)')).toBeInTheDocument();
    expect(screen.getByLabelText('Rep for “Senthil”').value).toBe('R_S');
    expect(screen.getByLabelText('Rep for “Pradeep”').value).toBe('R_P');
    expect(screen.getByLabelText('Rep for (blank Lead Name)').value).toBe('');
    expect(screen.getByText(/Skipped \(no company name\): row 7/)).toBeInTheDocument();
    // the blank rows go to Pradeep this time
    fireEvent.change(screen.getByLabelText('Rep for (blank Lead Name)'), { target: { value: 'R_P' } });
    await userEvent.click(screen.getByLabelText('Import now'));

    await waitFor(() => expect(screen.getByText(/Imported 3 new lead\(s\) and 4 contact\(s\)/)).toBeInTheDocument());
    const data = saved.filter((s) => s.key === 'sales').pop().data;
    expect(data.leads.map((l) => [l.client_name, l.assigned_to])).toEqual([
      ['PARAS DAIRY', 'R_S'], ['Crown beers india pvt ltd .', 'R_P'], ['HATSUN', 'R_P'],
    ]);
    expect(data.contacts).toHaveLength(4);
    expect(data.sales_users).toHaveLength(2);                                  // nothing else in the blob is touched
  });
});
