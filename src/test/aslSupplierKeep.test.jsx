import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import PDashboard from '../pages/PDashboard.jsx';

// ASL deletes must NOT take the supplier down with the item. A supplier only exists
// through its rows, so deleting its last item keeps an item-less row carrying the
// supplier details + certifications; "Clear All Items" does that for every supplier.

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

let asl;
let saved;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'padmin');
  saved = [];
  asl = [
    { company: 'Acme Films', contact: 'Ravi', phone: '9', gstn: 'GST1', itemCode: 'BFX001', specificMaterial: 'BOPP Film', materialType: 'FILM', subGroup: 'BOPP', uom: 'KG', basicPrice: 100, status: 'Active', certs: [{ name: 'iso.pdf', type: 'pdf', dataUrl: 'x' }] },
    { company: 'Acme Films', contact: 'Ravi', phone: '9', gstn: 'GST1', itemCode: 'BFX002', specificMaterial: 'PET Film', materialType: 'FILM', subGroup: 'PET', uom: 'KG', basicPrice: 120, status: 'Active' },
    { company: 'Bafna Stores', contact: 'Meena', phone: '8', gstn: 'GST2', itemCode: 'BFX009', specificMaterial: 'Nitto Tape 2"', materialType: 'TAPE', subGroup: 'POUCHING', uom: "NO'S", basicPrice: 50, status: 'Active' },
  ];
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.includes('/api/auth/me')) return res(200, { username: 'padmin', role: 'padmin' });
    if (u.includes('/api/master/departments')) return res(200, []);
    if (u.includes('/rest/v1/oab_data')) {
      if (method === 'GET') return res(200, [{ id: 6, data: JSON.stringify({ asl, pos: [], priceHistory: [], counter: 0, itemsExtra: [] }), version: 1 }]);
      saved.push(body);
      return res(201, { id: body.id, version: 2 });
    }
    return res(200, {});
  };
});

function mount() {
  return render(<MemoryRouter><AuthProvider><DataProvider><PDashboard /></DataProvider></AuthProvider></MemoryRouter>);
}
const openASL = async () => fireEvent.click(await screen.findByText('🏭 Approved Suppliers'));
const saveASL = () => fireEvent.click(screen.getByRole('button', { name: /Save ASL/ }));
const lastSavedAsl = () => JSON.parse(saved[saved.length - 1].data).asl;

describe('ASL — deleting items keeps suppliers', () => {
  it('deleting the LAST item of a supplier keeps the supplier as an item-less row', async () => {
    mount();
    await openASL();
    await screen.findByText('Bafna Stores');
    // Bafna has a single item — delete it (3rd delete button overall).
    fireEvent.click(screen.getAllByTitle('Delete item')[2]);
    expect(screen.getByText('Bafna Stores')).toBeInTheDocument();   // group still rendered
    saveASL();
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const rows = lastSavedAsl();
    const bafna = rows.filter((r) => r.company === 'Bafna Stores');
    expect(bafna).toHaveLength(1);
    expect(bafna[0]).toMatchObject({ itemCode: '', specificMaterial: '', gstn: 'GST2', contact: 'Meena' });   // supplier kept, item gone
  });

  it('deleting a NON-last item removes only that row and re-homes certifications', async () => {
    mount();
    await openASL();
    await screen.findByText('Acme Films');
    // Delete Acme's first row (BFX001) — the one carrying the certs.
    fireEvent.click(screen.getAllByTitle('Delete item')[0]);
    saveASL();
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const rows = lastSavedAsl();
    const acme = rows.filter((r) => r.company === 'Acme Films');
    expect(acme).toHaveLength(1);
    expect(acme[0].itemCode).toBe('BFX002');                          // surviving item
    expect(acme[0].certs).toEqual([{ name: 'iso.pdf', type: 'pdf', dataUrl: 'x' }]);   // certs moved, not lost
  });

  it('Clear All Items wipes every item but keeps one row per supplier with details + certs', async () => {
    mount();
    await openASL();
    await screen.findByText('Acme Films');
    fireEvent.click(screen.getByRole('button', { name: /Clear All Items/ }));
    saveASL();
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const rows = lastSavedAsl();
    expect(rows).toHaveLength(2);                                     // one row per supplier
    const acme = rows.find((r) => r.company === 'Acme Films');
    const bafna = rows.find((r) => r.company === 'Bafna Stores');
    expect(acme).toMatchObject({ itemCode: '', specificMaterial: '', basicPrice: '', gstn: 'GST1', contact: 'Ravi' });
    expect(acme.certs).toEqual([{ name: 'iso.pdf', type: 'pdf', dataUrl: 'x' }]);
    expect(bafna).toMatchObject({ itemCode: '', gstn: 'GST2', contact: 'Meena' });
  });

  it('header 🗑 Delete removes the whole supplier (all rows) after confirm', async () => {
    mount();
    await openASL();
    await screen.findByText('Acme Films');
    fireEvent.click(screen.getByTitle('Delete supplier Acme Films'));
    expect(screen.queryByText('Acme Films')).toBeNull();              // group gone from the UI
    saveASL();
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const rows = lastSavedAsl();
    expect(rows.every((r) => r.company !== 'Acme Films')).toBe(true); // both Acme rows removed
    expect(rows.some((r) => r.company === 'Bafna Stores')).toBe(true); // other supplier untouched
  });

  it('header 🗑 Delete sits between Details and the item count', async () => {
    mount();
    await openASL();
    await screen.findByText('Bafna Stores');
    const del = screen.getByTitle('Delete supplier Bafna Stores');
    const details = del.previousElementSibling;
    expect(details.textContent).toContain('Details');                 // right after ✎ Details
    expect(del.nextElementSibling.textContent).toContain('item');     // before the "N items" tag
  });

  it('a cancelled confirm changes nothing', async () => {
    window.confirm.mockReturnValue(false);
    mount();
    await openASL();
    await screen.findByText('Acme Films');
    fireEvent.click(screen.getByRole('button', { name: /Clear All Items/ }));
    fireEvent.click(screen.getAllByTitle('Delete item')[0]);
    fireEvent.click(screen.getByTitle('Delete supplier Acme Films'));
    saveASL();
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(lastSavedAsl()).toHaveLength(3);                           // untouched
  });
});
