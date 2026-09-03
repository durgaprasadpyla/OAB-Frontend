import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import Stores from '../pages/Stores.jsx';
import GrnAdmin, { RmPriceAdmin } from '../components/GrnAdmin.jsx';
import { canAccess } from '../lib/roles.js';

// Issues 2.7 — the business could not read the price it was typing on the GRN, and
// once a receipt was booked there was no way back to it.
//   §1/§2 the Qty and Price boxes are the same comfortable width, with the stepper
//         arrows gone (they ate ~17px and nobody clicks them).
//   §3    Super Admin → GRN Entries: correct a booked receipt.
//   §4    Super Admin → RM Prices: reprice material still in stock.
// The screens are Super-Admin-only; hiding them is convenience, the control is the
// server (Issues24Test.nobodyButTheSuperAdminMayCorrectAReceiptOrRepriceStock).

const res = (status, body) => ({
  status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

const GRNS = [
  { id: 1, grnNo: 'GRN/2026/1', poNum: 'PO-9', supplier: 'Jindal', grnDate: '2026-09-01', invoiceNo: 'INV-1', invoiceDate: '2026-08-30', notes: '', actor: 'store1', units: 2 },
  { id: 2, grnNo: 'GRN/2026/2', poNum: 'PO-10', supplier: 'Siegwerk', grnDate: '2026-09-02', invoiceNo: 'INV-2', invoiceDate: null, notes: '', actor: 'store1', units: 1 },
];
const DETAIL = {
  id: 1, grnNo: 'GRN/2026/1', poNum: 'PO-9', supplier: 'Jindal', grnDate: '2026-09-01',
  invoiceNo: 'INV-1', invoiceDate: '2026-08-30', notes: '', actor: 'store1', createdAt: '2026-09-01T10:00:00Z',
  units: [
    { id: 11, internalCode: 'BLMU-1', itemCode: 'FILM-1', itemName: 'BOPP 20mic', supplierCode: 'CF-1', uom: 'Kg', qtyReceived: 100, qtyRemaining: 100, price: 120, location: 'A2', expiryDate: null, qtyLocked: false },
    { id: 12, internalCode: 'BLMU-2', itemCode: 'FILM-1', itemName: 'BOPP 20mic', supplierCode: 'CF-2', uom: 'Kg', qtyReceived: 50, qtyRemaining: 20, price: 120, location: 'B3', expiryDate: null, qtyLocked: true },
  ],
};
const RM = [
  { itemId: 5, code: 'FILM-1', name: 'BOPP 20mic', uom: 'Kg', materialType: 'FILM', subGroup: 'AF BOPP', onHand: 120, units: 2, priceLow: 120, priceHigh: 140, stockValue: 15000 },
  { itemId: 6, code: 'INK-1', name: 'Cyan Ink', uom: 'Kg', materialType: 'INK', subGroup: 'C I FLEXO', onHand: 0, units: 0, priceLow: null, priceHigh: null, stockValue: 0 },
];

let calls;
let grnDetail;
beforeEach(() => {
  calls = [];
  grnDetail = JSON.parse(JSON.stringify(DETAIL));
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'superadmin');
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ u: u.replace(/^.*\/api/, '/api'), method, body });
    if (u.includes('/api/auth/me')) return res(200, { username: 'superadmin', role: 'superadmin' });
    if (u.match(/\/api\/stores\/grns\/\d+$/)) {
      if (method === 'PUT') { Object.assign(grnDetail, body); return res(200, grnDetail); }
      return res(200, grnDetail);
    }
    if (u.includes('/api/stores/grns')) return res(200, GRNS);
    if (u.match(/\/api\/stores\/units\/\d+$/) && method === 'PUT') {
      const unit = grnDetail.units.find((x) => String(x.id) === u.split('/').pop());
      Object.assign(unit, body.price != null ? { price: Number(body.price) } : {}, body.location != null ? { location: body.location } : {});
      return res(200, unit);
    }
    if (u.includes('/api/stores/rm-prices')) return res(200, RM);
    if (u.match(/\/api\/stores\/items\/\d+\/price$/) && method === 'PUT') return res(200, { unitsUpdated: 2 });
    if (u.includes('/api/stores/on-hand')) return res(200, []);
    if (u.includes('/api/master/items')) return res(200, []);
    if (u.includes('/api/stores/locations')) return res(200, []);
    if (u.includes('/rest/v1/oab_data')) return res(200, [{ id: 6, data: JSON.stringify({ asl: [], pos: [] }), version: 1 }]);
    return res(200, []);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = (ui) => render(<MemoryRouter><AuthProvider><DataProvider>{ui}</DataProvider></AuthProvider></MemoryRouter>);

/* ── §1 + §2: the GRN number boxes ──────────────────────────────────────── */

describe('Issues 2.7 §1-2 — the GRN Qty and Price boxes', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

  it('hides the stepper arrows in every engine the app supports', () => {
    // jsdom does no layout, so this is the CSS contract — WebKit/Blink pseudo-elements
    // plus the Firefox/standard appearance property.
    const webkit = css.split('\n').find((l) => l.includes('input.nospin::-webkit-inner-spin-button'));
    expect(webkit, 'no .nospin webkit rule').toBeTruthy();
    expect(webkit).toMatch(/-webkit-appearance:none/);
    expect(webkit).toMatch(/appearance:none/);
    expect(webkit).toContain('::-webkit-outer-spin-button');
    const moz = css.split('\n').find((l) => /^input\.kam-numinput,input\.nospin\{/.test(l));
    expect(moz, 'no .nospin appearance rule').toBeTruthy();
    expect(moz).toMatch(/-moz-appearance:textfield/);
    expect(moz).toMatch(/[^-]appearance:textfield/);
  });

  it('keeps Qty and Price numeric, spinner-free and the same width', async () => {
    mount(<Stores />);
    await screen.findByText(/GRN/);
    fireEvent.click(screen.getByText(/📥 GRN/));
    await screen.findByText('📥 New goods receipt');

    const qty = screen.getByLabelText('Quantity line 1');
    const price = screen.getByLabelText('Price line 1');
    // still numeric inputs — the ask was to drop the arrows, not the validation
    [qty, price].forEach((el) => {
      expect(el.getAttribute('type')).toBe('number');
      expect(el.getAttribute('step')).toBe('any');   // decimals still allowed
      expect(el.getAttribute('min')).toBe('0');
      expect(el.className).toContain('nospin');
    });
    // and their columns are the same width, so neither reads as the cramped one
    const width = (el) => el.closest('table').querySelectorAll('th')[
      [...el.closest('tr').children].indexOf(el.closest('td'))].style.width;
    expect(width(qty)).toBe(width(price));
    expect(parseInt(width(price), 10)).toBeGreaterThanOrEqual(128);
  });

  it('still accepts a decimal price typed by hand', async () => {
    mount(<Stores />);
    fireEvent.click(await screen.findByText(/📥 GRN/));
    await screen.findByText('📥 New goods receipt');
    const price = screen.getByLabelText('Price line 1');
    fireEvent.change(price, { target: { value: '155.75' } });
    expect(price).toHaveValue(155.75);
  });
});

/* ── §3: GRN Entries ────────────────────────────────────────────────────── */

describe('Issues 2.7 §3 — Super Admin edits a booked GRN', () => {
  it('lists receipts and searches them', async () => {
    mount(<GrnAdmin />);
    await screen.findByText('GRN/2026/1');
    expect(screen.getByText('GRN/2026/2')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search receipts'), { target: { value: 'siegwerk' } });
    await waitFor(() => expect(screen.queryByText('GRN/2026/1')).toBeNull());
    expect(screen.getByText('GRN/2026/2')).toBeInTheDocument();
  });

  it('sends only the field that changed, and never the identity or audit fields', async () => {
    mount(<GrnAdmin />);
    fireEvent.click(await screen.findByLabelText('Edit GRN/2026/1'));
    await screen.findByLabelText('Edit invoice number');

    // the GRN number is shown but not editable
    expect(screen.getByLabelText('GRN number')).toHaveAttribute('readOnly');

    fireEvent.change(screen.getByLabelText('Edit invoice number'), { target: { value: 'INV-CORRECTED' } });
    fireEvent.click(screen.getByRole('button', { name: /Save paperwork/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.u === '/api/stores/grns/1')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT' && c.u === '/api/stores/grns/1');
    expect(put.body).toEqual({ invoiceNo: 'INV-CORRECTED' });   // nothing else is rewritten
    expect(put.body.grnNo).toBeUndefined();
    expect(put.body.actor).toBeUndefined();
    await screen.findByText(/updated/);
  });

  it('corrects a unit price, and locks the quantity once material has been issued', async () => {
    mount(<GrnAdmin />);
    fireEvent.click(await screen.findByLabelText('Edit GRN/2026/1'));
    await screen.findByLabelText('Price for BLMU-1');

    // BLMU-1 is untouched → quantity editable; BLMU-2 has been drawn on → locked
    expect(screen.getByLabelText('Quantity for BLMU-1')).not.toBeDisabled();
    expect(screen.getByLabelText('Quantity for BLMU-2')).toBeDisabled();
    // …but its price is still correctable, which is the point of the screen
    expect(screen.getByLabelText('Price for BLMU-2')).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText('Price for BLMU-1'), { target: { value: '155.75' } });
    fireEvent.click(screen.getByLabelText('Save BLMU-1'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.u === '/api/stores/units/11')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT' && c.u === '/api/stores/units/11').body).toEqual({ price: '155.75' });
  });

  it('refuses a negative price without calling the server', async () => {
    mount(<GrnAdmin />);
    fireEvent.click(await screen.findByLabelText('Edit GRN/2026/1'));
    await screen.findByLabelText('Price for BLMU-1');
    fireEvent.change(screen.getByLabelText('Price for BLMU-1'), { target: { value: '-5' } });
    fireEvent.click(screen.getByLabelText('Save BLMU-1'));
    await screen.findByText(/cannot be negative/);
    expect(calls.some((c) => c.method === 'PUT' && c.u.includes('/units/'))).toBe(false);
  });

  it('surfaces a server refusal instead of pretending it saved', async () => {
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      const method = (opts.method || 'GET').toUpperCase();
      if (u.match(/\/api\/stores\/grns\/\d+$/) && method === 'PUT') return res(400, { detail: 'A GRN date is required' });
      if (u.match(/\/api\/stores\/grns\/\d+$/)) return res(200, grnDetail);
      if (u.includes('/api/stores/grns')) return res(200, GRNS);
      return res(200, []);
    });
    mount(<GrnAdmin />);
    fireEvent.click(await screen.findByLabelText('Edit GRN/2026/1'));
    await screen.findByLabelText('Edit supplier');
    fireEvent.change(screen.getByLabelText('Edit supplier'), { target: { value: 'Someone else' } });
    fireEvent.click(screen.getByRole('button', { name: /Save paperwork/ }));
    await screen.findByText(/A GRN date is required/);
  });
});

/* ── §4: RM prices ──────────────────────────────────────────────────────── */

describe('Issues 2.7 §4 — Super Admin edits RM prices', () => {
  it('shows what is on hand and the price range it is held at', async () => {
    mount(<RmPriceAdmin />);
    await screen.findByText('FILM-1');
    const row = screen.getByText('FILM-1').closest('tr');
    expect(within(row).getByText(/₹120 – ₹140/)).toBeInTheDocument();   // batches differ
    expect(within(row).getByText('120')).toBeInTheDocument();            // on hand
  });

  it('repositions the whole item onto one price through the stock endpoint', async () => {
    mount(<RmPriceAdmin />);
    await screen.findByText('FILM-1');
    fireEvent.change(screen.getByLabelText('New price for FILM-1'), { target: { value: '135.50' } });
    fireEvent.click(screen.getByLabelText('Save price for FILM-1'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.u === '/api/stores/items/5/price')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT' && c.u === '/api/stores/items/5/price').body).toEqual({ price: '135.50' });
    await screen.findByText(/repriced/);
  });

  it('cannot reprice a material with nothing in stock', async () => {
    mount(<RmPriceAdmin />);
    await screen.findByText('INK-1');
    expect(screen.getByLabelText('New price for INK-1')).toBeDisabled();
    expect(screen.getByLabelText('Save price for INK-1')).toBeDisabled();
  });

  it('refuses a negative price without calling the server', async () => {
    mount(<RmPriceAdmin />);
    await screen.findByText('FILM-1');
    fireEvent.change(screen.getByLabelText('New price for FILM-1'), { target: { value: '-2' } });
    fireEvent.click(screen.getByLabelText('Save price for FILM-1'));
    await screen.findByText(/cannot be negative/);
    expect(calls.some((c) => c.u.includes('/price') && c.method === 'PUT')).toBe(false);
  });

  it('filters by material type and by search', async () => {
    mount(<RmPriceAdmin />);
    await screen.findByText('FILM-1');
    fireEvent.change(screen.getByLabelText('Filter by material type'), { target: { value: 'INK' } });
    await waitFor(() => expect(screen.queryByText('FILM-1')).toBeNull());
    expect(screen.getByText('INK-1')).toBeInTheDocument();
  });
});

/* ── the screens are Super Admin only ───────────────────────────────────── */

describe('Issues 2.7 — only the Super Admin reaches these screens', () => {
  it('keeps /dashboard, which carries both tabs, to the superadmin', () => {
    expect(canAccess('superadmin', '/dashboard')).toBe(true);
    ['user', 'qc', 'planner', 'stores', 'plant', 'pm', 'padmin', 'sadmin', 'ppc', 'mis', 'plan']
      .forEach((role) => expect(canAccess(role, '/dashboard'), `${role} must not reach /dashboard`).toBe(false));
  });
});
