import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import { installFetch, oabModule } from './harness.jsx';
import PlanReadiness from '../pages/PlanReadiness.jsx';
import { coverFromLines, bomPending, readyRefusal } from '../lib/bomApprovalApi.js';

// BloomFlex V2 — BOM approval before Ready to Plan + material readiness on the PLAN board.

const JSS = [{ spec: 'A1405', customer: 'VSA Foods', jobName: 'Coconut water sleeve', material: 'CAST PVC', filmWidth: 375, width: 85, height: 128, status: 'Active' }];
const OAB = oabModule({ SF: [
  { so: '26/771', spec: 'A1405', customer: 'VSA Foods', jobName: 'Coconut water sleeve', dispLoc: 'Dindigul', poQty: 100000, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-20' },
  { so: '26/772', spec: 'A1405', customer: 'VSA Foods', jobName: 'Coconut water sleeve', dispLoc: 'Dindigul', poQty: 100000, invDisp: 0, manDisp: 0, fg: 0, closed: false, poDate: '2026-09-21' },
] });

const BOARD = [
  { so: '26/771', readyToPlan: false, bomApproved: true, bomApprovedBy: 'qc1', bomApprovedAt: '2026-11-18T10:00:00', bomLines: 3,
    materialStatus: 'PARTIAL', materialCoverPct: 80, eligibleQty: 80000 },
  { so: '26/772', readyToPlan: false, bomApproved: false, bomLines: 2, materialStatus: 'BLOCKED', materialCoverPct: 0, eligibleQty: 0 },
];

function mount(readiness = BOARD, role = 'plan') {
  const posted = [];
  const approved = [];
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_user', role);
  localStorage.setItem('blm_role', role);
  installFetch(JSON.parse(JSON.stringify({ oab: OAB, jss: JSS, customers: [], prices: {} })), { role, user: role });
  const base = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const json = (b) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('/api/planning/bom-approval') && method === 'POST') {
      const body = JSON.parse(opts.body);
      approved.push(body);
      readiness = readiness.map((r) => (r.so === body.so ? { ...r, bomApproved: true, bomApprovedBy: role } : r));
      return json({ so: body.so, bomApproved: true, bomApprovedBy: role });
    }
    if (u.includes('/api/planning/ready') && method === 'POST') {
      const body = JSON.parse(opts.body);
      posted.push(body);
      return json({ so: body.so, readyToPlan: body.ready, readyMode: body.mode });
    }
    if (u.includes('/api/planning/readiness')) return json(readiness);
    if (u.includes('/api/planning/week')) return json({ jobs: [], capacity: [] });
    if (u.includes('/api/bom') || u.includes('/api/stores/')) return json([]);
    return base(url, opts);
  };
  render(<MemoryRouter><AuthProvider><DataProvider><PlanReadiness /></DataProvider></AuthProvider></MemoryRouter>);
  return { posted, approved };
}

const bar = () => screen.getByRole('toolbar', { name: 'Ready to Plan actions' });
const full = () => within(bar()).getByRole('button', { name: /Ready to Plan — Full/ });
const partial = () => within(bar()).getByRole('button', { name: /Ready to Plan — Partial/ });

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('BloomFlex V2 — BOM approval on the PLAN board', () => {
  it('shows the BOM and Material columns with badges, eligible qty and %', async () => {
    mount();
    const ok = await screen.findByLabelText('BOM of 26/771 approved');
    expect(ok).toHaveTextContent('✓ Approved by qc1');
    expect(screen.getByLabelText('BOM of 26/772 pending')).toHaveTextContent('Pending');
    expect(screen.getByRole('button', { name: 'Approve BOM of 26/772' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve BOM of 26/771' })).toBeNull();

    const m1 = screen.getByLabelText('Material of 26/771');
    expect(m1).toHaveTextContent('Partial');
    expect(m1).toHaveTextContent('80,000 · 80%');
    expect(screen.getByLabelText('Material of 26/772')).toHaveTextContent('Blocked');
  });

  it('locks Full / Partial while the picked order’s BOM is pending', async () => {
    mount();
    await userEvent.click(await screen.findByLabelText('Select 26/772'));
    expect(full()).toBeDisabled();
    expect(partial()).toBeDisabled();
    expect(full()).toHaveAttribute('title', expect.stringMatching(/BOM not approved/));

    await userEvent.click(screen.getByLabelText('Select 26/771'));
    expect(full()).toBeEnabled();
    expect(partial()).toBeEnabled();
  });

  it('approves the BOM from the board, which unlocks Ready to Plan', async () => {
    const { approved, posted } = mount();
    await userEvent.click(await screen.findByLabelText('Select 26/772'));
    expect(full()).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Approve BOM of 26/772' }));
    await waitFor(() => expect(approved).toEqual([{ so: '26/772' }]));
    await screen.findByLabelText('BOM of 26/772 approved');
    expect(full()).toBeEnabled();
    await userEvent.click(full());
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toMatchObject({ so: '26/772', ready: true, mode: 'COMPLETE' });
  });

  it('the material panel shows the approval, an Approve button and the coverage', async () => {
    const { approved } = mount();
    await userEvent.click(await screen.findByLabelText('Select 26/772'));
    const head = await screen.findByLabelText('BOM approval of 26/772');
    expect(head).toHaveTextContent('BOM approval pending');
    expect(within(head).getByRole('progressbar', { name: 'Material coverage' })).toHaveAttribute('aria-valuenow', '0');
    await userEvent.type(within(head).getByLabelText('Approval note for 26/772'), 'ok per QC');
    await userEvent.click(within(head).getByRole('button', { name: 'Approve the BOM of 26/772' }));
    await waitFor(() => expect(approved).toEqual([{ so: '26/772', note: 'ok per QC' }]));
  });

  it('roles outside the reviewers see the status but no Approve button', async () => {
    mount(BOARD, 'mis');
    await screen.findByLabelText('BOM of 26/772 pending');
    expect(screen.queryByRole('button', { name: 'Approve BOM of 26/772' })).toBeNull();
  });

  it('lets the Super Admin override a pending BOM after confirming', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { posted } = mount(BOARD, 'superadmin');
    await userEvent.click(await screen.findByLabelText('Select 26/772'));
    expect(full()).toBeEnabled();
    await userEvent.click(full());
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/not approved.*Override/));
    await waitFor(() => expect(posted.length).toBe(1));
  });

  it('a Super Admin who declines the override posts nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { posted } = mount(BOARD, 'superadmin');
    await userEvent.click(await screen.findByLabelText('Select 26/772'));
    await userEvent.click(full());
    await new Promise((r) => setTimeout(r, 50));
    expect(posted.length).toBe(0);
  });
});

describe('BloomFlex V2 — coverage helpers', () => {
  it('takes the weakest measurable line, each capped at 100 %, skipping unit mismatches', () => {
    expect(coverFromLines([
      { onBom: true, required: 500, covered: 400 },
      { onBom: true, required: 100, covered: 250 },
      { onBom: true, required: 50, covered: 0, uomMismatch: true },
      { onBom: true, required: 0, covered: 0 },
      { onBom: false, required: null, covered: 10 },
    ])).toEqual({ pct: 80, status: 'PARTIAL' });
    expect(coverFromLines([{ onBom: true, required: 10, covered: 10 }])).toEqual({ pct: 100, status: 'READY' });
    expect(coverFromLines([{ onBom: true, required: 10, covered: 0 }])).toEqual({ pct: 0, status: 'BLOCKED' });
    expect(coverFromLines([])).toBeNull();
  });

  it('leaves out an ink the stores hold none of (mixed on the spot), as the server does', () => {
    const lines = [
      { onBom: true, itemCode: 'FILM1', materialType: 'FILM', required: 500, covered: 250 },
      { onBom: true, itemCode: 'MAG', materialType: 'INK', subGroup: 'C I FLEXO', required: 1, covered: 0 },
      { onBom: true, itemCode: 'SLV', materialType: 'FILM', subGroup: 'SHRINK', required: 10, covered: 10 },
    ];
    const none = () => 0;
    expect(coverFromLines(lines, none)).toEqual({ pct: 50, status: 'PARTIAL' });
    // free magenta in the stores → a real shortage again
    expect(coverFromLines(lines, (l) => (l.itemCode === 'MAG' ? 5 : 0))).toEqual({ pct: 0, status: 'BLOCKED' });
    // a SHRINK film with no stock is no ink — it still counts
    expect(coverFromLines([{ ...lines[2], covered: 0 }], none)).toEqual({ pct: 0, status: 'BLOCKED' });
    // without stock information every line counts, as before
    expect(coverFromLines(lines)).toEqual({ pct: 0, status: 'BLOCKED' });
  });

  it('a row is pending only when the server says so and it is not already ready', () => {
    expect(bomPending({ bomApproved: false })).toBe(true);
    expect(bomPending({ bomApproved: false, readyToPlan: true })).toBe(false);
    expect(bomPending({ bomApproved: true })).toBe(false);
    expect(bomPending({})).toBe(false);
    expect(bomPending(undefined)).toBe(false);
  });

  it('says a BOM refusal plainly', () => {
    expect(readyRefusal(new Error('BOM not approved for SO 26/1'))).toMatch(/ask PLAN \/ PPC \/ PM \/ QC/);
    expect(readyRefusal(new Error('Route is not configured'))).toBe('Route is not configured');
  });
});
