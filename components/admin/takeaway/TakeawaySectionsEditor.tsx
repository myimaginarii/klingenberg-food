import { FieldGroupError, labelId, TextAreaField, TextField } from '@/components/admin/Field'
import { CardPendingBadge } from '@/components/admin/PendingBand'
import {
  TAKEAWAY_ADD_SECTION_LABEL,
  TAKEAWAY_CARD_LABELS,
  TAKEAWAY_PENDING_CARD_NOTE,
  TAKEAWAY_SECTIONS_NOTE,
} from '@/lib/pages/takeaway'
import { TAKEAWAY_SECTION_BODY_MAX, TAKEAWAY_SECTION_HEADING_MAX } from '@/lib/schemas/page-documents'

/**
 * The "Tekstafsnit" card — 1aj's free sections; technical plan §4 (1ai: "Afsnit kan
 * tilføjes, fjernes og flyttes — siden har ingen fast liste af pakker").
 *
 * A plain `<form>` posting to a Server Action: no client component, no controlled
 * inputs, no state library. Take the JavaScript away and every control here still
 * works, because every control here is a submit button.
 *
 * EVERY BUTTON SAVES. Flyt op, Flyt ned, Fjern, Tilføj tekstafsnit and Gem afsnit are
 * five submit buttons in one form, distinguished by the value they carry (the
 * phase-5F Tapas arrangement). Each one submits the whole list as it is currently
 * typed, so a person who edited two sections and then moved a third keeps all three
 * changes — and none of them is an immediate change to the hjemmeside: they are all
 * ordinary drafts (§6), so Fjern needs no Fortryd and no confirmation.
 *
 * 1aj draws a drag handle ("flytte afsnittene med håndtaget"); this card draws two
 * move buttons, the phase-5F/11A precedent for a short list, and no second drag
 * engine — recorded as a departure in technical plan §0aa.
 *
 * ONE ARRANGEMENT, BOTH WIDTHS. Each section is its own labelled block: the heading
 * field, the text field, and its three controls in a row beneath them.
 */

export type TakeawaySectionsForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: {
    readonly version: string
    readonly heading: string
    readonly body: string
    readonly action: string
  }
  /** The button values, built by `forms.ts` so the button and the parser cannot spell them apart. */
  readonly values: {
    readonly save: string
    readonly add: string
    readonly remove: (index: number) => string
    readonly up: (index: number) => string
    readonly down: (index: number) => string
  }
}

export type TakeawaySectionView = {
  readonly id: string
  readonly heading: string
  readonly body: string
  readonly headingError?: string
  readonly bodyError?: string
}

/** One small control in a section's row. Its words are its name; the position follows. */
function RowButton({
  children,
  disabled,
  name,
  tone = 'normal',
  value,
  what,
}: {
  children: string
  disabled?: boolean
  name: string
  tone?: 'normal' | 'quiet'
  value: string
  /** " afsnit 2" — so a column of identical buttons is not identical. */
  what: string
}) {
  return (
    <button
      className={`rounded-field border-field-border min-h-tap min-w-tap flex flex-1 items-center justify-center whitespace-nowrap border px-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50 md:flex-none md:px-4 ${
        tone === 'quiet'
          ? 'bg-surface text-ink-2 hover:bg-surface-muted hover:text-ink'
          : 'bg-surface text-ink hover:bg-surface-muted'
      } disabled:text-ink-3`}
      disabled={disabled}
      name={name}
      type="submit"
      value={value}
    >
      {children}
      {/* The leading space is deliberate: JSX drops whitespace between elements. */}
      <span className="sr-only"> {what}</span>
    </button>
  )
}

export function TakeawaySectionsEditor({
  anchorId,
  sectionAnchorFor,
  form,
  sections,
  listError,
  version,
  pending,
  canAdd,
}: {
  anchorId: string
  /** Each section block's own id, by position — where a press comes back to. */
  sectionAnchorFor: (index: number) => string
  form: TakeawaySectionsForm
  sections: readonly TakeawaySectionView[]
  listError?: string
  /** The version this screen was rendered from — optimistic concurrency (§6). */
  version: string
  pending: boolean
  /** False once the list is full; the server refuses a press that arrives anyway. */
  canAdd: boolean
}) {
  const titleId = `${anchorId}-titel`
  const listErrorId = `${anchorId}-liste-fejl`
  const total = sections.length

  const at = (index: number) => `afsnit ${index + 1}`

  return (
    <section
      aria-labelledby={titleId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-label text-ink-3 uppercase" id={titleId}>
          {TAKEAWAY_CARD_LABELS.sections}
        </h2>
        {pending ? <CardPendingBadge note={TAKEAWAY_PENDING_CARD_NOTE} /> : null}
      </div>

      <form action={form.action} aria-label={TAKEAWAY_CARD_LABELS.sections} className="flex flex-col gap-4">
        <input name={form.fieldNames.version} type="hidden" value={version} />

        {total === 0 ? (
          <p className="text-ink-2 text-meta">Der er ingen afsnit endnu. Tilføj det første herunder.</p>
        ) : (
          <ol aria-label="Afsnit" className="flex flex-col gap-4">
            {sections.map((section, index) => {
              const blockId = sectionAnchorFor(index)
              const blockTitleId = `${blockId}-titel`
              const headingId = `${blockId}-overskrift`
              const bodyId = `${blockId}-tekst`

              return (
                <li
                  aria-labelledby={blockTitleId}
                  className="border-border rounded-card flex flex-col gap-3 border p-3 md:p-4"
                  id={blockId}
                  key={section.id}
                >
                  <h3 className="text-neutral-ink font-sans font-semibold" id={blockTitleId}>
                    {`Afsnit ${index + 1}`}
                  </h3>

                  <TextField
                    defaultValue={section.heading}
                    error={section.headingError}
                    id={headingId}
                    label="Overskrift på afsnittet"
                    labelledBy={`${blockTitleId} ${labelId(headingId)}`}
                    maxLength={TAKEAWAY_SECTION_HEADING_MAX}
                    name={form.fieldNames.heading}
                  />

                  <TextAreaField
                    defaultValue={section.body}
                    error={section.bodyError}
                    id={bodyId}
                    label="Skriv afsnittet her"
                    labelledBy={`${blockTitleId} ${labelId(bodyId)}`}
                    maxLength={TAKEAWAY_SECTION_BODY_MAX}
                    name={form.fieldNames.body}
                    rows={3}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <RowButton
                      disabled={index === 0}
                      name={form.fieldNames.action}
                      value={form.values.up(index)}
                      what={at(index)}
                    >
                      Flyt op
                    </RowButton>
                    <RowButton
                      disabled={index === total - 1}
                      name={form.fieldNames.action}
                      value={form.values.down(index)}
                      what={at(index)}
                    >
                      Flyt ned
                    </RowButton>
                    <RowButton
                      name={form.fieldNames.action}
                      tone="quiet"
                      value={form.values.remove(index)}
                      what={at(index)}
                    >
                      Fjern
                    </RowButton>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        <div className="border-border flex flex-col gap-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              aria-describedby={listError === undefined ? undefined : listErrorId}
              className="rounded-field border-field-border bg-surface text-ink hover:bg-surface-muted min-h-tap inline-flex items-center border-[1.5px] px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canAdd}
              name={form.fieldNames.action}
              type="submit"
              value={form.values.add}
            >
              {TAKEAWAY_ADD_SECTION_LABEL}
            </button>

            <button
              className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap px-6 font-semibold text-white"
              name={form.fieldNames.action}
              type="submit"
              value={form.values.save}
            >
              Gem afsnit
            </button>
          </div>

          <FieldGroupError error={listError} id={listErrorId} />

          <p className="text-ink-3 text-micro">{TAKEAWAY_SECTIONS_NOTE}</p>
          <p className="text-ink-3 text-micro">
            Hver knap gemmer hele listen som kladde. Hjemmesiden ændrer sig først, når du
            trykker Offentliggør.
          </p>
        </div>
      </form>
    </section>
  )
}
