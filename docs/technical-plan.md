# Klingenberg Food — Technical Plan

> **SUPERSEDED — 2026-09-07, the static rebuild.**
>
> This document plans the database-backed system with an administration dashboard that
> this repository used to be: Supabase, Auth, drafts and publishing, Server Actions,
> the image upload pipeline, rate limiting, monitoring, backups and the Vercel
> deployment. **None of that exists any more.** The site is now a static Next.js export
> built from tracked content, with no server and no secrets; [`../README.md`](../README.md)
> describes what actually runs.
>
> It is kept for two reasons, and only those two. First, the surviving code still cites
> its section numbers — a comment saying "§7b" means the sold-out rule as stated below,
> and deleting the document would turn every such reference into a dead end. Second, the
> reasoning it records about the *domain* — the opening-hours engine, the sold-out reset,
> the Månedens burger window, the announcement's link rules, the image ladder, the
> accessibility model — is still the reasoning the code implements, because those parts
> were pure from the start and moved across unchanged.
>
> Everything it says about storage, authorisation, caching, publishing or deployment is
> history. The full previous architecture is at the `pre-static-rebuild` git tag.

Source of truth for UI/UX: `Klingenberg Food Hi-fi.dc.html` (screens 1a–1ab).
This document plans implementation only. Nothing here changes the approved design.

**Revision 2 — 2026-08-29.** All twelve open decisions from revision 1 §12 are now closed by the
owner. This revision folds them in, plus three corrections (announcement expiry precision, storage
backup destination, dependency version policy) and one clarification (Månedens burger scheduling).
Architecture from revision 1 is preserved except where a decision required a change; every such
change is listed in §0.

**Requirement change — 2026-08-29, approved by the restaurant, applied after phase 4.** Forsiden gets
a **dedicated Månedens burger section** in addition to its three featured dishes. The earlier rule in
§7e item 3 — that "Vis på forsiden" took featured slot 3 and displaced a normal dish — is withdrawn;
see §7d and §7e item 3 for what replaces it. `monthly_burger` remains the single source of truth: no
new table, no duplicated data, no second availability rule.

**Corrections — 2026-08-29, applied after phase 5D, recorded before phase 5E.** Two statements this
document made about deleting a dish were wrong. They are corrected in place *and* listed in §0a, so
the change is visible rather than invisible: a reader who remembers the old rule can see that it was
withdrawn, and why.

- **§7e item 4 said a deletion "nulls the reference"** the Forside holds to a featured dish. It does
  not, and must not. Forsiden is Owner-only (§5), so a Staff member's Slet ret cannot become a path
  that writes `pages.home`. What phase 5D actually built — warn, leave the document alone, let the
  reference stop resolving — is now what §7e item 4 says.
- **§6's immediate-path table said a soft-deleted dish is "purged after 30 days".** There is no such
  purge. Nothing in this system hard-deletes a dish, no retention job exists, and none is planned or
  scheduled into a phase. Soft-deleted rows are kept until an explicit retention feature is designed
  and approved, which is now open item G in §13.

Confirmed business facts (from design section 1ab — do not invent beyond these):

- Name: Klingenberg Food, Carl Nielsen Hallen
- Address: Lumbyvej 62, 5792 Nørre Lyndelse, Denmark
- Phones: +45 63 90 83 00 (primary), +45 51 79 45 66 (secondary)
- Facebook: facebook.com/carlnielsencafeen — no Instagram
- Award: Danmarks Bedste Burger 2026 — winner Fyn & Øer, no. 4 in Denmark. Listed in the competition as "Carl Nielsen Caféen, Årslev".
- Hours: Mon closed, Tue closed, Wed–Fri 15:00–20:00, Sat–Sun 17:00–20:00
- Ordering by phone only. No reservation, online ordering, delivery, newsletter or customer accounts.

---

## 0. What changed in revision 2

| # | Decision | Architectural consequence |
|---|---|---|
| 1 | Role split approved as proposed | Table in §5 is now normative, not a proposal. Owner-count invariant added to the database. |
| 2 | Udsolgt auto-clears at the next opening day | `is_available boolean` replaced by `sold_out_on date` on three tables. New pure module `lib/menu/availability.ts`. No cron. |
| 3 | Tapas lists are staff-editable | `dishes.details` gains a validated `tapas` document shape and a simple list-group editor reusing the existing reorder primitive. |
| 4 | "Kopiér sidste uge" on Ugens ret | Draft-seeding Server Action. **No** history table — it copies the currently live row. Never publishes. |
| 5 | `/nyheder/[slug]` in scope | Confirms the route already sketched in §3; adds slug policy, `NewsArticle` JSON-LD and unpublish behaviour. |
| 6 | Static licensed map image, no tile provider | No map dependency at all. One `<a>` wrapping one `<img>`. Optional attribution line driven by config. Placeholder asset during development. |
| 7 | Supabase: local / Free staging / **Pro** production | Production pinned to Pro. Staging-pauses risk documented with a CI mitigation. |
| 8 | Vercel: paid plan for production | Vercel **Pro**. Preview Deployment Protection becomes available and is turned on — which means Playwright CI needs a bypass secret. |
| 9 | Resend custom SMTP; local uses the CLI mail catcher | Auth email templates versioned in `supabase/`. Sender address is a config value, not a constant. |
| 10 | Domain deferred | Every absolute URL resolves through `lib/config/site.ts`. A CI grep forbids literal domains elsewhere. |
| 11 | ≥1 effective Owner, multiple Staff | Database trigger prevents removing/disabling the last active owner. Owner-created invite flow. No real accounts yet. |
| 12 | No analytics in v1 | Plausible option removed. Public visitors receive **zero cookies**, so the approved design needs no consent banner. Vercel Web Analytics and Speed Insights are also excluded. |
| C1 | Announcement expiry must not lag the cache | New ~40-line client component guards expiry in the browser. No database call, no realtime. Everything else stays server-rendered. |
| C2 | Storage backup must be off-platform | Corrects revision 1, which synced to another **Supabase** bucket — that is not off-platform. Weekly GitHub Actions job to an external object store. |
| C3 | Do not pin framework versions from this document | Version selection and advisory review move to implementation time. Lockfile committed, scanning in CI. |
| C4 | Månedens burger prepared as a draft | Confirms the read-time date-window model. Explicitly no scheduled-publishing service. |

---

## 0a. Corrections applied after phase 5D

Revision 2's §0 records what changed when the twelve decisions closed. This section records
something different and worth keeping separate: two places where **this document was wrong about
what the system does**, found while building phases 5A–5D and corrected before phase 5E. Neither is
a new decision. Both are the plan catching up with a rule it already stated elsewhere.

| # | Where | What it said | What is true, and why |
|---|---|---|---|
| D1 | §7e item 4 | Deleting a dish that Forsiden features "warns and then nulls the reference". | It warns and **leaves `pages.home` exactly as the Owner wrote it**. Nulling the reference would need a Staff member's delete button to write an Owner-only document (§5) — a privilege-elevation path, in the one place the permission matrix is least expected to be routed around. The public selector already drops an id it cannot resolve, so the Forside stays valid with two cards rather than three; restoring the dish brings it back automatically while the Owner's reference is still there; and the Owner tidies a genuinely stale slot in the Forsiden editor whenever they like. `supabase/migrations/20260829180000_soft_delete_dishes.sql` names no `public.pages` statement, which is what makes this a property of the text rather than a promise. |
| D2 | §6, immediate-path table | A soft-deleted dish is "purged after 30 days". | **There is no automatic hard purge, and no purge job is planned.** Nothing in the system issues a `DELETE` against `dishes`; §8's recovery story for a dish is the row itself, which only works if the row is still there. Soft-deleted rows remain stored until an explicit retention feature is designed and approved — §13 open item G. A 30-day timer would have quietly destroyed the thing the soft delete exists to preserve. |

Both corrections are the *binding* statement of the behaviour. Where an older paragraph elsewhere in
this document still reads as though a deletion edits Forsiden or expires a row, this section wins.

---

## 0b. Phase 5 — complete and locked (2026-08-30)

Phase 5 (Menu administration, §15) was built in five increments — 5B core dish administration,
5C the immediate Udsolgt path, 5D soft delete, 5E reorder, 5F the Tapas editor — and closed by a
completion pass on 2026-08-30. This section records what "phase 5" *is*, so that a later reader
does not have to reconstruct it from five commit messages.

**What phase 5 contains, and what is therefore finished:**

| Capability | Path | Where it lives |
|---|---|---|
| Dish CRUD as drafts — create, edit, section assignment, Kladde badges, Forhåndsvis, Offentliggør | Kladde → Forhåndsvis → Offentliggør (§6) | `app/(admin)/admin/menu/{create,save,publish}-actions.ts`, `lib/publishing/*` |
| Labels — the four standard ones plus the restaurant's own, at most four, case-insensitively distinct | draft | `lib/menu/labels.ts`, `components/admin/menu/LabelFields.tsx` |
| Category assignment — moving a dish between sections, placed at the end of the new one | draft | `app/(admin)/admin/menu/dish-form.ts`, `save-actions.ts` |
| Tilgængelig / Udsolgt with the computed §7b reset sentence and its ~10 s Fortryd | **immediate** (§6) | `lib/menu/sold-out.ts`, `availability-actions.ts` |
| Slet ret — soft delete, its confirmation, the Forside warning, and its ~10 s Fortryd | **immediate** (§6) | `lib/menu/delete.ts`, `delete-actions.ts` |
| Reorder inside a section — handle, touch, keyboard, and a no-JavaScript path | draft | `lib/menu/reorder.ts`, `reorder-actions.ts` |
| Tapas list editing — three fixed groups, free headings and items, add / remove / move | draft | `lib/menu/tapas.ts`, `tapas-actions.ts` |
| Responsive menu administration at 375 / 768 / 1440, keyboard-operable throughout | — | `components/admin/menu/*` |

**What is deliberately outside phase 5**, and stays outside it until the phase that owns it:

| Not in phase 5 | Owned by | Note |
|---|---|---|
| Ugens ret editor | phase 6 (1ag) | The section appears as a chip and says it is edited elsewhere; it holds no dishes (§4). |
| Lørdagsmenu editor | phase 6 (1ag) | Same row, same screen. |
| Månedens burger editor | phase 6 (1ah) | The public Forside feature and the date window already exist; the editor does not. |
| Image library and upload | phase 10 (1w) | Every dish row and the editor panel therefore show no photo control at all. 1r's `FOTO` frame is a phase-10 slot, not a phase-5 omission. |
| **Menu-category content editor** — a section's name, intro text, note and order | **not scheduled** | See below. |

**The menu-category content editor is intentionally deferred, not missing.** Phase 5's scope is the
*dishes*: the chips navigate between sections and a dish can be assigned to one, and that is the whole
of what the approved frames 1r and 1y draw. Editing a section's own **name**, **intro**, **note** or
**order** is a different screen, and **there is no approved admin design for it** — 1r shows the chips
as navigation, not as an editable list, and no frame in `Klingenberg Food Hi-fi.dc.html` draws such an
editor. `lib/schemas/menu.ts` already carries `menuCategoryDraft` with those four fields, and
`menu_category` is already a publishable entity, so the data path exists and is tested; what does not
exist is a screen, and inventing one here would mean designing an approved-looking admin surface that
nobody approved. It should be designed first and built in the phase that gets a frame for it.

---

## 0c. Phase 6A — Ugens ret and Lørdagsmenu, complete (2026-08-30)

Phase 6 (§15) has two halves that share a table row and nothing else. **6A — Ugens ret
and Lørdagsmenu (frame 1ag, every public state in 1af) — is built and green.** 6B —
Månedens burger (frame 1ah) — is now built and green too, and is recorded separately in
§0d. This section records what 6A *is*, so a later reader does not have to reconstruct
it, and so the boundary between the two is a written rule rather than an assumption.
**Phase 6 as a whole is now complete and locked** — the completion pass over both halves,
of the kind §0b records for phase 5, was run on 2026-08-30 and is recorded in §0e. This
section is left exactly as it was written: it is the account of 6A's own decisions, and
§0e adds to it rather than replacing it.

**What phase 6A contains:**

| Capability | Path | Where it lives |
|---|---|---|
| The Ugens ret editor — week number, serving days, dish, both portion prices | Kladde → Forhåndsvis → Offentliggør (§6) | `app/(admin)/admin/menu/ugens-ret/`, `components/admin/weekly/` |
| The week rollover — changing the week number starts a blank form, reversibly | draft | `lib/menu/weekly.ts` (`planWeekEdit`) |
| The Lørdagsmenu editor, and the explicit **"Ingen lørdagsmenu denne uge"** state | draft | `SaturdayMenuEditor`, `weekly_special.sat_enabled` |
| Tilgængelig / Udsolgt on **both** cards, with the §7b reset sentence and ~10 s Fortryd | **immediate** (§6) | `lib/menu/weekly-availability.ts`, `set_weekly_special_sold_out()` |
| "Kopiér sidste uge", with its overwrite confirmation and its disabled state | draft-seeding | `lib/menu/weekly-copy.ts`, `copy_weekly_special_to_draft()` |
| ISO week/year arithmetic, including week 53 and both year boundaries | — | `lib/time/iso-week.ts` |
| Publishing this screen's scope through phase 4, unchanged | — | `publish_weekly_special()` (phase 4) |

**One migration, three functions, no new entity.** `weekly_special` was already a
publishable entity with a draft column and a publish function (phase 4);
`20260830120000_weekly_special_admin.sql` adds only what the two *non*-publish operations
need — `weekly_special_availability()`, `set_weekly_special_sold_out()` and
`copy_weekly_special_to_draft()`. No table, no view, no trigger, no scheduled anything.
There is deliberately **no second weekly-special publishing path**.

**Three readings this phase had to settle, recorded so they are decisions rather than
accidents:**

| # | Question | The reading, and why |
|---|---|---|
| A | **What "changing the week number blanks the form" (§7e item 5) blanks.** | The four things somebody types about the food — `name`, `description` and both portion prices. **Not** the serving days, which are the pattern the dish is served on rather than the dish, and **not** the Lørdagsmenu, which has its own on/off control and the frame's own promise beside it: *"Teksten bevares til næste gang."* Blanking the Saturday card from the Ugens ret card would also be one editor clearing another's pending work, which is the single failure mode this screen is arranged to prevent. `image_id` is blanked by neither, because no editor owns it before phase 10. The rollover is **reversible**: choosing the published week again clears the card from the draft entirely, so an accidental change costs one press. |
| B | **Which week "Kopiér sidste uge" lands in.** | The week **after the live row's own week**, not "whatever week it is today". §6 says the fields are copied *"with `iso_year`/`iso_week` advanced to the next ISO week"*, and advancing the source is the only reading that does not silently skip a week when the kitchen is running behind. A live row with content but no week at all falls back to this week in Copenhagen, which is the only answer that is not invented. |
| C | **What "both sold-out fields cleared" means for a copy.** | Structurally, rather than by a statement: the destination draft is built from `weekly_special_content()`, which names the thirteen content columns and neither sold-out column, so a copy has nowhere to carry operational state from. The copy also does not *clear the live* columns — it writes `draft` and nothing else (§6: "it never touches a live column"), and §7b clears a marking on read anyway. |

**One deliberate departure from frame 1ag, and why.** The frame draws the seven serving-day
boxes as a single row, at a desktop width. Seven 44 px boxes do not fit inside the card at
375 px — the arithmetic gives 39 — and 1aa's minimum target size states no exception for
the phone, which §15 (phase 12) calls the primary admin device. The row therefore **wraps
to four-plus-three below `md`** and is the frame's single row of seven at and above it.
The alternatives were both worse: shrinking the boxes breaks a stated rule, and a
horizontal scroller hides three days behind a gesture on the one control where seeing all
seven at once *is* the information.

**Two things the frame draws that phase 6A deliberately does not build:**

| Not in 6A | Owned by | Note |
|---|---|---|
| The image control ("Billede (valgfrit)", "Vælg billede") | phase 10 (1w) | The same phase boundary 1r's `FOTO` frame had in phase 5 (§0b). `image_id` is consequently owned by no editor yet — and is cleared by neither of 1ag's two, so a value phase 10 writes cannot be wiped by somebody saving a price. |
| Månedens burger | **phase 6B** (1ah) — now built, see §0d | A different singleton, a different shape, a different notion of "the previous one" (§7d's date window rather than a week number). No generic "special content" framework was built for it, and none was: 6B is a second concrete editor beside this one, not a generalisation of it. |

---

## 0d. Phase 6B — Månedens burger, complete (2026-08-30)

**6B — Månedens burger (frame 1ah, §7d) — is built and green.** It is the second half of
phase 6 and shares with 6A a table-shaped resemblance and nothing else. This section
records what 6B *is*, and — more usefully — the three readings it had to settle.

**What phase 6B contains:**

| Capability | Path | Where it lives |
|---|---|---|
| The editor — name, description, price, and 1ah's "Ryd felterne" | Kladde → Forhåndsvis → Offentliggør (§6) | `app/(admin)/admin/menu/maanedens-burger/`, `components/admin/monthly/` |
| The date window — `starts_on` / `ends_on`, Copenhagen-local, inclusive at both ends | draft | `lib/menu/monthly.ts` (`monthlyWindowPhase`) |
| **"Vis på forsiden"** — an ordinary draft field governing the burger's **own** Forside section | draft | `monthlyBurgerDraft.show_on_homepage`, `selectHomepageMonthlyBurger` |
| The computed state §7d asks for — *"Offentliggjort — vises fra 1. september"*, *"Vises nu — til og med 30. september"*, *"Udløbet den 30. september"* | — | `describeMonthlyState` |
| §7d's publish-time warnings — an expired window asks first; a future start publishes and says when it will appear | — | `monthlyPublishOutlook`, `publish-actions.ts` |
| Tilgængelig / Udsolgt with the §7b reset sentence and its ~10 s Fortryd | **immediate** (§6) | `lib/menu/monthly-availability.ts`, `set_monthly_burger_sold_out()` |
| Publishing this screen's scope through phase 4, unchanged | — | `publish_monthly_burger()` (phase 4) |

**One migration, two functions, no new entity.** `monthly_burger` was already a
publishable entity with a draft column and a publish function (phase 4);
`20260830140000_monthly_burger_admin.sql` adds only what the *non*-publish operation
needs — `monthly_burger_availability()` and `set_monthly_burger_sold_out()`. No table, no
view, no trigger, no scheduled anything. There is deliberately **no second monthly-burger
publishing path**, and the third immediate-path function is a third written-out function
rather than a parameterised one: `dishes` carries attribution columns, `weekly_special`
carries two sold-out columns and needs a target, and `monthly_burger` is a singleton with
one column and neither — a function taking a table, a column and an attribution policy as
arguments is a function that can be pointed at a table nobody reviewed.

**Three readings this phase had to settle, recorded so they are decisions rather than
accidents:**

| # | Question | The reading, and why |
|---|---|---|
| A | **What "Vis på forsiden" governs, and what wording ships.** | It governs the Forside's **dedicated Månedens burger section** and nothing else. 1ah's drawn helper line — *"Optager en af de tre pladser under 'Tre fra menuen'"* — describes the rule the approved requirement change of 29 August 2026 withdrew, and §7e item 3 instructs phase 6 to ship different wording. What ships is `MONTHLY_HOMEPAGE_HELP`: **"Vises som sit eget afsnit på forsiden — den tager ikke en af de tre pladser under 'Tre fra menuen'."** The approved frame is left as drawn; the string is stated once, asserted by the unit suite, and the E2E suite asserts the withdrawn sentence appears nowhere on the screen. |
| B | **What "Ryd felterne" clears.** | The three things somebody types about the food — `name`, `description`, `price_ore`. **Not** the period, which is when the slot runs rather than what is in it, and which a person filling in next month's burger would only have to type again; **not** "Vis på forsiden", which is a setting about where the slot appears and is the same answer month after month; **not** `image_id`, which no editor owns before phase 10; and **not** `sold_out_on`, which is not a draft field at all (§6) and which no code path here can reach. That is §0c reading A applied to the control 1ah draws instead of a week dropdown: "the form" means the words about the food. It is an ordinary draft change, so it needs no confirmation — the hjemmeside is untouched and the result is on screen. |
| C | **Whether §7d's two window warnings are the same kind of thing.** | They are not, and the difference is the whole of §7d's intent. An **`ends_on` already in the past** is a *question*: the first press of Offentliggør publishes nothing and comes back with the approved confirmation, and only a form carrying the confirmation's own field goes through. A **future `starts_on`** is *the intended workflow*: it publishes, and the screen then states the date twice — in the success message and in the standing computed state. Neither warning writes a date; a warning that quietly corrected the window would be an administration deciding what somebody meant. |

**Three things 1ah draws that phase 6B deliberately does not build, or builds
differently:**

| Not as drawn | Why |
|---|---|
| The image control ("Billede (valgfrit)", "Vælg billede") | phase 10 (1w), the same boundary 1r's `FOTO` frame and 1ag's image slot had. `image_id` is consequently owned by no editor yet — and is in neither this editor's field list nor "Ryd felterne"'s, so a value phase 10 writes cannot be wiped by somebody saving a price. |
| One "Forhåndsvis" in the footer | **Two**, in the bar: "Forhåndsvis forsiden" and "Forhåndsvis menuen". Månedens burger is the only content in the system that lives on two public pages under two different rules — the menu card follows the window alone, the Forside section follows the window *and* the toggle — so one link could only ever show half of what a person just changed, and the half it hid would be the toggle's. Ugens ret needs one link because it appears in one place. |
| "Forhåndsvis" and "Offentliggør" in the card's footer | In the burgundy bar, as 6A already does for the same reason: they are the screen's actions rather than the card's, and the bar is where every other section screen puts them. "Ryd felterne" stays in the card's footer, where the frame draws it. |

**The three concepts §7d keeps apart are kept apart in the code**, because collapsing any
two of them produces an administration that cannot answer *"why is my burger not on the
forside?"*: whether the burger **exists** (a published `name`), whether today is **inside
its window**, and whether it is **configured for the Forside section**
(`show_on_homepage`). `monthlyAdminState` returns all three, and the screen prints the
menu's consequence and the Forside's consequence as two separate sentences.

---

## 0e. Phase 6 — complete and locked (2026-08-30)

Phase 6 (Weekly + monthly, §15) was built in two increments — **6A** Ugens ret and
Lørdagsmenu (frame 1ag, every public state in 1af) and **6B** Månedens burger (frame
1ah, §7d) — and closed by a completion pass on 2026-08-30. §0c and §0d stay exactly as
they were written: they are the record of *what each half decided and why*, and erasing
a decision note to make room for a summary would throw away the only account of why the
readings went the way they did. This section is what §0b is for phase 5 — the statement
of what "phase 6" **is**, so a later reader does not have to reconstruct it from two
commit messages and two increment notes.

**What phase 6 delivers, and what is therefore finished:**

| Capability | Path | Where it lives |
|---|---|---|
| **Ugens ret** — the weekly editor: week number, serving days, dish, both portion prices | Kladde → Forhåndsvis → Offentliggør (§6) | `app/(admin)/admin/menu/ugens-ret/`, `components/admin/weekly/` |
| ISO week/year arithmetic, including week 53 and both year boundaries | — | `lib/time/iso-week.ts` |
| The week rollover — changing the week starts a blank form, reversibly (§7e item 5) | draft | `lib/menu/weekly.ts` (`planWeekEdit`) |
| **Lørdagsmenu**, and the explicit **"Ingen lørdagsmenu denne uge"** state (1af) | draft | `SaturdayMenuEditor`, `weekly_special.sat_enabled` |
| **"Kopiér sidste uge"** — server-determined source and destination, its overwrite confirmation, its disabled state | draft-seeding | `lib/menu/weekly-copy.ts`, `copy_weekly_special_to_draft()` |
| Tilgængelig / Udsolgt on **both** weekly cards, with the §7b reset sentence and ~10 s Fortryd | **immediate** (§6) | `lib/menu/weekly-availability.ts`, `set_weekly_special_sold_out()` |
| **Månedens burger** — the singleton editor: name, description, price, and 1ah's "Ryd felterne" | Kladde → Forhåndsvis → Offentliggør (§6) | `app/(admin)/admin/menu/maanedens-burger/`, `components/admin/monthly/` |
| The **date window** — `starts_on` / `ends_on`, Copenhagen-local, inclusive at both ends | draft | `lib/menu/monthly.ts` (`monthlyWindowPhase`) |
| The **dedicated Forside toggle** — "Vis på forsiden", an ordinary draft field governing the burger's **own** section | draft | `monthlyBurgerDraft.show_on_homepage`, `selectHomepageMonthlyBurger` |
| The **computed public/admin state** §7d asks for, said as two separate consequences | — | `monthlyAdminState`, `describeMonthlyState` |
| **Scheduled future publication** — a future `starts_on` publishes and the screen states the date | — | `monthlyPublishOutlook`, `describeScheduledPublish` |
| The **expired-window confirmation** — an `ends_on` in the past asks before it publishes | — | `monthlyPublishOutlook`, `MonthlyExpiredPublishDialog` |
| Tilgængelig / Udsolgt on the burger, with the §7b reset sentence and ~10 s Fortryd | **immediate** (§6) | `lib/menu/monthly-availability.ts`, `set_monthly_burger_sold_out()` |
| Publishing both screens' scope through phase 4, unchanged | — | `publish_weekly_special()`, `publish_monthly_burger()` (phase 4) |
| Responsive at 375 / 768 / 1440, keyboard-operable throughout, axe-clean at 375 and 1440 | — | `components/admin/{weekly,monthly}/*` |

**Two migrations, five functions, no new entity and no new table.** Both singletons were
already publishable entities with a draft column and a publish function (phase 4).
`20260830120000_weekly_special_admin.sql` adds `weekly_special_availability()`,
`set_weekly_special_sold_out()` and `copy_weekly_special_to_draft()`;
`20260830140000_monthly_burger_admin.sql` adds `monthly_burger_availability()` and
`set_monthly_burger_sold_out()`. No view, no trigger, no index, no scheduled anything,
and **no second publishing path** for either screen.

### What the completion pass settled

Six questions were open in the sense that they had been decided inside one increment and
never checked across both. They are recorded here as answers, so they are not re-opened
by somebody reading only §0c or only §0d.

| # | Question | The answer |
|---|---|---|
| A | **Should the three immediate-path database functions become one?** | **No.** `set_dish_sold_out`, `set_weekly_special_sold_out` and `set_monthly_burger_sold_out` deliberately share every convention — the same jsonb status vocabulary, the same order of checks, the same Copenhagen-date guard stated before anything is read, the same repeated version check inside the UPDATE, the same forbidden-versus-conflict probe, the same `log_audit('availability', …)` shape, `security invoker` with `set search_path = ''`, and the same `revoke … from public, anon` / `grant … to authenticated` pair — and they remain three because they name three different tables, three different sets of columns and three different attribution policies. `dishes` carries `sold_out_changed_at`/`_by`; `weekly_special` carries two sold-out columns on one row and needs a target; `monthly_burger` is a singleton with one column and no attribution. A generic function taking a table, a column, a row locator and an attribution policy as arguments is a function that can be pointed at a table nobody reviewed — and it would have to build an identifier from an argument, which none of these three does. |
| B | **Had they drifted?** | **In behaviour, no.** Authorization (`mayChangeEntity` first, RLS second), concurrency (`p_expected_updated_at`, re-checked inside the statement), audit shape, result vocabulary and Copenhagen-date enforcement are identical across all three, and the one extra status the weekly function can return (`invalid_target`) is unreachable from the application and mapped to the generic failure. **In assertions, yes**, and that was corrected: only the dish module had its *mapping* asserted at unit level, so `tests/unit/menu/weekly-sold-out-mapping.test.ts` and `tests/unit/menu/monthly-sold-out-mapping.test.ts` now hold the other two to the same bar — the arguments sent, the state read back from the row rather than echoed, no cache tag on a refusal or on `unchanged`, the Copenhagen date, the role check before any query, and the source-level promise that the immediate path never reaches phase 4's draft machinery. |
| C | **Should `lib/menu/weekly.ts` and `lib/menu/monthly.ts` become one module?** | **No, and the separation causes no duplication.** They are siblings in shape only: a week whose *change* blanks the form against two dates that decide, at read time, whether an already-published row is shown; two cards and two sold-out columns on one row against one of each; "Kopiér sidste uge" against a singleton that has no notion of "the previous one". What they genuinely share is shared underneath them and not between them — the draft column and its overlay (`lib/drafts/`, `lib/publishing/`), §7b's one sold-out rule (`lib/menu/availability.ts`, `describeAvailability`), the Copenhagen boundary (`lib/time/copenhagen.ts`), the Kladde vocabulary and the design tokens. **No generic `SpecialContent` abstraction exists, and none should be built.** The two delta functions look alike and are not the same function: the weekly one takes a field list because two editors share its row, and compares arrays because `days` is one. |
| D | **What "Ryd felterne" clears, and whether its context could mislead.** | It clears the three fields somebody types about the food — `name`, `description`, `price_ore` — and leaves the period, "Vis på forsiden", `image_id` and `sold_out_on` exactly as they stand (§0d reading B). The control **keeps its approved wording**; what the pass verified is that its context cannot be read as "erase the page": the button sits in its own form under a rule, and the sentence beside it — bound to the button with `aria-describedby` — names what is cleared *and* what is kept, in that order. |
| E | **Whether the two preview links should collapse into 1ah's single button.** | **No.** Månedens burger is the only content in the system that lives on two public surfaces under two different rules — the menu card follows the window alone, the Forside section follows the window *and* the toggle — so one link could only ever show half of what somebody just changed, and the half it hid would be the toggle's. Both links are drawn in the bar in the approved admin language, at the approved target size, beside the same Offentliggør (§0d). |
| F | **Whether a future start should ask before publishing.** | **No, and it must not.** A future `starts_on` is the ordinary scheduling workflow: it publishes, and the screen states the date twice — in the success message (`describeScheduledPublish`) and in the standing computed state. The **expired** window is the one exceptional blocking warning, and it is a question that publishes nothing until it is answered. Neither warning writes a date (§0d reading C). |

### Visual corrections made by the completion pass

Two, both real, both fixed with the tokens and patterns already in the file.

| Where | What was wrong | The fix |
|---|---|---|
| `components/admin/weekly/CopyPreviousWeek.tsx` | Between 768 px and roughly 1024 px the label **"Kopiér sidste uge" broke across two lines**, making the control 58 px tall and reading as "Kopiér sidste / uge". From `md` the button sits beside a sentence longer than itself, and as a shrinkable flex item it gave the room to the sentence. | `shrink-0` on the button. The paragraph already carries `min-w-0`, so the sentence is the one that wraps. |
| `components/admin/monthly/MonthlyBurgerEditor.tsx` | The same defect, same cause, on **"Ryd felterne"**. | The same fix. |

Nothing else moved. Measured across nine screen states — the weekly editor seeded, with
a Kladde, sold out with its Fortryd strip, and with the copy confirmation open; the
monthly editor empty, with a Kladde, sold out, in its scheduled state and with the
expired confirmation open — at 375, 768 and 1440 px, there is no horizontal overflow, no
control below 44 px, and no wrapped control label anywhere.

### One consequence of two correct rules, recorded so it is not rediscovered as a bug

"Kopiér sidste uge" writes the whole of `weekly_special_content()` into the draft, which
§6 requires and which includes `image_id`. The week rollover's *restore* path clears
`WEEK_EDITOR_FIELDS`, which deliberately does **not** include `image_id`, because no
editor owns that field before phase 10. So a copy followed by choosing the published week
again leaves one key in the draft — `image_id`, holding the value that is already live —
and the Ugens ret card therefore keeps its Kladde badge until the next publish, which
writes the same value back and changes nothing a guest can see. Both rules are right and
neither should be bent: letting the weekly editor clear `image_id` would give an editor
authority over a field phase 10 owns, and dropping `image_id` from the copy would
contradict §6. It costs one harmless publish, and phase 10 is where it stops being
possible at all.

### Recorded explicitly, because each of these is a rule somebody could later assume away

| Statement | Where it is enforced |
|---|---|
| **The old slot-3 homepage rule remains withdrawn.** "Vis på forsiden" governs the Forside's **dedicated** Månedens burger section and nothing else; it never displaces one of the three featured dishes, and there is no slot arithmetic anywhere in this system. 1ah's drawn helper line is left as drawn and `MONTHLY_HOMEPAGE_HELP` is what ships. | §7e item 3, §0d reading A. `lib/menu/monthly.ts`; the unit suite asserts the string, the E2E suite asserts the withdrawn sentence appears nowhere on the screen and that the Forside renders exactly three featured dishes throughout. |
| **A future `starts_on` is normal scheduling, not an error.** It publishes without a blocking question, and the screen states the date it will appear on twice over. The **expired** window is the one exceptional blocking warning. | §7d, §0d reading C, §0e answer F. `monthlyPublishOutlook`, `publish-actions.ts`. |
| **The menu-category content editor is still deferred, with no phase.** A section's own name, intro, note and order have no approved admin design; the data path exists and is tested. | §0b. `lib/schemas/menu.ts` (`menuCategoryDraft`), the `menu_category` publishable entity. |
| **Images remain phase 10.** No editor owns `image_id` on any of the four content types, and none clears it. | §0b, §0c, §0d. `dishDraftDelta`, `DISH_EDITOR_FIELDS`, `WEEK_EDITOR_FIELDS`, `SATURDAY_EDITOR_FIELDS`, `MONTHLY_EDITOR_FIELDS` — `image_id` is in none of them, and every save is `mode: 'merge'` with an explicit `clear` drawn from the editor's own list. |
| **Weekly and monthly remain separate domain modules.** No generic "special content" abstraction exists. | §0e answer C. `lib/menu/weekly.ts`, `lib/menu/monthly.ts`. |
| **The three sold-out RPCs remain explicit, intentionally.** | §0e answers A and B. `set_dish_sold_out()`, `set_weekly_special_sold_out()`, `set_monthly_burger_sold_out()`, and the three mapping suites in `tests/unit/menu/`. |

---

## 0f. Phase 7A — the announcement editor and the public bar, complete (2026-08-30)

Phase 7 (Announcements, §15) has two halves. **7A — the core system — is built and
green**: the editor at `/admin/besked` (frame 1ad), the public bar in the shared layout
(frame 1ac), the client expiry guard (§7c), and Kladde → Forhåndsvis → Offentliggør
through phase 4's machinery, unchanged. **7B — the immediate path — is not started**, and
what belongs to it is listed below rather than left to be inferred.

**What phase 7A delivers:**

| Capability | Path | Where it lives |
|---|---|---|
| The announcement editor — message, optional link, required future expiry, 1ad's suggestion chips, the "sådan ser den ud" panel | Kladde → Forhåndsvis → Offentliggør (§6) | `app/(admin)/admin/besked/`, `components/admin/announcement/` |
| The public bar, above the navigation, on every page or on none | — | `components/site/announcement/`, rendered by `app/(site)/layout.tsx` |
| **The expiry guard** (§7c, correction C1) — one client component, one timer, `visibilitychange` and `pageshow`, no request of any kind | — | `components/site/announcement/AnnouncementExpiryGuard.tsx` |
| The expiry rule itself, shared byte for byte between server and browser | — | `lib/announcements/expiry.ts` — **imports nothing**, which is what lets the guard share it |
| The editor's civil-time half: Copenhagen wall clock ↔ instant, and 1ad's chips | draft | `lib/announcements/expiry-editor.ts` |
| §8's link rule — six approved internal routes, or an `https:` address rendered with `rel="noopener noreferrer"` | draft | `lib/announcements/link.ts` |
| Public eligibility, the publish outlook, the delta and the computed state | — | `lib/announcements/lifecycle.ts` |
| Responsive at 375 / 768 / 1440, keyboard-operable throughout, axe-clean at 375 and 1440 | — | `tests/a11y/announcement-admin.spec.ts`, `tests/e2e/announcement.spec.ts` |

**One migration, one function, no new entity and no new table.** `announcement` was
already a publishable entity with a draft column, a publish function and its own RLS
policies (phases 1 and 4). `20260830160000_announcement_admin.sql` replaces
`public.publish_announcement` and changes nothing else — see the finding below.

### The one thing phase 7A had to change in phase 4's machinery

**Publishing an announcement now sets `is_visible = true`, and refuses a draft that would
produce a blank message or a missing or already-past expiry.**

§6's immediate-path table names `"Vis besked" off / "Fjern beskeden nu"` — the **off**
direction only — and nothing anywhere else turned a bar *on*. The phase-4 function
therefore merged the content and left `is_visible` alone, which meant a staff member could
write a message, preview it, publish it, and watch nothing happen: the row would hold a
perfect announcement that `announcement_select_public` would never return.

1ad settles which path owns the on direction, in its own words: *"Skrive eller ændre → tre
trin. Ret → Forhåndsvis → Offentliggør."* against *"Fjerne → ét tryk."* So publishing is
how a message reaches the hjemmeside, and switching one off stays outside every draft,
exactly as §6 requires. §6's table is a table of *immediate* operations and is unchanged;
this paragraph is the statement of the other direction, which it never covered.

The two refusals are 1ac's rules in SQL — *"Højst én besked ad gangen · Kort besked · Link
er valgfrit · **Udløb er påkrævet**"*. The first three are already CHECK constraints; the
fourth cannot be, because "in the future" is not immutable, so it is checked at the moment
of the merge. The application checks the same two rules first (`announcementPublishOutlook`)
so a person gets a Danish sentence and a greyed-out Offentliggør; the database check is the
answer a forged request gets. `lib/publishing/publish.ts` accepts one further RPC status,
`invalid_draft`, which is the word it already used for a draft that no longer parses and
means the same thing to a caller: nothing was written, and the draft is still there.

### What phase 7A deliberately does not contain

| Not in 7A | Owned by | Note |
|---|---|---|
| **"Vis besked" off, and "Fjern beskeden nu"** | phase 7B | §6's immediate path, with its ~10 s Fortryd. 1ad draws both; they are absent from the editor rather than present and inert, for the same reason 1ah's image control is absent from the Månedens burger editor. |
| **Replacing an active announcement**, `previous`, `replaced_at`, and the 10-second restore | phase 7B | §6's immediate table. Nothing in 7A reads or writes those two columns. |
| **Generated opening-hours announcements** (`source='opening_hours'`) and 1ae's conflict sheet | phase 8 | `source` is read by nothing on the editor and written by nothing in 7A; it stays `'manual'`. |
| An announcement archive, a history list, a second simultaneous bar | **never** | 1ad: *"intet arkiv, ingen kladdeliste, ingen historik — én besked ad gangen med et påkrævet udløb."* §4 lists the history table among the tables deliberately not created. |

### Three readings the build had to make, recorded so they are not re-opened

| # | Question | The answer |
|---|---|---|
| A | **How is an announcement taken down in 7A, when the immediate path is 7B?** | **By its expiry, which is mandatory — and by nothing else.** A publish with a blank message is refused (1ac: the bar *is* a message), so there is no take-down through the three-step path either. The editor says so in words beside the state banner: shorten the expiry and publish again. This is a real, stated limitation of 7A rather than an oversight, and it is what 7B's one press removes. |
| B | **Where does the expiry comparison happen, given a five-minute cache?** | **Three layers, none of them trusted alone.** RLS filters `expires_at > now()` when the row is *fetched*; `AnnouncementRegion` filters again against *this render's* clock, because a clock reading taken inside the cached read would be frozen into the cache entry; and the guard removes a bar whose expiry passes while the page is already open. The unit suite asserts that the first two compose into exactly `isAnnouncementPubliclyVisible`. A statically generated page still carries a stale bar for up to five minutes with JavaScript off, which is precisely the figure §7a states. |
| C | **How do 1ad's suggestion chips work without JavaScript?** | **They are radio buttons in the editor's own form.** Choosing one submits *which chip*, and the server resolves it against the published opening hours and its own clock — so a chip cannot carry a value the fields could not, cannot bypass the "must be in the future" rule, and needs no script. The stored row holds an instant and no record of how it was produced, so the checked chip is recomputed on every render; a chip whose instant the hours have since moved simply shows as "Vælg selv". Two of the frame's four chips name the same instant ("Når vi lukker søndag" and "I aften kl. 20:00"), so one chip ships that words itself from the instant it found. |

---

## 0g. Phase 7B — the immediate path: taking the announcement down by hand (2026-08-30)

Phase 7 has two halves. §0f records **7A** — the editor, the public bar and the client
expiry guard. This section records **7B — the immediate path**, which is built and green:
1ad's *"Fjerne → ét tryk"* side of the screen, with the ~10 s Fortryd §6 requires.

§0f is left exactly as it was written. It is 7A's own account of what it decided and why,
including its statement that *"phase 7A has no way to take a message down by hand"* — a
limitation that was true when it was written and that this section removes. **Phase 7 as a
whole was not locked when this section was written**: what a lock pass still owed is listed
at the end of it, and every item is now answered in **§0h**, which is the record of what
"phase 7" is.

**What phase 7B delivers:**

| Capability | Path | Where it lives |
|---|---|---|
| **"Fjern beskeden nu"** — 1ad's footer control | **immediate** (§6) | `RemoveAnnouncementNowButton`, `app/(admin)/admin/besked/visibility-actions.ts` |
| **"Vis besked" off** — 1ad's switch, the same operation by another entrance | **immediate** (§6) | `AnnouncementVisibilityCard`, the same action |
| The public bar disappearing **at once** — the `announcement` cache tag expired after the transaction commits, and only then | — | `expirePublicCacheTags` in the Server Action; the domain module returns the tags and expires none |
| The **~10 s Fortryd**, as a second authorized write | **immediate** (§6) | `AnnouncementVisibilityUndo` over phase 5C's `UndoStrip` / `AutoDismiss` |
| The transaction — one column, one audit row, optimistic concurrency, `security invoker` | — | `public.set_announcement_visible()` |
| The audited shape of a visibility change | — | `public.announcement_visibility()` |
| The refusal that keeps an expired message off the site even when an undo asks for it | — | `set_announcement_visible` → `not_showable`; `lib/announcements/visibility.ts` maps it to `expired` |
| Responsive at 375 / 1440, keyboard-operable throughout, axe-clean at both | — | `tests/e2e/announcement-remove.spec.ts`, both Playwright projects |

**One migration, two functions, no new entity, no new table and no new column.**
`20260830180000_announcement_visibility.sql` adds `announcement_visibility()` and
`set_announcement_visible()` and changes nothing else. There is deliberately **no generic
immediate-action RPC**: this function takes no table name, no column name and no row id —
the singleton locates itself — for the reason §0e answer A records for the three sold-out
functions. A function that builds an identifier from an argument is a function that can be
pointed at a table nobody reviewed.

### The four readings this phase had to settle

| # | Question | The answer |
|---|---|---|
| A | **Does "Vis besked" turn a bar back *on*?** *(**Superseded** by the owner's decision of 2026-08-30 — see §0h. It now does, immediately, for the same published announcement, and still publishes nothing. The reading below is left as written because it is the account of why 7B shipped one direction, and because the rule it turns on — that content goes through the three steps — is unchanged.)* | **No — and that is a reading of the source of truth, not a shortcut.** §6's immediate-path table names *"'Vis besked' off / 'Fjern beskeden nu'"*, the **off** direction only; 1ad's own annotation names only that direction, twice (*"Slå fra, og den forsvinder straks"*, *"'Vis besked' fra eller 'Fjern beskeden nu' virker straks"*); and §0f settles the on direction as Offentliggør. So the switch is drawn, in its on state, exactly while there is a bar to switch off, and a **statement** stands in its place when there is not — the same choice §0f made when it left both controls off the screen rather than shipping them inert. The one write in the on direction is Fortryd (reading B). **The consequence is recorded as a limitation, not hidden:** after the ten seconds have passed, putting the same message back is 1ad's three-step path — edit it, and press Offentliggør, which sets `is_visible` (§0f). The screen says so where the switch used to be. |
| B | **What does Fortryd restore?** | **Visibility, of the same unchanged published announcement — and nothing else.** It is a second call to the same function with `p_visible => true` and the version token the first write returned, so it is guarded, validated, concurrency-checked and audited exactly as the first press was. It is **not** the `previous jsonb` mechanism: `previous` and `replaced_at` are named by no statement in the migration and by no line of the application, and remain unused by the whole of phase 7. A colleague who changes the row between the removal and the undo makes the undo a `conflict`, which writes nothing and logs nothing. |
| C | **What happens when the expiry passes inside the ten seconds?** | **The undo is refused, and says so.** Writing `is_visible = true` on a row whose `expires_at` has gone would put `true` into a column the anonymous policy — `is_visible and message is not null and expires_at is not null and expires_at > now()` — goes on filtering out, and the screen would then report a bar put back that no guest can read. So the two standing rules of 1ac are checked for the **on** direction only, and the refusal is named (`not_showable`, with a `reason`). **Nothing extends `expires_at` to make an undo succeed.** The **off** direction is never refused for either reason: a message that can no longer be shown is exactly the one somebody may still want switched off, and an operation whose whole purpose is "stop this now" must not have a state it declines to stop. |
| D | **Can an immediate removal reach a pending draft?** | **No, and the reason is structural.** The UPDATE names one column and `draft` is not it, so a draft written before the removal is byte-identical after it and after the undo — asserted from real JWTs in `supabase/tests/012_announcement.test.sql` and end-to-end at both widths. `lib/announcements/visibility.ts` imports nothing from `lib/publishing` except the role matrix and the entity registry, and nothing at all from `lib/drafts`; the Server Action imports neither. The removal therefore cannot clear a draft, publish one, merge one, change the expiry, change a link, or change `source`. |

### What phase 7B deliberately does not contain

| Not in 7B | Owned by | Note |
|---|---|---|
| **Replacing an active announcement**, `previous`, `replaced_at`, and the restore that reads them | **phase 8** | §6's third immediate row. The two columns exist and are written by nothing; the pgTAP suite asserts that no `replace_announcement` or `restore_announcement` function exists. |
| **"Erstat med den nye besked"** and **1ae's conflict sheet** | **phase 8** | §7e item 8's server-authoritative ordering — the hours are written first and always — belongs with the override that generates the message. |
| **Generated opening-hours announcements** (`source='opening_hours'`) | **phase 8** | `source` is read by nothing on the editor and written by nothing in phase 7; it stays `'manual'`. |
| ~~**Turning a bar on from the switch**~~ | — | Reading A, **superseded**: the phase-7 lock pass built it (§0h). It restores the visibility of the same published announcement and publishes no content, which is the property Fortryd already had. |

### Recorded explicitly, because each of these is a rule somebody could later assume away

| Statement | Where it is enforced |
|---|---|
| **One business operation, two controls.** "Vis besked" off and "Fjern beskeden nu" submit the same two field names to the same Server Action and reach the same database function. There is no second implementation to keep in step. | `ANNOUNCEMENT_VISIBILITY_FORM`, `setAnnouncementVisibility`. The E2E suite compares both forms' fields *and* their Next.js action identifiers. |
| **The browser supplies no authority.** The submission is a state to move to and a version token. No message, no link, no expiry, no `source`, no `previous`, no `replaced_at`, no entity name and no row id — the parser reads two names and no others, and the singleton locates itself. | `readAnnouncementVisibilityForm` (a `strictObject`), `set_announcement_visible(boolean, timestamptz)`. |
| **The cache is expired only after a write that reached the row.** Not on a refusal, not on a conflict, not on `unchanged`, not on a failed write. | `visibility-actions.ts`; the domain module returns tags and expires none, asserted over its source. |
| **Both real writes are audited; nothing else is.** `log_audit('visibility', 'announcement', …)` with the before/after pair, actor taken from the JWT. A conflict, an `unchanged`, and every refusal write no audit row. Staff gains no audit-log read access — `audit_log` stays Owner-readable (§5). | `set_announcement_visible`, `public.log_audit`, `supabase/tests/012_announcement.test.sql` §10. |
| **`previous` and `replaced_at` remain unused by the whole of phase 7.** | The migration names neither; the pgTAP suite asserts both are `null` after a removal and after an undo. |
| **`source='opening_hours'` remains unused.** | Nothing in phase 7 writes `source`; the pgTAP suite asserts it is still `'manual'` after a removal. |
| **`AnnouncementExpiryGuard` is unchanged.** Phase 7B added no request, no listener and no state to it; server eligibility and the guard remain the authority on expiry (§7c). | The file is untouched by this phase; `tests/unit/announcements/expiry-guard-source.test.ts` still holds it to no `fetch`, no storage and one timer. |
| **The removal, and its Fortryd, work with JavaScript switched off.** Every control on the screen is an ordinary `method="POST"` form in the document the server sends; the ten-second timer is `AutoDismiss` and is an enhancement over it, never the mechanism. With scripting off the strip simply stays until the next navigation — §7e item 11's allowed degradation for the admin. | Asserted over the **server's HTML** rather than the hydrated DOM, because a visitor with scripting off never hydrates: `tests/e2e/announcement-remove.spec.ts` fetches the page and holds every form on it to `method="POST"` and to no `javascript:` action. |

### One correction to §0f, and one to §6

Neither is a new decision; both are the document catching up with what is now built.

- **§0f says "phase 7A has no way to take a message down by hand … this is a real, stated
  limitation of 7A rather than an oversight, and it is what 7B's one press removes."** That
  press now exists. §0f's paragraph stands as the record of 7A; this section is the record
  of its removal.
- **§6's immediate-path table** carries a note reading *"The announcement rows above are
  phase 7B; phase 7A built the ordinary three-step path only."* The first of those two rows
  — `"Vis besked" off / "Fjern beskeden nu"` — is now built. The second — *replace an
  existing announcement*, with its `previous` stash — is **phase 8**, not 7B, and the note
  now says so.

### What remained before phase 7 could be locked — all four answered in §0h

Recorded here as the lock pass's own list, and left as written so the four items can be
read against the answers. **Every one of them is closed; §0h is the answer to all four,
and phase 7 is locked.**

1. **A completion pass over 7A and 7B read together**, of the kind §0e was for phase 6:
   both halves walked against a production build as Staff and as Owner, frames 1ac, 1ad and
   1aa checked once more against what shipped at 375 / 768 / 1440 px, and the immediate
   path reviewed beside the three sold-out ones as a set rather than singly.
   → **Done (§0h).** It found one visual defect, in the public bar, and fixed it.
2. **A decision on the one limitation reading A records** — that a message switched off by
   hand comes back only through Ret → Offentliggør. It is the correct reading of §6 and 1ad
   as they stand; whether the restaurant wants a control for it is a question for the owner,
   and if the answer is yes it is a design change to 1ad before it is a code change.
   → **Decided by the owner: the switch moves both ways.** Reading A below is therefore
   **superseded** — see §0h, which records what replaced it and, just as importantly, what
   did *not* change with it: showing an already-published message again publishes nothing.
3. **The states neither suite can reach cheaply**: a malformed stored draft with the
   removal controls on screen, and the screen as it looks to a Staff member whose account
   is deactivated mid-session. Both are refusals the code states and neither is walked.
   → **Both walked (§0h).** The malformed-draft walk found a real defect — a publish that
   could never succeed was offered and worded "prøv igen" — and it is fixed.
4. Phase 8 remains untouched: no replacement, no `previous`, no conflict sheet, no
   opening-hours integration.
   → **Still true (§0h).** Nothing about making the switch bidirectional went near any of
   it: "restore" in phase 7 means visibility, never content.

*(768 px was on this list and is now off it: `tests/e2e/announcement-remove.spec.ts`
measures the removal controls at the middle width too — no overflow, no control under
44 px, no wrapped control label — which is the defect phase 6's completion pass found twice
at exactly that width.)*

---

## 0h. Phase 7 — complete and locked (2026-08-30)

Phase 7 (Announcements, §15) was built in two increments — **7A** the editor, the public bar
and the client expiry guard (§0f), and **7B** the immediate path (§0g) — and closed by a
completion pass on 2026-08-30. §0f and §0g stay exactly as they were written: they are each
increment's own account of what it decided and why, and erasing a decision note to make room
for a summary would throw away the only record of how the readings went. This section is what
§0b is for phase 5 and §0e is for phase 6 — the statement of what "phase 7" **is**.

**What phase 7 delivers, and what is therefore finished:**

| Capability | Path | Where it lives |
|---|---|---|
| The **sitewide announcement bar**, above the navigation, on every public page or on none | — | `components/site/announcement/`, rendered by `app/(site)/layout.tsx` |
| The **editor** — message, optional link, 1ad's suggestion chips, the live "sådan ser den ud" panel, the computed state of what the hjemmeside is showing | Kladde → Forhåndsvis → Offentliggør (§6) | `app/(admin)/admin/besked/`, `components/admin/announcement/` |
| A **mandatory future expiry**, refused at three layers: the form, the publish outlook, and `publish_announcement()` in SQL | — | `lib/announcements/expiry.ts`, `expiry-editor.ts`, `20260830160000_announcement_admin.sql` |
| **Internal and HTTPS links** — six approved routes, or an `https:` address rendered `rel="noopener noreferrer"` (§8) | draft | `lib/announcements/link.ts`, and the three link CHECKs |
| The **client expiry guard** (§7c, correction C1) — one component, one timer, `visibilitychange` and `pageshow`, no request of any kind | — | `AnnouncementExpiryGuard.tsx` |
| **Immediate manual hide** — 1ad's "Vis besked" off and "Fjern beskeden nu" | **immediate** (§6) | `AnnouncementVisibilityCard`, `RemoveAnnouncementNowButton`, `visibility-actions.ts` |
| **Visibility re-show of the same valid published announcement** — the same switch, pressed the other way | **immediate** (§6) | the same three, plus `isAnnouncementRestorable` |
| The **~10-second Fortryd** after any visibility change, as a second authorized write | **immediate** (§6) | `AnnouncementVisibilityUndo` over phase 5C's `UndoStrip` / `AutoDismiss` |
| The transaction behind all of it — one column, one audit row, optimistic concurrency, `security invoker` | — | `public.set_announcement_visible()`, `public.announcement_visibility()` |
| Responsive at 375 / 768 / 1440, keyboard-operable throughout, axe-clean at 375 and 1440 | — | `tests/a11y/announcement-admin.spec.ts`, `tests/e2e/announcement{,-remove}.spec.ts` |

**Two migrations, three functions, no new entity, no new table and no new column.**
`announcement` was already a publishable entity with a draft column, a publish function and
its own RLS policies (phases 1 and 4). `20260830160000_announcement_admin.sql` replaces
`publish_announcement`; `20260830180000_announcement_visibility.sql` adds
`announcement_visibility()` and `set_announcement_visible()`. No view, no trigger, no index,
no scheduled anything, and **no second publishing path**.

### The one behaviour this pass changed — "Vis besked" works both ways

§0g reading A recorded a limitation and asked for a decision: a message switched off by hand
came back only through Ret → Offentliggør, because §6's immediate table names the **off**
direction and 1ad's annotation names only that direction too. **The owner's answer is that
the switch moves both ways**, and this pass built it.

The reading it rests on is 1aa's own line for this bar, which is about *content* rather than
about the switch: *"fjernes med ét tryk, men skrives via forhåndsvis → offentliggør."*
Showing an already-published message again writes no content, so it is not the half that
needs the three steps. §6's table stays a table of immediate operations and is unchanged;
what moved is that the immediate operation it names has two directions, which is what a
switch is — and what `set_dish_sold_out` has always had on the control drawn beside it.

**The distinction the screen now has to keep, and does:**

| Control | What it changes |
|---|---|
| **Ret / Gem / Forhåndsvis / Offentliggør** | the announcement's **content** — the message, the link, the expiry. Nothing a guest reads changes until Offentliggør. |
| **Vis besked** | whether the **already published** message is **shown**. Both directions, immediately. It publishes nothing. |
| **Fjern beskeden nu** | the same operation as "Vis besked" off, by 1ad's second entrance. |

**No second RPC, and no branch.** `set_announcement_visible(p_visible, p_expected_updated_at)`
already took a boolean and already carried the guards the on direction needs — it was written
for Fortryd, which is the same write. The manual re-show is that call with the same argument,
so there is nothing extra to authorize, validate, version-check, audit or map, and the pgTAP
suite's §10d covers both because at the database they are one call.

**It cannot publish a pending draft, and that is structural.** The UPDATE names one column and
`draft` is not it. Message A published, message B drafted, the bar switched off and switched
back on leaves A on the hjemmeside, B pending, B in Forhåndsvis, and only Offentliggør able to
make B public — walked end to end in `announcement-remove.spec.ts` at both widths, and
asserted byte for byte from real JWTs in `supabase/tests/012_announcement.test.sql`.

**The on direction is offered only while it can succeed.** `isAnnouncementRestorable` is
`isAnnouncementPubliclyVisible` with `is_visible` set aside — written that way, rather than as
a second list of conditions, so the screen's offer and the database's `not_showable` refusal
cannot drift into two rules that merely agree today. An **expired** message gets a statement
instead of a switch, naming the expiry as the reason and Offentliggør as the way past it:
that sentence is true there and only there, because an expired message needs a new expiry, and
an expiry is content. **Nothing extends `expires_at` to make a press succeed** — not the
undo's refusal, not the manual one.

### What the completion pass settled

| # | Question | The answer |
|---|---|---|
| A | **Should the re-show be a second RPC, or a `restore_announcement`?** | **No, and neither.** One function, one boolean, one audit shape. `set_announcement_visible` already served manual hide and Fortryd; a third caller of the same write is not a third operation. Adding an RPC would have given the same column two writers with two sets of guards to keep in step — which is the failure §0e answer A records for the sold-out functions, arrived at from the other direction. |
| B | **Should it have become a generic "immediate action" abstraction beside the three sold-out paths?** | **No.** Four immediate operations now exist — three sold-out and this one — and they still name four tables, four columns and four attribution policies. They share conventions, not code: the jsonb status vocabulary, the order of checks, the repeated version check inside the UPDATE, the forbidden-versus-conflict probe, `security invoker` with `set search_path = ''`, and the `revoke … from public, anon` / `grant … to authenticated` pair. A function taking a table, a column and a row locator as arguments is a function that can be pointed at a table nobody reviewed. |
| C | **Does the visibility path have parity with the three sold-out ones?** | **Yes, on every term checked:** Staff *and* Owner may perform it (§5 puts the announcement in both rows) with `mayChangeEntity` asked before any query; `security invoker` with an empty `search_path`; `p_expected_updated_at` re-checked inside the UPDATE; `log_audit` with the before/after pair and the actor from the JWT; the result read back from the returned row rather than echoed from the request; the cache tag expired by the Server Action and only for a status that reached the row; and no authority of any kind supplied by the browser — the submission is one state and one version token, parsed by a `strictObject`. |
| D | **Can a malformed stored draft become public?** | **No — and the pass closed the gap that made the answer unclear.** `publishPendingChanges` re-reads the stored draft and answers `invalid_draft` before it calls any database function, so nothing was ever merged. But the screen left Offentliggør *available* and worded the outcome "prøv igen", which is an invitation to retry something that can never succeed. `announcementPublishOutlook` now takes the malformed flag and answers `unreadable_draft` first, so the button is greyed out with 1ad's own explanation, and the action's refusal names the one thing that helps: save the fields again to replace the draft. **Nothing repairs the draft** — not by dropping it, not by publishing the published values in its place. |
| E | **Is the deactivated-mid-session refusal announcement-specific?** | **No, and it must not become so.** `requireStaff()` already owns it: a profile with `disabled_at` set is redirected to `/admin/login?fejl=deaktiveret` with "Din konto er deaktiveret. Kontakt ejeren." Every Server Action on this screen calls it first, so all four writes — Gem, Offentliggør, "Fjern beskeden nu" and "Vis besked" — fail the same way, with no announcement-level check anywhere. |
| F | **Is 768 px still clean with every control on screen?** | **Yes**, in all seven admin states, and so are 375 and 1440. Measured below. |

### The states neither suite could reach cheaply — now walked

§0g listed two. Both were walked against a production build, by writing the state directly
through PostgREST with a real Staff or Owner JWT and then driving the screen as a person
would. Neither is a permanent test, because neither state can be produced by any path the
application offers — reaching them needs a database write the administration has no button
for. What each proved is recorded here instead.

| State | What happened |
|---|---|
| **A malformed stored draft**, with the visibility controls on screen | The screen renders (HTTP 200, no crash). The malformed-draft notice appears. The fields show the **published** values, because `overlayDraft` applies no part of a draft that fails its schema. The Kladde band is absent, because no readable field changed. Offentliggør is greyed out with "Den gemte kladde kan ikke læses. Gem felterne igen for at erstatte den." Pressing "Fjern beskeden nu" moved `is_visible` to false and left `message`, `expires_at` and the malformed `draft` **byte-identical** — the visibility controls act on the published announcement and nothing else. The draft never became public. State restored. |
| **A Staff account deactivated mid-session**, with the screen already open | All four writes were refused: Gem, Offentliggør, "Fjern beskeden nu" and "Vis besked" each redirected to `/admin/login?fejl=deaktiveret` and said so in Danish. No 5xx on any attempt — it fails safely rather than showing a server error page. The announcement row was **byte-identical** afterwards, including its pending draft, and `audit_log` held exactly the same number of rows before and after. Account restored. |

### Visual corrections made by the completion pass

One, and it is real.

| Where | What was wrong | The fix |
|---|---|---|
| `components/site/announcement/AnnouncementBar.tsx` | 1ac labels the desktop bar **"41 PX HØJ"**. It measured **61 px** at 768 and 1440 whenever it carried a link, because the row's `py-2` was padding a link that already carried `min-h-tap` — the 44 px promise was being kept twice, and 1ac's stated proportion (*"bjælken skal læses efter logoet og udmærkelsen, ikke før"*) was paying for it. The component's own comment claimed "about 46 px", so the drift was not visible from the source either. | `md:py-0` on a **linked** row, so the 44 px target *is* the bar's height: **45 px** with the hairline, four pixels over the frame. An **unlinked** row has no target in it, keeps `md:py-2.5` and measures **42 px**. The phone is untouched — there the whole row is the target and the message wraps above the link. `tests/e2e/announcement.spec.ts` now asserts the ceiling from `md`, so it cannot drift back. |

Nothing else moved. Measured across seven admin states — empty, published and showing,
with a Kladde, switched off and still showable, switched off and expired, with every field
error on screen, and with the Fortryd strip up — at 375, 768 and 1440 px: **no horizontal
overflow, no control under 44 px, and no wrapped control label anywhere.** The only elements
under 44 px are the six field captions, which are text rather than targets. The public bar was
measured linked, unlinked, with a wrapping 79-character message and absent: no overflow at any
width, no clipping, and an absent bar reserves nothing — the header sits at 0 (1ac: *"den
findes ikke i siden"*).

### Accessibility, checked once more end to end

A keyboard-only walkthrough at 375 and 1440, over the three states the switch has, visits —
in 1ad's own reading order — Oversigt, Forhåndsvis, Offentliggør, **Vis besked**, Besked,
Link, Tekst på linket, Anden adresse, the chip group, Dato, Klokkeslæt, Gem and **Fjern
beskeden nu**. Every stop takes a **3 px solid** focus ring and every stop is **at least
44 px**. The chips are one radio group, so Tab enters at the chosen chip and the arrows move
within it — the pill is the 44 px target, not the clipped input.

The switch is a button whose accessible name carries both the state and the outcome in each
direction — *"Beskeden vises på hjemmesiden. Slå fra, så den fjernes straks."* and
*"Beskeden vises ikke på hjemmesiden. Slå til, så den samme besked vises igen straks."* — and
the state is carried by the knob, the mark and the words as well as the colour (1aa). Under
`prefers-reduced-motion: reduce` the strip's transition is neutralised rather than shortened,
and focus stays on the document body after a removal: the strip does not steal it. The public
region keeps its `aria-live="polite"` and its label *"Besked fra restauranten"*, and the guard
still removes only the bar's content, never the region.

### The replacement boundary — restated, because it did not move

Phase 7 is finished **without** any of the following, and none of them is reachable from any
form, action or function it ships:

| Not in phase 7 | Owned by |
|---|---|
| Replacing an active announcement | **phase 8** |
| `previous` and `replaced_at` | **phase 8** — named by no statement in either migration and by no line of the application; the pgTAP suite asserts both are still `null` after a removal and after a restore |
| `source='opening_hours'` and generated opening-hours announcements | **phase 8** — nothing in phase 7 writes `source`; it stays `'manual'` |
| "Erstat med den nye besked", and conflict sheet **1ae** | **phase 8** — the pgTAP suite asserts no `replace_announcement` or `restore_announcement` function exists |
| An announcement archive, a history list, a second simultaneous bar | **never** (1ad, §4) |

**"Restore" in phase 7 means visibility and only visibility.** Fortryd and the manual re-show
both put back the *same, unchanged, already published* announcement. Neither reads `previous`,
and no replacement semantics were introduced anywhere on the way to making the switch
bidirectional.

### Recorded explicitly, because each of these is a rule somebody could later assume away

| Statement | Where it is enforced |
|---|---|
| **Visibility never publishes a pending draft.** In either direction. | `set_announcement_visible` names one column; `visibility-actions.ts` imports nothing from `lib/drafts` and nothing from `lib/publishing` beyond the role matrix and the cache tags. Asserted over the source, in pgTAP from real JWTs, and end to end at both widths. |
| **The on direction is refused for a message a guest could not be given**, and the refusal never moves the expiry. | `set_announcement_visible` → `not_showable`; `lib/announcements/visibility.ts` maps it to `expired` / `blank`; `isAnnouncementRestorable` decides only whether the press is drawn. |
| **One business operation, three entrances.** "Vis besked" (both ways), "Fjern beskeden nu" and Fortryd submit the same two field names to the same Server Action and reach the same database function. | `ANNOUNCEMENT_VISIBILITY_FORM`, `setAnnouncementVisibility`. The E2E suite compares the forms' fields *and* their Next.js action identifiers. |
| **The browser supplies no authority.** A state to move to and a version token; nothing else has a field. | `readAnnouncementVisibilityForm` (a `strictObject`), `set_announcement_visible(boolean, timestamptz)`. |
| **The cache is expired only after a write that reached the row.** | `visibility-actions.ts`; the domain module returns tags and expires none, asserted over its source. |
| **Every real write is audited; nothing else is.** A conflict, an `unchanged`, every `not_showable` refusal and every deactivated-account refusal write no audit row. Staff gains no audit-log read access — `audit_log` stays Owner-readable (§5). | `set_announcement_visible`, `public.log_audit`, `supabase/tests/012_announcement.test.sql` §10, and the deactivation walk above. |
| **A malformed draft cannot become public, and is never repaired.** | `storedDraftIsValid` in `lib/publishing/publish.ts`; `announcementPublishOutlook`'s `unreadable_draft`. |
| **`AnnouncementExpiryGuard` is unchanged by the whole of phase 7B and this pass.** No request, no polling, no cookie, no storage, no stolen focus. | `tests/unit/announcements/expiry-guard-source.test.ts`, and the empty request log in `tests/e2e/announcement.spec.ts`. |
| **Guests cannot dismiss the bar, and no public tracking state exists.** No dismiss control, nothing per-visitor to remember, and a guest still receives **zero cookies** (§12). | 1ac; `AnnouncementBar` has no control but the optional link; the E2E suite counts the guest's cookies. |

**Phase 7 is locked.** Phase 8A is built on top of it without touching it — see §0i.

---

## 0i. Phase 8A — the normal weekly opening hours (2026-08-30)

The Owner-only editor for the restaurant's **recurring weekly schedule** is built: frame
1t's upper card at `/admin/aabningstider`, seven weekday rows, each open or closed, each
open day carrying an opening and a closing time, saved as a Kladde and reaching the
hjemmeside only through Forhåndsvis → Offentliggør.

**It added no migration and no database function.** Everything it needed already existed:
the `opening_hours` singleton, `is_valid_opening_schedule()`, the three RLS policies, the
`publish_opening_hours()` transaction, the `pending_changes` view and the `hours` cache tag
have all been in place since phases 1 and 4, and the draft overlay, the strict draft parser,
the concurrency token and the audit row since phase 4. Phase 8A is an editor over machinery
that was already there, which is why the whole of it is five files in
`app/(admin)/admin/aabningstider/`, two components, one domain module and one admin read.

### What it contains

| | |
|---|---|
| **The route §3 prescribes** | `app/(admin)/admin/aabningstider/page.tsx`. No new admin hierarchy: the Owner's dashboard links to it, its bar links back to Oversigt. |
| **Seven weekday rows** | From `WEEKDAY_KEYS`, Monday first. The values come from the stored document — the confirmed week (Mon/Tue closed, Wed–Fri 15:00–20:00, Sat–Sun 17:00–20:00) is seeded **data**, and no time from it appears in any source file. |
| **Open/closed, and two times** | 1t's switch as a real `<input type="checkbox">` with a drawn track, and 1t's "kvarter-spring" dropdowns as `<select>`s over the whole day in quarter-hour steps. |
| **Validation, per day** | `lib/hours/weekly-form.ts`. Five refusals per weekday, each a Danish sentence naming the day, each bound to the field a person moves to fix it. |
| **Owner only** | `requireOwner()` in the page and in both Server Actions; `mayChangeEntity` inside `saveEntityDraft` and `publishPendingChange`; `opening_hours_update_owner` in the database. Three independent refusals, and **no SECURITY DEFINER anywhere in the path**. |
| **Kladde → Forhåndsvis → Offentliggør** | Phase 4's machinery, unchanged. Two preview links, because the schedule appears on Find os as seven rows and in the footer of every page as three grouped lines. |
| **The `hours` tag, after the fact** | Expired only for a publish whose result says `published`, by the Server Action rather than by the publish module. |

### The four readings this phase had to settle

| Question | Answer, and where it comes from |
|---|---|
| **Are a closed day's times kept, so reopening it is one press?** | **No, because the document has nowhere to keep them.** `is_valid_opening_schedule()` accepts a closed day only as the *exact* document `{"closed": true}` — the check is an equality test, not a subset one. So a closed day's dropdowns are empty, reopening one starts from "Vælg tidspunkt", and saving without choosing is refused by name. Retention was not invented to make the screen feel smoother than the model is. |
| **Are quarter-hour times a rule or a control?** | **A control.** 1t says *"Tider vælges i kvarter-spring"* about the dropdowns; the column, the CHECK, the Zod schema and the phase-2 engine all accept any `HH:MM`. A server that refused `15:20` would invent a restriction the rest of the system does not have — and would make an existing off-grid value unsaveable. So a stored time that is not on the grid is **added** to the choices, and nothing is ever silently moved to the nearest quarter. |
| **How does a closed row hide its two dropdowns without JavaScript?** | **A sibling selector.** The checkbox precedes everything that reacts to it, so `peer-checked:` — a plain `~` combinator, not `:has()` — draws both of 1t's appearances. The controls stay in the DOM and are still submitted when hidden (only `disabled` prevents that), which is what makes "turn a closed day on and choose its two times" **one save** rather than two. |
| **Does the bar get a Forhåndsvis, when 1t draws none?** | **Yes.** 1t's own preview button belongs to the one-off override card in its lower half, which is phase 8B. §6 makes Forhåndsvis the middle step of the only path by which the weekly hours reach the hjemmeside, and the bar is where 1r, 1ah and 1aj all put it. The control is the established one in its established place, not a new one invented for this screen. |

### What phase 8A deliberately does not contain

| | Owner |
|---|---|
| One-off date overrides, "Lukket en bestemt dato", "Andre tider en enkelt dag", "Ret kun i dag" | **phase 8B.** `opening_hours_overrides` is named by no query in this phase, and no form here has a date field. |
| The generated opening-hours announcement, `source='opening_hours'`, "Vis også som besked øverst på hjemmesiden" | **a later phase 8 increment.** `public.announcement` is named by nothing phase 8A added. |
| Replacing an active announcement, `previous`, `replaced_at`, and 1ae's conflict sheet | **a later phase 8 increment**, unchanged from §0h. The pgTAP suite asserts both columns are still `null`, `source` is still `'manual'`, and no `replace_announcement` or `restore_announcement` function exists. |
| Holiday automation of any kind | **not planned.** Nothing in this system decides a closing for the restaurant. |
| An immediate path for the weekly schedule | **none, by design.** §6 names exactly four immediate operations and this is not one of them, so there is no Fortryd strip on this screen and nothing to undo. |

### One consequence of two correct rules, recorded so it is not rediscovered as a bug

The published weekly schedule is what §7b's sold-out reset resolves against, and the reset
is **derived on read** with nothing stored. So publishing a new week silently changes when
every currently sold-out item comes back — and that is the intended behaviour rather than a
side effect to guard against: it is exactly why §4 refused to store a
`sold_out_expires_at`. Phase 8A therefore contains no sold-out code at all.
`tests/e2e/opening-hours.spec.ts` asserts the wiring once, from both ends: a **draft**
schedule does not move the reset sentence, and a **publish** does.

### Recorded explicitly, because each of these is a rule somebody could later assume away

- **Staff never see a locked form.** §5 says Owner-only tiles are absent for Staff rather
  than shown-and-disabled, so the dashboard tile is not rendered for them and the address
  redirects to `/admin/ingen-adgang` — the administration's existing refusal, which already
  names "normale åbningstider" among the Owner's areas. Absence is not the enforcement;
  `requireOwner()` is.
- **The browser names nothing.** The form carries twenty-one weekday fields and a version
  token, and no entity name, table name, row id, date or schedule document. The singleton is
  located through the publishing registry, and the publish action takes **no input at all**.
- **A week edited back to what is published stops being pending.** The save clears the draft
  rather than storing one that changes nothing, so the Kladde badge, the dashboard count and
  Offentliggør cannot claim a change the database does not hold (§4).
- **A draft schedule changes nothing a guest can see** — not the hours table, not the
  footer's grouping, not the open/closed badge, not the sold-out reset. Preview is the only
  way to look at one, and it needs a staff session and Draft Mode.
- **The day-specific messages do not replace the schema.** `weeklyScheduleSchema` remains the
  single statement of what a schedule may be, and `toWeeklySchedule` runs it as the last
  gate. The per-day checks exist to say *which day*, not to decide *whether*.

**Phase 8A is complete and green.** 8B — the one-off overrides — is now built on the same
screen and is recorded in §0j; the generated opening-hours message with its conflict sheet
is **8C** and is not started. **Phase 8 is not locked.**

---

## 0j. Phase 8B — one-off opening-hours overrides (2026-08-31)

1t's lower card — **"ENKELT ÆNDRING"**: *Lukket en bestemt dato* and *Andre tider en enkelt
dag* — is built, on the same screen as the recurring week and beneath it. One calendar date,
one of the model's two kinds, two times when the kind asks for them, Kladde → Forhåndsvis →
Offentliggør through phase 4's machinery, and a way to take the change away again.

### What it contains

| | |
|---|---|
| **The card 1t draws**, in the frame's own words | `components/admin/hours/OverrideEditor.tsx`. The two chips as a real radio group, a `type="date"` field, and 1t's *"Forhåndsvis"* and *"Gem og offentliggør"* in the card's own footer. |
| **The date rule §7e item 7 states** | Today or later, decided against `copenhagenDateOf(new Date())` on the server. A browser in another timezone cannot move an override to another day. |
| **Validation, per control** | `lib/hours/override-form.ts`. Nine refusals, each a Danish sentence, each bound to the control a person moves to fix it. |
| **Staff *and* Owner** (§5) | `requireStaff()` on the screen and in all four Server Actions; `mayChangeEntity('opening_hours_override', …)`; `overrides_{insert,update,delete}_staff` in the database. |
| **The recurring week, still Owner-only** | The weekly card is rendered only for an owner; its two actions still call `requireOwner()`; `opening_hours_update_owner` is still the table's only UPDATE policy. |
| **Kladde → Forhåndsvis → Offentliggør** | `saveEntityDraft`, `publishPendingChange` and `publish_opening_hours_override()` — phase 4's machinery, with the merge added. |
| **Removal** (§7e item 6) | `remove_opening_hours_override()`. Three meanings, one control, decided from the row the server read. |
| **The `hours` tag, after the fact** | Expired only by a publish that says `published`, and by a removal whose result says the row was live. |

### One migration, one new function, one replaced one, one column

`20260831120000_opening_hours_override_admin.sql`. It adds `draft jsonb` to
`opening_hours_overrides`, replaces `publish_opening_hours_override` so it merges that draft,
adds `remove_opening_hours_override`, and replaces the `pending_changes` view so an override
is listed as pending in either of its two ways. **It changes no policy and no grant.**

### Why a `draft` column, when §4 says an override is pending through its `status`

This is the one place phase 8B departs from what §4's table describes, and it is a real
departure rather than a convenience, so it is written out here as well as in the migration.

§4 describes an override the way `news` is described: `status` moves from `'draft'` to
`'published'` and there is no draft column. That model expresses three of the four states
this phase needs, and cannot express the fourth:

| State | Where it lives |
|---|---|
| **no row** | the date follows the normal weekly schedule |
| **`status = 'draft'`** | pending, and never yet live. `overrides_select_public` requires `status = 'published'`, so the row's own columns are safe to hold the pending values — there is nothing live on that date to protect |
| **`status = 'published'`** | live, and honoured by the phase-2 engine |
| **published, with a pending edit** | **nowhere, before this migration** |

The fourth is the ordinary case §6 exists for: the hjemmeside says *closed on Sunday*, and
somebody is preparing *13:00–18:00* instead. `date` is UNIQUE, so the pending edit cannot be
a second row. `status` is one value, so moving it back to `'draft'` would take the published
override **off the hjemmeside without anybody publishing anything** — a live change made by
pressing Gem, which is the single failure §6 exists to prevent. Overwriting the three content
columns publishes the edit immediately, which is the same failure by the other route.

So the column is added, and it is **§4's own draft mechanism** rather than a new idea: one
nullable `draft jsonb` holding only the changed fields, merged into the columns by the
publish function and set to null in the same statement — what `pages`, `site_contact`,
`opening_hours`, `announcement`, `menu_categories`, `dishes`, `weekly_special` and
`monthly_burger` all do. No second publishing path, no new status vocabulary, no history
table. `anon` holds a column-level grant that does not name it, so a guest cannot read it,
which `supabase/tests/014_opening_hours_overrides.test.sql` asserts from a real anonymous JWT.

**§4's table is corrected in place** to say `draft` as well as `status` for this row, and
this section is the record of why. `news` remains the one entity with no draft column at all.

### The five readings this phase had to settle

| # | Question | The reading, and why |
|---|---|---|
| A | **How can one screen hold two permissions?** | Per **card**, where §5 draws the line, rather than per page. `requireStaff()` guards the screen because the lower card is Staff's; the weekly card is *rendered only for an owner* and a statement stands in its place, which is §5's own treatment for an Owner-only area ("absent for Staff rather than shown-and-disabled") applied to a card instead of a whole screen. Absence is not the enforcement: `requireOwner()` in the weekly card's two actions, `mayChangeEntity`, and `opening_hours_update_owner` are, and a staff member who posts to the weekly action is refused three times over. Phase 8A's redirect to `/admin/ingen-adgang` from this address is therefore **withdrawn** — it would now keep a staff member away from work the matrix gives them. |
| B | **Where does the pending state live for a row that has never been live?** | **In its own columns**, with `status = 'draft'`. That is the shape `createDishDraft` already has for a new dish, for the same reason: creation is not a draft write, and the invisibility is carried by a column (`status` here, `is_new_draft` there) rather than by ordering two writes carefully. Every *later* edit goes through `saveEntityDraft` like any other entity's, and the publish merges whichever of the two is newer. The delta is measured against the row's **columns** either way, so an edit taken back to what the row already holds leaves no draft behind (§4). |
| C | **What does "Fjern" mean?** | **Three things, told apart by the row the server read** (`describeOverrideRemoval`), and the screen says which one it is offering before it is pressed. A *pending* override is deleted and no guest sees anything change. A *published* override with an edit behind it loses only the edit — a `saveEntityDraft` clearing three fields, so the published row is byte-identical. A *published* override is deleted, the date follows the weekly schedule again, and **that one asks first**: the control is a link to a confirmation rather than a submit, exactly as phase 5D's Slet ret is, so the destructive step cannot happen in one press even with a script error on the page. |
| D | **Why a real DELETE, when a dish is soft-deleted?** | Because the row is not the recovery story here. A soft-deleted dish is kept because its row carries a name, a description, a price, labels and a position that nobody could retype (§8, §0a D2). An override carries a date and at most two times, and re-creating one is the same three presses that created it. §7e item 6 states a rule about an override that is *deleted*, and phase 1 gave staff a DELETE policy on this table — the only content table besides `images` with one — so this is the lifecycle the model already intended. **No Fortryd strip**, and that is a decision rather than an omission: §6 names four immediate operations with a ten-second undo and each of them undoes something a person could not simply retype. What this press gets instead is the confirmation none of those four has. |
| E | **What can a guest actually see?** | The **open/closed badge**, on every page, and §7b's **sold-out reset** — both resolved by the phase-2 engine from the weekly schedule *and* the published overrides, and both since phase 2. Find os's seven-day table is the recurring week and does not change; the message that would say *"Ændrede åbningstider søndag"* in words is the generated announcement of **phase 8C**. So the E2E suite's observable is the badge, read from the bytes a guest is served, and the card supplements it with an admin-local sentence for a date further ahead than today — it does not replace the real Draft Mode preview, which is 1t's own "Forhåndsvis" and opens the real public page. |

### Three departures from 1t, and why

| Where | What ships |
|---|---|
| 1t draws **"Forhåndsvis"** and **"Gem og offentliggør"**, and no plain Gem | **"Gem" is added, beside them.** §6 makes Forhåndsvis the middle step of the path by which content reaches the hjemmeside, and a preview needs something to preview. Without a way to reach a pending state, the frame's own Forhåndsvis could only show what had already gone live, and this screen's promise — *the hjemmeside does not move until you publish* — would have no state in which it was observable. "Gem og offentliggør" keeps the frame's label and does exactly what it says, by calling the same save the button beside it calls and then publishing what it left pending. |
| 1t draws **Dato, Fra and Til in one row**, under the chips | **Dato is its own row, above the chips; the two times follow the chips.** The two time fields appear and disappear with the chosen kind, and they do it without JavaScript — the radio is a *sibling* of the fields and `peer-checked/andre:` is a plain `~` combinator. That requires the fields to follow the radios in the same container, and the date does not belong inside the group named *"Hvad sker der den dag?"*. The alternative was a script, on a screen that has none. |
| 1t draws **no list of existing changes** | **"Kommende ændringer" is added**, beneath the form. §7e requires that somebody choosing a date which already has a change is shown *that* change rather than allowed to create a second; a card with no way to see what exists would leave "which dates already have one?" answerable only by typing dates until one is taken. It shows today onwards, in the administration's established list vocabulary, each row naming its own state in words. |

### What phase 8B deliberately does not contain

| | Owner |
|---|---|
| **"Vis også som besked øverst på hjemmesiden"**, the suggested message beneath it, and `announcement.source = 'opening_hours'` | **phase 8C.** No form on this screen has a field for a message, a link or an expiry; `public.announcement` is named by nothing in `app/(admin)/admin/aabningstider/`; and `opening_hours_overrides.announcement_created` — §4's column for exactly that — is written by nothing and stays `false`. *(Superseded by 8C-3A: the column was **dropped**, and ownership is `announcement.source_override_id`. See §0n.)* |
| **Replacing an active announcement**, `previous`, `replaced_at`, "Erstat med den nye besked" and **conflict sheet 1ae** | **phase 8C**, unchanged from §0h. The pgTAP suite asserts both columns are still `null`, `source` is still `'manual'`, and no `replace_announcement` or `restore_announcement` function exists. |
| **§7e item 6's other half** — *"default to removing the announcement too when `source='opening_hours'`"* | **phase 8C.** There is no announcement to remove in 8B, because 8B never creates one. |
| **A ten-second Fortryd** for the removal | **none, by design** — reading D. |
| **Holiday automation of any kind** | **not planned.** Nothing in this system decides a closing for the restaurant. |
| **Any sold-out code** | **none.** §7b's behaviour in both directions arrives because `resolveSoldOut` resolves against the published overrides, and has since phase 2. Phase 8B adds an integration test and not one line of availability logic. |

### One consequence of two correct rules, recorded so it is not rediscovered as a bug

A **past** override is not listed, not editable and not served. Three separate rules say so
and they agree: §7e item 7 refuses the date on the way in, `readAdminOverrides` lists only
today onwards, and `overrides_select_public` hands a guest only rows dated today or later.
The rows themselves are **left in place** rather than tidied away, because nothing in this
system deletes data on a timer (§0a D2) — so a date that has passed keeps its audit trail
and simply stops being anybody's business.

### Recorded explicitly, because each of these is a rule somebody could later assume away

- **A staff member gains no authority over the recurring week by having a card on its
  screen.** Nothing in `override-*.ts`, `lib/hours/override-admin.ts` or
  `lib/content/hours-overrides-admin.ts` names `public.opening_hours` or the `opening_hours`
  entity. `supabase/tests/014_opening_hours_overrides.test.sql` asserts, from a real Staff
  JWT and in the same file that grants the override, that the weekly schedule is
  byte-identical after two refused writes.
- **The browser names nothing that decides anything.** The editor submits a date, a kind,
  two times and a version token; the pending band submits one date; the removal submits an
  id, a version and a confirmation. No entity name, no table name, no status, no column.
- **A version token belongs to a row, not to the screen.** The card carries the date its
  token was read for. Typing a *different* date writes nothing: the card re-opens on that
  date showing what is already there. That is §7e's "show the current state and edit the
  correct record" and the two-tabs answer at once.
- **An edit taken back to what the row holds stops being pending.** The save clears the
  draft rather than storing one that changes nothing, so the Kladde badge, the dashboard
  count and Offentliggør cannot claim a change the database does not hold (§4).
- **A stored draft on this table is complete or absent.** `overrideDraftWrite` writes all
  three content fields or clears all three, because `overrides_shape_check` is a rule
  *between* the columns — a draft naming only `kind` is one that could never be published,
  and the pgTAP suite proves the CHECK refuses exactly that merge.
- **The cache is expired only after a write a guest can notice.** Not on a refusal, not on a
  conflict, not on an `uændret` save, and not when the removed override was only pending.
- **Preview is the real page.** 1t's "Forhåndsvis" opens the public Forside through the same
  Draft Mode route every other preview uses, and `lib/content/hours.ts` resolves each
  override on that path *as publishing it would leave it* — a pending row, and the pending
  edit on a live one. A guest sees neither: three independent filters say so.

**Phase 8B is complete and green. Phase 8 is not locked**: 8C — the generated opening-hours
announcement, `source='opening_hours'`, the `previous` / `replaced_at` stash, "Erstat med den
nye besked" and conflict sheet 1ae — is not started. *(Its first increment, **8C-1**, is now
built and is recorded in §0k: the `previous` / `replaced_at` mechanism, with no generated
message and no conflict sheet.)*

---

## 0k. Phase 8C-1 — the announcement replacement and restore mechanism (2026-08-31)

§6's immediate-path table has three announcement rows. Phase 7B built two of them. This
section records the third, which every phase since has named and none has built:

> **Replace an existing announcement** — writes new values, stashes the old in
> `previous jsonb` — 10 s Fortryd restores from `previous`.

**8C-1 is the mechanism and nothing else.** It is infrastructure for **8C-3**, which is
where 1ae's conflict sheet will call it. There is **no new control anywhere in the
administration**: `/admin/besked` is phase 7's editor, unchanged, and the opening-hours
screen is phase 8B's, unchanged.

### What it contains

| | |
|---|---|
| **The snapshot shape** — what `previous` holds | `public.announcement_snapshot()`, and `lib/announcements/snapshot.ts` |
| **The snapshot validator**, asked before a snapshot is stored *and* before one is restored | `public.is_valid_announcement_snapshot()` |
| **The replacement transaction** — snapshot, write, `replaced_at`, visible, audit, one transaction | `public.replace_announcement()` |
| **The restore transaction** — read the snapshot from the row, restore it, clear `previous` and `replaced_at`, audit | `public.restore_announcement()` |
| **The domain wrapper** — the role matrix, a closed payload, the status mapping, the cache tags it does *not* expire | `lib/announcements/replacement.ts` |
| **The proof, end to end** — A → replace with B → **first** guest request sees B → restore → **first** guest request sees A, with and without a pending draft C | `tests/e2e/announcement-replacement.spec.ts` |

**One migration, four functions, no new table, no new column, no new policy and no new
grant on any table.** `previous jsonb` and `replaced_at timestamptz` have been on
`public.announcement` since `20260829120000_initial_schema.sql`, written by nothing
through the whole of phases 1–8B. `20260831140000_announcement_replacement.sql` is the
first statement anywhere in this repository that names either column.

### The snapshot — eight keys, and the five that are deliberately absent

`previous` holds the **published content and state** of the announcement that was
displaced, and only that:

    message, link_type, link_page, link_url, link_label, expires_at, is_visible, source

A `to_jsonb(announcement)` would have been shorter and wrong. Each exclusion is a rule:

| Absent | Why |
|---|---|
| `draft` | A draft is not published content. Stashing one would give a restore a way to make public something nobody pressed Offentliggør for — the single failure §6 exists to prevent. |
| `previous` | A snapshot inside a snapshot is a history stack with extra steps. **One level only** (§4; 1ad: *"intet arkiv, ingen kladdeliste, ingen historik"*). |
| `replaced_at` | A fact about the *replacement*, not about what it replaced. |
| `updated_at` | The optimistic-concurrency token (§6). Writing an old one back would corrupt the model every screen depends on. |
| `updated_by` | An actor id. Attribution comes from the JWT of whoever acts (§8), never from a stored value a caller could have chosen. |

`is_visible` and `source` **are** in it, and must be: without the first, a message
somebody had switched off would come back switched on; without the second, a generated
opening-hours message would come back calling itself manual. The shape is validated in
both directions, so a `previous` written by anything other than `replace_announcement`
is refused with `invalid_snapshot` — and the malformed value is left in place rather
than tidied away.

### The six readings this increment had to settle

| # | Question | The answer |
|---|---|---|
| A | **May the browser choose which fields a replacement writes?** | **No, and the shape is what says so.** `replace_announcement` takes **eight typed scalar parameters**, not a jsonb document — so there is no key a caller could add, no column name it could name and no shape it could smuggle. `is_visible` is not among them, because 1ae says *"Den nye besked går live"* and a replacement that did not go live is not one of the two outcomes the frame draws. `restore_announcement` takes **one** argument, the version token: the previous announcement is read from the database, and there is no parameter through which the browser could send content back. |
| B | **Where does `source` come from?** | **A closed vocabulary, from a server-side caller.** The two values are the table's own `announcement_source_check`, restated in the function and again in `ANNOUNCEMENT_SOURCES`. Phase 7 left `'opening_hours'` deliberately unused; 8C-1 is the first path *capable* of writing it. **Nothing generates the content yet** — composing *"Ændrede åbningstider søndag · 17:00–19:00"* is 8C-2, and the unit suite asserts that phrase appears in no source file. |
| C | **What happens when the previous announcement's expiry passes inside the ten seconds?** | **It is restored exactly as it stood, and nothing extends the expiry.** The result may be an announcement that is immediately ineligible for public display, and that is accepted: the previous state is a *fact*, not a request to show something, and refusing the restore would leave the replacement live with no way back. The reply carries `showable`, so the administration reports what actually happened rather than a success a visitor would contradict. **This is the one place restore and `set_announcement_visible` deliberately part company** — the visibility function *refuses* the on direction for an expired bar (`not_showable`, §0g reading C), because there the request genuinely is "show this now". |
| D | **What counts as "the current announcement" to stash?** | **Whatever the row holds — and the result says which of four it was.** `active` (a guest can read it) is the only case 1ae exists for. A **valid message that was switched off** is still the thing being replaced, so it is stashed *with its own `is_visible = false`* and comes back switched off. An **expired** message is not a public conflict, and is stashed faithfully all the same. **No message at all** is not dressed up as a conflict: the empty state is a valid snapshot, so Fortryd can put the emptiness back. 8C-1 reports; **8C-3 decides** whether a sheet is shown. |
| E | **Does a replacement touch a pending manual draft?** | **No, and it is structural.** Nothing in the technical plan says a replacement supersedes a draft, so the default safety rule holds: neither UPDATE names `draft`, and `lib/announcements/replacement.ts` imports nothing from `lib/drafts` and nothing from `lib/publishing` beyond the role matrix and the cache tags. Asserted over the module's whole import list, from real JWTs in pgTAP, and end to end — published A + pending draft C, replaced by B, restored to A, with C byte-identical at every step and never public. |
| F | **How is the first-guest-request promise proved with no screen to press?** | **With an internal harness that 8C-3B deleted.** *(Deleted, as promised — §0o. The scenarios moved to `tests/e2e/opening-hours-announcement.spec.ts`, which drives them through 1t's checkbox and 1ae's sheet.)* `updateTag()` may only be called from inside a Server Action, and a Server Action is only reachable when something renders a form that dispatches to it. Since 8C-1 must add no replacement control, the form lives at an unlinked address behind an environment flag (`app/(admin)/admin/intern/besked-erstatning/`), set by `playwright.config.ts` for the test server and by nothing else — a deployed build has no such variable, so the address is a 404 and both actions refuse. It is guarded by `requireStaff()` first and the flag second, and **the browser still chooses no content**: the submission is a closed variant key and a version token, and the payload is composed on the server. That is exactly the shape 8C-3B's real form took. |

### What phase 8C-1 deliberately does not contain

| | Owner |
|---|---|
| **The generated opening-hours message**, "Vis også som besked øverst på hjemmesiden", and the suggestion beneath it | **8C-2.** Nothing here reads `public.opening_hours` or `public.opening_hours_overrides`, composes a weekday or a clock face, or writes `opening_hours_overrides.announcement_created` — which is still written by nothing and stays `false`. *(Superseded by 8C-3A: the column was **dropped**, and ownership is `announcement.source_override_id`. See §0n.)* |
| **Conflict sheet 1ae**, "Erstat med den nye besked", "Behold eksisterende besked", the focus trap and the green Fortryd strip | **8C-3.** The domain result carries what a sheet would need to decide; no sheet exists. |
| **Any replacement control in `/admin/besked`** | **never.** 1ad's editor is content-editing plus visibility, and stays that. |
| **A history, an archive, or a second level of undo** | **never** (§4, 1ad). A second replacement overwrites the snapshot; the audit log is the historical record. |
| **A generic content-replacement framework** | **never.** These functions take no table name, no column name and no row locator — the singleton locates itself, for the reason §0e answer A records for the three sold-out functions. |

### Recorded explicitly, because each of these is a rule somebody could later assume away

- **One transaction, or none of it.** Verifying the version, reading the current
  announcement, storing the snapshot, writing the replacement, stamping `replaced_at`,
  making it visible and writing the audit row commit together. There is no state in
  which the old message is gone but the replacement failed, in which the replacement is
  live but `previous` was not stored, or in which the log says "replaced" and the row
  does not.
- **The cache is expired only after a write that reached the row.** Not on a conflict,
  not on `invalid_payload`, not on `nothing_to_restore`, not on `invalid_snapshot`, not
  on a refusal. The domain module returns the tags and expires none — asserted over its
  source, as phase 7B's does — and the Server Action expires them after the commit. The
  five-minute `revalidate` / `expire` pair from the public-cache fix is unchanged, and
  the browser suite asserts the **first** guest request carries the change.
- **Both real writes are audited; nothing else is.** `log_audit('replace', …)` and
  `log_audit('restore', …)`, each carrying the before/after snapshot pair, with the
  actor from the JWT. Every refusal writes no audit row. Staff gains no audit-log read
  access — `audit_log` stays Owner-readable (§5).
- **All four functions are SECURITY INVOKER with `set search_path = ''`.** RLS
  re-decides `is_staff()` against the caller's own JWT; `anon` is revoked explicitly and
  meets `42501` at the function, before RLS is consulted.
- **`previous`, `replaced_at` and `draft` remain invisible to guests.** None is in
  `anon`'s column grant, and the pgTAP suite reads all three from a real anonymous JWT
  and gets `42501` for each.
- **Phase 7's own behaviour is untouched.** `set_announcement_visible` still names one
  column and still leaves `previous` and `replaced_at` null; §10 of
  `supabase/tests/012_announcement.test.sql` is unchanged. What did change in that file
  is its two **forward-looking boundary guards** — "no replacement or restore RPC
  exists — that is phase 8", and the count of announcement functions. They were written
  to fail exactly when this phase arrived, and they now assert the new boundary instead:
  the two functions exist, no ad-hoc removal or source-setting RPC does, and nothing
  generates a message. The same is true of one assertion each in `013` and `014`.

**Phase 8C-1 is complete and green. Phase 8 is not locked**: **8C-2** — the generated
opening-hours message, `announcement_created`, and 1t's "Vis også som besked øverst på
hjemmesiden" — and **8C-3** — conflict sheet 1ae with both its branches, and the ~10 s
Fortryd strip over `restore_announcement` — are not started.

---

## 0l. Phase 8C-1 hardening — the announcement lifecycle columns (2026-08-31)

The 8C-1 acceptance report closed the mechanism and left one thing open:

> Staff currently have a broad, table-level UPDATE capability on `public.announcement`.
> Internal lifecycle fields such as `previous` and `replaced_at` can be modified directly
> through the database/API, outside the trusted replacement and restore functions.

That was accurate, and — once `restore_announcement()` existed — no longer something to
merely record. **8C-2 is not started; this pass adds no feature and changes no screen.**

### The finding, and why it mattered more after 8C-1 than before it

`previous` and `replaced_at` sat unused from phase 1 until 8C-1 gave them a purpose. The
purpose is what created the exposure: `restore_announcement()` reads `previous` from the
row and publishes what it finds, deliberately without consulting `now()`, without the
payload checks `replace_announcement()` makes, and without the showable checks
`set_announcement_visible()` makes. Its safety rests entirely on `previous` being a value
only `replace_announcement()` could have written — and the initial migration's
`grant select, update on public.announcement to authenticated` meant anyone with a Staff
session could write it. The session cookie is httpOnly, which defends against XSS and not
against the person the session belongs to; a Staff member can read their own token out of
their own browser and reach PostgREST with it.

Reproduced before the fix, from a real Staff JWT: a forged eight-key snapshot written
straight into `previous`, then `restore_announcement()` called, and the forged message
live and public — logged as an ordinary `restore`.

`is_valid_announcement_snapshot()` was never going to catch it, and this is the reading
that matters: **the forged snapshot is a perfectly valid snapshot.** Eight keys, right
types, an approved link, an expiry in the future. Nothing is wrong with its shape. What
is wrong is who wrote it, and a shape validator cannot see that.

### What the exposure did and did not amount to

Staff may publish arbitrary announcement content — that is §5's matrix, not a
vulnerability. The forgery route was still worth closing on its own terms:

- **it bypassed the audit trail.** A direct UPDATE writes no `audit_log` row, so live
  content could change with nothing in the record but a stamped `updated_by` (§8's
  "silent data loss" row).
- **it bypassed every validating path.** A blank message with `is_visible = true`, an
  expiry already past, a `source` of `'opening_hours'` on a hand-typed message — none of
  which `publish_announcement()` or `replace_announcement()` would produce.
- **it bypassed optimistic concurrency** (§6), overwriting a colleague's change with no
  conflict.
- **it made a trusted function's input caller-controlled**, which is the part 8C-2 would
  have built on: 8C-2 writes `source = 'opening_hours'` and 8C-3 puts a Fortryd over
  `restore_announcement()`.

### What the pass contains

| | |
|---|---|
| **A column-level UPDATE grant**, replacing the table-level one | `20260831160000_announcement_column_privileges.sql` §1 |
| **One BEFORE UPDATE guard trigger**, SECURITY INVOKER, owning the columns privileges cannot | `public.tg_guard_announcement_write()` |
| **The four lifecycle functions, each declaring its transition** — otherwise byte-identical to 7A, 7B and 8C-1 | the same migration, §3 |
| **The model, written down** | §5, "Column write ownership — `public.announcement`" |
| **The proof** — 82 assertions from real Staff, Owner and anonymous JWTs, including the forgery attack end to end | `supabase/tests/016_announcement_write_guard.test.sql` |

**No new table, no new column, no new view, no new index, no new policy, no new SECURITY
DEFINER function, and no TypeScript.** The application already wrote `draft` directly and
called an RPC for everything else, which is why nothing above the database had to move.

### The one reading this pass had to settle

| # | Question | The answer |
|---|---|---|
| A | **Can column privileges alone protect `previous` while the lifecycle functions stay SECURITY INVOKER?** | **No, and it is a property of PostgreSQL rather than of this schema.** A SECURITY INVOKER function runs with its caller's privileges; there is no per-function table grant, and no way to keep the caller's identity while borrowing the function's rights. So every column the four functions write must be a column `authenticated` holds UPDATE on — the exact privilege the attack used. Measured: with the grant narrowed to `(draft)`, the direct write is refused **and so are all four functions**. The two ways out that would have worked are SECURITY DEFINER (which takes the whole lifecycle out from under RLS, and is refused) and constraining the *transition* rather than the privilege. The pass takes the second, and narrows the grant as far as privileges can go underneath it — `id`, `is_singleton`, `created_at`, `updated_at` and `updated_by` are out of the grant entirely, because nothing writes them. |

### Recorded explicitly, because each of these is a rule somebody could later assume away

- **`draft` is the only column a direct write owns.** Everything else on this table moves
  through `publish_announcement()`, `set_announcement_visible()`, `replace_announcement()`
  or `restore_announcement()`. The guard is not a draft validator — a draft may contain
  any keys at all, because `saveEntityDraft()` parses strictly on the way in and the
  publish merge names its six fields literally. Both of those still have to exist.
- **Nothing became SECURITY DEFINER.** The four lifecycle functions and the guard are all
  invoker-rights with `search_path` pinned to nothing, and `016` asserts it by counting.
- **`updated_at` and `updated_by` are still stamped.** A BEFORE trigger's assignment to
  `NEW` is not privilege-checked, so removing them from the grant costs the stamp nothing
  and costs a forger the concurrency token and the actor.
- **The guard steps aside for `postgres` and `service_role` only**, which are migrations,
  the seed and the fixtures — never a browser session. `authenticated` is a member of no
  other role, so it cannot put that exemption on.
- **Reading was not narrowed.** The editor still reads every column including `previous`;
  `anon` still reads the same six it always did.
- **The other four singleton tables were deliberately left alone.** None of them yet has a
  column one trusted function is the sole author of and a second trusted function then
  believes. Widening the pass is a decision of its own.
- **Two phase-1 assertions changed meaning, and were rewritten rather than deleted.**
  `002` and `003` asserted the announcement capability as one direct UPDATE of the
  published columns. They now assert the same capability through the path that owns it —
  a draft, then `publish_announcement()`, then `set_announcement_visible()` — and `016`
  asserts the refusal of the old statement. §5's matrix is unchanged.

**The lifecycle-column finding is closed. Phase 8C-2 is recorded in §0m.**

---

## 0m. Phase 8C-2 — the pure opening-hours announcement generator (2026-08-31)

8C-1 built the mechanism that *carries* a generated announcement and said, in as many
words, that nothing composed one yet. This increment composes it, and does **only** that:

> `lib/announcements/generated.ts` — one exported function,
> `generateOpeningHoursAnnouncement()`, which turns a one-off opening-hours override
> into the message, the link and the expiry 8C-3 will suggest, or into an explicit
> refusal.

**No database access, no clock read, no cache invalidation, no React, no Server Action,
no write, no migration, and no caller.** The module is imported by its unit suite and by
nothing else; `next build` produces the same route table it did before. 1t and 1ae are
visually unchanged in the running application.

### The corrected expiry rule, and the discrepancy that produced it

The obvious reading — **`expires_at = override.closes_at`** — is wrong, and the approved
design disproves it with a number. 1t draws a Sunday whose recurring hours are
17:00–20:00, a one-off change to **17:00–19:00**, and the generated expiry **20:00**;
1ae draws the same message beside *"Udløber 14.09.2026 kl. 20:00"*. The override's own
closing is 19:00, and neither frame prints it.

1t's helper sentence glosses the number as *"Udløber automatisk søndag 14.09.2026 kl.
20:00 — når I lukker den dag"*, which reads like 19:00 and is the loose half. **The
number is the authority**: it appears twice, in two frames, and the gloss once.

The rule the number states, generalised to every case:

> **The closing time the expiry uses is the LATER of the normal closing and the special
> closing.** The message stands for as long as *either* picture could still be in a
> guest's head — the one the recurring hours table gave them, or the one the override
> gives them.

| Normal | Override | Expiry closing | Why |
|---|---|---|---|
| 17:00–20:00 | 17:00–19:00 | **20:00** | somebody may still arrive at 19:30 expecting the usual |
| 17:00–20:00 | 17:00–22:00 | **22:00** | the extra hours are the news, and they are news until they end |
| closed | 13:00–18:00 | **18:00** | the only closing there is |
| 15:00–20:00 | **closed** | **20:00** | the announcement stands through the hours guests would otherwise expect |
| closed | **closed** | *(none)* | `no_effect` — see below |

There is **no arbitrary midnight expiry** anywhere in this module, and nothing is ever
moved forward to make a suggestion publishable.

*A second design discrepancy, recorded because it is the reason the generator derives its
own weekday:* 1t's drawn date, **14.09.2026, is a Monday**, and the frame labels it
"Søndag". The generator takes an `IsoDate` and asks `weekdayOf` — it accepts no
preformatted weekday string — so the mismatched pair the frame draws is not reproducible
by construction. The unit suite uses **13.09.2026**, the Sunday beside it.

### The two generated strings

| | The rule | Example |
|---|---|---|
| **Changed hours** | `Ændrede åbningstider {weekday} · {from}–{to}`, from `lib/hours/format.ts` — the Danish weekday words, the en dash in the range, and the `·` `describeOverrideDay` already prints on the override list | `Ændrede åbningstider søndag · 17:00–19:00` |
| **A closed day** | `Lukket {weekday} {DD.MM}` — `formatWeekdayDate`, unchanged from 8B | `Lukket mandag 21.09` |

1ac's older shorthand for the second is *"Lukket mandag 21.09 — privat arrangement"*,
and **the override model has no reason field**. So no reason is invented: not "sygdom",
not "privat arrangement", not "ferie", not "vedligeholdelse". The suggestion is neutral
and editable, and 8C-3 may let staff add whatever is true before it is used. Both strings
are asserted against the frames' own text; the closed form's absent em dash is asserted
too, so a reason cannot creep back in as punctuation.

**1ac's 90-character rule** is checked and never worked around: a generated default that
exceeded it would return `too_long` rather than be truncated. It is unreachable — the
widest string either form can produce, over all seven weekdays and the widest clock faces
the model allows, is **42 characters** — and it is stated all the same, on the same terms
`invalid_snapshot` is stated in `./replacement.ts`.

### The link defaults, from the frames

1ac draws the two bars side by side. **"DESKTOP · MED LINK"** carries the changed-hours
message with **"Se tider"**; **"DESKTOP · UDEN LINK"** carries the closed message as
plain text, with the frame's own note — *"Link er valgfrit. Uden link er hele bjælken ren
tekst — ingen tom knap, ingen pil."*

* **Changed hours** → `link_type: 'page'`, `link_page: '/find-os'`, `link_label: 'Se
  tider'`. Find os is the page carrying the seven-day hours table, and the constant is
  typed as an `AnnouncementPageRoute` — a member of the same closed set
  `ANNOUNCEMENT_LINK_PAGES` and `announcement_link_page_check` carry (§8), so a route
  this site does not serve would not compile. No path string is hard-coded twice.
* **A closed day** → `link_type: 'none'` and no page, URL or label. A closed day has no
  times to go and look at, and no other CTA is invented for it.

Every result carries `source: 'opening_hours'` — 8C-1's existing `ANNOUNCEMENT_SOURCES`
vocabulary, not a second enum.

### The shape

    generateOpeningHoursAnnouncement({ date, override, schedule, now })
      → { ok: true,  announcement: GeneratedAnnouncement }
      → { ok: false, reason: 'no_effect' | 'expired' | 'too_long' }

Everything it needs arrives as an argument. `schedule` is the recurring week — **it is
never queried** — and `override` is 8B's own `OverrideContent`, the three content columns
of one date, which may equally be a draft's content: the question is *what would this
change say*, and it is asked before anything is published. `now` exists for exactly one
decision and is never read from `Date.now()`.

`GeneratedAnnouncement` is **assignable to** `AnnouncementReplacement` rather than
imported from it — `./replacement.ts` carries `server-only`, and a pure generator that
dragged the Supabase client behind it would stop being one. The unit suite asserts both
halves: that it type-checks as a replacement, and that `parseAnnouncementReplacement()`
accepts every announcement it produces.

### Recorded explicitly, because each is a rule somebody could later assume away

- **An override row is not a change.** `no_effect` covers both the case the brief names —
  a closed override on a day the recurring week already closes — and the same situation
  arrived at from the other side: a custom override that restates the hours the week
  already has. Neither gets a message about nothing, and neither gets an expiry.
- **One engine, asked twice.** The normal day and the special day are both
  `getDayOpening()` from phase 2 — once with no overrides, once with this one treated as
  published. There is no second opening-hours engine here, no re-implementation of "which
  hours apply", and the times the message prints are the engine's own normalised ones, so
  a Postgres `15:00:00` and a schedule's `15:00` produce the same string.
- **One Copenhagen conversion.** `announcementExpiryInstant()` from `./expiry-editor.ts`
  — the same call 1ad's own expiry fields use, which owns both daylight-saving
  conventions. Nothing here concatenates `YYYY-MM-DD` + `HH:MM` + `Z`. The suite pins
  exact UTC instants in CET, in CEST, on the spring transition Sunday, on the autumn
  transition Sunday, and on the Saturday either side of each — where the same wall clock
  is a different instant.
- **One expiry rule.** `isAnnouncementExpired()` from `./expiry.ts`, so the boundary is
  the anonymous RLS policy's own `expires_at > now()` and not a second opinion. At exactly
  the expiry instant the answer is `expired`.
- **`announcement_created` is still written by nothing** and stays `false`. *(Superseded
  by 8C-3A, which dropped the column: ownership is `announcement.source_override_id`, and
  §0n records why one pointer beats a boolean. The rule this bullet states — generating a
  suggestion is not completing an operation — is unchanged and is now carried by the
  coordinator.)* Generating a
  suggestion is not completing an announcement operation; **8C-3** owns that column, and
  sets it only after the operation succeeds.
- **8C-1's boundaries are intact.** Nothing here calls `replaceAnnouncement()` or
  `restoreAnnouncement()`, names `previous` or `replaced_at`, or touches a draft or the
  bar's visibility. The temporary replacement harness at
  `/admin/intern/besked-erstatning` is unchanged here, and was **deleted by 8C-3B** (§0o).

### What phase 8C-2 deliberately does not contain

| | Owner |
|---|---|
| 1t's **"Vis også som besked øverst på hjemmesiden"** checkbox, the editable suggestion beneath it and the generated expiry field | **8C-3.** No screen imports the generator; `tests/unit/hours/override-source.test.ts` asserts it over `app/` and `components/`. |
| **Conflict sheet 1ae**, "Erstat med den nye besked", "Behold eksisterende besked", the focus trap and the green Fortryd strip | **8C-3**, unchanged from §0k. |
| **Any Server Action, any write, any migration** | **8C-3.** The increment is one pure module and its tests; the database is untouched, so the pgTAP suite did not run and did not need to. |
| **The §7e item 6 rule** — removing the generated announcement when its override is deleted | **8C-3.** There is still nothing published to remove. |

### The boundary tests, narrowed rather than deleted

Two forward-looking suites were written to fail exactly when this phase arrived. Neither
was removed:

- `tests/unit/hours/override-source.test.ts` keeps every phase-8B assertion — the four
  override-path files still name no announcement of any kind — and **adds** the narrowed
  half: the generator is pure and calls neither replacement function, no Server Action,
  route, page or component imports it or names `generateOpeningHoursAnnouncement`, and no
  screen renders "Vis også som besked", "Foreslået besked", "Erstat med den nye besked"
  or "Behold eksisterende".
- `tests/unit/announcements/replacement-boundary.test.ts` keeps its assertion unchanged —
  the phrase *"Ændrede åbningstider"* appears in no file under `app/` or `components/` —
  and its description is narrowed to what it was always about: no **screen** composes the
  wording by hand.

**Phase 8C-2 is complete and green. Phase 8 is not locked.** Its successor, **8C-3A**,
is recorded in §0n; the remaining user-facing half is **8C-3B**.

---

## 0n. Phase 8C-3A — generated-announcement ownership and atomic coordination (2026-08-31)

8C-1 built the transaction that *carries* a replacement. 8C-2 built the pure generator
that *composes* one from a one-off opening-hours change. This increment is the thing
between them, and it is a **backend/domain** increment: no screen changed, 1t draws no
checkbox, 1ae does not exist, and the 8C-1 harness is still there. All three were 8C-3B's
(§0o): the checkbox and the sheet exist now, and the harness is gone.

It exists because of one question neither earlier increment could answer:

> announcement A was generated by override A and is live.
> announcement B, generated by override B, replaces it.
> Fortryd puts A back.
> **Which override owns the announcement now?**

### The existing model could not answer it, and this is why

`opening_hours_overrides.announcement_created` — §4's column for the job, written by
nothing through phases 1–8C-2 — is a boolean *per override* with no counterpart on the
announcement. Three things follow, and each one is fatal on its own:

| | |
|---|---|
| **It cannot name what it owns.** | It says "this override generated something". Two overrides that have each generated something are indistinguishable from one that owns the current message and one that does not. |
| **The `previous` snapshot had no owner at all.** | Restore could put A's words back and had nothing to put A's *provenance* back from. After a Fortryd the system would know a generated message was live and not which date it described. |
| **§7e item 6 was answerable only by reading the message.** | *"…and it points at that date"* had no id to compare. The suggested wording is editable by design (§0m), so the text is evidence of nothing — and parsing a weekday out of it to decide whether to take a live message down is the kind of rule that is wrong the first time somebody edits a suggestion. |

So the answer was **no**, and 8C-3B could not have been built on it.

### The model: one pointer, and no second copy of the same fact

    public.announcement.source_override_id uuid null
      references public.opening_hours_overrides (id) on delete restrict

    source = 'manual'         ->  source_override_id is null
    source = 'opening_hours'  ->  source_override_id names exactly one override

Both halves are `announcement_source_owner_check`, so neither can be true without the
other, and `lib/announcements/ownership.ts` is the same rule in TypeScript — it returns
`null` rather than "manual" for a pair the model cannot hold, so a broken row cannot be
quietly read as an unowned one.

**`announcement_created` is dropped**, and that is the decision this increment turns on.
The brief's preferred design was the pointer *or* a cleaner existing representation, and
keeping the boolean beside the pointer would have cost two things and bought none:

- **It would be a second store of one fact.** With the pointer present, "does this
  override own the current announcement?" is `announcement.source_override_id = o.id` —
  derived, never stored twice, and therefore never able to disagree with itself. A
  boolean beside it is a cache of a join, and a cache a failed statement can leave stale
  is precisely the state the brief forbids: *announcement B is live but override A still
  says it owns it.*
- **It would need a second write guard.** `opening_hours_overrides` carries a
  table-level `update` grant to `authenticated`, so a *trusted* `announcement_created`
  would have needed the whole apparatus of §0l — a column grant and a BEFORE UPDATE
  trigger — rebuilt on a second table, to protect a value already knowable without it.
  The pointer lives on `public.announcement`, where that guard already stands, and joins
  it with one line.

**"At most one override owns the current announcement" is therefore structural rather
than constrained.** There is one announcement row (`announcement_singleton`), it holds
one `source_override_id`, and one column cannot hold two values. The partial unique index
the brief offered is not created, and its absence is the stronger answer: an index can
only make a duplicate unlikely to be written, and there is nowhere here for a duplicate
to live.

### The snapshot's ninth key

`previous` now holds nine keys rather than eight:

    message, link_type, link_page, link_url, link_label, expires_at,
    is_visible, source, source_override_id

§0k's five exclusions are unchanged and unchallenged — no `draft`, no nested `previous`,
no `replaced_at`, no `updated_at`, no `updated_by`; one level, strict, no actor from the
browser. `source_override_id` is not one of them: it is part of the published **state**
in exactly the way `source` is, and §0k's own argument for `source` — *"without it, a
generated opening-hours message would come back calling itself manual"* — applies
unchanged one level down. Without the owner it would come back owned by nobody, which
the CHECK refuses outright. **If the previous announcement was manual, the key is
`null`.** SQL and Zod were changed together, and both restate the pairing rule.

### What it contains

| | |
|---|---|
| **The ownership column, its foreign key and its pairing CHECK**; `announcement_created` dropped | `20260831180000_generated_announcement_ownership.sql` §1 |
| **The twelfth column grant**, and the write guard extended to own `source_override_id` beside `source` | the same migration, §2 and §5 |
| **The four-way conflict answer, stated once** — lifted out of `replace_announcement()` so the coordinator asks the same question | `public.announcement_replacement_kind()` |
| **`replace_announcement()` gains one appended, defaulted parameter** and the pairing rule; the override must exist **and be published** | the same migration, §7 |
| **`restore_announcement()` restores ownership in the same statement as the content**, and names the one case a jsonb snapshot can outlive: `owner_missing` | §8 |
| **The coordinator** — re-reads the singleton, returns `conflict` for an `active` announcement unless confirmed, and otherwise delegates | `public.apply_generated_announcement()` |
| **The removal refuses while it owns** — the live message, or the one stashed for Fortryd | `public.remove_opening_hours_override()`, §10 |
| **The domain operation** — the role matrix, the reconstruction, the status mapping, the cache tags it does *not* expire | `lib/announcements/generated-operation.ts` |
| **The ownership vocabulary**, pure | `lib/announcements/ownership.ts` |
| **The proof** — 105 pgTAP assertions from real Staff, Owner and anonymous JWTs | `supabase/tests/017_generated_announcement.test.sql` |
| **The proof through the real cache path** — hours published, conflict, confirmation, first guest request, Fortryd | `tests/e2e/announcement-replacement.spec.ts`, scenario 4 |

### The seven readings this increment had to settle

| # | Question | The answer |
|---|---|---|
| A | **Keep `announcement_created` beside the pointer, or drop it?** | **Drop it.** Two stores of one fact, and the boolean is the one that needs a second write guard to be trustworthy. See above. |
| B | **What does the foreign key do on delete?** | **`restrict`.** `set null` would leave `source = 'opening_hours'` with no owner, which the CHECK refuses anyway — so the DELETE would fail either way, with a constraint violation instead of a foreign-key one. `cascade` is not a candidate: removing the announcement row would break `announcement_singleton_unique`. The database's answer to "delete an override that owns the live message" is **no**, and `remove_opening_hours_override()` turns that into `owns_announcement`, a status a screen can word. |
| C | **Does `replace_announcement()` change signature, or does the coordinator write ownership separately?** | **It changes signature**, by one appended parameter defaulted to `null`. A second UPDATE in the same transaction cannot work: `announcement_source_owner_check` is a CHECK, PostgreSQL has no deferrable CHECK, and the row would be invalid at the end of the first statement. Appending is also what keeps the composition honest — the function that writes `source` writes the owner, in the same `update`, so §8 of the brief's *"do not allow: announcement B is live but override A still says it owns it"* is unreachable rather than merely tested. The default is the **safe** half: a caller that says nothing is saying "manual", and with `'opening_hours'` the omission is `invalid_payload` rather than an unowned generated announcement. |
| D | **Where does §7e item 8's ordering become structural?** | **In the absence of a statement.** `apply_generated_announcement()` issues nothing against `public.opening_hours` or `public.opening_hours_overrides`, and neither does `lib/announcements/generated-operation.ts` — asserted over the module's own source, as §0k asserts the draft boundary. So "there is no code path where Behold eksisterende rolls back the hours" is a property of the text. The coordinator also **refuses an override that is not published** (`invalid_payload`, reason `source_override`), which is the same rule read from the other end: an announcement describing hours that are not on the hjemmeside is the one outcome the item exists to prevent. |
| E | **Two different things are called "conflict". Which keeps the word?** | **1ae's.** §7e item 8 states `{status:'conflict'}` for *an active announcement is in the way*, so that is what `conflict` means at every layer. Optimistic concurrency (§6) — the thing every other operation in this repository calls `conflict` — becomes `stale_announcement` and `stale_override` here, two words rather than one because there are two version tokens: the announcement's, and the override's. The second is not decoration: the Server Action read that override in order to generate the message, and if somebody has changed it since, the words no longer describe anything. |
| F | **What may the browser send?** | **Four values and one string.** An override id, that override's version token, the announcement's version token, and the confirmation bit — plus the message, because 1t draws the suggestion as an editable field. Everything else is **reconstructed on every call**, including the confirmed second one, from the *published* override row and the *published* weekly schedule, through the 8C-2 generator. `withEditedMessage()` is the whole of what an edited message can reach, and it is a pure function so that "the message may be edited and nothing else may" is a property of the type. The source is not a parameter of the coordinator at all. |
| G | **A jsonb snapshot can outlive the row it names. What then?** | **`owner_missing`, named rather than raised.** The foreign key does not reach inside `previous`, so an override that owned the *displaced* announcement — and therefore owns nothing the key protects — could be deleted, leaving a snapshot pointing at nothing; the restore would then raise `23503` and roll back with nothing for a person to read. `remove_opening_hours_override()` refuses that deletion too, so the status is reachable only through a direct PostgREST DELETE — and it is stated anyway, because a case that is only impossible while every caller behaves is not impossible. |

### Recorded explicitly, because each of these is a rule somebody could later assume away

- **`announcement_created` is not "ever generated" and never was.** It is **gone**. If a
  later reader looks for it, §7e item 6's question is `announcement.source_override_id`,
  and the audit log is the history — as it has been for every other operation here.
- **Ownership never moves outside a lifecycle statement.** `replace_announcement()`
  writes it in the same `update` as the content, the source, the snapshot and
  `replaced_at`; `restore_announcement()` writes it back in the same `update` as the
  eight keys beside it. There is no second UPDATE, no second transaction, and no
  bookkeeping step that could fail after the content moved.
- **A conflict writes nothing and logs nothing.** Not the announcement, not the audit
  log, not a cache tag, and — the half §7e item 8 is about — not the hours. Asserted by
  comparing the whole row before and after three refused attempts.
- **The cache is expired only after a result that reached the row.** The domain module
  returns the tags and expires none; the Server Action expires them after the commit.
  `applied` expires; `conflict`, `no_effect`, `expired`, `not_published`, both stale
  statuses and every refusal expire nothing.
- **Everything stayed SECURITY INVOKER**, with `search_path` pinned to nothing. The
  count of SECURITY DEFINER functions in this repository is unchanged, and `017` asserts
  it. RLS still decides the row, `requireStaff()` still decides the request.
- **`source_override_id` is a trusted lifecycle field**, in §0l's sense and for §0l's
  reason: `restore_announcement()` believes it, and §7e item 6 will take a live message
  down on the strength of it. Staff and Owner are both refused a direct write of it,
  alone and paired with `source`, from real JWTs.
- **A guest cannot read it.** It is not in `anon`'s column grant, and `017` asks for it
  from a real anonymous JWT and gets `42501`.
- **No workflow engine.** One function for one operation, taking no table name, no
  column name, no step list and no callback — the same rule §0e answer A records for the
  three sold-out functions.
- **The pure generator stayed pure**, and stayed id-free. It is given an
  `OverrideContent`, which may be a *draft's* content and may therefore belong to no row
  at all, so it cannot be made to know an owner without losing its ability to answer
  1t's *"what would this change say?"* while somebody is still typing. The coordinator
  adds ownership on the way past; `GeneratedAnnouncement` is assignable to
  `AnnouncementReplacement` minus that one field.
- **Three boundary suites were narrowed rather than deleted**, as §0m's were:
  `tests/unit/hours/override-source.test.ts` now says the generator has *exactly one*
  caller and no screen is it, and that `announcement_created` appears in no application
  file at all; `tests/unit/announcements/replacement-boundary.test.ts` swaps the dropped
  column for the ownership pointer in its list of things the opening-hours screen may
  not name; `supabase/tests/014` now says exactly one opening-hours function names the
  announcement table — the removal, to refuse itself — and that none of them writes to
  it.

### What phase 8C-3A deliberately does not contain

| | Owner |
|---|---|
| 1t's **"Vis også som besked øverst på hjemmesiden"**, the editable suggestion beneath it and the generated expiry field | **8C-3B** |
| **Conflict sheet 1ae**, "Erstat med den nye besked", "Behold eksisterende besked", the focus trap and the green Fortryd strip | **8C-3B** |
| **§7e item 6's consequence** — asking, and removing the announcement when its override is deleted | **8C-3B.** The model answers the question; nothing acts on the answer yet, and `remove_opening_hours_override()` refuses rather than deciding. |
| **The deletion of the 8C-1 harness** | **8C-3B.** It gained a third action here rather than a sibling directory, because the brief forbids inventing a second harness and `updateTag()` is still only reachable from a Server Action. |
| **A second undo level, an archive, or a history of ownership** | **never** (§4, 1ad). One snapshot, one level; `audit_log` carries the ownership in its before/after pair, and that is the history. |

**Phase 8C-3A is complete and green.** Everything in the table above was built by
**8C-3B**, recorded in §0o below.

---

## §0o — Phase 8C-3B: the generated opening-hours announcement workflow

*Design 1t, 1ae, 1aa; §4, §5, §6, §7e items 6 and 8, §8, §9.*

The phase that makes the opening-hours announcement usable from the real admin screen, and
the last implementation increment of phase 8. It adds **no package** (see
`docs/dependencies.md`).

### The ordering rule, kept structurally

§7e item 8 is the spine of this increment: *"the hours override is written first and always;
the announcement is only attempted afterwards … There is no code path where a 'Behold
eksisterende' choice can roll back the hours."*

`app/(admin)/admin/aabningstider/override-publish-actions.ts` is that sentence as a sequence:

  1. `publishPendingChange()` publishes the override;
  2. `expirePublicCacheTags()` expires the `hours` tag, so the **first** guest request after
     the press already has the new times;
  3. only then does `announceOverride()` call `applyGeneratedAnnouncement()`.

Steps 1 and 2 are committed and the public cache is already told before step 3 begins, and
step 3's coordinator issues no statement against `public.opening_hours` or
`public.opening_hours_overrides` in any branch. So the separation is a property of the
functions' text, not of a reviewer's attention: a conflict, a "Behold eksisterende", a
refused wording and an outright failure each add a **second** code to the address beside the
hours' own (`./announcement-routes.ts` takes the two separately) and none of them can reach
what step 1 wrote.

### What the browser may say, and what the server re-derives

| The browser sends | The server derives, on every call |
|---|---|
| whether the person ticked 1t's box | the message's **expiry** — the later of the normal and special closings |
| the **wording** they approved | the **link** — `/find-os` + "Se tider" for changed hours, none for a closed day |
| the announcement's version token (§6) | `source = 'opening_hours'` |
| the override's id and version token (§6) | `source_override_id` — the published override that owns it |
| 1ae's one confirmation bit | `previous`, `replaced_at` — the displaced snapshot and its stamp |

`withEditedMessage()` is the whole of the permission in the left column's second row: it
validates the wording against 1ac's rules and can assign to `message` and nothing else.
Both the first attempt and the confirmed second one re-read the published override and the
published recurring week and re-ask the generator, so a form that sat open while somebody
edited the hours cannot publish a stale sentence — and if the hours did move,
`stale_override` says so.

### The suggestion that follows the fields, and then stops

1t promises: *"Skrevet ud fra dato og tider ovenfor. Retter du tiderne, opdateres forslaget —
indtil du selv har rettet i teksten."* That is browser state by definition, and it is the one
place this administration spends JavaScript (§7e item 11 allows it).

`lib/announcements/generated-suggestion.ts` is a **pure** module that answers *"what would
this card say?"*, and the **server** and the **browser** both run it — the server for the
first paint, the browser on every change to the date, the kind or the two times. One
implementation, so the two cannot drift by a comma.

`GeneratedAnnouncementField` holds three values: the tick, the message, and whether a person
has edited it. **The dirty flag is UI state and never authority** — it decides only whether
a time change overwrites the field, is not submitted, and no server decision consults it.

One implementation detail is load-bearing enough to record: the form-level listener
**ignores events from the message field itself**. A controlled input and a native listener on
an ancestor hear the same bubbling `input` event, the native one first — so a version that
recomputed on every event would write the suggestion back, reset React's value tracker, and
suppress the `onChange` that would have set the dirty flag. The typed character would vanish
and the field would look uneditable while appearing to work.

### 1ae, and why `Esc` resolves nothing

The sheet is `components/admin/menu/ModalDialog.tsx` — the native `<dialog>` opened with
`showModal()` the administration has used since phase 5D — with **one new prop**, `locked`.
Backdrop clicks, the focus trap and the inert background are the platform's, not a script's.

`locked` suppresses `Esc`. 1ae is a *decision*, not a confirmation: "Behold eksisterende
besked" drops the new message and "Erstat med den nye besked" publishes it, and mapping `Esc`
to either would put a choice in somebody's mouth. There are always two labelled ways out, and
focus starts on the one that changes nothing a guest can read.

**Giving focus back needed a second mechanism, and the reason is worth recording.** Phase 5D's
confirmation pays that debt through the address: its cancel control is a plain `<a>`, so
closing it is a *full* navigation to the fragment of the control it was opened from, and a
browser focuses a focusable fragment target on arrival. Neither of 1ae's exits can do that —
one is a `<Link>` and the other is a Server Action, and both produce **soft** navigations that
move the URL without moving the keyboard. A fragment would have looked right and done nothing.
So `ModalDialog` gained `returnFocusTo`: the id of the control the sheet was opened from,
focused as the dialog unmounts, whichever way out was taken. It is asserted in
`tests/e2e/opening-hours-announcement.spec.ts` rather than assumed.

**"Behold eksisterende besked" is a link.** It reaches no Server Action, so the branch that
keeps the existing message cannot write anything — not by design that could drift, but
because there is nothing there to call. The screen then says 1ae's own promised sentence:
*"Åbningstiderne er gemt. Beskeden blev ikke oprettet."*

### §7e item 6, and the door it closes

Deleting a one-off change now asks about the generated announcement it owns and, when
confirmed, takes both away in **one transaction** —
`remove_opening_hours_override(id, version, remove_announcement)`. Ownership is
`isOwnedByOverride()`: an id compared to an id, never the message's wording.

"Removing the announcement" is a transition to the **empty state**
(`announcement_replacement_kind()` already called it `'none'`): the message, its link and its
expiry are cleared, `is_visible` goes false, `source` returns to `'manual'` and
`source_override_id` to null — so nothing is left that could be toggled back on as a message
about hours that no longer exist. `previous` and `replaced_at` go with it, because the same
statement moves `updated_at` and any Fortryd still on offer is already bound to a token that
no longer matches. **`draft` is not named**, so a pending manual announcement survives.

An override named only inside `previous.source_override_id` is handled explicitly (the case
8C-3A recorded as producing `owner_missing`): the trusted removal discards that obsolete
snapshot in the same transaction, leaves the current announcement alone, deletes the override
and audits both. A Fortryd already on screen then fails as a conflict, which is correct —
somebody explicitly deleted the thing it would restore. No history table, no text parsing.

### The direct-DELETE hole, closed

8C-3A's `restore_announcement()` recorded `owner_missing` as *"reachable only through a direct
PostgREST DELETE"*. That was the hole, and this phase closes it.

`authenticated` **keeps** its DELETE privilege on `public.opening_hours_overrides`, because a
SECURITY INVOKER function spends the caller's privileges — revoking it, measured from a real
Staff JWT, refuses the attack and the trusted removal equally. **No SECURITY DEFINER was
added**; §8 forbids it and so does the brief. Instead the *transition* is constrained, by the
same mechanism `20260831160000` used for the announcement's own columns: a BEFORE DELETE
guard trigger recognising a transaction-local marker that only
`remove_opening_hours_override()` sets. One pattern in this repository for *"a privilege that
may only be spent by a named transition"*, not two.

`supabase/tests/018_override_removal.test.sql` proves it from real Staff **and** Owner JWTs,
including that a statement-wide `DELETE` with no `where` is refused per row and that the
marker cannot be held open for a later statement.

### The harness is gone

`app/(admin)/admin/intern/` is deleted, with the `ANNOUNCEMENT_REPLACEMENT_HARNESS` flag and
the `playwright.config.ts` line that set it. Its scenarios were not deleted with it —
`tests/e2e/opening-hours-announcement.spec.ts` drives replacement, restore, ownership and the
first-guest-request promise through `/admin/aabningstider`, at 375 and 1440.

### Two §25 cases assert one layer down — a substitution, not a gap

§25 lists *"stale announcement while conflict sheet open"* and *"stale override while
conflict sheet open"* among the E2E cases. Both are covered, and **neither is a browser
scenario**. The reasoning is worth recording, because "we moved a test" and "we dropped a
test" look identical in a diff.

They are **concurrency and atomicity guarantees**, and a rendered page is the weakest place
to assert one. A screen can show that a refusal appeared; what actually matters is what the
database *did not do*. `supabase/tests/017_generated_announcement.test.sql` asserts both
from real Staff JWTs, and asserts four properties no browser assertion could reach:

  * the operation answers `stale_announcement` / `stale_override`;
  * the **whole affected row** is byte-identical afterwards;
  * **no audit row** was written — a refusal is not an event;
  * **no partial ownership mutation** — `source` and `source_override_id` never move apart.

The other half of the behaviour — that each status reaches a person as the right sentence,
in the right tone, at an address that has *not* lost what happened to the opening hours, and
with no `konflikt` and no `fortryd` on it — is pure, and is asserted deterministically in
`tests/unit/announcements/generated-suggestion.test.ts`.

The E2E versions existed briefly and were removed after they argued against themselves.
Driving two browser contexts at one announcement singleton, the second session's write
repeatedly landed **before** the conflict sheet existed; the coordinator then correctly saw
no conflict and applied the message — a different and equally valid branch, asserted as
though it were the stale one. A test that can silently exercise the wrong branch is worse
than no test, and the branch it was meant to cover is covered more strongly one layer down.

The browser suite keeps what only a browser can prove: that the hours are public before the
question is asked, that 1ae appears for an active message and not for a hidden or expired
one, that both of its branches do what they say, that Fortryd restores, that ownership
follows the override through A → B → Fortryd, and that removing an override takes its
message with it.

### What phase 8C-3B deliberately does not contain

| | Why |
|---|---|
| A branch that **keeps** an `opening_hours` announcement after deleting its override | It would leave guests reading about opening times that no longer exist. The source of truth asks for no detach-to-manual feature, and none was invented. |
| A **second entry point** to the generated announcement, for an override that is already published with nothing pending | The message rides on a publish (§7e item 8's ordering). Adding one would be a second path to the same write, and a product decision nobody has made. Recorded as a known limitation. |
| A **second undo level**, an archive, or a history of ownership | Never (§4, 1ad). One snapshot, one level; `audit_log` carries the ownership in its before/after pair. |
| A **database draft** for previewing the proposed announcement | §8 of the brief forbids it. The suggestion is already visible and editable in the card, and the preview contract that matters — pending hours visible in Draft Mode, guests unchanged — is phase 8B's and is untouched. |
| A generic workflow engine, a modal library, a form-state library | See `docs/dependencies.md`. |

**Phase 8C-3B is complete and green.** The completion/lock pass it called for was run on
2026-08-31 and is recorded in §0p, which closed the phase.

---

## §0p. Phase 8 — complete and locked (2026-08-31)

Phase 8 (Opening hours administration, §15) was built in seven increments — **8A** the
recurring week (§0i), **8B** one-off overrides (§0j), **8C-1** the replacement/restore
mechanism (§0k) and its lifecycle-column hardening (§0l), **8C-2** the pure generator
(§0m), **8C-3A** ownership and coordination (§0n), and **8C-3B** the workflow (§0o) — and
closed by a completion pass on 2026-08-31. The seven records above stay exactly as
written: each is the account of what its increment decided and why, and several contain
statements that were true when written and were later superseded — every such statement
is already marked in place. **This section is the statement of the CURRENT truth**, so a
later reader does not have to replay seven increments to know what stands.

### What "phase 8" is, in force today

| Rule | Where it is enforced |
|---|---|
| **The recurring weekly schedule is Owner-only.** The weekly card renders only for an owner; a staff member sees a statement in its place. Absence is not the enforcement: `requireOwner()` first in both weekly Server Actions, `mayChangeEntity` inside the machinery, and `opening_hours_update_owner` — still the table's only UPDATE policy — refuse a staff write three times over, asserted from a real Staff JWT. | `app/(admin)/admin/aabningstider/{save,publish}-actions.ts`, `supabase/tests/013` |
| **One-off overrides are Staff and Owner**, per §5, drawn per card on one screen. | `page.tsx`, `overrides_{insert,update,delete}_staff`, `supabase/tests/014` |
| **An override is pending through `status='draft'` when it has never been live, and through its `draft` column when it has** — §0j's four-state model, unchanged. An edit taken back to the published values clears the draft. | `lib/hours/override-admin.ts`, `20260831120000` |
| **The generated announcement is an option on the one-off card's own publish** — 1t's checkbox, ticked by default, with the editable suggestion beneath it. The suggestion follows the date and times until the person edits the text; the dirty flag is browser state and no server decision consults it. A publish from the pending band, or with the box cleared, publishes the hours and touches no announcement. | `GeneratedAnnouncementField`, `lib/announcements/generated-suggestion.ts` |
| **The expiry is the LATER of the normal closing and the special one** (§0m's corrected rule): a normally-closed day opened specially expires at the special close; a closed day expires at the normal close; a change that changes nothing is `no_effect` and produces no message. Nothing is ever moved forward to make a suggestion publishable. | `lib/announcements/generated.ts` |
| **The browser may say the wording and nothing else.** Five values travel: the tick, the message, the announcement's version token, the override's id and version token, and 1ae's one confirmation bit. The expiry, the link, `source` and `source_override_id` are re-derived on the server from the published rows on every call — the confirmed second one included. | `override-forms.ts`, `apply_generated_announcement()`, `supabase/tests/017` |
| **The hours are published first and always.** The override is published and its cache tag expired before the announcement is attempted, and the coordinator issues no statement against either hours table in any branch — so no conflict, Behold, refusal or failure can roll the hours back. Structural, and asserted at source level as well as end to end. | `override-publish-actions.ts`, `lib/announcements/generated-operation.ts`, `tests/unit/announcements/generated-operation.test.ts` |
| **Only an ACTIVE announcement is a conflict.** Hidden, expired and empty are replaced without a question; 1ae is shown for the one case a guest could read. `Esc` resolves nothing, the backdrop is inert, and focus starts on the choice that changes nothing. | `announcement_replacement_kind()`, `AnnouncementConflictSheet` |
| **"Behold eksisterende besked" is a link and writes nothing** — the hours stay published, the current message stays byte-identical, the checkbox comes back cleared, and the screen says 1ae's own sentence. | `announcement-actions.ts` (it appears in no action file) |
| **Replacement stashes exactly one level in `previous`** (nine keys, ownership included) **and the ~10 s Fortryd restores it atomically** — content, visibility, source and owning override in one UPDATE, with nothing extended to make an expired message look current. | `replace_announcement()`, `restore_announcement()`, `supabase/tests/015`–`017` |
| **Ownership is `announcement.source_override_id` and nothing else** — one pointer, paired with `source` in both directions by a CHECK, moved only inside lifecycle statements, never derived from the message's wording. **`announcement_created` is dropped and stays dropped.** | `20260831180000`, `lib/announcements/ownership.ts` |
| **Direct writes cannot forge the lifecycle.** A Staff or Owner session's direct UPDATE owns `draft` and nothing else on `public.announcement`; the published columns, visibility, source, ownership, `previous` and `replaced_at` move only under the named transitions (`publish`, `visibility`, `replace`, `restore`, `detach`, `discard_previous`), each marker single-use. A direct DELETE on `opening_hours_overrides` is refused by the BEFORE DELETE guard; `remove_opening_hours_override()` is the one door. **No SECURITY DEFINER anywhere.** | `20260831160000`, `20260831200000`, `supabase/tests/016`, `018` |
| **Removal is one decision table.** A pending-only override deletes silently; a live override with a pending edit loses only the edit; a live override asks first; one that owns the generated announcement asks about both and takes both away in one transaction; one named only by an obsolete `previous` snapshot is deleted and the stash discarded, with the current message untouched. Displaced announcements are never resurrected by a removal — the ~10 s Fortryd after a replacement is the only restoration mechanism. | `describeOverrideRemoval()`, `remove_opening_hours_override()` |
| **The first guest request after a committed write reflects it.** Cache tags are expired only after a commit, only for what actually changed, and `expireTime` keeps every public page inside the five-minute contract. | `tests/e2e/public-cache.spec.ts`, `tests/e2e/opening-hours-announcement.spec.ts` |
| **The 8C-1 harness is gone.** `app/(admin)/admin/intern/` does not exist, no flag references it, and the boundary suite asserts the absence. | `tests/unit/announcements/generated-boundary.test.ts` |

### What the completion pass changed

The product itself needed **no behavioural fix**: the Owner, Staff and guest walkthroughs
against a production build, the frame-1t/1ae audit at 375/768/1440, and the keyboard and
axe passes all came back clean. What moved:

- **Three streamed-shell `count()` barriers in tests.** The React 19 race the announcement
  suite was cured of (a `count()` asked right after `goto` answers 0 about a page that
  carries the element) had three remaining exposed sites: `visit()` in
  `tests/e2e/menu-delete.spec.ts` and the Find-os disclosure check in
  `tests/e2e/public-site.spec.ts` now wait for the public shell; the suggestion-chip count
  in `tests/a11y/announcement-admin.spec.ts` now waits for the first chip. The
  `monthly-admin.ts` and `weekly-admin.ts` helpers named by the earlier report were
  already swept. `hours-override.ts`'s three remaining `count()` calls run behind
  `openOverrideCard`'s auto-waiting form assertion on the same streamed document, or on a
  page already interacted with, and are not exposed.
- **Five stale phase-pointer comments corrected** — files whose headers still described
  8C as future (`override-forms.ts`, `forms.ts`, `publish-actions.ts`,
  `WeeklyHoursEditor.tsx`, `lib/hours/override-admin.ts`) now describe what shipped.
- **The `too_long` refusal sentence now interpolates `ANNOUNCEMENT_MESSAGE_MAX_LENGTH`**
  instead of hard-coding "90" (`generated-operation.ts`), so the constant cannot drift
  from the sentence about it.
- **One dead helper removed** — `describeWeekday` in `lib/hours/weekly-form.ts`, exported
  and referenced by nothing.
- **One Tuesday-blind assertion in the override suite corrected.** The §7b wiring test in
  `tests/e2e/opening-hours-override.spec.ts` proved "closing the reset day moved the
  answer" by comparing the rendered sentence's weekday and time — and the sentence carries
  no date, so on a Tuesday, where closing every open day up to the next normally-closed
  one moves the reset exactly one week to the *same weekday at the same time*, the
  movement was invisible and the test failed. The suite had simply never run on a Tuesday
  before. The movement claim is now asked of the engine's **dates**, and the screen
  comparisons carry the weekday word as well as the time, so the agreement the loop
  asserts is no longer time-only. The product's behaviour was correct throughout — every
  screen-versus-engine step in the same test passed on the day that exposed it.

### Two states of the code, recorded rather than tidied

- **`replaceAnnouncement()` in `lib/announcements/replacement.ts` has no production
  caller.** The shipped path calls `apply_generated_announcement()`, which reuses
  `replace_announcement()` inside the database. The TypeScript wrapper is kept: it is the
  tested statement of that RPC's contract, its types are what hold the 8C-2 generator's
  output to the replacement shape, and `restoreAnnouncement()` beside it is live (the
  Fortryd). Its comment now says so. Deleting it would mean deleting the 8C-1 mapping
  suite to remove a function that costs nothing and guards a contract.
- **A manual publish over a generated announcement keeps the ownership.** Somebody who
  edits the live generated message at `/admin/besked` and publishes changes the wording;
  `source` and `source_override_id` stay, because `publish_announcement()`'s transition
  may not move them and ownership moves only inside replace/restore/detach. That is the
  model's own reading — the pointer, never the text, is the fact — and it is safe: the
  consequence is that deleting the override still offers to take the (edited) message
  down, behind the same confirmation. It is recorded here so it is a decision, not a
  surprise.

### The final regression

From a clean tree, `npm ci`, `npm run db:reset:full` and a fresh production build:
typecheck, lint and the source policy clean; **1892 unit tests in 59 files**; **1184
pgTAP assertions in 18 files**, from real anonymous, Staff and Owner JWTs; **899
Playwright tests collected in 23 files across 42 project-spec registrations — 892 passed
and 7 deliberately skipped (width/device guards), zero failed and zero flaky**, run with
`--retries=0` — the generated-announcement suite collected by exactly its two dedicated
projects and no others; `npm audit --audit-level=high` clean. The walkthroughs and the
regression together re-verified phases 5, 6 and 7 behind phase 8: dishes, sold-out,
delete/restore, reorder and Tapas; the weekly special, Saturday menu and monthly burger;
manual announcement editing, expiry, visibility and undo; the public-cache contract; zero
public cookies; and no browser Supabase client.

**Phase 8 is complete and locked.** What §15 lists from phase 9 onward is untouched: no
news administration *(phase 9A has since built its core — see §0q)*, no Om os/Forside
editors beyond phase 4's, no image pipeline, and the menu-category content editor still
has no phase (§0b).

---

## §0q. Phase 9A — the news administration's core (2026-09-01)

`/admin/nyheder` exists: the article list (frame 1z), the editor (frame 1s), creation,
editing, per-item Offentliggør behind 1s's confirmation, §7f's "Fjern fra hjemmesiden",
and Slet under the 1r rule ("Slet spørger altid"). Staff **and** Owner, per §5's row —
never Owner-only. Phase 9 is **not** locked: 9B remains, and its scope is listed at the
end of this section.

*A note on frame numbering, recorded so nobody hunts for it later: the phase-9A brief
referred to the news frames as "1u and 1v"; in the design file those ids are Rediger
forsiden and Kontaktoplysninger (phase 11). The news administration's approved frames
are **1s** ("Nyhed-editor — desktop") and **1z** ("Nyheder + editor — mobil"), and they
are what 9A was built and verified against.*

### The persistence model, confirmed and stated once

News keeps the model §4 gave it, and it is **not** the generic draft model:

| Fact | Where it is enforced |
|---|---|
| **No `draft` column.** An article is pending while `status = 'draft'`; `pending_changes` lists it as `unpublished`; publishing flips the status. `saveEntityDraft` is never involved — `tests/unit/news/admin-mapping.test.ts` asserts the boundary over the module's own source. | `lib/news/admin.ts`, §4 |
| **An edit writes the row itself.** For a draft, that changes nothing public. **For a published article, the save is on the hjemmesiden the moment the `news` tag expires** — there is no draft layer, the editor says so beside Gem (`describeSaveConsequence`), the save action expires the tag only after the write reported success, and the previous words go into an `update` audit row, which is their only surviving copy (§4's recovery story). | `saveNewsArticle()`, `save-actions.ts`, `019` |
| **Two states, no third.** `draft` = not public (a guest can neither list it nor open its address — `news_select_public`, and `status` is not even in `anon`'s column grant); `published` = public. `published_at` is memory, not state: it survives an unpublish so the slug stays frozen and a republish keeps the original date. | `unpublish_news()`, `019` |
| **Optimistic concurrency is the UPDATE's own WHERE.** A stale token writes zero rows; zero rows is told apart honestly (row still there → `conflict`, gone → `not_found`); a conflict echoes what was typed back into the form over the *new* version token, so nothing is lost and nothing is silently overwritten. | `saveNewsArticle()`, E2E "a stale save is refused" |

### The slug policy — §7f, implemented exactly

Generated from the title (æ→ae, ø→oe, å→aa; other accents fold to their base letter, so
"café" is not misspelled "caf"; everything else becomes single hyphens), collision-suffixed
`-2`, `-3`, …, **never typed** — there is no slug field anywhere, and the editor shows the
resulting address under the title with a sentence saying whether it still follows the
title (unpublished) or is locked (published). Frozen at first publish by the phase-1
trigger, which `019` proves from real JWTs — including that it stays frozen *while
unpublished*, so a republished article answers at the same address. There is no redirect
machinery, because a frozen slug never needs one. The rules live in `lib/news/slug.ts`,
pure and unit-pinned; the database UNIQUE stays the final gate and a lost race is a
Danish sentence (`adresse_optaget`), not a stack trace.

### One migration, and what it does not contain

`20260901120000_news_admin.sql` adds `unpublish_news()` (status back to `'draft'`,
`published_at` kept, audited, version-checked) and `delete_news()` (a hard delete — news
has no soft-delete columns and §0a D2's "never purged" was decided for dishes — with the
**whole article** in the audit row, which after the commit is the only place the words
exist). Both SECURITY INVOKER with `set search_path = ''`, granted to `authenticated` and
revoked from `anon`. It contains **no** table, column, view, index, policy, table grant,
trigger or SECURITY DEFINER function — and no transition-marker machinery: phase 8's
write guard exists because `announcement.previous` is a snapshot one trusted function
writes and another believes, and news has no such column, so a direct staff UPDATE can
forge nothing the model does not already allow. That direct-write path **is** the
accepted News architecture, not a bypass (the §19 question, answered).

### Scope decisions this phase had to make, and why

- **Unpublish and delete are in 9A**, though the brief's minimum was "status handling,
  publish". Both are §5's own row ("write … unpublish") and frame 1s's own controls
  ("Fjern fra hjemmesiden", "Slet"); without delete the E2E suite could not restore
  state through the real administration, and without unpublish a published article could
  not be taken down at all.
- **The body editor is one `<textarea>`** — blank line = new paragraph, mapped to the
  structured JSON §4 requires (`lib/news/body.ts`), no HTML anywhere. The **B/Link
  toolbar is 9B**: it is a client component, no stored row carries a mark yet (the seed
  and this editor both write plain paragraphs), and `bodyToEditorText` reports
  `hasMarks` so a future flattening save is a checkable fact. The editor's helper line
  states the 9A format rather than promising marks the field cannot make.
- **Autosave is 9B**, with the same client component; 9A has an explicit Gem, which the
  frame does not draw and which is recorded here as the deliberate interim departure.
- **Creation offers no publish/preview footer** — a row that does not exist yet cannot
  be published or previewed; both appear after the first Gem.
- **The category chips gained "Ingen kategori"**: the field is optional in the frame
  ("valgfrit") and in the schema, and a radio group without an off-chip could never be
  cleared without JavaScript. The five categories are 1s's own, as a closed set in
  `lib/schemas/news.ts`.
- **Preview** uses the slug-carrying target `lib/drafts/targets.ts` reserved for this
  phase: `maal=nyhed&slug=…` accepts only the slug grammar (which cannot spell a path or
  an origin) and requires the article to exist through the caller's own JWT, then opens
  the real `/nyheder/[slug]` in Draft Mode — §6's promise for an unpublished article,
  proven end to end.
- **The image slot** renders the approved dashed frame stating that images come in a
  later phase — no file input, no fake upload, and `image_id` is never read, echoed or
  written (`019` proves it survives both transitions).

### The cache contract (§20)

Publish, unpublish, published-edit and published-delete each expire the `news` tag —
only after their transaction reported success, and through the publishing registry so
the tag cannot drift. A draft save, a draft delete and a creation expire nothing. The
first-guest-request promise is asserted for publish, published-edit and unpublish in
`tests/e2e/news-admin.spec.ts`, in fresh cookie-free contexts.

### The regression

From the state above: typecheck, lint and the source policy clean; **2021 unit tests in
65 files** (+129 in 6 for news); **1256 pgTAP assertions in 19 files** (+72 in `019`,
from real anonymous, Staff and Owner JWTs); the two dedicated Playwright projects
(`news-admin-mobile`, `news-admin`) green at 375 and 1440 with `--retries=0`, the news
a11y suite green under both generic projects, and `npx playwright test --list` confirming
the write spec is collected by exactly its two projects — the §22 check.

### What phase 9B is

The B/Link body toolbar (the one client component this area will have), autosave with
1s's "Gemt for lidt siden", the `NewsArticle` JSON-LD block (§7f, §11) and its Rich
Results verification, and — if review wants it — a per-article preview link on the list.
Images stay phase 10. *(Built 2026-09-01 — §0r is the record of what phase 9B contains;
the external Rich Results verification moved to the final SEO/hardening phase, and the
per-article list preview link was not asked for and was not added.)*

---

## §0r. Phase 9B — the structured editor, autosave, and the article's public claims (2026-09-01)

Phase 9's remaining functionality is built: frame 1s/1z's **B/Link body editor**, the
**autosave** the frames caption ("Gemt for lidt siden", "Gemmer selv som kladde, mens
der skrives"), the **`NewsArticle` JSON-LD**, §7f's **canonical and article metadata**,
**sitemap membership**, and the verification of the Forside teaser phase 3 built.
**Phase 9 is not locked** — the lock pass (the full-suite completion regression over 9A
and 9B together, frame-fidelity sign-off and the lock statement) is still owed.

### The body model — one format, stated exactly

`news.body` is unchanged: `{ blocks: [{ type: 'paragraph', spans: [{ text, bold?,
href? }] }] }` — paragraph nodes of text runs, where a run may carry `bold: true`
and/or an absolute-`https:` `href`, and nothing else. The editor edits *this* shape;
there is no second format, no HTML anywhere in the pipeline in either direction, and
`NewsBody.tsx` remains the public renderer with no `dangerouslySetInnerHTML` (§8).

The editor is three modules with one direction of dependency:

  * **`lib/news/editor-model.ts`** — every rule, pure. A selection is a block index and
    a character offset; `toggleBold` (all-bold turns off, anything else turns on),
    `setLink`/`clearLink` (independent of bold), `linkExtentAt` (a caret inside a link
    means *that* link), `normalizeBody` (operations round-trip to the canonical stored
    document) and `tidyBodyForSave` (blank line splits a paragraph, a lone line break
    becomes a space, edges trim, empty paragraphs disappear — the textarea dialect's
    rules restated for a document with marks). An empty or stale selection is clamped
    into a no-op, never a corrupt body.
  * **`components/admin/news/body-editor-dom.ts`** — the DOM translation, no React and
    no decisions: the model rendered as `<p>`/`<span data-bold data-href>` (a link is
    deliberately not an `<a>` while being edited), the DOM *walked* back into typed
    spans (pasted markup contributes characters only), and the browser Selection mapped
    to model offsets and back through the same walk.
  * **`components/admin/news/NewsBodyField.tsx`** — the wiring: the toolbar (44 px
    controls, `aria-pressed` on B, accessible names), the labelled `role="textbox"`
    editing surface, the link panel (prefilled for an existing link, offers Fjern,
    refuses anything that is not absolute `https:`), Ctrl+B routed through the same
    toggle, every other `format*` input cancelled (no italic, no underline), paste
    forced to plain text, drop refused.

The stored document travels in a hidden field, `tekst_struktur`, as JSON — re-parsed
server-side against `newsBodySchema` by `bodyFromStructuredJson` (`lib/news/body.ts`),
so a malformed document, an unknown key, or a `javascript:`/`data:`/`http:` link is a
refusal (`tekst:ugyldig`), never a repair. When `tekst_struktur` speaks it wins over
the plain `tekst` field; refusal and conflict echoes carry it too, so marks survive
every round trip.

### The no-JavaScript fallback — and the `hasMarks` guard, load-bearing

The public pages never needed JavaScript and still do not. In the editor:

  * a body **without marks** falls back to the 9A textarea — plain paragraphs in, plain
    paragraphs out, nothing to lose (text typed into it before scripting enhances the
    field is adopted by the editor at the swap, not discarded);
  * a body **with marks** is never offered as plain text: the field renders the body
    read-only with a sentence saying it needs JavaScript to edit, and the original
    structured document rides in the hidden field — so Gem still saves the title, date
    and category while the text is returned byte for byte. 9A's `bodyToEditorText`
    `hasMarks` flag is the switch, which is the protection it was reserved for.

### Autosave — a pure machine, and the same save as Gem

`lib/news/autosave.ts` owns the behaviour as a reducer the unit suite pins: a
2-second debounce restarted by typing; **one save in flight**; a timer firing on
unchanged content saves nothing (so a draft-only pause never writes a row and a
published pause never expires a cache for nothing); edits made during a save mark the
run and the *response* schedules the next attempt, so an older response can version
the next save but can never overwrite newer edits — it never carries content into the
form at all. `components/admin/news/NewsAutosave.tsx` runs the machine from the
burgundy bar (where 1s draws the words), finds the form by id, and keeps the hidden
id/version fields current so autosave, Gem and the confirmations always submit the
newest token (§6).

The write is `autosaveArticle` (`autosave-actions.ts`) — the one Server Action a
client calls programmatically, and deliberately the same path as Gem:
`toNewsArticleValues`, the §7f slug rules, `saveNewsArticle` with the version token
inside the UPDATE's own WHERE. **The Gem button stays** as the explicit fallback and
the whole of no-JS saving; it is not a second save system, because it is the same
system. A Gem pressed while an autosave is in flight waits for it and then submits
with the fresh token, so the two cannot race each other into a false conflict.

**Creation** (§17 of the phase brief): a brand-new article's first valid pause creates
the draft row once (`createNewsArticle`, born `status='draft'`); the response hands the
editor the id and version, the address adopts `?nyhed=<id>` via `replaceState`, and
every later autosave — and the Gem that may follow (`createArticle` delegates when the
hidden id is filled) — saves that row. No row per debounce; an abandoned near-empty
draft is an ordinary Kladde on the list, deletable through the ordinary Slet.

### The published article, said truthfully

News still has no draft column, so an autosaved edit to a **published** article is on
the hjemmesiden the moment it commits: the action expires the `news` tag — only after
success — and the status line says **“Gemt — ændringerne er på hjemmesiden”** rather
than 1s's draft wording. `describeSaveConsequence` now says both halves out loud:
changes save automatically, and saved changes are public immediately. A draft autosave
expires nothing. Both first-request promises are asserted in the E2E suite, in fresh
cookie-free contexts.

### Audit under autosave — inspected, kept, and why

Every published autosave goes through `saveNewsArticle`, so every content change a
guest could read gets the same `update` audit row an explicit Gem writes — the §4
recovery story holds under autosave, because to the model they are the same event.
Spam is bounded structurally: a save happens only after a typing pause **and** only
when content changed, so the audit reads as one row per settled thought, each with the
real before/after. The 9A two-statement pattern (UPDATE, then `log_audit`, audit
failure tolerated with a server log) is **kept**: an atomic RPC was weighed and
declined because autosave changes the *frequency* of the path, not its trust model —
news has no snapshot column a forged write could poison (§0q), the audit is a record
rather than an authority, and a database function would have widened the security
architecture for a failure mode (audit insert failing while the UPDATE commits) that
RLS grants make practically unreachable for the same caller. Stale writes cannot audit
falsely: a refused save writes zero rows and `log_audit` is never called.

**Conflict** is a stop, never a merge: the stale autosave is refused by the version
check, the bar says “Nogen andre har rettet denne nyhed” and that the local changes
are **not** saved, autosave stops, and the person's text stays on screen to keep or
copy — nothing replaces it with the database's version, no false “Gemt”, no false
audit row. A deleted-underneath article gets the same treatment (`vaek`). A failed
save or an incomplete form does not stop the machine; the next edit retries.

### The Forside teaser — verified, not rebuilt

Phase 3's implementation was already what §15 asks for: the Forside asks
`readPublishedNews(1)` — published rows only, newest by `display_date` then
`published_at` — takes the first answer or nothing, and renders nothing (no empty
card) when nothing is published. Nothing is hard-coded; publish, published-edit,
unpublish and delete all move it on the first request because they expire the same
`news` tag the read is cached under. 9B added the unit suite
(`tests/unit/home/news-teaser.test.tsx` — rendered markup plus source assertions) and
the E2E teaser assertions; it changed no Forside code.

### The article's public claims — JSON-LD, canonical, metadata, sitemap

  * **`NewsArticle` JSON-LD** (§11): one block on `/nyheder/[slug]`, built by
    `lib/seo/news-article.ts` — never assembled in JSX — from published values only:
    `headline` (title), `datePublished` (`display_date`, omitted when unset),
    `dateModified` (`updated_at`), `mainEntityOfPage` (the frozen slug under
    `lib/config/site.ts`'s origin), `publisher` (the restaurant's name, no invented
    logo). **No `image`** — photos are phase 10, and §11's rule for a value not
    supplied is omitted, not invented. `serializeJsonLd` escapes `<`, `>`, `&` as JSON
    `\uXXXX`, so the block renders as an ordinary React text child — no
    `dangerouslySetInnerHTML` — and no title can close the `<script>` early. A Draft
    Mode preview renders no block and no canonical: a draft has no public claims to
    make. Unknown/unpublished slugs 404 before any of this runs. Rich Results
    validation against Google's live tool is deliberately left for the final
    SEO/hardening phase; 9B makes the markup structurally correct and locally tested.
  * **Canonical and Open Graph** (§7f): `newsArticleMetadata` (`lib/seo/metadata.ts`)
    adds the self-canonical at the frozen slug's absolute URL, `og:type=article`,
    `og:locale=da_DK`, the article's own title/description/URL and
    published/modified times. **No `og:image`**: the article has no photo before phase
    10 and the branded fallback card §11 names is not yet supplied as an asset in the
    repository — recorded here so the lock pass and phase 13 know it is a gap by
    decision, not omission. When either arrives it lands in this one helper.
  * **The sitemap** (§11, §7f): `app/sitemap.ts` now exists — phase 3 had never
    created it, so 9B built the §11 file rather than extending one — as a reader over
    the pure `lib/seo/sitemap.ts`: the six public pages (no invented `lastModified`)
    plus one entry per **published** article at its frozen slug with `lastModified`
    from `updated_at`. Published-only is not re-decided: the route uses the same
    tagged public read as every page, so RLS decides membership and the same tag
    expiry that removes an unpublished article's page removes its entry on the first
    request; republishing returns the same URL. The route revalidates on the 5-minute
    net like every public page.

### The cache contract, restated for 9B (§20)

Revalidate 5m / Expire 5m unchanged, sitemap included. Publish, published autosave,
published Gem, unpublish, republish and published delete expire the `news` tag only
after their write reported success; creation, draft saves (auto or explicit) and draft
deletes expire nothing. First-request behaviour is asserted end to end for publish,
published-autosave-edit, unpublish, republish, the teaser and the sitemap.

### What phase 9B deliberately does not contain

No editor or rich-text dependency, no sanitizer (still nothing to sanitize), no
headings/lists/italic/underline/HTML mode, no image editing (the slot still states
phase 10, `image_id` still untouched), no migration and no database object — the
pgTAP suite is unchanged at 19 files because no function or grant moved — no client
fetching/state library, no second save path, no per-article preview link on the list
(review did not ask for it), and not the phase 13 SEO pass: no `Restaurant` JSON-LD,
no sitewide canonicals, no robots.ts, no OG images.

### The regression

From the state above: typecheck, lint and the source policy clean; the full unit
suite green (**2,182 tests in 74 files** — +84 in 4 new files and 3 extended for 9B)
*(corrected by the phase-9 lock pass, §0s: the suite at this commit was **2,098 tests
in 70 files** — 9B added 5 new files and 77 tests over 9A's 2,021 in 65; the figures
recorded here were a miscount, not a later regression)*;
pgTAP unchanged and green (**1,256 assertions in 19 files**); `next build` clean with
`/sitemap.xml` on the 5m/5m contract; `npx playwright test --list` collecting **991
tests in 25 files** with the news write spec under exactly `news-admin-mobile` and
`news-admin` (the §22 check); the full Playwright matrix green at `--retries=0`; and
`npm audit --audit-level=high` clean on the unchanged lockfile.

---

## §0s. Phase 9 — complete and locked (2026-09-01)

Phase 9 (News, §15) was built in two increments — **9A**, the administration's core
(§0q), and **9B**, the structured editor, autosave and the article's public claims
(§0r) — and closed by a completion pass on 2026-09-01. The two records above stay
exactly as written; the one statement in them that was wrong (§0r's unit-suite count)
is corrected in place. **This section is the statement of the CURRENT truth**, so a
later reader does not have to replay two increments to know what stands.

### What "phase 9" is, in force today

| Rule | Where it is enforced |
|---|---|
| **News is Staff and Owner** (§5) — never Owner-only. `requireStaff()` in the page and in every action, `mayChangeEntity('news', …)`, and RLS through the caller's own JWT, asserted from real Staff and Owner JWTs. | `app/(admin)/admin/nyheder/*`, `supabase/tests/019` |
| **Status-based persistence, no draft column.** An article is pending while `status='draft'`; an edit writes the row itself; **a published article's save — Gem or autosave — is on the hjemmesiden on the first guest request**, and the editor says so beside the button that commits it (`describeSaveConsequence`). | `lib/news/admin.ts`, §4 |
| **The slug is §7f letter for letter**: generated from the title (æ→ae, ø→oe, å→aa, other accents folded to their base letter), collision-suffixed `-2`, `-3`…, never typed, shown under the title, frozen at first publish by the phase-1 trigger, kept through unpublish, reused by republish — no redirect machinery, because the URL never moves. A lost race is `adresse_optaget`, a Danish sentence. | `lib/news/slug.ts`, `019` |
| **The body is structured JSON with exactly B and Link** — `{blocks:[{type:'paragraph', spans:[{text, bold?, href?}]}]}`, no HTML in either direction, no `dangerouslySetInnerHTML`, no sanitizer to get wrong. Three layers agree on links: the panel, `newsBodySchema` and the public renderer each accept absolute `https:` only and refuse `http:`, `javascript:`, `data:`, protocol-relative and unknown keys. Paste is plain text, drop is refused, and every `format*` input except bold is cancelled. | `lib/news/editor-model.ts`, `lib/schemas/news.ts`, `NewsBody.tsx` |
| **Span text is verbatim through every projection.** The read layer returns the stored spans byte for byte — the boundary spaces between a plain run and a marked one included — and blankness is decided per paragraph, where the write path enforces it. (The lock pass's one product fix; see below.) | `lib/content/news.ts`, `tests/unit/content/news-read.test.ts` |
| **Autosave is one machine and one save path**: a 2 s debounce restarted by typing, one save in flight, a pause with unchanged content writes nothing and expires nothing, edits during a save reschedule from the *response*, a stale response can never carry content into the form, conflict and deleted-underneath are terminal stops with the person's text kept on screen, no false "Gemt", and a Gem pressed mid-flight waits for the fresh token. The write is `autosaveArticle` → the same `toNewsArticleValues`/`saveNewsArticle` path Gem posts to — there is no second save system. | `lib/news/autosave.ts`, `NewsAutosave.tsx`, `autosave-actions.ts` |
| **No JavaScript, no lies**: the public pages work whole; a markless body edits as the 9A textarea (create, edit, publish, unpublish and delete all work scripting-free, walked end to end by the lock pass); a body with marks is shown read-only with the reason, rides back byte for byte in the hidden field, and the other fields stay editable. Nothing fakes rich text. | `NewsBodyField.tsx`, the `hasMarks` guard |
| **Audit under autosave keeps the 9A two-statement model** — content UPDATE, then `log_audit`, an audit failure logged server-side rather than rolling back the committed write. Kept deliberately (§0r's argument: news has no snapshot column a forged write could poison, the audit is operational history rather than a trusted authority, and RLS grants make the failure mode practically unreachable for the same caller) — **and recorded below for the final security audit to revisit.** The debounce means one row per settled save, never per keystroke. | `lib/news/admin.ts`, §0r |
| **The Forside teaser is `readPublishedNews(1)`** — nothing hard-coded; publish, published edit, unpublish and delete all move it on the first request; no published article renders no section at all. | `app/(site)/page.tsx`, `tests/unit/home/news-teaser.test.tsx` |
| **The article's public claims restate stored values and invent nothing**: one `NewsArticle` JSON-LD block (headline, `datePublished` from `display_date` when set, `dateModified`, `mainEntityOfPage`, publisher by name — no image, no logo, no author), self-canonical at the frozen slug, `og:type=article`, `og:locale=da_DK`, published/modified times. A Draft Mode preview renders no block and no canonical; unknown and unpublished slugs 404 first. | `lib/seo/news-article.ts`, `lib/seo/metadata.ts` |
| **The sitemap is the six public pages plus published articles** at their frozen slugs with `lastModified` from `updated_at`, on the same tagged read and the same five-minute contract; unpublish removes the entry on the first request, republish restores the same URL; with nothing published it is exactly the six static pages. | `lib/seo/sitemap.ts`, `app/sitemap.ts` |
| **The cache contract is Revalidate 5m / Expire 5m**, sitemap included, with no stale-while-revalidate tail (`expireTime`). Only a write a guest could notice expires the `news` tag, only after its transaction reported success; creation, draft saves (auto or explicit) and draft deletes expire nothing. | §20, `tests/e2e/news-admin.spec.ts`, `public-cache.spec.ts` |
| **`image_id` is owned by no editor** — never read, echoed or written; it survives every transition byte-identical. Images are phase 10. | `019`, `lib/schemas/news.ts` |
| **There is no per-article preview link on the list — by decision, not omission.** Frame 1z draws none (the rows, `‹ Tilbage` and `+ Ny` are the list's only controls), the technical plan never asks for one, and §0r recorded that review did not either. The editor's Forhåndsvis is the preview path. | 1z, §0q, §0r |

### What the completion pass changed

The walkthroughs (Owner, Staff, guest, no-JS), the 1s/1z screenshot audit at
375/768/1440, the keyboard passes and the targeted axe scans (the draft editor, the
open link panel and the autosave-failure state, which the standing suites do not
scan) found **one product defect**, and it was material:

- **The read layer was trimming every span's text.** `readSpan` read through the
  document helper `stringField`, whose contract is "blank is absent" — with a trim.
  Harmless while every paragraph held one span (all of 9A), it destroyed the boundary
  spaces between spans the moment 9B stored a marked paragraph: *"Et afsnit med
  **fed skrift** og…"* came back — in the editor after a reload and on the public page
  alike — as *"Et afsnit med**fed skrift**og…"*, while the database row stayed
  correct. The fix reads span text verbatim and moves the blank-is-absent decision to
  the paragraph, where the write path enforces it; `tests/unit/content/news-read.test.ts`
  (new, 5 tests) pins the projection, and the editor → save → reload → public-render
  round trip was re-proven byte-exact against the rebuilt production server. The e2e
  suite had not caught it because its mark assertions matched elements and substrings,
  never a full paragraph across a mark boundary.
- **Two stale phase-pointer comments corrected** — `app/(admin)/admin/nyheder/page.tsx`
  and `app/(site)/nyheder/[slug]/page.tsx` still described the B/Link editor, autosave
  and the JSON-LD as future 9B work; both now describe what shipped (the §0p precedent).
- **§0r's regression figures corrected in place** — the suite at the 9B commit was
  2,098 unit tests in 70 files, not "2,182 in 74"; git shows 9B added five new unit
  files and 77 tests. A miscount in the record, not a regression in the code.

Deliberate departures re-confirmed against the frames rather than "fixed": the Gem
button (1s draws none; it is the whole of no-JS saving and the explicit fallback), the
§7f address line under the title (the plan requires it; the frame does not draw it),
the honest phase-10 image slot (1s draws a functional-looking dropzone), "Ingen
kategori" as the sixth chip (a radio group must be clearable without JavaScript), and
the full field set at 375 px where 1z's mobile artboard omits the date field and two
category chips — the implementation carries the same fields at every width, as
accepted at 9A.

### Recorded for the FINAL SECURITY AUDIT (phase 13)

- **The audit-insert tolerance**: a news content UPDATE commits even if the following
  `log_audit` INSERT fails (the failure is server-logged). Accepted for News's
  ordinary content-edit architecture — the audit is operational history here, not a
  security-critical trusted snapshot — but `/security-review` and the manual pass must
  weigh it once more before launch.
- **`og:image` and the publisher logo** are absent because no asset exists in the
  repository yet, not because they were forgotten; both land in `lib/seo/metadata.ts` /
  `lib/seo/news-article.ts` when supplied (phase-10 photos / the branded card).
- **External Google Rich Results validation** of the `NewsArticle` markup stays with
  the final SEO/hardening phase; 9B and this pass verified the rendered block locally
  (one block, valid JSON, the §11 fields, nothing invented).

### The final regression

From a clean tree: `npm ci`, `npm run db:reset:full`, a fresh production build, no
stale server. Typecheck, lint and the source policy clean; **2,103 unit tests in 71
files** (the lock pass added the 5-test projection suite); **1,256 pgTAP assertions in
19 files**, green from real anonymous, Staff and Owner JWTs; `npm audit
--audit-level=high` clean (0 vulnerabilities); `npx playwright test --list` collecting
**991 tests in 25 files across 30 project registrations**, with `e2e/news-admin.spec.ts`
under exactly `news-admin-mobile` and `news-admin` and the generated-announcement
suite under exactly its two (the §22 check); and the full Playwright matrix at
`--retries=0`: **984 passed, 7 deliberately skipped (width/device guards), zero failed
and zero flaky**. The walkthroughs and the regression together re-verified phases 5–8
behind phase 9: dishes, sold-out, delete/restore, reorder and Tapas; the weekly
special, Saturday menu and monthly burger; manual announcements; the weekly hours,
overrides and generated announcements; the public-cache contract; zero public
cookies; and no browser Supabase client.

One environmental note from the run, recorded because it will be met again: the
chunked matrix reuses one production build across a database reset, and
`db:cache:clear` removes only the *data* cache — the ISR **page** cache survives, so a
public page revalidated just before the reset can be served for up to five minutes
after it. The canonical `npm run test:e2e` never sees this (its web server builds
after the reset), and the five-minute contract self-healed it exactly as designed; one
`no-javascript` test met the stale window and the project passed 10/10 rerun against
the expired cache.

**Phase 9 is complete and locked.** What §15 lists from phase 10 onward is untouched:
no upload path, no image editor, no client image code, `image_id` owned by nothing;
no Om os/Forside editors beyond phase 4's; and the menu-category content editor still
has no phase (§0b).

---

## §0t. Phase 10A — the image storage foundation (2026-09-01)

Phase 10 (§15) is built in three increments: **10A** — the secure
storage/upload/derivative foundation, recorded here; **10B** — the library screen
1w draws (list, alt text, replace/delete confirmations, usage labels); **10C** —
image selection wired into the dish, weekly, monthly and news editors, the public
rendering, and the cache coupling. 10A ships **no screen, no route and no visible
change anywhere**: it is the pipeline the next two increments stand on, in the same
no-caller state 8C-2's generator shipped in.

### The pipeline, and where authority lives

    Server Action (10B) runs requireStaff()
      -> requestImageUpload(): declared type and size checked, a fresh
         <uuid>/original.<ext> path minted, one signed upload token for exactly
         that path in the private bucket   (lib/images/signed-upload.ts)
      -> the browser downscales to max 2560 px with <canvas>, orientation baked
         in via imageOrientation: 'from-image', and PUTs to the one signed URL —
         no Supabase client, no key, no configuration in the browser
         (lib/images/client-upload.ts, unmounted until 10B)
      -> finalizeImageUpload(): the original is downloaded back, sniffed and
         decoded by sharp — the filename and declared type prove nothing —
         derivatives are rendered and written to the public bucket, and only
         then is the row created through create_image() with the caller's own
         JWT   (lib/images/finalize.ts, lib/images/processing.ts)

The browser contributes exactly two values: the declared MIME type (which chooses
only the extension the original is *stored* under) and a filename kept as sanitised
display metadata. Path, bucket, dimensions, byte size, sniffed type, derivative
record, uploader and row id are all server-derived and re-validated in SQL.

### The storage model

| Bucket | Visibility | Contents | Written by |
|---|---|---|---|
| `media-originals` | private | validated originals, `<upload-uuid>/original.<jpg\|png\|webp>`, 10 MiB / three MIME types enforced by the bucket itself | the signed upload token (one path each), the service role |
| `media` | **public** | derivatives only, `<upload-uuid>/<width>.<avif\|webp>`, immutable paths cached for a year | the service role only |

`storage.objects` has **no policy for `anon` or `authenticated`** — asserted by
pgTAP — so a browser session can write storage only through the one token the
server minted; a staff JWT that could write the public bucket directly could put
unprocessed bytes on the public site, which is exactly what §8's pipeline forbids.
Anonymous visitors read `/storage/v1/object/public/media/...` and nothing else;
originals are never publicly readable. Retention: **originals are kept, privately**
(§8 — re-derivation, future sizes, and the recovery story all want the master);
public pages will use derivatives only.

`lib/supabase/service.ts` gained its first and only runtime caller,
`lib/images/storage.ts` — a capability-shaped module (mint, download original,
upload derivative, remove) that never exposes the client handle, so no caller can
reach an arbitrary bucket or path. `tests/unit/policy/images-boundary.test.ts`
holds the import graph to exactly that, and to sharp living only in
`lib/images/processing.ts`.

### Validation and limits (stated in `lib/images/rules.ts`, restated in SQL)

- **Accepted input:** JPEG, PNG, WebP — sniffed from the actual bytes by sharp.
  **SVG is refused by default** (a script format needing a different security
  model), animation is refused (`pages > 1`), GIF/TIFF/AVIF/HEIC inputs are
  refused. A sniffed type that contradicts the stored extension is refused whole.
- **Limits:** 10 MiB per original (also the bucket's own `file_size_limit`),
  30 megapixels decoded, 10 000 px per side. The pixel cap is handed to sharp as
  `limitInputPixels` on every decoding pipeline, so a decompression bomb is
  refused by the decoder; the header sniff itself allocates no pixels.
- **Refusals** are a closed Danish vocabulary (`IMAGE_REFUSALS`) — §10g's
  "Billedet kunne ikke uploades. Prøv igen." is the generic failure — and no
  processor message, path or stack ever reaches the browser.

### The derivative set

§1 adjustment 3 verbatim: **AVIF + WebP at 480 / 960 / 1440 / 2160**, filtered to
the source width — never upscaled — with the source width itself as the single rung
when the original is below 480 px. AVIF quality 55, WebP quality 80, orientation
normalised into the pixels (`.rotate()`), and **no metadata copied to any
derivative** — EXIF including GPS, XMP and thumbnails do not survive processing,
asserted on real encoded output. `images.derivatives` records only formats and
measured per-rung dimensions; derivative *paths* are never stored — they derive
from the row's own `storage_path` through one pure function, so a forged record has
no path to point elsewhere.

### The database: one door in, one door out (`20260901140000`)

Phase 1's staff CRUD policies were right for a table nothing wrote; phase 10
changes what a row *means* — "these processed files exist with these measured
properties" — so the migration makes the trusted functions the only doors, with the
exact mechanism 8C-3B built for override deletion (the guard trigger and the
transaction-local `app.image_write` marker; policies and grants unchanged, no
SECURITY DEFINER anywhere):

- **`create_image()`** — SECURITY INVOKER; re-validates the strict path grammar,
  the mime/extension pairing, every limit and the exact derivative ladder
  (`is_valid_image_derivatives()`); takes `uploaded_by` from `auth.uid()`, never
  from a parameter; audits as `upload`/`image`. **Replay-safe on `storage_path`**
  (double-click, browser retry, duplicate finalize): the same finalized upload
  answers `exists` with the same row, no second row, no second audit entry — a
  raced duplicate lands on the UNIQUE constraint and reports the same.
- **`delete_image()`** — SECURITY INVOKER; version-checked (`conflict`),
  reference-aware: an image used by dishes/weekly/monthly/news refuses with
  `in_use` and the count unless explicitly confirmed, and a confirmed delete nulls
  every reference through the four `ON DELETE SET NULL` foreign keys in the same
  transaction — §7e item 4's "warn, and then null the reference — never a dangling
  id", with the warning half owned by 10B's screen. Audited as `delete`/`image`
  with the content as the recovery story, returning the `storage_path` so the
  server module can remove the files afterwards.
- **Direct writes:** INSERT and DELETE are refused for `anon`/`authenticated` by
  the guard; UPDATE is narrowed to a **column grant on `alt_text` alone** (the
  announcement's §5 mechanism) — the one person-authored column, 10B's ordinary
  edit. New safety CHECKs (path grammar floor with no traversal/backslash/control
  characters, known MIME, dimension/byte caps, filename length) hold for every row
  ever written.

### Write ordering and cleanup

Derivatives are written before the row; the row is written last, so **a row can
never point at files that do not exist**. Every failure branch removes what it
wrote (invalid bytes → original removed; derivative failure → written derivatives
and original removed; refused RPC → everything removed). The one deliberate
asymmetry: an upload that is never finalized leaves an original at an unguessable
path in the private bucket — unreferenced bytes, not a broken page — and cleanup
failures are server-logged rather than surfaced. 10B's library lists only database
rows, so nothing orphaned is ever visible; a periodic orphan sweep was considered
and refused as a scheduled job this architecture does not need (§7a's no-cron rule).

### What 10A verified, and where

- **Unit** (94 tests in 7 files): the rules, grammar and filename sanitisation;
  the ladder and no-upscale plan; the client downscale planning plus a source
  assertion over the DOM half (no jsdom, as phase 7A decided); the request flow's
  authority (path minted, never chosen); the finalize flow's ordering, cleanup and
  idempotency against recording fakes; and the new images-boundary policy suite.
- **Processing** (real bytes, fixtures generated by sharp at run time): valid
  JPEG/PNG/WebP decode and measure; garbage, executables, GIF and scripted SVG
  refuse; EXIF orientation 6 reports person-visible dimensions, bakes the rotation
  in and strips all EXIF from every derivative; parametrised limits refuse
  oversized bytes/pixels/sides.
- **pgTAP** (`020_image_storage.test.sql`, 72 assertions — total now **1,328 in
  20 files**): buckets and their limits; zero storage policies; the five unchanged
  images policies; both doors from real Staff and Owner JWTs; every forgery refusal
  (traversal, hand-picked path, mime/extension lie, oversize, upscaled rung,
  unknown derivative key, control characters); direct INSERT/UPDATE/DELETE refused
  while `alt_text` stays editable; the single-use marker; the reference-aware
  delete lifecycle with its audits; anon refused everywhere; unrelated tables
  byte-identical. 002/003/019 were updated to the new permission surface (the 8C-3A
  precedent: the suite follows the schema): staff/owner "add an image" now runs
  through `create_image()`, and 019's phase-10 fixture row is written as superuser.
- **Integration** (`tests/integration/images.test.ts`, new `npm run
  test:integration`, wired into CI's database job): the storage HTTP surface pgTAP
  cannot honestly cover — the full pipeline against the real local stack with a
  real staff sign-in; public derivative reads with EXIF verified absent; the
  private bucket refusing public reads; a tokenless PUT and a mis-pathed token
  refused; the bucket refusing an 11 MiB body; garbage and a declared-type lie
  leaving no row and no files; replay converging on one row.

### Recorded for the FINAL SECURITY AUDIT (phase 13)

- An unfinalized upload's original persists at an unguessable path in the private
  bucket (see cleanup above) — re-weigh whether launch wants a manual sweep note in
  the runbooks.
- A signed upload token is bound to one path but not to the requesting *session*;
  any staff member could in principle finalize a colleague's pending upload path if
  they learned its UUID. Both parties are staff and the finalize re-validates
  everything, so this is recorded as accepted, not fixed.
- The §0s audit-insert tolerance does **not** apply here: `create_image()` and
  `delete_image()` call `log_audit()` unconditionally in-transaction — a failed
  audit insert fails the write.
- `imgproxy` (Supabase's transformation service) is unused; derivatives are
  pre-rendered. If it is ever enabled, re-check that it cannot read
  `media-originals`.

### What phase 10A deliberately does not contain

No screen, no route, no Server Action, no navigation entry; no change to any
editor; `image_id` still owned by nothing (`images-boundary` asserts it); no cache
tag touched — creating or deleting an unreferenced image changes no public page,
and the entity-cache coupling is 10C's, next to the references that create it; no
usage view (10B, beside the labels that read it); no `next/image` and no
`next.config.ts` images block (§1 adjustment 3 — plain `<img srcset>` in 10C); no
queue, no job service, no orphan-sweep cron. The 10B Server Actions must set
`maxDuration` generously on the library route (AVIF at 2160 px is the slow rung —
measured locally around a second, but Vercel's default function window deserves the
headroom).

---

## §0u. Phase 10B — the image library (2026-09-01)

The 1w screen is built on the 10A foundation: `/admin/billeder` exists for Staff
**and** Owner (§5's "dish photos, and all image upload / replace / delete" row),
the 10A client downscale and signed-PUT pipeline is mounted for real, and the
library manages what it holds — the description edit, usage labels, 1w's Slet with
its in-use warning, and 1w's Erstat as a trusted one-transaction transition.
**Phase 10 is not locked**: 10C — image selection in the editors, public rendering
with `<img srcset>`, and the per-entity cache coupling — is not started, and no
`image_id` form field exists anywhere.

### What phase 10B contains

| Capability | Where it lives |
|---|---|
| The 1w screen — bar, dropzone, grid with usage captions, detail panel, all state in the URL | `app/(admin)/admin/billeder/`, `components/admin/images/` |
| The upload flow — choose → client downscale (`<canvas>`, max 2560 px) → request signed URL → direct PUT → authenticated finalize → the library | `ImageUploader.tsx` over `lib/images/client-upload.ts`, `upload-actions.ts` over the 10A flows |
| The upload states — forberedes / uploader / behandles / færdig / afvist / fejlet, one Danish sentence each, one polite status region, **no invented percentages** | `lib/images/upload-flow.ts` (a pure reducer), `ImageUploader.tsx` |
| Upload concurrency — one image at a time, the chooser disabled in flight, stale completions inert by attempt number | the same reducer; pinned in `tests/unit/images/upload-flow.test.ts` |
| The library read model — thumbnail derivative URLs, alt text, display filename, timestamp, usage, version token; **no private-original URL, no uploader identity, no pixel/byte/format display** | `lib/content/images-admin.ts`, `lib/images/library.ts` |
| Usage labels — "Bruges på: Odin", derived per request from the four `image_id` relationships by id, never from text; soft-deleted dishes included so the label agrees with `delete_image()`'s count | `readImageUsages()`, `usageLabel()` |
| Alt-text editing — the one direct column write (§0t's `alt_text` grant), version-checked in the UPDATE's own WHERE, blank stored as absent, refusals echo the typed text | `lib/images/admin.ts` (`saveImageAltText`), `alt-actions.ts` |
| Deletion — 1w's warning with the real usage list, "Slet spørger altid", the confirmation bit for an in-use delete, `delete_image()`'s atomic reference-nulling, then trusted file cleanup | `ImageDeleteDialog.tsx`, `delete-actions.ts`, `deleteLibraryImage()` |
| Replacement — upload the new image completely, then `replace_image()` repoints every reference and removes the old row in one transaction, then the old files go | `20260901160000_image_replacement.sql`, `replace-actions.ts`, `replaceLibraryImage()` |
| Thumbnails — the smallest public derivative pair in a `<picture>` (AVIF source, WebP img), explicit width/height, plain `<img>` — no `next/image`, so no remote-host configuration exists at all | `planThumbnail()`, `ImageThumbnail.tsx` |
| `maxDuration = 60` on the library route, from a measurement rather than a guess | `page.tsx`, `tests/integration/images-large.test.ts` |

**One migration, one function.** `20260901160000_image_replacement.sql` adds
`replace_image(p_old_id, p_expected_updated_at, p_new_id)` — SECURITY INVOKER,
`search_path` pinned, version-checked behind a `FOR UPDATE` lock, audited once as
`'replace'` with both storage paths in the before/after pair, returning the old
path for trusted cleanup. It changes no policy, no grant, no table and no other
function; the old row leaves through the same guarded door `delete_image()` uses,
and pgTAP `021` (38 assertions) proves the transition, its refusals, all four
relationships moving together, and the untouched draft on a repointed dish, from
real Staff, Owner and anonymous JWTs.

### The readings this phase had to settle

| # | Question | The answer |
|---|---|---|
| A | **What does 1w's "Erstat" mean?** | The new image is uploaded and processed **completely first**, through the ordinary pipeline — by the time the transition runs it is a finished library row. `replace_image()` then repoints every `image_id` reference and removes the old row in one transaction, and only after that commit are the old files removed. The current image is never destroyed in the hope a replacement will arrive; a failure at any step leaves it untouched (the screen says so, and says where the already-uploaded new image ended up: in the library, deletable like any other). The new image inherits **no alt text** — the picture changed, so the old sentence about it may be false. |
| B | **Is usage a SQL view, as §4 sketched?** | **No — a read-layer derivation, same rule, no migration.** §4's point was that usage is *derived from the four known reference columns, never stored*; the admin read module runs the same four reads a view would run, through the caller's own JWT, fresh per request. A view would have added a migration and pgTAP surface to carry identical semantics. If 10C's cache coupling wants the database's own answer, a view can still be introduced beside the references it serves. |
| C | **Where does the alt-text edit live, when 1w does not draw one?** | In the detail panel, with the existing field tokens — an infrastructure-required departure (§24 of the phase brief): `alt_text` is the one person-authored column, 10A narrowed the direct grant to exactly it for "10B's ordinary edit", and a library with no way to describe a picture cannot keep the accessibility promises 10C's public rendering will need. Plain Danish ("Beskrivelse af billedet"), blank allowed and stored as `null`, no AI generation, no SEO coaching — final copy passes stay later work. |
| D | **What may the browser say?** | The closed vocabularies of §21: an upload request is a declared type, a declared size and a display filename; a finalize is the server-minted path handed back; the alt form is an id, a version token and the sentence; the delete form is an id, a version token and the one confirmation bit; a replace is the old id, its version token and the id finalize just answered. Every programmatic action parses a `z.strictObject`; every form reads only its named fields. **No field exists for a storage path, a dimension, a MIME type, a derivative, a bucket, an uploader or a created id** — asserted by the images-boundary policy suite. |
| E | **How does a delete confirmation survive its own race?** | The confirmation bit records *which question was answered*: a dialog rendered over an unused image submits no bit, so if a reference appears while it is open, `delete_image()` answers `in_use`, nothing is deleted, and the screen reopens the confirmation over the fresh usage list. Walked end to end in the E2E suite by creating the reference while the dialog is open. |

### Signed-token findings (brief §7 and §8) — measured, pinned, and accepted

- **Lifetime: 7 200 s (two hours), SDK-fixed.** `createSignedUploadUrl` exposes no
  expiry option; the token's own `exp − iat` is asserted in
  `tests/integration/images-token.test.ts`, so an SDK upgrade that changes the
  contract fails a test. Long for one PUT, but the token authorizes one path in
  the **private** bucket, travels over TLS to the authenticated staff member who
  asked for it, and nothing becomes public or recorded until an authenticated
  finalize revalidates the actual bytes.
- **Same-path replay cannot overwrite.** Once an object exists, a second PUT with
  the same valid token is refused (HTTP 400, "resource already exists" — upsert
  was pinned false at mint time), and a client-supplied `x-upsert: true` header
  cannot widen the token. So a replay before finalize is refused, a replay after
  finalize cannot corrupt the original out from under the derivatives, and the
  only window left — two PUTs racing before the object exists — is a race between
  two requests by the same authorized person, settled by finalize validating
  whatever won, whole. **No mitigation needed beyond what 10A built**; the
  session-unbound-token note from §0t stands as accepted, unchanged.
- **A PUT with no finalize stays a private orphan**: no row, nothing public —
  re-verified from the outside.

### Large-image runtime (brief §9) — measured

A 29.7-megapixel (6900×4300) JPEG generated at run time was driven through the
real pipeline against the local stack: **finalize — download, sniff, decode,
eight derivative encodes, eight uploads, `create_image()` — completed in ~1.9 s**,
and a 30.8-megapixel original was refused whole with the original removed again.
Both are permanent integration tests (`images-large.test.ts`), so the number is
re-measured on every run rather than remembered. `maxDuration = 60` on
`/admin/billeder` gives roughly thirty-fold headroom for a slower production
vCPU, a cold start and real storage round-trips — generous, as §0t asked, and
justified by the measurement rather than by hope.

### Departures from frame 1w, and why

| Where | What ships |
|---|---|
| 1w's chooser line reads "JPG og PNG" | **"JPG, PNG og WebP"** — the pipeline accepts WebP (§0t), and the sentence must not refuse in words what the server accepts in fact. |
| 1w draws no alt-text field | Added in the detail panel (reading C above) — existing tokens, no new design language. |
| 1w draws no way back from the detail panel, and no upload feedback | "‹ Alle billeder", the status notices and the one `role="status"` upload sentence — infrastructure-required states, drawn in the administration's established vocabulary. |
| 1w's grid captions include "Forsiden", "Om os", "Udmærkelse" | Those are `pages`-document references that exist only from phase 11's editors onward; 10B's captions state the four real relationships (dishes by name, Ugens ret, Månedens burger, news by title) and 1w's "Bruges ikke endnu" for the rest. Not a conflict — the frame illustrates the eventual full system. |
| The frame's grid is four columns at 700 px | Four from `lg`, three from `md`, two at 375 — the phone has no dedicated Billeder frame (1x draws only the dashboard tile), so the established mobile stacking rules apply. |

### What phase 10B deliberately does not contain

| | Owner |
|---|---|
| **Image selection in any editor** — dish, weekly, monthly, news, forsiden. `image_id` is in no field list and no form control; the policy suite still asserts it. | **10C** |
| **Public rendering** — every public page keeps its placeholder; the admin library is the only browser-visible image rendering 10B introduces. | **10C** |
| **Cache coupling** — no image write expires any public tag: creating, describing, deleting or replacing an image changes no byte a guest is served before 10C wires the references into rendering. | **10C** |
| Folders, tags, galleries, search, filters, bulk upload, bulk delete, drag sorting, cropping, image analytics | **never** — this is a small restaurant's media library (phase brief §1). |
| An orphan-sweep job, an upload queue, a background worker | **never** (§7a's no-cron rule; the measured runtime needs none). |

### Recorded for the FINAL SECURITY AUDIT (phase 13)

- The §0t recordings stand unchanged (unfinalized originals as private orphans;
  the token not bound to the requesting session). 10B adds the measured token
  facts above — two-hour lifetime, no overwrite within it — as the evidence the
  audit should start from.
- `replace_image()` accepts **any** existing image as the successor, not only a
  fresh upload. A staff member pointing it at an already-referenced image
  performs a repointing their direct `image_id` privileges already allow, so no
  authority is widened — recorded so the audit re-weighs it deliberately.
- Storage cleanup after a committed delete/replace is best-effort: a failed
  removal is server-logged and leaves orphaned bytes (private original at an
  unguessable path; public derivatives at an unpublished-after-deletion path).
  The audit row names the storage path, and every derivative path derives from
  it, so manual recovery is one listing away. Database integrity never depends
  on the files.

### The regression

From a clean tree: `npm ci`, `npm run db:reset:full`, a fresh production build.
Typecheck, lint and the source policy clean; **2,262 unit tests in 81 files**
(+65 in 3 new files plus the extended policy suite); **1,366 pgTAP assertions in
21 files** (+38 in `021`), from real anonymous, Staff and Owner JWTs; **12
integration tests in 3 files** (the 10A suite kept, plus the token and
large-image suites); `npm audit --audit-level=high` clean (0 vulnerabilities);
`npx playwright test --list` collecting **1,039 tests in 27 files**, with
`e2e/image-library.spec.ts` under exactly `image-library-mobile` and
`image-library` (the §29 check); and the full Playwright matrix at
`--retries=0`: **1,032 passed, 7 deliberately skipped (width/device guards),
zero failed and zero flaky.** Phases 5–9 ran green behind it, unchanged.

**Phase 10B is complete and green. Phase 10 is not locked** — 10C (entity image
selection, public `<img srcset>` rendering, per-entity cache invalidation, and
the draft-reference revisit `delete_image()`'s comment reserves) remains, and the
phase-10 lock pass after it. *(10C-1 — the editor selection and the
draft-reference revisit — is complete; see §0v. 10C-2 — the public rendering and
the cache coupling — remains.)*

---

## §0v. Phase 10C-1 — editor image selection and the draft-aware reference model (2026-09-01)

Images are now a real content field in the four approved editors — the dish panel
(1r), Ugens ret (1ag), Månedens burger (1ah) and the news editor (1s) — through
one shared picker over the 10B library, and the image-reference model was made
whole for the fact 10C-1 itself creates: an image id can now live inside pending
draft JSON, where no foreign key reaches. **Phase 10 is still not locked**: 10C-2
— public `<img srcset>` rendering, the public read-model projection, and the
image-write cache coupling — is not started.

### The image model, per entity — stated exactly

| | live | pending | preview | publish | Fjern billede |
|---|---|---|---|---|---|
| **dish / weekly / monthly** | the row's `image_id` column | `draft->'image_id'` — a uuid string is a pending selection, JSON `null` a pending removal, an absent key no pending change (§4's delta rule, reduced to one field) | `overlayDraft` with the entity's own spec — the same overlay every Draft-Mode loader and admin read uses | the phase-4 SQL merge, unchanged: `draft ? 'image_id'` moves it into the column | writes the pending state (`null` over a live image; leaves the draft when nothing is live) |
| **news** | the row's `image_id` column | none — news has no draft layer (§4), and none was invented | the article's own row/status model | n/a — a draft article's whole row becomes public via `publish_news()` | sets the column `null` through the one news save path |

Published and pending images differ freely; a guest keeps the published image
until Offentliggør, and no draft save expires any cache tag. A published news
article's image change is public on the next request, exactly like its other
fields, and expires the `news` tag through the same `isPublic` cue every news
save uses.

### The selector — one component pair, four editors

`ImagePickerField` (the slot: 1r/1ag/1ah/1s's "Billede (valgfrit)", empty and
chosen states) and `ImagePickerDialog` (the picker: the library's thumbnails as
submit buttons inside one form, promoted to a modal `<dialog>` by the existing
`ModalDialog`, an ordinary fragment-scrolled block without JavaScript). The
frames draw only the slot and "Vælg billede", so the picker is the
administration's smallest existing pattern — the URL-driven server-rendered
dialog — with no folders, search, filters, cropping, sorting, metadata controls
or upload; uploading stays on `/admin/billeder`, which the dialog links to. Each
screen has its own image Server Action; for the three draft entities it is an
ordinary partial-editor draft write (like reordering), so `image_id` stays
outside every content form's field list and a Gem can never clear a pending
photo. For news the action routes through `saveNewsArticle` — the one news save
path — restating the row's own content and changing only the image.

Departures, recorded: 1r's chosen-state "Erstat"/"Fjern" ship as "Skift
billede"/"Fjern billede", because "Erstat" already means global asset
replacement one screen away and one word must not mean two things; 1s's
drag-to-upload dropzone is deliberately not built into the editor (the library
owns upload, brief §3); and each slot sits after its card's Gem form rather than
between its fields, because the removal control is a form of its own and forms
cannot nest.

### The browser/server authority boundary (brief §6)

A picker submits two values — the entity's version token and `billede`, an image
id or the empty value ("no image") — plus its screen's own identifying fields
(`ret`, `nyhed`). Parsed strictly by one reader (`readImageSelectionForm`); no
field exists for a storage path, derivative, MIME type, dimension, bucket,
filename or usage claim. The server verifies the id names an image this caller
can read (`imageExists`, through the caller's own JWT — draft JSON has no FK to
refuse a dangling id for it), re-parses through the entity's strict schema,
re-checks the role matrix and applies the version token as optimistic
concurrency; the FK on the live column remains the final gate at publish. The
§29 policy suite now asserts the narrower truth: the selection control renders
only in the two picker components, is parsed only by the four image actions, and
`image_id` stays outside every content editor's field list while being required
(nullable) in `newsArticleInput`.

### Reference discovery — one definition (brief §19)

`public.image_references` (migration `20260901180000`), a SECURITY INVOKER view:
the four live `image_id` columns plus the three draft `image_id` keys, each row
`(image_id, kind, entity_id, name, pending)`. `pending` is true for a draft-held
reference and for a news reference on an unpublished article — display truth in
one word. `delete_image()` counts from the view; the library's usage read maps
the same rows; so a caption, a delete refusal and the confirmed detach can never
disagree about what "referenced" means. The labels say it in plain Danish:
"Bruges på: Odin", and "Odin (kladde)" only when every reference from that place
is pending (§12).

### Deletion and replacement over drafts (briefs §13–§16)

`delete_image()` now reads the row FOR UPDATE (so the version check holds until
commit), refuses `in_use` with the full live+draft count, and a confirmed delete
clears exactly the `image_id` key from every draft naming the image — `nullif(draft
- 'image_id', '{}')`, so every other pending field is byte-identical and an
emptied draft becomes `NULL` again (the phase-4 empty-draft rule, restated in
SQL) — in the same transaction the FKs null the live columns. The audit's
before-document now records the live/draft reference counts beside the recovery
content. `replace_image()` moves the three draft keys old→new with `jsonb_set`
exactly as it moves the four live columns; a draft naming a different image is
untouched. Every §13/§14 live-versus-draft combination is proved in pgTAP `022`
(85 assertions) from real Staff, Owner and anonymous JWTs, with fingerprints on
unrelated drafts, rows and tables, and refused transitions writing nothing. No
SECURITY DEFINER appeared; the guard-marker convention is unchanged.

### The preview boundary (brief §18)

Draft Mode resolves pending images at the read-model level by construction —
the preview loaders overlay with the same `overlayDraft` + spec the editors and
the unit proof (`tests/unit/drafts/image-preview.test.ts`) exercise — but **no
public or preview page renders an image yet**: the public read models carry no
image projection, and the E2E suite asserts the guest menu serves zero
`/storage/v1/` images. Rendering the resolved value (preview and guest alike) is
10C-2, together with the projection and the responsive markup. The observable
10C-1 surfaces for a pending image are the editor's own slot and the library's
kladde captions, and the E2E stories assert both.

### Recorded for the FINAL SECURITY AUDIT (phase 13)

- ~~**Live `image_id` is directly writable by a staff JWT**~~ — **closed, not
  accepted; see §0w.** This entry had argued that the direct write carried no
  authority the same person lacks through draft-and-publish. The argument
  mistook what the workflow is for: publishing decides *when* a change becomes
  public and carries the version check, the audit row and the cache expiry with
  it. Since `20260901200000` a direct write of the published `image_id` on
  `dishes`, `weekly_special` and `monthly_burger` is refused by the database for
  Staff and Owner alike, and pgTAP `023` proves it. The standing §0t/§0u
  recordings (signed-token lifetime and session-unboundness, service-role
  boundary, best-effort storage cleanup, `replace_image()` accepting any
  successor) remain for the audit, unchanged.
- Image-library replace/delete still expire no public cache tag — correct while
  nothing public renders images, and 10C-2 must wire the per-entity coupling
  the moment that changes.

### What phase 10C-1 deliberately does not contain

| | Owner |
|---|---|
| Public and preview image rendering, the public read-model projection, `<img srcset>`, per-entity cache coupling for image writes | **10C-2** |
| Alt text anywhere outside the library — entities store only `image_id`, so a later alt edit updates every usage (§22) | **by design** |
| Image selection for the `pages` documents (Forsiden, Om os, Mad ud af huset) — their schemas carry no image keys yet | **phase 11** |
| Folders, search, filters, cropping, upload-in-editor | **never** |

### The regression

From a clean tree: `npm ci`, `npm run db:reset:full`, a fresh production build.
Typecheck, lint and the source policy clean; **2,299 unit tests in 84 files**
(+28 in 3 new files, plus the updated policy and fixture suites); **1,451 pgTAP
assertions in 22 files** (+85 in `022`), from real anonymous, Staff and Owner
JWTs; **12 integration tests in 3 files** unchanged; `npm audit
--audit-level=high` clean (0 vulnerabilities); `npx playwright test --list`
collecting **1,073 tests in 28 files**, with `e2e/editor-images.spec.ts` under
exactly `editor-images-mobile` and `editor-images` (the §29 check); and the full
Playwright matrix at `--retries=0`: **1,066 passed, 7 deliberately skipped
(width/device guards), zero failed and zero flaky.** Phases 5–10B ran green
behind it, unchanged; the public cache is still 5m/5m and no tracking cookie and
no browser Supabase client appeared.

---

## §0w. Phase 10C-1 hardening — the published image reference is protected (2026-09-01)

The one 10C-1 finding that was not accepted is closed: a Staff or Owner JWT can
no longer move `dishes.image_id`, `weekly_special.image_id` or
`monthly_burger.image_id` with a direct PostgREST write. §0v had recorded the
direct write as accepted because it carried no privilege the same person lacks
through Kladde → Forhåndsvis → Offentliggør. That argument mistook what the
workflow is for: publishing decides *when* a change becomes public, and it
carries the version check, the audit row and (from 10C-2) the public cache
expiry with it — a direct UPDATE skipped all of that and changed the guest's
photo at once. Migration `20260901200000` closes it, narrowly. **Phase 10 is
still not locked**; 10C-2 is not started.

### The privilege model, exactly

`authenticated` holds a table-level UPDATE grant on all three tables (phase 1;
INSERT and DELETE as well on `dishes`), RLS decides the rows with `is_staff()`,
and every function that legitimately moves the column — the three publish
functions, `replace_image()`, `delete_image()` — is SECURITY INVOKER and spends
that grant. The announcement pass measured the consequence (§0l reading A) and
it applies unchanged: a grant narrowed past `image_id` refuses the transitions
too, and SECURITY DEFINER is refused as a way around that. So the *transition*
is constrained rather than the privilege, with the mechanism `20260831160000`,
`20260831200000` and `20260901140000` already use: every grant and every policy
stands, and a BEFORE trigger recognises the trusted transitions by a
transaction-local marker.

### Every legitimate writer of a live `image_id` — enumerated from the source

| Writer | Statement(s) | Transition word |
|---|---|---|
| `publish_dish()`, `publish_weekly_special()`, `publish_monthly_burger()` | the one phase-4 merge UPDATE each, `draft ? 'image_id'` moving the column | `publish` |
| `replace_image()` | three live UPDATEs `set image_id = new where image_id = old` — **each may reach any number of rows** | `replace` |
| `delete_image()` (confirmed) | three live UPDATEs `set image_id = null where image_id = p_id`, **new**, before its DELETE | `detach` |
| the FK `ON DELETE SET NULL` | a referential UPDATE, **measured** to run as the table owner (`postgres`), so the guard steps aside for it as for a migration; reachable only through the two trusted image deletes | none needed |
| `news.image_id` | the FK, and the one news save path — deliberately unguarded (§4, phase 9) | n/a |

Nothing else moves the column: `set_dish_sold_out()`, `set_dish_deleted()`,
the reorder, `copy_weekly_special_to_draft()`, the sold-out and touch triggers
and every editor save write other columns or `draft`; no restore or undo
transition touches these columns (the announcement's restore is another table,
a dish's un-delete moves `deleted_at` only); and no application statement names
`image_id` on the three tables at all — `tests/unit/policy/images-boundary.test.ts`
now pins that the only `.update()` payload naming `image_id` anywhere in
`app/`, `components/` and `lib/` is the news save.

### The guard architecture

- **The marker is `app.image_reference_write`, statement-scoped.** A BEFORE
  INSERT OR UPDATE **OF `image_id`** FOR EACH ROW guard,
  `tg_guard_image_reference_write()`, refuses (42501, PostgREST 403) any
  movement of the live column from `anon` or `authenticated` that the marker
  does not name. It reads the marker and never consumes it, so every row of a
  multi-row statement is judged by the same word; an AFTER INSERT OR UPDATE FOR
  EACH STATEMENT trigger, `tg_consume_image_reference_write()`, clears the
  marker when the statement ends — rows moved or not. Each transition also
  clears it explicitly, immediately after its statement.
- **Why a second marker name and not `app.image_write`.** The images-row marker
  is consumed by the first row it admits: one marker, one row. A replacement
  that admitted the first dish and refused the second would be a half-applied
  transition, so the reference marker authorises exactly one *statement*. Two
  consumption rules under one name would be a trap for the next reader; two
  names in the same family are not.
- **The vocabulary admits shapes, not just words:** `publish` may set, change or
  clear; `replace` moves a non-null image to a non-null image; `detach` only
  clears. No word admits an INSERT that arrives with a photo — a new dish is
  born as a draft (`lib/publishing/create.ts`) and meets its first live image
  through publish — so that INSERT is always refused for browser roles.
- **The guard is one column wide.** An UPDATE of any other column, an UPDATE
  that names `image_id` with its current value (a PATCH echoing the row), and
  every draft write are exactly the writes they were.
- **Why direct PostgREST is refused.** A request is one transaction holding one
  statement or one RPC: there is no second statement in which a marker could be
  spent, `set_config` is not an exposed RPC, and the only functions that raise
  this marker clear it before they return. Owner is refused exactly as Staff —
  authority to publish is not authority to bypass — and anon is refused by the
  missing grant, as before.
- **SECURITY INVOKER retained** on all five transitions and both trigger
  functions; `search_path` pinned; no grant, policy or other column changed.
- **One bookkeeping order, recorded.** In PL/pgSQL, `PERFORM set_config(...)`
  sets `FOUND` and `ROW_COUNT` (the call returns one row). The restated
  transitions therefore read a guarded statement's row count *before* clearing
  the marker, and the publish functions test that count rather than `FOUND`.
  `delete_image()` and `replace_image()` had read their DELETE's count after the
  clearing `PERFORM`; their FOR UPDATE lock had made the branch unreachable, and
  the order is corrected while they are restated.

### Publish, replace and delete after the guard

- **Publish** is byte-for-byte the phase-4 merge with the marker around its one
  UPDATE. Live A + draft B → B, live A + draft null → null, live null + draft B
  → B — proved for all three entities, with every unrelated column
  byte-identical, the draft cleared, `is_new_draft` cleared for a dish, and the
  audit row written; a stale publish returns `conflict` and writes nothing.
- **Replace** keeps the whole 10B/10C-1 contract: one transaction, the four
  live columns and the three draft keys, one audit row naming both storage
  paths, the old files removed only after commit. Proved multi-row: two dishes,
  both singletons, an article and a pending draft move in one call, and a draft
  naming a different image is untouched.
- **Delete** keeps the whole 10C-1 contract and gains the explicit detach: a
  confirmed delete clears exactly the `image_id` key from every draft, nulls
  the three guarded live columns under `detach`, lets the news FK null its own,
  removes the row and writes the audit — one transaction, no dangling id. The
  guard would have let the FK through anyway (the referential action runs as
  the owner), but a transition should be readable in the function that owns it
  rather than rest on the privilege context of a referential action; the
  measurement is pinned in `023` so a change in that behaviour fails a test.

### Marker hygiene — measured

After a successful publish, replace and delete; after a `conflict`; and after a
transition that raised mid-way (a publish whose draft names an image that does
not exist, refused by the FK after the marker was raised) — the very next
direct write of the live column is refused. A marker raised by hand admits
exactly one statement, however many rows, and is spent by a statement that
moves nothing; `detach` cannot set, `replace` cannot clear or set from empty,
no word admits an INSERT with a photo; and the two markers do not stand in for
each other (`app.image_write='delete'` admits no reference write,
`app.image_reference_write='publish'` admits no images-row delete).

### News — not changed, by decision

News has no draft column and no Draft → Preview → Publish snapshot (§4); its
direct-edit model was accepted and locked in phase 9, and `news.image_id` stays
writable through the one news save path. The inspection found no new news
vulnerability: `replace_image()` and the FK move its reference exactly as
before, and the image-selection form on 1s still travels only through
`saveNewsArticle`.

### Recorded for the CODE-QUALITY / CORRECTNESS AUDIT — the sold-out guard

`tg_guard_sold_out_date()` validates every *changed* `sold_out_on` against
today ±1 in Copenhagen, for every role — it has no owner or migration
step-aside, unlike every transition guard. A date days in the past therefore
exists only because days passed; the seed, a migration and a test fixture can
none of them write one, and pgTAP `023` has to disable the trigger for one
owner statement to stage the state. The trigger is deliberately **not** changed
here: `023` proves that `replace_image()` and a confirmed `delete_image()` on a
dish carrying a five-day-old sold-out date go through untouched (an unchanged
column is not re-validated, the soft-delete fix from phase 5D), so nothing in
this hardening breaks a sold-out workflow. The observation stands for the later
audit: a validate-on-write trigger that cannot be satisfied by any trusted
writer of historical state is a fixture cost and a restore-from-backup
question, not a security property.

### Tests

- `supabase/tests/023_image_reference_guard.test.sql` — **142 assertions** from
  real Staff, Owner and anonymous JWTs: structure (triggers, `OF image_id`,
  unchanged grants and policies, no SECURITY DEFINER, no guard on news), the
  refused bypass for Staff and Owner (change, clearing, INSERT with a photo, on
  all three tables) beside every write that must still work, publish on all
  three entities across the three live/draft combinations, the multi-row
  replacement, the confirmed and refused deletes, the marker hygiene above, the
  sold-out interplay, the referential-action measurement, and fingerprints on
  every unrelated row.
- `020`, `021`, `022` re-fixtured: a live reference is now staged through a
  table-owner fixture door (`pg_temp.fixture_live_image`), never a direct staff
  write; `022`'s §28 measurement is re-taken as a refusal and the FK's final say
  is proved at publish instead of at a direct write (**86** assertions, +1).
- `tests/unit/policy/images-boundary.test.ts` — one assertion added: no
  application statement names `image_id` on the three draft entities.
- `tests/e2e/editor-images.spec.ts` — the after-all restoration deletes
  leftover images through `delete_image()` *first* and then clears drafts,
  naming no live column; no story changed, and the UI required no change.
- `tests/e2e/image-library.spec.ts` — the 10B-era usage fixture (`pointThorAt`,
  a direct staff PATCH of `dishes.image_id`) was the one remaining direct
  writer in the repository, found by the guard refusing it in the first full
  run. It now stages Thor's usage the way a person does: the selection into
  `draft`, then `publish_dish()` with the version token — the same door, the
  same audit row. Every story and assertion is unchanged.

### Standing carry-forwards for the final security audit — unchanged

The signed-upload token findings (§0t, §0u), the service-role boundary, the
best-effort storage cleanup, `replace_image()` accepting any successor, and the
not-yet-wired cache expiry for library replace/delete (10C-2's obligation).

### The regression

From a clean tree: `npm ci`, `npm run db:reset:full` (the new migration applies
cleanly), a fresh production build from an emptied `.next`. Typecheck, lint and
the source policy clean; **2,300 unit tests in 84 files** (+1, the policy
assertion); **1,594 pgTAP assertions in 23 files** (+142 in `023`, +1 in
`022`), from real anonymous, Staff and Owner JWTs; **12 integration tests in 3
files** unchanged; `npm audit --audit-level=high` clean (0 vulnerabilities);
`npx playwright test --list` collecting **1,073 tests in 28 files**, with
`e2e/editor-images.spec.ts` and `e2e/image-library.spec.ts` each under exactly
their own two projects; and the full Playwright matrix at `--retries=0`,
run as the chunked chain (the read-only trio together, every write project in
its own invocation, in config order, against one detached production server):
**1,066 passed, 7 deliberately skipped (width/device guards), zero failed and
zero flaky** on the authoritative runs. Recorded honestly: the first full pass
had one first-attempt failure in `opening-hours` (a save press whose 5 s
settle poll timed out; nothing in this change touches opening hours) whose
leftover Monday draft cascaded into the next three hours suites, and the
`image-library` fixture refusal described above, which cascaded into
`editor-images-mobile`. After the fixture change, a `db:reset:full` and a
rebuild, every chunk from `opening-hours` to the end of the chain re-ran
green at `--retries=0` against the same commit; the nineteen chunks before it
had been green on the first pass. Phases 5–10B ran green behind it, unchanged;
no browser Supabase client, no storage metadata from any form, and the service
module boundary appeared exactly as before.

---

## §0x. Phase 10C-2 — public image rendering, the cache coupling and the news image metadata (2026-09-01)

The image relationships 10C-1 secured are now visible: every approved public
image slot renders the selected library photograph from the processed derivative
ladder alone, the Draft Mode preview renders the pending selection through the
same model, a published news article names its image in `og:image` and its
`NewsArticle` JSON-LD, and every image-library mutation that changes what a guest
sees expires exactly the public cache tags whose HTML changed. **Phase 10 is not
locked**: the lock pass — reading 10A, 10B, 10C-1 and 10C-2 as one system — is the
next step, recorded at the end of this section.

### The public image surfaces — the frames' own list (brief §1)

Only the placeholders the approved frames draw for an *entity* image are
replaced; the hero, award, team and map frames belong to phase 11's `pages`
editors and phase 14's assets and still render `MediaPlaceholder` directly.

| Entity | Public surface | Frame and slot | Source |
|---|---|---|---|
| dish | `/menu` card (`DishCard`) | 1h 4:3 at 9.375rem from `md`; 1m 1:1 at 6rem | `dishes.image_id` |
| dish | Forside "Tre fra menuen" (`FeaturedDishCard`) | 1g 3:2 across the card's top; 1l 1:1 at 6rem | the same `image_id` |
| weekly_special | `/menu` Ugens ret (`WeeklySpecial`) | 1h/1af 4:3 at 12.5rem; 1m full width | `weekly_special.image_id` (the Saturday menu has no slot) |
| monthly_burger | `/menu` Burgere card (`MonthlyBurgerCard`) | 1h 4:3 / 1m 1:1, as a dish | `monthly_burger.image_id` |
| monthly_burger | Forside feature (`MonthlyBurgerFeature`, §0d) | 4:3 column, 17.5rem from `md`, 21.25rem from `lg`; full width on a phone | the same `image_id` |
| news | `/nyheder` card (`NewsCard`) | 1j 3:2 at 16.25rem; 1n full width | `news.image_id` |
| news | Forside teaser (`NewsTeaserCard`) | 1g 4:3 at 8.125rem; 1l full width | the same `image_id` |
| news | `/nyheder/[slug]` (§7f) | 3:2, the article's 62ch measure | the same `image_id` |

No image → the reserved frame, exactly as before. Two frame details are recorded
rather than built, because both change the *no-image* card and not the slot: 1j's
date-circle variant for an article without a photo, and 1af's "uden foto" weekly
card whose text runs to the edge. Both are phase-10 lock-pass decisions.

### One public image model, one renderer

- **`lib/images/public.ts`** (pure) — `buildPublicImage(origin, row)` turns the
  three stored facts a public read may see (`storage_path`, `alt_text`,
  `derivatives`) into `PublicImage`: the ascending candidates (AVIF and WebP URL
  per measured rung, through the central `derivativePath` and the new
  `derivativePublicUrl`), the two `srcset` strings, a WebP `src` fallback (the
  smallest rung at or above 960 px, never the 2160 rung), the intrinsic
  `width`/`height` of the largest rung, and `alt`. A storage path the upload flow
  could not have minted or a derivative record outside the validated shape yields
  `null` — the placeholder, never a guessed URL and never the original (brief
  §4). No rung is ever referenced that the record does not carry; nothing is
  upscaled. `seoImageOf()` picks the one derivative every SEO surface names, and
  `IMAGE_SIZES` states each slot's real rendered width per breakpoint (brief §7).
- **`lib/content/images.ts`** (server-only) — `readPublicImages(access, ids)`,
  called *inside* each tagged read (`menu-sections`, `weekly-special`,
  `monthly-burger`, `news-list`, `news-article`) with the **overlaid** ids, so
  the image data is part of the entity's cache entry and a preview resolves the
  pending selection through the same projection. Only `id, storage_path,
  alt_text, derivatives` are selected: no filename, no uploader, no bytes, no
  MIME, no private bucket. `Dish`, `WeeklySpecial`, `MonthlyBurger` and
  `NewsArticle` carry `image: PublicImage | null`.
- **`components/site/SiteImage.tsx`** — the one public renderer:
  `<picture class="aspect-…"><source type="image/avif" srcset sizes><img src
  srcset sizes width height alt loading decoding></picture>`, over the same
  `RATIO_CLASSES` box the placeholder reserved, `object-cover` inside it (the
  browser crops within the frame; nothing on disk is cropped), the placeholder
  when the model is `null`. Plain server HTML; no `next/image`, no proxy, no
  request-time transformation, no JavaScript. `loading="lazy"` everywhere except
  the article's own image and the first card on `/menu` and `/nyheder`.

### Alt semantics (brief §8, §28)

The library owns `alt_text`; entities store only `image_id`. The current
description renders on every surface; a null or blank description renders
`alt=""` — every slot sits beside the text that names the thing, so an
undescribed photo is decorative repetition for a screen reader, and copying the
dish's name into `alt` would be the duplicate verbose text the accepted model
refuses. No name, filename or keyword is ever copied into a description. axe
(WCAG 2.2 A/AA) passes on `/`, `/menu`, `/nyheder` and the article at 375 and
1440 with real photos in place.

### AVIF, WebP and the browsers (brief §6)

AVIF is offered through `<source>`, WebP is the `<img>`; a browser that decodes
neither gets the placeholder's box with the alt text, never the private
original. Every browser the project supports (current Chromium, Firefox and
Safari lines) decodes WebP; there is no JPEG derivative by design (§0t), so the
same holds for the Open Graph image, which is WebP. Recorded for the final SEO
pass to re-weigh against crawler support at launch.

### Candidate selection, measured (brief §41)

At 375 and at 1440 the dish card, the featured card and the monthly card fetch
exactly one candidate — the 480 rung — for a 2560 px source that carries all four;
the article fetches 480 on a phone and 960 on a desktop; no request names the
2160 rung for a card, the private bucket, or the same image twice (asserted in
`public-images.spec.ts` from the browser's own request log).

### Draft Mode (brief §9)

By construction: the overlay runs before the projection, so live A + draft B
previews B while the guest keeps A; live A + pending removal previews the
placeholder while the guest keeps A; live null + draft B previews B. No separate
preview image logic exists. A draft article previews its row's current image and
carries no `og:image` and no JSON-LD (§7f).

### News metadata (brief §14–§16)

A published article with a valid image carries `og:image` (with `og:image:width`,
`og:image:height` and, when authored, `og:image:alt`) and a `NewsArticle`
`image` `ImageObject` — both from `seoImageOf()`: the smallest WebP rung at or
above 1200 px, or the largest available, on the storage origin (the site's own
URLs still resolve through `lib/config/site.ts`). The visible image, the
`og:image` and the JSON-LD name the same row. An article without an image
carries **no** `og:image` and no `image`: §11's branded fallback card is still
not supplied, so it is omitted, not invented. The sitemap is unchanged —
membership is publication, never an image.

### The cache coupling (brief §17–§24) — one mapping, the database's own set

- **Reference kind → tags** lives in `lib/images/cache-impact.ts` and is read
  from the publishing registry: `dish → menu` (the Forside's featured cards come
  from the same `menu`-tagged read), `weekly → weekly`, `monthly → monthly`,
  `news → news` (list, article, teaser, metadata, sitemap). Nothing is
  invalidated globally; contact, hours and the page documents are never touched.
- **Delete and replace** (migration `20260901220000`) — `delete_image()` and
  `replace_image()` now return `affected`: per-kind counts of the rows their own
  live statements moved (`RETURNING` inside the one transaction, behind the FOR
  UPDATE lock), split into `live` (a published dish that is not soft-deleted,
  the singletons, a published article) and `draft` (draft keys, a soft-deleted
  dish, an unpublished article). Under READ COMMITTED an UPDATE re-evaluates on
  the newest committed row, so a reference a concurrent publish made live is
  counted by the statement that moved it — the race a pre-read in another
  transaction could lose (brief §22). `delete_image()` detaches `news.image_id`
  explicitly (the FK had done it as the owner, uncounted). Refused transitions
  carry no `affected` key. SECURITY INVOKER kept; the 023 guard, its marker and
  every grant and policy unchanged; every existing reply key unchanged, so pgTAP
  020–023 pass as they were.
- **Alt edit** — the description stays the one direct column write (§0t's
  grant), so `saveImageAltText` reads `image_references` *after* its successful
  UPDATE and reports the live kinds' tags; a reference published later is
  rendered by the publish that makes it live. A failed post-write read falls
  back to the four entity tags — bounded, never global.
- **Order** — the wrappers expire after the commit and **before** the storage
  cleanup (through an injected `PublicCacheEffects` door the Server Action hands
  them), so the first guest request after a replacement never meets cached HTML
  whose derivative URLs are about to 404. Draft-only references expire nothing.
- **Publish** — unchanged: the entity's own tags carry the image live. News:
  the published-save `news` expiry 10C-1 wired carries an image change.
- **Undo** — replacement has no Fortryd (10B); nothing to couple.

### Private originals (brief §25, §40)

`media-originals` is named in `lib/images/rules.ts` alone and reached only by
the server storage module; the public model cannot compose an original's URL;
the guest HTML of every surface, the Draft Mode preview and the news metadata
contain only `media` derivative URLs — asserted in the policy suite, the unit
suites and every E2E story.

### Tests

- **Unit** (+68 in 5 new files, plus the extended policy, admin, SEO and fixture
  suites): the model and its refusals, the srcsets, the fallback, the
  dimensions, the alt rule, the sizes map, the reference-kind mapping, live vs
  pending, the affected-set schema, the OG image and its omission, the JSON-LD
  image, the same-asset rule, the Draft Mode projection, the renderer's markup,
  and the wrappers' expiry order. The policy suite now pins the private bucket's
  one namer, the two `<picture>` renderers, the one model composer, no raw
  public `<img>` beyond the static map, no entity-owned alt field and no image
  proxy.
- **pgTAP** `024_image_cache_impact.test.sql` (49 assertions): both transitions'
  `affected` replies from real Staff, Owner and anonymous JWTs — the refused
  transitions carry none; a confirmed delete over a live dish, a soft-deleted
  dish, the weekly singleton, a monthly draft, a published and a draft article
  reports exactly what a guest could see; draft-only and unreferenced images
  report live zeros; a multi-entity replacement reports its counts and moves
  every reference; the 023 guard still refuses Staff and Owner afterwards;
  unrelated content is byte-identical.
- **Integration**: the 12 tests kept; the pipeline test now also proves the
  public model over the real row names only URLs that serve, in both formats.
- **E2E** `public-images.spec.ts` under exactly `public-images-mobile` and
  `public-images` (14 stories each): the dish draft → placeholder → preview →
  publish on the first request → one candidate fetched → no-JS → alt edit →
  global replacement → weekly (pending, published, pending removal) → monthly
  (menu card and Forside feature) → news (draft 404 + preview without claims,
  publish with `og:image` = JSON-LD image, list and teaser, published image
  change, unpublish) → confirmed deletion → the seed restored. The 10C-1
  boundary test now asserts the preview renders the pending photo.

### Recorded for the FINAL SECURITY AUDIT (phase 13) — carried forward

The signed-upload token's lifetime and session-unboundness (§0t, §0u); the
service-role boundary; never-finalized private originals; best-effort storage
cleanup; `replace_image()` accepting any successor; the published-image guard
architecture (§0w). New from this phase: the alt-edit expiry rests on a
post-write read rather than a transition (the bounded fallback above); the
`affected` counts include a soft-deleted dish under `draft` and treat any
published article as live; and a public derivative that 404s (a cleanup that
raced a cached page inside the five-minute net) shows the alt text in a stable
box — there is no client retry, by design.

### What phase 10C-2 deliberately does not contain

A JPEG fallback or any public original; an image proxy, `next/image` or a
request-time transform; an image sitemap extension; the date-circle news card
and the "uden foto" weekly card (lock pass); crop controls; a second alt store;
a generic responsive-image framework; any `pages`-document image (phase 11).

### The regression

From a clean tree: `npm ci`, `npm run db:reset:full` (the new migration applies
cleanly), a fresh production build from an emptied `.next`. Typecheck, lint and
the source policy clean; **2,368 unit tests in 88 files** (+68 in 5 new files,
plus the extended policy, admin, SEO and fixture suites); **1,643 pgTAP
assertions in 24 files** (+49 in `024`), from real anonymous, Staff and Owner
JWTs; **12 integration tests in 3 files**, one extended; `npm audit
--audit-level=high` clean (0 vulnerabilities); `npx playwright test --list`
collecting **1,101 tests in 29 files**, with `e2e/public-images.spec.ts` under
exactly `public-images-mobile` and `public-images` (the §29 check); and the
full Playwright matrix at `--retries=0`, run as the chunked chain (the
read-only trio together, every write project in its own invocation, in config
order, against one detached production server): **1,094 passed, 7 deliberately skipped (width/device guards), zero failed and zero flaky** on the final run of every project.

Recorded honestly: the chain was the first ever to run on a **Wednesday**, and
seven assertions in four locked suites (`opening-hours`,
`opening-hours-override`, `opening-hours-announcement` and the a11y
`hours-admin`) turned out to hold only on the seeded closed weekdays. None was
a product defect: a fresh one-off change for an *open* day composes a message,
so 1t's "Vis også som besked" option and its suggestion stand on the one-off
card exactly as 8C-3B designed — and six page-wide "no checkbox / exactly
seven checkboxes / no such text" claims about the *weekly* card had been
reading the whole screen; the seventh was a `\w+` that cannot match "lørdag". Each is now scoped to the form it
is about, opened on a seeded closed day where the 8B-era claim is the honest
one, or written with `\p{L}`; nothing in the product changed. The affected
projects were re-run green in place, and the read-only trio was re-run at the
end of the chain, after Copenhagen midnight, so every result reported above
comes from the same calendar day. Phases 5–10C-1 ran green behind it,
unchanged; the public cache is still 5m/5m, no tracking cookie and no browser
Supabase client appeared, and no private-original URL reached any public
surface.

### Remaining phase-10 lock-pass scope

Read 10A–10C-2 as one system; walk upload → select → preview → publish →
describe → replace → delete as Owner, Staff and guest against a production
build; decide the two no-image frame variants above; re-check 1w/1r/1ag/1ah/1s
and the public frames at 375/768/1440 once more; review the four SQL
transitions and the two markers as a set; then record §0y and mark phase 10
locked.

*(Done — see §0y, the phase-10 completion pass of 2026-09-02.)*

---

## §0y. Phase 10 — complete and locked (2026-09-02)

The four increments — 10A (§0t), 10B (§0u), 10C-1 (§0v, hardened in §0w) and
10C-2 (§0x) — were read as one system, walked end to end against a production
build as Owner, Staff and guest, reviewed as one security/cache/storage boundary,
and certified by one clean regression chain. **Phase 10 is complete and locked.**
This section is the current truth of the image system in force; §0t–§0x remain
the record of how it was built and are not rewritten.

### The image system, stated once

| | The rule in force |
|---|---|
| **Two buckets** | `media-originals` (private; validated originals at `<upload-uuid>/original.<jpg\|png\|webp>`; 10 MiB and three MIME types enforced by the bucket) and `media` (public; derivatives only at `<upload-uuid>/<width>.<avif\|webp>`, immutable, cached for a year). `storage.objects` has no policy for `anon` or `authenticated`; the private bucket is named in `lib/images/rules.ts` alone. |
| **Accepted input** | JPEG, PNG, WebP — sniffed from the bytes by sharp, never from the filename or the declared type. SVG, GIF, TIFF, AVIF/HEIC inputs and any animation (`pages > 1`) are refused; a sniffed type that contradicts the stored extension is refused whole. |
| **Limits** | 10 MiB per original (bucket, `IMAGE_LIMITS`, `create_image()`); 30 megapixels decoded and 10 000 px per side (`limitInputPixels` on every decoding pipeline, restated by the sniff classification and by SQL); alt text at most 300 characters, no control characters. |
| **Derivatives** | AVIF (q 55) + WebP (q 80) at 480 / 960 / 1440 / 2160, filtered to the source width, never upscaled, the source width alone below 480; orientation baked in; **no metadata copied** — EXIF including GPS, XMP and thumbnails do not survive. `images.derivatives` stores measured formats and per-rung dimensions only; every path derives from the row's `storage_path` through one function. |
| **Signed upload** | `requireStaff()` → server mints `<uuid>/original.<ext>` and one signed token for exactly that path in the private bucket (upsert pinned false; SDK-fixed two-hour lifetime, asserted) → the browser downscales to ≤ 2560 px with `<canvas>` and PUTs once → `finalizeImageUpload()` downloads the bytes back, sniffs, decodes, renders and writes every derivative, and only then creates the row through `create_image()` with the caller's own JWT. The browser contributes the declared type, a display filename and the server-minted path; nothing else it says is authoritative. |
| **The doors** | `create_image()` (replay-safe on `storage_path`), `delete_image()`, `replace_image()` — SECURITY INVOKER, `search_path` pinned, audited, recognised by the transaction-local `app.image_write` marker; INSERT/DELETE refused for browser roles otherwise; UPDATE narrowed to a column grant on `alt_text`. |
| **Library (1w)** | `/admin/billeder` for Staff and Owner: upload, grid with usage captions, detail panel, the description edit, Erstat and Slet. Staff never see sizes, formats or pixel measurements. |
| **Alt ownership** | `images.alt_text` is the one person-authored column and the one alt store; entities store only `image_id`, so one description serves every usage. Null/blank renders `alt=""`; no name, filename or keyword is ever copied into it. |
| **References** | `public.image_references` (SECURITY INVOKER view): the four live `image_id` columns and the three draft `image_id` keys, each `(image_id, kind, entity_id, name, pending)`. The one definition read by `delete_image()`'s refusal, the confirmed detach, the library's captions and the alt-edit expiry. A soft-deleted dish's live column is a reference (the caption agrees with the refusal). |
| **Delete** | Version-checked behind FOR UPDATE; refuses `in_use` with the live+draft count unless confirmed; a confirmed delete clears exactly the `image_id` key from every draft (an emptied draft becomes NULL), detaches the three guarded live columns under `detach` and the news column, removes the row, audits with the content and the reference counts, and returns `storage_path` plus `affected`. Files are removed after the commit. |
| **Replace** | The successor is uploaded and finalized completely first; `replace_image(old, expected, new)` repoints the four live columns (`replace`) and the three draft keys old→new, removes the old row, audits once with both storage paths, and returns `affected`. The old files go only after the commit; the successor inherits no description. |
| **Editor selection** | One pair — `ImagePickerField` / `ImagePickerDialog` — in the dish (1r), Ugens ret (1ag), Månedens burger (1ah) and news (1s) editors. A picker submits the version token and an image id (or empty for "Fjern billede") and nothing else; the server verifies the image exists for the caller before any write. |
| **Draft / live** | dish, weekly, monthly: `draft->'image_id'` is the pending selection (`null` a pending removal, absent no change) and the phase-4 publish merge moves it live; a guest keeps the published image until Offentliggør and no draft write expires a tag. News: no draft layer — the column, through the one news save path; public when the article is. |
| **Published-image guard** | `dishes`, `weekly_special`, `monthly_burger`: a BEFORE INSERT/UPDATE OF `image_id` guard refuses any movement of the live column from `anon`/`authenticated` unless the statement-scoped `app.image_reference_write` marker names `publish`, `replace` or `detach`; an AFTER STATEMENT trigger spends it. Owner is refused exactly as Staff. `news.image_id` is unguarded by decision (phase 9's direct-edit model). |
| **Public rendering** | One model (`buildPublicImage`), one projection inside each tagged read (`readPublicImages`), one renderer (`SiteImage`): `<picture>` with an AVIF `<source>` and a WebP `<img>`, `srcset` over the measured rungs only, `sizes` per slot from `IMAGE_SIZES`, intrinsic width/height, `object-cover` inside the reserved aspect box, `loading="lazy"` except the article image and the first card. Plain server HTML: no `next/image`, no proxy, no request-time transform, no JavaScript. A malformed record is `null` — the no-image state, never a guessed URL and never the original. |
| **Cache coupling** | `lib/images/cache-impact.ts` maps a reference kind to the publishing registry's tags (dish → `menu`, weekly → `weekly`, monthly → `monthly`, news → `news`). Delete and replace expire the tags of the `affected.live` counts their own statements returned; the alt edit expires the live kinds `image_references` reports after its write; every expiry runs after the commit and before the storage cleanup; draft-only movement expires nothing; nothing is expired globally. |
| **News image SEO** | A published article with an image carries `og:image` (+ width, height, and alt when authored) and a `NewsArticle` JSON-LD `ImageObject`, both from `seoImageOf()` — the smallest WebP rung ≥ 1200 px or the largest available — as an absolute URL on the storage origin; the visible image, the tag and the block name one row. A draft preview carries neither; an article without an image carries neither (no fallback asset is invented). |

### The lock-pass walkthrough (production build, `next start`)

As **Owner**: upload (2560×1600 → all four rungs measured) → the library → the
description → Vælg billede on Odin as a draft (guest on the placeholder, Draft
Mode preview on the pending photo at 1440 and 375) → Offentliggør → the first
guest request at 375, 768 and 1440 carries the photo on `/menu` and on the
Forside's featured card from the derivative ladder alone (one candidate fetched,
the 480 rung, never the 2160 rung, no cookie, no private bucket, no original
path, no signed URL, no service-role value, no filename in the HTML; the same
markup with scripting off) → a second description reaches the first request →
Erstat A→C reaches the first request with A gone from the HTML and A's files
gone from storage → a confirmed Slet with the warning naming Odin returns the
first request to the reserved frame, content intact, C's files gone. The same
mechanisms were then walked on Ugens ret (pending B previews, publishes on the
first request, a pending removal previews as no photo while the guest keeps B,
and publishes to 1af's "uden foto" card), Månedens burger (the menu card and the
Forside feature), and News (a draft article with a date previews the 1j/1n date
circle, a chosen image previews with no `og:image` and no JSON-LD, publish puts
the image, `og:image` and the JSON-LD `ImageObject` — the same absolute
derivative — on the first request, the list and the teaser follow, unpublish
removes all of it). The seed was restored at the end: an empty library, no
reference anywhere, no article, the burger empty.

As **Staff**: upload, finalize, describe, choose for Thor, preview, publish,
Erstat, and Slet with the warning naming Thor — every image capability, with no
Owner-only refusal anywhere in image management. And no widening: Staff still
cannot reach the Forsiden editor, publish an Owner entity from the dashboard, or
write a live `image_id` by hand (pgTAP `023`).

As a **guest**: only published image state; a pending draft never leaked;
every image request was a `media` derivative; `media-originals`, signed URLs and
the service role appeared nowhere; alt matched the authored description; the
candidate the browser picked matched the slot (480 for every card at both
widths, 480/960 for the article on a phone/desktop); the no-image states
rendered as decided below; zero cookies on every public response.

### The two no-image frames — decided: **A**, required states, built

Read from the design file directly rather than from the implementation:

- **1j / 1n** draw a second news card whose photo column holds a **date circle**
  ("24" over "DEC") with the frame's own words — *"Nyheder uden billede får en
  datocirkel i stedet — layoutet falder ikke sammen"* (1j) and *"Tekstnyhed uden
  billede"* (1n). Phase 3 had already built `formatDateCircle()` for exactly
  this card and deferred the card itself to "the phase that can tell the two
  articles apart". It is contractual. `NewsCard` now renders the circle for an
  article with no image and a display date — centred in the photo column with
  the column's right rule from `md`, a smaller circle beside the text on a phone,
  `aria-hidden` because the meta line's `<time>` already speaks the date — and,
  for an article with neither image nor date, nothing in the slot at all (the
  frame draws no such card; the text takes the width rather than inventing one).
  The Forside teaser (1g/1l) draws no no-image variant and keeps its reserved
  frame, which is what those frames draw.
- **1af** is the *states* frame for Ugens ret, and its "UDEN FOTO · UDSOLGT" card
  says *"Uden foto flytter teksten helt ud til kanten — der efterlades ikke en
  tom billedplads."* Contractual. `WeeklySpecial` now renders no image column
  when `image` is null: no `<picture>`, no reserved frame, the text at the
  card's edge at every width.

A third sentence was found and is recorded rather than built: 1r's caption
*"uden foto vises retten som en ren linje med navn, beskrivelse og pris"*
describes a dish without a photo on the public menu. It is a caption on an
admin frame; the public frames (1h, 1m, 1g, 1l) draw every burger with the
reserved 4:3 / 1:1 frame and no photo-less burger card, and the Forside's three
featured cards (1g) have no line variant at all. The reserved frame is therefore
what the approved public frames draw for a burger without a photo today, and the
dish, the Månedens burger card and the news teaser keep it. When the restaurant's
photography lands (phase 14 owns the remaining placeholders), the "ren linje"
sentence is the open design question to settle for burgers that stay without
one — noted for that pass, not decided by convenience here.

`public-images.spec.ts` now asserts both built states (the seeded list's date
circles, the draft article's circle in the preview, and the weekly card without a
slot for the guest and the preview), and `tests/unit/site/no-image-cards.test.tsx`
pins the markup.

### The alt-edit post-write read — classified: harmless, documented

The description is the one column write without a trusted transition, so
`saveImageAltText` reads `image_references` *after* its UPDATE commits and
expires the live kinds it finds. Between the write (`t_w`) and the read (`t_r`)
an entity can change its use of the image; every such change is itself a
transition that expires the entity's own tags after its own commit:

- **A — the entity stops using the image** (publish of a pending removal,
  `replace_image()`, a confirmed `delete_image()`, a dish soft-delete, a news
  unpublish or a published news save). The read misses the reference and
  expires nothing for it; the transition that removed it expires the tag
  itself. Whether that expiry ran before or after `t_w`, every page rendered
  after it renders the entity without the image, so no page carrying the old
  description and the image can be served.
- **B — the entity starts using the image live** (publish of a pending
  selection, `replace_image()` onto this image, a published news save). If it
  commits before `t_r` the read sees it and expires the tag (redundantly with
  the transition's own expiry). If it commits after `t_r`, the transition's own
  expiry re-renders the entity from the database, which already holds the new
  description (`t_w` < its commit).
- **C — a pending use publishes concurrently** is case B through `publish_*()`.

A failed post-write read falls back to the four entity tags — bounded, never
global. The one thing none of this changes is the platform's own bound: a
render already in flight when a tag expires can store a page a few hundred
milliseconds old, for every publish in this system alike, and §7a's five-minute
net is what bounds it. **No stale-cache case survives the entity's own
publication invalidation; no change was made.**

### Delete and replace: the affected set is atomic and honest

Both transitions count `affected` from the `RETURNING` of the statements that
moved the rows, inside the one transaction, behind the FOR UPDATE lock on the
image row. A refused transition (`not_found`, `conflict`, `in_use`,
`invalid_replacement`, `missing_replacement`) returns no `affected` key and the
wrappers expire nothing. A publish that would make a pending reference live
*during* a delete waits on the image row's lock at its FK check and then meets
either a version conflict (the draft detach touched its row) or a refused
foreign key — it cannot commit a reference to a row that is gone. After the
commit the wrappers expire the tags first and remove the files second, so the
first guest request never meets cached HTML whose derivative URLs are about to
404. Walked in production for both: the first request after Erstat carried the
successor everywhere; the first request after Slet carried the frame.

### The soft-deleted dish in `affected` — exact, not conservative

A soft-deleted dish renders nowhere: `dishes_select_public` excludes it for
`anon`, and the preview path restates `deleted_at is null` for the staff JWT.
Counting its live column under `draft` therefore expires no `menu` tag for a
row no guest could see — the exact answer. Restoring a dish is its own
transition (`set_dish_deleted()` with the menu expiry in `delete-actions.ts`),
and a restored dish that lost its image to a delete has `image_id = null`
already. Nothing to change; recorded as exact.

### `replace_image()` accepting any successor — acceptable, carried forward

A Staff member may already choose any library image for any entity and
publish it, and may Erstat any image with a fresh upload — which changes every
live usage at once, audited as `replace` with both storage paths and expired
through `affected`. Pointing the same transition at an already-existing image
adds no authority that combination lacks: the old row leaves through the same
guarded door, the successor must be a finished `create_image()` row, the audit
names both, and the cache is expired exactly. Not tightened; re-weighed at the
final security audit with the rest.

### The `ON DELETE SET NULL` measurement — unchanged, still pinned

PostgreSQL runs a referential action as the table owner, so the guard steps
aside for it exactly as for a migration; `023` pins that measurement so a change
fails a test. `delete_image()` still detaches the three guarded columns and the
news column explicitly, so the transition is readable where it lives and the
counts are the statement's own; the FKs remain the last resort and are never
relied on for the counts.

### Storage cleanup and orphans — accepted best-effort, recoverable

Every failure branch of finalize removes what it wrote (the integration suite
proves garbage, a declared-type lie and a refused RPC leave no row and no
files). After a committed delete or replace, file removal is best-effort:
integrity never rolls back for a failed removal, the failure is logged per path,
the audit row names the storage path every derivative path derives from, and no
entity reference is left behind. An upload that is never finalized leaves one
original at an unguessable UUID path in the private bucket: no row, no public
read policy, no way into the public model. Both are operational cleanup debt for
the final security/operations checklist, not launch blockers.

### The literal NUL — cleaned

`usageDisplayNames()` in `lib/images/library.ts` keyed its place map with a
template literal whose separator had landed on disk as a literal NUL byte
(`\x00`). The kind is a closed word list with no colon, so the key is now
`` `${kind}:${name}` `` — readable, unambiguous, behaviour-preserving (the
caption suite passes unchanged). No other control byte exists in the tree.

### Code quality — reviewed as one slice

No duplicated image rule (limits in `rules.ts` and SQL only, by design); no
storage detail in React; no component builds a path (policy suite); one
reference definition; two markers with distinct, non-substitutable jobs
(`023`); one cache-impact mapping; one derivative parser
(`readDerivativeRecord`) shared by the admin thumbnail and the public model;
one SEO image choice (`seoImageOf`); no circular import; no dead helper of
substance (the unreferenced exports are types and pure functions the unit
suites exercise); stale comments corrected where the no-image decision changed
them. Nothing else was rewritten.

### Recorded for the FINAL SECURITY AUDIT (phase 13) — carried forward, deliberately

1. The signed upload token: two-hour SDK-fixed lifetime, bound to one path but
   not to the requesting session (§0t, §0u).
2. The service-role storage boundary: one importer (`lib/images/storage.ts`),
   capability-shaped, server-only, no route exposure (policy suite).
3. Never-finalized private originals (above).
4. Best-effort post-commit storage cleanup and the orphans it can leave (above).
5. `replace_image()` accepting any existing successor (above).
6. The published-image marker architecture (`app.image_write` row-consumed,
   `app.image_reference_write` statement-scoped; §0w).
7. The alt-edit post-write read and its bounded fallback (above); the
   `affected` accounting (soft-deleted dish under `draft`, any published article
   as live); a public derivative that 404s inside the five-minute net shows the
   alt text in a stable box with no client retry.
8. Not security, for the code-quality/correctness audit: the sold-out guard
   validates every changed `sold_out_on` for every role with no owner
   step-aside (§0w) — re-confirmed here: `023` proves replace and a confirmed
   delete on a dish carrying a five-day-old sold-out date go through untouched.

### The regression — one clean chain

From a clean tree: `npm ci`, `npm run db:reset:full`, `.next` emptied, a fresh
production build, no stale server. Typecheck, lint and the source policy clean;
**2,373 unit tests in 89 files (+5 in one new file, `no-image-cards`)**; **1,643 pgTAP assertions in 24 files, unchanged**, from real anonymous, Staff and Owner JWTs;
**12 integration tests in 3 files** (the 29.7-megapixel certification finalized in 1,777 ms on the current code path, against the 60 s route budget); `npm audit --audit-level=high` clean (0 vulnerabilities);
`npx playwright test --list` collecting **1,101 tests in 29 files across 54 registrations**, with each of the three
image suites under exactly its own dedicated pair and nothing under the generic
projects; and the complete Playwright matrix at `--retries=0`, run as the
chunked chain against one detached production server (the read-only trio
together, every write project in its own invocation, in config order):
**1,094 passed, 7 deliberately skipped (width/device guards), across 34 invocations** — zero failed, zero flaky, no retry, no chunk assembled from a
different chain. Phases 5–9 ran green behind it, unchanged: the menu, the
weekly/monthly editors, the manual and generated announcements, the opening
hours and the news administration; the public cache is still 5m/5m, no tracking
cookie and no browser Supabase client appeared, and no private original reached
any public surface.

**Phase 10 is locked.** Phase 11 (§15) — the remaining editors: Forsiden, Mad ud
af huset with its visibility toggle, Kontaktoplysninger, and `/admin/brugere` —
is next. *Its first increment, 11A (Forsiden), is built and recorded in §0z.*

---

## §0z. Phase 11A — Forsiden administration (2026-09-02)

The Owner can now edit the approved Forside content through the existing `pages`
document architecture — 1u's four cards, the three photographs through phase 10's
picker pair, Kladde → Forhåndsvis → Offentliggør through phase 4's machinery — and
the image reference model, the published-reference guard and the two image
transitions know about a document that owns images. **Phase 11 is not locked**: 11B
(Mad ud af huset, 1aj) and 11C (Kontaktoplysninger, 1v, and `/admin/brugere`) are
not started, and a lock pass over the three is the step after them.

### What phase 11A contains

| Capability | Path | Where it lives |
|---|---|---|
| The editor at `/admin/forsiden` (1u): "Øverst på siden", "Udmærkelsen", "Udvalgte burgere (vælg 3)", "Om os (uddrag)" | Kladde → Forhåndsvis → Offentliggør (§6) | `app/(admin)/admin/forsiden/`, `components/admin/home/` |
| The three photographs — "Hovedbillede", "Udmærkelsesfoto", "Holdfoto" — through the shared picker pair | draft | `image-actions.ts`, `ImagePickerField` (a `label` prop), `ImagePickerDialog` unchanged |
| The featured list — add from the menu, change, remove, move — as ids, never names | draft | `featured-actions.ts`, `HomeFeaturedEditor`, `HomeDishPickerDialog` |
| The document's rules: normalisation, the per-section delta, the list controls, the sentences | — | `lib/pages/home.ts` (pure) |
| The admin read: the merged document beside the published one, uncached, through the caller's JWT | — | `lib/content/home-admin.ts` |
| The public Forside rendering the three photographs from the derivative ladder, inside the `page:home`-tagged read | — | `lib/content/pages.ts` (`readHomeDocument`), `HomeHero`, `AwardBand`, `NewsAndAbout` |
| `image_references` with the Forside's six paths; `delete_image()` / `replace_image()` over the document; the published-path guard on `pages`; `publish_page()` under the marker | — | `20260902120000_homepage_image_references.sql`, `lib/images/cache-impact.ts` (`page:home`) |
| The dashboard's "Rediger forsiden" tile, Owner only; the phase-4 content screen hands the Forside over | — | `app/(admin)/admin/page.tsx`, `indhold/editors.ts` |

### The `page:home` model — exact

One row of `pages`, `key = 'home'`, the phase-1 row. Identity is the key; the
registry locates it (`instance: keyed`) and the browser never names it. `published`
is the live document, `draft` holds whole top-level sections merged shallowly at
publish (`published || draft`), `updated_at` is the version token every form
submits back, `publish_page()` is the one publish function, the tag is `page:home`,
and §5's matrix row is Owner — enforced three times over: `requireOwner()` in the
page and in every Server Action, `mayChangeEntity` inside `saveEntityDraft` and
`publishPendingChange`, and `pages_update_scoped` (`public.is_owner()` for the
`home` row) in the database. The document, as `homeDraft` states it:

```
hero            { heading, intro,  image_id }
award           { title,   text,   image_id }
featured_dish_ids [ uuid × ≤3, distinct ]
about_excerpt   { heading, text,   image_id }
```

Every section key is required (a value may be `null`, never missing), because the
shallow merge replaces a whole section — a draft section without `image_id` would
silently drop the live photograph. `image_id` is the only image fact stored: no
path, no derivative, no alt (the library owns the description, §0y). A stored draft
the phase-4 editor wrote (no `image_id`) is therefore **malformed** to this schema:
not applied, refused at publish as `invalid_draft`, and said out loud on the
screen. None existed in any seed.

### Readings this phase had to settle

| # | Question | The answer |
|---|---|---|
| A | **Does the Om os excerpt carry a heading?** §4 wrote `about_excerpt {text, image_id}`; 1u draws one text box. | **Yes.** The public frame 1g draws it ("Lokal burgerbar i Carl Nielsen Hallen"), the seed has carried it since phase 3 and `NewsAndAbout` renders it. 1u's single box is the admin frame's simplification, not a removal of public content, so the card draws Overskrift and Tekst; §4's shape is corrected in place. |
| B | **Gem or autosave?** 1u draws neither — its bar carries Forhåndsvis and Offentliggør, its fields the Kladde badge. | **Explicit Gem, one per card.** This administration has one saving convention for a draft editor (1t, 1ag, 1ah, 1ad), and the frame states no autosave. A draft holds whole sections, so each card saves its own section and nothing about the other three. |
| C | **What is the delta for a document?** §4 says a draft holds only the changed fields; a page draft holds sections. | **Per section.** A submitted section equal to the published one leaves the draft (`clear`), a different one is written whole — with the slot's *current* image from the merged document, so a Gem of the words never wipes a pending photo, and choosing the photo that is already live takes the section back out. `homeSectionWrite` / `featuredDishesWrite`; the Kladde badge and the band name exactly the sections the stored draft changes. |
| D | **What does a confirmed delete do to a page draft that names the image?** The column entities drop the `image_id` key. | **The pending path returns to the published value**, because a section cannot lose a key; a section that then equals its published section leaves the draft, and an emptied draft is NULL. Live A + draft B, delete B → live A, draft back to A (and gone, if nothing else differed); delete A → live null, pending B stays; A live and pending → both clear. Proved in pgTAP `025`. |
| E | **Who may delete or replace an image the Forside uses?** Images are Staff-editable in full (§5); the Forside is not. | **The Owner.** Both transitions are SECURITY INVOKER and spend the caller's UPDATE privilege on `pages`, which RLS grants the Owner alone — a Staff member's confirmed delete would detach everything else and leave the Owner-only document holding a dangling id (§7e item 4 rules that out), and SECURITY DEFINER is refused (§0l reading A). So `delete_image()` and `replace_image()` return **`owner_only`** for a non-owner before any write, and the library says so where Erstat and Slet would be. That is §0a D1's rule for dishes applied to images. |
| F | **Should a direct write of a published Forside image be guarded like the three columns (§0w)?** | **Yes, narrowly.** A BEFORE UPDATE OF `published` guard on `pages` refuses `anon`/`authenticated` when one of the **three image paths moves** and the statement-scoped `app.image_reference_write` marker names no transition; `publish_page()` raises `publish` around its merge; replace and detach raise theirs. A text-only write of `published` is exactly the write it was (003's Owner assertion stands), and the Owner is refused a bypass exactly as Staff. |
| G | **The drag handle 1u draws on each featured slot.** | **Two move buttons**, the phase-5F precedent for a short fixed list (the Tapas groups) — not a second drag engine. Recorded as a departure. The dish picker is the image picker's pattern over the menu: a URL-opened modal, every dish a submit button, an already-featured dish disabled and marked "Allerede valgt". |
| H | **Which dishes may be featured?** | Any dish the menu has that is not soft-deleted, verified through the caller's own JWT before the id is written (draft JSON has no FK). A *published* reference to a since-deleted dish is left where the Owner wrote it (§0a D1) and drawn as a slot that says so, with Fjern beside it. |
| I | **Reference kind for the cache coupling.** | A fifth kind, `page:home`, in `image_references` and in `lib/images/cache-impact.ts` (kind → the registry's `page:home` tag). `affected` from both transitions gains a `page:home` count; a draft-only page reference expires nothing, a live one expires `page:home` alone. |

### Draft → Preview → Publish, and the cache

A save writes `draft` and expires nothing; a guest keeps the published document.
Forhåndsvis opens the real Forside through Draft Mode, where `readHomeDocument`
overlays the draft *before* projecting the three image ids, so a pending photograph
previews from the same derivative ladder the guest will get — while Månedens
burger, "Tre fra menuen"'s names and prices, the news teaser, the opening hours and
the announcement come from their own reads and reflect their own current state.
Offentliggør publishes this screen's one entity through `publishPendingChanges`
(the stored draft re-validated against `homeDraft` first) and expires `page:home`
after the commit; the first guest request carries the new heading and the new
photograph. A library alt edit, a replacement or a confirmed deletion that touches
a **live** Forside image expires `page:home` through the centralized mapping; a
pending one expires nothing.

### Boundaries kept

- **Dynamic content stays entity-driven.** The document holds three dish ids and
  nothing about them; Månedens burger, the teaser, the hours, the badge and the
  announcement are untouched and are read from their own tagged entries.
- **No raw HTML, no Markdown, no link field.** Two plain-text fields per card,
  three image ids, three dish ids. The Forside has no configurable CTA; `Se
  menuen`, `Vis vej` and the phone action are the page's own.
- **The copy is the document's.** The seed's placeholder Danish is rendered as
  written; nothing was reworded.
- **One picker, one renderer, one reference definition, one cache mapping.**
  `ImagePickerField` gained a `label` prop and nothing else; `SiteImage` renders all
  three slots in the boxes the placeholders reserved; `image_references` is still
  the one truth; `cache-impact.ts` is still the one mapping.
- **Phase 10's guards are intact.** `023`/`024` pass unchanged in behaviour; the new
  guard reuses the marker and the consumer, and no SECURITY DEFINER appeared.

### Tests

- **Unit** (+3 files): `tests/unit/pages/home.test.ts` (normalisation, the two
  deltas, the five list controls, the sentences), `home-forms.test.ts` (the three
  vocabularies, the refusal codes, the echo), `tests/unit/home/home-images.test.tsx`
  (the three slots rendered, eager hero, the reserved frames); the schema suite
  (image key required, nested unknown keys dropped, duplicates refused), the
  cache-impact, library, admin and policy suites extended.
- **pgTAP** `025_homepage_image_references.test.sql` — **102 assertions** from real
  Owner, Staff and anonymous JWTs: structure, the six view rows, the guard (Owner
  refused a moving path, Staff zero rows, text-only writes allowed, publish under
  the marker, stale publish writes nothing, marker spent), the §19 delete matrix
  with byte-identical unrelated keys, the replacement matrix with `affected`,
  `owner_only` for Staff on both transitions, audit, unrelated content. `024`
  re-pinned with the fifth count.
- **E2E** `tests/e2e/homepage-admin.spec.ts` under exactly `homepage-admin-mobile`
  and `homepage-admin` (23 stories each): the §26 Owner story end to end, the
  library lifecycle over a Forside image, the Staff denial (tile, address, forged
  action, direct row writes), the Owner's own direct published-path write refused
  (42501), and the seed restored. `tests/a11y/homepage-admin.spec.ts` under
  `desktop` and `mobile`. `draft-publish` and `menu-delete` now reach the Forside
  through 1u rather than the retired phase-4 form.

### Recorded for the FINAL SECURITY AUDIT (phase 13)

- A nested unknown key inside a section is **stripped** (the phase-4 section
  shapes are `z.object`), not refused; the top level is strict. Nothing but the id
  can reach the draft, and it is recorded rather than tightened.
- `readAdminImage` is called once per image the screen shows (≤ 6 point reads);
  the library is read whole only while a picker is open.
- The standing image findings (§0y) carry forward unchanged; the alt-edit
  post-write read now also names the `page:home` tag when the Forside uses the
  image.

### The regression

From a clean tree: `npm ci`, `npm run db:reset:full` (the new migration applies
cleanly), `.next` emptied, a fresh production build, no stale server. Typecheck,
lint and the source policy clean; **2,431 unit tests in 93 files** (+58 in 4 new
files, plus the extended schema, cache-impact, library, admin and policy suites);
**1,745 pgTAP assertions in 25 files** (+102 in `025`), from real anonymous, Staff
and Owner JWTs; **12 integration tests in 3 files** unchanged; `npm audit
--audit-level=high` clean (0 vulnerabilities); `npx playwright test --list`
collecting **1,159 tests in 31 files across 38 projects**, with
`e2e/homepage-admin.spec.ts` under exactly `homepage-admin-mobile` and
`homepage-admin` and nothing under the generic projects; and the complete
Playwright matrix at `--retries=0`, run as the chunked chain against one detached
production server (the read-only trio together, every write project in its own
invocation, in config order): **1,152 passed, 7 deliberately skipped (width/device
guards), zero failed and zero flaky** on the authoritative run of every chunk.

Recorded honestly, in two parts. The first launch of the chain stalled for 13.8
hours inside `menu-admin` while the machine slept; the one 30 s timeout that
produced left a test dish behind and cascaded through the three menu suites after
it. Nothing in the product was at fault; the chain was killed and relaunched from
its clean start. On that second run the read-only trio dropped four assertions in
the locked `a11y/menu-admin` file — the known cold-server sign-in hiccup, the
serial file's `beforeAll` landing on the login page — and the two new Forsiden
projects failed their sixth story because the text fields' `maxlength` had been
aligned with the schema limit after the earlier green run (Playwright's `fill()`
honours it, so the over-limit value never reached the server). The story now strips
the attribute and submits the over-limit value the way a foreign client would, which
is the server refusal it exists to prove; the trio and both Forsiden projects were
re-run green against the same build, and every count above comes from those
authoritative runs. Phases 5–10 ran green behind it, unchanged; the public cache is
still 5m/5m, no tracking cookie and no browser Supabase client appeared, and no
private-original URL reached any public surface.

---

## §0aa. Phase 11B — Mad ud af huset and Kontaktoplysninger administration (2026-09-02)

Staff and Owner can now edit Mad ud af huset through 1aj — the switch, the words,
the photograph, the free sections, the button label — and the Owner can edit the
contact facts through 1v, both through the `pages` / `site_contact` draft
architecture phase 4 built and phase 11A extended. **Phase 11 is still not locked**:
11C (`/admin/brugere`, the user administration) is not started, and the lock pass
over 11A–11C is the step after it. The §15 split moved by one screen on the way
in: §15 had put Kontaktoplysninger with `/admin/brugere` in 11C; the owner's
brief for this phase put it in 11B, so that the two remaining *content* editors
land before the security-sensitive account phase. §15's row is corrected in place.

### What phase 11B contains

| Capability | Path | Where it lives |
|---|---|---|
| The Mad ud af huset editor at `/admin/mad-ud-af-huset` (1aj): "Vis siden på hjemmesiden", "Tekst" (Overskrift, Intro, Billede), "Tekstafsnit", "Knap nederst" | Kladde → Forhåndsvis → Offentliggør (§6) — **the switch included** | `app/(admin)/admin/mad-ud-af-huset/`, `components/admin/takeaway/`, `lib/pages/takeaway.ts` (pure), `lib/content/takeaway-admin.ts` |
| The page's photograph through the shared picker pair | draft | `image-actions.ts`, `ImagePickerField` / `ImagePickerDialog` unchanged |
| The Kontaktoplysninger editor at `/admin/kontakt` (1v): the primary and extra numbers, the address, the e-mail, Facebook | Kladde → Offentliggør over the phase-1 `site_contact` row (§6) | `app/(admin)/admin/kontakt/`, `components/admin/contact/`, `lib/contact/editor.ts` (pure), `lib/content/contact-admin.ts` |
| The public page rendering the photograph, or the text at full width without one; the sitemap dropping a hidden page | — | `app/(site)/mad-ud-af-huset/page.tsx`, `lib/content/pages.ts` (`readTakeawayDocument`), `lib/seo/sitemap.ts` |
| `image_references` with the page's two paths; `delete_image()` / `replace_image()` over them; the published-path guard extended to the page and to `is_visible`; `publish_page()` moving the switch; `page_content()` recording it | — | `20260902160000_takeaway_page_admin.sql`, `lib/images/cache-impact.ts` (`page:takeaway`) |
| The dashboard's "Mad ud af huset" (everybody) and "Kontaktoplysninger" (Owner) tiles; the phase-4 content screen reduced to Om os | — | `app/(admin)/admin/page.tsx`, `indhold/editors.ts` |
| The three pending marks every draft editor draws, shared | — | `components/admin/PendingBand.tsx` (the Forside screen draws them through it too) |

### The `page:takeaway` model — exact

One row of `pages`, `key = 'takeaway'`, the phase-1 row. `published` is the live
document, `draft` holds top-level **keys** merged shallowly at publish
(`published || draft`), `updated_at` is the version token every form submits back,
`publish_page()` is the one publish function, the tag is `page:takeaway`, and §5's
matrix row is **Staff and Owner** — enforced three times over: `requireStaff()` in
the page and in every Server Action, `mayChangeEntity` inside `saveEntityDraft` and
`publishPendingChange`, and `pages_update_scoped` (`public.is_staff()` for every
row but `home`) in the database. The document, as `takeawayDraft` states it:

```
heading      text
intro        text
image_id     uuid | null                       (phase 11B; §4 had it, the schema had not)
sections     [ { id, heading, body, sort } × ≤20 ]  — strict objects
cta_label    text
is_visible   boolean                            (a draft key only — never a document key)
```

Every key is a top-level draft field, so §4's "a draft holds only the changed
fields" is the per-key rule the column entities use: a save writes the keys that
differ from the published document and clears the ones that no longer do. The
sections are one key, written whole with `sort` renumbered from 1 in display
order; each section's `id` (`afsnit-<n>`, the seed's own shape) is the server's,
never the browser's — the form addresses sections by position, and a submission
whose length does not match the server's list is refused outright.

### The nested-schema finding — closed here

The 11A completion pass recorded that `takeawayDraft.sections[]` was an ordinary
`z.object()` and therefore *stripped* an unknown nested key rather than refusing
it. Phase 11B owns the schema, so the section is `z.strictObject` on both parses:
a section carrying `price`, `storage_path`, `image_id` or any key 1aj does not
draw is `unrecognized_keys` on the way in, `malformed` in the editor and the
preview, and `invalid_draft` at Offentliggør — proved in the unit suite (write
parse and stored parse, per key), and end to end with a Staff JWT writing the
smuggled draft straight to `pages.draft` through PostgREST and meeting every door
closed. Nothing historical is refused: the seed's four keys are exactly the shape.
`publish_page()` itself parses nothing (§4: the field-level shape is the
application's), which is why the refusal lives in `storedDraftIsValid` and is
stated in pgTAP `026`'s header rather than asserted there.

**The sibling finding stands, deliberately.** `aboutDraft.team` and
`aboutDraft.method` are still ordinary `z.object()`s. Om os has no approved editor
yet — the phase-4 placeholder form on `/admin/indhold` is what edits it — and the
phase that builds 1i's editor owns the strictness of its sections, exactly as 11A
owned the Forside's and 11B owns Mad ud af huset's. Recorded in
`lib/schemas/page-documents.ts` beside the shape and carried to the final security
audit below.

### Readings this phase had to settle

| # | Question | The answer |
|---|---|---|
| A | **Is the visibility toggle immediate, or a draft?** Phase 3's read layer had called it "a live switch rather than a draft (§6)"; §4's table says the row is draft/published; §6's immediate-path table lists four operations and this is not one; 1aj draws the switch among the fields with no "ændres straks" mark (compare 1r's Udsolgt and 1ad's "Vis besked") and closes with *"Almindelig tre-trins-proces: **alt** gemmes som kladde, forhåndsvises på den rigtige side og går først live ved Offentliggør."* | **A draft field.** The pending value lives in `draft.is_visible`; the preview reads it (`takeawayVisibility`), so Forhåndsvis shows the 404 and the navigation without the item exactly as publishing would leave them; a guest keeps the published column; `publish_page()` moves the boolean into `is_visible` and strips it from the document merge; the FIRST guest request after the commit sees the page, the navigation item and the sitemap entry gone — or back — together, through the one `page:takeaway` tag the visibility read has always carried. The phase-3 comment was a reading made before the editor existed, and is corrected in place. |
| B | **Hidden means what?** | **§9 E2E 8 and 1aj's own sentence:** *"Slå fra, og både siden og menupunktet forsvinder helt."* The route answers 404 (RLS returns no row to `anon`), the header, the fullscreen panel and the footer drop the item (`visibleNav`, unchanged), and — new — `/sitemap.xml` drops the URL, because a page that 404s must not be offered to a crawler. The sitemap reads the same tagged hidden-keys read the layout does. |
| C | **Should a direct write of `is_visible` stay open?** Phase-1 pgTAP `002`/`003` asserted Staff and Owner *could* toggle the column directly. | **No — guarded, narrowly, for §0w's reason.** Publishing decides *when* a change becomes public and carries the version check, the audit row and the cache expiry; a direct write of the switch would hide the page from guests up to five minutes late, unaudited, with every open editor holding a stale token. The 11A guard on `pages` now also fires `BEFORE UPDATE OF is_visible` and refuses `anon`/`authenticated` unless the marker names `publish`; Staff and Owner are refused alike. `002` and `003` are re-pinned to the refusal (`42501`), and `026` proves the one door that moves it. |
| D | **Does the page have an image slot?** §4's shape carries `image_id`; the phase-4 schema did not; 1aj draws "Billede (valgfrit)" and 1ai the 4:3 frame. | **Yes, one, top-level.** The shared picker pair, a draft change through `imageDraftWrite` (the one-field delta the column entities use — a top-level key needs no whole-section rule). `image_references` gains the page's two rows under a sixth kind, `page:takeaway`, the transitions move them, `affected` counts them, and the cache mapping expires `page:takeaway` when — and only when — the live document changed. Both transitions stay open to **Staff** for this page: `pages_update_scoped` admits the row to `is_staff()`, so the `owner_only` refusal remains the Forside's alone. |
| E | **The no-image state.** 1ai draws a reserved "FOTO — VALGFRIT" frame; 1aj says *"Uden billede fylder teksten hele bredden."* | **1aj's sentence.** Now that the restaurant can choose a photograph, "no photograph" is a choice rather than a placeholder for photography still owed, and the admin frame states the public consequence in words. The page renders `SiteImage` in 1ai's 4:3 frame when an image is chosen and nothing when none is; the seed therefore renders the text at full width. Recorded as a departure from 1ai's placeholder. |
| F | **The drag handle 1aj draws on each section.** | **Two move buttons** — the phase-5F/11A precedent for a short fixed list, not a second drag engine. Every control in the card is a submit button that saves the whole list as typed (Tapas' arrangement), so add, remove, move and Gem are one draft write each, with no Fortryd needed. Recorded as a departure. |
| G | **May a section be blank?** | **Yes in the draft, never on the page.** "+ Tilføj tekstafsnit" appends an empty section to be written into (refusing it would refuse the button), and the public read drops a section with neither a heading nor a text — 1g's "remove a block rather than render an empty one", applied to 1ai. Lengths are refused with the position bound to the field; the twenty-first section is refused. |
| H | **Which contact fields does 1v draw?** `site_contact` has nine columns. | **Seven.** The primary and extra numbers, the address as its three columns (1v's two lines: street; postal code and city), the e-mail and Facebook — each under 1v's label with 1v's helper beneath it. `venue_name` and `map_attribution` are drawn by no approved frame and stay out of the form and the vocabulary: the venue name is a confirmed business fact the seed carries, the map credit a launch-time configuration for the licensed asset (§7g). Both remain seed/migration-managed and are recorded for the audit. No Instagram, no WhatsApp, no reservation or delivery field — and 1v's own sentence about Instagram is on the card. |
| I | **Is the contact save immediate, or a draft?** | **A draft, because the row already is one.** `site_contact` has carried `draft`, an Owner-only policy and `publish_site_contact()` since phases 1 and 4, and 1v draws Offentliggør *"nedtonet, indtil der faktisk er noget at offentliggøre"* — the shape of a draft waiting, not of an immediate save. So Gem writes the draft (per field, against the live row), the bar's button is disabled with the reason announced until something waits, the band offers the same publish, and the FIRST guest request after Offentliggør carries the new facts on every page through the `contact` tag. The UX says so on the card and in every status sentence. No second snapshot model was invented. |
| J | **Forhåndsvis on 1v.** The frame draws none. | **Drawn, to Find os.** It is this administration's convention for every draft editor, it costs the frame nothing, and Find os is the page 1v's helpers name ("står størst på Find os"). `previewTargetForEntity('site_contact')` for the dashboard is unchanged (the Forside). Recorded as a reading. |
| K | **Where does the number the button rings come from?** 1aj: *"Knappen ringer altid til det primære nummer fra Kontaktoplysninger — +45 63 90 83 00 … Nummeret skrives ikke her, så det kun står ét sted."* | **From `site_contact`, read by the page and handed to the card.** The sentence prints the published primary number; the form has no field for it; the public button derives its `tel:` link from the stored value through the one `telHref` (phase 3), so a new primary number reaches the header, the bottom bar, Find os and this page's button on the first request after the contact publish — proved in the contact suite. |

### Draft → Preview → Publish, and the cache

A save on either screen writes `draft` and expires nothing; a guest keeps the
published document and the published facts. Forhåndsvis opens the real page
through Draft Mode: `readTakeawayDocument` overlays the draft *before* projecting
the image id, so a pending photograph previews from the same derivative ladder the
guest will get, and `queryPageDocument` / `readHiddenPageKeys` read the pending
switch, so a page switched off in the draft previews as the 404 it will become,
without its navigation item. Offentliggør publishes the screen's one entity
through `publishPendingChanges` (the stored draft re-validated against the strict
schema first) and expires exactly the registry's tag after the commit:
`page:takeaway` — which the navigation's visibility read, the page and the sitemap
all carry — or `contact`, which is on every page. A library alt edit, a replacement
or a confirmed deletion that touches the **live** takeaway image expires
`page:takeaway` through the centralized mapping; a pending one expires nothing.
Nothing is invalidated globally.

### Boundaries kept

- **No packages, prices, minimums, delivery terms or deadlines** anywhere: not in
  the schema, not in the forms, not in the copy (the E2E suite asserts the editor
  prints none of the words). The public CTA still reads the stored label or
  `Ring og hør mere`.
- **The copy is the document's.** The seed's placeholder Danish is rendered as
  written; the humanisation pass is later.
- **No raw HTML, no Markdown, no link field, no arbitrary JSON.** Plain text
  fields, one image id, one boolean, strict objects.
- **One picker, one renderer, one reference definition, one cache mapping, one
  `tel:` derivation, one address builder.** Nothing was duplicated; the three
  pending marks were *de*-duplicated into `components/admin/PendingBand.tsx`.
- **Phase 10's and 11A's guards are intact.** `020`–`025` pass unchanged in
  behaviour (`024`/`025` re-pinned with the sixth `affected` count); no SECURITY
  DEFINER appeared; no grant or policy changed.
- **No browser Supabase client, no new public client component, no new
  dependency.**

### Tests

- **Unit** (+4 files): `tests/unit/pages/takeaway.test.ts` (normalisation, the
  visibility resolution, the per-key deltas, the four section controls, the ids,
  the sentences), `takeaway-forms.test.ts` (the five vocabularies, the button
  grammar, the echoes, the addresses), `tests/unit/contact/editor.test.ts` (1v's
  seven fields and no other, the schema's own refusals bound per field — the phone
  grammar, https-only, e-mail — the delta, the `tel:` derivation, the sentences),
  `contact-forms.test.ts`; the schema suite gains the strict-section block
  (write parse and stored parse, per smuggled key), the switch as a boolean-only
  draft field, and the refusal of `is_visible` on the two other pages; the
  cache-impact, admin, public-image, policy and sitemap suites re-pinned for the
  sixth kind, the new sizes preset, the sixth image action and the hidden page.
- **pgTAP** `026_takeaway_page.test.sql` — **98 assertions**, and
  `027_site_contact_admin.test.sql` — **34 assertions**, from real Owner, Staff
  and anonymous JWTs: the guard on the switch and the image path (Staff, Owner and
  anon), the draft → publish of the switch with the audit's before/after and the
  anonymous read losing and regaining the row, the §19 delete matrix and the
  replacement for a top-level key operated by **Staff**, a stale publish, audit
  counts, unrelated documents; the contact draft (Owner writes, Staff zero rows,
  anon refused), publish (exactly the drafted columns, the audit row attributed
  from the JWT, the anonymous read), Staff refused, stale refused with no audit,
  `nothing_to_publish`, the nine-column audit projection. `002`/`003` re-pinned to
  the refusal of the direct switch write.
- **E2E** `tests/e2e/takeaway-admin.spec.ts` under exactly `takeaway-admin-mobile`
  and `takeaway-admin` (24 stories each): the §29 Staff story end to end — draft,
  unchanged guest, preview, sections added / written / moved / removed, the
  switch as a draft with the guest keeping page and item, the preview's 404, the
  publish hiding page, item and sitemap entry on the FIRST request, back on with
  the new content, the photograph (draft, preview, publish, caption, a Staff
  replacement, a removal, a draft-only deletion), a stale save, the smuggled
  nested key, anonymous and direct switch writes refused, the seed restored.
  `tests/e2e/contact-admin.spec.ts` under exactly `contact-admin-mobile` and
  `contact-admin` (11 stories each): the greyed Offentliggør, the draft with its
  badges, the unchanged guest, refused values bound to their fields, the preview,
  the publish reaching footer / Find os / header / bottom bar / Mad ud af huset's
  button on the FIRST request with derived `tel:` links, no Facebook anywhere once
  emptied, the no-JavaScript page, the stale save, the Staff denial (tile,
  address, forged post, direct writes), the seed restored. `tests/a11y/takeaway-admin.spec.ts`
  and `tests/a11y/contact-admin.spec.ts` under `desktop` and `mobile`;
  `admin-pages` gains the new standalone dashboard link.

### Recorded for the FINAL SECURITY AUDIT (phase 13)

- **`aboutDraft.team` / `aboutDraft.method` still strip an unknown nested key.**
  Owned by the phase that builds 1i's Om os editor; not tightened here.
- **A Staff JWT may still write `pages.draft` directly** for the two Staff pages
  (and the Owner for the Forside) — RLS admits the row and the strict schema is
  the application's door. What holds, and is proved end to end, is that such a
  draft goes nowhere: `malformed` on screen, ignored in the preview,
  `invalid_draft` at publish. The published document, the switch and the image
  paths are guarded in the database; the draft column is not, by the phase-4 model.
- **`venue_name` and `map_attribution` have no editor**; both are seed/migration
  facts until a frame draws them.
- **`site_contact.email` is editable and not rendered publicly** (§11 lists a
  public e-mail as "omitted until supplied"); it is stored, audited and previewed
  like every other field and appears nowhere a guest reads.
- The standing image findings (§0y, §0z) carry forward unchanged, with the sixth
  reference kind added to every enumeration.

### The regression

From a clean tree: `npm ci`, `npm run db:reset:full` (the new migration applies
cleanly), `.next` emptied, a fresh production build, no stale server. Typecheck,
lint and the source policy clean; **2,521 unit tests in 97 files** (+90 in 4 new
files, plus the extended schema, cache-impact, admin, public-image, policy and
sitemap suites); **1,877 pgTAP assertions in 27 files** (+98 in `026`, +34 in
`027`), from real anonymous, Staff and Owner JWTs; **12 integration tests in 3
files** unchanged; `npm audit --audit-level=high` clean (0 vulnerabilities);
`npx playwright test --list` collecting **1,249 tests in 35 files across 42
projects**, with `e2e/takeaway-admin.spec.ts` under exactly `takeaway-admin-mobile`
and `takeaway-admin`, `e2e/contact-admin.spec.ts` under exactly
`contact-admin-mobile` and `contact-admin`, and neither under the generic projects;
and the complete Playwright matrix at `--retries=0`, run as the chunked chain against
one detached production server (the read-only trio together, every write project in
its own invocation, in config order): **1,242 passed, 7 deliberately skipped
(width/device guards), zero failed and zero flaky** on the authoritative run of every
chunk.

Recorded honestly, in two parts. The first complete chain of the evening (started
22:57, finished 23:52) was green step for step, but it reached the two
`opening-hours-override` projects at 23:34, after that locked suite's own
"tooLateToOpenToday" guard had switched on — an opening cannot cross midnight, so it
skips its nine "Åbent nu" stories per width after 23:30 — and finished with 25 skips
rather than 7. Nothing failed; eighteen assertions were simply never executed. That
is not the complete matrix, so the whole chain was run again from `npm ci` after
midnight (started 23:53, finished 00:38, the date-arithmetic suites all running on
the new day), and every count above comes from that second run. Three earlier
launches stopped at their first red step and were restarted from the top rather than
resumed: a real host in a pgTAP fixture URL (the source policy; changed to a `.test`
host), the integration suite's "JWT issued at future" a few seconds after the stack
reset (a twenty-second settle now follows the reset), and the new dashboard tile's
words "Om os" colliding with the phase-4 `draft-publish` assertion that no "Om os"
item is pending (reworded). Phases 5–11A ran green behind it, unchanged; the public
cache is still 5m/5m, no tracking cookie and no browser Supabase client appeared, no
user administration and no phase-12 work exists, and no private-original URL reached
any public surface.

### What remained of phase 11 after 11B

**11C — user administration** at `/admin/brugere` — built and recorded in §0ab.
Then the **phase-11 lock pass** over 11A–11C.

---

## §0ab. Phase 11C — user administration (2026-09-03)

The Owner can now administer the accounts at `/admin/brugere`: list them, invite a
Staff or Owner account by name, e-mail and role, change a role, deactivate an
account and reactivate it — through Supabase Auth for the identity and through
`profiles` for the authorisation, with the last-active-owner invariant refused by
the database under a lock. **Phase 11 is still not locked**: the lock pass over
11A–11C is the step after this one. No approved frame draws the screen (§5); it is
built in the approved visual language — 1z's list of cards, 1v's one-card form and
this administration's one confirmation shape.

### The identity model, inspected before anything was built

One person is two rows in two systems, and neither copies the other:

| Fact | Owner of the fact | Read by | Written by |
|---|---|---|---|
| e-mail, password hash, confirmation, `banned_until`, sessions | **Supabase Auth** (`auth.users`, `auth.sessions`) | `list_accounts()` (e-mail, invitation state), `getUser()` per request | the Auth Admin API from the server — `lib/accounts/auth-admin.ts`, and nothing else |
| name, role (`'owner' \| 'staff'`), `disabled_at` | **`public.profiles`** | `is_staff()` / `is_owner()` on every policy, `requireStaff()` / `requireOwner()` on every request | the three account transitions — and nothing else |

What phase 1 had already settled, and what this phase kept: profiles are created
by the application (the seed script and now `create_account_profile()`), never by a
trigger on `auth.users`; the role lives only in `profiles` — no JWT metadata, no
`app_metadata`, so a role change needs no token to expire; `is_staff()` and
`is_owner()` have checked `disabled_at` since phase 1, which is why deactivation
needs no policy edit anywhere and is effective for RLS the moment it commits; an
Auth user without a profile is nobody — `requireStaff()` turns it away and the
sign-in action ends its session. Nothing here invented a second identity system.

### What phase 11C contains

| Capability | Path | Where it lives |
|---|---|---|
| The list: name, e-mail, role and state in words; the signed-in owner's own row marked; the only active owner's row explaining why it offers no control | read | `app/(admin)/admin/brugere/page.tsx`, `components/admin/users/UserList.tsx`, `list_accounts()` |
| Invite (name, e-mail, role) | Auth invitation + `create_account_profile()` | `invite-actions.ts`, `lib/accounts/admin.ts`, `lib/accounts/auth-admin.ts`, `components/admin/users/InviteForm.tsx` |
| Change a role — both directions confirmed | `set_account_role()` | `account-actions.ts`, `components/admin/users/UserConfirmDialog.tsx` |
| Deactivate — confirmed, destructive tone | `set_account_active(false)` + the Auth ban | the same |
| Reactivate — confirmed, keeps the role | `set_account_active(true)` + the unban | the same |
| The dashboard's Owner-only "Brugere" tile; the sign-in screen naming a banned account as deactivated; the Danish invitation e-mail | — | `app/(admin)/admin/page.tsx`, `actions.ts`, `supabase/templates/invite.html` |

Not built, by decision: no password viewing or reset control (the person chooses
their own through the e-mail link, and "Glemt adgangskode" exists), no metadata
editor, no delete, no impersonation, no session viewer, no MFA administration, no
permission matrix, no custom roles, no bulk operation, no name editor (the direct
`name` write phase-1 `003` pins stays open in the database; no frame draws a form
for it).

### The account lifecycle — exact

**Invite.** `requireOwner()`; the strict submission (`inviteSubmissionSchema`: a
name of 1–120 characters, an address trimmed and lower-cased and shaped like one,
a role from the two-word vocabulary — Danish per field); the directory the Owner
was looking at, re-read; then, in this order:

1. An address that already has an account is answered from the directory —
   `findes` — before the Auth server is asked for anything. If that account was
   invited and has not yet accepted, the Auth server is asked to re-send instead
   (`inviteret_igen`; the existing name and role are kept, whatever the form said).
2. `auth.admin.inviteUserByEmail(email, { data: { name } })`. The Auth server
   creates the identity and hands the invitation to its mailer in one operation, so
   `inviteret` means *the Auth server accepted the delivery* — never that a person
   received it, and never a silently created identity when sending fails.
   Measured (GoTrue v2.196): an unconfirmed existing identity is re-sent under the
   same id; a confirmed one answers `email_exists`; a malformed address
   `validation_failed`.
3. `create_account_profile(user_id, name, role)` through the Owner's own JWT: the
   profile, the audit row (`invite`, attributed from the JWT), or `exists` /
   `no_auth_user` / `invalid` as results.

The person follows `{SiteURL}/admin/bekraeft?token_hash=…&type=invite` — the
phase-1 route already accepted `type=invite` — which establishes a session
server-side and lands on `/admin/ny-adgangskode`, where they choose their own
password. No password is generated, shown, sent or stored by anything in this
repository; the e-mail carries one one-time hash and no `ConfirmationURL`. The link
expires after an hour (`otp_expiry`); the e-mail says so and says the Owner can
send a new one.

**Change a role.** `set_account_role(user_id, role, version)`: owner only,
vocabulary-checked, the invariant lock, the row `FOR UPDATE`, the version token,
`unchanged`, the last-owner count, the audit row *before* the column moves (the
actor must still be staff for `log_audit()` — an owner demoting themselves is not,
one statement later), the one UPDATE under the `role` marker. The browser submits
the target id, the desired role and the version; the actor is `auth.uid()`.

**Deactivate.** `set_account_active(user_id, false, version)`: the same shape, the
audit row, `disabled_at = now()` under the `active` marker — and, in the same
transaction, `revoke_account_sessions()` removes the person's `auth.sessions` rows
(their refresh tokens cascade). Then, from the Server Action, the Auth ban
(`ban_duration = '876000h'`). **Reactivate.** `set_account_active(user_id, true,
version)` clears `disabled_at`, the role untouched; then the unban. Reactivation
is never a new account and never a new invitation: the person signs in with the
password they already have. The reading that reactivation is approved: §4's own
hint on the invariant ("promote or **re-enable** another owner"), §5's "deactivate,
never delete" (a returning employee without reactivation would need a second
identity, which is the deletion §5 forbids by another route), and the seed
script's idempotent re-enable.

**Acting on oneself.** An owner may demote or deactivate themselves while another
active owner exists — the database allows exactly that, and the confirmation says
"dig selv". A self-demotion lands on the dashboard with a notice; its next render
lacks the Owner tiles and every Owner-only screen refuses. A self-deactivation ends
the very session: the cookie session is signed out and the login screen says why.

### Session and token revocation — the measured truth

Three mechanisms, each measured on the local stack rather than assumed, and what
each one buys:

| Mechanism | What it does | What it does not do |
|---|---|---|
| `profiles.disabled_at` + `is_staff()` / `requireStaff()` | **Immediate** loss of every application authorisation, for whatever JWT the browser still holds: every policy and every request re-reads the row | nothing at the Auth server |
| `revoke_account_sessions()` inside the deactivation transaction | the Auth server answers `session_not_found` (403) to the person's already-issued access token at `/user` — which every admin request checks — and `refresh_token_not_found` to their refresh token; reactivation brings no session back, so a stale device must sign in afresh | nothing about sign-in |
| the Auth ban | refuses a new sign-in (`user_banned`), and would refuse the access token and the refresh token of a session that still existed | **it only holds**: a refresh token never presented while banned resumes the session the moment the ban is lifted — which is why the revocation above exists |

The Auth Admin API of this version offers no route that ends another person's
sessions (`DELETE /admin/users/{id}/sessions` and its neighbours are 404), and
`auth.admin.signOut()` needs the person's own JWT. `auth.sessions` is the Auth
server's table; `revoke_account_sessions()` is the phase's one SECURITY DEFINER
write, touches no application table, and is admitted only under a single-use
marker the transition raises and a target whose profile is deactivated — a direct
RPC from Owner, Staff or anonymous is 42501 (pgTAP `028`). If the Auth server's
session model changes, `tests/integration/accounts.test.ts` fails on the measured
codes rather than the site silently keeping a session alive.

"Instant logout" is therefore not claimed; what is claimed and proved is: the next
request from a deactivated person — with or without the ban — is refused by the
database and, once the session row is gone, by the Auth server too; and no session
survives a deactivation into a reactivation.

### Direct profile writes — closed narrowly

`authenticated` lost DELETE on `profiles` ("deactivate, never delete" as the
absence of a privilege) and holds UPDATE on `name`, `role` and `disabled_at` only.
A BEFORE INSERT OR UPDATE OF `role`, `disabled_at` guard in §0w's shape refuses any
creation or movement of the two authorisation columns from `anon` or
`authenticated` unless the statement-scoped `app.account_write` marker names the
transition — for the Owner as for Staff, because authority to administer accounts
is not authority to bypass the version check, the last-owner check and the audit
row. RLS is unchanged otherwise: Staff still sees and reaches only their own row,
and no policy admits them to a write. Phase-1 `002` and `003` are re-pinned to the
refusals (`42501`), the six image suites to the two new SECURITY DEFINER functions.

### The last-active-owner invariant — under a lock, proved through two sessions

Phase 1's deferred constraint trigger counted under READ COMMITTED with no
serialisation: two transactions each demoting one of two owners could both count
the other's still-uncommitted row, both pass, and both commit. `enforce_owner_
invariant()` now takes `owner_invariant_lock()` — a transaction-level advisory
lock — before counting, and the transitions take the same lock first, so a
concurrent transition answers `last_owner` cleanly rather than failing at commit.
pgTAP `028` proves both races through two real database sessions (dblink), run
first in the file because every later transition holds the lock until the file's
rollback: two direct demotions commit and are refused in turn (`23514`), and a
transition racing a self-deactivation from a second tab blocks on the lock and
answers `last_owner`. A mutual demotion ends the same way one step earlier — after
the first commit the second actor is no longer an owner, RLS shows it no row, and
it answers `not_found`. The screen's absent controls and its sentence ("Eneste
aktive ejer…") are an explanation; the database is the enforcement.

### The service-role boundary

`lib/accounts/auth-admin.ts` is the second runtime importer of
`createSupabaseServiceClient()` (the first is the image storage boundary) and the
only file in the project that calls `auth.admin.*`. It imports `server-only` and
returns three capabilities — invite, look up by e-mail, ban / unban — never the
client, never a delete, never a password or metadata operation.
`tests/unit/policy/images-boundary.test.ts` holds the importer list to exactly two,
and `tests/unit/policy/accounts-boundary.test.ts` pins the rest: one `auth.admin`
caller, both account server modules server-only, no client component under the
user administration or reaching its server modules, `profiles` read directly in one
place (the phase-1 session read) and written directly nowhere, the three transitions
called from one module, the five-name form vocabulary with no password / token /
actor / ban / metadata field anywhere, the actions taking the actor from the
session, and `deleteUser` absent from the runtime. §8's "three call sites" is now
four (the Auth Admin boundary added), corrected in place.

### Audit

`invite`, `role`, `deactivate`, `reactivate` on entity `profile`, `entity_id` the
account's id, `actor_id` from the JWT, `before` / `after` holding `role` and
`disabled_at` (and the name on `invite`). No e-mail is written into the row (it is
the Auth server's fact, resolvable by id), no password, no token, no ban duration —
pgTAP `028` asserts no secret-shaped key. A refused, stale, unchanged or
`last_owner` call audits nothing, proved per outcome.

### Readings this phase had to settle

| # | Question | The answer |
|---|---|---|
| A | **`createUser` + e-mail, or `inviteUserByEmail`?** §5 says the former. | **`inviteUserByEmail`.** It is the one operation that creates the identity *and* hands the e-mail to the Auth server's mailer, so a delivery the mailer refuses is a refused invitation rather than an identity with no way in; `createUser` + a separate reset e-mail is two operations with a gap between them. The template (`supabase/templates/invite.html`) links to the phase-1 `/admin/bekraeft` route with `type=invite`, which already existed. §5's sentence is corrected in place. |
| B | **Where does the e-mail live?** | **In `auth.users`, read by `list_accounts()`** — a SECURITY DEFINER read in the family of `is_owner()` (no parameters, `search_path` pinned, raises for anybody but an active owner). Copying it into `profiles` would be a second fact to keep in step; exposing the Auth Admin list to the page would put a service-role read on every render. |
| C | **Is reactivation in scope?** §5's matrix says "create, change role, deactivate". | **Yes** — see the lifecycle above for the reading. Reactivation keeps the existing role and sends nothing. |
| D | **May the Owner act on themselves?** No frame, no rule. | **Yes, while another active owner exists** — the database's own condition — with the consequence stated in the confirmation and enforced on the very next request (see "Acting on oneself"). |
| E | **Which rows show what?** | Name, e-mail, role, and one of three states in words: Aktiv (confirmed, enabled), Inviteret (`email_confirmed_at` null — the link not yet used), Deaktiveret. No last sign-in, no IP, no provider, no token state, no session count. |
| F | **Does a ban revoke sessions?** | **No — measured.** It holds them; the transition revokes them. See "Session and token revocation". |
| G | **What if the e-mail goes out and the profile write fails?** | An identity with no profile exists and can do nothing (`is_staff()` false, `requireStaff()` refuses, sign-in ends the session). The screen says so (`profil_fejl`) and the repair is the same form with the same address: an unconfirmed identity is re-sent and given its profile (`inviteret`), a confirmed one is found by address and given its profile with no new e-mail (`tilknyttet`). `create_account_profile()` answers `exists` for an identity that has one, so nothing is ever duplicated. |
| H | **The Auth step after the database step fails.** | Reported honestly, never as success: `deaktiveret_login_aabent` (the account is refused on every request regardless), `genaktiveret_login_laast` (the person cannot sign in yet — the safe direction). Repeating the action repeats the Auth step (`unchanged` + the step). |

### Boundaries kept

- **No browser Supabase client, no new client component, no new dependency.** The
  confirmations are the same server-rendered `<dialog>` every screen uses; the
  whole screen works with JavaScript off.
- **No SECURITY DEFINER write on any application table.** The one definer write
  touches `auth.sessions` only, under its marker.
- **No role anywhere but `profiles.role`; no third role; no JWT metadata.**
- **The seeded identities are untouched by the suites**: every test identity is a
  run-unique `@example.test` address, deleted by the suite through a test-only,
  loopback-only door (`tests/support/local-auth-admin.ts` — the policy script's
  second deliberate secret exception, beside the seed script), and the seeded pair
  is restored exactly.

### Tests

- **Unit** (+3 files): `tests/unit/accounts/model.test.ts` (the role vocabulary,
  the status view model, the controls and the last-owner reason, the strict
  submission per field, the confirmation wording, the result mapping),
  `tests/unit/accounts/forms.test.ts` (the five-name vocabulary and what it
  refuses, the strict target, the echo, the addresses, a sentence for every outcome
  code), `tests/unit/policy/accounts-boundary.test.ts` (above);
  `images-boundary.test.ts` re-pinned to two service-client importers.
- **pgTAP** `028_user_administration.test.sql` — **153 assertions** from real
  Owner, Staff and anonymous JWTs: the two races through two real sessions; Staff
  and anonymous refused every transition, the read and every direct write; the
  Owner's direct writes of `role`, `disabled_at`, an INSERT and a DELETE refused
  (`42501`) while the phase-1 `name` write still works; the three transitions with
  `exists` / `no_auth_user` / `invalid` / `stale` / `unchanged` / `not_found` /
  `last_owner` as results; the invariant's backstop for a superuser; the sessions
  revoked and the helper refused directly; the helpers answering from the current
  row for a deactivated, a promoted and a demoted JWT; the audit vocabulary,
  attribution and hygiene; the content tables byte-identical. `002`/`003`
  re-pinned; `020`–`023`, `025`, `026` re-pinned for the two new definer functions.
- **Integration** `tests/integration/accounts.test.ts` — **13 tests** against the
  real local stack through the two modules the Server Actions use: the invitation
  and its Danish e-mail in the mail catcher, the re-send, the duplicate, the
  malformed address, the orphan repair both ways, accepting the invitation through
  the token and choosing a password, a used token dead, the role change in force
  for the old token, deactivation refusing the old token in the database and the
  Auth server with `refresh_token_not_found` for the refresh token, reactivation
  with the role kept and the old refresh token still dead, and the Staff REST
  session refused everything.
- **E2E** `tests/e2e/users-admin.spec.ts` under exactly `users-admin-mobile` and
  `users-admin` (12 stories each): §31's story end to end, including the
  invitee's *existing* session gaining and losing the Owner areas and losing the
  administration, the last-owner refusal at the database with the Owner's own
  JWT, `Esc` returning focus to the control a confirmation was opened from, the
  self-deactivation and self-demotion of a second owner, the Staff denial, and the
  cleanup. `tests/a11y/users-admin.spec.ts` under `desktop` and `mobile`.

### Recorded for the FINAL SECURITY AUDIT (phase 13)

- **`revoke_account_sessions()` deletes from `auth.sessions`**, the Auth server's
  own table, because its Admin API offers no alternative. Pinned by measurement;
  to be re-measured at every Auth container upgrade.
- **An access token already in flight stays cryptographically valid until it
  expires** (`jwt_expiry = 3600`). Every request it makes is refused by the
  database and — its session gone — by the Auth server; it authorises nothing. No
  shorter expiry was introduced.
- **The sign-in screen says "deaktiveret" for a banned identity** before the
  password is checked. The address is one the restaurant handed out; recorded as
  a deliberate, narrow enumeration of the restaurant's own former accounts.
- **`name` on `profiles` stays directly writable by the Owner** (phase-1 `003`);
  nothing believes it.
- **The invitation link expires after an hour** (`otp_expiry`); a fresh
  invitation from the same form is the recovery. No separate "send again" control.
- **Deployment prerequisite:** invitations in production go through the project's
  custom SMTP (Resend, §10c) and the Auth *Site URL* must be the site, or the link
  in the e-mail points at the wrong host (§10d's cutover runbook). Neither is
  configured by anything in this repository; until both are, an invitation from
  production would use the Auth server's built-in sender, which §10c forbids.
- The standing findings of §0aa carry forward unchanged: `aboutDraft.team` /
  `aboutDraft.method` belong to the future Om os editor phase *(closed in 14B1, §0am)*.

### The regression

From a clean tree: `npm ci`, `npm run db:reset:full` (the new migration applies
cleanly; the invitation template loaded into the Auth container), `.next` emptied, a
fresh production build, no stale server. Typecheck, lint and the source policy clean;
**2,576 unit tests in 100 files** (+55 in 3 new files: the account model, the form
vocabulary and the accounts boundary; `images-boundary` re-pinned to two service
importers); **2,030 pgTAP assertions in 28 files** (+153 in `028`, from real anonymous,
Staff and Owner JWTs and two dblink sessions; `002`, `003`, `020`–`023`, `025`, `026`
re-pinned); **25 integration tests in 4 files** (+13 in `accounts.test.ts`, against the
real Auth server and the mail catcher); `npm audit --audit-level=high` clean
(0 vulnerabilities); `npx playwright test --list` collecting **1,285 tests in 37 files
across 44 projects**, with `e2e/users-admin.spec.ts` under exactly `users-admin-mobile`
and `users-admin` and `a11y/users-admin.spec.ts` under `desktop` and `mobile`, neither
under any other project; and the complete Playwright matrix at `--retries=0`, run as
the chunked chain against one detached production server (the read-only trio together,
every write project in its own invocation, in config order): **1,278 passed, 7
deliberately skipped (width/device guards), zero failed and zero flaky** on the
authoritative run of every chunk (started 03:07, finished 03:55).

Recorded honestly: the first complete attempt of the night (started 03:07 minus forty
minutes, from the same clean install) was green step for step until
`public-images-mobile`, a locked phase-10C-2 suite, where one guest read of `/menu`
after a publish found the dish without its picture — the suite's publish helper
waits for the redirect's address alone, and the guest read landed in the moment
before the new render. Nothing in phase 11C touches that path; the project passed
14/14 on its own against a fresh server, and the whole chain was then restarted from
`npm ci` rather than resumed, which is the run every count above comes from. One
earlier launch stopped at `npm ci` itself: a `next dev` process not started by the
phase held a native module, and was stopped. Phases 5–11B ran green behind 11C,
unchanged; the public cache is still 5m/5m, no tracking cookie and no browser Supabase
client appeared, no phase-12 work exists, and the two seeded identities are exactly
as `npm run db:users` leaves them after every suite.

### What remains of phase 11

The **phase-11 lock pass** over 11A–11C: the three screens read as one system,
walked as Owner, Staff and guest against a production build, audited against
1u / 1aj / 1v — and, for `/admin/brugere`, against the administration's own
language — at 375 / 768 / 1440, and closed by one clean regression chain. **Done — §0ac.**

---

## §0ac. Phase 11 — complete and locked (2026-09-03)

Phase 11 is the administration of everything that is not a menu item, an
announcement, an opening hour, an article or an image: the Forside (11A, §0z), Mad
ud af huset and Kontaktoplysninger (11B, §0aa) and the accounts (11C, §0ab). This
pass read the three increments as one system, walked them as Owner, Staff and guest
against a production build, audited the four screens at 375 / 768 / 1440 against
1u, 1aj, 1v and — for `/admin/brugere` — the administration's own language, reviewed
the account security model once more as a set, and closed the phase with one clean
regression chain. §0z, §0aa and §0ab are left as written — each increment's own
account of its decisions — and this section is what "phase 11" means in force today.

### What phase 11 is, stated once

| Screen | Who | Model | Public consequence |
|---|---|---|---|
| `/admin/forsiden` (1u) | **Owner** | `pages.home`: `hero`, `award`, `about_excerpt` as whole strict sections, `featured_dish_ids` as ≤3 distinct ids; Kladde → Forhåndsvis → Offentliggør through `publish_page()`; tag `page:home` | the Forside's own words and three photographs |
| `/admin/mad-ud-af-huset` (1aj) | **Staff and Owner** | `pages.takeaway`: `heading`, `intro`, `image_id`, strict `sections[]`, `cta_label` as top-level draft keys, plus `is_visible` as a draft key `publish_page()` moves into the column; tag `page:takeaway` | the page, its navigation item and its sitemap entry, together |
| `/admin/kontakt` (1v) | **Owner** | `site_contact`: seven fields over the phase-1 draft row and `publish_site_contact()`; tag `contact` | every phone link, the address, the directions link, the footer, Find os, the bottom bar, the takeaway button, the Find os description |
| `/admin/brugere` | **Owner** | `auth.users` for the identity, `profiles` for the authorisation, three SECURITY INVOKER transitions under the invariant lock; no public tag | none |

The same rules hold on every screen: `requireOwner()` / `requireStaff()` as the
first statement of every page and every Server Action; `mayChangeEntity` inside the
shared draft and publish machinery; RLS in the database as the independent second
layer; a draft that expires nothing; a publish that expires exactly the registry's
tag after the commit, so the FIRST guest request afterwards is fresh; a stored draft
re-validated against its strict schema before the merge (`invalid_draft`, never a
silent strip); and one confirmation shape for anything that takes something away.

### The lock-pass walkthrough (production build, `next start`)

A temporary Playwright harness (deleted before the chain, as in §0y) drove the real
screens against a fresh production build, taking screenshots at the three widths,
running axe at 375 and 1440 on every state, sweeping tap targets at 375 and reading
the computed focus ring. Everything below is what the harness measured, and the
seed was restored exactly at the end (drafts null, contact facts as seeded, zero
images, the two seeded identities, no leftover Auth identity).

**Owner.** Forsiden: a hero draft left the guest's page byte-identical; the picker
opened as a labelled modal and `Esc` returned focus to the slot link; the preview
showed the pending words and the pending photograph from the derivative ladder while
the guest still had neither; Offentliggør put both on the FIRST guest request, with
Månedens burger, the three featured names, the news teaser, the hours and the badge
untouched; the words restored and the image removed and published, the guest was
back to the seed. Mad ud af huset: an over-long heading submitted past `maxlength`
was refused on the field; words, a photograph and the switch off were one pending
band ("Synligheden, Tekst og Billedet afventer offentliggørelse"); the guest kept the
page, the item and the sitemap entry; the preview answered 404 with the item gone;
the publish took the page (404), the item (header, panel, footer) and the sitemap
entry away on the FIRST request, and the next publish brought all three back with the
new words and the photograph; a confirmed delete of the **live** image through the
library's in-use confirmation detached it, and the first guest request rendered the
text at full width. Kontaktoplysninger: Offentliggør greyed and announced until a
draft existed; a bad number and an `http://` Facebook address were refused on their
fields; a new primary number with the extra number and Facebook emptied previewed on
Find os and, once published, reached the header's Ring, the footer's number (the
extra one gone, Følg os gone), Find os, the bottom bar's Bestil, Mad ud af huset's
button and the Find os description on the FIRST request as `tel:+4511223344`; the
seed restored the same way. Brugere: the list said role and state in words; the
only active owner's row explained itself and offered no control; a blank name and a
malformed address were refused on their fields; a `.test` address was invited, the
Danish e-mail caught, the row Inviteret, the profile and the `invite` audit row
written; the invitee followed the link, chose a password, saw no Owner tiles and was
refused `/admin/brugere`; promoted through the confirmation, their *open* session
gained the tiles and the screen on its next request; demoted, the seeded Owner was
the last active owner again — the screen said so, and the database answered
`last_owner` to both transitions and `42501` to the direct write with the Owner's own
JWT; deactivated through the destructive confirmation, the invitee's open session
was sent to the login screen on its next request and their sign-in said
"deaktiveret"; reactivated, they signed in again as Staff. The account audit read
`invite, role, role, deactivate, reactivate`.

**Staff.** The dashboard drew no Forsiden, Kontaktoplysninger or Brugere tile and
did draw Mad ud af huset; the three Owner-only addresses answered
`/admin/ingen-adgang`; every phase 5–10 area rendered (menu, ugens ret, månedens
burger, nyheder, billeder, besked, åbningstider). Mad ud af huset took a Staff
draft, the switch off as a draft and a restore. Forged Server Action POSTs carrying
the *real* action ids read from the Owner's rendered screens (five on Forsiden, two
on Kontaktoplysninger, one on Brugere) each ran into `requireOwner()` and answered a
redirect to `/admin/ingen-adgang`. Through PostgREST with the Staff JWT: the Forside
draft and published document moved zero rows (RLS); `is_visible` and the takeaway's
published image path were `42501` (the guard); the contact draft and live columns
moved zero rows; `role` and `disabled_at` on their own and every other row moved
zero rows, and an unfiltered UPDATE was refused by PostgREST; `list_accounts()`, the
three transitions and `revoke_account_sessions()` were `42501`; `publish_page()` on a
Forside draft the Owner had written answered `forbidden`. Nothing moved.

**Guest.** Six public pages, no `Set-Cookie`, an empty cookie jar, eight scripts all
under `/_next/`, no request to `/rest`, `/auth`, `/realtime` or any third party
(storage derivatives only), `Cache-Control: s-maxage=300` on every route. A pending
Forside draft was absent from the guest HTML, from a request carrying a forged
`__prerender_bypass` cookie and from the anonymous REST read of `pages.published`;
`profiles`, `pages.draft`, `site_contact.draft` and `list_accounts()` were `42501`
for `anon`; no seeded name or address appeared in guest HTML. With JavaScript off at
375: the Forside, the `<details>` menu with all six items, Mad ud af huset through
that menu, Find os, the footer address, every `tel:` link and the directions link
all worked server-side.

### Frame fidelity (375 / 768 / 1440)

1u, 1aj and 1v are matched in hierarchy, card order, field order, labels, helper
sentences and status treatment; no overflow at any width; the three widths stack as
the tokens promise. The departures are the recorded ones — explicit Gem per card
(§0z B), two move buttons for the frames' drag handles (§0z G, §0aa F), the address as
three fields (§0aa H), a heading on the Om os excerpt (§0z A), the 10C-1 picker slot
in place of 1u's inline thumbnail + "Erstat billede", 1aj's switch drawn as its own
card with the state sentence (because it is a draft field, §0aa A), and Forhåndsvis
on 1v (§0aa J) — plus one recorded here: **1v draws Facebook as a second card**
("FACEBOOK"); the build keeps the seven fields in one card, Facebook last with 1v's
helper and the Instagram sentence beneath it. Not changed: the one-card form is the
shape every other draft editor uses and the field order is 1v's. `/admin/brugere`
has no frame and was compared against 1z's list of cards, 1aa's pills and this
administration's one confirmation shape; the dialogs stack at 375 with the safe way
out first and filled, and the last-owner sentence wraps without overflow at 768.

### Accessibility

axe (WCAG 2.0/2.1/2.2 A+AA) reported zero violations at 375 and 1440 on every state
walked: Forsiden clean, pending and with the picker open; Mad ud af huset clean, a
refused heading and pending-hidden; Kontaktoplysninger clean, a refused save and
pending; Brugere clean, a refused invitation, the role confirmation and the
deactivation confirmation. The tap-target sweep at 375 found nothing under 44 px on
any screen (the switch's text label and its `sr-only` input are not targets; the
track that is the target is 44 px). Keyboard: `Tab` reaches every control; the
computed ring is `3px solid rgb(180, 116, 26)` at `2px` offset; a confirmation opens
with focus on the safe way out and `Esc` returns focus to the control it was opened
from (`bruger-<id>-role`, `vaelg-billede-oeverst-paa-siden`); status is never colour
alone (pill shape + word); `prefers-reduced-motion` is honoured by the token sheet
and the no-JavaScript run used it.

### The account security model — reviewed as a set

- **One identity, two owners of two facts.** `auth.users` is the identity (e-mail,
  password, confirmation, `banned_until`, sessions); `profiles` is the authorisation
  (name, role, `disabled_at`). No role in JWT metadata, no e-mail in `profiles`; an
  Auth identity without a profile is nobody (`is_staff()` false, `requireStaff()`
  refuses, sign-in ends the session).
- **`is_staff()` / `is_owner()`** read the current row under `disabled_at is null`
  on every policy evaluation; pgTAP `028` and the integration suite prove an old JWT
  loses Owner authority the statement after a demotion and every authority the
  statement after a deactivation. No JWT claim is trusted for a role.
- **The last-active-owner invariant** is enforced in the database under
  `owner_invariant_lock()` — by the transitions as a `last_owner` result and by the
  deferred constraint trigger as `23514` for any other path — and proved through two
  real sessions. The screen's withheld controls are an explanation.
- **Direct profile writes** of `role` and `disabled_at`, an INSERT and a DELETE are
  refused for Staff and Owner alike by the account-write guard; `name` stays directly
  writable by the Owner (phase-1 `003`), and nothing believes it.
- **Deactivation** = `disabled_at` + `auth.sessions` rows removed in one transaction
  (refresh tokens cascade) + the Auth ban from the Server Action. An already-issued
  access token stays cryptographically valid until it expires (`jwt_expiry = 3600`)
  and authorises nothing: RLS refuses it, and the Auth server answers
  `session_not_found` because its session row is gone — which is why a deactivated
  person's open tab lands on the login screen as "no session" and hears
  "deaktiveret" on the next sign-in. "Instant logout" is not claimed.
- **`revoke_account_sessions()`** — the one SECURITY DEFINER write — was reviewed and
  **accepted**: `auth.sessions` is the Auth server's table and its Admin API has no
  route that ends another person's sessions; `search_path` is pinned to `''`; it is
  admitted only under the transaction-local `app.account_sessions = revoke` marker,
  which only `set_account_active()` raises (PostgREST cannot reach `set_config`),
  consumes the marker itself, and requires a target whose profile is already
  deactivated — so an Owner can revoke exactly the sessions of a person they have
  deactivated through the transition, and nobody can revoke an active account's; a
  direct RPC is `42501` for Owner, Staff and anon. No secret is exposed and the audit
  rows carry no session or token data.
- **`lib/accounts/auth-admin.ts`** exposes invite, look-up-by-e-mail and ban/unban
  over a service client that never leaves the module; no delete, no password, no
  metadata, no session listing. `images-boundary` and `accounts-boundary` pin the
  importer list and the vocabulary.
- **Invitation** = `inviteUserByEmail` (identity + Danish e-mail in one operation) →
  `create_account_profile()`; the person chooses their own password behind the
  one-time `token_hash` on `/admin/bekraeft`; no password is generated, shown, sent
  or logged. An unconfirmed duplicate is re-sent; a confirmed one is `email_exists`.
- **Partial failure**: an identity without a profile can do nothing; the same form
  repairs it (`inviteret` while unconfirmed, `tilknyttet` once confirmed);
  `create_account_profile()` answers `exists`, so nothing is ever duplicated; a
  failed Auth step is reported as such (`deaktiveret_login_aabent`,
  `genaktiveret_login_laast`) and repeated by repeating the action.
- **The test-only cleanup door** (`tests/support/local-auth-admin.ts`) is a test
  file outside every bundle, refuses every host but loopback and every address
  outside `@example.test`, and is the policy script's and eslint's documented second
  exception beside the seed script. It is not a capability of the application.
- **The login screen's "deaktiveret"** for a banned identity is a narrow, deliberate
  enumeration of the restaurant's own former accounts (no password check precedes
  it). Classified **low**: the address set is the restaurant's own, no access is
  gained, and the alternative — a generic error for a person the Owner just
  deactivated — was judged worse. Carried to the final security review, not changed.

### Boundaries re-confirmed

- **The homepage document holds only its static fields and ids.** Månedens burger,
  the featured names and prices, the news teaser, the announcement and the hours
  stay entity-owned and read under their own tags; the walkthrough's publish moved
  the hero and left all of them as they were.
- **One source of takeaway visibility**: `is_visible` + `draft.is_visible` through
  `takeawayVisibility`, read by the page, the navigation and the sitemap from the one
  `page:takeaway`-tagged read; the direct column write is `42501` for everybody.
- **One contact source**: every public number, address, directions link and
  Facebook link derives from `site_contact` through `telHref` / `directionsUrl` /
  `toPostalAddress`. This pass found one remaining literal — the Find os meta
  description carried the address as text — and made it derive from the same
  cached, `contact`-tagged read (the one code change of the pass). `venue_name` and
  `map_attribution` stay seed-managed; no Instagram.
- **Strict schemas**: `homeDraft`'s three sections and `takeawaySection` are
  `z.strictObject` on both parses; unknown nested keys are refused on the way in and
  `malformed` / `invalid_draft` on the way out. `aboutDraft.team` / `.method` stay
  ordinary objects, owned by the Om os editor phase *(closed in 14B1, §0am)*.
- **Page image references** are rows of the one `image_references` view under
  `page:home` and `page:takeaway`, moved by the same two transitions, counted in the
  same `affected`, mapped by the same `cache-impact.ts`. The walkthrough deleted a
  live takeaway image through the library's in-use confirmation and the first guest
  request was fresh; the live A / draft B matrices stay pinned in pgTAP `025` / `026`.
- **Cache**: `page:home`, `page:takeaway`, `contact`, and the image-driven page
  expiries expire only on a commit; drafts expire nothing; 5m/5m preserved
  (`s-maxage=300` measured).
- **Code quality**, reviewed as one slice: no duplicated editor logic beyond the
  shared `PendingBand`, no role logic in JSX beyond the dashboard's tile absence, no
  second visibility or reference definition, two service-client importers, no dead
  export, no circular import. Two stale comments were corrected (`lib/env/server.ts`
  named three service-role call sites and carried literal `§` escapes; §10e
  said three call sites; §5 still said `middleware.ts`).

### Production prerequisites (unchanged, not configured by this repository)

Invitations and password resets in production need the project's custom SMTP
(Resend, §10c) and the Auth *Site URL* set to the site (§10d), or the link in the
e-mail points at the wrong host. Neither exists yet; launch readiness is not claimed.

### Recorded for the FINAL SECURITY AUDIT (phase 13) — carried forward, deliberately

- **Images** (§0y): signed-upload TTL and session binding; the service-role storage
  boundary; private unfinalised originals; best-effort orphan cleanup;
  `replace_image()` accepting any finished successor; the statement-scoped marker
  architecture.
- **News** (§0s): the ordinary autosave's update + audit as two statements.
- **Accounts** (§0ab, reviewed above): `revoke_account_sessions()` on
  `auth.sessions` (re-measure at every Auth container upgrade); already-issued
  access-token semantics; the login screen's "deaktiveret" disclosure; the Owner's
  direct `name` write; the one-hour invitation link; SMTP / Site URL prerequisites;
  the test-only Auth cleanup exception.
- **Pages**: a Staff JWT (Owner for the Forside) may still write `pages.draft`
  directly — the strict schema is the application's door and such a draft goes
  nowhere; `aboutDraft.team` / `.method` non-strict until the Om os editor *(14B1, §0am)*;
  `site_contact.email` stored and never rendered; `venue_name` / `map_attribution`
  without an editor.
- **Test harness** (for the code-quality / test-harness audit, not security): the
  three `Testret` rows the old menu suites leave behind on a non-reset database are
  pre-existing residue — a full run starts from `db:reset:full`, and they caused no
  contamination in this pass.

### The regression

From a clean tree: `npm ci`, `npm run db:reset:full` (every test Auth identity gone,
the two seeded ones as `npm run db:users` leaves them), a twenty-second settle,
`.next` emptied, a fresh production build, no stale server. Typecheck, lint and the
source policy clean; **2,576 unit tests in 100 files**; **2,030 pgTAP assertions in
28 files**, from real anonymous, Staff and Owner JWTs and two dblink sessions; **25
integration tests in 4 files** against the real local stack and the mail catcher;
`npm audit --audit-level=high` clean (0 vulnerabilities); `npx playwright test --list`
collecting **1,285 tests in 37 files across 44 projects**, with `e2e/homepage-admin`,
`e2e/takeaway-admin`, `e2e/contact-admin` and `e2e/users-admin` each under exactly
their own two dedicated projects (24 / 24 / 11 / 12 stories per width), the four
`a11y/*` files under `desktop` and `mobile` only, and no stale `testIgnore` entry;
and the complete Playwright matrix at `--retries=0`, run as the chunked chain against
one detached production server (the read-only trio together, every write project in
its own `--no-deps` invocation, in config order — 42 invocations): **1,278 passed, 7
deliberately skipped (the standing width/device guards: three `public-site` stories
at the other width, three `menu-reorder` pointer/touch stories at the width without
the input, one override story past its clock guard), zero failed and zero flaky** on
the first and only launch of every chunk (started 04:29, finished 05:16). No chunk
was re-run and no result is retry-masked. Phases 5–10 ran green behind phase 11,
unchanged; the public cache is still 5m/5m, no tracking cookie, no browser Supabase
client and no service client outside its two boundaries appeared, and no phase-12
work exists. The three `Testret` rows the locked menu suites leave behind are on the
database afterwards, as they have been since phase 5; they contaminated nothing.

---

## §0ad. Phase 12A — the Menu administration on a phone as the primary device (2026-09-03)

Phase 12 (§15) is one line in the plan — *"1x, 1y, 1z — the phone is the primary admin
device; full menu-edit and news flows completed on a 375 px viewport"* — and 12A is the
first half of it: the complete Menu workflow at 375 px, audited as a phone-first tool
rather than as a desktop layout that happens to fit. Phases 5–11 stay locked; nothing
about drafts, publishing, roles, the sold-out engine, deletion, reordering, pricing,
caching or the audit log changed. **Phase 12 is not locked**; 12B (News on the phone,
1z) is the next increment, and the remaining 1x/1q dashboard work is recorded below as
the third.

### What "the Menu workflow at 375 px" was taken to mean

The brief's list, read against 1y (the one approved mobile Menu frame), 1x (the way
in), 1r (the desktop counterpart, for what must not regress) and the phase-5, 6 and
10 lock sections. Every row was walked as Staff against a production build at
375 × 812 with touch, measured (viewport position of the key control, document
width, target sizes, computed focus ring, axe), and compared to the frame.

| Workflow | Where it stood | 1y / approved target | Material problem, if any |
|---|---|---|---|
| Reaching the menu | phase-4 dashboard card, "Åbn menuen" at 44 px, second card, in the first screen | 1x's tile list | none for the *route*; 1x's tile dashboard itself is not built (recorded as remaining scope, below) |
| Section navigation | one scrolling row of chips, no counts below `md`, `aria-current` | 1y's row that runs off the right edge | none |
| Menu overview | one card per dish: name, "Tryk for at rette", Pris tag, Tilgængelig/Udsolgt, the reorder strip | 1y's cards | none in the card; see the foot |
| Pending state | the band above the list: sentence, the names, a full-width button (153 px) | 1y's one-row band at the **foot** of the phone screen | **the band was a stacked block at the top**, and after a save the person is at the top anyway — but after any later scroll its Offentliggør was gone |
| Immediate Udsolgt / Slet ret and their ~10 s Fortryd | the green strip at the top of `<main>` | 1y's strip at the **foot** of the phone screen | **the strip was above the fold at the moment it appeared**: 302 px above the viewport after a toggle in the list (the router keeps the scroll position), 78 px above it after a toggle inside the editor (the `#ret-editor` fragment scrolls the panel to the top) |
| Dish editing | the panel *is* the screen; list hidden; heading "Ret", Kategori pre-selected; fields 48 px; price `inputmode="decimal"`; Gem 44 px; Slet ret at the far end of the footer row | 1y's editor (no separate frame; 1r's panel, stacked) | "Luk" was 40 px wide |
| Validation | errors under their fields, `aria-invalid`, `aria-describedby`, the panel scrolled into view by its fragment | existing convention | none (the "ugyldig" status notice at the top of `<main>` is above the fold, but the field errors are in view and bound) |
| Image selection | the 10C-1 picker: 337 × 345 px inside the 812 px viewport, scrollable within itself, Annuller focused, `Esc` back to the slot's own control | 1r's slot | none |
| Add dish | the dashed row at the end of the list; "Ny ret" with the section pre-selected; the new row at the end, "Ny ret — vises først …" | 1y's "+ Tilføj ret" | none |
| Reordering | the phase-5E strip on every card: handle 44 × 44, Flyt op / Flyt ned 129 × 44, 8 px apart, boundary buttons greyed, the polite live region | 1y's "hold on a row" (drawn as the handle since 5E) | **after Flyt op the moved row was out of sight** — the router scrolls a route transition to the top, and the focus recovery, measuring against a scroll still animating, found the row "already on screen" |
| Delete / restore | the `<dialog>`, Behold ret focused, `Esc` back to `#slet-ret`, backdrop inert, the Fortryd strip | one confirmation shape | Behold ret and Slet ret were side by side **8 px apart** on the phone |
| Preview / publish | Forhåndsvis and Offentliggør in the bar (two rows at 375), the band's own Offentliggør | 1y's bar (Offentliggør only) and band | none beyond the band's placement |
| Long content | a 200-character unbroken name, a 600-character description, "9.999,99 kr." | no sideways scrolling (1aa) | **the page scrolled sideways** with the unbroken name at 375; the price beside the switch wrapped inside its tag |

### What changed, and what each change is

Every change is presentation over the same page, the same Server Actions, the same
domain modules and the same URL state. No new route, no new component with business
logic, no client JavaScript beyond one adjusted effect, no dependency.

1. **1y's foot** — `app/(admin)/admin/menu/page.tsx`. The two immediate strips and
   the pending band are rendered in one container that, below `md`, is `sticky` to
   the bottom of the viewport and visually last (`order-last`), while staying **first
   in the DOM** where the three notices have always been: the tab order and the
   reading order are unchanged at every width, the live regions are in the tree
   before their text arrives, and from `md` the container is an ordinary block
   exactly where 1r draws its contents. It exists only when it has something to hold.
   The band is in the foot while the **list** is the screen and in flow above the
   editor while a dish is open — a publish control pinned under a thumb scrolling a
   half-typed form is the one thing 1y does not draw. Measured afterwards: the Fortryd
   is at y = 738 of 812 after a toggle in the list *and* after one in the editor.
2. **The band is one row** (`MenuPendingNotice`) — the sentence and Offentliggør side
   by side at every width, as 1y and 1r both draw it; the list of names beneath the
   sentence from `md` only. Each pending row already carries its Kladde badge and its
   own sentence, and a foot that grew a line per dish would eat the screen it is
   pinned to.
3. **Long content wraps** (`DishRow`, `UndoStrip`, `DeleteDishDialog`,
   `MenuPendingNotice`) — `overflow-wrap: anywhere` (`wrap-anywhere`) on the name, the
   pending sentence, the strip's message and the confirmation's question. `anywhere`
   rather than `break-word`, and it mattered: the name is a flex item, and only
   `anywhere` lets an unbroken word count as breakable when the item's minimum width
   is worked out — with `break-word` the card still grew past the screen (the first
   run of the new suite caught exactly that). The price group `flex-wrap`s so the
   control drops under "9.999,99 kr." rather than the card growing past the screen,
   and the price itself never breaks mid-number. No limit changed.
4. **The moved row stays in view** (`ReorderHandle`, `ReorderControls`,
   `app/layout.tsx`). Two halves. The focus recovery no longer passes
   `preventScroll`, so a browser scrolls only as far as it must — nothing on a desktop
   where the row is on screen, the row into view on a phone — and a focus the browser
   *kept* (Flyt op on a row that is still not first keeps its button, because the row
   is keyed) is brought into view without being moved; `scroll-mb-36` below `md`
   keeps both clear of the foot. The other half is the root layout's
   `data-scroll-behavior="smooth"`: `globals.css` sets `scroll-behavior: smooth` for
   the public chips, and Next 16 no longer switches that off by itself during a route
   transition's scroll to the top (its documented attribute asks for exactly the
   framework's earlier default) — without it that scroll was an animation still
   running when the effect measured, and the page glided away from the row it had
   just found "on screen". Hash-only changes keep their smooth scroll; the public
   site's in-page anchors are untouched. Measured afterwards: every variant walked
   (Flyt op / Flyt ned, tap and keyboard, first, middle and last row) ends with the
   moved row at y = 177 and the handle or the pressed button focused.
5. **The confirmation stacks** (`DeleteDishDialog`) — below `md` Behold ret and Slet
   ret are full width, the safe one first with a 12 px gap, the arrangement 1ae's sheet
   and the users-admin confirmations already use; from `md` the row is 1r's.
6. **"Luk" is 44 × 44** (`DishEditorPanel`) — `min-w-tap`; the words did not move.

### What was verified and deliberately left as it is

- **The card, the chips, the editor's field order and the picker** match 1y / 1r and
  the phase-5 and 10C-1 decisions; nothing was redrawn. The price field already asked
  the phone for a number pad (`inputmode="decimal"`); text fields are `type="text"`
  with `autocomplete="off"`; the description is a four-row textarea at 16 px, so iOS
  does not zoom.
- **The bar** keeps Forhåndsvis *and* Offentliggør at 375, wrapping to a second row.
  1y draws Offentliggør alone in the bar and no Forhåndsvis anywhere; the brief's §12
  requires preview reachable at 375, and moving it into the foot would hide it while
  nothing is pending. Recorded as a departure from 1y, in 1y's favour of function.
- **Toggling Udsolgt in the list keeps the scroll position** (measured: 521 → 519);
  the row the person pressed stays under their thumb and the strip is in the foot.
- **Validation keeps the existing convention** — the panel's fragment, the field
  errors in view and bound; focus is not moved to the first invalid field, as on
  every other editor. Recorded, not changed.
- **The reorder strip on every card** (handle, Flyt op, Flyt ned) is 5E's locked
  design for the phone and stays: 44 px targets 8 px apart, boundary state greyed and
  `disabled`, no drag library, no gesture required. A card is 192 px; five cards
  outrun the viewport, which is what the foot and the moved-row reveal are for.
- **Focus rings**: the computed ring is `3px solid rgb(180,116,26)` at 2 px on every
  keyboard-focused control (Gem, the chips, the picker's Annuller, the restored
  Slet ret and Vælg billede, the handle after a keyboard move). A control focused by
  a *tap* or by a script after a tap does not match `:focus-visible`, which is the
  platform's rule, not a missing ring.
- **The status notices after a save** land the person on the list at the top with
  "gemt som kladde" in view (the editor closes on Gem); after a Tapas or image save
  the fragment scrolls past the notice — the changed state itself is the
  confirmation there. Unchanged.

### Departures from the frames, recorded

| Frame | Departure | Why |
|---|---|---|
| ~~1r, 1y~~ | ~~No FOTO thumbnail on the dish rows~~ | **Closed, 2026-09-04** (`fix: match mobile menu dish thumbnails`). Re-reading 1y: the frame is the canvas's `.ph` photo slot — the same treatment as the public menu's "RETFOTO 4:3" — 60 × 52 at 8 px corners beside the name on the card, greyed and dimmed on the sold-out row, and 1r draws the same slot at 72 × 58. So it is the dish's photo, not decoration, and it is drawn now: `DishRow` renders the dish's *current* selection (`imageId`, the draft over the published value — the overlay every other figure on the row already shows, with the row's own "Ny billede afventer offentliggørelse" sentence) through the admin `ImageThumbnail` renderer, inside the editor link, with `alt=""` (the link's name is the dish's), from one `readAdminImageThumbnails()` read per section of exactly `id, storage_path, derivatives` — the smallest public rung, never the original. No photo draws the editor slot's own "Foto" frame at the same size, `aria-hidden`. Both widths, because both frames draw it and the row is one component. `tests/unit/menu/dish-row.test.tsx`, `tests/unit/content/images-thumbnails.test.ts`, and `menu-mobile` (the pending photo on the row, the guest's menu without it, the sold-out grey, the 200-character name beside a photo, the empty frame). |
| 1y | No "⋯" on the card | The whole card is the way into the editor and no approved menu lists what the three dots would hold. |
| 1y | "Hold på en række" is "hold på håndtaget" | Phase 5E's recorded decision: a gesture on the whole row fights scrolling; the handle is the hold target and the two buttons are the feature. |
| 1y | Forhåndsvis in the bar | See above. |
| 1x, 1q | The dashboard is still the phase-4 foundation | **Remaining Phase 12 scope.** 1x's tile list ("Hvad vil du lave?", the eight 68 px rows, the announcement card, LIGE NU) is shared by the Menu and the News flows and its link names are addressed by twelve locked suites (`Åbn menuen`, `Åbn beskeden`, …). It is one increment, not a side effect of 12A, and is listed below as 12C. |

### Responsive architecture

One page, one action layer, one domain layer; the phone is a set of `max-md:` /
`md:` variants over the same markup. The DOM order never differs between widths;
`order-last` and `sticky` move the foot visually only. No `/admin/mobile`, no
duplicated Menu component, no mobile Server Action, no alternate state, no second
picker, no JavaScript-driven layout: the one script change is the reorder handle's
focus recovery, which now lets the browser scroll. Bundle: no new client component;
`ReorderHandle` grew by one branch.

### Accessibility and touch, measured

axe (WCAG 2.0/2.1/2.2 A+AA) reported zero violations at 375 on the dashboard, the
list, the list with a pending row and the band, the editor, the refusal state, the
picker, the sold-out state, the create panel, the list with the longest content, and
the confirmation — and at 1440 on the states the locked `a11y/menu-admin` file already
scans. The tap-target sweep at 375 (every `a`, `button`, `select`, and every label
that *is* the control) found nothing under 44 × 44 after the "Luk" change — "Ejer-
området" on the dashboard is inside a sentence and exempt, as recorded in §13 item H.
No horizontal scrolling on any state, including the 200-character name and the
maximum price. Keyboard: `Tab` from Navn reaches Gem in twelve stops in the drawn
order; the confirmation and the picker open on the safe control and hand focus back
to the control they came from through the address; the page behind a dialog is
inert; a tap beside the sheet does nothing. Screen-reader semantics unchanged from
phase 5: state in words on every control ("Tilgængelig — Thor. Skift til udsolgt."),
the dish in every Flyt / Slet / Fortryd name, the section in the list's name, the
live region for a move.

### Tablet and desktop

768 and 1440 were captured before and after for the list, the editor, the pending
state and the confirmation. The foot is an ordinary block from `md` where the three
notices were; the band is one row (as 1r); the confirmation's footer is 1r's row; the
row's price group has room and does not wrap. Nothing in 1r moved.

### Tests

- **`tests/e2e/menu-mobile.spec.ts`** under one dedicated project, **`menu-mobile`**
  (375 × 812, touch), the new tail of the chain after `users-admin`, and under no other
  project: eighteen stories — the way in from the dashboard, the chips, the editor,
  the save with the band in view, the band at the bottom of a long section, the
  picker (fit, focus, `Esc`, choose, remove), Udsolgt from the list and from the
  editor with the Fortryd inside the viewport, Forhåndsvis, Offentliggør from the
  foot and the first guest request, Flyt op with the moved row in view, a temporary
  dish, the longest content with no sideways scrolling, an invalid edit, the stacked
  confirmation, delete and restore, Owner parity, and the seed restored. It uploads
  its one library image through the real screen and removes it through the library's
  own Slet.
- **No locked phase-5 test was changed.** `playwright.config.ts` gains the project and
  the two `testIgnore` entries; `npx playwright test --list` shows the file under
  exactly `menu-mobile` (18) and the four `a11y/*` files under `desktop` and `mobile`
  only.
- The walkthrough itself was a temporary Playwright harness (`tests/lockpass/`,
  `playwright.lockpass.config.ts`) over the e2e support helpers, deleted before the
  chain and never committed, as in §0y and §0ac. Its screenshots (every state at
  375, the main ones at 768 and 1440) and its JSON measurements are in the session
  scratchpad.

### The regression

From a clean tree: every port-3100 owner stopped, `npm ci`, `npm run db:reset:full`
(every test Auth identity gone, the two seeded ones as `npm run db:users` leaves
them), a twenty-second settle, `.next` emptied, a fresh production build, no stale
server. Typecheck, lint and the source policy clean; **2,576 unit tests in 100
files**; **2,030 pgTAP assertions in 28 files**, from real anonymous, Staff and Owner
JWTs and two dblink sessions; **25 integration tests in 4 files** against the real
local stack and the mail catcher; `npm audit --audit-level=high` clean (0
vulnerabilities); `npx playwright test --list` collecting **1,303 tests in 38 files
across 45 projects**, with `e2e/menu-mobile` under exactly its one dedicated project
(18 stories), every other write suite under exactly its own projects as before, the
four `a11y/*` files under `desktop` and `mobile` only, and no stale `testIgnore`
entry; and the complete Playwright matrix at `--retries=0`, run as the chunked chain
against one detached production server (the read-only trio together, every write
project in its own `--no-deps` invocation, in config order — 43 invocations):
**1,296 passed, 7 deliberately skipped (the standing width/device guards: three
`public-site` stories at the other width, three `menu-reorder` pointer/touch stories
at the width without the input, one override story past its clock guard), zero
failed and zero flaky** on the first and only launch of every chunk (started 18:57,
finished 19:42). No chunk was re-run and no result is retry-masked. Phases 5–11 ran
green behind phase 12A, unchanged; the public cache is still 5m/5m
(`public-cache`, 3 passed), no tracking cookie (the `menu-mobile` guest context
asserts an empty cookie jar on the first request after a publish), no browser
Supabase client and no service client outside its two boundaries appeared
(`tests/unit/policy`), and no phase-12B (News) and no phase-13 work exists.

Two facts about the run worth keeping: the chain's first launch died in `npm ci`
with `EPERM` on the SWC binary because the detached server from the focused
pre-run still held it — the chain now stops every port owner before `npm ci`, and
the relaunch is the run reported here; and the new suite's own first run, against
a database the earlier walkthrough had left with an unpublished move, published that
move through the next suite's baseline and failed `menu-reorder` downstream — the
suite's cleanup now clears every dish draft, and the certified chain started from
a reset. Neither was a product defect.

### What 12B owes — News on the phone (1z)

1z draws two screens: the list of cards (title, "Offentliggjort DD.MM.ÅÅÅÅ" or the
Kladde card with "Rettet …", the "+ Ny" in the bar) and the editor (Overskrift at
19 px, the category chips, the B/Link toolbar and the body at 16 px, the image slot,
Forhåndsvis / Offentliggør side by side at the end, and the autosave note). 12B is
the same audit over `/admin/nyheder` at 375: the list's cards and their state words,
the editor's structured body with the software keyboard (the toolbar reachable while
the keyboard is up; `Ctrl+B` has no phone equivalent — the B button is the path),
autosave's status line and its `sr-only` region, the per-article publish/unpublish
confirmations as one dialog shape stacked on the phone, the image picker on the
article, the slug policy's refusals readable at 375, the same long-content and
tap-target sweeps, and a dedicated `news-mobile` project at the tail. The dashboard
(1x / 1q) is **12C**: the tile list at 375 and the three-column grid from `md`, the
announcement card with its state and "Rediger besked", the pending band's count with
the phase-4 per-item list beneath it, LIGE NU, and — because twelve locked suites
address the current link names — a coordinated rename of `Åbn …` to the tiles'
names in the support helpers, in one commit, after 12B.

---

## §0ae. Phase 12B — the News administration on a phone as the primary device (2026-09-04)

The second half of phase 12 (§15): the complete News workflow at 375 px, audited as a
phone-first tool against frame **1z** ("Nyheder + editor — mobil") the way 12A audited
the Menu against 1y (§0ad). Phases 5–11 stay locked, phase 9 included: nothing about
the status model, the draft/published semantics, the published-edit-is-live rule, the
autosave machine, the frozen slug, the structured body, B and Link only, `https:`
only, the audit rows, the cache contract, the metadata or the delete/unpublish
transitions changed. **Phase 12 is not locked**; 12C (the 1x / 1q dashboard) remains
and is recorded at the end of this section.

### What 1z requires, and what merely had to survive 375 px

1z draws two screens and nothing else. **The list**: a burgundy bar with `‹ Tilbage`,
"Nyheder" and a white "+ Ny" pill; one card per article — the title, a line saying
"Offentliggjort DD.MM.ÅÅÅÅ" or "Rettet DD.MM.ÅÅÅÅ", and the state as a pill in words
with its own shape (green dot "Udgivet", amber diamond "Kladde"), the draft card in the
warning tone. No thumbnail, no placeholder frame, no preview link, no delete on the
list. **The editor**: `‹ Nyheder`, "Ny nyhed" and the Kladde pill in the bar;
Overskrift; the category chips; the Tekst box with the **B / Link** toolbar at its top
and the body at 16 px; the dashed Billede slot; **Forhåndsvis and Offentliggør side by
side** at the end; and the note *"Gemmer selv som kladde, mens der skrives — intet går
tabt, hvis telefonen låser midt i en vagt."* 1s (desktop) adds "Gemt for lidt siden"
beside the badge in the bar, Slet, "Fjern fra hjemmesiden" and the date field. So the
frame itself requires: the card list with its state words, the two-button toolbar at
the top of the writing box, the slot, the two end controls, and an editor whose
autosave the person can trust. Everything else on the screen — the §7f address line,
the Gem fallback, the date, "Ingen kategori", Slet, Fjern fra hjemmesiden, Forhåndsvis
on the list — is the locked 9A/9B/10C-1 design that had to remain *usable* at 375, not
something 1z asks for.

### What the walkthrough found

Every row was walked as Staff against a production build at 375 × 812 with touch by a
temporary Playwright harness (`tests/lockpass/`, deleted before the chain, as in §0y,
§0ac and §0ad), measured — the viewport position of the key control, the document
width, target sizes, computed font sizes, the focus ring, axe — and compared to 1z.

| Workflow | Where it stood | Material problem, if any |
|---|---|---|
| The list | 1z's cards, state in words, "+ Ny nyhed" and Forhåndsvis in a two-row bar (124 px), every target 44 px, no sideways scrolling | **the title was `truncate`d** — a 200-character title read "Lockpass 12B: Nordisk bur…", and two articles beginning alike could not be told apart |
| A new article | 16 px in every editable control (the title, the date, the body, the link address — iOS does not zoom), 44 px chips, the slot saying why it is closed | the slot's sentence said "gemt første gang" while the bar already said "Gemt for lidt siden" — autosave had created the row, but the slot needs the Gem navigation to render |
| The first save | autosave created the row with the screen unmoved (scrollY 46 → 46) and the keyboard still in the text; Gem then rendered the badge, the address and the slot | the outcome notice and the badge were **above the viewport** after Gem's `#nyhed-editor` fragment (y = −75 and −145) |
| A long article, caret at the end | Gem in view; the text itself fine | **the bar with the badge and the autosave line was 2,868 px above the viewport, the B/Link toolbar 2,185 px above it** — with a 440 px keyboard viewport the same; a published article's "Gemt — ændringerne er på hjemmesiden" was equally out of reach (y = −2,861) |
| Bold, Link | the operations themselves correct; the panel 307 px wide, its input 16 px, focus into the address field and back to the text, `http:` refused | the panel opened **at the top of the writing box** — thousands of pixels from the selected words |
| The picker | 337 × 345 inside the viewport, Annuller focused, `Esc` back to `#vaelg-billede`, choose and remove as 10C-1 | none |
| Validation, the slug | the field error in view and bound, the `ugyldig` notice above the fold (the phase-5 convention, unchanged) | **the address line under the title made the editor scroll sideways** with a 200-character title ending in an unbroken word (one monospace run) |
| Preview | the real `/nyheder/[slug]` in Draft Mode | **the public article page scrolled sideways at 375** (1,039 px) with a body containing an unbroken 120-character run — valid content the editor accepts |
| Publish, unpublish, delete | the sheets inside the viewport, the safe choice focused, `Esc` back to the control, the backdrop inert | the two choices were **side by side 8 px apart** (publish, delete) or wrapped into a ragged second line (unpublish) |
| Long content | no sideways scrolling in the editor (Chrome's `contenteditable` wraps an unbroken run itself), the long link readable | none in the editor |
| Autosave during a long edit | scrollY unchanged before, during and after the save; focus kept in the text; `replaceState` only on creation | none — the one-in-flight machine needed nothing |

### What changed, and what each change is

Every change is presentation over the same page, the same Server Actions, the same
domain modules and the same URL state. No new route, no new component, no client
JavaScript, no dependency. Every file touched is a phase-9 or shared admin component
changed in its class strings; the one public-side file (`NewsBody.tsx`) changed by
one class because the walkthrough proved a defect — the rule this brief set.

1. **The editor's bar is pinned on the phone** (`AdminSectionBar pinned`,
   `app/(admin)/admin/nyheder/page.tsx`). Below `md` the news editor's bar is `sticky`
   at the top of the screen, and it lays its children out as bar items rather than one
   group (`display: contents` on the phone only): the Kladde/Udgivet badge shares the
   first row with `‹ Nyheder` and the title — exactly 1z's row — and the autosave line
   takes a row of its own. The row is **reserved** (`NewsAutosave` renders its `<p>`
   empty with a 20 px minimum height on the phone; from `md` an idle line still
   renders nothing), so the bar is two rows of fixed height — 100 px — and never grows
   by a row on the first keystroke. Measured afterwards, at the end of an eight-
   paragraph article and again with a 440 px keyboard viewport: the badge at y = 17,
   the status line at y = 68, "Gemt — ændringerne er på hjemmesiden" in view while the
   published article is edited at its end. The DOM order is unchanged; the list's bar
   and every other section bar are exactly the blocks they were.
2. **The B/Link toolbar and its link panel stick under the bar** (`NewsBodyField`).
   One wrapper around the toolbar and the panel is `sticky` at `top: 6.25rem` below
   `md` — the bar's fixed height, which is why the height had to be fixed. The writing
   box is `overflow-clip` rather than `overflow-hidden`: both clip to the rounded frame,
   but `hidden` makes the frame a scroll container and would have pinned the toolbar to
   the frame instead of the screen. Measured: B and Link at y = 106 with the caret at
   the end of the article, and 283 px of text still visible under them with the
   keyboard viewport; the link panel opens at y = 157 with its address field focused,
   while the selected words stay within a line of where they were (scroll anchoring
   absorbs the panel's height). From `md` the group is 1s's row at the top of the box.
3. **Fragment targets land under the bar, not beneath it** (`app/globals.css`): below
   `md`, `html:has(.admin-bar-pinned)` sets `scroll-padding-top: 7rem`, so Gem's
   `#nyhed-editor`, a cancelled confirmation's `#offentliggoer-nyhed` and the picker's
   `#vaelg-billede` all arrive below the pinned bar. A side effect worth having: after
   Gem, publish and unpublish the outcome notice (y = 37) and the badge are now inside
   the viewport, where the fragment scroll used to put them above it.
4. **The confirmations stack** (`NewsConfirmDialog`) — below `md` the safe choice and
   the committing one are full width, the safe one first, 12 px apart, the arrangement
   1ae's sheet, the users-admin confirmations and 12A's `DeleteDishDialog` use; from
   `md` the footer is 1s's row. The question wraps `anywhere`, because it quotes the
   title.
5. **Long content wraps** — the list title (`NewsAdminList`: `wrap-anywhere`, no
   `truncate`; a 200-character title makes a 306 px card and stays inside it with the
   pill beside it), the §7f address line (`NewsEditorForm`), the confirmation's
   question, and — the one public-side change — the article paragraph
   (`components/site/news/NewsBody.tsx`: `wrap-anywhere` on the `<p>`), because the
   preview step of the phone flow met a public page that scrolled sideways. No limit
   changed.
6. **The slot's sentence says what to do** — "Billedet kan vælges, når nyheden er gemt
   første gang. Tryk Gem kladde, så åbner feltet." The locked rule stands: an article that does not
   exist as a row cannot select an image, autosave creates the row without a
   navigation, and the Gem is what renders the slot. The wording now bridges the gap
   instead of contradicting the bar.

### What was verified and deliberately left as it is

- **Autosave** is the 9B machine untouched: a 2 s debounce, one save in flight, no
  save of unchanged content, `replaceState` once on creation; the screen does not move
  and focus is not taken on any save, measured at the top of the form and at the end
  of a long article. The `sr-only` live region is unchanged and still role-less
  (§0r); the visible line simply has a reserved row on the phone.
- **The published rule** — a saved edit is public at once — is said on the phone by
  the two things now pinned in view while the person types: the "Udgivet" badge and
  "Gemt — ændringerne er på hjemmesiden". `describeSaveConsequence`'s sentence beside
  Gem is unchanged and stays at the foot of the form.
- **The image picker** is 10C-1's, unchanged; the slot's `Skift billede` / `Fjern
  billede` are 44 px and in the flow after the form, as 10C-1 recorded.
- **Slug behaviour**: the address follows the title until first publish (proved again
  with a 200-character Danish title), locks at publish, and the collision and stale
  refusals are the 9A sentences, readable at 375 in the notice under the pinned bar.
- **The link panel's rule** (absolute `https:` only, ≤ 2048) is unchanged in all three
  layers; the phone story refuses `http:` and applies a 400-character `https:` address.
- **The footer row** (Slet / Forhåndsvis på hjemmesiden / Offentliggør or Fjern fra
  hjemmesiden) stays stacked full width at 375. 1z draws Forhåndsvis and Offentliggør
  side by side with no Slet; "Forhåndsvis på hjemmesiden" is 1s's own label and does
  not fit beside Offentliggør in 343 px. Recorded as a departure, in favour of the
  locked label.
- **No sticky foot.** 1z draws none, and unlike the Menu nothing here is a ten-second
  Fortryd: the phone's pinned chrome is the bar and the toolbar at the top, which is
  where 1z draws both.
- **No thumbnail on the list card** — 1z draws neither a photo nor a placeholder frame
  on the news cards (unlike 1y's dish cards), so none is drawn.
- **Focus rings**: `3px solid rgb(180,116,26)` at 2 px on the toolbar's buttons reached
  by `Shift+Tab` from the text, on the footer links and on every dialog control.
- **Keyboard**: `Esc` from each of the three confirmations and from the picker is a
  real navigation back to the control it came from, and the control is focused; the
  fragment scroll is the site's smooth one, so the suite polls for it. The alert
  states (conflict, failure, vanished) are the locked 9B behaviour and are covered by
  `news-admin`; on the phone a conflict's four lines make the bar taller than its
  reserved 100 px and the stuck toolbar's top is covered by the difference while the
  alert stands — autosave has stopped in that state and the person's task is to copy
  their text, so this is recorded rather than engineered around.

### Departures from the frames, recorded

| Frame | Departure | Why |
|---|---|---|
| 1z | The list's bar wraps to two rows at 375 ("Forhåndsvis" and "+ Ny nyhed" under `‹ Tilbage` / "Nyheder") | 9A added the list's Forhåndsvis, accepted at 9's lock; the locked suites address the link by its full name "+ Ny nyhed". Every control is 44 px and the first card is at y = 225. |
| 1z | Forhåndsvis / Offentliggør stacked, not side by side; Slet and Fjern fra hjemmesiden present | 1s's labels and controls, locked at 9. |
| 1z | The bar carries a second row for the autosave line | 1s's "Gemt for lidt siden", which 1z's static artboard omits; on the phone the line is the one place the published-edit rule is visible while typing. |
| 1z | The date field and "Ingen kategori" | Accepted at 9A (§0s). |
| 1z, 1s | The B/Link toolbar sticks under the bar | 1z draws the toolbar at the top of the box; on a long article that box top is off screen, and the brief's §6/§7 require the toolbar reachable while editing. Measured, not assumed. |
| 1x, 1q | "Åbn nyhederne" is at y = 1,082 on the dashboard at 375 | The phase-4 dashboard; **12C**. |

### Responsive architecture

One page, one action layer, one domain layer; the phone is a set of `max-md:` /
`md:` variants over the same markup. The DOM order never differs between widths;
`sticky` and `display: contents` move things visually only. No `/admin/mobile`, no
second editor, no second picker, no mobile Server Action, no alternate state, no
keyboard-detection script, no scroll restoration, no `ResizeObserver`: the one
measurement the layout depends on — the bar's height — is made a constant instead of
measured. Bundle: no new client component; `NewsAutosave` and `NewsBodyField` changed
class strings and one wrapper element; `AdminSectionBar` gained one boolean prop.

### Accessibility and touch, measured

axe (WCAG 2.0/2.1/2.2 A+AA) reported zero violations at 375 on the list, the empty
editor, the saved draft, the editor with a photo, the open link panel, the picker, the
refusal state, the published editor, and the three confirmations — and at 1440 on the
states the locked `a11y/news-admin` file scans. The tap-target sweep at 375 (every
`a`, `button`, `select`, the date control, and every label that *is* the control)
found nothing under 44 × 44 on any state; the toolbar's B is 44 × 44 and Link 57 × 44.
No sideways scrolling on any state, including the 200-character title on the list, in
the editor and in the confirmation, the 400-character link, the unbroken 120-character
run, and the public preview of all three. 16 px in every editable control. Screen-
reader semantics unchanged from phase 9: the state in the pill's words, the badge's
words, `aria-pressed` on B, the labelled `role="textbox"`, the field errors bound by
`aria-describedby`, the confirmations named by their question, the alert-only live
region.

### Tablet and desktop

768 and 1440 were captured before and after for the list (short and 200-character
titles), the empty editor, the saved draft, the editor with a photo, the long article,
the published editor and the three confirmations. From `md` the bar is the block it
was (the idle line renders nothing), the toolbar is 1s's row at the top of the box,
the confirmations' footers are 1s's row, and the list is the same column of cards.
Nothing in 1s moved.

### Tests

- **`tests/e2e/news-mobile.spec.ts`** under one dedicated project, **`news-mobile`**
  (375 × 812, touch), the new tail of the chain after `menu-mobile`, and under no other
  project: fifteen stories — the way in from the dashboard and the list, the editor's
  phone-ready fields under the pinned bar, autosave creating the draft with the line in
  view and no scroll, the picker (fit, focus, `Esc`, choose), the end of a long article
  with the badge, the line and B/Link on screen (and with the keyboard viewport), B
  and Link from deep in the text with the panel opening in place, the longest content
  in the editor / on the list / in the confirmation / on the public preview, a refused
  save in view, the stacked publish confirmation and its `Esc`, publish and the first
  guest request with no cookie, the live edit said in the pinned bar and read by the
  guest, the stacked unpublish confirmation and the 404, the stacked delete
  confirmation with the inert backdrop, Owner parity, and the seed restored. It uploads
  its one library image through the real screen and removes it through the library's
  own Slet.
- **`tests/unit/news/phone-layout.test.tsx`** (6 tests) pins the four class decisions
  as server markup: the pinned bar (and the unpinned bar unchanged), the wrapping title,
  the stacked dialog with the safe control first, and the public paragraph's wrap.
- **No locked phase-9 test was changed.** `playwright.config.ts` gains the project and
  the two `testIgnore` entries; `npx playwright test --list` shows the file under
  exactly `news-mobile` (15) and the four `a11y/*` files under `desktop` and `mobile`
  only. `editor-images` still finds "Billedet kan vælges, når nyheden er gemt første
  gang" by substring.

### Recorded for the FINAL SECURITY AUDIT (phase 13) — carried, unchanged

- The news audit-insert tolerance (§0s): a published autosave's content UPDATE and its
  `log_audit` INSERT are two statements, not one transaction. Untouched by 12B, which
  changed no action.

### The regression

From a clean tree: every port-3100 owner stopped, `npm ci`, `npm run db:reset:full`
(every test Auth identity gone, the two seeded ones as `npm run db:users` leaves
them), a twenty-second settle, `.next` emptied, a fresh production build, no stale
server. Typecheck, lint and the source policy clean; **2,590 unit tests in 103
files** (+6 in the one new file); **2,030 pgTAP assertions in 28 files**, from real
anonymous, Staff and Owner JWTs and two dblink sessions — unchanged, because no
function, grant or table moved; **25 integration tests in 4 files** against the real
local stack and the mail catcher; `npm audit --audit-level=high` clean (0
vulnerabilities); `npx playwright test --list` collecting **1,319 tests in 39 files
across 46 projects**, with `e2e/news-mobile` under exactly its one dedicated project
(15 stories), `e2e/menu-mobile` under exactly `menu-mobile` (19), every other write
suite under exactly its own projects as before, the four `a11y/*` files under
`desktop` and `mobile` only, and no stale `testIgnore` entry; and the complete
Playwright matrix at `--retries=0`, run as the chunked chain against one detached
production server (the read-only trio together, every write project in its own
`--no-deps` invocation, in config order — 44 invocations): **1,312 passed, 7
deliberately skipped (the standing width/device guards: three `public-site` stories
at the other width, three `menu-reorder` pointer/touch stories at the width without
the input, one override story past its clock guard), zero failed and zero flaky** on
the first and only launch of every chunk (started 16:06, finished 16:53). No chunk
was re-run and no result is retry-masked. Phases 5–12A ran green behind phase 12B,
unchanged — the two phase-9 news projects (33 + 33), the four image projects, and
`menu-mobile` among them; the public cache is still 5m/5m (`public-cache`, 3
passed), no tracking cookie (the `news-mobile` guest context asserts an empty cookie
jar on the first request after a publish), no browser Supabase client and no service
client outside its two boundaries appeared (`tests/unit/policy`), and no phase-12C
(dashboard) and no phase-13 work exists.

One fact about the build-up worth keeping: the focused pre-run failed the locked
`editor-images` pair once, because the slot's sentence had been reworded to
"…første gang — tryk Gem kladde." and that suite matches "…første gang." with its
full stop. The sentence was restored and the hint appended as a second sentence; the
locked test was not touched. The certified chain is the run after that correction.

### What 12C owes — the dashboard (1x / 1q)

1x's tile list at 375 ("Hvad vil du lave?", the eight 68 px rows, the announcement
card with its state and "Rediger besked", the pending band's count with the phase-4
per-item list beneath it, LIGE NU) and 1q's three-column grid from `md` — and, because
twelve locked suites address the current link names (`Åbn menuen`, `Åbn nyhederne`,
`Åbn beskeden`, …), a coordinated rename to the tiles' names in the support helpers, in
one commit. The two measured facts this phase leaves for it: "Åbn menuen" and "Åbn
nyhederne" sit at y ≈ 1,082 on a 2,035 px dashboard at 375, below the fold. Nothing
in 12A or 12B pre-empts it: the section bars' `‹ Tilbage` / `‹ Oversigt` labels and
the dashboard's cards are exactly phase 4's.

---

## §0af. Phase 12C — the dashboard on a phone, and the rest of the phone's operational screens (2026-09-04)

The third increment of phase 12 (§15): the administration's landing screen built to
frames **1x** ("Oversigt — mobil") and **1q** ("Oversigt — desktop"), and an audit of
the operational screens the phone reaches from it that 12A and 12B had not walked —
Ugens ret, Månedens burger, Besked på hjemmesiden, Åbningstider, the image library and
the phase-11 editors. Phases 5–11 stay locked; 12A and 12B stay as accepted. Nothing
about drafts, publishing, roles, the sold-out engine, the announcement's temporary
model, the generated message, ownership, caching or the audit log changed. **Phase 12 is
not locked**; the remaining lock-pass scope is recorded at the end of this section.

### What 1x and 1q establish, and what stays entity-driven

The two frames were read directly, not inferred from the phase-4 dashboard. What they
draw, and is therefore contract:

| Element | 1x (375) | 1q (1100) |
|---|---|---|
| Bar | logo, "Administration", "Se siden" | wordmark ("Klingenberg Food" / "Administration"), *"Logget ind som Navn · Ejer"*, "Se hjemmesiden", "Log ud" |
| Pending band | under the bar, amber: diamond, "2 ændringer er ikke offentliggjort", **Forhåndsvis** and **Offentliggør** side by side, full width, 48 px | the same band as one row: the count, a sub-line naming what waits ("Overskrift på forsiden · 1 pris i Burgere"), Forhåndsvis, "Offentliggør ændringer" |
| Heading | "Hvad vil du lave?" (24 px Bricolage), "Onsdag · åbent 15:00–20:00" | "Hej — hvad vil du lave?" (32 px), the same line |
| Announcement card | "Besked på hjemmesiden", the **Vises nu** pill, the message in quotation marks, "Rediger besked" full width | the same with the glyph and *"Forsvinder af sig selv søndag 14.09.2026 kl. 20:00"*, "Rediger besked" at the row's end |
| Tiles | eight 68 px rows, glyph + label + one supporting line + chevron: Rediger menu · Skriv en nyhed · Åbningstider · Rediger forsiden · Billeder · Kontaktoplysninger · Besked på hjemmesiden · Mad ud af huset | six cards in three columns (no Besked tile — the card above carries it) and Mad ud af huset as a full row |
| LIGE NU | one card at the foot: I dag · Retter på hjemmesiden · Markeret udsolgt | three cards: LIGE NU (Retter på hjemmesiden, Markeret udsolgt, Offentliggjorte nyheder), SENESTE NYHED (title, Udgivet pill, DD.MM.ÅÅÅÅ, "Rediger"), DAGENS ÅBNINGSTID (15:00–20:00, Onsdag, "Ret kun i dag") |

Both frames draw the announcement card **on the published state only**, and neither
draws a metric, a chart or an activity feed: the numbers are the three (four) rows
above and nothing else. 1q's own caption is the rule the tile list follows: *"Syv
store mål i almindeligt dansk. Ingen sidemenu, ingen 'Indstillinger', ingen
'Indlæg / Sider / Medier'."*

What is **entity-driven** and drawn in the frames' language rather than by them: four
destinations exist that neither frame lists, and a person has to be able to reach
them — **Ugens ret** and **Månedens burger** (phase 6's two screens, until now reachable
only through the menu screen's chip and notice), **Brugere** (11C, Owner) and **Om os**
(the one page still edited on the phase-4 content screen, `/admin/indhold`). They are
tiles in the same list, recorded here as additions. The phase-4 "Din konto" card with
its "Ejer-området" sentence is gone: the bar states the account, and `/admin/ejer` —
phase 1's proof page — is unlinked and untouched.

### The dashboard as a read model

The screen owns no state and defines no rule. Everything it says is read from the
locked systems through the reads they already expose, worded by the functions those
systems already use, and computed by one pure module — `lib/admin/dashboard.ts`
(`describeToday`, `countMenu`, `summariseNews`, `describePendingCount`), unit-tested
with the clock held still:

- **the band and its list** — `pending_changes`, the view that *is* the definition of
  pending (§4), through `readPendingChanges()`; the count is the row count, the
  band's Forhåndsvis lands on the most recently edited row's page (Draft Mode is
  site-wide once started), and the
  phase-4 per-item list — checkbox, state, editor, time, per-item Forhåndsvis, "Kun
  ejeren kan offentliggøre dette" — sits beneath it, unchanged in what it says;
- **the announcement card** — the published row through `readAdminAnnouncement()`,
  its state by `describeAnnouncementState()` (phase 7's four badges: Vises nu, Slået
  fra, Udløbet, Ingen besked) and its expiry by `formatExpiryWeekdayStamp()` — the
  formatter 1t's helper already used; a pending draft is not shown, because a guest
  has not seen it;
- **today's line, the "I dag" row and DAGENS ÅBNINGSTID** — the published schedule and
  overrides through the ordinary cached `readOpeningHours()`, decided by the phase-2
  engine (`getOpenState().today`, overrides honoured in both directions); "åbent" is
  *the day has hours*, which is what both frames print at any time of that day, not
  the Forside's minute-by-minute badge;
- **"Retter på hjemmesiden" and "Markeret udsolgt"** — the published menu as a guest
  reads it (`readMenuContent()`, the same cached, tag-expired read the menu page
  renders from; hidden sections, deleted and never-published rows already excluded),
  with "sold out" decided by §7b's one `resolveSoldOut()` so a dish that has reset is
  not counted;
- **"Offentliggjorte nyheder" and SENESTE NYHED** — the administration's own list
  through the phase-9 status model; "latest" is by `published_at`, which is the fact
  the card prints.

No table, no cache of its own, no second copy of anything; a Draft Mode session takes
the two cached reads down their preview path exactly as the weekly and monthly screens
already do for the hours.

### The role-aware tiles — the §5 matrix as data, stated once

`app/(admin)/admin/dashboard-tiles.ts` is the list. A tile that opens an editor for a
publishable entity takes its role from the registry (`lib/publishing/entities.ts`,
`requiredRole`) through `mayChangeEntity()` — the same function the pending list and
the publish action ask — so Rediger forsiden and Kontaktoplysninger are Owner tiles
because the registry says so. Billeder is every active staff member's and Brugere the
Owner's, the two capabilities with no entity behind them (§5). Åbningstider is drawn
for both roles because both have a card on that screen (§0j), and its supporting line
says which half is whose: "Ret tider for en dag" (1x / 1q's own words) for Staff,
"Ugens faste tider, og ret tider for en dag" for the Owner. A hidden tile is a
courtesy and nothing more: every screen calls its own guard, every action re-checks,
RLS decides again — proved once more by the new suite, which sends a Staff member to
`/admin/brugere` and `/admin/forsiden` by address and meets `/admin/ingen-adgang`.

### The vocabulary migration — one commit

The phase-4 dashboard's links were sentences ("Åbn menuen", "Åbn nyhederne", "Åbn
beskeden", "Åbn åbningstiderne" / "Ret tider for en dag", "Åbn billederne", "Åbn
forsiden", "Åbn kontaktoplysningerne", "Åbn brugerne", "Åbn mad ud af huset", "Åbn
indhold"), and twelve locked suites and three support helpers addressed them by those
words. The final vocabulary is the tiles' — the words a person reads on them, which are
the link's accessible name (`aria-labelledby`), with the supporting line as its
description (`aria-describedby`):

| Was | Is | Addressed by |
|---|---|---|
| Åbn menuen | **Rediger menu** | `menu-mobile`, `users-admin` |
| Åbn nyhederne | **Skriv en nyhed** | `news-admin`, `news-mobile` |
| Åbn beskeden | **Rediger besked** (the card's control) | `support/announcement-admin` |
| Åbn åbningstiderne · Ret tider for en dag | **Åbningstider** (described per role) | `support/hours-admin`, `opening-hours`, `opening-hours-override` |
| Åbn billederne | **Billeder** | `image-library` |
| Åbn forsiden | **Rediger forsiden** | `homepage-admin` |
| Åbn kontaktoplysningerne | **Kontaktoplysninger** | `contact-admin` |
| Åbn brugerne | **Brugere** | `users-admin`, `a11y/users-admin` |
| Åbn mad ud af huset | **Mad ud af huset** | `takeaway-admin`, `a11y/admin-pages` |
| Åbn indhold | **Om os** | `a11y/admin-pages` |
| "Offentliggør valgte ændringer" | **Offentliggør** (the project's one label for the control, as every band and bar) | `support/admin`, `draft-publish` |
| `<h1>` "Hej, Navn" | the bar's *"Logget ind som Navn · Rolle"*; the `<h1>` is 1q's "Hej — hvad vil du lave?" | `users-admin` |

Every migrated locator uses `exact: true` against the accessible name, and the one
page-wide text assertion a tile label collided with — `draft-publish`'s "Om os is no
longer pending" — is scoped to the pending form, as its sibling assertions already were.
The band itself carries no `role="status"`: it is a standing state inside a form that
names itself, and the locked suites read the page's first `status` as the publish
report, which stays the notice below the band. No test was weakened: the `opening-hours` assertion that a Staff member is offered the one-off
change "in its own words" now reads the tile's accessible description, and the
`users-admin` proof that an invitee's profile carries their name now reads the bar.
The form's name "Ændringer der venter", the per-item checkbox names, the row's
"Forhåndsvis" and "Kun ejeren kan offentliggøre dette" are unchanged. No public
navigation was renamed; the section bars' "‹ Oversigt" / "‹ Tilbage" are phase 4's.

### 375 — measured against 1x

Before, the Staff dashboard was 2,035 px tall (the Owner's 2,568) with "Åbn menuen" the
only destination in the first screen and "Åbn nyhederne" at y = 1,082. After: 1,271 px
(Staff) and 1,505 px (Owner); the bar, the heading, today's line, the announcement
card and the first **five** tiles — Rediger menu, Ugens ret, Månedens burger, Skriv en
nyhed, Åbningstider — inside the first 812 px; every tile a 343 × 68 px link (1x's 68);
"Rediger besked" 310 × 48; no sideways scrolling with a 90-character announcement
(the schema's ceiling) or the long tile lines; the tap-target sweep (every link,
button and checkbox) found nothing under 44 × 44; axe zero at 375 for Staff and Owner,
with the band and the list, and with the long announcement live. `Tab` walks the bar,
"Rediger besked" and the tiles top-down; the computed ring on a tile is
`3px solid rgb(180,116,26)` at 2 px. Nothing is behind hover.

One departure from 1x: the bar is **two rows** on the phone, because 343 px does not
hold the wordmark, the account line and both controls, and the account line is on the
phone deliberately — who is signed in is the one fact a shared phone at the counter
must show (and the `users-admin` proof reads it there). "Logget ind som" is spoken but
not drawn below `md`; "Se siden" is 1q's "Se hjemmesiden" at every width, one label.

### 768 and 1440 — measured against 1q

From `md` the tiles are cards (glyph, 20 px label, 15 px line), the Besked tile is
hidden (1q's card carries it), Mad ud af huset spans the grid, and LIGE NU becomes
1q's three cards. At 1440 the grid is 1q's three columns (395 px cards at x = 112, 523,
933; the wide row 1,216 px) with equal-height rows; at 768 it is 1aa's "2 kort pr.
række" (344 px at x = 32 and 392), and the three LIGE NU cards follow the same 2/3
split rather than squeezing into 220 px. axe zero at 1440 for both roles. One markup
at every width: the phone and the desktop are `md:` / `lg:` variants of the same `<li>`,
the same card and the same band; no second dashboard, no duplicated component.

### Ugens ret and Månedens burger on the phone — the 12A observation, reproduced and closed

12A recorded that "the same status/undo strip-above-fold problem exists" on both
screens. Reproduced at 375 × 812 with touch against a production build, before any
change:

| Action | Where pressed (y) | Where the feedback was | Focus |
|---|---|---|---|
| Ugens ret → Udsolgt | 423 | the strip **279 px above** the viewport, Fortryd at −262 | body |
| Lørdagsmenuen → Udsolgt | 384 | the strip **1,694 px above** the viewport | body |
| Ugens ret → Gem | — | "gemt som kladde" 447 px above, the band 372 px above | body |
| Månedens burger → Udsolgt | 141 | the strip **496 px above** | body |
| Månedens burger → Gem | — | the notice 496 px above, the band 401 px above | body |

The mechanism is the same on both, and not the Menu's: every save and every press
redirects to the *card's own fragment* (`#ugens-ret`, `#loerdagsmenu`,
`#maanedens-burger`), which scrolls the card to the top of the screen — and the status
notice and the green strip were rendered above the card. The Menu fix could not simply
be copied, because these are editor screens: 12A's rule for an editor is that the
pending band, a publish control, is **not** pinned under a thumb scrolling a half-typed
form.

**What changed** — presentation and nothing else; no route, no action, no domain
module, no fragment, no data model, no publish semantic, no sold-out rule, no undo
duration:

1. **One shared foot** — `components/admin/NoticeFoot.tsx`. The container 12A built
   inline in the menu page (sticky to the bottom of the phone screen, visually last,
   **first in the DOM**, an ordinary block from `md`) is now one component, and the
   menu page uses it too. It is a container and nothing else: it knows no sentence, no
   action, no entity. `empty:hidden` takes it away when nothing renders inside it (every
   notice returns `null` for a status it does not know; the strips remove themselves
   after ten seconds), and its `.admin-foot` hook gives `<html>` a
   `scroll-padding-bottom` of 11rem below `md`, so a fragment target or a focused control
   the browser scrolls to the bottom edge lands above the foot. The three screens share
   exactly the positioning, the responsive behaviour and the semantics — that is why
   the abstraction exists — and each puts into it what its own domain says.
2. **What each foot holds.** The Menu: the two strips and, while the list is the
   screen, the band — exactly as 12A. Ugens ret and Månedens burger: the **status
   notice** ("gemt som kladde", the refusal, "opdateret på hjemmesiden", …) and the
   **Fortryd strip**; the band and the malformed-draft notice stay in flow above the
   cards. Measured afterwards: after Udsolgt on Ugens ret the strip is at y = 721 and
   Fortryd (91 × 44) at 739; after Udsolgt on Lørdagsmenuen, scrolled 1,747 px down, the
   same y = 721; after Gem the notice at 742; after a refusal the "Ret det, der er
   markeret herunder" notice at 742 with the field bound (`aria-invalid`); Månedens
   burger's strip at 721, Fortryd 739, the notice at 721 / 742. Focus is untouched
   (`body` — the strips never take it, per 1aa), the screen does not move under the
   thumb, and the strip's `role="status"` and ten seconds are `UndoStrip`'s, unchanged.

Walked in full at 375 as Staff: open, edit, image select and remove (the 10C-1
picker, unchanged), save, the band, preview, publish, Udsolgt on both weekly cards and
the burger, Fortryd, validation, and long content — a 120-character name, a
600-character description, a 480-character burger description and a reversed period —
with no sideways scrolling and axe zero in every state.

### The remaining operational screens — audited, and what was found

| Screen | At 375, before | Found |
|---|---|---|
| **Besked på hjemmesiden** (§18) | the editor's fields, chips, expiry and link usable; every target 44 px; axe zero | **the same fragment defect**: "Vis besked" off left its Fortryd strip 353 px above the viewport, Gem its notice 351 px above. **Fixed** with the same foot — the status notice and the visibility strip; the band, the obstacle sentence, the state banner and the editor stay in flow. After: the strip at 738, the notice at 742; the switch it was pressed from ends above the foot. The temporary-only model, the required expiry, the optional link, "Fjern beskeden nu" and the one-level restore are untouched. |
| **Åbningstider — the one-off change with its generated message** (§17) | the card, the chips, the suggestion, "Gem og offentliggør" all usable; 1ae's sheet inside the viewport with its choices stacked, safe one first, `Esc` deciding nothing, focus returned to the publish button (the locked suite's own assertions, re-run at 375) | **the same fragment defect for Staff and Owner alike**: after "Gem og offentliggør" the announcement's Fortryd strip sat 115 px above the viewport, the "enkelt ændring offentliggjort" notice further up. **Fixed** with the same foot — the two status notices and the announcement's report with its strip. After: the strip at 701 with Fortryd (91 × 44) at 729 and the hours notice at 631, for both roles; Fortryd puts the message back and leaves the hours changed, as before; the foot is 195 px when all three stand. One consequence from `md`: the announcement's report now stands at the top of the column beside the hours' notices rather than between the two cards — the same place every other screen's reports stand. No Phase-8 semantic changed: the coordinator, the conflict, ownership, the removal consequence and the cache order are the locked ones. |
| **Billeder** (§19) | list, upload, detail, alt, delete, picker — the 10B/10C-1 phone coverage | green: no overflow, no target under 44, axe zero, the back link in view. **Untouched.** |
| **Forsiden, Mad ud af huset, Kontaktoplysninger, Brugere** (§20) | entered from the new tiles | green on entry: no overflow, no target under 44, axe zero, the back link at y = 12. Their internal layouts were not reopened. Recorded for the lock pass: their Gem also redirects to a section fragment, so a saved-notice-above-the-fold walk of the three content editors is the one thing this audit did not repeat. |

### The News CSS variable, walked

`PinnedBarHeight` removes `--admin-bar-height` from `<html>` in its effect cleanup
(the 5b85274 fix already did). Walked as Owner: dashboard → Menu → back → News → the
editor (the variable `100px`) → back to the list by the bar (unset) → dashboard by the
bar (unset) → Menu (unset, `<html style>` empty) → weekly → back → Brugere → the
editor again (`100px`). No stale value reached another screen; the editor re-measures
on every return; 768 and 1440 are unaffected because the bar is not pinned there. No
lifecycle change was needed. The new suite pins the walk.

### Touch, focus, long content, accessibility

- **Targets.** Sweeps at 375 on every 12C-touched state — the dashboard (both roles,
  with the band), the weekly and monthly editors after a press and after a refusal,
  the hours screen after a publish, the announcement editor after a switch — found
  nothing under 44 × 44: the tiles 68 px, "Rediger besked" and the band's two controls
  48 px, every Fortryd 91 × 44, "Log ud" 60 × 44, the band's checkboxes 20 px inside a
  44 px row with their labels as the target.
- **Focus.** The ring is `3px solid rgb(180,116,26)` at 2 px on the tiles and the bar's
  controls; no strip or notice takes focus; the foot never covers a focused control
  (`scroll-padding-bottom`; asserted on the announcement switch); a dialog's safe
  choice is still focused first and `Esc` still resolves nothing on 1ae — the locked
  suites' own assertions, unchanged. No focus manager was added.
- **Long content.** A 90-character announcement on the card (the schema's ceiling),
  the longest tile lines, a 120-character weekly name with a 600-character description,
  a 120-character burger name, a pending Ugens ret in the band: no sideways scrolling
  anywhere (`wrap-anywhere` on the card's message, the tile's words and the band's
  names). No limit changed.
- **axe** (WCAG 2.0/2.1/2.2 A + AA): zero violations at 375 on the Staff dashboard,
  the Owner dashboard, the dashboard with the band and the list, the dashboard with the
  long announcement live, the weekly editor after a press, after a save and after a
  refusal, the monthly editor after a save, after a press and after a refusal, the
  hours screen after a publish (both roles), the announcement editor after a save and
  after a switch — and at 1440 on both dashboards.

### Departures from the frames, recorded

| Frame | Departure | Why |
|---|---|---|
| 1x | The bar is two rows; "Se siden" reads "Se hjemmesiden" | the account line and "Log ud" are on the phone too (above); one label at every width |
| 1x / 1q | Four tiles the frames do not draw: Ugens ret, Månedens burger, Brugere, Om os | entity-driven destinations that exist; drawn in the frames' language and recorded above |
| 1x | The pending band's per-item list beneath it | phase 4's per-item attribution and selective publish, addressed by locked suites; the band itself is 1x's |
| 1q | No sub-line under the count naming what waits | the list beneath names every item once with its checkbox, and five locked suites address an item by its title inside the form, which must stay unique |
| 1q | "Offentliggør ændringer" reads "Offentliggør" | the project's one label for the control, as every band and bar since phase 5 |
| 1q | At 768 the grid is two columns, not three | 1aa's own breakpoint rule ("768–1023: 2 kort pr. række") |
| 1ag / 1ah | The status notice and the strip at the foot of the phone screen | the two frames have no phone artboard; the foot is 1y's, measured, not assumed |

### Responsive architecture

One page, one action layer, one domain layer; the phone is `max-md:` / `md:` / `lg:`
variants over the same markup. The DOM order never differs between widths — the foot
is first in the DOM and last visually, the Besked tile is hidden from `md`, the wider
LIGE NU cards from below it. No `/admin/mobile`, no second dashboard, no mobile Server
Action, no dashboard table, no cache of its own, no client JavaScript on the dashboard
at all (the page is plain forms and links), no dependency. Bundle: no new client
component; `NoticeFoot` is a server component of one `<div>`.

### Tests

- **`tests/e2e/dashboard-mobile.spec.ts`** under one dedicated project,
  **`dashboard-mobile`** (375 × 812, touch), the new tail after `news-mobile`, and under
  no other project: thirteen stories — the landing screen as 1x draws it (the bar, the
  question, today's line, the nine Staff tiles in order with the first four in the first
  screen, no Owner door, targets, axe); LIGE NU's three rows from the locked systems and
  1q's two extra cards hidden; the announcement card's state and "Rediger besked" there
  and back; Ugens ret from the tile with Udsolgt and Fortryd inside the viewport on both
  cards; a saved week's notice at the foot with the band in flow and the refusal in view;
  the band on the dashboard counting the registry and publishing it; Månedens burger from
  the tile — the notice, Udsolgt, Fortryd and a refused long save; a one-off change with
  its generated message and the strip at the foot, then Fortryd; a 90-character
  announcement wrapping on the card and "Vis besked" leaving its Fortryd at the foot
  clear of the switch; the News bar's measurement set in the editor and gone on the list,
  the dashboard and the menu; the Owner's twelve tiles with Brugere there and back; the
  refused addresses; and the seed restored.
- **`tests/unit/admin/dashboard.test.ts`** (12) pins the read model, and
  **`tests/unit/admin/dashboard-markup.test.tsx`** (7) pins the foot's phone classes and
  `empty:hidden`, the tile named by its label and described by its line, the phone-only
  and the wide tile, the bar's order, the band with its list, and the card reading the
  published state.
- **The vocabulary migration** above touched twelve locked files and three helpers by
  locator name only; `tests/a11y/admin-pages.spec.ts`'s standalone-link list is the
  tiles', with `exact: true`.
- `playwright.config.ts` gains the project and the two `testIgnore` entries;
  `npx playwright test --list` shows the file under exactly `dashboard-mobile` (13).
- The walkthrough was a temporary Playwright harness (`tests/lockpass/`,
  `playwright.lockpass.config.ts`) over the e2e support helpers — a before pass and an
  after pass, both against a detached production build at 375 with touch — deleted
  before the chain and never committed, as in §0y, §0ac, §0ad and §0ae. Its screenshots
  (every state at 375; both dashboards at 768 and 1440) and its JSON measurements are
  in the session scratchpad.

### Security and source policy

No new architecture. The role-aware tile list is a courtesy over the registry, not an
authorization: the suite forges the two Owner addresses as Staff and is refused. The
dashboard reads through the same two paths every admin screen reads through (the
caller's JWT for the announcement, the pending view and the news list; the cached
public reads for the hours and the menu), and no profile field beyond the signed-in
person's own name and role reaches the page. No browser Supabase client, no service
client outside its two boundaries, no privileged state moved client-side
(`tests/unit/policy`, unchanged and green). The source policy is clean.

### The regression

From a clean tree: every port-3100 owner stopped, `npm ci`, `npm run db:reset:full`
(every test Auth identity gone, the two seeded ones as `npm run db:users` leaves
them), a twenty-second settle, `.next` emptied, a fresh production build, no stale
server. Typecheck, lint and the source policy clean; **2,610 unit tests in 105
files** (+19 in the two new `tests/unit/admin` files, +1 from 5b85274's
`phone-layout` addition); **2,030 pgTAP assertions in 28 files**, from real anonymous,
Staff and Owner JWTs and two dblink sessions — unchanged, because no function, grant
or table moved; **25 integration tests in 4 files** against the real local stack and
the mail catcher; `npm audit --audit-level=high` clean (0 vulnerabilities);
`npx playwright test --list` collecting **1,333 tests in 40 files across 47 projects**,
with `e2e/dashboard-mobile` under exactly its one dedicated project (13 stories),
`e2e/news-mobile` under exactly `news-mobile` (16), `e2e/menu-mobile` under exactly
`menu-mobile` (19), every other write suite under exactly its own projects as before,
the thirteen `a11y/*` files under `desktop` and `mobile` only, and no stale
`testIgnore` entry; and the complete Playwright matrix at `--retries=0`, run as the
chunked chain against one detached production server (the read-only trio together,
every write project in its own `--no-deps` invocation, in config order — 45
invocations): **1,326 passed, 7 deliberately skipped (the standing width/device
guards: three `public-site` stories at the other width, three `menu-reorder`
pointer/touch stories at the width without the input, one override story past its
clock guard), zero failed and zero flaky** on the first and only launch of every
chunk (started 20:07, finished 20:53). No chunk was re-run and no result is
retry-masked. Phases 5–12B ran green behind phase 12C, unchanged — the two phase-6
pairs, the four phase-7/8 pairs, the two phase-9 pairs, the four image projects, the
four phase-11 pairs, `menu-mobile` and `news-mobile` among them; the public cache is
still 5m/5m (`public-cache`, 3 passed), no tracking cookie (the `menu-mobile` and
`news-mobile` guest contexts assert an empty cookie jar on the first request after a
publish), no browser Supabase client and no service client outside its two boundaries
appeared (`tests/unit/policy`), and no phase-13 work exists.

Three facts about the build-up worth keeping, none a product defect. The focused
pre-run failed `draft-publish` twice on the way to this chain and each time taught the
dashboard something: first the new "Om os" tile collided with a page-wide "Om os is no
longer pending" assertion (scoped to the form, as above); then the band's
`role="status"` was read as the page's first status by the locked publish-report
assertion (the role came off — the band is a standing state, not an announcement);
and then 1q's sub-line naming the pending items made an item's title non-unique
inside the form for five locked strict locators (the sub-line went — the list beneath
names each item once). The same pre-run also failed the locked, untouched `news-mobile`
story "at the end of a long article…" by **one pixel** of `scrollY` after an autosave
under the keyboard viewport (2,983 → 2,984), which passed on its own rerun and passed
in the certified chain; 12C changed nothing on that screen, and the assertion is an
exact-equality one on a value scroll anchoring is known to move (§0ae's harness
lessons) — recorded for the lock pass rather than touched. The certified chain is the
run after those corrections, from a reset.

### What remains of phase 12 — the lock pass

12A, 12B and 12C are each accepted; the phase is not locked. The completion pass owes:
reading the three increments as one system (the foot, the pinned bar, the tiles, the
vocabulary) and walking Staff and Owner from the dashboard through every phone flow
against one production build; re-checking 1x, 1y, 1z and 1q once more at 375 / 768 /
1440 side by side; the one walk this audit did not repeat — the three phase-11 content
editors' saved notice after their section fragment at 375; §0ae's recorded conflict
state on the news bar (the taller bar covering the toolbar's top while a conflict
stands); the 12A open item on the price group and Forhåndsvis in the menu bar; reading
the four `NoticeFoot` users and the `scroll-padding` rules as a set; and one clean
regression chain, after which §15's phase-12 row is closed the way phases 5–11 were
closed.

---

## §0ag. Phase 12 — complete and locked (2026-09-04)

The completion pass over 12A (§0ad), 12B (§0ae) and 12C (§0af): the three increments
read as one system — the foot, the pinned bar, the tiles, the vocabulary and the two
`scroll-padding` rules — walked as Owner and as Staff on a phone against one production
build from the dashboard through every operational screen and back, re-checked against
frames 1x, 1y, 1z and 1q at 375 / 768 / 1440, the recorded observations resolved, and
one clean regression chain. §0ad–§0af are left as written — each increment's own
account — and this section is what "phase 12" means as a whole. **Phase 12 is locked.**
Phases 5–11 stay locked; nothing about drafts, publishing, roles, the sold-out engine,
the announcement model, the news status model, images, the page documents or accounts
changed. No phase-13 work exists.

### What phase 12 is, in force today

- **The phone is the primary administration device (§15).** Every administration
  screen is one markup with `max-md:` / `md:` / `lg:` variants; there is no `/admin/mobile`,
  no second component for a phone, no mobile Server Action, no keyboard-detection
  script and no dependency added by any of the four passes (`docs/dependencies.md`).
- **The dashboard is 1x / 1q** (§0af): the bar with the account, the amber band with the
  phase-4 per-item list beneath it, "Hej — hvad vil du lave?" over today's hours, the
  announcement card reading the published state, the role-aware tiles from the entity
  registry (`dashboard-tiles.ts` over `mayChangeEntity()` — a courtesy, never a
  permission), and LIGE NU as a read model (`lib/admin/dashboard.ts`). The tiles' words
  are the vocabulary the locked suites address.
- **The Menu is 1y** (§0ad): the foot with the Fortryd strips and the one-row band, long
  content that wraps, the stacked confirmation, Forhåndsvis kept in the bar (decided
  below), and — since this pass — a moved row that lands wholly in view.
- **The News editor is 1z** (§0ae, hardened by `5b85274`): the bar pinned to the top of
  the phone screen with the badge and the autosave line, its *measured* height published
  as `--admin-bar-height`, the B/Link toolbar and the link panel stuck exactly under it,
  fragment targets landing below it, the stacked confirmations — and, since this pass,
  an autosave controller that follows the form it listens to.
- **One foot, `NoticeFoot`** (§0af, widened by this pass): the container 1y draws for
  what just happened — sticky to the bottom of the phone screen, visually last, first in
  the DOM, an ordinary block from `md`, hidden and clearance-free while empty. Nine
  screens put their own notices into it; it holds no sentence, no action and no rule.
- **Two `scroll-padding` rules and nothing else global** (`app/globals.css`): a top
  rule while a pinned bar exists, a bottom rule while a foot *holds something*; neither
  applies from `md`, and a screen with neither component gets no artificial spacing.

### The lock-pass walkthrough (production build, `next start`)

A temporary Playwright harness (`tests/lockpass/`, seven spec files over
`playwright.lockpass.config.ts` and the e2e support helpers; deleted before the chain
and never committed, as in §0y, §0ac and §0ad–§0af) drove one detached production
build at 375 × 812 with touch, then at 375 × 440, 768 × 1024 and 1440 × 900, and
recorded for every state the viewport position of the control that mattered, the
document width, every tap target, the computed focus ring, `<html style>`, and axe
(WCAG 2.0/2.1/2.2 A + AA). Its screenshots and JSON reports are in the session
scratchpad. The order was the brief's:

**Owner, 375.** Dashboard → Billeder (upload, alt) → Rediger menu (list, chips, editor,
Gem with the band in the foot, the picker on Thor with `Esc` back to "Vælg billede",
the pending photo on the row, Udsolgt from the list with the Fortryd in the foot and
back, Forhåndsvis, Offentliggør from the foot; Flyt op / Flyt ned on a middle row, a
last row and a 200-character row; the longest content; a new dish, the stacked delete
confirmation, `Esc` back to "Slet ret", delete and restore) → Ugens ret (save, Udsolgt,
Fortryd, preview, publish) → Månedens burger (the same) → Nyheder (an eight-paragraph
article created by autosave, B and Link from its end, the keyboard viewport, Gem, the
picker, preview, the stacked publish confirmation, a live edit said in the pinned bar,
a 200-character title, the stacked unpublish and delete confirmations with `Esc` back
to their controls) → Besked på hjemmesiden (save, publish, "Vis besked" off with the
Fortryd in the foot, back) → Åbningstider (a one-off change with its generated message
meeting the active announcement: 1ae's sheet, Behold, then a second date and Erstat,
the Fortryd, the restore) → Rediger forsiden, Mad ud af huset and Kontaktoplysninger
(Gem on the first and a lower card of each) → Brugere (invite, the stacked deactivation
confirmation, deactivate) → Billeder (Erstat, Slet). The seed was reset afterwards.

**Staff, 375.** The nine tiles in 1x's order, no Owner door; every tile opened and its
back link read; `/admin/brugere`, `/admin/forsiden` and `/admin/kontakt` by address →
`/admin/ingen-adgang`; and forged writes through PostgREST with the Staff JWT —
`opening_hours`, `site_contact`, `pages` (home) and `profiles.role` updates, and
`publish_opening_hours()` / `publish_site_contact()` by RPC — zero rows moved, the
functions refused. Dashboard visibility is a courtesy; authorization is the Server
Actions and RLS, unchanged.

### Frame fidelity, re-checked

**1x at 375.** The bar (two rows, 116 px — the account line and "Log ud" on the second,
as §0af records), "Hej — hvad vil du lave?" at 24 px with today's line, the
announcement card with its pill and "Rediger besked" (310 × 48), the tiles as
343 × 68 rows in the frame's order with the entity-driven four among them, LIGE NU's
three rows; the Staff dashboard 1,881 px tall with nothing pending, the Owner's 2,070.
With four pending changes the band and the phase-4 list beneath it are 736 px tall and
the heading lands at y = 870: the per-item list is the accepted departure §0af records,
and the pending state is what the person came to handle; recorded with the number, not
redesigned. axe zero for both roles, with and without the band; every target ≥ 44 px;
no sideways scrolling; `Tab` walks the bar, the band's Forhåndsvis / Offentliggør and
its checkboxes, then the tiles, with the `3px solid rgb(180,116,26)` ring on each.

**1q at 768 and 1440.** At 1440 the tiles are three 395 px cards at x = 112, 523 and
933, "Mad ud af huset" the full row, LIGE NU / SENESTE NYHED / DAGENS ÅBNINGSTID three
cards of the same widths, the bar one 72 px row with the wordmark, the account line,
"Se hjemmesiden" and "Log ud". At 768 the grid is 1aa's two columns (344 px at x = 32
and 392) and the three cards follow the same 2/3 split. One thing seen at 768 only: a
Staff member's account line ("Logget ind som Lokal Medarbejder · Medarbejder") does not
fit beside the wordmark and the two controls in 704 px, so the bar wraps to a second
row (114 px), exactly as it does on the phone; the Owner's shorter line keeps one row.
Graceful, recorded as a departure from 1q at that one width, not changed.

**1y at 375.** The list's cards with the photo slot (the dish's photo or the empty
frame, greyed on a sold-out row), the chips, the one-row band and the strips in the
foot, the stacked confirmation with the safe choice focused first, the editor with
"Luk" 44 × 44, the picker 337 × 345 inside the viewport with Annuller focused. **1r at
1440** unchanged.

**1z at 375.** The list's cards with their state words, the editor under the pinned
bar (100 px; the toolbar at y = 100 exactly), B and Link in view at the end of an eight-
paragraph article at 812 px and at 440 px (283 px of text still visible under them),
the link panel opening at y = 198 with its field focused, the three confirmations
stacked with the safe choice focused. **1s at 1440** unchanged.

### The mobile Menu Forhåndsvis — decided: kept, an intentional departure from 1y

1y's bar is "‹ Tilbage · Rediger menu · Offentliggør" and the frame draws no
Forhåndsvis anywhere. The only preview the approved phone frames give is the
**dashboard band's** (1x: "2 ændringer er ikke offentliggjort — Forhåndsvis ·
Offentliggør"), which exists only while something is pending and only on the dashboard
— two screens away from the dish being edited, and absent the moment the person wants
to see the menu as a guest before deciding. §6's Kladde → Forhåndsvis → Offentliggør is
the publishing model, and §15's phase-12 promise is the *full* menu-edit flow on a
375 px viewport; 1z, drawn for the same phone, puts Forhåndsvis beside Offentliggør in
its own editor. So the bar keeps both controls, wrapping to a second row (the bar is
124 px, the two controls 113 × 44 and 111 × 44, the first card at y = 217). Recorded as
an accessibility/usability departure in 1y's own favour of function; **closed.**

### The moved row — measured, found short, corrected

§0ad recorded "every variant ends with the moved row at y = 177". Re-measured with the
scroll settled, that held for the variants where the browser had dropped the focus
(the row then at y = 69 under the bar), but not for a press of Flyt op on a row that is
still not first: the retained focus was brought into view with `scrollIntoView({ block:
'nearest' })` on the **control**, and the control sits at the foot of a card — so the
card's strip was on screen and its name, photo and price were **53 px above the
viewport**, and **204 px above it** for the longest name the schema allows (a 304 px
card). §7's rule is that the changed row remains visible.

Corrected in `ReorderHandle`: the focus is placed with `preventScroll` and the row's
own `<li>` is scrolled `nearest`. Measured afterwards at 375: Flyt ned on a middle row
→ the row at y = 424–636; Flyt op on the same row → y = 200–394; Flyt op on the last
row → 424–636; Flyt ned on the middle row with the band absent → 618–812; the
200-character row after Flyt ned → 151–455; in every variant the row wholly inside the
viewport, above the foot when there is one, the handle or the pressed button focused,
no sideways scrolling, and on a desktop nothing moves. The `scroll-mb-36` the handle
and the two buttons carried is gone: the foot's own `scroll-padding-bottom` is the one
clearance rule (below), so the second constant was redundant — the code-quality review
flagged it, and the measurement above confirms nothing needs it.

One §0ad claim corrected while there: "toggling Udsolgt in the list keeps the scroll
position (521 → 519)" was measured before the router's scroll had run. Settled, the
redirect after a press in the list puts the page at the top (614 → 0), where the
"markeret som udsolgt" notice stands; the strip with its Fortryd is in the foot either
way (y = 639–701 inside the viewport, Fortryd 91 × 44). Recorded; not changed — it is
phase 5's redirect, and the feedback is where 1y draws it.

### The News bar under a conflict — reproduced, measured, closed

The state §0ae recorded as "the taller bar covering the toolbar's top while a conflict
stands", which `5b85274` addressed by measuring the bar. Reproduced on the phone: a
colleague's Gem, then typing at the end of an eight-paragraph article; the refused
autosave puts "Nogen andre har rettet denne nyhed. Dine ændringer her er ikke gemt —
kopiér din tekst, før du genindlæser siden." into the bar's status row. Measured:
the bar 100.25 px → **140.75 px**, `--admin-bar-height` = `140.75px`, the toolbar's
sticky wrapper at exactly 140.75 (gap 0.00); B (44 × 44) and Link inside the viewport
and tappable — B presses to `aria-pressed="true"` on the selected words, Link opens its
panel with the address field focused at y = 238 — the caret still in the textbox, the
unsaved sentence still in the text, no sideways scrolling, axe zero. At 375 × 440 the
same bar measures 140.75 and the toolbar follows it.

Then the walk: the editor (conflict, `140.75px`) → the list by the bar (`<html style>`
empty) → the dashboard (empty) → Rediger menu (empty) → Ugens ret (empty) → the editor
again (re-measured, `100px`). The variable never reaches another screen, and every
return re-measures; the `ResizeObserver` disconnects and the property is removed in the
effect's cleanup (the code-quality review confirmed the lifecycle). **Closed.**

### The 1 px `scrollY` observation — decided: B, layout rounding and the caret

§0af recorded one pixel of `scrollY` variance (2,983 → 2,984) in `news-mobile`'s
"at the end of a long article…" story after an autosave under the keyboard viewport.
Reproduced with the story's exact condition — the eight-paragraph article, its last
line centred at 375 × 440, then " Tilføjet på telefonen." typed and the save awaited —
eight times over. What moves is **not the autosave**: when the new words wrap the last
line, the caret drops to a new line below the 440 px fold and the browser scrolls it
back into view by 15–67 px *during typing*; when they do not wrap, the line moves by a
quarter pixel (line boxes of 25.6 px) and `scrollY` by nothing, or by the one pixel
that quarter rounds to. The story sampled `scrollY` **before** typing and compared it
to an exact integer **after** the save, so it measured the browser's caret behaviour
and the line-box rounding, and passed only while the test's own words happened not to
wrap. No product defect: the autosave response changes no layout, and the page,
the caret line and the focus are exactly where typing left them.

The one assertion is replaced, narrowly: the story now awaits the autosave's own POST
by name, samples `scrollY` and the caret line's viewport top **after the words are in
and before the save answers**, and requires both to be within 1 px afterwards — so a
real jump (a scroll to the top, a re-render that moves the text) of two pixels or more
still fails, and the browser's caret scroll and a quarter-pixel line box no longer do.
Nothing else in the story changed.

### A defect found on the way: autosave dead after the first Gem — fixed and pinned

Walking the phone's own flow — a new article created by autosave, then Gem — the next
words produced **no autosave at all** until a reload, while the pinned bar kept saying
"Gemt for lidt siden". The page renders the editor form at two different positions for
a new and an existing article, so that Gem replaces the `<form>` node; `NewsAutosave`,
at the same position in the bar, survived the navigation with its listeners still bound
to the detached node. The locked story did not see it because "Gemt for lidt siden" was
already on screen. Measured with the response log: no POST for six seconds after
typing; after a reload, one POST per edit as designed; after an existing article's Gem
and after a publish, one POST per edit (those paths remount the controller).

Fixed in `app/(admin)/admin/nyheder/page.tsx` with one attribute — the controller is
keyed by the article's identity (`'ny'` or the id), so it remounts with the form it
listens to. Verified with the response log on the rebuilt site, and pinned in
`news-mobile`'s creation story: after Gem the line starts idle, the next words bring
"Gemt for lidt siden" back, and a reload proves the words reached the row. 9B's machine,
its debounce, its one-in-flight rule and its `replaceState` on creation are untouched.

### `NoticeFoot` — the consumers, read as a set

From the source, the foot has **nine** consumers after this pass, each putting into it
exactly what its own domain reports and nothing else:

| Screen | In the foot | In flow above the cards |
|---|---|---|
| Rediger menu (12A) | the availability and delete strips; the band while the *list* is the screen | the band while the editor is open |
| Ugens ret (12C) | the status notice, the Fortryd strip | the band, the malformed-draft notice |
| Månedens burger (12C) | the status notice, the Fortryd strip | the band, the malformed-draft notice |
| Besked på hjemmesiden (12C) | the status notice, the visibility strip | the band, the obstacle sentence, the state banner |
| Åbningstider (12C) | the two status notices, the announcement report with its strip | the malformed-draft notice, the schedule error |
| Rediger forsiden (this pass) | the status notice | the band, the malformed-draft notice |
| Mad ud af huset (this pass) | the status notice | the band, the malformed-draft notice |
| Kontaktoplysninger (this pass) | the status notice | the band, the malformed-draft notice |
| Brugere (this pass) | the status notice | — |

The component owns positioning and responsive behaviour only — one `<div>` of
`max-md:` variants, `empty:hidden`, the `.admin-foot` hook — and no domain behaviour
moved into it; the four new consumers are each a two-line wrap in their page. The
menu page renders it conditionally, the other eight unconditionally; the difference is
harmless now that an empty foot is `display: none` **and** reserves no clearance
(below).

**At 375, one action per consumer**, measured: the Menu's strip at y = 738 (Fortryd
747, 91 × 44) after a sold-out from the list; Ugens ret's "gemt som kladde" at 742
after Gem, its strip at 738 after Udsolgt; Månedens burger's at 721 / 721; the
announcement's at 742 / 738; the hours' report with its strip at 721 (Fortryd 739) after
Erstat and "Beskeden blev ikke oprettet" at 742 after Behold; Forsiden's, Mad ud af
huset's and Kontaktoplysninger's "gemt som kladde" at 742 after Gem on their first and
their lowest card; Brugere's "Invitationen er sendt" at 721. Every one inside the
viewport at the moment it appeared, the pressed control or its card above the foot,
no focus taken by any strip.

**Combinations that real state produces**: the Menu with a strip *and* the band
(foot 112 px: the strip, then the band's one row with Offentliggør 111 × 44, nothing
hidden); the Menu with a status notice and the band after Gem (112 px); the hours
screen after Erstat with the report, its Fortryd and the hours' notice (104–195 px
depending on which stand); the editor open with a pending change (the band in flow
above the panel, the foot only for a strip). In each the stack order is the DOM's,
nothing overlaps, the page keeps its bottom room, and 1ae's sheet (623 px) stands
entirely above the foot (y = 94–718 against a foot at 729).

**From `md`**: on every consumer the foot computes `position: static`, `display: flex`,
sits 24 px under the top of `<main>` as its first child, and `scroll-padding-bottom` is
`auto` — the block the notices were before phase 12, at 768 and 1440 alike. The
opening-hours report at the top of the column beside the hours' notices (§0af) is
coherent with every other screen and harmless; **accepted.**

### The two `scroll-padding` rules — read together

`html:has(.admin-bar-pinned)` sets `scroll-padding-top` below `md` to the measured bar
plus 0.75rem; `html:has(.admin-foot:not(:empty))` sets `scroll-padding-bottom: 11rem`
below `md`. They govern different edges, both hang on a component's own hook, neither
exists from `md`, and a screen without the component has neither. The one change this
pass made: `:not(:empty)`. Eight screens render the foot unconditionally and
`empty:hidden` only hides it, so `:has(.admin-foot)` matched a `display: none` element
and every fragment or focus scroll on those screens reserved 176 px at the bottom with
nothing there to clear. Measured before and after: an idle Ugens ret, Månedens burger,
Besked and Åbningstider computed `scroll-padding-bottom: 176px`; they compute `auto`
now, and `176px` the moment a notice renders. The unit file pins the rule. With the
reorder handle's `scroll-mb-36` gone, the foot's rule is the only bottom clearance and
the bar's the only top one; no other magic constant remains.

### The phase-11 editors' saved notice — the recorded observation, reproduced and closed

§0af left one walk undone: the three content editors' Gem redirects to the saved
card's fragment. Reproduced at 375 before any change, the "gemt som kladde" notice —
rendered above the cards — was above the viewport by **244 px** after a save of
Forsiden's top card and **883 px** after Udmærkelsen; **580 px** after Mad ud af huset's
Tekst and **2,005 px** after Knap nederst; **244 px** after Kontaktoplysninger's Gem;
and on Brugere, whose actions redirect to the form's or the row's fragment,
"Invitationen er sendt" was **696 px** above it. The same defect 12C closed on four
screens, on four more.

Closed with the same foot, the smallest accepted pattern: the status notice moves into
`NoticeFoot` on each screen; the band, the malformed-draft notice and every card stay
where they were, first in the DOM as before, an ordinary block from `md`. After: the
notice at y = 742 on all three editors after Gem on the first and the lowest card, at
721 on Brugere after an invitation and after a deactivation, the saved card scrolled
to the top of the screen by its fragment as before (the edited section understood), no
jump to the page top, no sideways scrolling, axe zero. The pgTAP, unit and e2e suites
of phases 11A–11C are untouched; from `md` nothing moved.

### The remaining operational screens

- **Åbningstider** (§17): the one-off change with its message meeting the active
  announcement — 1ae's sheet 337 × 649 inside the viewport with "Behold eksisterende
  besked" focused first and Erstat below it; Behold → "Åbningstiderne er gemt. Beskeden
  blev ikke oprettet." at 742 with focus back on "Gem og offentliggør"; a second date
  and Erstat → the report and its Fortryd at 721 / 739; Fortryd → "Den forrige besked er
  sat tilbage" with both dates still listed. Hours first, always; the coordinator, the
  conflict and ownership are the locked ones. One target fixed: the "Ret" link on each
  row of *Kommende ændringer* was 22 px wide (44 tall); it is `min-w-tap` now.
- **Besked på hjemmesiden** (§18): save, publish, "Vis besked" off with the strip at
  738 and Fortryd 747, undo; the switch itself ends above the viewport after the press
  (the card's fragment scrolls the editor to the top — phase 7's redirect, the feedback
  in the foot; recorded in §0af, unchanged); the dashboard card reads "Vises nu" with
  the message and its expiry.
- **Billeder** (§19): upload through the real input, alt text, the picker from a dish
  and from an article, Erstat, Slet — the 10B / 10C-1 screens, green and untouched.
- **Brugere** (§20): the list, an invitation, the stacked deactivation confirmation with
  "Behold kontoen aktiv" focused first, deactivation, the invitee's row; the locked
  Auth suites cover the rest. The only change is the foot above.

### Touch, focus, long content, the keyboard viewport, accessibility

- **Targets** (§21): the sweep of every link, button, select, date and file control and
  every label that *is* the control, on every state above, found nothing under
  44 × 44 after the two corrections (the reorder row's controls were never under; "Ret"
  was). Inline links inside sentences — "Oversigt" and the two editor links on the
  phase-4 Om os screen, "Tilbage til oversigten" on the refusal page — are the standing
  exemption and are recorded as such.
- **Focus** (§22): the ring `3px solid rgb(180,116,26)` at 2 px on every keyboard-
  focused control measured; no strip or notice takes focus; a dialog's safe choice is
  focused first everywhere (Behold ret, Tilbage, Behold den på hjemmesiden, Behold
  nyheden, Behold eksisterende besked, Behold kontoen aktiv, Annuller); `Esc` is a real
  navigation back to the control it came from, which is focused and scrolled under the
  pinned bar within a second (Fjern fra hjemmesiden at y = 744, Slet at 729 — the
  site's smooth scroll); autosave takes no focus; the moved row keeps its handle or
  button; the foot never covers a focused control.
- **Long content** (§23): a 200-character unbroken name beside a photo, a 600-character
  description and "9.999,99 kr." on the Menu; a 120-character weekly name; a 200-
  character news title on the list, in the address line and in the confirmation, a
  400-character link, a 120-character unbroken run in the public article; a 90-
  character announcement on the card; four pending item names in the band: no sideways
  scrolling anywhere, nothing lost, no sticky region grown past use (the bar's tallest
  case is the conflict's 141 px).
- **375 × 440** (§24): the dish editor's description focused with Gem reachable by a
  scroll and clear of the foot; the weekly description focused with the foot 63 px and
  the field above it; the news editor with the bar and the toolbar pinned and 283 px of
  text under them. No keyboard-detection script.
- **axe** (§25): zero violations at 375 on the Staff and Owner dashboards (clean, with
  the band, with the long announcement), the Menu list / editor / picker / sold-out /
  long / confirmation states, the News list / editor / saved / with a photo / long
  title / **conflict** / after delete, Ugens ret and Månedens burger after a save and
  after a press, Besked after a save and a switch, Åbningstider after Behold and after
  Erstat, Forsiden, Mad ud af huset and Kontaktoplysninger after Gem, Brugere after an
  invitation and a deactivation, Billeder after an upload, a replace and a delete, the
  refusal page — and at 768 and 1440 on both dashboards; the thirteen `a11y/*` files
  keep the desktop coverage of every shared component. No status is colour alone.

### Public regression (§26)

Every public route at 375 and 1440: `200`, `Cache-Control: s-maxage=300` (§6's 5 m
window, `expireTime` 5 m), an empty cookie jar, no script from anywhere but `/_next/`,
no request to the Supabase REST, Auth or Realtime endpoints (the only 54321 requests are
the public media bucket's derivatives, by design), no sideways scrolling, axe zero. The
guest reads Thor's published price, the three seeded articles, the takeaway page and
its navigation item, and the `tel:+4563908300` link.

### Role and navigation consistency (§27)

Staff: Rediger menu, Ugens ret, Månedens burger, Skriv en nyhed, Åbningstider,
Billeder, Om os, Besked på hjemmesiden, Mad ud af huset — every one opened by its tile
and named by its heading (the phase-4 Om os screen aside). Owner: the same plus Rediger
forsiden, Kontaktoplysninger and Brugere. No "Åbn …" wording remains anywhere in the
administration or the suites. One thing recorded: Ugens ret's and Månedens burger's bar
reads "‹ Rediger menu" and leads to the Menu, not the dashboard — phase 6's own back
link, kept, because the two are the Menu's sub-screens as well as tiles; the dashboard
is one more tap.

### Playwright registration and test-state independence (§28, §29)

`npx playwright test --list`: **1,333 tests in 40 files across 47 projects**;
`e2e/menu-mobile` under exactly `menu-mobile` (19), `e2e/news-mobile` under exactly
`news-mobile` (16), `e2e/dashboard-mobile` under exactly `dashboard-mobile` (13); every
other write suite under exactly its own projects; the thirteen `a11y/*` files under
`desktop` and `mobile` only; `public-site` the one e2e file under both generic projects,
read-only by design; no `testIgnore` entry names a file that does not exist. The three
phase-12 suites seed what they need (an image through the real upload, an article
through the real editor), restore it (the library's own Slet, the article's own Slet,
every dish draft cleared), never assume a weekday, never read `--admin-bar-height`
from a previous screen, never assume a Testret identity, and start from a fresh
context. The old Menu suites' documented Testret rows are unchanged and reset before
certification, as before.

### Code quality (§30)

The complete phase-12 diff was reviewed as one slice (an independent reviewer over
`0a3d16d..HEAD`, then this pass over its own changes). Found clean: one foot, one
pinned-bar measurement with a correct lifecycle, no viewport JavaScript where CSS
serves, the dashboard as a thin composition over a pure read model, no permission
outside the registry, no prose-brittle selectors in the three suites, no circular
import, no dead helper, no dependency. Two observations, both fixed above: the
`:has(.admin-foot)` rule matching an empty foot, and the reorder controls' second
clearance constant. Nothing was rewritten.

### Security (§31)

No new boundary. The tiles are a courtesy over the registry; every screen calls its own
guard and every action re-checks; a Staff member reaching an Owner address meets
`/admin/ingen-adgang`, and a Staff JWT at PostgREST moves zero rows in `opening_hours`,
`site_contact`, `pages` and `profiles` and is refused by `publish_opening_hours()` and
`publish_site_contact()`. No browser Supabase client, no service client outside its two
boundaries (`tests/unit/policy`), no privileged state client-side, no mobile-only
Server Action. The standing carry-forwards for the final security audit (phase 13) are
unchanged: §0s, §0t, §0u, §0v, §0w, §0x, §0y, §0z, §0aa, §0ab and §0ac.

### Intentional departures from the frames — the phase-12 set

| Frame | Departure | Why |
|---|---|---|
| 1y | Forhåndsvis in the phone's menu bar, the bar two rows | the full Kladde → Forhåndsvis → Offentliggør flow on the phone; decided above |
| 1y | No "⋯" on the card; "hold on a row" is the handle | §0ad |
| 1r, 1y | The photo slot on every row | §0ad (closed in `f46d883`) |
| 1z | The list's bar two rows; Forhåndsvis / Offentliggør stacked; Slet and Fjern fra hjemmesiden present; the autosave row; the date field | §0ae |
| 1z, 1s | The B/Link toolbar and its panel stick under the bar | §0ae |
| 1x | The bar two rows; "Se siden" reads "Se hjemmesiden" | §0af |
| 1x / 1q | Four entity-driven tiles: Ugens ret, Månedens burger, Brugere, Om os | §0af |
| 1x | The phase-4 per-item list beneath the band (736 px with four items) | §0af; the number recorded above |
| 1q | No sub-line naming what waits; "Offentliggør" not "Offentliggør ændringer"; two columns at 768 | §0af |
| 1q | The Staff bar wraps to two rows at 768 | measured above |
| 1ag / 1ah / 1u / 1aj / 1v | The status notice at the foot of the phone screen | the frames have no phone artboard; the foot is 1y's, measured |
| 1t | The announcement's report at the top of the column from `md` | §0af, accepted above |

### The regression

From a clean tree (fourteen modified files — the lock fixes and these documents —
and nothing else): every port-3100 owner stopped, `npm ci`, `npm run db:reset:full`
(every walkthrough identity gone, the two seeded ones as `npm run db:users` leaves
them), a twenty-second settle, `.next` emptied, a fresh production build, no stale
server. Typecheck, lint and the source policy clean; **2,611 unit tests in 105
files** (+1: the foot's CSS rule pinned in `tests/unit/admin/dashboard-markup.test.tsx`);
**2,030 pgTAP assertions in 28 files**, from real anonymous, Staff and Owner JWTs and
two dblink sessions — unchanged, because no function, grant or table moved; **25
integration tests in 4 files** against the real local stack and the mail catcher;
`npx playwright test --list` collecting **1,333 tests in 40 files across 47
projects** — the registrations above, unchanged; `npm audit --audit-level=high`
clean (0 vulnerabilities); and the complete Playwright matrix at `--retries=0`, run as
the chunked chain against one detached production server (the read-only trio
together, every write project in its own `--no-deps` invocation, in config order —
45 invocations): **1,326 passed, 7 deliberately skipped (the standing width/device
guards: three `public-site` stories at the other width, three `menu-reorder`
pointer/touch stories at the width without the input, one override story past its
clock guard), zero failed and zero flaky** on the first and only launch of every
chunk (started 22:41, finished 23:27). No chunk was re-run and no result is
retry-masked. Phases 5–11 ran green behind the phase-12 lock fixes, unchanged — the
seven phase-5 menu projects with the corrected focus recovery, the two phase-9 news
projects with the keyed autosave controller, the three phase-11 pairs and the
`users-admin` pair with their notices in the foot among them; 12A (`menu-mobile`,
19), 12B (`news-mobile`, 16, including the pinned autosave-after-Gem story and the
replaced 1 px assertion) and 12C (`dashboard-mobile`, 13) green; the public cache
still 5m/5m (`public-cache`, 3 passed), no tracking cookie (the `menu-mobile` and
`news-mobile` guest contexts assert an empty cookie jar on the first request after a
publish), no browser Supabase client and no service client outside its two
boundaries (`tests/unit/policy`), and no phase-13 work.

### What phase 13 starts from

Phase 13 is §15's "SEO, monitoring, hardening": metadata, sitemap and robots are in
place since phases 3 and 9 and should be verified rather than rebuilt (Rich Results on
the article and the organisation); Sentry; the weekly off-platform backup workflow and
the restore drill (§10f); rate limiting on the sign-in and the Server Actions; the
security-header pass; and the **final security audit** over the carry-forwards listed
in §0s–§0ac and above, which this pass did not touch. Its first step is that audit's
reading list, not code.

---

## 0ah. Phase 13A — backup and recovery (2026-09-05)

Phase 13 is §15's operational hardening. Its first increment is §10f's weekly
off-platform backup, built together with the restore drill the same section demands —
"a backup is complete only when a restore has been proven". Nothing in the product
changed: no runtime module, no migration, no screen. The increment is
`scripts/backup/`, one workflow, one drill, two runbooks, and this record.

### What was found before anything was built

**The plan.** §10f fixes the shape: two layers (managed daily backups on Supabase Pro,
plus a weekly GitHub Actions job to an external private object store), `supabase db
dump` for the database, both buckets for Storage, retention of eight weekly points and
a monthly kept six months "via a lifecycle rule at the destination — not by a script
deleting things", credentials in a protected `backup` environment, log hygiene as
design, loud failure, and a restore drill into a scratch project. §13 item A leaves
the destination provider open and recommends R2. §14 pins actions by SHA.

**The data.** Thirteen application tables in `public` (the seven content entities, the
three singletons `announcement`/`opening_hours`/`site_contact`, `pages`, `profiles`,
`images`, `audit_log`), all uuid-keyed — no sequences to reset. Two buckets,
`media-originals` (private, the recovery source; §0t) and `media` (public
derivatives), created by migration `20260901140000`, with **no** RLS policy on
`storage.objects` — the service role is the only writer and the only reader of the
private bucket. Auth in `auth.*`, owned by the Auth server: `profiles.user_id`
references `auth.users`, so identities are part of the content story, not beside it.

**The provider.** Supabase's own documentation, read for this increment: daily
backups (Pro, 7 days) are physical and cover the whole database, `auth` included;
they are restorable from the dashboard and not downloadable; "database backups do not
include objects you store via the Storage API, as the database only includes metadata
about these objects"; and the documented way to move a project is three `db dump`
files loaded with `psql --single-transaction` under `session_replication_role =
replica`, with Storage copied "by a script using the client library". The CLI's own
data dump includes `auth`. So the supported model for an off-platform auth copy is
exactly a data dump of the auth tables reloaded with psql — which is what was built,
narrowed to the four durable tables.

**Derivatives are regenerable in principle and not in practice.** The pipeline
(`lib/images/finalize.ts`) re-derives from an original only inside upload
finalization; there is no standalone "regenerate derivatives" tool and 13A did not
invent one. Both buckets are therefore backed up whole. A restore puts back exactly
the bytes that were public, with their content type and cache header.

### The architecture

| Piece | Where | What it does |
|---|---|---|
| **The one command** | `scripts/backup/backup.mjs` — `npm run backup -- --out <dir> [--tier weekly|monthly] [--ship]` | Dumps the database (three plain-SQL files), copies both buckets through the Storage API, writes `manifest.json` last, optionally ships. The scheduled workflow and the manual run are this script. |
| **The restore** | `scripts/backup/restore.mjs` — `npm run backup:restore -- --from <dir> [--dry-run] [--skip-auth] [--skip-storage] [--allow-partial] [--allow-newer-schema]` | Verifies every file's sha256, assesses the target, compares migration histories, reloads in one psql transaction, uploads the objects, verifies counts and inventories. |
| **The PostgreSQL door** | `lib/pg.mjs` | `pg_dump`/`psql` natively when a PostgreSQL 17 client is on the PATH, otherwise from the `postgres:17` image — one code path on Windows and on the runner. The connection travels as `PG*` environment variables, **never as an argument** (§8): the Supabase CLI's `db dump --db-url` would have put the URL on a command line, so the tooling calls the tools itself with the CLI's flags where they matter (`--data-only`, `--quote-all-identifiers`, `--role=postgres`, `\restrict` lines neutralised as the CLI does). |
| **The Storage door** | `lib/storage.mjs` | Recursive listing, download with size check and sha256, upload with the recorded content type and `max-age`, inventory comparison. Service role, Storage API — the plan's own named fallback to `aws s3 sync`, chosen because the runner has no persistent mirror to sync against, because the metadata round-trips exactly, and because it runs identically on the development machine. |
| **The manifest** | `lib/manifest.mjs` | `klingenberg-food-backup/1`: id, tier, `complete` (derived — a caller cannot assert it), source hosts and project ref, repository commit and migration files, migrations applied to the source, per-component status, row counts, object inventory with sha256, a sha256 per file. Also the retention constants (63/190 days) and the migration-history comparison. |
| **Shipping** | `lib/ship.mjs` | `aws s3 cp --recursive` to `<prefix>/<tier>/<id>/`, `list-objects-v2` back, compare keys and sizes, and only then `latest.json`. Nothing deletes. The AWS CLI gets a minimal environment holding the destination key pair and nothing else. |
| **Guards** | `lib/targets.mjs`, `lib/keys.mjs`, `lib/env.mjs`, `lib/run.mjs` | Loopback needs no confirmation; any other host is refused until `BACKUP_RESTORE_CONFIRM_HOST` names it exactly; a database and a Storage API from two project refs are refused; a local database with a remote API (or the reverse) is refused. Object keys are validated (no `..`, no absolute, no backslash, no control byte) and resolved paths are checked to stay under the recovery point. One file names the secrets; every log line and error passes a redactor that knows every value. |
| **The schedule** | `.github/workflows/backup.yml` | Two crons — Mondays 03:17 UTC (weekly tier), the 1st at 04:17 UTC (monthly tier) — and `workflow_dispatch` with a tier input. `environment: backup`, `permissions: contents: read`, `concurrency: backup` without cancellation, 45-minute timeout, actions pinned by SHA, the recovery point removed from the runner and never uploaded as an artifact. |
| **The drill** | `tests/backup/drill.test.ts` — `npm run backup:drill`, and the last step of CI's database job | Below. |
| **The runbooks** | `docs/runbooks/backups.md`, `docs/runbooks/restore.md` | Scope, destination, schedule, retention, secrets and rotation, manual trigger, reading `latest.json`, failure behaviour; and the restore sequence from fetching a point to reopening the site, with the Auth boundary stated. |

Backup scope, exactly: `db/schema.sql` (`pg_dump --schema-only --schema=public` — a
reference copy; the supported schema restore is the migrations, §10b);
`db/data-public.sql` (every `public` table, COPY format, `audit_log` included);
`db/data-auth.sql` (`auth.users`, `auth.identities`, `auth.mfa_factors`,
`auth.webauthn_credentials`; sessions, refresh tokens, one-time tokens, challenges,
flow state and the OAuth/SSO configuration tables deliberately excluded — sessions are
revoked on recovery, and this system has no provider but e-mail); both buckets whole,
every run. Not in it: `storage.*` rows (buckets come from the migration, object rows
from the upload), provider-managed schemas, `supabase_migrations` (the manifest
records the versions), and every secret or setting.

Retention is the destination's lifecycle rule per tier prefix — the runbook states the
two rules, the code states the two numbers, and no script deletes anything, so no
retention bug can remove the newest point. A run is successful only when both
required components succeeded and the upload listed back complete; otherwise the
manifest says `complete: false`, the partial point is still shipped under its own id,
`latest.json` is untouched, and the exit code is non-zero.

### The destination decision (§13 item A) — still the owner's

The tooling is provider-neutral: an endpoint, a bucket, a key pair, two lifecycle
rules. The runbook records the recommendation (R2; B2 equally) and the exact manual
setup. One correction to §10f: R2 has no object versioning, and the design does not
need it — each recovery point is its own prefix and nothing overwrites a previous one.
Until the provider is chosen and the `backup` environment populated, the workflow
fails at its first step with the names of the missing variables, which is the
intended state for an unconfigured schedule.

### The restore drill — set-up and result

Against the local stack, with the real commands, on 2026-09-05, eight ordered steps
in 88 s, twice green (the first run found one harness mistake, below):

1. `npm run db:reset:full` — the seed and the two seeded identities.
2. Representative content: a **dish** with a **photograph uploaded through the real
   pipeline** as staff (signed URL, PUT, finalize — so the `images` row, the private
   original and the four derivatives are exactly what production writes) and
   referenced from the dish; a published **news** article; a one-off
   **opening-hours override**; the **weekly special**; the **announcement** (visible,
   with expiry); a **site_contact** draft; a **page** draft; a third **identity** with a
   password, created through the Auth Admin API, with its **profile**; and the audit
   rows the pipeline wrote. Every row snapshotted as `row_to_json`, every binary hashed.
3. `backup.mjs`: exit 0, `complete: true`, 17 tables counted, `auth.users` = 3,
   the manifest's object inventory equal to the five uploaded objects and their
   sha256s equal to the pre-backup hashes; the log free of the service-role key and
   of any `user:password@`.
4. Destruction: every `public` table truncated, every identity deleted through the
   Auth Admin API, every object removed; asserted empty, sign-in failing, the
   derivative URL not serving.
5. `restore.mjs --dry-run` (nothing changed), then `restore.mjs`: exit 0, "verified".
6. **Rows byte-identical** for all nine snapshots, `audit_log` count identical, the
   image-related audit rows present, the dish still pointing at its photograph, the
   migration list identical. **Image bytes identical** in both buckets, served with
   `image/avif`/`image/webp` and `max-age=31536000`, the private bucket still refusing a
   public URL. **Both the seeded owner and the drilled identity sign in with their
   old passwords**, the restored profile row identical. **RLS and functions**: the
   anonymous role reads the published dish and neither `audit_log` nor a draft;
   `set_dish_sold_out()` on the restored dish returns `updated` and writes its audit
   row; a direct staff INSERT into `images` is still refused with 42501.
7. `npm run db:reset:full` again, after removing the drill's objects — nothing survives
   into the certification chain.

The ship step was exercised separately against the local Supabase S3 endpoint (a
throwaway private bucket, the AWS CLI from a scratch virtualenv): a monthly point
uploaded, listed back (4 objects), `latest.json` moved; then a run with a wrong
service-role key: Storage failed, the manifest said `complete: false`, the point was
shipped under `weekly/`, `latest.json` still named the earlier point, exit 1. The
restore refusals were exercised from the command line: a remote host without
confirmation, a confirmation naming a different host, a database and an API from two
project refs, a tampered `data-public.sql`, an incomplete point, missing variables —
each refused with a sentence and exit 1, none printing a credential.

What the drill does **not** prove, said plainly: loading `db/schema.sql` into an empty
project (a reference path, not the drilled one; the migrations are); a restore into a
*hosted* scratch project (the tooling's guards and the runbook are written for it, and
it is the first thing to do once a Pro project exists); and that the production
secrets are set — the first hand-run of the workflow is that proof.

### Auth, honestly

The off-platform copy restores identities and password hashes, and the drill proves
sign-in afterwards. This is the same mechanism Supabase documents for moving a
project, not a dashboard feature: the COPY statements name the Auth server's columns
at backup time, so a target whose Auth server has *removed* a column refuses the load
(the transaction rolls back whole). The runbook states the fallback — `--skip-auth`,
then the owner bootstrap and re-invitations — and that Supabase managed backups remain
the supported `auth` recovery *inside* a project. Nothing in the tooling writes to
production `auth.*` on the backup path; only an explicit, confirmed restore does.

### Tests

- `tests/unit/backup/manifest.test.mjs`, `targets.test.mjs`, `storage-and-pg.test.mjs`
  — 48 assertions: id shape and ordering, completeness derived and unforgeable,
  validation, `latest` selection, retention numbers and "never the newest",
  destination key prefixes, the migration-history rule, URL parsing without echoing,
  every restore-target refusal, redaction of values and of `user:password@`, the
  environment door, key safety and path containment, the exact `pg_dump` argument
  lists and the durable-auth list, `\restrict` neutralisation, COPY row counting, the
  truncate statements, the AWS environment holding nothing else secret, the listing
  comparison. Plain-Node suites for plain-Node tooling (`vitest.config.mts` now
  includes `tests/unit/**/*.test.mjs`).
- `tests/backup/drill.test.ts` under `vitest.backup.mts` — the drill, sequential,
  ten-minute budget, loopback-only, in CI's database job after the integration suite.
- pg_dump itself is not unit-tested (brief §26); the drill is its test.

### Source policy and secrets

`scripts/backup/lib/env.mjs` is the third allowed door for a secret's name beside the
seed script and the test cleanup, and `tests/backup/drill.test.ts` the fourth and
last; both are recorded in `scripts/check-source-policy.mjs` and `eslint.config.mjs`.
`SUPABASE_STORAGE_S3_*` is **not** introduced: the Storage half runs on the service
role the `backup` environment already needs for nothing else — a real trade-off
(one key with every capability rather than a storage-scoped pair), accepted because
`SUPABASE_DB_URL` in the same environment already grants everything, and recorded as
a carry-forward for the security phase.

### Regression

`npm run check` green (typecheck, lint, source policy — 640 files — and 2,659 unit
tests in 108 files, 48 of them new); pgTAP 2,030 assertions in 28 files; the
integration suite 25/25; the drill 8/8; `npm audit --audit-level=high` clean; the
production build green; and the read-only Playwright trio (`desktop`, `mobile`,
`no-javascript`, the axe suites at both widths among them) green against the built
site — the full chunked chain was not re-run, because no runtime module, migration,
route or component changed; every file this increment touched lives under
`scripts/backup`, `tests`, `.github`, `docs`, the two Vitest configurations, the lint
configuration and `package.json` scripts. Phases 5–12 remain locked and untouched.

### Carry-forwards for the security phase (§13, new)

- **The backup environment holds the service-role key.** Storage is read through the
  service role rather than a storage-scoped S3 key pair. Swapping the export to
  `aws s3 sync` from Supabase's S3 endpoint would narrow it; the manifest format would
  not change.
- **`db/schema.sql` is a reference copy** whose load into an empty project is not
  drilled. Either drill it against a hosted scratch project or drop it from the
  recovery point.
- **The Auth data load is the documented migration mechanism, not a dashboard
  feature**, and depends on the Auth server's column set staying compatible. Re-run
  the drill after any Supabase Auth major upgrade.
- **The destination is still undecided** (§13 item A). Until it is, no off-platform
  copy exists — managed backups are the only layer, and production is not live yet.
- **No notification beyond GitHub's failed-run e-mail** (§10g, later increment).
- **Local redaction over-reaches** when the password equals another word in the
  line (the local `postgres` password redacts the user name in the log). Harmless,
  cosmetic, local only.

### What 13B should be

The next increment is the rest of §15's row 13 minus the final audit: **rate limiting
on the sign-in and the Server Actions, the security-header pass, and Sentry on the
server** (§10g) — three bounded changes to the runtime, each with a browser-observable
surface and therefore each carrying the full chain. Metadata, sitemap, robots and
JSON-LD are to be verified against Rich Results, not rebuilt. The final security audit
over §0s–§0ah's carry-forwards stays its own, last increment. Phase 13 is not locked.

---

## 0ai. Phase 13B — rate limiting and the security-header policy (2026-09-05)

The second increment of §15's row 13, and the first of phase 13 to change the
runtime: an abuse-resistant limiter over the sign-in path and every Server Action,
and the production HTTP security-header policy. Nothing about what the
administration *does* changed — no screen, no transition, no permission — and 13A's
backup tooling is untouched. What changed is what happens when somebody asks for
the same thing far too often, and what every response tells a browser about itself.
Sentry, the SEO verification and the final security audit remain ahead (§0ah);
phase 13 is not locked.

### What was found before anything was built

**The mutation surface, from the source.** Fifty-eight Server Actions in
fifty-six files under `app/(admin)/admin`, plus three route handlers
(`/api/preview/start`, `/api/preview/stop`, `/admin/bekraeft`). Every
authenticated action begins with `requireStaff()` or `requireOwner()` and reports
through its screen's `xHref({ status })` redirect and a closed table of Danish
sentences; three answer the browser with a structured reply instead (the news
autosave, the two upload doors and the replacement). Grouped by what they actually
do, the surface is: the sign-in, reset-request and set-password actions (no
session, or a recovery session); ordinary draft saves and in-place edits (dishes,
specials, pages, contact, hours, the announcement draft, one-off overrides, alt
text, reorder steps, image slots, tapas lists, news create/save); publishing (every
editor's Offentliggør, the dashboard batch, news publish/unpublish, the takeaway
visibility through publish); the immediate paths (the three sold-out toggles and
their Fortryd, announcement visibility, replacement and restore, override removal,
dish deletion and its Fortryd); the destructive image operations (delete, replace);
the uploads (grant, finalize); and the account transitions (invite, role change,
deactivate, reactivate). The route handlers mutate nothing but a cookie.

**What the providers already own.** Supabase Auth rate-limits its own endpoints
per IP — the token endpoint the sign-in action calls, e-mail sends, OTP
verifications, token refreshes — with settings that live in the project's Auth
configuration (locally `supabase/config.toml` sets `email_sent = 10`). Those limits
protect the Auth server from anybody holding the public anon key, whether they use
this site's form or not, and nothing in this phase pretends to replace them: the
site's login form was, until now, an unlimited proxy to that endpoint from a single
origin, and *that* is what the application limiter closes. Vercel's edge holds the
network-level protections (its own DDoS mitigation, the trusted `x-real-ip` /
`x-forwarded-for` it writes on every request) and is not configured by this
repository. The application layer therefore owns exactly: the site's sign-in and
reset forms as a stuffing tool, and the authenticated mutation surface a Staff or
Owner session can flood — by accident (a script, a stuck key, a tab loop) or on
purpose.

**The headers, measured.** Against a production build of HEAD (`0aef2c7`), every
response — public pages, the news article, the 404, the login page, the `/admin`
redirect, the preview redirect, the static assets, the administration — carried
**no** `Content-Security-Policy`, `Strict-Transport-Security`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` or
`X-Frame-Options`. The production HTML carried 21 inline `<script>` elements on the
Forside and 16 on the menu editor (the React Server Components payload the
framework streams into the document), **zero** inline `<style>` elements and
**zero** `style=""` attributes. The only external origins referenced on the public
site are `www.google.com` (the directions link) and `www.facebook.com` (the page
link) — links, not resources. Fonts are self-hosted by `next/font`; images come
from this origin and from the Supabase Storage origin; the one browser request that
leaves the page is the uploader's PUT to a signed Storage URL. There is no browser
Supabase client, no third-party script, no `dangerouslySetInnerHTML`.

### The limiter — one door in PostgreSQL

Vercel runs the application on several short-lived instances, so a counter in
process memory is one counter per instance and none after a cold start. The one
durable store this system already has is PostgreSQL, and the decision "allowed or
limited" is one atomic statement there. No Redis, no new provider, no dependency.

| Piece | Where | What it is |
|---|---|---|
| **The vocabulary** | `public.rate_limit_scopes` (migration `20260905120000`), mirrored by `lib/rate-limit/scopes.ts` | Twelve scopes, each with how its subject is keyed (`actor` = the JWT's `auth.uid()`, `client` = a server-derived HMAC), a limit and a fixed window. Inserted by the migration; readable and writable by no browser role. `tests/unit/rate-limit/scopes.test.ts` parses the migration and fails when the mirror drifts. |
| **The counters** | `public.rate_limit_buckets` | One row per (scope, subject, window): four columns and nothing about the request. RLS on, every privilege revoked from `anon` and `authenticated`. |
| **The doors** | `consume_rate_limit(scope, subject)`, `peek_rate_limit(scope, subject)`; since the closure below, `reserve_sign_in_attempt(client, account)` and `release_sign_in_attempt(client, account)` (migration `20260905180000`, EXECUTE for `anon` only) | SECURITY DEFINER (below), `search_path` pinned, EXECUTE for `anon` and `authenticated` only. `consume` is one `INSERT … ON CONFLICT DO UPDATE … RETURNING` under the row lock; `peek` answers without counting. Both return `{status: allowed, remaining}` or `{status: limited, retry_after_seconds}`. Neither can lower a count; nothing can. |
| **The application door** | `lib/rate-limit/limiter.ts` | Asks, parses the reply with Zod, and reports a third answer, `unavailable`, when the database could not be asked or replied with something unreadable. Logs the scope, never the subject. |
| **The action helper** | `lib/rate-limit/actions.ts` | `enforceRateLimit(scope, refusalHref)` for the fifty-two redirecting actions; `isRateLimited(scope)` for the four that reply. One line after the guard. |
| **The sign-in throttle** | `lib/rate-limit/sign-in.ts`, `lib/rate-limit/sign-in-attempt.ts`, `lib/rate-limit/subject.ts` | The two client-keyed subjects, the reserve / attempt / settle shape (the closure below; originally peek-before / consume-on-failure), and the reset counter. |
| **The refusal** | `RATE_LIMIT_STATUS = 'for_mange'`, `RATE_LIMIT_MESSAGE` | One code on the redirect, one sentence in every screen's notice table: *"Der er sendt for mange handlinger på kort tid. Vent lidt, og prøv igen."* No count, no window, no threshold. |

**The tiers, and why each number.** Fixed windows aligned to the epoch; the goal is
that ordinary Staff and Owner work never meets a refusal while an obvious flood does.
The first draft set the content tiers by instinct (120 saves, 30 publishes, 60
immediate operations per five minutes) and the certification chain corrected it: the
chain compresses dozens of complete Staff stories into minutes, and its counters,
read from the table after the run, showed **98 saves, 31 publishes and 27 immediate
operations for one actor inside one five-minute window** — the densest
legitimate-shaped load this system has. The tiers below leave two to three times
that, which no person reaches, while a script at one request per second is still
refused inside the window. The account tiers were corrected the same way, from the
`users-admin` pair.

| Scope | Keyed by | Limit | Reasoning |
|---|---|---|---|
| `auth:signin` | client address | 10 failures / 15 min | A few mistyped passwords are nowhere near; a stuffing run through the form is refused after ten. Successes never count (§22). |
| `auth:signin-account` | account address | 30 failures / 15 min | The backstop against a run spread over many addresses at one account. Deliberately looser than the per-client tier, so knowing the owner's address is not enough to lock the owner out cheaply. |
| `auth:reset` | client address | 5 / 15 min | Reset e-mails requested. Counted on every request, since the form's answer never distinguishes. |
| `content:save` | actor | 300 / 5 min | Every draft save and in-place edit, including reorder steps and alt texts. Sized from the measurement above: the chain reached 98 in one window for one actor; a person does not reach a third of this, and a script at one save per second is refused inside the window. |
| `content:publish` | actor | 120 / 5 min | Every Offentliggør, the dashboard batch, news publish/unpublish. The chain reached 31; the first draft's 30 refused the monthly-burger story on the way. |
| `news:autosave` | actor | 300 / 5 min | A save after each two-second pause with a change; even a save every second for five minutes — a runaway loop, not a person — is refused. Its own scope so a flood here cannot starve the Gem button. |
| `operation:immediate` | actor | 120 / 5 min | Sold out and its Fortryd, announcement visibility / replace / restore, override removal, dish deletion and its Fortryd. The chain reached 27. |
| `image:upload-request` | actor | 60 / 10 min | Signed-upload grants. A batch of photographs for a new menu is a few dozen; the image projects at both widths upload several dozen inside ten minutes. |
| `image:finalize` | actor | 60 / 10 min | The sharp pipeline over up to 30 megapixels — the expensive step, refused before the original is downloaded. |
| `image:destructive` | actor | 40 / 10 min | Delete and replace, which move live references. |
| `accounts:invite` | actor | 15 / hour | Each one sends an e-mail and creates an identity. Sized from evidence rather than instinct: the first draft said five, and the locked `users-admin` pair — two complete Owner sessions within a minute, each with two validation refusals, a duplicate, a real invitation and a re-send — met the refusal on the desktop run. One Owner session is about five submissions; two in an hour must fit. |
| `accounts:mutation` | actor | 30 / hour | Role changes, deactivation, reactivation — about eight per such session, sixteen for the pair. Still the tightest tiers by a wide margin. |

**SECURITY DEFINER, and why (brief §13).** Browser roles hold no privilege on
either table, which is what keeps a counter from being read, reset, forged or
raised — and is also why the doors must be SECURITY DEFINER: an `anon` sign-in
attempt and an `authenticated` Server Action have to move a row they cannot touch.
The guards are the repository's usual ones: `search_path = ''`, a closed parameter
vocabulary (the scope must exist in `rate_limit_scopes`, a client subject must
match `^[0-9a-f]{64}$`), no identifier interpolated, EXECUTE revoked from PUBLIC,
the resolver callable by nobody, the service role not involved. What a caller can
do by calling a door directly through PostgREST is what the application does:
increase their **own** counter. An `actor` scope ignores any subject the caller
passes and uses `auth.uid()`; a `client` scope is refused for a caller *with* a
session, and a caller without one cannot compute anybody's HMAC. pgTAP `029` pins
each of these from real JWTs. This will be re-read by the final audit.

**Concurrency.** The increment is the `ON CONFLICT DO UPDATE` itself — one
statement, under the row lock — so two callers near the threshold cannot both read
the old count and both write the same new one. `029` proves it through two real
sessions (dblink): A takes four hits of a five-hit tier inside an open transaction,
B's hit blocks on the row, A commits, and B's answer is the *fifth* hit
(`remaining` 0), never the first. The sign-in path's first shape (peek, then
consume on failure) was documented here with "one known edge" — two failures in the
same instant near the threshold both passing the peek — and accepted as one extra
attempt at the boundary. The closure pass below measured it and found it was not
one: the gap is the whole Auth round-trip, and everything that arrives inside it
passes. The shape is now reserve / attempt / settle (below), and this suite's
sister `030` proves the reservation through the same two-session race.

**Growth.** Whenever a call creates a *new* bucket (the upsert returned a count of
1), it deletes every bucket whose window started more than two hours ago — twice
the longest window, so nothing that could still be counted is removed. The table
therefore holds at most the buckets touched in the last two hours; no scheduler,
no cron. `029` inserts a three-hour-old bucket and an hour-old one, proves a hit on
an existing bucket prunes nothing, and proves the next new bucket removes the old
one and keeps the recent one.

### The subjects — privacy by construction (§12)

An `actor` scope stores the profile's uuid, which the audit log already stores. A
`client` scope stores an HMAC-SHA256, under a server-side secret, of either the
trusted client address or the normalised account address — 64 hex characters that
name nobody, cannot be reversed, and cannot be joined across the two kinds (the
kind is part of the message). No raw address, no e-mail, no user agent, no request
body is written anywhere, and `029` asserts the bucket table has exactly its four
columns and that no subject looks like an address.

**Which address is believed.** On Vercel (`VERCEL=1`) the platform's proxy writes
`x-real-ip` itself, overwriting anything the client sent, so it is read — and
`x-forwarded-for`'s first entry as the fallback, for the same reason. Anywhere
else no header is trusted and every client shares one subject, `local`: a
spoofable `x-forwarded-for` from an untrusted environment would let an attacker
choose their own bucket, which is the opposite of a limit. The secret is
`RATE_LIMIT_SECRET` (§10e), read through `lib/env/server.ts` like every secret.
Locally — and in a local `next build && next start` — a fixed development key
stands in, so the throttle is exercised for real in the browser suites. On Vercel
(`VERCEL=1`, the one deployment signal the repository recognises, and the one
place client-derived subjects exist at all) the secret is **required** since the
closure below: a missing value throws at the first sign-in or reset request,
naming the variable and never a value, so the two unauthenticated forms refuse to
run rather than run weakly; nothing throws at build. A value shorter than 32
characters is refused the same way everywhere. An origin that is neither local nor
Vercel keeps a per-process stand-in with one warning: no address header is
believed there, so the only per-instance effect is the account key.

### Where the check sits — the order, and what a refusal leaves behind (brief §17)

For every authenticated action, in this order and no other: (1) the guard, so an
unknown caller is redirected before any counter exists for them and the limiter
can never answer a question about an account's existence; (2) the limiter, counted
against the session's own `auth.uid()` through the request-scoped client, so the
browser names no subject; (3) parsing, after the limiter, so a flood of malformed
submissions is counted and refused like any other; (4) the entity's own
authorization, exactly as before — `mayChangeEntity`, the transition's own
`is_owner()`, RLS; (5) the work. A refusal happens before step 3: no mutation, no
audit row, no expired cache tag, no consumed transition marker, nothing to roll
back. The action then redirects to its own screen with `status=for_mange`, and
the screen's notice table — every one of them gained the one shared entry —
shows the sentence. The dashboard's batch publish is one hit, not one per item.

For the four replying actions the refusal is a reply: the uploader shows the same
sentence in its status line for a refused grant or finalisation; a refused
replacement is its own closed status (`rate_limited`), so the uploader can say the
true thing — the new image is in the library and the old one is untouched; and the
autosave answers `for_mange`.

### The sign-in path (brief §20–§23)

`/admin/login` posts to a Server Action, which calls the Auth server with the anon
key from the server — so the application limiter sits in that action, and only
there. Before the Auth server is asked, one attempt is **reserved** in both
client-keyed counters — `reserve_sign_in_attempt()`, one decision under both row
locks, both counters or neither (the closure below; phase 13B's first shape peeked
here and consumed on failure). A throttled attempt has moved nothing and is
redirected with `fejl=for_mange` and its own sentence (*"Der er gjort for mange
forsøg på kort tid. Vent lidt, og prøv igen."*) without the Auth server ever being
contacted. The reservation then **stays** for a sign-in the Auth server refuses — a
wrong password, an unknown address and a banned account alike, so the counters
move identically for an address that exists and one that does not — and is
**released** (`release_sign_in_attempt()`, one hit back from each bucket, never
below zero) after a sign-in the Auth server accepted, or one it could not answer
(`@supabase/auth-js`'s own retryable class: a network failure or a 5xx), or an
attempt that threw. So a successful sign-in still counts nothing, an outage burns
nobody's allowance, and counters expire with their window rather than being
reset (§22). The rule is `lib/rate-limit/sign-in-attempt.ts`, pure, and proved
over fake doors before it runs against the real ones. Phase 11C's deactivated-account wording is
untouched: it is shown only after an Auth-server answer, and a throttled request
never gets one. The reset form is counted per client address on every request
(there is no failure to distinguish), and a throttled request is told so — the one
thing the form now says differently, and it says it without mentioning the
address. `setNewPassword` needs a recovery session and changes only the caller's
own password, and `/admin/bekraeft` exchanges a one-time token the Auth server
rate-limits itself; neither carries an application counter, deliberately.

**Honestly:** none of this protects the Auth server's own `/auth/v1/token`
endpoint from somebody who bypasses the site with the public anon key. That path
is the Auth server's per-IP limit, and the launch checklist (below) is where those
settings are reviewed.

### News autosave (brief §9)

The autosave is one scope of its own, counted first — before the form is read —
and answered, never redirected. The machine gained one non-terminal state,
`for_mange`: the text stays exactly where it was typed, the status line says so
(*"Der blev gemt for mange gange på kort tid. Dine ændringer er stadig her — vent
lidt, og skriv videre"*), and the next edit schedules the next attempt, exactly as
after `fejl`; a conflict is still the only stop. The unit suite pins the state,
the dirty-during-refusal path, the sentence and the recovery to `gemt` after the
window. A legitimate session cannot reach the tier: with a two-second debounce and
a change required for every save, one hundred and twenty saves in five minutes
would need a save every 2.5 s for the whole five minutes; the locked `news-admin`
and `news-mobile` suites — long sessions, formatting, a published article's live
autosave, the stale conflict — ran green under the limiter (regression, below).

### The image pipeline (brief §10)

Three server operations the application controls, three tiers: the grant
(`image:upload-request`), the finalisation (`image:finalize`, refused before the
original is downloaded or sharp is started — the uploaded original then stays in
the private bucket for the person to finalise again after the window, as after a
lost reply), and the destructive pair (`image:destructive`). The signed PUT itself
is the Storage server's, and once a URL exists the application limiter cannot
control its bytes — but a URL exists only after a grant it *did* count, and the
bucket's own size cap and the 10 MiB / 30 MP rules stand as before. The accepted
30-megapixel workflow is unchanged (`images-large` integration suite, green).
Nothing about a filename or a path is ever a subject.

### Account administration (brief §11)

Invitations are the tightest tier, the three transitions the next. The last-owner
invariant, the version check, the marker and the audit row live in the database
transitions and are not touched: a refused call never reaches them, so it writes
nothing, audits nothing and consumes no marker (`029`'s regression assertion; the
`users-admin` pair, green). These two scopes are also the only ones that **fail
closed**.

### Fail-open and fail-closed (brief §47)

`unavailable` — the limiter could not answer — is a distinct decision, and each
tier states what it means (`scopes.ts`, pinned by the unit suite):

- **Sign-in, ordinary saves, autosave, the immediate paths, the image pipeline:
  fail-open.** If the database is really down the mutation behind the limiter
  fails on its own; if only the limiter is broken (a missing function after a bad
  deploy), the administration stays usable and the Auth server's own limits still
  stand for the sign-in path. A small restaurant's administration is not made
  unusable by a counter.
- **The account transitions: fail-closed.** Rare, security-sensitive, and retried
  by an Owner at no real cost; the screen reports the generic failure sentence.

Every `unavailable` is logged with the scope and the database's sentence, never a
subject.

### The security-header policy (brief §24–§37)

One pure builder, `lib/security/headers.ts`, attached to `/(.*)` by
`next.config.ts` `headers()` — in the config rather than in `proxy.ts`, because the
proxy runs on `/admin` only and a policy that skipped the public site would be no
policy, and because a static policy leaves the public pages' five-minute caching
untouched. One set for guest and administration alike: both must resist framing,
sniffing and injected scripts, and neither needs a capability the other must be
denied. Draft Mode is a cookie, not an origin, and is unaffected. Measured after
the change: every response class — the public pages, the article, the 404, the
sitemap, the login page, the proxy's 307, the preview's 303, the administration,
the framework's static assets — carries all six headers, and every `Cache-Control`
is byte-identical to before (`s-maxage=300` public, private no-store admin,
immutable assets).

| Header | Value | Reason |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' <supabase>; font-src 'self'; connect-src 'self' <supabase>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | Below. |
| `Strict-Transport-Security` | `max-age=63072000` (production builds only) | Two years, the value preload lists require — **without** `includeSubDomains` (the domain and its subdomains are decided at launch, §13 item D) and **without** `preload` (a one-way decision for the owner, not a phase). Vercel sends its own HSTS on HTTPS deployments; pinning it here makes the policy this repository's rather than the host's. A browser ignores HSTS over plain HTTP, so the local `next start` is unaffected while the built site can still be asserted on. |
| `X-Content-Type-Options` | `nosniff` | On every response including the assets; verified against the JS, CSS and font files. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Same-origin navigation keeps the full URL; the directions link, the Facebook link and the Storage image requests receive the origin only, and nothing over a downgrade. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()` | The capabilities the site never uses, off for every origin including our own. The photograph uploader is a file input served by the operating system's picker — a phone's camera included — which needs no `camera` permission; the phone upload stories ran green. |
| `X-Frame-Options` | `DENY` | The legacy twin of `frame-ancestors 'none'`; no admin or preview workflow embeds the site. |

**The CSP, and the trade-off said plainly (brief §31–§34).** The production HTML
carries the framework's inline bootstrap scripts on every page. A nonce would
allow exactly those and no other inline script — but a nonce is a fresh value per
response, which requires dynamic rendering, which would turn the public site's
`s-maxage=300` pages into per-request renders and break the §6 / §7a promises the
`expireTime` configuration exists to keep; the framework's own guide states the
same consequence. The experimental hash-based alternative (SRI) is experimental
and build-time only. So production `script-src` is `'self' 'unsafe-inline'`, and
what that costs is the CSP's protection against an *injected inline script* — a
class this site has no surface for: no `dangerouslySetInnerHTML`, no HTML parsing,
structured news bodies, every string rendered by React (§8). What the header still
does, enforced and not report-only: no script from any other origin, no `eval`
(`'unsafe-eval'` is development-only, for React's server-stack reconstruction —
the unit and browser suites both pin its absence from production), no inline style
(`style-src 'self'`; the measured HTML has none), no object, no `<base>` hijack, no
form posting elsewhere, no framing parent, images and the uploader's connection
from this origin and the Supabase origin only, fonts from this origin only.
`upgrade-insecure-requests` is deliberately absent: production is HTTPS end to end
and HSTS covers the rest, while locally the site runs over plain HTTP against a
plain-HTTP Supabase and the directive would break every photograph in development.
No report-only mode, no reporting endpoint (13C's Sentry is where reporting could
go if ever wanted).

**In the browser (brief §39).** `tests/e2e/security-headers.spec.ts`, in the
read-only `desktop` and `mobile` projects: a guest walks the six public pages and
an article, a staff member walks the dashboard, the menu editor and its picker,
the news editor, the image library and a Forside Draft Mode preview, and an owner
walks the Owner-only screens — with the console, page errors and failed requests
watched. Zero violations at both widths. The `security` tail project adds a real
upload (the PUT to the signed Storage URL, the derivative rendering from the
Storage origin in the library and in the picker) under the same watch, also
zero.

### Tests

- **Unit** — `tests/unit/rate-limit/{scopes,subject,limiter}.test.ts`,
  `tests/unit/security/headers.test.ts`, and four new cases in
  `tests/unit/news/autosave.test.ts`: the vocabulary mirrored against the
  migration file, the tier rules (client vs actor, the account tiers tightest,
  the per-account backstop looser than per-client, fail-closed only for
  accounts, no window beyond two hours), the trusted-address reader, the
  normalisation, the HMAC derivation, the reply parsing and the fail-open /
  fail-closed mapping, the door's argument shapes and its log hygiene, every
  header directive, and the autosave's refusal state. Fifty-seven assertions.
- **pgTAP** — `supabase/tests/029_rate_limiting.test.sql`, 76 assertions from
  real JWTs: privileges, the closed vocabulary and its errcodes, the threshold
  and `peek`, the actor subject (a passed subject ignored, Owner and Staff
  apart), no read / reset / insert / edit of a bucket or a tier for either role,
  the window reset, the pruning rule, the two-session race, privacy, and the
  content tables byte-identical afterwards.
- **Integration** — `tests/integration/rate-limit.test.ts`, 9 cases: the
  application door over a real Owner session and the anonymous client through
  PostgREST, the threshold reached at the tier, a filled bucket refusing the
  next hit, the client-subject grammar, and the test door itself.
- **Browser** — `security-headers.spec.ts` (8 tests, both widths) and the
  `security` tail project (4 stories): the headers beside the cache header on
  every response class, the CSP walks, an upload beyond the tier refused in
  place with no image created, a form save beyond the tier landing on its
  screen with the shared notice and no draft written, and the eleventh failed
  sign-in refused before the Auth server is asked with a real sign-in working
  once the counters are empty.
- **The test door** — `tests/support/local-auth-admin.ts` gained
  `clearLocalRateLimits`, `fillLocalRateLimit` and `listLocalRateLimitBuckets`:
  loopback-only, service role, the same file and the same rules as the Auth
  cleanup. The application has no door that lowers a counter, by design, and the
  suites need one so a story that leaves a full bucket cannot refuse the next
  run; a filled bucket also lets a UI story meet the refusal without hundreds of
  requests (the thresholds themselves are `029`'s).
- **The closure (2026-09-05)** — `tests/unit/rate-limit/sign-in-attempt.test.ts`
  (9: the settle rule over fake doors, every outcome, no double release, nothing
  released that was not reserved), `tests/unit/env/rate-limit-secret.test.ts` (5:
  required on Vercel, optional off it, the length rule, no value echoed),
  `supabase/tests/030_sign_in_reservation.test.sql` (81 assertions: EXECUTE for
  `anon` only, the grammar, all-or-nothing at both tiers with neither counter
  moved by a refusal, the release one-back-never-below-zero and nobody else's,
  the window, the pruning, the dblink race where B is *limited* after A's commit,
  direct table access refused, content byte-identical),
  `tests/integration/sign-in-throttle.test.ts` (10, the key proof: the real
  module over the real doors and a REAL `signInWithPassword()`, the Auth requests
  counted at the fetch — eight simultaneous wrong passwords with two allowances
  left reach the Auth server exactly twice; the right password at the threshold
  reaches it not at all; a success leaves both buckets at zero; a wrong password
  leaves one; an unreachable Auth server and a thrown attempt leave the count
  unchanged; the doors through PostgREST refuse a session and a bare address and
  give nothing back for a key nobody holds), and `security.spec.ts` (story 3 now
  asserts zero hits after the real sign-in; story 4 submits six wrong passwords
  from six browsers at once through the real Server Action with two allowances
  left: exactly two `fejl=forkert`, four `fejl=for_mange`, the counter at the tier).

### Source policy and secrets

`RATE_LIMIT_SECRET` joins the secret list in `lib/env/server.ts`,
`eslint.config.mjs`, `scripts/check-source-policy.mjs` and `.env.example`; the
scanner refused the first draft's three mentions of the name outside the env
module — two in comments, one in a log line — and they were reworded rather than
allow-listed. The two limiter doors and their resolver were the only SECURITY DEFINER
additions of the first pass; the closure added the two sign-in doors, EXECUTE for
`anon` only (and extended the six pinned lists again in the same commit). No new
grant to a browser role beyond that, no service-role caller, no new dependency. Six locked pgTAP suites (`020`–`023`, `025`, `026`) pin the exact
set of definer functions by name, and the first full chain failed all six on the
three new ones — the design working as intended; their lists were extended in
the same commit, as phase 11C extended them for its two.

### Production prerequisites (not configured by this repository)

- **`RATE_LIMIT_SECRET`** in the Vercel environment — **required** since the
  closure: at least 32 characters (`openssl rand -hex 32`). A Vercel deployment
  without it refuses every sign-in and reset request, with the variable named in
  the function log; nothing is generated in its place.
- **Supabase Auth rate limits**, reviewed in the production project's Auth
  settings before launch: sign-in / token requests per IP, e-mails sent per hour
  (with Resend as custom SMTP), OTP verifications per IP, token refreshes. The
  application throttle assumes these are on; it does not replace them.
- **HSTS scope**: decide `includeSubDomains` once the domain layout is known
  (§13 item D); do not submit to the preload list from a phase.
- **Vercel**: the address headers are trusted only when `VERCEL=1`; a different
  host would need its own trusted-header decision in `lib/rate-limit/sign-in.ts`.

The launch runbook, `docs/runbooks/production-security.md`, states each of these
as a step.

### Carry-forwards for the final security audit (§13)

- **`'unsafe-inline'` in production `script-src`** — the caching trade-off above.
  Revisit if the framework's nonce support ever works with cached pages, or if
  SRI leaves experimental status.
- **The SECURITY DEFINER doors** — re-read `consume_rate_limit()`,
  `peek_rate_limit()`, `reserve_sign_in_attempt()` and
  `release_sign_in_attempt()` with the other definer functions.
- **The per-account sign-in backstop is a small lock-out surface.** Thirty
  failures against the owner's address within fifteen minutes refuse the site's
  form for that address until the window ends — an attacker needs three or more
  client addresses to get there past the per-client tier, and gains at most a
  quarter of an hour of the *form*, not of the account. Accepted as the price of
  refusing a distributed run at one account; the audit may prefer a longer
  per-account window with a higher count.
- **Only Vercel is a recognised deployment.** There the secret is required and
  the address headers are believed; locally a fixed development key stands in;
  an origin that is neither gets a per-process key with one warning and one
  shared client subject. Another host needs its own header-trust and secret
  decision (`lib/config/site.ts`, `lib/rate-limit/sign-in.ts`) before it is a
  deployment.
- **A release inside an outage.** When the limiter itself cannot be reached
  after a success, the reservation stands until its window ends — one allowance,
  fifteen minutes, logged; the fail-open tier's honest cost.
- **Refused hits keep counting** in a bucket's `hits` integer; a flood of two
  billion in one window is not a realistic concern, and the count is honest, but
  a cap is a one-line change if the audit prefers one.
- **The test door** can empty and fill counters on a loopback stack through the
  service role — the same class of door as the Auth cleanup, and no more
  reachable from the application.
- **The Auth server's own endpoints** remain the provider's to limit.

### The regression

One clean chain on 2026-09-05, from a tree holding only this increment: every
port-3100 owner stopped, `npm ci`, `npm run db:reset:full` (the seed and the two
seeded identities — clean Auth state), `.next` removed, a fresh production build,
then typecheck, lint, source policy (656 files), the unit suite (**2,716** tests in
112 files, 57 of them new), pgTAP (**2,106** assertions in 29 files, 76 new), the
integration suite (**34** in 5 files, 9 new), `playwright test --list` (**1,353**
tests in 42 files), `npm audit --audit-level=high` (clean), and the complete
Playwright matrix at `--retries=0`: the read-only trio in one invocation and every
write project in its own `--no-deps` invocation in the config's order, the new
`security` project last — **1,346 passed, 7 skipped (the standing skips), 0 failed,
0 flaky** across 48 projects. Phases 5–12 stayed green. Also verified on the way:
`Revalidate 5m / Expire 5m` (`public-cache`, and the header spec asserting
`s-maxage=300` beside the policy), zero public cookies (`public-site`), no browser
Supabase client (`tests/unit/policy`), the backup tooling untouched (no file under
`scripts/backup` in the diff), no Sentry, no phase-14 work.

Two earlier launches of the same chain were stopped by the increment itself and
are recorded rather than hidden. The first failed pgTAP on the six locked suites
that pin the SECURITY DEFINER set (above). The second failed the `monthly-burger`
project with the limiter's own sentence: `content:publish` at 30 per five minutes
had been reached by one Staff actor after `weekly-special` at both widths — the
measurement that resized the content tiers (the table above). Each launch started
again from the top; nothing was stitched.

### The closure pass (2026-09-05, later the same day)

Two of the carry-forwards above were reopened before 13C and closed narrowly, in
one commit on top of the phase's own (`fix: harden authentication rate limiting`).

**The race, measured rather than assumed.** The "one extra attempt at the
boundary" wording was tested against the real local Auth server: the per-client
counter at nine of ten, eight simultaneous wrong passwords through the real
throttle functions and a real `signInWithPassword()`, the Auth requests counted
at the fetch and again in the Auth container's own log. All eight passed the
peek, all eight reached the Auth server, and the bucket ended at seventeen —
seven attempts past the threshold, not one. The gap between the peek and the
consume is the whole Auth round-trip, and everything inside it goes through.

**What changed.** Migration `20260905180000` adds `reserve_sign_in_attempt()`
and `release_sign_in_attempt()` (SECURITY DEFINER, EXECUTE for `anon` only): the
reservation locks both current-window rows in a fixed order and moves both
counters or neither; the release lowers each by one, never below zero, for the
two sign-in scopes it names itself. `consume`, `peek` and the reset path are
untouched — the reset request was already consumed atomically before the e-mail
is sent, so it had no gap to close. The Server Action now runs
`lib/rate-limit/sign-in-attempt.ts`: reserve, attempt, settle — the reservation
stays for every verdict the Auth server gives (a wrong password, an unknown
address, a banned account, its own 429) and is released after a success, after
an Auth server that gave no verdict (`AuthRetryableFetchError`: a network
failure or a 5xx), or after an attempt that threw. Successes still never count;
an outage burns nobody's allowance; a refused attempt moves neither counter, so
a run refused per client cannot push the per-account backstop. No enumeration
difference was introduced: the refusal, the generic sentence and the
deactivated-account sentence are exactly phase 11C's and 13B's.

**The secret.** `RATE_LIMIT_SECRET` is required on Vercel — `VERCEL=1` is the
one deployment signal, and the one place client-derived subjects exist —
and must be at least 32 characters wherever it is set; a missing or short value
throws at the first sign-in or reset request, naming the variable and never a
value, so the deployment refuses the two unauthenticated forms rather than
keying them per instance. Locally, and in a local `next build && next start`,
the fixed development key stands in as before. This matters twice now: the
subjects are also what the reservation doors accept through PostgREST, and
nobody outside the server can compute one.

**Also found and fixed on the way.** The integration suites ran in parallel and
two of them now empty the shared counter table as part of their stories;
`vitest.integration.mts` runs them one file at a time.

**The regression.** One clean chain on 2026-09-05 from a tree holding only this
closure, restarted from the top twice — once for the parallel-suite interference
above (a real defect, in the harness), once because the machine slept for eight
hours inside a forty-second project and the first assertion after the resume
failed; nothing was stitched. The third run, with the machine held awake: every
port-3100 owner stopped, `npm ci`, `npm run db:reset:full`, `.next` removed, a
fresh production build, typecheck, lint, source policy (662 files), the unit
suite (**2,730** tests in 114 files, 14 new), pgTAP (**2,187** assertions in 30
files, 81 new), the integration suite (**44** in 6 files, 10 new), `playwright
test --list` (**1,354** tests in 42 files), `npm audit --audit-level=high`
(clean), and the complete Playwright matrix at `--retries=0` in the config's
order with `security` last: **1,347 passed, 7 skipped (the standing skips), 0
failed, 0 flaky** across 48 projects. Phases 5–12 and 13A stayed green; the
header suite was untouched and green; the account, news-autosave and image
tiers were not changed and their stories ran as before.

**Carry-forwards, restated.** The sign-in peek/consume edge is closed and removed
from the list above. The per-instance fallback is replaced by the rule above:
only Vercel is a recognised deployment, where the secret is required. Kept: the
per-account lock-out surface, the SECURITY DEFINER doors (now four limiter
doors), the provider's own endpoints, `'unsafe-inline'`, and one new narrow
limitation — a release the limiter cannot record during an outage leaves one
hit until its window ends.

### What 13C should be

Sentry on the server (§10g): Server Actions, route handlers and RSC errors, with
releases tied to the deployment — no browser SDK, no session replay, and a first
look at whether the limiter's `unavailable` log lines and any CSP reporting belong
there. Then the SEO verification against Rich Results, and the final audit over
§0s–§0ai's carry-forwards. Phase 13 is not locked.

---

## 0aj. Phase 13C — server-side monitoring (2026-09-05)

The third increment of §15's row 13, and the one §10g names first: Sentry on the
server, with releases tied to the deployment, and nothing in the browser. Nothing
about what the administration *does* changed — no screen, no transition, no
permission, no migration — and 13A's backup tooling and 13B's limiter and headers
are untouched in behaviour. What changed is that an unexpected server-side failure,
and a short list of operational failures the application already handled quietly,
now reach an operator with the release that produced them. The SEO verification,
the lock pass over 13A–13C and the final security audit remain ahead; phase 13 is
not locked.

### What was found before anything was built

**The plan's own words.** §1's stack note: "Sentry server-side only. No browser
SDK on public pages — it would be the single largest script on an otherwise
JS-free site. It is error monitoring, not analytics." §10g: Server Actions, route
handlers, RSC, releases tied to the deployment, no session replay. §12: the site
sets no cookies and runs no analytics, and server-side Sentry "collects no visitor
behaviour". §10e already reserved `SENTRY_DSN` as a server-only secret and
`lib/env/server.ts` already typed it; the source policy already refused its name
outside that file. So the shape was decided; what remained was to build it without
breaking any of those sentences.

**The framework.** Next.js 16.3.3 has a stable `instrumentation.ts` convention
with two exports: `register()`, run once per server instance, and
`onRequestError(error, request, context)`, run once for every error the server
did not expect, with the route path, the route type (`render`, `route`,
`action`, `proxy`) and the render source. Read in `node_modules/next/dist/docs`
and in the server source: pages and layouts call it from the React render's
error callbacks, route handlers from the route module's catch, Server Actions
from the app render with the action flag — and the hook is awaited by the server
but not by the response, so delivery must not depend on the request staying
alive. The proxy runs on the Node runtime (Next 16 has no edge proxy) and, in
this version, **never reaches the hook**: the type names `proxy`, but no code path
on the Node runtime emits it. Measured, below.

**The SDK.** `@sentry/nextjs` 10.73.0 is the vendor's Next.js package (peer
`^16.0.0-0`), one artefact for three runtimes: a Node half over `@sentry/node`
and OpenTelemetry, an edge half, a browser half over `@sentry/react`, plus a
build integration (`withSentryConfig`, the webpack plugin, `@sentry/cli`). Its
current manual-setup guide is exactly the framework's convention — `register()`
importing a server config, `onRequestError = Sentry.captureRequestError` — and
`captureRequestError` was read rather than assumed: it records the request's
**headers** and method into the event's processing metadata, sets a `nextjs`
context with the request path *including the query*, and flushes through
`waitUntil` on the edge and Cloudflare runtimes only. `@sentry/node-core`, the
lighter package, is deprecated by the vendor in this major. `@sentry/node` alone
would work but is not the supported Next.js path and pulls the same OpenTelemetry
tree.

**The mutation surface, restated.** Fifty-eight Server Actions, three route
handlers, every admin page and loader, and the proxy. None of them throws on
purpose: every refusal a person can see — validation, a stale version, forbidden,
`last_owner`, `for_mange`, a wrong password, a duplicate address, too large, wrong
type, sold out, a hidden page's 404 — is an ordinary result: a status code on a
redirect or a closed reply vocabulary. What an action does *not* handle, it lets
propagate, and the framework logs it and answers 500. That is what the hook sees.
Beside those, the modules that already said "logged for the operator" in their
notes: the limiter's `unavailable` answer (§0ai), the Auth Admin boundary's ban
and invite failures (§0ab), the storage boundary's removal failures and the
finalize flow's refused `create_image()` (§0t, §0y). Those are the operational
signals: handled for the person, invisible to anybody else until now.

### What it contains

**One package** — `@sentry/nextjs` 10.73.0, pinned, recorded in
`docs/dependencies.md` with the honest size of its tree and the one transitive
postinstall script it brings (the CLI binary download, unused here).

**`instrumentation.ts`** at the root: `register()` imports
`lib/monitoring/sentry.ts` and initialises on the Node runtime only;
`onRequestError` imports `lib/monitoring/request-error.ts` and hands the error
over. Both imports are dynamic, so the build and any non-Node bundle never
evaluate the SDK. There is no `instrumentation-client.ts`, no
`sentry.client.config`, no `sentry.server.config`, no `sentry.edge.config` and no
wrapper around `next.config.ts` — the source policy's new fifth rule and the
policy suite refuse each of them.

**`lib/monitoring/`**, six modules, no `server-only` (the instrumentation layer
is not the React server layer) and no secret of their own:

- `config.ts` — pure: **enabled** exactly when a DSN is configured and the
  process is not a test (`VITEST` or `NODE_ENV=test`), so no automated run can
  reach a real project even with a DSN; **environment** from `VERCEL_ENV`
  (`production`, `preview`, `development`) on Vercel, `test` or `development`
  off it, an unknown value ignored rather than trusted; **release** from
  `SENTRY_RELEASE`, else `VERCEL_GIT_COMMIT_SHA`, else the fixed word
  `unversioned` — stable across processes, never generated.
- `sanitize.ts` — the one `beforeSend` and `beforeBreadcrumb`. Subtractive: the
  request record keeps its method and its path without the query and loses
  headers, cookies, body, query string and env; the user record keeps an `id` or
  vanishes; the hostname goes; the transaction name and the framework's
  `request_path` lose their query; every value under a credential-shaped key
  (`authorization`, `cookie`, `passw…`, `secret`, `token`, `apikey`, `dsn`,
  `session`, `service_role`, …) becomes `[Filtered]` wherever it sits; and inside
  every string — exception values, messages, breadcrumbs, contexts, extra — a
  JWT, credentials before a host, an e-mail address, a token-carrying parameter,
  a bearer value and a Supabase auth cookie are redacted. HTTP breadcrumbs are
  dropped whole; the trail is capped at thirty.
- `classify.ts` — the framework's control-flow throws (`NEXT_REDIRECT`,
  `NEXT_NOT_FOUND`, the HTTP fallback, the dynamic-usage and bail-out digests, a
  React postpone) are not errors. The server never hands them to the hook; the
  boundary states the rule anyway.
- `storm.ts` — one event per key per minute per process, with an injectable
  clock. Not a limiter, holds no subject.
- `report.ts` — the operational door. A **closed vocabulary of thirteen events**,
  each with a component, a level and a one-sentence summary that is the message;
  a fingerprint of `['operational', name, groupBy?]` so one outage is one issue
  (per limiter scope, per storage bucket); the storm boundary; identifiers in a
  context, low-cardinality facts in tags; capture synchronous, delivery scheduled
  after the response through the framework's `after()` (on Vercel, the
  platform's `waitUntil`), a plain flush outside a request; every step wrapped so
  that a monitoring fault returns `disabled` and never reaches the caller.
- `sentry.ts` — the options: `sendDefaultPii: false`, `maxBreadcrumbs: 30`, no
  `tracesSampleRate`, no `profilesSampleRate`, no Replay; the SDK's default
  integrations minus `Http` and `NodeFetch` (outgoing-request breadcrumbs and
  trace headers to Supabase), `LocalVariablesAsync` (variable values at the throw
  — a password in scope would travel), `Modules`, `ProcessSession`,
  `ChildProcess` and `ConversationId`; `RequestData` re-added reduced to method
  and URL; `OnUncaughtException` re-added with
  `exitEvenIfOtherHandlersAreRegistered: false`, because the framework's router
  server registers its own handler and keeps the process alive — the SDK's
  default would have changed that; the SDK's `Dedupe` **not** installed, because
  it compares message and fingerprint and folded the two halves of one failed
  cleanup into one event (measured in the boundary suite). One startup line names
  the environment and the release, never the DSN; a Vercel deployment without a
  DSN logs one warning and runs.
- `request-error.ts` — the hook's body: control flow ignored; no client, nothing;
  otherwise `captureRequestError` inside a scope carrying `component: next`,
  `operation` (`server-render`, `route-handler`, `server-action`, `proxy`),
  `route` and `render_source`, handed a request record with **no headers** and
  the path **without its query** — the sanitizer would strip both again, but the
  boundary does not rely on that.

**`lib/env/server.ts`** gained `getMonitoringDsn()` — the one reader of
`SENTRY_DSN`, optional everywhere.

**Five call sites**, each where the module note already said "logged":
`lib/rate-limit/limiter.ts` (every `unavailable` answer — the scope, the door,
whether the tier fails open or closed; the release failure), `lib/accounts/
auth-admin.ts` (a ban or unban that failed after the database transition
committed, with the account UUID; an invitation or a directory listing the Auth
server refused technically — never `email_exists` or `validation_failed`, never
the address), `lib/accounts/admin.ts` (a profile that could not be created behind
an accepted identity; a transition that failed for a reason other than
permission), `lib/images/storage.ts` (a signed upload not minted, a derivative
not written, a removal that failed after a commit — the bucket and the
server-minted paths, grouped per bucket) and `lib/images/finalize.ts`
(`create_image()` refusing a server-processed upload). The console lines they
already wrote are kept; the policy suite pins that these five are the only
callers and that `captureException`/`captureMessage` appear in `report.ts` alone.

**`proxy.ts`** — one try/catch around the existing body, reporting through the
same door and rethrowing, because the framework does not (below). Nothing about
the response changed.

**Tests.** `tests/unit/monitoring/` (config, sanitize, classify and storm, and
`boundary.test.ts` — the real client, the real sanitizer, the real reporter and
the real application modules over the SDK's own `createTransport` with a
recording delivery function, inspecting the envelope the SDK would have sent:
the framework hook for an action, a render, a route handler, the proxy and a
no-JavaScript form post; a redirect and a 404 ignored; the limiter over a failing
database client — scope and door present, subject absent, one event per scope
for a hundred calls, nothing for `limited`; the Auth boundary over a failing
Auth Admin API — the ban, the unban, the profile, and the duplicate/malformed/
forbidden answers that report nothing; the storage boundary over a failing
Storage API — cleanup, grant and derivative failures, and a user refusal that
reports nothing; and the reporter's own vocabulary and key filtering);
`tests/unit/policy/monitoring-boundary.test.ts` (server only, one door, errors
only, the hook wired and Node-gated, no `setUser` anywhere); the source policy's
rule 5; `tests/e2e/monitoring.spec.ts` in the read-only `desktop` and `mobile`
projects (a guest walks the six pages and an article, a staff member the
dashboard, the menu editor and its picker, the news editor, the library and a
Draft Mode preview: no request to a monitoring host, no request to any origin
but this site and Supabase, every loaded chunk read and free of the SDK, no
cookie for the guest and only the session and draft cookies for staff, empty
storage, no console error, and the CSP byte-identical to 13B's with no reporting
header).

**Documentation.** `docs/runbooks/monitoring.md` (what is sent and what never
is, the user-identity decision, the thirteen events with their repairs, the
setup steps, the one production test, the source-map decision, orphan cleanup,
turning it off, and the backup job's separate path); `production-security.md`
§6 and its post-deploy checklist; `backups.md` §8 (the GitHub-native decision);
`docs/dependencies.md`; `.env.example` (`SENTRY_DSN` reworded, `SENTRY_RELEASE`
added); the README; and §10e, §10g, §12 and §13 of this document.

### The readings this increment had to settle

- **Server only, and how it is proved.** No browser SDK file, no client config,
  no `NEXT_PUBLIC_…SENTRY…`, no build wrapper: refused by the source policy and
  the policy suite before a build exists. After the build, `grep -ri sentry
  .next/static` is empty and the browser suite reads every chunk the walked pages
  load. No CSP directive changed and no reporting endpoint exists (`connect-src`,
  `script-src` and `img-src` are byte-for-byte 13B's).
- **The proxy is the framework's gap, closed narrowly.** Against the production
  build with a loopback ingest, a page throw, a route-handler throw and a Server
  Action throw each arrived once through the hook; a proxy throw logged and
  answered 500 and arrived **nowhere**. The one try/catch in `proxy.ts` reports
  through the same door with the same redaction and rethrows; rebuilt and
  measured again, the proxy event arrived (`operation: proxy`, `route: /admin`,
  `request_path: /admin/menu`, method only) from the same initialised client,
  and the response was the same 500. This is the one place monitoring touches a
  file outside `lib/monitoring/`, and the policy suite pins it as such.
- **A form posted without JavaScript is an action.** The framework marks a
  request as an action by its `Next-Action` header; the progressive-enhancement
  post (§7e item 11) has none, and the harness proved the framework reports that
  throw as a *render* of the page with method POST. In this application a POST to
  a page is a Server Action and nothing else, so the hook tags a render error on
  a POST `server-action`. Pinned in the boundary suite.
- **No user identity, not even the UUID.** The audit trail names the actor of
  every change; a rendering or action error is diagnosed by route, release and
  message; and the operational events that concern a specific account carry its
  UUID as a repair identifier in their context, never as the Sentry user.
  `setUser` appears nowhere, and the policy suite keeps it so.
- **One capture path per failure.** Actions that catch and report never rethrow;
  actions that throw never reported. The framework logs a Server Action error
  twice in its own log; the hook fires once and the harness counted one event.
- **The query is dropped whole, not filtered by name.** A recovery link's
  `token_hash` and an invitation's token travel in the query of
  `/admin/bekraeft`; rather than maintain a list of parameter names, the request
  path loses its query at the hook and again in the sanitizer, and the
  framework's own `request_path` context loses it too.
- **The storm rule is a boundary, not a limiter.** One event per operation (and
  per limiter scope, per storage bucket) per minute per server process, in
  memory, with no subject. A database outage during a busy minute is one
  `rate-limiter:unavailable` issue per scope; the server log still carries every
  line. The cost is stated in the runbook: several cleanup failures inside one
  minute report the first per bucket, and the audit trail is the inventory.
- **Severity, small.** `error` for an unexpected throw, an Auth-side partial
  state, a refused server-processed upload and a fail-closed limiter refusal;
  `warning` for a fail-open limiter, a release that could not be given back and an
  orphaned file. Nothing a person can repair from the screen is either.
- **No sampling, no tracing, no profiling.** Every unexpected error is sent; the
  volume of a restaurant administration does not justify less. The options that
  would enable tracing are absent, and the policy suite refuses their names.
- **Source maps: not in v1.** Server frames name the compiled chunk, line and
  column with mangled names; the framework's frames its runtime file. With the
  route, the operation, the message and the release, the harness events said
  which code path failed in which deployment. An upload would need a build token,
  a wrapper around `next.config.ts` and a release step; `next build` already
  writes server maps beside the chunks, so `NODE_OPTIONS=--enable-source-maps` is
  the cheaper later option. Recorded in the runbook for the lock pass or launch.
- **Delivery after the response.** `captureRequestError` flushes through
  `waitUntil` on the edge only; on the Node runtime the SDK starts the flush and
  relies on the process. The operational door schedules its flush through the
  framework's `after()`, which on Vercel is the platform's `waitUntil`, so a
  function is not frozen with an envelope unsent, and no successful request ever
  waits for the network.
- **The uncaught-exception handler must not change the process.** The framework's
  router server registers its own `uncaughtException` handler and continues; the
  SDK's default would have exited the process instead. Configured off.
- **Backups stay GitHub-native.** The weekly job runs in Actions outside the
  Next.js runtime; a failed run is a red workflow and a GitHub e-mail, `latest.json`
  is not moved. Wiring the production DSN into the `backup` environment would put
  an application secret where it has no other business and add a second SDK to
  tooling that has none; not done, recorded in `backups.md` §8. The restore drill
  is CI verification and reports through CI.
- **CSP reporting stays out.** 13B chose no report-only mode and no reporting
  endpoint; a browser reporting endpoint is browser monitoring by another name.
  Not added; the browser suite asserts no `report-to`, `report-uri` or
  `Reporting-Endpoints` header.
- **Preview deployments are a configuration choice.** Events carry
  `environment=preview` when a preview has a DSN; the runbook recommends setting
  the DSN for Production only.
- **Monitoring is best-effort by construction.** No DSN, no client; a malformed
  DSN, no client; every reporter step wrapped; the transport asynchronous; a
  monitoring outage costs nothing but the events. Measured: with the DSN pointed
  at a closed loopback port the administration served its pages at the same
  speed as without one (below).

### What was measured

**The harness (removed before the commit).** A throwing page, a throwing route
handler, a page with a Server Action that throws (posted without JavaScript, as
a form), and a header-triggered throw in the proxy, built into a production
bundle, served by `next start` with `SENTRY_DSN` pointing at a loopback HTTP
server that recorded every envelope, and `SENTRY_RELEASE=harness-2e10528`. Five
controls first — `/menu`, a 404, the `/admin` redirect, the preview refusal, a
`/admin/bekraeft` call with a fake `token_hash` — produced **zero events**. The
four failures produced **one event each** (the first build, without the proxy
catch: three — the proxy answered 500 and reported nothing). Every event carried
`release=harness-2e10528`, `environment=development`, `component=next`, the
operation, the route and the framework context; the request record held the
method alone; the query strings (`token_hash=…`, `token=…`), the fake cookie, the
fake `Authorization` header, the harness header and the hidden form field's value
were **absent from every byte** of every envelope; `user` and `server_name` were
absent; the SDK identified itself as `sentry.javascript.nextjs` over
`@sentry/node` from every bundle, the proxy's included. The failing requests
answered in 13–54 ms. The startup line read `Monitoring: Sentry enabled
(environment=development, release=harness-2e10528)`.

**The browser bundle.** `grep -ri sentry .next/static`: nothing. 189 server
source maps are emitted beside the server chunks and none is served.

**Latency (brief §39).** The same production build served twice on one machine,
once without a DSN and once with a DSN pointing at a closed loopback port (a
monitoring outage), twenty-five requests each, medians: the cached `/menu`
15.4 ms and 15.5 ms; the proxy's `/admin` redirect 15.3 ms and 15.2 ms; the
dynamic `/admin/login` 15.0 ms and 15.6 ms; a real sign-in Server Action with a
wrong password (the reservation, the Auth server, the release, the redirect —
four samples, inside the throttle) 144 ms and 159 ms, with the p90 168 ms and
164 ms. No successful request waits for the network, and an unreachable ingest
costs nothing measurable.

**Import cost.** `@sentry/nextjs` is imported by three server modules and reaches
the limiter, the account and the image modules; the unit suites that import
those now load the SDK, which the certification numbers below include.

### The regression

One clean chain on 2026-09-05 (16:41–17:30), from a tree holding only this
increment, launched once and never stitched: every port-3100 owner stopped,
`npm ci`, `npm run db:reset:full` (the seed and the two seeded identities —
clean Auth state), `.next` removed, a fresh production build (`grep -ri sentry
.next/static`: nothing), a detached `next start` with no DSN (monitoring off;
the only transport any test uses is the recording one inside the unit suite),
then typecheck, lint, source policy (677 files, five rules), the unit suite
(**2,806** tests in 119 files, 76 of them new in 5 new files), pgTAP (**2,187**
assertions in 30 files, unchanged), the integration suite (**44** in 6 files,
unchanged), `playwright test --list` (**1,360** tests in 43 files, 6 new in one
new file), and the complete Playwright matrix at `--retries=0` — the read-only
trio in one invocation (371 passed, the monitoring and header suites among
them at both widths) and every write project in its own `--no-deps` invocation
in the config's order, `security` last: **1,353 passed, 7 skipped (the standing
width/device/clock guards), 0 failed, 0 flaky** across 48 projects. `npm audit
--audit-level=high` on the final lockfile: 0 vulnerabilities. Phases 5–12, 13A
and 13B stayed green behind the increment: the limiter stories, the header
suite (byte-identical policy, `s-maxage=300` beside it), the sign-in throttle
and the upload under the CSP in `security`, `public-cache` (Revalidate 5m /
Expire 5m), zero guest cookies (`public-site`, `monitoring`), no browser Supabase
client (`tests/unit/policy`), the backup tooling untouched (no file under
`scripts/backup` in the diff), no phase-14 work.

### What phase 13C deliberately does not contain

- No browser SDK, no Replay, no browser tracing, no analytics, no monitoring
  cookie, no CSP change, no reporting endpoint (§1, §12).
- No tracing, no profiling, no sampling, no session/release-health tracking.
- No source-map upload, no Sentry auth token, no build wrapper (§7 of the
  runbook records the two later options).
- No user identity on any event.
- No wrapper around any Server Action, route handler or page; no
  `captureException` outside `lib/monitoring/report.ts`.
- No monitoring in the backup or restore tooling; no DSN in the `backup`
  environment.
- No `error.tsx`/`not-found.tsx` redesign, no uptime ping, no log-drain
  configuration — provider and design work that §10g lists for launch.
- No change to any accepted 13A/13B behaviour: the limiter's answers, the
  fail-open/fail-closed rule, the headers and the caching are as §0ai left them.

### Carry-forwards, for the lock pass and the final audit

- **The one controlled production event** (runbook §6) is a pre-launch gate;
  the repository proves the integration against a fake ingest and cannot prove a
  real project receives anything.
- **Compiled stack frames** in v1; the runtime source-map option or the upload
  are recorded, not taken.
- **`@sentry/cli`'s postinstall download** on `npm ci` (unused here); the final
  audit may set `SENTRYCLI_SKIP_DOWNLOAD=1` in the Vercel build environment.
- **The storm boundary's blind spot**: several cleanup failures inside one minute
  report the first per bucket; the audit trail is the inventory (runbook §8).
- **`ContextLines`** quotes compiled source lines around each frame — code, never
  data; kept for readability without source maps, noted for the audit.
- **The SDK's `turbopack: true` tag** appears on every event (set by the SDK);
  harmless, noted.
- **Preview deployments** report only where a DSN is set for them; the
  recommendation is Production only.
- From 13B, unchanged: the per-account lock-out surface, the four SECURITY
  DEFINER limiter doors, the provider's own endpoints, `'unsafe-inline'`, and a
  release the limiter cannot record during an outage — now visible as
  `rate-limiter:release-failed`.

### What 13D should be

The lock pass over 13A–13C, read as one system: the backup, the limiter and the
headers, and the monitoring walked together against a production build — the
runbooks re-read end to end by somebody who has not written them; the
pre-launch gates listed in one place (the backup destination, the Sentry
project and its one test event, `RATE_LIMIT_SECRET`, the Auth rate limits, HSTS
scope); the `error.tsx`/`not-found.tsx` question of §10g answered or
explicitly deferred to launch; then the SEO verification against Rich Results,
and the final security audit over §0s–§0aj's carry-forwards. Phase 13 is not
locked.

---

## 0ak. Phase 13 — complete and locked (2026-09-05)

Phase 13 is §15's production-hardening row, built as three increments — 13A, backup
and recovery (§0ah); 13B, rate limiting and the security-header policy (§0ai, with
its closure pass); 13C, server-side monitoring (§0aj) — and closed by this pass, which
read the three as **one operational and security layer**, re-ran every proof against
the current build, resolved the decisions the three had left to it, put every
pre-launch gate in one register, and ran one authoritative certification chain. The
SEO verification against Rich Results and the final security audit over the
carry-forwards are the next increments and were not started; neither was phase 14.
§0ah, §0ai and §0aj stand as written — each increment's own account — and this
section is what "phase 13" means as a whole.

### What phase 13 is, stated once

**Backup.** One command (`scripts/backup/backup.mjs`) takes a recovery point — a
`pg_dump` of the `public` schema (for inspection), every application table's rows
(`audit_log` included), the four durable Auth tables, both Storage buckets whole, and
a manifest written last with a sha256 for every file — and, on the schedule
(`.github/workflows/backup.yml`, Mondays weekly, the 1st monthly), ships it to any
S3-compatible private bucket and moves `latest.json` only after the upload has been
listed back complete. One command (`restore.mjs`) verifies, assesses the target,
compares migration histories, reloads in one transaction under
`session_replication_role = replica`, re-uploads the objects and verifies counts and
inventories. Retention is the destination's two lifecycle rules (63 and 190 days);
nothing in the tooling deletes. **Said precisely:** a recovery point is *a complete
data/storage recovery point paired with the repository migration history* — every
row and every byte, no dependency on an earlier point, and the schema from the
repository at the commit the manifest records. The runbooks no longer call it
"self-contained".

**Rate limiting.** One limiter in PostgreSQL: a closed vocabulary of twelve scopes
(`rate_limit_scopes`), one counter table with no address in it, and four SECURITY
DEFINER doors — `consume_rate_limit()` for every signed-in Server Action and the
reset request, `reserve_sign_in_attempt()` / `release_sign_in_attempt()` for the
sign-in path, all through one resolver; the read door `peek_rate_limit()` remains in
the database and has no application caller. Actor scopes are keyed by `auth.uid()`
inside the database; client scopes by an HMAC the server derives under
`RATE_LIMIT_SECRET`. The sign-in attempt is reserved in both client-keyed buckets
before the Auth server is asked, stays for every verdict and is released after a
success or a no-verdict failure. Fail-open everywhere but the two account scopes.
Lazy pruning at two hours bounds the table.

**Headers.** One pure builder attached to every response by `next.config.ts`: CSP
(`script-src 'self' 'unsafe-inline'`, no `eval` in production, no inline style, no
framing, images and the uploader's connection from this origin and Supabase only),
HSTS two years without `includeSubDomains` or `preload`, `nosniff`,
`strict-origin-when-cross-origin`, the permissions denial, `X-Frame-Options: DENY`.
The caching underneath is untouched.

**Monitoring.** `instrumentation.ts` initialises the SDK's server half once per
process and hands the framework's `onRequestError` to one hook; the proxy reports
through the same door because the framework does not; five server modules send a
closed vocabulary of thirteen operational events through one reporter; one sanitizer
is `beforeSend` and `beforeBreadcrumb`. Server only, errors only, no user identity,
best-effort by construction.

**Error states (§10g).** `error.tsx` and `not-found.tsx` in both route groups, built
by this pass (below).

### The recovery drill and the shipped backup — re-run on this build

The 13A drill (`npm run backup:drill`) ran green against the current HEAD: the
representative content created through the real paths (a dish with a photograph
through the real pipeline, a published article, a one-off opening-hours change, the
weekly special, the announcement, a site_contact draft, a page draft, a third
identity, the audit rows), the recovery point `complete: true` with every checksum
matching, the destruction, the restore, rows byte-identical, image bytes identical in
both buckets with the private one still private, the seeded owner and the drilled
identity signing in with their old passwords, RLS and `set_dish_sold_out()` and the
`images` INSERT guard working on the restored rows, the migration list identical.
Nothing 13B or 13C changed had made the recovery system stale — it touches no runtime
module, and the two rate-limit tables it now also dumps are operational state whose
restore is harmless (a counter window that has ended).

The ship step was exercised against the local Supabase S3 endpoint with the AWS CLI
from a scratch virtualenv: a monthly point uploaded, listed back (4 objects),
`latest.json` moved and naming it, the log free of the service-role key and of any
`user:password@`. Then a run with a broken required component (a wrong service-role
key): `storage: failed`, `manifest: INCOMPLETE`, the partial point shipped under
`weekly/` with `complete: false` and the redacted reason, **`latest.json`
byte-identical to before**, exit 1; the restore refused the partial point without
`--allow-partial`. The retention constants (63 / 190 days), the "never the newest",
and the "complete is derived, never asserted" rules are pinned by the 13A unit suite
and did not drift.

### Decisions this pass had to make

**`db/schema.sql` is a reference copy, not a restore method.** The runbook had said
it "can be loaded into an empty Supabase project" — undrilled, and a second restore
path in waiting. Corrected: the file exists for inspection (what did the schema look
like when the point was taken?), the repository's migrations at the recorded commit
are the one supported schema restore, a project created from the file would have no
migration history and the restore command would refuse it, and the repository — on
GitHub and on every developer machine — is a required part of every restore. No
second method was added and none drilled.

**Auth recovery, reconfirmed.** The four durable tables are in the off-platform copy;
sessions, refresh tokens, one-time tokens, challenges and flow state are not; the
drill proves compatible recovery against the current local Auth schema; a future Auth
server that removes a column refuses the load whole, and the fallback is
`--skip-auth` plus re-invitations; managed backups remain the supported in-project
Auth recovery. Nothing writes to production `auth.*` on the backup path. Hosted Auth
recovery is part of the scratch-project gate.

**The hosted scratch restore and the provider are pre-launch gates, not this
phase's claims.** The repository cannot prove a restore into a hosted project and does
not choose a provider or an account. Both are rows in the canonical checklist (B1–B7),
with the eight-step rehearsal spelled out and "destroy the scratch project" as its
last step. Locking phase 13 does not require them; launching does.

**The limiter is one architecture.** The generic door and the two sign-in doors share
the resolver, the tables, the tier rows, the window arithmetic and the pruning rule;
the sign-in doors exist because the sign-in path has two counters to move atomically
and a reservation to give back, which the generic increment-and-answer cannot express.
The pre-closure peek-then-consume path is gone from the application; its TypeScript
wrapper — dead since the closure — was removed by this pass, the database function
kept (granted, pinned by pgTAP `029`, harmless as a read door). The Auth concurrency
proof re-ran green: with two allowances left, eight simultaneous wrong passwords reach
the Auth server exactly twice; the right password at the threshold reaches it not at
all; a success leaves both buckets at zero; a wrong password leaves one; an
unreachable Auth server and a thrown attempt leave the count unchanged; the counters
never go negative (the check constraint and the release's `hits > 0`).

**`RATE_LIMIT_SECRET`, three environments.** Locally the fixed development key stands
in; a local `next build && next start` uses the same key (the whole Playwright chain
is that proof, port 3100, no secret set); on Vercel a missing or short value throws at
the first sign-in or reset request, naming the variable and never a value. The
production gate is one row (R1). **An origin that is neither local nor Vercel** keeps
a per-process key with one warning — classified by this pass as documented
*unsupported-deployment* behaviour: Klingenberg Food is a Vercel deployment (§10a),
and alternate hosting requires a configuration review of the header trust and the
secret rule before it is a deployment (R2). No multi-provider support was built.

**Fail-open / fail-closed, the final matrix.** Sign-in and reset, ordinary saves,
autosave, the immediate operations and the image pipeline fail open; the two account
scopes fail closed. Monitoring now sees every `unavailable` as
`rate-limiter:unavailable` (warning) or `rate-limiter:refused` (error) without
changing a single product answer — the boundary suite drives the real modules over a
failing database client and asserts both the event and the unchanged outcome.

**Headers, re-measured on this build.** Every response class — `/`, `/menu`,
`/nyheder`, `/mad-ud-af-huset`, `/find-os`, the login page, the `/admin` 307, the
preview's 303, a public 404, an `/admin/…` 404, the immutable `_next/static` chunk,
the sitemap — carried all six headers; `Cache-Control` was `s-maxage=300` on the
public pages, `private, no-cache, no-store` on the administration and the 404,
`public, max-age=31536000, immutable` on the chunk; no `report-only`, no reporting
header, no `x-powered-by`. Nothing 13C's instrumentation touched a header. The
browser suites (`security-headers`, `monitoring`) ran green at both widths against
the build, and again inside the chain.

**CSP `'unsafe-inline'` — accepted as a final-security carry-forward.** Re-evaluated
against this build only: the production HTML still carries the framework's inline
bootstrap scripts on every page; a nonce is a fresh value per response and therefore
a dynamic render, which would destroy `Revalidate 5m / Expire 5m`; the hash
alternative is experimental and build-time. The trade-off of §0ai stands, production
has no `unsafe-eval` (pinned twice), and no other architecture was attempted.

**HSTS scope — a pre-launch infrastructure decision, not an omission for good.** The
repository cannot prove that every subdomain of a domain it does not know is HTTPS,
so `max-age=63072000` without `includeSubDomains` ships, and row H2 stays open until
the domain layout does the proving. Preload is out of scope; nothing was submitted.

**Monitoring is server-only, re-proved on this build.** No `instrumentation-client`,
no browser Sentry config, no wrapper, no `NEXT_PUBLIC_…SENTRY…` (the source policy
and the policy suite); `grep -ri sentry .next/static` empty after the build; the
browser suite reads every loaded chunk and sees no monitoring request, no monitoring
cookie or storage, no Replay, no tracing; the CSP names no Sentry origin.

**Sanitization — proven over whole events, and widened twice.** A new permanent suite
(`tests/unit/monitoring/whole-event.test.ts`) assembles every forbidden value at run
time from fragments, so the assertions can cover the *entire* serialised envelope
item — stack frames and ContextLines source quotes included, which the boundary suite
has to strip. A Server Action error whose request carried an `Authorization` header,
the session cookie, a `token_hash` and a `token` in the query, a form body with a
password field, and whose message, breadcrumbs and contexts carried a JWT, an e-mail
address, the database URL with its password, the service-role key, a signed upload
URL: none of it in any byte of the event; the request record was the method and the
URL without its query. The three operational events whose provider sentences echoed
credentials: the same. Two gaps were found by that harness and closed, narrowly: the
Supabase **`sb_secret_…` key format** (the service-role key of a project created after
the key-format change — the local stack already issues one) was not redacted, because
the only key rule was the JWT rule; and the **Danish credential words**
`adgangskode` / `kodeord` were not sensitive keys. One honest limit is recorded in the
runbook: an unshaped opaque secret inside a provider's free-text sentence cannot be
recognised by any rule; the doors never pass such values.

**Operational events, re-run.** Limiter unavailable (fail-open and fail-closed), Auth
Admin partial failures (ban, unban, profile), image processing internal failures
(grant, derivative, `create_image()` refusal), post-commit cleanup orphans, and an
unexpected server exception each produced exactly the expected event with the
expected level, tags and repair identifiers; the expected business refusals — a
duplicate address, a malformed one, a forbidden transition, `limited`, `allowed`, a
redirect, a 404 — produced zero.

**Storm suppression — tightened narrowly.** The boundary keyed on
`name|groupBy`, and `groupBy` was set only for the limiter (per scope) and the
storage cleanup (per bucket). So two *different* accounts left half-moved inside one
minute — two distinct repairs — would have reported the first and silently dropped
the second's UUID. Closed by grouping the account events per account
(`auth-admin:ban-failed`, `auth-admin:unban-failed`, `accounts:profile-failed` by
`account_id`; `accounts:transition-failed` by transition), which also makes each
partial account its own Sentry issue, resolvable on its own. Pinned: three
deactivations for two accounts inside the window produce two events with two
fingerprints. What the boundary still folds is a repetition of the same fact — the
same scope, the same bucket (the audit trail is the inventory), the same account —
and that is accepted and recorded as the remaining carry-forward. No queue, no second
limiter.

**The account UUID — kept as pseudonymous operational context.** Never the Sentry
user (`setUser` appears nowhere; the policy suite keeps it so), never beside an e-mail
or a name, needed to repeat the ban or the invitation that repairs the partial state,
and the sanitizer's `user` reduction and key filter attach nothing around it. No more
identity was added.

**ContextLines — inspected and kept.** A real event's frames carry `filename`,
`function`, `lineno`, `colno`, `in_app`, `module`, `pre_context`, `context_line`,
`post_context` — source code around the frame, the compiled chunk in production —
and no `vars` (`LocalVariablesAsync` is not installed). A runtime value that appears
only in a variable never appears in a quoted line (pinned in the whole-event suite).
Environment values and request data are not source. Kept, with the dependency
behaviour recorded in the runbook.

**`@sentry/cli` — B, skipped, by the vendor's own switch.** Read in
`node_modules/@sentry/cli/scripts/install.js`: the postinstall resolves the platform
binary from the lockfile's pinned optional package (`@sentry/cli-linux-x64` and the
rest, integrity-checked from the npm registry) and exits; only when that package is
absent does it download from Sentry's CDN; `SENTRYCLI_SKIP_DOWNLOAD=1` makes it exit
before either. The project uses no Sentry build wrapper, no source-map upload and no
CLI behaviour, so both workflows set the switch, the Vercel build environment is
recommended to (row M6), and `npm ci` under it, the build, the monitoring suites and
the production server's monitoring all ran green in the chain. Enabling source-map
upload later means removing the switch wherever the build runs; recorded in three
places.

**Source maps — A, v1 kept.** Measured on the lock-pass events: release, environment,
route, operation, message and compiled frames identify the code path and the
deployment, and the commit gives the developer the source. The improvement path is
recorded in order of cost (`NODE_OPTIONS=--enable-source-maps`, then the upload with
a build-only token, which would need the CLI back).

**The real Sentry delivery gate stays manual** (row M3): a real EU project with the
browser features off, the DSN in Vercel Production, one controlled server-only
failure through a temporary trigger that is then removed, the event's release,
environment and sanitized payload confirmed, the alert configured. The repository
proves the integration against a fake ingest and claims nothing beyond that.

**Backup failure visibility — GitHub-native, confirmed.** A failed run is a red
workflow and GitHub's failed-run e-mail; `latest.json` is not moved; no Sentry SDK in
the tooling and no DSN in the `backup` environment (row B8 asks the owner to confirm
the notification setting once). Decoupled on purpose; no missing signal was found.

**Monitoring outage — proven harmless again.** The production build served with
`SENTRY_DSN` pointing at a closed loopback port (monitoring on, ingest unreachable):
a wrong password refused in 376 ms, the right one signed in in 655 ms, a real
`/admin/indhold` save in 518 ms — every result exactly as without monitoring, and the
startup line saying monitoring was on. Then served with a recording loopback ingest:
the failing requests each produced one event and the successful and refused requests
none.

### The error and not-found states — §10g answered, built

§10g requires "`error.tsx` and `not-found.tsx` in both route groups, in the approved
visual language". Measured on this build before anything was written: the public
site had its 404 since phase 3 (`app/(site)/not-found.tsx` behind the catch-all); an
unexpected public render error fell through to the framework's English "Application
error" page outside the site's shell; an administration screen's `notFound()` fell
through to the framework's default 404; and an `/admin/…` address that matched no
screen was answered, for a signed-in person, by the *public* 404 inside the public
header and footer. The default was unsuitable in a Danish restaurant's site, the plan
required the files, and monitoring did not need them — so the smallest accessible
version was built in the existing language and nothing was redesigned:

- `app/(site)/error.tsx` — the 404's composition (eyebrow, title, one sentence, the
  two button treatments): *"Siden kunne ikke vises"*, a "Prøv igen" button that
  calls the framework's `retry()`, "Til forsiden". A Client Component, as every
  error boundary must be — recorded as the public site's fourth in the policy suite,
  with its reason. No message, no digest, no stack, no logging (the server already
  reported the failure; the browser is not monitored).
- `app/(admin)/admin/error.tsx` — `AdminShell`, the error-tone `Notice`, a retry
  and "Tilbage til oversigten". Never a stack trace.
- `app/(admin)/admin/not-found.tsx` and `app/(admin)/admin/[...ikke-fundet]/page.tsx`
  — the administration's own 404 (`requireStaff()` first, then `notFound()`), so a
  mistyped administration address stays inside the administration; the eight
  existing `notFound()` calls in administration screens now land here too.

Measured against the production build with a temporary throwing page in each group
(removed before the commit): the public throw answered 500 with the site's header,
footer, sentence, retry and link, no message leaked; the administration throw
answered 500 with the administration's notice, retry and link, no message leaked;
the unknown administration address answered 404 inside the administration with
`noindex`; the public 404 unchanged; every failing request produced exactly one event
through the hook (a retry is a new request and a new event); the healthy controls
produced none. `global-error.tsx` for the root layout was not added: the root layout
renders fonts and metadata only. One observation, pre-existing since phase 3 and not
this phase's: with JavaScript off, the 404 and the error page deliver their content
as the streamed payload the boundary renders client-side, so a guest without
JavaScript sees the site's shell with an empty main (status 404 or 500 either way).
Recorded for the launch pass; the no-JavaScript promise of §7e item 11 is about
pages that work, and a page that has failed is not one.

### Cross-system failure drills

- **Limiter unavailable + monitoring** — fail-open content scope: the action went on
  as 13B decided, one sanitized warning with the scope and the door, no
  monitoring-induced failure; a hundred calls, one event. Fail-closed account
  scope: refused as 13B decided, one error event, and nothing reached the
  transition (no marker consumed, no audit row — the refusal happens before the
  database function is called, `029`'s regression assertion).
- **Image cleanup failure + monitoring** — the committed delete stayed committed and
  reported `deleted`, the orphan stayed accepted, one warning per bucket naming the
  bucket and the server-minted paths, no token from the storage error in any byte,
  the audit row's `storage_path` still the inventory. Phase 10's transaction design
  untouched.
- **Auth partial failure + monitoring** — the deactivation reported `updated` with
  `authStep: 'failed'` (the honest answer the screen already showed), the database
  transition committed and the Auth ban not, one error naming the operation and the
  account UUID only — no address, no bearer, no token — and the repair (deactivate
  again) still the documented path.
- **Backup failure** — above: `complete: false`, exit 1, `latest.json` unchanged, the
  previous point intact, no monitoring involved.

### Source policy, security review, code quality

Source policy: 683 files, five rules, OK — backup secrets named in one
door, the rate-limit secret in one door, no browser Sentry, no `NEXT_PUBLIC`
monitoring, no browser Supabase client; the SECURITY DEFINER set still pinned by
name in six locked pgTAP suites; the test-only doors still loopback-only. No
allow-list exception was added.

The scoped security review found no backup secret in any log or manifest (the
redactor over-reaches on the local `postgres` password, cosmetically), no unsafe
restore target (loopback or the exact confirmed host; refs must agree), no limiter
bypass (a client-keyed subject is refused for a caller with a session; nobody outside
the server can compute one), no production secret fallback (Vercel throws), no
SECURITY DEFINER mistake (`search_path` pinned, closed vocabulary, EXECUTE narrowed),
no CSP or header gap beyond the recorded `'unsafe-inline'`, two monitoring redaction
gaps (closed above), no product effect from a monitoring outage, and the Sentry CLI
supply-chain assumption resolved by the switch. Unresolved items are the
carry-forwards below.

Code quality, 13A–13C as one slice: no runtime module imports the backup tooling; the
two environment doors (`lib/env/server.ts`, `scripts/backup/lib/env.mjs`) are
deliberate — two runtimes, one of which cannot import `server-only`; the two redactors
(`redactSecrets` for the tooling's known values, `sanitize.ts` for shaped credentials
in events) serve different inputs and stay apart; the limiter is one architecture
(above); the stale peek wrapper is gone; no raw subject or address appears anywhere;
monitoring capture is spread to exactly five modules and the reporter, pinned; no
Server Action calls Sentry; the pre-launch prerequisites now live in one file and the
other runbooks link to it; no shell or process secret leakage (the AWS CLI's
environment holds the destination key pair and nothing else); no circular import; no
giant module. Fixed: the dead wrapper, the storm grouping, the two sanitizer gaps, the
dependency record's imprecise description of the CLI download (it is a fallback
behind the pinned optional package), and the runbooks' wording.

### The canonical pre-launch checklist

`docs/runbooks/pre-launch-checklist.md` — one register, five groups (Supabase,
backup, rate limiting, headers, monitoring), every row with one of three statuses:
*Repository proven*, *Requires production infrastructure*, *Requires one manual
pre-launch verification*. Nothing infrastructure-dependent is marked done. The other
runbooks keep their procedures and link to it; §13 item A, §15 row 13 and the README
point at it. Final copy, photography, SEO and the map are not in it.

### Final-security carry-forwards — inputs to the dedicated audit, deliberately unfixed

From the earlier systems, still standing: the News published-autosave audit row being
inserted separately from the content update (§0s); the signed-upload token's TTL and
session binding (§0u); the service-role boundaries (§0t, §0ab); private originals
never finalised (§0t); best-effort storage orphans (§0y, now visible as
`image:cleanup-failed`); `replace_image()` accepting any successor (§0y); the image
and reference markers (§0w); the account `auth.sessions` SECURITY DEFINER revocation
(§0ab); the old access token's remaining validity after deactivation (§0ab); the
deactivated-login disclosure (§0ab); the direct Owner name write (§0ab); the invite
link's lifetime (§0ab); the test-only cleanup doors (§0ab, §0ai).

From phase 13: the Auth durable-table backup's dependency on the Auth server's column
set (re-run the drill after any Auth major upgrade); the hosted restore still manual
(B7); the backup environment holding the service-role key rather than a
storage-scoped pair (§0ah); the account-targeted temporary sign-in lock-out surface
(thirty failures at one address in fifteen minutes, from three or more clients);
the four SECURITY DEFINER limiter doors and the unused read door; the provider's
own Auth endpoints; a release the limiter cannot record during an outage
(`rate-limiter:release-failed`); refused hits keep counting in an unbounded integer;
CSP `'unsafe-inline'`; the storm boundary's remaining fold (the same fact repeated
inside a minute); the account UUID as operational context; the Sentry SDK's
supply-chain footprint (106 packages for a server half) with the CLI download
switched off rather than removed; compiled stack frames without source maps;
`ContextLines` quoting compiled source; the redaction's honest limit on unshaped
secrets in provider sentences; `robots.ts` absent (§11 names it; the root layout's
`noindex` stands until launch — the SEO pass's item, noted here so it is not
rediscovered as a header question).

### The regression — one authoritative chain

One clean chain on 2026-09-05, launched once from a tree holding only this pass's
changes and never stitched: every port-3100 owner stopped, `npm ci` (with
`SENTRYCLI_SKIP_DOWNLOAD=1`), `npm run db:reset:full` (the seed and the two seeded
identities — clean Auth state), typecheck, lint, source policy (683
files), the unit suite (**2,811** tests in 120 files), pgTAP
(**2,187** assertions in 30 files), the integration suite
(**44** in 6 files), the backup drill (**8 of 8 cases, 85 s**), then
`.next` removed, a fresh production build (`grep -ri sentry .next/static`: nothing),
a detached `next start` with no DSN and no destination (monitoring off; the only
transports any test uses are the recording ones inside the unit suites; the only
backup targets the local stack), `playwright test --list` (**1,360 tests in 43 files**), the
complete Playwright matrix at `--retries=0` — the read-only trio in one invocation
and every write project in its own `--no-deps` invocation in the config's order,
`security` last — **1,353 passed, 7 skipped (the standing
width/device/clock guards), 0 failed, 0 flaky** across
48 projects, and `npm audit --audit-level=high` (0 vulnerabilities).
The chain ran from 19:18 to 20:10. One earlier launch of the same chain, at 18:16, is recorded rather than hidden: it passed every step through the drill and the build and then hung in the harness itself — the PowerShell child that starts the detached server held the script's output pipe open, so the runner never advanced to the browser section although the server was up. Nothing had failed and no state was touched after the build, but nothing was resumed either: the hung processes were killed, the server-start step was rewritten to poll a file, and the chain was launched again from `npm ci`.

Phases 5–12 stayed green behind the pass — every locked project of the matrix — and
so did phase 13: 13A (the drill, the 13A unit suites), 13B (`029`, `030`, the two
integration suites, `security-headers` at both widths, the `security` tail), 13C
(the monitoring unit suites, the boundary and whole-event suites, `monitoring` at
both widths). Also verified on the way: `Revalidate 5m / Expire 5m` (`public-cache`,
and `s-maxage=300` beside the policy on every public response), zero public
tracking cookies (`public-site`, `monitoring`), no browser Supabase client and no
browser monitoring (`tests/unit/policy`), no phase-14 work.

### Phase 13 is locked

Every condition of the lock held: the local restore drill green, the backup failure
semantics green, the limiter concurrency green, headers and CSP green, monitoring
sanitization green over whole events, monitoring proven not to affect product
failures, the pre-launch checklist canonical and current, the scoped security review
and the code-quality review closed with the fixes above, one authoritative complete
regression green, the documentation current, and no material phase-13 defect
remaining. **Phase 13 is complete and locked**, as `chore: complete phase 13
production hardening` on top of 13A, 13B, the closure and 13C.

### What comes next

Not phase 14. Two increments of §15's row 13 remain and were deliberately not begun
here: **the SEO verification** — metadata, canonicals, the sitemap, `robots.ts`
(absent today), the `NewsArticle` and organisation JSON-LD against Rich Results, and
the root layout's `noindex` lifted only at launch — and **the final security audit**
over every carry-forward listed above, run as its own dedicated review with the
`/security-review` scope, which this pass did not invoke. Then phase 14.

---

## 0al. Phase 14A — production wiring in the repository (2026-09-05)

The phase-14 planning pass split launch into four increments: **14A**, the
production wiring in the repository; **14B**, real assets and copy and the Om os
editor; **14C**, the hosted production deployment, bootstrap and verification;
**14D**, the lock. This section is 14A: everything a launch needs *from the
repository*, built and proven against the local stack, with **no hosted Supabase,
Vercel, Sentry or object-store account touched, no real credential, no real asset,
no domain, no indexing change and no copy work**. Eight decisions of the planning
pass are in force here and are restated where each lands: the Owner bootstrap uses
the phase-11 invitation; confirmed content is separated from development content;
the migration door exists but applies nothing to a real project yet; the protected
production workflow is activated in 14C; staging stays planned; the Om os editor
is 14B's; launch checks distinguish a real Vercel production build from a local
production build; the domain, the indexing and the assets are untouched.

### What was found before anything was built

- **Accounts.** Phase 11C's invitation is `auth.admin.inviteUserByEmail` (the
  identity and its Danish e-mail in one operation) followed by
  `create_account_profile()` — a SECURITY INVOKER transition that requires an
  *active Owner* as the caller. The application's own repair paths were measured
  there: an unconfirmed identity is re-sent the invitation under the same id, a
  confirmed one answers `email_exists` and is found by address and given its
  profile without a new e-mail. The profile guard (`tg_guard_account_write`)
  admits `postgres` and `service_role` with the whole table — the path
  `scripts/seed-local-users.mjs` has used since phase 1 — and refuses `anon` and
  `authenticated` outside a named transition. The deferred owner-invariant
  trigger refuses any transaction that leaves zero active Owners, on UPDATE and
  DELETE, including the cascade from `auth.users`.
- **The seed.** One file, `supabase/seed.sql`, carrying confirmed facts (contact,
  hours, nine sections, every confirmed dish, the tapas lists) *and* development
  state (the weekly placeholder, the three page documents with their placeholder
  prose, three placeholder News articles) in one run.
- **Target safety.** Phase 13A's restore guard (`scripts/backup/lib/targets.mjs`):
  loopback needs no confirmation, any other host must be named exactly in
  `BACKUP_RESTORE_CONFIRM_HOST`, a database and a Storage API from two projects
  are refused. Its pg door (`pg.mjs`) runs psql natively or from the
  `postgres:17` image with the connection in libpq's environment. Its history
  comparison (`compareMigrationHistories`) names four relations.
- **Migration history.** The CLI records `supabase_migrations.schema_migrations
  (version, name, statements)`; the local stack held 24 versions.
- **The map.** `components/site/StaticMap.tsx` held the asset descriptor;
  `public/map/LICENSE.md` records `Provenance: placeholder`; source-policy rule 4
  demands the row exist and says nothing about its value.
- **CI.** No production workflow existed; `ci.yml` runs against the local stack.

### What it contains

**The Owner bootstrap — `scripts/launch/bootstrap-owner.mjs`
(`npm run launch:bootstrap-owner --email … --name …`).** One purpose: the FIRST
Owner into an Owner-less application, through the phase-11 invitation — the Auth
Admin API sends the Danish invitation, the Owner chooses their own password on
`/admin/ny-adgangskode` — then ONE `INSERT` into `profiles` (`role = 'owner'`,
active) over the service role, the trusted path §8 names as the key's fourth
holder, narrowed to an insert: never an upsert, never an update, never a role
change, never a deletion. One audit row (`bootstrap`, entity `profile`, no
actor) records it best-effort. **This is the deliberate update of §5's older
wording**: revision 2 said a random password plus a reset e-mail; the production
bootstrap generates, prints, sends and knows no password. `lib/owner-state.mjs`
classifies what the command reads before it writes — A (nothing: invite and
create), B (unconfirmed identity, no profile: re-invite and create), C (confirmed
identity, no profile: attach, send nothing), D (a non-Owner profile behind the
address: refuse, never promote), E (any Owner profile, active or disabled:
refuse, the command is inert) — and three further refusals: a banned identity, an
Owner-less database that nevertheless holds profiles, and a directory holding
`@example.test` identities (a development stack). B and C are the partial states
a first run can leave and are repaired by the same command with the same address.

**The target guard — `scripts/launch/lib/target.mjs`, shared by all three
commands.** A production run reaches a **hosted** project only and refuses the
local stack outright; the operator confirms the target by naming its project host
(`<ref>.supabase.co`, the host the dashboard shows — a pooler host names a region,
not a project) in a variable that belongs to that one operation:
`BOOTSTRAP_CONFIRM_HOST`, `CONTENT_LOAD_CONFIRM_HOST`, `MIGRATE_CONFIRM_HOST`. A
target without a readable project ref is ambiguous and refused. The **local
harness** (`--local-harness`) inverts the first rule rather than weakening it —
loopback only, still confirmed with the loopback host, never a hosted project — and
it is how the tests drive the production code. The Owner address is refused under
every RFC 2606 reserved domain in production and required to be `@example.test`
in the harness. The primitives (URL parsing, project refs, loopback, redaction,
the logger, the pg door, the history comparison) are phase 13A's, imported; the
one change to that tooling is additive — `env.mjs` gains the three confirmation
names and two narrower readers, `readApiProject()` (the bootstrap holds no
database URL) and `readDatabase()` (the two database tools hold no service key).

**The seed split.** `supabase/seed/confirmed.sql` — the contact row, the week, the
nine sections, every confirmed dish and price, the tapas lists, and nothing else;
`supabase/seed/development.sql` — the weekly placeholder, the three page documents
(the Forside's approved hero and award strings included, because a page document
must be whole and the rest of each document is placeholder prose), the three
placeholder News articles, and the note about `npm run db:users`. `config.toml`
runs them in that order, so `npm run db:reset` produces exactly the state it did:
9 sections, 47 dishes, the contact and hours facts, the weekly placeholder, the
page documents, 3 News, 2 identities after `db:users`. There is one source of
truth for the confirmed facts; nothing is duplicated. The classification: **confirmed** —
`site_contact`, `opening_hours`, `menu_categories`, `dishes`; **development** —
`weekly_special`, `pages` (all three), `news`, and the two `@example.test`
identities the seeder creates; **structural** — the singleton rows and the
`pages` rows, which the initial migration creates and the seed only updates.

**The content loader — `scripts/launch/load-content.mjs`
(`npm run launch:load-content`).** Reads `supabase/seed/confirmed.sql` by a
constant path (never a glob, never the development layer) and applies it to a
**fresh** production database in ONE psql transaction: an in-transaction guard
re-asserts freshness, the file runs, and one `audit_log` marker row (entity
`launch`, action `content_load`, no actor, the file's sha256 and the counts)
records it. `lib/content.mjs` names four states from the tables the file
populates: *fresh* (no section, no dish, the contact row empty, the week all
closed) — load; *loaded* (marker present) — nothing to do, exit 0; *operational*
(content, no marker: a live restaurant, a restored backup, a hand-edited project)
— refuse, the administration owns the content; *inconsistent* (marker over empty
tables) — refuse. There is no `ON CONFLICT DO UPDATE` anywhere; the loader never
overwrites a live restaurant. A failure anywhere rolls the whole load back.

**The migration door — `scripts/launch/migrate.mjs` (`npm run launch:migrate`).**
Reads the target's `supabase_migrations.schema_migrations` (creating the table
the CLI's way on a fresh project), compares it with `supabase/migrations`
(`lib/migrations.mjs`, over 13A's `compareMigrationHistories`): *equal* — nothing
to apply; *target-older* — the pending files apply in order, each in its own
transaction with a CLI-compatible history row (`version`, `name`, `statements` as
the whole file); *target-newer* (versions this checkout does not know) and
*divergent* — refused before anything is applied. No rollback, no downgrade. The
door runs migrations and **nothing else**: no seed file, no content, no Owner —
pinned by the boundary suite and by source-policy rule 6.
`.github/workflows/production-migrate.yml` runs this same file from the protected
`production` environment (`SUPABASE_DB_URL` as a secret, `MIGRATE_CONFIRM_HOST` as
an environment variable) and is **dispatch-only in 14A**: adding a `push: main`
trigger now would fail every merge until the environment exists. Its header
records the four steps 14C takes to activate it.

**The launch map guard — `lib/site/map-asset.ts` and
`lib/site/map-launch-guard.ts`, run by `next.config.ts` in the production-build
phase.** A **Vercel production build** (`VERCEL_ENV=production`, the platform's own
signal — no new variable) is refused while `public/map/LICENSE.md` records
`placeholder`, the descriptor still renders the placeholder file, a required
provenance row (Provenance, File, Source, Licence, Recorded) is missing, the
licence names another file, or the file is absent. A local `NODE_ENV=production`
build, CI and every Vercel preview build pass with the placeholder — measured:
`VERCEL=1 VERCEL_ENV=production npx next build` on this tree fails in the config
phase with the two reasons named; the ordinary build passes. It validates
provenance, never pixels, and invents no licence: the asset and its licence are
14B's.

**Runbooks.** `docs/runbooks/domain-cutover.md` (preparation only, in order:
domain ownership, the Vercel domain, DNS, `SITE_URL`, the Auth Site URL, the
redirect URLs, the Resend domain, the HSTS subdomain decision, preview protection,
production `noindex` throughout phase 14, and what the SEO and final-QA passes own);
`docs/runbooks/owner-handover.md` (when the bootstrap can run, the exact command,
what success looks like, the invitation through Resend, the Owner's own password,
sign-in, `/admin/brugere`, the first Staff account, the inert second run, the
training pass — one price, one sell-out, one announcement unaided — and account
ownership at handover); `docs/runbooks/launch-notes.md` (the one dated record of
every phase-14 item, linking to the phase-13 checklist by row id rather than
copying it). `.env.example` documents the three operator variables under their own
heading, distinct from the runtime ones. `restore.md` §3 and §8 now name the door.

### Tests

- `tests/unit/launch/target.test.mjs` — the guard in both modes, the address
  rules, the two narrow readers, the four distinct confirmation names.
- `tests/unit/launch/owner-state.test.mjs` — A–E and the three refusals.
- `tests/unit/launch/migrations.test.mjs` — the repository files, the four
  relations, the bundle and its dollar-quote tag, the CLI-compatible DDL.
- `tests/unit/launch/content.test.mjs` — the four states, the bundle's order and
  its guard, the provenance embedding.
- `tests/unit/site/map-launch-guard.test.ts` — allowed everywhere but production;
  refused there for each reason; accepted for a complete non-placeholder fixture.
- `tests/unit/policy/launch-boundary.test.ts` — the launch tools outside the
  runtime graph; migration ≠ content ≠ bootstrap (no cross-import, no cross-subject,
  one launch-side service client); the seeder imported by nothing and named by no
  launch tool or workflow; the confirmed file (comments stripped) writing exactly
  the four tables and carrying no `@example.test`, placeholder, News, page,
  weekly, profile or uuid literal; the config order; the workflow dispatch-only.
- `npm run launch:drill` (`vitest.launch.mts`, `tests/launch/`), against the real
  local stack in harness mode, the last step of CI's database job:
  `migrate.test.mjs` — production mode refuses loopback; a current database is a
  no-op; a staged pending migration applies with its history row and changes no
  content and no account; target-newer and divergent refused; a failing migration
  rolls back and records nothing. `content-load.test.mjs` — the seeded stack is
  operational and refused; emptied to the migration state it is fresh, loads in
  one transaction, and the confirmed tables come back **byte-identical** to what
  the seeded reset had written (the confirmed layer alone reproduces them); the
  rerun is harmless; a marker over empty tables refuses; a forced failure leaves
  no section, no dish, no marker. `bootstrap.test.mjs` — production mode refuses
  loopback; the harness refuses a real address; E with the seeded Owner; the
  application made Owner-less by hand (with triggers quiet — the command never
  does this); a dry run changes nothing; A invites the first Owner (the Danish
  invitation in the mail catcher with its one-time link and no password, the
  profile, the audit row, no secret, token or link printed); E again; B re-sent
  and repaired; C attached without an e-mail; D never promoted; a banned identity
  refused; profiles without an Owner refused. The seeded identities are restored
  exactly.
- Source-policy rule 6, `launch-content-boundary`: no launch tool or workflow
  names the development layer or the seeder (code, not comments); the confirmed
  file holds no test identity.

### Security, reviewed narrowly

Service-role leakage — the key is read by the bootstrap alone, through 13A's
`env.mjs`, on the logger's redaction list, never printed; the database tools never
hold it. Wrong target — refused without the operation's own confirmation naming
the project host; loopback refused in production; hosted refused in the harness.
Repeated bootstrap — inert on any Owner profile. Partial invite — B and C repaired,
never by deleting an identity. Role escalation — INSERT only; D refused. Ambiguous
identity — banned refused. Log redaction — 13A's logger (the local demo password
`postgres` is redacted wherever it appears, which is harmless). Production/test
confusion — a directory holding `@example.test` identities is refused as a
development stack. Loader — no overwrite of a live database, one transaction, the
connection in the environment, no argument reaches SQL (the only argument, the
harness's `--source`, is a file path that is read, never interpolated). Migration
— divergent and newer histories refused, credentials never on a command line,
version and name from the filename regex only, `--migrations-dir` a harness option.
Coupling — none: three scripts, no cross-import, pinned.

### What phase 14A deliberately does not contain

No hosted project, no real credential, no real Owner, no real content load, no
real migration run, no workflow trigger on `main`, no staging project, no map
asset, no photograph, no copy, no Om os editor (14B), no domain, no DNS, no
`noindex` change, no SEO work, no copy humanization, no final QA, and no security
audit beyond the narrow review above.

### The regression — one authoritative chain (2026-09-05)

From a clean intended tree with no site server: `npm ci`; typecheck; lint; source
policy (709 files, six rules); **unit 2,885 / 2,885 in 126 files** (the four launch
suites, the map guard and the launch boundary among them); `db:reset:full`;
**pgTAP 2,187 / 2,187 in 30 files**; **integration 44 / 44 in 6 files**; **the
backup drill 8 / 8** (the shared `env.mjs` changed, additively); **the launch drill
28 / 28 in 3 files**; `db:reset:full` again, `.next` removed, a fresh production
build (green with the placeholder map — the guard refuses only a Vercel
production build, proven separately: `VERCEL=1 VERCEL_ENV=production npx next
build` fails in the config phase naming the two reasons); `next start` on 3100;
`playwright --list` **1,360 tests in 43 files**; the complete matrix with
`--retries=0` — the read-only trio in one invocation, then every one of the 45
write projects in its own invocation in config order — **1,353 passed, 7 skipped,
0 failed, 0 flaky**, the seven skips being the standing viewport-, touch- and
date-conditional ones (`public-site` ×3, `menu-reorder` ×3, the override reset's
day-of-week case); `npm audit --audit-level=high` **0 vulnerabilities**. Phases
5–13 stayed green throughout: the five-minute revalidate/expire contract
(`public-cache`), no guest cookie and no browser monitoring (`monitoring`,
`public-site`), the six security headers (`security-headers`), the sign-in
throttle (`security`), and the backup tooling's own drill unchanged in outcome.
Recorded as `feat: implement phase 14a production wiring`.

---

## 0am. Phase 14B1 — the Om os editor (2026-09-06)

The phase-14 planning pass found one product capability still missing for launch: the
public Om os page (1i) renders a story, a team paragraph, a method and three reserved
photographs — the facade beside the story ("STEDET"), the one team photo ("ÉT HOLDFOTO
— FULD BREDDE") and the kitchen beside the method ("KØKKEN / TILBEREDNING") — and the
administration could edit only the heading and the method through the phase-4 content
screen, and none of the pictures. 14B1 closes that gap and nothing else: **no
photograph, no copy, no map asset, no hosted account, no SEO, no 14C work.** The real
content arrives in 14B2 through this editor.

### What was found before anything was built

- **The document.** `pages.about.published` in the development seed carried
  `heading`, `story_blocks[]`, `team {text}` and `method {heading, text}`; the public
  read (`readAboutDocument`) mapped exactly those four, and the page rendered its three
  frames as `MediaPlaceholder`s with no id behind them. §4 named the intended shape —
  `team {text, image_id}`, `method {heading, text, image_id}`, `venue_image_id`,
  `award_image_id` — and the 11A and 11B migrations both left a note that "a later
  page adds its paths here, explicitly".
- **The strictness carry-forward.** `aboutDraft.team` and `aboutDraft.method` were
  ordinary `z.object()`s, recorded in §0aa and §0ac as "owned by the phase that builds
  1i's editor".
- **The role.** The registry (`lib/publishing/entities.ts`) marks `page:about`
  `staff`; the phase-1 `pages_update_scoped` policy admits every page but `home` to
  `public.is_staff()`; the §5 matrix lists Om os under no Owner row. **Om os is Staff
  and Owner alike**, and this phase preserves that rather than inventing an Owner gate.
- **The award band.** Its words on Om os are the confirmed competition result (1ab),
  stated in the page; its photograph is the Forside document's own
  (`home.award.image_id`, the Owner's, 1u's "Udmærkelsesfoto"). The band draws the
  reserved frame on Om os and passes no image.
- **The destination.** The dashboard's "Om os" tile (12C) opened `/admin/indhold`,
  the phase-4 screen whose last remaining form was Om os; `draft-publish`,
  `security` and `a11y/admin-pages` drove Om os through it.

### Decisions

| | Question | Decision |
|---|---|---|
| A | **Which document model?** | §4's, minus one key. `heading`, `story_blocks[]`, `venue_image_id` (top-level, like Mad ud af huset's `image_id`), `team {text, image_id}`, `method {heading, text, image_id}` (nested, like the Forside's sections). **`award_image_id` is deliberately not added**: the award photograph is one fact owned by the Forside document, and a second copy on a Staff-writable page would be two owners for it (§7e item 3's rule against copying a dynamic section). §4 is corrected in place. |
| B | **Strict at every level.** | `team` and `method` are `z.strictObject`s on both parses; the three image slots are `optionalRowId` (a uuid or `null`) and nothing else. Validated at the three doors the 11A closure used: the incoming write (`saveEntityDraft` → `aboutDraft.input`), the stored draft (`overlayDraft` → `aboutDraft.stored`, so a smuggled key or a malformed id is `malformed` on screen and absent from the preview) and publish (`storedDraftIsValid` → `invalid_draft`, nothing merged). Nothing is silently discarded: a section written past the editor is refused and the screen says so. A stored draft the phase-4 editor wrote (`method` without `image_id`) is exactly this case, as 11A's was for the Forside. |
| C | **The story as one field.** | `story_blocks` is edited as one textarea, paragraphs separated by a blank line (`textToStoryBlocks` / `storyBlocksToText`, pure). No markup, no formatting — the public page renders one `<p>` per block, and the schema's limits (10 blocks × 2,000 characters) are unchanged. A refused save echoes the typed text back through the address only while it fits a 6,000-character budget (`ABOUT_ECHO_BUDGET`): the other page editors echo everything because their fields are short, and a story of ten full paragraphs would exceed the server's header limit before it reached the page. The codes always travel; the field then shows the stored words. |
| D | **Three cards, one component.** | "Historien" (the page heading, the story, the facade slot), "Holdet" (the paragraph, the team slot — the heading is 1i's fixed "Holdet"), "Køkken og tilberedning" (the method's heading and paragraph, the kitchen slot). One `AboutSectionCard` — an optional heading field, one textarea, the shared `ImagePickerField` as a sibling of the Gem form — rather than three cards or a copy of `HomeSectionCard`, which carries the Forside's hidden section field. Explicit Gem per card, `NoticeFoot` for the status at the phone's foot, `PendingBand` / `StateBadge` / `CardPendingBadge` shared — the established language (1u, 1aj), nothing invented. |
| E | **The deltas.** | The story card's two keys are top-level, so its save is the per-key rule (`aboutStoryWrite`); the team and method are written whole with the slot's *current* image from the merged document (`aboutSectionWrite`), so a pending photo survives a Gem of the words and a pending edit survives choosing a photo. The facade slot follows the one-field rule, the two nested slots the whole-section rule (`aboutImageWrite`). A section pending only for its picture badges the slot, not the words (`pendingAboutCards` compares merged with published). |
| F | **The SQL, in the same objects.** | Migration `20260906120000_about_page_admin.sql`: `image_references` gains six `page:about` rows named "Om os"; the page guard learns the three about paths (spelled dotted and split, because they differ in depth within one row and PostgreSQL has no ragged array); `delete_image()` and `replace_image()` move them live under the trusted transitions and pending as a selection, and report `page:about` in `affected`. The draft detach mixes the two established rules because the document does: the top-level facade key leaves the draft (11B), a nested selection returns to the published value and an unchanged section leaves (11A). No `owner_only`: the page is Staff-writable, as Mad ud af huset is. `publish_page()` is unchanged. |
| G | **The phase-4 content screen is retired.** | Two editors for one document would be two saving conventions for one draft — §0aa's reason for retiring it for the other two pages. `/admin/indhold` is deleted; the dashboard tile points at `/admin/om-os`; `draft-publish`, `security` and `a11y/admin-pages` drive Om os through the new editor (the a11y half as its own `about-admin.spec.ts`). The `saveDraft`/`editorForm` helpers left `support/admin.ts` with it. |
| H | **The public page.** | Not redesigned. `AboutPageContent` is the page's body, extracted so it can be asserted as HTML without a database; the three frames render through `SiteImage` in exactly the boxes the placeholders reserved, with three new `IMAGE_SIZES` presets (`aboutVenue`, `aboutTeam`, `aboutKitchen`) for the real rendered widths, and the reserved frames when no id is stored. The facade loads eagerly as the page's primary image. `alt` is the library's description through the one renderer — an undescribed photograph renders `alt=""` (§0y) — and the document carries no alt of its own. |
| I | **The development seed.** | The about document gains the three image keys as `null`, so it is the strict document whole; no prose changed, nothing moved to `confirmed.sql` (pinned by `launch-boundary` and the new `about-boundary`). |
| J | **Two narrow fixes the new suite found.** | (1) 1w's detail panel composed its warning from the raw usage rows — "Billedet bruges på: Om os · Om os" for one image in two slots — where the grid caption already deduplicated through `usageDisplayNames`; the panel now uses the same helper (a latent defect for the Forside's three slots too, never reached because no locked suite put one image in two Forside slots). (2) The public Om os headings and paragraphs gain `break-words`: the editor admits a 120-character heading and 2,000-character paragraphs, and a long unbroken word in one of them scrolled the 375 px page sideways in the long-content story. Neither changes the design for ordinary content. |

### What it contains

`lib/pages/about.ts` (the pure model: normalisation, the story split, the deltas, the
slots, the sentences), `lib/content/about-admin.ts` (the uncached editor read),
`app/(admin)/admin/om-os/` (`page.tsx`, `routes.ts`, `forms.ts`, `save-actions.ts`,
`image-actions.ts`, `publish-actions.ts` — three text vocabularies and the shared
picker vocabulary plus a slot name, disjoint), `components/admin/about/`
(`AboutSectionCard`, `AboutNotices`), `components/site/about/AboutPageContent.tsx`,
the migration, the seed's three null keys, `page:about` in `REFERENCE_KINDS`, the
`ImageUsage` kinds and the `affected` schema, and the strict `aboutDraft`.

### Tests

- `tests/unit/schemas/drafts.test.ts` — the about block: whole and cleared documents
  parse unaltered on both paths, single-key drafts carry only their key, a smuggled
  nested key is refused naming the section and `malformed` on the way out, a section
  without its image key is refused (the phase-4 draft shape), sibling keys refused,
  each slot a uuid or null on both parses, the story's limits, `award_image_id` and
  `award` refused, the top-level read path still drops an unknown key.
- `tests/unit/pages/about.test.ts`, `about-forms.test.ts`, `about-notices.test.tsx` —
  the model, the vocabularies and addresses (the echo budget included), the sentences.
- `tests/unit/about/about-page.test.tsx` — the public markup: the words, the reserved
  frames, the three pictures in their boxes with the library's alt, `alt=""` for an
  undescribed image, derivatives only, the award stated once.
- `tests/unit/policy/about-boundary.test.ts` — one Om os editor and no `/admin/indhold`;
  no raw JSON editor; the shared picker pair and no `<dialog>`/`<picture>`/storage URL/
  client component under the about files; no Supabase client; `aboutDraft` without a
  non-strict object and without `award_image_id`; the confirmed seed clear of Om os.
  `images-boundary` and `cache-impact` extended with the seventh kind and the seventh
  selection action.
- `supabase/tests/031_about_page.test.sql` (82) — structure; the six view rows; the
  guard on all three paths for Staff, Owner and anon with a text write still open;
  publish moving three images under the marker; the `delete_image()` matrix for the
  top-level and the nested keys, the same image in all three slots, the unconfirmed
  refusal counting six; `replace_image()` over four references in one call; audit;
  unrelated content byte-identical. 024/025/026's exact `affected` shapes widened
  by the new key.
- `tests/e2e/about-admin.spec.ts` under `about-admin-mobile` and `about-admin` (after
  the takeaway pair, before the contact pair): the editor accessibly with 44 px
  targets and 16 px fields, a story draft with the foot in view on the phone, the
  unchanged first guest request, the preview, a refusal bound to two fields with its
  echo, the three cards pending, two uploads and one description, all three slots
  chosen (keyboard first) with the library's caption "Om os (kladde)" once, the
  preview with the library's alt and an empty alt, publish → the FIRST guest request
  with words and three pictures and no private original, no-JS, an alt edit reaching
  the guest, Staff's replacement moving both slots that shared the image, a pending
  removal, a draft-only deletion clearing exactly the selection, a live deletion
  clearing both slots, a stale second tab refused, three drafts written past the
  editor (a smuggled role, a malformed id, the phase-4 shape) unreadable / absent
  from the preview / `invalid_draft`, anonymous refused the editor and the row, the
  guard refusing a direct move of each published path, the longest valid content
  legible at both widths, the seed restored.
- `tests/a11y/about-admin.spec.ts` (read-only, both generic projects): axe clean,
  labels, the three slot names, the picker modal, no overflow, 16 px fields.
- `tests/e2e/draft-publish.spec.ts` re-pointed at the editor's method card; the
  baseline publish now handles the §4 delta (saving the live value writes no draft).

### Security, reviewed narrowly

Forged access: an anonymous request is sent to the login page, a plain POST writes
nothing, and RLS refuses the row (`about-admin`); a Staff JWT may write `pages.draft`
directly — as it always could — and such a draft goes nowhere (strict `stored` parse
at overlay and publish). Draft leakage: the guest read never selects `draft`, and
the preview needs an active staff session (`draft-publish`). Malformed JSON: refused
at three doors; the public normalisation is lenient and throws on nothing. Image
reference bypass: a direct move of any published path is refused for Staff and Owner
by the guard (pgTAP 031, `about-admin`), the draft paths are in the view, and the
transitions move them. Direct PostgREST modification of `published`: a text write is
still admitted for Staff (002's promise), an image movement is not. Service role: not
involved anywhere — every read and write is the caller's own JWT. Private originals:
never composed (the renderer, `images-boundary`, `about-boundary`; asserted on the
guest and the preview). Publish authorization: `requireStaff()`, `mayChangeEntity`,
RLS — three refusals, as on every page.

### What phase 14B1 deliberately does not contain

No photograph, no copy, no humanized text, no map asset, no award field, no team
members, no rich text, no mobile-specific action, no second publish path, no
`/security-review`, no SEO change (metadata as before), no 14C work. The phase-13
carry-forwards of §0ak stand as recorded.

### Code quality, inspected at the end

`app/(admin)/admin/om-os/page.tsx` is 330 lines — the Forside's is 440, Mad ud af
huset's 290 — and holds no rule: the deltas, the story split, the slot table and the
sentences are `lib/pages/about.ts` (unit-tested), the vocabularies and echoes
`forms.ts`. One card component rather than three; no copy of `HomeSectionCard` (it
carries the Forside's hidden section field). The picker pair is imported, never
redrawn (pinned). The schema is nine lines in `page-documents.ts`, not in the UI. Two
duplications are recorded and deliberately left: the three page editors each carry the
same 20-line `one`/`many`/`searchParamsOf`/`cardKey` helpers, and `lib/pages/{home,
takeaway,about}.ts` each carry the same `imageField` uuid check — the first two copies
belong to locked phases, and a shared module for four small functions was not worth
touching them for; a later pass may lift both once. No generic CMS abstraction was
introduced.

### The regression — one authoritative chain (2026-09-06)

From a clean intended tree with no site server: `npm ci`; typecheck; lint; source
policy (727 files, six rules); **unit 2,959 / 2,959 in 131 files** (the five Om os
suites and the widened image fixtures among them); `db:reset:full`; **pgTAP 2,269 /
2,269 in 31 files** (`031` is 82); **integration 44 / 44 in 6 files**; **the backup
drill 8 / 8**; **the launch drill 28 / 28 in 3 files**; `db:reset:full` again, `.next`
removed, a fresh production build; `next start` on 3100; `playwright --list` **1,408
tests in 45 files** (`about-admin.spec.ts` under exactly `about-admin-mobile` and
`about-admin`, 22 each; `a11y/about-admin.spec.ts` under the two generic projects);
the complete matrix with `--retries=0` — the read-only trio in one invocation, then
every one of the 47 write projects in its own invocation in config order — **1,401
passed, 7 skipped, 0 failed, 0 flaky**, the seven skips being the standing viewport-,
touch- and date-conditional ones (`public-site` ×3, `menu-reorder` ×3, the override
reset's day-of-week case); `npm audit --audit-level=high` **0 vulnerabilities**.
Phases 5–13 and 14A stayed green throughout: the five-minute revalidate/expire
contract (`public-cache`), no guest cookie and no browser monitoring (`monitoring`,
`public-site`), the six security headers (`security-headers`), the sign-in throttle
(`security`), the launch tooling's own drill and the confirmed-content boundary
unchanged in outcome; no photograph, no copy and no map asset introduced. Recorded as
`feat: implement phase 14b about administration`.

### What 14B2 owes

Through this editor and the library, by the restaurant and the Owner (or the
developer on their behalf): the facade photograph (4:5, daylight), the one team
photograph (16:7, the whole team, natural light), the kitchen photograph (3:2), each
with a description written in the library; the story (up to ten paragraphs), the
team paragraph (no names, no roles) and the method's heading and paragraph. Outside
this editor: the Forside's hero, award and team-excerpt photographs and words
(`/admin/forsiden`), Mad ud af huset's words and photograph, the map asset and its
licence (`public/map/`), and the placeholder News. None of it is seeded.

---

## 0an. Phase 14B2 — real launch assets and temporary factual copy (2026-09-06)

The Owner supplied `launch-assets/` — the real handmade logo (`logo.svg`) and twenty
food photographs — and `launch-assets/launch-copy.md`, temporary but factual Danish
text for the Forside, Om os and Mad ud af huset, explicitly marked for later
humanization. This phase integrates both through the repository's own doors: the
image library and picker (10B/10C-1), the three page editors (11A, 11B, 14B1) and the
static-asset locations the logo and a licensed map already had reserved
(`components/site/layout/SiteLogo.tsx`, `app/icon.svg`, `public/map/`). No new asset
pipeline, no second media system, no CMS abstraction.

### What was integrated

- **The logo.** `public/brand/logo.svg` is the supplied vector, byte-identical —
  no redraw, no smoothing of the handmade K. `SiteLogo` (the public header, footer
  and mobile menu) and `DashboardBar` (the admin bar) render it as a plain `<img>`
  at the sizes the design already drew for the placeholder circle, `alt=""` because
  the visible "Klingenberg Food" wordmark beside it is the accessible name. `app/icon.svg`
  is the same vector: Next serves an SVG favicon natively at whatever size the tab
  asks for, which is the smallest correct derivative of a mark that must not be
  redrawn — checked at 16, 32 and 48 px raster before landing (the K stays legible
  at all three). `images-boundary.test.ts`'s raw-`<img>` inventory was widened by one
  entry for `SiteLogo.tsx`, next to the map's own.
- **The dish photographs.** Only two of the twenty supplied photographs carry a
  filename that clearly names a confirmed dish: `odin.png` → **Odin**, `ragnar.png`
  → **Ragnar** (both burgers, both prices and descriptions already confirmed, §32
  of `confirmed.sql`). `tapaz.png` was read as a filename variant of **Tapas** and
  matched the confirmed dish's own board (charcuterie, cheese, jamón-style items);
  it is attached to that dish's `image_id` too, though the public Tapas board
  (`TapasTable.tsx`) is a text table by design (1h/1m) and renders no photograph at
  all — the reference exists for the library and for a later surface, not for this
  one. No other filename matches a confirmed dish: `pulled-pork-crispy-burger.png`
  reads like **Glade Gris**'s description but does not name it, and the brief is
  explicit that a resemblance is not an identification — Frigg, Thor and Glade Gris
  keep their reserved "Retfoto" frame on the public menu, honestly.
- **The Forside.** `hero.heading` already matched the launch copy verbatim (a
  coincidence with the development placeholder); `hero.intro` and `about_excerpt`
  (heading reused from Om os's own real heading, body the excerpt paragraph) were
  replaced with the launch copy's words, unrewritten beyond joining each two- or
  three-paragraph source into the one flowing field the schema gives each of them.
  The hero image is `bacon-egg-burger.png` — a strong, unnamed burger photograph on
  a surface that names no dish, matching the brief's own example alt
  ("Burger med bacon og spejlæg"). The award words and the featured-dish list are
  untouched, as instructed; the award photograph is not supplied and the frame
  stays reserved.
- **Om os.** The heading, the four-paragraph story, the team paragraph and the
  method's heading and paragraph are the launch copy's words (the team and method
  fields are single text fields in the strict document, so each field's source
  paragraphs are joined, not rewritten). `facade.png` — actually the dining room,
  not an exterior — is the only supplied photograph the Owner marked for this page,
  so it is the venue slot's image; there is no supplied team or kitchen photograph,
  and both frames are left in their approved no-image state (§9).
- **Mad ud af huset.** The heading, intro and both free-text sections are the launch
  copy's words; the existing "Ring og hør mere" CTA label is untouched.
  `sandwich-trio.png` — a real, unattributed food photograph appropriate to the
  page's generic "food for a gathering" role — is the page's optional image. No
  price, package, minimum order or deadline was invented; §11's excluded list stayed
  excluded.
- **The map.** `launch-assets/` holds no map image and no licence, source or date
  record. The placeholder and its guard (`lib/site/map-launch-guard.ts`, phase 14A)
  are untouched, and `public/map/LICENSE.md`'s provenance is still `placeholder` —
  reported as a launch blocker (§9), not fabricated.
- **`launch-assets/` itself** is added to `.gitignore`: it is the operator's source
  folder, read once by hand to place the two files the repository actually needs
  (the logo, and a map when one arrives), and it is never imported, referenced by
  path, or read at runtime or build time.

### One defect found and fixed while uploading through the real picker

Uploading a second image in one browser session (exactly the workflow 14C's real
content load repeats) left the new image's "Beskrivelse af billedet" field showing
the **previous** image's saved text: `ImageDetailPanel`'s alt-text field is an
uncontrolled `defaultValue` textarea, and the admin's list-plus-single-detail-panel
page swapped which image the panel described by route query alone, with no `key`
telling React to remount it — so the DOM node, and its typed value, survived the
navigation. Confirmed reproducible with a full page load reverting to correct
(empty) behaviour and a client-side one reproducing the bug; fixed with one line,
`key={selected.id}` on `<ImageDetailPanel>` in
`app/(admin)/admin/billeder/page.tsx`, which is the smallest root cause — the panel
already receives the freshly-loaded row, only the DOM reuse was wrong. This is a
correctness risk for the real production content load in 14C, where an operator
uploading several photographs in one sitting could otherwise save one photograph's
caption onto another's row unnoticed; worth fixing now rather than carrying it
into that pass.

### What was not integrated, and why

- **The award and about-excerpt photographs (Forside)** and **the team and kitchen
  photographs (Om os)** — no supplied photograph is confirmed as depicting the
  award, the team or the kitchen; each stays the approved reserved frame. Reported
  as launch blockers for the restaurant to supply, not invented.
- **Seventeen of the twenty supplied food photographs** — strong photography with
  no confirmed dish identity (`freja`, `ivar`, `bestla`, `norden`, `valhalla`,
  `ydun`, `jacksparrow`, `bacon-red-onion-burger`, `double-crispy-chicken-burger`,
  `pulled-pork-crispy-burger`, `boefsandwich`, `chicken-red-cabbage-sandwich`,
  `shwarma`, `wienerschnitzel`) were left out of the library entirely — quality
  over quantity (§7), and no automation was built to place them; the mapping above
  is the whole record, reproducible by hand in 14C.
- **Copy humanization, SEO and `/security-review`** — none started, per the brief.

### The regression — one authoritative chain (2026-09-06)

From a clean reset: typecheck; lint; source policy (728 files); **unit 2,959 / 2,959
in 131 files** (the widened raw-`<img>` inventory among them); `db:reset:full`;
**pgTAP 2,269 / 2,269 in 31 files**, unchanged (no migration in this phase); a fresh
production build (`/icon.svg` now a static route serving the real mark);
`npm audit --audit-level=high` **0 vulnerabilities**; a detached `next start` on
3100 and the **complete Playwright matrix at `--retries=0`** — the read-only trio in
one invocation (`desktop`/`mobile`/`no-javascript`, 375 passed, 3 skipped), then
every one of the 44 remaining projects in dependency order, each its own
`--no-deps` invocation — **all passed**, with exactly the seven standing
viewport-/touch-/date-conditional skips the phase-13 and phase-14B1 chains also
recorded, 0 failed, 0 flaky. The local database was then reset once more and the
real content re-entered through the admin exactly as above, so the local stack is
left in the state 14C's operator will reproduce in production.

### What 14C still owes

Production Supabase, the migration run, the confirmed-content load, the Owner
bootstrap and the domain cutover (§0al, unchanged) — **and now, from this phase**:
the award, about-excerpt, team and kitchen photographs from the restaurant; and
repeating this phase's photo uploads and selections against the production image
library, since none of it is seeded (`docs/runbooks/launch-notes.md` §1 records the
mapping to reproduce). The licensed static map is no longer owed to 14C: §0ap
replaced it with a Google Maps embed, finalised by §0aq as the official
Google-generated embed for the restaurant's own listing — nothing map-related is
owed to 14C at all. Phase 14 is **not** complete or locked by this pass.

## 0ao. Phase 14B2 cleanup — text-only Om os sections for unsupplied photography (2026-09-06)

§0an's own record already said it plainly and this pass takes it at its word: the
restaurant has no team group photograph and no dedicated kitchen photograph, and
none is invented. What §0an left unfinished is that the *public page* still drew
the hatched "awaiting photo" frame for those two sections — the correct look for a
photograph the restaurant is expected to supply before launch, the wrong look for
one it does not have and is not required to. This pass narrows required launch
photography to what the restaurant actually supplied and makes the public page say
so honestly.

- **The venue photograph is unchanged and does its one job.** `about.venue_image_id`
  is the Owner's facade/interior photograph (14B2, §0an) in the Om os "Stedet" slot;
  it is never relabelled as a team or kitchen photo.
- **The Forside about-excerpt slot now reuses that same photograph** (`home.about_excerpt.image_id`,
  selected through `/admin/forsiden`, published) rather than staying the accepted
  no-image frame it held since 11A. The source image is square (1254×1254); its
  existing crop into the excerpt's `card` (4:3) frame reads as a normal interior
  shot, not a strained crop, so this is one photograph doing double duty rather
  than a second upload — `docs/runbooks/launch-notes.md` §1 records the reuse. The
  admin picker's label for that slot, hard-coded as "Holdfoto" since 11A, is
  corrected to the generic "Billede" now that the slot is not always a team photo
  (`app/(admin)/admin/forsiden/page.tsx`; `tests/e2e/homepage-admin.spec.ts`
  updated to match).
- **`team.image_id` and `method.image_id` null is a text-only layout, not a
  reserved frame.** `AboutPageContent` (`components/site/about/AboutPageContent.tsx`)
  now renders `SiteImage` for those two sections only when an image is selected;
  with none, the heading and paragraph sit alone at the section's full measure
  (Holdet keeps its existing 62ch paragraph width; the kitchen's paragraph widens
  from 48ch, the width chosen for a column beside a photograph, to the same 62ch
  when it has the full column to itself, so a stray narrow column does not sit
  in an otherwise empty band). The moment the Owner selects a photograph for
  either slot the reserved-frame, side-by-side layout returns automatically —
  nothing about the admin editor, `image_references`, or the two documents'
  shape changed; `/admin/om-os`'s "Holdfoto (valgfrit)" and "Køkkenfoto (valgfrit)"
  slots are exactly as 14B1 left them. This is the same pattern the phase-10 lock
  pass already established for a dish or article without a photo (no reserved
  image slot, `tests/unit/site/no-image-cards.test.tsx`) — not a new one.
- **The award photograph stays exactly what §0am decided**: optional, no second
  copy of the Forside's own award image on Om os, the accepted reserved frame
  when there is none. Nothing about it changed or needed to.
- **Regression.** Presentation-only — no migration, no `image_references` change,
  no admin form change beyond the one label. Typecheck, lint, source policy (727
  files), the full unit suite (2,960 / 2,960 across 131 files, `about-page.test.tsx`
  and `home-images.test.tsx` updated for the new text-only assertions), a fresh
  production build, and the read-only public accessibility suite
  (`tests/a11y/public-pages.spec.ts`, 30 / 30, both projects — no violations, no
  interactive target under 44 px, one first-level heading per page, no horizontal
  overflow) all green. The write-project E2E matrix was deliberately **not**
  re-run: doing so from a clean reset would discard 14B2's already-entered launch
  content (the facade, hero, dish and logo selections) exactly as §0an's own
  regression note describes needing to re-enter it afterward, which is
  disproportionate to a presentation-only change and is not required by it — the
  unit suite already covers the changed component directly, image by image and
  text by text, without a database.

**What this does not change.** Required launch photography is now scoped to what
the restaurant supplied: the venue photograph (present), the two confirmed dish
photographs and Tapas's own (present, §0an), the logo (present, §0an). The team
photograph, the kitchen photograph and the award photograph are optional and the
public page already has an honest look for their absence. **The licensed static
map remains the one real outstanding photography/asset blocker** (§13 item A3,
`docs/runbooks/launch-notes.md`) — nothing here supplies or sources it. (Superseded
by §0ap: 14B3 replaces the static map with a Google Maps embed rather than continue
waiting on a licensed asset.)

---

## 0ap. Phase 14B3 — the static map replaced by a Google Maps embed (2026-09-06)

§13 item A3 and §0ao both recorded the same fact: no licensed static map image, and no
licence for one, ever arrived from the restaurant or a provider. Rather than continue
carrying it as the one launch blocker with no path to close it, this pass retires the
whole static-map system (decision 6, §7g) and replaces it with a Google Maps embed —
a narrow, self-contained simplification, not a redesign of Find os.

**Removed.** `lib/site/map-launch-guard.ts` and its unit test, `lib/site/map-asset.ts`,
`components/site/StaticMap.tsx`, `public/map/` (the placeholder SVG and
`LICENSE.md`), source-policy rule 4 (`map-provenance`), and the
`next.config.ts` build-phase call that ran the guard. `site_contact.map_attribution`
is left in the schema untouched (§1v already kept it out of every editor) but is no
longer read by any component.

**Added.** `lib/site/map-embed.ts` (`mapEmbedUrl`, a pure function of the address and
an optional API key) and `components/site/GoogleMap.tsx` (one `<iframe>`, the same
`aspect-hero`/`aspect-card` frame the static image used). `GOOGLE_MAPS_EMBED_API_KEY`
is optional (`.env.example`): unset, the embed uses the keyless
`https://www.google.com/maps?q=…&output=embed` form, which needs no Google Cloud
project; set, it moves onto Google's supported Maps Embed API. `frame-src
https://www.google.com` was added to the CSP (`lib/security/headers.ts`) — the
minimum the embed needs, nothing else widened.

**What this closes, and what it opens.** §13 item A3 and the launch-notes A3 row are
closed: there is no licensed asset left to obtain. What replaces it is smaller and
explicit: production should provision and restrict a Maps Embed API key before
launch (a configuration step, not a code change), and the final privacy/cookie/security
review (§13 item, later gate) should decide whether embedding third-party Google
content needs disclosure or consent — this pass builds no consent mechanism and
invents no answer to that question.

**What this does not change.** The written address, the opening hours, "Vis vej" and
every other piece of Find os and the Forside's visit panel are unchanged. No map
library was added; the guest's browser still talks to Google directly, and this
origin still makes no runtime call to a map service of its own.

---

## 0aq. Phase 14B3 fix — the official Google-generated embed, no key (2026-09-06)

§0ap shipped a dual-mode `mapEmbedUrl(address, apiKey)`: a keyless
`https://www.google.com/maps?q=<address>&output=embed` form by default, moving onto
`https://www.google.com/maps/embed/v1/place?key=…&q=<address>` once
`GOOGLE_MAPS_EMBED_API_KEY` was set. That was a reasonable read of "no licensed asset,
no Google Cloud dependency" at the time, but it was still this codebase reconstructing
a Google Maps URL from address text, rather than the actual official embed Google
generates for a specific place listing. The user supplied that official embed link —
copied directly from Google Maps' own "Del" → "Integrer et kort" dialog for the
restaurant's own listing, "Carl Nielsen Hallens Cafeteria" — and this pass finalises
§0ap by using it directly instead.

**Removed.** `lib/site/map-embed.ts` (`mapEmbedUrl`) and its unit test
(`tests/unit/site/map-embed.test.ts`) — once the `src` stopped being computed from the
address, the function had nothing left to do. `GOOGLE_MAPS_EMBED_API_KEY` is removed
from `.env.example`, from `components/site/GoogleMap.tsx` and from every doc that
named it as an optional or required launch step: there is no key, keyed or keyless
branch, and nothing to provision in Vercel.

**Changed.** `components/site/GoogleMap.tsx` now renders the supplied `src` as a
literal constant — Google's own generated link for the restaurant's listing, never
built from the stored address or any runtime value — with `allowFullScreen` added and
`referrerPolicy` moved to `strict-origin-when-cross-origin` to match the embed exactly
as Google generated it. The `aspect-hero`/`aspect-card`/`aspect-square` responsive
frame, the Danish `title="Kort over <address>"` (still built from the real stored
address, for accessibility — never Google's place label, which is not this
codebase's fact to assert or invent), the CSP `frame-src` entry, and "Vis vej" are
all unchanged.

**What this closes.** `docs/runbooks/launch-notes.md`'s A3 row: there was never an
A3′ requiring `GOOGLE_MAPS_EMBED_API_KEY` provisioning after all, since the finished
implementation never needed one. Nothing in phase 14's launch checklist names a map
key or a Google Cloud project any longer. §15's phase-14 table row and the phase
status paragraph are updated to match; the two E2E assertions that checked the old
address-derived `src` (`tests/e2e/public-site.spec.ts`,
`tests/e2e/no-javascript.spec.ts`) now check for the official embed's
`https://www.google.com/maps/embed?pb=` form instead.

**What this does not change or start.** Not a redesign of Find os, not phase 14C, not
the SEO or security/privacy review — the privacy-review question §0ap opened about
third-party Google content stays exactly as open as it was, recorded in
`docs/runbooks/launch-notes.md` §8.

---

## 0ar. Phase 14C — certification done, hosted deployment blocked (2026-09-06)

14C is the hosted increment: the production Supabase project, the migration run, the
confirmed-content load, the Owner bootstrap, the production media re-upload, the Vercel
deployment, Sentry, the off-platform backup, the restore drill, the domain and the
hosted smoke test. **None of it could run, because none of the external infrastructure
it acts on exists yet.** This pass established that as a measured fact rather than an
assumption, did every piece of 14C that lives inside the repository, and stopped at the
boundary.

### What was measured, not assumed

| Service | State on 2026-09-06 | How it was checked |
|---|---|---|
| GitHub repository | **Absent** — the checkout has no remote at all | `git remote -v` prints nothing |
| Vercel project | **Absent** | no `.vercel/` directory; nothing has ever been linked |
| Production Supabase project | **Absent** | `supabase status` reports `linked_project: null`; `.env.local` holds only `http://127.0.0.1:*` |
| Resend / custom SMTP | **Absent** | no account exists to configure; Auth mail is the local Mailpit catcher |
| Sentry project | **Absent** | no DSN anywhere; `SENTRY_DSN` unset, monitoring correctly inert |
| Off-platform backup destination | **Absent** | no `BACKUP_S3_*` value exists to hold |
| Domain / DNS | **Absent** | `SITE_URL` unset; the site resolves to `localhost` by design |
| Owner e-mail address | **Not supplied** | the bootstrap has no address to invite, and none was invented |

Because the repository can neither create nor prove any of these, rows M2–M4, C3–C4,
O2–O5 and D0–D8 of `docs/runbooks/launch-notes.md`, and every "Requires production
infrastructure" row of `docs/runbooks/pre-launch-checklist.md`, stay open. They are
reported to the operator as one grouped, ordered set of manual steps rather than being
marked done. **No credential, project reference, address or DSN was invented to make a
gate look closed.**

### The migration workflow stays dispatch-only — a decision, not an omission

`.github/workflows/production-migrate.yml` names four activation steps in its own
header, and step 4 (adding the `push: main` trigger) is explicitly the *last* of them:
it may only follow a protected `production` environment holding `SUPABASE_DB_URL` and
`MIGRATE_CONFIRM_HOST`, and one successful dispatch run against the real project.
Neither the environment nor the repository exists, so adding the trigger now would arm
a job that fails on every merge and points at nothing. **The workflow is unchanged.**
The condition is documented and simply not met; 14C's judgement is that the architecture
already approved is correct and that its ordering must be honoured.

### The environment audit

Every variable named in `.env.example` was cross-checked against the source, the launch
scripts, the three workflows and `lib/env/server.ts`. The set is exact: no variable is
documented that nothing reads, and no secret is read outside `lib/env/server.ts` and
`scripts/`. `GOOGLE_MAPS_EMBED_API_KEY` is confirmed **absent everywhere** and was not
re-added — §0aq retired it, the embed is a fixed Google-generated `src`, and the map
needs no key. The retired launch-map guard (`lib/site/map-launch-guard.ts`,
`lib/site/map-asset.ts`, `public/map/`) is confirmed gone from the tree and from
`next.config.ts`, so no stale build guard can refuse a production build. Nothing in the
audit required a documentation change: no stale variable was found.

### The deferred E2E failures, investigated rather than waived again

The visual pass had recorded 22 read-only E2E failures against the previous baseline and
deferred them. They split cleanly into two causes, and neither was waived:

**Cause 1 — local database drift, not a product defect.** 14B2 entered the real launch
copy through the administration, against the same local stack the E2E fixtures read. The
`pages` rows for `about` and `takeaway` therefore held the launch headings (*"Mad fra
Carl Nielsen Hallen"*, *"Mad ud af huset"*) where `tests/e2e/support/site.ts` expects the
development seed's (*"Vores historie"*, *"Mad til fester og store selskaber"*). A clean
`npm run db:reset:full` restored the seed baseline and every one of these disappeared —
proving the drift was environmental. **No test and no fixture was changed for these**:
changing them would have pinned one operator's hand-entered content as the suite's
expectation.

**Cause 2 — a deliberate product change the tests had not caught up with.** Two
assertions still demanded that *nothing at all* leave this origin, which §0ap/§0aq
knowingly ended by embedding Google's map: `tests/e2e/public-site.spec.ts`'s *"no
third-party script, pixel or tag manager is loaded"*, and `tests/e2e/monitoring.spec.ts`'s
foreign-request assertion in both of its walks. Measured against the running site, the
embed pulls 47 foreign requests across six Google hosts (`www.google.com`,
`maps.googleapis.com`, `maps.gstatic.com`, `fonts.googleapis.com`, `fonts.gstatic.com`,
`places.googleapis.com`) — a list Google changes at will, so allow-listing hosts would
pin somebody else's deployment detail.

The rule these suites now assert is **whose frame asked**, in one shared helper,
`tests/e2e/support/map-embed.ts`. A request is Google's business if it is the embed's own
navigation request, or if walking from the requesting frame up through its parents finds
the embed's URL. Everything else off-origin still fails. The guarantee worth keeping is
kept intact and is arguably sharper than before: an analytics script, a pixel or a tag
manager added to the site would sit in the **main** frame, whose URL is this origin's,
and would still fail — while the accepted embed is excepted without naming a single
Google host. `monitoring.spec.ts` additionally stops collecting Google's frame scripts
for its chunk scan: those are Google's bundle, not this build's, and fetching them over
the network on every run would test somebody else's code for the Sentry SDK.

**The privacy question is untouched.** That the embed puts third-party Google content in
a guest's browser at all remains open and remains the later privacy/cookie review's, as
§0ap opened it and `docs/runbooks/launch-notes.md` §8 records it. This pass changed what
the tests *assert*, not what the site *does*.

**Cause 3 — found only because the brief insisted the deferred specs actually run.** The
first complete matrix stopped in `about-admin-mobile` at *"the first guest request is
unchanged — a draft moves nothing"*: the guest's `/om-os` returned an **empty story**
where two published paragraphs were expected, and 139 later tests never ran behind it.
The page was measured directly and renders both paragraphs correctly — the fault was in
`tests/e2e/support/about-admin.ts`, whose snapshot selected the story by the arbitrary
utility `p.max-w-[52ch]`. The frozen visual pass (`0c9acc6`) had retuned that reading
measure to `text-lead max-w-[54ch]`, so the selector matched nothing and the helper
returned `[]` rather than failing loudly. **The public design is frozen and correct; the
test was stale**, so the test was fixed and the component was not touched.

The fix is the lesson the same file had already written down for the method paragraph,
applied to all three: select body text by the type-scale class it shares
(`p.text-lead.text-neutral-ink`, scoped to its own container, which holds no other body
paragraph) rather than by a max-width a presentation pass may legitimately retune. A
sweep confirmed **no other class-pinned selector remains anywhere under `tests/`**. This
is exactly the failure mode the 14C brief was guarding against by refusing to let
`about-admin.spec.ts` and `homepage-admin.spec.ts` stay deferred a second time: a spec
that does not run cannot report that a frozen design moved out from under it.

### Full local certification (2026-09-06)

Run after a deliberate clean local reset, against a production build, with
`--retries=0`. This certifies the **codebase**; it certifies nothing about a production
environment, because there is none (the opening table above).

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run check:policy` | pass — 724 files |
| Unit suite | **2,949 passed** / 130 files |
| pgTAP | **2,269 passed** / 31 files |
| Integration | **44 passed** / 6 files |
| Backup drill | **8 passed** |
| Launch drill | **28 passed** |
| Production build | pass |
| Playwright, complete matrix, `--retries=0` | recorded in `docs/runbooks/launch-notes.md` §9 |
| `npm audit` | **0 vulnerabilities** |

The two specs the visual pass had left unexecuted — `tests/e2e/homepage-admin.spec.ts`
and `tests/e2e/about-admin.spec.ts` — ran in this matrix, in all four of their projects.

### What this pass deliberately did not do

Not phase 14D, not the security review, not SEO, not the `noindex` lift (verified still
served as `<meta name="robots" content="noindex, nofollow">`), no copy humanization, no
design change, and no public launch. **Phase 14 is not complete and not locked.**

---

## 1. Stack verdict

**Use the proposed stack.** Next.js (App Router) + TypeScript + Tailwind + Supabase (Postgres/Auth/Storage) + Vercel + Vitest + Playwright is a good fit for this system, with four concrete adjustments.

Why it fits:

- The public site is six mostly-static pages. React Server Components ship ~0 KB of JS for them. Tag-based revalidation makes "publish" appear instantly without any client polling or realtime subscription.
- The admin is not trivial — roughly 15 screens with forms, toggles, drag-reorder, optimistic undo, a modal conflict flow and image upload. Server Actions cover all of it without a hand-written API layer.
- Supabase gives Postgres + password auth + object storage + managed backups in one EU project. The alternative (Neon + Auth.js + R2) is three vendors for the same result.

### Adjustment 1 — Server Actions are the authorization boundary; RLS is defence in depth

Do **not** build the admin as a browser Supabase client relying on RLS as the only gate. Every mutation runs in a Server Action that:

1. resolves the session from the httpOnly cookie,
2. calls `requireStaff()` / `requireOwner()`,
3. writes through a request-scoped Supabase client carrying the user's JWT, so RLS re-checks the same rule.

Two independent enforcement points, clear error messages, no authorization logic in the browser.

### Adjustment 2 — No Supabase JS in the browser at all

- Login: a Server Action calls `signInWithPassword` on the server client and sets the cookies.
- Reads: server-side only.
- Image upload: a Server Action mints a **signed upload URL** after the role check; the browser does a plain `PUT`. This sidesteps the Server Action body-size limit and keeps the service-role key server-only.

Result: the admin bundle carries forms and small interaction code, nothing else.

This survives decision C1 unchanged: the announcement expiry guard is arithmetic on a timestamp the
server already rendered. It performs no request of any kind.

### Adjustment 3 — Process images at upload time, not on every request

The design promises "Uploads bliver automatisk tilpasset og komprimeret" and that staff never see pixel sizes. Do exactly that:

- Browser downscales to max 2560 px with `<canvas>` before upload (fast on phones, cheap on the network).
- Server re-encodes with `sharp` into a fixed derivative ladder (AVIF + WebP at 480/960/1440/2160) and strips EXIF including GPS.
- Serve with plain `<img srcset sizes>` inside fixed `aspect-ratio` containers, as the design already specifies.

This avoids Vercel image-transformation quotas and one moving part. `next/image` is not needed.

### Adjustment 4 — Add Zod and axe; add nothing else

- **Zod** — one schema per entity, used by the form and re-parsed by the Server Action. Non-negotiable given how much of this system is free-text content.
- **@axe-core/playwright** — the design commits to specific accessibility guarantees; test them.

Explicitly **not** used: any state-management library, any client data-fetching library, any component
library, any headless CMS, any realtime subscription, any cron service, **any map library or runtime
tile provider**, and **any analytics or tag-management script**. Dates/timezone handled with `Intl` +
a tested helper — no date library unless the helper proves fragile in review.

### Other stack notes

- **Tailwind v4**, with the design tokens declared once in `@theme` (`--color-brand-700: #720401` etc.). The token table in screen 1aa maps to it one-to-one.
- **Supabase region: `eu-central-1` (Frankfurt)**. Vercel functions pinned to `fra1`.
- **Supabase Pro in production** (confirmed). Free is used for staging only. See §10.
- **Custom SMTP via Resend** (confirmed) for production password reset. The local CLI mail catcher is used in development. See §10.
- **Vercel paid plan (Pro) for production** (confirmed). This is a commercial site; Hobby is not used. See §10.
- **Sentry server-side only.** No browser SDK on public pages — it would be the single largest script on an otherwise JS-free site. It is error monitoring, not analytics: it never runs in a visitor's browser and records no visitor behaviour.
- **No framework versions are pinned in this document.** See §14.

---

## 2. Architecture overview (plain language)

There is one Next.js application with two halves.

The **public half** is rendered on the server and cached. Visitors download HTML, CSS, images, and a very small amount of JavaScript — enough for the mobile menu, the open/closed badge, and the announcement bar. Nothing on the public site can write to the database. No visitor is given a cookie of any kind.

The **admin half** lives under `/admin`, requires a login, and is rendered per request. When staff save something, the browser posts to a Server Action: a function that only ever runs on the server. That function checks who you are, validates what you sent, writes to the database, and tells Next.js which cached public pages are now stale.

Content exists in two states. Editing writes to a **draft**; the public site keeps serving the **published** values until someone presses Offentliggør. Two things intentionally skip that: marking a dish Udsolgt, and turning off an active announcement. Those write straight to the published value and offer a 10-second Fortryd.

Time-dependent things — announcement expiry, the sold-out reset, Månedens burger's date window, "Åbent nu" — are **never** handled by a background job, a cron service, or a scheduled-publishing service. They are computed at read time from data that is already in the row, the pages re-generate every five minutes as a safety net, and two very small client components correct the two cases where five minutes of staleness would actually be visible to a guest: the open/closed badge recomputes each minute, and the announcement bar removes itself the moment its expiry passes.

That five-minute revalidation is now load-bearing for three behaviours (see §7a). It is a deliberate,
documented trade: one number in one place, adjustable without touching the architecture.

---

## 3. Project structure

```
app/
  (site)/                       # public, lang="da"
    layout.tsx                  # announcement bar → header → main → footer
    page.tsx                    # Forside
    menu/page.tsx
    mad-ud-af-huset/page.tsx
    om-os/page.tsx
    nyheder/page.tsx
    nyheder/[slug]/page.tsx     # confirmed in scope (decision 5)
    find-os/page.tsx
  (admin)/admin/
    layout.tsx                  # session guard + noindex header
    login/page.tsx
    page.tsx                    # Oversigt (1q / 1x)
    menu/page.tsx               # Rediger menu (1r / 1y)
    menu/ugens-ret/            # (1ag) + "Kopiér sidste uge" — built in phase 6A
    menu/maanedens-burger/page.tsx  # (1ah) + the date window — built in phase 6B
    nyheder/page.tsx
    nyheder/[id]/page.tsx       # editor (1s / 1z)
    besked/page.tsx             # (1ad)
    aabningstider/page.tsx      # (1t) + conflict sheet (1ae)
    forsiden/page.tsx           # (1u)
    mad-ud-af-huset/page.tsx    # (1aj)
    kontakt/page.tsx            # (1v)
    om-os/page.tsx              # the editor for 1i's page — built in phase 14B1 (§0am)
    billeder/page.tsx           # (1w)
    brugere/page.tsx            # owner only — not in the approved design, built in its language
  api/preview/[start|stop]/route.ts
  sitemap.ts  robots.ts  opengraph-image.tsx
components/
  site/                         # Header, AnnouncementBar, OpenStatus, MenuSection, BottomNav …
    AnnouncementBar.tsx         # server component
    AnnouncementExpiryGuard.tsx # 'use client' — the only new client component (decision C1)
    GoogleMap.tsx               # <iframe> on Google's own generated embed link, a literal constant (decision 6, revised 14B3, §0aq)
  admin/                        # Field, Toggle, UndoToast, ReorderList, ConfirmDialog, ConflictSheet …
    TapasEditor.tsx             # tapas lists (decision 3) — built in phase 5F as
    TapasGroupEditor.tsx        #   three forms with their own tiny `moveListItem`,
                                #   *not* as a reuse of the dish ReorderList: that
                                #   abstraction writes per-row `sort_order` drafts and
                                #   a tapas group has no rows. See docs/dependencies.md.
  ui/                           # token-level primitives shared by both
lib/
  config/site.ts                # SITE_URL resolution — the ONLY place a domain may appear (decision 10)
  supabase/{server,service}.ts  # no browser client
  auth/{session,guards}.ts      # requireStaff / requireOwner
  content/{read,draft,publish}.ts
  hours/{engine,format}.ts      # pure, heavily unit-tested
  menu/availability.ts          # pure sold-out resolution (decision 2)
  announcements/lifecycle.ts
  images/{signed-upload,derivatives}.ts
  schemas/                      # Zod, one file per entity
  seo/{metadata,jsonld}.ts
supabase/
  migrations/  seed.sql  config.toml
  templates/                    # Danish auth email templates, versioned (decision 9)
  tests/                        # pgTAP RLS tests
.github/workflows/
  ci.yml
  backup.yml                    # weekly off-platform storage + db export (decision C2) — phase 13A, §0ah
scripts/backup/                 # the backup and restore commands and their doors — phase 13A
docs/runbooks/
  backups.md  restore.md  domain-cutover.md  owner-handover.md
tests/
  unit/  e2e/  a11y/
public/
  map/                          # static map asset + LICENSE.md recording provenance
  logo, favicon
```

---

## 4. Database plan

Conventions: every table has `id`, `created_at`, `updated_at`, `updated_by`. Prices stored as `price_ore integer` (minor units) and edited in kroner. RLS enabled on **every** table.

The draft mechanism is one nullable `draft jsonb` column holding **only the changed fields**. Live columns stay plainly typed and queryable; publishing merges `draft` into the columns and sets it to `null`. That gives the per-row "Kladde" badge in 1r and the dashboard's pending count (`count(*) where draft is not null`) for free, without doubling the schema.

**Change in revision 2:** the `is_available boolean` columns are replaced by `sold_out_on date`
(nullable). `NULL` means available. A date means "marked sold out on that Copenhagen-local date",
and the reset is derived, not stored. See §7b.

| Table | Purpose | Key fields | Read | Write | Draft/published |
|---|---|---|---|---|---|
| `profiles` | Who can log in and what they may do | `user_id`→auth.users, `name`, `role` ('owner'/'staff'), `disabled_at` | self + owner | owner | no |
| `menu_categories` | The nine sections and their order | `slug`, `name`, `sort_order`, `intro`, `note`, `kind` ('dishes'/'weekly_special'), `visible`, `draft` | public | staff | yes |
| `dishes` | Every menu item | `category_id`, `name`, `description`, `secondary_note`, `price_ore`, `labels text[]`, `details jsonb`, `image_id`, `sort_order`, **`sold_out_on date`**, `sold_out_changed_at/by`, `is_new_draft`, `deleted_at`, `draft` | public (published, not deleted) | staff | yes — **except `sold_out_on`** |
| `weekly_special` | Ugens ret + Lørdagsmenu, one singleton row | `iso_year`, `iso_week`, `days text[]`, `name`, `description`, `price_small_ore`, `price_large_ore`, `image_id`, **`sold_out_on`**, `sat_enabled`, `sat_name`, `sat_description`, `sat_price_ore`, `sat_deadline`, **`sat_sold_out_on`**, `draft` | public | staff | yes — except both `*sold_out_on` |
| `monthly_burger` | Månedens burger, one singleton row reused each month | `name`, `description`, `price_ore`, `image_id`, `starts_on`, `ends_on`, **`sold_out_on`**, `show_on_homepage`, `draft` | public when filled + in window | staff | yes — except `sold_out_on` |
| `news` | Nyheder | `title`, `slug` (unique, frozen at first publish), `body jsonb`, `category`, `display_date`, `image_id`, `status` ('draft'/'published'), `published_at`, `author_id` | public where published | staff | per-item publish |
| `announcement` | The site announcement bar, one singleton row | `message` (≤90), `link_type`, `link_page`, `link_url`, `link_label`, `expires_at`, `is_visible`, `source` ('manual'/'opening_hours'), **`source_override_id`** (§0n), `previous jsonb`, `replaced_at`, `draft` | public where visible **and** `expires_at > now()` | staff | yes for edits, **no** for hide/remove |
| `opening_hours` | The normal weekly schedule, one singleton row | `schedule jsonb` (7 × `{closed}` or `{from,to}`), `draft` | public | **owner** | yes |
| `opening_hours_overrides` | One-off changes | `date` (unique), `kind` ('closed'/'custom'), `opens_at`, `closes_at`, `status` ('draft'/'published'), **`draft`** — *`announcement_created` was dropped by 8C-3A; see §0n* | public, future dates | staff | per-row publish, **plus a draft for an edit to an already-published row** — see §0j |
| `pages` | Editable page documents | `key` ('home'/'takeaway'/'about'), `published jsonb`, `draft jsonb`, `is_visible` — the `home` document's three `image_id` paths and the `takeaway` document's one are references (`image_references`, phases 11A/11B) and the published paths are guarded like the image columns (§0z reading F); `is_visible` is the Mad ud af huset switch, carried in the draft and moved by `publish_page()` alone (§0aa readings A and C) | public (`published`, where `is_visible`) | staff (`home`: **owner**) | yes — **the switch included** |
| `site_contact` | Contact facts used everywhere, one singleton row | `primary_phone`, `secondary_phone`, `address_line1`, `postal_code`, `city`, `venue_name`, `email`, `facebook_url`, `map_attribution`, `draft` | public | **owner** | yes |
| `images` | Media library | `storage_path`, `alt_text`, `width`, `height`, `bytes`, `mime`, `derivatives jsonb`, `original_filename`, `uploaded_by` | public (published bucket) | staff | no |
| `audit_log` | Who changed what, and the recovery story | `actor_id`, `action`, `entity`, `entity_id`, `before jsonb`, `after jsonb` | owner | system | no |

Deliberately **not** created:

- No `image_usages` join table. "Bruges på: Forsiden" is a SQL view over the handful of known reference columns.
- No `dish_labels` table. Four fixed labels → `text[]` with a CHECK.
- No announcement history table. The design states there is no archive, one at a time.
- **No weekly-special history table**, even with "Kopiér sidste uge". The button copies the row that
  is currently live, which is last week's content until the moment the new week is published. See §6.
- No `publish_queue` table. Pending changes are derived from `draft is not null`, `news.status`, and `overrides.status` **or `overrides.draft is not null`** (§0j) via a `pending_changes` view.
- **No `scheduled_publishes` table and no job runner.** Every future-dated behaviour is a read-time filter.
- **No sold-out reset job and no `sold_out_expires_at` column.** Storing a computed instant would go
  stale the moment the opening hours or an override changed. The reset is derived on read from
  `sold_out_on` plus the same hours engine the rest of the site already uses.
- **No per-override "this one generated an announcement" flag.** `announcement_created` was §4's
  column for it and is **dropped** (§0n): ownership is one pointer on the announcement row,
  `source_override_id`, and "does this override own the current message?" is a join rather than a
  stored boolean two statements have to keep in step.

### Document shapes (validated by Zod, typed in TS)

`pages`:

- **home** — `hero {heading, intro, image_id}`, `award {title, text, image_id}`, `featured_dish_ids [3]`, `about_excerpt {heading, text, image_id}` — *`heading` on the excerpt is 1g's own (§0z reading A); every section key is required, `null` allowed (§0z).*
- **takeaway** — `heading`, `intro`, `image_id`, `sections [{id, heading, body, sort}]`, `cta_label`
- **about** — `heading`, `story_blocks []`, `venue_image_id`, `team {text, image_id}`, `method {heading, text, image_id}` — *the two sections are strict and whole (§0am reading B); `award_image_id`, listed here until phase 14B1, was deliberately not added: the award photograph is the Forside document's one fact (§0am reading A).*

`dishes.details` — `null` for ordinary dishes; for Tapas (decision 3):

```jsonc
{
  "kind": "tapas",
  "groups": [
    { "id": "base",     "heading": "Fast indhold",      "mode": "fixed",  "items": ["…", "…"] },
    { "id": "choose7",  "heading": "Vælg 7",            "mode": "choose", "choose": 7, "items": [] },
    { "id": "dressing", "heading": "Vælg 3 dressinger", "mode": "choose", "choose": 3, "items": [] }
  ]
}
```

Group ids and the group count are fixed by the schema; only `heading` and `items` are editable, and
items are plain strings — add, edit, remove, reorder. This is a content list, **not** an ordering
configurator: nothing is selectable by a visitor, nothing is priced per item, and no per-guest state
exists. The public page renders the three lists exactly as the approved design draws them. Because
`details` is a column on `dishes`, the normal draft overlay and Kladde badge apply with no extra work.

`news.body` is stored as **structured JSON** (paragraph nodes with `bold` and `link` marks), not
HTML. The editor offers exactly B and Link, as designed. There is no HTML sanitizer to get wrong,
and none is added for the detail page (decision 5).

### Database-enforced invariants

- **At least one effective owner** (decision 11). A constraint trigger on `profiles` rejects any
  `UPDATE`/`DELETE` that would leave zero rows with `role='owner' AND disabled_at IS NULL`. It is a
  database rule, not only a Server Action check, so no code path can produce an ownerless system.
  More than one owner is permitted — that is how a handover happens without a gap.
- `sold_out_on` is a `date`, not a timestamp, and is always written as the **Copenhagen-local**
  calendar date. A CHECK keeps it within ±1 day of `now()` in Copenhagen to catch timezone slips.
- `news.slug` is unique and immutable once `published_at` is first set (trigger).
- `monthly_burger` requires `starts_on <= ends_on` when both are set.
- **`announcement.source` and `announcement.source_override_id` are paired in both directions**
  (`announcement_source_owner_check`): a generated announcement names exactly one override, a manual
  one names none. The foreign key is `on delete restrict`, so an override that owns the live message
  cannot be deleted out from under it (§0n, §7e item 6).

---

## 5. Authentication and permissions

**Authentication.** Supabase Auth, email + password only. Public signup disabled at the project level; accounts are created by the owner. Sessions are httpOnly, secure, SameSite=Lax cookies via `@supabase/ssr`. Sign-in, sign-out and password reset all run through Server Actions — the browser never holds a Supabase client or a token in JS.

Route protection is two-layer:

1. `proxy.ts` (Next.js 16's name for `middleware.ts`) refreshes the session and redirects unauthenticated `/admin/*` to `/admin/login`. This is **routing convenience, not authorization.**
2. `requireStaff()` / `requireOwner()` run inside every admin page and every Server Action. These are the real gate. A hidden button is never a permission.

This split is also why the known Next.js middleware authorization-bypass advisory class cannot break
this system: nothing is authorized in middleware. That is a design property, not luck — and it is
still verified against the chosen version at implementation time (§14).

### Role/permission matrix — confirmed (decision 1)

| Capability | Staff | Owner |
|---|---|---|
| Dishes: create, edit, delete, reorder, prices, labels | yes | yes |
| Dish photos, and all image upload / replace / delete | yes | yes |
| Tilgængelig / Udsolgt (immediate, 10 s Fortryd) | yes | yes |
| Tapas lists (base contents, choose-7, choose-3 dressings) | yes | yes |
| Ugens ret, incl. "Kopiér sidste uge" | yes | yes |
| Lørdagsmenu | yes | yes |
| Månedens burger (draft, publish, date window) | yes | yes |
| Nyheder: write, publish, unpublish | yes | yes |
| Announcement (besked): create, edit, publish, remove | yes | yes |
| One-off opening-hour overrides ("Ret kun i dag") | yes | yes |
| Mad ud af huset page (incl. its visibility toggle) | yes | yes |
| **Normal weekly opening hours** | no | yes |
| **Site contact information** | no | yes |
| **Forsiden (hero, award, featured dishes, about excerpt)** | no | yes |
| **User accounts (create, change role, deactivate)** | no | yes |
| Audit log | no | yes |

Rationale: everything a person does mid-shift stays with Staff; the four things that define the
business permanently sit with Owner. The design shows a single dashboard, so Owner-only tiles are
simply absent for Staff rather than shown-and-disabled — no new screens are required beyond a user
list, which the approved design does not contain and which is therefore built in the approved visual
language rather than designed anew.

Enforcement is **server-side plus RLS**, as required: every Server Action calls
`requireStaff()`/`requireOwner()` first, and RLS re-checks the same rule through two `SECURITY
DEFINER` helpers, `public.is_staff()` and `public.is_owner()`, reading `profiles` by `auth.uid()`.
pgTAP asserts every row of this table from both a `staff` and an `owner` JWT (§9).

### Column write ownership — `public.announcement` (the 8C-1 hardening pass)

The matrix above says *who* may act. This says *through what*, for the one table where the
difference has teeth: `restore_announcement()` treats `announcement.previous` as the
server's own record of what to put back, so a caller able to write that column could
publish content that none of the validating paths ever saw.

A future reader should be able to answer "may I write this column directly?" without
reading a grant. The answer is below, and `supabase/tests/016_announcement_write_guard.test.sql`
asserts every row of it from real Staff and Owner JWTs.

| Column | Written by | Directly writable? |
|---|---|---|
| `draft` | `saveEntityDraft()` — the editors, and nothing else | **Yes.** This is the one column a PostgREST UPDATE owns. |
| `message`, `link_type`, `link_page`, `link_url`, `link_label`, `expires_at` | `publish_announcement()`, `replace_announcement()`, `restore_announcement()` | No. |
| `is_visible` | those three, plus `set_announcement_visible()` — the only one that may move it alone | No. |
| `source` | `replace_announcement()` (closed vocabulary), `restore_announcement()` (puts back what was stored) | No. |
| `source_override_id` | the same two, in the same statement as `source` — they are one fact in two columns (§0n) | No — by anybody, ever. |
| `previous`, `replaced_at` | `replace_announcement()` writes them; `restore_announcement()` clears them | No — by anybody, ever. |
| `id`, `is_singleton`, `created_at` | nothing | No: not in the grant. |
| `updated_at`, `updated_by` | the `announcement_touch` trigger, from `now()` and `auth.uid()` | No: not in the grant. A BEFORE trigger's assignment to `NEW` is not privilege-checked, so the stamp is unaffected — and the concurrency token and the actor stop being a caller's to choose. |

**Two mechanisms, because one of them cannot reach.** `id`, `is_singleton`,
`created_at`, `updated_at` and `updated_by` are simply out of the grant:
`20260831160000_announcement_column_privileges.sql` replaces the table-level
`grant update` with a column list of eleven, and `20260831180000` adds a twelfth,
`source_override_id`. The other eleven **must** stay in that list, and this is the
constraint the pass had to work around rather than wish away:

> A SECURITY INVOKER function runs with the privileges of whoever called it. PostgreSQL
> has no per-function table privilege and no way to run a body with the function's rights
> while keeping the caller's identity — SECURITY DEFINER changes both or neither. So
> every column `publish_announcement()`, `set_announcement_visible()`,
> `replace_announcement()` and `restore_announcement()` writes is necessarily a column
> `authenticated` holds UPDATE on.

Measured, not assumed: with the grant narrowed to `(draft)` alone, a direct write to
`previous` is refused with `42501` — and so are all four lifecycle functions, called from
a real Staff JWT. Making them SECURITY DEFINER would buy the column restriction by taking
the entire lifecycle out from under RLS, discarding the second of this section's two
independent enforcement points. That is not a trade this architecture makes.

So the remaining ten columns are owned by a rule rather than by a privilege: a BEFORE
UPDATE trigger, `public.tg_guard_announcement_write()`, itself SECURITY INVOKER. Each
lifecycle function declares its transition in a transaction-local setting immediately
before its own UPDATE; the trigger reads that, consumes it, and refuses any column
movement the declared transition does not own. A write that declares nothing — a direct
PostgREST or GraphQL UPDATE — owns `draft` and nothing else.

The declaration is not a back door, and it is four facts rather than one: `set_config()`
is in `pg_catalog`, which PostgREST does not expose; a PostgREST request is one
transaction containing one operation; the marker is single-use and cleared again by the
function that set it; and `authenticated` is a member of no other role and holds no
CREATE on `public`, so it can neither `set role service_role` nor define a function of
its own. The trigger steps aside only for roles that are not `anon` or `authenticated` —
migrations, `supabase/seed.sql` and the pgTAP fixtures, none of which is a browser
session.

**The rest of §5 is unchanged.** Both Staff and Owner may do everything the announcement
row of the matrix says; they do it through the four functions, which is what they already
did. RLS still decides the row, `requireStaff()` still decides the request, and no
function became SECURITY DEFINER.

The four other singleton tables carry the same table-level grant and are deliberately
left alone: none of them yet has a column one trusted function is the sole author of and
a second trusted function then believes.

### Accounts (decision 11)

- The system supports **one Owner at minimum and any number of Staff**. The final staff count is not
  needed before implementation — accounts are data, not schema.
- **No real accounts are created now.** Local and staging seed `owner@example.test` and
  `staff@example.test` with throwaway passwords.
- **Bootstrap at launch — revised in phase 14A (§0al):** the first production owner is created
  once, by the developer, with `scripts/launch/bootstrap-owner.mjs` (`npm run
  launch:bootstrap-owner`), through the **same invitation the administration uses for every
  later account** (phase 11C): `auth.admin.inviteUserByEmail` sends the Danish invitation and
  the Owner chooses their own password from its link; one INSERT then creates the Owner profile
  behind the identity. *Revision 2 said "sets a random password and immediately triggers the
  reset email"; that wording is withdrawn* — no password is generated, printed, sent or known to
  anyone but the Owner. The command runs from a terminal against a confirmed hosted project only,
  refuses to run if any Owner profile exists (active or disabled), never changes a role, and
  repairs its own partial states (an invitation whose profile write failed) by being run again.
- **Invite:** the owner adds a user (name, email, role) → a Server Action uses
  `auth.admin.inviteUserByEmail` — the identity and its invitation e-mail in one operation
  (phase 11C, §0ab reading A; §15 had said `createUser` plus a separate e-mail) — then
  `create_account_profile()` → the person sets their own password from the link.
- **Deactivate, never delete:** `set_account_active()` sets `disabled_at` and removes the person's
  Auth sessions in the same transaction; the Server Action then bans the identity. The person is
  refused on their next request everywhere, cannot sign in again, and `audit_log` attribution
  survives. **Reactivate** clears `disabled_at` and lifts the ban; the role is kept (§0ab).
- **Change a role:** `set_account_role()` — both directions confirmed on screen, the last active
  owner refused under a lock in the database (§0ab).
- The permanent Owner account belongs to the restaurant. `docs/runbooks/owner-handover.md` records
  the handover steps and the recovery path.

---

## 6. Publishing model

**Normal path — Kladde → Forhåndsvis → Offentliggør (design 1aa):**

1. Editing writes to `draft` (autosaved for the news editor, as designed — *the autosave is phase 9B; and news has no `draft` column at all: its edits write the row while `status` decides visibility, see §4 and §0q*). Live columns are untouched, so the public site is byte-identical to before.
2. Forhåndsvis calls an authenticated route that enables Next.js **Draft Mode** and opens the real public URL — including `/nyheder/[slug]` for an unpublished article. In draft mode the content loaders merge `draft` over the live columns and caching is bypassed. The "Forhåndsvisning — ikke live endnu" bar renders from the draft-mode flag. There are no public preview links; preview requires a staff session.
3. Offentliggør opens the confirmation showing what will go live, then in one transaction merges `draft` into the columns, nulls `draft`, writes an `audit_log` row, and calls `revalidateTag()` for the affected pages. The green toast with Fortryd follows.

Scope: section screens publish their own scope; the dashboard's "Offentliggør ændringer" publishes everything currently pending and lists it in the confirmation, per item, with who last edited it and a checkbox to leave someone else's work out. News publishes per item, as designed.

**Publishing is always an explicit human action.** Nothing in this system publishes itself. A draft
prepared weeks ahead — a Månedens burger for next month, an Ugens ret copied forward — stays a draft
until a person presses Offentliggør. What *is* automatic is only whether an already-published item is
currently *shown*, which is a read-time filter on dates the staff themselves entered (§7a).

**Immediate path — bypasses all of the above:**

| Action | Mechanism | Undo |
|---|---|---|
| Tilgængelig / Udsolgt on a dish, Ugens ret, Lørdagsmenu, Månedens burger | writes `sold_out_on` (today's Copenhagen date, or `NULL`) directly + `revalidateTag('menu')` | 10 s Fortryd = a second write back to the previous value |
| "Vis besked" off / "Fjern beskeden nu" | writes `is_visible=false` + revalidate | 10 s Fortryd |
| Replace an existing announcement | writes new values, stashes the old in `previous jsonb` | 10 s Fortryd restores from `previous` |
| Delete a dish | soft delete (`deleted_at`) | 10 s Fortryd clears `deleted_at`. **The row is never purged** — see §0a D2 |

*The two announcement rows above belong to two different phases.* **`"Vis besked" off /
"Fjern beskeden nu"` is built — phase 7B (§0g)**: `set_announcement_visible()` writes
`is_visible` and its audit row in one transaction, the Server Action expires the
`announcement` tag only after it commits, and Fortryd is a second call to the same
function. **Replacing an existing announcement — the `previous jsonb` stash and the restore
that reads it — is phase 8C-1 (§0k), and is built**: `replace_announcement()` snapshots the
current published state into `previous`, writes the replacement, stamps `replaced_at` and
audits it in one transaction, and `restore_announcement()` reads that snapshot back and
clears both columns. **The mechanism has no control in the administration** — 1ae's conflict
sheet is 8C-3B and the generated opening-hours message it exists for is 8C-2 — and nothing in
phase 7, 8A or 8B reads or writes `previous` or `replaced_at`. **8C-3A** adds the operation
that calls it for a generated message, `apply_generated_announcement()`, which decides §7e
item 8's conflict server-side and delegates the write; it is reachable from a Server Action
and from no screen (§0n). Note also that
this table describes the **immediate** operations, and the announcement's is a **switch**,
so it has two directions: off, and back on. *Content* still reaches the hjemmeside only
through Offentliggør, and `publish_announcement()` sets `is_visible` as part of that (§0f).
Switching the bar **on** re-shows the *same, unchanged, already published* announcement —
Fortryd does it inside the ten seconds, and the switch itself does it afterwards (§0h) —
and it publishes nothing, because the write names one column and `draft` is not it. It is
refused outright if the message has expired or is blank (§0g reading C, §0h).*

Undo is not server-held state. The change is already live; undo is simply a second authorized write. If the browser navigates away inside the 10 seconds the undo is lost — acceptable, and recoverable from `audit_log`.

### "Kopiér sidste uge" — Ugens ret (decision 4)

A Server Action, `copyPreviousWeekToDraft()`:

1. `requireStaff()`.
2. Reads the **currently live** `weekly_special` row. Until the new week is published, that row *is*
   last week — which is why no history table is needed and why revision 1's "no weekly-special
   history" rule stands unchanged.
3. Writes a `draft` containing `name`, `description`, `price_small_ore`, `price_large_ore`,
   `image_id`, `days` and all `sat_*` fields, with `iso_year`/`iso_week` advanced to the next ISO
   week and both sold-out fields cleared. The image is referenced, not duplicated.
4. Writes an `audit_log` row and returns. **It never touches a live column and never publishes.**

The staff member then edits the copied draft, presses Forhåndsvis, and publishes normally — the
ordinary three-step flow, unchanged.

Guards: if a draft already exists the action asks for confirmation first ("Dette overskriver din
nuværende kladde"). If the live row is empty the button is disabled with an explanation rather than
producing a blank draft.

One honest limitation, recorded so it is not a surprise later: "sidste uge" means *what is live right
now*. Once week N+1 is published, week N is gone — there is no archive, by design (§4).

**Caching in one sentence:** public pages are statically generated and tagged; publishing (or an immediate change) revalidates the affected tags so the site updates within a request; a 5-minute background revalidation acts as a safety net so time-based things correct themselves without anyone pressing anything.

Tags: `menu`, `weekly`, `monthly`, `news`, `announcement`, `hours`, `contact`, `page:home`, `page:takeaway`, `page:about`.

---

## 7. Time-sensitive behaviour

### 7a. The five mechanisms, in one place

Nothing below uses a cron service, a queue, a scheduled function, or an always-running process.

| Behaviour | Source of truth | How "now" is applied | Worst-case visible lag | Fallback with JS disabled |
|---|---|---|---|---|
| **Åbent nu / Lukket** | `opening_hours` + published future overrides | Server renders the correct badge; a ~1 KB client component recomputes every 60 s from a server-supplied schedule | 60 s | Server-rendered value, ≤5 min old |
| **Udsolgt i dag reset** | `sold_out_on date` | Pure function resolves it against the hours engine on every read | ≤5 min after opening | Same — it is server-rendered |
| **Announcement expiry** | `announcement.expires_at` | Server filters `expires_at > now()`; a tiny client guard removes it at the exact instant | 0 s with JS; ≤5 min without | Server-rendered, ≤5 min stale |
| **Ugens ret** | manual publish only | none — the week fields are labels, not gates | n/a | n/a |
| **Månedens burger window** | `starts_on` / `ends_on` | Read-time date comparison in Copenhagen | ≤5 min after local midnight | Same |

All times are Europe/Copenhagen. Timestamps are stored `timestamptz`; wall-clock comparisons go
through `Intl.DateTimeFormat` with `timeZone: 'Europe/Copenhagen'`. A `time` column is never compared
to a UTC timestamp.

### 7b. Udsolgt i dag — automatic reset (decision 2)

**Rule.** An item marked "Udsolgt i dag" becomes available again at the **opening instant of the
first opening day strictly after the Copenhagen-local date on which it was marked**. Closed days are
skipped. Published one-off overrides are honoured in both directions: an override that closes a day
skips it; an override that opens a normally-closed day makes it the reset day.

**Worked examples**, against the confirmed hours (Mon/Tue closed, Wed–Fri 15:00–20:00, Sat–Sun 17:00–20:00):

| Marked sold out | Reset at |
|---|---|
| Wednesday 18:00 | Thursday 15:00 |
| Wednesday 11:00 (before opening) | Thursday 15:00 — *not* today at 15:00 |
| Friday 19:50 | Saturday 17:00 |
| **Sunday, any time** (Mon + Tue closed) | **Wednesday 15:00** — the owner's example |
| Monday (a closed day) | Wednesday 15:00 |
| Friday, with a published override closing Saturday | Sunday 17:00 |

Note the second row. The rule keys off the *date it was marked*, not "the next opening moment". That
is what keeps "Udsolgt **i dag**" true for the whole of today even when the toggle is flipped during
prep, before the doors open.

**Implementation.** `lib/menu/availability.ts`, a pure function beside the hours engine:

```ts
resolveSoldOut(soldOutOn: DateOnly | null, schedule: Schedule, overrides: Override[], now: Date):
  { soldOut: boolean; clearsAt: Date | null }
```

- `soldOutOn === null` → available.
- Otherwise scan forward from `soldOutOn + 1 day` for the first open day (cap: **60 days**), take its
  opening instant in Copenhagen, and compare to `now`.
- If no open day is found inside 60 days — the whole schedule is closed, or a very long holiday
  override — return `clearsAt: null` and keep the item sold out. The admin then reads
  "Nulstilles ikke automatisk — I har ingen åbningsdage planlagt", so the situation is visible rather
  than mysterious. This is the only path where a manual toggle-back is required.

Nothing is stored. Because the reset is derived from `sold_out_on` plus the *current* hours, an
override entered after the toggle is honoured automatically — which a stored expiry timestamp could
not do without an invalidation job.

**Admin UX** (no design change — this uses the existing helper-text slot under the toggle):
"Nulstilles automatisk, når I åbner igen — onsdag kl. 15:00", computed by the same function that
drives the public site, so the two can never disagree.

**Preserved unchanged:** the toggle still writes immediately, still bypasses draft/publish, and still
offers ~10 seconds of Fortryd (which writes the previous `sold_out_on` value back). No inventory, no
counts, no stock levels, no per-day availability schedule. One nullable date column.

### 7c. Announcements — expiry precision (correction C1)

The problem with revision 1: the public site may serve HTML up to five minutes old, so an
announcement whose `expires_at` passed four minutes ago could still be on screen. For ordinary
content five minutes is invisible. For a message that says "Vi lukker kl. 18 i dag" it is not.

**Fix — one small client component**, `AnnouncementExpiryGuard`:

- The server already knows `expires_at`. It renders the bar only when `expires_at > now()` and passes
  the timestamp down as an ISO string prop. **The server remains the primary filter.**
- On hydration the guard compares `Date.parse(expiresAt)` to `Date.now()`. Already past → the bar is
  removed immediately, before the visitor reads a stale message.
- Otherwise it sets one `setTimeout` for the remaining milliseconds (clamped to ~24 days, the
  `setTimeout` ceiling) and removes the bar when it fires.
- It re-checks on `visibilitychange` and `pageshow`, because a phone restored from bfcache after
  several hours will not fire a pending timer reliably. On mobile this is the case that actually
  matters.
- It clears its timer on unmount.

**What it explicitly does not do:** no `fetch`, no Supabase client, no realtime subscription, no
polling, no cookie, no state library. It reads one prop and calls `setTimeout`. Roughly forty lines.

**Scope discipline.** This is the *only* new client component on the public site, alongside the two
that already existed (open/closed badge, mobile menu). Every other public page stays a React Server
Component shipping no JavaScript. The public site does not become a client-rendered application.

**Accessibility.** The `aria-live="polite"` region stays mounted; only its content is removed, so a
screen reader is not interrupted by a disappearance. The bar's space is handled by the layout exactly
as it already is for the manual "Fjern beskeden nu" path, so removal reflows identically. *That path
was built in phase 7B (§0g), and the two agree by construction: a manual removal produces the same
absent region a guest gets from the seed — no element, no padding, no reserved height (1ac) — because
both go through `AnnouncementRegion` returning `null`. **Phase 7B added nothing to the guard**: no
request, no listener, no state. Server eligibility and `AnnouncementExpiryGuard` remain the authority
on expiry, and an undo that arrives after the expiry is refused rather than allowed to contradict
them (§0g reading C).*

**Accepted limitation.** The guard trusts the visitor's device clock. A device several hours off
would hide or keep the bar by that offset. The server correction still arrives within five minutes,
and the no-database-request constraint is what makes this component acceptable in the first place.

*Built in phase 7A (§0f).* It is `components/site/announcement/AnnouncementExpiryGuard.tsx`,
and the rule it applies is not its own: `isAnnouncementExpired` and
`nextExpiryCheckDelayMs` live in `lib/announcements/expiry.ts`, which **imports nothing**,
so the server's comparison and the browser's are the same function rather than two
functions that agree today. The clamp, the boundary and the "already expired at mount"
case are therefore unit-tested as arithmetic; what the component itself promises — no
request, no storage, one timer cleared before each re-arm, both listeners removed on
unmount, focus blurred rather than moved — is asserted over its source in
`tests/unit/announcements/expiry-guard-source.test.ts` and proved in a real browser, with
the request log asserted empty, in `tests/e2e/announcement.spec.ts`.

### 7d. Månedens burger (clarification C4)

- Staff may prepare it as a **draft** at any time, weeks ahead. It sits in `draft jsonb` like any
  other content and is invisible to the public.
- **Publishing is an explicit staff action.** There is no scheduled publish, no job, no service.
- Once published, `starts_on` and `ends_on` decide whether the published item is *shown*: a read-time
  comparison against today's Copenhagen date, inclusive at both ends, applied on the menu page and
  (with `show_on_homepage`) in Forsiden's **own Månedens burger section**, which is separate from
  the three featured dishes and never replaces one of them. `lib/menu/view.ts` answers both
  questions: `buildMenuView` applies the window, `selectHomepageMonthlyBurger` applies
  `show_on_homepage`. No date, availability or database logic lives in the Forside component.
- **When there is nothing to show, the section is absent.** The public site never prints "Månedens
  burger er ikke oplyst endnu" or any other placeholder for it; that sentence belongs in the
  administration, where somebody can act on it. A burger that is inside its window but sold out
  today stays on Forsiden carrying "Udsolgt i dag", with its ordering action withdrawn — the same
  §7b rule as everywhere else, not a second one.
- The window boundary therefore takes effect within ≤5 minutes of local midnight, via the same
  background revalidation. A date boundary does not need second-level precision and no guest is
  reading the menu at 00:00.
- The admin always shows the computed state, so nobody wonders why a published burger is invisible:
  *"Offentliggjort — vises fra 1. september"*, *"Vises nu — til og med 30. september"*,
  *"Udløbet den 30. september"*.
- Publishing with `ends_on` already in the past warns first ("Denne periode er allerede forbi — den
  vises ikke på hjemmesiden"). Publishing with a future `starts_on` is allowed and the confirmation
  states exactly when it will appear — that is the intended workflow.
- *Built in phase 6B; **§0d reading C** records why those two are not the same kind of thing — one is
  a question that publishes nothing until it is answered, the other is a fact the screen states after
  publishing — and that neither of them writes a date.*

### 7e. Remaining edge cases and their rules

1. **Dashboard "Offentliggør ændringer" publishes another person's unfinished draft.** The confirmation lists each pending item with who last edited it; items can be unchecked.
2. **Concurrent edits.** Optimistic concurrency on `updated_at`; on conflict show "Nogen andre har rettet dette" rather than silently overwriting.
3. **Månedens burger + Udvalgte burgere.** *Superseded — approved requirement change, 29 August 2026.* The forside has a **dedicated Månedens burger section** in addition to its three featured dishes, not instead of one of them. "Vis på forsiden" (`show_on_homepage`) governs that section alone: publishing or displaying Månedens burger never displaces a featured dish, and there is no slot arithmetic and no "pushed out" note. The section renders only when the burger has content, today is inside its window and `show_on_homepage` is true; otherwise the forside omits it entirely, with **no public placeholder text**. Design 1ah's toggle helper still reads "Optager en af de tre pladser under ‘Tre fra menuen’"; the approved frame is left as drawn, and phase 6 must ship the toggle with wording that matches this rule instead. **Built in phase 6B (§0d reading A).** The string that ships is stated once, as `MONTHLY_HOMEPAGE_HELP` in `lib/menu/monthly.ts`, and it is: **"Vises som sit eget afsnit på forsiden — den tager ikke en af de tre pladser under ‘Tre fra menuen’."** The unit suite asserts it says what it says; the E2E suite asserts the withdrawn sentence appears nowhere on the screen and that the Forside still renders exactly three featured dishes throughout.
4. **Deleting a dish that is featured on the forside.** *Corrected — see §0a D1; the "warn and then null the reference" rule stated here in revisions 1 and 2 is withdrawn.* The binding rule, as built in phase 5D:
   - **Staff may delete dishes** (§5, first row of the matrix). Owner may too.
   - **`pages.home` stays Owner-only.** A deletion writes `deleted_at` and its attribution column on `dishes` and nothing else. No statement in the deletion path names `public.pages`, and the function is SECURITY INVOKER, so a Staff caller holds no privilege over the `home` row while it runs.
   - **Deleting a featured dish warns Staff but does not rewrite the Forside document.** The confirmation says what will happen — the dish goes from the forside, the forside itself is not permanently changed — and the warning is decided by the server from the *published* Forside document, never from a flag the browser sent.
   - **The public featured-dish selector omits deleted and unresolvable dishes.** `selectFeaturedDishes()` has always dropped an id it cannot resolve, so the forside renders two valid cards rather than three, or one, or none — never a dangling id and never a placeholder.
   - **Restoring the dish makes it appear again automatically**, with no further action, as long as the Owner's reference is still in the document. That is the direct benefit of not having rewritten it.
   - **The Owner may clean a genuinely stale reference later**, in the Forsiden editor (phase 11), as an ordinary Owner draft change.

   **An image that is in use is a different question and keeps the original rule**: warn, and then null the reference — never a dangling id (design 1w already shows the image warning). Images are Staff-editable in full (§5), so nulling an image reference is a write Staff already hold; that is exactly the privilege a Forside reference does not have, which is why the two cases part company here.
5. **Ugens ret week rollover.** Changing the week number blanks the form as a draft; the live site keeps the current card, including its week number, until publish. The editor shows the live week number next to the draft one so the difference is obvious. "Kopiér sidste uge" is the shortcut past the blank form. *Built in phase 6A; **§0c reading A** records exactly which fields "the form" means and why, and that choosing the published week again undoes the rollover.*
6. **Override deleted after it generated an announcement.** Ask, and default to removing the announcement too when `source='opening_hours'` and it points at that date. *"Points at that date" is `announcement.source_override_id`, and nothing else — never the message, the weekday, the formatted date, the expiry or the link label, because the suggested wording is editable (§0m) and is therefore evidence of nothing.* **Built: the model in 8C-3A (§0n), the asking and the doing in 8C-3B (§0o).** `remove_opening_hours_override()` returns `owns_announcement` when the override owns the live message and removal was not confirmed — nothing written, no audit row — and takes both away in one transaction when it was. An override named only inside `previous` is not refused but *resolved*: the obsolete snapshot is discarded in the same transaction, the current announcement is left alone, and both halves are audited. Removing the announcement means the **empty state** — message, link and expiry cleared, `is_visible` false, `source` back to `'manual'`, `source_override_id` null — so nothing survives that could be toggled back on; `draft` is never named, so a pending manual announcement is preserved. **A direct PostgREST DELETE cannot reach any of this**: `overrides_guard_delete` refuses every deletion that did not come from the trusted function, without a SECURITY DEFINER and without revoking a privilege the function itself needs.
7. **Override in the past, or on an already-closed day.** The date must be today or later; an override on a Monday is allowed (they may open specially) — and it correctly becomes a sold-out reset day (§7b).
8. **Announcement conflict resolution must never lose the hours.** Server-authoritative: the hours override is written first and always; the announcement is only attempted afterwards; a conflict returns `{status:'conflict'}` and requires an explicit `confirmReplace: true` on the follow-up call. There is no code path where a "Behold eksisterende" choice can roll back the hours. **Built in 8C-3A (§0n)**: `apply_generated_announcement()` writes nothing about the opening hours in any branch — it issues no statement against `public.opening_hours` or `public.opening_hours_overrides` at all — so the refusal is a `return` rather than a rollback, and *"there is no code path"* is a property of the function's text rather than a promise about its behaviour. The conflict is decided from the row the server reads, through the same `announcement_replacement_kind()` phase 7's own vocabulary uses; `active` is the only public conflict, and `hidden`, `expired` and empty proceed without one. **1ae's sheet is built in 8C-3B (§0o)**: the Server Action publishes the override and expires its cache tag *before* the announcement is attempted, so the ordering is a sequence of committed steps rather than a promise about rollback, and "Behold eksisterende besked" is a link that reaches no Server Action at all.
9. **News detail page** — in scope, see §7f.
10. **Tapas** — resolved, see §4. Three editable lists, no configurator.
11. **No-JS.** The public site must fully work without JavaScript: phone links, menu, hours table, navigation, the map link, news articles. Only the open/closed badge, the mobile fullscreen menu and the announcement expiry guard degrade — each to a server-rendered value at most five minutes old. The admin may require JavaScript.
12. **Focus and motion.** The conflict sheet cannot be dismissed by clicking outside (1ae) — it must trap focus and return it on close. Toasts must not steal focus (1aa). All motion respects `prefers-reduced-motion`.
13. **DST.** Both transitions are covered by unit tests for the hours engine *and* for `resolveSoldOut` — the spring-forward day is a Sunday, which is exactly the day that produces the longest sold-out gap.

### 7f. News detail pages (decision 5)

`/nyheder/[slug]` is in scope. The "Læs mere →" actions in the approved design link to it.

- **Layout** follows the approved system (tokens, type scale, spacing from 1aa) rather than a new design: title, category, `display_date`, image, body, a back link to `/nyheder`, and the standard phone CTA already present site-wide.
- **The body stays structured JSON.** The editor keeps exactly B and Link, as designed. There is no
  rich-text HTML mode, no paste-as-HTML, no `dangerouslySetInnerHTML`, and therefore no sanitizer to
  get wrong. If a future article needs a subheading or an inline image, that is a new *node type* in
  the schema plus a renderer component — a deliberate, reviewable change, not an open HTML field.
- **Slug policy:** generated from the title with Danish transliteration (`æ→ae`, `ø→oe`, `å→aa`),
  collision-suffixed `-2`, and **frozen once the article is first published**. Editing the title
  afterwards does not change the URL. This matters because Facebook is the restaurant's only channel:
  a shared link must not rot. The admin shows the final URL under the title field.
- **Rendering:** `generateStaticParams()` over published articles; `revalidateTag('news')` on publish
  or unpublish; unknown or unpublished slug → the designed `not-found.tsx`.
- **Unpublish** removes the article from `/nyheder`, from the Forside teaser and from the sitemap, and
  makes the detail URL 404. The row is kept, so republishing restores the same URL.
- **SEO:** self-canonical, per-article Open Graph image (the article image, falling back to the
  branded logo card), and one `NewsArticle` JSON-LD block (§11).
- **Preview:** Draft Mode opens the real `/nyheder/[slug]` URL for an unpublished article, so staff
  see the finished page before it exists publicly.

### 7g. Map (decision 6, revised in phase 14B3, finalised by the 14B3 fix)

**Superseded.** Phases 3–14A built this section's original design: a licensed static
image, a placeholder that stood in for it, and a build-time guard
(`lib/site/map-launch-guard.ts`) refusing a Vercel production build while the
placeholder remained. No licensed image ever arrived (§13 item C, §15 phase 14B2's
asset mapping) and phase 14B3 replaced the whole system with a Google Maps embed
rather than continue waiting on one. The guard, the asset descriptor
(`lib/site/map-asset.ts`), `public/map/` and its `LICENSE.md` are removed —
there is nothing left to license or to check provenance for. The historical
build record below (§0al) still describes what phase 14A actually built, for the
audit trail; it is no longer what the repository does. §0ap's own first cut is
**also** superseded, by §0aq immediately below: it built a dual keyless/API-key
system that generated a `src` from the stored address, when the intent was always
to embed Google's own listing directly.

No map library. No tile provider called from this origin. No custom JavaScript. The
entire map is one `<iframe>` on a fixed `src` — Google's own generated embed link for
the restaurant's Maps listing ("Carl Nielsen Hallens Cafeteria"), copied verbatim
from Google Maps and never reconstructed from a stored address or a key:

```
<iframe src="https://www.google.com/maps/embed?pb=…" title="Kort over …" loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
```

- **Embed.** `components/site/GoogleMap.tsx` holds the `src` as a literal constant —
  Google's own "Del" → "Integrer et kort" output for the restaurant's listing. No
  Google Cloud project, no API key, ever. There is no `lib/site/map-embed.ts`: once
  the `src` stopped being derived from the address, the function that derived it had
  nothing left to compute, so it was removed with its test rather than kept as an
  abstraction over a constant.
- **CSP.** `frame-src` names `https://www.google.com` (`lib/security/headers.ts`,
  phase 14B3) — the one directive the embed needs, unchanged by the 14B3 fix; the
  iframe is a separate browsing context with Google's own policy, so
  `img-src`/`connect-src` are untouched.
- **Privacy.** The embed loads third-party Google content directly into the guest's
  browser — unlike the retired static image, which was this origin's own asset. No
  consent mechanism exists yet; a later privacy/cookie/security review should decide
  whether this needs one before the site opens publicly (docs/runbooks/launch-notes.md).
- **"Vis vej" is unchanged.** The universal directions link —
  `https://www.google.com/maps/dir/?api=1&destination=<url-encoded address>` — is a
  separate control, built the same way it always was (`directionsUrl`, `lib/site/links.ts`),
  from the stored address. It opens the native Google Maps app on Android and iOS
  when installed, and the web map otherwise: one `<a>`, no user-agent sniffing, works
  with JavaScript disabled.
- `site_contact.map_attribution` is no longer read by any component. The column
  remains (it was never editor-exposed — §1v) but the embed carries its own
  Google-drawn attribution inside the frame; nothing in this repository renders the
  field.
- The street address stays real text beside the map (it always was), so the location
  is available to search engines, screen readers and copy-paste regardless of whether
  the embed loads.

---

## 8. Security risks and how the architecture prevents them

| Risk | Prevention |
|---|---|
| Public site performs an admin write | The public half has no Supabase client, no token, and no mutation endpoint. The anon key's RLS policies grant `SELECT` on published rows only — no `INSERT`/`UPDATE`/`DELETE` policy exists for `anon` on any table. |
| Authorization by hidden UI | Every Server Action begins with `requireStaff()`/`requireOwner()`; RLS re-checks the same rule with the user's own JWT. Middleware is explicitly documented as routing only — which is also why the middleware-bypass advisory class does not apply here. |
| Service-role key reaches the browser | The key is not `NEXT_PUBLIC_`-prefixed, lives in `lib/supabase/service.ts` behind `import 'server-only'`, and has exactly four call sites: the phase-10 image storage boundary (`lib/images/storage.ts` — signed upload URLs and the derivative pipeline, §0t), the phase-11C Auth Admin boundary (`lib/accounts/auth-admin.ts` — invite, look up by e-mail, ban / unban, §0ab), migrations/seed, and the one-time owner bootstrap. `tests/unit/policy/images-boundary.test.ts` holds the runtime import graph to those two modules, and `accounts-boundary.test.ts` holds `auth.admin` to the one. |
| Drafts leak to the public | Draft Mode is enabled only by an authenticated route; the draft cookie is httpOnly and signed. Content loaders read `draft` only when draft mode is on **and** a staff session exists. |
| Malicious upload | Signed upload URL issued only after a role check; server validates magic bytes (not the declared MIME), caps size, re-encodes with sharp (which discards anything that is not an image and strips EXIF/GPS), stores under a random path. Originals go to a private bucket; only derivatives are publicly readable. |
| XSS from staff-entered content | News body is structured JSON rendered by our own components — no HTML parsing, no `dangerouslySetInnerHTML` anywhere, including the new detail page. Tapas list items and all other free text are plain strings. |
| Open redirect / injected announcement link | `link_type='page'` is an enum of our own routes; `link_type='url'` is validated as `https:` and rendered with `rel="noopener noreferrer"`. The map link is built from the stored address, never from user input. |
| CSRF | Server Actions carry Next.js's built-in origin check; `serverActions.allowedOrigins` is derived from `lib/config/site.ts`, not hard-coded. |
| Credential stuffing | Supabase Auth's own per-IP limits on its endpoints, plus — since phase 13B (§0ai) — the application throttle in the sign-in action: failures counted per client address and per account address as HMAC subjects in PostgreSQL, one attempt reserved in both atomically before the Auth server is contacted and released after a success, one sentence for every refusal, successes never counted. Password reset via a verified Resend domain, its request throttled per client. |
| **A signed-in account floods the administration** | Every Server Action declares its tier and is counted against the session's own `auth.uid()` in `rate_limit_buckets` — one atomic `INSERT … ON CONFLICT` under the row lock, no process memory, no browser-supplied subject or limit; a refusal happens before parsing and performs no mutation, writes no audit row and expires no cache tag (§0ai, migration `20260905120000`, pgTAP `029`). |
| **Framing, sniffing, injected resources** | One header policy on every response (`lib/security/headers.ts`, phase 13B): CSP with `frame-ancestors 'none'`, no foreign script origin, no `eval`, no inline style, images and the uploader's connection from this origin and the Storage origin only; `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`, a minimal `Permissions-Policy`, two-year HSTS. The one concession — `'unsafe-inline'` for the framework's inline bootstrap scripts, to keep the public pages cacheable — is recorded in §0ai with its reasoning. |
| Admin indexed by search engines | `/admin/*` returns `X-Robots-Tag: noindex, nofollow` and is disallowed in `robots.txt`. Preview deployments additionally sit behind Vercel Deployment Protection (§10). |
| Silent data loss | Every publish and every immediate change writes to `audit_log` with before/after. Soft-delete for dishes. Daily managed database backups **plus** a weekly off-platform export of database *and* storage (§10f). |
| System left with no owner | Database constraint trigger on `profiles`; the last active owner cannot be demoted, disabled or deleted — and, since phase 11C, the check runs under a transaction-level advisory lock that the account transitions take first, so two concurrent changes cannot both pass it (§0ab, pgTAP `028` through two real sessions). |
| **An account's role or state is moved outside the transitions** | `authenticated` holds no DELETE on `profiles` and UPDATE on `name`, `role`, `disabled_at` only; a BEFORE INSERT OR UPDATE guard refuses any creation or movement of `role` / `disabled_at` from `anon` or `authenticated` unless the statement-scoped marker names the transition — Owner and Staff alike — so the version check, the last-owner check and the audit row cannot be bypassed (§0ab, `20260903120000`). |
| **A trusted function is fed forged state through a direct write** | `restore_announcement()` publishes whatever `announcement.previous` holds, so a caller who could write that column could publish content none of the validating paths ever saw. The columns a lifecycle function is the sole author of are therefore not directly writable at all: `authenticated` holds a **column-level** UPDATE grant, and a BEFORE UPDATE guard trigger refuses any movement of the published, visibility, provenance and lifecycle columns that did not come from the function that owns it (§5, `20260831160000_announcement_column_privileges.sql`). The lifecycle functions stay SECURITY INVOKER, so RLS still decides the row. |
| **A published Forside image is moved outside the workflow** | The Forside document's three `image_id` paths are references too (phase 11A). A BEFORE UPDATE OF `published` guard on `pages` refuses any movement of those paths from `anon`/`authenticated` unless the statement-scoped marker names publish, replace or detach (`20260902120000`); Staff cannot reach the row at all (RLS), and a Staff member's delete or replacement of an image the Forside uses is refused as `owner_only` before any write, so no dangling id can be left in the Owner-only document. |
| **A published image reference is moved outside the workflow** | `dishes`, `weekly_special` and `monthly_burger` keep their phase-1 UPDATE grant (the SECURITY INVOKER transitions spend it), but a BEFORE INSERT/UPDATE OF `image_id` guard refuses any movement of the live column that did not come from the publish, replace or detach transition, recognised by a statement-scoped marker that an AFTER STATEMENT trigger spends — one statement, however many rows, so a global replacement stays atomic (§0w, `20260901200000_protect_published_image_references.sql`). Direct Staff **and** Owner writes are refused; `news.image_id` is deliberately unguarded (§4, phase 9). |
| **Production secrets exposed in logs** | Secrets are passed as environment variables, never as command-line arguments (which appear in process listings and some log lines). `set -x` is forbidden in workflow scripts and checked by a lint step. Backup and migration jobs run `--quiet`. Connection strings are never echoed. GitHub's secret masking is treated as a second line of defence, not the first. |
| **Vulnerable dependency shipped** | Lockfile committed, `npm ci` in CI, Dependabot security updates, `npm audit` and CodeQL in the pipeline, GitHub push protection and secret scanning enabled. Framework version chosen and advisory-checked at implementation time, not from this document (§14). |
| **Visitor tracking / consent liability** | No analytics, no pixel, no tag manager, no third-party script on the public site. Public visitors receive zero cookies, so no consent banner is required and the approved design stays intact (§12). |

---

## 9. Testing plan

**Vitest — unit (the highest-value tests, all pure functions):**

- Opening-hours engine: is-open-now across every weekday, both DST transitions, overrides (closed and custom), the moment of opening and closing, the "til kl. 20:00" label, and the footer day-grouping ("Ons–fre 15:00–20:00").
- **`resolveSoldOut`** — one test per row of the table in §7b, plus: marked before opening on an open day; both DST Sundays; an override closing the natural reset day; an override opening a normally-closed Monday; an all-days-closed schedule returning `clearsAt: null`; and the 60-day cap.
- Announcement lifecycle: expiry filtering, the "expires in the future" rule, the conflict decision table (both branches, asserting hours are saved in both), undo restoration from `previous`.
- **Announcement expiry guard** — jsdom with fake timers: already expired at hydration hides immediately; expiring in 30 s hides at 30 s; a `visibilitychange` after a simulated three-hour background hides it; unmount clears the timer; a far-future expiry does not overflow `setTimeout`.
- Publish/merge: draft overlay merges correctly, publishing clears the draft, partial drafts do not blank unrelated fields.
- **`copyPreviousWeekToDraft`** — copies every field, advances the ISO week across a year boundary, clears both sold-out fields, and leaves every live column untouched.
- Månedens burger visibility across period boundaries, inclusive at both ends, in Copenhagen local dates, **and `selectHomepageMonthlyBurger`**: shown when active and `show_on_homepage`; hidden when the toggle is off, before `starts_on`, after `ends_on`, or when nothing is configured; kept — with its sold-out state — when sold out today; and never at the cost of one of the three featured dishes. The Forside section itself is rendered with `react-dom/server` to assert it emits nothing when there is no burger.
- Tapas `details` Zod schema: fixed group ids, `choose` counts, rejection of unknown keys.
- News slug generation: Danish characters, collisions, and immutability after publish.
- Danish price and date formatting.

**Database — pgTAP against a local Supabase:**

- `anon` cannot write to any table (one assertion per table, generated).
- `anon` cannot read drafts, unpublished news, invisible/expired announcements, or `audit_log`.
- `staff` cannot write `opening_hours`, `site_contact`, `pages.home`, or `profiles` — one assertion per Owner-only row of the §5 matrix.
- `staff` **can** write every Staff row of the §5 matrix, including `dishes.details` and both `weekly_special` sold-out fields.
- `owner` can do all of it.
- The last active owner cannot be demoted, disabled or deleted — three assertions.
- Only `draft` may be written directly on `public.announcement`; the published, visibility, provenance and lifecycle columns refuse a direct write from Staff **and** from Owner, and the forged-`previous` attack on `restore_announcement()` is run end to end (`016`).
- The published `image_id` on `dishes`, `weekly_special` and `monthly_burger` refuses a direct write from Staff **and** from Owner — a change, a clearing and an INSERT with a photo alike — while publish, the multi-row `replace_image()` and a confirmed `delete_image()` still move it, no marker survives any transition, and the referential action's privilege context is measured rather than assumed (`023`).

**Playwright — E2E, the paths where a bug would be visible to a guest:**

1. Unauthenticated `/admin` redirects to login; login succeeds; logout clears the session.
2. Change a price → public menu unchanged → Forhåndsvis shows the new price → Offentliggør → public menu shows it.
3. Mark Thor as Udsolgt → public menu shows Udsolgt within a reload → Fortryd → back to Tilgængelig.
4. Create an announcement with a future expiry → bar appears; set expiry in the past → publish is disabled. Then, with a 20-second expiry and a controlled clock, assert the bar removes itself **without a reload and without any network request** (asserted against the request log).
5. Opening-hours override with "Vis også som besked" while an announcement is active → conflict sheet → "Behold eksisterende": hours saved, no new announcement → repeat with "Erstat": new announcement live, Fortryd restores the old.
6. News: draft autosaves → preview at the real slug → publish → appears on Nyheder, Forside and `/nyheder/[slug]` → unpublish → list, teaser and sitemap drop it and the detail URL 404s.
7. Image upload → appears in the library → used on a dish → delete warns.
8. Turn "Vis siden" off for Mad ud af huset → both the page and the nav item disappear.
9. Ugens ret: "Kopiér sidste uge" → the draft is populated, the public card is **unchanged** → edit → publish → the public card updates.
10. Tapas: edit an item in each of the three lists → draft → publish → all three lists render correctly on the public menu.
11. Månedens burger: publish with a future `starts_on` → not shown publicly, admin says "vises fra …" → advance the clock past `starts_on` and revalidate → shown.
12. Find os: the map embed's `src` is built from the stored address, "Vis vej" is a separate link whose `href` is a directions URL containing the address, and the page works with JavaScript disabled.

**Accessibility:**

- `@axe-core/playwright` on all six public pages **plus `/nyheder/[slug]`**, plus the dashboard, menu editor and conflict sheet, at 375 px and 1440 px.
- Keyboard-only walkthrough of the menu editor, the tapas list editor, the reorder handles and both dialogs.
- Assertions on the design's explicit promises: 44 px minimum targets, visible 3 px focus ring, the announcement region uses `aria-live="polite"` and is not re-announced on removal, status is icon + text (not colour alone), toasts do not move focus.

**Visual regression:** optional Playwright screenshot comparison for the six public pages at 375 / 768 / 1440, to catch drift from the approved design.

**CI:** typecheck → lint (including the no-hard-coded-domain and no-`set -x` checks) → unit → pgTAP → `npm audit` → CodeQL → build → Playwright against the Vercel preview deployment.

---

## 10. Environments and deployment

### 10a. The three environments

| | Development | Staging | Production |
|---|---|---|---|
| **Supabase** | local CLI (`supabase start`), Docker | **separate Free project**, `eu-central-1` | **Pro project**, `eu-central-1` |
| **Next.js host** | `next dev` | Vercel Preview Deployments (per PR) | Vercel **Pro**, `fra1` |
| **Auth email** | CLI mail catcher (Inbucket/Mailpit, `http://localhost:54324`) | Resend test sender | **Resend custom SMTP**, `noreply@<restaurant-domain>` |
| **Data** | `supabase/seed.sql` | seeded, disposable | real content |
| **Accounts** | `owner@example.test`, `staff@example.test` | same | real, created at launch |
| **Backups** | none needed | none needed | managed daily + weekly off-platform |

**Why production is not on Supabase Free** (decision 7): Free projects are paused after a period of
inactivity, and a paused project means the restaurant's admin stops working and revalidation fails.
Free also does not carry the backup guarantees this content needs. Pro gives daily managed backups,
no pausing, and PITR as an option the owner can enable later.

**Staging on Free is fine, with one caveat.** A Free project that sits idle can be paused, and CI
running against a cold staging project will fail. Mitigation: the PR pipeline itself keeps it warm
most weeks; the CI step detects a paused project and fails with an explicit "unpause staging" message
rather than an opaque connection error; and `docs/runbooks/` records the unpause step. Staging holds
no real data and is fully reconstructible from `migrations` + `seed.sql`, so losing it costs minutes.

**Why production is not on Vercel Hobby** (decision 8): this is a commercial restaurant website, and
Hobby is licensed for non-commercial use. Production runs on **Vercel Pro**. Preview and staging
deployments stay part of the ordinary PR workflow, unchanged.

One concrete consequence of Pro that must not be forgotten: **Deployment Protection** is enabled for
the Preview environment, so unlaunched builds are not publicly reachable or indexable. Playwright then
needs `VERCEL_AUTOMATION_BYPASS_SECRET` in CI to reach preview URLs. It is a small task, but it
silently breaks E2E if it is missed — so it is called out explicitly in phase 0.

### 10b. Promotion flow

Local → staging → production, one set of migration files throughout.

- **Local:** `supabase start` + `next dev`. The seed is two files since phase 14A (§0al): `supabase/seed/confirmed.sql` — the confirmed contact, hours and menu facts — then `supabase/seed/development.sql` — the placeholder pages, News and weekly state — in that order, so a fresh clone is immediately usable. Migrations in `supabase/migrations` are the only way schema changes happen.
- **PR:** CI applies migrations to **staging**, builds, and runs the full suite against the Vercel Preview Deployment. Never against production. *(Staging is planned, not provisioned; until it exists CI uses the local stack.)*
- **Merge to `main`:** CI applies migrations to the production Supabase project, then Vercel promotes the build. Production credentials live in a protected GitHub environment that pull requests cannot read. **Built in phase 14A as the migration door** — `scripts/launch/migrate.mjs`, one implementation for an operator's terminal (`npm run launch:migrate`) and for `.github/workflows/production-migrate.yml`, which is dispatch-only until phase 14C adds the `push: main` trigger once the protected `production` environment exists. The door applies migrations and **nothing else**: production never runs a seed file; the confirmed content is loaded once by `npm run launch:load-content`, and the first Owner by `npm run launch:bootstrap-owner` — three separate, explicitly confirmed commands (§0al).

### 10c. Authentication email (decision 9)

- **Production:** Resend as custom SMTP on the Supabase project. Sender `noreply@<restaurant-domain>`
  once the domain exists. Requires SPF, DKIM and (recommended) DMARC records — a **launch**
  dependency, not a development one.
- **Staging:** Resend's shared test sender, or a `staging.` subdomain. Volume is negligible.
- **Local:** the Supabase CLI's built-in mail catcher. Every reset and invite email is captured
  locally; nothing leaves the machine. Password reset is fully testable on day one with no vendor
  account and no domain.
- **Templates** (Danish "Glemt adgangskode", invite) live in `supabase/templates/` and are applied
  through `supabase/config.toml`, so they are versioned and reviewed rather than clicked into a
  dashboard and lost.
- Supabase's built-in sender is used for **nothing** outside local development — it is rate-limited
  and unsuitable for a production reset flow.

### 10d. Domain (decision 10)

The domain is deferred and is **not** a Phase 0 dependency.

- Every absolute URL resolves through one module, `lib/config/site.ts`:
  `SITE_URL ?? VERCEL_PROJECT_PRODUCTION_URL ?? VERCEL_URL ?? http://localhost:3000`.
- That single value feeds canonicals, the sitemap, `robots.txt`, Open Graph URLs, JSON-LD `url` and
  `serverActions.allowedOrigins`. Nothing else may contain a domain literal, and a CI grep enforces it
  (allow-listing only `lib/config/site.ts`, `.env.example` and this document).
- Choosing the domain later is a **configuration** change, not a code change.
  `docs/runbooks/domain-cutover.md` lists it: Vercel domain + env var; Supabase Auth Site URL and
  additional redirect URLs (so reset links point at the right host); the Resend sending domain and its
  DNS records; and a re-run of the sitemap/OG checks.

### 10e. Environment variables

| Name | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | public by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | public by design; read-only via RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | never prefixed `NEXT_PUBLIC_`; four call sites (§8: the image storage boundary, the Auth Admin boundary, migrations and seeding, the owner bootstrap) |
| `SUPABASE_DB_URL` | CI only, per environment | migrations; passed as env, never as an argument |
| `SITE_URL` | all | canonical URLs, OG, sitemap, allowed origins — the only place a domain lives |
| `SENTRY_DSN` | server only | phase 13C (§0aj): read only through `lib/env/server.ts`; **optional everywhere** — no DSN means monitoring is off and nothing fails; set for Production on Vercel, and for Preview only if preview events are wanted (they are labelled `preview`) |
| `SENTRY_RELEASE` | optional, never secret | overrides the release name; on Vercel the release is `VERCEL_GIT_COMMIT_SHA`, elsewhere without it `unversioned` (§0aj) |
| `RATE_LIMIT_SECRET` | server only | keys the sign-in throttle's HMAC subjects (§0ai); read only through `lib/env/server.ts`; **required on Vercel** (a deployment without it refuses the sign-in and reset forms), at least 32 characters; a fixed development key stands in locally |
| `RESEND_API_KEY`, `AUTH_EMAIL_FROM` | Supabase project settings | password reset and invites |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | CI only | Playwright against protected previews |
| `BACKUP_S3_*` (endpoint, bucket, region, prefix, key pair) | GitHub `backup` environment only | the weekly export's destination (§10f, §0ah); `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` live there too, for the job |
| `BACKUP_RESTORE_CONFIRM_HOST` | an operator's shell, for one restore | the exact database host a remote restore may touch (§0ah); never in CI |
| `MIGRATE_CONFIRM_HOST` | an operator's shell, or the protected GitHub `production` environment (phase 14C) | the production project's host (`<ref>.supabase.co`) the migration door may touch (§0al); the door refuses the local stack and any other project |
| `CONTENT_LOAD_CONFIRM_HOST` | an operator's shell, once | the project host the one-time confirmed-content load may touch (§0al); never in CI |
| `BOOTSTRAP_CONFIRM_HOST` | an operator's shell, once | the project host the one-time Owner bootstrap may touch (§0al); never in CI |

Secrets live in Vercel, Supabase project settings and protected GitHub environments. Nothing is committed. `.env.example` documents the names only.

### 10f. Backup model (correction C2)

There are two layers, and they protect against different failures.

**Layer 1 — managed, on-platform.** Supabase Pro daily database backups, with PITR available as an
owner decision. This covers "we broke the data" and "a table was dropped". It does **not** cover
Supabase Storage, and it does not cover losing access to the Supabase account itself.

**Layer 2 — weekly, off-platform.** A scheduled **GitHub Actions** workflow
(`.github/workflows/backup.yml`), `schedule: cron`, once a week. No cron hosting service and no
always-running server — GitHub already runs CI for this repository.

It does two things and then stops:

1. `supabase db dump` of the production database (schema + data) — an off-platform copy of the data,
   independent of Supabase's own retention.
2. An incremental sync of **both Storage buckets** — `media` (public derivatives) and
   `media-originals` (the private masters, the half that cannot be regenerated; §0t) —
   via Supabase Storage's S3-compatible endpoint
   with `aws s3 sync` (incremental, resumable, one tool). `supabase storage cp -r` is the fallback if
   S3 credentials are not wanted.

**The destination must not be Supabase.** Revision 1 said "syncs to a separate private bucket" on the
same project — that is not a backup, because it shares the failure domain it is meant to survive. The
destination is an external private object store in the EU with versioning enabled; Cloudflare R2 or
Backblaze B2 both fit, and neither is a cron service or a server. A zero-new-vendor interim, valid
while the media set is small, is an encrypted archive pushed to a separate private GitHub repository
as a release asset — subject to the 2 GB per-asset limit, so it is an interim, not the plan. **This
destination is the one small sub-decision still open** (§13).

**Retention:** eight weekly snapshots plus one monthly kept for six months, via a lifecycle rule at
the destination — not by a script deleting things.

**Credentials.** `SUPABASE_STORAGE_S3_ACCESS_KEY_ID`/`_SECRET`, `BACKUP_S3_*` and the production
`SUPABASE_DB_URL` are GitHub Actions secrets scoped to a **protected `backup` environment**, so no
pull request — and no fork — can read them. `docs/runbooks/backups.md` records exactly where each
credential lives, who can rotate it, and how.

**Log hygiene is part of the design, not an afterthought.** Secrets are passed as environment
variables, never as command-line arguments; `set -x` is forbidden and CI-checked; sync runs
`--quiet`; connection strings are never echoed; GitHub's secret masking is the second line of
defence, not the first.

**Failure is loud.** A failed run notifies the repository owner. Silent failure is the normal way
backups turn out not to exist.

**Built in phase 13A (§0ah, 2026-09-05)** — `scripts/backup/`, `.github/workflows/backup.yml`,
the drill `npm run backup:drill`, and `docs/runbooks/backups.md` / `restore.md`. Three departures
from the paragraphs above, each recorded there: the tools are `pg_dump`/`psql` called directly
with the connection in the environment (the CLI's `db dump --db-url` would put it on a command
line); Storage is copied whole through the Storage API with the service role (the fallback named
above — a runner has no mirror to sync against); and the destination is any S3-compatible private
bucket, with retention as two lifecycle rules by tier prefix. The provider itself (§13 item A) is
still the one open decision. `audit_log` remains the content-level recovery story for
"someone published the wrong thing".

### 10g. Monitoring and error handling

Sentry on the server (Server Actions, route handlers, RSC) with releases tied to the deployment. No browser SDK, no session replay. Vercel log drains retained. `error.tsx` and `not-found.tsx` in both route groups, in the approved visual language. Admin errors surface as the designed inline error state ("Billedet kunne ikke uploades. Prøv igen." with a retry), never as a stack trace. An uptime ping on `/` and `/find-os`.

**Built in phase 13C (§0aj):** `instrumentation.ts` initialises the SDK's server half once per process and hands the framework's `onRequestError` hook to `lib/monitoring/request-error.ts`; the proxy reports through the same door because the Node-runtime proxy of this framework version never reaches the hook; five server modules send a closed list of operational events through `lib/monitoring/report.ts`; one sanitizer (`lib/monitoring/sanitize.ts`) is `beforeSend` and `beforeBreadcrumb`. Errors only — no tracing, no profiling, no user identity, no source-map upload in v1. `docs/runbooks/monitoring.md` is the operator's document. The uptime ping and the log drain remain provider configuration for launch.

**Closed by phase 13's lock pass (§0ak):** `error.tsx` in both route groups (`app/(site)/error.tsx`, `app/(admin)/admin/error.tsx`) and `not-found.tsx` in both (`app/(site)/not-found.tsx` since phase 3; `app/(admin)/admin/not-found.tsx` with its own catch-all), each in the existing visual language — one Danish sentence, a retry and a way back, no message and no stack. An unexpected render error answers 500 with the site's or the administration's own page instead of the framework's English default; the framework hook still reports it once per failing request. The inline error states of the administration's actions were already the closed reply vocabularies of phases 5–12.

---

## 11. SEO

- **Titles/descriptions** per route via `generateMetadata`, in Danish, `<html lang="da">`. Pattern: `Menu — Klingenberg Food, Carl Nielsen Hallen`.
- **Canonical URLs** absolute from `lib/config/site.ts` on every page; `/nyheder/[slug]` canonical to itself.
- **`app/sitemap.ts`** — the six static pages plus published news detail URLs, with `lastModified` from `updated_at`. Unpublishing removes the entry.
- **`app/robots.ts`** — allow all, disallow `/admin` and `/api`; sitemap reference.
- **Open Graph / Twitter** — per-page OG image: the hero photo for Forside, the article image for a news item, and a branded logo card as fallback. `og:locale = da_DK`.
- **Structured data** — generated from published database values so it can never drift from the page:
  - One `Restaurant` block on Forside and Find os: `name`, `alternateName` ("Carl Nielsen Caféen"), `address` (Lumbyvej 62, 5792 Nørre Lyndelse, DK), `telephone` (+4563908300), `sameAs` (Facebook), `hasMenu` (/menu), `servesCuisine` "Burger", `award` (Danmarks Bedste Burger 2026 — vinder Fyn & Øer, nr. 4 i Danmark).
  - `openingHoursSpecification` generated from `opening_hours`, with `specialOpeningHoursSpecification` for published future overrides — so a one-off closure is machine-readable too.
  - One `NewsArticle` block on each `/nyheder/[slug]`: `headline`, `datePublished` (`display_date`), `dateModified`, `image`, `publisher`. Nothing invented.
  - **Omitted until supplied:** `geo`, `priceRange`, `email`, `image` (until real photos land), `aggregateRating`.
- **Practical wins that matter more than markup here:** the phone number as a `tel:` link on every page, the address as real text (not baked into the map image), the hours as a real table, and news articles at stable URLs that survive a title edit.
- **Third-party map content:** the Find os and Forside map is Google's own official `<iframe>` embed for the restaurant's Maps listing, a fixed link never built from visitor input or from the stored address (§7g, phase 14B3, §0aq). It is the one piece of third-party content the public site loads directly into the guest's browser; a later privacy/cookie review should decide whether that needs disclosure or consent (docs/runbooks/launch-notes.md).

---

## 12. Analytics and privacy (decision 12)

**No analytics in v1.** Specifically excluded: Google Analytics, Meta Pixel, Google Tag Manager or any
tag manager, tracking cookies, heatmap or session-recording tools, and **Vercel Web Analytics and
Speed Insights** — both inject a script and both are analytics, notwithstanding that Pro includes
them.

The consequence is worth stating plainly, because it is a benefit rather than an omission: the public
site sets **no cookies at all**. The only cookies in the system are the httpOnly admin session and the
Next.js draft-mode cookie, both strictly necessary and both scoped to `/admin`. A visitor to
Klingenberg Food's website is given nothing to consent to. **No consent banner is required** — which
is just as well, because the approved design does not contain one and would need reworking to carry
one.

Server-side Sentry stays. It records server errors, runs nowhere near a visitor's browser, and
collects no visitor behaviour — built in phase 13C exactly so (§0aj): no monitoring script,
request or cookie on any page, proven against the production build by
`tests/e2e/monitoring.spec.ts`. Vercel's request logs are operational, not analytical.

If analytics is reconsidered later, the question is not only "which tool" but whether the chosen tool
requires a consent banner — because that would be a **design** change, not a configuration one.

---

## 13. Decisions — status

**Closed (revision 2).** Role split · Udsolgt auto-clear · Tapas editability · "Kopiér sidste uge" ·
News detail pages · Static map · Supabase plans · Vercel plan · Auth email provider · Domain deferral ·
Account model · Analytics · Announcement expiry precision · Storage backup · Dependency version
policy · Månedens burger scheduling.

**Still open — none of these blocks Phase 0:**

| # | Item | Needed by | Default if unanswered |
|---|---|---|---|
| A | **Off-platform backup destination** — Cloudflare R2 or Backblaze B2; the tooling is provider-neutral and the manual setup is in `docs/runbooks/backups.md` §3 (§0ah). The interim private-GitHub-repo archive is withdrawn: the workflow exists and needs a bucket, not a workaround. Phase 13's lock pass (§0ak) kept the decision open on purpose and made it rows B1–B7 of `docs/runbooks/pre-launch-checklist.md` — the repository *supports* an S3-compatible destination; nothing in it *chooses* one | before launch — until it is chosen, no off-platform copy exists | Recommend R2 (EU jurisdiction, private; note it has no object versioning, which the design does not need) |
| B | **PITR on Supabase Pro** — an extra cost on top of daily backups | before launch | Off. Daily backups plus a weekly off-platform export is proportionate for this content volume |
| C | **Final map asset and its licence** — the build check exists since phase 14A (§0al): a Vercel production build (`VERCEL_ENV=production`) is refused while `public/map/LICENSE.md` records `placeholder` or the descriptor still renders the placeholder file; local, CI and preview builds pass. The asset and its licence arrive in 14B | before launch | Placeholder until supplied; a build check prevents it shipping |
| D | **Domain, DNS control, and the Resend sending domain** | before launch (DNS verification takes time) | — |
| E | **Structured-data gaps** — `priceRange`, coordinates, a public email | before launch | Left out rather than invented |
| F | **Who owns the Vercel, Supabase and GitHub accounts**, and who pays | phase 0 (administrative) | Developer-owned during build, transferred at handover per `owner-handover.md` |
| G | **Retention for soft-deleted dishes** — whether a deleted row is ever removed, after how long, and who decides (§0a D2) | not before launch | **Keep indefinitely.** Nothing purges today, and nothing should start purging as a side effect of another phase. A retention feature is its own design, with its own audit and its own consequences for `audit_log` attribution |
| ~~H~~ | **Closed, 2026-08-30.** The phase-4 dashboard's two standalone links — "Åbn menuen" and "Åbn indhold" — were measured at 16 px and given the same `min-h-tap` inline-flex treatment `AdminSectionBar`'s `BarLink` uses, so the words keep their size, colour and underline and only the target grows. "Ejer-området" is left alone: it is inside a sentence and exempt under WCAG 2.2's target-size criterion. `tests/a11y/admin-pages.spec.ts` carries the assertion that failed first, and it now covers the phase-7A "Åbn beskeden" link too. | — | — |

---

## 14. Dependency and version policy (correction C3)

**Do not pin framework versions from this planning document.** The versions current when this plan was
written will not be the versions that are correct when implementation starts, and a security release
may land in between.

At the start of Phase 0:

1. Take the **currently patched stable Next.js release**, via `create-next-app@latest`, plus current
   stable React, TypeScript, Tailwind v4 and the Supabase libraries.
2. **Check active advisories before locking anything** — the GitHub Advisory Database, `npm audit`,
   and the framework's own security releases. Note specifically the Next.js middleware
   authorization-bypass advisory class: this architecture is not vulnerable to it by design (§5), but
   that must be *verified against the chosen version*, not assumed.
3. Record the chosen versions and the date of the advisory check in the repository, not here.

Ongoing:

- **Commit the lockfile.** `npm ci` in CI — never a resolving install.
- **Dependabot** (or Renovate): security updates immediately, grouped non-security updates weekly,
  majors never auto-merged.
- **`npm audit --audit-level=high`** in CI. **CodeQL** for JavaScript/TypeScript. GitHub secret
  scanning and push protection enabled on the repository.
- Pin the Node version (`.nvmrc` + `engines`), and pin GitHub Actions by commit SHA rather than by tag
  — a moving tag is a supply-chain hole in a workflow that holds production backup credentials.
- Keep the dependency surface deliberately small (§1, Adjustment 4). Fewer dependencies is itself a
  security measure: every library not added is an advisory never triaged.

---

## 15. Recommended implementation phases

Each phase ends in something deployable and testable. No phase begins until the previous is merged.

| # | Phase | Contents | Done when |
|---|---|---|---|
| 0 | Foundations | Repo + branch protection; Next.js + TS + Tailwind v4 with the 1aa tokens; **version and advisory check per §14**; `lib/config/site.ts` + the no-hard-coded-domain lint; local Supabase + seed; staging (Free) and production (Pro) projects, EU; **Vercel Pro project + Preview Deployment Protection + CI bypass secret**; CI skeleton; `.env.example` | `next build` green in CI; an empty styled shell deploys to a protected preview; Playwright can reach it |
| 1 | Schema + auth | All migrations, RLS policies, `is_staff`/`is_owner`, the owner-count trigger, seed with confirmed facts, login/logout/reset against the local mail catcher, `requireStaff`/`requireOwner`, pgTAP RLS suite incl. the §5 matrix | RLS tests pass; the seeded owner can log in; `/admin` unreachable logged out; the last owner cannot be removed |
| 2 | Time engines | Pure `lib/hours` **and `lib/menu/availability`** with full unit suites, including both DST transitions and every row of §7b. No UI. | Every unit test green |
| 3 | Public read-only site | All six pages rendered from seeded data, responsive per 1g–1o, header/footer/bottom-nav, **static map placeholder + directions link**, no announcement bar yet | Design review against 1g–1o; axe clean; Lighthouse ≥95; the page works with JS off |
| 4 | Draft/publish core | `draft` overlay, publish transaction, Draft Mode preview, audit log, dashboard pending-changes view with per-item attribution | Change a `pages.home` value → invisible until publish |
| 5 | Menu administration | Category tabs, dish CRUD, reorder, side panel, Kladde badges, **immediate Udsolgt with 10 s Fortryd and the computed reset label**, **tapas list editor**, soft delete | E2E 2, 3 and 10 pass |
| 6 | Weekly + monthly | **6A (done):** Ugens ret / Lørdagsmenu editor + all public states from 1af, **"Kopiér sidste uge"**, both immediate Udsolgt paths. **6B (done):** Månedens burger with its date window, its computed admin state, "Vis på forsiden" as a normal draft field and its own immediate Udsolgt path | 6A: E2E 9 passes and "Ingen lørdagsmenu denne uge" renders — see §0c. 6B: E2E 11 passes — see §0d. **Complete and locked** by the completion pass of 2026-08-30 — see §0e |
| 7 | Announcements | **7A (done):** bar in the public layout, **client expiry guard**, admin editor with required expiry and suggestion chips, the live "sådan ser den ud" panel, Kladde → Forhåndsvis → Offentliggør. **7B (done):** the immediate path — "Vis besked" off and back on, "Fjern beskeden nu", immediate public removal and its ~10 s Fortryd. *Replacing an active announcement, `previous`/`replaced_at` and 1ae's conflict sheet moved to **phase 8**, where the generated message they belong to lives* | 7A: E2E 4 passes, including the no-network assertion — see §0f. 7B: `tests/e2e/announcement-remove.spec.ts` passes at 1440 and 375 — see §0g. **Complete and locked** by the completion pass of 2026-08-30 — see §0h |
| 8 | Opening hours administration | **8A (done):** the normal weekly editor (owner) — 1t's upper card, seven weekday rows, per-day validation, Kladde → Forhåndsvis → Offentliggør through phase 4's machinery, and no migration. **8B (done):** 1t's lower card — one-off overrides for a single date, Staff *and* Owner on the same screen as the Owner-only week, removal, and the §7b integration in both directions. **8C-1 (done):** the announcement **replacement and restore mechanism** — the `previous` / `replaced_at` stash, `source='opening_hours'` as a value a server-side caller may pass, and one-level Fortryd, with **no control anywhere in the administration**. **8C-2 (done):** the **pure generator** — `lib/announcements/generated.ts` composes 1t's message, its link defaults and its corrected expiry (the *later* of the normal and special closings), with no database, no clock, no UI and no caller. **8C-3A (done):** generated-announcement **ownership** — `announcement.source_override_id`, the pairing CHECK, the ninth snapshot key, the ownership-aware write guard, and `apply_generated_announcement()`, the §7e item 8 coordinator that decides the conflict server-side and delegates the atomic write. `announcement_created` is **dropped**; no UI. **8C-3B (done):** the workflow — 1t's checkbox and editable suggestion, **conflict sheet 1ae with both branches**, the ~10 s Fortryd strip, §7e item 6's removal consequence with its atomic two-table transaction, the BEFORE DELETE guard that closes the direct-DELETE bypass, and the deletion of the 8C-1 harness | 8A: `tests/e2e/opening-hours.spec.ts` passes at 1440 and 375, including the §7b integration case — see §0i. 8B: `tests/e2e/opening-hours-override.spec.ts` passes at 1440 and 375, and `supabase/tests/014_opening_hours_overrides.test.sql` asserts the Staff/Owner split from real JWTs — see §0j. 8C-1: `tests/e2e/announcement-replacement.spec.ts` and `supabase/tests/015_announcement_replacement.test.sql` pass — see §0k. 8C-2: `tests/unit/announcements/generated.test.ts` — an unimported pure module needs no browser suite; see §0m. 8C-3A: `supabase/tests/017_generated_announcement.test.sql` passes — see §0n. 8C-3B: `tests/e2e/opening-hours-announcement.spec.ts` passes at 1440 and 375, and `supabase/tests/018_override_removal.test.sql` asserts the removal lifecycle and refuses a direct DELETE from real Staff and Owner JWTs — see §0o. E2E 5 is complete |
| 9 | News | **9A (done, §0q):** the list, the editor with the structured body (textarea form), per-item publish/unpublish behind confirmations, delete, the §7f slug policy end to end, the per-article Draft Mode preview target, and the public list/detail integration incl. unpublish → 404 — proven by `tests/e2e/news-admin.spec.ts` at 375 and 1440 and `supabase/tests/019`. **9B (done, §0r):** the B/Link structured editor, autosave, the `NewsArticle` JSON-LD, canonical/article metadata and the sitemap. The forside teaser has rendered since phase 3 and is verified against the news lifecycle | E2E 6 passes, incl. unpublish → 404 — **complete and locked** by the completion pass of 2026-09-01, recorded in §0s |
| 10 | Images | **10A (done, §0t):** the storage foundation — buckets, signed upload, client downscale, sharp derivative pipeline, `create_image()`/`delete_image()` with the write guard, pgTAP `020`, and the new storage integration suite. **10B (done, §0u):** the 1w library screen — list, alt text, usage labels, replace/delete confirmations, the upload UI mounting 10A's pipeline, `replace_image()` with pgTAP `021`, the signed-token and large-image integration suites, and the dedicated `image-library` Playwright pair. **10C-1 (done, §0v; hardened, §0w):** image selection in the dish/weekly/monthly/news editors through one shared picker pair, `image_references` as the one definition of "referenced", the draft-aware `delete_image()`/`replace_image()`, and the published `image_id` of the three draft entities guarded in the database — direct PostgREST writes refused, only publish/replace/detach move it (pgTAP `022`, `023`). **10C-2 (done, §0x):** the public `<picture>`/`srcset` rendering on the eight approved surfaces, the public read-model projection inside the tagged reads, the Draft Mode preview of pending images, the news `og:image` and JSON-LD `image`, and the per-entity cache coupling — `delete_image()`/`replace_image()` report the live references they moved (pgTAP `024`), the alt edit expires its live usages, and the first guest request after every public-changing image operation carries the new state (`tests/e2e/public-images.spec.ts`). **Complete and locked** by the completion pass of 2026-09-02 — the two no-image frames built, the cache/reference races classified, one clean regression chain — see §0y | E2E 7 passes whole: `image-library`, `editor-images` and `public-images` at 375 and 1440 |
| 11 | Remaining editors | **11A (done, §0z):** Forsiden (1u) — the four cards, the three photographs through the 10C-1 picker, the featured list from the menu, the `page:home` image references, guard and cache coupling. **11B (done, §0aa):** Mad ud af huset (1aj) — the visibility switch as a draft hiding the page, the nav item and the sitemap entry on publish, the photograph, the free sections, the button label — **and Kontaktoplysninger (1v)**, moved here from 11C by the owner's brief so both content editors land before the account phase. **11C (done, §0ab):** **`/admin/brugere`** — the list, the invitation through `inviteUserByEmail` and `create_account_profile()`, the role change, deactivation with the sessions revoked and the identity banned, reactivation, the last-active-owner invariant under a lock, the profile guard, pgTAP `028` with two real-session races, the Auth integration suite and the `users-admin` Playwright pair | E2E 8 passes (§0aa); the owner can invite and deactivate a staff user — `tests/e2e/users-admin.spec.ts` at 375 and 1440 (§0ab). **Complete and locked** by the completion pass of 2026-09-03 — see §0ac |
| 12 | Admin on mobile | 1x, 1y, 1z — the phone is the primary admin device. **12A (done, §0ad):** the complete Menu workflow at 375 px audited and made phone-first — 1y's foot (the Fortryd strips and the pending band pinned to the bottom of the phone screen), the one-row band, long content that wraps, the moved row kept in view, the stacked confirmation — with `tests/e2e/menu-mobile.spec.ts` under its own `menu-mobile` project. **12B (done, §0ae):** the complete News workflow at 375 px audited against 1z and made phone-first — the pinned editor bar with the badge and the autosave line, the B/Link toolbar and link panel stuck under it, fragment targets below the bar, the stacked confirmations, long titles and addresses that wrap, the public paragraph's wrap — with `tests/e2e/news-mobile.spec.ts` under its own `news-mobile` project. **12C (done, §0af):** the 1x / 1q dashboard — the bar, the band with the phase-4 list beneath it, the announcement card, the role-aware tiles from the entity registry, LIGE NU as a read model — with the phase-4 "Åbn …" vocabulary migrated across the locked suites in the same commit; and the phone audit of Ugens ret, Månedens burger, Besked på hjemmesiden and Åbningstider, whose Fortryd and status notices now sit at the foot of the phone screen through one shared `NoticeFoot`, with `tests/e2e/dashboard-mobile.spec.ts` under its own `dashboard-mobile` project. **Completion pass (§0ag):** the three read as one system, walked as Owner and Staff on a phone, 1x / 1y / 1z / 1q re-checked at 375 / 768 / 1440, the Forhåndsvis and 1 px observations closed, the moved row kept wholly in view, the phase-11 editors and Brugere given the same foot, an empty foot's clearance removed, a dead-autosave defect after the first Gem fixed and pinned | Full menu-edit and news flows completed on a 375 px viewport — the menu half is proven by `menu-mobile` (§0ad), the news half by `news-mobile` (§0ae), the dashboard and the specials by `dashboard-mobile` (§0af). **Complete and locked** by the completion pass of 2026-09-04 — see §0ag |
| 13 | SEO, monitoring, hardening | Metadata, sitemap, robots, JSON-LD, Sentry, **the weekly off-platform backup workflow**, rate limiting, security header pass, restore drill. **13A (done, §0ah):** the backup and restore commands, the scheduled workflow, the drill in CI, the runbooks — the destination provider still to be chosen. **13B (done, §0ai):** the PostgreSQL-backed limiter over the sign-in path and every Server Action (twelve tiers, one atomic door, HMAC subjects, fail-open except for accounts), and the security-header policy on every response (CSP, HSTS, nosniff, referrer, permissions, frame denial) with the public caching intact. **13C (done, §0aj):** server-side Sentry — the framework hook for pages, route handlers, Server Actions and the proxy, thirteen operational events from five server modules, one sanitizer, release and environment on every event, no browser SDK, no CSP change; the one controlled production event is a pre-launch gate. **Lock pass (§0ak, 2026-09-05):** the three read as one operational layer, the error and not-found states of both route groups built (§10g), the sanitizer widened to the non-JWT service key and the Danish credential words, the storm boundary grouped per account, the Sentry CLI download switched off, the pre-launch gates consolidated in `docs/runbooks/pre-launch-checklist.md`, one clean certification chain. **Complete and locked.** The SEO verification against Rich Results and the final security audit are the next increments, not this phase's | Rich Results valid (ahead); a backup lands off-platform and a restore succeeds into a scratch project — proven against the local stack and a local S3 endpoint; the hosted runs are pre-launch gates B6/B7, deliberately not claimed by the repository |
| 14 | Launch | Real photos and copy from the 1ab checklist, **final map asset**, **domain + Resend DNS verification**, **the one-time owner bootstrap**, training pass, DNS cutover. Planned as four increments: **14A (done, §0al) — production wiring in the repository:** the Owner bootstrap through the phase-11 invitation, the confirmed/development seed split, the one-time confirmed-content loader, the migration door and its dispatch-only workflow, the launch map guard, and the three runbooks (`domain-cutover.md`, `owner-handover.md`, `launch-notes.md`) — no hosted account touched. **14B1 (done, §0am) — the Om os editor** at `/admin/om-os`: the strict about document, the three photo slots through the shared picker, the page's image paths in `image_references`, the guard and the two transitions, the phase-4 content screen retired. **14B2 (done, §0an–§0ao) — real launch assets and temporary factual copy:** the real logo (`public/brand/logo.svg`, `app/icon.svg`), the Forside hero/excerpt words and hero photograph (the excerpt photograph reusing the Om os venue image, §0ao), the Om os story/team/method words and facade photograph, Mad ud af huset's words and photograph, two confirmed dish photographs (Odin, Ragnar) and Tapas's own — required photography scoped to what the restaurant supplied (§0ao): the team and kitchen photographs are optional and render text-only when absent, the award stays its own accepted no-image frame; nothing seeded. **14B3 (done, §0ap; finalised, §0aq) — the static map replaced by a Google Maps embed:** `components/site/GoogleMap.tsx` over the retired launch guard and asset descriptor, `frame-src` added to the CSP, rendering the official Google-generated embed link for the restaurant's own listing as a fixed constant — no API key, ever; closes the licensed-map launch blocker outright, leaving only a privacy-review question for later, no production configuration step. **14C (repository half done, hosted half blocked, §0ar) — hosted production deployment, bootstrap and verification:** the environment audit (the variable set is exact; no `GOOGLE_MAPS_EMBED_API_KEY`, no stale map guard), the 22 deferred E2E failures investigated and closed for cause (local seed drift, cleared by a clean reset and no fixture changed; plus the two "nothing leaves this origin" assertions rewritten around `tests/e2e/support/map-embed.ts`, which excepts Google's frame by *who asked* rather than by host), and a full local certification. Every hosted step — the migration run, the content load, the Owner, the production media re-upload, Vercel, Sentry, the backup destination, the restore drill, the domain, the workflow's push trigger — is **blocked on infrastructure that does not exist**: no GitHub remote, Vercel project, hosted Supabase, Resend, Sentry or bucket. Measured, not assumed, and recorded with an ordered manual setup plan in `docs/runbooks/launch-notes.md` §9. **14D** — the phase-14 lock | The owner completes a price change, a sell-out and an announcement unaided; no placeholder assets remain |

Phases 5–11 can be reordered to follow whatever the restaurant needs first; phases 0–4 cannot.

**Status, 2026-09-06: phase 14A (§0al) and 14B1 (§0am) are built and green; 14B2 —
the real logo, two confirmed dish photographs, and the Forside/Om os/Mad ud af huset
launch copy — is built and green (§0an), through a clean complete-matrix regression;
§0ao then scoped required launch photography to what the restaurant actually
supplied and gave Om os's team and kitchen sections an honest text-only look for
the photograph neither exists nor is required. The award stays its own accepted
no-image frame, unchanged. **14B3 (§0ap, finalised §0aq) replaced the static map with
the official Google Maps embed for the restaurant's own listing**, closing the one
remaining launch-photography/asset blocker outright — no API key, no Google Cloud
project, no production configuration step remains; what is left is only a
privacy-review question for the later security/cookie pass, not an asset or a key to
obtain. Phase 14 is not complete and nothing hosted is provisioned.** Before it: **phases 0–13 are
complete and locked.** Phase 13 — the
production-hardening layer — as 13A, backup and recovery (§0ah), 13B, rate limiting and
the security-header policy (§0ai, with its closure pass), 13C, server-side monitoring
(§0aj), and the lock pass over the three (§0ak), which is the current truth of what a
deployment must be configured with (`docs/runbooks/pre-launch-checklist.md`) and what
the final security audit inherits. The SEO verification and that audit are the next
increments. Before it: **phases 0–12** — phase 10 as 10A
(§0t), 10B (§0u), 10C-1 (§0v, hardened in §0w), 10C-2 (§0x) and the completion
pass over all four (§0y); phase 11 as 11A — the Forsiden editor (§0z), 11B — Mad ud
af huset and Kontaktoplysninger (§0aa), 11C — the user administration at
`/admin/brugere` (§0ab), and the lock pass over all three (§0ac); **phase 12 — the
administration on a phone as the primary device (1x, 1y, 1z) — as 12A, the Menu
workflow at 375 px (§0ad), 12B, the News workflow at 375 px (§0ae), 12C, the 1x / 1q
dashboard and the phone audit of the remaining operational screens (§0af), and the
completion pass over the three (§0ag), which is the current truth of the
administration on a phone.** Phase 8's lock pass is
recorded in §0p, and **phase 9's in §0s**: 9A (the news administration's core, §0q) and
9B (the B/Link body editor, autosave, the `NewsArticle` JSON-LD, canonical metadata and
the sitemap, §0r) were read as one system, walked as Owner, Staff and guest against a
production build, audited against frames 1s/1z at 375/768/1440, and closed by the
completion pass of 2026-09-01. Phase 5 was closed by a completion
pass and is recorded in full in §0b, including the five capabilities it delivered and the five
things that are deliberately outside it. Phase 6 was then built in two increments that share
nothing but a table row: **6A — Ugens ret and Lørdagsmenu — is recorded in §0c**, and **6B —
Månedens burger (frame 1ah, §7d) — is recorded in §0d**.

**Phase 6 was closed by its own completion pass on 2026-08-30, recorded in §0e.** That pass read
the two halves together, walked both screens against a production build as Staff and as Owner,
checked frames 1ag, 1ah, 1af and 1aa once more against what shipped at 375 / 768 / 1440 px,
reviewed the three immediate-path database functions and the two domain modules as sets rather
than singly, and recorded the result. §0c and §0d are left as written — they are each increment's
own account of its decisions — and §0e is what "phase 6" means as a whole.

**Phase 7A is complete and green, and is recorded in §0f.** The announcement editor,
the public bar and the client expiry guard are built; open item H was closed on the way
past it.

**Phase 7B is complete and green, and is recorded in §0g.** The immediate path — 1ad's
*"Fjerne → ét tryk"*: "Vis besked" off, "Fjern beskeden nu", the bar leaving the
hjemmeside at once, and the ~10 s Fortryd that restores the visibility of the same
published message — is built, with one migration, two database functions and no new table.
**Replacing an active announcement is not part of it**: the `previous jsonb` stash, the
restore that reads it, "Erstat med den nye besked" and 1ae's conflict sheet were moved to
**phase 8**, where the generated opening-hours message they exist to serve lives. Nothing
in phase 7 reads or writes `previous` or `replaced_at`, and `source` stays `'manual'`.

**Phase 7 was closed by its own completion pass on 2026-08-30, recorded in §0h.** That
pass read 7A and 7B together, walked both halves against a production build as Staff and
as Owner, checked frames 1ac, 1ad and 1aa once more against what shipped at 375 / 768 /
1440 px, reviewed the visibility RPC beside the three sold-out ones as a set, and walked
the two states §0g said neither suite reached — a malformed stored draft, and a Staff
account deactivated mid-session. It carried **one approved behaviour change**: "Vis besked"
now moves the visibility of the already-published announcement **both ways**, immediately,
which closes §0g reading A's limitation without touching the rule underneath it —
*content* still reaches the hjemmeside only through Ret → Forhåndsvis → Offentliggør, and
switching the bar back on cannot publish a pending draft. It also made one visual
correction (the linked public bar was 61 px against 1ac's 41; it is now 45) and one
correctness fix (a publish that could never succeed is no longer offered, and no longer
worded "prøv igen").

**Phase 7 is locked**, and nothing in phase 7 reads or writes `previous` or
`replaced_at`; `source` stays `'manual'`.

**Phase 8A is complete and green, and is recorded in §0i.** The Owner-only editor for the
**normal weekly opening hours** is built at `/admin/aabningstider` — 1t's upper card, seven
weekday rows, per-day Danish validation, and the ordinary Kladde → Forhåndsvis →
Offentliggør path over phase 4's machinery. It added **no migration and no database
function**: the singleton, its shape CHECK, its Owner-only RLS policy, `publish_opening_hours()`
and the `hours` cache tag have existed since phases 1 and 4.

**Phase 8B is complete and green, and is recorded in §0j.** 1t's lower card — "ENKELT
ÆNDRING", the one-off change to a single calendar date — is built at the same address,
beneath the weekly card and under a different half of the §5 matrix: **Staff and Owner** may
close one date or give it other hours, while the recurring week stays the Owner's. It has
its own Kladde → Forhåndsvis → Offentliggør, its own removal (§7e item 6), and it feeds
§7b's sold-out reset in **both** directions without a line of availability logic of its own.

It added **one migration**: a `draft jsonb` column on `opening_hours_overrides`, so that a
*published* override and the edit waiting behind it can be two values at once — the one
state §4's `status`-only model could not express, and the one §6 exists to protect. The
reasoning is written out in §0j and in the migration itself, and §4's table is corrected in
place. No policy and no grant changed.

**Phase 8C-1 is complete and green, and is recorded in §0k.** §6's third immediate
announcement row — *replace an existing announcement, stashing the old one in `previous`,
with a ten-second Fortryd that restores it* — is built: one migration, four SECURITY INVOKER
functions, no new table, no new column, no new policy and no new grant. `previous` and
`replaced_at` have an active purpose for the first time since phase 1, the snapshot is a
closed eight-key shape validated on the way in **and** on the way out, the restore reads it
from the database rather than from the browser, and **exactly one level** is kept — there is
no history, no stack and no array.

**8C-1 added no control anywhere in the administration.** `/admin/besked` is phase 7's
editor and still is — no "Erstat", no "Behold eksisterende", no source selector, no conflict
sheet — and the one address outside it was an unlinked, environment-gated integration
harness. §0k reading F records why it existed and what kept it safe, and §0n records the
third action 8C-3A added to it rather than inventing a second harness. **8C-3B deleted it**
(§0o), because the real caller — 1ae's sheet on the opening-hours screen — exists now.

**Phase 8C-2 is complete and green, and is recorded in §0m.** The **generated** message
itself now exists, as one pure module — `lib/announcements/generated.ts` — with no
database access, no clock read, no cache invalidation, no React, no Server Action and no
caller. It composes 1ac's two forms (*"Ændrede åbningstider søndag · 17:00–19:00"* with
"Se tider" to Find os, and the neutral *"Lukket mandag 21.09"* with no link at all),
carries `source = 'opening_hours'`, and computes the expiry from the **corrected** rule
the frames' own numbers state: the **later** of the normal closing and the special
closing, never `override.closes_at` and never an invented midnight. An override that
changes nothing a guest could notice returns `no_effect`; an expiry already past returns
`expired` and is never moved forward.

**Phase 8C-3A is complete and green, and is recorded in §0n.** Generated-announcement
**ownership** is settled: `announcement.source_override_id` names the override that
composed the message on the hjemmeside, paired with `source` in both directions by a
CHECK, restored with the message by Fortryd, and carried in `previous` as its ninth key.
§4's `opening_hours_overrides.announcement_created` is **dropped** — one pointer that can
be joined beats a boolean two statements have to keep in step. `apply_generated_announcement()`
is §7e item 8's coordinator: it re-reads the singleton server-side, returns `conflict` for
an announcement a guest can read unless replacement was explicitly confirmed, and otherwise
delegates the write so the content, the snapshot and the ownership move in one transaction.
It writes nothing about the opening hours in any branch.

**Phase 8C-3B is complete and green, and is recorded in §0o.** 1t's "Vis også som besked
øverst på hjemmesiden" with its editable suggestion, 1ae's conflict sheet with "Erstat med
den nye besked" and "Behold eksisterende besked", the ~10 s Fortryd strip and §7e item 6's
removal consequence all exist and are driven end to end at 375 and 1440. The hours are
published first and always — the Server Action commits the override and expires its cache
tag before the message is attempted, and the coordinator issues no statement against the
hours tables in any branch — so no announcement outcome can roll a published override back.
Deleting a one-off change now goes through one door, and a BEFORE DELETE guard makes that
true of a direct PostgREST request as well, with no SECURITY DEFINER added anywhere.

**Phase 8 is not locked.** A dedicated completion/lock pass is the next step: reading the
five increments together, walking both cards against a production build as Staff and as
Owner, and closing the phase the way phases 5, 6 and 7 were closed.
