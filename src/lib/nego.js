// Price negotiation threads between a sales rep and the Quotation Desk.
//
// One thread per SKU, stored flat in `nego_msgs` on the sales blob:
//   { id, sku_id, lead_id, from: 'rep'|'quote', text, at, seen_by_rep, seen_by_quote }
//
// Read state is tracked per SIDE rather than per message-reader, because the
// desk is a shared inbox — whoever opens it clears it for the desk, and the rep
// side is cleared independently.
//
// Ported from qtNego* / repNego*.

import { salesUid } from './sales.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const byTime = (a, b) => String(a.at || '').localeCompare(String(b.at || ''));

/** One SKU's thread, oldest first. (repNegoThread) */
export function negoThread(sales, skuId) {
  return arr(sales && sales.nego_msgs).filter((m) => m.sku_id === skuId).sort(byTime);
}

/** Unread count for one side of one thread. (repNegoUnread) */
export function negoUnread(sales, skuId, side) {
  const from = side === 'rep' ? 'quote' : 'rep';
  const seen = side === 'rep' ? 'seen_by_rep' : 'seen_by_quote';
  return negoThread(sales, skuId).filter((m) => m.from === from && !m[seen]).length;
}

/**
 * Threads grouped by SKU, most recently active first, each with its unread
 * count for the given side. (qtNegoGroups)
 */
export function negoGroups(sales, side = 'quote') {
  const by = {};
  arr(sales && sales.nego_msgs).forEach((m) => {
    if (!by[m.sku_id]) by[m.sku_id] = { sku_id: m.sku_id, lead_id: m.lead_id, msgs: [] };
    by[m.sku_id].msgs.push(m);
  });
  return Object.values(by).map((g) => {
    g.msgs.sort(byTime);
    g.last = g.msgs[g.msgs.length - 1];
    g.unread = negoUnread(sales, g.sku_id, side);
    return g;
  }).sort((a, b) => String((b.last && b.last.at) || '').localeCompare(String((a.last && a.last.at) || '')));
}

/** Total unread across every thread, for the nav badge. (qtNegoUnreadTotal) */
export function negoUnreadTotal(sales, side = 'quote') {
  return negoGroups(sales, side).reduce((n, g) => n + g.unread, 0);
}

/**
 * Append a message. Returns a NEW nego_msgs array.
 * The sender's own side is marked seen immediately — you have read what you
 * just wrote, and leaving it unread would make your own message badge at you.
 */
export function negoPost(sales, { skuId, leadId, from, text }, { now = new Date(), uid = salesUid } = {}) {
  const body = String(text == null ? '' : text).trim();
  if (!body) throw new Error('Type a message first.');
  if (!skuId) throw new Error('No SKU selected.');
  return [...arr(sales && sales.nego_msgs), {
    id: uid('nego'),
    sku_id: skuId,
    lead_id: leadId || null,
    from,
    text: body,
    at: now.toISOString(),
    seen_by_rep: from === 'rep',
    seen_by_quote: from === 'quote',
  }];
}

/**
 * Mark a side's incoming messages read. Pass a `skuId` for one thread, or omit
 * it to clear everything (what opening the desk inbox does).
 * Returns a NEW array, or the original when nothing changed — so callers can
 * skip a pointless write.
 */
export function negoMarkSeen(sales, side, skuId = null) {
  const from = side === 'rep' ? 'quote' : 'rep';
  const seen = side === 'rep' ? 'seen_by_rep' : 'seen_by_quote';
  const msgs = arr(sales && sales.nego_msgs);
  let changed = false;
  const next = msgs.map((m) => {
    if ((skuId && m.sku_id !== skuId) || m.from !== from || m[seen]) return m;
    changed = true;
    return { ...m, [seen]: true };
  });
  return changed ? next : msgs;
}
