import { describe, expect, it } from 'vitest'

import type { Profile } from '@/lib/auth/session'
import {
  isAcceptedUploadMime,
  isImageRefusalCode,
  isOriginalStoragePath,
  mayManageImages,
  mimeOfStoragePath,
  originalStoragePath,
  sanitizeOriginalFilename,
  uploadIdOfStoragePath,
  ACCEPTED_UPLOAD_TYPES,
  CLIENT_MAX_SIDE_PX,
  DERIVATIVES_BUCKET,
  IMAGE_LIMITS,
  IMAGE_REFUSALS,
  ORIGINALS_BUCKET,
} from '@/lib/images/rules'

/**
 * The pure image rules — technical plan §1 (adjustment 3), §8; phase 10A.
 *
 * These constants and functions are the single TypeScript statement of the image
 * domain's limits, grammar and vocabulary; `create_image()` restates them in SQL
 * and `supabase/tests/020_image_storage.test.sql` holds that side. This suite pins
 * the numbers themselves, because a limit that drifts silently is a limit that
 * stops matching the bucket, the SQL and the documentation all at once.
 */

const UPLOAD_ID = '0b1c2d3e-4f50-4172-8394-a5b6c7d8e9f0'

const staff: Profile = {
  userId: '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a',
  email: 'staff@example.test',
  name: 'Lokal Medarbejder',
  role: 'staff',
  disabledAt: null,
}

describe('the accepted upload types', () => {
  it('are exactly JPEG, PNG and WebP', () => {
    expect(Object.keys(ACCEPTED_UPLOAD_TYPES).sort()).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ])
  })

  it.each(['image/svg+xml', 'image/gif', 'image/avif', 'image/heic', 'application/pdf', ''])(
    'refuses %s',
    (mime) => {
      expect(isAcceptedUploadMime(mime)).toBe(false)
    },
  )

  it('does not accept prototype-chain names', () => {
    expect(isAcceptedUploadMime('toString')).toBe(false)
    expect(isAcceptedUploadMime('constructor')).toBe(false)
  })
})

describe('the limits', () => {
  it('are the documented numbers, shared with the bucket and the SQL', () => {
    expect(IMAGE_LIMITS.maxBytes).toBe(10_485_760)
    expect(IMAGE_LIMITS.maxPixels).toBe(30_000_000)
    expect(IMAGE_LIMITS.maxSidePx).toBe(10_000)
    expect(CLIENT_MAX_SIDE_PX).toBe(2560)
  })

  it('names the two buckets the migration creates', () => {
    expect(ORIGINALS_BUCKET).toBe('media-originals')
    expect(DERIVATIVES_BUCKET).toBe('media')
  })
})

describe('the original path grammar', () => {
  it('composes <uuid>/original.<ext> and round-trips its parts', () => {
    const path = originalStoragePath(UPLOAD_ID, 'image/jpeg')
    expect(path).toBe(`${UPLOAD_ID}/original.jpg`)
    expect(isOriginalStoragePath(path)).toBe(true)
    expect(uploadIdOfStoragePath(path)).toBe(UPLOAD_ID)
    expect(mimeOfStoragePath(path)).toBe('image/jpeg')
    expect(mimeOfStoragePath(originalStoragePath(UPLOAD_ID, 'image/webp'))).toBe('image/webp')
  })

  it('refuses to compose from anything that is not a lowercase UUID', () => {
    expect(() => originalStoragePath('../evil', 'image/jpeg')).toThrow()
    expect(() => originalStoragePath(UPLOAD_ID.toUpperCase(), 'image/jpeg')).toThrow()
    expect(() => originalStoragePath(`${UPLOAD_ID}/extra`, 'image/jpeg')).toThrow()
  })

  it.each([
    ['a traversal', '../../etc/passwd'],
    ['a backslash', `${UPLOAD_ID}\\original.jpg`],
    ['a hand-picked bucket path', 'media/handpicked.jpg'],
    ['a nested path', `${UPLOAD_ID}/deep/original.jpg`],
    ['a foreign extension', `${UPLOAD_ID}/original.svg`],
    ['an uppercase id', `${UPLOAD_ID.toUpperCase()}/original.jpg`],
    ['a non-string', 42],
    ['null', null],
  ])('recognises %s as not a minted path', (_label, value) => {
    expect(isOriginalStoragePath(value)).toBe(false)
  })
})

describe('sanitizeOriginalFilename', () => {
  it('keeps an ordinary phone filename', () => {
    expect(sanitizeOriginalFilename('IMG_2024 fra telefonen.jpg')).toBe(
      'IMG_2024 fra telefonen.jpg',
    )
  })

  it('cuts a path down to its basename — the name is metadata, never identity', () => {
    expect(sanitizeOriginalFilename('C:\\Users\\kok\\burger.jpg')).toBe('burger.jpg')
    expect(sanitizeOriginalFilename('../../../etc/passwd')).toBe('passwd')
  })

  it('removes control characters and caps the length', () => {
    expect(sanitizeOriginalFilename('evil\nname\u0000.jpg')).toBe('evilname.jpg')
    expect(sanitizeOriginalFilename(`${'x'.repeat(200)}.jpg`)).toHaveLength(160)
  })

  it('treats blank as absent, like every other optional field', () => {
    expect(sanitizeOriginalFilename('')).toBeNull()
    expect(sanitizeOriginalFilename('   ')).toBeNull()
    expect(sanitizeOriginalFilename('\u0000\u0001')).toBeNull()
    expect(sanitizeOriginalFilename(undefined)).toBeNull()
    expect(sanitizeOriginalFilename(42)).toBeNull()
  })
})

describe('mayManageImages', () => {
  it('admits any active staff or owner profile (§5)', () => {
    expect(mayManageImages(staff)).toBe(true)
    expect(mayManageImages({ ...staff, role: 'owner' })).toBe(true)
  })

  it('refuses no session and a deactivated account', () => {
    expect(mayManageImages(null)).toBe(false)
    expect(mayManageImages({ ...staff, disabledAt: '2026-09-01T00:00:00Z' })).toBe(false)
  })
})

describe('the refusal vocabulary', () => {
  it('is a closed set of Danish sentences', () => {
    for (const [code, message] of Object.entries(IMAGE_REFUSALS)) {
      expect(isImageRefusalCode(code)).toBe(true)
      expect(message.length).toBeGreaterThan(10)
      expect(message.endsWith('.')).toBe(true)
    }
    expect(isImageRefusalCode('noget_andet')).toBe(false)
  })

  it('uses §10g\u2019s designed sentence for the generic failure', () => {
    expect(IMAGE_REFUSALS.failed).toBe('Billedet kunne ikke uploades. Prøv igen.')
  })
})
