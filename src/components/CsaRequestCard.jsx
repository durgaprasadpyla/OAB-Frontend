// Sales Login §15-§28 — what the rep sent with the sample: despatch location,
// tentative quantity / date, target price and the despatch-form specific
// measurements. Shown to QC above the CSA form and inside the report view, and to
// the plant beside its comments, so nobody has to ask the rep again.
import { fmtDate } from '../lib/format.js';
import { despatchDetailLabel, tentativeUom } from '../lib/repFlow.js';

export default function CsaRequestCard({ sku, compact = false, showTarget = false }) {
  const r = sku && sku.csa_request;
  if (!r) return null;
  const details = Object.entries(r.details || {}).filter(([, v]) => v !== '' && v != null);
  // the label the rep's own form used — a pouch's "height end to end" is not a bulk bag's
  // "height without gusset"; Issues 17.10 §2 / §3: the bulk-bag totals read "Final pouch
  // …" and a core saved under the old "(mm)" key reads as the inches it always was
  const label = (k) => despatchDetailLabel(r.kind, k);
  // Issues 26.10: the quantity's unit travels with it to QC (older requisitions: worked out)
  const uom = r.tentative_uom || tentativeUom(r.despatch_form, r.details);
  return (
    <div className="al al-b" style={{ display: 'block', marginTop: compact ? 4 : 8 }} aria-label="CSA requisition from the sales rep">
      <div style={{ fontWeight: 700, marginBottom: 4 }}>📨 Requisition from the sales rep{r.sent_at ? ` · ${fmtDate(String(r.sent_at).slice(0, 10))}` : ''}{r.sent_by ? ` · ${r.sent_by}` : ''}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 12 }}>
        <span>Dispatch location: <b>{r.despatch_location || '—'}{r.warehouse_name ? ` (${r.warehouse_name})` : ''}</b></span>
        <span>Tentative quantity: <b>{Number(r.tentative_qty || 0).toLocaleString('en-IN')}{uom ? ' ' + uom : ''}</b></span>
        <span>Tentative dispatch: <b>{r.tentative_date ? fmtDate(r.tentative_date) : '—'}</b></span>
        {/* 29.09 ¶26: "Target price (This shall only be visible in quote login)." The
            rep records it for the desk that prices the job; QC works from the sample and
            the structure, and seeing a target anchors them to it. */}
        {showTarget && <span>Target price: <b>₹{Number(r.target_price || 0).toLocaleString('en-IN')}</b></span>}
        <span>Dispatch form: <b>{r.despatch_form || '—'}</b></span>
        {sku.structure && <span>Structure: <b>{sku.structure}</b></span>}
      </div>
      {details.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 12, marginTop: 4 }}>
          {details.map(([k, v]) => <span key={k}>{label(k)}: <b>{String(v)}</b></span>)}
        </div>
      )}
    </div>
  );
}
