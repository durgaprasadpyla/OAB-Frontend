import { describe, it, expect, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
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

/* ── Issues 30.09 F1: a re-read must never land on top of a save that crossed it ── */
let lastRead = null;
function RaceProbe() {
  const { mods, versions, save, reloadModule } = useData();
  const add = (name) => (prev) => ({ ...prev, buyers: [...((prev && prev.buyers) || []), { id: 'SB-' + name, name }] });
  return (
    <div>
      <div data-testid="names">{(mods.scrap?.buyers || []).map((b) => b.name).join(',')}</div>
      <div data-testid="version">{versions.scrap ?? ''}</div>
      <button onClick={() => save('scrap', add('A')).catch(() => {})}>saveA</button>
      <button onClick={() => save('scrap', add('B')).catch(() => {})}>saveB</button>
      <button onClick={() => { lastRead = reloadModule('scrap'); }}>reread</button>
    </div>
  );
}

describe('reloadModule vs an in-flight save (data context)', () => {
  const isWrite = (url, opts = {}) => String(url).includes('/rest/v1/oab_data') && String(opts.method || 'GET').toUpperCase() === 'POST';
  const isScrapRead = (url, opts = {}) => String(url).includes('/rest/v1/oab_data?id=eq.8') && String(opts.method || 'GET').toUpperCase() === 'GET';
  const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
  let orig;
  afterEach(() => { if (orig) globalThis.fetch = orig; orig = null; lastRead = null; });

  it('drops a read that starts AND lands while the save is on the wire, so the next save builds on the first', async () => {
    const { saved } = renderApp(<RaceProbe />, { modules: { scrap: { buyers: [{ id: 'SB001', name: 'Orig' }] } }, role: 'scrap' });
    await waitFor(() => expect(screen.getByTestId('version').textContent).toBe('1'));
    orig = globalThis.fetch;
    const g = gate();
    let reads = 0;
    globalThis.fetch = async (url, opts = {}) => {
      if (isWrite(url, opts)) await g.p;              // the write waits on the wire
      if (isScrapRead(url, opts)) reads += 1;
      return orig(url, opts);
    };
    fireEvent.click(screen.getByText('saveA'));
    expect(screen.getByTestId('names').textContent).toBe('Orig,A');
    // a re-read (a tab change) that starts and lands while the save is still in flight
    fireEvent.click(screen.getByText('reread'));
    await act(async () => { await lastRead; });
    expect(reads).toBe(1);
    // the pre-save server copy is NOT put back, nor its version
    expect(screen.getByTestId('names').textContent).toBe('Orig,A');
    expect(screen.getByTestId('version').textContent).toBe('1');
    await act(async () => { g.open(); });
    await waitFor(() => expect(screen.getByTestId('version').textContent).toBe('2'));
    expect(screen.getByTestId('names').textContent).toBe('Orig,A');
    // the dropped read is made again, once, after the save has landed
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByTestId('names').textContent).toBe('Orig,A');
    // the next functional save starts from the first one's result: no lost update
    fireEvent.click(screen.getByText('saveB'));
    await waitFor(() => expect(saved.filter((s) => s.id === 8)).toHaveLength(2));
    const last = saved.filter((s) => s.id === 8)[1];
    expect(last.data.buyers.map((b) => b.name)).toEqual(['Orig', 'A', 'B']);
    expect(last.sentVersion).toBe(2);
  });

  it('a save that fails after a read was dropped shows the server copy, read afresh', async () => {
    const { mods } = renderApp(<RaceProbe />, { modules: { scrap: { buyers: [{ id: 'SB001', name: 'Orig' }] } }, role: 'scrap' });
    await waitFor(() => expect(screen.getByTestId('version').textContent).toBe('1'));
    orig = globalThis.fetch;
    const g = gate();
    globalThis.fetch = async (url, opts = {}) => {
      if (isWrite(url, opts)) {
        await g.p;
        return { status: 500, ok: false, headers: { get: () => 'text/plain' }, text: async () => 'boom', json: async () => ({}) };
      }
      return orig(url, opts);
    };
    fireEvent.click(screen.getByText('saveA'));
    // someone else's change reaches the server meanwhile; this read sees it but is dropped
    mods.scrap.buyers.push({ id: 'SB009', name: 'Theirs' });
    fireEvent.click(screen.getByText('reread'));
    await act(async () => { await lastRead; });
    expect(screen.getByTestId('names').textContent).toBe('Orig,A');
    await act(async () => { g.open(); });
    // rolled back, then read again: the server's copy, not the stale pre-save one
    await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('Orig,Theirs'));
  });

  it('a read begun before a save and landing after it is made once more', async () => {
    renderApp(<RaceProbe />, { modules: { scrap: { buyers: [{ id: 'SB001', name: 'Orig' }] } }, role: 'scrap' });
    await waitFor(() => expect(screen.getByTestId('version').textContent).toBe('1'));
    orig = globalThis.fetch;
    const g = gate();
    let reads = 0;
    globalThis.fetch = async (url, opts = {}) => {
      if (isScrapRead(url, opts)) {
        reads += 1;
        const r = orig(url, opts);                    // answered from the pre-save copy…
        if (reads === 1) await g.p;                   // …but lands only after the save
        return r;
      }
      return orig(url, opts);
    };
    fireEvent.click(screen.getByText('reread'));
    const first = lastRead;
    fireEvent.click(screen.getByText('saveA'));
    await waitFor(() => expect(screen.getByTestId('version').textContent).toBe('2'));
    await act(async () => { g.open(); });
    let value;
    await act(async () => { value = await first; });
    expect(reads).toBe(2);
    expect(value.buyers.map((b) => b.name)).toEqual(['Orig', 'A']);
    expect(screen.getByTestId('names').textContent).toBe('Orig,A');
    expect(screen.getByTestId('version').textContent).toBe('2');
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
