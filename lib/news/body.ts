import type { NewsBody, NewsParagraph } from '@/lib/content/types'
import { newsBodySchema } from '@/lib/schemas/news'

/**
 * The article body, between the editor and the database — technical plan §4, §7f.
 *
 * `news.body` is structured JSON — paragraph nodes carrying spans — and never HTML
 * (§8). The editor speaks two dialects of it, and this module is both mappings:
 *
 *   * **Plain text** (`bodyFromEditorText` / `bodyToEditorText`) — the 9A textarea's
 *     format, kept as the no-JavaScript fallback for a body that carries no mark: a
 *     blank line separates paragraphs, and that is the whole of it.
 *   * **The structured document itself** (`bodyFromStructuredJson`) — what 9B's B/Link
 *     editor submits: the stored shape, serialised as JSON in a hidden field, re-parsed
 *     here against the same strict schema every other write goes through. Nothing is
 *     invented on the way in — a malformed document, an unknown key or a link that is
 *     not an absolute `https:` address is a refusal (§8), never a repair.
 *
 * `hasMarks` is the boundary between the two: a body with a bold or linked span has
 * no faithful plain-text form, so the textarea fallback is offered only to a body
 * without one — the protection 9A reserved the flag for.
 *
 * Pure: no database, no React; the one import beyond the shared types is the body's
 * own Zod schema, so the editor and a forged POST are refused by the same sentence.
 */

/** What the stored body looks like to the one control that edits it. */
export type NewsBodyEditorText = {
  /** Paragraph texts joined by one blank line — the textarea's value. */
  readonly text: string
  /** True when any span carries bold or a link, which the 9A textarea cannot show. */
  readonly hasMarks: boolean
}

/**
 * The textarea's value as a stored body, or `null` when nothing remains.
 *
 * A paragraph is a run of non-blank lines; line breaks *inside* a paragraph are
 * preserved as spaces, because the public renderer draws paragraphs, not line breaks.
 * Whitespace-only input produces `null`, which the form reports as "Skriv teksten"
 * rather than storing an article with nothing to say.
 */
export function bodyFromEditorText(text: string): NewsBody | null {
  const blocks: NewsParagraph[] = text
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => ({ type: 'paragraph' as const, spans: [{ text: paragraph }] }))

  return blocks.length > 0 ? { blocks } : null
}

/** A stored body as the textarea shows it. The inverse of `bodyFromEditorText` for
 *  every body this editor can produce — asserted in the unit suite. */
export function bodyToEditorText(body: NewsBody): NewsBodyEditorText {
  const paragraphs = body.blocks.map((block) =>
    block.spans.map((span) => span.text).join(''),
  )

  return { text: paragraphs.join('\n\n'), hasMarks: bodyHasMarks(body) }
}

/** True when any span carries bold or a link — a body the textarea cannot show. */
export function bodyHasMarks(body: NewsBody): boolean {
  return body.blocks.some((block) =>
    block.spans.some((span) => span.bold === true || span.href !== undefined),
  )
}

export type StructuredBodyResult =
  /** The document, with whitespace-only paragraphs dropped. */
  | { readonly ok: true; readonly body: NewsBody }
  /** Not this schema's document at all — refused whole, never repaired (§8). */
  | { readonly ok: false; readonly reason: 'malformed' }
  /** A well-formed document with nothing to say — the "Skriv teksten" case. */
  | { readonly ok: false; readonly reason: 'empty' }

/**
 * The structured editor's submitted document, or the refusal it earned.
 *
 * The JSON is parsed and then held to `newsBodySchema` — the same strict shape the
 * write layer re-parses (§5's two layers): paragraph nodes only, spans of text with
 * at most `bold` and an absolute-`https:` `href`, unknown keys refused. Whitespace-only
 * paragraphs are dropped the way the textarea path drops blank lines; a document with
 * nothing left is `empty`, so both dialects refuse a bodyless article with one sentence.
 */
export function bodyFromStructuredJson(raw: string): StructuredBodyResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const document = newsBodySchema.safeParse(parsed)
  if (!document.success) return { ok: false, reason: 'malformed' }

  const blocks = document.data.blocks.filter(
    (block) => block.spans.map((span) => span.text).join('').trim().length > 0,
  )

  return blocks.length > 0
    ? { ok: true, body: { blocks } }
    : { ok: false, reason: 'empty' }
}
