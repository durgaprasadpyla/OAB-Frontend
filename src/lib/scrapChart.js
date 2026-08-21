// Price-trend geometry — a small multi-series line chart over dated rate points.
//
// Used twice: scrap BUYING prices (who pays us most for an item) and purchase
// SUPPLIER prices (what we pay for an item). Both are the same shape — dated
// {date, series-key, item, rate} rows — so they share one builder.
// Port of the legacy scrapAdminChart (index.html): it takes the posted price
// points and turns them into plotted series, so the component only renders SVG.
//
// Series grouping mirrors the legacy rule exactly:
//   • an item is chosen (with or without a buyer) → one series per BUYER
//     ("who pays best for this item?")
//   • only a buyer is chosen                      → one series per ITEM
//     ("what does this buyer pay across items?")
// At most 6 series are plotted; `truncated` tells the UI to say so rather than
// silently dropping the rest.

import { fmtDate } from './format.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''));

export const CHART_PALETTE = ['#2f6fd0', '#1f9c78', '#e0a13f', '#c0392b', '#7d4fd0', '#5f6b7a'];
export const MAX_SERIES = 6;
export const CHART_BOX = { W: 580, H: 230, mL: 48, mR: 12, mT: 14, mB: 34 };

/** Best (highest) rate per item among the given price rows, with who offered it. */
export function bestByItem(rows) {
  const best = {};
  (rows || []).forEach((p) => {
    const rate = n(p.rate);
    if (!best[p.item] || rate > best[p.item].rate) best[p.item] = { rate, buyer: p.buyer };
  });
  return best;
}

/**
 * Build everything the chart needs: series (name, colour, points), the axis
 * scales, and the tick values. Returns `null` when there is nothing to plot.
 *
 * `rows` are scrap price records {date, buyer, item, rate}. `buyerFil`/`itemFil`
 * are the active filters. `labelOf` maps a series key to its display name (used
 * to turn a buyer id into a buyer name).
 */
export function buildScrapChart(rows, { buyerFil = '', itemFil = '', labelOf = (k) => k, seriesKey = 'buyer' } = {}) {
  let recs = (rows || []).filter((r) => r && r.date).map((r) => (seriesKey === 'buyer' ? r : { ...r, buyer: r[seriesKey] }));
  if (buyerFil) recs = recs.filter((r) => r.buyer === buyerFil);
  if (itemFil) recs = recs.filter((r) => r.item === itemFil);
  if (!recs.length) return null;
  recs = recs.slice().sort(byDate);

  // Buyer chosen but no item → the interesting axis is which ITEM, not who.
  const perItem = !itemFil && !!buyerFil;

  const groups = {};
  recs.forEach((r) => { const k = perItem ? r.item : r.buyer; (groups[k] = groups[k] || []).push(r); });
  const allKeys = Object.keys(groups).sort((a, b) => String(a).localeCompare(String(b)));
  const keys = allKeys.slice(0, MAX_SERIES);

  const dates = [...new Set(recs.map((r) => r.date))].sort();
  const rates = recs.map((r) => n(r.rate));
  const minR = Math.min(...rates);
  const maxR = Math.max(...rates);
  // Pad the band so a flat series isn't drawn on the axis line itself.
  const pad = (maxR - minR) * 0.15 || Math.max(1, maxR * 0.1);
  const yMin = Math.max(0, minR - pad);
  const yMax = maxR + pad;

  const { W, H, mL, mR, mT, mB } = CHART_BOX;
  const plotW = W - mL - mR;
  const plotH = H - mT - mB;
  const xOf = (d) => (dates.length < 2 ? mL + plotW / 2 : mL + (dates.indexOf(d) / (dates.length - 1)) * plotW);
  const yOf = (v) => mT + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const series = keys.map((key, i) => {
    // Per-item mode keys by item (already a display name); otherwise by buyer id,
    // which has to be resolved to the buyer's name. Legend and tooltip agree.
    const label = perItem ? key : labelOf(key);
    const pts = groups[key].slice().sort(byDate).map((r) => ({
      x: xOf(r.date), y: yOf(n(r.rate)), rate: n(r.rate), date: r.date,
      tip: `${label} — ₹${n(r.rate).toFixed(2)} on ${fmtDate(r.date)}`,
    }));
    return {
      key,
      label,
      color: CHART_PALETTE[i % CHART_PALETTE.length],
      points: pts,
      path: pts.map((p, j) => `${j ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
    };
  });

  // Four horizontal gridlines, labelled 1.2k-style once they get large.
  const yTicks = [0, 1, 2, 3].map((g) => {
    const v = yMin + ((yMax - yMin) * g) / 3;
    return { v, y: yOf(v), label: v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(v >= 100 ? 0 : 1) };
  });
  const xTicks = [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])]
    .map((i) => dates[i]).filter(Boolean)
    .map((d) => ({ d, x: xOf(d) }));

  return { series, yTicks, xTicks, truncated: allKeys.length > MAX_SERIES, perItem };
}

/** Heading above the chart, matching the legacy wording. */
export function scrapChartTitle({ buyerFil = '', itemFil = '', labelOf = (k) => k } = {}) {
  if (itemFil) return 'Price trend — ' + itemFil;
  if (buyerFil) return 'Items from ' + labelOf(buyerFil);
  return 'Scrap price trend — all buyers';
}
