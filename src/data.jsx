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
 */
export const KEY_TO_ID = { oab: 1, jss: 2, prices: 3, customers: 4, prodStatus: 5, purchase: 6, pmData: 7, scrap: 8 };

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
  };
}

async function loadOne(id) {
  const rows = await api(`/rest/v1/oab_data?id=eq.${id}&select=data`);
  if (Array.isArray(rows) && rows.length && rows[0] && rows[0].data != null) {
    try { return JSON.parse(rows[0].data); } catch { return null; }
  }
  return null;
}

async function saveOne(id, obj) {
  // api() JSON-stringifies the body; the backend expects {id, data:"<json string>"}.
  await api('/rest/v1/oab_data', { method: 'POST', body: { id, data: JSON.stringify(obj) } });
}

const DataCtx = createContext(null);

export function DataProvider({ children }) {
  const [mods, setMods] = useState(emptyModules);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const modsRef = useRef(mods);
  modsRef.current = mods;

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const entries = Object.entries(KEY_TO_ID);
      const results = await Promise.all(entries.map(([, id]) => loadOne(id)));
      const base = emptyModules();
      entries.forEach(([key], i) => { if (results[i] != null) base[key] = results[i]; });
      setMods(base);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  /** Replace one module and persist it. `next` may be a value or (prev)=>next. */
  const save = useCallback(async (key, next) => {
    const id = KEY_TO_ID[key];
    if (!id) throw new Error('unknown module: ' + key);
    const value = typeof next === 'function' ? next(modsRef.current[key]) : next;
    setMods(m => ({ ...m, [key]: value }));   // optimistic local update
    setSaving(true);
    try {
      await saveOne(id, value);
    } finally {
      setSaving(false);
    }
    return value;
  }, []);

  return (
    <DataCtx.Provider value={{ mods, loading, error, saving, reload, save }}>
      {children}
    </DataCtx.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error('useData must be used within <DataProvider>');
  return ctx;
}
