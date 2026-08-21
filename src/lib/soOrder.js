// Sale-order display order — newest first (Last In, First Display) or oldest first.
//
// In the monolith this is the module-level `soNewestFirst` flag that the OAB board,
// Daily Update and the Plant board all read, flipped by one shared "⬇ Newest first"
// button (soOrder / toggleSOOrder / updateSOOrderButtons). It is deliberately session
// state, not a saved preference: it resets to newest-first on reload, as it does there.
import { useSyncExternalStore } from 'react';

let newestFirst = true;
const listeners = new Set();

/** Numeric sort key from an SO number like "26/541". (soSortKey) */
export function soSortKey(r) {
  const m = String((r && r.so) || '').match(/(\d+)\s*\/\s*(\d+)/);
  return m ? (parseInt(m[1], 10) * 1000000 + parseInt(m[2], 10)) : 0;
}

/** Order rows by SO number, honouring the current direction. (soOrder) */
export function soOrder(rows, newest = newestFirst) {
  const a = (rows || []).slice().sort((x, y) => soSortKey(x) - soSortKey(y));
  return newest ? a.reverse() : a;
}

export function toggleSoOrder() {
  newestFirst = !newestFirst;
  listeners.forEach((fn) => fn());
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** `[newestFirst, toggle, buttonLabel, buttonTitle]` for the shared sort button. */
export function useSoOrder() {
  const newest = useSyncExternalStore(subscribe, () => newestFirst, () => true);
  return {
    newestFirst: newest,
    toggle: toggleSoOrder,
    label: newest ? '⬇ Newest first' : '⬆ Oldest first',
    title: newest
      ? 'Showing newest sale orders first (Last In, First Display). Click to show oldest first.'
      : 'Showing oldest sale orders first (First In, First Display). Click to show newest first.',
  };
}
