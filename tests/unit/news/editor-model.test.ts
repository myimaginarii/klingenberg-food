import { describe, expect, it } from 'vitest'

import type { NewsBody } from '@/lib/content/types'
import {
  clampRange,
  clearLink,
  linkExtentAt,
  marksIn,
  normalizeBody,
  setLink,
  tidyBodyForSave,
  toggleBold,
  type EditorRange,
} from '@/lib/news/editor-model'

/**
 * The B/Link editor's rules — phase 9B, §7f. Every operation the toolbar can perform
 * is held still here as a pure function over the stored body shape, including the
 * two promises the phase brief makes by name: a toggle round-trips to the exact
 * document it started from, and an empty or stale selection can produce a no-op but
 * never a corrupt body.
 */

const HREF = 'https://example.test/menu'

function plain(...paragraphs: string[]): NewsBody {
  return {
    blocks: paragraphs.map((text) => ({ type: 'paragraph', spans: [{ text }] })),
  }
}

function range(
  startBlock: number,
  startOffset: number,
  endBlock: number,
  endOffset: number,
): EditorRange {
  return {
    start: { block: startBlock, offset: startOffset },
    end: { block: endBlock, offset: endOffset },
  }
}

describe('toggleBold', () => {
  it('marks the selection bold, splitting the span at the edges', () => {
    const body = plain('Vi holder lukket i påsken.')

    expect(toggleBold(body, range(0, 3, 0, 9))).toEqual({
      blocks: [
        {
          type: 'paragraph',
          spans: [
            { text: 'Vi ' },
            { text: 'holder', bold: true },
            { text: ' lukket i påsken.' },
          ],
        },
      ],
    })
  })

  it('round-trips: toggling the same selection twice is the identity', () => {
    const body = plain('Første afsnit.', 'Andet afsnit.')
    const selection = range(0, 2, 1, 5)

    expect(toggleBold(toggleBold(body, selection), selection)).toEqual(body)
  })

  it('unbolds only when the whole selection is bold; a mixed selection becomes all bold', () => {
    const mixed: NewsBody = {
      blocks: [
        { type: 'paragraph', spans: [{ text: 'Fed', bold: true }, { text: ' og ikke fed' }] },
      ],
    }

    const all = toggleBold(mixed, range(0, 0, 0, 12))
    expect(all.blocks[0]!.spans).toEqual([{ text: 'Fed og ikke ', bold: true }, { text: 'fed' }])
  })

  it('spans paragraph boundaries', () => {
    const body = plain('En.', 'To.')
    const bolded = toggleBold(body, range(0, 0, 1, 3))

    expect(bolded).toEqual({
      blocks: [
        { type: 'paragraph', spans: [{ text: 'En.', bold: true }] },
        { type: 'paragraph', spans: [{ text: 'To.', bold: true }] },
      ],
    })
  })

  it('keeps a link while bolding it — the two marks are independent', () => {
    const body = setLink(plain('Se menuen her.'), range(0, 3, 0, 9), HREF)
    const both = toggleBold(body, range(0, 3, 0, 9))

    expect(both.blocks[0]!.spans).toEqual([
      { text: 'Se ' },
      { text: 'menuen', bold: true, href: HREF },
      { text: ' her.' },
    ])
  })

  it('does nothing for an empty selection — never a corrupt body', () => {
    const body = plain('Tekst.')
    expect(toggleBold(body, range(0, 3, 0, 3))).toEqual(body)
  })

  it('clamps a stale selection to the document instead of throwing', () => {
    const body = plain('Kort.')
    const result = toggleBold(body, range(0, 2, 7, 99))

    expect(result.blocks[0]!.spans).toEqual([{ text: 'Ko' }, { text: 'rt.', bold: true }])
  })
})

describe('setLink and clearLink', () => {
  it('applies the address to the selection', () => {
    const body = setLink(plain('Se menuen her.'), range(0, 3, 0, 9), HREF)

    expect(body.blocks[0]!.spans).toEqual([
      { text: 'Se ' },
      { text: 'menuen', href: HREF },
      { text: ' her.' },
    ])
  })

  it('replaces an existing address instead of nesting one', () => {
    const first = setLink(plain('Se menuen.'), range(0, 3, 0, 9), HREF)
    const second = setLink(first, range(0, 3, 0, 9), 'https://example.test/nyheder')

    expect(second.blocks[0]!.spans[1]).toEqual({
      text: 'menuen',
      href: 'https://example.test/nyheder',
    })
  })

  it('link → clear round-trips to the original document', () => {
    const body = plain('Se menuen her.')
    const linked = setLink(body, range(0, 3, 0, 9), HREF)

    expect(clearLink(linked, range(0, 3, 0, 9))).toEqual(body)
  })

  it('keeps bold when the link is removed', () => {
    const body: NewsBody = {
      blocks: [{ type: 'paragraph', spans: [{ text: 'menuen', bold: true, href: HREF }] }],
    }

    expect(clearLink(body, range(0, 0, 0, 6)).blocks[0]!.spans).toEqual([
      { text: 'menuen', bold: true },
    ])
  })

  it('does nothing for an empty selection', () => {
    const body = plain('Tekst.')
    expect(setLink(body, range(0, 2, 0, 2), HREF)).toEqual(body)
  })
})

describe('marksIn — the toolbar’s pressed state', () => {
  it('answers bold only when every character is bold', () => {
    const body = toggleBold(plain('Fed tekst her.'), range(0, 0, 0, 3))

    expect(marksIn(body, range(0, 0, 0, 3)).bold).toBe(true)
    expect(marksIn(body, range(0, 0, 0, 8)).bold).toBe(false)
  })

  it('answers the one shared address, and null for a mixed selection', () => {
    const body = setLink(plain('Se menuen her.'), range(0, 3, 0, 9), HREF)

    expect(marksIn(body, range(0, 4, 0, 8))).toEqual({ bold: false, href: HREF, hasLink: true })
    expect(marksIn(body, range(0, 0, 0, 14)).href).toBeNull()
    expect(marksIn(body, range(0, 0, 0, 14)).hasLink).toBe(true)
  })

  it('answers for the link under a caret, so "Fjern link" has a target', () => {
    const body = setLink(plain('Se menuen her.'), range(0, 3, 0, 9), HREF)

    expect(marksIn(body, range(0, 5, 0, 5))).toEqual({ bold: false, href: HREF, hasLink: true })
    expect(marksIn(body, range(0, 1, 0, 1)).hasLink).toBe(false)
  })
})

describe('linkExtentAt', () => {
  it('answers the whole contiguous link around a caret', () => {
    const body = setLink(plain('Se menuen her.'), range(0, 3, 0, 9), HREF)

    expect(linkExtentAt(body, { block: 0, offset: 6 })).toEqual({
      range: range(0, 3, 0, 9),
      href: HREF,
    })
  })

  it('counts both edges of the link as inside it', () => {
    const body = setLink(plain('Se menuen her.'), range(0, 3, 0, 9), HREF)

    expect(linkExtentAt(body, { block: 0, offset: 3 })).not.toBeNull()
    expect(linkExtentAt(body, { block: 0, offset: 9 })).not.toBeNull()
  })

  it('answers null where nothing links', () => {
    expect(linkExtentAt(plain('Ingen links.'), { block: 0, offset: 4 })).toBeNull()
  })
})

describe('normalizeBody', () => {
  it('merges adjacent spans with identical marks and drops empty ones', () => {
    const messy: NewsBody = {
      blocks: [
        {
          type: 'paragraph',
          spans: [{ text: 'En ' }, { text: '' }, { text: 'sætning' }, { text: '.', bold: true }],
        },
      ],
    }

    expect(normalizeBody(messy).blocks[0]!.spans).toEqual([
      { text: 'En sætning' },
      { text: '.', bold: true },
    ])
  })

  it('keeps one empty span for a block still being written', () => {
    expect(normalizeBody({ blocks: [{ type: 'paragraph', spans: [{ text: '' }] }] })).toEqual({
      blocks: [{ type: 'paragraph', spans: [{ text: '' }] }],
    })
  })
})

describe('clampRange', () => {
  it('orders a backwards selection', () => {
    const body = plain('Tekst her.')

    expect(clampRange(body, range(0, 8, 0, 2))).toEqual(range(0, 2, 0, 8))
  })
})

describe('tidyBodyForSave', () => {
  it('is the identity for a clean stored document — the round trip', () => {
    const body: NewsBody = {
      blocks: [
        { type: 'paragraph', spans: [{ text: 'Se ' }, { text: 'menuen', bold: true }] },
        { type: 'paragraph', spans: [{ text: 'Andet afsnit.', href: HREF }] },
      ],
    }

    expect(tidyBodyForSave(body)).toEqual(body)
  })

  it('splits a paragraph at a blank line, keeping marks on both sides', () => {
    const body: NewsBody = {
      blocks: [
        {
          type: 'paragraph',
          spans: [{ text: 'Første', bold: true }, { text: '\n\nAndet' }],
        },
      ],
    }

    expect(tidyBodyForSave(body)).toEqual({
      blocks: [
        { type: 'paragraph', spans: [{ text: 'Første', bold: true }] },
        { type: 'paragraph', spans: [{ text: 'Andet' }] },
      ],
    })
  })

  it('turns a lone line break into a space — the renderer draws paragraphs', () => {
    const body = plain('En linje\nog en til.')

    expect(tidyBodyForSave(body)).toEqual(plain('En linje og en til.'))
  })

  it('trims paragraph edges across span boundaries', () => {
    const body: NewsBody = {
      blocks: [
        { type: 'paragraph', spans: [{ text: '  ' }, { text: ' Fed', bold: true }, { text: ' ' }] },
      ],
    }

    expect(tidyBodyForSave(body)).toEqual({
      blocks: [{ type: 'paragraph', spans: [{ text: 'Fed', bold: true }] }],
    })
  })

  it('drops empty paragraphs, and answers null when nothing remains', () => {
    expect(
      tidyBodyForSave({
        blocks: [
          { type: 'paragraph', spans: [{ text: '  ' }] },
          { type: 'paragraph', spans: [{ text: 'Noget.' }] },
          { type: 'paragraph', spans: [{ text: '' }] },
        ],
      }),
    ).toEqual(plain('Noget.'))

    expect(tidyBodyForSave({ blocks: [{ type: 'paragraph', spans: [{ text: ' \n ' }] }] })).toBeNull()
    expect(tidyBodyForSave({ blocks: [] })).toBeNull()
  })
})
