import type { AdminImage } from '@/lib/content/images-admin'
import { imageAccessibleName } from '@/lib/images/library'
import {
  IMAGE_PICKER_EMPTY,
  IMAGE_PICKER_HEADING,
  IMAGE_PICKER_LIBRARY_LINK,
  IMAGE_PICKER_SELECTED,
  IMAGE_SELECT_FORM,
} from '@/lib/images/selection'

import { ImageThumbnail } from './ImageThumbnail'
import { ModalDialog } from '../menu/ModalDialog'

/**
 * The picker — one existing image, chosen from the library's own thumbnails
 * (phase 10C-1, brief §3/§4).
 *
 * The approved frames draw only the slot and "Vælg billede", so the picker uses
 * the smallest existing admin pattern: a server-rendered block the URL opens,
 * promoted to a modal `<dialog>` by `ModalDialog` — focus trapped, `Esc` is
 * cancel, backdrop inert, and with scripting off it is an ordinary block the
 * opening link's own fragment scrolls to, fully operable.
 *
 * Every choice is a **submit button** in one form: pressing a thumbnail submits
 * `billede=<id>` with the version token to the entity's own image action, which
 * re-verifies everything (§6 of the phase brief). Choosing is therefore one
 * deliberate press, works without JavaScript, and nothing about the library —
 * paths, formats, sizes — travels anywhere.
 *
 * Deliberately not here (brief §4): folders, search, filters, cropping, sorting,
 * metadata controls, and any upload. Uploading lives on `/admin/billeder`, which
 * the footer links to — the library screen remains the one place files are
 * managed, and this dialog remains a chooser.
 */

export type ImagePickerForm = {
  readonly action: (formData: FormData) => Promise<void>
  /** The screen's identifying fields (`ret`, `nyhed`, …) — never content. */
  readonly hidden: readonly { readonly name: string; readonly value: string }[]
  /** The `updated_at` the screen was rendered from — the concurrency token (§6). */
  readonly version: string
}

export function ImagePickerDialog({
  anchorId,
  cancelHref,
  form,
  images,
  selectedId,
  libraryHref,
}: {
  anchorId: string
  /** Back to the slot's own control — where the keyboard came from. */
  cancelHref: string
  form: ImagePickerForm
  images: readonly AdminImage[]
  /** The entity's current selection, marked "Valgt" — never colour alone (1aa). */
  selectedId: string | null
  /** The image library, for uploading or managing files (brief §3). */
  libraryHref: string
}) {
  const headingId = `${anchorId}-titel`

  return (
    <ModalDialog cancelHref={cancelHref} id={anchorId} labelledBy={headingId}>
      <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-4 md:p-5">
        <h2 className="text-heading font-sans font-semibold" id={headingId}>
          {IMAGE_PICKER_HEADING}
        </h2>

        {images.length === 0 ? (
          <p className="text-ink-2 text-meta">{IMAGE_PICKER_EMPTY}</p>
        ) : (
          <form action={form.action}>
            {form.hidden.map((field) => (
              <input key={field.name} name={field.name} type="hidden" value={field.value} />
            ))}
            <input name={IMAGE_SELECT_FORM.version} type="hidden" value={form.version} />

            <ul className="grid list-none grid-cols-2 gap-3.5 p-0 md:grid-cols-3">
              {images.map((image) => {
                const selected = image.id === selectedId
                const name = imageAccessibleName(image.altText, image.originalFilename)

                return (
                  <li key={image.id}>
                    <button
                      className={`rounded-card block w-full text-left ${
                        selected
                          ? '[outline:3px_solid_var(--color-focus)] outline-offset-2'
                          : ''
                      }`}
                      name={IMAGE_SELECT_FORM.image}
                      type="submit"
                      value={image.id}
                    >
                      <span className="sr-only">
                        {selected ? `${IMAGE_PICKER_SELECTED}: ` : ''}
                        {name}
                      </span>
                      {image.thumbnail === null ? (
                        <span
                          aria-hidden="true"
                          className="bg-field-bg border-field-border rounded-card flex h-[6.875rem] items-center justify-center border font-mono text-label text-ink-3 uppercase"
                        >
                          Foto
                        </span>
                      ) : (
                        <ImageThumbnail
                          altText={null}
                          className="rounded-card h-[6.875rem] w-full object-cover"
                          sizes="(min-width: 768px) 9rem, 40vw"
                          thumbnail={image.thumbnail}
                        />
                      )}
                      <span
                        aria-hidden="true"
                        className="text-ink-2 mt-1.5 block truncate text-[0.8125rem] leading-snug"
                      >
                        {selected ? (
                          <span className="text-brand-700 font-semibold">
                            ✓ {IMAGE_PICKER_SELECTED} ·{' '}
                          </span>
                        ) : null}
                        {name}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </form>
        )}

        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <a className="text-brand-700 min-h-tap inline-flex items-center font-medium underline" href={libraryHref}>
            {IMAGE_PICKER_LIBRARY_LINK}
          </a>

          {/*
            The safe way out, focused on open: a chooser must never open with the
            keyboard on a choice, and closing it is a real navigation back to the
            control it was opened from (the `ModalDialog` contract).
          */}
          <a
            className="rounded-field border-field-border text-neutral-ink hover:border-rule bg-surface inline-flex min-h-tap items-center border-[1.5px] px-4 font-semibold"
            data-autofocus
            href={cancelHref}
          >
            Annuller
          </a>
        </div>
      </div>
    </ModalDialog>
  )
}
