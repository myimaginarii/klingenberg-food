import { describePendingCount } from '@/lib/admin/dashboard'
import { previewTargetForEntity } from '@/lib/drafts/targets'
import { formatCopenhagenClock, formatWeekdayDate } from '@/lib/hours/format'
import { copenhagenDateOf } from '@/lib/time/copenhagen'
import type { PendingChange } from '@/lib/publishing/pending'
import type { Profile } from '@/lib/auth/session'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import {
  encodePublishSelection,
  PUBLISH_SELECTION_FIELD,
} from '@/lib/publishing/requests'

/**
 * "2 ændringer er ikke offentliggjort" — technical plan §6, design 1x / 1q.
 *
 * The band under the bar is the frames': the amber diamond, the count, Forhåndsvis and
 * Offentliggør — side by side and full width on the phone (1x), in one row from `md`
 * (1q; its sub-line naming the items is the list's job here). Beneath it is the phase-4 list, unchanged in
 * what it says: one row per pending change, its state, who touched it last and when,
 * its own Forhåndsvis, and the checkbox that lets somebody leave a colleague's work out
 * of a publish. The count, the names and the rows all come from `pending_changes`, the
 * view that derives the list from `draft is not null` and the status columns (§4) — the
 * dashboard counts nothing itself and defines "pending" nowhere.
 *
 * Nothing renders when nothing is pending: 1x and 1q draw no band then, and the
 * dashboard's LIGE NU says what *is* on the hjemmeside.
 *
 * Everything visible is a plain form. There is no client JavaScript on this page at
 * all, which keeps the administration usable on a phone with a poor connection — the
 * primary admin device (§15, phase 12).
 *
 * OWNER-ONLY ITEMS ARE SHOWN, NOT HIDDEN
 *
 * A staff member sees that the Forsiden has a pending change and sees that they may
 * not publish it, rather than seeing a list that silently disagrees with the owner's.
 * The checkbox is disabled, which is a courtesy and nothing more: the server
 * re-authorizes every submitted item individually, so removing the `disabled`
 * attribute in a browser achieves precisely nothing.
 *
 * THE BAND'S FORHÅNDSVIS
 *
 * Draft Mode is site-wide once started (§6), so the band's link only has to choose
 * where to land: the page of the change edited most recently — the first row, in the
 * view's own order. Each row keeps its own link to its own page.
 */

/** "onsdag 27.08 kl. 14:12" — when somebody last touched this item. */
function editedAt(isoTimestamp: string): string {
  const instant = new Date(isoTimestamp)
  return `${formatWeekdayDate(copenhagenDateOf(instant))} kl. ${formatCopenhagenClock(instant)}`
}

function stateLabel(change: PendingChange): string {
  return change.state === 'draft' ? 'Kladde' : 'Ikke offentliggjort'
}

function title(change: PendingChange): string {
  return change.subject === null ? change.label : `${change.label}: ${change.subject}`
}

function previewHref(change: PendingChange): string {
  return `/api/preview/start?maal=${previewTargetForEntity(change.entity)}`
}

export function PendingChanges({
  changes,
  profile,
  action,
}: {
  changes: readonly PendingChange[]
  profile: Profile
  action: (formData: FormData) => Promise<void>
}) {
  const first = changes[0]
  if (first === undefined) return null

  return (
    <form
      action={action}
      aria-label="Ændringer der venter"
      className="border-warning-border bg-warning-surface border-b"
    >
      <div className="mx-auto flex max-w-content flex-col gap-2.5 px-gutter py-3.5 md:flex-row md:items-center md:gap-4 md:px-8 md:py-4">
        {/*
          Not a live region: the band is a standing state inside a form that already
          names itself, and the page's live regions are the outcome notices below it,
          which the locked suites read as the first `status` on the page.
        */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5 md:gap-4">
          <span aria-hidden="true" className="bg-warning size-4 shrink-0 rotate-45 md:size-5" />
          {/*
            The count alone. 1q also draws the names of what waits under it; here the
            list beneath the band names every item once, with its checkbox — and the
            locked suites address a pending item by its title inside this form, which
            has to stay unique.
          */}
          <p className="text-warning-ink min-w-0 flex-1 text-[0.96875rem] font-semibold md:text-[1.0625rem]">
            {describePendingCount(changes.length)}
          </p>
        </div>

        <div className="flex gap-2.5 md:gap-3">
          <a
            className="rounded-field border-warning-ink text-warning-ink hover:bg-surface flex min-h-[3rem] flex-1 items-center justify-center border-[1.5px] px-5 font-semibold md:min-h-[2.875rem] md:flex-none"
            href={previewHref(first)}
          >
            Forhåndsvis
          </a>
          <button
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field flex min-h-[3rem] flex-1 items-center justify-center px-5 font-semibold text-white md:min-h-[2.875rem] md:flex-none"
            type="submit"
          >
            Offentliggør
          </button>
        </div>
      </div>

      <ul className="mx-auto flex max-w-content flex-col gap-2 px-gutter pb-3.5 md:px-8 md:pb-4">
        {changes.map((change) => {
          const allowed = mayChangeEntity(change.entity, profile)
          const value = encodePublishSelection({
            entity: change.entity,
            entityId: change.entityId,
            expectedUpdatedAt: change.updatedAt,
          })

          return (
            <li
              key={`${change.entity}:${change.entityId}`}
              className="border-warning-border bg-surface rounded-field flex flex-wrap items-start gap-3 border p-3"
            >
              {/*
                The checkbox's tap target is this wrapper — 44 × 44 (1aa), a label of its
                own so a thumb beside the 20 px box still toggles it; the row's title label
                (`htmlFor`) carries the accessible name, and this one adds no words.
              */}
              <label className="min-h-tap min-w-tap -my-2 -ml-2 flex shrink-0 items-center justify-center">
                <input
                  className="size-5"
                  type="checkbox"
                  name={PUBLISH_SELECTION_FIELD}
                  value={value}
                  id={value}
                  defaultChecked={allowed}
                  disabled={!allowed}
                />
              </label>

              <div className="min-w-0 flex-1">
                <label className="text-meta font-semibold wrap-anywhere" htmlFor={value}>
                  {title(change)}
                </label>

                <p className="text-ink-2 text-meta mt-1">
                  <span aria-hidden="true">● </span>
                  {stateLabel(change)}
                  {' · '}
                  {change.editorName === null
                    ? 'ukendt redaktør'
                    : `sidst rettet af ${change.editorName}`}
                  {' · '}
                  {editedAt(change.updatedAt)}
                </p>

                {allowed ? null : (
                  <p className="text-warning-ink text-meta mt-1 font-medium">
                    <span aria-hidden="true">● </span>
                    Kun ejeren kan offentliggøre dette.
                  </p>
                )}
              </div>

              <a
                className="text-brand-700 text-meta min-h-tap inline-flex items-center underline"
                href={previewHref(change)}
              >
                Forhåndsvis
              </a>
            </li>
          )
        })}
      </ul>
    </form>
  )
}
