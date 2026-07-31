// Thin wrappers over the SheetJS global (loaded via CDN in index.html), so the
// export/import behaviour matches the legacy app.

function X() {
  if (!window.XLSX) throw new Error('SheetJS (xlsx) is not loaded');
  return window.XLSX;
}

// Neutralize spreadsheet formula injection: a cell starting with = + - @ (or a
// leading control char) is prefixed with ' so Excel/Sheets treats it as text.
function sanitizeCell(v) {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}
function sanitizeRows(rows) {
  return (rows || []).map((row) => (Array.isArray(row) ? row.map(sanitizeCell) : row));
}

/** Download an array-of-arrays as an .xlsx file. */
export function exportAOA(rows, filename, sheetName = 'Sheet1') {
  const x = X();
  const ws = x.utils.aoa_to_sheet(sanitizeRows(rows));
  const wb = x.utils.book_new();
  x.utils.book_append_sheet(wb, ws, sheetName);
  x.writeFile(wb, filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
}

/** Download array-of-objects using explicit columns [{key,label}]. */
export function exportObjects(items, columns, filename, sheetName = 'Sheet1') {
  const header = columns.map((c) => c.label);
  const body = (items || []).map((it) => columns.map((c) => (it[c.key] ?? '')));
  exportAOA([header, ...body], filename, sheetName);
}

/** Read the first sheet of an uploaded File into an array of row objects. */
export async function readSheet(file) {
  const x = X();
  const buf = await file.arrayBuffer();
  const wb = x.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return x.utils.sheet_to_json(ws, { defval: '' });
}

/** Read the first sheet as an array-of-arrays (header:1) for positional parsing. */
export async function readSheetAOA(file) {
  const x = X();
  const buf = await file.arrayBuffer();
  const wb = x.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return x.utils.sheet_to_json(ws, { header: 1, defval: '' });
}
