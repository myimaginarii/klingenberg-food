import { ALT_TEXT_ERROR_MESSAGES } from '@/lib/images/library'

/**
 * The image library's form vocabulary — design 1w; phase 10B.
 *
 * The field names the screen's two plain forms use — the alt-text edit and the
 * delete confirmation — read and written in one place, exactly as `article-form.ts`
 * does for the news editor. The vocabulary is deliberately tiny (brief §21): an
 * image id, a version token, a description, and the delete confirmation's one bit.
 * There is **no field for a storage path, a dimension, a MIME type, a derivative
 * or an uploader** — the browser has nothing to say about any of them, so no field
 * exists through which it could try.
 */

export const IMAGES_FORM = {
  imageId: 'billede',
  version: 'version',
  altText: 'beskrivelse',
  /** '1' when the rendered confirmation covered an in-use image (brief §14). */
  confirmed: 'bekraeftet',
} as const

/** The alt-text refusals, and the query parameter that carries them back. */
export const IMAGES_ERROR_FIELD = 'fejl'

export type ImagesErrorCode = 'beskrivelse:for_lang' | 'beskrivelse:ugyldig'

export const IMAGES_ERROR_MESSAGES: Record<ImagesErrorCode, string> = {
  'beskrivelse:for_lang': ALT_TEXT_ERROR_MESSAGES.for_lang,
  'beskrivelse:ugyldig': ALT_TEXT_ERROR_MESSAGES.ugyldig,
}

const ERROR_CODES = Object.keys(IMAGES_ERROR_MESSAGES) as ImagesErrorCode[]

/** Only codes this module defined. Anything else in the URL contributes nothing. */
export function decodeImagesErrors(values: readonly string[]): ImagesErrorCode[] {
  return values.filter((value): value is ImagesErrorCode =>
    (ERROR_CODES as string[]).includes(value),
  )
}

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/** What the alt-text form submitted — read, not yet trusted. */
export function readAltTextForm(source: FormData | URLSearchParams): { altText: string } {
  return { altText: text(source, IMAGES_FORM.altText) }
}

/** The query string a refused alt save comes back with: the code, and the text. */
export function encodeAltTextEcho(
  altText: string,
  errors: readonly ImagesErrorCode[],
): URLSearchParams {
  const parameters = new URLSearchParams()
  for (const code of errors) parameters.append(IMAGES_ERROR_FIELD, code)
  parameters.set(IMAGES_FORM.altText, altText)
  return parameters
}
