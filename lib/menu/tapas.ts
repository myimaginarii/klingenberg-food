import type { TapasDetails, TapasGroup } from '@/lib/content/types'

/**
 * The Tapas document's rules — technical plan §4 (decision 3), design 1h / 1m.
 *
 * Pure, and deliberately the whole of the thinking. Nothing here reads a database,
 * writes a draft, touches React or knows a browser exists: the Server Action
 * (`app/(admin)/admin/menu/tapas-actions.ts`) supplies the document the server just
 * read and applies whatever this module says, and the editor
 * (`components/admin/menu/TapasEditor.tsx`) renders what it is handed. That split is
 * the same one `lib/menu/reorder.ts` draws, and for the same reason — the calculation
 * is the part a test can prove, and the interaction is the part it cannot.
 *
 * TAPAS IS ONE ORDINARY DISH
 *
 * There is no Tapas table, no Tapas entity and no Tapas publish path. The document
 * lives in `dishes.details`, which is an ordinary draft field of an ordinary dish, so
 * the Kladde badge, `pending_changes`, `publish_dish` and Offentliggør all apply to it
 * with no new machinery at all. Editing a dressing is, to the rest of the system,
 * exactly the same kind of event as editing a price.
 *
 * WHAT IS STRUCTURE AND WHAT IS CONTENT
 *
 * The three groups, their ids, their order, their `mode` and their `choose` counts are
 * **structure**: they say what a Tapas board *is*, and the restaurant does not get to
 * change them by filling in a form. `TAPAS_GROUP_RULES` is that structure, stated once;
 * `lib/schemas/menu.ts` validates stored documents against it, and every document this
 * module produces is built from it rather than from anything a browser submitted.
 *
 * The headings and the items are **content**: staff edit both freely. That is the whole
 * of what the editor exposes, and the whole of what a submission may carry.
 *
 * It is a content list and **not** a configurator (§4, decision 3). Nothing here knows
 * about selection, per-option pricing, stock or guests.
 */

export type TapasGroupId = TapasGroup['id']

/** One group's fixed structure, and the name the administration calls it by. */
export type TapasGroupRule = {
  readonly id: TapasGroupId
  readonly mode: TapasGroup['mode']
  /** How many a guest chooses at the table. `null` for the fixed contents. */
  readonly choose: number | null
  /**
   * What the administration calls the group, whatever the restaurant's own heading
   * says. The heading is content and may become anything; a person still has to be able
   * to tell the three lists apart, and a legend that changed with the content would
   * stop doing that.
   */
  readonly label: string
}

/**
 * The three groups, in their fixed order. The single source of this structure.
 *
 * A fourth group, a renamed id, a different `mode` or a different `choose` count are all
 * refusals rather than edits — see `lib/schemas/menu.ts`, which validates every stored
 * document against exactly this list.
 */
export const TAPAS_GROUP_RULES = [
  { id: 'base', mode: 'fixed', choose: null, label: 'Fast indhold' },
  { id: 'choose7', mode: 'choose', choose: 7, label: 'Vælg 7' },
  { id: 'dressing', mode: 'choose', choose: 3, label: 'Vælg 3 dressinger' },
] as const satisfies readonly TapasGroupRule[]

/**
 * The limits, stated once and used by the schema, the editor and the fields themselves.
 *
 * They are the limits the phase-4 schema already carried, not new ones: 80 characters
 * for a heading, 120 for an item, 60 items in a group. The longest seeded item is
 * "Krondyr-spegepølse med jalapeños" at 32 characters, so 120 is generous rather than
 * tight, and the longest seeded list holds 14 of 60.
 */
export const MAX_TAPAS_HEADING_LENGTH = 80
export const MAX_TAPAS_ITEM_LENGTH = 120
export const MAX_TAPAS_ITEMS = 60

/** The rule for this group id, or `null` when the id is not one of the three. */
export function tapasGroupRule(id: string): TapasGroupRule | null {
  return TAPAS_GROUP_RULES.find((rule) => rule.id === id) ?? null
}

/** The submitted group id, if it names one of the three. Never trusted beyond this. */
export function parseTapasGroupId(value: string): TapasGroupId | null {
  return tapasGroupRule(value)?.id ?? null
}

/**
 * Move one item from `from` to `to`, or refuse.
 *
 * The small pure list operation the phase brief asks for, and it is deliberately small:
 * a Tapas group holds a handful of strings, so there is nothing here about drafts,
 * dishes or database positions. `lib/menu/reorder.ts`'s `reorderDishes` is **not**
 * reused — that function exists to feed `sortOrderWrites`, which turns a list of dishes
 * into per-row `sort_order` drafts, and a Tapas group has no rows and no positions to
 * write. Forcing one through the other would mean carrying a dish-shaped abstraction
 * into a document that has never had a row per item.
 *
 * The four properties, which the unit suite asserts one by one:
 *
 *   1. **Every item survives, exactly once.** A move that loses a dressing, or shows one
 *      twice, is worse than a move that refuses.
 *   2. **The relative order of everything else is preserved.**
 *   3. **The input array is never mutated.** `splice` on a copy, never on the argument.
 *   4. **An impossible index is refused, not clamped.** Clamping would turn a stale or
 *      forged position into a silent move to the end.
 *
 * `from === to` is a success that returns a fresh, identical array: nothing moved, and
 * nothing is wrong with asking for that.
 */
export function moveListItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): readonly T[] | null {
  if (!isPosition(from, items.length) || !isPosition(to, items.length)) return null

  const next = [...items]
  const [moved] = next.splice(from, 1)

  /* v8 ignore next -- `from` is in range, so the splice always removed one item. */
  if (moved === undefined) return null

  next.splice(to, 0, moved)

  return next
}

/** A whole number inside `[0, length)`. Rejects `NaN`, fractions and infinities alike. */
function isPosition(value: number, length: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < length
}

// ---------------------------------------------------------------------------
// Reading a stored document
// ---------------------------------------------------------------------------

/**
 * Read a stored `dishes.details` value as a Tapas document, or `null`.
 *
 * `null` means *this dish is not the Tapas entry* — which is true of every other dish on
 * the menu, whose `details` is `null` — and the administration then shows no Tapas
 * editor at all. That is the only thing that decides whether the editor appears, so a
 * Tapas editor cannot turn up on an ordinary dish.
 *
 * When the value **is** a Tapas document, the three groups are rebuilt from
 * `TAPAS_GROUP_RULES`, in their fixed order, with `mode` and `choose` taken from the
 * rules and never from the stored value. Headings and items are taken from the stored
 * group with the matching id, verbatim.
 *
 * This is a repair of *structure*, and it is needed for a concrete reason rather than as
 * defensive habit: `supabase/seed.sql` writes the fixed-contents group without a
 * `choose` key at all, which is correct JSON for "there is nothing to choose" and is
 * accepted by the schema, but is not the canonical shape a save writes back. Normalising
 * on read means the first save stores the canonical document and every later comparison
 * against the live one is an honest comparison of content.
 *
 * What it deliberately does **not** repair is content. A staff member's blank or
 * duplicated item is refused by `applyTapasGroupEdit` with a message, never dropped —
 * the phase brief's "do not silently remove malformed items". The one content-shaped
 * fallback here is a heading that is missing or blank in the *stored* document, which
 * falls back to the group's own label; a group with no heading cannot be labelled at all
 * otherwise, and the label is the same word the plan and the design use for it.
 */
export function readTapasDocument(details: unknown): TapasDetails | null {
  if (!isPlainObject(details) || details['kind'] !== 'tapas') return null

  const stored = new Map<string, Record<string, unknown>>()

  const groups = details['groups']
  if (Array.isArray(groups)) {
    for (const group of groups) {
      if (!isPlainObject(group)) continue
      const id = group['id']
      if (typeof id === 'string' && !stored.has(id)) stored.set(id, group)
    }
  }

  return {
    kind: 'tapas',
    groups: TAPAS_GROUP_RULES.map((rule) => {
      const group = stored.get(rule.id)
      const heading = typeof group?.['heading'] === 'string' ? group['heading'].trim() : ''
      const items = group?.['items']

      return {
        id: rule.id,
        heading: heading.length > 0 ? heading : rule.label,
        mode: rule.mode,
        choose: rule.choose,
        items: Array.isArray(items)
          ? items.filter((item): item is string => typeof item === 'string')
          : [],
      }
    }),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Editing one group
// ---------------------------------------------------------------------------

/**
 * What the person pressed.
 *
 * Every one of them saves: removing an item, moving one and adding one are all ordinary
 * draft changes (§6), so there is no screen state between pressing and storing that
 * could be lost by navigating away. `save` is the plain Gem; the rest do one structural
 * thing to the list first and then save exactly as Gem does.
 */
export type TapasEdit =
  | { readonly kind: 'save' }
  | { readonly kind: 'add' }
  | { readonly kind: 'remove'; readonly index: number }
  | { readonly kind: 'move'; readonly from: number; readonly to: number }

/**
 * One group's form, exactly as it was submitted — text, and nothing that decides
 * anything.
 *
 * There is deliberately no `mode`, no `choose` and no group *order* here. Those are
 * structure (`TAPAS_GROUP_RULES`), so a submission has no way to propose them and no
 * field to smuggle them in through. The group **id** is carried because the form has to
 * say which of the three lists it is, and it is parsed against the fixed set before it
 * reaches this module.
 */
export type TapasGroupSubmission = {
  readonly groupId: TapasGroupId
  readonly heading: string
  /** The existing items, as typed. One entry per field on the screen. */
  readonly items: readonly string[]
  /** The empty field at the foot of the list. Blank means "nothing to add". */
  readonly newItem: string
  readonly edit: TapasEdit
}

/** Where a refusal belongs, so the editor can bind it to the control that earned it. */
export type TapasIssue =
  | { readonly field: 'heading'; readonly code: 'required' | 'too_long' }
  | { readonly field: 'new'; readonly code: 'required' }
  | {
      readonly field: 'item'
      readonly index: number
      readonly code: 'blank' | 'too_long' | 'duplicate'
    }
  | { readonly field: 'list'; readonly code: 'too_many' }

export type TapasEditResult =
  | { readonly ok: true; readonly document: TapasDetails }
  | {
      readonly ok: false
      readonly issues: readonly TapasIssue[]
      /** What the screen should come back showing: the edit applied, trimmed. */
      readonly heading: string
      readonly items: readonly string[]
    }
  /** The submission asked for something the list cannot do — a stale or forged index. */
  | { readonly ok: false; readonly issues: null }

/**
 * Apply one group's submission to the document, or refuse with reasons.
 *
 * `document` is the one the **server** read, drafts already applied — never a document
 * a browser sent, because a browser never sends one. Only the named group is touched;
 * the other two are carried across exactly as they were, which is the phase brief's
 * "editing one group preserves the other two".
 *
 * The order of operations matters and is the whole behaviour:
 *
 *   1. **Trim first.** Whitespace is not content, so it is removed before anything is
 *      compared, counted or stored. Danish characters are untouched — `String.trim`
 *      removes whitespace and nothing else, and no case folding or normalisation is
 *      applied to what is stored.
 *   2. **Apply the structural edit** — remove, move, or append the new field.
 *   3. **Validate the result**, all of it, so a person sees everything wrong at once
 *      rather than one problem per attempt.
 *   4. **Rebuild the group from the rules**, so `id`, `mode` and `choose` come from
 *      `TAPAS_GROUP_RULES` and can never come from the form.
 *
 * A blank item is refused, never dropped. That is deliberate: dropping it would mean a
 * person who cleared a field to remove an item, and a person who cleared one by
 * accident, get the same silent outcome. Fjern is how an item is removed.
 */
export function applyTapasGroupEdit(
  document: TapasDetails,
  submission: TapasGroupSubmission,
): TapasEditResult {
  const rule = tapasGroupRule(submission.groupId)

  /* v8 ignore next -- the id is parsed against the same rules before we get here. */
  if (rule === null) return { ok: false, issues: null }

  const typed = submission.items.map((item) => item.trim())
  const added = submission.newItem.trim()
  const issues: TapasIssue[] = []

  const edited = applyStructuralEdit(typed, submission.edit)
  if (edited === null) return { ok: false, issues: null }

  // The new field is appended for every kind of edit, so a person who typed a new item
  // and then pressed Fjern or Flyt op does not lose what they had typed.
  const items = added.length > 0 ? [...edited, added] : edited

  if (submission.edit.kind === 'add' && added.length === 0) {
    issues.push({ field: 'new', code: 'required' })
  }

  const heading = submission.heading.trim()
  if (heading.length === 0) issues.push({ field: 'heading', code: 'required' })
  else if (heading.length > MAX_TAPAS_HEADING_LENGTH) {
    issues.push({ field: 'heading', code: 'too_long' })
  }

  issues.push(...listIssues(items))

  if (issues.length > 0) return { ok: false, issues, heading, items }

  return {
    ok: true,
    document: {
      kind: 'tapas',
      groups: document.groups.map((group) =>
        group.id === rule.id
          ? { id: rule.id, heading, mode: rule.mode, choose: rule.choose, items: [...items] }
          : group,
      ),
    },
  }
}

/** Remove, move or leave alone. `null` when the submission named a position that is not there. */
function applyStructuralEdit(items: readonly string[], edit: TapasEdit): readonly string[] | null {
  switch (edit.kind) {
    case 'save':
    case 'add':
      return items
    case 'remove':
      return isPosition(edit.index, items.length)
        ? items.filter((_, index) => index !== edit.index)
        : null
    case 'move':
      return moveListItem(items, edit.from, edit.to)
  }
}

/**
 * Everything wrong with a list of items, in the order a person reads them.
 *
 * The duplicate rule is case-insensitive and Danish-aware: `toLocaleLowerCase('da-DK')`,
 * the same fold `lib/menu/labels.ts` applies to a dish's labels and for the same reason
 * — "Aioli" and "aioli" on one board is a mistake every time, and only the second
 * occurrence is flagged so the person is told which one to change.
 */
function listIssues(items: readonly string[]): TapasIssue[] {
  const issues: TapasIssue[] = []
  const seen = new Set<string>()

  items.forEach((item, index) => {
    if (item.length === 0) {
      issues.push({ field: 'item', index, code: 'blank' })
      return
    }

    if (item.length > MAX_TAPAS_ITEM_LENGTH) {
      issues.push({ field: 'item', index, code: 'too_long' })
      return
    }

    const folded = item.toLocaleLowerCase('da-DK')
    if (seen.has(folded)) issues.push({ field: 'item', index, code: 'duplicate' })
    else seen.add(folded)
  })

  if (items.length > MAX_TAPAS_ITEMS) issues.push({ field: 'list', code: 'too_many' })

  return issues
}

// ---------------------------------------------------------------------------
// Turning an edited document into a draft change
// ---------------------------------------------------------------------------

/**
 * What the dish's draft has to do about `details` — the same shape `sortOrderWrites`
 * answers for a position, and the same rule behind it.
 *
 * §4 describes a draft as holding "only the changed fields", and a person who removes a
 * dressing and puts it back has changed nothing. Leaving the document in the draft would
 * put a Kladde badge on a dish with nothing pending, list it in `pending_changes` and
 * make Offentliggør claim a change it will not make — so the field is **cleared**
 * instead, which is what `SaveDraftRequest.clear` exists for.
 *
 * The comparison is against the **published** document, because "changed" can only mean
 * "different from what a guest sees". Both sides are read through `readTapasDocument`
 * first, so a seeded document that omits `choose` and a saved one that writes it as
 * `null` are recognised as the same board rather than as an edit nobody made.
 */
export type TapasDetailsWrite =
  | { readonly action: 'set'; readonly details: TapasDetails }
  | { readonly action: 'clear' }

export function tapasDetailsWrite(next: TapasDetails, live: TapasDetails | null): TapasDetailsWrite {
  return live !== null && sameTapasDocument(next, live) ? { action: 'clear' } : { action: 'set', details: next }
}

/** Two documents that say the same thing. Structure is fixed, so this compares content. */
export function sameTapasDocument(a: TapasDetails, b: TapasDetails): boolean {
  if (a.groups.length !== b.groups.length) return false

  return a.groups.every((group, index) => {
    const other = b.groups[index]

    return (
      other !== undefined &&
      group.id === other.id &&
      group.heading === other.heading &&
      group.items.length === other.items.length &&
      group.items.every((item, position) => item === other.items[position])
    )
  })
}
