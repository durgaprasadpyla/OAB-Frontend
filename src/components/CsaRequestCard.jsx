// Sales Login §15-§28 — what the rep sent with the sample: despatch location,
// tentative quantity / date, target price and the despatch-form specific
// measurements. Shown to QC above the CSA form and inside the report view, and to
// the plant beside its comments, so nobody has to ask the rep again.
import { fmtDate } from '../lib/format.js';
import { DESPATCH_FIELDS } from '../lib/repFlow.js';

const LABELS = Object.values(DESPATCH_FIELDS).flat().reduce((m, f) => { m[f.k] = f.label; return m; }, {});
LABELS.totalGusset = 'Total gusset (mm)';
LABELS.totalHeight = 'Finished pouch height (mm)';
LABELS.totalWidth = 'Finished pouch width (mm)';
// requisitions sent before 30.09 carried the shrink roll form's per-core figure as text
LABELS.per_core = 'Metres or kg per core';

export default function CsaRequestCard({ sku, compact = false, showTarget = false }) {
  const r = sku && sku.csa_request;
  if (!r) return null;
  const details = Object.entries(r.details || {}).filter(([, v]) => v !== '' && v != null);
  // the label the rep's own form used — a pouch's "height end to end" is not a bulk bag's "height without gusset"
  const own = (DESPATCH_FIELDS[r.kind] || []).reduce((m, f) => { m[f.k] = f.label; return m; }, {});
  const label = (k) => own[k] || LABELS[k] || k;
  return (
    <div className="al al-b" style={{ display: 'block', marginTop: compact ? 4 : 8 }} aria-label="CSA requisition from the sales rep">
      <div style={{ fontWeight: 700, marginBottom: 4 }}>📨 Requisition from the sales rep{r.sent_at ? ` · ${fmtDate(String(r.sent_at).slice(0, 10))}` : ''}{r.sent_by ? ` · ${r.sent_by}` : ''}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 12 }}>
        <span>Despatch location: <b>{r.despatch_location || '—'}{r.warehouse_name ? ` (${r.warehouse_name})` : ''}</b></span>
        <span>Tentative quantity: <b>{Number(r.tentative_qty || 0).toLocaleString('en-IN')}</b></span>
        <span>Tentative despatch: <b>{r.tentative_date ? fmtDate(r.tentative_date) : '—'}</b></span>
        {/* 29.09 ¶26: "Target price (This shall only be visible in quote login)." The
            rep records it for the desk that prices the job; QC works from the sample and
            the structure, and seeing a target anchors them to it. */}
        {showTarget && <span>Target price: <b>₹{Number(r.target_price || 0).toLocaleString('en-IN')}</b></span>}
        <span>Despatch form: <b>{r.despatch_form || '—'}</b></span>
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
