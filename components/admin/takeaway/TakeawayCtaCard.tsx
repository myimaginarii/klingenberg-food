import { TextField } from '@/components/admin/Field'
import { CardPendingBadge } from '@/components/admin/PendingBand'
import { SubmitButton } from '@/components/admin/SubmitButton'
import {
  describeTakeawayCtaPhone,
  TAKEAWAY_CARD_LABELS,
  TAKEAWAY_PENDING_CARD_NOTE,
} from '@/lib/pages/takeaway'
import { TAKEAWAY_CTA_MAX } from '@/lib/schemas/page-documents'

/**
 * The "Knap nederst" card — 1aj's "Tekst på knappen".
 *
 * One field, and the frame's own information line beneath it: *"Knappen ringer altid
 * til det primære nummer fra Kontaktoplysninger — +45 63 90 83 00. Det ekstra nummer
 * vises ved siden af. Nummeret skrives ikke her, så det kun står ét sted."* The number
 * in that sentence is read from `site_contact` by the page and handed in — this card
 * has no field for it, and no copy of it.
 */
export function TakeawayCtaCard({
  anchorId,
  action,
  fieldNames,
  value,
  version,
  error,
  pending,
  primaryPhone,
}: {
  anchorId: string
  action: (formData: FormData) => Promise<void>
  fieldNames: { readonly version: string; readonly label: string }
  value: string
  /** The `updated_at` this form was rendered from — the concurrency token (§6). */
  version: string
  error?: string
  pending: boolean
  /** The published primary number, from `site_contact` — never typed here. */
  primaryPhone: string | null
}) {
  const headingId = `${anchorId}-titel`
  const infoId = `${anchorId}-info`

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-label text-ink-3 uppercase" id={headingId}>
          {TAKEAWAY_CARD_LABELS.cta}
        </h2>
        {pending ? <CardPendingBadge note={TAKEAWAY_PENDING_CARD_NOTE} /> : null}
      </div>

      <form action={action} aria-label={TAKEAWAY_CARD_LABELS.cta} className="flex flex-col gap-4">
        <input name={fieldNames.version} type="hidden" value={version} />

        <TextField
          defaultValue={value}
          error={error}
          id={`${anchorId}-knaptekst`}
          label="Tekst på knappen"
          maxLength={TAKEAWAY_CTA_MAX}
          name={fieldNames.label}
        />

        <p className="text-brand-700 text-meta flex items-start gap-2" id={infoId}>
          <span
            aria-hidden="true"
            className="border-brand-700 mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-bold"
          >
            i
          </span>
          <span>{describeTakeawayCtaPhone(primaryPhone)}</span>
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Gem</SubmitButton>
        </div>

        <p className="text-ink-3 text-micro">
          Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Offentliggør.
        </p>
      </form>
    </section>
  )
}
