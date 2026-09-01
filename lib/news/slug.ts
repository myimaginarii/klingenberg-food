/**
 * The news slug policy — technical plan §7f, exactly and completely.
 *
 * §7f states the whole rule: *"generated from the title with Danish transliteration
 * (æ→ae, ø→oe, å→aa), collision-suffixed -2, and frozen once the article is first
 * published. Editing the title afterwards does not change the URL."* This module is
 * that sentence as code, and nothing more:
 *
 *   * **Generated, never typed.** There is no slug field anywhere in the
 *     administration; the editor shows the resulting address under the title (§7f:
 *     "The admin shows the final URL under the title field") and a person changes it
 *     by changing the title — while that is still allowed.
 *   * **Frozen at first publish.** The freeze itself is the database's
 *     (`tg_freeze_published_slug`, phase 1); the application honours it by not
 *     regenerating the slug once `published_at` is set. Before the first publish the
 *     slug follows the title on every save, because no shared link exists yet that
 *     could rot. After it, there is no redirect machinery — the old URL never stops
 *     existing, because it never changes.
 *   * **Collisions get a numeric suffix.** §7f names `-2`; a third article with the
 *     same title continues the same series (`-3`, …). The database UNIQUE constraint
 *     remains the final gate — this module only proposes, and a race between two tabs
 *     is refused by the constraint and reported as a sentence.
 *
 * Pure: no database, no clock, no imports. The Server Action supplies the set of
 * taken slugs it read through the caller's own JWT.
 */

/** The same shape `news_slug_check` enforces in the database. */
export const NEWS_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** True when `value` is a slug the database would accept. */
export function isNewsSlug(value: unknown): value is string {
  return typeof value === 'string' && NEWS_SLUG_PATTERN.test(value)
}

/**
 * §7f's three named Danish transliterations, both cases. Stated before the general
 * diacritic fold below because that fold would strip the ring and the slash rather
 * than spell the letters out — "Grillspyd med løg" must become "grillspyd-med-loeg",
 * not "grillspyd-med-log".
 */
const DANISH_LETTERS: readonly (readonly [RegExp, string])[] = [
  [/æ/g, 'ae'],
  [/ø/g, 'oe'],
  [/å/g, 'aa'],
  [/Æ/g, 'ae'],
  [/Ø/g, 'oe'],
  [/Å/g, 'aa'],
]

/** Combining diacritical marks, U+0300–U+036F — what NFD splits an accent into. */
const COMBINING_MARKS = /[̀-ͯ]/g

/**
 * The slug a title produces, or `null` when nothing sluggable remains.
 *
 * Lowercase; æ/ø/å spelled out per §7f; any other accented letter reduced to its base
 * letter (Danish titles legitimately contain é — "café", "idé" — and dropping the
 * letter entirely would misspell the word in the address); every run of anything else
 * becomes one hyphen. A title of only punctuation produces `null`, which the editor
 * reports as a refusal with a sentence rather than inventing an address.
 */
export function slugFromTitle(title: string): string | null {
  let text = title.trim()

  for (const [letter, replacement] of DANISH_LETTERS) {
    text = text.replace(letter, replacement)
  }

  const slug = text
    // Split every accented letter into base letter + combining mark, then drop the marks.
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug.length > 0 ? slug : null
}

/**
 * The slug an article actually gets: the base, or the first free `-2`, `-3`, … .
 *
 * `taken` is the set of every other article's slug, read by the server — the article's
 * own current slug must be excluded by the caller, so a save that does not change the
 * title keeps the slug it has instead of drifting to `-2`.
 */
export function resolveSlugCollision(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base

  // Bounded only by the number of existing articles: n slugs cannot occupy more than
  // n candidates, so the loop always ends.
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/** The public address a slug resolves to — what the editor shows under the title. */
export function newsArticlePath(slug: string): string {
  return `/nyheder/${slug}`
}
