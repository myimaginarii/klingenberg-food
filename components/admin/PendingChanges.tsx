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

import { SubmitButton } from './SubmitButton'

/**
 * "Ændringer der venter" — technical plan §6, design 1q.
 *
 * PHASE 4 SCOPE. This is the working part of the Oversigt screen, not the finished
 * one: the list, the per-item checkbox that lets somebody leave a colleague's work out
 * of a publish, the per-item preview link, and the button. The visual design of 1q,
 * the counts, the section tiles and the mobile layout are phases 4 onward in the
 * approved language and are not invented here.
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

export function PendingChanges({
  changes,
  profile,
  action,
}: {
  changes: readonly PendingChange[]
  profile: Profile
  action: (formData: FormData) => Promise<void>
}) {
  if (changes.length === 0) {
    return (
      <p className="text-ink-2 text-meta">
        Der er ingen ændringer, der venter på at blive offentliggjort. Alt på siden er live.
      </p>
    )
  }

  return (
    <form action={action} aria-label="Ændringer der venter" className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
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
              className="border-border rounded-field flex flex-wrap items-start gap-3 border p-3"
            >
              <input
                className="mt-1 size-5 shrink-0"
                type="checkbox"
                name={PUBLISH_SELECTION_FIELD}
                value={value}
                id={value}
                defaultChecked={allowed}
                disabled={!allowed}
              />

              <div className="min-w-0 flex-1">
                <label className="text-meta font-semibold" htmlFor={value}>
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
                href={`/api/preview/start?maal=${previewTargetForEntity(change.entity)}`}
              >
                Forhåndsvis
              </a>
            </li>
          )
        })}
      </ul>

      <div>
        <SubmitButton>Offentliggør valgte ændringer</SubmitButton>
      </div>
    </form>
  )
}
