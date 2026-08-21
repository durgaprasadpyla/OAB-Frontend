import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import DispatchBySO, { ageDays, ageColor, dispatchRows, sortDispatchRows } from '../pages/DispatchBySO.jsx';
import DailyUpdate from '../pages/DailyUpdate.jsx';
import Invoice from '../pages/Invoice.jsx';

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/* ─────────────────────────── Dispatch by SO ─────────────────────────── */

describe('ageDays / ageColor', () => {
  const now = new Date('2026-08-20T09:00:00');
  it('counts whole days from the PO date, never negative', () => {
    expect(ageDays('2026-08-10', now)).toBe(10);
    expect(ageDays('2026-08-20', now)).toBe(0);
    expect(ageDays('2026-09-01', now)).toBe(0);
  });
  it('is null without a usable date', () => {
    expect(ageDays('', now)).toBeNull();
    expect(ageDays('rubbish', now)).toBeNull();
  });
  it('bands at 21 and 45 days', () => {
    expect(ageColor(0)).toBe('var(--g)');
    expect(ageColor(21)).toBe('#B7770D');
    expect(ageColor(45)).toBe('#C0392B');
    expect(ageColor(null)).toBe('var(--i3)');
  });
});

describe('dispatchRows', () => {
  const oab = {
    SF: [
      { so: '26/500', spec: 'A1', poQty: 1000, invDisp: 400, manDisp: 100, poDate: '2026-08-01' },
      { so: '26/501', spec: 'A2', poQty: 500, invDisp: 500, manDisp: 0, closed: true },
    ],
    OT: [{ so: '26/502', spec: 'A3', poQty: 100, invDisp: 150, manDisp: 0 }],
  };

  it('excludes closed orders and derives dispatched + balance', () => {
    const rows = dispatchRows(oab, new Date('2026-08-20T00:00:00'));
    expect(rows.map((r) => r.so)).toEqual(['26/500', '26/502']);
    const r = rows[0];
    expect(r.disp).toBe(500);
    expect(r.bal).toBe(500);
  });

  it('gives a negative balance for an over-dispatched order', () => {
    expect(dispatchRows(oab).find((r) => r.so === '26/502').bal).toBe(-50);
  });

  it('tolerates a missing board', () => {
    expect(dispatchRows(undefined)).toEqual([]);
  });
});

describe('sortDispatchRows', () => {
  const rows = [
    { so: '26/001', bal: 100, age: 5, spec: '', jobName: '', customer: '', poNum: '' },
    { so: '26/002', bal: -10, age: 1, spec: '', jobName: '', customer: '', poNum: '' },
    { so: '26/003', bal: 100, age: 60, spec: '', jobName: '', customer: '', poNum: '' },
  ];

  it('puts over-dispatched first, then the oldest', () => {
    expect(sortDispatchRows(rows).map((r) => r.so)).toEqual(['26/002', '26/003', '26/001']);
  });

  it('can show only the over-dispatched ones', () => {
    expect(sortDispatchRows(rows, { overOnly: true }).map((r) => r.so)).toEqual(['26/002']);
  });

  it('searches across SO, spec, job, customer and PO', () => {
    const list = [{ so: 'X', spec: 'SPEC-9', jobName: '', customer: '', poNum: '', bal: 0, age: 0 }];
    expect(sortDispatchRows(list, { q: 'spec-9' })).toHaveLength(1);
    expect(sortDispatchRows(list, { q: 'nope' })).toHaveLength(0);
  });
});

describe('Dispatch by SO screen', () => {
  const modules = {
    oab: oabModule({
      SF: [
        { so: '26/500', spec: 'A1', jobName: 'Job A', customer: 'Acme', poNum: 'PO-1', poQty: 1000, invDisp: 400, manDisp: 100, poDate: daysAgo(50) },
        { so: '26/501', spec: 'A2', jobName: 'Job B', customer: 'Beta', poNum: 'PO-2', poQty: 100, invDisp: 150, manDisp: 0, poDate: daysAgo(2) },
      ],
    }),
  };

  it('lists open orders with the production columns', async () => {
    renderApp(<DispatchBySO />, { modules, role: 'user' });
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    ['Ordered', 'Invoiced', 'Manual', 'Dispatched', 'Balance', 'Age (d)', 'Status']
      .forEach((h) => expect(screen.getByText(h)).toBeInTheDocument());
  });

  it('flags an over-dispatched order and sorts it first', async () => {
    renderApp(<DispatchBySO />, { modules, role: 'user' });
    await waitFor(() => expect(screen.getByText('⚠ Over')).toBeInTheDocument());
    const first = screen.getAllByRole('row')[1];
    expect(within(first).getByText('26/501')).toBeInTheDocument();   // over-dispatched wins
    expect(screen.getByText(/1 over-dispatched/)).toBeInTheDocument();
  });

  it('filters to over-dispatched only', async () => {
    renderApp(<DispatchBySO />, { modules, role: 'user' });
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Over-dispatched only'));
    expect(screen.queryByText('26/500')).not.toBeInTheDocument();
    expect(screen.getByText('26/501')).toBeInTheDocument();
  });

  it('searches by PO number', async () => {
    renderApp(<DispatchBySO />, { modules, role: 'user' });
    await waitFor(() => expect(screen.getByText('26/500')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Search sale orders'), 'PO-2');
    expect(screen.queryByText('26/500')).not.toBeInTheDocument();
    expect(screen.getByText('26/501')).toBeInTheDocument();
  });
});

/* ─────────────────────────── Daily Update parity ─────────────────────────── */

describe('Daily Update — production columns and filters', () => {
  const modules = {
    oab: oabModule({
      SF: [
        { so: '26/600', spec: 'A1', jobName: 'Job A', customer: 'Acme', poNum: 'PO-1', dispLoc: 'JAIPUR', poQty: 5000 },
        { so: '26/601', spec: 'A2', jobName: 'Job B', customer: 'Beta', poNum: 'PO-2', dispLoc: 'PUNE', poQty: 3000 },
      ],
    }),
    fgLedger: { A1: { prod: [{ date: '2026-08-01', qty: 74500, ts: 1 }], alloc: [] } },
    prodStatus: {},
  };

  it('shows PO # and Disp Loc, which production has', async () => {
    renderApp(<DailyUpdate />, { modules, role: 'user' });
    await waitFor(() => expect(screen.getByText('26/600')).toBeInTheDocument());
    expect(screen.getByText('PO #')).toBeInTheDocument();
    expect(screen.getByText('Disp Loc')).toBeInTheDocument();
    expect(screen.getByText('JAIPUR')).toBeInTheDocument();
  });

  it('uses production column labels', async () => {
    renderApp(<DailyUpdate />, { modules, role: 'user' });
    await waitFor(() => expect(screen.getByText('26/600')).toBeInTheDocument());
    ['Inv Disp', 'Man Disp', 'Add Man Disp Qty', 'Man Disp Inv #', 'Allocate FG', 'Actions']
      .forEach((h) => expect(screen.getByText(h)).toBeInTheDocument());
  });

  it('shows the FG pool availability under the allocate field', async () => {
    renderApp(<DailyUpdate />, { modules, role: 'user' });
    await waitFor(() => expect(screen.getByText('26/600')).toBeInTheDocument());
    // A1 has 74,500 produced and nothing allocated.
    expect(screen.getByText('avail 74,500')).toBeInTheDocument();
    expect(screen.getByLabelText('Allocate FG for 26/600')).toBeInTheDocument();
  });

  it('filters by PO', async () => {
    renderApp(<DailyUpdate />, { modules, role: 'user' });
    await waitFor(() => expect(screen.getByText('26/600')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Filter by PO'), 'PO-2');
    expect(screen.queryByText('26/600')).not.toBeInTheDocument();
    expect(screen.getByText('26/601')).toBeInTheDocument();
  });

  it('searches by PO number too', async () => {
    renderApp(<DailyUpdate />, { modules, role: 'user' });
    await waitFor(() => expect(screen.getByText('26/600')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Search orders'), 'PO-1');
    expect(screen.getByText('26/600')).toBeInTheDocument();
    expect(screen.queryByText('26/601')).not.toBeInTheDocument();
  });
});

/* ─────────────────────────── Invoice register parity ─────────────────────────── */

describe('Invoice register — certificates, filters and PL', () => {
  const inv = (no, po, certs) => ({
    no, date: '2026-08-10', po, customer: 'Acme', qty: 100, amount: 1000,
    items: [{ spec: 'A1', qty: 100, rate: 10 }], certs,
  });
  const modules = {
    oab: oabModule({ INV_REG: [] }),
    jss: [], prices: {}, customers: [],
  };
  const withInvoices = (list) => ({ ...modules, oab: oabModule({ INV_REG: list }) });

  const open = async (list) => {
    const r = renderApp(<Invoice />, { modules: withInvoices(list), role: 'user' });
    await waitFor(() => expect(screen.getByText('Invoice Register')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'all');
    return r;
  };

  it('shows a pending certificate as an hourglass and an issued one as a tick', async () => {
    await open([
      inv('BL/1', 'PO-1', {}),
      inv('BL/2', 'PO-2', { 'coa|A1': { done: true }, 'fg|A1': { done: true } }),
    ]);
    const pending = screen.getByText('BL/1').closest('tr');
    expect(within(pending).getByText('COA ⏳')).toBeInTheDocument();
    expect(within(pending).getByText('FG ⏳')).toBeInTheDocument();

    const issued = screen.getByText('BL/2').closest('tr');
    expect(within(issued).getByText('COA ✓')).toBeInTheDocument();
  });

  it('marks a partly-certified invoice with a dot, not a tick', async () => {
    await open([{
      ...inv('BL/3', 'PO-3', { 'coa|A1': { done: true } }),
      items: [{ spec: 'A1' }, { spec: 'A2' }],
    }]);
    expect(within(screen.getByText('BL/3').closest('tr')).getByText('COA ●')).toBeInTheDocument();
  });

  it('offers a PDF and a packing-list button per row', async () => {
    await open([inv('BL/4', 'PO-4', {})]);
    expect(screen.getByLabelText('PDF for BL/4')).toBeInTheDocument();
    expect(screen.getByLabelText('Packing list for BL/4')).toBeInTheDocument();
  });

  it('filters by PO and searches', async () => {
    await open([inv('BL/5', 'PO-5', {}), inv('BL/6', 'PO-6', {})]);
    await userEvent.selectOptions(screen.getByLabelText('Filter by PO'), 'PO-6');
    expect(screen.queryByText('BL/5')).not.toBeInTheDocument();
    expect(screen.getByText('BL/6')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by PO'), '');
    await userEvent.type(screen.getByLabelText('Search invoices'), 'BL/5');
    expect(screen.getByText('BL/5')).toBeInTheDocument();
    expect(screen.queryByText('BL/6')).not.toBeInTheDocument();
  });

  it('sorts newest first by default and can flip', async () => {
    await open([
      { ...inv('BL/OLD', 'PO-7', {}), date: '2026-08-01' },
      { ...inv('BL/NEW', 'PO-8', {}), date: '2026-08-19' },
    ]);
    const order = () => [...document.querySelectorAll('table tbody tr')]
      .map((r) => r.cells[0].textContent.trim()).filter((t) => t.startsWith('BL/'));
    expect(order()).toEqual(['BL/NEW', 'BL/OLD']);
    await userEvent.selectOptions(screen.getByLabelText('Sort invoices'), 'oldest');
    expect(order()).toEqual(['BL/OLD', 'BL/NEW']);
  });
});
