import type { AdminImageThumbnail } from '@/lib/content/images-admin'
import { FEATURED_ADD_LABEL, FEATURED_NOTE, HOME_PENDING_CARD_NOTE } from '@/lib/pages/home'
import { FEATURED_DISH_LIMIT } from '@/lib/schemas/page-documents'

import { ImageThumbnail } from '../images/ImageThumbnail'
import { HomeCardPending } from './HomeNotices'

/**
 * "UDVALGTE BURGERE (VÆLG 3)" — 1u's featured list; technical plan §4, §7e item 4.
 *
 * Three slots, each a dish chosen **from the menu** and shown by the name and photo
 * the menu gives it — 1u's own note says why: *"Vælges fra menuen — navne og priser
 * skrives aldrig to steder."* Nothing about a dish is typed here; the document holds
 * ids, and the public page resolves them against the published menu on every render.
 *
 * EVERY CONTROL IS A SUBMIT BUTTON IN ONE FORM. Flyt op, Flyt ned and Fjern submit
 * `handling` and `plads`; "Skift" and "+ Vælg en burger fra menuen" are links that open
 * the dish picker (`HomeDishPickerDialog`), whose choices are submit buttons of their
 * own. Every press is an ordinary draft change (§6), so Fjern needs no Fortryd and no
 * confirmation, and the whole card works with scripting off. 1u draws a drag handle on
 * each slot; the phase-5F precedent for a short fixed list (the Tapas groups) is two
 * move buttons rather than a second drag engine, and that is what ships — recorded as
 * a departure.
 *
 * A STALE REFERENCE IS SHOWN, NOT HIDDEN. A dish the document names but the menu no
 * longer has (soft-deleted, §7e item 4) is drawn as a slot that says so, with Fjern
 * beside it: the Owner tidies it here, which is the whole reason the deletion never
 * rewrote this document.
 */
export type FeaturedSlot = {
  readonly id: string
  /** The dish's current name, or `null` when the menu no longer has it. */
  readonly name: string | null
  readonly categoryName: string | null
  readonly thumbnail: AdminImageThumbnail | null
  readonly altText: string | null
}

export type HomeFeaturedForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: {
    readonly version: string
    readonly action: string
  }
  /** The button values, built by `forms.ts` so the two cannot spell them apart. */
  readonly values: {
    readonly remove: (index: number) => string
    readonly up: (index: number) => string
    readonly down: (index: number) => string
  }
}

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
  /** " plads 2 — Odin" — so a column of identical buttons is not identical. */
  what: string
}) {
  return (
    <button
      className={`rounded-field border-field-border min-h-tap min-w-tap flex flex-1 items-center justify-center whitespace-nowrap border px-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
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
      <span className="sr-only"> {what}</span>
    </button>
  )
}

export function HomeFeaturedEditor({
  anchorId,
  eyebrow,
  slots,
  version,
  form,
  pending,
  addHref,
  addAnchorId,
  changeHrefFor,
  slotAnchorFor,
}: {
  anchorId: string
  eyebrow: string
  slots: readonly FeaturedSlot[]
  /** The `updated_at` this card was rendered from — the concurrency token (§6). */
  version: string
  form: HomeFeaturedForm
  pending: boolean
  /** Opens the picker for the next free slot; `null` when all three are taken. */
  addHref: string | null
  addAnchorId: string
  changeHrefFor: (index: number) => string
  slotAnchorFor: (index: number) => string
}) {
  const headingId = `${anchorId}-titel`
  const total = slots.length

  const at = (index: number, slot: FeaturedSlot) =>
    `plads ${index + 1} — ${slot.name ?? 'ret der ikke findes på menuen'}`

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

      {total === 0 ? (
        <p className="text-ink-2 text-meta mb-3">
          Ingen retter er valgt endnu. Forsiden viser afsnittet “Tre fra menuen” først, når
          mindst én ret er valgt og offentliggjort.
        </p>
      ) : (
        <form action={form.action} aria-label={eyebrow}>
          <input name={form.fieldNames.version} type="hidden" value={version} />

          <ol aria-label="Udvalgte retter" className="flex flex-col gap-3 md:flex-row md:gap-4">
            {slots.map((slot, index) => (
              <li
                className="border-border rounded-card flex min-w-0 flex-1 flex-col gap-3 border p-3"
                key={`${index}-${slot.id}`}
              >
                <div className="flex items-center gap-3">
                  {slot.thumbnail === null ? (
                    <span
                      aria-hidden="true"
                      className="bg-field-bg border-field-border rounded-card flex h-16 w-20 shrink-0 items-center justify-center border font-mono text-label text-ink-3 uppercase"
                    >
                      Foto
                    </span>
                  ) : (
                    <ImageThumbnail
                      altText={slot.altText}
                      className="rounded-card h-16 w-20 shrink-0 object-cover"
                      sizes="5rem"
                      thumbnail={slot.thumbnail}
                    />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-ink-3 font-mono text-label uppercase">Plads {index + 1}</p>
                    {slot.name === null ? (
                      <p className="text-warning-ink font-semibold">
                        <span aria-hidden="true">● </span>Retten findes ikke på menuen længere
                      </p>
                    ) : (
                      <p className="text-ink truncate font-semibold">{slot.name}</p>
                    )}
                    {slot.categoryName === null ? null : (
                      <p className="text-ink-2 text-meta">{slot.categoryName}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    className="rounded-field border-neutral-ink text-neutral-ink hover:bg-section bg-surface inline-flex min-h-tap flex-1 items-center justify-center border-[1.5px] px-3 font-semibold"
                    href={changeHrefFor(index)}
                    id={slotAnchorFor(index)}
                  >
                    Skift
                    <span className="sr-only"> {at(index, slot)}</span>
                  </a>
                  <RowButton
                    disabled={index === 0}
                    name={form.fieldNames.action}
                    value={form.values.up(index)}
                    what={at(index, slot)}
                  >
                    Flyt op
                  </RowButton>
                  <RowButton
                    disabled={index === total - 1}
                    name={form.fieldNames.action}
                    value={form.values.down(index)}
                    what={at(index, slot)}
                  >
                    Flyt ned
                  </RowButton>
                  <RowButton
                    name={form.fieldNames.action}
                    tone="quiet"
                    value={form.values.remove(index)}
                    what={at(index, slot)}
                  >
                    Fjern
                  </RowButton>
                </div>
              </li>
            ))}
          </ol>
        </form>
      )}

      {total < FEATURED_DISH_LIMIT && addHref !== null ? (
        <p className="mt-3">
          <a
            className="rounded-field border-field-border text-neutral-ink hover:border-rule bg-surface inline-flex min-h-tap w-full items-center justify-center border-[1.5px] border-dashed px-4 font-semibold md:w-auto"
            href={addHref}
            id={addAnchorId}
          >
            {FEATURED_ADD_LABEL}
          </a>
        </p>
      ) : null}

      <p className="text-ink-3 text-micro mt-3">{FEATURED_NOTE}</p>
    </section>
  )
}
