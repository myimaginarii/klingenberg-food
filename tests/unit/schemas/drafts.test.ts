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
    hero: { heading: 'Overtaget', intro: null },
    award: { title: 'Overtaget', text: null },
    featured_dish_ids: ['44444444-4444-4444-8444-444444444444'],
    about_excerpt: { heading: null, text: 'Overtaget' },
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

  it('a page draft refuses is_visible and published', () => {
    expect(takeawayDraft.input.safeParse({ is_visible: false }).success).toBe(false)
    expect(takeawayDraft.input.safeParse({ published: {} }).success).toBe(false)
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

  it('accepts a complete hero, including an explicitly empty intro', () => {
    expect(homeDraft.input.safeParse({ hero: { heading: 'Ny', intro: null } }).success).toBe(true)
  })

  it('accepts a draft that carries one section and leaves the others out', () => {
    const parsed = homeDraft.input.parse({ hero: { heading: 'Ny', intro: null } })

    expect(Object.hasOwn(parsed, 'award')).toBe(false)
  })
})
