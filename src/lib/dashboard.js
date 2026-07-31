// Dashboard analytics, ported from renderDashboard (legacy 3942) and its helpers.
// All figures use the *current* Price Master + RM rates, exactly as the legacy
// dashboard recomputed them on each render.
import { balance, num } from './calc.js';
import { getPM, getCostPrice } from './pricing.js';

const sum = (arr, k) => (arr || []).reduce((s, x) => s + (Number(x[k]) || 0), 0);

/** Date window for the dashboard filter. */
export function dashRange(filter, customFrom, customTo) {
  const now = new Date();
  const iso = (d) => { const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  if (filter === 'day') { const t = iso(now); return { from: t, to: t }; }
  if (filter === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  if (filter === 'last_month') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  return { from: customFrom || iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: customTo || iso(now) };
}

/**
 * Manual-dispatch log entries in a window, shaped like pseudo-invoices priced at
 * the current sale rate, so they fold into Sales / Sale Margin. (getManualDispatchEntries 4448)
 */
export function manualDispatchEntries(oab, from, to, client, ctx) {
  const out = [];
  ['SF', 'OT'].forEach((key) => {
    ((oab && oab.OAB && oab.OAB[key]) || []).forEach((r) => {
      if (client && r.customer !== client) return;
      (r.manDispLog || []).forEach((entry) => {
        if (from && entry.date < from) return;
        if (to && entry.date > to) return;
        const rate = getPM(r.spec, ctx.prices).price || 0;
        const cost = getCostPrice(r.spec, ctx) || 0;
        const qty = num(entry.qty);
        out.push({ no: entry.invNo || '(Manual)', date: entry.date, po: r.poNum || '', customer: r.customer || '', spec: r.spec || '', jobName: r.jobName || '', qty, rate, amount: rate * qty, _dynMargin: (rate - cost) * qty, isManual: true });
      });
    });
  });
  return out;
}

/** All dashboard KPIs + the row sets behind them. (renderDashboard 3963–4021) */
export function computeKPIs(oab, { from, to, client }, ctx) {
  const INV_REG = (oab && oab.INV_REG) || [];
  const allRows = ['SF', 'OT'].flatMap((k) => (oab && oab.OAB && oab.OAB[k]) || []);
  const inRange = (d) => !!d && d >= from && d <= to;
  const price = (r) => getPM(r.spec, ctx.prices).price || 0;

  const periodInv = INV_REG.filter((inv) => inRange(inv.date) && (!client || inv.customer === client)).map((inv) => ({
    ...inv,
    _dynMargin: (inv.items && inv.items.length)
      ? inv.items.reduce((s, it) => s + ((it.rate || 0) - getCostPrice(it.spec, ctx)) * it.qty, 0)
      : (inv.margin || 0),
  }));
  const periodManual = manualDispatchEntries(oab, from, to, client, ctx);

  const salesTotal = sum(periodInv, 'amount') + sum(periodManual, 'amount');
  const salesQty = sum(periodInv, 'qty') + sum(periodManual, 'qty');
  const totalMargin = sum(periodInv, '_dynMargin') + sum(periodManual, '_dynMargin');

  const openRows = allRows.filter((r) => !r.closed && balance(r) > 0 && (!client || r.customer === client));
  const openValue = openRows.reduce((s, r) => s + balance(r) * price(r), 0);
  const cfRows = openRows.filter((r) => r.poDate && r.poDate < from);
  const cfValue = cfRows.reduce((s, r) => s + balance(r) * price(r), 0);
  const shortClosed = allRows.filter((r) => r.shortClosed && r.closedDate && inRange(r.closedDate) && (!client || r.customer === client));
  const shortValue = shortClosed.reduce((s, r) => s + (num(r.poQty) - num(r.invDisp) - num(r.manDisp)) * price(r), 0);

  const soMarginRows = allRows.filter((r) => !r.closed && num(r.poQty) > 0 && (!client || r.customer === client));
  let soMarginTotal = 0, soMarginSOCount = 0, denom = 0;
  soMarginRows.forEach((r) => {
    const sp = price(r), cp = getCostPrice(r.spec, ctx) || 0;
    denom += sp * num(r.poQty);
    if (sp > 0 && cp > 0) { soMarginTotal += (sp - cp) * num(r.poQty); soMarginSOCount++; }
  });
  const soMarginPct = soMarginRows.length ? (soMarginTotal / (denom || 1)) * 100 : 0;

  return { periodInv, periodManual, salesTotal, salesQty, totalMargin, openRows, openValue, cfRows, cfValue, shortClosed, shortValue, soMarginTotal, soMarginSOCount, soMarginPct };
}
