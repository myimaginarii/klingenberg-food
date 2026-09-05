'use client'

import { useEffect, useRef, useState } from 'react'

import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_IDLE,
  autosaveNext,
  autosaveSnapshot,
  autosaveStatusLine,
  type AutosaveOutcome,
  type AutosavePhase,
  type AutosaveStatusLine,
} from '@/lib/news/autosave'

/**
 * Autosave — design 1s / 1z: "Gemt for lidt siden" in the bar, and 1z's promise that
 * nothing is lost "hvis telefonen låser midt i en vagt"; phase 9B.
 *
 * The component is a **controller and a status line**, nothing more. The rules —
 * debounce, one save in flight, no save of unchanged content, what a response means,
 * every sentence — are `lib/news/autosave.ts`, pure and unit-pinned; the writes are
 * the same Server Action path an explicit Gem uses. What lives here is only the
 * wiring: listening to the form, running the machine's commands, and keeping the
 * form's hidden id and version fields current so *every* saver — autosave, Gem, the
 * publish confirmation — always submits the newest token (§6).
 *
 * It stands in the burgundy bar (where 1s draws the words) and finds its form by id,
 * because the words belong beside the Kladde badge while the fields belong to the
 * form — one client component, not a client form.
 *
 * WHAT IT NEVER DOES
 *
 *   * It never writes into a visible field. A response carries a version token and,
 *     once, a new row's id — never content. What the person typed is what stays on
 *     the screen, in every outcome including conflict (phase brief §10).
 *   * It never saves on unmount or navigation. A save that was not confirmed is not
 *     pretended (phase brief §7); the debounce is short and the Gem button remains.
 *   * It never announces routine progress to a screen reader. The visible line
 *     changes quietly; only a problem — conflict, failure, a vanished article — is
 *     put in the live region, so a long writing session does not chatter (§19).
 */

/** Structural copy of the action's response, so this component imports nothing from `app/`. */
type AutosaveResponse = {
  readonly status:
    | 'gemt'
    | 'gemt_live'
    | 'oprettet'
    | 'ugyldig'
    | 'konflikt'
    | 'vaek'
    | 'fejl'
    | 'for_mange'
  readonly articleId: string | null
  readonly version: string | null
}

export type NewsAutosaveProps = {
  /** The editor form's element id. The controller attaches to it after mount. */
  readonly formId: string
  readonly action: (formData: FormData) => Promise<AutosaveResponse>
  readonly fieldNames: {
    readonly articleId: string
    readonly version: string
    readonly title: string
    readonly displayDate: string
    readonly category: string
    readonly body: string
    readonly bodyDocument: string
  }
  /** The list path and parameters the address adopts once a new row exists (§17). */
  readonly listPath: string
  readonly articleParam: string
  readonly creatingParam: string
}

function formSnapshot(form: HTMLFormElement, names: NewsAutosaveProps['fieldNames']): string {
  const data = new FormData(form)
  const text = (name: string): string => {
    const value = data.get(name)
    return typeof value === 'string' ? value : ''
  }

  // The structured dialect wins when it speaks — the same precedence the server
  // applies (`article-form.ts`), so "changed" means what a save would mean.
  const structured = text(names.bodyDocument)

  return autosaveSnapshot({
    title: text(names.title),
    displayDate: text(names.displayDate),
    category: text(names.category),
    body: structured.length > 0 ? structured : text(names.body),
  })
}

export function NewsAutosave({
  formId,
  action,
  fieldNames,
  listPath,
  articleParam,
  creatingParam,
}: NewsAutosaveProps) {
  const [line, setLine] = useState<AutosaveStatusLine>(null)

  const stateRef = useRef<AutosavePhase>(AUTOSAVE_IDLE)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const lastSavedRef = useRef<string>('')
  const formRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    const form = document.getElementById(formId)
    if (!(form instanceof HTMLFormElement)) return
    formRef.current = form

    // The mounted form is the last saved state: autosave owes the server nothing
    // until something differs from it. Taken now and again on the next tick,
    // because the body field swaps its textarea for the structured editor in a
    // commit of its own — the baseline must describe the form as it settles, or the
    // first debounce would call the swap itself a change.
    lastSavedRef.current = formSnapshot(form, fieldNames)
    const settleBaseline = setTimeout(() => {
      lastSavedRef.current = formSnapshot(form, fieldNames)
    }, 0)

    const hidden = (name: string): HTMLInputElement | null => {
      const field = form.elements.namedItem(name)
      return field instanceof HTMLInputElement ? field : null
    }

    const dispatch = (event: Parameters<typeof autosaveNext>[1]): void => {
      const step = autosaveNext(stateRef.current, event)
      stateRef.current = step.state
      setLine(autosaveStatusLine(step.state))

      if (step.command === 'planlaeg') {
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          dispatch({ kind: 'tid', aendret: formSnapshot(form, fieldNames) !== lastSavedRef.current })
        }, AUTOSAVE_DEBOUNCE_MS)
      }

      if (step.command === 'gem') startSave()
    }

    const startSave = (): void => {
      const snapshot = formSnapshot(form, fieldNames)
      const payload = new FormData(form)

      const settle = (outcome: AutosaveOutcome): void => {
        inFlightRef.current = null
        dispatch({ kind: 'svar', resultat: outcome })
      }

      inFlightRef.current = action(payload)
        .then((response) => {
          if (response.status === 'oprettet' && response.articleId !== null) {
            // The row exists now: the editor owns its id and version, so every later
            // save — automatic or Gem — is a save of *this* row, and a reload
            // resumes it instead of an empty form (§17).
            const idField = hidden(fieldNames.articleId)
            const versionField = hidden(fieldNames.version)
            if (idField !== null) idField.value = response.articleId
            if (versionField !== null && response.version !== null) {
              versionField.value = response.version
            }

            const address = new URL(window.location.href)
            address.searchParams.delete(creatingParam)
            address.searchParams.set(articleParam, response.articleId)
            window.history.replaceState(null, '', `${listPath}?${address.searchParams.toString()}`)

            lastSavedRef.current = snapshot
            settle('gemt')
            return
          }

          if (response.status === 'gemt' || response.status === 'gemt_live') {
            const versionField = hidden(fieldNames.version)
            if (versionField !== null && response.version !== null) {
              versionField.value = response.version
            }
            lastSavedRef.current = snapshot
            settle(response.status)
            return
          }

          // An `oprettet` without an id cannot be adopted; nothing usable was written.
          settle(response.status === 'oprettet' ? 'fejl' : response.status)
        })
        .catch(() => settle('fejl'))
        .then(() => undefined)
    }

    const onEdited = (): void => dispatch({ kind: 'redigeret' })

    // A Gem pressed while a save is in flight waits for it, then goes — with the
    // fresh version token, so the two savers cannot race each other into a false
    // conflict. The pending debounce is cancelled either way: the explicit save *is*
    // the save.
    let releasing = false
    const onSubmit = (event: SubmitEvent): void => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }

      if (releasing) return

      const inFlight = inFlightRef.current
      if (inFlight !== null) {
        event.preventDefault()
        const submitter = event.submitter instanceof HTMLElement ? event.submitter : undefined
        void inFlight.then(() => {
          releasing = true
          form.requestSubmit(submitter as HTMLButtonElement | undefined)
        })
      }
    }

    form.addEventListener('input', onEdited)
    form.addEventListener('change', onEdited)
    form.addEventListener('submit', onSubmit)

    return () => {
      form.removeEventListener('input', onEdited)
      form.removeEventListener('change', onEdited)
      form.removeEventListener('submit', onSubmit)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      clearTimeout(settleBaseline)
    }
    // The field names and addresses are constants for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId])

  return (
    <>
      {/*
        The line's row is reserved on the phone (phase 12B): the bar is pinned to
        the top of the screen there, and it must not grow by a row the moment the
        first keystroke turns the line on — the compact two-row bar is 1z's. An
        alert is the one thing allowed to make it taller (its wording stays whole);
        the toolbar under the bar follows the bar's measured height
        (`PinnedBarHeight`), so no wording here is ever shortened to fit a number.
        From `md` an idle line renders nothing, as before.
      */}
      <p
        className={
          line === null
            ? 'max-md:min-h-5 max-md:basis-full md:hidden'
            : line.tone === 'alert'
              ? 'max-w-[36ch] text-meta font-semibold text-white max-md:basis-full'
              : 'text-meta text-white/70 max-md:min-h-5 max-md:basis-full'
        }
      >
        {line === null ? '' : line.text}
      </p>
      {/*
        Only trouble is announced; routine "Gemt" updates stay visual (§19). The
        region is `aria-live` without `role="status"`, deliberately: the screen's
        outcome notices own that role, and this region exists solely so a conflict
        or failure reaches a screen reader politely.
      */}
      <p aria-live="polite" className="sr-only">
        {line !== null && line.tone === 'alert' ? line.text : ''}
      </p>
    </>
  )
}
