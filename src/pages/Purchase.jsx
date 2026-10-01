import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { purchaseApi, storesApi } from '../api.js';
import { parsePaymentDays, num } from '../lib/calc.js';
import { today, fmtDate, rupees } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { readImageCompressed } from '../lib/attach.js';
import {
  EMPTY_PO_FILTERS, filterPoLines, flattenPoLines, groupByPo, isOpenPo, poLineContext, poLineOptions, poStatus,
  storeGrnsForPo,
} from '../lib/poLines.js';
import PurchaseOrderModal from '../components/PurchaseOrderDoc.jsx';
import PoLineFilters, { useItemMaster } from '../components/PoLineFilters.jsx';
import SupplierFinder from '../components/SupplierFinder.jsx';

// ── Local helpers (kept in this file — shared libs are read-only for this port) ──

/** Quantity display: Indian grouping, up to 2 decimals, no forced trailing zeros. */
const qtyStr = (v) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * Days late/early vs expected delivery. Closed counts to the close date; open to today.
 * A cancelled PO is not expected any more, so it is neither late nor early. (purchDelayDays 6235)
 */
function delayDays(po) {
  if (!po || !po.expectedDelivery) return null;
  const st = poStatus(po);
  if (st === 'Cancelled') return null;
  const end = st === 'Closed' ? (po.closedDate || today()) : today();
  return Math.round((new Date(end + 'T00:00:00') - new Date(po.expectedDelivery + 'T00:00:00')) / 86400000);
}

/** Stage label + colour for a PO. (purchStage 12323) */
function stageOf(po) {
  const st = poStatus(po);
  const dd = delayDays(po);
  const overdue = (st === 'Open' || st === 'Partial') && dd != null && dd > 0;
  if (st === 'Cancelled') return { label: '✕ Cancelled', color: 'var(--red)' };
  if (st === 'Closed') return { label: '✓ Closed', color: 'var(--g)' };
  if (st === 'Partial') return overdue ? { label: '◐ Partial (Overdue)', color: 'var(--red)' } : { label: '◐ Partial', color: 'var(--blu)' };
  return overdue ? { label: '⚠ Overdue', color: 'var(--red)' } : { label: '⏳ Open', color: '#856404' };
}

/** 29.09 ¶18: "no limit" is a supplier we do not hold to a due date — nothing ever falls due. */
const isNoLimit = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ') === 'no limit';

const refKey = (v) => String(v == null ? '' : v).trim().toUpperCase();

/**
 * The stores GRNs this PO's receipts say were linked by the purchase desk.
 *
 * Pass `grnNos` (the stores desk's GRN numbers for this PO) to also count the receipts
 * the desk recorded the old way: a server from before 30.09 has no link endpoint, and
 * its POST /grn writes `{ date, ref }` with neither `linked` nor `source`. Such a
 * receipt whose ref IS one of the stores GRNs is that GRN linked — otherwise the
 * "🔗 Link GRN" button would never go away after the fallback save.
 */
const linkedRefs = (po, grnNos) => {
  const known = grnNos ? new Set([...grnNos].map(refKey).filter(Boolean)) : null;
  return (Array.isArray(po.receipts) ? po.receipts : [])
    .filter((r) => r && r.ref && (r.linked || (known && r.source !== 'stores' && known.has(refKey(r.ref)))))
    .map((r) => r.ref);
};
/** The same, as a set of comparable keys (trimmed, upper-cased). */
const linkedSet = (po, grnNos) => new Set(linkedRefs(po, grnNos).map(refKey));

const EMPTY_ROW = {
  itemCode: '', item: '', materialType: '', subGroup: '', specialty: '',
  microns: '', widthMm: '', unit: '', qty: '', rate: '',
};
const textareaStyle = {
  minHeight: 54, border: '1px solid var(--bd)', borderRadius: 7, padding: '8px 10px',
  fontSize: 13, color: 'var(--ink)', background: 'var(--wh)', fontFamily: 'inherit', resize: 'vertical',
};

/** "GRN/2026/12 · 28/09/2026 · Inv 123 · 2 roll(s)" — how a stores receipt reads in the picker. */
function grnLabel(g, linked) {
  const parts = [g.grnNo];
  if (g.grnDate) parts.push(fmtDate(g.grnDate));
  if (g.invoiceNo) parts.push('Inv ' + g.invoiceNo);
  if (g.units != null && g.units !== '') parts.push(g.units + ' roll(s)');
  return parts.join(' · ') + (linked ? ' (linked)' : '');
}

/**
 * Link a stores GRN to a PO — Issues 30.09 §PU2: "The GRN number should not be
 * manually entered … a drop-down selection based on the GRNs that are entered by the
 * store's login for this particular purchase order … If there is only one GRN for this
 * PO, then that should be auto-selected; upon saving the link should be established."
 *
 * The receipts are fetched FRESH each time the panel opens (a GRN booked after this
 * page loaded must be there), only the ones booked against this PO are offered, and
 * there is no typed box at all. The quantities are the stores desk's — read here off
 * the GRN's own rolls, not typed again — so linking records which receipt it was and
 * can never count a delivery twice.
 */
function GrnLinkPanel({ po, ctx, colSpan, loadGrns, onLink, onForceClose, onCancel, busy }) {
  const [opts, setOpts] = useState(null);          // null = still reading the stores receipts
  const [grnRef, setGrnRef] = useState('');
  const [detail, setDetail] = useState(null);
  const [image, setImage] = useState('');
  const [imgBusy, setImgBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const loadRef = useRef(loadGrns);
  loadRef.current = loadGrns;
  const poRef = useRef(po);
  poRef.current = po;
  const linked = useMemo(() => linkedSet(po, (opts || []).map((g) => g.grnNo)), [po, opts]);

  // Once per opening: a fresh read of the stores receipts, narrowed to this PO.
  useEffect(() => {
    let live = true;
    loadRef.current()
      .then((list) => {
        if (!live) return;
        const mine = storeGrnsForPo(list, po.poNum)
          .map((g) => ({ id: g.id, grnNo: String(g.grnNo || g.grn_no || '').trim(), grnDate: g.grnDate || '', invoiceNo: g.invoiceNo || '', units: g.units }))
          .filter((g) => g.grnNo);
        setOpts(mine);
        // One receipt is the answer; so is the one receipt not yet linked.
        const done = linkedSet(poRef.current, mine.map((g) => g.grnNo));
        const open = mine.filter((g) => !done.has(refKey(g.grnNo)));
        setGrnRef(mine.length === 1 ? mine[0].grnNo : (open.length === 1 ? open[0].grnNo : ''));
      })
      .catch((e) => {
        if (!live) return;
        setOpts([]);
        setMsg({ t: 'r', m: 'Could not read the stores receipts: ' + (e.message || e) });
      });
    return () => { live = false; };
  }, [po.poNum]);

  const chosen = (opts || []).find((g) => g.grnNo === grnRef) || null;
  const chosenId = chosen ? chosen.id : null;
  const hasChosen = !!chosen;
  useEffect(() => {
    setDetail(null);
    if (chosenId == null) {
      // A receipt without an id cannot be opened — say so, and leave the link savable.
      if (hasChosen) setDetail({ units: [], failed: true });
      return undefined;
    }
    let live = true;
    storesApi.grn(chosenId)
      .then((d) => { if (live) setDetail(d && typeof d === 'object' && !Array.isArray(d) ? d : { units: [] }); })
      .catch(() => { if (live) setDetail({ units: [], failed: true }); });
    return () => { live = false; };
  }, [chosenId, hasChosen]);

  const lines = useMemo(() => flattenPoLines([po], ctx), [po, ctx]);

  /** What the chosen GRN brought in against each PO line (split-off children excluded). */
  const inGrn = useMemo(() => {
    const units = (detail && Array.isArray(detail.units) ? detail.units : []).filter((u) => u && u.parentUnitId == null);
    const pool = new Map();
    units.forEach((u) => {
      const k = String(u.itemCode || '').trim().toUpperCase();
      if (!pool.has(k)) pool.set(k, { code: u.itemCode || '', name: u.itemName || '', uom: u.uom || '', qty: 0 });
      pool.get(k).qty += num(u.qtyReceived);
    });
    const byIdx = {};
    lines.forEach((r) => {
      const k = String(r.id.code || '').toUpperCase();
      const p = k && pool.get(k);
      if (!p || p.qty <= 0) return;
      const same = lines.filter((x) => String(x.id.code || '').toUpperCase() === k);
      const last = same[same.length - 1] === r;
      const take = last ? p.qty : Math.min(p.qty, num(r.line.qty));
      byIdx[r.idx] = take;
      p.qty -= take;
    });
    const onPo = new Set(lines.map((r) => String(r.id.code || '').toUpperCase()).filter(Boolean));
    const extra = [...pool.entries()].filter(([k]) => !onPo.has(k)).map(([, v]) => v);
    return { byIdx, extra, any: units.length > 0 };
  }, [detail, lines]);

  async function pickPhoto(file) {
    if (!file) return;
    setImgBusy(true);
    try { setImage(await readImageCompressed(file)); }
    catch (e) { setMsg({ t: 'r', m: e.message || 'Could not read that photo.' }); }
    finally { setImgBusy(false); }
  }

  async function save() {
    setMsg(null);
    if (!grnRef) { setMsg({ t: 'r', m: 'Pick the stores GRN to link.' }); return; }
    const r = await onLink(po, grnRef, image, inGrn.byIdx);
    if (r !== true && r) setMsg({ t: 'r', m: 'Link failed: ' + (r.message || r) });
  }

  const none = opts !== null && opts.length === 0;
  const th = { textAlign: 'right' };
  return (
    <tr>
      <td colSpan={colSpan} style={{ background: 'var(--bg)', padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>Link the stores GRN — {po.poNum} · {po.supplier}</div>
        <div className="g3">
          <div className="fg">
            <label>GRN Reference</label>
            {opts === null ? (
              <select disabled aria-label="GRN Reference" value=""><option value="">Reading the stores receipts…</option></select>
            ) : none ? (
              <select disabled aria-label="GRN Reference" value=""><option value="">— no GRN booked by stores against this PO yet —</option></select>
            ) : (
              <select value={grnRef} aria-label="GRN Reference" onChange={(e) => setGrnRef(e.target.value)}>
                <option value="">— select the stores GRN —</option>
                {opts.map((g) => <option key={g.grnNo} value={g.grnNo}>{grnLabel(g, linked.has(refKey(g.grnNo)))}</option>)}
              </select>
            )}
            <div style={{ fontSize: 10, color: none ? '#9a5a06' : 'var(--i3)', marginTop: 3 }}>
              {none
                ? `The stores desk has not booked a receipt against ${po.poNum} yet. When they receive it on Stores → GRN and pick this PO, it appears here.`
                : `The receipts the stores login booked against ${po.poNum}.`}
            </div>
          </div>
          <div className="fg">
            <label>Receipt Date</label>
            <input type="date" value={chosen && chosen.grnDate ? String(chosen.grnDate).slice(0, 10) : ''} readOnly
              aria-label="GRN receipt date" title="The date the stores desk booked this GRN" />
          </div>
          <div className="fg">
            <label>Receipt Photo (optional)</label>
            <input type="file" accept="image/*" capture="environment" aria-label="Capture receipt photo"
              onChange={(e) => { pickPhoto(e.target.files && e.target.files[0]); e.target.value = ''; }} />
          </div>
        </div>

        <div className="tw" style={{ background: 'var(--wh)', marginTop: 10 }}>
          {/* Read-only: the quantities are the stores desk's. Every header sits over its
              column the same way the figures do (§PU4). */}
          <table style={{ tableLayout: 'fixed', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Item Code</th>
                <th style={{ width: 230 }}>Item Description</th>
                <th style={{ ...th, width: 100 }}>Ordered</th>
                <th style={{ ...th, width: 110 }}>Received</th>
                <th style={{ ...th, width: 100 }}>Balance</th>
                <th style={{ ...th, width: 130 }}>{grnRef ? `In ${grnRef}` : 'In this GRN'}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((r) => {
                const it = r.line;
                const bal = Math.max(0, num(it.qty) - num(it.receivedQty));
                const full = bal <= 0;
                const here = inGrn.byIdx[r.idx];
                return (
                  <tr key={r.key}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.id.code || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.id.description || it.item}{it.unit ? ` (${it.unit})` : ''}</td>
                    <td style={{ textAlign: 'right' }}>{qtyStr(it.qty)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--i3)' }}>{qtyStr(it.receivedQty)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: full ? 'var(--g)' : 'var(--blu)' }}>{full ? '✓ Full' : qtyStr(bal)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }} aria-label={`GRN quantity line ${r.idx + 1}`}>
                      {!grnRef ? <span style={{ color: 'var(--i3)' }}>—</span>
                        : !detail ? <span style={{ color: 'var(--i3)', fontWeight: 400 }}>…</span>
                          : here ? qtyStr(here) : <span style={{ color: 'var(--i3)' }}>0</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {detail && inGrn.extra.length > 0 && (
          <div className="al al-y" style={{ marginTop: 8 }}>
            {grnRef} also brought in items that are not on this PO:{' '}
            {inGrn.extra.map((x) => `${x.code || '?'} ${x.name ? '(' + x.name + ') ' : ''}${qtyStr(x.qty)} ${x.uom}`.trim()).join(', ')}.
          </div>
        )}
        {detail && detail.failed && (
          <div className="al al-y" style={{ marginTop: 8 }}>Could not open {grnRef} to show what came in on it — the link can still be saved.</div>
        )}
        {(imgBusy || image) && (
          <div style={{ marginTop: 8 }}>
            {imgBusy ? <span style={{ fontSize: 11, color: 'var(--i3)' }}>Processing photo…</span>
              : <img src={image} alt="Receipt preview" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, border: '1px solid var(--bd)', display: 'block' }} />}
          </div>
        )}
        {Array.isArray(po.receipts) && po.receipts.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--i2)', fontWeight: 600, marginBottom: 6 }}>Previous receipts</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {po.receipts.map((r, ri) => {
                const label = fmtDate(r.date) + (r.ref ? ' — ' + r.ref : '') + (r.linked ? ' (linked)' : '');
                return r.image
                  ? <a key={ri} href={r.image} target="_blank" rel="noreferrer" title={label}><img src={r.image} alt={label} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--bd)' }} /></a>
                  : <div key={ri} title={label} style={{ minWidth: 60, height: 60, borderRadius: 6, border: '1px dashed var(--bd)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 8.5, color: 'var(--i3)', textAlign: 'center', padding: 2 }}>
                    <span>{fmtDate(r.date)}</span>{r.ref && <span>{r.ref}</span>}
                  </div>;
              })}
            </div>
          </div>
        )}
        {msg && <div className={'al ' + (msg.t === 'g' ? 'al-g' : 'al-r')} style={{ marginTop: 8 }}>{msg.m}</div>}
        <div className="act">
          <button className="btn btn-s" onClick={onCancel} disabled={busy}>Cancel</button>
          {onForceClose && <button className="btn btn-b" onClick={() => onForceClose(po)} disabled={busy}>Force Close</button>}
          {/* Not before the GRN's own quantities are in: an older server records the
              receipt with them (the legacy fallback), and an empty map would book zero. */}
          <button className="btn btn-g" onClick={save} disabled={busy || imgBusy || !grnRef || !opts || !opts.length || !detail}>
            {busy ? 'Saving…' : '🔗 Save GRN link'}
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Linked / still-to-link stores receipts, under a PO number. */
function GrnRefs({ po, grnNos }) {
  const receipts = Array.isArray(po.receipts) ? po.receipts : [];
  const linked = linkedRefs(po, grnNos);
  const pending = receipts.filter((r) => r && !r.linked && r.source === 'stores' && r.ref).map((r) => r.ref);
  if (!linked.length && !pending.length) return null;
  return (
    <div style={{ fontSize: 9, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'normal' }}>
      {linked.length > 0 && <div style={{ color: '#1e7e34' }} title="GRNs linked by the purchase desk">🔗 {linked.join(', ')}</div>}
      {pending.length > 0 && <div style={{ color: '#9a5a06' }} title="Booked by stores, not linked yet">📥 {pending.join(', ')} — to link</div>}
    </div>
  );
}

/**
 * Purchase — native port of the legacy Purchase login (PO / GRN / Payments).
 * Legacy source: index.html pvGeneratePO, purchRenderTrackTable, pvOpenGRNModal,
 * pvApplyGRNInputs, pvSaveGRN, pvForceCloseGRN, pvReopenPO, pvMarkPaid/Unpaid,
 * purchDueDate. Module 6 shape: { asl, pos, priceHistory, counter, itemsExtra }.
 */
export default function Purchase() {
  const { mods, reloadModule } = useData();

  const [tab, setTab] = useState('gen'); // 'gen' | 'track' | 'pay' | 'sup'
  const [busy, setBusy] = useState(false);

  // Generate-PO form state
  const [supplier, setSupplier] = useState('');
  const [items, setItems] = useState([{ ...EMPTY_ROW }]);
  const [poDate, setPoDate] = useState(today());
  const [expected, setExpected] = useState('');
  const [gst, setGst] = useState('');
  const [notes, setNotes] = useState('');
  const [genMsg, setGenMsg] = useState(null); // { t:'g'|'r', m, poNum? }
  const [pendingDocNum, setPendingDocNum] = useState(null); // a just-created PO to open in the preview

  // GRN-link state
  const [grnFor, setGrnFor] = useState(null); // poNum whose GRN is being linked
  const [docPo, setDocPo] = useState(null);   // PO being previewed as a document
  const [trackMsg, setTrackMsg] = useState(null);
  const [f, setF] = useState(EMPTY_PO_FILTERS); // the PO filter bar over both tracking cards
  const changeFilters = useCallback((patch) => setF((prev) => ({ ...prev, ...patch })), []);

  // Payments state
  const [payStat, setPayStat] = useState('Unpaid'); // default to what still needs paying

  // ── Derived data straight off the module (re-derives after every save) ──
  const purchase = mods.purchase || {};
  const asl = useMemo(() => (Array.isArray(purchase.asl) ? purchase.asl : []), [purchase.asl]);
  const pos = useMemo(() => (Array.isArray(purchase.pos) ? purchase.pos : []), [purchase.pos]);

  // Follow-up nudge: open POs past their expected delivery, most overdue first.
  // Days late is measured against today; a closed or cancelled PO can no longer be
  // late. (pvRenderNudges 13285)
  const overdue = useMemo(() => {
    return pos
      .filter((p) => isOpenPo(p) && p.expectedDelivery)
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

  // The Item Master is the identity source for a purchase line (29.09 §Purchase). The
  // whole of it resolves an old PO line; only the active items are offered on a new one.
  const masterAll = useItemMaster();
  const master = useMemo(() => masterAll.filter((x) => x.active !== false), [masterAll]);
  const masterByCode = useMemo(
    () => new Map(master.map((it) => [String(it.code || '').trim().toUpperCase(), it])),
    [master],
  );
  const ctx = useMemo(
    () => poLineContext({ master: masterAll, asl, itemsExtra: purchase.itemsExtra }),
    [masterAll, asl, purchase.itemsExtra],
  );

  /**
   * The receipts the stores desk actually booked (GET /api/stores/grns), read on
   * mount for the "to link" hints and AGAIN each time a link panel opens, so a GRN
   * booked after this page loaded is offered. Stable — the panel holds it in a ref.
   */
  const [storeGrns, setStoreGrns] = useState([]);
  const loadStoreGrns = useCallback(async () => {
    const r = await storesApi.grns();
    const list = Array.isArray(r) ? r : [];
    setStoreGrns(list);
    return list;
  }, []);
  useEffect(() => { loadStoreGrns().catch(() => { /* stores not reachable — the panel says so when opened */ }); }, [loadStoreGrns]);

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
      const m = masterByCode.get(code.toUpperCase()) || {};
      byCode.set(code, {
        code,
        description: String(m.name || r.specificMaterial || '').trim(),
        materialType: String(m.materialType || r.materialType || '').trim(),
        subGroup: String(m.subGroup || r.subGroup || '').trim(),
        specialty: String(m.specialtyName || r.specialty || r.speciality || '').trim(),
        microns: String(m.microns || r.microns || '').trim(),
        widthMm: m.widthMm != null && m.widthMm !== '' ? String(m.widthMm) : '',
        uom: String(m.uom || r.uom || '').trim(),
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
  /** '' when the supplier is on "No limit": such a bill never falls due (30.09). */
  function dueDate(po) {
    const terms = paymentTermsText(po);
    if (isNoLimit(terms)) return '';
    const days = parsePaymentDays(terms);
    const base = po.actualReceiptDate || po.poDate || today();
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function dueInDays(po) { // negative = overdue; null = never due (purchDueInDays 12523)
    const due = dueDate(po);
    if (!due) return null;
    const d = new Date(due + 'T00:00:00');
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
      setGenMsg({ t: 'g', m: '✓ ' + made + ' generated and saved.', poNum: made });
      setItems([{ ...EMPTY_ROW }]); setPoDate(today()); setExpected(''); setGst(''); setNotes(''); setSupplier('');
      // §PU1: the new PO opens in the preview straight away, so it is seen — and can be
      // printed or downloaded — the moment it exists.
      if (made) setPendingDocNum(made);
    } else if (r) {
      setGenMsg({ t: 'r', m: 'Save failed: ' + (r.message || r) });
    }
  }

  // The fresh module arrives after the create resolves; open the PO once it is there.
  useEffect(() => {
    if (!pendingDocNum) return;
    const p = pos.find((x) => x.poNum === pendingDocNum);
    if (p) { setDocPo(p); setPendingDocNum(null); }
  }, [pos, pendingDocNum]);

  // ── Section 2: linking the stores GRN ──
  function openGRN(po) {
    setTrackMsg(null);
    setGrnFor(po.poNum);
  }
  const closeGRN = useCallback(() => setGrnFor(null), []);

  async function linkGrn(po, grnNo, receiptImage, qtyByIdx) {
    const r = await runPurchase(async () => {
      try {
        await purchaseApi.linkGrn({ poNum: po.poNum, grnNo, receiptImage: receiptImage || '' });
      } catch (e) {
        // A server from before 30.09 has no link endpoint: record the same receipt the
        // old way, with the stores desk's own quantities (the server caps them).
        if (!e || (e.status !== 404 && e.status !== 405)) throw e;
        await purchaseApi.receiveGRN({ poNum: po.poNum, grnRef: grnNo, qty: qtyByIdx || {}, receiptImage: receiptImage || '' });
      }
    });
    if (r === true) {
      closeGRN();
      setTrackMsg({ t: 'g', m: `✓ ${grnNo} linked to ${po.poNum}.` });
    }
    return r;
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
      const due = dueDate(po);
      const di = dueInDays(po);
      return [
        po.poNum, po.supplier, po.poDate ? fmtDate(po.poDate) : '', po.grnRef || '', po.actualReceiptDate ? fmtDate(po.actualReceiptDate) : '',
        paymentTermsText(po), due ? fmtDate(due) : '', paid || di == null ? '' : di, num(po.totalAmount),
        po.paymentStatus || 'Unpaid', po.paymentDate ? fmtDate(po.paymentDate) : '',
      ];
    });
    exportAOA([header, ...body], 'purchase-payments-' + today() + '.xlsx', 'Payments');
  }

  // ── Tracking derived sets: one row per PO line, filtered, regrouped per PO ──
  const allLines = useMemo(() => flattenPoLines(pos, ctx, { includeEmpty: true }), [pos, ctx]);
  const filterOptions = useMemo(() => poLineOptions(allLines, f), [allLines, f]);
  const filterOn = !!(f.status || f.materialType || f.specialty || f.description || f.q);

  const openGroups = useMemo(() => {
    // closed and cancelled POs live in "Recently Closed"
    const kept = filterPoLines(allLines, { ...f, openOnly: true });
    return groupByPo(kept).sort((a, b) => (delayDays(b.po) ?? 0) - (delayDays(a.po) ?? 0)); // most overdue first
  }, [allLines, f]);

  const closedGroups = useMemo(() => {
    const kept = filterPoLines(allLines, f).filter((r) => r.status === 'Closed' || r.status === 'Cancelled');
    const when = (po) => String(po.closedDate || po.cancelledDate || '');
    return groupByPo(kept).sort((a, b) => when(b.po).localeCompare(when(a.po))).slice(0, 30);
  }, [allLines, f]);

  const payRows = useMemo(() => {
    // a cancelled PO is not a bill — it leaves payables (29.09 cancel, 30.09 §S7)
    let r = pos.filter((p) => poStatus(p) !== 'Cancelled');
    if (payStat) r = r.filter((p) => (p.paymentStatus || 'Unpaid') === payStat);
    const dueKey = (p) => { const d = dueInDays(p); return d == null ? Infinity : d; };
    return r.sort((a, b) => {
      const pa = (a.paymentStatus || 'Unpaid') === 'Paid', pb = (b.paymentStatus || 'Unpaid') === 'Paid';
      if (pa !== pb) return pa ? 1 : -1; // unpaid first
      if (pa) return String(b.paymentDate || '').localeCompare(String(a.paymentDate || ''));
      const da = dueKey(a), db = dueKey(b);
      return da === db ? 0 : (da < db ? -1 : 1);
    });
  }, [pos, payStat, asl]); // eslint-disable-line react-hooks/exhaustive-deps

  const TABS = [['gen', '① Generate PO'], ['track', '② PO Tracking & GRN'], ['pay', '③ Payments'], ['sup', '④ Suppliers by Item']];
  const TRACK_COLS = 14;
  const CLOSED_COLS = 13;

  function dueInCell(po) {
    const paid = (po.paymentStatus || 'Unpaid') === 'Paid';
    if (paid) return <span style={{ color: 'var(--i3)' }}>-</span>;
    const di = dueInDays(po);
    if (di == null) return <span style={{ color: 'var(--i3)' }} title="No limit — this supplier is not held to a due date">No due date</span>;
    const color = di < 0 ? 'var(--red)' : (di <= 15 ? '#a3510a' : 'var(--g)');
    const text = di < 0 ? Math.abs(di) + 'd overdue' : (di === 0 ? 'Due today' : di + 'd left');
    return <span style={{ color, fontWeight: 700 }}>{text}</span>;
  }

  const identityCells = (r) => (
    <>
      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.id.code || (r.empty ? '' : '—')}</td>
      <td>{r.id.description || r.line.item}{r.line.unit ? <span style={{ color: 'var(--i3)', fontSize: 10 }}> ({r.line.unit})</span> : null}</td>
      <td style={{ fontSize: 11 }}>{r.id.materialType || (r.empty ? '' : '—')}</td>
      <td style={{ fontSize: 11 }}>{r.id.specialty || (r.empty ? '' : '—')}</td>
    </>
  );

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
            {/* 30.09 §PU4 (RED): "Quantity and Rate: the headers and the boxes beneath
                the header are not aligned properly." The boxes always filled their
                columns — the HEADERS were right-aligned, so the label sat at the far
                end of a box that starts at the left, unlike every other column. Every
                header now starts where its box starts (the Stores GRN grid the desk
                accepted), the boxes lose their steppers (.nospin), and a fixed layout
                makes the declared widths hold however long a description gets. */}
            <table style={{ tableLayout: 'fixed', minWidth: 1304 }} aria-label="PO line items">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Item Code</th>
                  <th style={{ width: 200 }}>Description</th>
                  <th style={{ width: 110 }}>Material</th>
                  <th style={{ width: 110 }}>Sub-Group</th>
                  <th style={{ width: 110 }}>Speciality</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Microns</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Width (mm)</th>
                  <th style={{ width: 90 }}>UOM</th>
                  <th style={{ width: 110 }}>Qty</th>
                  <th style={{ width: 120 }}>Rate</th>
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
                    <td style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{it.item || '—'}</td>
                    <td style={{ fontSize: 11 }}>{it.materialType || '—'}</td>
                    <td style={{ fontSize: 11 }}>{it.subGroup || '—'}</td>
                    <td style={{ fontSize: 11 }}>{it.specialty || '—'}</td>
                    <td style={{ fontSize: 11, textAlign: 'right' }}>{it.microns || '—'}</td>
                    <td style={{ fontSize: 11, textAlign: 'right' }}>{it.widthMm || '—'}</td>
                    <td style={{ fontSize: 11 }}>{it.unit || '—'}</td>
                    <td><input type="number" min="0" step="0.01" className="nospin" value={it.qty} aria-label={`Qty line ${i + 1}`} onChange={(e) => setItem(i, { qty: e.target.value })} style={{ width: '100%' }} /></td>
                    <td><input type="number" min="0" step="0.01" className="nospin" value={it.rate} aria-label={`Rate line ${i + 1}`} onChange={(e) => setItem(i, { rate: e.target.value })} style={{ width: '100%' }} /></td>
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

          {genMsg && (
            <div className={'al ' + (genMsg.t === 'g' ? 'al-g' : 'al-r')} style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>{genMsg.m}</span>
              {genMsg.t === 'g' && genMsg.poNum && (
                <button className="btn btn-s" style={{ height: 26, padding: '0 10px' }}
                  onClick={() => { const p = pos.find((x) => x.poNum === genMsg.poNum); if (p) setDocPo(p); }}>📄 View PO</button>
              )}
            </div>
          )}
          <div className="act">
            <button className="btn btn-g" onClick={createPO} disabled={busy}>{busy ? 'Saving…' : '✓ Create PO'}</button>
          </div>
        </div>
      )}

      {/* ── 2) PO TRACKING + GRN ── */}
      {tab === 'track' && (
        <>
          {/* 30.09 §S7c: a status filter and Material type / Speciality / Item
              description, over BOTH cards below. */}
          <div className="card" style={{ paddingBottom: 6 }}>
            <PoLineFilters value={f} onChange={changeFilters} options={filterOptions} />
          </div>
          {trackMsg && <div className={'al ' + (trackMsg.t === 'g' ? 'al-g' : 'al-r')}>{trackMsg.m}</div>}
          <div className="card">
            <div className="ctitle">
              GRN Entry — Open &amp; Partially Received POs <span className="tag tgr">{openGroups.length}</span>
            </div>
            {!openGroups.length ? (
              <div className="al al-y">{filterOn ? 'No open POs match the filters.' : 'No open or partially received purchase orders.'}</div>
            ) : (
              <div className="tw sy">
                <table aria-label="Open purchase orders">
                  <thead>
                    <tr>
                      <th>PO #</th>
                      <th>Supplier</th>
                      <th>Item Code</th>
                      <th style={{ minWidth: 160 }}>Item Description</th>
                      <th>Material Type</th>
                      <th>Speciality</th>
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
                    {openGroups.map(({ po, rows }) => {
                      const stage = stageOf(po);
                      const dd = delayDays(po);
                      return (
                        <Fragment key={po.poNum}>
                          {rows.map((r, ii) => {
                            const it = r.line;
                            const first = ii === 0;
                            const rq = num(it.receivedQty), oq = num(it.qty);
                            const rColor = oq > 0 && rq >= oq ? 'var(--g)' : (rq > 0 ? 'var(--blu)' : 'var(--i3)');
                            return (
                              <tr key={r.key} style={first ? { borderTop: '2px solid var(--bd)' } : undefined}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)', whiteSpace: 'nowrap' }}>
                                  {first ? (
                                    <>
                                      {po.poNum}
                                      <div style={{ fontSize: 9, fontWeight: 700, color: stage.color }}>{stage.label}</div>
                                      <GrnRefs po={po} grnNos={storeGrnsForPo(storeGrns, po.poNum).map((g) => g.grnNo)} />
                                    </>
                                  ) : <span style={{ color: 'var(--i3)', paddingLeft: 8 }}>↳</span>}
                                </td>
                                <td style={{ fontSize: 11 }}>{first ? po.supplier : ''}</td>
                                {identityCells(r)}
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
                                      {/* §PU2: the stores desk receives; this links the GRN it booked. */}
                                      <button className="btn btn-g" style={{ height: 27, padding: '0 10px' }} onClick={() => openGRN(po)}
                                        title="Link the GRN the stores desk booked against this PO" aria-label={`Link GRN ${po.poNum}`}>🔗 Link GRN</button>
                                    </>
                                  )}
                                </td>
                              </tr>
                            );
                          })}

                          {grnFor === po.poNum && (
                            <GrnLinkPanel po={po} ctx={ctx} colSpan={TRACK_COLS} loadGrns={loadStoreGrns}
                              onLink={linkGrn} onForceClose={forceClose} onCancel={closeGRN} busy={busy} />
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
            <div className="ctitle">Recently Closed &amp; Cancelled POs <span className="tag tgr">{closedGroups.length}</span></div>
            {!closedGroups.length ? (
              <div className="al al-y">{filterOn ? 'No closed or cancelled POs match the filters.' : 'No closed POs yet.'}</div>
            ) : (
              <div className="tw sy">
                <table aria-label="Closed and cancelled purchase orders">
                  <thead>
                    <tr>
                      <th>PO #</th>
                      <th>Supplier</th>
                      <th>Item Code</th>
                      <th style={{ minWidth: 160 }}>Item Description</th>
                      <th>Material Type</th>
                      <th>Speciality</th>
                      <th style={{ textAlign: 'right' }}>PO Qty</th>
                      <th style={{ textAlign: 'right' }}>Qty Recd</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th>GRN Ref</th>
                      <th>Closed On</th>
                      <th style={{ textAlign: 'right' }}>Final Delay</th>
                      <th style={{ textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedGroups.map(({ po, status, rows }) => {
                      const dd = delayDays(po);
                      const cancelled = status === 'Cancelled';
                      const poGrns = storeGrnsForPo(storeGrns, po.poNum);
                      const refs = linkedRefs(po, poGrns.map((g) => g.grnNo));
                      const done = new Set(refs.map(refKey));
                      const unlinked = poGrns.some((g) => refKey(g.grnNo) && !done.has(refKey(g.grnNo)));
                      return (
                        <Fragment key={po.poNum}>
                          {rows.map((r, ii) => {
                            const first = ii === 0;
                            return (
                              <tr key={r.key} style={first ? { borderTop: '2px solid var(--bd)' } : undefined}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)', whiteSpace: 'nowrap' }}>
                                  {first ? (
                                    <>
                                      {po.poNum}
                                      {cancelled
                                        ? <div><span className="tag tr" style={{ fontSize: 9 }} title={po.cancelReason || ''}>Cancelled</span></div>
                                        : po.manualClosed && <span style={{ fontSize: 9, color: 'var(--red)', marginLeft: 4 }} title="Closed manually, not by full receipt match">(manual)</span>}
                                    </>
                                  ) : <span style={{ color: 'var(--i3)', paddingLeft: 8 }}>↳</span>}
                                </td>
                                <td>{first ? po.supplier : ''}</td>
                                {identityCells(r)}
                                <td style={{ textAlign: 'right' }}>{qtyStr(r.line.qty)}</td>
                                <td style={{ textAlign: 'right' }}>{qtyStr(r.line.receivedQty)}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{first ? rupees(po.totalAmount) : ''}</td>
                                <td style={{ fontSize: 11 }}>{first ? (refs.length ? refs.join(', ') : (po.grnRef || '-')) : ''}</td>
                                <td style={{ whiteSpace: 'nowrap' }}>{first ? ((cancelled ? po.cancelledDate : po.closedDate) ? fmtDate(cancelled ? po.cancelledDate : po.closedDate) : '-') : ''}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700, color: dd == null ? 'var(--i3)' : (dd > 0 ? 'var(--red)' : 'var(--g)') }}>{first ? (dd == null ? '-' : (dd > 0 ? '+' + dd : dd)) : ''}</td>
                                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  {first && (
                                    <>
                                      <button className="btn btn-s" style={{ height: 27, padding: '0 8px', marginRight: 4 }} onClick={() => setDocPo(po)} title={`PO document for ${po.poNum}`}>📄 PO</button>
                                      {/* A PO the stores receipts closed by themselves can still have its GRN linked. */}
                                      {!cancelled && unlinked && (
                                        <button className="btn btn-g" style={{ height: 27, padding: '0 10px', marginRight: 4 }} onClick={() => openGRN(po)}
                                          aria-label={`Link GRN ${po.poNum}`}>🔗 Link GRN</button>
                                      )}
                                      {!cancelled && <button className="btn btn-s" style={{ height: 27, padding: '0 10px' }} onClick={() => reopen(po)} disabled={busy}>↺ Reopen</button>}
                                    </>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {grnFor === po.poNum && !cancelled && (
                            <GrnLinkPanel po={po} ctx={ctx} colSpan={CLOSED_COLS} loadGrns={loadStoreGrns}
                              onLink={linkGrn} onCancel={closeGRN} busy={busy} />
                          )}
                        </Fragment>
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
                    const due = dueDate(po);
                    const late = di != null && di < 0;
                    return (
                      <tr key={po.poNum}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blu)' }}>{po.poNum}</td>
                        <td>{po.supplier}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{rupees(po.totalAmount)}</td>
                        <td>{paymentTermsText(po) || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{due ? fmtDate(due) : '—'}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{dueInCell(po)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {paid
                            ? <span className="tag tg">Paid{po.paymentDate ? ` · ${fmtDate(po.paymentDate)}` : ''}</span>
                            : <span className={'tag ' + (late ? 'tr' : 'ty')}>{late ? '⚠ Overdue' : 'Unpaid'}</span>}
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

      {/* ── 4) SUPPLIERS BY ITEM ── */}
      {tab === 'sup' && <SupplierFinder asl={asl} pos={pos} master={master} />}

      {docPo && <PurchaseOrderModal po={docPo} asl={asl} onClose={() => setDocPo(null)} />}
    </div>
  );
}
