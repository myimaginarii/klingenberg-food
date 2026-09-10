import { isAllowedExternalUrl } from '@/lib/announcements/link'
import { photoMeasurementOf } from '@/lib/images/manifest'
import { PHOTO_EXTENSIONS, photoSourceFrom } from '@/lib/images/photos'
import { IMAGE_FOCUSES } from '@/lib/images/public'
import { isNewsSlug } from '@/lib/news/slug'
import { isIsoDate, parseIsoTime, type IsoTime } from '@/lib/time/calendar'

import { oreFromKroner } from '../load/price'
import { add, at, shown, type Problem } from './problems'

/**
 * The field checks every document validator is built from — phase 3.
 *
 * Each one takes the collector, the way into the value, and the value; records a
 * Danish sentence if it is wrong; and answers what the caller needs to keep going.
 * They are deliberately few and deliberately dumb: the interesting part of this phase
 * is the domain rules in the sibling modules, not a validation engine. Nothing here
 * knows what a dish or an opening hour is.
 *
 * NOTHING HERE INVENTS A RULE. Where the site already decides what a value means, that
 * decision is called rather than restated — a price is whatever `oreFromKroner`
 * accepts, a photograph is whatever `photoSourceFrom` and `photoMeasurementOf` accept,
 * an external address is `isAllowedExternalUrl`, a date is `isIsoDate`, a time is
 * `parseIsoTime`, a slug is the site's one slug shape. What is written here is the
 * Danish wording, because the audience for a refusal is the restaurant and the
 * audience for those functions was a programmer.
 *
 * THE MESSAGES ARE SHORT ON PURPOSE. A problem is printed as `where` and then the
 * sentence, and the `where` is the file and the whole way in —
 * `content/site/menu.json → Burgere → Odin → price`. The field has therefore already
 * been named by the time the sentence is read, so the sentence only has to say what a
 * usable value looks like. "Skal udfyldes." under that path is clearer than a
 * hand-written noun in front of it, and there is one of it rather than ninety.
 */

/** A collected value and where it was written — what {@link unique} compares. */
type Named = { readonly value: string; readonly where: string }

/** The site's one slug shape: lower-case letters, digits, single hyphens. */
export const isSlug = isNewsSlug

/** True for the values that mean "this field is not filled in". */
export function isBlank(value: unknown): value is null | undefined | '' {
  return value === null || value === undefined || value === ''
}

/**
 * True only for the two values that mean "the field is not there at all".
 *
 * {@link isBlank} is what nearly every check uses, and it is the one to reach for: a
 * field an editor cleared is `""` in a Pages CMS form and `null` in hand-written JSON,
 * and both mean the same thing everywhere on this site — for a price, a date, a
 * number, a photograph and a piece of prose alike. The loaders make the two spellings
 * into one value (`lib/content/load/cleared.ts`).
 *
 * This narrower predicate is left for the two places where `""` is *not* the same
 * answer: a true/false switch, where an empty string is a malformed value rather than
 * an unset one, and a photograph's alternative text, where `""` is a deliberate answer
 * meaning "read this picture as decoration".
 */
export function isAbsent(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

/** `"a", "b" eller "c"` — a vocabulary as a Danish list. */
function list(values: readonly string[]): string {
  const quoted = values.map((value) => `"${value}"`)
  if (quoted.length < 2) return quoted.join('')
  return `${quoted.slice(0, -1).join(', ')} eller ${quoted[quoted.length - 1]}`
}

/** A JSON object — not an array, not null. Answers `null` when it is something else. */
export function object(
  problems: Problem[],
  where: string,
  value: unknown,
  example?: string,
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    const shape = example === undefined ? '' : ` — ${example}`
    add(problems, where, `Skal være et objekt${shape}. Fik: ${shown(value)}.`)
    return null
  }
  return value as Record<string, unknown>
}

/** A JSON array. Answers `null` when it is something else. */
export function array(
  problems: Problem[],
  where: string,
  value: unknown,
  example?: string,
): unknown[] | null {
  if (!Array.isArray(value)) {
    const shape = example === undefined ? '[ ... ]' : example
    add(problems, where, `Skal være en liste — ${shape}. Fik: ${shown(value)}.`)
    return null
  }
  return value
}

/**
 * Free text — a heading, a description, a paragraph.
 *
 * Prose is deliberately barely checked: it must be a string, and a *required* one must
 * have something in it. Length, punctuation, wording and Danish letters are the
 * restaurant's business, not the build's.
 */
export function text(
  problems: Problem[],
  where: string,
  value: unknown,
  options: { required?: boolean } = {},
): string | null {
  if (isBlank(value)) {
    if (options.required === true) add(problems, where, 'Skal udfyldes.')
    return null
  }

  if (typeof value !== 'string') {
    add(problems, where, `Skal være tekst i anførselstegn. Fik: ${shown(value)}.`)
    return null
  }

  if (options.required === true && value.trim().length === 0) {
    add(problems, where, 'Skal udfyldes. Feltet indeholder kun mellemrum.')
    return null
  }

  return value
}

/** A true/false switch. */
export function flag(
  problems: Problem[],
  where: string,
  value: unknown,
  options: { required?: boolean } = {},
): boolean | null {
  if (isAbsent(value)) {
    if (options.required === true) add(problems, where, 'Skal være true eller false.')
    return null
  }

  if (typeof value !== 'boolean') {
    add(problems, where, `Skal være true eller false — uden anførselstegn. Fik: ${shown(value)}.`)
    return null
  }

  return value
}

/**
 * A whole number, at least `min` and — where the domain has an upper end — at most
 * `max`.
 *
 * Every caller decides for itself whether the field may be left out, because that is a
 * question about the document and not about counting: an optional number is guarded
 * with {@link isBlank} at the call site, which is what lets a cleared Pages CMS number
 * field (`""`) mean the same as no field at all.
 */
export function whole(
  problems: Problem[],
  where: string,
  value: unknown,
  min: number,
  max?: number,
): void {
  const number = value as number
  if (Number.isInteger(value) && number >= min && (max === undefined || number <= max)) return

  const range = max === undefined ? `på mindst ${min}` : `mellem ${min} og ${max}`
  add(problems, where, `Skal være et helt tal ${range}. Fik: ${shown(value)}.`)
}

/** One of a closed vocabulary the renderer switches on. */
export function oneOf<T extends string>(
  problems: Problem[],
  where: string,
  value: unknown,
  allowed: readonly T[],
  note?: string,
): T | null {
  if ((allowed as readonly unknown[]).includes(value)) return value as T

  const gloss = note === undefined ? '' : ` ${note}`
  add(problems, where, `Skal være ${list(allowed)}.${gloss} Fik: ${shown(value)}.`)
  return null
}

/**
 * A name used as an address: a menu section's anchor, a dish's id, a page section's id.
 *
 * These end up in a URL fragment and in a React key, so the shape is the same one the
 * rest of the site already uses for a news address and for a photograph's file name.
 */
export function slug(problems: Problem[], where: string, value: unknown): string | null {
  if (isBlank(value)) {
    add(problems, where, 'Skal udfyldes — det er den faste id, siden bruger til at henvise hertil.')
    return null
  }

  if (!isSlug(value)) {
    add(
      problems,
      where,
      'Må kun bestå af små bogstaver (a-z), tal og enkelte bindestreger — f.eks. "ugens-ret". ' +
        `Ingen mellemrum, æ, ø, å eller store bogstaver. Fik: ${shown(value)}.`,
    )
    return null
  }

  return value
}

/**
 * A price, as a person writes it on a menu.
 *
 * The parser is the site's own (`lib/content/load/price.ts`): it is what turns the
 * string into whole øre, so what it accepts *is* what a valid price is. A number
 * rather than a string, a negative amount, a currency suffix, three decimals and
 * anything else are refused there and reported here.
 *
 * An empty field is an item with no price, not a mistake — the Forside's "fra 124 kr."
 * line and several menu sections already price nothing per dish. A price cleared in a
 * Pages CMS form arrives as `""`, and the loader reads that as no price too.
 */
export function price(problems: Problem[], where: string, value: unknown): void {
  if (isBlank(value)) return

  try {
    oreFromKroner(value as string, where)
  } catch {
    add(
      problems,
      where,
      'Prisen skrives i kroner som tekst i anførselstegn — f.eks. "89", "89,50" eller "89.50". ' +
        `Ingen "kr.", ingen minus, højst to decimaler. Fik: ${shown(value)}.`,
    )
  }
}

/**
 * A calendar date, `YYYY-MM-DD`, that actually exists — 2026-02-31 does not.
 *
 * An empty date control writes `""`, which is the same answer as no date at all: an
 * optional one is simply not set, and a required one is still refused, by the same
 * "Skal udfyldes." a missing field gets.
 */
export function date(
  problems: Problem[],
  where: string,
  value: unknown,
  options: { required?: boolean } = {},
): string | null {
  if (isBlank(value)) {
    if (options.required === true) add(problems, where, 'Skal udfyldes — f.eks. "2026-12-24".')
    return null
  }

  if (!isIsoDate(value)) {
    add(
      problems,
      where,
      `Skal være en rigtig dato skrevet som "2026-12-24" (år-måned-dag). Fik: ${shown(value)}.`,
    )
    return null
  }

  return value
}

/** A wall-clock time, `HH:MM`, on a real 24-hour clock. */
export function time(problems: Problem[], where: string, value: unknown): IsoTime | null {
  try {
    parseIsoTime(value as IsoTime)
    return value as IsoTime
  } catch {
    add(
      problems,
      where,
      'Skal være et klokkeslæt skrevet som "15:00" — timer 00-23 og minutter 00-59. ' +
        `Fik: ${shown(value)}.`,
    )
    return null
  }
}

/**
 * An address the site will link a guest to.
 *
 * `https:` only, with a host — the rule `lib/announcements/link.ts` already states for
 * §8's open-redirect row, called here rather than written again. It is the same rule
 * for an announcement's link and for a link inside a news article.
 */
export function httpsUrl(problems: Problem[], where: string, value: unknown): void {
  if (isAllowedExternalUrl(value)) return

  add(
    problems,
    where,
    'Skal være en fuld https-adresse — f.eks. "https://www.facebook.com/carlnielsencafeen". ' +
      `Adresser der starter med http:// eller noget andet kan ikke bruges. Fik: ${shown(value)}.`,
  )
}

/**
 * A selected photograph.
 *
 * The two functions that decide whether a photograph exists are phase 2's own:
 * `photoSourceFrom` (the name grammar that refuses `../secret.png`, a remote address,
 * a Windows path, a space, an upper-case letter, an SVG) and `photoMeasurementOf` (the
 * file really is in `public/photos/`). Nothing about photograph safety is decided here.
 *
 * An absent field and a field whose `file` has been cleared are both the frame's
 * no-image state, exactly as `resolvePhoto` reads them, and neither is a problem.
 */
export function photo(problems: Problem[], where: string, value: unknown): void {
  if (isBlank(value)) return

  const field = object(
    problems,
    where,
    value,
    '{ "file": "/photos/navn.png", "alt": "...", "focus": "center" } — eller null, hvis der ' +
      'ikke skal være et billede',
  )
  if (field === null) return

  if (!isAbsent(field.alt) && typeof field.alt !== 'string') {
    add(
      problems,
      `${where}.alt`,
      'Skal være tekst i anførselstegn. En tom tekst ("") er et gyldigt svar: så læses billedet ' +
        `som pynt af en skærmlæser. Fik: ${shown(field.alt)}.`,
    )
  }

  if (!isBlank(field.focus)) {
    oneOf(problems, `${where}.focus`, field.focus, IMAGE_FOCUSES, 'Udelades betyder "center".')
  }

  // A selected-but-emptied image field is the no-image state, not a broken reference.
  if (isBlank(field.file)) return

  const fileWhere = `${where}.file`

  let source
  try {
    source = photoSourceFrom(field.file, fileWhere)
  } catch {
    add(
      problems,
      fileWhere,
      'Skal være en fil i public/photos/, skrevet som "/photos/navn.png" ' +
        `(${PHOTO_EXTENSIONS.join(', ')}) med små bogstaver, tal og enkelte bindestreger i ` +
        `navnet. Fik: ${shown(field.file)}.`,
    )
    return
  }

  try {
    photoMeasurementOf(source, fileWhere)
  } catch {
    add(
      problems,
      fileWhere,
      `${shown(field.file)} ligger ikke i public/photos/ — mappen indeholder ingen fil med ` +
        'præcis det navn. Læg billedet op i mappen, eller vælg et af de billeder der allerede ' +
        'er der.',
    )
  }
}

/**
 * Refuse a value that is used twice where the site needs it to be unique — an id that
 * is also an anchor, a reference that is also a React key.
 */
export function unique(problems: Problem[], entries: readonly Named[], note: string): void {
  const seen = new Set<string>()

  for (const entry of entries) {
    if (seen.has(entry.value)) {
      add(problems, entry.where, `"${entry.value}" står mere end ét sted. ${note}`)
    }
    seen.add(entry.value)
  }
}

/**
 * A list of short texts, each of which must say something and must not repeat — a
 * dish's labels, a tapas list's lines. Both are drawn one per element and keyed by
 * their own text, so the same string twice is one element the renderer loses.
 */
export function uniqueTexts(
  problems: Problem[],
  where: string,
  values: readonly unknown[],
  note: string,
): void {
  const written: Named[] = []

  values.forEach((value, index) => {
    const itemWhere = at(where, index + 1)
    const line = text(problems, itemWhere, value, { required: true })
    if (line !== null) written.push({ value: line, where: itemWhere })
  })

  unique(problems, written, note)
}
