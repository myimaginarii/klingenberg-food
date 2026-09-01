import type { NewsBody, NewsParagraph } from '@/lib/content/types'

/**
 * The article body, between the editor and the database — technical plan §4, §7f.
 *
 * `news.body` is structured JSON — paragraph nodes carrying spans — and never HTML
 * (§8). Phase 9A's editor is one `<textarea>`: a blank line separates paragraphs, and
 * that is the whole of the format, stated here in both directions so the mapping is a
 * pure function a unit test can hold still.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * The approved editor offers exactly **B and Link** (§7f, frame 1s), and those marks
 * are span properties the public renderer (`NewsBody.tsx`) already draws. The 9A
 * textarea can neither show nor produce them — the B/Link toolbar is a client
 * component and belongs to phase 9B together with the autosave it shares a component
 * with. Until then no row can carry a mark: the seed writes plain paragraphs and this
 * editor writes plain paragraphs. `bodyToEditorText` still reports `hasMarks`, so the
 * day 9B exists, an editor that would silently flatten a marked-up body has a fact to
 * check instead of an accident to have.
 *
 * Pure: no database, no React, no imports beyond the shared body types.
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

  const hasMarks = body.blocks.some((block) =>
    block.spans.some((span) => span.bold === true || span.href !== undefined),
  )

  return { text: paragraphs.join('\n\n'), hasMarks }
}
