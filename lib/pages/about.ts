import { objectField, stringArrayField, stringField } from '@/lib/content/document'
import {
  ABOUT_HEADING_MAX,
  ABOUT_STORY_BLOCK_LIMIT,
  ABOUT_TEXT_MAX,
} from '@/lib/schemas/page-documents'

/**
 * The Om os document's rules — design 1i (the page); technical plan §4 ("Document
 * shapes"), §5, §6; phase 14B1 (the editor at `/admin/om-os`).
 *
 * Pure. Everything here takes the stored `pages.about` document, or the values an
 * editor submitted, and answers a question the screen would otherwise answer inline:
 *
 *   * what the document *means* — the five keys, normalised, so a document the seed
 *     wrote (no image keys) and one this editor wrote read the same;
 *   * how the story's paragraphs travel between one textarea and `story_blocks`;
 *   * what a save should write into the draft, and what it should take back out — the
 *     delta rule every other editor in this administration applies (§4), per top-level
 *     key for the story card (its three keys are top-level) and per whole section for
 *     the team and the method (their keys nest, so a section in a draft is whole);
 *   * which of the three photo slots a form named, and what its selection writes;
 *   * the sentences the screen says.
 *
 * ONE MODEL, TWO READERS. The public Om os page and the editor both start from the
 * same normalisation (`aboutValuesOf`): the guest's read maps it further into the
 * domain type the page renders, the editor shows it as it is. A document key neither
 * of them knows is dropped here, once.
 */

export type AboutTeamSection = {
  readonly text: string | null
  readonly image_id: string | null
}

export type AboutMethodSection = {
  readonly heading: string | null
  readonly text: string | null
  readonly image_id: string | null
}

/** The whole document, normalised: every key present, every section whole. */
export type AboutValues = {
  readonly heading: string | null
  readonly story_blocks: readonly string[]
  readonly venue_image_id: string | null
  readonly team: AboutTeamSection
  readonly method: AboutMethodSection
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An image reference — a uuid string, or `null` for anything else. */
function imageField(container: unknown, key: string): string | null {
  const value = stringField(container, key)
  return value !== null && UUID_PATTERN.test(value) ? value.toLowerCase() : null
}

/**
 * The document as this phase understands it.
 *
 * Lenient by design: this is read on a public request as well as in the editor, and a
 * document written by the seed or the phase-4 editor (no image keys) must render as
 * "missing field", never throw. A blank story paragraph is dropped; an image value
 * that is not a uuid is `null`.
 */
export function aboutValuesOf(document: unknown): AboutValues {
  const team = objectField(document, 'team')
  const method = objectField(document, 'method')

  return {
    heading: stringField(document, 'heading'),
    story_blocks: stringArrayField(document, 'story_blocks'),
    venue_image_id: imageField(document, 'venue_image_id'),
    team: {
      text: stringField(team, 'text'),
      image_id: imageField(team, 'image_id'),
    },
    method: {
      heading: stringField(method, 'heading'),
      text: stringField(method, 'text'),
      image_id: imageField(method, 'image_id'),
    },
  }
}

// ---------------------------------------------------------------------------
// The story: one textarea, several paragraphs
// ---------------------------------------------------------------------------

/**
 * `story_blocks` as one field: paragraphs separated by a blank line — the one shape a
 * plain textarea can carry and a person can see. No markup, no formatting (the public
 * page renders each block as one `<p>`, 1i), so nothing here parses anything but
 * line breaks.
 */
export function storyBlocksToText(blocks: readonly string[]): string {
  return blocks.join('\n\n')
}

/** The paragraphs typed into the field: split on blank lines, trimmed, blanks dropped. */
export function textToStoryBlocks(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
}

/**
 * The most a story field can carry and still be within the schema: ten paragraphs of
 * the block limit, separated by blank lines. The textarea's `maxLength`, so the
 * ordinary case never reaches the server refusal — which still stands behind it.
 */
export const ABOUT_STORY_TEXT_MAX =
  ABOUT_STORY_BLOCK_LIMIT * ABOUT_TEXT_MAX + (ABOUT_STORY_BLOCK_LIMIT - 1) * 2

// ---------------------------------------------------------------------------
// The delta — what a save writes, and what it takes back out (§4)
// ---------------------------------------------------------------------------

export type AboutDraftWrite = {
  readonly values: Record<string, unknown>
  readonly clear: readonly string[]
}

/** The per-key rule: a submitted value equal to the published one leaves the draft. */
function keyWrite<Value>(
  key: string,
  submitted: Value,
  live: Value,
  same: (a: Value, b: Value) => boolean,
): AboutDraftWrite {
  if (same(submitted, live)) return { values: {}, clear: [key] }
  return { values: { [key]: submitted }, clear: [] }
}

function sameScalar<Value>(a: Value, b: Value): boolean {
  return a === b
}

function sameBlocks(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((block, index) => block === b[index])
}

function sameSection(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] !== right[key]) return false
  }
  return true
}

function merge(...writes: AboutDraftWrite[]): AboutDraftWrite {
  return {
    values: Object.assign({}, ...writes.map((write) => write.values)),
    clear: writes.flatMap((write) => [...write.clear]),
  }
}

/**
 * The "Historien" card: the page heading and the paragraphs, each a top-level key
 * measured against the published value. The card says nothing about the facade
 * photograph — that key has its own write below — so a Gem of the words can neither
 * wipe nor publish a pending picture.
 */
export function aboutStoryWrite(
  submitted: { readonly heading: string | null; readonly story_blocks: readonly string[] },
  live: { readonly heading: string | null; readonly story_blocks: readonly string[] },
): AboutDraftWrite {
  return merge(
    keyWrite('heading', submitted.heading, live.heading, sameScalar),
    keyWrite('story_blocks', [...submitted.story_blocks], [...live.story_blocks], sameBlocks),
  )
}

/**
 * The "Holdet" and "Køkken og tilberedning" cards: the section written **whole**
 * (`lib/schemas/page-documents.ts`), the slot's current image included — the caller
 * takes it from the merged document, so a pending photo survives a Gem of the words
 * beside it — and measured against the published section, so a section edited back to
 * what the hjemmeside already says stops being a pending change.
 */
export function aboutSectionWrite<Key extends 'team' | 'method'>(
  section: Key,
  submitted: AboutValues[Key],
  live: AboutValues[Key],
): AboutDraftWrite {
  if (sameSection(submitted, live)) return { values: {}, clear: [section] }
  return { values: { [section]: submitted }, clear: [] }
}

// ---------------------------------------------------------------------------
// The three photo slots
// ---------------------------------------------------------------------------

/** The three slots, by the words the address and the forms carry. */
export const ABOUT_IMAGE_SLOTS = ['sted', 'holdet', 'koekken'] as const

export type AboutImageSlot = (typeof ABOUT_IMAGE_SLOTS)[number]

/** The slot a form or an address named, or `null` for anything outside the three. */
export function readAboutImageSlot(value: unknown): AboutImageSlot | null {
  return typeof value === 'string' && (ABOUT_IMAGE_SLOTS as readonly string[]).includes(value)
    ? (value as AboutImageSlot)
    : null
}

/** The id a slot currently names in a normalised document. */
export function aboutSlotImageId(values: AboutValues, slot: AboutImageSlot): string | null {
  switch (slot) {
    case 'sted':
      return values.venue_image_id
    case 'holdet':
      return values.team.image_id
    case 'koekken':
      return values.method.image_id
  }
}

/**
 * What choosing (or removing, `null`) a slot's image writes.
 *
 * The facade is a top-level key, so its delta is the one-field rule every column entity
 * uses: choosing the photo that is already live takes the key back out of the draft,
 * and removing a live photo writes an explicit `null`. The team and the kitchen live
 * inside their sections, so the section is written whole with the new id beside its
 * current words — the Forside's rule for its three slots.
 */
export function aboutImageWrite(
  slot: AboutImageSlot,
  imageId: string | null,
  current: AboutValues,
  live: AboutValues,
): AboutDraftWrite {
  switch (slot) {
    case 'sted':
      return keyWrite('venue_image_id', imageId, live.venue_image_id, sameScalar)
    case 'holdet':
      return aboutSectionWrite('team', { ...current.team, image_id: imageId }, live.team)
    case 'koekken':
      return aboutSectionWrite('method', { ...current.method, image_id: imageId }, live.method)
  }
}

// ---------------------------------------------------------------------------
// The text fields — what the cards accept
// ---------------------------------------------------------------------------

/** Blank is absent — the rule every schema in this repository follows. */
function optional(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export type AboutStoryIssue = 'overskrift:too_long' | 'historie:too_long' | 'historie:too_many'

export type AboutStoryResult =
  | {
      readonly ok: true
      readonly values: { readonly heading: string | null; readonly story_blocks: readonly string[] }
    }
  | { readonly ok: false; readonly issues: readonly AboutStoryIssue[] }

/** Turn what was typed into the heading and the paragraphs, checking everything at once. */
export function toAboutStory(form: {
  readonly heading: string
  readonly story: string
}): AboutStoryResult {
  const issues: AboutStoryIssue[] = []
  const heading = optional(form.heading)
  const blocks = textToStoryBlocks(form.story)

  if (heading !== null && heading.length > ABOUT_HEADING_MAX) issues.push('overskrift:too_long')
  if (blocks.some((block) => block.length > ABOUT_TEXT_MAX)) issues.push('historie:too_long')
  if (blocks.length > ABOUT_STORY_BLOCK_LIMIT) issues.push('historie:too_many')

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, values: { heading, story_blocks: blocks } }
}

export type AboutTeamIssue = 'holdet_tekst:too_long'

export type AboutTeamResult =
  | { readonly ok: true; readonly values: AboutTeamSection }
  | { readonly ok: false; readonly issues: readonly AboutTeamIssue[] }

/** The team's one paragraph, plus the slot's current image so the section stays whole. */
export function toAboutTeam(form: { readonly text: string }, currentImageId: string | null): AboutTeamResult {
  const text = optional(form.text)
  if (text !== null && text.length > ABOUT_TEXT_MAX) return { ok: false, issues: ['holdet_tekst:too_long'] }
  return { ok: true, values: { text, image_id: currentImageId } }
}

export type AboutMethodIssue = 'metode_overskrift:too_long' | 'metode_tekst:too_long'

export type AboutMethodResult =
  | { readonly ok: true; readonly values: AboutMethodSection }
  | { readonly ok: false; readonly issues: readonly AboutMethodIssue[] }

/** The method's heading and paragraph, plus the slot's current image. */
export function toAboutMethod(
  form: { readonly heading: string; readonly text: string },
  currentImageId: string | null,
): AboutMethodResult {
  const issues: AboutMethodIssue[] = []
  const heading = optional(form.heading)
  const text = optional(form.text)

  if (heading !== null && heading.length > ABOUT_HEADING_MAX) issues.push('metode_overskrift:too_long')
  if (text !== null && text.length > ABOUT_TEXT_MAX) issues.push('metode_tekst:too_long')

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, values: { heading, text, image_id: currentImageId } }
}

// ---------------------------------------------------------------------------
// The sentences the screen says
// ---------------------------------------------------------------------------

/** The draft keys, in the order the screen draws their cards (1i's page order). */
export const ABOUT_FIELD_KEYS = ['heading', 'story_blocks', 'venue_image_id', 'team', 'method'] as const

export type AboutFieldKey = (typeof ABOUT_FIELD_KEYS)[number]

/**
 * The administration's name for each card — the frame's own section names where 1i
 * states one ("Holdet"), and a fixed name for the two whose heading is itself a field.
 */
export const ABOUT_CARD_LABELS = {
  story: 'Historien',
  team: 'Holdet',
  method: 'Køkken og tilberedning',
} as const

const CARD_OF_KEY: Record<AboutFieldKey, string> = {
  heading: ABOUT_CARD_LABELS.story,
  story_blocks: ABOUT_CARD_LABELS.story,
  venue_image_id: 'Billedet af stedet',
  team: ABOUT_CARD_LABELS.team,
  method: ABOUT_CARD_LABELS.method,
}

/**
 * The pending band's sentence: which cards are waiting, in screen order, each named
 * once. Derived from the stored draft's own keys, so the band cannot claim a change
 * the database does not hold.
 */
export function describeAboutPending(changedFields: readonly string[]): string | null {
  const changed = new Set(changedFields)
  const named: string[] = []

  for (const key of ABOUT_FIELD_KEYS) {
    if (!changed.has(key)) continue
    const card = CARD_OF_KEY[key]
    if (!named.includes(card)) named.push(card)
  }

  if (named.length === 0) return null
  if (named.length === 1) return `${named[0]} afventer offentliggørelse.`

  const last = named[named.length - 1]
  return `${named.slice(0, -1).join(', ')} og ${last} afventer offentliggørelse.`
}

/**
 * Which cards and slots carry a Kladde badge.
 *
 * The story card's words and its facade photograph are separate top-level keys, so the
 * draft's own keys decide. The team's and the method's photograph share a section with
 * their words, so a pending section is told apart by comparing the merged value with
 * the published one: a section pending only for its picture badges the slot and not the
 * words, and the other way round.
 */
export function pendingAboutCards(
  changedFields: readonly string[],
  current: AboutValues,
  live: AboutValues,
): {
  readonly story: boolean
  readonly venueImage: boolean
  readonly teamText: boolean
  readonly teamImage: boolean
  readonly methodText: boolean
  readonly methodImage: boolean
} {
  const changed = new Set(changedFields)
  const team = changed.has('team')
  const method = changed.has('method')

  return {
    story: changed.has('heading') || changed.has('story_blocks'),
    venueImage: changed.has('venue_image_id'),
    teamText: team && current.team.text !== live.team.text,
    teamImage: team && current.team.image_id !== live.team.image_id,
    methodText:
      method &&
      (current.method.heading !== live.method.heading || current.method.text !== live.method.text),
    methodImage: method && current.method.image_id !== live.method.image_id,
  }
}

/** The sentence beside a changed field — the one every page editor says. */
export const ABOUT_PENDING_CARD_NOTE = 'Ændret — vises først på hjemmesiden, når du offentliggør.'

/** The three slots' labels and helpers — 1i's own frame captions, as instructions. */
export const ABOUT_IMAGE_SLOT_LABELS: Record<AboutImageSlot, string> = {
  sted: 'Billede af stedet (valgfrit)',
  holdet: 'Holdfoto (valgfrit)',
  koekken: 'Køkkenfoto (valgfrit)',
}

export const ABOUT_IMAGE_SLOT_HINTS: Record<AboutImageSlot, string> = {
  sted: 'Facaden eller indgangen ved hallen, i dagslys. Et højt billede (4:5) virker bedst.',
  holdet: 'Ét bredt billede af hele holdet samlet — det eneste billede afsnittet kræver.',
  koekken: 'Køkkenet eller tilberedningen. Et bredt billede (3:2) virker bedst.',
}

/** The helpers beneath the text fields. */
export const ABOUT_HEADING_HINT = 'Overskriften øverst på siden — fx »Vores historie«.'
export const ABOUT_STORY_HINT = `Historien om stedet. Lav en tom linje mellem afsnittene — højst ${ABOUT_STORY_BLOCK_LIMIT} afsnit.`
export const ABOUT_TEAM_HINT =
  'Ét kort afsnit om holdet som helhed — hvem der står bag disken, og hvad de går op i. Ingen navne, ingen titler.'
export const ABOUT_METHOD_HINT = 'Tre-fire linjer om råvarer, brød og tilberedning.'

/** The public page's own words when a heading is not stored (1i). */
export const ABOUT_DEFAULT_HEADING = 'Om os'
export const ABOUT_DEFAULT_METHOD_HEADING = 'Sådan laver vi burgere'
