import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { today, fmtDate, inr } from '../lib/format.js';
import { getPM } from '../lib/pricing.js';
import { specGroup } from '../lib/master.js';
import {
  fgProduced, fgAllocated, fgAvail, fgAddProduction,
  fgSpecsWithActivity, fgEntry, fgAgeingInfo,
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
  const prices = mods.prices || {};

  const [custFilter, setCustFilter] = useState('');
  const [spec, setSpec] = useState('');
  const [specText, setSpecText] = useState('');   // raw text in the Spec field
  const [skuText, setSkuText] = useState('');     // raw text in the SKU field
  const [searchMsg, setSearchMsg] = useState('');
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState('');
  const [msg, setMsg] = useState(null);      // { t:'g'|'y'|'r', text }
  const [busy, setBusy] = useState(false);
  const [sumQ, setSumQ] = useState('');
  const [sumSort, setSumSort] = useState('value-desc');

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

  /**
   * Resolve typed text to a spec. Matching is loose (case/space/punctuation
   * insensitive) and accepts either the bare spec or the "Job Name — SPEC" form
   * the SKU datalist offers, so picking from either list resolves the same way.
   * (FG_SPEC_LOOKUP / fgNorm)
   */
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const specLookup = useMemo(() => {
    const m = {};
    specPool.forEach((j) => {
      const sp = String(j.spec).trim();
      m[norm(sp)] = sp;
      m[norm(`${j.jobName || '(no name)'} — ${sp}`)] = sp;
    });
    return m;
  }, [specPool]);

  /** Select a spec and mirror it into the other two fields. (fgSpecInput) */
  function selectSpec(sp) {
    setSpec(sp);
    setSpecText(sp);
    setSearchMsg('');
    const j = jssFor(sp);
    setCustFilter(j.customer || '');
    setSkuText(`${j.jobName || '(no name)'} — ${sp}`);
    if (!date) setDate(today());
  }

  /** Clear the selection but keep whatever the user typed. */
  function clearSpec() { setSpec(''); }

  function onSpecText(v) {
    setSpecText(v);
    const sp = specLookup[norm(v)];
    if (sp) selectSpec(sp); else { clearSpec(); setSkuText(''); }
  }
  function onSkuText(v) {
    setSkuText(v);
    const sp = specLookup[norm(v)];
    if (sp) selectSpec(sp); else clearSpec();
  }
  // Typing a customer narrows the other two lists and drops any current spec.
  function onCustText(v) { setCustFilter(v); clearSpec(); setSpecText(''); setSkuText(''); }

  /**
   * Manual search. An exact spec jumps straight to it; otherwise the typed
   * customer/SKU text is pushed into the summary filter below so every matching
   * spec can be browsed. (fgSearchTrigger)
   */
  function searchFg() {
    const sp = specLookup[norm(specText)] || specLookup[norm(skuText)];
    if (sp) { selectSpec(sp); return; }
    const term = [custFilter, skuText].map((t) => String(t || '').trim()).filter(Boolean).join(' ').trim();
    if (!term) { setSearchMsg('⚠ Type a Customer Name or SKU, or pick an exact Spec, then Search.'); return; }
    setSearchMsg('');
    setSumQ(term);
  }

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

  // All-specs summary / FG valuation (specs with any activity), searchable.
  // Carries the Price-Master rate, stock value and FIFO ageing of the oldest
  // unconsumed batch — the legacy "FG Value" tab.
  const summary = useMemo(() => {
    const s = sumQ.trim().toLowerCase();
    const rows = fgSpecsWithActivity(ledger)
      .map((sp) => {
        const j = jssFor(sp);
        const av = fgAvail(ledger, sp);
        const price = Number(getPM(sp, prices).price) || 0;
        const ag = fgAgeingInfo(ledger, sp);
        // "Customer Or Group": when a spec has no direct customer but belongs to a
        // buying group, show the group name (legacy custOrGroup) so it never reads "-".
        return {
          spec: sp, customer: j.customer || specGroup(j, mods.customers) || j.group || '', sku: j.jobName || '',
          prod: fgProduced(ledger, sp), alloc: fgAllocated(ledger, sp), av,
          price, value: av * price, agingDays: ag.days, ageing: ag.display,
        };
      })
      .filter((r) => !s || [r.spec, r.customer, r.sku].some((v) => String(v).toLowerCase().includes(s)));

    const bySpec = (a, b) => String(a.spec).localeCompare(String(b.spec), undefined, { numeric: true });
    if (sumSort === 'value-desc') rows.sort((a, b) => b.value - a.value);
    else if (sumSort === 'aging-desc') rows.sort((a, b) => b.agingDays - a.agingDays);
    else if (sumSort === 'aging-asc') rows.sort((a, b) => a.agingDays - b.agingDays);
    else rows.sort(bySpec);
    return rows;
  }, [ledger, sumQ, sumSort, jss, prices, mods.customers]); // eslint-disable-line react-hooks/exhaustive-deps


  function jumpTo(sp) {
    const j = jssFor(sp);
    setCustFilter(j.customer || '');
    setSpec(sp);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div id="app">
      <div className="pg-ttl">📦 FG Entry — JSS / Finished Goods Sheet</div>
      <div className="pg-sub">
        Record finished goods produced per spec on a given date. Entries are append-only — each day's production
        is added to the spec's running FG total and can't be edited. Available FG here is what the New PO prompt and the Daily Update FG field draw from.
      </div>

      {/* Spec picker — type-to-search on any of the three fields, the other two
          auto-fill (fgSpecInput / fgCustInput / fgSkuInput). Typing an exact spec
          opens it immediately; otherwise "Search FG" filters the summary below,
          so a partial Customer/SKU still gets you somewhere. Field order matches
          production: Spec, Customer, SKU. */}
      <div className="card">
        <div className="ctitle">Select Spec (type or pick any one — the other two auto-fill)</div>
        <div className="g3">
          <div className="fg">
            <label>JSS / Spec #</label>
            <input
              list="fg-spec-list" value={specText} aria-label="JSS / Spec #"
              placeholder="— Select spec — (type to search)"
              onChange={(e) => onSpecText(e.target.value)}
            />
            <datalist id="fg-spec-list">
              {specOptions.map((j) => <option key={j.spec} value={j.spec}>{j.jobName || ''}</option>)}
            </datalist>
          </div>
          <div className="fg">
            <label>Customer</label>
            <input
              list="fg-cust-list" value={custFilter} aria-label="Customer"
              placeholder="— All customers — (type to search)"
              onChange={(e) => onCustText(e.target.value)}
            />
            <datalist id="fg-cust-list">
              {customers.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="fg">
            <label>SKU / Job Name</label>
            <input
              list="fg-sku-list" value={skuText} aria-label="SKU / Job Name"
              placeholder="— Select SKU — (type to search)"
              onChange={(e) => onSkuText(e.target.value)}
            />
            <datalist id="fg-sku-list">
              {specOptions.map((j) => <option key={j.spec} value={`${j.jobName || '(no name)'} — ${j.spec}`} />)}
            </datalist>
          </div>
        </div>

        <div className="fbar" style={{ marginTop: 4 }}>
          <button className="btn btn-g" onClick={searchFg}>🔍 Search FG</button>
          <span style={{ fontSize: 12, color: 'var(--i2)' }}>
            Pick an exact Spec to open it directly, or just type a Customer Name / SKU and hit Search to see every matching spec below.
          </span>
        </div>
        {searchMsg && <div className="al al-y" style={{ marginTop: 6 }}>{searchMsg}</div>}

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

      {/* Production keeps these as TWO cards: a plain per-spec summary, and a
          separate FG Value board that only lists stock actually on hand. */}
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>All Specs — FG Summary</div>
          <input
            placeholder="Search spec / customer or group / SKU..." value={sumQ}
            aria-label="Search FG summary" onChange={(e) => setSumQ(e.target.value)}
            style={{ width: 260, marginLeft: 'auto' }}
          />
        </div>
        <div className="tw sy">
          <table>
            <thead><tr>
              <th>Spec</th><th style={{ minWidth: 160 }}>Customer Or Group</th><th style={{ minWidth: 160 }}>SKU / Job Name</th>
              <th style={{ textAlign: 'right' }}>Produced</th><th style={{ textAlign: 'right' }}>Allocated</th>
              <th style={{ textAlign: 'right' }}>Available</th>
            </tr></thead>
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
