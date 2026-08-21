# Bloomflex OAB — React frontend

A standalone **Vite + React 18** application (React Router, Vitest) for the OAB
Order & Production tool. It is a native React app — one screen per route under
`src/pages/` — that talks to the Spring Boot backend (`../OAB-back/OAB-Backend`)
over its REST API. There is no embedded/iframe legacy page.

## Commands
```bash
npm install
npm run dev      # dev server on http://localhost:5173
npm run build    # static bundle in ./dist — host on any server/CDN
npm run preview  # preview the build on http://localhost:4173
npm test         # Vitest (run once);  npm run test:watch to watch
```

## Config
- **`VITE_API_BASE`** (`.env`) — the backend origin. Empty = same-origin (when the
  bundle is served by the backend). Set e.g. `http://localhost:8080` to run the
  frontend on its own origin cross-origin (auth is a Bearer token, no cookies).
- If `VITE_API_BASE` is empty in dev, `vite.config.js` proxies `/rest` and `/api`
  to `VITE_BACKEND_URL` (default `http://localhost:8080`) so calls are same-origin.

## Architecture
- **`src/data.jsx`** — the data context. Loads the 8 module blobs on sign-in via
  `/rest/v1/oab_data`, holds them, and saves a module back on edit. It tracks each
  module's optimistic-lock **`version`**, sends it on save, and on a **409**
  (someone else saved first) reloads that module, shows a non-destructive banner,
  and lets you re-submit — **without logging you out**.
- **`src/api.js`** — fetch wrapper. Error taxonomy: `401` → session expired
  (logout); `409` → `err.code='conflict'` (recoverable); `403` →
  `err.code='forbidden'` (not a session error). `allocateNumber(type)` reserves a
  server number from `POST /api/seq/{type}`; `ordersApi.*` are the Phase-1 granular
  module-1 endpoints (sales-orders, invoices, dispatch/close/reopen/stage);
  `purchaseApi.*` are the Phase-2 purchase (module 6) endpoints;
  `rmRatesApi` reads/writes the shared RM ₹/kg rates.
- **Contended writes go through granular endpoints**, then the screen calls
  `reloadModule('oab'|'purchase')` to pull the server-updated blob (still the read
  model). Migrated: NewPO, DailyUpdate, Invoice, OabBoard, Plant (module 1) and
  Purchase (module 6 — create PO / GRN / pay). Low-contention modules and master
  data (scrap, jss, customers, prices, prodStatus, pmData, ASL/item-master) still
  save whole blobs.
- **`src/auth.jsx`** — JWT sign-in; token/user/role in `localStorage`.
- **`src/lib/*`** — business math (kept in the browser for display). `seq.js` holds
  the single, authoritative document-number formats (invoice = `BFX/<yyyy>-<yy>/<0nn>`,
  matching the backend `SequenceService`).
- **`src/lib/roles.js`** — client-side route gating (UX). Authorization is
  **enforced on the server**; the client gate is convenience only.
- **`src/pages/*`** — the screens (New PO, OAB boards, Daily Update, Invoice,
  Dashboard, Plant, QC, PM, Purchase, P Dashboard, Scrap).

## Requires the backend
Provision and start `../OAB-back/OAB-Backend` first (see its README), then run
`npm run dev`. Money/PDF/Excel export uses `pdf-lib` and CDN globals (SheetJS,
html2canvas, jsPDF).

## Tests
`src/test/` — `lib.test.js` (business math), `flows*.test.jsx` (screen flows),
`smoke.test.jsx` (every page renders), and `concurrency.test.jsx` (version echo,
409 reload-without-logout, server number allocation).
