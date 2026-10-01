import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import { installFetch, renderApp } from './harness.jsx';
import PDashboard from '../pages/PDashboard.jsx';
import QC from '../pages/QC.jsx';

// Issues as on 30.09 — Super Admin + the overlay half of QC:
//   SA2 (RED) "Display the stock that is available on the PDashboard page — the same
//       display that is in the stores login Raw Material on Hand page — next to the
//       Item Master." It was a fourth card at the foot of the Item Master tab; it is
//       its own tab now, immediately after Item Master.
//   The CAPA and COA / Food Grade previews sat UNDER the sticky role bar (z-index
//   200 vs 60) — the same clipping the PO preview had: header and buttons hidden.
// (SA1 — the per-department breakdown — is covered in soBomDownload.test.jsx.)

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const res = (body, status = 200) => ({
  status, ok: status < 300, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

const ON_HAND = [
  { id: 306, code: 'BLM306', name: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '20',
    departmentName: 'Printing', closingStock: 194.92, unitCount: 1, uom: 'Kg', msl: 50, stockValue: 25000, byStatus: {}, active: true },
];

/** PDashboard on the shared harness, with the stores board's reads answered. */
function mountPDashboard(role) {
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_user', role);
  localStorage.setItem('blm_role', role);
  const saved = installFetch({ purchase: { asl: [], pos: [], priceHistory: [], counter: 0, itemsExtra: [] } }, { role, user: role });
  const base = globalThis.fetch;
  const storesCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/stores/')) {
      storesCalls.push({ u, method: (opts.method || 'GET').toUpperCase() });
      if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
      return res([]);
    }
    return base(url, opts);
  };
  render(<MemoryRouter><AuthProvider><DataProvider><PDashboard /></DataProvider></AuthProvider></MemoryRouter>);
  return { saved, storesCalls };
}

const tabLabels = () => [...document.querySelectorAll('.step-tab')].map((t) => t.textContent);

describe('P Dashboard — Stock on Hand sits next to the Item Master', () => {
  ['padmin', 'superadmin'].forEach((role) => {
    it(`is its own tab right after Item Master, read-only (${role})`, async () => {
      const user = userEvent.setup();
      const { storesCalls } = mountPDashboard(role);
      await screen.findByText('📦 PO Tracking');
      const labels = tabLabels();
      expect(labels.indexOf('📦 Stock on Hand')).toBe(labels.indexOf('🗂 Item Master') + 1);

      await user.click(screen.getByText('📦 Stock on Hand'));
      expect(await screen.findByText('Material on hand')).toBeInTheDocument();
      expect(await screen.findByText('BLM306')).toBeInTheDocument();
      // the stores desk's board, but nothing on it can be changed from here
      expect(screen.queryByLabelText('MSL for BLM306')).toBeNull();
      expect(screen.queryByText(/Set MSL from 3-month average/)).toBeNull();
      expect(screen.getByText(/read here as it stands; MSL and dispositions are set by Stores/)).toBeInTheDocument();
      expect(storesCalls.every((c) => c.method === 'GET')).toBe(true);
    });
  });

  it('the Item Master tab is the item master only — the board is no longer tucked under it', async () => {
    const user = userEvent.setup();
    mountPDashboard('padmin');
    await user.click(await screen.findByText('🗂 Item Master'));
    expect((await screen.findAllByPlaceholderText(/Search item/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('Material on hand')).toBeNull();
    expect(screen.queryByLabelText('Stock on hand')).toBeNull();
  });

  it('reads the board once — a stable message callback, no re-fetch loop', async () => {
    const user = userEvent.setup();
    const { storesCalls } = mountPDashboard('padmin');
    await user.click(await screen.findByText('📦 Stock on Hand'));
    await screen.findByText('BLM306');
    await new Promise((r) => setTimeout(r, 150));
    expect(storesCalls.filter((c) => c.u.includes('/api/stores/on-hand'))).toHaveLength(1);
  });
});

/* ───────── overlays above the sticky role bar ───────── */

const overlayOf = (node) => {
  let el = node;
  while (el && !(el.style && el.style.position === 'fixed')) el = el.parentElement;
  return el;
};

describe('QC previews open above the role bar', () => {
  it('the CAPA PDF preview', async () => {
    const user = userEvent.setup();
    renderApp(<QC />, {
      modules: { jss: [], customers: [], capa: [{ id: 'c1', no: 'CAPA-1', customer: 'Acme', complaint: 'Seal', status: 'Open' }] },
      role: 'qc',
    });
    await user.click(await screen.findByText('🛠 CAPA'));
    await user.click(await screen.findByLabelText('PDF for CAPA-1'));
    const close = await screen.findByRole('button', { name: 'Close' });
    const overlay = overlayOf(close);
    expect(overlay).toBeTruthy();
    expect(Number(overlay.style.zIndex)).toBeGreaterThanOrEqual(1000);
  });

  it('the COA / Food Grade preview', async () => {
    const user = userEvent.setup();
    const INV = { no: 'BFX/2026-27/001', date: '2026-08-10', customer: 'Acme Foods', po: 'PO-1', items: [{ spec: 'SP-1', qty: 5000, jobName: 'Pouch A' }] };
    renderApp(<QC />, {
      modules: {
        jss: [{ spec: 'SP-1', jobName: 'Pouch A', mic: 51, width: 120, height: 200 }],
        oab: { OAB: { SF: [{ so: '26/500', spec: 'SP-1', poNum: 'PO-1' }], OT: [] }, INV_REG: [INV], lastSO: { y: '26', n: 500 }, lastInvNo: 1 },
        capa: [],
      },
      role: 'qc',
    });
    await user.click(await screen.findByText(/Certificates/));
    await user.click(await screen.findByLabelText('COA for BFX/2026-27/001 SP-1'));
    await user.click(screen.getByText(/Preview \/ Download/));
    const doc = await screen.findByText('CERTIFICATE OF ANALYSIS');
    const overlay = overlayOf(doc);
    expect(overlay).toBeTruthy();
    expect(Number(overlay.style.zIndex)).toBeGreaterThanOrEqual(1000);
    expect(within(overlay).getAllByRole('button').length).toBeGreaterThan(0);
  });
});
