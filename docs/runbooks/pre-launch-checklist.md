# Pre-launch checklist — the operational gates of phase 13

Technical plan §10, §13, §15 (row 13 and 14), §0ak; phase 13's lock pass
(2026-09-05). **This is the one canonical register** of what the hosted projects
must be configured with, and what must be verified by hand, before Klingenberg
Food's website opens. The other runbooks — [backups.md](backups.md),
[restore.md](restore.md), [production-security.md](production-security.md),
[monitoring.md](monitoring.md) — hold the *procedures*; they link here for the list,
and nothing on this list is repeated there in different words.

It holds operational prerequisites only. The final copy, the photography, the map
asset, the domain's DNS and the SEO verification are phase 14's and §15's own rows
and are deliberately not here.

## How to read the status column

| Status | Meaning |
|---|---|
| **Repository proven** | The repository's own tests prove the behaviour against the local stack, on every CI run. Nothing to do at launch beyond keeping CI green. |
| **Requires production infrastructure** | A value or a setting that lives in Vercel, Supabase, GitHub or the destination provider. The repository cannot set it and cannot prove it is set. |
| **Requires one manual pre-launch verification** | A step a person performs once against the real projects, and records with a date in the launch notes. Until it is done, the capability is **unproven in production**, however green CI is. |

**Status on 2026-09-06 (phase 14C).** Every "Requires production infrastructure" row
below is still open, and measurably so: no Supabase production project, no Vercel
project, no GitHub repository, no Resend account, no Sentry project and no backup
destination exists yet. The inventory and the ordered manual setup groups that close
them are in [launch-notes.md](launch-notes.md) §9. The "Repository proven" rows were
re-certified on the same date by a full local run (§9 there, and technical plan §0ar).

Nothing below is marked done. A row is closed by writing the date and the release
beside it in the launch notes — [launch-notes.md](launch-notes.md) §7, by row id —
never by editing this file. Phase 14's own items (assets, the Owner bootstrap, the
content load, the migration run, the domain wiring, training) are the other
sections of that document; they are not repeated here.

## 1. Supabase

| # | Gate | Status | Procedure |
|---|---|---|---|
| S1 | Production is a **Pro** project in `eu-central-1` (never Free: paused projects, no backup guarantee — §10a, decision 7) | Requires production infrastructure | Supabase dashboard |
| S2 | **Managed daily backups are on** for the production project; PITR is the owner's decision (§13 item B, default off) | Requires production infrastructure | Dashboard → Database → Backups. Layer 1 of [backups.md §1](backups.md#1-two-layers-two-failures); the off-platform copy does not replace it |
| S3 | **Auth rate limits** reviewed: sign-in/token per IP, e-mails per hour, OTP verifications per IP, anonymous sign-ins off | Requires one manual pre-launch verification | [production-security.md §2](production-security.md#2-supabase-auth-rate-limits-the-projects-auth-settings). Record the values chosen |
| S4 | **Auth Site URL and additional redirect URLs** point at the production domain; signup disabled; `supabase/config.toml` is the reference | Requires production infrastructure | Dashboard → Authentication → URL Configuration |
| S5 | **Custom SMTP (Resend)** configured for invitations and password resets, with the sending domain verified (§10c; §13 item D for the DNS) | Requires production infrastructure | Dashboard → Authentication → SMTP; the Resend account |

## 2. Backup and recovery (phase 13A)

| # | Gate | Status | Procedure |
|---|---|---|---|
| B1 | **Off-platform provider chosen** — Cloudflare R2 recommended, Backblaze B2 equally fine (§13 item A). The repository supports any S3-compatible destination; it has not chosen one | Requires production infrastructure | [backups.md §3](backups.md#3-where-recovery-points-live) |
| B2 | **Private EU bucket** created; no public access, no public listing; encryption at rest is the provider's default | Requires production infrastructure | backups.md §3 step 1 |
| B3 | **Bucket-scoped credentials** — read, write, list; no delete where the provider allows a key without it | Requires production infrastructure | backups.md §3 step 2 |
| B4 | **Two lifecycle rules by prefix**: `<prefix>/weekly/` expires after 63 days, `<prefix>/monthly/` after 190 days; `latest.json` never expires; hidden/previous versions covered if the provider keeps them | Requires production infrastructure | backups.md §3 step 3; the numbers are `RETENTION` in `scripts/backup/lib/manifest.mjs` |
| B5 | **Protected GitHub environment `backup`** holding `SUPABASE_DB_URL` (the session pooler string, port 5432), `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the `BACKUP_S3_*` values — and nowhere else in GitHub | Requires production infrastructure | [backups.md §5](backups.md#5-secrets-and-where-they-live) |
| B6 | **One successful shipped backup by hand**: Actions → Backup → Run workflow; `latest.json` appears at the destination and names the run | Requires one manual pre-launch verification | [backups.md §6](backups.md#6-running-a-backup-by-hand). Repeat after any credential rotation |
| B7 | **Hosted scratch-project restore drill** — the repository proves the restore against the local stack only ([restore.md §9](restore.md#9-rehearsal)). Once: (1) create a temporary hosted scratch project compatible with production (same region, Pro or Free is immaterial for a rehearsal); (2) fetch one real recovery point from the destination; (3) restore the database with `npm run backup:restore:production` (the scratch project's values in `.env.operator.local`) after `supabase db push` at the backup's migration version; (4) restore Storage (the same command); (5) verify representative workflows — the six public pages render the restored content, an owner signs in and completes a price change and a sell-out, `/admin/brugere` lists the accounts, the image library shows every photograph; (6) verify Auth recovery according to the supported method — the accounts sign in with their pre-backup passwords, or, if the Auth server's column set has moved, the `--skip-auth` fallback and the re-invitations ([restore.md §5](restore.md#5-what-happens-to-auth)); (7) verify bucket privacy (a private original is not reachable through a public URL), RLS (the anon role reads no draft) and a trusted function (a sell-out writes its audit row); (8) **destroy the scratch project** afterwards | Requires one manual pre-launch verification | [restore.md](restore.md), start to finish, with the scratch project's values |
| B8 | **Failed-workflow notification** reaches a person: the repository owner's GitHub notification settings deliver failed scheduled-run e-mails | Requires one manual pre-launch verification | [backups.md §8](backups.md#8-failure-behaviour). The backup job does not use Sentry, by decision |

## 3. Rate limiting (phase 13B)

| # | Gate | Status | Procedure |
|---|---|---|---|
| R1 | **`RATE_LIMIT_SECRET`** set in the Vercel project for Production (and Preview): at least 32 random characters (`openssl rand -hex 32`). A Vercel deployment without it refuses every sign-in and reset request and names the variable in the function log; nothing generates one in its place | Requires production infrastructure | [production-security.md §1](production-security.md#1-the-rate-limit-secret-vercel) |
| R2 | The deployment **is Vercel**. Only Vercel is a recognised deployment: there the address headers are believed and the secret is required. Another host is not supported without a header-trust and secret decision in code first | Requires production infrastructure | [production-security.md §3](production-security.md#3-vercel-the-trusted-client-address) |
| R3 | The application throttle and the reservation are | **Repository proven** | `supabase/tests/029`, `030`; `tests/integration/sign-in-throttle.test.ts`; the `security` Playwright project |

## 4. Security headers (phase 13B)

| # | Gate | Status | Procedure |
|---|---|---|---|
| H1 | The six headers on every response, beside the caching, with no `unsafe-eval` in production | **Repository proven** | `tests/unit/security/headers.test.ts`, `tests/e2e/security-headers.spec.ts` |
| H2 | **HSTS `includeSubDomains`** — a decision the repository cannot make: it requires knowing that every subdomain of the launch domain is HTTPS (§13 item D). The shipped policy is the conservative `max-age=63072000` without it. Decide at launch; add it only once the domain layout is known and every subdomain is HTTPS, and never submit to the preload list from a phase | Requires production infrastructure | [production-security.md §4](production-security.md#4-hsts-scope-a-launch-decision) |
| H3 | `curl -sI` of `/` and `/admin` after the first production deploy shows the six headers, `s-maxage=300` on `/`, `x-robots-tag` on `/admin` | Requires one manual pre-launch verification | [production-security.md §7](production-security.md#7-what-to-check-after-the-first-production-deploy) |

## 5. Monitoring (phase 13C)

| # | Gate | Status | Procedure |
|---|---|---|---|
| M1 | **Real Sentry project** in the **EU data region**, platform Next.js, with Session Replay, tracing and profiling switched off in the project | Requires production infrastructure | [monitoring.md §5](monitoring.md#5-setting-it-up-once-before-launch) steps 1–2 |
| M2 | **`SENTRY_DSN`** set in Vercel for **Production** only (Preview unset), then redeployed; the function log's first lines say `Monitoring: Sentry enabled (environment=production, release=<sha>)` | Requires production infrastructure | monitoring.md §5 steps 3–5 |
| M3 | **One controlled server-only failure received** with the right release and environment and a sanitized payload, through a temporary trigger that is then removed — never a permanent throw or debug route | Requires one manual pre-launch verification | [monitoring.md §6](monitoring.md#6-the-one-controlled-production-test-a-pre-launch-gate) |
| M4 | **Issue alert configured**: e-mail on every new issue | Requires production infrastructure | monitoring.md §5 step 6 |
| M5 | Server-only, sanitized, best-effort monitoring; the events and their repairs | **Repository proven** | `tests/unit/monitoring/*`, `tests/unit/policy/monitoring-boundary.test.ts`, `tests/e2e/monitoring.spec.ts` |
| M6 | *(Optional, recommended)* **`SENTRYCLI_SKIP_DOWNLOAD=1`** in the Vercel build environment, as CI already sets it: the unused Sentry CLI's postinstall then never falls back to a network download. Remove it if source-map upload is ever enabled | Requires production infrastructure | [monitoring.md §7](monitoring.md#7-source-maps-and-stack-traces-the-v1-decision) |

## 6. After the first production deploy, in one sitting

The order that proves the most with the fewest steps: S-rows and R1/M2 are
configuration and come first; then deploy; then H3, the throttle walk and the
sign-in cost check of production-security.md §7; then M3; then B6; then B7 on a
scratch project; then B8 by reading the e-mail the first Monday brings.
