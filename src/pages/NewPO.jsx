import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { ordersApi } from '../api.js';
import { today, fmtDate, dash } from '../lib/format.js';
import { getPM, getUOM } from '../lib/pricing.js';
import { getCustLocations, getCustByLoc, jssCustomers } from '../lib/master.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** New PO — 3-step SO creation wizard (native port of the PO ENTRY flow, legacy 1577+). */
export default function NewPO() {
  const { mods, reloadModule } = useData();
  const [step, setStep] = useState(1);            // 1 | 2 | 3 | 4(=success)
  const [poNum, setPoNum] = useState('');
  const [poDate, setPoDate] = useState(today());
  const [poExp, setPoExp] = useState('');
  const [customer, setCustomer] = useState('');
  const [loc, setLoc] = useState('');
  const [skus, setSkus] = useState([]);           // [{...jss, checked, qty}]
  const [selPO, setSelPO] = useState([]);
  const [added, setAdded] = useState(null);
  const [busy, setBusy] = useState(false);

  const customers = useMemo(() => jssCustomers(mods.jss), [mods.jss]);
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

  function onCustomer(cu) {
    setCustomer(cu);
    const locs = getCustLocations(mods.customers, cu);
    setLoc(locs.length === 1 ? locs[0].dispatchLoc : '');
  }

  function goStep2() {
    if (!poNum.trim()) return alert('Enter PO Number');
    if (!poDate) return alert('Enter PO Date');
    if (!customer) return alert('Select Customer');
    if (!loc.trim()) return alert('Select / enter Dispatch Location');
    const list = (mods.jss || []).filter((r) => r.customer === customer).reverse()
      .map((s) => ({ ...s, checked: false, qty: '' }));
    setSkus(list);
    setStep(2);
  }

  function toggleAll(on) { setSkus((xs) => xs.map((s) => (s.status === 'Redundant' ? s : { ...s, checked: on }))); }
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
      printMC: '', lamMC: '', pouchMC: '',
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
    } catch (e) {
      alert('Save failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPoNum(''); setPoExp(''); setCustomer(''); setLoc(''); setSkus([]); setSelPO([]); setAdded(null);
    setPoDate(today()); setStep(1);
  }

  const activeCount = skus.filter((s) => s.status === 'Active').length;

  return (
    <div id="app">
      <div className="pg-ttl">New PO / Enter SO</div>
      <div className="pg-sub">Create sales orders from a customer purchase order.</div>

      <div className="step-bar">
        <div className={'step-tab' + (step === 1 ? ' on' : step > 1 ? ' done' : '')}>1 · PO Details</div>
        <div className={'step-tab' + (step === 2 ? ' on' : step > 2 ? ' done' : '')}>2 · Select SKUs</div>
        <div className={'step-tab' + (step >= 3 ? ' on' : '')}>3 · Confirm</div>
      </div>

      {step === 1 && (
        <div className="card">
          <div className="ctitle">Purchase Order</div>
          <div className="g3">
            <div className="fg"><label>PO Number</label><input value={poNum} onChange={(e) => setPoNum(e.target.value)} placeholder="Customer PO #" /></div>
            <div className="fg"><label>PO Date</label><input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} /></div>
            <div className="fg"><label>PO Expiry (optional)</label><input type="date" value={poExp} onChange={(e) => setPoExp(e.target.value)} /></div>
            <div className="fg"><label>Customer</label>
              <select value={customer} onChange={(e) => onCustomer(e.target.value)}>
                <option value="">— Select Customer —</option>
                {customers.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="fg"><label>Dispatch Location</label>
              {locations.length ? (
                <select value={loc} onChange={(e) => setLoc(e.target.value)}>
                  <option value="">— Select Location —</option>
                  {locations.map((l) => <option key={l.dispatchLoc} value={l.dispatchLoc}>{l.dispatchLoc}{l.warehouseName ? ` (${l.warehouseName})` : ''}</option>)}
                </select>
              ) : (
                <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Dispatch location" />
              )}
            </div>
            <div className="fg"><label>Auto SO # (start)</label><input value={autoSO} readOnly /></div>
          </div>
          {warehouse && <div className="al al-g" style={{ marginTop: 8 }}>🏭 Warehouse: {warehouse}</div>}
          {!customers.length && <div className="al al-y" style={{ marginTop: 8 }}>No JSS specs loaded — add specs (QC / JSS Editor) before creating a PO.</div>}
          <div className="act"><button className="btn btn-g" onClick={goStep2}>Next → Select SKUs</button></div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <div className="ctitle">SKUs for {customer} — {skus.length} specs · {activeCount} active · dispatch to {loc}</div>
          <div className="tw sy">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }}><input type="checkbox" className="cb" onChange={(e) => toggleAll(e.target.checked)} /></th>
                  <th>Spec</th><th>Job Name</th><th>Sub Brand</th><th>Form</th><th>W</th><th>H</th><th>Mic</th>
                  <th style={{ width: 90 }}>PO Qty</th><th>UOM</th><th style={{ textAlign: 'right' }}>Rate</th>
                </tr>
              </thead>
              <tbody>
                {skus.length === 0 ? (
                  <tr><td colSpan={11} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No specs found for this customer</td></tr>
                ) : skus.map((s, i) => {
                  const redundant = s.status === 'Redundant';
                  const rate = getPM(s.spec, mods.prices).price;
                  return (
                    <tr key={i} className={s.checked ? 'hi' : ''} style={redundant ? { opacity: 0.5 } : undefined}>
                      <td><input type="checkbox" className="cb" disabled={redundant} checked={s.checked} onChange={(e) => setRow(i, { checked: e.target.checked })} /></td>
                      <td><span className="tag tb" style={{ fontSize: 10 }}>{s.spec}</span></td>
                      <td style={{ fontSize: 11 }}>{s.jobName}</td>
                      <td style={{ fontSize: 11 }}>{s.subBrand || '-'}</td>
                      <td style={{ fontSize: 11 }}>{s.dispatchForm || '-'}</td>
                      <td>{s.width || '-'}</td><td>{s.height || '-'}</td><td>{s.mic || '-'}</td>
                      <td><input type="number" min="1" placeholder="0" disabled={!s.checked} value={s.qty}
                        style={{ width: 70, opacity: s.checked ? 1 : 0.4 }} onChange={(e) => setRow(i, { qty: e.target.value })} /></td>
                      <td style={{ fontSize: 11, fontWeight: 600, color: 'var(--g)', textAlign: 'center' }}>{getUOM(s.dispatchForm)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--g)' }}>{rate > 0 ? '₹' + rate.toFixed(2) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="act">
            <button className="btn btn-s" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-g" onClick={goStep3}>Next → Confirm</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <div className="ctitle">Confirm — {selPO.length} SO{selPO.length > 1 ? 's' : ''} will be created</div>
          <div className="tw">
            <table>
              <thead><tr><th>SO#</th><th>Spec</th><th>Job Name</th><th>Type</th><th>Customer</th><th>Disp Loc</th><th>PO#</th><th>PO Date</th><th style={{ textAlign: 'right' }}>Qty</th></tr></thead>
              <tbody>
                {selPO.map((r) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="act">
            <button className="btn btn-s" onClick={() => setStep(2)} disabled={busy}>← Back</button>
            <button className="btn btn-g" onClick={submit} disabled={busy}>{busy ? 'Writing…' : `✓ Create ${selPO.length} SO${selPO.length > 1 ? 's' : ''}`}</button>
          </div>
        </div>
      )}

      {step === 4 && added && (
        <div className="card">
          <div className="al al-g" style={{ fontSize: 14 }}>
            ✅ {added.count} row{added.count > 1 ? 's' : ''} added &nbsp;·&nbsp; SO{added.count > 1 ? 's' : ''}:{' '}
            <span className="so-pill">{added.first}</span>{added.count > 1 ? <> → <span className="so-pill">{added.last}</span></> : null}
          </div>
          <div className="act"><button className="btn btn-g" onClick={reset}>+ New PO</button></div>
        </div>
      )}
    </div>
  );
}
