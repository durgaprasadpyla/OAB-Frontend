import { useState, useEffect, useCallback, useMemo } from 'react';
import { storesApi } from '../api.js';
import { fmtDate, rupees, dash } from '../lib/format.js';

// Issues 2.7 — GRN Entries (Super Admin).
//
// The stores desk books a receipt and moves on; when a price or an invoice number
// was typed wrong there was no way back to it. This is that way back: find the
// receipt, open it, correct the paperwork or the price on a line, save.
//
// What is NOT editable is deliberate. The GRN number is the receipt's identity and
// is quoted on the supplier's invoice; who booked it and when are the audit trail.
// A line's QUANTITY is only editable while nothing has been issued from it — once
// the floor has drawn on a roll, changing what was received would leave the issues
// and the closing stock disagreeing. The server refuses it either way; the screen
// just says so up front. Every save is written to the audit log.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const s = (v) => (v == null ? '' : String(v));

export default function GrnAdmin() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await storesApi.grns() || []); }
    catch (e) { flash('r', e.message || 'Could not load the receipts'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => [r.grnNo, r.poNum, r.supplier, r.invoiceNo]
      .some((v) => s(v).toLowerCase().includes(t)));
  }, [rows, q]);

  async function open(id) {
    setOpenId(id); setDetail(null); setMsg(null);
    try { setDetail(await storesApi.grn(id)); }
    catch (e) { flash('r', e.message || 'Could not open that receipt'); setOpenId(null); }
  }
  function close() { setOpenId(null); setDetail(null); }

  return (
    <>
      <div className="card">
        <div className="fbar" style={{ flexWrap: 'wrap' }}>
          <div className="ctitle" style={{ margin: 0 }}>📥 GRN Entries <span className="tag tgr">{filtered.length}</span></div>
          <input placeholder="Search GRN / PO / supplier / invoice…" value={q} aria-label="Search receipts"
            onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
          <button className="btn btn-s" onClick={load} disabled={loading}>↻ Refresh</button>
        </div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="al al-b">
          Open a receipt to correct its paperwork or the price on a line. The GRN number, who
          booked it and when are never editable — they are the receipt&rsquo;s identity and its audit
          trail. A line&rsquo;s quantity can only be corrected while nothing has been issued from it.
        </div>
        {loading ? <div className="pg-sub" style={{ margin: 0 }}>Loading receipts…</div> : (
          <div className="tw sy" style={{ maxHeight: 360 }}>
            <table>
              <thead><tr>
                <th>GRN</th><th>Date</th><th>PO</th><th>Supplier</th><th>Invoice</th>
                <th style={{ textAlign: 'right' }}>Units</th><th>By</th><th style={{ width: 90 }}></th>
              </tr></thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>
                    {rows.length ? 'No receipt matches your search' : 'No goods receipts booked yet'}
                  </td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} style={{ background: r.id === openId ? 'var(--gl)' : undefined }}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{r.grnNo}</td>
                    <td style={{ fontSize: 11 }}>{fmtDate(r.grnDate)}</td>
                    <td style={{ fontSize: 11 }}>{r.poNum || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.supplier || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.invoiceNo || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.units}</td>
                    <td style={{ fontSize: 10, color: 'var(--i3)' }}>{r.actor || '—'}</td>
                    <td><button className="btn btn-s" aria-label={`Edit ${r.grnNo}`} onClick={() => open(r.id)}>✎ Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId != null && (
        detail
          ? <GrnEditor grn={detail} busy={busy} setBusy={setBusy} flash={flash}
              onSaved={async (fresh) => { setDetail(fresh); await load(); }} onClose={close} />
          : <div className="card"><div className="pg-sub" style={{ margin: 0 }}>Opening receipt…</div></div>
      )}
    </>
  );
}

/** One receipt: its paperwork, then the units it produced. */
function GrnEditor({ grn, busy, setBusy, flash, onSaved, onClose }) {
  const [head, setHead] = useState(() => ({
    poNum: s(grn.poNum), supplier: s(grn.supplier), grnDate: s(grn.grnDate),
    invoiceNo: s(grn.invoiceNo), invoiceDate: s(grn.invoiceDate), notes: s(grn.notes),
  }));
  const original = useMemo(() => ({
    poNum: s(grn.poNum), supplier: s(grn.supplier), grnDate: s(grn.grnDate),
    invoiceNo: s(grn.invoiceNo), invoiceDate: s(grn.invoiceDate), notes: s(grn.notes),
  }), [grn]);
  const dirty = Object.keys(original).some((k) => head[k] !== original[k]);

  async function saveHead() {
    if (busy || !dirty) return;
    if (!head.grnDate) { flash('r', 'A GRN date is required.'); return; }
    // Only what actually moved is sent, so an untouched field is never rewritten.
    const patch = {};
    Object.keys(original).forEach((k) => { if (head[k] !== original[k]) patch[k] = head[k]; });
    setBusy(true);
    try {
      const fresh = await storesApi.updateGrn(grn.id, patch);
      flash('g', `✓ ${grn.grnNo} updated.`);
      await onSaved(fresh);
    } catch (e) { flash('r', e.message || 'Save failed'); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>
          ✎ {grn.grnNo}
          <span className="tag tb" style={{ marginLeft: 8, fontSize: 9 }}>booked by {grn.actor || '—'}</span>
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={onClose} disabled={busy}>✕ Close</button>
      </div>

      <div className="g4">
        <div className="fg"><label>GRN No. <span style={{ fontWeight: 400, color: 'var(--i3)' }}>(not editable)</span></label>
          <input value={grn.grnNo} readOnly tabIndex={-1} aria-label="GRN number"
            title="The receipt's identity — quoted on the supplier's invoice"
            style={{ background: 'var(--bg)', color: 'var(--i3)', cursor: 'not-allowed' }} /></div>
        <div className="fg"><label>PO Number</label>
          <input value={head.poNum} aria-label="Edit PO number" onChange={(e) => setHead({ ...head, poNum: e.target.value })} /></div>
        <div className="fg"><label>Supplier</label>
          <input value={head.supplier} aria-label="Edit supplier" onChange={(e) => setHead({ ...head, supplier: e.target.value })} /></div>
        <div className="fg"><label>GRN Date *</label>
          <input type="date" value={head.grnDate} aria-label="Edit GRN date" onChange={(e) => setHead({ ...head, grnDate: e.target.value })} /></div>
        <div className="fg"><label>Invoice No.</label>
          <input value={head.invoiceNo} aria-label="Edit invoice number" onChange={(e) => setHead({ ...head, invoiceNo: e.target.value })} /></div>
        <div className="fg"><label>Invoice Date</label>
          <input type="date" value={head.invoiceDate} aria-label="Edit invoice date" onChange={(e) => setHead({ ...head, invoiceDate: e.target.value })} /></div>
        <div className="fg"><label>Notes</label>
          <input value={head.notes} aria-label="Edit notes" onChange={(e) => setHead({ ...head, notes: e.target.value })} /></div>
        <div className="fg"><label>&nbsp;</label>
          <button className="btn btn-g" onClick={saveHead} disabled={busy || !dirty}>
            {busy ? 'Saving…' : '💾 Save paperwork'}
          </button></div>
      </div>
      {dirty && <div className="al al-y" style={{ marginTop: 4 }}>Unsaved changes to the paperwork.</div>}

      <div className="ctitle" style={{ fontSize: 11, margin: '12px 0 2px' }}>Units received on this GRN</div>
      <div className="tw">
        <table>
          <thead><tr>
            <th>Internal Code</th><th style={{ minWidth: 180 }}>Item</th><th>Supplier Label</th>
            <th style={{ width: 128 }}>Qty</th><th style={{ width: 70 }}>UOM</th>
            <th style={{ width: 128 }}>Price</th><th style={{ width: 130 }}>Location</th>
            <th style={{ width: 140 }}>Expiry</th><th style={{ width: 90 }}></th>
          </tr></thead>
          <tbody>
            {(grn.units || []).length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No units on this receipt</td></tr>
            ) : (grn.units || []).map((u) => (
              <UnitRow key={u.id} unit={u} busy={busy} setBusy={setBusy} flash={flash} onSaved={onSaved} grnId={grn.id} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One received unit. Saves only the fields that actually changed. */
function UnitRow({ unit, busy, setBusy, flash, onSaved, grnId }) {
  const base = useMemo(() => ({
    qty: s(unit.qtyReceived), price: s(unit.price), location: s(unit.location),
    supplierCode: s(unit.supplierCode), expiryDate: s(unit.expiryDate),
  }), [unit]);
  const [f, setF] = useState(base);
  useEffect(() => { setF(base); }, [base]);
  const dirty = Object.keys(base).some((k) => f[k] !== base[k]);

  async function save() {
    if (busy || !dirty) return;
    if (f.price !== '' && !(num(f.price) >= 0)) { flash('r', 'A price cannot be negative.'); return; }
    if (f.qty !== base.qty && !(num(f.qty) > 0)) { flash('r', 'A received quantity must be greater than zero.'); return; }
    const patch = {};
    Object.keys(base).forEach((k) => { if (f[k] !== base[k]) patch[k] = f[k]; });
    setBusy(true);
    try {
      await storesApi.updateUnit(unit.id, patch);
      flash('g', `✓ ${unit.internalCode} updated.`);
      await onSaved(await storesApi.grn(grnId));
    } catch (e) { flash('r', e.message || 'Save failed'); } finally { setBusy(false); }
  }

  return (
    <tr>
      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{unit.internalCode}</td>
      <td style={{ fontSize: 11 }}>{unit.itemCode} — {unit.itemName}</td>
      <td><input value={f.supplierCode} aria-label={`Supplier label for ${unit.internalCode}`}
        onChange={(e) => setF({ ...f, supplierCode: e.target.value })} /></td>
      <td>
        <input type="number" step="any" min="0" className="nospin" value={f.qty}
          aria-label={`Quantity for ${unit.internalCode}`} disabled={unit.qtyLocked}
          title={unit.qtyLocked
            ? `Material has already been issued from ${unit.internalCode}, so the received quantity can no longer be corrected`
            : undefined}
          style={unit.qtyLocked ? { background: 'var(--bg)', color: 'var(--i3)', cursor: 'not-allowed' } : undefined}
          onChange={(e) => setF({ ...f, qty: e.target.value })} />
        {unit.qtyLocked && <div style={{ fontSize: 9, color: 'var(--i3)' }}>issued — locked</div>}
      </td>
      <td style={{ fontSize: 11, color: 'var(--i3)' }}>{unit.uom || '—'}</td>
      <td><input type="number" step="any" min="0" className="nospin" value={f.price}
        aria-label={`Price for ${unit.internalCode}`} onChange={(e) => setF({ ...f, price: e.target.value })} /></td>
      <td><input value={f.location} aria-label={`Location for ${unit.internalCode}`}
        onChange={(e) => setF({ ...f, location: e.target.value })} /></td>
      <td><input type="date" value={f.expiryDate} aria-label={`Expiry for ${unit.internalCode}`}
        onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /></td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button className="btn btn-g" style={{ height: 24, fontSize: 10, padding: '0 7px' }}
          aria-label={`Save ${unit.internalCode}`} onClick={save} disabled={busy || !dirty}>
          {busy && dirty ? '…' : 'Save'}
        </button>{' '}
        <button className="btn btn-s" style={{ height: 24, fontSize: 10, padding: '0 7px' }}
          aria-label={`Cancel ${unit.internalCode}`} onClick={() => setF(base)} disabled={busy || !dirty}>Cancel</button>
      </td>
    </tr>
  );
}

/** Remaining stock of one material and what it is priced at. */
export function RmPriceAdmin() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [mat, setMat] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');       // itemId currently saving
  const [draft, setDraft] = useState({});     // itemId -> typed price
  const [msg, setMsg] = useState(null);

  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await storesApi.rmPrices() || []); }
    catch (e) { flash('r', e.message || 'Could not load the material prices'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const materials = useMemo(
    () => [...new Set(rows.map((r) => s(r.materialType).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => (!mat || s(r.materialType) === mat)
      && (!t || [r.code, r.name, r.materialType, r.subGroup].some((v) => s(v).toLowerCase().includes(t))));
  }, [rows, q, mat]);

  async function save(r) {
    const typed = draft[r.itemId];
    if (typed == null || typed === '') { flash('r', 'Enter a price.'); return; }
    if (!(num(typed) >= 0)) { flash('r', 'A price cannot be negative.'); return; }
    setBusy(String(r.itemId));
    try {
      const out = await storesApi.setItemPrice(r.itemId, typed);
      flash('g', `✓ ${r.code} repriced to ₹${num(typed)} on ${out.unitsUpdated} unit(s) in stock.`);
      setDraft((d) => { const n = { ...d }; delete n[r.itemId]; return n; });
      await load();
    } catch (e) { flash('r', e.message || 'Save failed'); } finally { setBusy(''); }
  }

  return (
    <div className="card">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>💱 RM Prices <span className="tag tgr">{filtered.length}</span></div>
        <input placeholder="Search item code / description…" value={q} aria-label="Search materials"
          onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <select value={mat} aria-label="Filter by material type" onChange={(e) => setMat(e.target.value)}>
          <option value="">All materials</option>
          {materials.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className="btn btn-s" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="al al-b">
        A material&rsquo;s price lives on the stock it was received as — the same figure the GRN
        records and the stock valuation multiplies by. Saving here writes that figure onto
        every unit of the item <strong>still in stock</strong>; material already issued keeps the
        price it was consumed at, so past costs stay honest. Where a range is shown, batches
        came in at different prices.
      </div>
      {loading ? <div className="pg-sub" style={{ margin: 0 }}>Loading materials…</div> : (
        <div className="tw sy" style={{ maxHeight: 'calc(100vh - 360px)' }}>
          <table>
            <thead><tr>
              <th>Item Code</th><th style={{ minWidth: 200 }}>Description</th>
              <th>Material</th><th>Sub-Group</th>
              <th style={{ textAlign: 'right' }}>On Hand</th><th>UOM</th>
              <th style={{ textAlign: 'right' }}>Price on stock</th>
              <th style={{ textAlign: 'right' }}>Stock Value</th>
              <th style={{ width: 190 }}>Set price</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>
                  {rows.length ? 'No material matches your search' : 'No materials in the item master yet'}
                </td></tr>
              ) : filtered.map((r) => {
                const lo = r.priceLow == null ? null : num(r.priceLow);
                const hi = r.priceHigh == null ? null : num(r.priceHigh);
                const range = lo != null && hi != null && lo !== hi;
                const saving = busy === String(r.itemId);
                const typed = draft[r.itemId];
                return (
                  <tr key={r.itemId}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{r.code}</td>
                    <td style={{ fontSize: 11 }}>{r.name}</td>
                    <td style={{ fontSize: 11 }}>{r.materialType || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.subGroup || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{dash(r.onHand)}</td>
                    <td style={{ fontSize: 11, color: 'var(--i3)' }}>{r.uom || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {lo == null ? <span style={{ color: 'var(--i3)' }}>—</span>
                        : range ? <span title="Batches came in at different prices">₹{lo} – ₹{hi}</span>
                          : '₹' + lo}
                    </td>
                    <td style={{ textAlign: 'right' }}>{rupees(num(r.stockValue))}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <input type="number" step="any" min="0" className="nospin"
                        style={{ width: 96 }} placeholder={lo == null ? '0.00' : String(lo)}
                        aria-label={`New price for ${r.code}`}
                        value={typed == null ? '' : typed}
                        disabled={num(r.onHand) <= 0}
                        title={num(r.onHand) <= 0 ? 'Nothing of this material is in stock to reprice' : undefined}
                        onChange={(e) => setDraft((d) => ({ ...d, [r.itemId]: e.target.value }))} />{' '}
                      <button className="btn btn-g" style={{ height: 24, fontSize: 10, padding: '0 7px' }}
                        aria-label={`Save price for ${r.code}`}
                        disabled={saving || typed == null || typed === '' || num(r.onHand) <= 0}
                        onClick={() => save(r)}>{saving ? '…' : 'Save'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
