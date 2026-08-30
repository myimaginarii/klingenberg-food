# Klingenberg Food

Website and administration for Klingenberg Food, Carl Nielsen Hallen.

Two sources of truth, and they do not overlap:

- **Architecture** — [`docs/technical-plan.md`](docs/technical-plan.md)
- **UI/UX** — `Klingenberg Food Hi-fi.dc.html`, screens 1a–1ab

**Status: phases 0–5 complete.** The public site renders from the database; the
Kladde → Forhåndsvis → Offentliggør flow works end to end; and **Rediger menu**
(`/admin/menu`) is finished — dish CRUD as drafts, labels, section assignment, the
immediate Tilgængelig/Udsolgt path with its ~10-second Fortryd, soft delete with its own
Fortryd, reordering inside a section, and the Tapas list editor. Technical plan §0b
records exactly what phase 5 contains and what is deliberately outside it.

The next phase is 6 (Ugens ret / Lørdagsmenu / Månedens burger editors). `/admin` itself
is still the **foundation-level** dashboard from phase 4 plus the phase-5 menu entry — the
remaining section screens arrive in their own phases.

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

`npm run db:reset` also clears Next's on-disk data cache (`.next/cache/fetch-cache`)
through `npm run db:cache:clear`. A reset gives every row a new uuid, and nothing expires
a cache tag when that happens, so without this step `next start` would keep serving the
*previous* database's content and ids. Only that one directory is removed — not `.next`,
and not the bundler cache beside it.

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

```bash
npm run check:all      # the above, plus `next build` and the full Playwright suite
```

Individually: `npm run typecheck`, `npm run lint`, `npm run check:policy`, `npm test`,
`npm run build`, `npm run test:e2e`. Database permission tests are separate because they
need Docker: `npm run db:test`. CI runs all of them plus `npm audit --audit-level=high`
and CodeQL.

`npm run test:e2e` builds the site and serves it on port 3100. The read-only projects
(`desktop`, `mobile`, `no-javascript`) run first; the projects that write to the database
run after them, one after another, and each restores what it moved. The axe suites in
`tests/a11y/` run inside the `desktop` (1440 px) and `mobile` (375 px) projects, so every
accessibility assertion is made at both widths.

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
  (site)/             the public pages: forside, menu, om os, nyheder, find os, takeaway
  (admin)/admin/      the administration
    actions.ts        sign in / out, password reset — Server Actions only
    menu/             Rediger menu (phase 5) — one page, one Server Action per operation
      page.tsx        the screen; every piece of its state is in the URL (routes.ts)
      *-actions.ts    save · create · publish · availability · delete · reorder · tapas
      *-form.ts       the field names each action parses, strictly, one file each
    indhold/ login/ ejer/ ingen-adgang/ glemt-adgangskode/ ny-adgangskode/ bekraeft/
  api/preview/        start and stop Draft Mode — staff session required
proxy.ts              session refresh + unauthenticated redirect. Authorizes nothing.
components/
  site/               the public site's components
  admin/menu/         the menu administration's components. No business rules here.
lib/
  config/site.ts      the only place an absolute site URL is produced
  env/server.ts       the only place a server secret is read
  supabase/
    config.ts         the public URL and anon key
    server.ts         request-scoped client (user JWT) + cookie-free public client
    service.ts        service-role client, behind `server-only`. Still unused — the
                      first caller is the phase-10 upload path.
  auth/               session, and requireStaff() / requireOwner()
  content/            the read layer. `source.ts` is its single door to the database.
  publishing/         drafts, publish, pending changes — the phase-4 machinery
  menu/               the menu's rules: pricing, labels, sold-out, delete, reorder, tapas
  hours/ time/        the pure time engines
  schemas/            the Zod shapes every write is re-parsed against
scripts/
  check-source-policy.mjs
  seed-local-users.mjs   local Owner/Staff identities via the supported admin API
  clear-data-cache.mjs   development only — see "Getting started"
supabase/
  config.toml       local stack: public signup off, no realtime, mail catcher on
  migrations/       schema, RLS, the draft/publish core, immediate sold-out, soft delete
  seed.sql          the confirmed contact, opening-hours and menu facts
  templates/        Danish auth emails, versioned and applied through config.toml
  tests/            pgTAP — the §5 permission matrix, the owner invariant, and every
                    write path phases 4–5 added
tests/
  unit/             the pure rules, under Vitest
  e2e/ a11y/        Playwright, against a production build; axe at 375 and 1440
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

Directories appear in the phase that fills them. Empty files that only announce a future
intention are worse than the plan's own §3 tree, which already records the target
structure — so `lib/` and `components/` hold only what something imports today.

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

Everything in §15 from phase 6 onward, plus: the weekly off-platform backup workflow
(phase 13, §10f) and Sentry (phase 13). `docs/dependencies.md` records which package
arrives in which phase.

Four things the **menu administration** deliberately does not do, and the phase that owns
each, are listed in technical plan §0b: the Ugens ret and Lørdagsmenu editors and the
Månedens burger editor (phase 6), and the image library and upload (phase 10). Every dish
therefore still renders the reserved photo frame rather than a photo.

A fifth is deferred with **no phase**: there is no editor for a menu *category's own*
content — its name, intro, note or order. The chips navigate between sections and a dish
can be assigned to one; changing what a section says is a screen the approved design file
does not draw, and it should be designed before it is built. The data path for it already
exists and is tested (`menuCategoryDraft`, the `menu_category` publishable entity).
