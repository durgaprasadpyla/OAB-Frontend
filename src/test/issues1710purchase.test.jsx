import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import Purchase from '../pages/Purchase.jsx';

// "Issues as on 17.10.2026" §7 (Purchase login): "On the GRN page the horizontal
// scroll needs to be avoided … a radio button selection and once the radio button is
// selected, the buttons (Link GRN, Close PO …) can move to the top of the table."

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dmy = (iso) => iso.split('-').reverse().join('/');

const MASTER = [
  { id: 1, code: 'BLM031', name: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'ANTIFOG', uom: 'Kg' },
  { id: 2, code: 'LBL-9', name: 'Thermal label 100 x 150', materialType: 'LABEL', subGroup: 'THERMAL', specialtyName: 'KODAK SONARA XTRA THERMAL POSITIVE', uom: "No's" },
  { id: 3, code: 'INK-C', name: 'Cyan Ink', materialType: 'INK', subGroup: 'SOLVENT', specialtyName: 'SURFACE', uom: 'Kg' },
];
const ASL = [
  { company: 'Cosmo Films', itemCode: 'BLM031', specificMaterial: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'ANTIFOG', paymentTerms: '30 days', status: 'Active' },
  { company: 'Cosmo Films', itemCode: 'LBL-9', specificMaterial: 'Thermal label 100 x 150', materialType: 'LABEL', subGroup: 'THERMAL', specialty: 'KODAK SONARA XTRA THERMAL POSITIVE', paymentTerms: '30 days', status: 'Active' },
  { company: 'Siegwerk', itemCode: 'INK-C', specificMaterial: 'Cyan Ink', materialType: 'INK', subGroup: 'SOLVENT', specialty: 'SURFACE', paymentTerms: '15 days', status: 'Active' },
];

const PA = 'BLM/PUR/2026-2027/21';
const PB = 'BLM/PUR/2026-2027/22';
const POS = [
  // two lines: the second is a ↳ continuation row of the same PO
  { poNum: PA, poDate: daysAgo(30), supplier: 'Cosmo Films', status: 'Partial', expectedDelivery: daysAgo(17), actualReceiptDate: daysAgo(2),
    items: [
      { itemCode: 'BLM031', item: '460 MM', unit: 'Kg', qty: 100, rate: 142, amount: 14200, receivedQty: 60 },
      { itemCode: 'LBL-9', item: 'Thermal label 100 x 150', unit: "No's", qty: 5000, rate: 2, amount: 10000, receivedQty: 0 },
    ],
    receipts: [], paymentStatus: 'Unpaid' },
  { poNum: PB, poDate: daysAgo(3), supplier: 'Siegwerk', status: 'Open', expectedDelivery: daysAgo(-7),
    items: [{ itemCode: 'INK-C', item: 'Cyan Ink', unit: 'Kg', qty: 10, rate: 400, amount: 4000, receivedQty: 0 }],
    receipts: [], paymentStatus: 'Unpaid' },
];

async function mount(user, over = {}) {
  const utils = renderApp(<Purchase />, {
    modules: { masterItems: MASTER, purchase: { asl: ASL, pos: POS }, storeGrns: [], ...over },
    role: 'purchase', user: 'buyer1',
  });
  await user.click(screen.getByRole('button', { name: /PO Tracking & GRN/ }));
  const table = await screen.findByRole('table', { name: 'Open purchase orders' });
  return { ...utils, table, bar: screen.getByRole('toolbar', { name: 'Selected PO actions' }) };
}

describe('Issues 17.10 §7 — GRN Entry: radio selection, actions above the table', () => {
  it('drops the Actions column for a radio column, and keeps the toolbar buttons off until a PO is picked', async () => {
    const user = userEvent.setup();
    const { table, bar } = await mount(user);
    const heads = within(table).getAllByRole('columnheader');
    expect(heads.map((h) => h.textContent)).toEqual([
      '', 'PO #', 'Supplier', 'Item Code', 'Item Description', 'Material Type / Speciality',
      'Rate', 'Amount', 'PO Qty', 'Qty Recd', 'Receipt',
    ]);
    expect(within(table).queryByRole('columnheader', { name: /Action/ })).toBeNull();
    // no action button is left inside the table
    expect(within(table).queryByRole('button')).toBeNull();
    expect(within(bar).getByRole('button', { name: /📄 PO|Open PO document/ })).toBeDisabled();
    expect(within(bar).getByRole('button', { name: /Link GRN/ })).toBeDisabled();
    expect(within(bar).getByRole('button', { name: /Close PO/ })).toBeDisabled();
    expect(bar).toHaveTextContent('Pick the radio button');
  });

  it('one radio per PO, on its first row; picking it highlights the PO’s continuation rows too and names it on the toolbar', async () => {
    const user = userEvent.setup();
    const { table, bar } = await mount(user);
    expect(within(table).getAllByRole('radio')).toHaveLength(2); // PA has two lines, still one radio
    await user.click(within(table).getByRole('radio', { name: `Select PO ${PA}` }));

    const rowsA = within(table).getAllByRole('row').filter((tr) => tr.className === 'hi');
    expect(rowsA).toHaveLength(2);
    expect(rowsA[1]).toHaveTextContent('↳');
    expect(within(rowsA[1]).getByText('LBL-9')).toBeInTheDocument();
    expect(within(rowsA[1]).queryByRole('radio')).toBeNull();

    expect(bar).toHaveTextContent(`Selected: ${PA} · Cosmo Films`);
    expect(within(bar).getByRole('button', { name: `Open PO document ${PA}` })).not.toBeDisabled();
    expect(within(bar).getByRole('button', { name: `Link GRN ${PA}` })).not.toBeDisabled();

    // switching moves the highlight and the toolbar
    await user.click(within(table).getByRole('radio', { name: `Select PO ${PB}` }));
    expect(within(table).getByRole('radio', { name: `Select PO ${PA}` })).not.toBeChecked();
    const hi = within(table).getAllByRole('row').filter((tr) => tr.className === 'hi');
    expect(hi).toHaveLength(1);
    expect(hi[0]).toHaveTextContent('Siegwerk');
    expect(within(bar).getByRole('button', { name: `Link GRN ${PB}` })).toBeInTheDocument();
  });

  it('the toolbar’s 📄 PO opens the picked PO’s document', async () => {
    const user = userEvent.setup();
    const { table, bar } = await mount(user);
    await user.click(within(table).getByRole('radio', { name: `Select PO ${PB}` }));
    await user.click(within(bar).getByRole('button', { name: `Open PO document ${PB}` }));
    expect(await screen.findByRole('dialog', { name: `Purchase Order ${PB}` })).toBeInTheDocument();
  });

  it('the toolbar’s Link GRN opens the link panel under that PO, with Force Close kept in it', async () => {
    const user = userEvent.setup();
    const { table, bar } = await mount(user);
    await user.click(within(table).getByRole('radio', { name: `Select PO ${PA}` }));
    await user.click(within(bar).getByRole('button', { name: `Link GRN ${PA}` }));
    expect(await within(table).findByText(`Link the stores GRN — ${PA} · Cosmo Films`)).toBeInTheDocument();
    expect(within(table).getByLabelText('GRN Reference')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Force Close' })).toBeInTheDocument();
    // the panel spans the whole (narrower) table
    expect(within(table).getByText(`Link the stores GRN — ${PA} · Cosmo Films`).closest('td').colSpan).toBe(11);
  });

  it('lays out fixed, with a declared width on every column but the description — no horizontal scroll', async () => {
    const user = userEvent.setup();
    const { table } = await mount(user);
    expect(table.style.tableLayout).toBe('fixed');
    expect(table.style.width).toBe('100%');
    expect(table.style.minWidth).toBe('');
    const heads = [...table.querySelectorAll('thead th')];
    heads.forEach((th) => expect(th.style.width).not.toBe(''));
    const px = heads.filter((th) => th.style.width.endsWith('px')).reduce((s, th) => s + parseInt(th.style.width, 10), 0);
    expect(heads.find((th) => th.textContent === 'Item Description').style.width).toBe('auto');
    // the fixed columns leave the description room on a 1280px laptop content area
    expect(px).toBeLessThanOrEqual(960);
    // headers may wrap (the global thead th is nowrap)
    heads.forEach((th) => expect(th.style.whiteSpace).toBe('normal'));
  });

  it('keeps every value visible: Expected / Actual / Delay in one Receipt cell, Material Type and Speciality together', async () => {
    const user = userEvent.setup();
    const { table } = await mount(user);
    const receipt = within(table).getByLabelText(`Receipt of ${PA}`);
    expect(receipt).toHaveTextContent(`Exp ${dmy(daysAgo(17))}`);
    expect(receipt).toHaveTextContent(`Act ${dmy(daysAgo(2))}`);
    expect(receipt).toHaveTextContent(/Delay ⚠ \+\d+/);
    expect(within(table).getByLabelText(`Receipt of ${PB}`)).toHaveTextContent('Act -');

    const lblRow = within(table).getByText('LBL-9').closest('tr');
    await waitFor(() => expect(within(lblRow).getByTitle('Speciality')).toHaveTextContent('KODAK SONARA XTRA THERMAL POSITIVE'));
    expect(within(lblRow).getByTitle('Material Type')).toHaveTextContent('LABEL');
    // long text wraps instead of widening the column
    expect(within(lblRow).getByTitle('Speciality').closest('td').style.overflowWrap).toBe('anywhere');
    expect(within(lblRow).getByText('Thermal label 100 x 150').closest('td').style.overflowWrap).toBe('anywhere');
    // the rest is still all there
    ['142.00', '14,200.00', '100', '60'].forEach((v) => expect(within(table).getAllByText(v).length).toBeGreaterThan(0));
  });

  it('Close PO on the toolbar asks first, then force-closes the picked PO; it leaves the open list and the selection clears', async () => {
    const user = userEvent.setup();
    const { table, bar, saved } = await mount(user);
    await user.click(within(table).getByRole('radio', { name: `Select PO ${PB}` }));
    const close = within(bar).getByRole('button', { name: `Close PO ${PB}` });
    expect(close).not.toBeDisabled();

    // declined: nothing is sent, the PO stays picked
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await user.click(close);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain(PB);
    expect(saved.some((s) => /close/i.test(s.endpoint))).toBe(false);
    expect(within(table).getByRole('radio', { name: `Select PO ${PB}` })).toBeChecked();

    confirm.mockReturnValueOnce(true);
    await user.click(close);
    await waitFor(() => expect(saved.some((s) => /close/i.test(s.endpoint))).toBe(true));
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Open purchase orders' })).queryByText(PB)).toBeNull());
    expect(within(screen.getByRole('table', { name: 'Closed and cancelled purchase orders' })).getByText(PB)).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Close PO/ })).toBeDisabled();
    expect(bar).toHaveTextContent('Pick the radio button');
  });

  it('clears the selection when the picked PO leaves the open list', async () => {
    const user = userEvent.setup();
    const { table, bar } = await mount(user);
    await user.click(within(table).getByRole('radio', { name: `Select PO ${PB}` }));
    expect(within(bar).getByRole('button', { name: `Link GRN ${PB}` })).not.toBeDisabled();
    await waitFor(() => expect(within(screen.getByLabelText('PO material type filter')).getByRole('option', { name: 'FILM' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('PO material type filter'), { target: { value: 'FILM' } });
    await waitFor(() => expect(within(bar).getByRole('button', { name: /Link GRN/ })).toBeDisabled());
    expect(bar).toHaveTextContent('Pick the radio button');
    // …and it does not come back by itself when the PO returns
    fireEvent.change(screen.getByLabelText('PO material type filter'), { target: { value: '' } });
    const back = await within(screen.getByRole('table', { name: 'Open purchase orders' })).findByRole('radio', { name: `Select PO ${PB}` });
    expect(back).not.toBeChecked();
  });
});
