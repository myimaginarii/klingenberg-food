import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/auth/session'
import type { WeeklySoldOutTarget } from '@/lib/menu/weekly'

/**
 * What the application does with the database's answer, for Ugens ret and Lørdagsmenuen
 * — technical plan §6, §7b; design 1ag.
 *
 * The counterpart of `sold-out-mapping.test.ts`, and deliberately its mirror image.
 * Phase 6's completion pass found that only one of the three explicit immediate-path
 * modules had its *mapping* asserted at unit level: `set_weekly_special_sold_out()` and
 * `set_monthly_burger_sold_out()` were exercised end to end and in pgTAP, but the thin
 * layer above them — the layer where a refusal can be reported as a success — was not.
 *
 * Keeping three explicit functions is the right architecture (they name different
 * tables, different columns and different attribution policies), and this file is part
 * of what makes it right: three functions that are each audited are safer than one
 * generic function nobody can point at a reviewed table. Three that share conventions
 * but only one set of assertions are not.
 *
 * The three quiet mistakes this file exists to catch are the same three:
 *
 *   1. **A refusal reported as a success.** Every status but `updated`/`unchanged` must
 *      produce no cache tags, so a write that did not happen can never expire the
 *      public menu.
 *   2. **`unchanged` treated as a change.** Pressing Udsolgt twice must not offer an
 *      undo of nothing.
 *   3. **The state echoed from the request rather than read from the row.**
 *
 * Plus one this screen has and the dish does not: **the target must select the right
 * column of the two on the row.**
 *
 * The Supabase client is replaced by a recorder, so the assertions are about the mapping
 * and the arguments the RPC is called with. The transaction itself is proved from real
 * JWTs in `supabase/tests/010_weekly_special.test.sql`.
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

const VERSION = '2026-08-26T16:00:00.000Z'
const NOW = new Date('2026-08-26T16:00:00Z')

/** The module under test, imported after the mock is registered. */
async function setWeeklySoldOut(
  profile: Profile,
  target: WeeklySoldOutTarget,
  soldOut: boolean,
) {
  const { setWeeklySpecialSoldOut } = await import('@/lib/menu/weekly-availability')

  return setWeeklySpecialSoldOut(profile, {
    target,
    soldOut,
    expectedUpdatedAt: VERSION,
    now: NOW,
  })
}

/** One reply from the database function, in the shape PostgREST returns it. */
function replies(data: unknown) {
  rpc.mockResolvedValue({ data, error: null })
}

/** The two-column `after` the audited shape returns. */
function after(week: string | null, saturday: string | null) {
  return { sold_out_on: week, sat_sold_out_on: saturday }
}

beforeEach(() => {
  rpc.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('what is sent to the database', () => {
  it('sends today’s Copenhagen date, the target and the version token — and nothing else', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: after('2026-08-26', null) })

    await setWeeklySoldOut(STAFF, 'week', true)

    expect(rpc).toHaveBeenCalledWith('set_weekly_special_sold_out', {
      p_target: 'week',
      p_sold_out_on: '2026-08-26',
      p_expected_updated_at: VERSION,
    })
  })

  it('names the Saturday card by its own target, never by a column', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: after(null, '2026-08-26') })

    await setWeeklySoldOut(STAFF, 'saturday', true)

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_target: 'saturday' })
  })

  it('sends a null date when a card is made available again', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: after(null, null) })

    await setWeeklySoldOut(STAFF, 'week', false)

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_sold_out_on: null })
  })

  it('sends no row id: the singleton locates itself', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: after('2026-08-26', null) })

    await setWeeklySoldOut(STAFF, 'week', true)

    expect(Object.keys(rpc.mock.calls[0]?.[1] as object).sort()).toEqual([
      'p_expected_updated_at',
      'p_sold_out_on',
      'p_target',
    ])
  })

  it('calls exactly one function, so the transaction cannot be split in two', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: after('2026-08-26', null) })

    await setWeeklySoldOut(STAFF, 'week', true)

    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('how the database’s answer is mapped', () => {
  it('reports a change, its new version token and the weekly cache tag', async () => {
    replies({
      status: 'updated',
      updated_at: '2026-08-26T16:00:05.000Z',
      after: after('2026-08-26', null),
    })

    expect(await setWeeklySoldOut(STAFF, 'week', true)).toEqual({
      status: 'updated',
      soldOut: true,
      updatedAt: '2026-08-26T16:00:05.000Z',
      cacheTags: ['weekly'],
    })
  })

  it('reads the target’s own column back, not the other card’s', async () => {
    // Only the Saturday column is set. A change asked for on the weekly dish must not
    // read the Saturday value and report the wrong card as sold out.
    replies({ status: 'updated', updated_at: VERSION, after: after(null, '2026-08-26') })

    expect((await setWeeklySoldOut(STAFF, 'week', true)).soldOut).toBe(false)
    expect((await setWeeklySoldOut(STAFF, 'saturday', true)).soldOut).toBe(true)
  })

  it('reads the state back from the row rather than echoing the request', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: after(null, null) })

    expect((await setWeeklySoldOut(STAFF, 'week', true)).soldOut).toBe(false)
  })

  it('expires nothing when the card already held that value', async () => {
    replies({
      status: 'unchanged',
      updated_at: VERSION,
      after: after('2026-08-26', null),
    })

    expect(await setWeeklySoldOut(STAFF, 'week', true)).toEqual({
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

      expect(await setWeeklySoldOut(STAFF, 'week', true)).toEqual({
        status,
        soldOut: null,
        updatedAt: null,
        cacheTags: [],
      })
    },
  )

  it('maps invalid_target to a generic failure, because this module cannot produce one', async () => {
    replies({ status: 'invalid_target' })

    expect(await setWeeklySoldOut(STAFF, 'week', true)).toEqual({
      status: 'failed',
      soldOut: null,
      updatedAt: null,
      cacheTags: [],
    })
  })

  it('treats an unreachable database as a failure that changed nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } })

    expect(await setWeeklySoldOut(STAFF, 'week', true)).toEqual({
      status: 'failed',
      soldOut: null,
      updatedAt: null,
      cacheTags: [],
    })
  })

  it('treats a reply it does not recognise as a failure rather than a success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    replies({ status: 'definitely_fine' })

    expect((await setWeeklySoldOut(STAFF, 'week', true)).status).toBe('failed')
  })
})

describe('the Copenhagen date is the server’s, and only the server’s (§7b)', () => {
  it('dates the marking from the Copenhagen calendar day, not from UTC', async () => {
    const { weeklySoldOutDateFor } = await import('@/lib/menu/weekly-availability')

    // 23:30 UTC in August is 01:30 the next day in Copenhagen.
    expect(weeklySoldOutDateFor(true, new Date('2026-08-26T23:30:00Z'))).toBe('2026-08-27')
    // 21:30 UTC in August is still 23:30 the same day.
    expect(weeklySoldOutDateFor(true, new Date('2026-08-26T21:30:00Z'))).toBe('2026-08-26')
    // Winter, where the offset is one hour rather than two.
    expect(weeklySoldOutDateFor(true, new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-15')
  })

  it('writes no date at all when a card is made available again', async () => {
    const { weeklySoldOutDateFor } = await import('@/lib/menu/weekly-availability')

    expect(weeklySoldOutDateFor(false, new Date('2026-08-26T16:00:00Z'))).toBeNull()
  })
})

describe('who may perform it (§5)', () => {
  it('lets an owner change availability', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: after('2026-08-26', null) })

    expect((await setWeeklySoldOut(OWNER, 'week', true)).status).toBe('updated')
  })

  it('refuses a deactivated account before the database is asked at all', async () => {
    const disabled: Profile = { ...STAFF, disabledAt: '2026-08-01T00:00:00.000Z' }

    expect(await setWeeklySoldOut(disabled, 'week', true)).toEqual({
      status: 'forbidden',
      soldOut: null,
      updatedAt: null,
      cacheTags: [],
    })
    expect(rpc, 'a refused caller reaches no query').not.toHaveBeenCalled()
  })
})

/**
 * The boundary §14 asks to be kept, asserted over the module's own source — the same
 * assertion `sold-out-mapping.test.ts` makes about the dish module, so the two immediate
 * paths on this screen are held to the bar phase 5 set.
 */
describe('the immediate path does not leak into publishing', () => {
  const source = readFileSync(join(process.cwd(), 'lib/menu/weekly-availability.ts'), 'utf8')

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
