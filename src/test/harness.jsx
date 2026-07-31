import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth.jsx';
import { DataProvider, KEY_TO_ID } from '../data.jsx';

const ID_TO_KEY = Object.fromEntries(Object.entries(KEY_TO_ID).map(([k, v]) => [v, k]));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function res(status, body, json = true) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? (json ? 'application/json' : 'text/plain') : null) },
    json: async () => body,
    text: async () => (json ? JSON.stringify(body) : String(body ?? '')),
  };
}

function findRow(oab, so) {
  for (const k of ['SF', 'OT']) {
    const hit = ((oab.OAB && oab.OAB[k]) || []).find((r) => r.so === so);
    if (hit) return hit;
  }
  return null;
}

/**
 * Installs a fetch mock that serves the 8 module blobs from `modules` and records
 * every write into `saved`. It models the backend's optimistic-lock `version`
 * (GET/POST on /rest), the `/api/seq/{type}` allocator, and the Phase-1 granular
 * module-1 endpoints (sales-orders, invoices, oab-rows dispatch/close/reopen/stage).
 * Granular writes mutate `modules.oab` in place (so a follow-up reload reflects
 * them) and push { id:1, key:'oab', data:<blob snapshot>, endpoint, body } into
 * `saved`, so existing blob assertions keep working and tests can also assert the
 * page hit the new endpoint.
 *
 * Options: conflictOnce { [moduleId]: true } — the next /rest POST to that module
 * returns 409 once (simulating a concurrent writer).
 */
export function installFetch(modules, { conflictOnce = {} } = {}) {
  const saved = [];
  const versions = {};
  Object.entries(KEY_TO_ID).forEach(([key, id]) => { versions[id] = modules[key] != null ? 1 : 0; });
  const pendingConflict = { ...conflictOnce };

  const record = (id, endpoint, body) => {
    versions[id] = (versions[id] || 0) + 1;
    saved.push({ id, key: ID_TO_KEY[id], data: JSON.parse(JSON.stringify(modules[ID_TO_KEY[id]])), endpoint, body });
  };
  const recordOab = (endpoint, body) => record(1, endpoint, body);
  const findPo = (pur, poNum) => (pur.pos || []).find((p) => p.poNum === poNum);

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};

    if (u.includes('/api/auth/login')) return res(200, { token: 't', username: 'superstar', role: 'user' });

    if (u.includes('/api/seq/')) {
      const type = u.split('/api/seq/')[1].split(/[?#]/)[0].toUpperCase();
      const sample = { SO: '26/401', INV: 'BL/26-27/223', PO: 'BLM/PUR/2026-2027/1' };
      return res(200, { type, number: sample[type] || 'SEQ-1' });
    }

    // ── Phase-1 granular module-1 endpoints ──
    if (u.includes('/api/sales-orders') && method === 'POST') {
      const oab = modules.oab || (modules.oab = { OAB: { SF: [], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 0 }, lastInvNo: 0 });
      if (!oab.OAB) oab.OAB = { SF: [], OT: [] };
      if (!oab.lastSO) oab.lastSO = { y: '26', n: 0 };
      let mx = num(oab.lastSO.n);
      ['SF', 'OT'].forEach((k) => (oab.OAB[k] || []).forEach((r) => {
        const m = /^(\d{2})\/(\d+)$/.exec(String(r.so || '')); if (m) mx = Math.max(mx, parseInt(m[2], 10));
      }));
      const y = oab.lastSO.y || '26';
      const created = [];
      (body.items || []).forEach((it) => {
        mx += 1;
        const so = `${y}/${mx}`;
        const sheet = it.jobType === 'StayFresh' ? 'SF' : 'OT';
        if (!oab.OAB[sheet]) oab.OAB[sheet] = [];
        const mxSno = oab.OAB[sheet].reduce((m, r) => Math.max(m, parseInt(r.sno, 10) || 0), 0);
        oab.OAB[sheet].push({
          ...it, so, sno: mxSno + 1, customer: body.customer, dispLoc: body.dispLoc,
          poNum: body.poNum, poDate: body.poDate, poExp: body.poExp,
          invDisp: 0, manDisp: 0, fg: 0, stage: '', closed: false,
        });
        oab.lastSO.n = mx;
        created.push(so);
      });
      recordOab('/api/sales-orders', body);
      return res(201, { created });
    }

    if (u.includes('/api/invoices') && method === 'POST') {
      const oab = modules.oab;
      const prices = modules.prices || {};
      const no = `BL/26-27/${num(oab.lastInvNo) + 1}`;
      let amount = 0, margin = 0, totalQty = 0;
      const items = [];
      (body.lines || []).forEach((ln) => {
        const qty = num(ln.qty), rate = num(ln.rate);
        amount += qty * rate; totalQty += qty;
        const cost = (prices[ln.spec] && num(prices[ln.spec].costPrice)) || 0;
        margin += (rate - cost) * qty;
        const row = findRow(oab, ln.so);
        if (row) { row.invDisp = num(row.invDisp) + qty; if (num(ln.fgToUse) > 0) row.fg = Math.max(0, num(row.fg) - num(ln.fgToUse)); }
        items.push({ spec: ln.spec, jobName: ln.jobName, rate, qty, dispatchForm: ln.dispatchForm });
      });
      const h = body.header || {};
      const entry = {
        no, date: h.date || h.ivDt, po: h.po, customer: h.customer, qty: totalQty, amount, margin, items,
        packingList: body.packingList || [], pos: h.placeOfSupply, billingAddr: h.billingAddr,
        shipAddr: h.shippingAddr, contact: h.contactPerson, contactNo: h.contactNo, dispLoc: h.placeOfSupply, header: { ...h },
      };
      if (!Array.isArray(oab.INV_REG)) oab.INV_REG = [];
      oab.INV_REG.unshift(entry);
      oab.lastInvNo = num(oab.lastInvNo) + 1;
      recordOab('/api/invoices', body);
      return res(201, { no, qty: totalQty, amount, margin, gst: {}, entry });
    }

    if (u.includes('/api/oab-rows/')) {
      const oab = modules.oab;
      const row = findRow(oab, body.so);
      if (u.includes('/dispatch')) {
        if (row) {
          if (num(body.addQty) > 0) {
            if (!Array.isArray(row.manDispLog)) row.manDispLog = [];
            row.manDispLog.push({ date: '2026-07-31', invNo: (body.invNo || '').trim(), qty: num(body.addQty) });
            row.manDisp = num(row.manDisp) + num(body.addQty);
          }
          if (body.fg != null) row.fg = num(body.fg);
          if (body.stage) row.stage = body.stage;
        }
        recordOab('/api/oab-rows/dispatch', body);
        return res(200, { so: body.so, manDisp: row ? num(row.manDisp) : 0 });
      }
      if (u.includes('/close')) {
        if (row) { const disp = num(row.invDisp) + num(row.manDisp); row.closed = true; row.closedDate = '2026-07-31'; row.shortClosed = disp < num(row.poQty); }
        recordOab('/api/oab-rows/close', body);
        return res(200, { so: body.so, closed: true });
      }
      if (u.includes('/reopen')) {
        if (row) { row.closed = false; row.shortClosed = false; }
        recordOab('/api/oab-rows/reopen', body);
        return res(200, { so: body.so, closed: false });
      }
      if (u.includes('/stage')) {
        if (row) row.stage = body.stage || '';
        recordOab('/api/oab-rows/stage', body);
        return res(200, { so: body.so, stage: row ? row.stage : '' });
      }
    }

    // ── Phase-2 granular purchase (module 6) endpoints ──
    if (u.includes('/api/purchase-orders')) {
      const pur = modules.purchase || (modules.purchase = { asl: [], pos: [], priceHistory: [], counter: 0, itemsExtra: [] });
      if (!Array.isArray(pur.pos)) pur.pos = Array.isArray(pur.po) ? pur.po : [];
      if (!Array.isArray(pur.priceHistory)) pur.priceHistory = [];
      const status = (po) => {
        const all = (po.items || []).every((i) => num(i.receivedQty) >= num(i.qty));
        const any = (po.items || []).some((i) => num(i.receivedQty) > 0);
        return all ? 'Closed' : any ? 'Partial' : 'Open';
      };
      if (u.includes('/grn')) {
        const po = findPo(pur, body.poNum);
        if (po) {
          (po.items || []).forEach((it, idx) => {
            const already = num(it.receivedQty); const bal = Math.max(0, num(it.qty) - already);
            let v = num(body.qty && body.qty[idx]); if (v < 0) v = 0; if (v > bal) v = bal; it.receivedQty = already + v;
          });
          po.status = status(po); po.grnRef = body.grnRef; po.actualReceiptDate = '2026-07-31';
          po.manualClosed = false; po.closedDate = po.status === 'Closed' ? '2026-07-31' : '';
          if (!Array.isArray(po.receipts)) po.receipts = [];
          po.receipts.push({ date: '2026-07-31', ref: body.grnRef });
        }
        record(6, '/api/purchase-orders/grn', body);
        return res(200, { poNum: body.poNum, status: po ? po.status : 'Open' });
      }
      if (u.includes('/close')) {
        const po = findPo(pur, body.poNum); if (po) { po.status = 'Closed'; po.manualClosed = true; po.closedDate = '2026-07-31'; }
        record(6, '/api/purchase-orders/close', body); return res(200, { poNum: body.poNum, status: 'Closed' });
      }
      if (u.includes('/reopen')) {
        const po = findPo(pur, body.poNum); if (po) { po.status = status(po); po.manualClosed = false; po.closedDate = ''; }
        record(6, '/api/purchase-orders/reopen', body); return res(200, { poNum: body.poNum, status: po ? po.status : 'Open' });
      }
      if (u.includes('/pay')) {
        const po = findPo(pur, body.poNum); if (po) { po.paymentStatus = 'Paid'; po.paymentDate = '2026-07-31'; }
        record(6, '/api/purchase-orders/pay', body); return res(200, { poNum: body.poNum, paymentStatus: 'Paid' });
      }
      if (u.includes('/unpay')) {
        const po = findPo(pur, body.poNum); if (po) { po.paymentStatus = 'Unpaid'; po.paymentDate = ''; }
        record(6, '/api/purchase-orders/unpay', body); return res(200, { poNum: body.poNum, paymentStatus: 'Unpaid' });
      }
      if (method === 'POST') {           // create PO
        const n = num(pur.counter) + 1;
        const poNum = `BLM/PUR/2026-2027/${n}`;
        const gst = num(body.gstPercent);
        const built = (body.items || []).map((it) => ({ item: it.item, unit: it.unit, qty: num(it.qty), rate: num(it.rate), amount: num(it.qty) * num(it.rate), receivedQty: 0 }));
        const sub = built.reduce((s, i) => s + i.amount, 0);
        const total = sub + sub * gst / 100;
        pur.pos.unshift({ poNum, poDate: '2026-07-31', supplier: body.supplier, items: built, totalAmount: total, expectedDelivery: body.expectedDelivery || '', gstPercent: gst, status: 'Open', grnRef: '', actualReceiptDate: '', closedDate: '', manualClosed: false, receipts: [], paymentStatus: 'Unpaid', paymentDate: '', notes: body.notes || '', createdBy: 'purchase' });
        pur.counter = n;
        built.forEach((i) => pur.priceHistory.push({ supplier: body.supplier, item: i.item, rate: i.rate, date: '2026-07-31', poNum }));
        record(6, '/api/purchase-orders', body);
        return res(201, { poNum, totalAmount: total });
      }
      return res(200, (modules.purchase && modules.purchase.pos) || []);   // GET
    }

    if (u.includes('/rest/v1/oab_data')) {
      if (method === 'GET') {
        const m = /id=eq\.(\d+)/.exec(u);
        const id = m ? Number(m[1]) : 0;
        const val = modules[ID_TO_KEY[id]];
        if (val == null) return res(200, []);
        return res(200, [{ data: JSON.stringify(val), version: versions[id] || 0 }]);
      }
      const id = body.id;
      const key = ID_TO_KEY[id];
      if (pendingConflict[id]) {
        pendingConflict[id] = false;
        versions[id] = (versions[id] || 0) + 1;
        return res(409, { error: 'version conflict' });
      }
      const data = JSON.parse(body.data);
      if (key) modules[key] = data;
      versions[id] = (versions[id] || 0) + 1;
      saved.push({ id, key, data, version: versions[id], sentVersion: body.version });
      return res(201, { id, version: versions[id] });
    }
    return res(200, {});
  };
  return saved;
}

/** Render a screen inside Router + Auth + Data providers with seeded modules. */
export function renderApp(ui, { modules = {}, role = 'user', user = 'superstar', route = '/', conflictOnce = {} } = {}) {
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_user', user);
  localStorage.setItem('blm_role', role);
  const mods = JSON.parse(JSON.stringify(modules));
  const saved = installFetch(mods, { conflictOnce });
  const utils = render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <DataProvider>{ui}</DataProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  return { ...utils, saved, mods };
}

/** Convenience: an OAB module seeded with the given SF/OT rows. */
export function oabModule({ SF = [], OT = [], INV_REG = [], lastSO = { y: '26', n: 400 }, lastInvNo = 222 } = {}) {
  return { OAB: { SF, OT }, INV_REG, lastSO, lastInvNo };
}
