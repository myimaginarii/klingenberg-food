import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/auth/session'

/**
 * What the application does with the database's answer, for the immediate announcement
 * path — technical plan §6, §7c; design 1ad.
 *
 * The fourth of the set, and the one phase 7B added. Phase 6's completion pass reviewed
 * `set_dish_sold_out`, `set_weekly_special_sold_out` and `set_monthly_burger_sold_out`
 * together and kept them as three explicit functions (§0e answer A); it also found that
 * only the dish module had its *mapping* asserted at unit level, and corrected that with
 * `weekly-sold-out-mapping.test.ts` and `monthly-sold-out-mapping.test.ts`. This file is
 * the same audit for `set_announcement_visible`, so the announcement's immediate
 * operation has the same test depth as the three sold-out ones rather than less.
 *
 * The mistakes it exists to catch are the three those files name — a refusal reported as
 * a success, `unchanged` treated as a change, the state echoed rather than read — plus
 * the two that are this operation's own:
 *
 *   * **a restore reported as a success when the message expired inside the Fortryd
 *     window**, which would tell somebody a bar is back that no guest can see;
 *   * **anything at all reaching the draft machinery**, because this operation runs
 *     beside a pending draft and must leave it exactly where it stands.
 *
 * The transaction itself — the byte-identical columns, the audit row, the conflict that
 * writes nothing — is proved from real JWTs in `supabase/tests/012_announcement.test.sql`.
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

const VERSION = '2026-08-30T16:00:00.000Z'

/** The module under test, imported after the mock is registered. */
async function setVisible(profile: Profile, visible: boolean) {
  const { setAnnouncementVisible } = await import('@/lib/announcements/visibility')

  return setAnnouncementVisible(profile, { visible, expectedUpdatedAt: VERSION })
}

/** One reply from the database function, in the shape PostgREST returns it. */
function replies(data: unknown) {
  rpc.mockResolvedValue({ data, error: null })
}

beforeEach(() => {
  rpc.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('what is sent to the database', () => {
  it('sends the state asked for and the version token — and nothing else', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { is_visible: false } })

    await setVisible(STAFF, false)

    expect(rpc).toHaveBeenCalledWith('set_announcement_visible', {
      p_visible: false,
      p_expected_updated_at: VERSION,
    })
  })

  it('sends no row id, no entity name and no target: the singleton locates itself', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { is_visible: false } })

    await setVisible(STAFF, false)

    expect(Object.keys(rpc.mock.calls[0]?.[1] as object).sort()).toEqual([
      'p_expected_updated_at',
      'p_visible',
    ])
  })

  it('sends no message, link, expiry, source, previous or replaced_at', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { is_visible: false } })

    await setVisible(STAFF, false)

    const sent = JSON.stringify(rpc.mock.calls[0]?.[1])

    for (const field of [
      'message',
      'link',
      'expires',
      'source',
      'previous',
      'replaced',
      'draft',
    ]) {
      expect(sent, `the request carries no ${field}`).not.toContain(field)
    }
  })

  it('sends true when Fortryd asks for the bar back', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { is_visible: true } })

    await setVisible(STAFF, true)

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_visible: true })
  })

  it('calls exactly one function, so the transaction cannot be split in two', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { is_visible: false } })

    await setVisible(STAFF, false)

    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('how the database’s answer is mapped', () => {
  it('reports a change, its new version token and the announcement cache tag', async () => {
    replies({
      status: 'updated',
      updated_at: '2026-08-30T16:00:05.000Z',
      after: { is_visible: false },
    })

    expect(await setVisible(STAFF, false)).toEqual({
      status: 'updated',
      visible: false,
      updatedAt: '2026-08-30T16:00:05.000Z',
      cacheTags: ['announcement'],
    })
  })

  it('reads the state back from the row rather than echoing the request', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { is_visible: true } })

    expect((await setVisible(STAFF, false)).visible).toBe(true)
  })

  it('expires nothing when the bar already stood that way', async () => {
    replies({ status: 'unchanged', updated_at: VERSION, after: { is_visible: false } })

    expect(await setVisible(STAFF, false)).toEqual({
      status: 'unchanged',
      visible: false,
      updatedAt: VERSION,
      cacheTags: [],
    })
  })

  it.each(['conflict', 'not_found', 'forbidden'] as const)(
    'passes %s through with no cache tag and no version token',
    async (status) => {
      replies({ status })

      expect(await setVisible(STAFF, false)).toEqual({
        status,
        visible: null,
        updatedAt: null,
        cacheTags: [],
      })
    },
  )

  it('maps a refused restore of an expired message to `expired`, not to a success', async () => {
    replies({ status: 'not_showable', reason: 'expires_at' })

    expect(await setVisible(STAFF, true)).toEqual({
      status: 'expired',
      visible: null,
      updatedAt: null,
      cacheTags: [],
    })
  })

  it('maps a refused restore of a blank message to `blank`', async () => {
    replies({ status: 'not_showable', reason: 'message' })

    expect((await setVisible(STAFF, true)).status).toBe('blank')
  })

  it('treats an unreachable database as a failure that changed nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } })

    expect(await setVisible(STAFF, false)).toEqual({
      status: 'failed',
      visible: null,
      updatedAt: null,
      cacheTags: [],
    })
  })

  it('treats a reply it does not recognise as a failure rather than a success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    replies({ status: 'definitely_fine' })

    expect((await setVisible(STAFF, false)).status).toBe('failed')
  })

  it('treats the unreachable `invalid_request` as a failure, never as a change', async () => {
    replies({ status: 'invalid_request' })

    expect(await setVisible(STAFF, false)).toEqual({
      status: 'failed',
      visible: null,
      updatedAt: null,
      cacheTags: [],
    })
  })
})

describe('who may perform it (§5)', () => {
  it('lets an owner remove the announcement', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { is_visible: false } })

    expect((await setVisible(OWNER, false)).status).toBe('updated')
  })

  it('refuses a deactivated account before the database is asked at all', async () => {
    const disabled: Profile = { ...STAFF, disabledAt: '2026-08-01T00:00:00.000Z' }

    expect(await setVisible(disabled, false)).toEqual({
      status: 'forbidden',
      visible: null,
      updatedAt: null,
      cacheTags: [],
    })
    expect(rpc, 'a refused caller reaches no query').not.toHaveBeenCalled()
  })

  it('asks the role matrix before it asks the database, in both directions', async () => {
    const disabled: Profile = { ...STAFF, disabledAt: '2026-08-01T00:00:00.000Z' }

    await setVisible(disabled, true)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('the sentence the Fortryd strip carries', () => {
  it('reports the state the bar is in now, not the one Fortryd would restore', async () => {
    const { describeAnnouncementVisibilityChange } = await import(
      '@/lib/announcements/visibility'
    )

    expect(describeAnnouncementVisibilityChange({ visible: false })).toBe(
      'Beskeden er fjernet fra hjemmesiden.',
    )
    expect(describeAnnouncementVisibilityChange({ visible: true })).toBe(
      'Beskeden vises igen på hjemmesiden.',
    )
  })
})

/**
 * The boundary §14 asks to be kept, asserted over the module's own source.
 *
 * The announcement path has one thing to keep out that the three sold-out paths do not:
 * this operation runs **beside a pending draft**, on the same row the draft belongs to.
 * A single reach into the draft machinery would be the difference between "the bar is
 * gone" and "somebody's unpublished message went live".
 */
describe('the immediate path does not leak into publishing, or into the draft', () => {
  const source = readFileSync(join(process.cwd(), 'lib/announcements/visibility.ts'), 'utf8')

  it.each([
    ['a draft write', '@/lib/publishing/drafts'],
    ['the draft overlay', '@/lib/drafts/'],
    ['the pending-changes read', '@/lib/publishing/pending'],
    ['the publish transaction', '@/lib/publishing/publish'],
    ['the announcement schema', '@/lib/schemas/announcement'],
  ])('does not reach for %s', (_what, needle) => {
    expect(source).not.toContain(needle)
  })

  /**
   * The module's own prose names these, to say it cannot reach them. The assertion is
   * about the code, so the comments are removed before it is made.
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it.each([['draft'], ['previous'], ['replaced_at'], ['source'], ['link_']])(
    'never names the column %s',
    (column) => {
      expect(code).not.toContain(column)
    },
  )

  /*
   * `message` and `expires_at` *are* named, and must be: they are the two `reason` values
   * the database's refusal can carry (1ac's two standing rules), which this module reads
   * in order to word them. Reading a refusal's reason is the opposite of writing a
   * column, so the property worth asserting is the stronger one below — that this module
   * issues no table write of its own at all.
   */
  it('issues no table write of its own — one RPC and nothing else', () => {
    expect(code).not.toContain(".from('announcement')")
    expect(code).not.toContain('.update(')
    expect(code).not.toContain('.insert(')
    expect(code).not.toContain('.delete(')

    const calls = [...code.matchAll(/\.rpc\(\s*'([a-z_]+)'/g)].map((match) => match[1])
    expect(calls).toEqual(['set_announcement_visible'])
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

  it('is server-only, so nothing here can be pulled into a browser bundle', () => {
    expect(source).toContain("import 'server-only'")
  })
})

/**
 * The Server Action's own promises, asserted over its source.
 *
 * Three of them are ordering facts a mock cannot easily prove and a reader must not have
 * to take on trust: the guard runs before anything else, the cache is expired only after
 * a status that reached the row, and there is exactly **one** call to the business
 * operation — which is what makes 1ad's two controls two entrances rather than two
 * implementations.
 */
describe('the Server Action', () => {
  const source = readFileSync(
    join(process.cwd(), 'app/(admin)/admin/besked/visibility-actions.ts'),
    'utf8',
  )

  const whole = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  /** The action's own body, so the import block's ordering is not mistaken for it. */
  const code = whole.slice(whole.indexOf('export async function setAnnouncementVisibility'))

  it('calls requireStaff before it reads the submission or writes anything', () => {
    const guard = code.indexOf('requireStaff()')
    const parse = code.indexOf('readAnnouncementVisibilityForm')
    const write = code.indexOf('setAnnouncementVisible(')

    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(parse)
    expect(parse).toBeLessThan(write)
  })

  it('performs the business operation exactly once', () => {
    expect(code.match(/setAnnouncementVisible\(/g)).toHaveLength(1)
  })

  it('expires the cache only for a status of `updated`', () => {
    expect(code).toMatch(/status === 'updated'\s*\)\s*\{\s*expirePublicCacheTags/)
    expect(code.match(/expirePublicCacheTags\(/g)).toHaveLength(1)
  })

  it('never reaches the draft or publish machinery', () => {
    for (const needle of [
      '@/lib/publishing',
      '@/lib/drafts',
      'saveEntityDraft',
      'publishPendingChanges',
      'readAdminAnnouncement',
    ]) {
      expect(source).not.toContain(needle)
    }
  })
})
