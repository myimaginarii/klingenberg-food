'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { readAdminMonthlyBurger } from '@/lib/content/monthly-admin'
import { monthlyDraftWrite } from '@/lib/menu/monthly'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import {
  encodeMonthlyEcho,
  MONTHLY_FORM,
  readMonthlyForm,
  toMonthlySubmission,
} from './forms'
import { monthlyHref } from './routes'

/**
 * Gem — saving Månedens burger as a draft. Design 1ah, technical plan §6, §7d.
 *
 * Thin, and in a fixed order:
 *
 *   1. establish who is asking        — requireStaff()
 *   2. parse the target               — draftTargetSchema (entity + version token)
 *   3. read the server's own row      — lib/content/monthly-admin.ts
 *   4. map the form to values         — ./forms.ts
 *   5. reduce it to what changed      — lib/menu/monthly.ts (§4)
 *   6. write the draft                — lib/publishing/drafts.ts
 *   7. report                         — a redirect back to the card
 *
 * **Nothing here writes to the public site**, and nothing here expires a cache tag. A
 * draft is a draft: the live columns are untouched, so the public menu and the Forside
 * are byte-identical to what they were before this ran. The only things on this screen
 * that expire a public tag are a successful publish (`./publish-actions.ts`) and an
 * immediate Udsolgt (`./availability-actions.ts`).
 *
 * **"Vis på forsiden" is saved by this action, like every other field.** It is a normal
 * draft field (§7d, §7e item 3): turning it on or off changes the administration and the
 * preview, and changes nothing a guest can see until somebody presses Offentliggør. It
 * is deliberately *not* on the immediate path — §6 names exactly four immediate
 * operations and this is not one of them — and there is no separate action, no separate
 * form and no separate RPC by which it could become one.
 *
 * No validation, authorization, SQL or merge logic lives in this file. `saveEntityDraft`
 * re-parses the values against `monthlyBurgerDraft` — strictly, so an unknown key is a
 * refusal — re-checks the role matrix, applies the version token as optimistic
 * concurrency, and merges the new values into any existing draft. None of that is
 * reimplemented for the monthly burger, which is the whole reason phase 4 built it.
 *
 * `merge` PLUS AN EXPLICIT `clear`, NEVER `replace`
 *
 * This is the only editor on the row *today*, so `replace` would happen to work — and
 * that is exactly the reasoning phase 5E had to undo once already. `image_id` is a field
 * this editor does not draw and does not own (phase 10), and a `replace` would delete it
 * every time somebody saved a price. So the save merges the fields it owns and clears
 * only those of them that no longer differ from the published values; everything else in
 * the draft is not mentioned in either direction and survives untouched.
 */
export async function saveMonthlyBurgerDraft(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const target = draftTargetSchema.safeParse({
    entity: 'monthly_burger',
    expectedUpdatedAt: formData.get(MONTHLY_FORM.version),
  })
  if (!target.success) redirect(monthlyHref({ status: 'ugyldig', focus: true }))

  const burger = await readAdminMonthlyBurger()
  if (burger === null) redirect(monthlyHref({ status: 'not_found' }))

  const form = readMonthlyForm(formData)
  const submission = toMonthlySubmission(form)

  if (!submission.ok) {
    redirect(
      monthlyHref(
        { status: 'ugyldig', focus: true },
        encodeMonthlyEcho(form, submission.errors),
      ),
    )
  }

  // The delta is measured against the **published** values, not against what the form
  // was rendered with, so a field edited back to what the hjemmeside already says stops
  // being a pending change (§4).
  const write = monthlyDraftWrite(submission.values, burger.live)

  const result = await saveEntityDraft(profile, {
    entity: 'monthly_burger',
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    monthlyHref({
      focus: true,
      status: result.status === 'saved' ? 'gemt' : result.status,
    }),
  )
}
