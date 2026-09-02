import { TextAreaField } from '@/components/admin/Field'
import { SubmitButton } from '@/components/admin/SubmitButton'
import type { AdminImage } from '@/lib/content/images-admin'
import {
  imageDisplayName,
  HOMEPAGE_OWNER_ONLY_NOTE,
  UNUSED_LABEL,
  ALT_TEXT_MAX_LENGTH,
} from '@/lib/images/library'

import { ImageThumbnail } from './ImageThumbnail'

/**
 * The detail panel — 1w's "NÅR MAN TRYKKER PÅ ET BILLEDE"; phase 10B.
 *
 * The frame draws three things: the preview, the in-use warning ("Billedet bruges
 * på Forsiden. Sletter du det, forsvinder det også der."), and the Erstat/Slet
 * pair. The **alt-text field is added** — an infrastructure-required state 1w does
 * not draw: `images.alt_text` is the one person-authored column the 10A permission
 * surface deliberately left editable, and a library with no way to describe a
 * picture would ship an accessibility promise with no way to keep it. It is drawn
 * with the administration's existing field tokens and nothing new.
 *
 * What the panel deliberately does NOT show: byte size, pixel measurements or
 * format — 1w's own caption promises staff never see them — and no private
 * original URL exists anywhere in the markup: the preview is the same public
 * derivative the grid uses.
 *
 * Erstat and Slet are **links**: pressing one opens the replace panel or the
 * delete confirmation, and nothing has happened yet. The forms that act carry the
 * version token this panel was rendered from (§6).
 */
export function ImageDetailPanel({
  image,
  uploadedOn,
  altAction,
  altFieldNames,
  altDefault,
  altError,
  closeHref,
  replaceHref,
  deleteHref,
  anchorId,
  replaceButtonId,
  deleteButtonId,
  homepageOwnerOnly = false,
}: {
  image: AdminImage
  /** "01.09.2026" — derived by the page from the row's Copenhagen-local date. */
  uploadedOn: string
  altAction: (formData: FormData) => Promise<void>
  altFieldNames: { readonly imageId: string; readonly version: string; readonly altText: string }
  /** What the field shows: the stored text, or a refused save's echo. */
  altDefault: string
  altError?: string
  closeHref: string
  replaceHref: string
  deleteHref: string
  anchorId: string
  replaceButtonId: string
  deleteButtonId: string
  /**
   * The Forside names this image and the viewer is not the owner (phase 11A, §5):
   * Erstat and Slet would be refused by the transitions, so the panel says who can
   * instead of drawing two controls that lead to a refusal.
   */
  homepageOwnerOnly?: boolean
}) {
  const headingId = `${anchorId}-titel`
  const used = image.usages.length > 0

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-heading font-sans font-semibold" id={headingId}>
          {imageDisplayName(image.originalFilename)}
        </h2>
        <a
          className="text-brand-700 text-meta min-h-tap inline-flex items-center underline"
          href={closeHref}
        >
          ‹ Alle billeder
        </a>
      </div>

      <p className="text-ink-3 text-meta mt-0.5">Uploadet {uploadedOn}</p>

      <div className="mt-4 flex flex-col gap-4 md:flex-row md:gap-5">
        {image.thumbnail === null ? (
          <div className="bg-field-bg border-field-border rounded-card flex h-[8.75rem] w-full max-w-[12.5rem] flex-none items-center justify-center border font-mono text-label text-ink-3 uppercase">
            Foto
          </div>
        ) : (
          <ImageThumbnail
            altText={image.altText}
            className="rounded-card h-[8.75rem] w-full max-w-[12.5rem] flex-none object-cover"
            sizes="12.5rem"
            thumbnail={image.thumbnail}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {used ? (
            /* 1w's warning, with the real usage list where the frame draws "Forsiden".
               Amber tokens and the diamond mark, so the state is never colour alone. */
            <p className="bg-warning-surface border-warning-border text-warning-ink rounded-field flex items-center gap-3 border px-3.5 py-3 text-meta font-medium">
              <span
                aria-hidden="true"
                className="bg-warning size-3.5 flex-none rotate-45"
              />
              <span>
                Billedet bruges på: {image.usages.map((usage) => usage.name).join(' · ')}. Sletter
                du det, forsvinder det også der.
              </span>
            </p>
          ) : (
            <p className="text-ink-3 text-meta">{UNUSED_LABEL}.</p>
          )}

          <form action={altAction} className="flex flex-col gap-3">
            <input name={altFieldNames.imageId} type="hidden" value={image.id} />
            <input name={altFieldNames.version} type="hidden" value={image.updatedAt} />

            <TextAreaField
              defaultValue={altDefault}
              error={altError}
              hint="Beskriv, hvad billedet viser — bruges af skærmlæsere, og når billedet ikke kan vises. Feltet må være tomt."
              id="billede-beskrivelse"
              label="Beskrivelse af billedet"
              maxLength={ALT_TEXT_MAX_LENGTH}
              name={altFieldNames.altText}
              rows={2}
            />

            <div>
              <SubmitButton>Gem beskrivelse</SubmitButton>
            </div>
          </form>

          {homepageOwnerOnly ? (
            <p className="text-ink-2 text-meta" id={`${anchorId}-kun-ejer`}>
              <span aria-hidden="true">● </span>
              {HOMEPAGE_OWNER_ONLY_NOTE}
            </p>
          ) : (
            <div className="flex flex-col gap-2.5 md:flex-row">
              <a
                className="rounded-field border-neutral-ink text-neutral-ink hover:bg-section bg-surface inline-flex min-h-tap items-center justify-center border-[1.5px] px-4.5 font-semibold"
                href={replaceHref}
                id={replaceButtonId}
              >
                Erstat
              </a>
              <a
                className="rounded-field border-error text-error-ink hover:bg-error-surface bg-surface inline-flex min-h-tap items-center justify-center border-[1.5px] px-4.5 font-semibold"
                href={deleteHref}
                id={deleteButtonId}
              >
                Slet
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
