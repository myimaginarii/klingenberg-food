import { ModalDialog } from '@/components/admin/menu/ModalDialog'
import type { AdminImageThumbnail } from '@/lib/content/images-admin'

import { ImageThumbnail } from '../images/ImageThumbnail'

/**
 * The dish picker — 1u's "+ Vælg en burger fra menuen" and each slot's "Skift".
 *
 * The same shape as the image picker (10C-1): a server-rendered block the URL opens,
 * promoted to a modal `<dialog>` by `ModalDialog` — focus trapped, `Esc` is cancel,
 * backdrop inert — and an ordinary fragment-scrolled block with scripting off, fully
 * operable. Every choice is a **submit button** in one form: pressing a dish submits
 * `ret=<id>` with the version token, the control (`tilfoej` or `skift`) and the slot to
 * the featured action, which re-verifies everything before writing.
 *
 * The list is the menu as the administration reads it — every section, every dish that
 * is not soft-deleted, grouped and ordered as the menu is — so what a person chooses
 * from is what the menu screen shows. Deliberately no search, no filter, no typing: a
 * menu of this size is a list, and a typed name would be a name written twice (1u).
 */
export type PickerDish = {
  readonly id: string
  readonly name: string
  readonly thumbnail: AdminImageThumbnail | null
  /** True when the dish is already in a featured slot other than the one being changed. */
  readonly taken: boolean
}

export type PickerCategory = {
  readonly id: string
  readonly name: string
  readonly dishes: readonly PickerDish[]
}

export type HomeDishPickerForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: {
    readonly version: string
    readonly action: string
    readonly dish: string
  }
  /** `tilfoej` for the next free slot, `skift:<slot>` for an existing one (`forms.ts`). */
  readonly actionValue: string
  /** The slot being changed, or `null` when adding — for the heading. */
  readonly slot: number | null
  readonly version: string
}

export function HomeDishPickerDialog({
  anchorId,
  cancelHref,
  form,
  categories,
  selectedId,
}: {
  anchorId: string
  /** Back to the control the picker was opened from — where the keyboard came from. */
  cancelHref: string
  form: HomeDishPickerForm
  categories: readonly PickerCategory[]
  /** The slot's current dish, marked "Valgt" — never colour alone (1aa). */
  selectedId: string | null
}) {
  const headingId = `${anchorId}-titel`
  const listed = categories.filter((category) => category.dishes.length > 0)

  return (
    <ModalDialog cancelHref={cancelHref} id={anchorId} labelledBy={headingId}>
      <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-4 md:p-5">
        <h2 className="text-heading font-sans font-semibold" id={headingId}>
          {form.slot === null ? 'Vælg en burger fra menuen' : `Skift retten på plads ${form.slot + 1}`}
        </h2>

        {listed.length === 0 ? (
          <p className="text-ink-2 text-meta">Der er ingen retter på menuen endnu.</p>
        ) : (
          <form action={form.action}>
            <input name={form.fieldNames.version} type="hidden" value={form.version} />
            <input name={form.fieldNames.action} type="hidden" value={form.actionValue} />

            <div className="flex flex-col gap-4">
              {listed.map((category) => (
                <section aria-labelledby={`${anchorId}-${category.id}`} key={category.id}>
                  <h3
                    className="font-mono text-label text-ink-3 mb-2 uppercase"
                    id={`${anchorId}-${category.id}`}
                  >
                    {category.name}
                  </h3>

                  <ul className="flex list-none flex-col gap-2 p-0">
                    {category.dishes.map((dish) => {
                      const selected = dish.id === selectedId

                      return (
                        <li key={dish.id}>
                          <button
                            className={`rounded-card border-border hover:bg-surface-muted flex min-h-tap w-full items-center gap-3 border p-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${
                              selected ? '[outline:3px_solid_var(--color-focus)] outline-offset-2' : ''
                            }`}
                            disabled={dish.taken}
                            name={form.fieldNames.dish}
                            type="submit"
                            value={dish.id}
                          >
                            {dish.thumbnail === null ? (
                              <span
                                aria-hidden="true"
                                className="bg-field-bg border-field-border rounded-card flex h-12 w-16 shrink-0 items-center justify-center border font-mono text-label text-ink-3 uppercase"
                              >
                                Foto
                              </span>
                            ) : (
                              <ImageThumbnail
                                altText={null}
                                className="rounded-card h-12 w-16 shrink-0 object-cover"
                                sizes="4rem"
                                thumbnail={dish.thumbnail}
                              />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="text-ink block truncate font-semibold">
                                {selected ? <span className="text-brand-700">✓ Valgt · </span> : null}
                                {dish.name}
                              </span>
                              {dish.taken && !selected ? (
                                <span className="text-ink-3 text-micro block">Allerede valgt</span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </form>
        )}

        <div className="border-border flex flex-wrap items-center justify-end gap-3 border-t pt-4">
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
