'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { prepareImageForUpload, putToSignedUploadUrl } from '@/lib/images/client-upload'
import {
  clientRefusalMessage,
  isUploadBusy,
  reduceUpload,
  uploadStatusSentence,
  IDLE_UPLOAD,
  type UploadFinalizeReply,
  type UploadGrantReply,
  type UploadReplaceReply,
  type UploadState,
} from '@/lib/images/upload-flow'
import { IMAGE_REFUSALS } from '@/lib/images/rules'

/**
 * The upload control — design 1w's dashed dropzone; technical plan §1
 * (adjustments 2 and 3); phase 10B.
 *
 * This is the component that finally mounts phase 10A's client half for real: the
 * person's file is decoded and — when oversized — downscaled with `<canvas>`
 * (`prepareImageForUpload`), the Server Action mints one signed URL, the bytes go
 * there with one plain `fetch` PUT, and the finalize action validates and
 * processes them server-side. The browser holds no Supabase client, no key and no
 * configuration — the URL arrives complete and is the only address this component
 * ever touches.
 *
 * The state lives in `lib/images/upload-flow.ts`, a pure reducer the unit suite
 * pins; this file is the wiring. One image at a time, the chooser disabled while
 * an attempt is in flight, and a stale completion ignored by attempt number —
 * the brief's §6, expressed by the reducer rather than by component discipline.
 *
 * In **replace mode** (1w's "Erstat", brief §17) the finished upload is followed
 * by one more programmatic action — the trusted transition that repoints every
 * reference and removes the old image — and the component navigates only when
 * that too has answered. The new image uploads completely first; nothing about
 * the old one moves until the server says the switch happened.
 *
 * JavaScript is required here, and only here in this administration's phase-10
 * surface — a signed PUT cannot be a form post. §7e item 11 allows it, and the
 * `<noscript>` says so instead of leaving a dead control.
 */

type ReplaceTarget = {
  readonly oldId: string
  /** The version token the replace panel was rendered from (§6). */
  readonly oldVersion: string
}

export function ImageUploader({
  requestAction,
  finalizeAction,
  replaceAction,
  replace,
  inputId,
  libraryPath,
  imageParam,
  statusParam,
  detailAnchor,
}: {
  requestAction: (input: unknown) => Promise<UploadGrantReply>
  finalizeAction: (input: unknown) => Promise<UploadFinalizeReply>
  replaceAction?: (input: unknown) => Promise<UploadReplaceReply>
  /** Present in replace mode: which image the finished upload replaces. */
  replace?: ReplaceTarget
  /** The file input's element id — where the "+ Upload" anchors land. */
  inputId: string
  libraryPath: string
  imageParam: string
  statusParam: string
  detailAnchor: string
}) {
  const router = useRouter()
  const [state, setState] = useState<UploadState>(IDLE_UPLOAD)
  // The machine's authoritative state lives in a ref (async steps read it between
  // renders); useState mirrors it for rendering. The attempt counter makes stale
  // completions inert — the reducer ignores events from an abandoned attempt.
  const machineRef = useRef<UploadState>(IDLE_UPLOAD)
  const attemptRef = useRef(0)

  const dispatch = (event: Parameters<typeof reduceUpload>[1]) => {
    machineRef.current = reduceUpload(machineRef.current, event)
    setState(machineRef.current)
  }

  const arriveAt = (imageId: string, status: string) => {
    // The admin renders dynamically per request, so a router navigation fetches a
    // fresh server render that includes the row the server just made.
    const query = new URLSearchParams()
    query.set(statusParam, status)
    query.set(imageParam, imageId)
    router.push(`${libraryPath}?${query.toString()}#${detailAnchor}`)
  }

  const upload = async (file: File) => {
    if (isUploadBusy(machineRef.current)) return

    const attempt = attemptRef.current + 1
    attemptRef.current = attempt
    dispatch({ kind: 'chosen', attempt, filename: file.name })

    try {
      const prepared = await prepareImageForUpload(file)
      if (prepared.status !== 'ready') {
        dispatch({ kind: 'refused', attempt, message: clientRefusalMessage(prepared.status) })
        return
      }

      const granted = await requestAction({
        mime: prepared.mime,
        bytes: prepared.blob.size,
        filename: prepared.filename,
      })
      if (granted.status !== 'ready') {
        dispatch({ kind: granted.status === 'failed' ? 'failed' : 'refused', attempt, message: granted.message })
        return
      }
      dispatch({ kind: 'prepared', attempt })

      const putOk = await putToSignedUploadUrl(granted.url, prepared.blob)
      if (!putOk) {
        dispatch({ kind: 'failed', attempt, message: IMAGE_REFUSALS.failed })
        return
      }
      dispatch({ kind: 'put_ok', attempt })

      const finalized = await finalizeAction({ path: granted.path, filename: prepared.filename })
      if (finalized.status !== 'done') {
        dispatch({
          kind: finalized.status === 'failed' ? 'failed' : 'refused',
          attempt,
          message: finalized.message,
        })
        return
      }

      if (replace !== undefined && replaceAction !== undefined) {
        const replaced = await replaceAction({
          oldId: replace.oldId,
          oldVersion: replace.oldVersion,
          newId: finalized.imageId,
        })

        if (replaced.status !== 'replaced') {
          // The new image is finished and in the library; only the switch failed,
          // and the old image is untouched. Say exactly that (brief §17, §22).
          dispatch({
            kind: 'failed',
            attempt,
            message:
              replaced.status === 'conflict'
                ? 'Billedet blev ændret af en anden i mellemtiden, så det blev ikke erstattet. Det nye billede ligger i biblioteket.'
                : 'Billedet blev uploadet, men erstatningen mislykkedes. Det gamle billede er uændret, og det nye ligger i biblioteket.',
          })
          return
        }

        dispatch({ kind: 'finalized', attempt })
        arriveAt(finalized.imageId, 'erstattet')
        return
      }

      dispatch({ kind: 'finalized', attempt })
      arriveAt(finalized.imageId, 'uploadet')
    } catch {
      dispatch({ kind: 'failed', attempt, message: IMAGE_REFUSALS.failed })
    }
  }

  const busy = isUploadBusy(state)
  const sentence = uploadStatusSentence(state)
  const failed = state.phase === 'refused' || state.phase === 'failed'

  return (
    <div className="flex flex-col gap-2">
      <label
        className={`rounded-card flex min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-1.5 border-[1.5px] border-dashed px-4 py-5 text-center has-[:focus-visible]:[outline:3px_solid_var(--color-focus)] has-[:focus-visible]:[outline-offset:2px] ${
          busy
            ? 'border-field-border bg-field-bg cursor-wait'
            : 'border-rule bg-surface hover:border-neutral-ink'
        }`}
        htmlFor={inputId}
        onDragOver={(event) => {
          // Without this the browser navigates to the dropped file instead.
          event.preventDefault()
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (busy) return
          const file = event.dataTransfer.files?.[0]
          if (file !== undefined) void upload(file)
        }}
      >
        <span className="font-semibold">Træk billeder hertil</span>
        <span className="text-ink-3 text-meta">eller vælg fra telefonen · JPG, PNG og WebP</span>
        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={busy}
          id={inputId}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            // Clear the selection so choosing the same file again re-fires change.
            event.currentTarget.value = ''
            if (file !== undefined) void upload(file)
          }}
          type="file"
        />
      </label>

      <p className="text-ink-3 text-micro">
        Billedet tilpasses og komprimeres automatisk, når det er uploadet.
      </p>

      {/*
        One polite status region, mounted from the start so phase changes are
        announced without interrupting — and without a new region per attempt.
        Routine progress is a changing sentence in the same region, not a stream
        of alerts (brief §23).
      */}
      <p
        className={failed ? 'text-error-ink text-meta font-medium' : 'text-ink-2 text-meta'}
        role="status"
      >
        {sentence ?? ''}
      </p>

      <noscript>
        <p className="text-ink-3 text-meta">Upload kræver JavaScript.</p>
      </noscript>
    </div>
  )
}
