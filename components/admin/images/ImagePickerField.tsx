import type { AdminImageThumbnail } from '@/lib/content/images-admin'
import {
  CHANGE_IMAGE_LABEL,
  CHOOSE_IMAGE_LABEL,
  IMAGE_SELECT_FORM,
  IMAGE_SLOT_LABEL,
  REMOVE_IMAGE_HINT,
  REMOVE_IMAGE_LABEL,
} from '@/lib/images/selection'

import { ImageThumbnail } from './ImageThumbnail'

/**
 * The photo slot every 10C-1 editor draws — 1r's FOTO frame, 1ag/1ah/1s's
 * "Billede (valgfrit)".
 *
 * A Server Component with two states and no memory:
 *
 *   * **empty** — the dashed frame the approved screens draw, with "Vælg billede"
 *     as a link. Pressing it navigates (`chooseHref` puts the picker in the URL),
 *     so nothing has happened yet and the browser's back button closes it — the
 *     administration's rule for anything that opens something.
 *   * **chosen** — the selected image's public thumbnail beside "Skift billede"
 *     and "Fjern billede". The removal is a form posting the entity's own image
 *     action with an empty selection: it clears the *choice*, and the hint says
 *     out loud that the picture itself stays in the library (§10 of the phase
 *     brief) — deleting an asset remains `/admin/billeder`'s job.
 *
 * It is a **sibling of the entity's Gem form**, never a field inside it: the
 * removal is its own `<form>`, forms cannot nest, and for the three draft-based
 * entities a selection is its own draft write (like reordering and the Tapas
 * lists) rather than part of the panel's delta. What travels is stated by
 * `lib/images/selection.ts` — the version token, the id, and nothing else.
 */

/** The removal form's binding: the entity's image action plus its own id fields. */
export type ImageRemoveForm = {
  readonly action: (formData: FormData) => Promise<void>
  /** The screen's identifying fields (`ret`, `nyhed`, …) — never content. */
  readonly hidden: readonly { readonly name: string; readonly value: string }[]
  /** The `updated_at` the screen was rendered from — the concurrency token (§6). */
  readonly version: string
}

/** What the slot shows for the current selection. */
export type ImageSlotSelection = {
  readonly thumbnail: AdminImageThumbnail | null
  /** The image's accessible name: its description, or its display filename. */
  readonly name: string
  readonly altText: string | null
}

export function ImagePickerField({
  anchorId,
  chooseHref,
  selection,
  removeForm,
  hint,
  disabledNote,
}: {
  /** The choose/change control's own id — where a closed picker returns focus. */
  anchorId: string
  /** Opens the picker dialog. `null` renders the slot without a way in. */
  chooseHref: string | null
  /** The current selection, or `null` for the empty slot. */
  selection: ImageSlotSelection | null
  /** Absent when nothing is selected — there is nothing to remove. */
  removeForm?: ImageRemoveForm
  /** The frame's helper sentence beside the control, when it has one. */
  hint?: string
  /** Why the slot is not available yet (a news article that is not saved). */
  disabledNote?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-meta text-neutral-ink font-medium">{IMAGE_SLOT_LABEL}</p>

      {selection === null ? (
        <div className="border-field-border bg-field-bg rounded-card flex min-h-24 flex-col items-center justify-center gap-2 border-[1.5px] border-dashed p-4 text-center">
          {disabledNote === undefined ? null : (
            <p className="text-ink-2 text-meta">{disabledNote}</p>
          )}
          {chooseHref === null ? null : (
            <a
              className="rounded-field border-neutral-ink text-neutral-ink hover:bg-section bg-surface inline-flex min-h-tap items-center border-[1.5px] px-4 font-semibold"
              href={chooseHref}
              id={anchorId}
            >
              {CHOOSE_IMAGE_LABEL}
            </a>
          )}
          {hint === undefined ? null : <p className="text-ink-3 text-micro max-w-[36ch]">{hint}</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {selection.thumbnail === null ? (
            <span
              aria-hidden="true"
              className="bg-field-bg border-field-border rounded-card flex h-20 w-28 shrink-0 items-center justify-center border font-mono text-label text-ink-3 uppercase"
            >
              Foto
            </span>
          ) : (
            <ImageThumbnail
              altText={selection.altText}
              className="rounded-card h-20 w-28 shrink-0 object-cover"
              sizes="7rem"
              thumbnail={selection.thumbnail}
            />
          )}

          <div className="flex flex-col gap-2">
            {chooseHref === null ? null : (
              <a
                className="rounded-field border-neutral-ink text-neutral-ink hover:bg-section bg-surface inline-flex min-h-tap items-center self-start border-[1.5px] px-4 font-semibold"
                href={chooseHref}
                id={anchorId}
              >
                {CHANGE_IMAGE_LABEL}
                <span className="sr-only"> — nu {selection.name}</span>
              </a>
            )}

            {removeForm === undefined ? null : (
              <form action={removeForm.action}>
                {removeForm.hidden.map((field) => (
                  <input key={field.name} name={field.name} type="hidden" value={field.value} />
                ))}
                <input
                  name={IMAGE_SELECT_FORM.version}
                  type="hidden"
                  value={removeForm.version}
                />
                {/*
                  The submit button *is* the empty selection: `billede=""` says
                  "no image", parsed by the same reader every choice goes through.
                */}
                <button
                  className="rounded-field border-field-border text-neutral-ink hover:border-rule bg-surface inline-flex min-h-tap items-center border-[1.5px] px-4 font-semibold"
                  name={IMAGE_SELECT_FORM.image}
                  type="submit"
                  value=""
                >
                  {REMOVE_IMAGE_LABEL}
                </button>
              </form>
            )}
          </div>

          <p className="text-ink-3 text-micro w-full md:w-auto md:max-w-[26ch]">
            {removeForm === undefined ? null : REMOVE_IMAGE_HINT}
          </p>
        </div>
      )}
    </div>
  )
}
