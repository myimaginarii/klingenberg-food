# Dependency and version record

Required by technical plan §14 ("Record the chosen versions and the date of the
advisory check in the repository, not here").

## Advisory check — 2026-09-01 (phase 10A addition)

One runtime dependency was added for phase 10A (the image storage foundation,
technical plan §0t). Nothing already installed was changed, and no development
dependency was added.

| Package | Version | Why |
|---|---|---|
| `sharp` | 0.35.4 | §1 (adjustment 3) names it: "Server re-encodes with `sharp` into a fixed derivative ladder (AVIF + WebP at 480/960/1440/2160) and strips EXIF including GPS." The one image decoder/encoder in the system, imported by exactly one module (`lib/images/processing.ts`, enforced by `tests/unit/policy/images-boundary.test.ts`). |

Pinned exactly. **The lockfile already resolved this exact version**: `next@16.3.3`
declares `sharp: ^0.35.3` as an *optional* dependency, and 0.35.4 was already in
`package-lock.json` and on disk. Promoting it to a direct, pinned dependency changes
one thing that matters: our image pipeline no longer depends on Next.js continuing
to want the same library — if a future Next drops or moves its optional sharp, ours
stays. The lockfile diff is four lines (the `optional` flags), no new package and no
new transitive code. Licence: Apache-2.0; the `@img/sharp-*` platform binaries ship
prebuilt libvips 1.3.3 per platform via `optionalDependencies`, exactly as Next
already installed them.

**Advisory result: no known advisory affects the selected version.** The advisory
history worth recording: sharp below 0.32.6 bundled the libwebp affected by
CVE-2023-4863 (GHSA-54xq-cgqr-rpm3, HIGH) — 0.35.4 is three minor lines past the
fix. `npm audit --audit-level=high` over the full resolved tree after the change:
**0 vulnerabilities**.

Two behaviours the pipeline depends on, verified by the processing suite rather
than assumed: sharp copies **no metadata** to output unless `withMetadata()` is
called (nothing calls it — EXIF/GPS stripping is the default we rely on and assert
on real encoded bytes), and `limitInputPixels` makes the decoder refuse a
decompression bomb before allocation (the header-only `metadata()` sniff also
enforces it, which is why the pipeline sniffs without the limit and classifies
explicitly — recorded here because it is a version-behaviour a future upgrade must
re-verify).

### What phase 10A did not add

No upload framework, no media-library/CMS package, no client image library, no
storage SDK beyond the `@supabase/storage-js` already inside `supabase-js`, and no
queue/job service. The browser half is `createImageBitmap` + `<canvas>` + one
`fetch` PUT — platform APIs, zero packages. `file-type`/magic-byte libraries were
considered and refused: sharp's own decoder *is* the byte-sniffing authority, and a
second opinion about what the bytes are would be a second answer to §8's one
question.

### `npm audit --audit-level=high` — clean

Run after `npm install` re-resolved the tree: **0 vulnerabilities**.

---

## Phase 9 completion pass — no dependencies added (2026-09-01)

The lock pass over 9A and 9B (technical plan §0s) changed no dependency and no
lockfile byte. Its one product fix — the read layer returning span text verbatim
instead of trimmed (`lib/content/news.ts`) — removed a call to a helper rather than
adding anything, and the regression suite it added
(`tests/unit/content/news-read.test.ts`) uses the toolchain already present. Nothing
here re-opened the 9A/9B refusals (editor engine, sanitizer, slugify, client state,
JSON-LD helper, sitemap generator); the defect the pass caught was in eleven characters
of our own projection code, which is exactly where a dependency would not have helped.

### `npm audit --audit-level=high` — clean

Run against the unchanged lockfile: **0 vulnerabilities**.

---

## Phase 9B — no dependencies added (2026-09-01)

**The rest of phase 9** — the B/Link body editor, autosave with 1s's "Gemt for lidt
siden", the `NewsArticle` JSON-LD, §7f's canonical and article metadata, and the
sitemap's news membership — adds **no package**. `package.json` and the lockfile are
byte-identical to the phase-9A state. This is the increment 9A's entry predicted would
be tempted hardest, so the refusals are recorded with what was built instead.

**A rich-text editor** (`tiptap`, `lexical`, `prosemirror`, `slate`), refused again and
now with the alternative in hand: the editing surface is one `contenteditable` region over the
stored two-mark span shape. Every rule — what toggling B means, what a link may be, how
a selection maps to the document, what a save serialises — is `lib/news/editor-model.ts`,
pure functions over `NewsBody` pinned by ~40 unit cases; the DOM translation is
`components/admin/news/body-editor-dom.ts` (~250 lines, no React); and the component
wires the two. No `document.execCommand` (deprecated), no HTML serialisation in either
direction — the DOM is *walked* into typed spans, so pasted markup contributes its
characters and nothing else, and the public renderer still needs no sanitizer (§8). An
editor engine would have solved arbitrary nested documents; this schema has exactly two
marks by design (§7f), and an engine is also where headings, lists and paste-as-HTML
come from — the features frame 1s's own caption forbids.

**A client data-fetching or state library** (`swr`, `react-query`, `zustand`) for
autosave. The autosave problem — debounce, one request in flight, stale responses,
optimistic concurrency — is the shape those libraries advertise. It is instead a pure
state machine (`lib/news/autosave.ts`, ~90 lines) whose transitions are unit-pinned,
run by one controller component calling the same Server Action path the Gem button
posts to. A cache library would have been a second opinion about freshness in a system
whose freshness rules (§6's version token, §20's tag expiry) are already stated
server-side — and §1 (adjustment 4) forbids it by name anyway.

**A JSON-LD/schema.org helper** (`schema-dts`, `react-schemaorg`). The block is five
fields restating stored values (§11: "nothing invented"), built by
`lib/seo/news-article.ts` and serialised with a three-character escape so it renders as
an ordinary React text child — no `dangerouslySetInnerHTML` (§8), which is the API every
JSON-LD helper reaches for.

**A sitemap generator** (`next-sitemap`). `app/sitemap.ts` is Next's own metadata route
over a pure composition module (`lib/seo/sitemap.ts`); §11's whole requirement is six
static paths plus the published articles the tagged read already returns.

### `npm audit --audit-level=high` — clean

Run against the unchanged lockfile: **0 vulnerabilities**.

---

## Phase 9A — no dependencies added (2026-09-01)

**The news administration's core** — the list, the editor, §7f's slug policy, per-item
publish/unpublish behind confirmations, delete, and the per-article preview target —
adds **no package**. `package.json` and the lockfile are byte-identical to the phase-8
lock. News is the phase people most expect to arrive with a CMS's luggage, so the four
dependencies that were considered are recorded with the reason each was refused.

**A rich-text editor** (`tiptap`, `lexical`, `prosemirror`, `slate`). §7f fixes the body
to structured JSON with exactly **B and Link** — no headings, no HTML, no paste-as-HTML,
and therefore no sanitizer to get wrong. Every editor library above is an engine for the
general problem 9A does not have: arbitrary nested documents. Phase 9A's field is one
`<textarea>` whose blank lines become paragraph nodes (`lib/news/body.ts`, two pure
functions with a round-trip identity the unit suite pins), and 9B's B/Link toolbar is a
small client component over `document.execCommand`-free selection handling on a shape of
two marks — not a document model worth an engine. A library here would also have put the
first heavyweight client bundle into an administration that is otherwise Server
Components and forms.

**A slugify library** (`slugify`, `@sindresorhus/slugify`, `limax`). §7f's rule is three
named transliterations (æ→ae, ø→oe, å→aa), a diacritic fold, hyphens and a `-2` suffix —
eleven lines in `lib/news/slug.ts`, pinned by unit tests including the Danish letters a
general library gets configurably rather than correctly by default. The database's
UNIQUE constraint and slug-grammar CHECK remain the final gate either way, so a library
could only have added a second opinion about what an address is.

**An HTML sanitizer** (`dompurify`, `sanitize-html`). Refused for the reason §7f gives:
there is no HTML anywhere in the pipeline to sanitize. The body is typed nodes in, typed
nodes out, and the public renderer (`NewsBody.tsx`, phase 3) draws them with no
`dangerouslySetInnerHTML`. The strongest sanitizer is the one with nothing to do.

**A date library, for the tenth phase running.** The news dates are a `YYYY-MM-DD`
column edited by `<input type="date">` (the value *is* the storage format) and two
stored instants rendered through `copenhagenDateOf` + `formatDanishDate`, both phase-2/3
functions. Nothing here does arithmetic at all.

### What it did add, in the repository rather than in `package.json`

  * **One migration** — `20260901120000_news_admin.sql`: `unpublish_news()` and
    `delete_news()`, both SECURITY INVOKER, both version-checked and audited, granted to
    `authenticated` and revoked from `anon`. No table, no column, no policy, no trigger,
    no SECURITY DEFINER.
  * **Four pure/domain modules** — `lib/news/slug.ts`, `lib/news/body.ts`,
    `lib/news/lifecycle.ts` (every sentence the screen says about state) and
    `lib/news/admin.ts` (the writes the draft machinery cannot do for an entity with no
    draft column, plus the two trusted transitions). One strict schema,
    `lib/schemas/news.ts`, and one admin read, `lib/content/news-admin.ts`.
  * **Five components and one screen** — the list, the editor form, the shared
    confirmation dialog, the state badge, the status notice, and
    `app/(admin)/admin/nyheder/` with four Server Action files, each its own vocabulary.
  * **The reserved preview extension** — `lib/drafts/targets.ts`'s `maal=nyhed` target,
    slug-grammar-gated and existence-checked through the caller's own JWT.

### `npm audit --audit-level=high` — clean

Run against the unchanged lockfile: **0 vulnerabilities**.

---

## Phase 8C-3B — no dependencies added (2026-08-31)

**The opening-hours generated-announcement workflow** — 1t's option, 1ae's conflict sheet,
the ~10 s Fortryd, §7e item 6's removal consequence and the deletion of the 8C-1 harness —
adds **no package**. `package.json` and the lockfile are byte-identical to the phase-8C-3A
state.

It is the largest user-facing increment of phase 8 and the one most likely to have justified
a dependency, so the four that were considered are recorded here with the reason each was
refused.

**A modal/dialog library** (`@radix-ui/react-dialog`, `react-modal`, `focus-trap-react`).
1ae's rules read like a feature list: cannot be dismissed by clicking outside, traps focus,
returns focus to the control that opened it, is announced by its own name. Every one of them
is what a native `<dialog>` opened with `showModal()` already does, **from the platform** —
the backdrop is a real `::backdrop`, the rest of the page becomes inert, and the focus trap
is the browser's rather than a scroll-and-recapture loop. The administration already had
`components/admin/menu/ModalDialog.tsx` doing exactly this for Slet ret since phase 5D; 8C-3B
added **one optional prop** to it (`locked`, which suppresses `Esc` where a decision is
required) and nothing else. A library here would have replaced eleven lines with a dependency
and taken the platform's guarantees away in exchange for a script's.

**A form-state library** (`react-hook-form`, `formik`). 1t's promise — *"Retter du tiderne,
opdateres forslaget — indtil du selv har rettet i teksten"* — is the only piece of client
state in this administration, and it is three values: whether the box is ticked, what the
message says, and whether a person has edited it. The component reads the four fields above
it out of the enclosing form's own `FormData`, by name. A form library would have required
lifting the *other* twelve controls on the screen into it as well, turning a Server Component
screen into a client one to serve one checkbox.

**A state machine or workflow library.** Refused for the reason 8C-3A recorded, which 8C-3B
strengthens rather than relaxes: the multi-step operation is a plpgsql function calling a
plpgsql function, inside one transaction. 8C-3B adds a second such operation —
`remove_opening_hours_override()`, which now takes the generated announcement down *and*
deletes the override — and it is one function for the same reason. §31 of the brief asks for
no generic workflow engine, and the strongest way to obey that is to have nothing that could
become one: neither function takes a table name, a column name, a step list or a callback.

**A date/time library** (`date-fns`, `luxon`, `temporal-polyfill`). The new expiry stamps —
1t's *"søndag 06.09.2026 kl. 20:00"* and 1ae's *"06.09.2026 kl. 20:00"* — are two functions in
`lib/announcements/expiry-editor.ts`, both built on `lib/time/copenhagen.ts`, which has owned
the Intl-based Copenhagen conversion and both daylight-saving conventions since phase 2. A
library would have introduced a second opinion about what a Danish wall-clock time is.

### What it did add, in the repository rather than in `package.json`

  * **One migration** — `20260831200000_override_removal_lifecycle.sql`: a BEFORE DELETE
    guard trigger on `public.opening_hours_overrides`, the announcement write guard taught
    two more transitions by name (`detach`, `discard_previous`), and
    `remove_opening_hours_override()` re-stated with §7e item 6's confirmation bit.
  * **Two pure modules** — `lib/announcements/generated-suggestion.ts` (the one implementation
    of "what would this card say?", shared by the server and the browser) and two formatters
    added to `lib/announcements/expiry-editor.ts`.
  * **Three components** — the 1t control, the 1ae sheet and this screen's announcement
    notice. The Fortryd strip is `UndoStrip`/`AutoDismiss`, unchanged, because §14 of the
    brief asks for the existing one rather than a second toast system.
  * **Two Server Action modules and one pure route module** in
    `app/(admin)/admin/aabningstider/`.

### The direct-DELETE hardening, and why it is a trigger

8C-3A's `restore_announcement()` records `owner_missing` as *"reachable only through a direct
PostgREST DELETE"*. That sentence was the hole: §18 of the initial migration granted
`delete on public.opening_hours_overrides to authenticated`, so a staff member with their own
JWT could delete an override named only inside `announcement.previous.source_override_id` —
jsonb, which no foreign key reaches into — bypassing the version check, the ownership rules,
the audit row and the snapshot's integrity.

**The privilege cannot be revoked**, and this is the same PostgreSQL constraint
`20260831160000` recorded for the announcement's columns: a SECURITY INVOKER function
executes with the privileges of whoever called it, so the DELETE the trusted function issues
*is* the caller's DELETE. Measured from a real Staff JWT, revoking the grant refuses the
attack and the trusted removal equally. SECURITY DEFINER is forbidden by §8 and by the brief.

So the privilege stays and the **transition** is constrained: a BEFORE DELETE trigger, which
is a rule the operation must satisfy rather than a privilege — in the same family as the
table's CHECKs and its RLS policies. It runs for every deleter, a caller who does not own the
table cannot turn it off, and it recognises the trusted removal by the same transaction-local
GUC convention the announcement guard has used since 8C-1's hardening. One pattern in this
repository for *"a privilege that may only be spent by a named transition"*, not two.
`supabase/tests/018_override_removal.test.sql` proves it from real Staff **and** Owner JWTs,
including that the marker cannot be held open for a later statement.

### The temporary directory is gone

`app/(admin)/admin/intern/` **has been deleted**, together with the
`ANNOUNCEMENT_REPLACEMENT_HARNESS` flag and the `env` line in `playwright.config.ts` that set
it. Its scenarios were not deleted with it: `tests/e2e/opening-hours-announcement.spec.ts`
drives the same replacement, restore, ownership and first-guest-request assertions through
`/admin/aabningstider`, which is the screen a person actually uses.
`tests/unit/announcements/generated-boundary.test.ts` asserts over the source tree that the
address, the flag and every reference to either are gone.

### `npm audit --audit-level=high` — clean

Run against the unchanged lockfile after `npm ci`: **0 vulnerabilities**.

---

## Phase 8C-3A — no dependencies added (2026-08-31)

**Generated-announcement ownership and atomic coordination** (§0n) adds **no package**.
`package.json` and the lockfile are byte-identical to the phase-8C-2 state. It adds one
migration, one pure module, one server module and one Server Action on the existing
gated harness, and nothing else.

### The three things that would have justified a package, and why none is here

**A state machine or workflow library.** This increment coordinates a multi-step
operation — read the published override, read the published week, generate, decide a
conflict, replace, move ownership, snapshot, audit — which is the shape people reach for
`xstate` or a saga runner to express. It is a **plpgsql function calling a plpgsql
function**, and that is not a compromise: every step after the decision has to be in one
transaction, and a library that orchestrated them from Node would put a network boundary
between the write and the ownership move — exactly the two-transaction failure the brief
forbids. §8 of the brief says *"do not create a generic workflow engine"*, and the
strongest way to obey that is to have nothing that could become one:
`apply_generated_announcement()` takes no table name, no column name, no step list and
no callback.

**An ORM or query builder for the composition.** `replace_announcement()` is reused
rather than reimplemented, and the reuse is a `select public.replace_announcement(…)`
inside the coordinator. The alternative — reading the row in TypeScript, deciding, and
issuing the write from there — is what the earlier phases already refused for every
immediate path, for the reason §0e answer A records: the decision and the write would
stop being the same transaction.

**A date library, for the ninth phase running.** The coordinator reads no clock of its
own beyond a single `new Date()` handed to the 8C-2 generator, which is the one
parameter that module has for it. Every Copenhagen conversion is still
`announcementExpiryInstant()`, which is still the one `Intl.DateTimeFormat` boundary
phase 2 built.

### One migration, and what it does not contain

`20260831180000_generated_announcement_ownership.sql`:

- adds `announcement.source_override_id uuid`, a foreign key to
  `opening_hours_overrides` with **`on delete restrict`**, and
  `announcement_source_owner_check` pairing it with `source` in both directions;
- **drops `opening_hours_overrides.announcement_created`** — §0n records why one
  pointer beats a boolean that a second statement has to keep in step, and why keeping
  the boolean would have meant rebuilding §0l's column-grant-and-guard apparatus on a
  second table;
- normalises any `previous` written before it, adding the ninth key as `null` — such a
  snapshot can only be a manual one, so the value is a restatement rather than a guess;
- adds `source_override_id` to the column-level UPDATE grant, making it twelve, and
  extends `tg_guard_announcement_write()` so the pointer moves only under the same
  transition `source` does;
- adds `announcement_replacement_kind()` — the four-way answer `replace_announcement()`
  computed inline, lifted out so the coordinator asks the same question rather than a
  second one that looks like it;
- replaces `replace_announcement()` with a nine-parameter version (the ninth appended
  and defaulted to `null`, which is the safe half of the pair) that requires the named
  override to exist **and be published**;
- replaces `restore_announcement()` so ownership comes back in the same `update` as the
  eight keys beside it, and names `owner_missing` for the one case a jsonb snapshot can
  outlive;
- adds `apply_generated_announcement()` — the coordinator;
- replaces `remove_opening_hours_override()` so it refuses with `owns_announcement`
  rather than meeting a foreign-key violation.

What it does **not** contain: no table, no view, no index, no policy, no scheduled
anything, and **no SECURITY DEFINER function** — every function it touches is SECURITY
INVOKER with `set search_path = ''`, so RLS decides for every caller against their own
JWT. It writes nothing to `public.opening_hours` or `public.opening_hours_overrides`
outside the removal it was already replacing, which is what makes §7e item 8's *"no code
path can roll the hours back"* a property of the text.

**No partial unique index**, and the absence is deliberate rather than an omission:
"at most one override owns the current announcement" is structural — one singleton row,
one column, one value — and an index could only have made a duplicate unlikely to be
written somewhere there is nowhere for one to live.

### One temporary directory, unchanged in kind — since deleted

`app/(admin)/admin/intern/besked-erstatning/` gained a **third Server Action** rather than
a sibling. The brief forbade inventing a second harness, and `updateTag()` is only callable
from inside a Server Action, so proving the coordinator through the real cache path needed a
form dispatching to one. The three properties that made it safe: the environment flag,
`requireStaff()` before the flag, and no field through which the browser could choose content.

**Phase 8C-3B deleted it**, and moved its scenarios onto `/admin/aabningstider`.

### `npm audit --audit-level=high` — clean

Run against the unchanged lockfile after `npm ci`: **0 vulnerabilities**.

---

## Phase 8C-2 — no dependencies added (2026-08-31)

The **pure opening-hours announcement generator** (§0m) adds **no package**, and adds no
migration either. `package.json` and the lockfile are byte-identical to the phase-8C-1
state. `lib/announcements/generated.ts` imports six modules, all of them this
repository's own.

### The two things that would have justified a package, and why neither is here

**A date / timezone library.** For the eighth phase running, and this is the phase where
it would have been easiest to reach for one: the generator has to turn *"14.09.2026,
20:00, Copenhagen"* into an absolute instant, across both daylight-saving transitions.
It does it with **one call** to `announcementExpiryInstant()`, which is 1ad's own expiry
conversion and which resolves to `copenhagenInstantOf()` — the single `Intl.DateTimeFormat`
boundary phase 2 built and pinned with tests on the March gap and the October repeat. A
second implementation of Copenhagen would be a second answer to the one question this
system cannot afford two answers to. The suite asserts exact UTC instants in CET, in
CEST, on both transition Sundays and on the Saturday either side of each.

**A templating or i18n library.** The generated messages are two template literals over
Danish words that already exist in `lib/hours/format.ts` — `formatWeekdayName`,
`formatTimeRange`, `formatWeekdayDate` — and the site is monolingual by design (§7). The
words are the approved frames' own, asserted character for character, and a message
catalogue would put a layer between the frame and the string with nothing to gain from
it.

### Nothing was added to the runtime, because nothing calls it

The module was imported by its unit suite and by nothing else, so `next build` produced
the same route table and the same client bundles it did at `4160bb0`. **8C-3A** is the
increment that gave it a caller — `lib/announcements/generated-operation.ts`, and no
screen.

---

## Phase 8C-1 — no dependencies added (2026-08-31)

The announcement **replacement and restore mechanism** (§0k) adds **no package**.
`package.json` and the lockfile are byte-identical to the phase-8B state. It adds **one
migration**, which is recorded below.

### The three things that would have justified a package, and why none is here

**A snapshot / diff library.** `previous` is a jsonb document, which is the shape people
reach for `immer`, `deep-diff` or a patch format for. It needs none of them, because it is
not a general document: it is **eight named fields**, built by one `jsonb_build_object` and
read back by eight `->>`. A library would have made it a *general* document, which is
exactly the property this phase must not have — a snapshot that can hold anything is a
snapshot that can hold a draft.

**An undo / command-stack library.** Every undo abstraction models a *stack*, and §4 and
1ad both forbid one: *"intet arkiv, ingen kladdeliste, ingen historik"*. One level, one
column, and a second replacement overwrites it. §6 already states the model this system
uses — *"Undo is not server-held state. The change is already live; undo is simply a second
authorized write"* — and the only thing that *is* server-held here is the previous
announcement itself, which is what the column is for.

**A validation library for the stored snapshot.** Zod is already the one, and it is used:
`announcementSnapshotSchema` is a `strictObject`, which is what makes "an unknown key is a
refusal" a property of the type rather than of a reviewer's memory. What is *not* delegated
to it is the authority: `public.is_valid_announcement_snapshot()` states the same eight keys
and the same rules in SQL and runs **inside the transaction**, before a snapshot is stored
and again before one is restored. Neither layer is trusted to be the only one (§5).

### No date library, for the seventh phase running

8C-1 compares two instants — `expires_at <= now()` — in SQL, and asks
`isAnnouncementExpired` in TypeScript, which is phase 7A's function and imports nothing.
`lib/announcements/snapshot.ts` reads **no clock of its own**: `now` is always an argument,
which the unit suite asserts over its source.

### No new component, token or utility either

There is no new user-facing UI in this increment, so there is nothing to style. `UndoStrip`,
`AutoDismiss` and the Fortryd vocabulary are untouched and unread by this phase; 8C-3 is
where they get their third caller.

### One migration, and what it does not contain

`20260831140000_announcement_replacement.sql`:

- adds `announcement_snapshot()` — the eight published keys, and never `draft`, `previous`,
  `replaced_at`, `updated_at`, `updated_by` or the row identity;
- adds `is_valid_announcement_snapshot()` — the same eight keys read the other way, with
  the message length, the three link types, the six approved routes, the https-only
  address, the link shape and the two allowed sources, all restated from the columns'
  own CHECKs;
- adds `replace_announcement()` — **eight typed scalar parameters, not a jsonb document**;
  snapshot, write, `replaced_at`, `is_visible = true`, one audit row, one transaction;
- adds `restore_announcement()` — **one parameter**, the version token; the snapshot comes
  from the row.

What it does **not** contain: no table, no column, no view, no trigger, no index, no policy,
no grant on any table, no scheduled anything, and **no SECURITY DEFINER function** — all four
are SECURITY INVOKER with `set search_path = ''`, so RLS decides for every caller against
their own JWT. It names `public.opening_hours` and `public.opening_hours_overrides` nowhere,
composes no message, and writes `announcement_created` nowhere. *(That column was
dropped by 8C-3A; ownership is `announcement.source_override_id`. See §0n.)*

### One temporary directory, recorded so it is not forgotten — since deleted

`app/(admin)/admin/intern/besked-erstatning/` was an integration harness, not a screen. It
existed because `updateTag()` — the real cache path the brief required proof of — may only be
called from inside a Server Action, and a Server Action is only reachable from a rendered
form. It was behind `ANNOUNCEMENT_REPLACEMENT_HARNESS=1`, set by `playwright.config.ts` for
the test server and by nothing else; guarded by `requireStaff()` first and the flag second;
linked from nowhere; and the browser chose no content.

**Phase 8C-3B deleted it**, because the real caller is 1ae's conflict sheet and it now exists.
The boundary suite that held it to those properties is now
`tests/unit/announcements/generated-boundary.test.ts`, which asserts the opposite: that the
address, the flag and every reference to either are gone.

### `npm audit --audit-level=high` — clean

Run against the unchanged lockfile after `npm ci`: **0 vulnerabilities**.

---

## Phase 8B — no dependencies added (2026-08-31)

The one-off opening-hours override (§0j) adds **no package**. `package.json` and the
lockfile are byte-identical to the phase-8A state. It does add **one migration**, which is
the first schema change since phase 7B and is recorded below.

### The two things that would have justified a package, and why neither is here

**A date picker.** 1t draws one field labelled *Dato*, and `<input type="date">` is that
field: it is the control the phone already has, its value is exactly the `YYYY-MM-DD` the
column stores, and where a browser has none it degrades to a text field the server parses
anyway. The three reasons `components/admin/Field.tsx` recorded for 1ah's period window
apply unchanged, and a JavaScript picker would have been the first script on a screen that
has none.

Note what is *not* done with it: the field is given no `min`. §7e item 7's "today or later"
is a rule the **server** states, with a Danish sentence naming what is wrong, and a
browser-enforced bound would be a second rule in a second place — one a forged request would
not meet and one that would leave the person guessing.

**A conditional-fields helper.** The two time fields appear and disappear with the chosen
kind, which is the classic reason to reach for a form library. It is one CSS mechanism
instead — the same `peer-checked/…:` the weekday switch uses, with a *named* peer because
this card has two radios rather than one checkbox. `peer-checked/andre:` compiles to a plain
`~` sibling combinator, so the ordering of the controls is load-bearing and is stated in the
component. Controls hidden with `display:none` are still submitted (only `disabled` prevents
that), which is what keeps "choose Andre tider and both times" a single save.

### No date library, for the sixth phase running

Phase 8B compares two `YYYY-MM-DD` strings — `date < today` — and adds no arithmetic at all.
Every question about *when* is still the phase-2 engine's: whether the restaurant is open,
when it opens next, and when a sold-out dish returns. `lib/hours/override-form.ts` contains
no timezone, no `Intl` call and no `Date`; the caller passes today's Copenhagen date in, so
the rule cannot pick up the machine's clock by accident.

### No new component, token or utility either

`AdminSectionBar`, `Notice`, `SubmitButton`, the Kladde badge, the pending band and the
error-and-`aria-describedby` treatment are used exactly as phases 5–8A left them. The two
chips are the radio-drawn-as-a-pill that 1r's label chips and 1ad's suggestion chips already
established, and the destructive control is 1r's Slet ret treatment — a **link** to a
confirmation, so the removal cannot happen in one press.

One small refactor rather than a new module: `lib/hours/clock-choices.ts` now holds the
quarter-hour grid, the wall-clock test and the off-grid rule that `lib/hours/weekly-form.ts`
used to own, and the weekly module re-exports them under the names it always used. Both
cards on the screen offer 1t's one sentence — *"Tider vælges i kvarter-spring"* — so they
share a **control** and no rule at all: what times are valid *together* stays in each
editor, because the two word their refusals differently and bind them to different fields.

### One migration, and what it does not contain

`20260831120000_opening_hours_override_admin.sql`:

- adds `draft jsonb` to `opening_hours_overrides`, with the same
  `jsonb_typeof(draft) = 'object'` shape CHECK every other draft column has. §0j records why
  the `status`-only model could not express a pending edit to a published override;
- replaces `publish_opening_hours_override` so it merges that draft with `draft ? 'column'`,
  the same presence test every other publish function uses, and clears it in the same
  statement;
- adds `remove_opening_hours_override`, SECURITY INVOKER, with the version token re-checked
  inside its own DELETE and one audit row carrying what was removed;
- replaces the `pending_changes` view so an override is listed as pending in either of its
  two ways.

What it does **not** contain: no policy, no grant, no trigger, no index, no view beyond the
one it replaces, no scheduled anything, and **no SECURITY DEFINER function** — both functions
are SECURITY INVOKER, so RLS decides for every caller against their own JWT.
`supabase/tests/014_opening_hours_overrides.test.sql` asserts that, asserts the table still
has exactly its five phase-1 policies, and asserts that the DELETE policy is still
`is_staff()`.

It also contains nothing that names `public.announcement`. `announcement_created` — §4's
column for the generated opening-hours message — is written by no statement in the migration
and by no line of the application; the pgTAP suite asserted no override was ever marked as
having produced one. *(8C-3A dropped the column; `014` now asserts the stronger fact that
it no longer exists, and that no override owns the announcement after everything phase 8B
does.)*

### One correctness fix in phase 4's machinery, and why it belongs here

`storedDraftIsValid` in `lib/publishing/publish.ts` refused a `null` draft as
`invalid_draft`. That branch was unreachable for every entity whose only pending state *is*
a draft — `pending_changes` lists those by `draft is not null` — and an override is the one
entity that can be pending **without** one: a row created with `status = 'draft'` carries its
values in its own columns. Refusing it would have refused the ordinary first publish of every
new override. The function now answers "no draft is not a malformed draft", which is what it
was always trying to say.

### `npm audit --audit-level=high` — clean

Run against the unchanged lockfile after `npm ci`: **0 vulnerabilities**.

---

## Phase 8A — no dependencies added (2026-08-30)

The normal weekly opening-hours editor (§0i) adds **no package, no migration and no
database function**. `package.json` is byte-identical to the phase-7 lock.

### The thing that would have justified a package, and why it is not here

A weekly-schedule editor is the classic reason to reach for a time-picker component, and
there is a well-known one for every framework. Frame 1t does not draw one: it draws two
dropdowns and says *"Tider vælges i kvarter-spring"*. A `<select>` over the quarter-hour
grid is that, exactly, in about twenty lines — and it is the better control here for three
reasons a library would have taken away:

- **It is what the phone already has.** §15 calls the phone the primary admin device, and a
  native `<select>` opens the platform's own wheel. A JavaScript picker would be a
  custom-drawn overlay competing with it.
- **It needs no JavaScript at all.** Every editor in this administration works with
  scripting off, and a picker is by definition script.
- **It cannot invent a value the schema would refuse.** The options are generated from one
  arithmetic loop and the stored value; there is no parsing step between what a person
  chooses and what is submitted.

The one thing the grid must not become is a *rule*. `timeChoicesFor` adds a stored off-grid
time to the list rather than dropping it, so the control stays a convenience and the column,
the CHECK, the Zod schema and the phase-2 engine remain the only authorities on what a time
may be.

### No date library, again

For the fifth phase running. Phase 8A does arithmetic on nothing at all: it maps a form to a
document and back, and every question about *when* — is the restaurant open, when does it
open next, when does a sold-out dish return — is answered by the phase-2 engine, which was
built without one and stays that way. `lib/hours/weekly-form.ts` contains no timezone, no
`Intl` call and no `Date`.

### No new component, token or utility either

The switch is the one 1ah already draws, rebuilt from the same tokens with its track and knob
as the label's `::before` and `::after` — moved from a sibling `<span>` to pseudo-elements
only because this row needs the *checkbox itself* to be the peer, so that the word "Lukket"
and the two dropdowns can react to it as well. `AdminSectionBar`, `Notice`, `SubmitButton`,
the Kladde badge and the pending band are used exactly as phases 5–7 left them.

### The one CSS mechanism worth naming

The row draws both of 1t's appearances with `peer-checked:`, which compiles to a plain `~`
sibling combinator. That was chosen over `:has()` deliberately: `~` has been supported
everywhere for two decades, and the alternative — always rendering the two dropdowns on a
closed row — would have deviated from the approved frame for no gain. Controls hidden with
`display:none` are still submitted (only `disabled` prevents that), which is what keeps
"reopen a day and set its times" a single save.

### No new database object, and no widened privilege

`opening_hours` already had exactly what this phase needed, and phase 8A verified rather than
added: `supabase/tests/013_opening_hours.test.sql` asserts that `publish_opening_hours` is
still SECURITY INVOKER, that **no** SECURITY DEFINER function writes the table, that the
table still has exactly one UPDATE policy and that its condition is still `is_owner()`.

### `npm audit --audit-level=high` — clean

Run against the unchanged lockfile: **0 vulnerabilities**.

---

## Phase 7 completion pass — no dependencies added (2026-08-30)

The pass that closed phase 7 (see technical plan §0h) added **nothing**: no runtime
dependency, no development dependency, **no migration and no database object**. It made
one behaviour change, one visual correction and one correctness fix, all inside files that
already existed, and it added assertions to suites that already existed.

### The bidirectional "Vis besked" needed no new database object, and that is the point

The owner's decision — that the switch moves the visibility of the already-published
announcement **both ways** — is served by the function phase 7B already shipped.
`public.set_announcement_visible(p_visible boolean, p_expected_updated_at timestamptz)`
takes a boolean because a switch has two positions, and it already carried the two guards
the on direction needs (`not_showable` for a blank message or a passed expiry), because
Fortryd is the same write. So the migration list for phase 7 is unchanged at two files,
and `supabase/tests/012_announcement.test.sql` covers the manual re-show in §10d without a
new assertion: at the database it is the same call with the same argument.

The one thing added on the application side is nine lines of arithmetic,
`isAnnouncementRestorable` in `lib/announcements/lifecycle.ts`, and it is deliberately
written as `isAnnouncementPubliclyVisible` with `is_visible` substituted rather than as a
second list of conditions — so the screen's offer and the database's refusal cannot drift
into two rules that merely agree today.

### The visual correction needed no token and no utility that did not exist

The linked public bar measured 61 px at 768 and 1440 against 1ac's drawn 41, because the
row's `py-2` was padding a link that already carried `min-h-tap`. The fix is `md:py-0` on
a linked row — a Tailwind utility this repository already uses — so the 44 px target *is*
the bar's height. No new `@theme` entry, no media query, no measurement written into a
class name.

### `npm audit --audit-level=high` — clean

Re-run from a clean `npm ci` on 2026-08-30 as part of the phase 7 completion regression:
**0 vulnerabilities** over the full resolved tree. The pinned set below is unchanged since
phase 4.

## Phase 7B — no dependencies added (2026-08-30)

Phase 7B (the immediate announcement path — "Vis besked" off, "Fjern beskeden nu" and the
~10 s Fortryd; technical plan §0g) added **nothing**: no runtime dependency, no
development dependency, and no npm package of any kind. One migration adds two functions;
everything else is TypeScript, JSX and tokens that already existed.

### No toast library, and no second toast system

1aa fixes the behaviour this phase needed — *"Beskeder forsvinder efter 5 sek. — dog 10
sek., når de indeholder Fortryd. De stjæler aldrig tastaturfokus."* — and phase 5C already
built it: `components/admin/menu/UndoStrip.tsx` and `AutoDismiss.tsx`, the same pair the
sold-out and delete paths use. Phase 7B **reuses both unchanged** and adds only the half
that is about this operation: which fields the Fortryd form submits
(`AnnouncementVisibilityUndo`). A notification library would have replaced a working
twenty-line component with a dependency that has its own focus behaviour to argue with.

### No state library for the undo offer either

The offer is two query parameters (`fortryd_version`, `fortryd_vis`), which is where every
other immediate path in this administration keeps it. Neither is authority: the Server
Action re-authorizes, re-validates and re-checks the version token, so a hand-typed
address can produce a strip and pressing it is refused exactly as any other forged request
is. Nothing about the undo lives in the browser, so nothing needed a store.

### Two migration functions, and what they do not contain

`20260830180000_announcement_visibility.sql` adds `public.announcement_visibility()` — the
one-field audit shape, the announcement's equivalent of `dish_availability()` — and
`public.set_announcement_visible()`. No new table, no view, no trigger, no index, no
policy and no new column. The UPDATE names **one** column, so `message`, all four link
columns, `expires_at`, `source`, `draft` and — deliberately — `previous` and `replaced_at`
appear in no statement in the file. Replacing an active announcement is phase 8;
`supabase/tests/012_announcement.test.sql` asserts that no function for it exists.

### `npm audit --audit-level=high` — clean

Re-run from a clean `npm ci` on 2026-08-30 as part of the phase 7B regression:
**0 vulnerabilities** over the full resolved tree. The pinned set below is unchanged since
phase 4.

## Phase 7A — no dependencies added (2026-08-30)

Phase 7A (the announcement editor, the public bar and the client expiry guard — technical
plan §0f) added **nothing**: no runtime dependency, no development dependency, and no npm
package of any kind. One migration replaces one existing function; everything else is
TypeScript, JSX and tokens that already existed.

### The one dependency §9 sketched, and why it is not here

§9's testing plan describes the expiry-guard suite as *"jsdom with fake timers"*. **jsdom
was not added**, and the decision is recorded here rather than left as an omission.

Three things weighed against it. §1 (adjustment 4) says to add Zod and axe and nothing
else, and a DOM environment is not a small package — it is a second HTML parser, a second
CSS parser and a second event loop, all of which then have to be kept patched for a
component of forty lines. The behaviour jsdom would simulate is already asserted **in a
real browser**: `tests/e2e/announcement.spec.ts` publishes a message, controls the
browser's clock with Playwright's `page.clock`, watches the bar remove itself with no
reload, and asserts the request log is empty — which is exactly the assertion §9 asks for
in E2E 4, and a stronger one than a fake timer against a fake DOM. And the part jsdom
would genuinely have added — the arithmetic — was moved out of the component instead:
`lib/announcements/expiry.ts` holds the comparison and the `setTimeout` clamp as pure
functions with no imports at all, so they are unit-tested directly *and* shared byte for
byte with the server.

What is left in the component is wiring, and the wiring is asserted over its own source in
`tests/unit/announcements/expiry-guard-source.test.ts` — the same idiom phase 5C
established with `sold-out-mapping.test.ts`. No `fetch`, no storage, one timer cleared
before each re-arm, both listeners removed on unmount, focus blurred rather than moved.

Revisit if a second client component ever needs a DOM test that a browser cannot give.

### Playwright's clock API is not a new dependency either

`page.clock` ships inside `@playwright/test` 1.62.1, which phase 3 already added. It is
what makes the expiry test deterministic instead of a twenty-second wait: the guest's
browser is started twenty seconds before the expiry the editor actually published, and the
test moves that clock rather than the wall clock. `setSystemTime` — which moves the clock
*without* running pending timers — is what reproduces §7c's bfcache case honestly.

### No date library, again

`lib/announcements/expiry-editor.ts` converts between a Copenhagen wall clock and an
instant in both directions, and computes "the next closing time" and "a week from now"
across both daylight-saving transitions. All of it goes through `lib/time/copenhagen.ts`
and `lib/hours/engine.ts`, which phase 2 built and tested. Nothing here does date
arithmetic of its own, so nothing here needed a library to do it with — which is the same
answer phases 6A and 6B recorded.

### One migration, and what it does not contain

`20260830160000_announcement_admin.sql` is a single `create or replace function` on
`public.publish_announcement`. No new table, no view, no trigger, no index, no grant, no
policy, and **no immediate-path RPC** — that is phase 7B, and
`supabase/tests/012_announcement.test.sql` asserts that no such function exists yet.
*(Updated 2026-08-30: phase 7B added it. That assertion now says the visibility RPC exists
and that no **replacement** RPC does — see the 7B entry above.)*

### `npm audit --audit-level=high` — clean

Re-run from a clean `npm ci` on 2026-08-30 as part of the phase 7A regression:
**0 vulnerabilities** over the full resolved tree. No advisory affects the pinned set
below, which is unchanged since phase 4.

## Phase 6 completion pass — no dependencies added (2026-08-30)

The pass that closed phase 6 (see technical plan §0e) added **nothing**: no runtime
dependency, no development dependency, no migration and no database object. It made two
visual corrections and one wording correction inside files that already existed, and
added three test files — two unit suites and one assertion — that import nothing new.

### The two visual corrections needed no token and no utility that did not exist

Both were the same defect with the same cause: a `md:w-auto` button sitting beside a
longer sentence in a `md:flex-row` row, shrinking below its own label because
`flex-shrink` defaults to 1. The fix is `shrink-0`, a Tailwind utility this repository
already uses in ten other places, on `components/admin/weekly/CopyPreviousWeek.tsx` and
`components/admin/monthly/MonthlyBurgerEditor.tsx`. No new token, no `@theme` entry, no
media query and no measurement written into a class name.

### The two new unit suites use the mock that was already there

`tests/unit/menu/weekly-sold-out-mapping.test.ts` and
`tests/unit/menu/monthly-sold-out-mapping.test.ts` are modelled on phase 5C's
`sold-out-mapping.test.ts` and use the same two things it uses: `vi.mock` on
`@/lib/supabase/server`, and `node:fs` to read the module's own source for the
architectural assertions. No mocking library, no fixture framework and no HTTP recorder
was added — the point of the pattern is that a recorder function and a resolved value are
enough to assert a mapping.

### `npm audit --audit-level=high` — clean

Re-run from a clean `npm ci` on 2026-08-30 as part of the phase 6 completion regression:
**0 vulnerabilities** over the full resolved tree. No advisory affects the pinned set
below, which is unchanged since phase 4.

## Phase 6B — no dependencies added (2026-08-30)

Månedens burger (`lib/menu/monthly.ts`, `lib/menu/monthly-availability.ts`,
`lib/content/monthly-admin.ts`, the four Server Actions in
`app/(admin)/admin/menu/maanedens-burger/` and the editor components) added **nothing**
to `package.json` — no runtime dependency and no development dependency. It added **one
migration**, `20260830140000_monthly_burger_admin.sql`, containing one audited-shape
function and one operation.

### Why no date library, again

Phase 6A recorded the same conclusion for ISO weeks. §7d's date window is a smaller
problem than that one: it is a comparison of two `YYYY-MM-DD` strings against today's
Copenhagen date, and lexicographic order on that format *is* calendar order. The whole
rule is four lines in `monthlyWindowPhase`, and the Copenhagen date it compares against
comes from `lib/time/copenhagen.ts`, which phase 2 built and tested across both DST
transitions.

Two smaller pieces were needed and are also not a library:

* **`isIsoDate`** (`lib/time/calendar.ts`) — the predicate form of the existing
  `parseIsoDate`, for the one place a malformed value is *expected* rather than a
  programmer error: a date field somebody typed into. Nine lines.
* **Danish month names** (`lib/format/danish.ts`) — §7d's state sentences read
  *"vises fra 1. september"*, which needs the month written out. `Intl.DateTimeFormat`
  would do it, and its output depends on the host's ICU build — the same reason
  `formatPrice` and `formatDanishDate` were hand-rolled in phase 3. Twelve strings and
  two functions, deterministic and unit-tested.

### No new UI dependency for the date fields

1ah draws "Startdato" and "Slutdato" as dropdown-looking date controls. They are
`<input type="date">`: the control the phone already has (§15 calls the phone the primary
admin device), a value that is `YYYY-MM-DD` — exactly what the column stores and what
`lib/time/calendar.ts` calls a civil date, so nothing converts anything — and no
JavaScript at all. A date-picker component would have added a client bundle to a screen
that otherwise ships none, in order to reimplement a control the platform provides.

### One migration, and what it does not contain

`20260830140000_monthly_burger_admin.sql` adds `monthly_burger_availability()` and
`set_monthly_burger_sold_out()`. It adds **no** table, view, trigger, index, scheduled
job or second publishing path: `publish_monthly_burger()` has existed since phase 4 and
is untouched, and the date window remains a read-time filter (§7d, clarification C4).
The function is SECURITY INVOKER, takes no target and no row id — the singleton locates
itself — and names one column in one UPDATE.

### `npm audit --audit-level=high` — clean

Re-run from a clean `npm ci` on 2026-08-30 as part of the phase 6B regression. No
advisory affects the pinned set below, which is unchanged.

## Phase 6A — no dependencies added (2026-08-30)

Ugens ret and Lørdagsmenu (`lib/time/iso-week.ts`, `lib/menu/weekly*.ts`, the four Server
Actions, the editor components) added **nothing** to `package.json` — no runtime
dependency and no development dependency. It did add **one migration**, which is the
difference from phases 5E and 5F; see below.

### Why no date library, for the one phase that would have justified one

§1 (adjustment 4) says dates are handled with `Intl` plus a tested helper, "no date
library unless the helper proves fragile in review". Phase 6A is the first phase that
needs something `Intl` genuinely does not provide: **ISO-8601 week numbering**. There is
no ISO-week accessor on `Date`; `Intl.DateTimeFormat`'s `week` field is not
interoperable; US week numbering starts on Sunday and counts differently; and
`Temporal.PlainDate#weekOfYear` is not available in this runtime. So the case for
`date-fns` or `luxon` was real and was weighed rather than waved away.

It was not taken, for three reasons:

* **The rule is three sentences long.** Weeks start Monday; week 1 contains 4 January;
  a date's ISO year is the calendar year of its own Thursday. `lib/time/iso-week.ts`
  implements exactly that in civil `YYYY-MM-DD` values on top of the phase-2 calendar
  helpers, and `tests/unit/time/iso-week.test.ts` pins all thirty-one cases that matter —
  both year boundaries, the 53-week years, and the Copenhagen-versus-UTC midnight.
* **A library would have to be kept out of the timezone boundary anyway.**
  `lib/time/copenhagen.ts` is the only module allowed to name a timezone (§7). A date
  library's own zone handling would be a second answer to a question this repository
  already answers in one place — which is how two functions come to disagree about what
  day it is.
* **`date-fns` is ~40 packages and `luxon` carries its own zone database.** §1's closing
  note applies: every library not added is an advisory never triaged.

One helper was added to the phase-2 module rather than duplicated beside it:
`differenceInDays` in `lib/time/calendar.ts`, the counterpart to the `addDays` that was
already there. Nothing else in `lib/time` changed.

### One migration, and what it does not contain

`supabase/migrations/20260830120000_weekly_special_admin.sql` adds three functions and
nothing else — no table, no view, no trigger, no column:

* `weekly_special_availability()` — the audited shape of the two sold-out columns;
* `set_weekly_special_sold_out()` — the immediate Udsolgt transaction (§6, §7b);
* `copy_weekly_special_to_draft()` — "Kopiér sidste uge" (§6, decision 4).

`publish_weekly_special()` from phase 4 is untouched, and there is deliberately no second
weekly-special publishing path. `set_dish_sold_out()` is **not** reused and could not be:
it names `public.dishes` in every statement, and `dishes` carries the two
`sold_out_changed_*` attribution columns that `weekly_special` does not have (§4).
`supabase/tests/010_weekly_special.test.sql` asserts the properties both new functions
promise, including that the copy writes no live column and produces nothing published.

### One correctness fix that is worth recording

Every field on the new screen is an uncontrolled `<input defaultValue>`, which is what
keeps the editor a Server Component with nothing in the browser to keep in step. After a
client-side navigation React reuses the DOM nodes and updates `defaultValue` **without**
touching a value a person has typed — usually the kind thing to do, and wrong for the two
operations that deliberately replace what somebody typed: a confirmed "Kopiér sidste uge"
overwrite, and the week rollover. Each card is therefore keyed on the values it was
rendered from (`cardKey` in the screen's `page.tsx`), so exactly the card whose server
values moved is remounted, and a colleague's half-typed Saturday menu still survives a
save on the other card. It is four lines and no dependency.

### `npm audit --audit-level=high` — clean

Re-run from a clean `npm ci` on 2026-08-30 as part of the phase 6A regression. No
advisory affects the pinned set below, which is unchanged.

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

One default of that model has to be overridden rather than accepted, and `next.config.ts`
does it: `expireTime`. Next.js pairs a route's `revalidate` with a default `expireTime` of
one year, so a cached page goes *stale* after five minutes but does not *expire* for a
year, and everything in between is stale-while-revalidate — Next's own response cache
answers with the copy it holds, and the `Cache-Control` it sends tells every shared cache
in front of the site that it may do the same. Both break the §6 promise that a publish is
on the site on the *next* request, and the §7a promise that nothing a guest reads is more
than five minutes old. Setting `expireTime` to the same five minutes removes the second
age; `tests/e2e/public-cache.spec.ts` holds it there.

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

The Sentry server SDK (phase 13). Each addition is version-checked and
advisory-checked at the point it is added, and this file updated.

Added in phase 1: `@supabase/supabase-js` and `@supabase/ssr`. Added in phase 3:
`@playwright/test` and `@axe-core/playwright`. Added in phase 4: `zod`. Added in
phase 10A: `sharp` (see the entry at the top of this file). pgTAP needed no
npm dependency — it runs through the Supabase CLI (see the phase-1 section above).

### Open schema item — resolved in phase 3

`dishes.labels` is constrained by shape only, and stays that way; the reasoning is in
the phase-3 section at the top of this file. `supabase/seed.sql` now carries the nine
menu sections, the dishes and the page copy, extracted from the approved design file in
phase 3 exactly as this note anticipated.

> **Repository settings to enable** (not expressible in the repository itself):
> secret scanning, push protection, and Dependabot security updates; branch protection
> on `main` requiring the CI checks above.
