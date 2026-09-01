import { describe, expect, it } from 'vitest'

import {
  clientRefusalMessage,
  isUploadBusy,
  mayStartUpload,
  reduceUpload,
  uploadStatusSentence,
  IDLE_UPLOAD,
  type UploadState,
} from '@/lib/images/upload-flow'
import { IMAGE_REFUSALS } from '@/lib/images/rules'

/**
 * The uploader's state machine — phase 10B (brief §5, §6, §25).
 *
 * The three rules the brief states, pinned as properties of the reducer: one
 * upload at a time (duplicate submit prevention), stale completions ignored by
 * attempt number, and failures that keep the filename and the reason on screen.
 */

const chosen = (attempt: number, filename = 'burger.jpg') =>
  ({ kind: 'chosen', attempt, filename }) as const

function runTo(phase: 'preparing' | 'uploading' | 'processing' | 'done', attempt = 1): UploadState {
  let state = reduceUpload(IDLE_UPLOAD, chosen(attempt))
  if (phase === 'preparing') return state
  state = reduceUpload(state, { kind: 'prepared', attempt })
  if (phase === 'uploading') return state
  state = reduceUpload(state, { kind: 'put_ok', attempt })
  if (phase === 'processing') return state
  return reduceUpload(state, { kind: 'finalized', attempt })
}

describe('the happy path', () => {
  it('walks chosen -> prepared -> put_ok -> finalized', () => {
    expect(runTo('preparing')).toEqual({ phase: 'preparing', attempt: 1, filename: 'burger.jpg' })
    expect(runTo('uploading').phase).toBe('uploading')
    expect(runTo('processing').phase).toBe('processing')
    expect(runTo('done')).toEqual({ phase: 'done', attempt: 1, filename: 'burger.jpg' })
  })

  it('each in-flight phase is busy; idle, done and failures are not', () => {
    expect(isUploadBusy(IDLE_UPLOAD)).toBe(false)
    expect(isUploadBusy(runTo('preparing'))).toBe(true)
    expect(isUploadBusy(runTo('uploading'))).toBe(true)
    expect(isUploadBusy(runTo('processing'))).toBe(true)
    expect(isUploadBusy(runTo('done'))).toBe(false)

    const failed = reduceUpload(runTo('processing'), { kind: 'failed', attempt: 1 })
    expect(isUploadBusy(failed)).toBe(false)
    expect(mayStartUpload(failed)).toBe(true)
  })
})

describe('duplicate-submit prevention (brief §6)', () => {
  it('a second file while one is in flight is ignored', () => {
    const inFlight = runTo('uploading')
    const doubled = reduceUpload(inFlight, chosen(2, 'andet.jpg'))

    expect(doubled).toBe(inFlight)
  })

  it('a new attempt may start after done, refusal and failure', () => {
    for (const terminal of [
      runTo('done'),
      reduceUpload(runTo('processing'), { kind: 'refused', attempt: 1, message: 'nej' }),
      reduceUpload(runTo('uploading'), { kind: 'failed', attempt: 1 }),
    ]) {
      const restarted = reduceUpload(terminal, chosen(9, 'nyt.jpg'))
      expect(restarted).toEqual({ phase: 'preparing', attempt: 9, filename: 'nyt.jpg' })
    }
  })
})

describe('stale completions change nothing (brief §6)', () => {
  it('an event from an abandoned attempt is ignored in every phase', () => {
    const second = runTo('uploading', 2)

    for (const event of [
      { kind: 'prepared', attempt: 1 },
      { kind: 'put_ok', attempt: 1 },
      { kind: 'finalized', attempt: 1 },
      { kind: 'refused', attempt: 1, message: 'gammel' },
      { kind: 'failed', attempt: 1 },
    ] as const) {
      expect(reduceUpload(second, event)).toBe(second)
    }
  })

  it('a completion cannot skip phases within its own attempt', () => {
    // A finalize answer while still uploading would mean events arrived out of
    // order; the state holds rather than guessing.
    const uploading = runTo('uploading')
    expect(reduceUpload(uploading, { kind: 'finalized', attempt: 1 })).toBe(uploading)
    expect(reduceUpload(uploading, { kind: 'prepared', attempt: 1 })).toBe(uploading)
  })

  it('events aimed at the idle state are ignored', () => {
    expect(reduceUpload(IDLE_UPLOAD, { kind: 'finalized', attempt: 1 })).toBe(IDLE_UPLOAD)
  })
})

describe('failures keep the filename and the reason (brief §5)', () => {
  it('a refusal carries its Danish sentence and the chosen file', () => {
    const refused = reduceUpload(runTo('processing'), {
      kind: 'refused',
      attempt: 1,
      message: IMAGE_REFUSALS.too_large,
    })

    expect(refused).toEqual({
      phase: 'refused',
      attempt: 1,
      filename: 'burger.jpg',
      message: IMAGE_REFUSALS.too_large,
    })
  })

  it('a failure with no message falls back to the generic sentence', () => {
    const failed = reduceUpload(runTo('uploading'), { kind: 'failed', attempt: 1 })

    expect(failed.phase).toBe('failed')
    if (failed.phase === 'failed') {
      expect(failed.message).toBe(IMAGE_REFUSALS.failed)
      expect(failed.filename).toBe('burger.jpg')
    }
  })
})

describe('the status sentences (brief §5)', () => {
  it('every phase has one honest Danish sentence — and no percentages', () => {
    expect(uploadStatusSentence(IDLE_UPLOAD)).toBeNull()
    expect(uploadStatusSentence(runTo('preparing'))).toBe('Gør burger.jpg klar…')
    expect(uploadStatusSentence(runTo('uploading'))).toBe('Uploader burger.jpg…')
    expect(uploadStatusSentence(runTo('processing'))).toBe('Behandler burger.jpg…')
    expect(uploadStatusSentence(runTo('done'))).toBe('Billedet er uploadet.')
  })

  it('processing is not described as complete — finalize is still running', () => {
    const sentence = uploadStatusSentence(runTo('processing'))
    expect(sentence).not.toContain('uploadet')
    expect(sentence).not.toContain('færdig')
  })

  it('a failure\'s sentence is the failure\'s own message', () => {
    const refused = reduceUpload(runTo('processing'), {
      kind: 'refused',
      attempt: 1,
      message: IMAGE_REFUSALS.not_an_image,
    })
    expect(uploadStatusSentence(refused)).toBe(IMAGE_REFUSALS.not_an_image)
  })
})

describe('client refusal mapping (brief §22)', () => {
  it('maps the two prepare refusals to the shared Danish vocabulary', () => {
    expect(clientRefusalMessage('unsupported_type')).toBe(IMAGE_REFUSALS.unsupported_type)
    expect(clientRefusalMessage('not_an_image')).toBe(IMAGE_REFUSALS.not_an_image)
  })
})
