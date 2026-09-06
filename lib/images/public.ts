import {
  derivativePath,
  derivativePublicUrl,
  type DerivativeRecord,
} from './derivatives'
import { readDerivativeRecord } from './library'
import { isOriginalStoragePath, uploadIdOfStoragePath } from './rules'

/**
 * The public image model — technical plan §1 (adjustment 3), §4, §8, §11; phase
 * 10C-2.
 *
 * One pure representation of a library image as the public site renders it: the
 * authored description, the processed AVIF and WebP candidates of the derivative
 * ladder, one WebP fallback, and the intrinsic dimensions a layout needs. Built
 * from exactly three stored facts — `storage_path`, `alt_text`, `derivatives` —
 * and nothing else: no original filename, no uploader, no byte size, no MIME.
 *
 * WHAT A CANDIDATE IS, AND IS NOT. Every URL here is a derivative in the public
 * `media` bucket, composed through the one central path builder from the row's own
 * storage path and the rungs the record *measured*. The private original is never a
 * candidate, never a fallback and never a URL this module can produce: the model
 * knows the private bucket's name no more than a component does. A rung the record
 * does not carry is never referenced (no upscaling, no guessed 2160), and a record
 * that does not parse is no model at all — the caller falls back to the reserved
 * placeholder rather than to an invented address.
 *
 * ALT (§22, phase-10C-2 brief §8). The library owns the description; entities carry
 * only an id. A null or blank description renders as `alt=""`: every slot on the
 * public site sits beside the text that names the thing (the dish's heading, the
 * article's title), so an undescribed photograph is decorative repetition for a
 * screen reader, and repeating the entity's name into `alt` would be exactly the
 * duplicate verbose text the accepted model refuses. Nothing here copies a name,
 * a filename or a keyword into the description.
 */

/** One rung of the ladder, as both formats, with its measured dimensions. */
export type PublicImageCandidate = {
  readonly width: number
  readonly height: number
  readonly avifUrl: string
  readonly webpUrl: string
}

export type PublicImage = {
  /** The authored description, or `''` when there is none (see the module note). */
  readonly alt: string
  /** Intrinsic dimensions of the largest rung — the aspect ratio every rung shares. */
  readonly width: number
  readonly height: number
  /** The WebP fallback for a browser that ignores `srcset` — never the largest rung. */
  readonly src: string
  /** `srcset` strings, ascending by width, one per format. */
  readonly avifSrcSet: string
  readonly webpSrcSet: string
  /** The rungs, ascending — for the SEO candidate and for tests; the strings above derive from it. */
  readonly candidates: readonly PublicImageCandidate[]
}

/**
 * The rung a `<img src>` fallback and the SEO surfaces prefer: the smallest rung
 * at or above the target, or the largest available when none reaches it. 960 is
 * wide enough for any slot on this site at 2× without being the 2160 rung; 1200 is
 * the Open Graph recommendation, and the ladder's 1440 rung is the one at or above it.
 */
const FALLBACK_TARGET_WIDTH = 960
const SEO_TARGET_WIDTH = 1200

function candidateAtLeast(
  candidates: readonly PublicImageCandidate[],
  target: number,
): PublicImageCandidate {
  // `candidates` is non-empty by construction (`buildPublicImage` refuses an empty
  // record), so the last entry always exists.
  return candidates.find((candidate) => candidate.width >= target) ?? candidates[candidates.length - 1]!
}

/** `alt` as the accepted accessibility model states it: the description, or empty. */
export function publicImageAlt(altText: unknown): string {
  if (typeof altText !== 'string') return ''
  const trimmed = altText.trim()
  return trimmed.length === 0 ? '' : trimmed
}

/**
 * The public model of one `images` row, or `null` when the row cannot be rendered
 * safely: a storage path the trusted upload flow could not have minted, or a
 * derivative record that does not have the validated shape. Both are refusals to
 * guess — never a fallback to the original, never a hand-built path.
 */
export function buildPublicImage(
  origin: string,
  row: {
    readonly storage_path: unknown
    readonly alt_text: unknown
    readonly derivatives: unknown
  },
): PublicImage | null {
  if (!isOriginalStoragePath(row.storage_path)) return null

  const record: DerivativeRecord | null = readDerivativeRecord(row.derivatives)
  if (record === null) return null

  const uploadId = uploadIdOfStoragePath(row.storage_path)

  const candidates: PublicImageCandidate[] = [...record.widths]
    .sort((left, right) => left.width - right.width)
    .map((size) => ({
      width: size.width,
      height: size.height,
      avifUrl: derivativePublicUrl(origin, derivativePath(uploadId, size.width, 'avif')),
      webpUrl: derivativePublicUrl(origin, derivativePath(uploadId, size.width, 'webp')),
    }))

  const largest = candidates[candidates.length - 1]!

  return {
    alt: publicImageAlt(row.alt_text),
    width: largest.width,
    height: largest.height,
    src: candidateAtLeast(candidates, FALLBACK_TARGET_WIDTH).webpUrl,
    avifSrcSet: candidates.map((candidate) => `${candidate.avifUrl} ${candidate.width}w`).join(', '),
    webpSrcSet: candidates.map((candidate) => `${candidate.webpUrl} ${candidate.width}w`).join(', '),
    candidates,
  }
}

/** The one derivative the article's Open Graph image and JSON-LD `image` both name. */
export type SeoImage = {
  readonly url: string
  readonly width: number
  readonly height: number
  readonly alt: string
}

/**
 * The same asset every SEO surface refers to (brief §16): WebP — the format the
 * processed ladder guarantees and the one crawlers read; AVIF is offered only to
 * browsers through `<picture>`. No JPEG exists by design (§0t), and the private
 * original is not an option. Recorded for the final SEO pass to re-weigh.
 */
export function seoImageOf(image: PublicImage): SeoImage {
  const candidate = candidateAtLeast(image.candidates, SEO_TARGET_WIDTH)
  return { url: candidate.webpUrl, width: candidate.width, height: candidate.height, alt: image.alt }
}

/**
 * `sizes` per approved surface — the slot geometry the frames draw, stated once
 * (brief §7). Each string is the rendered width of that slot at each breakpoint,
 * from the same Tailwind classes the component carries, so the browser picks the
 * smallest rung that covers the box rather than the widest it can find.
 *
 * Widths, from the design tokens (`app/globals.css`): the content measure is 80rem
 * with 2.5rem side padding from `md`, 1rem gutters below it; the breakpoints are
 * `md` 48rem, `lg` 64rem, `xl` 90rem.
 */
export const IMAGE_SIZES = {
  /** 1h/1m dish card and the menu's Månedens burger card: 6rem thumbnail, 9.375rem from `md`. */
  dishCard: '(min-width: 48rem) 9.375rem, 6rem',
  /** 1g/1l featured burger: a 6rem thumbnail beside the text, one of three grid columns from `md`. */
  featuredDish:
    '(min-width: 90rem) 24.25rem, (min-width: 48rem) calc((100vw - 7.5rem) / 3), 6rem',
  /** 1h/1m/1af Ugens ret: full card width on a phone, a 12.5rem column from `md`. */
  weeklyCard: '(min-width: 48rem) 12.5rem, calc(100vw - 2rem)',
  /** The Forside's Månedens burger feature (§0d): full width, 17.5rem from `md`, 21.25rem from `lg`. */
  monthlyFeature: '(min-width: 64rem) 21.25rem, (min-width: 48rem) 17.5rem, calc(100vw - 2rem)',
  /** 1j/1n news card: full card width inside its padding, a 16.25rem column from `md`. */
  newsCard: '(min-width: 48rem) 16.25rem, calc(100vw - 3.75rem)',
  /** 1g/1l Forside teaser: full card width on a phone, an 8.125rem thumbnail from `md`. */
  newsTeaser: '(min-width: 48rem) 8.125rem, calc(100vw - 3.75rem)',
  /** §7f article: the 62ch measure, roughly 34rem, and the gutters below `md`. */
  newsArticle: '(min-width: 48rem) 34rem, calc(100vw - 2rem)',
  /**
   * 1g/1l hero (phase 11A): full width above the text on a phone; from `md` the
   * photograph is the second of two equal flex columns of the 80rem measure, and
   * from `lg` the slightly larger one (`flex-[1.05]`).
   */
  homeHero: '(min-width: 90rem) 41rem, (min-width: 48rem) 51vw, 100vw',
  /** 1g/1l award band (phase 11A): full width on a phone, a 13.75rem column from `md`. */
  homeAward: '(min-width: 48rem) 13.75rem, calc(100vw - 2rem)',
  /** 1g/1l "Om os" excerpt (phase 11A): full width on a phone, a 9.375rem thumbnail from `md`. */
  homeTeam: '(min-width: 48rem) 9.375rem, calc(100vw - 2rem)',
  /**
   * 1ai's Mad ud af huset photograph (phase 11B): full width inside the gutters on a
   * phone; from `md` the second of two flex columns of the page container, the text
   * column slightly wider from `lg` (`flex-[1.1]`), so just under half the measure.
   */
  takeawayHero: '(min-width: 90rem) 36rem, (min-width: 48rem) 46vw, calc(100vw - 2rem)',
  /**
   * 1i's three Om os frames (phase 14B1). The facade ("Stedet", 4:5) is full width on a
   * phone and a column capped at 26rem beside the story from `md`; the team photo (16:7)
   * is the whole content measure at every width; the kitchen (3:2) is the first of two
   * flex columns beside the method, the text column slightly wider from `lg`.
   */
  aboutVenue: '(min-width: 64rem) 26rem, (min-width: 48rem) 46vw, calc(100vw - 2rem)',
  aboutTeam: '(min-width: 90rem) 75rem, (min-width: 48rem) calc(100vw - 5rem), calc(100vw - 2rem)',
  aboutKitchen: '(min-width: 90rem) 36rem, (min-width: 48rem) 46vw, calc(100vw - 2rem)',
} as const

export type ImageSizesPreset = keyof typeof IMAGE_SIZES
