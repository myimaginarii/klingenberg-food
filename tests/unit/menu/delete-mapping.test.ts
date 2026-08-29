import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/auth/session'

/**
 * What the application does with the database's answer — technical plan §6, §7e item 4.
 *
 * `set_dish_deleted()` decides everything that matters; this file asserts the thin layer
 * above it, which is where the quiet mistakes would live:
 *
 *   1. **A refusal reported as a success.** Every status but `deleted`/`restored` must
 *      produce no cache tags, so a write that did not happen can never expire the public
 *      menu — and never make a Forside look as though a dish left it when it did not.
 *   2. **`unchanged` treated as a change.** Pressing Fortryd twice must not expire a tag
 *      for a row that did not move, and must not offer an undo of nothing.
 *   3. **The state echoed from the request rather than read from the row.** What the
 *      screen reports has to be what was stored, so the result is built from the
 *      database's `after`, not from what was asked for.
 *   4. **A restore travelling a different path from a delete.** Both go through one
 *      function with one boolean, so there is no second, less-examined endpoint for the
 *      reverse direction — asserted by the arguments below.
 *
 * The Supabase client is replaced by a recorder, so the assertions are about the mapping
 * and about the arguments the RPC is called with — not about PostgREST. The transaction
 * itself is proved from real JWTs in `supabase/tests/007_soft_delete.test.sql`.
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
const VERSION = '2026-08-29T16:00:00.000Z'
const DELETED_AT = '2026-08-29T16:00:05.000Z'

/** The module under test, imported after the mock is registered. */
async function setDishDeleted(profile: Profile, deleted: boolean) {
  const { setDishDeleted: subject } = await import('@/lib/menu/delete')

  return subject(profile, { dishId: DISH, deleted, expectedUpdatedAt: VERSION })
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
  it('sends the dish, the intent and the version token — and nothing else', async () => {
    replies({ status: 'deleted', updated_at: DELETED_AT, after: { deleted_at: DELETED_AT } })

    await setDishDeleted(STAFF, true)

    expect(rpc).toHaveBeenCalledWith('set_dish_deleted', {
      p_id: DISH,
      p_deleted: true,
      p_expected_updated_at: VERSION,
    })
  })

  it('sends the same three arguments for a restore, down the same function', async () => {
    replies({ status: 'restored', updated_at: DELETED_AT, after: { deleted_at: null } })

    await setDishDeleted(STAFF, false)

    expect(rpc).toHaveBeenCalledWith('set_dish_deleted', {
      p_id: DISH,
      p_deleted: false,
      p_expected_updated_at: VERSION,
    })
  })

  it('calls exactly one function, so the transaction cannot be split in two', async () => {
    replies({ status: 'deleted', updated_at: DELETED_AT, after: { deleted_at: DELETED_AT } })

    await setDishDeleted(STAFF, true)

    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('never sends a deletion instant of its own choosing', async () => {
    replies({ status: 'deleted', updated_at: DELETED_AT, after: { deleted_at: DELETED_AT } })

    await setDishDeleted(STAFF, true)

    // `deleted_at` is `now()` inside the transaction. A timestamp chosen here would be
    // a second clock, and two clocks disagree.
    expect(JSON.stringify(rpc.mock.calls[0]?.[1])).not.toContain('deleted_at')
  })
})

describe('how the database’s answer is mapped', () => {
  it('reports a deletion, its new version token and the menu cache tag', async () => {
    replies({ status: 'deleted', updated_at: DELETED_AT, after: { deleted_at: DELETED_AT } })

    expect(await setDishDeleted(STAFF, true)).toEqual({
      status: 'deleted',
      deleted: true,
      updatedAt: DELETED_AT,
      // One tag for both pages: the Forside's featured burgers come from the same
      // cached read as the menu, so a deleted dish leaves both in the same request.
      cacheTags: ['menu'],
    })
  })

  it('reports a restore the same way, so the dish returns to both pages at once', async () => {
    replies({ status: 'restored', updated_at: DELETED_AT, after: { deleted_at: null } })

    expect(await setDishDeleted(STAFF, false)).toEqual({
      status: 'restored',
      deleted: false,
      updatedAt: DELETED_AT,
      cacheTags: ['menu'],
    })
  })

  it('reads the state back from the row rather than echoing the request', async () => {
    // The request asked for a deletion; the database says the stored value is null.
    // The row is the authority, so the result must say the dish is present.
    replies({ status: 'deleted', updated_at: DELETED_AT, after: { deleted_at: null } })

    expect((await setDishDeleted(STAFF, true)).deleted).toBe(false)
  })

  it('expires nothing when the dish already stood that way', async () => {
    replies({ status: 'unchanged', updated_at: VERSION, after: { deleted_at: DELETED_AT } })

    expect(await setDishDeleted(STAFF, true)).toEqual({
      status: 'unchanged',
      deleted: true,
      updatedAt: VERSION,
      cacheTags: [],
    })
  })

  it.each(['conflict', 'not_found', 'forbidden'] as const)(
    'passes %s through with no cache tag and no version token',
    async (status) => {
      replies({ status })

      expect(await setDishDeleted(STAFF, true)).toEqual({
        status,
        deleted: null,
        updatedAt: null,
        cacheTags: [],
      })
    },
  )

  it('treats an unreachable database as a failure that changed nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } })

    expect(await setDishDeleted(STAFF, true)).toEqual({
      status: 'failed',
      deleted: null,
      updatedAt: null,
      cacheTags: [],
    })
  })

  it('treats a reply it does not recognise as a failure rather than a success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    replies({ status: 'definitely_fine' })

    expect((await setDishDeleted(STAFF, true)).status).toBe('failed')
  })
})

describe('who may perform it (§5)', () => {
  it('lets an owner delete a dish', async () => {
    replies({ status: 'deleted', updated_at: DELETED_AT, after: { deleted_at: DELETED_AT } })

    expect((await setDishDeleted(OWNER, true)).status).toBe('deleted')
  })

  it('refuses a deactivated account before the database is asked at all', async () => {
    const disabled: Profile = { ...STAFF, disabledAt: '2026-08-01T00:00:00.000Z' }

    expect(await setDishDeleted(disabled, true)).toEqual({
      status: 'forbidden',
      deleted: null,
      updatedAt: null,
      cacheTags: [],
    })
    expect(rpc, 'a refused caller reaches no query').not.toHaveBeenCalled()
  })

  it('refuses the same caller a restore, so the two directions cannot diverge', async () => {
    const disabled: Profile = { ...STAFF, disabledAt: '2026-08-01T00:00:00.000Z' }

    expect((await setDishDeleted(disabled, false)).status).toBe('forbidden')
    expect(rpc).not.toHaveBeenCalled()
  })
})
