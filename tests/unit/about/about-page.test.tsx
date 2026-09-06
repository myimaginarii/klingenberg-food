import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AboutPageContent } from '@/components/site/about/AboutPageContent'
import type { AboutDocument } from '@/lib/content/types'
import { buildPublicImage, IMAGE_SIZES } from '@/lib/images/public'

/**
 * Om os's three photographs, rendered — phase 14B1; design 1i.
 *
 * Server HTML, asserted as markup: each slot renders the library image through the
 * one public renderer in the box it always reserved, with the library's own
 * description as `alt`, and the reserved frame when there is none. The facade is the
 * page's primary image and loads eagerly; the other two lazily. Nothing here reaches a
 * database.
 */

const ORIGIN = 'http://localhost:54321'
const UPLOAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const PUBLIC = `${ORIGIN}/storage/v1/object/public/media/${UPLOAD}`

function image(alt: string | null) {
  return buildPublicImage(ORIGIN, {
    storage_path: `${UPLOAD}/original.jpg`,
    alt_text: alt,
    derivatives: {
      formats: ['avif', 'webp'],
      widths: [
        { width: 480, height: 320 },
        { width: 960, height: 640 },
      ],
    },
  })!
}

const WORDS: AboutDocument = {
  heading: 'Vores historie',
  storyBlocks: ['Første afsnit.', 'Andet afsnit.', 'Første afsnit.'],
  venueImage: null,
  team: { text: 'Holdet bag disken.', image: null },
  method: { heading: 'Sådan laver vi burgere', text: 'Råvarer og brød.', image: null },
}

function render(about: AboutDocument | null): string {
  return renderToStaticMarkup(<AboutPageContent about={about} />)
}

describe('the words', () => {
  it('renders the heading, every story paragraph, the team paragraph and the method', () => {
    const html = render(WORDS)
    expect(html).toContain('>Vores historie<')
    expect(html.match(/Første afsnit\./g)).toHaveLength(2)
    expect(html).toContain('Andet afsnit.')
    expect(html).toContain('Holdet bag disken.')
    expect(html).toContain('id="om-os-metode"')
    expect(html).toContain('Sådan laver vi burgere')
    expect(html).toContain('Råvarer og brød.')
  })

  it('renders the page\'s own words for a missing document, and no empty paragraphs', () => {
    const html = render(null)
    expect(html).toContain('>Om os<')
    expect(html).toContain('Sådan laver vi burgere')
    expect(html).not.toContain('<p class="text-neutral-ink mt-5')
  })

  it('states the award once, as the confirmed result, without a document field behind it', () => {
    const html = render(WORDS)
    expect(html).toContain('Vinder af Fyn &amp; Øer — nr. 4 i Danmark')
    expect(html).toContain('Danmarks Bedste Burger 2026')
  })
})

describe('the venue frame without an image', () => {
  it('draws the reserved placeholder exactly as before, hidden from assistive technology', () => {
    const html = render(WORDS)
    expect(html.match(/media-placeholder/g)).toHaveLength(1) // the venue slot; the award band draws no frame without a photograph
    expect(html).toContain('>Stedet<')
    expect(html).toContain('facade / indgang ved hallen · dagslys')
    expect(html).not.toContain('<picture')
  })
})

describe('the team and kitchen sections without an image', () => {
  it('render text-only — no reserved photo frame — when the restaurant has not supplied that photograph', () => {
    const html = render(WORDS)
    expect(html).not.toContain('Ét holdfoto — fuld bredde')
    expect(html).not.toContain('hele holdet samlet i køkkenet, naturligt lys')
    expect(html).not.toContain('Køkken / tilberedning')
    expect(html).toContain('Holdet bag disken.')
    expect(html).toContain('Sådan laver vi burgere')
    expect(html).toContain('Råvarer og brød.')
  })
})

describe('the three frames with an image', () => {
  const withImages: AboutDocument = {
    ...WORDS,
    venueImage: image('Indgangen ved hallen.'),
    team: { ...WORDS.team, image: image('Hele holdet i køkkenet.') },
    method: { ...WORDS.method, image: image(null) },
  }

  it('renders the facade eagerly in the portrait box, the team in the 16:7 box, the kitchen in the 3:2 box', () => {
    const html = render(withImages)

    expect(html.match(/<picture/g)).toHaveLength(3)
    expect(html).toMatch(/<picture class="[^"]*aspect-portrait[^"]*md:max-w-\[26rem\][^"]*">/)
    expect(html).toMatch(/<picture class="[^"]*aspect-team[^"]*">/)
    expect(html).toMatch(/<picture class="[^"]*aspect-hero[^"]*">/)
    expect(html.match(/loading="eager"/g)).toHaveLength(1)
    expect(html.match(/loading="lazy"/g)).toHaveLength(2)
    // The slot-specific `sizes`, so the browser picks a rung by the real rendered width.
    expect(html).toContain(`sizes="${IMAGE_SIZES.aboutVenue}"`)
    expect(html).toContain(`sizes="${IMAGE_SIZES.aboutTeam}"`)
    expect(html).toContain(`sizes="${IMAGE_SIZES.aboutKitchen}"`)
    // The three slots draw pictures, and the award band has no photograph to draw.
    expect(html).not.toContain('media-placeholder')
  })

  it('uses the library\'s own description as alt — and an empty alt for an undescribed image, never the page\'s words', () => {
    const html = render(withImages)
    expect(html).toContain('alt="Indgangen ved hallen."')
    expect(html).toContain('alt="Hele holdet i køkkenet."')
    expect(html).toContain('alt=""')
    expect(html).not.toContain('alt="Køkken')
    expect(html).not.toContain('alt="Stedet"')
  })

  it('serves only public derivatives — never the private original', () => {
    const html = render(withImages)
    expect(html).toContain(`src="${PUBLIC}/960.webp"`)
    expect(html).toContain(`${PUBLIC}/480.avif 480w`)
    expect(html).not.toContain('media-originals')
    expect(html).not.toContain('original.jpg')
  })
})
