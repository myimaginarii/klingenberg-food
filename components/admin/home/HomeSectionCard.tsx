import { TextAreaField, TextField } from '@/components/admin/Field'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { HOME_PENDING_CARD_NOTE } from '@/lib/pages/home'
import { HOME_HEADING_MAX, HOME_TEXT_MAX } from '@/lib/schemas/page-documents'

import { HomeCardPending } from './HomeNotices'

/**
 * One of the Forside's three text cards — 1u's "ØVERST PÅ SIDEN", "UDMÆRKELSEN" and
 * "OM OS (UDDRAG)".
 *
 * A plain `<form>` posting to a Server Action, like every other form in this
 * administration: no client component, no controlled inputs, and nothing in the
 * browser that has to be kept in step with the server. The card is a `<section>`
 * labelled by its own heading, so the screen has one `<h1>` in the bar and four named
 * regions beneath it.
 *
 * THE FIELDS ARE THE FRAME'S, AND ONLY THE FRAME'S
 *
 * Two words per card, under 1u's own labels, and the image slot beneath them. Nothing
 * is added: no link field, no colour, no layout choice, no second paragraph, and no
 * field the `pages.home` document does not already have (§4). The one departure from
 * 1u is recorded in the technical plan: the Om os card draws a heading beside its text,
 * because the public frame 1g draws one ("Lokal burgerbar i Carl Nielsen Hallen") and
 * the document has carried it since phase 3.
 *
 * ONE GEM PER CARD. The draft holds whole sections, so each card saves its own section
 * and nothing about the other three — and the image slot is a **sibling** of the Gem
 * form, never a field inside it: its removal control is a form of its own, forms cannot
 * nest, and a selection is its own draft write (phase 10C-1's arrangement, unchanged).
 *
 * 1u draws no Gem: its bar carries Forhåndsvis and Offentliggør, and its fields carry
 * the Kladde badge. This administration's one saving convention for a draft editor is
 * the explicit Gem every other card uses (1t, 1ag, 1ah, 1ad), and no second convention
 * is invented here — recorded as a reading in the technical plan.
 */
export type HomeSectionFieldNames = {
  readonly version: string
  readonly section: string
  readonly heading: string
  readonly text: string
}

export function HomeSectionCard({
  anchorId,
  eyebrow,
  section,
  action,
  fieldNames,
  labels,
  values,
  version,
  errorFor,
  pending,
  imageSlot,
  textRows = 3,
}: {
  anchorId: string
  /** 1u's card eyebrow — the section's name in the administration. */
  eyebrow: string
  /** `hero`, `award` or `about_excerpt` — the hidden field the action reads. */
  section: string
  action: (formData: FormData) => Promise<void>
  fieldNames: HomeSectionFieldNames
  labels: { readonly heading: string; readonly text: string }
  values: { readonly heading: string; readonly text: string }
  /** The `updated_at` this form was rendered from — the concurrency token (§6). */
  version: string
  /** The message for one field, or undefined. Bound with `aria-describedby`. */
  errorFor: (field: 'overskrift' | 'tekst') => string | undefined
  /** True when this section is in the stored draft. */
  pending: boolean
  /** The section's `ImagePickerField`, rendered by the page — a sibling of the form. */
  imageSlot: React.ReactNode
  textRows?: number
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
        {pending ? <HomeCardPending note={HOME_PENDING_CARD_NOTE} /> : null}
      </div>

      <form action={action} aria-label={eyebrow} className="flex flex-col gap-4">
        <input name={fieldNames.version} type="hidden" value={version} />
        <input name={fieldNames.section} type="hidden" value={section} />

        <TextField
          defaultValue={values.heading}
          error={errorFor('overskrift')}
          id={`${anchorId}-overskrift`}
          label={labels.heading}
          maxLength={HOME_HEADING_MAX}
          name={fieldNames.heading}
        />

        <TextAreaField
          defaultValue={values.text}
          error={errorFor('tekst')}
          id={`${anchorId}-tekst`}
          label={labels.text}
          maxLength={HOME_TEXT_MAX}
          name={fieldNames.text}
          rows={textRows}
        />

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Gem</SubmitButton>
        </div>

        <p className="text-ink-3 text-micro">
          Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Offentliggør.
        </p>
      </form>

      <div className="border-border mt-4 border-t pt-4">{imageSlot}</div>
    </section>
  )
}
