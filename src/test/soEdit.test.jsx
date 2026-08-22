import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderApp, oabModule } from './harness.jsx';
import Dashboard from '../pages/Dashboard.jsx';

// Client requirement: the "Delete SOs" admin screen must let you correct a Sale
// Order's Spec No. (previously it only edited PO#, PO date and dispatch location).
const seed = {
  oab: oabModule({
    SF: [{ so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', poNum: 'PO-1', poDate: '2026-07-01', dispLoc: 'Hyderabad', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, closed: false }],
  }),
  jss: [{ spec: 'A1' }, { spec: 'A2' }],
  prices: {},
  customers: [],
};

afterEach(() => { vi.restoreAllMocks(); });

describe('Delete SOs — Edit SO edits the Spec No.', () => {
  it('edits the spec number (and PO fields) and persists the new spec', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('A2')          // new Spec No.
      .mockReturnValueOnce('PO-2')        // new PO number
      .mockReturnValueOnce('2026-08-01')  // new PO date
      .mockReturnValueOnce('Mumbai');     // new dispatch location
    const { saved } = renderApp(<Dashboard />, { modules: seed, role: 'superadmin' });

    fireEvent.click(await screen.findByText('🗑 Delete SOs'));
    fireEvent.click(await screen.findByText('✎ Edit SO'));

    await waitFor(() => {
      const oabSave = [...saved].reverse().find((s) => s.key === 'oab');
      expect(oabSave).toBeTruthy();
      const row = oabSave.data.OAB.SF.find((r) => r.so === '26/1');
      expect(row.spec).toBe('A2');       // the spec was actually changed and saved
      expect(row.poNum).toBe('PO-2');    // sibling fields still edited as before
      expect(row.dispLoc).toBe('Mumbai');
    });
  });

  it('warns when the new spec has no JSS entry, and cancelling aborts without saving', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false); // user cancels the warning
    vi.spyOn(window, 'prompt').mockReturnValueOnce('ZZZ-not-in-jss');
    const { saved } = renderApp(<Dashboard />, { modules: seed, role: 'superadmin' });

    fireEvent.click(await screen.findByText('🗑 Delete SOs'));
    fireEvent.click(await screen.findByText('✎ Edit SO'));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(saved.some((s) => s.key === 'oab')).toBe(false); // aborted before persisting
  });
});
