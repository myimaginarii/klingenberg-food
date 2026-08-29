import { describe, expect, it } from 'vitest'

import type { Profile } from '@/lib/auth/session'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { ENTITY_KEYS, publishableEntity } from '@/lib/publishing/entities'

/**
 * Who may publish what — technical plan §5, §8.
 *
 * The phase brief's global-publish rule in one sentence:
 *
 *     "A global/dashboard publish must not let Staff publish Owner-only content merely
 *      because it appears in a submitted checkbox list."
 *
 * The dashboard calls this per selected item, so these tests are the unit-level half of
 * that rule. The other half is RLS, asserted in supabase/tests/005_publish.test.sql,
 * and the two together are the two independent enforcement points §5 requires.
 */

const owner: Profile = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.test',
  name: 'Lokal Ejer',
  role: 'owner',
  disabledAt: null,
}

const staff: Profile = {
  userId: '22222222-2222-4222-8222-222222222222',
  email: 'staff@example.test',
  name: 'Lokal Medarbejder',
  role: 'staff',
  disabledAt: null,
}

const disabledOwner: Profile = { ...owner, disabledAt: '2026-08-01T10:00:00+00:00' }
const disabledStaff: Profile = { ...staff, disabledAt: '2026-08-01T10:00:00+00:00' }

const ownerOnly = ENTITY_KEYS.filter((key) => publishableEntity(key).requiredRole === 'owner')
const staffAllowed = ENTITY_KEYS.filter((key) => publishableEntity(key).requiredRole === 'staff')

describe('an owner may publish everything', () => {
  it.each(ENTITY_KEYS)('owner may publish %s', (key) => {
    expect(mayChangeEntity(key, owner)).toBe(true)
  })
})

describe('a staff member may publish the Staff rows and nothing more', () => {
  it.each(staffAllowed)('staff may publish %s', (key) => {
    expect(mayChangeEntity(key, staff)).toBe(true)
  })

  it.each(ownerOnly)('staff may not publish %s', (key) => {
    expect(mayChangeEntity(key, staff)).toBe(false)
  })

  it('covers all three Owner-only entities, so the list above is not empty by accident', () => {
    expect(ownerOnly.sort()).toEqual(['opening_hours', 'page:home', 'site_contact'])
  })
})

describe('a deactivated account may publish nothing at all', () => {
  it.each(ENTITY_KEYS)('a deactivated owner may not publish %s', (key) => {
    expect(mayChangeEntity(key, disabledOwner)).toBe(false)
  })

  it.each(ENTITY_KEYS)('a deactivated staff member may not publish %s', (key) => {
    expect(mayChangeEntity(key, disabledStaff)).toBe(false)
  })
})
