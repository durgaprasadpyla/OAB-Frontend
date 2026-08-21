// QC certificates — Certificate of Analysis (COA) and Food Grade Certificate.
//
// A certificate belongs to an INVOICE LINE (invoice × spec), because that is the
// shipment it certifies. It is stored on the invoice itself, under
// `inv.certs['coa|<spec>']` / `inv.certs['fg|<spec>']`:
//
//   { done: true, savedOn: 'YYYY-MM-DD', data: { date, job, so, dom, count,
//     struct, batch, attrs?[{name,std,obs}] } }
//
// Keeping certificates on the invoice (rather than in their own list) is what
// lets the invoice register show a per-line certificate status, and is the
// monolith's data model — changing it would strand every existing certificate.
//
// Ported from openCert / saveCert / certDefaultAttrs / certStruct / certSO.

const s = (v) => String(v == null ? '' : v).trim();
const arr = (v) => (Array.isArray(v) ? v : []);

export const CERT_TYPES = { coa: 'Certificate of Analysis (COA)', fg: 'Food Grade Certificate' };

/** Storage key for one certificate on an invoice. (_certKey) */
export function certKey(type, spec) {
  return `${type}|${s(spec)}`;
}

/** The saved certificate for an invoice line, or null. */
export function getCert(invoice, type, spec) {
  const certs = (invoice && invoice.certs) || {};
  return certs[certKey(type, spec)] || null;
}

/** Whether both certificates exist for a line — what the register badges on. */
export function certStatus(invoice, spec) {
  return { coa: !!getCert(invoice, 'coa', spec), fg: !!getCert(invoice, 'fg', spec) };
}

/** JSS row for a spec. */
export function certJss(jss, spec) {
  return arr(jss).find((j) => s(j.spec) === s(spec)) || null;
}

/** Structure line, e.g. "51 MIC". (certStruct) */
export function certStruct(jss, spec) {
  const j = certJss(jss, spec);
  if (!j) return '';
  const m = j.mic;
  return (m === '' || m == null) ? '' : `${m} MIC`;
}

/** Job name from the spec master. (certJobName) */
export function certJobName(jss, spec) {
  const j = certJss(jss, spec);
  return j ? (j.jobName || '') : '';
}

/**
 * The sale order this spec shipped against. Prefers the row matching the
 * invoice's PO; falls back to any row for the spec, because an older invoice may
 * predate PO tracking and a blank SO on a certificate is worse than a close
 * match. (certSO)
 */
export function certSO(oab, spec, po) {
  const rows = ['SF', 'OT'].flatMap((k) => arr(oab && oab[k]));
  const exact = rows.find((r) => r && s(r.spec) === s(spec) && (!po || r.poNum === po));
  if (exact) return exact.so || '';
  const any = rows.find((r) => r && s(r.spec) === s(spec));
  return any ? (any.so || '') : '';
}

/**
 * Default COA attributes, seeded from the spec's dimensions with the standard
 * tolerances the lab measures against. (certDefaultAttrs)
 */
export function certDefaultAttrs(jss, spec) {
  const j = certJss(jss, spec) || {};
  const w = (j.width === '' || j.width == null) ? '' : j.width;
  const h = (j.height === '' || j.height == null) ? '' : j.height;
  return [
    { name: 'Pouch Width (mm)', std: w !== '' ? `${w} ± 2` : '', obs: w !== '' ? String(w) : '' },
    { name: 'Pouch Height (mm)', std: h !== '' ? `${h} ± 2` : '', obs: h !== '' ? String(h) : '' },
    { name: 'Sealing width (mm)', std: '1 X 1', obs: '' },
    { name: 'Seal Strength (gm/25 mm)', std: '', obs: '' },
    { name: 'COF', std: '0.25 (Max)', obs: '' },
    { name: 'Perforation Size', std: '', obs: '' },
  ];
}

/**
 * Prefill the certificate form: whatever was saved before wins, otherwise it is
 * derived from the invoice, the spec master and the OAB board.
 */
export function certInitialData({ invoice, item, spec, type, jss, oab }) {
  const saved = getCert(invoice, type, spec);
  const d = (saved && saved.data) || {};
  const pick = (k, fallback) => (d[k] !== undefined && d[k] !== '' ? d[k] : fallback);
  const base = {
    date: pick('date', (invoice && invoice.date) || ''),
    job: pick('job', certJobName(jss, spec) || (item && item.jobName) || ''),
    so: pick('so', certSO(oab, spec, invoice && invoice.po)),
    dom: pick('dom', ''),
    count: pick('count', ''),
    struct: pick('struct', certStruct(jss, spec)),
    batch: pick('batch', ''),
  };
  if (type !== 'coa') return base;
  const attrs = arr(d.attrs).length ? JSON.parse(JSON.stringify(d.attrs)) : certDefaultAttrs(jss, spec);
  return { ...base, attrs };
}

/** Quantity shown on the certificate — the line's, falling back to the invoice's. */
export function certQty(invoice, item) {
  const q = Number((item && item.qty) ?? (invoice && invoice.qty) ?? 0);
  return Number.isFinite(q) ? q : 0;
}

/**
 * Attach a certificate to an invoice inside the OAB module. Returns a NEW module
 * object — the invoice register is shared state, so this must not mutate.
 *
 * `invNo` identifies the invoice rather than an array index: the register is
 * filtered and re-sorted in the UI, and an index would attach the certificate to
 * whatever happened to be in that slot.
 */
export function attachCert(oabModule, invNo, type, spec, data) {
  const mod = oabModule || {};
  const reg = arr(mod.INV_REG);
  let found = false;
  const next = reg.map((inv) => {
    if (s(inv.no) !== s(invNo)) return inv;
    found = true;
    return {
      ...inv,
      certs: {
        ...(inv.certs || {}),
        [certKey(type, spec)]: { done: true, savedOn: new Date().toISOString().slice(0, 10), data },
      },
    };
  });
  if (!found) throw new Error(`Invoice ${invNo} is no longer in the register.`);
  return { ...mod, INV_REG: next };
}

/** Every invoice line that could carry a certificate, newest invoice first. */
export function certLines(oabModule) {
  const reg = arr(oabModule && oabModule.INV_REG);
  const out = [];
  reg.forEach((inv) => {
    const items = arr(inv.items).length ? arr(inv.items) : [{ spec: inv.spec, qty: inv.qty, jobName: inv.jobName }];
    items.forEach((it) => {
      if (!s(it.spec)) return;
      out.push({
        invNo: inv.no, invoice: inv, item: it, spec: s(it.spec),
        customer: inv.customer || '', date: inv.date || '',
        status: certStatus(inv, it.spec),
      });
    });
  });
  return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

/** The fixed compliance declaration on a Food Grade certificate. */
export const FOOD_GRADE_DECLARATION = {
  intro: 'We hereby certify that the raw materials used in the production of our film produced at our premises comply with food contact regulations mentioned below.',
  pe: 'US FDA CFR TITLE 21.177.1520',
  inks: 'US FDA CFR TITLE 21.175.170',
};
