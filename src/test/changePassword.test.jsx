import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import App from '../App.jsx';

// The backend flags an account `mustChangePassword` after a first login or an
// admin reset. Until it is cleared the app must not be usable at all.

const fill = async (cur, next, confirm) => {
  await userEvent.type(screen.getByLabelText('Current password'), cur);
  await userEvent.type(screen.getByLabelText('New password'), next);
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm);
  await userEvent.click(screen.getByText(/Update password/));
};

describe('forced password change', () => {
  it('blocks the whole authed area until the password is changed', async () => {
    renderApp(<App />, { role: 'superadmin', route: '/po', mustChangePassword: true });
    await waitFor(() => expect(screen.getByText(/Choose a new password/)).toBeInTheDocument());
    // The operations workspace must not be reachable behind it.
    expect(screen.queryByText('New PO')).not.toBeInTheDocument();
  });

  it('does not appear for an account that is not flagged', async () => {
    renderApp(<App />, { role: 'superadmin', route: '/po', mustChangePassword: false });
    await waitFor(() => expect(screen.queryByText(/Choose a new password/)).not.toBeInTheDocument());
  });

  it('rejects a short password without calling the server', async () => {
    const { saved } = renderApp(<App />, { role: 'user', route: '/po', mustChangePassword: true });
    await waitFor(() => expect(screen.getByText(/Choose a new password/)).toBeInTheDocument());
    await fill('old-pass', 'short', 'short');
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    expect(saved.some((s) => s.endpoint === '/api/auth/change-password')).toBe(false);
  });

  it('rejects a mismatched confirmation without calling the server', async () => {
    const { saved } = renderApp(<App />, { role: 'user', route: '/po', mustChangePassword: true });
    await waitFor(() => expect(screen.getByText(/Choose a new password/)).toBeInTheDocument());
    await fill('old-pass', 'brand-new-pass', 'brand-new-pazz');
    expect(screen.getByRole('alert')).toHaveTextContent(/do not match/i);
    expect(saved.some((s) => s.endpoint === '/api/auth/change-password')).toBe(false);
  });

  it('rejects reusing the current password', async () => {
    renderApp(<App />, { role: 'user', route: '/po', mustChangePassword: true });
    await waitFor(() => expect(screen.getByText(/Choose a new password/)).toBeInTheDocument());
    await fill('same-password', 'same-password', 'same-password');
    expect(screen.getByRole('alert')).toHaveTextContent(/must be different/i);
  });

  it('submits a valid change and releases the app', async () => {
    const { saved } = renderApp(<App />, { role: 'user', route: '/po', mustChangePassword: true });
    await waitFor(() => expect(screen.getByText(/Choose a new password/)).toBeInTheDocument());
    await fill('old-pass', 'brand-new-pass', 'brand-new-pass');

    await waitFor(() => expect(screen.queryByText(/Choose a new password/)).not.toBeInTheDocument());
    const call = saved.find((s) => s.endpoint === '/api/auth/change-password');
    expect(call.body).toEqual({ currentPassword: 'old-pass', newPassword: 'brand-new-pass' });
  });

  it('keeps the gate up and shows the reason when the server refuses', async () => {
    renderApp(<App />, { role: 'user', route: '/po', mustChangePassword: true });
    await waitFor(() => expect(screen.getByText(/Choose a new password/)).toBeInTheDocument());
    await fill('wrong', 'brand-new-pass', 'brand-new-pass');   // harness 400s on 'wrong'

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/incorrect/i));
    expect(screen.getByText(/Choose a new password/)).toBeInTheDocument();
  });
});
