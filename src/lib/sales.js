// Sales system (module 12) — shared pure logic for the three sales surfaces:
// the Sales Rep Portal, the Quotation Desk and the Sales Admin dashboard.
//
// The blob holds parallel lists rather than a nested tree:
//   leads[]          customers/prospects, each with categories and per-category
//                    rep assignment  { id, client_name, group, categories[],
//                    category_assignments{cat:repId}, stage, payment_type, ... }
//   contacts[]       people at a lead   { id, lead_id, name, categories[], ... }
//   interactions[]   dated touch-points { id, lead_id, date, type, outcome,
//                                         follow_up_date, created_by }
//   sales_users[]    reps              { id, username, display_name, status }
//   quotations[]     quotes            { id, lead_id, sku, rate, status, ... }
//   skus[] qc_reports[] pos[] targets[] substrate_options[] nego_msgs[]
//
// ALLOCATION IS PER CATEGORY, not per customer: two reps can share one customer
// while each owns a different product line. Every "mine" filter below therefore
// works off category_assignments, falling back to the lead-level assigned_to for
// records created before per-category allocation existed.

const s = (v) => String(v == null ? '' : v).trim();
const arr = (v) => (Array.isArray(v) ? v : []);

/* ── constants (mirrors of the monolith's REP_* / SDASH_* lists) ────────── */

export const REP_STATUSES = ['Hot', 'Warm', 'Cold', 'To Approach', 'Converted', 'Cannot Convert'];

export const REP_PAYTYPES = [
  ['A+', 'A+ — Excellent (pay master)'],
  ['A', 'A — Good pay master'],
  ['B', 'B — One nudge needed'],
  ['C', 'C — Two nudges needed'],
  ['D', 'D — Do not enter'],
];

export const REP_CATEGORIES = [
  'Dairy', 'Namkeen', 'Sanitary Pads', 'Pet Food', 'Ice Creams', 'Staples', 'Oil',
  'Frozen Meat', 'Frozen Food', 'Spices', 'Confectionery', 'Shopping Bags', 'Paan Masala', 'F&V',
];

/** Stage → badge palette. (sdashStageBadge 9197) */
export const STAGE_STYLE = {
  Hot: { background: '#fde8e8', color: '#c0392b' },
  Warm: { background: '#fdf3d6', color: '#8a6d00' },
  Cold: { background: '#e6f0fb', color: '#1d4e89' },
  'To Approach': { background: '#ede7f6', color: '#5e35b1' },
  Converted: { background: '#e3f7e9', color: '#0e6fb8' },
  'Cannot Convert': { background: '#eceff1', color: '#607d8b' },
};

/** Payment grade → badge palette. (sdashPayBadge 9203) */
export const PAY_STYLE = {
  'A+': { background: '#e3f7e9', color: '#0e6fb8' },
  A: { background: '#e8f0fe', color: '#1a4fa0' },
  B: { background: '#fdf3d6', color: '#8a6d00' },
  C: { background: '#fde8e8', color: '#c0392b' },
  D: { background: '#333', color: '#fff' },
};

/* ── ids and dates ──────────────────────────────────────────────────────── */

/** Client-generated id, matching the legacy repUid format. */
export function salesUid(prefix, now = Date.now(), rand = Math.random) {
  return `${prefix}_${now}_${rand().toString(36).slice(2, 8)}`;
}

/** Today as YYYY-MM-DD. */
export function salesToday(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** `n` days from today as YYYY-MM-DD. (repDatePlus) */
export function datePlus(n, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  return salesToday(d);
}

/** Whole days between two YYYY-MM-DD dates, or null if either is missing. */
export function daysBetween(a, b) {
  if (!a || !b) return null;
  const d = Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
  return d < 0 ? 0 : d;
}

/** Whole days from a date until today (never negative). (sdashDaysSinceNow 9200) */
export function daysSince(a, now = Date.now()) {
  if (!a) return null;
  const d = Math.floor((now - new Date(a).getTime()) / 86400000);
  return d < 0 ? 0 : d;
}

/**
 * How a scheduled follow-up reads today. (repDueBadge 14400)
 * Returns { kind, label } — kind ∈ overdue|today|tomorrow|soon|later|none.
 */
export function followUpState(date, today = salesToday()) {
  if (!date) return { kind: 'none', label: '—' };
  if (date < today) return { kind: 'overdue', label: '⚠ Overdue' };
  if (date === today) return { kind: 'today', label: '● Ping Today' };
  if (date === datePlus(1)) return { kind: 'tomorrow', label: 'Ping Tomorrow' };
  if (date === datePlus(2)) return { kind: 'soon', label: 'Ping in 2 days' };
  return { kind: 'later', label: date };
}

export const FOLLOW_UP_STYLE = {
  overdue: { background: '#fde8e8', color: '#c0392b' },
  today: { background: '#fdf3d6', color: '#8a6d00' },
  tomorrow: { background: '#e6f0fb', color: '#1a4fa0' },
  soon: { background: '#eef2ff', color: '#3730a3' },
  later: { background: 'transparent', color: '#888' },
  none: { background: 'transparent', color: '#aaa' },
};

/* ── leads ──────────────────────────────────────────────────────────────── */

/** A lead's categories, tolerating the pre-multi-category `category` field. (repCats) */
export function leadCategories(lead) {
  const cats = arr(lead && lead.categories).filter(Boolean);
  if (cats.length) return cats;
  const one = s(lead && lead.category);
  return one ? [one] : [];
}

/** The rep who owns one category of a lead. (sdashLineRep 9524) */
export function categoryRep(lead, category) {
  const map = (lead && lead.category_assignments) || {};
  return map[category] || (lead && lead.assigned_to) || '';
}

/** Categories of a lead assigned to a given rep. */
export function repCategoriesOf(lead, repId) {
  if (!repId) return [];
  return leadCategories(lead).filter((c) => String(categoryRep(lead, c)) === String(repId));
}

/**
 * Leads a rep can see: any lead where they own at least one category, or — for
 * older records with no per-category map — where they are the lead-level owner.
 */
export function leadsForRep(leads, repId) {
  if (!repId) return [];
  return arr(leads).filter((l) => {
    if (repCategoriesOf(l, repId).length) return true;
    const map = (l && l.category_assignments) || {};
    return Object.keys(map).length === 0 && String(l.assigned_to) === String(repId);
  });
}

/** Active reps only. (sdashActiveReps 9195) */
export function activeReps(salesUsers) {
  return arr(salesUsers).filter((r) => (r.status || (r.disabled ? 'Inactive' : 'Active')) === 'Active');
}

/** Display name for a rep id. (sdashRepName 9193) */
export function repName(salesUsers, id) {
  const r = arr(salesUsers).find((x) => String(x.id) === String(id));
  return r ? (r.display_name || r.username || String(id)) : '—';
}

/** Contacts belonging to a lead. */
export function contactsForLead(contacts, leadId) {
  return arr(contacts).filter((c) => String(c.lead_id) === String(leadId));
}

/** Interactions for a lead, newest first. */
export function interactionsForLead(interactions, leadId) {
  return arr(interactions)
    .filter((i) => String(i.lead_id) === String(leadId))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

/**
 * The follow-up that matters for a lead: the soonest dated one still in the
 * future, else the most overdue. Falls back to the lead's own
 * `next_follow_up_date` when no interaction carries one.
 */
export function nextFollowUp(lead, interactions) {
  const dates = arr(interactions)
    .filter((i) => String(i.lead_id) === String(lead && lead.id) && i.follow_up_date)
    .map((i) => i.follow_up_date)
    .concat(lead && lead.next_follow_up_date ? [lead.next_follow_up_date] : [])
    .sort();
  return dates.length ? dates[0] : '';
}

/**
 * Build a new lead record from the Add-Customer form. (repSaveLead 14684)
 * Throws when the two required fields are missing, so the caller can show the
 * message rather than silently writing a half-formed record.
 */
export function buildLead(form, repId, { now = new Date(), uid = salesUid } = {}) {
  const customer = s(form.customer);
  const categories = arr(form.categories).filter(Boolean);
  if (!customer) throw new Error('Customer is required.');
  if (!categories.length) throw new Error('Select at least one category.');

  // Every category the rep enters is allocated to them by default.
  const assignments = {};
  categories.forEach((c) => { assignments[c] = repId; });

  return {
    id: uid('lead'),
    client_name: customer,
    group: s(form.group),
    categories,
    category: categories[0],
    head_office: s(form.headOffice),
    delivery_location: s(form.deliveryLocation),
    city: s(form.headOffice),
    gstin: s(form.gstin),
    payment_type: s(form.paymentType),
    stage: s(form.stage) || 'To Approach',
    created_by: repId,
    assigned_to: repId,
    category_assignments: assignments,
    category_dispatch_forms: form.dispatchForms || {},
    next_follow_up_date: s(form.followUp),
    created_at: now.toISOString(),
  };
}

/** An interaction row recording a scheduled follow-up. */
export function buildInteraction(leadId, repId, { date, type, outcome, followUp } = {}, { uid = salesUid } = {}) {
  return {
    id: uid('inter'),
    lead_id: leadId,
    date: date || salesToday(),
    type: type || 'Follow-up scheduled',
    outcome: s(outcome),
    follow_up_date: s(followUp),
    created_by: repId,
  };
}

/* ── pipeline rollups ───────────────────────────────────────────────────── */

/** Lead counts by stage, in the canonical stage order. */
export function pipelineByStage(leads) {
  const counts = {};
  arr(leads).forEach((l) => { const st = s(l.stage) || 'To Approach'; counts[st] = (counts[st] || 0) + 1; });
  const ordered = REP_STATUSES.filter((st) => counts[st]).map((st) => ({ stage: st, count: counts[st] }));
  // Anything with a stage outside the known list still has to be visible.
  Object.keys(counts).filter((st) => !REP_STATUSES.includes(st))
    .forEach((st) => ordered.push({ stage: st, count: counts[st] }));
  return ordered;
}

/**
 * Per-rep workload: how many leads and categories each active rep owns, and how
 * many of their follow-ups are overdue. Drives the Sales Admin overview.
 */
export function repWorkload(leads, salesUsers, interactions, today = salesToday()) {
  return activeReps(salesUsers).map((rep) => {
    const mine = leadsForRep(leads, rep.id);
    const lines = mine.reduce((n, l) => n + repCategoriesOf(l, rep.id).length, 0);
    const overdue = mine.filter((l) => {
      const d = nextFollowUp(l, interactions);
      return d && d < today;
    }).length;
    const converted = mine.filter((l) => l.stage === 'Converted').length;
    return { id: rep.id, name: rep.display_name || rep.username, leads: mine.length, lines, overdue, converted };
  }).sort((a, b) => b.leads - a.leads);
}

/**
 * Leads needing attention now — overdue or due today — newest-overdue first.
 * (sdashNudgeRows 9229)
 */
export function nudgeList(leads, interactions, today = salesToday()) {
  return arr(leads)
    .map((l) => ({ lead: l, due: nextFollowUp(l, interactions) }))
    .filter((x) => x.due && x.due <= today)
    .sort((a, b) => String(a.due).localeCompare(String(b.due)));
}

/* ── quotations ─────────────────────────────────────────────────────────── */

/** Quotations for a lead, newest first. */
export function quotesForLead(quotations, leadId) {
  return arr(quotations)
    .filter((q) => String(q.lead_id) === String(leadId))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/**
 * The lowest rate the customer has already accepted for a SKU — the floor a new
 * quote should not silently undercut. (repAcceptedMinPrice 14520)
 */
export function acceptedMinPrice(quotations, leadId, sku) {
  const rates = arr(quotations)
    .filter((q) => String(q.lead_id) === String(leadId) && s(q.sku) === s(sku) && q.status === 'Accepted')
    .map((q) => Number(q.rate) || 0)
    .filter((r) => r > 0);
  return rates.length ? Math.min(...rates) : null;
}

/** Quote counts by status, for the desk's header. */
export function quoteStatusCounts(quotations) {
  const out = {};
  arr(quotations).forEach((q) => { const st = s(q.status) || 'Draft'; out[st] = (out[st] || 0) + 1; });
  return out;
}

/* ── quotation building ─────────────────────────────────────────────────── */

export const DEFAULT_GST_PCT = 18;

/**
 * Price slab with GST worked out. A blank GST means 18% — the monolith's
 * default — rather than zero, which would quietly under-quote the tax.
 * Rounded to paise at each step, matching the legacy arithmetic.
 */
export function buildTier(qty, priceWoGst, gstPct = DEFAULT_GST_PCT) {
  // Number('') is 0, so a blank field must be rejected BEFORE coercion — otherwise
  // an empty price quotes zero rupees and an empty GST quotes zero tax.
  const blank = (v) => v === '' || v === null || v === undefined;
  if (blank(priceWoGst)) return null;
  const price = Number(priceWoGst);
  if (!Number.isFinite(price) || price < 0) return null;   // negative is not a slab
  const pct = (!blank(gstPct) && Number(gstPct) >= 0) ? Number(gstPct) : DEFAULT_GST_PCT;
  const gstAmt = Math.round((price * pct / 100) * 100) / 100;
  return {
    qty: Number(qty) || 0,
    price_wo_gst: price,
    gst_pct: pct,
    gst_amt: gstAmt,
    price_w_gst: Math.round((price + gstAmt) * 100) / 100,
  };
}

/** Plate cost = per-plate × count, for both printing types. (pmPlatesTotal 6380) */
export function platesTotal(plate) {
  if (!plate) return 0;
  const n = (v) => Number(v) || 0;
  return Math.round(n(plate.ci_per) * n(plate.ci_n) + n(plate.off_per) * n(plate.off_n));
}

/**
 * Next version number for a customer's quote. Versions are per LEAD, not global,
 * so two customers can both be on v1. (qtGenerate 15721)
 */
export function nextQuoteVersion(quotations, leadId) {
  const max = arr(quotations)
    .filter((q) => String(q.lead_id) === String(leadId))
    .reduce((m, q) => Math.max(m, Number(q.version) || 1), 0);
  return max + 1;
}

/**
 * Assemble a quotation from the desk form. Items with no usable price slab are
 * dropped — quoting a SKU with no price would produce a meaningless document.
 * Throws when nothing quotable remains, so the caller shows the reason.
 */
export function buildQuotation({ leadId, clientName, items, header = {}, finePrint = {} }, quotations, { now = new Date(), uid = salesUid } = {}) {
  if (!leadId) throw new Error('Select a customer.');
  const usable = arr(items)
    .map((it) => ({ ...it, tiers: arr(it.tiers).filter(Boolean) }))
    .filter((it) => it.tiers.length);
  if (!usable.length) throw new Error('Enter at least one price slab for a selected SKU.');

  return {
    id: uid('qt'),
    lead_id: leadId,
    client_name: clientName || '',
    date: salesToday(now),
    version: nextQuoteVersion(quotations, leadId),
    status: 'sent',
    created_by: 'quote',
    created_at: now.toISOString(),
    items: usable,
    rm_snapshot: s(header.rmSnapshot),
    ink_cost: s(header.inkCost),
    wastage: s(header.wastage),
    notes: s(header.notes),
    fine_print: {
      greeting: s(finePrint.greeting), value_add: s(finePrint.valueAdd), terms: s(finePrint.terms),
      basic_note: s(finePrint.basicNote), service: s(finePrint.service),
    },
  };
}

/**
 * Side-effects of issuing a quote: the CSA reports for the quoted SKUs move to
 * "Quoted", and the rep's SKUs are flagged so the rep sees the quote arrived.
 * Returns the patched lists; callers merge them into one save. (qtGenerate 15730)
 */
export function applyQuoteSideEffects(quote, { qcReports, skus }) {
  const quoted = new Set(arr(quote.items).map((i) => i.sku_id));
  return {
    qc_reports: arr(qcReports).map((r) => (quoted.has(r.sku_id) ? { ...r, status: 'Quoted', needs_quote_review: false } : r)),
    skus: arr(skus).map((sk) => (quoted.has(sk.id) && !sk.quotation_sent
      ? { ...sk, quotation_received: true, quotation_received_at: new Date().toISOString() }
      : sk)),
  };
}

/** Quotes for the desk list, newest first. */
export function allQuotes(quotations) {
  return arr(quotations).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/** Freeze a quote so it can no longer be superseded silently. (qtFreeze 15742) */
export function freezeQuote(quotations, quoteId) {
  return arr(quotations).map((q) => (q.id === quoteId ? { ...q, status: 'final' } : q));
}

/* ── Sales Admin: allocation ────────────────────────────────────────────── */

/**
 * Flatten leads into the LINE ITEMS the admin actually allocates: one row per
 * (lead × category), each carrying the rep currently assigned to that line.
 * (sdashLeadDBFilter 9524)
 */
export function leadLineItems(leads, { contacts = [] } = {}) {
  const out = [];
  arr(leads).forEach((l) => {
    leadCategories(l).forEach((c) => {
      out.push({
        key: `${l.id}|~|${c}`,
        leadId: l.id,
        lead: l,
        client_name: l.client_name,
        category: c,
        repId: categoryRep(l, c),
        stage: l.stage || '',
        contacts: arr(contacts).filter((cc) => cc.lead_id === l.id && (!cc.category || cc.category === c)).length,
      });
    });
  });
  return out;
}

/** Every category in use across the lead book, sorted. */
export function allCategories(leads) {
  return [...new Set(arr(leads).flatMap(leadCategories))].sort((a, b) => String(a).localeCompare(String(b)));
}

/**
 * Assign one line item to a rep (or to nobody when repId is blank).
 * Returns a NEW leads array. Assigning writes the per-category map rather than
 * the lead-level owner, so the other categories of a shared customer are
 * untouched. (sdashAssignLine 9560)
 */
export function assignLine(leads, leadId, category, repId) {
  return arr(leads).map((l) => {
    if (l.id !== leadId) return l;
    const next = { ...(l.category_assignments || {}) };
    if (repId) next[category] = repId; else delete next[category];
    return { ...l, category_assignments: next };
  });
}

/** Assign many line items at once, given their `key` values. (sdashBulkAssign) */
export function bulkAssignLines(leads, keys, repId) {
  return arr(keys).reduce((acc, key) => {
    const i = String(key).indexOf('|~|');
    if (i < 0) return acc;
    return assignLine(acc, String(key).slice(0, i), String(key).slice(i + 3), repId);
  }, arr(leads));
}

/**
 * Filter line items for the allocation table. A rep filter of UNASSIGNED shows
 * only lines with nobody on them — the queue the admin is trying to clear.
 */
export const UNASSIGNED = '__unassigned__';

export function filterLineItems(items, { q = '', category = '', repId = '' } = {}) {
  const t = q.trim().toLowerCase();
  return arr(items).filter((it) => {
    if (t && !String(it.client_name || '').toLowerCase().includes(t)) return false;
    if (category && it.category !== category) return false;
    if (repId === UNASSIGNED) return !it.repId;
    if (repId && String(it.repId) !== String(repId)) return false;
    return true;
  });
}

/* ── Sales Admin: rep accounts ──────────────────────────────────────────── */

export const REP_ACCOUNT_STATUSES = ['Active', 'Inactive', 'Left'];

/**
 * §36 module-wise allocation: the Sales Portal modules a rep can be granted.
 * Keys match the RepPortal tab keys. A rep with no explicit allocation sees all.
 */
export const REP_MODULES = [
  { k: 'followups', label: 'Follow-ups' },
  { k: 'visit', label: 'Log Visit' },
  { k: 'po', label: 'Enter PO' },
  { k: 'targets', label: 'My Targets' },
  { k: 'customers', label: 'My Customers' },
  { k: 'contacts', label: 'My Contacts' },
  { k: 'add', label: 'Add Customer' },
  { k: 'sku', label: 'SKUs' },
  { k: 'nego', label: 'Negotiations' },
];

/** The module keys a rep may use (no allocation stored = every module). */
export function repModulesOf(rep) {
  return Array.isArray(rep?.modules) && rep.modules.length ? rep.modules : REP_MODULES.map((m) => m.k);
}

/**
 * Add a sales-rep login to the blob. Usernames must be unique — the rep-login
 * endpoint matches on username, so a duplicate would make one account
 * unreachable. (sdashAddRep 9950)
 *
 * NOTE: the password is stored in clear text because that is what
 * /api/auth/sales-rep-login compares against. Hashing needs a matching backend
 * change; see MIGRATION.md.
 */
export function addRep(salesUsers, { name, username, password, phone, status, modules } = {}, { uid = salesUid } = {}) {
  const display = s(name);
  const user = s(username);
  if (!display) throw new Error('Full name is required.');
  if (!user) throw new Error('Username is required.');
  if (!s(password)) throw new Error('Password is required.');
  if (arr(salesUsers).some((r) => s(r.username).toLowerCase() === user.toLowerCase())) {
    throw new Error(`Username '${user}' is already taken.`);
  }
  return [...arr(salesUsers), {
    id: uid('rep'),
    display_name: display,
    username: user,
    password: String(password),
    phone: s(phone),
    status: REP_ACCOUNT_STATUSES.includes(status) ? status : 'Active',
    // §36: module-wise allocation (empty/absent = all modules).
    ...(Array.isArray(modules) && modules.length ? { modules } : {}),
  }];
}

/** Edit a rep in place. Returns a NEW array. */
export function updateRep(salesUsers, id, patch) {
  return arr(salesUsers).map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/* ── Sales Admin: overview ──────────────────────────────────────────────── */

/**
 * Headline numbers for the admin overview. (sdashOverview 9257)
 *
 * "Converted" is deliberately defined as *customers we have received at least
 * one PO from*, not the count of leads whose stage says Converted — a stage is
 * a rep's opinion, a PO is evidence.
 */
export function salesOverview(sales, today = salesToday()) {
  const leads = arr(sales.leads);
  const pos = arr(sales.pos);
  const interactions = arr(sales.interactions);
  const withPo = new Set(pos.map((p) => p.lead_id));
  const byStage = (st) => leads.filter((l) => l.stage === st).length;
  return {
    total: leads.length,
    hot: byStage('Hot'),
    warm: byStage('Warm'),
    cold: byStage('Cold'),
    toApproach: byStage('To Approach'),
    converted: leads.filter((l) => withPo.has(l.id)).length,
    posReceived: pos.length,
    todaysActivities: interactions.filter((i) => String(i.date || '').slice(0, 10) === today).length,
    unallocated: leadLineItems(leads).filter((it) => !it.repId).length,
  };
}

/* ── Sales Admin: targets ───────────────────────────────────────────────── */
// The target MODEL lives in ./salesTargets.js — it is dimensioned (per category and
// per dispatch form) and spans four period types, because that is what production
// stores and what the rep portal reads. A single flat monthly figure cannot express
// it, so there is deliberately no such helper here.

/** YYYY-MM key for a date. */
export function monthKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
