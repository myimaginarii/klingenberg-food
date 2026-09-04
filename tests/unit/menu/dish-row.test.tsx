import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DishRow } from '@/components/admin/menu/DishRow'
import type { AdminImageThumbnail } from '@/lib/content/images-admin'
import type { AdminDish, DishAvailability } from '@/lib/menu/admin'

/**
 * The dish row's photo — phase 12A; designs 1r (row) and 1y (card).
 *
 * Server HTML, asserted as markup: the row draws the thumbnail it is handed through
 * the one admin renderer, inside the link that opens the editor, as a decorative
 * image whose name is the dish's; a sold-out dish's photo is greyed; a dish without
 * a photo draws the reserved frame, hidden from assistive technology, and no `<img>`.
 * Which photo a row is handed — the draft over the published selection — is decided
 * by the page's read (`tests/unit/content/images-thumbnails.test.ts`), not here.
 */

const ORIGIN = 'http://localhost:54321'
const UPLOAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const thumbnail: AdminImageThumbnail = {
  webpUrl: `${ORIGIN}/storage/v1/object/public/media/${UPLOAD}/480.webp`,
  avifUrl: `${ORIGIN}/storage/v1/object/public/media/${UPLOAD}/480.avif`,
  width: 480,
  height: 320,
}

const live = {
  category_id: 'cat-burgere',
  name: 'Odin',
  description: '200 g dry aged bøf.',
  secondary_note: null,
  price_ore: 8900,
  labels: [] as string[],
}

function dish(overrides: Partial<AdminDish> = {}): AdminDish {
  return {
    id: 'dish-odin',
    categoryId: live.category_id,
    name: live.name,
    description: live.description,
    secondaryNote: null,
    priceOre: live.price_ore,
    labels: [],
    sortOrder: 1,
    liveSortOrder: 1,
    tapas: null,
    liveTapas: null,
    imageId: null,
    liveImageId: null,
    soldOutOn: null,
    isNewDraft: false,
    hasDraft: false,
    draftFields: [],
    updatedAt: '2026-09-04T10:00:00.000Z',
    live,
    ...overrides,
  }
}

const AVAILABLE: DishAvailability = { soldOut: false, resetText: null }
const SOLD_OUT: DishAvailability = {
  soldOut: true,
  resetText: 'Nulstilles automatisk onsdag kl. 15:00',
}

const availabilityForm = {
  action: async () => {},
  fieldNames: {
    dishId: 'ret',
    version: 'version',
    soldOut: 'udsolgt',
    section: 'sektion',
    editorOpen: 'aaben',
  },
}

function row(
  photo: AdminImageThumbnail | null,
  availability: DishAvailability = AVAILABLE,
  overrides: Partial<AdminDish> = {},
): string {
  return renderToStaticMarkup(
    <DishRow
      availability={availability}
      availabilityForm={availabilityForm}
      dish={dish(overrides)}
      href="/admin/menu?sektion=burgere&ret=dish-odin"
      reorder={null}
      section="burgere"
      thumbnail={photo}
    />,
  )
}

/** The editor link — the row's one way in — with everything inside it. */
function editorLink(markup: string): string {
  const match = /<a [^>]*href="\/admin\/menu\?sektion=burgere&amp;ret=dish-odin"[^>]*>([\s\S]*?)<\/a>/.exec(
    markup,
  )
  expect(match, 'the row links to the editor').not.toBeNull()
  return match?.[1] ?? ''
}

describe('DishRow — the photo beside the name (12A)', () => {
  it('draws the thumbnail inside the editor link, decorative, from the public rung only', () => {
    const link = editorLink(row(thumbnail))

    expect(link).toContain('<picture>')
    expect(link).toContain(`src="${thumbnail.webpUrl}"`)
    expect(link).toContain(`srcSet="${thumbnail.avifUrl}"`)
    expect(link).toContain('alt=""')
    // The link's name stays the dish's; the photo does not introduce the row twice.
    expect(link).toContain('Odin')
    expect(link).not.toContain('media-originals')
    expect(link).not.toContain('original.')
    // 1y's 60 × 52 frame and 1r's 72 × 58, never shrinking, 8 px corners.
    expect(link).toMatch(/<img [^>]*class="[^"]*\bh-13\b[^"]*\bw-15\b[^"]*"/)
    expect(link).toMatch(/<img [^>]*class="[^"]*\bmd:h-14\.5\b[^"]*\bmd:w-18\b[^"]*"/)
    expect(link).toMatch(/<img [^>]*class="[^"]*\bshrink-0\b[^"]*"/)
    expect(link).toMatch(/<img [^>]*class="[^"]*\brounded-field\b[^"]*"/)
    expect(link).toMatch(/<img [^>]*loading="lazy"/)
    expect(link).not.toContain('grayscale')
  })

  it('greys and dims the photo of a sold-out dish, as 1y draws Thor', () => {
    const link = editorLink(row(thumbnail, SOLD_OUT))

    expect(link).toMatch(/<img [^>]*class="[^"]*\bgrayscale\b[^"]*"/)
    expect(link).toMatch(/<img [^>]*class="[^"]*\bopacity-70\b[^"]*"/)
  })

  it('draws the reserved frame, hidden from assistive technology, when there is no photo', () => {
    const link = editorLink(row(null))

    expect(link).not.toContain('<img')
    expect(link).not.toContain('<picture')
    expect(link).toMatch(/<span aria-hidden="true" class="[^"]*\bh-13\b[^"]*\bw-15\b[^"]*"[^>]*>Foto<\/span>/)
    expect(link).toContain('Odin')
  })

  it('draws the frame the same size whether a dish has a photo or not', () => {
    const frameOf = (markup: string) =>
      /class="(rounded-field h-13 w-15 shrink-0 md:h-14\.5 md:w-18)[^"]*"/.exec(markup)?.[1]

    expect(frameOf(editorLink(row(thumbnail)))).toBeDefined()
    expect(frameOf(editorLink(row(thumbnail)))).toBe(frameOf(editorLink(row(null))))
  })

  it('shows a pending photo beside the sentence that says it is pending', () => {
    const markup = row(thumbnail, AVAILABLE, {
      imageId: 'image-new',
      liveImageId: null,
      hasDraft: true,
      draftFields: ['image_id'],
    })

    expect(editorLink(markup)).toContain('<picture>')
    // The row's own pending sentence (`describePendingChange`, unchanged by 12A).
    expect(markup).toContain('Ny billede afventer offentliggørelse')
  })
})
