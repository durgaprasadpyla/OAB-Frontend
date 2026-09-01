import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../data.jsx';
import { ordersApi, stockApi } from '../api.js';
import { today, fmtDate, dash, rupees } from '../lib/format.js';
import { getPM, getUOM } from '../lib/pricing.js';
import { getCustLocations, getCustByLoc, jssCustomers, custGroups, custsInGroup, specVisibleTo } from '../lib/master.js';
import { fgAvail, fgAddAllocation } from '../lib/fg.js';
import FgAllocModal from '../components/FgAllocModal.jsx';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** New PO — 3-step SO creation wizard (native port of the PO ENTRY flow, legacy 1577+). */
export default function NewPO() {
  const { mods, reloadModule, save } = useData();
  const nav = useNavigate();
  const [step, setStep] = useState(1);            // 1 | 2 | 3 | 4(=success)
  const [poNum, setPoNum] = useState('');
  const [poDate, setPoDate] = useState(today());
  const [poExp, setPoExp] = useState('');
  const [group, setGroup] = useState('');
  const [customer, setCustomer] = useState('');
  const [loc, setLoc] = useState('');
  const [skus, setSkus] = useState([]);           // [{...jss, checked, qty}]
  const [selPO, setSelPO] = useState([]);
  const [added, setAdded] = useState(null);
  const [shortages, setShortages] = useState([]);   // low-stock shortfalls for the just-created SOs
  const [busy, setBusy] = useState(false);
  const [allocRows, setAllocRows] = useState(null);   // FG drawdown candidates (modal), or null

  // Group → Customer cascade. With a Customer Master loaded the customer list comes
  // from the chosen group (or the ungrouped customers when no group is picked); with
  // none it falls back to the distinct JSS customer names. (buildJSSFilters /
  // populateCustDropdown)
  const groups = useMemo(() => custGroups(mods.customers), [mods.customers]);
  const customers = useMemo(() => (
    (mods.customers && mods.customers.length) ? custsInGroup(mods.customers, group) : jssCustomers(mods.jss)
  ), [mods.customers, mods.jss, group]);
  const locations = useMemo(() => getCustLocations(mods.customers, customer), [mods.customers, customer]);

  const lastSO = (mods.oab && mods.oab.lastSO) || { y: '26', n: 400 };
  const soY = lastSO.y || '26';
  const startN = useMemo(() => {
    let mx = num(lastSO.n);
    ['SF', 'OT'].forEach((k) => ((mods.oab && mods.oab.OAB && mods.oab.OAB[k]) || []).forEach((r) => {
      const m = /^(\d{2})\/(\d+)$/.exec(String(r.so || ''));
      if (m) mx = Math.max(mx, parseInt(m[2], 10));
    }));
    return mx + 1;
  }, [mods.oab, lastSO.n]);
  const autoSO = `${soY}/${startN}`;

  const warehouse = loc ? (getCustByLoc(mods.customers, customer, loc) || {}).warehouseName || '' : '';

  // Issues 3.0 §5: the order value is quoted the way the tax invoice states it —
  // base (taxable) value, the GST on it, and the gross. 18% is the rate the invoice
  // document uses (InvoiceDoc / gstBreakup), so the preview and the bill agree.
  const GST_PCT = 18;
  const withGst = (base) => base * (1 + GST_PCT / 100);

  // Issues 3.0 §6: every SO row already in the OAB carrying this PO number
  // (case- and space-insensitive, across both sheets).
  function poDupes(po) {
    const key = String(po || '').trim().toLowerCase();
    if (!key) return [];
    return ['SF', 'OT'].flatMap((k) => ((mods.oab && mods.oab.OAB && mods.oab.OAB[k]) || []))
      .filter((r) => String(r.poNum || '').trim().toLowerCase() === key);
  }

  function onCustomer(cu) {
    setCustomer(cu);
    setSkus([]);
    const locs = getCustLocations(mods.customers, cu);
    setLoc(locs.length === 1 ? locs[0].dispatchLoc : '');
  }

  // Changing the group clears everything downstream — customer, location and any SKU
  // rows already built for a previous customer. (onGroupSelect)
  function onGroup(g) {
    setGroup(g);
    setCustomer('');
    setLoc('');
    setSkus([]);
  }

  function goStep2() {
    if (!poNum.trim()) return alert('Enter PO Number');
    if (!poDate) return alert('Enter PO Date');
    if (!customer) return alert('Select Customer');
    if (!loc.trim()) return alert('Select / enter Dispatch Location');
    // Issues 3.0 §6: the same PO raised twice is the commonest duplicate-SO cause.
    // Warn — don't block: a genuine amendment / second batch against one customer PO
    // is legitimate, so the operator decides.
    const dupes = poDupes(poNum);
    if (dupes.length && !window.confirm(
      `PO Number is already in OAB. Do you want to continue?\n\n`
      + `PO ${poNum.trim()} is already on ${dupes.length} sales order${dupes.length > 1 ? 's' : ''}: `
      + dupes.slice(0, 8).map((r) => r.so).join(', ') + (dupes.length > 8 ? ', …' : '')
      + `\nCustomer: ${dupes[0].customer || '—'}`)) return;
    // Only ACTIVE specs are orderable, and only those this customer may see under the
    // group rules — a redundant or another company's spec must not appear at all.
    // (buildSKUTable / specVisibleTo)
    const list = (mods.jss || [])
      .filter((r) => String(r.status || '').trim().toLowerCase() === 'active' && specVisibleTo(r, customer, mods.customers))
      .reverse()
      .map((s) => ({ ...s, checked: false, qty: '' }));
    setSkus(list);
    setStep(2);
  }

  function toggleAll(on) { setSkus((xs) => xs.map((s) => ({ ...s, checked: on }))); }
  function setRow(i, patch) { setSkus((xs) => xs.map((s, j) => (j === i ? { ...s, ...patch } : s))); }

  function goStep3() {
    const chosen = skus.filter((s) => s.checked);
    if (!chosen.length) return alert('Select at least one SKU');
    for (const s of chosen) if (!num(s.qty)) return alert('Enter qty for: ' + String(s.jobName || '').slice(0, 40));
    let n = startN;
    const rows = chosen.map((s) => ({
      so: `${soY}/${n++}`, spec: s.spec, jobName: s.jobName, jobType: s.jobType, subBrand: s.subBrand || '',
      customer, dispLoc: loc, warehouseName: (getCustByLoc(mods.customers, customer, loc) || {}).warehouseName || '',
      poNum: poNum.trim(), poDate, poExp, poQty: num(s.qty), invDisp: 0, manDisp: 0, fg: 0, stage: '',
      width: s.width, material: s.material, mic: s.mic, height: s.height, filmWidth: s.filmWidth,
      gsm: s.gsm, dispatchForm: s.dispatchForm || '', pouchingMachines: s.pouchingMachines || '',
    }));
    setSelPO(rows);
    setStep(3);
  }

  async function submit() {
    setBusy(true);
    try {
      // Send the chosen SKUs; the server assigns each SO number atomically and
      // returns them. The SO numbers shown in the Confirm step are a provisional
      // preview — the authoritative numbers come back here.
      const items = selPO.map((r) => ({
        spec: r.spec, jobName: r.jobName, jobType: r.jobType, subBrand: r.subBrand, poQty: r.poQty,
        width: r.width, material: r.material, mic: r.mic, height: r.height, filmWidth: r.filmWidth,
        gsm: r.gsm, dispatchForm: r.dispatchForm, pouchingMachines: r.pouchingMachines,
      }));
      const resp = await ordersApi.createSalesOrders({ poNum: poNum.trim(), poDate, poExp, customer, dispLoc: loc, items });
      await reloadModule('oab');
      const created = (resp && resp.created) || [];
      setAdded({ count: created.length, first: created[0], last: created[created.length - 1] });
      setStep(4);
      // Best-effort low-stock check for the just-created SOs (§8): compute material
      // requirements against the BOM + stock and surface any shortfall. The server
      // also raises SO-specific alerts + notifies Plant Manager / Stores / Super Admin.
      // Purely additive — a failure here never affects the already-created SOs.
      setShortages([]);
      Promise.all(created.map((so) => stockApi.check(so).catch(() => null)))
        .then((results) => {
          const short = [];
          results.forEach((r) => { if (r && Array.isArray(r.requirements)) r.requirements.filter((x) => x.short).forEach((x) => short.push({ so: r.so, ...x })); });
          setShortages(short);
        })
        .catch(() => {});
      // Offer to draw down existing finished goods for any created SO whose spec
      // has FG in stock. The server assigns SO numbers in item order, so
      // created[i] corresponds to selPO[i]; only map when the lengths agree so a
      // mismatch never mis-attributes an allocation.
      if (created.length === selPO.length) {
        const cands = created
          .map((so, i) => ({ so, spec: selPO[i].spec, jobName: selPO[i].jobName, avail: fgAvail(mods.fgLedger, selPO[i].spec) }))
          .filter((c) => c.spec && c.avail > 0);
        if (cands.length) setAllocRows(cands);
      }
    } catch (e) {
      alert('Save failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  // Apply the FG drawdown chosen in the modal: record each allocation in the
  // ledger (module 9) and set the SO row's fg (reduces its balance). Best-effort
  // and additive — it never blocks the already-created SOs.
  async function applyAlloc(plan) {
    setBusy(true);
    try {
      await save('fgLedger', (prev) => plan.reduce((led, p) => fgAddAllocation(led, p.spec, p.qty, p.so, 'new-po'), prev));
      for (const p of plan) await ordersApi.dispatch({ so: p.so, fg: p.qty });
      await reloadModule('oab');
      setAllocRows(null);
    } catch (e) {
      alert('FG allocation failed (the SOs were still created): ' + e.message);
      await reloadModule('oab');
      setAllocRows(null);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPoNum(''); setPoExp(''); setGroup(''); setCustomer(''); setLoc(''); setSkus([]); setSelPO([]); setAdded(null);
    setShortages([]); setPoDate(today()); setStep(1);
  }

  const activeCount = skus.length;

  return (
    <div id="app">
      <div className="pg-ttl">New PO Entry</div>
      <div className="pg-sub">Fill PO details and location → select SKUs → verify prices → submit</div>

      {!(mods.jss || []).length && (
        <div className="al al-y">⚠ No JSS loaded yet. Add specs via <strong>Dashboard → JSS Editor</strong> (admin) or <strong>QC login → Add New Spec</strong>.</div>
      )}

      <div className="step-bar">
        <div className={'step-tab' + (step === 1 ? ' on' : step > 1 ? ' done' : '')}>① PO &amp; Location</div>
        <div className={'step-tab' + (step === 2 ? ' on' : step > 2 ? ' done' : '')}>② Select SKUs</div>
        <div className={'step-tab' + (step >= 3 ? ' on' : '')}>③ Confirm</div>
      </div>

      {step === 1 && (
        <div className="card">
          <div className="ctitle">Purchase Order Details</div>
          <div className="g4">
            <div className="fg"><label>PO Number *</label><input value={poNum} onChange={(e) => setPoNum(e.target.value)} placeholder="e.g. OK-21631114" />
              {/* Issues 3.0 §6: flagged as you type as well as on Next, so a duplicate
                  PO is obvious before any SKU work is done. */}
              {poDupes(poNum).length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600, marginTop: 3 }}>
                  ⚠ PO Number is already in OAB — {poDupes(poNum).map((r) => r.so).slice(0, 4).join(', ')}{poDupes(poNum).length > 4 ? ', …' : ''}
                </div>
              )}
            </div>
            <div className="fg"><label>PO Date *</label><input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} /></div>
            <div className="fg"><label>PO Expiry</label><input type="date" value={poExp} onChange={(e) => setPoExp(e.target.value)} /></div>
            {/* Read-only: the server assigns the real SO numbers atomically on submit,
                so this is the preview of where the run will start. */}
            <div className="fg"><label>Starting SO # <span style={{ fontWeight: 400, color: 'var(--i3)' }}>(auto)</span></label><input value={autoSO} readOnly /></div>
          </div>
          <div className="g2">
            <div className="fg"><label>Group</label>
              <select value={group} aria-label="Group" onChange={(e) => onGroup(e.target.value)}>
                <option value="">— Select Group —</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--i3)', marginTop: 3 }}>Pick a group, or leave blank for a customer with no group.</div>
            </div>
            <div className="fg"><label>Customer *</label>
              <select value={customer} aria-label="Customer" onChange={(e) => onCustomer(e.target.value)}>
                <option value="">{group ? '— Select Customer —' : '— Select Customer (no group) —'}</option>
                {customers.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="g2">
            <div className="fg"><label>Dispatch Location * <span style={{ fontWeight: 400, color: 'var(--i3)' }}>(applies to all SKUs)</span></label>
              {locations.length ? (
                <select value={loc} aria-label="Dispatch Location" onChange={(e) => setLoc(e.target.value)}>
                  <option value="">— Select Location —</option>
                  {locations.map((l) => <option key={l.dispatchLoc} value={l.dispatchLoc}>{l.dispatchLoc}{l.warehouseName ? ` (${l.warehouseName})` : ''}</option>)}
                </select>
              ) : (
                <input value={loc} aria-label="Dispatch Location" onChange={(e) => setLoc(e.target.value)} placeholder="Dispatch location" />
              )}
              <div style={{ fontSize: 11, color: 'var(--g)', marginTop: 3 }}>{warehouse ? '🏭 Warehouse: ' + warehouse : ''}</div>
            </div>
            <div className="fg" />
          </div>
          <div className="act"><button className="btn btn-g" onClick={goStep2}>Next: Select SKUs →</button></div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div className="ctitle" style={{ marginBottom: 2 }}>SKUs for <span style={{ color: 'var(--g)', textTransform: 'none', fontWeight: 700 }}>{customer}</span></div>
              <div style={{ fontSize: 11, color: 'var(--i3)' }}>{activeCount} active spec{activeCount === 1 ? '' : 's'}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--i2)' }}>📍 Location: <strong>{loc}</strong></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input type="checkbox" className="cb" checked={skus.length > 0 && skus.every((s) => s.checked)} onChange={(e) => toggleAll(e.target.checked)} /> Select all active
            </label>
            <span style={{ color: 'var(--bd)' }}>|</span>
            <span style={{ color: 'var(--i3)' }}>Tick SKUs in this PO → enter qty</span>
          </div>
          <div className="tw sy">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th style={{ width: 72 }}>Spec</th><th style={{ minWidth: 180 }}>Job Name</th>
                  <th style={{ minWidth: 100 }}>Sub Brand</th><th style={{ width: 80 }}>Disp Form</th>
                  <th style={{ width: 42 }}>W</th><th style={{ width: 42 }}>H</th><th style={{ width: 38 }}>Mic</th>
                  <th style={{ width: 70 }}>PO Qty*</th><th style={{ width: 50 }}>UOM</th><th style={{ width: 80 }}>Rate (₹)</th>
                </tr>
              </thead>
              <tbody>
                {skus.length === 0 ? (
                  <tr><td colSpan={11} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No active specs found for this customer</td></tr>
                ) : skus.map((s, i) => {
                  const rate = getPM(s.spec, mods.prices).price;
                  return (
                    <tr key={i} className={s.checked ? 'hi' : ''}>
                      <td><input type="checkbox" className="cb" aria-label={`Select ${s.spec}`} checked={s.checked} onChange={(e) => setRow(i, { checked: e.target.checked })} /></td>
                      <td><span className="tag tb" style={{ fontSize: 10 }}>{s.spec}</span></td>
                      <td style={{ fontSize: 11 }}>{s.jobName}</td>
                      <td style={{ fontSize: 11 }}>{s.subBrand || '-'}</td>
                      <td style={{ fontSize: 11 }}>{s.dispatchForm || '-'}</td>
                      <td>{s.width || '-'}</td><td>{s.height || '-'}</td><td>{s.mic || '-'}</td>
                      <td><input type="number" min="1" placeholder="0" disabled={!s.checked} value={s.qty} aria-label={`PO qty for ${s.spec}`}
                        style={{ width: 60, opacity: s.checked ? 1 : 0.4 }} onChange={(e) => setRow(i, { qty: e.target.value })} /></td>
                      <td style={{ fontSize: 11, fontWeight: 600, color: 'var(--g)', textAlign: 'center' }}>{getUOM(s.dispatchForm)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--g)' }}>{rate > 0 ? '₹' + rate.toFixed(2) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Issues 3.0 §5: the order value as you build it — base (pre-GST) price,
              the GST on it and the gross, so both figures are on screen before Review. */}
          {(() => {
            const chosen = skus.filter((x) => x.checked && num(x.qty) > 0);
            const base = chosen.reduce((t, x) => t + num(x.qty) * getPM(x.spec, mods.prices).price, 0);
            return (
              <div className="al al-y" style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', marginTop: 10 }}>
                <span><strong>{chosen.length}</strong> SKU{chosen.length === 1 ? '' : 's'} selected</span>
                <span>Total Qty: <strong>{dash(chosen.reduce((t, x) => t + num(x.qty), 0))}</strong></span>
                <span>Base Value (without GST): <strong>{rupees(base)}</strong></span>
                <span>GST @ {GST_PCT}%: <strong>{rupees(withGst(base) - base)}</strong></span>
                <span>Total (with GST): <strong style={{ color: 'var(--g)' }}>{rupees(withGst(base))}</strong></span>
              </div>
            );
          })()}
          <div className="act">
            <button className="btn btn-s" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-g" onClick={goStep3}>Review →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <div className="ctitle">Confirm — these rows will be added to OAB</div>
          <div className="al al-y" style={{ marginBottom: 10 }}>⚠ Check before confirming.</div>
          <div className="tw">
            <table>
              <thead><tr>
                <th>SO#</th><th>Spec</th><th style={{ minWidth: 170 }}>Job Name</th><th>Type</th>
                <th>Customer</th><th>Location</th><th>PO#</th><th>Date</th><th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ width: 50 }}>UOM</th>
                <th style={{ textAlign: 'right' }}>Base Price (₹) <span style={{ fontWeight: 400 }}>per unit</span></th>
                <th style={{ textAlign: 'right' }}>Base Value (₹) <span style={{ fontWeight: 400 }}>without GST</span></th>
                <th style={{ textAlign: 'right' }}>Total (₹) <span style={{ fontWeight: 400 }}>with {GST_PCT}% GST</span></th>
              </tr></thead>
              <tbody>
                {/* Rate is re-read from the Price Master here (not carried from step 2)
                    so the Confirm step is a second, independent price verification.
                    Issues 3.0 §5: the base (pre-GST) price and value are shown alongside
                    the GST-inclusive total, matching how the tax invoice states them. */}
                {selPO.map((r) => {
                  const rate = getPM(r.spec, mods.prices).price;
                  const base = num(r.poQty) * rate;
                  return (
                    <tr key={r.so}>
                      <td><span className="so-pill">{r.so}</span></td>
                      <td><span className="tag tb">{r.spec}</span></td>
                      <td style={{ fontSize: 11 }}>{r.jobName}</td>
                      <td><span className={'tag ' + (r.jobType === 'StayFresh' ? 'tg' : 'tgr')}>{r.jobType}</span></td>
                      <td style={{ fontSize: 11 }}>{r.customer}</td>
                      <td style={{ fontSize: 11 }}>{r.dispLoc}</td>
                      <td style={{ fontSize: 11 }}>{r.poNum}</td>
                      <td style={{ fontSize: 11 }}>{fmtDate(r.poDate)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{dash(r.poQty)}</td>
                      <td style={{ fontSize: 11, fontWeight: 600, color: 'var(--g)', textAlign: 'center' }}>{getUOM(r.dispatchForm)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{rate > 0 ? '₹' + rate.toFixed(2) : '-'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{rate > 0 ? rupees(base) : '-'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--g)' }}>{rate > 0 ? rupees(withGst(base)) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Issues 3.0 §5: the grand total is stated twice — without GST and with
                  GST — with the tax between them, so both figures are read off directly. */}
              <tfoot>
                {(() => {
                  const base = selPO.reduce((t, r) => t + num(r.poQty) * getPM(r.spec, mods.prices).price, 0);
                  return (
                    <>
                      <tr>
                        <td colSpan={12} style={{ textAlign: 'right', fontWeight: 700 }}>Grand Total (without GST)</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupees(base)}</td>
                      </tr>
                      <tr>
                        <td colSpan={12} style={{ textAlign: 'right', fontWeight: 600, color: 'var(--i3)' }}>GST @ {GST_PCT}%</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--i3)' }}>{rupees(withGst(base) - base)}</td>
                      </tr>
                      <tr>
                        <td colSpan={12} style={{ textAlign: 'right', fontWeight: 700 }}>Grand Total (with {GST_PCT}% GST)</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--g)' }}>{rupees(withGst(base))}</td>
                      </tr>
                    </>
                  );
                })()}
              </tfoot>
            </table>
          </div>
          <div className="act">
            <button className="btn btn-s" onClick={() => setStep(2)} disabled={busy}>← Back</button>
            <button className="btn btn-g" onClick={submit} disabled={busy}>{busy ? 'Writing…' : '✓ Add to OAB'}</button>
          </div>
        </div>
      )}

      {step === 4 && added && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
          <div style={{ fontSize: 14, color: 'var(--g)', fontWeight: 600, marginBottom: 14 }}>
            {added.count} row{added.count > 1 ? 's' : ''} added &nbsp;·&nbsp; SO{added.count > 1 ? 's' : ''}:{' '}
            <span className="so-pill">{added.first}</span>{added.count > 1 ? <> → <span className="so-pill">{added.last}</span></> : null}
          </div>
          {shortages.length > 0 && (
            <div className="al al-r" style={{ textAlign: 'left', margin: '0 auto 14px', maxWidth: 640 }}>
              <b>⚠ Low stock on {shortages.length} item{shortages.length > 1 ? 's' : ''}.</b> Stores &amp; Super Admin have been alerted.
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {shortages.map((s, i) => (
                  <li key={i}><span className="so-pill">{s.so}</span> {s.itemCode} short by <b>{s.shortageQty}</b> (need {s.requiredQty}, have {s.availableQty})</li>
                ))}
              </ul>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn btn-g" onClick={reset}>+ New PO</button>
            <button className="btn btn-s" onClick={() => nav('/oab?sheet=SF')}>View OAB →</button>
          </div>
        </div>
      )}

      {allocRows && (
        <FgAllocModal rows={allocRows} busy={busy} onConfirm={applyAlloc} onCancel={() => setAllocRows(null)} />
      )}
    </div>
  );
}
