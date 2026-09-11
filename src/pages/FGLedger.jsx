import FgEntryPanel from '../components/FgEntryPanel.jsx';

// FG Entry — finished-goods ledger (native port of the legacy tab-fg screen).
// Record finished goods produced per spec on a date (append-only). Available FG
// = produced − allocated; the New-PO drawdown and Daily-Update allocation draw
// from this pool. Persists to data module 9 (`fgLedger`).
//
// Stores 5.1: the sheet itself lives in `components/FgEntryPanel.jsx`, because the
// Stores login's FG tab is the SAME screen — "the data should be entered either
// from the Superstar login, or from the stores login but at both places the FG
// should be the same" — including the moving / non-moving report.

export default function FGLedger() {
  return (
    <div id="app">
      <FgEntryPanel heading />
    </div>
  );
}
