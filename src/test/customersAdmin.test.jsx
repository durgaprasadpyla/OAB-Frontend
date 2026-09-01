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
    await screen.findAllByText('Acme');

    // the table itself is read-only — no text inputs in its body
    const table = screen.getAllByRole('table')[0];
    expect([...table.querySelectorAll('tbody input')]).toHaveLength(0);

    await user.click(screen.getByLabelText('Edit customer Acme'));
    const gstin = screen.getByLabelText('Customer form GSTIN');
    expect(gstin).toHaveValue('36AB');
    await user.clear(gstin);
    await user.type(gstin, '36XYZ9');
    await user.click(screen.getByRole('button', { name: /Update Customer/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 4)).toBe(true));
    const cust = saved.find((s) => s.id === 4).data;
    expect(cust).toHaveLength(1);
    expect(cust[0]).toMatchObject({ customer: 'Acme', gstin: '36XYZ9', state: 'Telangana' });
  });

  it('the top form adds a new customer; a blank name is refused', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<CustomersAdmin />, { modules: { customers: [{ customer: 'Acme', gstin: '36AB' }] }, role: 'superadmin' });
    await screen.findAllByText('Acme');

    // no name → refused, nothing saved
    await user.click(screen.getByRole('button', { name: /Add Customer/ }));
    expect(await screen.findByText(/Customer name is required/)).toBeInTheDocument();
    expect(saved.some((s) => s.id === 4)).toBe(false);

    await user.type(screen.getByLabelText('Customer form Customer'), 'Bharat Foods');
    await user.type(screen.getByLabelText('Customer form GSTIN'), '29ZZ');
    await user.click(screen.getByRole('button', { name: /Add Customer/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 4)).toBe(true));
    const data = saved.find((s) => s.id === 4).data;
    expect(data).toHaveLength(2);
    expect(data[1]).toMatchObject({ customer: 'Bharat Foods', gstin: '29ZZ' });
  });
});
