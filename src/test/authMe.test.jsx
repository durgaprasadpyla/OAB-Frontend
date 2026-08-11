import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderApp } from './harness.jsx';
import { useAuth } from '../auth.jsx';

// Slice 3: on load the app validates the stored token via /api/auth/me and takes the
// server's role as authoritative (localStorage can be stale or tampered).
function AuthProbe() {
  const { role, isAuthed } = useAuth();
  return <div>{isAuthed ? `authed:${role}` : 'anon'}</div>;
}

describe('session validation on load (/api/auth/me)', () => {
  it('corrects a stale/tampered localStorage role to the server role', async () => {
    // localStorage claims superadmin, but /me says user → the UI must settle on user.
    renderApp(<AuthProbe />, { role: 'superadmin', meRole: 'user' });
    await screen.findByText('authed:user');
    expect(screen.getByText('authed:user')).toBeTruthy();
  });

  it('logs out when the stored token is invalid/expired (401 from /me)', async () => {
    renderApp(<AuthProbe />, { role: 'user', meUnauthorized: true });
    await waitFor(() => expect(screen.getByText('anon')).toBeTruthy());
  });
});
