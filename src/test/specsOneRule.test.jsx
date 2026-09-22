import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import OabBoard from '../pages/OabBoard.jsx';
import {
  specKey, specIsActive, chooseSpecRow, specIndex, specFor, uniqueSpecs, duplicateSpecs,
} from '../lib/specs.js';
import { getCostPrice } from '../lib/pricing.js';

// The client, 22 Sep 2026:
//   "A1404 is in the QC login JSS root and in BOM it is being shown as label
//    whereas in the JSS editor and super admin it is being shown as shrink sleeve …
//    It is taking the label reference from the QC log and it is being displayed as
//    a label in the OAB file as well as in other OABs."
//
// One spec code, two rows, and every screen picking its own copy: QC / BOM / the
// Price Master took the FIRST, the JSS editor / OAB / Trends took the LAST.

const LABEL = { spec: 'A1404', customer: 'Just Coco', jobName: 'Coconut water 200 ml', dispatchForm: 'Label', status: 'Active', material: 'BOPP', filmWidth: 300, gsm: 50, height: 100 };
const SLEEVE = { ...LABEL, dispatchForm: 'Shrink Sleeve', jobType: 'Shrink Sleeve', material: 'CC PET + LDPE' };
const BOTH = [LABEL, SLEEVE];

describe('which row IS a spec code', () => {
  it('reads a code case- and space-blind', () => {
    expect(specKey(' a1404 ')).toBe('A1404');
    expect(specKey(null)).toBe('');
  });

  it('treats a row with no status as Active', () => {
    expect(specIsActive({})).toBe(true);
    expect(specIsActive({ status: 'active' })).toBe(true);
    expect(specIsActive({ status: 'Inactive' })).toBe(false);
    expect(specIsActive({ status: 'Redundant' })).toBe(false);
  });

  it('prefers an Active row, then the most recent one', () => {
    // the newest Active row wins over an older Active one …
    expect(chooseSpecRow(BOTH)).toBe(SLEEVE);
    // … and an Active row wins over a newer retired one, whichever way round they sit
    const retired = { ...SLEEVE, status: 'Redundant' };
    expect(chooseSpecRow([LABEL, retired])).toBe(LABEL);
    expect(chooseSpecRow([retired, LABEL])).toBe(LABEL);
    // nothing Active at all → still the most recent, rather than nothing
    expect(chooseSpecRow([{ ...LABEL, status: 'Inactive' }, retired])).toBe(retired);
    expect(chooseSpecRow([])).toBe(null);
  });

  it('answers the same for an index, a single lookup and a list', () => {
    expect(specIndex(BOTH).A1404).toBe(SLEEVE);
    expect(specFor(BOTH, 'a1404')).toBe(SLEEVE);
    expect(uniqueSpecs([...BOTH, { spec: 'A1', jobName: 'Other' }]).map((r) => r.spec)).toEqual(['A1404', 'A1']);
    expect(uniqueSpecs(BOTH)).toEqual([SLEEVE]);          // one row per code, not two
    expect(specFor(BOTH, 'nope')).toBe(null);
  });

  it('names the codes held twice and what they disagree about', () => {
    const d = duplicateSpecs([...BOTH, { spec: 'A1', jobName: 'Fine' }]);
    expect(d).toHaveLength(1);
    expect(d[0].code).toBe('A1404');
    expect(d[0].count).toBe(2);
    expect(d[0].winner).toBe(SLEEVE);
    const fields = Object.fromEntries(d[0].differing.map((f) => [f.label, f.values]));
    expect(fields['Dispatch Form']).toEqual(['Label', 'Shrink Sleeve']);
    expect(fields.Material).toEqual(['BOPP', 'CC PET + LDPE']);
    expect(fields['Job Name']).toBeUndefined();           // they agree on this one
    expect(duplicateSpecs([LABEL])).toEqual([]);
  });

  it('prices the spec off the winning row, so the margin matches what the screens show', () => {
    // the live RM cost comes from the JSS material and pouch weight; two rows with
    // different materials priced the same spec differently depending on the caller
    const bopp = { ...LABEL, material: 'BOPP', pouchWeight: 2000 };            // 2 kg/pc
    const ldpe = { ...SLEEVE, material: 'AF-LDPE', pouchWeight: 2000 };
    const matRates = { bopp: 100, afldpe: 250 };
    // the newest Active row (AF-LDPE) is the one that prices it, from either order
    expect(getCostPrice('A1404', { prices: {}, jss: [bopp, ldpe], matRates })).toBe(500);
    // retire that row and the Active BOPP one speaks for the code again
    expect(getCostPrice('A1404', { prices: {}, jss: [bopp, { ...ldpe, status: 'Redundant' }], matRates })).toBe(200);
  });
});

const oab = oabModule({ SF: [
  { so: '26/767', spec: 'A1404', customer: 'Just Coco', jobName: 'Coconut water 200 ml', dispLoc: 'Dharapuram', dispatchForm: 'Label', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-21', poNum: 'PO-767' },
] });
const seed = { jss: BOTH, oab, customers: [{ customer: 'Just Coco', group: '', dispatchLoc: 'Dharapuram', warehouseName: 'KOVAI OWN' }], prices: {}, sales: {} };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the screens agree about A1404', () => {
  it('the OAB board reads the winning row, not the order’s stale copy', async () => {
    renderApp(<OabBoard />, { modules: seed, role: 'superadmin' });
    const row = (await screen.findByText('26/767')).closest('tr');
    expect(within(row).getByText('Shrink Sleeve')).toBeInTheDocument();
    expect(within(row).queryByText('Label')).toBeNull();
  });

  it('the JSS editor says the code is on two rows, and which one is in force', async () => {
    renderApp(<Dashboard />, { modules: seed, role: 'superadmin' });
    fireEvent.click(await screen.findByText('📋 JSS Editor'));
    const warn = await screen.findByLabelText('Duplicate spec numbers');
    expect(warn).toHaveTextContent('1 spec number is on more than one row');
    expect(warn).toHaveTextContent('Dispatch Form (Label / Shrink Sleeve)');
    expect(warn).toHaveTextContent('Shrink Sleeve · Active');       // in force
    expect(screen.getAllByText('dup').length).toBe(2);              // both rows are marked
  });
});

describe('the JSS editor edits a row the way QC creates one', () => {
  it('picks a row with its radio and edits it in the form above the table', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<Dashboard />, { modules: seed, role: 'superadmin' });
    fireEvent.click(await screen.findByText('📋 JSS Editor'));
    // nothing is picked to begin with, and the table is READ-ONLY (no inputs in it)
    expect(screen.getByText(/Pick a row below with its radio button/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Dispatch Form')).toBeNull();

    // the second A1404 row — the Shrink Sleeve one
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    await user.click(radios[1]);

    // the form carries that row, in the same guided fields QC uses
    expect(screen.getByLabelText('Spec No.')).toHaveValue('A1404');
    expect(screen.getByLabelText('Dispatch Form')).toHaveValue('Shrink Sleeve');
    expect(screen.getByLabelText('Material')).toHaveValue('CC PET + LDPE');
    expect(screen.getByLabelText('Status')).toHaveValue('Active');

    // retire it, save, and the whole master is written with that row changed
    await user.selectOptions(screen.getByLabelText('Status'), 'Inactive');
    await user.click(screen.getByRole('button', { name: /Save spec/ }));
    await waitFor(() => expect(saved.some((s) => s.id === 2)).toBe(true));
    const written = saved.filter((s) => s.id === 2).at(-1).data;
    expect(written).toHaveLength(2);
    expect(written[1]).toMatchObject({ spec: 'A1404', dispatchForm: 'Shrink Sleeve', status: 'Inactive' });
    expect(written[0]).toMatchObject({ dispatchForm: 'Label', status: 'Active' });   // the other row is untouched
  });

  it('warns before a second row is given a code another row already holds', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const one = { jss: [LABEL, { spec: 'A1', jobName: 'Other', dispatchForm: 'Pouch', material: 'BOPP', status: 'Active' }], oab, customers: [], prices: {}, sales: {} };
    const { saved } = renderApp(<Dashboard />, { modules: one, role: 'superadmin' });
    fireEvent.click(await screen.findByText('📋 JSS Editor'));
    await user.click(screen.getAllByRole('radio')[1]);          // the A1 row
    const code = screen.getByLabelText('Spec No.');
    await user.clear(code);
    await user.type(code, 'A1404');                            // … re-typed as A1404
    await user.click(screen.getByRole('button', { name: /Save spec/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain('already on another row');
    expect(saved.some((s) => s.id === 2)).toBe(false);          // declined → nothing written
  });

  it('carries a re-tagged dispatch form onto the open orders', async () => {
    const user = userEvent.setup();
    const one = { ...seed, jss: [LABEL] };                      // a single row, tagged Label
    const { saved } = renderApp(<Dashboard />, { modules: one, role: 'superadmin' });
    fireEvent.click(await screen.findByText('📋 JSS Editor'));
    await user.click(screen.getAllByRole('radio')[0]);
    await user.selectOptions(screen.getByLabelText('Dispatch Form'), 'Shrink Sleeve');
    await user.click(screen.getByRole('button', { name: /Save spec/ }));
    await waitFor(() => expect(saved.some((s) => s.id === 1)).toBe(true));
    const oabWritten = saved.filter((s) => s.id === 1).at(-1).data;
    expect(oabWritten.OAB.SF[0].dispatchForm).toBe('Shrink Sleeve');
  });
});
