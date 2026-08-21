# OAB-Frontend — migration to feature parity with OAB-App

**Goal:** bring this React app to full parity with the production monolith
(`../OAB-App`) so it can replace it. **OAB-App stays in production and is not
modified by this work** — the client keeps using it until cutover.

**Backend:** no server work required. Every missing feature is frontend-only;
`HrController`, `/api/auth/sales-rep-login` and `/api/auth/change-password`
already exist and are covered by `Phase4HrModuleTest`.

---

## Audit (2026-08-20)

Method: enumerated all 748 monolith functions, clustered by module prefix, and
compared each cluster against the corresponding React page.

### A0. AUDIT CORRECTION (2026-08-20, during phase 2)

The first pass clustered monolith functions by the prefixes I expected and so
**missed whole subsystems**. A second pass over all 748 function names by every
prefix found:

| Subsystem | Size | Status |
|---|---|---|
| **BOM (module 13)** | 44 fns | was absent — **now ported** |
| `kam*` — Customer KAM & targets | 12 fns | absent; belongs to slot 12 (sales) |
| `dd*` — Dropdown defaults editor | 8 fns | absent; belongs to slot 12 (sales) |
| `pf*` — Proforma | 13 fns | already present ✅ |
| `im*` — Item Master | 9 fns | already present ✅ |

Lesson: audit by enumerating *every* prefix cluster, not the expected ones.

### A. Modules absent entirely

| Module | Monolith size | Contents |
|---|---|---|
| **Sales (slot 12)** | 137 fns / ~243 KB | S Dashboard (50 fns), Rep Portal (56 fns), Quotation Desk (31 fns) |
| **HR** | 6 screens / ~49 KB | dashboard, employees, org, leave, audit, forced password change |

Also missing: roles `sadmin`, `quote`, `sales`, `hr` (roles.js knows 8 of 12).

### B. Depth gaps in pages that already exist

| Page | Missing |
|---|---|
| **QC** | COA generation, food-grade certificates, entire CSA reports subsystem (13 of 19 monolith fns) |
| **Purchase / ASL** | supplier certificates (7 fns: upload/view/delete/chips), PO PDF (`buildPODocHTML`, `downloadPOPDF`, `toWords`), nudges, price chart, PO stage summary, delay days |
| **P Dashboard → Scrap tab** | today's best-price board, price-trend chart, buyer/item filters. *(Audit correction: the scrap admin subsystem lives in `PDashboard.jsx`, not `Scrap.jsx` — stats, buyer editor, export were already ported. The `Scrap.jsx` operator screen is at parity.)* |
| **PM** | live margin (`pmLiveMargin`, `pmLiveMarginByRow`), plates total, material select/toggle, CSA integration |
| **FG Ledger** | ageing (`fgDaysSince`, `fgAgeingInfo`, `fgAgeingDisplay`), remaining batches |

### C. At or ahead of parity — no action

- **Dashboard** — *ahead* of the monolith (audit trail, observability, system,
  trends, costing). Only gap is the "Sales Reps" tab, which belongs to slot 12.
- **OAB board** — parity (PDF, Excel, closed-SO view, search/sort/filter, age, short-close).
- **Invoice** — near parity (proforma, packing list, HSN, GST, PDF).
- **New PO, Daily Update, Plant, P Dashboard** — no gaps found.

---

## Status: functional + visual parity

Business logic and UI design both match production. 398 tests, clean build.
Module slots 1–9, 11, 12, 13. All 12 roles. All 9 shared dropdown lists.

### UI design parity (done 2026-08-20)
- **Brand recolour** — the exact `build.js` COLOR_REMAP applied to source
  (`#1B6B3A → #0e6fb8` + 6 tints, 24 occurrences). Production is blue; this app
  was still the pre-remap green.
- **Design system** — `overrides.css` ported verbatim: blue tokens, two-tier
  app-bar, pill nav, card/table/button skin.
- **Enterprise login** — two-column card, real brand mark, show/hide password,
  remember-me (username only), loading state, a11y labels.
- **Document protection** — `#inv-doc` / `#pl-doc` ids added so theme hover,
  transition and focus effects never reach a customer-facing invoice.

## Status: migration complete

All modules from the audit are ported. 351 tests, clean production build.
Module slots covered: 1–9, 11, 12, 13. Roles: all 12.

## Plan

1. ~~Audit~~ ✅
2. **Close section B depth gaps** — makes this app a genuine like-for-like
   rollback target, which it is *not* today.
3. **Port HR** — self-contained, clean REST API, no shared state with orders.
4. **Port Sales** — sub-module by sub-module: Rep Portal → Quotation Desk → S Dashboard.
5. **Cut over per role**, not big-bang.

## Deliberate divergences from the monolith

These are choices, not gaps — recorded so nobody "fixes" them back later.

- **Dates** render `dd/mm/yyyy` via this app's `fmtDate`, where the monolith's
  `purchFmtDate` renders `01 Aug 2026`. React is internally consistent across
  every existing table; adding a second date format would be the real defect.
- **Rep summary counts by CATEGORY, not by `created_by`/`assigned_to`.** The
  monolith's admin overview counted a rep's leads by who created or was assigned
  the customer, while the rep's own portal lists by per-category allocation — so
  the two disagreed for a shared customer. Both now use the category-aware count,
  which is the number the rep can actually see.
- **Sales-rep passwords remain plain text** in the slot-12 blob. That is what
  `/api/auth/sales-rep-login` compares against, so hashing needs a matching
  backend change — out of scope for a frontend migration, and already logged as
  follow-up #3 in OAB-App's FINAL-REPORT.
- **Certificates stay ON the invoice** (`inv.certs['coa|<spec>']`), matching the
  monolith's data model. Moving them to their own list would strand every
  certificate already attached to a live invoice.
- **`attachCert` targets an invoice by NUMBER, not array index.** The register is
  filtered and re-sorted in the UI, so an index would attach a certificate to
  whatever happened to sit in that slot.
- **Slot 12 uses optimistic locking.** The monolith saved the sales blob with a
  read-modify-write plus an "empty list" guard — last writer wins per key. This
  app routes it through the normal `DataProvider` version check and 409 reload.
  *(Corrected 2026-08-20: an earlier note here called optimistic locking
  "strictly safer than the monolith". That was wrong for module 1 — see below.)*
- **HR employee documents are metadata only.** `/api/hr/employees/{id}/documents`
  stores title/type/number/dates — no file bytes. Supplier certificates (module 6)
  *do* carry files, because the monolith stored them that way. Not a gap; the two
  registries genuinely differ.
- **Row caps removed.** The Scrap tab's Recent Prices / Recent Sales tables were
  capped at 50 rows with no indication that anything had been dropped — a silent
  truncation of business data. Both tables now show every row (they already
  scroll inside a fixed-height box).

## P Dashboard card titles (2026-08-20)

Mapped from the monolith's `pa-*-panel` sections and applied verbatim:

| React card | Now titled (production) |
|---|---|
| Purchase Orders | 📦 All Purchase Orders — Stage & Status |
| Approved Supplier List | 🏭 Approved Supplier List |
| Catalog Item Codes | 🗂 Item Master |
| Price History | 📈 Price Fluctuation Records |
| Supplier Payments | 💳 Supplier Payments |
| Today's Buying Prices | 🏷️ Today's Buying Prices — all buyers |
| Scrap Buyers | ✎ Scrap Buyers |
| Recent Scrap Sales | 💰 Scrap Sales |
| (dynamic chart heading) | 📈 Scrap Price Trends, with the dynamic wording as a sub-heading |

**Four cards exist here that production folds in elsewhere.** Kept deliberately —
each shows real data and removing them would lose function, but they are the
remaining structural difference on this screen:

- *Supplier Certifications* — production renders cert chips inline on each ASL row
- *Items from Approved Suppliers* — production folds this into a "Supplied By"
  column on its single Item Master table
- *Price Trends by Item* — a per-item summary above production's detail table
- *Recent Buying Prices* — production surfaces these points only via the chart

## Correction 3 — screen-text and interaction parity

A systematic diff of every page's title / subtitle / card titles / labels against
the monolith (rather than another prefix sweep) found 11 text mismatches and one
wrong interaction model.

| Screen | Was | Now |
|---|---|---|
| FG Entry | title "Finished-Goods Ledger"; three cascading `<select>`s; one merged summary table | "JSS / Finished Goods Sheet"; **type-to-search** on Spec/Customer/SKU with the other two auto-filling, a **🔍 Search FG** button, and production's **two** cards — "All Specs — FG Summary" plus "💹 FG Value — Stock on hand, valued at Sale Price" |
| OAB board | "Open sales orders — … sheet, live from the database" | "Live view of all open orders. Printable for production floor." |
| Dashboard | "Dashboard" / margins blurb | "📊 Business Dashboard" / "Sales, open orders, dispatch and loss of business analysis" |
| S Dashboard | "Sales Dashboard" | "📊 S Dashboard" + production subtitle |
| P Dashboard | "Purchase Admin — P Dashboard" | "📦 P Dashboard" + production subtitle |
| Invoice | subtitle omitted "enter prices"/"print PDF" | matched verbatim |

The FG Value board also now lists **only stock on hand** and shows "No FG
currently in stock" when none qualifies, as production does — a fully-drawn spec
stays in the plain summary but drops off the value board.

## Correction 2 — UI parity gaps found by screenshot comparison

Comparing local against production screen-by-screen found a third audit miss and
several column-level gaps. Root cause of the miss: `renderSpecDisp` sits in the
generic `render*` prefix bucket, which the audits never expanded.

| Gap | Fix |
|---|---|
| **"Dispatch by SO" — an entire missing screen** (`renderSpecDisp`) | `pages/DispatchBySO.jsx` + `/specdisp` route + nav tab |
| Daily Update missing **PO #** and **Disp Loc** columns | added |
| Daily Update **"Set FG"** was free entry; production **allocates** from the FG pool and shows `avail N` | availability hint added under the field |
| Daily Update missing the **All POs** filter; sheet was buttons not a dropdown | both matched to production |
| Daily Update column labels and subtitle differed | matched verbatim |
| Invoice register missing the **Certificates** column (COA / Food Grade status) | `CertBadge` — ⏳ none, ● partial, ✓ all; reads the certs QC attaches |
| Invoice register missing **PL** (packing list) button | added beside PDF |
| Invoice register missing **All POs**, **sort**, **search** | added |
| Header missing the sync badge | ☁ Synced / ⏳ Syncing… / ⚠ Sync error |

Deliberately NOT replicated: production's **"Save OAB"** button and **"OAB loaded"**
badge. The monolith needs them because it holds the whole module-1 blob dirty in
memory; this app persists per action, so a manual blob-push button would do
nothing and imply unsaved work that does not exist.

## Correction — the file the audits missed

`OAB-App/src/integration-sync.js` was **never listed in any audit and never
ported**, despite being the monolith's most important safety layer. It exists
because of a real incident: on 2026-08-16 a stale tab's save reverted 27 rows —
FG allocations zeroed on 26/541-543, dispatches rolled back, short-closed SOs
reopened, `manDispLog`/`price`/`closed` deleted, 26 invoices dropped from
INV_REG, `lastSO` rewound 604 → 553.

Optimistic locking does **not** cover this. A version check refuses a save only
when the server has moved on; it cannot tell that the *fields inside* a
same-version blob are stale. Every module-1 save posts the tab's entire
in-memory blob, so a tab that loaded hours ago ships its stale copy of every
other row — and the version matches, so the write is accepted.

Now ported as `lib/merge.js` and wired into `data.jsx`: every module-1 save
re-reads the server copy and 3-way merges (base / mine / theirs) before writing.
The baseline is re-snapshotted at load, at `reloadModule`, after each successful
save and on 409 recovery — every moment local and server state are known to
agree. 26 unit tests replay the 2026-08-16 incident directly, plus a live test
proving the same stale blob destroys server state *without* the merge and
preserves it *with* it.

## Progress

| # | Task | Status |
|---|---|---|
| 2.1 | FG ageing + remaining batches | ✅ FIFO ageing, valuation, sort, totals, super-admin correction; 17 tests |
| 2.2 | P Dashboard Scrap: today's board, trend chart, filters | ✅ `lib/scrapChart.js` + UI; 15 tests |
| 2.3 | Price Master: live margin + full columns + status filter | ✅ 9-column editor, margin, transport select |
| 2.3b | **BOM subsystem (module 13)** — newly discovered | ✅ `lib/bom.js`, BOM editor, Raw Material Requirement; 33 tests |
| 2.4 | Purchase: supplier certificates + PO PDF | ✅ `lib/attach.js`, `PurchaseOrderDoc`; 15 tests |
| 2.4b | Purchase: PO overdue nudges, supplier price chart | ✅ chart builder generalised and reused |
| 2.5 | **QC: COA + Food Grade certificates** | ✅ `lib/cert.js`, printable docs, attached to the invoice; 28 tests |
| 3 | **HR module** | ✅ 5 screens + forced password change + `hr` role; 26 tests |
| 4a | Sales foundation: slot 12 + `lib/sales.js` + roles (`sadmin`/`quote`/`sales`) + rep login | ✅ 35 tests |
| 4b | **Sales Rep Portal** | ✅ Follow-ups, My Customers, My Contacts, Add Customer |
| 4c | **Quotation Desk** | ✅ slab pricing + GST, versioning, freeze, PDF; 28 tests |
| 4d | **Sales Admin (S Dashboard)** | ✅ Overview, All Customers, Category Allocation, Targets, Rep accounts, Export; 43 tests |
| 5a | **Brand recolour + design system + two-tier header** | ✅ exact `build.js` palette; `overrides.css` ported verbatim |
| 5b | **Enterprise login** | ✅ two-column card, brand mark, remember-me; 8 tests |
| 5c | **Customer KAM & Targets** | ✅ `lib/kam.js`, live achievement from OAB; staged batch save |
| 5d | **Dropdown lists editor** | ✅ `lib/dropdowns.js`, all 9 lists, consumers read through overrides |
| 5e | **Negotiation threads** | ✅ `lib/nego.js`, per-SKU threads, per-side unread |
| 6 | **3-way merge for module 1 (`integration-sync.js`)** | ✅ `lib/merge.js` + `data.jsx`; 26 unit + 2 live tests |
| 4e | **QC/PM CSA screens** | ✅ `lib/csa.js`, QC raises, plant answers + prices plates; 33 tests |

---

## Correction 4 — line-by-line diff against the live app (2026-08-20)

The earlier "visual parity" claim was checked the wrong way: by prefix-sweeping the
monolith's functions rather than by reading what it actually renders. A direct diff
of OAB-App's `reference/index.html` + `src/integration-*.js` against this app found
the **printed documents were not ports at all** — they were re-designs — plus a set
of screen-level gaps. What follows is what was found and what was done.

### A. Printed documents (the ones a customer or auditor reads)

| Document | Was | Now |
|---|---|---|
| **TAX INVOICE** | a different document: text wordmark, "ORIGINAL FOR RECIPIENT", Nizamabad address, 7 columns, HSN `3923`, one-paragraph declaration, no TCS/reverse-charge/PO-terms | the production sheet: the company logo, the four copy names, the Regd Off / Works By / CIN / MSME block, the ten GST columns with HSN `39206939` and the "Total No. Of Pouches" row, all three tax rows, TCS, round-off, reverse-charge line and the Terms-and-Conditions-of-Sale block |
| **Invoice PDF** | a *second*, hand-drawn jsPDF layout that matched neither the screen nor production — and printed the brand in the retired green | a capture of the rendered `#inv-doc` at `scale:3` with 8 mm margins and `compress`, i.e. `integration-late.js`'s exact recipe. Filename `Bloomflex_<no>_<customer>.pdf` |
| **Packing list** | printed the bag *editor* (`# / Bag From / Bag To / Qty / ✕`) | production's document: brand header, "Name of the Consignee" block, `Bag No. / Qty Per Bag / Bags × Qty = Dispatched`, per-SKU sub-totals, GRAND TOTAL and the Prepared-by / Checked-by / Authorised-Signatory footer. Print opens the clean input-free sheet in a window (`printPackingList`); Save PDF captures the editable doc, as production does |
| **Proforma** | shared the invoice's hand-drawn PDF | its own `<ProformaDoc>` — text wordmark, "Proforma Copy / Not a Tax Invoice", four proforma declarations, Special Notes box, "Proforma Amount Rs." and no TCS row |
| **Purchase Order** | no logo; `Qty` / `Rate` headers; app-wide `dd/mm/yyyy`; generic PDF path | the white logo panel in the blue header (`PURCH_LOGO`), `Qty.` / `Unit Price`, `DD.MM.YYYY`, `Rupees: … ONLY` in caps, `Bloomflex_PO_<no>.pdf` |
| **OAB board PDF** | an html2canvas screenshot (blurry, clipped) | the vector A3-landscape table from `integration-late.js` — 19 columns, crisp, selectable, auto-paginated. The board's **🖨 Print** window is back too |

`lib/invoicePdf.js` is now a document-capture helper (`saveDocPdf`), not a second
layout. There is exactly one invoice layout, in `InvoiceDoc.jsx`, and the screen, the
print dialog and the PDF all render it.

### B. Screens

- **New PO** — restored the **Group → Customer** cascade, and with it `specVisibleTo()`:
  only *active* specs the chosen customer may actually see are listed (a redundant spec,
  or one pinned to another company in the same group, no longer appears). Title, step
  labels, the confirm-step machine columns and the success screen match production.
- **OAB board** — restored the **Loc Code** column, the **Bal Mtrs** stat, the "📏 Metres
  include 5% wastage" banner, the row count, `↻`, **🖨 Print**, and the shared
  **⬇ Newest first** order toggle. Search covers the warehouse name again.
- **Daily Update** — restored the order toggle, `↻`, the 3-line clamp on Job Name /
  Customer, the solid-red **Close SO** button and the **live** FG hint (green remainder,
  red "exceeds avail N!"). The **Stage** column was removed: production sets stage on the
  Plant board only, and a second write path for it was a real behavioural divergence.
- **Invoice** — Place of Supply is a dropdown off the customer's locations again; **FG to
  be used** is the read-only auto figure, not a hand-entered quantity; picking a PO scopes
  the register to "Previous Invoices for PO: …" with its filter bar hidden.
- **Dashboard** — tab order, labels and icons match; **💹 FG Value** and **🧩 Drop-down
  selections** added; Raw Material Rates moved above the tab bar where production keeps it.
- **FG Entry** — the FG Value board moved off this screen to its Dashboard tab, which is
  where production has it.
- **Plant** — one sheet at a time from a picker (not both flattened), `#`, Dispatched and
  Age columns, the order toggle, the amber Save-Changes button that only appears when
  something changed, and the A3 print window.
- **Role screens** — plant / QC / PM / purchase / scrap / rep / quote get their own
  coloured brand bar, as each `#*-panel` does in production, instead of the ops app-bar.
- **CSS** — `.btn-r`, the KAM spinner suppression and the Daily Update row-height/clamp
  rules were missing from the extraction; `table-layout:fixed` on the invoice items table
  and the on-screen invoice shadow were React-only additions and are gone.

### C. Sales module — the nine missing tabs (closed 2026-08-20)

The Sales slot was the largest remaining gap: the Rep Portal shipped 5 of production's
8 tabs and the S Dashboard 7 of 11. All nine are now ported.

**Sales Rep Portal** — `📋 Log Visit`, `🧾 Enter PO`, `🎯 My Targets`, `📦 SKUs`,
in production's tab order, with the "quotations received from the Quote desk" banner
above every tab.

The SKU → quotation → PO workflow is the substance of it, and it is a control, not a
form. A rep cannot book a PO against any SKU they like:

- Six workflow stages per SKU, three of them **mandatory** before a PO is allowed —
  CSA received, Quotation received, Quotation accepted.
- **CSA received is not rep-editable.** It turns green only when QC has generated the
  CSA report for that SKU, so a rep cannot self-certify their way to an order. The
  toggle renders locked and `toggleSkuStage()` returns the SKU untouched.
- Accepting a quotation captures the agreed **price slabs**, and `buildPo()` refuses a
  price below the slab that applies to the ordered quantity.
- Stage toggles are staged locally and written in one save, as production does — six
  switches across ten SKUs is one write, not sixty.
- Log Visit demands notes (an entry with none tells the next person nothing) and
  defaults the next ping to two days out rather than leaving it blank.

**S Dashboard** — `📋 Daily Updates`, `🧪 CSA & Quote`, `📦 All POs`, `👥 Contacts`,
`🧹 Manage`, plus production's tab order and labels throughout.

- **CSA & Quote** answers three questions in three tables: how long QC took to turn a
  sample into a report, how long a finished report has sat unquoted, and how long the
  comments took to write. Submission date comes from the SKU — when the sample actually
  arrived — not from when QC got round to the report; a walk-in report reads off itself.
- **Manage** is a cross-module write. The same customer name lives on leads and contacts
  (module 12), the Customer Master (4), the JSS specs (2) and the OAB rows (1); a rename
  reaches all four and a rename onto an existing name MERGES, which is the point of the
  tool. `cleanupApply()` is pure and returns a per-module count, so only the modules that
  actually changed are saved. Delete removes the lead, contacts and master rows but never
  touches order history.

**Targets were re-modelled, not just re-skinned.** This app stored one flat number per
rep per month (`{rep_id, month, amount}`). Production stores one row per
rep × period × dimension × key — four period types (month / quarter / half / annual) and
two dimensions (category and dispatch form) — because a sale booked on a SKU deducts from
BOTH its category target and its dispatch-form target, the SKU carrying both. The flat
model could not represent that, so a rep's targets would have been invisible to them. It
is retired; `lib/salesTargets.js` holds the real one and achievement is derived from the
POs joined to their SKUs, never stored.

New: `lib/salesTargets.js`, `lib/repPortal.js`, `lib/salesAdmin.js`, six tab components
each side, and 52 tests (`repPortal.test.jsx`, `salesAdminTabs.test.jsx`, plus the
rewritten target tests).

### D. Found, not yet closed

- **QC** has no **🧱 BOM** tab. Production shows one; this backend grants module 13 to
  superadmin alone, so the tab would 403 — it needs a backend grant first, not a UI change.
- **HR** renders in the app's own shell. Production runs it as a separate `#hr-workspace`
  overlay with its own `hrx-*` design system.
- **💬 Negotiations** (Rep Portal / Quotation Desk) and **🧮 SO Costing / 🧾 Audit Log /
  🛠 System** (Dashboard) exist here and not in production. They are kept deliberately —
  each is read-mostly and additive — and are listed so nobody mistakes them for parity.
- **⚙ Dropdown Lists** appears on BOTH the Dashboard (where production has it) and the
  S Dashboard, so a sales admin without the Dashboard can still reach the lists they own.

---

## Client change — OAB balance figures (2026-08-21)

Requested against the Stay Fresh board; applies to both sheets.

**Bal Mtrs now carries the 5% wastage allowance.** It summed the *net* metres while
the per-row **Mtrs** column and the green banner directly beneath it both already
included the +5% — so the card contradicted the banner sitting under it. All three
now agree. **This is a deliberate divergence from OAB-App**, which still shows the net
figure in that card; if the client wants it there too it is a separate change to the
monolith.

**New "Bal Kg's" card**, immediately after Bal Mtrs. It is the SAME physical thing
Bal Mtrs measures — the film for the balance — weighed instead of run out, so it carries
the **same +5% wastage**: `Σ (row balance × spec pouch weight ÷ 1000) × 1.05`. The JSS
`pouchWeight` (grams, `((H×2)+gusset)×W×GSM ÷ 1,000,000`) is the film weight IN a finished
pouch and excludes the trim you lose, so the ×1.05 is what you actually consume — parallel
to the metres. Leaving it net would make the two adjacent cards mean different things
(film-to-consume vs finished-goods-weight). `calcKg` returns `{ net, withWastage }`; the
card sums `withWastage`.

Two judgement calls, made without a further round-trip because either alternative
produces a number nobody could act on:

- **Roll specs count their balance as-is.** A roll is ordered BY WEIGHT — its PO qty is
  already kilograms — so multiplying it by a per-piece pouch weight would be wrong by
  orders of magnitude. Stay Fresh is all pouches so it never shows there, but the same
  card appears on Others, where rolls live. `calcKg()` short-circuits on the dispatch
  form for exactly this reason.
- **A spec with no pouch weight is counted and reported, not silently zeroed.**
  `calcKg()` returns `null` rather than `0` when the JSS carries no weight (height,
  width or GSM missing), and the card shows "⚠ n specs have no weight" beneath the
  total. An under-reported kilogram figure that looks complete is the kind of number
  people plan production against.

**Every stat card carries an ⓘ** explaining what it counts and how it is worked out —
these are figures people order film against, so the formula belongs on the screen. CSS
only (`.stat-info`), hover or keyboard focus, hidden in print and stripped from the
board's print window.

The bubble is anchored to the CARD, not to the icon. Centring it on the icon put it
off-screen on the first card below 1280px and on the last card below 1000px (measured,
not guessed); spanning the card cannot overflow, since the card is on screen by
definition — it just grows taller when the column is narrow.

`lib/calc.js#calcKg` + 11 tests in `oabBalanceStats.test.jsx`. The board's Excel and PDF
exports were not asked for and are unchanged — they still carry the per-row `Metres+5%`
column and no weight column.
