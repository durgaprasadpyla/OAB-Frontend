// CSA — Customer Sample Analysis (part of module 12).
//
// Flow: a rep records that a customer sample was received and sent → QC writes a
// CSA report describing the structure they built → the plant (PM) comments on it
// and prices the plates. All three roles read one copy in the shared sales blob
// (`qc_reports`), so nothing is passed around as files.
//
// Ported from qcCsa* (QC side) and pmCsa* (plant side).

import { salesUid, salesToday } from './sales.js';

const s = (v) => String(v == null ? '' : v).trim();
const arr = (v) => (Array.isArray(v) ? v : []);

export const CSA_STATUSES = ['Pending Plant', 'Pending QC', 'Quoted', 'Done'];
export const QC_RESPONSIBLE = ['Manasa', 'Sundeep', 'ASM', 'Others'];
export const DISPATCH_TYPES = ['Pouch', 'Roll', 'Label', 'Bulk Bag'];
export const YES_NO = ['Yes', 'No'];

export const SUBSTRATE_DEFAULTS = [
  { name: 'PET', unit: 'Micron' }, { name: 'MET PET', unit: 'Micron' }, { name: 'BOPP', unit: 'Micron' },
  { name: 'AF BOPP', unit: 'Micron' }, { name: 'AF LDPE', unit: 'Micron' }, { name: 'Pearlised BOPP', unit: 'Micron' },
  { name: 'MATT BOPP', unit: 'Micron' }, { name: 'Milk Poly', unit: 'Micron' }, { name: 'Natural Poly', unit: 'Micron' },
  { name: 'Paper', unit: 'GSM' }, { name: 'Aluminium Foil', unit: 'Micron' }, { name: 'Metallized Paper', unit: 'GSM' },
];

/** Substrate master — a super-admin override wins over the built-in list. */
export function substrateList(sales) {
  const custom = arr(sales && sales.substrate_options);
  return custom.length ? custom : SUBSTRATE_DEFAULTS;
}

/** Unit for a substrate. Paper and metallized paper are GSM, films are microns. */
export function substrateUnit(sales, name) {
  const hit = substrateList(sales).find((x) => s(x.name) === s(name));
  return hit ? hit.unit : 'Micron';
}

/** A Yes/No toggle from the rep sample form. (qcIsYes) */
export function isYes(v) {
  return s(v).toLowerCase() === 'yes';
}

/**
 * Calendar days since a date. This advances at midnight rather than on a rolling
 * 24-hour window, so something logged any time yesterday reads "1d" today —
 * which is how the shop floor counts it. (qcCsaDaysSince)
 */
export function csaDaysSince(dateStr, now = new Date()) {
  if (!dateStr) return 0;
  const d0 = new Date(String(dateStr).slice(0, 10));
  if (Number.isNaN(d0.getTime())) return 0;
  const today = new Date(salesToday(now));
  return Math.max(0, Math.round((today.getTime() - d0.getTime()) / 86400000));
}

/** Ageing band: green up to 2 days, amber to 5, red beyond. (sdashAgeColor) */
export function ageColor(days) {
  if (days == null) return '#888';
  return days <= 2 ? '#0e6fb8' : days <= 5 ? '#E67E22' : '#c0392b';
}

/** The date a sample's clock starts from. (qcCsaSampleDate) */
export function csaSampleDate(sku) {
  return (sku && (sku.sample_sent_at || sku.sample_received_at || sku.created_at)) || '';
}

/**
 * Samples waiting on QC: the rep has ticked BOTH received and sent, and no CSA
 * report exists for that SKU yet. Oldest wait first. (qcCsaPendingList)
 */
export function csaPendingForQc(sales) {
  const reports = arr(sales && sales.qc_reports);
  return arr(sales && sales.skus)
    .filter((sk) => isYes(sk.sample_received) && isYes(sk.sample_sent))
    .filter((sk) => !reports.some((r) => r.sku_id === sk.id))
    .sort((a, b) => csaDaysSince(csaSampleDate(b)) - csaDaysSince(csaSampleDate(a)));
}

/** Reports the plant still owes an answer on. (pmCsaRenderPending) */
export function csaPendingForPlant(sales) {
  return arr(sales && sales.qc_reports)
    .filter((r) => !r.plant_comments || r.needs_pm_review)
    .sort((a, b) => csaDaysSince(b.created_at) - csaDaysSince(a.created_at));
}

/** Reports the plant has already answered. (pmCsaRenderDone) */
export function csaDoneForPlant(sales) {
  return arr(sales && sales.qc_reports)
    .filter((r) => r.plant_comments && !r.needs_pm_review)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/**
 * Who and what a report is about. A report QC raised directly carries its own
 * company/product text; one that came from the sales pipeline resolves through
 * the SKU and its lead. (pmCsaCompanyItem)
 */
export function csaCompanyItem(sales, report) {
  const sku = arr(sales && sales.skus).find((x) => x.id === report.sku_id);
  const lead = arr(sales && sales.leads).find((l) => l.id === report.lead_id);
  return {
    company: report.source === 'direct' ? (report.company_name || '—') : (lead ? lead.client_name : '—'),
    item: report.source === 'direct' ? (report.product_desc || '—') : (sku ? sku.sku_name : '—'),
  };
}

/** Structure summary, e.g. "PET/MET PET/AF LDPE". */
export function csaStructure(report) {
  return [report.substrate1, report.substrate2, report.substrate3].filter(Boolean).join('/') || '—';
}

const CSA_NUMERIC = [
  'ink_gsm', 'adhesive_gsm', 'film_width', 'pouch_height', 'pouch_width', 'seal_width',
  'gsm', 'pouch_weight', 'pouches_per_kg', 'print_repeat', 'sleeve_repeat',
];

export const CSA_BLANK = {
  company_name: '', product_desc: '', dispatch_type: '', responsible_person: '',
  substrate1: '', substrate1_val: '', substrate2: '', substrate2_val: '', substrate3: '', substrate3_val: '',
  coating: '', glue_tape: '', printed: '', plant_comment_req: '',
  ...Object.fromEntries(CSA_NUMERIC.map((k) => [k, ''])),
};

/**
 * Build a CSA report. An empty `skuId` means a direct report raised by QC, which
 * must name the company, product and responsible person itself — from the sales
 * pipeline those are resolved from the SKU and its lead instead. (qcCsaSave)
 */
export function buildCsaReport(form, { sales, skuId = '', user = '', now = new Date(), uid = salesUid } = {}) {
  const direct = !skuId;
  if (direct) {
    if (!s(form.company_name)) throw new Error('Company is required.');
    if (!s(form.product_desc)) throw new Error('Product description is required.');
    if (!s(form.responsible_person)) throw new Error('Responsible person is required.');
  }
  const sku = direct ? null : arr(sales && sales.skus).find((x) => x.id === skuId);

  const report = {
    id: uid('csa'),
    source: direct ? 'direct' : 'sales_os',
    sku_id: direct ? null : skuId,
    lead_id: direct ? null : (sku ? sku.lead_id : null),
    company_name: direct ? s(form.company_name) : null,
    product_desc: direct ? s(form.product_desc) : null,
    dispatch_type: direct ? s(form.dispatch_type) : (sku ? sku.dispatch_type : null),
    responsible_person: direct ? s(form.responsible_person) : null,
    substrate1: s(form.substrate1), substrate2: s(form.substrate2), substrate3: s(form.substrate3),
    substrate1_val: Number(form.substrate1_val) || 0, substrate1_unit: substrateUnit(sales, form.substrate1),
    substrate2_val: Number(form.substrate2_val) || 0, substrate2_unit: substrateUnit(sales, form.substrate2),
    substrate3_val: Number(form.substrate3_val) || 0, substrate3_unit: substrateUnit(sales, form.substrate3),
    coating: s(form.coating),
    glue_tape: s(form.glue_tape),
    printed: s(form.printed),
    plant_comment_req: s(form.plant_comment_req),
    status: 'Pending Plant',
    created_by: user,
    created_at: now.toISOString(),
  };
  CSA_NUMERIC.forEach((k) => { report[k] = Number(form[k]) || 0; });
  return report;
}

/**
 * Mark the SKU as having its CSA done, so the rep's list stops showing it as
 * outstanding. Only applies to pipeline reports — a direct one has no SKU.
 */
export function markSkuCsaReceived(skus, skuId) {
  if (!skuId) return arr(skus);
  return arr(skus).map((sk) => (sk.id === skuId ? { ...sk, csa_received: 'Yes' } : sk));
}

/** Record the plant's answer on a report. (pmCsaSubmit) */
export function answerCsaReport(reports, reportId, { comments, plates, user = '', now = new Date() } = {}) {
  return arr(reports).map((r) => (r.id === reportId ? {
    ...r,
    plant_comments: s(comments),
    plates: plates || r.plates || null,
    needs_pm_review: false,
    status: 'Pending QC',
    plant_answered_by: user,
    plant_answered_at: now.toISOString(),
  } : r));
}
