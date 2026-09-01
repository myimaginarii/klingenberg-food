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

const NONE = { dish: 0, weekly: 0, monthly: 0, news: 0 }

describe('cacheTagsForReferenceKind', () => {
  it('maps every kind of image_references onto its entity’s registry tags', () => {
    expect(REFERENCE_KINDS).toEqual(['dish', 'weekly', 'monthly', 'news'])

    expect([...cacheTagsForReferenceKind('dish')]).toEqual([CACHE_TAGS.menu])
    expect([...cacheTagsForReferenceKind('weekly')]).toEqual([CACHE_TAGS.weekly])
    expect([...cacheTagsForReferenceKind('monthly')]).toEqual([CACHE_TAGS.monthly])
    expect([...cacheTagsForReferenceKind('news')]).toEqual([CACHE_TAGS.news])
  })

  it('is the registry’s own answer, not a second list', () => {
    expect(cacheTagsForReferenceKind('dish')).toBe(publishableEntity('dish').cacheTags)
    expect(cacheTagsForReferenceKind('weekly')).toBe(publishableEntity('weekly_special').cacheTags)
    expect(cacheTagsForReferenceKind('monthly')).toBe(publishableEntity('monthly_burger').cacheTags)
    expect(cacheTagsForReferenceKind('news')).toBe(publishableEntity('news').cacheTags)
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
      live: { dish: 2, weekly: 0, monthly: 1, news: 0 },
      draft: NONE,
    })

    expect(tags).toEqual([CACHE_TAGS.menu, CACHE_TAGS.monthly])
  })

  it('draft-only movement expires nothing (brief §19–§21)', () => {
    expect(
      cacheTagsForAffectedReferences({ live: NONE, draft: { dish: 3, weekly: 1, monthly: 1, news: 1 } }),
    ).toEqual([])
  })

  it('an image with both live and pending usage expires for the live usage only', () => {
    expect(
      cacheTagsForAffectedReferences({
        live: { dish: 0, weekly: 0, monthly: 0, news: 1 },
        draft: { dish: 1, weekly: 1, monthly: 0, news: 0 },
      }),
    ).toEqual([CACHE_TAGS.news])
  })

  it('never clears everything: contact, hours and the page documents are not image surfaces', () => {
    const tags = cacheTagsForAffectedReferences({
      live: { dish: 9, weekly: 1, monthly: 1, news: 9 },
      draft: { dish: 9, weekly: 1, monthly: 1, news: 9 },
    })

    expect(tags.sort()).toEqual(
      [CACHE_TAGS.menu, CACHE_TAGS.weekly, CACHE_TAGS.monthly, CACHE_TAGS.news].sort(),
    )
    for (const tag of [CACHE_TAGS.contact, CACHE_TAGS.hours, CACHE_TAGS.homePage, CACHE_TAGS.aboutPage]) {
      expect(tags).not.toContain(tag)
    }
  })
})

describe('affectedReferencesSchema — the RPC’s affected document', () => {
  it('accepts the shape delete_image() and replace_image() return', () => {
    expect(
      affectedReferencesSchema.safeParse({
        live: { dish: 1, weekly: 0, monthly: 0, news: 0 },
        draft: { dish: 0, weekly: 1, monthly: 0, news: 0 },
      }).success,
    ).toBe(true)
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
      ]),
    ).toEqual([CACHE_TAGS.menu, CACHE_TAGS.weekly])
  })

  it('an unreferenced or draft-only image expires nothing', () => {
    expect(cacheTagsForLiveReferences([])).toEqual([])
    expect(cacheTagsForLiveReferences([{ kind: 'monthly', pending: true }])).toEqual([])
  })
})

describe('isReferenceKind', () => {
  it('admits the four kinds and nothing else', () => {
    for (const kind of REFERENCE_KINDS) expect(isReferenceKind(kind)).toBe(true)
    expect(isReferenceKind('page')).toBe(false)
    expect(isReferenceKind(null)).toBe(false)
  })
})
