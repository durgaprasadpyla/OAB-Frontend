import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { today, fmtDate } from '../lib/format.js';

// QC CAPA register — complaint → corrective/preventive action tracking.
// Native port of the legacy CAPA feature (CAPA_LIST, data module 11). Persists
// via useData().save('capa', nextArray). Records are keyed by a stable `id`;
// the human number is CAPA-NNNN.

const STATUSES = ['Open', 'In Progress', 'Closed'];
const statusClass = (s) => ({ Open: 'ty', 'In Progress': 'tb', Closed: 'tg' }[s] || 'ty');

function nextNo(list) {
  let mx = 0;
  (list || []).forEach((c) => { const m = String(c.no || '').match(/(\d+)/); if (m) { const n = parseInt(m[1], 10); if (n > mx) mx = n; } });
  return 'CAPA-' + String(mx + 1).padStart(4, '0');
}
function newId() { return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }
function blank(list) {
  return {
    id: newId(), no: nextNo(list), raisedDate: today(), invNo: '', customer: '', sku: '',
    complaint: '', complaintDate: '', rootCause: '', correction: '', correctiveAction: '',
    preventiveAction: '', responsible: '', targetDate: '', status: 'Open', remarks: '',
  };
}

export default function CapaPanel() {
  const { mods, save } = useData();
  const list = Array.isArray(mods.capa) ? mods.capa : [];

  const [q, setQ] = useState('');
  const [draft, setDraft] = useState(null);   // record being added/edited, or null (list view)
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const flash = (t, text) => { setMsg({ t, text }); if (t !== 'g') setTimeout(() => setMsg(null), 4500); };
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const arr = list.slice().reverse();
    if (!s) return arr;
    return arr.filter((c) => [c.no, c.invNo, c.customer, c.sku, c.complaint, c.responsible, c.status].some((v) => String(v || '').toLowerCase().includes(s)));
  }, [list, q]);

  function openNew() { setDraft(blank(list)); setIsNew(true); }
  function openEdit(c) { setDraft({ ...c }); setIsNew(false); }
  function copy(c) { const n = { ...c, id: newId(), no: nextNo(list), raisedDate: today(), status: 'Open' }; setDraft(n); setIsNew(true); }

  async function del(c) {
    if (!window.confirm('Delete ' + (c.no || 'this CAPA') + '?')) return;
    setBusy(true);
    try { await save('capa', (prev) => (Array.isArray(prev) ? prev : []).filter((x) => x.id !== c.id)); flash('g', c.no + ' deleted'); }
    catch (e) { flash('r', 'Delete failed: ' + (e.message || e)); }
    finally { setBusy(false); }
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.customer.trim() && !draft.complaint.trim()) { flash('r', 'Enter at least a customer or complaint.'); return; }
    setBusy(true);
    try {
      await save('capa', (prev) => {
        const arr = Array.isArray(prev) ? prev.slice() : [];
        const i = arr.findIndex((x) => x.id === draft.id);
        if (i >= 0) arr[i] = draft; else arr.push(draft);
        return arr;
      });
      flash('g', draft.no + ' saved');
      setDraft(null);
    } catch (e) { flash('r', 'Save failed: ' + (e.message || e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>QC CAPA — Corrective &amp; Preventive Actions ({list.length})</div>
        <span style={{ flex: 1 }} />
        {!draft && <input placeholder="Search CAPA / invoice / customer…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />}
        {!draft && <button className="btn btn-g" onClick={openNew}>+ New CAPA</button>}
      </div>

      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      {draft ? (
        <div>
          <div className="g4">
            <div className="fg"><label>CAPA #</label><input value={draft.no} readOnly /></div>
            <div className="fg"><label>Raised Date</label><input type="date" value={draft.raisedDate} onChange={set('raisedDate')} /></div>
            <div className="fg"><label>Status</label><select value={draft.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div className="fg"><label>Responsible</label><input value={draft.responsible} onChange={set('responsible')} /></div>
          </div>
          <div className="g4">
            <div className="fg"><label>Invoice #</label><input value={draft.invNo} onChange={set('invNo')} /></div>
            <div className="fg"><label>Customer</label><input value={draft.customer} onChange={set('customer')} /></div>
            <div className="fg"><label>SKU / Job Name</label><input value={draft.sku} onChange={set('sku')} /></div>
            <div className="fg"><label>Complaint Date</label><input type="date" value={draft.complaintDate} onChange={set('complaintDate')} /></div>
          </div>
          <div className="g2">
            <div className="fg"><label>Complaint</label><textarea rows={2} value={draft.complaint} onChange={set('complaint')} style={{ width: '100%' }} /></div>
            <div className="fg"><label>Root Cause</label><textarea rows={2} value={draft.rootCause} onChange={set('rootCause')} style={{ width: '100%' }} /></div>
          </div>
          <div className="g3">
            <div className="fg"><label>Correction (immediate)</label><textarea rows={2} value={draft.correction} onChange={set('correction')} style={{ width: '100%' }} /></div>
            <div className="fg"><label>Corrective Action</label><textarea rows={2} value={draft.correctiveAction} onChange={set('correctiveAction')} style={{ width: '100%' }} /></div>
            <div className="fg"><label>Preventive Action</label><textarea rows={2} value={draft.preventiveAction} onChange={set('preventiveAction')} style={{ width: '100%' }} /></div>
          </div>
          <div className="g2">
            <div className="fg"><label>Target Date</label><input type="date" value={draft.targetDate} onChange={set('targetDate')} /></div>
            <div className="fg"><label>Remarks</label><input value={draft.remarks} onChange={set('remarks')} /></div>
          </div>
          <div className="act">
            <button className="btn btn-s" onClick={() => setDraft(null)} disabled={busy}>← Cancel</button>
            <button className="btn btn-g" onClick={saveDraft} disabled={busy}>{busy ? 'Saving…' : (isNew ? 'Add CAPA' : 'Save CAPA')}</button>
          </div>
        </div>
      ) : (
        <div className="tw sy">
          <table>
            <thead>
              <tr><th>CAPA #</th><th>Raised</th><th>Customer</th><th>Complaint</th><th>Responsible</th><th>Target</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 22, color: 'var(--i3)' }}>No CAPAs yet — click “+ New CAPA”</td></tr>
              ) : filtered.map((c) => (
                <tr key={c.id}>
                  <td><span className="tag tb" style={{ fontSize: 10 }}>{c.no}</span></td>
                  <td style={{ fontSize: 11 }}>{fmtDate(c.raisedDate) || '-'}</td>
                  <td style={{ fontSize: 11 }}>{c.customer || '-'}</td>
                  <td style={{ fontSize: 11, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.complaint}>{c.complaint || '-'}</td>
                  <td style={{ fontSize: 11 }}>{c.responsible || '-'}</td>
                  <td style={{ fontSize: 11 }}>{fmtDate(c.targetDate) || '-'}</td>
                  <td><span className={'tag ' + statusClass(c.status)} style={{ fontSize: 9 }}>{c.status || 'Open'}</span></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }} onClick={() => openEdit(c)}>Edit</button>{' '}
                    <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }} onClick={() => copy(c)}>Copy</button>{' '}
                    <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px', color: 'var(--red)', borderColor: '#F5A8A0' }} onClick={() => del(c)} disabled={busy}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
