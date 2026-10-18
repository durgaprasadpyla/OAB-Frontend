// Lead List import — the sales team's "TOOL FORMAT" sheet into module 12.
//
// One row of the sheet is one CONTACT at a company; a company with three people on
// it is three rows. So the rows are grouped by company into one lead each, and every
// person becomes a contact under it (sales.contacts, linked by lead_id) — the same
// two records a rep makes by hand with Add Customer and My Contacts.
//
// The sheet is typed by people: "WARM", "APPROACH", "DAIRY", "Other", "PRIMARY",
// "Filler Swiggy". Each column is mapped onto the app's own lists; what cannot be
// mapped is kept as typed rather than dropped, and the preview says so.
//
// Ownership is by rep id, never by name: the "Lead Name" column ("Senthil",
// "Pradeep") is matched to a sales user once, in the preview, where the admin can
// change it — and a blank Lead Name goes to whoever they choose, or nobody.

import { REP_STATUSES, REP_CATEGORIES, salesUid } from './sales.js';
import { requestConversion } from './repFlow.js';
import { DD_DEFAULTS } from './dropdowns.js';

const s = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const low = (v) => s(v).toLowerCase();
/** Company identity: case, spacing and punctuation do not make a different company. */
export const companyKey = (v) => low(v).replace(/[^a-z0-9]/g, '');

const CUSTOMER_TYPES = ['Manufacturer', 'Trader', 'Distributor', 'Exporter', 'Filler', 'Others'];
const RANKS = { primary: 1, secondary: 2, tertiary: 3 };
const STATUS_ALIASES = { approach: 'To Approach', toapproach: 'To Approach', cannotconvert: 'Cannot Convert', notconverting: 'Cannot Convert' };
const CATEGORY_ALIASES = {
  other: 'Others', others: 'Others', petfoods: 'Pet Food', petfood: 'Pet Food', icecreams: 'Ice Creams', icecream: 'Ice Creams',
  confectionary: 'Confectionery', confectionery: 'Confectionery', juice: 'Juices', juices: 'Juices', atta: 'Flour',
  chikkinamkeen: 'Namkeen', namkeen: 'Namkeen', fv: 'F&V', fruitsvegetables: 'F&V', sanitarypad: 'Sanitary Pads',
};

/** Headers are matched by what they start with — the sheet's own are long and misspelt ("Primnary"). */
const HEADERS = {
  rep: ['lead name'],
  company: ['company name'],
  customerType: ['customer type'],
  paymentType: ['payment type'],
  categories: ['categories', 'category'],
  status: ['initial status', 'status'],
  hoAddress: ['ho address', 'head office address'],
  hoCity: ['ho city', 'head office city'],
  dispatchCity: ['dispatch city', 'delivery'],
  gstin: ['gst'],
  rank: ['rank'],
  designation: ['designation'],
  contactCity: ['contact city'],
  contact: ['contact person name', 'contact person'],
  contact2: ['secondary contact person'],
  phone: ['primnary phone', 'primary phone', 'phone'],
  phone2: ['secondary phone'],
  email: ['email id', 'email'],
  email2: ['secondary email'],
};

/**
 * Which column holds what. Headers repeat (Designation / Contact City / Rank appear
 * twice — once for the primary contact, once for the secondary), so the first
 * occurrence is the primary's and the second the secondary's.
 */
export function mapHeaders(headerRow) {
  const h = arr(headerRow).map(low);
  const used = new Set();
  const find = (prefixes) => {
    for (const p of prefixes) {
      const i = h.findIndex((x, idx) => !used.has(idx) && x.startsWith(p));
      if (i >= 0) { used.add(i); return i; }
    }
    return -1;
  };
  // the specific before the general: "secondary contact person" before "contact person"
  const col = {};
  ['rep', 'company', 'customerType', 'paymentType', 'contact2', 'phone2', 'email2', 'status', 'categories',
    'hoAddress', 'hoCity', 'dispatchCity', 'gstin', 'rank', 'designation', 'contactCity', 'contact', 'phone', 'email']
    .forEach((k) => { col[k] = find(HEADERS[k]); });
  col.rank2 = find(HEADERS.rank);
  col.designation2 = find(HEADERS.designation);
  col.contactCity2 = find(HEADERS.contactCity);
  return col;
}

/** Find the TOOL FORMAT sheet (or any sheet whose header has Company Name) in a workbook. */
export function pickLeadSheet(sheets) {
  const list = arr(sheets);
  const hasCompany = (sh) => arr(sh.rows).slice(0, 5).some((r) => arr(r).some((c) => low(c).startsWith('company name')));
  return list.find((sh) => low(sh.name) === 'tool format' && hasCompany(sh)) || list.find(hasCompany) || null;
}

function fromList(value, list, aliases = {}) {
  const v = s(value);
  if (!v) return '';
  const k = companyKey(v);
  const hit = arr(list).find((x) => companyKey(x) === k);
  if (hit) return hit;
  if (aliases[k]) return arr(list).find((x) => companyKey(x) === companyKey(aliases[k])) || aliases[k];
  return null;   // not mappable — the caller decides
}

/** A status the app knows, or To Approach. */
export function normStatus(v, statuses = REP_STATUSES) {
  return fromList(v, statuses, STATUS_ALIASES) || 'To Approach';
}

/** A category from the app's list, else the typed word in Title Case (and reported). */
export function normCategory(v, categories = REP_CATEGORIES) {
  const hit = fromList(v, categories, CATEGORY_ALIASES);
  if (hit != null) return hit;
  return s(v).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function normCustomerType(v) {
  const t = low(v);
  if (!t) return '';
  return CUSTOMER_TYPES.find((c) => t.startsWith(c.toLowerCase())) || 'Others';
}

/** One person: the same email, or the same name with the same (or no) phone. */
function samePerson(x, p) {
  if (x.email && p.email && x.email === p.email) return true;
  return low(x.name) === low(p.name) && (x.phone === p.phone || !x.phone || !p.phone);
}

export function normRank(v) { return RANKS[low(v)] || ''; }

export function normDesignation(v, designations = DD_DEFAULTS.designations) {
  const hit = fromList(v, designations || DD_DEFAULTS.designations);
  return hit != null ? hit : s(v);
}

/** Split "Senthil " → match against each sales user's display name / username. */
export function matchRep(name, salesUsers) {
  const n = low(name);
  if (!n) return '';
  const users = arr(salesUsers).filter((u) => !u.disabled);
  const exact = users.find((u) => low(u.display_name) === n || low(u.username) === n);
  if (exact) return exact.id;
  const first = users.filter((u) => low(u.display_name).split(' ')[0] === n.split(' ')[0] || low(u.username).split(/[ ._@-]/)[0] === n.split(' ')[0]);
  return first.length === 1 ? first[0].id : '';
}

/**
 * Parse the sheet into companies. Returns { companies, skipped, repNames } where each
 * company is { key, name, rep, fields…, contacts[] } and repNames lists every distinct
 * Lead Name value (with '' for blank) and how many companies carry it.
 */
export function parseLeadRows(rows, { categories, statuses, designations } = {}) {
  const all = arr(rows);
  const hi = all.findIndex((r) => arr(r).some((c) => low(c).startsWith('company name')));
  if (hi < 0) throw new Error('No "Company Name" column found — is this the Lead List (TOOL FORMAT) sheet?');
  const col = mapHeaders(all[hi]);
  const at = (r, k) => (col[k] >= 0 ? s(r[col[k]]) : '');
  const byKey = new Map();
  const skipped = [];
  all.slice(hi + 1).forEach((r, i) => {
    if (!arr(r).some((c) => s(c))) return;
    const name = at(r, 'company');
    if (!name) { skipped.push({ row: hi + i + 2, reason: 'no company name' }); return; }
    const key = companyKey(name);
    let c = byKey.get(key);
    if (!c) {
      c = { key, name, rep: '', customerType: '', paymentType: '', categories: [], status: '', hoAddress: '', hoCity: '',
        dispatchCity: '', gstin: '', contacts: [], rows: 0 };
      byKey.set(key, c);
    }
    c.rows += 1;
    // the first row that says something wins each lead-level field
    const fill = (k, v) => { if (!c[k] && v) c[k] = v; };
    fill('rep', at(r, 'rep'));
    fill('customerType', normCustomerType(at(r, 'customerType')));
    fill('paymentType', at(r, 'paymentType').toUpperCase());
    fill('status', at(r, 'status') ? normStatus(at(r, 'status'), statuses) : '');
    fill('hoAddress', at(r, 'hoAddress'));
    fill('hoCity', at(r, 'hoCity'));
    fill('dispatchCity', at(r, 'dispatchCity'));
    fill('gstin', at(r, 'gstin').toUpperCase());
    // "CHIKKI/NAMKEEN" is one category to the app (Namkeen), "Dairy, Spices" is two
    const rawCat = at(r, 'categories');
    const whole = rawCat ? fromList(rawCat, categories || REP_CATEGORIES, CATEGORY_ALIASES) : null;
    (whole != null ? [whole] : rawCat.split(/[,/]+/).map((x) => s(x)).filter(Boolean).map((x) => normCategory(x, categories)))
      .forEach((one) => { if (!c.categories.includes(one)) c.categories.push(one); });
    const person = (nameK, phoneK, emailK, desigK, cityK, rankK) => {
      const p = { name: at(r, nameK), phone: at(r, phoneK), email: at(r, emailK).toLowerCase(),
        designation: normDesignation(at(r, desigK), designations), location: at(r, cityK), rank: normRank(at(r, rankK)) };
      if (!p.name && !p.phone && !p.email) return;
      if (!p.name) p.name = 'Unnamed contact';
      // the same email is the same person ("Piyush Gautam" / "PIYUSH GAUTAM- PUR MGR"): keep
      // the fuller row's details rather than listing them twice
      const same = c.contacts.find((x) => samePerson(x, p));
      if (!same) c.contacts.push(p);
      else Object.keys(p).forEach((k) => { if (!same[k] && p[k]) same[k] = p[k]; });
    };
    person('contact', 'phone', 'email', 'designation', 'contactCity', 'rank');
    person('contact2', 'phone2', 'email2', 'designation2', 'contactCity2', 'rank2');
  });
  const companies = [...byKey.values()];
  const repNames = {};
  companies.forEach((c) => { repNames[c.rep] = (repNames[c.rep] || 0) + 1; });
  return { companies, skipped, repNames };
}

/**
 * What the import would do against the leads already there: new leads, and existing
 * leads that would only gain contacts they do not have yet.
 */
export function planImport(parsed, sales) {
  const leads = arr(sales && sales.leads);
  const contacts = arr(sales && sales.contacts);
  const existing = new Map(leads.map((l) => [companyKey(l.client_name), l]));
  const out = { create: [], update: [], unchanged: [] };
  parsed.companies.forEach((c) => {
    const lead = existing.get(c.key);
    if (!lead) { out.create.push(c); return; }
    const have = contacts.filter((x) => String(x.lead_id) === String(lead.id));
    const fresh = c.contacts.filter((p) => !have.some((x) => samePerson({ ...x, email: low(x.email), phone: s(x.phone) }, p)));
    (fresh.length ? out.update : out.unchanged).push({ ...c, lead, contacts: fresh });
  });
  return out;
}

/**
 * The module-12 blob with the import applied. `repFor` maps a Lead Name value
 * (trimmed, '' for blank) to a rep id or ''. Built over `prev` — the server's copy at
 * save time — so it re-plans against it: a lead someone else added meanwhile is
 * joined, not duplicated.
 */
export function applyImport(prev, parsed, repFor, { now = new Date(), uid = salesUid, by = 'sadmin_import' } = {}) {
  const cur = prev || {};
  const plan = planImport(parsed, cur);
  const at = now.toISOString();
  const newLeads = [];
  const newContacts = [];
  const contactsFor = (c, leadId, owner, existingContacts) => {
    // one holder per rank within a customer — the rule My Contacts enforces
    const taken = new Set(arr(existingContacts).map((x) => String(x.priority)).filter((p) => p && p !== ''));
    c.contacts.forEach((p) => {
      const rank = p.rank && !taken.has(String(p.rank)) ? p.rank : '';
      if (rank) taken.add(String(rank));
      newContacts.push({
        id: uid('contact'), lead_id: leadId, customer: c.lead ? c.lead.client_name : c.name, group: '',
        customer_type: c.customerType, location: p.location, gstin: c.gstin, categories: c.categories.slice(),
        category: c.categories[0] || '', name: p.name, designation: p.designation, phone: p.phone, email: p.email,
        priority: rank, is_primary: rank === 1, created_by: owner || by, created_at: at, source: 'lead_import',
      });
    });
  };
  let leads = arr(cur.leads).slice();
  plan.create.forEach((c) => {
    const owner = repFor(s(c.rep)) || '';
    const assignments = {};
    if (owner) c.categories.forEach((cat) => { assignments[cat] = owner; });
    const lead = {
      id: uid('lead'), client_name: c.name, group: '', categories: c.categories.slice(), category: c.categories[0] || '',
      head_office: c.hoCity || c.hoAddress, head_office_address: c.hoAddress, delivery_location: c.dispatchCity,
      city: c.hoCity || c.hoAddress, gstin: c.gstin, payment_type: c.paymentType, customer_type: c.customerType,
      stage: c.status || 'To Approach', created_by: owner || by, assigned_to: owner, category_assignments: assignments,
      category_dispatch_forms: {}, next_follow_up_date: '', created_at: at, source: 'lead_import',
    };
    newLeads.push(lead);
    contactsFor(c, lead.id, owner, []);
  });
  // a lead the sheet marks Converted goes to the S Dashboard's conversion queue, as a rep's would
  newLeads.forEach((l) => {
    const conv = l.stage === 'Converted' ? requestConversion([l], l.id, l.assigned_to || by, { now })[0] : l;
    leads.push(conv);
  });
  plan.update.forEach((c) => {
    const have = arr(cur.contacts).filter((x) => String(x.lead_id) === String(c.lead.id));
    contactsFor(c, c.lead.id, c.lead.assigned_to, have);
  });
  return {
    next: { ...cur, leads, contacts: [...arr(cur.contacts), ...newContacts] },
    counts: { leads: newLeads.length, contacts: newContacts.length, joined: plan.update.length, unchanged: plan.unchanged.length },
  };
}
