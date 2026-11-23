// BloomFlex V2 design kit: the building blocks of the BloomFlex V2 prototype screens.
// The look lives in ../v2.css, scoped under .v2 — only screens wrapped in <V2Page>
// change. Identical copy in every feat/* BloomFlex V2 branch.
import '../v2.css';

/** Page wrapper: breadcrumb overline, big title, subtitle and actions on the right. */
export function V2Page({ crumb, title, subtitle, actions, children, className = '', ...rest }) {
  return (
    <div className={'v2 ' + className} {...rest}>
      {(title || crumb || actions) && (
        <div className="v2-head">
          <div>
            {crumb && <div className="v2-overline">{crumb}</div>}
            {title && <h1>{title}</h1>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="v2-actions">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Row of metric tiles: [{ label, value, detail, tone: 'good'|'danger'|'warn'|'blue', testId }]. Null values are skipped. */
export function V2Metrics({ items, ...rest }) {
  const shown = (items || []).filter((m) => m && m.value !== null && m.value !== undefined);
  if (!shown.length) return null;
  return (
    <div className="v2-metrics" {...rest}>
      {shown.map((m) => (
        <div key={m.key || m.label} className="v2-metric" data-testid={m.testId}>
          <div className="lbl">{m.label}</div>
          <strong className={m.tone || ''}>{m.value}</strong>
          {m.detail && <div className="detail">{m.detail}</div>}
        </div>
      ))}
    </div>
  );
}

/** White panel with a title bar (title, optional sub-line, right-hand slot). `pad` pads the body. */
export function V2Panel({ title, sub, right, pad = false, children, className = '', bodyStyle, ...rest }) {
  return (
    <section className={'v2-panel ' + className} {...rest}>
      {(title || right) && (
        <div className="v2-panel-title">
          <div>
            {typeof title === 'string' ? <h2>{title}</h2> : title}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {right && <div className="v2-actions">{right}</div>}
        </div>
      )}
      <div className={pad ? 'v2-pad' : undefined} style={bodyStyle}>{children}</div>
    </section>
  );
}

/** Status badge. tone: green | red | amber | blue | gray. */
export function V2Badge({ tone = 'blue', children, ...rest }) {
  return <span className={'v2-badge ' + tone} {...rest}>{children}</span>;
}

/** Ready / Partial / Blocked (and similar) → badge tone. */
export function statusTone(status) {
  const s = String(status || '').toUpperCase();
  if (['READY', 'APPROVED', 'COMPLETED', 'DONE', 'PUBLISHED', 'MOVING'].includes(s)) return 'green';
  if (['BLOCKED', 'SHORT', 'REJECTED', 'OVERDUE', 'NON-MOVING', 'NON_MOVING'].includes(s)) return 'red';
  if (['PARTIAL', 'PENDING', 'DRAFT', 'WAITING'].includes(s)) return 'amber';
  if (['RUNNING', 'IN PROGRESS', 'PARTIALLY COMPLETED'].includes(s)) return 'blue';
  return 'gray';
}

/** Callout box (amber by default, tone="blue" for information). */
export function V2Note({ tone, children, ...rest }) {
  return <div className={'v2-note' + (tone === 'blue' ? ' blue' : '')} {...rest}>{children}</div>;
}
