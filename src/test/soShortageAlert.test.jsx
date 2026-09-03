import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import NewPO from '../pages/NewPO.jsx';

// Client, 2026-09-02: "Upon adding an OAB it is showing me that all these items are
// short by how much quantity … This message is not needed here. Just a small red
// alert saying that low stock on 10 items, including film. That would be all that I
// need. If at all film is short … then this sale order cannot be processed."
//
// The alert used to list every shorted item with required / available / shortage —
// a stores report on the screen of the person raising the order, who needs one
// thing from it: can this order run? The full breakdown still reaches Stores and
// the Super Admin, which is what the server's alerts and notifications are for.

const jss = [{ spec: 'A1', customer: 'Acme', jobName: 'Pouch A', jobType: 'StayFresh', dispatchForm: 'pouch', width: 100, height: 200, gsm: 50, filmWidth: 300, mic: '40', material: 'BOPP', status: 'Active' }];
const prices = { A1: { price: 75, costPrice: 60, transport: 'At Actuals' } };
const customers = [{ customer: 'Acme', dispatchLoc: 'Hyderabad', billingAddr: 'Plot 1' }];

const ITEMS = [
  { id: 1, code: 'FILM-1', name: 'BOPP 20mic', materialType: 'FILM', subGroup: 'AF BOPP', uom: 'KG' },
  { id: 2, code: 'INK-1', name: 'Cyan', materialType: 'INK', subGroup: 'Flexo', uom: 'KG' },
];
/** The New PO form labels its fields without `for`, so reach the input through the group. */
const fieldByLabel = (re) => {
  const lbl = screen.getByText(re);
  return (lbl.closest('.fg') || lbl.parentElement).querySelector('input, textarea, select');
};
const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/** Layer the stock check + item master over the harness's fetch. */
function withStock(shortItemCodes) {
  const base = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/api/stock/check')) {
      return res({
        so: '26/401',
        requirements: shortItemCodes.map((code) => ({
          itemCode: code, itemName: code, requiredQty: 100, availableQty: 10, shortageQty: 90, short: true,
        })),
      });
    }
    if (u.includes('/api/master/items')) return res(ITEMS);
    return base(url, opts);
  };
}

async function addOneSaleOrder(user) {
  await screen.findByText('New PO Entry');
  await user.type(fieldByLabel(/PO Number/), 'PO-100');
  await user.selectOptions(screen.getByLabelText('Customer'), 'Acme');
  await user.click(screen.getByRole('button', { name: /Next: Select SKUs/ }));
  const checks = screen.getAllByRole('checkbox');
  await user.click(checks[checks.length - 1]);
  await user.type(screen.getByRole('spinbutton'), '500');
  await user.click(screen.getByRole('button', { name: /Review →/ }));
  await screen.findByText('26/401');
  await user.click(screen.getByRole('button', { name: /Add to OAB/ }));
}

const mount = () => renderApp(<NewPO />, {
  modules: { jss, prices, customers, oab: oabModule({ lastSO: { y: '26', n: 400 } }) },
});

describe('New sale order — the low-stock alert', () => {
  it('names film and says the order cannot run when the film is short', async () => {
    const user = userEvent.setup();
    mount();
    withStock(['FILM-1', 'INK-1']);
    await addOneSaleOrder(user);

    expect(await screen.findByText(/Low stock on 2 items, including film/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be processed until the film is in/)).toBeInTheDocument();
  });

  it('does not mention film when the shortfall is something else', async () => {
    const user = userEvent.setup();
    mount();
    withStock(['INK-1']);
    await addOneSaleOrder(user);

    expect(await screen.findByText(/Low stock on 1 item\./)).toBeInTheDocument();
    expect(screen.queryByText(/including film/)).toBeNull();
    expect(screen.queryByText(/cannot be processed/)).toBeNull();
    expect(screen.getByText(/Stores & Super Admin have been alerted/)).toBeInTheDocument();
  });

  it('no longer prints a per-item shortage report on this screen', async () => {
    const user = userEvent.setup();
    mount();
    withStock(['FILM-1', 'INK-1']);
    await addOneSaleOrder(user);

    await screen.findByText(/Low stock on 2 items/);
    // The quantities the client asked to be taken off this screen.
    expect(screen.queryByText(/short by/)).toBeNull();
    expect(screen.queryByText(/need 100/)).toBeNull();
    expect(document.querySelectorAll('.al.al-r li').length).toBe(0);
  });

  it('says nothing at all when there is no shortfall', async () => {
    const user = userEvent.setup();
    mount();
    withStock([]);
    await addOneSaleOrder(user);

    await screen.findByText(/added/);
    expect(screen.queryByText(/Low stock/)).toBeNull();
  });
});
