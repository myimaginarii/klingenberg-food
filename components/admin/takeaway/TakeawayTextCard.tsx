import { TextAreaField, TextField } from '@/components/admin/Field'
import { CardPendingBadge } from '@/components/admin/PendingBand'
import { SubmitButton } from '@/components/admin/SubmitButton'
import {
  TAKEAWAY_CARD_LABELS,
  TAKEAWAY_INTRO_HINT,
  TAKEAWAY_PENDING_CARD_NOTE,
} from '@/lib/pages/takeaway'
import { TAKEAWAY_HEADING_MAX, TAKEAWAY_INTRO_MAX } from '@/lib/schemas/page-documents'

/**
 * The "Tekst" card — 1aj's "Overskrift" and "Intro", with the image slot beneath.
 *
 * A plain `<form>` posting to a Server Action, like every other form in this
 * administration: no client component, no controlled inputs. The image slot is a
 * **sibling** of the Gem form, never a field inside it: its removal control is a form
 * of its own, forms cannot nest, and a selection is its own draft write (phase 10C-1's
 * arrangement, unchanged).
 *
 * Nothing is added to 1aj: two fields under the frame's own labels, the frame's own
 * helper under the intro, and the slot. No link field, no second paragraph.
 */
export function TakeawayTextCard({
  anchorId,
  action,
  fieldNames,
  values,
  version,
  errorFor,
  pending,
  imagePending,
  imageSlot,
}: {
  anchorId: string
  action: (formData: FormData) => Promise<void>
  fieldNames: { readonly version: string; readonly heading: string; readonly intro: string }
  values: { readonly heading: string; readonly intro: string }
  /** The `updated_at` this form was rendered from — the concurrency token (§6). */
  version: string
  errorFor: (field: 'overskrift' | 'intro') => string | undefined
  /** True when the heading or the intro is in the stored draft. */
  pending: boolean
  /** True when the image is in the stored draft. */
  imagePending: boolean
  /** The `ImagePickerField`, rendered by the page — a sibling of the form. */
  imageSlot: React.ReactNode
}) {
  const headingId = `${anchorId}-titel`

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-label text-ink-3 uppercase" id={headingId}>
          {TAKEAWAY_CARD_LABELS.text}
        </h2>
        {pending ? <CardPendingBadge note={TAKEAWAY_PENDING_CARD_NOTE} /> : null}
      </div>

      <form action={action} aria-label={TAKEAWAY_CARD_LABELS.text} className="flex flex-col gap-4">
        <input name={fieldNames.version} type="hidden" value={version} />

        <TextField
          defaultValue={values.heading}
          error={errorFor('overskrift')}
          id={`${anchorId}-overskrift`}
          label="Overskrift"
          maxLength={TAKEAWAY_HEADING_MAX}
          name={fieldNames.heading}
        />

        <TextAreaField
          defaultValue={values.intro}
          error={errorFor('intro')}
          hint={TAKEAWAY_INTRO_HINT}
          id={`${anchorId}-intro`}
          label="Intro"
          maxLength={TAKEAWAY_INTRO_MAX}
          name={fieldNames.intro}
          rows={3}
        />

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Gem</SubmitButton>
        </div>

        <p className="text-ink-3 text-micro">
          Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Offentliggør.
        </p>
      </form>

      <div className="border-border mt-4 flex flex-col gap-3 border-t pt-4">
        {imagePending ? <CardPendingBadge note={TAKEAWAY_PENDING_CARD_NOTE} /> : null}
        {imageSlot}
      </div>
    </section>
  )
}
