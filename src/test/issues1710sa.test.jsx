import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { renderApp, oabModule } from './harness.jsx';
import Dashboard from '../pages/Dashboard.jsx';

// Issues 17.10 §1: Super Admin → Dashboard → Edit SOs → ✎ Edit PO#. The dispatch
// location is a drop-down of the SO's customer's Customer Master rows, not free text.

vi.mock('../lib/xlsx.js', () => ({ exportAOA: vi.fn(), exportObjects: vi.fn(), readSheet: vi.fn(async () => []) }));
vi.mock('../lib/pdf.js', () => ({ elementToPDF: vi.fn(async () => {}), printElement: vi.fn() }));

const jss = [
  { spec: 'K1', jobName: 'Kova Pouch', customer: 'Kova Agro', dispatchForm: 'Pouch', status: 'Active' },
  { spec: 'N1', jobName: 'Nandi Roll', customer: 'Nandi', dispatchForm: 'Roll', status: 'Active' },
];
const customers = [
  { group: 'Kova', customer: 'Kova Agro', dispatchLoc: 'DHARAPURAM', warehouseName: 'DHARAPURAM' },
  { group: 'Kova', customer: 'Kova Agro', dispatchLoc: 'DHARAPURAM', warehouseName: 'KOVAI OWN' },
  { group: 'Kova', customer: 'kova  agro', dispatchLoc: 'Tirupur', warehouseName: '' },
  { group: 'Other', customer: 'Amazon', dispatchLoc: 'Chennai', warehouseName: '' },   // another customer
];
const row = (over) => ({ so: '26/801', spec: 'K1', customer: 'Kova Agro', jobName: 'Kova Pouch', poNum: 'PO-1', poDate: '2026-10-01', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, closed: false, ...over });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openEdit(sfRows) {
  const r = renderApp(<Dashboard />, { modules: { oab: oabModule({ SF: sfRows }), jss, customers }, role: 'superadmin' });
  fireEvent.click(await screen.findByText('✏ Edit SOs'));
  await screen.findByText(sfRows[0].so);
  return r;
}
/** PO number, PO date, then (after the location) PO qty. */
function answerPrompts(answers) {
  let i = 0;
  return vi.spyOn(window, 'prompt').mockImplementation(() => (i < answers.length ? answers[i++] : null));
}
const clickEditPO = (so) => fireEvent.click(within(screen.getByText(so).closest('tr')).getByRole('button', { name: /Edit PO#/ }));
const lastOabRow = (saved, so) => [...saved].reverse().find((s) => s.id === 1).data.OAB.SF.find((r) => r.so === so);

describe('Issues 17.10 §1 — Edit SO dispatch location is a drop-down', () => {
  it("offers only that customer's Customer Master locations, warehouse-distinguished", async () => {
    await openEdit([row({ dispLoc: 'DHARAPURAM', warehouseName: 'KOVAI OWN' })]);
    answerPrompts(['PO-1', '2026-10-01', '1000']);
    clickEditPO('26/801');

    const sel = await screen.findByLabelText('Dispatch Location');
    const labels = [...sel.options].map((o) => o.textContent);
    expect(labels).toEqual(['DHARAPURAM (DHARAPURAM)', 'DHARAPURAM (KOVAI OWN)', 'Tirupur']);
    expect(labels.some((l) => /Chennai/.test(l))).toBe(false);
    // the stored row+warehouse is what is preselected
    expect(sel.options[sel.selectedIndex].textContent).toBe('DHARAPURAM (KOVAI OWN)');
    // only two prompts so far: the location is not asked by prompt
    expect(window.prompt).toHaveBeenCalledTimes(2);
  });

  it('saves the picked location (and its warehouse) onto the same fields', async () => {
    const { saved } = await openEdit([row({ dispLoc: 'DHARAPURAM', warehouseName: 'DHARAPURAM' })]);
    answerPrompts(['PO-9', '2026-10-02', '1200']);
    clickEditPO('26/801');

    const sel = await screen.findByLabelText('Dispatch Location');
    fireEvent.change(sel, { target: { value: 'Tirupur||' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(saved.some((s) => s.id === 1)).toBe(true));
    const r = lastOabRow(saved, '26/801');
    expect(r.dispLoc).toBe('Tirupur');
    expect(r.warehouseName).toBe('');
    expect(r.poNum).toBe('PO-9');
    expect(r.poQty).toBe(1200);
  });

  it('keeps a stored value that is not in the master selectable as "(current) …"', async () => {
    const { saved } = await openEdit([row({ dispLoc: 'Old Godown' })]);
    answerPrompts(['PO-1', '2026-10-01', '1000']);
    clickEditPO('26/801');

    const sel = await screen.findByLabelText('Dispatch Location');
    expect(sel.options[sel.selectedIndex].textContent).toBe('(current) Old Godown');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(saved.some((s) => s.id === 1)).toBe(true));
    expect(lastOabRow(saved, '26/801').dispLoc).toBe('Old Godown');   // never blanked
  });

  it('cancelling the location abandons the edit', async () => {
    const { saved } = await openEdit([row({ dispLoc: 'Tirupur' })]);
    answerPrompts(['PO-1', '2026-10-01', '1000']);
    clickEditPO('26/801');

    await screen.findByLabelText('Dispatch Location');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByLabelText('Dispatch Location')).toBeNull();
    expect(window.prompt).toHaveBeenCalledTimes(2);   // the qty was never asked
    expect(saved.some((s) => s.id === 1)).toBe(false);
  });

  it('falls back to typing, with a hint, when the customer has no master locations', async () => {
    const { saved } = await openEdit([row({ so: '26/802', spec: 'N1', customer: 'Nandi', jobName: 'Nandi Roll', dispLoc: 'Hosur' })]);
    answerPrompts(['PO-2', '2026-10-01', 'Hosur East', '1000']);
    clickEditPO('26/802');

    await waitFor(() => expect(saved.some((s) => s.id === 1)).toBe(true));
    expect(screen.queryByLabelText('Dispatch Location')).toBeNull();
    expect(window.prompt.mock.calls[2][0]).toContain('No dispatch locations in the Customer Master for this customer');
    expect(window.prompt.mock.calls[2][1]).toBe('Hosur');
    expect(lastOabRow(saved, '26/802').dispLoc).toBe('Hosur East');
  });
});
