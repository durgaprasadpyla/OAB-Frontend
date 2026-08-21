import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import Login from '../pages/Login.jsx';

const REMEMBER_KEY = 'blm_remember_user';

function res(status, body) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider><Login /></AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = async (url) => (String(url).includes('/api/auth/login')
    ? res(200, { token: 't', username: 'superstar', role: 'superadmin' })
    : res(200, {}));
});

describe('Login — enterprise sign-in', () => {
  it('shows the brand panel copy from production', () => {
    mount();
    expect(screen.getByText('Sign in to Bloomflex')).toBeInTheDocument();
    expect(screen.getByText(/Order & Production Management/)).toBeInTheDocument();
    expect(screen.getByText('Real-time order & production tracking')).toBeInTheDocument();
    expect(screen.getByText('GST invoicing & packing lists')).toBeInTheDocument();
    expect(screen.getByText('Role-based access & full audit trail')).toBeInTheDocument();
    expect(screen.getByText('Secure enterprise sign-in')).toBeInTheDocument();
  });

  it('carries the Bloomflex mark on both panels', () => {
    mount();
    const logos = screen.getAllByAltText('Bloomflex');
    expect(logos).toHaveLength(2);          // brand panel + the narrow-screen form header
    expect(logos[0].getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('toggles password visibility', async () => {
    mount();
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByLabelText('Show password'));
    expect(pw).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByLabelText('Hide password'));
    expect(pw).toHaveAttribute('type', 'password');
  });

  it('keeps the sign-in button disabled until both fields are filled', async () => {
    mount();
    const btn = screen.getByRole('button', { name: /Sign In/i });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Username'), 'superstar');
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    expect(btn).toBeEnabled();
  });

  it('remembers the USERNAME only — never the password', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Username'), 'superstar');
    await userEvent.type(screen.getByLabelText('Password'), 'secret123');
    await userEvent.click(screen.getByLabelText('Remember me'));
    await userEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    expect(localStorage.getItem(REMEMBER_KEY)).toBe('superstar');
    // The password must not appear anywhere in local storage.
    const dump = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('|');
    expect(dump).not.toContain('secret123');
  });

  it('prefills a remembered username and clears it when unticked', async () => {
    localStorage.setItem(REMEMBER_KEY, 'olduser');
    const { unmount } = mount();
    expect(screen.getByLabelText('Username')).toHaveValue('olduser');
    expect(screen.getByLabelText('Remember me')).toBeChecked();

    await userEvent.click(screen.getByLabelText('Remember me'));
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    expect(localStorage.getItem(REMEMBER_KEY)).toBeNull();
    unmount();
  });

  it('reports a bad password as an error', async () => {
    globalThis.fetch = async () => res(401, { error: 'nope' });
    mount();
    await userEvent.type(screen.getByLabelText('Username'), 'x');
    await userEvent.type(screen.getByLabelText('Password'), 'y');
    await userEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    const msg = await screen.findByText('Invalid username or password');
    expect(msg.closest('.blm-msg')).not.toHaveClass('blm-msg-info');
  });

  it('explains that a reset is an admin action, as information not an error', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Forgot password/i }));
    const msg = screen.getByText(/reset by an administrator/);
    expect(msg.closest('.blm-msg')).toHaveClass('blm-msg-info');
  });
});
