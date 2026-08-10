/* ===========================================================================
 * OAB-App build — assemble the production index.html from the reference monolith.
 *
 *   node build.js [apiBase]
 *     apiBase  backend origin baked into window.__OAB_API_BASE__
 *              (default: OAB_API_BASE env, else the prod API Gateway URL;
 *               use '' for same-origin, 'http://localhost:8080' for local)
 *
 * Steps (order matters):
 *   1) remove the Supabase connectivity-guard <script> (backend is Spring now);
 *   2) scrub every Supabase URL + anon key literal (requirement: none in prod FE);
 *   3) inject window.__OAB_API_BASE__ + the EARLY integration layer at the top of <head>;
 *   4) inject the LATE integration layer at the final </body>.
 * The reference's UI/markup/app logic is otherwise byte-identical.
 * =========================================================================== */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PROD_API = 'https://676yzsdb6d.execute-api.ap-south-1.amazonaws.com';
const apiBase = (process.argv[2] !== undefined ? process.argv[2] : (process.env.OAB_API_BASE || PROD_API)).replace(/\/+$/, '');

const SB_URL = 'https://lssgyckrehmiljruxerz.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxzc2d5Y2tyZWhtaWxqcnV4ZXJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMTI3MzQsImV4cCI6MjA5Nzc4ODczNH0.YVOo23FnLqe11s4BFLUPMrDjWiLdzm7VIGrxkQ_Mw9Y';

function read(p) { return fs.readFileSync(path.join(DIR, p), 'utf8'); }

let html = read('reference/index.html');
const early = read('src/integration-early.js');
const late = read('src/integration-late.js');
const guard = read('reference/connectivity-guard.js');
const overrides = read('src/overrides.css');
let logo = '';
try { logo = read('reference/logo-datauri.txt').trim(); } catch (e) { /* optional */ }
const report = [];

// 1) Remove the Supabase connectivity-guard script (exact-content replace).
const guardBlock = '<script>' + guard + '</script>';
if (html.indexOf(guardBlock) !== -1) {
  html = html.replace(guardBlock, '<script>/* Supabase connectivity guard removed — backend is Spring, not Supabase. */</script>');
  report.push('removed connectivity-guard script: yes');
} else {
  report.push('removed connectivity-guard script: NOT FOUND (check reference/connectivity-guard.js)');
}

// 2) Scrub Supabase URL + anon key literals everywhere.
const urlCount = html.split(SB_URL).length - 1;
html = html.split(SB_URL).join('');           // '' => app fetch path becomes /rest/v1/oab_data (same-origin), shim redirects
const keyCount = html.split(SB_KEY).length - 1;
html = html.split(SB_KEY).join('');
report.push('scrubbed Supabase URL occurrences: ' + urlCount);
report.push('scrubbed Supabase key occurrences: ' + keyCount);

// 2b) Scrub residual user-facing "Supabase" wording (error banners / comments). These
//     referenced the old cloud DB and are now inaccurate; the transport is Spring/RDS.
const hostPhrase = html.match(/[*]?\.?supabase\.co\.?/gi);
html = html.replace(/[*]?\.?supabase\.co\.?/gi, 'the server');
html = html.replace(/supabase/gi, 'the database');
report.push('rewrote residual Supabase wording: ' + (hostPhrase ? hostPhrase.length : 0) + ' host phrase(s) + word mentions');

// 2b2) Scrub the reference's DEAD client-side password literals. Auth now goes through
//      /api/auth (JWT); these AUTH_DEFAULTS / AUTH_USER / DASH_PASS strings are unused by
//      our overrides but must not ship as hardcoded credentials. Emptying the string keeps
//      the vestigial client map structurally valid (password field simply unused).
const deadCreds = ['entry123', 'qc123', 'padmin@123', 'purchase123', 'pm123', 'scrap123', 'sadmin123', 'quote123', 'admin@123'];
let credHits = 0;
deadCreds.forEach(function (c) {
  const before = html.length;
  const n = html.split("'" + c + "'").length - 1;
  if (n) { html = html.split("'" + c + "'").join("''"); credHits += n; }
});
// Also redact the two credential mentions left in code comments.
['purchase/purchase123', 'quote / quote123'].forEach(function (phrase) {
  if (html.indexOf(phrase) !== -1) { html = html.split(phrase).join(phrase.split(/[\/ ]+/)[0] + ' login'); credHits++; }
});
report.push('scrubbed dead hardcoded password literals: ' + credHits);

// 2c) Strip the baked-in JSS product catalogue (357 specs) from the bundle. It is real
//     business data and must come from the backend, not ship hardcoded. Safe to empty:
//     cloudLoadJSS() replaces JSS from module 2 on boot; the UI handles an empty JSS.
//     (The data was migrated into the DB; see scripts/import into module 2.)
const jssRe = /let JSS=\[[\s\S]*?\];(\s*let PRICE_MASTER=)/;
const jssMatch = html.match(jssRe);
if (jssMatch) {
  const strippedBytes = jssMatch[0].length;
  html = html.replace(jssRe, 'let JSS=[];$1');
  report.push('stripped baked-in JSS catalogue: yes (' + strippedBytes + ' bytes removed)');
} else {
  report.push('stripped baked-in JSS catalogue: PATTERN NOT FOUND (verify reference)');
}

// 3) Inject config + EARLY layer at the very top of <head> (before any app/lib script).
const headInject =
  '\n<script>/* OAB integration config */window.__OAB_API_BASE__=' + JSON.stringify(apiBase) + ';' +
  (logo ? 'window.__OAB_LOGO__=' + JSON.stringify(logo) + ';' : '') + '</script>\n' +
  '<script>/* OAB integration — early */\n' + early + '\n</script>\n';
report.push('invoice-logo de-dup constant injected: ' + (logo ? (logo.length + ' bytes') : 'NO (logo file missing)'));
const charsetAnchor = '<meta charset="UTF-8">';
const ci = html.indexOf(charsetAnchor);
if (ci === -1) { console.error('FATAL: charset anchor not found'); process.exit(1); }
html = html.slice(0, ci + charsetAnchor.length) + headInject + html.slice(ci + charsetAnchor.length);
report.push('injected early layer after charset meta: yes');

// 3b) Inject the CSS overrides just before </head> so they come AFTER the reference's
//     own <style> blocks and win at equal specificity.
const styleInject = '\n<style id="oab-overrides">/* OAB overrides */\n' + overrides + '\n</style>\n';
const hi = html.indexOf('</head>');
if (hi === -1) { console.error('FATAL: </head> not found'); process.exit(1); }
html = html.slice(0, hi) + styleInject + html.slice(hi);
report.push('injected CSS overrides before </head>: yes');

// 4) Inject LATE layer at the FINAL </body> (the tag appears inside template strings too).
const lateInject = '\n<script>/* OAB integration — late */\n' + late + '\n</script>\n';
const bi = html.lastIndexOf('</body>');
if (bi === -1) { console.error('FATAL: </body> not found'); process.exit(1); }
html = html.slice(0, bi) + lateInject + html.slice(bi);
report.push('injected late layer before final </body>: yes');

// Write output.
const outDir = path.join(DIR, 'dist');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);

// Post-build verification.
const residualUrl = html.indexOf('supabase.co') !== -1;
const residualKey = html.indexOf(SB_KEY.slice(0, 40)) !== -1;
report.push('API base baked: ' + (apiBase || '(same-origin)'));
report.push('output size: ' + html.length + ' bytes');
report.push('RESIDUAL supabase.co present: ' + residualUrl);
report.push('RESIDUAL supabase key present: ' + residualKey);
console.log('OAB-App build complete →', path.join('dist', 'index.html'));
console.log(report.map(r => '  • ' + r).join('\n'));
if (residualUrl || residualKey) { console.error('WARNING: residual Supabase reference remains — investigate.'); process.exit(2); }
