import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { canAccess } from '../lib/roles.js';
import { isCustomerLead, repBook } from '../lib/repFlow.js';
import { bomMaterialForSO, bomMaterialForSOList, plannedBomMap } from '../lib/bom.js';
import LeadCustomerPicker from '../components/LeadCustomerPicker.jsx';

// "Issues as on 28.09.2026" — the consolidated list. These cover the items that
// were still open after the 24.09 batch went live.

/* ── §PM: the PM and PPC logins are one workspace ───────────────────────── */

describe('PM login carries the PPC dashboard and the daily board', () => {
  it('lets the Plant Manager open the PPC dashboard', () => {
    // "Include the PPC login dashboard in the PM login and also include the daily
    //  board in the PM login."
    expect(canAccess('pm', '/ppc')).toBe(true);
    expect(canAccess('pm', '/board')).toBe(true);
    expect(canAccess('pm', '/planner')).toBe(true);
  });

  it('does not open the PPC dashboard to a role that never had it', () => {
    expect(canAccess('stores', '/ppc')).toBe(false);
    expect(canAccess('qc', '/ppc')).toBe(false);
  });
});

/* ── §Sales ¶19: the Lead / Customer radio would not move ───────────────── */

const BOOK = {
  leads: [{ id: 'L1', client_name: 'Zepto' }],
  customers: [{ id: 'L2', client_name: 'Beta Foods' }],
};

/**
 * A host that rebuilds its next state by SPREADING A CAPTURED form object — the
 * shape MyContacts had. With the picker firing two updates in one event, the
 * second was computed from the same stale object and undid the first.
 */
function StaleHost() {
  const [form, setForm] = useState({ kind: 'lead', leadId: '' });
  return (
    <>
      <LeadCustomerPicker
        book={BOOK} kind={form.kind} leadId={form.leadId}
        onKind={(k) => setForm({ ...form, kind: k, leadId: '' })}
        onLead={(id) => setForm({ ...form, leadId: id })}
        ariaPrefix="Contact"
      />
      <div data-testid="kind">{form.kind}</div>
    </>
  );
}

describe('the Lead / Customer radio', () => {
  it('moves to Customer on the first click', () => {
    render(<StaleHost />);
    expect(screen.getByTestId('kind').textContent).toBe('lead');
    fireEvent.click(screen.getByLabelText('Contact pick Customer'));
    expect(screen.getByTestId('kind').textContent).toBe('customer');
  });

  it('moves back to Lead again', () => {
    render(<StaleHost />);
    fireEvent.click(screen.getByLabelText('Contact pick Customer'));
    fireEvent.click(screen.getByLabelText('Contact pick Lead'));
    expect(screen.getByTestId('kind').textContent).toBe('lead');
  });

  it('offers the list that belongs to the side chosen', () => {
    render(<StaleHost />);
    expect(screen.getByLabelText('Contact Lead')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Contact pick Customer'));
    expect(screen.getByLabelText('Contact Customer')).toBeTruthy();
  });
});

/* ── §Sales ¶20: a lead is a customer only once the Super Admin says so ─── */

describe('a lead becomes a customer only by conversion', () => {
  const customers = [{ group: '', customer: 'Zepto', dispatchLoc: 'Hyderabad' }];

  it('keeps a newly added lead on the lead side even if the name is already a customer', () => {
    // "I have added a new lead, Zepto … Zepto, which is added as a Lead, is now
    //  shown under Customer."
    expect(isCustomerLead({ id: 'L1', client_name: 'Zepto' }, customers)).toBe(false);
  });

  it('honours the Super Admin conversion', () => {
    expect(isCustomerLead({ client_name: 'Zepto', converted_to_customer: true }, customers)).toBe(true);
  });

  it('lets the Super Admin un-convert one', () => {
    // the name still matches the master — which is exactly why this used to be stuck
    expect(isCustomerLead({ client_name: 'Zepto', converted_to_customer: false }, customers)).toBe(false);
  });

  it('splits the rep book on that rule alone', () => {
    const leads = [
      { id: 'L1', client_name: 'Zepto', created_by: 'R1', categories: ['Dairy'], category_assignments: { Dairy: 'R1' } },
      { id: 'L2', client_name: 'Beta Foods', created_by: 'R1', converted_to_customer: true, categories: ['Oil'], category_assignments: { Oil: 'R1' } },
    ];
    const book = repBook({ leads }, customers, 'R1');
    expect(book.leads.map((l) => l.id)).toEqual(['L1']);
    expect(book.customers.map((l) => l.id)).toEqual(['L2']);
  });
});

/* ── §Super Admin: a BOM line has to say what the material IS ───────────── */

describe('a raw-material line carries its material, sub-group and specialty', () => {
  const planned = plannedBomMap([{
    specCode: 'A1318', baseQty: 1000, baseUom: 'Nos',
    items: [
      { itemCode: 'BLM033', itemName: '600 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'ANTIFOG', microns: '35', uom: 'Kg', qtyPerBase: 2, departmentName: 'Printing' },
      { itemCode: 'BLM146', itemName: 'NC 806-MAGENTA', materialType: 'INK', subGroup: 'FLEXO', specialtyName: '', microns: '', uom: 'Kg', qtyPerBase: 0.5, departmentName: 'Printing' },
    ],
  }]);

  it('carries the specialty from the item master onto the scaled requirement', () => {
    // "only the description is not making sense so I would need the material type
    //  and subgroup and speciality also listed here."
    const rows = bomMaterialForSO(planned, 'A1318', 2000);
    const film = rows.find((r) => r.itemCode === 'BLM033');
    expect(film.itemDescription).toBe('600 MM');
    expect(film.materialType).toBe('FILM');
    expect(film.subGroup).toBe('AF BOPP');
    expect(film.specialty).toBe('ANTIFOG');
    expect(film.required).toBe(4);
  });

  it('keeps them through the cross-order rollup', () => {
    const agg = bomMaterialForSOList(planned, [{ so: '26/794', spec: 'A1318', bal: 2000, customer: 'AMAZON' }]);
    const film = agg.find((r) => r.itemCode === 'BLM033');
    expect(film.subGroup).toBe('AF BOPP');
    expect(film.specialty).toBe('ANTIFOG');
  });

  it('leaves a line with no specialty blank rather than inventing one', () => {
    const ink = bomMaterialForSO(planned, 'A1318', 1000).find((r) => r.itemCode === 'BLM146');
    expect(ink.specialty).toBe('');
    expect(ink.materialType).toBe('INK');
  });
});
