import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/auth/session'

/**
 * What the application does around the news writes — technical plan §4, §5, §6, §20.
 *
 * The database decides everything that matters; this file asserts the thin layer
 * above it, which is where the quiet mistakes would live:
 *
 *   1. **A write reaching a column the editor does not own.** The UPDATE payload must
 *      be exactly the five content fields — never `status`, `published_at` or
 *      `image_id` (phase 10's column, preserved by never being named).
 *   2. **Concurrency in name only.** The version token must be in the UPDATE's own
 *      filter, and zero rows must be told apart honestly: still exists → `conflict`,
 *      gone → `not_found`. No silent overwrite, and no audit row for a refusal.
 *   3. **A draft save reported as public.** `isPublic` is read back from the row the
 *      database answered with, and it is what the action's cache expiry hangs on
 *      (§20) — a wrong `true` would falsely expire the public site.
 *
 * The Supabase client is replaced by a recorder; the transactions themselves are
 * proved from real JWTs in `supabase/tests/019_news_admin.test.sql`.
 */

type Reply = { data: unknown; error: { code?: string; message: string } | null }

const replies: Reply[] = []
const tableCalls: { method: string; args: unknown[] }[] = []
const rpc = vi.fn()

function from() {
  const chain: Record<string, unknown> = {}

  for (const method of ['insert', 'update', 'delete', 'select', 'eq']) {
    chain[method] = (...args: unknown[]) => {
      tableCalls.push({ method, args })
      return chain
    }
  }

  chain.maybeSingle = async () => replies.shift() ?? { data: null, error: null }

  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ from, rpc }),
}))

const STAFF: Profile = {
  userId: '00000000-0000-4000-8000-00000000000a',
  email: 'staff@example.test',
  name: 'Lokal Medarbejder',
  role: 'staff',
  disabledAt: null,
}

const OWNER: Profile = { ...STAFF, role: 'owner', name: 'Lokal Ejer' }

const ARTICLE = '33333333-3333-4333-8333-333333333331'
const VERSION = '2026-09-01T10:00:00.000Z'

const VALUES = {
  title: 'Ny burger i oktober',
  slug: 'ny-burger-i-oktober',
  body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Første afsnit.' }] }] },
  category: 'Ny burger' as const,
  display_date: '2026-09-01',
}

const BEFORE = {
  title: 'Gammel overskrift',
  slug: 'ny-burger-i-oktober',
  body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Gammel tekst.' }] }] },
  category: null,
  displayDate: null,
  status: 'published' as const,
}

async function subject() {
  return import('@/lib/news/admin')
}

beforeEach(() => {
  replies.length = 0
  tableCalls.length = 0
  rpc.mockReset()
  rpc.mockResolvedValue({ data: null, error: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('creating (staff and owner alike, §5)', () => {
  it('inserts the content with status draft in the INSERT itself, then audits', async () => {
    replies.push({ data: { id: ARTICLE }, error: null })

    const { createNewsArticle } = await subject()
    const result = await createNewsArticle(STAFF, VALUES)

    expect(result).toEqual({ status: 'saved', articleId: ARTICLE })

    const insert = tableCalls.find((call) => call.method === 'insert')
    expect(insert?.args[0]).toEqual({ ...VALUES, status: 'draft' })

    expect(rpc).toHaveBeenCalledWith('log_audit', {
      p_action: 'create',
      p_entity: 'news',
      p_entity_id: ARTICLE,
      p_before: null,
      p_after: VALUES,
    })
  })

  it('lets an owner create as well', async () => {
    replies.push({ data: { id: ARTICLE }, error: null })

    const { createNewsArticle } = await subject()
    expect((await createNewsArticle(OWNER, VALUES)).status).toBe('saved')
  })

  it('refuses an unknown key before the database is asked at all', async () => {
    const { createNewsArticle } = await subject()
    const result = await createNewsArticle(STAFF, { ...VALUES, image_id: ARTICLE })

    expect(result.status).toBe('invalid')
    expect(tableCalls).toEqual([])
    expect(rpc, 'a refusal writes no audit row').not.toHaveBeenCalled()
  })

  it('refuses a deactivated account before the database is asked at all', async () => {
    const disabled: Profile = { ...STAFF, disabledAt: '2026-08-01T00:00:00.000Z' }

    const { createNewsArticle } = await subject()
    expect((await createNewsArticle(disabled, VALUES)).status).toBe('forbidden')
    expect(tableCalls).toEqual([])
  })

  it('maps the UNIQUE violation to slug_taken — §7f’s race, refused by the final gate', async () => {
    replies.push({ data: null, error: { code: '23505', message: 'duplicate key' } })

    const { createNewsArticle } = await subject()
    expect((await createNewsArticle(STAFF, VALUES)).status).toBe('slug_taken')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('saving an edit', () => {
  function request(overrides: Record<string, unknown> = {}) {
    return {
      articleId: ARTICLE,
      expectedUpdatedAt: VERSION,
      values: VALUES,
      before: BEFORE,
      ...overrides,
    }
  }

  it('updates exactly the five content fields — never status, published_at or image_id', async () => {
    replies.push({ data: { id: ARTICLE, status: 'draft' }, error: null })

    const { saveNewsArticle } = await subject()
    await saveNewsArticle(STAFF, request())

    const update = tableCalls.find((call) => call.method === 'update')
    expect(Object.keys(update?.args[0] as object).sort()).toEqual([
      'body',
      'category',
      'display_date',
      'slug',
      'title',
    ])
  })

  it('puts the version token in the UPDATE’s own filter (§6)', async () => {
    replies.push({ data: { id: ARTICLE, status: 'draft' }, error: null })

    const { saveNewsArticle } = await subject()
    await saveNewsArticle(STAFF, request())

    const filters = tableCalls.filter((call) => call.method === 'eq').map((call) => call.args)
    expect(filters).toEqual([
      ['id', ARTICLE],
      ['updated_at', VERSION],
    ])
  })

  it('reports a draft save as not public and writes no audit row', async () => {
    replies.push({ data: { id: ARTICLE, status: 'draft' }, error: null })

    const { saveNewsArticle } = await subject()
    const result = await saveNewsArticle(STAFF, request())

    expect(result).toEqual({ status: 'saved', isPublic: false })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reports a published save as public and audits it whole — the recovery story (§4)', async () => {
    replies.push({ data: { id: ARTICLE, status: 'published' }, error: null })

    const { saveNewsArticle } = await subject()
    const result = await saveNewsArticle(STAFF, request())

    expect(result).toEqual({ status: 'saved', isPublic: true })
    expect(rpc).toHaveBeenCalledWith('log_audit', {
      p_action: 'update',
      p_entity: 'news',
      p_entity_id: ARTICLE,
      p_before: {
        title: BEFORE.title,
        slug: BEFORE.slug,
        body: BEFORE.body,
        category: BEFORE.category,
        display_date: BEFORE.displayDate,
      },
      p_after: VALUES,
    })
  })

  it('tells a stale token apart from a deleted row: still there is a conflict', async () => {
    replies.push({ data: null, error: null }) // the guarded UPDATE wrote nothing
    replies.push({ data: { id: ARTICLE }, error: null }) // …but the row exists

    const { saveNewsArticle } = await subject()
    const result = await saveNewsArticle(STAFF, request())

    expect(result).toEqual({ status: 'conflict', isPublic: false })
    expect(rpc, 'no false audit for a write that did not happen').not.toHaveBeenCalled()
  })

  it('…and gone is not_found', async () => {
    replies.push({ data: null, error: null })
    replies.push({ data: null, error: null })

    const { saveNewsArticle } = await subject()
    expect((await saveNewsArticle(STAFF, request())).status).toBe('not_found')
  })

  it('maps the UNIQUE violation to slug_taken here as well', async () => {
    replies.push({ data: null, error: { code: '23505', message: 'duplicate key' } })

    const { saveNewsArticle } = await subject()
    expect((await saveNewsArticle(STAFF, request())).status).toBe('slug_taken')
  })

  it('refuses an unknown key before the database is asked', async () => {
    const { saveNewsArticle } = await subject()
    const result = await saveNewsArticle(
      STAFF,
      request({ values: { ...VALUES, status: 'published' } }),
    )

    expect(result.status).toBe('invalid')
    expect(tableCalls).toEqual([])
  })
})

describe('the two trusted transitions', () => {
  it('unpublish maps the database’s answer and expires news only when it happened', async () => {
    rpc.mockResolvedValue({ data: { status: 'unpublished' }, error: null })

    const { unpublishNewsArticle } = await subject()
    const result = await unpublishNewsArticle(STAFF, {
      articleId: ARTICLE,
      expectedUpdatedAt: VERSION,
    })

    expect(rpc).toHaveBeenCalledWith('unpublish_news', {
      p_id: ARTICLE,
      p_expected_updated_at: VERSION,
    })
    expect(result).toEqual({ status: 'unpublished', cacheTags: ['news'] })
  })

  it.each(['nothing_to_unpublish', 'conflict', 'not_found', 'forbidden'] as const)(
    'unpublish passes %s through with no cache tag',
    async (status) => {
      rpc.mockResolvedValue({ data: { status }, error: null })

      const { unpublishNewsArticle } = await subject()
      expect(
        await unpublishNewsArticle(STAFF, { articleId: ARTICLE, expectedUpdatedAt: VERSION }),
      ).toEqual({ status, cacheTags: [] })
    },
  )

  it('deleting a published article expires news', async () => {
    rpc.mockResolvedValue({ data: { status: 'deleted', was_published: true }, error: null })

    const { deleteNewsArticle } = await subject()
    expect(
      await deleteNewsArticle(STAFF, { articleId: ARTICLE, expectedUpdatedAt: VERSION }),
    ).toEqual({ status: 'deleted', cacheTags: ['news'] })
  })

  it('deleting a draft expires nothing — a guest could never read it (§20)', async () => {
    rpc.mockResolvedValue({ data: { status: 'deleted', was_published: false }, error: null })

    const { deleteNewsArticle } = await subject()
    expect(
      (await deleteNewsArticle(STAFF, { articleId: ARTICLE, expectedUpdatedAt: VERSION }))
        .cacheTags,
    ).toEqual([])
  })

  it('treats a reply it does not recognise as a failure rather than a success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: { status: 'definitely_fine' }, error: null })

    const { deleteNewsArticle } = await subject()
    expect(
      (await deleteNewsArticle(STAFF, { articleId: ARTICLE, expectedUpdatedAt: VERSION })).status,
    ).toBe('failed')
  })
})

/**
 * The boundary the phase brief asks to be kept, asserted over the module's own
 * source: news must not be forced into the generic draft machinery (§4), and the
 * module returns cache tags for the actions to expire rather than expiring anything
 * itself — the order §6 depends on lives in one short Server Action, not here.
 */
describe('the news writes do not leak into the draft machinery', () => {
  const source = readFileSync(join(process.cwd(), 'lib/news/admin.ts'), 'utf8')

  it.each([
    ['a draft write', '@/lib/publishing/drafts'],
    ['the draft overlay', '@/lib/drafts/'],
    ['the pending-changes read', '@/lib/publishing/pending'],
    ['the publish transaction', '@/lib/publishing/publish'],
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
