import { useEffect, useRef, useState } from 'react';
import { artworkApi } from '../api.js';
import Modal from './Modal.jsx';

// Issues 11.11 — the artwork of a JSS. "Our team has printed incorrect SKUs so in order
// to avoid that we are using this as a quick check." QC attaches it (ArtworkPicker);
// the Plant, PM and PLAN logins open it before planning (ArtworkButton); the planning
// sheet prints it (PlanDownloads).

/** Artwork is kept sharp enough to read text on the pack, and small enough to store. */
export const ARTWORK_MAX_SIDE = 1600;
export const ARTWORK_QUALITY = 0.8;

/** A picked image, downscaled and re-encoded as JPEG — resolves to `{ fileName, data }`. */
export function readArtwork(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || '').startsWith('image/')) { reject(new Error('Pick an image file (JPG or PNG).')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image — please try another file.'));
      img.onload = () => {
        const scale = Math.min(1, ARTWORK_MAX_SIDE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ fileName: file.name, data: canvas.toDataURL('image/jpeg', ARTWORK_QUALITY) });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/** A "Browse…" button that reads one image and hands it back; it saves nothing itself. */
export function ArtworkPicker({ label = '🖼 Browse artwork…', onPicked, disabled, ariaLabel = 'Browse artwork' }) {
  const ref = useRef(null);
  const [err, setErr] = useState('');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} aria-label={ariaLabel}
        onChange={async (e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!f) return;
          setErr('');
          try { onPicked(await readArtwork(f)); } catch (x) { setErr(x.message || String(x)); }
        }} />
      <button type="button" className="btn btn-s" disabled={disabled} onClick={() => ref.current && ref.current.click()}>{label}</button>
      {err && <span style={{ color: 'var(--red)', fontSize: 11 }}>{err}</span>}
    </span>
  );
}

/** "🖼 Artwork" — opens the spec's artwork in a pop-up; says so when there is none. */
export function ArtworkButton({ spec, compact = false }) {
  const [open, setOpen] = useState(false);
  const [art, setArt] = useState(null);
  const [state, setState] = useState('');   // '' | 'loading' | 'none' | 'error'
  useEffect(() => {
    if (!open || !spec) return;
    let live = true;
    setState('loading');
    artworkApi.get(spec)
      .then((a) => { if (live) { setArt(a); setState(''); } })
      .catch((e) => { if (live) { setArt(null); setState(/404|No artwork/i.test(String(e && e.message)) ? 'none' : 'error'); } });
    return () => { live = false; };
  }, [open, spec]);
  if (!spec) return null;
  return (
    <>
      <button type="button" className="btn btn-s" title={`Artwork of ${spec}`} aria-label={`Artwork of ${spec}`}
        style={compact ? { height: 22, fontSize: 10, padding: '0 6px' } : { height: 26, fontSize: 11 }}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>🖼{compact ? '' : ' Artwork'}</button>
      <Modal open={open} wide title={`Artwork — ${spec}`} onClose={() => setOpen(false)}>
        {state === 'loading' && <div className="pg-sub">Loading…</div>}
        {state === 'none' && <div className="al al-y">No artwork has been added for {spec} yet — QC adds it from the JSS list.</div>}
        {state === 'error' && <div className="al al-r">Could not load the artwork of {spec}.</div>}
        {art && art.data && (
          <div style={{ textAlign: 'center' }}>
            <img src={art.data} alt={`Artwork of ${spec}`} style={{ maxWidth: '100%', maxHeight: '75vh', border: '1px solid var(--bd)' }} />
            <div className="pg-sub" style={{ marginTop: 6 }}>{art.fileName || ''}{art.updatedBy ? ` · added by ${art.updatedBy}` : ''}{art.updatedAt ? ` on ${String(art.updatedAt).slice(0, 10)}` : ''}</div>
          </div>
        )}
      </Modal>
    </>
  );
}
