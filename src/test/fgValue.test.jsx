import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import FGLedger from '../pages/FGLedger.jsx';
import FgValuePanel from '../components/FgValuePanel.jsx';

function daysAgo(d) {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}

// Two specs with stock: SP-A is old and cheap, SP-B is fresh and expensive, so
// the value and ageing sorts put them in opposite orders.
const modules = {
  fgLedger: {
    'SP-A': { prod: [{ date: daysAgo(90), qty: 1000, ts: 1 }], alloc: [] },
    'SP-B': { prod: [{ date: daysAgo(2), qty: 500, ts: 2 }], alloc: [] },
  },
  jss: [
    { spec: 'SP-A', jobName: 'Old Job', customer: 'Acme', status: 'Active' },
    { spec: 'SP-B', jobName: 'New Job', customer: 'Beta', status: 'Active' },
  ],
  prices: { 'SP-A': { price: 2 }, 'SP-B': { price: 10 } },
};

// Production keeps the plain FG summary on the FG Entry page and the FG Value board
// on its own Dashboard tab, so the two are rendered — and asserted — separately.
const valueCard = () => screen.getByText(/FG Value — Stock on hand/).closest('.card');
const summaryCard = () => screen.getByText(/All Specs — FG Summary/).closest('.card');
const valueTable = () => valueCard().querySelector('table');
const dataRows = () => within(valueTable()).getAllByRole('row').slice(1);
const specOrder = () => dataRows().map((r) => r.querySelector('td').textContent.trim());

afterEach(() => { vi.restoreAllMocks(); });

describe('FG Value — valuation and FIFO ageing', () => {
  it('shows price, stock value and the age of the oldest unconsumed batch', async () => {
    renderApp(<FgValuePanel />, { modules, role: 'superadmin' });
    await waitFor(() => expect(within(valueCard()).getByText('SP-A')).toBeInTheDocument());

    const rowA = within(valueCard()).getByText('SP-A').closest('tr');
    expect(within(rowA).getByText('₹2.00')).toBeInTheDocument();
    expect(within(rowA).getByText('₹2,000.00')).toBeInTheDocument();   // 1000 avail × ₹2
    expect(within(rowA).getByText('90 days (1,000)')).toBeInTheDocument();

    const rowB = within(valueCard()).getByText('SP-B').closest('tr');
    expect(within(rowB).getByText('₹5,000.00')).toBeInTheDocument();   // 500 × ₹10
    expect(within(rowB).getByText('2 days (500)')).toBeInTheDocument();
  });

  it('totals the available qty and value across the visible rows', async () => {
    renderApp(<FgValuePanel />, { modules, role: 'superadmin' });
    await waitFor(() => expect(within(valueCard()).getByText('SP-A')).toBeInTheDocument());
    expect(within(valueCard()).getByText('1,500')).toBeInTheDocument();     // 1000 + 500
    expect(within(valueCard()).getByText('₹7,000.00')).toBeInTheDocument(); // 2,000 + 5,000
  });

  it('sorts by value, then by ageing', async () => {
    renderApp(<FgValuePanel />, { modules, role: 'superadmin' });
    await waitFor(() => expect(within(valueCard()).getByText('SP-A')).toBeInTheDocument());

    expect(specOrder()).toEqual(['SP-B', 'SP-A']);   // default: value high → low

    await userEvent.selectOptions(screen.getByLabelText('Sort FG value'), 'aging-desc');
    expect(specOrder()).toEqual(['SP-A', 'SP-B']);   // oldest first

    await userEvent.selectOptions(screen.getByLabelText('Sort FG value'), 'aging-asc');
    expect(specOrder()).toEqual(['SP-B', 'SP-A']);   // newest first
  });

  it('drops a fully-drawn spec from the FG Value board', () => {
    // Production's board is "Stock on hand" — a spec with nothing left does not
    // belong on it, and shows "No FG currently in stock" when none qualify.
    const drawnDown = { ...modules, fgLedger: { 'SP-A': { prod: [{ date: daysAgo(9), qty: 100, ts: 1 }], alloc: [{ qty: 100 }] } } };
    renderApp(<FgValuePanel />, { modules: drawnDown, role: 'superadmin' });
    return waitFor(() => {
      expect(within(valueCard()).queryByText('SP-A')).not.toBeInTheDocument();
      expect(within(valueCard()).getByText('No FG currently in stock')).toBeInTheDocument();
    });
  });

  it('drops a fully-drawn spec from the FG Entry summary (stock only, per 2026-08 client change)', () => {
    // Once FG is allocated + dispatched the available qty is zero, so the SKU falls off
    // the FG Entry stock summary too (not just the FG Value board).
    const drawnDown = { ...modules, fgLedger: { 'SP-A': { prod: [{ date: daysAgo(9), qty: 100, ts: 1 }], alloc: [{ qty: 100 }] } } };
    renderApp(<FGLedger />, { modules: drawnDown, role: 'superadmin' });
    return waitFor(() => expect(within(summaryCard()).queryByText('SP-A')).not.toBeInTheDocument());
  });
});

describe('FG Value — Super Admin stock correction', () => {
  it('books the DELTA as a dated production entry so the ledger stays append-only', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('600');   // 1000 on hand -> set to 600
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { saved } = renderApp(<FgValuePanel />, { modules, role: 'superadmin' });
    await waitFor(() => expect(within(valueCard()).getByText('SP-A')).toBeInTheDocument());

    await userEvent.click(within(within(valueCard()).getByText('SP-A').closest('tr')).getByTitle('Edit Available FG'));

    await waitFor(() => expect(saved.some((s) => s.key === 'fgLedger')).toBe(true));
    const prod = saved.filter((s) => s.key === 'fgLedger').pop().data['SP-A'].prod;
    expect(prod).toHaveLength(2);              // original batch untouched
    expect(prod[0].qty).toBe(1000);
    expect(prod[1].qty).toBe(-400);            // the correction delta, not the new total
    expect(prod[1].note).toMatch(/Super Admin/);
  });

  it('ignores a cancelled prompt and an unchanged value', async () => {
    const p = vi.spyOn(window, 'prompt').mockReturnValue(null);
    const { saved } = renderApp(<FgValuePanel />, { modules, role: 'superadmin' });
    await waitFor(() => expect(within(valueCard()).getByText('SP-A')).toBeInTheDocument());
    const btn = within(within(valueCard()).getByText('SP-A').closest('tr')).getByTitle('Edit Available FG');

    await userEvent.click(btn);                       // cancelled
    p.mockReturnValue('1000');
    await userEvent.click(btn);                       // same as current
    expect(saved.filter((s) => s.key === 'fgLedger')).toHaveLength(0);
  });

  it('is hidden from non-superadmins', async () => {
    renderApp(<FgValuePanel />, { modules, role: 'user' });
    await waitFor(() => expect(within(valueCard()).getByText('SP-A')).toBeInTheDocument());
    expect(screen.queryByTitle('Edit Available FG')).not.toBeInTheDocument();
  });
});
