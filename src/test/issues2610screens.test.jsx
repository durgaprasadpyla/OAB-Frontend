// Issues as on 26.10.2026 — the QC screens: landing-page sample highlight, the CSA
// Specifications sheet (GSM, printing, lamination, pouch), and CSA → JSS.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import QC from '../pages/QC.jsx';
import { blankSheet } from '../lib/specSheet.js';

const ITEMS = [
  { id: 1, code: 'BLM1', name: '600 MM', materialType: 'FILM', subGroup: 'CC PET', specialtyName: '', microns: '12', widthMm: 600, uom: 'Kg' },
  { id: 3, code: 'BLM3', name: '700 MM', materialType: 'FILM', subGroup: 'LDPE - NATURAL', specialtyName: '', microns: '50', widthMm: 700, uom: 'Kg' },
];
const MACHINES = [
  { id: 11, code: 'CI', name: 'CI Flexo', departmentName: 'Printing', active: true },
  { id: 12, code: 'TH', name: 'Thallo', departmentName: 'Printing', active: true },
  { id: 21, code: 'L1', name: 'Lam One', departmentName: 'Lamination', active: true },
];
const TOOLING = {
  11: { max_width: 1000, sleeves: [400, 420] },
  12: { max_width: 700, sleeves: [300, 400] },
  21: { rollers: [600, 610, 615, 650, 910] },
};
const qcMods = (skus, reports = []) => ({
  sales: {
    leads: [{ id: 'L1', client_name: 'Acme Foods' }], skus, qc_reports: reports,
    contacts: [], interactions: [], quotations: [], sales_users: [{ id: 'r1', display_name: 'Manasa' }], pos: [], targets: [],
    substrate_options: [], nego_msgs: [], dropdowns: {}, machine_tooling: TOOLING,
  },
  jss: [], capa: [], customers: [{ customer: 'Acme Foods', group: 'ACME' }], masterItems: ITEMS, masterMachines: MACHINES,
  oab: { OAB: { SF: [], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 1 }, lastInvNo: 1 },
});
const req = (form, details = {}) => ({
  despatch_location: 'Pune', tentative_qty: 100, tentative_uom: 'Nos', tentative_date: '2026-11-30', target_price: 10,
  despatch_form: form, kind: '', details, sent_by: 'r1',
});
const pouchSku = {
  id: 'S1', lead_id: 'L1', sku_name: 'Pouch A', created_by: 'r1', sample_received: 'Yes', sample_sent: 'Yes',
  sample_sent_at: '2026-10-25', dispatch_form: 'Pouch', csa_requested: true,
  csa_request: req('Pouch', { gusset_type: 'Bottom gusset', gusset_mm: 30, totalGusset: 60, pouch_width_mm: 150, pouch_height_mm: 200, packing_instructions: '500 per box' }),
};

describe('QC landing page', () => {
  it('highlights the samples waiting and who asked, on the first page and the CSA tab', async () => {
    renderApp(<QC />, { modules: qcMods([pouchSku]), role: 'qc' });
    const banner = await screen.findByLabelText('Samples waiting for a CSA report');
    expect(banner).toHaveTextContent('1 sample received and sent');
    expect(banner).toHaveTextContent('Manasa: 1');
    expect(screen.getByLabelText('Samples pending CSA')).toHaveTextContent('1');
    await userEvent.click(within(banner).getByText('Open CSA Reports'));
    expect(await screen.findByLabelText('Sample status of Pouch A')).toHaveTextContent('✓ Sample received');
  });
});

describe('QC CSA report — the Specifications sheet', () => {
  async function openPouch() {
    const r = renderApp(<QC />, { modules: qcMods([pouchSku]), role: 'qc' });
    await userEvent.click(await screen.findByText(/CSA Reports/, { selector: '.step-tab' }));
    await userEvent.click(await screen.findByLabelText('Add CSA report for Pouch A'));
    return r;
  }

  it('starts from the rep’s requisition, editable, with the pouch figures prefilled', async () => {
    await openPouch();
    const ed = screen.getByLabelText('Requisition from the sales rep (editable)');
    expect(within(ed).getByLabelText('CSA dispatch form')).toHaveValue('Pouch');
    expect(within(ed).getByLabelText('CSA tentative quantity')).toHaveValue(100);
    expect(screen.getByLabelText('Individual pouch height (mm)')).toHaveValue(200);
    expect(screen.getByLabelText('Total gusset (mm)')).toHaveValue(60);
    expect(screen.getByLabelText('Each gusset fold (mm)')).toHaveValue('30');
    expect(screen.getByLabelText('Packing specifications')).toHaveValue('500 per box');
    expect(screen.getByLabelText('Specifications for dispatch form')).toHaveTextContent('Dispatch form: Pouch');
  });

  it('works GSM from the density, mirrors the seal width, and weighs the pouch', async () => {
    await openPouch();
    await userEvent.selectOptions(await screen.findByLabelText('Primary Substrate'), 'CC PET');
    await userEvent.selectOptions(screen.getByLabelText('Primary Substrate Micron'), '12');
    expect(screen.getByLabelText('Primary GSM')).toHaveValue('16.8');
    await userEvent.type(screen.getByLabelText('Ink GSM'), '2');
    expect(screen.getByLabelText('Total GSM')).toHaveTextContent('Total GSM: 18.8');
    await userEvent.type(screen.getByLabelText('Seal width A'), '5');
    expect(screen.getByLabelText('Seal width B')).toHaveValue(5);
    expect(screen.getByLabelText('Total seal width (mm)')).toHaveValue('10');
    expect(Number(screen.getByLabelText('Pouch weight (g)').value)).toBeGreaterThan(0);
  });

  it('print repeat = ups × repeat, sleeves from the machine, and a film too wide for it is refused', async () => {
    const { saved } = await openPouch();
    await userEvent.type(screen.getByLabelText('Single print repeat (mm)'), '99');
    await userEvent.type(screen.getByLabelText('Single print width (mm)'), '300');
    await userEvent.click(await screen.findByLabelText('Print on Thallo'));
    await userEvent.type(screen.getByLabelText('Thallo ups'), '4');
    expect(screen.getByLabelText('Thallo print repeat')).toHaveValue('396');
    const sleeves = within(screen.getByLabelText('Thallo sleeve')).getAllByRole('option').map((o) => o.textContent);
    expect(sleeves).toEqual(['— select —', '400']);
    await userEvent.type(screen.getByLabelText('Thallo tracks'), '3');
    await userEvent.type(screen.getByLabelText('Thallo tracker line'), '20');
    expect(screen.getByLabelText('Thallo film width')).toHaveValue('920');
    expect(screen.getByLabelText('Thallo film width too wide')).toHaveTextContent('reduce to 2 track(s)');
    await userEvent.click(screen.getByText(/Save CSA report/));
    expect(await screen.findByText(/more than the machine's 700 mm/)).toBeInTheDocument();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
  });

  it('a secondary substrate brings the lamination: rollers in the 5 mm window per printing machine', async () => {
    await openPouch();
    await userEvent.selectOptions(await screen.findByLabelText('Primary Substrate'), 'CC PET');
    await userEvent.selectOptions(screen.getByLabelText('Secondary Substrate'), 'LDPE - NATURAL');
    expect(screen.queryByLabelText('Lamination 2')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Secondary Adhesive GSM')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Single print width (mm)'), '300');
    await userEvent.click(await screen.findByLabelText('Print on CI Flexo'));
    await userEvent.type(screen.getByLabelText('CI Flexo tracks'), '2');
    await userEvent.type(screen.getByLabelText('CI Flexo tracker line'), '20');
    const lam = screen.getByLabelText('Lamination 1 for CI Flexo');
    expect(lam).toHaveTextContent('film width 630 mm');
    await userEvent.click(within(lam).getByLabelText('Lamination 1 CI Flexo on Lam One'));
    const opts = within(screen.getByLabelText('Lamination 1 roller CI Flexo · Lam One')).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['— select —', '610', '615']);
  });
});

describe('CSA → JSS', () => {
  it('“→ JSS” opens the spec entry with the CSA filled in, sheet and all', async () => {
    const report = {
      id: 'R1', source: 'direct', company_name: 'Acme Foods', party_kind: 'customer', product_desc: 'Walk-in pouch',
      dispatch_type: 'Pouch', substrate1: 'CC PET', substrate1_val: 12, status: 'Pending Plant', created_at: '2026-10-20T00:00:00Z',
      spec: { ...blankSheet(), single_repeat: '99', pouch_height: '200', pouch_width: '150' },
    };
    renderApp(<QC />, { modules: qcMods([], [report]), role: 'qc' });
    await userEvent.click(await screen.findByText(/CSA Reports/, { selector: '.step-tab' }));
    await userEvent.click(await screen.findByLabelText('Convert CSA for Walk-in pouch to JSS'));
    expect(await screen.findByLabelText('Job Name')).toHaveValue('Walk-in pouch');
    expect(screen.getByLabelText('Customer')).toHaveValue('Acme Foods');
    await waitFor(() => expect(screen.getByLabelText('Primary Material')).toHaveValue('CC PET'));
    expect(screen.getByLabelText('Single print repeat (mm)')).toHaveValue(99);
    expect(screen.getByLabelText('Individual pouch height (mm)')).toHaveValue(200);
  });
});
