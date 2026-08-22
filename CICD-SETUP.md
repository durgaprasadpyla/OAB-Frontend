# CI/CD — auto-deploy to S3 + CloudFront on push

Pushing to **`main`** builds this React/Vite app and publishes it as the **live
frontend** via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
After setup, your only manual step is `git push` — no manual build/upload/invalidate.

Live URL: **https://d3f68thcqn23fi.cloudfront.net**

## What the workflow does (on push to the production branch)

1. Confirms at runtime that the pushed branch is the repo's **actual default
   branch** (it does not assume `main`); other branches are skipped.
2. Checkout + Node 20, `npm ci`.
3. `npm test` (Vitest) — a failing test **blocks** the deploy.
4. `npm run build` — Vite bakes **`VITE_API_BASE`** from
   [`.env.production`](.env.production) (the API Gateway URL) into `dist/`.
5. GitHub assumes AWS IAM role **`oab-cicd-frontend`** via **OIDC** — no AWS keys
   stored in GitHub, no secrets to manage.
6. `aws s3 sync dist/ s3://oab-frontend-318866803551/ --delete`.
7. `aws cloudfront create-invalidation … ET2VMLKWVE5QW /*` and **waits** for it to
   complete.
8. Tests the live URL — must return **HTTP 200** and reference the built JS
   bundle, or the run **fails**.

## Setup status

- **AWS: DONE.** The GitHub OIDC provider and the least-privilege role
  `oab-cicd-frontend` (may only write this one S3 bucket + invalidate this one
  CloudFront distribution) already exist in account `318866803551`. The workflow
  references the role ARN directly.
- **You still need to:** commit + push this `.github/workflows/deploy.yml`, and
  make sure **Actions is enabled** (Settings → Actions → General).

## Notes

- Change the backend URL: edit `.env.production` (`VITE_API_BASE`) and push.
- Manual run: **Actions → Deploy frontend to S3 + CloudFront → Run workflow**.
- This bucket + distribution serve production, so a push to `main` goes straight
  to users. Use a branch + PR for anything you don't want live yet.
