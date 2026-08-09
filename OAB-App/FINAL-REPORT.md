# OAB — Final Report (Option B: reference monolith → production, real backend)

**Outcome:** The reference application (`oab1234.pages.dev`) is now the **live production app** at
**https://d3f68thcqn23fi.cloudfront.net/**, running against the existing Spring Boot backend + RDS MySQL.
Same UI/UX/workflows as the reference; every dynamic operation goes Frontend → Spring REST API → RDS.
No Supabase at runtime, no mock/hardcoded business data, no localStorage as source of truth. RDS left exactly as-is.

Companion docs: `MODULE-API-DB-MAPPING.md` (full mapping) · `VALIDATION-REPORT.md` (17-point matrix).

## 1. Reference application features (modules discovered)
New PO · OAB board (Stay Fresh / Others, filter/search/sort/PDF/Excel/closed-SOs) · Daily Update · FG Entry (FG ledger) ·
Invoice (+ Proforma, Packing List) · Dashboard (JSS Editor, Price Master, Customer Master, Material Rates, Users & Access, super-admin gate) ·
P Dashboard · S Dashboard (Sales/CSA) · Plant view · QC (Spec Entry, COA/Food-grade certs, CAPA, CSA reports) ·
PM (printing tracker) · Scrap · Purchase (ASL, POs, GRN, Price History, Price Fluctuation, Payments, Item Master, Price Trends) ·
Quotation Desk · Sales Rep Portal. Roles: user, plant, qc, padmin, purchase, pm, scrap, sadmin, quote, sales(rep), superadmin.

## 2. Features implemented (all of the above)
100% of reference modules are live and API-driven — the frontend is the reference's exact code, so UI/UX/workflows are preserved; only the data/auth layer was swapped to the real backend. Every module validated (see matrix) — PASS.

## 3. API mapping (summary; full in MODULE-API-DB-MAPPING.md)
- One data endpoint powers the module blobs: `GET/POST /rest/v1/oab_data?id=eq.{n}` → `ModuleStore`/`DataWriteService` → `oab_module` (LONGTEXT) + relational mirror (`oab_row`, `invoice`, `invoice_item`, `customer`, `spec_price`, `spec`, `supplier`, `purchase_order`, `app_meta`).
- Slots: 1 OAB/invoices · 2 JSS · 3 prices · 4 customers · 5 prodStatus · 6 purchase · 7 pmData · 8 scrap · 9 FG · 11 CAPA · 12 sales(CSA/Quote/Rep).
- Auth: `POST /api/auth/login`, `GET /api/auth/me`, **`POST /api/auth/sales-rep-login`** (new).
- Users: `GET/POST/PUT /api/admin/users` (superadmin). Rates: `GET/PUT /api/rm-rates`. Numbers: `POST /api/seq/{SO|INV|PO}`. Granular order/purchase endpoints remain available.
- Transport shim (frontend) redirects the reference's calls to the backend, attaches the JWT, tracks per-slot version (optimistic lock), de-dups the invoice logo, and blocks boot-time writes.

## 4. Database changes
**None to schema or data.** RDS left exactly as-is per your instruction (no migration, no writes). `scripts/seed-users.sql` updated (for fresh installs only) to include sadmin/quote/sales. The blob column is already LONGTEXT (handles image-bearing blobs).

## 5. Authentication changes
- Real JWT auth for all staff roles via `/api/auth/login` (bcrypt, `app_user`), replacing the reference's client-side password check.
- Dashboard super-admin gate → real superadmin elevation (no hardcoded password).
- Users & Access → real `app_user` via `/api/admin/users`.
- **Sales Rep Portal** → new `/api/auth/sales-rep-login` (validates slot-12 `sales_users` server-side, issues a `sales` JWT).
- All dead client-side password literals scrubbed from the bundle. Server-side per-module authorization enforced (`AuthzService`).

## 6. Frontend changes (`D:\projects\OAB\OAB-App\`)
- `build.js` assembles `dist/index.html` from `reference/index.html`: removes the Supabase connectivity guard; scrubs Supabase URL/key/wording, dead credentials, and the baked-in 357-spec JSS catalogue; injects config + logo + two integration layers.
- `src/integration-early.js`: `fetch` shim (repoint→backend, JWT, optimistic-lock versioning + 409 handling, invoice-logo de-dup, boot-write guard), localStorage business-key block, boot-purge disable.
- `src/integration-late.js`: real login/logout/session-restore, Dashboard elevation, material rates → `/api/rm-rates`, Users & Access → `/api/admin/users`, sales-rep login fallback + rep-session routing.
- The reference's UI markup/CSS/screens are unchanged.

## 7. Backend changes (minimal, additive; existing app otherwise unchanged)
- `AuthzService`: added module 12 (sales) write-roles {sadmin, quote, sales, superadmin}.
- `UserAdminController.ROLES`: added sadmin, quote, sales.
- `AuthController`: added `POST /api/auth/sales-rep-login`.
- Deployed to the `oab-backend` Lambda (backward-compatible; existing endpoints unchanged).

## 8. Tests performed
- Backend unit/integration: **27 tests, all green** (incl. after the rep-login change).
- API validation (curl, local): **24/24** — all 11 role logins, blob read/write, optimistic lock (409), authz matrix incl. slot 12, rm-rates, admin/users, sales-rep-login (correct/wrong/absent).
- CRUD write→DB→readback for **every** module (1,2,3,4,5,6,7,8,9,11,12).
- Full New-PO UI workflow (created SO 26/554, persisted). OAB filter/search/sort. Role-view gating for all 11 roles. Dashboard elevation + Users & Access (13 users). Sales Rep Portal login + read + write.
- Structural UI diff vs reference (nav, 19 OAB columns, New-PO labels) — identical.
- Bundle scan: 0 Supabase / 0 creds / 0 mock / SB_KEY empty.
- Live post-cutover: monolith served, real RDS data (JSS 369, OAB SF 119), 0 console errors, 0 Supabase, CORS OK.

## 9. AWS deployment status
- **Frontend:** deployed to `s3://oab-frontend-318866803551/index.html` (live), CloudFront `ET2VMLKWVE5QW` invalidated. Previous React shell backed up → `index.react-backup-20260809.html` (rollback = restore it; React `/assets/*` untouched). Validated copy also at `/test/index.html`.
- **Backend:** `oab-backend` Lambda (ap-south-1) updated (slot-12 authz + roles + rep-login); health 200. CORS unchanged (same CloudFront origin).
- **RDS:** unchanged.

## 10. Remaining issues / follow-ups (none blocking; all by your instruction)
1. **Sales roles/reps not yet usable live** — sadmin/quote accounts and sales reps aren't in RDS (you chose "leave RDS as-is"). Enable via the in-app flow: superadmin → Dashboard → Users & Access creates sadmin/quote; sadmin → S Dashboard creates reps. (User-initiated writes — no manual DB change.)
2. **Reference is ahead by 13 orders / 23 invoices** (26/541–553) — not in RDS by your choice. Safe additive-merge available on request (snapshot first; 0 existing records changed).
3. **Sales-rep passwords are plaintext** in the slot-12 blob (reference data model). Recommend hashing in a future pass (needs a small change to the Sales-Admin rep-management UI).
4. **Blob size / 6 MB API-Gateway cap** — mitigated by invoice-logo de-dup (module 1: 5.5 MB→0.6 MB). If image-heavy modules (GRN photos, QC certs) grow, move images to a dedicated store; monitored, not urgent.
5. Optional: remove the `/test/index.html` copy once you're satisfied.
