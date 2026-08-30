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
| `announcement` | The site announcement bar, one singleton row | `message` (≤90), `link_type`, `link_page`, `link_url`, `link_label`, `expires_at`, `is_visible`, `source` ('manual'/'opening_hours'), `previous jsonb`, `replaced_at`, `draft` | public where visible **and** `expires_at > now()` | staff | yes for edits, **no** for hide/remove |
| `opening_hours` | The normal weekly schedule, one singleton row | `schedule jsonb` (7 × `{closed}` or `{from,to}`), `draft` | public | **owner** | yes |
| `opening_hours_overrides` | One-off changes | `date` (unique), `kind` ('closed'/'custom'), `opens_at`, `closes_at`, `announcement_created`, `status` ('draft'/'published') | public, future dates | staff | per-row publish |
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
- No `publish_queue` table. Pending changes are derived from `draft is not null`, `news.status`, and `overrides.status` via a `pending_changes` view.
- **No `scheduled_publishes` table and no job runner.** Every future-dated behaviour is a read-time filter.
- **No sold-out reset job and no `sold_out_expires_at` column.** Storing a computed instant would go
  stale the moment the opening hours or an override changed. The reset is derived on read from
  `sold_out_on` plus the same hours engine the rest of the site already uses.

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

1. Editing writes to `draft` (autosaved for the news editor, as designed). Live columns are untouched, so the public site is byte-identical to before.
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

*The announcement rows above are **phase 7B**; phase 7A built the ordinary three-step path
only (§0f). Note that this table describes the **immediate** operations, so the only
announcement visibility change in it is the one that switches a bar **off**. Turning one
on is Offentliggør, and `publish_announcement()` sets `is_visible` — see §0f.*

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
as it already is for the manual "Fjern beskeden nu" path, so removal reflows identically.

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
6. **Override deleted after it generated an announcement.** Ask, and default to removing the announcement too when `source='opening_hours'` and it points at that date.
7. **Override in the past, or on an already-closed day.** The date must be today or later; an override on a Monday is allowed (they may open specially) — and it correctly becomes a sold-out reset day (§7b).
8. **Announcement conflict resolution must never lose the hours.** Server-authoritative: the hours override is written first and always; the announcement is only attempted afterwards; a conflict returns `{status:'conflict'}` and requires an explicit `confirmReplace: true` on the follow-up call. There is no code path where a "Behold eksisterende" choice can roll back the hours.
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
| 7 | Announcements | **7A (done):** bar in the public layout, **client expiry guard**, admin editor with required expiry and suggestion chips, the live "sådan ser den ud" panel, Kladde → Forhåndsvis → Offentliggør. **7B (not started):** "Vis besked" off, "Fjern beskeden nu", replacing an active announcement and its ~10 s Fortryd | 7A: E2E 4 passes, including the no-network assertion — see §0f |
| 8 | Opening hours administration | Weekly editor (owner), one-off overrides, generated announcement, **conflict sheet 1ae with both branches** | E2E 5 passes, including "hours always save" |
| 9 | News | List, editor with structured body, autosave, publish/unpublish, **`/nyheder/[slug]` with the slug policy and `NewsArticle` JSON-LD**, forside teaser | E2E 6 passes, incl. unpublish → 404 |
| 10 | Images | Signed upload, client downscale, sharp derivatives, library with usage labels, replace/delete warnings | E2E 7 passes |
| 11 | Remaining editors | Forsiden, Mad ud af huset (incl. the visibility toggle hiding the nav item), Kontaktoplysninger, **`/admin/brugere`** | E2E 8 passes; the owner can invite and deactivate a staff user |
| 12 | Admin on mobile | 1x, 1y, 1z — the phone is the primary admin device | Full menu-edit and news flows completed on a 375 px viewport |
| 13 | SEO, monitoring, hardening | Metadata, sitemap, robots, JSON-LD, Sentry, **the weekly off-platform backup workflow**, rate limiting, security header pass, restore drill | Rich Results valid; a backup lands off-platform; a restore succeeds into a scratch project |
| 14 | Launch | Real photos and copy from the 1ab checklist, **final map asset**, **domain + Resend DNS verification**, **the one-time owner bootstrap**, training pass, DNS cutover | The owner completes a price change, a sell-out and an announcement unaided; no placeholder assets remain |

Phases 5–11 can be reordered to follow whatever the restaurant needs first; phases 0–4 cannot.

**Status, 2026-08-30: phases 0–6 are complete and locked, and phase 7A is complete.** Phase 5 was closed by a completion
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
past it. **Phase 7B — the immediate path: "Vis besked" off, "Fjern beskeden nu",
replacing an active announcement, and the ~10 s Fortryd that belongs to each — is not
started**, and neither is phase 8's generated opening-hours announcement. Phase 7 as a
whole is therefore **not** locked.
