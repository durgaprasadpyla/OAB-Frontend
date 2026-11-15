// "Same issue repeated — 1 number is decreasing in the tool" (invoice 20,400 → 20,399).
//
// A browser number box steps its value by 1 when the mouse wheel turns over it while
// it has the cursor. Someone types 20400 in Invoice Qty, scrolls down to the next
// line, and the box quietly becomes 20399 — the saved invoice and its PDF carry that
// figure. The `nospin` class only hides the arrows; it does not stop the wheel.
//
// One rule for every number box in the app: a wheel turn over the box being edited
// takes the cursor out of it, so the turn scrolls the page and the typed figure stays.
// (Blurring inside the wheel listener runs before the browser's default stepping.)

export function guardNumberWheel(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return () => {};
  const onWheel = (e) => {
    const el = doc.activeElement;
    if (el && el.tagName === 'INPUT' && el.type === 'number' && (e.target === el || el.contains(e.target))) el.blur();
  };
  doc.addEventListener('wheel', onWheel, { passive: true, capture: true });
  return () => doc.removeEventListener('wheel', onWheel, { capture: true });
}
