import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/auth/session'
import type { AnnouncementSnapshot } from '@/lib/announcements/snapshot'

/**
 * What the application does with the database's answer, for replace and restore —
 * technical plan §4, §6, §7e item 8; design 1ae.
 *
 * The fifth module of this shape, after the three sold-out ones and the announcement's
 * visibility path, and it is asserted to the same depth for the same reason: the
 * transaction is proved from real JWTs in
 * `supabase/tests/015_announcement_replacement.test.sql`, and what a unit suite can
 * prove is that the application sends the right thing, reads the answer rather than
 * echoing the request, and refuses in the cases the database would.
 *
 * The mistakes it exists to catch:
 *
 *   * **a refusal reported as a success**, which for this operation would mean telling
 *     somebody the old message is safely stashed when nothing was written;
 *   * **the browser choosing fields**: the payload is a closed shape, and a key that is
 *     not one of the seven must not reach the database;
 *   * **a restore that sends content**, which would make `previous` decorative and the
 *     browser authoritative over what comes back;
 *   * **a cache tag expired for a write that did not happen**;
 *   * **anything at all reaching the draft machinery**, because this operation runs
 *     beside a pending draft on the row the draft belongs to.
 */

const rpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ rpc }),
}))

const STAFF: Profile = {
  userId: '00000000-0000-4000-8000-00000000000a',
  email: 'staff@example.test',
  name: 'Lokal Medarbejder',
  role: 'staff',
  disabledAt: null,
}

const OWNER: Profile = { ...STAFF, role: 'owner', name: 'Lokal Ejer' }

const VERSION = '2026-08-31T16:00:00.000Z'
const NEXT_VERSION = '2026-08-31T16:00:05.000Z'

const SNAPSHOT_A: AnnouncementSnapshot = {
  message: 'Besked A',
  link_type: 'page',
  link_page: '/menu',
  link_url: null,
  link_label: 'Se menuen',
  expires_at: '2026-09-14T18:00:00.000Z',
  is_visible: true,
  source: 'manual',
  source_override_id: null,
}

/** The override a generated replacement belongs to (8C-3A). */
const OVERRIDE_ID = '11111111-2222-4333-8444-555555555555'

/** A replacement payload that satisfies every rule, so a test can break exactly one. */
const REPLACEMENT = {
  message: 'Ændrede åbningstider søndag · 17:00–19:00',
  link_type: 'none',
  link_page: null,
  link_url: null,
  link_label: null,
  expires_at: '2026-09-14T18:00:00.000Z',
  source: 'opening_hours',
  source_override_id: OVERRIDE_ID,
} as const

function replies(data: unknown) {
  rpc.mockResolvedValue({ data, error: null })
}

async function replace(profile: Profile, payload: unknown = REPLACEMENT) {
  const { replaceAnnouncement } = await import('@/lib/announcements/replacement')

  return replaceAnnouncement(profile, {
    // The cast is the point of the test in the invalid cases: a caller in server code
    // could compose something wrong, and this layer has to refuse it.
    replacement: payload as never,
    expectedUpdatedAt: VERSION,
  })
}

async function restore(profile: Profile) {
  const { restoreAnnouncement } = await import('@/lib/announcements/replacement')

  return restoreAnnouncement(profile, { expectedUpdatedAt: VERSION })
}

beforeEach(() => {
  rpc.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// What reaches the database
// ---------------------------------------------------------------------------

describe('what is sent to the database', () => {
  it('sends the nine typed scalars and nothing else', async () => {
    replies({ status: 'replaced', updated_at: NEXT_VERSION, replaced: 'active', before: SNAPSHOT_A })

    await replace(STAFF)

    expect(rpc).toHaveBeenCalledWith('replace_announcement', {
      p_message: REPLACEMENT.message,
      p_link_type: 'none',
      p_link_page: null,
      p_link_url: null,
      p_link_label: null,
      p_expires_at: REPLACEMENT.expires_at,
      p_source: 'opening_hours',
      p_expected_updated_at: VERSION,
      // 8C-3A. Named explicitly rather than left to the SQL default: a trusted
      // lifecycle field should be stated by every caller that means it.
      p_source_override_id: OVERRIDE_ID,
    })
  })

  it('has no parameter for is_visible, previous, replaced_at, draft or an actor', async () => {
    replies({ status: 'replaced', updated_at: NEXT_VERSION, replaced: 'active', before: SNAPSHOT_A })

    await replace(STAFF)

    const sent = Object.keys(rpc.mock.calls[0]?.[1] as Record<string, unknown>)

    expect(sent.sort()).toEqual([
      'p_expected_updated_at',
      'p_expires_at',
      'p_link_label',
      'p_link_page',
      'p_link_type',
      'p_link_url',
      'p_message',
      'p_source',
      'p_source_override_id',
    ])
  })

  it('sends only the version token when restoring — never the previous message', async () => {
    replies({ status: 'restored', updated_at: NEXT_VERSION, showable: true, after: SNAPSHOT_A })

    await restore(STAFF)

    expect(rpc).toHaveBeenCalledWith('restore_announcement', {
      p_expected_updated_at: VERSION,
    })
  })
})

// ---------------------------------------------------------------------------
// The payload is closed
// ---------------------------------------------------------------------------

describe('a payload the browser could not widen', () => {
  it.each([
    ['a blank message', { message: '   ' }],
    ['a message over 90 characters', { message: 'x'.repeat(91) }],
    ['an expiry that is not an instant', { expires_at: 'i morgen' }],
    ['a source outside the closed vocabulary', { source: 'kampagne' }],
    ['an unknown link type', { link_type: 'popup' }],
    ['an unapproved internal route', { link_type: 'page', link_page: '/admin' }],
    ['an http address', { link_type: 'url', link_url: 'http://usikker.test/x', link_label: 'Se' }],
    ['a page and an address at once', { link_type: 'page', link_page: '/menu', link_url: 'https://andet.test' }],
    ['a page link with no page', { link_type: 'page', link_page: null }],
    ['an external address with no label', { link_type: 'url', link_url: 'https://andet.test/x' }],
    ['a link type of none carrying a page', { link_page: '/menu' }],
  ])('refuses %s without calling the database', async (_what, broken) => {
    const result = await replace(STAFF, { ...REPLACEMENT, ...broken })

    expect(result.status).toBe('invalid_payload')
    expect(result.cacheTags).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['is_visible', { is_visible: true }],
    ['previous', { previous: SNAPSHOT_A }],
    ['replaced_at', { replaced_at: '2026-08-31T16:00:00.000Z' }],
    ['draft', { draft: { message: 'Kladde C' } }],
    ['updated_by', { updated_by: '00000000-0000-4000-8000-000000000000' }],
    ['an entity name', { entity: 'announcement' }],
    ['a table name', { table: 'announcement' }],
  ])('refuses a payload carrying %s', async (_what, extra) => {
    const result = await replace(STAFF, { ...REPLACEMENT, ...extra })

    expect(result.status).toBe('invalid_payload')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('trims the message rather than storing what was typed around it', async () => {
    replies({ status: 'replaced', updated_at: NEXT_VERSION, replaced: 'none', before: SNAPSHOT_A })

    await replace(STAFF, { ...REPLACEMENT, message: '  Besked B  ' })

    expect((rpc.mock.calls[0]?.[1] as { p_message: string }).p_message).toBe('Besked B')
  })
})

// ---------------------------------------------------------------------------
// The role matrix
// ---------------------------------------------------------------------------

describe('who may do it (§5)', () => {
  it.each([
    ['staff', STAFF],
    ['owner', OWNER],
  ])('lets %s replace', async (_who, profile) => {
    replies({ status: 'replaced', updated_at: NEXT_VERSION, replaced: 'active', before: SNAPSHOT_A })

    expect((await replace(profile)).status).toBe('replaced')
  })

  it.each([
    ['staff', STAFF],
    ['owner', OWNER],
  ])('lets %s restore', async (_who, profile) => {
    replies({ status: 'restored', updated_at: NEXT_VERSION, showable: true, after: SNAPSHOT_A })

    expect((await restore(profile)).status).toBe('restored')
  })

  it('refuses a deactivated account before it asks the database', async () => {
    const disabled: Profile = { ...STAFF, disabledAt: '2026-08-01T00:00:00.000Z' }

    expect((await replace(disabled)).status).toBe('forbidden')
    expect((await restore(disabled)).status).toBe('forbidden')
    expect(rpc).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

describe('the replacement result', () => {
  it('reports what was displaced, read from the database rather than assumed', async () => {
    for (const kind of ['active', 'hidden', 'expired', 'none'] as const) {
      replies({ status: 'replaced', updated_at: NEXT_VERSION, replaced: kind, before: SNAPSHOT_A })

      expect((await replace(STAFF)).replaced).toBe(kind)
    }
  })

  it('carries the stashed snapshot back, so a screen can name it', async () => {
    replies({ status: 'replaced', updated_at: NEXT_VERSION, replaced: 'active', before: SNAPSHOT_A })

    expect((await replace(STAFF)).previous).toEqual(SNAPSHOT_A)
  })

  it('drops a `before` that is not a snapshot rather than trusting it', async () => {
    replies({
      status: 'replaced',
      updated_at: NEXT_VERSION,
      replaced: 'active',
      before: { ...SNAPSHOT_A, draft: { message: 'Kladde C' } },
    })

    expect((await replace(STAFF)).previous).toBeNull()
  })

  it('returns the new version token, so the Fortryd is bound to this write', async () => {
    replies({ status: 'replaced', updated_at: NEXT_VERSION, replaced: 'active', before: SNAPSHOT_A })

    expect((await replace(STAFF)).updatedAt).toBe(NEXT_VERSION)
  })

  it('expires the announcement tag — and only for a write that reached the row', async () => {
    replies({ status: 'replaced', updated_at: NEXT_VERSION, replaced: 'active', before: SNAPSHOT_A })
    expect((await replace(STAFF)).cacheTags).toEqual(['announcement'])

    for (const status of ['conflict', 'not_found', 'forbidden'] as const) {
      replies({ status })
      const result = await replace(STAFF)
      expect(result.status).toBe(status)
      expect(result.cacheTags).toEqual([])
      expect(result.previous).toBeNull()
    }
  })

  it('names the rule the database refused the payload on', async () => {
    replies({ status: 'invalid_payload', reason: 'expires_at' })

    const result = await replace(STAFF)

    expect(result.status).toBe('invalid_payload')
    expect(result.reason).toBe('expires_at')
    expect(result.cacheTags).toEqual([])
  })

  it('treats a database error as a failure, not as a success', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await replace(STAFF)

    expect(result.status).toBe('failed')
    expect(result.cacheTags).toEqual([])
  })

  it('treats an unknown reply as a failure', async () => {
    replies({ status: 'noget_helt_andet' })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect((await replace(STAFF)).status).toBe('failed')
  })
})

describe('the restore result', () => {
  it('reports showable, so an expired restore is not called a success', async () => {
    replies({ status: 'restored', updated_at: NEXT_VERSION, showable: false, after: SNAPSHOT_A })

    const result = await restore(STAFF)

    expect(result.status).toBe('restored')
    expect(result.showable).toBe(false)
    // The write happened, so the public cache still has to be told.
    expect(result.cacheTags).toEqual(['announcement'])
  })

  it.each([
    ['nothing_to_restore'],
    ['invalid_snapshot'],
    ['conflict'],
    ['not_found'],
    ['forbidden'],
  ] as const)('expires nothing for %s', async (status) => {
    replies({ status })

    const result = await restore(STAFF)

    expect(result.status).toBe(status)
    expect(result.cacheTags).toEqual([])
    expect(result.restored).toBeNull()
    expect(result.showable).toBeNull()
  })

  it('carries back what is public now', async () => {
    replies({ status: 'restored', updated_at: NEXT_VERSION, showable: true, after: SNAPSHOT_A })

    expect((await restore(STAFF)).restored).toEqual(SNAPSHOT_A)
  })
})

// ---------------------------------------------------------------------------
// The sentences
// ---------------------------------------------------------------------------

describe('what the administration says afterwards', () => {
  it('tells the four replacement cases apart', async () => {
    const { describeAnnouncementReplacement } = await import('@/lib/announcements/replacement')

    expect(describeAnnouncementReplacement('active')).toContain('Den forrige besked er fjernet')
    expect(describeAnnouncementReplacement('hidden')).toContain('var slået fra')
    expect(describeAnnouncementReplacement('expired')).toContain('var udløbet')
    expect(describeAnnouncementReplacement('none')).toContain('Der stod ingen besked før')
  })

  it('says plainly when a restored message is one no guest can read', async () => {
    const { describeAnnouncementRestore } = await import('@/lib/announcements/replacement')

    expect(describeAnnouncementRestore(true)).toBe(
      'Den forrige besked er sat tilbage og vises igen på hjemmesiden.',
    )
    expect(describeAnnouncementRestore(false)).toContain('udløbet')
    expect(describeAnnouncementRestore(false)).toContain('vises ikke')
  })

  it('has a sentence for every refusal, and none for the success', async () => {
    const { describeRestoreObstacle } = await import('@/lib/announcements/replacement')

    expect(describeRestoreObstacle('restored')).toBeNull()

    for (const status of [
      'nothing_to_restore',
      'invalid_snapshot',
      'conflict',
      'not_found',
      'forbidden',
      'failed',
    ] as const) {
      expect(describeRestoreObstacle(status)).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// The boundary, asserted over the module's own source
// ---------------------------------------------------------------------------

/**
 * §14 of the 8C-1 brief, and §18's code-quality list, as assertions.
 *
 * This operation runs **beside a pending draft**, on the row the draft belongs to. A
 * single reach into the draft machinery would be the difference between "the new
 * message is up" and "somebody's unpublished message went live".
 */
describe('the replacement module does not leak into publishing, or into the draft', () => {
  const source = readFileSync(join(process.cwd(), 'lib/announcements/replacement.ts'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  /**
   * Asserted as the **whole** import list rather than as a list of forbidden needles,
   * because the module's own prose names several of these in order to say it cannot
   * reach them. An exhaustive list also catches the import nobody thought to forbid.
   */
  it('imports exactly what it needs, and nothing from drafts, publishing or the hours', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])

    expect(imports.sort()).toEqual([
      '@/lib/auth/session',
      '@/lib/cache/tags',
      '@/lib/publishing/authorize',
      '@/lib/publishing/entities',
      '@/lib/schemas/announcement',
      '@/lib/supabase/server',
      './lifecycle',
      './link',
      './ownership',
      './snapshot',
      'zod',
    ].sort())
  })

  it.each([
    ['a draft write', '@/lib/publishing/drafts'],
    ['the draft overlay', '@/lib/drafts/'],
    ['the pending-changes read', '@/lib/publishing/pending'],
    ['the publish transaction', '@/lib/publishing/publish'],
    ['the opening hours', '@/lib/hours/'],
    ['the opening-hours content reads', '@/lib/content/hours'],
  ])('does not reach for %s', (_what, needle) => {
    expect(code).not.toContain(needle)
  })

  it('never names the draft column', () => {
    expect(code).not.toContain('draft')
  })

  it('issues no table write of its own — two RPCs and nothing else', () => {
    expect(code).not.toContain(".from('announcement')")
    expect(code).not.toContain('.update(')
    expect(code).not.toContain('.insert(')
    expect(code).not.toContain('.delete(')

    const calls = [...code.matchAll(/\.rpc\(\s*'([a-z_]+)'/g)].map((match) => match[1])
    expect(calls.sort()).toEqual(['replace_announcement', 'restore_announcement'])
  })

  it('borrows only the role matrix and the entity registry from publishing', () => {
    const publishingImports = [...source.matchAll(/from '@\/lib\/publishing\/([a-z-]+)'/g)].map(
      (match) => match[1],
    )

    expect(publishingImports.sort()).toEqual(['authorize', 'entities'])
  })

  it('expires no cache tag itself — it returns them for the action to expire', () => {
    expect(source).not.toContain('@/lib/cache/invalidate')
    expect(source).not.toContain('updateTag')
  })

  it('generates no opening-hours message — that is 8C-2', () => {
    // No weekday, no clock face, no date arithmetic. The payload arrives composed.
    expect(code).not.toContain('søndag')
    expect(code).not.toContain('Ændrede åbningstider')
    expect(code).not.toContain('copenhagen')
    expect(code).not.toContain('Copenhagen')
  })

  it('is server-only, so nothing here can be pulled into a browser bundle', () => {
    expect(source).toContain("import 'server-only'")
  })
})

/**
 * The snapshot module is deliberately **pure**, so the same shape can be asserted
 * without a database and read by any layer that needs it.
 */
describe('the snapshot module stays pure', () => {
  const source = readFileSync(join(process.cwd(), 'lib/announcements/snapshot.ts'), 'utf8')

  it('imports no server module', () => {
    expect(source).not.toContain("import 'server-only'")
    expect(source).not.toContain('@/lib/supabase/')
    expect(source).not.toContain('@/lib/cache/')
  })

  it('reads no clock of its own — `now` is always an argument', () => {
    expect(source).not.toContain('Date.now()')
    expect(source).not.toContain('new Date()')
  })
})
