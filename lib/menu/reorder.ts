/**
 * Reordering dishes inside one section — design 1r / 1y, technical plan §4, §6.
 *
 * Pure, and deliberately the whole of the thinking. Nothing here reads a database,
 * writes a draft, touches React or knows that a browser exists; the Server Action
 * (`app/(admin)/admin/menu/reorder-actions.ts`) supplies the current order and applies
 * whatever this module says, and the drag handle
 * (`components/admin/menu/ReorderHandle.tsx`) supplies a pair of indices and nothing
 * else. That split is the point: a reorder is one small calculation surrounded by a lot
 * of interaction, and only the calculation has to be right in a way a test can prove.
 *
 * REORDERING IS AN ORDINARY DRAFT CHANGE
 *
 * It is **not** a third immediate path. Udsolgt (§6) and Slet ret (§7e item 4) change
 * the hjemmeside at once; moving a dish does not. It writes `sort_order` into `draft`,
 * exactly as a price edit writes `price_ore`, and the public menu keeps the published
 * order until somebody presses Offentliggør. There is no reorder-publish path, no
 * second ordering table, and no live `sort_order` write anywhere in phase 5E.
 *
 * WHAT THE FOUR FUNCTIONS ARE FOR
 *
 *   * {@link reorderDishes} — the move itself. Given a list and two indices, produce the
 *     new list. Total, deterministic, and non-mutating.
 *   * {@link dropIndex} — the gesture's half of the same question. Given where the rows
 *     are and where the dragged one now is, say which index that means.
 *   * {@link sortOrderWrites} — the consequence. Given the new order, say which dishes'
 *     **drafts** have to change, and which have to stop carrying a position at all.
 *   * {@link orderFingerprint} — the staleness token. Given the order a screen was
 *     rendered from, produce a short string the server can recompute and compare, so a
 *     move made against a list somebody else has since changed is refused rather than
 *     applied to a different list than the person saw (§6, §7e item 2).
 */

/**
 * How a refused move is described. Three refusals, because they are three different
 * mistakes and a person — or a log — deserves to be told which.
 */
export type ReorderRefusal =
  /** There is nothing to reorder. */
  | 'empty'
  /** The dish being moved is not at a position this list has. */
  | 'from_out_of_range'
  /** The destination is not a position this list has. */
  | 'to_out_of_range'

export type ReorderOutcome<T> =
  | { readonly ok: true; readonly items: readonly T[] }
  | { readonly ok: false; readonly reason: ReorderRefusal }

/** A whole number inside `[0, length)`. Rejects `NaN`, fractions and infinities alike. */
function isPosition(value: number, length: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < length
}

/**
 * Move one item from `fromIndex` to `toIndex`.
 *
 * The five properties this has to have, and which the unit suite asserts one by one:
 *
 *   1. **Every item survives, exactly once.** A reorder that loses a dish, or shows one
 *      twice, is worse than a reorder that refuses.
 *   2. **The relative order of everything else is preserved.** Moving Ragnar above Frigg
 *      must not disturb Thor and Glade Gris.
 *   3. **It is deterministic.** No clock, no randomness, no `localeCompare` — the same
 *      three arguments always produce the same list. That is what lets the server
 *      recompute a move the browser proposed instead of believing it.
 *   4. **The input array is never mutated.** `splice` on a copy, never on the argument.
 *      The caller's list is the list the screen was rendered from; changing it under
 *      them would make a refusal indistinguishable from a success.
 *   5. **An impossible index is refused, not clamped.** Clamping would turn "move to
 *      position 40" — a forged submission, or a stale one — into a silent move to the
 *      end. A refusal is the honest answer, and `reason` says which index was wrong.
 *
 * `fromIndex === toIndex` is a **success**, not a refusal: nothing moved, and a person
 * who pressed a control and was told "no" would reasonably think it was broken. The
 * result is still a fresh array, so property 4 holds for the no-op too.
 */
export function reorderDishes<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): ReorderOutcome<T> {
  if (items.length === 0) return { ok: false, reason: 'empty' }
  if (!isPosition(fromIndex, items.length)) return { ok: false, reason: 'from_out_of_range' }
  if (!isPosition(toIndex, items.length)) return { ok: false, reason: 'to_out_of_range' }

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)

  /* v8 ignore next -- `fromIndex` is in range, so the splice always removed one item. */
  if (moved === undefined) return { ok: false, reason: 'from_out_of_range' }

  next.splice(toIndex, 0, moved)

  return { ok: true, items: next }
}

/**
 * Where a dragged row would land, from geometry alone — design 1r's handle.
 *
 * The one calculation the drag gesture needs, and it lives here rather than in the
 * component for the reason every other rule in this module does: it is arithmetic about
 * an ordering, it has edge cases worth stating, and a component is a bad place to test
 * either. What is left in `ReorderHandle` is genuinely only interaction — capture the
 * pointer, follow it, ask this function where the row is now, submit.
 *
 * The measure is **midpoints**, and the answer is a count rather than a distance: how
 * many of the *other* rows have their middle above the dragged row's current middle.
 * That is exactly the index `reorderDishes` splices into once the dragged row has been
 * taken out, so the gesture and the server's rule speak the same language and nothing in
 * between has to convert between "pixels" and "position".
 *
 * `centres` is captured once, when the drag starts. The rows do not move during a drag —
 * only the dragged one does, and only visually — so measuring them again mid-gesture
 * would be measuring the animation rather than the list.
 */
export function dropIndex(
  centres: readonly number[],
  fromIndex: number,
  draggedCentre: number,
): number {
  let index = 0

  centres.forEach((centre, position) => {
    if (position !== fromIndex && centre < draggedCentre) index += 1
  })

  return index
}

/**
 * The first position in a section's order.
 *
 * One, not zero, because that is what `supabase/seed/confirmed.sql` writes and what
 * `nextSortOrderIn` in `lib/menu/admin.ts` produces for an empty section. A list that
 * starts at 1 also reads correctly in the sentence a person hears — "plads 1 af 6" —
 * with no arithmetic between the stored value and the spoken one.
 */
export const FIRST_SORT_ORDER = 1

/** The position a dish holds at `index` in an ordered list. */
export function sortOrderAt(index: number): number {
  return index + FIRST_SORT_ORDER
}

/**
 * One dish, as reordering needs to see it.
 *
 * Three numbers rather than one, because a draft is a difference and the difference can
 * only be computed against what is **live**:
 *
 *   * `sortOrder` — the position the administration currently shows, draft applied.
 *   * `liveSortOrder` — the published position. What a guest sees right now.
 *   * `hasDraftSortOrder` — whether the stored draft already carries a position.
 */
export type OrderedDish = {
  readonly id: string
  readonly sortOrder: number
  readonly liveSortOrder: number
  readonly hasDraftSortOrder: boolean
}

/**
 * What one dish's draft has to do about its position.
 *
 * `set` writes a position into the draft; `clear` takes one out of it. A dish that
 * needs neither is simply absent from the result.
 */
export type SortOrderWrite =
  | { readonly id: string; readonly action: 'set'; readonly sortOrder: number }
  | { readonly id: string; readonly action: 'clear' }

/**
 * Turn a new order into the smallest set of draft changes that produces it.
 *
 * Clean positions first: the list is numbered 1, 2, 3 … with no gaps, whatever the
 * stored values happened to be. Fractional midpoints and ever-growing integers are the
 * two usual ways an ordering column rots, and neither is necessary here — a section
 * holds a dozen dishes and the whole list is in hand.
 *
 * Then two decisions per dish, and the second is the one that is easy to get wrong:
 *
 *   * **The new position differs from the live one** → the draft must carry it, unless
 *     the draft already carries exactly that value. That is what stops a move from
 *     rewriting drafts it does not change.
 *   * **The new position *is* the live one** → the draft must not carry a position at
 *     all. §4 describes a draft as holding "only the changed fields", and a dish moved
 *     down and back up again has changed nothing. Leaving the value behind would put a
 *     Kladde badge on a row with nothing pending, list it in `pending_changes`, and
 *     make Offentliggør claim to change an order it will leave exactly as it is. So the
 *     value is **cleared**, which is what `SaveDraftRequest.clear` exists for.
 *
 * The result is in list order, which is also the order the writes are applied in — a
 * detail that matters only for reading a log, since nothing here depends on the order
 * of the writes.
 */
export function sortOrderWrites(ordered: readonly OrderedDish[]): readonly SortOrderWrite[] {
  const writes: SortOrderWrite[] = []

  ordered.forEach((dish, index) => {
    const position = sortOrderAt(index)

    if (position === dish.liveSortOrder) {
      if (dish.hasDraftSortOrder) writes.push({ id: dish.id, action: 'clear' })
      return
    }

    if (dish.hasDraftSortOrder && dish.sortOrder === position) return

    writes.push({ id: dish.id, action: 'set', sortOrder: position })
  })

  return writes
}

/**
 * The list a move was made against, as one short string — technical plan §6, §7e item 2.
 *
 * The problem it solves is specific. A submission says "move Ragnar to position 2", and
 * the server recomputes that against **its own** read rather than believing a list the
 * browser sent. But if a colleague reordered the section in between, the server's list
 * is not the list the person was looking at, and "position 2" now means somewhere else.
 * Applying it would be a silent wrong answer — the one outcome §7e item 2 forbids.
 *
 * So the screen carries a fingerprint of the order it rendered, the server recomputes
 * the same fingerprint from the order it just read, and a mismatch is a conflict:
 * *"Nogen andre har rettet dette."* Nothing is written.
 *
 * **It is a staleness token, not a security token**, and it is worth being explicit
 * about why that distinction is safe here. A forged fingerprint buys nothing: it can
 * only make a move proceed against a list that genuinely matches it, and every write
 * the move then performs still carries that dish's own `updated_at`, which the database
 * checks inside the UPDATE. The fingerprint's job is to turn a *lost update* into a
 * clear refusal one step earlier, before any row has been touched — not to authorise
 * anything. That is why a fast non-cryptographic hash is the right tool and a
 * cryptographic one would be security theatre.
 *
 * `updated_at` is included per dish, not just the ids. That makes the check stricter
 * than the order alone — a colleague's price edit in the same section also refuses the
 * move — and that is the honest trade. Each row's write would have been refused by its
 * own version token anyway; refusing here means the person is told *before* half the
 * section has a new draft position, instead of after.
 */
export function orderFingerprint(
  categoryId: string,
  dishes: readonly { readonly id: string; readonly updatedAt: string }[],
): string {
  const material = [categoryId, ...dishes.map((dish) => `${dish.id}@${dish.updatedAt}`)].join('|')

  // Two independent FNV-1a passes over the same bytes, differing in their offset basis,
  // concatenated to 64 bits. One 32-bit lane would collide often enough to matter across
  // a working day; two do not, and neither needs a dependency or a platform API.
  return `${fnv1a(material, 0x811c9dc5)}${fnv1a(material, 0x01000193)}`
}

/** FNV-1a, 32 bits, as eight lowercase hex characters. */
function fnv1a(text: string, basis: number): string {
  let hash = basis >>> 0

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    // The FNV prime, 16777619, by shift-and-add — `Math.imul` would do, but this keeps
    // every intermediate an unsigned 32-bit value without relying on its rounding.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}

/**
 * What just happened, for the polite live region — design 1aa, phase brief §5.
 *
 * The brief's own sentence: *"Odin flyttet til plads 3 af 6."* A position and a total,
 * because "flyttet ned" tells somebody who cannot see the list nothing at all — they
 * need to know where the dish landed and how much list there is.
 *
 * The wording lives here, beside the rule, for the reason `lib/menu/admin.ts` already
 * gives about the availability sentence: menu vocabulary belongs where it can be
 * asserted, not inside a component.
 */
export function describeMove({
  dishName,
  position,
  total,
}: {
  readonly dishName: string
  /** One-based, as spoken. */
  readonly position: number
  readonly total: number
}): string {
  return `${dishName} flyttet til plads ${position} af ${total}.`
}

/**
 * The reorder handle's accessible name — design 1r, phase brief §11.
 *
 * A handle drawn as three grey lines has no name at all, and "træk" is not a name a
 * keyboard user can act on. So it says three things: what it moves, where that is now,
 * and which keys work. The dish is named because a list of six identical handles is
 * otherwise unusable with a screen reader.
 */
export function describeHandle({
  dishName,
  position,
  total,
}: {
  readonly dishName: string
  readonly position: number
  readonly total: number
}): string {
  return `Flyt ${dishName} — plads ${position} af ${total}. Brug pil op og pil ned.`
}
