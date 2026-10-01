import { useCallback, useRef } from 'react';
import { useData } from '../data.jsx';

/**
 * Re-read one module on demand — a tab change, the window coming back into focus —
 * without ever letting a slow read put back the blob from before a save.
 *
 * 30.09 §SL6: the rep's login read the sales blob once at sign-in, so a conversion
 * the Super Admin made later never reached them. Re-reading fixes that, but a read
 * that is still on the wire when a save lands would hand back the pre-save copy. So
 * saves go through the `save` this returns: a read is put off while one is in
 * flight, and a read that overlapped one is simply done again once it has landed.
 *
 * Returns { refresh, save } — hand `save` to the screens in place of the data
 * layer's own; it takes the same arguments.
 */
export function useFreshModule(key) {
  const { save, reloadModule } = useData();
  const inFlight = useRef(0);       // saves on the wire
  const seq = useRef(0);            // saves started, ever
  const pending = useRef(false);    // a read was asked for while a save was on the wire
  const refreshRef = useRef(null);
  refreshRef.current = () => {
    if (!reloadModule) return;
    if (inFlight.current) { pending.current = true; return; }
    const at = seq.current;
    reloadModule(key)
      .then(() => { if (seq.current !== at) refreshRef.current(); })   // a save crossed this read
      .catch(() => {});
  };
  const refresh = useCallback(() => refreshRef.current(), []);
  const countedSave = useCallback(async (k, next, opts) => {
    inFlight.current += 1;
    seq.current += 1;
    try {
      return await save(k, next, opts);
    } finally {
      inFlight.current -= 1;
      if (!inFlight.current && pending.current) { pending.current = false; refreshRef.current(); }
    }
  }, [save]);
  return { refresh, save: countedSave };
}
