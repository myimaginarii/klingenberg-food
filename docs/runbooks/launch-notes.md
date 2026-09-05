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
| A1 | Real photographs from the 1ab checklist uploaded through the image library and selected in the editors | Not started (14B) | The restaurant supplies; the Owner or the developer uploads | |
| A2 | Real copy for Forsiden, Mad ud af huset and Om os written through the administration; the Om os editor built (14B) | Not started (14B) | The restaurant writes; 14B builds the Om os editor | |
| A3 | **Final map asset and its licence** in `public/map/`, `LICENSE.md` completed (provenance, file, source, licence, date), `map_attribution` set if the licence requires credit (§7g, §13 item C) | Not started (14B) — the guard is **repository proven**: a Vercel production build refuses the placeholder (`lib/site/map-launch-guard.ts`) | The developer | |
| A4 | Placeholder News removed or replaced by the restaurant's own articles; the weekly dish written by the kitchen | Not started (the restaurant, after 14C) | The restaurant | |

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
| The final security audit over the §0ak carry-forwards (`/security-review` scope) | Its own dedicated pass | Not started |
| The SEO verification: `robots.ts`, sitemap, canonicals, JSON-LD against Rich Results, the `noindex` lift | The SEO pass, after the final QA | Not started |
| Copy humanization of the restaurant's own texts | With the restaurant, after 14B | Not started |
| The final launch QA on the real domain at 375 / 768 / 1440, every checklist row closed | The final QA pass | Not started |
| Staging project for previews and scratch work (§10a) — planned, not provisioned | 14C or later | Not started |
| Public, indexed opening | After every row above | Not started |
