import { DateField, FieldGroupError, TextAreaField, TextField } from '@/components/admin/Field'
import { SubmitButton } from '@/components/admin/SubmitButton'

/**
 * The article editor — design 1s (desktop) and 1z (right card, mobile); phase 9A.
 *
 * A plain `<form>` posting to a Server Action, like every editor in this
 * administration: no client component, no controlled inputs, and it works with
 * scripting off. 1s's fields, in 1s's order — Overskrift, the address beneath it
 * (§7f), Dato på hjemmesiden, the category chips, Tekst — and the image slot as the
 * approved *non-functional* treatment, because images are phase 10 and faking an
 * upload control that goes nowhere would be worse than saying so (phase brief §13).
 *
 * TWO DELIBERATE DEPARTURES FROM THE FRAME, RECORDED HERE
 *
 *   * **An explicit Gem button.** 1s autosaves ("Gemt for lidt siden"); autosave is a
 *     client component and belongs to phase 9B. Until then a form without a submit
 *     would be a form that cannot save at all.
 *   * **The Tekst field is a textarea, not the B/Link toolbar.** The toolbar is the
 *     same 9B client component. The helper line beneath the field states the 9A
 *     format instead of promising marks the field cannot make.
 *
 * The one thing this form *says* that a generic editor would not: what saving does.
 * News has no draft column, so an edit to a published article is public the moment it
 * is saved — `consequence` carries that sentence, rendered beside the button that
 * commits it, so the behaviour is stated where the decision is made (§4, §6).
 */

/** The category chips are radios; this value means "ingen kategori". */
const NO_CATEGORY = ''

/**
 * Structural copies of the form module's types, so this component does not import
 * from `app/` — the same rule `DishEditorPanel` records: a component in `components/`
 * reaching into `app/` would be the dependency the wrong way round.
 */
export type NewsEditorValues = {
  readonly title: string
  readonly displayDate: string
  readonly category: string
  readonly body: string
}

export type NewsEditorErrorField = 'overskrift' | 'dato' | 'kategori' | 'tekst'

export function NewsEditorForm({
  action,
  anchorId,
  fieldNames,
  heading,
  values,
  errorFor,
  categories,
  address,
  consequence,
  saveLabel,
  articleId,
  version,
}: {
  action: (formData: FormData) => Promise<void>
  anchorId: string
  fieldNames: {
    readonly articleId: string
    readonly version: string
    readonly title: string
    readonly displayDate: string
    readonly category: string
    readonly body: string
  }
  heading: string
  values: NewsEditorValues
  /** The message for one field, or undefined. Bound with `aria-describedby`. */
  errorFor: (field: NewsEditorErrorField) => string | undefined
  categories: readonly string[]
  /** §7f: the final URL under the title field, and whether it is frozen. Null for a new article. */
  address: { readonly path: string; readonly note: string } | null
  /** What saving does — the draft/published difference, said before the fact (§4). */
  consequence: string
  saveLabel: string
  /** Both present for an existing article, both absent for a new one. */
  articleId?: string
  version?: string
}) {
  const headingId = `${anchorId}-titel`
  const categoryErrorId = `${anchorId}-kategori-fejl`
  const categoryError = errorFor('kategori')

  return (
    <section aria-labelledby={headingId} className="bg-surface border-border rounded-card-lg border" id={anchorId}>
      <form action={action} aria-label={heading} className="flex flex-col gap-4 p-4 md:p-5">
        <h2 className="text-heading font-sans font-semibold" id={headingId}>
          {heading}
        </h2>

        {articleId === undefined ? null : (
          <input name={fieldNames.articleId} type="hidden" value={articleId} />
        )}
        {version === undefined ? null : (
          <input name={fieldNames.version} type="hidden" value={version} />
        )}

        <div className="flex flex-col gap-1.5">
          <TextField
            defaultValue={values.title}
            error={errorFor('overskrift')}
            id={`${anchorId}-overskrift`}
            label="Overskrift"
            maxLength={200}
            name={fieldNames.title}
          />

          {/* §7f: the admin shows the final URL under the title field. */}
          <p className="text-ink-3 text-micro">
            {address === null ? (
              'Nyheden får sin adresse ud fra overskriften, når du gemmer.'
            ) : (
              <>
                Adresse: <span className="text-ink-2 font-mono">{address.path}</span>
                {' — '}
                {address.note}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-5">
          <div className="md:w-52 md:shrink-0">
            <DateField
              defaultValue={values.displayDate}
              error={errorFor('dato')}
              hint="Datoen der vises på nyheden."
              id={`${anchorId}-dato`}
              label="Dato på hjemmesiden"
              name={fieldNames.displayDate}
            />
          </div>

          {/*
            1s's chips. Radios drawn as pills — the same control the announcement's
            suggestion chips are — plus "Ingen kategori", because the field is optional
            ("valgfrit") and a radio group without it could never be cleared again
            without JavaScript.
          */}
          <fieldset
            aria-describedby={categoryError === undefined ? undefined : categoryErrorId}
            aria-invalid={categoryError === undefined ? undefined : true}
            className="min-w-0 flex-1"
          >
            <legend className="text-meta text-neutral-ink mb-1.5 font-medium">
              Hvad handler den om? (valgfrit)
            </legend>
            <div className="flex flex-wrap gap-2">
              <CategoryChip
                checked={values.category === NO_CATEGORY}
                id={`${anchorId}-kategori-ingen`}
                name={fieldNames.category}
                value={NO_CATEGORY}
              >
                Ingen kategori
              </CategoryChip>
              {categories.map((category, index) => (
                <CategoryChip
                  checked={values.category === category}
                  id={`${anchorId}-kategori-${index}`}
                  key={category}
                  name={fieldNames.category}
                  value={category}
                >
                  {category}
                </CategoryChip>
              ))}
            </div>
            <FieldGroupError error={categoryError} id={categoryErrorId} />
          </fieldset>
        </div>

        <TextAreaField
          defaultValue={values.body}
          error={errorFor('tekst')}
          hint="Skriv det, som du ville fortælle det til en gæst. En tom linje giver et nyt afsnit. Ingen overskrifter og ingen HTML."
          id={`${anchorId}-tekst`}
          label="Tekst"
          name={fieldNames.body}
          rows={10}
        />

        {/*
          1s's image slot, in the only honest state it can have before phase 10: the
          approved dashed frame, stating that the capability is coming rather than
          drawing an upload control that goes nowhere. No file input, no image_id.
        */}
        <div className="flex flex-col gap-1.5">
          <p className="text-meta text-neutral-ink font-medium">Billede (valgfrit)</p>
          <div className="border-field-border bg-field-bg rounded-card flex min-h-24 flex-col items-center justify-center gap-1 border-[1.5px] border-dashed p-4 text-center">
            <p className="text-ink-2 font-medium">Billeder kommer i en senere fase</p>
            <p className="text-ink-3 text-micro">Nyheden kan sagtens offentliggøres uden billede.</p>
          </div>
        </div>

        <div className="border-border flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
          <p className="text-ink-2 text-meta max-w-[52ch]">{consequence}</p>
          <div className="md:shrink-0">
            <SubmitButton>{saveLabel}</SubmitButton>
          </div>
        </div>
      </form>
    </section>
  )
}

/** One category pill — a radio button, drawn, 44 px per 1aa. */
function CategoryChip({
  id,
  name,
  value,
  checked,
  children,
}: {
  id: string
  name: string
  value: string
  checked: boolean
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex">
      <input
        className="peer sr-only"
        defaultChecked={checked}
        id={id}
        name={name}
        type="radio"
        value={value}
      />
      <label
        className="rounded-badge border-field-border text-neutral-ink peer-checked:border-brand-700 peer-checked:bg-brand-50 peer-checked:text-brand-700 peer-focus-visible:outline-focus min-h-tap inline-flex cursor-pointer items-center border px-3.5 text-meta font-medium peer-checked:border-[1.5px] peer-checked:font-semibold peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2"
        htmlFor={id}
      >
        {children}
      </label>
    </span>
  )
}
