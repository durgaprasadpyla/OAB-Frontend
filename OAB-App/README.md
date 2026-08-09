# OAB-App — production frontend (reference monolith wired to the Spring backend)

This is the **live production frontend** (served at CloudFront `d3f68thcqn23fi.cloudfront.net`).
It is the reference Bloomflex OAB app (`oab1234.pages.dev`) with its UI **unchanged**; only the
data/auth layer is swapped so everything runs through the Spring backend + RDS (no Supabase,
no localStorage as source of truth, no hardcoded business data).

## Layout
- `reference/index.html` — the reference monolith (build input; UI source of truth).
- `reference/connectivity-guard.js`, `reference/logo-datauri.txt` — build inputs (guard removed at build; logo used for de-dup).
- `src/integration-early.js` — injected in `<head>`: fetch shim (repoint → backend, JWT, optimistic-lock versioning + 409, invoice-logo de-dup, boot-write guard), localStorage business-key block, boot-purge disable.
- `src/integration-late.js` — injected before `</body>`: real login/logout/session-restore, Dashboard super-admin elevation, material rates → `/api/rm-rates`, Users & Access → `/api/admin/users`, sales-rep login fallback.
- `build.js` — assembles `dist/index.html` (scrubs Supabase/dead-creds/baked-in JSS, injects config + layers).
- `dist/` — build output (git-ignored; reproducible).
- `MODULE-API-DB-MAPPING.md`, `VALIDATION-REPORT.md`, `FINAL-REPORT.md` — design + validation deliverables.

## Build & deploy
```bash
# Build for production (bakes the API Gateway base URL):
node build.js https://676yzsdb6d.execute-api.ap-south-1.amazonaws.com
# (or `node build.js http://localhost:8080` for local testing)

# Deploy to CloudFront/S3 and invalidate:
aws s3 cp dist/index.html s3://oab-frontend-318866803551/index.html \
  --content-type "text/html; charset=utf-8" --cache-control "no-cache, must-revalidate" --region ap-south-1
aws cloudfront create-invalidation --distribution-id ET2VMLKWVE5QW --paths '/*'
```

Rollback: the previous React shell is preserved at `s3://oab-frontend-318866803551/index.react-backup-20260809.html`
(its `/assets/*` remain in place) — restore it to `index.html` and invalidate.
