import { Fragment, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { purchaseApi } from '../api.js';
import { parsePaymentDays, num } from '../lib/calc.js';
import { today, fmtDate, rupees } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import PurchaseOrderModal from '../components/PurchaseOrderDoc.jsx';

// ── Local helpers (kept in this file — shared libs are read-only for this port) ──

/** Quantity display: Indian grouping, up to 2 decimals, no forced trailing zeros. */
const qtyStr = (v) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** PO status → legacy .tag colour (Open→ty, Partial→tb, Closed→tg). */
function statusTag(status) {
  const s = status || 'Open';
  const cls = s === 'Closed' ? 'tg' : s === 'Partial' ? 'tb' : 'ty';
  return <span className={'tag ' + cls}>{s}</span>;
}

const EMPTY_ROW = { item: '', unit: '', qty: '', rate: '' };
const textareaStyle = {
  minHeight: 54, border: '1px solid var(--bd)', borderRadius: 7, padding: '8px 10px',
  fontSize: 13, color: 'var(--ink)', background: 'var(--wh)', fontFamily: 'inherit', resize: 'vertical',
};

/**
 * Purchase — native port of the legacy Purchase login (PO / GRN / Payments).
 * Legacy source: index.html pvGeneratePO, purchRenderTrackTable, pvOpenGRNModal,
 * pvApplyGRNInputs, pvSaveGRN, pvForceCloseGRN, pvReopenPO, pvMarkPaid/Unpaid,
 * purchDueDate. Module 6 shape: { asl, pos, priceHistory, counter, itemsExtra }.
 */
export default function Purchase() {
  const { mods, reloadModule } = useData();

  const [tab, setTab] = useState('gen'); // 'gen' | 'track' | 'pay'
  const [busy, setBusy] = useState(false);

  // Generate-PO form state
  const [supplier, setSupplier] = useState('');
  const [items, setItems] = useState([{ ...EMPTY_ROW }]);
  const [expected, setExpected] = useState('');
  const [gst, setGst] = useState('');
  const [notes, setNotes] = useState('');
  const [genMsg, setGenMsg] = useState(null); // { t:'g'|'r', m }

  // GRN state
  const [grnFor, setGrnFor] = useState(null); // poNum being received
  const [docPo, setDocPo] = useState(null);   // PO being previewed as a document
  const [grnRef, setGrnRef] = useState('');
  const [grnDate, setGrnDate] = useState(today());
  const [grnQty, setGrnQty] = useState({}); // { itemIndex: value }
  const [grnMsg, setGrnMsg] = useState(null);

  // ── Derived data straight off the module (re-derives after every save) ──
  const purchase = mods.purchase || {};
  const asl = Array.isArray(purchase.asl) ? purchase.asl : [];
  const pos = Array.isArray(purchase.pos) ? purchase.pos : [];

  // Follow-up nudge: open POs past their expected delivery, most overdue first.
  // Days late is measured against today; a closed PO can no longer be late.
  // (pvRenderNudges 7000)
  const overdue = useMemo(() => {
    const todayMs = new Date(today() + 'T00:00:00').getTime();
    return pos
      .filter((p) => !p.closed && !p.manualClosed && p.expectedDelivery)
      .map((p) => ({ po: p, late: Math.floor((todayMs - new Date(p.expectedDelivery + 'T00:00:00').getTime()) / 86400000) }))
      .filter((x) => x.late > 0)
      .sort((a, b) => b.late - a.late);
  }, [pos]);

  const suppliers = useMemo(
    () => [...new Set(asl.map((r) => r.company).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [asl],
  );
  // A PO goes to ONE supplier; suggest that supplier's approved items (legacy pvUseSupplierItem).
  const supplierRows = useMemo(
    () => asl.filter((r) => r.company === supplier && (r.specificMaterial || '').trim()),
    [asl, supplier],
  );
  const supplierItemNames = useMemo(
    () => [...new Set(supplierRows.map((r) => (r.specificMaterial || '').trim()))],
    [supplierRows],
  );

  // ── Persistence: call the granular server endpoint, then reload module 6 ──
  // The server assigns the PO number, records price history, and keeps GRN/status
  // atomic; module 6's blob (read model) is refreshed via reloadModule.
  async function runPurchase(action) {
    setBusy(true);
    try {
      await action();
      await reloadModule('purchase');
      return true;
    } catch (e) {
      return e;
    } finally {
      setBusy(false);
    }
  }

  // ── Payment terms / due date (legacy purchPaymentTermsText + purchDueDate) ──
  function paymentTermsText(po) {
    const row = asl.find((r) => r.company === po.supplier && r.paymentTerms);
    return row ? row.paymentTerms : '';
  }
  function dueDate(po) {
    const days = parsePaymentDays(paymentTermsText(po));
    const base = po.actualReceiptDate || po.poDate || today();
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // ── Section 1: Generate PO ──
  const setItem = (i, patch) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const addRow = () => setItems((xs) => [...xs, { ...EMPTY_ROW }]);
  const removeRow = (i) => setItems((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs));

  // Typing/selecting a known item auto-fills its unit + supplier's basic price (only when blank).
  function onItemChange(i, val) {
    const hit = supplierRows.find((r) => (r.specificMaterial || '').trim().toLowerCase() === val.trim().toLowerCase());
    setItems((xs) => xs.map((it, j) => {
      if (j !== i) return it;
      const row = { ...it, item: val };
      if (hit) {
        if (!it.unit && hit.uom) row.unit = hit.uom;
        if (!it.rate && hit.basicPrice !== '' && hit.basicPrice != null) row.rate = String(hit.basicPrice);
      }
      return row;
    }));
  }

  const subtotal = items.reduce((s, it) => s + num(it.qty) * num(it.rate), 0);
  const gstNum = num(gst);
  const gstAmt = subtotal * gstNum / 100;
  const formTotal = subtotal + gstAmt;

  async function createPO() {
    setGenMsg(null);
    if (!supplier) { setGenMsg({ t: 'r', m: 'Select a supplier first.' }); return; }
    const valid = items.filter((it) => it.item.trim() && num(it.qty) > 0 && num(it.rate) >= 0);
    if (!valid.length) { setGenMsg({ t: 'r', m: 'Add at least one item with a quantity and rate.' }); return; }

    // The server assigns the number, computes the total, and records price history.
    let made = '';
    const r = await runPurchase(async () => {
      const resp = await purchaseApi.createPO({
        supplier, expectedDelivery: expected || '', gstPercent: num(gst), notes: (notes || '').trim(),
        items: valid.map((it) => ({ item: it.item.trim(), unit: (it.unit || '').trim(), qty: num(it.qty), rate: num(it.rate) })),
      });
      made = resp && resp.poNum;
    });

    if (r === true) {
      setGenMsg({ t: 'g', m: '✓ ' + made + ' generated and saved.' });
      setItems([{ ...EMPTY_ROW }]); setExpected(''); setGst(''); setNotes(''); setSupplier('');
    } else if (r) {
      setGenMsg({ t: 'r', m: 'Save failed: ' + (r.message || r) });
    }
  }

  // ── Section 2: GRN / receiving ──
  function openGRN(po) {
    setGrnFor(po.poNum);
    setGrnRef(po.grnRef || '');
    setGrnDate(today());
    setGrnQty({});
    setGrnMsg(null);
  }
  const closeGRN = () => { setGrnFor(null); setGrnMsg(null); };

  async function saveGRN(po) {
    setGrnMsg(null);
    if (!grnRef.trim()) { setGrnMsg({ t: 'r', m: 'Enter the GRN reference.' }); return; }
    const qty = {};                       // { itemIndex: receiveNow }; server caps at the balance
    (po.items || []).forEach((it, idx) => { const v = num(grnQty[idx]); if (v > 0) qty[idx] = v; });
    const r = await runPurchase(() => purchaseApi.receiveGRN({ poNum: po.poNum, grnRef: grnRef.trim(), qty }));
    if (r === true) closeGRN();
    else if (r) setGrnMsg({ t: 'r', m: 'Save failed: ' + (r.message || r) });
  }

  async function forceClose(po) {
    const r = await runPurchase(() => purchaseApi.close(po.poNum));
    if (r === true) closeGRN();
    else if (r) alert('Force close failed: ' + (r.message || r));
  }

  const reopen = async (po) => {
    const r = await runPurchase(() => purchaseApi.reopen(po.poNum));
    if (r !== true && r) alert('Reopen failed: ' + (r.message || r));
  };

  // ── Section 3: Payments ──
  const markPaid = async (po) => {
    const r = await runPurchase(() => purchaseApi.pay(po.poNum));
    if (r !== true && r) alert('Mark paid failed: ' + (r.message || r));
  };
  const markUnpaid = async (po) => {
    const r = await runPurchase(() => purchaseApi.unpay(po.poNum));
    if (r !== true && r) alert('Mark unpaid failed: ' + (r.message || r));
  };

  function exportPayments() {
    const header = ['PO Number', 'Supplier', 'Total Amount', 'Payment Terms', 'Due Date', 'Status', 'Payment Date'];
    const body = pos.map((po) => [
      po.poNum, po.supplier, num(po.totalAmount), paymentTermsText(po),
      fmtDate(dueDate(po)), po.paymentStatus || 'Unpaid', po.paymentDate ? fmtDate(po.paymentDate) : '',
    ]);
    exportAOA([header, ...body], 'purchase-payments-' + today() + '.xlsx', 'Payments');
  }

  const TABS = [['gen', '① Generate PO'], ['track', '② PO Tracking & GRN'], ['pay', '③ Payments']];

  return (
    <div id="app">
      <div className="pg-ttl">Purchase</div>
      <div className="pg-sub">Raise purchase orders, receive goods (GRN) and track bills payable.</div>

      {overdue.length > 0 && (
        <div className="al al-y" role="status" aria-label="Overdue purchase orders">
          ⚠ Follow-up needed — <strong>{overdue.length}</strong> PO{overdue.length === 1 ? '' : 's'} overdue:{' '}
          {overdue.slice(0, 6).map(({ po, late }, i) => (
            <span key={po.poNum}>
              {i > 0 && ' • '}
              <strong>{po.poNum}</strong> ({po.supplier || 'no supplier'}, {late}d late)
            </span>
          ))}
          {overdue.length > 6 && <> …and {overdue.length - 6} more</>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map(([k, label]) => (
          <button key={k} className={'btn ' + (tab === k ? 'btn-g' : 'btn-s')} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {/* ── 1) GENERATE PO ── */}
      {tab === 'gen' && (
        <div className="card">
          <div className="ctitle">Generate Purchase Order</div>
          {!suppliers.length && (
            <div className="al al-y">No suppliers in the Approved Supplier List yet — add suppliers before raising a PO.</div>
          )}
          <div className="g3">
            <div className="fg">
              <label>Supplier</label>
              <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">— Select Supplier —</option>
                {suppliers.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Expected Delivery</label>
              <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
            </div>
            <div className="fg">
              <label>GST %</label>
              <input type="number" min="0" step="0.01" value={gst} onChange={(e) => setGst(e.target.value)} placeholder="0" />
            </div>
          </div>

          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ width: 120 }}>Unit</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Qty</th>
                  <th style={{ width: 130, textAlign: 'right' }}>Rate</th>
                  <th style={{ width: 150, textAlign: 'right' }}>Amount</th>
                  <th style={{ width: 44 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td><input list="pv-items-dl" value={it.item} onChange={(e) => onItemChange(i, e.target.value)} placeholder="Item / material" /></td>
                    <td><input value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} placeholder="Kg / Nos" /></td>
                    <td><input type="number" min="0" step="0.01" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} style={{ textAlign: 'right' }} /></td>
                    <td><input type="number" min="0" step="0.01" value={it.rate} onChange={(e) => setItem(i, { rate: e.target.value })} style={{ textAlign: 'right' }} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupees(num(it.qty) * num(it.rate))}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-s" style={{ height: 27, padding: '0 9px' }} onClick={() => removeRow(i)} disabled={items.length <= 1} title="Remove row">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="pv-items-dl">{supplierItemNames.map((n) => <option key={n} value={n} />)}</datalist>

          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <button className="btn btn-s" onClick={addRow}>+ Add Row</button>
            <div style={{ fontSize: 12, color: 'var(--i2)' }}>
              Subtotal <b>{rupees(subtotal)}</b>
              {gstNum > 0 && <> &nbsp;·&nbsp; GST {gstNum}% <b>{rupees(gstAmt)}</b></>}
              &nbsp;·&nbsp; Total <b style={{ color: 'var(--g)' }}>{rupees(formTotal)}</b>
            </div>
          </div>

          <div className="fg" style={{ marginTop: 12 }}>
            <label>Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={textareaStyle} placeholder="Delivery instructions, references…" />
          </div>

          {genMsg && <div className={'al ' + (genMsg.t === 'g' ? 'al-g' : 'al-r')} style={{ marginTop: 10 }}>{genMsg.m}</div>}
          <div className="act">
            <button className="btn btn-g" onClick={createPO} disabled={busy}>{busy ? 'Saving…' : '✓ Create PO'}</button>
          </div>
        </div>
      )}

      {/* ── 2) PO TRACKING + GRN ── */}
      {tab === 'track' && (
        <div className="card">
          <div className="ctitle">PO Tracking &amp; Goods Receipt (GRN)</div>
          {!pos.length ? (
            <div className="al al-y">No purchase orders yet — generate one from the first tab.</div>
          ) : (
            <div className="tw sy">
              <table>
                <thead>
                  <tr>
                    <th>PO #</th>
                    <th>Supplier</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'center' }}>Items</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Ordered</th>
                    <th style={{ textAlign: 'right' }}>Received</th>
                    <th>Expected</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map((po) => {
                    const list = po.items || [];
                    const ordered = list.reduce((s, i) => s + num(i.qty), 0);
                    const received = list.reduce((s, i) => s + num(i.receivedQty), 0);
                    const status = po.status || 'Open';
                    const open = status !== 'Closed';
                    const rColor = ordered > 0 && received >= ordered ? 'var(--g)' : received > 0 ? 'var(--blu)' : 'var(--i3)';
                    return (
                      <Fragment key={po.poNum}>
                        <tr>
                          <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)' }}>{po.poNum}</td>
                          <td>{po.supplier}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(po.poDate)}</td>
                          <td style={{ textAlign: 'center' }}>{list.length}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{rupees(po.totalAmount)}</td>
                          <td style={{ textAlign: 'right' }}>{qtyStr(ordered)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: rColor }}>{qtyStr(received)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{po.expectedDelivery ? fmtDate(po.expectedDelivery) : '-'}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {statusTag(status)}
                            {po.manualClosed && <span style={{ fontSize: 9, color: 'var(--red)', marginLeft: 4 }}>(manual)</span>}
                          </td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {open ? (
                              <button className="btn btn-g" style={{ height: 27, padding: '0 10px' }} onClick={() => openGRN(po)}>Receive (GRN)</button>
                            ) : (
                              <button className="btn btn-s" style={{ height: 27, padding: '0 10px' }} onClick={() => reopen(po)} disabled={busy}>Reopen</button>
                            )}
                            <button className="btn btn-s" style={{ height: 27, padding: '0 8px', marginLeft: 4 }}
                              onClick={() => setDocPo(po)} title={`Purchase Order document for ${po.poNum}`}
                              aria-label={`Open PO document ${po.poNum}`}>📄 PO</button>
                          </td>
                        </tr>

                        {grnFor === po.poNum && (
                          <tr>
                            <td colSpan={10} style={{ background: 'var(--bg)', padding: 14 }}>
                              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>Receive Material — {po.poNum} · {po.supplier}</div>
                              <div className="tw" style={{ background: 'var(--wh)' }}>
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Item</th>
                                      <th style={{ textAlign: 'right' }}>Ordered</th>
                                      <th style={{ textAlign: 'right' }}>Received</th>
                                      <th style={{ textAlign: 'right' }}>Balance</th>
                                      <th style={{ textAlign: 'right', width: 150 }}>Receive Now</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {list.map((it, idx) => {
                                      const bal = Math.max(0, num(it.qty) - num(it.receivedQty));
                                      const full = bal <= 0;
                                      return (
                                        <tr key={idx}>
                                          <td>{it.item}{it.unit ? ` (${it.unit})` : ''}</td>
                                          <td style={{ textAlign: 'right' }}>{qtyStr(it.qty)}</td>
                                          <td style={{ textAlign: 'right', color: 'var(--i3)' }}>{qtyStr(it.receivedQty)}</td>
                                          <td style={{ textAlign: 'right', fontWeight: 700, color: full ? 'var(--g)' : 'var(--blu)' }}>{full ? '✓ Full' : qtyStr(bal)}</td>
                                          <td style={{ textAlign: 'right' }}>
                                            {full ? <span style={{ color: 'var(--i3)' }}>—</span> : (
                                              <input type="number" min="0" max={bal} step="0.01" value={grnQty[idx] ?? ''} placeholder="0"
                                                onChange={(e) => setGrnQty((q) => ({ ...q, [idx]: e.target.value }))} style={{ width: 120, textAlign: 'right' }} />
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              <div className="g3" style={{ marginTop: 10 }}>
                                <div className="fg"><label>GRN Reference</label><input value={grnRef} onChange={(e) => setGrnRef(e.target.value)} placeholder="GRN / DC number" /></div>
                                <div className="fg"><label>Receipt Date</label><input type="date" value={grnDate} readOnly title="Recorded as today's date" /></div>
                              </div>
                              {grnMsg && <div className={'al ' + (grnMsg.t === 'g' ? 'al-g' : 'al-r')}>{grnMsg.m}</div>}
                              <div className="act">
                                <button className="btn btn-s" onClick={closeGRN} disabled={busy}>Cancel</button>
                                <button className="btn btn-b" onClick={() => forceClose(po)} disabled={busy}>Force Close</button>
                                <button className="btn btn-g" onClick={() => saveGRN(po)} disabled={busy}>{busy ? 'Saving…' : 'Save GRN'}</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── 3) PAYMENTS ── */}
      {tab === 'pay' && (
        <div className="card">
          <div className="ctitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>Payments / Bills Payable</span>
            <button className="btn btn-s" style={{ height: 28 }} onClick={exportPayments} disabled={!pos.length}>⬇ Export Excel</button>
          </div>
          {!pos.length ? (
            <div className="al al-y">No purchase orders yet.</div>
          ) : (
            <div className="tw sy">
              <table>
                <thead>
                  <tr>
                    <th>PO #</th>
                    <th>Supplier</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Payment Terms</th>
                    <th>Due Date</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map((po) => {
                    const paid = (po.paymentStatus || 'Unpaid') === 'Paid';
                    return (
                      <tr key={po.poNum}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)' }}>{po.poNum}</td>
                        <td>{po.supplier}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{rupees(po.totalAmount)}</td>
                        <td>{paymentTermsText(po) || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(dueDate(po))}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {paid
                            ? <span className="tag tg">Paid{po.paymentDate ? ` · ${fmtDate(po.paymentDate)}` : ''}</span>
                            : <span className="tag ty">Unpaid</span>}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {paid
                            ? <button className="btn btn-s" style={{ height: 27, padding: '0 10px' }} onClick={() => markUnpaid(po)} disabled={busy}>Mark Unpaid</button>
                            : <button className="btn btn-g" style={{ height: 27, padding: '0 10px' }} onClick={() => markPaid(po)} disabled={busy}>✓ Mark Paid</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {docPo && <PurchaseOrderModal po={docPo} asl={asl} onClose={() => setDocPo(null)} />}
    </div>
  );
}
