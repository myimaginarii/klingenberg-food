import { numberField, objectArrayField, stringField } from '@/lib/content/document'
import {
  TAKEAWAY_CTA_MAX,
  TAKEAWAY_HEADING_MAX,
  TAKEAWAY_INTRO_MAX,
  TAKEAWAY_SECTION_BODY_MAX,
  TAKEAWAY_SECTION_HEADING_MAX,
  TAKEAWAY_SECTION_LIMIT,
  takeawayDraft,
} from '@/lib/schemas/page-documents'

/**
 * The Mad ud af huset document's rules — design 1aj (the editor), 1ai (the page);
 * technical plan §4 ("Document shapes"), §5, §6, §15 (phase 11B).
 *
 * Pure. Everything here takes the stored `pages.takeaway` document, or the values an
 * editor submitted, and answers a question the screen would otherwise answer inline:
 *
 *   * what the document *means* — the five keys, normalised, so a document the seed
 *     wrote (no `image_id`) and one this editor wrote read the same;
 *   * what the page's visibility is once the pending draft is taken into account;
 *   * what a save should write into the draft, and what it should take back out — the
 *     delta rule every other editor in this administration applies (§4), per top-level
 *     key, because every key of this document is a top-level draft field;
 *   * what the four section controls do to the list of sections;
 *   * the sentences the screen says.
 *
 * ONE MODEL, TWO READERS. The public page and the editor both start from the same
 * normalisation (`takeawayValuesOf`): the guest's read maps it further into the domain
 * type the page renders, the editor shows it as it is. A document key neither of them
 * knows is dropped here, once.
 *
 * VISIBILITY IS A DRAFT FIELD. 1aj says it outright — *"alt gemmes som kladde,
 * forhåndsvises på den rigtige side og går først live ved Offentliggør"* — and the
 * toggle sits among the fields with no "ændres straks" mark beside it (compare 1r's
 * Udsolgt switch and 1ad's "Vis besked", which carry one). So the pending value lives
 * in the draft under `is_visible`, the preview reads it, the guest keeps the published
 * column, and `publish_page()` moves it into the column. §6's immediate-path table
 * lists four operations and this is not one of them.
 */

export type TakeawaySectionValues = {
  readonly id: string
  readonly heading: string | null
  readonly body: string | null
}

/** The whole document, normalised: every key present, sections in display order. */
export type TakeawayValues = {
  readonly heading: string | null
  readonly intro: string | null
  readonly image_id: string | null
  readonly sections: readonly TakeawaySectionValues[]
  readonly cta_label: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An image reference — a uuid string, or `null` for anything else. */
function imageField(document: unknown, key: string): string | null {
  const value = stringField(document, key)
  return value !== null && UUID_PATTERN.test(value) ? value.toLowerCase() : null
}

/** The prefix every generated section id carries: `afsnit-1`, `afsnit-2`, … (the seed's own). */
const SECTION_ID_PREFIX = 'afsnit-'

/**
 * The document as this phase understands it.
 *
 * Lenient by design: this is read on a public request as well as in the editor, and a
 * document written by the seed or an older editor must render as "missing field", never
 * throw. Sections are ordered by their `sort`, ties by position; a section without a
 * usable id is given one from its position so the editor always has a key to work by.
 */
export function takeawayValuesOf(document: unknown): TakeawayValues {
  const sections = objectArrayField(document, 'sections')
    .map((section, index) => ({
      id: stringField(section, 'id') ?? `${SECTION_ID_PREFIX}${index + 1}`,
      heading: stringField(section, 'heading'),
      body: stringField(section, 'body'),
      sort: numberField(section, 'sort') ?? index,
      index,
    }))
    .sort((a, b) => a.sort - b.sort || a.index - b.index)
    .map(({ id, heading, body }) => ({ id, heading, body }))

  return {
    heading: stringField(document, 'heading'),
    intro: stringField(document, 'intro'),
    image_id: imageField(document, 'image_id'),
    sections,
    cta_label: stringField(document, 'cta_label'),
  }
}

/**
 * The page's visibility with the pending draft taken into account.
 *
 * The draft is read through the same `stored` parse the overlay uses, so a malformed
 * draft contributes nothing (rule 4 of `lib/drafts/overlay.ts`) and the live column
 * decides — never a value the parse refused.
 */
export function takeawayVisibility(liveVisible: boolean, draft: unknown): boolean {
  if (draft === null || draft === undefined) return liveVisible

  const parsed = takeawayDraft.stored.safeParse(draft)
  if (!parsed.success) return liveVisible

  return typeof parsed.data.is_visible === 'boolean' ? parsed.data.is_visible : liveVisible
}

// ---------------------------------------------------------------------------
// The delta — what a save writes, and what it takes back out (§4)
// ---------------------------------------------------------------------------

export type TakeawayDraftWrite = {
  readonly values: Record<string, unknown>
  readonly clear: readonly string[]
}

/** The per-key rule: a submitted value equal to the published one leaves the draft. */
function keyWrite<Value>(
  key: string,
  submitted: Value,
  live: Value,
  same: (a: Value, b: Value) => boolean,
): TakeawayDraftWrite {
  if (same(submitted, live)) return { values: {}, clear: [key] }
  return { values: { [key]: submitted }, clear: [] }
}

function sameScalar<Value>(a: Value, b: Value): boolean {
  return a === b
}

function merge(...writes: TakeawayDraftWrite[]): TakeawayDraftWrite {
  return {
    values: Object.assign({}, ...writes.map((write) => write.values)),
    clear: writes.flatMap((write) => [...write.clear]),
  }
}

/** The "Tekst" card: heading and intro, each measured against the published value. */
export function takeawayTextWrite(
  submitted: { readonly heading: string | null; readonly intro: string | null },
  live: { readonly heading: string | null; readonly intro: string | null },
): TakeawayDraftWrite {
  return merge(
    keyWrite('heading', submitted.heading, live.heading, sameScalar),
    keyWrite('intro', submitted.intro, live.intro, sameScalar),
  )
}

/** The "Knap nederst" card. */
export function takeawayCtaWrite(submitted: string | null, live: string | null): TakeawayDraftWrite {
  return keyWrite('cta_label', submitted, live, sameScalar)
}

/** The visibility toggle: a value already live leaves the draft, so nothing waits. */
export function takeawayVisibilityWrite(submitted: boolean, live: boolean): TakeawayDraftWrite {
  return keyWrite('is_visible', submitted, live, sameScalar)
}

/** Two section lists that say the same thing, in the same order. */
export function sameTakeawaySections(
  a: readonly TakeawaySectionValues[],
  b: readonly TakeawaySectionValues[],
): boolean {
  return (
    a.length === b.length &&
    a.every((section, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        section.id === other.id &&
        section.heading === other.heading &&
        section.body === other.body
      )
    })
  )
}

/**
 * The "Tekstafsnit" card: the list is one key, written whole with `sort` renumbered
 * from 1 in display order — the document's own shape (§4).
 */
export function takeawaySectionsWrite(
  submitted: readonly TakeawaySectionValues[],
  live: readonly TakeawaySectionValues[],
): TakeawayDraftWrite {
  if (sameTakeawaySections(submitted, live)) return { values: {}, clear: ['sections'] }

  return {
    values: {
      sections: submitted.map((section, index) => ({
        id: section.id,
        heading: section.heading,
        body: section.body,
        sort: index + 1,
      })),
    },
    clear: [],
  }
}

// ---------------------------------------------------------------------------
// "Tekstafsnit" — 1aj's list controls
// ---------------------------------------------------------------------------

/**
 * What the person pressed. Every one of them saves: removing a section, moving one
 * and adding one are all ordinary draft changes (§6), the phase-5F Tapas arrangement.
 */
export type TakeawaySectionsEdit =
  | { readonly kind: 'save' }
  | { readonly kind: 'add' }
  | { readonly kind: 'remove'; readonly index: number }
  | { readonly kind: 'move'; readonly index: number; readonly direction: 'up' | 'down' }

/** The list exactly as it was submitted — text, and nothing that decides anything. */
export type TakeawaySectionsSubmission = {
  /** One entry per section on the screen, in order: what was typed. */
  readonly headings: readonly string[]
  readonly bodies: readonly string[]
  readonly edit: TakeawaySectionsEdit
}

/** Where a refusal belongs, so the editor can bind it to the control that earned it. */
export type TakeawaySectionIssue =
  | { readonly field: 'heading'; readonly index: number; readonly code: 'too_long' }
  | { readonly field: 'body'; readonly index: number; readonly code: 'too_long' }
  | { readonly field: 'list'; readonly code: 'too_many' }

export type TakeawaySectionsEditResult =
  | { readonly ok: true; readonly sections: readonly TakeawaySectionValues[] }
  | {
      readonly ok: false
      readonly issues: readonly TakeawaySectionIssue[]
      /** What the screen should come back showing: the edit applied, trimmed. */
      readonly sections: readonly TakeawaySectionValues[]
    }
  /** The submission does not fit the server's list — a stale form or a forged index. */
  | { readonly ok: false; readonly issues: null }

/** Blank is absent — the rule every schema in this repository follows. */
function optional(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The next free section id: one past the highest `afsnit-<n>` in use, so a removed
 * and re-added section never reuses a colleague's id inside one draft.
 */
export function nextTakeawaySectionId(existing: readonly string[]): string {
  let highest = 0

  for (const id of existing) {
    const match = /^afsnit-(\d{1,6})$/.exec(id)
    if (match !== null) highest = Math.max(highest, Number(match[1]))
  }

  return `${SECTION_ID_PREFIX}${highest + 1}`
}

/**
 * Apply one press to the list of sections, or refuse with reasons.
 *
 * `current` is the list the **server** read, drafts applied — never one a browser
 * sent. The browser sends the texts by position and which button it pressed; the ids
 * are the server's own, so a submission whose length does not match the server's list
 * is refused outright (the version token would refuse the write in any case).
 *
 * The order of operations is the whole behaviour: trim, apply the structural edit,
 * validate everything at once. A blank section is **not** refused — 1aj's "+ Tilføj
 * tekstafsnit" adds an empty one to be written into, and the public page renders
 * nothing for a section with neither a heading nor a text.
 */
export function applyTakeawaySectionsEdit(
  current: readonly TakeawaySectionValues[],
  submission: TakeawaySectionsSubmission,
): TakeawaySectionsEditResult {
  if (
    submission.headings.length !== current.length ||
    submission.bodies.length !== current.length
  ) {
    return { ok: false, issues: null }
  }

  const typed: TakeawaySectionValues[] = current.map((section, index) => ({
    id: section.id,
    heading: optional(submission.headings[index] ?? ''),
    body: optional(submission.bodies[index] ?? ''),
  }))

  const edited = applyStructuralEdit(typed, submission.edit)
  if (edited === null) return { ok: false, issues: null }

  const issues: TakeawaySectionIssue[] = []

  edited.forEach((section, index) => {
    if (section.heading !== null && section.heading.length > TAKEAWAY_SECTION_HEADING_MAX) {
      issues.push({ field: 'heading', index, code: 'too_long' })
    }
    if (section.body !== null && section.body.length > TAKEAWAY_SECTION_BODY_MAX) {
      issues.push({ field: 'body', index, code: 'too_long' })
    }
  })

  if (edited.length > TAKEAWAY_SECTION_LIMIT) issues.push({ field: 'list', code: 'too_many' })

  if (issues.length > 0) return { ok: false, issues, sections: edited }

  return { ok: true, sections: edited }
}

function isPosition(value: number, length: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < length
}

function applyStructuralEdit(
  sections: readonly TakeawaySectionValues[],
  edit: TakeawaySectionsEdit,
): readonly TakeawaySectionValues[] | null {
  switch (edit.kind) {
    case 'save':
      return sections
    case 'add':
      return [
        ...sections,
        { id: nextTakeawaySectionId(sections.map((section) => section.id)), heading: null, body: null },
      ]
    case 'remove':
      return isPosition(edit.index, sections.length)
        ? sections.filter((_, index) => index !== edit.index)
        : null
    case 'move': {
      if (!isPosition(edit.index, sections.length)) return null
      const target = edit.direction === 'up' ? edit.index - 1 : edit.index + 1
      if (!isPosition(target, sections.length)) return null
      const next = [...sections]
      const moving = next[edit.index] as TakeawaySectionValues
      next[edit.index] = next[target] as TakeawaySectionValues
      next[target] = moving
      return next
    }
  }
}

// ---------------------------------------------------------------------------
// The text fields — the "Tekst" and "Knap nederst" cards
// ---------------------------------------------------------------------------

export type TakeawayTextIssue = 'overskrift:too_long' | 'intro:too_long'

export type TakeawayTextResult =
  | { readonly ok: true; readonly values: { readonly heading: string | null; readonly intro: string | null } }
  | { readonly ok: false; readonly issues: readonly TakeawayTextIssue[] }

/** Turn what was typed into the two values, checking both rather than the first. */
export function toTakeawayText(form: {
  readonly heading: string
  readonly intro: string
}): TakeawayTextResult {
  const issues: TakeawayTextIssue[] = []
  const heading = optional(form.heading)
  const intro = optional(form.intro)

  if (heading !== null && heading.length > TAKEAWAY_HEADING_MAX) issues.push('overskrift:too_long')
  if (intro !== null && intro.length > TAKEAWAY_INTRO_MAX) issues.push('intro:too_long')

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, values: { heading, intro } }
}

export type TakeawayCtaResult =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly issue: 'knaptekst:too_long' }

export function toTakeawayCta(typed: string): TakeawayCtaResult {
  const value = optional(typed)
  if (value !== null && value.length > TAKEAWAY_CTA_MAX) return { ok: false, issue: 'knaptekst:too_long' }
  return { ok: true, value }
}

// ---------------------------------------------------------------------------
// The sentences the screen says
// ---------------------------------------------------------------------------

/** The draft keys, in the order the screen draws their cards (1aj). */
export const TAKEAWAY_FIELD_KEYS = ['is_visible', 'heading', 'intro', 'image_id', 'sections', 'cta_label'] as const

export type TakeawayFieldKey = (typeof TAKEAWAY_FIELD_KEYS)[number]

/** The administration's name for the card each key belongs to — 1aj's own eyebrows. */
export const TAKEAWAY_CARD_LABELS = {
  visibility: 'Vis siden på hjemmesiden',
  text: 'Tekst',
  sections: 'Tekstafsnit',
  cta: 'Knap nederst',
} as const

const CARD_OF_KEY: Record<TakeawayFieldKey, string> = {
  is_visible: 'Synligheden',
  heading: TAKEAWAY_CARD_LABELS.text,
  intro: TAKEAWAY_CARD_LABELS.text,
  image_id: 'Billedet',
  sections: TAKEAWAY_CARD_LABELS.sections,
  cta_label: TAKEAWAY_CARD_LABELS.cta,
}

/**
 * The pending band's sentence: which cards are waiting, in screen order, each named
 * once. Derived from the stored draft's own keys, so the band cannot claim a change
 * the database does not hold.
 */
export function describeTakeawayPending(changedFields: readonly string[]): string | null {
  const changed = new Set(changedFields)
  const named: string[] = []

  for (const key of TAKEAWAY_FIELD_KEYS) {
    if (!changed.has(key)) continue
    const card = CARD_OF_KEY[key]
    if (!named.includes(card)) named.push(card)
  }

  if (named.length === 0) return null
  if (named.length === 1) return `${named[0]} afventer offentliggørelse.`

  const last = named[named.length - 1]
  return `${named.slice(0, -1).join(', ')} og ${last} afventer offentliggørelse.`
}

/** Which cards carry a Kladde badge, from the same keys. */
export function pendingTakeawayCards(changedFields: readonly string[]): {
  readonly visibility: boolean
  readonly text: boolean
  readonly image: boolean
  readonly sections: boolean
  readonly cta: boolean
} {
  const changed = new Set(changedFields)
  return {
    visibility: changed.has('is_visible'),
    text: changed.has('heading') || changed.has('intro'),
    image: changed.has('image_id'),
    sections: changed.has('sections'),
    cta: changed.has('cta_label'),
  }
}

/** 1aj's own sentence beside a changed field. */
export const TAKEAWAY_PENDING_CARD_NOTE = 'Ændret — vises først på hjemmesiden, når du offentliggør.'

/** 1aj's helper beneath the intro. */
export const TAKEAWAY_INTRO_HINT = 'To-tre linjer. Skriv det, som I ville sige det i telefonen.'

/** 1aj's helper beneath the image slot — and the public page's no-image rule. */
export const TAKEAWAY_IMAGE_HINT = 'Uden billede fylder teksten hele bredden.'

/** 1aj's note beneath the sections. The frame's "håndtaget" is two move buttons here (see §0aa). */
export const TAKEAWAY_SECTIONS_NOTE =
  'Frie afsnit, ikke faste felter. Restauranten bestemmer selv, hvad der skal stå om selskaber — og kan flytte afsnittene med knapperne. Et afsnit uden overskrift og tekst vises ikke på hjemmesiden.'

/** 1aj's control for a new section. */
export const TAKEAWAY_ADD_SECTION_LABEL = '+ Tilføj tekstafsnit'

/** 1aj's helper beneath the toggle. */
export const TAKEAWAY_VISIBILITY_HINT = 'Slå fra, og både siden og menupunktet forsvinder helt.'

/**
 * 1aj's note beneath "Tekst på knappen", with the number the button actually rings —
 * read from `site_contact`, never written here, so it stands in exactly one place.
 */
export function describeTakeawayCtaPhone(primaryPhone: string | null): string {
  const number = primaryPhone === null ? 'det nummer, der står under Kontaktoplysninger' : primaryPhone

  return `Knappen ringer altid til det primære nummer fra Kontaktoplysninger — ${number}. Det ekstra nummer vises ved siden af. Nummeret skrives ikke her, så det kun står ét sted.`
}

/** The public page's own words for the button when no label is stored (1ai). */
export const TAKEAWAY_DEFAULT_CTA_LABEL = 'Ring og hør mere'

/**
 * What the visibility card says about the hjemmeside right now and about the pending
 * change, so the consequence of Offentliggør is stated before it is pressed (1aj).
 */
export function describeTakeawayVisibility(liveVisible: boolean, currentVisible: boolean): string {
  if (liveVisible && currentVisible) return 'Siden og menupunktet vises på hjemmesiden.'
  if (liveVisible && !currentVisible) {
    return 'Siden vises på hjemmesiden lige nu. Når du offentliggør, forsvinder både siden og menupunktet.'
  }
  if (!liveVisible && currentVisible) {
    return 'Siden er skjult lige nu. Når du offentliggør, vises både siden og menupunktet igen.'
  }
  return 'Siden er skjult — hverken siden eller menupunktet vises på hjemmesiden.'
}
