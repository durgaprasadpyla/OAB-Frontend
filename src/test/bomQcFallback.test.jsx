import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// QC login regression (30-08): the BOM editor's Material Type / Sub-Group /
// Description dropdowns were empty for QC because the catalogue came only from
// the purchase blob (module 6), which the qc role may not read. With the blob
// unavailable the panel now falls back to the normalized item master
// (/api/master/items), which every signed-in role can read.

vi.mock('../data.jsx', () => ({
  useData: () => ({
    mods: {
      bom: {},
      purchase: {},   // what QC actually sees: the 403'd module stays empty
      jss: [{ spec: 'A1', customer: 'Acme', jobName: 'Pouch A', dispatchForm: 'Pouch' }],
    },
    save: vi.fn(),
  }),
}));
vi.mock('../auth.jsx', () => ({ useAuth: () => ({ user: 'qc1', role: 'qc' }) }));

import BomPanel from '../components/BomPanel.jsx';

function res(body) {
  return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).includes('/api/master/items')) {
      return res([
        { id: 1, code: 'FILM-1', name: 'BOPP Plain Film', materialType: 'BOPP', subGroup: 'Films', microns: '20', uom: 'kg' },
        { id: 2, code: 'INK-1', name: 'Cyan Ink', materialType: 'Ink', subGroup: 'Chem', microns: '', uom: 'kg' },
      ]);
    }
    return res({});
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('BOM editor — QC fallback catalogue', () => {
  it('fills the dropdowns from the normalized item master when the purchase blob is unreadable', async () => {
    render(<BomPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit BOM for A1' }));

    // Material Type offers the master's types, not just "Any"
    const mat = await screen.findByLabelText('Material Type row 1');
    await waitFor(() => expect(within(mat).queryByRole('option', { name: 'BOPP' })).toBeTruthy());
    expect(within(mat).getByRole('option', { name: 'Ink' })).toBeTruthy();

    // narrowing by type flows into Sub-Group and Description
    fireEvent.change(mat, { target: { value: 'BOPP' } });
    expect(within(screen.getByLabelText('Sub Group row 1')).getByRole('option', { name: 'Films' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Description row 1'), { target: { value: 'BOPP Plain Film' } });
    // picking the description auto-fills code / microns / uom from the master
    expect(screen.getByLabelText('Item Code row 1')).toHaveValue('FILM-1');
    expect(screen.getByLabelText('Microns row 1')).toHaveValue('20');
    expect(screen.getByLabelText('UOM row 1')).toHaveValue('kg');
  });
});
