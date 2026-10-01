// Sales Login (2026-09-15) — the rep's flow from a LEAD to a PO, as the business
// wrote it down: a lead becomes a CUSTOMER only when the Super Admin converts it;
// a sample the rep receives goes to QC as a CSA requisition with the despatch
// details; the quote desk prices it; the rep may raise (never lower) that price,
// sends the quote, marks it accepted; QC creates the JSS from the accepted CSA;
// the PO is entered against the accepted quote and its JSS; the Superstar pushes
// the PO onto the OAB as a sale order.
//
// Pure functions over the sales blob (module 12), so every screen agrees on what a
// "customer", a "floor price" or an "open PO" is. Nothing here touches the network.
import { salesUid, salesToday, leadsForRep, leadCategories, leadOwnerIds, categoryRep } from './sales.js';
import { acceptedMinPrice } from './repPortal.js';

const s = (v) => String(v == null ? '' : v).trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const lower = (v) => s(v).toLowerCase();
/** A customer name as the Customer Master is matched: case and spacing do not count. */
const nameKey = (v) => lower(v).replace(/\s+/g, ' ');

/* ── lead or customer ───────────────────────────────────────────────────── */

/**
 * A lead is a CUSTOMER once the Super Admin has converted it (the Leads tab /
 * S Dashboard), or when the Super Admin has made a rep its KAM and not moved it back
 * to a lead. "This lead-to-customer change will only happen within the super admin
 * login."
 */
export function isCustomerLead(lead, customers) {   // eslint-disable-line no-unused-vars
  if (!lead) return false;
  // 28.09 §Sales ¶20: "Zepto, which is added as a Lead, is now shown under Customer."
  // This also matched on NAME against the Customer Master, so a new lead whose company
  // already buys from us was filed as a customer the moment it was typed — and the
  // Super Admin's own "un-convert" could never take effect, because the name still
  // matched. The conversion is the Super Admin's to make and is recorded on the lead:
  // that flag is now the only thing that decides it.
  if (lead.converted_to_customer === true) return true;
  // 30.09 §SL6: the Super Admin makes a rep KAM from the Customer Master — the KAM
  // screen lists customers, never leads — so a KAM account IS a customer unless the
  // Super Admin has explicitly moved it back to a lead (↩ Lead writes false). Older KAM
  // lead records carry no flag at all. This rule lives HERE, not in one screen, so the
  // rep's book, the S Dashboard, the Leads tab, QC's CSA → JSS list and the quotation /
  // PO checks all file the same account on the same side.
  return !!s(lead.kam) && lead.converted_to_customer !== false;
}

/**
 * The rep's book, split the way every tab asks for it:
 *   leads     — the leads the Super Admin allocated to the rep, or the rep added
 *   customers — those of them the Super Admin has converted, plus any customer
 *               the Super Admin made the rep KAM of
 */
export function repBook(sales, customers, repId) {
  const mine = leadsForRep(sales && sales.leads, repId);
  const ids = new Set(mine.map((l) => l.id));
  const kamOf = repId
    ? arr(sales && sales.leads).filter((l) => l && String(l.kam || '') === String(repId) && !ids.has(l.id))
    : [];
  // 30.09: a KAM account is a customer unless the Super Admin moved it back to a lead —
  // decided by isCustomerLead, the rule every other screen reads, so the rep's book
  // can never file an account on the other side from the Super Admin's screens.
  const all = [...mine, ...kamOf];
  return {
    leads: all.filter((l) => !isCustomerLead(l, customers)),
    customers: all.filter((l) => isCustomerLead(l, customers)),
  };
}

/* ── the conversion — ONE rule for the rep, the S Dashboard and the Super Admin ── */
//
// 30.09 §Sales: "In My Leads, leads marked Converted should be sent to the Super
// Admin for conversion; once the Super Admin converts, they move to the customers
// list." And: "I have marked these customers as customers from lead, whereas in the
// sales rep login they are still under leads 'Converted'."
//
// The stage dropdown and the conversion were two unrelated fields: a rep — or the
// Super Admin on the S Dashboard — could set the stage to Converted and nothing was
// ever converted. Now a rep's "Converted" is a REQUEST the Super Admin sees queued,
// and the Super Admin's own "Converted" IS the conversion. Both Leads screens read
// the queue through these helpers, so they can never disagree again.

/** True for the "Converted" lead stage, however it is cased. */
export function isConvertedStage(stage) {
  return lower(stage) === 'converted';
}

/**
 * Marked Converted (by the rep, or on the stage dropdown) but not converted yet.
 *
 * An explicit `converted_to_customer: false` is the Super Admin's decision (↩ Lead):
 * the 28/29.09 builds wrote it and left the stage on "Converted", so a stage alone
 * would put every deliberately reverted lead back in the queue — and one "Convert all"
 * would re-convert it. Only a rep's fresh request (conversion_requested) queues it again.
 */
export function conversionPending(lead) {
  if (!lead || isCustomerLead(lead)) return false;
  return lead.conversion_requested === true || (isConvertedStage(lead.stage) && lead.converted_to_customer !== false);
}

/** The leads waiting for the Super Admin to convert them, oldest request first. */
export function conversionQueue(leads) {
  const when = (l) => s(l.conversion_requested_at || l.stage_updated_at || l.created_at);
  return arr(leads).filter(conversionPending).sort((a, b) => when(a).localeCompare(when(b)));
}

/** A rep marks a lead Converted: the stage moves, and the Super Admin is asked to convert it. */
export function requestConversion(leads, leadId, repId, { now = new Date() } = {}) {
  const at = now.toISOString();
  return arr(leads).map((l) => (l.id !== leadId ? l : {
    ...l,
    ...(isConvertedStage(l.stage) ? {} : { stage_before_conversion: s(l.stage) }),
    stage: 'Converted', stage_updated_at: at, stage_updated_by: repId,
    conversion_requested: true, conversion_requested_at: at, conversion_requested_by: repId,
  }));
}

/** The Super Admin converts: the flag every screen reads, who and when, and the request closed. */
export function convertLeads(leads, ids, { by = 'super_admin', now = new Date() } = {}) {
  const set = new Set(arr(ids));
  const at = now.toISOString();
  return arr(leads).map((l) => {
    if (!set.has(l.id)) return l;
    const stage = isConvertedStage(l.stage) ? {} : {
      stage_before_conversion: s(l.stage), stage: 'Converted', stage_updated_at: at, stage_updated_by: by,
    };
    return { ...l, ...stage, converted_to_customer: true, converted_at: at, converted_by: by, conversion_requested: false };
  });
}

/**
 * ↩ Lead: the conversion undone cleanly. The stage leaves "Converted" — back to what
 * it was before, else To Approach — so the lead does not land straight back in the
 * Super Admin's queue.
 */
export function revertLead(leads, leadId, { by = 'super_admin', now = new Date() } = {}) {
  const at = now.toISOString();
  return arr(leads).map((l) => {
    if (l.id !== leadId) return l;
    const before = s(l.stage_before_conversion);
    const stage = isConvertedStage(l.stage) ? (before && !isConvertedStage(before) ? before : 'To Approach') : l.stage;
    return {
      ...l, converted_to_customer: false, conversion_requested: false,
      stage, stage_updated_at: at, stage_updated_by: by, reverted_at: at, reverted_by: by,
    };
  });
}

/**
 * What a failed sales save says. Module 12 is written by seven roles, so a save that
 * lost the race (409) is common: the blob has already been reloaded by then, and the
 * person only needs to click again — it must never fail in silence.
 */
export function saveErrorText(e, what = 'Save') {
  if (e && (e.code === 'conflict' || e.status === 409)) {
    return 'The sales data was changed by someone else and has been reloaded — please click again.';
  }
  return what + ' failed: ' + ((e && e.message) || e);
}

/** The Customer Master rows of a customer, matched on the name (case and spacing ignored). */
export function masterRowsFor(name, customers) {
  const key = nameKey(name);
  if (!key) return [];
  return arr(customers).filter((c) => c && nameKey(c.customer) === key);
}

/** Whether a name is already in the Customer Master. */
export function inCustomerMaster(name, customers) {
  return masterRowsFor(name, customers).length > 0;
}

/** Two customer names that the Customer Master would treat as one. */
export function sameCustomerName(a, b) {
  return !!nameKey(a) && nameKey(a) === nameKey(b);
}

/**
 * The Customer Master rows a conversion adds: one per converted name that the master
 * does not have yet, so the sale-order screens can use it. Names already there are
 * left alone — converting twice never adds a duplicate row.
 */
export function customerRowsToAdd(leads, ids, customers) {
  const set = new Set(arr(ids));
  const have = new Set(arr(customers).map((c) => nameKey(c && c.customer)));
  const out = [];
  arr(leads).forEach((l) => {
    if (!l || !set.has(l.id)) return;
    const name = s(l.client_name);
    const key = nameKey(name);
    if (!key || have.has(key)) return;
    have.add(key);
    out.push({
      group: s(l.group), customer: name, dispatchLoc: s(l.delivery_location || l.deliveryLocation), warehouseName: '',
      billingAddr: '', shippingAddr: '', gstin: s(l.gstin), state: '',
      contactPerson: '', contactPhone: '', contactEmail: '', remarks: s(l.remarks),
    });
  });
  return out;
}

/** The list a Lead / Customer radio resolves to. */
export function pickerList(book, kind) {
  return kind === 'customer' ? book.customers : book.leads;
}

/**
 * Where a lead / customer takes delivery. A customer's despatch locations are the
 * Customer Master's (the Super Admin's) and nothing else; a lead not in the master
 * yet has the delivery location the rep wrote down, with the Super Admin's
 * Locations list behind it.
 */
export function despatchLocationsFor(lead, customers, extra = []) {
  return despatchLocationRowsFor(lead, customers, extra).map((r) => r.location);
}

/**
 * The same delivery points, but each with the WAREHOUSE that stands behind it.
 *
 * 28.09 §Superstar ¶1: "the despatch locations should be as per the despatch
 * locations that are populating in the Enter OAB. But here the warehouse name is not
 * visible." One customer can take delivery at the same town through two different
 * warehouses — Enter OAB has always shown "Dharapuram (Unit II)" and keyed the row by
 * both, while the rep's PO offered the bare town twice over with no way to tell them
 * apart. The warehouse now travels with the choice and onto the PO, so the Superstar
 * enters the order against the right one.
 *
 * Returns [{ location, warehouse, label, key }] — `key` identifies the ROW, the way
 * Enter OAB keys it, so two same-named towns stay two choices.
 */
export function despatchLocationRowsFor(lead, customers, extra = []) {
  const out = [];
  const seen = new Set();
  const push = (location, warehouse) => {
    const loc = s(location);
    if (!loc) return;
    const wh = s(warehouse);
    const key = loc + '||' + wh;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ location: loc, warehouse: wh, key, label: wh ? loc + ' (' + wh + ')' : loc });
  };
  if (lead) {
    // 30.09 §PE1: Kova Agro offered "DHARAPURAM (DHARAPURAM)", "DHARAPURAM (KOVAI
    // OWN)" and "Tirupur" — the third was the city the rep typed on the lead, which
    // the Super Admin's Customer Master does not have. When the master has the
    // customer, its rows are the whole answer: no lead city, no city list.
    masterRowsFor(lead.client_name, customers).forEach((l) => push(l.dispatchLoc, l.warehouseName));
    if (out.length) return out;
    push(lead.delivery_location, '');
  }
  arr(extra).forEach((v) => push(v, ''));
  return out;
}

/* ── the CSA requisition ────────────────────────────────────────────────── */

/**
 * The despatch-form specific fields the requisition carries, per form.
 *   roll         per reel kg · core width (mm) · reading direction · packing instructions
 *   pouch        pouch width (mm) · pouch height (mm) · packing instructions · other specs
 *   shrink       sleeve form: height · width · open width; roll form: core (mm) and
 *                metres per core OR kgs per core (which one, and how many)
 *   labels       labels in a bunch · labels per box · packing instructions
 *   bulk         side / bottom gusset · pouch width · gusset · pouch height — with the
 *                total gusset (×2 bottom, ×4 side) and the finished height / width worked out
 */
export const DESPATCH_FIELDS = {
  roll: [
    { k: 'per_reel_kg', label: 'Per reel (Kgs)', type: 'number', unit: 'Kgs' },
    { k: 'core_width_mm', label: 'Core width (mm)', type: 'number', unit: 'mm' },
    { k: 'reading_direction', label: 'Reading direction', type: 'select', options: ['Readable', 'Unreadable'] },
    { k: 'packing_instructions', label: 'Packing instructions', type: 'text' },
  ],
  pouch: [
    { k: 'pouch_width_mm', label: 'Pouch width end to end (mm)', type: 'number', unit: 'mm' },
    { k: 'pouch_height_mm', label: 'Pouch height end to end (mm)', type: 'number', unit: 'mm' },
    { k: 'packing_instructions', label: 'Packing instructions', type: 'text' },
    { k: 'other_specs', label: 'Other specifications', type: 'text' },
  ],
  shrink: [
    { k: 'sleeve_form', label: 'Form', type: 'radio', options: ['Sleeve form', 'Roll form'] },
    { k: 'sleeve_height_mm', label: 'Height of the sleeve (mm)', type: 'number', unit: 'mm', when: 'Sleeve form' },
    { k: 'sleeve_width_mm', label: 'Width of the sleeve (mm)', type: 'number', unit: 'mm', when: 'Sleeve form' },
    { k: 'open_width_mm', label: 'Open width (mm)', type: 'number', unit: 'mm', when: 'Sleeve form' },
    { k: 'core_mm', label: 'Core dimension (mm)', type: 'number', unit: 'mm', when: 'Roll form' },
    // 30.09 §SK2: "metres per core OR kgs per core" — a choice and a number, not free text
    { k: 'per_core_basis', label: 'Per core', type: 'radio', options: ['Metres per core', 'Kgs per core'], when: 'Roll form' },
    { k: 'per_core_qty', label: 'Metres / Kgs per core', type: 'number', when: 'Roll form' },
  ],
  labels: [
    { k: 'labels_per_bunch', label: 'Labels in a bunch', type: 'number' },
    { k: 'labels_per_box', label: 'Labels per box', type: 'number' },
    { k: 'packing_instructions', label: 'Packing instructions', type: 'text' },
  ],
  bulk: [
    { k: 'gusset_type', label: 'Gusset', type: 'radio', options: ['Side gusset', 'Bottom gusset'] },
    { k: 'pouch_width_mm', label: 'Pouch width (mm)', type: 'number', unit: 'mm' },
    { k: 'gusset_mm', label: 'Gusset (mm)', type: 'number', unit: 'mm' },
    { k: 'pouch_height_mm', label: 'Height of the pouch without gusset (mm)', type: 'number', unit: 'mm' },
  ],
};

/** Which field set a despatch-form name maps to (the Super Admin's names vary in case). */
export function despatchKind(form) {
  const f = lower(form);
  if (!f) return '';
  if (/shrink|sleeve/.test(f)) return 'shrink';
  if (/label/.test(f)) return 'labels';
  if (/bulk|bag/.test(f)) return 'bulk';
  if (/roll|reel/.test(f)) return 'roll';
  if (/pouch/.test(f)) return 'pouch';
  return 'other';
}

/**
 * The bulk-bag arithmetic, exactly as written: "total gusset will be calculated
 * × 2 if it is a bottom gusset, × 4 if it is a side gusset"; a bottom-gusset pouch is
 * height + gusset × 2 tall and as wide as typed; a side-gusset pouch is width +
 * gusset × 4 wide and as tall as typed.
 */
export function bulkBagTotals({ gusset_type, pouch_width_mm, gusset_mm, pouch_height_mm } = {}) {
  const side = /side/i.test(String(gusset_type || ''));
  const bottom = /bottom/i.test(String(gusset_type || ''));
  const w = n(pouch_width_mm), g = n(gusset_mm), h = n(pouch_height_mm);
  const totalGusset = side ? g * 4 : bottom ? g * 2 : 0;
  return {
    totalGusset,
    totalHeight: bottom ? h + g * 2 : h,
    totalWidth: side ? w + g * 4 : w,
  };
}

/**
 * Build the CSA requisition the rep sends to QC once the sample is in hand. Throws
 * with the missing field, so the screen says what to fill in. The despatch form is
 * the SKU's own; its specific fields are validated when they are numeric.
 */
export function buildCsaRequest(form, sku, { now = new Date(), user = '' } = {}) {
  if (!sku) throw new Error('Pick the SKU first.');
  if (!s(form.despatch_location)) throw new Error('Pick the despatch location.');
  if (!(n(form.tentative_qty) > 0)) throw new Error('Enter the tentative order quantity.');
  if (!s(form.tentative_date)) throw new Error('Pick the tentative despatch date.');
  if (!(n(form.target_price) > 0)) throw new Error('Enter the target price.');
  const kind = despatchKind(sku.dispatch_form || sku.dispatch_type);
  const sample = s(form.sample_received);
  return {
    despatch_location: s(form.despatch_location),
    // 28.09 §Superstar ¶1: the warehouse behind the town travels with it
    warehouse_name: s(form.warehouse_name),
    tentative_qty: n(form.tentative_qty),
    tentative_date: s(form.tentative_date),
    target_price: n(form.target_price),
    despatch_form: s(sku.dispatch_form || sku.dispatch_type),
    kind,
    details: despatchDetails(form, kind),
    ...(sample ? { sample_received: sample } : {}),
    sent_at: now.toISOString(),
    sent_by: user,
  };
}

/** The despatch-form specific values of a form, typed: numbers as numbers, the bulk-bag totals worked out. */
function despatchDetails(form, kind) {
  const fields = DESPATCH_FIELDS[kind] || [];
  const details = {};
  fields.forEach((f) => {
    const v = form[f.k];
    if (f.when && String(form[fields[0].k] || '') !== f.when) return;
    if (f.type === 'number') { if (v !== '' && v != null) details[f.k] = n(v); }
    else if (v != null && s(v)) details[f.k] = s(v);
  });
  // A shrink roll-form requisition sent before 30.09 §SK2 carried its per-core figure as
  // free text (`per_core`). Until the rep re-enters it as a basis + number it rides
  // along, instead of vanishing on the first edit of the SKU.
  if (kind === 'shrink' && s(form.per_core) && details.per_core_qty == null
    && String(form[fields[0].k] || '') === 'Roll form') details.per_core = s(form.per_core);
  if (kind === 'bulk') Object.assign(details, bulkBagTotals(details));
  return details;
}

/**
 * 30.09 §SK1-§SK3: the despatch details as the rep left them on the Add / Edit SKU
 * form — kept on the SKU whether or not it has gone to QC yet, so the edit radio
 * brings back what was typed. Nothing is required here (a draft can be half done);
 * the requisition itself is still validated by buildCsaRequest when it is sent.
 */
export function buildCsaDraft(form, dispatchForm, { now = new Date() } = {}) {
  const f = form || {};
  const kind = despatchKind(dispatchForm);
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : Number(v));
  return {
    despatch_location: s(f.despatch_location),
    warehouse_name: s(f.warehouse_name),
    tentative_qty: num(f.tentative_qty),
    tentative_date: s(f.tentative_date),
    target_price: num(f.target_price),
    despatch_form: s(dispatchForm),
    kind,
    details: despatchDetails(f, kind),
    saved_at: now.toISOString(),
  };
}

/**
 * The despatch details to put back into the form for a SKU: the draft when the rep
 * saved it after the last send, else what went to QC, else nothing.
 */
export function csaDetailsOf(sku) {
  const draft = sku && sku.csa_draft;
  const sent = sku && sku.csa_request;
  if (draft && sent) return s(draft.saved_at) >= s(sent.sent_at) ? draft : sent;
  return draft || sent || null;
}

/**
 * Mark the SKU as sent to QC for its CSA — what QC's pending list reads. A
 * requisition sent with no sample in hand (the rep said "No") does not claim one.
 */
export function sendSkuForCsa(skus, skuId, request) {
  const sample = !request || request.sample_received !== 'No';
  return arr(skus).map((sk) => (sk.id === skuId
    ? {
      ...sk,
      ...(sample ? { sample_received: 'Yes', sample_received_at: sk.sample_received_at || request.sent_at, sample_sent: 'Yes', sample_sent_at: request.sent_at } : {}),
      csa_requested: true, csa_request: request,
    }
    : sk));
}

/* ── quotations: the desk's price, the rep's price, sent, accepted ─────── */

/**
 * A minimum order quantity as the desk typed it — "1,00,000", "50000 nos",
 * "1 lakh", "25k" — read as a number. 0 when there is none.
 */
export function parseMoq(moq) {
  const t = lower(moq);
  if (!t) return 0;
  const num = Number(t.replace(/,/g, '').replace(/[^0-9.]/g, '')) || 0;
  if (/lakh|lac/.test(t)) return num * 100000;
  if (/\d\s*k\b|thousand/.test(t)) return num * 1000;
  return num;
}

/** The quotation record the latest desk quote came from (for the fine print / version). */
export function deskQuoteForSku(sales, skuId) {
  return arr(sales && sales.quotations)
    .filter((x) => arr(x.items).some((i) => i.sku_id === skuId))
    .sort((a, b) => (n(b.version) || 1) - (n(a.version) || 1))[0] || null;
}

/**
 * 30.09 QT4: the line the desk wrote for this SKU on its latest quotation — item
 * code, specifications, MOQ, plate charges, GST — so a quotation the rep prepares
 * from it prints complete instead of with blank specification and MOQ columns.
 */
export function deskItemForSku(sales, skuId) {
  const q = deskQuoteForSku(sales, skuId);
  return q ? (arr(q.items).find((i) => i.sku_id === skuId) || null) : null;
}

/**
 * The quote desk's price slabs for a SKU — the latest quotation that covers it —
 * as [{qty, price}] (price without GST), lowest quantity first. Empty when the
 * desk has not quoted it.
 *
 * 30.09 QT3: "no tiers = one price above MOQ". The desk quotes one flat price by
 * leaving the slab quantity blank (stored as 0) and typing the MOQ beside it, so a
 * slab with no quantity takes the desk's MOQ — otherwise the rep's table read
 * "MOQ 0" and the accepted price could not be matched to an order quantity.
 */
export function deskTiersForSku(sales, skuId) {
  const item = deskItemForSku(sales, skuId);
  if (!item) return [];
  const moq = parseMoq(item.moq);
  return arr(item.tiers).filter(Boolean)
    .map((t) => ({ qty: n(t.qty) || moq, price: n(t.price_wo_gst != null ? t.price_wo_gst : t.price) }))
    .filter((t) => t.price > 0)
    .sort((a, b) => a.qty - b.qty);
}

/**
 * The price the rep is currently quoting: their own saved slabs, else the desk's.
 *
 * 30.09 QT3: slabs the rep saved against an EARLIER desk quotation are not carried
 * onto a newer one — the desk re-quoted, so the rep starts again from the new
 * figure (and can never be left quoting under it).
 */
export function repTiersForSku(sku, deskTiers, deskQuote = null) {
  const rq = (sku && sku.rep_quote) || {};
  const own = arr(rq.tiers).filter((t) => t && n(t.qty) >= 0 && n(t.price) > 0);
  const stale = workedFromOlderDesk(rq.desk_quote_id, rq.saved_at, deskQuote);
  return own.length && !stale ? own.map((t) => ({ qty: n(t.qty), price: n(t.price) })) : deskTiers;
}

/** The id of the desk quotation the rep is working from ('' when the desk has not quoted). */
const deskQuoteId = (deskQuote) => s(deskQuote && deskQuote.id);

/**
 * Whether something the rep did (saved slabs, sent a quote) was done against an
 * earlier desk quotation than the current one.
 *
 * 30.09 QT3: this compared the rep's own clock (saved_at / sent_at) with the quote
 * desk machine's (created_at). A desk clock running ahead made a save or send made
 * just AFTER the desk's issue look older than it — the raised slabs silently gave way
 * to the desk floor, or a just-sent quote kept reading "To be sent". The desk
 * quotation the rep worked from is recorded now (`desk_quote_id`), so it is a plain
 * "is it still the same quotation?"; the timestamps are only a fallback for records
 * written before the id was.
 */
function workedFromOlderDesk(storedId, at, deskQuote) {
  if (storedId != null) return s(storedId) !== deskQuoteId(deskQuote);
  const deskAt = s(deskQuote && deskQuote.created_at);
  return !!(deskAt && s(at) && s(at) < deskAt);
}

/**
 * "The sales rep cannot decrease the quoted price below the amount received from
 * the quote login per MOQ." Throws naming the first slab under the floor; a SKU the
 * desk never priced (a manual quotation) has no floor.
 */
export function assertTiersAboveFloor(tiers, deskTiers) {
  arr(tiers).forEach((t) => {
    const floor = floorFor(deskTiers, n(t.qty));
    if (floor != null && n(t.price) < floor - 1e-9) {
      throw new Error(`₹${n(t.price)} for ${n(t.qty)} is below the quote desk's ₹${floor} for that quantity — the price can be raised, never lowered.`);
    }
  });
}

/**
 * Who the quotation goes to — the rep the Super Admin allocated, not whoever happened
 * to type the SKU in. 30.09 QT2: "the quotation goes to the rep per the SA customer
 * allocation."
 *
 *   1. the rep the lead's CATEGORY is assigned to (the SKU's category; for a SKU with
 *      none, the one rep all the lead's categories are assigned to)
 *   2. a lead split by category whose map does not name the SKU's category: one of
 *      the reps whose book holds the lead (leadOwnerIds — the rule leadsForRep uses):
 *      the category's own owner (categoryRep) when the category is one of the lead's,
 *      else the SKU's creator when they hold it, else the first of them
 *   3. the lead's KAM
 *   4. the lead's owner (assigned_to)
 *   5. the rep who created the SKU
 *
 * '' when nobody is allocated (a direct CSA for a customer no rep holds yet).
 *
 * Step 2 keeps the quotation in a book that has the lead: with a category map in
 * place, leadsForRep files the lead under its category owners only, so a quote sent
 * to assigned_to could reach a rep who cannot pick the customer on Enter PO.
 */
export function skuOwnerRep(sales, sku) {
  if (!sku) return '';
  const lead = arr(sales && sales.leads).find((l) => l && l.id === sku.lead_id) || null;
  const map = (lead && lead.category_assignments) || {};
  if (s(sku.category) && s(map[sku.category])) return s(map[sku.category]);
  if (!s(sku.category)) {
    const reps = [...new Set(Object.values(map).map(s).filter(Boolean))];
    if (reps.length === 1) return reps[0];
  }
  if (lead && Object.keys(map).length) {
    const owners = leadOwnerIds(lead);
    // the SKU's category is one of the lead's but unmapped: its owner by categoryRep
    // (the lead-level owner) — exactly whose book leadsForRep files it in
    const cat = s(sku.category);
    const viaCat = cat && leadCategories(lead).includes(cat) ? s(categoryRep(lead, cat)) : '';
    if (viaCat && owners.includes(viaCat)) return viaCat;
    const by = s(sku.created_by);
    if (by && owners.includes(by)) return by;
    if (owners.length) return owners[0];
  }
  if (lead && s(lead.kam)) return s(lead.kam);
  if (lead && s(lead.assigned_to)) return s(lead.assigned_to);
  const by = s(sku.created_by);
  return by && by !== 'quote' ? by : '';
}

/**
 * 30.09 QT2: "CSA without a sample is possible." A CSA QC raised directly names a
 * customer (or lead) and a job, but no SKU — and the desk can only quote a SKU, and a
 * rep only ever sees one. Linking it creates (or finds) both, once:
 *   · the lead, matched by name, else a new one — already a customer when QC picked
 *     it from the Customer Master
 *   · the SKU, carrying the report's job name, despatch form and structure, marked
 *     as having its CSA
 * and ties the report to them. A second call returns the same lead and SKU.
 * Returns { sales, leadId, skuId }.
 */
export function linkDirectCsa(sales, reportId, { now = new Date(), uid = salesUid } = {}) {
  const cur = sales || {};
  const report = arr(cur.qc_reports).find((r) => r && r.id === reportId);
  if (!report) throw new Error('That CSA report no longer exists.');
  const linkedSku = report.sku_id && arr(cur.skus).find((sk) => sk.id === report.sku_id);
  if (linkedSku) return { sales: cur, leadId: linkedSku.lead_id, skuId: linkedSku.id };

  const name = s(report.company_name);
  if (!name) throw new Error('The CSA report names no customer.');
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  let leads = arr(cur.leads);
  let lead = leads.find((l) => l && s(l.client_name).toLowerCase().replace(/[^a-z0-9]/g, '') === key) || null;
  const at = now.toISOString();
  if (!lead) {
    const customer = report.party_kind !== 'lead';
    lead = {
      id: uid('lead'), client_name: name, categories: [], category_assignments: {},
      // QC picked a customer from the Customer Master — it is a customer already,
      // not a lead waiting for the Super Admin to convert it
      stage: customer ? 'Converted' : 'To Approach', converted_to_customer: customer,
      created_by: 'quote', source: 'direct_csa', created_at: at,
    };
    leads = [...leads, lead];
  }
  let skus = arr(cur.skus);
  let sku = skus.find((sk) => sk && sk.csa_report_id === report.id) || null;
  if (!sku) {
    const cats = leadCategories(lead);
    sku = {
      id: uid('sku'), lead_id: lead.id, sku_name: s(report.product_desc) || 'Direct CSA',
      category: cats.length === 1 ? cats[0] : '',
      dispatch_form: s(report.dispatch_type),
      structure: [report.substrate1, report.substrate2, report.substrate3].map(s).filter(Boolean).join(' + '),
      csa_received: 'Yes', csa_report_id: report.id, csa_requested: false,
      sample_received: false, sample_sent: false, quotation_received: false, quotation_sent: false,
      quotation_accepted: false, price_tiers: [],
      created_by: 'quote', source: 'direct_csa', created_at: at,
    };
    skus = [...skus, sku];
  }
  const qc_reports = arr(cur.qc_reports).map((r) => (r.id === report.id ? { ...r, sku_id: sku.id, lead_id: lead.id } : r));
  return { sales: { ...cur, leads, skus, qc_reports }, leadId: lead.id, skuId: sku.id };
}

/** The floor for one slab: the desk's price for that quantity — the rep can never go below it. */
export function floorFor(deskTiers, qty) {
  if (!arr(deskTiers).length) return null;
  const sorted = deskTiers.slice().sort((a, b) => a.qty - b.qty);
  let applicable = sorted[0];
  sorted.forEach((t) => { if (t.qty <= n(qty)) applicable = t; });
  return applicable.price;
}

/**
 * "The quotation amount can be increased by the sales rep but cannot be decreased
 * … the sales rep cannot decrease the quoted price below the amount received from
 * the quote login per MOQ." Throws naming the slab that is under the floor.
 * A SKU with no desk quote (a manual quotation) has no floor.
 *
 * `deskQuote` is the desk quotation the slabs were worked from (deskQuoteForSku) — its
 * id is kept on the save, so a later desk re-quote, and nothing else, supersedes them.
 */
export function saveRepQuote(skus, skuId, tiers, deskTiers, { now = new Date(), user = '', deskQuote } = {}) {
  const clean = arr(tiers).map((t) => ({ qty: n(t.qty), price: n(t.price) })).filter((t) => t.price > 0);
  if (!clean.length) throw new Error('Enter at least one price slab (quantity and price).');
  assertTiersAboveFloor(clean, deskTiers);
  return arr(skus).map((sk) => {
    if (sk.id !== skuId) return sk;
    // 30.09 QT3: an amount edited after the quote went out has not reached the
    // customer — the SKU reads "to be sent" again until it is re-sent.
    const lastSent = arr(sk.quote_history)[0];
    const same = (a, b) => JSON.stringify(arr(a).map((t) => [n(t.qty), n(t.price)])) === JSON.stringify(arr(b).map((t) => [n(t.qty), n(t.price)]));
    const changedAfterSend = !!(sk.quotation_sent && !(lastSent && same(lastSent.tiers, clean)));
    return {
      ...sk,
      rep_quote: {
        tiers: clean, saved_at: now.toISOString(), saved_by: user, source: arr(deskTiers).length ? 'desk' : 'manual', changed_after_send: changedAfterSend,
        ...(deskQuote !== undefined ? { desk_quote_id: deskQuoteId(deskQuote), desk_version: deskQuote ? (n(deskQuote.version) || 1) : 0 } : {}),
      },
      quotation_received: sk.quotation_received || arr(deskTiers).length > 0,
      quote_status: sk.quote_status === 'accepted' ? 'accepted' : (sk.quotation_sent && !changedAfterSend ? 'sent' : 'to_send'),
    };
  });
}

/**
 * True while what the customer was sent is still the current quotation: it was
 * sent, the rep has not changed an amount since, and the desk has not re-quoted.
 */
export function quoteSentStill(sales, sku) {
  if (!sku || !sku.quotation_sent) return false;
  if (sku.rep_quote && sku.rep_quote.changed_after_send) return false;
  const last = arr(sku.quote_history)[0] || {};
  return !workedFromOlderDesk(last.desk_quote_id, sku.quotation_sent_at, deskQuoteForSku(sales, sku.id));
}

/** Where a SKU stands: 'none' (nothing to quote) · 'to_send' · 'sent' · 'accepted'. */
export function quoteStatusOf(sales, sku) {
  if (!sku) return 'none';
  if (sku.quotation_accepted) return 'accepted';
  const hasQuote = deskTiersForSku(sales, sku.id).length > 0 || arr(sku.rep_quote && sku.rep_quote.tiers).length > 0;
  if (!hasQuote) return 'none';
  return quoteSentStill(sales, sku) ? 'sent' : 'to_send';
}

/**
 * The SKUs the Quotations tab lists: everything the desk (or the rep, manually) has
 * priced, for the SKUs this rep is allocated (skuOwnerRep) — a lead split between
 * two reps by category shows each its own SKUs, and a SKU follows the lead when the
 * Super Admin moves it.
 */
export function quotableSkus(sales, repId) {
  if (!s(repId)) return [];
  return arr(sales && sales.skus)
    .filter((sk) => skuOwnerRep(sales, sk) === s(repId))
    .filter((sk) => quoteStatusOf(sales, sk) !== 'none');
}

/**
 * "Sent Quote": the SKUs go out to the customer at the rep's current slabs. Each
 * send is kept in the SKU's history ("each SKU can have a history of the
 * quotations that are sent"), newest first, and the status flips to sent. A slab
 * under the desk's current figure is refused, naming it.
 */
export function markQuotesSent(sales, skuIds, { now = new Date(), user = '' } = {}) {
  const ids = new Set(arr(skuIds));
  return arr(sales && sales.skus).map((sk) => {
    if (!ids.has(sk.id)) return sk;
    const desk = deskTiersForSku(sales, sk.id);
    const deskQuote = deskQuoteForSku(sales, sk.id);
    const tiers = repTiersForSku(sk, desk, deskQuote);
    try { assertTiersAboveFloor(tiers, desk); } catch (e) { throw new Error(`${sk.sku_name}: ${e.message}`); }
    // the desk quotation this send was made from — what quoteSentStill checks against
    const entry = { sent_at: now.toISOString(), sent_by: user, tiers, version: arr(sk.quote_history).length + 1, desk_quote_id: deskQuoteId(deskQuote) };
    return {
      ...sk,
      quotation_received: true,
      quotation_sent: true,
      quotation_sent_at: now.toISOString(),
      quote_status: sk.quotation_accepted ? 'accepted' : 'sent',
      quote_history: [entry, ...arr(sk.quote_history)],
      ...(sk.rep_quote ? { rep_quote: { ...sk.rep_quote, changed_after_send: false } } : {}),
    };
  });
}

/**
 * "Quote accepted yes / no": yes moves the SKU to the Quote Accepted table and fixes
 * the accepted slabs — the ones the PO is validated against (refused when a slab is
 * under the desk's current figure); no takes it back to sent (or to-send when it was
 * never sent).
 */
export function setQuoteAccepted(sales, skuId, accepted, { now = new Date() } = {}) {
  return arr(sales && sales.skus).map((sk) => {
    if (sk.id !== skuId) return sk;
    if (accepted) {
      const desk = deskTiersForSku(sales, sk.id);
      const tiers = repTiersForSku(sk, desk, deskQuoteForSku(sales, sk.id));
      try { assertTiersAboveFloor(tiers, desk); } catch (e) { throw new Error(`${sk.sku_name}: ${e.message}`); }
      return { ...sk, quotation_accepted: true, quotation_accepted_at: now.toISOString(), quotation_received: true, quote_status: 'accepted', price_tiers: tiers };
    }
    return { ...sk, quotation_accepted: false, quotation_accepted_at: '', quote_status: quoteSentStill(sales, sk) ? 'sent' : 'to_send' };
  });
}

/** The accepted SKUs of one customer that QC has already given a JSS — what a PO can be entered for. */
export function acceptedSkusForPo(sales, leadId) {
  return arr(sales && sales.skus).filter((sk) => sk.lead_id === leadId && sk.quotation_accepted && s(sk.jss_spec));
}

/** The accepted SKUs still waiting for QC to create their JSS. */
export function acceptedSkusWithoutJss(sales, leadId) {
  return arr(sales && sales.skus).filter((sk) => sk.lead_id === leadId && sk.quotation_accepted && !s(sk.jss_spec));
}

/** The price the accepted quotation gives an order quantity (quantity-based, else the flat price). */
export function acceptedPriceForQty(sku, qty) {
  return acceptedMinPrice(sku, qty);
}

/* ── the PO, with several SKUs ──────────────────────────────────────────── */

/**
 * One PO from the customer, several SKUs on it. Every line becomes its own row in
 * `pos` (the shape the targets and the Superstar already read), tied together by the
 * PO reference. Each line must carry a quantity, and its price may not fall below
 * the accepted slab for that quantity.
 */
export function buildPoLines({ leadId, customer, despatchLocation, warehouseName, poNumber, poDate, lines }, sales, repId, { now = new Date(), uid = salesUid } = {}) {
  if (!leadId) throw new Error('Select the customer.');
  if (!s(poNumber)) throw new Error('Enter the PO number.');
  if (!s(poDate)) throw new Error('Pick the PO date.');
  const usable = arr(lines).filter((l) => l && l.skuId);
  if (!usable.length) throw new Error('Add at least one SKU to the PO.');
  const seen = new Set();
  const ref = uid('poref');
  return usable.map((l) => {
    const sku = arr(sales && sales.skus).find((x) => x.id === l.skuId);
    if (!sku) throw new Error('That SKU no longer exists.');
    if (seen.has(sku.id)) throw new Error(`${sku.sku_name} is on the PO twice.`);
    seen.add(sku.id);
    if (!sku.quotation_accepted) throw new Error(`${sku.sku_name}: the quotation is not accepted yet.`);
    if (!s(sku.jss_spec)) throw new Error(`${sku.sku_name}: QC has not created the JSS yet.`);
    const q = n(l.qty);
    if (!(q > 0)) throw new Error(`${sku.sku_name}: enter the quantity.`);
    const min = acceptedPriceForQty(sku, q);
    const p = l.price === '' || l.price == null ? (min != null ? min : 0) : n(l.price);
    if (!(p > 0)) throw new Error(`${sku.sku_name}: no accepted price for ${q} — set the price.`);
    if (min != null && p < min - 1e-9) throw new Error(`${sku.sku_name}: ₹${p} is below the accepted ₹${min} for ${q}.`);
    return {
      id: uid('po'), po_ref: ref, lead_id: leadId, customer: s(customer), despatch_location: s(despatchLocation),
      // ¶1: the warehouse behind that town, so the Superstar enters the order against
      // the right one when a customer takes delivery at two warehouses in one place.
      warehouse_name: s(warehouseName),
      sku_id: sku.id, sku_name: sku.sku_name, jss_spec: s(sku.jss_spec), qty: q, price: p,
      po_number: s(poNumber), date: s(poDate) || salesToday(now),
      category: sku.category, dispatch_form: sku.dispatch_form || sku.dispatch_type,
      created_by: repId, created_at: now.toISOString(),
    };
  });
}

/**
 * The POs the Superstar has not yet pushed onto the OAB — one entry per PO (its
 * lines together), oldest first. "The POs entered by multiple sales reps will be
 * visible in the Superstar login under this PO to SO tab."
 */
export function pendingRepPos(sales) {
  const groups = new Map();
  arr(sales && sales.pos).forEach((p) => {
    if (!p || p.pushed_to_oab) return;
    const key = p.po_ref || p.id;
    if (!groups.has(key)) {
      groups.set(key, {
        key, po_number: p.po_number || '', date: p.date || '', customer: p.customer || '', lead_id: p.lead_id,
        despatch_location: p.despatch_location || '',
        // 30.09 PE3: the warehouse behind the town rides on to Add SO — it was written
        // onto every PO line but dropped here, so the Superstar's page never saw it.
        warehouse_name: p.warehouse_name || '',
        created_by: p.created_by, created_at: p.created_at, lines: [],
      });
    }
    groups.get(key).lines.push(p);
  });
  return [...groups.values()].sort((a, b) => s(a.created_at).localeCompare(s(b.created_at)));
}

/**
 * Stamp the PO lines as pushed onto the OAB, with the sale orders they became.
 * `soById` names each line's own sale order ({ [lineId]: '26/901' }); `so` is the
 * fallback for a line it does not name.
 */
export function markPosPushed(pos, ids, { so = '', soById = null, by = '', now = new Date() } = {}) {
  const set = new Set(arr(ids));
  return arr(pos).map((p) => (set.has(p.id)
    ? { ...p, pushed_to_oab: { so: (soById && soById[p.id]) || so, by, at: now.toISOString() } }
    : p));
}

/* ── costs (Log Visit → Admin Dashboard) ────────────────────────────────── */

/**
 * "Cost incurred to convert a customer" — the meeting / visit costs logged against
 * LEADS; "cost incurred to retain a customer" — the same against CUSTOMERS. Read off
 * the interactions, split by what the lead is today.
 */
export function costIncurred(sales, customers) {
  const lines = costLines(sales, customers);
  const convert = lines.filter((l) => l.kind === 'convert').reduce((t, l) => t + l.cost, 0);
  const retain = lines.filter((l) => l.kind === 'retain').reduce((t, l) => t + l.cost, 0);
  return { convert, retain, total: convert + retain };
}

/**
 * 28.09 §Sales ¶27: "Where are these listed? There should be a particular tab where
 * costs incurred for sales." The two totals on the Sales Admin dashboard were the only
 * place this money appeared, with no way to see what made them up.
 *
 * One row per logged visit or meeting that cost something, newest first:
 * who spent it, on whom, when, what kind of call it was, and whether it counts as
 * winning a customer (`convert`) or keeping one (`retain`).
 */
export function costLines(sales, customers) {
  const byId = new Map(arr(sales && sales.leads).map((l) => [l.id, l]));
  const out = [];
  arr(sales && sales.interactions).forEach((i) => {
    const cost = n(i && i.expense);
    if (!cost) return;
    const lead = byId.get(i && i.lead_id) || null;
    out.push({
      id: s(i.id) || String(out.length),
      date: s(i.date) || s(i.created_at).slice(0, 10),
      party: lead ? s(lead.client_name) : '—',
      group: lead ? s(lead.group) : '',
      kind: lead && isCustomerLead(lead, customers) ? 'retain' : 'convert',
      mode: s(i.mode) || s(i.type) || '—',
      rep: s(i.created_by) || s(i.rep) || '—',
      note: s(i.remarks) || s(i.note),
      cost,
    });
  });
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** Categories on a lead, editable by the rep for the leads they hold (Add Lead §3). */
export function setLeadCategories(leads, leadId, categories, repId) {
  const cats = arr(categories).filter(Boolean);
  return arr(leads).map((l) => {
    if (l.id !== leadId) return l;
    const assignments = { ...(l.category_assignments || {}) };
    cats.forEach((c) => { if (!assignments[c]) assignments[c] = repId; });
    Object.keys(assignments).forEach((c) => { if (!cats.includes(c) && String(assignments[c]) === String(repId)) delete assignments[c]; });
    return { ...l, categories: cats, category: cats[0] || '', category_assignments: assignments };
  });
}

/** A lead's categories as the rep sees them (all of them — the rep may add to what was assigned). */
export { leadCategories };
