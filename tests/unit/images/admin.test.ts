import { describe, expect, it } from 'vitest'

import type { Profile } from '@/lib/auth/session'
import {
  deleteLibraryImage,
  replaceLibraryImage,
  saveImageAltText,
} from '@/lib/images/admin'
import type { ImageStorage } from '@/lib/images/storage'

/**
 * The library's write wrappers — phase 10B (brief §14–§17, §21, §25).
 *
 * Recording fakes, in the family of the finalize suite: what travels to the
 * database, which storage removals happen for which answers, and — the trusted
 * delete-path rule — that every removed path is either the injected server-read
 * derivation or the trusted function's own return value, never anything else.
 */

const STAFF: Profile = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'staff@example.test',
  name: 'Test',
  role: 'staff',
  disabledAt: null,
}

const DISABLED: Profile = { ...STAFF, disabledAt: '2026-09-01T00:00:00Z' }

const IMAGE_ID = '11111111-1111-4111-8111-111111111111'
const NEW_ID = '22222222-2222-4222-8222-222222222222'
const VERSION = '2026-09-01T10:00:00.000000+00:00'

/** A recording storage whose upload half must never be reached from these writes. */
function recordingStorage() {
  const removedOriginals: string[] = []
  const removedDerivatives: string[][] = []

  const storage: ImageStorage = {
    async mintOriginalUpload() {
      throw new Error('the write wrappers must never mint an upload')
    },
    async downloadOriginal() {
      throw new Error('the write wrappers must never download an original')
    },
    async uploadDerivative() {
      throw new Error('the write wrappers must never write a derivative')
    },
    async removeOriginal(path) {
      removedOriginals.push(path)
    },
    async removeDerivatives(paths) {
      removedDerivatives.push([...paths])
    },
  }

  return { storage, removedOriginals, removedDerivatives }
}

/** A supabase fake for the alt-text UPDATE chain and its existence probe. */
function altDatabase(options: {
  updated: { id: string } | null
  stillExists?: boolean
  error?: { code: string; message: string }
}) {
  const calls: { update?: Record<string, unknown>; filters: [string, unknown][] }[] = []

  const from = () => {
    const call: (typeof calls)[number] = { filters: [] }
    calls.push(call)

    const chain = {
      update(values: Record<string, unknown>) {
        call.update = values
        return chain
      },
      select() {
        return chain
      },
      eq(column: string, value: unknown) {
        call.filters.push([column, value])
        return chain
      },
      async maybeSingle() {
        if (call.update !== undefined) {
          return options.error !== undefined
            ? { data: null, error: options.error }
            : { data: options.updated, error: null }
        }
        return { data: options.stillExists === true ? { id: IMAGE_ID } : null, error: null }
      },
    }
    return chain
  }

  return { supabase: { from } as never, calls }
}

/** A supabase fake answering one RPC. */
function rpcDatabase(reply: { data?: unknown; error?: { message: string } }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []

  return {
    supabase: {
      async rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args })
        return { data: reply.data ?? null, error: reply.error ?? null }
      },
    } as never,
    calls,
  }
}

describe('saveImageAltText — the one direct column write (brief §10)', () => {
  it('writes the parsed text, filtered by id and version, and nothing else', async () => {
    const db = altDatabase({ updated: { id: IMAGE_ID } })

    const result = await saveImageAltText(db.supabase, STAFF, {
      imageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      altText: '  Burgeren fra siden.  ',
    })

    expect(result).toEqual({ status: 'saved' })
    expect(db.calls).toHaveLength(1)
    // Exactly one column — the payload cannot name storage_path, dimensions,
    // MIME, derivatives, uploader or id, because it names alt_text alone.
    expect(db.calls[0]!.update).toEqual({ alt_text: 'Burgeren fra siden.' })
    expect(db.calls[0]!.filters).toEqual([
      ['id', IMAGE_ID],
      ['updated_at', VERSION],
    ])
  })

  it('a blank description is stored as absent, not as an empty string', async () => {
    const db = altDatabase({ updated: { id: IMAGE_ID } })

    await saveImageAltText(db.supabase, STAFF, {
      imageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      altText: '   ',
    })

    expect(db.calls[0]!.update).toEqual({ alt_text: null })
  })

  it('an invalid description is refused before any query', async () => {
    const db = altDatabase({ updated: { id: IMAGE_ID } })

    const result = await saveImageAltText(db.supabase, STAFF, {
      imageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      altText: 'x'.repeat(301),
    })

    expect(result).toEqual({ status: 'invalid', error: 'for_lang' })
    expect(db.calls).toHaveLength(0)
  })

  it('zero rows with the row still there is a conflict; gone is not_found', async () => {
    const conflicted = altDatabase({ updated: null, stillExists: true })
    expect(
      (
        await saveImageAltText(conflicted.supabase, STAFF, {
          imageId: IMAGE_ID,
          expectedUpdatedAt: VERSION,
          altText: 'En beskrivelse',
        })
      ).status,
    ).toBe('conflict')

    const gone = altDatabase({ updated: null, stillExists: false })
    expect(
      (
        await saveImageAltText(gone.supabase, STAFF, {
          imageId: IMAGE_ID,
          expectedUpdatedAt: VERSION,
          altText: 'En beskrivelse',
        })
      ).status,
    ).toBe('not_found')
  })

  it('a deactivated profile is refused before any query', async () => {
    const db = altDatabase({ updated: { id: IMAGE_ID } })

    const result = await saveImageAltText(db.supabase, DISABLED, {
      imageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      altText: 'En beskrivelse',
    })

    expect(result).toEqual({ status: 'forbidden' })
    expect(db.calls).toHaveLength(0)
  })
})

describe('deleteLibraryImage — the one door out, then the files (brief §14–§16)', () => {
  const DERIVATIVES = ['u/480.avif', 'u/480.webp']

  it('a deleted answer removes exactly the trusted paths, in the safe order', async () => {
    const db = rpcDatabase({
      data: { status: 'deleted', references: 0, storage_path: 'u/original.jpg' },
    })
    const { storage, removedOriginals, removedDerivatives } = recordingStorage()

    const result = await deleteLibraryImage(db.supabase, storage, STAFF, {
      imageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      confirmed: false,
      derivativePaths: DERIVATIVES,
    })

    expect(result).toEqual({ status: 'deleted' })
    expect(db.calls).toEqual([
      {
        fn: 'delete_image',
        args: { p_id: IMAGE_ID, p_expected_updated_at: VERSION, p_confirmed: false },
      },
    ])
    // The derivative paths are the injected server-read derivation; the original
    // is the function's own returned path. Nothing here came from a browser.
    expect(removedDerivatives).toEqual([DERIVATIVES])
    expect(removedOriginals).toEqual(['u/original.jpg'])
  })

  it('in_use removes nothing and carries the count', async () => {
    const db = rpcDatabase({ data: { status: 'in_use', references: 2 } })
    const { storage, removedOriginals, removedDerivatives } = recordingStorage()

    const result = await deleteLibraryImage(db.supabase, storage, STAFF, {
      imageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      confirmed: false,
      derivativePaths: DERIVATIVES,
    })

    expect(result).toEqual({ status: 'in_use', references: 2 })
    expect(removedOriginals).toEqual([])
    expect(removedDerivatives).toEqual([])
  })

  it.each(['conflict', 'not_found'] as const)('%s removes nothing', async (status) => {
    const db = rpcDatabase({ data: { status } })
    const { storage, removedOriginals, removedDerivatives } = recordingStorage()

    const result = await deleteLibraryImage(db.supabase, storage, STAFF, {
      imageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      confirmed: true,
      derivativePaths: DERIVATIVES,
    })

    expect(result.status).toBe(status)
    expect(removedOriginals).toEqual([])
    expect(removedDerivatives).toEqual([])
  })

  it('a malformed database answer is failed, with nothing removed', async () => {
    const db = rpcDatabase({ data: { status: 'deleted' } }) // no storage_path
    const { storage, removedOriginals } = recordingStorage()

    const result = await deleteLibraryImage(db.supabase, storage, STAFF, {
      imageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      confirmed: true,
      derivativePaths: DERIVATIVES,
    })

    expect(result).toEqual({ status: 'failed' })
    expect(removedOriginals).toEqual([])
  })

  it('a deactivated profile is refused before the RPC', async () => {
    const db = rpcDatabase({ data: { status: 'deleted' } })
    const { storage } = recordingStorage()

    const result = await deleteLibraryImage(db.supabase, storage, DISABLED, {
      imageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      confirmed: false,
      derivativePaths: [],
    })

    expect(result).toEqual({ status: 'forbidden' })
    expect(db.calls).toHaveLength(0)
  })
})

describe('replaceLibraryImage — the trusted transition (brief §17)', () => {
  const OLD_DERIVATIVES = ['old/480.avif', 'old/480.webp']

  it('a replaced answer removes the OLD image\'s files only', async () => {
    const db = rpcDatabase({
      data: { status: 'replaced', references: 1, new_id: NEW_ID, storage_path: 'old/original.jpg' },
    })
    const { storage, removedOriginals, removedDerivatives } = recordingStorage()

    const result = await replaceLibraryImage(db.supabase, storage, STAFF, {
      oldImageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      newImageId: NEW_ID,
      derivativePaths: OLD_DERIVATIVES,
    })

    expect(result).toEqual({ status: 'replaced' })
    expect(db.calls).toEqual([
      {
        fn: 'replace_image',
        args: { p_old_id: IMAGE_ID, p_expected_updated_at: VERSION, p_new_id: NEW_ID },
      },
    ])
    expect(removedDerivatives).toEqual([OLD_DERIVATIVES])
    expect(removedOriginals).toEqual(['old/original.jpg'])
  })

  it.each(['conflict', 'not_found', 'invalid_replacement', 'missing_replacement'] as const)(
    '%s removes nothing — the old image is untouched',
    async (status) => {
      const db = rpcDatabase({ data: { status } })
      const { storage, removedOriginals, removedDerivatives } = recordingStorage()

      const result = await replaceLibraryImage(db.supabase, storage, STAFF, {
        oldImageId: IMAGE_ID,
        expectedUpdatedAt: VERSION,
        newImageId: NEW_ID,
        derivativePaths: OLD_DERIVATIVES,
      })

      expect(result).toEqual({ status })
      expect(removedOriginals).toEqual([])
      expect(removedDerivatives).toEqual([])
    },
  )

  it('a database error is failed, with nothing removed', async () => {
    const db = rpcDatabase({ error: { message: 'unreachable' } })
    const { storage, removedOriginals } = recordingStorage()

    const result = await replaceLibraryImage(db.supabase, storage, STAFF, {
      oldImageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      newImageId: NEW_ID,
      derivativePaths: OLD_DERIVATIVES,
    })

    expect(result).toEqual({ status: 'failed' })
    expect(removedOriginals).toEqual([])
  })

  it('a deactivated profile is refused before the RPC', async () => {
    const db = rpcDatabase({ data: { status: 'replaced' } })
    const { storage } = recordingStorage()

    const result = await replaceLibraryImage(db.supabase, storage, DISABLED, {
      oldImageId: IMAGE_ID,
      expectedUpdatedAt: VERSION,
      newImageId: NEW_ID,
      derivativePaths: [],
    })

    expect(result).toEqual({ status: 'forbidden' })
    expect(db.calls).toHaveLength(0)
  })
})
