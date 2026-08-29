/**
 * Dish labels — design 1r ("Mærkater (valgfrit)"), 1aa, 1h; owner decision, phase 5B.
 *
 * The approved design uses labels in two ways at once, and the owner has confirmed
 * both stay:
 *
 *   * **Four standard labels**, drawn as quick toggles in 1r and given their own tones
 *     in 1aa — Populær · Ny · Stærk · Vegetar.
 *   * **Short custom labels**, which the approved frames already print: "Pulled pork"
 *     beside Glade Gris (1h), "Kylling" and "Størst" on the Forside cards (1g, 1l).
 *
 * That is why `dishes.labels` is a `text[]` with a shape constraint rather than an
 * enumeration, and why decision-time recorded in `docs/dependencies.md` that pinning
 * four values would reject content the design itself contains. This module is the one
 * place the *rules* about that array live, so the editor, the schema and the tests all
 * agree on the same sentences.
 *
 * THE RULES, AND WHERE EACH COMES FROM
 *
 *   1. **At most four labels in total.** The database CHECK (`is_valid_dish_labels`)
 *      caps the array at four, so four is a fact about the column, not a preference.
 *      Standard and custom labels share that budget.
 *   2. **At most 30 characters per custom label.** The confirmed decision. A label is a
 *      chip beside a dish name, not a sentence.
 *   3. **Trimmed, and never blank.** Blank is absent — the same rule the rest of the
 *      schemas follow. An empty custom slot is an unused slot, not an empty label.
 *   4. **No duplicates, compared case-insensitively.** The database compares exactly;
 *      this layer is stricter, because "Kylling" and "kylling" beside the same dish is
 *      a mistake every time.
 *   5. **A custom label may not restate a standard one.** Typing "populær" into the
 *      custom field would produce a chip in the neutral tone that the design gives the
 *      brand tone. The toggle is the way to say that, and the refusal says so.
 *
 * WHAT IS NOT HERE, DELIBERATELY
 *
 * No colours, no icons, no ordering vocabulary and no label registry. Tone is decided
 * once, at render time, by `components/site/menu/DishBadge.tsx`: the four standard
 * values carry their approved tones and everything else is neutral. Labels are text —
 * turning them into tags with their own design system is exactly what the phase brief
 * rules out.
 */

/** The four quick toggles from 1r, in the order the design draws them. */
export const STANDARD_DISH_LABELS = ['Populær', 'Ny', 'Stærk', 'Vegetar'] as const

export type StandardDishLabel = (typeof STANDARD_DISH_LABELS)[number]

/** The confirmed cap on a custom label. */
export const MAX_CUSTOM_LABEL_LENGTH = 30

/** The database CHECK: at most four distinct, non-blank strings (§4). */
export const MAX_DISH_LABELS = 4

/** Why a set of labels was refused. The editor turns each one into its own sentence. */
export type LabelError = 'unknown_standard' | 'too_long' | 'duplicate' | 'reserved' | 'too_many'

export type LabelResult =
  | { readonly ok: true; readonly labels: string[] }
  | { readonly ok: false; readonly errors: readonly LabelError[] }

/** The comparison rule for rules 4 and 5, stated once. */
function fold(label: string): string {
  return label.trim().toLocaleLowerCase('da-DK')
}

export function isStandardDishLabel(label: string): label is StandardDishLabel {
  return STANDARD_DISH_LABELS.some((standard) => fold(standard) === fold(label))
}

/**
 * Split a dish's stored labels into the two controls the editor draws.
 *
 * The standard half keeps the design's own order so the four toggles never move about
 * between dishes; the custom half keeps the order the labels are stored in, which is
 * the order a person put them in.
 */
export function splitDishLabels(labels: readonly string[]): {
  standard: StandardDishLabel[]
  custom: string[]
} {
  const selected = new Set(labels.map(fold))

  return {
    standard: STANDARD_DISH_LABELS.filter((standard) => selected.has(fold(standard))),
    custom: labels.filter((label) => !isStandardDishLabel(label)),
  }
}

/**
 * Build the array to store from what the editor submitted.
 *
 * `existing` is the dish's current labels and exists for one reason: **an edit that
 * does not touch the labels must not rewrite them.** Changing the price of Glade Gris
 * has to leave `['Pulled pork']` byte-identical, and the surest way to guarantee that
 * is to emit the labels a dish already has in the order it already has them, and only
 * then append what is new. A reordered array is not a lost label, but it is a
 * difference in an audit row and a difference in a draft, and neither should appear
 * because somebody corrected a typo in a description.
 *
 * Every refusal is collected rather than thrown at the first one, so a person fixing a
 * label sees everything wrong with it at once.
 */
export function buildDishLabels(submitted: {
  readonly standard: readonly string[]
  readonly custom: readonly string[]
  readonly existing?: readonly string[]
}): LabelResult {
  const errors = new Set<LabelError>()

  // --- the four toggles -------------------------------------------------------
  const standard: string[] = []
  for (const value of submitted.standard) {
    const match = STANDARD_DISH_LABELS.find((label) => fold(label) === fold(value))
    if (match === undefined) {
      // Not one of the four. A checkbox carrying anything else did not come from the
      // approved editor, so it is refused rather than stored as a custom label.
      errors.add('unknown_standard')
      continue
    }
    standard.push(match)
  }

  // --- the free-text chips ----------------------------------------------------
  const custom: string[] = []
  for (const raw of submitted.custom) {
    const label = raw.trim()

    // An empty slot is an unused control, not an empty label (rule 3).
    if (label.length === 0) continue

    if (label.length > MAX_CUSTOM_LABEL_LENGTH) {
      errors.add('too_long')
      continue
    }

    if (isStandardDishLabel(label)) {
      errors.add('reserved')
      continue
    }

    custom.push(label)
  }

  // --- one list, deduplicated case-insensitively (rule 4) ---------------------
  const chosen: string[] = []
  const seen = new Set<string>()

  for (const label of [...standard, ...custom]) {
    if (seen.has(fold(label))) {
      errors.add('duplicate')
      continue
    }
    seen.add(fold(label))
    chosen.push(label)
  }

  if (chosen.length > MAX_DISH_LABELS) errors.add('too_many')

  if (errors.size > 0) return { ok: false, errors: [...errors] }

  // --- keep what was already there, in the order it was already in ------------
  // The *text* is always the submitted text, so correcting a label's spelling works.
  // Only the *order* is inherited, and only for labels the dish already had; anything
  // new keeps the order it was submitted in, after them. `sort` is stable, so equal
  // ranks — every newly added label — do not move relative to each other.
  const existingOrder = new Map<string, number>()
  for (const [index, label] of (submitted.existing ?? []).entries()) {
    if (!existingOrder.has(fold(label))) existingOrder.set(fold(label), index)
  }

  const rankOf = (label: string): number =>
    existingOrder.get(fold(label)) ?? Number.MAX_SAFE_INTEGER

  return { ok: true, labels: [...chosen].sort((a, b) => rankOf(a) - rankOf(b)) }
}
