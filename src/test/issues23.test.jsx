import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import LeadsAdmin from '../components/LeadsAdmin.jsx';

// Issues 2.3 — the client's red comments on items previously called done.
//
//  ¶2  the BOM line needs an Item Code that works BOTH ways
//  ¶6  the Super Admin needs a Leads tab, not just a way to demote a customer
//  ¶7  a group deleted in Super Admin must stop showing against leads
//  ¶11 the password must be read from the database and shown

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

const LEADS = [
  { id: 'l1', client_name: 'Carlsberg', group: 'Carlsberg Group', city: 'Bangalore', stage: 'Hot', gstin: '29AA' },
  { id: 'l2', client_name: 'Ansh Agronomy', group: '', city: 'Hyderabad', stage: 'Warm' },
];
const CUSTOMERS = [{ customer: 'Ansh Agronomy', group: '' }];

let saved;
beforeEach(() => {
  saved = [];
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'superadmin');
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (u.includes('/api/auth/me')) return res(200, { username: 'boss', role: 'superadmin' });
    if (u.includes('/rest/v1/oab_data')) {
      if (method === 'GET') {
        return res(200, [
          { id: 4, data: JSON.stringify(CUSTOMERS), version: 1 },
          { id: 12, data: JSON.stringify({ leads: LEADS, contacts: [{ id: 'c1' }] }), version: 1 },
        ]);
      }
      saved.push({ id: body.id, data: JSON.parse(body.data) });
      return res(201, { id: body.id, version: 2 });
    }
    return res(200, []);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mountLeads = () => render(<MemoryRouter><AuthProvider><DataProvider><LeadsAdmin /></DataProvider></AuthProvider></MemoryRouter>);

describe('Issues 2.3 §6 — the Super Admin can see and edit leads', () => {
  it('lists the leads with their group, and marks the ones already customers', async () => {
    mountLeads();
    const carls = (await screen.findByText('Carlsberg')).closest('tr');
    expect(within(carls).getByText('Carlsberg Group')).toBeInTheDocument();
    // this one is NOT in the customer master, so it can be promoted
    expect(within(carls).getByLabelText('Convert Carlsberg to customer')).toBeInTheDocument();

    // Ansh Agronomy IS in the master, so it reads as a customer and can be demoted
    const ansh = screen.getByText('Ansh Agronomy').closest('tr');
    expect(within(ansh).getByText('✓ Customer')).toBeInTheDocument();
    expect(within(ansh).getByLabelText('Revert Ansh Agronomy to lead')).toBeInTheDocument();
  });

  it('edits a lead through the top form and writes only the lead rows back', async () => {
    const user = userEvent.setup();
    mountLeads();
    await user.click(await screen.findByLabelText('Edit lead Carlsberg'));
    const city = screen.getByLabelText('Lead form City');
    expect(city).toHaveValue('Bangalore');
    await user.clear(city);
    await user.type(city, 'Mysore');
    await user.click(screen.getByRole('button', { name: /Update Lead/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 12)).toBe(true));
    const blob = saved.find((s) => s.id === 12).data;
    expect(blob.leads.find((l) => l.id === 'l1').city).toBe('Mysore');
    // the rest of the sales blob survives the write
    expect(blob.contacts).toEqual([{ id: 'c1' }]);
  });

  it('promoting a lead adds it to the customer master', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mountLeads();
    await user.click(await screen.findByLabelText('Convert Carlsberg to customer'));
    await waitFor(() => expect(saved.some((s) => s.id === 4)).toBe(true));
    const custs = saved.find((s) => s.id === 4).data;
    expect(custs.map((c) => c.customer)).toContain('Carlsberg');
    // …and the lead is flagged converted rather than deleted
    const blob = saved.find((s) => s.id === 12).data;
    expect(blob.leads.find((l) => l.id === 'l1').converted_to_customer).toBe(true);
  });

  it('a search narrows the list', async () => {
    mountLeads();
    await screen.findByText('Carlsberg');
    fireEvent.change(screen.getByLabelText('Search leads'), { target: { value: 'ansh' } });
    await waitFor(() => expect(screen.queryByText('Carlsberg')).toBeNull());
    expect(screen.getByText('Ansh Agronomy')).toBeInTheDocument();
  });
});

describe('Issues 2.3 §7 — a deleted group stops showing against leads', () => {
  it('clears the group from the sales leads as well as the customer master', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // a customer carrying the group, so the group appears in the Manage picker
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      const method = (opts.method || 'GET').toUpperCase();
      const body = opts.body ? JSON.parse(opts.body) : null;
      if (u.includes('/api/auth/me')) return res(200, { username: 'boss', role: 'superadmin' });
      if (u.includes('/rest/v1/oab_data')) {
        if (method === 'GET') {
          return res(200, [
            { id: 4, data: JSON.stringify([{ customer: 'Carlsberg India', group: 'Carlsberg Group' }]), version: 1 },
            { id: 12, data: JSON.stringify({ leads: LEADS, contacts: [{ id: 'c1' }] }), version: 1 },
          ]);
        }
        saved.push({ id: body.id, data: JSON.parse(body.data) });
        return res(201, { id: body.id, version: 2 });
      }
      return res(200, []);
    });

    const { default: CustomersAdmin } = await import('../components/CustomersAdmin.jsx');
    render(<MemoryRouter><AuthProvider><DataProvider><CustomersAdmin /></DataProvider></AuthProvider></MemoryRouter>);

    // The Manage panel's GROUP row — not the entry form's Group dropdown, which
    // offers the same option. The manage one is the select that opens with
    // "— select group —".
    await screen.findAllByRole('combobox');
    const groupSel = screen.getAllByRole('combobox')
      .find((c) => within(c).queryByRole('option', { name: '— select group —' }));
    expect(groupSel).toBeTruthy();
    fireEvent.change(groupSel, { target: { value: 'Carlsberg Group' } });
    const groupRow = groupSel.parentElement;
    await user.click(within(groupRow).getByRole('button', { name: 'Delete' }));

    // the group leaves the customer master AND the sales leads
    await waitFor(() => expect(saved.some((s) => s.id === 12)).toBe(true));
    const custs = saved.find((s) => s.id === 4).data;
    expect(custs[0].group).toBe('');
    const blob = saved.find((s) => s.id === 12).data;
    expect(blob.leads.find((l) => l.id === 'l1').group).toBe('');
    expect(blob.contacts).toEqual([{ id: 'c1' }]);   // nothing else in the blob is touched
  });
});
