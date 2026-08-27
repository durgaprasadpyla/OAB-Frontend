import { useEffect } from 'react';

// Shared modal — replaces the copy-pasted inline overlays. Reuses the design-system
// .card/.ctitle/.btn/.act classes so it matches every screen.
//
// Enhancements 2.0 §2: an ACCIDENTAL click outside the popup must NOT close it and
// discard the data being entered. So the backdrop does NOT close the modal — only the
// ✕ button, a Cancel/footer action, or the Escape key close it.
export default function Modal({ open, title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '32px 16px', overflowY: 'auto',
      }}
    >
      <div
        className="card"
        role="dialog"
        aria-modal="true"
        style={{ width: wide ? 'min(920px,96vw)' : 'min(560px,96vw)', margin: '0 auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="ctitle" style={{ margin: 0 }}>{title}</div>
          <button className="btn btn-s" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
        {footer && <div className="act">{footer}</div>}
      </div>
    </div>
  );
}
