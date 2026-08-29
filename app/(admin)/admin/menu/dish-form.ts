import type { AdminDish, DishDraftValues } from '@/lib/menu/admin'
import {
  buildDishLabels,
  MAX_CUSTOM_LABEL_LENGTH,
  MAX_DISH_LABELS,
  splitDishLabels,
} from '@/lib/menu/labels'
import { formatOreForInput, parseKronerToOre } from '@/lib/menu/pricing'

/**
 * The dish editor's form, read and written in one place — design 1r / 1y.
 *
 * The panel in 1r is a plain `<form>` posting to a Server Action, like every other
 * form in this administration: no client component, no controlled inputs, no state
 * library, and nothing in the browser that has to be kept in step with the server.
 * What that costs is a place to put the mapping between the form's Danish field names
 * and the entity's database fields, and this module is it — the same job
 * `indhold/editors.ts` does for the phase-4 content editors.
 *
 * It is deliberately not generic. It knows one form, and it can be read end to end.
 *
 * THREE THINGS IT OWNS
 *
 *   1. **The field names**, once. The form renders them and the action reads them from
 *      the same constants, so a rename cannot half-happen.
 *   2. **The conversions**, delegated. Kroner become øre in `lib/menu/pricing.ts`, and
 *      labels are assembled in `lib/menu/labels.ts`. Neither rule is restated here;
 *      this module decides only which form fields feed which rule.
 *   3. **Round-tripping a refusal.** A save that fails validation must come back with
 *      the errors *attached to their fields* and with what the person typed still in
 *      them. The Server Action redirects — that is how the rest of this administration
 *      reports — so both travel in the query string, as a closed set of codes plus the
 *      submitted text. Nothing from the query string is ever trusted as a value: it is
 *      re-parsed by the same functions on the way back in.
 */

/** Every field name the dish form uses. */
export const DISH_FORM = {
  dishId: 'ret',
  version: 'version',
  name: 'navn',
  price: 'pris',
  category: 'sektion',
  description: 'beskrivelse',
  secondaryNote: 'ekstra_linje',
  /** One checkbox per standard label; the value is the label itself. */
  standardLabel: 'maerkat',
  /** One text field per custom label, repeated. */
  customLabel: 'maerkat_fri',
} as const

/** The fields an error can be attached to, and the query parameter that carries them. */
export const DISH_ERROR_FIELD = 'fejl'

export type DishErrorField = 'navn' | 'pris' | 'maerkater' | 'sektion'

export type DishErrorCode =
  | 'navn:required'
  | 'navn:too_long'
  | 'pris:not_a_number'
  | 'pris:too_many_decimals'
  | 'pris:out_of_range'
  | 'maerkater:too_long'
  | 'maerkater:duplicate'
  | 'maerkater:reserved'
  | 'maerkater:too_many'
  | 'maerkater:unknown_standard'
  | 'sektion:required'
  | 'sektion:not_allowed'
  | 'beskrivelse:too_long'
  | 'ekstra_linje:too_long'

/** The sentence each refusal shows, beneath its own field. */
export const DISH_ERROR_MESSAGES: Record<DishErrorCode, string> = {
  'navn:required': 'Retten skal have et navn.',
  'navn:too_long': 'Navnet må højst være 200 tegn.',
  'pris:not_a_number': 'Prisen skal være et tal, fx 89 eller 89,50.',
  'pris:too_many_decimals': 'Prisen kan højst have to decimaler, fx 89,50.',
  'pris:out_of_range': 'Prisen skal være mellem 0 og 10.000 kr.',
  'maerkater:too_long': `En mærkat må højst være ${MAX_CUSTOM_LABEL_LENGTH} tegn.`,
  'maerkater:duplicate': 'Den samme mærkat kan kun stå én gang.',
  'maerkater:reserved': 'Brug knappen ovenfor til de faste mærkater.',
  'maerkater:too_many': `En ret kan højst have ${MAX_DISH_LABELS} mærkater i alt.`,
  'maerkater:unknown_standard': 'Ukendt mærkat.',
  'sektion:required': 'Vælg en sektion.',
  'sektion:not_allowed': 'Retten kan ikke ligge i den sektion.',
  'beskrivelse:too_long': 'Beskrivelsen må højst være 600 tegn.',
  'ekstra_linje:too_long': 'Den ekstra linje må højst være 200 tegn.',
}

const ERROR_CODES = Object.keys(DISH_ERROR_MESSAGES) as DishErrorCode[]

/** The field an error belongs to, so the form can bind it with `aria-describedby`. */
export function errorField(code: DishErrorCode): DishErrorField {
  return code.split(':')[0] as DishErrorField
}

/** Only codes this module defined. Anything else in the URL contributes nothing. */
export function decodeDishErrors(values: readonly string[]): DishErrorCode[] {
  return values.filter((value): value is DishErrorCode =>
    (ERROR_CODES as string[]).includes(value),
  )
}

/** Exactly what the person typed, before any rule has been applied to it. */
export type DishFormValues = {
  readonly name: string
  readonly price: string
  readonly categoryId: string
  readonly description: string
  readonly secondaryNote: string
  readonly standardLabels: readonly string[]
  readonly customLabels: readonly string[]
}

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

function textList(source: FormData | URLSearchParams, name: string): string[] {
  return source.getAll(name).filter((value): value is string => typeof value === 'string')
}

/** Read the submitted form as text. No rule is applied and no value is trusted yet. */
export function readDishForm(source: FormData | URLSearchParams): DishFormValues {
  return {
    name: text(source, DISH_FORM.name),
    price: text(source, DISH_FORM.price),
    categoryId: text(source, DISH_FORM.category),
    description: text(source, DISH_FORM.description),
    secondaryNote: text(source, DISH_FORM.secondaryNote),
    standardLabels: textList(source, DISH_FORM.standardLabel),
    customLabels: textList(source, DISH_FORM.customLabel),
  }
}

/**
 * The draft values a valid form produces, in database casing.
 *
 * The shape itself lives in `lib/menu/admin.ts`, beside the rule that reduces a
 * submitted dish to the fields it actually changed — the two have to describe the same
 * thing, so they are the same type.
 */
export type { DishDraftValues }

export type DishFormResult =
  | { readonly ok: true; readonly values: DishDraftValues }
  | { readonly ok: false; readonly errors: readonly DishErrorCode[] }

/**
 * Turn the submitted text into draft values, or into the refusals it earned.
 *
 * Every field is checked, not just the first that fails, so somebody correcting a form
 * sees everything wrong with it at once rather than one problem per attempt.
 *
 * `existingLabels` is what the dish already carries. It is passed through to
 * `buildDishLabels` so that an edit which does not touch the labels leaves them exactly
 * as they were — the phase brief's own example: changing the price of Glade Gris must
 * not remove "Pulled pork".
 *
 * `categoryAllows` is the menu rule from `lib/menu/admin.ts`. It is a required argument
 * rather than an import so this module cannot decide a question it does not own, and so
 * the Server Action is forced to answer it against the sections the *server* read.
 */
export function toDishDraftValues(
  form: DishFormValues,
  context: {
    readonly existingLabels: readonly string[]
    readonly categoryAllows: (categoryId: string) => boolean
  },
): DishFormResult {
  const errors: DishErrorCode[] = []

  const name = form.name.trim()
  if (name.length === 0) errors.push('navn:required')
  else if (name.length > 200) errors.push('navn:too_long')

  const price = parseKronerToOre(form.price)
  if (!price.ok) errors.push(`pris:${price.error}` as DishErrorCode)

  const categoryId = form.categoryId.trim()
  if (categoryId.length === 0) errors.push('sektion:required')
  else if (!context.categoryAllows(categoryId)) errors.push('sektion:not_allowed')

  const description = form.description.trim()
  if (description.length > 600) errors.push('beskrivelse:too_long')

  const secondaryNote = form.secondaryNote.trim()
  if (secondaryNote.length > 200) errors.push('ekstra_linje:too_long')

  const labels = buildDishLabels({
    standard: form.standardLabels,
    custom: form.customLabels,
    existing: context.existingLabels,
  })
  if (!labels.ok) {
    for (const error of labels.errors) errors.push(`maerkater:${error}` as DishErrorCode)
  }

  if (errors.length > 0 || !price.ok || !labels.ok) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    values: {
      category_id: categoryId,
      name,
      // Blank is absent, the rule every schema in this repository follows.
      description: description.length > 0 ? description : null,
      secondary_note: secondaryNote.length > 0 ? secondaryNote : null,
      price_ore: price.priceOre,
      labels: labels.labels,
    },
  }
}

/**
 * The query string a refused save comes back with: the codes, and what was typed.
 *
 * Menu content, not personal data, and re-parsed by `readDishForm` on the way back in —
 * so the URL is a convenience for the person, never a source of authority. React
 * escapes the values when it renders them into the fields.
 */
export function encodeDishFormEcho(
  form: DishFormValues,
  errors: readonly DishErrorCode[],
): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const code of errors) parameters.append(DISH_ERROR_FIELD, code)

  parameters.set(DISH_FORM.name, form.name)
  parameters.set(DISH_FORM.price, form.price)
  parameters.set(DISH_FORM.category, form.categoryId)
  parameters.set(DISH_FORM.description, form.description)
  parameters.set(DISH_FORM.secondaryNote, form.secondaryNote)
  for (const label of form.standardLabels) parameters.append(DISH_FORM.standardLabel, label)
  for (const label of form.customLabels) parameters.append(DISH_FORM.customLabel, label)

  return parameters
}

/** An empty form, for a dish that does not exist yet. `section` preselects a section. */
export function emptyDishForm(categoryId: string): DishFormValues {
  return {
    name: '',
    price: '',
    categoryId,
    description: '',
    secondaryNote: '',
    standardLabels: [],
    customLabels: [],
  }
}

/**
 * A stored dish as the form shows it.
 *
 * The øre become the text the field displays through `formatOreForInput`, and the
 * labels are split into the two controls by `splitDishLabels` — both conversions
 * delegated, so the editor cannot format a price one way and parse it another.
 */
export function dishFormValues(dish: AdminDish): DishFormValues {
  const labels = splitDishLabels(dish.labels)

  return {
    name: dish.name,
    price: formatOreForInput(dish.priceOre),
    categoryId: dish.categoryId,
    description: dish.description ?? '',
    secondaryNote: dish.secondaryNote ?? '',
    standardLabels: labels.standard,
    customLabels: labels.custom,
  }
}
