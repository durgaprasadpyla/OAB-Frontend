import { useMemo, useState } from 'react';
import { fmtDate, today } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { EMPTY_FINDER, FINDER_FIELDS, finderOptions, findSuppliers, finderAoa } from '../lib/supplierFinder.js';

const PICKERS = [
  { k: 'code', label: 'Item Code', aria: 'Find suppliers by item code', any: 'Any item code', list: 'codes' },
  { k: 'materialType', label: 'Material Type', aria: 'Find suppliers by material type', any: 'Any material type', list: 'materialTypes' },
  { k: 'subGroup', label: 'Sub Group', aria: 'Find suppliers by sub group', any: 'Any sub group', list: 'subGroups' },
  { k: 'specialty', label: 'Speciality', aria: 'Find suppliers by speciality', any: 'Any speciality', list: 'specialties' },
  { k: 'description', label: 'Item Description', aria: 'Find suppliers by item description', any: 'Any item description', list: 'descriptions' },
];

const rupee = (v) => '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The rate cell: the supplier's quote, else what they were last ordered at — and which. */
function RateCell({ r }) {
  if (!r.rate) return <span style={{ color: 'var(--i3)' }}>—</span>;
  const per = r.uom ? ` / ${r.uom}` : '';
  return (
    <>
      <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{rupee(r.rate.value)}{per}</div>
      <div style={{ fontSize: 10, color: 'var(--i3)', whiteSpace: 'nowrap' }}>
        {r.rate.source === 'ASL' ? 'approved-supplier quote' : `last PO ${r.rate.poNum}${r.rate.date ? ' · ' + fmtDate(r.rate.date) : ''}`}
      </div>
      {r.rate.source === 'ASL' && r.lastPo && (
        <div style={{ fontSize: 10, color: 'var(--i3)', whiteSpace: 'nowrap' }}>
          last PO {rupee(r.lastPo.rate)} · {fmtDate(r.lastPo.date)}
        </div>
      )}
    </>
  );
}

/**
 * ④ Suppliers by Item (Issues 30.09 §PU5) — pick an item by any of the five things the
 * desk knows about it, and see every approved supplier of it (and of materials like it)
 * with who to call, their number, their payment terms and their rate.
 */
export default function SupplierFinder({ asl, pos, master }) {
  const [f, setF] = useState(EMPTY_FINDER);
  const options = useMemo(() => finderOptions({ master, asl }, f), [master, asl, f]);
  const rows = useMemo(() => findSuppliers({ asl, master, pos }, f), [asl, master, pos, f]);
  const picked = FINDER_FIELDS.some((k) => f[k]);
  const exactCount = rows.filter((r) => r.match === 'Exact').length;
  const companies = new Set(rows.map((r) => r.company.toLowerCase())).size;

  function exportXlsx() {
    exportAOA(finderAoa(rows), `Suppliers_by_item_${today()}.xlsx`, 'Suppliers');
  }

  return (
    <div className="card">
      <div className="ctitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>Suppliers by Item</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-s" style={{ height: 28 }} onClick={() => setF(EMPTY_FINDER)} disabled={!picked}>Clear</button>
          <button className="btn btn-s" style={{ height: 28 }} onClick={exportXlsx} disabled={!rows.length}>⬇ Export Excel</button>
        </span>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Pick any of these — each list narrows to what the others allow. The suppliers come from the Approved Supplier List.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 12 }}>
        {PICKERS.map((p) => {
          const list = options[p.list] || [];
          return (
            <div className="fg" key={p.k} style={{ margin: 0 }}>
              <label>{p.label}</label>
              <select value={f[p.k]} aria-label={p.aria} onChange={(e) => setF((prev) => ({ ...prev, [p.k]: e.target.value }))}>
                <option value="">{p.any}</option>
                {list.map((v) => (
                  <option key={v} value={v}>{p.k === 'code' ? (options.codeLabels[v.toUpperCase()] || v) : v}</option>
                ))}
                {f[p.k] && !list.some((v) => v.toLowerCase() === f[p.k].toLowerCase()) && <option value={f[p.k]}>{f[p.k]}</option>}
              </select>
            </div>
          );
        })}
      </div>

      {!picked ? (
        <div className="al al-b">Pick an item code, material type, sub group, speciality or item description to see who supplies it.</div>
      ) : !rows.length ? (
        <div className="al al-y">No approved supplier on file for this — nor for anything similar. The Purchase Admin maps suppliers to items on the P Dashboard.</div>
      ) : (
        <>
          <div className="pg-sub" style={{ margin: '0 0 6px' }} aria-label="Supplier finder summary">
            {companies} supplier{companies === 1 ? '' : 's'} · {exactCount} exact match{exactCount === 1 ? '' : 'es'}
            {rows.length > exactCount ? ` · ${rows.length - exactCount} for similar materials` : ''}
          </div>
          <div className="tw sy">
            <table aria-label="Suppliers for the picked item">
              <thead><tr>
                <th>Supplier</th><th>Contact Person</th><th>Contact Number</th><th>Payment Terms</th>
                <th>Item Code</th><th style={{ minWidth: 160 }}>Item Description</th><th>Material · Sub Group · Speciality</th>
                <th style={{ textAlign: 'right' }}>Rate</th><th>Match</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ fontWeight: 700 }}>{r.company}</td>
                    <td>
                      {r.contactPerson || '—'}
                      {r.altContact && <div style={{ fontSize: 10, color: 'var(--i3)' }}>{r.altContact}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.contactNumber || '—'}
                      {r.altNumber && <div style={{ fontSize: 10, color: 'var(--i3)' }}>{r.altNumber}</div>}
                    </td>
                    <td>{r.paymentTerms || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.itemCode || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.description || '—'}</td>
                    <td style={{ fontSize: 11 }}>{[r.materialType, r.subGroup, r.specialty].filter(Boolean).join(' · ') || '—'}</td>
                    <td style={{ textAlign: 'right' }}><RateCell r={r} /></td>
                    <td>
                      {r.match === 'Exact'
                        ? <span className="tag" style={{ background: '#e6f4ea', color: '#1e7e34' }}>Exact</span>
                        : <span className="tag tgr" title="Same material type and sub group as the item picked">Similar</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
