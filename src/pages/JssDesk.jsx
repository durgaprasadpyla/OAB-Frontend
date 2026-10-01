import JssEditor from '../components/JssEditor.jsx';

// 30.09 §QC — the JSS login. "A new login: ONLY the JSS editor functionality that
// exists in super admin. List of JSS, radio to enable editing. One-time job for
// ~500 JSSs." This page is exactly that editor, nothing beside it: the role lands
// here, reaches no other route (roles.js), and its server grants are module 2
// (the specs) plus read-only customers and sales drop-downs the form picks from.
// Order rows are synced server-side (POST /api/oab-rows/sync-spec) — this login
// never touches the order book itself.
export default function JssDesk() {
  return (
    <div id="app">
      <div className="pg-ttl">📋 JSS Editor</div>
      <div className="pg-sub">
        Every JSS spec — pick one with its radio to edit it in the same fields QC creates a spec with.
        Work through the ones not yet built from the Item Master with the filter, and Save &amp; next.
      </div>
      <JssEditor />
    </div>
  );
}
