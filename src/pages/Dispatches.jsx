import { useMemo, useState, useRef } from 'react';
import { ordersApi } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { fmtDate, rupees, dash } from '../lib/format.js';
import { printElement } from '../lib/pdf.js';
import InvoiceDoc from '../components/InvoiceDoc.jsx';

// Dispatches desk (27.11 Enhancements).
//
// "Create a new user login named Dispatches. Invoices created through the Account
// login should automatically appear in the Dispatches login. Each invoice should
// show a Not Opened status until it is opened in the Dispatches login."
//
// Every invoice on the register appears here — the Account login writes to the same
// register, so they arrive automatically. Each carries an open / not-opened status
// held server-side (the invoice_dispatch table); opening one here (to run the
// dispatch) stamps it Opened for everyone and shows the tax invoice to print.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The register row's payload is the exact invoice entry; fall back to the flat columns. */
function entryOf(r) {
  const p = r.payload ?? r.PAYLOAD;
  if (p) { try { return JSON.parse(p); } catch { /* fall through */ } }
  return r;
}

/** Build InvoiceDoc's { header, lines } from a saved register entry (as the Invoice screen does). */
function docOf(entry) {
  const header = {
    ivNo: entry.no, ivDt: entry.date, po: entry.po, customer: entry.customer, placeOfSupply: entry.pos,
    billingAddr: entry.billingAddr, shippingAddr: entry.shipAddr, contactPerson: entry.contact, contactNo: entry.contactNo,
    ...(entry.header || {}),
  };
  const lines = (entry.items || []).map((it) => ({
    spec: it.spec, jobName: it.jobName || it.spec, qty: it.qty, rate: it.rate,
    dispatchForm: it.dispatchForm, lineTotal: num(it.qty) * num(it.rate),
  }));
  return { header, lines };
}

export default function Dispatches() {
  const { data, refetch } = useApi('/api/invoices?limit=500');
  const [status, setStatus] = useState('');      // '' | 'open' | 'notopen'
  const [q, setQ] = useState('');
  const [view, setView] = useState(null);         // { header, lines } currently shown
  const [busy, setBusy] = useState('');           // invoice no being opened
  const [msg, setMsg] = useState(null);
  const docRef = useRef(null);

  const flash = (text, t = 'g') => { setMsg({ text, t }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  // One normalized row per invoice: the entry for display + the dispatch status.
  const rows = useMemo(() => (Array.isArray(data) ? data : []).map((r) => {
    const e = entryOf(r);
    const opened = r.opened === true || r.OPENED === true || r.opened === 1;
    return {
      no: e.no || '', date: e.date || '', po: e.po || '', customer: e.customer || '',
      qty: num(e.qty), amount: num(e.amount), entry: e,
      opened, openedBy: r.openedBy || r.OPENEDBY || '', openedAt: r.openedAt || r.OPENEDAT || '',
    };
  }), [data]);

  const notOpenedCount = rows.filter((r) => !r.opened).length;

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === 'open' && !r.opened) return false;
      if (status === 'notopen' && r.opened) return false;
      if (t && ![r.no, r.po, r.customer].some((v) => String(v || '').toLowerCase().includes(t))) return false;
      return true;
    });
  }, [rows, status, q]);

  /** Open an invoice: mark it Opened server-side (once), then show the tax invoice. */
  async function open(r) {
    setView(docOf(r.entry));
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { window.scrollTo(0, 0); }
    if (r.opened) return;                // already opened — just view it
    setBusy(r.no);
    try {
      await ordersApi.openDispatch(r.no);
      await refetch();
      flash('✅ Invoice ' + r.no + ' marked Opened.');
    } catch (e) {
      flash('Could not mark it opened: ' + (e && e.message ? e.message : e), 'r');
    } finally { setBusy(''); }
  }

  return (
    <div id="app">
      <div className="pg-ttl">🚚 Dispatches</div>
      <div className="pg-sub">
        Invoices raised by the Account login arrive here automatically. Each stays <strong>Not Opened</strong> until
        you open it — opening one records who dispatched it and shows the tax invoice to print.
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      {view && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-s" onClick={() => printElement(docRef.current)}>🖨 Print</button>
            <button className="btn btn-r" onClick={() => setView(null)}>✕ Close — back to Dispatches</button>
          </div>
          <InvoiceDoc ref={docRef} header={view.header} lines={view.lines} />
        </div>
      )}

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Invoices to Dispatch <span className="tag tgr">{shown.length}</span></div>
          <span style={{ flex: 1 }} />
          <input
            type="text" value={q} placeholder="Search invoice # / PO / customer…"
            aria-label="Search dispatches" onChange={(e) => setQ(e.target.value)} style={{ width: 240 }}
          />
          <select value={status} aria-label="Filter by status" onChange={(e) => setStatus(e.target.value)} style={{ height: 30 }}>
            <option value="">All invoices</option>
            <option value="notopen">Not Opened</option>
            <option value="open">Opened</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--i3)' }}>
            {notOpenedCount} not opened
          </span>
        </div>

        <div className="tw sy" style={{ maxHeight: '62vh' }}>
          <table>
            <thead><tr>
              <th>Invoice No</th><th>Date</th><th>PO #</th><th>Customer</th>
              <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Amount</th>
              <th style={{ textAlign: 'center' }}>Status</th><th style={{ textAlign: 'center' }}>Action</th>
            </tr></thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--i3)' }}>
                  {rows.length ? 'No invoices match' : 'No invoices yet — they appear here as the Account login raises them'}
                </td></tr>
              ) : shown.map((r, i) => (
                <tr key={r.no + i} style={!r.opened ? { background: 'var(--redl, #fdecea)' } : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      aria-label={`Open invoice ${r.no}`} onClick={() => open(r)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--blu)', fontWeight: 700, fontSize: 12 }}
                    >{r.no}</button>
                  </td>
                  <td>{fmtDate(r.date)}</td>
                  <td style={{ fontSize: 11 }}>{r.po || '-'}</td>
                  <td style={{ fontSize: 11 }}>{r.customer}</td>
                  <td style={{ textAlign: 'right' }}>{dash(r.qty)}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(r.amount)}</td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {r.opened
                      ? <span style={{ color: 'var(--g)', fontWeight: 700 }} title={r.openedBy ? `Opened by ${r.openedBy}` : 'Opened'}>✓ Opened</span>
                      : <span style={{ color: '#C0392B', fontWeight: 800 }}>● Not Opened</span>}
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 10px' }}
                      disabled={busy === r.no} aria-label={`${r.opened ? 'View' : 'Open'} ${r.no}`}
                      onClick={() => open(r)}>
                      {busy === r.no ? 'Opening…' : r.opened ? '👁 View' : '📂 Open'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
