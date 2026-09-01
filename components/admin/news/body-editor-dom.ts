import type {
  EditorPosition,
  EditorRange,
  NewsBody,
  NewsParagraph,
  NewsSpan,
} from '@/lib/news/editor-model'

/**
 * The DOM half of the body editor — design 1s / 1z; phase 9B.
 *
 * `NewsBodyField` edits a `contenteditable` surface, and this module is the whole of
 * the translation between that surface and the structured model
 * (`lib/news/editor-model.ts` owns every rule; this file owns no decision about what
 * a mark means):
 *
 *   * **render** — the model drawn as `<p>` and `<span>` elements. A mark is a
 *     `data-` attribute plus a class; a link is deliberately **not** an `<a>` inside
 *     the editor, because a link that navigates is not a link being edited.
 *   * **read** — the DOM walked back into the model. Only text and this module's own
 *     `data-` attributes are read: pasted or dropped markup contributes its
 *     *characters* and nothing else, so no HTML can enter the model through the
 *     editor (§8, and the phase brief's "no rich paste").
 *   * **selection** — the browser's `Selection` mapped to block/character offsets and
 *     back, through the same walk, so the two cannot disagree about where a
 *     character is.
 *
 * The mapping is deliberately **one-to-one**: every character in the DOM is one
 * character in the model (a `<br>` counts as a newline), and nothing is cleaned or
 * collapsed here — `tidyBodyForSave` (pure, unit-pinned) does that once, at the
 * moment the document is serialised for a save. That is what keeps selection offsets
 * and model offsets the same number.
 */

/** The classes a mark is drawn with, inside the editor only. */
const BOLD_CLASS = 'font-semibold'
const LINK_CLASS = 'text-brand-700 underline'

// ---------------------------------------------------------------------------
// Rendering the model into the editable surface
// ---------------------------------------------------------------------------

export function renderBodyInto(root: HTMLElement, body: NewsBody): void {
  const document = root.ownerDocument

  root.replaceChildren()

  for (const block of body.blocks) {
    const paragraph = document.createElement('p')
    const text = block.spans.map((span) => span.text).join('')

    if (text.length === 0) {
      // An empty paragraph needs a <br> to have height and hold the caret.
      paragraph.appendChild(document.createElement('br'))
    } else {
      for (const span of block.spans) {
        if (span.text.length === 0) continue
        paragraph.appendChild(renderSpan(document, span))
      }
    }

    root.appendChild(paragraph)
  }

  if (root.childNodes.length === 0) {
    const paragraph = document.createElement('p')
    paragraph.appendChild(document.createElement('br'))
    root.appendChild(paragraph)
  }
}

function renderSpan(document: Document, span: NewsSpan): HTMLElement {
  const element = document.createElement('span')
  element.textContent = span.text

  const classes: string[] = []
  if (span.bold === true) {
    element.dataset.bold = '1'
    classes.push(BOLD_CLASS)
  }
  if (span.href !== undefined) {
    element.dataset.href = span.href
    classes.push(LINK_CLASS)
  }
  if (classes.length > 0) element.className = classes.join(' ')

  return element
}

// ---------------------------------------------------------------------------
// One walk, three consumers
// ---------------------------------------------------------------------------

type Segment = {
  /** The text node (or `<br>`) this stretch of characters lives in. */
  readonly node: Node
  /** Character offset of the stretch inside its block's text. */
  readonly start: number
  readonly length: number
  readonly bold: boolean
  readonly href: string | null
  readonly isBreak: boolean
}

type WalkedBlock = {
  /** The block element, or null for stray inline content adopted as a block. */
  readonly element: Element | null
  readonly segments: Segment[]
  readonly text: string
}

function isBlockElement(node: Node): node is Element {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const tag = (node as Element).tagName
  return tag === 'P' || tag === 'DIV'
}

function marksOf(node: Node, root: HTMLElement): { bold: boolean; href: string | null } {
  let bold = false
  let href: string | null = null

  for (
    let current = node.parentElement;
    current !== null && current !== root;
    current = current.parentElement
  ) {
    if (current.dataset.bold === '1') bold = true
    if (href === null && current.dataset.href !== undefined) href = current.dataset.href
  }

  return { bold, href }
}

/**
 * Every block of the editable surface, with its characters located. Stray inline
 * nodes at the root (which typing into an emptied surface can produce) are grouped
 * as blocks of their own, so nothing a browser does makes content unreadable.
 */
function walkBlocks(root: HTMLElement): WalkedBlock[] {
  const blocks: WalkedBlock[] = []
  let stray: { segments: Segment[]; text: string } | null = null

  const flushStray = () => {
    if (stray !== null && stray.text.length > 0) {
      blocks.push({ element: null, segments: stray.segments, text: stray.text })
    }
    stray = null
  }

  const collect = (container: Node, into: { segments: Segment[]; text: string }) => {
    for (const child of Array.from(container.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? ''
        if (text.length === 0) continue
        const marks = marksOf(child, root)
        into.segments.push({
          node: child,
          start: into.text.length,
          length: text.length,
          bold: marks.bold,
          href: marks.href,
          isBreak: false,
        })
        into.text += text
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if ((child as Element).tagName === 'BR') {
          const marks = marksOf(child, root)
          into.segments.push({
            node: child,
            start: into.text.length,
            length: 1,
            bold: marks.bold,
            href: marks.href,
            isBreak: true,
          })
          into.text += '\n'
        } else {
          collect(child, into)
        }
      }
    }
  }

  for (const child of Array.from(root.childNodes)) {
    if (isBlockElement(child)) {
      flushStray()
      const into = { segments: [] as Segment[], text: '' }
      collect(child, into)
      blocks.push({ element: child, segments: into.segments, text: into.text })
    } else {
      stray ??= { segments: [], text: '' }
      collect(child, stray)
    }
  }
  flushStray()

  return blocks.length > 0
    ? blocks
    : [{ element: null, segments: [], text: '' }]
}

// ---------------------------------------------------------------------------
// Reading the model back
// ---------------------------------------------------------------------------

/** The editable surface as the structured model, one character to one character. */
export function readBodyFrom(root: HTMLElement): NewsBody {
  const blocks: NewsParagraph[] = walkBlocks(root).map((block) => {
    const spans: NewsSpan[] = []

    for (const segment of block.segments) {
      const text = segment.isBreak ? '\n' : (segment.node.textContent ?? '')
      if (text.length === 0) continue

      const previous = spans[spans.length - 1]
      if (
        previous !== undefined &&
        (previous.bold === true) === segment.bold &&
        (previous.href ?? null) === segment.href
      ) {
        previous.text += text
      } else {
        const span: NewsSpan = { text }
        if (segment.bold) span.bold = true
        if (segment.href !== null) span.href = segment.href
        spans.push(span)
      }
    }

    return { type: 'paragraph', spans: spans.length > 0 ? spans : [{ text: '' }] }
  })

  return { blocks }
}

// ---------------------------------------------------------------------------
// Selection, both ways
// ---------------------------------------------------------------------------

function positionOfPoint(
  blocks: WalkedBlock[],
  node: Node,
  offset: number,
  root: HTMLElement,
): EditorPosition | null {
  // A point inside (or at) a text node: find its segment.
  for (const [index, block] of blocks.entries()) {
    for (const segment of block.segments) {
      if (segment.node === node) {
        return { block: index, offset: segment.start + Math.min(offset, segment.length) }
      }
    }
  }

  // A point given as (element, childIndex): resolve to the nearest character —
  // the start of the child's first segment, or the end of the block.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element
    const blockIndex = blocks.findIndex(
      (block) => block.element === element || block.element?.contains(element) === true,
    )
    const container = element === root ? null : element

    if (container === null) {
      // The root itself: childIndex counts blocks.
      const index = Math.min(offset, blocks.length - 1)
      const before = offset >= blocks.length
      const block = blocks[index]
      return block === undefined
        ? null
        : { block: index, offset: before ? block.text.length : 0 }
    }

    if (blockIndex >= 0) {
      const block = blocks[blockIndex]!
      const child = container.childNodes[offset] ?? null

      if (child !== null) {
        const segment = block.segments.find(
          (candidate) => candidate.node === child || child.contains(candidate.node),
        )
        if (segment !== undefined) return { block: blockIndex, offset: segment.start }
      }

      return { block: blockIndex, offset: block.text.length }
    }
  }

  return null
}

/** The browser's selection as model offsets, or null when it is outside the editor. */
export function selectionRangeIn(root: HTMLElement): EditorRange | null {
  const selection = root.ownerDocument.defaultView?.getSelection() ?? null
  if (selection === null || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null

  const blocks = walkBlocks(root)
  const start = positionOfPoint(blocks, range.startContainer, range.startOffset, root)
  const end = positionOfPoint(blocks, range.endContainer, range.endOffset, root)

  if (start === null || end === null) return null
  return { start, end }
}

function domPointFor(
  blocks: WalkedBlock[],
  position: EditorPosition,
  root: HTMLElement,
): { node: Node; offset: number } {
  const block = blocks[Math.min(position.block, blocks.length - 1)]
  if (block === undefined) return { node: root, offset: 0 }

  for (const segment of block.segments) {
    if (position.offset <= segment.start + segment.length) {
      if (segment.isBreak) {
        // Before or after the <br>, in its parent.
        const parent = segment.node.parentNode ?? block.element ?? root
        const index = Array.from(parent.childNodes).indexOf(segment.node as ChildNode)
        return {
          node: parent,
          offset: position.offset > segment.start ? index + 1 : index,
        }
      }
      return {
        node: segment.node,
        offset: Math.max(0, Math.min(position.offset - segment.start, segment.length)),
      }
    }
  }

  // An empty block, or an offset past the end.
  const container = block.element ?? root
  return { node: container, offset: container.childNodes.length }
}

/** Put the browser's selection at the given model offsets. */
export function setSelectionRange(root: HTMLElement, range: EditorRange): void {
  const view = root.ownerDocument.defaultView
  const selection = view?.getSelection() ?? null
  if (selection === null) return

  const blocks = walkBlocks(root)
  const start = domPointFor(blocks, range.start, root)
  const end = domPointFor(blocks, range.end, root)

  const domRange = root.ownerDocument.createRange()
  domRange.setStart(start.node, start.offset)
  domRange.setEnd(end.node, end.offset)

  selection.removeAllRanges()
  selection.addRange(domRange)
}
