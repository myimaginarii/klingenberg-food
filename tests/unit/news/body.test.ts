import { describe, expect, it } from 'vitest'

import {
  bodyFromEditorText,
  bodyFromStructuredJson,
  bodyHasMarks,
  bodyToEditorText,
} from '@/lib/news/body'

/**
 * The 9A body format, held still in both directions: a blank line separates
 * paragraphs, the stored shape is the structured JSON §4 describes (never HTML), and
 * the round trip is the identity for everything this editor can produce. The B/Link
 * marks are stored shapes the public renderer already draws — 9B's editor writes
 * them; this one only *reports* them (`hasMarks`), so a future flattening bug is a
 * failing assertion rather than silent data loss.
 */

describe('bodyFromEditorText', () => {
  it('turns blank-line-separated text into paragraph nodes', () => {
    expect(bodyFromEditorText('Første afsnit.\n\nAndet afsnit.')).toEqual({
      blocks: [
        { type: 'paragraph', spans: [{ text: 'Første afsnit.' }] },
        { type: 'paragraph', spans: [{ text: 'Andet afsnit.' }] },
      ],
    })
  })

  it('treats a single newline as a space inside one paragraph', () => {
    expect(bodyFromEditorText('En linje\nog en til.')).toEqual({
      blocks: [{ type: 'paragraph', spans: [{ text: 'En linje og en til.' }] }],
    })
  })

  it('accepts Windows line endings and extra blank lines without inventing paragraphs', () => {
    expect(bodyFromEditorText('Et.\r\n\r\n\r\n\r\nTo.')).toEqual({
      blocks: [
        { type: 'paragraph', spans: [{ text: 'Et.' }] },
        { type: 'paragraph', spans: [{ text: 'To.' }] },
      ],
    })
  })

  it('ignores blank lines that carry only spaces or tabs', () => {
    expect(bodyFromEditorText('Et.\n \t \nTo.')?.blocks).toHaveLength(2)
  })

  it('trims each paragraph and collapses runs of whitespace', () => {
    expect(bodyFromEditorText('  Meget    luft.  ')).toEqual({
      blocks: [{ type: 'paragraph', spans: [{ text: 'Meget luft.' }] }],
    })
  })

  it.each([[''], ['   '], ['\n\n\n'], [' \r\n \r\n ']])(
    'answers null for input with nothing to say: %j',
    (text) => {
      expect(bodyFromEditorText(text)).toBeNull()
    },
  )
})

describe('bodyToEditorText', () => {
  it('is the inverse of bodyFromEditorText for everything this editor can produce', () => {
    const texts = [
      'Ét afsnit.',
      'Første afsnit.\n\nAndet afsnit.',
      'Tre.\n\nSmå.\n\nAfsnit — med tegn: æøå!',
    ]

    for (const text of texts) {
      const body = bodyFromEditorText(text)
      expect(body).not.toBeNull()
      expect(bodyToEditorText(body!)).toEqual({ text, hasMarks: false })
    }
  })

  it('joins a paragraph’s spans into one line of text', () => {
    const body = {
      blocks: [
        { type: 'paragraph' as const, spans: [{ text: 'Se ' }, { text: 'menuen', bold: true }] },
      ],
    }

    expect(bodyToEditorText(body).text).toBe('Se menuen')
  })

  it('reports a bold span, so a flattening save has a fact to check (9B)', () => {
    const body = {
      blocks: [{ type: 'paragraph' as const, spans: [{ text: 'Vigtigt', bold: true }] }],
    }

    expect(bodyToEditorText(body).hasMarks).toBe(true)
  })

  it('reports a link span the same way', () => {
    const body = {
      blocks: [
        {
          type: 'paragraph' as const,
          spans: [{ text: 'menuen', href: 'https://example.test/menu' }],
        },
      ],
    }

    expect(bodyToEditorText(body).hasMarks).toBe(true)
  })

  it('reports plain paragraphs as unmarked', () => {
    const body = bodyFromEditorText('Almindelig tekst.')
    expect(bodyToEditorText(body!).hasMarks).toBe(false)
  })
})

describe('bodyFromStructuredJson — the 9B editor dialect', () => {
  it('accepts the stored document shape, marks and all', () => {
    const document = {
      blocks: [
        {
          type: 'paragraph',
          spans: [
            { text: 'Se ' },
            { text: 'menuen', bold: true },
            { text: ' her', href: 'https://example.test/menu' },
          ],
        },
      ],
    }

    expect(bodyFromStructuredJson(JSON.stringify(document))).toEqual({ ok: true, body: document })
  })

  it('refuses text that is not JSON at all', () => {
    expect(bodyFromStructuredJson('ikke json')).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses a document with an unknown key — strict, never repaired', () => {
    const smuggled = {
      blocks: [{ type: 'paragraph', spans: [{ text: 'Hej', html: '<script>' }] }],
    }

    expect(bodyFromStructuredJson(JSON.stringify(smuggled))).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,x'],
    ['http://example.test/usikker'],
    ['//example.test/protokol-relativ'],
    ['ikke en adresse'],
  ])('refuses a link that is not an absolute https: address: %s', (href) => {
    const document = { blocks: [{ type: 'paragraph', spans: [{ text: 'link', href }] }] }

    expect(bodyFromStructuredJson(JSON.stringify(document))).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('refuses an unknown node type instead of guessing at it', () => {
    const document = { blocks: [{ type: 'heading', spans: [{ text: 'H1' }] }] }

    expect(bodyFromStructuredJson(JSON.stringify(document))).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('drops whitespace-only paragraphs, and calls a document with nothing left empty', () => {
    const padded = {
      blocks: [
        { type: 'paragraph', spans: [{ text: '   ' }] },
        { type: 'paragraph', spans: [{ text: 'Noget.' }] },
      ],
    }

    expect(bodyFromStructuredJson(JSON.stringify(padded))).toEqual({
      ok: true,
      body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Noget.' }] }] },
    })

    const blank = { blocks: [{ type: 'paragraph', spans: [{ text: '  ' }] }] }
    expect(bodyFromStructuredJson(JSON.stringify(blank))).toEqual({ ok: false, reason: 'empty' })
  })
})

describe('bodyHasMarks — the flattening guard, now load-bearing (9B)', () => {
  it('reports bold, links, and their absence', () => {
    expect(bodyHasMarks({ blocks: [{ type: 'paragraph', spans: [{ text: 'ren' }] }] })).toBe(false)
    expect(
      bodyHasMarks({ blocks: [{ type: 'paragraph', spans: [{ text: 'fed', bold: true }] }] }),
    ).toBe(true)
    expect(
      bodyHasMarks({
        blocks: [{ type: 'paragraph', spans: [{ text: 'link', href: 'https://example.test/' }] }],
      }),
    ).toBe(true)
  })
})
