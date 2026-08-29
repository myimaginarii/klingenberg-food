import { describe, expect, it } from 'vitest'

import { CACHE_TAGS, type CacheTag } from '@/lib/cache/tags'
import {
  ENTITY_KEYS,
  PUBLISHABLE_ENTITIES,
  entityKeySchema,
  isEntityKey,
  publishableEntity,
  type EntityKey,
} from '@/lib/publishing/entities'
import { locateEntityRow } from '@/lib/publishing/locate'
import {
  decodePublishSelection,
  encodePublishSelection,
  publishRequestSchema,
} from '@/lib/publishing/requests'
import { PREVIEW_TARGETS, previewPath, previewTargetForEntity } from '@/lib/drafts/targets'

/**
 * The publish registry — technical plan §5, §6.
 *
 * The registry is data, and data that is wrong is wrong silently. These tests are the
 * reason it cannot be: the role matrix, the cache tags and the entity vocabulary are
 * asserted against §5 and §6 directly, so a row edited carelessly fails a test rather
 * than quietly granting a permission or leaving a page stale.
 */

/** The ten tags §6 names, and no others. */
const PLAN_TAGS: CacheTag[] = [
  'menu',
  'weekly',
  'monthly',
  'news',
  'announcement',
  'hours',
  'contact',
  'page:home',
  'page:takeaway',
  'page:about',
]

describe('the cache tags are exactly the ones the plan names', () => {
  it('declares the ten tags from §6 and nothing else', () => {
    expect(Object.values(CACHE_TAGS).sort()).toEqual([...PLAN_TAGS].sort())
  })

  it('maps every entity to tags drawn from that list', () => {
    for (const key of ENTITY_KEYS) {
      const tags = publishableEntity(key).cacheTags

      expect(tags.length, key).toBeGreaterThan(0)
      for (const tag of tags) {
        expect(PLAN_TAGS, `${key} → ${tag}`).toContain(tag)
      }
    }
  })

  it('maps each entity to the tags its content actually appears in', () => {
    const expected: Record<EntityKey, CacheTag[]> = {
      'page:home': ['page:home'],
      'page:takeaway': ['page:takeaway'],
      'page:about': ['page:about'],
      site_contact: ['contact'],
      opening_hours: ['hours'],
      announcement: ['announcement'],
      menu_category: ['menu'],
      dish: ['menu'],
      weekly_special: ['weekly'],
      monthly_burger: ['monthly'],
      news: ['news'],
      opening_hours_override: ['hours'],
    }

    for (const key of ENTITY_KEYS) {
      expect([...publishableEntity(key).cacheTags], key).toEqual(expected[key])
    }
  })

  it('does not expire an unrelated page: publishing Forsiden touches no other tag', () => {
    expect([...publishableEntity('page:home').cacheTags]).toEqual([CACHE_TAGS.homePage])
    expect(publishableEntity('page:home').cacheTags).not.toContain(CACHE_TAGS.menu)
    expect(publishableEntity('page:home').cacheTags).not.toContain(CACHE_TAGS.aboutPage)
  })

  it('gives Ugens ret its own tag rather than expiring the whole menu', () => {
    expect([...publishableEntity('weekly_special').cacheTags]).toEqual([CACHE_TAGS.weekly])
    expect([...publishableEntity('monthly_burger').cacheTags]).toEqual([CACHE_TAGS.monthly])
  })
})

describe('the role matrix in §5 is what the registry says', () => {
  it('reserves the four Owner rows that exist as publishable entities', () => {
    expect(publishableEntity('page:home').requiredRole).toBe('owner')
    expect(publishableEntity('opening_hours').requiredRole).toBe('owner')
    expect(publishableEntity('site_contact').requiredRole).toBe('owner')
  })

  it('leaves everything a person does mid-shift with Staff', () => {
    const staffEntities: EntityKey[] = [
      'page:takeaway',
      'page:about',
      'announcement',
      'menu_category',
      'dish',
      'weekly_special',
      'monthly_burger',
      'news',
      'opening_hours_override',
    ]

    for (const key of staffEntities) {
      expect(publishableEntity(key).requiredRole, key).toBe('staff')
    }
  })
})

describe('an entity name from a browser is parsed, never trusted', () => {
  it('accepts every registered key', () => {
    for (const key of ENTITY_KEYS) {
      expect(entityKeySchema.safeParse(key).success, key).toBe(true)
    }
  })

  it('refuses anything else, including a table name', () => {
    for (const value of ['pages', 'profiles', 'audit_log', 'page:secret', '', '../pages', null]) {
      expect(entityKeySchema.safeParse(value).success, String(value)).toBe(false)
      expect(isEntityKey(value), String(value)).toBe(false)
    }
  })

  it('refuses a prototype key rather than resolving it', () => {
    expect(isEntityKey('constructor')).toBe(false)
    expect(isEntityKey('__proto__')).toBe(false)
  })
})

describe('a publish request carries a version token, and must', () => {
  const valid = {
    entity: 'dish',
    entityId: '55555555-5555-4555-8555-555555555555',
    expectedUpdatedAt: '2026-08-29T12:00:00.123456+00:00',
  }

  it('accepts a well-formed request', () => {
    expect(publishRequestSchema.safeParse(valid).success).toBe(true)
  })

  it('refuses a request with no version token at all', () => {
    expect(
      publishRequestSchema.safeParse({ entity: valid.entity, entityId: valid.entityId }).success,
    ).toBe(false)
  })

  it('refuses a version token that is not a timestamp', () => {
    expect(publishRequestSchema.safeParse({ ...valid, expectedUpdatedAt: 'nu' }).success).toBe(false)
    expect(publishRequestSchema.safeParse({ ...valid, expectedUpdatedAt: '' }).success).toBe(false)
  })

  it('refuses an id that is not a uuid', () => {
    expect(publishRequestSchema.safeParse({ ...valid, entityId: '1 or 1=1' }).success).toBe(false)
  })

  it('refuses an extra field smuggled alongside', () => {
    expect(publishRequestSchema.safeParse({ ...valid, force: true }).success).toBe(false)
  })

  it('survives the round trip through a checkbox value', () => {
    const encoded = encodePublishSelection(valid as never)

    expect(decodePublishSelection(encoded)).toEqual(valid)
  })

  it('drops a checkbox value that was edited in the browser', () => {
    const tampered = [
      'page:home|55555555-5555-4555-8555-555555555555',
      'pages|55555555-5555-4555-8555-555555555555|2026-08-29T12:00:00+00:00',
      'dish|ikke-et-uuid|2026-08-29T12:00:00+00:00',
      'dish|55555555-5555-4555-8555-555555555555|altid',
      'dish|55555555-5555-4555-8555-555555555555|2026-08-29T12:00:00+00:00|ekstra',
      '',
      null,
    ]

    for (const value of tampered) {
      expect(decodePublishSelection(value), String(value)).toBeNull()
    }
  })
})

describe('an entity row is located from the registry, not from the request', () => {
  it('finds a singleton with no filter at all', () => {
    expect(locateEntityRow('site_contact')).toEqual({ table: 'site_contact', filter: null })
  })

  it('finds a page by its literal key', () => {
    expect(locateEntityRow('page:home')).toEqual({
      table: 'pages',
      filter: { column: 'key', value: 'home' },
    })
    expect(locateEntityRow('page:takeaway')?.filter?.value).toBe('takeaway')
  })

  it('requires an id for an entity that has many rows', () => {
    expect(locateEntityRow('dish')).toBeNull()
    expect(locateEntityRow('dish', '66666666-6666-4666-8666-666666666666')).toEqual({
      table: 'dishes',
      filter: { column: 'id', value: '66666666-6666-4666-8666-666666666666' },
    })
  })

  it('ignores an id supplied for a singleton or a keyed row', () => {
    expect(locateEntityRow('site_contact', 'noget')?.filter).toBeNull()
    expect(locateEntityRow('page:about', 'noget')?.filter?.value).toBe('about')
  })

  it('cannot locate an entity that has no draft column', () => {
    expect(locateEntityRow('news', '77777777-7777-4777-8777-777777777777')).toBeNull()
    expect(locateEntityRow('opening_hours_override')).toBeNull()
  })
})

describe('a preview destination is a name from a closed set, never a URL', () => {
  it('resolves each known target to an internal path', () => {
    for (const [key, target] of Object.entries(PREVIEW_TARGETS)) {
      expect(previewPath(key)).toBe(target.path)
      expect(target.path.startsWith('/')).toBe(true)
      expect(target.path.startsWith('//')).toBe(false)
    }
  })

  it('refuses anything that is not one of those names', () => {
    const attempts = [
      'https://andet-sted.test',
      '//andet-sted.test',
      '/admin',
      '/menu',
      '../../etc/passwd',
      'javascript:alert(1)',
      '',
      null,
      undefined,
      42,
    ]

    for (const attempt of attempts) {
      expect(previewPath(attempt), String(attempt)).toBeNull()
    }
  })

  it('offers every entity a page it can be previewed on', () => {
    for (const key of ENTITY_KEYS) {
      const target = previewTargetForEntity(key)

      expect(previewPath(target), key).not.toBeNull()
    }
  })
})

describe('every registered entity is completely described', () => {
  it.each(ENTITY_KEYS)('%s names a label, a publish function and an instance', (key) => {
    const entity = PUBLISHABLE_ENTITIES[key]

    expect(entity.label.length).toBeGreaterThan(0)
    expect(entity.publishFunction.startsWith('publish_')).toBe(true)
    expect(['singleton', 'keyed', 'many']).toContain(entity.instance.kind)
  })

  it('gives the two status-published entities no draft schema, and every other one a draft schema', () => {
    for (const key of ENTITY_KEYS) {
      const expectedDraft = key !== 'news' && key !== 'opening_hours_override'

      expect(PUBLISHABLE_ENTITIES[key].draft !== null, key).toBe(expectedDraft)
    }
  })

  it('uses a document merge only for the three page documents', () => {
    const documentEntities = ENTITY_KEYS.filter(
      (key) => PUBLISHABLE_ENTITIES[key].draft?.shape === 'document',
    ).sort()

    expect(documentEntities).toEqual(['page:about', 'page:home', 'page:takeaway'])
  })
})
