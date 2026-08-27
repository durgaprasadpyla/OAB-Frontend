// Shared modal — replaces the copy-pasted inline overlays. Backdrop click and the
// ✕ button both close; the sheet stops propagation so inner clicks don't. Reuses
// the design-system .card/.ctitle/.btn/.act classes so it matches every screen.
export default function Modal({ open, title, onClose, children, footer, wide = false }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
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
        onClick={(e) => e.stopPropagation()}
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
