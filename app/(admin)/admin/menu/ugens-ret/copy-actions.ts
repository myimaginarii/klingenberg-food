'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { copyPreviousWeekToDraft } from '@/lib/menu/weekly-copy'

import { readCopyForm } from './forms'
import { weeklyHref } from './routes'

/**
 * "Kopiér sidste uge" — design 1ag's own open question, closed as decision 4;
 * technical plan §6.
 *
 * Five steps, and the shortest action on this screen:
 *
 *   1. establish who is asking   — requireStaff()
 *   2. parse the submission      — ./forms.ts, strictly: a version and a confirmation
 *   3. perform the operation     — lib/menu/weekly-copy.ts → copy_weekly_special_to_draft
 *   4. ask, if a draft is in the way — the approved confirmation, as a URL state
 *   5. report                    — a redirect back to the copy control
 *
 * **It is kept entirely apart from publishing.** It calls no publish function, expires
 * no cache tag and writes no live column. Creating a draft changes nothing a guest can
 * see, so there is nothing for the public cache to be told — and a copy that expired a
 * tag would be claiming a change the database has not made.
 *
 * WHAT THE BROWSER IS ALLOWED TO SAY
 *
 * Two things: the version the screen was rendered from, and — only from the
 * confirmation's own form — that a person has agreed to overwrite the draft that is
 * already there. It says nothing about the source, nothing about the destination week
 * and nothing about any field. The week is computed on the server from the server's own
 * read; the content is read by the database from its own row.
 *
 * THE OVERWRITE QUESTION IS ASKED BY THE DATABASE, NOT BY THE SCREEN
 *
 * The first press sends no confirmation, so `copy_weekly_special_to_draft` answers
 * `needs_confirmation` and **writes nothing**. Only then does the screen render 1ag's
 * confirmation, and its button is the only control on the site that submits
 * `bekraeft=1`. A person who types `?kopier=1` into the address bar gets the question,
 * not the answer — the confirmation is a screen state, and the write still needs the
 * field.
 */
export async function copyPreviousWeek(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:save', weeklyHref({ status: RATE_LIMIT_STATUS }))

  const request = readCopyForm(formData)
  if (request === null) redirect(weeklyHref({ status: 'ugyldig', focus: 'copy' }))

  const result = await copyPreviousWeekToDraft(profile, {
    expectedUpdatedAt: request.expectedUpdatedAt,
    confirmOverwrite: request.confirmOverwrite,
  })

  if (result.status === 'needs_confirmation') {
    // Nothing has happened. The screen opens the confirmation; the person decides.
    redirect(weeklyHref({ confirmCopy: true }))
  }

  redirect(
    weeklyHref({
      focus: 'week',
      status: result.status === 'copied' ? 'kopieret' : `kopi_${result.status}`,
    }),
  )
}
