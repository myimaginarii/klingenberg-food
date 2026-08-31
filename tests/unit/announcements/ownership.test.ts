import { describe, expect, it } from 'vitest'

import {
  ANNOUNCEMENT_SOURCES,
  REPLACED_ANNOUNCEMENT_KINDS,
  announcementOwnershipOf,
  isConsistentAnnouncementOwnership,
  isOwnedByOverride,
  replacementNeedsConfirmation,
  type AnnouncementOwnershipColumns,
} from '@/lib/announcements/ownership'

/**
 * Who owns the announcement — phase 8C-3A; design 1t, 1ae; technical plan §4, §7e
 * items 6 and 8.
 *
 * The ownership model is one pointer, `announcement.source_override_id`, paired with
 * `source` in both directions. `supabase/tests/017_generated_announcement.test.sql`
 * asserts that pairing in SQL, from real JWTs, against the CHECK constraint and the
 * write guard; this is the application's own reading of the same rule, asserted as
 * arithmetic so a change to either has to be a deliberate change to both.
 *
 * The mistakes it exists to catch:
 *
 *   * **a broken pair read as manual.** A generated announcement with no owner and a
 *     manual one with an owner are both states the model does not have, and a mapping
 *     that quietly called either of them "manual" would let §7e item 6 answer a
 *     question about a row nobody can explain;
 *   * **"points at that date" decided by anything but an id.** The suggested wording
 *     is editable (§0m), so the message, the weekday, the formatted date, the expiry
 *     and the link label are all evidence of nothing;
 *   * **a confirmation asked for the wrong states.** Only an `active` announcement is
 *     a public conflict; asking about a hidden or expired one would be asking a person
 *     to choose between two messages when only one of them was ever on screen.
 */

const OVERRIDE_A = '11111111-2222-4333-8444-555555555555'
const OVERRIDE_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const MANUAL: AnnouncementOwnershipColumns = { source: 'manual', source_override_id: null }

const GENERATED: AnnouncementOwnershipColumns = {
  source: 'opening_hours',
  source_override_id: OVERRIDE_A,
}

// ---------------------------------------------------------------------------
// 1. The two states the model has
// ---------------------------------------------------------------------------

describe('the ownership a pair of columns describes', () => {
  it('a manual announcement is owned by no override', () => {
    expect(announcementOwnershipOf(MANUAL)).toEqual({ kind: 'manual' })
  })

  it('a generated announcement names exactly one override', () => {
    expect(announcementOwnershipOf(GENERATED)).toEqual({
      kind: 'generated',
      overrideId: OVERRIDE_A,
    })
  })

  it('has two sources and no third', () => {
    expect(ANNOUNCEMENT_SOURCES).toEqual(['manual', 'opening_hours'])
  })
})

// ---------------------------------------------------------------------------
// 2. The two states it does not have
// ---------------------------------------------------------------------------

describe('the pairs the model cannot hold', () => {
  it('refuses a generated announcement that names no override', () => {
    // The half that would make §7e item 6 unanswerable: a message calling itself
    // generated with nothing to say which date it came from.
    expect(
      announcementOwnershipOf({ source: 'opening_hours', source_override_id: null }),
    ).toBeNull()
  })

  it('refuses a manual announcement that names one', () => {
    // The half that would make a deletion take down a message nobody generated.
    expect(
      announcementOwnershipOf({ source: 'manual', source_override_id: OVERRIDE_A }),
    ).toBeNull()
  })

  it('null is not "manual" — a broken pair is refused, not defaulted', () => {
    expect(isConsistentAnnouncementOwnership(MANUAL)).toBe(true)
    expect(isConsistentAnnouncementOwnership(GENERATED)).toBe(true)
    expect(
      isConsistentAnnouncementOwnership({ source: 'opening_hours', source_override_id: null }),
    ).toBe(false)
    expect(
      isConsistentAnnouncementOwnership({ source: 'manual', source_override_id: OVERRIDE_A }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. §7e item 6 — "points at that date"
// ---------------------------------------------------------------------------

describe('whether an override owns the current announcement', () => {
  it('is true for the override the announcement names', () => {
    expect(isOwnedByOverride(GENERATED, OVERRIDE_A)).toBe(true)
  })

  it('is false for every other override', () => {
    expect(isOwnedByOverride(GENERATED, OVERRIDE_B)).toBe(false)
  })

  it('is false for a manual announcement, whatever date is asked about', () => {
    for (const id of [OVERRIDE_A, OVERRIDE_B]) {
      expect(isOwnedByOverride(MANUAL, id)).toBe(false)
    }
  })

  it('is false for a pair the model cannot hold', () => {
    // A broken row answers "no" rather than guessing, so a deletion cannot take a
    // message down on the strength of a state nobody can explain.
    expect(
      isOwnedByOverride({ source: 'opening_hours', source_override_id: null }, OVERRIDE_A),
    ).toBe(false)
  })

  it('is decided by the id and by nothing else about the message', () => {
    // The same override id with completely different content is still the same owner,
    // and a different id with identical content is still not. That is the whole reason
    // the pointer exists: the wording is editable, so it is not evidence.
    expect(isOwnedByOverride({ ...GENERATED, source_override_id: OVERRIDE_A }, OVERRIDE_A)).toBe(
      true,
    )
    expect(isOwnedByOverride({ ...GENERATED, source_override_id: OVERRIDE_B }, OVERRIDE_A)).toBe(
      false,
    )
  })

  it('exposes no way to ask the question of a message', () => {
    // A structural assertion rather than a behavioural one: there is no parameter here
    // shaped like text, a date, an expiry or a link.
    expect(isOwnedByOverride.length).toBe(2)
    expect(Object.keys(GENERATED).sort()).toEqual(['source', 'source_override_id'])
  })
})

// ---------------------------------------------------------------------------
// 4. §7e item 8 — which states need confirming
// ---------------------------------------------------------------------------

describe('which displaced announcement needs an explicit confirmation', () => {
  it('has four kinds and no fifth', () => {
    expect(REPLACED_ANNOUNCEMENT_KINDS).toEqual(['active', 'hidden', 'expired', 'none'])
  })

  it('only an active announcement does', () => {
    expect(replacementNeedsConfirmation('active')).toBe(true)
  })

  it.each(['hidden', 'expired', 'none'] as const)(
    'a %s announcement is not a public conflict',
    (kind) => {
      // No guest can read any of the three, so there is nothing to choose between.
      expect(replacementNeedsConfirmation(kind)).toBe(false)
    },
  )
})
