import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { salesHistoryApi } from '../api.js';
import { inr } from '../lib/format.js';
import { exportAOA, readSheetAOA } from '../lib/xlsx.js';
import { buildTablePdf } from '../lib/tablePdf.js';
import {
  enrichAll, applyFilters, bySegment, sameDayComparison, monthSeries, quarterComparison, yearOnYear,
  breakdown, repFor, repsForGroup, filterOptions, parseSalesSheet, exportRows, periodOf, periodLabel,
  periodBack, MONTHS, round2, skuMonthPivot,
} from '../lib/salesHistory.js';

/**
 * 📜 Sales History (Issues 6 §18-§37) — a Dashboard tab.
 *
 * The current month is what the invoicing module has booked, read live off the
 * server every time the tab opens (and on ↻); past months come from the same
 * register or, where one was uploaded, from the month's sheet. Everything on the
 * page — the Stayfresh / domestic split, the Price Master margins, the same-day
 * comparison with last month, the trends, the tables, the PDF and the Excel — is
 * computed from the same lines under the same filters, so the figures always agree.
 */

const SERIES = {
  // categorical slots 1–3 of the validated reference palette (dataviz skill)
  total: { label: 'All sales', color: '#2a78d6' },
  stayfresh: { label: 'Stayfresh', color: '#1baf7a' },
  domestic: { label: 'Domestic', color: '#eb6834' },
};
const METRICS = [
  { k: 'sale', label: 'Sales (₹, base)' },
  { k: 'inclGst', label: 'Sales incl. GST (₹)' },
  { k: 'margin', label: 'Margin (₹)' },
  { k: 'marginPct', label: 'Margin %' },
  { k: 'qty', label: 'Quantity (pcs)' },
];
const HISTORY_MONTHS = 36;    // loaded: enough for a 24-month trend plus last year's comparison
const CHART_MONTHS = 24;

const money = (v) => '₹' + inr(Math.round(Number(v) || 0));
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%');
const arrow = (d) => (d > 0 ? '▲' : d < 0 ? '▼' : '•');
const tone = (d) => (d > 0 ? 'var(--g)' : d < 0 ? 'var(--red)' : 'var(--i2)');

export default function SalesHistoryPanel() {
  const { mods } = useData();
  const today = useMemo(() => new Date(), []);
  const currentPeriod = periodOf(today);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const period = year + '-' + String(month).padStart(2, '0');
  const [fSpec, setFSpec] = useState('');
  const [fGroup, setFGroup] = useState('');
  const [fCust, setFCust] = useState('');
  const [metric, setMetric] = useState('sale');
  const [raw, setRaw] = useState({ lines: [], periods: [] });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [asOf, setAsOf] = useState(null);
  const [msg, setMsg] = useState(null);
  const [uploads, setUploads] = useState([]);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 6000); };

  const ctx = useMemo(() => ({
    jss: Array.isArray(mods.jss) ? mods.jss : [],
    customers: Array.isArray(mods.customers) ? mods.customers : [],
    prices: mods.prices || {},
    sales: mods.sales || {},
  }), [mods.jss, mods.customers, mods.prices, mods.sales]);

  /* ── live data: every open of the tab and every ↻ re-reads the register ── */
  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const from = periodBack(currentPeriod, HISTORY_MONTHS - 1);
      const r = await salesHistoryApi.lines(from, currentPeriod);
      setRaw({ lines: Array.isArray(r && r.lines) ? r.lines : [], periods: Array.isArray(r && r.periods) ? r.periods : [], undated: r && r.undatedInvoices });
      setAsOf(new Date());
      try { setUploads((await salesHistoryApi.uploads()) || []); } catch { setUploads([]); }
    } catch (e) { setErr(e && e.message ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [currentPeriod]);
  useEffect(() => { load(); }, [load]);

  const lines = useMemo(() => enrichAll(raw.lines, ctx), [raw.lines, ctx]);
  const sources = useMemo(() => { const m = {}; raw.periods.forEach((p) => { m[p.period] = p.source; }); return m; }, [raw.periods]);
  const periodInfo = raw.periods.find((p) => p.period === period) || null;
  const filters = { spec: fSpec, group: fGroup, customer: fCust };
  const filtered = useMemo(() => applyFilters(lines, filters), [lines, fSpec, fGroup, fCust]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthLines = useMemo(() => filtered.filter((l) => l.period === period), [filtered, period]);
  const seg = useMemo(() => bySegment(monthLines), [monthLines]);
  const cmp = useMemo(() => sameDayComparison(filtered, period, today, sources), [filtered, period, today, sources]);
  const yoy = useMemo(() => yearOnYear(filtered, period), [filtered, period]);
  const quarter = useMemo(() => quarterComparison(filtered, period), [filtered, period]);
  const series = useMemo(() => monthSeries(filtered, period, CHART_MONTHS, sources), [filtered, period, sources]);
  const byCustomer = useMemo(() => breakdown(filtered, period, 'customer', ctx), [filtered, period, ctx]);
  const byGroup = useMemo(() => breakdown(filtered, period, 'group', ctx), [filtered, period, ctx]);
  const bySku = useMemo(() => breakdown(filtered, period, 'spec', ctx), [filtered, period, ctx]);
  const skuPivot = useMemo(() => skuMonthPivot(filtered, period, 12), [filtered, period]);
  const options = useMemo(() => filterOptions(lines, ctx), [lines, ctx]);
  const rep = useMemo(() => (fCust ? repFor(fCust, ctx) : fGroup ? repsForGroup(fGroup, ctx) : null), [fCust, fGroup, ctx]);
  const years = useMemo(() => {
    const ys = new Set([today.getFullYear()]);
    lines.forEach((l) => { const y = Number(String(l.period).slice(0, 4)); if (y) ys.add(y); });
    for (let y = today.getFullYear() - 1; y >= today.getFullYear() - 5; y--) ys.add(y);
    return [...ys].sort((a, b) => b - a);
  }, [lines, today]);

  /* ── exports: always from the lines on screen (§35-§37) ── */
  function exportExcel() {
    const { head, body, summary } = exportRows(filtered, period, seg);
    exportAOA([...summary, head, ...body], `Sales_History_${period}.xlsx`, periodLabel(period));
    flash('g', `Excel for ${periodLabel(period)} downloaded — ${body.length} line(s), ${periodInfo && periodInfo.source === 'upload' ? 'from the uploaded sheet' : 'live from invoicing'}.`);
  }
  function exportPdf() {
    const { body } = exportRows(filtered, period, seg);
    // the PDF's Helvetica has no rupee glyph — spell it
    const rs = (v) => 'Rs ' + inr(Math.round(Number(v) || 0));
    const pdf = buildTablePdf({
      title: 'Bloomflex — Sales History ' + periodLabel(period),
      subtitle: (periodInfo && periodInfo.source === 'upload' ? 'From the uploaded sheet' : 'Live from the invoicing module') + ' · generated ' + new Date().toLocaleString('en-IN')
        + (fCust ? ' · customer ' + fCust : '') + (fGroup ? ' · group ' + fGroup : '') + (fSpec ? ' · spec ' + fSpec : ''),
      meta: [
        ['Stayfresh sale', rs(seg.stayfresh.sale)], ['Stayfresh margin', seg.stayfresh.marginPct == null ? '—' : rs(seg.stayfresh.margin) + ' (' + pct(seg.stayfresh.marginPct) + ')'],
        ['Domestic sale', rs(seg.domestic.sale)], ['Domestic margin', seg.domestic.marginPct == null ? '—' : rs(seg.domestic.margin) + ' (' + pct(seg.domestic.marginPct) + ')'],
        ['Total sale (base)', rs(seg.all.sale)], ['Total incl. GST 18%', rs(seg.all.inclGst)],
        ['Quantity', inr(seg.all.qty)], ['Same-day vs last month', rs(cmp.total.now) + ' vs ' + rs(cmp.total.before) + ' (' + pct(cmp.total.pct) + ')'],
        ['JSS without Price Master', String(seg.all.missingSpecs.length)], ['Invoices', String(seg.all.invoices)],
      ],
      columns: [
        { label: 'Invoice', width: 1.1 }, { label: 'Date', width: 1 }, { label: 'Customer', width: 2.2 }, { label: 'Spec', width: 0.9 },
        { label: 'SKU', width: 2.4 }, { label: 'Seg.', width: 0.8 }, { label: 'Qty', width: 0.9, align: 'right' },
        { label: 'Rate', width: 0.8, align: 'right' }, { label: 'Sale', width: 1.1, align: 'right' }, { label: 'Incl. GST', width: 1.1, align: 'right' },
        { label: 'Margin', width: 1, align: 'right' },
      ],
      rows: body.map((r) => [r[0], r[1], r[2], r[4], r[5], r[6] === 'Stayfresh' ? 'SF' : r[6] === 'Domestic' ? 'Dom' : '?', r[7], r[8], r[9], r[11], r[13] === '' ? '—' : r[13]]),
      totals: ['', '', 'Total', '', '', '', seg.all.qty, '', round2(seg.all.sale), round2(seg.all.inclGst), round2(seg.all.margin)],
      orientation: 'landscape',
      note: 'Bloomflex OAB · Sales History · margins from the Price Master cost · GST at 18% as on the tax invoice',
    });
    pdf.save(`Sales_History_${period}.pdf`);
    flash('g', `PDF for ${periodLabel(period)} downloaded.`);
  }

  return (
    <>
      {/* one row of filters above everything — they scope every figure, chart and table below */}
      <div className="card">
        <div className="fbar" style={{ flexWrap: 'wrap' }}>
          <div className="ctitle" style={{ margin: 0 }}>📜 Sales History</div>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={fGroup} onChange={(e) => { setFGroup(e.target.value); setFCust(''); }} aria-label="Group">
            <option value="">All groups</option>
            {options.groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={fCust} onChange={(e) => setFCust(e.target.value)} aria-label="Customer">
            <option value="">All customers</option>
            {options.customers.filter((c) => !fGroup || lines.some((l) => l.customer === c && l.group === fGroup) || ctx.customers.some((x) => x.customer === c && x.group === fGroup))
              .map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={fSpec} onChange={(e) => setFSpec(e.target.value)} aria-label="Specification">
            <option value="">All specifications</option>
            {options.specs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="fbar-actions">
            <button className="btn btn-s" onClick={load} disabled={loading} aria-label="Refresh sales history">{loading ? 'Reading…' : '↻ Refresh'}</button>
            <button className="btn btn-s" onClick={exportPdf} disabled={loading} aria-label="Download PDF">⬇ PDF</button>
            <button className="btn btn-s" onClick={exportExcel} disabled={loading} aria-label="Download Excel">⬇ Excel</button>
          </div>
        </div>
        <div className="pg-sub" style={{ marginTop: 4 }} aria-label="Data source">
          {err ? <span style={{ color: 'var(--red)' }}>Could not read the sales history: {err}</span>
            : periodInfo && periodInfo.source === 'upload'
              ? <>{periodLabel(period)} is from the sheet <b>{periodInfo.fileName || 'uploaded'}</b> ({periodInfo.lineCount} rows, uploaded {periodInfo.uploadedAt ? new Date(periodInfo.uploadedAt).toLocaleDateString('en-IN') : ''}{periodInfo.uploadedBy ? ' by ' + periodInfo.uploadedBy : ''}).</>
              : <>{periodLabel(period)} is read <b>live from the invoicing module</b>{periodInfo ? ` — ${periodInfo.invoices || 0} invoice(s), ${periodInfo.lineCount || 0} line(s)` : ''}{asOf ? `, as of ${asOf.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}.{raw.undated ? ` ${raw.undated} invoice(s) carry no readable date and are not counted.` : ''}</>}
          {period > currentPeriod && <span style={{ color: '#B7770D' }}> That month has not happened yet.</span>}
        </div>
        {msg && <div className={'al al-' + msg.t} style={{ marginTop: 6 }}>{msg.text}</div>}
      </div>

      {/* §20-§21: the landing figures */}
      <div className="card">
        <div className="ctitle">{periodLabel(period)} — sales and margins{fCust ? ` · ${fCust}` : fGroup ? ` · ${fGroup}` : ''}{fSpec ? ` · ${fSpec}` : ''}</div>
        <div className="stats" style={{ marginBottom: 8 }}>
          <div className="stat"><div className="sl">Stayfresh sale</div><div className="sv" style={{ color: SERIES.stayfresh.color }}>{money(seg.stayfresh.sale)}</div></div>
          <div className="stat"><div className="sl">Domestic sale</div><div className="sv" style={{ color: SERIES.domestic.color }}>{money(seg.domestic.sale)}</div></div>
          <div className="stat"><div className="sl">Total sale (base)</div><div className="sv">{money(seg.all.sale)}</div></div>
          <div className="stat"><div className="sl">Total incl. GST 18%</div><div className="sv">{money(seg.all.inclGst)}</div></div>
          <div className="stat"><div className="sl">Stayfresh margin</div><div className="sv" style={{ color: SERIES.stayfresh.color }}>{seg.stayfresh.marginPct == null ? '—' : money(seg.stayfresh.margin)}<span style={{ fontSize: 11, color: 'var(--i2)', marginLeft: 6 }}>{seg.stayfresh.marginPct == null ? 'no Price Master cost' : pct(seg.stayfresh.marginPct)}</span></div></div>
          <div className="stat"><div className="sl">Domestic margin</div><div className="sv" style={{ color: SERIES.domestic.color }}>{seg.domestic.marginPct == null ? '—' : money(seg.domestic.margin)}<span style={{ fontSize: 11, color: 'var(--i2)', marginLeft: 6 }}>{seg.domestic.marginPct == null ? 'no Price Master cost' : pct(seg.domestic.marginPct)}</span></div></div>
        </div>
        {seg.all.missingSpecs.length > 0 && (
          <div className="al al-y" role="note" aria-label="Missing price master">
            <b>{seg.all.missingSpecs.length} invoiced JSS do not have Price Master details</b> ({seg.all.missingSpecs.slice(0, 12).join(', ')}{seg.all.missingSpecs.length > 12 ? ', …' : ''}) —
            their {money(seg.all.sale - seg.all.costedSale)} of sale is counted in the sales figures but left out of the margins rather than booked at zero cost. Add the cost under Dashboard → Price Master.
          </div>
        )}
        {seg.unknown > 0 && (
          <div className="pg-sub" style={{ marginTop: 0 }}>{seg.unknown} line(s) name a spec the JSS master does not know, so they count as domestic.</div>
        )}
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Sales are the invoice line values (rate × quantity) before tax; GST is 18% as on the tax invoice. Margin = (rate − Price Master cost) × quantity, per line.
          {' '}{seg.all.invoices ? `${seg.all.invoices} invoice(s), ` : ''}{inr(seg.all.qty)} pieces.
        </div>
      </div>

      {/* §22 / §24 / §26: the comparisons */}
      <div className="card">
        <div className="ctitle">Month on month — {cmp.label}</div>
        {cmp.note && <div className="pg-sub" style={{ marginTop: 0, color: '#B7770D' }}>{cmp.note}</div>}
        <div className="stats" style={{ marginBottom: 8 }}>
          {[['Total', cmp.total], ['Stayfresh', cmp.stayfresh], ['Domestic', cmp.domestic], ['Margin', cmp.margin]].map(([label, c]) => (
            <div className="stat" key={label} aria-label={`${label} month on month`}>
              <div className="sl">{label}: {money(c.now)} vs {money(c.before)}</div>
              <div className="sv" style={{ color: tone(c.delta) }}>{arrow(c.delta)} {money(Math.abs(c.delta))} <span style={{ fontSize: 12 }}>({pct(c.pct)})</span></div>
            </div>
          ))}
        </div>
        <div className="stats">
          <div className="stat" aria-label="Year on year"><div className="sl">{yoy.label}</div>
            <div className="sv" style={{ color: tone(yoy.delta) }}>{arrow(yoy.delta)} {pct(yoy.pct)} <span style={{ fontSize: 11, color: 'var(--i2)' }}>{money(yoy.now)} vs {money(yoy.before)}</span></div></div>
          <div className="stat" aria-label="Last quarter"><div className="sl">Last quarter: {quarter.label}</div>
            <div className="sv" style={{ color: tone(quarter.delta) }}>{arrow(quarter.delta)} {pct(quarter.pct)} <span style={{ fontSize: 11, color: 'var(--i2)' }}>{money(quarter.now)} vs {money(quarter.before)}</span></div></div>
          <div className="stat" aria-label="Quantity month on month"><div className="sl">Pieces: {inr(cmp.qty.now)} vs {inr(cmp.qty.before)}</div>
            <div className="sv" style={{ color: tone(cmp.qty.delta) }}>{arrow(cmp.qty.delta)} {pct(cmp.qty.pct)}</div></div>
        </div>
        {/* §29-§30: who to call when a customer or group is falling */}
        {rep && (
          <div className={'al ' + (cmp.total.delta < 0 ? 'al-r' : 'al-b')} style={{ marginTop: 8 }} aria-label="Sales representative">
            <b>{fCust || fGroup}</b> — Sales representative / KAM:{' '}
            {rep.found && (rep.kam || rep.rep)
              ? <>{rep.kam ? <b>{rep.kam}</b> : null}{rep.kam && rep.rep ? ' · rep ' : ''}{rep.rep ? <b>{rep.rep}</b> : null}</>
              : <span>none recorded — set one under Dashboard → Customer KAM &amp; Targets.</span>}
            {cmp.total.delta < 0 && <> {' '}Sales are <b>down {pct(cmp.total.pct)}</b> ({money(cmp.total.before)} → {money(cmp.total.now)}) — worth a call.</>}
            {cmp.total.delta > 0 && <> {' '}Sales are up {pct(cmp.total.pct)}.</>}
          </div>
        )}
      </div>

      {/* §24-§27: the trend, per filter, with a hover readout */}
      <TrendChart series={series} metric={metric} setMetric={setMetric} period={period}
        title={`Trend — ${fCust || fGroup || fSpec || 'all sales'}, last ${CHART_MONTHS} months`} />

      {/* §24-§25: every SKU month by month — the per-SKU history under the chosen customer / group */}
      <SkuPivotTable pivot={skuPivot} period={period} scope={fCust || fGroup || 'all customers'} onPick={(k) => setFSpec(k)} />

      {/* §24 / §26 / §27 / §30: the tables */}
      <BreakdownTable title="By customer" rows={byCustomer} period={period} keyLabel="Customer" showRep onPick={(k) => setFCust(k)} />
      <BreakdownTable title="By group" rows={byGroup} period={period} keyLabel="Group" showRep onPick={(k) => { setFGroup(k); setFCust(''); }} />
      <BreakdownTable title="By specification / SKU" rows={bySku} period={period} keyLabel="Spec" showSku onPick={(k) => setFSpec(k)} />

      {/* the month's lines — the same rows the PDF and the Excel carry */}
      <div className="card">
        <div className="ctitle">{periodLabel(period)} — every sale line <span className="tag tgr">{monthLines.length}</span></div>
        <div className="tw sy" style={{ maxHeight: 360 }}><table>
          <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Group</th><th>Spec</th><th>SKU</th><th>Seg.</th>
            <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Sale</th>
            <th style={{ textAlign: 'right' }}>Incl. GST</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Margin</th></tr></thead>
          <tbody>
            {monthLines.length === 0 ? <tr><td colSpan={13} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>{loading ? 'Reading…' : 'No sales in this month for these filters'}</td></tr>
              : monthLines.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((l, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 11 }}>{l.invNo || (l.source === 'upload' ? 'sheet' : '—')}</td>
                  <td style={{ fontSize: 11 }}>{l.source === 'upload' ? periodLabel(l.period) : l.date}</td>
                  <td style={{ fontSize: 11 }}>{l.customer}</td>
                  <td style={{ fontSize: 11 }}>{l.group}</td>
                  <td><span className="tag tb">{l.spec || '—'}</span></td>
                  <td style={{ fontSize: 11 }}>{l.jobName || '—'}</td>
                  <td style={{ fontSize: 11, color: l.segment === 'stayfresh' ? SERIES.stayfresh.color : SERIES.domestic.color }}>{l.segment === 'stayfresh' ? 'Stayfresh' : l.segment === 'unknown' ? '?' : 'Domestic'}</td>
                  <td style={{ textAlign: 'right' }}>{inr(l.qty)}</td>
                  <td style={{ textAlign: 'right' }}>{l.rate ? inr(l.rate, 2) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(l.amount)}</td>
                  <td style={{ textAlign: 'right' }}>{money(l.amountInclGst)}</td>
                  <td style={{ textAlign: 'right' }}>{l.hasCost ? inr(l.cost, 2) : <span style={{ color: '#B7770D' }} title="No Price Master cost">—</span>}</td>
                  <td style={{ textAlign: 'right', color: l.hasCost ? tone(l.margin) : 'var(--i3)' }}>{l.hasCost ? money(l.margin) : '—'}</td>
                </tr>
              ))}
          </tbody>
        </table></div>
      </div>

      {/* §31-§34: past months from a sheet */}
      <UploadCard currentPeriod={currentPeriod} uploads={uploads} onDone={load} flash={flash} />
    </>
  );
}

/* ───────────────────────────── the trend chart ───────────────────────────── */

const BOX = { W: 760, H: 260, mL: 64, mR: 58, mT: 18, mB: 40 };

/**
 * Three lines over the same months — all sales, Stayfresh, domestic — on one
 * axis, with a crosshair that snaps to the nearest month and a readout of every
 * series there. Drawn as SVG: one polyline per series, direct labels at the last
 * point, a legend, and a table of the same months below for the reader who
 * wants numbers rather than a picture.
 */
function TrendChart({ series, metric, setMetric, period, title }) {
  const [hover, setHover] = useState(null);   // index into series
  const svgRef = useRef(null);
  const keys = ['total', 'stayfresh', 'domestic'];
  const valueOf = (p, k) => {
    if (k === 'total') return p[metric] == null ? null : p[metric];
    if (metric === 'sale') return p[k];
    return null;                     // Stayfresh / domestic split is drawn for base sales only
  };
  const drawn = metric === 'sale' ? keys : ['total'];
  const max = Math.max(1, ...series.flatMap((p) => drawn.map((k) => valueOf(p, k) || 0)));
  const min = metric === 'margin' || metric === 'marginPct' ? Math.min(0, ...series.map((p) => valueOf(p, 'total') || 0)) : 0;
  const iw = BOX.W - BOX.mL - BOX.mR;
  const ih = BOX.H - BOX.mT - BOX.mB;
  const x = (i) => BOX.mL + (series.length === 1 ? iw / 2 : (i * iw) / (series.length - 1));
  const y = (v) => BOX.mT + ih - ((v - min) / (max - min || 1)) * ih;
  const fmt = (v) => (v == null ? '—' : metric === 'marginPct' ? v.toFixed(1) + '%' : metric === 'qty' ? inr(Math.round(v)) : money(v));
  const short = (v) => (metric === 'marginPct' ? v.toFixed(0) + '%' : metric === 'qty' ? (v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : inr(Math.round(v))) : (v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : inr(Math.round(v))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
  const line = (k) => series.map((p, i) => { const v = valueOf(p, k); return v == null ? null : `${x(i)},${y(v)}`; }).filter(Boolean).join(' ');

  function onMove(e) {
    const svg = svgRef.current;
    if (!svg || !series.length) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * BOX.W;
    let best = 0, bd = Infinity;
    series.forEach((_, i) => { const d = Math.abs(x(i) - px); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  }
  const hp = hover != null ? series[hover] : null;
  const mm = (p) => { const i = series.findIndex((s) => s.period === p); return i > 0 ? series[i - 1] : null; };

  return (
    <div className="card">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>{title}</div>
        <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Trend metric" style={{ marginLeft: 'auto' }}>
          {METRICS.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}
        </select>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }} aria-label="Legend">
        {drawn.map((k) => <span key={k} style={{ marginRight: 14, color: SERIES[k].color, fontWeight: 700 }}>━ {SERIES[k].label}</span>)}
        — hover a month for every figure; the table below carries the same numbers. Months from an uploaded sheet are marked ◇.
      </div>
      <div className="tw">
        <svg ref={svgRef} viewBox={`0 0 ${BOX.W} ${BOX.H}`} width="100%" style={{ minWidth: 640, display: 'block', cursor: 'crosshair' }}
          role="img" aria-label={`${METRICS.find((m) => m.k === metric).label} by month`}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={BOX.mL} y1={y(t)} x2={BOX.W - BOX.mR} y2={y(t)} stroke="var(--bd)" strokeWidth="1" />
              <text x={BOX.mL - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--i3)">{short(t)}</text>
            </g>
          ))}
          {min < 0 && <line x1={BOX.mL} y1={y(0)} x2={BOX.W - BOX.mR} y2={y(0)} stroke="var(--i3)" strokeWidth="1" />}
          {drawn.map((k) => <polyline key={k} points={line(k)} fill="none" stroke={SERIES[k].color} strokeWidth="2" strokeLinejoin="round" />)}
          {series.map((p, i) => (
            <g key={p.period}>
              {((series.length - 1 - i) % Math.max(1, Math.ceil(series.length / 12)) === 0) && (
                <text x={x(i)} y={BOX.H - BOX.mB + 16} textAnchor="middle" fontSize="10" fill={p.period === period ? 'var(--blu)' : 'var(--i2)'} fontWeight={p.period === period ? 700 : 400}>
                  {p.label.replace(' 20', ' ’')}{p.source === 'upload' ? ' ◇' : ''}
                </text>
              )}
              {drawn.map((k) => { const v = valueOf(p, k); return v == null ? null : <circle key={k} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 3} fill={SERIES[k].color} stroke="#fff" strokeWidth="2" />; })}
            </g>
          ))}
          {/* direct labels at the last point, to the right of it, nudged apart when two series sit close */}
          {series.length > 0 && (() => {
            const last = series[series.length - 1];
            const pts = drawn.map((k) => ({ k, v: valueOf(last, k) })).filter((p) => p.v != null).map((p) => ({ ...p, y: y(p.v) })).sort((a, b) => a.y - b.y);
            for (let i = 1; i < pts.length; i++) if (pts[i].y - pts[i - 1].y < 11) pts[i].y = pts[i - 1].y + 11;
            return pts.map((p) => <text key={p.k} x={x(series.length - 1) + 7} y={p.y + 3.5} textAnchor="start" fontSize="10" fill={SERIES[p.k].color} fontWeight={700}>{short(p.v)}</text>);
          })()}
          {hp && <line x1={x(hover)} y1={BOX.mT} x2={x(hover)} y2={BOX.mT + ih} stroke="var(--i3)" strokeWidth="1" strokeDasharray="3 3" />}
        </svg>
      </div>
      {hp && (
        <div className="al al-b" style={{ marginTop: 4, fontSize: 12 }} aria-label="Hover readout" role="status">
          <b>{hp.label}</b>{hp.source === 'upload' ? ' (uploaded sheet)' : ''} —{' '}
          {drawn.map((k) => <span key={k} style={{ marginRight: 12 }}><span style={{ color: SERIES[k].color }}>━</span> <b>{fmt(valueOf(hp, k))}</b> {SERIES[k].label}</span>)}
          {metric === 'sale' && <span style={{ marginRight: 12 }}>· incl. GST <b>{money(hp.inclGst)}</b></span>}
          <span style={{ marginRight: 12 }}>· pieces <b>{inr(hp.qty)}</b></span>
          <span style={{ marginRight: 12 }}>· margin <b>{hp.marginPct == null ? '—' : money(hp.margin) + ' (' + pct(hp.marginPct) + ')'}</b></span>
          {mm(hp.period) && <span>· vs {mm(hp.period).label}: <b style={{ color: tone(hp.sale - mm(hp.period).sale) }}>{pct(mm(hp.period).sale ? ((hp.sale - mm(hp.period).sale) / mm(hp.period).sale) * 100 : null)}</b></span>}
        </div>
      )}
      <div className="tw sy" style={{ maxHeight: 220, marginTop: 6 }}><table>
        <thead><tr><th>Month</th><th>Source</th><th style={{ textAlign: 'right' }}>All sales</th><th style={{ textAlign: 'right' }}>Stayfresh</th><th style={{ textAlign: 'right' }}>Domestic</th>
          <th style={{ textAlign: 'right' }}>Incl. GST</th><th style={{ textAlign: 'right' }}>Pieces</th><th style={{ textAlign: 'right' }}>Margin</th><th style={{ textAlign: 'right' }}>Margin %</th><th style={{ textAlign: 'right' }}>vs prev. month</th><th style={{ textAlign: 'right' }}>Same month last year</th></tr></thead>
        <tbody>
          {series.slice().reverse().map((p, i, arr) => {
            const prev = arr[i + 1];
            const d = prev ? p.sale - prev.sale : 0;
            return (
              <tr key={p.period} className={p.period === period ? 'hi' : undefined}>
                <td style={{ fontWeight: p.period === period ? 700 : 400 }}>{p.label}</td>
                <td style={{ fontSize: 11 }}>{p.source === 'upload' ? 'sheet' : 'invoices'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(p.sale)}</td>
                <td style={{ textAlign: 'right' }}>{money(p.stayfresh)}</td>
                <td style={{ textAlign: 'right' }}>{money(p.domestic)}</td>
                <td style={{ textAlign: 'right' }}>{money(p.inclGst)}</td>
                <td style={{ textAlign: 'right' }}>{inr(p.qty)}</td>
                <td style={{ textAlign: 'right' }}>{p.marginPct == null ? '—' : money(p.margin)}</td>
                <td style={{ textAlign: 'right' }}>{p.marginPct == null ? '—' : p.marginPct.toFixed(1) + '%'}</td>
                <td style={{ textAlign: 'right', color: tone(d) }}>{prev ? arrow(d) + ' ' + pct(prev.sale ? (d / prev.sale) * 100 : null) : '—'}</td>
                <td style={{ textAlign: 'right', fontSize: 11 }}>{money(p.lastYear)} <span style={{ color: tone(p.sale - p.lastYear) }}>{p.lastYear ? arrow(p.sale - p.lastYear) + ' ' + pct(p.yoyPct) : ''}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}

/* ───────────────────────────── per-entity tables ───────────────────────────── */

function BreakdownTable({ title, rows, period, keyLabel, showRep, showSku, onPick }) {
  const [q, setQ] = useState('');
  const list = rows.filter((r) => !q.trim() || [r.key, r.jobName, r.customer, r.group].some((v) => String(v || '').toLowerCase().includes(q.trim().toLowerCase())));
  const declined = rows.filter((r) => r.declined).length;
  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>{title} — {periodLabel(period)} against {periodLabel(periodBack(period, 1))} <span className="tag tgr">{rows.length}</span></div>
        {declined > 0 && <span className="tag" style={{ background: '#fde8e8', color: 'var(--red)', fontSize: 10 }}>{declined} fell</span>}
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${title}`} style={{ marginLeft: 'auto', width: 200 }} />
      </div>
      <div className="tw sy" style={{ maxHeight: 320 }}><table>
        <thead><tr>
          <th>{keyLabel}</th>{showSku && <th>SKU / Job name</th>}{showSku && <th>Customer</th>}
          {showRep && <th>Sales rep / KAM</th>}
          <th style={{ textAlign: 'right' }}>This month</th><th style={{ textAlign: 'right' }}>Last month</th>
          <th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>%</th>
          <th style={{ textAlign: 'right' }}>Pieces</th><th style={{ textAlign: 'right' }}>Margin %</th><th style={{ textAlign: 'right' }}>Margin % last month</th>
          <th style={{ minWidth: 220 }}>Margin % trend (6 months)</th>
        </tr></thead>
        <tbody>
          {list.length === 0 ? <tr><td colSpan={12} style={{ textAlign: 'center', padding: 14, color: 'var(--i3)' }}>Nothing sold in either month for these filters</td></tr>
            : list.map((r) => (
              <tr key={r.key} style={{ cursor: onPick ? 'pointer' : undefined, background: r.declined ? '#fff5f5' : undefined }} onClick={() => onPick && onPick(r.key)}
                title={onPick ? `Filter the whole page to ${r.key}` : ''}>
                <td style={{ fontWeight: 700 }}>{r.key}</td>
                {showSku && <td style={{ fontSize: 11 }}>{r.jobName || '—'}</td>}
                {showSku && <td style={{ fontSize: 11 }}>{r.customer || '—'}</td>}
                {showRep && <td style={{ fontSize: 11 }}>{r.rep && r.rep.found && (r.rep.kam || r.rep.rep) ? [r.rep.kam, r.rep.rep].filter(Boolean).join(' · ') : <span style={{ color: 'var(--i3)' }}>—</span>}</td>}
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.sale)}</td>
                <td style={{ textAlign: 'right' }}>{money(r.before)}</td>
                <td style={{ textAlign: 'right', color: tone(r.delta) }}>{arrow(r.delta)} {money(Math.abs(r.delta))}</td>
                <td style={{ textAlign: 'right', color: tone(r.delta), fontWeight: 700 }}>{pct(r.pct)}</td>
                <td style={{ textAlign: 'right' }}>{inr(r.qty)}</td>
                <td style={{ textAlign: 'right' }}>{r.marginPct == null ? <span style={{ color: '#B7770D' }} title="No Price Master cost">—</span> : r.marginPct.toFixed(1) + '%'}</td>
                <td style={{ textAlign: 'right', color: r.marginPct != null && r.marginPctBefore != null ? tone(r.marginPct - r.marginPctBefore) : undefined }}>
                  {r.marginPctBefore == null ? '—' : r.marginPctBefore.toFixed(1) + '%'}
                  {r.marginPct != null && r.marginPctBefore != null ? ' ' + arrow(r.marginPct - r.marginPctBefore) : ''}
                </td>
                <td style={{ fontSize: 11, whiteSpace: 'nowrap' }} aria-label={`Margin trend for ${r.key}`}>
                  {(r.marginTrend || []).map((m, i, arr) => {
                    const prevM = i > 0 ? arr[i - 1].marginPct : null;
                    const col = m.marginPct == null || prevM == null ? 'var(--i2)' : tone(m.marginPct - prevM);
                    return <span key={m.period} title={m.label + (m.marginPct == null ? ': no costed sale' : ': ' + money(m.margin) + ' on ' + money(m.sale))} style={{ color: col }}>
                      {i > 0 ? ' → ' : ''}{m.label.slice(0, 3)} {m.marginPct == null ? '—' : m.marginPct.toFixed(0) + '%'}
                    </span>;
                  })}
                </td>
              </tr>
            ))}
        </tbody>
      </table></div>
    </div>
  );
}

/* ───────────────────────── SKU × month (§24-§25) ───────────────────────── */

function SkuPivotTable({ pivot, period, scope, onPick }) {
  const declined = pivot.rows.filter((r) => r.declined).length;
  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>By SKU, month by month — {scope}, last {pivot.months.length} months <span className="tag tgr">{pivot.rows.length}</span></div>
        {declined > 0 && <span className="tag" style={{ background: '#fde8e8', color: 'var(--red)', fontSize: 10 }}>{declined} fell this month</span>}
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>Base sale per specification per month. Click a row to filter the whole page (and the chart) to that SKU.</div>
      <div className="tw sy" style={{ maxHeight: 360 }}><table>
        <thead><tr>
          <th>Spec</th><th style={{ minWidth: 160 }}>SKU / Job name</th><th>Customer</th>
          {pivot.labels.map((l, i) => <th key={pivot.months[i]} style={{ textAlign: 'right', fontWeight: pivot.months[i] === period ? 800 : 600 }}>{l.replace(' 20', ' \u2019')}</th>)}
          <th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>vs last month</th>
        </tr></thead>
        <tbody>
          {pivot.rows.length === 0 ? <tr><td colSpan={pivot.months.length + 5} style={{ textAlign: 'center', padding: 14, color: 'var(--i3)' }}>No sales in this window for these filters</td></tr>
            : pivot.rows.map((r) => (
              <tr key={r.spec} style={{ cursor: 'pointer', background: r.declined ? '#fff5f5' : undefined }} onClick={() => onPick(r.spec)} title={`Filter the page to ${r.spec}`}>
                <td><span className="tag tb">{r.spec}</span></td>
                <td style={{ fontSize: 11 }}>{r.jobName || '—'}</td>
                <td style={{ fontSize: 11 }}>{r.customer || '—'}</td>
                {pivot.months.map((p) => <td key={p} style={{ textAlign: 'right', fontSize: 11, fontWeight: p === period ? 700 : 400 }} title={r.qty[p] ? inr(r.qty[p]) + ' pcs' : ''}>{r.cells[p] ? money(r.cells[p]) : <span style={{ color: 'var(--i3)' }}>·</span>}</td>)}
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.total)}</td>
                <td style={{ textAlign: 'right', color: tone(r.delta), fontWeight: 700 }}>{arrow(r.delta)} {pct(r.pct)}</td>
              </tr>
            ))}
          {pivot.rows.length > 0 && (
            <tr style={{ fontWeight: 700 }}><td colSpan={3}>All SKUs</td>
              {pivot.colTotals.map((t, i) => <td key={pivot.months[i]} style={{ textAlign: 'right', fontSize: 11 }}>{money(t)}</td>)}
              <td style={{ textAlign: 'right' }}>{money(pivot.colTotals.reduce((a, b) => a + b, 0))}</td><td></td></tr>
          )}
        </tbody>
      </table></div>
    </div>
  );
}

/* ───────────────────────────── the upload (§31-§34) ───────────────────────────── */

function UploadCard({ currentPeriod, uploads, onDone, flash }) {
  const prev = periodBack(currentPeriod, 1);
  const [year, setYear] = useState(Number(prev.slice(0, 4)));
  const [month, setMonth] = useState(Number(prev.slice(5, 7)));
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);   // { lines, errors }
  const [busy, setBusy] = useState(false);
  const period = year + '-' + String(month).padStart(2, '0');
  const years = []; for (let y = Number(currentPeriod.slice(0, 4)); y >= Number(currentPeriod.slice(0, 4)) - 6; y--) years.push(y);

  async function pick(f) {
    setFile(f || null); setParsed(null);
    if (!f) return;
    try { setParsed(parseSalesSheet(await readSheetAOA(f))); }
    catch (e) { setParsed({ lines: [], errors: ['Could not read the file: ' + (e && e.message ? e.message : e)] }); }
  }
  async function send() {
    if (!parsed || !parsed.lines.length) { flash('r', 'Pick a sheet with at least one usable row first.'); return; }
    if (period >= currentPeriod) { flash('r', `${periodLabel(period)} is the current month — it comes from the invoicing module in real time. Pick a past month.`); return; }
    const existing = uploads.find((u) => u.period === period);
    if (existing && !window.confirm(`${periodLabel(period)} already has a sheet (${existing.fileName || 'uploaded'}, ${existing.lineCount} rows). Replace it?`)) return;
    setBusy(true);
    try {
      const r = await salesHistoryApi.upload({ period, fileName: file ? file.name : '', lines: parsed.lines });
      flash('g', `${periodLabel(period)}: ${r.lines} row(s), ₹${inr(Math.round(Number(r.totalAmount) || 0))} added to the history${r.replaced ? ' (previous sheet replaced)' : ''}.`);
      setFile(null); setParsed(null);
      await onDone();
    } catch (e) { flash('r', e.message); } finally { setBusy(false); }
  }
  async function remove(u) {
    if (!window.confirm(`Remove the sheet for ${periodLabel(u.period)}? That month will read from the invoice register again.`)) return;
    try { await salesHistoryApi.deleteUpload(u.period); flash('g', `Sheet for ${periodLabel(u.period)} removed.`); await onDone(); }
    catch (e) { flash('r', e.message); }
  }
  const total = parsed ? parsed.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) : 0;

  return (
    <div className="card">
      <div className="ctitle">Upload a past month&rsquo;s sales sheet</div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Pick the month and year, then the Excel sheet. It needs a <b>Customer / Group</b> column, a <b>Spec</b> column, a <b>Quantity</b> column and a
        <b> Total sale</b> column (a GST-inclusive column is read if present, otherwise 18% is added). The rows are shown here before anything is
        saved. A month that already has a sheet is replaced; the current month is always live from invoicing and cannot be uploaded.
      </div>
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Upload month">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Upload year">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <input type="file" accept=".xlsx,.xls,.csv" aria-label="Sales sheet" onChange={(e) => pick(e.target.files && e.target.files[0])} />
        <button className="btn btn-g" onClick={send} disabled={busy || !parsed || !parsed.lines.length}>{busy ? 'Uploading…' : `⬆ Add ${periodLabel(period)} to the history`}</button>
      </div>
      {parsed && (
        <div style={{ marginTop: 6 }}>
          {parsed.errors.length > 0 && <div className="al al-y"><b>{parsed.errors.length} row(s) could not be read:</b> {parsed.errors.slice(0, 6).join(' ')}{parsed.errors.length > 6 ? ' …' : ''}</div>}
          {parsed.lines.length > 0 && (
            <>
              <div className="pg-sub" aria-label="Upload preview">{parsed.lines.length} row(s) read from row {parsed.headerRow} down — total sale ₹{inr(Math.round(total))} (₹{inr(Math.round(total * 1.18))} incl. GST where the sheet gives no figure).</div>
              <div className="tw sy" style={{ maxHeight: 200 }}><table>
                <thead><tr><th>Customer / Group</th><th>Spec</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Total sale</th><th style={{ textAlign: 'right' }}>Incl. GST</th></tr></thead>
                <tbody>{parsed.lines.slice(0, 200).map((l, i) => (
                  <tr key={i}><td>{l.customer || '—'}</td><td>{l.spec || '—'}</td><td style={{ textAlign: 'right' }}>{inr(l.qty)}</td>
                    <td style={{ textAlign: 'right' }}>{money(l.amount)}</td><td style={{ textAlign: 'right' }}>{l.amountInclGst != null ? money(l.amountInclGst) : <span style={{ color: 'var(--i3)' }}>{money(l.amount * 1.18)} (18%)</span>}</td></tr>
                ))}</tbody>
              </table></div>
            </>
          )}
        </div>
      )}
      {uploads.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="ctitle" style={{ fontSize: 11 }}>Months on file from a sheet <span className="tag tgr">{uploads.length}</span></div>
          <div className="tw"><table>
            <thead><tr><th>Month</th><th>File</th><th style={{ textAlign: 'right' }}>Rows</th><th style={{ textAlign: 'right' }}>Total sale</th><th>Uploaded</th><th style={{ width: 90 }}></th></tr></thead>
            <tbody>{uploads.map((u) => (
              <tr key={u.period}><td style={{ fontWeight: 700 }}>{periodLabel(u.period)}</td><td style={{ fontSize: 11 }}>{u.fileName || '—'}</td>
                <td style={{ textAlign: 'right' }}>{u.lineCount}</td><td style={{ textAlign: 'right' }}>{money(u.totalAmount)}</td>
                <td style={{ fontSize: 11 }}>{u.uploadedAt ? new Date(u.uploadedAt).toLocaleDateString('en-IN') : ''}{u.uploadedBy ? ' · ' + u.uploadedBy : ''}</td>
                <td><button className="btn btn-s" style={{ color: 'var(--red)', height: 24, fontSize: 11 }} onClick={() => remove(u)} aria-label={`Remove sheet for ${u.period}`}>Remove</button></td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
