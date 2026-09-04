import { useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../data.jsx';
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

/**
 * One receipt: its paperwork, then the units it produced.
 *
 * Exported because the stores desk edits its own receipts from the Recent-receipts
 * panel on the GRN screen (Issues 3.1) — the same editor, the same endpoints, the
 * same rules. A second copy would be a second set of rules to keep in step.
 */
export function GrnEditor({ grn, busy, setBusy, flash, onSaved, onClose }) {
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
        {/* Same reason as the GRN screen: without a natural minimum the browser squeezes
            the Qty and Price boxes down to nothing. */}
        <table style={{ minWidth: 1120 }}>
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
  const { mods } = useData();
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

  /**
   * Who supplies each material (Issues 3.1). The link lives on the approved-supplier
   * list the Purchase Admin keeps, which this login already reads — so the price
   * master can show it without the stores API learning about purchasing.
   */
  const suppliersByCode = useMemo(() => {
    const asl = (mods.purchase && Array.isArray(mods.purchase.asl)) ? mods.purchase.asl : [];
    const m = new Map();
    asl.forEach((r) => {
      const code = s(r.itemCode).trim().toLowerCase();
      const co = s(r.company).trim();
      if (!code || !co) return;
      if (!m.has(code)) m.set(code, new Set());
      m.get(code).add(co);
    });
    return m;
  }, [mods.purchase]);


  const materials = useMemo(
    () => [...new Set(rows.map((r) => s(r.materialType).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => (!mat || s(r.materialType) === mat)
      && (!t || [r.code, r.name, r.materialType, r.subGroup].some((v) => s(v).toLowerCase().includes(t))));
  }, [rows, q, mat]);

  /**
   * The two figures the business asked for. The GRN total is what the receipts said
   * this stock cost; the Super Admin total values the same stock at the price as on
   * today, falling back to the GRN price for anything not priced here — "if nothing
   * is mentioned here then the stock value will be based on the price at which the
   * GRNs were entered".
   */
  const totals = useMemo(() => filtered.reduce((t, r) => ({
    grn: t.grn + num(r.grnValue ?? r.stockValue),
    admin: t.admin + num(r.adminValue ?? r.grnValue ?? r.stockValue),
    priced: t.priced + (r.adminPrice == null ? 0 : 1),
  }), { grn: 0, admin: 0, priced: 0 }), [filtered]);

  async function save(r) {
    const typed = draft[r.itemId];
    // An empty box on an item that HAS a price as on today is the documented way to
    // drop it ("clear the box and Save"); on one that has none there is nothing to do.
    const clearing = typed == null || String(typed).trim() === '';
    if (clearing && r.adminPrice == null) { flash('r', 'Enter a price.'); return; }
    if (!clearing && !(num(typed) >= 0)) { flash('r', 'A price cannot be negative.'); return; }
    setBusy(String(r.itemId));
    try {
      const out = await storesApi.setItemPrice(r.itemId, clearing ? '' : typed);
      flash('g', out && out.cleared
        ? `✓ ${r.code} — price as on today cleared; it falls back to what the GRNs said.`
        : `✓ ${r.code} priced at ₹${num(typed)} as on today.`);
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
        <strong>Price as on today</strong> is a valuation, not a correction: the receipts keep what
        they were booked at, so the two totals below can be told apart. Stock is valued at the
        price you give here, and at the GRN price for anything you leave blank. To change what a
        receipt actually cost, open it under <strong>GRN Entries</strong>. Where a price range is
        shown, batches came in at different prices.
      </div>
      {/* The answer the page exists to give, kept on screen rather than added up by hand. */}
      <div className="stats" style={{ marginBottom: 8 }}>
        <div className="stat">
          <div className="sl">GRN entry total</div>
          <div className="sv">{rupees(totals.grn)}</div>
          <div className="pg-sub" style={{ margin: 0 }}>what the receipts said</div>
        </div>
        <div className="stat">
          <div className="sl">Super Admin entry total</div>
          <div className="sv" style={{ color: totals.admin === totals.grn ? undefined : 'var(--blu)' }}>{rupees(totals.admin)}</div>
          <div className="pg-sub" style={{ margin: 0 }}>
            {totals.priced ? `${totals.priced} material(s) priced as on today` : 'nothing priced yet — same as the GRN total'}
          </div>
        </div>
        <div className="stat">
          <div className="sl">Difference</div>
          <div className="sv" style={{ color: totals.admin - totals.grn === 0 ? undefined : (totals.admin > totals.grn ? 'var(--g)' : 'var(--red)') }}>
            {rupees(totals.admin - totals.grn)}
          </div>
          <div className="pg-sub" style={{ margin: 0 }}>valuation less cost</div>
        </div>
      </div>
      {loading ? <div className="pg-sub" style={{ margin: 0 }}>Loading materials…</div> : (
        <div className="tw sy" style={{ maxHeight: 'calc(100vh - 360px)' }}>
          <table>
            <thead><tr>
              <th>Item Code</th><th style={{ minWidth: 190 }}>Description</th>
              <th>Material</th><th>Sub-Group</th><th>Speciality</th>
              <th style={{ minWidth: 150 }}>Suppliers</th>
              <th style={{ textAlign: 'right' }}>On Hand</th><th>UOM</th>
              <th style={{ textAlign: 'right' }}>GRN price</th>
              <th style={{ textAlign: 'right' }}>GRN value</th>
              <th style={{ width: 190 }}>Price as on today</th>
              <th style={{ textAlign: 'right' }}>Valued at</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>
                  {rows.length ? 'No material matches your search' : 'No materials in the item master yet'}
                </td></tr>
              ) : filtered.map((r) => {
                const lo = r.priceLow == null ? null : num(r.priceLow);
                const hi = r.priceHigh == null ? null : num(r.priceHigh);
                const range = lo != null && hi != null && lo !== hi;
                const saving = busy === String(r.itemId);
                const typed = draft[r.itemId];
                const sups = [...(suppliersByCode.get(s(r.code).trim().toLowerCase()) || [])].sort();
                return (
                  <tr key={r.itemId}>
                    <td style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{r.code}</td>
                    <td style={{ fontSize: 11 }}>{r.name}</td>
                    <td style={{ fontSize: 11 }}>{r.materialType || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.subGroup || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.specialtyName || '—'}</td>
                    <td style={{ fontSize: 10.5 }} title={sups.join(', ')}>
                      {sups.length ? (sups.length > 2 ? `${sups.slice(0, 2).join(', ')} +${sups.length - 2}` : sups.join(', '))
                        : <span style={{ color: 'var(--i3)' }}>not mapped</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{dash(r.onHand)}</td>
                    <td style={{ fontSize: 11, color: 'var(--i3)' }}>{r.uom || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {lo == null ? <span style={{ color: 'var(--i3)' }}>—</span>
                        : range ? <span title="Batches came in at different prices">₹{lo} – ₹{hi}</span>
                          : '₹' + lo}
                    </td>
                    <td style={{ textAlign: 'right' }}>{rupees(num(r.grnValue ?? r.stockValue))}</td>
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
                        disabled={saving || (typed == null && r.adminPrice == null) || num(r.onHand) <= 0}
                        onClick={() => save(r)}>{saving ? '…' : 'Save'}</button>
                      {r.adminPrice != null && (
                        <div className="pg-sub" style={{ margin: 0 }}>now ₹{num(r.adminPrice)} — clear the box and Save to drop it</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: r.adminPrice != null ? 'var(--blu)' : undefined }}>
                      {rupees(num(r.adminValue ?? r.grnValue ?? r.stockValue))}
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
