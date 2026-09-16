import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { fmtDate } from '../lib/format.js';
import { isCustomerLead } from '../lib/repFlow.js';
import { csaStructure } from '../lib/csa.js';

// Sales Login §63-§65 — on the QC login's Add JSS Spec page: "a link … where the
// CSAs will be displayed. The CSAs will be filtered, for only the customers which
// are converted from leads to customers by the super admin and among those
// customers also for those CSAs for which the sales rep would have marked as
// 'accepted'." Picking one fills the JSS form (editable); Add Spec then creates the
// JSS number and writes it back onto the SKU, so the rep's PO can carry it.

/** The JSS form fields a CSA report + its requisition imply. Exported for the test. */
export function jssFieldsFromCsa({ sku, lead, report, customers }) {
  const r = report || {};
  const req = (sku && sku.csa_request) || {};
  const d = req.details || {};
  const master = (customers || []).find((c) => String(c.customer || '').trim().toLowerCase() === String((lead && lead.client_name) || '').trim().toLowerCase());
  const material = sku && sku.structure ? sku.structure : csaStructure(r) !== '—' ? csaStructure(r) : '';
  const num = (v) => (v == null || v === '' || Number(v) === 0 ? '' : String(v));
  return {
    group: master ? (master.group || '') : (lead && lead.group) || '',
    customer: (lead && lead.client_name) || '',
    jobName: (sku && sku.sku_name) || '',
    material,
    mic: num(r.substrate1_val) || '',
    gsm: num(r.gsm),
    filmWidth: num(r.film_width),
    width: num(r.pouch_width) || num(d.pouch_width_mm) || num(d.totalWidth) || num(d.sleeve_width_mm),
    height: num(r.pouch_height) || num(d.pouch_height_mm) || num(d.totalHeight) || num(d.sleeve_height_mm),
    gusset: num(d.totalGusset) || num(d.gusset_mm),
    pouchWeight: num(r.pouch_weight),
    dispatchForm: (sku && (sku.dispatch_form || sku.dispatch_type)) || r.dispatch_type || '',
    status: 'Active',
  };
}

/** The accepted CSAs of converted customers that have no JSS yet. Exported for the test. */
export function csaCandidatesForJss(sales, customers) {
  const leads = (sales && sales.leads) || [];
  const reports = (sales && sales.qc_reports) || [];
  return ((sales && sales.skus) || [])
    .filter((sk) => sk.quotation_accepted && !String(sk.jss_spec || '').trim())
    .map((sk) => ({ sku: sk, lead: leads.find((l) => l.id === sk.lead_id) || null, report: reports.find((x) => x.sku_id === sk.id) || null }))
    .filter((c) => c.lead && isCustomerLead(c.lead, customers))
    .sort((a, b) => String(b.sku.quotation_accepted_at || '').localeCompare(String(a.sku.quotation_accepted_at || '')));
}

export default function CsaToJssPanel({ picked, onPick }) {
  const { mods } = useData();
  const sales = mods.sales || {};
  const customers = Array.isArray(mods.customers) ? mods.customers : [];
  const [open, setOpen] = useState(true);
  const rows = useMemo(() => csaCandidatesForJss(sales, customers), [sales, customers]);

  return (
    <div className="card" aria-label="CSAs awaiting a JSS">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>🧪 CSAs awaiting a JSS <span className="tag tgr">{rows.length}</span></div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Customers the Super Admin has converted, whose quotation the sales rep marked accepted. Pick one to fill the form below,
        correct anything, and press <b>Add Spec</b> — the JSS number is written back onto the SKU for the rep&rsquo;s PO.
      </div>
      {open && (
        <div className="tw sy" style={{ maxHeight: 260 }}>
          <table>
            <thead><tr><th style={{ width: 30 }}></th><th>Customer</th><th>SKU</th><th>Structure</th><th>Dispatch</th><th>Despatch location</th><th>Accepted price</th><th>Accepted on</th><th>CSA</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 14, color: 'var(--i3)' }}>Nothing waiting — every accepted CSA of a converted customer has its JSS.</td></tr>
                : rows.map((c) => (
                  <tr key={c.sku.id} className={picked === c.sku.id ? 'hi' : undefined}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="radio" name="csa-jss" checked={picked === c.sku.id} aria-label={`JSS from CSA ${c.sku.sku_name}`}
                        onChange={() => onPick(c.sku.id, jssFieldsFromCsa({ ...c, customers }))} />
                    </td>
                    <td style={{ fontWeight: 700 }}>{c.lead.client_name}</td>
                    <td>{c.sku.sku_name}</td>
                    <td style={{ fontSize: 11 }}>{c.sku.structure || (c.report ? csaStructure(c.report) : '—')}</td>
                    <td style={{ fontSize: 11 }}>{c.sku.dispatch_form || c.sku.dispatch_type || '—'}</td>
                    <td style={{ fontSize: 11 }}>{(c.sku.csa_request || {}).despatch_location || '—'}</td>
                    <td style={{ fontSize: 11 }}>{(c.sku.price_tiers || []).map((t) => `₹${t.price} @ ${t.qty}`).join(', ') || '—'}</td>
                    <td style={{ fontSize: 11 }}>{c.sku.quotation_accepted_at ? fmtDate(String(c.sku.quotation_accepted_at).slice(0, 10)) : '—'}</td>
                    <td>{c.report ? <span className="tag tg" style={{ fontSize: 9 }}>report {c.report.status || ''}</span> : <span className="tag ty" style={{ fontSize: 9 }}>no report</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
