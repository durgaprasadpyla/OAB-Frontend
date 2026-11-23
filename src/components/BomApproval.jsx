import { useState } from 'react';
import { MATERIAL_LABEL, MATERIAL_TAG } from '../lib/bomApprovalApi.js';

// BloomFlex V2 — the BOM approval and material readiness of a sale order, as the PLAN
// board and the material panel show them.

const fmt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }));
const when = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '');

/** The board's BOM column: ✓ Approved by X, or ⚠ Pending (+ Approve for the reviewers). */
export function BomCell({ so, state, canApprove, busy, onApprove }) {
  if (!state || state.bomApproved == null) return <span style={{ color: 'var(--i3)' }}>—</span>;
  if (state.bomApproved) {
    return (
      <span className="tag tg" style={{ fontSize: 10 }} aria-label={`BOM of ${so} approved`}
        title={[`Approved ${when(state.bomApprovedAt)}`, state.bomApprovalNote].filter(Boolean).join(' — ')}>
        ✓ Approved{state.bomApprovedBy ? ` by ${state.bomApprovedBy}` : ''}
      </span>
    );
  }
  const noBom = Number(state.bomLines) === 0 || state.materialStatus === 'NO_BOM';
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
      <span className="tag ty" style={{ fontSize: 10 }} aria-label={`BOM of ${so} pending`}
        title={noBom ? 'No BOM is saved for this spec — QC must add it under Route and BOM' : 'The BOM has not been approved yet'}>
        ⚠ Pending
      </span>
      {canApprove && (
        <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }}
          disabled={busy || noBom} aria-label={`Approve BOM of ${so}`}
          title={noBom ? 'No BOM to approve' : undefined}
          onClick={(e) => { e.stopPropagation(); onApprove(so); }}>Approve</button>
      )}
    </span>
  );
}

/** The board's Material column: READY / PARTIAL / BLOCKED / NO_BOM with the eligible qty and %. */
export function MaterialCell({ so, state }) {
  if (!state || !state.materialStatus) return <span style={{ color: 'var(--i3)' }}>—</span>;
  const st = state.materialStatus;
  const showQty = st !== 'NO_BOM' && st !== 'UNKNOWN';
  return (
    <span style={{ whiteSpace: 'nowrap' }} aria-label={`Material of ${so}`}>
      <span className={'tag ' + (MATERIAL_TAG[st] || 'tgr')} style={{ fontSize: 10 }}>{MATERIAL_LABEL[st] || st}</span>
      {showQty && (
        <span style={{ fontSize: 11, marginLeft: 4 }} title="Order quantity the allocated + issued material covers">
          {fmt(state.eligibleQty)} · {fmt(state.materialCoverPct)}%
        </span>
      )}
    </span>
  );
}

/** A thin coverage bar. */
export function CoverBar({ pct }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const color = p >= 100 ? '#1e7e34' : p > 0 ? '#B7770D' : 'var(--red)';
  return (
    <div role="progressbar" aria-label="Material coverage" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}
      style={{ width: 140, height: 8, background: 'var(--bd)', borderRadius: 4, overflow: 'hidden', display: 'inline-block', verticalAlign: 'middle' }}>
      <div style={{ width: p + '%', height: '100%', background: color }} />
    </div>
  );
}

/**
 * The material panel's header: the BOM's approval (with Approve for the reviewers)
 * and how much of the BOM the order's allocations + issues cover.
 */
export function BomApprovalHeader({ so, state, cover, canApprove, onApprove }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const approved = !!(state && state.bomApproved);
  const pct = cover ? cover.pct : state ? state.materialCoverPct : null;
  const status = cover ? cover.status : state ? state.materialStatus : null;
  async function go() {
    setBusy(true);
    try { await onApprove(so, note); setNote(''); } finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '2px 0 8px' }}
      aria-label={`BOM approval of ${so}`}>
      {approved ? (
        <span className="tag tg" title={state.bomApprovalNote || undefined}>
          ✓ BOM approved{state.bomApprovedBy ? ` by ${state.bomApprovedBy}` : ''}{state.bomApprovedAt ? ` · ${when(state.bomApprovedAt)}` : ''}
        </span>
      ) : (
        <>
          <span className="tag ty">⚠ BOM approval pending — Ready to Plan stays locked until it is approved</span>
          {canApprove && state && (
            <>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" maxLength={255}
                aria-label={`Approval note for ${so}`} style={{ height: 26, width: 180, fontSize: 11 }} />
              <button className="btn btn-g" style={{ height: 26, fontSize: 11 }} disabled={busy}
                aria-label={`Approve the BOM of ${so}`} onClick={go}>✓ Approve BOM</button>
            </>
          )}
        </>
      )}
      <span style={{ flex: 1 }} />
      {status && status !== 'NO_BOM' && pct != null && (
        <span style={{ fontSize: 11, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          Material covered <CoverBar pct={pct} /> <strong>{fmt(pct)}%</strong>
          <span className={'tag ' + (MATERIAL_TAG[status] || 'tgr')} style={{ fontSize: 9 }}>{MATERIAL_LABEL[status] || status}</span>
        </span>
      )}
    </div>
  );
}
