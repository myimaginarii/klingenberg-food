import { IMAGE_REFUSALS, type ImageRefusalCode } from './rules'

/**
 * The uploader's state machine — design 1w; technical plan §1 (adjustments 2–3),
 * §15 (phase 10B, brief §5 and §6).
 *
 * A pure reducer, run by `components/admin/images/ImageUploader.tsx` and pinned by
 * the unit suite, so the three rules the brief states are properties of a function
 * rather than of a component's discipline:
 *
 *   1. **One upload at a time.** Starting is refused while an attempt is in
 *      flight, which is what disables the chooser and swallows a double click.
 *   2. **A stale completion changes nothing.** Every attempt has a number; an
 *      event carrying an old number is ignored, so a slow response from an
 *      abandoned attempt can never overwrite a newer one's state.
 *   3. **A failure keeps the filename and the reason on screen** until the person
 *      starts again — nothing resets to idle behind their back.
 *
 * The phases are the brief's own (§5): valgt/forberedes, uploader, behandles,
 * færdig, afvist, fejlet. There is deliberately no percentage — a browser `fetch`
 * PUT exposes no honest upload progress, and §5 prefers a true sentence to fake
 * precision. Each phase has one Danish sentence, announced politely by the
 * component's single `role="status"` region.
 */

export type UploadPhase = 'idle' | 'preparing' | 'uploading' | 'processing'

export type UploadState =
  | { readonly phase: 'idle' }
  | {
      readonly phase: Exclude<UploadPhase, 'idle'>
      readonly attempt: number
      readonly filename: string
    }
  | { readonly phase: 'done'; readonly attempt: number; readonly filename: string }
  | {
      readonly phase: 'refused' | 'failed'
      readonly attempt: number
      readonly filename: string
      /** The one Danish sentence the screen shows. */
      readonly message: string
    }

export const IDLE_UPLOAD: UploadState = { phase: 'idle' }

export type UploadEvent =
  | { readonly kind: 'chosen'; readonly attempt: number; readonly filename: string }
  | { readonly kind: 'prepared'; readonly attempt: number }
  | { readonly kind: 'put_ok'; readonly attempt: number }
  | { readonly kind: 'refused'; readonly attempt: number; readonly message: string }
  | { readonly kind: 'failed'; readonly attempt: number; readonly message?: string }
  | { readonly kind: 'finalized'; readonly attempt: number }

/** True while an attempt is in flight — the chooser is disabled exactly then. */
export function isUploadBusy(state: UploadState): boolean {
  return state.phase === 'preparing' || state.phase === 'uploading' || state.phase === 'processing'
}

/** True when a new attempt may begin. Idle, done and both failure states may retry. */
export function mayStartUpload(state: UploadState): boolean {
  return !isUploadBusy(state)
}

export function reduceUpload(state: UploadState, event: UploadEvent): UploadState {
  if (event.kind === 'chosen') {
    // Duplicate-submit prevention: a second file while one is in flight is ignored
    // outright — the component also disables the input, and this is the rule the
    // disabling expresses.
    if (!mayStartUpload(state)) return state
    return { phase: 'preparing', attempt: event.attempt, filename: event.filename }
  }

  // Every other event belongs to a specific attempt. A stale one — from an attempt
  // that already failed, or that the state has moved past — changes nothing.
  if (state.phase === 'idle' || state.attempt !== event.attempt) return state

  switch (event.kind) {
    case 'prepared':
      return state.phase === 'preparing'
        ? { phase: 'uploading', attempt: state.attempt, filename: state.filename }
        : state
    case 'put_ok':
      return state.phase === 'uploading'
        ? { phase: 'processing', attempt: state.attempt, filename: state.filename }
        : state
    case 'finalized':
      return state.phase === 'processing'
        ? { phase: 'done', attempt: state.attempt, filename: state.filename }
        : state
    case 'refused':
      return isUploadBusy(state)
        ? {
            phase: 'refused',
            attempt: state.attempt,
            filename: state.filename,
            message: event.message,
          }
        : state
    case 'failed':
      return isUploadBusy(state)
        ? {
            phase: 'failed',
            attempt: state.attempt,
            filename: state.filename,
            message: event.message ?? IMAGE_REFUSALS.failed,
          }
        : state
  }
}

/**
 * The one sentence each phase shows (brief §5). "Processing" is its own honest
 * state: the PUT has landed but the server has not confirmed the image, so the
 * screen must not say anything is finished yet.
 */
export function uploadStatusSentence(state: UploadState): string | null {
  switch (state.phase) {
    case 'idle':
      return null
    case 'preparing':
      return `Gør ${state.filename} klar…`
    case 'uploading':
      return `Uploader ${state.filename}…`
    case 'processing':
      return `Behandler ${state.filename}…`
    case 'done':
      return 'Billedet er uploadet.'
    case 'refused':
    case 'failed':
      return state.message
  }
}

/** The client-side refusals `prepareImageForUpload` can produce, as Danish. */
export function clientRefusalMessage(code: 'unsupported_type' | 'not_an_image'): string {
  return IMAGE_REFUSALS[code]
}

/**
 * The upload actions' reply contracts, stated here — in the pure, client-safe
 * module — so the uploader component depends on `lib/` alone and the Server
 * Actions annotate their returns against the same shapes (`app/` depending on
 * `lib/`, never the reverse).
 */
export type UploadGrantReply =
  | {
      readonly status: 'ready'
      /** The one pre-authorized address the browser may PUT to. */
      readonly url: string
      /** The server-minted path — handed back to the finalize action verbatim. */
      readonly path: string
    }
  | { readonly status: 'refused' | 'failed'; readonly message: string }

export type UploadFinalizeReply =
  | { readonly status: 'done'; readonly imageId: string }
  | { readonly status: 'refused' | 'failed'; readonly message: string }

export type UploadReplaceReply = {
  readonly status:
    | 'replaced'
    | 'conflict'
    | 'not_found'
    | 'invalid_replacement'
    | 'missing_replacement'
    | 'owner_only'
    | 'forbidden'
    | 'failed'
}

export type { ImageRefusalCode }
