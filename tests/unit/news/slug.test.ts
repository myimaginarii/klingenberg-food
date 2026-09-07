import { describe, expect, it } from 'vitest'

import {
  isNewsSlug,
  newsArticlePath,
  resolveSlugCollision,
  slugFromTitle,
} from '@/lib/news/slug'

/**
 * §7f's slug policy, held still: generated from the title with the Danish
 * transliteration the plan names (æ→ae, ø→oe, å→aa), collision-suffixed `-2`, and a
 * grammar identical to the database's `news_slug_check`. The freeze itself is the
 * frozen slug rule the design states (§7f).
 */

describe('slugFromTitle — §7f, letter for letter', () => {
  it.each([
    ['Ny burger', 'ny-burger'],
    // The three named transliterations, lower and upper case.
    ['Grillspyd med løg og æbler', 'grillspyd-med-loeg-og-aebler'],
    ['Særlige åbningstider', 'saerlige-aabningstider'],
    ['ÆØÅ', 'aeoeaa'],
    ['Åben påske', 'aaben-paaske'],
    // Other accents reduce to their base letter rather than disappearing.
    ['Café-idé', 'cafe-ide'],
    // Punctuation and whitespace runs become one hyphen; edges are trimmed.
    ['Hej,   verden!!!', 'hej-verden'],
    ['  — Tilbud —  ', 'tilbud'],
    ['Åben 24/7', 'aaben-24-7'],
    // Case folds.
    ['LUKKET MANDAG', 'lukket-mandag'],
  ])('turns %j into %j', (title, slug) => {
    expect(slugFromTitle(title)).toBe(slug)
  })

  it.each([['???'], ['—'], [''], ['   '], ['!!!///...']])(
    'answers null for a title with nothing sluggable: %j',
    (title) => {
      expect(slugFromTitle(title)).toBeNull()
    },
  )

  it('always produces a slug the database CHECK would accept', () => {
    const titles = [
      'Ny burger',
      'Særlige åbningstider — uge 42!',
      'Café & croissant à la carte',
      '  Über—cool:  50% rabat  ',
      'Smørrebrød m/ rødbeder & løg',
    ]

    for (const title of titles) {
      const slug = slugFromTitle(title)
      expect(slug).not.toBeNull()
      expect(isNewsSlug(slug)).toBe(true)
    }
  })
})

describe('resolveSlugCollision — §7f names -2, and the series continues', () => {
  it('keeps a free base untouched', () => {
    expect(resolveSlugCollision('ny-burger', new Set(['anden-nyhed']))).toBe('ny-burger')
  })

  it('suffixes -2 when the base is taken', () => {
    expect(resolveSlugCollision('ny-burger', new Set(['ny-burger']))).toBe('ny-burger-2')
  })

  it('continues the series when -2 is taken as well', () => {
    expect(resolveSlugCollision('ny-burger', new Set(['ny-burger', 'ny-burger-2']))).toBe(
      'ny-burger-3',
    )
  })

  it('fills the first gap rather than counting past it', () => {
    expect(resolveSlugCollision('ny-burger', new Set(['ny-burger', 'ny-burger-3']))).toBe(
      'ny-burger-2',
    )
  })
})

describe('isNewsSlug — the same grammar as news_slug_check', () => {
  it.each([['ny-burger'], ['a'], ['a-2'], ['abc-def-2'], ['24-7']])('accepts %j', (slug) => {
    expect(isNewsSlug(slug)).toBe(true)
  })

  it.each([
    ['-a'],
    ['a-'],
    ['a--b'],
    ['A-b'],
    ['æble'],
    [''],
    ['a/b'],
    ['a.b'],
    ['a b'],
    [null],
    [42],
  ])('refuses %j', (slug) => {
    expect(isNewsSlug(slug)).toBe(false)
  })
})

describe('newsArticlePath', () => {
  it('is the public address §7f promises stays stable', () => {
    expect(newsArticlePath('ny-burger')).toBe('/nyheder/ny-burger')
  })
})
