import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AwardBand } from '@/components/site/AwardBand'
import { HomeHero } from '@/components/site/home/HomeHero'
import { NewsAndAbout } from '@/components/site/home/NewsAndAbout'
import { buildStaticPublicImage, IMAGE_SIZES } from '@/lib/images/public'

/**
 * The Forside's three photographs, rendered — phase 11A; designs 1g / 1l.
 *
 * Server HTML, asserted as markup: each slot renders the library image through the
 * one public renderer in the box it always reserved, and the reserved frame when there
 * is none. The hero is the page's primary image and loads eagerly; the other two lazily.
 */

const SLOT = 'home-hero'
const PUBLIC = `/media/${SLOT}`

/** A 960 px source, so the ladder is exactly the 480 and 960 rungs. */
const image = buildStaticPublicImage({
  slot: SLOT,
  alt: 'Signaturburgeren, tæt på.',
  width: 960,
  height: 640,
})

const hours = {
  schedule: {
    mon: { closed: true },
    tue: { closed: true },
    wed: { from: '15:00', to: '20:00' },
    thu: { from: '15:00', to: '20:00' },
    fri: { from: '15:00', to: '20:00' },
    sat: { from: '17:00', to: '20:00' },
    sun: { from: '17:00', to: '20:00' },
  },
  overrides: [],
} as const

function hero(withImage: boolean): string {
  return renderToStaticMarkup(
    <HomeHero
      heading="Burgeren der vandt Fyn"
      intro={null}
      // The badge is a client component with its own suite; nothing here asserts on it.
      schedule={hours.schedule as never}
      overrides={[]}
      primaryPhone={null}
      directionsHref={null}
      image={withImage ? image : null}
    />,
  )
}

describe('the hero photograph (1u "Hovedbillede")', () => {
  it('renders the library image eagerly, in the reserved hero box', () => {
    const html = hero(true)

    expect(html).toContain(`src="${PUBLIC}/960.webp"`)
    expect(html).toContain('loading="eager"')
    expect(html).toContain('alt="Signaturburgeren, tæt på."')
    expect(html).toContain(`sizes="${IMAGE_SIZES.homeHero}"`)
    // The same box the placeholder reserved — the column beside the text from `md`.
    expect(html).toMatch(/<picture class="[^"]*aspect-square[^"]*md:min-h-\[32\.5rem\][^"]*">/)
    expect(html).not.toContain('media-placeholder')
  })

  it('renders the reserved frame when the document names no image', () => {
    const html = hero(false)

    expect(html).toContain('media-placeholder')
    expect(html).toContain('Hero-foto')
    expect(html).not.toContain('<picture')
  })
})

describe('the award photograph (1u "Udmærkelsesfoto")', () => {
  it('renders the image in the band\'s 4:3 column, lazily', () => {
    const html = renderToStaticMarkup(
      <AwardBand headingId="t" title="Vinder" text="Tekst" image={image} />,
    )

    expect(html).toContain(`src="${PUBLIC}/960.webp"`)
    expect(html).toContain('loading="lazy"')
    expect(html).toContain(`sizes="${IMAGE_SIZES.homeAward}"`)
    expect(html).toMatch(/<picture class="[^"]*aspect-card[^"]*md:w-\[13\.75rem\]/)
  })

  it('draws no frame for none — the band is seal and words, on both pages', () => {
    const forside = renderToStaticMarkup(
      <AwardBand headingId="t" title="Vinder" text="Tekst" image={null} />,
    )
    const omOs = renderToStaticMarkup(<AwardBand headingId="t" title="Vinder" text="Tekst" sealFirst />)

    for (const html of [forside, omOs]) {
      // No reserved photo frame: a hatched box on the burgundy band read as a diploma
      // that had failed to load rather than as a slot nobody has filled in yet.
      expect(html).not.toContain('media-placeholder')
      expect(html).not.toContain('<picture')
      // The award itself is untouched — the eyebrow, the wording and the seal all stay.
      expect(html).toContain('Udmærkelse')
      expect(html).toContain('Vinder')
      expect(html).toContain('DANMARKS BEDSTE')
    }
  })

  it('shows the supplied seal, as a decorative brand asset, where the Forside asks for it', () => {
    const html = renderToStaticMarkup(
      <AwardBand headingId="t" title="Vinder" text="Tekst" seal="supplied" />,
    )

    expect(html).toContain('src="/brand/award.png"')
    expect(html).toContain('alt=""')
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('DANMARKS BEDSTE')
    expect(html).not.toContain('<picture')
  })
})

describe('the team photograph (1u "Holdfoto")', () => {
  it('renders in the "Om os" thumbnail frame, and the frame without it', () => {
    const withImage = renderToStaticMarkup(
      <NewsAndAbout latestArticle={null} latestExcerpt={null} aboutHeading="Om os" aboutText="Tekst" aboutImage={image} />,
    )
    const without = renderToStaticMarkup(
      <NewsAndAbout latestArticle={null} latestExcerpt={null} aboutHeading="Om os" aboutText="Tekst" />,
    )

    expect(withImage).toContain(`sizes="${IMAGE_SIZES.homeTeam}"`)
    expect(withImage).toMatch(/<picture class="[^"]*aspect-card[^"]*md:w-37\.5/)
    expect(without).toContain('Holdet')
    expect(without).not.toContain('<picture')
  })
})
