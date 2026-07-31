import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp, oabModule } from './harness.jsx';
import Login from '../pages/Login.jsx';
import NewPO from '../pages/NewPO.jsx';
import OabBoard from '../pages/OabBoard.jsx';
import DailyUpdate from '../pages/DailyUpdate.jsx';
import Invoice from '../pages/Invoice.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import PDashboard from '../pages/PDashboard.jsx';
import Plant from '../pages/Plant.jsx';
import QC from '../pages/QC.jsx';
import PM from '../pages/PM.jsx';
import Scrap from '../pages/Scrap.jsx';
import Purchase from '../pages/Purchase.jsx';

// One realistic dataset covering all 8 modules.
const seed = {
  jss: [{ spec: 'A1', customer: 'Acme', subBrand: 'Fresh', jobName: 'Pouch A', jobType: 'StayFresh', dispatchForm: 'pouch', width: 100, height: 200, gsm: 50, filmWidth: 300, mic: '40', material: 'BOPP', pouchWeight: 1.2, status: 'Active' }],
  prices: { A1: { price: 75, costPrice: 60, transport: 'At Actuals' } },
  customers: [{ customer: 'Acme', dispatchLoc: 'Hyderabad', warehouseName: 'WH1', billingAddr: 'Plot 1', gstin: '36ABCDE1234F1Z5', contactPerson: 'Ravi', contactPhone: '9999900000' }],
  oab: oabModule({
    SF: [{ so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch A', jobType: 'StayFresh', dispLoc: 'Hyderabad', poNum: 'PO1', poDate: '2026-07-01', poQty: 1000, invDisp: 100, manDisp: 50, fg: 20, dispatchForm: 'pouch', width: 100, height: 200, gsm: 50, filmWidth: 300, stage: '', manDispLog: [{ date: '2026-07-10', invNo: 'D1', qty: 50 }] }],
    INV_REG: [{ no: 'BL/26/1', date: '2026-07-15', customer: 'Acme', po: 'PO1', qty: 100, amount: 7500, margin: 1500, items: [{ spec: 'A1', jobName: 'Pouch A', rate: 75, qty: 100 }] }],
  }),
  prodStatus: { '26/1': 'Ready' },
  pmData: { '26/1': { printDate: '2026-07-05', printedKg: 10, printedMt: 100 } },
  scrap: { buyers: [{ id: 'SB001', name: 'Buyer1', phone: '900' }], items: ['Trim Waste'], prices: [{ date: '2026-07-01', buyer: 'SB001', item: 'Trim Waste', rate: 20 }], txns: [{ date: '2026-07-02', buyer: 'SB001', item: 'Trim Waste', qty: 5, rate: 20, amount: 100, mode: 'Cash' }] },
  purchase: { asl: [{ company: 'Sup1', materialType: 'BOPP', subGroup: 'Film', specificMaterial: 'BOPP Film', itemCode: 'ITM-001', uom: 'Kg', basicPrice: 100, paymentTerms: '30 days', leadTime: '7', moq: '500', status: 'Active' }], pos: [{ poNum: 'BLM/PUR/2026-2027/1', poDate: '2026-07-01', supplier: 'Sup1', items: [{ item: 'BOPP Film', unit: 'Kg', qty: 100, rate: 100, amount: 10000, receivedQty: 0 }], totalAmount: 11800, gstPercent: 18, status: 'Open', paymentStatus: 'Unpaid', expectedDelivery: '2026-07-20', actualReceiptDate: '', receipts: [] }], priceHistory: [{ supplier: 'Sup1', item: 'BOPP Film', rate: 100, date: '2026-07-01', poNum: 'BLM/PUR/2026-2027/1' }], counter: 1, itemsExtra: [] },
};

async function seen(matcher) {
  const els = await screen.findAllByText(matcher);
  expect(els.length).toBeGreaterThan(0);
}

describe('screen smoke — every page renders with seeded data, no crash', () => {
  it('Login', async () => { renderApp(<Login />, {}); await seen(/Sign in to continue/i); });
  it('New PO', async () => { renderApp(<NewPO />, { modules: seed }); await seen(/New PO/); });
  it('OAB board', async () => { renderApp(<OabBoard />, { modules: seed, route: '/oab?sheet=SF' }); await seen(/Production Balance/); await seen('26/1'); });
  it('Daily Update', async () => { renderApp(<DailyUpdate />, { modules: seed }); await seen('Daily Update'); await seen('26/1'); });
  it('Invoice', async () => { renderApp(<Invoice />, { modules: seed }); await seen(/Select PO/); });
  it('Dashboard (superadmin)', async () => { renderApp(<Dashboard />, { modules: seed, role: 'superadmin' }); await seen(/Sale Margin/); });
  it('P Dashboard (padmin)', async () => { renderApp(<PDashboard />, { modules: seed, role: 'padmin' }); await seen(/PO Tracking/); });
  it('Plant', async () => { renderApp(<Plant />, { modules: seed, role: 'plant' }); await seen(/Production Floor/); await seen('26/1'); });
  it('QC', async () => { renderApp(<QC />, { modules: seed, role: 'qc' }); await seen(/JSS Spec Entry/); });
  it('PM', async () => { renderApp(<PM />, { modules: seed, role: 'pm' }); await seen(/Printing Progress/); await seen('26/1'); });
  it('Scrap', async () => { renderApp(<Scrap />, { modules: seed, role: 'scrap' }); await seen(/Buyer1/); });
  it('Purchase', async () => { renderApp(<Purchase />, { modules: seed, role: 'purchase' }); await seen(/Generate PO|Sup1/); });
});
