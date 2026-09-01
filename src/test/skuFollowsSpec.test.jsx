import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import OabBoard from '../pages/OabBoard.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import PM from '../pages/PM.jsx';
import { dispatchRows } from '../pages/DispatchBySO.jsx';

// Regression for the client-escalated bug (SOs 616/613/625): a superadmin repointed a
// row's spec 1362 → 1335, but the SKU (job name) kept 1362's value on the OAB page and
// the Delete SOs page. Root cause: jobName is a copy stored on the row at SO creation and
// was NOT re-derived from the current spec (customer/sub-brand already were). The row here
// models that state — spec is already 1335, the stored jobName is still the old 1362 name.
const jss = [
  { spec: '1335', jobName: 'FRESH SKU 1335', customer: 'Acme', subBrand: 'Zing', material: 'BOPP', dispatchForm: 'Pouch', status: 'Active' },
];
const staleRow = { so: '26/616', spec: '1335', jobName: 'STALE SKU 1362', customer: 'Old Co', subBrand: 'OldBrand', dispatchForm: 'Pouch', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, poDate: '2026-08-01' };
// A row whose spec has no JSS entry must keep its stored SKU (the `|| r.jobName` fallback),
// so we never blank out orphan-spec rows.
const orphanRow = { so: '26/617', spec: 'Z9', jobName: 'Orphan SKU', customer: 'Beta', dispatchForm: 'Pouch', poQty: 500, invDisp: 0, manDisp: 0, fg: 0, poDate: '2026-08-01' };

describe('SKU name follows the current spec (stale-SKU-after-spec-change fix)', () => {
  it('OAB board shows the current spec\'s SKU, not the stored copy; keeps the stored SKU when the spec is unknown', async () => {
    renderApp(<OabBoard />, { modules: { oab: oabModule({ SF: [staleRow, orphanRow] }), jss }, route: '/oab?sheet=SF' });

    expect(await screen.findByText('FRESH SKU 1335')).toBeInTheDocument();   // derived from spec 1335
    expect(screen.queryByText('STALE SKU 1362')).not.toBeInTheDocument();    // stale copy gone
    expect(screen.getByText('Orphan SKU')).toBeInTheDocument();              // spec Z9 not in JSS → fallback
  });

  it('Delete SOs page shows the current spec\'s SKU', async () => {
    const user = userEvent.setup();
    renderApp(<Dashboard />, { modules: { oab: oabModule({ SF: [staleRow] }), jss, customers: [{ customer: 'Acme' }] }, role: 'superadmin' });

    await user.click(screen.getByText('✏ Edit SOs'));
    expect(await screen.findByText('FRESH SKU 1335')).toBeInTheDocument();
    expect(screen.queryByText('STALE SKU 1362')).not.toBeInTheDocument();
  });

  it('Saving the JSS Editor writes the current SKU back onto OAB rows sharing the spec', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<Dashboard />, { modules: { oab: oabModule({ SF: [staleRow] }), jss, customers: [{ customer: 'Acme' }] }, role: 'superadmin' });

    await user.click(screen.getByText('📋 JSS Editor'));
    await user.click(await screen.findByRole('button', { name: /Save All Changes/ }));

    // saveAll persists JSS (id 2) then, because a row's jobName differs, the OAB blob (id 1).
    await waitFor(() => expect(saved.some((s) => s.id === 1)).toBe(true));
    const oabWrite = [...saved].reverse().find((s) => s.id === 1);
    expect(oabWrite.data.OAB.SF[0].jobName).toBe('FRESH SKU 1335');
  });

  it('Delete SOs → Edit Spec repoints an SO and pulls the new spec\'s SKU/customer', async () => {
    const user = userEvent.setup();
    // Row is on the now-inactive spec 1362 (absent from the JSS master); we repoint it to 1335.
    const reassignRow = { so: '26/900', spec: '1362', jobName: 'Old 1362 SKU', customer: 'Old Co', dispatchForm: 'Pouch', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, poDate: '2026-08-01' };
    const { saved } = renderApp(<Dashboard />, { modules: { oab: oabModule({ SF: [reassignRow] }), jss, customers: [{ customer: 'Acme' }] }, role: 'superadmin' });

    await user.click(screen.getByText('✏ Edit SOs'));
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('1335');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(await screen.findByRole('button', { name: /Edit Spec/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 1)).toBe(true));
    const savedRow = [...saved].reverse().find((s) => s.id === 1).data.OAB.SF[0];
    expect(savedRow.spec).toBe('1335');
    expect(savedRow.jobName).toBe('FRESH SKU 1335');   // SKU followed the new spec
    expect(savedRow.customer).toBe('Acme');            // customer followed too
    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it('Edit Spec rejects a spec that is not in the JSS master (no write)', async () => {
    const user = userEvent.setup();
    const reassignRow = { so: '26/901', spec: '1362', jobName: 'Old 1362 SKU', customer: 'Old Co', dispatchForm: 'Pouch', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, poDate: '2026-08-01' };
    const { saved } = renderApp(<Dashboard />, { modules: { oab: oabModule({ SF: [reassignRow] }), jss, customers: [{ customer: 'Acme' }] }, role: 'superadmin' });

    await user.click(screen.getByText('✏ Edit SOs'));
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('9999');   // not in JSS
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await user.click(await screen.findByRole('button', { name: /Edit Spec/ }));

    expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/Unknown spec/));
    expect(saved.some((s) => s.id === 1)).toBe(false);   // nothing persisted
    promptSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('Production (PM) shows the current spec\'s SKU, not the stored copy', async () => {
    renderApp(<PM />, { modules: { oab: oabModule({ SF: [staleRow] }), jss }, role: 'production' });

    expect(await screen.findByText('FRESH SKU 1335')).toBeInTheDocument();
    expect(screen.queryByText('STALE SKU 1362')).not.toBeInTheDocument();
  });

  it('Dispatch by SO (dispatchRows) derives the SKU from the spec when JSS is supplied', () => {
    const oab = { SF: [staleRow], OT: [] };
    expect(dispatchRows(oab, new Date('2026-08-20'), jss)[0].jobName).toBe('FRESH SKU 1335');
    // Backward-compatible: no JSS argument → the stored name is returned unchanged.
    expect(dispatchRows(oab, new Date('2026-08-20'))[0].jobName).toBe('STALE SKU 1362');
  });
});
