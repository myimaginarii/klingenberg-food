import {
  DateField,
  FieldGroupError,
  SelectField,
  TextAreaField,
  TextField,
  TimeField,
} from '@/components/admin/Field'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { AnnouncementBar } from '@/components/site/announcement/AnnouncementBar'
import type { AnnouncementExpiryChoice, AnnouncementExpirySuggestion } from '@/lib/announcements/expiry-editor'
import { ANNOUNCEMENT_MESSAGE_MAX_LENGTH } from '@/lib/announcements/lifecycle'
import { ANNOUNCEMENT_PAGE_OPTIONS, type AnnouncementLink } from '@/lib/announcements/link'

/**
 * Besked på hjemmesiden — design 1ad.
 *
 * A plain `<form>` posting to a Server Action, like every other form in this
 * administration: no client component, no controlled inputs, no state library, and
 * nothing in the browser that has to be kept in step with the server. The card is a
 * `<section>` labelled by its own heading, so the screen has one `<h1>` in the bar and one
 * named region beneath it.
 *
 * THE FIELDS ARE THE FRAME'S, AND ONLY THE FRAME'S
 *
 * Besked, Link (valgfrit), Tekst på linket, and the two fields plus chips that make up
 * "Beskeden fjernes automatisk". Nothing is added: no title, no icon picker, no colour
 * choice, no audience targeting, no priority, no start date and no second message. 1ad
 * draws a bar with one sentence in it, and 1ac's rules say why — "Højst én besked ad
 * gangen".
 *
 * WHAT 1ad DRAWS THAT PHASE 7A DELIBERATELY DOES NOT SHIP
 *
 * The "Vis besked" switch at the top of the frame and the "Fjern beskeden nu" button in
 * its footer are **the immediate path** (§6): one press, no preview, no publish. 1ad
 * itself separates them from everything else — *"Skrive eller ændre → tre trin"* against
 * *"Fjerne → ét tryk"* — and they are phase 7B. They are absent here rather than present
 * and inert, for the same reason 1ah's image control is absent from the Månedens burger
 * editor: a control that cannot do its job is worse than a control that is not there yet.
 * The screen says so in words instead, beside the expiry, so nobody looks for a switch
 * that has not been built.
 *
 * THE EXPIRY IS ONE ANSWER GIVEN BY THREE CONTROLS
 *
 * 1ad draws a date, a time and a row of suggested chips. The chips are **radio buttons in
 * this same form**, which is what lets them work with no JavaScript at all: choosing one
 * is not a separate operation and not a script writing into a field — it is a value the
 * form submits, which the server resolves against the published opening hours and its own
 * clock. "Vælg selv" is the choice that uses the two fields exactly as typed, and it is
 * the one a stored expiry falls back to, because the row holds an instant and no record
 * of how it was produced.
 *
 * "SÅDAN SER DEN UD" RENDERS THE REAL BAR
 *
 * The preview panel is `AnnouncementBar` — the same component the public layout renders,
 * with the same tokens and the same rules about a missing link. An illustration drawn
 * separately in the admin would be a second bar to keep in step, and the first thing to
 * go stale. It is `inert`, so it contributes no tab stop and no second copy of the link;
 * the frame draws it as a picture and that is what it is.
 *
 * 1ad's caption under the panel says "Opdateres, mens du skriver". This one updates when
 * the screen does — on every save — because the whole editor is server-rendered and
 * nothing here runs in the browser. The caption says that instead, rather than promising
 * something the page does not do.
 */

export type AnnouncementEditorValues = {
  readonly message: string
  readonly linkChoice: string
  readonly linkUrl: string
  readonly linkLabel: string
  readonly expiryChoice: AnnouncementExpiryChoice
  readonly expiryDate: string
  readonly expiryTime: string
}

export type AnnouncementEditorFieldNames = {
  readonly version: string
  readonly message: string
  readonly linkChoice: string
  readonly linkUrl: string
  readonly linkLabel: string
  readonly expiryChoice: string
  readonly expiryDate: string
  readonly expiryTime: string
}

export type AnnouncementEditorErrorField =
  | 'besked'
  | 'link'
  | 'adresse'
  | 'linktekst'
  | 'udloeb'

export function AnnouncementEditor({
  anchorId,
  action,
  fieldNames,
  values,
  version,
  suggestions,
  noLinkValue,
  externalLinkValue,
  errorFor,
  pending,
  preview,
}: {
  anchorId: string
  action: (formData: FormData) => Promise<void>
  fieldNames: AnnouncementEditorFieldNames
  values: AnnouncementEditorValues
  /** The `updated_at` this form was rendered from — the concurrency token (§6). */
  version: string
  /** 1ad's chips, computed by the server from the published hours. */
  suggestions: readonly AnnouncementExpirySuggestion[]
  noLinkValue: string
  externalLinkValue: string
  /** The message for one field, or undefined. Bound with `aria-describedby`. */
  errorFor: (field: AnnouncementEditorErrorField) => string | undefined
  /** The Kladde line for this card, or null when nothing is pending. */
  pending: string | null
  /** What the bar would look like with the current draft, or null when there is nothing. */
  preview: { readonly message: string; readonly link: AnnouncementLink | null } | null
}) {
  const headingId = `${anchorId}-titel`
  const expiryLegendId = `${anchorId}-udloeb-legende`
  const expiryHelpId = `${anchorId}-udloeb-hjaelp`
  const expiryErrorId = `${anchorId}-udloeb-fejl`
  const expiryError = errorFor('udloeb')
  const previewHeadingId = `${anchorId}-visning-titel`

  const linkOptions = [
    { value: noLinkValue, label: 'Intet link' },
    ...ANNOUNCEMENT_PAGE_OPTIONS.map((option) => ({
      value: option.route,
      label: option.label,
    })),
    { value: externalLinkValue, label: 'Anden adresse (https://…)' },
  ]

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading font-sans font-semibold" id={headingId}>
          Besked på hjemmesiden
        </h2>
        {pending === null ? null : <PendingBadge>{pending}</PendingBadge>}
      </div>

      <form action={action} aria-label="Besked på hjemmesiden" className="flex flex-col gap-4">
        <input name={fieldNames.version} type="hidden" value={version} />

        {/*
          A textarea rather than 1ad's desktop single-line box: the mobile frame draws a
          74 px field for the same content, the message wraps freely on the bar (1ac), and
          a 90-character sentence does not fit one line at 375 px. `maxLength` stops the
          typing at the limit the counter names, and the server refuses anything longer
          rather than truncating it silently.
        */}
        <TextAreaField
          defaultValue={values.message}
          error={errorFor('besked')}
          hint={`Hold den kort — én linje er nok. Højst ${ANNOUNCEMENT_MESSAGE_MAX_LENGTH} tegn.`}
          id={`${anchorId}-tekst`}
          label="Besked"
          maxLength={ANNOUNCEMENT_MESSAGE_MAX_LENGTH}
          name={fieldNames.message}
          rows={2}
        />

        <div className="flex flex-col gap-4 md:flex-row">
          <div className="md:flex-[1.4]">
            <SelectField
              defaultValue={values.linkChoice}
              error={errorFor('link')}
              hint="Vælg en side, eller vælg “Anden adresse” og skriv den nedenfor."
              id={`${anchorId}-link`}
              label="Link (valgfrit)"
              name={fieldNames.linkChoice}
              options={linkOptions}
            />
          </div>

          <div className="md:flex-1">
            <TextField
              defaultValue={values.linkLabel}
              error={errorFor('linktekst')}
              hint="Vises som det, gæsten trykker på. Lad feltet stå tomt for at bruge sidens eget navn."
              id={`${anchorId}-linktekst`}
              label="Tekst på linket"
              maxLength={60}
              name={fieldNames.linkLabel}
            />
          </div>
        </div>

        {/*
          The address field is always on screen, because the select that decides whether
          it is needed is a server-rendered control and this screen runs no JavaScript.
          Its hint says when it applies; the server ignores it for every other choice.
        */}
        <TextField
          defaultValue={values.linkUrl}
          error={errorFor('adresse')}
          hint="Bruges kun, hvis du har valgt “Anden adresse”. Skal begynde med https://"
          id={`${anchorId}-adresse`}
          inputMode="text"
          label="Anden adresse"
          name={fieldNames.linkUrl}
        />

        {/*
          The expiry's message belongs to the **group**, not to one field: it is decided
          by the chips, the date and the time together, and naming one of the three would
          send somebody to fix the wrong control. `role="group"` with its own
          `aria-describedby` is the same association a single field makes, one level up —
          the pattern `FieldGroupError` exists for.
        */}
        <fieldset
          aria-describedby={
            expiryError === undefined ? expiryHelpId : `${expiryHelpId} ${expiryErrorId}`
          }
          aria-invalid={expiryError === undefined ? undefined : true}
          className={`rounded-field flex flex-col gap-3 border p-3 ${
            expiryError === undefined ? 'border-border' : 'border-error border-[1.5px]'
          }`}
        >
          <legend
            className="text-neutral-ink text-meta flex flex-wrap items-center gap-2 px-1 font-medium"
            id={expiryLegendId}
          >
            Beskeden fjernes automatisk
            <span className="rounded-badge bg-brand-50 text-brand-700 px-2.5 py-1 text-micro font-medium">
              Skal udfyldes
            </span>
          </legend>

          {/*
            1ad's chips. Radio buttons drawn as pills: the input is visually hidden inside
            its own label and the pill is drawn by `peer-checked`, which is the same
            control the Lørdagsmenu and Forside toggles use. Space and arrows work, the
            state is announced as checked, the form submits with no JavaScript, and the
            focus ring lands on the pill a person can see.
          */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-3 text-micro">Foreslået:</span>

            {suggestions.map((suggestion) => (
              <ExpiryChip
                checked={values.expiryChoice === suggestion.choice}
                id={`${anchorId}-udloeb-${suggestion.choice}`}
                key={suggestion.choice}
                name={fieldNames.expiryChoice}
                value={suggestion.choice}
              >
                {suggestion.label}
              </ExpiryChip>
            ))}

            <ExpiryChip
              checked={values.expiryChoice === 'custom'}
              id={`${anchorId}-udloeb-custom`}
              name={fieldNames.expiryChoice}
              value="custom"
            >
              Vælg selv
            </ExpiryChip>
          </div>

          <div className="flex flex-col gap-4 md:flex-row">
            <div className="md:flex-[1.3]">
              <DateField
                defaultValue={values.expiryDate}
                id={`${anchorId}-udloeb-dato`}
                label="Dato"
                name={fieldNames.expiryDate}
              />
            </div>
            <div className="md:flex-1">
              <TimeField
                defaultValue={values.expiryTime}
                id={`${anchorId}-udloeb-tid`}
                label="Klokkeslæt"
                name={fieldNames.expiryTime}
              />
            </div>
          </div>

          <FieldGroupError error={expiryError} id={expiryErrorId} />

          <p className="text-ink-3 text-micro" id={expiryHelpId}>
            Dato og klokkeslæt bruges, når “Vælg selv” er valgt — ret dem gerne. Der er
            ingen øvre grænse for, hvor længe en besked må stå, men der skal altid være et
            tidspunkt ude i fremtiden. Når det passerer, forsvinder bjælken af sig selv.
          </p>
        </fieldset>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Gem</SubmitButton>
        </div>

        <p className="text-ink-3 text-micro">
          Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Offentliggør.
        </p>
      </form>

      {/*
        1ad's "SÅDAN SER DEN UD" panel, rendered with the real bar — see the note at the
        top of this file.
      */}
      <div className="border-border mt-5 border-t pt-4">
        <h3
          className="text-ink-3 font-mono text-label mb-2 uppercase"
          id={previewHeadingId}
        >
          Sådan ser den ud
        </h3>

        {preview === null ? (
          <p className="border-rule text-ink-3 rounded-field border border-dashed px-3 py-3 text-meta">
            Ingen bjælke — headeren rykker helt op.
          </p>
        ) : (
          <div
            aria-labelledby={previewHeadingId}
            className="border-border rounded-field overflow-hidden border"
            role="img"
          >
            {/*
              `inert` so the preview's link is not a second tab stop and not a second copy
              of the same control for a screen reader. It is a picture of the bar, which
              is exactly how 1ad draws it.
            */}
            <div inert>
              <AnnouncementBar link={preview.link} message={preview.message} />
            </div>
          </div>
        )}

        <p className="text-ink-3 text-micro mt-2">
          Opdateres, hver gang du gemmer.
        </p>
      </div>
    </section>
  )
}

/**
 * One of 1ad's suggestion pills — a radio button, drawn.
 *
 * `min-h-tap` rather than the frame's 38–40 px, for the reason `AdminSectionBar` records
 * for its own controls: 1aa's accessibility list says "Tryk-mål mindst 44 × 44 px" and
 * states no exception, and this is a control a person taps on a phone mid-shift.
 */
function ExpiryChip({
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

/**
 * The Kladde badge on the card — the phase-5 vocabulary and the phase-5 tokens (1aa).
 *
 * Warning tone, a shape of its own before the words, and the sentence itself carries the
 * meaning, so the state survives the colours being switched off. It is not a `role`
 * region: the pending band above the card is the screen's status announcement, and two
 * live regions saying the same thing would be one too many.
 */
function PendingBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-badge border-warning-border bg-warning-surface text-warning-ink inline-flex items-center gap-2 border px-3 py-1.5 text-meta font-semibold">
      <span aria-hidden="true" className="bg-warning size-2 shrink-0 rotate-45" />
      {children}
    </span>
  )
}
