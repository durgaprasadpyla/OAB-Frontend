// One reading of a purchase order, for every screen that lists them.
//
// Issues 30.09 §Stores ¶S7: "In the purchase orders tab, even with the 'Open POs
// only' ticked, the cancelled POs are still showing." The 29.09 batch added a fourth
// status — Cancelled — on the server, but every screen kept its own hand-rolled "is
// this open?" test for 'Closed', so a cancelled PO fell through as open: on the stores
// tab, in the purchase login's GRN Entry, its overdue nudge and its payables. One
// helper decides now, and every PO screen asks it.
//
// The same doc asks for a status filter and Material type / Speciality / Item
// description — as filters AND as columns — on EVERY purchase-order page. A PO line
// carries its item's identity only since 29.09; the older lines carry nothing but the
// typed description, so the identity is resolved here, once, from the Item Master,
// the line's own copy, and the supplier's approved-supplier row — never left blank.
import { purchComputeStatus } from './calc.js';

export const PO_STATUSES = ['Open', 'Partial', 'Closed', 'Cancelled'];
export const PO_STATUS_LABELS = { Open: 'Open', Partial: 'Partially received', Closed: 'Closed', Cancelled: 'Cancelled' };

const arr = (v) => (Array.isArray(v) ? v : []);
const txt = (v) => String(v == null ? '' : v).trim();
const low = (v) => txt(v).toLowerCase();

/**
 * The PO's status: 'Open' | 'Partial' | 'Closed' | 'Cancelled'.
 *
 * Cancelled wins over everything (a cancelled PO keeps its number and history, but is
 * not expected any more); a PO closed by hand or by a close date is Closed whatever its
 * lines say; otherwise the stored status, or — for a PO that never had one — what its
 * received quantities say.
 */
export function poStatus(po) {
  if (!po) return 'Open';
  const s = low(po.status);
  if (s === 'cancelled' || s === 'canceled' || po.cancelled) return 'Cancelled';
  if (s === 'closed' || po.closed || po.manualClosed || po.closedDate) return 'Closed';
  if (s === 'partial') return 'Partial';
  if (s === 'open') return 'Open';
  return purchComputeStatus(arr(po.items));
}

/** Still expected: Open or Partially received. Closed and Cancelled are not. */
export const isOpenPo = (po) => {
  const s = poStatus(po);
  return s === 'Open' || s === 'Partial';
};

/** The tag colour a status reads in (index.css .tag variants). */
export const poStatusTag = (status) => ({ Cancelled: 'tr', Closed: 'tg', Partial: 'tb' }[status] || 'ty');

/**
 * Everything a line's identity can be read from, indexed once per render.
 *
 * `master` is the server Item Master (code, name, materialType, subGroup,
 * specialtyName, uom); `itemsExtra` is module 6's own copy of it (itemCode,
 * specificMaterial, …) and only fills codes the server list does not have.
 */
export function poLineContext({ master = [], asl = [], itemsExtra = [] } = {}) {
  const byCode = new Map();
  const put = (rec) => { const k = rec.code.toUpperCase(); if (!byCode.has(k)) byCode.set(k, rec); };
  arr(master).forEach((m) => {
    const code = txt(m && m.code);
    if (!code) return;
    put({ code, name: txt(m.name), materialType: txt(m.materialType), subGroup: txt(m.subGroup),
      specialty: txt(m.specialtyName || m.specialty), uom: txt(m.uom), active: m.active !== false });
  });
  arr(itemsExtra).forEach((m) => {
    const code = txt(m && (m.itemCode || m.code));
    if (!code) return;
    put({ code, name: txt(m.specificMaterial || m.name), materialType: txt(m.materialType), subGroup: txt(m.subGroup),
      specialty: txt(m.specialty || m.specialtyName), uom: txt(m.uom), active: m.active !== false });
  });
  // A description identifies an item only when exactly one item carries it — "500 MM"
  // is a width that several materials come in.
  //
  // Review F5: the master now includes WITHDRAWN items (an old line still names them by
  // code), and a withdrawn duplicate usually carries the very description of the item
  // that replaced it ("360 was a duplicate of 082"). Counted alongside, it made that
  // description ambiguous, and a code-less pre-29.09 line that used to resolve to the
  // active item resolved to nothing. So the ACTIVE items decide a description; a
  // withdrawn one answers only for a description no active item carries.
  const byName = new Map();
  const index = (into, rec) => {
    const k = low(rec.name);
    if (!k) return;
    into.set(k, into.has(k) ? null : rec);
  };
  const inactiveByName = new Map();
  byCode.forEach((rec) => index(rec.active === false ? inactiveByName : byName, rec));
  inactiveByName.forEach((rec, k) => { if (!byName.has(k)) byName.set(k, rec); });
  const aslBySupplier = new Map();
  arr(asl).forEach((r) => {
    const k = low(r && r.company);
    if (!k) return;
    if (!aslBySupplier.has(k)) aslBySupplier.set(k, []);
    aslBySupplier.get(k).push(r);
  });
  return { byCode, byName, aslBySupplier };
}

const EMPTY_CTX = poLineContext();

/**
 * A PO line's item identity: { code, description, materialType, subGroup, specialty, uom }.
 *
 * Each field is the first filled one of: the Item Master by the line's own code → the
 * line's stored copy → the Item Master by the code on this supplier's approved-supplier
 * row for the line → that ASL row itself → the one Item Master item with that exact
 * description. A PO raised before 29.09 has only "637 x 520" on it; the supplier's ASL
 * row for that description is what names the item.
 */
export function lineIdentity(po, line, ctx = EMPTY_CTX) {
  const ln = line || {};
  const code0 = txt(ln.itemCode);
  const desc0 = low(ln.item);
  const rows = ctx.aslBySupplier.get(low(po && po.supplier)) || [];
  const aslRow = (code0 && rows.find((r) => low(r.itemCode) === low(code0)))
    || (desc0 && rows.find((r) => low(r.specificMaterial) === desc0))
    || null;
  const m1 = code0 ? ctx.byCode.get(code0.toUpperCase()) || null : null;
  const aslCode = aslRow ? txt(aslRow.itemCode) : '';
  const m2 = !m1 && aslCode ? ctx.byCode.get(aslCode.toUpperCase()) || null : null;
  const m3 = !m1 && !m2 && !code0 && !aslCode && desc0 ? ctx.byName.get(desc0) || null : null;
  const a = aslRow || {};
  const first = (...vals) => { for (const v of vals) { const t = txt(v); if (t) return t; } return ''; };
  const f = (mKey, lineVal, aslVal) => first(m1 && m1[mKey], lineVal, m2 && m2[mKey], aslVal, m3 && m3[mKey]);
  return {
    code: first(code0, aslCode, m3 && m3.code),
    description: first(m1 && m1.name, ln.item, m2 && m2.name, a.specificMaterial, m3 && m3.name),
    materialType: f('materialType', ln.materialType, a.materialType),
    subGroup: f('subGroup', ln.subGroup, a.subGroup),
    // An ASL row's ITEM speciality is `specialty`; `speciality` is the supplier's trade.
    specialty: f('specialty', ln.specialty || ln.speciality, a.specialty),
    uom: f('uom', ln.unit, a.uom),
  };
}

const NO_ITEMS = Object.freeze({ item: '(no items)', qty: 0, rate: 0, amount: 0, receivedQty: 0 });
const BLANK_ID = Object.freeze({ code: '', description: '', materialType: '', subGroup: '', specialty: '', uom: '' });

/**
 * One row per PO line: { key, po, line, idx, status, id } — `id` is the resolved
 * identity. `includeEmpty` keeps a PO with no lines as one placeholder row, so a
 * grouped table can still show it (it never matches a material filter).
 */
export function flattenPoLines(pos, ctx = EMPTY_CTX, { includeEmpty = false } = {}) {
  const out = [];
  arr(pos).forEach((po, pi) => {
    if (!po) return;
    const status = poStatus(po);
    const base = String(po.poNum || '#' + pi);
    const items = arr(po.items);
    if (!items.length) {
      if (includeEmpty) out.push({ key: base + '|-', po, line: NO_ITEMS, idx: -1, status, id: BLANK_ID, empty: true });
      return;
    }
    items.forEach((line, idx) => {
      out.push({ key: base + '|' + idx, po, line: line || {}, idx, status, id: lineIdentity(po, line, ctx) });
    });
  });
  return out;
}

export const EMPTY_PO_FILTERS = Object.freeze({ status: '', materialType: '', specialty: '', description: '', q: '' });

const byStatus = (rows, f) => rows.filter((r) => (
  (!f.openOnly || r.status === 'Open' || r.status === 'Partial')
  && (!f.status || r.status === f.status)
));

/**
 * The lines the filters keep. `openOnly` hides Closed AND Cancelled; `status` is one of
 * PO_STATUSES; the three identity filters compare case-insensitively; `q` searches the
 * PO number, supplier, item code and description.
 */
export function filterPoLines(rows, f = {}) {
  const q = low(f.q);
  return byStatus(arr(rows), f).filter((r) => {
    if (f.materialType && low(r.id.materialType) !== low(f.materialType)) return false;
    if (f.specialty && low(r.id.specialty) !== low(f.specialty)) return false;
    if (f.description && low(r.id.description) !== low(f.description)) return false;
    if (q && ![r.po.poNum, r.po.supplier, r.id.code, r.id.description, r.line.item]
      .some((v) => low(v).includes(q))) return false;
    return true;
  });
}

/** Distinct, case-insensitively, keeping the first spelling met; sorted. */
function distinct(rows, get) {
  const seen = new Map();
  rows.forEach((r) => { const v = txt(get(r)); if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v); });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * The options each identity filter offers, narrowed by the ones before it: speciality
 * lists only what the chosen material type comes in, description only what both allow.
 * Narrowed by status too, so an "Open" list never offers a closed PO's material.
 */
export function poLineOptions(rows, f = {}) {
  const base = byStatus(arr(rows), f);
  const byMat = base.filter((r) => !f.materialType || low(r.id.materialType) === low(f.materialType));
  const bySpec = byMat.filter((r) => !f.specialty || low(r.id.specialty) === low(f.specialty));
  return {
    materialTypes: distinct(base, (r) => r.id.materialType),
    specialties: distinct(byMat, (r) => r.id.specialty),
    descriptions: distinct(bySpec, (r) => r.id.description),
  };
}

/** Rows regrouped per PO, in the order the POs first appear: [{ po, status, rows }]. */
export function groupByPo(rows) {
  const groups = new Map();
  arr(rows).forEach((r) => {
    const k = r.po;
    if (!groups.has(k)) groups.set(k, { po: r.po, status: r.status, rows: [] });
    groups.get(k).rows.push(r);
  });
  return [...groups.values()];
}

/** The stores GRNs booked against a PO number (trimmed, case-insensitive). */
export function storeGrnsForPo(grns, poNum) {
  const want = low(poNum);
  if (!want) return [];
  return arr(grns).filter((g) => low(g && (g.poNum != null ? g.poNum : g.po_num)) === want);
}
