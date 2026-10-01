import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { storesApi } from '../api.js';
import { fmtDate } from '../lib/format.js';
import {
  EMPTY_PO_FILTERS, filterPoLines, flattenPoLines, poLineContext, poLineOptions, poStatusTag, PO_STATUS_LABELS,
} from '../lib/poLines.js';
import PoLineFilters, { useItemMaster } from './PoLineFilters.jsx';

const qty = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const COLS = 11;

/**
 * Where an expected date came from — said under the date, because the bare column
 * of names it replaced ("Told by") meant nothing to the desk (Issues 30.09 §S7d).
 */
function EtaSource({ eta, po }) {
  const style = { fontSize: 10, color: 'var(--i3)', marginTop: 2, whiteSpace: 'nowrap' };
  if (eta && eta.expectedDate) {
    const when = eta.updatedAt ? fmtDate(String(eta.updatedAt).slice(0, 10)) : '';
    const text = ['revised by stores', eta.actor, when].filter(Boolean).join(' · ');
    return <div style={style} title={text}>{text}</div>;
  }
  if (po.expectedDelivery) {
    return <div style={style} title="The expected delivery Purchase put on the PO">from PO (Purchase login)</div>;
  }
  return <div style={style}>not set</div>;
}

/**
 * Purchase Orders — what purchase has ordered, line by line, and when each line is
 * expected. The stores login's tab, and (read-only) the Plant Manager's.
 *
 * Issues 30.09 §S7:
 *  (a) "Open POs only" hides Cancelled POs as well as Closed ones.
 *  (c) a status filter plus Material type / Speciality / Item description — as
 *      filters and as columns, with the item code beside them.
 *  (d) the "Told by" column is gone; a caption under the date says where it came from.
 *  (e) "the expected date of delivery is on the 11th of next month in the purchase
 *      login, whereas here … still blank" — the date starts at the one Purchase put on
 *      the PO; the stores desk only REVISES it.
 * §PU3: the PM login reads the same list, `readOnly` — the date is the stores desk's
 * to change (the server refuses anyone else), so there it is plain text.
 */
export function PurchaseOrders({ flash: flashProp, readOnly = false }) {
  // Held in a ref: callers pass an inline lambda, and `load` below must not be
  // rebuilt — and refetch — on every one of their renders.
  const flashRef = useRef(flashProp);
  flashRef.current = flashProp;
  const flash = useCallback((t, text) => {
    if (flashRef.current) flashRef.current(t, text);
    else if (t === 'r') window.alert(text);
  }, []);

  const { mods } = useData();
  const purchase = mods.purchase || {};
  const pos = useMemo(() => (Array.isArray(purchase.pos) ? purchase.pos : []), [purchase.pos]);
  const master = useItemMaster();
  const ctx = useMemo(
    () => poLineContext({ master, asl: purchase.asl, itemsExtra: purchase.itemsExtra }),
    [master, purchase.asl, purchase.itemsExtra],
  );
  const [etas, setEtas] = useState([]);
  const [f, setF] = useState({ ...EMPTY_PO_FILTERS, openOnly: true });
  const change = useCallback((patch) => setF((prev) => {
    const next = { ...prev, ...patch };
    // A closed or cancelled status and "open only" cannot both hold: the later choice wins.
    if (patch.status === 'Closed' || patch.status === 'Cancelled') next.openOnly = false;
    if (patch.openOnly && (prev.status === 'Closed' || prev.status === 'Cancelled')) next.status = '';
    return next;
  }), []);

  const load = useCallback(async () => {
    try {
      const r = await storesApi.etas();
      setEtas(Array.isArray(r) ? r : []);
    } catch (e) {
      // The PM only reads: a date it cannot fetch is the PO's own date, not an error.
      if (!readOnly) flash('r', e.message);
    }
  }, [flash, readOnly]);
  useEffect(() => { load(); }, [load]);

  const etaOf = (poNum, item) => etas.find((e) => e.poNum === poNum && e.itemName === item) || null;

  async function saveEta(poNum, itemName, expectedDate) {
    try {
      await storesApi.setEta({ poNum, itemName, expectedDate });
      await load();
      flash('g', `${itemName} on ${poNum} now expected ${expectedDate ? fmtDate(expectedDate) : 'on the PO date'}.`);
    } catch (e) { flash('r', e.message); }
  }

  const all = useMemo(() => flattenPoLines(pos, ctx), [pos, ctx]);
  const rows = useMemo(() => filterPoLines(all, f), [all, f]);
  const options = useMemo(() => poLineOptions(all, f), [all, f]);
  const poCount = useMemo(() => new Set(rows.map((r) => r.po)).size, [rows]);

  return (
    <div className="card">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>
          Purchase orders raised by Purchase{' '}
          <span className="tag tgr" aria-label="Purchase order line count">{rows.length} line{rows.length === 1 ? '' : 's'} · {poCount} PO{poCount === 1 ? '' : 's'}</span>
        </div>
      </div>
      <PoLineFilters value={f} onChange={change} options={options}>
        <label className="cb" style={{ fontSize: 12 }}>
          <input type="checkbox" checked={!!f.openOnly} onChange={(e) => change({ openOnly: e.target.checked })} />
          <span>Open POs only</span>
        </label>
      </PoLineFilters>
      <div className="al al-b">
        {readOnly
          ? <>Expected On is the date Purchase put on the PO, or the stores desk&rsquo;s revision of it. Only the stores desk revises it.</>
          : <>Expected On starts at the date <strong>Purchase</strong> put on the PO. If the supplier tells you otherwise, revise it here
            — the line then shows it as revised by stores.</>}
      </div>
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 340px)' }}>
        <table>
          <thead><tr>
            <th>PO #</th><th>PO Date</th><th>Supplier</th><th>Item Code</th><th style={{ minWidth: 180 }}>Item Description</th>
            <th>Material Type</th><th>Speciality</th>
            <th style={{ textAlign: 'right' }}>Ordered</th><th style={{ textAlign: 'right' }}>Received</th>
            <th>Status</th><th style={{ width: 170 }}>Expected On</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={COLS} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No purchase orders to show</td></tr>
            ) : rows.map(({ po, line: it, key, status, id }) => {
              const eta = etaOf(po.poNum, it.item);
              const promised = (eta && eta.expectedDate) || po.expectedDelivery || '';
              return (
                <tr key={key}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{po.poNum}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{po.poDate ? fmtDate(po.poDate) : '—'}</td>
                  <td style={{ fontSize: 11 }}>{po.supplier || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{id.code || '—'}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{id.description || it.item || '—'}</td>
                  <td style={{ fontSize: 11 }}>{id.materialType || '—'}</td>
                  <td style={{ fontSize: 11 }}>{id.specialty || '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{qty(it.qty)} {it.unit || ''}</td>
                  <td style={{ textAlign: 'right', color: 'var(--g)' }}>{qty(it.receivedQty || 0)}</td>
                  <td>
                    <span className={'tag ' + poStatusTag(status)} style={{ fontSize: 9 }}
                      title={status === 'Cancelled' && po.cancelReason ? po.cancelReason : undefined}>{PO_STATUS_LABELS[status]}</span>
                  </td>
                  <td>
                    {readOnly ? (
                      <div style={{ fontSize: 11, fontWeight: 600 }} aria-label={`Expected on for ${it.item} on ${po.poNum}`}>
                        {promised ? fmtDate(promised) : '—'}
                      </div>
                    ) : (
                      // Keyed on the date it shows, so the box re-reads it when the
                      // stores revisions arrive or Purchase changes the PO.
                      <input type="date" key={key + '|' + promised} defaultValue={promised}
                        aria-label={`Expected date for ${it.item} on ${po.poNum}`}
                        onBlur={(e) => { const v = e.target.value; if (v !== promised) saveEta(po.poNum, it.item, v); }}
                        style={{ height: 26, fontSize: 11 }} />
                    )}
                    <EtaSource eta={eta} po={po} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PurchaseOrders;
