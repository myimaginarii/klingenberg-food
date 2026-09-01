import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Profile } from '@/lib/auth/session'
import { finalizeImageUpload } from '@/lib/images/finalize'
import { IMAGE_REFUSALS } from '@/lib/images/rules'
import type { ImageStorage } from '@/lib/images/storage'

/**
 * Finalizing an upload — technical plan §1 (adjustments 2 and 3), §8; phase 10A.
 *
 * The orchestration is exercised against recording fakes of its two dependencies —
 * the narrow storage boundary and the RPC — with the real processing pipeline in
 * the middle, so what this suite pins is exactly the flow's own promises: the
 * database row is written last, every failure branch removes what it wrote, a
 * replay converges instead of duplicating, and nothing browser-supplied reaches
 * the RPC except the minted path and the display filename.
 * tests/integration/images.test.ts runs the same flow against the real stack.
 */

const staff: Profile = {
  userId: '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a',
  email: 'staff@example.test',
  name: 'Lokal Medarbejder',
  role: 'staff',
  disabledAt: null,
}

const UPLOAD_ID = '0b1c2d3e-4f50-4172-8394-a5b6c7d8e9f0'
const JPEG_PATH = `${UPLOAD_ID}/original.jpg`

async function jpegBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 180, g: 90, b: 40 } },
  })
    .jpeg()
    .toBuffer()
}

type StorageLog = {
  downloads: string[]
  uploads: { path: string; contentType: string }[]
  removedOriginals: string[]
  removedDerivatives: string[][]
}

function fakeStorage(options: {
  original: Uint8Array | null
  failUploadAt?: number
}): { storage: ImageStorage; log: StorageLog } {
  const log: StorageLog = {
    downloads: [],
    uploads: [],
    removedOriginals: [],
    removedDerivatives: [],
  }
  const storage: ImageStorage = {
    async mintOriginalUpload() {
      throw new Error('not part of this flow')
    },
    async downloadOriginal(path) {
      log.downloads.push(path)
      return options.original
    },
    async uploadDerivative(path, _data, contentType) {
      if (options.failUploadAt !== undefined && log.uploads.length === options.failUploadAt) {
        return false
      }
      log.uploads.push({ path, contentType })
      return true
    },
    async removeOriginal(path) {
      log.removedOriginals.push(path)
    },
    async removeDerivatives(paths) {
      log.removedDerivatives.push([...paths])
    },
  }
  return { storage, log }
}

type RpcLog = { calls: { fn: string; args: Record<string, unknown> }[] }

function fakeDatabase(result: {
  data?: unknown
  error?: { message: string } | null
}): { database: SupabaseClient; log: RpcLog } {
  const log: RpcLog = { calls: [] }
  const database = {
    rpc(fn: string, args: Record<string, unknown>) {
      log.calls.push({ fn, args })
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
    },
  } as unknown as SupabaseClient
  return { database, log }
}

describe('authorization and request shape', () => {
  it('refuses without an active profile, before any storage call', async () => {
    const { storage, log } = fakeStorage({ original: null })
    const { database, log: rpc } = fakeDatabase({})

    const result = await finalizeImageUpload({ storage, database }, null, {
      storagePath: JPEG_PATH,
    })
    expect(result).toEqual({ status: 'forbidden', message: IMAGE_REFUSALS.forbidden })
    expect(log.downloads).toEqual([])
    expect(rpc.calls).toEqual([])
  })

  it.each([
    ['a traversal', '../../etc/passwd'],
    ['a hand-picked bucket path', 'media/handpicked.jpg'],
    ['a non-string', { path: JPEG_PATH }],
  ])('refuses %s as not a minted path', async (_label, storagePath) => {
    const { storage, log } = fakeStorage({ original: await jpegBytes() })
    const { database, log: rpc } = fakeDatabase({})

    const result = await finalizeImageUpload({ storage, database }, staff, { storagePath })
    expect(result.status).toBe('failed')
    expect(log.downloads).toEqual([])
    expect(rpc.calls).toEqual([])
  })

  it('reports a missing object without inventing anything', async () => {
    const { storage, log } = fakeStorage({ original: null })
    const { database, log: rpc } = fakeDatabase({})

    const result = await finalizeImageUpload({ storage, database }, staff, {
      storagePath: JPEG_PATH,
    })
    expect(result).toEqual({ status: 'missing_upload', message: IMAGE_REFUSALS.missing_upload })
    expect(log.removedOriginals).toEqual([])
    expect(rpc.calls).toEqual([])
  })
})

describe('validation failures clean up after themselves', () => {
  it('removes an original that is not an image, and writes nothing else', async () => {
    const { storage, log } = fakeStorage({
      original: new TextEncoder().encode('not pixels at all'),
    })
    const { database, log: rpc } = fakeDatabase({})

    const result = await finalizeImageUpload({ storage, database }, staff, {
      storagePath: JPEG_PATH,
    })
    expect(result.status).toBe('not_an_image')
    expect(log.removedOriginals).toEqual([JPEG_PATH])
    expect(log.uploads).toEqual([])
    expect(rpc.calls).toEqual([])
  })

  it('refuses bytes whose sniffed type contradicts the stored extension', async () => {
    // Real PNG bytes sitting at an original.jpg path: the declared type lied.
    const png = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer()
    const { storage, log } = fakeStorage({ original: png })
    const { database, log: rpc } = fakeDatabase({})

    const result = await finalizeImageUpload({ storage, database }, staff, {
      storagePath: JPEG_PATH,
    })
    expect(result.status).toBe('unsupported_type')
    expect(log.removedOriginals).toEqual([JPEG_PATH])
    expect(log.uploads).toEqual([])
    expect(rpc.calls).toEqual([])
  })

  it('removes everything when a derivative write fails, and never reaches the database', async () => {
    const { storage, log } = fakeStorage({ original: await jpegBytes(), failUploadAt: 1 })
    const { database, log: rpc } = fakeDatabase({})

    const result = await finalizeImageUpload({ storage, database }, staff, {
      storagePath: JPEG_PATH,
    })
    expect(result.status).toBe('failed')
    expect(log.removedDerivatives).toEqual([[`${UPLOAD_ID}/480.avif`]])
    expect(log.removedOriginals).toEqual([JPEG_PATH])
    expect(rpc.calls).toEqual([])
  })

  it('removes everything when the database refuses, so no files outlive a rowless upload', async () => {
    const { storage, log } = fakeStorage({ original: await jpegBytes() })
    const { database } = fakeDatabase({ error: { message: 'refused' } })

    const result = await finalizeImageUpload({ storage, database }, staff, {
      storagePath: JPEG_PATH,
    })
    expect(result.status).toBe('failed')
    expect(log.removedDerivatives).toEqual([[`${UPLOAD_ID}/480.avif`, `${UPLOAD_ID}/480.webp`]])
    expect(log.removedOriginals).toEqual([JPEG_PATH])
  })
})

describe('the happy path', () => {
  it('writes derivatives first, the row last, with only server-derived values', async () => {
    const bytes = await jpegBytes()
    const { storage, log } = fakeStorage({ original: bytes })
    const { database, log: rpc } = fakeDatabase({
      data: { status: 'created', id: 'row-1', updated_at: '2026-09-01T12:00:00+00:00' },
    })

    const result = await finalizeImageUpload({ storage, database }, staff, {
      storagePath: JPEG_PATH,
      originalFilename: 'C:\\Users\\kok\\burger.jpg',
    })

    expect(result).toEqual({
      status: 'created',
      imageId: 'row-1',
      updatedAt: '2026-09-01T12:00:00+00:00',
    })

    // 640 x 480 → one rung, two formats, derived paths beside the original's id.
    expect(log.uploads).toEqual([
      { path: `${UPLOAD_ID}/480.avif`, contentType: 'image/avif' },
      { path: `${UPLOAD_ID}/480.webp`, contentType: 'image/webp' },
    ])
    expect(log.removedOriginals).toEqual([])
    expect(log.removedDerivatives).toEqual([])

    expect(rpc.calls).toHaveLength(1)
    expect(rpc.calls[0]?.fn).toBe('create_image')
    expect(rpc.calls[0]?.args).toEqual({
      p_storage_path: JPEG_PATH,
      p_mime: 'image/jpeg',
      p_width: 640,
      p_height: 480,
      p_bytes: bytes.byteLength,
      p_original_filename: 'burger.jpg', // sanitised to the basename
      p_derivatives: { formats: ['avif', 'webp'], widths: [{ width: 480, height: 360 }] },
    })
  })

  it('treats a replayed finalize as the success it already was', async () => {
    const { storage, log } = fakeStorage({ original: await jpegBytes() })
    const { database } = fakeDatabase({
      data: { status: 'exists', id: 'row-1', updated_at: '2026-09-01T12:00:00+00:00' },
    })

    const result = await finalizeImageUpload({ storage, database }, staff, {
      storagePath: JPEG_PATH,
    })
    expect(result.status).toBe('exists')
    if (result.status !== 'exists') return
    expect(result.imageId).toBe('row-1')
    // Nothing is cleaned up: the files belong to the row that already exists.
    expect(log.removedOriginals).toEqual([])
    expect(log.removedDerivatives).toEqual([])
  })
})
