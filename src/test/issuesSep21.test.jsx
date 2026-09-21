import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import NewPO from '../pages/NewPO.jsx';
import OabBoard from '../pages/OabBoard.jsx';
import { getCustLocations, getCustByLoc } from '../lib/master.js';

// The client's 21 Sep 2026 WhatsApp batch — the two order-desk items:
//
//  · "Kova Agro is a filler for Swiggy … I have created two customers with the same
//    name, one as a part of the group and the other as an independent one … To
//    select Kowai Own whenever I am not selecting a group here in the PO adding
//    page, it should give me only that one location. However it is showing me both."
//  · "We have added A1404 as a shrink sleeve from the backend … When I added a
//    purchase order for A1404, it is showing as a label in the despatch form."

const fieldByLabel = (re) => {
  const lbl = screen.getByText(re);
  return (lbl.closest('.fg') || lbl.parentElement).querySelector('input, textarea, select');
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const KOVA = [
  { customer: 'Kova Agro', group: 'Swiggy', dispatchLoc: 'Dharapuram', warehouseName: 'DHARAPURAM' },
  { customer: 'Kova Agro', group: '', dispatchLoc: 'Dharapuram Kovai Own', warehouseName: 'KOVAI OWN' },
  { customer: 'Swiggy Bengaluru', group: 'Swiggy', dispatchLoc: 'Bengaluru', warehouseName: 'BLR' },
];

describe('one name, two customers — the locations follow the group', () => {
  it('offers only the ungrouped rows when no group is given, and only the group’s under one', () => {
    expect(getCustLocations(KOVA, 'Kova Agro').map((r) => r.dispatchLoc)).toEqual(['Dharapuram', 'Dharapuram Kovai Own']);   // no group asked → as before
    expect(getCustLocations(KOVA, 'Kova Agro', '').map((r) => r.dispatchLoc)).toEqual(['Dharapuram Kovai Own']);
    expect(getCustLocations(KOVA, 'Kova Agro', 'Swiggy').map((r) => r.dispatchLoc)).toEqual(['Dharapuram']);
    // a group the name is not kept under falls back to every row of the name
    expect(getCustLocations(KOVA, 'Kova Agro', 'Amazon').map((r) => r.dispatchLoc)).toEqual(['Dharapuram', 'Dharapuram Kovai Own']);
    expect(getCustByLoc(KOVA, 'Kova Agro', 'Dharapuram Kovai Own', '').warehouseName).toBe('KOVAI OWN');
    expect(getCustByLoc(KOVA, 'Kova Agro', 'Dharapuram', 'Swiggy').warehouseName).toBe('DHARAPURAM');
  });

  it('New PO: with no group picked, the independent Kova Agro offers its own warehouse alone', async () => {
    const user = userEvent.setup();
    const jss = [{ spec: 'A1', customer: 'Kova Agro', jobName: 'Coconut water 200 ml', dispatchForm: 'Shrink Sleeve', status: 'Active' }];
    renderApp(<NewPO />, { modules: { jss, prices: {}, customers: KOVA, oab: oabModule() } });
    await screen.findByText('New PO Entry');

    // no group → the ungrouped customers only, and Kova Agro's own location is picked by itself
    await user.selectOptions(screen.getByLabelText('Customer'), 'Kova Agro');
    const loc = screen.getByLabelText('Dispatch Location');
    expect([...loc.options].map((o) => o.value)).toEqual(['', 'Dharapuram Kovai Own']);
    expect(loc.value).toBe('Dharapuram Kovai Own');
    expect(screen.getAllByText(/KOVAI OWN/).length).toBeGreaterThanOrEqual(1);   // the option label and the warehouse line

    // under the Swiggy group, the filler Kova Agro offers the Swiggy warehouse alone
    await user.selectOptions(screen.getByLabelText('Group'), 'Swiggy');
    await user.selectOptions(screen.getByLabelText('Customer'), 'Kova Agro');
    const loc2 = screen.getByLabelText('Dispatch Location');
    expect([...loc2.options].map((o) => o.value)).toEqual(['', 'Dharapuram']);
  });
});

describe('the dispatch form on the OAB is the JSS’s', () => {
  const jss = [
    // re-tagged after the PO was raised: the OAB row still says Label
    { spec: 'A1404', customer: 'Just Coco', jobName: 'Just Coco coconut water 200 ml', dispatchForm: 'Shrink Sleeve', jobType: 'Shrink Sleeve', height: 100, status: 'Active' },
    { spec: 'A1', customer: 'Acme', jobName: 'Pouch A', dispatchForm: 'Pouch', width: 100, status: 'Active' },
  ];
  const oab = oabModule({ SF: [
    { so: '26/228', spec: 'A1404', customer: 'Just Coco', jobName: 'Just Coco coconut water 200 ml', subBrand: 'Just Coco', dispLoc: 'Dharapuram', dispatchForm: 'Label', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-21', poNum: '228' },
    { so: '26/229', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', dispatchForm: 'Pouch', poQty: 10, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-21', poNum: '229' },
  ] });

  it('shows the spec’s current form, not the copy the row took at PO time', async () => {
    renderApp(<OabBoard />, { modules: { jss, oab, customers: [], prices: {} }, role: 'superadmin' });
    const cell = (await screen.findByText('26/228')).closest('tr');
    expect(within(cell).getByText('Shrink Sleeve')).toBeInTheDocument();
    expect(within(cell).queryByText('Label')).toBeNull();
    // a row whose spec agrees is unchanged
    expect(within(screen.getByText('26/229').closest('tr')).getByText('Pouch')).toBeInTheDocument();
  });

  it('New PO copies the spec as it is NOW — the JSS is re-read before the SKU list is built', async () => {
    const user = userEvent.setup();
    const stale = [{ spec: 'A1404', customer: 'Just Coco', jobName: 'Coconut water', dispatchForm: 'Label', status: 'Active' }];
    const customers = [{ customer: 'Just Coco', group: '', dispatchLoc: 'Dharapuram', warehouseName: 'DHARAPURAM' }];
    // the page loads the STALE spec (Label); the server copy is then re-tagged to
    // Shrink Sleeve, the way a JSS edit in another session leaves this browser behind
    const { mods } = renderApp(<NewPO />, { modules: { jss: stale, prices: {}, customers, oab: oabModule() } });
    await screen.findByText('New PO Entry');
    mods.jss = JSON.parse(JSON.stringify(jss));
    await user.type(fieldByLabel(/PO Number/), 'PO-228');
    await user.selectOptions(screen.getByLabelText('Customer'), 'Just Coco');
    await user.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));
    const row = (await screen.findByText('Just Coco coconut water 200 ml')).closest('tr');
    expect(within(row).getByText('Shrink Sleeve')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('checkbox'));
  });
});
