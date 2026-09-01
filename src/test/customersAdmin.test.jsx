import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import CustomersAdmin from '../components/CustomersAdmin.jsx';

// Issues 2.0: the Customers tab works like the old version — a TOP FORM adds a
// new customer, the table is READ-ONLY, and each row's Edit button loads it into
// the form for update.

describe('Customers admin', () => {
  it('Edit loads the row into the top form; Update saves to module 4', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<CustomersAdmin />, {
      modules: { customers: [{ customer: 'Acme', dispatchLoc: 'Hyderabad', gstin: '36AB', contactPerson: '', state: 'Telangana' }] },
      role: 'superadmin',
    });
    // wait for the ROW (not just any 'Acme' text — the Manage panel renders first)
    await screen.findByLabelText('Edit customer Acme');

    // the table itself is read-only — the only inputs in its body are the
    // radio Edit selectors (like the Item Master)
    const table = screen.getAllByRole('table')[0];
    expect([...table.querySelectorAll('tbody input')].every((i) => i.type === 'radio')).toBe(true);

    await user.click(screen.getByLabelText('Edit customer Acme'));
    const gstin = screen.getByLabelText('Customer form GSTIN');
    expect(gstin).toHaveValue('36AB');
    await user.clear(gstin);
    await user.type(gstin, '36XYZ9');
    // Remarks: free text saved with the customer
    await user.type(screen.getByLabelText('Customer form Remarks'), 'Prefers morning deliveries');
    await user.click(screen.getByRole('button', { name: /Update Customer/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 4)).toBe(true));
    const cust = saved.find((s) => s.id === 4).data;
    expect(cust).toHaveLength(1);
    expect(cust[0]).toMatchObject({ customer: 'Acme', gstin: '36XYZ9', state: 'Telangana', remarks: 'Prefers morning deliveries' });
  });

  it('the top form adds a new customer; a blank name is refused', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<CustomersAdmin />, { modules: { customers: [{ customer: 'Acme', gstin: '36AB' }] }, role: 'superadmin' });
    await screen.findByLabelText('Edit customer Acme');

    // no name → refused, nothing saved
    await user.click(screen.getByRole('button', { name: /Add Customer/ }));
    expect(await screen.findByText(/Customer name is required/)).toBeInTheDocument();
    expect(saved.some((s) => s.id === 4)).toBe(false);

    await user.selectOptions(screen.getByLabelText('Customer form Customer'), '__new__');
    await user.type(screen.getByLabelText('New customer name'), 'Bharat Foods');
    await user.type(screen.getByLabelText('Customer form GSTIN'), '29ZZ');
    await user.click(screen.getByRole('button', { name: /Add Customer/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 4)).toBe(true));
    const data = saved.find((s) => s.id === 4).data;
    expect(data).toHaveLength(2);
    expect(data[1]).toMatchObject({ customer: 'Bharat Foods', gstin: '29ZZ' });
  });
});
