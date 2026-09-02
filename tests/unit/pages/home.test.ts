import { describe, expect, it } from 'vitest'

import {
  applyFeaturedEdit,
  describeHomePending,
  featuredDishesWrite,
  HOME_SECTION_KEYS,
  HOME_SECTION_LABELS,
  homeSectionWrite,
  homeValuesOf,
  type HomeValues,
} from '@/lib/pages/home'
import { homeDraft } from '@/lib/schemas/page-documents'

/**
 * The Forside document's rules — phase 11A; technical plan §4, §6, §7e item 4.
 *
 * Pure functions, asserted directly: the normalisation the public page and the editor
 * share, the per-section delta that keeps a page draft holding only changed sections,
 * the five featured-list controls, and the sentences the screen says.
 */

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const D = '44444444-4444-4444-8444-444444444444'

const SEEDED = {
  hero: { heading: 'Burgeren der vandt Fyn', intro: 'Intro.' },
  award: { title: 'Vinder', text: 'Tekst om udmærkelsen.' },
  featured_dish_ids: [A, B, C],
  about_excerpt: { heading: 'Lokal burgerbar', text: 'Om os.' },
}

describe('homeValuesOf — one normalisation for the page and the editor', () => {
  it('reads a document written before the image keys existed with every key present', () => {
    const values = homeValuesOf(SEEDED)

    expect(values).toEqual<HomeValues>({
      hero: { heading: 'Burgeren der vandt Fyn', intro: 'Intro.', image_id: null },
      award: { title: 'Vinder', text: 'Tekst om udmærkelsen.', image_id: null },
      featured_dish_ids: [A, B, C],
      about_excerpt: { heading: 'Lokal burgerbar', text: 'Om os.', image_id: null },
    })
  })

  it('reads the three image ids, lower-cased, and drops anything that is not a uuid', () => {
    const values = homeValuesOf({
      hero: { heading: 'x', intro: null, image_id: A.toUpperCase() },
      award: { title: null, text: null, image_id: '../etc/passwd' },
      about_excerpt: { heading: null, text: null, image_id: 42 },
      featured_dish_ids: [A, 'ikke-et-id', B],
    })

    expect(values.hero.image_id).toBe(A)
    expect(values.award.image_id).toBeNull()
    expect(values.about_excerpt.image_id).toBeNull()
    expect(values.featured_dish_ids).toEqual([A, B])
  })

  it('renders a missing, malformed or empty document as empty sections rather than throwing', () => {
    for (const document of [null, undefined, 'tekst', [], {}, { hero: 'ikke et objekt' }]) {
      const values = homeValuesOf(document)
      expect(values.hero).toEqual({ heading: null, intro: null, image_id: null })
      expect(values.featured_dish_ids).toEqual([])
    }
  })

  it('treats blank text as absent, as every schema in this repository does', () => {
    const values = homeValuesOf({ hero: { heading: '   ', intro: '' } })
    expect(values.hero.heading).toBeNull()
    expect(values.hero.intro).toBeNull()
  })
})

describe('homeSectionWrite — the section delta (§4)', () => {
  const live = homeValuesOf(SEEDED)

  it('writes a changed section whole, and clears nothing', () => {
    const submitted = { heading: 'Ny overskrift', intro: 'Intro.', image_id: null }

    expect(homeSectionWrite('hero', submitted, live.hero)).toEqual({
      values: { hero: submitted },
      clear: [],
    })
  })

  it('a section edited back to the published one leaves the draft', () => {
    expect(homeSectionWrite('hero', { ...live.hero }, live.hero)).toEqual({
      values: {},
      clear: ['hero'],
    })
  })

  it('an image choice alone is a change — the words ride along, unchanged', () => {
    const submitted = { ...live.award, image_id: A }

    expect(homeSectionWrite('award', submitted, live.award)).toEqual({
      values: { award: submitted },
      clear: [],
    })
  })

  it('choosing the image that is already live takes the section back out', () => {
    const liveWithImage = { ...live.about_excerpt, image_id: A }

    expect(homeSectionWrite('about_excerpt', { ...liveWithImage }, liveWithImage)).toEqual({
      values: {},
      clear: ['about_excerpt'],
    })
  })

  it('what it writes satisfies the strict page schema — a section is always whole', () => {
    const write = homeSectionWrite('hero', { heading: 'Ny', intro: null, image_id: B }, live.hero)

    expect(homeDraft.input.safeParse(write.values).success).toBe(true)
  })
})

describe('featuredDishesWrite — the same rule for the list', () => {
  it('a reordered or changed list is written whole', () => {
    expect(featuredDishesWrite([B, A, C], [A, B, C])).toEqual({
      values: { featured_dish_ids: [B, A, C] },
      clear: [],
    })
  })

  it('the published order, restored, leaves the draft', () => {
    expect(featuredDishesWrite([A, B, C], [A, B, C])).toEqual({
      values: {},
      clear: ['featured_dish_ids'],
    })
  })
})

describe('applyFeaturedEdit — 1u\'s five controls', () => {
  it('adds to the next free slot', () => {
    expect(applyFeaturedEdit([A], { kind: 'add', dishId: B })).toEqual({ ok: true, ids: [A, B] })
  })

  it('refuses a fourth dish', () => {
    expect(applyFeaturedEdit([A, B, C], { kind: 'add', dishId: D })).toEqual({
      ok: false,
      error: 'full',
    })
  })

  it('refuses the same dish twice, on add and on change', () => {
    expect(applyFeaturedEdit([A, B], { kind: 'add', dishId: A })).toEqual({
      ok: false,
      error: 'duplicate',
    })
    expect(applyFeaturedEdit([A, B], { kind: 'replace', index: 1, dishId: A })).toEqual({
      ok: false,
      error: 'duplicate',
    })
  })

  it('changes one slot in place — the same dish back into its own slot is allowed', () => {
    expect(applyFeaturedEdit([A, B, C], { kind: 'replace', index: 1, dishId: D })).toEqual({
      ok: true,
      ids: [A, D, C],
    })
    expect(applyFeaturedEdit([A, B, C], { kind: 'replace', index: 1, dishId: B })).toEqual({
      ok: true,
      ids: [A, B, C],
    })
  })

  it('removes a slot and closes the gap', () => {
    expect(applyFeaturedEdit([A, B, C], { kind: 'remove', index: 0 })).toEqual({
      ok: true,
      ids: [B, C],
    })
  })

  it('moves up and down, and refuses a move off either end', () => {
    expect(applyFeaturedEdit([A, B, C], { kind: 'move', index: 2, direction: 'up' })).toEqual({
      ok: true,
      ids: [A, C, B],
    })
    expect(applyFeaturedEdit([A, B, C], { kind: 'move', index: 0, direction: 'down' })).toEqual({
      ok: true,
      ids: [B, A, C],
    })
    expect(applyFeaturedEdit([A, B], { kind: 'move', index: 0, direction: 'up' })).toEqual({
      ok: false,
      error: 'unmovable',
    })
  })

  it('refuses a slot that does not exist, for every slot control', () => {
    for (const edit of [
      { kind: 'replace', index: 3, dishId: D },
      { kind: 'remove', index: -1 },
      { kind: 'move', index: 5, direction: 'up' },
    ] as const) {
      expect(applyFeaturedEdit([A, B], edit)).toEqual({ ok: false, error: 'no_such_slot' })
    }
  })

  it('never mutates the list it was given', () => {
    const ids = [A, B]
    applyFeaturedEdit(ids, { kind: 'remove', index: 0 })
    applyFeaturedEdit(ids, { kind: 'move', index: 0, direction: 'down' })
    expect(ids).toEqual([A, B])
  })
})

describe('describeHomePending — which sections are waiting', () => {
  it('names the four sections in document order, in the administration\'s words', () => {
    expect(HOME_SECTION_KEYS).toEqual(['hero', 'award', 'featured_dish_ids', 'about_excerpt'])
    expect(HOME_SECTION_LABELS).toEqual({
      hero: 'Øverst på siden',
      award: 'Udmærkelsen',
      featured_dish_ids: 'Udvalgte burgere',
      about_excerpt: 'Om os (uddrag)',
    })
  })

  it('says nothing when nothing waits', () => {
    expect(describeHomePending([])).toBeNull()
  })

  it('one section', () => {
    expect(describeHomePending(['award'])).toBe('Udmærkelsen afventer offentliggørelse.')
  })

  it('several, joined the Danish way and ordered by the document, not the draft', () => {
    expect(describeHomePending(['about_excerpt', 'hero', 'featured_dish_ids'])).toBe(
      'Øverst på siden, Udvalgte burgere og Om os (uddrag) afventer offentliggørelse.',
    )
  })

  it('ignores a field name that is not a section', () => {
    expect(describeHomePending(['updated_by', 'role'])).toBeNull()
  })
})
