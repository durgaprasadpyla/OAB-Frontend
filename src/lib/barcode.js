// BloomFlex V2 roll stickers — Code 128, code set B.
//
// Every roll's sticker carries its internal code (BLMU-n) as a barcode a USB scanner
// reads back into the Issue / Return screens. Code set B covers printable ASCII
// (space … ~), which is all an internal code ever holds.
//
// Symbol = start B (104) · one value per character (ASCII − 32) · checksum · stop (106).
// Checksum = (104 + Σ position × value) mod 103, positions counted from 1.
// Each symbol is six alternating bar/space widths (bar first) adding up to 11
// modules; the stop is seven widths adding up to 13 (it ends on a bar).

/** The standard Code 128 width table, values 0 … 106 (106 = stop). */
export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

export const START_B = 104;
export const STOP = 106;
/** Quiet zone either side, in modules (the standard asks for at least 10). */
export const QUIET = 10;

/** True when every character can be encoded in code set B (printable ASCII 32–126). */
export function isCode128B(text) {
  const s = String(text ?? '');
  if (!s) return false;
  for (const ch of s) {
    const n = ch.charCodeAt(0);
    if (n < 32 || n > 126 || ch.length !== 1) return false;
  }
  return true;
}

/** Code set B values of the data characters. Throws on anything outside printable ASCII. */
export function code128BValues(text) {
  const s = String(text ?? '');
  if (!isCode128B(s)) throw new Error('A Code 128 barcode needs printable ASCII text (letters, digits, - / . etc.).');
  return [...s].map((ch) => ch.charCodeAt(0) - 32);
}

/** The check symbol: (start + Σ position × value) mod 103. */
export function code128Checksum(values, start = START_B) {
  let sum = start;
  values.forEach((v, i) => { sum += (i + 1) * v; });
  return sum % 103;
}

/** The full symbol sequence: start B, data, checksum, stop. */
export function code128Symbols(text) {
  const values = code128BValues(text);
  return [START_B, ...values, code128Checksum(values), STOP];
}

/**
 * Bars of the symbol, in modules: [{ x, w }] for every BAR (spaces are the gaps),
 * plus the total width including both quiet zones.
 */
export function code128Bars(text) {
  const bars = [];
  let x = QUIET;
  for (const sym of code128Symbols(text)) {
    const pat = CODE128_PATTERNS[sym];
    for (let i = 0; i < pat.length; i++) {
      const w = Number(pat[i]);
      if (i % 2 === 0) bars.push({ x, w });
      x += w;
    }
  }
  return { bars, width: x + QUIET };
}

/** Standalone SVG markup for the barcode (black bars on white), height in modules. */
export function code128Svg(text, { height = 50 } = {}) {
  const { bars, width } = code128Bars(text);
  const rects = bars.map((b) => `<rect x="${b.x}" y="0" width="${b.w}" height="${height}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`
    + `<rect width="${width}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
