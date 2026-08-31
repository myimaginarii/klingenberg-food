import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/auth/session'

import { CONFIRMED_SCHEDULE } from '../fixtures/hours'

/**
 * The coordinated generated-announcement operation — phase 8C-3A; design 1t, 1ae;
 * technical plan §6, §7e items 6 and 8.
 *
 * The sixth module of this shape, after the three sold-out ones, the announcement's
 * visibility path and its replacement path, and it is asserted to the same depth for
 * the same reason: the transaction is proved from real JWTs in
 * `supabase/tests/017_generated_announcement.test.sql`, and what a unit suite can
 * prove is that the application sends the right thing, reads the answer rather than
 * echoing the request, and refuses in the cases the database would.
 *
 * The mistakes it exists to catch:
 *
 *   * **the browser choosing an authoritative field.** A staff member may edit the
 *     *message* (1t draws it as an editable field). The link, the expiry, the source
 *     and the ownership are reconstructed here on every call, from the published
 *     override and the published weekly schedule — including on the *second*, confirmed
 *     call, so a form left open cannot publish a stale sentence;
 *   * **a first attempt that replaces an active announcement.** §7e item 8: the first
 *     call returns `conflict` and writes nothing; only an explicit confirmation
 *     replaces;
 *   * **the hours being rolled back by an announcement refusal.** Nothing in this
 *     module writes an override, so there is no statement that could;
 *   * **a cache tag expired for a write that did not happen**, which for a conflict
 *     would mean rebuilding the public pages into what they already were while the
 *     screen reported a question;
 *   * **anything at all reaching the draft machinery.**
 */

const rpc = vi.fn()
const readAdminOverrides = vi.fn()
const readAdminOpeningHours = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ rpc }),
}))

vi.mock('@/lib/content/hours-overrides-admin', () => ({
  readAdminOverrides: () => readAdminOverrides(),
}))

vi.mock('@/lib/content/hours-admin', () => ({
  readAdminOpeningHours: () => readAdminOpeningHours(),
}))

const STAFF: Profile = {
  userId: '00000000-0000-4000-8000-00000000000a',
  email: 'staff@example.test',
  name: 'Lokal Medarbejder',
  role: 'staff',
  disabledAt: null,
}

const OWNER: Profile = { ...STAFF, role: 'owner', name: 'Lokal Ejer' }

/** A deactivated account — the one profile `isActiveStaff()` refuses (§5). */
const DISABLED: Profile = { ...STAFF, disabledAt: '2026-08-01T00:00:00.000Z' }

const OVERRIDE_ID = '11111111-2222-4333-8444-555555555555'
const OVERRIDE_VERSION = '2026-08-31T15:00:00.000Z'
const VERSION = '2026-08-31T16:00:00.000Z'
const NEXT_VERSION = '2026-08-31T16:00:05.000Z'

/**
 * A Sunday whose recurring hours are 17:00–20:00, changed to 17:00–19:00 — 1t's own
 * example, and far enough ahead that the expiry it implies is never in the past.
 */
const SUNDAY = '2099-09-13'

/** A published override, in the shape `readAdminOverrides()` returns. */
function publishedOverride(overrides: Record<string, unknown> = {}) {
  const live = { kind: 'custom', opens_at: '17:00', closes_at: '19:00' }

  return {
    id: OVERRIDE_ID,
    date: SUNDAY,
    updatedAt: OVERRIDE_VERSION,
    lifecycle: 'live',
    stored: live,
    live,
    current: live,
    draftMalformed: false,
    ...overrides,
  }
}

function hours() {
  return {
    id: '00000000-0000-4000-8000-0000000000ff',
    updatedAt: '2026-08-01T00:00:00.000Z',
    current: CONFIRMED_SCHEDULE,
    live: CONFIRMED_SCHEDULE,
    hasDraft: false,
    draftMalformed: false,
  }
}

function replies(data: unknown) {
  rpc.mockResolvedValue({ data, error: null })
}

const APPLIED = {
  status: 'applied',
  updated_at: NEXT_VERSION,
  conflict: 'none',
  source_override_id: OVERRIDE_ID,
  before: {
    message: null,
    link_type: 'none',
    link_page: null,
    link_url: null,
    link_label: null,
    expires_at: null,
    is_visible: false,
    source: 'manual',
    source_override_id: null,
  },
}

async function apply(profile: Profile, request: Record<string, unknown> = {}) {
  const { applyGeneratedAnnouncement } = await import(
    '@/lib/announcements/generated-operation'
  )

  return applyGeneratedAnnouncement(profile, {
    overrideId: OVERRIDE_ID,
    overrideExpectedUpdatedAt: OVERRIDE_VERSION,
    expectedUpdatedAt: VERSION,
    ...request,
  })
}

beforeEach(() => {
  rpc.mockReset()
  readAdminOverrides.mockReset()
  readAdminOpeningHours.mockReset()

  readAdminOverrides.mockResolvedValue([publishedOverride()])
  readAdminOpeningHours.mockResolvedValue(hours())
  replies(APPLIED)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1. The role matrix, first
// ---------------------------------------------------------------------------

describe('who may do this', () => {
  it.each([
    ['staff', STAFF],
    ['owner', OWNER],
  ])('%s may — the announcement is in both rows of §5', async (_who, profile) => {
    expect((await apply(profile)).status).toBe('applied')
  })

  it('a deactivated account is refused before anything is read', async () => {
    const result = await apply(DISABLED)

    expect(result.status).toBe('forbidden')
    expect(readAdminOverrides).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(result.cacheTags).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. §7e item 8 — the hours come first, and cannot be rolled back
// ---------------------------------------------------------------------------

describe('the ordering §7e item 8 makes binding', () => {
  it('refuses an override that is not on the hjemmeside yet', async () => {
    readAdminOverrides.mockResolvedValue([publishedOverride({ live: null, lifecycle: 'kladde' })])

    const result = await apply(STAFF)

    expect(result.status).toBe('not_published')
    expect(rpc).not.toHaveBeenCalled()
    expect(result.cacheTags).toEqual([])
  })

  it('answers not_found for an override this caller cannot see', async () => {
    readAdminOverrides.mockResolvedValue([])

    expect((await apply(STAFF)).status).toBe('not_found')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('writes nothing about the opening hours, in any branch', () => {
    const source = readFileSync(
      join(process.cwd(), 'lib/announcements/generated-operation.ts'),
      'utf8',
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    // Two reads, and no write: no publish, no save, no draft, no removal, and no
    // `from()` at all. There is no statement here through which an announcement
    // conflict could undo a published override.
    for (const forbidden of [
      "from('opening_hours",
      'publish_opening_hours',
      'publishPendingChange',
      'saveEntityDraft',
      'createOverrideDraft',
      'removeOverride',
      'remove_opening_hours_override',
      '@/lib/publishing/drafts',
      '@/lib/drafts/',
    ]) {
      expect(code, `the coordinator names ${forbidden}`).not.toContain(forbidden)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. What reaches the database
// ---------------------------------------------------------------------------

describe('what is sent to the database', () => {
  it('sends the ten typed scalars and nothing else', async () => {
    await apply(STAFF)

    expect(rpc).toHaveBeenCalledWith('apply_generated_announcement', {
      p_override_id: OVERRIDE_ID,
      p_override_expected_updated_at: OVERRIDE_VERSION,
      p_message: 'Ændrede åbningstider søndag · 17:00–19:00',
      p_link_type: 'page',
      p_link_page: '/find-os',
      p_link_url: null,
      p_link_label: 'Se tider',
      // The later of the normal closing (20:00) and the special one (19:00) — §0m's
      // corrected rule, in Copenhagen. Not a value any caller supplied.
      p_expires_at: '2099-09-13T18:00:00.000Z',
      p_expected_updated_at: VERSION,
      p_confirm_replace: false,
    })
  })

  it('has no parameter for the source, the ownership, is_visible, previous or a draft', async () => {
    await apply(STAFF)

    const sent = Object.keys(rpc.mock.calls[0]?.[1] as Record<string, unknown>)

    expect(sent.sort()).toEqual([
      'p_confirm_replace',
      'p_expected_updated_at',
      'p_expires_at',
      'p_link_label',
      'p_link_page',
      'p_link_type',
      'p_link_url',
      'p_message',
      'p_override_expected_updated_at',
      'p_override_id',
    ])
  })

  it('passes the confirmation through as a boolean, never as whatever arrived', async () => {
    await apply(STAFF, { confirmReplace: true })
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_confirm_replace: true })

    rpc.mockClear()
    await apply(STAFF, { confirmReplace: undefined })
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_confirm_replace: false })
  })
})

// ---------------------------------------------------------------------------
// 4. The message may be edited; nothing else may
// ---------------------------------------------------------------------------

describe('an edited message', () => {
  it('replaces the wording and nothing else', async () => {
    await apply(STAFF, { message: 'Lukket tidligere på grund af arrangement' })

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_message: 'Lukket tidligere på grund af arrangement',
      // Every authoritative field is still the generator's.
      p_link_type: 'page',
      p_link_page: '/find-os',
      p_link_label: 'Se tider',
      p_expires_at: '2099-09-13T18:00:00.000Z',
    })
  })

  it('is trimmed', async () => {
    await apply(STAFF, { message: '   Kortere åbent i dag   ' })

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_message: 'Kortere åbent i dag' })
  })

  it.each([
    ['blank', ''],
    ['whitespace only', '   '],
    ['over 90 characters', 'x'.repeat(91)],
  ])('refuses a message that is %s — nothing is truncated to fit', async (_what, message) => {
    const result = await apply(STAFF, { message })

    expect(result.status).toBe('invalid_payload')
    expect(result.reason).toBe('message')
    expect(rpc).not.toHaveBeenCalled()
    expect(result.cacheTags).toEqual([])
  })

  it('regenerates the authoritative fields on the confirmed second call too', async () => {
    // The form that carried the first attempt may have sat open while somebody edited
    // the hours. The confirmed call reads the published rows again rather than trusting
    // anything the first attempt produced.
    await apply(STAFF, { confirmReplace: true })

    expect(readAdminOverrides).toHaveBeenCalledTimes(1)
    expect(readAdminOpeningHours).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_expires_at: '2099-09-13T18:00:00.000Z',
    })
  })
})

// ---------------------------------------------------------------------------
// 5. The generator's own refusals, reported rather than worked around
// ---------------------------------------------------------------------------

describe('when the override suggests no announcement at all', () => {
  it('reports no_effect for an override that restates the recurring week', async () => {
    readAdminOverrides.mockResolvedValue([
      publishedOverride({ live: { kind: 'custom', opens_at: '17:00', closes_at: '20:00' } }),
    ])

    const result = await apply(STAFF)

    expect(result.status).toBe('no_effect')
    expect(rpc).not.toHaveBeenCalled()
    expect(result.cacheTags).toEqual([])
  })

  it('reports expired rather than moving the expiry forward', async () => {
    readAdminOverrides.mockResolvedValue([
      publishedOverride({ date: '2020-09-13', live: { kind: 'closed', opens_at: null, closes_at: null } }),
    ])

    expect((await apply(STAFF)).status).toBe('expired')
    expect(rpc).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 6. The conflict decision
// ---------------------------------------------------------------------------

describe('§7e item 8’s conflict', () => {
  const CURRENT = {
    message: 'Besked A',
    link_type: 'page',
    link_page: '/menu',
    link_url: null,
    link_label: 'Se menuen',
    expires_at: '2099-09-14T18:00:00.000Z',
    is_visible: true,
    source: 'manual',
    source_override_id: null,
  }

  it('is reported with the message standing in the way, and expires nothing', async () => {
    replies({ status: 'conflict', conflict: 'active', updated_at: VERSION, current: CURRENT })

    const result = await apply(STAFF)

    expect(result.status).toBe('conflict')
    expect(result.conflict).toBe('active')
    expect(result.current).toEqual(CURRENT)
    expect(result.announcement).toBeNull()
    expect(result.cacheTags).toEqual([])
  })

  it('names the announcement from what the server read, never from the request', async () => {
    // The browser never says what is on the hjemmeside, and there is no parameter
    // through which it could — the sheet 8C-3B draws is drawn from this.
    replies({ status: 'conflict', conflict: 'active', updated_at: VERSION, current: CURRENT })

    const result = await apply(STAFF)

    expect(result.current?.message).toBe('Besked A')
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_current')
  })

  it.each(['hidden', 'expired', 'none'] as const)(
    'a %s announcement is replaced without a sheet',
    async (kind) => {
      replies({ ...APPLIED, conflict: kind })

      const result = await apply(STAFF)

      expect(result.status).toBe('applied')
      expect(result.conflict).toBe(kind)
    },
  )
})

// ---------------------------------------------------------------------------
// 7. The status mapping
// ---------------------------------------------------------------------------

describe('what the application does with the database’s answer', () => {
  it('reports what was applied, read back from the reply', async () => {
    replies({ ...APPLIED, conflict: 'active' })

    const result = await apply(STAFF, { confirmReplace: true })

    expect(result.status).toBe('applied')
    expect(result.updatedAt).toBe(NEXT_VERSION)
    expect(result.ownership).toEqual({ kind: 'generated', overrideId: OVERRIDE_ID })
    expect(result.previous).toEqual(APPLIED.before)
    expect(result.announcement?.source).toBe('opening_hours')
    expect(result.cacheTags).toEqual(['announcement'])
  })

  it.each([
    ['stale_override', 'stale_override'],
    ['stale_announcement', 'stale_announcement'],
    ['not_found', 'not_found'],
    ['forbidden', 'forbidden'],
  ])('maps %s straight through, with no tags', async (reply, expected) => {
    replies({ status: reply })

    const result = await apply(STAFF)

    expect(result.status).toBe(expected)
    expect(result.cacheTags).toEqual([])
    expect(result.updatedAt).toBeNull()
  })

  it('maps invalid_payload with the rule the database named', async () => {
    replies({ status: 'invalid_payload', reason: 'source_override' })

    const result = await apply(STAFF)

    expect(result.status).toBe('invalid_payload')
    expect(result.reason).toBe('source_override')
  })

  it('maps invalid_snapshot to failed — the application cannot produce one', async () => {
    replies({ status: 'invalid_snapshot' })

    expect((await apply(STAFF)).status).toBe('failed')
  })

  it('treats an unrecognised reply as a failure rather than a success', async () => {
    replies({ status: 'ok' })

    const result = await apply(STAFF)

    expect(result.status).toBe('failed')
    expect(result.cacheTags).toEqual([])
  })

  it('treats a database error as a failure, and says nothing about it to the browser', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } })

    const result = await apply(STAFF)

    expect(result.status).toBe('failed')
    expect(result.reason).toBeNull()
    expect(result.cacheTags).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 8. The module's own boundaries
// ---------------------------------------------------------------------------

describe('the coordinator expires nothing and renders nothing', () => {
  const source = readFileSync(
    join(process.cwd(), 'lib/announcements/generated-operation.ts'),
    'utf8',
  )
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('returns the tags and expires none itself', () => {
    // The same separation `./visibility.ts`, `./replacement.ts` and
    // `lib/hours/override-admin.ts` keep: the module answers, and the Server Action
    // decides what to do with the answer.
    expect(code).not.toContain('expirePublicCacheTags')
    expect(code).not.toContain('updateTag')
  })

  it('renders nothing — 1ae is 8C-3B', () => {
    for (const wording of [
      'Erstat med den nye besked',
      'Behold eksisterende',
      'Vis også som besked',
      'Foreslået besked',
      'react',
      'jsx',
    ]) {
      expect(code, `the coordinator names ${wording}`).not.toContain(wording)
    }
  })

  it('imports exactly what it needs, and nothing from drafts or publishing’s write side', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])

    expect(imports.sort()).toEqual(
      [
        '@/lib/auth/session',
        '@/lib/cache/tags',
        '@/lib/content/hours-admin',
        '@/lib/content/hours-overrides-admin',
        '@/lib/publishing/authorize',
        '@/lib/publishing/entities',
        '@/lib/supabase/server',
        './generated',
        // Pure: the 90-character constant, so the refusal sentence cannot drift from it.
        './lifecycle',
        './ownership',
        './snapshot',
        'zod',
      ].sort(),
    )
  })
})

// ---------------------------------------------------------------------------
// 9. What the administration says afterwards
// ---------------------------------------------------------------------------

describe('the sentence a refusal leaves behind', () => {
  it('has one for every status except the two that are not obstacles', async () => {
    const { describeGeneratedAnnouncementObstacle } = await import(
      '@/lib/announcements/generated-operation'
    )

    // `applied` is a success and `conflict` is a *question* — 1ae's sheet, which is
    // 8C-3B's to draw. Neither is a sentence this layer should be putting words to.
    expect(describeGeneratedAnnouncementObstacle('applied')).toBeNull()
    expect(describeGeneratedAnnouncementObstacle('conflict')).toBeNull()

    for (const status of [
      'no_effect',
      'expired',
      'too_long',
      'not_published',
      'stale_override',
      'stale_announcement',
      'invalid_payload',
      'not_found',
      'forbidden',
      'failed',
    ] as const) {
      const sentence = describeGeneratedAnnouncementObstacle(status)

      expect(sentence, `${status} has a sentence`).not.toBeNull()
      expect(sentence, `${status} is worded in Danish, as a sentence`).toMatch(/\.$/)
    }
  })

  it('tells somebody to publish the hours first, rather than offering to do it', async () => {
    const { describeGeneratedAnnouncementObstacle } = await import(
      '@/lib/announcements/generated-operation'
    )

    // §7e item 8's ordering, said in words: the hours are the person's to publish, and
    // this operation will not do it for them from the other side.
    expect(describeGeneratedAnnouncementObstacle('not_published')).toContain('Offentliggør')
  })
})
