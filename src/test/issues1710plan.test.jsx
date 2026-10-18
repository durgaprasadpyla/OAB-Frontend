import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import { installFetch, oabModule } from './harness.jsx';
import PlanReadiness from '../pages/PlanReadiness.jsx';

// Issues 17.10 §6 (PLAN login): "the 'Ready to Plan' and whether we are planning for
// the entire sale order, partial sale order … should be in the table header only. I
// could not spot 'Ready to Plan', 'Plan Partial', or 'Plan Full'. Upon selecting a
// radio button, the buttons on top ('Ready to Plan') should be enabled."

const JSS = [{ spec: 'A1405', customer: 'VSA Foods', jobName: 'Coconut water sleeve', material: 'CAST PVC', filmWidth: 375, width: 85, height: 128, status: 'Active' }];
// 1,00,000 sleeves × 85 mm = 8,500 metres
const OAB = oabModule({ SF: [
  { so: '26/771', spec: 'A1405', customer: 'VSA Foods', jobName: 'Coconut water sleeve', dispLoc: 'Dindigul', poQty: 100000, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-20' },
  { so: '26/772', spec: 'A1405', customer: 'VSA Foods', jobName: 'Coconut water sleeve', dispLoc: 'Dindigul', poQty: 100000, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-21' },
] });

function mount(readiness = []) {
  const posted = [];
  // renderApp's harness, but with the planning endpoints wrapped in BEFORE the first
  // render — the board loads the stored readiness on mount.
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_user', 'plan');
  localStorage.setItem('blm_role', 'plan');
  installFetch(JSON.parse(JSON.stringify({ oab: OAB, jss: JSS, customers: [], prices: {} })), { role: 'plan', user: 'plan' });
  const base = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (b) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('/api/planning/ready') && (opts.method || 'GET').toUpperCase() === 'POST') {
      const body = JSON.parse(opts.body);
      posted.push(body);
      return json({ so: body.so, readyToPlan: body.ready, readyMode: body.mode, readyQty: body.readyQty });
    }
    if (u.includes('/api/planning/readiness')) return json(readiness);
    if (u.includes('/api/planning/week')) return json({ jobs: [], capacity: [] });
    if (u.includes('/api/bom') || u.includes('/api/stores/')) return json([]);
    return base(url, opts);
  };
  render(<MemoryRouter><AuthProvider><DataProvider><PlanReadiness /></DataProvider></AuthProvider></MemoryRouter>);
  return { posted };
}

const bar = () => screen.getByRole('toolbar', { name: 'Ready to Plan actions' });
const full = () => within(bar()).getByRole('button', { name: /Ready to Plan — Full/ });
const partial = () => within(bar()).getByRole('button', { name: /Ready to Plan — Partial/ });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('PLAN — Ready to Plan actions sit above the board (Issues 17.10 §6)', () => {
  it('has a radio per row and no readiness controls left inside the rows', async () => {
    mount();
    await screen.findByLabelText('Select 26/771');
    expect(screen.getByLabelText('Select 26/772')).toHaveAttribute('type', 'radio');
    expect(screen.queryByLabelText('Readiness for 26/771')).toBeNull();
    expect(screen.queryByLabelText('Ready mode for 26/771')).toBeNull();
    expect(screen.queryByText('Set readiness')).toBeNull();
  });

  it('keeps the buttons disabled until a row is picked, then highlights that row', async () => {
    mount();
    const radio = await screen.findByLabelText('Select 26/771');
    expect(full()).toBeDisabled();
    expect(partial()).toBeDisabled();
    expect(within(bar()).getByText(/Pick the radio button/)).toBeInTheDocument();

    await userEvent.click(radio);
    expect(full()).toBeEnabled();
    expect(partial()).toBeEnabled();
    expect(radio.closest('tr')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Select 26/772').closest('tr')).toHaveAttribute('aria-selected', 'false');
    expect(within(bar()).getByText('26/771')).toBeInTheDocument();
  });

  it('marks the picked order Ready to Plan — Full with the same call as before', async () => {
    const { posted } = mount();
    await userEvent.click(await screen.findByLabelText('Select 26/772'));
    await userEvent.click(full());
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toMatchObject({ so: '26/772', ready: true, mode: 'COMPLETE' });
    expect(posted[0].readyQty).toBeUndefined();
  });

  it('takes Partial metres inline, bounded 0 < metres ≤ the order’s metres', async () => {
    const { posted } = mount();
    await userEvent.click(await screen.findByLabelText('Select 26/771'));
    // nothing to type until Partial is chosen
    expect(screen.queryByLabelText('Metres ready for 26/771')).toBeNull();
    await userEvent.click(partial());
    const box = screen.getByLabelText('Metres ready for 26/771');
    expect(box).toHaveAttribute('max', '8500');
    const save = within(bar()).getByRole('button', { name: /^Save$/ });

    await userEvent.click(save);                                // empty
    expect(await screen.findByText(/must be greater than 0/)).toBeInTheDocument();
    await userEvent.type(box, '9000');                          // more than 8,500 m
    await userEvent.click(save);
    expect(await screen.findByText(/cannot exceed the 8,500 m/)).toBeInTheDocument();
    expect(posted.length).toBe(0);

    await userEvent.clear(box);
    await userEvent.type(box, '4000');
    await userEvent.click(save);
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toMatchObject({ so: '26/771', ready: true, mode: 'PARTIAL', readyQty: 4000 });
  });

  it('offers Clear Ready only for an order already marked ready', async () => {
    const { posted } = mount([{ so: '26/771', readyToPlan: true, readyMode: 'PARTIAL', readyQty: 3000 }]);
    await screen.findByText('Partial · 3000 m');                 // the stored state has loaded
    await userEvent.click(screen.getByLabelText('Select 26/772'));
    expect(within(bar()).queryByRole('button', { name: 'Clear Ready' })).toBeNull();

    await userEvent.click(screen.getByLabelText('Select 26/771'));
    // the bar shows the stored state, and Partial re-opens with its metres
    expect(within(bar()).getByText('Partial · 3000 m')).toBeInTheDocument();
    await userEvent.click(partial());
    expect(screen.getByLabelText('Metres ready for 26/771')).toHaveValue(3000);

    await userEvent.click(within(bar()).getByRole('button', { name: 'Clear Ready' }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toMatchObject({ so: '26/771', ready: false });
    expect(posted[0].notReadyReason).toBeUndefined();
  });
});
