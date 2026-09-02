import {
  type TakeawaySectionIssue,
  type TakeawaySectionsEdit,
  type TakeawaySectionValues,
  type TakeawayTextIssue,
} from '@/lib/pages/takeaway'
import {
  TAKEAWAY_CTA_MAX,
  TAKEAWAY_HEADING_MAX,
  TAKEAWAY_INTRO_MAX,
  TAKEAWAY_SECTION_BODY_MAX,
  TAKEAWAY_SECTION_HEADING_MAX,
  TAKEAWAY_SECTION_LIMIT,
} from '@/lib/schemas/page-documents'

/**
 * The vocabularies this screen submits, in one place — design 1aj; technical plan §8.
 *
 * Five, and deliberately **disjoint**, as on every other section screen: a submission
 * carrying one operation's names cannot reach another operation's action, because no
 * parser here reads a name it was not given.
 *
 *   * {@link TAKEAWAY_TEXT_FORM} — "Overskrift" and "Intro". An ordinary draft change.
 *   * {@link TAKEAWAY_SECTIONS_FORM} — the Tekstafsnit list: one heading and one
 *     text per section by position, and which button was pressed. A draft change.
 *   * {@link TAKEAWAY_CTA_FORM} — "Tekst på knappen". A draft change.
 *   * {@link TAKEAWAY_VISIBILITY_FORM} — "Vis siden på hjemmesiden". A draft change,
 *     like everything else on 1aj (§0aa).
 *   * the image slot — the shared picker vocabulary (`lib/images/selection.ts`),
 *     read by `./image-actions.ts` through `readImageSelectionForm`. A draft change.
 *   * Offentliggør carries **nothing**: `./publish-actions.ts` re-reads what is pending.
 *
 * WHAT NONE OF THEM HAS A FIELD FOR
 *
 * There is no field for an entity name or a row id (the page locates itself through
 * the publishing registry), no field for a section's id (the server's own list is
 * addressed by position and the ids are its), no field for a price, a package or a
 * delivery term (1ai: none exist), no field for a storage path, a derivative or an
 * alt text (the picker submits an id and nothing else), no field for the phone number
 * the button rings (1aj: it stands in Kontaktoplysninger alone), and no field for any
 * key this screen does not draw. The one thing every form carries is `version`: the
 * `updated_at` the screen was rendered from, which is the whole of optimistic
 * concurrency (§6).
 */

// ---------------------------------------------------------------------------
// The four forms
// ---------------------------------------------------------------------------

export const TAKEAWAY_TEXT_FORM = {
  version: 'version',
  heading: 'overskrift',
  intro: 'intro',
} as const

export const TAKEAWAY_SECTIONS_FORM = {
  version: 'version',
  /** One per section, repeated, in list order. */
  heading: 'afsnit_overskrift',
  body: 'afsnit_tekst',
  /** The submit button's name; its value says which button was pressed. */
  action: 'afsnit_handling',
} as const

export const TAKEAWAY_CTA_FORM = {
  version: 'version',
  label: 'knaptekst',
} as const

export const TAKEAWAY_VISIBILITY_FORM = {
  version: 'version',
  /** Present (`1`) while the switch is on; absent when it is off — a plain checkbox. */
  visible: 'vis_siden',
} as const

// ---------------------------------------------------------------------------
// Reading what was typed
// ---------------------------------------------------------------------------

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

function textList(source: FormData | URLSearchParams, name: string): string[] {
  return source.getAll(name).filter((value): value is string => typeof value === 'string')
}

export type TakeawayTextFormValues = { readonly heading: string; readonly intro: string }

export function readTakeawayTextForm(source: FormData | URLSearchParams): TakeawayTextFormValues {
  return {
    heading: text(source, TAKEAWAY_TEXT_FORM.heading),
    intro: text(source, TAKEAWAY_TEXT_FORM.intro),
  }
}

export function readTakeawayCtaForm(source: FormData | URLSearchParams): string {
  return text(source, TAKEAWAY_CTA_FORM.label)
}

/** The switch's requested state. A missing field is "off" — that is how a checkbox says no. */
export function readTakeawayVisibilityForm(formData: FormData): boolean {
  return text(formData, TAKEAWAY_VISIBILITY_FORM.visible) === '1'
}

// ---------------------------------------------------------------------------
// The section controls
// ---------------------------------------------------------------------------

const ACTION_SAVE = 'gem'
const ACTION_ADD = 'tilfoej'
const ACTION_REMOVE = 'fjern'
const ACTION_UP = 'op'
const ACTION_DOWN = 'ned'

/** The button values the form may carry, built here so the button and the parser agree. */
export const TAKEAWAY_SECTION_ACTION = {
  save: ACTION_SAVE,
  add: ACTION_ADD,
  remove: (index: number) => `${ACTION_REMOVE}:${index}`,
  up: (index: number) => `${ACTION_UP}:${index}`,
  down: (index: number) => `${ACTION_DOWN}:${index}`,
} as const

/** Which button was pressed, or `null` for anything this module did not write. */
export function readTakeawaySectionsEdit(value: string): TakeawaySectionsEdit | null {
  if (value === ACTION_SAVE) return { kind: 'save' }
  if (value === ACTION_ADD) return { kind: 'add' }

  const match = /^(fjern|op|ned):(0|[1-9][0-9]?)$/.exec(value)
  if (match === null) return null

  const index = Number(match[2])

  switch (match[1]) {
    case ACTION_REMOVE:
      return { kind: 'remove', index }
    case ACTION_UP:
      return { kind: 'move', index, direction: 'up' }
    default:
      return { kind: 'move', index, direction: 'down' }
  }
}

export type TakeawaySectionsFormValues = {
  readonly headings: readonly string[]
  readonly bodies: readonly string[]
  readonly edit: TakeawaySectionsEdit | null
}

export function readTakeawaySectionsForm(source: FormData | URLSearchParams): TakeawaySectionsFormValues {
  return {
    headings: textList(source, TAKEAWAY_SECTIONS_FORM.heading),
    bodies: textList(source, TAKEAWAY_SECTIONS_FORM.body),
    edit: readTakeawaySectionsEdit(text(source, TAKEAWAY_SECTIONS_FORM.action)),
  }
}

// ---------------------------------------------------------------------------
// Errors and echoes
// ---------------------------------------------------------------------------

/** The query parameter a refused save carries its codes in. */
export const TAKEAWAY_ERROR_FIELD = 'fejl'

/** The sentence each refusal shows, beneath its own field. */
export const TAKEAWAY_ERROR_MESSAGES = {
  'overskrift:too_long': `Overskriften må højst være ${TAKEAWAY_HEADING_MAX} tegn.`,
  'intro:too_long': `Introteksten må højst være ${TAKEAWAY_INTRO_MAX} tegn.`,
  'knaptekst:too_long': `Knapteksten må højst være ${TAKEAWAY_CTA_MAX} tegn.`,
  'afsnit_overskrift:too_long': `Afsnittets overskrift må højst være ${TAKEAWAY_SECTION_HEADING_MAX} tegn.`,
  'afsnit_tekst:too_long': `Afsnittets tekst må højst være ${TAKEAWAY_SECTION_BODY_MAX} tegn.`,
  'afsnit:too_many': `Siden kan højst have ${TAKEAWAY_SECTION_LIMIT} afsnit.`,
} as const

export type TakeawayErrorCode = keyof typeof TAKEAWAY_ERROR_MESSAGES

/** One issue as the query string carries it. A section's index travels with its code. */
export function encodeSectionIssue(issue: TakeawaySectionIssue): string {
  switch (issue.field) {
    case 'heading':
      return `afsnit_overskrift:${issue.index}:too_long`
    case 'body':
      return `afsnit_tekst:${issue.index}:too_long`
    case 'list':
      return 'afsnit:too_many'
  }
}

/** An issue read back from the query string, or `null` for anything else. */
export function decodeSectionIssue(value: string): TakeawaySectionIssue | null {
  const match = /^afsnit_(overskrift|tekst):(0|[1-9][0-9]?):too_long$/.exec(value)
  if (match !== null) {
    return {
      field: match[1] === 'overskrift' ? 'heading' : 'body',
      index: Number(match[2]),
      code: 'too_long',
    }
  }
  if (value === 'afsnit:too_many') return { field: 'list', code: 'too_many' }
  return null
}

/** Only the plain (index-free) codes this module defined. */
export function decodeTakeawayErrors(values: readonly string[]): TakeawayErrorCode[] {
  const codes = Object.keys(TAKEAWAY_ERROR_MESSAGES) as TakeawayErrorCode[]
  return values.filter((value): value is TakeawayErrorCode => (codes as string[]).includes(value))
}

/**
 * The query string a refused text save comes back with: the codes, and what was
 * typed. Page copy, not personal data, and re-parsed on the way back in — the URL is
 * a convenience for the person, never a source of authority.
 */
export function encodeTakeawayTextEcho(
  form: TakeawayTextFormValues,
  issues: readonly TakeawayTextIssue[],
): URLSearchParams {
  const parameters = new URLSearchParams()
  for (const issue of issues) parameters.append(TAKEAWAY_ERROR_FIELD, issue)
  parameters.set(TAKEAWAY_TEXT_FORM.heading, form.heading)
  parameters.set(TAKEAWAY_TEXT_FORM.intro, form.intro)
  return parameters
}

export function encodeTakeawayCtaEcho(typed: string): URLSearchParams {
  const parameters = new URLSearchParams()
  parameters.append(TAKEAWAY_ERROR_FIELD, 'knaptekst:too_long')
  parameters.set(TAKEAWAY_CTA_FORM.label, typed)
  return parameters
}

/** A refused sections save: the list as the edit left it, and the issues. */
export function encodeTakeawaySectionsEcho(
  sections: readonly TakeawaySectionValues[],
  issues: readonly TakeawaySectionIssue[],
): URLSearchParams {
  const parameters = new URLSearchParams()
  for (const issue of issues) parameters.append(TAKEAWAY_ERROR_FIELD, encodeSectionIssue(issue))
  for (const section of sections) {
    parameters.append(TAKEAWAY_SECTIONS_FORM.heading, section.heading ?? '')
    parameters.append(TAKEAWAY_SECTIONS_FORM.body, section.body ?? '')
  }
  return parameters
}

/** What a refused sections save left in the address, or `null` when there is nothing to read. */
export type TakeawaySectionsEcho = {
  readonly headings: readonly string[]
  readonly bodies: readonly string[]
  readonly issues: readonly TakeawaySectionIssue[]
}

export function readTakeawaySectionsEcho(source: URLSearchParams): TakeawaySectionsEcho | null {
  const issues = textList(source, TAKEAWAY_ERROR_FIELD)
    .map(decodeSectionIssue)
    .filter((issue): issue is TakeawaySectionIssue => issue !== null)

  if (issues.length === 0) return null

  return {
    headings: textList(source, TAKEAWAY_SECTIONS_FORM.heading),
    bodies: textList(source, TAKEAWAY_SECTIONS_FORM.body),
    issues,
  }
}

// ---------------------------------------------------------------------------
// What the sections card shows
// ---------------------------------------------------------------------------

export type TakeawaySectionState = {
  readonly id: string
  readonly heading: string
  readonly body: string
  readonly headingError?: string
  readonly bodyError?: string
}

export type TakeawaySectionsState = {
  readonly sections: readonly TakeawaySectionState[]
  readonly listError?: string
}

/**
 * The list the card renders, with a refused submission's text and messages folded
 * in. Composed here rather than in the component, so the editor does no decoding, no
 * lookup and no index arithmetic — it renders strings and optional sentences.
 *
 * An echo names sections by position; the ids come from the server's list where the
 * positions still line up, and are positional otherwise (they are keys, not content).
 */
export function takeawaySectionsState(
  current: readonly TakeawaySectionValues[],
  echo: TakeawaySectionsEcho | null,
): TakeawaySectionsState {
  if (echo === null) {
    return {
      sections: current.map((section) => ({
        id: section.id,
        heading: section.heading ?? '',
        body: section.body ?? '',
      })),
    }
  }

  const sections = echo.headings.map((heading, index) => ({
    id: current[index]?.id ?? `echo-${index + 1}`,
    heading,
    body: echo.bodies[index] ?? '',
    headingError: echo.issues.some((issue) => issue.field === 'heading' && issue.index === index)
      ? TAKEAWAY_ERROR_MESSAGES['afsnit_overskrift:too_long']
      : undefined,
    bodyError: echo.issues.some((issue) => issue.field === 'body' && issue.index === index)
      ? TAKEAWAY_ERROR_MESSAGES['afsnit_tekst:too_long']
      : undefined,
  }))

  return {
    sections,
    listError: echo.issues.some((issue) => issue.field === 'list')
      ? TAKEAWAY_ERROR_MESSAGES['afsnit:too_many']
      : undefined,
  }
}
