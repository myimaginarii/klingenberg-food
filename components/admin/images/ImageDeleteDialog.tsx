import { ModalDialog } from '@/components/admin/menu/ModalDialog'
import type { AdminImage } from '@/lib/content/images-admin'
import {
  describeImageDeletion,
  HOMEPAGE_OWNER_ONLY_NOTE,
  imageDisplayName,
} from '@/lib/images/library'

/**
 * The delete confirmation — design 1w's warning, the 1r rule ("Slet spørger
 * altid"); phase 10B (brief §14).
 *
 * The administration's one confirmation shape: reached by a **link** (nothing has
 * happened yet), rendered by the server as an ordinary block that JavaScript
 * promotes to a modal `<dialog>`, resolved by a form a person has to submit. The
 * safe way out comes first, filled, and holds focus.
 *
 * For an image that is in use, the question says exactly where it is used and
 * that a confirmed deletion removes it from every listed place — 1w's own
 * sentence, with the atomic removal `delete_image()` performs behind it. The form
 * then carries the confirmation bit; for an unused image it does not, so a
 * deletion confirmed over a stale "unused" rendering meets `in_use` at the
 * database and deletes nothing.
 */
export function ImageDeleteDialog({
  image,
  anchorId,
  cancelHref,
  action,
  fieldNames,
  homepageOwnerOnly = false,
}: {
  image: AdminImage
  anchorId: string
  /** Back to the Slet control this was opened from, so focus returns there. */
  cancelHref: string
  action: (formData: FormData) => Promise<void>
  fieldNames: {
    readonly imageId: string
    readonly version: string
    readonly confirmed: string
  }
  /** The Forside names this image and the viewer is not the owner (phase 11A, §5). */
  homepageOwnerOnly?: boolean
}) {
  const headingId = `${anchorId}-titel`
  const prompt = describeImageDeletion(image.usages)
  const used = image.usages.length > 0

  if (homepageOwnerOnly) {
    // A hand-typed confirmation address meets the same answer the transition would
    // give: the question is stated, and the only control is the way back.
    return (
      <ModalDialog cancelHref={cancelHref} id={anchorId} labelledBy={headingId}>
        <div className="flex flex-col gap-4 p-4 md:p-5">
          <div>
            <h2 className="text-heading font-sans font-semibold" id={headingId}>
              {prompt.question}
            </h2>
            <p className="text-ink-2 text-meta mt-1">{HOMEPAGE_OWNER_ONLY_NOTE}</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <a
              className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap inline-flex items-center px-5 font-semibold text-white"
              data-autofocus
              href={cancelHref}
            >
              Behold billedet
            </a>
          </div>
        </div>
      </ModalDialog>
    )
  }

  return (
    <ModalDialog cancelHref={cancelHref} id={anchorId} labelledBy={headingId}>
      <div className="flex flex-col gap-4 p-4 md:p-5">
        <div>
          <h2 className="text-heading font-sans font-semibold" id={headingId}>
            {prompt.question}
          </h2>
          <p className="text-ink-2 text-meta mt-1">{prompt.consequence}</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <a
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap inline-flex items-center px-5 font-semibold text-white"
            data-autofocus
            href={cancelHref}
          >
            Behold billedet
          </a>

          <form action={action}>
            <input name={fieldNames.imageId} type="hidden" value={image.id} />
            <input name={fieldNames.version} type="hidden" value={image.updatedAt} />
            {/* The bit says which question was answered: only a confirmation that
                named the usages may confirm past them (brief §14). */}
            {used ? <input name={fieldNames.confirmed} type="hidden" value="1" /> : null}
            <button
              className="rounded-field border-error text-error-ink hover:bg-error-surface min-h-tap bg-surface inline-flex items-center border-[1.5px] px-4 font-semibold"
              type="submit"
            >
              {prompt.confirmLabel}
              <span className="sr-only"> — {imageDisplayName(image.originalFilename)}</span>
            </button>
          </form>
        </div>
      </div>
    </ModalDialog>
  )
}
