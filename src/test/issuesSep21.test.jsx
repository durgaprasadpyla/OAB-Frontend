import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
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
    expect([...loc.options].map((o) => o.textContent)).toEqual(['— Select Location —', 'Dharapuram Kovai Own (KOVAI OWN)']);
    expect(screen.getByText(/Warehouse: KOVAI OWN/)).toBeInTheDocument();

    // under the Swiggy group, the filler Kova Agro offers the Swiggy warehouse alone
    await user.selectOptions(screen.getByLabelText('Group'), 'Swiggy');
    await user.selectOptions(screen.getByLabelText('Customer'), 'Kova Agro');
    const loc2 = screen.getByLabelText('Dispatch Location');
    expect([...loc2.options].map((o) => o.textContent)).toEqual(['— Select Location —', 'Dharapuram (DHARAPURAM)']);
  });

  // The shape the client actually has: BOTH rows carry the dispatch location
  // "Dharapuram" and differ only by the warehouse, so a picker keyed on the name
  // could not tell them apart — "I selected Kovai own but it is still showing
  // Darapuram at both the location and the warehouse".
  const SAME_NAME = [
    { customer: 'Kova Agro', group: 'Swiggy', dispatchLoc: 'Dharapuram', warehouseName: 'DHARAPURAM' },
    { customer: 'Kova Agro', group: '', dispatchLoc: 'Dharapuram', warehouseName: 'KOVAI OWN' },
  ];

  it('tells two same-named locations apart and carries the chosen warehouse onto the order', async () => {
    const user = userEvent.setup();
    const jss = [{ spec: 'A1', customer: 'Kova Agro', jobName: 'Coconut water 200 ml', dispatchForm: 'Shrink Sleeve', status: 'Active' }];
    // no group narrowing here: the customer is looked at across both rows, the way
    // an older record or a group-less master would leave it
    const both = SAME_NAME.map((r) => ({ ...r, group: '' }));
    const { saved } = renderApp(<NewPO />, { modules: { jss, prices: { A1: { price: 2 } }, customers: both, oab: oabModule({ lastSO: { y: '26', n: 766 } }) } });
    await screen.findByText('New PO Entry');

    await user.type(fieldByLabel(/PO Number/), 'PO-767');
    await user.selectOptions(screen.getByLabelText('Customer'), 'Kova Agro');
    const loc = screen.getByLabelText('Dispatch Location');
    // both are offered, each legible by its warehouse, and they are DIFFERENT choices
    expect([...loc.options].map((o) => o.textContent)).toEqual([
      '— Select Location —', 'Dharapuram (DHARAPURAM)', 'Dharapuram (KOVAI OWN)',
    ]);
    const kovai = [...loc.options].find((o) => o.textContent.includes('KOVAI OWN')).value;
    await user.selectOptions(loc, kovai);
    expect(screen.getByText(/Warehouse: KOVAI OWN/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));
    const checks = screen.getAllByRole('checkbox');
    await user.click(checks[checks.length - 1]);
    await user.type(screen.getByRole('spinbutton'), '100');
    await user.click(screen.getByRole('button', { name: /Review →/ }));
    // the confirm step names the warehouse on the order line, so the desk can see
    // WHICH "Dharapuram" this order is going to before it is created
    const row = (await screen.findByText('26/767')).closest('tr');
    expect(within(row).getByText('Dharapuram')).toBeInTheDocument();
    expect(within(row).getByText(/KOVAI OWN/)).toBeInTheDocument();
    expect(saved).toBeTruthy();
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
