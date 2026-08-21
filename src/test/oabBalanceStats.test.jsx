import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp, oabModule } from './harness.jsx';
import OabBoard from '../pages/OabBoard.jsx';
import { calcKg, calcMetres, balance } from '../lib/calc.js';

// Client change, 2026-08-21:
//   1. Bal Mtrs carries the 5% wastage allowance, matching the per-row Mtrs column
//      and the banner underneath (it used to show the net figure — and still does
//      in OAB-App).
//   2. A new "Bal Kg's" card converts the balance to weight.

describe('calcKg — balance to kilograms of film', () => {
  const jssPouch = { dispatchForm: 'Pouch', pouchWeight: 12.5 };      // grams per pouch
  const jssRoll = { dispatchForm: 'Roll', pouchWeight: 0 };

  it('converts a piece count with the spec\'s pouch weight, net and with 5% wastage', () => {
    // 1000 × 12.5 g = 12.5 kg net; film to consume is +5%.
    expect(calcKg({}, 1000, jssPouch)).toEqual({ net: 12.5, withWastage: 13.125 });
    expect(calcKg({}, 0, jssPouch)).toEqual({ net: 0, withWastage: 0 });
  });

  it('takes a roll quantity as the net weight — already kilograms — then adds wastage', () => {
    expect(calcKg({}, 850, jssRoll)).toEqual({ net: 850, withWastage: 892.5 });
    expect(calcKg({ dispatchForm: 'Kgs' }, 400, null)).toEqual({ net: 400, withWastage: 420 });
  });

  it('reads the weight off the row when the spec is missing', () => {
    expect(calcKg({ dispatchForm: 'Pouch', pouchWeight: 20 }, 500, null)).toEqual({ net: 10, withWastage: 10.5 });
  });

  it('returns null — not 0 — when no weight is recorded, so it can be reported', () => {
    expect(calcKg({ dispatchForm: 'Pouch' }, 1000, {})).toBe(null);
    expect(calcKg({ dispatchForm: 'Bulk Bag' }, 1000, { dispatchForm: 'Bulk Bag' })).toBe(null);
  });
});

/* ── The board's stat row ─────────────────────────────────────────────────── */

const jss = [
  { spec: 'A1', dispatchForm: 'Pouch', width: 300, height: 250, gsm: 60, pouchWeight: 12.5, customer: 'Acme' },
  { spec: 'B2', dispatchForm: 'Pouch', width: 200, height: 200, gsm: 50, pouchWeight: 8, customer: 'Acme' },
  { spec: 'C3', dispatchForm: 'Pouch', width: 150, customer: 'Acme' },   // no weight on the spec
];
const rows = [
  { so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', dispatchForm: 'Pouch', poQty: 10000, invDisp: 0, manDisp: 0, fg: 0, poDate: '2026-08-01' },
  { so: '26/2', spec: 'B2', customer: 'Acme', jobName: 'Pouch B', dispatchForm: 'Pouch', poQty: 5000, invDisp: 1000, manDisp: 0, fg: 0, poDate: '2026-08-01' },
  { so: '26/3', spec: 'C3', customer: 'Acme', jobName: 'Pouch C', dispatchForm: 'Pouch', poQty: 2000, invDisp: 0, manDisp: 0, fg: 0, poDate: '2026-08-01' },
];

const statCard = (label) => [...document.querySelectorAll('.stats .stat')]
  .find((c) => c.querySelector('.sl').textContent.trim().startsWith(label));
/** The ⚠ line under a card, not the ⓘ explanation that also mentions weight. */
const NO_WEIGHT = /spec(s)? (has|have) no weight/;

describe('OAB board — Bal Mtrs and Bal Kg\'s', () => {
  it('shows Bal Mtrs WITH the 5% wastage, agreeing with the banner below it', async () => {
    renderApp(<OabBoard />, { modules: { oab: oabModule({ SF: rows }), jss }, route: '/oab?sheet=SF' });
    await screen.findByText('Pouch A');

    // A1: 10,000 × 300mm = 3,000 m · B2: 4,000 × 200mm = 800 m · C3: 2,000 × 150mm = 300 m
    const net = rows.reduce((s, r) => s + calcMetres(r, balance(r), jss.find((j) => j.spec === r.spec)).net, 0);
    const withWastage = rows.reduce((s, r) => s + calcMetres(r, balance(r), jss.find((j) => j.spec === r.spec)).withWastage, 0);
    expect(net).toBe(4100);
    expect(withWastage).toBe(4305);

    expect(within(statCard('Bal Mtrs')).getByText(/4,305/)).toBeInTheDocument();
    expect(document.querySelector('.al.al-g').textContent).toMatch(/5% wastage allowance/);
  });

  it('shows Bal Kg\'s from the balance × the spec\'s pouch weight', async () => {
    renderApp(<OabBoard />, { modules: { oab: oabModule({ SF: rows }), jss }, route: '/oab?sheet=SF' });
    await screen.findByText('Pouch A');

    // A1: 10,000 × 12.5 g = 125 kg · B2: 4,000 × 8 g = 32 kg → 157 net, +5% = 164.85 → 165.
    // C3 has no weight → excluded.
    expect(within(statCard("Bal Kg's")).getByText(/165/)).toBeInTheDocument();
  });

  it('says how many specs have no weight rather than under-reporting silently', async () => {
    renderApp(<OabBoard />, { modules: { oab: oabModule({ SF: rows }), jss }, route: '/oab?sheet=SF' });
    await screen.findByText('Pouch A');
    expect(within(statCard("Bal Kg's")).getByText(NO_WEIGHT).textContent).toContain('1 spec has no weight');
  });

  it('counts a roll\'s balance as kilograms directly, not × a pouch weight', async () => {
    const rollJss = [{ spec: 'R1', dispatchForm: 'Roll', filmWidth: 480, gsm: 60, pouchWeight: 12.5, customer: 'Acme' }];
    const rollRows = [{ so: '26/9', spec: 'R1', customer: 'Acme', jobName: 'Roll R', dispatchForm: 'Roll', poQty: 850, invDisp: 0, manDisp: 0, fg: 0, poDate: '2026-08-01' }];
    renderApp(<OabBoard />, { modules: { oab: oabModule({ SF: rollRows }), jss: rollJss }, route: '/oab?sheet=SF' });
    await screen.findByText('Roll R');

    // The PO qty of a roll IS the weight — 850 kg net. With the 5% wastage the film to
    // consume is 892.5 → 893.
    expect(within(statCard("Bal Kg's")).getByText(/893/)).toBeInTheDocument();
    expect(within(statCard("Bal Kg's")).queryByText(NO_WEIGHT)).not.toBeInTheDocument();
  });

  it('explains every figure behind an ⓘ, reachable by keyboard', async () => {
    renderApp(<OabBoard />, { modules: { oab: oabModule({ SF: rows }), jss }, route: '/oab?sheet=SF' });
    await screen.findByText('Pouch A');

    ['SOs', 'PO Qty', 'Dispatched', 'FG', 'Bal to Produce', 'Bal Mtrs', "Bal Kg's"].forEach((label) => {
      const icon = within(statCard(label)).getByRole('note');
      expect(icon).toHaveAttribute('tabindex', '0');            // not hover-only
      expect(icon.getAttribute('aria-label')).toMatch(new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': .'));
    });
  });

  it('spells out the two formulas people plan against', async () => {
    renderApp(<OabBoard />, { modules: { oab: oabModule({ SF: rows }), jss }, route: '/oab?sheet=SF' });
    await screen.findByText('Pouch A');

    expect(within(statCard('Bal Mtrs')).getByRole('note').getAttribute('aria-label'))
      .toMatch(/5% wastage allowance/);
    const kgInfo = within(statCard("Bal Kg's")).getByRole('note').getAttribute('aria-label');
    expect(kgInfo).toMatch(/pouch weight/);
    expect(kgInfo).toMatch(/5% wastage/);                       // consistent with Bal Mtrs
    expect(kgInfo).toMatch(/Rolls are ordered in kilograms/);   // the non-obvious rule
  });

  it('follows the filters — both figures cover only the rows in view', async () => {
    // The JSS is authoritative for the customer name, so the Beta row needs its own spec.
    const betaJss = [...jss, { spec: 'D4', dispatchForm: 'Pouch', width: 300, pouchWeight: 12.5, customer: 'Beta' }];
    const mixed = [...rows, { so: '26/4', spec: 'D4', customer: 'Beta', jobName: 'Pouch D', dispatchForm: 'Pouch', poQty: 4000, invDisp: 0, manDisp: 0, fg: 0, poDate: '2026-08-01' }];
    renderApp(<OabBoard />, { modules: { oab: oabModule({ SF: mixed }), jss: betaJss }, route: '/oab?sheet=SF' });
    await screen.findByText('Pouch D');

    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.selectOptions(screen.getByLabelText('Filter by customer'), 'Beta');

    // Beta alone: 4,000 × 300mm = 1,200 m → 1,260 with wastage;
    // 4,000 × 12.5 g = 50 kg net → 52.5 with wastage → 53.
    expect(within(statCard('Bal Mtrs')).getByText(/1,260/)).toBeInTheDocument();
    expect(within(statCard("Bal Kg's")).getByText(/53/)).toBeInTheDocument();
  });
});
