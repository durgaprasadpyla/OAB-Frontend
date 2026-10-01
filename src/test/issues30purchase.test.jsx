import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import Purchase from '../pages/Purchase.jsx';
import PDashboard from '../pages/PDashboard.jsx';
import { PurchaseOrders } from '../components/PurchaseOrdersTab.jsx';
import PurchaseOrderModal from '../components/PurchaseOrderDoc.jsx';

// "Issues as on 30.09.2026" — §Stores ¶S7 (purchase orders) and §Purchase PU1-PU5.

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const MASTER = [
  { id: 1, code: 'BLM031', name: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'ANTIFOG', uom: 'Kg' },
  { id: 2, code: 'BLM032', name: '480 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'PLAIN', uom: 'Kg' },
  { id: 3, code: 'INK-C', name: 'Cyan Ink', materialType: 'INK', subGroup: 'SOLVENT', specialtyName: 'SURFACE', uom: 'Kg' },
  { id: 4, code: 'PLT-1', name: 'Plate 637 x 520', materialType: 'PLATE', subGroup: 'CTP', specialtyName: 'DIGITAL', uom: "No's" },
];
const ASL = [
  { company: 'Cosmo Films', itemCode: 'BLM031', specificMaterial: '460 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'ANTIFOG',
    contact: 'Ravi', phone: '98480 11111', paymentTerms: '30 days', basicPrice: 142, uom: 'Kg', status: 'Active' },
  { company: 'Uflex', itemCode: 'BLM032', specificMaterial: '480 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialty: 'PLAIN',
    contact: 'Kiran', phone: '90000 12345', paymentTerms: '45 days', basicPrice: 150, status: 'Active' },
  { company: 'Siegwerk', itemCode: 'INK-C', specificMaterial: 'Cyan Ink', materialType: 'INK', subGroup: 'SOLVENT', specialty: 'SURFACE',
    contact: 'Neha', phone: '92222', paymentTerms: 'No limit', status: 'Active' },
  // Kapoor's plate: the PO line raised before 29.09 names it only as "637 x 520"
  { company: 'Kapoor Imaging', itemCode: 'PLT-1', specificMaterial: '637 x 520', materialType: 'PLATE', subGroup: 'CTP', specialty: 'DIGITAL',
    contact: 'Mr Kapoor', phone: '93333', paymentTerms: '15 days', status: 'Active' },
];

/* ── PU1: the PO preview sits above the role bar ───────────────────────── */

describe('PU1 — the purchase-order preview is visible', () => {
  const po = { poNum: 'BLM/PUR/2026-2027/101', supplier: 'Cosmo Films', poDate: '2026-09-26', items: [{ item: '460 MM', unit: 'Kg', qty: 100, rate: 142, amount: 14200 }] };

  it('sits above the sticky role bar / header (z-index 200), as a labelled dialog', () => {
    render(<PurchaseOrderModal po={po} asl={ASL} onClose={() => {}} />);
    const dlg = screen.getByRole('dialog', { name: 'Purchase Order BLM/PUR/2026-2027/101' });
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    const overlay = dlg.parentElement;
    expect(overlay.style.position).toBe('fixed');
    expect(Number(overlay.style.zIndex)).toBeGreaterThanOrEqual(1000);
  });

  it('keeps the title and Print / Download PDF / Close pinned while the sheet scrolls', () => {
    render(<PurchaseOrderModal po={po} asl={ASL} onClose={() => {}} />);
    const dlg = screen.getByRole('dialog');
    const bar = within(dlg).getByRole('button', { name: /Print/ }).parentElement;
    expect(bar.style.position).toBe('sticky');
    expect(bar.style.top).toBe('0px');
    expect(within(bar).getByText(/Purchase Order — BLM\/PUR\/2026-2027\/101/)).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Download PDF/ })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<PurchaseOrderModal po={po} asl={ASL} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens the new PO straight after Create PO', async () => {
    const user = userEvent.setup();
    const purchase = { asl: ASL, pos: [], priceHistory: [], counter: 0, itemsExtra: [] };
    renderApp(<Purchase />, { modules: { purchase, masterItems: MASTER }, role: 'purchase', user: 'purchase' });
    await screen.findByText(/Generate Purchase Order/);
    const supSel = screen.getByText('Supplier').closest('.fg').querySelector('select');
    await user.selectOptions(supSel, 'Cosmo Films');
    await user.selectOptions(screen.getByLabelText('Item code line 1'), 'BLM031');
    await user.type(screen.getByLabelText('Qty line 1'), '100');
    await user.click(screen.getByRole('button', { name: /Create PO/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Purchase Order BLM/PUR/2026-2027/1' });
    expect(within(dlg).getByText('PURCHASE ORDER')).toBeInTheDocument();
    // …and it can be reopened from the confirmation
    await user.click(within(dlg).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /View PO/ }));
    expect(screen.getByRole('dialog', { name: 'Purchase Order BLM/PUR/2026-2027/1' })).toBeInTheDocument();
  });
});

/* ── PU4: Qty and Rate headers line up with their boxes ───────────────── */

describe('PU4 — the Generate PO grid lines up', () => {
  it('starts the Qty / Rate headers where their stepper-less boxes start, in a fixed layout', async () => {
    renderApp(<Purchase />, { modules: { purchase: { asl: ASL, pos: [] } }, role: 'purchase' });
    await screen.findByText(/Generate Purchase Order/);
    const qtyTh = screen.getByRole('columnheader', { name: 'Qty' });
    const rateTh = screen.getByRole('columnheader', { name: 'Rate' });
    expect(qtyTh.style.textAlign).toBe('');
    expect(rateTh.style.textAlign).toBe('');
    for (const label of ['Qty line 1', 'Rate line 1']) {
      const box = screen.getByLabelText(label);
      expect(box).toHaveClass('nospin');
      expect(box.style.textAlign).toBe('');
      expect(box.style.width).toBe('100%');
      expect(box.type).toBe('number');
    }
    const table = qtyTh.closest('table');
    expect(table.style.tableLayout).toBe('fixed');
    // every declared width holds under a fixed layout — none is a min-width hint
    [...table.querySelectorAll('th')].forEach((th) => expect(th.style.width).not.toBe(''));
  });
});

/* ── PU2: the GRN is picked from the stores desk's receipts ────────────── */

const PO9 = 'BLM/PUR/2026-2027/9';
const trackPurchase = (over = {}) => ({
  asl: ASL,
  pos: [{
    poNum: PO9, poDate: daysAgo(5), supplier: 'Cosmo Films', status: 'Partial', expectedDelivery: daysAgo(-5),
    items: [{ itemCode: 'BLM031', item: '460 MM', unit: 'Kg', qty: 100, rate: 142, amount: 14200, receivedQty: 60 }],
    receipts: [{ date: daysAgo(1), ref: 'GRN/2026/5', source: 'stores' }], paymentStatus: 'Unpaid', ...over,
  }],
});
const GRN5 = {
  id: 5, grnNo: 'GRN/2026/5', poNum: PO9, supplier: 'Cosmo Films', grnDate: daysAgo(1), invoiceNo: 'INV-7',
  units: [
    { id: 51, itemId: 1, itemCode: 'BLM031', itemName: '460 MM', qtyReceived: 60, uom: 'Kg', parentUnitId: null },
    // a roll split off 51 later shares its GRN — it is not more material received
    { id: 52, itemId: 1, itemCode: 'BLM031', itemName: '460 MM', qtyReceived: 20, uom: 'Kg', parentUnitId: 51 },
  ],
};

async function openReceive(user, modules) {
  const utils = renderApp(<Purchase />, { modules: { masterItems: MASTER, ...modules }, role: 'purchase', user: 'buyer1' });
  await user.click(screen.getByRole('button', { name: /PO Tracking & GRN/ }));
  await user.click(await screen.findByRole('button', { name: `Link GRN ${PO9}` }));
  return utils;
}

describe('PU2 — the GRN reference is the stores desk’s, never typed', () => {
  it('auto-selects the one GRN stores booked against the PO, shows its quantities and links it on save', async () => {
    const user = userEvent.setup();
    const { saved } = await openReceive(user, { purchase: trackPurchase(), storeGrns: [GRN5, { id: 6, grnNo: 'GRN/2026/6', poNum: 'OTHER/PO', units: [] }] });
    const sel = screen.getByLabelText('GRN Reference');
    await waitFor(() => expect(sel).toHaveValue('GRN/2026/5'));
    expect(sel.tagName).toBe('SELECT');
    // only the receipts booked against THIS PO are offered
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'GRN/2026/5']);
    expect(screen.queryByRole('textbox', { name: 'GRN Reference' })).toBeNull();
    // the quantities are the stores desk's (the split-off child is not counted twice)
    await waitFor(() => expect(screen.getByLabelText('GRN quantity line 1')).toHaveTextContent('60'));
    expect(screen.getByLabelText('GRN receipt date')).toHaveValue(daysAgo(1));

    await user.click(screen.getByRole('button', { name: /Save GRN link/ }));
    await waitFor(() => expect(saved.some((s) => s.endpoint === '/api/purchase-orders/link-grn')).toBe(true));
    expect(saved.find((s) => s.endpoint === '/api/purchase-orders/link-grn').body).toMatchObject({ poNum: PO9, grnNo: 'GRN/2026/5' });
    // no typed quantities travel any more
    expect(saved.some((s) => s.endpoint === '/api/purchase-orders/grn')).toBe(false);
    expect(await screen.findByText(`✓ GRN/2026/5 linked to ${PO9}.`)).toBeInTheDocument();
    // the PO now says which GRN it was received on
    expect(await screen.findByTitle('GRNs linked by the purchase desk')).toHaveTextContent('GRN/2026/5');
  });

  it('with two GRNs selects neither, and lists both', async () => {
    const user = userEvent.setup();
    const two = [GRN5, { ...GRN5, id: 7, grnNo: 'GRN/2026/7', units: [] }];
    await openReceive(user, { purchase: trackPurchase(), storeGrns: two });
    const sel = screen.getByLabelText('GRN Reference');
    await waitFor(() => expect([...sel.options].map((o) => o.value)).toEqual(['', 'GRN/2026/5', 'GRN/2026/7']));
    expect(sel).toHaveValue('');
    expect(screen.getByRole('button', { name: /Save GRN link/ })).toBeDisabled();
  });

  it('when stores booked none: no typed box, a disabled list, Save off — Force Close still there', async () => {
    const user = userEvent.setup();
    await openReceive(user, { purchase: trackPurchase({ receipts: [] }), storeGrns: [] });
    const sel = screen.getByLabelText('GRN Reference');
    await waitFor(() => expect(sel).toHaveTextContent('no GRN booked by stores against this PO yet'));
    expect(sel).toBeDisabled();
    expect(screen.queryByRole('textbox', { name: 'GRN Reference' })).toBeNull();
    expect(screen.getByText(/has not booked a receipt against/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save GRN link/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Force Close' })).not.toBeDisabled();
  });

  it('reads the stores receipts afresh when the panel opens — a GRN booked after the page loaded is there', async () => {
    const user = userEvent.setup();
    const utils = renderApp(<Purchase />, { modules: { masterItems: MASTER, purchase: trackPurchase(), storeGrns: [] }, role: 'purchase' });
    await user.click(screen.getByRole('button', { name: /PO Tracking & GRN/ }));
    await screen.findByRole('button', { name: `Link GRN ${PO9}` });
    utils.mods.storeGrns.push(GRN5);                    // stores books it now
    await user.click(screen.getByRole('button', { name: `Link GRN ${PO9}` }));
    await waitFor(() => expect(screen.getByLabelText('GRN Reference')).toHaveValue('GRN/2026/5'));
  });
});

/* ── S7a / S7c on the purchase login ───────────────────────────────────── */

describe('S7 — the purchase login’s PO Tracking & GRN', () => {
  const pos = [
    { poNum: 'P-OPEN', poDate: daysAgo(20), supplier: 'Siegwerk', status: 'Open', expectedDelivery: daysAgo(5),
      items: [{ itemCode: 'INK-C', item: 'Cyan Ink', unit: 'Kg', qty: 10, rate: 400, amount: 4000, receivedQty: 0 }] },
    // raised before 29.09: the line names the plate by the supplier's words only
    { poNum: 'P-OLD', poDate: daysAgo(30), supplier: 'Kapoor Imaging', status: 'Open',
      items: [{ item: '637 x 520', unit: "No's", qty: 100, rate: 350, amount: 35000, receivedQty: 0 }] },
    { poNum: 'P-CAN', poDate: daysAgo(15), supplier: 'Cosmo Films', status: 'Cancelled', cancelled: true, cancelledDate: daysAgo(2),
      cancelReason: 'Duplicate', expectedDelivery: daysAgo(10),
      items: [{ itemCode: 'BLM031', item: '460 MM', unit: 'Kg', qty: 5, rate: 142, amount: 710, receivedQty: 0 }] },
    { poNum: 'P-CL', poDate: daysAgo(40), supplier: 'Uflex', status: 'Closed', closedDate: daysAgo(3),
      items: [{ itemCode: 'BLM032', item: '480 MM', unit: 'Kg', qty: 5, rate: 150, amount: 750, receivedQty: 5 }] },
  ];
  const mount = () => renderApp(<Purchase />, { modules: { masterItems: MASTER, purchase: { asl: ASL, pos } }, role: 'purchase' });

  it('drops a cancelled PO from the overdue nudge', async () => {
    mount();
    const banner = await screen.findByLabelText('Overdue purchase orders');
    expect(banner).toHaveTextContent('P-OPEN');
    expect(banner).not.toHaveTextContent('P-CAN');
  });

  it('keeps a cancelled PO out of GRN Entry; lists it under Closed & Cancelled, tagged, with no Reopen', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: /PO Tracking & GRN/ }));
    const open = await screen.findByRole('table', { name: 'Open purchase orders' });
    expect(within(open).getByText('P-OPEN')).toBeInTheDocument();
    expect(within(open).queryByText('P-CAN')).toBeNull();
    expect(within(open).queryByText('P-CL')).toBeNull();
    const closed = screen.getByRole('table', { name: 'Closed and cancelled purchase orders' });
    const canRow = within(closed).getByText('P-CAN').closest('tr');
    expect(within(canRow).getByText('Cancelled')).toBeInTheDocument();
    expect(within(canRow).queryByRole('button', { name: /Reopen/ })).toBeNull();
    const clRow = within(closed).getByText('P-CL').closest('tr');
    expect(within(clRow).getByRole('button', { name: /Reopen/ })).toBeInTheDocument();
  });

  it('shows item code, description, material type and speciality — resolved for a pre-29.09 line too', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: /PO Tracking & GRN/ }));
    const open = await screen.findByRole('table', { name: 'Open purchase orders' });
    ['Item Code', 'Item Description', 'Material Type', 'Speciality'].forEach((h) => (
      expect(within(open).getByRole('columnheader', { name: h })).toBeInTheDocument()));
    const old = within(open).getByText('P-OLD').closest('tr');
    await waitFor(() => expect(within(old).getByText('PLT-1')).toBeInTheDocument());
    expect(within(old).getByText('PLATE')).toBeInTheDocument();
    expect(within(old).getByText('DIGITAL')).toBeInTheDocument();
  });

  it('filters both cards by status and by material type', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: /PO Tracking & GRN/ }));
    await screen.findByRole('table', { name: 'Open purchase orders' });
    await waitFor(() => expect(within(screen.getByLabelText('PO material type filter')).getByRole('option', { name: 'INK' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('PO material type filter'), { target: { value: 'INK' } });
    const open = screen.getByRole('table', { name: 'Open purchase orders' });
    expect(within(open).getByText('P-OPEN')).toBeInTheDocument();
    expect(within(open).queryByText('P-OLD')).toBeNull();

    fireEvent.change(screen.getByLabelText('PO material type filter'), { target: { value: '' } });
    const status = screen.getByLabelText('PO status filter');
    expect([...status.options].map((o) => o.text)).toEqual(['All statuses', 'Open', 'Partially received', 'Closed', 'Cancelled']);
    fireEvent.change(status, { target: { value: 'Cancelled' } });
    expect(screen.getByText('No open POs match the filters.')).toBeInTheDocument();
    const closed = screen.getByRole('table', { name: 'Closed and cancelled purchase orders' });
    expect(within(closed).getByText('P-CAN')).toBeInTheDocument();
    expect(within(closed).queryByText('P-CL')).toBeNull();
  });

  it('keeps cancelled POs out of Payments, and never lets a "No limit" bill fall due', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: /Payments/ }));
    await screen.findByText('Payments / Bills Payable');
    const table = screen.getByRole('table');
    await waitFor(() => expect(within(table).getByText('P-OPEN')).toBeInTheDocument());
    expect(within(table).queryByText('P-CAN')).toBeNull();
    // Siegwerk is on "No limit": no due date, nothing overdue — however old the PO
    const row = within(table).getByText('P-OPEN').closest('tr');
    expect(within(row).getByText('No due date')).toBeInTheDocument();
    expect(within(row).getByText('Unpaid')).toBeInTheDocument();
    expect(within(row).queryByText(/Overdue/)).toBeNull();
  });
});

/* ── PU5: who supplies an item ──────────────────────────────────────────── */

describe('PU5 — Suppliers by Item', () => {
  it('lists the suppliers of a picked item with contact, number, terms and rate', async () => {
    const user = userEvent.setup();
    const pos = [{ poNum: 'PO/U1', poDate: '2026-09-01', supplier: 'Uflex', status: 'Closed', items: [{ itemCode: 'BLM032', item: '480 MM', rate: 149, unit: 'Kg' }] }];
    renderApp(<Purchase />, { modules: { masterItems: MASTER, purchase: { asl: ASL, pos } }, role: 'purchase' });
    await user.click(screen.getByRole('button', { name: /Suppliers by Item/ }));
    expect(screen.getByText(/Pick an item code, material type/)).toBeInTheDocument();
    // all five are dropdowns
    ['item code', 'material type', 'sub group', 'speciality', 'item description'].forEach((k) => (
      expect(screen.getByLabelText(`Find suppliers by ${k}`).tagName).toBe('SELECT')));

    await waitFor(() => expect(within(screen.getByLabelText('Find suppliers by item code')).getByRole('option', { name: 'BLM031 — 460 MM' })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Find suppliers by item code'), 'BLM031');
    const table = screen.getByRole('table', { name: 'Suppliers for the picked item' });
    const cosmo = within(table).getByText('Cosmo Films').closest('tr');
    ['Ravi', '98480 11111', '30 days', 'BLM031', 'Exact'].forEach((t) => expect(within(cosmo).getByText(t)).toBeInTheDocument());
    expect(within(cosmo).getByText('₹142.00 / Kg')).toBeInTheDocument();
    // a similar material's supplier, with what they were last ordered at
    const uflex = within(table).getByText('Uflex').closest('tr');
    expect(within(uflex).getByText('Similar')).toBeInTheDocument();
    expect(within(uflex).getByText(/₹150\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export Excel/ })).not.toBeDisabled();
  });

  it('narrows the other dropdowns by a pick', async () => {
    const user = userEvent.setup();
    renderApp(<Purchase />, { modules: { masterItems: MASTER, purchase: { asl: ASL, pos: [] } }, role: 'purchase' });
    await user.click(screen.getByRole('button', { name: /Suppliers by Item/ }));
    await waitFor(() => expect(within(screen.getByLabelText('Find suppliers by material type')).getByRole('option', { name: 'INK' })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Find suppliers by material type'), 'INK');
    const codes = [...screen.getByLabelText('Find suppliers by item code').options].map((o) => o.value).filter(Boolean);
    expect(codes).toEqual(['INK-C']);
    expect(within(screen.getByRole('table', { name: 'Suppliers for the picked item' })).getByText('Siegwerk')).toBeInTheDocument();
  });
});

/* ── S7 on the P Dashboard ──────────────────────────────────────────────── */

describe('S7 — the P Dashboard PO Tracking', () => {
  const pos = [
    { poNum: 'D-OPEN', poDate: '2026-09-20', supplier: 'Siegwerk', status: 'Open', items: [{ itemCode: 'INK-C', item: 'Cyan Ink', qty: 10, rate: 400, amount: 4000 }] },
    { poNum: 'D-CAN', poDate: '2026-09-21', supplier: 'Cosmo Films', status: 'Cancelled', cancelled: true, cancelReason: 'Duplicate',
      items: [{ itemCode: 'BLM031', item: '460 MM', qty: 5, rate: 142, amount: 710 }] },
  ];

  it('labels a cancelled PO Cancelled, counts it, and filters by it — with the identity columns', async () => {
    renderApp(<PDashboard />, { modules: { masterItems: MASTER, purchase: { asl: ASL, pos } }, role: 'padmin' });
    await waitFor(() => expect(screen.getByText('D-CAN')).toBeInTheDocument());
    const canRow = screen.getByText('D-CAN').closest('tr');
    expect(within(canRow).getByText('✕ Cancelled')).toHaveClass('tr');
    expect(screen.getByText('✕ Cancelled', { selector: '.sl' })).toBeInTheDocument();
    ['Item Code', 'Item Description', 'Material Type', 'Speciality'].forEach((h) => (
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument()));
    expect(within(canRow).getByText('FILM')).toBeInTheDocument();

    const status = screen.getByLabelText('PO status filter');
    expect(within(status).getByRole('option', { name: 'Cancelled' })).toBeTruthy();
    fireEvent.change(status, { target: { value: 'Open' } });
    expect(screen.queryByText('D-CAN')).toBeNull();
    expect(screen.getByText('D-OPEN')).toBeInTheDocument();
  });
});

/* ── S7 on the stores desk (and, read-only, the PM) ─────────────────────── */

describe('S7 — the stores Purchase Orders tab', () => {
  const pos = [
    { poNum: 'S-OPEN', poDate: '2026-09-28', supplier: 'Kapoor Imaging', status: 'Open', expectedDelivery: '2026-10-11',
      items: [{ item: '637 x 520', unit: "No's", qty: 100, receivedQty: 0 }] },
    { poNum: 'S-PART', poDate: '2026-09-27', supplier: 'Siegwerk', status: 'Partial', expectedDelivery: '2026-10-01',
      items: [{ itemCode: 'INK-C', item: 'Cyan Ink', unit: 'Kg', qty: 10, receivedQty: 4 }] },
    { poNum: 'S-CAN', poDate: '2026-09-30', supplier: 'Cosmo Films', status: 'Cancelled', cancelled: true,
      items: [{ itemCode: 'BLM031', item: '460 MM', unit: 'Kg', qty: 5 }] },
    { poNum: 'S-CL', poDate: '2026-09-20', supplier: 'Uflex', status: 'Closed',
      items: [{ itemCode: 'BLM032', item: '480 MM', unit: 'Kg', qty: 5, receivedQty: 5 }] },
  ];
  const ETA = { poNum: 'S-PART', itemName: 'Cyan Ink', expectedDate: '2026-10-15', actor: 'store1', updatedAt: '2026-09-30T10:00:00Z' };
  const mount = (over = {}) => renderApp(<PurchaseOrders flash={() => {}} {...over} />, {
    modules: { masterItems: MASTER, purchase: { asl: ASL, pos }, storeEtas: [ETA] }, role: 'stores',
  });

  it('"Open POs only" hides Cancelled as well as Closed', async () => {
    mount();
    await screen.findByText('S-OPEN');
    expect(screen.getByText('S-PART')).toBeInTheDocument();
    expect(screen.queryByText('S-CAN')).toBeNull();
    expect(screen.queryByText('S-CL')).toBeNull();
    expect(screen.getByLabelText('Purchase order line count')).toHaveTextContent('2 lines · 2 POs');
  });

  it('a status filter reaches the cancelled ones (and lifts "open only")', async () => {
    mount();
    await screen.findByText('S-OPEN');
    fireEvent.change(screen.getByLabelText('PO status filter'), { target: { value: 'Cancelled' } });
    expect(screen.getByText('S-CAN')).toBeInTheDocument();
    expect(screen.queryByText('S-OPEN')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Open POs only' })).not.toBeChecked();
    expect(within(screen.getByText('S-CAN').closest('tr')).getByText('Cancelled')).toHaveClass('tr');
  });

  it('has no "Told by" column; shows item code, description, material type and speciality', async () => {
    mount();
    await screen.findByText('S-OPEN');
    expect(screen.queryByRole('columnheader', { name: /told by/i })).toBeNull();
    ['Item Code', 'Item Description', 'Material Type', 'Speciality', 'Expected On'].forEach((h) => (
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument()));
    // the pre-29.09 Kapoor line, named through the ASL and the Item Master
    const row = screen.getByText('S-OPEN').closest('tr');
    await waitFor(() => expect(within(row).getByText('PLT-1')).toBeInTheDocument());
    expect(within(row).getByText('PLATE')).toBeInTheDocument();
    expect(within(row).getByText('28/09/2026')).toBeInTheDocument();   // PO date, as a date
  });

  it('filters by material type and speciality', async () => {
    mount();
    await screen.findByText('S-OPEN');
    await waitFor(() => expect(within(screen.getByLabelText('PO material type filter')).getByRole('option', { name: 'INK' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('PO material type filter'), { target: { value: 'INK' } });
    expect(screen.queryByText('S-OPEN')).toBeNull();
    expect(screen.getByText('S-PART')).toBeInTheDocument();
    expect([...screen.getByLabelText('PO speciality filter').options].map((o) => o.value).filter(Boolean)).toEqual(['SURFACE']);
  });

  it('starts Expected On at the date Purchase put on the PO, and says whose date it is', async () => {
    const { saved } = mount();
    await screen.findByText('S-OPEN');
    // Kapoor: entered in the purchase login, no stores revision → not blank any more
    const kapoor = screen.getByLabelText('Expected date for 637 x 520 on S-OPEN');
    expect(kapoor).toHaveValue('2026-10-11');
    expect(within(kapoor.closest('td')).getByText('from PO (Purchase login)')).toBeInTheDocument();
    // a stores revision wins, and says so (the box re-reads once the revisions arrive)
    await waitFor(() => expect(screen.getByLabelText('Expected date for Cyan Ink on S-PART')).toHaveValue('2026-10-15'));
    expect(within(screen.getByLabelText('Expected date for Cyan Ink on S-PART').closest('td'))
      .getByText('revised by stores · store1 · 30/09/2026')).toBeInTheDocument();
    // revising saves the stores date
    fireEvent.change(kapoor, { target: { value: '2026-10-20' } });
    fireEvent.blur(kapoor);
    await waitFor(() => expect(saved.some((s) => s.endpoint === '/api/stores/po-eta' && s.method === 'PUT'
      && s.body.expectedDate === '2026-10-20' && s.body.poNum === 'S-OPEN')).toBe(true));
  });

  it('read-only (the PM): the date is text, nothing to type into', async () => {
    mount({ readOnly: true });
    await screen.findByText('S-OPEN');
    expect(screen.queryByLabelText(/Expected date for/)).toBeNull();
    expect(screen.getByLabelText('Expected on for 637 x 520 on S-OPEN')).toHaveTextContent('11/10/2026');
  });
});
