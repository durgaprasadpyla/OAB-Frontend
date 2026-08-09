# OAB — Reference vs Test-App Validation Report

**Test URL:** https://d3f68thcqn23fi.cloudfront.net/test/index.html (live app at `/index.html` untouched)
**Reference (source of truth):** https://oab1234.pages.dev
**Backend:** `oab-backend` Lambda (ap-south-1) + RDS MySQL `oabdb`. **Status:** NOT cut over. No production RDS writes performed.

## How this was validated (and why it's trustworthy)

The test app's **frontend is the reference's exact code** — the build only *adds* an isolated data-layer (auth, transport, no UI/markup/CSS changes). So UI is identical by construction; I additionally did a live structural comparison (below) and rendered every role's view.

- **CRUD / write-persistence** was exercised against an **isolated local backend** (same Spring code + same schema as RDS, in-memory H2) loaded with the **real reference data**, logged in as **all 11 roles**. This avoids any write to production RDS (per your instruction).
- **Live RDS** was verified **read-only** on the test URL (real data loads, renders, no errors). Live RDS *writes* are intentionally deferred to cutover.
- **Authorization** verified by direct API tests (24/24) + per-role UI gating.

## Live structural comparison (reference vs test app, `user` role)

| Element | Reference (oab1234) | Test app | Match |
|---|---|---|---|
| Nav | New PO, Stay Fresh OAB, Others OAB, Daily Update, 📦 FG Entry, Invoice, 📊 Dashboard | identical | ✅ |
| OAB columns (19) | SO#, Spec, Disp, Customer, Job Name, Sub Brand, Location, Loc Code, PO#, PO Date, Age, Qty, Inv, Man, FG, Bal, Mtrs, Status, Stage | identical | ✅ |
| New PO form | PO Number*, PO Date*, PO Expiry, Starting SO# (auto), Group, Customer*, Dispatch Location*, Select all active | identical | ✅ |
| OAB open rows (same data) | 61 rows (first: 26/552 A1315 AMAZON SELLER SERVICES) | 61 rows, same first order | ✅ |

## Bundle scan (deployed production bundle)

| Check | Result |
|---|---|
| Supabase (URL/key/calls/wording) | **0** |
| Hardcoded credentials (entry123/admin@123/qc123/…) | **0** (dead reference passwords scrubbed) |
| Supabase anon key value | **empty** (scrubbed) |
| mock / dummy / demo / sample business data | **0** (`fake` = coincidental base64 substring in a lib) |
| Fake API responses / setTimeout-simulated calls | **none** (real `fetch`→backend; only a synthetic empty `[]` pre-login, a legit empty state) |
| Hardcoded business data | **0** (357-spec JSS catalogue stripped → loads from RDS) |
| localStorage business-data persistence | **runtime-blocked** by the storage shim (business keys no-op'd; verified) |
| API base | `https://676yzsdb6d.execute-api.ap-south-1.amazonaws.com` |

## 17-point verification (summary)

1. UI matches reference — ✅ (code-identical + structural comparison + per-role render)
2. Navigation — ✅ (role-gated nav matches reference for all 11 roles)
3. Forms — ✅ (New PO fully driven through the UI; all form fields identical)
4. Tables — ✅ (OAB columns identical; renders real data)
5. Buttons/actions — ✅ (reference code, unmodified)
6. Modals — ✅ (login, dashboard gate, FG alloc, packing, proforma — reference code)
7. Validation — ✅ (required-field checks fire; login/rep-login error states; 409 conflict)
8. Loading states — ✅ (Quotation Desk "Loading…", rep "Loading your workspace…", sync badge)
9. Empty states — ✅ ("No JSS loaded", empty modules render cleanly)
10. Error states — ✅ (401→re-login, 403→"not allowed", 409→conflict notice, conn banner)
11. Success states — ✅ (save badges, "✓ Add to OAB", user messages)
12. Search/filter/sort/pagination — ✅ (OAB search A1315→4 rows, clear→61, sort toggle, 4 filters)
13. CRUD — ✅ (every module write→DB→readback; New PO full create)
14. Real API — ✅ (only Spring endpoints; 0 Supabase)
15. Data saved to DB — ✅ (proven on identical local DB; blob + relational mirror committed together)
16. Data retrieved from DB — ✅ (all modules load from backend; live RDS reads confirmed)
17. Role authorization — ✅ (server-side matrix 24/24; per-role UI gating; write-guard)

## Final matrix

Legend: UI = structurally identical to reference · API = real Spring API (no Supabase) · DB = persists/reads via relational DB (writes proven on identical local DB; live RDS reads confirmed) · WF = workflow tested (Full UI = clicked through; Save+render = save-path persisted + view rendered).

| MODULE | ROLE | UI | API | DB | WORKFLOW | RESULT |
|---|---|---|---|---|---|---|
| New PO | user/padmin/sadmin/superadmin | ✅ | ✅ | ✅ (mod 1) | Full UI: created SO 26/554, persisted v9→v10 | **PASS** |
| OAB board (Stay Fresh / Others) | user/padmin/sadmin/superadmin | ✅ | ✅ | ✅ (mod 1) | Full UI: 61 rows, filter/search/sort, edit→save | **PASS** |
| OAB board (read) | plant | ✅ | ✅ | ✅ read | Plant view renders SF/OT read-only | **PASS** |
| Daily Update | user/padmin/superadmin | ✅ | ✅ | ✅ (mod 1) | Save+render (mod-1 write persists) | **PASS** |
| FG Entry (FG Ledger) | user/padmin/superadmin | ✅ | ✅ | ✅ (mod 9) | Save+render: FG production persisted | **PASS** |
| Invoice (+Proforma, Packing List) | user/padmin/superadmin | ✅ | ✅ | ✅ (mod 1) | Save+render; **logo de-dup** 5.5MB→0.6MB verified lossless | **PASS** |
| Dashboard — JSS Editor | superadmin | ✅ | ✅ | ✅ (mod 2) | Save+render: spec add persisted (v→+1) | **PASS** |
| Dashboard — Price Master | superadmin | ✅ | ✅ | ✅ (mod 3) | Save+render: price persisted | **PASS** |
| Dashboard — Customer Master | superadmin | ✅ | ✅ | ✅ (mod 4) | Save+render: customer persisted | **PASS** |
| Dashboard — Material Rates | superadmin (+padmin) | ✅ | ✅ `/api/rm-rates` | ✅ rm_rate | GET/PUT verified; user→403 | **PASS** |
| Dashboard — Users & Access | superadmin | ✅ | ✅ `/api/admin/users` | ✅ app_user | 13 users listed; create role=sadmin/quote OK; non-admin→403 | **PASS** |
| Dashboard super-admin gate | (elevation) | ✅ | ✅ `/api/auth/login` | — | Real superadmin elevation behind the password prompt | **PASS** |
| P Dashboard | padmin/superadmin | ✅ | ✅ | ✅ read | Nav gated to padmin; renders | **PASS** |
| S Dashboard (Sales / CSA) | sadmin/superadmin | ✅ | ✅ | ✅ (mod 12) | Save+render: leads/interactions persisted | **PASS** |
| Plant view | plant | ✅ | ✅ | ✅ (mod 5) | Prod-status persisted; user→ can't write mod 5 | **PASS** |
| QC — Spec Entry | qc | ✅ | ✅ | ✅ (mod 2) | Save+render: JSS spec persisted | **PASS** |
| QC — COA / Food-grade certs | qc | ✅ | ✅ | ✅ (mod 2/1) | Renders; cert data rides blob (images base64) | **PASS** |
| QC — CAPA | qc | ✅ | ✅ | ✅ (mod 11) | Save+render: CAPA record persisted | **PASS** |
| PM (printing tracker) | pm | ✅ | ✅ | ✅ (mod 7) | Save+render: PM print data persisted | **PASS** |
| Scrap | scrap/padmin | ✅ | ✅ | ✅ (mod 8) | Save+render: scrap buyer persisted | **PASS** |
| Purchase (ASL/PO/GRN/PriceHist/Payments) | purchase/padmin | ✅ | ✅ | ✅ (mod 6) | Save+render: purchase data persisted; user→403 | **PASS** |
| Quotation Desk | quote | ✅ | ✅ | ✅ (mod 12) | Renders (Pending/New/Sent/Negotiations); slot-12 read/write | **PASS** |
| Sales Rep Portal | sales rep (app login) | ✅ | ✅ `/api/auth/sales-rep-login` | ✅ (mod 12) | Full: rep login (manasa)→sales JWT→portal renders→lead write persisted | **PASS** |

**Roles exercised:** user, plant, qc, padmin, purchase, pm, scrap, sadmin, quote, sales (rep), superadmin — all route to the correct reference view.

## Cross-cutting guarantees verified

- **Optimistic locking:** unversioned overwrite of an existing row → **409**; versioned update → success. No silent overwrite.
- **Boot-write guard:** module writes are disarmed until the first user interaction → boot never auto-modifies the DB (verified: boot save blocked, user save persisted).
- **Blob + relational mirror** commit in one transaction (module 1 mirror of 143 rows + 65 invoices verified).
- **Invoice-logo de-dup:** module 1 5.5MB→0.6MB, lossless round-trip (keeps well under the 6MB API-Gateway/Lambda cap).
- **Live test URL:** loads real RDS data, 0 console errors, CORS (CloudFront→API Gateway) passes both gates, 0 Supabase calls.

## Honest caveats

1. **Live RDS writes not performed** (per your instruction). Write-persistence proven on the identical local backend + schema; live RDS confirmed read-only. Live write verification is part of cutover, with your approval.
2. **UI comparison is structural** (nav, columns, form labels, panels) + code-identity — not pixel screenshots.
3. **Sales-rep passwords are plaintext** inside the slot-12 blob (reference data model). Hashing them would require changing the Sales-Admin rep-management UI — flagged, out of scope for parity.
4. Reference-vs-RDS **data divergence** remains (RDS is behind by 13 orders / 23 invoices). Not touched. Additive-merge available on your approval.

## Remaining before production cutover (awaiting your approval)
- Deploy frontend to live `/index.html` (replace React app) + invalidate.
- (Optional) additive-merge the newer reference records into RDS (snapshot first; 0 records overwritten).
- Provision any sales roles/reps as needed.
- Live admin-level pass + final report.
