'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readAdminMonthlyBurger } from '@/lib/content/monthly-admin'
import { monthlyPublishOutlook } from '@/lib/menu/monthly'
import { readPendingChanges } from '@/lib/publishing/pending'
import { publishPendingChanges, tagsToExpire } from '@/lib/publishing/publish'

import { readMonthlyPublishConfirmation } from './forms'
import { monthlyHref } from './routes'

/**
 * "Offentliggør" on the Månedens burger screen — design 1ah, technical plan §6, §7d.
 *
 * §6: *"Section screens publish their own scope."* This screen's scope is one entity —
 * `monthly_burger` — which is one singleton row, so there is one draft and one publish.
 *
 * The action takes **one** input from the browser, and it is not content:
 *
 *   1. `requireStaff()` establishes who is asking.
 *   2. `readPendingChanges()` — the `security_invoker` view — says what is pending, so
 *      RLS decides which rows exist. The list is narrowed to this screen's one entity,
 *      and an empty one ends here: a screen with nothing waiting must say so rather than
 *      ask a question about a publish that was never going to happen.
 *   3. `readAdminMonthlyBurger()` says what publishing *would produce* — the live row
 *      with the draft merged over it — through this person's own JWT.
 *   4. §7d's window check is applied to that, and may stop here and ask (below).
 *   5. `publishPendingChanges` publishes it, re-authorizing it against the entity the
 *      server resolved (§5, §8).
 *   6. Only then is the `monthly` cache tag expired, and only if it actually published.
 *
 * So there is no entity name, no id and no version token in the request. A forged POST
 * can ask for this person's own pending monthly change to be published and nothing else.
 *
 * **There is no second publishing system here.** The transaction, the audit row, the
 * concurrency check and the draft-clearing all live in `lib/publishing/publish.ts` and
 * `public.publish_monthly_burger()`, both untouched since phase 4. The menu screen's own
 * button deliberately excludes this entity (`lib/menu/pending.ts`), so publishing
 * Månedens burger from a screen that never showed it to anybody is not possible either.
 *
 * §7d's TWO WINDOW WARNINGS, AND WHY THEY ARE NOT THE SAME KIND OF THING
 *
 *   * **`ends_on` already in the past** — §7d: *"Publishing with `ends_on` already in
 *     the past warns first"*. The first press therefore publishes **nothing**: it comes
 *     back with the confirmation, and only a form that carries the confirmation's own
 *     field goes through. A person who types `?udloebet=1` into the address bar gets the
 *     question, not the answer.
 *   * **`starts_on` in the future** — §7d: *"allowed, and the confirmation states
 *     exactly when it will appear — that is the intended workflow"*. So it is **not** an
 *     error and **not** a question. It publishes, and the screen then states the date
 *     twice over: in the success message and in the standing computed state. Turning
 *     scheduled content into an obstacle is the one thing §7d rules out.
 *
 * **Neither warning changes a date.** Nothing in this file writes `starts_on` or
 * `ends_on`, in any branch. A warning that quietly corrected the window would be an
 * administration deciding what a person meant.
 */
export async function publishMonthlyBurger(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const confirmed = readMonthlyPublishConfirmation(formData)

  const pending = (await readPendingChanges()).filter(
    (change) => change.entity === 'monthly_burger',
  )

  // Asked before §7d's question, and deliberately: with nothing pending there is no
  // publish to warn about, and a confirmation for one would be a dialog that could only
  // ever be answered "yes" to no effect.
  if (pending.length === 0) redirect(monthlyHref({ status: 'intet_valgt' }))

  const burger = await readAdminMonthlyBurger()
  if (burger === null) redirect(monthlyHref({ status: 'not_found' }))

  // What a guest would read afterwards — the live row with the draft over it, which is
  // exactly what `publish_monthly_burger()` merges. One clock for the whole decision.
  const outlook = monthlyPublishOutlook(burger.current, new Date())

  if (outlook === 'expired' && !confirmed) {
    // Nothing has happened. The screen opens the confirmation; the person decides.
    redirect(monthlyHref({ confirmExpired: true }))
  }

  const results = await publishPendingChanges(
    profile,
    pending.map((change) => ({
      entity: change.entity,
      entityId: change.entityId,
      expectedUpdatedAt: change.updatedAt,
    })),
  )

  // Only now, and only for what actually went live.
  expirePublicCacheTags(tagsToExpire(results))

  const published = results.some((result) => result.status === 'published')

  if (!published) redirect(monthlyHref({ status: 'publish_failed' }))

  redirect(monthlyHref({ focus: true, status: PUBLISHED_STATUS[outlook] }))
}

/**
 * What the screen says after a publish, decided by what the publish put live.
 *
 * Four outcomes rather than one "Offentliggjort", because the difference between them is
 * the whole of what §7d asks the administration to be able to explain: a burger that is
 * on the hjemmeside now, one that will be, one that never will be, and a cleared field.
 * The scheduled sentence carries the real date; it is composed on the page from the
 * published values (`describeScheduledPublish`) rather than written down here, so the
 * month is never hard-coded.
 */
const PUBLISHED_STATUS = {
  immediate: 'offentliggjort',
  scheduled: 'offentliggjort_planlagt',
  expired: 'offentliggjort_udloebet',
  incomplete: 'offentliggjort_tomt',
} as const
