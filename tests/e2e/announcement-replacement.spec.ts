import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { signIn, STAFF } from './support/admin'
import {
  announcementForm,
  copenhagenDate,
  openAnnouncementAdmin,
  pendingBand,
  publishAnnouncement,
  removeNowButton,
  saveAnnouncement,
} from './support/announcement-admin'

/**
 * Replacing the published announcement, and putting the previous one back — phase 8C-1;
 * technical plan §4, §6, §7e item 8; design 1ae.
 *
 * The promise this suite exists for, in §6's own words: **the old announcement is stashed,
 * the new one is live, and Fortryd puts the old one back — and each of those lands on the
 * *first* guest request, not the one after it.**
 *
 *     admin    a published, live message A            (this suite publishes it)
 *     public   A
 *     server   replace A with B                       (the 8C-1 mechanism)
 *     public   B, on the first request
 *     server   restore
 *     public   A, on the first request
 *
 * And the same story with a pending manual draft C behind it, because that is the
 * property the mechanism most easily gets wrong: a replacement operates on *published*
 * content, so somebody's unfinished draft must be exactly where they left it, before and
 * after.
 *
 * WHY THERE IS NO SCREEN IN THIS SUITE
 *
 * There is no replacement control in the administration, by design: `/admin/besked` is
 * phase 7's editor, unchanged, and 1ae's conflict sheet is **8C-3**. The two Server
 * Actions driven here live at an unlinked address behind an environment flag
 * (`app/(admin)/admin/intern/besked-erstatning/`), which exists only because
 * `updateTag()` — the real cache path this suite has to prove — may only be called from
 * inside a Server Action. That directory is deleted by 8C-3. See its `harness.ts` for the
 * full reasoning and for what keeps it safe.
 *
 * The last two scenarios are therefore boundary assertions rather than replacement ones:
 * the ordinary editor offers no replacement, and a signed-out visitor cannot reach the
 * harness.
 *
 * ONE WIDTH, because nothing here is about layout: the assertions are on the bytes a
 * guest is served and on the state of a form, which are the same at every size. 8C-3
 * brings 1ae, and 1ae brings the two widths with it.
 *
 * WHAT THIS SUITE LEAVES BEHIND
 *
 * The same state `announcement.spec.ts` and `announcement-remove.spec.ts` each leave and
 * start from: **published and expired, switched off, with nothing pending**, so a guest
 * reads nothing and Offentliggør is greyed out. The last scenario produces it honestly
 * rather than by tidying up — it is the expired-previous case, which ends with a restored
 * announcement whose expiry the restore deliberately did not move.
 *
 * **Every date is computed from today.** A suite that hard-coded one would pass this
 * month and fail the next.
 */

test.describe.configure({ mode: 'serial' })

const HARNESS_PATH = '/admin/intern/besked-erstatning'

const MESSAGE_A = 'Besked A — den der stod der i forvejen'
const MESSAGE_B = 'Testbesked B fra erstatningsmekanismen'
const MESSAGE_D = 'Testbesked D fra erstatningsmekanismen'
const DRAFTED_C = 'Kladde C — ikke offentliggjort endnu'

const EXPIRY_DATE = copenhagenDate(1)
const EXPIRY_TIME = '20:00'

let staffPage: Page
let guest: APIRequestContext

/**
 * What a guest's request was answered from.
 *
 * `STALE` is the one this suite must never see after a replacement or a restore: it
 * means the cached page was served *and* a fresh one rendered behind it, which turns
 * §6's "the next request shows it" into "the request after next".
 */
type GuestResponse = {
  readonly status: number
  readonly cacheState: string | undefined
  readonly html: string
}

/** One request from nobody in particular: no session, no cookie, no browser cache. */
async function guestGet(path = '/'): Promise<GuestResponse> {
  const response = await guest.get(path)

  return {
    status: response.status(),
    cacheState: response.headers()['x-nextjs-cache'],
    html: await response.text(),
  }
}

/** The version token the harness page currently carries — the row's own `updated_at`. */
async function harnessVersion(): Promise<string> {
  return staffPage.locator('input[name="version"]').first().inputValue()
}

async function openHarness(): Promise<void> {
  await staffPage.goto(HARNESS_PATH)
  await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText(
    'Intern erstatningstest',
  )
}

/** Press one of the harness's two controls and wait until the server has answered. */
async function pressHarness(name: string): Promise<void> {
  const before = await harnessVersion()

  await staffPage.getByRole('button', { name }).click()

  await expect
    .poll(
      async () => {
        try {
          if ((await harnessVersion()) !== before) return true
        } catch {
          return false
        }
        return /[?&]status=(?!replaced|restored)/.test(staffPage.url())
      },
      { message: 'the press never reached the server' },
    )
    .toBe(true)
}

test.beforeAll(async ({ browser, playwright }) => {
  staffPage = await (await browser.newContext()).newPage()
  await signIn(staffPage, STAFF)

  guest = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL })
})

test.afterAll(async () => {
  await guest.dispose()
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// 1. A published announcement to replace
// ---------------------------------------------------------------------------

test('a message is published through the ordinary path, and a guest reads it', async () => {
  await openAnnouncementAdmin(staffPage)

  await saveAnnouncement(staffPage, {
    message: MESSAGE_A,
    link: 'Intet link',
    linkLabel: '',
    expiryChip: 'Vælg selv',
    date: EXPIRY_DATE,
    time: EXPIRY_TIME,
  })

  await publishAnnouncement(staffPage)

  const first = await guestGet()
  expect(first.status).toBe(200)
  expect(first.html).toContain(MESSAGE_A)
})

// ---------------------------------------------------------------------------
// 2. The proof the phase exists for
// ---------------------------------------------------------------------------

test('a replacement lands on the first guest request, and so does the restore', async () => {
  await openHarness()

  await pressHarness('Erstat med B')

  // The server said what it displaced, from the row it read — not from anything the
  // browser claimed was there.
  expect(staffPage.url()).toContain('status=replaced')
  expect(staffPage.url()).toContain('replaced=active')

  /*
   * ONE request. Not a poll, not a second attempt. `updateTag('announcement')` expires
   * the tagged read rather than marking it stale, so the next request for any page that
   * used it is a blocking re-render — which is what makes "the guest sees the new
   * message at once" true rather than approximately true.
   */
  const afterReplace = await guestGet()
  expect(afterReplace.cacheState, 'the first request after a replacement is not stale').not.toBe(
    'STALE',
  )
  expect(afterReplace.html).toContain(MESSAGE_B)
  expect(afterReplace.html).not.toContain(MESSAGE_A)

  // The replacement carried the source a server-side caller passed, from the closed
  // vocabulary phase 7 deliberately left unused.
  await expect(staffPage.locator('output')).toHaveAttribute(
    'data-harness-source',
    'opening_hours',
  )

  await pressHarness('Sæt tilbage')

  expect(staffPage.url()).toContain('status=restored')
  expect(staffPage.url()).toContain('showable=1')

  const afterRestore = await guestGet()
  expect(afterRestore.cacheState, 'the first request after a restore is not stale').not.toBe(
    'STALE',
  )
  expect(afterRestore.html).toContain(MESSAGE_A)
  expect(afterRestore.html).not.toContain(MESSAGE_B)

  // One level only: there is nothing behind the restore to step back to.
  await pressHarness('Sæt tilbage')
  expect(staffPage.url()).toContain('status=nothing_to_restore')
})

// ---------------------------------------------------------------------------
// 3. A pending manual draft survives both directions
// ---------------------------------------------------------------------------

test('a pending draft is untouched by a replacement and by the restore', async () => {
  await openAnnouncementAdmin(staffPage)

  // Draft C: written, saved, and deliberately not published.
  await saveAnnouncement(staffPage, { message: DRAFTED_C })
  await expect(pendingBand(staffPage)).toBeVisible()
  await expect(pendingBand(staffPage)).toContainText('beskeden')

  // A guest still reads the published message, because a draft is not published content.
  expect((await guestGet()).html).toContain(MESSAGE_A)

  await openHarness()
  await pressHarness('Erstat med B')

  const afterReplace = await guestGet()
  expect(afterReplace.cacheState).not.toBe('STALE')
  expect(afterReplace.html).toContain(MESSAGE_B)
  // The draft never became public. A replacement is not a publish.
  expect(afterReplace.html).not.toContain(DRAFTED_C)

  // And it is exactly where it was left: still pending, still showing C in the field.
  await openAnnouncementAdmin(staffPage)
  await expect(pendingBand(staffPage)).toBeVisible()
  await expect(announcementForm(staffPage).getByLabel('Besked')).toHaveValue(DRAFTED_C)

  await openHarness()
  await pressHarness('Sæt tilbage')

  const afterRestore = await guestGet()
  expect(afterRestore.cacheState).not.toBe('STALE')
  expect(afterRestore.html).toContain(MESSAGE_A)
  expect(afterRestore.html).not.toContain(DRAFTED_C)

  await openAnnouncementAdmin(staffPage)
  await expect(pendingBand(staffPage)).toBeVisible()
  await expect(announcementForm(staffPage).getByLabel('Besked')).toHaveValue(DRAFTED_C)

  // Take the draft back out the ordinary way — an edit returned to the published value
  // stops being pending (§4), so nothing is left over for the next scenario.
  await saveAnnouncement(staffPage, { message: MESSAGE_A })
  await expect(pendingBand(staffPage)).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// 4. The boundary: no replacement control anywhere in the administration
// ---------------------------------------------------------------------------

test('the ordinary editor offers no replacement, and no source selector', async () => {
  await openAnnouncementAdmin(staffPage)

  const screen = await staffPage.content()

  for (const forbidden of ['Erstat', 'Behold eksisterende', 'opening_hours', 'Kilde']) {
    expect(screen, `1ad's editor does not mention "${forbidden}"`).not.toContain(forbidden)
  }

  // 1ad's own three controls, and only those, still act on the announcement.
  await expect(staffPage.getByRole('button', { name: 'Gem' })).toBeVisible()
  await expect(removeNowButton(staffPage)).toBeVisible()
})

test('the opening-hours screen offers no announcement control', async () => {
  await staffPage.goto('/admin/aabningstider')

  const screen = await staffPage.content()

  for (const forbidden of [
    'Vis også som besked',
    'Foreslået besked',
    'Erstat med den nye besked',
  ]) {
    expect(screen, `1t's card does not mention "${forbidden}" yet — that is 8C-2/8C-3`).not.toContain(
      forbidden,
    )
  }
})

test('the harness is not reachable without a staff session', async () => {
  const response = await guest.get(HARNESS_PATH, { maxRedirects: 0 })

  // `requireStaff()` runs before anything else on the page, exactly as it does on every
  // other admin address. The flag is not the authorization.
  expect([302, 303, 307]).toContain(response.status())
  expect(response.headers()['location']).toContain('/admin/login')
})

// ---------------------------------------------------------------------------
// 5. An expiry that passes while the previous announcement is stashed
// ---------------------------------------------------------------------------

/**
 * The decision the plan requires, walked end to end: **the restore does not extend the
 * expiry**.
 *
 * A previous announcement whose expiry passes inside the ~10 seconds Fortryd is offered
 * is restored exactly as it stood — which produces an announcement that is immediately
 * ineligible for public display. That is accepted, because it is the faithful restore of
 * the previous state, and the administration says so rather than reporting a success a
 * visitor would contradict.
 *
 * The expiry is set to the next whole minute plus one, so the wait is between 60 and 120
 * seconds — the same technique `announcement-remove.spec.ts` uses for the same reason: the
 * editor's own control has minute granularity, and no shortcut round it would be testing
 * the real path.
 *
 * It ends by switching the bar off, which leaves the state the next run starts from.
 */
test('an expired previous announcement is restored without its expiry being moved', async () => {
  test.setTimeout(240_000)

  const soon = new Date(Date.now() + 90_000)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(soon)
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? ''

  await openAnnouncementAdmin(staffPage)
  await saveAnnouncement(staffPage, {
    message: MESSAGE_A,
    expiryChip: 'Vælg selv',
    date: copenhagenDate(0),
    time: `${read('hour')}:${read('minute')}`,
  })
  await publishAnnouncement(staffPage)

  // Replace it while it is still current, so the snapshot is of a live announcement.
  await openHarness()
  await pressHarness('Erstat med D')
  expect(staffPage.url()).toContain('replaced=active')

  expect((await guestGet()).html).toContain(MESSAGE_D)

  // Let the stashed announcement expire underneath the offer.
  await expect
    .poll(() => Date.now() >= soon.getTime() + 5_000, {
      message: 'waiting for the stashed announcement to expire',
      timeout: 150_000,
      intervals: [2_000],
    })
    .toBe(true)

  await openHarness()
  await pressHarness('Sæt tilbage')

  // The restore succeeded — the previous state is a fact, not a request to show
  // something — and it reports honestly that no guest can read the result.
  expect(staffPage.url()).toContain('status=restored')
  expect(staffPage.url()).toContain('showable=0')

  const afterRestore = await guestGet('/en-side-der-ikke-findes')
  expect(afterRestore.html).not.toContain(MESSAGE_A)
  expect(afterRestore.html).not.toContain(MESSAGE_D)

  // Nothing extended the expiry to make the undo visible: the editor says the message is
  // expired, in its own words.
  await openAnnouncementAdmin(staffPage)
  await expect(staffPage.getByRole('banner')).toContainText('Udløbet')
  await expect(pendingBand(staffPage)).toHaveCount(0)

  // The state the next run starts from: published, expired, switched off, nothing
  // pending — the same one `announcement.spec.ts` leaves.
  await removeNowButton(staffPage).click()
  await staffPage.waitForURL(/status=|fortryd_version=/)

  await openAnnouncementAdmin(staffPage)
  await expect(pendingBand(staffPage)).toHaveCount(0)
})
