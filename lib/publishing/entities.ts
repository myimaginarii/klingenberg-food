import { z } from 'zod'

import { CACHE_TAGS, type CacheTag } from '@/lib/cache/tags'
import type { Role } from '@/lib/auth/session'
import type { DraftSpec } from '@/lib/schemas/define'
import { announcementDraft } from '@/lib/schemas/announcement'
import { siteContactDraft } from '@/lib/schemas/contact'
import { dishDraft, menuCategoryDraft } from '@/lib/schemas/menu'
import { openingHoursDraft, openingHoursOverrideDraft } from '@/lib/schemas/opening-hours'
import { aboutDraft, homeDraft, takeawayDraft } from '@/lib/schemas/page-documents'
import { monthlyBurgerDraft, weeklySpecialDraft } from '@/lib/schemas/specials'

/**
 * Everything that can be published, stated once — technical plan §4, §5, §6.
 *
 * This table is the single source of truth for four questions that would otherwise be
 * answered in four different files and drift apart:
 *
 *   1. **Who may publish it.** The §5 matrix, as data. Forsiden, the opening hours and
 *      the contact facts are Owner; everything else is Staff.
 *   2. **Which database function publishes it.** A fixed name per entity. The
 *      application never builds a function name, a table name or a column name from
 *      anything a request said.
 *   3. **Which schema its draft must satisfy.** Used to validate a draft on the way in
 *      and again before it goes live.
 *   4. **Which public cache tags go stale when it does.**
 *
 * The keys are the entity vocabulary the whole phase speaks: the `pending_changes`
 * view emits them, `audit_log.entity` records them, and `entityKeySchema` parses them
 * back out of a form. A value that is not one of these is not an entity, so a
 * submitted entity name can never reach a table.
 *
 * THE ROLE HERE IS NOT THE ONLY CHECK
 *
 * `requiredRole` is the first of two independent gates. The second is RLS: every
 * publish function is SECURITY INVOKER, so the database re-decides the same question
 * against the caller's own JWT and answers `forbidden` if the application ever asks it
 * to do something the matrix forbids. Neither layer is trusted to be the only one (§5).
 */

/** The tables a publish may read a stored draft from. A closed set, never a parameter. */
export type DraftTable =
  | 'pages'
  | 'site_contact'
  | 'opening_hours'
  | 'announcement'
  | 'menu_categories'
  | 'dishes'
  | 'weekly_special'
  | 'monthly_burger'
  | 'opening_hours_overrides'

/**
 * How to find the one row an entity refers to.
 *
 * `singleton` — the table holds exactly one row and the entity *is* that row.
 * `keyed`     — the table holds a fixed set of rows told apart by `key` (`pages`).
 * `many`      — the entity names a kind of row, so an id is always required.
 */
export type EntityInstance =
  | { readonly kind: 'singleton' }
  | { readonly kind: 'keyed'; readonly key: string }
  | { readonly kind: 'many' }

/**
 * How a draft relates to the live values.
 *
 * `columns`  — the draft carries individual columns, merged one by one.
 * `document` — the live value is itself a jsonb document and the draft carries whole
 *              top-level sections of it, merged shallowly (`published || draft`).
 *
 * The SQL publish functions mirror this exactly, which is why it is stated once here
 * rather than inferred from the entity name in three different places.
 */
export type DraftShape = 'columns' | 'document'

export type PublishableEntity = {
  /** The entity's name in the administration's language. */
  readonly label: string
  /** The lowest role that may publish it (§5). */
  readonly requiredRole: Role
  /** The SECURITY INVOKER function that performs the publish transaction. */
  readonly publishFunction: string
  /**
   * The draft schema, the table its `draft` column lives in and how the two relate —
   * or `null` for the two entities that are pending through their `status` rather than
   * through a draft (§4).
   */
  readonly draft: {
    readonly table: DraftTable
    readonly spec: DraftSpec
    readonly shape: DraftShape
    /** The jsonb column holding the live document, for `shape: 'document'`. */
    readonly documentColumn?: string
  } | null
  /** Where this entity's row lives. */
  readonly instance: EntityInstance
  /** The public cache tags this entity's content appears in (§6). */
  readonly cacheTags: readonly CacheTag[]
}

export const PUBLISHABLE_ENTITIES = {
  'page:home': {
    label: 'Forsiden',
    requiredRole: 'owner',
    publishFunction: 'publish_page',
    draft: { table: 'pages', spec: homeDraft, shape: 'document', documentColumn: 'published' },
    instance: { kind: 'keyed', key: 'home' },
    cacheTags: [CACHE_TAGS.homePage],
  },
  'page:takeaway': {
    label: 'Mad ud af huset',
    requiredRole: 'staff',
    publishFunction: 'publish_page',
    draft: { table: 'pages', spec: takeawayDraft, shape: 'document', documentColumn: 'published' },
    instance: { kind: 'keyed', key: 'takeaway' },
    cacheTags: [CACHE_TAGS.takeawayPage],
  },
  'page:about': {
    label: 'Om os',
    requiredRole: 'staff',
    publishFunction: 'publish_page',
    draft: { table: 'pages', spec: aboutDraft, shape: 'document', documentColumn: 'published' },
    instance: { kind: 'keyed', key: 'about' },
    cacheTags: [CACHE_TAGS.aboutPage],
  },
  site_contact: {
    label: 'Kontaktoplysninger',
    requiredRole: 'owner',
    publishFunction: 'publish_site_contact',
    draft: { table: 'site_contact', spec: siteContactDraft, shape: 'columns' },
    instance: { kind: 'singleton' },
    // The contact facts appear in the header, the footer and both order bars, so they
    // are genuinely on every page, and expiring this tag expires every page. That is
    // the right answer rather than an over-broad one.
    cacheTags: [CACHE_TAGS.contact],
  },
  opening_hours: {
    label: 'Åbningstider',
    requiredRole: 'owner',
    publishFunction: 'publish_opening_hours',
    draft: { table: 'opening_hours', spec: openingHoursDraft, shape: 'columns' },
    instance: { kind: 'singleton' },
    cacheTags: [CACHE_TAGS.hours],
  },
  announcement: {
    label: 'Besked på siden',
    requiredRole: 'staff',
    publishFunction: 'publish_announcement',
    draft: { table: 'announcement', spec: announcementDraft, shape: 'columns' },
    instance: { kind: 'singleton' },
    cacheTags: [CACHE_TAGS.announcement],
  },
  menu_category: {
    label: 'Menusektion',
    requiredRole: 'staff',
    publishFunction: 'publish_menu_category',
    draft: { table: 'menu_categories', spec: menuCategoryDraft, shape: 'columns' },
    instance: { kind: 'many' },
    cacheTags: [CACHE_TAGS.menu],
  },
  dish: {
    label: 'Ret',
    requiredRole: 'staff',
    publishFunction: 'publish_dish',
    draft: { table: 'dishes', spec: dishDraft, shape: 'columns' },
    instance: { kind: 'many' },
    // The Forside's three featured burgers come from the same cached read as the menu,
    // so the `menu` tag already covers both pages. No second tag is needed.
    cacheTags: [CACHE_TAGS.menu],
  },
  weekly_special: {
    label: 'Ugens ret',
    requiredRole: 'staff',
    publishFunction: 'publish_weekly_special',
    draft: { table: 'weekly_special', spec: weeklySpecialDraft, shape: 'columns' },
    instance: { kind: 'singleton' },
    cacheTags: [CACHE_TAGS.weekly],
  },
  monthly_burger: {
    label: 'Månedens burger',
    requiredRole: 'staff',
    publishFunction: 'publish_monthly_burger',
    draft: { table: 'monthly_burger', spec: monthlyBurgerDraft, shape: 'columns' },
    instance: { kind: 'singleton' },
    cacheTags: [CACHE_TAGS.monthly],
  },
  news: {
    label: 'Nyhed',
    requiredRole: 'staff',
    publishFunction: 'publish_news',
    // No draft column: an article is pending while `status` is still 'draft' (§4).
    draft: null,
    instance: { kind: 'many' },
    cacheTags: [CACHE_TAGS.news],
  },
  opening_hours_override: {
    label: 'Ændret åbningstid',
    requiredRole: 'staff',
    publishFunction: 'publish_opening_hours_override',
    /*
     * An override is pending in **two** ways, and phase 8B is where the second one
     * appeared (see `20260831120000_opening_hours_override_admin.sql`). A row that has
     * never been live is pending through `status`, exactly as §4 describes and as `news`
     * still is; a row that is already live and carries an edit is pending through this
     * `draft` column, because a published override and the change waiting behind it have
     * to be two values at once and `date` is UNIQUE.
     *
     * Registering the draft here is what lets the ordinary machinery do the ordinary
     * work: `saveEntityDraft` writes it with the strict parse, the allow-list and the
     * version check; `readEditableEntity` merges it for the editor with the same
     * `overlayDraft` the preview uses; and `publishPendingChange` re-validates the
     * **stored** draft against `spec.stored` before `publish_opening_hours_override()`
     * merges it. None of that is reimplemented for this screen.
     */
    draft: {
      table: 'opening_hours_overrides',
      spec: openingHoursOverrideDraft,
      shape: 'columns',
    },
    instance: { kind: 'many' },
    cacheTags: [CACHE_TAGS.hours],
  },
} as const satisfies Record<string, PublishableEntity>

export type EntityKey = keyof typeof PUBLISHABLE_ENTITIES

export const ENTITY_KEYS = Object.keys(PUBLISHABLE_ENTITIES) as EntityKey[]

/**
 * The parser every entity name from a browser goes through.
 *
 * "Never trust entity IDs/types submitted by the browser" starts here: a value outside
 * this enum is rejected before it can be looked up, and a value inside it can only
 * ever select one of the twelve rows above.
 */
export const entityKeySchema = z.enum(ENTITY_KEYS as [EntityKey, ...EntityKey[]], {
  error: 'Ukendt indholdstype.',
})

export function publishableEntity(key: EntityKey): PublishableEntity {
  return PUBLISHABLE_ENTITIES[key]
}

/** True when `value` names an entity this system knows how to publish. */
export function isEntityKey(value: unknown): value is EntityKey {
  return typeof value === 'string' && Object.hasOwn(PUBLISHABLE_ENTITIES, value)
}
