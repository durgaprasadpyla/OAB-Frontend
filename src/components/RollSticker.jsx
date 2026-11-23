import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { code128Bars, isCode128B } from '../lib/barcode.js';
import { rollStickerApi } from '../lib/rollStickerApi.js';

// BloomFlex V2 roll stickers.
//
// One sticker per physical roll / can: who made it (BLOOMFLEX), its internal code as a
// badge, a Code 128 barcode and in plain text, the item identity from the Item Master,
// supplier + batch, rack, expiry and the CURRENT quantity — a sticker is reprinted
// after a return with what is left on the roll, never with what was received.
//
// Printing: the stickers are copied into a print-only container on <body>; while the
// browser prints, every other child of <body> is hidden, so only the stickers come out
// (several per page; a sticker is never split across a page break).

const STICKER_CSS = `
.bf-sticker{width:100mm;max-width:100%;border:1.5px solid #111;border-radius:10px;padding:10px 12px;background:#fff;color:#111;font-size:11px;line-height:1.3}
.bf-sticker-head{display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid #111;padding-bottom:4px;margin-bottom:4px}
.bf-sticker-brand{font-weight:800;letter-spacing:.12em;font-size:13px}
.bf-sticker-badge{font-family:monospace;font-weight:800;font-size:12px;border:1.5px solid #111;border-radius:4px;padding:1px 6px}
.bf-sticker-row{display:flex;justify-content:space-between;gap:10px;border-bottom:1px dotted #bbb;padding:1px 0}
.bf-sticker-row span{color:#555}
.bf-sticker-row b{text-align:right;overflow-wrap:anywhere}
.bf-sticker-bar{margin:8px 0 0;border:1px solid #d5dbe3;border-radius:4px;padding:6px 8px}
.bf-sticker-bar svg{display:block;width:100%;height:46px}
.bf-sticker-code{text-align:center;font-family:monospace;font-weight:800;letter-spacing:2px;font-size:13px}
.bf-sticker-sign{display:flex;justify-content:space-between;gap:10px;margin-top:8px;font-size:10.5px}
.bf-sticker-grid{display:flex;flex-wrap:wrap;gap:12px}
.bf-sticker-print{display:none}
/* BloomFlex V2 look on screen: the code as a blue pill, as on the prototype's sticker */
@media screen{.bf-sticker-badge{background:#e5f0ff;color:#1a5fb4;border-color:#b9d3f5;border-radius:20px;padding:2px 9px}}
@media print{
  body.bf-printing-stickers>*:not(.bf-sticker-print){display:none!important}
  body.bf-printing-stickers .bf-sticker-print{display:block}
  body.bf-printing-stickers{background:#fff}
  .bf-sticker-print .bf-sticker-grid{gap:6mm}
  .bf-sticker-print .bf-sticker{break-inside:avoid;page-break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{margin:8mm}
}
`;

export function StickerStyles() {
  return <style>{STICKER_CSS}</style>;
}

const fmtQty = (v) => (v == null || v === '' || !Number.isFinite(Number(v))
  ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

/** A Code 128 (set B) barcode as inline SVG; a plain message when the text cannot be encoded. */
export function Barcode({ value, height = 46 }) {
  if (!isCode128B(value)) {
    return <div style={{ color: 'var(--red)', fontSize: 11 }}>No barcode — the code must be printable ASCII.</div>;
  }
  const { bars, width } = code128Bars(value);
  return (
    <svg role="img" aria-label={`Code 128 barcode ${value}`} viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" data-modules={width}>
      <rect width={width} height={height} fill="#fff" />
      <g fill="#000">{bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={height} />)}</g>
    </svg>
  );
}

/** The label of one roll. `unit` is a roll as GET /api/stores/units/by-code returns it. */
export function RollSticker({ unit, preview = false }) {
  const u = unit || {};
  const code = u.internalCode || '';
  const batch = [u.batchCode, u.supplierCode].filter(Boolean).join(' / ');
  const rows = [
    ['Item code', u.itemCode],
    ['Description', u.itemName],
    ['Material type', u.materialType],
    ['Sub-group', u.subGroup],
    ['Specialty', u.specialtyName],
    ['Supplier', u.supplier],
    ['Batch / supplier label', batch],
    ['Rack / location', u.location],
    ['Expiry', u.expiryDate || 'Not specified'],
    ['Current quantity', `${fmtQty(u.qtyRemaining)} ${u.uom || ''}`.trim()],
  ];
  return (
    <div className="bf-sticker" data-testid={preview ? 'roll-sticker-preview' : 'roll-sticker'} aria-label={preview ? 'Sticker preview' : `Sticker ${code}`}>
      <div className="bf-sticker-head">
        <span className="bf-sticker-brand">BLOOMFLEX</span>
        <span className="bf-sticker-badge">{code || '—'}</span>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="bf-sticker-row"><span>{k}</span><b>{v == null || v === '' ? '—' : v}</b></div>
      ))}
      <div className="bf-sticker-bar"><Barcode value={code} /></div>
      <div className="bf-sticker-code">{code}</div>
      <div className="bf-sticker-sign"><span>Stores ________________</span><span>QC ________________</span></div>
    </div>
  );
}

/** Print the given rolls' stickers — and nothing else on the page. */
export function printStickers() {
  const body = document.body;
  body.classList.add('bf-printing-stickers');
  const done = () => {
    body.classList.remove('bf-printing-stickers');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  try { window.print(); } catch { done(); }
}

/**
 * A modal of roll stickers read FRESH from the server (so the quantity is what is on
 * the roll now), with one button that prints them all.
 *
 * Pass `codes` (internal codes) — or `units` already read by code.
 */
export function RollStickerModal({ codes, units: given, title = '🏷 Roll stickers', intro, onClose }) {
  const [units, setUnits] = useState(given || null);
  const [err, setErr] = useState('');
  const key = (codes || []).join('|');

  useEffect(() => {
    if (given) { setUnits(given); return undefined; }
    let alive = true;
    setUnits(null); setErr('');
    Promise.all((codes || []).map((c) => rollStickerApi.unitByCode(c).catch((e) => ({ internalCode: c, _error: e.message }))))
      .then((rows) => {
        if (!alive) return;
        const failed = rows.filter((r) => r && r._error);
        if (failed.length) setErr(`Could not read ${failed.map((r) => r.internalCode).join(', ')}: ${failed[0]._error}`);
        setUnits(rows.filter((r) => r && !r._error));
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, given]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const n = units ? units.length : 0;
  // Its own overlay (the Modal look) so it also opens above the roll-trace popup (z 9600).
  return createPortal(
    <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', inset: 0, zIndex: 9700, background: 'rgba(15,23,42,.55)', display: 'flex',
      alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}>
      <div className="card" role="dialog" aria-modal="true" aria-label={title}
        style={{ width: 'min(920px,96vw)', margin: '0 auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="ctitle" style={{ margin: 0 }}>{title}</div>
          <button className="btn btn-s" onClick={onClose} aria-label="Close">✕</button>
        </div>
      <StickerStyles />
      {intro && <div className="al al-g" style={{ marginBottom: 10 }}>{intro}</div>}
      {err && <div className="al al-r" style={{ marginBottom: 10 }}>{err}</div>}
      {!units ? <div className="pg-sub">Reading the rolls…</div> : (
        <div className="bf-sticker-grid">
          {units.map((u) => <RollSticker key={u.id || u.internalCode} unit={u} />)}
        </div>
      )}
      {units && n > 0 && typeof document !== 'undefined' && createPortal(
        <div className="bf-sticker-print" aria-hidden="true">
          <div className="bf-sticker-grid">{units.map((u) => <RollSticker key={u.id || u.internalCode} unit={u} />)}</div>
        </div>,
        document.body,
      )}
        <div className="act">
          <button className="btn btn-s" onClick={onClose}>Close</button>
          <button className="btn btn-g" disabled={!n} onClick={printStickers}>
            🖨 {n === 1 ? 'Print sticker' : `Print all ${n} stickers`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** "🏷 Sticker" — the reprint action beside a roll: opens its sticker with the current quantity. */
export function StickerButton({ code, label = '🏷 Sticker', style }) {
  const [open, setOpen] = useState(false);
  if (!code) return null;
  return (
    <>
      <button type="button" className="btn btn-s" title={`Show / print the sticker of ${code} with its current quantity`}
        style={{ height: 22, fontSize: 10.5, padding: '0 6px', ...style }}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-label={`Sticker ${code}`}>{label}</button>
      {open && <RollStickerModal codes={[code]} title={`🏷 Sticker · ${code}`} onClose={() => setOpen(false)} />}
    </>
  );
}
