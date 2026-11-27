import FgEntryPanel from '../components/FgEntryPanel.jsx';
import { useAuth } from '../auth.jsx';

// FG Entry — finished-goods ledger (native port of the legacy tab-fg screen).
// Record finished goods produced per spec on a date (append-only). Available FG
// = produced − allocated; the New-PO drawdown and Daily-Update allocation draw
// from this pool. Persists to data module 9 (`fgLedger`).
//
// Stores 5.1: the sheet itself lives in `components/FgEntryPanel.jsx`, because the
// Stores login's FG tab is the SAME screen — "the data should be entered either
// from the Superstar login, or from the stores login but at both places the FG
// should be the same" — including the moving / non-moving report.
//
// 27.11 Enhancements: FG entry left the Superstar login for two single-purpose
// logins — U2 books FG for StayFresh jobs only, U1 for every other job. They share
// this one screen, scoped to their own jobs; the Super Admin / Purchase Admin keep
// the full, unscoped sheet. The logins book quantities only — no money (costing none).

export default function FGLedger() {
  const { role } = useAuth();
  const scope = role === 'u2' ? 'sf' : role === 'u1' ? 'ot' : 'all';
  // U1 / U2 are FG-entry operators, not costing roles: they see quantities only.
  const costing = (role === 'u1' || role === 'u2') ? 'none' : 'summary';
  return (
    <div id="app">
      <FgEntryPanel heading scope={scope} costing={costing} />
    </div>
  );
}
