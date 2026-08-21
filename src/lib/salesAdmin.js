// Sales Admin — the analytical slices the S Dashboard tabs render, plus the
// customer/group cleanup the Manage tab applies.
//
// Ported from sdashCsaResolve / sdashCsaAll / sdashAgeColor / sdashDaily* /
// sdashPOs* / sdashContacts* / sdashManage / _cleanupApply.
import { daysBetween, daysSince } from './sales.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const s = (v) => String(v == null ? '' : v).trim();
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Ageing colour: on time, slipping, late. (sdashAgeColor) */
export function ageColor(d) {
  if (d == null) return '#888';
  return d <= 2 ? '#0e6fb8' : d <= 5 ? '#E67E22' : '#c0392b';
}

/**
 * One CSA report flattened for reporting.
 *
 * A "direct" report is a walk-in sample with no SKU or lead behind it, so its
 * customer and product come off the report itself. For a Sales-OS sample the
 * submission date is when the SKU was raised — that is when the sample arrived —
 * not when QC got round to writing the report. (sdashCsaResolve)
 */
export function csaResolve(report, sales) {
  const sku = arr(sales && sales.skus).find((x) => x.id === report.sku_id);
  const lead = arr(sales && sales.leads).find((l) => l.id === report.lead_id);
  const isDirect = report.source === 'direct';
  return {
    r: report,
    customer: isDirect ? (report.company_name || '—') : (lead ? lead.client_name : '—'),
    sku: isDirect ? (report.product_desc || '—') : (sku ? sku.sku_name : '—'),
    submission: (!isDirect && sku && sku.created_at) ? sku.created_at : report.created_at,
    generated: report.created_at,
    given: report.given_to_client_date || '',
    commentsDone: report.plant_commented_at || '',
    quoted: report.quoted_at || '',
    status: report.status || '',
  };
}

export function csaAll(sales) {
  return arr(sales && sales.qc_reports).map((r) => csaResolve(r, sales));
}

/** Record the date a CSA report was handed to the customer. (sdashSetGivenDate) */
export function setCsaGivenDate(qcReports, reportId, date) {
  return arr(qcReports).map((r) => (r.id === reportId ? { ...r, given_to_client_date: date || '' } : r));
}

/** Every activity log entry, newest first, filtered by rep and free text. (sdashDailyFilter) */
export function dailyRows(sales, { repId = '', q = '' } = {}) {
  const leads = arr(sales && sales.leads);
  const t = q.trim().toLowerCase();
  return arr(sales && sales.interactions)
    .slice()
    .sort((a, b) => s(b.date).localeCompare(s(a.date)))
    .filter((i) => {
      if (repId && i.created_by !== repId) return false;
      if (t) {
        const lead = leads.find((l) => l.id === i.lead_id);
        const hay = [lead ? lead.client_name : '', i.type, i.outcome, i.reason].join(' ').toLowerCase();
        if (hay.indexOf(t) === -1) return false;
      }
      return true;
    })
    .slice(0, 200)     // production caps the log at 200 rows
    .map((i) => ({ i, lead: leads.find((l) => l.id === i.lead_id) || null }));
}

/** Every PO across every rep, newest first. (sdashPOsFilter) */
export function poRows(sales, { repId = '', q = '' } = {}) {
  const leads = arr(sales && sales.leads);
  const skus = arr(sales && sales.skus);
  const t = q.trim().toLowerCase();
  const rows = arr(sales && sales.pos)
    .slice()
    .sort((a, b) => s(b.date).localeCompare(s(a.date)))
    .filter((p) => {
      if (repId && p.created_by !== repId) return false;
      if (t) {
        const lead = leads.find((l) => l.id === p.lead_id);
        const hay = [lead ? lead.client_name : '', p.po_number].join(' ').toLowerCase();
        if (hay.indexOf(t) === -1) return false;
      }
      return true;
    })
    .map((p) => ({
      p,
      lead: leads.find((l) => l.id === p.lead_id) || null,
      sku: skus.find((x) => x.id === p.sku_id) || null,
      total: n(p.qty) * n(p.price),
    }));
  return { rows, grand: rows.reduce((sum, r) => sum + r.total, 0) };
}

/** Every contact with its lead, searched across name / customer / phone / email. (sdashContactsFilter) */
export function contactRows(sales, q = '') {
  const leads = arr(sales && sales.leads);
  const t = q.trim().toLowerCase();
  return arr(sales && sales.contacts)
    .map((c) => ({ c, lead: leads.find((l) => l.id === c.lead_id) || null }))
    .filter(({ c, lead }) => {
      if (!t) return true;
      const hay = [c.name, c.customer, lead ? lead.client_name : '', c.phone, c.email, c.designation].join(' ').toLowerCase();
      return hay.indexOf(t) > -1;
    });
}

/* ── Manage: customer / group / category cleanup ───────────────────────────── */

/** Every customer name that appears on a lead or a contact. (sdashManage) */
export function manageCustomers(sales) {
  const leads = arr(sales && sales.leads).map((l) => s(l && l.client_name));
  const contacts = arr(sales && sales.contacts).map((c) => s(c && c.customer));
  return [...new Set([...leads, ...contacts])].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/** Every group name known to the sales blob and the Customer Master. (sdashManage) */
export function manageGroups(sales, customers) {
  const fromContacts = arr(sales && sales.contacts).map((c) => s(c && c.group));
  const fromMaster = arr(customers).map((c) => s(c && c.group));
  return [...new Set([...fromContacts, ...fromMaster])].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/** The categories a customer's lead records currently carry. */
export function customerCategories(sales, customer) {
  const out = new Set();
  arr(sales && sales.leads).forEach((l) => {
    if (s(l.client_name) !== s(customer)) return;
    const cats = arr(l.categories).length ? l.categories : (l.category ? [l.category] : []);
    cats.forEach((c) => out.add(c));
  });
  return [...out];
}

/** The per-category dispatch-form restrictions saved against a customer. */
export function customerCategoryForms(sales, customer) {
  const out = {};
  arr(sales && sales.leads).forEach((l) => {
    if (s(l.client_name) !== s(customer)) return;
    if (l.category_dispatch_forms) Object.assign(out, l.category_dispatch_forms);
  });
  return out;
}

/**
 * Set a customer's categories and the dispatch forms allowed under each.
 *
 * A category assignment is preserved when the category survives, dropped when it
 * does not, and defaults to the lead's own rep when it is newly added. A customer
 * that exists only as a contact gets a lead created, because categories need a
 * record to live on. (sdashSaveCustCats)
 */
export function applyCustomerCategories(sales, customer, categories, categoryForms, { uid, now = new Date() } = {}) {
  const cust = s(customer);
  const cats = arr(categories).slice();
  let touched = 0;
  const leads = arr(sales && sales.leads).map((l) => {
    if (s(l.client_name) !== cust) return l;
    touched++;
    const ca = { ...(l.category_assignments || {}) };
    Object.keys(ca).forEach((k) => { if (cats.indexOf(k) < 0) delete ca[k]; });
    cats.forEach((k) => { if (!ca[k]) ca[k] = l.assigned_to || l.created_by || ''; });
    return { ...l, categories: cats, category: cats[0] || '', category_assignments: ca, category_dispatch_forms: categoryForms || {} };
  });

  if (touched) return { leads, created: false, count: touched };
  if (!cats.length) return { leads, created: false, count: 0 };

  const ref = arr(sales && sales.contacts).find((c) => s(c.customer) === cust) || {};
  const rep = ref.created_by || ref.assigned_to || '';
  const ca = {};
  cats.forEach((k) => { ca[k] = rep; });
  const newLead = {
    id: uid ? uid('lead') : 'lead_' + now.getTime(),
    client_name: cust, categories: cats, category: cats[0] || '',
    category_assignments: ca, category_dispatch_forms: categoryForms || {},
    group: ref.group || '', city: ref.location || '', stage: 'To Approach',
    created_by: rep, assigned_to: rep, created_at: now.toISOString(), created_via: 'sadmin_manage',
  };
  return { leads: [...leads, newLead], created: true, count: 1 };
}

/**
 * Rename or un-group a name everywhere it is stored: the Customer Master (module 4),
 * the JSS specs (module 2), the OAB rows (module 1) and the sales blob (module 12).
 * A rename onto an existing name is a MERGE — that is the point of the tool.
 *
 * Pure: takes the four modules, returns the four new values plus a per-module count
 * so the caller can save only what actually changed. (_cleanupApply)
 */
export function cleanupApply(kind, oldVal, newVal, { sales, customers, jss, oab }) {
  const from = s(oldVal);
  const to = s(newVal);
  const counts = { cm: 0, jss: 0, oab: 0, leads: 0, contacts: 0 };
  const isCustomer = kind === 'renameCustomer';

  const nextCustomers = arr(customers).map((c) => {
    if (!c) return c;
    if (isCustomer) {
      if (s(c.customer) === from) { counts.cm++; return { ...c, customer: to }; }
      return c;
    }
    if (s(c.group) === from) { counts.cm++; return { ...c, group: kind === 'renameGroup' ? to : '' }; }
    return c;
  });

  const nextJss = arr(jss).map((j) => {
    if (!j) return j;
    if (isCustomer) {
      if (s(j.customer) === from) { counts.jss++; return { ...j, customer: to }; }
      return j;
    }
    if (s(j.group) === from) { counts.jss++; return { ...j, group: kind === 'renameGroup' ? to : '' }; }
    return j;
  });

  // OAB rows carry a customer name and no group, so only a customer rename reaches them.
  let nextOab = oab;
  if (isCustomer && oab && oab.OAB) {
    const OABnext = { ...oab.OAB };
    ['SF', 'OT'].forEach((k) => {
      OABnext[k] = arr(oab.OAB[k]).map((r) => {
        if (r && s(r.customer) === from) { counts.oab++; return { ...r, customer: to }; }
        return r;
      });
    });
    nextOab = { ...oab, OAB: OABnext };
  }

  const nextLeads = arr(sales && sales.leads).map((l) => {
    if (l && isCustomer && s(l.client_name) === from) { counts.leads++; return { ...l, client_name: to }; }
    return l;
  });

  const nextContacts = arr(sales && sales.contacts).map((c) => {
    if (!c) return c;
    if (isCustomer) {
      if (s(c.customer) === from) { counts.contacts++; return { ...c, customer: to }; }
      return c;
    }
    if (s(c.group) === from) { counts.contacts++; return { ...c, group: kind === 'renameGroup' ? to : '' }; }
    return c;
  });

  return { counts, customers: nextCustomers, jss: nextJss, oab: nextOab, leads: nextLeads, contacts: nextContacts };
}

/**
 * Delete a customer: its lead and contact records go, and so do its Customer Master
 * rows — otherwise the name keeps appearing in every customer dropdown in the app.
 * JSS specs and Sales Orders under the name are deliberately NOT touched; that is
 * order history. (sdashDeleteCustomer)
 */
export function deleteCustomer(customer, { sales, customers }) {
  const cust = s(customer);
  const leads = arr(sales && sales.leads).filter((l) => s(l && l.client_name) !== cust);
  const contacts = arr(sales && sales.contacts).filter((c) => s(c && c.customer) !== cust);
  const master = arr(customers).filter((c) => s(c && c.customer) !== cust);
  return {
    leads, contacts, customers: master,
    counts: {
      leads: arr(sales && sales.leads).length - leads.length,
      contacts: arr(sales && sales.contacts).length - contacts.length,
      cm: arr(customers).length - master.length,
    },
  };
}

export { daysBetween, daysSince };
