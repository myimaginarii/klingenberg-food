# Klingenberg Food — Technical Plan

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
suite green (**2,182 tests in 74 files** — +84 in 4 new files and 3 extended for 9B);
pgTAP unchanged and green (**1,256 assertions in 19 files**); `next build` clean with
`/sitemap.xml` on the 5m/5m contract; `npx playwright test --list` collecting **991
tests in 25 files** with the news write spec under exactly `news-admin-mobile` and
`news-admin` (the §22 check); the full Playwright matrix green at `--retries=0`; and
`npm audit --audit-level=high` clean on the unchanged lockfile.

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
    billeder/page.tsx           # (1w)
    brugere/page.tsx            # owner only — not in the approved design, built in its language
  api/preview/[start|stop]/route.ts
  sitemap.ts  robots.ts  opengraph-image.tsx
components/
  site/                         # Header, AnnouncementBar, OpenStatus, MenuSection, BottomNav …
    AnnouncementBar.tsx         # server component
    AnnouncementExpiryGuard.tsx # 'use client' — the only new client component (decision C1)
    StaticMap.tsx               # <a> + <img> + optional attribution line (decision 6)
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
  backup.yml                    # weekly off-platform storage + db export (decision C2) — phase 13
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
| `pages` | Editable page documents | `key` ('home'/'takeaway'/'about'), `published jsonb`, `draft jsonb`, `is_visible` | public (`published`) | staff (`home`: **owner**) | yes |
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

- **home** — `hero {heading, intro, image_id}`, `award {title, text, image_id}`, `featured_dish_ids [3]`, `about_excerpt {text, image_id}`
- **takeaway** — `heading`, `intro`, `image_id`, `sections [{id, heading, body, sort}]`, `cta_label`
- **about** — `heading`, `story_blocks []`, `team {text, image_id}`, `method {heading, text, image_id}`, `venue_image_id`, `award_image_id`

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

1. `middleware.ts` refreshes the session and redirects unauthenticated `/admin/*` to `/admin/login`. This is **routing convenience, not authorization.**
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
- **Bootstrap at launch:** the first production owner is created once, by the developer, with a
  service-role script that sets a random password and immediately triggers the reset email. The
  restaurant's owner sets their own password; the developer never knows it. The script lives in
  `supabase/` and refuses to run if an owner already exists.
- **Invite:** the owner adds a user (name, email, role) → a Server Action uses `auth.admin.createUser`
  plus an invite/reset email → the person sets their own password.
- **Deactivate, never delete:** `disabled_at` is set and refresh tokens are revoked, so the person is
  signed out everywhere while `audit_log` attribution survives.
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

### 7g. Map (decision 6)

No map library. No tile provider called at runtime. No JavaScript. The entire map is:

```
<a href={directionsUrl} …>
  <img src="/map/klingenberg-food.webp" srcSet="… 1x, … 2x" width height alt="Kort over …" loading="lazy" />
</a>
{attribution && <p class="…">{attribution}</p>}
```

- **Asset.** A licensed static image lives in `public/map/`, with `public/map/LICENSE.md` recording
  the source, licence and date. Fixed `aspect-ratio` container, explicit `width`/`height`, 1× and 2×
  variants, `loading="lazy"` (it is not the hero on Find os).
- **Placeholder during development.** A neutral brand-tinted asset at the exact final dimensions with
  the pin in the correct position, so the layout is final on day one and the swap is a one-file change
  with no code edit. It is a **launch-blocking checklist item** that the placeholder must not reach
  production — enforced by a build-time check on the provenance field in `LICENSE.md`.
- **The whole preview links to directions.** One universal link:
  `https://www.google.com/maps/dir/?api=1&destination=<url-encoded address>`. This opens the native
  Google Maps app on Android and iOS when it is installed, and the web map otherwise. One `<a>`, no
  user-agent sniffing, works with JavaScript disabled.
- **Attribution.** `site_contact.map_attribution` (nullable). When the final asset requires it — for
  example an OpenStreetMap-derived cutout requiring "© OpenStreetMap contributors" — the string
  renders as **real text** beneath the frame, not baked into the image, so it is selectable and
  readable by a screen reader. When the licence requires no attribution the field is null and nothing
  renders, so the approved design is unchanged either way.
- The street address stays real text beside the map (it always was), so the location is available to
  search engines, screen readers and copy-paste regardless of the image.

---

## 8. Security risks and how the architecture prevents them

| Risk | Prevention |
|---|---|
| Public site performs an admin write | The public half has no Supabase client, no token, and no mutation endpoint. The anon key's RLS policies grant `SELECT` on published rows only — no `INSERT`/`UPDATE`/`DELETE` policy exists for `anon` on any table. |
| Authorization by hidden UI | Every Server Action begins with `requireStaff()`/`requireOwner()`; RLS re-checks the same rule with the user's own JWT. Middleware is explicitly documented as routing only — which is also why the middleware-bypass advisory class does not apply here. |
| Service-role key reaches the browser | The key is not `NEXT_PUBLIC_`-prefixed, lives in `lib/supabase/service.ts` behind `import 'server-only'`, and is used in exactly three places (signed upload URLs, migrations/seed, the one-time owner bootstrap). A lint rule forbids importing it outside `lib/`. |
| Drafts leak to the public | Draft Mode is enabled only by an authenticated route; the draft cookie is httpOnly and signed. Content loaders read `draft` only when draft mode is on **and** a staff session exists. |
| Malicious upload | Signed upload URL issued only after a role check; server validates magic bytes (not the declared MIME), caps size, re-encodes with sharp (which discards anything that is not an image and strips EXIF/GPS), stores under a random path. Originals go to a private bucket; only derivatives are publicly readable. |
| XSS from staff-entered content | News body is structured JSON rendered by our own components — no HTML parsing, no `dangerouslySetInnerHTML` anywhere, including the new detail page. Tapas list items and all other free text are plain strings. |
| Open redirect / injected announcement link | `link_type='page'` is an enum of our own routes; `link_type='url'` is validated as `https:` and rendered with `rel="noopener noreferrer"`. The map link is built from the stored address, never from user input. |
| CSRF | Server Actions carry Next.js's built-in origin check; `serverActions.allowedOrigins` is derived from `lib/config/site.ts`, not hard-coded. |
| Credential stuffing | Supabase Auth rate limits plus a login-attempt throttle keyed on email. Password reset via a verified Resend domain. |
| Admin indexed by search engines | `/admin/*` returns `X-Robots-Tag: noindex, nofollow` and is disallowed in `robots.txt`. Preview deployments additionally sit behind Vercel Deployment Protection (§10). |
| Silent data loss | Every publish and every immediate change writes to `audit_log` with before/after. Soft-delete for dishes. Daily managed database backups **plus** a weekly off-platform export of database *and* storage (§10f). |
| System left with no owner | Database constraint trigger on `profiles`; the last active owner cannot be demoted, disabled or deleted. |
| **A trusted function is fed forged state through a direct write** | `restore_announcement()` publishes whatever `announcement.previous` holds, so a caller who could write that column could publish content none of the validating paths ever saw. The columns a lifecycle function is the sole author of are therefore not directly writable at all: `authenticated` holds a **column-level** UPDATE grant, and a BEFORE UPDATE guard trigger refuses any movement of the published, visibility, provenance and lifecycle columns that did not come from the function that owns it (§5, `20260831160000_announcement_column_privileges.sql`). The lifecycle functions stay SECURITY INVOKER, so RLS still decides the row. |
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
12. Find os: the map image is wrapped in a link whose `href` is a directions URL containing the address, and the page works with JavaScript disabled.

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

- **Local:** `supabase start` + `next dev`. `supabase/seed.sql` loads the confirmed menu, hours and contact facts so a fresh clone is immediately usable. Migrations in `supabase/migrations` are the only way schema changes happen.
- **PR:** CI applies migrations to **staging**, builds, and runs the full suite against the Vercel Preview Deployment. Never against production.
- **Merge to `main`:** CI applies migrations to the production Supabase project, then Vercel promotes the build. Production credentials live in a protected GitHub environment that pull requests cannot read.

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
| `SUPABASE_SERVICE_ROLE_KEY` | server only | never prefixed `NEXT_PUBLIC_`; three call sites |
| `SUPABASE_DB_URL` | CI only, per environment | migrations; passed as env, never as an argument |
| `SITE_URL` | all | canonical URLs, OG, sitemap, allowed origins — the only place a domain lives |
| `SENTRY_DSN` | server only | |
| `RESEND_API_KEY`, `AUTH_EMAIL_FROM` | Supabase project settings | password reset and invites |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | CI only | Playwright against protected previews |
| `BACKUP_S3_*`, `SUPABASE_STORAGE_S3_*` | GitHub `backup` environment only | weekly export (§10f) |

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
2. An incremental sync of the `media` Storage bucket via Supabase Storage's S3-compatible endpoint
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

**Not implemented yet.** The workflow is designed here and built in phase 13, together with the
restore drill into a scratch project. `audit_log` remains the content-level recovery story for
"someone published the wrong thing".

### 10g. Monitoring and error handling

Sentry on the server (Server Actions, route handlers, RSC) with releases tied to the deployment. No browser SDK, no session replay. Vercel log drains retained. `error.tsx` and `not-found.tsx` in both route groups, in the approved visual language. Admin errors surface as the designed inline error state ("Billedet kunne ikke uploades. Prøv igen." with a retry), never as a stack trace. An uptime ping on `/` and `/find-os`.

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
- **Map licensing:** if the supplied static asset requires attribution, it renders as visible text from `site_contact.map_attribution` (§7g). Provenance is recorded in `public/map/LICENSE.md` and checked at build time.

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
collects no visitor behaviour. Vercel's request logs are operational, not analytical.

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
| A | **Off-platform backup destination** — Cloudflare R2, Backblaze B2, or the interim private-GitHub-repo archive | phase 13 | Recommend R2 (EU jurisdiction, private, versioned) |
| B | **PITR on Supabase Pro** — an extra cost on top of daily backups | before launch | Off. Daily backups plus a weekly off-platform export is proportionate for this content volume |
| C | **Final map asset and its licence** | before launch | Placeholder until supplied; a build check prevents it shipping |
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
| 9 | News | **9A (done, §0q):** the list, the editor with the structured body (textarea form), per-item publish/unpublish behind confirmations, delete, the §7f slug policy end to end, the per-article Draft Mode preview target, and the public list/detail integration incl. unpublish → 404 — proven by `tests/e2e/news-admin.spec.ts` at 375 and 1440 and `supabase/tests/019`. **9B (remaining):** the B/Link toolbar, autosave, `NewsArticle` JSON-LD. The forside teaser has rendered since phase 3 | E2E 6 passes, incl. unpublish → 404 |
| 10 | Images | Signed upload, client downscale, sharp derivatives, library with usage labels, replace/delete warnings | E2E 7 passes |
| 11 | Remaining editors | Forsiden, Mad ud af huset (incl. the visibility toggle hiding the nav item), Kontaktoplysninger, **`/admin/brugere`** | E2E 8 passes; the owner can invite and deactivate a staff user |
| 12 | Admin on mobile | 1x, 1y, 1z — the phone is the primary admin device | Full menu-edit and news flows completed on a 375 px viewport |
| 13 | SEO, monitoring, hardening | Metadata, sitemap, robots, JSON-LD, Sentry, **the weekly off-platform backup workflow**, rate limiting, security header pass, restore drill | Rich Results valid; a backup lands off-platform; a restore succeeds into a scratch project |
| 14 | Launch | Real photos and copy from the 1ab checklist, **final map asset**, **domain + Resend DNS verification**, **the one-time owner bootstrap**, training pass, DNS cutover | The owner completes a price change, a sell-out and an announcement unaided; no placeholder assets remain |

Phases 5–11 can be reordered to follow whatever the restaurant needs first; phases 0–4 cannot.

**Status, 2026-09-01: phases 0–8 are complete and locked** — phase 8's lock pass is
recorded in §0p — **and phase 9A, the news administration's core, is complete and green
(§0q). Phase 9 is not locked**: 9B (the B/Link body toolbar, autosave, the `NewsArticle`
JSON-LD) is the remaining phase-9 work. Phase 5 was closed by a completion
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
