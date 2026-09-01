import { describe, expect, it, vi } from 'vitest'

/**
 * The stored-body projection — `readNewsBody` (`lib/content/news.ts`).
 *
 * One parser serves both worlds: the public renderer and the admin editor project the
 * stored document through this function, so what it drops or rewrites is dropped and
 * rewritten everywhere. The suite exists for the regression the phase-9 lock pass
 * caught: span text was read through the read layer's *trimming* string helper, which
 * was harmless while every paragraph held one span (9A) and destroyed the boundary
 * spaces between spans the moment the 9B editor stored more than one — "med ",
 * "fed skrift", " og" came back as "medfed skriftog", in the editor and on the
 * public page alike, while the database row stayed correct.
 */

// The module under test sits behind the read layer's Supabase imports; the projection
// itself never touches a client, so the doubles are inert.
vi.mock('@/lib/supabase/server', () => ({
  createSupabasePublicClient: () => {
    throw new Error('not used by readNewsBody')
  },
  createSupabaseServerClient: () => {
    throw new Error('not used by readNewsBody')
  },
}))

const { readNewsBody } = await import('@/lib/content/news')

describe('readNewsBody', () => {
  it('returns span text verbatim — boundary spaces between spans survive', () => {
    const body = readNewsBody({
      blocks: [
        {
          type: 'paragraph',
          spans: [
            { text: 'Et afsnit med ' },
            { text: 'fed skrift', bold: true },
            { text: ' og ' },
            { text: 'et link', href: 'https://example.test/probe' },
            { text: ' til noget.' },
          ],
        },
      ],
    })

    expect(body.blocks).toHaveLength(1)
    expect(body.blocks[0]!.spans.map((span) => span.text).join('')).toBe(
      'Et afsnit med fed skrift og et link til noget.',
    )
    expect(body.blocks[0]!.spans).toEqual([
      { text: 'Et afsnit med ' },
      { text: 'fed skrift', bold: true },
      { text: ' og ' },
      { text: 'et link', href: 'https://example.test/probe' },
      { text: ' til noget.' },
    ])
  })

  it('keeps an interior whitespace-only span — it separates two marked neighbours', () => {
    const body = readNewsBody({
      blocks: [
        {
          type: 'paragraph',
          spans: [{ text: 'fed', bold: true }, { text: ' ' }, { text: 'mere', bold: true }],
        },
      ],
    })

    expect(body.blocks[0]!.spans.map((span) => span.text).join('')).toBe('fed mere')
  })

  it('drops a whitespace-only paragraph — blank is absent at the paragraph level', () => {
    const body = readNewsBody({
      blocks: [
        { type: 'paragraph', spans: [{ text: '   ' }] },
        { type: 'paragraph', spans: [{ text: 'Rigtigt indhold.' }] },
      ],
    })

    expect(body.blocks).toHaveLength(1)
    expect(body.blocks[0]!.spans[0]!.text).toBe('Rigtigt indhold.')
  })

  it('keeps bold and https links, and drops any other scheme', () => {
    const body = readNewsBody({
      blocks: [
        {
          type: 'paragraph',
          spans: [
            { text: 'sikkert', href: 'https://example.test/' },
            { text: ' og ' },
            { text: 'usikkert', href: 'javascript:alert(1)' },
          ],
        },
      ],
    })

    expect(body.blocks[0]!.spans[0]!.href).toBe('https://example.test/')
    expect(body.blocks[0]!.spans[2]).toEqual({ text: 'usikkert' })
  })

  it('reads a malformed document as an empty body rather than throwing', () => {
    expect(readNewsBody(null).blocks).toEqual([])
    expect(readNewsBody({ blocks: 'ikke en liste' }).blocks).toEqual([])
    expect(readNewsBody({ blocks: [{ type: 'heading', spans: [{ text: 'x' }] }] }).blocks).toEqual([])
    expect(readNewsBody({ blocks: [{ type: 'paragraph', spans: [{ text: '' }] }] }).blocks).toEqual([])
  })
})
