import { TextAreaField, TextField } from '@/components/admin/Field'
import { CardPendingBadge } from '@/components/admin/PendingBand'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { ABOUT_PENDING_CARD_NOTE } from '@/lib/pages/about'

/**
 * One of Om os's three cards — "Historien", "Holdet", "Køkken og tilberedning" (phase
 * 14B1), in the visual language the Forside's and Mad ud af huset's cards established.
 *
 * A plain `<form>` posting to a Server Action, like every other form in this
 * administration: no client component, no controlled inputs. The card is a `<section>`
 * labelled by its own heading, so the screen has one `<h1>` in the bar and three named
 * regions beneath it.
 *
 * ONE SHAPE, THREE CARDS. Each card is an optional heading field, one textarea and the
 * photo slot beneath — the story card's heading is the page's `<h1>`, the method card's
 * is its section heading, and the team card has none because 1i fixes "Holdet". The
 * image slot is a **sibling** of the Gem form, never a field inside it: its removal
 * control is a form of its own, forms cannot nest, and a selection is its own draft
 * write (phase 10C-1's arrangement, unchanged).
 *
 * Nothing is added to 1i: no link, no name, no role, no markup.
 */
export type AboutCardField = {
  readonly name: string
  readonly label: string
  readonly value: string
  readonly maxLength: number
  readonly hint?: string
  readonly error?: string
}

export function AboutSectionCard({
  anchorId,
  eyebrow,
  action,
  versionField,
  version,
  heading,
  text,
  textRows = 4,
  pending,
  imagePending,
  imageSlot,
}: {
  anchorId: string
  /** The card's fixed name in the administration — its eyebrow and its form's name. */
  eyebrow: string
  action: (formData: FormData) => Promise<void>
  versionField: string
  /** The `updated_at` this form was rendered from — the concurrency token (§6). */
  version: string
  /** The single-line field, when the card has one. */
  heading?: AboutCardField
  /** The card's textarea. */
  text: AboutCardField
  textRows?: number
  /** True when this card's words are in the stored draft. */
  pending: boolean
  /** True when this card's photograph is in the stored draft. */
  imagePending: boolean
  /** The card's `ImagePickerField`, rendered by the page — a sibling of the form. */
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
          {eyebrow}
        </h2>
        {pending ? <CardPendingBadge note={ABOUT_PENDING_CARD_NOTE} /> : null}
      </div>

      <form action={action} aria-label={eyebrow} className="flex flex-col gap-4">
        <input name={versionField} type="hidden" value={version} />

        {heading === undefined ? null : (
          <TextField
            defaultValue={heading.value}
            error={heading.error}
            hint={heading.hint}
            id={`${anchorId}-${heading.name}`}
            label={heading.label}
            maxLength={heading.maxLength}
            name={heading.name}
          />
        )}

        <TextAreaField
          defaultValue={text.value}
          error={text.error}
          hint={text.hint}
          id={`${anchorId}-${text.name}`}
          label={text.label}
          maxLength={text.maxLength}
          name={text.name}
          rows={textRows}
        />

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Gem</SubmitButton>
        </div>

        <p className="text-ink-3 text-micro">
          Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Offentliggør.
        </p>
      </form>

      <div className="border-border mt-4 flex flex-col gap-3 border-t pt-4">
        {imagePending ? <CardPendingBadge note={ABOUT_PENDING_CARD_NOTE} /> : null}
        {imageSlot}
      </div>
    </section>
  )
}
