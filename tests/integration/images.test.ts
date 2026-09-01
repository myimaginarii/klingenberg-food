import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Profile } from '@/lib/auth/session'
import { derivativePathsFor, derivativePublicUrlPath } from '@/lib/images/derivatives'
import { finalizeImageUpload } from '@/lib/images/finalize'
import { requestImageUpload } from '@/lib/images/signed-upload'
import { createImageStorage, type ImageStorage } from '@/lib/images/storage'

/**
 * The upload pipeline against the real local stack — technical plan §1
 * (adjustments 2 and 3), §8, §9; phase 10A (brief §16, §25, §26).
 *
 * pgTAP owns the database authority boundary (020); the unit suites own the pure
 * rules and the orchestration. What only this suite can honestly cover is the
 * storage HTTP surface itself: that a signed token really is scoped to its one
 * path, that the private bucket really refuses a tokenless PUT, that the public
 * bucket really serves a derivative to an anonymous GET, and that the pipeline's
 * cleanup really removes objects. It runs the same flow functions the 10B Server
 * Actions will call, with real clients built the way the actions will build them —
 * no fake admin screen, no test-only route (brief §26).
 *
 * Prerequisites, exactly as for pgTAP: `npm run db:start` (or a fresh
 * `npm run db:reset:full`) and the seeded local identities.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let storage: ImageStorage
let staffClient: SupabaseClient
let staffProfile: Profile

/** Everything a test created, removed again in afterAll. */
const createdPaths: string[] = []

async function jpegFixture(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 190, g: 90, b: 45 } },
  })
    .jpeg()
    .toBuffer()
}

beforeAll(async () => {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error(
      'The image integration tests need the local Supabase stack: run `npm run db:start` ' +
        'and make sure the Supabase URL and anon key are set (.env.local, or ' +
        '`supabase status -o env`).',
    )
  }

  // Throws its own named error if the service-role key is missing — the key is
  // read only through lib/env/server.ts, here as everywhere (§8).
  storage = createImageStorage()

  staffClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await staffClient.auth.signInWithPassword({
    email: 'staff@example.test',
    password: 'LocalStaff12345',
  })
  if (error || !data.user) {
    throw new Error(
      'Could not sign in as staff@example.test — run `npm run db:users` first ' +
        `(${error?.message}).`,
    )
  }

  staffProfile = {
    userId: data.user.id,
    email: 'staff@example.test',
    name: 'Lokal Medarbejder',
    role: 'staff',
    disabledAt: null,
  }
})

afterAll(async () => {
  // Leave the developer's database as it was: the trusted delete for rows the
  // suite created, then the storage objects behind them.
  for (const path of createdPaths) {
    const { data } = await staffClient
      .from('images')
      .select('id, updated_at, derivatives')
      .eq('storage_path', path)
      .maybeSingle()
    if (data) {
      await staffClient.rpc('delete_image', {
        p_id: data.id,
        p_expected_updated_at: data.updated_at,
        p_confirmed: true,
      })
      await storage.removeDerivatives(
        derivativePathsFor(path, data.derivatives as { formats: []; widths: [] }),
      )
    }
    await storage.removeOriginal(path)
  }
  await staffClient.auth.signOut()
})

async function grantedUpload(declaredMime: string, bytes: number) {
  const granted = await requestImageUpload(storage, staffProfile, {
    declaredMime,
    declaredBytes: bytes,
    filename: 'integration.jpg',
  })
  expect(granted.status).toBe('ready')
  if (granted.status !== 'ready') throw new Error('unreachable')
  createdPaths.push(granted.target.path)
  return granted
}

async function putBytes(url: string, bytes: Uint8Array | Buffer, contentType: string) {
  return fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-upsert': 'false' },
    body: new Uint8Array(bytes),
  })
}

describe('the full pipeline as staff', () => {
  it('request -> upload -> finalize creates a truthful row and public derivatives', async () => {
    const bytes = await jpegFixture(1000, 700)
    const granted = await grantedUpload('image/jpeg', bytes.byteLength)

    const put = await putBytes(granted.target.url, bytes, 'image/jpeg')
    expect(put.ok).toBe(true)

    const finalized = await finalizeImageUpload(
      { storage, database: staffClient },
      staffProfile,
      { storagePath: granted.target.path, originalFilename: 'integration.jpg' },
    )
    expect(finalized.status).toBe('created')
    if (finalized.status !== 'created') return

    // The row records what the server measured — nothing declared.
    const { data: row } = await staffClient
      .from('images')
      .select('*')
      .eq('id', finalized.imageId)
      .single()
    expect(row.storage_path).toBe(granted.target.path)
    expect(row.mime).toBe('image/jpeg')
    expect(row.width).toBe(1000)
    expect(row.height).toBe(700)
    expect(row.bytes).toBe(bytes.byteLength)
    expect(row.original_filename).toBe('integration.jpg')
    expect(row.uploaded_by).toBe(staffProfile.userId)
    expect(row.derivatives).toEqual({
      formats: ['avif', 'webp'],
      widths: [
        { width: 480, height: 336 },
        { width: 960, height: 672 },
      ],
    })

    // Every derivative is really there, really public, really re-encoded.
    for (const path of derivativePathsFor(granted.target.path, row.derivatives)) {
      const response = await fetch(`${SUPABASE_URL}${derivativePublicUrlPath(path)}`)
      expect(response.ok, `public derivative ${path}`).toBe(true)
      const meta = await sharp(new Uint8Array(await response.arrayBuffer())).metadata()
      expect(`${meta.width}`).toBe(path.includes('/480.') ? '480' : '960')
      expect(meta.exif, `${path} carries EXIF`).toBeUndefined()
    }

    // The original is not publicly readable — the private bucket stays private.
    const original = await fetch(
      `${SUPABASE_URL}/storage/v1/object/public/media-originals/${granted.target.path}`,
    )
    expect(original.ok).toBe(false)

    // A replayed finalize converges on the same row instead of duplicating it.
    const replay = await finalizeImageUpload({ storage, database: staffClient }, staffProfile, {
      storagePath: granted.target.path,
    })
    expect(replay.status).toBe('exists')
    if (replay.status !== 'exists') return
    expect(replay.imageId).toBe(finalized.imageId)

    const { count } = await staffClient
      .from('images')
      .select('id', { count: 'exact', head: true })
      .eq('storage_path', granted.target.path)
    expect(count).toBe(1)
  })
})

describe('the storage door', () => {
  it('refuses a tokenless PUT, a mis-pathed token and an anonymous RPC', async () => {
    const bytes = await jpegFixture(100, 100)

    // No token at all.
    const bare = await fetch(
      `${SUPABASE_URL}/storage/v1/object/media-originals/forged/original.jpg`,
      { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array(bytes) },
    )
    expect(bare.ok).toBe(false)

    // A real token, aimed at a different path than it was minted for.
    const granted = await grantedUpload('image/jpeg', bytes.byteLength)
    const forgedUrl = granted.target.url.replace(granted.target.path, 'forged/original.jpg')
    const forged = await putBytes(forgedUrl, bytes, 'image/jpeg')
    expect(forged.ok).toBe(false)

    // The RPC needs a real staff JWT — the anon key alone is refused.
    const anonClient = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anonClient.rpc('create_image', {
      p_storage_path: granted.target.path,
      p_mime: 'image/jpeg',
      p_width: 100,
      p_height: 100,
      p_bytes: 1000,
      p_original_filename: null,
      p_derivatives: { formats: ['avif', 'webp'], widths: [{ width: 100, height: 100 }] },
    })
    expect(error).not.toBeNull()
  })

  it('lets the bucket refuse an oversized body regardless of what was declared', async () => {
    const granted = await grantedUpload('image/jpeg', 1000)
    const oversized = Buffer.alloc(11 * 1024 * 1024)
    const put = await putBytes(granted.target.url, oversized, 'image/jpeg')
    expect(put.ok).toBe(false)
  })
})

describe('refused content leaves nothing behind', () => {
  it('garbage bytes: no row, and the original is removed again', async () => {
    const garbage = new TextEncoder().encode('这 is definitely not a JPEG')
    const granted = await grantedUpload('image/jpeg', garbage.byteLength)

    const put = await putBytes(granted.target.url, garbage, 'image/jpeg')
    expect(put.ok).toBe(true) // the bucket checks the declared type; the server checks the truth

    const finalized = await finalizeImageUpload({ storage, database: staffClient }, staffProfile, {
      storagePath: granted.target.path,
    })
    expect(finalized.status).toBe('not_an_image')

    expect(await storage.downloadOriginal(granted.target.path)).toBeNull()
    const { count } = await staffClient
      .from('images')
      .select('id', { count: 'exact', head: true })
      .eq('storage_path', granted.target.path)
    expect(count).toBe(0)
  })

  it('a declared-type lie is refused before anything public exists', async () => {
    const png = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .png()
      .toBuffer()
    const granted = await grantedUpload('image/jpeg', png.byteLength)

    const put = await putBytes(granted.target.url, png, 'image/jpeg')
    expect(put.ok).toBe(true)

    const finalized = await finalizeImageUpload({ storage, database: staffClient }, staffProfile, {
      storagePath: granted.target.path,
    })
    expect(finalized.status).toBe('unsupported_type')
    expect(await storage.downloadOriginal(granted.target.path)).toBeNull()
  })
})
