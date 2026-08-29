'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { describeHandle, dropIndex } from '@/lib/menu/reorder'

/**
 * The drag handle from design 1r — and nothing else.
 *
 * 1r draws three grey lines at the left of every dish row and says, in the note beneath
 * the list: *"Rækkefølgen ændres ved at trække i håndtaget til venstre."* 1y says
 * *"Hold på en række for at flytte den."* This component is both of those sentences,
 * and it is deliberately the **only** client code in the reorder feature.
 *
 * WHAT IT IS, AND WHAT IT IS NOT
 *
 * It is an *enhancement*. The row it sits in already carries two ordinary submit
 * buttons — Flyt op and Flyt ned — in the same `<form>`, server-rendered, working with
 * the keyboard, with touch and with JavaScript switched off. This component adds a
 * pointer gesture on top of them and a pair of arrow keys, and when it has decided
 * where the row should go it submits **that same form**, through the same Server Action,
 * with the same field. Take the JavaScript away and the feature loses a gesture, not a
 * capability.
 *
 * It is emphatically **not** a menu store. It holds no dish, no order, no draft and no
 * database knowledge; it never fetches; and it does not re-render the list. The only
 * state it owns is "is a drag currently happening", which is true for a few hundred
 * milliseconds at a time. After it submits, the authoritative order comes back from the
 * server and the list is server-rendered again — the browser's opinion is discarded
 * rather than reconciled.
 *
 * WHY THE DESTINATION IS AN INDEX AND NOT A `sort_order`
 *
 * The gesture can see a list; it cannot see a database. So it computes a **position in
 * the list** and submits that, and the server turns positions into stored values with
 * `sortOrderWrites`. A browser that proposed `sort_order` numbers would be proposing
 * database state; a browser that proposes "third from the top" is proposing exactly
 * what the person did with their finger.
 *
 * ACTIVATING THE HANDLE ITSELF DOES NOTHING, ON PURPOSE
 *
 * It is `type="button"`, so Enter and Space on it submit nothing. A handle has no single
 * obvious "do it" — the destination is the whole question — so its accessible name says
 * which keys answer that question, and the two visible buttons beside it answer it too.
 * Submissions go through a hidden submit button whose value is set immediately before it
 * is clicked, which is what keeps a stale destination from ever being submittable.
 *
 * MOTION
 *
 * The dragged row follows the pointer through a direct `transform`, with no transition
 * on it, so there is no animation to suppress under `prefers-reduced-motion` — the row
 * is simply where the finger is. The drop indicator is a border, not a movement.
 */

/** 1y's "hold": a touch must rest on the handle this long before a drag begins. */
const TOUCH_HOLD_MS = 300

/** How far a touch may wander during the hold before it is read as a scroll, not a drag. */
const TOUCH_HOLD_SLOP_PX = 8

/**
 * "Is this component actually running in a browser?", the way React asks it.
 *
 * The store never changes, so the subscription does nothing; the two snapshots are the
 * whole of it — `false` while the server renders the markup and while it hydrates,
 * `true` from the first render after that. `useSyncExternalStore` is the hook for
 * exactly this question, and unlike a `useEffect` that sets state it does not put a
 * second render into the critical path or trip the "no setState in an effect" rule.
 */
const NEVER_CHANGES = () => () => {}
const whileRunning = () => true
const whileServerRendered = () => false

type DragState = {
  readonly pointerId: number
  readonly row: HTMLElement
  /** Every row in the list, in document order, captured once at pointer-down. */
  readonly rows: readonly HTMLElement[]
  /** Each row's vertical midpoint at pointer-down. The geometry the drop uses. */
  readonly centres: readonly number[]
  readonly fromIndex: number
  readonly startY: number
  holdTimer: number | null
  engaged: boolean
  /** The destination, as an index into the list with this row taken out of it. */
  target: number
}

export function ReorderHandle({
  dishName,
  index,
  total,
  fieldName,
  justMoved,
}: {
  dishName: string
  /** This row's zero-based position in the section's list. */
  index: number
  total: number
  /** The name of the destination field, passed in rather than imported from `app/`. */
  fieldName: string
  /** True when this is the dish the last reorder moved. Used only to recover focus. */
  justMoved: boolean
}) {
  const handle = useRef<HTMLButtonElement>(null)
  const commit = useRef<HTMLButtonElement>(null)
  const drag = useRef<DragState | null>(null)
  const [dragging, setDragging] = useState(false)

  /**
   * Whether this component is actually running.
   *
   * A Client Component is still *rendered by the server*, so its markup reaches a
   * browser with scripting switched off — and there the handle would be a focusable
   * button that does nothing, which is worse than no handle at all. `ready` is false in
   * the server's HTML and true after the first effect, so without JavaScript the handle
   * stays disabled and out of the accessibility tree, and the two ordinary submit
   * buttons beside it carry the whole feature.
   *
   * It is drawn either way, so nothing on the row moves when it comes alive.
   */
  const ready = useSyncExternalStore(NEVER_CHANGES, whileRunning, whileServerRendered)

  /**
   * Submit the row's own form with `destination` as the wanted position.
   *
   * The value is written a moment before the click, never rendered ahead of time, so
   * there is no window in which the form carries a destination nobody asked for.
   */
  const submitMove = useCallback((destination: number) => {
    const button = commit.current
    if (button === null) return

    button.value = String(destination)
    button.click()
  }, [])

  /** Undo every imperative change a drag made to the list's DOM. */
  const clearVisuals = useCallback(() => {
    const state = drag.current
    if (state === null) return

    for (const row of state.rows) {
      row.style.transform = ''
      row.style.zIndex = ''
      delete row.dataset.dragging
      delete row.dataset.drop
    }
  }, [])

  const endDrag = useCallback(
    (options: { readonly commitMove: boolean }) => {
      const state = drag.current
      if (state === null) return

      if (state.holdTimer !== null) window.clearTimeout(state.holdTimer)

      try {
        if (handle.current?.hasPointerCapture(state.pointerId) === true) {
          handle.current.releasePointerCapture(state.pointerId)
        }
      } catch {
        // The pointer is already gone; there is nothing left to release.
      }

      clearVisuals()

      const { engaged, target, fromIndex } = state
      drag.current = null
      setDragging(false)

      if (options.commitMove && engaged && target !== fromIndex) submitMove(target)
    },
    [clearVisuals, submitMove],
  )

  /**
   * Ask `dropIndex` where the row would land, and draw the border that says so.
   *
   * The arithmetic is `lib/menu/reorder.ts`'s; what happens here is the two DOM effects
   * that go with it — remembering the answer for the drop, and marking the row the
   * dragged one would land beside.
   */
  const updateTarget = useCallback((state: DragState, deltaY: number) => {
    const centre = (state.centres[state.fromIndex] ?? 0) + deltaY
    const target = dropIndex(state.centres, state.fromIndex, centre)

    state.target = target

    const remaining = state.rows.filter((_, position) => position !== state.fromIndex)
    for (const row of remaining) delete row.dataset.drop

    const before = remaining[target]
    if (before !== undefined) {
      before.dataset.drop = 'before'
    } else {
      const last = remaining[remaining.length - 1]
      if (last !== undefined) last.dataset.drop = 'after'
    }
  }, [])

  const engage = useCallback((state: DragState) => {
    state.engaged = true
    state.row.dataset.dragging = 'true'
    state.row.style.zIndex = '1'
    setDragging(true)
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return

      const row = event.currentTarget.closest('li')
      const list = row?.parentElement
      if (row === null || list === null || list === undefined) return

      const rows = [...list.children].filter((node): node is HTMLElement =>
        node instanceof HTMLElement,
      )
      const fromIndex = rows.indexOf(row)
      if (fromIndex === -1) return

      const state: DragState = {
        pointerId: event.pointerId,
        row,
        rows,
        centres: rows.map((node) => {
          const box = node.getBoundingClientRect()
          return box.top + box.height / 2
        }),
        fromIndex,
        startY: event.clientY,
        holdTimer: null,
        engaged: false,
        target: fromIndex,
      }

      drag.current = state

      // Capture keeps the moves coming while the pointer is outside a 44 px handle,
      // which is most of a drag. It is an optimisation, not the mechanism: a pointer id
      // the element cannot capture — a synthesised event, an id already released —
      // throws, and the drag is perfectly usable without it.
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Nothing to do. `endDrag` releases only what was captured.
      }

      // A mouse means business immediately. A finger has to rest first (1y), so that
      // brushing past the handle while reading the list moves nothing.
      if (event.pointerType === 'mouse') {
        engage(state)
      } else {
        state.holdTimer = window.setTimeout(() => {
          state.holdTimer = null
          if (drag.current === state) engage(state)
        }, TOUCH_HOLD_MS)
      }
    },
    [engage],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = drag.current
      if (state === null || state.pointerId !== event.pointerId) return

      const deltaY = event.clientY - state.startY

      if (!state.engaged) {
        // Still waiting out the hold. A finger that has already travelled is scrolling,
        // not grabbing, so the drag is abandoned rather than started under it.
        if (Math.abs(deltaY) > TOUCH_HOLD_SLOP_PX) endDrag({ commitMove: false })
        return
      }

      event.preventDefault()
      state.row.style.transform = `translateY(${deltaY}px)`
      updateTarget(state, deltaY)
    },
    [endDrag, updateTarget],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (drag.current !== null) {
        if (event.key === 'Escape') endDrag({ commitMove: false })
        return
      }

      // One step per press, in the direction the key names, and never past either end.
      // The same two destinations the visible Flyt op / Flyt ned buttons carry, so the
      // keyboard and the buttons cannot drift apart.
      if (event.key === 'ArrowUp' && index > 0) {
        event.preventDefault()
        submitMove(index - 1)
      }

      if (event.key === 'ArrowDown' && index < total - 1) {
        event.preventDefault()
        submitMove(index + 1)
      }
    },
    [endDrag, index, submitMove, total],
  )

  // A drag that outlives its component — the row is re-rendered mid-gesture — must not
  // leave a transform behind on a node nobody owns any more.
  useEffect(() => () => clearVisuals(), [clearVisuals])

  /**
   * Give the keyboard back, but only when the browser has already dropped it.
   *
   * Moving a row to the top disables its own Flyt op button, and a browser moves focus
   * to `<body>` when the element holding it becomes disabled. Leaving it there would end
   * the keyboard journey the phase brief requires to be completable without a mouse.
   *
   * This is recovery, not theft: it runs only for the dish that was just moved, and only
   * when nothing has focus. A person who was reading elsewhere on the screen keeps their
   * place, and the toast rule from 1aa — messages never take focus — is untouched,
   * because no message is involved.
   */
  useEffect(() => {
    if (!justMoved) return
    if (document.activeElement !== null && document.activeElement !== document.body) return

    handle.current?.focus({ preventScroll: true })
  }, [justMoved])

  return (
    <>
      <button
        aria-hidden={!ready}
        aria-label={describeHandle({ dishName, position: index + 1, total })}
        className={`rounded-field border-field-border bg-surface text-ink-3 hover:text-ink size-tap flex shrink-0 cursor-grab touch-none items-center justify-center border disabled:cursor-default disabled:opacity-50 ${
          dragging ? 'cursor-grabbing' : ''
        }`}
        disabled={!ready}
        onKeyDown={onKeyDown}
        onLostPointerCapture={() => endDrag({ commitMove: false })}
        onPointerCancel={() => endDrag({ commitMove: false })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endDrag({ commitMove: true })}
        ref={handle}
        type="button"
      >
        {/* 1r's glyph: three 16 × 2 bars. Decoration — the name above carries the meaning. */}
        <span aria-hidden="true" className="flex flex-col gap-[3px]">
          <span className="bg-rule block h-[2px] w-4" />
          <span className="bg-rule block h-[2px] w-4" />
          <span className="bg-rule block h-[2px] w-4" />
        </span>
      </button>

      {/*
        The submit the gesture and the arrow keys use. It exists only when this component
        does — that is, only with JavaScript — so the no-JavaScript form contains nothing
        but the two visible buttons and cannot submit an empty destination.
      */}
      <button
        aria-hidden="true"
        hidden
        name={fieldName}
        ref={commit}
        tabIndex={-1}
        type="submit"
        value={index}
      />
    </>
  )
}
