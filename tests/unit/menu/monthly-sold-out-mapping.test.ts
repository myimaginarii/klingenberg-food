import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/auth/session'

/**
 * What the application does with the database's answer, for Månedens burger —
 * technical plan §6, §7b, §7d; design 1ah.
 *
 * The third of the set, and the reason the set is worth having. Phase 6's completion
 * pass reviewed `set_dish_sold_out`, `set_weekly_special_sold_out` and
 * `set_monthly_burger_sold_out` together and kept them as three explicit functions —
 * different tables, different columns, different attribution, no dynamic SQL, no generic
 * privilege path. The price of that decision is that each one has to be audited on its
 * own, and this file is the monthly third of that audit.
 *
 * The mistakes it exists to catch are the three `sold-out-mapping.test.ts` names — a
 * refusal reported as a success, `unchanged` treated as a change, the state echoed
 * rather than read — plus the two properties this singleton has that the others do not:
 * **it takes no row id and no target**, so there is no argument through which it could
 * be pointed at another row.
 *
 * The transaction itself is proved from real JWTs in
 * `supabase/tests/011_monthly_burger.test.sql`.
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
async function setMonthlySoldOut(profile: Profile, soldOut: boolean) {
  const { setMonthlyBurgerSoldOut } = await import('@/lib/menu/monthly-availability')

  return setMonthlyBurgerSoldOut(profile, {
    soldOut,
    expectedUpdatedAt: VERSION,
    now: NOW,
  })
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
  it('sends today’s Copenhagen date and the version token — and nothing else', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { sold_out_on: '2026-08-26' } })

    await setMonthlySoldOut(STAFF, true)

    expect(rpc).toHaveBeenCalledWith('set_monthly_burger_sold_out', {
      p_sold_out_on: '2026-08-26',
      p_expected_updated_at: VERSION,
    })
  })

  it('sends no row id and no target: the singleton locates itself', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { sold_out_on: '2026-08-26' } })

    await setMonthlySoldOut(STAFF, true)

    expect(Object.keys(rpc.mock.calls[0]?.[1] as object).sort()).toEqual([
      'p_expected_updated_at',
      'p_sold_out_on',
    ])
  })

  it('sends a null date when the burger is made available again', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { sold_out_on: null } })

    await setMonthlySoldOut(STAFF, false)

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_sold_out_on: null })
  })

  it('calls exactly one function, so the transaction cannot be split in two', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { sold_out_on: '2026-08-26' } })

    await setMonthlySoldOut(STAFF, true)

    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('how the database’s answer is mapped', () => {
  it('reports a change, its new version token and the monthly cache tag', async () => {
    replies({
      status: 'updated',
      updated_at: '2026-08-26T16:00:05.000Z',
      after: { sold_out_on: '2026-08-26' },
    })

    expect(await setMonthlySoldOut(STAFF, true)).toEqual({
      status: 'updated',
      soldOut: true,
      updatedAt: '2026-08-26T16:00:05.000Z',
      cacheTags: ['monthly'],
    })
  })

  it('reads the state back from the row rather than echoing the request', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { sold_out_on: null } })

    expect((await setMonthlySoldOut(STAFF, true)).soldOut).toBe(false)
  })

  it('expires nothing when the burger already held that value', async () => {
    replies({ status: 'unchanged', updated_at: VERSION, after: { sold_out_on: '2026-08-26' } })

    expect(await setMonthlySoldOut(STAFF, true)).toEqual({
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

      expect(await setMonthlySoldOut(STAFF, true)).toEqual({
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

    expect(await setMonthlySoldOut(STAFF, true)).toEqual({
      status: 'failed',
      soldOut: null,
      updatedAt: null,
      cacheTags: [],
    })
  })

  it('treats a reply it does not recognise as a failure rather than a success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    replies({ status: 'definitely_fine' })

    expect((await setMonthlySoldOut(STAFF, true)).status).toBe('failed')
  })
})

describe('the Copenhagen date is the server’s, and only the server’s (§7b)', () => {
  it('dates the marking from the Copenhagen calendar day, not from UTC', async () => {
    const { monthlySoldOutDateFor } = await import('@/lib/menu/monthly-availability')

    expect(monthlySoldOutDateFor(true, new Date('2026-08-26T23:30:00Z'))).toBe('2026-08-27')
    expect(monthlySoldOutDateFor(true, new Date('2026-08-26T21:30:00Z'))).toBe('2026-08-26')
    expect(monthlySoldOutDateFor(true, new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-15')
  })

  it('writes no date at all when the burger is made available again', async () => {
    const { monthlySoldOutDateFor } = await import('@/lib/menu/monthly-availability')

    expect(monthlySoldOutDateFor(false, new Date('2026-08-26T16:00:00Z'))).toBeNull()
  })
})

describe('who may perform it (§5)', () => {
  it('lets an owner change availability', async () => {
    replies({ status: 'updated', updated_at: VERSION, after: { sold_out_on: '2026-08-26' } })

    expect((await setMonthlySoldOut(OWNER, true)).status).toBe('updated')
  })

  it('refuses a deactivated account before the database is asked at all', async () => {
    const disabled: Profile = { ...STAFF, disabledAt: '2026-08-01T00:00:00.000Z' }

    expect(await setMonthlySoldOut(disabled, true)).toEqual({
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
 * The monthly path has one extra thing to keep out that the other two do not: the date
 * window and "Vis på forsiden" are draft fields (§7d), and this operation must be unable
 * to reach either of them.
 */
describe('the immediate path does not leak into publishing, or into the window', () => {
  const source = readFileSync(join(process.cwd(), 'lib/menu/monthly-availability.ts'), 'utf8')

  it.each([
    ['a draft write', '@/lib/publishing/drafts'],
    ['the draft overlay', '@/lib/drafts/'],
    ['the pending-changes read', '@/lib/publishing/pending'],
    ['the publish transaction', '@/lib/publishing/publish'],
    ['the draft column', "'draft'"],
  ])('does not reach for %s', (_what, needle) => {
    expect(source).not.toContain(needle)
  })

  /**
   * The module's own prose names all three, to say it cannot reach them. The assertion
   * is about the code, so the comments are removed before it is made.
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it.each([['starts_on'], ['ends_on'], ['show_on_homepage']])(
    'never names the draft field %s',
    (field) => {
      expect(code).not.toContain(field)
    },
  )

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
