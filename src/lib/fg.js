// Finished-Goods (FG) ledger accounting — native port of the legacy fg* helpers.
//
// The ledger is a per-spec finished-goods pool, persisted as data module 9
// (`fgLedger`). For each spec it holds two append-only lists:
//   prod  — dated production entries   {date, qty, ts, id, note}
//   alloc — draws to sale orders        {date, qty, ts, so, src}
//
//   Available FG for a spec = total produced − total allocated.
//
// Production is append-only (a day's output is never edited or overwritten).
// Once FG is allocated to an SO it has left the pool for good; invoicing does
// NOT touch the pool (it only consumes the SO's own `row.fg`) — the FG sheet reads
// what was invoiced off the order book instead (see fgStock). Every function
// here is pure — it returns a NEW ledger object rather than mutating in place —
// so it composes cleanly with React state and `save('fgLedger', next)`.

import { inr } from './format.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Local YYYY-MM-DD (matches the legacy fgTodayISO). */
export function fgTodayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** A short unique id for a production entry (legacy: 'p'+base36 time+rand). */
function prodId() {
  return 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
}

/** The {prod,alloc} entry for a spec, or an empty shape (never mutates `ledger`). */
export function fgEntry(ledger, spec) {
  const e = (ledger && ledger[spec]) || null;
  return {
    prod: Array.isArray(e && e.prod) ? e.prod : [],
    alloc: Array.isArray(e && e.alloc) ? e.alloc : [],
  };
}

/** Total produced for a spec. */
export function fgProduced(ledger, spec) {
  return fgEntry(ledger, spec).prod.reduce((s, p) => s + n(p.qty), 0);
}

/** Total allocated (drawn out) for a spec. */
export function fgAllocated(ledger, spec) {
  return fgEntry(ledger, spec).alloc.reduce((s, a) => s + n(a.qty), 0);
}

/** Available FG for a spec = produced − allocated. */
export function fgAvail(ledger, spec) {
  return fgProduced(ledger, spec) - fgAllocated(ledger, spec);
}

/**
 * Append a dated production entry for a spec. Returns a NEW ledger.
 * Append-only: earlier entries are never edited.
 *
 * A qty <= 0 is a no-op for the normal production path (the FG Entry screen must
 * not book an empty or negative day). Pass `{allowNegative:true}` for the Super
 * Admin "set Available FG" correction, which books the DELTA — negative when
 * reducing stock — so the ledger stays append-only and FIFO ageing still
 * reconciles. A zero delta is always a no-op.
 */
export function fgAddProduction(ledger, spec, date, qty, note = '', { allowNegative = false } = {}) {
  const q = n(qty);
  if (!spec || (allowNegative ? q === 0 : q <= 0)) return ledger || {};
  const base = ledger || {};
  const cur = fgEntry(base, spec);
  const entry = { date: date || fgTodayISO(), qty: q, ts: Date.now(), id: prodId(), note: note || '' };
  return { ...base, [spec]: { prod: [...cur.prod, entry], alloc: [...cur.alloc] } };
}

/**
 * Append an allocation (draw to a sale order) for a spec. Returns a NEW ledger.
 * `src` is 'new-po' | 'daily-update'. A qty <= 0 is a no-op.
 */
export function fgAddAllocation(ledger, spec, qty, so, src = '') {
  const q = n(qty);
  if (!spec || q <= 0) return ledger || {};
  const base = ledger || {};
  const cur = fgEntry(base, spec);
  const entry = { date: fgTodayISO(), qty: q, ts: Date.now(), so: so || '', src: src || '' };
  return { ...base, [spec]: { prod: [...cur.prod], alloc: [...cur.alloc, entry] } };
}

// ── Dispatched on an invoice ───────────────────────────────────────────────
// Issues 02.11 (FG Entry): "as soon as an invoice happens, that means the allocated
// quantity has left the premises, and I don't need its data here." An invoice
// consumes the SO's own FG first (`row.fg -= fgToUse`, server-side) and never
// touches this ledger — so FG allocated to an SO and then invoiced kept counting
// in Produced and Allocated for ever (E1025: 629,800 produced, 352,400 allocated).
//
// The ledger stays append-only; what has gone out is READ off the order book:
// for every SO this spec allocated to, the part of that allocation the SO no longer
// holds as FG — capped at what it has actually invoiced — has left the premises.
// It comes off Produced AND Allocated alike, so Available is unchanged (it was
// never on hand to begin with). Working it out rather than recording it means the
// invoices raised before this change are counted too.

/** Every sale order on the OAB (both sheets, open and closed), keyed by SO number. */
export function fgOrderIndex(oab) {
  const sheets = (oab && oab.OAB) || {};
  const out = {};
  ['SF', 'OT'].forEach((sh) => (Array.isArray(sheets[sh]) ? sheets[sh] : []).forEach((r) => {
    if (r && r.so != null && String(r.so).trim()) out[String(r.so).trim()] = r;
  }));
  return out;
}

/**
 * `{so: qty}` — how much of each SO's allocation from this spec has gone out on an
 * invoice. An SO the order book no longer has keeps its allocation (nothing says it
 * left); an SO not yet invoiced has dispatched nothing.
 */
export function fgDispatchedBySo(ledger, spec, orders) {
  const toSo = {};
  fgEntry(ledger, spec).alloc.forEach((a) => {
    const so = String(a.so || '').trim();
    if (so) toSo[so] = (toSo[so] || 0) + n(a.qty);
  });
  const out = {};
  Object.entries(toSo).forEach(([so, allocated]) => {
    const row = orders && orders[so];
    if (!row || allocated <= 0) return;
    const gone = Math.min(allocated - n(row.fg), allocated, n(row.invDisp));
    if (gone > 0) out[so] = gone;
  });
  return out;
}

/** Total of a spec's allocations that have left on an invoice. */
export function fgDispatched(ledger, spec, orders) {
  return Object.values(fgDispatchedBySo(ledger, spec, orders)).reduce((s, q) => s + q, 0);
}

/**
 * What the FG sheet shows for a spec: what has been produced and is still with us,
 * how much of it is promised to an SO, and what is free. Invoiced FG is gone from
 * the first two; `dispatched` says how much that was.
 */
export function fgStock(ledger, spec, orders) {
  const dispatched = fgDispatched(ledger, spec, orders);
  return {
    produced: fgProduced(ledger, spec) - dispatched,
    allocated: fgAllocated(ledger, spec) - dispatched,
    available: fgAvail(ledger, spec),
    dispatched,
  };
}

/** Specs that have any production or allocation recorded. */
export function fgSpecsWithActivity(ledger) {
  const l = ledger || {};
  return Object.keys(l).filter((sp) => {
    const e = fgEntry(l, sp);
    return e.prod.length > 0 || e.alloc.length > 0;
  });
}

// ── FIFO ageing ────────────────────────────────────────────────────────────
// Port of the legacy fgRemainingBatches / fgDaysSince / fgAgeingInfo trio.
// FG leaves the pool oldest-batch-first, so "how old is this spec's stock?"
// means the age of the OLDEST batch still unconsumed — that is the one the
// next dispatch draws from.

/** Whole days between a YYYY-MM-DD entry date and today (never negative). */
export function fgDaysSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - d) / 86400000));
}

/**
 * The production batches still on hand for a spec, oldest first, each with the
 * quantity that survives after allocations are drawn FIFO.
 *
 * Manual negative production entries (the FG Value ✏️ correction) reduce stock
 * exactly like an allocation does — oldest batch first — so they are folded
 * into the same consumption pool rather than treated as batches of their own.
 */
export function fgRemainingBatches(ledger, spec) {
  const prodAll = fgEntry(ledger, spec).prod.slice().sort((a, b) => n(a.ts) - n(b.ts));
  const batches = prodAll.filter((p) => n(p.qty) > 0);
  const corrections = prodAll.reduce((s, p) => (n(p.qty) < 0 ? s - n(p.qty) : s), 0);

  let toConsume = fgAllocated(ledger, spec) + corrections;
  const out = [];
  batches.forEach((p) => {
    const qty = n(p.qty);
    if (toConsume >= qty) { toConsume -= qty; return; }
    const remaining = qty - toConsume;
    toConsume = 0;
    if (remaining > 0) out.push({ date: p.date, qty: remaining });
  });
  return out;
}

/**
 * Ageing of the oldest unconsumed batch: `{days, qty, display}`, e.g.
 * `"90 days (10,000)"`. With nothing on hand → `{days:-1, qty:0, display:'-'}`.
 */
export function fgAgeingInfo(ledger, spec) {
  const batches = fgRemainingBatches(ledger, spec);
  if (!batches.length) return { days: -1, qty: 0, display: '-' };
  const b = batches[0];
  const days = fgDaysSince(b.date);
  return { days, qty: b.qty, display: `${days} day${days === 1 ? '' : 's'} (${inr(b.qty)})` };
}

/** Just the display string from fgAgeingInfo. */
export function fgAgeingDisplay(ledger, spec) {
  return fgAgeingInfo(ledger, spec).display;
}
