// Small presentational badges shared across screens, matching the legacy tags.

const DF_COLOR = {
  pouch: 'tb', pouches: 'tb', roll: 'tg', rolls: 'tg',
  'bulk bag': 'ty', 'bulk bags': 'ty', kgs: 'tgr', kg: 'tgr', labels: 'tr', label: 'tr',
};

/** Dispatch-form pill (dispFormBadge, legacy 1798). */
export function DispFormBadge({ df }) {
  const d = String(df || '').toLowerCase().trim();
  if (!d) return null;
  return <span className={'tag ' + (DF_COLOR[d] || 'tgr')} style={{ fontSize: 9 }}>{df}</span>;
}

/** Production-status pill — green when Ready, red otherwise (buildProdStatusCell, 4743). */
export function ProdBadge({ status }) {
  const s = status || 'Ready';
  return <span className={'tag ' + (s !== 'Ready' ? 'tr' : 'tg')} style={{ fontSize: 9 }}>{s}</span>;
}

/** Balance pill: green ≤0, red >1 lakh, amber otherwise (legacy `bt`). */
export function BalanceBadge({ value, children }) {
  const b = Number(value) || 0;
  const cls = b <= 0 ? 'tg' : b > 100000 ? 'tr' : 'ty';
  return <span className={'tag ' + cls}>{children}</span>;
}
