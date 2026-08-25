import { describe, it, expect } from 'vitest';
import { balance, invBalance, dispatched, calcMetres, pouchWeightQC, pouchWeightJSS, gstBreakup, purchComputeStatus, parsePaymentDays } from '../lib/calc.js';
import { getPM, getUOM, getDynamicCost, getCostPrice } from '../lib/pricing.js';
import { amountInWords, dash, inr, financialYear } from '../lib/format.js';
import { nextSO, isSOFormat, nextInvNo } from '../lib/seq.js';
import { computeKPIs, dashRange } from '../lib/dashboard.js';

describe('calc', () => {
  const r = { poQty: 1000, invDisp: 200, manDisp: 100, fg: 50, dispatchForm: 'pouch', width: 100, height: 200, filmWidth: 300, gsm: 50 };
  it('balance includes FG; invBalance excludes it', () => {
    expect(balance(r)).toBe(650);
    expect(invBalance(r)).toBe(700);
    expect(dispatched(r)).toBe(300);
  });
  it('calcMetres pouch = qty*width/1000 with +5%', () => {
    expect(calcMetres(r, 1000).net).toBe(100);
    expect(calcMetres(r, 1000).withWastage).toBe(105);
  });
  it('calcMetres roll = qty/(fw*gsm) in m/kg terms', () => {
    const roll = { dispatchForm: 'roll', filmWidth: 1000, gsm: 100 };
    // 1000 / ((1000/1000)*(100/1000)) = 1000 / 0.1 = 10000
    expect(calcMetres(roll, 1000).net).toBe(10000);
  });
  it('calcMetres prefers JSS values over the row', () => {
    const jss = { dispatchForm: 'bulk bag', height: 500 };
    // bulk bag => qty*height/1000 = 1000*500/1000 = 500
    expect(calcMetres(r, 1000, jss).net).toBe(500);
  });
  it('pouch weight (QC no sealing, JSS with sealing)', () => {
    expect(pouchWeightQC({ height: 100, gusset: '20+20', width: 100, gsm: 50 })).toBeCloseTo(1.2, 6);
    expect(pouchWeightJSS({ height: 100, gusset: '20+20', sealing: 10, width: 100, gsm: 50 })).toBeCloseTo(1.25, 6);
  });
  it('GST breakup: CGST/SGST split and IGST', () => {
    const g = gstBreakup(1000, 0, 18, 'CGST_SGST');
    expect(g.taxable).toBe(1000); expect(g.gstAmt).toBe(180); expect(g.invAmount).toBe(1180);
    expect(g.cgst).toBe(90); expect(g.sgst).toBe(90); expect(g.igst).toBe(0);
    expect(gstBreakup(1000, 0, 18, 'IGST').igst).toBe(180);
  });
  it('GST round-off works', () => {
    const g = gstBreakup(1005, 0, 18); // taxable 1005, gst 180.9 => 1185.9 => 1186
    expect(g.invAmount).toBe(1186);
    expect(g.roundOff).toBeCloseTo(0.1, 2);
  });
  it('purchase status + payment days', () => {
    expect(purchComputeStatus([{ qty: 10, receivedQty: 10 }])).toBe('Closed');
    expect(purchComputeStatus([{ qty: 10, receivedQty: 4 }])).toBe('Partial');
    expect(purchComputeStatus([{ qty: 10, receivedQty: 0 }])).toBe('Open');
    expect(parsePaymentDays('30 days')).toBe(30);
    expect(parsePaymentDays('Advance')).toBe(0);
    expect(parsePaymentDays('')).toBe(30);
  });
});

describe('pricing', () => {
  const prices = { A1: { price: 75, costPrice: 60, transport: 'At Actuals' } };
  it('getPM + default', () => {
    expect(getPM('A1', prices).price).toBe(75);
    expect(getPM('ZZ', prices)).toEqual({ price: 0, costPrice: 0, transport: 'At Actuals' });
  });
  it('getUOM', () => { expect(getUOM('roll')).toBe('Kgs'); expect(getUOM('pouch')).toBe('Pcs'); });
  it('getDynamicCost from RM rate; multi-layer returns null', () => {
    const jss = [{ spec: 'A1', material: 'BOPP', pouchWeight: 10 }, { spec: 'A2', material: 'PET+POLY', pouchWeight: 12 }];
    expect(getDynamicCost('A1', { jss, matRates: { bopp: 100 } })).toBeCloseTo(1.0, 6); // 10g=0.01kg * 100
    expect(getDynamicCost('A2', { jss, matRates: { bopp: 100 } })).toBeNull();
  });
  it('getCostPrice falls back to Price Master when no RM rate', () => {
    expect(getCostPrice('A1', { prices, jss: [], matRates: {} })).toBe(60);
  });
});

describe('format + seq', () => {
  it('amountInWords (Indian)', () => {
    expect(amountInWords(1180)).toBe('One Thousand One Hundred Eighty Rupees Only');
    expect(amountInWords(0)).toBe('Zero Rupees Only');
    expect(amountInWords(100)).toBe('One Hundred Rupees Only');
  });
  it('dash shows a hyphen for zero', () => { expect(dash(0)).toBe('-'); expect(dash(1234)).toBe('1,234'); });
  it('inr grouping', () => { expect(inr(1234567)).toBe('12,34,567'); });
  it('nextSO increments; isSOFormat', () => {
    expect(nextSO({ y: '26', n: 400 })).toEqual({ so: '26/401', next: { y: '26', n: 401 } });
    expect(isSOFormat('26/401')).toBe(true); expect(isSOFormat('x')).toBe(false);
  });
  it('nextInvNo (BL/<yy>-<yy> format, matches the backend SequenceService)', () => {
    expect(nextInvNo(430, '2026-07-01').no).toBe('BL/26-27/431');    // continues past a higher last number
    expect(nextInvNo(92, '2026-08-19').no).toBe('BL/26-27/424');     // floored to the FY 26-27 series start (424)
    expect(nextInvNo(0, '2026-02-01').no).toBe('BL/25-26/1');        // Jan–Mar belong to the previous FY
  });
  it('financialYear (Apr start)', () => { expect(financialYear('2026-07-01')).toBe('2026-2027'); expect(financialYear('2026-02-01')).toBe('2025-2026'); });
});

describe('dashboard KPIs', () => {
  it('computes sales, margin, open value and SO margin', () => {
    const oab = {
      OAB: { SF: [{ so: '26/1', spec: 'A1', customer: 'C', poQty: 1000, invDisp: 200, manDisp: 0, fg: 0, poDate: '2026-07-01' }], OT: [] },
      INV_REG: [{ no: 'BL/26/1', date: '2026-07-15', customer: 'C', po: 'PO1', qty: 200, amount: 15000, items: [{ spec: 'A1', rate: 75, qty: 200 }] }],
    };
    const ctx = { prices: { A1: { price: 75, costPrice: 60 } }, jss: [], matRates: {} };
    const k = computeKPIs(oab, { from: '2026-07-01', to: '2026-07-31', client: '' }, ctx);
    expect(k.salesTotal).toBe(15000);
    expect(k.salesQty).toBe(200);
    expect(k.totalMargin).toBe(3000);       // (75-60)*200
    expect(k.openValue).toBe(60000);         // balance 800 * price 75
    expect(k.soMarginTotal).toBe(15000);     // (75-60)*1000
    expect(k.soMarginPct).toBeCloseTo(20, 1);
  });
  it('dashRange month has from<=to', () => {
    const { from, to } = dashRange('month');
    expect(from <= to).toBe(true);
  });
});
