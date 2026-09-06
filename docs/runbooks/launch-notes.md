# Launch notes — the current launch record (phase 14)

Technical plan §15 row 14, §0al; phase 14A. **This is the one place a phase-14
launch item is dated.** A row is closed by writing the date, the person and the
evidence beside it here — never by editing a runbook or the checklist. Nothing
below is marked done that the repository has not proven or a person has not
performed.

The operational gates of phase 13 (Supabase, backup, rate limiting, headers,
monitoring — 25 rows) are **not repeated here**. They are the canonical
[pre-launch-checklist.md](pre-launch-checklist.md); when one of those rows is
closed, record its date under §7 below with the row's id (S1, B6, …) rather than
copying the row.

## How to read the status column

| Status | Meaning |
|---|---|
| **Repository proven** | The repository's own tests prove it against the local stack, on every CI run. |
| **Requires production infrastructure** | A hosted project, a domain or an account the repository cannot create or prove. |
| **Requires one manual step** | A person performs it once against the real projects and records the date here. |
| **Not started** | Owned by a later increment (14B, 14C, the SEO pass, the final QA). |

## 1. Assets and content readiness (phase 14B)

| # | Item | Status | Owner | Date · evidence |
|---|---|---|---|---|
| A1 | Real photographs from the 1ab checklist uploaded through the image library and selected in the editors | Requires one manual step — **performed once against the local stack** (14B2, §0an–§0ao): Odin, Ragnar and Tapas — the three dish photographs whose filename clearly identifies them — uploaded and selected; the Forside hero, Om os facade and Mad ud af huset photographs also selected (below). §0ao re-scoped required launch photography to what the restaurant actually has: the restaurant has no team or kitchen photograph and none is invented — `team.image_id` and `method.image_id` stay null and the public Om os page renders those two sections **text-only**, by design, not as an unfinished placeholder (`components/site/about/AboutPageContent.tsx`; unit-tested in `tests/unit/about/about-page.test.tsx`). The Forside about-excerpt slot reuses the same venue/facade photograph selected through `/admin/forsiden` — one photograph, two surfaces, no second upload. The award photograph is optional by design (§0am) and stays the accepted no-image frame. Repeating the uploads and selections against the production library is still owed (14C). Seventeen other supplied photographs carry no confirmed dish identity and were deliberately left out of the library | The restaurant supplies; the Owner or the developer uploads | 2026-09-06 · `launch-assets/`, the local image library, complete Playwright matrix green (§1 below for the mapping) |
| A2 | Real copy for Forsiden, Mad ud af huset and Om os written through the administration | Requires one manual step — **performed once against the local stack** (14B2, §0an) for all three pages, from `launch-assets/launch-copy.md`, unrewritten beyond joining each field's source paragraphs. Repeating it against production is still owed (14C). The Om os editor itself is **repository proven** (`/admin/om-os`, phase 14B1, §0am: `tests/e2e/about-admin.spec.ts`, pgTAP `031`) | The restaurant writes; the Owner or the developer enters it | 2026-09-06 · the three editors, complete Playwright matrix green (14B2, §0an) |
| A3 | ~~Final map asset and its licence~~ — **closed by phase 14B3, finalised by the 14B3 fix**, not supplied. The static map, its placeholder, its `public/map/LICENSE.md` provenance record and its build-time guard (`lib/site/map-launch-guard.ts`) are retired; the map is now the official Google-generated embed for the restaurant's own Maps listing (§7g, §0ap, §0aq) | **Repository proven**: `components/site/GoogleMap.tsx`, `frame-src` in the CSP. No API key exists to provision — the embed is a fixed, copied-from-Google-Maps `src`, not built from a key or the stored address. There is no A3′: nothing further is owed here before launch | — | 2026-09-06 · phase 14B3, closed by the 14B3 fix |
| A4 | Placeholder News removed or replaced by the restaurant's own articles; the weekly dish written by the kitchen | Not started (the restaurant, after 14C) | The restaurant | |
| A5 | The real logo integrated in the public header/footer, the mobile menu, the admin bar and the favicon | **Repository proven** (14B2, §0an): `launch-assets/logo.svg` (the supplied handmade K, unaltered) copied to `public/brand/logo.svg` and `app/icon.svg` — committed, so nothing further is owed in 14C; `SiteLogo` and `DashboardBar` render it; legible checked at 16/32/48 px raster | The developer | 2026-09-06 · `components/site/layout/SiteLogo.tsx`, `components/admin/dashboard/DashboardBar.tsx`, `app/icon.svg`, complete Playwright matrix green |

### The 14B2 asset mapping, to reproduce in production (14C)

`launch-assets/` is the Owner's own source folder, never read by the running
application (excluded from the repository by `.gitignore`). This table is the whole
record of what went where, so the same uploads and selections can be repeated by
hand against the production image library — no automation was built for it, by
instruction.

| Supplied file | Where it went | How |
|---|---|---|
| `logo.svg` | `public/brand/logo.svg`, `app/icon.svg` (repository files, committed) | Copied in directly; not through the image library |
| `odin.png` | The **Odin** dish's photograph | Image library upload → `/admin/menu`, Odin's "Vælg billede" |
| `ragnar.png` | The **Ragnar** dish's photograph | Image library upload → `/admin/menu`, Ragnar's "Vælg billede" |
| `tapaz.png` | The **Tapas** dish's photograph (stored; the public Tapas board does not render a dish photo by design, 1h/1m) | Image library upload → `/admin/menu`, Tapas's "Vælg billede" |
| `bacon-egg-burger.png` | The Forside hero photograph (an unnamed dish; the hero makes no dish claim) | Image library upload → `/admin/forsiden`, "Hovedbillede" |
| `facade.png` | The Om os facade/venue slot (the dining room, not an exterior — the only photograph the Owner marked for this slot) | Image library upload → `/admin/om-os`, "Billede af stedet" |
| `facade.png` (reused, no second upload) | The Forside about-excerpt slot | Selected → `/admin/forsiden`, the "Om os (uddrag)" card's "Billede" (§0ao) |
| `sandwich-trio.png` | The Mad ud af huset page's optional photograph | Image library upload → `/admin/mad-ud-af-huset`, "Billede" |
| The other 14 photographs (`bacon-red-onion-burger`, `bestla`, `boefsandwich`, `chicken-red-cabbage-sandwich`, `double-crispy-chicken-burger`, `freja`, `ivar`, `jacksparrow`, `norden`, `pulled-pork-crispy-burger`, `shwarma`, `valhalla`, `wienerschnitzel`, `ydun`) | Not uploaded | No confirmed dish identity and no reserved slot they clearly fit; quality over quantity (§7 of the phase-14B2 brief) — available for the restaurant to identify later |
| — (none supplied, none required) | The Om os team photo, the Om os kitchen photo | **Optional** (§0ao) — `team.image_id` / `method.image_id` null renders the section text-only, not a placeholder; the Owner may add either later through `/admin/om-os`'s existing slots |
| — (none supplied, optional by design) | The award photo | Optional (§0am) — the accepted no-image frame, unchanged |
| — (not applicable) | The map | No longer a photograph to supply — phase 14B3 replaced the licensed static map with a Google Maps embed (row A3 above) |

## 2. Production migration (the door: 14A; the run: 14C)

| # | Item | Status | Date · evidence |
|---|---|---|---|
| M1 | `npm run launch:migrate` — the door, its target guard, its history discipline, applied and rolled-back migrations against the local database | **Repository proven** (`tests/launch/migrate.test.mjs`, `tests/unit/launch/migrations.test.mjs`) | 2026-09-05 · phase 14A |
| M2 | Production Supabase project created (Pro, `eu-central-1`; checklist S1) | Requires production infrastructure | |
| M3 | First migration run against the fresh production project, by hand: `history: target has 0 migration(s) (no history table yet)`, then `applied:` per file, then `migrated:` | Requires one manual step (14C) | |
| M4 | Protected GitHub environment `production` created with `SUPABASE_DB_URL` and `MIGRATE_CONFIRM_HOST`; `.github/workflows/production-migrate.yml` run once by dispatch; then the `push: main` trigger added (the activation order is in the workflow's header) | Requires production infrastructure (14C) | |

## 3. Production content load (the loader: 14A; the run: 14C)

| # | Item | Status | Date · evidence |
|---|---|---|---|
| C1 | `supabase/seed/confirmed.sql` holds the confirmed facts only — contact, hours, nine sections, every confirmed dish and price, the tapas lists — and the loader reads it alone; the development layer is refused from the launch path | **Repository proven** (`tests/unit/policy/launch-boundary.test.ts`, `npm run check:policy` rule 6) | 2026-09-05 · phase 14A |
| C2 | `npm run launch:load-content` — fresh-state guard, one transaction, the marker, a harmless rerun, a rolled-back failure | **Repository proven** (`tests/launch/content-load.test.mjs`) | 2026-09-05 · phase 14A |
| C3 | The confirmed content loaded into the fresh production project, once, after M3 | Requires one manual step (14C) | |
| C4 | Facts re-confirmed with the restaurant before C3 (prices, hours, phone numbers): the loader loads what the file says | Requires one manual step (14C) | |

## 4. Owner bootstrap (the tool: 14A; the run: 14C)

| # | Item | Status | Date · evidence |
|---|---|---|---|
| O1 | `npm run launch:bootstrap-owner` — the invitation model, the existing-Owner refusal, the partial-state repairs, the target and address guards, nothing secret printed | **Repository proven** (`tests/launch/bootstrap.test.mjs`, `tests/unit/launch/*.test.mjs`) | 2026-09-05 · phase 14A |
| O2 | SMTP and the Auth Site URL configured so the invitation can be delivered and its link can land (checklist S4–S5) | Requires production infrastructure | |
| O3 | The first Owner bootstrapped: state A, invitation sent, profile created ([owner-handover.md §2–§3](owner-handover.md)) | Requires one manual step (14C) | |
| O4 | The Owner chose a password, signed in, opened `/admin/brugere`, created the first Staff account themselves | Requires one manual step | |
| O5 | A second run of the bootstrap refuses (`an Owner already exists`) — recorded once as proof the tool is inert | Requires one manual step | |

## 5. Training

| # | Item | Status | Date · evidence |
|---|---|---|---|
| T1 | The Owner changed one price unaided ([owner-handover.md §6](owner-handover.md)) | Requires one manual step | |
| T2 | The Owner marked one dish sold out unaided | Requires one manual step | |
| T3 | The Owner created and edited an announcement unaided | Requires one manual step | |
| T4 | Account ownership agreed and written down ([owner-handover.md §7](owner-handover.md)) | Requires one manual step | |

## 6. Domain wiring (preparation: 14A; the cutover: later)

| # | Item | Status | Date · evidence |
|---|---|---|---|
| D0 | Domain registration and DNS control confirmed with the restaurant ([domain-cutover.md §0](domain-cutover.md)) | Requires production infrastructure | |
| D1–D6 | Vercel domain · DNS · `SITE_URL` · Auth Site URL · redirect URLs · Resend domain (domain-cutover.md §1 steps 1–6) | Requires production infrastructure | |
| D7 | HSTS `includeSubDomains` decided either way (checklist H2) | Requires production infrastructure | |
| D8 | Preview and staging protected; production **still `noindex`** through phase 14 | Requires one manual step | |

## 7. Phase-13 gates closed (by reference)

Record here, by row id, each pre-launch-checklist row as it is closed:

| Row | Date | Who | Evidence |
|---|---|---|---|
| | | | |

## 8. Remaining later-audit gates

Not phase 14A's, and deliberately not started here:

| Gate | Owner | Status |
|---|---|---|
| **Privacy/cookie consideration for the Google Maps embed** (phase 14B3, §0ap): the Find os and Forside map iframe loads third-party Google content directly into the guest's browser, which the retired static-image system never did. Whether this needs a disclosure, a cookie notice or a consent mechanism before public launch is not decided here — no consent behaviour was built, by instruction | The later privacy/security/cookie review | Not started |
| The final security audit over the §0ak carry-forwards (`/security-review` scope) | Its own dedicated pass | Not started |
| The SEO verification: `robots.ts`, sitemap, canonicals, JSON-LD against Rich Results, the `noindex` lift | The SEO pass, after the final QA | Not started |
| Copy humanization of the restaurant's own texts | With the restaurant, after 14B | Not started |
| The final launch QA on the real domain at 375 / 768 / 1440, every checklist row closed | The final QA pass | Not started |
| Staging project for previews and scratch work (§10a) — planned, not provisioned | 14C or later | Not started |
| Public, indexed opening | After every row above | Not started |

## 9. Phase 14C — what ran, and what is blocked (2026-09-06)

Technical plan §0ar. 14C is the **hosted** increment. It was run on 2026-09-06 and
found that **no external infrastructure exists yet**, so every hosted step is blocked
and none of them is marked done here. What 14C did complete is the repository half:
the environment audit, the deferred-E2E investigation, and the full local
certification.

### 9a. Production services inventory — measured, not assumed

| Service | State | How it was checked |
|---|---|---|
| GitHub repository / remote | **MISSING** | `git remote -v` prints nothing — the checkout is local-only |
| Vercel project | **MISSING** | no `.vercel/`; never linked |
| Supabase **production** project | **MISSING** | `supabase status` → `linked_project: null`; `.env.local` is `127.0.0.1` only |
| Supabase production region | **N/A** | no project to have a region; S1 asks for Pro in `eu-central-1` |
| Production environment variables | **MISSING** | nothing to hold them: no Vercel project, no protected GitHub environments |
| Production Auth configuration | **MISSING** | no project; Site URL / redirect URLs unset (S4) |
| Resend / custom SMTP | **MISSING** | no account; local Auth mail is the Mailpit catcher (S5) |
| Sentry project | **MISSING** | `SENTRY_DSN` unset everywhere; monitoring correctly inert (M1–M2) |
| Off-platform backup destination | **MISSING** | no `BACKUP_S3_*` value exists (B1–B5) |
| Custom domain / DNS | **MISSING** | `SITE_URL` unset; the site resolves to `localhost` (D0–D6) |
| Owner e-mail / bootstrap information | **MISSING** | no address supplied; **none was invented** (O3) |

**READY** (needs no external account): the migration door, the confirmed-content loader,
the Owner bootstrap tool, the backup and restore tooling, the server-side Sentry wiring,
the security headers and the rate limiter — all repository-proven, all waiting only for a
target. Their guards were re-checked live on 2026-09-06: `npm run launch:migrate` pointed
at the local stack refuses with `refused — The target 127.0.0.1 is the local stack`, and
its log redacts the credentials in the connection string.

### 9a2. The one bug this pass found and fixed

Re-running the two specs the visual pass had left deferred was not a formality. The
first complete matrix stopped in `about-admin-mobile` on *"the first guest request is
unchanged"*, reporting an empty story on the public `/om-os` — and took 139 later tests
down with it. The page itself was fine: the frozen visual pass had retuned the story's
reading measure from `max-w-[52ch]` to `text-lead max-w-[54ch]`, and
`tests/e2e/support/about-admin.ts` selected the paragraphs by the old utility class, so
it silently snapshotted nothing. **The component was not touched** — the design is
frozen and was rendering correctly. The three body-text selectors in that helper now
match the shared type-scale class instead of a max-width, and no class-pinned selector
remains under `tests/`. No other bug was found: the certification below is otherwise a
clean pass, not a repaired one.

### 9b. The manual setup groups, in dependency order

One group at a time, on purpose: each unblocks the next, and doing them all at once
gives six half-finished accounts. Nothing in this section may be done by the developer's
tooling — every step is a person in a browser.

**A note on secrets, which applies to every group below.** Do **not** paste a
service-role key, a database password, an API key, a DSN or a bucket secret into a chat
message. Put each one straight into its provider's dashboard, or — when a command on
this machine needs it — into the environment file that command reads. Then say only
*"done"*. The values that are safe to say out loud are the non-secret identifiers named
in each group.

**Which file.** There are two, both git-ignored, and they are kept apart on purpose
(`.env.example`, §"TWO ENVIRONMENT FILES"):

| File | Holds | Read by |
|---|---|---|
| `.env.local` | the **local** Supabase stack only | `next dev`, `npm run db:users`, `npm run backup`, `npm run backup:restore`, every drill and test configuration |
| `.env.production.local` | the **production** project only | `npm run launch:migrate`, `npm run launch:load-content`, `npm run launch:bootstrap-owner`, `npm run backup:production`, `npm run backup:restore:production` |

No command reads both. A production connection string in `.env.local` would put it
into every development shell, every drill and every test run — which is why the
production values below go into `.env.production.local` and nowhere else. Node loads
the file itself (`--env-file-if-exists=…` in `package.json`), so there is nothing to
export by hand in each terminal.

The three confirmation variables are the exception, and belong in **neither** file:
`MIGRATE_CONFIRM_HOST`, `CONTENT_LOAD_CONFIRM_HOST` and `BOOTSTRAP_CONFIRM_HOST` are
typed for one command and then unset. A stored confirmation has pre-confirmed every
future run, which is the guard, defeated in one line.

#### Group 1 — the production database (unblocks the migration run and the content load)

| | |
|---|---|
| **Create** | A Supabase project |
| **Where** | <https://supabase.com/dashboard> → *New project* |
| **Options** | Organisation: yours. Name: `klingenberg-food`. Region: **Frankfurt (`eu-central-1`)** — checklist S1. Plan: **Pro**, not Free (a Free project pauses and carries no backup guarantee). Set a strong database password and **save it in a password manager** |
| **Then** | Create `.env.production.local` in the repository root (git-ignored; it does not exist yet). Project settings → *Database* → *Connection string* → **Session pooler (port 5432)**, not the transaction pooler (6543): `pg_dump` and the migration door both need a session. Put it there as `SUPABASE_DB_URL` — that one line is all the migration run needs. Then project settings → *API*: in the same file, the project URL as `NEXT_PUBLIC_SUPABASE_URL`, the anon key as `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the **service-role** key as `SUPABASE_SERVICE_ROLE_KEY`. Nothing production goes into `.env.local` |
| **Tell me (safe)** | The project reference — the 20 characters in `https://<ref>.supabase.co` — and that the values are in `.env.production.local` |
| **Never say** | The database password, the service-role key, the connection string |
| **Then I can** | Run `npm run launch:migrate` (M3) and `npm run launch:load-content` (C3) against it, and verify RLS, roles, the content documents, the media tables, announcements, hours, contact, image references, the audit and rate-limit functions, and the triggers and policies (§4 of the 14C brief) |

#### Group 2 — the repository and the deployment

| | |
|---|---|
| **Create** | A **private** GitHub repository, then a Vercel project from it |
| **Where** | <https://github.com/new> — private; do **not** add a README, `.gitignore` or licence. Then <https://vercel.com/new> → *Import Git Repository* |
| **Options** | Vercel framework preset: **Next.js** (detected). Node version: **24** (Project settings → *General* → *Node.js Version*), matching `.nvmrc` |
| **Then** | Vercel → *Environment Variables*, **Production** scope: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `RATE_LIMIT_SECRET` (**required** — a deployment without it refuses every sign-in; generate with `openssl rand -hex 32`). Leave `SITE_URL` unset until the domain exists |
| **Tell me (safe)** | The repository URL and the Vercel project name |
| **Never say** | The service-role key, `RATE_LIMIT_SECRET` |
| **Note** | A push is required before Vercel or GitHub Actions can do anything. Nothing is pushed without saying so first — see §9c |

#### Group 3 — e-mail, then the first Owner

| | |
|---|---|
| **Create** | A Resend account and, in Supabase, custom SMTP (checklist S5) |
| **Where** | <https://resend.com> → *Domains* → add the sending domain, publish its SPF/DKIM/DMARC records in the registrar's zone, wait for *Verified* (can take hours). Then Supabase → *Authentication* → *SMTP Settings* |
| **Options** | Supabase SMTP: Resend's host and port, the Resend API key as the password, sender `noreply@<the sending domain>`. Also *Authentication* → *URL Configuration*: Site URL = the deployment's origin; add `<origin>/admin/bekraeft` to the redirect URLs (S4) |
| **Also needed** | The restaurant Owner's **real e-mail address** and the name to show in the administration |
| **Tell me (safe)** | The sending domain, and the Owner's address and display name |
| **Never say** | The Resend API key |
| **Then I can** | Run `npm run launch:bootstrap-owner --dry-run` and then for real (O3), and verify invite → activation → login → logout → session persistence → password reset → deactivated-user refusal → a Staff invitation (§7 of the 14C brief) |
| **Order matters** | SMTP **before** the bootstrap. Without it the Auth server accepts the invitation and never delivers it, and the Owner is stranded |

#### Group 4 — monitoring and the off-platform backup

| | |
|---|---|
| **Create** | A Sentry project, and an S3-compatible private bucket |
| **Where** | <https://sentry.io> → *Projects* → *Create Project* → platform **Next.js**, **EU data region**; switch Session Replay, tracing and profiling **off** in the project (M1). Then Cloudflare R2 (<https://dash.cloudflare.com>) or Backblaze B2 — a **private EU** bucket with versioning (B1–B4) |
| **Then** | Sentry's DSN → Vercel env var `SENTRY_DSN`, **Production scope only**. Bucket: create read/write/list credentials, and the two lifecycle rules (`weekly/` 63 days, `monthly/` 190 days). Create the protected GitHub environment `backup` holding `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the five `BACKUP_S3_*` values (B5) |
| **Tell me (safe)** | The Sentry org/project slug, the bucket name, the endpoint host and the region |
| **Never say** | The DSN, the bucket access key or secret |

#### Group 5 — the domain

Follow [domain-cutover.md](domain-cutover.md) §1 steps 1–8 in order, once the
restaurant's registrar and DNS control are confirmed (D0). Production **stays
`noindex`** throughout — step 9 of that runbook, and the SEO pass, not this one.

#### Group 6 — the hosted restore drill (a prelaunch gate, B7)

Needs a temporary **scratch** Supabase project — a **Free** one is fine for a rehearsal,
same region as production. Then [restore.md](restore.md) start to finish, and destroy the
scratch project afterwards. This cannot be faked and was not: with no destination bucket
and no scratch project, no recovery point exists to restore.

### 9c. Why a push would be needed, and that it has not happened

Vercel builds from a Git remote and GitHub Actions run from a repository; neither can
act on a checkout that has no remote. So Group 2 requires pushing this repository once.
**Nothing has been pushed, and no remote has been added.** The commits are local only.
Before any push: the tree carries no secret (`.env.local`, `.env.production.local`,
`.env*` and `/launch-assets` are git-ignored, and `.env.example` holds names only), and
that stays true only as long as the values from the groups above go into dashboards,
`.env.local` and `.env.production.local` — never into a committed file.

### 9d. Production media and public content — blocked, and why nothing was copied

The 14B2 mapping in §1 above is the whole instruction, and it is still owed. Two rules
govern reproducing it, and both are why nothing could be done in this pass:

- **The local image UUIDs must not be copied into production.** An image record is a row
  plus its objects in `media` and `media-originals`; its id means nothing in another
  project. Each photograph is **re-uploaded through the production image library**, and
  the editors are then pointed at the new records — that is what makes the derivatives,
  the responsive WebP/AVIF set and the `image_references` rows come out right.
- **The venue photograph is selected twice, uploaded once.** `facade.png` fills the Om os
  venue slot and the Forside about-excerpt slot from the **same** media record (§0ao). Two
  uploads would be two records and a duplicate original.

Nothing beyond the mapping is uploaded: the fourteen unidentified photographs stay out,
and no generic burger photograph is assigned to Frigg, Thor, Glade Gris or any other dish
without the restaurant confirming which dish it shows. The team, kitchen and award slots
stay empty by design and render text-only or as the accepted no-image frame — they are
not placeholders to fill.

The public content — Forside, Om os, Mad ud af huset — is likewise re-entered through the
production administration from `launch-assets/launch-copy.md`, unrewritten, with the
confirmed award wording, menu and prices, contact details, opening hours, the Facebook
link and the Google Maps embed intact. **No News is created**: an empty Nyheder page is a
legitimate state, and inventing an article to fill it is exactly what §5 of the brief
forbids. Ugens ret, Lørdagsmenu and Månedens burger likewise stay empty until the kitchen
supplies them.

### 9e. The Owner acceptance gate (§17 of the 14C brief)

Rows T1–T3 in §5 above are this gate. It cannot be performed without a real Owner signed
in to a real deployment, and it was **not** simulated. In full it is six actions, in
pairs, so the site is left exactly as it was found: change one menu price and publish it,
then restore the original; mark one dish sold out, then restore it; create a temporary
announcement, then remove it. The public site is checked after each. **No test or fake
content may be left live afterwards** — the pairing is what guarantees that.

### 9f. The migration workflow decision

`.github/workflows/production-migrate.yml` is **unchanged and still dispatch-only**. Its
own header allows the `push: main` trigger only as the last of four steps, after the
protected `production` environment exists and one dispatch run has succeeded against the
real project. Neither exists, so arming the trigger now would fail every merge. Row M4
stays open.

### 9g. Full LOCAL certification — 2026-09-06

**This certifies the codebase, not a production environment.** There is no production
environment to certify (§9a). Run after a deliberate `npm run db:reset:full`, a clean
`npm run build`, against `next start`, with `--retries=0`.

| Gate | Result |
|---|---|
| `npm run typecheck` | **pass** |
| `npm run lint` | **pass** |
| `npm run check:policy` | **pass** — 724 files |
| Unit suite | **2,949 passed**, 130 files |
| pgTAP (`npm run db:test`) | **2,269 passed**, 31 files |
| Integration | **44 passed**, 6 files |
| Backup drill (`npm run backup:drill`) | **8 passed** |
| Launch drill (`npm run launch:drill`) | **28 passed** |
| Production build | **pass** |
| Playwright, complete matrix, 50 projects, `--retries=0` | **1,401 passed · 0 failed · 7 skipped** of 1,408 (48.4 min) |
| Accessibility (axe, inside the desktop and mobile projects) | **280 passed** (140 × 2) |
| Security headers (`security-headers.spec.ts`, `security` project) | **pass** |
| `npm audit` | **0 vulnerabilities** |

**The 7 skips are conditional, not disabled** — each is a `test.skip(condition, reason)`
guard for a viewport or input modality the run does not have: the phone-only order bar on
desktop (1), the ≥1024 px desktop bar on mobile (2), pointer-drag versus finger-drag in
`menu-reorder` (3), and one sold-out-reset case in `opening-hours-override-mobile` (1).
Nothing was waived and nothing was left unrun: the first matrix's "139 did not run" was
the abort behind the §9a2 bug, and the re-run after the fix executed all 1,408.

The two specs the visual pass had deferred **did execute**, in all four of their
projects: `homepage-admin.spec.ts` (24 + 24) and `about-admin.spec.ts` (22 + 22).

**A local smoke pass at 375 / 768 / 1440** against the same production build: no
horizontal overflow at any width, no broken images, `<meta name="robots" content="noindex,
nofollow">` served, and the Google embed rendering live with `loading="lazy"` and the
Danish title *"Kort over Lumbyvej 62, 5792 Nørre Lyndelse"*. This is **not** the hosted
smoke test the brief asks for — that needs a deployment and stays open.

**Known artefact, unchanged by this pass:** the write projects leave three `Testret` rows
in the local database. Reset before the next full run — the suite assumes a clean seed.
