import { useEffect, useRef } from 'react';
import { useData } from '../data.jsx';

/**
 * Re-read one module from the server when a screen — or one of its tabs — opens.
 *
 * Issues 30.09 QT1: the quotation chain is five logins handing one record along
 * (rep → QC → plant → quote desk → rep → QC → rep → Superstar), and every login loads
 * the blobs once, at sign-in. So the next person in the chain saw nothing the
 * previous one had done until they refreshed the browser. Each hand-off screen calls
 * this, so opening it shows the latest copy. `trigger` re-reads when it changes
 * (the tab key). A failed read leaves the loaded copy in place.
 */
export function useFreshModule(key, trigger) {
  const { reloadModule } = useData() || {};
  // held in a ref: the effect must run on open / tab change, not whenever the
  // provider hands out a new function
  const reloadRef = useRef(reloadModule);
  reloadRef.current = reloadModule;
  useEffect(() => {
    const fn = reloadRef.current;
    if (typeof fn !== 'function') return;
    Promise.resolve().then(() => fn(key)).catch(() => { /* the loaded copy stands */ });
  }, [key, trigger]);
}
