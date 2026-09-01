import type { AdminNewsArticle } from '@/lib/content/news-admin'
import type { NewsBody } from '@/lib/content/types'
import {
  bodyFromEditorText,
  bodyFromStructuredJson,
  bodyHasMarks,
  bodyToEditorText,
} from '@/lib/news/body'
import { NEWS_CATEGORIES } from '@/lib/schemas/news'
import { slugFromTitle } from '@/lib/news/slug'
import { isIsoDate } from '@/lib/time/calendar'

/**
 * The news editor's form, read and written in one place — design 1s / 1z; phase 9A.
 *
 * The editor is a plain `<form>` posting to a Server Action, like every other form in
 * this administration: no client component, no controlled inputs, and nothing in the
 * browser to keep in step with the server. This module is the mapping between the
 * form's Danish field names and the article's fields — the same job `dish-form.ts`
 * does for the dish panel, and deliberately not generic.
 *
 * THREE THINGS IT OWNS
 *
 *   1. **The field names**, once. The form renders them and the actions read them from
 *      the same constants.
 *   2. **The conversions**, delegated: the body text becomes structured paragraphs in
 *      `lib/news/body.ts`, and the slug follows §7f in `lib/news/slug.ts`. This module
 *      decides only which form fields feed which rule — and it does **not** resolve the
 *      collision suffix, because that needs the database's slugs; it hands the action a
 *      base to resolve.
 *   3. **Round-tripping a refusal.** A save that fails validation comes back with the
 *      codes and the typed text in the query string, re-read by the same parser on the
 *      way back in. Nothing from the query string is trusted as a value.
 *
 * There is deliberately **no slug field** here. §7f: the slug is generated from the
 * title and frozen at first publish; the editor shows the resulting address and never
 * offers to edit it.
 */

/** Every field name the news form uses. */
export const NEWS_FORM = {
  articleId: 'nyhed',
  version: 'version',
  title: 'overskrift',
  displayDate: 'dato',
  /** One radio per category chip; the empty value is "ingen kategori". */
  category: 'kategori',
  body: 'tekst',
  /**
   * The structured document, as the 9B editor submits it: the stored body shape
   * serialised as JSON in a hidden field. When present it **wins over `tekst`** —
   * the plain field is the fallback dialect, and a body with marks has no faithful
   * plain-text form to lose to (`lib/news/body.ts`).
   */
  bodyDocument: 'tekst_struktur',
} as const

/** The fields an error can be attached to, and the query parameter that carries them. */
export const NEWS_ERROR_FIELD = 'fejl'

export type NewsErrorField = 'overskrift' | 'dato' | 'kategori' | 'tekst'

export type NewsErrorCode =
  | 'overskrift:mangler'
  | 'overskrift:for_lang'
  /** §7f's empty-slug case: a title with no letter or digit produces no address. */
  | 'overskrift:uden_adresse'
  | 'dato:ugyldig'
  | 'kategori:ukendt'
  | 'tekst:mangler'
  /** A structured body that is not this schema's document — refused, never repaired. */
  | 'tekst:ugyldig'

/** The sentence each refusal shows, beneath its own field. */
export const NEWS_ERROR_MESSAGES: Record<NewsErrorCode, string> = {
  'overskrift:mangler': 'Nyheden skal have en overskrift.',
  'overskrift:for_lang': 'Overskriften må højst være 200 tegn.',
  'overskrift:uden_adresse':
    'Overskriften skal indeholde mindst ét bogstav eller tal, så nyheden kan få en adresse.',
  'dato:ugyldig': 'Datoen skal være en rigtig dato.',
  'kategori:ukendt': 'Ukendt kategori.',
  'tekst:mangler': 'Skriv teksten til nyheden.',
  'tekst:ugyldig':
    'Teksten kunne ikke læses. Der er ikke gemt noget — genindlæs siden, og prøv igen.',
}

const ERROR_CODES = Object.keys(NEWS_ERROR_MESSAGES) as NewsErrorCode[]

/** The field an error belongs to, so the form can bind it with `aria-describedby`. */
export function errorField(code: NewsErrorCode): NewsErrorField {
  return code.split(':')[0] as NewsErrorField
}

/** Only codes this module defined. Anything else in the URL contributes nothing. */
export function decodeNewsErrors(values: readonly string[]): NewsErrorCode[] {
  return values.filter((value): value is NewsErrorCode =>
    (ERROR_CODES as string[]).includes(value),
  )
}

/** Exactly what the person typed, before any rule has been applied to it. */
export type NewsFormValues = {
  readonly title: string
  readonly displayDate: string
  readonly category: string
  readonly body: string
  /** The structured editor's JSON, or '' when the plain field spoke. */
  readonly bodyDocument: string
}

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/** Read the submitted form as text. No rule is applied and no value is trusted yet. */
export function readNewsForm(source: FormData | URLSearchParams): NewsFormValues {
  return {
    title: text(source, NEWS_FORM.title),
    displayDate: text(source, NEWS_FORM.displayDate),
    category: text(source, NEWS_FORM.category),
    body: text(source, NEWS_FORM.body),
    bodyDocument: text(source, NEWS_FORM.bodyDocument),
  }
}

/** The values a valid form produces, in database casing — minus the resolved slug. */
export type NewsArticleValues = {
  readonly title: string
  readonly body: NewsBody
  readonly category: string | null
  readonly display_date: string | null
}

export type NewsFormResult =
  | {
      readonly ok: true
      readonly values: NewsArticleValues
      /**
       * §7f's slug decision, as far as a pure mapping can take it. `frozen` restates
       * the row's own slug — the article has been published, so the address may not
       * move. `generated` carries the base the action resolves against the slugs the
       * server read (`resolveSlugCollision`).
       */
      readonly slug:
        | { readonly kind: 'frozen'; readonly slug: string }
        | { readonly kind: 'generated'; readonly base: string }
    }
  | { readonly ok: false; readonly errors: readonly NewsErrorCode[] }

/**
 * Turn the submitted text into article values, or into the refusals it earned.
 *
 * Every field is checked, not just the first that fails, so a person correcting the
 * form sees everything wrong with it at once.
 *
 * `frozenSlug` is the row's slug when the article has been published — the §7f
 * freeze, honoured here by not generating anything. `null` means the slug follows the
 * title.
 */
export function toNewsArticleValues(
  form: NewsFormValues,
  context: { readonly frozenSlug: string | null },
): NewsFormResult {
  const errors: NewsErrorCode[] = []

  const title = form.title.trim()
  if (title.length === 0) errors.push('overskrift:mangler')
  else if (title.length > 200) errors.push('overskrift:for_lang')

  let slug: { kind: 'frozen'; slug: string } | { kind: 'generated'; base: string } | null =
    context.frozenSlug === null ? null : { kind: 'frozen', slug: context.frozenSlug }

  if (slug === null && title.length > 0) {
    const base = slugFromTitle(title)
    if (base === null) errors.push('overskrift:uden_adresse')
    else slug = { kind: 'generated', base }
  }

  const displayDate = form.displayDate.trim()
  if (displayDate.length > 0 && !isIsoDate(displayDate)) errors.push('dato:ugyldig')

  const category = form.category.trim()
  if (category.length > 0 && !(NEWS_CATEGORIES as readonly string[]).includes(category)) {
    errors.push('kategori:ukendt')
  }

  // The structured document wins when it speaks: it is the only dialect that can
  // carry a mark, and it is re-parsed against the body's own strict schema — a
  // malformed document (or a link that is not absolute https:) is a refusal here,
  // never something to repair or flatten (§8, phase brief §4).
  let body: NewsBody | null = null

  if (form.bodyDocument.trim().length > 0) {
    const structured = bodyFromStructuredJson(form.bodyDocument)
    if (structured.ok) body = structured.body
    else errors.push(structured.reason === 'empty' ? 'tekst:mangler' : 'tekst:ugyldig')
  } else {
    body = bodyFromEditorText(form.body)
    if (body === null) errors.push('tekst:mangler')
  }

  if (errors.length > 0 || body === null || slug === null) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    values: {
      title,
      body,
      // Blank is absent, the rule every schema in this repository follows.
      category: category.length > 0 ? category : null,
      display_date: displayDate.length > 0 ? displayDate : null,
    },
    slug,
  }
}

/**
 * The query string a refused save comes back with: the codes, and what was typed.
 * Re-parsed by `readNewsForm` on the way back in — a convenience for the person,
 * never a source of authority.
 */
export function encodeNewsFormEcho(
  form: NewsFormValues,
  errors: readonly NewsErrorCode[],
): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const code of errors) parameters.append(NEWS_ERROR_FIELD, code)

  parameters.set(NEWS_FORM.title, form.title)
  parameters.set(NEWS_FORM.displayDate, form.displayDate)
  parameters.set(NEWS_FORM.category, form.category)
  parameters.set(NEWS_FORM.body, form.body)
  // A refused or conflicting structured save echoes its document too, so bold and
  // links survive the round trip exactly — nothing typed is lost, and nothing is
  // flattened on the way back into the editor.
  if (form.bodyDocument.length > 0) parameters.set(NEWS_FORM.bodyDocument, form.bodyDocument)

  return parameters
}

/** An empty form for an article that does not exist yet. The date defaults to today
 *  (Copenhagen), which is what "Dato på hjemmesiden" almost always means. */
export function emptyNewsForm(todayIso: string): NewsFormValues {
  return { title: '', displayDate: todayIso, category: '', body: '', bodyDocument: '' }
}

/** A stored article as the form shows it. The body text comes from the one shared
 *  projection in `lib/news/body.ts`. */
export function newsFormValues(article: AdminNewsArticle): NewsFormValues {
  return {
    title: article.title,
    displayDate: article.displayDate ?? '',
    category: article.category ?? '',
    body: bodyToEditorText(article.body).text,
    bodyDocument: '',
  }
}

/**
 * What the Tekst field renders from — the three facts the two dialects need
 * (`components/admin/news/NewsBodyField.tsx`):
 *
 *   * `text` — the plain projection, for the textarea fallback. Only offered as an
 *     *editing* surface when `hasMarks` is false, because for a marked body it is a
 *     flattening, and saving it would destroy the marks (phase brief §6).
 *   * `document` — the structured body the enhanced editor edits, or null when only
 *     plain text exists (a new article, or a plain echo).
 *   * `hasMarks` — the 9A guard, now load-bearing: it chooses between the editable
 *     textarea and the mark-preserving read-only fallback.
 */
export type EditorBodyState = {
  readonly text: string
  readonly document: NewsBody | null
  readonly hasMarks: boolean
}

/** The body state for a stored article. */
export function articleBodyState(article: AdminNewsArticle): EditorBodyState {
  return {
    text: bodyToEditorText(article.body).text,
    document: article.body,
    hasMarks: bodyHasMarks(article.body),
  }
}

/**
 * The body state for echoed form values (a refusal or a conflict). A structured echo
 * is re-parsed by the same reader a save uses; an echo that cannot be read edits as
 * the plain text that was typed — which is all such an echo ever carried.
 */
export function echoedBodyState(form: NewsFormValues): EditorBodyState {
  if (form.bodyDocument.trim().length > 0) {
    const structured = bodyFromStructuredJson(form.bodyDocument)
    if (structured.ok) {
      return {
        text: bodyToEditorText(structured.body).text,
        document: structured.body,
        hasMarks: bodyHasMarks(structured.body),
      }
    }
  }

  return { text: form.body, document: null, hasMarks: false }
}
