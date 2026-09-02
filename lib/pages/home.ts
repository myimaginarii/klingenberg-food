import { objectField, stringArrayField, stringField } from '@/lib/content/document'
import { FEATURED_DISH_LIMIT } from '@/lib/schemas/page-documents'

/**
 * The Forside document's rules — design 1u (the editor), 1g / 1l (the page);
 * technical plan §4 ("Document shapes"), §5, §6; phase 11A.
 *
 * Pure. Everything here takes the stored `pages.home` document, or the values an
 * editor submitted, and answers a question the screen would otherwise answer inline:
 *
 *   * what the document *means* — the four sections, normalised, so a document an
 *     older editor wrote (no `image_id` key) and one this editor wrote read the same;
 *   * what a save should write into the draft, and what it should take back out — the
 *     delta rule every other editor in this administration applies (§4), restated for
 *     a document whose draft holds whole **sections** rather than columns;
 *   * what the three "Udvalgte burgere" controls do to the list of ids;
 *   * the sentences the screen says about a pending change.
 *
 * ONE MODEL, TWO READERS. The public Forside and the editor both start from the same
 * normalisation (`homeValuesOf`): the guest's read maps it further into the domain
 * type the page renders, the editor shows it as it is. A document key neither of them
 * knows is dropped here, once.
 *
 * THE SECTION DELTA. A page draft is merged over the published document one top-level
 * section at a time (`published || draft`), so a section in a draft is a whole section
 * (`lib/schemas/page-documents.ts`). The delta therefore works per section: a submitted
 * section that equals the published one leaves the draft (`clear`), and one that differs
 * is written whole. That keeps §4's "a draft holds only the changed fields" literally
 * true for a document, and it is what stops a save from leaving a Kladde badge on a card
 * with nothing waiting.
 */

export type HomeTextSectionKey = 'hero' | 'award' | 'about_excerpt'
export type HomeSectionKey = HomeTextSectionKey | 'featured_dish_ids'

export const HOME_TEXT_SECTION_KEYS: readonly HomeTextSectionKey[] = ['hero', 'award', 'about_excerpt']
export const HOME_SECTION_KEYS: readonly HomeSectionKey[] = [
  'hero',
  'award',
  'featured_dish_ids',
  'about_excerpt',
]

export type HeroSection = {
  readonly heading: string | null
  readonly intro: string | null
  readonly image_id: string | null
}

export type AwardSection = {
  readonly title: string | null
  readonly text: string | null
  readonly image_id: string | null
}

export type AboutExcerptSection = {
  readonly heading: string | null
  readonly text: string | null
  readonly image_id: string | null
}

/** The whole document, normalised: every section present, every key present. */
export type HomeValues = {
  readonly hero: HeroSection
  readonly award: AwardSection
  readonly featured_dish_ids: readonly string[]
  readonly about_excerpt: AboutExcerptSection
}

export type HomeTextSection = HomeValues[HomeTextSectionKey]

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An image reference inside a section — a uuid string, or `null` for anything else. */
function imageField(section: unknown, key: string): string | null {
  const value = stringField(section, key)
  return value !== null && UUID_PATTERN.test(value) ? value.toLowerCase() : null
}

/**
 * The document as this phase understands it.
 *
 * Lenient by design: this is read on a public request as well as in the editor, and a
 * document written by an older editor or a fixture must render as "missing field", never
 * throw. A featured id that is not a uuid is dropped rather than carried.
 */
export function homeValuesOf(document: unknown): HomeValues {
  const hero = objectField(document, 'hero')
  const award = objectField(document, 'award')
  const aboutExcerpt = objectField(document, 'about_excerpt')

  return {
    hero: {
      heading: stringField(hero, 'heading'),
      intro: stringField(hero, 'intro'),
      image_id: imageField(hero, 'image_id'),
    },
    award: {
      title: stringField(award, 'title'),
      text: stringField(award, 'text'),
      image_id: imageField(award, 'image_id'),
    },
    featured_dish_ids: stringArrayField(document, 'featured_dish_ids').filter((id) =>
      UUID_PATTERN.test(id),
    ),
    about_excerpt: {
      heading: stringField(aboutExcerpt, 'heading'),
      text: stringField(aboutExcerpt, 'text'),
      image_id: imageField(aboutExcerpt, 'image_id'),
    },
  }
}

// ---------------------------------------------------------------------------
// The delta — what a save writes, and what it takes back out (§4)
// ---------------------------------------------------------------------------

export type HomeDraftWrite = {
  readonly values: Partial<HomeValues>
  readonly clear: readonly HomeSectionKey[]
}

function sameSection(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] !== right[key]) return false
  }
  return true
}

/**
 * What one text section's save should write.
 *
 * Measured against the **published** section, never against what the form was rendered
 * with, so a section edited back to what the hjemmeside already says stops being a
 * pending change. The submitted section is written whole — the image slot's current
 * value included, which the action takes from the merged document so a pending photo
 * survives a Gem of the words beside it.
 */
export function homeSectionWrite<Key extends HomeTextSectionKey>(
  section: Key,
  submitted: HomeValues[Key],
  live: HomeValues[Key],
): HomeDraftWrite {
  if (sameSection(submitted, live)) return { values: {}, clear: [section] }

  return { values: { [section]: submitted } as Partial<HomeValues>, clear: [] }
}

/** The same rule for the featured list: identical order and ids is no change at all. */
export function featuredDishesWrite(
  submitted: readonly string[],
  live: readonly string[],
): HomeDraftWrite {
  const same =
    submitted.length === live.length && submitted.every((id, index) => id === live[index])

  if (same) return { values: {}, clear: ['featured_dish_ids'] }

  return { values: { featured_dish_ids: [...submitted] }, clear: [] }
}

// ---------------------------------------------------------------------------
// "Udvalgte burgere (vælg 3)" — 1u's list controls
// ---------------------------------------------------------------------------

export type FeaturedEdit =
  | { readonly kind: 'add'; readonly dishId: string }
  | { readonly kind: 'replace'; readonly index: number; readonly dishId: string }
  | { readonly kind: 'remove'; readonly index: number }
  | { readonly kind: 'move'; readonly index: number; readonly direction: 'up' | 'down' }

export type FeaturedEditResult =
  | { readonly ok: true; readonly ids: readonly string[] }
  | { readonly ok: false; readonly error: 'full' | 'duplicate' | 'no_such_slot' | 'unmovable' }

/**
 * Apply one control press to the list of featured ids.
 *
 * Pure and total: every refusal is a word the action turns into a sentence, and no
 * refusal changes the list. The limit and the no-duplicates rule are the schema's own
 * (`homeDraft`), restated here so a person is told *why* rather than met with a
 * validation message about a list they cannot see whole.
 */
export function applyFeaturedEdit(
  ids: readonly string[],
  edit: FeaturedEdit,
): FeaturedEditResult {
  switch (edit.kind) {
    case 'add': {
      if (ids.length >= FEATURED_DISH_LIMIT) return { ok: false, error: 'full' }
      if (ids.includes(edit.dishId)) return { ok: false, error: 'duplicate' }
      return { ok: true, ids: [...ids, edit.dishId] }
    }
    case 'replace': {
      if (edit.index < 0 || edit.index >= ids.length) return { ok: false, error: 'no_such_slot' }
      if (ids.some((id, index) => id === edit.dishId && index !== edit.index)) {
        return { ok: false, error: 'duplicate' }
      }
      const next = [...ids]
      next[edit.index] = edit.dishId
      return { ok: true, ids: next }
    }
    case 'remove': {
      if (edit.index < 0 || edit.index >= ids.length) return { ok: false, error: 'no_such_slot' }
      return { ok: true, ids: ids.filter((_, index) => index !== edit.index) }
    }
    case 'move': {
      if (edit.index < 0 || edit.index >= ids.length) return { ok: false, error: 'no_such_slot' }
      const target = edit.direction === 'up' ? edit.index - 1 : edit.index + 1
      if (target < 0 || target >= ids.length) return { ok: false, error: 'unmovable' }
      const next = [...ids]
      const moving = next[edit.index] as string
      next[edit.index] = next[target] as string
      next[target] = moving
      return { ok: true, ids: next }
    }
  }
}

// ---------------------------------------------------------------------------
// The sentences the screen says
// ---------------------------------------------------------------------------

/** The administration's name for each section — 1u's own card eyebrows. */
export const HOME_SECTION_LABELS: Record<HomeSectionKey, string> = {
  hero: 'Øverst på siden',
  award: 'Udmærkelsen',
  featured_dish_ids: 'Udvalgte burgere',
  about_excerpt: 'Om os (uddrag)',
}

/** 1u's own sentence beside a changed field. */
export const HOME_PENDING_CARD_NOTE = 'Ændret — vises først på hjemmesiden, når du offentliggør.'

/**
 * The pending band's sentence: which sections are waiting, in document order.
 *
 * Derived from the stored draft's own changed sections, so the band cannot claim a
 * change the database does not hold, and it names **which** sections rather than
 * saying "Ændringer".
 */
export function describeHomePending(changedFields: readonly string[]): string | null {
  const changed = new Set(changedFields)
  const named = HOME_SECTION_KEYS.filter((key) => changed.has(key)).map(
    (key) => HOME_SECTION_LABELS[key],
  )

  if (named.length === 0) return null
  if (named.length === 1) return `${named[0]} afventer offentliggørelse.`

  const last = named[named.length - 1]
  return `${named.slice(0, -1).join(', ')} og ${last} afventer offentliggørelse.`
}

/** 1u's helper line beneath the hero slot. */
export const HERO_IMAGE_HINT = 'Et bredt billede virker bedst. Mindst 2000 px.'

/** 1u's note beneath the featured list. */
export const FEATURED_NOTE = 'Vælges fra menuen — navne og priser skrives aldrig to steder.'

/** 1u's control for the next free slot. */
export const FEATURED_ADD_LABEL = '+ Vælg en burger fra menuen'
