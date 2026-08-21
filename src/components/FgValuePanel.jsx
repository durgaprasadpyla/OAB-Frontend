import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { inr } from '../lib/format.js';
import { getPM } from '../lib/pricing.js';
import { custGroupOf } from '../lib/master.js';
import { fgSpecsWithActivity, fgAvail, fgAgeingInfo, fgAddProduction, fgTodayISO } from '../lib/fg.js';

const nfmt = (v) => Math.round(Number(v) || 0).toLocaleString('en-IN');

/**
 * 💹 FG Value — stock on hand valued at the Price Master sale price.
 *
 * A Dashboard tab (`dash-fgval-panel` in the production monolith, renderFGValue),
 * NOT part of the FG Entry screen: it reads sale prices, so it lives with the other
 * super-admin costing views.
 */
export default function FgValuePanel() {
  const { mods, save } = useData();
  const { role } = useAuth();
  const ledger = mods.fgLedger || {};
  const jss = Array.isArray(mods.jss) ? mods.jss : [];
  const prices = mods.prices || {};

  const [fCust, setFCust] = useState('');
  const [fSku, setFSku] = useState('');
  const [fSpec, setFSpec] = useState('');
  const [sort, setSort] = useState('value-desc');
  const [msg, setMsg] = useState(null);

  const jssFor = (sp) => jss.find((j) => String(j.spec || '').trim() === String(sp).trim()) || {};

  // Only specs with FG actually on hand. "Customer Or Group" is the buying group
  // when the customer has one, so a group's stock reads as one line of business.
  const rows = useMemo(() => {
    const out = fgSpecsWithActivity(ledger)
      .map((sp) => {
        const j = jssFor(sp);
        const av = fgAvail(ledger, sp);
        const price = Number(getPM(sp, prices).price) || 0;
        const ag = fgAgeingInfo(ledger, sp);
        return {
          spec: sp,
          customer: j.customer ? custGroupOf(j.customer, mods.customers) : '',
          sku: j.jobName || '',
          av, price, value: av * price, agingDays: ag.days, ageing: ag.display,
        };
      })
      .filter((r) => r.av > 0.0001)
      .filter((r) => !fCust.trim() || String(r.customer).toLowerCase().includes(fCust.trim().toLowerCase()))
      .filter((r) => !fSku.trim() || String(r.sku).toLowerCase().includes(fSku.trim().toLowerCase()))
      .filter((r) => !fSpec.trim() || String(r.spec).toLowerCase().includes(fSpec.trim().toLowerCase()));

    if (sort === 'value-desc') out.sort((a, b) => b.value - a.value);
    else if (sort === 'aging-desc') out.sort((a, b) => b.agingDays - a.agingDays);
    else if (sort === 'aging-asc') out.sort((a, b) => a.agingDays - b.agingDays);
    else out.sort((a, b) => String(a.spec).localeCompare(String(b.spec), undefined, { numeric: true }));
    return out;
  }, [ledger, jss, prices, mods.customers, fCust, fSku, fSpec, sort]);

  const totals = useMemo(() => ({
    qty: rows.reduce((s, r) => s + r.av, 0),
    value: rows.reduce((s, r) => s + r.value, 0),
  }), [rows]);

  const custOptions = useMemo(() => [...new Set(rows.map((r) => r.customer).filter(Boolean))].sort(), [rows]);
  const skuOptions = useMemo(() => [...new Set(rows.map((r) => r.sku).filter(Boolean))].sort(), [rows]);

  function clearFilters() { setFCust(''); setFSku(''); setFSpec(''); }

  /**
   * Super-admin correction of a spec's Available FG. Recorded as a normal dated
   * production entry holding the DELTA (negative when reducing) so the ledger stays
   * append-only and the FIFO ageing pool still reconciles. (fgvalEditAvailable)
   */
  async function editAvailable(sp) {
    const cur = fgAvail(ledger, sp);
    const raw = window.prompt(`Set Available FG for ${sp} (currently ${inr(cur)}):`, String(Math.round(cur)));
    if (raw === null) return;
    const next = Number(raw);
    if (!Number.isFinite(next) || next < 0) { window.alert('Enter a valid quantity (0 or more).'); return; }
    const delta = next - cur;
    if (Math.abs(delta) < 0.0001) return;
    try {
      await save('fgLedger', (prev) => fgAddProduction(prev, sp, fgTodayISO(), delta, 'Manual adjustment via FG Value (Super Admin)', { allowNegative: true }));
      setMsg({ t: 'g', text: `✅ Available FG for ${sp} set to ${inr(next)}.` });
    } catch (e) {
      setMsg({ t: 'r', text: 'Save failed: ' + (e && e.message ? e.message : String(e)) });
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div className="ctitle" style={{ marginBottom: 0 }}>💹 FG Value — Stock on hand, valued at Sale Price</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input
          list="fgval-cust-list" value={fCust} aria-label="Filter by customer or group"
          placeholder="Filter: Customer or Group..." onChange={(e) => setFCust(e.target.value)}
          style={{ height: 30, border: '1px solid var(--bd)', borderRadius: 6, padding: '0 10px', fontSize: 12, width: 190 }}
        />
        <datalist id="fgval-cust-list">{custOptions.map((c) => <option key={c} value={c} />)}</datalist>
        <input
          list="fgval-sku-list" value={fSku} aria-label="Filter by SKU"
          placeholder="Filter: SKU / Job Name..." onChange={(e) => setFSku(e.target.value)}
          style={{ height: 30, border: '1px solid var(--bd)', borderRadius: 6, padding: '0 10px', fontSize: 12, width: 190 }}
        />
        <datalist id="fgval-sku-list">{skuOptions.map((c) => <option key={c} value={c} />)}</datalist>
        <input
          list="fgval-spec-list" value={fSpec} aria-label="Filter by spec"
          placeholder="Filter: JSS / Spec #..." onChange={(e) => setFSpec(e.target.value)}
          style={{ height: 30, border: '1px solid var(--bd)', borderRadius: 6, padding: '0 10px', fontSize: 12, width: 160 }}
        />
        <datalist id="fgval-spec-list">{rows.map((r) => <option key={r.spec} value={r.spec} />)}</datalist>
        <select
          value={sort} aria-label="Sort FG value" onChange={(e) => setSort(e.target.value)}
          style={{ height: 30, border: '1px solid var(--bd)', borderRadius: 6, padding: '0 8px', fontSize: 12, marginLeft: 'auto' }}
        >
          <option value="value-desc">Sort: FG Value (High → Low)</option>
          <option value="aging-desc">Sort: Days Lying (Oldest first)</option>
          <option value="aging-asc">Sort: Days Lying (Newest first)</option>
          <option value="spec-asc">Sort: Spec (A → Z)</option>
        </select>
        <button
          onClick={clearFilters}
          style={{ height: 30, padding: '0 12px', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--wh)', fontSize: 12, cursor: 'pointer', color: 'var(--i2)' }}
        >✕ Clear</button>
      </div>

      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <p style={{ fontSize: 11, color: 'var(--i3)', marginBottom: 10 }}>
        Only specs with FG currently in stock (produced minus allocated) are listed. Value = Available Qty × Price Master
        Sale Price. “Days Lying” shows the OLDEST unconsumed FG batch for that spec, aged from its FG Entry date, with its
        quantity in brackets — since FIFO means that batch is dispatched first. Once it’s fully allocated to a sale order,
        this column moves on to the next batch, aged from its own entry date. Click ✏️ next to a quantity to correct it —
        the correction is logged as a dated production entry and shows up in that spec’s Production History on the FG Entry page.
      </p>

      <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 14, padding: '12px 16px', borderRadius: 8, background: 'var(--gl)', border: '1px solid #A8D5B8' }}>
        <div>
          <span style={{ fontSize: 10, color: 'var(--i3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Total FG in Stock</span><br />
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--g)' }}>{nfmt(totals.qty)}</span> <span style={{ fontSize: 12, color: 'var(--i2)' }}>pouches</span>
        </div>
        <div style={{ borderLeft: '1px solid var(--bd)', paddingLeft: 24 }}>
          <span style={{ fontSize: 10, color: 'var(--i3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Total FG Value</span><br />
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--g)' }}>₹{inr(totals.value, 2)}</span>
        </div>
      </div>

      <div className="tw sy">
        <table>
          <thead><tr>
            <th>Spec</th><th style={{ minWidth: 160 }}>Customer Or Group</th><th style={{ minWidth: 160 }}>SKU / Job Name</th>
            <th style={{ textAlign: 'right' }}>Available Qty</th><th style={{ textAlign: 'right' }}>Sale Price</th>
            <th style={{ textAlign: 'right' }}>FG Value</th><th style={{ minWidth: 180 }}>Days Lying (Qty)</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--i3)' }}>No FG currently in stock</td></tr>
            ) : rows.map((r) => (
              <tr key={r.spec}>
                <td><span className="tag tb">{r.spec}</span></td>
                <td style={{ fontSize: 11 }}>{r.customer || '-'}</td>
                <td style={{ fontSize: 11 }}>{r.sku || '-'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--g)' }}>
                  {nfmt(r.av)}
                  {role === 'superadmin' && (
                    <button
                      onClick={() => editAvailable(r.spec)} title="Edit Available FG"
                      style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--i3)', padding: '0 2px', verticalAlign: 'middle' }}
                    >✏️</button>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{r.price > 0 ? '₹' + inr(r.price, 2) : '-'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--g)' }}>{r.value > 0 ? '₹' + inr(r.value, 2) : '-'}</td>
                <td style={{ fontSize: 11 }}>{r.ageing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
