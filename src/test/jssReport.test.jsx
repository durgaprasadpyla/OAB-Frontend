// 17.11 — "the same kind of details that are there in the CSA report to be present in
// the JSS report also, but the details in the JSS have not changed."
import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import QC from '../pages/QC.jsx';
import { blankSheet } from '../lib/specSheet.js';
import { csaOfSpec, jssReport, jssSpecText } from '../lib/jssReport.js';

const ITEMS = [
  { id: 1, code: 'BLM1', name: '600 MM', materialType: 'FILM', subGroup: 'CC PET', specialtyName: '', microns: '12', widthMm: 600, uom: 'Kg' },
];
const sheet = { ...blankSheet(), single_repeat: '99', packing: '500 per box', print_direction: 'Readable', coating: 'Matt' };
const SPEC = {
  sno: 1, spec: 'A1500', customer: 'Acme Foods', jobName: 'Walk-in pouch', jobType: 'Pouch', dispatchForm: 'Pouch',
  material1: 'CC PET', microns1: '12', material: 'CC PET', mic: '12', filmWidth: 600, width: 150, height: 200,
  status: 'Active', specSheet: sheet, fromCsa: 'R1',
};
const REPORT = { id: 'R1', source: 'direct', company_name: 'Acme Foods', remarks: 'Check seal strength', plant_comments: 'Run on CI' };

const mods = (jss, reports = []) => ({
  sales: {
    leads: [], skus: [], qc_reports: reports, contacts: [], interactions: [], quotations: [], sales_users: [], pos: [],
    targets: [], substrate_options: [], nego_msgs: [], dropdowns: {}, machine_tooling: {},
  },
  jss, capa: [], customers: [{ customer: 'Acme Foods', group: 'ACME' }], masterItems: ITEMS, masterMachines: [],
  oab: { OAB: { SF: [], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 1 }, lastInvNo: 1 },
});

describe('the JSS report rows', () => {
  it('reads the spec, its Specifications sheet and the CSA it came from', () => {
    const r = jssReport({ sales: { qc_reports: [REPORT] }, spec: SPEC });
    expect(r.header).toEqual(expect.arrayContaining([
      ['Primary Substrate', 'CC PET · 12 mic'], ['Film Width', '600 mm'], ['Width', '150 mm'], ['Dispatch Form', 'Pouch'],
    ]));
    expect(r.specs).toEqual(expect.arrayContaining([['Coating', 'Matt'], ['Printing direction for despatch', 'Readable'], ['Packing', '500 per box']]));
    expect(r.qcRemarks).toBe('Check seal strength');
    expect(r.plantComments).toBe('Run on CI');
    expect(jssSpecText(r)).toContain('Packing: 500 per box');
  });

  it("prefers the spec's own remarks, and finds a Sales-OS CSA by its SKU", () => {
    const sku = { id: 'R2', sku_id: 'S9', remarks: 'from csa' };
    expect(csaOfSpec({ qc_reports: [sku] }, { fromSku: 'S9' })).toBe(sku);
    expect(jssReport({ sales: { qc_reports: [sku] }, spec: { fromSku: 'S9', qcRemarks: 'own' } }).qcRemarks).toBe('own');
    expect(csaOfSpec({ qc_reports: [sku] }, { spec: 'X' })).toBeNull();
  });
});

describe('QC → JSS list → View', () => {
  it('opens the JSS report with the same details the CSA report shows', async () => {
    renderApp(<QC />, { modules: mods([SPEC], [REPORT]), role: 'qc' });
    await userEvent.click(await screen.findByLabelText('View JSS report A1500'));
    const card = await screen.findByLabelText('JSS report A1500');
    const w = within(card);
    expect(w.getByText('CC PET · 12 mic')).toBeInTheDocument();
    expect(w.getByText('Readable')).toBeInTheDocument();
    expect(w.getByText('500 per box')).toBeInTheDocument();
    expect(w.getByText(/QC remarks: Check seal strength/)).toBeInTheDocument();
    expect(w.getByText(/Plant: Run on CI/)).toBeInTheDocument();
  });

  it('a CSA converted to a JSS carries its QC remarks and plant comments onto the spec', async () => {
    const report = {
      id: 'R7', source: 'direct', company_name: 'Acme Foods', party_kind: 'customer', product_desc: 'New pouch',
      dispatch_type: 'Pouch', substrate1: 'CC PET', substrate1_val: 12, status: 'Done', created_at: '2026-11-01T00:00:00Z',
      remarks: 'Matt finish', plant_comments: 'OK to run', spec: { ...blankSheet(), packing: '250 per box' },
    };
    renderApp(<QC />, { modules: mods([], [report]), role: 'qc' });
    await userEvent.click(await screen.findByText(/CSA Reports/, { selector: '.step-tab' }));
    await userEvent.click(await screen.findByLabelText('Convert CSA for New pouch to JSS'));
    expect(await screen.findByLabelText('JSS QC remarks')).toHaveValue('Matt finish');
    expect(screen.getByText(/Plant \(from the CSA\): OK to run/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Primary Material')).toHaveValue('CC PET'));
  });
});
