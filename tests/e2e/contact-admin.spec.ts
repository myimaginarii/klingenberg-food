import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  CONTACT_ADMIN_PATH,
  CONTACT_LABELS,
  contactForm,
  contactVersion,
  guestFindOs,
  guestShell,
  openContactAdmin,
  pendingBand,
  previewFindOs,
  publishButton,
  publishContact,
  saveContact,
  statusNotice,
} from './support/contact-admin'
import { ownerRestClient } from './support/home-admin'
import { staffRestClient } from './support/images-admin'
import { PRIMARY_PHONE, PRIMARY_TEL_HREF, SECONDARY_PHONE, SECONDARY_TEL_HREF } from './support/site'

/**
 * Kontaktoplysninger administration — phase 11B (brief §29); designs 1v, 1g, 1k, 1o;
 * technical plan §4, §5, §6, §8, §20.
 *
 * The Owner story, end to end: open the editor with Offentliggør greyed, change the
 * extra number and empty the Facebook address as a draft while the first guest request
 * keeps every printed fact, meet a refused phone and a refused address bound to their
 * fields, preview Find os with the draft, publish — and read the FIRST guest request:
 * the footer's new number with its `tel:` link, Find os's "Ekstra nummer", no Facebook
 * anywhere; then a new primary number reaching the header, the bottom bar, Find os and
 * Mad ud af huset's button on the first request; a stale save refused; the Staff denial
 * (no tile, no address, a direct write refused); and the seed restored.
 *
 * Every guest read is a fresh, cookie-free context — the FIRST request after the
 * commit under test. Both dedicated projects run it, 375 first, then 1440.
 */

test.describe.configure({ mode: 'serial' })

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const NEW_SECONDARY = '+45 11 22 33 44'
const NEW_SECONDARY_HREF = 'tel:+4511223344'
const NEW_PRIMARY = '+45 63 90 83 01'
const NEW_PRIMARY_HREF = 'tel:+4563908301'
const SEEDED_FACEBOOK = 'https://www.facebook.com/carlnielsencafeen'

let ownerPage: Page
let rest: SupabaseClient

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

async function noOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
}

async function storedContact(): Promise<Record<string, unknown> & { draft: unknown; updated_at: string }> {
  const { data, error } = await rest
    .from('site_contact')
    .select('primary_phone, secondary_phone, facebook_url, email, draft, updated_at')
    .single()
  if (error) throw error
  return data as Record<string, unknown> & { draft: unknown; updated_at: string }
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)
  rest = await ownerRestClient()
  await rest.from('site_contact').update({ draft: null }).eq('is_singleton', true)
})

test.afterAll(async () => {
  if (rest === undefined) return
  await rest.from('site_contact').update({ draft: null }).eq('is_singleton', true)
  await rest.auth.signOut()
  await ownerPage.context().close()
})

// ---------------------------------------------------------------------------
// 1. The editor
// ---------------------------------------------------------------------------

test('the Owner opens 1v: the five facts under their labels, Offentliggør greyed with its reason, accessibly', async () => {
  await openContactAdmin(ownerPage)

  const form = contactForm(ownerPage)
  for (const [key, label] of Object.entries(CONTACT_LABELS)) {
    await expect(form.getByLabel(label, { exact: true }), key).toBeVisible()
  }
  await expect(form.getByLabel(CONTACT_LABELS.primary_phone, { exact: true })).toHaveValue(PRIMARY_PHONE)
  await expect(form.getByLabel(CONTACT_LABELS.facebook_url, { exact: true })).toHaveValue(SEEDED_FACEBOOK)
  await expect(form.getByLabel(CONTACT_LABELS.email, { exact: true })).toHaveValue('')

  // 1v's sentences, and no Instagram field.
  await expect(ownerPage.getByText('Bruges af alle Ring-knapper og står størst på Find os.')).toBeVisible()
  await expect(ownerPage.getByText('Klingenberg Food har ikke Instagram — feltet findes ikke.')).toBeVisible()
  await expect(form.getByLabel(/instagram/i)).toHaveCount(0)

  await expect(publishButton(ownerPage)).toBeDisabled()
  const describedBy = await publishButton(ownerPage).getAttribute('aria-describedby')
  await expect(ownerPage.locator(`#${describedBy}`)).toContainText('nedtonet, indtil der faktisk er noget at offentliggøre')
  await expect(pendingBand(ownerPage)).toHaveCount(0)

  expect(await violations(ownerPage)).toEqual([])
  expect(await noOverflow(ownerPage)).toBe(true)

  for (const control of [form.getByRole('button', { name: 'Gem' }), ownerPage.getByRole('banner').getByRole('link', { name: 'Forhåndsvis' })]) {
    const box = await control.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }
})

// ---------------------------------------------------------------------------
// 2–4. A draft, the unchanged guest, a refusal, the preview
// ---------------------------------------------------------------------------

test('changing the extra number and emptying Facebook is a draft: badges on the two fields, the band names them', async () => {
  await saveContact(ownerPage, {
    [CONTACT_LABELS.secondary_phone]: NEW_SECONDARY,
    [CONTACT_LABELS.facebook_url]: '',
  })

  await expect(statusNotice(ownerPage)).toContainText('Gemt som kladde')
  await expect(pendingBand(ownerPage)).toContainText('Ekstra telefonnummer og Facebook afventer offentliggørelse.')
  await expect(contactForm(ownerPage).getByText('Kladde', { exact: true })).toHaveCount(2)
  await expect(publishButton(ownerPage)).toBeEnabled()

  const stored = await storedContact()
  expect(stored.draft).toEqual({ secondary_phone: NEW_SECONDARY, facebook_url: null })
  expect(stored.secondary_phone).toBe(SECONDARY_PHONE)

  expect(await violations(ownerPage)).toEqual([])
})

test('the first guest request keeps every printed fact', async ({ browser }) => {
  const shell = await guestShell(browser, '/')
  expect(shell.footerSecondary).toEqual({ text: `Ekstra nummer ${SECONDARY_PHONE}`, href: SECONDARY_TEL_HREF })
  expect(shell.footerFacebookHref).toBe(SEEDED_FACEBOOK)

  const findOs = await guestFindOs(browser)
  expect(findOs.secondaryText).toContain(SECONDARY_PHONE)
  expect(findOs.facebookHref).toBe(SEEDED_FACEBOOK)
})

test('a phone that is not one and a javascript: address are refused, bound to their fields, echoed', async () => {
  await openContactAdmin(ownerPage)
  await saveContact(ownerPage, {
    [CONTACT_LABELS.primary_phone]: 'ring til os',
    [CONTACT_LABELS.facebook_url]: 'javascript:alert(1)',
  })
  await expect(ownerPage).toHaveURL(/status=ugyldig/)

  const form = contactForm(ownerPage)
  const phone = form.getByLabel(CONTACT_LABELS.primary_phone, { exact: true })
  await expect(phone).toHaveAttribute('aria-invalid', 'true')
  await expect(phone).toHaveValue('ring til os')
  const phoneDescribedBy = await phone.getAttribute('aria-describedby')
  await expect(ownerPage.locator(`#${phoneDescribedBy!.split(' ').pop()}`)).toContainText('skal være et telefonnummer')

  const facebook = form.getByLabel(CONTACT_LABELS.facebook_url, { exact: true })
  await expect(facebook).toHaveAttribute('aria-invalid', 'true')
  const facebookDescribedBy = await facebook.getAttribute('aria-describedby')
  await expect(ownerPage.locator(`#${facebookDescribedBy!.split(' ').pop()}`)).toContainText('https-adresse')

  // Nothing was written: the draft is exactly as before the refusal.
  expect((await storedContact()).draft).toEqual({ secondary_phone: NEW_SECONDARY, facebook_url: null })

  expect(await violations(ownerPage)).toEqual([])
})

test('Forhåndsvis shows the draft on Find os: the new extra number, no Følg os', async () => {
  const preview = await previewFindOs(ownerPage)
  expect(preview.secondaryText).toContain(NEW_SECONDARY)
  expect(preview.facebookHref).toBeNull()
  expect(preview.footerFacebookHref).toBeNull()
})

// ---------------------------------------------------------------------------
// 5–7. Publish: the FIRST guest request, everywhere the facts are printed
// ---------------------------------------------------------------------------

test('publishing puts the new number in the footer and on Find os, and removes Facebook, on the FIRST guest request', async ({
  browser,
}) => {
  await publishContact(ownerPage)
  await expect(statusNotice(ownerPage)).toContainText('Kontaktoplysningerne er opdateret på hjemmesiden')
  await expect(pendingBand(ownerPage)).toHaveCount(0)
  await expect(publishButton(ownerPage)).toBeDisabled()

  const shell = await guestShell(browser, '/')
  expect(shell.footerSecondary).toEqual({ text: `Ekstra nummer ${NEW_SECONDARY}`, href: NEW_SECONDARY_HREF })
  expect(shell.footerPrimary).toEqual({ text: PRIMARY_PHONE, href: PRIMARY_TEL_HREF })
  expect(shell.footerFacebookHref).toBeNull()

  const findOs = await guestFindOs(browser)
  expect(findOs.secondaryText).toContain(NEW_SECONDARY)
  expect(findOs.facebookHref).toBeNull()
  expect(findOs.ringHref).toBe(PRIMARY_TEL_HREF)

  const stored = await storedContact()
  expect(stored.secondary_phone).toBe(NEW_SECONDARY)
  expect(stored.facebook_url).toBeNull()
  expect(stored.draft).toBeNull()
})

test('a new primary number reaches every Ring control on the first request, as a derived tel: link', async ({
  browser,
}, testInfo) => {
  await openContactAdmin(ownerPage)
  await saveContact(ownerPage, { [CONTACT_LABELS.primary_phone]: NEW_PRIMARY })
  await expect(pendingBand(ownerPage)).toContainText('Primært telefonnummer afventer offentliggørelse.')

  // Unchanged for the guest until publish.
  expect((await guestShell(browser, '/')).footerPrimary?.href).toBe(PRIMARY_TEL_HREF)

  await publishContact(ownerPage)

  const shell = await guestShell(browser, '/mad-ud-af-huset')
  expect(shell.footerPrimary).toEqual({ text: NEW_PRIMARY, href: NEW_PRIMARY_HREF })
  const wide = (testInfo.project.use.viewport?.width ?? 0) >= 1024
  if (wide) expect(shell.headerTelHref).toBe(NEW_PRIMARY_HREF)
  else expect(shell.bottomNavTelHref).toBe(NEW_PRIMARY_HREF)

  const findOs = await guestFindOs(browser)
  expect(findOs.ringHref).toBe(NEW_PRIMARY_HREF)
  expect(findOs.primaryText).toBe(NEW_PRIMARY)

  // Mad ud af huset's button rings the new number too — one source (1aj).
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/mad-ud-af-huset')
  await expect(page.getByRole('main').locator('a[href^="tel:"]').first()).toHaveAttribute('href', NEW_PRIMARY_HREF)
  await context.close()

  // And the public pages stay accessible and cookie-free.
  const scanned = await browser.newContext()
  const scan = await scanned.newPage()
  await scan.goto('/find-os')
  expect(await violations(scan)).toEqual([])
  expect(await scanned.cookies()).toEqual([])
  await scanned.close()
})

test('Find os works without scripting with the published facts', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/find-os')
  await expect(page.getByRole('main').getByRole('link', { name: /^Ring/ }).first()).toHaveAttribute('href', NEW_PRIMARY_HREF)
  await expect(page.getByRole('main').getByText(NEW_SECONDARY)).toBeVisible()
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Facebook' })).toHaveCount(0)
  await context.close()
})

// ---------------------------------------------------------------------------
// 8–9. Two tabs; the Staff denial
// ---------------------------------------------------------------------------

test('a second Owner tab that started from an older version is refused, not overwritten', async ({ browser }) => {
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await signIn(otherPage, OWNER)

  await openContactAdmin(ownerPage)
  await openContactAdmin(otherPage)
  const version = await contactVersion(ownerPage)
  expect(await contactVersion(otherPage)).toBe(version)

  await saveContact(otherPage, { [CONTACT_LABELS.email]: 'foerste@klingenberg.test' })
  await expect(statusNotice(otherPage)).toContainText('Gemt som kladde')

  await saveContact(ownerPage, { [CONTACT_LABELS.email]: 'anden@klingenberg.test' })
  await expect(statusNotice(ownerPage)).toContainText('Nogen andre har rettet dette')

  const stored = await storedContact()
  expect((stored.draft as { email: string }).email).toBe('foerste@klingenberg.test')
  expect(stored.updated_at).not.toBe(version)

  // Reloading gives the current version; saving the live value takes the field back out.
  await openContactAdmin(ownerPage)
  await saveContact(ownerPage, { [CONTACT_LABELS.email]: '' })
  await expect(statusNotice(ownerPage)).toContainText('venter ingen ændring')
  expect((await storedContact()).draft).toBeNull()

  await other.close()
})

test('a Staff member is refused the tile, the address, the action and the row', async ({ browser }) => {
  const context = await browser.newContext()
  const staffPage = await context.newPage()
  await signIn(staffPage, STAFF)

  await expect(staffPage.getByRole('link', { name: 'Åbn kontaktoplysningerne' })).toHaveCount(0)
  await staffPage.goto(CONTACT_ADMIN_PATH)
  await expect(staffPage).toHaveURL(/\/admin\/ingen-adgang/)
  await expect(staffPage.getByRole('form', { name: 'Kontaktoplysninger' })).toHaveCount(0)

  const before = await storedContact()
  await staffPage.request.post(CONTACT_ADMIN_PATH, {
    form: { primary_phone: '+45 00 00 00 00', version: before.updated_at },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 0,
    failOnStatusCode: false,
  })

  // A direct write from the Staff JWT: zero rows, RLS.
  const staffRest = await staffRestClient()
  const draftWrite = await staffRest
    .from('site_contact')
    .update({ draft: { primary_phone: '+45 00 00 00 00' } })
    .eq('is_singleton', true)
    .select('id')
  expect(draftWrite.data).toEqual([])
  const columnWrite = await staffRest
    .from('site_contact')
    .update({ primary_phone: '+45 00 00 00 00' })
    .eq('is_singleton', true)
    .select('id')
  expect(columnWrite.data).toEqual([])
  await staffRest.auth.signOut()

  const after = await storedContact()
  expect(after.updated_at).toBe(before.updated_at)
  expect(after.primary_phone).toBe(NEW_PRIMARY)

  await context.close()
})

// ---------------------------------------------------------------------------
// 10. The seed, restored
// ---------------------------------------------------------------------------

test('the run restores the seed through the editor, and the guest reads it on the first request', async ({
  browser,
}) => {
  await openContactAdmin(ownerPage)
  await saveContact(ownerPage, {
    [CONTACT_LABELS.primary_phone]: PRIMARY_PHONE,
    [CONTACT_LABELS.secondary_phone]: SECONDARY_PHONE,
    [CONTACT_LABELS.facebook_url]: SEEDED_FACEBOOK,
    [CONTACT_LABELS.email]: '',
  })
  await publishContact(ownerPage)

  const shell = await guestShell(browser, '/')
  expect(shell.footerPrimary).toEqual({ text: PRIMARY_PHONE, href: PRIMARY_TEL_HREF })
  expect(shell.footerSecondary).toEqual({ text: `Ekstra nummer ${SECONDARY_PHONE}`, href: SECONDARY_TEL_HREF })
  expect(shell.footerFacebookHref).toBe(SEEDED_FACEBOOK)

  const stored = await storedContact()
  expect(stored.draft).toBeNull()
  expect(stored.email).toBeNull()
})
