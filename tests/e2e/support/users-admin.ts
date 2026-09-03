import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'

import { caughtMailFor, inviteLinkOf } from '../../support/local-auth-admin'

/**
 * Driving the user administration, for the browser tests — phase 11C.
 *
 * The helpers speak the screen's own language: accessible names, visible labels
 * and the status vocabulary the actions redirect with. The invitation link is read
 * from the local mail catcher — the same place a developer reads it — and followed
 * on the test server's own origin, since the Auth container's `site_url` names
 * port 3000 while Playwright's production server listens on 3100.
 */

export const USERS_ADMIN_PATH = '/admin/brugere'

export const INVITE_LABELS = { name: 'Navn', email: 'E-mail', role: 'Rolle' } as const

export async function openUsersAdmin(page: Page): Promise<void> {
  await page.goto(USERS_ADMIN_PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brugere')
}

/** The list item for one account, by the address it prints. */
export function userRow(page: Page, email: string): Locator {
  return page.getByRole('listitem').filter({ hasText: email })
}

export function inviteForm(page: Page): Locator {
  return page.getByRole('form', { name: 'Invitér en ny bruger', exact: true })
}

export function statusNotice(page: Page): Locator {
  return page.getByRole('status').first()
}

/** Fill the invitation card and press "Send invitation"; wait for the redirect. */
export async function invite(
  page: Page,
  values: { name: string; email: string; role: 'Ejer' | 'Medarbejder' },
): Promise<void> {
  const form = inviteForm(page)
  await form.getByLabel(INVITE_LABELS.name, { exact: true }).fill(values.name)
  await form.getByLabel(INVITE_LABELS.email, { exact: true }).fill(values.email)
  await form.getByLabel(INVITE_LABELS.role, { exact: true }).selectOption({ label: values.role })

  const before = page.url()
  await form.getByRole('button', { name: 'Send invitation' }).click()
  await page.waitForURL((url) => url.toString() !== before)
  await page.waitForURL(/brugere\?.*status=/)
}

/** Open a row's confirmation through its link, and wait for the dialog. */
export async function openConfirmation(page: Page, row: Locator, control: RegExp): Promise<Locator> {
  await row.getByRole('link', { name: control }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

/**
 * Press the committing control of an open confirmation and wait for the outcome —
 * the address, and the new render: a Server Action's redirect moves the URL before
 * the new tree has arrived, and the status notice exists only in that tree.
 */
export async function confirm(page: Page, dialog: Locator, label: RegExp): Promise<void> {
  const before = page.url()
  await dialog.getByRole('button', { name: label }).click()
  await page.waitForURL((url) => url.toString() !== before)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  if (/[?&]status=/.test(page.url())) await expect(statusNotice(page)).toBeVisible()
}

/**
 * Accept the newest invitation sent to `email`: follow the token link on the test
 * server, choose the password, and land on the dashboard as the invited person.
 * Returns the signed-in context; the caller closes it.
 */
export async function acceptInvitation(
  browser: Browser,
  email: string,
  password: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const [latest] = await caughtMailFor(email)
  if (latest === undefined) throw new Error(`No invitation was caught for ${email}.`)
  const link = inviteLinkOf(latest)
  if (link === null) throw new Error(`The invitation to ${email} carries no /admin/bekraeft link.`)

  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`/admin/bekraeft?token_hash=${link.tokenHash}&type=${link.type}`)
  await page.waitForURL(/\/admin\/ny-adgangskode/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vælg ny adgangskode')

  await page.getByLabel('Ny adgangskode').fill(password)
  await page.getByLabel('Gentag adgangskode').fill(password)
  await page.getByRole('button', { name: 'Gem adgangskode' }).click()
  await page.waitForURL(/\/admin\?besked=adgangskode-skiftet/)

  return { context, page }
}
