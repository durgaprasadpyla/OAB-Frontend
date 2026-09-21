import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, within, cleanup } from '@testing-library/react';
import { renderApp, oabModule } from './harness.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import { materialKey, materialLabel, knownMaterials } from '../lib/material.js';

// Trends & Forecast — the material table (client, 21 Sep 2026):
//   "the material should be picked up from the JSS material only. I see many
//    duplicate entries in here with just spacing — cc pet + LPDE and cc pet +LDPE
//    are being considered as two different variants … Also I would want a material
//    forecast for the projections that I include from the projections tab on a
//    monthly basis … the dropdown selection Only projections".

describe('one material, however it was spelt', () => {
  it('ignores case, spacing and punctuation for the identity', () => {
    expect(materialKey('CC PET + LDPE')).toBe('CCPET+LDPE');
    expect(materialKey('cc pet +LDPE')).toBe('CCPET+LDPE');
    expect(materialKey(' CC  PET+ LDPE ')).toBe('CCPET+LDPE');
    expect(materialKey('CC PET + LPDE')).not.toBe(materialKey('CC PET + LDPE'));   // a real difference stays one
    expect(materialKey('')).toBe('');
  });
  it('reads back in one tidy spelling', () => {
    expect(materialLabel('cc pet +LDPE')).toBe('CC PET + LDPE');
    expect(materialLabel('  bopp/pe ')).toBe('BOPP / PE');
    expect(materialLabel('PET 12 / LDPE 60')).toBe('PET 12 / LDPE 60');
  });
  it('lists the materials a JSS master uses, one per identity, sorted', () => {
    expect(knownMaterials([
      { material: 'cc pet +LDPE' }, { material: 'CC PET + LDPE' }, { material: 'BOPP' }, { material: '' }, null,
    ], ['bopp', 'PET'])).toEqual(['BOPP', 'CC PET + LDPE', 'PET']);
  });
});

const JSS = [
  // the same film spelt two ways on two specs
  { spec: 'A1', customer: 'Acme', material: 'CC PET + LDPE', filmWidth: 500, gsm: 100, dispatchForm: 'Pouch', width: 100, status: 'Active' },
  { spec: 'A2', customer: 'Acme', material: 'cc pet +LDPE', filmWidth: 500, gsm: 100, dispatchForm: 'Pouch', width: 100, status: 'Active' },
  { spec: 'A3', customer: 'Beta', material: 'BOPP', filmWidth: 400, gsm: 50, dispatchForm: 'Pouch', width: 200, status: 'Active' },
];
const seed = {
  oab: oabModule({ SF: [
    { so: '26/1', spec: 'A1', customer: 'Acme', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-01' },
    { so: '26/2', spec: 'A2', customer: 'Acme', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-01' },
    // arrived in October against the A3 projection below
    { so: '26/3', spec: 'A3', customer: 'Beta', poQty: 500, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-10-05' },
  ] }),
  prices: {},
  jss: JSS,
  customers: [],
  projections: { entries: [
    { id: 'p1', source: 'customer', month: '2026-10', spec: 'A3', customer: 'Beta', jobName: 'X', qty: 2000, marketer: 'Ravi' },
    { id: 'p2', source: 'customer', month: '2026-11', spec: 'A1', customer: 'Acme', jobName: 'Y', qty: 300, marketer: 'Ravi' },
    { id: 'p3', source: 'lead', month: '2026-11', spec: '', customer: 'New Co', jobName: 'Trial', qty: 100, marketer: 'Ravi' },
  ] },
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openTrends() {
  renderApp(<Dashboard />, { modules: seed, role: 'superadmin' });
  fireEvent.click(await screen.findByText('📈 Trends & Forecast'));
  return screen.findByLabelText('Material projection');
}

describe('Trends & Forecast — material', () => {
  it('folds the spellings of one JSS material into one line', async () => {
    const table = await openTrends();
    const rows = within(table).getAllByRole('row').slice(1);
    // two lines, not three: CC PET + LDPE (A1 + A2 together) and BOPP
    expect(rows.map((r) => r.cells[0].textContent)).toEqual(['BOPP', 'CC PET + LDPE']);
    // A1 and A2: 1000 × 100mm / 1000 = 100 m each → 200 m on the one line
    expect(rows[1].cells[4].textContent).toBe('200 m');
  });

  it('switches to the projections alone, month by month or one month', async () => {
    const table = await openTrends();
    fireEvent.change(screen.getByLabelText('Material basis'), { target: { value: 'proj' } });
    // every projected month: October (A3, 2000 − 500 received = 1500 × 200/1000 = 300 m)
    // and November (A1, 300 × 100/1000 = 30 m); the lead is reported, not costed
    let rows = within(screen.getByLabelText('Material projection')).getAllByRole('row').slice(1);
    expect(rows.map((r) => [r.cells[0].textContent, r.cells[1].textContent, r.cells[5].textContent]))
      .toEqual([['October 2026', 'BOPP', '300 m'], ['November 2026', 'CC PET + LDPE', '30 m']]);
    expect(screen.getByText(/1 projection\(s\) left out/)).toBeInTheDocument();
    expect(screen.getByText(/New Co — Trial/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Projection month'), { target: { value: '2026-10' } });
    rows = within(screen.getByLabelText('Material projection')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells[0].textContent).toBe('BOPP');   // no Month column for a single month
    expect(rows[0].cells[4].textContent).toBe('300 m');
    expect(table).toBeTruthy();
  });
});
