import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api.js';

/**
 * The single source of truth for the OAB app's data, ported from the legacy
 * app's in-memory model. The legacy tool kept eight "modules" in memory and
 * persisted each as one stringified-JSON blob to Supabase; our Spring Boot
 * backend reproduces that exact contract at /rest/v1/oab_data (and normalizes
 * the blobs into relational tables on write via MirrorService). So the native
 * React app does the same thing: load the eight blobs on sign-in, hold them in
 * this context, and POST a module back whenever a screen saves it.
 *
 *   id 1  oab        { OAB:{SF:[],OT:[]}, INV_REG:[], lastSO:{y,n}, lastInvNo }
 *   id 2  jss        [ spec master rows ]
 *   id 3  prices     { [spec]: {price, costPrice, transport} }
 *   id 4  customers  [ customer master rows ]
 *   id 5  prodStatus { plant production status, keyed by SO }
 *   id 6  purchase   { asl:[suppliers], po:[...], grn:[...], pay:[...] }
 *   id 7  pmData     { pm daily print qty, keyed by SO }
 *   id 8  scrap      { scrap buyer details }
 *   id 9  fgLedger   { [spec]: { prod:[{date,qty,ts,id,note}], alloc:[{date,qty,ts,so,src}] } }
 *   id 11 capa       [ QC CAPA records ]
 *
 * Each module carries an optimistic-lock `version` from the backend. We read it
 * on load, echo it on save, and — if the server reports a conflict (409, another
 * writer got there first) — reload that module, show a non-destructive notice,
 * and let the user re-apply their edit. A 409 NEVER logs the user out.
 */
export const KEY_TO_ID = { oab: 1, jss: 2, prices: 3, customers: 4, prodStatus: 5, purchase: 6, pmData: 7, scrap: 8, fgLedger: 9, capa: 11 };

// Empty-but-valid shapes so every screen can render before anything is saved.
export function emptyModules() {
  return {
    oab: { OAB: { SF: [], OT: [] }, INV_REG: [], lastSO: { y: '', n: 0 }, lastInvNo: 0 },
    jss: [],
    prices: {},
    customers: [],
    prodStatus: {},
    purchase: { asl: [], pos: [], priceHistory: [], counter: 0, itemsExtra: [] },
    pmData: {},
    scrap: {},
    fgLedger: {},   // { [spec]: { prod:[], alloc:[] } }
    capa: [],       // QC CAPA records
  };
}

async function loadOne(id) {
  let rows;
  try {
    rows = await api(`/rest/v1/oab_data?id=eq.${id}&select=data`);
  } catch (e) {
    // A role not permitted to read this module (403) still boots — the module just
    // stays empty. Only a forbidden read is swallowed; real failures (network, 500)
    // propagate so the app surfaces a genuine load error instead of hiding it.
    if (e && (e.code === 'forbidden' || e.status === 403)) return { value: null, version: 0 };
    throw e;
  }
  if (Array.isArray(rows) && rows.length && rows[0]) {
    const row = rows[0];
    let value = null;
    if (row.data != null) { try { value = JSON.parse(row.data); } catch { value = null; } }
    const version = Number.isFinite(Number(row.version)) ? Number(row.version) : 0;
    return { value, version };
  }
  return { value: null, version: 0 };
}

async function saveOne(id, obj, version) {
  // api() JSON-stringifies the body; the backend expects {id, data:"<json string>", version}
  // and returns {id, version:<new>}. Fall back to an optimistic bump if absent.
  const resp = await api('/rest/v1/oab_data', { method: 'POST', body: { id, data: JSON.stringify(obj), version } });
  const v = resp && Number.isFinite(Number(resp.version)) ? Number(resp.version) : (Number(version) || 0) + 1;
  return v;
}

const DataCtx = createContext(null);

export function DataProvider({ children }) {
  const [mods, setMods] = useState(emptyModules);
  const [versions, setVersions] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);   // { key, at } when a save was reloaded after a 409
  const modsRef = useRef(mods);
  modsRef.current = mods;
  const versionsRef = useRef(versions);
  versionsRef.current = versions;

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const entries = Object.entries(KEY_TO_ID);
      const results = await Promise.all(entries.map(([, id]) => loadOne(id)));
      const base = emptyModules();
      const vers = {};
      entries.forEach(([key], i) => {
        if (results[i] && results[i].value != null) base[key] = results[i].value;
        vers[key] = results[i] ? results[i].version : 0;
      });
      setMods(base);
      setVersions(vers);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const clearConflict = useCallback(() => setConflict(null), []);

  /**
   * Reload a single module from the server and update it + its version. Used after
   * a granular endpoint write (Phase 1): the endpoint is the authority, so we pull
   * the fresh, server-updated blob rather than mutating the local copy by hand.
   */
  const reloadModule = useCallback(async (key) => {
    const id = KEY_TO_ID[key];
    if (!id) return;
    const fresh = await loadOne(id);
    setMods(m => ({ ...m, [key]: fresh.value != null ? fresh.value : emptyModules()[key] }));
    setVersions(m => ({ ...m, [key]: fresh.version }));
  }, []);

  /** Replace one module and persist it. `next` may be a value or (prev)=>next. */
  const save = useCallback(async (key, next) => {
    const id = KEY_TO_ID[key];
    if (!id) throw new Error('unknown module: ' + key);
    const prev = modsRef.current[key];                 // snapshot for rollback
    const value = typeof next === 'function' ? next(prev) : next;
    setMods(m => ({ ...m, [key]: value }));   // optimistic local update
    setSaving(true);
    try {
      const expected = versionsRef.current[key] ?? 0;
      const newVersion = await saveOne(id, value, expected);
      setVersions(m => ({ ...m, [key]: newVersion }));
      return value;
    } catch (e) {
      if (e && (e.code === 'conflict' || e.status === 409)) {
        // Someone else saved this module first. Reload the fresh copy (so the UI
        // shows server truth) and flag it — the user's in-progress form state lives
        // in the screen, not here, so it is preserved; they can review and re-submit.
        let fresh = null;
        try { fresh = await loadOne(id); } catch { /* fall through to rollback */ }
        if (fresh) {
          setMods(m => ({ ...m, [key]: fresh.value != null ? fresh.value : emptyModules()[key] }));
          setVersions(m => ({ ...m, [key]: fresh.version }));
        } else {
          setMods(m => ({ ...m, [key]: prev }));
        }
        setConflict({ key, at: Date.now() });
        const err = new Error(`"${key}" was changed on the server and has been reloaded — please review and save again.`);
        err.code = 'conflict';
        throw err;
      }
      setMods(m => ({ ...m, [key]: prev }));  // roll back: never show unsaved data as saved
      throw e;
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <DataCtx.Provider value={{ mods, versions, loading, error, saving, conflict, clearConflict, reload, reloadModule, save }}>
      {children}
    </DataCtx.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error('useData must be used within <DataProvider>');
  return ctx;
}
