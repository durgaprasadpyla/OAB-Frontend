import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { storesApi } from '../api.js';
import { today, fmtDate, inr } from '../lib/format.js';
import { getPM } from '../lib/pricing.js';
import { specGroup } from '../lib/master.js';
import {
  fgProduced, fgAllocated, fgAvail, fgAddProduction,
  fgSpecsWithActivity, fgEntry, fgAgeingInfo, fgTodayISO,
} from '../lib/fg.js';

/**
 * FG Entry — the finished-goods sheet, ONE screen for two logins (Stores 5.1).
 *
 * "The finished goods in stores login should function similarly to the FG entry in
 * the Superstar login and the data should be entered either from the Superstar
 * login, or from the stores login but at both places the FG should be the same.
 * The moving FG and non-moving FG report should be the same in both places."
 *
 * So the Super Admin's FG Entry page and the Stores login's FG tab both render this
 * one component. Production is booked per spec on a date (append-only) into data
 * module 9 (`fgLedger`); available FG = produced − allocated, and is what the New-PO
 * drawdown and the Daily-Update allocation draw from.
 *
 * Every booking says whether that FG is MOVING or NON-MOVING. The selection defaults
 * to Moving — fresh stock is moving stock — and can be changed to Non-moving at the
 * time of entry, or later from the summary. The flag lives server-side
 * (`store_fg_flag`), keyed by spec, so both logins read the same classification and
 * the same money split.
 */

const nfmt = (v) => Math.round(Number(v) || 0).toLocaleString('en-IN');
const srcLabel = (s) => (s === 'new-po' ? 'New sale order' : s === 'daily-update' ? 'Daily Update' : (s || '-'));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default function FgEntryPanel({ heading = true }) {
  const { mods, save } = useData();
  const ledger = mods.fgLedger || {};
  const jss = Array.isArray(mods.jss) ? mods.jss : [];
  const prices = mods.prices || {};

  const [custFilter, setCustFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');   // §43: search by Group as well as Customer
  const [spec, setSpec] = useState('');
  const [specText, setSpecText] = useState('');   // raw text in the Spec field
  const [skuText, setSkuText] = useState('');     // raw text in the SKU field
  const [searchMsg, setSearchMsg] = useState('');
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState('');
  // Stores 5.1: moving / non-moving, chosen at the time of entry. Defaults to moving.
  const [moving, setMoving] = useState(true);
  const [msg, setMsg] = useState(null);      // { t:'g'|'y'|'r', text }
  const [busy, setBusy] = useState(false);
  const [sumQ, setSumQ] = useState('');
  const [sumMove, setSumMove] = useState('');   // '' | 'moving' | 'non'
  const [sumSort] = useState('spec');   // legacy orders the FG summary by spec A→Z (7038); no sort control is exposed here
  // spec → { moving, price } from the server; a spec with no row is moving.
  const [flags, setFlags] = useState({});
  const [flagsErr, setFlagsErr] = useState('');
  const [saving, setSaving] = useState('');

  const flash = (t, text) => { setMsg({ t, text }); if (t !== 'g') setTimeout(() => setMsg(null), 4500); };

  const loadFlags = useCallback(async () => {
    try {
      const list = await storesApi.fgFlags();
      const m = {};
      (Array.isArray(list) ? list : []).forEach((f) => { if (f && f.spec) m[String(f.spec).trim()] = f; });
      setFlags(m);
      setFlagsErr('');
    } catch (e) {
      // The sheet still books production without the classification column; say why
      // the column is missing rather than silently calling everything moving.
      setFlagsErr(e && e.message ? e.message : 'Could not read the moving / non-moving flags');
    }
  }, []);
  useEffect(() => { loadFlags(); }, [loadFlags]);

  const isMoving = (sp) => { const f = flags[String(sp || '').trim()]; return !f || f.moving !== false; };

  // Active spec pool: unique specs (first occurrence per code), status Active only.
  const specPool = useMemo(() => {
    const seen = {}, out = [];
    jss.forEach((j) => {
      const sp = String((j && j.spec) || '').trim();
      if (sp && String(j.status || '').trim().toLowerCase() === 'active' && !seen[sp]) { seen[sp] = 1; out.push(j); }
    });
    return out;
  }, [jss]);

  // §43: the buying Group of a spec (via the customer master) drives a filter of
  // its own, next to the Customer filter.
  const groupOf = (j) => specGroup(j, mods.customers) || j.group || '';
  const groups = useMemo(
    () => [...new Set(specPool.map((j) => groupOf(j)).filter(Boolean))].sort(),
    [specPool, mods.customers], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const customers = useMemo(
    () => [...new Set(specPool
      .filter((j) => !groupFilter || groupOf(j) === groupFilter)
      .map((j) => j.customer).filter(Boolean))].sort(),
    [specPool, groupFilter], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const specOptions = useMemo(() => {
    let pool = specPool;
    if (groupFilter) pool = pool.filter((j) => groupOf(j) === groupFilter);
    if (custFilter) pool = pool.filter((j) => j.customer === custFilter);
    return pool.slice().sort((a, b) => String(a.spec).localeCompare(String(b.spec), undefined, { numeric: true }));
  }, [specPool, custFilter, groupFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setGroupFilter(groupOf(j));
    setSkuText(`${j.jobName || '(no name)'} — ${sp}`);
    if (!date) setDate(today());
    // The entry's FG status starts from what the spec is already classified as —
    // and that is Moving unless somebody has said otherwise.
    setMoving(isMoving(sp));
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
  // Typing a group narrows customers + specs the same way (§43).
  function onGroupText(v) { setGroupFilter(v); setCustFilter(''); clearSpec(); setSpecText(''); setSkuText(''); }

  /**
   * Manual search. An exact spec jumps straight to it; otherwise the typed
   * customer/SKU text is pushed into the summary filter below so every matching
   * spec can be browsed. (fgSearchTrigger)
   */
  function searchFg() {
    const sp = specLookup[norm(specText)] || specLookup[norm(skuText)];
    if (sp) { selectSpec(sp); return; }
    const term = [groupFilter, custFilter, skuText].map((t) => String(t || '').trim()).filter(Boolean).join(' ').trim();
    if (!term) { setSearchMsg('⚠ Type a Group, Customer Name or SKU, or pick an exact Spec, then Search.'); return; }
    setSearchMsg('');
    setSumQ(term);
  }

  /** Write the moving / non-moving flag for a spec when it differs from what the server holds. */
  async function syncFlag(sp, want) {
    const have = flags[String(sp).trim()];
    const current = !have || have.moving !== false;
    const known = !!have && have.moving != null;
    if (known && current === want) return false;
    if (!known && want) return false;   // an unclassified spec already reads as moving
    await storesApi.setFgMovement(sp, want);
    setFlags((f) => ({ ...f, [String(sp).trim()]: { ...(have || { spec: sp, price: null }), moving: want } }));
    return true;
  }

  async function addProduction() {
    if (!spec) { flash('y', '⚠ Select a spec first'); return; }
    const q = Number(qty) || 0;
    if (q <= 0) { flash('y', '⚠ Enter a production quantity greater than 0'); return; }
    setBusy(true);
    try {
      const next = await save('fgLedger', (prev) => fgAddProduction(prev, spec, date || fgTodayISO(), q, ''));
      setQty('');
      let flagNote = '';
      try {
        const changed = await syncFlag(spec, moving);
        if (changed) flagNote = ` Marked ${moving ? 'moving' : 'non-moving'}.`;
      } catch (e) {
        flagNote = ` (The FG was booked, but its moving / non-moving status could not be saved: ${e && e.message ? e.message : e})`;
      }
      flash('g', `✅ Added ${nfmt(q)} to FG for ${spec} (produced ${fmtDate(date)}). Available now: ${nfmt(fgAvail(next, spec))}.${flagNote}`);
    } catch (e) {
      flash('r', 'Save failed: ' + (e && e.message ? e.message : String(e)));
    } finally { setBusy(false); }
  }

  /** Change a spec's classification from the summary line. */
  async function setMovement(sp, want) {
    setSaving(sp);
    try {
      await storesApi.setFgMovement(sp, want);
      setFlags((f) => ({ ...f, [String(sp).trim()]: { ...(f[String(sp).trim()] || { spec: sp, price: null }), moving: want } }));
      if (sp === spec) setMoving(want);
      flash('g', `${sp} marked ${want ? 'moving' : 'non-moving'}.`);
    } catch (e) {
      flash('r', e && e.message ? e.message : String(e));
    } finally { setSaving(''); }
  }

  // Production history (oldest first) with a running total, plus the draw-downs.
  const hist = useMemo(() => {
    const e = fgEntry(ledger, spec);
    let run = 0;
    const prod = e.prod.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)).map((p) => { run += Number(p.qty) || 0; return { ...p, run }; });
    const alloc = e.alloc.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return { prod, alloc };
  }, [ledger, spec]);

  /**
   * The sale price a spec's FG is valued at: the Price Master where this login may
   * read it (Super Admin), else the price the server mirrors beside the flag (the
   * stores desk, which is never handed the price blob). No price → no value, and
   * the sheet says so rather than guessing.
   */
  const priceOf = (sp) => {
    const pm = Number(getPM(sp, prices).price) || 0;
    if (pm > 0) return pm;
    const f = flags[String(sp).trim()];
    const mirrored = f && f.price != null ? Number(f.price) : 0;
    return mirrored > 0 ? mirrored : 0;
  };

  // All-specs summary / FG valuation (specs with any activity), searchable.
  // Carries the Price-Master rate, stock value and FIFO ageing of the oldest
  // unconsumed batch — the legacy "FG Value" tab.
  const allRows = useMemo(() => fgSpecsWithActivity(ledger)
    .map((sp) => {
      const j = jssFor(sp);
      const av = fgAvail(ledger, sp);
      const price = priceOf(sp);
      const ag = fgAgeingInfo(ledger, sp);
      // "Customer Or Group": when a spec has no direct customer but belongs to a
      // buying group, show the group name (legacy custOrGroup) so it never reads "-".
      return {
        spec: sp, customer: j.customer || specGroup(j, mods.customers) || j.group || '', sku: j.jobName || '',
        prod: fgProduced(ledger, sp), alloc: fgAllocated(ledger, sp), av,
        price, value: av * price, agingDays: ag.days, ageing: ag.display,
        moving: isMoving(sp),
      };
    })
    // Hide fully-consumed specs: once FG is allocated + dispatched the available
    // qty is zero, so the SKU drops off this stock summary (client 2026-08-22).
    .filter((r) => r.av > 0.0001), [ledger, jss, prices, mods.customers, flags]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    const s = sumQ.trim().toLowerCase();
    const rows = allRows
      .filter((r) => !sumMove || (sumMove === 'moving' ? r.moving : !r.moving))
      .filter((r) => !s || [r.spec, r.customer, r.sku].some((v) => String(v).toLowerCase().includes(s)));
    const bySpec = (a, b) => String(a.spec).localeCompare(String(b.spec), undefined, { numeric: true });
    if (sumSort === 'value-desc') rows.sort((a, b) => b.value - a.value);
    else if (sumSort === 'aging-desc') rows.sort((a, b) => b.agingDays - a.agingDays);
    else if (sumSort === 'aging-asc') rows.sort((a, b) => a.agingDays - b.agingDays);
    else rows.sort(bySpec);
    return rows;
  }, [allRows, sumQ, sumMove, sumSort]);

  // The money, split the way it was asked for — the same report in both logins.
  const money = useMemo(() => allRows.reduce((t, r) => (r.moving
    ? { ...t, moving: t.moving + r.value, movingQty: t.movingQty + r.av }
    : { ...t, non: t.non + r.value, nonQty: t.nonQty + r.av }),
  { moving: 0, non: 0, movingQty: 0, nonQty: 0 }), [allRows]);
  const unpriced = allRows.filter((r) => !(r.price > 0)).length;

  function jumpTo(sp) {
    const j = jssFor(sp);
    setCustFilter(j.customer || '');
    setSpec(sp);
    setMoving(isMoving(sp));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <>
      {heading && (
        <>
          <div className="pg-ttl">📦 FG Entry — JSS / Finished Goods Sheet</div>
          <div className="pg-sub">
            Record finished goods produced per spec on a given date. Entries are append-only — each day's production
            is added to the spec's running FG total and can't be edited. Available FG here is what the New PO prompt and the Daily Update FG field draw from.
            The same sheet is used from the Stores login, so both see one FG figure and one moving / non-moving report.
          </div>
        </>
      )}

      {/* Spec picker — type-to-search on any of the three fields, the other two
          auto-fill (fgSpecInput / fgCustInput / fgSkuInput). Typing an exact spec
          opens it immediately; otherwise "Search FG" filters the summary below,
          so a partial Customer/SKU still gets you somewhere. Field order matches
          production: Spec, Customer, SKU. */}
      <div className="card">
        <div className="ctitle">Select Spec (type or pick any one — the others auto-fill)</div>
        <div className="g4">
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
          {/* §43: filter by buying Group, with type-to-search like the others. */}
          <div className="fg">
            <label>Group</label>
            <input
              list="fg-group-list" value={groupFilter} aria-label="Group"
              placeholder="— All groups — (type to search)"
              onChange={(e) => onGroupText(e.target.value)}
            />
            <datalist id="fg-group-list">
              {groups.map((g) => <option key={g} value={g} />)}
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
            <div style={{ fontSize: 11, color: 'var(--i2)', borderLeft: '1px solid var(--bd)', paddingLeft: 24 }}>
              FG status:{' '}
              <strong style={{ color: isMoving(spec) ? 'var(--g)' : 'var(--red)' }}>{isMoving(spec) ? 'Moving' : 'Non-moving'}</strong>
            </div>
          </div>
        )}
      </div>

      {spec && (
        <div className="card">
          <div className="ctitle">Add Today's Production</div>
          {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
          <div className="g4" style={{ alignItems: 'end' }}>
            <div className="fg"><label>Production Date *</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="fg"><label>FG Produced on this date *</label><input type="number" min="0" placeholder="e.g. 20000" value={qty} aria-label="FG Produced on this date" onChange={(e) => setQty(e.target.value)} /></div>
            {/* Stores 5.1: "by default it should be selected as moving. The default
                selection should be moving and I should be able to change it to
                non-moving." */}
            <div className="fg"><label>FG status</label>
              <select value={moving ? 'moving' : 'non'} aria-label="FG status"
                onChange={(e) => setMoving(e.target.value === 'moving')}
                style={{ color: moving ? undefined : 'var(--red)' }}>
                <option value="moving">Moving FG</option>
                <option value="non">Non-moving FG</option>
              </select>
            </div>
            <div className="fg"><label>&nbsp;</label><button className="btn btn-g" onClick={addProduction} disabled={busy}>{busy ? 'Saving…' : '+ Add Production'}</button></div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--i3)', marginTop: 2 }}>
            This adds to the running FG total for the selected spec. It does not overwrite earlier days.
            The FG status is the spec&rsquo;s classification for the moving / non-moving report — it changes no quantity.
          </p>
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
          <div className="ctitle" style={{ margin: 0 }}>All Specs — FG Summary <span className="tag tgr">{summary.length}</span></div>
          <input
            placeholder="Search spec / customer or group / SKU..." value={sumQ}
            aria-label="Search FG summary" onChange={(e) => setSumQ(e.target.value)}
            style={{ width: 260, marginLeft: 'auto' }}
          />
          <select value={sumMove} onChange={(e) => setSumMove(e.target.value)} aria-label="Filter by movement">
            <option value="">All FG</option>
            <option value="moving">Moving FG</option>
            <option value="non">Non-moving FG</option>
          </select>
        </div>
        {/* Stores 5.1: the moving / non-moving report, identical in both logins. */}
        <div className="stats" style={{ marginBottom: 8 }}>
          <div className="stat"><div className="sl">Moving FG</div><div className="sv" style={{ color: 'var(--g)' }}>{nfmt(money.movingQty)}</div></div>
          <div className="stat"><div className="sl">Non-moving FG</div><div className="sv" style={{ color: money.nonQty > 0 ? 'var(--red)' : undefined }}>{nfmt(money.nonQty)}</div></div>
          <div className="stat"><div className="sl">Money in moving FG</div><div className="sv" style={{ color: 'var(--g)' }}>{inr(Math.round(money.moving))}</div></div>
          <div className="stat"><div className="sl">Money in non-moving FG</div><div className="sv" style={{ color: money.non > 0 ? 'var(--red)' : undefined }}>{inr(Math.round(money.non))}</div></div>
        </div>
        {flagsErr && <div className="al al-y" style={{ marginTop: 0 }}>Moving / non-moving flags could not be read: {flagsErr}. Everything reads as moving until they load.</div>}
        {unpriced > 0 && (
          <div className="pg-sub" style={{ marginTop: 0 }}>
            {unpriced} spec(s) have no sale price on file, so they add nothing to either money figure.
          </div>
        )}
        {!heading && msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="tw sy">
          <table>
            <thead><tr>
              <th>Spec</th><th style={{ minWidth: 160 }}>Customer Or Group</th><th style={{ minWidth: 160 }}>SKU / Job Name</th>
              <th style={{ textAlign: 'right' }}>Produced</th><th style={{ textAlign: 'right' }}>Allocated</th>
              <th style={{ textAlign: 'right' }}>Available</th>
              <th style={{ textAlign: 'right' }}>Value</th>
              <th style={{ width: 150 }}>FG status</th>
            </tr></thead>
            <tbody>
              {summary.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--i3)' }}>{allRows.length ? 'No specs match' : 'No FG recorded yet'}</td></tr>
              ) : summary.map((r) => (
                <tr key={r.spec} style={{ cursor: 'pointer' }} onClick={() => jumpTo(r.spec)}>
                  <td><span className="tag tb">{r.spec}</span></td>
                  <td style={{ fontSize: 11 }}>{r.customer || '-'}</td>
                  <td style={{ fontSize: 11 }}>{r.sku || '-'}</td>
                  <td style={{ textAlign: 'right' }}>{nfmt(r.prod)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--red)' }}>{nfmt(r.alloc)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: r.av > 0 ? 'var(--g)' : 'var(--i3)' }}>{nfmt(r.av)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {r.price > 0 ? inr(Math.round(num(r.value))) : <span style={{ color: 'var(--i3)' }} title="No sale price on file for this spec">—</span>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select value={r.moving ? 'moving' : 'non'} disabled={saving === r.spec}
                      aria-label={`Movement for ${r.spec}`}
                      onChange={(e) => setMovement(r.spec, e.target.value === 'moving')}
                      style={{ height: 26, fontSize: 11, color: r.moving ? undefined : 'var(--red)' }}>
                      <option value="moving">Moving</option>
                      <option value="non">Non-moving</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
