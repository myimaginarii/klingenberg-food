import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Profile } from '@/lib/auth/session'
import { derivativePathsFor, derivativePublicUrlPath } from '@/lib/images/derivatives'
import { finalizeImageUpload } from '@/lib/images/finalize'
import { requestImageUpload } from '@/lib/images/signed-upload'
import { createImageStorage, type ImageStorage } from '@/lib/images/storage'

/**
 * The large-image runtime — phase 10B (brief §9).
 *
 * 10A benchmarked the pipeline at 1000×700; the accepted maximum is 30 megapixels,
 * and the client downscale is an optimisation a bypassed or scriptless flow never
 * runs — so before the upload UI is accepted, the REAL processing path is driven
 * with a representative near-maximum camera image, generated at run time (no
 * permanent huge fixture). The measured duration is printed so the phase report
 * and the `maxDuration` choice on the library route rest on a number, not a hope.
 *
 * The fixture is a smooth gradient: pixel count is what drives decode/encode cost
 * (the quantity under test), while the encoded bytes stay far under the 10 MiB
 * bucket cap a noise image would burst.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** 6900 × 4300 = 29.67 MP — inside the 30 MP / 10 000 px caps, as a camera is. */
const WIDTH = 6900
const HEIGHT = 4300

let storage: ImageStorage
let staffClient: SupabaseClient
let staffProfile: Profile

const createdPaths: string[] = []

async function gradientJpeg(width: number, height: number): Promise<Buffer> {
  // A raw horizontal gradient with vertical shading: realistic continuous-tone
  // content for the encoders, compact on the wire.
  const row = Buffer.alloc(width * 3)
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    const shade = Math.round((y / height) * 120)
    for (let x = 0; x < width; x += 1) {
      const tone = Math.round((x / width) * 255)
      row[x * 3] = Math.min(255, 60 + ((tone + shade) % 196))
      row[x * 3 + 1] = Math.min(255, 40 + ((tone * 2 + shade) % 180))
      row[x * 3 + 2] = Math.min(255, 30 + ((tone + shade * 2) % 160))
    }
    row.copy(raw, y * width * 3)
  }

  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 82 })
    .toBuffer()
}

beforeAll(async () => {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error(
      'The large-image integration test needs the local Supabase stack: run `npm run db:start`.',
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

describe('a near-maximum camera image through the real pipeline', () => {
  it(
    'finalizes within the route budget, with every derivative truthful',
    { timeout: 300_000 },
    async () => {
      const bytes = await gradientJpeg(WIDTH, HEIGHT)
      expect(bytes.byteLength).toBeLessThanOrEqual(10_485_760)

      const granted = await requestImageUpload(storage, staffProfile, {
        declaredMime: 'image/jpeg',
        declaredBytes: bytes.byteLength,
        filename: 'stort-kamera-foto.jpg',
      })
      expect(granted.status).toBe('ready')
      if (granted.status !== 'ready') return
      createdPaths.push(granted.target.path)

      const put = await fetch(granted.target.url, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
        body: new Uint8Array(bytes),
      })
      expect(put.ok).toBe(true)

      // The measured quantity: download + sniff + decode + 8 derivative encodes
      // + 8 uploads + create_image(), exactly what the 10B finalize action runs.
      const startedAt = performance.now()
      const finalized = await finalizeImageUpload(
        { storage, database: staffClient },
        staffProfile,
        { storagePath: granted.target.path, originalFilename: 'stort-kamera-foto.jpg' },
      )
      const durationMs = Math.round(performance.now() - startedAt)

      // The measurement is the deliverable (brief §9).
      console.info(
        `[images-large] ${WIDTH}x${HEIGHT} (${((WIDTH * HEIGHT) / 1e6).toFixed(1)} MP, ` +
          `${(bytes.byteLength / 1024 / 1024).toFixed(1)} MiB) finalized in ${durationMs} ms`,
      )

      expect(finalized.status).toBe('created')
      if (finalized.status !== 'created') return

      // Far inside the route's 60 s maxDuration, with the whole ladder present.
      expect(durationMs).toBeLessThan(60_000)

      const { data: row } = await staffClient
        .from('images')
        .select('width, height, derivatives')
        .eq('id', finalized.imageId)
        .single()
      expect(row!.width).toBe(WIDTH)
      expect(row!.height).toBe(HEIGHT)
      expect((row!.derivatives as { widths: unknown[] }).widths).toHaveLength(4)

      // The largest public rung really exists and really measures 2160.
      const largest = `${granted.target.path.split('/')[0]}/2160.avif`
      const response = await fetch(`${SUPABASE_URL}${derivativePublicUrlPath(largest)}`)
      expect(response.ok).toBe(true)
      const meta = await sharp(new Uint8Array(await response.arrayBuffer())).metadata()
      expect(meta.width).toBe(2160)
    },
  )

  it(
    'an over-limit image is refused whole and cleaned up again',
    { timeout: 300_000 },
    async () => {
      // 7900 × 3900 = 30.81 MP: past the 30 MP cap while under 10 000 px per side
      // and under 10 MiB on the wire — only the pixel rule can refuse it.
      const bytes = await gradientJpeg(7900, 3900)
      expect(bytes.byteLength).toBeLessThanOrEqual(10_485_760)

      const granted = await requestImageUpload(storage, staffProfile, {
        declaredMime: 'image/jpeg',
        declaredBytes: bytes.byteLength,
        filename: 'for-stort.jpg',
      })
      expect(granted.status).toBe('ready')
      if (granted.status !== 'ready') return
      createdPaths.push(granted.target.path)

      const put = await fetch(granted.target.url, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
        body: new Uint8Array(bytes),
      })
      expect(put.ok).toBe(true)

      const finalized = await finalizeImageUpload(
        { storage, database: staffClient },
        staffProfile,
        { storagePath: granted.target.path },
      )
      expect(finalized.status).toBe('too_many_pixels')

      // The refusal kept nothing: no row, and the original removed again.
      const { count } = await staffClient
        .from('images')
        .select('id', { count: 'exact', head: true })
        .eq('storage_path', granted.target.path)
      expect(count).toBe(0)
      expect(await storage.downloadOriginal(granted.target.path)).toBeNull()
    },
  )
})
