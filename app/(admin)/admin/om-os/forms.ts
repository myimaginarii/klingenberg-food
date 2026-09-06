import { IMAGE_SELECT_FORM } from '@/lib/images/selection'
import type { AboutMethodIssue, AboutStoryIssue, AboutTeamIssue } from '@/lib/pages/about'
import {
  ABOUT_HEADING_MAX,
  ABOUT_STORY_BLOCK_LIMIT,
  ABOUT_TEXT_MAX,
} from '@/lib/schemas/page-documents'

/**
 * The vocabularies this screen submits, in one place — design 1i; technical plan §8;
 * phase 14B1.
 *
 * Four, and deliberately **disjoint**, as on every other section screen: a submission
 * carrying one operation's names cannot reach another operation's action, because no
 * parser here reads a name it was not given.
 *
 *   * {@link ABOUT_STORY_FORM} — "Historien": the page heading and the paragraphs. An
 *     ordinary draft change (§6).
 *   * {@link ABOUT_TEAM_FORM} — "Holdet": the one paragraph about the team. A draft
 *     change.
 *   * {@link ABOUT_METHOD_FORM} — "Køkken og tilberedning": the method's heading and
 *     paragraph. A draft change.
 *   * {@link ABOUT_IMAGE_FORM} — the shared picker vocabulary (`lib/images/selection.ts`)
 *     plus which of the three slots the selection is for. A draft change.
 *   * Offentliggør carries **nothing**: `./publish-actions.ts` re-reads what is pending.
 *
 * WHAT NONE OF THEM HAS A FIELD FOR
 *
 * There is no field for an entity name or a row id (the page locates itself through the
 * publishing registry), no field for a storage path, a derivative or an alt text (the
 * picker submits an id and nothing else; the library owns the description), no field
 * for the award (its words are confirmed content and its picture is the Forside's), no
 * field for a team member's name or role (1i: "Ingen portrætter, navne eller roller"),
 * no markup and no link. The one thing every form carries is `version`: the
 * `updated_at` the screen was rendered from, which is the whole of optimistic
 * concurrency (§6).
 */

// ---------------------------------------------------------------------------
// The three text forms and the slot form
// ---------------------------------------------------------------------------

export const ABOUT_STORY_FORM = {
  version: 'version',
  heading: 'overskrift',
  story: 'historie',
} as const

export const ABOUT_TEAM_FORM = {
  version: 'version',
  text: 'holdet_tekst',
} as const

export const ABOUT_METHOD_FORM = {
  version: 'version',
  heading: 'metode_overskrift',
  text: 'metode_tekst',
} as const

export const ABOUT_IMAGE_FORM = {
  ...IMAGE_SELECT_FORM,
  /** Which slot: `sted`, `holdet` or `koekken`. A closed set, parsed strictly. */
  slot: 'billedplads',
} as const

// ---------------------------------------------------------------------------
// Reading what was typed
// ---------------------------------------------------------------------------

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

export type AboutStoryFormValues = { readonly heading: string; readonly story: string }
export type AboutTeamFormValues = { readonly text: string }
export type AboutMethodFormValues = { readonly heading: string; readonly text: string }

export function readAboutStoryForm(source: FormData | URLSearchParams): AboutStoryFormValues {
  return { heading: text(source, ABOUT_STORY_FORM.heading), story: text(source, ABOUT_STORY_FORM.story) }
}

export function readAboutTeamForm(source: FormData | URLSearchParams): AboutTeamFormValues {
  return { text: text(source, ABOUT_TEAM_FORM.text) }
}

export function readAboutMethodForm(source: FormData | URLSearchParams): AboutMethodFormValues {
  return { heading: text(source, ABOUT_METHOD_FORM.heading), text: text(source, ABOUT_METHOD_FORM.text) }
}

// ---------------------------------------------------------------------------
// Errors and echoes
// ---------------------------------------------------------------------------

/** The query parameter a refused save carries its codes in. */
export const ABOUT_ERROR_FIELD = 'fejl'

/** The sentence each refusal shows, beneath its own field. */
export const ABOUT_ERROR_MESSAGES = {
  'overskrift:too_long': `Overskriften må højst være ${ABOUT_HEADING_MAX} tegn.`,
  'historie:too_long': `Et afsnit i historien må højst være ${ABOUT_TEXT_MAX} tegn.`,
  'historie:too_many': `Historien kan højst have ${ABOUT_STORY_BLOCK_LIMIT} afsnit — lav færre tomme linjer.`,
  'holdet_tekst:too_long': `Teksten om holdet må højst være ${ABOUT_TEXT_MAX} tegn.`,
  'metode_overskrift:too_long': `Overskriften må højst være ${ABOUT_HEADING_MAX} tegn.`,
  'metode_tekst:too_long': `Teksten må højst være ${ABOUT_TEXT_MAX} tegn.`,
} as const

export type AboutErrorCode = keyof typeof ABOUT_ERROR_MESSAGES

const ERROR_CODES = Object.keys(ABOUT_ERROR_MESSAGES) as AboutErrorCode[]

/** Only codes this module defined. Anything else in the URL contributes nothing. */
export function decodeAboutErrors(values: readonly string[]): AboutErrorCode[] {
  return values.filter((value): value is AboutErrorCode => (ERROR_CODES as string[]).includes(value))
}

/**
 * How much typed text a refusal may carry back through the address.
 *
 * The other page editors echo everything, because their fields are short. The story
 * field can legitimately hold ten paragraphs of two thousand characters, and an
 * address that long is refused by the server's own header limit before it reaches the
 * page. So a refused story save echoes what was typed only while it fits comfortably
 * — beyond that the codes still travel and the field shows the stored words. The
 * textarea's `maxLength` keeps the ordinary case well under this; the budget is the
 * safety net for a submission that bypassed it.
 */
export const ABOUT_ECHO_BUDGET = 6_000

function withinBudget(values: readonly string[]): boolean {
  return values.reduce((total, value) => total + value.length, 0) <= ABOUT_ECHO_BUDGET
}

/**
 * The query string a refused save comes back with: the codes, and what was typed while
 * it fits the budget. Page copy, not personal data, and re-parsed on the way back in —
 * the URL is a convenience for the person, never a source of authority. React escapes
 * the values when it renders them into the fields.
 */
export function encodeAboutStoryEcho(
  form: AboutStoryFormValues,
  issues: readonly AboutStoryIssue[],
): URLSearchParams {
  const parameters = new URLSearchParams()
  for (const issue of issues) parameters.append(ABOUT_ERROR_FIELD, issue)
  if (withinBudget([form.heading, form.story])) {
    parameters.set(ABOUT_STORY_FORM.heading, form.heading)
    parameters.set(ABOUT_STORY_FORM.story, form.story)
  }
  return parameters
}

export function encodeAboutTeamEcho(
  form: AboutTeamFormValues,
  issues: readonly AboutTeamIssue[],
): URLSearchParams {
  const parameters = new URLSearchParams()
  for (const issue of issues) parameters.append(ABOUT_ERROR_FIELD, issue)
  if (withinBudget([form.text])) parameters.set(ABOUT_TEAM_FORM.text, form.text)
  return parameters
}

export function encodeAboutMethodEcho(
  form: AboutMethodFormValues,
  issues: readonly AboutMethodIssue[],
): URLSearchParams {
  const parameters = new URLSearchParams()
  for (const issue of issues) parameters.append(ABOUT_ERROR_FIELD, issue)
  if (withinBudget([form.heading, form.text])) {
    parameters.set(ABOUT_METHOD_FORM.heading, form.heading)
    parameters.set(ABOUT_METHOD_FORM.text, form.text)
  }
  return parameters
}

/** Whether a refused save echoed its typed values, or only its codes. */
export function hasAboutEcho(source: URLSearchParams, names: readonly string[]): boolean {
  return names.some((name) => source.has(name))
}

// ---------------------------------------------------------------------------
// Which card a refusal belongs to
// ---------------------------------------------------------------------------

export const STORY_ERROR_CODES: readonly AboutErrorCode[] = [
  'overskrift:too_long',
  'historie:too_long',
  'historie:too_many',
]
export const TEAM_ERROR_CODES: readonly AboutErrorCode[] = ['holdet_tekst:too_long']
export const METHOD_ERROR_CODES: readonly AboutErrorCode[] = [
  'metode_overskrift:too_long',
  'metode_tekst:too_long',
]

/** The message for one field's code, when the codes carry it. */
export function aboutErrorFor(codes: readonly AboutErrorCode[], code: AboutErrorCode): string | undefined {
  return codes.includes(code) ? ABOUT_ERROR_MESSAGES[code] : undefined
}

/** The story field's message: the first of its two codes that applies. */
export function storyFieldError(codes: readonly AboutErrorCode[]): string | undefined {
  return aboutErrorFor(codes, 'historie:too_many') ?? aboutErrorFor(codes, 'historie:too_long')
}
