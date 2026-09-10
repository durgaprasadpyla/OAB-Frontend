import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Super Admin → Dashboard → Edit SOs: the PO quantity is editable.
//
// A customer revising the quantity on a live PO is ordinary, and until now the only way
// to record it was to delete the order and re-key it — which loses the SO number and its
// history. PO Qty is the one field on this screen that moves money and material: the
// balance still to make is poQty minus what has gone out, the BOM requirement scales off
// it, and a short-close is judged against it. So it is checked rather than taken as typed.

vi.mock('../lib/xlsx.js', () => ({ exportAOA: vi.fn(), exportObjects: vi.fn(), readSheet: vi.fn(async () => []) }));
vi.mock('../lib/pdf.js', () => ({ elementToPDF: vi.fn(async () => {}), printElement: vi.fn() }));

const OAB = {
  OAB: {
    SF: [
      // nothing dispatched yet — free to move in either direction
      { so: '26/701', spec: 'A1', customer: 'Amazon', jobName: 'Pouch A', poNum: 'PO-1',
        poDate: '2026-09-01', dispLoc: 'Chennai', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, closed: false },
      // 600 of 1000 already out the door
      { so: '26/702', spec: 'A2', customer: 'Nandi', jobName: 'Pouch B', poNum: 'PO-2',
        poDate: '2026-09-02', dispLoc: 'Hosur', poQty: 1000, invDisp: 400, manDisp: 150, fg: 50, closed: false },
    ],
    OT: [],
  },
};

let saved;
beforeEach(() => {
  saved = [];
  vi.doMock('../data.jsx', () => ({
    useData: () => ({
      mods: { oab: JSON.parse(JSON.stringify(OAB)), jss: [], customers: [], sales: {}, bom: {} },
      save: async (key, next) => { saved.push({ key, next }); },
      reloadModule: vi.fn(),
    }),
  }));
  globalThis.fetch = vi.fn(async () => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => [], text: async () => '[]' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

/** Answer the four prompts in order: PO number, PO date, location, quantity. */
function answerPrompts(answers) {
  let i = 0;
  vi.spyOn(window, 'prompt').mockImplementation(() => (i < answers.length ? answers[i++] : null));
}

async function openEditSos() {
  const { default: Dashboard } = await import('../pages/Dashboard.jsx');
  render(<Dashboard />);
  fireEvent.click(await screen.findByText('✏ Edit SOs'));
  return screen.findByText('26/701');
}
const rowOf = (so) => screen.getByText(so).closest('tr');

describe('Edit SOs — the PO quantity', () => {
  it('asks for the quantity and shows what the order stands at', async () => {
    await openEditSos();
    answerPrompts(['PO-1', '2026-09-01', 'Chennai', '1500']);
    fireEvent.click(rowOf('26/701').querySelector('button:nth-of-type(2)'));

    await waitFor(() => expect(saved).toHaveLength(1));
    const asked = window.prompt.mock.calls[3][0];
    expect(asked).toContain('Edit PO Qty');
    expect(asked).toContain('Current: 1000');
    expect(window.prompt.mock.calls[3][1]).toBe('1000');   // pre-filled with today's value
  });

  it('saves the revised quantity onto that order and no other', async () => {
    await openEditSos();
    answerPrompts(['PO-1', '2026-09-01', 'Chennai', '1500']);
    fireEvent.click(rowOf('26/701').querySelector('button:nth-of-type(2)'));

    await waitFor(() => expect(saved).toHaveLength(1));
    const rows = saved[0].next.OAB.SF;
    expect(rows.find((r) => r.so === '26/701').poQty).toBe(1500);
    expect(rows.find((r) => r.so === '26/702').poQty).toBe(1000);   // untouched
    expect(saved[0].key).toBe('oab');
  });

  it('names what is already out when the order has been dispatched against', async () => {
    await openEditSos();
    answerPrompts(['PO-2', '2026-09-02', 'Hosur', '1200']);
    fireEvent.click(rowOf('26/702').querySelector('button:nth-of-type(2)'));

    await waitFor(() => expect(saved).toHaveLength(1));
    // 400 invoiced + 150 manual + 50 FG
    expect(window.prompt.mock.calls[3][0]).toContain('Already dispatched: 600');
  });

  it('refuses a quantity below what has already gone out', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await openEditSos();
    answerPrompts(['PO-2', '2026-09-02', 'Hosur', '500']);   // 600 already dispatched
    fireEvent.click(rowOf('26/702').querySelector('button:nth-of-type(2)'));

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0][0]).toContain('600 has already been dispatched');
    expect(saved).toHaveLength(0);
  });

  it('allows exactly what has gone out — that is a short close, not an impossibility', async () => {
    await openEditSos();
    answerPrompts(['PO-2', '2026-09-02', 'Hosur', '600']);
    fireEvent.click(rowOf('26/702').querySelector('button:nth-of-type(2)'));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].next.OAB.SF.find((r) => r.so === '26/702').poQty).toBe(600);
  });

  it('refuses nonsense rather than writing it', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    for (const bad of ['0', '-5', 'abc', '']) {
      cleanup();
      alert.mockClear();
      saved.length = 0;
      await openEditSos();
      answerPrompts(['PO-1', '2026-09-01', 'Chennai', bad]);
      fireEvent.click(rowOf('26/701').querySelector('button:nth-of-type(2)'));
      await waitFor(() => expect(alert).toHaveBeenCalled());
      expect(alert.mock.calls[0][0]).toContain('greater than zero');
      expect(saved, `"${bad}" must not be saved`).toHaveLength(0);
    }
  });

  it('cancelling the quantity prompt abandons the whole edit', async () => {
    await openEditSos();
    answerPrompts(['PO-1', '2026-09-01', 'Chennai']);   // 4th prompt returns null
    fireEvent.click(rowOf('26/701').querySelector('button:nth-of-type(2)'));
    await new Promise((r) => setTimeout(r, 20));
    expect(saved).toHaveLength(0);
  });
});
