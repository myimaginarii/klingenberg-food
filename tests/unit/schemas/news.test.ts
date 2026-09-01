import { describe, expect, it } from 'vitest'

import { NEWS_CATEGORIES, newsArticleInput, newsBodySchema } from '@/lib/schemas/news'

/**
 * The write-side gate for an article — strict, so a forged POST or an older tab
 * cannot reach a column around the editor. The database CHECKs remain the final
 * authority; this is the layer that answers first, in a shape the actions can map.
 */

const VALID = {
  title: 'Ny burger i oktober',
  slug: 'ny-burger-i-oktober',
  body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Første afsnit.' }] }] },
  category: 'Ny burger',
  display_date: '2026-09-01',
  image_id: null,
}

describe('newsArticleInput', () => {
  it('accepts a complete article', () => {
    expect(newsArticleInput.safeParse(VALID).success).toBe(true)
  })

  it('accepts the two optional fields as null', () => {
    expect(
      newsArticleInput.safeParse({ ...VALID, category: null, display_date: null }).success,
    ).toBe(true)
  })

  // Phase 10C-1: the photo is content, saved through the one news save path. A
  // required key with a nullable value — a caller that forgot it is refused — and
  // only ever a library reference by uuid.
  it('accepts an image reference by uuid, and its absence as null', () => {
    expect(
      newsArticleInput.safeParse({
        ...VALID,
        image_id: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(true)
  })

  it('refuses a save that does not state the image key at all', () => {
    const withoutImage: Record<string, unknown> = { ...VALID }
    delete withoutImage.image_id
    expect(newsArticleInput.safeParse(withoutImage).success).toBe(false)
  })

  it.each([
    ['an image reference that is not a uuid', { ...VALID, image_id: 'stien/original.jpg' }],
    ['a smuggled status', { ...VALID, status: 'published' }],
    ['a smuggled published_at', { ...VALID, published_at: '2026-09-01T00:00:00Z' }],
    ['a blank title', { ...VALID, title: '   ' }],
    ['a title past 200', { ...VALID, title: 'x'.repeat(201) }],
    ['an uppercase slug', { ...VALID, slug: 'Ny-Burger' }],
    ['a slug with a slash', { ...VALID, slug: 'ny/burger' }],
    ['a Danish letter in the slug', { ...VALID, slug: 'løg' }],
    ['an empty slug', { ...VALID, slug: '' }],
    ['a category outside the design’s set', { ...VALID, category: 'Sladder' }],
    ['a malformed date', { ...VALID, display_date: '01-09-2026' }],
    ['an empty body', { ...VALID, body: { blocks: [] } }],
    ['a body that is a string', { ...VALID, body: '<p>html</p>' }],
    ['a paragraph with no spans', { ...VALID, body: { blocks: [{ type: 'paragraph', spans: [] }] } }],
    [
      'an unknown block type',
      { ...VALID, body: { blocks: [{ type: 'heading', spans: [{ text: 'H' }] }] } },
    ],
    [
      'a span with an unknown key',
      { ...VALID, body: { blocks: [{ type: 'paragraph', spans: [{ text: 'x', onclick: 'evil()' }] }] } },
    ],
    [
      'a link that is not https',
      {
        ...VALID,
        body: { blocks: [{ type: 'paragraph', spans: [{ text: 'x', href: 'javascript:alert(1)' }] }] },
      },
    ],
  ])('refuses %s', (_what, value) => {
    expect(newsArticleInput.safeParse(value).success).toBe(false)
  })

  it('accepts the stored mark shapes the renderer draws — bold and an https link', () => {
    const body = {
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

    expect(newsBodySchema.safeParse(body).success).toBe(true)
  })
})

describe('the category vocabulary', () => {
  it('is exactly the five chips frames 1s and 1z draw', () => {
    expect(NEWS_CATEGORIES).toEqual([
      'Ny burger',
      'Særlige åbningstider',
      'Lukket',
      'Arrangement',
      'Udmærkelse',
    ])
  })
})
