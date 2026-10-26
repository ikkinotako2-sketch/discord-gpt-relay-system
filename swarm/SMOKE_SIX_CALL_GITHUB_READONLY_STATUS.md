# Discord six-call GitHub safety snapshot — GET-only / NO LIVE

Date: 2026-10-26. Stacked on Draft #28 -> #27 -> #26 -> #25 -> #24 -> #23 -> #21.

This module has no production Worker, Cloudflare token, OAuth secrets, D1 mutations, release, inference, or GitHub write methods. It accepts no arbitrary URLs, and only reads the exact public repository via HTTPS GET.

## What the offline-staged reader inspects

1. Exact `main` SHA before and after a read-only sweep. Any unexpected main change or missing/invalid API response aborts with BLOCKED.
2. All five GitHub Actions active statuses: `queued`, `in_progress`, `waiting`, `pending`, `requested`, each from `GET /actions/runs?status=...&per_page=1`. Strict nonnegative integer totals only; any active count is blocked.
3. The correct open Draft/unmerged state and exact stacked head/base branches of PRs #21, #23, #24, #25, #26, #27 and #28. The top PR's head SHA must equal the pinned expected SHA. This is the *current unmerged draft stage*, NOT permission to merge or deploy.
4. Total read duration no more than 5 minutes and no clock rollback.
5. Result is always `authorizesLiveActions:false`, `authorizesDeployment:false`, `authorizesInference:false`. Even `GITHUB_ZERO_ACTIVE_UNMERGED_DRAFTS` is not a live greenlight. GitHub does not verify Cloudflare release control, upstream quota, D1 status, or signed Discord requests.

## Safety limitations

GitHub GET snapshots are not atomic with Cloudflare updates. Their status may change between successive calls. The reader is not production-wired and cannot freeze Dashboard, Wrangler, or other CI. Do not substitute this GET-only analysis for real independent release serialization.

The project still requires real current-day account-wide Neurons, model permissions, live D1/Watchdog safety and newly scoped owner approval before the first six-call live smoke.

**No remote modifications / no actual AI attempts; production BLOCKED (0/6).**
