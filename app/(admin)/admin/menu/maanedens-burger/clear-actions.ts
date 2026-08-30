'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { readAdminMonthlyBurger } from '@/lib/content/monthly-admin'
import { monthlyDraftWrite, type MonthlyField } from '@/lib/menu/monthly'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import { MONTHLY_CLEAR_FORM } from './forms'
import { monthlyHref } from './routes'

/**
 * "Ryd felterne" — design 1ah's footer control.
 *
 * 1ah's own note says what this screen is for: *"Månedens burger er én post, der
 * genbruges — man overskriver den forrige i stedet for at oprette en ny hver måned."*
 * Emptying three fields by hand on a phone at the end of a month is exactly the tedium
 * that button removes.
 *
 * **It is an ordinary draft change.** It writes `draft` and nothing else, so the public
 * menu and the Forside are byte-identical afterwards, and it expires no cache tag. That
 * is also why it needs no confirmation: nothing a guest can see has moved, the fields
 * are on screen showing the result, and Offentliggør is still a separate press. (The two
 * operations in this administration that *do* confirm — Slet ret and this screen's
 * expired-period publish — confirm because they change the hjemmeside or cannot be seen
 * before they happen.)
 *
 * WHAT IT CLEARS, AND WHAT IT DELIBERATELY LEAVES
 *
 * The three things somebody types about the food: `name`, `description` and `price_ore`.
 *
 *   * **Not the period.** `starts_on` / `ends_on` are when the slot runs, not what is in
 *     it — and a month whose dates survive is a month somebody can write the next burger
 *     into without re-entering them.
 *   * **Not "Vis på forsiden".** It is a setting about where this slot appears, and it
 *     is the same answer month after month. Clearing it would silently switch the
 *     Forside section off for whoever fills the card in next.
 *   * **Not `image_id`.** No editor owns it before phase 10 (§0b), and a field no editor
 *     owns must not be cleared by one either.
 *   * **Not `sold_out_on`.** It is not a draft field at all (§6), so nothing on this
 *     path can reach it.
 *
 * That is the same reading §0c records for the weekly rollover, applied to the control
 * 1ah draws instead of a week dropdown: "the form" means the words about the food.
 *
 * ITS OWN FORM AND ITS OWN ACTION, RATHER THAN A SECOND SUBMIT BUTTON
 *
 * Two submit buttons in one `<form>` would make the *first in tree order* the one the
 * Enter key presses inside a text field. Getting the frame's left-to-right arrangement
 * and the keyboard's expectation to agree then needs either a hidden decoy button or a
 * visual order that does not match the tab order — and both are worse than one more
 * fifty-line action whose whole behaviour is readable in one sitting. It also means the
 * two operations have disjoint field vocabularies: this form carries one hidden version
 * token and nothing else, so it cannot write a name even if one were submitted to it.
 */
export async function clearMonthlyBurgerFields(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const target = draftTargetSchema.safeParse({
    entity: 'monthly_burger',
    expectedUpdatedAt: formData.get(MONTHLY_CLEAR_FORM.version),
  })
  if (!target.success) redirect(monthlyHref({ status: 'ugyldig', focus: true }))

  const burger = await readAdminMonthlyBurger()
  if (burger === null) redirect(monthlyHref({ status: 'not_found' }))

  // The values this operation owns, and only those three. `monthlyDraftWrite` then does
  // what every other save on this screen does: keep the ones that differ from the
  // published values, and take the ones that no longer differ back out of the draft — so
  // clearing an already-empty burger leaves no draft behind and no Kladde badge on a
  // card with nothing waiting (§4).
  const cleared: MonthlyField[] = ['name', 'description', 'price_ore']

  const write = monthlyDraftWrite(
    { name: null, description: null, price_ore: null },
    burger.live,
    cleared,
  )

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
      status: result.status === 'saved' ? 'ryddet' : result.status,
    }),
  )
}
