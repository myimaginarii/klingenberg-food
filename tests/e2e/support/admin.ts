import { expect, type Page } from '@playwright/test'

/**
 * Signing in, for the browser tests — technical plan §5, §10a.
 *
 * The two local development identities, created by `npm run db:users`. They exist only
 * on a loopback Supabase: the script refuses to run against anything else, and no real
 * account is ever created by a script in this repository (§5, decision 11). The
 * passwords are the ones that script prints, restated here so a failing test points at
 * the site rather than at a value typed twice.
 */

export const OWNER = { email: 'owner@example.test', password: 'LocalOwner12345' } as const
export const STAFF = { email: 'staff@example.test', password: 'LocalStaff12345' } as const

/** A local `.test` identity: the two seeded ones, or one a suite created itself (phase 11C). */
export type AdminUser = { readonly email: string; readonly password: string }

/** Sign in and land on the dashboard. */
export async function signIn(page: Page, user: AdminUser): Promise<void> {
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill(user.email)
  await page.getByLabel('Adgangskode').fill(user.password)
  await page.getByRole('button', { name: 'Log ind' }).click()

  await expect(page).toHaveURL(/\/admin(\?.*)?$/)
}

/** The Draft Mode bypass cookie, by the name Next.js gives it. */
export const DRAFT_COOKIE = '__prerender_bypass'

/** One editor form on /admin/indhold, addressed by its accessible name. */
export function editorForm(page: Page, heading: string) {
  return page.getByRole('form', { name: `Rediger ${heading}` })
}

/**
 * Save a draft through one of the phase-4 editor forms.
 *
 * The form carries the version it was rendered from in a hidden field, so reloading
 * the page before each save is what makes a save use the *current* version — and
 * deliberately not reloading is how the concurrency test produces a stale one.
 */
export async function saveDraft(
  page: Page,
  heading: string,
  fields: Record<string, string>,
): Promise<void> {
  const form = editorForm(page, heading)

  for (const [label, value] of Object.entries(fields)) {
    await form.getByLabel(label).fill(value)
  }

  await form.getByRole('button', { name: 'Gem kladde' }).click()

  // The action redirects back with a status. Waiting for it here means a caller can
  // navigate away immediately afterwards without racing the save.
  await page.waitForURL(/\/admin\/indhold\?status=/)
}

/** Publish exactly the listed pending changes, and nothing else. */
export async function publishOnly(page: Page, titles: readonly string[]): Promise<void> {
  await page.goto('/admin')

  const form = page.getByRole('form', { name: 'Ændringer der venter' })
  const checkboxes = form.getByRole('checkbox')

  for (const checkbox of await checkboxes.all()) {
    if (await checkbox.isDisabled()) continue
    await checkbox.uncheck()
  }

  for (const title of titles) {
    await form.getByRole('checkbox', { name: title }).check()
  }

  await form.getByRole('button', { name: 'Offentliggør valgte ændringer' }).click()

  // Same reason: the action redirects back with one count per outcome.
  await page.waitForURL(/\/admin\?[a-z_]+=/)
}
