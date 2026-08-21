// Field-aware 3-way merge for module 1 (OAB board + invoice register).
//
// Port of OAB-App's integration-sync.js — the safety layer that exists because
// of a real incident:
//
//   Between the 2026-08-15 and 2026-08-16 backups, one stale-tab save reverted
//   27 rows — FG allocations zeroed on 26/541-543, manDisp/invDisp rolled back,
//   5 short-closed SOs reopened, manDispLog/price/closed deleted outright,
//   26 invoices dropped from INV_REG (75 -> 49), lastSO rewound 604 -> 553.
//
// WHY OPTIMISTIC LOCKING IS NOT ENOUGH
// Every module-1 save posts this tab's ENTIRE in-memory blob. A version check
// only refuses a save when the server has moved on; it says nothing about
// whether the fields inside a same-version blob are stale. A tab that loaded
// hours ago, then saves one unrelated field, ships its stale copy of every other
// row over the top of newer work — and the version matches, so the write is
// accepted.
//
// THE MERGE
//   base   = module 1 as this tab last SYNCED it (load, or our own last save)
//   mine   = this tab's in-memory state
//   theirs = the server's current state, fetched immediately before the save
//
//   - a field this tab did NOT change  -> keep THEIRS   (this is the whole fix)
//   - a field this tab DID change      -> keep MINE
//   - fg / invDisp / manDisp           -> THEIRS + (MINE - BASE): both sides'
//                                         additions survive a concurrent edit
//   - manDispLog                       -> union, never truncated
//   - a key in THEIRS but absent from MINE -> kept, never deleted
//   - rows / invoices on one side only -> kept (superset)
//   - lastSO / lastInvNo               -> max; counters never run backwards
//
// With no baseline (a save before the first load completes) it degrades to
// add-only for scalars and max() for cumulative fields — never below what
// either side holds. It can therefore lose nothing the unmerged save would keep.

const eq = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; } };
const num = (v) => { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; };
const rowsOf = (c, k) => (Array.isArray(c && c[k]) ? c[k] : []);

/** Fields that accumulate — merged as deltas so simultaneous additions both win. */
export const CUMULATIVE = ['fg', 'invDisp', 'manDisp'];
/** Append-only history arrays — merged as a union so neither side truncates. */
export const APPEND_ARRAYS = ['manDispLog'];

/**
 * Snapshot the OAB rows of a module-1 blob as a baseline, keyed by SO.
 * Only the board is snapshotted: INV_REG carries invoice HTML (megabytes) and is
 * merged by union, which needs no baseline.
 */
export function snapshotBase(oabModule) {
  const snap = { SF: {}, OT: {} };
  ['SF', 'OT'].forEach((k) => {
    rowsOf(oabModule && oabModule.OAB, k).forEach((r) => {
      if (r && r.so) snap[k][r.so] = JSON.parse(JSON.stringify(r));
    });
  });
  return snap;
}

/** Merge one row. `b` is its baseline (may be undefined). */
export function mergeRow(b, mine, theirs, note) {
  const out = { ...theirs };

  Object.keys(mine).forEach((k) => {
    if (CUMULATIVE.includes(k) || APPEND_ARRAYS.includes(k)) return;   // handled below
    if (!b) { out[k] = mine[k]; return; }                              // no baseline -> old behaviour
    if (!eq(mine[k], b[k])) {                                          // this tab edited it -> mine wins
      out[k] = mine[k];
      if (note) note.push(k);
    }
    // untouched by this tab -> keep theirs. THIS is what stops the silent revert.
  });
  // Keys in `theirs` but missing from `mine` are deliberately left intact — an
  // older row must never delete a newer field. That is how manDispLog, price and
  // closed were lost on 2026-08-16.

  CUMULATIVE.forEach((f) => {
    const t = num(theirs[f]);
    const m = num(mine[f]);
    if (!b) { out[f] = Math.max(t, m); return; }    // unknown lineage -> never decrease
    const v = t + (m - num(b[f]));                  // apply only OUR delta to their value
    out[f] = v < 0 ? 0 : v;
    if (note && v !== t) note.push(f);
  });

  APPEND_ARRAYS.forEach((f) => {
    const ta = Array.isArray(theirs[f]) ? theirs[f] : [];
    const ma = Array.isArray(mine[f]) ? mine[f] : [];
    if (!ta.length && !ma.length && !(f in out)) return;
    const seen = new Set();
    const merged = [];
    ta.concat(ma).forEach((e) => {
      let key; try { key = JSON.stringify(e); } catch { key = String(e); }
      if (!seen.has(key)) { seen.add(key); merged.push(e); }
    });
    if (merged.length) out[f] = merged;
  });

  return out;
}

/** Higher of two SO counters — year first, then number. Never runs backwards. */
export function maxLastSO(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ay = String(a.y || '');
  const by = String(b.y || '');
  if (ay !== by) return ay > by ? a : b;
  return num(a.n) >= num(b.n) ? a : b;
}

/**
 * Merge this tab's module-1 blob against the server's current copy.
 * Returns { merged, stats }. Pure — neither input is mutated.
 *
 * @param base    snapshot from the last sync (snapshotBase), or null
 * @param mine    this tab's in-memory module-1 blob
 * @param theirs  the server's current module-1 blob
 */
export function mergeOabModule(base, mine, theirs) {
  const stats = { merged: 0, tookTheirs: 0, addedRows: 0, addedInv: 0, fields: {} };
  const out = { ...mine };

  // ── OAB rows ──
  const rOAB = (theirs && typeof theirs.OAB === 'object' && theirs.OAB) || { SF: [], OT: [] };
  const myOAB = (mine && typeof mine.OAB === 'object' && mine.OAB) || { SF: [], OT: [] };
  const nextOAB = {};

  ['SF', 'OT'].forEach((key) => {
    const theirRows = rowsOf(rOAB, key);
    const myRows = rowsOf(myOAB, key);
    if (!theirRows.length && !myRows.length) { nextOAB[key] = myRows; return; }

    const myIdx = {};
    myRows.forEach((r) => { if (r && r.so) myIdx[r.so] = r; });
    const baseIdx = (base && base[key]) || {};
    const merged = [];
    const seen = new Set();

    theirRows.forEach((tr) => {
      if (!tr || !tr.so) return;
      seen.add(tr.so);
      const mr = myIdx[tr.so];
      if (!mr) { merged.push(tr); stats.addedRows++; return; }   // a row this tab never had
      const note = [];
      const row = mergeRow(baseIdx[tr.so], mr, tr, note);
      if (note.length) {
        stats.merged++;
        note.forEach((f) => { stats.fields[f] = (stats.fields[f] || 0) + 1; });
      } else {
        stats.tookTheirs++;
      }
      merged.push(row);
    });

    // SOs only this tab has — just created here, not yet on the server.
    myRows.forEach((mr) => { if (mr && mr.so && !seen.has(mr.so)) merged.push(mr); });
    nextOAB[key] = merged;
  });
  out.OAB = nextOAB;

  // ── INV_REG: union by invoice number ──
  const theirInv = Array.isArray(theirs && theirs.INV_REG) ? theirs.INV_REG : [];
  const myInv = Array.isArray(mine && mine.INV_REG) ? mine.INV_REG : [];
  if (theirInv.length || myInv.length) {
    const byNo = new Map();
    const order = [];
    myInv.concat(theirInv).forEach((v) => {
      if (!v || !v.no) return;
      if (!byNo.has(v.no)) { byNo.set(v.no, v); order.push(v.no); return; }
      // Same invoice on both sides — keep whichever carries a packing list.
      const keep = byNo.get(v.no);
      if ((!keep.packingList || !keep.packingList.length) && v.packingList && v.packingList.length) {
        byNo.set(v.no, v);
      }
    });
    const unioned = order.map((n) => byNo.get(n));
    if (unioned.length !== myInv.length) stats.addedInv = unioned.length - myInv.length;
    out.INV_REG = unioned;
  }

  // ── counters never run backwards ──
  out.lastSO = maxLastSO(mine && mine.lastSO, theirs && theirs.lastSO);
  out.lastInvNo = Math.max(num(mine && mine.lastInvNo), num(theirs && theirs.lastInvNo));

  return { merged: out, stats };
}
