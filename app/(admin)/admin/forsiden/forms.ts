import { z } from 'zod'

import { IMAGE_SELECT_FORM } from '@/lib/images/selection'
import {
  HOME_TEXT_SECTION_KEYS,
  type FeaturedEdit,
  type HomeTextSection,
  type HomeTextSectionKey,
  type HomeValues,
} from '@/lib/pages/home'
import { HOME_HEADING_MAX, HOME_TEXT_MAX } from '@/lib/schemas/page-documents'

/**
 * The vocabularies this screen submits, in one place — design 1u; technical plan §8.
 *
 * Four, and deliberately **disjoint**, as on every other section screen: a submission
 * carrying one operation's names cannot reach another operation's action, because no
 * parser here reads a name it was not given and every shape below is strict.
 *
 *   * {@link HOME_SECTION_FORM} — one of the three text cards (Øverst på siden,
 *     Udmærkelsen, Om os). An ordinary draft change (§6). The card names which section
 *     it is; the two fields are the same two names on every card, and the server maps
 *     them onto that section's own keys (`heading`/`intro`, `title`/`text`, …).
 *   * {@link HOME_IMAGE_FORM} — the shared picker vocabulary (`lib/images/selection.ts`)
 *     plus the section the slot belongs to. A draft change.
 *   * {@link HOME_FEATURED_FORM} — the "Udvalgte burgere" controls: add, change,
 *     remove, move. A draft change.
 *   * Offentliggør carries **nothing**: `./publish-actions.ts` re-reads what is pending.
 *
 * WHAT NONE OF THEM HAS A FIELD FOR
 *
 * There is no field for an entity name or a row id (the Forside locates itself through
 * the publishing registry), no field for a dish's name or price (a featured slot is an
 * id, resolved against the menu the server reads), no field for a storage path, a
 * derivative or an alt text (the picker submits an id and nothing else), no field for
 * `is_visible`, and no field for any section this screen does not draw. The one thing
 * every form carries is `version`: the `updated_at` the screen was rendered from, which
 * is the whole of optimistic concurrency (§6).
 */

// ---------------------------------------------------------------------------
// The three text cards
// ---------------------------------------------------------------------------

export const HOME_SECTION_FORM = {
  version: 'version',
  /** Which card: `hero`, `award` or `about_excerpt`. A closed set, parsed strictly. */
  section: 'afsnit',
  heading: 'overskrift',
  text: 'tekst',
} as const

const sectionKeySchema = z.enum(HOME_TEXT_SECTION_KEYS as [HomeTextSectionKey, ...HomeTextSectionKey[]])

/** The section a form named, or `null` for anything outside the three. */
export function readHomeSectionKey(value: unknown): HomeTextSectionKey | null {
  const parsed = sectionKeySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** The two fields' visible labels per card — 1u's own words. */
export const HOME_SECTION_LABELS_FOR_FIELDS: Record<
  HomeTextSectionKey,
  { readonly heading: string; readonly text: string }
> = {
  hero: { heading: 'Overskrift', text: 'Kort tekst under' },
  award: { heading: 'Tekst om udmærkelsen', text: 'Et par ord om udmærkelsen' },
  about_excerpt: { heading: 'Overskrift', text: 'Tekst' },
}

// ---------------------------------------------------------------------------
// Errors and echoes
// ---------------------------------------------------------------------------

/** The query parameter a refused save carries its codes in. */
export const HOME_ERROR_FIELD = 'fejl'

export type HomeErrorField = 'overskrift' | 'tekst'

export type HomeErrorCode = 'overskrift:too_long' | 'tekst:too_long'

/** The sentence each refusal shows, beneath its own field. */
export const HOME_ERROR_MESSAGES: Record<HomeErrorCode, string> = {
  'overskrift:too_long': `Overskriften må højst være ${HOME_HEADING_MAX} tegn.`,
  'tekst:too_long': `Teksten må højst være ${HOME_TEXT_MAX} tegn.`,
}

const ERROR_CODES = Object.keys(HOME_ERROR_MESSAGES) as HomeErrorCode[]

/** The field an error belongs to, so the card can bind it with `aria-describedby`. */
export function homeErrorField(code: HomeErrorCode): HomeErrorField {
  return code.split(':')[0] as HomeErrorField
}

/** Only codes this module defined. Anything else in the URL contributes nothing. */
export function decodeHomeErrors(values: readonly string[]): HomeErrorCode[] {
  return values.filter((value): value is HomeErrorCode => (ERROR_CODES as string[]).includes(value))
}

// ---------------------------------------------------------------------------
// Reading a text card
// ---------------------------------------------------------------------------

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/** Exactly what the person typed, before any rule has been applied to it. */
export type HomeSectionFormValues = {
  readonly section: string
  readonly heading: string
  readonly text: string
}

export function readHomeSectionForm(source: FormData | URLSearchParams): HomeSectionFormValues {
  return {
    section: text(source, HOME_SECTION_FORM.section),
    heading: text(source, HOME_SECTION_FORM.heading),
    text: text(source, HOME_SECTION_FORM.text),
  }
}

/** Blank is absent — the rule every schema in this repository follows. */
function optional(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export type HomeSectionResult<Key extends HomeTextSectionKey> =
  | { readonly ok: true; readonly values: HomeValues[Key] }
  | { readonly ok: false; readonly errors: readonly HomeErrorCode[] }

/**
 * Turn what was typed into the section, whole.
 *
 * The section is submitted **whole** (`lib/schemas/page-documents.ts`): the two words
 * from the form, plus the image slot's current value — which is the caller's to supply
 * from the merged document, so a Gem of the words never wipes a pending photo.
 *
 * Every field is checked rather than only the first that fails. Nothing is required:
 * the public page removes a block it has no text for rather than rendering an empty one
 * (1g), so an empty field is a legitimate thing to save.
 */
export function toHomeSectionSubmission<Key extends HomeTextSectionKey>(
  section: Key,
  form: HomeSectionFormValues,
  currentImageId: string | null,
): HomeSectionResult<Key> {
  const errors: HomeErrorCode[] = []

  const heading = optional(form.heading)
  if (heading !== null && heading.length > HOME_HEADING_MAX) errors.push('overskrift:too_long')

  const body = optional(form.text)
  if (body !== null && body.length > HOME_TEXT_MAX) errors.push('tekst:too_long')

  if (errors.length > 0) return { ok: false, errors }

  return { ok: true, values: sectionValues(section, heading, body, currentImageId) }
}

/** The form's two generic names, mapped onto the section's own keys (§4). */
export function sectionValues<Key extends HomeTextSectionKey>(
  section: Key,
  heading: string | null,
  body: string | null,
  imageId: string | null,
): HomeValues[Key] {
  switch (section) {
    case 'hero':
      return { heading, intro: body, image_id: imageId } as HomeValues[Key]
    case 'award':
      return { title: heading, text: body, image_id: imageId } as HomeValues[Key]
    default:
      return { heading, text: body, image_id: imageId } as HomeValues[Key]
  }
}

/** The stored section as the card's two fields show it. */
export function sectionFormValues(
  section: HomeTextSectionKey,
  values: HomeTextSection,
): HomeSectionFormValues {
  const record = values as Record<string, string | null>
  const heading = section === 'award' ? record.title : record.heading
  const body = section === 'hero' ? record.intro : record.text

  return { section, heading: heading ?? '', text: body ?? '' }
}

/**
 * The query string a refused save comes back with: the codes, and what was typed.
 *
 * Page copy, not personal data, and re-parsed by {@link readHomeSectionForm} on the way
 * back in — so the URL is a convenience for the person, never a source of authority.
 * React escapes the values when it renders them into the fields.
 */
export function encodeHomeSectionEcho(
  form: HomeSectionFormValues,
  errors: readonly HomeErrorCode[],
): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const code of errors) parameters.append(HOME_ERROR_FIELD, code)

  parameters.set(HOME_SECTION_FORM.section, form.section)
  parameters.set(HOME_SECTION_FORM.heading, form.heading)
  parameters.set(HOME_SECTION_FORM.text, form.text)

  return parameters
}

// ---------------------------------------------------------------------------
// The image slots — the shared picker vocabulary plus the section
// ---------------------------------------------------------------------------

export const HOME_IMAGE_FORM = {
  ...IMAGE_SELECT_FORM,
  section: 'afsnit',
} as const

// ---------------------------------------------------------------------------
// "Udvalgte burgere (vælg 3)"
// ---------------------------------------------------------------------------

export const HOME_FEATURED_FORM = {
  version: 'version',
  /**
   * Which control was pressed, and about which slot: `tilfoej`, or `skift:1`,
   * `fjern:0`, `op:2`, `ned:0`. One value per button, built by
   * {@link featuredActionValue} so the button and the parser cannot spell it apart —
   * the phase-5F arrangement (Tapas), where every control in one form is a submit
   * button distinguished by the value it carries.
   */
  action: 'handling',
  /** The chosen dish's id, for add and change. */
  dish: 'ret',
} as const

export type FeaturedActionKind = 'add' | 'replace' | 'remove' | 'up' | 'down'

const ACTION_WORDS: Record<FeaturedActionKind, string> = {
  add: 'tilfoej',
  replace: 'skift',
  remove: 'fjern',
  up: 'op',
  down: 'ned',
}

/** The value a control submits: the word, and the slot for everything but add. */
export function featuredActionValue(kind: 'add'): string
export function featuredActionValue(kind: Exclude<FeaturedActionKind, 'add'>, slot: number): string
export function featuredActionValue(kind: FeaturedActionKind, slot?: number): string {
  return kind === 'add' ? ACTION_WORDS.add : `${ACTION_WORDS[kind]}:${slot}`
}

const featuredSchema = z.strictObject({
  action: z.string().regex(/^(tilfoej|(skift|fjern|op|ned):[0-2])$/),
  dish: z.uuid().optional(),
  version: z.iso.datetime({ offset: true }),
})

export type HomeFeaturedRequest = {
  readonly expectedUpdatedAt: string
  readonly edit: FeaturedEdit
}

/**
 * Parse a featured-list submission, or return `null`.
 *
 * `null` is the answer for anything malformed — a version that is not a timestamp, a
 * dish that is not a uuid, a slot outside the three, a control name nobody drew, an
 * add or a change without a dish. The action turns that into one refusal; it never
 * guesses at what was meant.
 */
export function readHomeFeaturedForm(formData: FormData): HomeFeaturedRequest | null {
  const dish = formData.get(HOME_FEATURED_FORM.dish)

  const parsed = featuredSchema.safeParse({
    action: text(formData, HOME_FEATURED_FORM.action),
    dish: typeof dish === 'string' && dish.length > 0 ? dish : undefined,
    version: text(formData, HOME_FEATURED_FORM.version),
  })
  if (!parsed.success) return null

  const { action, version } = parsed.data
  const [word, slotText] = action.split(':')
  const slot = slotText === undefined ? -1 : Number(slotText)

  switch (word) {
    case ACTION_WORDS.add:
      if (parsed.data.dish === undefined) return null
      return { expectedUpdatedAt: version, edit: { kind: 'add', dishId: parsed.data.dish } }
    case ACTION_WORDS.replace:
      if (parsed.data.dish === undefined) return null
      return {
        expectedUpdatedAt: version,
        edit: { kind: 'replace', index: slot, dishId: parsed.data.dish },
      }
    case ACTION_WORDS.remove:
      return { expectedUpdatedAt: version, edit: { kind: 'remove', index: slot } }
    case ACTION_WORDS.up:
      return { expectedUpdatedAt: version, edit: { kind: 'move', index: slot, direction: 'up' } }
    case ACTION_WORDS.down:
      return { expectedUpdatedAt: version, edit: { kind: 'move', index: slot, direction: 'down' } }
    default:
      return null
  }
}
