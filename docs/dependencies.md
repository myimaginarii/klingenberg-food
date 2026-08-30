# Dependency and version record

Required by technical plan §14 ("Record the chosen versions and the date of the
advisory check in the repository, not here").

## Phase 5 completion pass — no dependencies added (2026-08-30)

The pass that closed phase 5 (see technical plan §0b) added **nothing**: no runtime
dependency, no development dependency, no migration and no database object. It made two
visual corrections, four target-size corrections and one refactor, all inside files that
already existed, plus one new development-only script.

### `scripts/clear-data-cache.mjs` is not a dependency

It imports `node:fs` and `node:path` and nothing else. `npm run db:reset` now runs it, so
a local database reset no longer leaves Next's on-disk data cache
(`.next/cache/fetch-cache`) holding content that references the previous seed's uuids —
the development-only problem every phase-5 report noticed. It deletes that one directory
and neither `.next` nor `.next/cache`, and it changes no production caching behaviour:
the deployed site has no such directory a developer can reach, and
`lib/content/source.ts` is untouched.

### `npm audit --audit-level=high` — clean

Re-run from a clean `npm ci` on 2026-08-30 as part of the completion regression. Result
recorded with the rest of that run; no advisory affects the pinned set below.

## Phase 5F — no dependencies added (2026-08-30)

The Tapas list editor (`lib/menu/tapas.ts`, the Tapas Server Action, the three list
forms) added **nothing** — no runtime dependency, no development dependency, no database
object and no migration.

### Why no drag-and-drop library, again

Phase 5E's reasoning below applies unchanged and more strongly: a Tapas group is a
handful of plain strings in a single list, and Flyt op / Flyt ned are ordinary submit
buttons in the same form as the item they move. The phase brief asked for simplicity over
elaborate drag visuals, so this editor has **no pointer gesture at all** — the buttons are
the mouse, touch and keyboard path alike, and they work with JavaScript switched off. The
sortable-library names are already forbidden by
`tests/unit/policy/public-javascript.test.ts`.

### No database object either, and no second reorder engine

A Tapas edit writes `details` into `dishes.draft` through the phase-4 draft writer and
goes live through `publish_dish`, unchanged. `supabase/tests/009_tapas.test.sql` asserts
that no tapas function, table or view exists, so a later phase cannot quietly add one.

`lib/menu/reorder.ts` is deliberately **not** reused: `reorderDishes` exists to feed
`sortOrderWrites`, which turns a list of dishes into per-row `sort_order` drafts, and a
Tapas group has no rows and no positions to write. `moveListItem` in `lib/menu/tapas.ts`
is nine lines and shares the same four properties, asserted separately.

## Phase 5E — no dependencies added (2026-08-29)

Menu reordering (`lib/menu/reorder.ts`, the reorder Server Action, the drag handle)
added **nothing** — no runtime dependency, no development dependency, and no database
object either.

### Why no drag-and-drop library

§1 (adjustment 4) rules out a library unless the native implementation genuinely cannot
satisfy the requirement. It can, and by a wide margin, because the requirement is far
narrower than what a sortable framework solves:

* **One list, one axis, one container.** No cross-list drags, no nesting, no
  multi-select, no virtualised rows. A section holds a dozen dishes at most.
* **The server owns the order.** The gesture proposes a *position in a list*; the server
  recomputes the move with a pure function and writes the drafts. There is no client-side
  list state to keep in step, so the hard part every sortable library exists to solve is
  not part of this problem.
* **The accessible paths are not the library's.** Flyt op / Flyt ned are ordinary submit
  buttons that work with no JavaScript at all, and the arrow keys submit the same form.
  A library's own keyboard model would have to be reconciled with those rather than
  replacing them — more code, not less.

What that left is one Client Component of roughly 200 lines using Pointer Events, which
is the whole of the browser-side feature. `@dnd-kit`, `react-beautiful-dnd`,
`@hello-pangea/dnd`, `react-dnd`, `react-sortable-hoc`, `sortablejs`, `dragula` and
`react-draggable` are now named in `tests/unit/policy/public-javascript.test.ts`, so
adding one is a failing test rather than a review someone has to remember to do.

### No database object either

Reordering writes `sort_order` into `dishes.draft` through the phase-4 draft writer and
goes live through `publish_dish`, unchanged. There is no reorder function, no second
ordering table and no trigger; `supabase/tests/008_reorder.test.sql` asserts the absence
of all three, so a later phase cannot quietly add one.

The one change to shared machinery is additive: `SaveDraftRequest` gained an optional
`clear` list, so a *partial* editor can take a field back out of a draft the way
`mode: 'replace'` does for a whole-entity one. It is implemented in
`lib/drafts/overlay.ts` beside the merge the preview already uses, and it widens what a
draft may contain by nothing — `clear` goes through the same `spec.fields` allow-list a
write does.

---

## Advisory check — 2026-08-29 (phase 4 additions)

One runtime dependency was added for phase 4 (draft / preview / publish). Nothing
already installed was changed, and no development dependency was added.

| Package | Version | Why |
|---|---|---|
| `zod` | 4.5.2 | §1 (adjustment 4) names it: "one schema per entity, used by the form and re-parsed by the Server Action. Non-negotiable given how much of this system is free-text content." |

Pinned exactly. `zod@4.5.2` declares **no dependencies at all**, so it adds one package
to the tree and nothing transitively. Licence: MIT.

**Advisory result: no known advisory affects the selected version.** OSV.dev was queried
at the resolved version, and again across all versions to catch anything the selected
version is merely past:

| Package | Advisories ever published | Status |
|---|---|---|
| `zod` | GHSA-m95q-7qp3-xv42 (denial of service through a crafted string, MODERATE), fixed in **3.22.3** | resolved version is **4.5.2** — past the fix by two major lines |

`npm audit --audit-level=high` over the full resolved tree: **0 vulnerabilities**.

### Why 4.5.2 and not the 3.x line

`zod@4` is the current stable major (`latest`), and the `next`, `beta` and `canary`
dist-tags all point at prereleases that are not used. The 4.x line is what this project
starts on, so there is no migration to weigh — only a choice, and the patched stable
release is the answer §14 gives.

Two 4.x affordances the schemas rely on and which are worth recording, because they are
what makes the strict allow-list in §5 of the phase brief expressible rather than
merely intended:

* `z.strictObject(shape)` and `z.object(shape)` from the *same* shape. The first rejects
  an unknown key; the second drops it. `lib/schemas/define.ts` builds both, so an entity
  cannot end up strict on the way in and lax on the way out — or the reverse.
* `z.iso.datetime({ offset: true })`, which accepts PostgREST's microsecond timestamps
  unchanged. The optimistic-concurrency token is `updated_at` carried as a string from
  the database to the form and back (§6); parsing it into a `Date` anywhere would round
  it and turn every publish into a false conflict.

### Nothing else was added

No form library, no state library and no component library, as the phase brief requires
and §1 (adjustment 4) already ruled out. The publishing UI is plain `<form>` elements
posting to Server Actions; the public site's JavaScript budget is unchanged, and
`tests/unit/policy/public-javascript.test.ts` still asserts both by name.

The publish transaction needed no dependency either: it is a PostgreSQL function per
entity (`supabase/migrations/20260829140000_draft_publish_core.sql`), called through the
Supabase client that was already installed in phase 1.

### The caching model is a decision, not a default

Next.js 16 offers two caching models, and phase 4 stays on the one phase 3 already uses:
route-segment revalidation plus tagged data caching (`unstable_cache`), invalidated with
`updateTag()` from the publish Server Action. The reasoning is recorded in
`lib/cache/tags.ts` and summarised here because it is a version decision:

* **Cache Components** (`cacheComponents: true`, `use cache`, `cacheTag`) is stable in
  16 and is where the framework is going. Enabling it is an application-wide migration,
  not a flag: it rejects the `export const revalidate` that carries the five-minute
  safety net §7a depends on, and it fails the prerender on the `new Date()` the
  open/closed badge, the sold-out reset and the Månedens burger window are all computed
  from. Adopting it means rebuilding the phase-3 public site around `<Suspense>` and
  `connection()`.
* **The previous model** is documented as supported alongside it — "your existing fetch
  and `unstable_cache` caching keeps working as a separate layer" — and the Supabase
  reads are not `fetch` calls whose options we control, so `unstable_cache` is the API
  that can tag them. Its tags feed the same invalidation machinery `cacheTag` does,
  which is why `updateTag()` expires them; and it bypasses itself while Draft Mode is
  on, which is exactly the behaviour a preview needs.

The deprecated single-argument `revalidateTag(tag)` is not used anywhere.

Migrating to Cache Components is a phase of its own, to be planned rather than done in
passing. Until then this is a supported model, not a legacy one.

---

## Advisory check — 2026-08-29 (phase 3 additions)

Two development dependencies were added for phase 3 (the public read-only site). No
runtime dependency was added, and nothing already installed was changed.

| Package | Version | Why |
|---|---|---|
| `@playwright/test` | 1.62.1 | Real-browser tests: the six public routes, the no-JavaScript pass, and the drive for axe. §9 names it. |
| `@axe-core/playwright` | 4.13.0 | The accessibility scan §1 (adjustment 4) calls for by name. Brings `axe-core@4.13.0`. |

Both are pinned exactly. `@axe-core/playwright@4.13.0` depends on `axe-core: ~4.13.0`,
so the two move together.

**Advisory result: no known advisory affects any selected version.** OSV.dev was queried
per package at the resolved version, and again per package across all versions to catch
anything the selected version is merely past:

| Package | Advisories ever published | Status |
|---|---|---|
| `@playwright/test` | none | — |
| `playwright-core` | none | — |
| `@axe-core/playwright` | none | — |
| `axe-core` | none | — |
| `playwright` | GHSA-7mvr-c777-76hp (browsers downloaded without verifying the TLS certificate, HIGH), fixed in **1.55.1** | resolved version is **1.62.1** — past the fix |

`npm audit --audit-level=high` over the full resolved tree: **0 vulnerabilities**.

### Playwright browsers are not an npm dependency

`npx playwright install chromium` fetches the browser into a machine-level cache, not
into `node_modules`, so it does not enter the lockfile. CI installs **Chromium only**:
the public site uses no browser-specific API, and a second engine would double the
slowest job for no new information.

### Lighthouse is not a dependency either

The phase-3 performance target is measured with `npx --yes lighthouse@12`, run against a
production build on demand. It is a measuring instrument, not something the application
needs, so it stays out of `package.json` (§1, adjustment 4).

### Nothing else was added

Phase 3 needed no runtime dependency at all. In particular, and by §1 (adjustment 4) and
§7g, the public site still has **no** map library or tile provider, no date library, no
state-management library, no client data-fetching library, no component library and no
analytics or tag manager. `tests/unit/policy/public-javascript.test.ts` now asserts that
against `package.json` by name, so an accidental addition fails a test rather than
passing review.

### The `dishes.labels` enumeration stays open — deliberately

The phase-1 record left this as "a one-line forward migration once the design file is
available". The design file is now in the repository, and it does **not** support a
closed set of four:

* frame 1aa's label row draws **Populær · Ny · Stærk · Vegetar**, each with its own tone;
* frame 1h prints **Pulled pork** beside Glade Gris, and 1g and 1l print **Kylling** and
  **Størst** on the Forside cards — all in the neutral tone.

So the approved design uses the four system labels *and* short descriptive ones. Pinning
an enumeration of four would reject content the design itself contains, so **no forward
migration was written**. The shape rule the initial migration already enforces — at most
four distinct, non-blank strings — stands, and `components/site/menu/DishBadge.tsx`
holds the one rule that is real: the four system labels carry their approved tone, and
anything else is neutral.

---

## Phase 2 — no dependencies added (2026-08-29)

The time engines (`lib/time`, `lib/hours`, `lib/menu/availability`) added **nothing**.

§1 (adjustment 4) rules out a date library unless a tested `Intl` helper proves fragile
in review. It did not. Two native primitives carried the whole phase:

- `Intl.DateTimeFormat` with `timeZone: 'Europe/Copenhagen'` and `hourCycle: 'h23'`,
  which carries the IANA rules for every past and future transition, and
- `Date.UTC` used purely as an offset-free number line for calendar arithmetic.

Both Danish daylight-saving transitions, the ambiguous hour in October and the skipped
hour in March are covered by unit tests, and the suite re-runs a cross-section under
seven host timezones to prove no result is machine-local. `lib/time/copenhagen.ts` is
the only module that names a timezone, so if a library ever does become necessary it is
one file that changes.

The `zod`, `@playwright/test`, `@axe-core/playwright`, `sharp` and Sentry additions
listed below remain scheduled for their own phases.

---

## Advisory check — 2026-08-29 (phase 1 additions)

Two runtime dependencies were added for phase 1 (schema + authentication). Nothing
else was added, and no phase-0 dependency was changed.

| Package | Version | Why |
|---|---|---|
| `@supabase/supabase-js` | 2.112.4 | Supabase client. Used server-side only. |
| `@supabase/ssr` | 0.12.5 | Cookie-based session handling for the App Router. |

Both are pinned exactly, and `@supabase/ssr@0.12.5` declares
`@supabase/supabase-js: ^2.112.4` as a peer, so the two are a matched pair. The only
transitive addition of note is `cookie@^1.0.2`.

**Advisory result: no known advisory affects any selected version.** OSV.dev was queried
per package *at the resolved version*, and again per package across all versions to
catch anything our version is merely past:

| Package | Advisories ever published | Status |
|---|---|---|
| `@supabase/supabase-js` | none | — |
| `@supabase/ssr` | none | — |
| `@supabase/postgrest-js`, `realtime-js`, `storage-js` | none | — |
| `@supabase/auth-js` | GHSA-8r88-6cj9-9fh5 (insecure path routing from malformed user input), fixed in **2.70.0** | resolved version is **2.112.4** — well past the fix |
| `cookie` | none at 1.0.2 | the 0.7.0 `cookie` advisory class does not apply to the 1.x line |

`npm audit --audit-level=high` over the full resolved tree: **0 vulnerabilities**.

### `@supabase/supabase-js` 3.x is not used

The `next` dist-tag currently carries `3.0.0-next.29`. It is a prerelease, and
`@supabase/ssr@0.12.5` peers on `^2`. 2.112.4 is the current patched stable release and
is what is installed. Revisit when 3.x is stable *and* `@supabase/ssr` supports it.

### pgTAP adds no npm dependency

Database permission tests run through the Supabase CLI, which was already a phase-0
devDependency (`supabase@2.116.0`):

```bash
npm run db:test        # supabase test db
```

The CLI runs `pg_prove` in a container against the local database, and pgTAP 1.3.3 ships
in the Supabase Postgres image. The extension is created **inside each test's
transaction** and rolled back with it, so pgTAP never appears in a migration and never
reaches staging or production. No test framework, no assertion library, and no
JavaScript database client were added for this.

---

## Advisory check — 2026-08-29 (phase 0)

Sources consulted for every direct dependency below:

- OSV.dev (which aggregates the GitHub Advisory Database) queried per package **at the
  exact resolved version**, not just per package name.
- `npm audit --audit-level=high` over the full resolved tree, wired into CI.

**Result: no known advisory affects any selected version.**

### Next.js middleware authorization-bypass class — verified, not assumed

§5 and §8 state that this architecture cannot be broken by the middleware bypass
advisory class, because nothing is authorized in middleware: `middleware.ts` only
refreshes the session and redirects, and `requireStaff()` / `requireOwner()` run inside
every admin page and every Server Action, with RLS re-checking the same rule.

§14 requires that the property be *verified against the chosen version* rather than
assumed. It was:

| | |
|---|---|
| Advisory | GHSA-f82v-jwr5-mffw — Authorization Bypass in Next.js Middleware |
| Fixed in | 12.3.5, 13.5.9, 14.2.25, 15.2.3 |
| Selected version | **16.3.3** — past every fix branch |
| Architectural status | Not applicable by design; middleware performs no authorization |

Two other recent Next.js advisories were checked and are also fixed below the selected
version: RSC cache poisoning (GHSA-wfc6-r584-vfw7 / GHSA-vfv6-92ff-j949, fixed 16.2.5)
and Server Actions source-code exposure (GHSA-w37m-7fhw-fmv9, fixed 16.0.9).

## Selected versions

Exact versions, pinned without a range in `package.json`; `package-lock.json` is
committed and CI runs `npm ci`.

### Runtime

| Package | Version | Note |
|---|---|---|
| `next` | 16.3.3 | current patched stable |
| `react` | 19.2.8 | current patched stable |
| `react-dom` | 19.2.8 | matches React |
| `server-only` | 0.0.1 | build-time guard; the package has no runtime code |

### Development

| Package | Version | Note |
|---|---|---|
| `typescript` | 5.9.3 | **not** the latest — see below |
| `eslint` | 9.39.5 | **not** the latest — see below |
| `eslint-config-next` | 16.3.3 | matches Next |
| `tailwindcss` | 4.3.3 | Tailwind v4, `@theme` tokens |
| `@tailwindcss/postcss` | 4.3.3 | matches Tailwind |
| `vitest` | 4.1.11 | past the Vitest UI RCE advisories (fixed 4.1.0) |
| `supabase` | 2.116.0 | CLI, local development only |
| `@types/node` | 24.13.3 | tracks the pinned Node major, not the newest release |
| `@types/react` | 19.2.18 | |
| `@types/react-dom` | 19.2.5 | |

### Two places where "latest" is the wrong answer

§14 says to take the currently patched stable release. In two cases the newest published
version is outside the range its own consumers support, so taking it would break the
toolchain rather than harden it. Both are recorded here so the decision is revisited
deliberately rather than rediscovered.

**TypeScript — 5.9.3, not 7.0.2.**
`typescript-eslint@8.68.0`, which `eslint-config-next` depends on, declares
`typescript: ">=4.8.4 <6.1.0"`. TypeScript 7 (the native compiler) is outside that
range. 5.9.3 is the current patched release inside it. Revisit when
`typescript-eslint` publishes TypeScript 7 support.

**ESLint — 9.39.5, not 10.9.1.**
`eslint-plugin-import@2.32.0` supports ESLint `^9` at most and
`eslint-plugin-react@7.37.5` supports `^9.7` at most; both arrive through
`eslint-config-next`. Revisit when those plugins publish ESLint 10 support.

## Node.js

Pinned in `.nvmrc` (`24`) and `engines` (`>=24.0.0 <27.0.0`). CI reads `.nvmrc`.

Node 24 is the target runtime because it is an active LTS line supported by the hosting
platform. The `engines` range is wider than the pin so a developer already on a newer
Node can work without a downgrade, while CI and production stay on 24.

> **Confirm before the production deployment exists:** that the hosting platform still
> offers a Node 24 runtime. If it does not, change `.nvmrc` and `engines` together.

## Ongoing policy

- Lockfile committed; `npm ci` in CI, never a resolving install.
- Dependabot: security updates immediately, non-security grouped weekly, majors ignored
  by the bot and raised by a person (`.github/dependabot.yml`).
- `npm audit --audit-level=high` and CodeQL in CI (`.github/workflows/ci.yml`).
- GitHub Actions pinned by commit SHA with the release recorded in a comment.
- The dependency surface stays deliberately small (§1, adjustment 4). Everything the
  plan rules out — state management, client data fetching, component libraries, map
  libraries, date libraries, analytics — is still absent.

### Still to add, in the phase that needs it

`sharp` (phase 10) and the Sentry server SDK (phase 13). Each is version-checked and
advisory-checked at the point it is added, and this file updated.

Added in phase 1: `@supabase/supabase-js` and `@supabase/ssr`. Added in phase 3:
`@playwright/test` and `@axe-core/playwright`. Added in phase 4: `zod`. pgTAP needed no
npm dependency — it runs through the Supabase CLI (see the phase-1 section above).

### Open schema item — resolved in phase 3

`dishes.labels` is constrained by shape only, and stays that way; the reasoning is in
the phase-3 section at the top of this file. `supabase/seed.sql` now carries the nine
menu sections, the dishes and the page copy, extracted from the approved design file in
phase 3 exactly as this note anticipated.

> **Repository settings to enable** (not expressible in the repository itself):
> secret scanning, push protection, and Dependabot security updates; branch protection
> on `main` requiring the CI checks above.
