// Issues 17.10 §8 — QC's CSA report: film width from the Item Master, and the
// measurements follow the requisition's dispatch form.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import QC from '../pages/QC.jsx';
import { csaVisibleFields, csaFilmWidthChoices, csaDispatchForm, requestedFilmWidth, widthKey } from '../lib/csaFields.js';

const ITEMS = [
  { id: 1, code: 'BLM1', name: '600 MM', materialType: 'FILM', subGroup: 'CC PET', specialtyName: '', microns: '12', widthMm: 600, uom: 'Kg' },
  { id: 2, code: 'BLM2', name: '700 MM', materialType: 'FILM', subGroup: 'CC PET', specialtyName: '', microns: '12', widthMm: 700, uom: 'Kg' },
  { id: 3, code: 'BLM3', name: '700 MM', materialType: 'FILM', subGroup: 'LDPE - NATURAL', specialtyName: '', microns: '40', widthMm: 700, uom: 'Kg' },
  { id: 4, code: 'BLM4', name: 'BLUE', materialType: 'INK', subGroup: 'FLEXO', specialtyName: '', microns: '', widthMm: 0, uom: 'Kg' },
];

const req = (form) => ({ despatch_location: 'Pune', tentative_qty: 100, tentative_date: '2026-10-30', target_price: 10, despatch_form: form, kind: '', details: {} });
const sku = (id, name, form, extra = {}) => ({
  id, lead_id: 'L1', sku_name: name, sample_received: 'Yes', sample_sent: 'Yes', sample_sent_at: '2026-10-10',
  dispatch_form: form, csa_request: req(form), ...extra,
});

const mods = (skus, reports = []) => ({
  sales: {
    leads: [{ id: 'L1', client_name: 'Acme Foods' }], skus, qc_reports: reports,
    contacts: [], interactions: [], quotations: [], sales_users: [], pos: [], targets: [],
    substrate_options: [], nego_msgs: [], dropdowns: {},
  },
  jss: [], capa: [], masterItems: ITEMS,
  oab: { OAB: { SF: [], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 1 }, lastInvNo: 1 },
});

async function openForm(skus, name, reports) {
  const r = renderApp(<QC />, { modules: mods(skus, reports), role: 'qc' });
  await userEvent.click(await screen.findByText(/CSA Reports/));
  if (name) await userEvent.click(await screen.findByLabelText(`Add CSA report for ${name}`));
  return r;
}

describe('csaFields', () => {
  it('maps each dispatch kind to its measurements, and shows everything when unknown', () => {
    const keys = (form) => csaVisibleFields(form).fields.map((f) => f.k);
    expect(keys('Roll')).toEqual(expect.arrayContaining(['film_width', 'gsm', 'core_in', 'per_reel_kg', 'print_repeat']));
    expect(keys('Roll')).not.toContain('pouch_height');
    expect(keys('Roll')).not.toContain('pouches_per_kg');
    expect(keys('Pouch')).toEqual(expect.arrayContaining(['pouch_height', 'pouch_width', 'gusset', 'seal_width', 'pouch_weight', 'pouches_per_kg']));
    expect(keys('Pouch')).not.toContain('core_in');
    expect(keys('Bulk Bags')).toContain('gusset');
    expect(keys('Shrink Sleeve')).toEqual(expect.arrayContaining(['sleeve_repeat', 'lay_flat']));
    expect(keys('Shrink Sleeve')).not.toContain('pouch_weight');
    expect(keys('Labels')).toContain('print_repeat');
    expect(keys('')).toContain('pouch_height');
    expect(keys('')).toContain('core_in');
    expect(keys('Something odd')).toHaveLength(keys('').length);
  });

  it('takes the dispatch form from the SKU, its requisition, or the direct report', () => {
    expect(csaDispatchForm({ dispatch_form: 'Roll' }, {})).toBe('Roll');
    expect(csaDispatchForm({ csa_request: { despatch_form: 'Pouch' } }, {})).toBe('Pouch');
    expect(csaDispatchForm(null, { dispatch_type: 'Labels' })).toBe('Labels');
  });

  it('offers the Item Master widths, narrowed to what every chosen layer is stocked in', () => {
    expect(csaFilmWidthChoices(ITEMS, {}).options).toEqual(['600', '700']);
    expect(csaFilmWidthChoices(ITEMS, { substrate1: 'CC PET' }).options).toEqual(['600', '700']);
    const both = csaFilmWidthChoices(ITEMS, { substrate1: 'CC PET', substrate2: 'LDPE - NATURAL' });
    expect(both.options).toEqual(['700']);
    expect(both.partial).toEqual([{ width: 600, missing: ['LDPE - NATURAL'] }]);
    expect(requestedFilmWidth([{ material: 'CC PET', widthMm: '' }, { material: 'X', widthMm: '435' }])).toBe('435');
    expect(widthKey(0)).toBe('');
    expect(widthKey('600.0')).toBe('600');
  });
});

describe('QC CSA form — Issues 17.10 §8', () => {
  it('a Roll requisition shows roll measurements, a film-width dropdown from the Item Master, preselected from the structure', async () => {
    const { saved } = await openForm([sku('S1', 'Roll A', 'Roll', { structure: 'CC PET · 12 mic · 600 mm' })], 'Roll A');
    expect(screen.getByLabelText('Measurements for dispatch form')).toHaveTextContent('Dispatch form: Roll');
    expect(screen.queryByLabelText('Pouch height')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pouches per kg')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pouch weight')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Core (inches)')).toBeInTheDocument();
    expect(screen.getByLabelText('Per reel (Kgs)')).toBeInTheDocument();

    const fw = await screen.findByLabelText('Film width');
    expect(fw.tagName).toBe('SELECT');
    await waitFor(() => expect(fw).toHaveValue('600'));
    expect(within(fw).getAllByRole('option').map((o) => o.textContent)).toEqual(['— select —', '600', '700']);

    await userEvent.selectOptions(fw, '700');
    await userEvent.type(screen.getByLabelText('Core (inches)'), '3');
    await userEvent.click(screen.getByText(/Save CSA report/));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const r = saved.filter((s) => s.key === 'sales').pop().data.qc_reports[0];
    expect(r).toMatchObject({ sku_id: 'S1', film_width: 700, core_in: 3, dispatch_type: 'Roll' });
  });

  it('a Pouch requisition shows the pouch measurements and no roll ones', async () => {
    await openForm([sku('S1', 'Pouch A', 'Pouch')], 'Pouch A');
    expect(screen.getByLabelText('Pouch height')).toBeInTheDocument();
    expect(screen.getByLabelText('Pouches per kg')).toBeInTheDocument();
    expect(screen.getByLabelText('Gusset')).toBeInTheDocument();
    expect(screen.queryByLabelText('Core (inches)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sleeve repeat')).not.toBeInTheDocument();
  });

  it('a direct report with no dispatch form shows every measurement', async () => {
    await openForm([]);
    await userEvent.click(screen.getByText(/Direct CSA report/));
    expect(screen.getByLabelText('Measurements for dispatch form')).toHaveTextContent('Dispatch form not set');
    ['Pouch height', 'Core (inches)', 'Sleeve repeat', 'Lay-flat width', 'Print repeat'].forEach((l) => {
      expect(screen.getByLabelText(l)).toBeInTheDocument();
    });
  });

  it('narrows the widths to the chosen substrates and keeps a width that dropped out as (current)', async () => {
    await openForm([sku('S1', 'Roll A', 'Roll', { structure: 'CC PET · 12 mic · 600 mm' })], 'Roll A');
    const fw = await screen.findByLabelText('Film width');
    await waitFor(() => expect(fw).toHaveValue('600'));
    await userEvent.selectOptions(screen.getByLabelText('Primary Substrate'), 'LDPE - NATURAL');
    const opts = within(screen.getByLabelText('Film width')).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['— select —', '(current) 600', '700']);
    expect(screen.getByLabelText('Film width')).toHaveValue('600');
  });

  it('a hidden measurement keeps its saved value through an edit', async () => {
    const report = {
      id: 'R1', source: 'sales_os', sku_id: 'S1', lead_id: 'L1', created_at: '2026-10-11T00:00:00Z',
      dispatch_type: 'Roll', substrate1: 'CC PET', substrate1_val: 12, ink_gsm: 2, film_width: 600,
      pouch_height: 150, pouches_per_kg: 900, status: 'Pending Plant',
    };
    const { saved } = await openForm([sku('S1', 'Roll A', 'Roll', { csa_received: 'Yes' })], null, [report]);
    await userEvent.click(await screen.findByLabelText('Edit CSA for Roll A'));
    expect(screen.queryByLabelText('Pouch height')).not.toBeInTheDocument();
    const ink = screen.getByLabelText('Ink GSM');
    await userEvent.clear(ink);
    await userEvent.type(ink, '3');
    await userEvent.click(screen.getByText(/Save CSA report/));
    await userEvent.type(await screen.findByLabelText('Re-approve comments'), 'ink up');
    await userEvent.click(screen.getByText(/Save and send to the plant/));
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const r = saved.filter((s) => s.key === 'sales').pop().data.qc_reports[0];
    expect(r).toMatchObject({ ink_gsm: 3, pouch_height: 150, pouches_per_kg: 900, film_width: 600 });
  });
});
