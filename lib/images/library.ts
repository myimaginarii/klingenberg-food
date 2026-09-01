import {
  derivativePath,
  type DerivativeRecord,
  type DerivativeSize,
} from './derivatives'
import { uploadIdOfStoragePath } from './rules'

/**
 * The library's view model — design 1w; technical plan §4, §15 (phase 10B).
 *
 * The pure half of the 1w screen: what a card says about where an image is used,
 * which derivative a thumbnail loads, what the alt-text field accepts, and the
 * sentences the delete and replace confirmations say. Nothing here touches
 * Supabase, sharp or the DOM — the read module (`lib/content/images-admin.ts`)
 * feeds it rows, and the components render its answers.
 *
 * USAGE IS IDS, NEVER TEXT (phase-10B brief §3). A usage arrives here because a
 * row in one of the four image_id relationships — dishes, weekly_special,
 * monthly_burger, news — names the image by id. Nothing is ever inferred from a
 * filename, an alt text or a path, and there is no stored usage anywhere: the read
 * module derives the list on every request, so it cannot go stale or disagree with
 * the reference-aware refusal `delete_image()` computes from the same four tables.
 */

/** One place an image is used, derived from one image_id foreign key. */
export type ImageUsage = {
  readonly kind: 'dish' | 'weekly' | 'monthly' | 'news'
  /** What the label calls the place: the dish's name, the fixed singleton names, the article's title. */
  readonly name: string
}

/** 1w's muted state for an image nothing references. */
export const UNUSED_LABEL = 'Bruges ikke endnu'

/**
 * 1w's caption under a thumbnail: "Bruges på: Odin". Multiple usages are joined
 * with the interpunct the design already uses for joined facts, so an image on
 * both a dish and a news article names both clearly (§3 of the phase brief).
 */
export function usageLabel(usages: readonly ImageUsage[]): string {
  if (usages.length === 0) return UNUSED_LABEL
  return `Bruges på: ${usages.map((usage) => usage.name).join(' · ')}`
}

/**
 * The smallest appropriate public derivative for a library thumbnail (phase-10B
 * brief §12): the first — smallest — rung of the stored record, in WebP.
 *
 * WebP rather than AVIF for the `<img src>`, with the AVIF twin offered through a
 * `<picture>` source by the component: every browser this administration supports
 * decodes WebP, and a thumbnail must never be the 2160 rung or the private
 * original. The record's `widths` are stored smallest-first by the pipeline
 * (`planDerivatives` filters an ascending ladder), and the defensive `reduce`
 * keeps that true even for a record something else ordered.
 */
export type ThumbnailPlan = {
  /** Path inside the public derivatives bucket, e.g. `<uuid>/480.webp`. */
  readonly webpPath: string
  /** The AVIF twin at the same rung, for a `<picture>` source. */
  readonly avifPath: string
  /** Rendered dimensions of that rung — width/height attributes against layout shift. */
  readonly width: number
  readonly height: number
}

export function planThumbnail(
  storagePath: string,
  record: DerivativeRecord,
): ThumbnailPlan | null {
  if (record.widths.length === 0) return null

  const smallest = record.widths.reduce((left, right) =>
    right.width < left.width ? right : left,
  )
  const uploadId = uploadIdOfStoragePath(storagePath)

  return {
    webpPath: derivativePath(uploadId, smallest.width, 'webp'),
    avifPath: derivativePath(uploadId, smallest.width, 'avif'),
    width: smallest.width,
    height: smallest.height,
  }
}

/**
 * Parse a stored `derivatives` document into the record shape, or null.
 *
 * The database's `is_valid_image_derivatives()` guarantees the shape for every row
 * `create_image()` wrote, so this is a projection of trusted data — but it still
 * refuses rather than assumes, because a row written by a migration or a fixture
 * is a row too.
 */
export function readDerivativeRecord(value: unknown): DerivativeRecord | null {
  if (typeof value !== 'object' || value === null) return null

  const formats = (value as { formats?: unknown }).formats
  const widths = (value as { widths?: unknown }).widths

  if (!Array.isArray(formats) || !formats.every((f) => f === 'avif' || f === 'webp')) return null
  if (!Array.isArray(widths)) return null

  const sizes: DerivativeSize[] = []
  for (const entry of widths) {
    if (typeof entry !== 'object' || entry === null) return null
    const width = (entry as { width?: unknown }).width
    const height = (entry as { height?: unknown }).height
    if (typeof width !== 'number' || typeof height !== 'number') return null
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      return null
    }
    sizes.push({ width, height })
  }

  if (sizes.length === 0) return null
  return { formats: ['avif', 'webp'], widths: sizes }
}

/**
 * What a card or the detail panel calls the image. The person's own filename where
 * one survived sanitisation; a neutral Danish fallback otherwise. Deliberately no
 * byte size, no pixel measurements and no format anywhere in the display: 1w's own
 * caption — "Personalet ser aldrig filstørrelser, formater eller pixelmål" — is a
 * promise about this screen.
 */
export function imageDisplayName(originalFilename: string | null): string {
  return originalFilename ?? 'Billede uden filnavn'
}

/**
 * The alt text a person may store: a sentence about what the picture shows.
 *
 * Blank is absent (`null`), as everywhere else in this system — the public
 * renderers decide in 10C what an absent description means for markup. The cap is
 * generous for a real description and far below any storage concern; control
 * characters are refused rather than stripped, because silently rewriting a
 * person's sentence is how a "saved" text stops matching what they typed.
 */
export const ALT_TEXT_MAX_LENGTH = 300

export type AltTextResult =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly error: 'for_lang' | 'ugyldig' }

export function parseAltText(value: string): AltTextResult {
  const trimmed = value.trim()
  if (trimmed.length === 0) return { ok: true, value: null }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return { ok: false, error: 'ugyldig' }
  if (trimmed.length > ALT_TEXT_MAX_LENGTH) return { ok: false, error: 'for_lang' }
  return { ok: true, value: trimmed }
}

export const ALT_TEXT_ERROR_MESSAGES = {
  for_lang: `Beskrivelsen må højst være ${ALT_TEXT_MAX_LENGTH} tegn.`,
  ugyldig: 'Beskrivelsen kan ikke gemmes. Fjern specialtegnene, og prøv igen.',
} as const

/**
 * What a thumbnail's `alt` should say. The person's description when there is one;
 * otherwise empty, with the visible caption (usage label) carrying the context —
 * an unlabelled decorative repeat of the filename would be noise in a list where
 * every image is also a link whose name must mean something. The *link's* name
 * therefore combines the two: the description or the filename.
 */
export function thumbnailAlt(altText: string | null): string {
  return altText ?? ''
}

/** The accessible name of the card that opens an image: description, or filename. */
export function imageAccessibleName(altText: string | null, originalFilename: string | null): string {
  return altText ?? imageDisplayName(originalFilename)
}

/**
 * The delete confirmation's sentences — 1w's warning, said before anything happens.
 *
 * The used sentence is the frame's own ("Billedet bruges på Forsiden. Sletter du
 * det, forsvinder det også der.") with the real usage list in the place the frame
 * draws "Forsiden", plus the explicit removal statement the phase brief requires:
 * a confirmed deletion takes the image out of every listed place, atomically,
 * through `delete_image()`'s reference-nulling — never four separate updates.
 */
export type ImagePrompt = {
  readonly question: string
  readonly consequence: string
  readonly confirmLabel: string
}

export function describeImageDeletion(usages: readonly ImageUsage[]): ImagePrompt {
  if (usages.length === 0) {
    return {
      question: 'Slet billedet?',
      consequence:
        'Billedet fjernes fra biblioteket, og filerne slettes. Handlingen kan ikke fortrydes.',
      confirmLabel: 'Slet billede',
    }
  }

  const places = usages.map((usage) => usage.name).join(' · ')

  return {
    question: 'Slet billedet?',
    consequence:
      `Billedet bruges på: ${places}. Sletter du det, forsvinder det også der — ` +
      'det fjernes fra alle de nævnte steder med det samme. Handlingen kan ikke fortrydes.',
    confirmLabel: 'Slet billede',
  }
}

/**
 * The replace panel's explanation — what "Erstat" does, said before a file is
 * chosen. The order it promises is the order the architecture keeps (phase-10B
 * brief §17): the new image is uploaded and processed completely first, then one
 * trusted transition moves every reference, and only then is the old image
 * removed. Choosing a file after reading this is the confirmed action.
 */
export function describeImageReplacement(usages: readonly ImageUsage[]): string {
  const consequence =
    usages.length === 0
      ? 'Billedet bruges ikke endnu, så det nye tager blot dets plads i biblioteket.'
      : `Det nye billede overtager alle de steder, hvor det gamle bruges: ${usages
          .map((usage) => usage.name)
          .join(' · ')}.`

  return (
    `Vælg et nyt billede. ${consequence} ` +
    'Det gamle billede slettes først, når det nye er uploadet og klar — går noget galt, sker der ingenting.'
  )
}
