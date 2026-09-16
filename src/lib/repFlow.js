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
import { salesUid, salesToday, leadsForRep, leadCategories } from './sales.js';
import { acceptedMinPrice } from './repPortal.js';
import { getCustLocations } from './master.js';

const s = (v) => String(v == null ? '' : v).trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const lower = (v) => s(v).toLowerCase();

/* ── lead or customer ───────────────────────────────────────────────────── */

/**
 * A lead is a CUSTOMER once the Super Admin has converted it (the Leads tab /
 * S Dashboard), or when the name is already in the Customer Master. "This
 * lead-to-customer change will only happen within the super admin login."
 */
export function isCustomerLead(lead, customers) {
  if (!lead) return false;
  if (lead.converted_to_customer) return true;
  const name = lower(lead.client_name);
  return !!name && arr(customers).some((c) => lower(c && c.customer) === name);
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
  const kamOf = arr(sales && sales.leads).filter((l) => l && String(l.kam || '') === String(repId) && !ids.has(l.id));
  const all = [...mine, ...kamOf];
  return {
    leads: all.filter((l) => !isCustomerLead(l, customers)),
    customers: all.filter((l) => isCustomerLead(l, customers)),
  };
}

/** The list a Lead / Customer radio resolves to. */
export function pickerList(book, kind) {
  return kind === 'customer' ? book.customers : book.leads;
}

/**
 * Where a lead / customer takes delivery. A customer's despatch locations are the
 * Customer Master's (the Super Admin's); a lead has the delivery location the rep
 * wrote down. The Super Admin's Locations list is offered behind both.
 */
export function despatchLocationsFor(lead, customers, extra = []) {
  const out = [];
  if (lead) {
    getCustLocations(customers, lead.client_name).forEach((l) => { const v = s(l && l.dispatchLoc); if (v && !out.includes(v)) out.push(v); });
    const own = s(lead.delivery_location);
    if (own && !out.includes(own)) out.push(own);
  }
  arr(extra).forEach((v) => { const t = s(v); if (t && !out.includes(t)) out.push(t); });
  return out;
}

/* ── the CSA requisition ────────────────────────────────────────────────── */

/**
 * The despatch-form specific fields the requisition carries, per form.
 *   roll         per reel kg · core width (mm) · reading direction · packing instructions
 *   pouch        pouch width (mm) · pouch height (mm) · packing instructions · other specs
 *   shrink       sleeve form: height · width · open width; roll form: core (mm) · metres or kg per core
 *   labels       labels in a bunch · labels per box · packing instructions
 *   bulk         side / bottom gusset · pouch width · gusset · pouch height — with the
 *                total gusset (×2 bottom, ×4 side) and the finished height / width worked out
 */
export const DESPATCH_FIELDS = {
  roll: [
    { k: 'per_reel_kg', label: 'Per reel (kg)', type: 'number' },
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
    { k: 'per_core', label: 'Metres or kg per core', type: 'text', when: 'Roll form' },
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
  const fields = DESPATCH_FIELDS[kind] || [];
  const details = {};
  fields.forEach((f) => {
    const v = form[f.k];
    if (f.when && String(form[fields[0].k] || '') !== f.when) return;
    if (f.type === 'number') { if (v !== '' && v != null) details[f.k] = n(v); }
    else if (v != null && s(v)) details[f.k] = s(v);
  });
  if (kind === 'bulk') Object.assign(details, bulkBagTotals(details));
  return {
    despatch_location: s(form.despatch_location),
    tentative_qty: n(form.tentative_qty),
    tentative_date: s(form.tentative_date),
    target_price: n(form.target_price),
    despatch_form: s(sku.dispatch_form || sku.dispatch_type),
    kind,
    details,
    sent_at: now.toISOString(),
    sent_by: user,
  };
}

/** Mark the SKU as sent to QC for its CSA — what QC's pending list reads. */
export function sendSkuForCsa(skus, skuId, request) {
  return arr(skus).map((sk) => (sk.id === skuId
    ? { ...sk, sample_received: 'Yes', sample_received_at: sk.sample_received_at || request.sent_at, sample_sent: 'Yes', sample_sent_at: request.sent_at, csa_requested: true, csa_request: request }
    : sk));
}

/* ── quotations: the desk's price, the rep's price, sent, accepted ─────── */

/**
 * The quote desk's price slabs for a SKU — the latest quotation that covers it —
 * as [{qty, price}] (price without GST), lowest quantity first. Empty when the
 * desk has not quoted it.
 */
export function deskTiersForSku(sales, skuId) {
  const q = arr(sales && sales.quotations)
    .filter((x) => arr(x.items).some((i) => i.sku_id === skuId))
    .sort((a, b) => (n(b.version) || 1) - (n(a.version) || 1))[0];
  if (!q) return [];
  const item = arr(q.items).find((i) => i.sku_id === skuId);
  return arr(item && item.tiers).filter(Boolean)
    .map((t) => ({ qty: n(t.qty), price: n(t.price_wo_gst != null ? t.price_wo_gst : t.price) }))
    .filter((t) => t.price > 0)
    .sort((a, b) => a.qty - b.qty);
}

/** The quotation record the latest desk quote came from (for the fine print / version). */
export function deskQuoteForSku(sales, skuId) {
  return arr(sales && sales.quotations)
    .filter((x) => arr(x.items).some((i) => i.sku_id === skuId))
    .sort((a, b) => (n(b.version) || 1) - (n(a.version) || 1))[0] || null;
}

/** The price the rep is currently quoting: their own saved slabs, else the desk's. */
export function repTiersForSku(sku, deskTiers) {
  const own = arr(sku && sku.rep_quote && sku.rep_quote.tiers).filter((t) => t && n(t.qty) >= 0 && n(t.price) > 0);
  return own.length ? own.map((t) => ({ qty: n(t.qty), price: n(t.price) })) : deskTiers;
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
 */
export function saveRepQuote(skus, skuId, tiers, deskTiers, { now = new Date(), user = '' } = {}) {
  const clean = arr(tiers).map((t) => ({ qty: n(t.qty), price: n(t.price) })).filter((t) => t.price > 0);
  if (!clean.length) throw new Error('Enter at least one price slab (quantity and price).');
  clean.forEach((t) => {
    const floor = floorFor(deskTiers, t.qty);
    if (floor != null && t.price < floor - 1e-9) {
      throw new Error(`₹${t.price} for ${t.qty} is below the quote desk's ₹${floor} for that quantity — the price can be raised, never lowered.`);
    }
  });
  return arr(skus).map((sk) => (sk.id === skuId
    ? { ...sk, rep_quote: { tiers: clean, saved_at: now.toISOString(), saved_by: user, source: arr(deskTiers).length ? 'desk' : 'manual' },
      quotation_received: sk.quotation_received || arr(deskTiers).length > 0, quote_status: sk.quote_status === 'accepted' ? 'accepted' : 'to_send' }
    : sk));
}

/** Where a SKU stands: 'none' (nothing to quote) · 'to_send' · 'sent' · 'accepted'. */
export function quoteStatusOf(sales, sku) {
  if (!sku) return 'none';
  if (sku.quotation_accepted) return 'accepted';
  const hasQuote = deskTiersForSku(sales, sku.id).length > 0 || arr(sku.rep_quote && sku.rep_quote.tiers).length > 0;
  if (!hasQuote) return 'none';
  return sku.quotation_sent ? 'sent' : 'to_send';
}

/** The SKUs the Quotations tab lists: everything the desk (or the rep, manually) has priced, for the rep's own book. */
export function quotableSkus(sales, repId, bookIds) {
  return arr(sales && sales.skus)
    .filter((sk) => (sk.created_by === repId || (bookIds && bookIds.has(sk.lead_id))))
    .filter((sk) => quoteStatusOf(sales, sk) !== 'none');
}

/**
 * "Sent Quote": the SKUs go out to the customer at the rep's current slabs. Each
 * send is kept in the SKU's history ("each SKU can have a history of the
 * quotations that are sent"), newest first, and the status flips to sent.
 */
export function markQuotesSent(sales, skuIds, { now = new Date(), user = '' } = {}) {
  const ids = new Set(arr(skuIds));
  return arr(sales && sales.skus).map((sk) => {
    if (!ids.has(sk.id)) return sk;
    const tiers = repTiersForSku(sk, deskTiersForSku(sales, sk.id));
    const entry = { sent_at: now.toISOString(), sent_by: user, tiers, version: arr(sk.quote_history).length + 1 };
    return {
      ...sk,
      quotation_received: true,
      quotation_sent: true,
      quotation_sent_at: now.toISOString(),
      quote_status: sk.quotation_accepted ? 'accepted' : 'sent',
      quote_history: [entry, ...arr(sk.quote_history)],
    };
  });
}

/**
 * "Quote accepted yes / no": yes moves the SKU to the Quote Accepted table and fixes
 * the accepted slabs — the ones the PO is validated against; no takes it back to
 * sent (or to-send when it was never sent).
 */
export function setQuoteAccepted(sales, skuId, accepted, { now = new Date() } = {}) {
  return arr(sales && sales.skus).map((sk) => {
    if (sk.id !== skuId) return sk;
    if (accepted) {
      const tiers = repTiersForSku(sk, deskTiersForSku(sales, sk.id));
      return { ...sk, quotation_accepted: true, quotation_accepted_at: now.toISOString(), quotation_received: true, quote_status: 'accepted', price_tiers: tiers };
    }
    return { ...sk, quotation_accepted: false, quotation_accepted_at: '', quote_status: sk.quotation_sent ? 'sent' : 'to_send' };
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
export function buildPoLines({ leadId, customer, despatchLocation, poNumber, poDate, lines }, sales, repId, { now = new Date(), uid = salesUid } = {}) {
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
        despatch_location: p.despatch_location || '', created_by: p.created_by, created_at: p.created_at, lines: [],
      });
    }
    groups.get(key).lines.push(p);
  });
  return [...groups.values()].sort((a, b) => s(a.created_at).localeCompare(s(b.created_at)));
}

/** Stamp the PO lines as pushed onto the OAB, with the sale orders they became. */
export function markPosPushed(pos, ids, { so = '', by = '', now = new Date() } = {}) {
  const set = new Set(arr(ids));
  return arr(pos).map((p) => (set.has(p.id) ? { ...p, pushed_to_oab: { so, by, at: now.toISOString() } } : p));
}

/* ── costs (Log Visit → Admin Dashboard) ────────────────────────────────── */

/**
 * "Cost incurred to convert a customer" — the meeting / visit costs logged against
 * LEADS; "cost incurred to retain a customer" — the same against CUSTOMERS. Read off
 * the interactions, split by what the lead is today.
 */
export function costIncurred(sales, customers) {
  const byId = new Map(arr(sales && sales.leads).map((l) => [l.id, l]));
  let convert = 0, retain = 0;
  arr(sales && sales.interactions).forEach((i) => {
    const cost = n(i && i.expense);
    if (!cost) return;
    const lead = byId.get(i.lead_id);
    if (lead && isCustomerLead(lead, customers)) retain += cost; else convert += cost;
  });
  return { convert, retain, total: convert + retain };
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
