import { describe, expect, it, vi } from 'vitest'

/**
 * Usage discovery reads the one trusted reference set — phase 10C-1 (brief §19,
 * §25).
 *
 * `readAdminImageLibrary`'s usage half must come from `public.image_references` —
 * the SECURITY INVOKER view that is also what `delete_image()` counts before
 * refusing with `in_use` — and from nothing else, so a caption and a delete
 * refusal cannot disagree about what "referenced" means. The Supabase client is
 * replaced by a recorder; the view's own rows (live columns plus pending draft
 * keys, from real JWTs) are proved in `supabase/tests/022_image_draft_references.test.sql`.
 */

type Query = { table: string; columns: string }

const queries: Query[] = []
let referenceRows: unknown[] = []

function from(table: string) {
  const chain: Record<string, unknown> = {}
  let columns = ''

  chain.select = (requested: string) => {
    columns = requested
    queries.push({ table, columns })
    return chain
  }
  chain.order = () => chain
  chain.eq = () => chain
  chain.returns = () => chain
  chain.maybeSingle = async () => ({ data: null, error: null })

  // Awaiting the chain resolves the list read; the images table answers empty.
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(
      resolve({ data: table === 'image_references' ? referenceRows : [], error: null }),
    )

  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ from }),
  createSupabasePublicClient: () => {
    throw new Error('the administration never reads anonymously')
  },
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  // `cache()` memoises per render pass; in a test it must not memoise across cases.
  return { ...actual, cache: <T,>(fn: T): T => fn }
})

const IMAGE = '11111111-1111-4111-8111-111111111111'

describe('readAdminImageLibrary — usage from image_references', () => {
  it('asks the view, and maps kinds, names and the pending flag', async () => {
    queries.length = 0
    referenceRows = [
      { image_id: IMAGE, kind: 'dish', name: 'Odin', pending: false },
      { image_id: IMAGE, kind: 'weekly', name: 'Ugens ret', pending: true },
      { image_id: IMAGE, kind: 'news', name: 'Lukket i påsken', pending: true },
    ]

    const { readAdminImageLibrary } = await import('@/lib/content/images-admin')
    await readAdminImageLibrary()

    const usageQuery = queries.find((query) => query.table === 'image_references')
    expect(usageQuery, 'the usage read goes through the trusted view').toBeDefined()
    expect(usageQuery?.columns).toBe('image_id, kind, name, pending')

    // No per-table usage read remains: the view is the one definition (§19).
    const usageTables = queries.map((query) => query.table)
    expect(usageTables).not.toContain('dishes')
    expect(usageTables).not.toContain('weekly_special')
    expect(usageTables).not.toContain('monthly_burger')
    expect(usageTables).not.toContain('news')
  })
})
