// 27.11 — "in the auto-generated invoice whenever there is a roll form despatch, the unit
// of measurement should be Kgs whereas now it is coming as metres."
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { getUOM, invoiceUOM } from '../lib/pricing.js';

describe('the unit printed on the invoice', () => {
  it('a roll prints Kgs; orders keep metres', () => {
    expect(invoiceUOM('Roll')).toBe('Kgs');
    expect(invoiceUOM('rolls')).toBe('Kgs');
    expect(getUOM('Roll')).toBe('Mtrs');          // the SO / balance / planning unit is unchanged
    expect(invoiceUOM('Pouch')).toBe('Pcs');
  });

  it('the Super Admin mapping wins, per dispatch form', () => {
    const sales = { invoice_uom: { roll: 'Mtrs', 'shrink sleeve': 'Nos' } };
    expect(invoiceUOM('Roll', sales)).toBe('Mtrs');
    expect(invoiceUOM('Shrink Sleeve', sales)).toBe('Nos');
    expect(invoiceUOM('Pouch', sales)).toBe('Pcs');
  });

  it('the tax invoice line for a roll reads Kgs', () => {
    render(<InvoiceDoc header={{ ivNo: 'BL/26-27/900', ivDt: '2026-11-27', gstType: 'IGST' }}
      lines={[{ spec: 'R1', jobName: 'Laminated roll', qty: 250, rate: 210, lineTotal: 52500, dispatchForm: 'Roll' }]} />);
    const row = screen.getByText('Laminated roll').closest('tr');
    expect(row.textContent).toContain('Kgs');
    expect(row.textContent).not.toContain('Mtrs');
  });
});
