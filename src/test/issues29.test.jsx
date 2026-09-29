import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { isCustomerLead, repBook } from '../lib/repFlow.js';
import { canAccess } from '../lib/roles.js';
import LeadCustomerPicker from '../components/LeadCustomerPicker.jsx';

// "Issues as on 29.09.2026" — the trimmed follow-up list.

/* ── §Sales ¶23-¶25: the conversion the Super Admin thought they had made ── */

describe('a lead is a customer only when the conversion is recorded', () => {
  // These are real: the client marked them as customers on the Super Admin
  // dashboard, and every one of them appears in the Customer Master because we have
  // taken POs from them. Only Zepto is genuinely still a lead.
  const customers = [
    { group: 'SWIGGY', customer: 'KOVAI AGRO FOODS', dispatchLoc: 'Coimbatore' },
    { group: '', customer: 'SAM AGRITECH LIMITED', dispatchLoc: 'Pune' },
    { group: '', customer: 'BARAMATI AGRO', dispatchLoc: 'Baramati' },
  ];
  const mk = (id, name, over = {}) => ({
    id, client_name: name, created_by: 'R1',
    categories: ['Juices'], category_assignments: { Juices: 'R1' }, ...over,
  });

  it('does not count a name in the Customer Master as a conversion', () => {
    // the screen used to say "✓ Customer" on the strength of this alone
    expect(isCustomerLead(mk('L1', 'KOVAI AGRO FOODS'), customers)).toBe(false);
  });

  it('counts one the Super Admin actually converted', () => {
    expect(isCustomerLead(mk('L1', 'KOVAI AGRO FOODS', { converted_to_customer: true }), customers)).toBe(true);
  });

  it('is not fooled by the stage dropdown saying Converted', () => {
    // "marked as converted" on the stage is a pipeline stage, not the conversion
    expect(isCustomerLead(mk('L1', 'KOVAI AGRO FOODS', { stage: 'Converted' }), customers)).toBe(false);
  });

  it('splits the rep book so converted ones leave the lead list', () => {
    const leads = [
      mk('L1', 'KOVAI AGRO FOODS', { converted_to_customer: true }),
      mk('L2', 'SAM AGRITECH LIMITED', { converted_to_customer: true }),
      mk('L3', 'Zepto'),
    ];
    const book = repBook({ leads }, customers, 'R1');
    expect(book.customers.map((l) => l.client_name)).toEqual(['KOVAI AGRO FOODS', 'SAM AGRITECH LIMITED']);
    expect(book.leads.map((l) => l.client_name)).toEqual(['Zepto']);
  });
});

/* ── §Sales ¶24: the radio sits on the label line ───────────────────────── */

const BOOK = { leads: [{ id: 'L1', client_name: 'Zepto' }], customers: [{ id: 'L2', client_name: 'Beta' }] };

function Host() {
  const [form, setForm] = useState({ kind: 'lead', leadId: '' });
  return (
    <LeadCustomerPicker
      book={BOOK} kind={form.kind} leadId={form.leadId}
      onKind={(k) => setForm((f) => ({ ...f, kind: k, leadId: '' }))}
      onLead={(id) => setForm((f) => ({ ...f, leadId: id }))}
      ariaPrefix="Contact"
    />
  );
}

describe('the lead / customer picker', () => {
  it('keeps the radios inside the label, so the row below lines up', () => {
    // "The lead or customer radio button selection can move to one level up so that
    //  the customer name, the contact person name, and designation … in one row."
    const { container } = render(<Host />);
    const radio = screen.getByLabelText('Contact pick Customer');
    expect(radio.closest('label')).toBeTruthy();
    // exactly one direct child of the field group before the <select>
    const fg = container.querySelector('.fg');
    const kids = [...fg.children].map((el) => el.tagName);
    expect(kids).toEqual(['LABEL', 'SELECT']);
  });

  it('still switches sides on one click', () => {
    render(<Host />);
    fireEvent.click(screen.getByLabelText('Contact pick Customer'));
    expect(screen.getByLabelText('Contact Customer')).toBeTruthy();
  });
});

/* ── §Purchase: the plant sees what is on its way ───────────────────────── */

describe('purchase orders reach the desks that need them', () => {
  it('opens the purchase-order list to the Plant Manager and the stores desk', () => {
    expect(canAccess('pm', '/pm')).toBe(true);
    expect(canAccess('stores', '/stores')).toBe(true);
  });
});
