import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { fmtDate } from '../lib/format.js';
import { daysBetween, daysSince } from '../lib/sales.js';
import { csaAll, ageColor, setCsaGivenDate } from '../lib/salesAdmin.js';

// 🧪 CSA & Quote — where samples get stuck.
//
// Three questions, three tables: how long QC took to turn a sample into a CSA report,
// how long a finished report has sat unquoted, and how long comments took to write.
// Ported from sdashCosts / sdashCostsFilter / sdashSetGivenDate.

/** A right-aligned day count coloured by how late it is. */
function Days({ d, suffix = 'd' }) {
  return <span style={{ fontWeight: 700, color: ageColor(d) }}>{d == null ? '—' : d + suffix}</span>;
}

function Section({ title, sub, children }) {
  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--g)', margin: '22px 0 8px' }}>
        {title}{sub ? <span style={{ fontWeight: 500, color: 'var(--i3)', fontSize: 11 }}> — {sub}</span> : null}
      </div>
      {children}
    </>
  );
}

export default function SalesCsaTab({ sales, save }) {
  const { saving } = useData();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const all = useMemo(() => csaAll(sales), [sales]);
  const statuses = useMemo(() => [...new Set(all.map((x) => x.status).filter(Boolean))], [all]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all
      .filter((x) => !status || x.status === status)
      .filter((x) => !t || (x.customer || '').toLowerCase().includes(t) || (x.sku || '').toLowerCase().includes(t));
  }, [all, status, q]);

  const statusCounts = useMemo(() => {
    const by = {};
    rows.forEach((x) => { const st = x.status || 'Unknown'; by[st] = (by[st] || 0) + 1; });
    return by;
  }, [rows]);

  // A: sample in → CSA report out.
  const tableA = useMemo(
    () => rows.slice().sort((a, b) => String(b.generated || '').localeCompare(String(a.generated || ''))),
    [rows],
  );
  // B: report done and commented, still not quoted.
  const tableB = useMemo(() => rows
    .filter((x) => x.commentsDone && x.status !== 'Quoted')
    .map((x) => ({ ...x, pending: daysSince(x.commentsDone) }))
    .sort((a, b) => (b.pending || 0) - (a.pending || 0)), [rows]);
  // C: how long the comments themselves took.
  const tableC = useMemo(() => rows
    .map((x) => {
      const written = !!x.commentsDone;
      return { ...x, written, delay: written ? daysBetween(x.generated, x.commentsDone) : daysSince(x.generated) };
    })
    .sort((a, b) => (b.delay || 0) - (a.delay || 0)), [rows]);

  async function setGiven(reportId, value) {
    await save('sales', (prev) => ({ ...(prev || {}), qc_reports: setCsaGivenDate((prev && prev.qc_reports) || [], reportId, value) }));
  }

  return (
    <div className="card">
      <div className="ctitle" style={{ marginBottom: 4 }}>🧪 CSA &amp; Quote</div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Customer Sample Analysis tracking, quotation-pending ageing, and comment-writing delays.
      </div>

      <div className="fbar">
        <select value={status} aria-label="Filter by CSA status" onChange={(e) => setStatus(e.target.value)}>
          <option value="">All CSA Statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={q} placeholder="Search customer / SKU..." aria-label="Search CSA" onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
      </div>

      <div style={{ background: 'var(--wh)', border: '1px solid var(--bd)', borderRadius: 10, padding: '14px 16px', marginBottom: 6, fontSize: 13 }}>
        {Object.keys(statusCounts).length
          ? Object.keys(statusCounts).map((k) => <span key={k} style={{ display: 'inline-block', marginRight: 16 }}><b>{statusCounts[k]}</b> {k}</span>)
          : 'No CSA reports match'}
      </div>

      <Section title="🧪 CSA Reports" sub="Customer Sample Analysis">
        <div className="tw sy">
          <table>
            <thead><tr>
              <th>Requisition / Submission</th><th>Given to Customer</th><th>Customer</th><th>SKU</th>
              <th style={{ textAlign: 'center' }}>Days (Submission → CSA)</th>
            </tr></thead>
            <tbody>
              {tableA.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No CSA reports match</td></tr>
              ) : tableA.map((x) => (
                <tr key={x.r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.submission ? fmtDate(String(x.submission).slice(0, 10)) : '—'}</td>
                  <td>
                    <input
                      type="date" value={x.given ? String(x.given).slice(0, 10) : ''} disabled={saving}
                      aria-label={`Given to customer for ${x.sku}`}
                      title="Date CSA report / quote was given to the customer"
                      onChange={(e) => setGiven(x.r.id, e.target.value)}
                      style={{ height: 28, fontSize: 11 }}
                    />
                  </td>
                  <td style={{ fontWeight: 700 }}>{x.customer}</td>
                  <td>{x.sku}</td>
                  <td style={{ textAlign: 'center' }}><Days d={daysBetween(x.submission, x.generated)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="⏳ Pending for Quotation" sub="CSA report done &amp; customer comments done, awaiting quote">
        <div className="tw sy">
          <table>
            <thead><tr>
              <th>Customer</th><th>SKU</th><th>Comments Done</th><th>Status</th>
              <th style={{ textAlign: 'center' }}>Days Pending Quotation</th>
            </tr></thead>
            <tbody>
              {tableB.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>Nothing pending quotation</td></tr>
              ) : tableB.map((x) => (
                <tr key={x.r.id}>
                  <td style={{ fontWeight: 700 }}>{x.customer}</td>
                  <td>{x.sku}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.commentsDone ? fmtDate(String(x.commentsDone).slice(0, 10)) : '—'}</td>
                  <td><span style={{ fontSize: 10, fontWeight: 700, color: '#2563eb' }}>{x.status || '—'}</span></td>
                  <td style={{ textAlign: 'center' }}><Days d={x.pending} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="📝 Comment-Writing Delay" sub="Days taken to write plant/customer comments after CSA submitted">
        <div className="tw sy">
          <table>
            <thead><tr>
              <th>Customer</th><th>SKU</th><th>CSA Generated</th><th>Comments Written</th>
              <th style={{ textAlign: 'center' }}>Days to Write</th>
            </tr></thead>
            <tbody>
              {tableC.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No CSA reports submitted yet</td></tr>
              ) : tableC.map((x) => (
                <tr key={x.r.id}>
                  <td style={{ fontWeight: 700 }}>{x.customer}</td>
                  <td>{x.sku}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.generated ? fmtDate(String(x.generated).slice(0, 10)) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {x.written ? fmtDate(String(x.commentsDone).slice(0, 10)) : <span style={{ color: '#c9a100' }}>Not yet</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}><Days d={x.delay} suffix={x.written ? 'd' : 'd pending'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
