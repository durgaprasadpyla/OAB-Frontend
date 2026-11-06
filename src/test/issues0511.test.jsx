// Issues 05.11.2026: the pouch gusset and open sizes on the CSA sheet, the Total Product
// GSM, QC remarks, quantity-based pricing with the price date, and inks that are mixed
// on the spot.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { renderApp, oabModule } from './harness.jsx';
import NewPO from '../pages/NewPO.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import SpecSheet from '../components/SpecSheet.jsx';
import { gussetEach, gussetTotal, pouchFigures, sleeveFigures, labelFigures } from '../lib/specSheet.js';
import { orderPrice, priceBandsText, priceDateOf, priceForQty, priceNudge, stampPriceDates } from '../lib/pricing.js';
import { isInk } from '../lib/soMaterial.js';
import { useState } from 'react';

describe('pouch gusset', () => {
  it('one side gusset of 50 is 200 in all, one bottom gusset of 50 is 100', () => {
    expect(gussetTotal('Side gusset', 50)).toBe(200);
    expect(gussetTotal('Bottom gusset', 50)).toBe(100);
    expect(gussetTotal('', 50)).toBe(0);
  });
  it('a sheet saved with only a total reads back as one gusset', () => {
    expect(gussetEach({ gusset_type: 'Side gusset', gusset_total: 200 })).toBe('50');
    expect(gussetEach({ gusset_type: 'Bottom gusset', gusset_total: 100 })).toBe('50');
  });
  it('total open height = pouch height × 2 + flap + bottom gusset', () => {
    const p = pouchFigures({ gusset_type: 'Bottom gusset', gusset_total: 100, pouch_height: 200, pouch_width: 150, flap: 10, seal_a: 5, seal_b: 5 }, 100);
    expect(p.height).toBe(510);
    expect(p.width).toBe(160);
  });
  it('open width = pouch width + side gusset + total seal', () => {
    const p = pouchFigures({ gusset_type: 'Side gusset', gusset_total: 200, pouch_height: 200, pouch_width: 150, flap: 10, seal_a: 5, seal_b: 5 }, 100);
    expect(p.height).toBe(410);
    expect(p.width).toBe(360);
  });
});

describe('Total Product GSM', () => {
  it('the weight of every form is worked out on the total above', () => {
    expect(pouchFigures({ pouch_height: 100, pouch_width: 100, gsm_override: 40 }, 82.85).gsm).toBe(82.85);
    expect(sleeveFigures({ sleeve_height: 100, open_width: 200, gsm_override: 40 }, 82.85).gsm).toBe(82.85);
    expect(labelFigures({ label_height: 100, label_width: 80, gsm_override: 40 }, 82.85).gsm).toBe(82.85);
  });
});

/** The sheet with one dispatch form, keeping its own state like the CSA form does. */
function Sheet({ form, start = {} }) {
  const [sheet, setSheet] = useState(start);
  const layers = [{ material: 'BOPP', microns: 20 }];
  return <SpecSheet sales={{}} layers={layers} sheet={sheet} onChange={setSheet} dispatchForm={form} machines={[]} idPrefix="t" />;
}

describe('the Specifications sheet', () => {
  it('takes one gusset and works out the total', async () => {
    render(<Sheet form="Pouch" />);
    await userEvent.click(screen.getByLabelText('Side gusset'));
    await userEvent.type(screen.getByLabelText('One gusset (mm)'), '50');
    expect(screen.getByLabelText('Total gusset (mm)')).toHaveValue('200');
    await userEvent.click(screen.getByLabelText('Bottom gusset'));
    expect(screen.getByLabelText('Total gusset (mm)')).toHaveValue('100');
  });

  it('labels the open sizes and shows the Total Product GSM on a pouch', async () => {
    render(<Sheet form="Pouch" start={{ ink_gsm: 3 }} />);
    expect(screen.getByLabelText('Total Open Height (mm)')).toBeInTheDocument();
    expect(screen.getByLabelText('Open Width (mm)')).toBeInTheDocument();
    expect(screen.getByLabelText('Total Product GSM')).toHaveValue('21.2');
  });

  it('shows the Total Product GSM on a shrink sleeve', () => {
    render(<Sheet form="Shrink Sleeve" start={{ ink_gsm: 3 }} />);
    expect(screen.getByLabelText('Total Product GSM')).toHaveValue('21.2');
    expect(screen.queryByLabelText('GSM for the weight')).toBeNull();
  });
});

describe('quantity-based pricing', () => {
  const a1017 = { price: 0.72, tiers: [{ qty: 500000, price: 0.70 }] };

  it('0.72 below 5 lakhs, 0.70 at 5 lakhs and above, 0.72 before a quantity is typed', () => {
    expect(priceForQty(a1017, '')).toBe(0.72);
    expect(priceForQty(a1017, 150000)).toBe(0.72);
    expect(priceForQty(a1017, 499999)).toBe(0.72);
    expect(priceForQty(a1017, 500000)).toBe(0.70);
    expect(priceForQty(a1017, 900000)).toBe(0.70);
  });

  it('several slabs, in any order, and a spec with none keeps its one price', () => {
    const e = { price: 1, tiers: [{ qty: 500000, price: 0.8 }, { qty: 100000, price: 0.9 }] };
    expect(priceForQty(e, 99999)).toBe(1);
    expect(priceForQty(e, 100000)).toBe(0.9);
    expect(priceForQty(e, 600000)).toBe(0.8);
    expect(orderPrice('X', 500000, { X: { price: 2 } })).toBe(2);
    expect(priceBandsText({ price: 2 })).toBe('');
  });

  it('a 1.5 lakh PO at 0.70 is told that price is for 5 lakhs', () => {
    expect(priceNudge(a1017, 150000, 0.70)).toBe('PO price ₹0.70 applies only from 5,00,000; below that it is ₹0.72');
    expect(priceNudge(a1017, 150000, '')).toBe('₹0.70 from 5,00,000');
    expect(priceNudge(a1017, 500000, 0.70)).toBe('');
  });

  it('dates a revised price only', () => {
    const before = { A: { price: 1, costPrice: 1, priceDate: '2024-01-01' }, B: { price: 1, priceDate: '2024-01-01' }, C: { price: 1, priceDate: '2024-01-01' } };
    const after = {
      A: { price: 1, costPrice: 2, priceDate: '2024-01-01' },
      B: { price: 1.1, priceDate: '2024-01-01' },
      C: { price: 1, priceDate: '2024-01-01', tiers: [{ qty: '100', price: '0.9' }, { qty: '', price: '' }] },
    };
    const out = stampPriceDates(before, after, '2026-11-06');
    expect(out.A.priceDate).toBe('2024-01-01');
    expect(out.B.priceDate).toBe('2026-11-06');
    expect(out.C.priceDate).toBe('2026-11-06');
    expect(out.C.tiers).toEqual([{ qty: 100, price: 0.9 }]);
  });

  it('the later of the Price Master and the rep’s accepted quote is the price date', () => {
    const prices = { A: { price: 1, priceDate: '2026-01-01' } };
    const sales = { skus: [{ jss_spec: 'A', quotation_accepted: true, quotation_accepted_at: '2026-05-02T10:00:00Z' }] };
    expect(priceDateOf('A', prices, sales)).toBe('2026-05-02');
    expect(priceDateOf('A', prices, {})).toBe('2026-01-01');
    expect(priceDateOf('B', prices, sales)).toBeNull();
  });
});

describe('New sale order — the price follows the quantity', () => {
  const jss = [{ spec: 'A1017', customer: 'Acme', jobName: 'Pouch A', jobType: 'StayFresh', dispatchForm: 'pouch', status: 'Active' }];
  const prices = { A1017: { price: 0.72, costPrice: 0.5, transport: 'At Actuals', priceDate: '2024-11-01', tiers: [{ qty: 500000, price: 0.70 }] } };
  const customers = [{ customer: 'Acme', dispatchLoc: 'Hyderabad', billingAddr: 'Plot 1' }];
  const fieldByLabel = (re) => {
    const lbl = screen.getByText(re);
    return (lbl.closest('.fg') || lbl.parentElement).querySelector('input, textarea, select');
  };
  async function toSkus(user) {
    renderApp(<NewPO />, { modules: { jss, prices, customers, oab: oabModule({ lastSO: { y: '26', n: 400 } }) } });
    await screen.findByText('New PO Entry');
    await user.type(fieldByLabel(/PO Number/), 'PO-100');
    await user.selectOptions(screen.getByLabelText('Customer'), 'Acme');
    await user.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));
    await user.click(await screen.findByLabelText('Select A1017'));
  }

  it('shows 0.72 by default and below 5 lakhs, nudges a low PO price, and moves to 0.70 at 5 lakhs', async () => {
    const user = userEvent.setup();
    await toSkus(user);
    const rate = () => screen.getByLabelText('Rate for A1017');
    const note = () => screen.getByLabelText('Price note for A1017');
    expect(rate()).toHaveTextContent('₹0.72');
    expect(note()).toHaveTextContent('₹0.72 below 5,00,000 · ₹0.70 from 5,00,000');
    expect(note()).toHaveTextContent(/Price entered .*2024/);

    await user.type(screen.getByLabelText('PO qty for A1017'), '150000');
    await user.type(screen.getByLabelText('PO price for A1017'), '0.70');
    expect(rate()).toHaveTextContent('₹0.72');
    expect(note()).toHaveTextContent('PO price ₹0.70 applies only from 5,00,000; below that it is ₹0.72');

    await user.clear(screen.getByLabelText('PO qty for A1017'));
    await user.type(screen.getByLabelText('PO qty for A1017'), '500000');
    expect(rate()).toHaveTextContent('₹0.70');
    expect(note()).not.toHaveTextContent('applies only');

    await user.click(screen.getByRole('button', { name: /Review →/ }));
    expect(await screen.findByLabelText('Confirm rate for A1017')).toHaveTextContent('₹0.70');
  });

  it('a price saved before dates existed says so', async () => {
    const user = userEvent.setup();
    delete prices.A1017.priceDate;
    await toSkus(user);
    expect(screen.getByLabelText('Price note for A1017')).toHaveTextContent('Price date not recorded');
  });
});

describe('Price Master — the radio', () => {
  const modules = {
    jss: [{ spec: 'A1017', customer: 'Acme', jobName: 'Pouch A', status: 'Active' }, { spec: 'B2', customer: 'Beta', jobName: 'Pouch B', status: 'Active' }],
    prices: { A1017: { price: 0.72, costPrice: 0.5, transport: 'At Actuals' }, B2: { price: 3, costPrice: 2, transport: 'At Actuals', priceDate: '2024-01-01' } },
    oab: oabModule(),
  };

  it('picks a spec, enters a slab at the top, and saves it with today’s date', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<Dashboard />, { modules, role: 'superadmin' });
    await user.click(await screen.findByText(/Price Master/, { selector: '.step-tab, button, div' }));
    expect(screen.queryByLabelText('Quantity pricing for A1017')).toBeNull();
    await user.click(await screen.findByLabelText('Select A1017'));
    const box = screen.getByLabelText('Quantity pricing for A1017');
    expect(box).toHaveTextContent('Price date not recorded');
    await user.click(within(box).getByRole('button', { name: /Add quantity slab/ }));
    await user.type(within(box).getByLabelText('Slab 1 from quantity'), '500000');
    await user.type(within(box).getByLabelText('Slab 1 price'), '0.70');
    expect(within(box).getByLabelText('Slabs in words')).toHaveTextContent('₹0.72 below 5,00,000 · ₹0.70 from 5,00,000');
    await user.click(within(box).getByRole('button', { name: /Save/ }));

    await waitFor(() => expect(saved.some((s) => s.id === 3)).toBe(true));
    const data = saved.find((s) => s.id === 3).data;
    expect(data.A1017.tiers).toEqual([{ qty: 500000, price: 0.7 }]);
    expect(data.A1017.priceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.B2.priceDate).toBe('2024-01-01');   // not touched, not re-dated
  });
});

describe('inks', () => {
  it('knows an ink from a shrink film', () => {
    expect(isInk({ materialType: 'INK' })).toBe(true);
    expect(isInk({ materialType: 'INKS', subGroup: 'Flexo' })).toBe(true);
    expect(isInk({ itemDescription: 'Mixed flexo ink' })).toBe(true);
    expect(isInk({ materialType: 'SHRINK FILM' })).toBe(false);
    expect(isInk({ itemDescription: 'PINK BOPP' })).toBe(false);
  });
});
