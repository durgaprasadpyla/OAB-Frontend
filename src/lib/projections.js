// Future projections — what sales expect to sell, month by month, and how that
// compares with the orders that actually arrive.
//
// A projection is a promise about a month, made before the POs exist. It carries a
// quantity, who is chasing it, and enough identity to price the material behind it:
//
//   · from the CUSTOMER list — a JSS number (spec). The customer and SKU follow the
//     spec, so a projection cannot describe a job the factory does not have a
//     specification for, and the spec's BOM gives the material requirement.
//   · from a LEAD — no spec exists yet, because nobody has specified the job. The
//     customer and SKU are typed, the quantity is tentative, and the material
//     requirement is unknowable until the lead becomes a spec. That absence is
//     reported rather than guessed at.
//
// ACTUALS ARE NEVER STORED. What a month actually brought in is the purchase orders
// whose PO date falls inside it, read from the OAB every time the question is asked.
// Storing a second copy would mean two numbers that could disagree, and the OAB is
// the one that is true.

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const s = (v) => String(v == null ? '' : v).trim();
const key = (v) => s(v).toLowerCase();

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10" → "October 2026". Anything unparseable comes back as itself. */
export function monthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(s(month));
  if (!m) return s(month);
  const i = Number(m[2]) - 1;
  return MONTH_NAMES[i] ? `${MONTH_NAMES[i]} ${m[1]}` : s(month);
}

/** The month an ISO-ish date belongs to: "2026-10-17" → "2026-10". */
export function monthOf(date) {
  const m = /^(\d{4})-(\d{2})/.exec(s(date));
  return m ? `${m[1]}-${m[2]}` : '';
}

/** This month, as the form's default. */
export function currentMonth(today = new Date()) {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

/** The next `count` months from `from` inclusive — what a projection may be made for. */
export function monthsFrom(from, count = 12) {
  const m = /^(\d{4})-(\d{2})$/.exec(s(from));
  if (!m) return [];
  let y = Number(m[1]);
  let mo = Number(m[2]);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(mo).padStart(2, '0')}`);
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
  }
  return out;
}

/**
 * A blank projection. `dispLoc` empty is meaningful and is the default: "if I do not
 * select the dispatch location, we will assume that it is for all the dispatch
 * locations for that particular customer".
 */
export const blankProjection = (month) => ({
  id: '', source: 'customer', month: month || '', spec: '', customer: '', jobName: '',
  leadId: '', dispLoc: '', qty: '', marketer: '', note: '',
});

/** Rows out of the blob, newest first, with only the shape this module promises. */
export function projectionList(projections) {
  const rows = (projections && Array.isArray(projections.entries)) ? projections.entries : [];
  return rows.filter(Boolean).map((r) => ({ ...blankProjection(), ...r }));
}

/**
 * Validate and normalise one entry from the form. Throws with the sentence the desk
 * should read — the caller shows it and nothing is written.
 */
export function validateProjection(form, { jss = [] } = {}) {
  const out = { ...blankProjection(), ...form };
  out.source = out.source === 'lead' ? 'lead' : 'customer';

  // Checked in the order the form asks for them, so the sentence names the first box
  // that needs attention rather than whichever rule happened to be written first.
  if (out.source === 'customer') {
    out.spec = s(out.spec);
    if (!out.spec) throw new Error('Choose the JSS number this projection is for.');
    const j = jss.find((x) => key(x.spec) === key(out.spec));
    if (!j) throw new Error(`JSS ${out.spec} is not in the spec master — add it in the JSS Editor first.`);
    // The spec owns the customer and the SKU: typing them separately is how two
    // records of one job start disagreeing.
    out.customer = s(j.customer);
    out.jobName = s(j.jobName);
    out.leadId = '';
  } else {
    out.spec = '';
    out.customer = s(out.customer);
    out.jobName = s(out.jobName);
    if (!out.customer) throw new Error('Enter the customer this lead is with.');
    if (!out.jobName) throw new Error('Enter the SKU this projection is for.');
  }

  out.dispLoc = s(out.dispLoc);

  out.month = s(out.month);
  if (!/^\d{4}-\d{2}$/.test(out.month)) throw new Error('Choose the month this projection is for.');

  const qty = Number(s(out.qty));
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Enter the quantity expected, as a number greater than zero.');
  out.qty = qty;

  out.marketer = s(out.marketer);
  if (!out.marketer) throw new Error('Choose the marketing person this projection belongs to.');
  out.note = s(out.note);
  return out;
}

/** Add or replace one projection in the blob, leaving every other entry untouched. */
export function saveProjection(projections, entry, { user = '', now = () => new Date().toISOString() } = {}) {
  const list = projectionList(projections);
  const stamped = { ...entry };
  if (!stamped.id) {
    stamped.id = `P${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    stamped.createdBy = user;
    stamped.createdAt = now();
  } else {
    stamped.updatedBy = user;
    stamped.updatedAt = now();
  }
  const i = list.findIndex((r) => r.id === stamped.id);
  const entries = i >= 0
    ? list.map((r, j) => (j === i ? { ...r, ...stamped } : r))
    : [stamped, ...list];
  return { ...(projections || {}), entries };
}

/** Remove one projection by id. */
export function removeProjection(projections, id) {
  return { ...(projections || {}), entries: projectionList(projections).filter((r) => r.id !== id) };
}

/**
 * The purchase orders that actually landed in a month, from the OAB.
 *
 * A row counts by its PO DATE, which is when the customer placed it — "based on the
 * POs that we receive in that particular month from 1st to 30th". Closed orders count
 * too: an order placed and finished inside the month still arrived in it.
 */
export function actualsForMonth(oab, month) {
  const out = [];
  ['SF', 'OT'].forEach((sheet) => {
    ((oab && oab.OAB && oab.OAB[sheet]) || []).forEach((r) => {
      if (!r || monthOf(r.poDate) !== s(month)) return;
      out.push({
        so: s(r.so), spec: s(r.spec), customer: s(r.customer), jobName: s(r.jobName),
        dispLoc: s(r.dispLoc), qty: n(r.poQty), poNum: s(r.poNum), poDate: s(r.poDate),
      });
    });
  });
  return out;
}

/**
 * Does this actual PO belong against this projection?
 *
 * A spec-backed projection matches on the SPEC, which is the job's identity. A lead
 * projection has no spec, so it falls back to customer + SKU text. A projection with a
 * dispatch location matches only that location; one left blank matches every location
 * the customer has, which is exactly what leaving it blank was declared to mean.
 */
export function actualMatches(projection, po) {
  if (projection.dispLoc && key(projection.dispLoc) !== key(po.dispLoc)) return false;
  if (projection.spec) return key(projection.spec) === key(po.spec);
  return key(projection.customer) === key(po.customer) && key(projection.jobName) === key(po.jobName);
}

/**
 * One month, reconciled: every projection with what came in against it, and every PO
 * that arrived without one.
 *
 * A PO is consumed by the FIRST projection that claims it, so two projections for the
 * same job in one month cannot both count it — the total would otherwise exceed what
 * the customer actually ordered. Projections are taken most specific first (a named
 * dispatch location before an all-locations one) so the narrower promise is settled
 * before the broader one absorbs it.
 */
export function reconcileMonth(projections, oab, month) {
  const mine = projectionList(projections).filter((r) => r.month === s(month));
  const pos = actualsForMonth(oab, month);
  const taken = new Set();

  const ordered = mine
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.dispLoc ? 1 : 0) - (a.r.dispLoc ? 1 : 0) || a.i - b.i)
    .map((x) => x.r);

  const rows = ordered.map((p) => {
    const matched = [];
    pos.forEach((po, i) => {
      if (taken.has(i) || !actualMatches(p, po)) return;
      taken.add(i);
      matched.push(po);
    });
    const actual = matched.reduce((t, po) => t + po.qty, 0);
    return {
      ...p,
      actual,
      orders: matched,
      remaining: Math.max(0, n(p.qty) - actual),
      // Over-delivery is real information — the customer ordered more than sales
      // expected — so it is reported rather than clamped away.
      over: Math.max(0, actual - n(p.qty)),
    };
  });

  const unplanned = pos.filter((_, i) => !taken.has(i));
  return {
    month: s(month),
    rows,
    unplanned,
    projected: rows.reduce((t, r) => t + n(r.qty), 0),
    actual: rows.reduce((t, r) => t + r.actual, 0) + unplanned.reduce((t, r) => t + r.qty, 0),
    matchedActual: rows.reduce((t, r) => t + r.actual, 0),
    unplannedQty: unplanned.reduce((t, r) => t + r.qty, 0),
  };
}

/** The reconciled rows grouped by customer — how the month reads to a planner. */
export function byCustomer(rows) {
  const m = new Map();
  rows.forEach((r) => {
    const c = s(r.customer) || '(unnamed)';
    if (!m.has(c)) m.set(c, { customer: c, rows: [], projected: 0, actual: 0, remaining: 0 });
    const g = m.get(c);
    g.rows.push(r);
    g.projected += n(r.qty);
    g.actual += n(r.actual);
    g.remaining += n(r.remaining);
  });
  return [...m.values()].sort((a, b) => b.projected - a.projected);
}

/**
 * The raw material a month's projections imply, from the BOM behind each spec.
 *
 * `materialFor(spec, qty)` is injected rather than imported so this module stays free
 * of the BOM's own shape — the caller passes `bomMaterialForSO` bound to its map.
 *
 * Only the REMAINING quantity is costed by default: material for an order that has
 * already arrived is the SO's business, not the projection's. `basis: 'projected'`
 * asks the other question — what the whole month was expected to need.
 */
export function materialForMonth(rows, materialFor, { basis = 'remaining' } = {}) {
  const need = new Map();
  const noBom = [];
  rows.forEach((r) => {
    const qty = basis === 'projected' ? n(r.qty) : n(r.remaining);
    if (qty <= 0) return;
    if (!r.spec) { noBom.push({ ...r, reason: 'from a lead — no JSS number yet' }); return; }
    const lines = materialFor(r.spec, qty) || [];
    if (!lines.length) { noBom.push({ ...r, reason: 'no BOM saved for this spec' }); return; }
    lines.forEach((l) => {
      const k = key(l.itemCode) || key(l.itemDescription);
      if (!k) return;
      if (!need.has(k)) {
        need.set(k, {
          itemCode: s(l.itemCode), itemDescription: s(l.itemDescription),
          materialType: s(l.materialType), subGroup: s(l.subGroup), uom: s(l.uom), required: 0,
        });
      }
      need.get(k).required += n(l.required);
    });
  });
  return {
    items: [...need.values()].sort((a, b) => b.required - a.required),
    noBom,
  };
}

/**
 * Projected against actual across a run of months, for the line chart.
 * Returns null when there is nothing to plot, the way buildScrapChart does.
 */
export function projectedVsActual(projections, oab, months) {
  const list = (months || []).filter((m) => /^\d{4}-\d{2}$/.test(s(m)));
  if (!list.length) return null;
  const points = list.map((m) => {
    const rec = reconcileMonth(projections, oab, m);
    return { month: m, label: monthLabel(m), projected: rec.projected, actual: rec.actual };
  });
  const max = Math.max(1, ...points.map((p) => Math.max(p.projected, p.actual)));
  return { points, max };
}

/** Every month any projection has been made for, newest first. */
export function projectedMonths(projections) {
  return [...new Set(projectionList(projections).map((r) => r.month).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
}
