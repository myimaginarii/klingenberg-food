import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

import { signIn, STAFF } from './support/admin'
import {
  announcementForm,
  copenhagenDate,
  guestAnnouncement,
  openAnnouncementAdmin,
  pendingBand,
  pressRemoveNow,
  pressVisibilitySwitch,
  publishAnnouncement,
  removeNowButton,
  saveAnnouncement,
  stateBanner,
  visibilityCard,
} from './support/announcement-admin'
import {
  announcementMessage,
  announcementOption,
  announcementRefusal,
  announcementUndoStrip,
  conflictMessages,
  conflictSheet,
  editAnnouncementMessage,
  keepExistingButton,
  pressAnnouncementUndo,
  replaceButton,
  resolveConflict,
  setAnnouncementWanted,
} from './support/hours-announcement'
import {
  fillOverride,
  firstNormallyClosedDay,
  openOverrideCard,
  overrideCard,
  overrideForm,
  overrideStateBadge,
  pressAndSettle,
  removeAllOverrides,
  saveAndPublishOverride,
  setOverrideDate,
  todayInCopenhagen,
} from './support/hours-override'
import { addDays, weekdayOf } from '@/lib/time/calendar'

/**
 * The generated opening-hours announcement, end to end — design 1t and **1ae**; technical
 * plan §4, §6, §7e items 6 and 8. **Phase 8C-3B.**
 *
 * This suite replaces `announcement-replacement.spec.ts`, and the replacement is the
 * point. That suite drove an unlinked, environment-gated harness, because 8C-1 was
 * forbidden to add a replacement control and `updateTag()` is only reachable from a Server
 * Action. 8C-3B added the real control, so the same properties are asserted **through the
 * screen a person actually uses** — 1t's checkbox, 1ae's sheet, the green Fortryd strip —
 * and the harness is deleted.
 *
 * ================= THE PROMISE, IN THE ORDER IT IS KEPT =================
 *
 * §7e item 8: *"the hours override is written first and always; the announcement is only
 * attempted afterwards … There is no code path where a 'Behold eksisterende' choice can
 * roll back the hours."*
 *
 *     admin    a published, live **manual** message A
 *     admin    a one-off opening-hours change, with "Vis også som besked…" ticked
 *     public   the new HOURS, already            ← before any question is asked
 *     admin    1ae: keep A, or replace it with the generated message
 *     public   whichever was chosen, on the FIRST request
 *     admin    Fortryd, for ten seconds
 *     public   A again, on the FIRST request — and the hours still changed
 *
 * Every scenario below asserts the hours *and* the message separately, because they are
 * two facts and the whole item is about not confusing them.
 *
 * ================= HOW OWNERSHIP IS OBSERVED =================
 *
 * `announcement.source_override_id` is administration state and no screen prints it. It is
 * observed here the way a person would: **the removal control says so.** An override that
 * owns the live message offers *"Fjern ændring og besked"*; one that does not offers
 * *"Fjern ændringen fra hjemmesiden"*. That is `describeOverrideRemoval()` reading the
 * ownership pointer, so asserting the label asserts the pointer — through the interface,
 * which is what §24 asks for, rather than through a debug attribute a harness printed.
 *
 * The database's own view of the same fact is asserted from real JWTs in
 * `supabase/tests/017` and `018`, including the direct-DELETE refusal that has no
 * interface at all.
 *
 * ================= WHAT THIS SUITE LEAVES BEHIND =================
 *
 * The state every announcement suite starts from and leaves: **published and expired,
 * switched off, nothing pending**, and no one-off overrides at all.
 *
 * Every date is computed from today. A suite that hard-coded one would pass this month and
 * fail the next.
 */

test.describe.configure({ mode: 'serial' })

const MANUAL_A = 'Besked A — den manuelle, der stod der i forvejen'
const DRAFTED_C = 'Kladde C — ikke offentliggjort endnu'
const OWN_WORDS = 'Vi lukker tidligt på grund af en privat fest'

let staffPage: Page
let guest: APIRequestContext

/**
 * The browser itself, so a fixture can open a **real guest page**.
 *
 * `guestAnnouncement()` needs one: reading what a visitor actually sees means rendering
 * the page, not fetching its bytes. See the two fixtures below for why that distinction
 * decides whether this suite works.
 */
let browserRef: Browser

type GuestResponse = { readonly status: number; readonly html: string }

/**
 * WCAG 2.2 A and AA, the same bar every other screen in this administration is held to.
 *
 * The read-only announcement states are scanned in `tests/a11y/hours-admin.spec.ts`, from
 * the address alone. The three below cannot be: 1ae's sheet, the green Fortryd strip and
 * the removal confirmation that names both halves each exist only *after* a write, so they
 * are scanned here, where the write that produces them has just happened — the same
 * arrangement `opening-hours-override.spec.ts` uses for a populated Kladde.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return results.violations.map((violation) => violation.id)
}

/** Everything visible and operable that is under 1aa's 44 px minimum. */
async function smallTargets(page: Page): Promise<string[]> {
  return page
    .locator('a:visible, button:visible, select:visible, input:visible, label:visible')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect()
          const hidden = (rect: DOMRect) => rect.height <= 2 || rect.width <= 2

          if (element.tagName === 'LABEL') {
            const control = document.getElementById((element as HTMLLabelElement).htmlFor)
            if (control !== null && !hidden(control.getBoundingClientRect())) return false
          }

          return !hidden(box) && box.height > 0 && box.height < 44
        })
        .map((element) => `${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 40)}"`),
    )
}

/*
 * TWO WAYS TO ASK WHAT A GUEST SEES, AND THEY ARE NOT INTERCHANGEABLE
 *
 * `guestGet()` fetches the **bytes the server sends**. That is exactly right for §6's
 * promise — *the first request after a write carries the change* — and every scenario below
 * asserts it that way: one request, one assertion, no retry.
 *
 * `guestAnnouncement()` renders a **real page** and reads the announcement region from the
 * live DOM. That is what the two fixtures need, and the difference is not cosmetic. The
 * announcement has three layers of truth (`AnnouncementRegion`): the server filters expired
 * messages out at render time, and `AnnouncementExpiryGuard` removes the bar's *content* in
 * the browser for a page that was already on screen when the expiry passed. So a page
 * rendered and cached **before** an expiry still carries the bar in its markup, and a guest
 * loading it still reads nothing — the guard takes it away. String-matching the bytes
 * cannot tell those apart; rendering the page does, because it runs the same guard the
 * guest's browser runs.
 *
 * The fixtures ask the question the product answers, in the product's own terms, with no
 * sleep and no retry.
 */

/** One request from nobody in particular: no session, no cookie, no browser cache. */
async function guestGet(path = '/'): Promise<GuestResponse> {
  const response = await guest.get(path)
  return { status: response.status(), html: await response.text() }
}

/** Monday and Tuesday are closed in the confirmed week. */
const CLOSED_WEEKDAYS = new Set(['mon', 'tue'])

/**
 * The next date the recurring week is **open** on, so a `closed` override is a real change.
 *
 * Computed from the seeded schedule rather than hard-coded: a suite that assumed "three
 * days from now is a Wednesday" would be a calendar bug waiting for a Sunday.
 */
function firstNormallyOpenDay(from: string): string {
  for (let offset = 0; offset < 14; offset += 1) {
    const date = addDays(from, offset)
    if (!CLOSED_WEEKDAYS.has(weekdayOf(date))) return date
  }

  throw new Error('the seeded week has no open day')
}

/**
 * The open days the publishing scenarios draw from — each scenario owning one by name.
 *
 * Not `firstNormallyOpenDay(addDays(today, n))` with a different `n` per scenario, which is
 * what this suite did first and is a trap: that expression *rounds forward* to the next open
 * day, so several consecutive offsets collapse onto the same date whenever the week's closed
 * days fall between them. Run on a Monday, offsets 7, 8 and 9 all resolve to the same
 * Wednesday — three scenarios sharing one date, each inheriting the override and the
 * generated announcement the last one left, on some days of the week and not others.
 *
 * That is also why the resulting failures kept moving: the collision depended on what day
 * the suite happened to run.
 *
 * Allocating from a list of open days makes every publishing scenario independent by
 * construction. It starts past the days the read-only option tests use, so those can keep
 * sharing one date — they never write.
 */
const OPEN_DAYS: readonly string[] = (() => {
  const days: string[] = []
  let date = addDays(todayInCopenhagen(), 5)

  while (days.length < 12) {
    if (!CLOSED_WEEKDAYS.has(weekdayOf(date))) days.push(date)
    date = addDays(date, 1)
  }

  return days
})()

/**
 * Which of {@link OPEN_DAYS} each publishing scenario owns — by **identity**, never by a
 * counter.
 *
 * The mutable counter this replaces was a hidden coupling with two failure modes, and this
 * suite hit both:
 *
 *   * **collection vs execution.** A `const date = nextOpenDay()` in a `test.describe`
 *     body runs while Playwright *collects* the file; the same line inside a `test`
 *     callback runs when the test *executes*. A counter read from both phases hands out
 *     indexes in an order no reader can see in the source.
 *   * **"one instance" is an assumption, not a fact.** Every project that collects this
 *     file evaluates it afresh — counter back at zero — so two projects running it
 *     concurrently allocate the *same* dates to *different* scenarios against one shared
 *     database. That is exactly what happened while a stale `testIgnore` let the generic
 *     desktop and mobile projects run this file (see `playwright.config.ts`).
 *
 * A fixed map has neither problem: the same scenario gets the same date in every phase, in
 * every project, in every run — alone, first, last, or repeated.
 */
const SCENARIO_DAY = {
  /** Scenario 1: nothing published → the message goes live with no sheet. */
  'ingen-eksisterende': 0,
  /** The active-conflict block: 1ae's sheet, its modal semantics, and Behold. */
  'aktiv-konflikt': 1,
  /** Replace → the green strip → Fortryd. */
  'erstat-og-fortryd': 2,
  /** A hidden message is replaced without a sheet. */
  'skjult-erstattes': 3,
  /** The checkbox cleared: hours only (§3). */
  'fravalgt': 4,
  /** §7e item 6: removing the override that owns the live message. */
  'fjern-med-besked': 5,
} as const

function scenarioDay(key: keyof typeof SCENARIO_DAY): string {
  const date = OPEN_DAYS[SCENARIO_DAY[key]]

  // Unreachable while OPEN_DAYS builds twelve entries and the map tops out at five, and
  // stated anyway: an index off the end must be a loud error, not an `undefined` date.
  if (date === undefined) throw new Error(`no open day allocated for ${key}`)

  return date
}

/** The removal control's own label — this screen's honest report of who owns the message. */
async function removalLabel(page: Page): Promise<string> {
  const control = overrideCard(page).getByRole('link', { name: /^Fjern/ })
  return ((await control.textContent()) ?? '').trim()
}

/**
 * Leave the hjemmeside showing **no announcement a guest can read**, whatever it was.
 *
 * Deliberately weaker than *"the row is empty"*, and the difference is the model's own:
 * `announcement_replacement_kind()` calls three states not-a-conflict — `none`, `hidden`
 * and `expired` — and every one of them is a fine starting point for a scenario that
 * expects no sheet. Demanding an empty row would demand the first of the three, and a row
 * left *hidden* by an earlier suite is untouched by the press below (1ad offers "Fjern
 * beskeden nu" only for a message that is published **and** visible) while being perfectly
 * valid here.
 *
 * So the press is best-effort and the **assertion is the precondition itself**, checked
 * where it is either true or not: on the public page.
 */
async function clearAnnouncement(page: Page): Promise<void> {
  await openAnnouncementAdmin(page)

  /*
   * Wait for the screen to have *arrived* before asking it a question.
   *
   * `openAnnouncementAdmin` waits for the editor form, and the visibility card streams in
   * separately — so reading `removeNowButton.isVisible()` straight after it can answer
   * "no" about a button that is still on its way. The press is then skipped, an active
   * message survives this fixture, and the scenario fails several steps later at a conflict
   * sheet that should never have been drawn.
   *
   * The state banner is rendered unconditionally on this screen, so waiting for it is the
   * cheapest true statement that the part of the page carrying the button has rendered.
   */
  await expect(stateBanner(page)).toBeVisible()

  // `pressRemoveNow` and not the one-off card's `pressAndSettle`: that one settles by
  // reading the override form's version token, and there is no override form on this screen.
  if (await removeNowButton(page).isVisible().catch(() => false)) {
    await pressRemoveNow(page)
    await openAnnouncementAdmin(page)
  }

  /*
   * And confirmed where it actually matters: **on a rendered guest page.**
   *
   * "Active" is not an admin-screen state — it is `announcement_replacement_kind()` reading
   * the published columns, and what it means is *a guest can read this right now*. The
   * administration's controls are a good hint and a poor oracle: "Fjern beskeden nu" is
   * rendered for `hasPublishedMessage && isVisible` and asks nothing about the expiry.
   *
   * `message` and not `present`: the expiry guard removes the bar's **content** and leaves
   * the labelled region mounted, precisely so a screen reader is not interrupted by a
   * region vanishing (1ac). An empty region is therefore the shape "nothing to read" takes,
   * and the region's own text is the only thing that distinguishes it from a live message.
   */
  const seen = await guestAnnouncement(browserRef)

  expect(seen.message, 'no announcement is visible to a guest').toBeNull()

  /*
   * And the administration's view as well, because the two have opposite blind spots.
   *
   * A guest page is served from the public cache. Every write that changes the bar expires
   * its tag, so the rendered page is normally current — but a page cached *before* a
   * message went live still shows nothing while the row is already active, and this fixture
   * would then hand the next scenario a conflict it did not ask for.
   *
   * "Fjern beskeden nu" is rendered for `hasPublishedMessage && isVisible`, read straight
   * from the row on every request, which is exactly the pair that makes
   * `announcement_replacement_kind()` say `active`. The state banner is waited for first so
   * this is a real check rather than a `count()` that passes because the page has not
   * finished arriving.
   */
  await expect(stateBanner(page)).toBeVisible()
  await expect(removeNowButton(page)).toHaveCount(0)
}

/**
 * Publish an ordinary, visible, manual announcement through phase 7's own path — and leave
 * a **pending draft** standing behind it.
 *
 * The draft is part of the fixture rather than an afterthought, and it is re-established
 * here because publishing is what destroys it: `saveAnnouncement()` writes the draft that
 * `publishAnnouncement()` then merges and clears. §25 asks that a pending manual
 * announcement survive every generated replace, restore and removal, so every scenario
 * that stands a manual message up also stands its unfinished successor up behind it.
 *
 * The draft carries a message only. There is a published expiry to inherit by this point,
 * so 1ad's editor accepts it — which is the difference from the empty-announcement case at
 * the top of this suite.
 */
/**
 * How many manual announcements this suite has published, so each one differs from the last.
 *
 * See {@link publishManualAnnouncement} — this is what guarantees there is something to
 * publish, which is what makes the whole helper single-branch.
 */
let manualPublishes = 0

/**
 * Publish an ordinary, visible, manual announcement through phase 7's own path — and leave
 * a **pending draft** standing behind it.
 *
 * ================= WHY THIS HAS NO BRANCHES =================
 *
 * Publishing is a **merge of a draft**, and `publish_announcement()` sets `is_visible =
 * true` as part of that merge. So there is exactly one precondition worth arranging — *a
 * draft must exist* — and once it does, the message is guaranteed to end up published **and**
 * visible whatever state the row was in before: empty, hidden, expired, or holding this very
 * message switched off.
 *
 * A draft exists only where something differs from the published row, so the expiry moves
 * five minutes on each call. That is the whole mechanism. Earlier versions of this helper
 * tried to arrange the same guarantee by clearing first, or by publishing and then pressing
 * the visibility switch when the publish turned out to be a no-op — and every one of those
 * branches depended on correctly predicting which state the previous scenario had left. When
 * a prediction was wrong the helper silently wrote nothing and reported success, and the
 * failure surfaced scenarios later as a conflict sheet that did or did not appear.
 *
 * The message itself is untouched, so scenarios still assert on the exact string they asked
 * for.
 */
async function publishManualAnnouncement(page: Page, message: string): Promise<void> {
  await openAnnouncementAdmin(page)

  manualPublishes += 1

  /*
   * `expiryChip` is not optional, and the editor says why in its own helper: *"Dato og
   * klokkeslæt bruges, når 'Vælg selv' er valgt."* The two fields are ignored unless that
   * chip is chosen, so a save that fills them and leaves the chip alone gets whichever
   * suggestion happened to be pre-selected.
   */
  await saveAnnouncement(page, {
    message,
    expiryChip: 'Vælg selv',
    // A distinct future **date** per call, so a draft always exists to publish. Minutes
    // wrapped at 60 and could repeat; a date that keeps advancing cannot.
    date: copenhagenDate(2 + manualPublishes),
    time: '20:00',
  })

  /*
   * What is staged, before publishing it.
   *
   * `pendingBand` alone is not a synchronisation point here: this helper leaves a draft
   * behind on purpose, so the band is *already* visible from the previous call and would be
   * satisfied whether or not this save changed anything. When the save produced no delta —
   * same message, same expiry — the next press published the **draft that was already
   * there**, and a guest ended up reading "Kladde C — ikke offentliggjort endnu".
   *
   * The field shows the live values with the draft merged over them, so asserting it says
   * "the thing about to be published is the thing this call asked for".
   */
  await expect(announcementForm(page).getByLabel('Besked')).toHaveValue(message)
  await expect(pendingBand(page)).toBeVisible()
  await publishAnnouncement(page)

  // The assertion that binds: a guest can read this message, now. That is what `active`
  // means to the coordinator, and it is the precondition every conflict scenario depends on.
  const live = await guestAnnouncement(browserRef)

  expect(live.message, 'the manual announcement is readable by a guest').toContain(message)

  /*
   * And a pending draft behind it. §25 asks that an unfinished manual announcement survive
   * every generated replace, restore and removal — and publishing is what destroys one, so
   * every scenario that stands a message up stands its successor up again afterwards.
   */
  await saveAnnouncement(page, { message: DRAFTED_C })
  await expect(pendingBand(page)).toBeVisible()
}

test.beforeAll(async ({ browser, playwright }) => {
  browserRef = browser
  staffPage = await (await browser.newContext()).newPage()
  await signIn(staffPage, STAFF)

  guest = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL })
})

test.afterAll(async () => {
  await guest.dispose()
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// 1. The option itself — 1t
// ---------------------------------------------------------------------------

test.describe('1t’s generated-announcement option', () => {
  test('is offered, ticked, with the generator’s own wording and expiry', async () => {
    const date = firstNormallyOpenDay(addDays(todayInCopenhagen(), 3))

    await openOverrideCard(staffPage, date)
    await fillOverride(staffPage, { date, kind: 'custom', from: '17:00', to: '19:00' })

    // §3: the option defaults ON when the generator returns something.
    await expect(announcementOption(staffPage)).toBeChecked()

    // The wording is the generator's, not the browser's idea of it.
    await expect(announcementMessage(staffPage)).toHaveValue(/^Ændrede åbningstider \w+ · 17:00–19:00$/)

    // 1t's expiry helper, computed from the *later* of the two closings (§0m).
    await expect(overrideForm(staffPage).getByText(/Udløber automatisk/)).toBeVisible()
  })

  test('follows the times until somebody edits it, and then stops', async () => {
    const date = firstNormallyOpenDay(addDays(todayInCopenhagen(), 3))

    await openOverrideCard(staffPage, date)
    await fillOverride(staffPage, { date, kind: 'custom', from: '17:00', to: '19:00' })

    // Untouched: the suggestion follows a change to the closing time.
    await overrideForm(staffPage).getByLabel('Til', { exact: true }).selectOption('18:00')
    await expect(announcementMessage(staffPage)).toHaveValue(/17:00–18:00$/)

    // Edited: it is theirs now.
    await editAnnouncementMessage(staffPage, OWN_WORDS)

    await overrideForm(staffPage).getByLabel('Til', { exact: true }).selectOption('19:30')
    await expect(announcementMessage(staffPage)).toHaveValue(OWN_WORDS)

    // And a change of *date* does not take it back either.
    await setOverrideDate(staffPage, firstNormallyOpenDay(addDays(todayInCopenhagen(), 4)))
    await expect(announcementMessage(staffPage)).toHaveValue(OWN_WORDS)
  })

  test('is absent when the change would tell guests nothing — §4’s no_effect', async () => {
    const closedDay = firstNormallyClosedDay(addDays(todayInCopenhagen(), 1))

    await openOverrideCard(staffPage, closedDay)
    await fillOverride(staffPage, { date: closedDay, kind: 'closed' })

    // Absent, not disabled: §4 forbids a checked-but-useless control.
    await expect(announcementOption(staffPage)).toHaveCount(0)
    await expect(announcementRefusal(staffPage)).toBeVisible()
  })

  test('says so when the wording would be too long, and does not truncate it', async () => {
    const date = firstNormallyOpenDay(addDays(todayInCopenhagen(), 3))

    await openOverrideCard(staffPage, date)
    await fillOverride(staffPage, { date, kind: 'custom', from: '17:00', to: '19:00' })

    const tooLong = 'x'.repeat(120)
    await editAnnouncementMessage(staffPage, tooLong)

    // The field keeps every character — nothing is silently cut to fit.
    await expect(announcementMessage(staffPage)).toHaveValue(tooLong)
    await expect(overrideForm(staffPage).getByText(/højst være 90/)).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 2. No existing announcement — §9, and no sheet
// ---------------------------------------------------------------------------

test('with nothing published, the message goes live and no sheet is shown', async () => {
  const date = scenarioDay('ingen-eksisterende')

  await removeAllOverrides(staffPage)
  await clearAnnouncement(staffPage)

  /*
   * A pending manual draft stands behind everything from here on: it must be
   * byte-identical after every write in this suite (§25).
   *
   * It carries an expiry as well as a message, because 1ad's editor refuses a draft that
   * could never be published — and with nothing published there is no existing expiry for
   * it to inherit.
   */
  await saveAnnouncement(staffPage, {
    message: DRAFTED_C,
    expiryChip: 'Vælg selv',
    date: copenhagenDate(3),
    time: '20:00',
  })
  await expect(pendingBand(staffPage)).toBeVisible()

  await openOverrideCard(staffPage, date)
  await fillOverride(staffPage, { date, kind: 'custom', from: '17:00', to: '19:00' })

  const suggested = await announcementMessage(staffPage).inputValue()
  await saveAndPublishOverride(staffPage, { announcement: true })

  // No question was asked, because nothing a guest could read was in the way.
  await expect(conflictSheet(staffPage)).toHaveCount(0)
  await expect(overrideStateBadge(staffPage)).toHaveText('På hjemmesiden')

  // The first guest request already has both halves.
  const seen = await guestGet('/')
  expect(seen.html).toContain(suggested)

  // The override owns it, and the screen says so in the only place it can.
  await openOverrideCard(staffPage, date)
  expect(await removalLabel(staffPage)).toBe('Fjern ændring og besked')

  // The draft nobody published is exactly where it was left.
  await openAnnouncementAdmin(staffPage)
  await expect(pendingBand(staffPage)).toBeVisible()
})

// ---------------------------------------------------------------------------
// 3. §24 — "Behold eksisterende besked"
// ---------------------------------------------------------------------------

test.describe('an active manual announcement is in the way', () => {
  test.beforeAll(async () => {
    // Clear whatever the previous scenario left, then stand a real manual message up.
    await removeAllOverrides(staffPage)
    await publishManualAnnouncement(staffPage, MANUAL_A)
  })

  test('the hours go public first, and only then is the question asked', async () => {
    const date = scenarioDay('aktiv-konflikt')

    await openOverrideCard(staffPage, date)
    await fillOverride(staffPage, { date, kind: 'closed' })

    await expect(announcementOption(staffPage)).toBeChecked()
    const proposed = await announcementMessage(staffPage).inputValue()

    await saveAndPublishOverride(staffPage, { announcement: true })

    // §7e item 8, asserted in the order it happens: the sheet is on screen, and the hours
    // are ALREADY public behind it.
    await expect(conflictSheet(staffPage)).toBeVisible()

    const duringSheet = await guestGet('/find-os')
    expect(duringSheet.html).toContain('Lukket')
    // …and the manual message is still the one a guest reads, because nothing was decided.
    expect(duringSheet.html).toContain(MANUAL_A)

    // 1ae draws both messages, from the server's own reading of each.
    const shown = await conflictMessages(staffPage)
    expect(shown.current).toBe(MANUAL_A)
    expect(shown.proposed).toBe(proposed)
  })

  test('the sheet is a real modal: no backdrop dismissal, and Escape decides nothing', async () => {
    await expect(conflictSheet(staffPage)).toBeVisible()

    // Focus starts on the choice that changes nothing a guest can read.
    await expect(keepExistingButton(staffPage)).toBeFocused()

    // §11: Escape must not stand in for either answer, and must not close the question.
    await staffPage.keyboard.press('Escape')
    await expect(conflictSheet(staffPage)).toBeVisible()

    // A click outside the sheet reaches the backdrop and resolves nothing.
    await staffPage.mouse.click(4, 4)
    await expect(conflictSheet(staffPage)).toBeVisible()

    /*
     * The trap: Tab cycles between the two labelled ways out and never leaves.
     *
     * Focus is put back on a known control first, because the backdrop click above moved
     * it to the dialog itself — which is the platform behaving correctly, and would make a
     * Tab count starting from "wherever we happen to be" meaningless.
     */
    await keepExistingButton(staffPage).focus()

    await staffPage.keyboard.press('Tab')
    await expect(replaceButton(staffPage)).toBeFocused()

    await staffPage.keyboard.press('Shift+Tab')
    await expect(keepExistingButton(staffPage)).toBeFocused()

    /*
     * And the half that actually makes it a trap: **the page behind cannot take focus at
     * all.**
     *
     * Asserted this way rather than by counting Tab presses until they wrap. A native
     * `<dialog>` opened with `showModal()` does not cycle focus within itself — past the
     * last control the keyboard goes to the browser's own UI — so a wrap assertion would be
     * testing a behaviour the platform never promised. What it *does* promise is
     * inertness, and that is the property §11 is about: even a direct `focus()` call on the
     * control the sheet was opened from leaves the keyboard where it was.
     */
    const behindTookFocus = await staffPage.evaluate(() => {
      const behind = document.getElementById('enkelt-aendring-offentliggoer')
      behind?.focus()
      return document.activeElement === behind
    })

    expect(behindTookFocus, 'the page behind the sheet is inert').toBe(false)
    await expect(keepExistingButton(staffPage)).toBeFocused()
  })

  test('the sheet has no accessibility violations, and no overflow at this width', async () => {
    await expect(conflictSheet(staffPage)).toBeVisible()

    expect(await axeViolations(staffPage)).toEqual([])
    expect(await smallTargets(staffPage)).toEqual([])

    // The footer stacks below `md` and becomes a row above it; neither may push the page
    // sideways.
    const overflow = await staffPage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )

    expect(overflow).toBe(false)
  })

  test('and none at 768 either, where its footer changes direction', async () => {
    /*
     * §27 asks for 375, 768 and 1440. The two Playwright projects give the outer pair; 768
     * is the step in between, and it is exactly where this sheet's footer switches from a
     * stacked column to a right-aligned row — so it is the width most likely to produce a
     * wrapped button or a sheet wider than the screen.
     *
     * Measured with the sheet already open, and the project's own width restored
     * afterwards, because every other assertion in this file is about that width.
     */
    const projectViewport = staffPage.viewportSize()

    await staffPage.setViewportSize({ width: 768, height: 1024 })
    await expect(conflictSheet(staffPage)).toBeVisible()

    const overflow = await staffPage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )

    expect(overflow).toBe(false)
    expect(await smallTargets(staffPage)).toEqual([])

    // Both labels stay on one line — the defect the phase-6 completion pass found twice at
    // this exact width.
    for (const control of [keepExistingButton(staffPage), replaceButton(staffPage)]) {
      const box = await control.boundingBox()
      expect(box?.height ?? 0).toBeLessThan(72)
    }

    if (projectViewport !== null) await staffPage.setViewportSize(projectViewport)
  })

  test('Behold eksisterende besked keeps the message and the new hours', async () => {
    await resolveConflict(staffPage, 'keep')

    // 1ae's own promised sentence.
    await expect(staffPage.getByRole('status').filter({ hasText: 'Beskeden blev ikke oprettet' })).toBeVisible()

    // The hours stayed published — a "Behold" cannot roll them back.
    await expect(overrideStateBadge(staffPage)).toHaveText('På hjemmesiden')

    // The manual message is byte-identical, and it is still what a guest reads.
    const seen = await guestGet('/')
    expect(seen.html).toContain(MANUAL_A)

    // No ownership moved: the override owns nothing, so removal offers the plain sentence.
    expect(await removalLabel(staffPage)).toBe('Fjern ændringen fra hjemmesiden')

    // §12: the checkbox is cleared, exactly as 1ae says.
    await expect(announcementOption(staffPage)).not.toBeChecked()

    // And no Fortryd is offered, because nothing was replaced.
    await expect(announcementUndoStrip(staffPage)).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// 4. §24 — "Erstat med den nye besked", and Fortryd
// ---------------------------------------------------------------------------

test.describe('replacing the active message, and putting it back', () => {
  const date = scenarioDay('erstat-og-fortryd')
  let proposed = ''

  test('the generated message replaces it on the first guest request', async () => {
    await openOverrideCard(staffPage, date)
    await fillOverride(staffPage, { date, kind: 'custom', from: '13:00', to: '16:00' })

    await setAnnouncementWanted(staffPage, true)
    await editAnnouncementMessage(staffPage, OWN_WORDS)
    proposed = OWN_WORDS

    await saveAndPublishOverride(staffPage, { announcement: true })
    await expect(conflictSheet(staffPage)).toBeVisible()

    await resolveConflict(staffPage, 'replace')

    // The first request, not the one after it.
    const seen = await guestGet('/')
    expect(seen.html).toContain(proposed)
    expect(seen.html).not.toContain(MANUAL_A)

    // Ownership moved to this override.
    expect(await removalLabel(staffPage)).toBe('Fjern ændring og besked')

    // The hours are the new ones.
    await expect(overrideStateBadge(staffPage)).toHaveText('På hjemmesiden')
  })

  test('a green Fortryd strip is offered, and it does not take focus', async () => {
    await expect(announcementUndoStrip(staffPage)).toBeVisible()

    /*
     * 1aa: *"De stjæler aldrig tastaturfokus."* The strip is announced by its own
     * `role="status"`, which is polite by definition, and the keyboard is left wherever it
     * already was — which, on this screen, is the control 1ae was opened from.
     */
    await expect(announcementUndoStrip(staffPage)).toHaveAttribute('role', 'status')

    const focusedInsideStrip = await announcementUndoStrip(staffPage).evaluate(
      (element) => element.contains(document.activeElement),
    )

    expect(focusedInsideStrip, 'the strip did not take the keyboard').toBe(false)

    expect(await axeViolations(staffPage)).toEqual([])
    expect(await smallTargets(staffPage)).toEqual([])
  })

  test('focus came back to the control the sheet was opened from', async () => {
    /*
     * §11: a dialog that takes focus owes it back.
     *
     * Both ways out of 1ae are *soft* navigations — a `<Link>` and a Server Action's
     * `redirect()` — so a fragment would move the URL without moving the keyboard.
     * `ModalDialog` focuses the named control as it unmounts instead, and this is the
     * assertion that would notice if that stopped happening.
     */
    await expect(
      overrideForm(staffPage).getByRole('button', { name: 'Gem og offentliggør' }),
    ).toBeFocused()
  })

  test('Fortryd puts the manual message back, and leaves the hours changed', async () => {
    await pressAnnouncementUndo(staffPage)

    // The first request again.
    const seen = await guestGet('/')
    expect(seen.html).toContain(MANUAL_A)
    expect(seen.html).not.toContain(proposed)

    // Ownership is manual again — the override owns nothing.
    await openOverrideCard(staffPage, date)
    expect(await removalLabel(staffPage)).toBe('Fjern ændringen fra hjemmesiden')

    // And the hours never moved through any of it.
    await expect(overrideStateBadge(staffPage)).toHaveText('På hjemmesiden')
    const hours = await guestGet('/find-os')
    expect(hours.html).toContain('13:00')
  })

  test('the pending manual draft survived the whole exchange', async () => {
    await openAnnouncementAdmin(staffPage)
    await expect(pendingBand(staffPage)).toBeVisible()
  })
})

/*
 * ---------------------------------------------------------------------------
 * WHERE THE TWO CONCURRENCY CASES WENT — an intentional substitution, not a gap
 * ---------------------------------------------------------------------------
 *
 * §25 lists *"stale announcement while conflict sheet open"* and *"stale override while
 * conflict sheet open"*. Neither is asserted in this file, and that is a decision rather
 * than an omission.
 *
 * They are **concurrency and atomicity guarantees**, and the browser is the weakest place
 * to assert one. What a screen can show is that a refusal appeared; what actually matters
 * is what the database did *not* do. `supabase/tests/017_generated_announcement.test.sql`
 * asserts both from real Staff JWTs, and asserts four things this suite could only infer:
 *
 *   * the operation answers `stale_announcement` / `stale_override`;
 *   * the **whole affected row** is byte-identical afterwards (`row_state()`);
 *   * **no audit row** was written — a refusal is not an event;
 *   * **no partial ownership mutation** — `source` and `source_override_id` did not move
 *     apart from each other.
 *
 * The mapping from those two statuses to what a person is shown — the code the address
 * carries, the sentence, the warning tone, and the fact that the hours' own outcome rides
 * through unchanged beside it — is asserted deterministically in
 * `tests/unit/announcements/generated-suggestion.test.ts`.
 *
 * The E2E versions were removed after they proved the point against themselves: driving two
 * browser contexts at one singleton, the colleague's write repeatedly landed *before* the
 * sheet existed, so the coordinator correctly saw no conflict and applied — a different,
 * equally valid branch, asserted as though it were the stale one. A test that can silently
 * exercise the wrong branch is worse than no test, and the branch it was meant to cover is
 * covered better one layer down.
 */

// ---------------------------------------------------------------------------
// 6. The states that are not a conflict — §25
// ---------------------------------------------------------------------------

test.describe('a message that no guest can read is not a conflict', () => {
  test('a hidden announcement is replaced without a sheet', async () => {
    await removeAllOverrides(staffPage)

    // Switch the manual message off: valid, unexpired, but not showing.
    await openAnnouncementAdmin(staffPage)
    await expect(visibilityCard(staffPage)).toBeVisible()
    await pressVisibilitySwitch(staffPage)

    const date = scenarioDay('skjult-erstattes')
    await openOverrideCard(staffPage, date)
    await fillOverride(staffPage, { date, kind: 'closed' })

    const proposed = await announcementMessage(staffPage).inputValue()
    await saveAndPublishOverride(staffPage, { announcement: true })

    // No question: a hidden message is not something a guest is reading.
    await expect(conflictSheet(staffPage)).toHaveCount(0)

    const seen = await guestGet('/')
    expect(seen.html).toContain(proposed)

    // The displaced state is stashed all the same, so Fortryd can put back the *hidden*
    // message exactly as it stood — switched off.
    await pressAnnouncementUndo(staffPage)

    await openAnnouncementAdmin(staffPage)
    await expect(stateBanner(staffPage)).toContainText(/[Ss]lået fra|ikke synlig|Skjult/)
  })
})

// ---------------------------------------------------------------------------
// 7. The checkbox turned off — §3
// ---------------------------------------------------------------------------

test('with the option cleared, only the hours are published', async () => {
  await removeAllOverrides(staffPage)
  await publishManualAnnouncement(staffPage, MANUAL_A)

  const date = scenarioDay('fravalgt')

  await openOverrideCard(staffPage, date)
  await fillOverride(staffPage, { date, kind: 'closed' })

  // Cleared through the control a person would use, and asserted to be clear, so this
  // scenario tests §3's "the person may turn it off" rather than the helper's default.
  await setAnnouncementWanted(staffPage, false)

  await saveAndPublishOverride(staffPage)

  // No sheet, no message, no ownership — and the hours are live.
  await expect(conflictSheet(staffPage)).toHaveCount(0)
  await expect(overrideStateBadge(staffPage)).toHaveText('På hjemmesiden')
  expect(await removalLabel(staffPage)).toBe('Fjern ændringen fra hjemmesiden')

  const seen = await guestGet('/')
  expect(seen.html).toContain(MANUAL_A)
})

// ---------------------------------------------------------------------------
// 8. §7e item 6 — removing an override that owns the message
// ---------------------------------------------------------------------------

test.describe('removing the override that owns the generated message', () => {
  const date = scenarioDay('fjern-med-besked')

  test('the confirmation names both, and takes both away', async () => {
    await openOverrideCard(staffPage, date)
    await fillOverride(staffPage, { date, kind: 'custom', from: '12:00', to: '14:00' })

    const proposed = await announcementMessage(staffPage).inputValue()
    await saveAndPublishOverride(staffPage, { announcement: true })

    // There is an active manual message, so this one needs confirming.
    if (await conflictSheet(staffPage).isVisible()) {
      await resolveConflict(staffPage, 'replace')
    }

    expect((await guestGet('/')).html).toContain(proposed)

    // The removal control says what it will do, before it is pressed.
    await openOverrideCard(staffPage, date)
    expect(await removalLabel(staffPage)).toBe('Fjern ændring og besked')

    // The confirmation that names both halves, scanned before it is answered.
    await overrideCard(staffPage).getByRole('link', { name: /^Fjern/ }).click()
    await expect(
      staffPage.getByRole('button', { name: /^Ja — fjern ændring og besked/i }),
    ).toBeVisible()

    expect(await axeViolations(staffPage)).toEqual([])
    expect(await smallTargets(staffPage)).toEqual([])

    await pressAndSettle(staffPage, () =>
      staffPage.getByRole('button', { name: /^Ja — fjern ændring og besked/i }).click(),
    )

    // Both halves are gone, and the screen says so as one sentence.
    await expect(
      staffPage.getByRole('status').filter({ hasText: 'Ændringen og beskeden er fjernet' }),
    ).toBeVisible()

    const seen = await guestGet('/')
    expect(seen.html).not.toContain(proposed)

    // Not merely hidden: there is nothing left that could be switched back on.
    await openAnnouncementAdmin(staffPage)
    await expect(visibilityCard(staffPage)).toHaveCount(0)
  })

  test('and the pending manual draft is still there', async () => {
    await openAnnouncementAdmin(staffPage)
    await expect(pendingBand(staffPage)).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 9. The state the next run starts from
// ---------------------------------------------------------------------------

test('the seed is left as every announcement suite leaves it', async () => {
  await removeAllOverrides(staffPage)

  await openOverrideCard(staffPage)
  await expect(overrideCard(staffPage).getByText('Der er ingen ændringer')).toBeVisible()

  await openAnnouncementAdmin(staffPage)

  // Published and expired, switched off, nothing pending.
  await saveAnnouncement(staffPage, {
    message: MANUAL_A,
    expiryChip: 'Vælg selv',
    date: copenhagenDate(1),
    time: '20:00',
  })
  await publishAnnouncement(staffPage)

  // `pressRemoveNow` and not the one-off card's `pressAndSettle`: that one settles by
  // reading the override form's version token, and there is no override form on this screen.
  await pressRemoveNow(staffPage)

  await openAnnouncementAdmin(staffPage)
  await expect(pendingBand(staffPage)).toHaveCount(0)
})
