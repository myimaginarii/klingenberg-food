# Klingenberg Food

Website and administration for Klingenberg Food, Carl Nielsen Hallen.

Two sources of truth, and they do not overlap:

- **Architecture** — [`docs/technical-plan.md`](docs/technical-plan.md)
- **UI/UX** — `Klingenberg Food Hi-fi.dc.html`, screens 1a–1ab

**Status: phase 1 (Schema + authentication) complete.** The full initial schema, RLS,
the role helpers and the owner invariant are in place, together with email/password
login, logout, password reset and the `requireStaff()` / `requireOwner()` guards.

`/admin` is a **foundation-level** screen that exists to verify authentication and
authorization — it is not the approved admin design, which arrives from phase 4 onward.
`/` is still the phase-0 token screen. There is no public site yet. Phase 2 is the pure
time engines (`lib/hours`, `lib/menu/availability`).

## Requirements

- Node 24 (`.nvmrc`)
- npm 10+
- Docker, for the local Supabase stack

## Getting started

```bash
npm ci
npm run dev            # http://localhost:3000
```

Local Supabase (needs Docker running):

```bash
npm run db:start       # prints the local URL, anon key and service-role key
npm run db:reset:full  # migrations + seed, then the local login identities
npm run db:test        # pgTAP permission tests
npm run db:stop
```

`npm run db:start` prints local credentials. Put them in `.env.local` (git-ignored);
`.env.example` documents every name. Studio is on port 54323 and the mail catcher —
which receives every password-reset and invite email in development — is on 54324.

### Local sign-in

`npm run db:reset` applies the migrations and the seed, but it does **not** create
accounts: Supabase Auth owns the password hash and the identity row, and writing those
by hand is undocumented internal manipulation that breaks on a CLI upgrade. Accounts are
created through the supported admin API instead:

```bash
npm run db:users
```

That script (`scripts/seed-local-users.mjs`) is idempotent, refuses to run against
anything but a loopback Supabase, and creates two throwaway identities:

| Role | Email | Password |
|---|---|---|
| Owner | `owner@example.test` | `LocalOwner12345` |
| Staff | `staff@example.test` | `LocalStaff12345` |

`.test` is a reserved TLD, so neither address can ever be a real mailbox. **No real
restaurant account is created by anything in this repository.** The one-time production
owner bootstrap is separate and arrives at launch (technical plan §5).

`npm run db:reset:full` runs both steps in the right order.

Password reset is fully testable locally: request one at `/admin/glemt-adgangskode`,
then open the mail catcher at `http://localhost:54324`. The Danish template lives in
`supabase/templates/recovery.html` and is applied through `supabase/config.toml`.

## Checks

```bash
npm run check          # typecheck + lint + source policy + unit tests
```

Individually: `npm run typecheck`, `npm run lint`, `npm run check:policy`, `npm test`,
`npm run build`. Database permission tests are separate because they need Docker:
`npm run db:test`. CI runs all of them plus `npm audit --audit-level=high` and CodeQL.

`npm run check:policy` enforces three repository rules from the technical plan:

1. **No hard-coded domain.** A site origin may only be produced by
   `lib/config/site.ts` (§10d). The restaurant's domain is deferred; choosing it later
   is setting `SITE_URL`, not a code change.
2. **No `set -x` in workflows** (§8) — it echoes commands and can spill secrets.
3. **No stray secret access.** The secrets in §10e may only be read through
   `lib/env/server.ts`, which imports `server-only`, so a client import is a build
   error (§8).

## Layout

```
app/
  layout.tsx          root layout — lang="da", the three approved fonts
  globals.css         design tokens from frame 1aa, in Tailwind v4 @theme
  page.tsx            phase-0 foundation screen (development only)
  (admin)/admin/      phase-1 foundation admin — NOT the approved design
    actions.ts        sign in / out, password reset — Server Actions only
    login/ ejer/ ingen-adgang/ glemt-adgangskode/ ny-adgangskode/ bekraeft/
proxy.ts              session refresh + unauthenticated redirect. Authorizes nothing.
lib/
  config/site.ts      the only place an absolute site URL is produced
  env/server.ts       the only place a server secret is read
  supabase/
    config.ts         the public URL and anon key
    server.ts         request-scoped client (user JWT) + cookie-free public client
    service.ts        service-role client, behind `server-only`. Unused in phase 1.
  auth/
    session.ts        getUser()-backed session and profile resolution
    guards.ts         requireStaff() / requireOwner() — the real authorization boundary
scripts/
  check-source-policy.mjs
  seed-local-users.mjs  local Owner/Staff identities via the supported admin API
supabase/
  config.toml       local stack: public signup off, no realtime, mail catcher on
  migrations/       the initial schema: 13 tables, RLS, role helpers, owner invariant
  seed.sql          the confirmed contact and opening-hours facts
  templates/        Danish auth emails, versioned and applied through config.toml
  tests/            pgTAP — the §5 permission matrix and the owner invariant
```

There is deliberately **no browser Supabase client** anywhere in the repository
(technical plan §1, adjustment 2). The browser never holds a client, a key or a token.

## Authorization

Two independent layers, and neither is trusted to be the only one:

1. **`requireStaff()` / `requireOwner()`** run inside every protected page and every
   mutation. They return the profile or they `redirect()`, which throws — so a guard
   that is called is a guard that is enforced.
2. **RLS** re-checks the same rule in the database through `public.is_staff()` and
   `public.is_owner()`, because the request-scoped client carries the user's own JWT.

`proxy.ts` (Next.js 16 renamed `middleware.ts` to `proxy.ts`) refreshes the session and
redirects unauthenticated `/admin` visitors. It **authorizes nothing**, which is why the
known Next.js middleware authorization-bypass advisory class does not apply here:
bypassing it grants nothing, because it grants nothing.

A denied *update* under RLS does not raise — the policy filters the row out and the
statement reports zero rows changed. That is correct, and it is why `npm run db:test`
asserts affected-row counts and stored values rather than merely "did not throw".

`AGENTS.md` and `CLAUDE.md` are generated by `next dev` and re-created on every run;
they point AI tooling at the bundled Next 16 docs. Disable with `agentRules: false` in
`next.config.ts` if they are unwanted.

The route groups the plan describes — `app/(site)/` for the public pages and
`app/(admin)/admin/` for the administration — are **not** created yet, and neither are
the `lib/` modules that have no implementation. Empty files that only announce a future
intention are worse than the plan's own §3 tree, which already records the target
structure. Directories appear in the phase that fills them.

## Design tokens

`app/globals.css` carries the token system from frame 1aa verbatim: the thirteen colour
tokens plus the component surfaces, the type scale, the 4-step spacing scale, radii,
shadows, the four breakpoints, and the accessibility promises (3 px `#B4741A` focus
ring at 2 px offset, 44 px minimum tap targets, `prefers-reduced-motion` honoured).

Tailwind's default colour palette and breakpoints are cleared on purpose, so only the
approved values compile. The approved design stays the source of truth; this file is a
transcription of it, not an interpretation.

## Environments

Local is fully working. Staging and production are deliberately **not** provisioned yet —
Supabase Pro and Vercel Pro are deferred until closer to launch (§10a). Nothing in the
code needs to change when they arrive: the site URL resolves from the environment, and
no plan-specific API is used.

## Deferred to a later phase

Everything in §15 from phase 2 onward, plus: the weekly off-platform backup workflow
(phase 13, §10f), Playwright and axe (phase 3), and Sentry (phase 13).
`docs/dependencies.md` records which package arrives in which phase.

Two things phase 1 deliberately did not invent, because they come from the approved
design file rather than from the technical plan: the nine menu sections with their
dishes (seeded in phase 3), and the four fixed `dishes.labels` values (a forward
migration, needed by phase 5). Both are recorded in `docs/dependencies.md`.
