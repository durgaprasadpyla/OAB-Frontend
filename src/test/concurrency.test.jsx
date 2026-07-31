import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, installFetch } from './harness.jsx';
import { useData } from '../data.jsx';
import { allocateNumber } from '../api.js';

/** Minimal probe that surfaces the data-context internals we want to assert. */
function Probe() {
  const { mods, versions, conflict, save } = useData();
  return (
    <div>
      <div data-testid="buyer">{mods.scrap?.buyers?.[0]?.name || ''}</div>
      <div data-testid="version">{versions.scrap ?? ''}</div>
      <div data-testid="conflict">{conflict ? conflict.key : ''}</div>
      <button onClick={() => save('scrap', { buyers: [{ id: 'SB001', name: 'Mine' }] }).catch(() => {})}>save</button>
    </div>
  );
}

describe('optimistic concurrency (data context)', () => {
  it('sends the loaded version on save and advances it on success', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<Probe />, { modules: { scrap: { buyers: [{ id: 'SB001', name: 'Orig' }] } }, role: 'scrap' });
    await waitFor(() => expect(screen.getByTestId('version').textContent).toBe('1')); // loaded at version 1

    await user.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(saved.some((s) => s.id === 8)).toBe(true));
    const rec = saved.find((s) => s.id === 8);
    expect(rec.sentVersion).toBe(1);                                   // client echoed the version it read
    await waitFor(() => expect(screen.getByTestId('version').textContent).toBe('2')); // advanced from the response
    expect(screen.getByTestId('conflict').textContent).toBe('');
  });

  it('on a 409 it reloads the module and flags a conflict WITHOUT logging out', async () => {
    const user = userEvent.setup();
    let loggedOut = false;
    const onExpired = () => { loggedOut = true; };
    window.addEventListener('auth:expired', onExpired);
    try {
      const { saved } = renderApp(<Probe />, {
        modules: { scrap: { buyers: [{ id: 'SB001', name: 'Orig' }] } },
        role: 'scrap',
        conflictOnce: { 8: true },     // the next save to module 8 gets a 409
      });
      await waitFor(() => expect(screen.getByTestId('version').textContent).toBe('1'));

      await user.click(screen.getByRole('button', { name: 'save' }));

      // conflict surfaced, module reloaded to server truth, version refreshed
      await waitFor(() => expect(screen.getByTestId('conflict').textContent).toBe('scrap'));
      expect(screen.getByTestId('buyer').textContent).toBe('Orig');   // the losing edit was NOT persisted
      expect(screen.getByTestId('version').textContent).toBe('2');    // reloaded to the newer version
      expect(saved.some((s) => s.id === 8)).toBe(false);              // nothing was written
      expect(loggedOut).toBe(false);                                  // 409 is recoverable, never a logout
      expect(localStorage.getItem('blm_token')).toBe('t');            // token intact
    } finally {
      window.removeEventListener('auth:expired', onExpired);
    }
  });
});

describe('server-owned document numbers', () => {
  it('allocateNumber() calls /api/seq and returns the formatted number', async () => {
    localStorage.setItem('blm_token', 't');
    installFetch({});
    expect(await allocateNumber('INV')).toBe('BL/26-27/223');
    expect(await allocateNumber('SO')).toBe('26/401');
  });
});
