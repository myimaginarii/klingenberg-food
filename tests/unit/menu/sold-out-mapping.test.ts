import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/auth/session'

/**
 * What the application does with the database's answer — technical plan §6, §7b.
 *
 * `set_dish_sold_out()` decides everything that matters; this file asserts the thin
 * layer above it, which is where three quiet mistakes would live:
 *
 *   1. **A refusal reported as a success.** Every status but `updated`/`unchanged`
 *      must produce no cache tags, so a write that did not happen can never expire the
 *      public menu (the split described in `availability-actions.ts`).
 *   2. **`unchanged` treated as a change.** Pressing Udsolgt twice must not offer an
 *      undo of nothing, and must not expire a tag for a row that did not move.
 *   3. **The state echoed from the request rather than read from the row.** What the
 *      screen reports has to be what was stored, so the result is built from the
 *      database's `after`, not from what was asked for.
 *
 * The Supabase client is replaced by a recorder, so the assertions are about the
 * mapping and about the arguments the RPC is called with — not about PostgREST.
 * The transaction itself is proved from real JWTs in `supabase/tests/006_sold_out.test.sql`.
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

const DISH = '22222222-2222-4222-8222-222222222221'
const VERSION = '2026-08-26T16:00:00.000Z'
const NOW = new Date('2026-08-26T16:00:00Z')

/** The module under test, imported after the mock is registered. */
async function setDishSoldOut(profile: Profile, soldOut: boolean) {
  const { setDishSoldOut: subject } = await import('@/lib/menu/sold-out')

  return subject(profile, { dishId: DISH, soldOut, expectedUpdatedAt: VERSION, now: NOW })
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
  it('sends today’s Copenhagen date, the dish and the version token — and nothing else', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { sold_out_on: '2026-08-26' } })

    await setDishSoldOut(STAFF, true)

    expect(rpc).toHaveBeenCalledWith('set_dish_sold_out', {
      p_id: DISH,
      p_sold_out_on: '2026-08-26',
      p_expected_updated_at: VERSION,
    })
  })

  it('sends a null date when the dish is made available again', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { sold_out_on: null } })

    await setDishSoldOut(STAFF, false)

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_sold_out_on: null })
  })

  it('calls exactly one function, so the transaction cannot be split in two', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { sold_out_on: '2026-08-26' } })

    await setDishSoldOut(STAFF, true)

    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('how the database’s answer is mapped', () => {
  it('reports a change, its new version token and the menu cache tag', async () => {
    replies({
      status: 'updated',
      updated_at: '2026-08-26T16:00:05.000Z',
      after: { sold_out_on: '2026-08-26' },
    })

    expect(await setDishSoldOut(STAFF, true)).toEqual({
      status: 'updated',
      soldOut: true,
      updatedAt: '2026-08-26T16:00:05.000Z',
      cacheTags: ['menu'],
    })
  })

  it('reads the state back from the row rather than echoing the request', async () => {
    // The request asked for "sold out"; the database says the stored value is null.
    // The row is the authority, so the result must say available.
    replies({ status: 'updated', updated_at: VERSION, after: { sold_out_on: null } })

    expect((await setDishSoldOut(STAFF, true)).soldOut).toBe(false)
  })

  it('expires nothing when the dish already held that value', async () => {
    replies({ status: 'unchanged', updated_at: VERSION, after: { sold_out_on: '2026-08-26' } })

    expect(await setDishSoldOut(STAFF, true)).toEqual({
      status: 'unchanged',
      soldOut: true,
      updatedAt: VERSION,
      cacheTags: [],
    })
  })

  it.each(['conflict', 'not_found', 'forbidden', 'invalid_date'] as const)(
    'passes %s through with no cache tag and no version token',
    async (status) => {
      replies({ status })

      expect(await setDishSoldOut(STAFF, true)).toEqual({
        status,
        soldOut: null,
        updatedAt: null,
        cacheTags: [],
      })
    },
  )

  it('treats an unreachable database as a failure that changed nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } })

    expect(await setDishSoldOut(STAFF, true)).toEqual({
      status: 'failed',
      soldOut: null,
      updatedAt: null,
      cacheTags: [],
    })
  })

  it('treats a reply it does not recognise as a failure rather than a success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    replies({ status: 'definitely_fine' })

    expect((await setDishSoldOut(STAFF, true)).status).toBe('failed')
  })
})

describe('who may perform it (§5)', () => {
  it('lets an owner change availability', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { sold_out_on: '2026-08-26' } })

    expect((await setDishSoldOut(OWNER, true)).status).toBe('updated')
  })

  it('refuses a deactivated account before the database is asked at all', async () => {
    const disabled: Profile = { ...STAFF, disabledAt: '2026-08-01T00:00:00.000Z' }

    expect(await setDishSoldOut(disabled, true)).toEqual({
      status: 'forbidden',
      soldOut: null,
      updatedAt: null,
      cacheTags: [],
    })
    expect(rpc, 'a refused caller reaches no query').not.toHaveBeenCalled()
  })
})

/**
 * The boundary §14 asks to be kept, asserted over the module's own source.
 *
 * "Do not mix sold-out logic into Phase 4 draft/publish machinery" is an architectural
 * promise, and an architectural promise that nothing checks is a comment. The immediate
 * path may borrow two *stated facts* from the publishing registry — who may change a
 * dish, and which cache tag a dish appears in — and nothing else: no draft write, no
 * draft merge, no pending-changes read, no publish call.
 */
describe('the immediate path does not leak into publishing', () => {
  const source = readFileSync(join(process.cwd(), 'lib/menu/sold-out.ts'), 'utf8')

  it.each([
    ['a draft write', '@/lib/publishing/drafts'],
    ['the draft overlay', '@/lib/drafts/'],
    ['the pending-changes read', '@/lib/publishing/pending'],
    ['the publish transaction', '@/lib/publishing/publish'],
    ['the draft column', "'draft'"],
  ])('does not reach for %s', (_what, needle) => {
    expect(source).not.toContain(needle)
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
})
