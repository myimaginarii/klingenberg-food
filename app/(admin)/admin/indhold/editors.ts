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
 * WHY THE FIELD LISTS ARE WRITTEN OUT
 *
 * A generic "render every field in the schema" editor would be shorter and worse. The
 * page-document schemas nest, the fields need Danish labels a schema has no business
 * carrying, and a field list that is generated is a field list nobody reviews. These
 * are four small tables that say exactly what each form may contain.
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
    entity: 'page:home',
    heading: 'Forsiden',
    description:
      'Overskriften og teksten øverst på forsiden, og teksten om udmærkelsen. Kun ejeren kan rette forsiden.',
    fields: [
      {
        name: 'hero_heading',
        label: 'Overskrift',
        current: (values) => sectionValue(values, 'hero', 'heading'),
      },
      {
        name: 'hero_intro',
        label: 'Introtekst',
        multiline: true,
        current: (values) => sectionValue(values, 'hero', 'intro'),
      },
      {
        name: 'award_title',
        label: 'Udmærkelsens titel',
        current: (values) => sectionValue(values, 'award', 'title'),
      },
      {
        name: 'award_text',
        label: 'Tekst om udmærkelsen',
        multiline: true,
        current: (values) => sectionValue(values, 'award', 'text'),
      },
    ],
    toDraftValues: (form) => ({
      hero: { heading: text(form, 'hero_heading'), intro: text(form, 'hero_intro') },
      award: { title: text(form, 'award_title'), text: text(form, 'award_text') },
    }),
  },

  {
    entity: 'page:takeaway',
    heading: 'Mad ud af huset',
    description: 'Overskrift, introtekst og knaptekst på siden om mad ud af huset.',
    fields: [
      { name: 'heading', label: 'Overskrift', current: (values) => value(values, 'heading') },
      {
        name: 'intro',
        label: 'Introtekst',
        multiline: true,
        current: (values) => value(values, 'intro'),
      },
      { name: 'cta_label', label: 'Knaptekst', current: (values) => value(values, 'cta_label') },
    ],
    toDraftValues: (form) => ({
      heading: text(form, 'heading'),
      intro: text(form, 'intro'),
      cta_label: text(form, 'cta_label'),
    }),
  },

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

  {
    entity: 'site_contact',
    heading: 'Kontaktoplysninger',
    description:
      'Adresse og telefonnumre. De står på alle sider, så kun ejeren kan rette dem.',
    fields: [
      { name: 'venue_name', label: 'Stedets navn', current: (values) => value(values, 'venue_name') },
      {
        name: 'address_line1',
        label: 'Adresse',
        current: (values) => value(values, 'address_line1'),
      },
      { name: 'postal_code', label: 'Postnummer', current: (values) => value(values, 'postal_code') },
      { name: 'city', label: 'By', current: (values) => value(values, 'city') },
      {
        name: 'primary_phone',
        label: 'Hovednummer',
        current: (values) => value(values, 'primary_phone'),
      },
      {
        name: 'secondary_phone',
        label: 'Sekundært nummer',
        current: (values) => value(values, 'secondary_phone'),
      },
    ],
    toDraftValues: (form) => ({
      venue_name: text(form, 'venue_name'),
      address_line1: text(form, 'address_line1'),
      postal_code: text(form, 'postal_code'),
      city: text(form, 'city'),
      primary_phone: text(form, 'primary_phone'),
      secondary_phone: text(form, 'secondary_phone'),
    }),
  },
]

export function contentEditorFor(entity: EntityKey): ContentEditor | null {
  return CONTENT_EDITORS.find((editor) => editor.entity === entity) ?? null
}
