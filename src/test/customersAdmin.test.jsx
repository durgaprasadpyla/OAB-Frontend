import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import CustomersAdmin from '../components/CustomersAdmin.jsx';

describe('Customers admin', () => {
  it('edits the customer master and saves it to module 4', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<CustomersAdmin />, {
      modules: { customers: [{ customer: 'Acme', dispatchLoc: 'Hyderabad', gstin: '36AB', contactPerson: '', state: 'Telangana' }] },
      role: 'superadmin',
    });
    await screen.findByDisplayValue('Acme');

    const gstin = screen.getByDisplayValue('36AB');
    await user.clear(gstin);
    await user.type(gstin, '36XYZ9');

    await user.click(screen.getByRole('button', { name: /Save Customers/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 4)).toBe(true));
    const cust = saved.find((s) => s.id === 4).data;
    expect(cust).toHaveLength(1);
    expect(cust[0]).toMatchObject({ customer: 'Acme', gstin: '36XYZ9', state: 'Telangana' });
  });

  it('drops rows with no customer name on save', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<CustomersAdmin />, { modules: { customers: [{ customer: 'Acme', gstin: '36AB' }] }, role: 'superadmin' });
    await screen.findByDisplayValue('Acme');

    await user.click(screen.getByRole('button', { name: /Add Row/ }));   // adds a blank row (no customer)
    await user.click(screen.getByRole('button', { name: /Save Customers/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 4)).toBe(true));
    expect(saved.find((s) => s.id === 4).data).toHaveLength(1);   // blank row dropped
  });
});
