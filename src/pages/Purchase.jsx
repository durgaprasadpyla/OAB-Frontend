import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { purchaseApi, masterApi, storesApi } from '../api.js';
import { parsePaymentDays, num, purchComputeStatus } from '../lib/calc.js';
import { today, fmtDate, rupees } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { readImageCompressed } from '../lib/attach.js';
import PurchaseOrderModal from '../components/PurchaseOrderDoc.jsx';

// ── Local helpers (kept in this file — shared libs are read-only for this port) ──

/** Quantity display: Indian grouping, up to 2 decimals, no forced trailing zeros. */
const qtyStr = (v) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const statusOf = (po) => po.status || purchComputeStatus(po.items || []);
const isClosed = (po) => statusOf(po) === 'Closed' || !!po.closed || !!po.manualClosed || !!po.closedDate;

/** Days late/early vs expected delivery. Closed counts to the close date; open to today. (purchDelayDays 6235) */
function delayDays(po) {
  if (!po || !po.expectedDelivery) return null;
  const end = isClosed(po) ? (po.closedDate || today()) : today();
  return Math.round((new Date(end + 'T00:00:00') - new Date(po.expectedDelivery + 'T00:00:00')) / 86400000);
}

/** Stage label + colour for a PO. (purchStage 12323) */
function stageOf(po) {
  const st = statusOf(po);
  const dd = delayDays(po);
  const overdue = st !== 'Closed' && dd != null && dd > 0;
  if (st === 'Closed') return { label: '✓ Closed', color: 'var(--g)' };
  if (st === 'Partial') return overdue ? { label: '◐ Partial (Overdue)', color: 'var(--red)' } : { label: '◐ Partial', color: 'var(--blu)' };
  return overdue ? { label: '⚠ Overdue', color: 'var(--red)' } : { label: '⏳ Open', color: '#856404' };
}

const EMPTY_ROW = {
  itemCode: '', item: '', materialType: '', subGroup: '', specialty: '',
  microns: '', widthMm: '', unit: '', qty: '', rate: '',
};
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
  const [poDate, setPoDate] = useState(today());
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
  const [grnImage, setGrnImage] = useState('');   // compressed receipt photo (data URI)
  const [grnImgBusy, setGrnImgBusy] = useState(false);
  const [grnMsg, setGrnMsg] = useState(null);
  const [trackQ, setTrackQ] = useState('');       // GRN-entry search box

  // Payments state
  const [payStat, setPayStat] = useState('Unpaid'); // default to what still needs paying

  // ── Derived data straight off the module (re-derives after every save) ──
  const purchase = mods.purchase || {};
  const asl = Array.isArray(purchase.asl) ? purchase.asl : [];
  const pos = Array.isArray(purchase.pos) ? purchase.pos : [];

  // Follow-up nudge: open POs past their expected delivery, most overdue first.
  // Days late is measured against today; a closed PO can no longer be late.
  // (pvRenderNudges 13285)
  const overdue = useMemo(() => {
    return pos
      .filter((p) => !isClosed(p) && p.expectedDelivery)
      .map((p) => ({ po: p, late: delayDays(p) }))
      .filter((x) => x.late != null && x.late > 0)
      .sort((a, b) => b.late - a.late);
  }, [pos]);

  const suppliers = useMemo(
    () => [...new Set(asl.map((r) => r.company).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [asl],
  );
  // A PO goes to ONE supplier; suggest that supplier's approved items (legacy pvUseSupplierItem).
  const supplierRows = useMemo(
    () => asl.filter((r) => r.company === supplier && (r.itemCode || r.specificMaterial || '').toString().trim()),
    [asl, supplier],
  );

  // The Item Master is the identity source for a purchase line (29.09 §Purchase).
  const [master, setMaster] = useState([]);
  useEffect(() => {
    let live = true;
    masterApi.listItems()
      .then((r) => { if (live && Array.isArray(r)) setMaster(r.filter((x) => x.active !== false)); })
      .catch(() => { /* the supplier row's own copy carries it when the master is unreachable */ });
    return () => { live = false; };
  }, []);
  const masterByCode = useMemo(
    () => new Map(master.map((it) => [String(it.code || '').trim().toUpperCase(), it])),
    [master],
  );

  /**
   * 29.09 §Purchase: "The GRN number should not be manually entered in the tool,
   * whereas it should be a drop-down selection based on the GRNs that are entered by
   * the store's login for this particular purchase order … If there is only one GRN
   * for this PO, then that should be auto-selected."
   *
   * The receipts the stores desk actually booked, keyed by the PO they were booked
   * against — so the two halves of the same delivery carry the same number instead of
   * the buyer typing one from memory.
   */
  const [storeGrns, setStoreGrns] = useState([]);
  useEffect(() => {
    let live = true;
    storesApi.grns()
      .then((r) => { if (live && Array.isArray(r)) setStoreGrns(r); })
      .catch(() => { /* stores not reachable — the box stays typeable below */ });
    return () => { live = false; };
  }, []);
  const grnsForPo = useCallback((poNum) => {
    const want = String(poNum || '').trim().toLowerCase();
    if (!want) return [];
    return storeGrns
      .filter((g) => String(g.poNum || g.po_num || '').trim().toLowerCase() === want)
      .map((g) => String(g.grnNo || g.grn_no || '').trim())
      .filter(Boolean);
  }, [storeGrns]);
  /**
   * 29.09 §Purchase: "only the item is visible. I need subgroup, specialty, item
   * description, microns (if applicable), Width (if applicable) and UOM also to be
   * pulled from the item master."
   *
   * The line was a free-text box over the supplier's DESCRIPTION, so a PO read
   * "280 MM" and named nothing — the same complaint as the BOM lines. The item is
   * chosen by CODE now and the rest is read back from the Item Master, never typed.
   */
  const supplierItems = useMemo(() => {
    const byCode = new Map();
    supplierRows.forEach((r) => {
      const code = String(r.itemCode || '').trim();
      if (!code || byCode.has(code)) return;
      const master = masterByCode.get(code.toUpperCase()) || {};
      byCode.set(code, {
        code,
        description: String(master.name || r.specificMaterial || '').trim(),
        materialType: String(master.materialType || r.materialType || '').trim(),
        subGroup: String(master.subGroup || r.subGroup || '').trim(),
        specialty: String(master.specialtyName || r.specialty || r.speciality || '').trim(),
        microns: String(master.microns || r.microns || '').trim(),
        widthMm: master.widthMm != null && master.widthMm !== '' ? String(master.widthMm) : '',
        uom: String(master.uom || r.uom || '').trim(),
        basicPrice: r.basicPrice,
      });
    });
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [supplierRows, masterByCode]);
  const itemByCode = useMemo(() => new Map(supplierItems.map((r) => [r.code, r])), [supplierItems]);

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
  function dueInDays(po) { // negative = overdue (purchDueInDays 12523)
    const d = new Date(dueDate(po) + 'T00:00:00');
    const t = new Date(today() + 'T00:00:00');
    return Math.round((d - t) / 86400000);
  }

  // ── Section 1: Generate PO ──
  const setItem = (i, patch) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const addRow = () => setItems((xs) => [...xs, { ...EMPTY_ROW }]);
  const removeRow = (i) => setItems((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs));

  // Typing/selecting a known item auto-fills its unit + supplier's basic price (only when blank).
  function onItemChange(i, code) {
    const hit = itemByCode.get(String(code).trim()) || null;
    setItems((xs) => xs.map((it, j) => {
      if (j !== i) return it;
      // The item's identity travels with the line so the PO document, the stores
      // desk and the GRN all describe the same thing.
      const row = {
        ...it,
        itemCode: String(code).trim(),
        item: hit ? hit.description : '',
        materialType: hit ? hit.materialType : '',
        subGroup: hit ? hit.subGroup : '',
        specialty: hit ? hit.specialty : '',
        microns: hit ? hit.microns : '',
        widthMm: hit ? hit.widthMm : '',
        unit: hit ? hit.uom : '',
      };
      if (hit && !it.rate && hit.basicPrice !== '' && hit.basicPrice != null) row.rate = String(hit.basicPrice);
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

    // Safety net: catch items the Approved Supplier List says belong to OTHER
    // suppliers, not the selected one. Free-typed items unknown to the list pass
    // through without complaint. (legacy pvGeneratePO 13051)
    const supItems = new Set(asl.filter((r) => r.company === supplier).map((r) => (r.specificMaterial || '').trim().toLowerCase()));
    const knownItems = new Set(asl.map((r) => (r.specificMaterial || '').trim().toLowerCase()));
    const mismatched = valid.filter((it) => { const k = it.item.trim().toLowerCase(); return knownItems.has(k) && !supItems.has(k); });
    if (mismatched.length) {
      const detail = mismatched.map((it) => {
        const others = [...new Set(asl.filter((r) => (r.specificMaterial || '').trim().toLowerCase() === it.item.trim().toLowerCase()).map((r) => r.company))];
        return '• ' + it.item + ' (supplied by: ' + others.join(', ') + ')';
      }).join('\n');
      if (!window.confirm('⚠ "' + supplier + '" is not listed as a supplier for:\n' + detail + '\n\nGenerate this PO to "' + supplier + '" anyway?')) return;
    }

    // The server assigns the number, computes the total, and records price history.
    let made = '';
    const r = await runPurchase(async () => {
      const resp = await purchaseApi.createPO({
        supplier, poDate: poDate || today(), expectedDelivery: expected || '', gstPercent: num(gst), notes: (notes || '').trim(),
        items: valid.map((it) => ({
          itemCode: (it.itemCode || '').trim(), item: it.item.trim(),
          materialType: (it.materialType || '').trim(), subGroup: (it.subGroup || '').trim(),
          specialty: (it.specialty || '').trim(), microns: (it.microns || '').trim(),
          widthMm: (it.widthMm || '').trim(),
          unit: (it.unit || '').trim(), qty: num(it.qty), rate: num(it.rate),
        })),
      });
      made = resp && resp.poNum;
    });

    if (r === true) {
      setGenMsg({ t: 'g', m: '✓ ' + made + ' generated and saved.' });
      setItems([{ ...EMPTY_ROW }]); setPoDate(today()); setExpected(''); setGst(''); setNotes(''); setSupplier('');
    } else if (r) {
      setGenMsg({ t: 'r', m: 'Save failed: ' + (r.message || r) });
    }
  }

  // ── Section 2: GRN / receiving ──
  function openGRN(po) {
    // One receipt for this PO is the answer; the desk should not have to pick it.
    const only = grnsForPo(po.poNum);
    if (!po.grnRef && only.length === 1) setTimeout(() => setGrnRef(only[0]), 0);
    setGrnFor(po.poNum);
    setGrnRef(po.grnRef || '');
    setGrnDate(today());
    setGrnQty({});
    setGrnImage('');
    setGrnMsg(null);
  }
  const closeGRN = () => { setGrnFor(null); setGrnImage(''); setGrnMsg(null); };

  async function pickGrnPhoto(file) {
    if (!file) return;
    setGrnImgBusy(true);
    try { setGrnImage(await readImageCompressed(file)); }
    catch (e) { setGrnMsg({ t: 'r', m: e.message || 'Could not read that photo.' }); }
    finally { setGrnImgBusy(false); }
  }

  async function saveGRN(po) {
    setGrnMsg(null);
    if (!grnRef.trim()) { setGrnMsg({ t: 'r', m: 'Enter the GRN reference.' }); return; }
    const qty = {};                       // { itemIndex: receiveNow }; server caps at the balance
    (po.items || []).forEach((it, idx) => { const v = num(grnQty[idx]); if (v > 0) qty[idx] = v; });
    const r = await runPurchase(() => purchaseApi.receiveGRN({ poNum: po.poNum, grnRef: grnRef.trim(), qty, receiptImage: grnImage || '' }));
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
    const rowsToExport = payRows;
    const header = ['PO Number', 'Supplier', 'PO / Invoice Date', 'GRN Ref', 'Actual Receipt Date', 'Payment Terms', 'Payment Due Date', 'Days to Due (neg = overdue)', 'Amount', 'Payment Status', 'Payment Date'];
    const body = rowsToExport.map((po) => {
      const paid = (po.paymentStatus || 'Unpaid') === 'Paid';
      return [
        po.poNum, po.supplier, po.poDate ? fmtDate(po.poDate) : '', po.grnRef || '', po.actualReceiptDate ? fmtDate(po.actualReceiptDate) : '',
        paymentTermsText(po), fmtDate(dueDate(po)), paid ? '' : dueInDays(po), num(po.totalAmount),
        po.paymentStatus || 'Unpaid', po.paymentDate ? fmtDate(po.paymentDate) : '',
      ];
    });
    exportAOA([header, ...body], 'purchase-payments-' + today() + '.xlsx', 'Payments');
  }

  // ── Tracking derived sets ──
  const openPos = useMemo(() => {
    let r = pos.filter((p) => !isClosed(p)); // closed POs live in "Recently Closed"
    if (trackQ) {
      const s = trackQ.toLowerCase();
      r = r.filter((p) => String(p.poNum || '').toLowerCase().includes(s)
        || String(p.supplier || '').toLowerCase().includes(s)
        || (p.items || []).some((i) => String(i.item || '').toLowerCase().includes(s)));
    }
    return r.sort((a, b) => (delayDays(b) ?? 0) - (delayDays(a) ?? 0)); // most overdue first
  }, [pos, trackQ]);

  const closedPos = useMemo(
    () => pos.filter(isClosed).slice().sort((a, b) => String(b.closedDate || '').localeCompare(String(a.closedDate || ''))).slice(0, 30),
    [pos],
  );

  const payRows = useMemo(() => {
    let r = pos.slice();
    if (payStat) r = r.filter((p) => (p.paymentStatus || 'Unpaid') === payStat);
    return r.sort((a, b) => {
      const pa = (a.paymentStatus || 'Unpaid') === 'Paid', pb = (b.paymentStatus || 'Unpaid') === 'Paid';
      if (pa !== pb) return pa ? 1 : -1; // unpaid first
      return pa ? String(b.paymentDate || '').localeCompare(String(a.paymentDate || '')) : (dueInDays(a) - dueInDays(b));
    });
  }, [pos, payStat, asl]); // eslint-disable-line react-hooks/exhaustive-deps

  const TABS = [['gen', '① Generate PO'], ['track', '② PO Tracking & GRN'], ['pay', '③ Payments']];
  const TRACK_COLS = 11;

  function dueInCell(po) {
    const paid = (po.paymentStatus || 'Unpaid') === 'Paid';
    if (paid) return <span style={{ color: 'var(--i3)' }}>-</span>;
    const di = dueInDays(po);
    const color = di < 0 ? 'var(--red)' : (di <= 15 ? '#a3510a' : 'var(--g)');
    const text = di < 0 ? Math.abs(di) + 'd overdue' : (di === 0 ? 'Due today' : di + 'd left');
    return <span style={{ color, fontWeight: 700 }}>{text}</span>;
  }

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
              <label>PO Date</label>
              <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
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
                {/* 29.09 §Purchase: the item's identity comes from the Item Master, the
                    unit is called UOM the way it is everywhere else, and the numeric
                    headers sit over boxes that fill their column so the two line up. */}
                <tr>
                  <th style={{ width: 110 }}>Item Code</th>
                  <th style={{ minWidth: 150 }}>Description</th>
                  <th style={{ width: 110 }}>Material</th>
                  <th style={{ width: 110 }}>Sub-Group</th>
                  <th style={{ width: 110 }}>Speciality</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Microns</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Width (mm)</th>
                  <th style={{ width: 90 }}>UOM</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Qty</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Rate</th>
                  <th style={{ width: 130, textAlign: 'right' }}>Amount</th>
                  <th style={{ width: 44 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      <select value={it.itemCode} aria-label={`Item code line ${i + 1}`} disabled={!supplier}
                        onChange={(e) => onItemChange(i, e.target.value)} style={{ width: '100%' }}>
                        <option value="">{supplier ? '— select —' : '— pick a supplier —'}</option>
                        {it.itemCode && !itemByCode.has(it.itemCode) && <option value={it.itemCode}>{it.itemCode}</option>}
                        {supplierItems.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}
                      </select>
                    </td>
                    <td style={{ fontSize: 11 }}>{it.item || '—'}</td>
                    <td style={{ fontSize: 11 }}>{it.materialType || '—'}</td>
                    <td style={{ fontSize: 11 }}>{it.subGroup || '—'}</td>
                    <td style={{ fontSize: 11 }}>{it.specialty || '—'}</td>
                    <td style={{ fontSize: 11, textAlign: 'right' }}>{it.microns || '—'}</td>
                    <td style={{ fontSize: 11, textAlign: 'right' }}>{it.widthMm || '—'}</td>
                    <td style={{ fontSize: 11 }}>{it.unit || '—'}</td>
                    <td><input type="number" min="0" step="0.01" value={it.qty} aria-label={`Qty line ${i + 1}`} onChange={(e) => setItem(i, { qty: e.target.value })} style={{ textAlign: 'right', width: '100%' }} /></td>
                    <td><input type="number" min="0" step="0.01" value={it.rate} aria-label={`Rate line ${i + 1}`} onChange={(e) => setItem(i, { rate: e.target.value })} style={{ textAlign: 'right', width: '100%' }} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupees(num(it.qty) * num(it.rate))}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-s" style={{ height: 27, padding: '0 9px' }} onClick={() => removeRow(i)} disabled={items.length <= 1} title="Remove row">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
        <>
          <div className="card">
            <div className="ctitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>GRN Entry — Open &amp; Partially Received POs <span className="tag tgr">{openPos.length}</span></span>
              <input placeholder="Search PO / supplier / item…" value={trackQ} onChange={(e) => setTrackQ(e.target.value)} style={{ maxWidth: 260 }} />
            </div>
            {!openPos.length ? (
              <div className="al al-y">{trackQ ? 'No open POs match your search.' : 'No open or partially received purchase orders.'}</div>
            ) : (
              <div className="tw sy">
                <table>
                  <thead>
                    <tr>
                      <th>PO #</th>
                      <th>Supplier</th>
                      <th>Item</th>
                      <th style={{ textAlign: 'right' }}>Rate</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'right' }}>PO Qty</th>
                      <th style={{ textAlign: 'right' }}>Qty Recd</th>
                      <th>Expected</th>
                      <th>Actual Receipt</th>
                      <th style={{ textAlign: 'right' }}>Delay</th>
                      <th style={{ textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPos.map((po) => {
                      const list = (po.items && po.items.length) ? po.items : [{ item: '(no items)', qty: 0, rate: 0, amount: 0, receivedQty: 0 }];
                      const stage = stageOf(po);
                      const dd = delayDays(po);
                      return (
                        <Fragment key={po.poNum}>
                          {list.map((it, ii) => {
                            const first = ii === 0;
                            const rq = num(it.receivedQty), oq = num(it.qty);
                            const rColor = oq > 0 && rq >= oq ? 'var(--g)' : (rq > 0 ? 'var(--blu)' : 'var(--i3)');
                            return (
                              <tr key={ii} style={first ? { borderTop: '2px solid var(--bd)' } : undefined}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)', whiteSpace: 'nowrap' }}>
                                  {first ? (<>{po.poNum}<div style={{ fontSize: 9, fontWeight: 700, color: stage.color }}>{stage.label}</div></>) : <span style={{ color: 'var(--i3)', paddingLeft: 8 }}>↳</span>}
                                </td>
                                <td style={{ fontSize: 11 }}>{first ? po.supplier : ''}</td>
                                <td>{it.item}{it.unit ? <span style={{ color: 'var(--i3)', fontSize: 10 }}> ({it.unit})</span> : null}</td>
                                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{num(it.rate).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{num(it.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                                <td style={{ textAlign: 'right' }}>{qtyStr(oq)}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700, color: rColor }}>{qtyStr(rq)}</td>
                                <td style={{ whiteSpace: 'nowrap' }}>{first ? (po.expectedDelivery ? fmtDate(po.expectedDelivery) : '-') : ''}</td>
                                <td style={{ whiteSpace: 'nowrap' }}>{first ? (po.actualReceiptDate ? fmtDate(po.actualReceiptDate) : '-') : ''}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700, color: dd == null ? 'var(--i3)' : (dd > 0 ? 'var(--red)' : 'var(--g)') }}>
                                  {first ? (dd == null ? '-' : (dd > 0 ? '⚠ +' + dd : dd)) : ''}
                                </td>
                                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  {first && (
                                    <>
                                      <button className="btn btn-s" style={{ height: 27, padding: '0 8px', marginRight: 4 }}
                                        onClick={() => setDocPo(po)} title={`Purchase Order document for ${po.poNum}`} aria-label={`Open PO document ${po.poNum}`}>📄 PO</button>
                                      <button className="btn btn-g" style={{ height: 27, padding: '0 10px' }} onClick={() => openGRN(po)}>📷 Receive</button>
                                    </>
                                  )}
                                </td>
                              </tr>
                            );
                          })}

                          {grnFor === po.poNum && (
                            <tr>
                              <td colSpan={TRACK_COLS} style={{ background: 'var(--bg)', padding: 14 }}>
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
                                      {(po.items || []).map((it, idx) => {
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
                                  <div className="fg">
                                    <label>GRN Reference</label>
                                    {/* ¶2: the receipts the stores desk booked against THIS PO. */}
                                    {grnsForPo(po.poNum).length ? (
                                      <>
                                        <select value={grnRef} aria-label="GRN Reference" onChange={(e) => setGrnRef(e.target.value)}>
                                          <option value="">— select the stores GRN —</option>
                                          {grnRef && !grnsForPo(po.poNum).includes(grnRef) && <option value={grnRef}>{grnRef}</option>}
                                          {grnsForPo(po.poNum).map((g) => <option key={g} value={g}>{g}</option>)}
                                        </select>
                                        <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>
                                          From the stores login’s receipts against {po.poNum}.
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <input value={grnRef} aria-label="GRN Reference" onChange={(e) => setGrnRef(e.target.value)} placeholder="GRN / DC number" />
                                        <div style={{ fontSize: 10, color: '#9a5a06', marginTop: 3 }}>
                                          The stores desk has not booked a receipt against {po.poNum} yet — type the number, or ask them to receive it first.
                                        </div>
                                      </>
                                    )}
                                  </div>
                                  <div className="fg"><label>Receipt Date</label><input type="date" value={grnDate} readOnly title="Recorded as today's date" /></div>
                                  <div className="fg">
                                    <label>Receipt Photo (optional)</label>
                                    <input type="file" accept="image/*" capture="environment" aria-label="Capture receipt photo"
                                      onChange={(e) => { pickGrnPhoto(e.target.files && e.target.files[0]); e.target.value = ''; }} />
                                  </div>
                                </div>
                                {(grnImgBusy || grnImage) && (
                                  <div style={{ marginTop: 8 }}>
                                    {grnImgBusy ? <span style={{ fontSize: 11, color: 'var(--i3)' }}>Processing photo…</span>
                                      : <img src={grnImage} alt="Receipt preview" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, border: '1px solid var(--bd)', display: 'block' }} />}
                                  </div>
                                )}
                                {Array.isArray(po.receipts) && po.receipts.length > 0 && (
                                  <div style={{ marginTop: 10 }}>
                                    <div style={{ fontSize: 11, color: 'var(--i2)', fontWeight: 600, marginBottom: 6 }}>Previous receipts</div>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      {po.receipts.map((r, ri) => {
                                        const label = fmtDate(r.date) + (r.ref ? ' — ' + r.ref : '');
                                        return r.image
                                          ? <a key={ri} href={r.image} target="_blank" rel="noreferrer" title={label}><img src={r.image} alt={label} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--bd)' }} /></a>
                                          : <div key={ri} title={label} style={{ width: 60, height: 60, borderRadius: 6, border: '1px dashed var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8.5, color: 'var(--i3)', textAlign: 'center', padding: 2 }}>{fmtDate(r.date)}</div>;
                                      })}
                                    </div>
                                  </div>
                                )}
                                {grnMsg && <div className={'al ' + (grnMsg.t === 'g' ? 'al-g' : 'al-r')}>{grnMsg.m}</div>}
                                <div className="act">
                                  <button className="btn btn-s" onClick={closeGRN} disabled={busy}>Cancel</button>
                                  <button className="btn btn-b" onClick={() => forceClose(po)} disabled={busy}>Force Close</button>
                                  <button className="btn btn-g" onClick={() => saveGRN(po)} disabled={busy || grnImgBusy}>{busy ? 'Saving…' : 'Save GRN'}</button>
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

          <div className="card">
            <div className="ctitle">Recently Closed POs <span className="tag tgr">{closedPos.length}</span></div>
            {!closedPos.length ? (
              <div className="al al-y">No closed POs yet.</div>
            ) : (
              <div className="tw sy">
                <table>
                  <thead>
                    <tr>
                      <th>PO #</th>
                      <th>Supplier</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th>GRN Ref</th>
                      <th>Closed On</th>
                      <th style={{ textAlign: 'right' }}>Final Delay</th>
                      <th style={{ textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedPos.map((po) => {
                      const dd = delayDays(po);
                      return (
                        <tr key={po.poNum}>
                          <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)', whiteSpace: 'nowrap' }}>
                            {po.poNum}{po.manualClosed && <span style={{ fontSize: 9, color: 'var(--red)', marginLeft: 4 }} title="Closed manually, not by full receipt match">(manual)</span>}
                          </td>
                          <td>{po.supplier}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{rupees(po.totalAmount)}</td>
                          <td>{po.grnRef || '-'}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{po.closedDate ? fmtDate(po.closedDate) : '-'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: dd == null ? 'var(--i3)' : (dd > 0 ? 'var(--red)' : 'var(--g)') }}>{dd == null ? '-' : (dd > 0 ? '+' + dd : dd)}</td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button className="btn btn-s" style={{ height: 27, padding: '0 8px', marginRight: 4 }} onClick={() => setDocPo(po)} title={`PO document for ${po.poNum}`}>📄 PO</button>
                            <button className="btn btn-s" style={{ height: 27, padding: '0 10px' }} onClick={() => reopen(po)} disabled={busy}>↺ Reopen</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 3) PAYMENTS ── */}
      {tab === 'pay' && (
        <div className="card">
          <div className="ctitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Payments / Bills Payable</span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={payStat} onChange={(e) => setPayStat(e.target.value)} aria-label="Payment status filter">
                <option value="">All</option>
                <option value="Unpaid">Unpaid</option>
                <option value="Paid">Paid</option>
              </select>
              <button className="btn btn-s" style={{ height: 28 }} onClick={exportPayments} disabled={!payRows.length}>⬇ Export Excel</button>
            </span>
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
                    <th style={{ textAlign: 'right' }}>Due In</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payRows.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No purchase orders match this filter.</td></tr> : payRows.map((po) => {
                    const paid = (po.paymentStatus || 'Unpaid') === 'Paid';
                    const di = dueInDays(po);
                    return (
                      <tr key={po.poNum}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)' }}>{po.poNum}</td>
                        <td>{po.supplier}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{rupees(po.totalAmount)}</td>
                        <td>{paymentTermsText(po) || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(dueDate(po))}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{dueInCell(po)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {paid
                            ? <span className="tag tg">Paid{po.paymentDate ? ` · ${fmtDate(po.paymentDate)}` : ''}</span>
                            : <span className={'tag ' + (di < 0 ? 'tr' : 'ty')}>{di < 0 ? '⚠ Overdue' : 'Unpaid'}</span>}
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
