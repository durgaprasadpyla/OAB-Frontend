// Issues 11.11 (11.11.2026_3.0 + the purchase-indent message): staggered pricing with a
// smallest quantity, sleeve / roller counts and remarks, the film width of each
// substrate, printing direction, OAB Excel columns, Bloomflex freight off the invoice,
// the month-wise transport report, the PI → PO loop, and the JSS artwork.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderApp, oabModule } from './harness.jsx';
import { belowMinimum, priceBandsText, priceForQty, priceNudge, stampPriceDates } from '../lib/pricing.js';
import { layerFilmWidths, toolNote, toolShort } from '../lib/specSheet.js';
import { plantComments, pouchOpenWidth, substratesForBalance } from '../lib/oabExport.js';
import { transportByMonth } from '../lib/transport.js';
import SpecSheet from '../components/SpecSheet.jsx';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { ArtworkButton } from '../components/Artwork.jsx';
import { StoresIndents } from '../components/IndentPanel.jsx';
import Purchase from '../pages/Purchase.jsx';

const res = (body, status = 200) => ({ status, ok: status < 400, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('staggered pricing with a smallest quantity', () => {
  // "50,000 – 1.12/-  1,00,000 – 1.05/-  2,00,000 – 1.00/-"
  const pm = { price: 1.12, minQty: 50000, tiers: [{ qty: 100000, price: 1.05 }, { qty: 200000, price: 1.00 }] };

  it('99,999 is ₹1.12 and 1,99,999 is ₹1.05', () => {
    expect(priceForQty(pm, 50000)).toBe(1.12);
    expect(priceForQty(pm, 99999)).toBe(1.12);
    expect(priceForQty(pm, 100000)).toBe(1.05);
    expect(priceForQty(pm, 199999)).toBe(1.05);
    expect(priceForQty(pm, 200000)).toBe(1.00);
  });

  it('40,000 is flagged: a price was given for 50,000', () => {
    expect(belowMinimum(pm, 40000)).toBe(true);
    expect(belowMinimum(pm, 50000)).toBe(false);
    expect(priceNudge(pm, 40000)).toBe('You have given a price for 50,000 and above — this order is 40,000');
    expect(priceBandsText(pm)).toBe('₹1.12 from 50,000 · ₹1.05 from 1,00,000 · ₹1.00 from 2,00,000');
  });

  it('the smallest quantity is saved, and changing it is a price revision', () => {
    const out = stampPriceDates({ A: { price: 1.12, priceDate: '2026-01-01' } }, { A: { price: 1.12, minQty: '50000', priceDate: '2026-01-01' } }, '2026-11-12');
    expect(out.A.minQty).toBe(50000);
    expect(out.A.priceDate).toBe('2026-11-12');
  });
});

describe('sleeves and rollers', () => {
  it('says how many there are, how many work, and the remarks', () => {
    expect(toolNote({ count: 8, ok: 7, remarks: 'one damaged' }, 'sleeves')).toBe('8 sleeves · 7 OK · one damaged');
    expect(toolNote({}, 'sleeves')).toBe('');
    expect(toolShort({ count: 8, ok: 7 })).toBe(true);
    expect(toolShort({ count: 8, ok: 8 })).toBe(false);
  });

  it('the QC sees the remarks when picking a sleeve', async () => {
    const sales = { machine_tooling: { 1: { sleeves: [450, 500], sleeve_details: { 450: { count: 8, ok: 7, remarks: 'one damaged' } } } } };
    const machines = [{ id: 1, name: 'CI Flexo', departmentName: 'Printing' }];
    function Host() {
      const [sheet, setSheet] = useState({ print: { 1: { ups: 1, sleeve: '450' } } });
      return <SpecSheet sales={sales} layers={[{ material: 'BOPP', microns: 20 }]} sheet={sheet} onChange={setSheet} dispatchForm="Roll" machines={machines} idPrefix="t" />;
    }
    render(<Host />);
    expect(screen.getByRole('option', { name: '450 — 8 sleeves · 7 OK · one damaged' })).toBeInTheDocument();
    expect(screen.getByLabelText('CI Flexo sleeve remarks')).toHaveTextContent('450 mm: 8 sleeves · 7 OK · one damaged');
  });
});

describe('the CSA / JSS sheet', () => {
  it('shows the film width of each substrate, + 10 mm a lamination', () => {
    const sheet = { single_width: 300, print: { 1: { tracks: 2, tracker: 20 } } };
    expect(layerFilmWidths({}, sheet)).toEqual([620, 630, 640]);
    function Host() {
      const [sh, setSh] = useState(sheet);
      return <SpecSheet sales={{}} layers={[{ material: 'PET', microns: 12 }, { material: 'LDPE', microns: 50 }]} sheet={sh} onChange={setSh}
        dispatchForm="Pouch" machines={[{ id: 1, name: 'CI', departmentName: 'Printing' }]} idPrefix="t" />;
    }
    render(<Host />);
    expect(screen.getByLabelText('Primary film width')).toHaveValue('620');
    expect(screen.getByLabelText('Secondary film width')).toHaveValue('630');
  });

  it('asks the printing direction for despatch', async () => {
    function Host() { const [sh, setSh] = useState({}); return <SpecSheet sales={{}} layers={[]} sheet={sh} onChange={setSh} dispatchForm="Roll" machines={[]} idPrefix="t" />; }
    render(<Host />);
    const sel = screen.getByLabelText('Printing direction for despatch');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['— select —', 'Readable', 'Unreadable']);
    await userEvent.selectOptions(sel, 'Unreadable');
    expect(sel).toHaveValue('Unreadable');
  });
});

describe('OAB Excel columns', () => {
  const jss = { spec: 'A1', dispatchForm: 'Pouch', filmWidth: 300, material1: 'PET', microns1: '12', material2: 'LDPE', microns2: '50' };

  it('weighs each substrate for the balance metres', () => {
    const subs = substratesForBalance(jss, {}, 10000);
    expect(subs[0]).toBe('PET 12 mic — 50 kg');   // 10,000 m × 0.30 m × 16.8 GSM
    expect(subs[1]).toBe('LDPE 50 mic — 143 kg'); // 10,000 m × 0.31 m × 46 GSM
    expect(subs[2]).toBe('');
  });

  it('pouch open width only for a pouch', () => {
    const j = { ...jss, specSheet: { pouch_width: 150, gusset_type: 'Side gusset', gusset_total: 40, seal_a: 5, seal_b: 5 } };
    expect(pouchOpenWidth(j, {})).toBe(200);
    expect(pouchOpenWidth({ ...j, dispatchForm: 'Roll' }, {})).toBe('');
  });

  it('the plant comment is the PM’s on the SO, else the CSA plant comment', () => {
    const sales = { skus: [{ id: 's1', jss_spec: 'A1' }], qc_reports: [{ sku_id: 's1', plant_comments: 'run on CI 2', plant_answered_at: '2026-10-01' }] };
    expect(plantComments('26/1', 'A1', { '26/1': { comment: 'plates ready' } }, sales)).toBe('plates ready');
    expect(plantComments('26/2', 'A1', {}, sales)).toBe('CSA: run on CI 2');
  });
});

describe('transport', () => {
  it('month by month, per customer', () => {
    const rows = [
      { customer: 'Amazon', date: '2026-09-03', freight: 100, borneBy: 'Bloomflex' },
      { customer: 'Amazon', date: '2026-10-03', freight: 50, borneBy: 'Customer' },
      { customer: 'VSA', date: '2026-10-09', freight: 70, borneBy: 'Bloomflex' },
    ];
    const all = transportByMonth(rows);
    expect(all.months).toEqual(['2026-09', '2026-10']);
    expect(all.rows.map((r) => [r.name, r.byMonth['2026-09'] || 0, r.byMonth['2026-10'] || 0, r.total])).toEqual([['Amazon', 100, 50, 150], ['VSA', 0, 70, 70]]);
    expect(transportByMonth(rows, { measure: 'bloomflex' }).rows.map((r) => [r.name, r.total])).toEqual([['Amazon', 100], ['VSA', 70]]);
  });

  it('the invoice has no freight line at all when Bloomflex bears it', () => {
    const lines = [{ spec: 'A1', qty: 100, rate: 10, lineTotal: 1000 }];
    const a = render(<InvoiceDoc header={{ freight: 500, freightBorneBy: 'Bloomflex' }} lines={lines} />);
    expect(within(a.container).queryByText('Freight')).toBeNull();
    a.unmount();
    const b = render(<InvoiceDoc header={{ freight: 500 }} lines={lines} />);
    expect(within(b.container).getByText('Freight')).toBeInTheDocument();
  });
});

describe('purchase indents', () => {
  it('the stores desk raises one: item, quantity, date, and a department from the item’s mapping', async () => {
    const posted = [];
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/api/master/items')) return res([{ id: 7, code: 'INK9', name: 'Cyan ink', uom: 'Kg' }]);
      if (u.includes('/api/purchase-indents/departments')) return res([{ id: 3, name: 'Printing' }]);
      if (u.endsWith('/api/purchase-indents') && opts.method === 'POST') { posted.push(JSON.parse(opts.body)); return res({ id: 1, piNo: 'PI-0001', status: 'OPEN' }, 201); }
      if (u.includes('/api/purchase-indents')) return res(posted.length ? [{ id: 1, piNo: 'PI-0001', itemCode: 'INK9', qty: 50, status: 'OPEN' }] : []);
      return res({});
    });
    const user = userEvent.setup();
    render(<StoresIndents />);
    await user.type(screen.getByLabelText('PI item code'), 'INK9');
    await waitFor(() => expect(screen.getByLabelText('PI department')).toHaveValue('3'));   // the one mapped department
    await user.type(screen.getByLabelText('PI quantity'), '50');
    await user.type(screen.getByLabelText('PI expected date'), '2026-11-20');
    await user.click(screen.getByRole('button', { name: /Raise PI/ }));
    await screen.findByText(/PI-0001 raised/);
    expect(posted).toEqual([{ itemId: 7, qty: 50, expectedDate: '2026-11-20', departmentId: 3 }]);
  });

  it('the purchase desk picks a PI, sees the item’s suppliers, and raises the PO from it', async () => {
    const user = userEvent.setup();
    const purchase = {
      asl: [
        { company: 'Inks Ltd', itemCode: 'INK9', specificMaterial: 'Cyan ink', basicPrice: 300, uom: 'Kg' },
        { company: 'ColourCo', itemCode: 'INK9', specificMaterial: 'Cyan ink', basicPrice: 320 },
        { company: 'FilmCo', itemCode: 'BLM1', specificMaterial: 'BOPP' },
      ],
      pos: [], counter: 0,
    };
    renderApp(<Purchase />, { modules: { purchase }, role: 'purchase' });
    const base = globalThis.fetch;
    const created = [];
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/api/purchase-indents')) return res([{ id: 9, piNo: 'PI-0009', itemCode: 'INK9', itemName: 'Cyan ink', uom: 'Kg', qty: 50, expectedDate: '2026-11-20', departmentName: 'Printing', status: 'OPEN' }]);
      if (u.endsWith('/api/purchase-orders') && opts.method === 'POST') { created.push(JSON.parse(opts.body)); return res({ poNum: 'BLM/PUR/2026-2027/1' }, 201); }
      return base(url, opts);
    };
    await user.click(await screen.findByRole('button', { name: /PIs/ }));
    await user.click(screen.getByRole('button', { name: /Refresh/ }));   // the list loaded before this mock
    await user.click(await screen.findByLabelText('Select PI-0009'));
    const box = screen.getByLabelText('Suppliers for PI-0009');
    expect(within(box).getByText('Inks Ltd')).toBeInTheDocument();
    expect(within(box).getByText('ColourCo')).toBeInTheDocument();
    expect(within(box).queryByText('FilmCo')).toBeNull();
    await user.click(within(box).getByLabelText('Supplier Inks Ltd'));
    await user.click(within(box).getByRole('button', { name: /Create PO from PI-0009/ }));
    expect(await screen.findByText(/Raising this PO against/)).toHaveTextContent('PI-0009');
    expect(screen.getByLabelText('Qty line 1')).toHaveValue(50);
    expect(screen.getByLabelText('Rate line 1')).toHaveValue(300);
    await user.click(screen.getByRole('button', { name: /Create PO/ }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ supplier: 'Inks Ltd', expectedDelivery: '2026-11-20', indentIds: [9] });
    expect(created[0].items[0]).toMatchObject({ itemCode: 'INK9', qty: 50, rate: 300 });
  });
});

describe('artwork', () => {
  it('opens the spec’s artwork, and says so when there is none', async () => {
    globalThis.fetch = vi.fn(async (url) => (String(url).includes('/A1')
      ? res({ spec: 'A1', fileName: 'a1.jpg', data: 'data:image/jpeg;base64,AAAA' })
      : res({ message: 'No artwork for B2' }, 404)));
    const user = userEvent.setup();
    render(<><ArtworkButton spec="A1" /><ArtworkButton spec="B2" /></>);
    await user.click(screen.getByLabelText('Artwork of A1'));
    expect(await screen.findByAltText('Artwork of A1')).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA');
    await user.keyboard('{Escape}');
    await user.click(screen.getByLabelText('Artwork of B2'));
    expect(await screen.findByText(/No artwork has been added for B2/)).toBeInTheDocument();
  });
});

export { oabModule };
