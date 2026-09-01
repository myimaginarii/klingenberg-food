import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Profile } from '@/lib/auth/session'
import { derivativePathsFor } from '@/lib/images/derivatives'
import { finalizeImageUpload } from '@/lib/images/finalize'
import { requestImageUpload } from '@/lib/images/signed-upload'
import { createImageStorage, type ImageStorage } from '@/lib/images/storage'

/**
 * The signed upload token's lifetime and reuse behaviour — phase 10B (brief §7
 * and §8).
 *
 * 10A verified that a token is path-bound (a mis-pathed PUT is refused) and that
 * the bucket enforces its own limits. What 10B adds — because the real UI now
 * hands these URLs to a browser — is the exact lifetime the SDK mints, whether
 * the URL can be REUSED inside that lifetime, and what a replay can and cannot do
 * to an already-finalized original. The findings are pinned here so a Supabase
 * upgrade that changes the contract fails a test instead of a security review.
 *
 * WHAT THE PINNED CONTRACT IS, and why it is acceptable:
 *
 *   * The token is a signed JWT whose lifetime the storage SDK fixes at TWO HOURS
 *     (`createSignedUploadUrl` exposes no expiry option). Long for a single PUT,
 *     but the token is not a general capability: it authorizes one path in the
 *     PRIVATE bucket, it travels over TLS to the authenticated staff member who
 *     asked for it, and nothing becomes public or recorded until finalize — which
 *     requires a staff session and revalidates the actual bytes.
 *   * Within its lifetime the token CANNOT overwrite: the upload endpoint refuses
 *     a second PUT to the same path once an object exists (`x-upsert` is pinned
 *     false at mint time, and the header cannot override it). So same-path replay
 *     before finalize is a 409, replay after finalize cannot corrupt the original
 *     out from under the derivatives, and the one race that remains — two PUTs
 *     before the object exists — is between two requests by the same person
 *     carrying the same bytes' authority, settled by finalize re-reading whatever
 *     won and validating it whole.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let storage: ImageStorage
let staffClient: SupabaseClient
let staffProfile: Profile

const createdPaths: string[] = []

beforeAll(async () => {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error(
      'The token integration tests need the local Supabase stack: run `npm run db:start`.',
    )
  }

  storage = createImageStorage()

  staffClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await staffClient.auth.signInWithPassword({
    email: 'staff@example.test',
    password: 'LocalStaff12345',
  })
  if (error || !data.user) {
    throw new Error(`Could not sign in as staff@example.test (${error?.message}).`)
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

async function grantedUpload() {
  const bytes = await sharp({
    create: { width: 200, height: 150, channels: 3, background: { r: 120, g: 60, b: 30 } },
  })
    .jpeg()
    .toBuffer()

  const granted = await requestImageUpload(storage, staffProfile, {
    declaredMime: 'image/jpeg',
    declaredBytes: bytes.byteLength,
    filename: 'token-test.jpg',
  })
  expect(granted.status).toBe('ready')
  if (granted.status !== 'ready') throw new Error('unreachable')
  createdPaths.push(granted.target.path)
  return { granted, bytes }
}

function putBytes(url: string, bytes: Uint8Array, contentType = 'image/jpeg', upsert = 'false') {
  return fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-upsert': upsert },
    body: new Uint8Array(bytes),
  })
}

/** The JWT's payload, decoded without verification — we only read the claims. */
function tokenClaims(url: string): Record<string, unknown> {
  const token = new URL(url).searchParams.get('token')
  expect(token, 'the signed URL carries its token as a query parameter').not.toBeNull()

  const segments = token!.split('.')
  expect(segments, 'the token is a three-segment JWT').toHaveLength(3)

  return JSON.parse(Buffer.from(segments[1]!, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >
}

describe('the token lifetime (brief §8)', () => {
  it('is the SDK-fixed two hours, bound to the one minted path', async () => {
    const { granted } = await grantedUpload()
    const claims = tokenClaims(granted.target.url)

    // The token authorizes exactly the path the server minted — the same fact the
    // 10A mis-pathed-PUT test proves from the outside, read here from the claim.
    expect(String(claims.url)).toContain(granted.target.path)

    // The lifetime. `createSignedUploadUrl` exposes no expiry option, so this is
    // the SDK's own number; if an upgrade changes it, this assertion says so.
    const exp = Number(claims.exp)
    const iat = Number(claims.iat)
    expect(Number.isFinite(exp)).toBe(true)
    expect(Number.isFinite(iat)).toBe(true)

    const lifetimeSeconds = exp - iat
    expect(lifetimeSeconds, `actual signed-upload token lifetime: ${lifetimeSeconds}s`).toBe(7200)
  })
})

describe('reuse within the lifetime (brief §7)', () => {
  it('a second PUT to the same URL cannot overwrite the uploaded original', async () => {
    const { granted, bytes } = await grantedUpload()

    const first = await putBytes(granted.target.url, bytes)
    expect(first.ok).toBe(true)

    // Same valid token, same path, different bytes: the object exists and the
    // token was minted without upsert, so the replay must not replace it.
    const other = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 0, g: 200, b: 0 } },
    })
      .jpeg()
      .toBuffer()

    const replay = await putBytes(granted.target.url, other)
    expect(replay.ok, 'a same-path replay over an existing original is refused').toBe(false)
    // The refusal code is the storage service's own (this version answers 400,
    // "The resource already exists"); the contract pinned here is the refusal.
    expect(replay.status).toBeGreaterThanOrEqual(400)

    // The stored original is byte-for-byte the first upload.
    const stored = await storage.downloadOriginal(granted.target.path)
    expect(stored).not.toBeNull()
    expect(Buffer.compare(Buffer.from(stored!), bytes)).toBe(0)
  })

  it('the x-upsert header cannot widen the token into an overwrite', async () => {
    const { granted, bytes } = await grantedUpload()

    expect((await putBytes(granted.target.url, bytes)).ok).toBe(true)

    const other = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 200, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer()

    // The client asks for upsert; the token was not minted for it. If this ever
    // starts succeeding, same-path replay stops being harmless and the finalize
    // model must be re-examined — which is exactly why it is pinned.
    const forced = await putBytes(granted.target.url, other, 'image/jpeg', 'true')
    expect(forced.ok, 'x-upsert: true with a non-upsert token is refused').toBe(false)

    const stored = await storage.downloadOriginal(granted.target.path)
    expect(Buffer.compare(Buffer.from(stored!), bytes)).toBe(0)
  })

  it('after finalize, the original can no longer be changed through the token', async () => {
    const { granted, bytes } = await grantedUpload()

    expect((await putBytes(granted.target.url, bytes)).ok).toBe(true)

    const finalized = await finalizeImageUpload(
      { storage, database: staffClient },
      staffProfile,
      { storagePath: granted.target.path, originalFilename: 'token-test.jpg' },
    )
    expect(finalized.status).toBe('created')

    // The row exists and the derivatives are public; a replay now must be able to
    // change neither the original nor the record.
    const other = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 0, g: 0, b: 200 } },
    })
      .jpeg()
      .toBuffer()

    const replay = await putBytes(granted.target.url, other)
    expect(replay.ok, 'the original is immutable behind the finalized row').toBe(false)

    const stored = await storage.downloadOriginal(granted.target.path)
    expect(Buffer.compare(Buffer.from(stored!), bytes)).toBe(0)
  })

  it('a PUT-complete upload that nobody finalizes stays a private orphan', async () => {
    const { granted, bytes } = await grantedUpload()
    expect((await putBytes(granted.target.url, bytes)).ok).toBe(true)

    // No finalize: no row…
    const { count } = await staffClient
      .from('images')
      .select('id', { count: 'exact', head: true })
      .eq('storage_path', granted.target.path)
    expect(count).toBe(0)

    // …and nothing public. The token bought bytes in a private bucket, nothing more.
    const publicRead = await fetch(
      `${SUPABASE_URL}/storage/v1/object/public/media-originals/${granted.target.path}`,
    )
    expect(publicRead.ok).toBe(false)
  })
})
