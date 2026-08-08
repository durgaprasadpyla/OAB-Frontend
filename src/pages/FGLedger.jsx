import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { today, fmtDate } from '../lib/format.js';
import {
  fgProduced, fgAllocated, fgAvail, fgAddProduction,
  fgSpecsWithActivity, fgEntry, fgTodayISO,
} from '../lib/fg.js';

// FG Entry — finished-goods ledger (native port of the legacy tab-fg screen).
// Record finished goods produced per spec on a date (append-only). Available FG
// = produced − allocated; the New-PO drawdown and Daily-Update allocation draw
// from this pool. Persists to data module 9 (`fgLedger`).

const nfmt = (v) => Math.round(Number(v) || 0).toLocaleString('en-IN');
const srcLabel = (s) => (s === 'new-po' ? 'New sale order' : s === 'daily-update' ? 'Daily Update' : (s || '-'));

export default function FGLedger() {
  const { mods, save } = useData();
  const ledger = mods.fgLedger || {};
  const jss = Array.isArray(mods.jss) ? mods.jss : [];

  const [custFilter, setCustFilter] = useState('');
  const [spec, setSpec] = useState('');
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState('');
  const [msg, setMsg] = useState(null);      // { t:'g'|'y'|'r', text }
  const [busy, setBusy] = useState(false);
  const [sumQ, setSumQ] = useState('');

  const flash = (t, text) => { setMsg({ t, text }); if (t !== 'g') setTimeout(() => setMsg(null), 4500); };

  // Active spec pool: unique specs (first occurrence per code), status Active only.
  const specPool = useMemo(() => {
    const seen = {}, out = [];
    jss.forEach((j) => {
      const sp = String((j && j.spec) || '').trim();
      if (sp && String(j.status || '').trim().toLowerCase() === 'active' && !seen[sp]) { seen[sp] = 1; out.push(j); }
    });
    return out;
  }, [jss]);

  const customers = useMemo(
    () => [...new Set(specPool.map((j) => j.customer).filter(Boolean))].sort(),
    [specPool],
  );
  const specOptions = useMemo(() => {
    let pool = specPool;
    if (custFilter) pool = pool.filter((j) => j.customer === custFilter);
    return pool.slice().sort((a, b) => String(a.spec).localeCompare(String(b.spec), undefined, { numeric: true }));
  }, [specPool, custFilter]);

  const jssFor = (sp) => jss.find((j) => String(j.spec || '').trim() === String(sp || '').trim()) || {};
  const selJss = spec ? jssFor(spec) : {};

  const produced = fgProduced(ledger, spec);
  const allocated = fgAllocated(ledger, spec);
  const avail = fgAvail(ledger, spec);

  function onSpec(sp) {
    setSpec(sp);
    if (sp) { const j = jssFor(sp); if (j.customer) setCustFilter(j.customer); }
    if (!date) setDate(today());
  }
  function onCust(cu) { setCustFilter(cu); setSpec(''); }

  async function addProduction() {
    if (!spec) { flash('y', '⚠ Select a spec first'); return; }
    const q = Number(qty) || 0;
    if (q <= 0) { flash('y', '⚠ Enter a production quantity greater than 0'); return; }
    setBusy(true);
    try {
      const next = await save('fgLedger', (prev) => fgAddProduction(prev, spec, date || fgTodayISO(), q, ''));
      setQty('');
      flash('g', `✅ Added ${nfmt(q)} to FG for ${spec} (produced ${fmtDate(date)}). Available now: ${nfmt(fgAvail(next, spec))}`);
    } catch (e) {
      flash('r', 'Save failed: ' + (e && e.message ? e.message : String(e)));
    } finally { setBusy(false); }
  }

  // Production history (oldest first) with a running total, plus the draw-downs.
  const hist = useMemo(() => {
    const e = fgEntry(ledger, spec);
    let run = 0;
    const prod = e.prod.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)).map((p) => { run += Number(p.qty) || 0; return { ...p, run }; });
    const alloc = e.alloc.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return { prod, alloc };
  }, [ledger, spec]);

  // All-specs summary (specs with any activity), searchable.
  const summary = useMemo(() => {
    const s = sumQ.trim().toLowerCase();
    return fgSpecsWithActivity(ledger)
      .map((sp) => {
        const j = jssFor(sp);
        return { spec: sp, customer: j.customer || '', sku: j.jobName || '', prod: fgProduced(ledger, sp), alloc: fgAllocated(ledger, sp), av: fgAvail(ledger, sp) };
      })
      .filter((r) => !s || [r.spec, r.customer, r.sku].some((v) => String(v).toLowerCase().includes(s)))
      .sort((a, b) => String(a.spec).localeCompare(String(b.spec), undefined, { numeric: true }));
  }, [ledger, sumQ, jss]); // eslint-disable-line react-hooks/exhaustive-deps

  function jumpTo(sp) {
    const j = jssFor(sp);
    setCustFilter(j.customer || '');
    setSpec(sp);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div id="app">
      <div className="pg-ttl">📦 FG Entry — Finished-Goods Ledger</div>
      <div className="pg-sub">
        Record finished goods produced per spec on a given date. Entries are append-only — each day's production
        is added to the spec's running FG total. Available FG here is what the New-PO prompt and the Daily-Update FG field draw from.
      </div>

      <div className="card">
        <div className="ctitle">Select Spec (pick a customer to narrow the list)</div>
        <div className="g3">
          <div className="fg">
            <label>Customer</label>
            <select value={custFilter} onChange={(e) => onCust(e.target.value)}>
              <option value="">— All customers —</option>
              {customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="fg">
            <label>JSS / Spec #</label>
            <select value={spec} onChange={(e) => onSpec(e.target.value)}>
              <option value="">— Select spec —</option>
              {specOptions.map((j) => <option key={j.spec} value={j.spec}>{j.spec} — {j.jobName || ''}</option>)}
            </select>
          </div>
          <div className="fg">
            <label>SKU / Job Name</label>
            <select value={spec} onChange={(e) => onSpec(e.target.value)}>
              <option value="">— Select SKU —</option>
              {specOptions.map((j) => <option key={j.spec} value={j.spec}>{(j.jobName || '(no name)')} — {j.spec}</option>)}
            </select>
          </div>
        </div>

        {spec && (
          <div className="al al-g" style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--i3)' }}>Available FG</div>
              <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--g)' }}>{nfmt(avail)}</span> <span style={{ fontSize: 12, color: 'var(--i2)' }}>pouches</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--i2)' }}>
              Produced (total): <strong>{nfmt(produced)}</strong><br />Allocated to SOs: <strong>{nfmt(allocated)}</strong>
            </div>
            <div style={{ fontSize: 11, color: 'var(--i2)', borderLeft: '1px solid var(--bd)', paddingLeft: 24 }}>
              Spec: <strong>{spec}</strong><br />Customer: {selJss.customer || '-'}<br />SKU: {selJss.jobName || '-'}
            </div>
          </div>
        )}
      </div>

      {spec && (
        <div className="card">
          <div className="ctitle">Add Today's Production</div>
          {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
          <div className="g3" style={{ alignItems: 'end' }}>
            <div className="fg"><label>Production Date *</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="fg"><label>FG Produced on this date *</label><input type="number" min="0" placeholder="e.g. 20000" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div className="fg"><label>&nbsp;</label><button className="btn btn-g" onClick={addProduction} disabled={busy}>{busy ? 'Saving…' : '+ Add Production'}</button></div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--i3)', marginTop: 2 }}>This adds to the running FG total for the selected spec. It does not overwrite earlier days.</p>
        </div>
      )}

      {spec && (
        <div className="card">
          <div className="ctitle">Production History — <span style={{ color: 'var(--g)' }}>{spec}</span></div>
          <div className="tw sy">
            <table>
              <thead><tr><th style={{ width: 120 }}>Date</th><th style={{ textAlign: 'right' }}>FG Produced</th><th style={{ textAlign: 'right' }}>Running Total</th><th>Note</th></tr></thead>
              <tbody>
                {hist.prod.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>No production entered yet</td></tr>
                ) : hist.prod.map((p) => (
                  <tr key={p.id || p.ts}>
                    <td>{fmtDate(p.date)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--g)', fontWeight: 600 }}>{nfmt(p.qty)}</td>
                    <td style={{ textAlign: 'right' }}>{nfmt(p.run)}</td>
                    <td style={{ fontSize: 11, color: 'var(--i3)' }}>{p.note || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ctitle" style={{ marginTop: 16 }}>FG Drawn Down (allocations to sale orders)</div>
          <div className="tw sy">
            <table>
              <thead><tr><th style={{ width: 120 }}>Date</th><th>SO #</th><th>Source</th><th style={{ textAlign: 'right' }}>Qty Allocated</th></tr></thead>
              <tbody>
                {hist.alloc.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>Nothing allocated yet</td></tr>
                ) : hist.alloc.map((a, i) => (
                  <tr key={a.ts || i}>
                    <td>{fmtDate(a.date)}</td>
                    <td><span className="so-pill" style={{ fontSize: 10 }}>{a.so || '-'}</span></td>
                    <td style={{ fontSize: 11 }}>{srcLabel(a.src)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--red)' }}>-{nfmt(a.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>All Specs — FG Summary</div>
          <input placeholder="Search spec / customer / SKU…" value={sumQ} onChange={(e) => setSumQ(e.target.value)} style={{ width: 240, marginLeft: 'auto' }} />
        </div>
        <div className="tw sy">
          <table>
            <thead><tr><th>Spec</th><th style={{ minWidth: 160 }}>Customer</th><th style={{ minWidth: 160 }}>SKU / Job Name</th><th style={{ textAlign: 'right' }}>Produced</th><th style={{ textAlign: 'right' }}>Allocated</th><th style={{ textAlign: 'right' }}>Available</th></tr></thead>
            <tbody>
              {summary.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--i3)' }}>No FG recorded yet</td></tr>
              ) : summary.map((r) => (
                <tr key={r.spec} style={{ cursor: 'pointer' }} onClick={() => jumpTo(r.spec)}>
                  <td><span className="tag tb">{r.spec}</span></td>
                  <td style={{ fontSize: 11 }}>{r.customer || '-'}</td>
                  <td style={{ fontSize: 11 }}>{r.sku || '-'}</td>
                  <td style={{ textAlign: 'right' }}>{nfmt(r.prod)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--red)' }}>{nfmt(r.alloc)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: r.av > 0 ? 'var(--g)' : 'var(--i3)' }}>{nfmt(r.av)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
