// Who supplies an item — the purchase login's "Suppliers by Item" tab.
//
// Issues 30.09 §PU5: "There should be one more tab where the purchase login should be
// able to see who all the suppliers are for one particular item … search by item
// code, material, subgroup, specialty, item description. All of these will be the
// drop-down selections … list of all the suppliers who supply this particular
// material or any other material similar to this: the supplier company's name, the
// supplier contact person's name, the supplier contact number, the payment terms, and
// if there is a rate available for that particular item from that particular supplier."
//
// Everything needed is already on the page: the approved-supplier list (module 6
// `asl` — one row per supplier × item, the supplier's contact details written onto
// every row of that supplier), the Item Master, and the POs raised so far.

const arr = (v) => (Array.isArray(v) ? v : []);
const txt = (v) => String(v == null ? '' : v).trim();
const low = (v) => txt(v).toLowerCase();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const FINDER_FIELDS = ['code', 'materialType', 'subGroup', 'specialty', 'description'];
export const EMPTY_FINDER = Object.freeze({ code: '', materialType: '', subGroup: '', specialty: '', description: '' });

const isInactive = (r) => low(r && r.status) === 'inactive';
const isCancelled = (po) => low(po && po.status) === 'cancelled' || !!(po && po.cancelled);

const masterTuple = (m) => ({
  code: txt(m.code), description: txt(m.name), materialType: txt(m.materialType),
  subGroup: txt(m.subGroup), specialty: txt(m.specialtyName || m.specialty), uom: txt(m.uom),
});
// The ITEM speciality on an ASL row is `specialty`; `speciality` is the supplier's trade.
const aslTuple = (r) => ({
  code: txt(r.itemCode), description: txt(r.specificMaterial), materialType: txt(r.materialType),
  subGroup: txt(r.subGroup), specialty: txt(r.specialty), uom: txt(r.uom),
});

/** Every picker field matches (a blank pick matches anything); `skip` is left out. */
const matches = (t, f, skip = null) => FINDER_FIELDS.every((k) => k === skip || !txt(f[k]) || low(t[k]) === low(f[k]));

function itemTuples(master, asl) {
  const out = [];
  arr(master).forEach((m) => { if (m && txt(m.code)) out.push(masterTuple(m)); });
  arr(asl).forEach((r) => {
    if (!r || isInactive(r) || (!txt(r.itemCode) && !txt(r.specificMaterial))) return;
    out.push(aslTuple(r));
  });
  return out;
}

function distinct(values) {
  const seen = new Map();
  values.forEach((v) => { const t = txt(v); if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t); });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * The five pickers' options, each narrowed by the OTHER four — pick a material type and
 * the item codes, sub groups, specialities and descriptions shrink to what it covers.
 * Drawn from the Item Master and the approved-supplier list together: an item matches
 * if EITHER record says so (the Stores GRN rule), since the two do not always agree.
 * `codeLabels` maps a code to "CODE — description" for the item-code picker.
 */
export function finderOptions({ master, asl }, f = EMPTY_FINDER) {
  const tuples = itemTuples(master, asl);
  const opt = (k) => distinct(tuples.filter((t) => matches(t, f, k)).map((t) => t[k]));
  const codeLabels = {};
  tuples.forEach((t) => {
    if (!t.code) return;
    const k = t.code.toUpperCase();
    if (!codeLabels[k] && t.description) codeLabels[k] = `${t.code} — ${t.description}`;
  });
  return {
    codes: opt('code'), materialTypes: opt('materialType'), subGroups: opt('subGroup'),
    specialties: opt('specialty'), descriptions: opt('description'), codeLabels,
  };
}

/**
 * A supplier's own details — company-level fields are written onto every ASL row of
 * that supplier, but a newly added supplier can carry an item-less placeholder row
 * first, so the first row that actually holds contact details wins (as on the PO).
 */
export function supplierDetails(asl, company) {
  const rows = arr(asl).filter((r) => r && low(r.company) === low(company));
  const r = rows.find((x) => x.contact || x.phone || x.contact2 || x.phone2 || x.email) || rows[0] || {};
  const terms = rows.find((x) => txt(x.paymentTerms));
  const contact = txt(r.contact), contact2 = txt(r.contact2), phone = txt(r.phone), phone2 = txt(r.phone2);
  return {
    company: txt(r.company) || txt(company),
    contactPerson: contact || contact2,
    contactNumber: phone || phone2,
    // the second contact, when the first slot is filled too
    altContact: contact && contact2 ? contact2 : '',
    altNumber: phone && phone2 ? phone2 : '',
    email: txt(r.email),
    paymentTerms: terms ? txt(terms.paymentTerms) : '',
  };
}

/**
 * The newest rate this supplier was actually ordered at for the item, off the POs
 * (cancelled ones do not count). A PO line names the item by code since 29.09, and by
 * the supplier's own description before that.
 */
export function lastPoRate(pos, company, { code, descriptions }) {
  const want = new Set(arr(descriptions).map(low).filter(Boolean));
  let best = null;
  arr(pos).forEach((po) => {
    if (!po || isCancelled(po) || low(po.supplier) !== low(company)) return;
    arr(po.items).forEach((ln) => {
      if (!ln) return;
      const hit = (code && low(ln.itemCode) === low(code)) || (!txt(ln.itemCode) && want.has(low(ln.item)));
      if (!hit || !(num(ln.rate) > 0)) return;
      const date = txt(po.poDate);
      if (!best || date.localeCompare(best.date) > 0) best = { rate: num(ln.rate), date, poNum: txt(po.poNum), unit: txt(ln.unit) };
    });
  });
  return best;
}

/**
 * Every supplier for the picked item(s) — or for something like it.
 *
 * Exact: the supplier's ASL row (or the Item Master record of its code) matches every
 * pick. Similar: when an item, a description or a speciality is picked, the suppliers of
 * OTHER items of the same material type and sub group (and the same speciality, when one
 * was picked alongside the item) — "any other material similar to this".
 *
 * One result per supplier × item. The rate is the supplier's ASL quote (basic price);
 * failing that, the last PO rate with its date.
 */
export function findSuppliers({ asl, master, pos }, f = EMPTY_FINDER) {
  if (!FINDER_FIELDS.some((k) => txt(f[k]))) return [];
  const masterByCode = new Map();
  arr(master).forEach((m) => { if (m && txt(m.code)) masterByCode.set(txt(m.code).toUpperCase(), masterTuple(m)); });
  const rows = arr(asl).filter((r) => r && !isInactive(r) && txt(r.company) && (txt(r.itemCode) || txt(r.specificMaterial)));

  // The item the picks point at, for "similar": its material type and sub group.
  const aslHit = (pred) => { const r = rows.find(pred); return r ? aslTuple(r) : null; };
  let target = null;
  if (txt(f.code)) {
    target = masterByCode.get(txt(f.code).toUpperCase()) || aslHit((r) => low(r.itemCode) === low(f.code));
  } else if (txt(f.description)) {
    target = [...masterByCode.values()].find((t) => low(t.description) === low(f.description))
      || aslHit((r) => low(r.specificMaterial) === low(f.description));
  }
  const family = {
    materialType: txt(f.materialType) || (target ? target.materialType : ''),
    subGroup: txt(f.subGroup) || (target ? target.subGroup : ''),
  };
  const itemPicked = !!(txt(f.code) || txt(f.description));
  const wantSimilar = (itemPicked || !!txt(f.specialty)) && !!family.materialType;
  const similarTo = (t) => low(t.materialType) === low(family.materialType)
    && (!family.subGroup || low(t.subGroup) === low(family.subGroup))
    && (!(itemPicked && txt(f.specialty)) || low(t.specialty) === low(f.specialty));

  const out = new Map();
  rows.forEach((r) => {
    const a = aslTuple(r);
    const m = a.code ? masterByCode.get(a.code.toUpperCase()) || null : null;
    const tuples = m ? [a, m] : [a];
    const exact = tuples.some((t) => matches(t, f));
    const similar = !exact && wantSimilar && tuples.some(similarTo);
    if (!exact && !similar) return;
    const key = low(r.company) + '|' + low(a.code || a.description);
    const prev = out.get(key);
    if (prev && (prev.match === 'Exact' || !exact)) return;   // keep one row; an exact hit wins

    const sup = supplierDetails(asl, r.company);
    const id = {
      itemCode: a.code || (m ? m.code : ''),
      description: (m && m.description) || a.description,
      materialType: (m && m.materialType) || a.materialType,
      subGroup: (m && m.subGroup) || a.subGroup,
      specialty: (m && m.specialty) || a.specialty,
      uom: (m && m.uom) || a.uom,
    };
    const quote = txt(r.basicPrice ?? r.price);
    const last = lastPoRate(pos, r.company, { code: id.itemCode, descriptions: [a.description, m && m.description] });
    let rate = null;
    if (quote !== '' && num(quote) > 0) rate = { value: num(quote), source: 'ASL', date: '', poNum: '' };
    else if (last) rate = { value: last.rate, source: 'PO', date: last.date, poNum: last.poNum };
    out.set(key, {
      key, ...sup, ...id, rate, lastPo: last, moq: txt(r.moq), leadTime: txt(r.leadTime),
      match: exact ? 'Exact' : 'Similar',
    });
  });
  return [...out.values()].sort((x, y) => (x.match === y.match ? 0 : x.match === 'Exact' ? -1 : 1)
    || x.company.localeCompare(y.company) || x.itemCode.localeCompare(y.itemCode));
}

/** The results as an Excel sheet (array of arrays). */
export function finderAoa(rows) {
  const header = ['Match', 'Supplier', 'Contact Person', 'Contact Number', 'Email', 'Payment Terms', 'Item Code', 'Item Description',
    'Material Type', 'Sub Group', 'Speciality', 'UOM', 'Rate', 'Rate Source', 'Rate Date', 'MOQ', 'Lead Time'];
  const body = arr(rows).map((r) => [
    r.match, r.company, [r.contactPerson, r.altContact].filter(Boolean).join(' / '),
    [r.contactNumber, r.altNumber].filter(Boolean).join(' / '), r.email, r.paymentTerms, r.itemCode, r.description,
    r.materialType, r.subGroup, r.specialty, r.uom,
    r.rate ? r.rate.value : '', r.rate ? (r.rate.source === 'ASL' ? 'Approved supplier list' : `Last PO ${r.rate.poNum}`) : '',
    r.rate && r.rate.date ? r.rate.date : '', r.moq, r.leadTime,
  ]);
  return [header, ...body];
}
