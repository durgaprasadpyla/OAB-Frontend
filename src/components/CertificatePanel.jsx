import { useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { fmtDate, inr } from '../lib/format.js';
import { elementToPDF, printElement } from '../lib/pdf.js';
import { COMPANY } from '../lib/company.js';
import {
  CERT_TYPES, FOOD_GRADE_DECLARATION, certLines, certInitialData, certQty, attachCert,
} from '../lib/cert.js';

// QC Certificates — COA and Food Grade, raised per invoice line and attached to
// the invoice so the register can show their status.

export default function CertificatePanel() {
  const { mods, save } = useData();
  const [q, setQ] = useState('');
  const [pendingOnly, setPendingOnly] = useState(true);   // legacy qc-cert-pending, default checked
  const [editing, setEditing] = useState(null);   // { line, type, data }
  const [msg, setMsg] = useState(null);

  const lines = useMemo(() => certLines(mods.oab), [mods.oab]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    let list = lines;
    // A line is "done" only when BOTH its COA and Food Grade are issued.
    if (pendingOnly) list = list.filter((l) => !(l.status.coa && l.status.fg));
    if (t) list = list.filter((l) => [l.invNo, l.customer, l.spec].some((v) => String(v || '').toLowerCase().includes(t)));
    return list;
  }, [lines, q, pendingOnly]);

  function open(line, type) {
    setMsg(null);
    setEditing({
      line, type,
      data: certInitialData({ invoice: line.invoice, item: line.item, spec: line.spec, type, jss: mods.jss, oab: mods.oab?.OAB }),
    });
  }

  if (editing) {
    return (
      <CertificateEditor
        state={editing}
        onCancel={() => setEditing(null)}
        onSaved={(text) => { setEditing(null); setMsg({ t: 'g', text }); }}
        onError={(text) => setMsg({ t: 'r', text })}
        save={save}
        oabModule={mods.oab}
      />
    );
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>📄 Certificates (COA / Food Grade) <span className="tag tgr">{rows.length}</span></div>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={pendingOnly} aria-label="Pending only" onChange={(e) => setPendingOnly(e.target.checked)} />
          Pending only
        </label>
        <input placeholder="Search invoice / customer / spec…" value={q} aria-label="Search certificate lines" onChange={(e) => setQ(e.target.value)} />
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="pg-sub" style={{ marginTop: 0 }}>
        One certificate per invoice line. Submitting attaches it to the invoice, where it
        shows against that line in the register.
      </div>
      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 320px)' }}>
        <table>
          <thead><tr>
            <th>Invoice</th><th style={{ width: 110 }}>Date</th><th style={{ minWidth: 160 }}>Customer</th><th>Spec</th>
            <th style={{ textAlign: 'right' }}>Qty</th><th style={{ width: 90, textAlign: 'center' }}>COA</th>
            <th style={{ width: 110, textAlign: 'center' }}>Food Grade</th><th style={{ width: 190 }}></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>{pendingOnly ? 'No pending certificates 🎉' : 'No invoiced lines yet.'}</td></tr>
            ) : rows.map((l) => (
              <tr key={l.invNo + '|' + l.spec}>
                <td style={{ fontWeight: 700 }}>{l.invNo}</td>
                <td style={{ fontSize: 11 }}>{l.date ? fmtDate(l.date) : '—'}</td>
                <td style={{ fontSize: 11 }}>{l.customer || '—'}</td>
                <td><span className="tag tb" style={{ fontSize: 10 }}>{l.spec}</span></td>
                <td style={{ textAlign: 'right' }}>{inr(certQty(l.invoice, l.item))}</td>
                <td style={{ textAlign: 'center' }}>{l.status.coa ? <span className="tag tg">✓</span> : <span style={{ color: 'var(--i3)' }}>—</span>}</td>
                <td style={{ textAlign: 'center' }}>{l.status.fg ? <span className="tag tg">✓</span> : <span style={{ color: 'var(--i3)' }}>—</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-s" aria-label={`COA for ${l.invNo} ${l.spec}`} onClick={() => open(l, 'coa')}>COA</button>
                  <button className="btn btn-s" style={{ marginLeft: 4 }} aria-label={`Food Grade for ${l.invNo} ${l.spec}`} onClick={() => open(l, 'fg')}>Food Grade</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── Editor ─────────────────────────── */
function CertificateEditor({ state, onCancel, onSaved, onError, save, oabModule }) {
  const { line, type } = state;
  const [data, setData] = useState(state.data);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const docRef = useRef(null);

  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const setAttr = (i, k, v) => setData((d) => ({ ...d, attrs: d.attrs.map((a, j) => (j === i ? { ...a, [k]: v } : a)) }));
  const addAttr = () => setData((d) => ({ ...d, attrs: [...(d.attrs || []), { name: '', std: '', obs: '' }] }));
  const dropAttr = (i) => setData((d) => ({ ...d, attrs: d.attrs.filter((_, j) => j !== i) }));

  async function submit() {
    setBusy(true);
    try {
      await save('oab', (prev) => attachCert(prev, line.invNo, type, line.spec, data));
      onSaved(`✅ ${CERT_TYPES[type]} saved and attached to invoice ${line.invNo}.`);
    } catch (e) {
      onError(e && e.message ? e.message : String(e));
      setBusy(false);
    }
  }

  const qty = certQty(line.invoice, line.item);

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>📄 {CERT_TYPES[type]} — {line.invNo} · {line.spec}</div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={onCancel}>← Back to list</button>
      </div>

      <div className="g4">
        <RO label="Customer Name" value={line.customer} />
        <F label="Date" type="date" v={data.date} on={(v) => set('date', v)} />
        <F label="Job Name" v={data.job} on={(v) => set('job', v)} />
        <F label="SO Number" v={data.so} on={(v) => set('so', v)} placeholder="e.g. 26/342" />
        <F label="Dates of Manufacturing" v={data.dom} on={(v) => set('dom', v)} placeholder="DD.MM.YYYY" />
        <RO label="Invoice Number" value={line.invNo} />
        <F label={type === 'coa' ? 'Number of Bags' : 'Number of Boxes'} v={data.count} on={(v) => set('count', v)} placeholder="e.g. 5" />
        <RO label="Total Quantity" value={qty ? `${inr(qty)} PCS` : ''} />
        <F label="Structure" v={data.struct} on={(v) => set('struct', v)} placeholder="e.g. 51 MIC" />
        <F label="Batch No" v={data.batch} on={(v) => set('batch', v)} placeholder="e.g. 2907A" />
      </div>

      {type === 'coa' ? (
        <>
          <div className="ctitle" style={{ marginTop: 14 }}>Attributes (Standard vs Observation)</div>
          <div className="tw">
            <table>
              <thead><tr><th style={{ minWidth: 170 }}>Attribute</th><th>Standard</th><th>Observation</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {(data.attrs || []).map((a, i) => (
                  <tr key={i}>
                    <td><input value={a.name} aria-label={`Attribute ${i + 1} name`} onChange={(e) => setAttr(i, 'name', e.target.value)} /></td>
                    <td><input value={a.std} aria-label={`Attribute ${i + 1} standard`} onChange={(e) => setAttr(i, 'std', e.target.value)} /></td>
                    <td><input value={a.obs} aria-label={`Attribute ${i + 1} observation`} onChange={(e) => setAttr(i, 'obs', e.target.value)} /></td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-s" style={{ color: 'var(--red)' }} aria-label={`Remove attribute ${i + 1}`} onClick={() => dropAttr(i)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-s" style={{ marginTop: 8 }} onClick={addAttr}>+ Add attribute</button>
        </>
      ) : (
        <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8, fontSize: 12, color: 'var(--i2)', lineHeight: 1.7 }}>
          {FOOD_GRADE_DECLARATION.intro}<br />
          <strong>PE:</strong> {FOOD_GRADE_DECLARATION.pe} &nbsp;·&nbsp; <strong>INKS:</strong> {FOOD_GRADE_DECLARATION.inks}<br />
          And supplied to: <strong>{line.customer}</strong> &nbsp;·&nbsp; For {COMPANY.name} — Head Q.A.
        </div>
      )}

      <div className="fbar" style={{ marginTop: 12 }}>
        <button className="btn btn-g" onClick={submit} disabled={busy}>{busy ? 'Saving…' : '✅ Submit & attach to invoice'}</button>
        <button className="btn btn-s" onClick={() => setPreview(true)}>🖨 Preview / Download</button>
      </div>

      {preview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: 20 }}>
          <div style={{ background: 'var(--wh)', borderRadius: 10, padding: 16, maxWidth: 860 }}>
            <div className="fbar">
              <div className="ctitle" style={{ margin: 0 }}>{CERT_TYPES[type]}</div>
              <span style={{ flex: 1 }} />
              <button className="btn btn-s" onClick={() => printElement(docRef.current)}>🖨 Print</button>
              <button className="btn btn-g" onClick={() => elementToPDF(docRef.current, `${type.toUpperCase()}_${String(line.invNo).replace(/[^\w-]+/g, '_')}_${line.spec}`)}>⬇ PDF</button>
              <button className="btn btn-s" onClick={() => setPreview(false)}>Close</button>
            </div>
            <div style={{ overflow: 'auto', maxHeight: '80vh', border: '1px solid var(--bd)' }}>
              <CertificateDoc line={line} type={type} data={data} innerRef={docRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function F({ label, v, on, type = 'text', placeholder }) {
  return <div className="fg"><label>{label}</label><input type={type} value={v ?? ''} aria-label={label} placeholder={placeholder} onChange={(e) => on(e.target.value)} /></div>;
}
function RO({ label, value }) {
  return <div className="fg"><label>{label}</label><input value={value ?? ''} readOnly aria-label={label} style={{ background: 'var(--bg)' }} /></div>;
}

/* ─────────────────────────── Printable document ─────────────────────────── */
const cell = { border: '1px solid #cfe3d8', padding: '5px 8px', fontSize: 11 };
const lbl = { ...cell, background: '#eef4fc', fontWeight: 700, width: '26%' };

export function CertificateDoc({ line, type, data, innerRef }) {
  const qty = certQty(line.invoice, line.item);
  return (
    <div ref={innerRef} style={{ width: 794, background: '#fff', color: '#111', fontFamily: 'Arial, sans-serif', padding: 28 }}>
      <div style={{ textAlign: 'center', borderBottom: '3px solid #0e6fb8', paddingBottom: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{COMPANY.name}</div>
        <div style={{ fontSize: 9, color: '#555' }}>{COMPANY.addressLines.join(' ')} · GSTIN: {COMPANY.gstin}</div>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 2, marginTop: 8, color: '#0e6fb8' }}>
          {type === 'coa' ? 'CERTIFICATE OF ANALYSIS' : 'FOOD GRADE CERTIFICATE'}
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <tbody>
          <tr><td style={lbl}>Customer Name</td><td style={cell}>{line.customer}</td><td style={lbl}>Date</td><td style={cell}>{data.date ? fmtDate(data.date) : ''}</td></tr>
          <tr><td style={lbl}>Job Name</td><td style={cell}>{data.job}</td><td style={lbl}>SO Number</td><td style={cell}>{data.so}</td></tr>
          <tr><td style={lbl}>Invoice Number</td><td style={cell}>{line.invNo}</td><td style={lbl}>Dates of Manufacturing</td><td style={cell}>{data.dom}</td></tr>
          <tr><td style={lbl}>{type === 'coa' ? 'Number of Bags' : 'Number of Boxes'}</td><td style={cell}>{data.count}</td><td style={lbl}>Total Quantity</td><td style={cell}>{qty ? `${inr(qty)} PCS` : ''}</td></tr>
          <tr><td style={lbl}>Structure</td><td style={cell}>{data.struct}</td><td style={lbl}>Batch No</td><td style={cell}>{data.batch}</td></tr>
        </tbody>
      </table>

      {type === 'coa' ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#0e6fb8', color: '#fff' }}>
            <th style={{ ...cell, color: '#fff', textAlign: 'left' }}>Attribute</th>
            <th style={{ ...cell, color: '#fff', textAlign: 'left' }}>Standard</th>
            <th style={{ ...cell, color: '#fff', textAlign: 'left' }}>Observation</th>
          </tr></thead>
          <tbody>
            {(data.attrs || []).filter((a) => a.name).map((a, i) => (
              <tr key={i}><td style={cell}>{a.name}</td><td style={cell}>{a.std}</td><td style={cell}>{a.obs}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 12, lineHeight: 1.9, border: '1px solid #cfe3d8', padding: '14px 16px', borderRadius: 4 }}>
          {FOOD_GRADE_DECLARATION.intro}
          <div style={{ marginTop: 8 }}><strong>PE:</strong> {FOOD_GRADE_DECLARATION.pe}</div>
          <div><strong>INKS:</strong> {FOOD_GRADE_DECLARATION.inks}</div>
          <div style={{ marginTop: 8 }}>And supplied to: <strong>{line.customer}</strong></div>
        </div>
      )}

      <div style={{ marginTop: 40, display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ textAlign: 'center', fontSize: 11 }}>
          <div style={{ borderTop: '1px solid #333', paddingTop: 4, minWidth: 200 }}>
            For {COMPANY.name}<br /><strong>Head — Quality Assurance</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
