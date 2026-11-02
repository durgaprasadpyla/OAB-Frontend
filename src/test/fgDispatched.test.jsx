// Issues 02.11 — FG Entry, E1025: produced 629,800, allocated 352,400, available
// 277,400. "As soon as an invoice happens, that means the allocated quantity has
// left the premises, and I don't need its data here": an invoiced allocation comes
// off Produced and Allocated; Available does not move.
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import FGLedger from '../pages/FGLedger.jsx';
import { fgStock, fgDispatchedBySo, fgOrderIndex } from '../lib/fg.js';

const ledger = () => ({
  E1025: {
    prod: [{ date: '2026-10-01', qty: 629800, ts: 1, id: 'p1', note: '' }],
    alloc: [{ date: '2026-10-05', qty: 352400, ts: 2, so: '26/900', src: 'new-po' }],
  },
});
const so = (patch) => ({ so: '26/900', spec: 'E1025', customer: 'Acme', jobName: 'Pouch E', poQty: 352400, invDisp: 0, manDisp: 0, fg: 352400, ...patch });

describe('fgStock', () => {
  it('an SO not yet invoiced keeps its allocation', () => {
    const orders = fgOrderIndex(oabModule({ SF: [so()] }));
    expect(fgStock(ledger(), 'E1025', orders)).toEqual({ produced: 629800, allocated: 352400, available: 277400, dispatched: 0 });
  });

  it('a fully invoiced SO is gone from produced and allocated', () => {
    const orders = fgOrderIndex(oabModule({ SF: [so({ invDisp: 352400, fg: 0 })] }));
    expect(fgStock(ledger(), 'E1025', orders)).toEqual({ produced: 277400, allocated: 0, available: 277400, dispatched: 352400 });
  });

  it('a part-invoiced SO takes off only what went out', () => {
    const orders = fgOrderIndex(oabModule({ OT: [so({ invDisp: 100000, fg: 252400 })] }));
    expect(fgStock(ledger(), 'E1025', orders)).toMatchObject({ produced: 529800, allocated: 252400, available: 277400 });
  });

  it('never counts more than the SO has invoiced, and an SO the book has lost keeps its allocation', () => {
    // FG cut down by hand on the OAB without an invoice is not a dispatch
    expect(fgDispatchedBySo(ledger(), 'E1025', fgOrderIndex(oabModule({ SF: [so({ fg: 0, invDisp: 50000 })] })))).toEqual({ '26/900': 50000 });
    expect(fgDispatchedBySo(ledger(), 'E1025', fgOrderIndex(oabModule({ SF: [so({ fg: 0 })] })))).toEqual({});
    expect(fgStock(ledger(), 'E1025', {})).toMatchObject({ produced: 629800, allocated: 352400 });
  });
});

describe('FG Entry screen', () => {
  const jss = [{ spec: 'E1025', customer: 'Acme', jobName: 'Pouch E', status: 'Active' }];

  it('shows E1025 with the invoiced 352,400 gone from produced and allocated', async () => {
    const user = userEvent.setup();
    renderApp(<FGLedger />, { modules: { jss, fgLedger: ledger(), oab: oabModule({ SF: [so({ invDisp: 352400, fg: 0 })] }) } });
    await screen.findByText(/FG Entry/);
    await user.type(screen.getByLabelText('JSS / Spec #'), 'E1025');

    expect(await screen.findByText(/Produced \(in stock\)/)).toHaveTextContent('Produced (in stock): 2,77,400');
    expect(screen.getByText(/Produced \(in stock\)/)).toHaveTextContent('Allocated to SOs: 0');
    expect(screen.getByText(/Dispatched on invoice \(no longer counted\)/)).toHaveTextContent('3,52,400');
    expect(screen.getByText('Nothing allocated — every allocation has been invoiced')).toBeInTheDocument();
    expect(screen.getByText(/Less: dispatched on invoice \(SO 26\/900\)/)).toBeInTheDocument();

    // the summary row reads the same
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('E1025') && within(r).queryByText('Pouch E'));
    expect(row).toHaveTextContent('2,77,400');
    expect(row).not.toHaveTextContent('6,29,800');
  });
});
