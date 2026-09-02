import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';

// Legacy BOM list: a Group column sits right after Spec, resolved from the master
// data — the spec's own group, else the group its customer belongs to in the
// Customer Master (specGroup).

vi.mock('../data.jsx', () => ({
  useData: () => ({
    mods: {
      bom: {},
      purchase: {},
      jss: [
        { spec: 'A1', customer: 'Acme', jobName: 'Pouch A', dispatchForm: 'Pouch', group: 'North Group' },
        { spec: 'B2', customer: 'Wood Pecker', jobName: 'Label B', dispatchForm: 'Label' },   // group via customer master
        { spec: 'C3', customer: 'Loner Ltd', jobName: 'Roll C', dispatchForm: 'Roll' },       // no group anywhere
      ],
      customers: [{ customer: 'Wood Pecker', group: 'Beverages' }, { customer: 'Loner Ltd', group: '' }],
    },
    save: vi.fn(),
  }),
}));
vi.mock('../auth.jsx', () => ({ useAuth: () => ({ user: 'qc1', role: 'qc' }) }));

import BomPanel from '../components/BomPanel.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('BOM list — Group column from master data', () => {
  it('shows the spec group, the customer-master group, or a dash', async () => {
    globalThis.fetch = vi.fn(async () => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => [], text: async () => '[]' }));
    render(<BomPanel />);
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads[0]).toBe('Spec');
    expect(heads[1]).toBe('Group');

    const rowOf = (spec) => screen.getByText(spec).closest('tr');
    expect(rowOf('A1').cells[1].textContent).toBe('North Group');   // spec's own group
    expect(rowOf('B2').cells[1].textContent).toBe('Beverages');     // from the Customer Master
    expect(rowOf('C3').cells[1].textContent).toBe('-');             // none anywhere
  });
});

// The client saved a BOM in QC -> Route and BOM and the Super Admin's BOM tab
// showed nothing: the two screens read different stores. The tab now layers the
// planning store (what QC writes) over its own module.
describe('BOM list — shows the recipes QC saved', () => {
  it('marks a spec as defined when the planning store has its lines', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      const ok = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
      if (u.endsWith('/api/bom')) {
        return ok([{
          specCode: 'A1', baseQty: 10000, baseUom: 'Pouches', savedBy: 'qc', savedAt: '2026-09-01T14:18:41Z',
          items: [{ itemId: 5, itemCode: 'BLM306', itemName: '700', materialType: 'BOPP', subGroup: 'Films',
                    microns: '51', departmentId: 1, departmentName: 'Printing', qtyPerBase: 79.19, uom: 'KG' }],
        }]);
      }
      return ok([]);
    });
    render(<BomPanel />);
    // the spec that only exists in the planning store is reported as defined
    const row = (await screen.findByText('A1')).closest('tr');
    await waitFor(() => expect(within(row).getByText('defined')).toBeInTheDocument());
  });
});
