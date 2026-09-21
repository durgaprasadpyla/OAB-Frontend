// The MATERIAL a JSS is made of, read the same way everywhere.
//
// The JSS Material box was free text, so one structure came to be spelt many ways —
// "CC PET + LDPE", "cc pet +LDPE", "CC PET+ LDPE" — and every screen that grouped
// by material (Trends & Forecast above all) counted each spelling as a different
// film. Two things fix that for good:
//
//   · every comparison goes through `materialKey`, which ignores case, spacing and
//     punctuation, so the spellings that already exist fall together;
//   · the JSS editors offer the materials ALREADY IN USE as a picker (plus "add a
//     new one"), so a new spec picks a spelling instead of inventing one.

const s = (v) => String(v == null ? '' : v).trim();

/** The identity of a material: letters, digits and the layer separators only. */
export function materialKey(v) {
  return s(v).toUpperCase().replace(/[^A-Z0-9+/]/g, '');
}

/**
 * The tidy spelling of a material: upper-case, one space between words, the
 * layers separated by " + " (or " / ") — "cc pet +LDPE" → "CC PET + LDPE".
 */
export function materialLabel(v) {
  return s(v)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s*\/\s*/g, ' / ')
    .trim();
}

/**
 * The distinct materials the JSS master uses, one per identity, in their tidy
 * spelling and sorted. This is what the JSS Material picker offers.
 */
export function knownMaterials(jss, extra = []) {
  const seen = new Map();
  [...(jss || []).map((j) => j && j.material), ...(extra || [])].forEach((m) => {
    const k = materialKey(m);
    if (k && !seen.has(k)) seen.set(k, materialLabel(m));
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
