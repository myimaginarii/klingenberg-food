'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { NewsBody as NewsBodyView } from '@/components/site/news/NewsBody'
import {
  clearLink,
  linkExtentAt,
  marksIn,
  setLink,
  tidyBodyForSave,
  toggleBold,
  type EditorRange,
  type NewsBody,
  type SelectionMarks,
} from '@/lib/news/editor-model'

import {
  readBodyFrom,
  renderBodyInto,
  selectionRangeIn,
  setSelectionRange,
} from './body-editor-dom'

/**
 * The Tekst field — design 1s / 1z: the writing box with exactly **B** and **Link**;
 * phase 9B.
 *
 * One field, three appearances, chosen by what can be done *safely*:
 *
 *   * **Scripting on** — the structured editor: a `contenteditable` surface over the
 *     stored body, the two-button toolbar, and a hidden field carrying the document
 *     as JSON (`tekst_struktur`). Every rule lives in `lib/news/editor-model.ts`;
 *     every DOM translation in `./body-editor-dom.ts`; this component wires them.
 *   * **Scripting off, body without marks** — the 9A textarea, unchanged: plain
 *     paragraphs in, plain paragraphs out. Nothing is lost, because there is nothing
 *     a textarea cannot carry.
 *   * **Scripting off, body with marks** — the body is shown read-only with a
 *     sentence saying why, and the *original structured document* rides along in the
 *     hidden field, so Gem saves the other fields and returns the text byte for
 *     byte. This is 9A's `hasMarks` guard doing its job: a body with bold or links
 *     has no faithful plain-text form, and flattening it silently is the one thing
 *     this field must never do (phase brief §6).
 *
 * WHAT THE EDITOR REFUSES, BY CONSTRUCTION
 *
 * No headings, no HTML mode, no Markdown, no code view, no italic, no underline, no
 * lists (frame 1s's own note). `beforeinput` cancels every `format*` command except
 * bold — so Ctrl+I does nothing — and paste inserts the clipboard's *plain text*
 * only: markup never enters the model, which is why the public renderer still needs
 * no sanitizer (§8).
 */

export type NewsBodyFieldProps = {
  readonly id: string
  /** The plain dialect's field name (`tekst`). */
  readonly name: string
  /** The structured dialect's field name (`tekst_struktur`). It wins when present. */
  readonly structuredName: string
  readonly label: string
  readonly error?: string
  /** The plain projection — the textarea's seed. Faithful only when !hasMarks. */
  readonly initialText: string
  /** The structured document, or null when only plain text exists. */
  readonly initialDocument: NewsBody | null
  readonly hasMarks: boolean
}

/** The plain seed as an editing document — blank line = new paragraph (the 9A rule). */
function editingBodyFromText(text: string): NewsBody {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => ({ type: 'paragraph' as const, spans: [{ text: paragraph }] }))

  return { blocks: blocks.length > 0 ? blocks : [{ type: 'paragraph', spans: [{ text: '' }] }] }
}

function serializeForSave(body: NewsBody): string {
  const tidy = tidyBodyForSave(body)
  return tidy === null ? '' : JSON.stringify(tidy)
}

type LinkPanel =
  | { readonly kind: 'lukket' }
  /** No selection to link — one sentence, one way out. */
  | { readonly kind: 'ingen-markering' }
  | {
      readonly kind: 'aaben'
      readonly range: EditorRange
      readonly href: string
      /** True when the range already links — offers "Fjern link". */
      readonly existing: boolean
      readonly problem: string | null
    }

const NO_MARKS: SelectionMarks = { bold: false, href: null, hasLink: false }

/**
 * False on the server and during hydration, true immediately after — how the field
 * chooses between its no-JavaScript fallbacks and the structured editor without a
 * hydration mismatch. `useSyncExternalStore`'s server snapshot is the mechanism
 * React provides for exactly this.
 */
const subscribeToNothing = () => () => {}
function useEnhanced(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  )
}

export function NewsBodyField({
  id,
  name,
  structuredName,
  label,
  error,
  initialText,
  initialDocument,
  hasMarks,
}: NewsBodyFieldProps) {
  const enhanced = useEnhanced()
  const [panel, setPanel] = useState<LinkPanel>({ kind: 'lukket' })
  const [selection, setSelection] = useState<SelectionMarks>(NO_MARKS)

  const editableRef = useRef<HTMLDivElement | null>(null)
  const hiddenRef = useRef<HTMLInputElement | null>(null)
  const lastRangeRef = useRef<EditorRange | null>(null)
  const hrefInputRef = useRef<HTMLInputElement | null>(null)
  // The latest bold handler, for the native beforeinput listener further down.
  const onBoldRef = useRef<() => void>(() => {})

  // Anything typed into the fallback textarea before the editor takes over. The
  // textarea is uncontrolled, so at the swap its live value — not the server's
  // seed — is what the person means, and it must not be thrown away.
  const fallbackTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const typedBeforeEnhanceRef = useRef<string | null>(null)
  const adoptTextarea = (element: HTMLTextAreaElement | null) => {
    if (element !== null) {
      fallbackTextareaRef.current = element
    } else if (fallbackTextareaRef.current !== null) {
      typedBeforeEnhanceRef.current = fallbackTextareaRef.current.value
      fallbackTextareaRef.current = null
    }
  }

  // Draw the initial document into the surface once the editor exists.
  useEffect(() => {
    if (!enhanced) return
    const root = editableRef.current
    if (root === null) return

    const typed = typedBeforeEnhanceRef.current
    const body =
      typed !== null && typed !== initialText
        ? editingBodyFromText(typed)
        : (initialDocument ?? editingBodyFromText(initialText))
    renderBodyInto(root, body)
    if (hiddenRef.current !== null) hiddenRef.current.value = serializeForSave(body)
    // The seed is what the server rendered; nothing changed, so nothing is announced
    // and no input event is fired.
  }, [enhanced, initialDocument, initialText])

  // The toolbar's pressed state follows the selection.
  useEffect(() => {
    if (!enhanced) return

    const handle = () => {
      const root = editableRef.current
      if (root === null) return
      const range = selectionRangeIn(root)
      if (range === null) return

      lastRangeRef.current = range
      setSelection(marksIn(readBodyFrom(root), range))
    }

    document.addEventListener('selectionchange', handle)
    return () => document.removeEventListener('selectionchange', handle)
  }, [enhanced])

  const syncHidden = () => {
    const root = editableRef.current
    if (root === null || hiddenRef.current === null) return
    hiddenRef.current.value = serializeForSave(readBodyFrom(root))
  }

  /** Announce a change the browser did not make itself (a toolbar operation). */
  const notifyChanged = () => {
    editableRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const currentRange = (): EditorRange | null => {
    const root = editableRef.current
    if (root === null) return null
    return selectionRangeIn(root) ?? lastRangeRef.current
  }

  const applyToRange = (range: EditorRange, op: (body: NewsBody) => NewsBody) => {
    const root = editableRef.current
    if (root === null) return

    const next = op(readBodyFrom(root))
    renderBodyInto(root, next)
    setSelectionRange(root, range)
    lastRangeRef.current = range
    setSelection(marksIn(next, range))
    syncHidden()
    notifyChanged()
  }

  const onBold = () => {
    const range = currentRange()
    if (range === null) return
    // An empty selection marks nothing — and must corrupt nothing.
    if (range.start.block === range.end.block && range.start.offset === range.end.offset) return
    applyToRange(range, (body) => toggleBold(body, range))
  }
  // Kept current after every commit, so the native listener always calls the
  // handler that sees this render's state.
  useEffect(() => {
    onBoldRef.current = onBold
  })

  const onLinkButton = () => {
    const root = editableRef.current
    if (root === null) return

    if (panel.kind !== 'lukket') {
      setPanel({ kind: 'lukket' })
      return
    }

    const range = currentRange()
    const body = readBodyFrom(root)

    if (range === null) {
      setPanel({ kind: 'ingen-markering' })
      return
    }

    const collapsed =
      range.start.block === range.end.block && range.start.offset === range.end.offset

    if (collapsed) {
      // A caret inside a link edits that link, whole; a caret elsewhere has nothing
      // to link yet.
      const extent = linkExtentAt(body, range.start)
      if (extent === null) {
        setPanel({ kind: 'ingen-markering' })
        return
      }
      setPanel({ kind: 'aaben', range: extent.range, href: extent.href, existing: true, problem: null })
      return
    }

    const marks = marksIn(body, range)
    setPanel({
      kind: 'aaben',
      range,
      href: marks.href ?? '',
      existing: marks.hasLink,
      problem: null,
    })
  }

  // The URL field receives focus when the panel opens — a keyboard user pressed Link
  // to type an address. The selection is kept as offsets and restored on the way out.
  useEffect(() => {
    if (panel.kind === 'aaben') hrefInputRef.current?.focus()
  }, [panel.kind])

  const closePanel = (restoreTo: EditorRange | null) => {
    setPanel({ kind: 'lukket' })
    const root = editableRef.current
    if (root !== null && restoreTo !== null) {
      root.focus()
      setSelectionRange(root, restoreTo)
    }
  }

  const onApplyLink = () => {
    if (panel.kind !== 'aaben') return

    const value = (hrefInputRef.current?.value ?? '').trim()

    // The same rule the server re-checks (`lib/schemas/news.ts`): an absolute https:
    // address and nothing else — no javascript:, no data:, no relative guesses.
    let valid = false
    try {
      const url = new URL(value)
      valid = url.protocol === 'https:' && value.length <= 2048
    } catch {
      valid = false
    }

    if (!valid) {
      setPanel({ ...panel, href: value, problem: 'Linket skal være en fuld https-adresse.' })
      return
    }

    const range = panel.range
    applyToRange(range, (body) => setLink(body, range, value))
    closePanel(range)
  }

  const onRemoveLink = () => {
    if (panel.kind !== 'aaben') return
    const range = panel.range
    applyToRange(range, (body) => clearLink(body, range))
    closePanel(range)
  }

  // Native, not React's `onBeforeInput`: React only synthesizes that event for text
  // insertion, so `formatBold` (Ctrl+B) and its siblings never reach it. The rule —
  // bold routes through our toggle, every other formatting command (italic,
  // underline, indent…) is cancelled outright (frame 1s) — needs the real event.
  useEffect(() => {
    if (!enhanced) return
    const root = editableRef.current
    if (root === null) return

    const handle = (event: InputEvent) => {
      const inputType = event.inputType ?? ''
      if (inputType === 'formatBold') {
        event.preventDefault()
        onBoldRef.current()
      } else if (inputType.startsWith('format')) {
        event.preventDefault()
      }
    }

    root.addEventListener('beforeinput', handle)
    return () => root.removeEventListener('beforeinput', handle)
  }, [enhanced])

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    // Plain text only: the clipboard's markup never reaches the model (§8).
    event.preventDefault()

    const text = event.clipboardData.getData('text/plain')
    const root = editableRef.current
    const doc = root?.ownerDocument
    const window = doc?.defaultView
    if (root === null || doc === undefined || window === null || window === undefined) return

    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!root.contains(range.startContainer)) return

    range.deleteContents()
    if (text.length > 0) {
      const node = doc.createTextNode(text)
      range.insertNode(node)
      range.setStartAfter(node)
      range.setEndAfter(node)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    syncHidden()
    notifyChanged()
  }

  const labelId = `${id}-etiket`
  const hintId = `${id}-hjaelp`
  const errorId = `${id}-fejl`
  const describedBy =
    [error === undefined ? null : errorId, hintId].filter((value) => value !== null).join(' ') ||
    undefined

  const frame = error === undefined ? 'border-field-border' : 'border-error'

  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="text-meta text-neutral-ink font-medium"
        htmlFor={enhanced ? undefined : hasMarks ? undefined : id}
        id={labelId}
      >
        {label}
      </label>

      {enhanced ? (
        <>
          <input name={structuredName} ref={hiddenRef} type="hidden" />

          {/*
            `overflow-clip` rather than `overflow-hidden`: both clip the surface to the
            rounded frame, but `hidden` also makes the frame a scroll container, which
            would pin the sticky toolbar below to the frame instead of to the screen.
          */}
          <div className={`bg-field-bg rounded-field overflow-clip border-[1.5px] ${frame}`}>
            {/*
              The toolbar and its link panel stick to the top of the phone screen
              (phase 12B, 1z), directly under the pinned section bar, so B and Link
              are one tap away however far down a long article the person is
              writing — and the link panel opens in view, beside the toolbar, rather
              than at the top of the article. From `md` the group is exactly 1s's row
              at the top of the writing box. `top` is the pinned bar's *measured*
              height (`--admin-bar-height`, published by the bar itself —
              `PinnedBarHeight`), so a conflict that puts several lines of wording
              into the bar moves the toolbar down with it instead of under it; `6.25rem`
              is the bar's two ordinary rows, for the paint before the first
              measurement.
            */}
            <div className="bg-field-bg max-md:sticky max-md:top-[var(--admin-bar-height,6.25rem)] max-md:z-10">
              {/* 1s's toolbar: B and Link, and nothing else. */}
              <div
                aria-label="Formatering"
                className="border-border flex items-center gap-1.5 border-b px-2 py-1.5"
                role="toolbar"
              >
                <button
                  aria-pressed={selection.bold}
                  className="rounded-field text-ink aria-pressed:bg-section min-h-tap min-w-tap inline-flex items-center justify-center px-3 font-bold hover:bg-section"
                  onClick={onBold}
                  onMouseDown={(event) => event.preventDefault()}
                  type="button"
                >
                  <span aria-hidden="true">B</span>
                  <span className="sr-only">Fed skrift</span>
                </button>

                <button
                  aria-expanded={panel.kind !== 'lukket'}
                  className="rounded-field text-neutral-ink min-h-tap min-w-tap inline-flex items-center justify-center px-3 font-medium underline hover:bg-section"
                  onClick={onLinkButton}
                  onMouseDown={(event) => event.preventDefault()}
                  type="button"
                >
                  Link
                </button>
              </div>

              {panel.kind === 'ingen-markering' ? (
                <div className="border-border flex flex-col gap-2 border-b p-3 md:flex-row md:items-center md:justify-between">
                  <p className="text-ink-2 text-meta">
                    Markér først den tekst, der skal være et link.
                  </p>
                  <button
                    className="rounded-field border-neutral-ink text-neutral-ink min-h-tap inline-flex items-center justify-center border px-3 text-meta font-medium"
                    onClick={() => closePanel(lastRangeRef.current)}
                    type="button"
                  >
                    Luk
                  </button>
                </div>
              ) : null}

              {panel.kind === 'aaben' ? (
                <div className="border-border flex flex-col gap-2 border-b p-3">
                  <label className="text-meta text-neutral-ink font-medium" htmlFor={`${id}-link`}>
                    Linkadresse
                  </label>
                  <input
                    aria-describedby={panel.problem === null ? undefined : `${id}-link-fejl`}
                    aria-invalid={panel.problem === null ? undefined : true}
                    className={`bg-surface rounded-field w-full border-[1.5px] px-3 min-h-12 ${panel.problem === null ? 'border-field-border' : 'border-error'}`}
                    defaultValue={panel.href}
                    id={`${id}-link`}
                    inputMode="url"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        onApplyLink()
                      }
                    }}
                    placeholder="https://…"
                    ref={hrefInputRef}
                    type="text"
                  />
                  {panel.problem === null ? null : (
                    <p className="text-error-ink text-meta font-medium" id={`${id}-link-fejl`}>
                      {panel.problem}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="bg-brand-700 hover:bg-brand-500 rounded-field min-h-tap inline-flex items-center justify-center px-4 text-meta font-semibold text-white"
                      onClick={onApplyLink}
                      type="button"
                    >
                      {panel.existing ? 'Gem link' : 'Indsæt link'}
                    </button>
                    {panel.existing ? (
                      <button
                        className="rounded-field border-error text-error-ink min-h-tap inline-flex items-center justify-center border-[1.5px] px-4 text-meta font-semibold"
                        onClick={onRemoveLink}
                        type="button"
                      >
                        Fjern link
                      </button>
                    ) : null}
                    <button
                      className="rounded-field border-neutral-ink text-neutral-ink min-h-tap inline-flex items-center justify-center border px-4 text-meta font-medium"
                      onClick={() => closePanel(panel.range)}
                      type="button"
                    >
                      Annullér
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div
              aria-describedby={describedBy}
              aria-invalid={error === undefined ? undefined : true}
              aria-labelledby={labelId}
              aria-multiline="true"
              className="text-ink min-h-40 p-3 leading-relaxed whitespace-pre-wrap"
              contentEditable
              onDrop={(event) => event.preventDefault()}
              onInput={syncHidden}
              onPaste={onPaste}
              ref={editableRef}
              role="textbox"
              suppressContentEditableWarning
            />
          </div>

          <p className="text-ink-3 text-micro" id={hintId}>
            Ingen overskrifter, ingen HTML, ingen kodevisning — kun fed skrift og links.
          </p>
        </>
      ) : hasMarks && initialDocument !== null ? (
        <>
          {/*
            No scripting, and the body carries bold or links: editing it as plain text
            would flatten the marks on the next Gem, so the text rides along unchanged
            and the sentence says why. The other fields stay editable.
          */}
          <input name={structuredName} type="hidden" value={JSON.stringify(initialDocument)} />
          <div className="bg-field-bg border-field-border rounded-field text-ink-2 border-[1.5px] p-3">
            <NewsBodyView body={initialDocument} />
          </div>
          <p className="text-ink-2 text-meta" id={hintId}>
            Teksten indeholder fed skrift eller links og kan kun redigeres, når JavaScript er
            slået til. Gemmer du nu, gemmes teksten uændret — overskrift, dato og kategori kan
            stadig rettes.
          </p>
        </>
      ) : (
        <>
          <textarea
            aria-describedby={describedBy}
            aria-invalid={error === undefined ? undefined : true}
            className={`bg-field-bg rounded-field w-full border-[1.5px] p-3 leading-relaxed text-ink ${frame}`}
            defaultValue={initialText}
            id={id}
            name={name}
            ref={adoptTextarea}
            rows={10}
          />
          <p className="text-ink-3 text-micro" id={hintId}>
            Skriv det, som du ville fortælle det til en gæst. En tom linje giver et nyt afsnit.
            Ingen overskrifter og ingen HTML.
          </p>
        </>
      )}

      {error === undefined ? null : (
        <p className="text-error-ink text-meta flex items-center gap-1.5 font-medium" id={errorId}>
          <span aria-hidden="true" className="border-error size-3.5 shrink-0 rounded-full border-2" />
          {error}
        </p>
      )}
    </div>
  )
}
