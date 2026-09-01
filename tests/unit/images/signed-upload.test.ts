import { describe, expect, it } from 'vitest'

import type { Profile } from '@/lib/auth/session'
import { isOriginalStoragePath, IMAGE_REFUSALS } from '@/lib/images/rules'
import { requestImageUpload } from '@/lib/images/signed-upload'
import type { ImageStorage, SignedUploadTarget } from '@/lib/images/storage'

/**
 * Requesting upload permission — technical plan §1 (adjustment 2); phase 10A.
 *
 * The flow is exercised against a recording fake of the narrow storage boundary,
 * which is the point of the boundary's shape: the authority rules — who may ask,
 * what may be declared, and above all that the path is minted rather than chosen —
 * are all observable without a storage service in the room. The real service is
 * exercised by tests/integration/images.test.ts.
 */

const staff: Profile = {
  userId: '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a',
  email: 'staff@example.test',
  name: 'Lokal Medarbejder',
  role: 'staff',
  disabledAt: null,
}

function recordingStorage(mintResult?: SignedUploadTarget | null) {
  const minted: string[] = []
  const storage: ImageStorage = {
    async mintOriginalUpload(path) {
      minted.push(path)
      return mintResult === undefined
        ? { path, token: 'token-123', url: `https://local.test/upload/${path}` }
        : mintResult
    },
    async downloadOriginal() {
      throw new Error('not part of this flow')
    },
    async uploadDerivative() {
      throw new Error('not part of this flow')
    },
    async removeOriginal() {},
    async removeDerivatives() {},
  }
  return { storage, minted }
}

describe('authorization', () => {
  it('refuses without an active profile, before any storage call', async () => {
    const { storage, minted } = recordingStorage()

    const anonymous = await requestImageUpload(storage, null, {
      declaredMime: 'image/jpeg',
      declaredBytes: 1000,
    })
    expect(anonymous).toEqual({ status: 'forbidden', message: IMAGE_REFUSALS.forbidden })

    const deactivated = await requestImageUpload(
      storage,
      { ...staff, disabledAt: '2026-09-01T00:00:00Z' },
      { declaredMime: 'image/jpeg', declaredBytes: 1000 },
    )
    expect(deactivated.status).toBe('forbidden')
    expect(minted).toEqual([])
  })
})

describe('the declared intent', () => {
  it.each(['image/svg+xml', 'image/gif', 'application/pdf', 'text/html', ''])(
    'refuses %s before any storage call',
    async (mime) => {
      const { storage, minted } = recordingStorage()
      const result = await requestImageUpload(storage, staff, {
        declaredMime: mime,
        declaredBytes: 1000,
      })
      expect(result).toEqual({
        status: 'unsupported_type',
        message: IMAGE_REFUSALS.unsupported_type,
      })
      expect(minted).toEqual([])
    },
  )

  it.each([0, -1, 10_485_761, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a declared size of %s',
    async (bytes) => {
      const { storage, minted } = recordingStorage()
      const result = await requestImageUpload(storage, staff, {
        declaredMime: 'image/jpeg',
        declaredBytes: bytes,
      })
      expect(result.status).toBe('too_large')
      expect(minted).toEqual([])
    },
  )
})

describe('a granted request', () => {
  it('mints a fresh server path — the filename is metadata, never identity', async () => {
    const { storage, minted } = recordingStorage()

    const result = await requestImageUpload(storage, staff, {
      declaredMime: 'image/jpeg',
      declaredBytes: 250_000,
      filename: '..\\..\\Burger billede\u0000 fra køkkenet.jpg',
    })

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    expect(minted).toHaveLength(1)
    expect(isOriginalStoragePath(minted[0])).toBe(true)
    expect(minted[0]?.endsWith('/original.jpg')).toBe(true)
    expect(result.target.path).toBe(minted[0])
    expect(result.target.token).toBe('token-123')

    // Sanitised: basename only, control characters gone.
    expect(result.originalFilename).toBe('Burger billede fra køkkenet.jpg')
    expect(minted[0]).not.toContain('Burger')
  })

  it('mints a different path every time — a replayed request is a new identity', async () => {
    const { storage, minted } = recordingStorage()
    const intent = { declaredMime: 'image/png', declaredBytes: 1000 }
    await requestImageUpload(storage, staff, intent)
    await requestImageUpload(storage, staff, intent)
    expect(new Set(minted).size).toBe(2)
  })

  it('reports failure in Danish when the storage service will not mint', async () => {
    const { storage } = recordingStorage(null)
    const result = await requestImageUpload(storage, staff, {
      declaredMime: 'image/webp',
      declaredBytes: 1000,
    })
    expect(result).toEqual({ status: 'failed', message: IMAGE_REFUSALS.failed })
  })
})
