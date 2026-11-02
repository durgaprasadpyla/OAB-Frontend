// Issues 02.11 — QC Route and BOM with a double-lamination route: "when I select
// lamination 1 in the checkbox selection, against the first lamination it is
// automatically selecting the lamination 1 option for the second lamination also …
// whatever I'm adding for lamination 1, it is automatically getting added to
// lamination 2". Each pass of the route is its own selection now.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

vi.mock('../data.jsx', () => ({
  useData: () => ({ mods: { jss: [{ spec: 'A9', jobName: 'Metpet laminate', customer: 'Acme', dispatchForm: 'Roll' }] } }),
}));

import JssPlanningPanel from '../components/JssPlanningPanel.jsx';

let saved;
function installFetch({ machines = [], bom = [] } = {}) {
  saved = { machines: null, bom: null };
  let jm = machines;
  let lines = bom;
  const stages = [
    { seq: 1, departmentId: 1, departmentName: 'Printing' },
    { seq: 2, departmentId: 2, departmentName: 'Lamination' },
    { seq: 3, departmentId: 2, departmentName: 'Lamination' },
  ];
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url); const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.includes('/api/master/items/sync-from-purchase')) return res({});
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing' }, { id: 2, name: 'Lamination' }]);
    if (u.includes('/api/master/machines')) return res([
      { id: 10, code: 'CI', name: 'CI Flexo', departmentId: 1, departmentName: 'Printing' },
      { id: 21, code: 'LAM1', name: 'Lamination 1', departmentId: 2, departmentName: 'Lamination' },
      { id: 22, code: 'LAM2', name: 'Lamination 2', departmentId: 2, departmentName: 'Lamination' },
    ]);
    if (u.includes('/api/master/dispatch-types')) return res([{ id: 100, name: 'Roll' }]);
    if (u.includes('/api/master/routes')) return res([{ id: 300, name: 'Double lamination', dispatchTypeId: 100, stages }]);
    if (u.includes('/api/master/items')) return res([
      { id: 501, code: 'BLM1', name: 'MET PET 12', departmentId: 2, uom: 'Kg', materialType: 'FILM', subGroup: 'MET PET' },
      { id: 502, code: 'BLM2', name: 'LDPE 50', departmentId: 2, uom: 'Kg', materialType: 'FILM', subGroup: 'LDPE' },
    ]);
    if (u.match(/\/api\/jss\/A9\/machines$/) && method === 'PUT') {
      saved.machines = body.machines;
      jm = body.machines.map((m) => ({ ...m, eligible: true }));
      return res(jm);
    }
    if (u.match(/\/api\/jss\/A9$/)) return res({
      specCode: 'A9', config: { specCode: 'A9', dispatchTypeId: 100, routeId: 300, routeName: 'Double lamination' },
      routeDepartments: stages, machines: jm,
    });
    if (u.match(/\/api\/bom\/A9$/) && method === 'PUT') { saved.bom = body.items; lines = body.items; return res({ ok: true }); }
    if (u.match(/\/api\/bom\/A9$/)) return res({ specCode: 'A9', baseQty: 1, baseUom: 'Mtrs', items: lines });
    return res({});
  });
}

async function openSpec() {
  render(<JssPlanningPanel />);
  await waitFor(() => expect(screen.getByLabelText('JSS Spec')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('JSS Spec'), { target: { value: 'A9' } });
  await screen.findByLabelText('Machines for 2. Lamination 1');
}

describe('Route and BOM — double lamination', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  describe('machines', () => {
    beforeEach(() => installFetch());

    it('names the two passes Lamination 1 and Lamination 2, and ticks a machine for one pass only', async () => {
      await openSpec();
      const first = screen.getByLabelText('Machines for 2. Lamination 1');
      const second = screen.getByLabelText('Machines for 3. Lamination 2');
      fireEvent.click(within(first).getByLabelText('Use Lamination 1 for Lamination 1'));
      expect(within(first).getByLabelText('Use Lamination 1 for Lamination 1')).toBeChecked();
      expect(within(second).getByLabelText('Use Lamination 1 for Lamination 2')).not.toBeChecked();
      fireEvent.click(within(second).getByLabelText('Use Lamination 2 for Lamination 2'));

      fireEvent.click(screen.getByText('Save machines'));
      await waitFor(() => expect(saved.machines).toBeTruthy());
      const bySeq = Object.fromEntries(saved.machines.map((m) => [m.stageSeq, m.machineId]));
      expect(saved.machines).toHaveLength(2);
      expect(bySeq).toEqual({ 2: 21, 3: 22 });
    });
  });

  describe('BOM', () => {
    beforeEach(() => installFetch({
      machines: [{ departmentId: 2, machineId: 21, stageSeq: 2, eligible: true }, { departmentId: 2, machineId: 22, stageSeq: 3, eligible: true }],
    }));

    it('an item added under Lamination 1 stays under Lamination 1, and each saves with its stage', async () => {
      await openSpec();
      const bom1 = await screen.findByLabelText('BOM for 2. Lamination 1');
      fireEvent.click(within(bom1).getByRole('button', { name: '＋ Add item' }));
      expect(within(screen.getByLabelText('BOM for 2. Lamination 1')).getAllByLabelText('BOM item for Lamination 1')).toHaveLength(1);
      expect(within(screen.getByLabelText('BOM for 3. Lamination 2')).queryAllByLabelText('BOM item for Lamination 2')).toHaveLength(0);

      fireEvent.change(within(screen.getByLabelText('BOM for 2. Lamination 1')).getByLabelText('Item code for Lamination 1'), { target: { value: 'BLM1' } });
      fireEvent.change(within(screen.getByLabelText('BOM for 2. Lamination 1')).getByLabelText('Qty per base for Lamination 1'), { target: { value: '5' } });

      const bom2 = screen.getByLabelText('BOM for 3. Lamination 2');
      fireEvent.click(within(bom2).getByRole('button', { name: '＋ Add item' }));
      fireEvent.change(within(screen.getByLabelText('BOM for 3. Lamination 2')).getByLabelText('Item code for Lamination 2'), { target: { value: 'BLM2' } });
      fireEvent.change(within(screen.getByLabelText('BOM for 3. Lamination 2')).getByLabelText('Qty per base for Lamination 2'), { target: { value: '8' } });
      // Lamination 1 still has only its MET PET line
      expect(within(screen.getByLabelText('BOM for 2. Lamination 1')).getAllByLabelText('Item code for Lamination 1')).toHaveLength(1);

      fireEvent.click(screen.getByText('Save BOM'));
      await waitFor(() => expect(saved.bom).toBeTruthy());
      expect(saved.bom).toEqual([
        expect.objectContaining({ departmentId: 2, stageSeq: 2, itemId: 501, qtyPerBase: 5 }),
        expect.objectContaining({ departmentId: 2, stageSeq: 3, itemId: 502, qtyPerBase: 8 }),
      ]);
    });
  });

  describe('a BOM saved before stages existed', () => {
    beforeEach(() => installFetch({
      machines: [{ departmentId: 2, machineId: 21, eligible: true }],     // no stageSeq: the department's
      bom: [{ departmentId: 2, itemId: 501, qtyPerBase: 3, uom: 'Kg' }],  // no stageSeq
    }));

    it('opens its machine on both passes and its line once, on Lamination 1', async () => {
      await openSpec();
      expect(within(screen.getByLabelText('Machines for 2. Lamination 1')).getByLabelText('Use Lamination 1 for Lamination 1')).toBeChecked();
      expect(within(screen.getByLabelText('Machines for 3. Lamination 2')).getByLabelText('Use Lamination 1 for Lamination 2')).toBeChecked();
      expect(within(await screen.findByLabelText('BOM for 2. Lamination 1')).getAllByLabelText('Item code for Lamination 1')).toHaveLength(1);
      expect(within(screen.getByLabelText('BOM for 3. Lamination 2')).queryAllByLabelText('Item code for Lamination 2')).toHaveLength(0);
    });
  });
});
