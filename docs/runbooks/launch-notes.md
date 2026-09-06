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
| A1 | Real photographs from the 1ab checklist uploaded through the image library and selected in the editors | Requires one manual step — **performed once against the local stack** (14B2, §0an): Odin, Ragnar and Tapas — the three dish photographs whose filename clearly identifies them — uploaded and selected; the Forside hero, Om os facade and Mad ud af huset photographs also selected (below). Repeating it against the production library is still owed (14C). The award, Om os team, Om os kitchen and Forside about-excerpt photographs are **not supplied** and remain the approved no-image state — a launch blocker. Seventeen other supplied photographs carry no confirmed dish identity and were deliberately left out of the library | The restaurant supplies; the Owner or the developer uploads | 2026-09-06 · `launch-assets/`, the local image library, complete Playwright matrix green (§1 below for the mapping) |
| A2 | Real copy for Forsiden, Mad ud af huset and Om os written through the administration | Requires one manual step — **performed once against the local stack** (14B2, §0an) for all three pages, from `launch-assets/launch-copy.md`, unrewritten beyond joining each field's source paragraphs. Repeating it against production is still owed (14C). The Om os editor itself is **repository proven** (`/admin/om-os`, phase 14B1, §0am: `tests/e2e/about-admin.spec.ts`, pgTAP `031`) | The restaurant writes; the Owner or the developer enters it | 2026-09-06 · the three editors, complete Playwright matrix green (14B2, §0an) |
| A3 | **Final map asset and its licence** in `public/map/`, `LICENSE.md` completed (provenance, file, source, licence, date), `map_attribution` set if the licence requires credit (§7g, §13 item C) | Not started — `launch-assets/` (2026-09-06) held no map image and no licence, source or date record; checked and confirmed absent by 14B2 (§0an). The guard is **repository proven**: a Vercel production build refuses the placeholder (`lib/site/map-launch-guard.ts`) | The developer, once the restaurant or a licensed provider supplies the image and its licence | |
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
| `sandwich-trio.png` | The Mad ud af huset page's optional photograph | Image library upload → `/admin/mad-ud-af-huset`, "Billede" |
| The other 14 photographs (`bacon-red-onion-burger`, `bestla`, `boefsandwich`, `chicken-red-cabbage-sandwich`, `double-crispy-chicken-burger`, `freja`, `ivar`, `jacksparrow`, `norden`, `pulled-pork-crispy-burger`, `shwarma`, `valhalla`, `wienerschnitzel`, `ydun`) | Not uploaded | No confirmed dish identity and no reserved slot they clearly fit; quality over quantity (§7 of the phase-14B2 brief) — available for the restaurant to identify later |
| — (none supplied) | The award photo, the Om os team photo, the Om os kitchen photo, the Forside about-excerpt photo, the licensed static map | **Launch blockers** — the approved no-image / placeholder state stands |

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
