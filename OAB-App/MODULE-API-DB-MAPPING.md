# OAB — Reference Module → Spring API → Database Mapping

Source of truth (UI/UX/behavior): the reference app `oab1234.pages.dev`
(build `2026-08-03-fg-ledger-v17`), a self-contained monolith. Production
backend: existing Spring Boot app `oab-backend` on AWS Lambda + RDS MySQL
(`oabdb`). This document maps every reference module to its real API + storage.

## Transport model

The reference talks to **one** endpoint — `/rest/v1/oab_data` (26 call sites),
a PostgREST-style blob store keyed by numeric `id` (a "module"). No Supabase
Storage/Auth; images ride inside the JSON blobs as base64.

The backend `OabDataController` is a drop-in replacement for that endpoint:
- `GET /rest/v1/oab_data?id=eq.{n}&select=data` → `[{data:"<json>",version:n}]`
- `POST /rest/v1/oab_data` `{id,data,version}` → `{id,version:n+1}`

Added over the original: per-module **role authz** (`AuthzService`),
**optimistic locking** on `version` (409 on stale), and a **relational mirror**
(blob + normalized tables committed in one transaction, `DataWriteService`/`MirrorService`).

Frontend integration (this project): a `fetch` interception shim redirects the
26 calls to the backend, attaches the real **JWT**, tracks per-slot `version`,
and handles 409. Business data never touches `localStorage` (source of truth = DB).

## Slot (module id) map

| id | Reference blob (localStorage key) | Global | In-memory shape | Writer roles | Mirrored tables |
|----|-----------------------------------|--------|-----------------|--------------|-----------------|
| 1  | `bloomflex_oab_v1` | `OAB`,`INV_REG`,`lastSO`,`lastInvNo` | `{OAB:{SF:[],OT:[]},INV_REG:[],lastSO,lastInvNo}` | user, padmin, superadmin | oab_row, invoice, invoice_item, app_meta |
| 2  | `bloomflex_jss_v1` | `JSS` | `[spec master rows]` | qc, superadmin | spec |
| 3  | `bloomflex_pm` | `PRICE_MASTER` | `{[spec]:{price,costPrice,transport}}` | superadmin | spec_price |
| 4  | `bloomflex_cm` | `CUST_MASTER` | `[customer rows]` | superadmin | customer |
| 5  | `bloomflex_prod_status` | `PROD_STATUS` | `{[so]:stage}` | plant, superadmin | (blob only) |
| 6  | `bloomflex_purch_v1` | `PURCH` | `{asl,pos,priceHistory,itemsExtra,counter}` | purchase, padmin, superadmin | supplier, purchase_order |
| 7  | `bloomflex_pm_v1` | `PM_DATA` | `{[so]:{printDate,printedKg,printedMt}}` | pm, superadmin | (blob only) |
| 8  | `bloomflex_scrap_v1` | `SCRAP` | `{buyers,prices,txns}` | scrap, padmin, superadmin | (blob only) |
| 9  | `bloomflex_fg_v1` | `FG_LEDGER` | `{[spec]:{prod:[],alloc:[]}}` | user, padmin, superadmin | (blob only) |
| 10 | `bloomflex_users_v1` | `AUTH_USERS` | `{[username]:{pass,role}}` | — (RETIRED) | → real `app_user` via `/api/admin/users` |
| 11 | `bloomflex_capa_v1` | `CAPA` | `[capa records]` | qc, superadmin | (blob only) |
| 12 | (cloud only) | `SALES_SHARED` | `{leads,skus,qc_reports,pos,interactions,quotations,sales_users,targets,contacts,substrate_options,nego_msgs,dropdowns}` | sadmin, quote, sales, superadmin | (blob only) — **authz entry to ADD** |

Slot 10 is retired from the blob path: user management moves to the real
`app_user` table (bcrypt) via `/api/admin/users`. Slot 12 is the shared Sales
system (CSA + Quotation Desk + Sales Rep Portal) — **new authz entry required.**

## Module → operation → API → DB → UI

### Auth / roles (all modules)
- Login: `authLogin()` → `POST /api/auth/login {username,password}` → `{token,role}` → JwtService/`app_user` (bcrypt) → store token, set `currentRole` → reveal role view.
- Restore: boot → `GET /api/auth/me` (Bearer) → `{username,role}`.
- Dashboard super-admin gate: password prompt → real `POST /api/auth/login` as `superadmin` → elevate JWT for master-data writes (modules 2/3/4, users).
- Roles: user, plant, qc, padmin, purchase, pm, scrap, sadmin, quote, sales, superadmin.

### OAB / New PO / Daily Update / Invoice (slot 1)
- New PO submit → `saveData()`→`cloudSave()` → `POST oab_data id=1` → `DataWriteService` → oab_row/invoice mirror → OAB re-render. SO#/INV# atomic numbers via `POST /api/seq/{SO|INV}` (`SeqController`).
- Daily Update dispatch/FG/stage edits → slot 1 (+ slot 9 for FG drawdown).
- Invoice confirm → slot 1 (`INV_REG` + packing list on the invoice object) → invoice/invoice_item mirror.
- Reads: `cloudLoad()` → `GET oab_data id=1`.

### JSS spec master (slot 2) — QC "Add Spec" / Dashboard JSS Editor
- Save → `cloudSaveJSS()` → `POST id=2` → `spec` mirror. Read → `GET id=2`.

### Price Master (slot 3) & Customer Master (slot 4) — Dashboard (superadmin)
- `cloudSavePM()`/`cloudSaveCM()` → `POST id=3|4` → `spec_price`/`customer` mirror.

### Production Status (slot 5) — Plant view
- `cloudSaveProdStatus()` → `POST id=5` (blob). Read → `GET id=5`.

### Purchase (slot 6) — padmin/purchase
- ASL, POs, GRN, price history, payments → `cloudSavePurch()` → `POST id=6` → supplier/purchase_order mirror. (Granular endpoints `/api/purchase-orders/*` also exist and remain available.)

### PM printing data (slot 7) — pm
- `pmCloudSave()` → `POST id=7` (blob).

### Scrap (slot 8) — scrap/padmin
- `scrapCloudSave()` → `POST id=8` (blob).

### FG Ledger (slot 9) — FG Entry (ops)
- `fgCloudSave()` → `POST id=9` (blob). Available = produced − allocated.

### QC CAPA + COA/Food-grade certs (slot 11) — qc
- `capaCloudSave()` → `POST id=11` (blob). COA/cert images ride in the blob (base64).

### Sales system (slot 12) — sadmin / quote / sales
- CSA (leads, interactions, contacts, targets), Quotation Desk (quotations, substrate_options, nego_msgs), Sales Rep Portal (sales_users, rep POs) all share slot 12.
- `salesCloudSavePatch(patch)` = read-merge-write on `id=12`. Read → `GET id=12`.
- **Backend change: add module 12 to `AuthzService` writer roles {sadmin, quote, sales, superadmin}.**

### Users & Access (Dashboard, superadmin)
- Retire slot-10 blob. UI → real API: list `GET /api/admin/users`, create `POST /api/admin/users`, update `PUT /api/admin/users/{id}` (bcrypt, write-only passwords).

### Raw-material rates (`bloomflex_mat`) — Material Rates (padmin/purchase)
- Reference kept these in `localStorage`. Backend already has a relational store: `GET/PUT /api/rm-rates` (`RmRateController` → `rm_rate` table). Frontend `loadMaterialRates()`/save wired to `/api/rm-rates`.

## Backend changes required (minimal, additive)
1. `AuthzService.MODULE_WRITE_ROLES`: add `12L → {sadmin, quote, sales, superadmin}`.
2. Seed users `sadmin`, `quote`, `sales` (bcrypt) in `seed-users.sql` + RDS.
3. Confirm `SecurityConfig`/`JwtService` accept these roles (they are opaque strings; no enum gate expected).
4. Ensure request/response size limit accommodates blobs; note API-Gateway/Lambda 6 MB hard cap for image-heavy blobs (assessment task).

## Blob architecture — production assessment (summary; see task #3)
- Concurrency: OCC via `version` (client shim now sends it) — **kept**.
- Transactions/integrity: blob+mirror one tx — **kept**.
- Validation: JSON well-formedness — kept (blob model; no per-field schema).
- Authz: per-module role matrix — kept (+ slot 12).
- Payload/perf: whole-blob rewrite per save; **risk**: base64 images can push slots past the 6 MB API-Gateway/Lambda limit. Confirmed image-capture points: **slot 6** (GRN received-goods photos + supplier certification documents) and **slot 11** (QC COA / food-grade certificates). These accumulate over time. Non-image blobs (OAB text, prices, customers, JSS, sales metadata) are well within limits for the current scale (~61 orders). Recommendation: ship blob-as-is for cutover (preserves exact behavior); if slot 6/11 approach the cap, extract images to a dedicated binary endpoint (S3 or a `document` LONGBLOB table) referenced by id from the blob. This is the one place a relational/separate API is likely to become genuinely required.
- API-Gateway/Lambda 6 MB request/response cap is a hard AWS limit (cannot be raised); it is the effective ceiling, not the LONGTEXT column (4 GB).
- Auditability: granular endpoints write `audit_log`; blob-path saves are not per-action audited (acceptable for the compatibility path).
