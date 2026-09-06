import { describe, expect, it } from 'vitest'

import { announcementDraft, ANNOUNCEMENT_LINK_PAGES } from '@/lib/schemas/announcement'
import { siteContactDraft } from '@/lib/schemas/contact'
import { dishDraft, menuCategoryDraft, tapasDetailsSchema } from '@/lib/schemas/menu'
import { openingHoursDraft, weeklyScheduleSchema } from '@/lib/schemas/opening-hours'
import { aboutDraft, homeDraft, takeawayDraft } from '@/lib/schemas/page-documents'
import { monthlyBurgerDraft, weeklySpecialDraft } from '@/lib/schemas/specials'
import { PUBLISHABLE_ENTITIES } from '@/lib/publishing/entities'

/**
 * Draft validation — technical plan §1 (adjustment 4), §4, §5.
 *
 * The security rule this file exists for, stated in the phase brief:
 *
 *     "Draft input must be a strict allow-list of fields the current role is permitted
 *      to edit. Do not accept arbitrary JSON and merge it into rows."
 *
 * So the tests are mostly refusals. Each one names a field somebody might try to smuggle
 * in and shows the schema rejecting it — not ignoring it, which would leave "we only
 * write what we recognise" as a property of the merge alone.
 */

/** Every field the database or the system owns, and no editor may set. */
const SERVER_CONTROLLED = {
  id: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-08-29T10:00:00+00:00',
  updated_at: '2026-08-29T10:00:00+00:00',
  updated_by: '22222222-2222-4222-8222-222222222222',
  draft: { name: 'noget' },
  role: 'owner',
  actor_id: '33333333-3333-4333-8333-333333333333',
}

describe('unknown keys are refused on the way in', () => {
  const specs = [
    ['dish', dishDraft],
    ['menu_category', menuCategoryDraft],
    ['weekly_special', weeklySpecialDraft],
    ['monthly_burger', monthlyBurgerDraft],
    ['announcement', announcementDraft],
    ['site_contact', siteContactDraft],
    ['opening_hours', openingHoursDraft],
    ['page:home', homeDraft],
    ['page:takeaway', takeawayDraft],
    ['page:about', aboutDraft],
  ] as const

  it.each(specs)('%s refuses a field that is not in its shape', (_name, spec) => {
    const result = spec.input.safeParse({ noget_helt_andet: 'x' })

    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true)
  })

  it.each(specs)('%s refuses every server-controlled field', (_name, spec) => {
    for (const [key, value] of Object.entries(SERVER_CONTROLLED)) {
      expect(spec.input.safeParse({ [key]: value }).success, key).toBe(false)
    }
  })

  it.each(specs)('%s drops an unknown key when reading a stored draft', (_name, spec) => {
    const parsed = spec.stored.safeParse({ noget_helt_andet: 'x' })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({})
  })
})

describe('Owner-only fields stay Owner-only', () => {
  /**
   * The §5 matrix separates Owner from Staff by entity, and the schemas make that
   * concrete: the Forsiden document's sections exist in `homeDraft` and in no other
   * page schema. So a staff member posting Forsiden fields to a page they *may* edit
   * is refused by the schema before any authorization question is reached — the field
   * simply is not part of that entity.
   */
  const OWNER_ONLY_HOME_FIELDS = {
    hero: { heading: 'Overtaget', intro: null, image_id: null },
    award: { title: 'Overtaget', text: null, image_id: null },
    featured_dish_ids: ['44444444-4444-4444-8444-444444444444'],
    about_excerpt: { heading: null, text: 'Overtaget', image_id: null },
  }

  it.each(Object.entries(OWNER_ONLY_HOME_FIELDS))(
    'the Staff-editable takeaway page refuses the Forsiden field "%s"',
    (key, value) => {
      expect(takeawayDraft.input.safeParse({ [key]: value }).success).toBe(false)
    },
  )

  it.each(Object.entries(OWNER_ONLY_HOME_FIELDS))(
    'the Staff-editable about page refuses the Forsiden field "%s"',
    (key, value) => {
      expect(aboutDraft.input.safeParse({ [key]: value }).success).toBe(false)
    },
  )

  it('accepts those same fields on the Owner-only Forsiden schema', () => {
    expect(homeDraft.input.safeParse(OWNER_ONLY_HOME_FIELDS).success).toBe(true)
  })

  it('keeps the three Owner-only entities marked Owner-only in the registry', () => {
    const ownerOnly = Object.entries(PUBLISHABLE_ENTITIES)
      .filter(([, entity]) => entity.requiredRole === 'owner')
      .map(([key]) => key)
      .sort()

    expect(ownerOnly).toEqual(['opening_hours', 'page:home', 'site_contact'])
  })
})

describe('immediate-path fields are not draft fields', () => {
  /**
   * Udsolgt, hide-the-announcement and soft delete write straight to the live value
   * with a 10 s Fortryd (§6). None of them is an edit, so none of them may travel
   * through a draft — a request that tries is refused rather than ignored.
   */
  it('a dish draft refuses sold_out_on, deleted_at and is_new_draft', () => {
    expect(dishDraft.input.safeParse({ sold_out_on: '2026-08-29' }).success).toBe(false)
    expect(dishDraft.input.safeParse({ deleted_at: '2026-08-29T10:00:00+00:00' }).success).toBe(false)
    expect(dishDraft.input.safeParse({ is_new_draft: false }).success).toBe(false)
  })

  it('a weekly-special draft refuses both sold-out fields', () => {
    expect(weeklySpecialDraft.input.safeParse({ sold_out_on: '2026-08-29' }).success).toBe(false)
    expect(weeklySpecialDraft.input.safeParse({ sat_sold_out_on: '2026-08-29' }).success).toBe(false)
  })

  it('a monthly-burger draft refuses sold_out_on', () => {
    expect(monthlyBurgerDraft.input.safeParse({ sold_out_on: '2026-08-29' }).success).toBe(false)
  })

  it('an announcement draft refuses is_visible, source and previous', () => {
    expect(announcementDraft.input.safeParse({ is_visible: true }).success).toBe(false)
    expect(announcementDraft.input.safeParse({ source: 'manual' }).success).toBe(false)
    expect(announcementDraft.input.safeParse({ previous: {} }).success).toBe(false)
  })

  it('a menu-section draft refuses slug, kind and visible', () => {
    expect(menuCategoryDraft.input.safeParse({ slug: 'burgere' }).success).toBe(false)
    expect(menuCategoryDraft.input.safeParse({ kind: 'dishes' }).success).toBe(false)
    expect(menuCategoryDraft.input.safeParse({ visible: false }).success).toBe(false)
  })

  it('a page draft refuses published, and the Forside and Om os refuse is_visible', () => {
    expect(takeawayDraft.input.safeParse({ published: {} }).success).toBe(false)
    expect(homeDraft.input.safeParse({ is_visible: false }).success).toBe(false)
    expect(aboutDraft.input.safeParse({ is_visible: false }).success).toBe(false)
  })

  it('Mad ud af huset carries its switch as a draft field — a boolean, and nothing else (phase 11B)', () => {
    // 1aj: "alt gemmes som kladde … går først live ved Offentliggør" — the switch
    // included. It is not an immediate-path field, so it is a draft field.
    expect(takeawayDraft.input.safeParse({ is_visible: false }).success).toBe(true)
    expect(takeawayDraft.input.safeParse({ is_visible: true }).success).toBe(true)
    for (const value of ['false', 0, 1, null, 'ja', { on: true }]) {
      expect(takeawayDraft.input.safeParse({ is_visible: value }).success, JSON.stringify(value)).toBe(false)
    }
  })
})

describe('the Forside\'s image slots are part of a whole section (phase 11A)', () => {
  const IMAGE = '55555555-5555-4555-8555-555555555555'

  it('a section without its image key is refused — the shallow merge would drop the live photo', () => {
    expect(homeDraft.input.safeParse({ hero: { heading: 'x', intro: null } }).success).toBe(false)
    expect(homeDraft.input.safeParse({ award: { title: 'x', text: null } }).success).toBe(false)
    expect(homeDraft.input.safeParse({ about_excerpt: { heading: null, text: 'x' } }).success).toBe(false)
  })

  it('accepts a uuid or null, and refuses a path, a URL or an object where the id should be', () => {
    expect(homeDraft.input.safeParse({ hero: { heading: 'x', intro: null, image_id: IMAGE } }).success).toBe(true)
    expect(homeDraft.input.safeParse({ hero: { heading: 'x', intro: null, image_id: null } }).success).toBe(true)

    for (const value of ['abc/original.jpg', 'https://example.test/foto.webp', { id: IMAGE }, '']) {
      expect(
        homeDraft.input.safeParse({ hero: { heading: 'x', intro: null, image_id: value } }).success,
        JSON.stringify(value),
      ).toBe(false)
    }
  })

  it('refuses a storage path, derivative, alt text or filename inside a section — a smuggled key is a refusal, not a deletion', () => {
    // The top level has always been strict (an unknown *section* is a refusal). Since
    // the 11A completion pass the sections are strict too: nothing but the id can
    // reach the draft, and a request that tries is told so rather than quietly trimmed.
    for (const key of ['storage_path', 'alt_text', 'derivatives', 'original_filename', 'url']) {
      const result = homeDraft.input.safeParse({
        hero: { heading: 'x', intro: null, image_id: null, [key]: 'x' },
      })
      expect(result.success, key).toBe(false)
      expect(
        result.error?.issues.some(
          (issue) => issue.code === 'unrecognized_keys' && issue.path.join('.') === 'hero',
        ),
        key,
      ).toBe(true)
    }
  })

  it('a stored draft written before the image keys existed is malformed rather than half-applied', () => {
    expect(homeDraft.stored.safeParse({ hero: { heading: 'Gammel', intro: null } }).success).toBe(false)
  })

  it('refuses the same featured dish twice, and a fourth', () => {
    const a = '11111111-1111-4111-8111-111111111111'
    const b = '22222222-2222-4222-8222-222222222222'
    expect(homeDraft.input.safeParse({ featured_dish_ids: [a, a] }).success).toBe(false)
    expect(homeDraft.input.safeParse({ featured_dish_ids: [a, b, IMAGE, '44444444-4444-4444-8444-444444444444'] }).success).toBe(false)
    expect(homeDraft.input.safeParse({ featured_dish_ids: [a, b] }).success).toBe(true)
  })
})

describe('the Forside\'s sections are strict objects (phase 11A completion pass)', () => {
  /**
   * Why this block exists: `defineDraft` makes the top level strict, but a nested
   * `z.object()` strips unknown keys by default, so until this pass a section could
   * carry an extra key and lose it silently. The document contract is "refuse", at
   * every level a browser can write — so every section is asserted here on its own,
   * on both parses, with the fields the editor actually produces.
   */
  const IMAGE = '55555555-5555-4555-8555-555555555555'
  const DISH_A = '11111111-1111-4111-8111-111111111111'
  const DISH_B = '22222222-2222-4222-8222-222222222222'
  const DISH_C = '33333333-3333-4333-8333-333333333333'

  /** One complete, legitimate value per section — exactly what the 1u editor submits. */
  const VALID_SECTIONS = {
    hero: { heading: 'Burgeren der vandt Fyn', intro: 'To linjer om stedet.', image_id: IMAGE },
    award: { title: 'Vinder af Fyn & Øer', text: 'Danmarks Bedste Burger 2026.', image_id: null },
    about_excerpt: { heading: 'Lokal burgerbar', text: 'Tre linjer om restauranten.', image_id: IMAGE },
  } as const

  const SECTION_KEYS = Object.keys(VALID_SECTIONS) as (keyof typeof VALID_SECTIONS)[]

  it.each(SECTION_KEYS)('a valid %s plus one unexpected key is refused on the way in', (section) => {
    const result = homeDraft.input.safeParse({
      [section]: { ...VALID_SECTIONS[section], unexpected_key: 'x' },
    })

    expect(result.success).toBe(false)
    expect(
      result.error?.issues.some(
        (issue) => issue.code === 'unrecognized_keys' && issue.path.join('.') === section,
      ),
    ).toBe(true)
  })

  it.each(SECTION_KEYS)('a stored %s with an unexpected key is malformed, not half-applied', (section) => {
    // The read path is what `overlayDraft` (editor, preview) and `storedDraftIsValid`
    // (publish) parse with. A section written past the application with an extra key
    // is therefore `malformed` on screen and `invalid_draft` at publish — never merged.
    const result = homeDraft.stored.safeParse({
      [section]: { ...VALID_SECTIONS[section], unexpected_key: 'x' },
    })

    expect(result.success).toBe(false)
  })

  it.each(SECTION_KEYS)('%s refuses a smuggled image detail beside its id', (section) => {
    for (const key of ['storage_path', 'alt_text', 'derivatives', 'original_filename', 'url', 'width']) {
      expect(
        homeDraft.input.safeParse({ [section]: { ...VALID_SECTIONS[section], [key]: 'x' } }).success,
        key,
      ).toBe(false)
    }
  })

  it.each(SECTION_KEYS)('%s refuses a key that belongs to a sibling section', (section) => {
    // `intro` is the hero's word, `title` is the award's; a section that carries the
    // other's key is a shape no editor produces.
    const foreign = section === 'hero' ? 'title' : 'intro'

    expect(
      homeDraft.input.safeParse({ [section]: { ...VALID_SECTIONS[section], [foreign]: 'x' } }).success,
    ).toBe(false)
  })

  it('the featured list has no object of its own: an object where the array belongs, or objects inside it, are refused', () => {
    expect(homeDraft.input.safeParse({ featured_dish_ids: { ids: [DISH_A] } }).success).toBe(false)
    expect(homeDraft.input.safeParse({ featured_dish_ids: [{ id: DISH_A }] }).success).toBe(false)
    expect(
      homeDraft.input.safeParse({ featured_dish_ids: [DISH_A, { id: DISH_B, name: 'Frigg' }] }).success,
    ).toBe(false)
  })

  it('every legitimate field still parses, and a legitimate document comes back unaltered', () => {
    const document = {
      ...VALID_SECTIONS,
      featured_dish_ids: [DISH_A, DISH_B, DISH_C],
    }

    expect(homeDraft.input.parse(document)).toEqual(document)
    expect(homeDraft.stored.parse(document)).toEqual(document)
  })

  it('a document with every text cleared and no images comes back unaltered too', () => {
    const cleared = {
      hero: { heading: null, intro: null, image_id: null },
      award: { title: null, text: null, image_id: null },
      featured_dish_ids: [],
      about_excerpt: { heading: null, text: null, image_id: null },
    }

    expect(homeDraft.input.parse(cleared)).toEqual(cleared)
    expect(homeDraft.stored.parse(cleared)).toEqual(cleared)
  })

  it.each(SECTION_KEYS)('%s keeps its image slot: null and a uuid pass, anything else is refused', (section) => {
    const valid = VALID_SECTIONS[section]

    expect(homeDraft.input.parse({ [section]: { ...valid, image_id: null } })).toEqual({
      [section]: { ...valid, image_id: null },
    })
    expect(homeDraft.input.parse({ [section]: { ...valid, image_id: IMAGE } })).toEqual({
      [section]: { ...valid, image_id: IMAGE },
    })

    for (const value of ['abc/original.jpg', '', 42, { id: IMAGE }, [IMAGE]]) {
      expect(
        homeDraft.input.safeParse({ [section]: { ...valid, image_id: value } }).success,
        JSON.stringify(value),
      ).toBe(false)
    }
  })

  it('a single-section draft — the shape every Gem writes — still parses and carries only that section', () => {
    for (const section of SECTION_KEYS) {
      const parsed = homeDraft.input.parse({ [section]: VALID_SECTIONS[section] })

      expect(parsed).toEqual({ [section]: VALID_SECTIONS[section] })
      expect(Object.keys(parsed)).toEqual([section])
    }
  })

  it('the top-level read path still drops an unknown *section* rather than refusing it', () => {
    // Unchanged on purpose: the section list is the phase-4 allow-list, and a stored
    // draft that names a section this schema has never had is ignored, not thrown at
    // a staff member. Only the keys *inside* a known section became refusals.
    expect(homeDraft.stored.parse({ noget_helt_andet: { x: 1 }, hero: VALID_SECTIONS.hero })).toEqual({
      hero: VALID_SECTIONS.hero,
    })
  })
})

describe("Mad ud af huset's sections are strict objects (phase 11B)", () => {
  /**
   * The phase-11A completion pass found `takeawayDraft.sections[]` stripping unknown
   * nested keys rather than refusing them. Phase 11B owns the schema, so the
   * sections are `z.strictObject` now, on both parses — a smuggled key is a refusal
   * on the way in, and `malformed` / `invalid_draft` on the way out. The seed's own
   * shape (`afsnit-1`, heading, body, sort) is exactly what still parses.
   */
  const IMAGE = '55555555-5555-4555-8555-555555555555'

  const SEEDED_SECTIONS = [
    { id: 'afsnit-1', heading: 'Overskrift på tekstafsnit', body: 'Placeholder ét.', sort: 1 },
    { id: 'afsnit-2', heading: 'Overskrift på tekstafsnit', body: 'Placeholder to.', sort: 2 },
  ]

  it('the seeded document, and a document with every field, parse unaltered on both paths', () => {
    const document = {
      heading: 'Mad til fester og store selskaber',
      intro: 'Vi laver mad ud af huset.',
      image_id: IMAGE,
      sections: SEEDED_SECTIONS,
      cta_label: 'Ring og hør mere',
      is_visible: false,
    }

    expect(takeawayDraft.input.parse(document)).toEqual(document)
    expect(takeawayDraft.stored.parse(document)).toEqual(document)
    expect(takeawayDraft.input.parse({ sections: SEEDED_SECTIONS })).toEqual({ sections: SEEDED_SECTIONS })
  })

  it.each(['price', 'storage_path', 'alt_text', 'image_id', 'html', 'url', 'minimum'])(
    'a section carrying "%s" is refused on the way in, naming the section',
    (key) => {
      const result = takeawayDraft.input.safeParse({
        sections: [{ ...SEEDED_SECTIONS[0], [key]: 'x' }],
      })

      expect(result.success).toBe(false)
      expect(
        result.error?.issues.some(
          (issue) => issue.code === 'unrecognized_keys' && issue.path.join('.') === 'sections.0',
        ),
        key,
      ).toBe(true)
    },
  )

  it('a stored section with an unexpected key is malformed, not half-applied', () => {
    // The read path is what `overlayDraft` (editor, preview) and `storedDraftIsValid`
    // (publish) parse with. A section written past the application with an extra key
    // is therefore `malformed` on screen and `invalid_draft` at publish — never merged.
    expect(
      takeawayDraft.stored.safeParse({
        sections: [SEEDED_SECTIONS[0], { ...SEEDED_SECTIONS[1], price_ore: 4900 }],
      }).success,
    ).toBe(false)
  })

  it('a section missing one of its four keys, or with an object where text belongs, is refused', () => {
    expect(takeawayDraft.input.safeParse({ sections: [{ id: 'a', heading: 'x', body: null }] }).success).toBe(false)
    expect(
      takeawayDraft.input.safeParse({ sections: [{ id: 'a', heading: { text: 'x' }, body: null, sort: 1 }] }).success,
    ).toBe(false)
    expect(takeawayDraft.input.safeParse({ sections: [{ id: '', heading: null, body: null, sort: 1 }] }).success).toBe(
      false,
    )
  })

  it('refuses a twenty-first section, and keeps the top level strict', () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ id: `afsnit-${index + 1}`, heading: null, body: null, sort: index + 1 }))
    expect(takeawayDraft.input.safeParse({ sections: many }).success).toBe(false)
    expect(takeawayDraft.input.safeParse({ sections: [], packages: [] }).success).toBe(false)
  })

  it('the image slot accepts a uuid or null and refuses a path, a URL or an object', () => {
    expect(takeawayDraft.input.safeParse({ image_id: IMAGE }).success).toBe(true)
    expect(takeawayDraft.input.safeParse({ image_id: null }).success).toBe(true)
    for (const value of ['abc/original.jpg', 'https://example.test/foto.webp', { id: IMAGE }, '']) {
      expect(takeawayDraft.input.safeParse({ image_id: value }).success, JSON.stringify(value)).toBe(false)
    }
  })

  it('the top-level read path still drops an unknown *key* rather than refusing it', () => {
    expect(takeawayDraft.stored.parse({ noget_helt_andet: 1, cta_label: 'Ring' })).toEqual({ cta_label: 'Ring' })
  })
})

describe("Om os's document is strict at every level (phase 14B1 — the §0aa carry-forward closed)", () => {
  /**
   * Phase 11B's completion pass recorded that `aboutDraft.team` and `aboutDraft.method`
   * were still ordinary `z.object()`s — stripping an unknown nested key rather than
   * refusing it — and left the closure to the phase that built 1i's editor. This block
   * is that closure: both sections are strict on both parses, the three image slots are
   * ids or null and nothing else, and the document the editor writes parses unaltered.
   */
  const IMAGE = '66666666-6666-4666-8666-666666666666'

  const DOCUMENT = {
    heading: 'Vores historie',
    story_blocks: ['Første afsnit.', 'Andet afsnit.'],
    venue_image_id: IMAGE,
    team: { text: 'Holdet bag disken.', image_id: IMAGE },
    method: { heading: 'Sådan laver vi burgere', text: 'Råvarer, brød og tilberedning.', image_id: null },
  }

  it('the whole document, and a document with every text cleared, parse unaltered on both paths', () => {
    expect(aboutDraft.input.parse(DOCUMENT)).toEqual(DOCUMENT)
    expect(aboutDraft.stored.parse(DOCUMENT)).toEqual(DOCUMENT)

    const cleared = {
      heading: null,
      story_blocks: [],
      venue_image_id: null,
      team: { text: null, image_id: null },
      method: { heading: null, text: null, image_id: null },
    }
    expect(aboutDraft.input.parse(cleared)).toEqual(cleared)
    expect(aboutDraft.stored.parse(cleared)).toEqual(cleared)
  })

  it('a single-key or single-section draft — the shape every Gem writes — parses and carries only that key', () => {
    for (const key of Object.keys(DOCUMENT) as (keyof typeof DOCUMENT)[]) {
      const parsed = aboutDraft.input.parse({ [key]: DOCUMENT[key] })
      expect(Object.keys(parsed)).toEqual([key])
    }
  })

  it.each(['team', 'method'] as const)('a valid %s plus one unexpected nested key is refused on the way in, naming the section', (section) => {
    for (const key of ['storage_path', 'alt_text', 'derivatives', 'url', 'name', 'role', 'html']) {
      const result = aboutDraft.input.safeParse({ [section]: { ...DOCUMENT[section], [key]: 'x' } })
      expect(result.success, key).toBe(false)
      expect(
        result.error?.issues.some(
          (issue) => issue.code === 'unrecognized_keys' && issue.path.join('.') === section,
        ),
        key,
      ).toBe(true)
    }
  })

  it.each(['team', 'method'] as const)('a stored %s with an unexpected key is malformed, not half-applied', (section) => {
    // The read path is what `overlayDraft` (editor, preview) and `storedDraftIsValid`
    // (publish) parse with: a section written past the application is `malformed` on
    // screen and `invalid_draft` at publish — never merged.
    expect(aboutDraft.stored.safeParse({ [section]: { ...DOCUMENT[section], smuglet: 1 } }).success).toBe(false)
  })

  it('a section without its image key is refused — the shallow merge would drop the live photo', () => {
    expect(aboutDraft.input.safeParse({ team: { text: 'x' } }).success).toBe(false)
    expect(aboutDraft.input.safeParse({ method: { heading: 'x', text: null } }).success).toBe(false)
    // A stored draft the retired phase-4 editor wrote is exactly this shape.
    expect(aboutDraft.stored.safeParse({ heading: 'x', method: { heading: 'Gammel', text: null } }).success).toBe(false)
  })

  it('a key that belongs to a sibling section is refused', () => {
    expect(aboutDraft.input.safeParse({ team: { ...DOCUMENT.team, heading: 'x' } }).success).toBe(false)
    expect(aboutDraft.input.safeParse({ method: { ...DOCUMENT.method, story_blocks: [] } }).success).toBe(false)
  })

  it.each([
    ['venue_image_id', (value: unknown) => ({ venue_image_id: value })],
    ['team.image_id', (value: unknown) => ({ team: { ...DOCUMENT.team, image_id: value } })],
    ['method.image_id', (value: unknown) => ({ method: { ...DOCUMENT.method, image_id: value } })],
  ] as const)('%s accepts a uuid or null and refuses a path, a URL, an object, a number or an empty string', (_name, at) => {
    expect(aboutDraft.input.safeParse(at(IMAGE)).success).toBe(true)
    expect(aboutDraft.input.safeParse(at(null)).success).toBe(true)
    for (const value of ['abc/original.jpg', 'https://example.test/foto.webp', { id: IMAGE }, 42, '', [IMAGE]]) {
      expect(aboutDraft.input.safeParse(at(value)).success, JSON.stringify(value)).toBe(false)
      expect(aboutDraft.stored.safeParse(at(value)).success, JSON.stringify(value)).toBe(false)
    }
  })

  it('the story is at most ten paragraphs of at most two thousand characters, and nothing but text', () => {
    expect(aboutDraft.input.safeParse({ story_blocks: Array.from({ length: 10 }, () => 'x'.repeat(2000)) }).success).toBe(true)
    expect(aboutDraft.input.safeParse({ story_blocks: Array.from({ length: 11 }, () => 'x') }).success).toBe(false)
    expect(aboutDraft.input.safeParse({ story_blocks: ['x'.repeat(2001)] }).success).toBe(false)
    expect(aboutDraft.input.safeParse({ story_blocks: [{ text: 'x' }] }).success).toBe(false)
    expect(aboutDraft.input.safeParse({ story_blocks: 'ét afsnit' }).success).toBe(false)
  })

  it('refuses an award key — the award is the Forside\'s and the confirmed result\'s, not this document\'s', () => {
    expect(aboutDraft.input.safeParse({ award_image_id: IMAGE }).success).toBe(false)
    expect(aboutDraft.input.safeParse({ award: { title: 'x', text: null, image_id: null } }).success).toBe(false)
  })

  it('the top-level read path still drops an unknown *key* rather than refusing it', () => {
    expect(aboutDraft.stored.parse({ noget_helt_andet: 1, heading: 'Vores historie' })).toEqual({ heading: 'Vores historie' })
  })
})

describe('malformed values are refused with a Danish message', () => {
  it('refuses a price that is not a whole number of øre', () => {
    const result = dishDraft.input.safeParse({ price_ore: 129.5 })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('Prisen')
  })

  it('refuses a price outside the range the database allows', () => {
    expect(dishDraft.input.safeParse({ price_ore: -1 }).success).toBe(false)
    expect(dishDraft.input.safeParse({ price_ore: 1_000_001 }).success).toBe(false)
  })

  it('refuses an empty name but accepts an empty description', () => {
    expect(dishDraft.input.safeParse({ name: '   ' }).success).toBe(false)
    expect(dishDraft.input.parse({ description: '   ' })).toEqual({ description: null })
  })

  it('trims text and treats a blank field as absent content', () => {
    expect(dishDraft.input.parse({ name: '  Thor  ' })).toEqual({ name: 'Thor' })
  })

  it('refuses more than four labels, and duplicates', () => {
    expect(dishDraft.input.safeParse({ labels: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false)
    expect(dishDraft.input.safeParse({ labels: ['Populær', 'Populær'] }).success).toBe(false)
    expect(dishDraft.input.safeParse({ labels: ['Populær', 'Ny'] }).success).toBe(true)
  })

  it('refuses a non-https announcement link and accepts an https one', () => {
    expect(announcementDraft.input.safeParse({ link_url: 'http://usikkert.test' }).success).toBe(
      false,
    )
    expect(
      announcementDraft.input.safeParse({ link_url: 'javascript:alert(1)' }).success,
    ).toBe(false)
    expect(announcementDraft.input.safeParse({ link_url: 'https://sikkert.test/side' }).success).toBe(
      true,
    )
  })

  it('accepts only our own routes as an internal announcement link', () => {
    for (const page of ANNOUNCEMENT_LINK_PAGES) {
      expect(announcementDraft.input.safeParse({ link_page: page }).success, page).toBe(true)
    }

    expect(announcementDraft.input.safeParse({ link_page: '/admin' }).success).toBe(false)
    expect(announcementDraft.input.safeParse({ link_page: '//andet.test' }).success).toBe(false)
  })

  it('refuses a phone number that is not one', () => {
    expect(siteContactDraft.input.safeParse({ primary_phone: 'ring til os' }).success).toBe(false)
    expect(siteContactDraft.input.safeParse({ primary_phone: '+45 63 90 83 00' }).success).toBe(true)
  })

  it('refuses an email address that is not one', () => {
    expect(siteContactDraft.input.safeParse({ email: 'ikke en adresse' }).success).toBe(false)
    expect(siteContactDraft.input.safeParse({ email: 'hej@klingenberg.test' }).success).toBe(true)
  })
})

describe('the tapas document keeps its fixed shape (decision 3)', () => {
  const validGroups = [
    { id: 'base', heading: 'Fast indhold', mode: 'fixed', choose: null, items: ['Oliven'] },
    { id: 'choose7', heading: 'Vælg 7', mode: 'choose', choose: 7, items: [] },
    { id: 'dressing', heading: 'Vælg 3 dressinger', mode: 'choose', choose: 3, items: [] },
  ]

  it('accepts the three fixed groups in order', () => {
    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups: validGroups }).success).toBe(true)
  })

  it('refuses a group id that is not one of the three', () => {
    const groups = [{ ...validGroups[0], id: 'ekstra' }, validGroups[1], validGroups[2]]

    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups }).success).toBe(false)
  })

  it('refuses the wrong number of groups', () => {
    expect(
      tapasDetailsSchema.safeParse({ kind: 'tapas', groups: validGroups.slice(0, 2) }).success,
    ).toBe(false)
  })

  it('refuses the right groups in the wrong order', () => {
    const groups = [validGroups[1], validGroups[0], validGroups[2]]

    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups }).success).toBe(false)
  })

  it('refuses a fourth group, even when the first three are right', () => {
    const groups = [
      ...validGroups,
      { id: 'base', heading: 'Ekstra', mode: 'fixed', choose: null, items: [] },
    ]

    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups }).success).toBe(false)
  })

  it('refuses a changed choose count — "Vælg 7" cannot become "Vælg 12"', () => {
    const groups = [validGroups[0], { ...validGroups[1], choose: 12 }, validGroups[2]]

    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups }).success).toBe(false)
  })

  it('refuses a changed mode', () => {
    const groups = [{ ...validGroups[0], mode: 'choose', choose: 2 }, validGroups[1], validGroups[2]]

    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups }).success).toBe(false)
  })

  it('refuses a choose count on the fixed group', () => {
    const groups = [{ ...validGroups[0], choose: 3 }, validGroups[1], validGroups[2]]

    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups }).success).toBe(false)
  })

  it('accepts the seeded shape, where the fixed group omits `choose` entirely', () => {
    const groups = [
      { id: 'base', heading: 'På bordet — altid med', mode: 'fixed', items: ['Oliven'] },
      validGroups[1],
      validGroups[2],
    ]

    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups }).success).toBe(true)
  })

  it('refuses a blank item and one that is too long, rather than trimming them away', () => {
    const blank = [{ ...validGroups[0], items: ['Oliven', '   '] }, validGroups[1], validGroups[2]]
    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups: blank }).success).toBe(false)

    const long = [
      { ...validGroups[0], items: ['x'.repeat(121)] },
      validGroups[1],
      validGroups[2],
    ]
    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups: long }).success).toBe(false)
  })

  it('refuses a blank heading and a list of more than sixty items', () => {
    const heading = [{ ...validGroups[0], heading: '  ' }, validGroups[1], validGroups[2]]
    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups: heading }).success).toBe(false)

    const many = [
      { ...validGroups[0], items: Array.from({ length: 61 }, (_, index) => `Punkt ${index}`) },
      validGroups[1],
      validGroups[2],
    ]
    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups: many }).success).toBe(false)
  })

  it('refuses an unknown key inside a group', () => {
    const groups = [{ ...validGroups[0], pris_ore: 4900 }, validGroups[1], validGroups[2]]

    expect(tapasDetailsSchema.safeParse({ kind: 'tapas', groups }).success).toBe(false)
  })

  it('is reachable as a dish draft field, and clearable with null', () => {
    expect(
      dishDraft.input.safeParse({ details: { kind: 'tapas', groups: validGroups } }).success,
    ).toBe(true)
    expect(dishDraft.input.safeParse({ details: null }).success).toBe(true)
    expect(dishDraft.input.safeParse({ details: { kind: 'andet' } }).success).toBe(false)
  })
})

describe('the opening-hours document matches what the database will accept', () => {
  const closed = { closed: true } as const
  const open = { from: '15:00', to: '20:00' } as const

  const schedule = {
    mon: closed,
    tue: closed,
    wed: open,
    thu: open,
    fri: open,
    sat: { from: '17:00', to: '20:00' },
    sun: { from: '17:00', to: '20:00' },
  }

  it('accepts the confirmed weekly schedule', () => {
    expect(weeklyScheduleSchema.safeParse(schedule).success).toBe(true)
    expect(openingHoursDraft.input.safeParse({ schedule }).success).toBe(true)
  })

  it('refuses a schedule that is missing a day, or has an extra one', () => {
    const missing: Record<string, unknown> = { ...schedule }
    delete missing.sun

    expect(weeklyScheduleSchema.safeParse(missing).success).toBe(false)
    expect(weeklyScheduleSchema.safeParse({ ...schedule, hverdag: closed }).success).toBe(false)
  })

  it('refuses a closing time that is not after the opening time', () => {
    expect(
      weeklyScheduleSchema.safeParse({ ...schedule, wed: { from: '20:00', to: '15:00' } }).success,
    ).toBe(false)
    expect(
      weeklyScheduleSchema.safeParse({ ...schedule, wed: { from: '15:00', to: '15:00' } }).success,
    ).toBe(false)
  })

  it('refuses a time that is not a wall-clock reading', () => {
    expect(
      weeklyScheduleSchema.safeParse({ ...schedule, wed: { from: '15', to: '20:00' } }).success,
    ).toBe(false)
    expect(
      weeklyScheduleSchema.safeParse({ ...schedule, wed: { from: '24:00', to: '25:00' } }).success,
    ).toBe(false)
  })

  it('refuses a day that is neither closed nor a pair of times', () => {
    expect(weeklyScheduleSchema.safeParse({ ...schedule, mon: { closed: false } }).success).toBe(
      false,
    )
    expect(
      weeklyScheduleSchema.safeParse({ ...schedule, mon: { closed: true, from: '10:00' } }).success,
    ).toBe(false)
  })
})

describe('a page section must be submitted whole', () => {
  /**
   * Publishing merges a page draft over the published document shallowly, so a section
   * that arrives half-filled would blank the half it left out. The schema refuses it
   * instead.
   */
  it('refuses a hero that carries only one of its two keys', () => {
    expect(homeDraft.input.safeParse({ hero: { heading: 'Ny' } }).success).toBe(false)
  })

  it('accepts a complete hero, including an explicitly empty intro and no image', () => {
    expect(
      homeDraft.input.safeParse({ hero: { heading: 'Ny', intro: null, image_id: null } }).success,
    ).toBe(true)
  })

  it('accepts a draft that carries one section and leaves the others out', () => {
    const parsed = homeDraft.input.parse({ hero: { heading: 'Ny', intro: null, image_id: null } })

    expect(Object.hasOwn(parsed, 'award')).toBe(false)
  })
})
