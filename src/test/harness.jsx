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
export function installFetch(modules, { conflictOnce = {}, forbidRead = {}, failRead = {}, role = 'user', user = 'superstar', meRole = null, meUnauthorized = false, hr = null, mustChangePassword = false } = {}) {
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

    if (u.includes('/api/auth/login')) return res(200, { token: 't', username: user, role, mustChangePassword });
    if (u.includes('/api/auth/me')) {
      if (meUnauthorized) return res(401, { error: 'Not authenticated' });   // invalid/expired token
      return res(200, { username: user, role: meRole || role, mustChangePassword }); // server-authoritative role + forced-change flag
    }

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

    // Persist the packing list onto a SAVED invoice — must be matched before the
    // generic /api/invoices POST below (substring overlap).
    if (u.includes('/api/invoices/packing-list') && method === 'POST') {
      const entry = ((modules.oab && modules.oab.INV_REG) || []).find((e) => e.no === body.no);
      if (!entry) return res(404, { status: 404, message: 'No invoice ' + body.no + ' in the register' });
      entry.packingList = body.packingList || [];
      recordOab('/api/invoices/packing-list', body);
      return res(200, { no: body.no, items: (body.packingList || []).length });
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

    // GET /api/oab-rows?sheet=SF&open=true — the normalized read the OAB board now
    // uses instead of the whole `oab` blob. Derives rows from the seeded module and
    // returns each as { payload:<row JSON> }, mirroring the real endpoint's SELECT *.
    if (u.includes('/api/oab-rows') && method === 'GET') {
      const oab = modules.oab || { OAB: { SF: [], OT: [] } };
      const sheetM = /[?&]sheet=([^&]+)/.exec(u);
      const openM = /[?&]open=([^&]+)/.exec(u);
      const wantSheet = sheetM ? decodeURIComponent(sheetM[1]) : null;
      const wantOpen = openM ? openM[1] === 'true' : null;
      const out = [];
      (wantSheet ? [wantSheet] : ['SF', 'OT']).forEach((sh) =>
        (((oab.OAB && oab.OAB[sh]) || [])).forEach((r) => {
          if (wantOpen === true && r.closed) return;
          if (wantOpen === false && !r.closed) return;
          out.push({ so: r.so, sheet: sh, closed: !!r.closed, payload: JSON.stringify(r) });
        }));
      return res(200, out);
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

    // Superadmin observability endpoints (normalized rollups + audit trail + resync).
    if (u.includes('/api/summary') && method === 'GET') {
      const oab = modules.oab || {};
      const count = (pred) => ['SF', 'OT'].reduce((n, k) => n + ((oab.OAB && oab.OAB[k]) || []).filter(pred).length, 0);
      return res(200, {
        customers: (modules.customers || []).length,
        specs: (modules.jss || []).length,
        suppliers: ((modules.purchase && modules.purchase.asl) || []).length,
        specsPriced: Object.keys(modules.prices || {}).length,
        oabRowsOpen: count((r) => !r.closed),
        oabRowsClosed: count((r) => r.closed),
        invoices: ((oab.INV_REG) || []).length,
        invoicedAmount: ((oab.INV_REG) || []).reduce((s, i) => s + num(i.amount), 0),
        byCustomer: [],
      });
    }
    if (u.includes('/api/audit') && method === 'GET') {
      return res(200, [
        { id: 2, entity_type: 'INVOICE', entity_id: 'BL/26-27/1', action: 'CREATE', actor: 'superstar', ts: '2026-08-10T10:05:00', details: '{"qty":100}' },
        { id: 1, entity_type: 'SALES_ORDER', entity_id: '26/1', action: 'CREATE', actor: 'superstar', ts: '2026-08-10T10:00:00', details: '{"poQty":1000}' },
      ]);
    }
    if (u.includes('/api/admin/resync') && method === 'POST') {
      return res(200, { status: 'ok', resynced: 8 });
    }
    // GET /api/invoices — the normalized invoice register the Invoice screen now reads.
    // Each row carries `payload` = the exact INV_REG entry (newest first), like the API.
    if (u.includes('/api/invoices') && method === 'GET') {
      const regList = (modules.oab && modules.oab.INV_REG) || [];
      return res(200, regList.map((e) => ({
        id: e.no, inv_no: e.no, inv_date: e.date, po: e.po, customer: e.customer,
        qty: e.qty, amount: e.amount, margin: e.margin, items: e.items || [],
        payload: JSON.stringify(e),
      })));
    }

    // ── HR (/api/hr/**) — served from the `hr` fixture when a test supplies one.
    // Without a fixture every HR call 403s, which is what a non-HR role really sees.
    if (u.includes('/api/hr/')) {
      if (!hr) return res(403, { error: 'forbidden' });
      const path = u.split('/api/hr/')[1].split('?')[0];
      const query = Object.fromEntries(new URLSearchParams(u.includes('?') ? u.split('?')[1] : ''));

      if (method === 'GET') {
        if (path === 'dashboard') return res(200, hr.dashboard || {});
        if (path === 'meta') {
          return res(200, hr.meta || { statuses: ['Active', 'On Notice', 'Inactive', 'Resigned', 'Terminated', 'On Leave'], employmentTypes: ['Full-time'], genders: ['Male', 'Female', 'Other'] });
        }
        if (path === 'employees') {
          let list = hr.employees || [];
          if (query.q) list = list.filter((e) => [e.fullName, e.empCode].some((v) => String(v || '').toLowerCase().includes(query.q.toLowerCase())));
          if (query.status) list = list.filter((e) => e.status === query.status);
          if (query.departmentId) list = list.filter((e) => String(e.departmentId) === String(query.departmentId));
          return res(200, list);
        }
        // Mirror HrController: default = active-only; includeInactive=1 lists all.
        // The Org management panels rely on includeInactive so a DEACTIVATED row
        // (which still owns its unique name) stays visible and re-enableable.
        const activeOnly = (list) => (query.includeInactive === '1' || query.includeInactive === 'true'
          ? list : list.filter((r) => r.active !== false));
        if (path === 'departments') return res(200, activeOnly(hr.departments || []));
        if (path === 'designations') return res(200, activeOnly(hr.designations || []));
        if (path === 'leave-types') return res(200, activeOnly(hr.leaveTypes || []));
        if (path === 'leave-requests') {
          let list = hr.leaveRequests || [];
          if (query.status) list = list.filter((r) => r.status === query.status);
          return res(200, list);
        }
        if (path === 'audit') return res(200, hr.audit || []);
        if (/^employees\/\d+\/documents$/.test(path)) return res(200, hr.documents || []);
        // Mirror HrService.getEmployeeProfile: the list row + documents + leave data.
        if (/^employees\/\d+$/.test(path)) {
          const id = Number(path.split('/')[1]);
          const emp = (hr.employees || []).find((e) => e.id === id);
          if (!emp) return res(404, { error: 'No employee ' + id });
          return res(200, {
            ...emp,
            documents: hr.documents || [],
            leaveRequests: (hr.leaveRequests || []).filter((r) => r.employeeId === id),
            leaveBalance: hr.leaveBalance || [],
          });
        }
      }

      // Writes are recorded so tests can assert the request, then applied to the
      // fixture so a follow-up reload reflects them.
      saved.push({ hrPath: path, method, body });
      if (path === 'departments' && method === 'POST') {
        // Mirror HrService.createDepartment: the UNIQUE name is case-insensitive on
        // MySQL and held by INACTIVE rows too; Spring renders the reason as
        // {"message": "..."} (server.error.include-message=always).
        if ((hr.departments || []).some((d) => String(d.name).toLowerCase() === String(body.name || '').toLowerCase())) {
          return res(409, { message: `A department named '${body.name}' already exists` });
        }
        const row = { id: (hr.departments || []).length + 700, active: true, ...body };
        hr.departments = [...(hr.departments || []), row];
        return res(201, row);
      }
      if (path === 'employees' && method === 'POST') {
        // Mirror HrService.createEmployee's two rejections so the UI's error
        // handling is exercised against the real contract, not a permissive stub.
        if (!body.empCode) return res(400, 'Employee ID is required');
        if (!body.firstName) return res(400, 'First name is required');
        if ((hr.employees || []).some((e) => e.empCode === body.empCode)) {
          return res(409, `Employee ID '${body.empCode}' already exists`);
        }
        const row = { id: (hr.employees || []).length + 900, fullName: `${body.firstName} ${body.lastName || ''}`.trim(), ...body };
        hr.employees = [...(hr.employees || []), row];
        return res(201, row);
      }
      if (/^employees\/\d+\/status$/.test(path)) {
        const id = Number(path.split('/')[1]);
        hr.employees = (hr.employees || []).map((e) => (e.id === id ? { ...e, status: body.status } : e));
        return res(200, hr.employees.find((e) => e.id === id));
      }
      if (/^leave-requests\/\d+\/(approve|reject)$/.test(path)) {
        const id = Number(path.split('/')[1]);
        const status = path.endsWith('approve') ? 'Approved' : 'Rejected';
        hr.leaveRequests = (hr.leaveRequests || []).map((r) => (r.id === id ? { ...r, status } : r));
        return res(200, { id, status });
      }
      if (path === 'leave-requests' && method === 'POST') {
        const row = { id: (hr.leaveRequests || []).length + 500, status: 'Pending', ...body };
        hr.leaveRequests = [...(hr.leaveRequests || []), row];
        return res(201, row);
      }
      return res(200, { ok: true });
    }

    if (u.includes('/api/auth/change-password')) {
      saved.push({ endpoint: '/api/auth/change-password', body });
      if (!body.currentPassword || !body.newPassword) return res(400, { error: 'missing' });
      if (body.currentPassword === 'wrong') return res(400, 'Current password is incorrect');
      return res(200, { ok: true });
    }

    // Production-planning masters + stock/notifications default to empty lists, so a page
    // that reads them on mount (MasterData — now embedded in the Super Admin Dashboard, §6)
    // renders cleanly without every test having to stub them.
    if (u.includes('/api/master/')) return res(200, []);
    if (u.includes('/api/stock/alerts')) return res(200, []);
    if (u.includes('/api/notifications')) return res(200, []);

    if (u.includes('/rest/v1/oab_data')) {
      if (method === 'GET') {
        // Bulk read (id=in.(1,2,3,…)) — the SPA loads all modules in one request. It
        // SKIPS modules the role may not read (no per-row 403); a genuine read failure
        // 500s the whole request (mirrors OabDataController.get).
        const inM = /id=in\.\(([^)]*)\)/.exec(u);
        if (inM) {
          const ids = inM[1].split(',').map((x) => Number(x.trim())).filter((n) => n > 0);
          if (ids.some((id) => failRead[id])) return res(500, { error: 'boom' });
          const out = [];
          ids.forEach((id) => {
            if (forbidRead[id]) return;                  // skipped, not 403
            const val = modules[ID_TO_KEY[id]];
            if (val != null) out.push({ id, data: JSON.stringify(val), version: versions[id] || 0 });
          });
          return res(200, out);
        }
        const m = /id=eq\.(\d+)/.exec(u);
        const id = m ? Number(m[1]) : 0;
        if (forbidRead[id]) return res(403, { error: 'forbidden' });   // single read: strict per-module 403
        if (failRead[id]) return res(500, { error: 'boom' });          // genuine server failure
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
export function renderApp(ui, { modules = {}, role = 'user', user = 'superstar', route = '/', conflictOnce = {}, forbidRead = {}, failRead = {}, meRole = null, meUnauthorized = false, hr = null, mustChangePassword = false, repId = '' } = {}) {
  localStorage.setItem('blm_token', 't');
  localStorage.setItem('blm_user', user);
  localStorage.setItem('blm_role', role);
  // Sales reps live in the module-12 blob, so their screens key off blm_rep_id
  // rather than the username. (auth.jsx repLogin)
  if (repId) { localStorage.setItem('blm_rep_id', repId); localStorage.setItem('blm_rep_name', user); }
  else { localStorage.removeItem('blm_rep_id'); localStorage.removeItem('blm_rep_name'); }
  const mods = JSON.parse(JSON.stringify(modules));
  const saved = installFetch(mods, { conflictOnce, forbidRead, failRead, role, user, meRole, meUnauthorized, hr, mustChangePassword });
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
