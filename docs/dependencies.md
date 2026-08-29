# Dependency and version record

Required by technical plan §14 ("Record the chosen versions and the date of the
advisory check in the repository, not here").

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

`zod` (phase 4), `sharp` (phase 10) and the Sentry server SDK (phase 13). Each is
version-checked and advisory-checked at the point it is added, and this file updated.

Added in phase 1: `@supabase/supabase-js` and `@supabase/ssr`. Added in phase 3:
`@playwright/test` and `@axe-core/playwright`. pgTAP needed no npm dependency — it runs
through the Supabase CLI (see the phase-1 section above).

### Open schema item — resolved in phase 3

`dishes.labels` is constrained by shape only, and stays that way; the reasoning is in
the phase-3 section at the top of this file. `supabase/seed.sql` now carries the nine
menu sections, the dishes and the page copy, extracted from the approved design file in
phase 3 exactly as this note anticipated.

> **Repository settings to enable** (not expressible in the repository itself):
> secret scanning, push protection, and Dependabot security updates; branch protection
> on `main` requiring the CI checks above.
