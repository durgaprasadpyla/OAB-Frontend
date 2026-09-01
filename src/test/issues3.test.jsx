import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import { DataProvider } from '../data.jsx';
import { render } from '@testing-library/react';
import NewPO from '../pages/NewPO.jsx';
import Invoice from '../pages/Invoice.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import UsersAccess from '../components/UsersAccess.jsx';

// Issues 3.0 — the client's seven-item punch list, one describe per item.
//
//  §1 Super Admin can DELETE a user, not just disable it.
//  §2 The Password column shows what was assigned, and follows a self-service change.
//     (the "follows a change" half is server-side — Phase0StabilizationTest).
//  §3 The sales-user module allocation is legible.
//  §4 Opening an invoice from the register never writes a file by itself.
//  §5 A new sale order quotes the base price and BOTH grand totals (with / without GST).
//  §6 A PO number already in the OAB warns before the order is built.
//  §7 The Edit/Delete Sales Orders tab lists live orders only.

const jss = [{ spec: 'A1', customer: 'Acme', jobName: 'Pouch A', jobType: 'StayFresh', dispatchForm: 'pouch', width: 100, height: 200, gsm: 50, filmWidth: 300, mic: '40', material: 'BOPP', status: 'Active' }];
const prices = { A1: { price: 75, costPrice: 60, transport: 'At Actuals' } };
const customers = [{ customer: 'Acme', dispatchLoc: 'Hyderabad', warehouseName: '', billingAddr: 'Plot 1', gstin: '36ABCDE1234F1Z5', contactPerson: 'Ravi', contactPhone: '9000000000' }];

const fieldByLabel = (re) => {
  const lbl = screen.getByText(re);
  return (lbl.closest('.fg') || lbl.parentElement).querySelector('input, textarea, select');
};

afterEach(() => { vi.restoreAllMocks(); });

/* ── §1 delete a staff user ─────────────────────────────────────────────── */

// Same shape of admin-endpoint mock usersAccess.test.jsx uses, plus DELETE.
function installUsersFetch(initial) {
  const users = initial.slice();
  const calls = [];
  const res = (status, data) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: () => 'application/json' },
    json: async () => data, text: async () => JSON.stringify(data),
  });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/admin/users')) {
      calls.push(method + ' ' + u.split('/api')[1]);
      if (method === 'DELETE') {
        const id = Number(u.split('/').pop());
        const i = users.findIndex((x) => x.id === id);
        if (i < 0) return res(404, 'no user');
        const [gone] = users.splice(i, 1);
        return res(200, { deleted: true, username: gone.username });
      }
      if (method === 'GET') return res(200, users);
    }
    if (u.includes('/rest/v1/oab_data') && method === 'GET') {
      const sales = { sales_users: [], leads: [] };
      if (u.includes('id=in.(')) return res(200, [{ id: 12, data: JSON.stringify(sales), version: 1 }]);
      return res(200, [{ data: JSON.stringify(sales), version: 1 }]);
    }
    return res(200, {});
  };
  return { users, calls };
}

describe('Issues 3.0 §1 — Super Admin can delete a user', () => {
  beforeEach(() => { try { localStorage.setItem('blm_token', 't'); } catch { /* ignore */ } });

  it('deletes through DELETE /api/admin/users/:id once the username is confirmed', async () => {
    const user = userEvent.setup();
    const { users, calls } = installUsersFetch([
      { id: 1, username: 'superadmin', role: 'superadmin', disabled: false },
      { id: 2, username: 'qcguy', role: 'qc', disabled: false },
    ]);
    render(<DataProvider><UsersAccess /></DataProvider>);
    await screen.findByText('qcguy');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('qcguy');
    await user.click(screen.getByLabelText('Delete qcguy'));

    await waitFor(() => expect(users.map((u) => u.username)).toEqual(['superadmin']));
    expect(calls).toContain('DELETE /admin/users/2');
    await waitFor(() => expect(screen.queryByText('qcguy')).toBeNull());
  });

  it('deletes nothing when the typed username does not match', async () => {
    const user = userEvent.setup();
    const { users, calls } = installUsersFetch([
      { id: 1, username: 'superadmin', role: 'superadmin', disabled: false },
      { id: 2, username: 'qcguy', role: 'qc', disabled: false },
    ]);
    render(<DataProvider><UsersAccess /></DataProvider>);
    await screen.findByText('qcguy');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('oops');
    await user.click(screen.getByLabelText('Delete qcguy'));

    await screen.findByText(/Username did not match/);
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false);
    expect(users).toHaveLength(2);
  });

  it('does not call the server when the first confirm is dismissed', async () => {
    const user = userEvent.setup();
    const { calls } = installUsersFetch([{ id: 2, username: 'qcguy', role: 'qc', disabled: false }]);
    render(<DataProvider><UsersAccess /></DataProvider>);
    await screen.findByText('qcguy');

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('qcguy');
    await user.click(screen.getByLabelText('Delete qcguy'));

    expect(prompt).not.toHaveBeenCalled();
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false);
  });
});

/* ── §3 legible module allocation ───────────────────────────────────────── */

describe('Issues 3.0 §3 — the sales-user module allocation is readable', () => {
  it('lays the allocation checkboxes out in a .mod-alloc panel, caption beside each tick', async () => {
    const user = userEvent.setup();
    const sales = { sales_users: [{ id: 'rep-1', display_name: 'Manasa', username: 'manasa', password: 'man123', status: 'Active' }], leads: [] };
    const res = (status, data) => ({
      status, ok: true, headers: { get: () => 'application/json' },
      json: async () => data, text: async () => JSON.stringify(data),
    });
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/admin/users')) return res(200, []);
      if (u.includes('/rest/v1/oab_data')) {
        return res(200, u.includes('id=in.(') ? [{ id: 12, data: JSON.stringify(sales), version: 1 }] : [{ data: JSON.stringify(sales), version: 1 }]);
      }
      return res(200, {});
    };
    render(<DataProvider><UsersAccess /></DataProvider>);

    // The Add-a-sales-user form's allocation list is a panel, not a wrapping flex row.
    const formPanel = await screen.findByRole('group', { name: 'Module allocation' });
    expect(formPanel.className).toContain('mod-alloc');
    // Every module reads as its own label with its caption in a separate element,
    // so a 14px box rule can never squeeze the text on top of the tick.
    ['Follow-ups', 'Log Visit', 'Enter PO', 'My Targets', 'My Customers', 'My Contacts', 'Add Customer', 'SKUs', 'Negotiations']
      .forEach((label) => expect(within(formPanel).getByText(label).tagName).toBe('SPAN'));
    expect(within(formPanel).getAllByRole('checkbox')).toHaveLength(9);

    // The per-rep editor in the table uses the same panel.
    await user.click(await screen.findByLabelText('Edit modules for Manasa'));
    const rowPanel = await screen.findByRole('group', { name: 'Modules for Manasa' });
    expect(rowPanel.className).toContain('mod-alloc');
    expect(within(rowPanel).getAllByRole('checkbox')).toHaveLength(9);
  });
});

/* ── §4 the register's PDF button only opens the invoice ────────────────── */

describe('Issues 3.0 §4 — opening an invoice from the register downloads nothing', () => {
  const invoiceSeed = {
    oab: oabModule({
      SF: [{ so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', jobType: 'StayFresh', poQty: 1000, invDisp: 200, manDisp: 0, fg: 0, poNum: 'PO-1', poDate: '2026-07-01', dispLoc: 'Hyderabad' }],
      INV_REG: [{
        no: 'BL/26-27/223', date: '2026-07-10', po: 'PO-1', customer: 'Acme', qty: 200, amount: 15000,
        items: [{ so: '26/1', spec: 'A1', jobName: 'Pouch A', qty: 200, rate: 75, dispatchForm: 'pouch' }],
      }],
    }),
    jss, prices, customers,
  };

  it('renders the invoice for review without calling jsPDF save', async () => {
    const save = vi.fn();
    // The PDF pipeline is CDN-loaded at runtime; stub it so any stray call is visible.
    window.html2canvas = vi.fn(async () => ({ width: 800, height: 1000, toDataURL: () => 'data:image/png;base64,x' }));
    window.jspdf = { jsPDF: function JsPDF() { return { internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } }, addImage: vi.fn(), addPage: vi.fn(), save }; } };

    renderApp(<Invoice />, { modules: invoiceSeed, role: 'user' });
    const regCard = (await screen.findByText('Invoice Register')).closest('.card');
    // Period → All Time so the assertion does not depend on the clock.
    fireEvent.change(within(regCard).getByLabelText('Period'), { target: { value: 'all' } });
    fireEvent.click(await within(regCard).findByLabelText('PDF for BL/26-27/223'));

    // The sheet opens, with the two buttons that DO write a file sitting above it…
    await screen.findByRole('button', { name: /Save as PDF/ });
    expect(screen.getByRole('button', { name: /Print/ })).toBeTruthy();
    // …and nothing has been downloaded just for looking.
    await new Promise((r) => setTimeout(r, 60));
    expect(save).not.toHaveBeenCalled();
    expect(window.html2canvas).not.toHaveBeenCalled();
  });
});

/* ── §5 + §6 the new-sale-order screen ──────────────────────────────────── */

describe('Issues 3.0 §5 — base price and both grand totals on a new sale order', () => {
  it('quotes the base price, the base value, the GST and both grand totals', async () => {
    const user = userEvent.setup();
    renderApp(<NewPO />, { modules: { jss, prices, customers, oab: oabModule({ lastSO: { y: '26', n: 400 } }) } });
    await screen.findByText('New PO Entry');

    await user.type(fieldByLabel(/PO Number/), 'PO-100');
    await user.selectOptions(screen.getByLabelText('Customer'), 'Acme');
    await user.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));

    const checks = screen.getAllByRole('checkbox');
    await user.click(checks[checks.length - 1]);
    await user.type(screen.getByRole('spinbutton'), '500');

    // Step 2 already carries the running value: 500 × ₹75 = ₹37,500 base,
    // ₹6,750 GST @ 18%, ₹44,250 gross.
    expect(screen.getByText(/Base Value \(without GST\)/)).toBeTruthy();
    expect(screen.getAllByText('₹37,500.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹6,750.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹44,250.00').length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('button', { name: /Review →/ }));
    await screen.findByText('26/401');

    // Confirm step: the base price per unit, the pre-GST line value and the gross.
    expect(screen.getByText(/Base Price/)).toBeTruthy();
    expect(screen.getAllByText('₹75.00').length).toBeGreaterThanOrEqual(1);
    // Two grand totals stated separately, with the tax between them.
    expect(screen.getByText('Grand Total (without GST)')).toBeTruthy();
    expect(screen.getByText('GST @ 18%')).toBeTruthy();
    expect(screen.getByText('Grand Total (with 18% GST)')).toBeTruthy();
    // ₹37,500 on the row and again as the pre-GST grand total; likewise ₹44,250.
    expect(screen.getAllByText('₹37,500.00')).toHaveLength(2);
    expect(screen.getAllByText('₹44,250.00')).toHaveLength(2);
    expect(screen.getAllByText('₹6,750.00')).toHaveLength(1);
  });
});

describe('Issues 3.0 §6 — a PO number already in the OAB is flagged', () => {
  const seedWithPo = {
    jss, prices, customers,
    oab: oabModule({
      SF: [{ so: '26/399', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', poQty: 100, invDisp: 0, manDisp: 0, fg: 0, poNum: 'PO-100', poDate: '2026-07-01' }],
      lastSO: { y: '26', n: 400 },
    }),
  };

  it('asks "PO Number is already in OAB. Do you want to continue?" and stops on Cancel', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderApp(<NewPO />, { modules: seedWithPo });
    await screen.findByText('New PO Entry');

    await user.type(fieldByLabel(/PO Number/), 'po-100');   // same PO, different case
    await user.selectOptions(screen.getByLabelText('Customer'), 'Acme');
    await user.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain('PO Number is already in OAB. Do you want to continue?');
    expect(confirm.mock.calls[0][0]).toContain('26/399');
    // Cancelled → still on step 1.
    expect(screen.queryByRole('button', { name: /Review →/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Next: Select SKUs/ })).toBeTruthy();
  });

  it('continues to the SKU step when the operator confirms', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp(<NewPO />, { modules: seedWithPo });
    await screen.findByText('New PO Entry');

    await user.type(fieldByLabel(/PO Number/), 'PO-100');
    await user.selectOptions(screen.getByLabelText('Customer'), 'Acme');
    await user.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));

    expect(await screen.findByRole('button', { name: /Review →/ })).toBeTruthy();
  });

  it('does not warn for a PO number that is not in the OAB', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp(<NewPO />, { modules: seedWithPo });
    await screen.findByText('New PO Entry');

    await user.type(fieldByLabel(/PO Number/), 'PO-777');
    await user.selectOptions(screen.getByLabelText('Customer'), 'Acme');
    await user.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));

    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /Review →/ })).toBeTruthy();
  });
});

/* ── §7 the Edit SOs tab lists live orders only ─────────────────────────── */

describe('Issues 3.0 §7 — Edit / Delete Sales Orders hides closed orders', () => {
  it('lists only live orders and says how many closed ones are hidden', async () => {
    const seed = {
      oab: oabModule({
        SF: [
          { so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', poQty: 1000, invDisp: 1000, manDisp: 0, fg: 0, closed: true, poNum: 'PO-OLD', poDate: '2026-05-01' },
          { so: '26/2', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', poQty: 500, invDisp: 0, manDisp: 0, fg: 0, closed: false, poNum: 'PO-LIVE', poDate: '2026-07-01' },
        ],
      }),
      prices, jss, customers,
    };
    renderApp(<Dashboard />, { modules: seed, role: 'superadmin' });
    fireEvent.click(await screen.findByText('✏ Edit SOs'));

    await screen.findByText('26/2');
    expect(screen.queryByText('26/1')).toBeNull();
    expect(screen.queryByText('PO-OLD')).toBeNull();
    expect(screen.getByText(/1 closed order is hidden/)).toBeTruthy();
    expect(screen.getByText('1 live')).toBeTruthy();
  });

  it('shows an empty state when every order is closed', async () => {
    const seed = {
      oab: oabModule({
        SF: [{ so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', poQty: 1000, invDisp: 1000, manDisp: 0, fg: 0, closed: true, poNum: 'PO-OLD', poDate: '2026-05-01' }],
      }),
      prices, jss, customers,
    };
    renderApp(<Dashboard />, { modules: seed, role: 'superadmin' });
    fireEvent.click(await screen.findByText('✏ Edit SOs'));

    await screen.findByText(/every order in the OAB is closed/);
  });
});
