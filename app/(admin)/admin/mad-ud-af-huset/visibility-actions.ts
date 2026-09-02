'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { readAdminTakeawayPage } from '@/lib/content/takeaway-admin'
import { takeawayVisibilityWrite } from '@/lib/pages/takeaway'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import { readTakeawayVisibilityForm, TAKEAWAY_VISIBILITY_FORM } from './forms'
import { CARD_ANCHOR, takeawayHref } from './routes'

/**
 * "Vis siden på hjemmesiden" — design 1aj; technical plan §4, §6, §9 (E2E 8);
 * phase 11B.
 *
 * **A draft change, deliberately.** 1aj draws the switch among the fields and states
 * the page's one process for all of them — *"alt gemmes som kladde, forhåndsvises på
 * den rigtige side og går først live ved Offentliggør"* — and §6's immediate-path
 * table names four operations, none of which is this. So the requested state is
 * written into the draft under `is_visible`, measured against the **published**
 * column (a value already live leaves the draft, so nothing waits), and it reaches
 * the hjemmeside — the page and the navigation item together — when `publish_page()`
 * moves it into the column. The preview shows the pending state; the guest keeps the
 * published one. Nothing here writes `is_visible` itself: the database refuses that
 * for every browser role (migration 20260902160000), and this action does not try.
 *
 * `requireStaff()` first (§5: the switch is Staff and Owner alike), `mayChangeEntity`
 * second, `pages_update_scoped` third — the same three refusals every write on this
 * screen meets.
 */
export async function saveTakeawayVisibility(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const target = draftTargetSchema.safeParse({
    entity: 'page:takeaway',
    expectedUpdatedAt: formData.get(TAKEAWAY_VISIBILITY_FORM.version),
  })
  if (!target.success) redirect(takeawayHref({ status: 'ugyldig' }))

  const page = await readAdminTakeawayPage()
  if (page === null) redirect(takeawayHref({ status: 'not_found' }))

  const requested = readTakeawayVisibilityForm(formData)
  const write = takeawayVisibilityWrite(requested, page.liveVisible)

  const result = await saveEntityDraft(profile, {
    entity: 'page:takeaway',
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    takeawayHref({
      focus: CARD_ANCHOR.visibility,
      status:
        result.status !== 'saved'
          ? result.status
          : write.clear.length > 0
            ? 'synlighed_uaendret'
            : requested
              ? 'synlighed_til'
              : 'synlighed_fra',
    }),
  )
}
