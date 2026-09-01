import { z } from 'zod'

/**
 * Choosing an image in a content editor — the shared pure half (phase 10C-1).
 *
 * Four editors gained an image slot in 10C-1 — the dish panel (1r), Ugens ret
 * (1ag), Månedens burger (1ah) and the news editor (1s) — and all four speak this
 * one vocabulary, so "what may a picker submit?" is answerable by reading one
 * file. What a picker may submit is deliberately tiny:
 *
 *   * **the version token** — the `updated_at` the screen was rendered from,
 *     which is the whole of optimistic concurrency (§6);
 *   * **the selected image id, or nothing**. An empty value is 1r's "Fjern
 *     billede": it clears the *selection*, and never deletes anything from the
 *     library — asset deletion stays on `/admin/billeder`.
 *
 * There is no field for a storage path, a derivative, a MIME type, a dimension, a
 * bucket, a filename or an alt text (§21, §22 of the phase brief): the id is the
 * only thing about an image that is legitimately the browser's to say, and the
 * server re-verifies even that — the image must exist, read through the caller's
 * own JWT, before any draft or row is written.
 *
 * THE DELTA RULE, RESTATED FOR ONE FIELD
 *
 * For the three draft-based entities a selection is an ordinary draft change
 * (§4, §6): the draft holds `image_id` only while it differs from the published
 * value. {@link imageDraftWrite} is the same shape `weeklyDraftWrite` and
 * `monthlyDraftWrite` produce, reduced to the one field this editor owns —
 * choosing the image that is already live takes the field back *out* of the
 * draft, and removing an image the hjemmeside shows writes an explicit
 * `image_id: null` (a pending clearing, §8 of the phase brief).
 *
 * News is not here: it has no draft column, so its action maps a selection
 * straight onto the row through the one news save path (`saveNewsArticle`).
 */

/**
 * The two field names every image-selection form uses.
 *
 * `billede` carries the id — the same word the image library's own forms already
 * use for one — and an empty value means "no image". Screens add their own
 * identifying fields (`ret`, `nyhed`) from their own vocabularies.
 */
export const IMAGE_SELECT_FORM = {
  version: 'version',
  image: 'billede',
} as const

export type ImageSelectionRequest = {
  readonly expectedUpdatedAt: string
  /** The chosen library image, or `null` for "Fjern billede". */
  readonly imageId: string | null
}

const selectionSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  imageId: z.union([z.uuid(), z.literal('')]),
})

function text(source: FormData, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Parse a selection submission, or return `null`.
 *
 * `null` is the answer for anything malformed — a version that is not a
 * timestamp, an image value that is neither empty nor a uuid. The action turns
 * that into one refusal; it never guesses at what was meant.
 */
export function readImageSelectionForm(formData: FormData): ImageSelectionRequest | null {
  const parsed = selectionSchema.safeParse({
    expectedUpdatedAt: text(formData, IMAGE_SELECT_FORM.version),
    imageId: text(formData, IMAGE_SELECT_FORM.image),
  })

  if (!parsed.success) return null

  return {
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    imageId: parsed.data.imageId === '' ? null : parsed.data.imageId,
  }
}

/**
 * What a selection should write into the entity's draft, and what it should take
 * back out — measured against the **published** value, like every other delta in
 * this administration (§4).
 */
export type ImageDraftWrite = {
  readonly values: { readonly image_id?: string | null }
  readonly clear: readonly string[]
}

export function imageDraftWrite(
  submitted: string | null,
  liveImageId: string | null,
): ImageDraftWrite {
  if (submitted === liveImageId) {
    // No difference from the hjemmeside: the field leaves the draft, so a
    // selection changed back cannot keep a Kladde badge alive (§4).
    return { values: {}, clear: ['image_id'] }
  }

  return { values: { image_id: submitted }, clear: [] }
}

// ---------------------------------------------------------------------------
// The slot's and the picker's Danish, stated once for all four editors
// ---------------------------------------------------------------------------

/** The label every photo slot carries — the approved frames' own words. */
export const IMAGE_SLOT_LABEL = 'Billede (valgfrit)'

/** The choose control: 1ag/1ah/1s draw exactly this. */
export const CHOOSE_IMAGE_LABEL = 'Vælg billede'

/**
 * The chosen-state controls. 1r draws "Erstat"/"Fjern"; this administration says
 * "Skift billede"/"Fjern billede" instead, because "Erstat" already has a
 * different, heavier meaning one screen away — the library's Erstat replaces the
 * asset everywhere it is used, while this changes one entity's selection. One
 * word must not mean two things (recorded as a 10C-1 departure).
 */
export const CHANGE_IMAGE_LABEL = 'Skift billede'
export const REMOVE_IMAGE_LABEL = 'Fjern billede'

/** §10's distinction, said where the control is: removal never touches the library. */
export const REMOVE_IMAGE_HINT =
  'Fjern billede fjerner kun valget her — billedet bliver i billedbiblioteket.'

/** The picker dialog's name, and its way to the library. */
export const IMAGE_PICKER_HEADING = 'Vælg billede'
export const IMAGE_PICKER_LIBRARY_LINK = 'Upload eller administrér billeder'
export const IMAGE_PICKER_EMPTY =
  'Der er ingen billeder i biblioteket endnu. Upload et under Billeder først.'

/** The marker on the currently selected choice — never colour alone (1aa). */
export const IMAGE_PICKER_SELECTED = 'Valgt'
