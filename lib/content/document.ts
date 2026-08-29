/**
 * Reading values out of a stored JSON document — technical plan §4.
 *
 * `pages.published`, `dishes.details` and `news.body` are `jsonb`. The database
 * guarantees they are objects and nothing more; the field-level shape is guaranteed by
 * the editors, which arrive from phase 4 with Zod (§1, adjustment 4).
 *
 * Until then the public site still has to render a document it did not write, so these
 * helpers narrow an `unknown` to the type a page expects and return `null` — never a
 * guess — when the value is not there. That is deliberately *not* a second validator:
 * nothing here reports errors, coerces types or fills in defaults. It is the smallest
 * amount of code that lets a missing field render as a missing field instead of
 * throwing on a visitor.
 */

export type JsonObject = Record<string, unknown>

/** The value at `key`, when the container is an object. */
export function field(document: unknown, key: string): unknown {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return undefined
  return (document as JsonObject)[key]
}

/** A nested object, or `null`. */
export function objectField(document: unknown, key: string): unknown {
  const value = field(document, key)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value
}

/** A non-blank string, or `null`. Blank is treated as absent: an empty field is not content. */
export function stringField(document: unknown, key: string): string | null {
  const value = field(document, key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** The non-blank strings of an array field, in order. Missing or malformed gives `[]`. */
export function stringArrayField(document: unknown, key: string): string[] {
  const value = field(document, key)
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/** The object entries of an array field, in order. */
export function objectArrayField(document: unknown, key: string): unknown[] {
  const value = field(document, key)
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  )
}

/** A finite number field, or `null`. */
export function numberField(document: unknown, key: string): number | null {
  const value = field(document, key)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A boolean field, or `false`. */
export function booleanField(document: unknown, key: string): boolean {
  return field(document, key) === true
}
