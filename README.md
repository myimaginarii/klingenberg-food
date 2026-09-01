# Klingenberg Food

Website and administration for Klingenberg Food, Carl Nielsen Hallen.

Two sources of truth, and they do not overlap:

- **Architecture** — [`docs/technical-plan.md`](docs/technical-plan.md)
- **UI/UX** — `Klingenberg Food Hi-fi.dc.html`, screens 1a–1ab

**Status: phases 0–8 complete and locked; phase 9A (the news administration's core) is
complete and green — phase 9 is not locked, 9B remains.** The public site renders from the database;
the Kladde → Forhåndsvis → Offentliggør flow works end to end; **Rediger menu**
(`/admin/menu`) is finished — dish CRUD as drafts, labels, section assignment, the
immediate Tilgængelig/Udsolgt path with its ~10-second Fortryd, soft delete with its own
Fortryd, reordering inside a section, and the Tapas list editor; and the two **special
menu** screens are finished too — **Ugens ret & Lørdagsmenu** (`/admin/menu/ugens-ret`)
with its ISO week, its serving days, its "Ingen lørdagsmenu denne uge" state, "Kopiér
sidste uge" and both immediate Udsolgt paths, and **Månedens burger**
(`/admin/menu/maanedens-burger`) with its date window, its dedicated Forside toggle, its
computed state, its scheduled publication, its expired-window confirmation and its own
immediate Udsolgt path. Technical plan §0b records what phase 5 contains, and §0e records
what phase 6 contains — each with what is deliberately outside it.

**Phase 7** is finished too: **Besked på hjemmesiden** (`/admin/besked`) writes one
short message with an optional link and a **required future expiry**, through the same
Kladde → Forhåndsvis → Offentliggør flow; the bar renders above the navigation on every
public page; and a ~40-line client component removes it the moment its expiry passes,
with no request, no cookie and no polling. Beside that three-step path sits **one press**:
1ad's "Vis besked" switch and "Fjern beskeden nu" take the bar off the hjemmeside at once,
the switch puts the *same published message* back just as fast, and either way there are
about ten seconds of Fortryd. Technical plan §0f and §0g record the two increments, and
**§0h is what "phase 7" means as a whole** — including the line the screen exists to keep:
**Ret / Gem / Forhåndsvis / Offentliggør change what the message says; "Vis besked" changes
whether the already-published message is shown.** Switching the bar back on never publishes
a pending draft.

**Phase 8A** is finished: the upper half of **Åbningstider** (`/admin/aabningstider`) is
the Owner-only editor for the restaurant's **normal weekly schedule** — frame 1t's upper
card, seven weekday rows, each open or closed, each open day with an opening and a closing
time chosen in quarter-hour steps, per-day Danish validation, and the ordinary
Kladde → Forhåndsvis → Offentliggør path. It added **no migration and no database
function**: the `opening_hours` singleton, its shape CHECK, its Owner-only RLS policy and
`publish_opening_hours()` have existed since phases 1 and 4. Technical plan §0i records what
it contains and what it deliberately does not.

**Phase 8B** is finished too, on the same screen and beneath it: 1t's **"ENKELT ÆNDRING"**
card closes one calendar date, or gives it other hours, **without touching the normal
week** — through the same Kladde → Forhåndsvis → Offentliggør path, with a way to take the
change away again and give the date back to the weekly schedule. Technical plan §0j records
what it contains, the three places it departs from the frame and why, and the one schema
change it needed.

**This is the one screen in the administration that is not a single permission.** §5's
matrix puts *the normal weekly hours* in the Owner column alone and *one-off overrides* in
both, so the split is drawn **per card**: an owner sees both, and a staff member sees the
one-off card with a statement — not a locked form — where the week would be. Absence is not
the enforcement. The weekly card's two Server Actions still call `requireOwner()`,
`mayChangeEntity` re-checks the same matrix row, and `opening_hours_update_owner` is still
the table's only UPDATE policy — three independent refusals, with no SECURITY DEFINER
anywhere in either path.

A **published** override feeds the phase-2 engine in both directions, with no availability
logic of its own: a closed day is skipped by the "Udsolgt i dag" reset, and a normally
closed day that an override opens becomes the day a sold-out dish comes back.

**Phase 8C-1** is finished, and it is **mechanism only**: replacing the published
announcement, stashing the one it displaced in `previous jsonb`, stamping `replaced_at`, and
a restore that reads that snapshot back from the database and clears both columns — one
transaction each, one audit row each, and **exactly one level** of undo. Those two columns
have an active purpose for the first time since phase 1. `source='opening_hours'` is now a
value a **server-side** caller may pass, from a closed vocabulary.

**It added no control anywhere in the administration**, and drove its own integration proof
through an unlinked, environment-gated harness, because `updateTag()` can be called from a
Server Action and nowhere else. **Phase 8C-3B deleted that harness**: the real controls
exist now, and the same scenarios run through them.

**Phase 8C-2** is finished, and it is one pure function: `generateOpeningHoursAnnouncement()`
turns a one-off opening-hours change into 1t's suggested message, its link and its expiry —
where the expiry is the **later** of the normal closing and the special one, which is what
the approved frames' own number says. No database, no clock, no write.

**Phase 8C-3A** is finished, and it is the backend half of the conflict flow. It settles
**who owns a generated announcement**: `announcement.source_override_id` names the one-off
override that composed the message on the hjemmeside, paired with `source` in both
directions by a CHECK, restored with the message by Fortryd, and carried in the `previous`
snapshot as its ninth key. §4's `opening_hours_overrides.announcement_created` is **dropped**
— one pointer that can be joined beats a boolean two statements have to keep in step, and
§0n records the full argument. `apply_generated_announcement()` is the coordinator §7e item 8
describes: it re-reads the singleton server-side, returns `conflict` when a message a guest
can read would be displaced and replacement was not explicitly confirmed, and otherwise
delegates the write to `replace_announcement()` so the content, the snapshot and the
ownership move in one transaction. It writes nothing about the opening hours in any branch,
so no refusal here can roll a published override back.

**Phase 8C-3B** is finished, and it is the workflow: 1t's *"Vis også som besked øverst på
hjemmesiden"* with its editable suggestion, **1ae's conflict sheet** with both branches, the
~10 s Fortryd, §7e item 6's removal consequence, and the deletion of the 8C-1 harness.

Four things are worth knowing about it:

  * **The hours are published first and always.** The Server Action publishes the override
    and expires its cache tag *before* the optional message is attempted, and the coordinator
    issues no statement against the hours tables in any branch. "Behold eksisterende besked",
    a stale token, a refused wording and an outright failure therefore all leave the new
    opening times exactly where they are — the separation is structural, not careful.
  * **The browser may edit the message and nothing else.** The expiry, the link, the source
    and the owning override are re-derived on the server from the published rows, on the
    first attempt and again on the confirmed one. The one thing a person controls is the
    wording, and `withEditedMessage()` is the whole of that permission.
  * **The suggestion follows the fields until somebody edits it**, which is the one place
    this administration spends JavaScript. Server and browser run the *same* pure module
    (`lib/announcements/generated-suggestion.ts`), so they cannot drift; the dirty flag is UI
    state and no decision consults it.
  * **A one-off change can now only be deleted through one door.** `authenticated` keeps its
    DELETE privilege — a SECURITY INVOKER function spends the caller's, so revoking it would
    take the trusted removal away too — and a BEFORE DELETE guard trigger makes that
    privilege spendable only by `remove_opening_hours_override()`, which checks the version,
    asks about the generated announcement it may own, cleans up an obsolete `previous`
    snapshot and audits both halves in one transaction. No SECURITY DEFINER was added.

**Phase 8 is complete and locked** — the completion pass of 2026-08-31 is recorded in
technical plan §0p, which is the statement of what "phase 8" is in force today. `/admin`
itself is still the **foundation-level** dashboard from phase 4 plus the menu, announcement,
opening-hours and news entries — the remaining section screens arrive in their own phases.

**Phase 9A** is finished: **Nyheder** (`/admin/nyheder`) is the news administration's core —
the list, writing an article, §7f's generated-and-frozen slug shown under the title,
per-item Offentliggør behind 1s's confirmation, "Fjern fra hjemmesiden" (the row survives,
the address 404s, republishing restores the same URL), and Slet with the 1r rule. News
deliberately keeps its own persistence model: **no `draft` column** — a row is pending
through `status='draft'`, and an edit to a *published* article is on the hjemmeside the
moment it is saved, which the editor states beside the button that commits it. Technical
plan §0q records the phase; images (phase 10), the B/Link body toolbar, autosave and the
`NewsArticle` JSON-LD (phase 9B) are deliberately outside it.

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
      ugens-ret/          Ugens ret & Lørdagsmenu (phase 6A) — its own screen, its own
                          four vocabularies, the same shape as the folder above it
      maanedens-burger/   Månedens burger (phase 6B) — the date window, "Vis på
                          forsiden" and the §7d computed state
    besked/           Besked på hjemmesiden (phase 7) — the message, its optional
                      link, its required future expiry and 1ad's suggestion chips
    aabningstider/    Åbningstider (phases 8A + 8B + 8C-3B) — the Owner-only weekly
                      schedule, the Staff-and-Owner one-off change for a single date, and
                      1t's optional generated announcement with 1ae's conflict sheet.
                      The hours are published first and always; the message is attempted
                      afterwards and can never roll them back.
    nyheder/          Nyheder (phase 9A) — the list and the article editor on one URL-driven
                      page; save/create, publish, unpublish and delete are four vocabularies
                      in four action files, and the slug is generated, never typed (§7f)
    indhold/ login/ ejer/ ingen-adgang/ glemt-adgangskode/ ny-adgangskode/ bekraeft/
  api/preview/        start and stop Draft Mode — staff session required
proxy.ts              session refresh + unauthenticated redirect. Authorizes nothing.
components/
  site/               the public site's components
  admin/menu/         the menu administration's components. No business rules here.
  admin/weekly/       Ugens ret & Lørdagsmenu (phase 6A)
  admin/monthly/      Månedens burger (phase 6B). Both reuse the menu's presentation
                      primitives — the switch, the green Fortryd strip, the dialog —
                      and share no business rules with it or with each other.
  admin/announcement/ Besked på hjemmesiden (phase 7). Its "sådan ser den ud" panel
                      renders the public bar itself, so the two cannot drift.
  admin/news/         Nyheder (phase 9A). The list rows, the editor form, the shared
                      confirmation dialog and the state badge. No business rules here.
  admin/hours/        Åbningstider (phases 8A + 8B). The seven weekday rows, the one-off
                      change card, and this screen's
                      notices. Zero client components: a closed row hides its two
                      dropdowns with a sibling selector, not with a script.
  site/announcement/  the public bar, its labelled aria-live region, and the expiry
                      guard — the only client component phase 7 adds (§7c)
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
  menu/               the menu's rules: pricing, labels, sold-out, delete, reorder,
                      tapas, the weekly special (6A) and the monthly burger (6B). The
                      last two are two concrete modules, not one generic one.
  announcements/      the announcement's rules (phases 7, 8C-1, 8C-2, 8C-3A). `expiry.ts`
                      imports nothing at all, so the browser guard and the server share one
                      comparison; `expiry-editor.ts` holds the Copenhagen half the browser
                      never sees; `snapshot.ts` is the closed nine-key shape `previous`
                      holds; `replacement.ts` the replace/restore wrapper (8C-1);
                      `generated.ts` the pure message generator (8C-2); `ownership.ts` what
                      "this override owns the announcement" means, decided by ids and never
                      by text; and `generated-operation.ts` the coordinator (8C-3A).
  news/               the news rules (phase 9A): `slug.ts` is §7f letter for letter,
                      `body.ts` the textarea ↔ structured-paragraphs mapping, `lifecycle.ts`
                      every sentence the screen says about state, and `admin.ts` the writes —
                      creation, the direct edit the draft machinery cannot do for an entity
                      with no draft column, and the two trusted transitions
  hours/ time/        the pure time engines
  schemas/            the Zod shapes every write is re-parsed against
scripts/
  check-source-policy.mjs
  seed-local-users.mjs   local Owner/Staff identities via the supported admin API
  clear-data-cache.mjs   development only — see "Getting started"
supabase/
  config.toml       local stack: public signup off, no realtime, mail catcher on
  migrations/       schema, RLS, the draft/publish core, immediate sold-out, soft
                    delete, the weekly-special admin, the monthly-burger admin, the
                    announcement admin, the one-off override admin, the announcement
                    replacement mechanism, its column-level write guard, generated-
                    announcement ownership, and the news admin (unpublish + delete)
  seed.sql          the confirmed contact, opening-hours and menu facts
  templates/        Danish auth emails, versioned and applied through config.toml
  tests/            pgTAP — the §5 permission matrix, the owner invariant, and every
                    write path phases 4–9A added
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

Everything in §15 from phase 9 onward, plus: the weekly off-platform backup workflow
(phase 13, §10f) and Sentry (phase 13). `docs/dependencies.md` records which package
arrives in which phase. Phase 6 is **complete and locked** — 6A (Ugens ret and
Lørdagsmenu, §0c), 6B (Månedens burger, §0d), and the completion pass over both halves
(§0e). Phase 7 is **complete and locked** — 7A (§0f), 7B (§0g), and the completion pass
over both halves (§0h). Phase 8 is **complete and locked** — 8A (§0i), 8B (§0j), 8C-1
(§0k) and its hardening pass (§0l), 8C-2 (§0m), 8C-3A (§0n), 8C-3B (§0o), and the
completion pass over all seven (§0p).

What the **announcement** deliberately does not do is now split across two records. §0h
lists what phase 7 does not do, and "restore" there means visibility of the same published
message and never content — nothing in phase 7, 8A or 8B reads or writes `previous` or
`replaced_at`. §0k lists what **8C-1** does not do: it replaces and restores, and it does
**not** compose a message from a one-off opening-hours change. §0m lists what **8C-2** does
not do: it composes the message, and its one caller is the 8C-3A coordinator. §0n lists
what **8C-3A** does not do: it settles ownership and coordinates the operation, and it
draws nothing — 1t's "Vis også som besked øverst på hjemmesiden", 1ae's conflict sheet, the
Fortryd strip, §7e item 6's removal consequence and the deletion of the harness were all
built by **8C-3B** (§0o), and §0p is the statement of the whole in force today. None of the
increments adds a
replacement control to `/admin/besked`. There is no archive and no history at all, by design, and a guest cannot
dismiss the bar — so nothing per-visitor is stored and the public site still sets **no
cookies**.

The things the **menu administration** deliberately does not do, and the phase that owns
each, are listed in technical plan §0b. The Ugens ret / Lørdagsmenu editor
(`/admin/menu/ugens-ret`) and the Månedens burger editor
(`/admin/menu/maanedens-burger`) have since been built by phase 6. What remains is the
image library and upload (phase 10): every dish, the weekly card and the monthly burger
therefore still render the reserved photo frame rather than a photo, and `image_id` is
owned by no editor yet — deliberately, so that no editor can clear it.

One thing is deferred with **no phase** at all: there is no editor for a menu *category's own*
content — its name, intro, note or order. The chips navigate between sections and a dish
can be assigned to one; changing what a section says is a screen the approved design file
does not draw, and it should be designed before it is built. The data path for it already
exists and is tested (`menuCategoryDraft`, the `menu_category` publishable entity).
