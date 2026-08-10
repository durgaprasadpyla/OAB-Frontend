import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from './harness.jsx';
import { useData } from '../data.jsx';

// The frontend half of per-module read authorization. The SPA loads every module
// blob on sign-in regardless of role, so the backend now answers 403 for a module
// the role may not read. loadOne() must swallow that 403 (boot with the module
// empty) while still surfacing any genuine load failure. This probe exposes the
// DataProvider's boot state so we can assert both behaviours.
function BootProbe() {
  const { loading, error } = useData();
  if (loading) return <div>state:loading</div>;
  return <div>{error ? 'state:error' : 'state:ready'}</div>;
}

describe('read authz — SPA boot tolerates forbidden modules', () => {
  it('swallows a 403 on forbidden modules and loads the rest (no error)', async () => {
    renderApp(<BootProbe />, {
      modules: { oab: { OAB: { SF: [], OT: [] } }, prices: { A1: { price: 1 } }, customers: [] },
      role: 'plant',
      forbidRead: { 3: true, 4: true },   // plant is refused prices (3) + customers (4)
    });
    // If loadOne rethrew the 403, the provider would flip to state:error.
    await screen.findByText('state:ready');
    expect(screen.getByText('state:ready')).toBeTruthy();
  });

  it('still surfaces a genuine (non-403) load failure', async () => {
    renderApp(<BootProbe />, {
      modules: { oab: { OAB: { SF: [], OT: [] } } },
      failRead: { 1: true },   // a 500 on a module must NOT be swallowed
    });
    await screen.findByText('state:error');
    expect(screen.getByText('state:error')).toBeTruthy();
  });
});
