import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderApp, oabModule } from './harness.jsx';
import Dashboard from '../pages/Dashboard.jsx';

// Superadmin Dashboard gains three newly-integrated endpoints:
//   /api/audit (audit-log viewer), /api/summary (server rollups), /api/admin/resync.
const seed = {
  oab: oabModule({ SF: [{ so: '26/1', spec: 'A1', customer: 'Acme', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-07-01' }] }),
  prices: { A1: { price: 75, costPrice: 60 } },
  jss: [{ spec: 'A1', customer: 'Acme' }],
  customers: [],
};

afterEach(() => { vi.restoreAllMocks(); });

describe('Dashboard — newly integrated superadmin APIs', () => {
  it('Audit Log tab loads /api/audit and lists entries', async () => {
    renderApp(<Dashboard />, { modules: seed, role: 'superadmin' });
    fireEvent.click(await screen.findByText('🧾 Audit Log'));
    await screen.findByText('BL/26-27/1');                 // entity id served by /api/audit
    expect(screen.getByText(/who did what/i)).toBeTruthy();
  });

  it('System tab shows /api/summary rollups and runs a resync', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);      // auto-confirm the resync dialog
    renderApp(<Dashboard />, { modules: seed, role: 'superadmin' });
    fireEvent.click(await screen.findByText('🛠 System'));
    await screen.findByText('Open SOs');                    // a /api/summary KPI label
    fireEvent.click(screen.getByText(/Rebuild read model/i));
    await screen.findByText(/Resynced 8 module/i);          // /api/admin/resync result
  });
});
