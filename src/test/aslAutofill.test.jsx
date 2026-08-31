import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider } from '../data.jsx';
import PDashboard from '../pages/PDashboard.jsx';

// ASL item-code type-to-search: typing a known Item Code on an Approved Supplier
// row offers it in a dropdown (datalist) and, on a match, auto-fills the row's
// identity fields (material type, sub-group, microns, description, UOM) — while
// the supplier-specific commercials (price, MOQ, lead time) stay untouched.

function res(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}

const ASL = [
  { company: 'Ami Pyroflex Pvt.ltd', contact: 'RUPAL', phone: '98227', itemCode: 'BLM001', materialType: 'BOPP', subGroup: 'Films', microns: '20', specificMaterial: 'BOPP Plain Film', uom: 'KG', basicPrice: '120', moq: '500', leadTime: '7 days', status: 'Active' },
  { company: 'Astra Chem Tech Pvt Ltd', contact: 'SHYAM', phone: '93462', itemCode: '', materialType: '', subGroup: '', microns: '', specificMaterial: '', uom: '', basicPrice: '', moq: '', leadTime: '', status: 'Active' },
];
const EXTRA = [{ itemCode: 'CAT-9', specificMaterial: 'Catalogue-only adhesive', materialType: 'Adhesive', subGroup: 'Chem', microns: '', uom: 'KG' }];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_role', 'padmin');
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/auth/me')) return res(200, { username: 'padmin', role: 'padmin' });
    if (u.includes('/api/master/departments')) return res(200, []);
    if (u.includes('/rest/v1/oab_data') && method === 'GET') {
      return res(200, [{ id: 6, data: JSON.stringify({ asl: ASL, pos: [], priceHistory: [], counter: 0, itemsExtra: EXTRA }), version: 1 }]);
    }
    return res(200, {});
  };
});

async function openAsl() {
  render(
    <MemoryRouter>
      <AuthProvider><DataProvider><PDashboard /></DataProvider></AuthProvider>
    </MemoryRouter>,
  );
  await userEvent.click(await screen.findByText(/Approved Suppliers/));
  await waitFor(() => expect(screen.getByText('Ami Pyroflex Pvt.ltd')).toBeInTheDocument());
}

describe('ASL — item code type-to-search + auto-fill', () => {
  it('offers known codes (ASL + catalogue) in the dropdown list', async () => {
    await openAsl();
    const list = document.getElementById('asl-item-codes');
    expect(list).toBeTruthy();
    const values = [...list.querySelectorAll('option')].map((o) => o.value);
    expect(values).toContain('BLM001');   // from another supplier's row
    expect(values).toContain('CAT-9');    // catalogue-only item
  });

  it('typing an existing code fills the row identity, keeps commercials empty', async () => {
    await openAsl();
    // The empty row under Astra Chem is row 2.
    const codeInput = screen.getByLabelText('Item code row 2');
    // lowercase on purpose — matching is case-insensitive, code normalises to BLM001
    await userEvent.type(codeInput, 'blm001');
    await waitFor(() => expect(screen.getByLabelText('Item code row 2')).toHaveValue('BLM001'));
    const tr = screen.getByLabelText('Item code row 2').closest('tr');
    const inputs = [...tr.querySelectorAll('input')];
    // [code, materialType, subGroup, microns, description, uom, basicPrice, moq, leadTime]
    expect(inputs[1]).toHaveValue('BOPP');
    expect(inputs[2]).toHaveValue('Films');
    expect(inputs[3]).toHaveValue('20');
    expect(inputs[4]).toHaveValue('BOPP Plain Film');
    expect(inputs[5]).toHaveValue('KG');
    // supplier-specific commercials are NOT copied from the other supplier
    expect(inputs[6]).toHaveValue(null);
    expect(inputs[7]).toHaveValue('');
    expect(inputs[8]).toHaveValue('');
  });

  it('an unknown code just types through without touching other fields', async () => {
    await openAsl();
    const codeInput = screen.getByLabelText('Item code row 2');
    await userEvent.type(codeInput, 'NEW-42');
    expect(codeInput).toHaveValue('NEW-42');
    const tr = codeInput.closest('tr');
    expect([...tr.querySelectorAll('input')][4]).toHaveValue('');   // description untouched
  });
});

describe('ASL — Add Item puts the blank row on TOP of the supplier group', () => {
  it('the new empty Item Code input appears before the existing item rows', async () => {
    await openAsl();
    // Ami Pyroflex (first group) has one filled row (BLM001). Add a new item to it.
    const addBtn = screen.getAllByRole('button', { name: /Add Item/ })[0];
    await userEvent.click(addBtn);
    // First item-code input of the group is now the blank one; BLM001 sits below.
    const codes = [...document.querySelectorAll('input[list="asl-item-codes"]')].map((i) => i.value);
    expect(codes[0]).toBe('');
    expect(codes).toContain('BLM001');
    expect(codes.indexOf('BLM001')).toBeGreaterThan(0);
  });
});
