import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  caughtMailFor,
  deleteLocalAuthUser,
  findLocalAuthUser,
  listLocalAccountAudit,
  listLocalProfiles,
  restoreSeededIdentities,
} from '../support/local-auth-admin'
import { OWNER, signIn, STAFF } from './support/admin'
import { ownerRestClient } from './support/home-admin'
import { staffRestClient } from './support/images-admin'
import {
  acceptInvitation,
  confirm,
  INVITE_LABELS,
  inviteForm,
  invite,
  openConfirmation,
  openUsersAdmin,
  statusNotice,
  userRow,
  USERS_ADMIN_PATH,
} from './support/users-admin'

/**
 * User administration — phase 11C (brief §31); technical plan §5 ("Accounts",
 * decision 11), §8, §9 ("the owner can invite and deactivate a staff user").
 *
 * The Owner story, end to end: open `/admin/brugere` and read the two seeded
 * accounts with the last-owner sentence on the Owner's own row; meet a refused and
 * a duplicate invitation bound to their fields; invite a unique Staff account and
 * read its profile, its e-mail in the local mail catcher and its audit row; accept
 * the invitation as the invitee and choose a password; change the role through the
 * confirmation and watch the invitee's EXISTING session gain and lose the Owner
 * areas; prove the last-active-owner refusal at the database with the Owner's own
 * JWT; deactivate the invitee and watch their existing session lose the
 * administration and their sign-in say why; reactivate and sign in again; the
 * self-deactivation and self-demotion of a second owner; the Staff denial; and the
 * cleanup that leaves exactly the two seeded identities behind.
 *
 * Both dedicated projects run it, 375 first, then 1440. Every identity it creates
 * has a run-unique `@example.test` address and is deleted at the end.
 */

test.describe.configure({ mode: 'serial' })

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const RUN = Date.now().toString(36)
const INVITEE_EMAIL = `e2e-${RUN}@example.test`
const INVITEE_NAME = 'Testperson E2E'
const INVITEE_PASSWORD = 'TestpersonPass12345'
const LAST_OWNER_NOTE = 'Eneste aktive ejer'

let ownerPage: Page
let rest: SupabaseClient
let ownerId: string
let inviteeId: string

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

async function tallEnough(locator: Parameters<typeof expect>[0] & { boundingBox: () => Promise<{ height: number } | null> }) {
  const box = await locator.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}

type StoredProfile = { user_id: string; role: string; disabled_at: string | null; updated_at: string }

async function storedProfileByEmail(email: string): Promise<StoredProfile> {
  const user = await findLocalAuthUser(email)
  if (user === null) throw new Error(`${email} has no identity`)
  const { data, error } = await rest
    .from('profiles')
    .select('user_id, role, disabled_at, updated_at')
    .eq('user_id', user.id)
    .single()
  if (error) throw error
  return data as StoredProfile
}

test.beforeAll(async ({ browser }) => {
  await deleteLocalAuthUser(INVITEE_EMAIL)

  const context = await browser.newContext()
  ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)
  rest = await ownerRestClient()
  ownerId = (await storedProfileByEmail(OWNER.email)).user_id
})

test.afterAll(async () => {
  await deleteLocalAuthUser(INVITEE_EMAIL)
  await restoreSeededIdentities()
  if (rest !== undefined) await rest.auth.signOut({ scope: 'local' })
  if (ownerPage !== undefined) await ownerPage.context().close()
})

// ---------------------------------------------------------------------------
// 1. The list, as the Owner reads it
// ---------------------------------------------------------------------------

test('the Owner opens Brugere: both seeded accounts in words, the last-owner sentence, no delete, accessibly', async () => {
  await expect(ownerPage.getByRole('link', { name: 'Åbn brugerne' })).toBeVisible()
  await tallEnough(ownerPage.getByRole('link', { name: 'Åbn brugerne' }))

  await openUsersAdmin(ownerPage)

  const owner = userRow(ownerPage, OWNER.email)
  await expect(owner).toContainText('Lokal Ejer')
  await expect(owner).toContainText('(dig)')
  await expect(owner).toContainText('Ejer')
  await expect(owner).toContainText('Aktiv')
  await expect(owner).toContainText(LAST_OWNER_NOTE)
  await expect(owner.getByRole('link')).toHaveCount(0)

  const staff = userRow(ownerPage, STAFF.email)
  await expect(staff).toContainText('Lokal Medarbejder')
  await expect(staff).toContainText('Medarbejder')
  await expect(staff).toContainText('Kan logge ind og bruge administrationen.')
  await expect(staff.getByRole('link', { name: /^Gør til ejer/ })).toBeVisible()
  await expect(staff.getByRole('link', { name: /^Deaktivér/ })).toBeVisible()
  await expect(staff.getByRole('link', { name: /^Genaktivér/ })).toHaveCount(0)

  // Deactivate, never delete: no such control anywhere.
  await expect(ownerPage.getByRole('link', { name: /slet/i })).toHaveCount(0)
  await expect(ownerPage.getByRole('button', { name: /slet/i })).toHaveCount(0)
  await expect(ownerPage.locator('input[type="password"]')).toHaveCount(0)

  const form = inviteForm(ownerPage)
  for (const label of Object.values(INVITE_LABELS)) {
    await expect(form.getByLabel(label, { exact: true }), label).toBeVisible()
  }
  await expect(form.getByLabel(INVITE_LABELS.role, { exact: true })).toHaveValue('staff')

  expect(await violations(ownerPage)).toEqual([])
  expect(await noOverflow(ownerPage)).toBe(true)
  for (const control of [
    staff.getByRole('link', { name: /^Gør til ejer/ }),
    staff.getByRole('link', { name: /^Deaktivér/ }),
    form.getByRole('button', { name: 'Send invitation' }),
  ]) {
    await tallEnough(control)
  }
})

// ---------------------------------------------------------------------------
// 2. Refusals, bound to their fields
// ---------------------------------------------------------------------------

test('a blank name and a malformed address are refused, bound to their fields, echoed', async () => {
  await invite(ownerPage, { name: '   ', email: 'ikke en adresse', role: 'Medarbejder' })
  await expect(ownerPage).toHaveURL(/status=ugyldig/)
  await expect(statusNotice(ownerPage)).toContainText('Ret det, der er markeret')

  const form = inviteForm(ownerPage)
  const name = form.getByLabel(INVITE_LABELS.name, { exact: true })
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  const nameDescribedBy = await name.getAttribute('aria-describedby')
  await expect(ownerPage.locator(`#${nameDescribedBy!.split(' ').pop()}`)).toContainText('må ikke være tomt')

  const email = form.getByLabel(INVITE_LABELS.email, { exact: true })
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  await expect(email).toHaveValue('ikke en adresse')
  const emailDescribedBy = await email.getAttribute('aria-describedby')
  await expect(ownerPage.locator(`#${emailDescribedBy!.split(' ').pop()}`)).toContainText('ligner ikke en e-mailadresse')

  expect(await violations(ownerPage)).toEqual([])
  expect((await listLocalProfiles()).length).toBe(2)
})

test('the seeded staff address is a duplicate: refused on the field, nothing sent, nothing created', async () => {
  await invite(ownerPage, { name: 'Dublet', email: STAFF.email, role: 'Ejer' })
  await expect(ownerPage).toHaveURL(/status=findes/)
  await expect(statusNotice(ownerPage)).toContainText('har allerede en konto')

  const email = inviteForm(ownerPage).getByLabel(INVITE_LABELS.email, { exact: true })
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  await expect(email).toHaveValue(STAFF.email)

  expect((await listLocalProfiles()).length).toBe(2)
  expect((await storedProfileByEmail(STAFF.email)).role).toBe('staff')
  expect(await caughtMailFor(STAFF.email)).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// 3–4. The invitation, and its acceptance
// ---------------------------------------------------------------------------

test('a unique Staff account is invited: the row says Inviteret, the profile exists, the e-mail is caught, the audit row is written', async () => {
  await invite(ownerPage, { name: INVITEE_NAME, email: INVITEE_EMAIL, role: 'Medarbejder' })
  await expect(ownerPage).toHaveURL(/status=inviteret(&|#|$)/)
  await expect(statusNotice(ownerPage)).toContainText('Invitationen er sendt')

  const row = userRow(ownerPage, INVITEE_EMAIL)
  await expect(row).toContainText(INVITEE_NAME)
  await expect(row).toContainText('Medarbejder')
  await expect(row).toContainText('Inviteret')
  await expect(row).toContainText('ikke valgt adgangskode endnu')

  const stored = await storedProfileByEmail(INVITEE_EMAIL)
  inviteeId = stored.user_id
  expect(stored).toMatchObject({ role: 'staff', disabled_at: null })

  const mail = await caughtMailFor(INVITEE_EMAIL)
  expect(mail).toHaveLength(1)
  expect(mail[0]!.subject).toBe('Du er inviteret til administrationen af Klingenberg Food')
  expect(mail[0]!.html).toContain('/admin/bekraeft?token_hash=')
  expect(mail[0]!.html).not.toMatch(/adgangskoden er/i)

  const audit = await listLocalAccountAudit(inviteeId)
  expect(audit).toEqual([{ action: 'invite', actorId: ownerId }])

  // The form is empty again, ready for the next person.
  await expect(inviteForm(ownerPage).getByLabel(INVITE_LABELS.email, { exact: true })).toHaveValue('')
  expect(await violations(ownerPage)).toEqual([])
})

test('the invitee follows the link, chooses a password, and is a Staff member: no Brugere tile, the address refused', async ({
  browser,
}) => {
  const invitee = await acceptInvitation(browser, INVITEE_EMAIL, INVITEE_PASSWORD)

  await expect(invitee.page.getByRole('heading', { level: 1 })).toHaveText(`Hej, ${INVITEE_NAME}`)
  await expect(invitee.page.getByText('Din adgangskode er skiftet.')).toBeVisible()
  await expect(invitee.page.getByRole('link', { name: 'Åbn brugerne' })).toHaveCount(0)
  await expect(invitee.page.getByRole('link', { name: 'Åbn menuen' })).toBeVisible()

  await invitee.page.goto(USERS_ADMIN_PATH)
  await expect(invitee.page).toHaveURL(/\/admin\/ingen-adgang/)

  await invitee.context.close()

  await openUsersAdmin(ownerPage)
  await expect(userRow(ownerPage, INVITEE_EMAIL)).toContainText('Aktiv')
  await expect(userRow(ownerPage, INVITEE_EMAIL)).not.toContainText('Inviteret')
})

// ---------------------------------------------------------------------------
// 5. The role, through the confirmation; the existing session follows
// ---------------------------------------------------------------------------

test('promoting the invitee: the confirmation names them, Esc cancels and returns focus, the change is in force for their open session', async ({
  browser,
}) => {
  const invitee = await browser.newContext()
  const inviteePage = await invitee.newPage()
  await signIn(inviteePage, { email: INVITEE_EMAIL, password: INVITEE_PASSWORD })
  await expect(inviteePage.getByRole('link', { name: 'Åbn brugerne' })).toHaveCount(0)

  await openUsersAdmin(ownerPage)
  const row = userRow(ownerPage, INVITEE_EMAIL)
  const dialog = await openConfirmation(ownerPage, row, /^Gør til ejer/)
  await expect(ownerPage).toHaveURL(new RegExp(`rolle=${inviteeId}`))
  await expect(dialog).toContainText(`Gør ${INVITEE_NAME} (${INVITEE_EMAIL}) til ejer?`)
  await expect(dialog.getByRole('link', { name: 'Behold rollen' })).toBeFocused()
  expect(await violations(ownerPage)).toEqual([])

  // Esc is the safe way out, and the keyboard lands on the control it came from.
  await ownerPage.keyboard.press('Escape')
  await expect(ownerPage).not.toHaveURL(/rolle=/)
  await expect(ownerPage.getByRole('dialog')).toHaveCount(0)
  await expect(userRow(ownerPage, INVITEE_EMAIL).getByRole('link', { name: /^Gør til ejer/ })).toBeFocused()
  expect((await storedProfileByEmail(INVITEE_EMAIL)).role).toBe('staff')

  const again = await openConfirmation(ownerPage, userRow(ownerPage, INVITEE_EMAIL), /^Gør til ejer/)
  await confirm(ownerPage, again, /^Gør til ejer/)
  await expect(ownerPage).toHaveURL(/status=rolle_aendret/)
  await expect(statusNotice(ownerPage)).toContainText('Rollen er ændret')
  await expect(userRow(ownerPage, INVITEE_EMAIL)).toContainText('Ejer')
  expect((await storedProfileByEmail(INVITEE_EMAIL)).role).toBe('owner')

  // Two active owners: the seeded Owner's own row now offers the controls.
  await expect(userRow(ownerPage, OWNER.email)).not.toContainText(LAST_OWNER_NOTE)
  await expect(userRow(ownerPage, OWNER.email).getByRole('link', { name: /^Deaktivér/ })).toBeVisible()

  // The invitee's EXISTING session, with its old JWT: the next request is an owner's.
  await inviteePage.goto('/admin')
  await expect(inviteePage.getByRole('link', { name: 'Åbn brugerne' })).toBeVisible()
  await inviteePage.goto(USERS_ADMIN_PATH)
  await expect(inviteePage.getByRole('heading', { level: 1 })).toHaveText('Brugere')

  const audit = await listLocalAccountAudit(inviteeId)
  expect(audit.map((row) => row.action)).toEqual(['invite', 'role'])

  await invitee.close()
})

// ---------------------------------------------------------------------------
// 6. The last active owner
// ---------------------------------------------------------------------------

test('demoting the invitee back makes the Owner the last active owner again: refused at the database with the Owner\'s own JWT', async ({
  browser,
}) => {
  const invitee = await browser.newContext()
  const inviteePage = await invitee.newPage()
  await signIn(inviteePage, { email: INVITEE_EMAIL, password: INVITEE_PASSWORD })
  await inviteePage.goto(USERS_ADMIN_PATH)
  await expect(inviteePage.getByRole('heading', { level: 1 })).toHaveText('Brugere')

  await openUsersAdmin(ownerPage)
  const dialog = await openConfirmation(ownerPage, userRow(ownerPage, INVITEE_EMAIL), /^Gør til medarbejder/)
  await expect(dialog).toContainText('mister med det samme adgangen')
  await confirm(ownerPage, dialog, /^Gør til medarbejder/)
  await expect(ownerPage).toHaveURL(/status=rolle_aendret/)

  // The invitee's existing session lost the Owner areas on its next request.
  await inviteePage.goto(USERS_ADMIN_PATH)
  await expect(inviteePage).toHaveURL(/\/admin\/ingen-adgang/)
  await inviteePage.goto('/admin')
  await expect(inviteePage.getByRole('link', { name: 'Åbn brugerne' })).toHaveCount(0)
  await invitee.close()

  // The screen: the Owner's row is the last active owner again.
  const ownerRow = userRow(ownerPage, OWNER.email)
  await expect(ownerRow).toContainText(LAST_OWNER_NOTE)
  await expect(ownerRow.getByRole('link')).toHaveCount(0)

  // A hand-typed confirmation address for a withheld control renders no dialog.
  await ownerPage.goto(`${USERS_ADMIN_PATH}?rolle=${ownerId}`)
  await expect(ownerPage.getByRole('dialog')).toHaveCount(0)
  await ownerPage.goto(`${USERS_ADMIN_PATH}?deaktiver=${ownerId}`)
  await expect(ownerPage.getByRole('dialog')).toHaveCount(0)

  // The database, with the Owner's own JWT: the transitions answer last_owner,
  // the direct writes are refused, and nothing moved.
  const before = await storedProfileByEmail(OWNER.email)
  const demote = await rest.rpc('set_account_role', {
    p_user_id: ownerId,
    p_role: 'staff',
    p_expected_updated_at: before.updated_at,
  })
  expect(demote.error).toBeNull()
  expect((demote.data as { status: string }).status).toBe('last_owner')
  const deactivate = await rest.rpc('set_account_active', {
    p_user_id: ownerId,
    p_active: false,
    p_expected_updated_at: before.updated_at,
  })
  expect(deactivate.error).toBeNull()
  expect((deactivate.data as { status: string }).status).toBe('last_owner')
  const direct = await rest.from('profiles').update({ role: 'staff' }).eq('user_id', ownerId).select('user_id')
  expect(direct.error?.code).toBe('42501')
  const directState = await rest
    .from('profiles')
    .update({ disabled_at: new Date().toISOString() })
    .eq('user_id', ownerId)
    .select('user_id')
  expect(directState.error?.code).toBe('42501')
  const removal = await rest.from('profiles').delete().eq('user_id', ownerId).select('user_id')
  expect(removal.error?.code).toBe('42501')

  const after = await storedProfileByEmail(OWNER.email)
  expect(after).toMatchObject({ role: 'owner', disabled_at: null, updated_at: before.updated_at })
  expect((await listLocalAccountAudit(ownerId)).length).toBe(0)
})

// ---------------------------------------------------------------------------
// 7–8. Deactivation and reactivation; the existing session loses authorization
// ---------------------------------------------------------------------------

test('deactivating the invitee: the confirmation is destructive, their open session is refused, their sign-in says why, the audit row is written', async ({
  browser,
}) => {
  const invitee = await browser.newContext()
  const inviteePage = await invitee.newPage()
  await signIn(inviteePage, { email: INVITEE_EMAIL, password: INVITEE_PASSWORD })
  await expect(inviteePage.getByRole('heading', { level: 1 })).toHaveText(`Hej, ${INVITEE_NAME}`)

  await openUsersAdmin(ownerPage)
  const dialog = await openConfirmation(ownerPage, userRow(ownerPage, INVITEE_EMAIL), /^Deaktivér/)
  await expect(dialog).toContainText(`Deaktivér ${INVITEE_NAME} (${INVITEE_EMAIL})?`)
  await expect(dialog).toContainText('Kontoen slettes ikke')
  await expect(dialog.getByRole('link', { name: 'Behold kontoen aktiv' })).toBeFocused()
  expect(await violations(ownerPage)).toEqual([])

  await ownerPage.keyboard.press('Escape')
  await expect(ownerPage.getByRole('dialog')).toHaveCount(0)
  await expect(userRow(ownerPage, INVITEE_EMAIL).getByRole('link', { name: /^Deaktivér/ })).toBeFocused()
  expect((await storedProfileByEmail(INVITEE_EMAIL)).disabled_at).toBeNull()

  const again = await openConfirmation(ownerPage, userRow(ownerPage, INVITEE_EMAIL), /^Deaktivér/)
  await confirm(ownerPage, again, /^Deaktivér/)
  await expect(ownerPage).toHaveURL(/status=deaktiveret(&|#|$)/)
  await expect(statusNotice(ownerPage)).toContainText('Kontoen er deaktiveret')

  const row = userRow(ownerPage, INVITEE_EMAIL)
  await expect(row).toContainText('Deaktiveret')
  await expect(row).toContainText('står stadig i loggen')
  await expect(row.getByRole('link', { name: /^Genaktivér/ })).toBeVisible()
  await expect(row.getByRole('link', { name: /^Deaktivér/ })).toHaveCount(0)
  await expect(row.getByRole('link', { name: /^Gør til/ })).toHaveCount(0)
  expect(await violations(ownerPage)).toEqual([])

  expect((await storedProfileByEmail(INVITEE_EMAIL)).disabled_at).not.toBeNull()
  expect((await findLocalAuthUser(INVITEE_EMAIL))!.bannedUntil).not.toBeNull()

  // The invitee's EXISTING session: the next request is the login screen.
  await inviteePage.goto('/admin')
  await expect(inviteePage).toHaveURL(/\/admin\/login/)
  await inviteePage.goto('/admin/menu')
  await expect(inviteePage).toHaveURL(/\/admin\/login/)

  // And a fresh sign-in says why.
  await inviteePage.goto('/admin/login')
  await inviteePage.getByLabel('E-mail').fill(INVITEE_EMAIL)
  await inviteePage.getByLabel('Adgangskode').fill(INVITEE_PASSWORD)
  await inviteePage.getByRole('button', { name: 'Log ind' }).click()
  await expect(inviteePage).toHaveURL(/fejl=deaktiveret/)
  await expect(inviteePage.getByText('Din konto er deaktiveret. Kontakt ejeren.')).toBeVisible()
  await invitee.close()

  // A Staff JWT cannot touch the row either way.
  const staffRest = await staffRestClient()
  const write = await staffRest.from('profiles').update({ disabled_at: null }).eq('user_id', inviteeId).select('user_id')
  expect(write.data).toEqual([])
  const reactivate = await staffRest.rpc('set_account_active', {
    p_user_id: inviteeId,
    p_active: true,
    p_expected_updated_at: (await storedProfileByEmail(INVITEE_EMAIL)).updated_at,
  })
  expect(reactivate.error?.code).toBe('42501')
  await staffRest.auth.signOut({ scope: 'local' })

  expect((await listLocalAccountAudit(inviteeId)).map((entry) => entry.action)).toEqual([
    'invite',
    'role',
    'role',
    'deactivate',
  ])
})

test('reactivating the invitee restores sign-in with the existing role', async ({ browser }) => {
  await openUsersAdmin(ownerPage)
  const dialog = await openConfirmation(ownerPage, userRow(ownerPage, INVITEE_EMAIL), /^Genaktivér/)
  await expect(dialog).toContainText('får sin rolle tilbage: medarbejder')
  await expect(dialog.getByRole('link', { name: 'Lad den være deaktiveret' })).toBeFocused()
  await confirm(ownerPage, dialog, /^Genaktivér/)
  await expect(ownerPage).toHaveURL(/status=genaktiveret(&|#|$)/)
  await expect(statusNotice(ownerPage)).toContainText('genaktiveret med sin hidtidige rolle')

  const row = userRow(ownerPage, INVITEE_EMAIL)
  await expect(row).toContainText('Aktiv')
  await expect(row).toContainText('Medarbejder')
  expect(await storedProfileByEmail(INVITEE_EMAIL)).toMatchObject({ role: 'staff', disabled_at: null })
  expect((await findLocalAuthUser(INVITEE_EMAIL))!.bannedUntil).toBeNull()

  const invitee = await browser.newContext()
  const inviteePage = await invitee.newPage()
  await signIn(inviteePage, { email: INVITEE_EMAIL, password: INVITEE_PASSWORD })
  await expect(inviteePage.getByRole('heading', { level: 1 })).toHaveText(`Hej, ${INVITEE_NAME}`)
  await expect(inviteePage.getByRole('link', { name: 'Åbn brugerne' })).toHaveCount(0)
  await invitee.close()

  expect((await listLocalAccountAudit(inviteeId)).map((entry) => entry.action)).toEqual([
    'invite',
    'role',
    'role',
    'deactivate',
    'reactivate',
  ])
})

// ---------------------------------------------------------------------------
// 9. Acting on oneself, while another owner exists
// ---------------------------------------------------------------------------

test('a second owner may deactivate themselves: their session ends at once; reactivated, they keep the Owner role and may demote themselves', async ({
  browser,
}) => {
  // Make the invitee an owner again.
  await openUsersAdmin(ownerPage)
  const promote = await openConfirmation(ownerPage, userRow(ownerPage, INVITEE_EMAIL), /^Gør til ejer/)
  await confirm(ownerPage, promote, /^Gør til ejer/)
  await expect(ownerPage).toHaveURL(/status=rolle_aendret/)

  // Self-deactivation.
  const first = await browser.newContext()
  const firstPage = await first.newPage()
  await signIn(firstPage, { email: INVITEE_EMAIL, password: INVITEE_PASSWORD })
  await openUsersAdmin(firstPage)
  const own = userRow(firstPage, INVITEE_EMAIL)
  await expect(own).toContainText('(dig)')
  const selfDeactivate = await openConfirmation(firstPage, own, /^Deaktivér/)
  await expect(selfDeactivate).toContainText('dig selv')
  await expect(selfDeactivate).toContainText('Du bliver logget ud med det samme')
  await confirm(firstPage, selfDeactivate, /^Deaktivér/)
  await expect(firstPage).toHaveURL(/\/admin\/login\?fejl=deaktiveret/)
  await expect(firstPage.getByText('Din konto er deaktiveret. Kontakt ejeren.')).toBeVisible()
  await firstPage.goto('/admin')
  await expect(firstPage).toHaveURL(/\/admin\/login/)
  await first.close()

  expect(await storedProfileByEmail(INVITEE_EMAIL)).toMatchObject({ role: 'owner' })
  expect((await storedProfileByEmail(INVITEE_EMAIL)).disabled_at).not.toBeNull()

  // The seeded Owner reactivates them: the Owner role comes back, not a new account.
  await openUsersAdmin(ownerPage)
  const reactivate = await openConfirmation(ownerPage, userRow(ownerPage, INVITEE_EMAIL), /^Genaktivér/)
  await expect(reactivate).toContainText('får sin rolle tilbage: ejer')
  await confirm(ownerPage, reactivate, /^Genaktivér/)
  await expect(ownerPage).toHaveURL(/status=genaktiveret/)
  expect(await storedProfileByEmail(INVITEE_EMAIL)).toMatchObject({ role: 'owner', disabled_at: null })

  // Self-demotion.
  const second = await browser.newContext()
  const secondPage = await second.newPage()
  await signIn(secondPage, { email: INVITEE_EMAIL, password: INVITEE_PASSWORD })
  await openUsersAdmin(secondPage)
  const selfDemote = await openConfirmation(secondPage, userRow(secondPage, INVITEE_EMAIL), /^Gør til medarbejder/)
  await expect(selfDemote).toContainText('dig selv')
  await expect(selfDemote).toContainText('også i denne fane')
  await confirm(secondPage, selfDemote, /^Gør til medarbejder/)
  await expect(secondPage).toHaveURL(/\/admin\?besked=rolle-skiftet/)
  await expect(secondPage.getByText('Din rolle er nu medarbejder.')).toBeVisible()
  await expect(secondPage.getByRole('link', { name: 'Åbn brugerne' })).toHaveCount(0)
  await secondPage.goto(USERS_ADMIN_PATH)
  await expect(secondPage).toHaveURL(/\/admin\/ingen-adgang/)
  await second.close()

  expect(await storedProfileByEmail(INVITEE_EMAIL)).toMatchObject({ role: 'staff', disabled_at: null })
  await openUsersAdmin(ownerPage)
  await expect(userRow(ownerPage, OWNER.email)).toContainText(LAST_OWNER_NOTE)
})

// ---------------------------------------------------------------------------
// 10. The Staff denial
// ---------------------------------------------------------------------------

test('a Staff member is refused the tile, the address, the transitions and the rows', async ({ browser }) => {
  const context = await browser.newContext()
  const staffPage = await context.newPage()
  await signIn(staffPage, STAFF)

  await expect(staffPage.getByRole('link', { name: 'Åbn brugerne' })).toHaveCount(0)
  await staffPage.goto(USERS_ADMIN_PATH)
  await expect(staffPage).toHaveURL(/\/admin\/ingen-adgang/)
  await expect(staffPage.getByRole('form', { name: 'Invitér en ny bruger' })).toHaveCount(0)
  await staffPage.goto(`${USERS_ADMIN_PATH}?deaktiver=${ownerId}`)
  await expect(staffPage).toHaveURL(/\/admin\/ingen-adgang/)
  await context.close()

  const staffRest = await staffRestClient()
  const listing = await staffRest.rpc('list_accounts')
  expect(listing.error?.code).toBe('42501')
  const created = await staffRest.rpc('create_account_profile', {
    p_user_id: inviteeId,
    p_name: 'Forfalsket',
    p_role: 'owner',
  })
  expect(created.error?.code).toBe('42501')
  const promoted = await staffRest.rpc('set_account_role', {
    p_user_id: (await storedProfileByEmail(STAFF.email)).user_id,
    p_role: 'owner',
    p_expected_updated_at: (await storedProfileByEmail(STAFF.email)).updated_at,
  })
  expect(promoted.error?.code).toBe('42501')
  const staffId = (await storedProfileByEmail(STAFF.email)).user_id
  const direct = await staffRest.from('profiles').update({ role: 'owner' }).eq('user_id', staffId).select('user_id')
  expect(direct.error).toBeNull()
  expect(direct.data).toEqual([])
  const visible = await staffRest.from('profiles').select('user_id')
  expect(visible.data).toHaveLength(1)
  await staffRest.auth.signOut({ scope: 'local' })

  expect((await storedProfileByEmail(STAFF.email)).role).toBe('staff')
})

// ---------------------------------------------------------------------------
// 11. Cleanup — nothing left behind
// ---------------------------------------------------------------------------

test('the run removes the identity it created and leaves exactly the two seeded accounts, the seeded Owner the last active owner', async () => {
  await deleteLocalAuthUser(INVITEE_EMAIL)
  await restoreSeededIdentities()

  expect(await findLocalAuthUser(INVITEE_EMAIL)).toBeNull()
  const profiles = await listLocalProfiles()
  expect(profiles.map((profile) => `${profile.name}/${profile.role}/${profile.disabledAt === null ? 'active' : 'off'}`).sort()).toEqual([
    'Lokal Ejer/owner/active',
    'Lokal Medarbejder/staff/active',
  ])

  await openUsersAdmin(ownerPage)
  await expect(ownerPage.getByRole('listitem')).toHaveCount(2)
  await expect(userRow(ownerPage, INVITEE_EMAIL)).toHaveCount(0)
  await expect(userRow(ownerPage, OWNER.email)).toContainText(LAST_OWNER_NOTE)
})
