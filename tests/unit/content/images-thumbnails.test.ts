import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The row thumbnails read — phase 12A (1r / 1y's FOTO frame on the dish rows).
 *
 * `readAdminImageThumbnails` is the one read behind every photo on the dish list. It
 * must be *one* query for a whole section, ask for the three columns a thumbnail
 * needs and nothing more, and hand back the same derivative plan the library's own
 * cards use: the smallest public rung, as absolute URLs under the public bucket —
 * never a path under the private original. The Supabase client is replaced by a
 * recorder; the derivative plan itself is proved in `tests/unit/images/library.test.ts`.
 */

type Query = { table: string; columns: string; ids: readonly string[] | null }

const queries: Query[] = []
let imageRows: unknown[] = []

function from(table: string) {
  const chain: Record<string, unknown> = {}
  const query: Query = { table, columns: '', ids: null }

  chain.select = (requested: string) => {
    query.columns = requested
    queries.push(query)
    return chain
  }
  chain.in = (_column: string, ids: readonly string[]) => {
    query.ids = ids
    return chain
  }
  chain.returns = () => chain
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolve({ data: table === 'images' ? imageRows : [], error: null }))

  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ from }),
  createSupabasePublicClient: () => {
    throw new Error('the administration never reads anonymously')
  },
}))

const ORIGIN = 'http://localhost:54321'
const UPLOAD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UPLOAD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const IMAGE_A = '11111111-1111-4111-8111-111111111111'
const IMAGE_B = '22222222-2222-4222-8222-222222222222'
const IMAGE_C = '33333333-3333-4333-8333-333333333333'

const DERIVATIVES = {
  formats: ['avif', 'webp'],
  widths: [
    { width: 960, height: 640 },
    { width: 480, height: 320 },
  ],
}

beforeEach(() => {
  queries.length = 0
  imageRows = []
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ORIGIN)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('readAdminImageThumbnails', () => {
  it('asks the images table once, for exactly the three columns a thumbnail needs', async () => {
    imageRows = [{ id: IMAGE_A, storage_path: `${UPLOAD_A}/original.jpg`, derivatives: DERIVATIVES }]

    const { readAdminImageThumbnails } = await import('@/lib/content/images-admin')
    await readAdminImageThumbnails([IMAGE_A, IMAGE_B, IMAGE_A])

    expect(queries).toHaveLength(1)
    expect(queries[0]?.table).toBe('images')
    expect(queries[0]?.columns).toBe('id, storage_path, derivatives')
    // Deduplicated, and nothing about usage or the reference view is read.
    expect(queries[0]?.ids).toEqual([IMAGE_A, IMAGE_B])
  })

  it('reads nothing at all for a section without a single photo', async () => {
    const { readAdminImageThumbnails } = await import('@/lib/content/images-admin')
    const thumbnails = await readAdminImageThumbnails([])

    expect(thumbnails.size).toBe(0)
    expect(queries).toHaveLength(0)
  })

  it('maps each row to the smallest public rung as absolute URLs — never the original', async () => {
    imageRows = [
      { id: IMAGE_A, storage_path: `${UPLOAD_A}/original.jpg`, derivatives: DERIVATIVES },
      { id: IMAGE_B, storage_path: `${UPLOAD_B}/original.png`, derivatives: DERIVATIVES },
    ]

    const { readAdminImageThumbnails } = await import('@/lib/content/images-admin')
    const thumbnails = await readAdminImageThumbnails([IMAGE_A, IMAGE_B])

    expect(thumbnails.get(IMAGE_A)).toEqual({
      webpUrl: `${ORIGIN}/storage/v1/object/public/media/${UPLOAD_A}/480.webp`,
      avifUrl: `${ORIGIN}/storage/v1/object/public/media/${UPLOAD_A}/480.avif`,
      width: 480,
      height: 320,
    })
    expect(thumbnails.get(IMAGE_B)?.webpUrl).toBe(
      `${ORIGIN}/storage/v1/object/public/media/${UPLOAD_B}/480.webp`,
    )

    for (const thumbnail of thumbnails.values()) {
      for (const url of [thumbnail.webpUrl, thumbnail.avifUrl]) {
        expect(url).not.toContain('media-originals')
        expect(url).not.toContain('original.')
      }
    }
  })

  it('leaves out an id the database did not answer, and a row without a usable record', async () => {
    imageRows = [
      { id: IMAGE_A, storage_path: `${UPLOAD_A}/original.jpg`, derivatives: DERIVATIVES },
      // A record that cannot be rendered safely draws the empty frame instead.
      { id: IMAGE_B, storage_path: `${UPLOAD_B}/original.jpg`, derivatives: null },
    ]

    const { readAdminImageThumbnails } = await import('@/lib/content/images-admin')
    const thumbnails = await readAdminImageThumbnails([IMAGE_A, IMAGE_B, IMAGE_C])

    expect([...thumbnails.keys()]).toEqual([IMAGE_A])
    expect(thumbnails.has(IMAGE_B)).toBe(false)
    expect(thumbnails.has(IMAGE_C)).toBe(false)
  })
})
