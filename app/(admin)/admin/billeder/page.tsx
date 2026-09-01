import { AdminSectionBar } from '@/components/admin/menu/AdminSectionBar'
import { ImageDeleteDialog } from '@/components/admin/images/ImageDeleteDialog'
import { ImageDetailPanel } from '@/components/admin/images/ImageDetailPanel'
import { ImageLibraryGrid } from '@/components/admin/images/ImageLibraryGrid'
import { ImagesStatusNotice } from '@/components/admin/images/ImagesStatusNotice'
import { ImageUploader } from '@/components/admin/images/ImageUploader'
import { requireStaff } from '@/lib/auth/guards'
import { readAdminImageLibrary, type AdminImage } from '@/lib/content/images-admin'
import { describeImageReplacement } from '@/lib/images/library'
import { formatDanishDate } from '@/lib/format/danish'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

import { saveAltText } from './alt-actions'
import { deleteImage } from './delete-actions'
import {
  decodeImagesErrors,
  IMAGES_ERROR_FIELD,
  IMAGES_ERROR_MESSAGES,
  IMAGES_FORM,
} from './image-form'
import { replaceUploadedImage } from './replace-actions'
import {
  imagesHref,
  DELETE_BUTTON_ANCHOR,
  DELETE_DIALOG_ANCHOR,
  DETAIL_ANCHOR,
  IMAGES_PARAM,
  IMAGES_PATH,
  REPLACE_BUTTON_ANCHOR,
  REPLACE_PANEL_ANCHOR,
  UPLOAD_INPUT_ANCHOR,
} from './routes'
import { finalizeUpload, requestUpload } from './upload-actions'

/**
 * Billeder — design 1w (desktop; 1x draws only the dashboard tile for the phone);
 * technical plan §1 (adjustments 2 and 3), §4, §8, §15 (phase 10B).
 *
 * The restaurant's media library: upload through the 10A pipeline, the grid with
 * its usage captions, the detail panel with the alt-text edit, and 1w's Erstat and
 * Slet. Staff **and** Owner (§5's "Dish photos, and all image upload / replace /
 * delete" row); anonymous visitors never get past `requireStaff()`.
 *
 * All the state this screen has is in the URL (`./routes.ts`): which image is
 * open, whether its deletion is being confirmed, whether the replace panel is
 * showing, and what the last action did. The upload is the one client-driven flow
 * (a signed PUT cannot be a form post) and it reports the same way — by
 * navigating to an address.
 *
 * USAGE IS INFORMATIONAL ONLY in 10B (brief §18): the captions say where an image
 * is used, and no editor anywhere lets anybody choose one — `image_id` stays out
 * of every content form until 10C, which the images-boundary policy suite asserts.
 */

/**
 * Processing headroom (§0t's closing note, brief §9): finalize downloads the
 * original and renders up to eight derivatives. Measured against the real local
 * stack at ~1.9 s for a 29.7-megapixel original
 * (tests/integration/images-large.test.ts), so sixty seconds is generous headroom
 * for a slower production vCPU, a cold function and real storage round-trips,
 * while staying far below anything runaway.
 */
export const maxDuration = 60

/** A repeated parameter is a malformed request, not two answers: take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export default async function ImagesAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireStaff()

  const [params, images] = await Promise.all([searchParams, readAdminImageLibrary()])

  const status = one(params[IMAGES_PARAM.status])
  const selectedId = one(params[IMAGES_PARAM.image])
  const confirmDeleteId = one(params[IMAGES_PARAM.confirmDelete])
  const replaceId = one(params[IMAGES_PARAM.replace])

  const byId = (id: string | undefined): AdminImage | null =>
    id === undefined ? null : (images.find((image) => image.id === id) ?? null)

  // The detail panel resolves against the server's own read — an id naming
  // nothing produces no panel and no dialog at all.
  const replacing = byId(replaceId)
  const selected = replacing ?? byId(selectedId)
  const confirmingDelete = byId(confirmDeleteId)

  // A refused alt save echoes what was typed; so does a conflict. The echo exists
  // only when its parameter does — a delete conflict carries no text to echo.
  const echoedAlt = one(params[IMAGES_FORM.altText])
  const firstAltError = decodeImagesErrors(many(params[IMAGES_ERROR_FIELD]))[0]
  const altError = firstAltError === undefined ? undefined : IMAGES_ERROR_MESSAGES[firstAltError]

  const uploaderWiring = {
    requestAction: requestUpload,
    finalizeAction: finalizeUpload,
    libraryPath: IMAGES_PATH,
    imageParam: IMAGES_PARAM.image,
    statusParam: IMAGES_PARAM.status,
    detailAnchor: DETAIL_ANCHOR,
  }

  return (
    <>
      <AdminSectionBar backHref="/admin" backLabel="Tilbage" title="Billeder">
        {/* 1w's bar control. A link to the chooser rather than a control of its
            own: there is one upload flow on the screen, and this lands on it. */}
        <a
          className="rounded-field text-brand-700 inline-flex min-h-tap items-center bg-white px-4 text-meta font-semibold hover:bg-brand-50"
          href={imagesHref({ image: selected?.id ?? null, focus: 'upload' })}
        >
          + Upload
        </a>
      </AdminSectionBar>

      <main className="mx-auto flex w-full max-w-[52rem] flex-col gap-4 px-gutter py-6 md:px-8">
        <ImagesStatusNotice status={status} />

        <p className="text-ink-2 text-meta">
          Billeder til hjemmesiden. Upload dem her — hvor de vises, vælges i de enkelte
          redigeringer, når billedvalget åbner.
        </p>

        <ImageUploader {...uploaderWiring} inputId={UPLOAD_INPUT_ANCHOR} />

        {images.length === 0 ? (
          <p className="text-ink-3 text-meta">
            Der er ingen billeder endnu. Det første, du uploader, vises her.
          </p>
        ) : null}

        <ImageLibraryGrid
          hrefFor={(image) => imagesHref({ image: image.id })}
          images={images}
          selectedId={selected?.id}
          uploadHref={imagesHref({ image: selected?.id ?? null, focus: 'upload' })}
        />

        {selected === null ? null : replacing !== null ? (
          /*
            1w's Erstat, as its own explained step (brief §17): the sentence says
            exactly what will happen, choosing a file is the confirmed action, and
            Fortryd backs out having changed nothing. The uploader runs the whole
            10A pipeline for the new image first; only then does the trusted
            transition move the references and remove the old image.
          */
          <section
            aria-labelledby={`${REPLACE_PANEL_ANCHOR}-titel`}
            className="bg-surface border-border rounded-card shadow-admin-card border p-4 md:p-5"
            id={REPLACE_PANEL_ANCHOR}
          >
            <h2 className="text-heading font-sans font-semibold" id={`${REPLACE_PANEL_ANCHOR}-titel`}>
              Erstat billedet
            </h2>
            <p className="text-ink-2 text-meta mt-1">
              {describeImageReplacement(replacing.usages)}
            </p>

            <div className="mt-4">
              <ImageUploader
                {...uploaderWiring}
                inputId="erstat-upload"
                replace={{ oldId: replacing.id, oldVersion: replacing.updatedAt }}
                replaceAction={replaceUploadedImage}
              />
            </div>

            <p className="mt-3">
              <a
                className="text-brand-700 text-meta min-h-tap inline-flex items-center underline"
                href={imagesHref({ image: replacing.id, focus: 'replace' })}
              >
                Fortryd — behold det nuværende billede
              </a>
            </p>
          </section>
        ) : (
          <ImageDetailPanel
            altAction={saveAltText}
            altDefault={echoedAlt ?? selected.altText ?? ''}
            altError={altError}
            altFieldNames={IMAGES_FORM}
            anchorId={DETAIL_ANCHOR}
            closeHref={imagesHref()}
            deleteButtonId={DELETE_BUTTON_ANCHOR}
            deleteHref={imagesHref({ image: selected.id, confirmDelete: selected.id })}
            image={selected}
            replaceButtonId={REPLACE_BUTTON_ANCHOR}
            replaceHref={imagesHref({ image: selected.id, replace: selected.id })}
            uploadedOn={formatDanishDate(copenhagenDateOf(new Date(selected.createdAt)))}
          />
        )}

        {confirmingDelete === null ? null : (
          <ImageDeleteDialog
            action={deleteImage}
            anchorId={DELETE_DIALOG_ANCHOR}
            cancelHref={imagesHref({ image: confirmingDelete.id, focus: 'delete' })}
            fieldNames={IMAGES_FORM}
            image={confirmingDelete}
          />
        )}
      </main>
    </>
  )
}
