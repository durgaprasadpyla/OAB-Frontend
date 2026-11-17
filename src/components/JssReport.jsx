import { jssReport } from '../lib/jssReport.js';
import { ArtworkButton } from './Artwork.jsx';

function Rows({ rows }) {
  return (
    <div className="g2">
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderBottom: '1px dashed var(--bd)', padding: '4px 0' }}>
          <span style={{ color: 'var(--i3)', fontSize: 12 }}>{k}</span>
          <span style={{ fontWeight: 700, fontSize: 12, textAlign: 'right' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 17.11 — the JSS report, laid out like the CSA report: the spec's structure and
 * measurements, its Specifications sheet, and the QC remarks / plant comments.
 */
export default function JssReport({ spec, sales, machines = [], group = '', onClose }) {
  const j = spec || {};
  const r = jssReport({ sales, spec: j, machines });
  return (
    <div className="card" aria-label={`JSS report ${j.spec || ''}`} style={{ border: '2px solid var(--g)' }}>
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>📋 JSS Report — {j.spec || ''}{j.jobName ? ` · ${j.jobName}` : ''}</div>
        <span style={{ flex: 1 }} />
        <ArtworkButton spec={j.spec} />
        {onClose && <button className="btn btn-s" onClick={onClose}>✕ Close</button>}
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        {[group, j.customer, j.subBrand, j.dispatchForm].filter(Boolean).join(' · ')}
        {j.status ? <> · <span className="tag tgr" style={{ fontSize: 9 }}>{j.status}</span></> : null}
        {r.csa ? <span style={{ fontSize: 11, color: 'var(--i3)' }}> · made from the CSA of {r.csa.company_name || 'the sales SKU'}</span> : null}
      </div>
      <Rows rows={r.header} />
      {r.specs.length > 0 ? (
        <div style={{ marginTop: 8 }} aria-label="JSS specifications">
          <div className="ctitle" style={{ fontSize: 12 }}>Specifications</div>
          <Rows rows={r.specs} />
        </div>
      ) : (
        <div className="al al-y" style={{ marginTop: 10 }}>
          No Specifications sheet was filled for this spec. Super Admin → JSS editor (or a new spec from its CSA) adds one.
        </div>
      )}
      {r.qcRemarks && <div className="al al-b" style={{ marginTop: 12 }}>QC remarks: {r.qcRemarks}</div>}
      {r.plantComments && <div className="al al-b" style={{ marginTop: 8 }}>🏭 Plant: {r.plantComments}</div>}
    </div>
  );
}
