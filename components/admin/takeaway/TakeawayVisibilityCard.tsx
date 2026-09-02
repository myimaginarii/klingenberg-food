import { CardPendingBadge } from '@/components/admin/PendingBand'
import { SubmitButton } from '@/components/admin/SubmitButton'
import {
  describeTakeawayVisibility,
  TAKEAWAY_CARD_LABELS,
  TAKEAWAY_PENDING_CARD_NOTE,
  TAKEAWAY_VISIBILITY_HINT,
} from '@/lib/pages/takeaway'

/**
 * "Vis siden på hjemmesiden" — design 1aj; technical plan §4, §6, §9 (E2E 8).
 *
 * A real checkbox drawn as 1aj's switch — the `<input>` visually hidden inside its
 * own `<label>`, the track drawn by `peer-checked` — the same control 1ah's "Vis på
 * forsiden" and 1ag's Lørdagsmenu toggle use, for the same reasons: Space and Tab
 * work, the state is announced as checked or not, the form submits with no
 * JavaScript, and the focus ring lands on the track a person can see.
 *
 * A DRAFT, SAID OUT LOUD. The card carries 1aj's own helper — *"Slå fra, og både siden
 * og menupunktet forsvinder helt."* — and beneath it a sentence that states what the
 * hjemmeside shows **right now** and what Offentliggør would change, computed from the
 * published column and the pending draft (`describeTakeawayVisibility`). So a person
 * is told the consequence before pressing anything, and told that nothing has changed
 * for a guest until they publish. The state is never colour alone: the word beside
 * the switch and the sentence under it carry it.
 */
export function TakeawayVisibilityCard({
  anchorId,
  action,
  fieldNames,
  version,
  currentVisible,
  liveVisible,
  pending,
}: {
  anchorId: string
  action: (formData: FormData) => Promise<void>
  fieldNames: { readonly version: string; readonly visible: string }
  /** The `updated_at` this form was rendered from — the concurrency token (§6). */
  version: string
  /** The switch as the pending draft leaves it — what the control shows. */
  currentVisible: boolean
  /** The switch as a guest gets it right now. */
  liveVisible: boolean
  pending: boolean
}) {
  const headingId = `${anchorId}-titel`
  const toggleId = `${anchorId}-kontakt`
  const helpId = `${anchorId}-hjaelp`
  const stateId = `${anchorId}-status`

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-label text-ink-3 uppercase" id={headingId}>
          {TAKEAWAY_CARD_LABELS.visibility}
        </h2>
        {pending ? <CardPendingBadge note={TAKEAWAY_PENDING_CARD_NOTE} /> : null}
      </div>

      <form action={action} aria-label={TAKEAWAY_CARD_LABELS.visibility} className="flex flex-col gap-4">
        <input name={fieldNames.version} type="hidden" value={version} />

        <div className="rounded-field border-field-border bg-field-bg flex items-center justify-between gap-3 border-[1.5px] p-3">
          <p className="min-w-0">
            <label className="text-neutral-ink font-semibold" htmlFor={toggleId}>
              {currentVisible ? 'Siden vises' : 'Siden er skjult'}
            </label>
            <span className="text-ink-2 text-meta block" id={helpId}>
              {TAKEAWAY_VISIBILITY_HINT}
            </span>
          </p>

          <label className="min-h-tap flex shrink-0 cursor-pointer items-center" htmlFor={toggleId}>
            <input
              aria-describedby={`${helpId} ${stateId}`}
              className="peer sr-only"
              defaultChecked={currentVisible}
              id={toggleId}
              name={fieldNames.visible}
              type="checkbox"
              value="1"
            />
            <span
              aria-hidden="true"
              className="rounded-badge bg-rule peer-checked:bg-success peer-focus-visible:outline-focus after:absolute after:top-[0.1875rem] after:left-[0.1875rem] after:size-6 after:rounded-full after:bg-white after:transition-[left] after:content-[''] peer-checked:after:left-[1.5625rem] relative inline-block h-[1.875rem] w-[3.25rem] shrink-0 transition-colors peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2"
            />
          </label>
        </div>

        <p className="text-ink-2 text-meta" id={stateId}>
          {describeTakeawayVisibility(liveVisible, currentVisible)}
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Gem</SubmitButton>
        </div>

        <p className="text-ink-3 text-micro">
          Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Offentliggør — så
          forsvinder eller vises siden og menupunktet på én gang.
        </p>
      </form>
    </section>
  )
}
