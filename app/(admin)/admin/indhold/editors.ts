import type { EntityKey } from '@/lib/publishing/entities'

/**
 * The phase-4 content editors — technical plan §6, §15 (phase 4).
 *
 * PHASE 4 SCOPE, AND DELIBERATELY SMALL. The approved editors — Forsiden (1u), Mad ud
 * af huset (1aj), Kontaktoplysninger (1v) — are phase 11. What is here is the minimum
 * that exercises the machinery this phase exists to build: a Staff-editable entity, an
 * Owner-only entity, a document-shaped draft and a column-shaped one. Every screen
 * below is replaced later, and none of it is a design decision.
 *
 * **Forsiden left this list in phase 11A**, and **Mad ud af huset and
 * Kontaktoplysninger left it in phase 11B**: their approved editors exist at
 * `/admin/forsiden` (1u), `/admin/mad-ud-af-huset` (1aj) and `/admin/kontakt` (1v),
 * and two editors for one document would be two saving conventions for the same
 * draft. What remains is Om os, until the phase that gives it 1i's editor.
 *
 * WHY THE FIELD LIST IS WRITTEN OUT
 *
 * A generic "render every field in the schema" editor would be shorter and worse. The
 * page-document schemas nest, the fields need Danish labels a schema has no business
 * carrying, and a field list that is generated is a field list nobody reviews. This is
 * one small table that says exactly what the form may contain.
 *
 * SECTIONS ARE SUBMITTED WHOLE
 *
 * A page draft is merged over the published document one top-level section at a time
 * (`published || draft`), so a section that appears in a draft must be complete —
 * `lib/schemas/page-documents.ts` enforces that. `toDraftValues` therefore builds whole
 * sections from the form, never a single nested key.
 */

export type EditorField = {
  readonly name: string
  readonly label: string
  readonly multiline?: boolean
  /** The value to show, read out of `EditableEntity.values`. */
  readonly current: (values: Record<string, unknown>) => string
}

export type ContentEditor = {
  readonly entity: EntityKey
  readonly heading: string
  readonly description: string
  readonly fields: readonly EditorField[]
  /** Build this entity's draft values from the submitted form. */
  readonly toDraftValues: (form: FormData) => unknown
}

/** A submitted field, trimmed. Blank becomes `null` — an empty field is not content. */
function text(form: FormData, name: string): string | null {
  const value = form.get(name)
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** A top-level value from the loaded values, as form text. */
function value(values: Record<string, unknown>, key: string): string {
  const found = values[key]
  return typeof found === 'string' ? found : ''
}

/** A value inside a document section, as form text. */
function sectionValue(
  values: Record<string, unknown>,
  section: string,
  key: string,
): string {
  const found = values[section]
  if (typeof found !== 'object' || found === null || Array.isArray(found)) return ''

  const nested = (found as Record<string, unknown>)[key]
  return typeof nested === 'string' ? nested : ''
}

export const CONTENT_EDITORS: readonly ContentEditor[] = [
  {
    entity: 'page:about',
    heading: 'Om os',
    description: 'Overskriften på Om os, og afsnittet om hvordan I laver burgere.',
    fields: [
      { name: 'heading', label: 'Overskrift', current: (values) => value(values, 'heading') },
      {
        name: 'method_heading',
        label: 'Overskrift på metodeafsnit',
        current: (values) => sectionValue(values, 'method', 'heading'),
      },
      {
        name: 'method_text',
        label: 'Tekst i metodeafsnit',
        multiline: true,
        current: (values) => sectionValue(values, 'method', 'text'),
      },
    ],
    toDraftValues: (form) => ({
      heading: text(form, 'heading'),
      method: { heading: text(form, 'method_heading'), text: text(form, 'method_text') },
    }),
  },
]

export function contentEditorFor(entity: EntityKey): ContentEditor | null {
  return CONTENT_EDITORS.find((editor) => editor.entity === entity) ?? null
}
