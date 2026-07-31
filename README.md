# Bloomflex OAB — React frontend

A Vite + React 18 application that hosts the existing OAB UI **unchanged** and
integrates it with the Spring Boot backend. The OAB screen is your original
`index.html`, served by the backend at `/legacy/index.html` and embedded
full-screen (`src/OabApp.jsx`) — same look, same flow, nothing rewritten.

## Commands
```bash
npm install
npm run dev     # dev server on http://localhost:5173 (proxies /rest,/api,/legacy → :8080)
npm run build   # builds into ../backend/src/main/resources/static (served at :8080/)
```

## Config
- Backend URL for the dev proxy: set `VITE_BACKEND_URL` (default `http://localhost:8080`).
- `vite.config.js` proxies `/rest`, `/api`, `/legacy`, `/h2-console` to the backend
  so the embedded app and its API calls are same-origin in the browser.

## Requires the backend
This app renders the OAB UI from the backend and needs it running. See
`../backend/README.md` and the root `../README.md`.

## Growing into native React
`src/OabApp.jsx` is the single embed point. To migrate a screen, build a React
component that calls the backend `/api/*` (or `/rest/v1/oab_data`) and render it
instead of / alongside the iframe. Do it incrementally — the embedded app keeps
working the whole time.
