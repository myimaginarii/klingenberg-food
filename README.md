# Klingenberg Food

Website and administration for Klingenberg Food, Carl Nielsen Hallen.

Two sources of truth, and they do not overlap:

- **Architecture** — [`docs/technical-plan.md`](docs/technical-plan.md)
- **UI/UX** — `Klingenberg Food Hi-fi.dc.html`, screens 1a–1ab

**Status: phases 0–13 complete and locked (2026-09-05).** Phase 13's lock pass is
recorded in technical plan §0ak — the current truth of the production-hardening layer:
the weekly off-platform backup and the restore drill (13A, §0ah), the PostgreSQL-backed
rate limiter and the security-header policy (13B, §0ai), server-side monitoring (13C,
§0aj), and the error and not-found states of both route groups (§10g). What the hosted
projects must be configured with, and what a person verifies once before launch, is one
register: `docs/runbooks/pre-launch-checklist.md`. Phase 12's completion pass
(2026-09-04) is recorded in §0ag — the current truth of the administration on a phone.
Phase 9's completion pass
(2026-09-01) is recorded in technical plan §0s, phase 10A in §0t, phase 10B in
§0u, phase 10C-1 in §0v/§0w, phase 10C-2 in §0x, and **phase 10's completion pass
(2026-09-02) in §0y — the current truth of the whole image system.** The public site renders from the database;
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
itself is the 1x / 1q dashboard since phase 12C (§0af): the tiles, the announcement card,
the pending band and LIGE NU, read from the locked systems.

**Phase 9A** is finished: **Nyheder** (`/admin/nyheder`) is the news administration's core —
the list, writing an article, §7f's generated-and-frozen slug shown under the title,
per-item Offentliggør behind 1s's confirmation, "Fjern fra hjemmesiden" (the row survives,
the address 404s, republishing restores the same URL), and Slet with the 1r rule. News
deliberately keeps its own persistence model: **no `draft` column** — a row is pending
through `status='draft'`, and an edit to a *published* article is on the hjemmeside the
moment it is saved, which the editor states beside the button that commits it. Technical
plan §0q records the phase.

**Phase 9B** finishes the news functionality on that model. The Tekst field is the
approved structured editor — exactly **B and Link**, a small purpose-built client
component over the stored span shape, no editor library, no HTML in either direction —
and it degrades honestly without JavaScript: a plain body edits as the 9A textarea,
while a body with marks is shown read-only with the reason and travels back unchanged,
never silently flattened. The editor **autosaves** ("Gemt for lidt siden"): debounced,
one save in flight, refusing to save unchanged content, creating a brand-new draft row
exactly once, and stopping — with the person's text kept on screen — when somebody
else saved first. Because news has no draft layer, an autosaved edit to a *published*
article is public on the next request, and the editor says precisely that. Each
`/nyheder/[slug]` page now carries §7f's self-canonical, article Open Graph metadata
and one `NewsArticle` JSON-LD block built from published values only (no image —
photos are phase 10; nothing invented), and `/sitemap.xml` exists: the six public
pages plus published articles, where unpublishing removes the entry on the first
request and republishing restores the same address. Technical plan §0r records the
phase; images stay phase 10.

**Phase 9 is complete and locked** — the completion pass of 2026-09-01 is recorded in
technical plan §0s, which is the statement of what "phase 9" is in force today. It read
9A and 9B as one News system, walked Owner, Staff, guest and no-JavaScript flows
against a production build, audited frames 1s/1z at 375/768/1440, and carried **one
product fix**: the read layer's string helper was trimming span text, which destroyed
the boundary spaces around bold and linked runs on every projection of a marked body —
span text is now returned verbatim, pinned by a new unit suite. The accepted
audit-log caveat (an audit INSERT failure is logged rather than rolling back the
committed content UPDATE), the missing `og:image`/publisher logo (assets not yet
supplied), and the external Rich Results validation are all recorded in §0s for the
final security/SEO passes.

**Phase 10A** is finished, and it is **pipeline only** — no screen, no route, no
visible change anywhere. It is the secure image storage foundation the 1w library
(10B) and the editors' image selection (10C) will stand on: two Storage buckets
(`media-originals`, private, the validated masters; `media`, public, the derivatives
guests will read), a signed-upload flow whose every authoritative value — path,
type, dimensions, derivative record, uploader — is server-derived, a `<canvas>`
downscale for phone photos (an optimisation, never a security boundary), sharp
re-encoding into AVIF + WebP at 480/960/1440/2160 with orientation baked in and
EXIF/GPS stripped, and one door in / one door out at the database:
`create_image()`/`delete_image()`, replay-safe, reference-aware, audited, with
direct PostgREST writes refused by the same guard-trigger mechanism the override
deletion uses. `lib/supabase/service.ts` gained its first and only runtime caller
(`lib/images/storage.ts`), pgTAP suite `020` covers the whole authority boundary,
and a new integration suite (`npm run test:integration`, in CI's database job) runs
the pipeline end to end against the real local stack. Technical plan §0t records
the phase, including what it deliberately does not contain.

**Phase 10B** is finished: **Billeder** (`/admin/billeder`) is frame 1w's library —
Staff and Owner alike. The 10A pipeline is mounted for real: choose a photo, the
browser downscales it to at most 2560 px, one signed PUT carries it to the private
bucket, and an authenticated finalize validates the bytes and renders the public
derivatives — with honest Danish states the whole way (forberedes, uploader,
behandles, and refusals that keep the filename and the reason on screen; no
invented percentages). The library shows the smallest public derivative as each
thumbnail, says where every image is used ("Bruges på: Odin" — derived from the
four `image_id` relationships by id, never from text), and offers the three
manageable things: the **description** (`alt_text`, the one directly writable
column), **Slet** (1w's warning names every usage; a confirmed delete removes the
row, nulls every reference atomically through `delete_image()`, and then removes
the files), and **Erstat** (the new image uploads completely first, then
`replace_image()` — the phase's one migration — repoints every reference and
removes the old row in one transaction, and only then do the old files go).
Staff still see no file sizes, formats or pixel measurements anywhere, exactly as
1w promises. The signed-upload token's real behaviour is measured and pinned by
the integration suite (two-hour SDK-fixed lifetime; a same-path replay cannot
overwrite, before or after finalize), and a 29.7-megapixel original is driven
through the real pipeline on every integration run (~2 s locally; the route
carries `maxDuration = 60`). Technical plan §0u records the phase.

**Phase 10C-1** is finished: images are a real content field in the four approved
editors. Every photo slot — the dish panel's (1r), Ugens ret's (1ag), Månedens
burger's (1ah) and the news editor's (1s) — is one shared pair: `ImagePickerField`
(the slot, empty or chosen, with "Vælg billede" / "Skift billede" /
"Fjern billede") and `ImagePickerDialog` (the library's thumbnails as one
server-rendered modal form; uploading stays on `/admin/billeder`, which it links
to). For the three draft entities a selection is an ordinary draft change: the
guest keeps the published photo until Offentliggør, "Fjern billede" is a pending
removal that never touches the library, and the phase-4 publish merge moves the
field live. News follows its own accepted model — a draft article's photo stays
invisible; a published article's photo change is live when saved, through the one
news save path. Because a pending draft can now hold an image id, the reference
model was made whole: `public.image_references` (one SECURITY INVOKER view — four
live columns, three draft keys) is the single definition of "referenced" for the
library's captions ("Bruges på: Odin", "Odin (kladde)" for a draft-only usage)
and for `delete_image()`'s refusal count, a confirmed delete clears exactly the
`image_id` key out of every draft naming the image (every other pending field
byte-identical), and `replace_image()` moves draft selections old→new alongside
the live columns. pgTAP `022` proves every live/draft combination; nothing public
renders an image yet — that, with the read-model projection and the image-write
cache coupling, is 10C-2. Technical plan §0v records the phase.

**Phase 10C-1 hardening** closes the one finding 10C-1 had left for the audit: a
Staff or Owner JWT can no longer move a published `image_id` on `dishes`,
`weekly_special` or `monthly_burger` with a direct PostgREST write. The phase-1
grants stand (the SECURITY INVOKER transitions spend them); a BEFORE
INSERT/UPDATE OF `image_id` guard refuses any movement of the live column that
did not come from `publish_*()`, `replace_image()` or a confirmed
`delete_image()`, recognised by a statement-scoped marker that an AFTER
STATEMENT trigger spends — one statement, however many rows, so a global
replacement stays atomic. `delete_image()` now detaches the three guarded
columns itself before its DELETE; news is deliberately unguarded (its
direct-edit model is phase 9's). pgTAP `023` proves the door from every JWT and
the hygiene of the marker. Technical plan §0w records it.

**Phase 10C-2** is finished: the public site renders the selected photos. Every
approved entity slot — the menu's dish cards and Månedens burger card, the
Forside's three featured burgers and its Månedens burger feature, Ugens ret,
the news list, the Forside teaser and the article page — renders the library
image through one server component (`SiteImage`): a `<picture>` with an AVIF
source and a WebP `<img>` over the processed 480/960/1440/2160 ladder, `sizes`
from the slot's real width, intrinsic `width`/`height` inside the same
aspect-ratio box the placeholder reserved, the library's `alt_text` (or
`alt=""` when none is authored), lazy below the fold, no JavaScript, no
`next/image`, no proxy, and never the private original. A Draft Mode preview
renders the pending selection through the same model; the guest keeps the
published one. A published article's image is its `og:image` and its
`NewsArticle` JSON-LD `image` (one derivative, one row); an article without one
carries neither. The library is now coupled to the public cache: the alt edit
expires the tags of the image's live usages, and `delete_image()` /
`replace_image()` return the live references they themselves moved (migration
`20260901220000`, pgTAP `024`) so the Server Actions expire exactly those tags
after the commit and before the files go — the first guest request after every
public-changing image operation carries the new state, and draft-only usages
expire nothing. `tests/e2e/public-images.spec.ts` walks all of it at 375 and
1440. Technical plan §0x records the phase.

**Phase 10 is complete and locked** (technical plan §0y, 2026-09-02): the four
increments were read as one system, walked end to end against a production build
as Owner, Staff and guest, and certified by one clean regression chain. The lock
pass settled the two no-image frames the design draws — a news item without a
photo gets 1j/1n's **date circle**, and Ugens ret without a photo leaves **no
empty image slot** (1af) — classified the alt-edit post-write read as harmless
(the entity's own publication invalidation covers every interleaving), recorded
`replace_image()`'s any-successor authority, the never-finalized originals, the
best-effort storage cleanup and the two-hour session-unbound upload token as the
carry-forwards for the final security audit, and cleaned one literal NUL byte
out of the library's usage keys.

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
Owner bootstrap is a separate command, `npm run launch:bootstrap-owner` (phase 14A): it
refuses the local stack, requires the production project's host as its confirmation,
sends the same Danish invitation the administration sends — the Owner chooses their own
password — and is inert once any Owner exists. `docs/runbooks/owner-handover.md` is the
operator's document; `tests/launch/bootstrap.test.mjs` drives it against the local Auth
server in its loopback-only harness mode.

`npm run db:reset:full` runs both steps in the right order.

Password reset is fully testable locally: request one at `/admin/glemt-adgangskode`,
then open the mail catcher at `http://localhost:54324`. The Danish template lives in
`supabase/templates/recovery.html` and is applied through `supabase/config.toml`.

So is an invitation (phase 11C): sign in as the owner, open `/admin/brugere`, invite a
`@example.test` address, and read the e-mail in the same mail catcher — its link lands
on `/admin/bekraeft?type=invite`, which establishes the session server-side and asks
the person to choose a password. The template is `supabase/templates/invite.html`.
Changing either template needs `supabase stop` + `supabase start`; a `db reset` does
not reload the Auth container. Test suites that create identities delete them again
through `tests/support/local-auth-admin.ts`, which refuses every host but loopback and
every address outside `@example.test`; if an interrupted run leaves one behind,
`npm run db:users` restores the seeded pair and the leftover can be removed in Studio.

## Checks

```bash
npm run check          # typecheck + lint + source policy + unit tests
```

```bash
npm run check:all      # the above, plus `next build` and the full Playwright suite
```

Individually: `npm run typecheck`, `npm run lint`, `npm run check:policy`, `npm test`,
`npm run build`, `npm run test:e2e`. Database permission tests are separate because they
need Docker: `npm run db:test` — and so is the image-pipeline integration suite,
`npm run test:integration`, which runs against the same local stack. CI runs all of
them plus `npm audit --audit-level=high` and CodeQL.

```bash
npm run backup:drill   # phase 13A: backup, destroy, restore, prove — resets the local stack twice
```

```bash
npm run launch:drill   # phase 14A: the three launch commands in harness mode — resets the local stack twice
```

The launch drill (`tests/launch/`, `vitest.launch.mts`) runs `scripts/launch/migrate.mjs`,
`load-content.mjs` and `bootstrap-owner.mjs` with `--local-harness` against the local
stack — the production code with its target guard inverted to loopback-only, never
weakened — and is the last step of CI's database job. Their pure rules are unit-tested
under `tests/unit/launch/`, and `tests/unit/policy/launch-boundary.test.ts` pins that
migration, content load and Owner bootstrap stay three separate commands, that no
launch tool names the development seed layer, and that the launch tools sit outside
the runtime import graph. The production commands themselves (`npm run launch:migrate`,
`npm run launch:load-content`, `npm run launch:bootstrap-owner`) refuse the local stack
and need their own confirmation variable naming the target project's host
(`.env.example`, `docs/runbooks/launch-notes.md`).

The drill (`tests/backup/drill.test.ts`) runs the real backup and restore commands
against the local stack and is the last step of CI's database job. It refuses every
host but loopback, and it ends with `npm run db:reset:full`, so run it when you can
spare the local database. `npm run backup -- --out ./backups` takes a recovery point
of the local stack by hand (Docker or a PostgreSQL 17 client needed); the production
schedule, the destination and the restore sequence are in `docs/runbooks/`.

`npm run test:e2e` builds the site and serves it on port 3100. The read-only projects
(`desktop`, `mobile`, `no-javascript`) run first; the projects that write to the database
run after them, one after another, and each restores what it moved. The axe suites in
`tests/a11y/` run inside the `desktop` (1440 px) and `mobile` (375 px) projects, so every
accessibility assertion is made at both widths.

The security hardening of phase 13B has its own suites: `supabase/tests/029` (the
limiter's SQL, including a two-session race), `tests/integration/rate-limit.test.ts`
(the application door over real sessions), `tests/e2e/security-headers.spec.ts` (the
header policy beside the cache header on every response class, and a CSP walk of the
public site and the administration, read-only at both widths) and the `security`
Playwright project at the tail (an upload under the CSP, two refusal stories, the
sign-in throttle). The browser stories fill and empty counters through the
loopback-only door in `tests/support/local-auth-admin.ts`; a run interrupted mid-story
can leave a full bucket — `npm run db:reset` empties it.

Phase 13C's server-side monitoring has its own suites too: `tests/unit/monitoring`
(the settings, the sanitizer, the classifier, the storm boundary, and the whole
boundary driven through the real SDK client over a recording transport — no
network, no real project), `tests/unit/policy/monitoring-boundary.test.ts` (server
only, one door, errors only) and `tests/e2e/monitoring.spec.ts` (the built site
makes no monitoring request, loads no monitoring chunk, sets no monitoring cookie
and needs no CSP change). Monitoring is off in every test run and in local
development — there is no DSN — so nothing an automated run does can reach a real
Sentry project. `docs/runbooks/monitoring.md` is the operator's document.

`npm run check:policy` enforces five repository rules from the technical plan:

1. **No hard-coded domain.** A site origin may only be produced by
   `lib/config/site.ts` (§10d). The restaurant's domain is deferred; choosing it later
   is setting `SITE_URL`, not a code change.
2. **No `set -x` in workflows** (§8) — it echoes commands and can spill secrets.
3. **No stray secret access.** The secrets in §10e may only be read through
   `lib/env/server.ts`, which imports `server-only`, so a client import is a build
   error (§8).
4. **No browser monitoring.** No `instrumentation-client` or client Sentry config
   file, no build wrapper around `next.config.ts`, no `NEXT_PUBLIC_…SENTRY…`
   variable, no Replay or browser-tracing integration anywhere (§1, §12, §0aj).
5. **No development seed in the launch path** (phase 14A). No launch tool and no
   workflow names `supabase/seed/development.sql` or the local user seeder, and
   `supabase/seed/confirmed.sql` holds no `@example.test` identity.

## Layout

```
app/
  layout.tsx          root layout — lang="da", the three approved fonts
  sitemap.ts          /sitemap.xml — the six public pages + published news (§11, 9B)
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
    billeder/         Billeder (phase 10B) — frame 1w's library on one URL-driven page;
                      upload request/finalize, alt text, delete and replace are four
                      vocabularies in four action files, and the browser never names a
                      storage path, a dimension or an image id for creation
    forsiden/         Rediger forsiden (phase 11A) — frame 1u on one URL-driven page,
                      Owner only; the three text cards, the three photo slots (the
                      10C-1 picker pair) and the featured list are four vocabularies
                      in four action files, and the browser never names a dish by
                      anything but its id
    mad-ud-af-huset/  Mad ud af huset (phase 11B) — frame 1aj, Staff and Owner; the
                      switch, the text, the photo slot, the free sections and the
                      button label are five vocabularies in five action files, and
                      the switch is a draft that goes live with Offentliggør
    kontakt/          Kontaktoplysninger (phase 11B) — frame 1v, Owner only; one form
                      over the phase-1 site_contact row, Kladde → Offentliggør, with
                      Offentliggør greyed until something waits
    om-os/            Om os (phase 14B1) — the editor for frame 1i's page, Staff and
                      Owner; three cards (Historien, Holdet, Køkken og tilberedning),
                      each with its photo slot (the 10C-1 picker pair), three
                      vocabularies in three action files; the phase-4 content screen
                      (`indhold/`) retired with it
    login/ ejer/ ingen-adgang/ glemt-adgangskode/ ny-adgangskode/ bekraeft/
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
  admin/news/         Nyheder (phases 9A + 9B). The list rows, the editor form, the
                      shared confirmation dialog, the state badge — and 9B's two client
                      components: the B/Link body field (with its DOM-translation
                      module) and the autosave controller. No business rules here:
                      the editor's rules are lib/news/editor-model.ts, autosave's are
                      lib/news/autosave.ts.
  admin/hours/        Åbningstider (phases 8A + 8B). The seven weekday rows, the one-off
                      change card, and this screen's
                      notices. Zero client components: a closed row hides its two
                      dropdowns with a sibling selector, not with a script.
  admin/home/         Rediger forsiden (phase 11A). The text card, the featured list,
                      the dish picker and this screen's notices. No business rules
                      here: the document's are lib/pages/home.ts.
  admin/takeaway/     Mad ud af huset (phase 11B). The visibility card, the text card,
                      the sections editor, the button card and the notices. The
                      document's rules are lib/pages/takeaway.ts.
  admin/contact/      Kontaktoplysninger (phase 11B). One editor and its notices; the
                      rules are lib/contact/editor.ts.
  admin/PendingBand   The three pending marks every draft editor draws — the band,
                      the bar's pill, the card badge — shared since phase 11B.
  admin/images/       Billeder (phase 10B). The grid, the thumbnail <picture>, the detail
                      panel, the delete confirmation — and the one client component the
                      upload needs (a signed PUT cannot be a form post). No business rules
                      here: the library's are lib/images/library.ts, the upload states'
                      are lib/images/upload-flow.ts.
  site/announcement/  the public bar, its labelled aria-live region, and the expiry
                      guard — the only client component phase 7 adds (§7c)
lib/
  config/site.ts      the only place an absolute site URL is produced
  seo/                titles and descriptions; 9B adds the news article's canonical/OG
                      metadata, the NewsArticle JSON-LD builder and the pure sitemap
                      composition
  env/server.ts       the only place a server secret is read
  supabase/
    config.ts         the public URL and anon key
    server.ts         request-scoped client (user JWT) + cookie-free public client
    service.ts        service-role client, behind `server-only`. One runtime caller:
                      lib/images/storage.ts (phase 10A), enforced by a policy test.
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
  news/               the news rules (phases 9A + 9B): `slug.ts` is §7f letter for letter,
                      `body.ts` both body dialects (plain text ↔ structured paragraphs, and
                      the structured JSON the 9B editor submits, strictly re-parsed),
                      `editor-model.ts` what B and Link mean over the stored spans,
                      `autosave.ts` the pure autosave machine and its Danish status lines,
                      `lifecycle.ts` every sentence the screen says about state, and
                      `admin.ts` the writes — creation, the direct edit the draft machinery
                      cannot do for an entity with no draft column, and the two trusted
                      transitions
  images/             the image pipeline (phase 10A, §0t) and library (10B, §0u).
                      `rules.ts` and `derivatives.ts` are the pure half — limits,
                      accepted types, the path grammar, the AVIF+WebP ladder, the
                      Danish refusals; `processing.ts` is the one sharp boundary;
                      `storage.ts` the one service-role boundary;
                      `signed-upload.ts`/`finalize.ts` the two flow halves the 10B
                      upload actions call; `client-upload.ts` the browser
                      downscale-and-PUT half; `library.ts` the 1w view model (usage
                      labels, thumbnail selection, alt rules, the confirmation
                      sentences); `upload-flow.ts` the pure upload state machine;
                      `admin.ts` the write wrappers over alt_text, delete_image()
                      and replace_image().
  pages/              the Forside document's rules (phase 11A): normalisation, the
                      per-section delta, the featured-list controls, the sentences —
                      and Mad ud af huset's (phase 11B): the per-key delta, the
                      visibility through the draft, the section controls
  contact/            the Kontaktoplysninger editor's rules (phase 11B): 1v's seven
                      fields, the schema's refusals bound per field, the delta
  hours/ time/        the pure time engines
  schemas/            the Zod shapes every write is re-parsed against
scripts/
  check-source-policy.mjs
  seed-local-users.mjs   local Owner/Staff identities via the supported admin API
  clear-data-cache.mjs   development only — see "Getting started"
  launch/                phase 14A — the three production launch commands:
                         migrate.mjs (the migration door), load-content.mjs (the
                         one-time confirmed-content load), bootstrap-owner.mjs
                         (the first Owner, by invitation); lib/ holds their pure
                         rules; every target confirmed, the local stack refused
supabase/
  config.toml       local stack: public signup off, no realtime, mail catcher on
  migrations/       schema, RLS, the draft/publish core, immediate sold-out, soft
                    delete, the weekly-special admin, the monthly-burger admin, the
                    announcement admin, the one-off override admin, the announcement
                    replacement mechanism, its column-level write guard, generated-
                    announcement ownership, the news admin (unpublish + delete),
                    the image storage foundation (buckets + the trusted image doors),
                    and the image replacement transition (10B)
  seed/
    confirmed.sql   the confirmed contact, opening-hours and menu facts — the ONE
                    source; loaded first locally, once in production (phase 14A)
    development.sql the placeholder pages, News and weekly state — local only,
                    never a production path
  templates/        Danish auth emails, versioned and applied through config.toml
  tests/            pgTAP — the §5 permission matrix, the owner invariant, and every
                    write path phases 4–10A added
tests/
  unit/             the pure rules, under Vitest
  integration/      the image pipeline against the real local stack (phase 10A),
                    plus the signed-token lifetime/reuse contract and the
                    near-maximum large-image runtime (10B) —
                    `npm run test:integration`, needs Docker like pgTAP
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

Accounts (phase 11C) are two rows in two systems: Supabase Auth owns the identity
(e-mail, password, sessions, the ban), `public.profiles` owns the authorisation (name,
role, `disabled_at`). The role and the active state move only through
`set_account_role()` / `set_account_active()` — a direct write is refused for the Owner
too — and the last active owner cannot be demoted or deactivated, under a lock. The
Auth Admin API is reached from exactly one server module, `lib/accounts/auth-admin.ts`.

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
no plan-specific API is used. What the repository *does* hold since phase 14A (§0al) is
the wiring a production project is brought up with: the migration door
(`npm run launch:migrate`, and `.github/workflows/production-migrate.yml`, dispatch-only
until phase 14C creates the protected `production` environment and adds the push
trigger), the one-time confirmed-content load, and the one-time Owner bootstrap — each proven
against the local stack only, none of them run against anything hosted. The static
map and its launch guard, also wired in phase 14A, were retired in phase 14B3 and
replaced with the official Google Maps embed for the restaurant's own listing
(`components/site/GoogleMap.tsx`) — a fixed link, no licensed asset and no API key
ever needed after all.

## Deferred to a later phase

The SEO verification against Rich Results, the final security audit over the
carry-forwards §0ak lists, and the rest of launch. **Phase 14A — production wiring in
the repository — is built and green (§0al):** the Owner bootstrap through the phase-11
invitation (no password generated, ever; inert once an Owner exists; its partial states
repaired by rerunning), the seed split into `supabase/seed/confirmed.sql` and
`supabase/seed/development.sql`, the one-time confirmed-content loader with its
fresh-state guard and single transaction, the migration door with the restore
tooling's history discipline and a dispatch-only production workflow, and the three
runbooks (`domain-cutover.md`, `owner-handover.md`, `launch-notes.md`). The launch
map guard built in this phase was retired in phase 14B3 along with the static map
it protected. **Phase 14B1 — the Om os editor at `/admin/om-os` — is built and
green (§0am):** Staff and Owner edit 1i's story, team and method words and choose the
facade, team and kitchen photographs through the shared picker; the about document is
strict at every level, its three image paths live in `image_references`, the guard and
the two image transitions like every other page's, and the phase-4 content screen is
gone. **Phase 14B2 is done (§0an, §0ao):** the real logo and the supplied photographs
went in through the editors, with temporary factual Danish launch copy; the team and
kitchen sections render text-only where the restaurant has no photograph, by design.
**Phase 14B3 is done (§0ap, §0aq):** the licensed static map and its build guard are
replaced by the official Google-generated embed — no API key, ever. **Phase 14C did
its repository half and stopped (§0ar):** the environment audit, the deferred-E2E
investigation and a full local certification are complete, but every hosted step is
blocked because **no external infrastructure exists yet** — no GitHub remote, no
Vercel project, no hosted Supabase, no Resend, no Sentry, no backup destination and no
domain. `docs/runbooks/launch-notes.md` §9 holds the measured inventory and the ordered
manual setup groups. Phase 14 is **not** complete: 14C's hosted half and 14D (the lock)
remain, and nothing hosted is provisioned.
**Phase 13 is locked (§0ak):** the
runbooks under `docs/runbooks/` are current, and `pre-launch-checklist.md` is the one
list of gates the repository cannot close by itself — the backup destination (§13 item
A), the hosted restore rehearsal, `RATE_LIMIT_SECRET`, the HSTS scope, the real Sentry
project and its one controlled event. The weekly off-platform backup workflow and the
restore drill are built (phase 13A, §0ah). **Phase 13C is built and green (§0aj):** the server reports
unexpected failures to Sentry — pages, route handlers, Server Actions and the proxy
through the framework's `onRequestError` hook, plus a closed list of operational
events (the limiter that cannot answer, an account banned in one system and not
the other, an orphaned file after a commit) — with the release and the environment
on every event, one central sanitizer, no user identity, and no browser SDK;
`docs/runbooks/monitoring.md` says what is collected, what never is, and the one
production test that remains a pre-launch gate. **Phase 13B is built and green (§0ai):**
every Server Action and the sign-in path are rate-limited by a PostgreSQL-backed limiter
(twelve tiers, one atomic door, the sign-in attempt reserved before the Auth server is
asked and released after a success, HMAC subjects, `RATE_LIMIT_SECRET` required on
Vercel), and every response carries the security-header policy — CSP, HSTS,
nosniff, referrer, permissions and frame denial — with the public caching intact;
`docs/runbooks/production-security.md` lists what the production project must be
configured with before launch.
`docs/dependencies.md` records which package arrives in which phase. Phase 6 is
**complete and locked** — 6A (Ugens ret and
Lørdagsmenu, §0c), 6B (Månedens burger, §0d), and the completion pass over both halves
(§0e). Phase 7 is **complete and locked** — 7A (§0f), 7B (§0g), and the completion pass
over both halves (§0h). Phase 8 is **complete and locked** — 8A (§0i), 8B (§0j), 8C-1
(§0k) and its hardening pass (§0l), 8C-2 (§0m), 8C-3A (§0n), 8C-3B (§0o), and the
completion pass over all seven (§0p). Phase 9 is **complete and locked** — 9A (§0q),
9B (§0r), and the completion pass over both (§0s). Phase 10 is **complete and locked** —
10A (§0t), 10B (§0u), 10C-1 (§0v, hardened in §0w), 10C-2 (§0x), and the completion
pass over all four (§0y). **Phase 11A — the Forsiden editor at `/admin/forsiden` — is
built and green (§0z)**: the Owner edits 1u's four cards, chooses the hero, award and
team photographs through the shared picker, and features up to three dishes from the
menu by id; the Forside's image references live in the same `image_references` view,
the same delete/replace transitions and the same cache mapping as every other image.
**Phase 11B — Mad ud af huset at `/admin/mad-ud-af-huset` and Kontaktoplysninger
at `/admin/kontakt` — is built and green (§0aa)**: Staff and Owner edit 1aj's
switch, words, photograph, free sections and button label, and the switch is a
draft like everything else on the frame — a guest keeps the page and the menu item
until Offentliggør, and the FIRST request afterwards loses (or regains) the page,
the navigation item and the sitemap entry together; the Owner edits 1v's five facts
over the phase-1 `site_contact` draft row, and a published number reaches every
Ring control as a derived `tel:` link on the first request. The 11A finding about
nested keys is closed for the takeaway sections (strict objects, refused at every
door) and was left open for Om os until phase 14B1 closed it. **Phase 11C — the user administration
at `/admin/brugere` — is built and green (§0ab)**: the Owner invites by name,
e-mail and role (the Auth server sends the Danish e-mail; the person chooses their
own password), changes a role, deactivates — never deletes — and reactivates, with
the last-active-owner invariant refused under a lock, the sessions of a deactivated
person revoked in the same transaction, and the identity banned. **Phase 11 is
complete and locked** — the completion pass over 11A–11C (§0ac) read the three as one
system, walked them as Owner, Staff and guest against a production build, audited
1u / 1aj / 1v at 375 / 768 / 1440, reviewed the account security model as a set and
closed the phase with one clean regression chain.

**Phase 12A — the Menu administration on a phone as the primary device — is built
and green (§0ad).** The whole `/admin/menu` workflow was walked at 375 px as Staff
against a production build and measured, not eyeballed: the ten-second Fortryd
strips and the pending band now sit in **1y's foot** — pinned to the bottom of the
phone screen, visually last, first in the DOM — so an immediate Udsolgt or Slet ret
pressed deep in a list, or inside the editor, leaves its Fortryd on screen the moment
it starts (it was 302 px and 78 px above the viewport before); the band is 1y's one
row; the longest content the schema allows (a 200-character unbroken name,
"9.999,99 kr.") wraps instead of scrolling the page sideways; a moved row stays in
view after Flyt op (the root layout now carries Next 16's documented
`data-scroll-behavior="smooth"`, so the router's scroll to the top is no longer an
animation the page's own effects measure against); the deletion confirmation stacks
its two choices with the safe one first; and "Luk" is 44 × 44. Phase 5's semantics,
the desktop frame 1r and every locked phase-5 suite are unchanged;
`tests/e2e/menu-mobile.spec.ts` runs the Staff story under its own `menu-mobile`
project at the tail of the chain.

**Phase 12B — the News administration on a phone as the primary device — is built
and green (§0ae).** The whole `/admin/nyheder` workflow was walked at 375 px as Staff
against a production build and measured against frame 1z: the editor's burgundy bar is
now **pinned** to the top of the phone screen with the Kladde/Udgivet badge on its
first row and the autosave line on a reserved second row, so "Gemt — ændringerne er på
hjemmesiden" is in view while a published article is edited at its end (it was
2,861 px above the viewport before); the **B / Link toolbar and its link panel stick
under the bar**, so formatting is one tap away however long the article and the panel
opens beside the selected words instead of at the top of the box; fragment targets
land under the pinned bar; the publish, unpublish and delete confirmations stack their
two choices with the safe one first; a 200-character title wraps on the list card, in
the §7f address line and in the confirmation's question; and the public article
paragraph wraps an unbroken run instead of scrolling the phone sideways. Phase 9's
semantics — no draft column, published edits live on save, the autosave machine, the
frozen slug, B and Link only, `https:` only — the desktop frame 1s and every locked
phase-9 suite are unchanged; `tests/e2e/news-mobile.spec.ts` runs the Staff story
under its own `news-mobile` project at the tail of the chain.

**Phase 12C — the dashboard on a phone, and the rest of the phone's operational
screens — is built and green (§0af).** `/admin` is now frames 1x and 1q: the burgundy
bar with the account, the amber band ("2 ændringer er ikke offentliggjort" with
Forhåndsvis and Offentliggør, and the phase-4 per-item list beneath it), "Hej — hvad
vil du lave?" over today's hours, the announcement card reading the published state
with "Rediger besked", the tiles — 68 px rows on the phone, a grid from 768 — named by
the words on them (Rediger menu, Skriv en nyhed, Åbningstider, Billeder, Mad ud af
huset, …; Rediger forsiden, Kontaktoplysninger and Brugere for the Owner), and LIGE NU.
The dashboard is a **read model** over the locked systems (`lib/admin/dashboard.ts`):
no table, no cache, no metric the frames did not draw, and which tiles a person sees
comes from the entity registry's `requiredRole` through the same `mayChangeEntity()`
the publish action asks — a courtesy, never a permission. The phase-4 "Åbn …" links
are gone, and the twelve locked suites that addressed them were migrated to the tiles'
names in the same commit. The audit of the other operational screens at 375 px found
one defect four times over — Ugens ret, Månedens burger, Besked på hjemmesiden and
Åbningstider all redirected to a card's fragment and left their ten-second Fortryd
strip and their status notice above the viewport (115–1,694 px) — and closed it with
one shared foot (`components/admin/NoticeFoot.tsx`, 12A's inline container made a
component the Menu uses too): sticky to the bottom of the phone screen, first in the
DOM, an ordinary block from `md`. The image library and the phase-11 editors were
green and untouched. `tests/e2e/dashboard-mobile.spec.ts` runs the Staff and Owner
story under its own `dashboard-mobile` project at the tail of the chain.

**Phase 12 is complete and locked (§0ag).** The completion pass of 2026-09-04 read
12A–12C as one system and walked it as Owner and Staff on a phone against one
production build — the dashboard into every operational screen and back, measured
rather than eyeballed — and re-checked 1x / 1y / 1z / 1q at 375, 768 and 1440. It
closed the recorded observations: **Forhåndsvis stays in the phone's menu bar** (1y
draws none, but the only preview the frames give a phone is the dashboard band's, which
exists only while something is pending — recorded as an intentional departure); the
**menu row moved with Flyt op / Flyt ned now lands wholly in view** (its name was 53 px
above the viewport before, 204 px for the longest name — the handle's focus recovery
scrolls the row, not the control); the **news bar's variable height under a conflict**
is measured, the B/Link toolbar follows it exactly and the value leaves `<html>` with
the editor; the **1 px `scrollY` observation** was reproduced as layout rounding and
its one exact-equality assertion replaced by a geometric one; the **three phase-11
content editors, and Brugere, got the same foot** the four phase-12C screens have (their
Gem left "gemt som kladde" 244–2,005 px above the phone's viewport); an **empty foot no
longer reserves scroll clearance**; the one-off list's "Ret" link is 44 px wide; and a
real defect in the phone-first news flow — **autosave silently dead after the first Gem
of a just-created article, with the bar still saying "Gemt for lidt siden"** — was found,
fixed with one React `key`, and pinned in `news-mobile`. One clean regression chain
closed the phase. What phase 13 starts from is at the end of §0ag.

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
(`/admin/menu/maanedens-burger`) have since been built by phase 6, the image
library by phase 10B, image **selection** by phase 10C-1 — every approved
editor owns its photo slot through the shared picker — and public **rendering**
by phase 10C-2: every dish, the weekly card, the monthly burger and the news
surfaces render the selected library photo from the derivative ladder, and the
no-image states are the ones the frames draw (§0y). One design sentence stays
open for the photography pass: 1r's "uden foto vises retten som en ren linje"
for a burger the restaurant leaves without a photo — the public frames draw the
reserved frame for it today, and that is what ships.

One thing is deferred with **no phase** at all: there is no editor for a menu *category's own*
content — its name, intro, note or order. The chips navigate between sections and a dish
can be assigned to one; changing what a section says is a screen the approved design file
does not draw, and it should be designed before it is built. The data path for it already
exists and is tested (`menuCategoryDraft`, the `menu_category` publishable entity).
