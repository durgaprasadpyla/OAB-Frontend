import { describe, it, expect } from 'vitest';
import { invoicePortalFields, unitNoun } from '../lib/portalData.js';

describe('invoicePortalFields — customer-portal extraction', () => {
  it('single IGST line, no freight: total incl GST, uniform rate, formatted date', () => {
    const f = invoicePortalFields(
      { ivNo: 'BL/26-27/223', ivDt: '2026-07-01', freight: 0, gstType: 'IGST' },
      [{ spec: 'A1', jobName: 'Pouch A', qty: 100, rate: 75, dispatchForm: 'pouch' }],
    );
    expect(f.invoiceNumber).toBe('BL/26-27/223');
    expect(f.invoiceDate).toBe('01/07/2026');       // DD/MM/YYYY on the invoice face
    expect(f.invoiceDateIso).toBe('2026-07-01');
    expect(f.totalQty).toBe(100);
    expect(f.uom).toBe('Pcs');
    expect(f.ratePerUnit).toBe(75);
    expect(f.subTotal).toBe(7500);
    expect(f.taxableValue).toBe(7500);
    expect(f.gstAmount).toBe(1350);
    expect(f.totalAmount).toBe(8850);               // 7500 + 18%
  });

  it('CGST/SGST with freight, two lines same rate: qty sums, rate stays uniform', () => {
    const f = invoicePortalFields(
      { ivNo: 'BL/26-27/9', ivDt: '2026-04-10', freight: 500, gstType: 'CGST_SGST' },
      [
        { spec: 'A1', jobName: 'Pouch A', qty: 100, rate: 75, dispatchForm: 'pouch' },
        { spec: 'A1', jobName: 'Pouch A', qty: 50, rate: 75, dispatchForm: 'pouch' },
      ],
    );
    expect(f.totalQty).toBe(150);
    expect(f.ratePerUnit).toBe(75);
    expect(f.subTotal).toBe(11250);
    expect(f.taxableValue).toBe(11750);             // + freight 500
    expect(f.gstAmount).toBe(2115);                 // 11750 * 18%
    expect(f.totalAmount).toBe(13865);
  });

  it('lines with different rates: ratePerUnit is null, per-line rates preserved', () => {
    const f = invoicePortalFields(
      { ivNo: 'BL/26-27/10', ivDt: '2026-05-01', gstType: 'IGST' },
      [
        { spec: 'A1', jobName: 'Pouch A', qty: 100, rate: 75, dispatchForm: 'pouch' },
        { spec: 'B2', jobName: 'Pouch B', qty: 40, rate: 80, dispatchForm: 'pouch' },
      ],
    );
    expect(f.ratePerUnit).toBeNull();
    expect(f.totalQty).toBe(140);
    expect(f.lines).toHaveLength(2);
    expect(f.lines[0].rate).toBe(75);
    expect(f.lines[1].rate).toBe(80);
    expect(f.subTotal).toBe(75 * 100 + 80 * 40);    // 11700
  });

  it('roll dispatch form reports Kgs / per-Kg', () => {
    const f = invoicePortalFields(
      { ivNo: 'BL/26-27/11', ivDt: '2026-06-01', gstType: 'IGST' },
      [{ spec: 'R1', jobName: 'Roll', qty: 500, rate: 120, dispatchForm: 'roll' }],
    );
    expect(f.uom).toBe('Kgs');
    expect(unitNoun(f.uom)).toBe('Kg');
  });

  it('honours an explicit lineTotal over qty*rate', () => {
    const f = invoicePortalFields(
      { ivNo: 'X', ivDt: '2026-06-01', gstType: 'IGST' },
      [{ spec: 'A1', qty: 3, rate: 10, lineTotal: 33, dispatchForm: 'pouch' }],
    );
    expect(f.subTotal).toBe(33);
  });

  it('empty / missing input does not throw', () => {
    const f = invoicePortalFields({}, []);
    expect(f.totalQty).toBe(0);
    expect(f.totalAmount).toBe(0);
    expect(f.ratePerUnit).toBeNull();
    expect(f.invoiceNumber).toBe('');
  });
});
