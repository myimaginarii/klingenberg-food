import { TextField } from '@/components/admin/Field'
import { CardPendingBadge } from '@/components/admin/PendingBand'
import { SubmitButton } from '@/components/admin/SubmitButton'
import {
  CONTACT_FIELDS,
  CONTACT_NO_INSTAGRAM_NOTE,
  CONTACT_PENDING_FIELD_NOTE,
  CONTACT_SAVE_NOTE,
  type ContactFieldKey,
  type ContactFormValues,
} from '@/lib/contact/editor'

/**
 * The Kontaktoplysninger card — design 1v.
 *
 * A plain `<form>` posting to a Server Action, like every other form in this
 * administration: no client component, no controlled inputs. The fields are 1v's, in
 * 1v's order, under 1v's labels, with 1v's helper sentence beneath each — and nothing
 * more. There is no Instagram field (1v says so in words, and so does this card), no
 * WhatsApp, no reservation or delivery field, no second address, and no field for the
 * venue name or the map credit (recorded in technical plan §0aa).
 *
 * A pending field carries the Kladde badge above it, so a person sees *which* fact is
 * waiting rather than only that something is.
 */
export function ContactEditor({
  anchorId,
  action,
  fieldNames,
  values,
  version,
  errorFor,
  pendingFields,
}: {
  anchorId: string
  action: (formData: FormData) => Promise<void>
  fieldNames: Readonly<Record<'version' | ContactFieldKey, string>>
  values: ContactFormValues
  /** The `updated_at` this form was rendered from — the concurrency token (§6). */
  version: string
  errorFor: (field: ContactFieldKey) => string | undefined
  pendingFields: ReadonlySet<ContactFieldKey>
}) {
  const headingId = `${anchorId}-titel`

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <h2 className="font-mono text-label text-ink-3 uppercase" id={headingId}>
        Kontaktoplysninger
      </h2>

      <form action={action} aria-label="Kontaktoplysninger" className="mt-4 flex flex-col gap-5">
        <input name={fieldNames.version} type="hidden" value={version} />

        {CONTACT_FIELDS.map((field) => (
          <div className="flex flex-col gap-2" key={field.key}>
            {pendingFields.has(field.key) ? <CardPendingBadge note={CONTACT_PENDING_FIELD_NOTE} /> : null}
            <TextField
              autoComplete={field.autoComplete}
              defaultValue={values[field.key]}
              error={errorFor(field.key)}
              hint={field.hint.length > 0 ? field.hint : undefined}
              id={`${anchorId}-${field.key}`}
              label={field.label}
              name={fieldNames[field.key]}
            />
          </div>
        ))}

        <p className="text-ink-2 text-meta">{CONTACT_NO_INSTAGRAM_NOTE}</p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Gem</SubmitButton>
        </div>

        <p className="text-ink-3 text-micro">{CONTACT_SAVE_NOTE}</p>
      </form>
    </section>
  )
}
