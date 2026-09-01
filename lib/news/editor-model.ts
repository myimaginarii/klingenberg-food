import type { NewsBody, NewsParagraph, NewsSpan } from '@/lib/content/types'

/**
 * Re-exported for the client components (`NewsBodyField`, `body-editor-dom`): the
 * policy suite forbids a client component from importing `@/lib/content/*` — the
 * read layer — and the body's *type* is this module's own vocabulary anyway.
 */
export type { NewsBody, NewsParagraph, NewsSpan }

/**
 * The body editor's rules — design 1s / 1z ("B" and "Link"), technical plan §7f;
 * phase 9B.
 *
 * The editor offers exactly two marks, and this module is what they *mean*: a
 * selection over the stored structured body (`NewsBody` — the §4 shape, never HTML),
 * and the four operations frame 1s draws. The browser half
 * (`components/admin/news/body-editor-dom.ts`) only translates between the DOM and
 * these calls; every decision about what a mark does to the document is here, where
 * the unit suite can hold it still.
 *
 * THE SELECTION MODEL
 *
 * A position is a block index and a character offset into that block's concatenated
 * text — span boundaries are an artefact of storage, not of meaning, so a position
 * never names a span. A range is two positions; every operation clamps it to the
 * document before using it, so a stale selection can produce a no-op but never a
 * corrupt body.
 *
 * THE FOUR RULES, STATED ONCE
 *
 *   * **Toggle bold** — if every character in the selection is bold, the selection
 *     stops being bold; otherwise all of it becomes bold. An empty selection changes
 *     nothing (frame 1s has no "typing mode" toggle, and §5 of the phase brief says an
 *     empty selection must not corrupt the body).
 *   * **Set link** — the selection carries the one `https:` address, replacing any it
 *     had. Bold survives: the two marks are independent span properties.
 *   * **Clear link** — the selection stops linking. The caller widens a caret to
 *     `linkExtentAt` first, so "fjern link" with the caret inside a link takes the
 *     whole link away rather than splitting it.
 *   * **Normalise** — adjacent spans with identical marks merge and empty spans
 *     disappear, so applying and removing a mark round-trips to the exact stored
 *     document it started from.
 *
 * Pure: no DOM, no React, no imports beyond the shared body types.
 */

/** A place in the body: a block, and a character offset into its joined text. */
export type EditorPosition = {
  readonly block: number
  readonly offset: number
}

/** A selection. `start` and `end` are already ordered by the caller. */
export type EditorRange = {
  readonly start: EditorPosition
  readonly end: EditorPosition
}

/** What one selection carries, for the toolbar's pressed state and the link panel. */
export type SelectionMarks = {
  /** True when every character in the range is bold — the B control shows pressed. */
  readonly bold: boolean
  /** The one address the whole range links to, or null when it does not. */
  readonly href: string | null
  /** True when any character in the range links anywhere — offers "Fjern link". */
  readonly hasLink: boolean
}

const EMPTY_SPAN: NewsSpan = { text: '' }

/** A block's text as the editor measures offsets against it. */
export function blockTextOf(block: NewsParagraph): string {
  return block.spans.map((span) => span.text).join('')
}

function clampPosition(body: NewsBody, position: EditorPosition): EditorPosition {
  if (body.blocks.length === 0) return { block: 0, offset: 0 }

  const block = Math.max(0, Math.min(position.block, body.blocks.length - 1))
  const length = blockTextOf(body.blocks[block]!).length
  const offset = Math.max(0, Math.min(position.offset, length))

  return { block, offset }
}

function isBefore(a: EditorPosition, b: EditorPosition): boolean {
  return a.block < b.block || (a.block === b.block && a.offset < b.offset)
}

/** The range clamped into the document, ends ordered. */
export function clampRange(body: NewsBody, range: EditorRange): EditorRange {
  const a = clampPosition(body, range.start)
  const b = clampPosition(body, range.end)

  return isBefore(b, a) ? { start: b, end: a } : { start: a, end: b }
}

function isCollapsed(range: EditorRange): boolean {
  return range.start.block === range.end.block && range.start.offset === range.end.offset
}

function sameMarks(a: NewsSpan, b: NewsSpan): boolean {
  return (a.bold === true) === (b.bold === true) && (a.href ?? null) === (b.href ?? null)
}

function withText(span: NewsSpan, text: string): NewsSpan {
  const next: NewsSpan = { text }
  if (span.bold === true) next.bold = true
  if (span.href !== undefined) next.href = span.href
  return next
}

/**
 * Merge adjacent spans with identical marks and drop empty ones, so every operation
 * lands on the same canonical document a fresh read would produce. A block with no
 * text keeps one empty span, because the block itself is still being written.
 */
export function normalizeBody(body: NewsBody): NewsBody {
  const blocks = body.blocks.map((block): NewsParagraph => {
    const spans: NewsSpan[] = []

    for (const span of block.spans) {
      if (span.text.length === 0) continue

      const previous = spans[spans.length - 1]
      if (previous !== undefined && sameMarks(previous, span)) {
        spans[spans.length - 1] = withText(previous, previous.text + span.text)
      } else {
        spans.push(withText(span, span.text))
      }
    }

    return { type: 'paragraph', spans: spans.length > 0 ? spans : [EMPTY_SPAN] }
  })

  return { blocks: blocks.length > 0 ? blocks : [{ type: 'paragraph', spans: [EMPTY_SPAN] }] }
}

/**
 * The local character interval `[from, to)` of `range` inside block `index`, or null
 * when the range does not touch the block.
 */
function localInterval(
  block: NewsParagraph,
  index: number,
  range: EditorRange,
): { from: number; to: number } | null {
  if (index < range.start.block || index > range.end.block) return null

  const length = blockTextOf(block).length
  const from = index === range.start.block ? range.start.offset : 0
  const to = index === range.end.block ? range.end.offset : length

  return from < to ? { from, to } : null
}

/**
 * Rewrite every span-part inside `range` with `change`, splitting spans at the range
 * ends. The workhorse behind both marks; the result is normalised.
 */
function mapRange(
  body: NewsBody,
  range: EditorRange,
  change: (span: NewsSpan) => NewsSpan,
): NewsBody {
  const blocks = body.blocks.map((block, index): NewsParagraph => {
    const interval = localInterval(block, index, range)
    if (interval === null) return block

    const spans: NewsSpan[] = []
    let cursor = 0

    for (const span of block.spans) {
      const spanFrom = cursor
      const spanTo = cursor + span.text.length
      cursor = spanTo

      const from = Math.max(spanFrom, interval.from)
      const to = Math.min(spanTo, interval.to)

      if (from >= to) {
        spans.push(span)
        continue
      }

      const before = span.text.slice(0, from - spanFrom)
      const inside = span.text.slice(from - spanFrom, to - spanFrom)
      const after = span.text.slice(to - spanFrom)

      if (before.length > 0) spans.push(withText(span, before))
      spans.push(change(withText(span, inside)))
      if (after.length > 0) spans.push(withText(span, after))
    }

    return { type: 'paragraph', spans }
  })

  return normalizeBody({ blocks })
}

/** Every span-part the range covers, for questions rather than changes. */
function partsIn(body: NewsBody, range: EditorRange): NewsSpan[] {
  const parts: NewsSpan[] = []

  body.blocks.forEach((block, index) => {
    const interval = localInterval(block, index, range)
    if (interval === null) return

    let cursor = 0
    for (const span of block.spans) {
      const spanFrom = cursor
      const spanTo = cursor + span.text.length
      cursor = spanTo

      const from = Math.max(spanFrom, interval.from)
      const to = Math.min(spanTo, interval.to)

      if (from < to) parts.push(withText(span, span.text.slice(from - spanFrom, to - spanFrom)))
    }
  })

  return parts
}

/** What the selection carries — the toolbar's pressed state and the link panel's prefill. */
export function marksIn(body: NewsBody, rawRange: EditorRange): SelectionMarks {
  const range = clampRange(body, rawRange)
  const parts = partsIn(body, range)

  if (parts.length === 0) {
    // A caret: answer for the character it sits inside, via the link extent, so the
    // toolbar can offer "Fjern link" when the caret is in one.
    const extent = linkExtentAt(body, range.start)
    return {
      bold: false,
      href: extent?.href ?? null,
      hasLink: extent !== null,
    }
  }

  const bold = parts.every((part) => part.bold === true)
  const hrefs = new Set(parts.map((part) => part.href ?? null))
  const hasLink = parts.some((part) => part.href !== undefined)
  const href = hrefs.size === 1 ? [...hrefs][0]! : null

  return { bold, href, hasLink }
}

/** B — all bold becomes plain, anything else becomes bold. Empty selection: no change. */
export function toggleBold(body: NewsBody, rawRange: EditorRange): NewsBody {
  const range = clampRange(body, rawRange)
  if (isCollapsed(range)) return body

  const allBold = partsIn(body, range).every((part) => part.bold === true)

  return mapRange(body, range, (span) => {
    const next: NewsSpan = { text: span.text }
    if (!allBold) next.bold = true
    if (span.href !== undefined) next.href = span.href
    return next
  })
}

/** Link — the selection carries `href`, replacing any address it had. Bold survives. */
export function setLink(body: NewsBody, rawRange: EditorRange, href: string): NewsBody {
  const range = clampRange(body, rawRange)
  if (isCollapsed(range)) return body

  return mapRange(body, range, (span) => {
    const next: NewsSpan = { text: span.text, href }
    if (span.bold === true) next.bold = true
    return next
  })
}

/** Fjern link — the selection stops linking anywhere. Bold survives. */
export function clearLink(body: NewsBody, rawRange: EditorRange): NewsBody {
  const range = clampRange(body, rawRange)
  if (isCollapsed(range)) return body

  return mapRange(body, range, (span) => {
    const next: NewsSpan = { text: span.text }
    if (span.bold === true) next.bold = true
    return next
  })
}

/**
 * The whole contiguous link around `position`, or null when the character there does
 * not link. This is what turns a caret inside a link into "edit or remove *this*
 * link" rather than an operation on nothing.
 */
export function linkExtentAt(
  body: NewsBody,
  rawPosition: EditorPosition,
): { readonly range: EditorRange; readonly href: string } | null {
  const emptyRange = { start: rawPosition, end: rawPosition }
  const position = clampRange(body, emptyRange).start
  const block = body.blocks[position.block]
  if (block === undefined) return null

  // The marked regions of the block, as [from, to, href) runs.
  const runs: { from: number; to: number; href: string }[] = []
  let cursor = 0

  for (const span of block.spans) {
    const from = cursor
    const to = cursor + span.text.length
    cursor = to

    if (span.href === undefined) continue

    const previous = runs[runs.length - 1]
    if (previous !== undefined && previous.to === from && previous.href === span.href) {
      previous.to = to
    } else {
      runs.push({ from, to, href: span.href })
    }
  }

  // A caret at either edge of a link counts as inside it — that is where a person
  // lands after pressing the link, and "Fjern link" must mean this one.
  const run = runs.find((candidate) => position.offset >= candidate.from && position.offset <= candidate.to)
  if (run === undefined) return null

  return {
    range: {
      start: { block: position.block, offset: run.from },
      end: { block: position.block, offset: run.to },
    },
    href: run.href,
  }
}

// ---------------------------------------------------------------------------
// Serialising for a save
// ---------------------------------------------------------------------------

const BLANK_LINE = /\n[ \t]*\n+/

/** The spans covering `[from, to)` of one block, marks intact. */
function sliceBlock(block: NewsParagraph, from: number, to: number): NewsSpan[] {
  const spans: NewsSpan[] = []
  let cursor = 0

  for (const span of block.spans) {
    const spanFrom = cursor
    const spanTo = cursor + span.text.length
    cursor = spanTo

    const sliceFrom = Math.max(spanFrom, from)
    const sliceTo = Math.min(spanTo, to)
    if (sliceFrom < sliceTo) {
      spans.push(withText(span, span.text.slice(sliceFrom - spanFrom, sliceTo - spanFrom)))
    }
  }

  return spans
}

/**
 * The editing model as a document worth storing, or null when nothing remains.
 *
 * The editor's model is one-to-one with the editable surface, so it may carry what a
 * surface carries: soft line breaks, blank paragraphs, pasted text with blank lines
 * still inside one block. This is the one cleanup, applied at the moment of saving
 * and nowhere else — the textarea dialect's own rules, restated for a document with
 * marks:
 *
 *   * a blank line splits a paragraph, wherever it sits — marks survive on both sides;
 *   * a remaining line break inside a paragraph becomes a space, because the public
 *     renderer draws paragraphs, not line breaks (`NewsBody.tsx`);
 *   * paragraph edges are trimmed, and a paragraph with nothing to say disappears.
 *
 * Nothing else is touched: no mark is added, none is removed, and inner spacing is
 * the writer's own.
 */
export function tidyBodyForSave(body: NewsBody): NewsBody | null {
  const blocks: NewsParagraph[] = []

  for (const block of body.blocks) {
    const text = blockTextOf(block)

    // The paragraph pieces of this block, as [from, to) intervals around blank lines.
    const pieces: { from: number; to: number }[] = []
    let from = 0
    for (const match of text.matchAll(new RegExp(BLANK_LINE, 'g'))) {
      pieces.push({ from, to: match.index })
      from = match.index + match[0].length
    }
    pieces.push({ from, to: text.length })

    for (const piece of pieces) {
      const spans = sliceBlock(block, piece.from, piece.to)
        .map((span) => withText(span, span.text.replace(/[\n\t]/g, ' ')))

      // Trim the paragraph's edges — across spans, so a leading space in the second
      // span of an otherwise empty first span still goes.
      while (spans.length > 0) {
        const first = spans[0]!
        const trimmed = first.text.replace(/^\s+/, '')
        if (trimmed.length > 0) {
          spans[0] = withText(first, trimmed)
          break
        }
        spans.shift()
      }
      while (spans.length > 0) {
        const last = spans[spans.length - 1]!
        const trimmed = last.text.replace(/\s+$/, '')
        if (trimmed.length > 0) {
          spans[spans.length - 1] = withText(last, trimmed)
          break
        }
        spans.pop()
      }

      if (spans.length > 0) blocks.push({ type: 'paragraph', spans })
    }
  }

  if (blocks.length === 0) return null
  return normalizeBody({ blocks })
}
