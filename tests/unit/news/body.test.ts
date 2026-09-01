import { describe, expect, it } from 'vitest'

import { bodyFromEditorText, bodyToEditorText } from '@/lib/news/body'

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
