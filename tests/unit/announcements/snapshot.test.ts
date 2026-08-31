import { describe, expect, it } from 'vitest'

import type { AnnouncementValues } from '@/lib/announcements/lifecycle'
import {
  ANNOUNCEMENT_SOURCES,
  announcementSnapshotFrom,
  isAnnouncementSnapshot,
  isSnapshotShowable,
  parseAnnouncementSnapshot,
  type AnnouncementSnapshot,
} from '@/lib/announcements/snapshot'

/**
 * What `announcement.previous` may hold — technical plan §4, §6; design 1ae.
 *
 * The shape half of phase 8C-1. `supabase/tests/015_announcement_replacement.test.sql`
 * asserts the same eight keys and the same refusals in SQL, from real JWTs, inside the
 * transaction; this is the application's own reading of them, asserted as arithmetic so
 * a change to either has to be a deliberate change to both.
 *
 * The mistakes it exists to catch are the four the brief names:
 *
 *   * a snapshot that could carry a **draft**, which would give a restore a way to make
 *     public something nobody pressed Offentliggør for;
 *   * a snapshot that could carry a **nested previous**, which is a history stack (§4,
 *     1ad: *"intet arkiv … ingen historik"*);
 *   * a snapshot that could carry an **actor id** or a **concurrency token**, both of
 *     which are facts about a write rather than about published content;
 *   * a snapshot that accepts **unknown keys**, which is the same as having no shape.
 */

const A: AnnouncementSnapshot = {
  message: 'Besked A',
  link_type: 'page',
  link_page: '/menu',
  link_url: null,
  link_label: 'Se menuen',
  expires_at: '2026-09-14T18:00:00.000Z',
  is_visible: true,
  source: 'manual',
}

const PUBLISHED: AnnouncementValues = {
  message: 'Besked A',
  link_type: 'page',
  link_page: '/menu',
  link_url: null,
  link_label: 'Se menuen',
  expires_at: '2026-09-14T18:00:00.000Z',
}

describe('the snapshot shape', () => {
  it('is exactly the eight published fields', () => {
    expect(Object.keys(A).sort()).toEqual([
      'expires_at',
      'is_visible',
      'link_label',
      'link_page',
      'link_type',
      'link_url',
      'message',
      'source',
    ])
  })

  it('accepts a snapshot of the published state', () => {
    expect(parseAnnouncementSnapshot(A)).toEqual(A)
  })

  it('accepts the empty state — there was no announcement to displace', () => {
    const empty: AnnouncementSnapshot = {
      message: null,
      link_type: 'none',
      link_page: null,
      link_url: null,
      link_label: null,
      expires_at: null,
      is_visible: false,
      source: 'manual',
    }

    expect(parseAnnouncementSnapshot(empty)).toEqual(empty)
  })

  it('carries the two state fields a restore cannot do without', () => {
    // Without `is_visible` a message switched off would come back switched on; without
    // `source` a generated opening-hours message would come back calling itself manual.
    expect(A.is_visible).toBe(true)
    expect(ANNOUNCEMENT_SOURCES).toEqual(['manual', 'opening_hours'])
  })
})

describe('what is not a snapshot', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'Besked A'],
    ['a number', 7],
    ['an array', [A]],
    ['an empty object', {}],
  ])('refuses %s', (_what, value) => {
    expect(parseAnnouncementSnapshot(value)).toBeNull()
  })

  it('refuses a missing key — a restore would have to guess at it', () => {
    const withoutSource: Record<string, unknown> = { ...A }
    delete withoutSource.source

    expect(parseAnnouncementSnapshot(withoutSource)).toBeNull()
  })

  it('refuses a stashed draft', () => {
    expect(parseAnnouncementSnapshot({ ...A, draft: { message: 'Kladde C' } })).toBeNull()
  })

  it('refuses a nested previous — one level, no recursion', () => {
    expect(parseAnnouncementSnapshot({ ...A, previous: A })).toBeNull()
  })

  it('refuses an actor id', () => {
    expect(
      parseAnnouncementSnapshot({ ...A, updated_by: '00000000-0000-4000-8000-000000000000' }),
    ).toBeNull()
  })

  it.each([['updated_at'], ['replaced_at'], ['created_at'], ['id'], ['is_singleton']])(
    'refuses the unrelated key %s',
    (key) => {
      expect(parseAnnouncementSnapshot({ ...A, [key]: '2026-09-01T00:00:00.000Z' })).toBeNull()
    },
  )

  it('refuses a visibility that is not a boolean', () => {
    expect(parseAnnouncementSnapshot({ ...A, is_visible: 'true' })).toBeNull()
  })

  it('refuses a source outside the closed vocabulary', () => {
    expect(parseAnnouncementSnapshot({ ...A, source: 'kampagne' })).toBeNull()
  })

  it('refuses a message over 90 characters', () => {
    expect(parseAnnouncementSnapshot({ ...A, message: 'x'.repeat(91) })).toBeNull()
  })

  it.each([
    ['an unapproved internal route', { link_type: 'page', link_page: '/admin', link_url: null }],
    ['an http address', { link_type: 'url', link_page: null, link_url: 'http://usikker.test/x' }],
    [
      'a javascript: address',
      { link_type: 'url', link_page: null, link_url: 'javascript:alert(1)' },
    ],
    [
      'a link that is both a page and an address',
      { link_type: 'page', link_page: '/menu', link_url: 'https://andet.test' },
    ],
    ['a page with no link type', { link_type: 'none', link_page: '/menu', link_url: null }],
    ['a url type with no address', { link_type: 'url', link_page: null, link_url: null }],
  ])('refuses %s (§8)', (_what, link) => {
    expect(parseAnnouncementSnapshot({ ...A, ...link })).toBeNull()
  })

  it('refuses an expiry that is not an instant', () => {
    expect(parseAnnouncementSnapshot({ ...A, expires_at: 'i morgen' })).toBeNull()
  })

  it('answers the same question as isAnnouncementSnapshot', () => {
    expect(isAnnouncementSnapshot(A)).toBe(true)
    expect(isAnnouncementSnapshot({ ...A, draft: {} })).toBe(false)
  })
})

describe('building a snapshot from the published row', () => {
  it('takes the published values, the visibility and the source', () => {
    expect(
      announcementSnapshotFrom({ values: PUBLISHED, isVisible: true, source: 'manual' }),
    ).toEqual(A)
  })

  it('preserves a switched-off announcement as switched off', () => {
    // The exact published visibility state of the thing being replaced, so a restore
    // puts it back the way it stood rather than switching it on.
    const hidden = announcementSnapshotFrom({
      values: PUBLISHED,
      isVisible: false,
      source: 'manual',
    })

    expect(hidden.is_visible).toBe(false)
    expect(parseAnnouncementSnapshot(hidden)).toEqual(hidden)
  })

  it('has no parameter through which a draft could arrive', () => {
    // A structural property rather than a behavioural one: the function takes the
    // published values, and there is no argument shaped like a draft.
    const built = announcementSnapshotFrom({
      values: PUBLISHED,
      isVisible: true,
      source: 'opening_hours',
    })

    expect(Object.keys(built).sort()).toEqual(Object.keys(A).sort())
    expect(built.source).toBe('opening_hours')
  })
})

describe('whether a restored snapshot is one a guest could read', () => {
  const BEFORE = new Date('2026-09-14T17:00:00.000Z')
  const AFTER = new Date('2026-09-14T19:00:00.000Z')

  it('is true for a visible, unexpired message', () => {
    expect(isSnapshotShowable(A, BEFORE)).toBe(true)
  })

  it('is false once the expiry has passed — and nothing moves the expiry', () => {
    expect(isSnapshotShowable(A, AFTER)).toBe(false)
    // The rule the brief states in its section 7: restoring an expired announcement is
    // allowed and faithful; it simply produces something a guest cannot see.
    expect(A.expires_at).toBe('2026-09-14T18:00:00.000Z')
  })

  it('is false for a snapshot that was switched off', () => {
    expect(isSnapshotShowable({ ...A, is_visible: false }, BEFORE)).toBe(false)
  })

  it('is false for a snapshot with no message', () => {
    expect(isSnapshotShowable({ ...A, message: null }, BEFORE)).toBe(false)
    expect(isSnapshotShowable({ ...A, message: '   ' }, BEFORE)).toBe(false)
  })

  it('is false for a snapshot with no expiry at all', () => {
    expect(isSnapshotShowable({ ...A, expires_at: null }, BEFORE)).toBe(false)
  })
})
