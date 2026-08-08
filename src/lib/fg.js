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
// NOT touch the pool (it only consumes the SO's own `row.fg`). Every function
// here is pure — it returns a NEW ledger object rather than mutating in place —
// so it composes cleanly with React state and `save('fgLedger', next)`.

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
 * Append-only: earlier entries are never edited. A qty <= 0 is a no-op.
 */
export function fgAddProduction(ledger, spec, date, qty, note = '') {
  const q = n(qty);
  if (!spec || q <= 0) return ledger || {};
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

/** Specs that have any production or allocation recorded. */
export function fgSpecsWithActivity(ledger) {
  const l = ledger || {};
  return Object.keys(l).filter((sp) => {
    const e = fgEntry(l, sp);
    return e.prod.length > 0 || e.alloc.length > 0;
  });
}
