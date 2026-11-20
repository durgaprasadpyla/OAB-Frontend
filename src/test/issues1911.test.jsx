// 18.11 + 19.11 — speciality linking, the OAB download's sale-order columns, the
// PLAN landing without the department-wise BOM.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import PDashboard from '../pages/PDashboard.jsx';
import { routeIndex, soExportCells, SO_EXPORT_COLUMNS } from '../lib/oabExport.js';
import { linkKey, setLink, specialtiesFor } from '../lib/specialtyLinks.js';

describe('the OAB download — sale-order columns (19.11)', () => {
  const pouchJss = { spec: 'A1', dispatchForm: 'Pouch', width: 150, height: 200, filmWidth: 600, gsm: 100, pouchWeight: 3.456 };
  const routes = routeIndex([{ spec: 'A1', routeName: 'Print-Pouch', stages: ['Printing', 'Lamination', 'Pouching'] }, { spec: 'R9', routeName: 'Roll only', stages: [] }]);
  const col = (name, cells) => cells[SO_EXPORT_COLUMNS.indexOf(name)];

  it('a pouch order: unit, unit weight, FG allocated off the balance, totals, balance and route', () => {
    const r = { so: '26/1', spec: 'A1', poQty: 10000, invDisp: 2000, manDisp: 0, fg: 3000 };
    const c = soExportCells(r, pouchJss, { routes });
    expect(col('UOM', c)).toBe('Pcs');
    expect(col('Unit Weight (g)', c)).toBe(3.46);
    expect(col('FG Allocated', c)).toBe(3000);
    expect(col('Balance Qty', c)).toBe(5000);               // 10,000 − 2,000 invoiced − 3,000 FG
    expect(col('Total Metres (+5%)', c)).toBe(1575);         // 10,000 × 150 mm × 1.05
    expect(col('Balance Metres (+5%)', c)).toBe(788);        // 5,000 × 150 mm × 1.05
    expect(col('Total Kgs', c)).toBe(95);                    // 1,575 m × 0.6 m × 100 g/m²
    expect(col('Balance Kgs', c)).toBe(47);
    expect(col('Route', c)).toBe('Printing → Lamination → Pouching');
  });

  it('a roll is in metres and has no unit weight; a route with no stages shows its name', () => {
    const c = soExportCells({ so: '26/2', spec: 'R9', poQty: 5000, fg: 0 }, { dispatchForm: 'Roll', filmWidth: 600, gsm: 50, pouchWeight: 9 }, { routes });
    expect(col('UOM', c)).toBe('Mtrs');
    expect(col('Unit Weight (g)', c)).toBe('');
    expect(col('Route', c)).toBe('Roll only');
  });
});

describe('specialities linked to a material type + sub group (18.11)', () => {
  const rows = [
    { materialType: 'FILM', subGroup: 'PET', specialty: 'Metallized' },
    { materialType: 'FILM', subGroup: 'BOPP', specialty: 'Antifog' },
  ];
  const all = ['Antifog', 'Matt', 'Metallized'];

  it('offers what items under the pair carry, plus what was linked by hand', () => {
    expect(specialtiesFor({ rows, links: {}, all, materialType: 'FILM', subGroup: 'PET' }))
      .toEqual({ options: ['Metallized'], narrowed: true });
    const links = setLink({}, 'film', 'pet', 'Matt', true);
    expect(links[linkKey('FILM', 'PET')]).toEqual(['Matt']);
    expect(specialtiesFor({ rows, links, all, materialType: 'FILM', subGroup: 'PET' }).options).toEqual(['Matt', 'Metallized']);
    expect(setLink(links, 'FILM', 'PET', 'matt', false)).toEqual({});
  });

  it('a pair nothing is linked to yet offers every speciality', () => {
    expect(specialtiesFor({ rows, links: {}, all, materialType: 'INK', subGroup: 'Solvent' })).toEqual({ options: all, narrowed: false });
  });
});

describe('Item Master — the Speciality picker narrows, and links are saved (18.11)', () => {
  const res = (status, body) => ({ status, ok: status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  let saved;
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('blm_token', 't'); localStorage.setItem('blm_role', 'padmin');
    saved = [];
    const itemsExtra = [
      { itemCode: 'BLM1', specificMaterial: '600 MM', materialType: 'FILM', subGroup: 'PET', specialty: 'Metallized', microns: '12', widthMm: 600, uom: 'KG' },
      { itemCode: 'BLM2', specificMaterial: '700 MM', materialType: 'FILM', subGroup: 'BOPP', specialty: 'Antifog', microns: '20', widthMm: 700, uom: 'KG' },
    ];
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url); const method = (opts.method || 'GET').toUpperCase();
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (u.includes('/api/auth/me')) return res(200, { username: 'padmin', role: 'padmin' });
      if (u.includes('/api/master/departments')) return res(200, []);
      if (u.includes('/api/master/uoms')) return res(200, []);
      if (u.includes('/rest/v1/oab_data')) {
        if (method === 'GET') return res(200, [{ id: 6, data: JSON.stringify({ asl: [], pos: [], priceHistory: [], counter: 0, itemsExtra }), version: 1 }]);
        saved.push(body); return res(201, { id: body.id, version: 2 });
      }
      return res(200, {});
    };
  });

  it('FILM / PET offers only Metallized; ticking Antifog links it', async () => {
    render(<MemoryRouter><AuthProvider><DataProvider><PDashboard /></DataProvider></AuthProvider></MemoryRouter>);
    fireEvent.click(await screen.findByText('🗂 Item Master'));
    fireEvent.change(await screen.findByLabelText('Item form Material Type'), { target: { value: 'FILM' } });
    fireEvent.change(screen.getByLabelText('Item form Sub Group'), { target: { value: 'PET' } });
    const opts = within(screen.getByLabelText('Item form Specialty')).getAllByRole('option').map((o) => o.textContent.trim());
    expect(opts).toContain('Metallized');
    expect(opts).not.toContain('Antifog');

    const panel = screen.getByLabelText('Link specialities');
    fireEvent.change(within(panel).getByLabelText('Link material type'), { target: { value: 'FILM' } });
    fireEvent.change(within(panel).getByLabelText('Link sub group'), { target: { value: 'PET' } });
    expect(within(panel).getByLabelText('Link Metallized')).toBeChecked();
    expect(within(panel).getByLabelText('Link Metallized')).toBeDisabled();   // an item carries it
    fireEvent.click(within(panel).getByLabelText('Link Antifog'));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(JSON.parse(saved[saved.length - 1].data).specialtyLinks).toEqual({ 'film|pet': ['Antifog'] });
  });
});
