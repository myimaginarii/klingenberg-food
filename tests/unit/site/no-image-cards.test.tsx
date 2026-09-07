import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WeeklySpecial } from '@/components/site/menu/WeeklySpecial'
import { NewsCard } from '@/components/site/news/NewsCard'
import type { NewsArticle } from '@/lib/content/types'
import { buildStaticPublicImage } from '@/lib/images/public'
import type { WeeklySpecialView } from '@/lib/menu/view'

/**
 * The two no-image states the approved frames draw for an entity without a photo —
 * decided and built by the phase-10 lock pass (technical plan §0y):
 *
 *   * 1j/1n — a news item without a photo gets a **date circle** instead, so
 *     "layoutet falder ikke sammen"; an item without a date either has nothing to
 *     draw and takes the card's width.
 *   * 1af — Ugens ret without a photo leaves **no empty image slot**: "Uden foto
 *     flytter teksten helt ud til kanten".
 *
 * Both are server HTML, so both are asserted as markup here; the guest-visible walk
 * is `tests/e2e/public-images.spec.ts`.
 */

const IMAGE = buildStaticPublicImage({
  slot: 'card-photo',
  alt: 'Et foto.',
  width: 960,
  height: 640,
})

function article(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id: 'a1',
    title: 'Overskrift',
    slug: 'overskrift',
    category: 'Ny burger',
    displayDate: '2026-12-24',
    updatedAt: '2026-09-01T10:00:00+02:00',
    body: { blocks: [] },
    image: null,
    ...overrides,
  }
}

function weekly(overrides: Partial<WeeklySpecialView> = {}): WeeklySpecialView {
  return {
    isoYear: 2026,
    isoWeek: 36,
    days: ['wed', 'thu', 'fri'],
    daysLabel: 'Onsdag · torsdag · fredag',
    name: 'Stegt flæsk',
    description: 'Med persillesovs.',
    priceSmallOre: 8500,
    priceLargeOre: 11500,
    soldOutOn: null,
    soldOut: false,
    image: null,
    saturday: {
      enabled: false,
      name: null,
      description: null,
      priceOre: null,
      deadline: null,
      soldOutOn: null,
      soldOut: false,
    },
    ...overrides,
  } as WeeklySpecialView
}

describe('NewsCard without a photo — 1j/1n', () => {
  it('draws the date circle, decorative, in place of the photograph', () => {
    const html = renderToStaticMarkup(<NewsCard article={article()} excerpt={null} />)

    expect(html).not.toContain('<picture')
    expect(html).not.toContain('media-placeholder')
    expect(html).toMatch(/class="news-date-circle[^"]*" aria-hidden="true"|aria-hidden="true" class="news-date-circle/)
    expect(html).toContain('>24</span>')
    expect(html).toContain('>DEC</span>')
    // The date is still spoken from the meta line's <time>, not from the circle.
    expect(html).toContain('<time dateTime="2026-12-24"')
  })

  it('draws nothing in the slot for an article with neither a photo nor a date', () => {
    const html = renderToStaticMarkup(
      <NewsCard article={article({ displayDate: null })} excerpt={null} />,
    )

    expect(html).not.toContain('news-date-circle')
    expect(html).not.toContain('<picture')
    expect(html).not.toContain('media-placeholder')
    expect(html).toContain('Overskrift')
  })

  it('renders the photograph and no circle when the article has one', () => {
    const html = renderToStaticMarkup(<NewsCard article={article({ image: IMAGE })} excerpt={null} />)

    expect(html).toContain('<picture')
    expect(html).not.toContain('news-date-circle')
  })
})

describe('Ugens ret without a photo — 1af', () => {
  it('leaves no empty image slot: no <picture>, no reserved frame', () => {
    const html = renderToStaticMarkup(<WeeklySpecial weekly={weekly()} />)

    expect(html).not.toContain('<picture')
    expect(html).not.toContain('media-placeholder')
    expect(html).toContain('Stegt flæsk')
    expect(html).toContain('Uge 36')
  })

  it('renders the photograph in the 4:3 column when one is selected', () => {
    const html = renderToStaticMarkup(<WeeklySpecial weekly={weekly({ image: IMAGE })} />)

    expect(html).toContain('<picture class="block overflow-hidden aspect-card')
    expect(html).toContain('md:w-50')
  })
})
