import { memo, useCallback, useMemo, useRef, useState } from 'react';

// Stores → Issues & Returns → "Recent issues & returns" (Issues 30.09, S4–S6).
//
//   S4 (red, reported before): "a 'Close to Return' button at the top and CHECKBOXES
//      against each issue line item. Multiple can be selected and marked 'Close to
//      Return'. These issue slips will not be visible in the returns dropdown." The
//      24.09 close button sat behind that very dropdown — the desk had to find a line
//      in the huge list before it could take the line off it, one at a time.
//   S5  filters on top, in the doc's order: date, item code, material type, sub group,
//      speciality, item description, department, sale order — with Close to Return
//      next to them.
//   S6  material type, sub group, speciality and item description as columns; no date
//      column (the date filter does that job) and no "By" column ("all issues are by
//      stores"); every slip shown by default, not the newest 60.
//
// IssuesReturns owns the data (the ledger, the Item Master, the reprint and the close
// call); this table owns only what is ticked and what is filtered.

/** How many ledger rows the desk loads — "by default all slips are shown". */
export const HISTORY_LIMIT = 5000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const qty = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const norm = (v) => String(v ?? '').trim().toLowerCase();
const blank = (v) => !String(v ?? '').trim();

/**
 * The row's day on the desk's own calendar. `ts` is a UTC instant: an issue at 00:30
 * IST carries the previous day's UTC date, and slicing the string would file it there.
 */
export function localDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// After the date, the dropdown filters in the order the client listed them.
const FILTERS = [
  { k: 'itemCode', label: 'item code', all: 'All item codes' },
  { k: 'materialType', label: 'material type', all: 'All material types' },
  { k: 'subGroup', label: 'sub group', all: 'All sub groups' },
  { k: 'specialtyName', label: 'speciality', all: 'All specialities' },
  { k: 'itemName', label: 'item description', all: 'All item descriptions' },
  { k: 'department', label: 'department', all: 'All departments' },
  { k: 'so', label: 'sale order', all: 'All sale orders' },
];
const NO_FILTERS = { day: '', ...Object.fromEntries(FILTERS.map((x) => [x.k, ''])) };

/** Does a row pass every filter but `skip` (the one whose options are being built)? */
function passes(r, f, skip) {
  if (skip !== 'day' && f.day && r.day !== f.day) return false;
  return FILTERS.every(({ k }) => k === skip || !f[k] || norm(r[k]) === norm(f[k]));
}

/**
 * One ledger row. `mark` is what the first cell shows: 'open' (a box to tick),
 * 'closed', 'back' (everything came back) or null (a return). Memoised: the history
 * can run to thousands of rows, and ticking one box must not redraw all of them —
 * so the two callbacks it gets are stable.
 */
const HistoryRow = memo(function HistoryRow({ t, mark, checked, onToggle, onReprint }) {
  const issue = t.kind === 'ISSUE';
  const no = issue ? t.slipNo : t.returnNo;
  const lineNo = issue ? (t.lineNo || t.slipNo) : t.returnNo;
  return (
    <tr style={mark === 'closed' ? { color: 'var(--i3)' } : undefined}>
      <td>
        {mark === 'open' && (
          <input type="checkbox" className="cb" checked={checked} onChange={(e) => onToggle(t.id, e.target.checked)}
            aria-label={`Select ${lineNo || '#' + t.id} for Close to Return`} />
        )}
        {mark === 'closed' && (
          <span className="tag tgr" style={{ fontSize: 9 }}
            title={t.closedAt ? `Closed by ${t.closedBy || 'stores'} on ${localDay(t.closedAt)}` : 'Closed — off the returns dropdown'}>Closed</span>
        )}
        {mark === 'back' && <span className="tag tg" style={{ fontSize: 9 }} title="Everything issued on this line has come back">Returned</span>}
      </td>
      <td><span className={'tag ' + (issue ? 'ty' : 'tg')} style={{ fontSize: 9 }}>{issue ? 'Issue' : 'Return'}</span></td>
      <td style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap' }} title={t.day ? `${issue ? 'Issued' : 'Returned'} on ${t.day}` : undefined}>
        {lineNo || '—'}
      </td>
      <td>
        {no ? (
          <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }} onClick={() => onReprint(no)}
            title={issue ? 'Download this issue slip as PDF' : 'Download this return slip as PDF'} aria-label={`Download slip ${no}`}>⬇ Download as PDF</button>
        ) : <span style={{ color: 'var(--i3)', fontSize: 10 }}>no slip</span>}
      </td>
      <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{t.itemCode || '—'}</td>
      <td style={{ fontSize: 11 }}>{t.materialType || '—'}</td>
      <td style={{ fontSize: 11 }}>{t.subGroup || '—'}</td>
      <td style={{ fontSize: 11 }}>{t.specialtyName || '—'}</td>
      <td style={{ fontSize: 11 }}>{t.itemName || '—'}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{t.internalCode || '—'}</td>
      <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {qty(t.qty)}{t.uom ? <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--i3)' }}> {t.uom}</span> : null}
      </td>
      <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{t.so || '—'}</td>
      <td style={{ fontSize: 11 }}>{t.department || '—'}</td>
    </tr>
  );
});

/**
 * @param txns          the ledger rows (GET /api/stores/txns), newest first
 * @param masterItems   the Item Master — identity for rows a backend before 30.09
 *                      sends with only the code and the name
 * @param onReprint     (slipOrReturnNo) => download that slip again
 * @param onCloseLines  async (rows) => the ids it closed (or null when nothing was):
 *                      confirms, calls the server and reloads — see IssuesReturns
 *
 * Memoised (review H2): it sits under the issue / return form, and every keystroke
 * there re-rendered up to HISTORY_LIMIT rows and rebuilt seven option lists. Both
 * callbacks are read through refs, so a parent handing in fresh functions does not
 * defeat the memo; the option lists are recomputed only when the rows or filters do.
 */
function StoresIssueHistory({ txns, masterItems, onReprint, onCloseLines }) {
  const [f, setF] = useState(NO_FILTERS);
  const [sel, setSel] = useState(() => new Set());
  // Lines closed from here this session: shown closed even when the ledger row comes
  // from a backend that does not report closedAt yet.
  const [closedHere, setClosedHere] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => (Array.isArray(txns) ? txns : []), [txns]);

  const master = useMemo(() => {
    const m = new Map();
    (masterItems || []).forEach((it) => { const c = norm(it && it.code); if (c && !m.has(c)) m.set(c, it); });
    return m;
  }, [masterItems]);

  // what has come back against each issue line, from the RETURN rows that name it —
  // for a row that does not carry qtyReturned itself
  const backOf = useMemo(() => {
    const m = new Map();
    list.forEach((t) => {
      if (t.kind === 'RETURN' && t.issueTxnId != null) m.set(String(t.issueTxnId), (m.get(String(t.issueTxnId)) || 0) + num(t.qty));
    });
    return m;
  }, [list]);

  const rows = useMemo(() => list.map((t) => {
    const m = master.get(norm(t.itemCode)) || {};
    const or = (a, b) => (blank(a) ? (b ?? '') : a);
    return {
      ...t,
      materialType: or(t.materialType, m.materialType),
      subGroup: or(t.subGroup, m.subGroup),
      specialtyName: or(t.specialtyName, m.specialtyName ?? m.specialty),
      itemName: or(t.itemName, m.name),
      day: localDay(t.ts),
      returned: t.qtyReturned != null ? num(t.qtyReturned) : (backOf.get(String(t.id)) || 0),
    };
  }), [list, master, backOf]);

  /** What the first cell of a row shows — see HistoryRow. */
  const markOf = useCallback((r) => {
    if (r.kind !== 'ISSUE') return null;
    if (r.closedAt || closedHere.has(String(r.id))) return 'closed';
    if (num(r.qty) > 0 && r.returned >= num(r.qty) - 1e-9) return 'back';
    return 'open';
  }, [closedHere]);

  /** Each dropdown offers only what the other filters leave, plus its own choice. */
  const options = useMemo(() => {
    const out = {};
    FILTERS.forEach(({ k }) => {
      const seen = new Map();
      rows.forEach((r) => {
        const v = String(r[k] ?? '').trim();
        if (v && !seen.has(norm(v)) && passes(r, f, k)) seen.set(norm(v), v);
      });
      if (f[k] && !seen.has(norm(f[k]))) seen.set(norm(f[k]), f[k]);
      out[k] = [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    });
    return out;
  }, [rows, f]);
  const visible = useMemo(() => rows.filter((r) => passes(r, f)), [rows, f]);
  const filtered = Object.values(f).some(Boolean);

  // Close to Return acts on what is ticked AND still on screen — a tick hidden by a
  // filter is not something the desk is looking at when it presses the button.
  const shownClosable = useMemo(() => visible.filter((r) => markOf(r) === 'open'), [visible, markOf]);
  const picked = useMemo(() => shownClosable.filter((r) => sel.has(r.id)), [shownClosable, sel]);
  const allPicked = shownClosable.length > 0 && picked.length === shownClosable.length;

  const setFilter = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggle = useCallback((id, on) => setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }), []);
  const toggleAll = (on) => setSel((s) => {
    const n = new Set(s);
    shownClosable.forEach((r) => (on ? n.add(r.id) : n.delete(r.id)));
    return n;
  });
  // the parent's callbacks may be new functions every render; read them through refs
  // so the rows (and this component's memo) get stable ones
  const reprintRef = useRef(onReprint);
  reprintRef.current = onReprint;
  const reprint = useCallback((no) => { if (reprintRef.current) reprintRef.current(no); }, []);
  const closeLinesRef = useRef(onCloseLines);
  closeLinesRef.current = onCloseLines;

  async function closeToReturn() {
    const onClose = closeLinesRef.current;
    if (!picked.length || !onClose) return;
    setBusy(true);
    try {
      const done = await onClose(picked);
      if (Array.isArray(done) && done.length) {
        setClosedHere((s) => new Set([...s, ...done.map(String)]));
        const gone = new Set(done.map(String));
        setSel((s) => new Set([...s].filter((id) => !gone.has(String(id)))));
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="ctitle">
        Recent issues &amp; returns{' '}
        <span className="tag tgr">{filtered ? `${visible.length} of ${rows.length}` : rows.length}</span>
      </div>
      <div className="fbar" style={{ flexWrap: 'wrap', marginBottom: 6 }}>
        <input type="date" value={f.day} onChange={(e) => setFilter('day', e.target.value)} aria-label="Filter history by date"
          title="Only what was issued or returned on this day" />
        {FILTERS.map(({ k, label, all }) => (
          <select key={k} value={f[k]} onChange={(e) => setFilter(k, e.target.value)} aria-label={`Filter history by ${label}`}>
            <option value="">{all}</option>
            {options[k].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        <button className="btn btn-s" onClick={() => setF(NO_FILTERS)} disabled={!filtered} aria-label="Clear history filters">✕ Clear</button>
        <div className="fbar-actions">
          <button className="btn btn-g" onClick={closeToReturn} disabled={!picked.length || busy} aria-label="Close to Return"
            title={picked.length ? 'Mark the ticked issue lines as consumed — they leave the returns dropdown' : 'Tick the issue lines whose material is not coming back'}>
            {busy ? 'Closing…' : `✔ Close to Return${picked.length ? ` (${picked.length})` : ''}`}
          </button>
        </div>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Tick the issue lines whose material was used up and press <b>Close to Return</b> — they are no longer offered in the
        returns dropdown. Nothing about the stock moves.
        {list.length >= HISTORY_LIMIT && <> Showing the latest {HISTORY_LIMIT.toLocaleString('en-IN')} entries.</>}
      </div>
      <div className="tw sy" style={{ maxHeight: 'max(320px, calc(100vh - 300px))' }}><table>
        <thead><tr>
          <th style={{ width: 30 }}>
            <input type="checkbox" className="cb" checked={allPicked} disabled={!shownClosable.length}
              ref={(el) => { if (el) el.indeterminate = picked.length > 0 && !allPicked; }}
              onChange={(e) => toggleAll(e.target.checked)} aria-label="Select every open issue line shown" />
          </th>
          <th>Kind</th><th>Slip / line no.</th><th>Download</th><th>Item code</th>
          <th>Material type</th><th>Sub group</th><th>Speciality</th><th>Item description</th>
          <th>Roll</th><th style={{ textAlign: 'right' }}>Qty</th><th>Sale order</th><th>Department</th>
        </tr></thead>
        <tbody>
          {visible.length === 0 ? (
            <tr><td colSpan={13} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>
              {rows.length ? 'Nothing issued or returned matches these filters' : 'Nothing issued yet'}
            </td></tr>
          ) : visible.map((t) => (
            <HistoryRow key={t.id} t={t} mark={markOf(t)} checked={sel.has(t.id)} onToggle={toggle} onReprint={reprint} />
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export default memo(StoresIssueHistory);
