import { useCallback, useEffect, useRef } from 'react';
import { useData } from '../data.jsx';

/**
 * Re-read one module from the server when a screen — or one of its tabs — opens,
 * and hand back a `refresh` for any other moment (the window coming back into focus).
 *
 * Issues 30.09 QT1 / SL6: every login loads the blobs once, at sign-in. The quotation
 * chain is five logins handing one record along (rep → QC → plant → quote desk → rep →
 * QC → rep → Superstar), and a conversion the Super Admin makes must reach a rep who is
 * already signed in — so without a re-read the next person saw nothing the previous one
 * had done until they refreshed the browser. `trigger` re-reads when it changes (the tab
 * key). A failed read leaves the loaded copy in place.
 *
 * A read that is still on the wire when a save of the same module starts never lands on
 * top of it: the data layer drops it (data.jsx reloadModule / writeSeqRef). So `save` is
 * the data layer's own, returned here only so a screen can take both from one place.
 */
export function useFreshModule(key, trigger) {
  const { save, reloadModule } = useData() || {};
  // held in a ref: the re-read must run on open / tab change, not whenever the
  // provider hands out a new function
  const reloadRef = useRef(reloadModule);
  reloadRef.current = reloadModule;
  const refresh = useCallback(() => {
    const fn = reloadRef.current;
    if (typeof fn !== 'function') return Promise.resolve();
    return Promise.resolve().then(() => fn(key)).catch(() => { /* the loaded copy stands */ });
  }, [key]);
  useEffect(() => { refresh(); }, [refresh, trigger]);
  return { refresh, save };
}
