import { useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { bomApi } from '../api.js';
import { inr } from '../lib/format.js';
import { custGroupOf } from '../lib/master.js';
import { bomOpenSOList, plannedBomMap } from '../lib/bom.js';
import { exportSoBomExcel, exportSoBomPDF } from '../lib/bomExport.js';
import { calcMetres } from '../lib/calc.js';

// Issues 3.0: "Department-wise BOMs for sale order level should also be downloadable
// from the plan and PPC logins and QC login."
//
// The Super Admin and PM get this on their Raw Material tab, which is a whole
// requirement-planning screen those three logins have no business in. This is just
// the download: pick a sale order, take the sheet. Same numbers, same sections, same
// files — one shared exporter, so no login can disagree with another about what a
// sale order needs.

export default function SoBomDownloads({ compact = false }) {
  const { mods } = useData();
  const [planned, setPlanned] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    bomApi.list()
      .then((list) => { if (live) setPlanned(plannedBomMap(list)); })
      .catch((e) => { if (live) setErr(e.message || 'Could not read the BOMs'); });
    return () => { live = false; };
  }, []);

  // The BOMs QC saves live in the planning store; module 13 keeps anything captured
  // on the Super Admin's own BOM tab. A spec in both prefers the live one.
  const bom = useMemo(() => ({ ...(mods.bom || {}), ...planned }), [mods.bom, planned]);
  const customers = mods.customers || [];

  const rows = useMemo(() => bomOpenSOList(bom, mods.oab?.OAB, {
    metresOf: (r, bal) => (calcMetres(r, bal) || {}).net || 0,
    groupOf: (c) => custGroupOf(c, customers),
  }).filter((r) => r.hasBOM), [bom, mods.oab, customers]);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => [r.so, r.spec, r.customer, r.group, r.jobName]
      .some((v) => String(v || '').toLowerCase().includes(t)));
  }, [rows, q]);

  async function download(row, kind) {
    setErr(''); setBusy(row.so + kind);
    try {
      const ok = kind === 'xls' ? exportSoBomExcel(bom, row) : await exportSoBomPDF(bom, row);
      if (!ok) setErr(`${row.spec} has no BOM lines to download.`);
    } catch (e) { setErr((kind === 'xls' ? 'Excel' : 'PDF') + ' error: ' + (e.message || String(e))); }
    finally { setBusy(''); }
  }

  return (
    <div className="card" style={compact ? { marginTop: 12 } : undefined}>
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>
          Department-wise BOM <span className="tag tgr">{visible.length}</span>
        </div>
        <input placeholder="Search SO / spec / customer…" value={q} onChange={(e) => setQ(e.target.value)}
          aria-label="Search sale orders for a BOM download" style={{ minWidth: 220 }} />
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        The material each department needs for one sale order, scaled to its balance — not the recipe&rsquo;s base quantity.
      </div>
      {err && <div className="al al-r" style={{ margin: '6px 0' }}>{err}</div>}
      {rows.length === 0 ? (
        <div className="al al-b">
          No open sale order has a BOM yet. QC saves them under Route and BOM, against the JSS spec.
        </div>
      ) : (
        <div className="tw sy" style={{ maxHeight: 320 }}>
          <table>
            <thead><tr>
              <th>SO</th><th>Spec</th><th>Customer</th><th style={{ minWidth: 140 }}>Job Name</th>
              <th style={{ textAlign: 'right' }}>Balance</th><th style={{ textAlign: 'center', width: 130 }}>Download</th>
            </tr></thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.sheet + '|' + r.so}>
                  <td><span className="so-pill" style={{ fontSize: 10 }}>{r.so}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.spec}</td>
                  <td style={{ fontSize: 11 }}>{r.customer || '—'}</td>
                  <td style={{ fontSize: 11 }}>{r.jobName || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{inr(r.bal)}</td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }}
                      disabled={!!busy} onClick={() => download(r, 'xls')}
                      aria-label={`Download department-wise BOM for ${r.so} as Excel`}>
                      {busy === r.so + 'xls' ? '…' : '⬇ XLS'}
                    </button>{' '}
                    <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }}
                      disabled={!!busy} onClick={() => download(r, 'pdf')}
                      aria-label={`Download department-wise BOM for ${r.so} as PDF`}>
                      {busy === r.so + 'pdf' ? '…' : '⬇ PDF'}
                    </button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 14, color: 'var(--i3)' }}>Nothing matches that search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
