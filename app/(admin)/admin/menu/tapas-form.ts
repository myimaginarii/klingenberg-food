import type { TapasDetails, TapasGroup } from '@/lib/content/types'
import { tapasGroupAnchor, tapasNewItemAnchor } from './routes'

import {
  MAX_TAPAS_HEADING_LENGTH,
  MAX_TAPAS_ITEM_LENGTH,
  MAX_TAPAS_ITEMS,
  parseTapasGroupId,
  TAPAS_GROUP_RULES,
  type TapasEdit,
  type TapasGroupId,
  type TapasGroupSubmission,
  type TapasIssue,
} from '@/lib/menu/tapas'

/**
 * The Tapas editor's form, read and written in one place — phase 5F, design 1r / 1y.
 *
 * The same job `dish-form.ts` does for the dish panel, for the one editor on that screen
 * that is not the dish panel: field names once, decoding once, and a refusal that comes
 * back with its messages attached to the controls that earned them and with what the
 * person typed still in them.
 *
 * It is deliberately **not** a generic nested-document editor. It knows one document
 * with three fixed lists, and it can be read end to end. Every rule it applies lives in
 * `lib/menu/tapas.ts`; this module decides only which form field feeds which argument.
 *
 * ITS OWN VOCABULARY, LIKE EVERY OTHER OPERATION ON THIS SCREEN
 *
 * The availability, deletion and reorder paths each have their own field names, so a
 * form carrying one operation's names cannot reach another's action. This is the fourth
 * such vocabulary and follows the same rule: every name is prefixed `tapas_`, so a dish
 * save cannot be submitted here and a Tapas save cannot be submitted to `saveDishDraft`.
 *
 * WHAT A SUBMISSION MAY AND MAY NOT SAY
 *
 * It says: which dish, which version it was rendered from, which of the three groups,
 * the heading, the item texts, the new item, and which button was pressed. It does
 * **not** say the group's `mode`, its `choose` count, the order of the groups, or the
 * contents of the other two groups — all of which come from the server's own read and
 * from `TAPAS_GROUP_RULES`. There is no field to smuggle them in through.
 */

/** Every field name the Tapas editor uses. */
export const TAPAS_FORM = {
  dishId: 'tapas_ret',
  version: 'tapas_version',
  /** Which of the three fixed groups this form is. Parsed against the rules. */
  group: 'tapas_gruppe',
  heading: 'tapas_overskrift',
  /** One text field per existing item, repeated, in list order. */
  item: 'tapas_punkt',
  /** The empty field at the foot of the list. */
  newItem: 'tapas_nyt',
  /** The submit button's name; its value says which button was pressed. */
  action: 'tapas_handling',
  /** Navigation only — which section chip the redirect reopens. */
  section: 'tapas_sektion',
} as const

/** The query parameter a refused save carries its reasons back in. */
export const TAPAS_ERROR_FIELD = 'tapas_fejl'

/** The button values the form may carry. An index-bearing one is `<verb>:<index>`. */
const ACTION_SAVE = 'gem'
const ACTION_ADD = 'tilfoej'
const ACTION_REMOVE = 'fjern'
const ACTION_UP = 'op'
const ACTION_DOWN = 'ned'

export const TAPAS_ACTION = {
  save: ACTION_SAVE,
  add: ACTION_ADD,
  remove: (index: number) => `${ACTION_REMOVE}:${index}`,
  up: (index: number) => `${ACTION_UP}:${index}`,
  down: (index: number) => `${ACTION_DOWN}:${index}`,
} as const

/**
 * Which button was pressed, as an edit — or `null` for anything this module did not
 * write.
 *
 * An unknown verb, a missing index, a fractional one and `op:0` (there is nothing above
 * the first item) are all `null`, so the action refuses rather than guessing. The
 * bounds against the *list* are `lib/menu/tapas.ts`'s, because only it has the list.
 */
function readEdit(value: string): TapasEdit | null {
  if (value === ACTION_SAVE) return { kind: 'save' }
  if (value === ACTION_ADD) return { kind: 'add' }

  const match = /^(fjern|op|ned):(0|[1-9][0-9]{0,3})$/.exec(value)
  if (match === null) return null

  const index = Number(match[2])

  switch (match[1]) {
    case ACTION_REMOVE:
      return { kind: 'remove', index }
    case ACTION_UP:
      return index === 0 ? null : { kind: 'move', from: index, to: index - 1 }
    default:
      return { kind: 'move', from: index, to: index + 1 }
  }
}

/** What the Tapas action needs, beyond the group submission itself. */
export type TapasFormRequest = {
  readonly dishId: string
  readonly version: string
  readonly section: string | null
  readonly submission: TapasGroupSubmission
}

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

function textList(source: FormData | URLSearchParams, name: string): string[] {
  return source.getAll(name).filter((value): value is string => typeof value === 'string')
}

/**
 * Parse a submission, or return `null`.
 *
 * `null` for a missing dish, a group id that is not one of the three, or a button value
 * this module did not write. The action turns that into one refusal and never guesses at
 * what was meant. Nothing is validated here — that is `applyTapasGroupEdit`'s job, and
 * it needs the server's own document to do it.
 */
export function readTapasForm(formData: FormData): TapasFormRequest | null {
  const dishId = text(formData, TAPAS_FORM.dishId)
  const version = text(formData, TAPAS_FORM.version)
  const groupId = parseTapasGroupId(text(formData, TAPAS_FORM.group))
  const edit = readEdit(text(formData, TAPAS_FORM.action))
  const section = text(formData, TAPAS_FORM.section)

  if (dishId.length === 0 || version.length === 0 || groupId === null || edit === null) {
    return null
  }

  return {
    dishId,
    version,
    section: section.length > 0 ? section : null,
    submission: {
      groupId,
      heading: text(formData, TAPAS_FORM.heading),
      items: textList(formData, TAPAS_FORM.item),
      newItem: text(formData, TAPAS_FORM.newItem),
      edit,
    },
  }
}

// ---------------------------------------------------------------------------
// Reporting a refusal
// ---------------------------------------------------------------------------

/** The sentence each refusal shows, beneath the control it belongs to. */
export const TAPAS_ERROR_MESSAGES = {
  'overskrift:required': 'Overskriften må ikke være tom.',
  'overskrift:too_long': `Overskriften må højst være ${MAX_TAPAS_HEADING_LENGTH} tegn.`,
  'nyt:required': 'Skriv teksten til det nye punkt.',
  'punkt:blank': 'Punktet må ikke være tomt. Skriv en tekst, eller fjern punktet.',
  'punkt:too_long': `Et punkt må højst være ${MAX_TAPAS_ITEM_LENGTH} tegn.`,
  'punkt:duplicate': 'Punktet står allerede på listen.',
  'liste:too_many': `Listen kan højst have ${MAX_TAPAS_ITEMS} punkter.`,
} as const

type TapasErrorCode = keyof typeof TAPAS_ERROR_MESSAGES

/** One issue as the query string carries it. An item's index travels with its code. */
function encodeIssue(issue: TapasIssue): string {
  switch (issue.field) {
    case 'heading':
      return `overskrift:${issue.code}`
    case 'new':
      return 'nyt:required'
    case 'list':
      return 'liste:too_many'
    case 'item':
      return `punkt:${issue.index}:${issue.code}`
  }
}

/** An issue read back from the query string, or `null` for anything else. */
function decodeIssue(value: string): TapasIssue | null {
  const item = /^punkt:(0|[1-9][0-9]{0,3}):(blank|too_long|duplicate)$/.exec(value)
  if (item !== null) {
    return {
      field: 'item',
      index: Number(item[1]),
      code: item[2] as 'blank' | 'too_long' | 'duplicate',
    }
  }

  if (value === 'overskrift:required') return { field: 'heading', code: 'required' }
  if (value === 'overskrift:too_long') return { field: 'heading', code: 'too_long' }
  if (value === 'nyt:required') return { field: 'new', code: 'required' }
  if (value === 'liste:too_many') return { field: 'list', code: 'too_many' }

  return null
}

/**
 * The query string a refused save comes back with: which group, its reasons, and the
 * text that produced them.
 *
 * Menu content, not personal data, and re-parsed on the way back in — so the URL is a
 * convenience for the person, never a source of authority. React escapes the values
 * when it renders them into the fields.
 */
export function encodeTapasEcho(
  groupId: TapasGroupId,
  heading: string,
  items: readonly string[],
  issues: readonly TapasIssue[],
): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const issue of issues) parameters.append(TAPAS_ERROR_FIELD, encodeIssue(issue))

  parameters.set(TAPAS_FORM.group, groupId)
  parameters.set(TAPAS_FORM.heading, heading)
  for (const item of items) parameters.append(TAPAS_FORM.item, item)

  return parameters
}

/** What a refused save left in the address, or `null` when there is nothing to read. */
export type TapasEcho = {
  readonly groupId: TapasGroupId
  readonly heading: string
  readonly items: readonly string[]
  readonly issues: readonly TapasIssue[]
}

export function readTapasEcho(source: URLSearchParams): TapasEcho | null {
  const groupId = parseTapasGroupId(text(source, TAPAS_FORM.group))
  if (groupId === null) return null

  const issues = textList(source, TAPAS_ERROR_FIELD)
    .map(decodeIssue)
    .filter((issue): issue is TapasIssue => issue !== null)

  if (issues.length === 0) return null

  return {
    groupId,
    heading: text(source, TAPAS_FORM.heading),
    items: textList(source, TAPAS_FORM.item),
    issues,
  }
}

// ---------------------------------------------------------------------------
// What each group's editor shows
// ---------------------------------------------------------------------------

/**
 * One group, ready to render: the text the fields hold, and the message each control
 * carries.
 *
 * Composed here rather than in the component, so the editor does no decoding, no lookup
 * and no index arithmetic — it renders a list of strings and a list of optional
 * sentences. That is also what keeps the messages assertable without a browser.
 */
export type TapasGroupState = {
  readonly id: TapasGroupId
  /** What the administration calls this list, whatever the heading currently says. */
  readonly label: string
  /** The group's own `<section>` — where a save, a removal or a move comes back to. */
  readonly anchorId: string
  /** The empty field at the foot of the list — where Tilføj punkt comes back to. */
  readonly newItemAnchorId: string
  readonly heading: string
  readonly items: readonly string[]
  readonly headingError?: string
  readonly newItemError?: string
  readonly listError?: string
  /** One entry per item, aligned with `items`. `undefined` where there is nothing wrong. */
  readonly itemErrors: readonly (string | undefined)[]
}

function messageFor(code: TapasErrorCode): string {
  return TAPAS_ERROR_MESSAGES[code]
}

/**
 * The three groups the editor renders, with a refused submission's text and messages
 * folded into the one group it was about.
 *
 * The other two groups always render from the document the server read, because a
 * refusal in one list has nothing to say about the other two — the phase brief's
 * "editing one group preserves the other two", carried through to the screen.
 */
export function tapasEditorGroups(
  document: TapasDetails,
  echo: TapasEcho | null,
): readonly TapasGroupState[] {
  return TAPAS_GROUP_RULES.map((rule) => {
    const stored: TapasGroup | undefined = document.groups.find((group) => group.id === rule.id)
    const base = {
      id: rule.id,
      label: rule.label,
      anchorId: tapasGroupAnchor(rule.id),
      newItemAnchorId: tapasNewItemAnchor(rule.id),
      heading: stored?.heading ?? rule.label,
      items: stored?.items ?? [],
    }

    if (echo === null || echo.groupId !== rule.id) {
      return { ...base, itemErrors: base.items.map(() => undefined) }
    }

    const itemErrors: (string | undefined)[] = echo.items.map(() => undefined)
    let headingError: string | undefined
    let newItemError: string | undefined
    let listError: string | undefined

    for (const issue of echo.issues) {
      switch (issue.field) {
        case 'heading':
          headingError = messageFor(`overskrift:${issue.code}`)
          break
        case 'new':
          newItemError = messageFor('nyt:required')
          break
        case 'list':
          listError = messageFor('liste:too_many')
          break
        case 'item':
          if (issue.index < itemErrors.length) {
            itemErrors[issue.index] = messageFor(`punkt:${issue.code}`)
          }
          break
      }
    }

    return {
      ...base,
      heading: echo.heading,
      items: echo.items,
      headingError,
      newItemError,
      listError,
      itemErrors,
    }
  })
}
