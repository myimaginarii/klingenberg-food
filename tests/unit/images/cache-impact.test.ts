import { describe, expect, it } from 'vitest'

import { CACHE_TAGS } from '@/lib/cache/tags'
import {
  affectedReferencesSchema,
  cacheTagsForAffectedReferences,
  cacheTagsForLiveReferences,
  cacheTagsForReferenceKind,
  isReferenceKind,
  REFERENCE_KINDS,
} from '@/lib/images/cache-impact'
import { publishableEntity } from '@/lib/publishing/entities'

/**
 * Reference kind → public cache tags — phase 10C-2 (brief §17–§21, §33).
 *
 * The mapping is read from the publishing registry, so the tag a dish's image
 * expires is the tag publishing the dish expires. Live and pending are told apart:
 * a draft-only usage changes no byte a guest is served, and expires nothing.
 */

const NONE = { dish: 0, weekly: 0, monthly: 0, news: 0, 'page:home': 0, 'page:takeaway': 0 }

describe('cacheTagsForReferenceKind', () => {
  it('maps every kind of image_references onto its entity’s registry tags', () => {
    expect(REFERENCE_KINDS).toEqual(['dish', 'weekly', 'monthly', 'news', 'page:home', 'page:takeaway'])

    expect([...cacheTagsForReferenceKind('dish')]).toEqual([CACHE_TAGS.menu])
    expect([...cacheTagsForReferenceKind('weekly')]).toEqual([CACHE_TAGS.weekly])
    expect([...cacheTagsForReferenceKind('monthly')]).toEqual([CACHE_TAGS.monthly])
    expect([...cacheTagsForReferenceKind('news')]).toEqual([CACHE_TAGS.news])
    // The Forside document's own photographs (phase 11A) — one tag, the page's.
    expect([...cacheTagsForReferenceKind('page:home')]).toEqual([CACHE_TAGS.homePage])
    // Mad ud af huset's photograph (phase 11B) — its own tag, and no other.
    expect([...cacheTagsForReferenceKind('page:takeaway')]).toEqual([CACHE_TAGS.takeawayPage])
  })

  it('is the registry’s own answer, not a second list', () => {
    expect(cacheTagsForReferenceKind('dish')).toBe(publishableEntity('dish').cacheTags)
    expect(cacheTagsForReferenceKind('weekly')).toBe(publishableEntity('weekly_special').cacheTags)
    expect(cacheTagsForReferenceKind('monthly')).toBe(publishableEntity('monthly_burger').cacheTags)
    expect(cacheTagsForReferenceKind('news')).toBe(publishableEntity('news').cacheTags)
    expect(cacheTagsForReferenceKind('page:home')).toBe(publishableEntity('page:home').cacheTags)
    expect(cacheTagsForReferenceKind('page:takeaway')).toBe(publishableEntity('page:takeaway').cacheTags)
  })

  it('a dish’s tag covers the Forside’s featured cards as well — one tagged read, one tag', () => {
    // The registry records why: the Forside's three burgers come from the same
    // `menu`-tagged read. No `page:home` expiry is needed, and none is produced.
    expect(cacheTagsForReferenceKind('dish')).not.toContain(CACHE_TAGS.homePage)
  })
})

describe('cacheTagsForAffectedReferences — the trusted transition’s own counts', () => {
  it('expires the tags of the kinds with live rows moved, deduplicated', () => {
    const tags = cacheTagsForAffectedReferences({
      live: { ...NONE, dish: 2, monthly: 1 },
      draft: NONE,
    })

    expect(tags).toEqual([CACHE_TAGS.menu, CACHE_TAGS.monthly])
  })

  it('draft-only movement expires nothing (brief §19–§21)', () => {
    expect(
      cacheTagsForAffectedReferences({
        live: NONE,
        draft: { dish: 3, weekly: 1, monthly: 1, news: 1, 'page:home': 1, 'page:takeaway': 0 },
      }),
    ).toEqual([])
  })

  it('an image with both live and pending usage expires for the live usage only', () => {
    expect(
      cacheTagsForAffectedReferences({
        live: { ...NONE, news: 1 },
        draft: { ...NONE, dish: 1, weekly: 1, 'page:home': 1, 'page:takeaway': 0 },
      }),
    ).toEqual([CACHE_TAGS.news])
  })

  it('a live Forside photograph expires the page:home tag and no other (phase 11A)', () => {
    expect(
      cacheTagsForAffectedReferences({ live: { ...NONE, 'page:home': 1, 'page:takeaway': 0 }, draft: NONE }),
    ).toEqual([CACHE_TAGS.homePage])
  })

  it('never clears everything: contact, hours and the other page documents are not image surfaces', () => {
    const tags = cacheTagsForAffectedReferences({
      live: { dish: 9, weekly: 1, monthly: 1, news: 9, 'page:home': 1, 'page:takeaway': 0 },
      draft: { dish: 9, weekly: 1, monthly: 1, news: 9, 'page:home': 1, 'page:takeaway': 0 },
    })

    expect(tags.sort()).toEqual(
      [CACHE_TAGS.menu, CACHE_TAGS.weekly, CACHE_TAGS.monthly, CACHE_TAGS.news, CACHE_TAGS.homePage].sort(),
    )
    for (const tag of [CACHE_TAGS.contact, CACHE_TAGS.hours, CACHE_TAGS.takeawayPage, CACHE_TAGS.aboutPage]) {
      expect(tags).not.toContain(tag)
    }
  })
})

describe('affectedReferencesSchema — the RPC’s affected document', () => {
  it('accepts the shape delete_image() and replace_image() return', () => {
    expect(
      affectedReferencesSchema.safeParse({
        live: { ...NONE, dish: 1 },
        draft: { ...NONE, weekly: 1 },
      }).success,
    ).toBe(true)
  })

  it('refuses the pre-11A and pre-11B shapes without the page counts — the SQL and the mapping move together', () => {
    expect(
      affectedReferencesSchema.safeParse({
        live: { dish: 1, weekly: 0, monthly: 0, news: 0 },
        draft: { dish: 0, weekly: 0, monthly: 0, news: 0 },
      }).success,
    ).toBe(false)
    expect(
      affectedReferencesSchema.safeParse({
        live: { dish: 1, weekly: 0, monthly: 0, news: 0, 'page:home': 0 },
        draft: { dish: 0, weekly: 0, monthly: 0, news: 0, 'page:home': 0 },
      }).success,
    ).toBe(false)
  })

  it('a live Mad ud af huset photograph expires the page:takeaway tag and no other (phase 11B)', () => {
    expect(
      cacheTagsForAffectedReferences({ live: { ...NONE, 'page:takeaway': 1 }, draft: NONE }),
    ).toEqual([CACHE_TAGS.takeawayPage])
    expect(
      cacheTagsForAffectedReferences({ live: NONE, draft: { ...NONE, 'page:takeaway': 1 } }),
    ).toEqual([])
  })

  it('refuses a missing kind, a negative count and a non-integer', () => {
    expect(affectedReferencesSchema.safeParse({ live: { dish: 1 }, draft: NONE }).success).toBe(false)
    expect(
      affectedReferencesSchema.safeParse({ live: { ...NONE, dish: -1 }, draft: NONE }).success,
    ).toBe(false)
    expect(
      affectedReferencesSchema.safeParse({ live: { ...NONE, dish: 1.5 }, draft: NONE }).success,
    ).toBe(false)
  })
})

describe('cacheTagsForLiveReferences — the alt edit’s post-write read of image_references', () => {
  it('expires the live kinds and skips pending rows', () => {
    expect(
      cacheTagsForLiveReferences([
        { kind: 'dish', pending: false },
        { kind: 'dish', pending: true },
        { kind: 'news', pending: true },
        { kind: 'weekly', pending: false },
        { kind: 'page:home', pending: false },
        { kind: 'page:home', pending: true },
        { kind: 'page:takeaway', pending: true },
      ]),
    ).toEqual([CACHE_TAGS.menu, CACHE_TAGS.weekly, CACHE_TAGS.homePage])
  })

  it('an unreferenced or draft-only image expires nothing', () => {
    expect(cacheTagsForLiveReferences([])).toEqual([])
    expect(cacheTagsForLiveReferences([{ kind: 'monthly', pending: true }])).toEqual([])
  })
})

describe('isReferenceKind', () => {
  it('admits the six kinds and nothing else', () => {
    for (const kind of REFERENCE_KINDS) expect(isReferenceKind(kind)).toBe(true)
    expect(isReferenceKind('page')).toBe(false)
    expect(isReferenceKind(null)).toBe(false)
  })
})
