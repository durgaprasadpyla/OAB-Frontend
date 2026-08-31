import { Fragment, useRef } from 'react';
import { getUOM } from '../lib/pricing.js';
import { fmtDate } from '../lib/format.js';
import { saveDocPdf, PLAIN_PDF } from '../lib/invoicePdf.js';

const int = (v) => (v === '' || v == null ? 0 : (parseInt(v, 10) || 0));
const grp = (v) => Number(v || 0).toLocaleString('en-IN');

/** Bags covered by one range, e.g. from 4 to 9 → 6. Blank "to" means unfinished. */
function bagCount(b) {
  const from = int(b.from) || 1;
  const to = int(b.to);
  return (b.to !== '' && to >= from) ? to - from + 1 : 0;
}
/** Pieces dispatched by one range = bags × qty per bag. (getPlDispatched) */
const rowDispatched = (b) => bagCount(b) * int(b.qty);
const itemBags = (it) => (it.bags || []).reduce((s, b) => s + bagCount(b), 0);
const itemDispatched = (it) => (it.bags || []).reduce((s, b) => s + rowDispatched(b), 0);

/**
 * Packing list — a port of openPackingList / renderPackingListDoc / printPackingList /
 * downloadPlPDF in the production monolith.
 *
 * The document IS the editor: the Bag-To and Qty-per-bag inputs sit inside the printed
 * layout, and the PDF is a capture of that same node (#pl-doc), which is why the saved
 * PDF shows the filled-in fields. "Print" is a different render — buildPlPrintDoc()
 * writes a clean, input-free sheet into a popup window and prints that.
 */

/**
 * Convenience pre-fill, never a lock-out: when a spec carries a `qtyPerBag`
 * packing standard (JSS), its bags open pre-computed — full bags of that size
 * plus one remainder bag, summing exactly to the invoice quantity. Specs
 * without one open with the classic empty range (from bag 1) to type into.
 * Everything stays editable either way — the document is the editor, exactly
 * as the business has always used it.
 */
export function buildAutoPackingList(lines, qtyPerBagOf) {
  return (lines || []).map((it) => {
    const total = Math.round(Number(it.qty ?? it.totalQty) || 0);
    const qpb = Math.round(Number(qtyPerBagOf ? qtyPerBagOf(it.spec) : it.qtyPerBag) || 0);
    const bags = [];
    if (total > 0 && qpb > 0) {
      const full = Math.floor(total / qpb);
      const rem = total - full * qpb;
      if (full > 0) bags.push({ from: 1, to: full, qty: qpb });
      if (rem > 0) bags.push({ from: full + 1, to: full + 1, qty: rem });
    }
    if (!bags.length) bags.push({ from: 1, to: '', qty: '' });
    return { spec: it.spec, jobName: it.jobName || it.spec, totalQty: total, dispatchForm: it.dispatchForm, bags };
  });
}

export default function PackingListModal({ items, setItems, invNo, header, lines, onClose }) {
  const docRef = useRef(null);
  const h = header || {};
  const rows = items || [];

  const dispLoc = (lines && lines[0] && lines[0].dispLoc) || h.placeOfSupply || '';
  const warehouse = h.warehouseName || '';
  const billAddr = h.billingAddr || '';
  const shipAddr = h.shippingAddr || billAddr;

  const grandBags = rows.reduce((s, it) => s + itemBags(it), 0);
  const grandDisp = rows.reduce((s, it) => s + itemDispatched(it), 0);

  const setBag = (ii, bi, patch) => setItems((xs) => xs.map((it, i) => (i === ii
    ? { ...it, bags: it.bags.map((b, j) => (j === bi ? { ...b, ...patch } : b)) } : it)));

  // The next range starts one past where the last one ended. (addPlBagRow)
  const addBag = (ii) => setItems((xs) => xs.map((it, i) => {
    if (i !== ii) return it;
    const last = it.bags[it.bags.length - 1] || {};
    return { ...it, bags: [...it.bags, { from: (int(last.to) || 0) + 1, to: '', qty: '' }] };
  }));

  // One-click completion: with Qty/bag entered, "auto" sets this range's Bag-To so
  // it covers the item's REMAINING invoice quantity (other ranges left untouched).
  const autoFillRow = (ii, bi) => setItems((xs) => xs.map((it, i) => {
    if (i !== ii) return it;
    const doneElsewhere = (it.bags || []).reduce((s, b, j) => s + (j === bi ? 0 : rowDispatched(b)), 0);
    const remaining = Number(it.totalQty || 0) - doneElsewhere;
    return { ...it, bags: it.bags.map((b, j) => {
      if (j !== bi) return b;
      const q = int(b.qty);
      if (q <= 0 || remaining <= 0) return b;
      return { ...b, to: (int(b.from) || 1) + Math.ceil(remaining / q) - 1 };
    }) };
  }));

  async function pdf() {
    try {
      const no = String(invNo || 'PL').trim().replace(/\//g, '-') || 'PL';
      const cust = String(h.customer || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      await saveDocPdf(docRef.current, 'Bloomflex_PL_' + no + '_' + cust + '.pdf', PLAIN_PDF);
    } catch (e) { alert('PDF error: ' + e.message); }
  }

  /**
   * Print the clean sheet, not the editor: a popup window carrying only the
   * finished document (no inputs, no add buttons), printed at A4. (printPackingList)
   */
  function handlePrint() {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Allow pop-ups to print the packing list.'); return; }
    win.document.write(buildPlPrintDoc({ rows, invNo, h, dispLoc, warehouse, billAddr, shipAddr }));
    win.document.close();
    setTimeout(() => win.print(), 600);
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--g)' }}>📦 Packing List</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" style={{ height: 30, padding: '0 13px', background: 'var(--g)', color: '#fff', fontSize: 12 }} onClick={handlePrint}>🖨 Print</button>
            <button className="btn" style={{ height: 30, padding: '0 13px', background: '#1A4FA0', color: '#fff', fontSize: 12 }} onClick={pdf}>⬇ Download PDF</button>
            <button className="btn" style={{ height: 30, padding: '0 13px', background: '#E67E22', color: '#fff', fontSize: 12 }} onClick={onClose}>💾 Save &amp; Close</button>
            <button className="btn btn-s" style={{ height: 30, padding: '0 12px', fontSize: 12 }} onClick={onClose}>✕ Close</button>
          </div>
        </div>

        {/* id="pl-doc" — the design system leaves formal documents unthemed. */}
        <div id="pl-doc" ref={docRef} style={{ fontFamily: 'Arial, sans-serif', fontSize: '10pt', color: '#111' }}>
          <table width="100%" style={{ borderBottom: '2px solid #0e6fb8', paddingBottom: 8, marginBottom: 10 }}>
            <tbody><tr><td style={{ textAlign: 'center', padding: '4px 0' }}>
              <div style={{ fontSize: '18pt', fontWeight: 900, color: '#0e6fb8', letterSpacing: '3px' }}>BLOOMFLEX</div>
              <div style={{ fontSize: '9pt', color: '#555', marginBottom: 4 }}>PRIVATE LIMITED</div>
              <div style={{ fontSize: '14pt', fontWeight: 700, color: '#0e6fb8' }}>PACKING LIST</div>
              <div style={{ fontSize: '8.5pt', color: '#555', marginTop: 2 }}>
                Invoice: <strong>{invNo}</strong> &nbsp;&nbsp; Date: <strong>{fmtDate(h.ivDt)}</strong>
              </div>
            </td></tr></tbody>
          </table>

          <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '10px 14px', marginBottom: 12, background: '#fafafa' }}>
            <div style={{ fontSize: '9pt', fontWeight: 700, color: '#0e6fb8', marginBottom: 6, textTransform: 'uppercase' }}>Name of the Consignee</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: '11pt', fontWeight: 700 }}>{h.customer}</div>
                {dispLoc ? <div style={{ fontSize: '8.5pt', color: '#555', marginTop: 2 }}><strong>Dispatch Location:</strong> {dispLoc}</div> : null}
                {warehouse ? <div style={{ fontSize: '8.5pt', color: '#555', marginTop: 2 }}><strong>Warehouse:</strong> {warehouse}</div> : null}
                {billAddr ? <div style={{ fontSize: '8.5pt', color: '#555', marginTop: 3, whiteSpace: 'pre-line' }}>{billAddr}</div> : null}
              </div>
              <div>
                {h.contactPerson ? <div style={{ fontSize: '8.5pt' }}><strong>Contact Person:</strong> {h.contactPerson}</div> : null}
                {h.contactNo ? <div style={{ fontSize: '8.5pt', marginTop: 2 }}><strong>Contact Number:</strong> {h.contactNo}</div> : null}
                {shipAddr && shipAddr !== billAddr
                  ? <div style={{ fontSize: '8.5pt', marginTop: 4, whiteSpace: 'pre-line' }}><strong>Ship To:</strong><br />{shipAddr}</div> : null}
              </div>
            </div>
          </div>

          <table>
            <thead>
              <tr style={{ background: '#0e6fb8', color: '#fff' }}>
                <th style={{ textAlign: 'center', width: 100 }}>Bag No.</th>
                <th style={{ textAlign: 'right', width: 120 }}>Qty Per Bag</th>
                <th style={{ textAlign: 'right' }}>Bags &times; Qty = Dispatched</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item, ii) => {
                const dispatched = itemDispatched(item);
                const totalBags = itemBags(item);
                const complete = dispatched >= Number(item.totalQty) && Number(item.totalQty) > 0;
                return (
                  <Fragment key={ii}>
                    <tr style={{ background: '#eef4fc' }}>
                      <td colSpan={5} style={{ padding: '7px 10px', fontSize: 11, fontWeight: 700, borderBottom: '2px solid #C5DFC8' }}>
                        {item.jobName || item.spec}
                        <span style={{ fontWeight: 400, color: '#555', fontSize: 10, marginLeft: 8 }}>
                          Invoice Qty: <strong>{grp(item.totalQty)}</strong> {getUOM(item.dispatchForm).toLowerCase()}
                        </span>
                        {complete
                          ? <span style={{ color: '#0e6fb8', fontWeight: 700, marginLeft: 10 }}>✓ Complete</span>
                          : dispatched > 0
                            ? <span style={{ color: '#B7770D', marginLeft: 10 }}>⚠ {grp(Number(item.totalQty) - dispatched)} remaining</span>
                            : null}
                      </td>
                    </tr>
                    {item.bags.map((bag, bi) => {
                      const isLast = bi === item.bags.length - 1;
                      const hasTo = bag.to !== '';
                      const hasQty = bag.qty !== '';
                      const nBags = bagCount(bag);
                      const canAdd = hasTo && hasQty && !complete;
                      return (
                        <tr key={ii + '-' + bi} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '4px 8px', textAlign: 'center', fontSize: 12, color: '#444', fontWeight: 600 }}>{int(bag.from) || 1}</td>
                          <td style={{ padding: '3px 6px' }}>
                            <input
                              type="text" inputMode="numeric" placeholder="To" aria-label="Bag to"
                              value={hasTo ? int(bag.to) : ''}
                              onChange={(e) => setBag(ii, bi, { to: e.target.value === '' ? '' : (parseInt(e.target.value, 10) || '') })}
                              style={{ width: 60, height: 26, border: '1px solid #ccc', borderRadius: 4, padding: '0 6px', fontSize: 12, textAlign: 'center' }}
                            />
                          </td>
                          <td style={{ padding: '3px 6px' }}>
                            <input
                              type="text" inputMode="numeric" placeholder="Qty/bag" aria-label="Qty per bag"
                              value={hasQty ? int(bag.qty) : ''}
                              onChange={(e) => setBag(ii, bi, { qty: e.target.value === '' ? '' : (parseInt(e.target.value, 10) || '') })}
                              style={{ width: 80, height: 26, border: '1px solid #ccc', borderRadius: 4, padding: '0 6px', fontSize: 12, textAlign: 'right' }}
                            />
                          </td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: 11 }}>
                            {hasTo && hasQty
                              ? <strong style={{ color: '#0e6fb8' }}>{nBags} bags &times; {grp(int(bag.qty))} = {grp(nBags * int(bag.qty))}</strong>
                              : hasQty && !complete ? (
                                // Qty/bag known, range open → one click computes Bag-To for
                                // the remaining invoice quantity ("the data comes by itself").
                                <button type="button" onClick={() => autoFillRow(ii, bi)}
                                  aria-label={`Auto-fill bags for ${item.jobName || item.spec}`}
                                  title="Set Bag To so this range covers the remaining invoice quantity"
                                  style={{ height: 24, padding: '0 10px', fontSize: 11, fontWeight: 700, borderRadius: 12, border: '1px solid #0e6fb8', background: '#e9f2fb', color: '#0e6fb8', cursor: 'pointer' }}
                                >⚡ auto-fill</button>
                              ) : <span style={{ color: '#ccc' }}>—</span>}
                          </td>
                          <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                            {isLast ? (
                              <button
                                type="button" onClick={() => addBag(ii)} disabled={!canAdd}
                                title={complete ? 'Invoice qty reached' : (!canAdd ? 'Enter Bag To and Qty Per Bag first' : 'Add next range')}
                                style={{
                                  width: 26, height: 26, borderRadius: '50%', fontSize: 16, fontWeight: 700, padding: 0,
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  border: '1px solid ' + (canAdd ? '#0e6fb8' : '#ccc'),
                                  background: canAdd ? '#e9f2fb' : '#f5f5f5',
                                  color: canAdd ? '#0e6fb8' : '#aaa',
                                  cursor: canAdd ? 'pointer' : 'not-allowed',
                                }}
                              >+</button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: '#D4EDDA' }}>
                      <td colSpan={3} style={{ padding: '5px 10px', fontSize: 11, color: '#155724', fontWeight: 600 }}>Sub-total</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#155724' }}>{totalBags} bags | {grp(dispatched)} pcs</td>
                      <td />
                    </tr>
                  </Fragment>
                );
              })}
              <tr style={{ background: '#0e6fb8', color: '#fff' }}>
                <td colSpan={3} style={{ padding: '7px 10px', fontSize: 12, fontWeight: 700 }}>GRAND TOTAL</td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700 }}>{grandBags} bags | {grp(grandDisp)} pcs</td>
                <td />
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: '9pt', color: '#555' }}>
            <div>Prepared by: _______________________</div>
            <div>Checked by: _______________________</div>
            <div style={{ textAlign: 'right' }}>Authorised Signatory<br /><br />___________________</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The standalone print sheet: three real columns, no inputs, no add buttons —
 * a verbatim port of buildPlPrintDoc().
 */
function buildPlPrintDoc({ rows, invNo, h, dispLoc, warehouse, billAddr, shipAddr }) {
  let itemsHtml = '';
  let grandBags = 0;
  let grandDisp = 0;
  (rows || []).forEach((item) => {
    const dispatched = itemDispatched(item);
    const totalBags = itemBags(item);
    grandBags += totalBags;
    grandDisp += dispatched;
    itemsHtml += '<tr style="background:#eef4fc"><td colspan="3" style="padding:7px 10px;font-size:11px;font-weight:700;border-bottom:2px solid #C5DFC8">'
      + esc(item.jobName || item.spec) + '<span style="font-weight:400;color:#555;font-size:10px;margin-left:8px">Invoice Qty: <strong>'
      + grp(item.totalQty) + '</strong> ' + getUOM(item.dispatchForm).toLowerCase() + '</span></td></tr>';
    (item.bags || []).forEach((bag) => {
      const from = int(bag.from) || 1;
      const to = int(bag.to);
      const qty = int(bag.qty);
      const hasTo = bag.to !== '';
      const hasQty = bag.qty !== '';
      const nBags = bagCount(bag);
      const label = hasTo && from === to ? String(from) : (hasTo ? from + ' – ' + to : '');
      itemsHtml += '<tr style="border-bottom:1px solid #eee">'
        + '<td style="padding:5px 10px;text-align:center;font-size:14px;font-weight:600">' + label + '</td>'
        + '<td style="padding:5px 10px;text-align:right;font-size:14px">' + (hasQty ? grp(qty) : '') + '</td>'
        + '<td style="padding:5px 10px;text-align:right;font-size:13px;color:#0e6fb8;font-weight:600">'
        + (hasTo && hasQty ? nBags + ' bag(s) = ' + grp(nBags * qty) + ' pcs' : '') + '</td></tr>';
    });
    itemsHtml += '<tr style="background:#D4EDDA"><td style="padding:5px 10px;font-size:11px;color:#155724;font-weight:600" colspan="2">Sub-total</td>'
      + '<td style="padding:5px 8px;text-align:right;font-size:11px;font-weight:700;color:#155724">' + totalBags + ' bags | ' + grp(dispatched) + ' pcs</td></tr>';
  });
  itemsHtml += '<tr style="background:#0e6fb8;color:#fff"><td colspan="2" style="padding:7px 10px;font-size:12px;font-weight:700">GRAND TOTAL</td>'
    + '<td style="padding:7px 8px;text-align:right;font-size:12px;font-weight:700">' + grandBags + ' bags | ' + grp(grandDisp) + ' pcs</td></tr>';

  const css = '@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;font-size:14pt;color:#111;margin:0}'
    + 'table{width:100%;border-collapse:collapse}th{background:#0e6fb8!important;color:#fff!important;padding:6px 8px;font-size:9pt;text-align:left}'
    + 'td{padding:4px 8px;border-bottom:1px solid #eee}'
    + '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Packing List ' + esc(invNo) + '</title><style>' + css + '</style></head><body>'
    + '<table width="100%" style="border-bottom:2px solid #0e6fb8;padding-bottom:8px;margin-bottom:10px;border-collapse:collapse"><tr><td style="text-align:center;padding:6px 0">'
    + '<div style="font-size:18pt;font-weight:900;color:#0e6fb8;letter-spacing:3px">BLOOMFLEX</div>'
    + '<div style="font-size:9pt;color:#555;margin-bottom:4px">PRIVATE LIMITED</div>'
    + '<div style="font-size:14pt;font-weight:700;color:#0e6fb8">PACKING LIST</div>'
    + '<div style="font-size:8.5pt;color:#555;margin-top:2px">Invoice: <strong>' + esc(invNo) + '</strong> &nbsp;&nbsp; Date: <strong>' + fmtDate(h.ivDt) + '</strong></div>'
    + '</td></tr></table>'
    + '<table width="100%" style="border:1px solid #ddd;border-radius:6px;margin-bottom:12px;border-collapse:collapse"><tr><td style="padding:10px 14px;background:#fafafa">'
    + '<div style="font-size:9pt;font-weight:700;color:#0e6fb8;margin-bottom:6px;text-transform:uppercase">Name of the Consignee</div>'
    + '<table width="100%" style="border-collapse:collapse"><tr>'
    + '<td style="vertical-align:top;width:50%;padding:0 8px 0 0">'
    + '<div style="font-size:11pt;font-weight:700">' + esc(h.customer) + '</div>'
    + (dispLoc ? '<div style="font-size:8.5pt;color:#555;margin-top:2px"><strong>Dispatch Location:</strong> ' + esc(dispLoc) + '</div>' : '')
    + (warehouse ? '<div style="font-size:8.5pt;color:#555;margin-top:2px"><strong>Warehouse:</strong> ' + esc(warehouse) + '</div>' : '')
    + (billAddr ? '<div style="font-size:8.5pt;color:#555;margin-top:3px;white-space:pre-line">' + esc(billAddr) + '</div>' : '')
    + '</td><td style="vertical-align:top">'
    + (h.contactPerson ? '<div style="font-size:8.5pt"><strong>Contact Person:</strong> ' + esc(h.contactPerson) + '</div>' : '')
    + (h.contactNo ? '<div style="font-size:8.5pt;margin-top:2px"><strong>Contact Number:</strong> ' + esc(h.contactNo) + '</div>' : '')
    + (shipAddr && shipAddr !== billAddr ? '<div style="font-size:8.5pt;margin-top:4px;white-space:pre-line"><strong>Ship To:</strong><br>' + esc(shipAddr) + '</div>' : '')
    + '</td></tr></table></td></tr></table>'
    + '<table><thead><tr style="background:#0e6fb8;color:#fff">'
    + '<th style="text-align:center;width:100px">Bag No.</th>'
    + '<th style="text-align:right;width:120px">Qty Per Bag</th>'
    + '<th style="text-align:right">Bags &times; Qty = Dispatched</th>'
    + '</tr></thead><tbody>' + itemsHtml + '</tbody></table>'
    + '<div style="margin-top:16px;display:flex;justify-content:space-between;font-size:9pt;color:#555">'
    + '<div>Prepared by: _______________________</div>'
    + '<div>Checked by: _______________________</div>'
    + '<div style="text-align:right">Authorised Signatory<br><br>___________________</div>'
    + '</div></body></html>';
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 10000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 20 };
const sheet = { background: '#fff', borderRadius: 12, width: 940, maxWidth: '98vw', padding: 24, margin: 'auto' };
