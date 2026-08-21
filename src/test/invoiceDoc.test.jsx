import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import ProformaDoc from '../components/ProformaDoc.jsx';

// The printed TAX INVOICE is a GST document a customer and an auditor both read.
// These assertions pin it to what production (OAB-App renderInvoiceDoc) prints, so a
// well-meaning tidy-up of the layout fails here rather than in the client's hands.

const header = {
  ivNo: 'BFX/2026-27/093', ivDt: '2026-08-20', po: 'OK-21631114',
  customer: 'Green Agrevolution Pvt Ltd',
  billingAddr: '9th Floor, Unit 901\nGurugram - 122022, Haryana',
  shippingAddr: 'Survey No.155/1\nHosur - 635109, Tamil Nadu',
  billingGstin: '06AAECG6456H1ZI', shippingGstin: '33AAECG6456H1ZL',
  contactPerson: 'Abhinav Gyani', contactNo: '7282887846',
  transporter: 'Sri Sai Engineering', dcNo: 'DC 224', vehicle: 'TS 09 AB 1234', driver: 'Raju / 9876543210',
  placeOfSupply: 'Hosur', paymentTerms: '30 days', freight: 0, gstType: 'IGST',
};
const lines = [
  { spec: 'A1', jobName: 'Pouch A', qty: 10000, rate: 2.5, lineTotal: 25000, dispatchForm: 'pouch', poDate: '2026-07-01' },
];

describe('TAX INVOICE document — production contract', () => {
  it('names all four copies down the corner', () => {
    render(<InvoiceDoc header={header} lines={lines} />);
    const orig = document.querySelector('.inv-orig');
    ['Original for Buyer', 'Duplicate for Transporter', 'Triplicate for Assessee', 'Extra Copy']
      .forEach((c) => expect(orig.textContent).toContain(c));
  });

  it('prints the company mark and the statutory address block, not a plain wordmark', () => {
    render(<InvoiceDoc header={header} lines={lines} />);
    expect(screen.getByAltText('BLOOMFLEX PRIVATE LIMITED').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    const addr = document.querySelector('.inv-addr-line').textContent;
    expect(addr).toContain('Regd Off:');
    expect(addr).toContain('Works By:');
    expect(addr).toContain('CIN - U21098TG2014PTC095995');
    expect(addr).toContain('MSME REG NO: TS02C0003505');
  });

  it('carries the ten GST columns, the 8-digit HSN and the pouch-count row', () => {
    render(<InvoiceDoc header={header} lines={lines} />);
    const items = document.querySelector('.inv-items-tbl');
    expect(within(items).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'S.No', 'HSN Code (GST)', 'Description of Goods', 'Qty', 'UOM', 'Rate', 'Total', 'Discount', 'GST%', 'Taxable Value',
    ]);
    expect(within(items).getByText('39206939')).toBeInTheDocument();
    expect(within(items).getByText('Total No. Of Pouches')).toBeInTheDocument();
  });

  it('labels the meta block the way the GST sheet does', () => {
    render(<InvoiceDoc header={header} lines={lines} />);
    const meta = document.querySelector('.inv-meta-tbl').textContent;
    ['GSTIN Number', 'Transportation Mode', 'Tax Payable on Reverse Charge', 'PO Number',
      'Invoice Sl No', 'Date of Supply', 'Invoice Date', 'Place of Supply',
      'Vehicle Number', 'Driver Name & Mobile'].forEach((l) => expect(meta).toContain(l));
    expect(meta).toContain('Sri Sai Engineering / DC 224');   // transporter / DC combined
  });

  it('hides the vehicle row entirely when there is no vehicle or driver', () => {
    render(<InvoiceDoc header={{ ...header, vehicle: '', driver: '' }} lines={lines} />);
    expect(document.querySelector('.inv-meta-tbl').textContent).not.toContain('Vehicle Number');
  });

  it('heads the address block "Name and GST Address of The Consignee:"', () => {
    render(<InvoiceDoc header={header} lines={lines} />);
    const addr = document.querySelector('.inv-addr-tbl').textContent;
    expect(addr).toContain('Name and GST Address of The Consignee:');
    expect(addr).toContain('Ship To:');
    expect(addr).toContain('Abhinav Gyani | 7282887846');
  });

  it('shows every tax line, TCS and the round-off, in rupees written "Rs."', () => {
    render(<InvoiceDoc header={header} lines={lines} />);
    const tots = document.querySelector('.inv-tots').textContent;
    // 25,000 + 18% = 29,500 exactly, so all three GST rows appear with IGST carrying the tax.
    expect(tots).toContain('CGST 0.0%');
    expect(tots).toContain('SGST 0.0%');
    expect(tots).toContain('IGST 18.0%Rs.4,500.00');
    expect(tots).toContain('TCS 0.00%');
    expect(tots).toContain('Invoice Amount Rs.Rs.29,500');
  });

  it('splits the tax across CGST and SGST for an intra-state supply', () => {
    render(<InvoiceDoc header={{ ...header, gstType: 'CGST_SGST' }} lines={lines} />);
    const tots = document.querySelector('.inv-tots').textContent;
    expect(tots).toContain('CGST 9.0%Rs.2,250.00');
    expect(tots).toContain('SGST 9.0%Rs.2,250.00');
    expect(tots).toContain('IGST 0.0%');
  });

  it('carries the three numbered declarations, the reverse-charge line and the PO terms', () => {
    render(<InvoiceDoc header={header} lines={lines} />);
    const decl = document.querySelector('.inv-decl').textContent;
    expect(decl).toContain('1) I/We declare that this invoice shows actual price');
    expect(decl).toContain('2) There might be a variation of 10% in quantity mentioned in the PO');
    expect(decl).toContain('3) Subject to the jurisdiction of courts in Hyderabad');

    expect(screen.getByText(/Amount of Tax Subject to Reverse Charge:/)).toBeInTheDocument();
    const sign = document.querySelector('.inv-sign-l').textContent;
    expect(sign).toContain('Terms and Conditions of Sale');
    expect(sign).toContain('PO NUMBER:');
    expect(sign).toContain('01/07/2026');           // the PO date travels on the line
    expect(sign).toContain('Payment Terms:');
  });

  it('writes the invoice value in words', () => {
    render(<InvoiceDoc header={header} lines={lines} />);
    expect(document.querySelector('.inv-words-row').textContent)
      .toContain('Twenty Nine Thousand Five Hundred Rupees Only');
  });
});

describe('PROFORMA INVOICE document — production contract', () => {
  const f = {
    no: 'PF/2026/101', date: '2026-08-20', pt: '30 days', gstType: 'IGST',
    customer: 'Green Agrevolution Pvt Ltd', subBrand: '', loc: 'Hosur',
    billingAddr: 'Gurugram', shippingAddr: '', billingGstin: '06AAECG6456H1ZI',
    freight: 0, notes: 'Rates hold for 15 days',
  };
  const rows = [{ spec: 'A1', jobName: 'Pouch A', qty: 1000, rate: 3, amount: 3000, dispatchForm: 'pouch' }];

  it('marks itself as not a tax invoice and totals as a Proforma Amount', () => {
    render(<ProformaDoc f={f} rows={rows} />);
    expect(document.querySelector('.inv-orig').textContent).toContain('Not a Tax Invoice');
    expect(screen.getByText('PROFORMA INVOICE')).toBeInTheDocument();
    expect(document.querySelector('.inv-tots').textContent).toContain('Proforma Amount Rs.');
    // No TCS row on a proforma — that belongs to the tax invoice only.
    expect(document.querySelector('.inv-tots').textContent).not.toContain('TCS');
  });

  it('carries its own four declarations and the special-notes box', () => {
    render(<ProformaDoc f={f} rows={rows} />);
    const decl = document.querySelector('.inv-decl').textContent;
    expect(decl).toContain('does not constitute a Tax Invoice');
    expect(decl).toContain('4) Subject to the jurisdiction of courts in Hyderabad');
    expect(screen.getByText(/Special Notes:/)).toBeInTheDocument();
    expect(screen.getByText(/Rates hold for 15 days/)).toBeInTheDocument();
  });
});
