import { expect, test, type Browser, type Page } from '@playwright/test'

import { RATE_LIMIT_MESSAGE, RATE_LIMIT_SCOPES } from '@/lib/rate-limit/scopes'
import { deriveClientSubject, LOCAL_CLIENT_ADDRESS, normalizeAccountAddress } from '@/lib/rate-limit/subject'

import {
  clearLocalRateLimits,
  fillLocalRateLimit,
  listLocalProfiles,
  listLocalRateLimitBuckets,
} from '../support/local-auth-admin'

import { OWNER, saveDraft, signIn, STAFF } from './support/admin'
import {
  deleteImageNamed,
  gridCard,
  jpegFixture,
  openImagesAdmin,
  uploadInput,
  uploadStatus,
  uploadViaUi,
} from './support/images-admin'
import { openDish } from './support/menu-admin'

/**
 * Security hardening, the stories that write — phase 13B (brief §39, §44, §45).
 *
 * Serial, last in the chain, and every counter it fills it empties again. Three
 * stories:
 *
 *   1. **The CSP under a real upload.** The uploader downscales in the browser,
 *      PUTs to the signed Storage URL (the one `connect-src` exception), finalises,
 *      and the new photograph renders from the Storage origin (the `img-src`
 *      exception) — in the library and in the menu editor's picker — with the
 *      console watched. Then the image is removed, so the seed is as found.
 *
 *   2. **A limited action is refused, understandably, and changes nothing.** The
 *      counter is put at its threshold through the loopback-only test door — the
 *      same state a flood would leave — so the story needs one request, not
 *      hundreds (the thresholds themselves are pgTAP `029`'s). Both shapes of
 *      refusal: the reply an uploader shows in place, and the redirect a form
 *      lands on with the shared notice.
 *
 *   3. **The sign-in throttle.** Ten failures against an address that does not
 *      exist, then the eleventh attempt is refused before the Auth server is asked
 *      — with a sentence that says nothing about the address — and, once the
 *      counters are emptied, the seeded staff member signs in as usual, and that
 *      successful sign-in leaves no failure behind (the 13B closure: reserved,
 *      then released).
 *
 *   4. **The threshold under simultaneous attempts** (the 13B closure). With two
 *      allowances left, six browsers submit a wrong password at the same moment
 *      through the real Server Action: exactly two are answered by the Auth
 *      server and four are refused by the application, whatever the timing, and
 *      the counter holds exactly the tier.
 */

test.describe.configure({ mode: 'serial' })

const FIXTURE = 'sikkerhed-foto.jpg'

async function staffUserId(): Promise<string> {
  const staff = (await listLocalProfiles()).find((profile) => profile.role === 'staff' && profile.disabledAt === null)
  if (!staff) throw new Error('The seeded staff profile is missing (run `npm run db:users`).')
  return staff.userId
}

async function ownerUserId(): Promise<string> {
  const owner = (await listLocalProfiles()).find((profile) => profile.role === 'owner' && profile.disabledAt === null)
  if (!owner) throw new Error('The seeded owner profile is missing (run `npm run db:users`).')
  return owner.userId
}

function watchViolations(page: Page): string[] {
  const seen: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') seen.push(`${page.url()} :: ${message.text()}`)
  })
  page.on('pageerror', (error) => seen.push(`${page.url()} :: pageerror ${error.message}`))
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? ''
    if (!reason.includes('ERR_ABORTED')) seen.push(`${page.url()} :: requestfailed ${request.url()} ${reason}`)
  })
  return seen
}

test.beforeAll(async () => {
  await clearLocalRateLimits()
})

test.afterAll(async () => {
  await clearLocalRateLimits()
})

// ---------------------------------------------------------------------------
// 1. The CSP under a real upload, the library and the picker
// ---------------------------------------------------------------------------

test('a staff member uploads a photograph, sees it in the library and the picker, and removes it — with no CSP violation', async ({
  page,
}) => {
  const violations = watchViolations(page)

  await signIn(page, STAFF)
  await openImagesAdmin(page)

  await uploadViaUi(page, { name: FIXTURE, mimeType: 'image/jpeg', buffer: await jpegFixture(1600, 1200) })
  await page.waitForLoadState('networkidle')

  // The new derivative renders from the Storage origin — the `img-src` exception.
  const card = gridCard(page, /sikkerhed-foto/)
  await expect(card).toBeVisible()
  const thumbnail = card.locator('img').first()
  await expect(thumbnail).toBeVisible()
  expect(await thumbnail.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)

  // The picker in the menu editor shows the same photograph.
  await openDish(page, 'Burgere', 'Thor')
  const picker = new URL(page.url())
  picker.searchParams.set('vaelg_billede', '1')
  await page.goto(picker.pathname + picker.search)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('dialog[open]')).toBeVisible()
  await expect(page.locator('dialog[open]').getByRole('button', { name: FIXTURE })).toBeVisible()

  await deleteImageNamed(page, /sikkerhed-foto/)
  await page.waitForLoadState('networkidle')
  await expect(gridCard(page, /sikkerhed-foto/)).toHaveCount(0)

  expect(violations, violations.join('\n')).toEqual([])
})

// ---------------------------------------------------------------------------
// 2. A limited action is refused, understandably, and changes nothing
// ---------------------------------------------------------------------------

test('an upload beyond the tier is refused in place, and no image is created', async ({ page }) => {
  await signIn(page, STAFF)
  await openImagesAdmin(page)
  const before = await page.getByRole('main').locator('img').count()

  await fillLocalRateLimit('image:upload-request', await staffUserId(), RATE_LIMIT_SCOPES['image:upload-request'].maxHits)

  await uploadInput(page).setInputFiles({
    name: FIXTURE,
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(800, 600),
  })

  await expect(uploadStatus(page)).toContainText(RATE_LIMIT_MESSAGE, { timeout: 15_000 })
  expect(page.url()).not.toMatch(/status=uploadet/)

  await page.reload()
  await page.waitForLoadState('networkidle')
  expect(await page.getByRole('main').locator('img').count()).toBe(before)
  await expect(gridCard(page, /sikkerhed-foto/)).toHaveCount(0)

  await clearLocalRateLimits()
})

test('a form save beyond the tier lands on the screen with the shared notice, and writes no draft', async ({
  page,
}) => {
  await signIn(page, OWNER)
  await fillLocalRateLimit('content:save', await ownerUserId(), RATE_LIMIT_SCOPES['content:save'].maxHits)

  await page.goto('/admin/indhold')
  const form = page.getByRole('form', { name: 'Rediger Om os' })
  const field = form.getByLabel('Overskrift på metodeafsnit')
  const current = await field.inputValue()

  await saveDraft(page, 'Om os', { 'Overskrift på metodeafsnit': `${current} (afvist)` })

  await expect(page).toHaveURL(/status=for_mange/)
  await expect(page.getByText(RATE_LIMIT_MESSAGE)).toBeVisible()
  // Nothing was written: the form reloads with the value it had.
  await expect(form.getByLabel('Overskrift på metodeafsnit')).toHaveValue(current)

  await clearLocalRateLimits()

  // After the window (here: the emptied counter) the same save goes through, and
  // is then reverted, so the seed is as found.
  await saveDraft(page, 'Om os', { 'Overskrift på metodeafsnit': `${current} (afvist)` })
  await expect(page).toHaveURL(/status=saved/)
  await saveDraft(page, 'Om os', { 'Overskrift på metodeafsnit': current })
  await expect(page).toHaveURL(/status=saved/)
})

// ---------------------------------------------------------------------------
// 3. The sign-in throttle
// ---------------------------------------------------------------------------

test('the eleventh failed sign-in in a window is refused before the Auth server is asked, and a real sign-in works once the window is over', async ({
  page,
}) => {
  await clearLocalRateLimits()

  const limit = RATE_LIMIT_SCOPES['auth:signin'].maxHits
  const nobody = { email: 'ingen-saadan-konto@example.test', password: 'ForkertAdgangskode1' }

  for (let attempt = 1; attempt <= limit; attempt += 1) {
    await page.goto('/admin/login')
    await page.getByLabel('E-mail').fill(nobody.email)
    await page.getByLabel('Adgangskode').fill(nobody.password)
    await page.getByRole('button', { name: 'Log ind' }).click()
    await expect(page).toHaveURL(/fejl=forkert/)
    await expect(page.getByText('Forkert e-mail eller adgangskode.')).toBeVisible()
  }

  // The eleventh: refused by the throttle, with the throttle's own sentence — one
  // that does not say whether the address exists.
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill(nobody.email)
  await page.getByLabel('Adgangskode').fill(nobody.password)
  await page.getByRole('button', { name: 'Log ind' }).click()
  await expect(page).toHaveURL(/fejl=for_mange/)
  await expect(page.getByText('Der er gjort for mange forsøg på kort tid. Vent lidt, og prøv igen.')).toBeVisible()
  await expect(page.getByText('Forkert e-mail eller adgangskode.')).toHaveCount(0)

  // And the same refusal for the seeded staff member's real address with a real
  // password: the client counter is the client's, not the address's.
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill(STAFF.email)
  await page.getByLabel('Adgangskode').fill(STAFF.password)
  await page.getByRole('button', { name: 'Log ind' }).click()
  await expect(page).toHaveURL(/fejl=for_mange/)

  // The window over (here: the counters emptied), the seeded staff member signs in.
  await clearLocalRateLimits()
  await signIn(page, STAFF)
  await expect(page.getByRole('main')).toBeVisible()

  // The successful sign-in was reserved and then released: both of its buckets
  // exist for this window and hold nothing. (Locally every browser is the one
  // client, `local`, under the fixed development key.)
  const buckets = await listLocalRateLimitBuckets()
  expect(buckets.find((b) => b.scope === 'auth:signin' && b.subject === localSubjects(STAFF.email).client)?.hits).toBe(0)
  expect(
    buckets.find((b) => b.scope === 'auth:signin-account' && b.subject === localSubjects(STAFF.email).account)?.hits,
  ).toBe(0)
})

// ---------------------------------------------------------------------------
// 4. The threshold under simultaneous attempts (the 13B closure)
// ---------------------------------------------------------------------------

/** The subjects as the local server derives them — the fixed development key, one client. */
function localSubjects(email: string): { client: string; account: string } {
  const secret = 'local-development-rate-limit-key'
  return {
    client: deriveClientSubject(secret, 'address', LOCAL_CLIENT_ADDRESS),
    account: deriveClientSubject(secret, 'account', normalizeAccountAddress(email)),
  }
}

async function submitWrongPassword(browser: Browser, email: string): Promise<'forkert' | 'for_mange' | string> {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto('/admin/login')
    await page.getByLabel('E-mail').fill(email)
    await page.getByLabel('Adgangskode').fill('ForkertAdgangskode1')
    await page.getByRole('button', { name: 'Log ind' }).click()
    await expect(page).toHaveURL(/fejl=/)
    return new URL(page.url()).searchParams.get('fejl') ?? ''
  } finally {
    await context.close()
  }
}

test('with two allowances left, six simultaneous wrong passwords reach the Auth server exactly twice and are refused four times', async ({
  browser,
}) => {
  await clearLocalRateLimits()

  const limit = RATE_LIMIT_SCOPES['auth:signin'].maxHits
  const left = 2
  const attempts = 6
  const subjects = localSubjects(STAFF.email)
  await fillLocalRateLimit('auth:signin', subjects.client, limit - left)

  const answers = await Promise.all(Array.from({ length: attempts }, () => submitWrongPassword(browser, STAFF.email)))

  expect(answers.filter((a) => a === 'forkert')).toHaveLength(left)
  expect(answers.filter((a) => a === 'for_mange')).toHaveLength(attempts - left)

  // The counter holds exactly the tier: the two answered failures stayed, the
  // four refusals added nothing — and the account backstop saw only the two.
  const buckets = await listLocalRateLimitBuckets()
  expect(buckets.find((b) => b.scope === 'auth:signin' && b.subject === subjects.client)?.hits).toBe(limit)
  expect(buckets.find((b) => b.scope === 'auth:signin-account' && b.subject === subjects.account)?.hits).toBe(left)

  await clearLocalRateLimits()
})
