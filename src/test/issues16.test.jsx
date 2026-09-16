import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// Issues_16.09.2026 — four items:
//   ¶1 Stores: the materials offered follow the DEPARTMENT picked, not the whole BOM.
//   ¶2 Super Admin: HR-added departments / designations can be edited, deleted and
//      capitalised; a disabled name re-entered comes back rather than "already exists".
//   ¶3 CSA substrates: paper sub-groups beside the film ones.
//   ¶4 PM login: the stores desk's Raw Material on Hand board, read-only.

import { capitalise } from '../components/DropdownAdmin.jsx';

describe('capitalise — HR typed everything in caps', () => {
  it('title-cases words and leaves two-letter codes alone', () => {
    expect(capitalise('PRINTING')).toBe('Printing');
    expect(capitalise('INK CHEMIST')).toBe('Ink Chemist');
    expect(capitalise('HO')).toBe('HO');
    expect(capitalise('EXECUTIVE ASSISTANT')).toBe('Executive Assistant');
  });
});

const res = (body, status = 200) => ({ status, ok: status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const ITEMS = [
  { id: 37, code: 'BLM037', name: '1200 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', uom: 'Kg', widthMm: 1200 },
  { id: 90, code: 'INK01', name: 'CYAN INK', materialType: 'INK', subGroup: 'PROCESS', specialtyName: '', uom: 'Kg' },
  { id: 91, code: 'SOL01', name: 'ETHYL', materialType: 'SOLVENT', subGroup: 'THINNER', specialtyName: '', uom: 'Lt' },
  { id: 92, code: 'PAP01', name: 'KRAFT', materialType: 'PAPER', subGroup: 'Metallized paper', specialtyName: '', uom: 'Kg' },
];
const ON_HAND = ITEMS.map((it) => ({ ...it, closingStock: 200, unitCount: 1, departmentName: 'Printing', stockValue: 1000, msl: 5, byStatus: {}, active: true }));
const CTX = { so: '26/575', found: true, spec: 'A1336', customer: 'MORE', jobName: 'Poly bag',
  route: { routeName: 'PRINTED BOPP MAP POUCH', source: 'jss', departments: [{ seq: 1, departmentName: 'Printing' }, { seq: 2, departmentName: 'Packing' }] },
  bom: { found: true, items: [
    { itemId: 37, itemCode: 'BLM037', itemName: '1200 MM', departmentName: 'Printing' },
    { itemId: 90, itemCode: 'INK01', itemName: 'CYAN INK', departmentName: 'Printing' },
    { itemId: 91, itemCode: 'SOL01', itemName: 'ETHYL', departmentName: 'Packing' },
  ] } };

let posted;
beforeEach(() => {
  posted = [];
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: { asl: [], pos: [] }, oab: { OAB: { SF: [{ so: '26/575', spec: 'A1336', customer: 'MORE', closed: false }], OT: [] } }, sales: {}, jss: [], customers: [], prices: {}, pmData: {} }, save: vi.fn(), reloadModule: vi.fn(), loading: false }) }));
  vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ role: 'stores', user: 'store' }) }));
  vi.doMock('../lib/issueSlipPdf.js', () => ({ saveIssueSlipPdf: vi.fn(), buildIssueSlipPdf: vi.fn(), buildReturnSlipPdf: vi.fn() }));
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET') !== 'GET') { posted.push({ u, method: opts.method, body: JSON.parse(opts.body || '{}') }); return res({ id: 9, name: 'Accounts', reactivated: true }, 201); }
    if (u.includes('/api/stores/so-context')) return res(CTX);
    if (u.match(/\/api\/stores\/items\/\d+\/units/)) return res([]);
    if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
    if (u.includes('/api/stores/units')) return res([]);
    if (u.includes('/api/master/items')) return res(ITEMS);
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing', active: true, scope: 'PRODUCTION' }, { id: 5, name: 'ACCOUNTS', active: true, scope: 'HR', hrOnly: true, employees: 2 }]);
    if (u.includes('/api/hr/designations')) return res([{ id: 20, title: 'OPERATOR', active: true }, { id: 21, title: 'HO', active: true }]);
    if (u.includes('/api/planning/week')) return res({ jobs: [] });
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

const sel = (label, v) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });

describe('Stores — the material follows the department (¶1)', () => {
  it('offers only the picked department\'s BOM lines, and every line when no department is picked', async () => {
    const { default: Stores } = await import('../pages/Stores.jsx');
    render(<Stores />);
    fireEvent.click(await screen.findByText('🔄 Issues & Returns'));
    await screen.findByLabelText('Sale order');
    sel('Sale order', '26/575');
    await waitFor(() => expect(within(screen.getByLabelText('Department')).getAllByRole('option').length).toBe(3));
    // no department yet: the whole BOM (film + ink + solvent)
    await waitFor(() => expect(within(screen.getByLabelText('Item')).getAllByRole('option').length).toBe(4));
    const mats = () => [...screen.getByLabelText('Material type').options].map((o) => o.textContent);
    expect(mats()).toEqual(['Any material', 'FILM', 'INK', 'SOLVENT']);
    sel('Department', 'Packing');
    await waitFor(() => expect(mats()).toEqual(['Any material', 'SOLVENT']));
    expect([...screen.getByLabelText('Item').options].map((o) => o.textContent)).toEqual(['— select an item code —', 'SOL01 · for Packing']);
    sel('Department', 'Printing');
    await waitFor(() => expect(mats()).toEqual(['Any material', 'FILM', 'INK']));
  });
});

describe('Drop-down selections — HR-added names are editable (¶2) and paper is a substrate (¶3)', () => {
  it('renames, deletes and capitalises departments and designations, and re-entering a disabled name brings it back', async () => {
    vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ role: 'superadmin', user: 'boss' }) }));
    window.confirm = () => true;
    const { default: DropdownAdmin } = await import('../components/DropdownAdmin.jsx');
    render(<DropdownAdmin />);
    // Departments list: rename an HR-added name in place
    const acc = await screen.findByLabelText('Department ACCOUNTS');
    fireEvent.change(acc, { target: { value: 'Accounts' } }); fireEvent.blur(acc);
    await waitFor(() => expect(posted.some((p) => p.u.endsWith('/departments/5') && p.body.name === 'Accounts')).toBe(true));
    // capitalise everything in caps at once
    fireEvent.click(screen.getByText('Aa Capitalise all'));
    await waitFor(() => expect(posted.filter((p) => p.u.endsWith('/departments/5')).length).toBeGreaterThan(1));
    // re-entering a disabled name: the server brings it back and the screen says so
    fireEvent.change(screen.getByLabelText('New department name'), { target: { value: 'accounts' } });
    fireEvent.click(screen.getByText('＋ Add'));
    expect(await screen.findByText(/was disabled — it is back/)).toBeInTheDocument();
    // Designations panel: delete, capitalise, and the HR-only department can be renamed / deleted
    fireEvent.click((await screen.findAllByText(/Designations & HR-only departments/))[0]);
    await screen.findByLabelText('Designation OPERATOR');
    fireEvent.click(screen.getByLabelText('Delete designation OPERATOR'));
    await waitFor(() => expect(posted.some((p) => p.method === 'DELETE' && p.u.endsWith('/designations/20'))).toBe(true));
    fireEvent.click(screen.getAllByText('Aa Capitalise all').pop());
    await waitFor(() => expect(posted.some((p) => p.u.endsWith('/designations/20') && p.body.title === 'Operator')).toBe(true));
    expect(posted.some((p) => p.u.endsWith('/designations/21') && p.body.title)).toBe(false);   // HO stays
    expect(screen.getByLabelText('HR-only department ACCOUNTS')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Delete HR-only department ACCOUNTS'));
    await waitFor(() => expect(posted.some((p) => p.method === 'DELETE' && p.u.endsWith('/departments/5'))).toBe(true));
    // ¶3: substrates from film AND paper
    fireEvent.click(screen.getByText(/CSA Substrates/));
    const sub = await screen.findByLabelText('Substrate 1');
    const names = [...sub.options].map((o) => o.textContent);
    expect(names).toContain('AF BOPP');
    expect(names).toContain('Metallized paper');
    expect(names).not.toContain('PROCESS');
  });
});

describe('PM login — Raw Material on Hand (¶4)', () => {
  it('shows the stores board read-only: figures and rolls, no MSL box, no status select', async () => {
    vi.doMock('../auth.jsx', () => ({ useAuth: () => ({ role: 'pm', user: 'pm1' }) }));
    globalThis.fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
      if (u.includes('/api/stores/items/37/units')) return res([{ id: 11, itemId: 37, internalCode: 'BLMU-7', qtyRemaining: 200, qtyReceived: 200, widthMm: 1200, uom: 'Kg', location: 'A2', status: 'NON_MOVING' }]);
      return res([]);
    });
    const { default: PM } = await import('../pages/PM.jsx');
    render(<PM />);
    fireEvent.click(await screen.findByText('📦 Raw Material on Hand'));
    expect(await screen.findByText('BLM037')).toBeInTheDocument();
    expect(screen.queryByLabelText('MSL for BLM037')).toBeNull();
    expect(screen.queryByText('⚙ Set MSL from 3-month average')).toBeNull();
    fireEvent.click(screen.getByText('BLM037'));
    expect(await screen.findByText('BLMU-7')).toBeInTheDocument();
    expect(screen.queryByLabelText('Status of BLMU-7')).toBeNull();
    expect(within(screen.getByText('BLMU-7').closest('tr')).getByText('Non-moving')).toBeInTheDocument();
  });
});
