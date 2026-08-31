import { expect, type Page } from '@playwright/test'

import { overrideForm, pressAndSettle } from './hours-override'

/**
 * 1t's generated-announcement option and 1ae's conflict sheet, as a test speaks to them —
 * phase 8C-3B.
 *
 * Separate from `./hours-override.ts` for the reason the components are separate: that
 * file drives the **hours**, this one drives the optional **message**, and §7e item 8
 * keeps them two things. A scenario that publishes hours and then answers a sheet reads
 * as two steps here, which is what it is.
 *
 * Everything is found by its accessible name or its label — never by a class, a test id
 * or a DOM position — so a helper that still works is evidence the control is still
 * reachable by somebody using a screen reader or a keyboard.
 */

/** 1t's checkbox. Absent entirely when the generator refuses (§4). */
export function announcementOption(page: Page) {
  return overrideForm(page).getByRole('checkbox', {
    name: 'Vis også som besked øverst på hjemmesiden',
  })
}

/** The editable suggestion beneath it. */
export function announcementMessage(page: Page) {
  return overrideForm(page).getByLabel('Foreslået besked — ret den gerne')
}

/** The sentence that stands where the option would be when there is nothing to suggest. */
export function announcementRefusal(page: Page) {
  return overrideForm(page).getByText(/ingen ændret åbningstid|allerede de tider|Tidspunktet er passeret|for lang/)
}

/**
 * Tick or clear 1t's checkbox, and wait for the card to follow.
 *
 * The **label** is pressed, not the input. 1aa requires a 44 px target and 1t draws the tick
 * as a small square, so the control is a `sr-only` `<input>` with a label that draws it and
 * carries the target — the same treatment the two kind chips and the seven weekday switches
 * use, and the same reason `chooseExpiryChip` presses a label on the announcement screen.
 * Clicking the input itself is clicking a one-pixel clipped element, which Playwright
 * correctly refuses to do.
 */
export async function setAnnouncementWanted(page: Page, wanted: boolean): Promise<void> {
  const box = announcementOption(page)

  await expect(box).toBeAttached()
  if ((await box.isChecked()) === wanted) return

  const id = await box.getAttribute('id')
  expect(id, 'the checkbox carries an id its label points at').not.toBeNull()

  await overrideForm(page).locator(`label[for="${id}"]`).click()
  await expect(box).toBeChecked({ checked: wanted })
}

/** Replace the suggested wording with one of somebody's own. */
export async function editAnnouncementMessage(page: Page, message: string): Promise<void> {
  await announcementMessage(page).fill(message)
  await expect(announcementMessage(page)).toHaveValue(message)
}

// ---------------------------------------------------------------------------
// 1ae
// ---------------------------------------------------------------------------

/**
 * The conflict sheet, as a real dialog.
 *
 * `getByRole('dialog')` and not a container lookup: the sheet is a native `<dialog>`
 * opened with `showModal()`, and asserting it through its role is what makes "it is a
 * modal dialog with an accessible name" part of every scenario that touches it.
 */
export function conflictSheet(page: Page) {
  return page.getByRole('dialog', { name: 'Der vises allerede en besked på hjemmesiden.' })
}

export function keepExistingButton(page: Page) {
  return conflictSheet(page).getByRole('link', { name: 'Behold eksisterende besked' })
}

export function replaceButton(page: Page) {
  return conflictSheet(page).getByRole('button', { name: 'Erstat med den nye besked' })
}

/** What the sheet says is showing now, and what it would be replaced by. */
export async function conflictMessages(
  page: Page,
): Promise<{ current: string; proposed: string }> {
  const sheet = conflictSheet(page)

  const current = sheet.getByRole('region', { name: 'Vises nu' })
  const proposed = sheet.getByRole('region', { name: 'Ny besked' })

  return {
    current: ((await current.locator('p').first().textContent()) ?? '').trim(),
    proposed: ((await proposed.locator('p').first().textContent()) ?? '').trim(),
  }
}

/** Press one of 1ae's two ways out and wait until the screen has moved. */
export async function resolveConflict(page: Page, choice: 'keep' | 'replace'): Promise<void> {
  const control = choice === 'keep' ? keepExistingButton(page) : replaceButton(page)

  await pressAndSettle(page, () => control.click())
  await expect(conflictSheet(page)).toHaveCount(0)
}

// ---------------------------------------------------------------------------
// The green strip
// ---------------------------------------------------------------------------

/** 1aa's Fortryd strip, as it appears on this screen. */
export function announcementUndoStrip(page: Page) {
  return page.getByRole('status').filter({ hasText: 'besked' }).filter({
    has: page.getByRole('button', { name: /^Fortryd/ }),
  })
}

export function announcementUndoButton(page: Page) {
  return announcementUndoStrip(page).getByRole('button', { name: /^Fortryd/ })
}

export async function pressAnnouncementUndo(page: Page): Promise<void> {
  await pressAndSettle(page, () => announcementUndoButton(page).click())
}
