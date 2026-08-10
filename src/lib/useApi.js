import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';

/**
 * Minimal data-fetching hook over api(): fetches `path` on mount and whenever it
 * changes, exposing { data, loading, error, refetch }. A tiny stand-in for a
 * data-fetching library (React Query/SWR) — just enough to move a screen off the
 * whole-blob context read and onto a scoped, normalized endpoint.
 *
 * A monotonic request id guards against races: if `path` changes (or refetch is
 * called) while an earlier request is still in flight, the stale response is
 * dropped so it can never overwrite the newer one. Errors surface via api()'s
 * taxonomy (401 already handled globally there); the caller shows `error`.
 *
 * Pass a falsy `path` to stand down (no fetch, not loading).
 */
export function useApi(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState('');
  const reqId = useRef(0);

  const refetch = useCallback(async () => {
    if (!path) { setData(null); setLoading(false); setError(''); return; }
    const my = ++reqId.current;
    setLoading(true);
    setError('');
    try {
      const d = await api(path);
      if (my === reqId.current) setData(d);
    } catch (e) {
      if (my === reqId.current) { setError(e.message || String(e)); setData(null); }
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, loading, error, refetch };
}
