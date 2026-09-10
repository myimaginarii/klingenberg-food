/**
 * The empty string a cleared editor control writes, read as "nothing here".
 *
 * `content/site/` is edited two ways. A person editing the JSON writes `null` for a
 * field that is not filled in, which is what every loader below has always taken. A
 * person editing the same field in Pages CMS gets a form control, and a control that
 * has been emptied — a date picker with no date, a number field the editor cleared, a
 * price left blank — serialises as `""` rather than as `null`. Both are the same
 * answer, and this is where they are made into the same value.
 *
 * WHAT THIS IS NOT. It is deliberately not a rule about empty strings in general.
 * `""` is a *meaningful* value for a photograph's alternative text (it says "this
 * picture is decoration"), and it is an ordinary value for a prose field somebody
 * emptied — `./text.ts` hands both on untouched, and nothing here changes that. What
 * is converted is only the fields whose domain value is a date, a time, a number or a
 * price: values the site parses or compares, where `""` is not a shorter answer but a
 * broken one.
 *
 * The validators read the same two spellings the same way (`isBlank` in
 * `lib/content/validate/fields.ts`), so a cleared control is accepted there and
 * arrives here as `null`. A *required* field left empty is still refused, by the
 * validator, before any of this runs.
 */

/** True for the three values that all mean "this field was left empty". */
export function isCleared(value: unknown): value is null | undefined | '' {
  return value === null || value === undefined || value === ''
}

/**
 * A stored date, time, number or price as the domain carries it: the written value,
 * or `null` when the field was left empty in either spelling.
 */
export function stored<T extends string | number>(value: T | '' | null | undefined): T | null {
  return isCleared(value) ? null : (value as T)
}
